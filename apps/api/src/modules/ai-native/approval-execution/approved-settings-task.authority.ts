import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiUsageSettingsDraft } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { PrismaService } from '../../database/prisma.service';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from '../ai-task.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { validateBudgetSettings } from '../budget/budget-settings';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { SubscriptionBudgetEntitlementAdapter } from '../budget/budget-dependency-adapters';
import { AI_APPROVED_SETTINGS_TOOL_CODE } from '@rental-os/shared';
import { registeredSettingsTool } from './approved-settings-contracts';

export interface ApprovedSettingsApplicationDependencies extends PersistedTaskAuthorizationDependencies {
  db: PrismaService;
  core: RentalCoreService;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  holderId: string;
  scene: { code: string; version: string };
}
/** Server-owned acknowledged execution tuple; never a public commit/DTO field. */
export const settingsExecutionLeaseSchema = z.object({
  runId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  holderId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  revision: z.number().int().min(1).max(4294967294),
  fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  expiresAt: z.string().datetime({ offset: true })
}).strict();
export type ApprovedSettingsExecutionLease = z.infer<typeof settingsExecutionLeaseSchema>;
export const settingsUnavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export const settingsDenied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
export const settingsConflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const revision = (value: number) => Number.isSafeInteger(value) && value >= 1 && value <= 4294967294;
const identityHash = (context: Awaited<ReturnType<ReturnType<typeof composePersistedTaskAuthorization>['authority']['resolve']>>) => {
  const { requestId, authorizedAt, ...identity } = context;
  return requestFingerprint(identity);
};
export function settingsTransactionDb(db: PrismaService, tx: Prisma.TransactionClient): PrismaService {
  return new Proxy(db, { get(target, key) {
    if (key === '$transaction') return <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => work(tx);
    return Reflect.get(tx, key) ?? Reflect.get(target, key);
  } });
}

export class ApprovedSettingsTaskAuthority {
  readonly clock: () => Date;
  constructor(readonly d: ApprovedSettingsApplicationDependencies) {
    this.clock = d.clock ?? (() => new Date());
    if (!d.scene?.code || !d.scene.version || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(d.holderId)) throw settingsUnavailable();
  }

