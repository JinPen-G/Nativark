/** Explicit member admission for one original ordinary-name Task. The original
 * member Guard, current Core change and untouched creation receipt authorize
 * the native policy CAS. No creation-time policy, approval, profile write,
 * model or renewal; the first admission is atomic and reads only observe. */
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { ApprovedProfileRouteAuthority } from '../../platform/approved-profile-route.authority';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { aiTaskAccessFromContext } from '../ai-task.repository';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { composeApprovedProfileApplication } from '../approval-execution/approved-profile-application.composition';
import { composeProfileTaskCreation } from '../approval-execution/profile-task-creation.composition';
import { profileTransactionDb, profileConflict, profileDenied, profileUnavailable,
  type ApprovedProfileApplicationDependencies } from '../approval-execution/approved-profile-task.authority';
import { profileChangeInputSchema, aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { freezeOriginalInput } from '../task-request/original-request.validation';
import { PrismaTaskActionPolicyRepository, type AiTaskActionPolicyOperation,
  type AiTaskActionPolicyMutationAuthority } from '../prisma-task-action-policy.repository';

const operations = ['read_metadata', 'read_events', 'read_step_terminal', 'claim_run', 'claim_recovery_run',
  'release_run', 'transition_task', 'decide_approval'] as const satisfies readonly AiTaskActionPolicyOperation[];
const readers = new Set<AiTaskActionPolicyOperation>(operations.slice(0, 3));
const memberView = 'rental-os:member:view', memberManage = 'rental-os:member:manage';
const originalPermissions = (operation: AiTaskActionPolicyOperation, value: readonly string[]) => value.length === 1
  && (value[0] === memberManage || readers.has(operation) && value[0] === memberView);
const configureSchema = profileChangeInputSchema.extend({ decision: z.literal('allow_original_member_name_task') }).strict();
const same = (a: unknown, b: unknown) => requestFingerprint(JSON.parse(JSON.stringify(a))) === requestFingerprint(JSON.parse(JSON.stringify(b)));
const identityHash = (context: Awaited<ReturnType<AiTaskCurrentIdentityAuthority['resolve']>>) => {
  const { requestId: _, authorizedAt: __, ...identity } = context; return requestFingerprint(identity);
};

export function composeProfileTaskActionPolicies(d: ApprovedProfileApplicationDependencies,
  options: { executionEnabled: boolean; ttlMs: number }) {
  options = Object.freeze(z.object({ executionEnabled: z.boolean(), ttlMs: z.number().int().min(1).max(120000) })
    .strict().parse(structuredClone(options)));
  const clock = d.clock ?? (() => new Date());
  const target = async (dependencies: ApprovedProfileApplicationDependencies, value: unknown) => {
    const parsed = profileChangeInputSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw profileConflict();
    const original = freezeOriginalInput(parsed.data), creation = composeProfileTaskCreation(dependencies);
    const scopes = new AiScopeRepository(dependencies.db, new AiTaskCurrentIdentityAuthority(dependencies.auth, dependencies.credentials, clock), clock);
    const initial = await scopes.resolveCurrent(), context = initial.context;
    if (initial.scope.kind !== 'WORKSPACE' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
      || context.audience !== 'operator' || !('access' in context)
      || ![memberView, memberManage].some(permission => context.access.permissions.includes(permission))) throw profileDenied();
    const actor = { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, actorId: context.actor.userId };
    const identity = identityHash(context), route = new ApprovedProfileRouteAuthority(dependencies.guard, dependencies.credentials);
    // The original GET permits view OR manage. Select one held business code;
    // a manage-only member must not need an unrelated or additional read role.
    const readPermission = context.access.permissions.includes(memberView) ? memberView : memberManage;
    const permissions = (operation: AiTaskActionPolicyOperation) => [readers.has(operation) ? readPermission : memberManage];
    const receipt = await creation.read(original);
    if (!('state' in receipt.receipt) || receipt.receipt.state !== 'observed'
      || !('task' in receipt.receipt) || !receipt.receipt.task) throw profileUnavailable();
    const taskId = receipt.receipt.task.taskId, runId = receipt.receipt.task.runId;
    const access = aiTaskAccessFromContext(context, taskId, clock());
    const task = await dependencies.db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: initial.scope.id }] } });
    if (!task || task.id !== taskId || task.inputRef !== original.changeId || task.inputHash !== original.changeHash
      || task.sceneCode !== dependencies.scene.code || task.sceneVersion !== dependencies.scene.version
      || task.ownerKind !== 'USER' || task.ownerId !== context.actor.userId || task.scopeId !== initial.scope.id
      || task.scopeKind !== 'WORKSPACE' || task.audience !== 'OPERATOR' || task.archivedAt !== null
      || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.inputRevision !== 1
      || task.creationKey !== `profile-create-${original.changeId}`) throw profileDenied();
    const binding = async () => {
      const current = await scopes.resolveCurrent();
      if (current.scope.id !== initial.scope.id || identityHash(current.context) !== identity) throw profileDenied();
      const latest = await dependencies.db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: current.scope.id }] } });
      const run = await dependencies.db.aiRun.findFirst({ where: { id: runId, taskId, scopeId: current.scope.id } });
      if (!latest || latest.id !== taskId || latest.ownerKind !== task.ownerKind || latest.ownerId !== task.ownerId
        || latest.scopeId !== task.scopeId || latest.scopeKind !== task.scopeKind || latest.audience !== task.audience
        || latest.inputRef !== task.inputRef || latest.inputHash !== task.inputHash || latest.inputRevision !== task.inputRevision
        || latest.creationKey !== task.creationKey || latest.creationFingerprint !== task.creationFingerprint
        || latest.contractVersion !== task.contractVersion || latest.sceneCode !== task.sceneCode
        || latest.sceneVersion !== task.sceneVersion || latest.archivedAt !== null || !run || run.id !== runId
        || run.scopeId !== task.scopeId || run.taskId !== taskId || run.actorKind !== 'USER'
        || run.actorId !== task.ownerId || run.sequence !== 1) throw profileDenied();
      return { context: current.context, task: latest, run };
    };
    let publicationHash: string | undefined;
    const initialSource = async () => {
      const current = await binding(), { task: latest, run } = current, db = dependencies.db;
      if (!('access' in current.context) || !current.context.access.permissions.includes(memberManage)) throw profileDenied();
      if (latest.status !== 'QUEUED' || latest.revision !== 1 || latest.cancelRequestedAt !== null || latest.resultRef !== null
        || latest.eventCursor !== 0n || run.status !== 'QUEUED' || run.revision !== 1 || run.leaseOwnerId !== null
        || run.leaseExpiresAt !== null || run.inputReceiptId !== null || !run.fencingToken.equals(0)) throw profileDenied();
      const runs = await db.aiRun.findMany({ where: { taskId, scopeId: task.scopeId }, take: 2 });
      if (runs.length !== 1 || runs[0].id !== runId) throw profileDenied();
      const where = { taskId, scopeId: task.scopeId };
      const prior = await Promise.all([db.aiTaskRunPlan.findFirst({ where }), db.aiStep.findFirst({ where }),
        db.aiTaskActionInput.findFirst({ where }), db.aiTaskResultArtifact.findFirst({ where }),
        db.aiTaskExecutionPhaseStart.findFirst({ where }), db.aiTaskExecutionPhaseReceipt.findFirst({ where }),
        db.aiTaskRunPreparation.findFirst({ where }), db.aiProposal.findFirst({ where }), db.aiProposalVersion.findFirst({ where }),
        db.aiApproval.findFirst({ where }), db.aiApprovalConsumption.findFirst({ where }),
        db.customerApprovedProfileOperation.findFirst({ where: { changeId: original.changeId, tenantId: actor.tenantId } })]);
      if (prior.some(Boolean)) throw profileDenied();
      const change = await composeApprovedProfileApplication(dependencies).readAuthorizedChange(original);
      const policy = await db.aiTaskPlanPolicy.findFirst({ where: { scopeId: task.scopeId, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion } });
      const tools = aiPersistedPlanToolsSchema.safeParse(policy?.allowedTools), limits = aiTaskRunnerLimitsSchema.safeParse(policy?.limits);
      if (!policy || policy.scopeId !== task.scopeId || policy.sceneCode !== task.sceneCode || policy.sceneVersion !== task.sceneVersion
        || !Number.isInteger(policy.revision) || policy.revision < 1 || policy.revision > 4294967294 || policy.enabled !== true
        || !(policy.expiresAt instanceof Date) || !Number.isFinite(policy.expiresAt.getTime()) || policy.expiresAt <= clock()
        || !tools.success || !limits.success || limits.data.maxStepMs > limits.data.maxTotalMs
        || !tools.data.some(tool => tool.code === 'membership.profile.commit' && tool.version === AI_TOOL_DRAFT_VERSION)) throw profileUnavailable();
      const entitlement = await new PrismaSubscriptionBudgetReader(db, dependencies.subscriptions, clock).read(actor.tenantId, 'ai.native.use');
      if (entitlement.entitlements.length !== 1 || entitlement.entitlements[0].code !== 'ai.native.use'
        || !entitlement.entitlements[0].available) throw profileUnavailable();
      const fingerprint = requestFingerprint({ original, change, policyRevision: policy.revision,
        tools: tools.data, limits: limits.data, expiresAt: policy.expiresAt.toISOString(), entitlement });
      if (publicationHash !== undefined && publicationHash !== fingerprint) throw profileConflict();
      publicationHash = fingerprint;
      return { change, policy, fingerprint };
    };
    const authority = (writing: boolean, required: readonly string[] = []): AiTaskActionPolicyMutationAuthority => ({
      async resolve(id, operation) {
        if (id !== taskId || operation !== 'configure_action_policy') throw profileDenied();
        return route.withAuthorization(writing ? 'write' : 'read', original.customerId, async (guarded, revalidate) => {
          if (!same(guarded, actor)) throw profileDenied();
          const current = await binding();
          const granted = current.context;
          if (!('access' in granted) || required.some(permission => !granted.access.permissions.includes(permission))) throw profileDenied();
          if (writing) await initialSource();
          await revalidate();
          return (await binding()).context;
        });
      }
    });
    const reader = new PrismaTaskActionPolicyRepository(dependencies.db, scopes, authority(false), clock);
    const read = async () => {
      const items = [];
      for (const operation of operations) {
        const current = await reader.read(taskId, operation);
        const mutation = await reader.readMutation(taskId, operation, null);
        if (mutation.state === 'recorded' && (mutation.policy.revision !== 1
          || mutation.policy.taskId !== taskId || mutation.policy.operation !== operation
          || !originalPermissions(operation, mutation.policy.requiredPermissions))) throw profileConflict();
        items.push({ operation, current, mutation });
      }
      return items;
    };
    const verify = async () => {
      const current = await creation.read(original), latest = await dependencies.db.aiTask.findFirst({ where: { id: taskId } });
      if (!('state' in current.receipt) || current.receipt.state !== 'observed' || !('task' in current.receipt)
        || !current.receipt.task || current.receipt.task.taskId !== taskId
        || current.receipt.task.runId !== runId || !same(current.original, original) || !latest
        || latest.ownerId !== task.ownerId || latest.scopeId !== task.scopeId || latest.inputRef !== task.inputRef
        || latest.inputHash !== task.inputHash || latest.sceneCode !== task.sceneCode || latest.sceneVersion !== task.sceneVersion
        || latest.archivedAt !== null) throw profileDenied();
    };
    const put = (operation: typeof operations[number], expiresAt: Date) => new PrismaTaskActionPolicyRepository(dependencies.db, scopes,
      authority(true, permissions(operation)), clock).put({ taskId, operation, requiredPermissions: permissions(operation), expiresAt }, null, true);
    const authorizeInitial = async () => {
      await authority(true).resolve(taskId, 'configure_action_policy'); return initialSource();
    };
    const completeVerify = async () => { await verify(); await binding(); };
    await completeVerify(); return { original, task, taskId, runId, actor, put, read, verify: completeVerify, authorizeInitial };
  };
  const observed = (found: Awaited<ReturnType<typeof target>>, items: Awaited<ReturnType<Awaited<ReturnType<typeof target>>['read']>>) => {
    const recorded = items.filter(item => item.mutation.state === 'recorded');
    if (recorded.length !== 0 && recorded.length !== operations.length) throw profileConflict();
    return freezeOriginalInput({ original: found.original, taskId: found.taskId, runId: found.runId,
      state: recorded.length === operations.length ? 'recorded' as const : 'not_observed' as const,
      items, retryable: false as const, authorization: 'current_original_member_authority_required' as const,
      approval: 'not_granted_by_policy_configuration' as const,
      execution: 'not_invoked_by_policy_configuration' as const, profileUpdate: 'not_attempted_by_policy_configuration' as const });
  };
  return Object.freeze({
    async read(value: unknown) {
      const found = await target(d, value), items = await found.read(); await found.verify(); return observed(found, items);
    },
    async configure(value: unknown) {
      const parsed = configureSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw profileConflict();
      const { decision: _decision, ...original } = parsed.data;
      const before = await target(d, original), first = await before.read(); await before.verify();
      if (first.every(item => item.mutation.state === 'recorded')) return { ...observed(before, first), replayed: true as const };
      if (!options.executionEnabled) throw profileUnavailable();
      if (first.some(item => item.current.state !== 'not_observed' || item.mutation.state !== 'not_observed')) throw profileConflict();
      const source = await before.authorizeInitial();
      const at = clock();
      if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw profileUnavailable();
      const expiresAt = new Date(Math.min(Date.parse(source.change.expiresAt), source.policy.expiresAt.getTime(), at.getTime() + options.ttlMs));
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= at) throw profileConflict();
      let entered = false;
      try {
        await d.db.$transaction(async tx => {
          // Match the Core customer -> Task lock order. Each put keeps its own
          // current member authority/CAS/receipt checks, composed on
          // the SAME transaction. A lost COMMIT does not leave a usable partial
          // admission and is never retried with new revisions or TTL.
          await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_profiles WHERE tenantId = ${before.actor.tenantId} AND id = ${original.customerId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${before.task.scopeId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${before.task.scopeId} AND id = ${before.taskId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${before.task.scopeId} AND taskId = ${before.taskId} AND id = ${before.runId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT id FROM customer_approved_profile_changes WHERE id = ${original.changeId} FOR UPDATE`);
          await tx.$queryRaw(Prisma.sql`SELECT revision FROM ai_task_plan_policies WHERE scopeId = ${before.task.scopeId}
            AND sceneCode = ${before.task.sceneCode} AND sceneVersion = ${before.task.sceneVersion} FOR UPDATE`);
          const found = await target({ ...d, db: profileTransactionDb(d.db, tx) }, original);
          const current = await found.read();
          if (!same(current, first) || (await found.authorizeInitial()).fingerprint !== source.fingerprint) throw profileConflict();
          for (const operation of operations) {
            entered = true;
            await found.put(operation, expiresAt);
          }
          await found.verify();
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
        const found = await target(d, original), items = await found.read(); await found.verify();
        if (items.some(item => item.mutation.state !== 'recorded' || item.mutation.policy.expiresAt !== expiresAt.toISOString()))
          throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        return { ...observed(found, items), replayed: false as const };
      } catch (error) {
        if (entered) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        throw error;
      }
    }
  });
}
