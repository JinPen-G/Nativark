/** Opt-in PLATFORM maintenance. Binds the original signed SaaS request and
 * selected data before using the existing erasure journal and restore receipts. */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import type { PlatformAuthService, PlatformPrincipalAuthority } from '@rental-os/platform-server';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { bindPlatformAiRequest } from './configuration/platform-ai-request';
import { PLATFORM_AI_MODEL_VIEW, PLATFORM_AI_MODEL_MANAGE } from './configuration/platform-model-settings-policy';
import { beginPlatformAiManagementTransaction, createPlatformAiManagementTransactions } from './platform-transactions';
import { AiTaskRepositoryError } from './task-errors';
import { createAiTaskBodyErasure } from './runtime/privacy/task-body-erasure';
import { PlatformRetentionOperations } from './runtime/privacy/platform-retention';

export { AiRetentionUnknown, aiRetentionReceiptSchema, aiRetentionReceiptsSchema } from './runtime/privacy/retention-receipt';
export { platformRetentionCleanupSchema } from './runtime/privacy/platform-retention';
export { AiPlatformRetentionRestoreVerifier, type AiPlatformRetentionRestorePermit } from './runtime/privacy/platform-retention-restore';
export { retentionPublicKeyHash } from './runtime/privacy/retention-restore';
export { PlatformRetentionOperations, type PlatformRetentionHost, type PlatformRetentionIdentity } from './runtime/privacy/platform-retention';
export { createAiTaskBodyErasure } from './runtime/privacy/task-body-erasure';

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, '$queryRaw'>;
const permissionKey = (user: Pick<SystemUserRow, 'permissions'>) => requestFingerprint([...user.permissions].sort());
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const erasePlatformBodies = createAiTaskBodyErasure([]).erasePlatformTaskBodies;

/** A host registers maintenance separately from ordinary AI use. Missing data,
 * expired sessions and withdrawn scope never become successful cleanup. */
export function createPublicPlatformRetention(input: {
  db: PrismaClient;
  auth: Pick<PlatformAuthService, 'resolveAccessContext'>;
  principals: Pick<PlatformPrincipalAuthority<Tx>, 'lock'>;
  assertDataAvailable(db: Reader): Promise<void>;
  clock?: () => Date;
  restoreKeyHash?: string;
}) {
  if (typeof input?.assertDataAvailable !== 'function' || typeof input.db?.$transaction !== 'function'
    || typeof input.auth?.resolveAccessContext !== 'function' || typeof input.principals?.lock !== 'function') throw denied();
  const { db, auth, principals } = input;

  return Object.freeze({ async withRequest<T>(request: { headers: { authorization?: unknown } },
    action: 'observe' | 'maintain', work: (operations: PlatformRetentionOperations) => Promise<T>, signal?: AbortSignal) {
    if (!['observe', 'maintain'].includes(action) || typeof work !== 'function') throw denied();
    const permission = action === 'maintain' ? PLATFORM_AI_MODEL_MANAGE : PLATFORM_AI_MODEL_VIEW;
    const authority = bindPlatformAiRequest(auth, request, permission, signal);
    const { resolve, assertActive, close } = authority;
    try {
      const initial = await resolve();
      if (!('permissions' in initial)) throw denied();
      const key = permissionKey(initial);
      const identity = { async resolve() {
        assertActive(); await input.assertDataAvailable(db);
        const current = await resolve();
        if (!('permissions' in current) || current.actor.userId !== initial.actor.userId || permissionKey(current) !== key) throw denied();
        return current;
      } };
      const transactions = createPlatformAiManagementTransactions<Tx>({ principalAuthority: principals, requiredPermission: permission,
        async assertDataAvailable(tx) { assertActive(); await input.assertDataAvailable(tx); assertActive(); },
        assertCurrentUser(user) { if (permissionKey(user) !== key) throw denied(); } });
      return await work(new PlatformRetentionOperations(db, identity, {
        assertSelectedIdentity(_context, writing) {
          assertActive();
          if (writing && action !== 'maintain') throw denied();
        },
        async begin(tx, actorId) {
          if (action !== 'maintain') throw denied();
          const lease = await beginPlatformAiManagementTransaction(tx, actorId, transactions);
          if (!lease.currentUser) { lease.close(); throw denied(); }
          return lease;
        }, eraseTaskBodies: erasePlatformBodies
      }, input.clock, input.restoreKeyHash));
    } finally { close(); }
  } });
}
