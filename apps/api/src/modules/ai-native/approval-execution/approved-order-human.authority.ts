import type { Prisma } from '@prisma/client';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiUsageSettingsDraft } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiApprovalPrincipal } from '../ai-approval-repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { validateBudgetSettings } from '../budget/budget-settings';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { SubscriptionBudgetEntitlementAdapter } from '../budget/budget-dependency-adapters';
import type { ControlledApprovedOrderDependencies } from './controlled-approved-order.composition';
import { PersistedApprovedOrderPolicyAuthority } from './persisted-approved-order-policy.authority';
import { deniedOrder, orderContextHash } from './prisma-approved-order.source';

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const validRevision = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= 4294967294;

export class ApprovedOrderHumanAuthority {
  readonly policy: PersistedApprovedOrderPolicyAuthority;
  private readonly entitlements: SubscriptionBudgetEntitlementAdapter;
  private readonly clock: () => Date;

  constructor(private readonly d: ControlledApprovedOrderDependencies) {
    this.clock = d.clock ?? (() => new Date());
    this.policy = new PersistedApprovedOrderPolicyAuthority({ ...d, toolVersion: AI_TOOL_DRAFT_VERSION });
    this.entitlements = new SubscriptionBudgetEntitlementAdapter(new PrismaSubscriptionBudgetReader(d.db, d.subscriptions, this.clock));
  }

  async resolve(taskId: string, tx?: Prisma.TransactionClient) {
    try {
      const current = await this.policy.authorizeRead(taskId, tx), { context, scopeId } = current;
      if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
        || (context.audience !== 'operator' && context.audience !== 'staff') || !('access' in context)) throw deniedOrder();
      const db = tx ?? this.d.db, now = this.clock();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
      const task = await db.aiTask.findFirst({ where: { scopeId, id: taskId }, select: { id: true, scopeId: true,
        contractVersion: true, revision: true, sceneCode: true, sceneVersion: true, status: true, cancelRequestedAt: true } });
      if (!task || task.contractVersion !== AI_TASK_DRAFT_VERSION || !validRevision(task.revision)
        || task.sceneCode !== this.d.scene.code || task.sceneVersion !== this.d.scene.version
        || !['RUNNING', 'WAITING_CONFIRMATION'].includes(task.status) || task.cancelRequestedAt !== null) throw deniedOrder();
      const key = { scopeId, taskId, operation: 'decide_approval' };
      const policy = await db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: key }, select: {
        scopeId: true, taskId: true, operation: true, revision: true, requiredPermissions: true, expiresAt: true } });
      if (!policy || Object.entries(key).some(([k, v]) => policy[k as keyof typeof policy] !== v)
        || !validRevision(policy.revision) || !(policy.expiresAt instanceof Date) || !Number.isFinite(policy.expiresAt.getTime())
        || policy.expiresAt <= now || !Array.isArray(policy.requiredPermissions) || policy.requiredPermissions.length > 64
        || !policy.requiredPermissions.includes('rental-os:order:create')
        || policy.requiredPermissions.some(p => typeof p !== 'string' || !p || p.length > 191)
        || new Set(policy.requiredPermissions).size !== policy.requiredPermissions.length) throw unavailable();
      if (policy.requiredPermissions.some(p => typeof p !== 'string' || !context.access.permissions.includes(p))) throw deniedOrder();
      const columns = [aiPersistenceScopeColumns({ kind: 'platform' }),
        aiPersistenceScopeColumns({ kind: 'tenant', tenantId: context.scope.tenantId }), aiPersistenceScopeColumns(context.scope)];
      const gates = [];
      for (const expected of columns) {
        const scope = await db.aiScope.findFirst({ where: expected });
        if (!scope || Object.entries(expected).some(([k, v]) => scope[k as keyof typeof scope] !== v)
          || (scope.kind === 'WORKSPACE' && scope.id !== scopeId)) throw deniedOrder();
        const budgetKey = { scopeId: scope.id, scopeKind: scope.kind, sceneCode: task.sceneCode };
        const row = await db.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: budgetKey } });
        if (!row || Object.entries(budgetKey).some(([k, v]) => row[k as keyof typeof row] !== v)
          || !validRevision(row.configRevision) || row.enabled !== true) throw unavailable();
        const settings = structuredClone(row.settingsJson) as unknown as AiUsageSettingsDraft;
        validateBudgetSettings(settings);
        const settingScope = scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: context.scope.tenantId };
        if (requestFingerprint(settings.scope) !== requestFingerprint(settingScope) || settings.sceneCode !== task.sceneCode
          || !settings.allowedScenes.includes(task.sceneCode) || !settings.allowedModels.length || settings.budget.state !== 'limited'
          || settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !Object.values(settings.gates).every(g => g.enabled === true)) throw unavailable();
        gates.push({ key: budgetKey, revision: row.configRevision, settings });
      }
      const entitlement = await this.entitlements.check(context, 'ai.native.use');
      if (!entitlement.available) throw unavailable();
      const latest = await this.policy.authorizeRead(taskId, tx);
      if (latest.scopeId !== scopeId || orderContextHash(latest.context) !== orderContextHash(context) || policy.expiresAt <= this.clock()) throw deniedOrder();
      const principal: AiApprovalPrincipal = { scopeId, actorKind: 'user', actorId: context.actor.userId, audience: context.audience };
      return { context, principal, bindingHash: requestFingerprint({ identity: orderContextHash(context), task,
        policy: { ...policy, expiresAt: policy.expiresAt.toISOString() }, gates, entitlement }) };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw unavailable();
    }
  }
}
