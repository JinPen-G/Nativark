import { createHash } from 'node:crypto';
import type { ReadableStreamReadResult } from 'node:stream/web';
import { InspectionAssistError } from './inspection-assist.validation';

export const INSPECTION_OBJECT_READER = Symbol('INSPECTION_OBJECT_READER');
export interface InspectionObjectReader {
  open(reference: { tenantId: string; workspaceId: string; fileAssetId: string; provider: string; storageKey: string },
    signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

export async function readInspectionMedia(stream: ReadableStream<Uint8Array>, maxBytes: number, signal: AbortSignal) {
  const reader = stream.getReader(), chunks: Buffer[] = [];
  let sizeBytes = 0;
  let cancelled = false;
  let rejectRead: ((reason: Error) => void) | undefined;
  const cancel = () => {
    rejectRead?.(new InspectionAssistError('RECONCILIATION_REQUIRED'));
    if (cancelled) return;
    cancelled = true;
    // A provider cleanup promise is not a prerequisite for releasing this
    // request. Attempt it once, observe rejection, but never await forever.
    try { void reader.cancel().catch(() => undefined); } catch { /* best effort */ }
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 20 * 1024 * 1024) throw new InspectionAssistError('INVALID_INPUT');
    for (;;) {
      if (signal.aborted) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      const next = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        rejectRead = reject;
        reader.read().then(resolve, reject);
        if (signal.aborted) cancel();
      });
      rejectRead = undefined;
      if (signal.aborted) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) throw new InspectionAssistError('INVALID_INPUT');
      sizeBytes += next.value.byteLength;
      if (sizeBytes > maxBytes) throw new InspectionAssistError('INVALID_INPUT');
      chunks.push(Buffer.from(next.value));
    }
    const bytes = Buffer.concat(chunks), metadata = inspectMedia(bytes);
    return { bytes, sizeBytes, contentHash: createHash('sha256').update(bytes).digest('hex'), ...metadata };
  } finally {
    signal.removeEventListener('abort', cancel);
    rejectRead = undefined;
    cancel();
    reader.releaseLock();
  }
}

function inspectMedia(bytes: Buffer): { mediaType: string; width: number | null; height: number | null; durationMs: number | null } {
  const dimensions = (mediaType: string, width: number, height: number) => {
    if (!width || !height || width > 16384 || height > 16384 || width * height > 40000000) throw new InspectionAssistError('INVALID_INPUT');
    return { mediaType, width, height, durationMs: null };
  };
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    && bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return dimensions('image/png', bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break;
      const marker = bytes[offset + 1], length = bytes.readUInt16BE(offset + 2);
      if (marker === 218 || marker === 217 || length < 2 || offset + 2 + length > bytes.length) break;
      if ([192,193,194].includes(marker) && length >= 8) return dimensions('image/jpeg', bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5));
      offset += 2 + length;
    }
  }
  if (bytes.length >= 44 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WAVE'
    && bytes.readUInt32LE(4) + 8 === bytes.length) {
    let offset = 12, byteRate = 0, dataBytes = 0;
    while (offset + 8 <= bytes.length) {
      const size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size;
      if (end > bytes.length) throw new InspectionAssistError('INVALID_INPUT');
      const kind = bytes.toString('ascii', offset, offset + 4);
      if (kind === 'fmt ' && size >= 16 && bytes.readUInt16LE(offset + 8) === 1) {
        const channels = bytes.readUInt16LE(offset + 10), rate = bytes.readUInt32LE(offset + 12), bits = bytes.readUInt16LE(offset + 22);
        byteRate = bytes.readUInt32LE(offset + 16);
        if (![1,2].includes(channels) || ![8,16,24,32].includes(bits) || rate < 8000 || rate > 192000
          || byteRate !== rate * channels * bits / 8) throw new InspectionAssistError('INVALID_INPUT');
      }
      if (kind === 'data') dataBytes += size;
      offset = end + size % 2;
    }
    if (byteRate && dataBytes) return { mediaType: 'audio/wav', width: null, height: null, durationMs: Math.floor(dataBytes / byteRate * 1000) };
  }
  throw new InspectionAssistError('CAPABILITY_UNSUPPORTED');
}
