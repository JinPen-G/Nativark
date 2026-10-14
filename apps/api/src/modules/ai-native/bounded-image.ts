/** Bounded PNG/JPEG container and dimension inspection, shared by attachment
 * ingestion and model protocol validation. This does not decode pixels, prove
 * attachment authority, remove metadata, or attest a provider capability. */
export function inspectBoundedImage(value: Uint8Array): {
  mediaType: 'image/png' | 'image/jpeg'; width: number; height: number
} | null {
  if (!(value instanceof Uint8Array) || value.byteLength < 4 || value.byteLength > 20 * 1024 * 1024) return null;
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  const dimensions = (mediaType: 'image/png' | 'image/jpeg', width: number, height: number) =>
    width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 40000000
      ? { mediaType, width, height } : null;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8, chunks = 0, width = 0, height = 0, data = false, dataEnded = false, palette = false, color = -1;
    while (offset < bytes.length) {
      if (++chunks > 1024 || offset + 12 > bytes.length) return null;
      const size = bytes.readUInt32BE(offset), start = offset + 8, end = start + size;
      if (end + 4 > bytes.length) return null;
      if (!bytes.subarray(offset + 4, offset + 8).every(byte => byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122)) return null;
      const kind = bytes.toString('ascii', offset + 4, offset + 8);
      if (kind[2] !== kind[2].toUpperCase() || chunks === 1 && kind !== 'IHDR') return null;
      if (kind === 'IHDR') {
        if (chunks !== 1 || size !== 13) return null;
        width = bytes.readUInt32BE(start); height = bytes.readUInt32BE(start + 4);
        const depth = bytes[start + 8]; color = bytes[start + 9];
        const depths: Record<number, readonly number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        if (!dimensions('image/png', width, height) || !depths[color]?.includes(depth)
          || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] > 1) return null;
      } else if (kind === 'PLTE') {
        if (palette || data || [0, 4].includes(color) || !size || size > 768 || size % 3) return null;
        palette = true;
      } else if (kind === 'IDAT') {
        if (dataEnded || color === 3 && !palette) return null;
        data = data || size > 0;
      } else if (kind === 'IEND') {
        return size === 0 && data && end + 4 === bytes.length ? dimensions('image/png', width, height) : null;
      } else {
        // Unknown critical chunks are unsupported, not silently interpreted.
        if (kind[0] === kind[0].toUpperCase()) return null;
        if (data) dataEnded = true;
      }
      offset = end + 4;
    }
    return null;
  }
  if (bytes[0] !== 255 || bytes[1] !== 216) return null;
  let offset = 2, segments = 0, width = 0, height = 0, components = 0, scan = false, entropy = false;
  while (offset < bytes.length) {
    if (entropy) {
      while (offset < bytes.length && bytes[offset] !== 255) offset++;
      if (offset >= bytes.length) return null;
      let next = offset + 1;
      while (next < bytes.length && bytes[next] === 255) next++;
      if (next >= bytes.length) return null;
      if (bytes[next] === 0 || bytes[next] >= 208 && bytes[next] <= 215) { offset = next + 1; continue; }
      entropy = false;
    }
    if (++segments > 1024 || bytes[offset++] !== 255) return null;
    while (offset < bytes.length && bytes[offset] === 255) offset++;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 217) return scan && offset === bytes.length ? dimensions('image/jpeg', width, height) : null;
    if (marker === 216 || marker === 0 || marker === 1 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) return null;
    const size = bytes.readUInt16BE(offset), end = offset + size;
    if (size < 2 || end > bytes.length) return null;
    if ([192, 193, 194].includes(marker)) {
      if (width || scan || size < 11 || bytes[offset + 2] !== 8) return null;
      height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); components = bytes[offset + 7];
      if (![1, 3, 4].includes(components) || size !== 8 + 3 * components || !dimensions('image/jpeg', width, height)) return null;
    } else if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) return null;
    else if (marker === 218) {
      if (!width || size < 8 || !bytes[offset + 2] || bytes[offset + 2] > components || size !== 6 + 2 * bytes[offset + 2]) return null;
      scan = true; entropy = true;
    }
    offset = end;
  }
  return null;
}
