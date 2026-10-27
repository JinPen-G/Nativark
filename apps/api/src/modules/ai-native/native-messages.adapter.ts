/** Native Responses/Messages codec behind the existing ModelAdapter seam.
 * No SDK, agent loop, ambient credentials, retry, hosted tool or second ledger.
 * References: developers.openai.com/api/docs/guides/streaming-responses and
 * platform.claude.com/docs/en/build-with-claude/streaming. Native event shapes
 * stop here; Rental OS owns response policy, dispatch and original accounting. */
import { z } from 'zod';
import { ChatProtocolPolicy, type ChatProtocolOptions, type ModelJsonTransport } from './chat-completions.adapter';
import { normalizeTenantModelBaseUrl } from './tenant-model-config.service';
import { modelEgressEvidence } from './model-egress.transport';
import { messagesGenerationInputHash } from './input-counting/count-tokens.protocol';
import { MODEL_REQUEST_BYTES, MODEL_RESPONSE_BYTES } from './model-response-limits';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { ModelAdapterError, ModelGatewayError, modelProtocolRequestSchema,
  type AdapterResult, type AdapterStreamEvent, type ModelAdapter, type ModelFeature,
  type ModelProtocolInvocation, type ModelProtocolRequest, type ModelUsage, type ProtocolToolCall } from './model-gateway.ports';

type Protocol = 'openai_responses' | 'anthropic_messages';
type ObjectValue = Record<string, unknown>;
const invalid = (): never => { throw new ModelGatewayError('INVALID_RESPONSE'); };
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as ObjectValue;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
function text(value: unknown, max = 128000): string {
  if (typeof value !== 'string' || value.length > max) return invalid();
  return value;
}
function list(value: unknown, max = 32): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
function protocolUsage(protocol: Protocol, value: unknown): ModelUsage | undefined {
  if (value === undefined || value === null) return undefined;
  const usage = object(value), input = count(usage.input_tokens), output = count(usage.output_tokens);
  let cachedInputTokens = 0;
  if (protocol === 'openai_responses') {
    if (usage.total_tokens !== undefined && BigInt(count(usage.total_tokens)) !== BigInt(input) + BigInt(output)) invalid();
    if (usage.input_tokens_details != null) {
      const cached = object(usage.input_tokens_details).cached_tokens;
      if (cached !== undefined) cachedInputTokens = count(cached);
      if (cachedInputTokens > input) invalid();
    }
    if (usage.output_tokens_details != null) {
      const reasoning = object(usage.output_tokens_details).reasoning_tokens;
      if (reasoning !== undefined && count(reasoning) > output) invalid();
    }
    return { inputTokens: input, outputTokens: output, ...(cachedInputTokens ? {
      billingDetails: { cachedInputTokens, cacheCreationInputTokens: 0 } } : {}) };
  }
  // Messages reports cached input separately, unlike Responses. Count every
  // token once, without translating these counters into a guessed money rate.
  cachedInputTokens = usage.cache_read_input_tokens === undefined ? 0 : count(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = usage.cache_creation_input_tokens === undefined ? 0 : count(usage.cache_creation_input_tokens);
  const total = BigInt(input) + BigInt(cachedInputTokens) + BigInt(cacheCreationInputTokens);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) invalid();
  return { inputTokens: Number(total), outputTokens: output, ...(cachedInputTokens || cacheCreationInputTokens
    ? { billingDetails: { cachedInputTokens, cacheCreationInputTokens } } : {}) };
}
function responseContent(protocol: Protocol, raw: unknown): { text: string; calls: ProtocolToolCall[] } {
  const value = object(raw), calls: ProtocolToolCall[] = []; let result = '';
  if (protocol === 'openai_responses') {
    if (value.status !== 'completed' || value.error != null || value.incomplete_details != null) invalid();
    for (const rawItem of list(value.output)) {
      const item = object(rawItem);
      if (item.type === 'message') {
        if (item.role !== 'assistant' || item.status !== 'completed') invalid();
        for (const rawPart of list(item.content)) {
          const part = object(rawPart);
          if (part.type !== 'output_text') invalid();
          result += text(part.text);
        }
      } else if (item.type === 'function_call') {
        if (item.status !== 'completed') invalid();
        calls.push({ id: text(item.call_id, 128), type: 'function',
          function: { name: text(item.name, 64), arguments: text(item.arguments, 16000) } });
      } else if (item.type !== 'reasoning') invalid(); // No provider-owned execution tools.
    }
  } else {
    if (value.type !== 'message' || value.role !== 'assistant' || value.stop_sequence != null) invalid();
    for (const rawPart of list(value.content)) {
      const part = object(rawPart);
      if (part.type === 'text') result += text(part.text);
      else if (part.type === 'tool_use') {
        calls.push({ id: text(part.id, 128), type: 'function',
          function: { name: text(part.name, 64), arguments: JSON.stringify(object(part.input)) } });
      } else invalid(); // Thinking/server-tool/refusal blocks are not text answers.
    }
    if (value.stop_reason !== (calls.length ? 'tool_use' : 'end_turn')) invalid();
  }
  if (result.length > 128000 || calls.length > 8 || !result && !calls.length) invalid();
  return { text: result, calls };
}
function completed(protocol: Protocol, raw: unknown, policy: ChatProtocolPolicy, credential: string): AdapterResult {
  const value = responseContent(protocol, raw);
  if (JSON.stringify(value).includes(credential)) invalid();
  const extras = policy.parse(value.text, value.calls);
  if (JSON.stringify(extras).includes(credential)) invalid();
  return { text: value.text, ...extras, usage: protocolUsage(protocol, object(raw).usage) };
}

