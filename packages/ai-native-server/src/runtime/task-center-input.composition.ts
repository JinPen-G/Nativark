/** Task-center consumer of the original clarification workflow. Questions and
 * receipts remain in the existing input repository; answers are not approval,
 * and financial/unknown recovery never grants a second model execution. */
import { z } from 'zod';
import { AI_SCENE_REQUEST_DRAFT_VERSION, isAiTaskInputContractDraft, isAiTaskInputSubmissionDraft,
  type AiTaskClarificationObservationDraft, type AiTaskClarificationProgressDraft,
  type AiTaskInputSubmissionDraft, type AiTaskInputContractDraft } from '@rental-os/shared';
import type { PrismaClient } from '@prisma/client';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { readOriginalTaskModelProvenance } from './task-request/prisma-original-request.repository';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { taskInputReceiptReferenceSchema } from './task-input/prisma-task-input.repository';

type Request = { headers: { authorization?: unknown } };
export interface TaskCenterInputDependencies {
  readInput(request: Request, value: unknown): Promise<unknown>;
  readAnswer(request: Request, value: unknown): Promise<unknown>;
  resolveAnswerContinuation?(request: Request, value: unknown): Promise<unknown>;
  resume?(request: Request, value: unknown, signal?: AbortSignal): Promise<unknown>;
  continueAnswer?(request: Request, value: unknown, signal?: AbortSignal): Promise<unknown>;
  execution?(): Pick<TaskCenterInputDependencies, 'resume' | 'continueAnswer'>;
}
export const taskCenterInputQuery = z.object({ taskId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
export const taskCenterInputAnswer = z.object({ submission: z.custom<AiTaskInputSubmissionDraft>(isAiTaskInputSubmissionDraft) }).strict();
export const taskCenterInputReceipt = z.union([taskCenterInputAnswer, z.object({ reference: taskInputReceiptReferenceSchema }).strict()]);
const id = taskCenterInputQuery.shape.taskId, revision = z.number().int().min(1).max(4294967294);
const pending = z.object({ requestId: id, revision, expiresAt: z.string().datetime({ offset: true }),
  contract: z.custom<AiTaskInputContractDraft>(isAiTaskInputContractDraft) }).strict();
const observed = z.object({ state: z.literal('observed'), taskId: id, requestId: id, receiptId: id,
  taskRevision: revision, runId: id, retryable: z.literal(false) }).passthrough();
const absent = z.object({ state: z.literal('not_observed'), retryable: z.literal(false) }).strict();
const continuation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not_started'), reason: z.string().min(1).max(128).regex(/^[a-z_]+$/u) }).passthrough(),
  z.object({ kind: z.literal('unavailable'), errorCode: z.string().max(128).regex(/^AI_[A-Z_]+$/u) }).passthrough(),
  z.object({ kind: z.literal('run_outcome'), outcome: z.object({ status: z.enum([
    'succeeded', 'partially_succeeded', 'paused', 'cancel_requested', 'cancelled', 'unknown', 'unavailable', 'failed']),
    stopReason: z.literal('input_limit_reached').optional(), nextAction: z.literal('manual_handoff').optional(),
    errorCode: z.string().max(128).regex(/^AI_[A-Z_]+$/u).optional() }).passthrough() }).passthrough()
]);
const unknown = () => new AiTaskRunnerError('AI_RESULT_UNKNOWN');
type Action = 'input' | 'resumeInput' | 'inputReceipt' | 'continueInput';

