/** Internal signed Web session bound to ORIGINAL current SaaS management.
 * No workspace/business authority, credentials, role tree or consent/MFA proof. */
export interface TrustedPlatformBrowserPrincipal {
  readonly userId: string;
  readonly tenantId: string;
  readonly audience: 'operator';
  readonly sessionId: string;
  readonly expiresAt: number;
}
