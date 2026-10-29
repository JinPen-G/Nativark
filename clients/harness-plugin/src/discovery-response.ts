/** Read untrusted discovery bytes before handing JSON to the official SDK. */
export type ConnectionInspectionErrorCode = "invalid_configuration" | "cancelled" | "unavailable" | "untrusted_discovery";

/** Safe diagnostics: remote bodies, secrets and addresses are not included. */
export class ConnectionInspectionError extends Error {
  constructor(readonly code: ConnectionInspectionErrorCode) {
    super(`Rental MCP connection inspection: ${code}`);
    this.name = "ConnectionInspectionError";
  }
}

/** Fully read a bounded response; abort discards bytes and cancels its stream. */
export async function boundedDiscoveryResponse(response: Response, maxBytes: number, signal: AbortSignal): Promise<Response> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await response.body?.cancel();
    throw new ConnectionInspectionError("untrusted_discovery");
  }
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => {
    // A broken body may reject cancellation. Signal checks still prevent late
    // bytes from becoming a discovery result; the transport owns termination.
    void reader?.cancel().catch((_error: unknown) => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) { cancel(); throw new ConnectionInspectionError("cancelled"); }
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (signal.aborted) throw new ConnectionInspectionError("cancelled");
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) {
          await reader.cancel();
          throw new ConnectionInspectionError("untrusted_discovery");
        }
        chunks.push(value);
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, headers: response.headers });
}
