import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { isGatewayOrderExplainRequest, isGatewayResult } from '../gateway-contract-validation';
import { composePersistedTaskModelInput } from './persisted-task-model-input.composition';
import { TASK_TEXT_MODEL_TOOL, taskModelMaterialSchema, taskModelPolicy, parseTaskModelInput, taskModelFingerprint } from './task-model-input';
import { PrismaTaskPlanInputSource } from '../runner/prisma-task-plan-input.source';
import { composePersistedOrderFactsTaskRunner } from '../runner/persisted-catalog-runner.composition';
import { composeCurrentAuthorizedPersistentTaskInputRunner } from '../runner/authorized-persistent-task-input.composition';
import { PrismaTaskStepEvidenceAuthority } from '../runner/prisma-task-step-evidence.authority';
import { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import type { AiTaskPlanEvidenceAuthority } from '../runner/prisma-task-run-evidence.repository';
import type { AiTaskHeldPreparation } from '../runner/ai-task-runner.service';
import type { AiTaskRegisteredExecutor } from '../runner/prisma-task-measured-effects';
import type { AiStepTransitionAuthority } from '../ai-step-transition.repository';
import type { TaskModelHostDependencies } from '../runner/model-task-host.composition';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), modelRegistrationRef: id,
  orderRegistrationRef: id, orderId: id, material: taskModelMaterialSchema, limits: aiTaskRunnerLimitsSchema }).strict()
  .refine(task => task.modelRegistrationRef !== task.orderRegistrationRef);
type Dependencies = Omit<TaskModelHostDependencies, 'task' | 'kind' | 'planTools'> & {
  core: Pick<RentalCoreService, 'getOrder'>;
  /** Frozen server task input, never a public model prompt/permission switch. */
  task: z.infer<typeof taskSchema>;
};
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** Bounded original model -> original order reader handoff. Both inputs and
 * both steps exist before the immutable plan is saved. No append/new run,
 * provider loop, Core write, approval or second ledger is introduced. */
