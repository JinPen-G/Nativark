/** Explicit first model-start admission for one original automatic Task.
 * The registered subject/source authorizes fixed runner policies; their native
 * CAS and one same-transaction human receipt fence the attempt. No creation,
 * business approval, new budget or retry of an unknown attempt is performed. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hasEffectivePermission } from '../../../common/permission-match';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';
import type { BusinessFailureReadAuthority } from '../business-events/business-failure-read.authority';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { PrismaTaskActionPolicyRepository } from '../prisma-task-action-policy.repository';
import { AutomationTaskModelAuthority, automationTaskModelReferenceSchema,
  type AutomationTaskModelCurrent } from './automation-task-model.authority';

const operations = ['read_metadata', 'read_events', 'read_step_terminal', 'claim_run', 'claim_recovery_run',
  'release_run', 'transition_task', 'takeover_run'] as const;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const policy = z.object({ taskId: id, operation: z.enum(operations), revision: z.number().int().min(1).max(4294967294),
  requiredPermissions: z.array(id).min(1).max(64).refine(values => new Set(values).size === values.length),
  expiresAt: z.date().refine(value => Number.isFinite(value.getTime())) }).strict();
type Policy = z.infer<typeof policy>;
type Dependencies = { db: PrismaClient; authority: AutomationTaskModelAuthority; clock(): Date };
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const storage = () => new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
const unknown = () => Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false });
const receiptAction = 'ai_native_automation_explanation_admission';
const receiptId = (origin: AutomationTaskModelCurrent['origin']) => `automation-start:${hash({ scopeId: origin.scopeId, ...origin.original })}`;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const receiptPayload = z.object({ version: z.literal('automation-explanation-admission-1'),
  original: automationTaskModelReferenceSchema, inputHash: digest, bindingHash: digest, actorId: id,
  beforePolicyHash: digest, policies: z.array(policy.extend({ expiresAt: z.string().datetime({ offset: true }) }))
    .length(operations.length).refine(rows => rows.every((row, index) => row.operation === operations[index])) }).strict();
const receiptSnapshot = (value: unknown) => hash(JSON.parse(JSON.stringify(value)));
const same = (a: unknown, b: unknown) => hash(a) === hash(b);
const principal = (value: Awaited<ReturnType<BusinessFailureReadAuthority['current']>>) => hash({
  scope: value.scope, actor: value.context.actor, audience: value.context.audience,
  access: 'access' in value.context ? value.context.access : null });

async function policies(d: Dependencies, current: AutomationTaskModelCurrent): Promise<Array<Policy | null>> {
  const result: Array<Policy | null> = [];
  for (const operation of operations) {
    const key = { scopeId: current.origin.scopeId, taskId: current.origin.original.taskId, operation };
    const row = await d.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: key },
      select: { scopeId: true, taskId: true, operation: true, revision: true, requiredPermissions: true, expiresAt: true } });
    if (!row) { result.push(null); continue; }
    if (row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.operation !== operation) throw storage();
    const { scopeId: _scope, ...value } = row, parsed = policy.safeParse(value);
    if (!parsed.success || parsed.data.expiresAt <= d.clock()) throw denied();
    // A stricter existing policy is never replaced or extended by this entry.
    if (parsed.data.requiredPermissions.some(permission => !('access' in current.context)
      || !hasEffectivePermission(current.context.access.permissions, permission))) throw denied();
    result.push(parsed.data);
  }
  return result;
}
const policySnapshot = (values: Array<Policy | null>) => values.map((row, index) => row
  ? { ...row, expiresAt: row.expiresAt.toISOString() } : { operation: operations[index], missing: true });

export async function prepareAutomationExplanationAdmission(d: Dependencies) {
  const current = await d.authority.inspectInitialStart(), before = await policies(d, current);
  const after = await d.authority.inspectInitialStart();
  if (current.authorizationKey !== after.authorizationKey || current.sourceHash !== after.sourceHash
    || !same(policySnapshot(before), policySnapshot(await policies(d, after)))) throw conflict();
  const last = await d.authority.inspectInitialStart();
  if (last.authorizationKey !== after.authorizationKey || last.sourceHash !== after.sourceHash) throw conflict();
  return { current: last, policies: before,
    policyHash: hash({ source: last.authorizationKey, policies: policySnapshot(before) }) };
}

/** A recorded first-start attempt is history, including after policy expiry.
 * Reading it neither fills policies nor resumes a possibly dispatched model. */
