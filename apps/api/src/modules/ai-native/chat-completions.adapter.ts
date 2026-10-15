import { z } from "zod";
import { normalizeTenantModelBaseUrl } from "./tenant-model-config.service";
import { ModelAdapterError, ModelGatewayError, modelProtocolRequestSchema, type AdapterResult, type AdapterStreamEvent, type ModelAdapter, type ModelFeature, type ModelProtocolRequest } from "./model-gateway.ports";
import { MODEL_REQUEST_BYTES } from './model-response-limits';
import { ChatCompletionsStream, chatCompletionsUsageSchema } from "./chat-completions-stream";
import Ajv, { type ValidateFunction } from 'ajv';
import { AI_CONTRACT_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AI_NATIVE_COMPONENT_SCHEMAS } from '../../contracts/ai-native-schemas';
import type { ModelResponsePolicy, ProtocolToolCall } from './model-gateway.ports';
import { modelEgressEvidence } from './model-egress.transport';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export interface ChatProtocolOptions {
  /** Supplied by trusted server registration; only the existing C02 input is supported. */
  orderExplainTool?: { name: string; version: typeof AI_TOOL_DRAFT_VERSION };
  structuredOutput?: { name: string; schema: Readonly<Record<string, unknown>> };
}
function boundedSchema(value: unknown, depth = 0, count = { value: 0 }): void {
  if (++count.value > 256 || depth > 12 || !value || typeof value !== 'object' || Array.isArray(value)) throw new ModelGatewayError('CONFIG_INVALID');
  const schema = value as Record<string, unknown>;
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'description']);
  if (Object.keys(schema).some(key => !allowed.has(key)) || !['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'].includes(String(schema.type))) throw new ModelGatewayError('CONFIG_INVALID');
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties)) throw new ModelGatewayError('CONFIG_INVALID');
    for (const child of Object.values(schema.properties)) boundedSchema(child, depth + 1, count);
  }
  if (schema.type === 'array') {
    if (!Number.isSafeInteger(schema.maxItems) || Number(schema.maxItems) < 0 || Number(schema.maxItems) > 256) throw new ModelGatewayError('CONFIG_INVALID');
    boundedSchema(schema.items, depth + 1, count);
  }
  if (schema.type === 'string' && (!Number.isSafeInteger(schema.maxLength) || Number(schema.maxLength) < 0 || Number(schema.maxLength) > 16000)) throw new ModelGatewayError('CONFIG_INVALID');
}
/** Restricted protocol validation, not an executable tool registry or authorization. */
export class ChatProtocolPolicy implements ModelResponsePolicy {
  readonly tools: boolean; readonly structured: boolean;
  readonly structuredSchemaHash?: string;
  private readonly tool?: ChatProtocolOptions['orderExplainTool'];
  private readonly output?: ChatProtocolOptions['structuredOutput'];
  private readonly validateInput: ValidateFunction;
  private readonly validateOutput?: ValidateFunction;
  constructor(options: ChatProtocolOptions = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['orderExplainTool', 'structuredOutput'].includes(key))) throw new ModelGatewayError('CONFIG_INVALID');
    try {
      this.tool = options.orderExplainTool && structuredClone(options.orderExplainTool);
      this.output = options.structuredOutput && structuredClone(options.structuredOutput);
    } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
    this.tools = !!this.tool; this.structured = !!this.output;
    const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
    if (this.tool && (!name.test(this.tool.name) || this.tool.version !== AI_TOOL_DRAFT_VERSION || Object.keys(this.tool).some(key => !['name', 'version'].includes(key)))) throw new ModelGatewayError('CONFIG_INVALID');
    const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
    this.validateInput = ajv.compile(AI_NATIVE_COMPONENT_SCHEMAS.AiOrderExplainInput);
    if (this.output) {
      let encoded: string | undefined;
      try { encoded = JSON.stringify(this.output.schema); } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
      if (!encoded || !name.test(this.output.name) || Object.keys(this.output).some(key => !['name', 'schema'].includes(key)) || Buffer.byteLength(encoded) > 32768) throw new ModelGatewayError('CONFIG_INVALID');
      boundedSchema(this.output.schema);
      try { this.validateOutput = ajv.compile(this.output.schema); } catch { throw new ModelGatewayError('CONFIG_INVALID'); }
      this.structuredSchemaHash = requestFingerprint({ version: 'rental-response-schema-1', name: this.output.name,
        schema: this.output.schema, strict: true });
    }
  }
  body(features: readonly ModelFeature[]): Record<string, unknown> {
    if (features.includes('tools') && !this.tools || features.includes('structuredOutput') && !this.structured || features.includes('tools') && features.includes('structuredOutput')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return {
      ...(features.includes('tools') ? { tools: [{ type: 'function', function: { name: this.tool!.name, parameters: structuredClone(AI_NATIVE_COMPONENT_SCHEMAS.AiOrderExplainInput), strict: true } }], parallel_tool_calls: false } : {}),
      ...(features.includes('structuredOutput') ? { response_format: { type: 'json_schema', json_schema: { name: this.output!.name, schema: structuredClone(this.output!.schema), strict: true } } } : {})
    };
  }
  parse(text: string, calls: readonly ProtocolToolCall[]): Pick<AdapterResult, 'toolRequests' | 'structuredOutput'> {
    if (calls.length) {
      if (!this.tool || calls.length > 8) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      const ids = new Set<string>();
      const toolRequests = calls.map(call => {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(call.id) || ids.has(call.id) || call.type !== 'function' || call.function.name !== this.tool!.name || typeof call.function.arguments !== 'string' || call.function.arguments.length > 16000) throw new ModelGatewayError('INVALID_RESPONSE');
        ids.add(call.id); let input: unknown;
        try { input = JSON.parse(call.function.arguments); } catch { throw new ModelGatewayError('INVALID_RESPONSE'); }
        if (!this.validateInput(input)) throw new ModelGatewayError('INVALID_RESPONSE');
        return { contractVersion: AI_CONTRACT_DRAFT_VERSION, toolCode: 'rental.order.explain' as const, toolVersion: AI_TOOL_DRAFT_VERSION, input: input as { orderId: string } };
      });
      return { toolRequests };
    }
    if (this.output) {
      let structuredOutput: unknown; try { structuredOutput = JSON.parse(text); } catch { throw new ModelGatewayError('INVALID_RESPONSE'); }
      if (!this.validateOutput!(structuredOutput)) throw new ModelGatewayError('INVALID_RESPONSE');
      return { structuredOutput };
    }
    return {};
  }
  selected(features: readonly ModelFeature[]): ChatProtocolPolicy {
    this.body(features);
    return new ChatProtocolPolicy({ ...(features.includes('tools') ? { orderExplainTool: this.tool } : {}), ...(features.includes('structuredOutput') ? { structuredOutput: this.output } : {}) });
  }
}

