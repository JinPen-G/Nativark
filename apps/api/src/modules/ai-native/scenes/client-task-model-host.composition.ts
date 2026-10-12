import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composeCurrentAuthorizedTaskModelInput } from '../model-input/persisted-task-model-input.composition';
import { composeTaskModelHostWithModel, type TaskModelHostDependencies } from '../runner/model-task-host.composition';
import { clientTaskCommandSchema } from './prisma-client-task-input.repository';
import { composeClientMaterialTasks } from './client-task.composition';
import { composePersistedClientTaskAuthorization } from './client-task-execution.composition';
import type { AiAuthorizedClientMaterial, AiClientTaskDependencies } from './client-task.authority';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';
import { TASK_TEXT_MODEL_TOOL } from '../model-input/task-model-input';
import { isAiTaskInputSubmissionDraft, type AiTaskInputSubmissionDraft } from '@rental-os/shared';
import { PrismaTaskInputRepository } from '../task-input/prisma-task-input.repository';
import { PrismaTaskPlanInputSource } from '../runner/prisma-task-plan-input.source';

type Dependencies = Omit<TaskModelHostDependencies, 'auth' | 'credentials' | 'task' | 'scene' | 'planTools' | 'kind'> & {
  db: PrismaClient;
  clientScene: Pick<AiClientTaskDependencies, 'sceneCode' | 'sceneVersion'>;
  loadMaterial: (materialRef: string) => Promise<AiAuthorizedClientMaterial>;
  /** Trusted scene configuration, not a client/model supplied system message. */
  systemPrompt: string;
  /** Optional narrower server ceiling. The persisted scene policy remains the
   * authority; omitting this never supplies an unlimited/default budget. */
  limits?: TaskModelHostDependencies['task']['limits'];
};
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** Original input reads need neither a provider nor dispatch/financial ports.
 * The question source remains a trusted scene dependency; missing it fails
 * closed. An observed answer receipt never authorizes continuation/retry. */
