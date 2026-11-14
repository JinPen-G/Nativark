/** Portable SHA-256 of the original sorted goal request, for retaining the read
 * locator before dispatch. This hash carries no authority or secret; the server
 * still verifies current ownership and the complete persisted material. */
import { aiClientGoalPreparationRequestSchema } from './ai-client-goal-draft';

const rounds = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
const rotate = (word: number, bits: number) => word >>> bits | word << (32 - bits);

/** Matches Core requestFingerprint({version:'client-goal-1',goalText}) without
 * requiring Web Crypto, Buffer or TextEncoder in the native client host. */
export async function clientGoalTextHash(goalText: string): Promise<string> {
  const goal = aiClientGoalPreparationRequestSchema.parse({ operationKey: 'validation-only', goalText });
  const text = JSON.stringify({ goalText: goal.goalText, version: 'client-goal-1' }), bytes: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | point >>> 6, 0x80 | point & 63);
    else if (point < 0x10000) bytes.push(0xe0 | point >>> 12, 0x80 | point >>> 6 & 63, 0x80 | point & 63);
    else bytes.push(0xf0 | point >>> 18, 0x80 | point >>> 12 & 63, 0x80 | point >>> 6 & 63, 0x80 | point & 63);
  }
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0, bitLength >>> 24 & 255, bitLength >>> 16 & 255, bitLength >>> 8 & 255, bitLength & 255);
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index++) {
      const at = offset + index * 4;
      words[index] = bytes[at] << 24 | bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3];
    }
    for (let index = 16; index < 64; index++) {
      const left = words[index - 15], right = words[index - 2];
      words[index] = words[index - 16] + (rotate(left, 7) ^ rotate(left, 18) ^ left >>> 3)
        + words[index - 7] + (rotate(right, 17) ^ rotate(right, 19) ^ right >>> 10);
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const first = h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + rounds[index] + words[index];
      const second = (rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c);
      h = g; g = f; f = e; e = d + first >>> 0; d = c; c = b; b = a; a = first + second >>> 0;
    }
    for (const [index, value] of [a, b, c, d, e, f, g, h].entries()) state[index] = state[index] + value >>> 0;
  }
  return state.map(value => value.toString(16).padStart(8, '0')).join('');
}
