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

type Dependencies = Omit<TaskModelHostDependencies, 'auth' | 'credentials' | 'task' | 'scene' | 'planTools' | 'kind'> & {
  db: PrismaClient;
  clientScene: Pick<AiClientTaskDependencies, 'sceneCode' | 'sceneVersion'>;
  loadMaterial: (materialRef: string) => Promise<AiAuthorizedClientMaterial>;
  /** Trusted scene configuration, not a client/model supplied system message. */
  systemPrompt: string;
  limits: TaskModelHostDependencies['task']['limits'];
};
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

/** Original customer material -> the SAME frozen-model source, runner, resource
 * accounting and single-ledger Gateway. No arbitrary messages, task IDs, tools,
 * identities or prices may come from the request. Text explanation only; no
 * order/settings writes, approval bypass, provider SDK or production registration.
 */
export async function composeClientOriginalTaskModelHost(input: Dependencies, value: unknown) {
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
  const context = await authorization.authority.resolve(taskId, 'claim_run');
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
    limits: structuredClone(input.limits)
  } }, model);
  const after = structuredClone(await input.loadMaterial(command.materialRef));
  await authorization.authority.resolve(taskId, 'claim_run');
  if (requestFingerprint(before) !== requestFingerprint(after)) throw denied();
  return Object.freeze({ ...host, originalTask: { taskId, runId: receipt.task.runId },
    /** Start uses the original IDs only. Recovery remains original read/receipt,
     * never a freshly created task or a new provider after unknown. */
    start: (signal?: AbortSignal) => host.application.start({ taskId, runId: receipt.task!.runId }, signal) });
}
