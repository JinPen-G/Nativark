import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from '../ai-task.repository';
import { gatewayTextIntentBindingSchema, prepareGatewayIntent, type GatewayTextIntentBinding } from '../gateway-intent';
import { gatewayRoutingBinding, type GatewayRoutingResolution } from '../gateway-routing.service';
import { PublicAiGatewayService, type PublicGatewayRuntime } from '../public-ai-gateway.service';
import type { AiTaskExecutionAuthorization, AiTaskRegisteredExecutor } from '../runner/prisma-task-measured-effects';
import type { AiTaskGatewayInputSource } from '../runner/prisma-task-gateway-invocation.preparation';
import type { AiTaskRunnerLease, AiTaskRunnerStepRef } from '../runner/ai-task-runner.ports';
import type { PrismaTaskPlanInputSource } from '../runner/prisma-task-plan-input.source';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, taskModelConfiguration, taskModelIdentity, taskModelIntent,
  taskModelMaterialSchema, taskImageMaterialSchema, taskAudioMaterialSchema, taskModelMediaSchema, taskModelFingerprint, type TaskModelInput, type TaskModelKind } from './task-model-input';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const leaseSchema = z.object({ taskId: id.max(36), runId: id.max(36), holderId: id, revision,
  fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u), expiresAt: z.string().datetime({ offset: true }) }).strict();
const publishSchema = z.object({ taskId: id.max(36), registrationRef: id, expectedTaskRevision: revision,
  lease: leaseSchema, material: taskModelMaterialSchema }).strict();
type ExecutionInput = Parameters<NonNullable<Awaited<ReturnType<AiTaskRegisteredExecutor['resolve']>>>['execute']>[0];
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

export class TaskModelGatewayInputSource implements AiTaskGatewayInputSource {
  private readonly scene: GatewayTextIntentBinding;
  private readonly runtime: PublicGatewayRuntime;
  private readonly priceVersion: string;
  constructor(private readonly db: Pick<PrismaClient, 'aiTask' | 'aiStep' | 'aiGatewayInvocation'>,
    private readonly inputs: PrismaTaskPlanInputSource, private readonly execution: AiTaskExecutionAuthorization,
    runtime: PublicGatewayRuntime, scene: GatewayTextIntentBinding, priceVersion: string,
  private readonly clock: () => Date = () => new Date(), private readonly kind?: TaskModelKind) {
    this.scene = gatewayTextIntentBindingSchema.parse(structuredClone(scene));
    this.priceVersion = id.max(64).parse(priceVersion);
    if (typeof inputs?.publishModelInput !== 'function' || typeof inputs?.readModelForExecution !== 'function'
      || typeof execution?.authorize !== 'function' || typeof runtime?.ports?.routing?.resolve !== 'function'
      || typeof runtime?.ports?.routing?.assertCurrent !== 'function' || typeof runtime?.verifyEvidence !== 'function'
      || (kind && (scene.routeScene !== 'vision' || typeof runtime.ports.media?.resolve !== 'function'
        || typeof runtime.ports.media?.assertCurrent !== 'function'))) throw unavailable();
    this.runtime = { ...runtime, ports: { ...runtime.ports, routing: {
      resolve: runtime.ports.routing.resolve.bind(runtime.ports.routing),
      assertCurrent: runtime.ports.routing.assertCurrent.bind(runtime.ports.routing)
    } }, verifyEvidence: runtime.verifyEvidence.bind(runtime) };
  }
  private get tool() { return this.kind === 'image' ? TASK_IMAGE_MODEL_TOOL : this.kind === 'audio' ? TASK_AUDIO_MODEL_TOOL : TASK_TEXT_MODEL_TOOL; }
  private get policy() { return { ...this.scene, ...(this.kind ? { kind: this.kind } : {}) }; }
  private async media(context: AiExecutionContext, intent: TaskModelInput['intent'], signal = new AbortController().signal) {
    const prepared = await prepareGatewayIntent(intent, { sceneCode: this.scene.sceneCode, maxOutputTokens: this.scene.maxOutputTokens },
      'invoke', this.narrow(context), this.runtime.ports.media, signal);
    return { hash: prepared.intentHash, references: prepared.request.messages.flatMap(message => typeof message.content === 'string' ? []
      : message.content.filter(part => part.kind !== 'text').map(part => part.kind === 'image'
        ? { kind: 'image' as const, attachmentId: part.attachmentId, attachmentRevision: part.attachmentRevision,
          mediaType: part.mediaType, contentHash: part.contentHash, sizeBytes: Buffer.from(part.data, 'base64').length }
        : { kind: 'audio' as const, attachmentId: part.attachmentId, attachmentRevision: part.attachmentRevision,
          mediaType: part.mediaType, contentHash: part.contentHash, sizeBytes: Buffer.from(part.data, 'base64').length })) };
  }
  private async verifyMedia(context: AiExecutionContext, input: TaskModelInput, signal?: AbortSignal) {
    if (!this.kind) return;
    const current = await this.media(context, input.intent, signal);
    if (current.hash !== taskModelFingerprint(input, this.policy) || requestFingerprint(current.references) !== requestFingerprint(input.media)) throw denied();
  }

