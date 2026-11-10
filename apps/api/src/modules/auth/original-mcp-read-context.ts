/** Callback-local MCP grant/Guard facts and optional owner-Native read callback.
 * Not identity resolution, a grant cache, goal creation or a public response.
 * Only the original authority enters after Auth/Guard; its binding and Native
 * access expire on settlement/cancel. Metadata never contains a SQL handle. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { RequestIdentity } from '../../common/request-identity';
import type { McpReadAuthorization } from '@rental-os/mcp-server' with { 'resolution-mode': 'import' };
import type { OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { VerifiedPersistentOAuthAccess } from '@rental-os/mcp-server/persistent-oauth-tokens' with { 'resolution-mode': 'import' };

export type OriginalMcpReadSubject = Readonly<Pick<RequestIdentity,
  'tenantId' | 'userId' | 'workspaceId' | 'audience' | 'permissions' | 'dataScope' | 'organizationId' | 'locationScope'>>
  & { readonly grantId: string; readonly grantRevision: number };
type VerifiedGrant = Pick<VerifiedPersistentOAuthAccess, 'grantId' | 'grantRevision'>;
type EnterReadContext = <T>(grant: VerifiedGrant, identity: RequestIdentity, signal: AbortSignal,
  consume: () => Promise<T>, native?: Prisma.TransactionClient) => Promise<T>;
export interface OriginalMcpCatalogReadContext {
  /** Capture hashes before awaiting authority. Invoke only within the original
   * Guard with its verified grant/identity and, optionally, that owner's Native.
   * This does not start, commit or attest a transaction. */
  bind(authorization: McpReadAuthorization, toolName: string, inputHash: string): EnterReadContext;
  /** Original-source metadata only. No SQL, token, input body or reusable authority. */
  current(call: OriginalMcpReadCallRef): OriginalMcpReadSubject;
  /** Internal ORIGINAL reader callback only, not a target/budget source or an MCP
   * parameter/result. Owner must await it under coherent fences; missing Native
   * rejects without global/Web fallback. Never use it to nest budget transactions
   * or reacquire an outer grant from a separate accounting transaction. */
  withReadNative?<T>(call: OriginalMcpReadCallRef, signal: AbortSignal,
    consume: (native: Prisma.TransactionClient, signal: AbortSignal) => Promise<T>): Promise<T>;
}
const fail = () => new Error('Original MCP read subject unavailable');
const authorizationHash = (a: McpReadAuthorization) => createHash('sha256').update(JSON.stringify({
  subject: a.subject, clientId: a.clientId, resource: a.resource, scopes: a.scopes,
  credentialHash: createHash('sha256').update(a.token).digest('hex'),
})).digest('hex');
function freeze(value: unknown): void {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
}

/** One original-host private context, not a process-global SQL/identity store.
 * Current metadata keeps its legacy shape. Native access is callback-bound, not
 * authorization/execution, commit evidence or a durable request/goal locator. */
export function createOriginalMcpCatalogReadContext(): OriginalMcpCatalogReadContext {
  const storage = new AsyncLocalStorage<{ subject: OriginalMcpReadSubject; toolName: string; inputHash: string;
    authorizationHash: string; active: boolean; signal: AbortSignal; native?: Prisma.TransactionClient }>();
  const active = (call: OriginalMcpReadCallRef) => {
    const entry = storage.getStore();
    if (!entry?.active || entry.signal.aborted || call.toolName !== entry.toolName || call.inputHash !== entry.inputHash
      || authorizationHash(call.authorization) !== entry.authorizationHash) throw fail();
    return entry;
  };
  return Object.freeze({
    bind(authorization: McpReadAuthorization, toolName: string, inputHash: string): EnterReadContext {
      const fingerprint = authorizationHash(authorization);
      return async <T>(grant: VerifiedGrant, identity: RequestIdentity, signal: AbortSignal, consume: () => Promise<T>, native?: Prisma.TransactionClient): Promise<T> => {
        if (signal.aborted || native !== undefined && (!native || typeof native !== 'object' || '$transaction' in native)) throw fail();
        // Project only actual Guard fields. Do not clone/freeze the owner's SQL
        // client or copy it, credentials or operationToken into public metadata.
        const subject: OriginalMcpReadSubject = structuredClone({ grantId: grant.grantId, grantRevision: grant.grantRevision,
          tenantId: identity.tenantId, userId: identity.userId,
          ...(identity.workspaceId === undefined ? {} : { workspaceId: identity.workspaceId }),
          ...(identity.audience === undefined ? {} : { audience: identity.audience }),
          ...(identity.permissions === undefined ? {} : { permissions: identity.permissions }),
          ...(identity.dataScope === undefined ? {} : { dataScope: identity.dataScope }),
          ...(identity.organizationId === undefined ? {} : { organizationId: identity.organizationId }),
          ...(identity.locationScope === undefined ? {} : { locationScope: identity.locationScope }) });
        freeze(subject);
        const lifetime = new AbortController();
        const entry = { subject, toolName, inputHash, authorizationHash: fingerprint, active: true,
          signal: AbortSignal.any([signal, lifetime.signal]), ...(native === undefined ? {} : { native }) };
        return storage.run(entry, async () => {
          try { return await consume(); }
          finally { entry.active = false; lifetime.abort(); delete entry.native; }
        });
      };
    },
    current(call: OriginalMcpReadCallRef): OriginalMcpReadSubject { return active(call).subject; },
    async withReadNative<T>(call: OriginalMcpReadCallRef, signal: AbortSignal,
      consume: (native: Prisma.TransactionClient, signal: AbortSignal) => Promise<T>): Promise<T> {
      if (signal.aborted || typeof consume !== 'function') throw fail();
      const entry = active(call);
      if (!entry.native) throw fail();
      const stop = AbortSignal.any([entry.signal, signal]);
      if (stop.aborted) throw fail();
      const result = await consume(entry.native, stop);
      if (stop.aborted || active(call) !== entry) throw fail();
      return result;
    },
  });
}
