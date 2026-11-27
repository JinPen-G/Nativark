/** Bind the registered public Task to the original turn, current policy and
 * principal. Historical actions never inherit permission to start new work. */
import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import type { SubscriptionService } from '@rental-os/platform-server/subscription';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';
import type { AiTaskCreationAuthority, AiTaskRepositoryOperation } from '../task-persistence';
import type { AiTaskTransactionReference } from '../task-transactions';
import type { TenantGatewayBudgetGrant } from '../public-tenant-gateway';
import { PrismaSubscriptionBudgetReader } from '../runtime/budget/prisma-subscription-budget-reader';
import { BudgetError } from '../runtime/budget/budget.ports';
import { aiTaskAccessFromContext } from '../runtime/task-owner-access';
import { taskModelIdentity } from '../runtime/model-input/task-model-input-binding';
import { textProbeIntent } from '../runtime/text-capability-probe';
import type { WorkCenterConversations } from './conversations';
import { SCENE, SCENE_VERSION, creationKey, denied, owner, permission, policy, readActions, retentionMs,
  tenant, unavailable, workActions, type BoundAuthority, type Tx } from './scene';

const feature = 'ai.native.use';
const policyOps = [...readActions, ...workActions];
type TaskReader = Pick<Tx, 'aiTask' | 'aiScope'>;
type Subscriptions = Pick<SubscriptionService, 'readCategoryCommercialContext' | 'lockCategoryCommercialContext'>;

export class WorkCenterTaskAuthority {
  private readonly entitlements: PrismaSubscriptionBudgetReader;
  constructor(private readonly db: PrismaClient, private readonly subscriptions: Subscriptions, private readonly signal: AbortSignal,
    private readonly clock: () => Date) { this.entitlements = new PrismaSubscriptionBudgetReader(db, subscriptions, clock); }

  async entitlement(tenantId: string, tx?: Tx) {
    if (this.signal.aborted) throw denied();
    if (tx) await this.subscriptions.lockCategoryCommercialContext(tenantId, tx, [feature]);
    const read = tx ? await this.entitlements.readIn(tenantId, feature, tx, this.signal) : await this.entitlements.read(tenantId, feature);
    if (this.signal.aborted) throw denied();
    if (read.entitlements.length !== 1 || read.entitlements[0].code !== feature || !read.entitlements[0].available) throw unavailable();
    return read.revision;
  }

  async task(db: TaskReader, context: AiExecutionContext, taskId: string) {
    const who = await owner(db, context), access = aiTaskAccessFromContext(context, taskId, this.clock());
    const row = await db.aiTask.findFirst({ where: { ...access.where, scopeId: who.scopeId, sceneCode: SCENE, sceneVersion: SCENE_VERSION } });
    if (!row || row.id !== taskId || row.scopeId !== who.scopeId || row.ownerId !== who.ownerId || row.ownerKind !== 'USER'
      || row.scopeKind !== 'TENANT' || row.audience !== 'OPERATOR' || row.sceneCode !== SCENE || row.sceneVersion !== SCENE_VERSION || row.archivedAt
      || !row.inputRef || row.inputRevision !== 1 || !row.inputHash || row.creationKey !== creationKey(row.inputRef)) throw denied();
    return { who, access, row, inputRef: row.inputRef };
  }

  async assertTaskAction(db: TaskReader, context: AiExecutionContext, taskId: string, operation: AiTaskRepositoryOperation, tx?: Tx) {
    const { who, row, inputRef } = await this.task(db, context, taskId);
    if (!policyOps.includes(operation)) throw denied();
    if (workActions.includes(operation)) {
      const original = await (tx ?? this.db).aiTaskOriginalRequest.findFirst({ where: { id: inputRef, scopeId: who.scopeId,
        ownerId: who.ownerId, ownerKind: 'USER', audience: 'OPERATOR', sceneCode: SCENE, sceneVersion: SCENE_VERSION },
      select: { id: true, scopeId: true, ownerId: true, contentHash: true, policyHash: true, authorizationBindingHash: true,
        erasedAt: true, creationClosedAt: true, expiresAt: true, status: true } });
      if (!original || original.id !== inputRef || original.scopeId !== who.scopeId || original.ownerId !== who.ownerId
        || original.contentHash !== row.inputHash || original.authorizationBindingHash !== who.binding || original.status !== 'STORED'
        || original.erasedAt || original.creationClosedAt || original.expiresAt <= this.clock()) throw denied();
      await this.entitlement(who.tenantId, tx);
      if ((await policy(tx ?? this.db, who.scopeId, this.clock())).hash !== original.policyHash) throw denied();
    }
  }