export async function callTaskCenterInput(d: { db: Pick<PrismaClient, 'aiTask' | 'aiTaskOriginalRequest'>;
  original: TaskCenterInputDependencies; tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  credentials: AiTaskCredentialSource }, request: Request, value: unknown, action: Action, signal?: AbortSignal):
  Promise<AiTaskClarificationObservationDraft | AiTaskClarificationProgressDraft> {
  const command = structuredClone(value);
  const receiptQuery = action === 'inputReceipt' || action === 'continueInput' ? taskCenterInputReceipt.parse(command) : undefined;
  const submission = action === 'input' ? undefined : receiptQuery && 'reference' in receiptQuery
    ? receiptQuery.reference : taskCenterInputAnswer.parse(command).submission;
  const readInput = d.original.readInput.bind(d.original), readAnswer = d.original.readAnswer.bind(d.original);
  const resume = d.original.resume?.bind(d.original), continueAnswer = d.original.continueAnswer?.bind(d.original);
  const resolveExecution = d.original.execution?.bind(d.original);
  const resolveAnswer = d.original.resolveAnswerContinuation?.bind(d.original);
  const taskId = submission?.taskId ?? taskCenterInputQuery.parse(command).taskId;
  // The original repository distinguishes a new authorized submission from
  // same-key receipt replay. Do not require a fresh mutation grant to observe
  // an already-consumed question; no new write can bypass that repository.
  const operation = 'read_metadata' as const;
  const before = await waitForTaskApplicationDependency(async () => {
    const access = await d.tasks.resolveAccess(taskId, operation);
    const task = structuredClone(await d.db.aiTask.findFirst({ where: access.where }));
    if (!task || !['order_explanation', 'opening_diagnosis', 'quote_clarification'].includes(task.sceneCode))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const original = await readOriginalTaskModelProvenance(d.db, task);
    return { access, task, original };
  }, false, signal);
  const verify = async () => {
    const access = await d.tasks.resolveAccess(taskId, operation);
    const task = structuredClone(await d.db.aiTask.findFirst({ where: access.where }));
    if (!task || access.bindingKey !== before.access.bindingKey || task.scopeId !== before.task.scopeId
      || task.inputRef !== before.task.inputRef || task.inputHash !== before.task.inputHash || task.inputRevision !== before.task.inputRevision
      || task.sceneCode !== before.task.sceneCode) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const original = await readOriginalTaskModelProvenance(d.db, task);
    if (original.inputRef !== before.original.inputRef || original.authorizationHash !== before.original.authorizationHash)
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return task;
  };
  const original = { draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: before.original.inputRef };
  if (action === 'input') {
    const value = structuredClone(await readInput(request, original));
    const input = value === null ? null : pending.parse(value), latest = await verify();
    if (latest.revision !== before.task.revision || (latest.status === 'WAITING_INPUT') !== (input !== null))
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    return { taskId, input, execution: 'read_only_no_start_no_reconnect_side_effect' };
  }
  const current = await verify(); await d.credentials.current();
  if (signal?.aborted) throw unknown();
  // A terminal/paused task only observes its exact receipt. Do not even ask
  // the original host for another claim when metadata already rules it out.
  const observeOnly = action === 'continueInput' && current.status !== 'RUNNING';
  let method = observeOnly ? readAnswer : action === 'resumeInput' ? resume : action === 'continueInput' ? continueAnswer : readAnswer;
  if (!method && resolveExecution) {
    const execution = resolveExecution();
    method = action === 'resumeInput' ? execution.resume?.bind(execution) : execution.continueAnswer?.bind(execution);
  }
  if (typeof method !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  let originalQuery: unknown = receiptQuery && 'reference' in receiptQuery ? { original, reference: receiptQuery.reference } : { original, submission };
  if (action === 'continueInput' && !observeOnly && receiptQuery && 'reference' in receiptQuery) {
    if (!resolveAnswer) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const persisted = structuredClone(await resolveAnswer(request, originalQuery));
    if (!isAiTaskInputSubmissionDraft(persisted) || persisted.taskId !== submission!.taskId
      || persisted.requestId !== submission!.requestId || persisted.expectedRevision !== submission!.expectedRevision
      || persisted.submissionKey !== submission!.submissionKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const latest = await verify(); await d.credentials.current();
    if (latest.status !== 'RUNNING' || latest.revision !== current.revision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    if (signal?.aborted) throw unknown();
    originalQuery = { original, submission: persisted };
  }
  const mutated = action !== 'inputReceipt' && !observeOnly;
  let returned = false;
  try {
    const raw = structuredClone(await method(request, originalQuery, signal));
    returned = true;
    await verify();
    const envelope = action === 'inputReceipt' || observeOnly ? { receipt: raw } : z.object({ receipt: z.unknown() }).passthrough().parse(raw);
    const base = { taskId, requestId: submission!.requestId, automaticRetry: false as const,
      businessExecution: 'not_inferred_from_input' as const };
    if (action === 'resumeInput') {
      const receipt = z.object({ status: z.literal('input_received'), taskId: id, requestId: id,
        receiptId: id, taskRevision: revision, replayed: z.boolean() }).passthrough().parse(envelope.receipt);
      if (receipt.taskId !== taskId || receipt.requestId !== submission!.requestId) throw unknown();
      const result = continuation.parse(z.object({ continuation: z.unknown() }).passthrough().parse(raw).continuation);
      return { ...base, receipt: { state: 'observed', receiptId: receipt.receiptId, taskRevision: receipt.taskRevision,
        runId: null, replayed: receipt.replayed }, continuation: presentContinuation(result) };
    }
    const receipt = z.union([observed, absent]).parse(envelope.receipt);
    if (receipt.state === 'not_observed') return { ...base, receipt: { state: 'not_observed' }, continuation: { kind: 'not_attempted' } };
    if (receipt.taskId !== taskId || receipt.requestId !== submission!.requestId) throw unknown();
    return { ...base, receipt: { state: 'observed', receiptId: receipt.receiptId, taskRevision: receipt.taskRevision,
      runId: receipt.runId, replayed: null }, continuation: observeOnly ? { kind: 'not_started', reason: 'task_not_runnable' }
        : action === 'inputReceipt' ? { kind: 'not_attempted' }
        : presentContinuation(continuation.parse(z.object({ execution: z.unknown() }).passthrough().parse(raw).execution)) };
  } catch (error) {
    if (error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw error;
    if (!returned && error instanceof AiTaskRepositoryError && ['AI_INVALID_INPUT', 'AI_REVISION_CONFLICT'].includes(error.code)) throw error;
    if (mutated) throw unknown();
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
}
function presentContinuation(value: z.infer<typeof continuation>): AiTaskClarificationProgressDraft['continuation'] {
  if (value.kind === 'not_started') return { kind: value.kind, reason: value.reason };
  if (value.kind === 'unavailable') return { kind: value.kind, errorCode: value.errorCode };
  return { kind: 'run_outcome', status: value.outcome.status, stopReason: value.outcome.stopReason ?? null,
    nextAction: value.outcome.nextAction ?? null, errorCode: value.outcome.errorCode ?? null };
}
