import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiTaskInputRequest, type AiTaskInputReceipt } from '@prisma/client';
import { z } from 'zod';
import {
  AI_TASK_DRAFT_VERSION, AI_TASK_INPUT_DRAFT_VERSION, isAiTaskInputContractDraft,
  isAiTaskInputSubmissionDraft, validateAiTaskInputAnswersDraft,
  type AiTaskInputContractDraft, type AiTaskInputSubmissionDraft, type AiTaskEventDraft
} from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository, type AiTaskRepositoryOperation } from '../ai-task.repository';
import { evaluateAiTaskTransitionDraft, type AiTaskTransitionStateDraft } from '../task-transition-draft';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiTaskRunPlanSchema, type AiTaskPlanEvidenceAuthority } from '../runner/prisma-task-run-evidence.repository';
import type { AiTaskRunnerInputPort, AiTaskRunnerLease, AiTaskRunnerStepRef } from '../runner/ai-task-runner.ports';
import type { AiTaskInputBinding, AiTaskInputContext, AiTaskInputReader, AiTaskInputSource } from './task-input.ports';

type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskResultArtifact' | 'aiTaskInputRequest' | 'aiTaskInputReceipt'>;
type Tx = Prisma.TransactionClient;
type Access = Awaited<ReturnType<AiTaskRepository['resolveAccess']>>;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const maxRevision = 4294967294, maxFence = 99999999999999999999n, maxCursor = 18446744073709551615n;

function requestDigest(row: Omit<AiTaskInputRequest, 'requestHash' | 'createdAt' | 'status' | 'revision'>) {
  return requestFingerprint({ draftVersion: AI_TASK_INPUT_DRAFT_VERSION, scopeId: row.scopeId, taskId: row.taskId, id: row.id,
    runId: row.runId, stepId: row.stepId, planHash: row.planHash, planRevision: row.planRevision,
    inputRef: row.inputRef, inputHash: row.inputHash, contractCode: row.contractCode, contractVersion: row.contractVersion,
    contractHash: row.contractHash, allowedFields: row.allowedFields, basisResultRef: row.basisResultRef, createdBy: row.createdBy,
    leaseOwnerId: row.leaseOwnerId, fencingToken: row.fencingToken.toFixed(0), waitingTaskRevision: row.waitingTaskRevision,
    expiresAt: row.expiresAt.toISOString() });
}
function answerDigest(submission: AiTaskInputSubmissionDraft, request: AiTaskInputRequest) {
  return requestFingerprint({ ...submission, answers: [...submission.answers].sort((a, b) => a.fieldId.localeCompare(b.fieldId)), requestHash: request.requestHash });
}