  private narrow(context: AiExecutionContext) {
    if (context.scope.kind !== 'workspace'
      || (context.audience === 'client' ? context.actor.kind !== 'customer' : context.actor.kind !== 'user')
      || !['operator', 'staff', 'client'].includes(context.audience)) throw denied();
    const actorId = context.actor.kind === 'customer' ? context.actor.customerId
      : 'userId' in context.actor ? context.actor.userId : undefined;
    if (!actorId) throw denied();
    return { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId, actorId };
  }
  private async route(context: AiExecutionContext) {
    const route = structuredClone(await this.runtime.ports.routing.resolve(this.narrow(context), this.kind ? ['text', this.kind === 'image' ? 'vision' : 'audio'] : ['text']));
    await this.verifyRoute(context, route);
    return route;
  }
  private async verifyRoute(context: AiExecutionContext, route: GatewayRoutingResolution) {
    if (taskModelIdentity(route.context) !== taskModelIdentity(context) || route.scene !== this.scene.routeScene
      || requestFingerprint(route.requiredCapabilities) !== requestFingerprint(this.kind ? ['text', this.kind === 'image' ? 'vision' : 'audio'] : ['text'])
      || await this.runtime.verifyEvidence(structuredClone(route), this.runtime.evidence) !== true) throw denied();
    taskModelConfiguration(route);
  }
  private frozen(context: AiExecutionContext, input: TaskModelInput, route: GatewayRoutingResolution) {
    if (input.identityHash !== taskModelIdentity(context) || input.routingHash !== gatewayRoutingBinding(route)
      || input.priceVersion !== this.priceVersion || requestFingerprint(input.configuration) !== requestFingerprint(taskModelConfiguration(route))) throw denied();
  }

  async publish(value: unknown) {
    const parsed = (this.kind === 'image' ? publishSchema.extend({ material: taskImageMaterialSchema,
      expectedMedia: taskModelMediaSchema.optional() }) : this.kind === 'audio' ? publishSchema.extend({ material: taskAudioMaterialSchema,
      expectedMedia: taskModelMediaSchema.optional() }) : publishSchema).safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data;
    const context = structuredClone(await this.execution.authorize(command.taskId));
    const route = await this.route(context);
    const input: TaskModelInput = { mode: 'invoke',
      intent: taskModelIntent(command.taskId, command.lease.runId, command.registrationRef, this.scene.sceneCode, command.material, this.kind),
      configuration: taskModelConfiguration(route), priceVersion: this.priceVersion,
      routingHash: gatewayRoutingBinding(route), identityHash: taskModelIdentity(context) };
    if (this.kind) input.media = (await this.media(context, input.intent)).references;
    if ('expectedMedia' in command && command.expectedMedia
      && requestFingerprint(command.expectedMedia) !== requestFingerprint(input.media)) throw denied();
    taskModelFingerprint(input, this.policy);
    await this.runtime.ports.routing.assertCurrent(this.narrow(context), route);
    const result = await this.inputs.publishModelInput({ taskId: command.taskId, registrationRef: command.registrationRef,
      expectedTaskRevision: command.expectedTaskRevision, lease: command.lease, input });
    this.frozen(await this.execution.authorize(command.taskId), input, await this.route(context));
    await this.verifyMedia(context, input);
    return result;
  }

