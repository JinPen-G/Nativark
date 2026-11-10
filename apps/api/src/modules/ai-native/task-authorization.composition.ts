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
import { checkedTenantModelRecord } from './tenant-model-config.repository';
import { tenantModelMode, tenantModelServiceEnabled } from './model-config-compatibility';
import { aiPersistedPlanToolsSchema } from './runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';

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
 * Explicit current service settings + scene plan use the modern admission path;
 * old unconverted settings keep their three original scene policies. SaaS scene
 * gates, current action rights and the real subscription catalog remain required.
 * No commercial grant, policy seeding, model selection or monetary accounting.
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

  const gates = async (context: AiExecutionContext, taskScopeId: string, sceneCode: string, sceneVersion: string) => {
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user') throw denied();
    const tenantId = context.scope.tenantId;
    const columns = [aiPersistenceScopeColumns({ kind: 'platform' }), aiPersistenceScopeColumns({ kind: 'tenant', tenantId }), aiPersistenceScopeColumns(context.scope)];
    return db.$transaction(async tx => {
      // The current settings row selects the new admission contract. Its disabled
      // or malformed state never falls back to legacy grants. No credential is
      // decrypted, no meter policy is seeded and no Gateway is called here.
      if (typeof tx.aiTenantModelConfiguration?.findUnique !== 'function') throw unavailable();
      const configured = structuredClone(await tx.aiTenantModelConfiguration.findUnique({ where: { tenantId }, select: {
        tenantId: true, revision: true, mode: true, serviceEnabled: true, settings: true, credentialsEncrypted: true
      } }));
      const record = configured ? checkedTenantModelRecord({ tenantId: configured.tenantId,
        revision: configured.revision, mode: configured.mode,
        ...(configured.serviceEnabled !== null ? { serviceEnabled: configured.serviceEnabled } : {}),
        ...(configured.settings !== null ? { settings: configured.settings } : {}),
        ...(configured.credentialsEncrypted !== null ? { credentialsEncrypted: configured.credentialsEncrypted } : {}) }) : null;
      if (record && (record.tenantId !== tenantId || !tenantModelServiceEnabled(record))) throw unavailable();
      // Only an explicitly saved mode + service switch selects the new path.
      // An old BYOK row without that binding keeps its original three policies.
      const modern = record !== null && record.mode !== undefined && typeof record.serviceEnabled === 'boolean';
      // All six original leaves belong to this same consistent read snapshot.
      // Batch only transport, never cache across the two admission snapshots or
      // remove a policy/owner check. The fourth row detects invalid duplicates.
      const foundScopes = await tx.aiScope.findMany({ where: { OR: columns }, take: 4,
        select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } });
      if (foundScopes.length !== columns.length) throw denied();
      const currentScopes = columns.map(expected => {
        const matches = foundScopes.filter(scope => Object.entries(expected).every(([key, value]) => scope[key as keyof typeof scope] === value));
        if (matches.length !== 1 || (matches[0].kind === 'WORKSPACE' && matches[0].id !== taskScopeId)) throw denied();
        return matches[0];
      });
      const policyKeys = currentScopes.map(scope => ({ scopeId: scope.id, scopeKind: scope.kind, sceneCode }));
      const foundPolicies = await tx.aiBudgetPolicy.findMany({ where: { OR: policyKeys }, take: 4, select: {
        id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, enabled: true, settingsJson: true
      } });
      if (foundPolicies.length > policyKeys.length || foundPolicies.some(row => !policyKeys.some(key =>
        Object.entries(key).every(([name, value]) => row[name as keyof typeof row] === value)))) throw unavailable();
      const results = [];
      for (const [index, scope] of currentScopes.entries()) {
        const key = policyKeys[index];
        const matches = foundPolicies.filter(row => Object.entries(key).every(([name, value]) => row[name as keyof typeof row] === value));
        if (matches.length > 1) throw unavailable();
        const row = matches[0] ?? null;
        // New settings need only the SaaS scene policy; the tenant/workspace
        // money intersections are created later by the original locked ledger.
        // Existing legacy policies still restrict admission, never get replaced.
        if (modern && scope.kind !== 'PLATFORM' && !row) continue;
        if (!row || Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
          || !validRevision(row.configRevision)) throw unavailable();
        const settings = structuredClone(row.settingsJson) as unknown as AiUsageSettingsDraft;
        validateBudgetSettings(settings);
        const requiredScope = scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId };
        // The indexed enabled flag also includes monetary availability. BYOK
        // still obeys the explicit scene/service gates and operational limits,
        // but a zero/unconfigured platform amount is not its spending ceiling.
        const byok = modern && tenantModelMode(record) === 'tenant_managed';
        const financialOnlyStop = byok && scope.kind === 'PLATFORM' && row.enabled === false
          && (settings.budget.state === 'not_configured'
            || settings.budget.state === 'zero' && settings.budget.quantity.unit === 'money');
        if (requestFingerprint(settings.scope) !== requestFingerprint(requiredScope) || settings.sceneCode !== sceneCode
          || !settings.allowedScenes.includes(sceneCode) || !settings.allowedModels.length
          || (!byok && settings.budget.state !== 'limited') || (row.enabled !== true && !financialOnlyStop)
          || settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !Object.values(settings.gates).every(gate => gate.enabled === true)) throw unavailable();
        results.push({ key, id: row.id, revision: row.configRevision, settings });
      }
      if (!modern) return { contract: 'legacy-scene-budget', policies: results,
        configuration: record ? { tenantId, revision: record.revision, mode: tenantModelMode(record),
          enabled: tenantModelServiceEnabled(record), binding: requestFingerprint(record) } : null };
      if (tenantModelMode(record) === 'tenant_managed' && (!record.settings?.enabled || !record.credentialsEncrypted)) throw unavailable();
      const key = { scopeId: taskScopeId, sceneCode, sceneVersion };
      const plan = typeof tx.aiTaskPlanPolicy?.findFirst === 'function'
        ? structuredClone(await tx.aiTaskPlanPolicy.findFirst({ where: key })) : null;
      if (!plan || Object.entries(key).some(([name, value]) => plan[name as keyof typeof plan] !== value)
        || !validRevision(plan.revision) || plan.enabled !== true || !(plan.expiresAt instanceof Date)
        || !Number.isFinite(plan.expiresAt.getTime()) || plan.expiresAt <= clock()) throw unavailable();
      const tools = aiPersistedPlanToolsSchema.parse(plan.allowedTools);
      const limits = aiTaskRunnerLimitsSchema.parse(plan.limits);
      if (limits.maxStepMs > limits.maxTotalMs) throw unavailable();
      return { contract: 'service-plan-policy', configuration: { tenantId, revision: record.revision,
        mode: tenantModelMode(record), enabled: tenantModelServiceEnabled(record), binding: requestFingerprint(record) }, policies: results,
        plan: { ...key, revision: plan.revision, tools, limits, expiresAt: plan.expiresAt.toISOString() } };
    // Pure authorization snapshot: Serializable SELECTs acquire shared locks
    // and can block behind the caller's budget transaction's own FOR UPDATE.
    // A separate consistent non-locking read is not an atomic budget grant:
    // the caller must still validate its locked current policies.
    }, { isolationLevel: 'RepeatableRead', maxWait: 2500, timeout: 5000 });
  };

  const snapshot = async (taskId: string, operation: 'claim_run' | 'transition_task' | 'decide_approval') => {
    // Approval has its own existing persisted policy. It is not a new verb on
    // the task read/worker authority and cannot turn metadata access into write.
    const context = await actions.resolve(taskId, operation === 'decide_approval' ? 'read_metadata' : operation);
    const access = aiTaskAccessFromContext(context, taskId, clock());
    const task = await db.aiTask.findFirst({ where: access.where, select: taskSelect });
    if (!task || task.id !== taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
      || task.audience !== access.audience || task.scopeKind !== access.scope.kind || task.archivedAt !== null
      || Object.entries(access.scope).some(([key, value]) => task.scope[key as keyof typeof task.scope] !== value)) {
      throw denied();
    }
    const states = operation === 'decide_approval' ? ['RUNNING', 'WAITING_CONFIRMATION'] : ['QUEUED', 'RUNNING'];
    if (task.contractVersion !== AI_TASK_DRAFT_VERSION || !validRevision(task.revision) || task.cancelRequestedAt !== null || !states.includes(task.status)
      || (operation === 'transition_task' && task.status !== 'RUNNING')) {
      throw denied();
    }
    let approvalPolicy: unknown;
    if (operation === 'decide_approval') {
      const key = { scopeId: task.scopeId, taskId, operation: 'decide_approval' };
      const row = await db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: key } });
      if (!row || Object.entries(key).some(([name, value]) => row[name as keyof typeof row] !== value)
        || !validRevision(row.revision) || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt <= clock()
        || !Array.isArray(row.requiredPermissions) || !row.requiredPermissions.length
        || row.requiredPermissions.some(p => typeof p !== 'string' || !p || p.length > 191)) throw unavailable();
      if (!('access' in context) || row.requiredPermissions.some(p => !context.access.permissions.includes(String(p)))) throw denied();
      approvalPolicy = row;
    }
    // Independent, bounded read-only snapshots may overlap after the original
    // task/owner check. Drain BOTH on refusal so unawaited reads cannot outlive
    // measured authorization; preserve the original policy-first error boundary.
    const [enabledRead, entitlementRead] = await Promise.allSettled([
      gates(context, task.scopeId, task.sceneCode, task.sceneVersion),
      entitlements.check(structuredClone(context), 'ai.native.use')
    ]);
    if (enabledRead.status === 'rejected') throw enabledRead.reason;
    if (entitlementRead.status === 'rejected') throw entitlementRead.reason;
    const enabled = enabledRead.value, entitlement = entitlementRead.value;
    if (entitlement.available !== true) throw unavailable();
    return { context, binding: requestFingerprint({ identity: identityHash(context), task, enabled, entitlement,
      ...(approvalPolicy ? { approvalPolicy } : {}) }) };
  };
  const authorize = async (taskId: string, operation: 'claim_run' | 'transition_task' | 'decide_approval') => {
    try {
      const initial = await snapshot(taskId, operation), current = await snapshot(taskId, operation);
      const final = await actions.resolve(taskId, operation === 'decide_approval' ? 'read_metadata' : operation);
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
    execution: Object.freeze({ authorize: (taskId: string) => authorize(taskId, 'transition_task') }),
    // Admission only: the original proposal/approval service still owns the
    // concrete decision, payload/version binding and single consumption.
    approval: Object.freeze({ authorize: (taskId: string) => authorize(taskId, 'decide_approval') }) });
}
