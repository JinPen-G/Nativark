/** 客户原资料、Task 与模型续程的同事务参加者。原 ClientAuth/Tenant/Core 先于
 * 本人 Order、渠道发布、资料和 Task；不创建事务、不提供营运权限、不重发 unknown。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma, PrismaClient } from '@prisma/client';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { ClientAuthService } from '@rental-os/rental-core/mysql-client-auth';
import type { ClientRequestContext } from '@rental-os/rental-core/client-context';
import type { RentalCoreFactRepository } from '@rental-os/rental-core/mysql-core-facts';
import { clientOwnsRentalOrder } from '@rental-os/rental-core/client-order-ownership';
import { assertRentalBusinessTenantAccessAfterLock, hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { holdAiTaskDeploymentAdmission, withAiTaskTransactionAuthority, type AiTaskTransactionReference } from '../task-transaction-authority';
import { TASK_TEXT_MODEL_TOOL } from '../model-input/task-model-input';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiClientPolicyAuthority, type AiClientTaskDependencies } from './client-task.authority';
import { originalClientMaterialScope, PrismaClientSceneMaterialRepository, type AiClientMaterialDb,
  type AiClientMaterialScope, type AiClientSceneMaterial } from './prisma-client-scene-material.repository';
import { PrismaClientTaskInputRepository, type AiClientTaskInput } from './prisma-client-task-input.repository';
import { revalidateClientGoalMaterial, validateClientGoalMaterial, type ClientGoalSources } from './client-goal-material';

export interface ClientSelectedTransactionDependencies {
  clientAuth: Pick<ClientAuthService, 'lockCurrentSession'>;
  orders: Pick<RentalCoreFactRepository<Prisma.TransactionClient>, 'lockOrder' | 'findOrder'>;
}
interface ClientSelectedBinding {
  db: AiClientMaterialDb;
  transactions?: ClientSelectedTransactionDependencies;
  tasks?: AiClientTaskDependencies;
  identity: ClientRequestContext;
  channel: AiClientMaterialScope['channel'];
  appId?: string;
  bindingHash: string;
  publicationHash: string;
  assertCurrent(): Promise<void>;
  /** The standard host compares the exact original publication using this tx. */
  revalidatePublication?(tx: Prisma.TransactionClient): Promise<void>;
  /** Original guarded catalogue/help and current own booking identities. */
  goalSources?(): Promise<ClientGoalSources>;
  clock(): Date;
}
type Scope = { active: boolean; input: ClientSelectedBinding; identity: NonNullable<ReturnType<typeof getRequestIdentity>>;
  identityHash: string; clientHash: string; materialScope: AiClientMaterialScope };
const scopes = new AsyncLocalStorage<Scope>();
type QuoteMaterialScope = { active: boolean; owner: Scope; materialHash: string;
  verify(tx: Prisma.TransactionClient): Promise<void> };
const quoteMaterials = new AsyncLocalStorage<QuoteMaterialScope>();
type BookingTransactionScope = { active: boolean; owner: Scope; transaction: Prisma.TransactionClient };
const bookingTransactions = new AsyncLocalStorage<BookingTransactionScope>();
type BookingMaterialScope = QuoteMaterialScope & { transaction?: Prisma.TransactionClient };
const bookingMaterials = new AsyncLocalStorage<BookingMaterialScope>();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const sameScope = (actual: AiClientMaterialScope, expected: AiClientMaterialScope) =>
  (['tenantId', 'workspaceId', 'channel', 'principalKind', 'principalHash'] as const).every(key => actual[key] === expected[key]);

function current(scope: Scope) {
  const { identity, input } = scope;
  if (!scope.active || scopes.getStore() !== scope || getRequestIdentity() !== identity
    || hash(identity) !== scope.identityHash || hash(input.identity) !== scope.clientHash
    || identity.audience !== 'client' || identity.tenantId !== input.identity.tenantId
    || identity.workspaceId !== input.identity.workspaceId || identity.userId !== input.identity.customerId
    || identity.isSaasAdmin !== false || identity.staffApi || identity.isPlatformAdmin || identity.accessSession
    || identity.permissions !== undefined || identity.dataScope !== undefined || identity.locationScope !== undefined
    || input.identity.membershipStatus !== 'active') throw denied();
}

