import type { PrismaClient } from '@prisma/client';
import type { AiExecutionContext } from '@rental-os/shared';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiScopeRepository, type AiCurrentScopeAuthority } from '../ai-scope.repository';
import { AiTaskRepository, AiTaskRepositoryError, aiTaskAccessFromContext, type AiTaskRepositoryAuthority, type AiTaskRepositoryOperation } from '../ai-task.repository';
import { validateBudgetSettings } from '../budget/budget-settings';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { PlatformModelConfigurationAuthority } from '../platform-model-config.authority';
import { PrismaTaskActionPolicySource } from '../prisma-task-action-policy.source';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { TEXT_PROBE_SCENE } from '../text-capability-probe';

const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const validRevision = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= 4294967294;
const identityHash = (context: AiExecutionContext) => {
  const { authorizedAt: _at, requestId: _request, ...identity } = context;
  return requestFingerprint(identity);
};
const operations = ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task',
  'read_step_terminal', 'takeover_run', 'request_input', 'submit_input', 'resume_input'] as const;

/** Current SaaS/platform identity only: the real platform Guard behind the
 * bound Profile resource. This grants neither tenant membership nor execution. */
export class PlatformTaskIdentityAuthority implements AiCurrentScopeAuthority {
  constructor(private readonly management: PlatformModelConfigurationAuthority,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof management?.resolve !== 'function') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
  async resolve(): Promise<AiExecutionContext> {
    const context = structuredClone(await this.management.resolve());
    if (!isAiStepExecutionContext(context) || context.actor.kind !== 'saas_admin'
      || context.audience !== 'operator' || context.scope.kind !== 'platform') throw denied();
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(context.authorizedAt) > now.getTime()) throw denied();
    return context;
  }
}

/** Platform task action authority: the same dual-read policy discipline as the
 * workspace adapter, resolved from the platform scope's persisted task action
 * policies. No tenant policy row can ever satisfy a platform scope lookup. */
export class PlatformTaskActionAuthority implements AiTaskRepositoryAuthority {
  constructor(private readonly identity: PlatformTaskIdentityAuthority,
    private readonly policies: PrismaTaskActionPolicySource,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof identity?.resolve !== 'function' || typeof policies?.resolve !== 'function') throw denied();
  }
  private async current() {
    const context = await this.identity.resolve();
    const { requestId: _request, authorizedAt: _time, ...binding } = context;
    return { context, fingerprint: requestFingerprint(binding) };
  }
  async resolve(taskId: string, operation: AiTaskRepositoryOperation) {
    if (typeof taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(taskId)
      || !(operations as readonly string[]).includes(operation)) throw denied();
    try {
      const initial = await this.current();
      const policy = structuredClone(await this.policies.resolve(taskId, operation, structuredClone(initial.context)));
      if (!policy) throw unavailable();
      if (policy.taskId !== taskId || policy.operation !== operation || !Number.isSafeInteger(policy.revision) || policy.revision < 1
        || !Array.isArray(policy.requiredPermissions) || policy.requiredPermissions.length < 1 || policy.requiredPermissions.length > 64
        || policy.requiredPermissions.some(permission => typeof permission !== 'string' || permission.length < 1 || permission.length > 191)
        || new Set(policy.requiredPermissions).size !== policy.requiredPermissions.length || !Number.isFinite(Date.parse(policy.expiresAt))) throw denied();
      const current = await this.current();
      const rechecked = structuredClone(await this.policies.resolve(taskId, operation, structuredClone(current.context)));
      const final = await this.current();
      // The SaaS platform context carries its permission list at the top
      // level (no `access` member); an absent or non-array list fails closed.
      const heldPermissions = 'permissions' in final.context && Array.isArray(final.context.permissions)
        ? final.context.permissions : null;
      if (current.fingerprint !== initial.fingerprint || final.fingerprint !== initial.fingerprint || requestFingerprint(rechecked) !== requestFingerprint(policy)
        || Date.parse(policy.expiresAt) <= this.clock().getTime() || heldPermissions === null
        || policy.requiredPermissions.some(permission => !heldPermissions.includes(permission))) throw denied();
      return structuredClone(final.context);
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw denied();
    }
  }
}