export function composePersistedModelOrderTaskRunner(input: Dependencies) {
  const task = taskSchema.parse(structuredClone(input.task));
  if (input.gatewayScene.orderExplainTool !== true || input.gatewayScene.structuredOutput
    || typeof input.financialEvidence?.readDispatch !== 'function') throw unavailable();
  const { routeScene: _route, ...serverPolicy } = structuredClone(input.gatewayScene);
  const policy = taskModelPolicy(serverPolicy);
  const model = composePersistedTaskModelInput({ ...input, planTools: [TASK_TEXT_MODEL_TOOL, 'rental.order.explain'] });
  const order = composePersistedOrderFactsTaskRunner({ db: input.db, authorization: input,
    guard: input.guard, core: input.core, wall: input.clock, monotonic: input.monotonic });
  PrismaTaskPlanInputSource.bindModelOrderPlanSources(model.planAuthority, order.source);
  const expectedSteps = [
    { registrationRef: task.modelRegistrationRef, toolCode: TASK_TEXT_MODEL_TOOL, toolVersion: AI_TOOL_DRAFT_VERSION, operation: 'external_unknown' as const },
    { registrationRef: task.orderRegistrationRef, toolCode: 'rental.order.explain', toolVersion: AI_TOOL_DRAFT_VERSION, operation: 'readonly' as const }
  ];
  const planAuthority: AiTaskPlanEvidenceAuthority = { authorize: async (value, lease) => {
    const plan = aiTaskRunPlanSchema.parse(structuredClone(value));
    if (plan.taskId !== task.taskId || plan.runId !== task.runId
      || requestFingerprint(plan.steps) !== requestFingerprint(expectedSteps)) throw denied();
    return model.planAuthority.authorize(plan, lease);
  } };
  const modelEvidence = model.createTransitionAuthority(input.financialEvidence);
  const readEvidence = new PrismaTaskStepEvidenceAuthority(input.db, model.authorization.authority, planAuthority, input.clock);
  const candidate = async (binding: { taskId: string; runId: string; inputRef: string; fingerprint: string }) => {
    binding = structuredClone(binding);
    if (binding.taskId !== task.taskId || binding.runId !== task.runId) throw denied();
    const access = await model.tasks.resolveAccess(task.taskId, 'read_step_terminal');
    const row = await input.db.aiTask.findFirst({ where: access.where });
    if (!row) throw denied();
    const storedOrder = await order.source.readOrderExplainInput(binding);
    if (storedOrder.registrationRef !== task.orderRegistrationRef || storedOrder.input.input.orderId !== task.orderId) throw denied();
    const key = { scopeId: row.scopeId, taskId: task.taskId, runId: task.runId };
    const frozen = await input.db.aiTaskActionInput.findFirst({ where: { ...key, registrationRef: task.modelRegistrationRef } });
    if (!frozen || frozen.scopeId !== key.scopeId || frozen.taskId !== task.taskId || frozen.runId !== task.runId
      || frozen.registrationRef !== task.modelRegistrationRef || frozen.toolCode !== TASK_TEXT_MODEL_TOOL
      || frozen.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
    const published = parseTaskModelInput(frozen.payload, policy);
    if (!published.intent.requiredFeatures.includes('tools') || frozen.fingerprint !== taskModelFingerprint(published, policy)) throw denied();
    const parent = await input.db.aiStep.findFirst({ where: { ...key, inputRef: frozen.id,
      toolCode: TASK_TEXT_MODEL_TOOL, requestFingerprint: frozen.fingerprint, status: 'SUCCEEDED' } });
    if (!parent?.resultRef) throw unavailable();
    const proof = await modelEvidence.readCompletedEvidence(task.taskId, parent.id, parent.resultRef);
    const result = proof.artifact.payload;
    if (!isGatewayResult(result) || result.status !== 'completed' || result.usage.kind !== 'reported'
      || result.requestId !== published.intent.requestId || requestFingerprint(result.actual) !== requestFingerprint(published.configuration)
      || result.toolRequests.length !== 1 || !isGatewayOrderExplainRequest(result.toolRequests[0])
      || requestFingerprint(result.toolRequests[0]) !== requestFingerprint(storedOrder.input)) throw denied();
    const current = await model.tasks.resolveAccess(task.taskId, 'read_step_terminal');
    if (current.bindingKey !== access.bindingKey) throw denied();
    return { resultId: proof.artifact.id, contentHash: proof.artifact.contentHash,
      invocation: result.requestId, inputHash: frozen.fingerprint };
  };
  const transitionAuthority: AiStepTransitionAuthority = { resolve: async command => {
    command = structuredClone(command);
    const access = await model.tasks.resolveAccess(command.taskId, 'transition_task');
    const row = await input.db.aiTask.findFirst({ where: access.where });
    if (!row || row.id !== task.taskId || command.lease.runId !== task.runId) throw denied();
    const step = await input.db.aiStep.findFirst({ where: { scopeId: row.scopeId, taskId: row.id,
      runId: task.runId, id: command.stepId } });
    if (!step) throw denied();
    if (step.toolCode === TASK_TEXT_MODEL_TOOL) return modelEvidence.resolve(command);
    if (step.toolCode !== 'rental.order.explain' || !step.inputRef) throw denied();
    await readEvidence.resolve(command);
    const proof = await candidate({ taskId: task.taskId, runId: task.runId, inputRef: step.inputRef, fingerprint: step.requestFingerprint });
    const grant = await readEvidence.resolve(command);
    return { ...grant, authorizationKey: `${grant.authorizationKey}:candidate-${requestFingerprint(proof)}` };
  } };
  const executors: AiTaskRegisteredExecutor = { resolve: async (code, version) => {
    if (code === TASK_TEXT_MODEL_TOOL) return model.executors.resolve(code, version);
    if (code !== 'rental.order.explain') return null;
    const executor = await order.executors.resolve(code, version);
    if (!executor) return null;
    return { operation: 'readonly', execute: async (binding, signal) => {
      if (signal.aborted) throw unavailable();
      await candidate(binding);
      return executor.execute(binding, signal);
    } };
  } };
  const root = composeCurrentAuthorizedPersistentTaskInputRunner({ db: input.db, wall: input.clock, monotonic: input.monotonic,
    planAuthority, transitionAuthority, registrationAuthority: { resolve: async command => {
      if (command.registrationRef === task.modelRegistrationRef) return model.planAuthority.resolve(command);
      if (command.registrationRef === task.orderRegistrationRef) return order.source.resolve(command);
      throw unavailable();
    } }, commands: {
      register: (plan, lease) => plan.toolCode === TASK_TEXT_MODEL_TOOL ? model.commands.register(plan, lease) : order.commands.register(plan, lease),
      transition: (kind, step, lease, resultRef) => step.plan.toolCode === TASK_TEXT_MODEL_TOOL
        ? model.commands.transition(kind, step, lease, resultRef) : order.commands.transition(kind, step, lease, resultRef)
    }, executors, invocations: model.invocations, financialEvidence: input.financialEvidence,
    inputSource: { resolve: binding => binding.toolCode === 'rental.order.explain' ? order.inputSource.resolve(binding) : input.inputSource.resolve(binding),
      validateAnswers: (binding, contract, answers) => input.inputSource.validateAnswers(binding, contract, answers) },
    toolCatalog: { resolve: (code, version) => code === TASK_TEXT_MODEL_TOOL ? model.toolCatalog.resolve(code, version) : order.toolCatalog.resolve(code, version) }
  }, model.authorization);
  const prepare: AiTaskHeldPreparation = async ({ lease, taskRevision, signal }) => {
    if (signal?.aborted || lease.taskId !== task.taskId || lease.runId !== task.runId) throw denied();
    await model.publish({ taskId: task.taskId, registrationRef: task.modelRegistrationRef,
      expectedTaskRevision: taskRevision, lease, material: task.material });
    await order.source.publishOrderExplainInput({ taskId: task.taskId, registrationRef: task.orderRegistrationRef,
      expectedTaskRevision: taskRevision, lease, input: { contractVersion: AI_CONTRACT_DRAFT_VERSION,
        toolCode: 'rental.order.explain', toolVersion: AI_TOOL_DRAFT_VERSION, input: { orderId: task.orderId } } });
    if (signal?.aborted) throw unavailable();
    await root.evidence.savePlan({ taskId: task.taskId, runId: task.runId, taskRevision, steps: expectedSteps, limits: task.limits }, lease);
  };
  return Object.freeze({ ...root, model, application: root.createApplication(input.host, prepare) });
}
