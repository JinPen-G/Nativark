import { z } from "zod";
import { modelResponseContainsSecret } from './model-response-secret';
import { normalizeTenantModelBaseUrl } from "./tenant-model-config.service";
import { ModelAdapterError, ModelGatewayError, modelProtocolRequestSchema, type AdapterStreamEvent, type ModelAdapter, type ModelFeature, type ModelProtocolRequest, type ModelProtocolInvocation } from '@rental-os/platform-server/ai-gateway';
import { MODEL_REQUEST_BYTES } from './model-response-limits';
import { ChatCompletionsStream, chatCompletionsUsageSchema, chatCompletionsUsage } from "./chat-completions-stream";
import { modelEgressEvidence, type ModelJsonTransport } from './model-egress.transport';
import { encodeNativeToolResultBody, nativeToolResultInputHash } from './native-tool-result.encoding';
import type { ResolvedNativeToolResult, NativeAdapterResult } from '@rental-os/platform-server/ai-gateway';

import type { ModelProtocolPolicy } from './model-protocol-policy';
export interface ModelProtocolMedia { mediaInput?: readonly ('image' | 'audio')[] }

export type { ModelJsonTransport } from './model-egress.transport';
const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional(), tool_calls: z.array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }).strict() }).strict()).max(8).optional() }),
    finish_reason: z.string().nullable().optional() })).length(1),
  usage: chatCompletionsUsageSchema.optional()
});

/** OpenAI-compatible Chat Completions protocol. No fixed supplier or model. */
export class ChatCompletionsProtocolAdapter<Tool = never> implements ModelAdapter<Tool> {
  readonly provider = "openai_chat_completions";
  get evidenceMode(): 'live' | 'mock' { return modelEgressEvidence(this.transport); }
  get structuredSchemaHash(): string | undefined { return this.policy.structuredSchemaHash; }
  get supportsNativeToolResults(): boolean { return this.policy.nativeToolResults; }
  private nativeBody(input: Readonly<ModelProtocolRequest>, value: ResolvedNativeToolResult) {
    if (!this.supportsNativeToolResults) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const selected = this.policy.selected(input.features ?? []);
    selected.parse('', [value.call]); // Reuse the frozen C02 argument validator; no tool execution here.
    return encodeNativeToolResultBody(this.provider, input, this.body({ model: input.model,
      messages: this.messages(input), stream: false, max_completion_tokens: input.maxOutputTokens,
      ...selected.body(input.features ?? []) }), value);
  }
  nativeInputBoundHash(input: Readonly<ModelProtocolRequest>, value: ResolvedNativeToolResult) {
    return nativeToolResultInputHash(this.provider, this.nativeBody(modelProtocolRequestSchema.parse(structuredClone(input)), structuredClone(value)));
  }
  private readonly mediaInput: readonly ('image' | 'audio')[];
  get features(): readonly ModelFeature[] { return [...this.mediaInput, ...(typeof this.transport.postStream === "function" ? ['streaming' as const] : []), ...(this.policy.tools ? ['tools' as const] : []), ...(this.policy.structured ? ['structuredOutput' as const] : [])]; }
  constructor(private readonly transport: ModelJsonTransport, private readonly policy: ModelProtocolPolicy<Tool>, { mediaInput }: ModelProtocolMedia = {}) {
    const parsed = z.array(z.enum(['image', 'audio'])).max(2).refine(values => new Set(values).size === values.length).safeParse(mediaInput ?? []);
    if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
    this.mediaInput = Object.freeze(parsed.data);
  }