export interface PlatformTaskAuthorization {
  scopes: AiScopeRepository;
  authority: AiTaskRepositoryAuthority;
  tasks: AiTaskRepository;
  execution: { authorize(taskId: string): Promise<AiExecutionContext> };
}

/** Explicit SaaS/platform task authorization. The single PLATFORM budget
 * policy substitutes for the tenant three-layer gate and the tenant
 * subscription entitlement: platform admission is the platform policy itself,
 * so a missing, disabled or zero policy fails closed exactly like its tenant
 * counterpart. No workspace fallback, no tenant grant, no policy seeding. */
export function composePlatformTaskAuthorization(input: {
  db: PrismaClient; guard: Pick<ApiAuthGuard, 'canActivate'>; credentials: AiOrderRouteCredentialSource;
  profileId: string; clock?: () => Date;
}): PlatformTaskAuthorization {
  const clock = input.clock ?? (() => new Date());
  // Mutual reference resolved lazily: the management Guard resolves the SaaS
  // identity, the identity adapter closes over the authority created after it.
  let identity!: PlatformTaskIdentityAuthority;
  const management = new PlatformModelConfigurationAuthority(input.guard, input.credentials, input.profileId,
    { resolve: () => identity.resolve() }, clock);
  identity = new PlatformTaskIdentityAuthority(management, clock);
  const scopes = new AiScopeRepository(input.db, identity, clock);
  const policies = new PrismaTaskActionPolicySource(input.db, scopes, clock);
  const actions = new PlatformTaskActionAuthority(identity, policies, clock);
  const gates = async (context: AiExecutionContext, taskScopeId: string, sceneCode: string) => {
    if (context.scope.kind !== 'platform' || context.actor.kind !== 'saas_admin' || context.audience !== 'operator') throw denied();
    if (taskScopeId !== (await scopes.resolveCurrent()).scope.id) throw denied();
    const columns = aiPersistenceScopeColumns({ kind: 'platform' });
    const scope = await input.db.aiScope.findFirst({ where: columns, select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } });
    if (!scope || Object.entries(columns).some(([key, value]) => scope[key as keyof typeof scope] !== value) || scope.id !== taskScopeId) throw denied();
    const row = await input.db.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: { scopeId: scope.id, scopeKind: 'PLATFORM', sceneCode } },
      select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, enabled: true, settingsJson: true } });
    if (!row || row.scopeId !== scope.id || row.scopeKind !== 'PLATFORM' || row.sceneCode !== sceneCode
      || !validRevision(row.configRevision) || row.enabled !== true) throw unavailable();
    const settings = structuredClone(row.settingsJson) as unknown as import('@rental-os/shared').AiUsageSettingsDraft;
    validateBudgetSettings(settings);
    if (requestFingerprint(settings.scope) !== requestFingerprint({ kind: 'platform' }) || settings.sceneCode !== sceneCode
      || !settings.allowedScenes.includes(sceneCode) || !settings.allowedModels.length || settings.budget.state !== 'limited'
      || settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !Object.values(settings.gates).every(gate => gate.enabled === true)) throw unavailable();
    return { key: { scopeId: row.scopeId, scopeKind: 'PLATFORM', sceneCode }, id: row.id, revision: row.configRevision, settings };
  };
  const snapshot = async (taskId: string, operation: 'claim_run' | 'transition_task') => {
    const context = await actions.resolve(taskId, operation);
    const access = aiTaskAccessFromContext(context, taskId, clock());
    const task = await input.db.aiTask.findFirst({ where: access.where, select: { id: true, scopeId: true, scopeKind: true,
      ownerKind: true, ownerId: true, audience: true, contractVersion: true, status: true, revision: true,
      sceneCode: true, sceneVersion: true, archivedAt: true, cancelRequestedAt: true } });
    if (!task || task.id !== taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
      || task.audience !== access.audience || task.scopeKind !== access.scope.kind || task.archivedAt !== null) throw denied();
    if (task.contractVersion !== AI_TASK_DRAFT_VERSION || !validRevision(task.revision) || task.cancelRequestedAt !== null
      || !['QUEUED', 'RUNNING'].includes(task.status) || (operation === 'transition_task' && task.status !== 'RUNNING')) throw denied();
    const enabled = await gates(context, task.scopeId, task.sceneCode);
    // The platform policy IS the commercial admission for platform-owned work;
    // gates() above already failed closed on missing/disabled/zero settings.
    return { context, binding: requestFingerprint({ identity: identityHash(context), task, enabled }) };
  };
  const authorize = async (taskId: string, operation: 'claim_run' | 'transition_task') => {
    const initial = await snapshot(taskId, operation), current = await snapshot(taskId, operation);
    const final = await actions.resolve(taskId, operation);
    if (initial.binding !== current.binding || identityHash(final) !== identityHash(current.context)) throw denied();
    return structuredClone(final);
  };
  const authority: AiTaskRepositoryAuthority = {
    resolve: (taskId, operation) => operation === 'claim_run' ? authorize(taskId, 'claim_run') : actions.resolve(taskId, operation)
  };
  return Object.freeze({ scopes, authority, tasks: new AiTaskRepository(input.db, authority, clock),
    execution: Object.freeze({ authorize: (taskId: string) => authorize(taskId, 'transition_task') }) });
}