  async assertReference(tx: Tx, context: AiExecutionContext, ref: AiTaskTransactionReference) {
    const who = await owner(tx, context);
    if (ref.kind === 'creation') {
      const row = await tx.aiTaskOriginalRequest.findFirst({ where: { id: ref.inputRef, scopeId: who.scopeId, ownerId: who.ownerId,
        audience: 'OPERATOR', ownerKind: 'USER', sceneCode: SCENE, sceneVersion: SCENE_VERSION } });
      if (ref.sceneCode !== SCENE || !row || row.id !== ref.inputRef || row.scopeId !== who.scopeId || row.ownerId !== who.ownerId
        || row.sceneCode !== SCENE || row.sceneVersion !== SCENE_VERSION || row.authorizationBindingHash !== who.binding
        || row.creationClosedAt || row.erasedAt || row.expiresAt <= this.clock()) throw denied();
      await this.entitlement(who.tenantId, tx);
      if ((await policy(tx, who.scopeId, this.clock())).hash !== row.policyHash) throw denied();
      return;
    }
    if (ref.kind === 'task' || ref.kind === 'task_control') {
      await this.task(tx, context, ref.taskId);
      return;
    }
    // Every Invocation control is anchored to the persisted original, even
    // once its current policy has been disabled. Its action chooses the grant.
    if (ref.kind === 'invocation') {
      const row = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: who.scopeId, callId: ref.callId } } });
      if (!row || row.scopeId !== who.scopeId || row.callId !== ref.callId || row.actorId !== who.ownerId || row.sceneCode !== SCENE) throw denied();
      await this.task(tx, context, row.taskId);
      return;
    }
    const row = await tx.aiStep.findFirst({ where: { id: ref.stepId, scopeId: who.scopeId } });
    if (!row || row.id !== ref.stepId || row.scopeId !== who.scopeId) throw denied();
    await this.assertTaskAction(tx, context, row.taskId, 'transition_task', tx);
  }

  async originalForTask(conversations: WorkCenterConversations, context: AiExecutionContext, taskId: string, tx?: Tx) {
    const task = await this.task(tx ?? this.db, context, taskId);
    const input = await conversations.readOriginal(task.inputRef, tx ?? this.db, task.who);
    if (input.row.contentHash !== task.row.inputHash) throw denied();
    return { ...task, input: input.payload, source: input.row };
  }

  async liveOriginal(conversations: WorkCenterConversations, scope: Awaited<ReturnType<typeof owner>>, inputRef: string, tx?: Tx) {
    const reader = tx ?? this.db;
    const { row, payload } = await conversations.readOriginal(inputRef, reader, scope);
    const current = await policy(reader, scope.scopeId, this.clock());
    if (scope.binding !== row.authorizationBindingHash || row.policyHash !== current.hash || row.policyRevision !== current.revision
      || row.creationClosedAt || row.creationCloseKey || row.expiresAt <= this.clock()) throw denied();
    const entitlementRevision = await this.entitlement(scope.tenantId, tx);
    return { row, payload, current, entitlementRevision };
  }

  creation(conversations: WorkCenterConversations, authority: BoundAuthority,
    verify: (tx: Tx, tenantId: string, input: Awaited<ReturnType<WorkCenterConversations['readOriginal']>>['payload']) => Promise<void>): AiTaskCreationAuthority {
    return { resolve: async (sceneCode, inputRef, tx) => {
      if (sceneCode !== SCENE) throw denied();
      const context = await (tx ? authority.principalOn(tx) : authority.identities.resolve());
      const scope = await owner(tx ?? this.db, context);
      const { row, payload } = await this.liveOriginal(conversations, scope, inputRef, tx);
      if (tx) await verify(tx, scope.tenantId, payload);
      return { context, creationAllowed: true, sceneCode: SCENE, sceneVersion: SCENE_VERSION,
        inputRef: row.id, inputRevision: row.revision, inputHash: row.contentHash };
    }, assertCreationOpen: async (tx, command, grant) => {
      const scope = await owner(tx, grant.context), { row } = await conversations.readOriginal(command.inputRef, tx, scope);
      if (scope.scopeId !== grant.scopeId || command.creationKey !== creationKey(row.id) || grant.inputHash !== row.contentHash) throw denied();
      await conversations.assertCreationOpen(tx, scope, row);
    }, registerActions: async (tx, created) => {
      const scope = await conversations.current(tx);
      const { row } = await conversations.readOriginal(created.inputRef, tx, scope);
      if (created.scopeId !== scope.scopeId) throw denied();
      const recentUntil = new Date(row.createdAt.getTime() + retentionMs);
      const result = await tx.aiTaskActionPolicy.createMany({ data: policyOps.map(operation => ({ scopeId: scope.scopeId,
        taskId: created.taskId, operation, revision: 1, requiredPermissions: [permission],
        expiresAt: workActions.includes(operation) ? row.expiresAt : recentUntil })) });
      if (result.count !== policyOps.length) throw unavailable();
    } };
  }

  budgetGrant(conversations: WorkCenterConversations, authority: BoundAuthority): TenantGatewayBudgetGrant {
    return async (action, context, resource, tx) => {
      const db = tx ?? this.db, scope = await owner(db, context), association = resource.association;
      if (!association || association.scope.kind !== 'tenant' || association.scope.tenantId !== scope.tenantId
        || association.config.serviceMode !== 'tenant_managed' || association.config.tenantId !== scope.tenantId) throw new BudgetError('FORBIDDEN');
      const row = await db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: scope.scopeId, callId: association.requestId } } });
      if (!row || row.scopeId !== scope.scopeId || row.actorId !== scope.ownerId || row.callId !== association.requestId || row.callId !== association.idempotencyKey
        || row.stepId !== association.stepId || row.runId !== association.runId || row.actionId !== association.actionId
        || row.sceneCode !== SCENE || row.configurationHash !== hash(association.config) || row.priceVersion !== association.priceVersion)
        throw new BudgetError('FORBIDDEN');
      const inFlight = action === 'reserve' || action === 'dispatch';
      const operation = inFlight ? 'transition_task' : 'read_step_terminal';
      const current = inFlight && tx ? await authority.actionOn(tx, row.taskId, operation) : context;
      if (taskModelIdentity(current) !== taskModelIdentity(context)) throw new BudgetError('FORBIDDEN');
      if (!tx) {
        const active = await authority.actions.resolve(row.taskId, operation);
        if (taskModelIdentity(active) !== taskModelIdentity(context)) throw new BudgetError('FORBIDDEN');
      } else if (!inFlight) {
        // Original settlement does not request the execution lease. Re-read
        // its persisted read policy on the Native already holding the subject.
        const original = await tx.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: {
          scopeId: scope.scopeId, taskId: row.taskId, operation } } });
        if (!original || original.scopeId !== scope.scopeId || original.operation !== operation || original.taskId !== row.taskId
          || original.expiresAt <= this.clock() || hash(original.requiredPermissions) !== hash([permission])) throw new BudgetError('FORBIDDEN');
      }
      const original = await this.originalForTask(conversations, current, row.taskId, tx);
      const challenge = textProbeIntent(original.input.command.operationId, scope.scopeId, 'text');
      if (row.intentHash !== challenge.intentHash || row.callId !== challenge.intent.requestId || row.configurationHash !== hash(original.input.configuration))
        throw new BudgetError('FORBIDDEN');
      const live = inFlight ? await this.liveOriginal(conversations, scope, original.inputRef, tx) : null;
      const expiresAt = live ? new Date(Math.min(row.expiresAt.getTime(), live.row.expiresAt.getTime()))
        : new Date(original.source.createdAt.getTime() + retentionMs);
      return { entitled: inFlight, expiresAt, authorizationKey: hash({ action, invocation: row.id, registration: row.registrationHash,
        binding: scope.binding, ...(live ? { policy: live.current.hash, entitlement: live.entitlementRevision } : {}) }) };
    };
  }
}
