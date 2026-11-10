/** Original trusted Web control-plane identity, NOT MCP resource authentication.
 * Only original Auth sees the Web bearer. No URL/body identity, consent decision,
 * role copy, cookie transport, arbitrary workspace choice or model-facing result. */
import type { Prisma } from '@prisma/client';
import type { AuthService } from './auth.service';
import type { TrustedBrowserPrincipal } from './trusted-browser-principal';

export interface OriginalMcpBrowserIdentity {
  current(browser: Request, transaction: Prisma.TransactionClient, signal: AbortSignal): Promise<TrustedBrowserPrincipal | undefined>;
}
export function createOriginalMcpBrowserIdentity(auth: Pick<AuthService, 'resolveTrustedBrowserPrincipal'>): OriginalMcpBrowserIdentity {
  if (typeof auth?.resolveTrustedBrowserPrincipal !== 'function') throw new Error('Original browser identity unavailable');
  const resolve = auth.resolveTrustedBrowserPrincipal.bind(auth);
  return Object.freeze({ async current(browser: Request, transaction: Prisma.TransactionClient, signal: AbortSignal) {
    try {
      if (!(browser instanceof Request)) throw new Error('Original browser identity unavailable');
      const abort = AbortSignal.any([signal, browser.signal]);
      if (abort.aborted) throw new Error('Original browser identity unavailable');
      const value = await resolve(browser.headers.get('authorization') ?? undefined, transaction, abort);
      if (abort.aborted) throw new Error('Original browser identity unavailable');
      return value;
    } catch { throw new Error('Original browser identity unavailable'); }
  } });
}