  private request(input: ModelProtocolInvocation) {
    if (!input || !input.signal || typeof input.signal.aborted !== 'boolean' || typeof input.signal.addEventListener !== 'function' || typeof input.signal.removeEventListener !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    // Project only server protocol fields. Later caller mutations cannot replace
    // messages or the cancellation signal; forged top-level tool definitions are ignored.
    const parsed = modelProtocolRequestSchema.safeParse({ callId: input.callId, model: input.model, messages: input.messages, maxOutputTokens: input.maxOutputTokens, features: input.features,
      ...(input.structuredSchemaHash !== undefined ? { structuredSchemaHash: input.structuredSchemaHash } : {}) });
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    if (parsed.data.structuredSchemaHash && (!parsed.data.features?.includes('structuredOutput')
      || parsed.data.structuredSchemaHash !== this.structuredSchemaHash)) throw new ModelGatewayError('CONFIG_INVALID');
    if (parsed.data.features?.some(feature => (feature === 'image' || feature === 'audio') && !this.mediaInput.includes(feature))) {
      throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    }
    if (input.recordUsage !== undefined && typeof input.recordUsage !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    return { ...parsed.data, signal: input.signal, recordUsage: input.recordUsage };
  }
  private messages(input: ModelProtocolRequest) {
    return input.messages.map(message => ({ role: message.role, content: typeof message.content === 'string' ? message.content
      : message.content.map(part => {
        if (part.kind === 'text') return { type: 'text', text: part.text };
        if (part.kind === 'image') return { type: 'image_url', image_url: { url: `data:${part.mediaType};base64,${part.data}` } };
        return { type: 'input_audio', input_audio: { data: part.data, format: 'wav' } };
      }) }));
  }
  private body(value: Record<string, unknown>): string {
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded) > MODEL_REQUEST_BYTES) throw new ModelGatewayError('INVALID_REQUEST');
    return encoded;
  }

