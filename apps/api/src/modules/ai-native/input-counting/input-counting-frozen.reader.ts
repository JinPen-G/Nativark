/** Request-level frozen-input reader for input counting. This is the
 * dedicated read path behind the counting request factory: it revalidates the
 * persisted invocation binding and its frozen aiTaskActionInput material
 * against the registered hashes using the SAME parse/fingerprint functions as
 * TaskModelGatewayInputSource, without dragging the whole scene composition
 * (runtime ports, gateway, pricing) — or any input-bound dependency — into
 * the request. It never publishes input, registers a call, holds a lease or
 * trusts caller-supplied bodies, token counts or configuration evidence. */
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { aiTaskAccessFromContext, AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { parseTaskModelInput, taskModelFingerprint, taskModelIdentity, taskModelPolicy,
  TASK_TEXT_MODEL_TOOL, type TaskModelPolicy } from '../model-input/task-model-input';
import type { CountTokensFrozenInvocation } from './input-count-tokens.service';

const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const command = z.object({ callId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  scopeId: id, actorId: z.string().min(1).max(191) }).strict();
export type InputCountingFrozenReaderDb = Pick<PrismaClient, 'aiTask' | 'aiStep' | 'aiGatewayInvocation'
  | 'aiScope'> & Partial<Pick<PrismaClient, 'aiTaskActionInput'>>;
export interface InputCountingFrozenReaderDependencies {
  db: InputCountingFrozenReaderDb;
  /** Per-request task execution authority: authorize(taskId) resolves the
   * current operator/staff context bound to that task, exactly like the
   * runner's execution gate; it is never satisfied by caller claims. */
  execution: { authorize(taskId: string): Promise<AiExecutionContext> };
  /** Server-supplied scene policy used at original publication; it must match
   * the scene the invocation registered under, or the fingerprint check
   * refuses the material. Never inferred from the request. */
  scenePolicy: TaskModelPolicy;
  clock?: () => Date;
}
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

export class InputCountingFrozenInputReader {
  private readonly policy: TaskModelPolicy;
  private readonly clock: () => Date;
  constructor(private readonly dependencies: InputCountingFrozenReaderDependencies) {
    if (!dependencies?.db || typeof dependencies.execution?.authorize !== 'function'
      || typeof dependencies.db.aiTask?.findFirst !== 'function' || typeof dependencies.db.aiStep?.findFirst !== 'function'
      || typeof dependencies.db.aiGatewayInvocation?.findUnique !== 'function'
      || typeof dependencies.db.aiTaskActionInput?.findFirst !== 'function') throw unavailable();
    this.policy = taskModelPolicy(dependencies.scenePolicy);
    if (this.policy.kind) throw unavailable();
    this.clock = dependencies.clock ?? (() => new Date());
  }
  private context(value: AiExecutionContext) {
    if (!value || value.actor?.kind !== 'user' || value.scope?.kind !== 'workspace') throw denied();
    return structuredClone(value);
  }
  async readFrozenCountingInput(value: unknown): Promise<CountTokensFrozenInvocation> {
    const parsed = command.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const invocation = await this.dependencies.db.aiGatewayInvocation.findUnique({ where: {
      scopeId_callId: { scopeId: parsed.data.scopeId, callId: parsed.data.callId } } });
    if (!invocation || invocation.callId !== parsed.data.callId || invocation.scopeId !== parsed.data.scopeId
      || invocation.mode !== 'invoke' || invocation.stepFingerprint !== invocation.intentHash) throw denied();
    const context = this.context(await this.dependencies.execution.authorize(invocation.taskId));
    const actorId = (context as { actor: { userId: string } }).actor.userId;
    if (actorId !== parsed.data.actorId || invocation.actorId !== actorId) throw denied();
    const access = aiTaskAccessFromContext(context as never, invocation.taskId, this.clock());
    const task = await this.dependencies.db.aiTask.findFirst({ where: access.where });
    if (!task || task.scopeId !== invocation.scopeId) throw denied();
    const step = await this.dependencies.db.aiStep.findFirst({ where: { scopeId: task.scopeId,
      taskId: invocation.taskId, runId: invocation.runId, id: invocation.stepId } });
    if (!step || step.toolCode !== TASK_TEXT_MODEL_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || !step.inputRef || step.requestFingerprint !== invocation.stepFingerprint) throw denied();
    const saved = await this.dependencies.db.aiTaskActionInput!.findFirst({ where: { id: step.inputRef,
      scopeId: task.scopeId, taskId: invocation.taskId, runId: invocation.runId, toolCode: TASK_TEXT_MODEL_TOOL,
      toolVersion: AI_TOOL_DRAFT_VERSION, fingerprint: step.requestFingerprint } });
    if (!saved || saved.id !== step.inputRef || saved.fingerprint !== step.requestFingerprint
      || !(saved.expiresAt instanceof Date) || saved.expiresAt <= this.clock()) throw unavailable();
    const frozen = parseTaskModelInput(saved.payload, this.policy);
    if (taskModelFingerprint(frozen, this.policy) !== invocation.intentHash
      || frozen.identityHash !== taskModelIdentity(context)
      || frozen.priceVersion !== invocation.priceVersion
      || requestFingerprint(frozen.configuration) !== invocation.configurationHash
      || frozen.intent.requestId !== invocation.callId
      || frozen.intent.maxOutputTokens !== invocation.maxOutputTokens
      || frozen.intent.sceneCode !== invocation.sceneCode) throw denied();
    // Cross-await revalidation: identity, invocation binding and stored
    // material must be unchanged after every authorization-visible await.
    const latest = await this.dependencies.db.aiGatewayInvocation.findUnique({ where: {
      scopeId_callId: { scopeId: task.scopeId, callId: parsed.data.callId } } });
    const reauthorized = this.context(await this.dependencies.execution.authorize(invocation.taskId));
    if (!latest || latest.registrationHash !== invocation.registrationHash || latest.intentHash !== invocation.intentHash
      || taskModelIdentity(reauthorized) !== taskModelIdentity(context)
      || (reauthorized as { actor: { userId: string } }).actor.userId !== actorId) throw denied();
    return { scopeId: task.scopeId, actorId, context,
      invocation: { id: invocation.id, taskId: invocation.taskId, runId: invocation.runId, stepId: invocation.stepId,
        actionId: invocation.actionId, callId: invocation.callId, registrationHash: invocation.registrationHash,
        intentHash: invocation.intentHash, configurationHash: invocation.configurationHash,
        priceVersion: invocation.priceVersion, maxOutputTokens: invocation.maxOutputTokens,
        sceneCode: invocation.sceneCode, expiresAt: new Date(invocation.expiresAt) },
      intent: structuredClone(frozen.intent), configuration: structuredClone(frozen.configuration) };
  }
}