/** Read-only plan policy projection for the platform probe scene. Mirrors the
 * workspace repository's read(): the row is scope-owned and never seeded. */
export class PlatformTaskPlanPolicyReader {
  constructor(private readonly db: Pick<PrismaClient, 'aiScope' | 'aiTaskPlanPolicy'>,
    private readonly identity: PlatformTaskIdentityAuthority, private readonly scene: { code: string; version: string },
    private readonly tools: ReadonlyArray<{ code: string; version: string }>,
    private readonly clock: () => Date = () => new Date()) {}
  private async access() {
    const current = await this.identity.resolve();
    const resolved = await new AiScopeRepository(this.db, this.identity, this.clock).resolveCurrent();
    // Compare the stable principal only: authorizedAt/requestId are freshly
    // generated per resolution and must not fail cross-millisecond reads.
    if (resolved.scope.kind !== 'PLATFORM' || resolved.context.scope.kind !== 'platform'
      || identityHash(resolved.context) !== identityHash(current)
      || Date.parse(resolved.context.authorizedAt) > this.clock().getTime()) throw denied();
    return { key: { scopeId: resolved.scope.id, sceneCode: this.scene.code, sceneVersion: this.scene.version },
      binding: requestFingerprint({ scope: resolved.scope.id, identity: identityHash(resolved.context) }),
      scopeId: resolved.scope.id };
  }
  async read() {
    const before = await this.access();
    const row = await this.db.aiTaskPlanPolicy.findFirst({ where: before.key });
    if ((await this.access()).binding !== before.binding) throw denied();
    if (!row) return { state: 'not_configured' as const };
    if (Object.entries(before.key).some(([key, value]) => row[key as keyof typeof row] !== value)) throw denied();
    if (!Number.isInteger(row.revision) || row.revision < 1 || row.revision > 4294967294
      || row.allowedTools === null || requestFingerprint(row.allowedTools) !== requestFingerprint(this.tools)
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())
      || row.expiresAt.getTime() <= this.clock().getTime() || !row.enabled) throw unavailable();
    const limits = aiTaskRunnerLimitsSchema.parse(structuredClone(row.limits));
    return { state: 'configured' as const, revision: row.revision, enabled: row.enabled,
      limits, expiresAt: row.expiresAt.toISOString() };
  }
}

/** Scene marker for platform probe policy reads; the scene itself stays the
 * shared TEXT_PROBE_SCENE so challenge intents bind identically. */
export const PLATFORM_PROBE_SCENE = TEXT_PROBE_SCENE;
