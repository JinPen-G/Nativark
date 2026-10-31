/** S256 and request binding for an authorization code read by the original AS.
 * This checks no grant, expiry or consumption state and owns no code store. The
 * AS must call it inside its original atomic consume/issue transaction. */
import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthorizationCodeExchange } from "./oauth-token-endpoint.js";
import { OAuthTokenRequestError } from "./oauth-token-endpoint.js";
import { snapshotJsonFields } from "./json-snapshot.js";

/** Verify a presented exchange against fields of the original persisted code.
 * @param input - the transport-validated exchange supplied to the original AS.
 * @param original - code record from the AS's trusted lookup, not client data.
 * @returns no permission or reusable receipt; successful validation has no effects.
 * Throws invalid_grant for missing/malformed bindings or mismatched client,
 * resource, exact redirect URI or S256 proof, without revealing which one failed.
 * Code lookup, current grant/client policy, expiry, one-time consumption and token
 * issuance remain in the AS transaction. Failure/success does not imply rollback.
 */
export function assertAuthorizationCodeBinding(input: AuthorizationCodeExchange, original: unknown): void {
  try {
    const binding = snapshotJsonFields(original,
      ["clientId", "resource", "redirectUri", "codeChallengeMethod", "codeChallenge"],
      { stringCharacters: 2048, arrayItems: 1 });
    if (binding.clientId !== input.clientId || binding.resource !== input.resource
      || binding.redirectUri !== input.redirectUri || binding.codeChallengeMethod !== "S256"
      || typeof binding.codeChallenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(binding.codeChallenge)
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) throw new Error("Invalid binding");
    const challenge = Buffer.from(binding.codeChallenge, "base64url");
    if (challenge.length !== 32 || challenge.toString("base64url") !== binding.codeChallenge
      || !timingSafeEqual(challenge, createHash("sha256").update(input.codeVerifier, "ascii").digest())) {
      throw new Error("Invalid binding");
    }
  } catch (_error) {
    throw new OAuthTokenRequestError("invalid_grant");
  }
}
