import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(passwordHash: string, password: string) {
  const [algorithm, salt, expectedHex] = passwordHash.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateTemporaryPassword() {
  return `R!${randomBytes(9).toString("base64url")}8a`;
}

export function hashOpaqueToken(token: string) {
  return scryptSync(token, "rental-os-refresh-token", 32).toString("hex");
}
