/** Operator task-center participant in the original repository transaction.
 * A Task ID only locates persisted provenance. Current Auth/Tenant and selected
 * Core precede original Order/Workspace, then the Task lock. No outer transaction,
 * Prisma proxy, new creator, runner, retry or settlement policy is installed. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import * as contracts from '@rental-os/shared';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { createRentalAuthorization } from '@rental-os/rental-core/http-auth';
import { resolveUserBusinessLocationScope } from '@rental-os/rental-core/business-location-scope';
import { assertQuoteReadAccess } from '@rental-os/rental-core/server-quote-access';
import { assertRentalBusinessTenantAccessAfterLock, hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import type { RentalAuthService } from '@rental-os/rental-core/auth-service';
import type { RentalCoreFactRepository } from '@rental-os/rental-core/mysql-core-facts';
import type { RentalBusinessFactRepository } from '@rental-os/rental-core/mysql-business-facts';
import { requestFingerprint } from './rental-adapters/rental-idempotency.repository';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { readOriginalTaskModelProvenance } from './task-request/prisma-original-request.repository';
import { originalIdentityHash } from './task-request/original-request.authority';
import { originalBody, parseOriginalRequest } from './task-request/original-request.validation';
import { holdAiTaskDeploymentAdmission, withAiTaskTransactionAuthority, type AiTaskTransactionReference } from './task-transaction-authority';

export interface TaskCenterTransactionDependencies {
  auth: Pick<RentalAuthService, 'lockRequestWorkspaceAccess'>;
  orders: Pick<RentalCoreFactRepository<Prisma.TransactionClient>, 'lockOrder' | 'findOrder'>;
  quotes?: Pick<RentalBusinessFactRepository<Prisma.TransactionClient>, 'findQuote'>;
}
export type TaskCenterTransactionDb = Pick<PrismaClient, 'aiTask' | 'aiScope' | 'aiStep' | 'aiRun' | 'aiGatewayInvocation'
  | 'aiTaskOriginalRequest' | 'aiTaskActionInput' | 'aiTaskRunPlan' | 'rentalApprovedSettingsChange'>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const routePermissions = createRentalAuthorization(contracts).requiredPermissions;
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value);
function database(db: Partial<TaskCenterTransactionDb>): db is TaskCenterTransactionDb {
  return typeof db.aiTask?.findFirst === 'function' && typeof db.aiScope?.findFirst === 'function'
    && typeof db.aiStep?.findFirst === 'function' && typeof db.aiStep?.findMany === 'function'
    && typeof db.aiRun?.findFirst === 'function' && typeof db.aiGatewayInvocation?.findFirst === 'function'
    && typeof db.aiTaskOriginalRequest?.findFirst === 'function' && typeof db.aiTaskActionInput?.findFirst === 'function'
    && typeof db.rentalApprovedSettingsChange?.findFirst === 'function';
}
type Identity = NonNullable<ReturnType<typeof getRequestIdentity>>;
function identityKey(value: Identity) {
  return hash({ tenantId: value.tenantId, workspaceId: value.workspaceId, userId: value.userId, audience: value.audience,
    accessSession: value.accessSession, isSaasAdmin: value.isSaasAdmin, isPlatformAdmin: Boolean(value.isPlatformAdmin),
    permissions: value.permissions && [...value.permissions].sort(), dataScope: value.dataScope, organizationId: value.organizationId,
    locationScope: value.locationScope && { mode: value.locationScope.mode, locationIds: [...value.locationScope.locationIds].sort() } });
}
function taskKey(task: Prisma.AiTaskGetPayload<{}>) {
  return hash({ id: task.id, scopeId: task.scopeId, scopeKind: task.scopeKind, ownerKind: task.ownerKind, ownerId: task.ownerId,
    audience: task.audience, contractVersion: task.contractVersion, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion,
    inputRef: task.inputRef, inputRevision: task.inputRevision, inputHash: task.inputHash, archivedAt: task.archivedAt });
}

/** The caller supplies only a validated task locator. Every transaction resolves
 * its own immutable source before acquiring locks. This nonlocking/root lookup
 * is repeated under the original aggregate locks, before any Task mutation;
 * Serializable's ordinary Task SELECT must not precede Order with a shared lock. */
