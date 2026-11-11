/** Minimum short policies for an explicit original wait submission/continuation.
 * Original question/answer validation and all writes remain in the existing
 * repositories. Preparation and receipt reads never renew, dispatch, reset
 * resources or revive an expired/consumed wait; CAS receipts grant no execution. */
import { isDeepStrictEqual } from 'node:util';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TASK_INPUT_DRAFT_VERSION, AI_TEXT_MODEL_STEP_CODE,
  isAiTaskInputSubmissionDraft, validateAiTaskInputAnswersDraft, type AiExecutionContext,
  type AiTaskInputSubmissionDraft } from '@rental-os/shared';
import type { AuthService } from '../auth/auth.service';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { AiTaskRepository, aiTaskAccessFromContext, AiTaskRepositoryError } from './ai-task.repository';
import { AiBusinessReadRouteAuthority } from './business-read-route.authority';
import type { AiTaskCredentialSource } from './task-current-action.authority';
import { aiPersistedPlanToolsSchema } from './runner/prisma-task-plan-input.source';
import { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema } from './runner/prisma-task-run-evidence.repository';
import { waitForTaskApplicationDependency } from './runner/prisma-task-application';
import { AiTaskRunnerError } from './runner/ai-task-runner.service';
import { PrismaTaskInputRepository, taskInputReceiptReferenceSchema } from './task-input/prisma-task-input.repository';
import type { AiTaskInputBinding, AiTaskInputSource } from './task-input/task-input.ports';
import type { PrismaOriginalRequestRepository } from './task-request/prisma-original-request.repository';
import { originalRequestReferenceSchema } from './task-request/original-request.validation';
import { originalIdentityHash } from './task-request/original-request.authority';
import { createOriginalSceneInputWaitMode, type OriginalSceneInputWaitMode } from './scenes/original-scene-model.composition';
import { TaskInputAdmissionAuthority } from './task-input-admission.authority';
import type { AiTaskActionPolicyOperation, AiTaskActionPolicyMutationResult } from './prisma-task-action-policy.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().min(1).max(4294967294), time = z.string().datetime({ offset: true });
const intent = z.enum(['explicit_wait_submit', 'explicit_wait_resume', 'explicit_answer_continue']);
const submitOperations = ['read_metadata', 'read_step_terminal', 'submit_input', 'resume_input'] as const;
const continueOperations = ['read_metadata', 'read_step_terminal', 'claim_run', 'release_run', 'transition_task', 'request_input'] as const;
const allOperations = [...new Set([...submitOperations, ...continueOperations])] as AiTaskActionPolicyOperation[];
const operation = z.custom<AiTaskActionPolicyOperation>(value => typeof value === 'string' && allOperations.includes(value as AiTaskActionPolicyOperation));
const permissions = z.array(id).min(1).max(64).refine(value => new Set(value).size === value.length);
const action = z.object({ operation, mode: z.enum(['retain', 'configure']), expectedRevision: revision.nullable(), requiredPermissions: permissions, expiresAt: time }).strict();
const referenceSchema = z.object({ version: z.literal('task-input-admission-1'), intent, original: originalRequestReferenceSchema,
  input: taskInputReceiptReferenceSchema, task: z.object({ taskId: id.max(36), scopeId: id.max(36), ownerId: id,
    sceneCode: z.literal('quote_clarification'), sceneVersion: id.max(64), inputRevision: revision, inputHash: hash }).strict(),
  wait: z.object({ requestId: id.max(36), runId: id.max(36), stepId: id.max(36), revision,
    requestHash: hash, contractHash: hash, expiresAt: time }).strict(), executionRunId: id.max(36),
  stageHash: hash, publicationHash: hash, actions: z.array(action).min(1).max(8), intentHash: hash }).strict();
