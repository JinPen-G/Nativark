import { createHash } from 'node:crypto';
import type { ReadableStreamReadResult } from 'node:stream/web';
import { InspectionAssistError } from './inspection-assist.validation';
import { inspectPcmWav } from '../pcm-wav';
import { inspectBoundedImage } from '../bounded-image';

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
  const image = inspectBoundedImage(bytes);
  if (image) return { ...image, durationMs: null };
  if (bytes.length >= 2 && (bytes[0] === 137 && bytes[1] === 80 || bytes[0] === 255 && bytes[1] === 216)) {
    throw new InspectionAssistError('INVALID_INPUT');
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') {
    const audio = inspectPcmWav(bytes);
    if (!audio) throw new InspectionAssistError('INVALID_INPUT');
    return { mediaType: 'audio/wav', width: null, height: null, durationMs: audio.durationMs };
  }
  throw new InspectionAssistError('CAPABILITY_UNSUPPORTED');
}
