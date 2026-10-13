import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export const AUDIO_PROBE_METHOD = 'audio-pulse-groups-1';
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);

/** Versioned server-only PCM challenge. No uploaded media, storage, TTS,
 * provider-specific types or guessed transcription. The waveform is integer
 * generated so re-reading an original operation produces identical bytes.
 * Passing proves this bounded audio-input challenge, not speech accuracy. */
export function audioCapabilityChallenge(operationId: string, scopeId: string) {
  id.parse(operationId); id.max(36).parse(scopeId);
  const key = requestFingerprint({ method: AUDIO_PROBE_METHOD, scopeId, operationId });
  const groups = Array.from({ length: 16 }, (_, index) => parseInt(key.slice(index * 2, index * 2 + 2), 16) % 4 + 1);
  const toneSamples = 1280, gapSamples = 640, groupSamples = 2880;
  const samples = groups.reduce((total, count) => total + count * (toneSamples + gapSamples) + groupSamples, 0);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0, 'ascii'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii'); bytes.writeUInt32LE(samples * 2, 40);
  let offset = 0;
  for (const count of groups) {
    for (let pulse = 0; pulse < count; pulse++) {
      for (let sample = 0; sample < toneSamples; sample++) bytes.writeInt16LE(sample % 16 < 8 ? 8192 : -8192, 44 + (offset + sample) * 2);
      offset += toneSamples + gapSamples;
    }
    offset += groupSamples;
  }
  return { attachmentId: `probe-audio-${key}`, attachmentRevision: 1, mediaType: 'audio/wav' as const,
    contentHash: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length,
    bytes: new Uint8Array(bytes), expected: groups.join(' ') };
}
