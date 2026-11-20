/** Original input save/reissue participant in the repository's own transaction.
 * The real Guard identity and Auth lease precede selected Core, original orders,
 * Workspace and predecessor input. It grants no Task/quote/model execution and
 * never observes COMMIT or reauthorizes an already committed receipt. */
import type { Prisma } from '@prisma/client';
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
import type { AiOriginalRequestSaveParticipant } from '../task-request/prisma-original-request.repository';
import type { OriginalSceneTransactionDependencies } from './original-scene-transactions';
import { holdAiTaskDeploymentAdmission } from '../task-transaction-authority';

interface OriginalSceneInputTransactionDependencies {
  credentials: AiTaskCredentialSource;
  transactions?: OriginalSceneTransactionDependencies;
  creationRules: readonly AiSceneCreationRule[];
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

/** Explicit same-instance server ports, selected at save time. Legacy saves do
 * not enter this participant; missing Auth/resource ports or an expired request
 * never fall back to an unfenced selected save. */
export function createOriginalSceneInputTransactions(input: OriginalSceneInputTransactionDependencies): AiOriginalRequestSaveParticipant {
  return Object.freeze({ async begin(tx: Prisma.TransactionClient, target: Parameters<AiOriginalRequestSaveParticipant['begin']>[1]) {
    const ports = input.transactions, identity = getRequestIdentity();
    if (!hasRentalBusinessTenantFence() || '$transaction' in tx || !ports?.auth
      || typeof ports.auth.lockRequestWorkspaceAccess !== 'function'
      || typeof ports.orders?.lockOrder !== 'function' || typeof ports.orders.findOrder !== 'function'
      || typeof ports.quotes?.findQuote !== 'function') throw unavailable();
    if (!identity || identity.audience !== 'operator' || identity.staffApi || identity.isSaasAdmin !== false
      || !identity.tenantId || !identity.workspaceId || !identity.userId || !identity.accessSession
      || !identity.permissions || !identity.dataScope || !identity.locationScope) throw denied();
    const { tenantId, workspaceId, userId: ownerId, permissions, locationScope, dataScope } = identity;
    const originalIdentity = identityKey(identity), credential = await input.credentials.current();
    if (credential.audience !== 'operator') throw denied();
    const rule = input.creationRules.find(value => value.sceneCode === target.body.sceneCode);
    if (!rule || rule.sceneVersion !== target.access.sceneVersion || !rule.audiences.includes('operator')) throw unavailable();
    const accessHash = originalIdentityHash({ contractVersion: contracts.AI_CONTRACT_DRAFT_VERSION,
      requestId: credential.requestId, authorizedAt: target.access.context.authorizedAt,
      audience: 'operator', actor: { kind: 'user', userId: ownerId }, scope: { kind: 'workspace', tenantId, workspaceId },
      access: { permissions: [...permissions], dataScope, locationScope: locationScope.mode === 'all'
        ? { mode: 'all', locationIds: [] } : { mode: 'selected', locationIds: [...locationScope.locationIds] },
        ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) } });
    if (originalIdentityHash(target.access.context) !== accessHash) throw denied();
    let active = true;
    const live = async () => {
      const current = await input.credentials.current();
      if (!active || getRequestIdentity() !== identity || identityKey(identity) !== originalIdentity
        || current.audience !== 'operator' || current.authorization !== credential.authorization) throw denied();
    };
    const bodies = [target.body, ...(target.previous ? [target.previous.body] : [])];
    const routes = [...new Set(bodies.flatMap(body => body.sceneCode === 'order_explanation'
      ? [`/rental/v1/orders/${body.input.orderId}`] : body.sceneCode === 'opening_diagnosis'
        ? ['/rental/v1/tenant-readiness'] : ['/rental/v1/business-settings', ...('candidate' in body.input
          ? ['/rental/v1/item-groups', '/rental/v1/booking-members'] : [])]))];
    const orderIds = [...new Set(bodies.flatMap(body => body.sceneCode === 'order_explanation' ? [body.input.orderId] : []))].sort();
    try {
      await live();
      const lease = await ports.auth.lockRequestWorkspaceAccess(tx);
      const current = async (user: typeof lease.user) => {
        await live();
        if (!user.isActive || user.isSaasAdmin || user.mustChangePassword || user.id !== ownerId || user.tenantId !== tenantId
          || Boolean(user.isPlatformAdmin) !== Boolean(identity.isPlatformAdmin) || user.dataScope !== dataScope
          || user.organizationId !== identity.organizationId || hash([...user.permissions].sort()) !== hash([...permissions].sort())) throw denied();
        const locations = await resolveUserBusinessLocationScope(user, workspaceId, user.locationScope ?? { mode: 'all', locationIds: [] }, tx);
        if (hash({ mode: locations.mode, locationIds: [...locations.locationIds].sort() }) !== hash({
          mode: locationScope.mode, locationIds: [...locationScope.locationIds].sort() })) throw denied();
        if (rule.requiredPermissions.some(permission => !hasEffectivePermission(user.permissions, permission))) throw denied();
        for (const route of routes) {
          const required = permissionsFor('GET', route);
          if (!required.length || !required.some(permission => hasEffectivePermission(user.permissions, permission))) throw denied();
        }
        await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
        await live();
      };
      await current(lease.user);
      await holdAiTaskDeploymentAdmission(tx, 'new_work');
      for (const orderId of orderIds) await ports.orders.lockOrder(tenantId, orderId, tx);
      const resources = async () => {
        for (const orderId of orderIds) {
          const order = await ports.orders.findOrder(tenantId, orderId, tx);
          if (!order || order.id !== orderId || order.tenantId !== tenantId) throw denied();
        }
        await live();
      };
      await resources();
      // A candidate/quote_goal is not an existing quote. The original guarded
      // readers remain responsible for its facts; no candidate ID grants a quote.
      const spaces = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM business_workspaces WHERE tenantId = ${tenantId} AND id = ${workspaceId} AND status = 'active' FOR UPDATE`);
      if (spaces.length !== 1 || spaces[0].id !== workspaceId) throw denied();
      if (target.previous) await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_task_original_requests WHERE scopeId = ${target.access.scopeId} AND id = ${target.previous.inputRef} FOR UPDATE`);
      await live();
      return Object.freeze({
        async revalidate() { await live(); await resources(); await current(await lease.revalidate()); },
        close() { active = false; }
      });
    } catch (error) { active = false; throw error; }
  } });
}
