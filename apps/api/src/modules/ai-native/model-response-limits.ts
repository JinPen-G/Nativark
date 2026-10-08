import { ModelGatewayError } from "./model-gateway.ports";
export const MODEL_REQUEST_BYTES = 1_048_576;
export const MODEL_RESPONSE_BYTES = 1_048_576;
export const MODEL_HEADER_BYTES = 16_384;
export function modelByteLimit(value: number, maximum = MODEL_RESPONSE_BYTES) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new ModelGatewayError("CONFIG_INVALID");
  return value;
}
/** Shared byte accounting; check before allocating any extra copy. */
class ModelResponseCounter {
  private bytes = 0;
  constructor(private readonly limit: number) { modelByteLimit(limit); }
  protected checkedChunk(value: unknown): Uint8Array {
    if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) throw new ModelGatewayError("INVALID_RESPONSE");
    if (value.byteLength > this.limit - this.bytes) throw new ModelGatewayError("INVALID_RESPONSE");
    this.bytes += value.byteLength;
    return value;
  }
}
/** Bounded full body for ordinary JSON requests only. */
export class ModelResponseBuffer extends ModelResponseCounter {
  private readonly chunks: Buffer[] = [];
  append(value: unknown) {
    this.chunks.push(Buffer.from(this.checkedChunk(value)));
  }
  text() {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(this.chunks)); }
    catch { throw new ModelGatewayError("INVALID_RESPONSE"); }
  }
}
/** Stream transport retains only the UTF8 decoder's unfinished codepoint, not a
 * second copy of the whole body. Protocol consumers independently parse SSE. */
export class ModelResponseStreamValidator extends ModelResponseCounter {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  append(value: unknown) {
    try { this.decoder.decode(this.checkedChunk(value), { stream: true }); }
    catch { throw new ModelGatewayError('INVALID_RESPONSE'); }
  }
  text(): string {
    try { this.decoder.decode(); return ''; }
    catch { throw new ModelGatewayError('INVALID_RESPONSE'); }
  }
}