  async resolve(presented: AiTaskRunnerStepRef, held: AiTaskRunnerLease) {
    const ref = structuredClone(presented), lease = leaseSchema.parse(structuredClone(held));
    if (ref.plan.toolCode !== this.tool || ref.plan.toolVersion !== AI_TOOL_DRAFT_VERSION
      || ref.plan.operation !== 'external_unknown' || ref.registered.runId !== lease.runId) throw denied();
    const context = await this.execution.authorize(lease.taskId);
    const access = aiTaskAccessFromContext(context, lease.taskId, this.clock());
    const task = await this.db.aiTask.findFirst({ where: access.where });
    if (!task) throw denied();
    const row = await this.db.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: lease.taskId, runId: lease.runId,
      id: ref.registered.stepId, revision: ref.registered.stepRevision, status: 'RUNNING' } });
    if (!row?.inputRef) throw unavailable();
    const stored = await this.inputs.readModelForExecution({ taskId: lease.taskId, runId: lease.runId, stepId: row.id,
      actionId: row.actionId, inputRef: row.inputRef, fingerprint: row.requestFingerprint, lease });
    if (stored.registrationRef !== ref.plan.registrationRef || taskModelIdentity(stored.context) !== taskModelIdentity(context)) throw denied();
    this.frozen(stored.context, stored.input, await this.route(stored.context));
    await this.verifyMedia(stored.context, stored.input);
    return { stepId: row.id, mode: stored.input.mode, lease: { runId: lease.runId, holderId: lease.holderId,
      fencingToken: lease.fencingToken }, intent: stored.input.intent, configuration: stored.input.configuration,
      priceVersion: stored.input.priceVersion, expiresAt: new Date(Math.min(Date.parse(lease.expiresAt), Date.parse(stored.expiresAt))) };
  }

  registeredExecutors(): AiTaskRegisteredExecutor {
    return { resolve: async (code, version) => code === this.tool && version === AI_TOOL_DRAFT_VERSION
      ? { operation: 'external_unknown', execute: this.execute.bind(this) } : null };
  }

  private async execute(binding: ExecutionInput, signal: AbortSignal) {
    binding = structuredClone(binding);
    if (signal.aborted || binding.clarifications?.length) throw unavailable();
    const stored = await this.inputs.readModelForExecution(binding), input = stored.input;
    const context = stored.context, narrow = this.narrow(context);
    const task = await this.db.aiTask.findFirst({ where: aiTaskAccessFromContext(context, binding.taskId, this.clock()).where });
    if (!task) throw denied();
    const invocation = await this.db.aiGatewayInvocation.findUnique({ where: {
      scopeId_callId: { scopeId: task.scopeId, callId: input.intent.requestId }
    } });
    if (!invocation || invocation.taskId !== binding.taskId || invocation.runId !== binding.runId || invocation.stepId !== binding.stepId
      || invocation.actionId !== binding.actionId || invocation.stepFingerprint !== binding.fingerprint
      || invocation.intentHash !== taskModelFingerprint(input, this.policy) || invocation.mode !== input.mode
      || invocation.leaseOwnerId !== binding.lease.holderId || invocation.fencingToken.toFixed(0) !== binding.lease.fencingToken
      || invocation.expiresAt <= this.clock() || invocation.priceVersion !== input.priceVersion
      || invocation.configurationHash !== requestFingerprint(input.configuration)) throw denied();
    const ports = this.runtime.ports;
    await this.verifyMedia(context, input, signal);
    const originalMedia = ports.media;
    const frozenMedia = this.kind && originalMedia ? {
      resolve: async (...args: Parameters<typeof originalMedia.resolve>) => {
        const result = await originalMedia.resolve(...args);
        const expected = input.media?.find(item => item.attachmentId === args[1].attachmentId && item.attachmentRevision === args[1].attachmentRevision);
        if (!result || !expected || result.contentHash !== expected.contentHash || result.mediaType !== expected.mediaType
          || result.bytes.byteLength !== expected.sizeBytes) throw denied();
        return result;
      },
      assertCurrent: async (...args: Parameters<NonNullable<typeof originalMedia.assertCurrent>>) => {
        if (!originalMedia.assertCurrent) throw unavailable();
        await originalMedia.assertCurrent(...args);
      }
    } : originalMedia;
    const assertCurrent = async (route: GatewayRoutingResolution) => {
      await ports.routing.assertCurrent(narrow, route);
      await this.verifyRoute(context, route);
      this.frozen(await this.execution.authorize(binding.taskId), input, route);
    };
    const gateway = new PublicAiGatewayService({ ...this.runtime, ports: { ...ports, media: frozenMedia, routing: {
      resolve: async (caller, required) => {
        const route = structuredClone(await ports.routing.resolve(caller, required));
        await assertCurrent(route);
        return route;
      },
      assertCurrent: async (_caller, route) => assertCurrent(route)
    } } }, [this.scene]);
    const result = await gateway.invoke(context, input.intent, signal);
    if (result.requestId !== input.intent.requestId || requestFingerprint(result.actual) !== requestFingerprint(input.configuration)) throw denied();
    const payload = JSON.parse(JSON.stringify(result));
    if (result.status === 'completed' && result.usage.kind === 'reported') return { kind: 'succeeded' as const, payload };
    if (result.status === 'failed') return { kind: 'failed' as const, payload, errorCode: 'AI_RESOURCE_UNAVAILABLE' };
    return { kind: 'unknown' as const, payload };
  }
}