export async function readOriginalAutomationExplanationAdmission(d: Pick<Dependencies, 'db' | 'authority'>): Promise<boolean> {
  const observe = async (origin: AutomationTaskModelCurrent['origin']) => {
    const row = await d.db.operationLog.findUnique({ where: { id: receiptId(origin) } });
    if (!row) return { recorded: false, snapshot: receiptSnapshot(null) };
    const detail = row.detail as { payload?: unknown; payloadHash?: string } | null;
    const parsed = receiptPayload.safeParse(detail?.payload);
    if (!parsed.success) throw storage();
    const payload = parsed.data;
    if (row.id !== receiptId(origin) || row.action !== receiptAction || row.tenantId !== origin.scope.tenantId
      || row.workspaceId !== origin.scope.workspaceId
      || row.userId !== payload.actorId || detail?.payloadHash !== hash(payload) || !same(payload.original, origin.original)
      || payload.inputHash !== origin.inputHash || payload.bindingHash !== origin.bindingHash
      || payload.policies.some(policy => policy.taskId !== origin.original.taskId)) throw storage();
    return { recorded: true, snapshot: receiptSnapshot(row) };
  };
  let observed: string | undefined;
  return d.authority.withOriginalRead(async origin => {
    const first = await observe(origin), last = await observe(origin);
    if (first.snapshot !== last.snapshot) throw conflict();
    observed = last.snapshot; return last.recorded;
  }, async origin => { if (observed === undefined || (await observe(origin)).snapshot !== observed) throw conflict(); });
}

