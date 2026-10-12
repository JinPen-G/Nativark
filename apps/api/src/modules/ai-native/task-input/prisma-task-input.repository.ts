import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type AiTaskInputRequest, type AiTaskInputReceipt } from '@prisma/client';
import { z } from 'zod';
import {
  AI_TASK_DRAFT_VERSION, AI_TASK_INPUT_DRAFT_VERSION, AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE, isAiTaskInputContractDraft,
  isAiTaskInputSubmissionDraft, validateAiTaskInputAnswersDraft,
  type AiTaskInputContractDraft, type AiTaskInputSubmissionDraft, type AiTaskEventDraft
} from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository, type AiTaskRepositoryOperation } from '../ai-task.repository';
import { evaluateAiTaskTransitionDraft, type AiTaskTransitionStateDraft } from '../task-transition-draft';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiTaskRunPlanSchema, type AiTaskPlanEvidenceAuthority } from '../runner/prisma-task-run-evidence.repository';
import type { AiTaskRunnerInputPort, AiTaskRunnerLease, AiTaskRunnerStepRef } from '../runner/ai-task-runner.ports';
import type { AiTaskInputBinding, AiTaskInputContext, AiTaskInputReader, AiTaskInputSource } from './task-input.ports';
import { AiTaskInputResultUnknownError } from './task-input.errors';

type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskResultArtifact' | 'aiTaskInputRequest' | 'aiTaskInputReceipt'>;
type Tx = Prisma.TransactionClient;
type Access = Awaited<ReturnType<AiTaskRepository['resolveAccess']>>;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const maxRevision = 4294967294, maxFence = 99999999999999999999n, maxCursor = 18446744073709551615n;
const continuableModel = (tool: string) => tool === AI_TEXT_MODEL_STEP_CODE || tool === AI_IMAGE_MODEL_STEP_CODE || tool === AI_AUDIO_MODEL_STEP_CODE;

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

/** A higher question revision is valid only with its transaction's immutable
 * archive chain. Never accept a caller/database revision bump on its own. */
async function verifyQuestionHistory(tx: Tx, request: AiTaskInputRequest) {
  let row = request, version = request.revision - (request.status === 'CONSUMED' ? 1 : 0);
  if (!Number.isInteger(version) || version < 1 || version > 32) throw denied();
  while (version > 1) {
    const event = await tx.aiTaskEvent.findFirst({ where: { scopeId: row.scopeId, taskId: row.taskId,
      taskRevision: row.waitingTaskRevision, type: 'task.input_refreshed' } });
    const parsed = z.object({ data: z.object({ requestId: id, previousRevision: z.number().int(), revision: z.number().int() }),
      previousRequest: z.record(z.unknown()), nextRequestHash: z.string() }).safeParse(event?.payload);
    if (!parsed.success || parsed.data.data.requestId !== request.id || parsed.data.data.revision !== version
      || parsed.data.data.previousRevision !== version - 1 || parsed.data.nextRequestHash !== row.requestHash) throw denied();
    const raw = parsed.data.previousRequest;
    const previous = { ...raw, fencingToken: new Prisma.Decimal(String(raw.fencingToken)),
      createdAt: new Date(String(raw.createdAt)), expiresAt: new Date(String(raw.expiresAt)) } as unknown as AiTaskInputRequest;
    if (previous.id !== row.id || previous.scopeId !== row.scopeId || previous.taskId !== row.taskId
      || previous.runId !== row.runId || previous.stepId !== row.stepId || previous.planHash !== row.planHash
      || previous.planRevision !== row.planRevision || previous.inputRef !== row.inputRef || previous.inputHash !== row.inputHash
      || previous.basisResultRef !== row.basisResultRef || previous.createdBy !== row.createdBy
      || previous.leaseOwnerId !== row.leaseOwnerId || previous.fencingToken.toFixed(0) !== row.fencingToken.toFixed(0)
      || previous.waitingTaskRevision + 1 !== row.waitingTaskRevision || previous.status !== 'PENDING'
      || previous.revision !== version - 1 || previous.expiresAt < row.expiresAt
      || requestDigest(previous) !== previous.requestHash) throw denied();
    row = previous; version--;
  }
}

/** Read provenance, never a lease or permission to dispatch. The original run
 * remains the resource origin; every successor must have a consumed, bound
 * human answer and a completed single-model parent. No "latest run" lookup. */