export async function composeClientOriginalTaskInputReader(input: Pick<Dependencies,
  'db' | 'clientScene' | 'loadMaterial' | 'subscriptions' | 'inputSource' | 'gatewayScene' | 'clock'>, value: unknown) {
  const command = clientTaskCommandSchema.parse(structuredClone(value));
  const scene = structuredClone(input.clientScene), gatewayScene = structuredClone(input.gatewayScene);
  if (scene.sceneCode !== gatewayScene.sceneCode) throw denied();
  const clock = input.clock ?? (() => new Date());
  const dependencies = { db: input.db, subscriptions: input.subscriptions, ...scene };
  const authorization = composePersistedClientTaskAuthorization(dependencies, command, input.loadMaterial, clock);
  const original = await composeClientMaterialTasks(dependencies, input.loadMaterial, clock).readCreation(command);
  if (!original.task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const taskId = original.task.taskId;
  await authorization.authority.resolve(taskId, 'read_metadata');
  const plans = new PrismaTaskPlanInputSource(input.db, authorization.authority, authorization.execution, clock,
    TASK_TEXT_MODEL_TOOL, undefined, { sceneCode: gatewayScene.sceneCode, maxOutputTokens: gatewayScene.maxOutputTokens });
  const inputs = new PrismaTaskInputRepository(input.db, authorization.tasks, plans, input.inputSource, clock);
  return Object.freeze({
    async readPending() {
      const result = await inputs.readPending(taskId);
      await authorization.authority.resolve(taskId, 'read_metadata');
      return result;
    },
    async readSubmission(value: Omit<AiTaskInputSubmissionDraft, 'taskId'>) {
      if (!value || Object.prototype.hasOwnProperty.call(value, 'taskId')) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const result = await inputs.readSubmission({ ...structuredClone(value), taskId });
      await authorization.authority.resolve(taskId, 'read_metadata');
      return result;
    },
    async settleInputCancellation() {
      // This path uses the original stored result/question/recorded charges as
      // a witness. It does not resolve a model or acquire execution permission.
      return authorization.cancellation.settleReleasedInputWait(input.db, plans, input.inputSource);
    },
    async submit(value: Omit<AiTaskInputSubmissionDraft, 'taskId'>) {
      if (!value || Object.prototype.hasOwnProperty.call(value, 'taskId')) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const submission = { ...structuredClone(value), taskId };
      if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      // The original atomic consumer may persist a legal successor run, but
      // this entry never claims a lease or starts that run's model invocation.
      const result = await inputs.submit(submission);
      await authorization.authority.resolve(taskId, 'read_metadata');
      return result;
    }
  });
}

/** Original customer material -> the SAME frozen-model source, runner, resource
 * accounting and single-ledger Gateway. No arbitrary messages, task IDs, tools,
 * identities or prices may come from the request. Text explanation only; no
 * order/settings writes, approval bypass, provider SDK or production registration.
 */
export async function composeClientOriginalTaskModelHost(input: Dependencies, value: unknown,
  purpose: 'start' | 'resume' | 'recover' | 'reconcile' | 'continue' = 'start') {
  if (!['start', 'resume', 'recover', 'reconcile', 'continue'].includes(purpose)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  input = { ...input, clientScene: structuredClone(input.clientScene), gatewayScene: structuredClone(input.gatewayScene),
    limits: structuredClone(input.limits), host: structuredClone(input.host) };
  const command = clientTaskCommandSchema.parse(structuredClone(value));
  const prompt = z.string().min(1).max(8000).parse(input.systemPrompt);
  const clientDependencies = { db: input.db, subscriptions: input.subscriptions, ...structuredClone(input.clientScene) };
  const clock = input.clock ?? (() => new Date());
  const authorization = composePersistedClientTaskAuthorization(clientDependencies, command, input.loadMaterial, clock);
  const receipt = await composeClientMaterialTasks(clientDependencies, input.loadMaterial, clock).readCreation(command);
  if (!receipt.task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const taskId = receipt.task.taskId;
  const action = purpose === 'resume' ? 'resume_input'
    : purpose === 'start' || purpose === 'continue' ? 'claim_run' : 'claim_recovery_run';
  const context = await authorization.authority.resolve(taskId, action);
  const canonical = await authorization.scopes.resolveCurrent();
  const policyKey = { scopeId: canonical.scope.id, sceneCode: clientDependencies.sceneCode,
    sceneVersion: clientDependencies.sceneVersion };
  const readPlan = async () => {
    if (typeof input.db.aiTaskPlanPolicy?.findFirst !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const row = structuredClone(await input.db.aiTaskPlanPolicy.findFirst({ where: policyKey }));
    if (!row || Object.entries(policyKey).some(([key, expected]) => row[key as keyof typeof row] !== expected)
      || !row.enabled || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 4294967294
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt <= clock())
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const limits = aiTaskRunnerLimitsSchema.safeParse(structuredClone(row.limits));
    const tools = aiPersistedPlanToolsSchema.safeParse(structuredClone(row.allowedTools));
    if (!limits.success || limits.data.maxStepMs > limits.data.maxTotalMs || !tools.success
      || !tools.data.some(tool => tool.code === TASK_TEXT_MODEL_TOOL)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return { ...policyKey, revision: row.revision, enabled: row.enabled, limits: limits.data,
      tools: tools.data, expiresAt: row.expiresAt };
  };
  const plan = await readPlan();
  const limits = aiTaskRunnerLimitsSchema.parse(input.limits ?? plan.limits);
  if (Object.entries(limits).some(([key, value]) => value > plan.limits[key as keyof typeof plan.limits]))
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const before = structuredClone(await input.loadMaterial(command.materialRef));
  if (before.row.id !== command.materialRef || context.actor.kind !== 'customer' || context.scope.kind !== 'workspace'
    || before.identity.customerId !== context.actor.customerId || before.identity.tenantId !== context.scope.tenantId
    || before.identity.workspaceId !== context.scope.workspaceId || before.row.tenantId !== context.scope.tenantId
    || before.row.workspaceId !== context.scope.workspaceId) throw denied();
  // Keep precisely the persisted original business facts, references and their
  // coverage. Never replace them with a later quote, order, URL or model output.
  const text = JSON.stringify({ materialRef: before.row.id, materialHash: before.row.materialHash,
    observedAt: before.row.createdAt.toISOString(), material: before.row.material });
  if (Buffer.byteLength(text, 'utf8') > 24000) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const scene = { code: clientDependencies.sceneCode, version: clientDependencies.sceneVersion };
  if (input.gatewayScene.sceneCode !== scene.code) throw denied();
  const model = composeCurrentAuthorizedTaskModelInput({ ...input, scene, kind: undefined }, authorization);
  const host = composeTaskModelHostWithModel({ ...input, scene, kind: undefined, task: {
    taskId, runId: receipt.task.runId, registrationRef: `client-model:${receipt.inputRef}`,
    material: { messages: [{ role: 'system', content: [{ kind: 'text', text: prompt }] },
      { role: 'user', content: [{ kind: 'text', text }] }], maxOutputTokens: input.gatewayScene.maxOutputTokens },
    limits: structuredClone(limits)
  } }, model);
  const after = structuredClone(await input.loadMaterial(command.materialRef));
  await authorization.authority.resolve(taskId, action);
  const latestPlan = await readPlan();
  const current = await authorization.scopes.resolveCurrent();
  if (canonical.scope.id !== current.scope.id || requestFingerprint(plan) !== requestFingerprint(latestPlan)
    || requestFingerprint(before) !== requestFingerprint(after)) throw denied();
  return Object.freeze({ ...host, originalTask: { taskId, runId: receipt.task.runId },
    continueSubmittedInput: (value: Omit<AiTaskInputSubmissionDraft, 'taskId'>, signal?: AbortSignal) => {
      if (purpose !== 'continue') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return host.continueOriginalInput(value, signal);
    },
    /** Start uses the original IDs only. Recovery follows only proved original
     * successor runs, never a new task, input or provider call after unknown. */
    recover: (signal?: AbortSignal) => {
      if (purpose !== 'recover') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return host.recoverOriginal(signal);
    },
    reconcile: (signal?: AbortSignal) => {
      if (purpose !== 'reconcile') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return host.reconcileOriginal(signal);
    },
    start: (signal?: AbortSignal) => {
      if (purpose !== 'start') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return host.application.start({ taskId, runId: receipt.task!.runId }, signal);
    },
    resume: (value: Omit<AiTaskInputSubmissionDraft, 'taskId'>, signal?: AbortSignal) => {
      if (purpose !== 'resume' || !value || Object.prototype.hasOwnProperty.call(value, 'taskId')) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const submission = { ...structuredClone(value), taskId };
      if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      // Original repository validates the question, revision, answers and run,
      // atomically consumes the input, and reuses cumulative resources. No
      // caller-specified task/run or fresh model request is created here.
      return host.application.resume(submission, signal);
    } });
}