export async function withClientSelectedTransactions<T>(input: ClientSelectedBinding, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const identity = getRequestIdentity();
  if (!identity) throw denied();
  const parent = scopes.getStore();
  if (parent) {
    current(parent);
    // Nested original readers repeat ClientAuth and return an equivalent client
    // projection. The owning ALS object remains exact; a copied or changed
    // request store is still rejected by current(parent).
    if (parent.input.db !== input.db || parent.clientHash !== hash(input.identity)
      || parent.input.transactions !== input.transactions || parent.input.tasks !== input.tasks
      || parent.input.channel !== input.channel || parent.input.appId !== input.appId
      || parent.input.publicationHash !== input.publicationHash
      || parent.input.bindingHash !== input.bindingHash) throw denied();
    return consume();
  }
  const scope: Scope = { active: true, input, identity, identityHash: hash(identity), clientHash: hash(input.identity),
    materialScope: originalClientMaterialScope(input.identity, input.channel, input.appId) };
  return scopes.run(scope, async () => {
    try { current(scope); return await consume(); }
    finally { scope.active = false; }
  });
}

function selected(db: AiClientMaterialDb) {
  const scope = scopes.getStore();
  if (!scope || scope.input.db !== db) throw denied();
  current(scope);
  return scope;
}

async function beginPrincipal(scope: Scope, tx: Prisma.TransactionClient,
  purpose: 'new_work' | 'original_recovery' = 'new_work') {
  const { input } = scope;
  current(scope);
  if ('$transaction' in tx || typeof input.transactions?.clientAuth?.lockCurrentSession !== 'function'
    || typeof input.revalidatePublication !== 'function') throw unavailable();
  const lease = await input.transactions.clientAuth.lockCurrentSession(tx, input.identity);
  const revalidate = async () => {
    current(scope);
    if (hash(await lease.revalidate()) !== scope.clientHash) throw denied();
    await assertRentalBusinessTenantAccessAfterLock(tx, input.identity.tenantId);
    current(scope);
  };
  await revalidate();
  await holdAiTaskDeploymentAdmission(tx, purpose === 'original_recovery' ? 'task_control' : 'new_work');
  return { revalidate };
}

async function begin(scope: Scope, tx: Prisma.TransactionClient, material: AiClientSceneMaterial, stored: boolean,
  purpose: 'new_work' | 'original_recovery' = 'new_work') {
  const { input, materialScope } = scope, ports = input.transactions;
  current(scope);
  if ('$transaction' in tx || typeof ports?.clientAuth?.lockCurrentSession !== 'function'
    || typeof ports.orders?.lockOrder !== 'function' || typeof ports.orders.findOrder !== 'function'
    || typeof input.revalidatePublication !== 'function') throw unavailable();
  if (!sameScope(material, materialScope) || material.bindingHash !== input.bindingHash
    || material.publicationHash !== input.publicationHash) throw denied();
  const command = material.command;
  if (!command || typeof command !== 'object' || !('kind' in command)) throw unavailable();
  let orderId: string | undefined;
  if (command.kind === 'order') {
    if (!('orderId' in command) || typeof command.orderId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(command.orderId)) throw unavailable();
    orderId = command.orderId;
  } else if (command.kind === 'client_goal') {
    const goal = validateClientGoalMaterial(material);
    if (goal.binding.tenantId !== materialScope.tenantId || goal.binding.workspaceId !== materialScope.workspaceId
      || goal.binding.principalHash !== materialScope.principalHash || goal.binding.channel !== input.channel
      || goal.binding.appId !== (input.appId ?? null) || goal.context.tenantCode !== input.identity.tenantCode
      || goal.context.serviceCode !== input.identity.workspaceCode || goal.context.categoryCode !== input.identity.categoryCode)
      throw denied();
    if (purpose === 'new_work' && typeof input.goalSources !== 'function') throw unavailable();
  } else throw unavailable();
  // No AI/current-data read precedes this original session's Tenant X lock.
  // Serializable reads are locking current reads, never a prior RR snapshot.
  // 原恢复只核同一持久 Run/Step/Plan，不取得新步骤或派发能力；实际新工作才要求 accepting。
  const principal = await beginPrincipal(scope, tx, purpose);
  if (orderId) await ports.orders.lockOrder(material.tenantId, orderId, tx);
  const resource = async () => {
    if (orderId) {
      const order = await ports.orders.findOrder(material.tenantId, orderId, tx);
      // The original repository resolves the current workspace from this same
      // Guard store; its public Order does not expose a second workspace field.
      if (!order || order.id !== orderId || !clientOwnsRentalOrder(input.identity, order)) throw denied();
    } else if (purpose === 'new_work') {
      // Tenant X fences catalogue/configuration and membership writers. Read
      // through the original client ports while held, and again before commit.
      // Recovery retains the frozen goal even after public choices have changed.
      revalidateClientGoalMaterial(material, await input.goalSources!());
    }
    await input.revalidatePublication!(tx);
    current(scope);
  };
  await resource();
  const materialKey = hash(material), repository = new PrismaClientSceneMaterialRepository(input.db);
  const verifyMaterial = async () => {
    if (!stored) return;
    const latest = await repository.findOperation(materialScope, material.operationKey, tx, true);
    if (!latest || hash(latest) !== materialKey) throw denied();
  };
  await verifyMaterial();
  return { revalidate: async () => { await principal.revalidate(); await resource(); await verifyMaterial(); } };
}