export async function withTaskCenterTransactions<T>(dependencies: TaskCenterTransactionDependencies | undefined,
  db: Partial<TaskCenterTransactionDb>, credentials: AiTaskCredentialSource, taskId: string | undefined,
  consume: () => Promise<T>, purpose: 'new_work' | 'original_recovery' = 'new_work'): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  if (!taskId) return consume(); // Read-only collections cannot supply a transaction grant.
  if (!id(taskId) || !dependencies?.auth || typeof dependencies.auth.lockRequestWorkspaceAccess !== 'function'
    || typeof dependencies.orders?.lockOrder !== 'function' || typeof dependencies.orders.findOrder !== 'function' || !database(db)) throw unavailable();
  const identity = getRequestIdentity();
  if (!identity || identity.audience !== 'operator' || identity.staffApi || identity.isSaasAdmin !== false
    || !identity.tenantId || !identity.workspaceId || !identity.userId || !identity.accessSession
    || !identity.permissions || !identity.dataScope || !identity.locationScope) throw denied();
  const tenantId = identity.tenantId, workspaceId = identity.workspaceId, ownerId = identity.userId;
  const permissions = identity.permissions, locationScope = identity.locationScope, dataScope = identity.dataScope;
  const originalIdentity = identityKey(identity), credential = await credentials.current();
  const live = async () => {
    const current = await credentials.current();
    if (getRequestIdentity() !== identity || identityKey(identity) !== originalIdentity
      || current.authorization !== credential.authorization || current.audience !== 'operator') throw denied();
  };
  const readTask = async (reader: TaskCenterTransactionDb) => {
    const scope = await reader.aiScope.findFirst({ where: { kind: 'WORKSPACE', tenantId, workspaceId } });
    if (!scope || scope.kind !== 'WORKSPACE' || scope.tenantId !== tenantId || scope.workspaceId !== workspaceId) throw denied();
    const task = await reader.aiTask.findFirst({ where: { id: taskId, scopeId: scope.id, scopeKind: 'WORKSPACE',
      ownerKind: 'USER', ownerId, audience: 'OPERATOR', archivedAt: null } });
    if (!task || task.id !== taskId || task.scopeId !== scope.id || task.scopeKind !== 'WORKSPACE' || task.ownerKind !== 'USER'
      || task.ownerId !== ownerId || task.audience !== 'OPERATOR' || task.archivedAt !== null
      || task.contractVersion !== contracts.AI_TASK_DRAFT_VERSION) throw denied();
    return task;
  };
  const readSource = async (reader: TaskCenterTransactionDb, task: Prisma.AiTaskGetPayload<{}>) => {
    if (!task.inputRef) return null;
    const original = await reader.aiTaskOriginalRequest.findFirst({ where: { id: task.inputRef, scopeId: task.scopeId,
      ownerKind: 'USER', ownerId, audience: 'OPERATOR' } });
    if (original) {
      const provenance = await readOriginalTaskModelProvenance(reader, task);
      const body = originalBody(parseOriginalRequest({ draftVersion: original.contractVersion, requestKey: original.requestKey,
        sceneCode: original.sceneCode, input: original.payload }));
      return { kind: 'scene' as const, body, binding: provenance.bindingHash, authorizationHash: provenance.authorizationHash, expiresAt: original.expiresAt.getTime() };
    }
    // The original settings creator stores a frozen Core change as task input,
    // not an AiTaskOriginalRequest. Never reinterpret a failed scene as a change.
    if (task.sceneCode !== 'opening_diagnosis' || task.inputRevision !== 1) throw unavailable();
    const change = await reader.rentalApprovedSettingsChange.findFirst({ where: { id: task.inputRef, tenantId, workspaceId, actorId: ownerId } });
    if (!change || change.id !== task.inputRef || change.tenantId !== tenantId || change.workspaceId !== workspaceId
      || change.actorId !== ownerId || change.changeHash !== task.inputHash) throw denied();
    const { createdAt: _, changeHash, ...material } = change;
    if (requestFingerprint({ ...material, expiresAt: material.expiresAt.toISOString() }) !== changeHash) throw denied();
    return { kind: 'settings' as const, binding: hash(change), expiresAt: change.expiresAt.getTime() };
  };
  const readBusinessSteps = async (reader: TaskCenterTransactionDb, task: Prisma.AiTaskGetPayload<{}>) => {
    const steps = await reader.aiStep.findMany({ where: { scopeId: task.scopeId, taskId,
      toolCode: { in: ['rental.order.commit', 'tenant.notifications.commit'] } },
      orderBy: { id: 'asc' }, take: 101 });
    if (steps.length > 100) throw unavailable();
    const materials: Array<{ stepId: string; binding: string; quoteId?: string; changeId?: string }> = [];
    for (const step of steps) {
      if (step.scopeId !== task.scopeId || step.taskId !== taskId || !step.inputRef || step.toolVersion !== contracts.AI_TOOL_DRAFT_VERSION) throw denied();
      const run: Prisma.AiRunGetPayload<{}> | null = await reader.aiRun.findFirst({ where: { id: step.runId, taskId, scopeId: task.scopeId, actorKind: 'USER', actorId: ownerId } });
      if (!run || run.id !== step.runId || run.taskId !== taskId || run.scopeId !== task.scopeId || run.actorKind !== 'USER' || run.actorId !== ownerId) throw denied();
      if (step.toolCode === 'rental.order.commit') {
        const input: Prisma.AiTaskActionInputGetPayload<{}> | null = await reader.aiTaskActionInput.findFirst({ where: { id: step.inputRef, scopeId: task.scopeId, taskId, runId: step.runId } });
        const payload = input?.payload;
        if (!input || input.id !== step.inputRef || input.scopeId !== task.scopeId || input.taskId !== taskId || input.runId !== step.runId
          || input.toolCode !== step.toolCode || input.toolVersion !== step.toolVersion || input.fingerprint !== step.requestFingerprint
          || requestFingerprint(payload) !== input.fingerprint || !payload || typeof payload !== 'object' || Array.isArray(payload)
          || !id(payload.quoteId)) throw denied();
        materials.push({ stepId: step.id, quoteId: payload.quoteId, binding: hash(input) });
      } else if (step.toolCode === 'tenant.notifications.commit') {
        const change = await reader.rentalApprovedSettingsChange.findFirst({ where: { id: step.inputRef, tenantId, workspaceId, actorId: ownerId } });
        if (!change || change.id !== step.inputRef || change.tenantId !== tenantId || change.workspaceId !== workspaceId
          || change.actorId !== ownerId || change.changeHash !== step.requestFingerprint) throw denied();
        const { createdAt: _, changeHash, ...material } = change;
        if (requestFingerprint({ ...material, expiresAt: material.expiresAt.toISOString() }) !== changeHash) throw denied();
        materials.push({ stepId: step.id, changeId: change.id, binding: hash(change) });
      } else throw unavailable();
    }
    return materials;
  };
  // 原恢复可计量观察耗时，不能增加执行身份。仅服务端已登记的恢复调用选择此目的；
  // 每个参加事务及其提交前均核对同一 Run/Step/Plan 集合，不靠 HTTP body 放行。
  const recoveryOrigin = async (reader: TaskCenterTransactionDb) => {
    if (typeof reader.aiRun.findMany !== 'function' || typeof reader.aiTaskRunPlan?.findMany !== 'function') throw unavailable();
    const task = await readTask(reader), where = { scopeId: task.scopeId, taskId };
    const runs = await reader.aiRun.findMany({ where, orderBy: { sequence: 'asc' }, take: 1001,
      select: { id: true, taskId: true, scopeId: true, sequence: true, actorKind: true, actorId: true,
        resourceOriginRunId: true, inputReceiptId: true } });
    const steps = await reader.aiStep.findMany({ where, orderBy: { id: 'asc' }, take: 1001,
      select: { id: true, taskId: true, scopeId: true, runId: true, actionId: true, requestFingerprint: true,
        inputRef: true, toolCode: true, toolVersion: true, sequence: true } });
    const plans = await reader.aiTaskRunPlan.findMany({ where, orderBy: { runId: 'asc' }, take: 1001,
      select: { taskId: true, scopeId: true, runId: true, planHash: true } });
    if (!runs.length || runs.length > 1000 || steps.length > 1000 || plans.length > 1000
      || runs.some(run => run.scopeId !== task.scopeId || run.taskId !== taskId || run.actorKind !== 'USER' || run.actorId !== ownerId)
      || steps.some(step => step.scopeId !== task.scopeId || step.taskId !== taskId || !runs.some(run => run.id === step.runId))
      || plans.some(plan => plan.scopeId !== task.scopeId || plan.taskId !== taskId || !runs.some(run => run.id === plan.runId))) throw denied();
    return hash({ runs, steps, plans });
  };
  const originalRecovery = purpose === 'original_recovery' ? await recoveryOrigin(db) : undefined;
  const binding = hash({ identity: originalIdentity, taskId, purpose });
  return withAiTaskTransactionAuthority({ binding, begin: async (tx, reference) => {
    await live();
    if ('$transaction' in tx || reference.kind === 'creation' || originalRecovery !== undefined && reference.kind !== 'task') throw denied();
    const task = await readTask(db), source = await readSource(db, task), business = await readBusinessSteps(db, task);
    if (!source && (!business.length || task.sceneCode !== 'quote_clarification')) throw unavailable();
    const immutableTask = taskKey(task), sourceKey = hash(source);
    let needsExecutionSource = originalRecovery === undefined && reference.kind !== 'task_control';
    const assertExecutionSource = () => {
      if (source && (!Number.isFinite(source.expiresAt) || source.expiresAt <= Date.now())) throw denied();
      if (source?.kind === 'scene' && source.authorizationHash !== originalIdentityHash({
        contractVersion: contracts.AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: new Date().toISOString(),
        audience: 'operator', actor: { kind: 'user', userId: ownerId }, scope: { kind: 'workspace', tenantId, workspaceId },
        access: { permissions: [...permissions], dataScope, locationScope: locationScope.mode === 'all'
          ? { mode: 'all', locationIds: [] } : { mode: 'selected', locationIds: [...locationScope.locationIds] },
          ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) }
      })) throw denied();
    };
    const lease = await dependencies.auth.lockRequestWorkspaceAccess(tx);
    const current = async (user: typeof lease.user) => {
      await live();
      if (!user.isActive || user.isSaasAdmin || user.mustChangePassword || user.id !== ownerId || user.tenantId !== tenantId
        || Boolean(user.isPlatformAdmin) !== Boolean(identity.isPlatformAdmin) || user.dataScope !== identity.dataScope
        || user.organizationId !== identity.organizationId || hash([...user.permissions].sort()) !== hash([...permissions].sort())) throw denied();
      const locations = await resolveUserBusinessLocationScope(user, workspaceId, user.locationScope ?? { mode: 'all', locationIds: [] }, tx);
      if (hash({ mode: locations.mode, locationIds: [...locations.locationIds].sort() })
        !== hash({ mode: locationScope.mode, locationIds: [...locationScope.locationIds].sort() })) throw denied();
      await assertRentalBusinessTenantAccessAfterLock(tx, tenantId);
    };
    await current(lease.user);
    const deploymentAdmission = await holdAiTaskDeploymentAdmission(tx,
      originalRecovery !== undefined || reference.kind === 'task_control' ? 'task_control' : 'new_work');
    const route = source?.kind === 'scene' && source.body.sceneCode === 'order_explanation'
      ? '/rental/v1/orders/' + source.body.input.orderId : source?.kind === 'scene' && source.body.sceneCode === 'opening_diagnosis'
        ? '/rental/v1/tenant-readiness' : '/rental/v1/business-settings';
    const resourceRoutes = [route];
    if (source?.kind === 'scene' && source.body.sceneCode === 'quote_clarification' && 'candidate' in source.body.input) {
      // These are the original candidate reader's separate Guard permissions.
      // Candidate IDs/text remain unconfirmed input; they do not prove an existing
      // quote, stock, membership, price or eligibility. Those original readers and
      // the selected-quote creator still resolve their own material at consumption.
      resourceRoutes.push('/rental/v1/item-groups', '/rental/v1/booking-members');
    }
    for (const resourceRoute of resourceRoutes) {
      const required = routePermissions('GET', resourceRoute);
      if (!required.length || !lease.user.isPlatformAdmin && !lease.user.permissions.includes('*')
        && !required.some(code => lease.user.permissions.includes(code))) throw denied();
    }
    const orderId = source?.kind === 'scene' && source.body.sceneCode === 'order_explanation' ? source.body.input.orderId : undefined;
    if (orderId) {
      await dependencies.orders.lockOrder(tenantId, orderId, tx);
      // The original repository applies the current workspace and visibility
      // predicate in this tx; RentalOrder intentionally has no workspace field.
      const order = await dependencies.orders.findOrder(tenantId, orderId, tx);
      if (!order || order.id !== orderId || order.tenantId !== tenantId) throw denied();
    }
    // Configuration/quote readers use the original workspace aggregate. All
    // existing Order locks precede it; no task/run lock has been acquired here.
    const spaces = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM business_workspaces WHERE tenantId = ${tenantId} AND id = ${workspaceId} AND status = 'active' FOR UPDATE`);
    if (spaces.length !== 1 || spaces[0].id !== workspaceId) throw denied();
    for (const quoteId of [...new Set(business.map(row => row.quoteId).filter((value): value is string => Boolean(value)))].sort()) {
      if (!dependencies.quotes) throw unavailable();
      const quote = await dependencies.quotes.findQuote(tenantId, quoteId, tx);
      if (!quote || quote.id !== quoteId || quote.tenantId !== tenantId) throw denied();
      assertQuoteReadAccess(quote);
    }
    const verifyTarget = async () => {
      await live();
      const latest = await readTask(tx);
      if (taskKey(latest) !== immutableTask || hash(await readSource(tx, latest)) !== sourceKey
        || hash(await readBusinessSteps(tx, latest)) !== hash(business)) throw denied();
      if (originalRecovery !== undefined && await recoveryOrigin(tx) !== originalRecovery) throw denied();
    };
    const verifyReference = async (key: AiTaskTransactionReference) => {
      await live();
      if (key.kind === 'creation' || originalRecovery !== undefined && key.kind !== 'task') throw denied();
      // Stop/reject has its own original task-control policy. It cannot mint a
      // new run from expired input; nested new-work references must recheck it.
      if (originalRecovery === undefined && key.kind !== 'task_control') {
        deploymentAdmission.requireNewWork();
        needsExecutionSource = true;
      }
      if (needsExecutionSource) assertExecutionSource();
      if (key.kind === 'task' || key.kind === 'task_control') { if (key.taskId !== taskId) throw denied(); }
      else if (key.kind === 'step') {
        const step = await tx.aiStep.findFirst({ where: { id: key.stepId, scopeId: task.scopeId, taskId } });
        if (!step || step.id !== key.stepId || step.scopeId !== task.scopeId || step.taskId !== taskId) throw denied();
        const run = await tx.aiRun.findFirst({ where: { id: step.runId, scopeId: task.scopeId, taskId, actorKind: 'USER', actorId: ownerId } });
        if (!run || run.id !== step.runId || run.scopeId !== task.scopeId || run.taskId !== taskId || run.actorKind !== 'USER' || run.actorId !== ownerId) throw denied();
        if (['rental.order.commit', 'tenant.notifications.commit'].includes(step.toolCode) && !business.some(row => row.stepId === step.id)) throw denied();
      } else {
        const invocation = await tx.aiGatewayInvocation.findFirst({ where: { callId: key.callId, scopeId: task.scopeId, taskId, actorId: ownerId } });
        if (!invocation || invocation.callId !== key.callId || invocation.scopeId !== task.scopeId || invocation.taskId !== taskId || invocation.actorId !== ownerId) throw denied();
        const step = await tx.aiStep.findFirst({ where: { id: invocation.stepId, scopeId: task.scopeId, taskId, runId: invocation.runId } });
        if (!step || step.id !== invocation.stepId || step.scopeId !== task.scopeId || step.taskId !== taskId || step.runId !== invocation.runId
          || step.actionId !== invocation.actionId || step.requestFingerprint !== invocation.stepFingerprint) throw denied();
        const run = await tx.aiRun.findFirst({ where: { id: step.runId, scopeId: task.scopeId, taskId, actorKind: 'USER', actorId: ownerId } });
        if (!run || run.id !== step.runId || run.scopeId !== task.scopeId || run.taskId !== taskId || run.actorKind !== 'USER' || run.actorId !== ownerId) throw denied();
      }
      await verifyTarget();
    };
    await verifyReference(reference);
    return { verifyReference, revalidate: async () => { await current(await lease.revalidate()); await verifyReference(reference); } };
  } }, consume);
}
