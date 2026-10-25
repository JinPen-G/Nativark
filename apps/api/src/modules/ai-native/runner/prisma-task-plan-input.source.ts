import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, type AiExecutionContext, type CreateRentalOrderRequest, type AiOrderExplainRequestDraft } from '@rental-os/shared';
import { HttpException, ValidationPipe } from '@nestjs/common';
import { CreateRentalOrderDto } from '../../rental-core/rental-order-request.dto';
import type { RentalOrderConfirmationService } from '../../rental-core/rental-order-confirmation.service';
import type { AiApprovedOrderRouteAuthority } from '../approval-execution/approved-order-route.authority';
import type { ApprovedOrderInputAuthority, ApprovedOrderInputReference } from '../order-task-input.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { gatewayTextIntentPolicySchema } from '../gateway-intent';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, isTaskModelTool, parseTaskModelInput, taskModelFingerprint, taskModelPolicy, type TaskModelPolicy } from '../model-input/task-model-input';
import { aiCatalogReadInputSchema } from '../catalog-read-facts.service';
import { aiAvailabilityReadInputSchema } from '../availability-read-facts.service';
import { aiMembershipCandidateReadInputSchema } from '../membership-candidate-read-facts.service';
import { aiOpeningReadInputSchema, aiRiskReadInputSchema } from '../tools/diagnostic-read-facts.service';
import { isGatewayOrderExplainRequest } from '../gateway-contract-validation';
import { aiTaskAccessFromContext, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import { aiStepActionId, type AiStepRegistrationAuthority, type AiStepRegistrationCommand,
  type AiStepOriginalRegistrationGrant } from '../ai-step-registration.repository';
import type { AiTaskExecutionAuthorization } from './prisma-task-measured-effects';
import { aiTaskRunPlanSchema, aiTaskRunnerLimitsSchema, type AiTaskPlanEvidenceAuthority } from './prisma-task-run-evidence.repository';
import type { AiTaskRunnerLease, AiTaskRunnerPlan } from './ai-task-runner.ports';
import { settingsChangeReferenceSchema } from '../../rental-core/approved-settings-change.validation';
import { textProbeCommandSchema, TEXT_CAPABILITY_PROBE_TOOL } from '../text-capability-probe';

type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'aiTaskPlanPolicy' | 'aiTaskActionInput' | 'aiTaskRunPlan' | 'aiStep'>;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const rev = z.number().int().min(1).max(4294967294);
const leaseSchema = z.object({ taskId: id.max(36), runId: id.max(36), holderId: id, revision: rev,
  // The existing resource-policy port intentionally presents an empty expiry.
  // It is never authorization; held() reads and checks the actual run expiry.
  fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u), expiresAt: z.string().max(40),
  purpose: z.literal('recovery_only').optional() }).strict();
const publishSchema = z.object({ taskId: id.max(36), registrationRef: id, expectedTaskRevision: rev,
  lease: leaseSchema, input: aiCatalogReadInputSchema }).strict();
const availabilityPublishSchema = publishSchema.extend({ input: aiAvailabilityReadInputSchema });
const orderPublishSchema = publishSchema.extend({ input: z.unknown() });
// Original C02 tool schema, not a permissive order ID-only replacement.
export const aiPersistedOrderExplainInputSchema = z.custom<AiOrderExplainRequestDraft>(isGatewayOrderExplainRequest)
  .transform(value => structuredClone(value));
const orderExplainPublishSchema = publishSchema.extend({ input: aiPersistedOrderExplainInputSchema });
export const PERSISTED_READONLY_TOOLS = ['rental.catalog.search', 'rental.availability.check', 'rental.order.explain', 'membership.customer.resolve', 'tenant.opening.diagnose', 'operations.risks.list'] as const;
export type PersistedReadonlyTool = typeof PERSISTED_READONLY_TOOLS[number];
export type PersistedTaskInputTool = PersistedReadonlyTool | 'rental.order.commit' | 'tenant.notifications.commit' | typeof TASK_TEXT_MODEL_TOOL | typeof TASK_IMAGE_MODEL_TOOL | typeof TASK_AUDIO_MODEL_TOOL | typeof TEXT_CAPABILITY_PROBE_TOOL;
export interface SettingsInputDependencies {
  /** Current original Guard and immutable domain evidence, without acquiring
   * category locks after the plan/registration repositories hold task locks. */
  verify(context: AiExecutionContext, reference: { changeId: string; changeHash: string },
    taskId: string, tx?: Prisma.TransactionClient, purpose?: 'input' | 'plan'): Promise<{ expiresAt: string }>;
}
type OrderInputDependencies = {
  route: Pick<AiApprovedOrderRouteAuthority, 'withOrderPreparation'>;
  confirmation: Pick<RentalOrderConfirmationService, 'normalizeOrderInput'>;
};
export const aiPersistedPlanToolsSchema = z.array(z.object({ code: z.enum([...PERSISTED_READONLY_TOOLS, 'rental.order.commit', 'tenant.notifications.commit', TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, TEXT_CAPABILITY_PROBE_TOOL]), version: z.literal(AI_TOOL_DRAFT_VERSION) }).strict()).min(1).max(8)
  .refine(tools => new Set(tools.map(tool => tool.code)).size === tools.length);
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
const identity = ({ requestId: _id, authorizedAt: _at, ...context }: AiExecutionContext) => requestFingerprint(context);
export class AiTaskPlanInputResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN' as const;
  readonly retryable = false;
  constructor(readonly nextAction: 'reconcile' | 'read_task_input' = 'reconcile') { super('AI_RESULT_UNKNOWN'); }
}