/** Bind one original prequote/confirmation-attempt save. Its historical scope
 * differs from Task materials; only the original quote composition validates
 * that scope, source, parameters and independent policy inside this callback. */
export async function withClientSelectedQuoteMaterial<T>(db: AiClientMaterialDb, material: AiClientSceneMaterial,
  identity: ClientRequestContext, verify: (tx: Prisma.TransactionClient) => Promise<void>, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const owner = selected(db), command = material.command;
  if (quoteMaterials.getStore() || hash(identity) !== owner.clientHash || typeof verify !== 'function'
    || !command || typeof command !== 'object' || !('kind' in command)
    || !['quote_preparation', 'quote_confirmation_attempt'].includes(String(command.kind))
    || material.tenantId !== identity.tenantId || material.workspaceId !== identity.workspaceId
    || material.channel !== owner.input.channel || material.principalKind !== identity.customerType
    || material.bindingHash !== requestFingerprint(identity)) throw denied();
  const scope: QuoteMaterialScope = { active: true, owner, materialHash: hash(material), verify };
  return quoteMaterials.run(scope, async () => {
    try { return await consume(); }
    finally { scope.active = false; }
  });
}

/** One original Booking transaction, before its Draft/source locks. The
 * application binds its exact material, policy and handoff; only this active
 * transaction can also save that page's acceptance or submission attempt. */
export async function withClientSelectedBookingTransaction<T>(db: AiClientMaterialDb, tx: Prisma.TransactionClient,
  verify: (() => Promise<void>) | undefined, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  if (!verify || bookingTransactions.getStore()) throw unavailable();
  const owner = selected(db), principal = await beginPrincipal(owner, tx);
  const scope: BookingTransactionScope = { active: true, owner, transaction: tx };
  return bookingTransactions.run(scope, async () => {
    try {
      await owner.input.revalidatePublication!(tx); await verify();
      const result = await consume();
      await principal.revalidate(); await owner.input.revalidatePublication!(tx); await verify();
      return result;
    } finally { scope.active = false; }
  });
}

/** Exact server-produced Booking material only. An external save is accepted
 * solely inside the owning Draft transaction, never an arbitrary caller tx. */
export async function withClientSelectedBookingMaterial<T>(db: AiClientMaterialDb, material: AiClientSceneMaterial,
  verify: (tx: Prisma.TransactionClient) => Promise<void>, consume: () => Promise<T>, transaction?: Prisma.TransactionClient): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const owner = selected(db), booking = bookingTransactions.getStore();
  if (bookingMaterials.getStore() || quoteMaterials.getStore() || typeof verify !== 'function'
    || !sameScope(material, owner.materialScope) || material.bindingHash !== owner.input.bindingHash
    || material.publicationHash !== owner.input.publicationHash
    || transaction && (!booking?.active || booking.owner !== owner || booking.transaction !== transaction)) throw denied();
  const scope: BookingMaterialScope = { active: true, owner, materialHash: hash(material), verify, transaction };
  return bookingMaterials.run(scope, async () => {
    try { return await consume(); }
    finally { scope.active = false; }
  });
}

/** First line of the ORIGINAL material-save callback. External transactions
 * are not admitted here after another caller may already hold business locks. */
