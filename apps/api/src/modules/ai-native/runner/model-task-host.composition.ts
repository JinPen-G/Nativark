import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { aiStepActionId } from '../ai-step-registration.repository';
import { AI_TOOL_DRAFT_VERSION, isAiTaskInputSubmissionDraft, type AiTaskInputSubmissionDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { composePersistedTaskModelInput, composeCurrentAuthorizedTaskModelInput } from '../model-input/persisted-task-model-input.composition';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, taskModelMaterialSchema, taskImageMaterialSchema, taskAudioMaterialSchema, parseTaskModelInput, taskModelFingerprint, continueTaskModelMaterial } from '../model-input/task-model-input';
import { isGatewayResult } from '../gateway-contract-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema } from './prisma-task-run-evidence.repository';
import { composeCurrentAuthorizedPersistentTaskInputRunner } from './authorized-persistent-task-input.composition';
import { waitForTaskApplicationDependency, type AiTaskApplicationHost } from './prisma-task-application';
import { withAiTaskHeldPreparationDefinition, inheritAiTaskHeldPreparation, type AiTaskHeldPreparation } from './ai-task-runner.service';
import { readTaskModelRunOrigin } from '../task-input/prisma-task-input.repository';
import { taskPreparationNonEffectChargeIds } from './prisma-task-run-preparation';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id,
  material: taskModelMaterialSchema, limits: aiTaskRunnerLimitsSchema }).strict();

export type TaskModelHostDependencies = Parameters<typeof composePersistedTaskModelInput>[0] & {
  host: AiTaskApplicationHost;
  task: Omit<z.infer<typeof taskSchema>, 'material'> & { material: z.infer<typeof taskModelMaterialSchema> | z.infer<typeof taskImageMaterialSchema> | z.infer<typeof taskAudioMaterialSchema> };
  inputSource: AiTaskInputSource;
  financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  monotonic?: () => number;
  /** Explicit operator-control composition only; omitted by ordinary/media hosts. */
  readRunOrigin?: typeof readTaskModelRunOrigin;
  controlResourceOrigin?: import('./task-run-preparation.ports').AiTaskControlResourceOrigin;
};

export function composeTaskModelHost(input: TaskModelHostDependencies) {
  return composeTaskModelHostWithModel(input, composePersistedTaskModelInput(input));
}