export type TaskInputAdmissionReference = z.infer<typeof referenceSchema>;
export type TaskInputAdmissionIntent = z.infer<typeof intent>;
export interface TaskInputAdmissionDependencies {
  db: PrismaClient;
  auth: Pick<AuthService, 'resolveAccessContext'>;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiTaskCredentialSource;
  originals: Pick<PrismaOriginalRequestRepository, 'readHistorical' | 'readTaskLocator'>;
  /** Actual current deployment/model switch supplied by the original factory. */
  currentRuntimeEnabled(sceneCode: 'quote_clarification', sceneVersion: string): Promise<boolean>;
  /** Existing clarification builder with the proved wait mode and this slice's
   * current resource-scoped metadata reader. No default/always-success source. */
  inputSourceFactory(tasks: Pick<AiTaskRepository, 'resolveAccess'>, mode: OriginalSceneInputWaitMode): AiTaskInputSource;
  clock?: () => Date;
  maximumAdmissionMs?: number;
}
export interface TaskInputAdmissionReceipt {
  phase: 'original_input_policy_receipts'; reference: TaskInputAdmissionReference;
  entries: { operation: AiTaskActionPolicyOperation; state: 'recorded' | 'not_observed' | 'retained_policy';
    policy: AiTaskActionPolicyMutationResult | null; matchesPreparedContent: boolean }[];
  completeRecorded: boolean; admission: 'not_granted_by_receipt'; execution: 'not_started';
  automaticRetry: false; waitingBinding: 'not_attested_by_legacy_policy_receipt';
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const operationsFor = (selected: TaskInputAdmissionIntent): readonly AiTaskActionPolicyOperation[] => selected === 'explicit_wait_submit'
  ? submitOperations : selected === 'explicit_answer_continue' ? continueOperations : allOperations;
const referenceHash = (value: Omit<TaskInputAdmissionReference, 'intentHash'>) => requestFingerprint(value);
// Native evidence includes bigint counters and fencing/measurement values.
// Normalize this private snapshot only; never change business fingerprints or
// replace absent evidence with numeric zero.
const snapshotHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value,
  (_key, item) => typeof item === 'bigint' ? { nativeBigInt: item.toString() } : item)));