export async function withClientSelectedMaterialTransaction<T>(db: AiClientMaterialDb, tx: Prisma.TransactionClient,
  material: AiClientSceneMaterial, consume: () => Promise<T>, external = false): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const booking = bookingMaterials.getStore();
  if (booking) {
    const owner = selected(db), parent = bookingTransactions.getStore();
    if (!booking.active || booking.owner !== owner || booking.materialHash !== hash(material)
      || external !== (booking.transaction !== undefined) || external && (booking.transaction !== tx
        || !parent?.active || parent.owner !== owner || parent.transaction !== tx)) throw denied();
    const principal = external ? null : await beginPrincipal(owner, tx);
    const verify = async () => {
      current(owner);
      if (!booking.active || bookingMaterials.getStore() !== booking || booking.materialHash !== hash(material)) throw denied();
      await owner.input.revalidatePublication!(tx); await booking.verify(tx); current(owner);
    };
    await verify();
    const result = await consume();
    await principal?.revalidate(); await verify();
    return result;
  }
  if (external) throw unavailable();
  const scope = selected(db), quote = quoteMaterials.getStore();
  if (quote) {
    if (!quote.active || quote.owner !== scope || quote.materialHash !== hash(material)) throw denied();
    const principal = await beginPrincipal(scope, tx);
    const verify = async () => {
      current(scope);
      if (!quote.active || quoteMaterials.getStore() !== quote || quote.materialHash !== hash(material)) throw denied();
      await scope.input.revalidatePublication!(tx);
      await quote.verify(tx);
      current(scope);
    };
    await verify();
    const result = await consume();
    await principal.revalidate(); await verify();
    return result;
  }
  const lease = await begin(scope, tx, material, false);
  const result = await consume();
  await lease.revalidate();
  return result;
}

async function beginInput(scope: Scope, tx: Prisma.TransactionClient, row: AiClientTaskInput) {
  const { input } = scope, tasks = input.tasks;
  if (!tasks || tasks.db !== input.db || !sameScope(row, scope.materialScope)
    || row.sceneCode !== tasks.sceneCode || row.sceneVersion !== tasks.sceneVersion) throw denied();
  // Resolve the immutable locator outside Serializable; re-read under the
  // original row lock only after current Auth/Core and the owned Order.
  const material = await new PrismaClientSceneMaterialRepository(input.db).findSource(scope.materialScope, row.materialRef);
  if (!material) throw denied();
  const lease = await begin(scope, tx, material, true);
  const policy = new AiClientPolicyAuthority(tasks, tasks, 'client-selected-transaction', input.clock);
  const verify = async () => {
    current(scope);
    const grant = await policy.policy({ ...scope.materialScope, identity: input.identity }, 'create', tx, true);
    if (row.materialInputHash !== material.inputHash || row.materialHash !== material.materialHash
      || row.materialRevision !== material.revision || row.bindingHash !== material.bindingHash
      || row.policyId !== grant.id || row.policyRevision !== grant.revision
      || row.expiresAt <= input.clock() || material.expiresAt <= input.clock()) throw denied();
  };
  await verify();
  return { revalidate: async () => { await lease.revalidate(); await verify(); } };
}

/** First line of the original client-input claim, before its unique-key lock. */
export async function withClientSelectedInputTransaction<T>(db: AiClientMaterialDb, tx: Prisma.TransactionClient,
  row: AiClientTaskInput, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const scope = selected(db), lease = await beginInput(scope, tx, row);
  const result = await consume();
  await lease.revalidate();
  return result;
}

/** Only this original client creation command can enter AiTaskCreationRepository.
 * No task-center/operator authority or arbitrary Task/step/invocation is accepted. */
export async function withClientSelectedTaskCreation<T>(db: AiClientMaterialDb,
  command: { creationKey: string; materialRef: string }, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const scope = selected(db), tasks = scope.input.tasks;
  if (!tasks) throw unavailable();
  const inputs = new PrismaClientTaskInputRepository(tasks.db);
  return withAiTaskTransactionAuthority({ binding: hash({ scope: scope.materialScope, command }), begin: async (tx, reference) => {
    current(scope);
    if (reference.kind !== 'creation' || reference.sceneCode !== tasks.sceneCode) throw denied();
    const row = await inputs.findCreation(scope.materialScope, command.creationKey);
    if (!row || row.id !== reference.inputRef || row.materialRef !== command.materialRef) throw denied();
    const key = hash(row), lease = await beginInput(scope, tx, row);
    const verifyReference = async (value: typeof reference) => {
      if (value.kind !== 'creation' || value.inputRef !== row.id || value.sceneCode !== row.sceneCode) throw denied();
      const latest = await inputs.findCreation(scope.materialScope, command.creationKey, tx, true);
      if (!latest || hash(latest) !== key) throw denied();
    };
    await verifyReference(reference);
    return { verifyReference, revalidate: async () => { await lease.revalidate(); await verifyReference(reference); } };
  } }, consume);
}