export class PrismaTaskInputRepository implements AiTaskRunnerInputPort, AiTaskInputReader {
  constructor(private readonly db: Db, private readonly tasks: Pick<AiTaskRepository, 'resolveAccess'>,
    private readonly plans: AiTaskPlanEvidenceAuthority, private readonly source: AiTaskInputSource,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof db?.$transaction !== 'function' || typeof db?.aiTaskInputRequest?.create !== 'function'
      || typeof db?.aiTaskInputReceipt?.create !== 'function' || typeof tasks?.resolveAccess !== 'function'
      || typeof plans?.authorize !== 'function' || typeof source?.resolve !== 'function' || typeof source?.validateAnswers !== 'function') throw unavailable();
  }

  private async access(taskId: string, operation: AiTaskRepositoryOperation, before?: Access) {
    const access = await this.tasks.resolveAccess(taskId, operation);
    if (access.actorKind !== 'USER' || !['OPERATOR', 'STAFF'].includes(access.audience)
      || before && access.bindingKey !== before.bindingKey) throw denied();
    return access;
  }
  private async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try { return await this.db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 }); }
    catch (error) { if (error instanceof AiTaskRepositoryError) throw error; throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
  }
  private async task(tx: Tx, taskId: string, access: Access) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE id = ${taskId} FOR UPDATE`);
    const task = await tx.aiTask.findFirst({ where: access.where, include: { scope: true } });
    if (!task || task.id !== taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
      || task.audience !== access.audience || task.archivedAt !== null || task.contractVersion !== AI_TASK_DRAFT_VERSION
      || Object.entries(access.scope).some(([k, v]) => task.scope[k as keyof typeof task.scope] !== v)) throw unavailable();
    return task;
  }
  private async run(tx: Tx, taskId: string, scopeId: string, runId: string, access: Access) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${scopeId} AND taskId = ${taskId} AND id = ${runId} FOR UPDATE`);
    const run = await tx.aiRun.findFirst({ where: { id: runId, scopeId, taskId } });
    if (!run || run.id !== runId || run.scopeId !== scopeId || run.taskId !== taskId
      || run.actorId !== access.actorId || run.actorKind !== access.actorKind || !['QUEUED', 'RUNNING'].includes(run.status)
      || run.revision < 1 || run.revision > maxRevision || BigInt(run.fencingToken.toFixed(0)) >= maxFence) throw denied();
    return run;
  }
  private held(run: Awaited<ReturnType<PrismaTaskInputRepository['run']>>, lease: AiTaskRunnerLease) {
    if (run.id !== lease.runId || run.taskId !== lease.taskId || run.revision !== lease.revision || run.leaseOwnerId !== lease.holderId
      || run.fencingToken.toFixed(0) !== lease.fencingToken || !run.leaseExpiresAt || run.leaseExpiresAt <= this.clock()) throw conflict();
  }
  private async facts(tx: Tx, scopeId: string, taskId: string, runId: string, stepId: string, lease?: AiTaskRunnerLease) {
    const row = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId, taskId, runId } } });
    if (!row || row.scopeId !== scopeId || row.taskId !== taskId || row.runId !== runId) throw unavailable();
    const parsed = aiTaskRunPlanSchema.safeParse(row.payload);
    if (!parsed.success || parsed.data.taskId !== taskId || parsed.data.runId !== runId || requestFingerprint(parsed.data) !== row.planHash) throw denied();
    if (lease) {
      const proof = structuredClone(await this.plans.authorize(structuredClone(parsed.data), structuredClone(lease)));
      if (proof?.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion || !Number.isFinite(Date.parse(proof.expiresAt))
        || Date.parse(proof.expiresAt) <= this.clock().getTime()) throw denied();
    }
    const step = await tx.aiStep.findFirst({ where: { scopeId, taskId, runId, id: stepId } });
    if (!step || step.id !== stepId || step.scopeId !== scopeId || step.taskId !== taskId || step.runId !== runId || step.status !== 'SUCCEEDED' || !step.resultRef || !step.inputRef) throw unavailable();
    const access = await this.access(taskId, 'read_metadata');
    const index = parsed.data.steps.findIndex(p => step.actionId === `ai-action-${requestFingerprint({ version: 'ai-step-registration-1', scope: access.scope, taskId, registrationRef: p.registrationRef })}`);
    const planned = parsed.data.steps[index];
    if (!planned || planned.toolCode !== step.toolCode || planned.toolVersion !== step.toolVersion) throw denied();
    const artifact = await tx.aiTaskResultArtifact.findUnique({ where: { scopeId_taskId_id: { scopeId, taskId, id: step.resultRef } } });
    if (!artifact || artifact.id !== step.resultRef || artifact.scopeId !== scopeId || artifact.taskId !== taskId || artifact.runId !== runId
      || artifact.stepId !== stepId || artifact.actionId !== step.actionId || artifact.stepFingerprint !== step.requestFingerprint
      || artifact.outcome !== 'SUCCEEDED' || !artifact.completeMeasurement || artifact.activeMs < 0n
      || artifact.contentHash !== requestFingerprint(artifact.payload) || artifact.outputBytes !== BigInt(Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8'))) throw denied();
    const binding: AiTaskInputBinding = { scopeId, taskId, runId, stepId, registrationRef: planned.registrationRef,
      toolCode: step.toolCode, toolVersion: step.toolVersion, planHash: row.planHash, planRevision: parsed.data.taskRevision,
      inputRef: step.inputRef, inputHash: step.requestFingerprint, basisResultRef: artifact.id };
    return { binding, step, artifact, plan: parsed.data, planned, index };
  }
  private async requirement(binding: AiTaskInputBinding) {
    const result = structuredClone(await this.source.resolve(structuredClone(binding)));
    if (result?.kind === 'not_required' && Object.keys(result).length === 1) return result;
    if (result?.kind !== 'required' || !isAiTaskInputContractDraft(result.contract) || result.inputRef !== binding.inputRef
      || result.inputHash !== binding.inputHash || !Number.isFinite(Date.parse(result.expiresAt))) throw unavailable();
    return result;
  }
  private validateRequest(request: AiTaskInputRequest, binding: AiTaskInputBinding, access: Access) {
    const contract = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, code: request.contractCode, version: request.contractVersion, fields: request.allowedFields };
    if (request.scopeId !== binding.scopeId || request.taskId !== binding.taskId || request.runId !== binding.runId || request.stepId !== binding.stepId
      || request.planHash !== binding.planHash || request.planRevision !== binding.planRevision || request.inputRef !== binding.inputRef
      || request.inputHash !== binding.inputHash || request.basisResultRef !== binding.basisResultRef || request.createdBy !== access.actorId
      || !isAiTaskInputContractDraft(contract) || requestFingerprint(contract) !== request.contractHash || requestDigest(request) !== request.requestHash
      || !['PENDING', 'CONSUMED'].includes(request.status) || !Number.isInteger(request.revision) || request.revision < 1 || request.revision > maxRevision) throw denied();
    return contract;
  }
  private async validateAnswers(binding: AiTaskInputBinding, contract: AiTaskInputContractDraft, answers: AiTaskInputSubmissionDraft['answers']) {
    if (!validateAiTaskInputAnswersDraft(contract, answers)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const proof = structuredClone(await this.source.validateAnswers(structuredClone(binding), structuredClone(contract), structuredClone(answers)));
    if (proof?.disposition !== 'context_only' || proof.planHash !== binding.planHash || proof.inputRef !== binding.inputRef || proof.inputHash !== binding.inputHash) throw unavailable();
    const current = await this.requirement(binding);
    if (current.kind !== 'required' || requestFingerprint(current.contract) !== requestFingerprint(contract)) throw denied();
  }
  private receipt(request: AiTaskInputRequest, receipt: AiTaskInputReceipt | null, access: Access, submission?: AiTaskInputSubmissionDraft) {
    const original: AiTaskInputSubmissionDraft = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: request.taskId, requestId: request.id,
      expectedRevision: request.revision - 1, submissionKey: receipt?.submissionKey ?? '', answers: receipt?.answers as unknown as AiTaskInputSubmissionDraft['answers'] };
    if (!receipt || request.status !== 'CONSUMED' || request.revision !== 2 || receipt.scopeId !== request.scopeId || receipt.taskId !== request.taskId
      || receipt.requestId !== request.id || receipt.planHash !== request.planHash || receipt.actorKind !== access.actorKind || receipt.actorId !== access.actorId
      || receipt.audience !== access.audience || !receipt.consumedAt || receipt.consumedAt > request.expiresAt
      || receipt.consumedTaskRevision !== request.waitingTaskRevision + 1 || !isAiTaskInputSubmissionDraft(original)
      || answerDigest(original, request) !== receipt.answerHash || submission && answerDigest(submission, request) !== receipt.answerHash) throw conflict();
    return receipt;
  }

  async afterSucceeded(ref: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    ref = structuredClone(ref); lease = structuredClone(lease);
    const before = await this.access(lease.taskId, 'request_input');
    return this.transaction(async tx => {
      const task = await this.task(tx, lease.taskId, before), run = await this.run(tx, task.id, task.scopeId, lease.runId, before);
      this.held(run, lease);
      if (task.status !== 'RUNNING' || task.cancelRequestedAt !== null || task.revision !== ref.registered.taskRevision) throw conflict();
      const facts = await this.facts(tx, task.scopeId, task.id, run.id, ref.registered.stepId, lease);
      if (ref.registered.runId !== run.id || ref.registered.stepRevision !== facts.step.revision || requestFingerprint(ref.plan) !== requestFingerprint(facts.planned)) throw denied();
      const prior = await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_runId_stepId_planHash: {
        scopeId: task.scopeId, taskId: task.id, runId: run.id, stepId: facts.step.id, planHash: facts.binding.planHash } } });
      const requirement = await this.requirement(facts.binding);
      if (prior) {
        const contract = this.validateRequest(prior, facts.binding, before);
        const receipt = this.receipt(prior, await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_requestId: { scopeId: task.scopeId, taskId: task.id, requestId: prior.id } } }), before);
        if (requirement.kind !== 'required' || requestFingerprint(requirement.contract) !== prior.contractHash) throw denied();
        await this.validateAnswers(facts.binding, contract, receipt.answers as unknown as AiTaskInputSubmissionDraft['answers']);
        await this.access(task.id, 'request_input', before);
        return null;
      }
      if (requirement.kind === 'not_required') { await this.access(task.id, 'request_input', before); return null; }
      if (facts.planned.operation !== 'readonly' || facts.step.effect !== 'NONE' || Date.parse(requirement.expiresAt) <= this.clock().getTime()) throw unavailable();
      const steps = await tx.aiStep.findMany({ where: { scopeId: task.scopeId, taskId: task.id }, take: 1001 });
      const pending = facts.plan.steps.slice(facts.index + 1).some(p => {
        const action = `ai-action-${requestFingerprint({ version: 'ai-step-registration-1', scope: before.scope, taskId: task.id, registrationRef: p.registrationRef })}`;
        const step = steps.find(s => s.actionId === action); return !step || step.runId === run.id && step.status === 'PENDING';
      });
      if (!pending) throw unavailable();
      const charges = await tx.aiTaskExecutionCharge.findMany({ where: { scopeId: task.scopeId, taskId: task.id, runId: run.id, stepId: facts.step.id }, take: 5 });
      if (charges.length < 3 || charges.length > 4 || new Set(charges.map(c => c.resource)).size !== charges.length
        || !['STEPS', 'ACTIVE_MS', 'OUTPUT_BYTES'].every(r => charges.some(c => c.resource === r))
        || charges.some(c => c.status !== 'RECORDED' || c.actionId !== facts.step.actionId || c.stepFingerprint !== facts.step.requestFingerprint
          || c.leaseOwnerId !== facts.artifact.leaseOwnerId || c.fencingToken.toFixed(0) !== facts.artifact.fencingToken.toFixed(0))) throw unavailable();
      this.transition(task, steps, 'waiting_input', 'input_required');
      const again = await this.requirement(facts.binding);
      if (requestFingerprint(again) !== requestFingerprint(requirement)) throw denied();
      const current = await this.access(task.id, 'request_input', before);
      const data = { scopeId: task.scopeId, taskId: task.id, id: randomUUID(), runId: run.id, stepId: facts.step.id,
        planHash: facts.binding.planHash, planRevision: facts.binding.planRevision, inputRef: facts.binding.inputRef, inputHash: facts.binding.inputHash,
        contractCode: requirement.contract.code, contractVersion: requirement.contract.version, contractHash: requestFingerprint(requirement.contract),
        allowedFields: structuredClone(requirement.contract.fields) as unknown as Prisma.InputJsonValue, basisResultRef: facts.artifact.id,
        createdBy: current.actorId, leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), waitingTaskRevision: task.revision + 1,
        expiresAt: new Date(requirement.expiresAt) };
      await tx.aiTaskInputRequest.create({ data: { ...data, requestHash: requestDigest(data as Omit<AiTaskInputRequest, 'requestHash' | 'createdAt' | 'status' | 'revision'>), status: 'PENDING', revision: 1 } });
      if ((await tx.aiRun.updateMany({ where: { id: run.id, scopeId: task.scopeId, taskId: task.id, revision: run.revision, fencingToken: run.fencingToken,
        leaseOwnerId: lease.holderId, leaseExpiresAt: { gt: this.clock() }, actorKind: current.actorKind, actorId: current.actorId, status: run.status }, data: { revision: { increment: 1 } } })).count !== 1) throw conflict();
      await this.publish(tx, task, current, 'waiting_input', 'input_required', { requestId: data.id }, lease.holderId);
      return { taskRevision: task.revision + 1, lease: { ...lease, revision: run.revision + 1 } };
    });
  }

  private transition(task: { id: string; status: string; revision: number; eventCursor: bigint }, steps: Array<{ id: string; runId: string; sequence: number; revision: number; actionId: string; status: string; effect: string }>,
    to: 'running' | 'waiting_input', reason: 'resume' | 'input_required') {
    if (task.revision > maxRevision || task.eventCursor >= maxCursor) throw conflict();
    const state: AiTaskTransitionStateDraft = { contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, revision: task.revision,
      status: task.status.toLowerCase() as AiTaskTransitionStateDraft['status'], steps: steps.map(s => ({ stepId: s.id, runId: s.runId, sequence: s.sequence,
        revision: s.revision, actionId: s.actionId, outcome: { status: s.status.toLowerCase(), effect: s.effect.toLowerCase() } as AiTaskTransitionStateDraft['steps'][number]['outcome'] })) };
    if (!evaluateAiTaskTransitionDraft(state, { contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, expectedRevision: task.revision,
      to, reason, occurredAt: this.clock().toISOString(), initiator: { kind: 'system', id: 'task-input' } }).allowed) throw unavailable();
  }
  private async publish(tx: Tx, task: { id: string; scopeId: string; revision: number; status: string; eventCursor: bigint }, access: Access,
    to: 'running' | 'waiting_input', reason: 'resume' | 'input_required', evidence: { requestId: string; receiptId?: string }, holder?: string) {
    const changed = await tx.aiTask.updateMany({ where: { ...access.where, scopeId: task.scopeId, status: task.status as 'RUNNING' | 'WAITING_INPUT',
      revision: task.revision, eventCursor: task.eventCursor, cancelRequestedAt: null },
      data: { status: to === 'running' ? 'RUNNING' : 'WAITING_INPUT', revision: { increment: 1 }, eventCursor: { increment: 1n } } });
    if (changed.count !== 1) throw conflict();
    const data = { from: task.status.toLowerCase(), to, reason } as Extract<AiTaskEventDraft, { type: 'task.transition' }>['data'];
    await tx.aiTaskEvent.create({ data: { scopeId: task.scopeId, taskId: task.id, cursor: task.eventCursor + 1n,
      taskRevision: task.revision + 1, type: 'task.transition', occurredAt: this.clock(), payload: { data, input: evidence,
        initiator: { kind: holder ? 'worker' : 'user', id: holder ?? access.actorId, actorKind: access.actorKind, actorId: access.actorId } } } });
  }

  async readPending(taskId: string) {
    const before = await this.access(taskId, 'read_metadata');
    return this.transaction(async tx => {
      const task = await this.task(tx, taskId, before);
      if (task.status !== 'WAITING_INPUT' || task.cancelRequestedAt !== null) return null;
      const requests = await tx.aiTaskInputRequest.findMany({ where: { scopeId: task.scopeId, taskId, waitingTaskRevision: task.revision, status: 'PENDING' }, take: 2 });
      if (requests.length !== 1) throw unavailable();
      const request = requests[0], run = await this.run(tx, taskId, task.scopeId, request.runId, before);
      const facts = await this.facts(tx, task.scopeId, taskId, run.id, request.stepId);
      const contract = this.validateRequest(request, facts.binding, before);
      const requirement = await this.requirement(facts.binding);
      if (requirement.kind !== 'required' || requestFingerprint(requirement.contract) !== request.contractHash) throw unavailable();
      if (run.fencingToken.toFixed(0) !== request.fencingToken.toFixed(0) || request.expiresAt <= this.clock()) throw unavailable();
      await this.access(taskId, 'read_metadata', before);
      return { requestId: request.id, revision: request.revision, expiresAt: request.expiresAt.toISOString(), contract };
    });
  }

  async submit(value: unknown) {
    const submission = structuredClone(value);
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = await this.access(submission.taskId, 'read_metadata');
    return this.transaction(async tx => {
      const task = await this.task(tx, submission.taskId, before);
      const request = await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: { scopeId: task.scopeId, taskId: task.id, id: submission.requestId } } });
      if (!request || request.id !== submission.requestId) throw unavailable();
      const run = await this.run(tx, task.id, task.scopeId, request.runId, before);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_task_input_requests WHERE scopeId = ${task.scopeId} AND taskId = ${task.id} AND id = ${request.id} FOR UPDATE`);
      const facts = await this.facts(tx, task.scopeId, task.id, run.id, request.stepId);
      const contract = this.validateRequest(request, facts.binding, before);
      const existing = await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_submissionKey: { scopeId: task.scopeId, taskId: task.id, submissionKey: submission.submissionKey } } });
      if (existing) {
        const receipt = this.receipt(request, existing, before, submission);
        await this.access(task.id, 'read_metadata', before);
        return { status: 'input_received' as const, taskId: task.id, requestId: request.id, receiptId: receipt.id, taskRevision: receipt.consumedTaskRevision!, replayed: true };
      }
      if (task.status !== 'WAITING_INPUT' || task.cancelRequestedAt !== null || task.revision !== request.waitingTaskRevision
        || request.status !== 'PENDING' || request.revision !== 1 || submission.expectedRevision !== request.revision
        || request.expiresAt <= this.clock() || run.fencingToken.toFixed(0) !== request.fencingToken.toFixed(0)
        || !(run.leaseOwnerId === null && run.leaseExpiresAt === null || run.leaseOwnerId !== null && run.leaseExpiresAt !== null && run.leaseExpiresAt <= this.clock())) throw conflict();
      await this.access(task.id, 'submit_input', before);
      await this.access(task.id, 'resume_input', before);
      const requirement = await this.requirement(facts.binding);
      if (requirement.kind !== 'required' || requestFingerprint(requirement.contract) !== request.contractHash) throw denied();
      await this.validateAnswers(facts.binding, contract, submission.answers);
      const steps = await tx.aiStep.findMany({ where: { scopeId: task.scopeId, taskId: task.id }, take: 1001 });
      this.transition(task, steps, 'running', 'resume');
      await this.access(task.id, 'submit_input', before);
      const current = await this.access(task.id, 'resume_input', before);
      if (request.expiresAt <= this.clock()) throw conflict();
      if ((await tx.aiRun.updateMany({ where: { id: run.id, taskId: task.id, scopeId: task.scopeId, revision: run.revision, fencingToken: run.fencingToken,
        leaseOwnerId: run.leaseOwnerId, leaseExpiresAt: run.leaseExpiresAt, status: run.status, actorId: current.actorId, actorKind: current.actorKind },
        data: { revision: { increment: 1 }, fencingToken: { increment: new Prisma.Decimal(1) }, leaseOwnerId: null, leaseExpiresAt: null } })).count !== 1) throw conflict();
      const receiptId = randomUUID();
      await tx.aiTaskInputReceipt.create({ data: { scopeId: task.scopeId, taskId: task.id, id: receiptId, requestId: request.id, planHash: request.planHash,
        submissionKey: submission.submissionKey, answerHash: answerDigest(submission, request), answers: structuredClone(submission.answers) as unknown as Prisma.InputJsonValue,
        actorKind: current.actorKind, actorId: current.actorId, audience: current.audience, consumedAt: this.clock(), consumedTaskRevision: task.revision + 1 } });
      if ((await tx.aiTaskInputRequest.updateMany({ where: { scopeId: task.scopeId, taskId: task.id, id: request.id, revision: request.revision,
        status: 'PENDING', requestHash: request.requestHash, fencingToken: request.fencingToken, expiresAt: { gt: this.clock() } },
        data: { status: 'CONSUMED', revision: { increment: 1 } } })).count !== 1) throw conflict();
      await this.publish(tx, task, current, 'running', 'resume', { requestId: request.id, receiptId });
      return { status: 'input_received' as const, taskId: task.id, requestId: request.id, receiptId, taskRevision: task.revision + 1, replayed: false };
    });
  }

  async readForStep(lease: AiTaskRunnerLease, registrationRef: string): Promise<readonly AiTaskInputContext[]> {
    lease = structuredClone(lease);
    if (!id.safeParse(registrationRef).success) throw denied();
    const before = await this.access(lease.taskId, 'read_metadata');
    return this.transaction(async tx => {
      const task = await this.task(tx, lease.taskId, before), run = await this.run(tx, task.id, task.scopeId, lease.runId, before);
      this.held(run, lease);
      if (task.status !== 'RUNNING' || task.cancelRequestedAt !== null) throw denied();
      const requests = await tx.aiTaskInputRequest.findMany({ where: { scopeId: task.scopeId, taskId: task.id, runId: run.id }, take: 1001 });
      if (requests.length > 1000) throw unavailable();
      const results: AiTaskInputContext[] = [];
      for (const request of requests) {
        const facts = await this.facts(tx, task.scopeId, task.id, run.id, request.stepId, lease);
        const currentIndex = facts.plan.steps.findIndex(p => p.registrationRef === registrationRef);
        if (currentIndex < 0) throw denied();
        if (currentIndex <= facts.index) continue;
        const contract = this.validateRequest(request, facts.binding, before);
        const receipt = this.receipt(request, await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_requestId: { scopeId: task.scopeId, taskId: task.id, requestId: request.id } } }), before);
        await this.validateAnswers(facts.binding, contract, receipt.answers as unknown as AiTaskInputSubmissionDraft['answers']);
        results.push({ requestId: request.id, receiptId: receipt.id, answers: structuredClone(receipt.answers) as unknown as AiTaskInputSubmissionDraft['answers'] });
      }
      await this.access(task.id, 'read_metadata', before);
      const live = await this.run(tx, task.id, task.scopeId, run.id, before); this.held(live, lease);
      return results;
    });
  }
}
