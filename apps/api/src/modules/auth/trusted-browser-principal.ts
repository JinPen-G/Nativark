/** Original authenticated Web session binding, internal to OAuth consent owners.
 * No bearer, refresh token, role tree, MFA/CSRF assertion or completed decision.
 * The caller must retain/recheck the same session fence through its transaction. */
import type { TrustedWorkspacePrincipal } from './trusted-workspace-principal';

export interface TrustedBrowserPrincipal extends TrustedWorkspacePrincipal {
  readonly sessionId: string;
  /** Original access-token/session minimum expiry, not a new grant lifetime. */
  readonly expiresAt: number;
}
