import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export const VISION_PROBE_METHOD = 'vision-grid-1';
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const palette = [
  { name: 'RED', rgb: [255, 0, 0] }, { name: 'GREEN', rgb: [0, 255, 0] },
  { name: 'BLUE', rgb: [0, 0, 255] }, { name: 'YELLOW', rgb: [255, 255, 0] }
] as const;
function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type, 'ascii'), payload = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4), trailer = Buffer.alloc(4);
  header.writeUInt32BE(data.length); trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, payload, trailer]);
}
function canonicalDeflate(data: Buffer) {
  // One uncompressed DEFLATE block inside zlib. Avoid version-dependent
  // compression changing a persisted challenge hash across process upgrades.
  if (data.length > 65535) throw new Error('Challenge raster exceeds canonical block');
  const block = Buffer.alloc(5), checksum = Buffer.alloc(4);
  block[0] = 1; block.writeUInt16LE(data.length, 1); block.writeUInt16LE(data.length ^ 0xffff, 3);
  let first = 1, second = 0;
  for (const byte of data) { first = (first + byte) % 65521; second = (second + first) % 65521; }
  checksum.writeUInt32BE(((second << 16) | first) >>> 0);
  return Buffer.concat([Buffer.from([0x78, 0x01]), block, data, checksum]);
}

/** Immutable server challenge, not a customer upload or a general ObjectReader.
 * The answer is absent from the prompt and file metadata. No storage/network,
 * global tenant cache or random re-creation after an unknown operation. */
export function visionCapabilityChallenge(operationId: string, scopeId: string) {
  id.parse(operationId); id.max(36).parse(scopeId);
  const key = requestFingerprint({ method: VISION_PROBE_METHOD, scopeId, operationId });
  // Sixteen independently selected cells (not a trivial permutation of four
  // supplied names). Stable within this method, not an authorization secret.
  const order = Array.from({ length: 16 }, (_, index) => parseInt(key.slice(index * 2, index * 2 + 2), 16) % 4);
  const width = 64, height = 64, stride = 1 + width * 3;
  const raster = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const quadrant = Math.floor(y / 16) * 4 + Math.floor(x / 16);
    const color = palette[order[quadrant]].rgb, offset = y * stride + 1 + x * 3;
    raster[offset] = color[0]; raster[offset + 1] = color[1]; raster[offset + 2] = color[2];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', canonicalDeflate(raster)), chunk('IEND', Buffer.alloc(0))]);
  return { attachmentId: `probe-image-${key}`, attachmentRevision: 1,
    mediaType: 'image/png' as const, contentHash: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length, bytes: new Uint8Array(bytes), expected: order.map(value => palette[value].name).join(' ') };
}
