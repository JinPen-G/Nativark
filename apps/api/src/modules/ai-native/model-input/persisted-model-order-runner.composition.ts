import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, AI_SCENE_REQUEST_DRAFT_VERSION } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { isGatewayOrderExplainRequest, isGatewayResult } from '../gateway-contract-validation';
import { composePersistedTaskModelInput } from './persisted-task-model-input.composition';
import { AiOrderReadFactsService } from '../order-read-facts.service';
import { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { TASK_TEXT_MODEL_TOOL, taskModelMaterialSchema, taskModelPolicy, parseTaskModelInput, taskModelFingerprint, taskModelIdentity } from './task-model-input';
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
import { PrismaOriginalRequestRepository } from '../task-request/prisma-original-request.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const taskSchema = z.object({ taskId: id.max(36), runId: id.max(36), modelRegistrationRef: id,
  orderRegistrationRef: id, orderId: id, material: taskModelMaterialSchema, limits: aiTaskRunnerLimitsSchema }).strict()
  .refine(task => task.modelRegistrationRef !== task.orderRegistrationRef);
type Dependencies = Omit<TaskModelHostDependencies, 'task' | 'kind' | 'planTools'> & {
  core: Pick<RentalCoreService, 'getOrder'>;
  originalRequests: PrismaOriginalRequestRepository;
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
    || typeof input.financialEvidence?.readDispatch !== 'function'
    || !(input.originalRequests instanceof PrismaOriginalRequestRepository)) throw unavailable();
  const { routeScene: _route, ...serverPolicy } = structuredClone(input.gatewayScene);
  const policy = taskModelPolicy(serverPolicy);
  const assertOriginal = async (forExecution = false) => {
    const access = await model.tasks.resolveAccess(task.taskId, 'read_metadata');
    const row = await input.db.aiTask.findFirst({ where: access.where });
    if (!row?.inputRef || row.sceneCode !== 'order_explanation') throw denied();
    const original = await input.originalRequests.readHistorical({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: row.inputRef });
    const receipt = await input.originalRequests.readTaskReceipt(row.inputRef);
    if (original.receipt.state === 'revoked' || (forExecution && original.receipt.state !== 'stored')
      || original.request.sceneCode !== 'order_explanation'
      || original.request.input.orderId !== task.orderId || original.receipt.contentHash !== row.inputHash
      || original.receipt.revision !== row.inputRevision || receipt.state !== 'observed'
      || receipt.taskId !== task.taskId || receipt.runId !== task.runId
      || (await model.tasks.resolveAccess(task.taskId, 'read_metadata')).bindingKey !== access.bindingKey) throw denied();
    return original;
  };
  const runtime = input.runtime;
  const model = composePersistedTaskModelInput({ ...input, runtime: { ...runtime, ports: { ...runtime.ports,
    routing: { resolve: async (...args) => {
      await assertOriginal(true);
      const route = await runtime.ports.routing.resolve(...args);
      await assertOriginal(true);
      return route;
    }, assertCurrent: async (...args) => {
      await runtime.ports.routing.assertCurrent(...args);
      await assertOriginal(true);
    } }
  } }, planTools: [TASK_TEXT_MODEL_TOOL, 'rental.order.explain'] });
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
    await assertOriginal(true);
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
    await assertOriginal(true);
    await model.publish({ taskId: task.taskId, registrationRef: task.modelRegistrationRef,
      expectedTaskRevision: taskRevision, lease, material: task.material });
    await order.source.publishOrderExplainInput({ taskId: task.taskId, registrationRef: task.orderRegistrationRef,
      expectedTaskRevision: taskRevision, lease, input: { contractVersion: AI_CONTRACT_DRAFT_VERSION,
        toolCode: 'rental.order.explain', toolVersion: AI_TOOL_DRAFT_VERSION, input: { orderId: task.orderId } } });
    if (signal?.aborted) throw unavailable();
    await root.evidence.savePlan({ taskId: task.taskId, runId: task.runId, taskRevision, steps: expectedSteps, limits: task.limits }, lease);
  };
  const readOrderResult = async (value: unknown) => {
    const command = z.object({ resultId: id }).strict().safeParse(structuredClone(value));
    if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    await assertOriginal();
    const access = await model.tasks.resolveAccess(task.taskId, 'read_step_terminal');
    const row = await input.db.aiTask.findFirst({ where: access.where });
    if (!row) throw denied();
    const original = await root.results.read({ taskId: task.taskId, resultId: command.data.resultId });
    if (original.runId !== task.runId) throw denied();
    const key = { scopeId: row.scopeId, taskId: task.taskId, runId: task.runId };
    const step = await input.db.aiStep.findFirst({ where: { ...key, id: original.stepId } });
    if (!step || step.scopeId !== key.scopeId || step.taskId !== task.taskId || step.runId !== task.runId
      || step.toolCode !== 'rental.order.explain' || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || step.actionId !== original.actionId || !step.inputRef) throw denied();
    const stored = await input.db.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef,
      registrationRef: task.orderRegistrationRef } });
    const expected = { contractVersion: AI_CONTRACT_DRAFT_VERSION, toolCode: 'rental.order.explain',
      toolVersion: AI_TOOL_DRAFT_VERSION, input: { orderId: task.orderId } };
    if (!stored || stored.scopeId !== key.scopeId || stored.taskId !== task.taskId || stored.runId !== task.runId
      || stored.id !== step.inputRef || stored.registrationRef !== task.orderRegistrationRef
      || stored.toolCode !== step.toolCode || stored.toolVersion !== step.toolVersion
      || requestFingerprint(stored.payload) !== requestFingerprint(expected) || stored.fingerprint !== step.requestFingerprint
      || stored.fingerprint !== requestFingerprint(expected)) throw denied();
    const base = { taskId: task.taskId, runId: task.runId, resultId: original.resultId,
      observedAt: original.observedAt, businessExecution: 'readonly_not_business_commit' as const,
      automaticRetry: false as const };
    if (original.status !== 'succeeded') {
      if ((await model.tasks.resolveAccess(task.taskId, 'read_step_terminal')).bindingKey !== access.bindingKey) throw denied();
      return Object.freeze({ ...base, status: original.status, facts: null,
        nextAction: original.status === 'unknown' ? 'reconcile_original_task' : 'manual_review' });
    }
    // A persisted successful read is historical evidence, not current resource
    // permission. Reopen through the original order Guard/ALS before exposure.
    const authority = new AiOrderRouteContextAuthority(input.guard, input.credentials, task.orderId, input.clock);
    const currentContext = await authority.resolve();
    const current = await new AiOrderReadFactsService(input.core, authority, input.clock).read(currentContext);
    const saved = z.object({ audience: z.string(), scope: z.unknown(), order: z.record(z.unknown()),
      sources: z.array(z.unknown()).max(1), paymentEvidence: z.literal('not_loaded'), historicalFeeEvidence: z.literal('not_loaded') })
      .passthrough().safeParse(original.payload);
    if (!saved.success || saved.data.order.id !== task.orderId || saved.data.audience !== current.audience
      || requestFingerprint(saved.data.scope) !== requestFingerprint(current.scope)) throw denied();
    const latest = await root.results.read({ taskId: task.taskId, resultId: original.resultId });
    if (taskModelIdentity(await authority.resolve()) !== taskModelIdentity(currentContext)) throw denied();
    if (latest.status !== 'succeeded' || latest.contentHash !== original.contentHash || latest.actionId !== original.actionId
      || latest.stepId !== original.stepId || (await model.tasks.resolveAccess(task.taskId, 'read_step_terminal')).bindingKey !== access.bindingKey) throw denied();
    await assertOriginal();
    const changed = requestFingerprint(saved.data.order) !== requestFingerprint(current.order);
    return Object.freeze({ ...base, status: changed ? 'stale' as const : 'available' as const,
      facts: changed ? null : structuredClone(current), nextAction: changed ? 'reread_current_facts' : 'read_only',
      modelText: 'not_used_as_business_evidence' as const });
  };
  const application = root.createApplication(input.host, prepare);
  const recoveryHost = Object.freeze(structuredClone(input.host));
  const takeoverOriginal = async (value: unknown, signal?: AbortSignal) => {
    const parsed = z.object({ expectedTaskRevision: z.number().int().min(1).max(4294967294),
      expectedRunRevision: z.number().int().min(1).max(4294967294),
      expectedFencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
    const original = await assertOriginal();
    const snapshot = await application.inspect({ taskId: task.taskId, runId: task.runId });
    if (!snapshot.plan || snapshot.task.revision !== parsed.data.expectedTaskRevision
      || snapshot.run.revision !== parsed.data.expectedRunRevision
      || snapshot.run.fencingToken !== parsed.data.expectedFencingToken) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const access = await model.tasks.resolveAccess(task.taskId, 'takeover_run');
    const row = await input.db.aiTask.findFirst({ where: access.where });
    if (!row || row.inputRef !== original.receipt.inputRef) throw denied();
    const key = { scopeId: row.scopeId, taskId: task.taskId, runId: task.runId };
    const storedPlan = await input.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    if (!storedPlan) throw unavailable();
    const plan = aiTaskRunPlanSchema.parse(structuredClone(storedPlan.payload));
    if (storedPlan.scopeId !== key.scopeId || storedPlan.taskId !== key.taskId || storedPlan.runId !== key.runId
      || plan.taskId !== task.taskId || plan.runId !== task.runId
      || requestFingerprint(plan) !== storedPlan.planHash || snapshot.plan.planHash !== storedPlan.planHash
      || requestFingerprint(plan.steps) !== requestFingerprint(expectedSteps)) throw denied();
    const run = await input.db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: task.runId,
      actorKind: access.actorKind, actorId: access.actorId } });
    if (!run?.leaseOwnerId || run.leaseOwnerId === recoveryHost.holderId
      || run.revision !== parsed.data.expectedRunRevision || !run.fencingToken.equals(parsed.data.expectedFencingToken)) {
      throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
    const current = await assertOriginal();
    if (current.receipt.contentHash !== original.receipt.contentHash
      || taskModelIdentity(current.context) !== taskModelIdentity(original.context)
      || (await model.tasks.resolveAccess(task.taskId, 'takeover_run')).bindingKey !== access.bindingKey) throw denied();
    // Previous/new holders are server-derived. The original transactional
    // takeover performs owner/action authorization, task/run CAS and fencing.
    // Recovery only observes original facts; it never publishes or dispatches.
    const outcome = await root.takeoverAndRecover({ ...parsed.data, taskId: task.taskId, runId: task.runId,
      previousHolderId: run.leaseOwnerId, holderId: recoveryHost.holderId, leaseMs: recoveryHost.leaseMs }, signal);
    await assertOriginal();
    return { kind: 'run_outcome' as const, outcome, takeover: 'same_owner_recovery_only' as const,
      automaticRetry: false as const, businessExecution: 'readonly_not_business_commit' as const };
  };
  const recoverOriginal = async (signal?: AbortSignal) => {
    if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
    await assertOriginal();
    const snapshot = await application.inspect({ taskId: task.taskId, runId: task.runId });
    if (!snapshot.plan || !['running', 'waiting_external', 'cancel_requested'].includes(snapshot.task.status)) {
      return { kind: 'not_started' as const, reason: 'task_not_runnable' as const };
    }
    // Recovery receives the repository's current-authority/CAS recovery lease.
    // The runner reloads and validates expectedSteps through planAuthority.
    // It never calls prepare(), publishes inputs or dispatches a model again.
    const lease = await model.tasks.claimRecoveryRun({ taskId: task.taskId, runId: task.runId,
      holderId: recoveryHost.holderId, leaseMs: recoveryHost.leaseMs,
      expectedTaskRevision: snapshot.task.revision, expectedRunRevision: snapshot.run.revision,
      expectedFencingToken: snapshot.run.fencingToken });
    return { kind: 'run_outcome' as const, outcome: await root.runner.recover(lease, signal) };
  };
  return Object.freeze({ ...root, model, readOrderResult, recoverOriginal, takeoverOriginal, application });
}
