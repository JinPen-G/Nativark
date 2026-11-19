/** Bounded PCM RIFF/WAVE inspection shared by storage and protocol ingress.
 * This is byte-format validation, never attachment authority or a live audio
 * capability proof. No codec, external process, URL or storage read occurs. */
export function inspectPcmWav(value: Uint8Array): { durationMs: number } | null {
  if (!(value instanceof Uint8Array) || value.byteLength < 44 || value.byteLength > 20 * 1024 * 1024) return null;
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  let offset = 12, chunks = 0, rate = 0, blockAlign = 0, dataBytes: number | undefined;
  while (offset < bytes.length) {
    if (++chunks > 1024 || offset + 8 > bytes.length) return null;
    const size = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + size, paddedEnd = end + size % 2;
    if (end > bytes.length || paddedEnd > bytes.length) return null;
    const kind = bytes.toString('ascii', offset, offset + 4);
    if (kind === 'fmt ') {
      // Only one unambiguous PCM format, not compressed or extensible codecs.
      if (rate || dataBytes !== undefined || ![16, 18].includes(size) || bytes.readUInt16LE(start) !== 1
        || size === 18 && bytes.readUInt16LE(start + 16) !== 0) return null;
      const channels = bytes.readUInt16LE(start + 2), sampleRate = bytes.readUInt32LE(start + 4),
        byteRate = bytes.readUInt32LE(start + 8), align = bytes.readUInt16LE(start + 12), bits = bytes.readUInt16LE(start + 14);
      if (![1, 2].includes(channels) || ![8, 16, 24, 32].includes(bits) || sampleRate < 8000 || sampleRate > 192000
        || align !== channels * bits / 8 || byteRate !== sampleRate * align) return null;
      rate = sampleRate; blockAlign = align;
    } else if (kind === 'data') {
      if (!rate || dataBytes !== undefined || !size || size % blockAlign !== 0) return null;
      dataBytes = size;
    }
    offset = paddedEnd;
  }
  if (!rate || dataBytes === undefined || offset !== bytes.length) return null;
  // Count complete frames, not a guessed bitrate or a caller-supplied duration.
  return { durationMs: Number(BigInt(dataBytes / blockAlign) * 1000n / BigInt(rate)) };
}
