/** 原营运场景的 Task 事务接点。可信持久请求决定资源，当前 Auth/所选 Core
 * 先于 Order/Workspace、原请求及 Task；不创建第二笔事务或复制业务/额度算法。
 * 已有 Task 沿 task-center 的同一参加者，保证继续及 Gateway 准入验证同一来源。
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import { resolveUserBusinessLocationScope } from '@rental-os/rental-core/business-location-scope';
import { createRentalAuthorization } from '@rental-os/rental-core/http-auth';
import { assertRentalBusinessTenantAccessAfterLock, hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import * as contracts from '@rental-os/shared';
import { requestFingerprint } from '../rental-adapters/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { originalIdentityHash, type AiSceneCreationRule } from '../task-request/original-request.authority';
import { originalBody, originalRequestReferenceSchema, parseOriginalRequest } from '../task-request/original-request.validation';
import { withAiTaskTransactionAuthority } from '../task-transaction-authority';
import { withTaskCenterTransactions, type TaskCenterTransactionDependencies } from '../task-center-transactions';

export interface OriginalSceneTransactionDependencies extends TaskCenterTransactionDependencies {}
interface OriginalSceneTransactionInput {
  db: PrismaClient;
  credentials: AiTaskCredentialSource;
  transactions?: OriginalSceneTransactionDependencies;
  creationRules: readonly AiSceneCreationRule[];
  clock?: () => Date;
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const permissionsFor = createRentalAuthorization(contracts).requiredPermissions;
function identityKey(value: NonNullable<ReturnType<typeof getRequestIdentity>>) {
  return hash({ tenantId: value.tenantId, workspaceId: value.workspaceId, userId: value.userId, audience: value.audience,
    accessSession: value.accessSession, isSaasAdmin: value.isSaasAdmin, isPlatformAdmin: Boolean(value.isPlatformAdmin),
    staffApi: Boolean(value.staffApi), permissions: value.permissions && [...value.permissions].sort(),
    dataScope: value.dataScope, organizationId: value.organizationId,
    locationScope: value.locationScope && { mode: value.locationScope.mode, locationIds: [...value.locationScope.locationIds].sort() } });
}

/** The reference is only a locator. An existing Task is resolved from its exact
 * persisted original input, never from a request-supplied Task/Order/Quote ID. */