/** Server-only reuse point, not a second execution engine or dispatch grant. */
export function composeTaskModelHostWithModel<T extends ReturnType<typeof composeCurrentAuthorizedTaskModelInput>>(
  input: Omit<TaskModelHostDependencies, 'auth' | 'credentials' | 'subscriptions'>, model: T,
) {
  if (typeof input?.financialEvidence?.readDispatch !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const task = (input.kind === 'image' ? taskSchema.extend({ material: taskImageMaterialSchema })
    : input.kind === 'audio' ? taskSchema.extend({ material: taskAudioMaterialSchema }) : taskSchema).parse(structuredClone(input.task));
  const tool = input.kind === 'image' ? TASK_IMAGE_MODEL_TOOL : input.kind === 'audio' ? TASK_AUDIO_MODEL_TOOL : TASK_TEXT_MODEL_TOOL;
  const policy = { sceneCode: input.gatewayScene.sceneCode, maxOutputTokens: input.gatewayScene.maxOutputTokens,
    ...(input.gatewayScene.orderExplainTool !== undefined ? { orderExplainTool: input.gatewayScene.orderExplainTool } : {}),
    ...(input.gatewayScene.structuredOutput !== undefined ? { structuredOutput: input.gatewayScene.structuredOutput } : {}),
    ...(input.gatewayScene.structuredSchemaHash ? { structuredSchemaHash: input.gatewayScene.structuredSchemaHash } : {}),
    ...(input.kind ? { kind: input.kind } : {}) };
  const prepare: AiTaskHeldPreparation = async ({ lease, taskRevision, signal }) => {
    if (lease.taskId !== task.taskId || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    let { registrationRef, material, limits } = task;
    let expectedMedia: ReturnType<typeof parseTaskModelInput>['media'];
    if (lease.runId !== task.runId) {
      const continuation = await root.inputs.readContinuation(lease);
      const previous = parseTaskModelInput(continuation.input, policy), result = continuation.result;
      if (continuation.resourceOriginRunId !== task.runId || taskModelFingerprint(previous, policy) !== continuation.inputHash
        || !isGatewayResult(result) || result.status !== 'completed' || result.usage.kind !== 'reported'
        || result.requestId !== previous.intent.requestId
        || requestFingerprint(result.actual) !== requestFingerprint(previous.configuration)
        || result.toolRequests.length) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      registrationRef = continuation.registrationRef;
      material = continueTaskModelMaterial(previous, result, continuation.answers, policy);
      limits = continuation.limits;
      // A follow-up carries the same immutable attachment versions/hashes, not
      // a freshly selected file. Publication rechecks current ACL and bytes.
      expectedMedia = previous.media;
    }
    await model.publish({ taskId: task.taskId, registrationRef,
      expectedTaskRevision: taskRevision, lease, material: structuredClone(material),
      ...(expectedMedia ? { expectedMedia } : {}) });
    if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await model.plans.savePlan({ taskId: task.taskId, runId: lease.runId, taskRevision,
      steps: [{ registrationRef, toolCode: tool, toolVersion: AI_TOOL_DRAFT_VERSION, operation: 'external_unknown' }],
      limits: structuredClone(limits) }, lease);
  };
  const root = composeCurrentAuthorizedPersistentTaskInputRunner({ db: input.db,
    registrationAuthority: model.planAuthority, transitionAuthority: model.createTransitionAuthority(input.financialEvidence),
    planAuthority: model.planAuthority, commands: model.commands, executors: model.executors,
    invocations: model.invocations, toolCatalog: model.toolCatalog, financialEvidence: input.financialEvidence,
    inputSource: input.inputSource, wall: input.clock, monotonic: input.monotonic,
    controlResourceOrigin: input.controlResourceOrigin }, model.authorization);
  withAiTaskHeldPreparationDefinition(prepare, { taskId: task.taskId, runId: task.runId,
    steps: [{ registrationRef: task.registrationRef, toolCode: tool, toolVersion: AI_TOOL_DRAFT_VERSION, operation: 'external_unknown' }],
    limits: task.limits, bindingHash: requestFingerprint(task) });
  const application = root.createApplication(input.host, prepare);
  const originalRun = async () => {
    const access = await root.authorization.tasks.resolveAccess(task.taskId, 'read_metadata');
    const selected = await input.db.$transaction(async tx => {
      const stored = await tx.aiTask.findFirst({ where: access.where });
      if (!stored || stored.id !== task.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const runs = await tx.aiRun.findMany({ where: { scopeId: stored.scopeId, taskId: stored.id,
        actorKind: access.actorKind, actorId: access.actorId }, orderBy: { sequence: 'desc' }, take: 2 });
      if (!runs[0] || runs[1]?.sequence === runs[0].sequence) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      await (input.readRunOrigin ?? readTaskModelRunOrigin)(tx, access, { scopeId: stored.scopeId, taskId: stored.id, runId: runs[0].id,
        originRunId: task.runId, registrationRef: task.registrationRef });
      return { taskId: task.taskId, runId: runs[0].id, taskRevision: stored.revision, runRevision: runs[0].revision };
    }, { maxWait: 2500, timeout: 5000 }).catch(error => {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    });
    const current = await root.authorization.tasks.resolveAccess(task.taskId, 'read_metadata');
    if (access.bindingKey !== current.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return selected;
  };
  const originalSnapshot = async () => {
    const selected = await originalRun();
    const request = { taskId: selected.taskId, runId: selected.runId };
    const snapshot = await application.inspect(request);
    if (snapshot.task.revision !== selected.taskRevision || snapshot.run.revision !== selected.runRevision)
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    return { request, snapshot };
  };
  const recoveryHost = Object.freeze(structuredClone(input.host));
  const continueOriginalInput = async (value: Omit<AiTaskInputSubmissionDraft, 'taskId'>, signal?: AbortSignal) => {
    if (!value || Object.prototype.hasOwnProperty.call(value, 'taskId')) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const submission = { ...structuredClone(value), taskId: task.taskId };
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const receipt = await waitForTaskApplicationDependency(() => root.inputs.readSubmission(submission), false);
    if (receipt.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const { request, snapshot } = await waitForTaskApplicationDependency(originalSnapshot, false);
    if (receipt.runId !== request.runId) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    if (signal?.aborted || snapshot.task.status !== 'running') return { receipt,
      execution: { kind: 'not_started' as const, reason: signal?.aborted ? 'host_aborted' as const : 'task_not_runnable' as const } };
    if (snapshot.plan && snapshot.steps.every(step => step.status === 'pending')) {
      // A lost preparation reply can leave the original plan but no dispatched
      // work. Explicit continuation takes a fresh CAS lease and revalidates that
      // plan under it, rather than publishing another input or replaying effects.
      const frozenPreparation: AiTaskHeldPreparation = async ({ lease, taskRevision, signal }) => {
        if (lease.taskId !== request.taskId || lease.runId !== request.runId || signal?.aborted)
          throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const access = await root.authorization.tasks.resolveAccess(task.taskId, 'transition_task');
        const original = await input.db.$transaction(async tx => {
          const owner = await tx.aiTask.findFirst({ where: access.where });
          if (!owner || owner.id !== task.taskId || owner.status !== 'RUNNING'
            || owner.revision !== taskRevision || owner.cancelRequestedAt !== null)
            throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const key = { scopeId: owner.scopeId, taskId: task.taskId, runId: request.runId };
          const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
          if (!run || run.id !== key.runId || run.scopeId !== key.scopeId || run.taskId !== key.taskId
            || run.revision !== lease.revision || run.leaseOwnerId !== lease.holderId
            || run.fencingToken.toFixed(0) !== lease.fencingToken || run.status !== 'RUNNING'
            || !run.leaseExpiresAt || run.leaseExpiresAt <= (input.clock?.() ?? new Date()))
            throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          const origin = await (input.readRunOrigin ?? readTaskModelRunOrigin)(tx, access, { ...key,
            originRunId: task.runId, registrationRef: task.registrationRef });
          const stored = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
          if (!stored) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const plan = aiTaskRunPlanSchema.parse(structuredClone(stored.payload)), planned = plan.steps[0];
          if (stored.scopeId !== key.scopeId || stored.taskId !== key.taskId || stored.runId !== key.runId
            || stored.planHash !== snapshot.plan!.planHash || requestFingerprint(plan) !== stored.planHash
            || plan.taskId !== key.taskId || plan.runId !== key.runId || plan.steps.length !== 1
            || planned.toolCode !== tool || planned.toolVersion !== AI_TOOL_DRAFT_VERSION
            || planned.operation !== 'external_unknown' || planned.registrationRef !== origin.registrationRef)
            throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const inputs = await tx.aiTaskActionInput.findMany({ where: key, take: 2 });
          if (inputs.length !== 1 || inputs[0].registrationRef !== planned.registrationRef
            || inputs[0].toolCode !== tool || inputs[0].toolVersion !== AI_TOOL_DRAFT_VERSION)
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const continuation = origin.continuation;
          if (!continuation) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const previous = parseTaskModelInput(continuation.input, policy), result = continuation.result;
          if (taskModelFingerprint(previous, policy) !== continuation.inputHash || !isGatewayResult(result)
            || result.status !== 'completed' || result.usage.kind !== 'reported'
            || result.requestId !== previous.intent.requestId
            || requestFingerprint(result.actual) !== requestFingerprint(previous.configuration) || result.toolRequests.length)
            throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const expected = continueTaskModelMaterial(previous, result, continuation.answers, policy);
          const frozen = parseTaskModelInput(inputs[0].payload, policy);
          // Validate the saved continuation against its original model result
          // and bound answer; inspecting material is not publishing it again.
          if (requestFingerprint(frozen.intent.messages) !== requestFingerprint(expected.messages)
            || frozen.intent.maxOutputTokens !== expected.maxOutputTokens
            || requestFingerprint(frozen.media ?? null) !== requestFingerprint(previous.media ?? null))
            throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const preparationCharges = await taskPreparationNonEffectChargeIds(tx, key, lease);
          const [steps, charge, invocation, phase, artifact] = await Promise.all([
            tx.aiStep.findMany({ where: key, take: 2 }),
            tx.aiTaskExecutionCharge.findFirst({ where: { ...key, chargeId: { notIn: preparationCharges } } }),
            tx.aiGatewayInvocation.findFirst({ where: key }),
            tx.aiTaskExecutionPhaseStart.findFirst({ where: key }),
            tx.aiTaskResultArtifact.findFirst({ where: key })
          ]);
          // PENDING or an absent result alone never proves no consumption. All
          // original execution traces must be absent before starting this step.
          if (steps.length > 1 || charge || invocation || phase || artifact || steps.some(step =>
            step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId
            || step.status !== 'PENDING' || step.effect !== 'NONE' || step.sequence !== 1 || step.revision !== 1
            || step.resultRef !== null || step.errorCode !== null || step.inputRef !== inputs[0].id
            || step.requestFingerprint !== inputs[0].fingerprint || step.toolCode !== tool
            || step.toolVersion !== AI_TOOL_DRAFT_VERSION
            || step.actionId !== aiStepActionId(access.scope, task.taskId, planned.registrationRef)))
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return plan;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
        if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        await model.revalidatePublished({ ...request, registrationRef: original.steps[0].registrationRef });
        // Existing input/plan authority and resource origin stay in charge. The
        // exact saved plan is replay-validated, never regenerated or overwritten.
        await model.plans.savePlan(original, lease);
      };
      inheritAiTaskHeldPreparation(frozenPreparation, prepare);
      return { receipt, execution: await root.createApplication(recoveryHost, frozenPreparation).start(request, signal) };
    }
    // Dispatched/occupied work remains recovery-only; an unprepared successor
    // still uses the original held preparation after the bound answer receipt.
    const execution = snapshot.plan || snapshot.steps.length
      ? await application.reconcile(request, signal) : await application.start(request, signal);
    return { receipt, execution };
  };
  const recoverOriginal = async (signal?: AbortSignal) => {
    if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
    const { request, snapshot } = await waitForTaskApplicationDependency(originalSnapshot, false, signal);
    // A terminal or never-dispatched run remains observation. Recovery cannot
    // prepare/publish a new input or save another plan to make it runnable.
    if (!snapshot.plan || !['running', 'waiting_input', 'waiting_confirmation', 'waiting_external', 'cancel_requested'].includes(snapshot.task.status)) {
      return { kind: 'not_started' as const, reason: 'task_not_runnable' as const };
    }
    // Repository CAS fences the previous holder. The original runner rechecks
    // authority and persisted plan/evidence and owns bounded lease cleanup;
    // external_unknown is reconciliation only, never a provider retry.
    return { kind: 'run_outcome' as const, outcome: await root.runner.run({ ...request,
      holderId: recoveryHost.holderId, leaseMs: recoveryHost.leaseMs,
      expectedTaskRevision: snapshot.task.revision, expectedRunRevision: snapshot.run.revision,
      expectedFencingToken: snapshot.run.fencingToken, recovery: true }, signal) };
  };
  const requestCancelOriginal = async (value: unknown) => {
    const parsed = z.object({ expectedRevision: z.number().int().min(1).max(4294967294) })
      .strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = structuredClone(await waitForTaskApplicationDependency(() => root.authorization.tasks.resolveAccess(task.taskId, 'read_metadata'), false));
    // The original transition repository supplies action authorization, scoped
    // revision CAS and durable cancellation/event ordering. No run is started,
    // accounting released or external effect claimed to have been rolled back.
    const receipt = await waitForTaskApplicationDependency(() => root.taskTransitions.transition({ taskId: task.taskId,
      expectedRevision: parsed.data.expectedRevision, to: 'cancel_requested', reason: 'cancel_requested' }), true);
    const after = await waitForTaskApplicationDependency(() => root.authorization.tasks.resolveAccess(task.taskId, 'read_metadata'), true);
    if (before.bindingKey !== after.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { receipt, cancellation: 'requested_not_rollback' as const,
      retryable: false as const, nextAction: 'read_original_task' as const };
  };
  return Object.freeze({ model, ...root, application,
    requestCancelOriginal,
    recoverOriginal,
    continueOriginalInput,
    // Inspection is observation only, including after a process rebuild.
    // Reconciliation uses the existing application's held-lease gate; a new
    // holder receives recovery_lease_unavailable, not new dispatch permission.
    readOriginalRecovery: async () => (await waitForTaskApplicationDependency(originalSnapshot, false)).snapshot,
    reconcileOriginal: async (signal?: AbortSignal) => application.reconcile((await waitForTaskApplicationDependency(originalSnapshot, false, signal)).request, signal) });
}
