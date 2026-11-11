/** Original Task authority for ordinary personal-name actions. Reuses current
 * auth/action policies, execution/approval admission and original scope; it does
 * not create a task, seed a policy, grant a role or call a model. */
import { hasEffectivePermission } from '../../../common/permission-match';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, type AiToolCode, type AiExecutionContext } from '@rental-os/shared';
import type { PrismaService } from '../../database/prisma.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';

export const PROFILE_NAME_TOOL_CODE = 'membership.profile.commit' satisfies AiToolCode;
export const profileExecutionLeaseSchema = z.object({ runId: z.string().min(1).max(36), holderId: z.string().min(1).max(191),
  revision: z.number().int().min(1).max(4294967294), fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u),
  expiresAt: z.string().datetime({ offset: true }) }).strict();
export type ProfileExecutionLease = z.infer<typeof profileExecutionLeaseSchema>;
export interface ApprovedProfileApplicationDependencies extends PersistedTaskAuthorizationDependencies {
  db: PrismaService;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  holderId: string;
  scene: { code: string; version: string };
}
export const profileDenied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
export const profileConflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
export const profileUnavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export function profileTransactionDb(db: PrismaService, tx: Prisma.TransactionClient): PrismaService {
  return new Proxy(db, { get(target, key) {
    if (key === '$transaction') return <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => work(tx);
    return Reflect.get(tx, key) ?? Reflect.get(target, key);
  } });
}
const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 1 && value <= 4294967294;