/** Required server transport: resolve/check ALL addresses, pin chosen public IP through TLS,
 * retain hostname certificate validation, forbid redirects/proxies, bound response bytes,
 * honour AbortSignal. No fetch fallback: unconfigured safe egress fails closed.
 * This slice supplies protocol logic, not a claim that an arbitrary transport is safe. */
export interface ModelJsonTransport {
  post(request: { url: string; headers: Readonly<Record<string, string>>; body: string;
    signal: AbortSignal; maxResponseBytes: number; redirects: "error" }): Promise<{ status: number; body: string }>;
  postStream?(request: Parameters<ModelJsonTransport["post"]>[0]): AsyncIterable<
    { kind: "headers"; status: number } | { kind: "chunk"; bytes: Uint8Array }>;
}
const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional(), tool_calls: z.array(z.object({ id: z.string(), type: z.literal('function'), function: z.object({ name: z.string(), arguments: z.string() }).strict() }).strict()).max(8).optional() }),
    finish_reason: z.string().nullable().optional() })).length(1),
  usage: chatCompletionsUsageSchema.optional()
});

/** OpenAI-compatible Chat Completions protocol. No fixed supplier or model. */
export class ChatCompletionsAdapter implements ModelAdapter {
  readonly provider = "openai_chat_completions";
  get evidenceMode(): 'live' | 'mock' { return modelEgressEvidence(this.transport); }
  get structuredSchemaHash(): string | undefined { return this.policy.structuredSchemaHash; }
  private readonly policy: ChatProtocolPolicy;
  private readonly mediaInput: readonly ('image' | 'audio')[];
  get features(): readonly ModelFeature[] { return [...this.mediaInput, ...(typeof this.transport.postStream === "function" ? ['streaming' as const] : []), ...(this.policy.tools ? ['tools' as const] : []), ...(this.policy.structured ? ['structuredOutput' as const] : [])]; }
  constructor(private readonly transport: ModelJsonTransport, options: ChatProtocolOptions & { mediaInput?: readonly ('image' | 'audio')[] } = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ModelGatewayError('CONFIG_INVALID');
    const { mediaInput, ...policy } = options;
    const parsed = z.array(z.enum(['image', 'audio'])).max(2).refine(values => new Set(values).size === values.length).safeParse(mediaInput ?? []);
    if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
    this.mediaInput = Object.freeze(parsed.data);
    this.policy = new ChatProtocolPolicy(policy);
  }

