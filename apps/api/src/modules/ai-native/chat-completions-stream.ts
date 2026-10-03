import { z } from "zod";
import { ModelGatewayError, type AdapterResult } from "./model-gateway.ports";
const frame = z.object({ choices: z.array(z.object({ index: z.literal(0), delta: z.object({ content: z.string().nullable().optional(), role: z.literal("assistant").optional(), tool_calls: z.array(z.unknown()).optional(), refusal: z.string().nullable().optional() }), finish_reason: z.string().nullable().optional() })).max(1), usage: z.object({ prompt_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), completion_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).optional() });
/** Text-only incremental decoder. Does NOT advertise streaming support in an Adapter until wired. */
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
  constructor(private readonly credential: string, private readonly maxBytes = 1_048_576) {
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
      if (this.usage) throw new ModelGatewayError("INVALID_RESPONSE");
      this.usage = { inputTokens: value.usage.prompt_tokens, outputTokens: value.usage.completion_tokens };
    }
    if (!choice) return "";
    if (this.stopped || choice.delta.tool_calls?.length) throw new ModelGatewayError(choice.delta.tool_calls?.length ? "CAPABILITY_UNSUPPORTED" : "INVALID_RESPONSE");
    if (choice.delta.refusal || (choice.finish_reason != null && choice.finish_reason !== "stop")) throw new ModelGatewayError("INVALID_RESPONSE");
    const delta = choice.delta.content ?? "";
    this.text += delta;
    if (this.text.length > 128000 || this.text.includes(this.credential)) throw new ModelGatewayError("INVALID_RESPONSE");
    if (choice.finish_reason === "stop") this.stopped = true;
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
      return { text: this.text, usage: this.usage };
    } catch { this.failed = true; throw new ModelGatewayError("INVALID_RESPONSE"); }
  }
}
