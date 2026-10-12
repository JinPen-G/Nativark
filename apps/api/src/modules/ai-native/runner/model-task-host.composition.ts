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
  return Object.freeze({ model, ...root, application });
}