  private request(input: Readonly<ModelProtocolRequest> & { signal: AbortSignal }) {
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
    return { ...parsed.data, signal: input.signal };
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

  async *stream(input: Readonly<ModelProtocolRequest> & { signal: AbortSignal }, credential: string,
    connection?: Readonly<{ baseUrl: string }>): AsyncIterable<AdapterStreamEvent> {
    if (!this.transport.postStream) throw new ModelGatewayError("CAPABILITY_UNSUPPORTED");
    input = this.request(input);
    if (!connection || typeof credential !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(credential)) throw new ModelGatewayError("CONFIG_INVALID");
    const features = input.features ?? [], selected = this.policy.selected(features);
    if (features.includes('audio')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const baseUrl = normalizeTenantModelBaseUrl(connection.baseUrl), decoder = new ChatCompletionsStream(credential, 1_048_576, selected);
    let headers = false;
    if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
    for await (const event of this.transport.postStream({ url: `${baseUrl}/chat/completions`,
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: this.body({ model: input.model, messages: this.messages(input), stream: true, stream_options: { include_usage: true }, max_completion_tokens: input.maxOutputTokens, ...selected.body(features) }),
      signal: input.signal, maxResponseBytes: 1_048_576, redirects: "error" })) {
      if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
      if (event.kind === "headers") {
        if (headers) throw new ModelGatewayError("INVALID_RESPONSE"); headers = true;
        if (event.status === 401 || event.status === 403) throw new ModelAdapterError("AUTHENTICATION_FAILED");
        if (event.status === 429) throw new ModelAdapterError("RATE_LIMITED");
        if (event.status !== 200) throw new ModelAdapterError("PROVIDER_FAILED");
      } else {
        if (!headers) throw new ModelGatewayError("INVALID_RESPONSE");
        for (const delta of decoder.push(event.bytes)) {
          if (input.signal.aborted) throw new ModelGatewayError('CANCELLED');
          yield { kind: "text_delta", delta };
        }
      }
    }
    if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
    if (!headers) throw new ModelGatewayError("INVALID_RESPONSE");
    yield { kind: "result", result: decoder.finish() };
  }

  async generate(input: Readonly<ModelProtocolRequest> & { signal: AbortSignal }, credential: string,
    connection?: Readonly<{ baseUrl: string }>): Promise<AdapterResult> {
    input = this.request(input);
    if (!connection || typeof credential !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(credential)) throw new ModelGatewayError("CONFIG_INVALID");
    const features = input.features ?? [];
    if (features.includes('streaming')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const selected = this.policy.selected(features);
    const baseUrl = normalizeTenantModelBaseUrl(connection.baseUrl);
    if (input.signal.aborted) throw new ModelGatewayError("CANCELLED");
    const result = await this.transport.post({ url: `${baseUrl}/chat/completions`,
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: this.body({ model: input.model, messages: this.messages(input), stream: false, max_completion_tokens: input.maxOutputTokens, ...selected.body(features) }),
      signal: input.signal, maxResponseBytes: 1_048_576, redirects: "error" });
    // An injected transport may complete after cancellation. Never convert that late
    // response into a protocol success; outer Gateway accounting remains responsible.
    if (input.signal.aborted) throw new ModelGatewayError('CANCELLED');
    if (result.status === 401 || result.status === 403) throw new ModelAdapterError("AUTHENTICATION_FAILED");
    if (result.status === 429) throw new ModelAdapterError("RATE_LIMITED");
    if (result.status !== 200) throw new ModelAdapterError("PROVIDER_FAILED");
    if (typeof result.body !== "string" || Buffer.byteLength(result.body, "utf8") > 1_048_576) throw new ModelGatewayError("INVALID_RESPONSE");
    let parsed;
    try { parsed = responseSchema.safeParse(JSON.parse(result.body)); } catch { throw new ModelGatewayError("INVALID_RESPONSE"); }
    if (!parsed.success) throw new ModelGatewayError("INVALID_RESPONSE");
    const choice = parsed.data.choices[0];
    // Partial/truncated, refused or tool responses must not be presented as a complete text answer.
    const text = choice.message.content ?? '', calls = choice.message.tool_calls ?? [];
    if (choice.message.refusal || choice.finish_reason !== (calls.length ? 'tool_calls' : 'stop') || (!calls.length && choice.message.content === null) || text.length > 128_000 || text.includes(credential) || calls.some(call => call.function.arguments.includes(credential))) throw new ModelGatewayError("INVALID_RESPONSE");
    const extras = selected.parse(text, calls);
    if (JSON.stringify(extras).includes(credential)) throw new ModelGatewayError('INVALID_RESPONSE');
    return { text, ...extras, usage: parsed.data.usage ? {
      inputTokens: parsed.data.usage.prompt_tokens, outputTokens: parsed.data.usage.completion_tokens
    } : undefined };
  }
}