  async *stream(input: ModelProtocolInvocation, credential: string,
    connection?: Readonly<{ baseUrl: string }>): AsyncIterable<AdapterStreamEvent<Tool>> {
    if (!this.transport.postStream) throw new ModelGatewayError("CAPABILITY_UNSUPPORTED");
    input = this.request(input);
    if (!connection || typeof credential !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(credential)) throw new ModelGatewayError("CONFIG_INVALID");
    const features = input.features ?? [], selected = this.policy.selected(features);
    if (features.includes('audio')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const baseUrl = normalizeTenantModelBaseUrl(connection.baseUrl), decoder = new ChatCompletionsStream(credential, 1_048_576, selected);
    let headers = false, recorded = false;
    const recordKnownUsage = async () => {
      const usage = decoder.accountingUsage();
      if (!usage || recorded) return;
      // The original receipt may have committed even if this await fails. Never
      // automatically retry it on another chunk or on rejected delivery.
      recorded = true;
      await input.recordUsage?.(usage);
    };
    if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
    for await (const event of this.transport.postStream({ url: `${baseUrl}/chat/completions`,
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: this.body({ model: input.model, messages: this.messages(input), stream: true, stream_options: { include_usage: true }, max_completion_tokens: input.maxOutputTokens, ...selected.body(features) }),
      signal: input.signal, maxResponseBytes: 1_048_576, redirects: "error" })) {
      if (event.kind === "headers") {
        if (headers) throw new ModelGatewayError("INVALID_RESPONSE"); headers = true;
        if (event.status === 401 || event.status === 403) throw new ModelAdapterError("AUTHENTICATION_FAILED");
        if (event.status === 429) throw new ModelAdapterError("RATE_LIMITED");
        if (event.status !== 200) throw new ModelAdapterError("PROVIDER_FAILED");
        if (input.signal.aborted) throw new ModelGatewayError('CANCELLED');
      } else {
        if (!headers) throw new ModelGatewayError("INVALID_RESPONSE");
        let deltas: string[];
        try { deltas = decoder.push(event.bytes); }
        catch (error) { await recordKnownUsage(); throw error; }
        await recordKnownUsage();
        if (input.signal.aborted) throw new ModelGatewayError('CANCELLED');
        // The decoder validates the whole bounded network block before any
        // text escapes. Deliver it as one unit so coalesced SSE frames do not
        // each trigger the same downstream vault/routing/ACL reads. Each next
        // delivered block still rechecks current authority; no timed cache.
        const delta = deltas.join('');
        if (delta) {
          if (input.signal.aborted) throw new ModelGatewayError('CANCELLED');
          yield { kind: "text_delta", delta };
        }
      }
    }
    if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
    if (!headers) throw new ModelGatewayError("INVALID_RESPONSE");
    yield { kind: "result", result: decoder.finish() };
  }

  async generate(input: ModelProtocolInvocation, credential: string,
    connection?: Readonly<{ baseUrl: string }>): Promise<NativeAdapterResult<Tool>> {
    return this.generateRequest(input, credential, connection);
  }
  async generateNativeToolResult(input: ModelProtocolInvocation, credential: string,
    value: ResolvedNativeToolResult, connection?: Readonly<{ baseUrl: string }>): Promise<NativeAdapterResult<Tool>> {
    if (!this.supportsNativeToolResults) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return this.generateRequest(input, credential, connection, structuredClone(value));
  }
  private async generateRequest(input: ModelProtocolInvocation, credential: string,
    connection?: Readonly<{ baseUrl: string }>, native?: ResolvedNativeToolResult): Promise<NativeAdapterResult<Tool>> {
    const expectedInputBoundHash = input.expectedInputBoundHash;
    input = this.request(input);
    if (!connection || typeof credential !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(credential)) throw new ModelGatewayError("CONFIG_INVALID");
    const features = input.features ?? [];
    if (features.includes('streaming')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const selected = this.policy.selected(features);
    const baseUrl = normalizeTenantModelBaseUrl(connection.baseUrl);
    const body = native ? this.nativeBody(input, native) : this.body({ model: input.model,
      messages: this.messages(input), stream: false, max_completion_tokens: input.maxOutputTokens, ...selected.body(features) });
    if (native && expectedInputBoundHash !== undefined && nativeToolResultInputHash(this.provider, body) !== expectedInputBoundHash)
      throw new ModelGatewayError('CONFIG_INVALID');
    if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
    const result = await this.transport.post({ url: `${baseUrl}/chat/completions`,
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body,
      signal: input.signal, maxResponseBytes: 1_048_576, redirects: "error" });
    if (result.status === 401 || result.status === 403) throw new ModelAdapterError("AUTHENTICATION_FAILED");
    if (result.status === 429) throw new ModelAdapterError("RATE_LIMITED");
    if (result.status !== 200) throw new ModelAdapterError("PROVIDER_FAILED");
    if (typeof result.body !== "string" || Buffer.byteLength(result.body, "utf8") > 1_048_576) throw new ModelGatewayError("INVALID_RESPONSE");
    let parsed;
    try { parsed = responseSchema.safeParse(JSON.parse(result.body)); } catch { throw new ModelGatewayError("INVALID_RESPONSE"); }
    if (!parsed.success) throw new ModelGatewayError("INVALID_RESPONSE");
    const choice = parsed.data.choices[0];
    // Usage receipts may reconcile unknown dispatches; interim counters must
    // never be recorded as final. Rejected terminal output retains its usage.
    if (parsed.data.usage) {
      if (!choice.finish_reason || !['stop', 'tool_calls', 'length', 'content_filter'].includes(choice.finish_reason))
        throw new ModelGatewayError('INVALID_RESPONSE');
      await input.recordUsage?.(chatCompletionsUsage(parsed.data.usage));
    }
    if (input.signal.aborted) throw new ModelGatewayError('CANCELLED');
    // Partial/truncated, refused or tool responses must not be presented as a complete text answer.
    const text = choice.message.content ?? '', calls = choice.message.tool_calls ?? [];
    if (choice.message.refusal || choice.finish_reason !== (calls.length ? 'tool_calls' : 'stop') || (!calls.length && choice.message.content === null) || text.length > 128_000 || modelResponseContainsSecret({ text, calls }, credential)) throw new ModelGatewayError("INVALID_RESPONSE");
    const extras = selected.parse(text, calls);
    if (modelResponseContainsSecret(extras, credential)) throw new ModelGatewayError('INVALID_RESPONSE');
    return { text, ...extras, usage: parsed.data.usage ? chatCompletionsUsage(parsed.data.usage) : undefined,
      ...(selected.nativeToolResults && calls.length ? { nativeToolCalls: structuredClone(calls) } : {}) };
  }
}