export async function admitOriginalAutomationExplanationStart(d: Dependencies & {
  reads: Pick<BusinessFailureReadAuthority, 'current'>;
  authorityFor(db: PrismaClient): AutomationTaskModelAuthority;
  assertPublication(): void;
}, expected: Awaited<ReturnType<typeof prepareAutomationExplanationAdmission>>, signal?: AbortSignal): Promise<'recorded' | 'already_recorded'> {
  let attempted = false;
  const live = () => { if (signal?.aborted) throw denied(); d.assertPublication(); };
  const human = await d.reads.current(), humanHash = principal(human), origin = expected.current.origin;
  if (human.context.actor.kind !== 'user' || human.context.audience !== 'operator' || !same(human.scope, origin.scope)) throw denied();
  const actorId = human.context.actor.userId;
  const check = async (authority: AutomationTaskModelAuthority) => {
    live();
    const current = await authority.inspectInitialStart();
    if (current.authorizationKey !== expected.current.authorizationKey || current.sourceHash !== expected.current.sourceHash
      || principal(await d.reads.current()) !== humanHash) throw conflict();
    live(); return current;
  };
  try {
    await check(d.authority);
    const result = await d.db.$transaction(async tx => {
      // Match the original input producer's policy/subject/resource lock order.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_policies WHERE id = ${origin.policyId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_automation_subjects WHERE id = ${origin.subjectId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_business_failure_outbox WHERE id = ${origin.event.eventId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${origin.scopeId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${origin.scopeId} AND id = ${origin.original.taskId} FOR UPDATE`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${origin.scopeId} AND taskId = ${origin.original.taskId}
        AND id = ${origin.original.runId} FOR UPDATE`);
      const db = new Proxy(d.db, { get(target, key) {
        if (key === '$transaction') return (work: (native: Prisma.TransactionClient) => Promise<unknown>) => work(tx);
        return Reflect.get(tx, key) ?? Reflect.get(target, key);
      } });
      const authority = d.authorityFor(db), scoped = { db, authority, clock: d.clock };
      await check(authority);
      if (await readOriginalAutomationExplanationAdmission(scoped)) return 'already_recorded' as const;
      const before = await prepareAutomationExplanationAdmission(scoped);
      if (before.policyHash !== expected.policyHash) throw conflict();
      const where = { scopeId: origin.scopeId, taskId: origin.original.taskId };
      const task = await tx.aiTask.findFirst({ where: { id: origin.original.taskId, scopeId: origin.scopeId } });
      const runs = await tx.aiRun.findMany({ where, take: 2 }), run = runs[0];
      if (!task || task.status !== 'QUEUED' || task.revision !== 1 || task.cancelRequestedAt !== null
        || task.archivedAt !== null || task.resultRef !== null || task.eventCursor !== 0n || runs.length !== 1
        || !run || run.id !== origin.original.runId || run.sequence !== 1 || run.status !== 'QUEUED' || run.revision !== 1
        || run.leaseOwnerId !== null || run.leaseExpiresAt !== null || !run.fencingToken.equals(0)
        || run.inputReceiptId !== null || run.resourceOriginRunId !== null) throw conflict();
      const prior = await Promise.all([tx.aiTaskRunPlan.findFirst({ where }), tx.aiStep.findFirst({ where }),
        tx.aiTaskActionInput.findFirst({ where }), tx.aiTaskResultArtifact.findFirst({ where }),
        tx.aiTaskRunPreparation.findFirst({ where }), tx.aiTaskRunOverhead.findFirst({ where }),
        tx.aiTaskExecutionBudget.findFirst({ where }), tx.aiTaskExecutionCharge.findFirst({ where }),
        tx.aiGatewayInvocation.findFirst({ where }), tx.aiTaskInputRequest.findFirst({ where }), tx.aiTaskInputReceipt.findFirst({ where })]);
      if (prior.some(Boolean)) throw conflict();
      const requiredPermissions = [origin.event.type === 'notification.failed' ? 'system:integration:manage'
        : origin.event.type === 'refund.failed' ? 'rental-os:finance:view' : 'rental-os:order:view'];
      const expiresAt = new Date(Math.min(Date.parse(origin.expiresAt), Date.parse(before.current.plan.expiresAt)));
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= d.clock()) throw denied();
      let issuing = false;
      const resolve = async (taskId: string) => {
        if (taskId !== origin.original.taskId || !issuing) throw denied();
        return (await check(authority)).context;
      };
      const repository = new PrismaTaskActionPolicyRepository(db, new AiScopeRepository(db,
        { resolve: () => resolve(origin.original.taskId) }, d.clock), { resolve: (taskId, action) => {
          if (action !== 'configure_action_policy') throw denied(); return resolve(taskId);
        } }, d.clock);
      for (let index = 0; index < operations.length; index++) {
        if (before.policies[index]) continue;
        live(); attempted = true; issuing = true;
        try { await repository.put({ taskId: origin.original.taskId, operation: operations[index], requiredPermissions,
          expiresAt }, null); } finally { issuing = false; }
      }
      const after = await policies(scoped, await check(authority));
      for (let index = 0; index < operations.length; index++) {
        const wanted = before.policies[index] ?? { taskId: origin.original.taskId, operation: operations[index], revision: 1,
          requiredPermissions, expiresAt };
        if (!same(policySnapshot([wanted]), policySnapshot([after[index]]))) throw conflict();
      }
      const payload = { version: 'automation-explanation-admission-1', original: origin.original, inputHash: origin.inputHash,
        bindingHash: origin.bindingHash, actorId, beforePolicyHash: expected.policyHash, policies: policySnapshot(after) };
      live(); attempted = true;
      await tx.operationLog.create({ data: { id: receiptId(origin), tenantId: origin.scope.tenantId,
        workspaceId: origin.scope.workspaceId, userId: actorId, action: receiptAction,
        detail: JSON.parse(JSON.stringify({ payloadHash: hash(payload), payload })) as Prisma.InputJsonValue } });
      await check(authority);
      return 'recorded' as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    await check(d.authority);
    return result;
  } catch (error) { if (attempted) throw unknown(); throw error; }
}