export class PrismaTaskPlanInputSource implements AiTaskPlanEvidenceAuthority, AiStepRegistrationAuthority, ApprovedOrderInputAuthority {
  private readonly validation = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  private planSources?: ReadonlyMap<PersistedTaskInputTool, PrismaTaskPlanInputSource>;
  /** Server composition only. Freeze a closed group of the existing readers;
   * no caller registry, policy seed or executable write is introduced. */
  static bindReadonlyPlanSources(sources: readonly PrismaTaskPlanInputSource[]) {
    this.bindClosedPlanSources(sources, PERSISTED_READONLY_TOOLS, PERSISTED_READONLY_TOOLS.length);
  }
  /** The first supported model/tool handoff is a fixed text-model and original
   * order-read pair. This does not enable arbitrary model-selected operations. */
  static bindModelOrderPlanSources(model: PrismaTaskPlanInputSource, order: PrismaTaskPlanInputSource) {
    if (model.toolCode !== TASK_TEXT_MODEL_TOOL || model.modelPolicy?.orderExplainTool !== true
      || order.toolCode !== 'rental.order.explain') throw unavailable();
    this.bindClosedPlanSources([model, order], [TASK_TEXT_MODEL_TOOL, 'rental.order.explain'], 2);
  }
  private static bindClosedPlanSources(sources: readonly PrismaTaskPlanInputSource[], allowed: readonly string[], max: number) {
    if (!Array.isArray(sources) || sources.length < 2 || sources.length > max
      || sources.some(source => !(source instanceof PrismaTaskPlanInputSource) || source.planSources
        || source.db !== sources[0].db || !allowed.includes(source.toolCode))
      || new Set(sources.map(source => source.toolCode)).size !== sources.length) throw unavailable();
    const registry = new Map(sources.map(source => [source.toolCode, source]));
    for (const source of sources) source.planSources = registry;
  }
  constructor(private readonly db: Db, private readonly authorization: AiTaskRepositoryAuthority,
    private readonly execution: AiTaskExecutionAuthorization, private readonly wall: () => Date = () => new Date(),
    private readonly toolCode: PersistedTaskInputTool = 'rental.catalog.search', private readonly order?: OrderInputDependencies,
    private readonly modelPolicy?: TaskModelPolicy, private readonly settings?: SettingsInputDependencies) {
    if (typeof db?.$transaction !== 'function' || typeof db.aiTaskPlanPolicy?.findFirst !== 'function'
      || typeof db.aiTaskActionInput?.create !== 'function' || typeof authorization?.resolve !== 'function'
      || typeof execution?.authorize !== 'function' || ![...PERSISTED_READONLY_TOOLS, 'rental.order.commit', 'tenant.notifications.commit', TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, TEXT_CAPABILITY_PROBE_TOOL].includes(toolCode)
      || (toolCode === 'rental.order.commit' && (typeof order?.route?.withOrderPreparation !== 'function'
        || typeof order?.confirmation?.normalizeOrderInput !== 'function'))
      || (isTaskModelTool(toolCode) && !gatewayTextIntentPolicySchema.safeParse(modelPolicy && { sceneCode: modelPolicy.sceneCode, maxOutputTokens: modelPolicy.maxOutputTokens }).success)
      || (isTaskModelTool(toolCode) && ((toolCode === TASK_IMAGE_MODEL_TOOL ? 'image' : toolCode === TASK_AUDIO_MODEL_TOOL ? 'audio' : undefined) !== modelPolicy?.kind))
      || (toolCode === 'tenant.notifications.commit' && typeof settings?.verify !== 'function')) throw unavailable();
    if (modelPolicy) this.modelPolicy = taskModelPolicy(modelPolicy);
  }

  private fingerprint(payload: unknown) {
    return isTaskModelTool(this.toolCode)
      ? taskModelFingerprint(parseTaskModelInput(payload, this.modelPolicy!), this.modelPolicy!) : requestFingerprint(payload);
  }

  private async parseInput(value: unknown) {
    if (this.toolCode === 'rental.catalog.search') return aiCatalogReadInputSchema.parse(structuredClone(value));
    if (this.toolCode === 'rental.availability.check') return aiAvailabilityReadInputSchema.parse(structuredClone(value));
    if (this.toolCode === 'membership.customer.resolve') return aiMembershipCandidateReadInputSchema.parse(structuredClone(value));
    if (this.toolCode === 'tenant.opening.diagnose') return aiOpeningReadInputSchema.parse(structuredClone(value));
    if (this.toolCode === 'operations.risks.list') return aiRiskReadInputSchema.parse(structuredClone(value));
    if (this.toolCode === 'rental.order.explain') return aiPersistedOrderExplainInputSchema.parse(structuredClone(value));
    if (isTaskModelTool(this.toolCode)) return parseTaskModelInput(value, this.modelPolicy!);
    if (this.toolCode === 'tenant.notifications.commit') return settingsChangeReferenceSchema.parse(structuredClone(value));
    if (this.toolCode === TEXT_CAPABILITY_PROBE_TOOL) return textProbeCommandSchema.parse(structuredClone(value));
    try {
      const body: CreateRentalOrderDto = await this.validation.transform(structuredClone(value), { type: 'body', metatype: CreateRentalOrderDto });
      if (!body || body.capabilityExceptions !== undefined || requestFingerprint(body) !== requestFingerprint(value)) throw denied();
      return JSON.parse(JSON.stringify(body)) as CreateRentalOrderRequest;
    } catch { throw new AiTaskRepositoryError('AI_INVALID_INPUT'); }
  }

