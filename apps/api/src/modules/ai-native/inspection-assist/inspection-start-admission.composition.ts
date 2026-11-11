/** Explicit first recognition start may fill missing original task policies.
 * The existing staff policy authority and CAS receipts own every grant. Only
 * an untouched first Run qualifies; this port neither dispatches a model nor
 * changes a present policy, inspection, approval or resource allowance. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_INSPECTION_TASK_POLICY_OPERATIONS } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { AiTaskRunnerError, callAiTaskRunnerDependency } from '../runner/ai-task-runner.service';
import { composeStaffInspectionTaskPolicies, type StaffInspectionTaskPolicyOptions } from '../staff-inspection-task-policy.composition';
import { InspectionRecognitionTaskApplication, type InspectionRecognitionTaskDependencies } from './inspection-recognition-task.application';
import { inspectionTargetSchema, inspectionId } from './inspection-assist.validation';

type Request = { headers: { authorization?: unknown } };
const referenceSchema = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
  inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).strict();
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const snapshot = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value,
  (_key, item) => typeof item === 'bigint' ? { bigint: item.toString() } : item)));

/** Called only by the standard explicit start, never creation or observation.
 * A lost policy COMMIT stops this request before the original runner. The
 * original configure receipts retain their null-revision selectors. */
export async function prepareStaffInspectionStartAdmission(dependencies: InspectionRecognitionTaskDependencies,
  options: StaffInspectionTaskPolicyOptions, request: Request, value: unknown, signal?: AbortSignal): Promise<void> {
  const parsed = referenceSchema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const token = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u).safeParse(request?.headers?.authorization);
  if (!token.success || signal?.aborted) throw denied();
  if (dependencies.enabled !== true || options.enabled !== true
    || !isDeepStrictEqual([...options.operations].sort(), [...AI_INSPECTION_TASK_POLICY_OPERATIONS].sort())) throw unavailable();
  const reference = parsed.data, currentRequest = { headers: { authorization: token.data } };
  const requestId = randomUUID(), clock = dependencies.model.clock ?? (() => new Date());
  let active = true, attempted = false;
  const close = () => { active = false; };
  const credentials = { current: async () => {
    if (!active || signal?.aborted) throw denied();
    return { authorization: token.data, requestId, audience: 'staff' as const };
  } };
  signal?.addEventListener('abort', close, { once: true });
  const bind = async (d: InspectionRecognitionTaskDependencies) => {
    const db = d.model.db;
    const scopes = new AiScopeRepository(db, new AiTaskCurrentIdentityAuthority(d.model.auth, credentials, clock), clock);
    const before = await scopes.resolveCurrent(), context = before.context;
    if (!active || signal?.aborted || context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
      || context.audience !== 'staff') throw denied();
    const receipt = await new InspectionRecognitionTaskApplication(d).readCreation(currentRequest, reference, signal);
    if (receipt.state !== 'observed') throw unavailable();
    const access = aiTaskAccessFromContext(context, receipt.task.taskId, clock());
    const task = await db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: before.scope.id }] } });
    const run = await db.aiRun.findFirst({ where: { id: receipt.task.runId, taskId: receipt.task.taskId,
      scopeId: before.scope.id, actorKind: access.actorKind, actorId: access.actorId } });
    if (!task || task.id !== receipt.task.taskId || task.inputRef !== reference.inputId
      || task.inputRevision !== reference.expectedRevision || !run || run.id !== receipt.task.runId
      || run.taskId !== task.id || run.scopeId !== before.scope.id) throw denied();
    const after = await scopes.resolveCurrent();
    if (!active || signal?.aborted || after.scope.id !== before.scope.id
      || originalIdentityHash(after.context) !== originalIdentityHash(context)) throw denied();
    return { db, task, run, context, scope: context.scope, scopeId: before.scope.id,
      fingerprint: snapshot({ task, run, identity: originalIdentityHash(context), reference }) };
  };
  const untouched = async (bound: Awaited<ReturnType<typeof bind>>) => {
    const { db, task, run } = bound, where = { scopeId: bound.scopeId, taskId: task.id };
    if (task.status !== 'QUEUED' || task.revision !== 1 || task.archivedAt !== null || task.cancelRequestedAt !== null
      || task.resultRef !== null || task.eventCursor !== 0n || run.status !== 'QUEUED' || run.revision !== 1
      || run.sequence !== 1 || run.leaseOwnerId !== null || run.leaseExpiresAt !== null
      || run.inputReceiptId !== null || run.resourceOriginRunId !== null || !run.fencingToken.equals(0)) throw conflict();
    const runs = await db.aiRun.findMany({ where, take: 2 });
    if (runs.length !== 1 || runs[0].id !== run.id) throw conflict();
    const prior = await Promise.all([db.aiTaskRunPlan.findFirst({ where }), db.aiStep.findFirst({ where }),
      db.aiTaskActionInput.findFirst({ where }), db.aiTaskResultArtifact.findFirst({ where }),
      db.aiTaskRunPreparation.findFirst({ where }), db.aiTaskExecutionPhaseStart.findFirst({ where }),
      db.aiTaskExecutionPhaseReceipt.findFirst({ where }), db.aiTaskExecutionBudget.findFirst({ where }),
      db.aiTaskExecutionCharge.findFirst({ where }), db.aiTaskInputRequest.findFirst({ where }), db.aiTaskInputReceipt.findFirst({ where })]);
    if (prior.some(Boolean)) throw conflict();
  };
  const read = async (policies: ReturnType<typeof composeStaffInspectionTaskPolicies>) => {
    const rows = [];
    for (const operation of AI_INSPECTION_TASK_POLICY_OPERATIONS) {
      if (!active || signal?.aborted) throw denied();
      const response = await policies.read(currentRequest, { reference, operation }, signal);
      if (!('state' in response.result)) throw unavailable();
      rows.push(response.result);
    }
    return rows;
  };
  try {
    await callAiTaskRunnerDependency(() => runWithRequestIdentity({}, async () => {
      const policies = composeStaffInspectionTaskPolicies(dependencies, options);
      const before = await bind(dependencies), observed = await read(policies);
      // Existing policies retain their exact permissions, revisions and TTL.
      // The original runner checks whether they currently authorize this start.
      if (observed.every(row => row.state === 'observed')) return;
      await untouched(before);
      await dependencies.model.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM rental_orders WHERE tenantId = ${before.scope.tenantId}
          AND workspaceId = ${before.scope.workspaceId} AND id = ${reference.orderId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${before.scopeId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${before.scopeId} AND id = ${before.task.id} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${before.scopeId} AND taskId = ${before.task.id}
          AND id = ${before.run.id} FOR UPDATE`);
        const db = new Proxy(dependencies.model.db, { get(target, key) {
          if (key === '$transaction') return (work: (client: Prisma.TransactionClient) => Promise<unknown>) => work(tx);
          return Reflect.get(tx, key) ?? Reflect.get(target, key);
        } });
        const scoped = { ...dependencies, inspection: { ...dependencies.inspection, db },
          model: { ...dependencies.model, db }, ...(dependencies.audioModel ? { audioModel: { ...dependencies.audioModel, db } } : {}) };
        const current = await bind(scoped), local = composeStaffInspectionTaskPolicies(scoped, options);
        await untouched(current);
        if (current.fingerprint !== before.fingerprint || !isDeepStrictEqual(await read(local), observed)) throw conflict();
        for (let index = 0; index < AI_INSPECTION_TASK_POLICY_OPERATIONS.length; index++) {
          if (observed[index].state === 'observed') continue;
          attempted = true;
          await local.configure(currentRequest, { reference, operation: AI_INSPECTION_TASK_POLICY_OPERATIONS[index], expectedRevision: null }, signal);
        }
        if ((await bind(scoped)).fingerprint !== before.fingerprint) throw conflict();
        await untouched(current);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      if ((await bind(dependencies)).fingerprint !== before.fingerprint
        || (await read(policies)).some(row => row.state !== 'observed')) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    }), 15000, 'staff_inspection_initial_policy_admission', signal);
  } catch (error) {
    if (attempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    throw error;
  } finally { signal?.removeEventListener('abort', close); close(); }
}
