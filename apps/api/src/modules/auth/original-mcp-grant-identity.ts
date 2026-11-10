/** Original account/workspace identity adapter for current MCP grant reads.
 * The caller's binding callback re-reads the persisted grant/admission in the same
 * native Prisma transaction. No OAuth verification, role copy, Web token or default. */
import type { Prisma } from '@prisma/client';
import type { OriginalOAuthGrantIdentity } from '@rental-os/mcp-server/prisma-oauth-grant-authority';
import type { AuthService } from './auth.service';

export function createOriginalMcpGrantIdentity(auth: Pick<AuthService, 'withTrustedWorkspacePrincipal' | 'consumeTrustedWorkspaceAccess'>): OriginalOAuthGrantIdentity<Prisma.TransactionClient> {
  if (typeof auth?.withTrustedWorkspacePrincipal !== 'function' || typeof auth.consumeTrustedWorkspaceAccess !== 'function') {
    throw new Error('Original MCP identity unavailable');
  }
  const withPrincipal = auth.withTrustedWorkspacePrincipal.bind(auth), consume = auth.consumeTrustedWorkspaceAccess.bind(auth);
  const assertCurrent: OriginalOAuthGrantIdentity<Prisma.TransactionClient>['assertCurrent'] = async (transaction, current, signal) => {
    return withPrincipal(transaction, async () => current(), signal, async resolve => {
      const ticket = await resolve();
      if (!ticket) return false;
      const original = consume(ticket);
      // Original Guard still controls each business route and data/location scope.
      // A password-reset obligation must not authorize external grant issuance.
      if (typeof original.context.user.mustChangePassword !== 'boolean') throw new Error('Original MCP identity unavailable');
      return original.context.user.mustChangePassword === false;
    });
  };
  return Object.freeze({ assertCurrent });
}
