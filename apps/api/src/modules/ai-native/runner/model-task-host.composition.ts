import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { composePersistedTaskModelInput } from '../model-input/persisted-task-model-input.composition';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, taskModelMaterialSchema, taskImageMaterialSchema, parseTaskModelInput, taskModelFingerprint } from '../model-input/task-model-input';
import { isGatewayResult } from '../gateway-contract-validation';
import { aiTaskRunnerLimitsSchema } from './prisma-task-run-evidence.repository';
import { composeAuthorizedPersistentTaskInputRunner } from './authorized-persistent-task-input.composition';
import type { AiTaskApplicationHost } from './prisma-task-application';
import type { AiTaskHeldPreparation } from './ai-task-runner.service';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id,
  material: taskModelMaterialSchema, limits: aiTaskRunnerLimitsSchema }).strict();

export type TaskModelHostDependencies = Parameters<typeof composePersistedTaskModelInput>[0] & {
  host: AiTaskApplicationHost;
  task: Omit<z.infer<typeof taskSchema>, 'material'> & { material: z.infer<typeof taskImageMaterialSchema> };
  inputSource: AiTaskInputSource;
  financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  monotonic?: () => number;
};

export function composeTaskModelHost(input: TaskModelHostDependencies) {
  if (typeof input?.financialEvidence?.readDispatch !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const task = (input.kind === 'image' ? taskSchema.extend({ material: taskImageMaterialSchema }) : taskSchema).parse(structuredClone(input.task));
  const tool = input.kind === 'image' ? TASK_IMAGE_MODEL_TOOL : TASK_TEXT_MODEL_TOOL;
  const model = composePersistedTaskModelInput(input);
  const prepare: AiTaskHeldPreparation = async ({ lease, taskRevision, signal }) => {
    if (lease.taskId !== task.taskId || signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    let { registrationRef, material, limits } = task;
    if (lease.runId !== task.runId) {
      // Image continuations need their own current attachment and resource binding;
      // do not reuse the text-only continuation producer as a dispatch grant.
      if (input.kind === 'image') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const continuation = await root.inputs.readContinuation(lease);
      const policy = { sceneCode: input.gatewayScene.sceneCode, maxOutputTokens: input.gatewayScene.maxOutputTokens };
      const previous = parseTaskModelInput(continuation.input, policy), result = continuation.result;
      if (continuation.resourceOriginRunId !== task.runId || taskModelFingerprint(previous, policy) !== continuation.inputHash
        || !isGatewayResult(result) || result.status !== 'completed' || result.usage.kind !== 'reported'
        || result.requestId !== previous.intent.requestId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      registrationRef = continuation.registrationRef;
      material = taskModelMaterialSchema.parse({ messages: [...previous.intent.messages,
        { role: 'assistant', content: [{ kind: 'text', text: result.text }] },
        { role: 'user', content: [{ kind: 'text', text: JSON.stringify({ request: 'clarification_answers', answers: continuation.answers }) }] }],
        maxOutputTokens: previous.intent.maxOutputTokens });
      limits = continuation.limits;
    }
    await model.publish({ taskId: task.taskId, registrationRef,
      expectedTaskRevision: taskRevision, lease, material: structuredClone(material) });
    if (signal?.aborted) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await model.plans.savePlan({ taskId: task.taskId, runId: lease.runId, taskRevision,
      steps: [{ registrationRef, toolCode: tool, toolVersion: AI_TOOL_DRAFT_VERSION, operation: 'external_unknown' }],
      limits: structuredClone(limits) }, lease);
  };
  const root = composeAuthorizedPersistentTaskInputRunner({ db: input.db,
    authorization: { auth: input.auth, credentials: input.credentials, subscriptions: input.subscriptions },
    registrationAuthority: model.planAuthority, transitionAuthority: model.createTransitionAuthority(input.financialEvidence),
    planAuthority: model.planAuthority, commands: model.commands, executors: model.executors,
    invocations: model.invocations, toolCatalog: model.toolCatalog, financialEvidence: input.financialEvidence,
    inputSource: input.inputSource, wall: input.clock, monotonic: input.monotonic });
  const application = root.createApplication(input.host, prepare);
  return Object.freeze({ model, ...root, application });
}