export async function withOriginalSceneTaskTransactions<T>(input: OriginalSceneTransactionInput,
  value: unknown, consume: () => Promise<T>, mode: 'creation' | 'task' = 'task'): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const parsed = originalRequestReferenceSchema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const reference = parsed.data, identity = getRequestIdentity(), ports = input.transactions;
  if (!ports?.auth || typeof ports.auth.lockRequestWorkspaceAccess !== 'function'
    || typeof ports.orders?.lockOrder !== 'function' || typeof ports.orders.findOrder !== 'function') throw unavailable();
  if (!identity || identity.audience !== 'operator' || identity.staffApi || identity.isSaasAdmin !== false
    || !identity.tenantId || !identity.workspaceId || !identity.userId || !identity.accessSession
    || !identity.permissions || !identity.dataScope || !identity.locationScope) throw denied();
  const { tenantId, workspaceId, userId: ownerId } = identity;
  const originalIdentity = identityKey(identity), credential = await input.credentials.current();
  if (credential.audience !== 'operator') throw denied();
  const clock = input.clock ?? (() => new Date());
  const live = async () => {
    const current = await input.credentials.current();
    if (getRequestIdentity() !== identity || identityKey(identity) !== originalIdentity
      || current.audience !== 'operator' || current.authorization !== credential.authorization) throw denied();
  };
  const readOriginal = async (reader: Pick<PrismaClient, 'aiScope' | 'aiTaskOriginalRequest'>) => {
    await live();
    const scope = await reader.aiScope.findFirst({ where: { kind: 'WORKSPACE', tenantId, workspaceId } });
    if (!scope || scope.kind !== 'WORKSPACE' || scope.tenantId !== tenantId || scope.workspaceId !== workspaceId) throw denied();
    const row = await reader.aiTaskOriginalRequest.findFirst({ where: { id: reference.inputRef, scopeId: scope.id,
      ownerKind: 'USER', ownerId, audience: 'OPERATOR' } });
    if (!row || row.id !== reference.inputRef || row.scopeId !== scope.id || row.ownerKind !== 'USER'
      || row.ownerId !== ownerId || row.audience !== 'OPERATOR' || row.status !== 'STORED' || row.erasedAt
      || row.contractVersion !== contracts.AI_SCENE_REQUEST_DRAFT_VERSION || !Number.isSafeInteger(row.revision) || row.revision < 1) throw denied();
    const body = originalBody(parseOriginalRequest({ draftVersion: row.contractVersion, requestKey: row.requestKey,
      sceneCode: row.sceneCode, input: structuredClone(row.payload) }));
    const contentHash = requestFingerprint({ version: row.contractVersion, scopeId: row.scopeId, audience: row.audience,
      ownerKind: row.ownerKind, ownerId: row.ownerId, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
      revision: row.revision, previousInputRef: row.previousRequestId, input: body.input });
    if (contentHash !== row.contentHash) throw denied();
    await live();
    return { scope, row, body };
  };
  if (mode === 'task') {
    const original = await readOriginal(input.db);
    const task = await input.db.aiTask.findFirst({ where: { inputRef: original.row.id, scopeId: original.scope.id,
      scopeKind: 'WORKSPACE', ownerKind: 'USER', ownerId, audience: 'OPERATOR', creationKey: `scene-request:${original.row.id}`, archivedAt: null } });
    if (!task || task.inputRef !== original.row.id || task.scopeId !== original.scope.id || task.ownerKind !== 'USER'
      || task.ownerId !== ownerId || task.audience !== 'OPERATOR' || task.scopeKind !== 'WORKSPACE' || task.archivedAt !== null
      || task.creationKey !== `scene-request:${original.row.id}` || task.inputHash !== original.row.contentHash
      || task.inputRevision !== original.row.revision || task.sceneCode !== original.row.sceneCode || task.sceneVersion !== original.row.sceneVersion) throw denied();
    await live();
    // This also resolves business Step -> AiTaskActionInput -> original Quote and
    // assertQuoteReadAccess. Candidate/quote_goal fields cannot stand in for it.
    return withTaskCenterTransactions(ports, input.db, input.credentials, task.id, consume);
  }
  return withAiTaskTransactionAuthority({ binding: hash({ identity: originalIdentity, original: reference }), begin: async (tx, key) => {
    if ('$transaction' in tx || key.kind !== 'creation' || key.inputRef !== reference.inputRef) throw denied();
    // Resolve the aggregate outside Serializable before it can take an implicit
    // shared Task/input lock. The frozen row is re-read under its own lock below.
    const original = await readOriginal(input.db), originalKey = hash(original.row);
    if (key.sceneCode !== original.body.sceneCode) throw denied();
    const rule = input.creationRules.find(value => value.sceneCode === original.row.sceneCode);
    if (!rule || rule.sceneVersion !== original.row.sceneVersion || !rule.audiences.includes('operator')) throw unavailable();
    const lease = await ports.auth.lockRequestWorkspaceAccess(tx);
    const resourceRoutes = original.body.sceneCode === 'order_explanation'
      ? [`/rental/v1/orders/${original.body.input.orderId}`]
      : original.body.sceneCode === 'opening_diagnosis' ? ['/rental/v1/tenant-readiness']
        : ['/rental/v1/business-settings', ...('candidate' in original.body.input
          ? ['/rental/v1/item-groups', '/rental/v1/booking-members'] : [])];
    const current = async (user: typeof lease.user) => {
      await live();
      if (!user.isActive || user.isSaasAdmin || user.mustChangePassword || user.id !== ownerId || user.tenantId !== tenantId
        || Boolean(user.isPlatformAdmin) !== Boolean(identity.isPlatformAdmin) || user.dataScope !== identity.dataScope
        || user.organizationId !== identity.organizationId || hash([...user.permissions].sort()) !== hash([...identity.permissions!].sort())) throw denied();
      const locations = await resolveUserBusinessLocationScope(user, workspaceId, user.locationScope ?? { mode: 'all', locationIds: [] }, tx);
      if (hash({ mode: locations.mode, locationIds: [...locations.locationIds].sort() }) !== hash({
        mode: identity.locationScope!.mode, locationIds: [...identity.locationScope!.locationIds].sort() })) throw denied();
      if (rule.requiredPermissions.some(permission => !hasEffectivePermission(user.permissions, permission))) throw denied();
      for (const route of resourceRoutes) {
        const required = permissionsFor('GET', route);
        if (!required.length || !required.some(permission => hasEffectivePermission(user.permissions, permission))) throw denied();
      }
      await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
    };
    await current(lease.user);
    const orderId = original.body.sceneCode === 'order_explanation' ? original.body.input.orderId : undefined;
    if (orderId) await ports.orders.lockOrder(tenantId, orderId, tx);
    const verifyOrder = async () => {
      if (!orderId) return;
      // Original repository owns workspace/data/location visibility; do not
      // replace it with client IDs or reimplement the order visibility algorithm.
      const order = await ports.orders.findOrder(tenantId, orderId, tx);
      if (!order || order.id !== orderId || order.tenantId !== tenantId) throw denied();
    };
    await verifyOrder();
    const spaces = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM business_workspaces WHERE tenantId = ${tenantId} AND id = ${workspaceId} AND status = 'active' FOR UPDATE`);
    if (spaces.length !== 1 || spaces[0].id !== workspaceId) throw denied();
    await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_task_original_requests WHERE scopeId = ${original.scope.id} AND id = ${reference.inputRef} FOR UPDATE`);
    const verifyReference = async (reference: typeof key) => {
      if (reference.kind !== 'creation' || reference.inputRef !== original.row.id || reference.sceneCode !== original.body.sceneCode) throw denied();
      const latest = await readOriginal(tx), now = clock();
      if (hash(latest.row) !== originalKey || latest.row.creationClosedAt || latest.row.creationCloseKey
        || !(now instanceof Date) || !Number.isFinite(now.getTime()) || !(latest.row.expiresAt instanceof Date)
        || latest.row.expiresAt <= now || latest.row.authorizationBindingHash !== originalIdentityHash({
          contractVersion: contracts.AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now.toISOString(),
          audience: 'operator', actor: { kind: 'user', userId: ownerId }, scope: { kind: 'workspace', tenantId, workspaceId },
          access: { permissions: [...identity.permissions!], dataScope: identity.dataScope!, locationScope: identity.locationScope!.mode === 'all'
            ? { mode: 'all', locationIds: [] } : { mode: 'selected', locationIds: [...identity.locationScope!.locationIds] },
            ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) }
        })) throw denied();
      await verifyOrder();
    };
    await verifyReference(key);
    return { verifyReference, revalidate: async () => { await current(await lease.revalidate()); await verifyReference(key); } };
  } }, consume);
}