export function composeTaskInputAdmission(d: TaskInputAdmissionDependencies) {
  if (typeof d.db?.$transaction !== 'function' || typeof d.auth?.resolveAccessContext !== 'function'
    || typeof d.guard?.canActivate !== 'function' || typeof d.credentials?.current !== 'function'
    || typeof d.originals?.readHistorical !== 'function' || typeof d.originals?.readTaskLocator !== 'function'
    || typeof d.currentRuntimeEnabled !== 'function' || typeof d.inputSourceFactory !== 'function') throw unavailable();
  const clock = d.clock ?? (() => new Date()), maximumMs = d.maximumAdmissionMs ?? 120000;
  if (!Number.isSafeInteger(maximumMs) || maximumMs < 1 || maximumMs > 120000) throw unavailable();
  const read = <T>(work: () => Promise<T>, signal?: AbortSignal) => waitForTaskApplicationDependency(work, false, signal);
  const now = () => { const value = clock(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw unavailable(); return value; };
  const parseReference = (value: unknown) => {
    const parsed = referenceSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const { intentHash, ...body } = parsed.data;
    if (referenceHash(body) !== intentHash || body.task.taskId !== body.input.taskId || body.wait.requestId !== body.input.requestId
      || !isDeepStrictEqual([...operationsFor(body.intent)].sort(), body.actions.map(row => row.operation).sort())) throw denied();
    return parsed.data;
  };
  const metadata = async (original: z.infer<typeof originalRequestReferenceSchema>, taskId: string, signal?: AbortSignal) => {
    const identities = new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, clock), scopes = new AiScopeRepository(d.db, identities, clock);
    const initial = await read(() => scopes.resolveCurrent(), signal), context = initial.context;
    if (context.actor.kind !== 'user' || context.scope.kind !== 'workspace' || context.audience !== 'operator'
      || initial.scope.kind !== 'WORKSPACE' || !('access' in context)) throw denied();
    const ownerId = context.actor.userId, bindingHash = originalIdentityHash(context);
    const authorize = async (tx?: Prisma.TransactionClient) => {
      if (signal?.aborted) throw denied();
      const current = await scopes.resolveCurrent();
      if (current.scope.id !== initial.scope.id || originalIdentityHash(current.context) !== bindingHash) throw denied();
      const source = await d.originals.readHistorical(original, tx);
      if (source.receipt.state === 'revoked' || source.receipt.sceneCode !== 'quote_clarification'
        || source.request.sceneCode !== 'quote_clarification' || originalIdentityHash(source.context) !== bindingHash) throw denied();
      const locator = await d.originals.readTaskLocator(original, tx);
      if (locator.material !== 'retained' || locator.receipt.state === 'revoked' || locator.task.state !== 'observed'
        || locator.task.taskId !== taskId || locator.receipt.contentHash !== source.receipt.contentHash
        || originalIdentityHash(locator.context) !== bindingHash) throw denied();
      await new AiBusinessReadRouteAuthority(d.guard, d.credentials, clock).withRead('quote_context', {}, async guarded => {
        if (originalIdentityHash(guarded) !== bindingHash) throw denied();
      });
      const access = aiTaskAccessFromContext(context, taskId, now());
      const task = await (tx ?? d.db).aiTask.findFirst({ where: { AND: [access.where, { scopeId: initial.scope.id }] } });
      if (!task || task.id !== taskId || task.scopeId !== initial.scope.id || task.scopeKind !== 'WORKSPACE'
        || task.ownerKind !== 'USER' || task.ownerId !== ownerId || task.audience !== 'OPERATOR' || task.archivedAt !== null
        || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.sceneCode !== 'quote_clarification'
        || task.inputRef !== original.inputRef || task.inputHash !== source.receipt.contentHash
        || task.inputRevision !== source.receipt.revision || task.sceneVersion !== source.receipt.sceneVersion) throw denied();
      const after = await scopes.resolveCurrent();
      if (after.scope.id !== initial.scope.id || originalIdentityHash(after.context) !== bindingHash || signal?.aborted) throw denied();
      return { task, context: after.context, access };
    };
    await read(() => authorize(), signal);
    const tasks = new AiTaskRepository(d.db, { resolve: async (selected, operation) => {
      if (selected !== taskId || !['read_metadata', 'read_step_terminal'].includes(operation)) throw denied();
      return (await authorize()).context;
    } }, clock);
    return { tasks, authorize, context };
  };
  const stage = async (original: z.infer<typeof originalRequestReferenceSchema>, input: z.infer<typeof taskInputReceiptReferenceSchema>,
    selected: TaskInputAdmissionIntent, submission?: AiTaskInputSubmissionDraft, signal?: AbortSignal,
    tx?: Prisma.TransactionClient, validateSource = true) => {
    const reader = await metadata(original, input.taskId, signal), authorized = await reader.authorize(tx), task = authorized.task;
    const db = tx ?? d.db, access = authorized.access;
    const wait = await db.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: {
      scopeId: task.scopeId, taskId: task.id, id: input.requestId } } });
    if (!wait || wait.id !== input.requestId || wait.taskId !== task.id || wait.scopeId !== task.scopeId
      || wait.createdBy !== access.actorId) throw unavailable();
    const parent = await db.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: wait.runId } });
    const step = await db.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, runId: wait.runId, id: wait.stepId } });
    const planRow = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId: task.scopeId, taskId: task.id, runId: wait.runId } } });
    if (!parent || parent.actorKind !== access.actorKind || parent.actorId !== access.actorId || !step || !planRow
      || step.status !== 'SUCCEEDED' || step.effect !== 'NONE' || step.toolCode !== AI_TEXT_MODEL_STEP_CODE
      || step.resultRef !== wait.basisResultRef || step.inputRef !== wait.inputRef || step.requestFingerprint !== wait.inputHash) throw denied();
    const plan = aiTaskRunPlanSchema.parse(structuredClone(planRow.payload));
    if (plan.taskId !== task.id || plan.runId !== parent.id || plan.taskRevision !== wait.planRevision
      || planRow.planHash !== wait.planHash || requestFingerprint(plan) !== wait.planHash || plan.steps.length !== 1
      || plan.steps[0].toolCode !== AI_TEXT_MODEL_STEP_CODE || plan.steps[0].toolVersion !== step.toolVersion
      || plan.steps[0].operation !== 'external_unknown') throw denied();
    const receipts = PrismaTaskInputRepository.receiptReader(d.db, reader.tasks, clock);
    let executionRunId = parent.id;
    let storedReceipt: Awaited<ReturnType<PrismaClient['aiTaskInputReceipt']['findUnique']>> = null;
    let successor: Awaited<ReturnType<PrismaClient['aiRun']['findUnique']>> = null;
    if (selected === 'explicit_answer_continue') {
      // The original reader proves receipt/question history outside the policy
      // transaction. Inside its row locks, compare the same native persisted
      // snapshot; a nested Serializable reader could block on our own Task lock.
      const nativeReceipt = tx ? await tx.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_submissionKey: {
        scopeId: task.scopeId, taskId: task.id, submissionKey: input.submissionKey } } }) : null;
      const nativeSuccessor = nativeReceipt ? await tx!.aiRun.findUnique({ where: { scopeId_taskId_inputReceiptId: {
        scopeId: task.scopeId, taskId: task.id, inputReceiptId: nativeReceipt.id } } }) : null;
      const observed = tx ? nativeReceipt && nativeSuccessor ? { state: 'observed' as const, taskId: task.id,
        requestId: nativeReceipt.requestId, receiptId: nativeReceipt.id, runId: nativeSuccessor.id } : { state: 'not_observed' as const }
        : await read(() => receipts.readSubmissionReference(input), signal);
      if (observed.state !== 'observed' || wait.status !== 'CONSUMED' || wait.revision !== input.expectedRevision + 1
        || task.cancelRequestedAt !== null || task.status !== 'RUNNING' || parent.status !== 'SUCCEEDED') throw unavailable();
      storedReceipt = await db.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_id: {
        scopeId: task.scopeId, taskId: task.id, id: observed.receiptId } } });
      successor = await db.aiRun.findUnique({ where: { scopeId_taskId_inputReceiptId: {
        scopeId: task.scopeId, taskId: task.id, inputReceiptId: observed.receiptId } } });
      if (!storedReceipt || !successor || successor.id !== observed.runId || successor.actorKind !== access.actorKind
        || successor.actorId !== access.actorId || successor.status !== 'RUNNING' || successor.revision !== 1
        || successor.fencingToken.toFixed(0) !== '0' || successor.leaseOwnerId !== null || successor.leaseExpiresAt !== null
        || successor.inputReceiptId !== storedReceipt.id || successor.resourceOriginRunId !== (parent.resourceOriginRunId ?? parent.id)
        || task.revision !== storedReceipt.consumedTaskRevision) throw unavailable();
      if (await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { scopeId: task.scopeId, taskId: task.id, runId: successor.id } } })
        || (await db.aiStep.findMany({ where: { scopeId: task.scopeId, taskId: task.id, runId: successor.id }, take: 1 })).length
        || await db.aiTaskActionInput.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, runId: successor.id } })) throw unavailable();
      executionRunId = successor.id;
    } else {
      if (task.status !== 'WAITING_INPUT' || task.cancelRequestedAt !== null || parent.status !== 'RUNNING'
        || task.revision !== wait.waitingTaskRevision || wait.status !== 'PENDING' || wait.revision !== input.expectedRevision
        || wait.expiresAt <= now() || !parent.fencingToken.equals(wait.fencingToken)
        || !(parent.leaseOwnerId === null && parent.leaseExpiresAt === null
          || parent.leaseOwnerId !== null && parent.leaseExpiresAt !== null && parent.leaseExpiresAt <= now())) throw conflict();
      const prior = await db.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_submissionKey: {
        scopeId: task.scopeId, taskId: task.id, submissionKey: input.submissionKey } } });
      if (prior) throw conflict();
      if (validateSource) {
        const mode = await createOriginalSceneInputWaitMode({ db: d.db, tasks: reader.tasks, original, reference: input, clock,
          currentRuntimeEnabled: d.currentRuntimeEnabled });
        const source = d.inputSourceFactory(reader.tasks, mode);
        if (typeof source?.resolve !== 'function' || typeof source?.validateAnswers !== 'function') throw unavailable();
        const pending = await read(() => PrismaTaskInputRepository.pendingReader(d.db, reader.tasks, source, clock).readPending(task.id), signal);
        if (!pending || pending.requestId !== wait.id || pending.revision !== wait.revision
          || pending.expiresAt !== wait.expiresAt.toISOString() || requestFingerprint(pending.contract) !== wait.contractHash) throw denied();
        if (submission) {
          if (!validateAiTaskInputAnswersDraft(pending.contract, submission.answers)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
          const binding: AiTaskInputBinding = { scopeId: task.scopeId, taskId: task.id, runId: parent.id, stepId: step.id,
            registrationRef: plan.steps[0].registrationRef, toolCode: step.toolCode, toolVersion: step.toolVersion,
            planHash: wait.planHash, planRevision: wait.planRevision, inputRef: wait.inputRef, inputHash: wait.inputHash, basisResultRef: wait.basisResultRef };
          const proof = await read(() => source.validateAnswers(binding, pending.contract, submission.answers), signal);
          if (!proof || !['context_only', 'business_parameters'].includes(proof.disposition)
            || proof.planHash !== binding.planHash || proof.inputRef !== binding.inputRef || proof.inputHash !== binding.inputHash
            || proof.disposition === 'business_parameters' && (proof.contractHash !== requestFingerprint(pending.contract)
              || proof.answersHash !== requestFingerprint(submission.answers) || proof.bindingHash !== requestFingerprint(binding))) throw denied();
        }
      }
    }
    const artifact = await db.aiTaskResultArtifact.findUnique({ where: { scopeId_taskId_id: {
      scopeId: task.scopeId, taskId: task.id, id: wait.basisResultRef } } });
    const actionInput = await db.aiTaskActionInput.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, runId: parent.id, id: wait.inputRef } });
    if (!artifact || !actionInput) throw unavailable();
    const snapshot = { task: { id: task.id, scopeId: task.scopeId, ownerId: task.ownerId, sceneCode: task.sceneCode,
      sceneVersion: task.sceneVersion, inputRevision: task.inputRevision, inputHash: task.inputHash,
      status: task.status, revision: task.revision, cancelRequestedAt: task.cancelRequestedAt },
      wait, parent, step, plan: planRow, artifact, actionInput, storedReceipt, successor };
    await reader.authorize(tx);
    return { task, wait, parent, step, plan, executionRunId, stageHash: snapshotHash(snapshot), context: authorized.context, reader };
  };
  const publication = async (task: Awaited<ReturnType<typeof stage>>['task'], tx?: Prisma.TransactionClient) => {
    if (await d.currentRuntimeEnabled('quote_clarification', task.sceneVersion) !== true) throw unavailable();
    const row = await (tx ?? d.db).aiTaskPlanPolicy.findFirst({ where: { scopeId: task.scopeId,
      sceneCode: task.sceneCode, sceneVersion: task.sceneVersion } });
    if (!row || row.scopeId !== task.scopeId || row.sceneCode !== task.sceneCode || row.sceneVersion !== task.sceneVersion
      || !row.enabled || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.expiresAt <= now()) throw unavailable();
    const tools = aiPersistedPlanToolsSchema.parse(structuredClone(row.allowedTools)), limits = aiTaskRunnerLimitsSchema.parse(structuredClone(row.limits));
    if (!tools.some(tool => tool.code === AI_TEXT_MODEL_STEP_CODE)
      || limits.maxStepMs > limits.maxTotalMs) throw unavailable();
    return { expiresAt: row.expiresAt, hash: requestFingerprint({ scopeId: row.scopeId, sceneCode: row.sceneCode,
      sceneVersion: row.sceneVersion, revision: row.revision, enabled: row.enabled, expiresAt: row.expiresAt.toISOString(), tools, limits }) };
  };
  const verify = async (reference: TaskInputAdmissionReference, purpose: 'issue' | 'observe', tx?: Prisma.TransactionClient): Promise<AiExecutionContext> => {
    const source = await metadata(reference.original, reference.task.taskId), current = await source.authorize(tx);
    if (current.task.scopeId !== reference.task.scopeId || current.task.ownerId !== reference.task.ownerId
      || current.task.sceneCode !== reference.task.sceneCode || current.task.sceneVersion !== reference.task.sceneVersion
      || current.task.inputRevision !== reference.task.inputRevision || current.task.inputHash !== reference.task.inputHash) throw denied();
    if (purpose === 'observe') return current.context;
    const state = await stage(reference.original, reference.input, reference.intent, undefined, undefined, tx, tx === undefined);
    if (state.stageHash !== reference.stageHash || state.executionRunId !== reference.executionRunId
      || state.wait.requestHash !== reference.wait.requestHash || state.wait.contractHash !== reference.wait.contractHash) throw conflict();
    const published = await publication(state.task, tx);
    if (published.hash !== reference.publicationHash) throw conflict();
    const held = 'access' in current.context ? current.context.access.permissions : [];
    if (reference.actions.some(row => row.requiredPermissions.some(permission => !held.includes(permission))
      || Date.parse(row.expiresAt) <= now().getTime()
      || row.mode === 'configure' && Date.parse(row.expiresAt) > Math.min(now().getTime() + maximumMs,
        published.expiresAt.getTime(), reference.intent === 'explicit_answer_continue' ? Infinity : state.wait.expiresAt.getTime()))) throw denied();
    return current.context;
  };
  const readReceipt = async (value: unknown, signal?: AbortSignal): Promise<TaskInputAdmissionReceipt> => {
    const reference = parseReference(value), authority = new TaskInputAdmissionAuthority(d, reference, 'observe', verify), reader = authority.reader();
    const entries: TaskInputAdmissionReceipt['entries'] = [];
    for (const row of reference.actions) {
      if (row.mode === 'retain') {
        const observed = await read(() => reader.read(reference.task.taskId, row.operation), signal);
        const policy = observed.state === 'observed' ? observed.policy : null;
        entries.push({ operation: row.operation, state: policy ? 'retained_policy' : 'not_observed', policy,
          matchesPreparedContent: !!policy && policy.revision === row.expectedRevision && policy.expiresAt === row.expiresAt
            && isDeepStrictEqual([...policy.requiredPermissions].sort(), [...row.requiredPermissions].sort()) });
      } else {
        const saved = await read(() => reader.readMutation(reference.task.taskId, row.operation, row.expectedRevision), signal);
        entries.push({ operation: row.operation, state: saved.state, policy: saved.policy,
          matchesPreparedContent: !!saved.policy && saved.policy.expiresAt === row.expiresAt
            && isDeepStrictEqual([...saved.policy.requiredPermissions].sort(), [...row.requiredPermissions].sort()) });
      }
    }
    return { phase: 'original_input_policy_receipts', reference, entries,
      completeRecorded: entries.every(row => row.state !== 'not_observed' && row.matchesPreparedContent),
      admission: 'not_granted_by_receipt', execution: 'not_started', automaticRetry: false,
      waitingBinding: 'not_attested_by_legacy_policy_receipt' };
  };
  const bindWaitMode = async (value: unknown, signal?: AbortSignal) => {
    const reference = parseReference(value), reader = await metadata(reference.original, reference.task.taskId, signal);
    return createOriginalSceneInputWaitMode({ db: d.db, tasks: reader.tasks, original: reference.original,
      reference: reference.input, clock, currentRuntimeEnabled: d.currentRuntimeEnabled });
  };
  return Object.freeze({
    async prepare(value: unknown, signal?: AbortSignal) {
      const query = z.object({ original: originalRequestReferenceSchema, intent,
        submission: z.custom<AiTaskInputSubmissionDraft>(isAiTaskInputSubmissionDraft).optional(), reference: taskInputReceiptReferenceSchema.optional() }).strict();
      const parsed = query.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      if (parsed.data.intent === 'explicit_answer_continue'
        ? !parsed.data.reference || parsed.data.submission !== undefined
        : !parsed.data.submission || parsed.data.reference !== undefined) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const command = parsed.data;
      const input = command.reference ?? taskInputReceiptReferenceSchema.parse({ taskId: command.submission!.taskId,
        requestId: command.submission!.requestId, expectedRevision: command.submission!.expectedRevision, submissionKey: command.submission!.submissionKey });
      const state = await stage(command.original, input, command.intent, command.submission, signal);
      const published = await read(() => publication(state.task), signal);
      const held = 'access' in state.context ? state.context.access.permissions : [];
      if (!held.includes('rental-os:order:create')) throw denied();
      const cutoff = Math.min(now().getTime() + maximumMs, published.expiresAt.getTime(),
        command.intent === 'explicit_answer_continue' ? Infinity : state.wait.expiresAt.getTime());
      const actions: TaskInputAdmissionReference['actions'] = [];
      for (const selected of operationsFor(command.intent)) {
        const existing = await d.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: {
          scopeId: state.task.scopeId, taskId: state.task.id, operation: selected } } });
        if (existing && (existing.scopeId !== state.task.scopeId || existing.taskId !== state.task.id || existing.operation !== selected
          || !Number.isSafeInteger(existing.revision) || existing.revision < 1 || !(existing.expiresAt instanceof Date)
          || !Number.isFinite(existing.expiresAt.getTime()) || !permissions.safeParse(existing.requiredPermissions).success)) throw unavailable();
        const requiredPermissions = [...new Set(['rental-os:order:create', ...(existing ? existing.requiredPermissions as string[] : [])])];
        if (requiredPermissions.some(permission => !held.includes(permission))) throw denied();
        const retain = !!existing && existing.expiresAt > now() && requiredPermissions.every(permission =>
          Array.isArray(existing.requiredPermissions) && existing.requiredPermissions.includes(permission));
        actions.push(action.parse({ operation: selected, mode: retain ? 'retain' : 'configure', expectedRevision: existing?.revision ?? null,
          requiredPermissions, expiresAt: retain ? existing!.expiresAt.toISOString() : new Date(cutoff).toISOString() }));
      }
      const body = { version: 'task-input-admission-1' as const, intent: command.intent, original: command.original, input,
        task: { taskId: state.task.id, scopeId: state.task.scopeId, ownerId: state.task.ownerId, sceneCode: 'quote_clarification' as const,
          sceneVersion: state.task.sceneVersion, inputRevision: state.task.inputRevision!, inputHash: hash.parse(state.task.inputHash) },
        wait: { requestId: state.wait.id, runId: state.wait.runId, stepId: state.wait.stepId, revision: state.wait.revision,
          requestHash: state.wait.requestHash, contractHash: state.wait.contractHash, expiresAt: state.wait.expiresAt.toISOString() },
        executionRunId: state.executionRunId, stageHash: state.stageHash, publicationHash: published.hash, actions };
      const reference = referenceSchema.parse({ ...body, intentHash: referenceHash(body) });
      await read(() => verify(reference, 'issue'), signal);
      const inputWaitMode = await bindWaitMode(reference, signal);
      return { phase: 'prepared' as const, reference, inputWaitMode, admission: actions.every(row => row.mode === 'retain')
        ? 'existing_policies_available' as const : 'explicit_input_policy_issuance_required' as const, execution: 'not_started' as const };
    },
    async issue(value: unknown, signal?: AbortSignal) {
      const query = z.object({ reference: referenceSchema, intent }).strict(), parsed = query.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const reference = parseReference(parsed.data.reference);
      if (reference.intent !== parsed.data.intent) throw denied();
      const previous = await readReceipt(reference, signal);
      if (previous.entries.some(row => row.state === 'recorded')) return { phase: 'original_receipts' as const, reference,
        receipt: previous, admission: 'not_granted_by_replay' as const, execution: 'not_started' as const };
      await read(() => verify(reference, 'issue'), signal);
      let active = !signal?.aborted;
      const close = () => { active = false; };
      signal?.addEventListener('abort', close, { once: true });
      const currentVerifier: typeof verify = async (...args) => {
        if (!active) throw denied();
        const result = await verify(...args);
        if (!active) throw denied();
        return result;
      };
      const authority = new TaskInputAdmissionAuthority(d, reference, 'issue', currentVerifier);
      let attempted = false;
      try {
        for (const row of reference.actions) {
          if (row.mode === 'retain') continue;
          const writer = authority.writer(row);
          attempted = true;
          await waitForTaskApplicationDependency(() => writer.put({ taskId: reference.task.taskId, operation: row.operation,
            requiredPermissions: row.requiredPermissions, expiresAt: new Date(row.expiresAt) }, row.expectedRevision, true), true, signal);
        }
        await read(() => verify(reference, 'issue'), signal);
        const receipt = await readReceipt(reference, signal);
        if (!receipt.completeRecorded) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        return { phase: 'input_policy_admission_recorded' as const, reference, receipt,
          admission: 'current_wait_publication_and_role_revalidated' as const, execution: 'not_started' as const };
      } catch (error) {
        if (attempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        throw error;
      } finally {
        active = false;
        signal?.removeEventListener('abort', close);
      }
    }, readReceipt, bindWaitMode
  });
}
