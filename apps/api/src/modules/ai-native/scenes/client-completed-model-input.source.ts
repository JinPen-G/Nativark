/** Closed customer text-summary input policy. A verified original completed
 * result may finish; missing/unknown evidence never becomes an empty success.
 * This does not interpret model questions or grant booking/approval actions. */
import type { PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import type { AiTaskRepository } from '../ai-task.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskInputBinding, AiTaskInputSource } from '../task-input/task-input.ports';
import { AiTaskResultRepository } from '../runner/ai-task-result.repository';
import { aiTaskRunPlanSchema } from '../runner/prisma-task-run-evidence.repository';
import { parseTaskModelInput, taskModelFingerprint, TASK_TEXT_MODEL_TOOL } from '../model-input/task-model-input';
import { isGatewayResult } from '../gateway-contract-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

export function clientCompletedModelInputSource(db: PrismaClient, tasks: Pick<AiTaskRepository, 'resolveAccess'>,
  taskId: string, policy: { sceneCode: string; maxOutputTokens: number }, clock: () => Date): AiTaskInputSource {
  const selected = { sceneCode: policy.sceneCode, maxOutputTokens: policy.maxOutputTokens };
  const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const results = new AiTaskResultRepository(db, tasks, clock);
  return Object.freeze({ async resolve(value: Readonly<AiTaskInputBinding>) {
    const binding = structuredClone(value);
    if (binding.taskId !== taskId || binding.toolCode !== TASK_TEXT_MODEL_TOOL
      || binding.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
    const before = await tasks.resolveAccess(taskId, 'read_step_terminal');
    const task = await db.aiTask.findFirst({ where: before.where });
    if (!task || task.id !== taskId || task.scopeId !== binding.scopeId
      || task.audience !== 'CLIENT' || task.ownerKind !== 'CUSTOMER' || task.ownerId !== before.actorId
      || before.actorKind !== 'CUSTOMER' || task.scopeKind !== 'WORKSPACE' || task.sceneCode !== selected.sceneCode) throw denied();
    const key = { scopeId: task.scopeId, taskId, runId: binding.runId };
    const saved = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    const plan = aiTaskRunPlanSchema.safeParse(structuredClone(saved?.payload));
    if (!saved || saved.scopeId !== key.scopeId || saved.taskId !== taskId || saved.runId !== binding.runId
      || !plan.success || saved.planHash !== binding.planHash || requestFingerprint(plan.data) !== binding.planHash
      || plan.data.taskId !== taskId || plan.data.runId !== binding.runId || plan.data.taskRevision !== binding.planRevision
      || plan.data.steps.length !== 1 || plan.data.steps[0].registrationRef !== binding.registrationRef
      || plan.data.steps[0].toolCode !== binding.toolCode || plan.data.steps[0].toolVersion !== binding.toolVersion
      || plan.data.steps[0].operation !== 'external_unknown') throw denied();
    const frozen = await db.aiTaskActionInput.findFirst({ where: { ...key, id: binding.inputRef,
      registrationRef: binding.registrationRef } });
    const step = await db.aiStep.findFirst({ where: { ...key, id: binding.stepId } });
    if (!frozen || frozen.scopeId !== key.scopeId || frozen.taskId !== taskId || frozen.runId !== binding.runId
      || frozen.id !== binding.inputRef || frozen.registrationRef !== binding.registrationRef
      || frozen.fingerprint !== binding.inputHash || frozen.toolCode !== binding.toolCode || frozen.toolVersion !== binding.toolVersion
      || !step || step.scopeId !== key.scopeId || step.taskId !== taskId || step.runId !== binding.runId
      || step.inputRef !== binding.inputRef || step.requestFingerprint !== binding.inputHash
      || step.resultRef !== binding.basisResultRef || step.toolCode !== binding.toolCode || step.toolVersion !== binding.toolVersion) throw denied();
    const input = parseTaskModelInput(frozen.payload, selected);
    if (taskModelFingerprint(input, selected) !== binding.inputHash) throw denied();
    const result = await results.read({ taskId, resultId: binding.basisResultRef }), payload = result.payload;
    if (result.stepId !== binding.stepId || result.runId !== binding.runId || result.status !== 'succeeded'
      || !result.completeMeasurement || !isGatewayResult(payload) || payload.status !== 'completed'
      || payload.usage.kind !== 'reported' || payload.requestId !== input.intent.requestId || payload.toolRequests.length
      || requestFingerprint(payload.actual) !== requestFingerprint(input.configuration)) throw denied();
    const latest = await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    if (!latest || latest.planHash !== binding.planHash || requestFingerprint(latest.payload) !== binding.planHash
      || (await tasks.resolveAccess(taskId, 'read_step_terminal')).bindingKey !== before.bindingKey) throw denied();
    return { kind: 'not_required' as const };
  }, async validateAnswers() {
    // Explicit quote parameter selection uses the original business preparer.
    // This single-summary plan cannot invent a free-form follow-up contract.
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  } });
}