export class ApprovedProfileTaskAuthority {
  readonly clock: () => Date;
  constructor(readonly d: ApprovedProfileApplicationDependencies) {
    this.clock = d.clock ?? (() => new Date());
    if (!d.scene?.code || !d.scene.version || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(d.holderId)) throw profileUnavailable();
  }
  async resolve(taskId: string, mode: 'read' | 'prepare' | 'decide' | 'execute', tx?: Prisma.TransactionClient) {
    const db = tx ? profileTransactionDb(this.d.db, tx) : this.d.db;
    const authorization = composePersistedTaskAuthorization({ ...this.d, db });
    const context = mode === 'read' ? await authorization.authority.resolve(taskId, 'read_metadata')
      : mode === 'decide' ? await authorization.approval.authorize(taskId) : await authorization.execution.authorize(taskId);
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator'
      || !('access' in context)) throw profileDenied();
    const required = mode === 'read' ? ['rental-os:member:view', 'rental-os:member:manage'] : ['rental-os:member:manage'];
    if (!required.some(permission => hasEffectivePermission(context.access.permissions, permission))) throw profileDenied();
    const access = aiTaskAccessFromContext(context, taskId, this.clock());
    const task = await db.aiTask.findFirst({ where: access.where, include: { scope: true } });
    if (!task || task.id !== taskId || task.ownerKind !== 'USER' || task.ownerId !== context.actor.userId
      || task.audience !== 'OPERATOR' || task.archivedAt !== null || task.contractVersion !== AI_TASK_DRAFT_VERSION
      || !validRevision(task.revision) || task.sceneCode !== this.d.scene.code || task.sceneVersion !== this.d.scene.version
      || Object.entries(access.scope).some(([key, value]) => task.scope[key as keyof typeof task.scope] !== value)) throw profileDenied();
    let policy: unknown;
    if (mode !== 'read') {
      if (task.cancelRequestedAt !== null || !(mode === 'decide' ? ['RUNNING', 'WAITING_CONFIRMATION'] : ['RUNNING']).includes(task.status)) throw profileDenied();
      const key = { scopeId: task.scopeId, taskId, operation: mode === 'decide' ? 'decide_approval' : 'transition_task' };
      const action = await db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: key } });
      if (!action || Object.entries(key).some(([name, value]) => action[name as keyof typeof action] !== value)
        || !validRevision(action.revision) || !(action.expiresAt instanceof Date) || !Number.isFinite(action.expiresAt.getTime())
        || action.expiresAt <= this.clock() || !Array.isArray(action.requiredPermissions)
        || !action.requiredPermissions.includes('rental-os:member:manage')) throw profileUnavailable();
      const planKey = { scopeId: task.scopeId, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion };
      const plan = await db.aiTaskPlanPolicy.findFirst({ where: planKey });
      if (!plan || Object.entries(planKey).some(([name, value]) => plan[name as keyof typeof plan] !== value)
        || plan.enabled !== true || !validRevision(plan.revision) || !(plan.expiresAt instanceof Date)
        || !Number.isFinite(plan.expiresAt.getTime()) || plan.expiresAt <= this.clock()
        || !aiPersistedPlanToolsSchema.parse(plan.allowedTools).some(tool => tool.code === PROFILE_NAME_TOOL_CODE && tool.version === AI_TOOL_DRAFT_VERSION)) throw profileUnavailable();
      policy = { action, plan };
    }
    const latest = await authorization.authority.resolve(taskId, 'read_metadata');
    const identity = (value: AiExecutionContext) => { const { requestId: _request, authorizedAt: _at, ...bound } = value; return requestFingerprint(bound); };
    if (identity(latest) !== identity(context)) throw profileDenied();
    return { context, access, task, scopeId: task.scopeId,
      actor: { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, actorId: context.actor.userId },
      policyHash: requestFingerprint(JSON.parse(JSON.stringify({ identity: identity(context), policy }))),
      bindingHash: requestFingerprint(JSON.parse(JSON.stringify({ identity: identity(context), task: {
        id: task.id, scopeId: task.scopeId, revision: task.revision, status: task.status, cancelRequestedAt: task.cancelRequestedAt,
        ownerId: task.ownerId, audience: task.audience, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion }, policy }))) };
  }
  async heldStep(grant: Awaited<ReturnType<ApprovedProfileTaskAuthority['resolve']>>, actionId: string,
    change: { id: string; changeHash: string }, lease: ProfileExecutionLease, tx: Prisma.TransactionClient) {
    lease = profileExecutionLeaseSchema.parse(structuredClone(lease));
    if (lease.holderId !== this.d.holderId) throw profileDenied();
    const taskWhere = { ...grant.access.where, scopeId: grant.scopeId, revision: grant.task.revision, status: 'RUNNING' as const, cancelRequestedAt: null };
    if ((await tx.aiTask.updateMany({ where: taskWhere, data: { revision: grant.task.revision } })).count !== 1) throw profileConflict();
    const step = await tx.aiStep.findFirst({ where: { scopeId: grant.scopeId, taskId: grant.task.id, actionId } });
    if (!step || step.runId !== lease.runId || step.toolCode !== PROFILE_NAME_TOOL_CODE || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || step.inputRef !== change.id || step.requestFingerprint !== change.changeHash || step.status !== 'RUNNING' || step.effect !== 'POSSIBLE') throw profileDenied();
    const runWhere = { id: lease.runId, scopeId: grant.scopeId, taskId: grant.task.id, actorKind: 'USER' as const, actorId: grant.actor.actorId,
      leaseOwnerId: lease.holderId, revision: lease.revision, fencingToken: new Prisma.Decimal(lease.fencingToken), status: 'RUNNING' as const };
    const run = await tx.aiRun.findFirst({ where: runWhere });
    if (!run || !run.leaseExpiresAt || run.leaseExpiresAt <= this.clock() || run.leaseExpiresAt.toISOString() !== lease.expiresAt) throw profileDenied();
    if ((await tx.aiRun.updateMany({ where: { ...runWhere, leaseExpiresAt: { gt: this.clock() } }, data: { revision: lease.revision } })).count !== 1
      || (await tx.aiStep.updateMany({ where: { id: step.id, scopeId: grant.scopeId, taskId: grant.task.id, revision: step.revision,
        status: 'RUNNING', effect: 'POSSIBLE', inputRef: step.inputRef, requestFingerprint: step.requestFingerprint }, data: { revision: step.revision } })).count !== 1) throw profileConflict();
    return step;
  }
}