  private async access(taskId: string, operation: 'read_metadata' | 'transition_task', db: Pick<Db, 'aiTask' | 'aiTaskPlanPolicy'> = this.db) {
    const context = structuredClone(await this.authorization.resolve(taskId, operation));
    const access = aiTaskAccessFromContext(context, taskId, this.wall());
    const task = await db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
      || task.audience !== access.audience || task.archivedAt !== null) throw denied();
    const key = { scopeId: task.scopeId, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion };
    const row = await db.aiTaskPlanPolicy.findFirst({ where: key });
    if (!row || Object.entries(key).some(([k, v]) => row[k as keyof typeof row] !== v) || !rev.safeParse(row.revision).success
      || row.enabled !== true || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt <= this.wall()) throw unavailable();
    const parsedTools = aiPersistedPlanToolsSchema.safeParse(structuredClone(row.allowedTools));
    if (!parsedTools.success) throw unavailable();
    const tools = parsedTools.data;
    if (!tools.some(tool => tool.code === this.toolCode)) throw unavailable();
    const limits = aiTaskRunnerLimitsSchema.parse(structuredClone(row.limits));
    if (limits.maxStepMs > limits.maxTotalMs) throw unavailable();
    const policy = { ...key, revision: row.revision, enabled: row.enabled, tools, limits, expiresAt: row.expiresAt.toISOString() };
    return { context, access, task, policy, policyHash: requestFingerprint(policy) };
  }

  private async held(lease: AiTaskRunnerLease, current: Awaited<ReturnType<PrismaTaskPlanInputSource['access']>>, db: Pick<Db, 'aiRun'> = this.db) {
    if (lease.taskId !== current.task.id) throw denied();
    const run = await db.aiRun.findFirst({ where: { scopeId: current.task.scopeId, taskId: current.task.id, id: lease.runId } });
    if (!run || run.id !== lease.runId || run.scopeId !== current.task.scopeId || run.taskId !== current.task.id
      || run.actorKind !== current.access.actorKind || run.actorId !== current.access.actorId || run.leaseOwnerId !== lease.holderId
      || run.fencingToken.toFixed(0) !== lease.fencingToken || run.revision !== lease.revision
      || !run.leaseExpiresAt || run.leaseExpiresAt <= this.wall() || !['QUEUED', 'RUNNING'].includes(run.status)) throw denied();
  }

  private async input(row: Prisma.AiTaskActionInputGetPayload<{}> | null, key: { scopeId: string; taskId: string; runId: string; registrationRef?: string }, originalOnly = false) {
    if (!row || Object.entries(key).some(([k, v]) => row[k as keyof typeof row] !== v)
      || !id.max(36).safeParse(row.id).success || row.toolCode !== this.toolCode || row.toolVersion !== AI_TOOL_DRAFT_VERSION
      || !rev.safeParse(row.policyRevision).success || !id.safeParse(row.registrationRef).success
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || !originalOnly && row.expiresAt <= this.wall()) throw unavailable();
    const payload = await this.parseInput(row.payload);
    if (this.fingerprint(payload) !== row.fingerprint) throw denied();
    return { id: row.id, registrationRef: row.registrationRef, toolCode: row.toolCode, toolVersion: row.toolVersion,
      payload, fingerprint: row.fingerprint, policyRevision: row.policyRevision, expiresAt: row.expiresAt.toISOString() };
  }

  async publishCatalogInput(value: unknown) {
    if (this.toolCode !== 'rental.catalog.search') throw unavailable();
    return this.publish(value);
  }

  async publishAvailabilityInput(value: unknown) {
    if (this.toolCode !== 'rental.availability.check') throw unavailable();
    return this.publish(value);
  }

  async publishOrderExplainInput(value: unknown) {
    if (this.toolCode !== 'rental.order.explain') throw unavailable();
    return this.publish(value);
  }

  async publishMembershipCandidateInput(value: unknown) {
    if (this.toolCode !== 'membership.customer.resolve') throw unavailable();
    return this.publish(value);
  }

  async publishOpeningInput(value: unknown) {
    if (this.toolCode !== 'tenant.opening.diagnose') throw unavailable();
    return this.publish(value);
  }

  async publishRiskInput(value: unknown) {
    if (this.toolCode !== 'operations.risks.list') throw unavailable();
    return this.publish(value);
  }

  async publishProbeInput(value: unknown) {
    if (this.toolCode !== TEXT_CAPABILITY_PROBE_TOOL) throw unavailable();
    return this.publish(value);
  }

  async publishModelInput(value: unknown) {
    if (!isTaskModelTool(this.toolCode)) throw unavailable();
    return this.publish(value);
  }
  /** Internal original publication observation, not an execution attestation. */
  async readModelInputReceipt(value: unknown) {
    if (!isTaskModelTool(this.toolCode)) throw unavailable();
    return this.readPreparedInput(value);
  }
  async readReadonlyInputReceipt(value: unknown) {
    if (!(PERSISTED_READONLY_TOOLS as readonly string[]).includes(this.toolCode)) throw unavailable();
    return this.readPreparedInput(value);
  }
  private async readPreparedInput(value: unknown) {
    const parsed = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data, before = await this.access(command.taskId, 'read_metadata');
    const key = { scopeId: before.task.scopeId, ...command };
    const raw = await this.db.aiTaskActionInput.findFirst({ where: key });
    const stored = raw ? await this.input(raw, key) : null;
    if (stored && stored.policyRevision !== before.policy.revision) throw conflict();
    const after = await this.access(command.taskId, 'read_metadata');
    if (after.access.bindingKey !== before.access.bindingKey || after.policyHash !== before.policyHash) throw denied();
    const latest = await this.db.aiTaskActionInput.findFirst({ where: key });
    if (Boolean(latest) !== Boolean(stored)) throw conflict();
    if (stored && requestFingerprint(await this.input(latest, key)) !== requestFingerprint(stored)) throw denied();
    return stored ? { state: 'published' as const, execution: 'not_attested' as const,
      context: after.context, ...stored } : { state: 'not_observed' as const, execution: 'not_attested' as const };
  }

  async publishSettingsInput(value: unknown) {
    if (this.toolCode !== 'tenant.notifications.commit') throw unavailable();
    return this.publish(structuredClone(value));
  }

  async readSettingsInputReceipt(value: unknown) {
    if (this.toolCode !== 'tenant.notifications.commit') throw unavailable();
    const parsed = z.object({ taskId: id.max(36), runId: id.max(36), registrationRef: id }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data, before = await this.access(command.taskId, 'read_metadata');
    const key = { scopeId: before.task.scopeId, ...command };
    const read = () => this.db.aiTaskActionInput.findFirst({ where: key });
    const row = await read();
    let receipt: { state: 'not_observed'; nextAction: 'read_task_input' }
      | { state: 'published'; execution: 'not_attested'; id: string; input: { changeId: string; changeHash: string } };
    if (!row) receipt = { state: 'not_observed', nextAction: 'read_task_input' };
    else {
      const stored = await this.input(row, key);
      if (stored.policyRevision !== before.policy.revision) throw conflict();
      await this.verifySettings(before.context, command.taskId, stored.payload);
      const latest = await this.input(await read(), key);
      if (requestFingerprint(latest) !== requestFingerprint(stored)) throw denied();
      // Publication proves only the input row. It must not attest that a
      // concurrently running step has or has not performed its business action.
      receipt = { state: 'published', execution: 'not_attested', id: stored.id, input: settingsChangeReferenceSchema.parse(stored.payload) };
    }
    const after = await this.access(command.taskId, 'read_metadata');
    if (after.access.bindingKey !== before.access.bindingKey || after.policyHash !== before.policyHash) throw denied();
    if (receipt.state === 'published') await this.verifySettings(after.context, command.taskId, receipt.input);
    return receipt;
  }

  private async verifySettings(context: AiExecutionContext, taskId: string, payload: unknown, tx?: Prisma.TransactionClient, purpose: 'input' | 'plan' = 'input') {
    if (this.toolCode !== 'tenant.notifications.commit') return undefined;
    try {
      const proof = await this.settings!.verify(structuredClone(context), settingsChangeReferenceSchema.parse(structuredClone(payload)), taskId, tx, purpose);
      if (!z.string().datetime({ offset: true }).safeParse(proof?.expiresAt).success || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
      return proof.expiresAt;
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof HttpException && [401, 403].includes(error.getStatus())) throw denied();
      if (error instanceof HttpException && error.getStatus() === 409) throw conflict();
      throw unavailable();
    }
  }

  async publishOrderInput(value: unknown) {
    if (this.toolCode !== 'rental.order.commit' || !this.order) throw unavailable();
    const parsed = orderPublishSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const original = await this.parseInput(parsed.data.input) as CreateRentalOrderRequest;
    const normalized = this.order.confirmation.normalizeOrderInput(structuredClone(original));
    const context = await this.execution.authorize(parsed.data.taskId);
    const authorized = await this.order.route.withOrderPreparation(context, normalized, async (current, body) => ({ current, body }));
    return this.publish({ ...parsed.data, input: authorized.body }, authorized.current);
  }

  private async publish(value: unknown, orderContext?: AiExecutionContext) {
    const schema = this.toolCode === 'rental.catalog.search' ? publishSchema
      : this.toolCode === 'rental.availability.check' ? availabilityPublishSchema
        : this.toolCode === 'rental.order.explain' ? orderExplainPublishSchema
          : this.toolCode === 'membership.customer.resolve' ? publishSchema.extend({ input: aiMembershipCandidateReadInputSchema })
            : this.toolCode === 'tenant.opening.diagnose' ? publishSchema.extend({ input: aiOpeningReadInputSchema })
              : this.toolCode === 'operations.risks.list' ? publishSchema.extend({ input: aiRiskReadInputSchema }) : orderPublishSchema;
    const parsed = schema.safeParse(value);
    if (!parsed.success || parsed.data.lease.purpose === 'recovery_only') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data, payload = await this.parseInput(command.input);
    const executeContext = structuredClone(await this.execution.authorize(command.taskId));
    if (this.toolCode === 'rental.order.commit' && (!orderContext || identity(orderContext) !== identity(executeContext))) throw denied();
    const before = await this.access(command.taskId, 'transition_task');
    if (identity(before.context) !== identity(executeContext) || before.task.status !== 'RUNNING'
      || before.task.cancelRequestedAt !== null || before.task.revision !== command.expectedTaskRevision) throw denied();
    if (isTaskModelTool(this.toolCode)) {
      const model = parseTaskModelInput(payload, this.modelPolicy!);
      if (model.identityHash !== identity(executeContext) || model.intent.sceneCode !== before.task.sceneCode) throw denied();
    }
    await this.held(command.lease, before);
    await this.verifySettings(before.context, command.taskId, payload);
    const fingerprint = this.fingerprint(payload);
    const key = { scopeId: before.task.scopeId, taskId: before.task.id, runId: command.lease.runId, registrationRef: command.registrationRef };
    let callbackCompleted = false;
    try {
      const result = await this.db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_tasks WHERE scopeId = ${key.scopeId} AND id = ${key.taskId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_runs WHERE scopeId = ${key.scopeId} AND taskId = ${key.taskId} AND id = ${key.runId} FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT revision FROM ai_task_plan_policies WHERE scopeId = ${key.scopeId} AND sceneCode = ${before.task.sceneCode} AND sceneVersion = ${before.task.sceneVersion} FOR UPDATE`);
        const current = await this.access(command.taskId, 'transition_task', tx);
        if (current.access.bindingKey !== before.access.bindingKey || current.policyHash !== before.policyHash
          || current.task.status !== 'RUNNING' || current.task.cancelRequestedAt !== null
          || current.task.revision !== command.expectedTaskRevision) throw conflict();
        await this.held(command.lease, current, tx);
        if (isTaskModelTool(this.toolCode) && await tx.aiTaskQuoteSelection.findFirst({ where: {
          scopeId: key.scopeId, taskId: key.taskId, runId: key.runId, supersededAt: null } })) throw conflict();
        const settingsExpiry = await this.verifySettings(current.context, command.taskId, payload, tx);
        const existing = await tx.aiTaskActionInput.findFirst({ where: key });
        if (existing) {
          const stored = await this.input(existing, key);
          if (stored.fingerprint !== fingerprint || stored.policyRevision !== current.policy.revision
            || requestFingerprint(stored.payload) !== requestFingerprint(payload)) throw conflict();
          callbackCompleted = true;
          return { id: stored.id, replayed: true };
        }
        // Once a plan exists its input set is closed. No late action injection.
        if (await tx.aiTaskRunPlan.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId } })) throw conflict();
        // Inputs bind business steps as well as model steps. Model calls are
        // reserved by the durable resource gate, not by counting input rows.
        const published = await tx.aiTaskActionInput.findMany({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId },
          take: current.policy.limits.maxSteps + 1 });
        if (published.length >= current.policy.limits.maxSteps) throw unavailable();
        const changed = await tx.aiTask.updateMany({ where: { ...current.access.where, revision: command.expectedTaskRevision,
          status: 'RUNNING', cancelRequestedAt: null }, data: { revision: command.expectedTaskRevision } });
        if (changed.count !== 1) throw conflict();
        const row = await tx.aiTaskActionInput.create({ data: { ...key, id: randomUUID(), toolCode: this.toolCode,
          toolVersion: AI_TOOL_DRAFT_VERSION, payload: JSON.parse(JSON.stringify(payload)), fingerprint, policyRevision: current.policy.revision,
          expiresAt: new Date(Math.min(Date.parse(current.policy.expiresAt), settingsExpiry ? Date.parse(settingsExpiry) : Infinity)) } });
        const final = await this.access(command.taskId, 'transition_task', tx);
        if (final.access.bindingKey !== before.access.bindingKey || final.policyHash !== before.policyHash) throw denied();
        await this.held(command.lease, final, tx);
        await this.verifySettings(final.context, command.taskId, payload, tx);
        callbackCompleted = true;
        return { id: (await this.input(row, key)).id, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      // Execution authorization includes its own entitlement/gate transaction.
      // Do not nest it under task/run locks. Publication is metadata only;
      // failing the fresh post-commit gate suppresses the result, not the row.
      const reauthorized = structuredClone(await this.execution.authorize(command.taskId));
      if (identity(reauthorized) !== identity(executeContext)) throw denied();
      const after = await this.access(command.taskId, 'transition_task');
      if (identity(after.context) !== identity(before.context) || after.policyHash !== before.policyHash) throw denied();
      await this.verifySettings(after.context, command.taskId, payload);
      return result;
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (callbackCompleted) throw new AiTaskPlanInputResultUnknownError(this.toolCode === 'tenant.notifications.commit' ? 'read_task_input' : 'reconcile');
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  }

  async authorize(raw: Readonly<AiTaskRunnerPlan>, presented: Readonly<AiTaskRunnerLease>, db: Omit<Db, '$transaction'> = this.db) {
    const plan = aiTaskRunPlanSchema.parse(structuredClone(raw)), lease = leaseSchema.parse(structuredClone(presented));
    if (plan.taskId !== lease.taskId || plan.runId !== lease.runId || plan.steps.length === 0) throw denied();
    const before = await this.access(plan.taskId, 'read_metadata', db);
    await this.held(lease, before, db);
    for (const [name, ceiling] of Object.entries(before.policy.limits)) {
      if (plan.limits[name as keyof typeof plan.limits] > ceiling) throw unavailable();
    }
    const inputs = [];
    const selectedSources = new Map<string, PrismaTaskPlanInputSource>();
    for (const step of plan.steps) {
      const source = step.toolCode === this.toolCode ? this : this.planSources?.get(step.toolCode as PersistedTaskInputTool);
      if (!source) throw unavailable();
      const selected = source === this ? before : await source.access(plan.taskId, 'read_metadata', db);
      if (selected.access.bindingKey !== before.access.bindingKey || selected.policyHash !== before.policyHash) throw denied();
      await source.held(lease, selected, db);
      if (step.operation !== (source.toolCode === 'rental.order.commit' || source.toolCode === 'tenant.notifications.commit' ? 'idempotent'
        : isTaskModelTool(source.toolCode) || source.toolCode === TEXT_CAPABILITY_PROBE_TOOL ? 'external_unknown' : 'readonly')
        || !before.policy.tools.some(t => t.code === step.toolCode && t.version === step.toolVersion)) throw unavailable();
      const key = { scopeId: before.task.scopeId, taskId: plan.taskId, runId: plan.runId, registrationRef: step.registrationRef };
      const input = await source.input(await db.aiTaskActionInput.findFirst({ where: key }), key);
      if (input.toolCode !== step.toolCode || input.toolVersion !== step.toolVersion || input.policyRevision !== before.policy.revision) throw denied();
      if (source.toolCode === 'rental.order.commit') {
        await source.order!.route.withOrderPreparation(before.context, input.payload as CreateRentalOrderRequest, async () => undefined);
      }
      await source.verifySettings(before.context, plan.taskId, input.payload, undefined, 'plan');
      selectedSources.set(input.registrationRef, source);
      inputs.push(input);
    }
    const current = await this.access(plan.taskId, 'read_metadata', db);
    if (current.access.bindingKey !== before.access.bindingKey || current.policyHash !== before.policyHash) throw denied();
    await this.held(lease, current, db);
    for (const input of inputs) {
      const key = { scopeId: before.task.scopeId, taskId: plan.taskId, runId: plan.runId, registrationRef: input.registrationRef };
      const source = selectedSources.get(input.registrationRef)!;
      const selected = source === this ? current : await source.access(plan.taskId, 'read_metadata', db);
      if (selected.access.bindingKey !== current.access.bindingKey || selected.policyHash !== current.policyHash) throw denied();
      await source.held(lease, selected, db);
      const again = await source.input(await db.aiTaskActionInput.findFirst({ where: key }), key);
      if (requestFingerprint(again) !== requestFingerprint(input)) throw denied();
      await source.verifySettings(current.context, plan.taskId, again.payload, undefined, 'plan');
    }
    return { authorityHash: requestFingerprint({ version: 'persisted-plan-input-1', scopeId: before.task.scopeId,
      taskId: plan.taskId, runId: plan.runId, scene: before.task.sceneCode, policy: before.policyHash,
      identity: identity(current.context), steps: plan.steps, limits: plan.limits, inputs }),
      policyVersion: `scene-policy-${before.policy.revision}`,
      expiresAt: new Date(Math.min(Date.parse(before.policy.expiresAt), ...inputs.map(i => Date.parse(i.expiresAt)))).toISOString() };
  }

  /** Observe an already registered action under today's independent read
   * permission. Original plan/input hashes, task owner and held generation
   * remain mandatory; this proof cannot register or execute anything new. */
  async resolveOriginal(raw: Readonly<AiStepRegistrationCommand>, tx?: Prisma.TransactionClient): Promise<AiStepOriginalRegistrationGrant> {
    const command = structuredClone(raw);
    const context = structuredClone(await this.authorization.resolve(command.taskId, 'read_step_terminal'));
    const access = aiTaskAccessFromContext(context, command.taskId, this.wall());
    // Inside the transition transaction the caller's tx is consumed directly:
    // the transition has already CAS-incremented the run revision, and a
    // separate snapshot would see the pre-transition lease and falsely deny
    // the very generation whose result is being committed. Standalone
    // callers (registration-time revalidation) keep their own
    // RepeatableRead snapshot.
    const readView = async (db: Prisma.TransactionClient) => {
      const task = await db.aiTask.findFirst({ where: access.where });
      if (!task || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId || task.audience !== access.audience
        || task.archivedAt !== null) throw denied();
      // The transition caller consumes its own transaction (whose run CAS has
      // produced the exact post-CAS revision carried in command.lease) and
      // this read shares that view. Standalone callers open their own
      // RepeatableRead snapshot over the committed lease. Either way this
      // exact revision is the only acceptable one.
      const run = await db.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: command.lease.runId } });
      if (!run || run.actorKind !== access.actorKind || run.actorId !== access.actorId || run.leaseOwnerId !== command.lease.holderId
        || run.revision !== command.lease.revision || run.fencingToken.toFixed(0) !== command.lease.fencingToken
        || run.status !== 'RUNNING' || !run.leaseExpiresAt || run.leaseExpiresAt <= this.wall()) throw denied();
      const key = { scopeId: task.scopeId, taskId: task.id, runId: run.id };
      const stored = await db.aiTaskRunPlan.findFirst({ where: key });
      if (!stored || stored.scopeId !== key.scopeId || stored.taskId !== key.taskId || stored.runId !== key.runId
        || !/^[a-f0-9]{64}$/u.test(stored.authorityHash) || requestFingerprint(stored.payload) !== stored.planHash) throw denied();
      const plan = aiTaskRunPlanSchema.parse(structuredClone(stored.payload));
      const selected = plan.steps.filter(step => step.registrationRef === command.registrationRef);
      if (plan.taskId !== task.id || plan.runId !== run.id || selected.length !== 1
        || selected[0].toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
      const source = selected[0].toolCode === this.toolCode ? this : this.planSources?.get(selected[0].toolCode as PersistedTaskInputTool);
      if (!source) throw denied();
      const input = await source.input(await db.aiTaskActionInput.findFirst({ where: { ...key, registrationRef: command.registrationRef } }),
        { ...key, registrationRef: command.registrationRef }, true);
      if (stored.policyVersion !== `scene-policy-${input.policyRevision}`) throw denied();
      const inputRef = source.toolCode === 'tenant.notifications.commit' ? settingsChangeReferenceSchema.parse(input.payload).changeId : input.id;
      const fingerprint = source.toolCode === 'tenant.notifications.commit' ? settingsChangeReferenceSchema.parse(input.payload).changeHash : input.fingerprint;
      const actionId = aiStepActionId(access.scope, task.id, command.registrationRef);
      const step = await db.aiStep.findFirst({ where: { ...key, actionId, toolCode: source.toolCode, toolVersion: AI_TOOL_DRAFT_VERSION,
        inputRef, requestFingerprint: fingerprint } });
      if (!step || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId || step.actionId !== actionId
        || step.inputRef !== inputRef || step.requestFingerprint !== fingerprint || step.toolCode !== source.toolCode
        || step.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
      return { inputRef, fingerprint, planHash: stored.planHash, inputHash: input.fingerprint, stepId: step.id, toolCode: source.toolCode };
    };
    const observed = tx ? await readView(tx)
      : await this.db.$transaction(readView, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 2500, timeout: 5000 });
    const current = await this.authorization.resolve(command.taskId, 'read_step_terminal');
    if (identity(current) !== identity(context)) throw denied();
    return { context: structuredClone(current), registrationAllowed: false, taskId: command.taskId,
      registrationRef: command.registrationRef, authorizationKey: `original-step-${requestFingerprint(observed)}`,
      toolCode: observed.toolCode, toolVersion: AI_TOOL_DRAFT_VERSION, inputRef: observed.inputRef, requestFingerprint: observed.fingerprint };
  }

  async resolve(raw: Readonly<AiStepRegistrationCommand>) {
    const command = structuredClone(raw), before = await this.access(command.taskId, 'transition_task');
    const key = { scopeId: before.task.scopeId, taskId: command.taskId, runId: command.lease.runId };
    const run = await this.db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
    if (!run?.leaseExpiresAt) throw denied();
    const lease = { taskId: key.taskId, ...command.lease, expiresAt: run.leaseExpiresAt.toISOString() };
    const row = await this.db.aiTaskRunPlan.findFirst({ where: key });
    if (!row || row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId) throw unavailable();
    const plan = aiTaskRunPlanSchema.parse(structuredClone(row.payload));
    if (requestFingerprint(plan) !== row.planHash) throw denied();
    const proof = await this.authorize(plan, lease);
    if (proof.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion
      || !plan.steps.some(p => p.registrationRef === command.registrationRef)) throw denied();
    const inputKey = { ...key, registrationRef: command.registrationRef };
    const input = await this.input(await this.db.aiTaskActionInput.findFirst({ where: inputKey }), inputKey);
    await this.verifySettings(before.context, command.taskId, input.payload, undefined, 'plan');
    const current = await this.access(command.taskId, 'transition_task');
    if (current.access.bindingKey !== before.access.bindingKey || current.policyHash !== before.policyHash) throw denied();
    return { context: current.context, registrationAllowed: true as const,
      authorizationKey: `persisted-input-${requestFingerprint({ plan: row.planHash, proof: proof.authorityHash, input })}`,
      taskId: command.taskId, registrationRef: command.registrationRef, expiresAt: proof.expiresAt,
      toolCode: this.toolCode, toolVersion: AI_TOOL_DRAFT_VERSION,
      inputRef: this.toolCode === 'tenant.notifications.commit' ? settingsChangeReferenceSchema.parse(input.payload).changeId : input.id,
      requestFingerprint: this.toolCode === 'tenant.notifications.commit' ? settingsChangeReferenceSchema.parse(input.payload).changeHash : input.fingerprint };
  }

  async authorizeOrderInput(presented: Readonly<ApprovedOrderInputReference>, tx: Prisma.TransactionClient) {
    if (this.toolCode !== 'rental.order.commit') throw unavailable();
    try {
      const reference = z.object({ scopeId: id.max(36), taskId: id.max(36), runId: id.max(36), stepId: id.max(36),
        actionId: id, inputRef: id.max(36), registrationRef: id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/u) }).strict().parse(structuredClone(presented));
      const execution = await this.execution.authorize(reference.taskId);
      const read = async () => {
        const current = await this.access(reference.taskId, 'transition_task', tx);
        if (current.task.scopeId !== reference.scopeId || current.task.status !== 'RUNNING' || current.task.cancelRequestedAt !== null
          || identity(current.context) !== identity(execution)) throw denied();
        const key = { scopeId: reference.scopeId, taskId: reference.taskId, runId: reference.runId };
        const row = await tx.aiTaskActionInput.findFirst({ where: { ...key, id: reference.inputRef } });
        const input = await this.input(row, { ...key, registrationRef: reference.registrationRef });
        if (input.id !== reference.inputRef || input.fingerprint !== reference.fingerprint || input.policyRevision !== current.policy.revision) throw denied();
        const actionId = `ai-action-${requestFingerprint({ version: 'ai-step-registration-1', scope: current.access.scope,
          taskId: reference.taskId, registrationRef: reference.registrationRef })}`;
        const step = await tx.aiStep.findFirst({ where: { ...key, id: reference.stepId, actionId } });
        if (!step || step.id !== reference.stepId || step.actionId !== reference.actionId || actionId !== reference.actionId
          || Object.entries(key).some(([k, v]) => step[k as keyof typeof step] !== v) || step.status !== 'RUNNING'
          || step.toolCode !== this.toolCode || step.toolVersion !== AI_TOOL_DRAFT_VERSION
          || step.inputRef !== reference.inputRef || step.requestFingerprint !== reference.fingerprint) throw denied();
        const run = await tx.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId } });
        if (!run?.leaseOwnerId || !run.leaseExpiresAt) throw denied();
        const lease = { taskId: key.taskId, runId: key.runId, holderId: run.leaseOwnerId, revision: run.revision,
          fencingToken: run.fencingToken.toFixed(0), expiresAt: run.leaseExpiresAt.toISOString() };
        const stored = await tx.aiTaskRunPlan.findFirst({ where: key });
        if (!stored || Object.entries(key).some(([k, v]) => stored[k as keyof typeof stored] !== v)) throw unavailable();
        const plan = aiTaskRunPlanSchema.parse(structuredClone(stored.payload));
        if (requestFingerprint(plan) !== stored.planHash || !plan.steps.some(step => step.registrationRef === reference.registrationRef)) throw denied();
        const proof = await this.authorize(plan, lease, tx);
        if (proof.authorityHash !== stored.authorityHash || proof.policyVersion !== stored.policyVersion) throw denied();
        return { context: current.context, reference, toolCode: 'rental.order.commit' as const, toolVersion: AI_TOOL_DRAFT_VERSION,
          policyRevision: current.policy.revision, policyHash: current.policyHash, expiresAt: proof.expiresAt,
          bindingHash: requestFingerprint({ reference, step: { id: step.id, revision: step.revision, status: step.status }, input,
            policy: current.policyHash, plan: stored.planHash, authority: stored.authorityHash, identity: identity(current.context) }) };
      };
      const first = await read();
      const latestExecution = await this.execution.authorize(reference.taskId);
      if (identity(latestExecution) !== identity(execution)) throw denied();
      const latest = await read();
      if (latest.bindingHash !== first.bindingHash || identity(latest.context) !== identity(first.context)) throw denied();
      return latest;
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw unavailable();
    }
  }

  async readCatalogInput(binding: { taskId: string; runId: string; inputRef: string; fingerprint: string }) {
    if (this.toolCode !== 'rental.catalog.search') throw unavailable();
    const stored = await this.readStoredInput(binding);
    return { ...stored, input: aiCatalogReadInputSchema.parse(stored.input) };
  }

  async readAvailabilityInput(binding: { taskId: string; runId: string; inputRef: string; fingerprint: string }) {
    if (this.toolCode !== 'rental.availability.check') throw unavailable();
    const stored = await this.readStoredInput(binding);
    return { ...stored, input: aiAvailabilityReadInputSchema.parse(stored.input) };
  }

  async readOrderExplainInput(binding: { taskId: string; runId: string; inputRef: string; fingerprint: string }) {
    if (this.toolCode !== 'rental.order.explain') throw unavailable();
    const stored = await this.readStoredInput(binding);
    return { ...stored, input: aiPersistedOrderExplainInputSchema.parse(stored.input) };
  }

  async readMembershipCandidateInput(binding: { taskId: string; runId: string; inputRef: string; fingerprint: string }) {
    if (this.toolCode !== 'membership.customer.resolve') throw unavailable();
    const stored = await this.readStoredInput(binding);
    return { ...stored, input: aiMembershipCandidateReadInputSchema.parse(stored.input) };
  }

  async readOpeningInput(binding: { taskId: string; runId: string; inputRef: string; fingerprint: string }) {
    if (this.toolCode !== 'tenant.opening.diagnose') throw unavailable();
    const stored = await this.readStoredInput(binding);
    return { ...stored, input: aiOpeningReadInputSchema.parse(stored.input) };
  }

  async readRiskInput(binding: { taskId: string; runId: string; inputRef: string; fingerprint: string }) {
    if (this.toolCode !== 'operations.risks.list') throw unavailable();
    const stored = await this.readStoredInput(binding);
    return { ...stored, input: aiRiskReadInputSchema.parse(stored.input) };
  }

  /** Historical source lookup, not execution admission. An expired or disabled
   * execution policy cannot grant a new effect and is not needed to identify
   * an original read; current terminal-read ownership still must be valid.
   * Consumers must re-run the original business Guard before returning facts. */
  async readReadonlyResultInput(value: unknown) {
    if (!(PERSISTED_READONLY_TOOLS as readonly string[]).includes(this.toolCode)) throw unavailable();
    const parsed = z.object({ taskId: id.max(36), runId: id.max(36), stepId: id.max(36) }).strict().safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = parsed.data;
    const read = async () => {
      const context = structuredClone(await this.authorization.resolve(command.taskId, 'read_step_terminal'));
      const access = aiTaskAccessFromContext(context, command.taskId, this.wall());
      const task = structuredClone(await this.db.aiTask.findFirst({ where: access.where }));
      if (!task || task.id !== command.taskId || task.ownerKind !== access.actorKind || task.ownerId !== access.actorId
        || task.audience !== access.audience || task.archivedAt !== null) throw denied();
      const key = { scopeId: task.scopeId, taskId: task.id, runId: command.runId };
      const run = await this.db.aiRun.findFirst({ where: { scopeId: key.scopeId, taskId: key.taskId, id: key.runId,
        actorKind: access.actorKind, actorId: access.actorId } });
      if (!run || run.id !== key.runId || run.scopeId !== key.scopeId || run.taskId !== key.taskId
        || run.actorKind !== access.actorKind || run.actorId !== access.actorId) throw denied();
      const step = structuredClone(await this.db.aiStep.findFirst({ where: { ...key, id: command.stepId } }));
      if (!step || step.id !== command.stepId || Object.entries(key).some(([field, expected]) => step[field as keyof typeof step] !== expected)
        || step.toolCode !== this.toolCode || step.toolVersion !== AI_TOOL_DRAFT_VERSION || !step.inputRef) throw unavailable();
      const row = structuredClone(await this.db.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef } }));
      if (!row || row.id !== step.inputRef || Object.entries(key).some(([field, expected]) => row[field as keyof typeof row] !== expected)
        || row.toolCode !== this.toolCode || row.toolVersion !== AI_TOOL_DRAFT_VERSION
        || row.fingerprint !== step.requestFingerprint || !id.safeParse(row.registrationRef).success) throw denied();
      const expectedAction = `ai-action-${requestFingerprint({ version: 'ai-step-registration-1', scope: access.scope,
        taskId: task.id, registrationRef: row.registrationRef })}`;
      const input = await this.parseInput(structuredClone(row.payload));
      if (step.actionId !== expectedAction || this.fingerprint(input) !== row.fingerprint) throw denied();
      return { context, input, inputRef: row.id, fingerprint: row.fingerprint, registrationRef: row.registrationRef,
        binding: requestFingerprint({ taskId: task.id, scopeId: task.scopeId,
        runId: step.runId, stepId: step.id, actionId: step.actionId, inputRef: row.id,
        fingerprint: row.fingerprint, toolCode: row.toolCode, toolVersion: row.toolVersion,
        policyRevision: row.policyRevision, registrationRef: row.registrationRef }) };
    };
    const before = await read(), after = await read();
    if (identity(before.context) !== identity(after.context) || before.binding !== after.binding) throw denied();
    return { ...before, input: structuredClone(before.input) };
  }

  private async readStoredInput(binding: { taskId: string; runId: string; inputRef: string; fingerprint: string }) {
    binding = structuredClone(binding);
    const before = await this.access(binding.taskId, 'transition_task');
    const key = { scopeId: before.task.scopeId, taskId: binding.taskId, runId: binding.runId };
    const input = await this.input(await this.db.aiTaskActionInput.findFirst({ where: { ...key, id: binding.inputRef } }), key);
    if (input.id !== binding.inputRef || input.fingerprint !== binding.fingerprint || input.policyRevision !== before.policy.revision) throw denied();
    const current = await this.access(binding.taskId, 'transition_task');
    if (current.access.bindingKey !== before.access.bindingKey || current.policyHash !== before.policyHash) throw denied();
    return { context: current.context, input: input.payload, registrationRef: input.registrationRef, expiresAt: input.expiresAt };
  }

  async readModelForExecution(binding: Parameters<PrismaTaskPlanInputSource['readForExecution']>[0]) {
    if (!isTaskModelTool(this.toolCode)) throw unavailable();
    binding = structuredClone(binding);
    const execution = await this.execution.authorize(binding.taskId);
    const stored = await this.readForExecution(binding);
    const model = parseTaskModelInput(stored.input, this.modelPolicy!);
    const current = await this.access(binding.taskId, 'transition_task');
    if (current.task.status !== 'RUNNING' || current.task.cancelRequestedAt !== null
      || identity(execution) !== identity(stored.context) || identity(execution) !== identity(current.context)
      || model.identityHash !== identity(current.context) || model.intent.sceneCode !== current.task.sceneCode) throw denied();
    const key = { scopeId: current.task.scopeId, taskId: binding.taskId, runId: binding.runId };
    const row = await this.db.aiTaskRunPlan.findFirst({ where: key });
    if (!row || Object.entries(key).some(([k, v]) => row[k as keyof typeof row] !== v)) throw unavailable();
    const plan = aiTaskRunPlanSchema.parse(structuredClone(row.payload));
    if (requestFingerprint(plan) !== row.planHash || !plan.steps.some(step => step.registrationRef === stored.registrationRef)) throw denied();
    const proof = await this.authorize(plan, binding.lease);
    if (proof.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion
      || identity(await this.execution.authorize(binding.taskId)) !== identity(execution)) throw denied();
    const latest = await this.readForExecution(binding);
    if (identity(latest.context) !== identity(stored.context) || latest.registrationRef !== stored.registrationRef
      || latest.expiresAt !== stored.expiresAt || requestFingerprint(latest.input) !== requestFingerprint(stored.input)) throw denied();
    return { ...latest, input: model };
  }

  async readForExecution(presented: { taskId: string; runId: string; stepId: string; actionId: string;
    inputRef: string; fingerprint: string; lease: AiTaskRunnerLease }) {
    // Settings execution consumes its original domain change through the
    // existing approved participant, not the generic input UUID reader.
    if (this.toolCode === 'tenant.notifications.commit') throw unavailable();
    const binding = structuredClone(presented);
    const stored = await this.readStoredInput(binding);
    const current = await this.access(binding.taskId, 'transition_task');
    if (identity(current.context) !== identity(stored.context) || binding.runId !== binding.lease.runId
      || binding.taskId !== binding.lease.taskId) throw denied();
    await this.held(binding.lease, current);
    const actionId = `ai-action-${requestFingerprint({ version: 'ai-step-registration-1', scope: current.access.scope,
      taskId: binding.taskId, registrationRef: stored.registrationRef })}`;
    const step = await this.db.aiStep.findFirst({ where: { scopeId: current.task.scopeId, taskId: binding.taskId,
      runId: binding.runId, id: binding.stepId, actionId } });
    if (!step || step.id !== binding.stepId || step.scopeId !== current.task.scopeId || step.taskId !== binding.taskId
      || step.runId !== binding.runId || step.actionId !== binding.actionId || binding.actionId !== actionId
      || step.status !== 'RUNNING' || step.inputRef !== binding.inputRef || step.requestFingerprint !== binding.fingerprint
      || step.toolCode !== this.toolCode || step.toolVersion !== AI_TOOL_DRAFT_VERSION) throw denied();
    const again = await this.readStoredInput(binding);
    if (identity(again.context) !== identity(stored.context) || again.registrationRef !== stored.registrationRef
      || requestFingerprint(again.input) !== requestFingerprint(stored.input)) throw denied();
    await this.held(binding.lease, current);
    return again;
  }
}
