import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { composePersistedTaskModelInput, composeCurrentAuthorizedTaskModelInput } from '../model-input/persisted-task-model-input.composition';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, taskModelMaterialSchema, taskImageMaterialSchema, taskAudioMaterialSchema, parseTaskModelInput, taskModelFingerprint, continueTaskModelMaterial } from '../model-input/task-model-input';
import { isGatewayResult } from '../gateway-contract-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiTaskRunnerLimitsSchema } from './prisma-task-run-evidence.repository';
import { composeCurrentAuthorizedPersistentTaskInputRunner } from './authorized-persistent-task-input.composition';
import type { AiTaskApplicationHost } from './prisma-task-application';
import type { AiTaskHeldPreparation } from './ai-task-runner.service';
import { readTaskModelRunOrigin } from '../task-input/prisma-task-input.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id,
  material: taskModelMaterialSchema, limits: aiTaskRunnerLimitsSchema }).strict();

export type TaskModelHostDependencies = Parameters<typeof composePersistedTaskModelInput>[0] & {
  host: AiTaskApplicationHost;
  task: Omit<z.infer<typeof taskSchema>, 'material'> & { material: z.infer<typeof taskModelMaterialSchema> | z.infer<typeof taskImageMaterialSchema> | z.infer<typeof taskAudioMaterialSchema> };
  inputSource: AiTaskInputSource;
  financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  monotonic?: () => number;
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
  const prepare: AiTaskHeldPreparation = async ({ lease, taskRevision, signal }) => {
    if (lease.taskId !== task.taskId || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    let { registrationRef, material, limits } = task;
    let expectedMedia: ReturnType<typeof parseTaskModelInput>['media'];
    if (lease.runId !== task.runId) {
      const continuation = await root.inputs.readContinuation(lease);
      const policy = { sceneCode: input.gatewayScene.sceneCode, maxOutputTokens: input.gatewayScene.maxOutputTokens,
      ...(input.kind ? { kind: input.kind } : {}) };
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
    inputSource: input.inputSource, wall: input.clock, monotonic: input.monotonic }, model.authorization);
  const application = root.createApplication(input.host, prepare);
  const originalRun = async () => {
    const access = await root.authorization.tasks.resolveAccess(task.taskId, 'read_metadata');
    const selected = await input.db.$transaction(async tx => {
      const stored = await tx.aiTask.findFirst({ where: access.where });
      if (!stored || stored.id !== task.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const runs = await tx.aiRun.findMany({ where: { scopeId: stored.scopeId, taskId: stored.id,
        actorKind: access.actorKind, actorId: access.actorId }, orderBy: { sequence: 'desc' }, take: 2 });
      if (!runs[0] || runs[1]?.sequence === runs[0].sequence) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      await readTaskModelRunOrigin(tx, access, { scopeId: stored.scopeId, taskId: stored.id, runId: runs[0].id,
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
  const recoverOriginal = async (signal?: AbortSignal) => {
    if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
    const { request, snapshot } = await originalSnapshot();
    // A terminal or never-dispatched run remains observation. Recovery cannot
    // prepare/publish a new input or save another plan to make it runnable.
    if (!snapshot.plan || !['running', 'waiting_input', 'waiting_confirmation', 'waiting_external', 'cancel_requested'].includes(snapshot.task.status)) {
      return { kind: 'not_started' as const, reason: 'task_not_runnable' as const };
    }
    const lease = await root.authorization.tasks.claimRecoveryRun({ ...request,
      holderId: recoveryHost.holderId, leaseMs: recoveryHost.leaseMs,
      expectedTaskRevision: snapshot.task.revision, expectedRunRevision: snapshot.run.revision,
      expectedFencingToken: snapshot.run.fencingToken });
    // Repository CAS fences the previous holder. The original runner rechecks
    // authority and persisted plan/evidence and owns bounded lease cleanup;
    // external_unknown is reconciliation only, never a provider retry.
    return { kind: 'run_outcome' as const, outcome: await root.runner.recover(lease, signal) };
  };
  const requestCancelOriginal = async (value: unknown) => {
    const parsed = z.object({ expectedRevision: z.number().int().min(1).max(4294967294) })
      .strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const before = structuredClone(await root.authorization.tasks.resolveAccess(task.taskId, 'read_metadata'));
    // The original transition repository supplies action authorization, scoped
    // revision CAS and durable cancellation/event ordering. No run is started,
    // accounting released or external effect claimed to have been rolled back.
    const receipt = await root.taskTransitions.transition({ taskId: task.taskId,
      expectedRevision: parsed.data.expectedRevision, to: 'cancel_requested', reason: 'cancel_requested' });
    const after = await root.authorization.tasks.resolveAccess(task.taskId, 'read_metadata');
    if (before.bindingKey !== after.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { receipt, cancellation: 'requested_not_rollback' as const,
      retryable: false as const, nextAction: 'read_original_task' as const };
  };
  return Object.freeze({ model, ...root, application,
    requestCancelOriginal,
    recoverOriginal,
    // Inspection is observation only, including after a process rebuild.
    // Reconciliation uses the existing application's held-lease gate; a new
    // holder receives recovery_lease_unavailable, not new dispatch permission.
    readOriginalRecovery: async () => (await originalSnapshot()).snapshot,
    reconcileOriginal: async (signal?: AbortSignal) => application.reconcile((await originalSnapshot()).request, signal) });
}
