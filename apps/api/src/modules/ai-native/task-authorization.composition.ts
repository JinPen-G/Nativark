import type { Prisma, PrismaClient } from '@prisma/client';
import { AI_TASK_DRAFT_VERSION, type AiExecutionContext, type AiUsageSettingsDraft } from '@rental-os/shared';
import type { AuthService } from '../auth/auth.service';
import type { SubscriptionService } from '../subscription/subscription.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskRepository, AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepositoryAuthority } from './ai-task.repository';
import { AiTaskCurrentActionAuthority, type AiTaskCredentialSource } from './task-current-action.authority';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { PrismaTaskActionPolicySource } from './prisma-task-action-policy.source';
import { aiPersistenceScopeColumns } from './persistence-scope';
import { PrismaSubscriptionBudgetReader } from './budget/prisma-subscription-budget-reader';
import { SubscriptionBudgetEntitlementAdapter } from './budget/budget-dependency-adapters';
import { validateBudgetSettings } from './budget/budget-settings';

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const validRevision = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= 4294967294;
const identityHash = (context: AiExecutionContext) => {
  const { authorizedAt: _at, requestId: _request, ...identity } = context;
  return requestFingerprint(identity);
};
const taskSelect = { id: true, scopeId: true, scopeKind: true, scope: true, ownerKind: true, ownerId: true,
  audience: true, contractVersion: true, status: true, revision: true, sceneCode: true, sceneVersion: true, archivedAt: true, cancelRequestedAt: true } satisfies Prisma.AiTaskSelect;

export interface PersistedTaskAuthorizationDependencies {
  db: PrismaClient;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  credentials: AiTaskCredentialSource;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
  clock?: () => Date;
}

/** Explicit workspace-user assembly, never AppModule/Worker registration.
 * Task access/cleanup and new execution are separate. Every new effect must use
 * execution.authorize in addition to its existing Guard, fencing, budget and approval.
 * Stored policy rows and the real subscription catalog are required; no default
 * commercial grant, policy seeding, model selection or monetary accounting here.
 */
export function composePersistedTaskAuthorization(input: PersistedTaskAuthorizationDependencies) {
  if (typeof input?.db?.$transaction !== 'function' || typeof input.db.aiScope?.findFirst !== 'function'
    || typeof input.db.aiTask?.findFirst !== 'function' || typeof input.db.aiTaskActionPolicy?.findUnique !== 'function'
    || typeof input.db.aiBudgetPolicy?.findUnique !== 'function' || typeof input.subscriptions?.readCategoryCommercialContext !== 'function') throw unavailable();
  const { db } = input, clock = input.clock ?? (() => new Date());
  const identity = new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, clock);
  const scopes = new AiScopeRepository(db, identity, clock);
  const policies = new PrismaTaskActionPolicySource(db, scopes, clock);
  const actions = new AiTaskCurrentActionAuthority(input.auth, input.credentials, policies, clock);
  const entitlements = new SubscriptionBudgetEntitlementAdapter(new PrismaSubscriptionBudgetReader(db, input.subscriptions, clock));

  const gates = async (context: AiExecutionContext, taskScopeId: string, sceneCode: string) => {
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw denied();
    const tenantId = context.scope.tenantId;
    const columns = [aiPersistenceScopeColumns({ kind: 'platform' }), aiPersistenceScopeColumns({ kind: 'tenant', tenantId }), aiPersistenceScopeColumns(context.scope)];
    return db.$transaction(async tx => {
      const results = [];
      for (const expected of columns) {
        const scope = await tx.aiScope.findFirst({ where: expected, select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } });
        if (!scope || Object.entries(expected).some(([key, value]) => scope[key as keyof typeof scope] !== value)
          || (scope.kind === 'WORKSPACE' && scope.id !== taskScopeId)) throw denied();
        const key = { scopeId: scope.id, scopeKind: scope.kind, sceneCode };
        const row = await tx.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: key }, select: {
          id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, enabled: true, settingsJson: true
        } });
        if (!row || Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
          || !validRevision(row.configRevision) || row.enabled !== true) throw unavailable();
        const settings = structuredClone(row.settingsJson) as unknown as AiUsageSettingsDraft;
        validateBudgetSettings(settings);
        const requiredScope = scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId };
        if (requestFingerprint(settings.scope) !== requestFingerprint(requiredScope) || settings.sceneCode !== sceneCode
          || !settings.allowedScenes.includes(sceneCode) || !settings.allowedModels.length || settings.budget.state !== 'limited'
          || settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !Object.values(settings.gates).every(gate => gate.enabled === true)) throw unavailable();
        results.push({ key, id: row.id, revision: row.configRevision, settings });
      }
      return results;
    }, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
  };

  const snapshot = async (taskId: string, operation: 'claim_run' | 'transition_task') => {
    const context = await actions.resolve(taskId, operation);
    const access = aiTaskAccessFromContext(context, taskId, clock());
    const task = await db.aiTask.findFirst({ where: access.where, select: taskSelect });
    if (!task || task.id !== taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
      || task.audience !== access.audience || task.scopeKind !== access.scope.kind || task.archivedAt !== null
      || Object.entries(access.scope).some(([key, value]) => task.scope[key as keyof typeof task.scope] !== value)) {
      throw denied();
    }
    if (task.contractVersion !== AI_TASK_DRAFT_VERSION || !validRevision(task.revision) || task.cancelRequestedAt !== null || !['QUEUED', 'RUNNING'].includes(task.status)
      || (operation === 'transition_task' && task.status !== 'RUNNING')) {
      throw denied();
    }
    const enabled = await gates(context, task.scopeId, task.sceneCode);
    // This is the existing budget feature code, not a declaration that the catalog has released it.
    const entitlement = await entitlements.check(structuredClone(context), 'ai.native.use');
    if (entitlement.available !== true) throw unavailable();
    return { context, binding: requestFingerprint({ identity: identityHash(context), task, enabled, entitlement }) };
  };
  const authorize = async (taskId: string, operation: 'claim_run' | 'transition_task') => {
    try {
      const initial = await snapshot(taskId, operation), current = await snapshot(taskId, operation);
      const final = await actions.resolve(taskId, operation);
      if (initial.binding !== current.binding || identityHash(final) !== identityHash(current.context)) {
        throw denied();
      }
      return structuredClone(final);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw new AiTaskRepositoryError(error.code);
      throw unavailable();
    }
  };
  const authority: AiTaskRepositoryAuthority = {
    resolve: (taskId, operation) => operation === 'claim_run' ? authorize(taskId, 'claim_run') : actions.resolve(taskId, operation)
  };
  return Object.freeze({ scopes, authority, tasks: new AiTaskRepository(db, authority, clock),
    execution: Object.freeze({ authorize: (taskId: string) => authorize(taskId, 'transition_task') }) });
}
