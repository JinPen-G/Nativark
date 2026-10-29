/** MCP-resource authentication only; original Rental business authority is evaluated separately. */
export interface VerifiedResourceToken {
  /** Stable subject from the trusted issuer; not a Rental role or client-supplied actor. */
  subject: string;
  clientId: string;
  scopes: readonly string[];
  expiresAt: number;
  resource: string;
}

/** The original identity adapter owns issuer/signature, current grant and revocation checks. */
export interface ResourceTokenVerifier {
  verifyAccessToken(token: string, options?: { signal: AbortSignal }): Promise<VerifiedResourceToken>;
}

/** Distinguish an invalid credential from unavailable identity evidence without revealing either. */
export class ResourceAuthorizationError extends Error {
  constructor(readonly kind: "invalid" | "unavailable") {
    super(`Resource authorization ${kind}`);
    this.name = "ResourceAuthorizationError";
  }
}
