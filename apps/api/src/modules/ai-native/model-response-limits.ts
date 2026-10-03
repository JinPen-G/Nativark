import { ModelGatewayError } from "./model-gateway.ports";
export const MODEL_REQUEST_BYTES = 1_048_576;
export const MODEL_RESPONSE_BYTES = 1_048_576;
export const MODEL_HEADER_BYTES = 16_384;
export function modelByteLimit(value: number, maximum = MODEL_RESPONSE_BYTES) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new ModelGatewayError("CONFIG_INVALID");
  return value;
}
/** Incremental enforcement, before joining/decoding response body. */
export class ModelResponseBuffer {
  private bytes = 0;
  private readonly chunks: Buffer[] = [];
  constructor(private readonly limit: number) { modelByteLimit(limit); }
  append(value: unknown) {
    if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) throw new ModelGatewayError("INVALID_RESPONSE");
    const chunk = Buffer.from(value); this.bytes += chunk.byteLength;
    if (this.bytes > this.limit) throw new ModelGatewayError("INVALID_RESPONSE");
    this.chunks.push(chunk);
  }
  text() {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(this.chunks)); }
    catch { throw new ModelGatewayError("INVALID_RESPONSE"); }
  }
}