export async function readTaskModelRunOrigin(tx: Tx, access: Access,
  key: { scopeId: string; taskId: string; runId: string; originRunId: string; registrationRef: string; includeHistory?: boolean }) {
  let cursor = key.runId, selectedRegistration = key.registrationRef;
  let continuation: { receiptId: string; inputHash: string; input: Prisma.JsonValue;
    result: Prisma.JsonValue; answers: AiTaskInputSubmissionDraft['answers']; contract: AiTaskInputContractDraft; questionRevision: number } | undefined;
  let lineageTool: string | undefined;
  const history: NonNullable<typeof continuation>[] = [];
  const seen = new Set<string>();
  for (let count = 0; count < 1000; count++) {
    if (seen.has(cursor)) throw denied();
    seen.add(cursor);
    const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: cursor } });
    if (!run || run.id !== cursor || run.scopeId !== key.scopeId || run.taskId !== key.taskId
      || run.actorKind !== access.actorKind || run.actorId !== access.actorId) throw denied();
    if (cursor === key.originRunId) {
      if (run.sequence !== 1 || run.inputReceiptId != null || run.resourceOriginRunId != null) throw denied();
      return { registrationRef: selectedRegistration, continuation, history: history.reverse() };
    }
    if (run.resourceOriginRunId !== key.originRunId || !run.inputReceiptId || run.sequence < 2) throw denied();
    const receipt = await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_id: {
      scopeId: key.scopeId, taskId: key.taskId, id: run.inputReceiptId } } });
    if (!receipt || receipt.id !== run.inputReceiptId || receipt.scopeId !== key.scopeId || receipt.taskId !== key.taskId
      || receipt.actorKind !== access.actorKind || receipt.actorId !== access.actorId || receipt.audience !== access.audience) throw denied();
    const request = await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: {
      scopeId: key.scopeId, taskId: key.taskId, id: receipt.requestId } } });
    if (!request || request.id !== receipt.requestId || request.scopeId !== key.scopeId || request.taskId !== key.taskId
      || request.status !== 'CONSUMED' || request.revision < 2 || request.revision > maxRevision || request.createdBy !== access.actorId
      || receipt.planHash !== request.planHash || !receipt.consumedAt || receipt.consumedAt > request.expiresAt
      || receipt.consumedTaskRevision !== request.waitingTaskRevision + 1 || requestDigest(request) !== request.requestHash) throw denied();
    await verifyQuestionHistory(tx, request);
    const submission = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: key.taskId, requestId: request.id,
      expectedRevision: request.revision - 1, submissionKey: receipt.submissionKey, answers: receipt.answers };
    const contract = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, code: request.contractCode, version: request.contractVersion, fields: request.allowedFields };
    if (!isAiTaskInputSubmissionDraft(submission) || !isAiTaskInputContractDraft(contract)
      || requestFingerprint(contract) !== request.contractHash || !validateAiTaskInputAnswersDraft(contract, submission.answers)
      || answerDigest(submission, request) !== receipt.answerHash) throw denied();
    const parent = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: request.runId } });
    const savedPlan = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: {
      scopeId: key.scopeId, taskId: key.taskId, runId: request.runId } } });
    if (!parent || parent.id !== request.runId || parent.scopeId !== key.scopeId || parent.taskId !== key.taskId
      || parent.status !== 'SUCCEEDED' || parent.sequence + 1 !== run.sequence || parent.actorId !== access.actorId
      || parent.actorKind !== access.actorKind || !savedPlan || savedPlan.scopeId !== key.scopeId
      || savedPlan.taskId !== key.taskId || savedPlan.runId !== parent.id) throw denied();
    const plan = aiTaskRunPlanSchema.parse(savedPlan.payload), planned = plan.steps[0];
    if (lineageTool !== undefined && planned.toolCode !== lineageTool) throw denied();
    lineageTool = planned.toolCode;
    const step = await tx.aiStep.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: parent.id, id: request.stepId } });
    if (plan.taskId !== key.taskId || plan.runId !== parent.id || plan.taskRevision !== request.planRevision
      || requestFingerprint(plan) !== savedPlan.planHash || savedPlan.planHash !== request.planHash
      || plan.steps.length !== 1 || !continuableModel(planned.toolCode) || planned.operation !== 'external_unknown'
      || !step || step.id !== request.stepId || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== parent.id
      || step.status !== 'SUCCEEDED' || step.effect !== 'NONE' || step.inputRef !== request.inputRef
      || step.requestFingerprint !== request.inputHash || step.resultRef !== request.basisResultRef
      || step.toolCode !== planned.toolCode || step.toolVersion !== planned.toolVersion) throw denied();
    const input = await tx.aiTaskActionInput.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId,
      runId: parent.id, id: request.inputRef } });
    const artifact = await tx.aiTaskResultArtifact.findUnique({ where: { scopeId_taskId_id: {
      scopeId: key.scopeId, taskId: key.taskId, id: request.basisResultRef } } });
    if (!input || input.scopeId !== key.scopeId || input.taskId !== key.taskId || input.runId !== parent.id
      || input.id !== request.inputRef || input.registrationRef !== planned.registrationRef
      || input.fingerprint !== request.inputHash || input.toolCode !== planned.toolCode || input.toolVersion !== planned.toolVersion
      || !artifact || artifact.scopeId !== key.scopeId || artifact.taskId !== key.taskId || artifact.runId !== parent.id
      || artifact.id !== request.basisResultRef || artifact.stepId !== step.id || artifact.actionId !== step.actionId
      || artifact.stepFingerprint !== request.inputHash || artifact.outcome !== 'SUCCEEDED' || !artifact.completeMeasurement
      || artifact.contentHash !== requestFingerprint(artifact.payload)
      || artifact.outputBytes !== BigInt(Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8'))) throw denied();
    if (cursor === key.runId) {
      selectedRegistration = `model-followup-${receipt.id}`;
      continuation = { receiptId: receipt.id, inputHash: input.fingerprint,
        input: structuredClone(input.payload), result: structuredClone(artifact.payload), answers: structuredClone(submission.answers), contract: structuredClone(contract), questionRevision: request.revision - 1 };
    }
    if (key.includeHistory) {
      if (history.length >= 31) throw unavailable();
      history.push({ receiptId: receipt.id, inputHash: input.fingerprint,
        input: structuredClone(input.payload), result: structuredClone(artifact.payload), answers: structuredClone(submission.answers), contract: structuredClone(contract), questionRevision: request.revision - 1 });
    }
    cursor = parent.id;
  }
  throw unavailable();
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
    const supportedActor = access.actorKind === 'USER' && ['OPERATOR', 'STAFF'].includes(access.audience)
      || access.actorKind === 'CUSTOMER' && access.audience === 'CLIENT';
    if (!supportedActor
      || before && access.bindingKey !== before.bindingKey) throw denied();
    return access;
  }
  private async transaction<T>(work: (tx: Tx) => Promise<T>, mayWrite = false): Promise<T> {
    let callbackCompleted = false;
    try { return await this.db.$transaction(async tx => {
      const result = await work(tx);
      callbackCompleted = true;
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 }); }
    catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (mayWrite && callbackCompleted) throw new AiTaskInputResultUnknownError();
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }
  private writeTransaction<T>(work: (tx: Tx) => Promise<T>) { return this.transaction(work, true); }
  private async task(tx: Tx, taskId: string, access: Access) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE id = ${taskId} FOR UPDATE`);
    const task = await tx.aiTask.findFirst({ where: access.where, include: { scope: true } });
    if (!task || task.id !== taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
      || task.audience !== access.audience || task.archivedAt !== null || task.contractVersion !== AI_TASK_DRAFT_VERSION
      || Object.entries(access.scope).some(([k, v]) => task.scope[k as keyof typeof task.scope] !== v)) throw unavailable();
    return task;
  }
  private async run(tx: Tx, taskId: string, scopeId: string, runId: string, access: Access, completed = false) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${scopeId} AND taskId = ${taskId} AND id = ${runId} FOR UPDATE`);
    const run = await tx.aiRun.findFirst({ where: { id: runId, scopeId, taskId } });
    if (!run || run.id !== runId || run.scopeId !== scopeId || run.taskId !== taskId
      || run.actorId !== access.actorId || run.actorKind !== access.actorKind || !['QUEUED', 'RUNNING', ...(completed ? ['SUCCEEDED'] : [])].includes(run.status)
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
    const access = await this.tasks.resolveAccess(taskId, 'read_metadata');
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
    if (!proof || !['context_only', 'business_parameters'].includes(proof.disposition)
      || proof.planHash !== binding.planHash || proof.inputRef !== binding.inputRef || proof.inputHash !== binding.inputHash) throw unavailable();
    if (proof.disposition === 'business_parameters' && (proof.contractHash !== requestFingerprint(contract)
      || proof.answersHash !== requestFingerprint(answers) || proof.bindingHash !== requestFingerprint(binding))) throw denied();
    const current = await this.requirement(binding);
    if (current.kind !== 'required' || requestFingerprint(current.contract) !== requestFingerprint(contract)) throw denied();
  }
  private receipt(request: AiTaskInputRequest, receipt: AiTaskInputReceipt | null, access: Access, submission?: AiTaskInputSubmissionDraft) {
    const original: AiTaskInputSubmissionDraft = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: request.taskId, requestId: request.id,
      expectedRevision: request.revision - 1, submissionKey: receipt?.submissionKey ?? '', answers: receipt?.answers as unknown as AiTaskInputSubmissionDraft['answers'] };
    if (!receipt || request.status !== 'CONSUMED' || request.revision < 2 || receipt.scopeId !== request.scopeId || receipt.taskId !== request.taskId
      || receipt.requestId !== request.id || receipt.planHash !== request.planHash || receipt.actorKind !== access.actorKind || receipt.actorId !== access.actorId
      || receipt.audience !== access.audience || !receipt.consumedAt || receipt.consumedAt > request.expiresAt
      || receipt.consumedTaskRevision !== request.waitingTaskRevision + 1 || !isAiTaskInputSubmissionDraft(original)
      || answerDigest(original, request) !== receipt.answerHash || submission && answerDigest(submission, request) !== receipt.answerHash) throw conflict();
    return receipt;
  }

  async afterSucceeded(ref: AiTaskRunnerStepRef, lease: AiTaskRunnerLease) {
    ref = structuredClone(ref); lease = structuredClone(lease);
    const before = await this.tasks.resolveAccess(lease.taskId, 'read_step_terminal');
    return this.writeTransaction(async tx => {
      const task = await this.task(tx, lease.taskId, before), run = await this.run(tx, task.id, task.scopeId, lease.runId, before);
      this.held(run, lease);
      if (task.status !== 'RUNNING' || task.cancelRequestedAt !== null || task.revision !== ref.registered.taskRevision) throw conflict();
      const facts = await this.facts(tx, task.scopeId, task.id, run.id, ref.registered.stepId, lease);
      if (ref.registered.runId !== run.id || ref.registered.stepRevision !== facts.step.revision || requestFingerprint(ref.plan) !== requestFingerprint(facts.planned)) throw denied();
      const prior = await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_runId_stepId_planHash: {
        scopeId: task.scopeId, taskId: task.id, runId: run.id, stepId: facts.step.id, planHash: facts.binding.planHash } } });
      const requirement = await this.requirement(facts.binding);
      if (prior) {
        await this.access(task.id, 'request_input', before);
        const contract = this.validateRequest(prior, facts.binding, before);
        await verifyQuestionHistory(tx, prior);
        const receipt = this.receipt(prior, await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_requestId: { scopeId: task.scopeId, taskId: task.id, requestId: prior.id } } }), before);
        if (requirement.kind !== 'required' || requestFingerprint(requirement.contract) !== prior.contractHash) throw denied();
        await this.validateAnswers(facts.binding, contract, receipt.answers as unknown as AiTaskInputSubmissionDraft['answers']);
        await this.access(task.id, 'request_input', before);
        return null;
      }
      // Completing a single turn does not grant permission to create a clarification.
      if (requirement.kind === 'not_required') {
        if ((await this.tasks.resolveAccess(task.id, 'read_step_terminal')).bindingKey !== before.bindingKey) throw denied();
        return null;
      }
      await this.access(task.id, 'request_input', before);
      const modelContinuation = facts.planned.operation === 'external_unknown' && continuableModel(facts.planned.toolCode)
        && facts.plan.steps.length === 1;
      if ((!modelContinuation && facts.planned.operation !== 'readonly') || facts.step.effect !== 'NONE'
        || Date.parse(requirement.expiresAt) <= this.clock().getTime()) throw unavailable();
      const steps = await tx.aiStep.findMany({ where: { scopeId: task.scopeId, taskId: task.id }, take: 1001 });
      const pending = facts.plan.steps.slice(facts.index + 1).some(p => {
        const action = `ai-action-${requestFingerprint({ version: 'ai-step-registration-1', scope: before.scope, taskId: task.id, registrationRef: p.registrationRef })}`;
        const step = steps.find(s => s.actionId === action); return !step || step.runId === run.id && step.status === 'PENDING';
      });
      if (!pending && !modelContinuation) throw unavailable();
      const charges = await tx.aiTaskExecutionCharge.findMany({ where: { scopeId: task.scopeId, taskId: task.id, runId: run.id, stepId: facts.step.id }, take: 5 });
      if (charges.length < 3 || charges.length > 4 || new Set(charges.map(c => c.resource)).size !== charges.length
        || !['STEPS', 'ACTIVE_MS', 'OUTPUT_BYTES'].every(r => charges.some(c => c.resource === r))
        || modelContinuation && (charges.length !== 4 || !charges.some(c => c.resource === 'CALLS' && c.gatewayInvocationId))
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

  /** Called only while the aggregate cancellation transaction owns the task
   * lock. A released, fully measured model wait is proof; lease expiry is not. */
  async closeCancelledInputWait(tx: Tx, key: { id: string; scopeId: string; revision: number }) {
    const before = await this.access(key.id, 'transition_task');
    const task = await this.task(tx, key.id, before);
    // The enclosing aggregate CAS already reserved its next revision.
    if (task.scopeId !== key.scopeId || task.status !== 'CANCEL_REQUESTED' || !task.cancelRequestedAt
      || task.revision !== key.revision + 1) throw conflict();
    const requests = await tx.aiTaskInputRequest.findMany({ where: { scopeId: key.scopeId, taskId: key.id,
      waitingTaskRevision: key.revision - 1, status: 'PENDING' }, take: 2 });
    if (requests.length !== 1) throw unavailable();
    const request = requests[0], run = await this.run(tx, key.id, key.scopeId, request.runId, before);
    if (run.status !== 'RUNNING' || run.leaseOwnerId !== null || run.leaseExpiresAt !== null
      || run.fencingToken.toFixed(0) !== request.fencingToken.toFixed(0)) throw unavailable();
    const facts = await this.facts(tx, key.scopeId, key.id, run.id, request.stepId);
    this.validateRequest(request, facts.binding, before);
    await verifyQuestionHistory(tx, request);
    if (facts.plan.steps.length !== 1 || !continuableModel(facts.planned.toolCode)
      || facts.planned.operation !== 'external_unknown' || facts.step.effect !== 'NONE') throw unavailable();
    const receipt = await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_requestId: {
      scopeId: key.scopeId, taskId: key.id, requestId: request.id } } });
    const runs = await tx.aiRun.findMany({ where: { scopeId: key.scopeId, taskId: key.id }, take: 1001 });
    const steps = await tx.aiStep.findMany({ where: { scopeId: key.scopeId, taskId: key.id }, take: 1001 });
    if (receipt || runs.length !== run.sequence || runs.length > 1000 || steps.length !== run.sequence
      || runs.some(row => row.id !== run.id && row.status !== 'SUCCEEDED')
      || steps.some(row => row.status !== 'SUCCEEDED' || row.effect !== 'NONE' || row.toolCode !== facts.planned.toolCode)) throw unavailable();
    const charges = await tx.aiTaskExecutionCharge.findMany({ where: { scopeId: key.scopeId,
      taskId: key.id, runId: run.id, stepId: facts.step.id }, take: 5 });
    if (charges.length !== 4 || new Set(charges.map(row => row.resource)).size !== 4
      || !['STEPS', 'CALLS', 'ACTIVE_MS', 'OUTPUT_BYTES'].every(resource => charges.some(row => row.resource === resource))
      || charges.some(row => row.status !== 'RECORDED' || row.actionId !== facts.step.actionId
        || row.stepFingerprint !== facts.step.requestFingerprint || row.leaseOwnerId !== facts.artifact.leaseOwnerId
        || row.fencingToken.toFixed(0) !== facts.artifact.fencingToken.toFixed(0))
      || !charges.some(row => row.resource === 'CALLS' && row.gatewayInvocationId)) throw unavailable();
    const current = await this.access(key.id, 'transition_task', before);
    if ((await tx.aiRun.updateMany({ where: { id: run.id, taskId: key.id, scopeId: key.scopeId,
      revision: run.revision, fencingToken: run.fencingToken, status: 'RUNNING',
      leaseOwnerId: null, leaseExpiresAt: null, actorKind: current.actorKind, actorId: current.actorId },
      data: { status: 'CANCELLED', endedAt: this.clock(), revision: { increment: 1 },
        fencingToken: { increment: new Prisma.Decimal(1) } } })).count !== 1) throw conflict();
    // Keep the pending question as historical evidence; terminal task state
    // prevents consumption. No resource or financial charge is released.
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
      await verifyQuestionHistory(tx, request);
      const requirement = await this.requirement(facts.binding);
      if (requirement.kind !== 'required' || requestFingerprint(requirement.contract) !== request.contractHash) throw unavailable();
      if (run.fencingToken.toFixed(0) !== request.fencingToken.toFixed(0) || request.expiresAt <= this.clock()) throw unavailable();
      await this.access(taskId, 'read_metadata', before);
      return { requestId: request.id, revision: request.revision, expiresAt: request.expiresAt.toISOString(), contract };
    });
  }

  /** Explicit server-question refresh, never a resume, new plan or dispatch.
   * The immutable audit event retains the complete previous request. Public
   * events expose revisions only, not old choices or sensitive source content. */
  async refreshPending(value: unknown) {
    const command = z.object({ taskId: id, requestId: id,
      expectedRevision: z.number().int().positive().max(maxRevision - 1) }).strict().safeParse(structuredClone(value));
    if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const input = command.data, before = await this.access(input.taskId, 'request_input');
    return this.writeTransaction(async tx => {
      const task = await this.task(tx, input.taskId, before);
      const request = await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: {
        scopeId: task.scopeId, taskId: task.id, id: input.requestId } } });
      if (!request) throw unavailable();
      const run = await this.run(tx, task.id, task.scopeId, request.runId, before);
      const facts = await this.facts(tx, task.scopeId, task.id, run.id, request.stepId);
      this.validateRequest(request, facts.binding, before);
      await verifyQuestionHistory(tx, request);
      if (task.status !== 'WAITING_INPUT' || task.cancelRequestedAt !== null || run.status !== 'RUNNING'
        || task.revision !== request.waitingTaskRevision || request.status !== 'PENDING'
        || request.revision !== input.expectedRevision || task.revision >= maxRevision || task.eventCursor >= maxCursor
        || run.fencingToken.toFixed(0) !== request.fencingToken.toFixed(0)
        || !(run.leaseOwnerId === null && run.leaseExpiresAt === null
          || run.leaseOwnerId !== null && run.leaseExpiresAt !== null && run.leaseExpiresAt <= this.clock())) throw conflict();
      if (await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_requestId: {
        scopeId: task.scopeId, taskId: task.id, requestId: request.id } } })) throw conflict();
      // Refresh cannot extend the original request lifetime or rescue an expired operation.
      const requirement = await this.requirement(facts.binding);
      if (requirement.kind !== 'required' || request.expiresAt <= this.clock()
        || Date.parse(requirement.expiresAt) <= this.clock().getTime()) throw unavailable();
      const contractHash = requestFingerprint(requirement.contract);
      if (contractHash === request.contractHash) {
        await this.access(task.id, 'request_input', before);
        return { requestId: request.id, revision: request.revision, expiresAt: request.expiresAt.toISOString(), contract: requirement.contract };
      }
      const next = { ...request, contractCode: requirement.contract.code, contractVersion: requirement.contract.version,
        contractHash, allowedFields: structuredClone(requirement.contract.fields) as unknown as Prisma.JsonValue,
        waitingTaskRevision: task.revision + 1, revision: request.revision + 1,
        expiresAt: new Date(Math.min(request.expiresAt.getTime(), Date.parse(requirement.expiresAt))) };
      if (next.revision > 32) throw unavailable();
      const again = await this.requirement(facts.binding);
      if (requestFingerprint(again) !== requestFingerprint(requirement)) throw denied();
      const current = await this.access(task.id, 'request_input', before);
      if (next.expiresAt <= this.clock()) throw conflict();
      if ((await tx.aiTaskInputRequest.updateMany({ where: { scopeId: task.scopeId, taskId: task.id,
        id: request.id, status: 'PENDING', revision: request.revision, requestHash: request.requestHash,
        waitingTaskRevision: task.revision, fencingToken: run.fencingToken }, data: {
          contractCode: next.contractCode, contractVersion: next.contractVersion, contractHash,
          allowedFields: next.allowedFields as Prisma.InputJsonValue, expiresAt: next.expiresAt,
          waitingTaskRevision: next.waitingTaskRevision, revision: next.revision, requestHash: requestDigest(next)
        } })).count !== 1) throw conflict();
      if ((await tx.aiTask.updateMany({ where: { ...current.where, scopeId: task.scopeId,
        status: 'WAITING_INPUT', revision: task.revision, eventCursor: task.eventCursor, cancelRequestedAt: null },
        data: { revision: { increment: 1 }, eventCursor: { increment: 1n } } })).count !== 1) throw conflict();
      await tx.aiTaskEvent.create({ data: { scopeId: task.scopeId, taskId: task.id,
        cursor: task.eventCursor + 1n, taskRevision: task.revision + 1, type: 'task.input_refreshed', occurredAt: this.clock(),
        payload: { data: { requestId: request.id, previousRevision: request.revision, revision: next.revision },
          previousRequest: { ...request, fencingToken: request.fencingToken.toFixed(0),
            createdAt: request.createdAt.toISOString(), expiresAt: request.expiresAt.toISOString() },
          nextRequestHash: requestDigest(next), initiator: { kind: 'user', id: current.actorId } } } });
      return { requestId: request.id, revision: next.revision, expiresAt: next.expiresAt.toISOString(), contract: requirement.contract };
    });
  }

  /** Exact original answer receipt, never submit/retry or latest-run selection. */
  async readSubmission(value: unknown) {
    const submission = structuredClone(value);
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = await this.access(submission.taskId, 'read_metadata');
    return this.transaction(async tx => {
      const task = await this.task(tx, submission.taskId, before);
      const request = await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: {
        scopeId: task.scopeId, taskId: task.id, id: submission.requestId } } });
      if (!request || request.id !== submission.requestId) throw unavailable();
      const parent = await this.run(tx, task.id, task.scopeId, request.runId, before, true);
      const facts = await this.facts(tx, task.scopeId, task.id, parent.id, request.stepId);
      this.validateRequest(request, facts.binding, before);
      await verifyQuestionHistory(tx, request);
      const stored = await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_submissionKey: {
        scopeId: task.scopeId, taskId: task.id, submissionKey: submission.submissionKey } } });
      if (!stored) {
        await this.access(task.id, 'read_metadata', before);
        return { state: 'not_observed' as const, retryable: false as const };
      }
      const receipt = this.receipt(request, stored, before, submission);
      const successor = await tx.aiRun.findUnique({ where: { scopeId_taskId_inputReceiptId: {
        scopeId: task.scopeId, taskId: task.id, inputReceiptId: receipt.id } } });
      if (successor && (successor.scopeId !== task.scopeId || successor.taskId !== task.id
        || successor.inputReceiptId !== receipt.id || successor.actorKind !== before.actorKind || successor.actorId !== before.actorId
        || successor.sequence !== parent.sequence + 1 || parent.status !== 'SUCCEEDED'
        || successor.resourceOriginRunId !== (parent.resourceOriginRunId ?? parent.id))) throw denied();
      if (facts.plan.steps.length === 1 && continuableModel(facts.planned.toolCode) && !successor) throw unavailable();
      await this.access(task.id, 'read_metadata', before);
      return { state: 'observed' as const, retryable: false as const, taskId: task.id, requestId: request.id,
        receiptId: receipt.id, taskRevision: receipt.consumedTaskRevision!, runId: successor?.id ?? parent.id,
        execution: 'not_inferred_from_receipt' as const };
    });
  }

  async submit(value: unknown) {
    const submission = structuredClone(value);
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = await this.access(submission.taskId, 'read_metadata');
    return this.writeTransaction(async tx => {
      const task = await this.task(tx, submission.taskId, before);
      const request = await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: { scopeId: task.scopeId, taskId: task.id, id: submission.requestId } } });
      if (!request || request.id !== submission.requestId) throw unavailable();
      const run = await this.run(tx, task.id, task.scopeId, request.runId, before, true);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_task_input_requests WHERE scopeId = ${task.scopeId} AND taskId = ${task.id} AND id = ${request.id} FOR UPDATE`);
      const facts = await this.facts(tx, task.scopeId, task.id, run.id, request.stepId);
      const contract = this.validateRequest(request, facts.binding, before);
      await verifyQuestionHistory(tx, request);
      const existing = await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_submissionKey: { scopeId: task.scopeId, taskId: task.id, submissionKey: submission.submissionKey } } });
      if (existing) {
        const receipt = this.receipt(request, existing, before, submission);
        await this.access(task.id, 'read_metadata', before);
        return { status: 'input_received' as const, taskId: task.id, requestId: request.id, receiptId: receipt.id, taskRevision: receipt.consumedTaskRevision!, replayed: true };
      }
      if (task.status !== 'WAITING_INPUT' || run.status !== 'RUNNING' || task.cancelRequestedAt !== null || task.revision !== request.waitingTaskRevision
        || request.status !== 'PENDING' || request.revision >= maxRevision || submission.expectedRevision !== request.revision
        || request.expiresAt <= this.clock() || run.fencingToken.toFixed(0) !== request.fencingToken.toFixed(0)
        || !(run.leaseOwnerId === null && run.leaseExpiresAt === null || run.leaseOwnerId !== null && run.leaseExpiresAt !== null && run.leaseExpiresAt <= this.clock())) throw conflict();
      await this.access(task.id, 'submit_input', before);
      await this.access(task.id, 'resume_input', before);
      const requirement = await this.requirement(facts.binding);
      if (requirement.kind !== 'required' || requestFingerprint(requirement.contract) !== request.contractHash) throw denied();
      await this.validateAnswers(facts.binding, contract, submission.answers);
      const steps = await tx.aiStep.findMany({ where: { scopeId: task.scopeId, taskId: task.id }, take: 1001 });
      const modelContinuation = facts.planned.operation === 'external_unknown' && continuableModel(facts.planned.toolCode)
        && facts.plan.steps.length === 1;
      if (modelContinuation) {
        const runs = await tx.aiRun.findMany({ where: { scopeId: task.scopeId, taskId: task.id }, take: 1001 });
        if (!Number.isSafeInteger(run.sequence) || run.sequence < 1 || run.sequence >= 1000 || runs.length !== run.sequence
          || runs.some(r => r.id !== run.id && r.status !== 'SUCCEEDED')
          || steps.length !== run.sequence || steps.some(s => s.status !== 'SUCCEEDED' || s.effect !== 'NONE' || s.toolCode !== facts.planned.toolCode)) throw unavailable();
      }
      this.transition(task, steps, 'running', 'resume');
      await this.access(task.id, 'submit_input', before);
      const current = await this.access(task.id, 'resume_input', before);
      if (request.expiresAt <= this.clock()) throw conflict();
      if ((await tx.aiRun.updateMany({ where: { id: run.id, taskId: task.id, scopeId: task.scopeId, revision: run.revision, fencingToken: run.fencingToken,
        leaseOwnerId: run.leaseOwnerId, leaseExpiresAt: run.leaseExpiresAt, status: run.status, actorId: current.actorId, actorKind: current.actorKind },
        data: { revision: { increment: 1 }, fencingToken: { increment: new Prisma.Decimal(1) }, leaseOwnerId: null, leaseExpiresAt: null,
          ...(modelContinuation ? { status: 'SUCCEEDED', endedAt: this.clock() } : {}) } })).count !== 1) throw conflict();
      const receiptId = randomUUID();
      await tx.aiTaskInputReceipt.create({ data: { scopeId: task.scopeId, taskId: task.id, id: receiptId, requestId: request.id, planHash: request.planHash,
        submissionKey: submission.submissionKey, answerHash: answerDigest(submission, request), answers: structuredClone(submission.answers) as unknown as Prisma.InputJsonValue,
        actorKind: current.actorKind, actorId: current.actorId, audience: current.audience, consumedAt: this.clock(), consumedTaskRevision: task.revision + 1 } });
      if ((await tx.aiTaskInputRequest.updateMany({ where: { scopeId: task.scopeId, taskId: task.id, id: request.id, revision: request.revision,
        status: 'PENDING', requestHash: request.requestHash, fencingToken: request.fencingToken, expiresAt: { gt: this.clock() } },
        data: { status: 'CONSUMED', revision: { increment: 1 } } })).count !== 1) throw conflict();
      if (modelContinuation) {
        const originId = run.resourceOriginRunId ?? run.id;
        const origin = await tx.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: originId, sequence: 1 } });
        if (!origin || origin.id !== originId || origin.scopeId !== task.scopeId || origin.taskId !== task.id
          || origin.inputReceiptId != null || origin.resourceOriginRunId != null
          || (run.sequence > 1 && (!run.inputReceiptId || !run.resourceOriginRunId))) throw denied();
        await tx.aiRun.create({ data: { id: randomUUID(), scopeId: task.scopeId, taskId: task.id,
          actorKind: current.actorKind, actorId: current.actorId, authorizedAt: current.authorizedAt,
          sequence: run.sequence + 1, status: 'RUNNING', revision: 1, fencingToken: new Prisma.Decimal(0),
          leaseOwnerId: null, leaseExpiresAt: null, inputReceiptId: receiptId, resourceOriginRunId: originId } });
      }
      await this.publish(tx, task, current, 'running', 'resume', { requestId: request.id, receiptId });
      return { status: 'input_received' as const, taskId: task.id, requestId: request.id, receiptId, taskRevision: task.revision + 1, replayed: false };
    });
  }

  async readContinuation(lease: AiTaskRunnerLease) {
    lease = structuredClone(lease);
    const before = await this.access(lease.taskId, 'read_metadata');
    return this.transaction(async tx => {
      const task = await this.task(tx, lease.taskId, before), run = await this.run(tx, task.id, task.scopeId, lease.runId, before);
      this.held(run, lease);
      if (task.status !== 'RUNNING' || task.cancelRequestedAt !== null || !run.inputReceiptId || !run.resourceOriginRunId) throw denied();
      const saved = await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_id: { scopeId: task.scopeId, taskId: task.id, id: run.inputReceiptId } } });
      if (!saved || saved.id !== run.inputReceiptId) throw unavailable();
      const request = await tx.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: { scopeId: task.scopeId, taskId: task.id, id: saved.requestId } } });
      if (!request || request.expiresAt <= this.clock()) throw unavailable();
      const parent = await this.run(tx, task.id, task.scopeId, request.runId, before, true);
      if (parent.status !== 'SUCCEEDED' || parent.sequence + 1 !== run.sequence
        || (parent.resourceOriginRunId ?? parent.id) !== run.resourceOriginRunId) throw denied();
      const facts = await this.facts(tx, task.scopeId, task.id, parent.id, request.stepId);
      if (facts.plan.steps.length !== 1 || !continuableModel(facts.planned.toolCode)
        || facts.planned.operation !== 'external_unknown' || facts.step.effect !== 'NONE') throw denied();
      const contract = this.validateRequest(request, facts.binding, before), receipt = this.receipt(request, saved, before);
      await verifyQuestionHistory(tx, request);
      const answers = receipt.answers as unknown as AiTaskInputSubmissionDraft['answers'];
      await this.validateAnswers(facts.binding, contract, answers);
      const input = await tx.aiTaskActionInput.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, runId: parent.id, id: facts.binding.inputRef } });
      if (!input || input.id !== facts.binding.inputRef || input.scopeId !== task.scopeId || input.taskId !== task.id || input.runId !== parent.id
        || input.fingerprint !== facts.binding.inputHash || input.registrationRef !== facts.binding.registrationRef
        || input.toolCode !== facts.planned.toolCode || input.toolVersion !== facts.planned.toolVersion) throw denied();
      await this.access(task.id, 'read_metadata', before);
      this.held(await this.run(tx, task.id, task.scopeId, run.id, before), lease);
      return { resourceOriginRunId: run.resourceOriginRunId, receiptId: receipt.id, registrationRef: `model-followup-${receipt.id}`,
        input: structuredClone(input.payload), inputHash: input.fingerprint, result: structuredClone(facts.artifact.payload),
        answers: structuredClone(answers), questionRevision: request.revision - 1, limits: structuredClone(facts.plan.limits) };
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
        await verifyQuestionHistory(tx, request);
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