/** Bounded typed-SSE accumulator. It checks item/block identity and final
 * content against deltas; EOF, truncation, errors and unknown shapes never
 * become successful results. Valid terminal usage survives rejected delivery. */
class NativeMessageStream {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private pending = ''; private bytes = 0; private frames = 0; private failed = false;
  private started = false; private stopped = false; private id?: string; private sequence = -1;
  private accumulated = ''; private emitted = 0; private final?: unknown; private usage?: ModelUsage;
  private readonly items = new Map<number, { id: string; type: string; done: boolean; value?: ObjectValue;
    name?: string; callId?: string; arguments: string; argumentsDone: boolean; parts: Map<number, { text: string; done: boolean; closed: boolean }> }>();
  private readonly blocks: ObjectValue[] = []; private readonly closed = new Set<number>();
  private startUsage?: ObjectValue; private outputTokens = 0; private stopReason?: unknown; private messageDelta = false;
  constructor(private readonly protocol: Protocol, private readonly policy: ChatProtocolPolicy, private readonly credential: string) {}
  accountingUsage() { return this.usage && structuredClone(this.usage); }
  push(chunk: Uint8Array): string {
    if (this.failed) return invalid();
    try {
      if (!(chunk instanceof Uint8Array) || (this.bytes += chunk.byteLength) > MODEL_RESPONSE_BYTES) invalid();
      this.pending += this.decoder.decode(chunk, { stream: true });
      for (;;) {
        const boundary = /\r?\n\r?\n/u.exec(this.pending); if (!boundary) break;
        const frame = this.pending.slice(0, boundary.index); this.pending = this.pending.slice(boundary.index + boundary[0].length);
        this.consume(frame);
      }
      if (Buffer.byteLength(this.pending) > MODEL_RESPONSE_BYTES) invalid();
      return this.safeDelta();
    } catch (error) { this.failed = true; throw error instanceof ModelGatewayError ? error : new ModelGatewayError('INVALID_RESPONSE'); }
  }
  private safeDelta() {
    if (this.accumulated.length > 128000 || this.accumulated.includes(this.credential)) invalid();
    if (this.policy.structured) return '';
    let end = this.accumulated.length;
    if (!this.stopped) for (let size = Math.min(this.credential.length - 1, end); size > 0; size--) {
      if (this.accumulated.endsWith(this.credential.slice(0, size))) { end -= size; break; }
    }
    const delta = this.accumulated.slice(this.emitted, end); this.emitted = end; return delta;
  }
  private consume(frame: string) {
    const lines = frame.split(/\r?\n/u).filter(line => line && !line.startsWith(':'));
    if (!lines.length) return;
    if (++this.frames > 4096 || this.stopped || lines.some(line => !line.startsWith('event:') && !line.startsWith('data:'))) invalid();
    const names = lines.filter(line => line.startsWith('event:')).map(line => line.slice(6).trim());
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /u, '')).join('\n');
    const event = object(JSON.parse(data));
    if (names.length > 1 || names.length === 1 && names[0] !== event.type) invalid();
    if (this.protocol === 'openai_responses') this.responses(event); else this.messages(event);
    if (this.accumulated.length > 128000 || this.accumulated.includes(this.credential)) invalid();
  }
  private responses(event: ObjectValue) {
    const seq = count(event.sequence_number); if (seq <= this.sequence) invalid(); this.sequence = seq;
    if (event.type === 'response.created') {
      const response = object(event.response);
      if (this.started || list(response.output).length) invalid();
      this.id = text(response.id, 128); this.started = true; return;
    }
    if (!this.started) invalid();
    if (['response.completed', 'response.incomplete', 'response.failed'].includes(String(event.type))) {
      const response = object(event.response); if (response.id !== this.id) invalid();
      this.usage = protocolUsage(this.protocol, response.usage);
      if (event.type !== 'response.completed' || [...this.items.values()].some(item => !item.done)) invalid();
      const output = list(response.output);
      if (output.length !== this.items.size || output.some((item, index) => requestFingerprint(item) !== requestFingerprint(this.items.get(index)?.value))) invalid();
      const actual = responseContent(this.protocol, response);
      if (actual.text !== this.accumulated) invalid();
      this.final = response; this.stopped = true; return;
    }
    if (event.type === 'response.in_progress') {
      if (object(event.response).id !== this.id) invalid(); return;
    }
    const index = count(event.output_index), item = this.items.get(index);
    if (event.type === 'response.output_item.added') {
      const value = object(event.item), type = text(value.type, 32), id = text(value.id, 128);
      if (item || index !== this.items.size || index >= 32 || !['message', 'function_call', 'reasoning'].includes(type)
        || [...this.items.values()].some(other => other.id === id)) invalid();
      if (type === 'message' && (value.role !== 'assistant' || list(value.content).length)) invalid();
      if (type === 'function_call' && value.arguments !== '') invalid();
      if (type === 'function_call' && !this.policy.tools) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      this.items.set(index, { id, type, done: false, arguments: '', argumentsDone: false, parts: new Map(),
        ...(type === 'function_call' ? { name: text(value.name, 64), callId: text(value.call_id, 128) } : {}) }); return;
    }
    if (!item || item.done) return invalid();
    if (event.type === 'response.output_item.done') {
      const value = object(event.item);
      if (value.id !== item.id || value.type !== item.type) invalid();
      if (item.type === 'message') {
        const parts = list(value.content);
        if (parts.length !== item.parts.size || parts.some((part, offset) => {
          const actual = object(part), streamed = item.parts.get(offset);
          return !streamed?.done || !streamed.closed || actual.type !== 'output_text' || actual.text !== streamed.text;
        })) invalid();
      } else if (item.type === 'function_call' && (!item.argumentsDone || value.name !== item.name || value.call_id !== item.callId || value.arguments !== item.arguments)) invalid();
      item.done = true; item.value = value; return;
    }
    if (event.item_id !== item.id) invalid();
    if (item.type === 'function_call') {
      if (item.argumentsDone) invalid();
      if (event.type === 'response.function_call_arguments.delta') item.arguments += text(event.delta, 16000);
      else if (event.type !== 'response.function_call_arguments.done' || event.arguments !== item.arguments) invalid();
      else item.argumentsDone = true;
      if (item.arguments.length > 16000 || item.arguments.includes(this.credential)) invalid(); return;
    }
    if (item.type === 'reasoning' && /^response\.reasoning_(?:summary_)?(?:part|text)\.(?:added|delta|done)$/u.test(String(event.type))) return;
    if (item.type !== 'message') invalid();
    const contentIndex = count(event.content_index), part = item.parts.get(contentIndex);
    if (event.type === 'response.content_part.added') {
      const value = object(event.part);
      if (part || contentIndex !== item.parts.size || [...item.parts.values()].some(value => !value.closed)
        || contentIndex >= 32 || value.type !== 'output_text' || value.text !== '') invalid();
      item.parts.set(contentIndex, { text: '', done: false, closed: false }); return;
    }
    if (!part || part.closed) return invalid();
    if (event.type === 'response.output_text.delta' && !part.done) {
      const delta = text(event.delta); part.text += delta; this.accumulated += delta;
    } else if (event.type === 'response.output_text.done' && !part.done && event.text === part.text) part.done = true;
    else if (event.type === 'response.content_part.done' && part.done && object(event.part).type === 'output_text' && object(event.part).text === part.text) part.closed = true;
    else invalid();
  }
  private messages(event: ObjectValue) {
    if (event.type === 'ping') return;
    if (event.type === 'message_start') {
      const message = object(event.message);
      if (this.started || message.type !== 'message' || message.role !== 'assistant' || list(message.content).length || message.stop_reason != null) invalid();
      this.id = text(message.id, 128); this.startUsage = object(message.usage);
      const initial = protocolUsage(this.protocol, this.startUsage)!; this.outputTokens = initial.outputTokens;
      this.started = true; return;
    }
    if (!this.started) invalid();
    if (event.type === 'message_delta') {
      if (this.closed.size !== this.blocks.length) invalid();
      this.messageDelta = true;
      const delta = object(event.delta), usage = object(event.usage);
      const output = count(usage.output_tokens); if (output < this.outputTokens) invalid();
      // Input counts are original request counters; later usage may repeat but
      // must not silently change the input/cache accounting dimensions.
      for (const key of ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
        if (usage[key] !== undefined && count(usage[key]) !== (this.startUsage![key] ?? 0)) invalid();
      }
      this.outputTokens = output;
      if (delta.stop_sequence != null) invalid();
      if (delta.stop_reason != null) {
        if (this.stopReason !== undefined) invalid();
        this.stopReason = delta.stop_reason;
      }
      return;
    }
    if (event.type === 'message_stop') {
      if (this.stopReason === undefined || this.closed.size !== this.blocks.length) invalid();
      this.usage = protocolUsage(this.protocol, { ...this.startUsage, output_tokens: this.outputTokens });
      const message = { id: this.id, type: 'message', role: 'assistant', content: this.blocks,
        stop_reason: this.stopReason, usage: { ...this.startUsage, output_tokens: this.outputTokens } };
      responseContent(this.protocol, message); this.final = message; this.stopped = true; return;
    }
    if (this.stopReason !== undefined || this.messageDelta) invalid();
    const index = count(event.index), block = this.blocks[index];
    if (event.type === 'content_block_start') {
      const value = object(event.content_block);
      if (index !== this.blocks.length || index >= 32 || this.closed.size !== this.blocks.length || !['text', 'tool_use'].includes(String(value.type))) invalid();
      if (value.type === 'text') { text(value.text); this.accumulated += value.text; this.blocks.push({ type: 'text', text: value.text }); }
      else {
        if (!this.policy.tools) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        if (Object.keys(object(value.input)).length) invalid();
        this.blocks.push({ type: 'tool_use', id: text(value.id, 128), name: text(value.name, 64), input: {}, arguments: '' });
      }
      return;
    }
    if (!block || this.closed.has(index)) return invalid();
    if (event.type === 'content_block_stop') {
      if (block.type === 'tool_use') {
        block.input = JSON.parse(String(block.arguments || '{}')); delete block.arguments; object(block.input);
      }
      this.closed.add(index); return;
    }
    if (event.type !== 'content_block_delta') invalid();
    const delta = object(event.delta);
    if (block.type === 'text' && delta.type === 'text_delta') {
      const value = text(delta.text); block.text = String(block.text) + value; this.accumulated += value;
    } else if (block.type === 'tool_use' && delta.type === 'input_json_delta') {
      block.arguments = String(block.arguments) + text(delta.partial_json, 16000);
      if (String(block.arguments).length > 16000 || String(block.arguments).includes(this.credential)) invalid();
    } else invalid();
  }
  finish(): AdapterResult {
    try {
      this.pending += this.decoder.decode();
      if (this.failed || !this.stopped || !this.final || this.pending.trim()) invalid();
      return completed(this.protocol, this.final, this.policy, this.credential);
    } catch (error) { this.failed = true; throw error instanceof ModelGatewayError ? error : new ModelGatewayError('INVALID_RESPONSE'); }
  }
}