  async resolve(taskId: string, mode: 'read' | 'prepare' | 'decide' | 'execute', tx?: Prisma.TransactionClient) {
    const db = tx ? settingsTransactionDb(this.d.db, tx) : this.d.db;
    const authorization = composePersistedTaskAuthorization({ ...this.d, db });
    const context = await authorization.authority.resolve(taskId, 'read_metadata');
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' ||
        (context.audience !== 'operator' && context.audience !== 'staff') || !('access' in context)) throw settingsDenied();
    const access = aiTaskAccessFromContext(context, taskId, this.clock());
    const task = await db.aiTask.findFirst({ where: access.where, include: { scope: true } });
    if (!task || task.id !== taskId || task.ownerId !== context.actor.userId || task.ownerKind !== 'USER' || task.archivedAt !== null ||
        task.audience !== context.audience.toUpperCase() || task.contractVersion !== AI_TASK_DRAFT_VERSION || !revision(task.revision) ||
        Object.entries(access.scope).some(([key, value]) => task.scope[key as keyof typeof task.scope] !== value) ||
        task.sceneCode !== this.d.scene.code || task.sceneVersion !== this.d.scene.version) throw settingsDenied();
    const policyAndGates: unknown[] = [];
    if (mode !== 'read') {
      registeredSettingsTool();
      if (task.cancelRequestedAt !== null || !(mode === 'decide' ? ['RUNNING', 'WAITING_CONFIRMATION'] : ['RUNNING']).includes(task.status)) throw settingsDenied();
      const key = { scopeId: task.scopeId, taskId, operation: mode === 'decide' ? 'decide_approval' : 'transition_task' };
      const policy = await db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: key } });
      if (!policy || Object.entries(key).some(([name, value]) => policy[name as keyof typeof policy] !== value) || !revision(policy.revision) ||
          policy.expiresAt <= this.clock() || !Array.isArray(policy.requiredPermissions) || !policy.requiredPermissions.length ||
          !policy.requiredPermissions.some(p => p === 'rental-os:rules:manage' || p === 'rental-os:price:manage') ||
          policy.requiredPermissions.some(p => typeof p !== 'string' || !p || p.length > 191)) throw settingsUnavailable();
      if (policy.requiredPermissions.some(p => !context.access.permissions.includes(String(p)))) throw settingsDenied();
      policyAndGates.push(policy);
      for (const expected of [aiPersistenceScopeColumns({ kind: 'platform' }), aiPersistenceScopeColumns({ kind: 'tenant', tenantId: context.scope.tenantId }), access.scope]) {
        const scope = await db.aiScope.findFirst({ where: expected });
        if (!scope || Object.entries(expected).some(([key, value]) => scope[key as keyof typeof scope] !== value) ||
            (scope.kind === 'WORKSPACE' && scope.id !== task.scopeId)) throw settingsDenied();
        const key = { scopeId: scope.id, scopeKind: scope.kind, sceneCode: task.sceneCode };
        const gate = await db.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: key } });
        if (!gate || gate.enabled !== true || !revision(gate.configRevision) || Object.entries(key).some(([name, value]) => gate[name as keyof typeof gate] !== value)) throw settingsUnavailable();
        const settings = structuredClone(gate.settingsJson) as unknown as AiUsageSettingsDraft;
        validateBudgetSettings(settings);
        if (requestFingerprint(settings.scope) !== requestFingerprint(scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: context.scope.tenantId }) ||
            settings.sceneCode !== task.sceneCode || !settings.allowedScenes.includes(task.sceneCode) || !settings.allowedModels.length || settings.budget.state !== 'limited' ||
            settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !Object.values(settings.gates).every(g => g.enabled)) throw settingsUnavailable();
        policyAndGates.push(gate);
      }
      const entitlement = await new SubscriptionBudgetEntitlementAdapter(new PrismaSubscriptionBudgetReader(db, this.d.subscriptions, this.clock)).check(context, 'ai.native.use');
      if (!entitlement.available) throw settingsUnavailable();
      policyAndGates.push(entitlement);
    }
    const latest = await authorization.authority.resolve(taskId, 'read_metadata');
    if (identityHash(latest) !== identityHash(context)) throw settingsDenied();
    const taskEvidence = { id: task.id, scopeId: task.scopeId, revision: task.revision, status: task.status, cancelRequestedAt: task.cancelRequestedAt,
      sceneCode: task.sceneCode, sceneVersion: task.sceneVersion, ownerKind: task.ownerKind, ownerId: task.ownerId, audience: task.audience, archivedAt: task.archivedAt };
    return { context: { ...context, scope: context.scope }, access, task, scopeId: task.scopeId, actor: { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, actorId: context.actor.userId },
      bindingHash: requestFingerprint(JSON.parse(JSON.stringify({ identity: identityHash(context), task: taskEvidence, policyAndGates }))) };
  }

  async heldStep(grant: Awaited<ReturnType<ApprovedSettingsTaskAuthority['resolve']>>, stepId: string,
    change: { changeId: string; changeHash: string }, tx: Prisma.TransactionClient, runId?: string,
    executionLease?: ApprovedSettingsExecutionLease) {
    const taskWhere = { ...grant.access.where, scopeId: grant.scopeId, revision: grant.task.revision, status: 'RUNNING' as const, cancelRequestedAt: null };
    if ((await tx.aiTask.updateMany({ where: taskWhere, data: { revision: grant.task.revision } })).count !== 1) throw settingsConflict();
    const step = await tx.aiStep.findFirst({ where: { id: stepId, scopeId: grant.scopeId, taskId: grant.task.id } });
    if (!step || (runId && step.runId !== runId) || step.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION ||
        step.inputRef !== change.changeId || step.requestFingerprint !== change.changeHash || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE') throw settingsDenied();
    const run = await tx.aiRun.findFirst({ where: { id: step.runId, scopeId: grant.scopeId, taskId: grant.task.id } });
    if (!run || run.status !== 'RUNNING' || run.actorKind !== 'USER' || run.actorId !== grant.actor.actorId ||
        run.leaseOwnerId !== this.d.holderId || !run.leaseExpiresAt || run.leaseExpiresAt <= this.clock() || run.fencingToken.lessThanOrEqualTo(0)) throw settingsDenied();
    // Holding the same host name is not holding the same lease. A late callback
    // must never borrow a newer revision/fence after recovery by this host.
    if (executionLease && (run.id !== executionLease.runId || run.leaseOwnerId !== executionLease.holderId
      || run.revision !== executionLease.revision || run.fencingToken.toFixed(0) !== executionLease.fencingToken
      || run.leaseExpiresAt.toISOString() !== executionLease.expiresAt)) throw settingsDenied();
    const runWhere = { id: run.id, scopeId: grant.scopeId, taskId: grant.task.id, revision: run.revision, fencingToken: run.fencingToken,
      leaseOwnerId: this.d.holderId, leaseExpiresAt: { gt: this.clock() }, status: 'RUNNING' as const };
    if ((await tx.aiRun.updateMany({ where: runWhere, data: { revision: run.revision } })).count !== 1 ||
        (await tx.aiStep.updateMany({ where: { id: step.id, scopeId: grant.scopeId, taskId: grant.task.id, revision: step.revision,
          status: 'RUNNING', effect: 'POSSIBLE', inputRef: step.inputRef, requestFingerprint: step.requestFingerprint }, data: { revision: step.revision } })).count !== 1) throw settingsConflict();
    return step;
  }
}
