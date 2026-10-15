import { z } from "zod";
import { ModelGatewayError, type AdapterResult, type ModelResponsePolicy, type ProtocolToolCall } from "./model-gateway.ports";
const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Protocol-owned counters, never an estimate or a price. Do not synthesize
 * missing usage or replace contradicting provider totals with a guessed sum. */
export const chatCompletionsUsageSchema = z.object({ prompt_tokens: tokenCount, completion_tokens: tokenCount,
  total_tokens: tokenCount.optional() }).refine(usage => usage.total_tokens === undefined
    || BigInt(usage.total_tokens) === BigInt(usage.prompt_tokens) + BigInt(usage.completion_tokens),
  'Provider token counters disagree');
const fragment = z.object({ index: z.number().int().min(0).max(7), id: z.string().min(1).max(128).optional(), type: z.literal('function').optional(), function: z.object({ name: z.string().max(64).optional(), arguments: z.string().max(16000).optional() }).strict().optional() }).strict();
const frame = z.object({ choices: z.array(z.object({ index: z.literal(0), delta: z.object({ content: z.string().nullable().optional(), role: z.literal("assistant").optional(), tool_calls: z.array(z.unknown()).max(8).optional(), refusal: z.string().nullable().optional() }), finish_reason: z.string().nullable().optional() })).max(1), usage: chatCompletionsUsageSchema.optional() });
/** Bounded incremental text/tool decoder; structured values are validated only at termination. */
export class ChatCompletionsStream {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending = "";
  private text = "";
  private emitted = 0;
  private bytes = 0;
  private done = false;
  private stopped = false;
  private failed = false;
  private usage: AdapterResult["usage"];
  private readonly calls = new Map<number, { id?: string; type?: 'function'; name: string; arguments: string }>();
  private readonly callIds = new Set<string>();
  constructor(private readonly credential: string, private readonly maxBytes = 1_048_576, private readonly policy?: ModelResponsePolicy) {
    if (!credential || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) throw new ModelGatewayError("CONFIG_INVALID");
  }
  push(chunk: Uint8Array): string[] {
    if (this.failed) throw new ModelGatewayError("INVALID_RESPONSE");
    try {
      if (!(chunk instanceof Uint8Array)) throw new Error();
      this.bytes += chunk.byteLength;
      if (this.bytes > this.maxBytes) throw new Error();
      this.pending += this.decoder.decode(chunk, { stream: true });
      const deltas: string[] = [];
      for (;;) {
        const match = /\r?\n\r?\n/u.exec(this.pending);
        if (!match) break;
        const data = this.pending.slice(0, match.index); this.pending = this.pending.slice(match.index + match[0].length);
        const delta = this.consume(data); if (delta) deltas.push(delta);
      }
      if (Buffer.byteLength(this.pending, "utf8") > 65536) throw new Error();
      return deltas;
    } catch (error) { this.failed = true; throw error instanceof ModelGatewayError ? error : new ModelGatewayError("INVALID_RESPONSE"); }
  }
  private consume(block: string): string {
    if (Buffer.byteLength(block, "utf8") > 65536) throw new ModelGatewayError("INVALID_RESPONSE");
    const lines = block.split(/\r?\n/u).filter(line => line && !line.startsWith(":"));
    if (!lines.length) return "";
    if (this.done || lines.some(line => !line.startsWith("data:"))) throw new ModelGatewayError("INVALID_RESPONSE");
    const data = lines.map(line => line.slice(5).replace(/^ /u, "")).join("\n");
    if (data === "[DONE]") {
      if (!this.stopped) throw new ModelGatewayError("INVALID_RESPONSE");
      this.done = true; return "";
    }
    const parsed = frame.safeParse(JSON.parse(data));
    if (!parsed.success) throw new ModelGatewayError("INVALID_RESPONSE");
    const value = parsed.data, choice = value.choices[0];
    if (value.usage) {
      // Only a terminal usage frame (or a valid finishing choice) attests the
      // completed response. An interim count must never settle later output.
      if (this.usage || (!this.stopped && choice?.finish_reason !== 'stop' && choice?.finish_reason !== 'tool_calls')) {
        throw new ModelGatewayError("INVALID_RESPONSE");
      }
      this.usage = { inputTokens: value.usage.prompt_tokens, outputTokens: value.usage.completion_tokens };
    }
    if (!choice) return "";
    if (this.stopped) throw new ModelGatewayError('INVALID_RESPONSE');
    if (choice.delta.tool_calls?.length) {
      if (!this.policy?.tools) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      for (const raw of choice.delta.tool_calls) {
        const parsed = fragment.safeParse(raw); if (!parsed.success) throw new ModelGatewayError('INVALID_RESPONSE');
        const delta = parsed.data, call = this.calls.get(delta.index) ?? { name: '', arguments: '' };
        if (delta.id) {
          if (call.id || this.callIds.has(delta.id) || !/^[A-Za-z0-9_-]+$/.test(delta.id)) throw new ModelGatewayError('INVALID_RESPONSE');
          call.id = delta.id; this.callIds.add(delta.id);
        }
        if (delta.type) { if (call.type) throw new ModelGatewayError('INVALID_RESPONSE'); call.type = delta.type; }
        call.name += delta.function?.name ?? ''; call.arguments += delta.function?.arguments ?? '';
        if (call.name.length > 64 || call.arguments.length > 16000 || call.arguments.includes(this.credential)) throw new ModelGatewayError('INVALID_RESPONSE');
        this.calls.set(delta.index, call);
      }
    }
    if (choice.delta.refusal || (choice.finish_reason != null && choice.finish_reason !== (this.calls.size ? 'tool_calls' : 'stop'))) throw new ModelGatewayError("INVALID_RESPONSE");
    const delta = choice.delta.content ?? "";
    this.text += delta;
    if (this.text.length > 128000 || this.text.includes(this.credential)) throw new ModelGatewayError("INVALID_RESPONSE");
    if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') this.stopped = true;
    // Structured JSON and tool arguments are withheld until complete schema validation.
    if (this.policy?.structured) return '';
    // Do not expose a possible credential prefix before the next fragmented delta
    // proves it is ordinary text. A complete echo is rejected before emission.
    let end = this.text.length;
    if (!this.stopped) for (let size = Math.min(this.credential.length - 1, this.text.length); size > 0; size--) {
      if (this.text.endsWith(this.credential.slice(0, size))) { end -= size; break; }
    }
    const safe = this.text.slice(this.emitted, end); this.emitted = end;
    return safe;
  }
  finish(): AdapterResult {
    try {
      this.pending += this.decoder.decode();
      if (this.failed || !this.done || !this.stopped || this.pending.trim()) throw new Error();
      const calls: ProtocolToolCall[] = [...this.calls.entries()].sort(([a], [b]) => a - b).map(([index, call], expected) => {
        if (index !== expected || !call.id || call.type !== 'function' || !call.name) throw new Error();
        return { id: call.id, type: call.type, function: { name: call.name, arguments: call.arguments } };
      });
      const extras = this.policy?.parse(this.text, calls) ?? {};
      if (JSON.stringify(extras).includes(this.credential)) throw new Error();
      return { text: this.text, usage: this.usage, ...extras };
    } catch { this.failed = true; throw new ModelGatewayError("INVALID_RESPONSE"); }
  }
}