export type NativeMessagesOptions = ChatProtocolOptions & { mediaInput?: readonly ('image' | 'audio')[] };
abstract class NativeMessagesAdapter implements ModelAdapter {
  abstract readonly provider: Protocol;
  private readonly policy: ChatProtocolPolicy; private readonly images: boolean;
  get evidenceMode(): 'live' | 'mock' { return modelEgressEvidence(this.transport); }
  get structuredSchemaHash() { return this.policy.structuredSchemaHash; }
  get features(): readonly ModelFeature[] {
    return [...(this.images ? ['image' as const] : []), ...(this.transport.postStream ? ['streaming' as const] : []),
      ...(this.policy.tools ? ['tools' as const] : []), ...(this.policy.structured ? ['structuredOutput' as const] : [])];
  }
  constructor(private readonly transport: ModelJsonTransport, options: NativeMessagesOptions = {}) {
    if (!transport || typeof transport.post !== 'function' || !options || typeof options !== 'object' || Array.isArray(options)) throw new ModelGatewayError('CONFIG_INVALID');
    const { mediaInput, ...policy } = options;
    const media = z.array(z.enum(['image', 'audio'])).max(2).refine(values => new Set(values).size === values.length).safeParse(mediaInput ?? []);
    if (!media.success) throw new ModelGatewayError('CONFIG_INVALID');
    // These two wire implementations support images, not WAV transcription.
    // Never advertise audio just because Chat Completions supports it.
    this.images = media.data.includes('image'); this.policy = new ChatProtocolPolicy(policy);
  }
  inputBoundHash(input: Readonly<ModelProtocolRequest>, stream: boolean) {
    if (this.provider !== 'anthropic_messages') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const parsed = modelProtocolRequestSchema.parse(structuredClone(input));
    return messagesGenerationInputHash(this.body(parsed, this.policy.selected(parsed.features ?? []), stream));
  }
  private prepare(value: ModelProtocolInvocation, credential: string, connection: Readonly<{ baseUrl: string }> | undefined, stream: boolean) {
    if (!value?.signal || typeof value.signal.addEventListener !== 'function' || typeof value.signal.removeEventListener !== 'function'
      || typeof value.signal.aborted !== 'boolean' || value.recordUsage !== undefined && typeof value.recordUsage !== 'function'
      || !connection || typeof credential !== 'string' || !/^[\x21-\x7e]{1,8192}$/u.test(credential)) throw new ModelGatewayError('CONFIG_INVALID');
    const parsed = modelProtocolRequestSchema.safeParse({ callId: value.callId, model: value.model, messages: value.messages,
      maxOutputTokens: value.maxOutputTokens, features: value.features,
      ...(value.structuredSchemaHash !== undefined ? { structuredSchemaHash: value.structuredSchemaHash } : {}) });
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = parsed.data, features = input.features ?? [];
    if (features.some(feature => !this.features.includes(feature)) || !stream && features.includes('streaming')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    if (input.structuredSchemaHash && (!features.includes('structuredOutput') || input.structuredSchemaHash !== this.structuredSchemaHash)) throw new ModelGatewayError('CONFIG_INVALID');
    const policy = this.policy.selected(features), body = this.body(input, policy, stream);
    if (value.expectedInputBoundHash !== undefined && (this.provider !== 'anthropic_messages'
      || messagesGenerationInputHash(body) !== value.expectedInputBoundHash)) throw new ModelGatewayError('CONFIG_INVALID');
    if (Buffer.byteLength(body) > MODEL_REQUEST_BYTES) throw new ModelGatewayError('INVALID_REQUEST');
    const base = normalizeTenantModelBaseUrl(connection.baseUrl);
    // Both accept a versioned base; Messages also accepts the API root. Never
    // append /v1 twice or accept a request-selected arbitrary endpoint.
    const url = this.provider === 'openai_responses' ? `${base}/responses` : `${base}${new URL(base).pathname.endsWith('/v1') ? '' : '/v1'}/messages`;
    const headers: Readonly<Record<string, string>> = this.provider === 'openai_responses'
      ? { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }
      : { 'x-api-key': credential, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
    return { input, policy, signal: value.signal, recordUsage: value.recordUsage,
      request: { url, body, headers,
      signal: value.signal, maxResponseBytes: MODEL_RESPONSE_BYTES, redirects: 'error' as const } };
  }
  private body(input: ModelProtocolRequest, policy: ChatProtocolPolicy, stream: boolean) {
    const supplied = policy.body(input.features ?? []);
    const tool = (supplied.tools as Array<{ function: { name: string; parameters: unknown; strict: boolean } }> | undefined)?.[0]?.function;
    const output = (supplied.response_format as { json_schema: { name: string; schema: unknown; strict: boolean } } | undefined)?.json_schema;
    if (this.provider === 'openai_responses') return JSON.stringify({ model: input.model, stream, store: false,
      max_output_tokens: input.maxOutputTokens, input: input.messages.map(message => ({ role: message.role,
        content: typeof message.content === 'string' ? message.content : message.content.map(part => part.kind === 'text'
          ? { type: 'input_text', text: part.text } : part.kind === 'image'
            ? { type: 'input_image', image_url: `data:${part.mediaType};base64,${part.data}` } : invalid()) })),
      ...(tool ? { tools: [{ type: 'function', ...tool }], parallel_tool_calls: false } : {}),
      ...(output ? { text: { format: { type: 'json_schema', ...output } } } : {}) });
    // Messages system instructions belong before the conversation. Moving later
    // system messages to the front would change the registered input's meaning.
    let conversation = false; const system: string[] = [], messages: unknown[] = [];
    for (const message of input.messages) {
      if (message.role === 'system') {
        if (conversation || typeof message.content !== 'string') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        system.push(message.content); continue;
      }
      conversation = true;
      messages.push({ role: message.role, content: typeof message.content === 'string' ? message.content
        : message.content.map(part => part.kind === 'text' ? { type: 'text', text: part.text }
          : part.kind === 'image' ? { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.data } } : invalid()) });
    }
    if (!messages.length) throw new ModelGatewayError('INVALID_REQUEST');
    return JSON.stringify({ model: input.model, stream, max_tokens: input.maxOutputTokens, messages,
      ...(system.length ? { system: system.map(value => ({ type: 'text', text: value })) } : {}),
      ...(tool ? { tools: [{ name: tool.name, input_schema: tool.parameters, strict: true }],
        tool_choice: { type: 'auto', disable_parallel_tool_use: true } } : {}),
      ...(output ? { output_config: { format: { type: 'json_schema', schema: output.schema } } } : {}) });
  }
  private status(status: number) {
    if (status === 401 || status === 403) throw new ModelAdapterError('AUTHENTICATION_FAILED');
    if (status === 429) throw new ModelAdapterError('RATE_LIMITED');
    if (status !== 200) throw new ModelAdapterError('PROVIDER_FAILED');
  }
  async generate(value: ModelProtocolInvocation, credential: string, connection?: Readonly<{ baseUrl: string }>): Promise<AdapterResult> {
    const prepared = this.prepare(value, credential, connection, false);
    if (prepared.signal.aborted) throw new ModelGatewayError('CANCELLED');
    const result = await this.transport.post(prepared.request); this.status(result.status);
    if (typeof result.body !== 'string' || Buffer.byteLength(result.body) > MODEL_RESPONSE_BYTES) invalid();
    let raw: unknown; try { raw = JSON.parse(result.body); } catch { return invalid(); }
    const usage = protocolUsage(this.provider, object(raw).usage);
    if (usage) await prepared.recordUsage?.(usage);
    if (prepared.signal.aborted) throw new ModelGatewayError('CANCELLED');
    return completed(this.provider, raw, prepared.policy, credential);
  }
  async *stream(value: ModelProtocolInvocation, credential: string, connection?: Readonly<{ baseUrl: string }>): AsyncIterable<AdapterStreamEvent> {
    if (!this.transport.postStream) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const prepared = this.prepare(value, credential, connection, true), decoder = new NativeMessageStream(this.provider, prepared.policy, credential);
    let headers = false, recorded = false;
    const record = async () => { const usage = decoder.accountingUsage(); if (usage && !recorded) { recorded = true; await prepared.recordUsage?.(usage); } };
    if (prepared.signal.aborted) throw new ModelGatewayError('CANCELLED');
    for await (const event of this.transport.postStream(prepared.request)) {
      if (event.kind === 'headers') { if (headers) invalid(); headers = true; this.status(event.status); }
      else {
        if (!headers) invalid();
        let delta: string;
        try { delta = decoder.push(event.bytes); } catch (error) { await record(); throw error; }
        await record();
        if (prepared.signal.aborted) throw new ModelGatewayError('CANCELLED');
        if (delta) yield { kind: 'text_delta', delta };
      }
    }
    if (!headers) invalid();
    await record(); if (prepared.signal.aborted) throw new ModelGatewayError('CANCELLED');
    yield { kind: 'result', result: decoder.finish() };
  }
}
export class ResponsesAdapter extends NativeMessagesAdapter { readonly provider = 'openai_responses' as const; }
export class AnthropicMessagesAdapter extends NativeMessagesAdapter { readonly provider = 'anthropic_messages' as const; }