/** The original client command resolves one persisted CUSTOMER Task. Policy
 * and immutable source are checked in every original runner/Gateway/input tx;
 * original recovery admits only its existing Task's bounded observation time,
 * never a new Step/Invocation or provider dispatch. */
export async function withClientSelectedOriginalTask<T>(db: AiClientTaskDependencies['db']
  & Partial<Pick<PrismaClient, 'aiStep' | 'aiTaskRunPlan'>>,
  command: { creationKey: string; materialRef: string }, operation: 'execute' | 'submit_input' | 'recover' | 'cancel',
  consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const scope = selected(db), tasks = scope.input.tasks;
  if (!tasks || tasks.db !== db || !['execute', 'submit_input', 'recover', 'cancel'].includes(operation)) throw unavailable();
  const inputs = new PrismaClientTaskInputRepository(tasks.db);
  const original = await inputs.findCreation(scope.materialScope, command.creationKey);
  if (!original || original.materialRef !== command.materialRef || original.sceneCode !== tasks.sceneCode
    || original.sceneVersion !== tasks.sceneVersion) throw denied();
  const sourceKey = hash(original), policy = new AiClientPolicyAuthority(tasks, tasks, 'client-original-task', scope.input.clock);
  const readTask = async (reader: Pick<PrismaClient, 'aiScope' | 'aiTask'>) => {
    current(scope);
    const { tenantId, workspaceId } = scope.materialScope;
    const workspace = await reader.aiScope.findFirst({ where: { kind: 'WORKSPACE', tenantId, workspaceId } });
    if (!workspace || workspace.kind !== 'WORKSPACE' || workspace.tenantId !== tenantId || workspace.workspaceId !== workspaceId) throw denied();
    const task = await reader.aiTask.findFirst({ where: { scopeId: workspace.id, scopeKind: 'WORKSPACE',
      audience: 'CLIENT', ownerKind: 'CUSTOMER', ownerId: scope.input.identity.customerId,
      creationKey: `client-material:${original.id}`, inputRef: original.id, archivedAt: null } });
    if (!task || task.scopeId !== workspace.id || task.scopeKind !== 'WORKSPACE' || task.audience !== 'CLIENT'
      || task.ownerKind !== 'CUSTOMER' || task.ownerId !== scope.input.identity.customerId || task.archivedAt !== null
      || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.creationKey !== `client-material:${original.id}`
      || task.inputRef !== original.id || task.inputRevision !== original.revision || task.inputHash !== original.inputHash
      || task.sceneCode !== original.sceneCode || task.sceneVersion !== original.sceneVersion) throw denied();
    return task;
  };
  const task = await readTask(db), owner = scope.input.identity.customerId;
  // Revision/status/fencing remain the original repositories' atomic duties.
  const taskKey = (row: typeof task) => hash({ id: row.id, scopeId: row.scopeId, scopeKind: row.scopeKind,
    audience: row.audience, ownerKind: row.ownerKind, ownerId: row.ownerId, creationKey: row.creationKey,
    contractVersion: row.contractVersion, inputRef: row.inputRef, inputRevision: row.inputRevision,
    inputHash: row.inputHash, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, archivedAt: row.archivedAt });
  const immutableTask = taskKey(task);
  // Recovery can meter its current observation, but cannot add an action or
  // successor. Preserve the original identities across every such transaction;
  // original repositories still own all status/revision/receipt transitions.
  const recoveryOrigin = async (reader: Pick<PrismaClient, 'aiRun'>
    & Partial<Pick<PrismaClient, 'aiStep' | 'aiTaskRunPlan'>>) => {
    if (!reader.aiStep || !reader.aiTaskRunPlan) throw unavailable();
    const where = { scopeId: task.scopeId, taskId: task.id };
    const runs = await reader.aiRun.findMany({ where, orderBy: { sequence: 'asc' }, take: 1001,
      select: { id: true, taskId: true, scopeId: true, sequence: true, actorKind: true, actorId: true,
        resourceOriginRunId: true, inputReceiptId: true } });
    const steps = await reader.aiStep.findMany({ where, orderBy: { id: 'asc' }, take: 1001,
      select: { id: true, taskId: true, scopeId: true, runId: true, actionId: true, requestFingerprint: true,
        inputRef: true, toolCode: true, toolVersion: true, sequence: true } });
    const plans = await reader.aiTaskRunPlan.findMany({ where, orderBy: { runId: 'asc' }, take: 1001,
      select: { taskId: true, scopeId: true, runId: true, planHash: true } });
    if (!runs.length || runs.length > 1000 || steps.length > 1000 || plans.length > 1000
      || runs.some(run => run.scopeId !== task.scopeId || run.taskId !== task.id
        || run.actorKind !== 'CUSTOMER' || run.actorId !== owner)
      || steps.some(step => step.scopeId !== task.scopeId || step.taskId !== task.id
        || step.toolCode !== TASK_TEXT_MODEL_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION
        || !runs.some(run => run.id === step.runId))
      || plans.some(plan => plan.scopeId !== task.scopeId || plan.taskId !== task.id
        || !runs.some(run => run.id === plan.runId))) throw denied();
    return hash({ runs, steps, plans });
  };
  const originalRecovery = operation === 'recover' ? await recoveryOrigin(db) : undefined;
  // Cancellation uses only the original Task control mutation. It never opens
  // Step/Invocation writes or requires a new model execution/financial grant.
  const acceptsReference = (reference: AiTaskTransactionReference) => operation === 'cancel'
    ? reference.kind === 'task_control'
    : reference.kind !== 'creation' && reference.kind !== 'task_control'
      && (operation === 'execute' || reference.kind === 'task');
  return withAiTaskTransactionAuthority({ binding: hash({ scope: scope.materialScope, command, operation }), begin: async (tx, reference) => {
    if (!acceptsReference(reference)) throw denied();
    const material = await new PrismaClientSceneMaterialRepository(db).findSource(scope.materialScope, original.materialRef);
    if (!material || material.inputHash !== original.materialInputHash || material.materialHash !== original.materialHash
      || material.revision !== original.materialRevision || material.bindingHash !== original.bindingHash) throw denied();
    const lease = await begin(scope, tx, material, true,
      operation === 'recover' || operation === 'cancel' ? 'original_recovery' : 'new_work');
    const verifyTarget = async () => {
      current(scope);
      const latestInput = await inputs.findCreation(scope.materialScope, command.creationKey, tx, true);
      if (!latestInput || hash(latestInput) !== sourceKey || taskKey(await readTask(tx)) !== immutableTask) throw denied();
      const access = await policy.policy({ ...scope.materialScope, identity: scope.input.identity },
        operation === 'recover' ? 'read' : operation, tx, true);
      if (access.id !== original.policyId) throw denied();
      if (originalRecovery !== undefined && await recoveryOrigin(tx) !== originalRecovery) throw denied();
      // The atomic answer consumer independently requires both current policies.
      if (operation === 'submit_input') await policy.policy({ ...scope.materialScope, identity: scope.input.identity }, 'resume_input', tx, true);
    };
    const verifyStep = async (stepId: string, runId?: string) => {
      const step = await tx.aiStep.findFirst({ where: { id: stepId, scopeId: task.scopeId, taskId: task.id } });
      if (!step || step.id !== stepId || step.scopeId !== task.scopeId || step.taskId !== task.id
        || runId && step.runId !== runId || step.toolCode !== TASK_TEXT_MODEL_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
      const run = await tx.aiRun.findFirst({ where: { id: step.runId, scopeId: task.scopeId, taskId: task.id,
        actorKind: 'CUSTOMER', actorId: owner } });
      if (!run || run.id !== step.runId || run.scopeId !== task.scopeId || run.taskId !== task.id
        || run.actorKind !== 'CUSTOMER' || run.actorId !== owner) throw denied();
      return step;
    };
    const verifyReference = async (key: AiTaskTransactionReference) => {
      current(scope);
      if (!acceptsReference(key) || key.kind === 'creation') throw denied();
      if (key.kind === 'task' || key.kind === 'task_control') { if (key.taskId !== task.id) throw denied(); }
      else if (key.kind === 'step') await verifyStep(key.stepId);
      else {
        const invocation = await tx.aiGatewayInvocation.findFirst({ where: { callId: key.callId, scopeId: task.scopeId,
          taskId: task.id, actorId: owner } });
        if (!invocation || invocation.callId !== key.callId || invocation.scopeId !== task.scopeId
          || invocation.taskId !== task.id || invocation.actorId !== owner) throw denied();
        const step = await verifyStep(invocation.stepId, invocation.runId);
        if (step.actionId !== invocation.actionId || step.requestFingerprint !== invocation.stepFingerprint) throw denied();
      }
      await verifyTarget();
    };
    await verifyReference(reference);
    return { verifyReference, revalidate: async () => { await lease.revalidate(); await verifyReference(reference); } };
  } }, consume);
}
