import { Prisma, type PrismaClient, type AiGatewayInvocation, type AiStep } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiGatewayConfigReferenceDraft, type AiGatewayIntentDraft } from '@rental-os/shared';
import { z } from 'zod';
import type { AiScopeRepository } from '../ai-scope.repository';
import { isGatewayConfig, isGatewayIntent } from '../gateway-contract-validation';
import { prepareGatewayTextIntent } from '../gateway-intent';
import { TASK_TEXT_MODEL_TOOL, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, parseTaskModelInput, taskModelFingerprint, taskModelIdentity, taskModelPolicy, type TaskModelPolicy } from '../model-input/task-model-input';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import type { GatewayContext } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { BudgetError } from './budget.ports';
import { gatewayBudgetPrincipal } from './gateway-budget-principal';
import { textProbeCommandSchema, textProbeIntent, textProbeCapability, textProbeMode, TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE } from '../text-capability-probe';
import { capabilityProfileFingerprint } from '../capability-verification';
import { PrismaProviderProfileRepository } from '../provider-profile.repository';
import type { BudgetGatewayBindingSource, BudgetGatewayInvocationBinding, GatewayBudgetReserveRequest } from './budget-gateway-adapter';

type Db = Pick<PrismaClient, '$transaction' | 'aiGatewayInvocation' | 'aiBudgetReservation' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiScope' | 'aiProviderProfile'>
  & Partial<Pick<PrismaClient, 'aiTaskActionInput'>>;
type Reader = Omit<Db, '$transaction'>;
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).min(1);
const registration = z.object({ stepId: id.max(36), mode: z.enum(['invoke', 'stream']),
  lease: z.object({ runId: id.max(36), holderId: id.max(191), fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/) }).strict(),
  intent: z.unknown(), configuration: z.unknown(), priceVersion: id.max(64), expiresAt: z.date() }).strict();
export interface RegisterGatewayInvocation {
  stepId: string; mode: 'invoke' | 'stream'; lease: { runId: string; holderId: string; fencingToken: string };
  intent: AiGatewayIntentDraft; configuration: AiGatewayConfigReferenceDraft; priceVersion: string; expiresAt: Date;
}

export class PrismaGatewayInvocationBindings implements BudgetGatewayBindingSource {
  private readonly modelPolicy?: TaskModelPolicy;
  constructor(private readonly db: Db, private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly clock: () => Date = () => new Date(), modelPolicy?: TaskModelPolicy) {
    if (typeof scopes?.resolveCurrent !== 'function' || typeof db?.$transaction !== 'function') throw new BudgetError('UNAVAILABLE');
    if (modelPolicy) this.modelPolicy = taskModelPolicy(modelPolicy);
  }
  private now() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BudgetError('UNAVAILABLE');
    return now;
  }
  private async current(context?: Readonly<GatewayContext>) {
    const resolved = structuredClone(await this.scopes.resolveCurrent());
    const { scope, context: principal } = resolved;
    const subject = gatewayBudgetPrincipal(principal);
    if (scope.kind !== 'WORKSPACE' || scope.tenantId !== subject.tenantId || scope.workspaceId !== subject.workspaceId
      || (context && (context.actorId !== subject.actorId || context.tenantId !== scope.tenantId || context.workspaceId !== scope.workspaceId))) throw new BudgetError('FORBIDDEN');
    const { requestId: _, authorizedAt: __, ...identity } = principal;
    return { scope, context: principal, actorId: subject.actorId, identityHash: requestFingerprint({ identity, scope }) };
  }
  private async revalidate(initial: Awaited<ReturnType<PrismaGatewayInvocationBindings['current']>>) {
    if ((await this.current()).identityHash !== initial.identityHash) throw new BudgetError('FORBIDDEN');
  }
  private configuration(row: AiGatewayInvocation): AiGatewayConfigReferenceDraft {
    if (!isGatewayConfig(row.configuration) || requestFingerprint(row.configuration) !== row.configurationHash) throw new BudgetError('UNAVAILABLE');
    return structuredClone(row.configuration);
  }
  private async profile(db: Reader, configuration: AiGatewayConfigReferenceDraft, tenantId: string) {
    if (!('tenantId' in configuration) || configuration.tenantId !== tenantId) throw new BudgetError('FORBIDDEN');
    const owner = await db.aiScope.findFirst({ where: aiPersistenceScopeColumns(configuration.configurationScope) });
    const profile = await db.aiProviderProfile.findFirst({ where: { id: configuration.configId, enabled: true, disabledAt: null } });
    if (!owner || !profile || profile.scopeId !== owner.id || profile.scopeKind !== owner.kind
      || profile.configRevision !== configuration.configRevision || profile.credentialRef !== configuration.credentialRef
      || profile.protocol !== configuration.protocol || profile.provider !== configuration.provider || profile.model !== configuration.model
      || profile.serviceMode !== configuration.serviceMode
      || (profile.serviceMode === 'platform_managed' ? owner.kind !== 'PLATFORM'
        : owner.kind !== 'TENANT' || owner.tenantId !== tenantId)) throw new BudgetError('FORBIDDEN');
    return profile;
  }
  private async task(db: Reader, scopeId: string, taskId: string, actorId: string, audience: string) {
    const ownerKind = audience === 'client' ? 'CUSTOMER' : 'USER';
    const task = await db.aiTask.findFirst({ where: { id: taskId, scopeId, ownerId: actorId, ownerKind } });
    if (!task || task.audience.toLowerCase() !== audience || task.archivedAt) throw new BudgetError('FORBIDDEN');
    return task;
  }
  private async probeInput(db: Reader, step: AiStep) {
    if (step.toolCode !== TEXT_CAPABILITY_PROBE_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION || !step.inputRef
      || typeof db.aiTaskActionInput?.findFirst !== 'function') throw new BudgetError('FORBIDDEN');
    const saved = await db.aiTaskActionInput.findFirst({ where: { id: step.inputRef, scopeId: step.scopeId,
      taskId: step.taskId, runId: step.runId, toolCode: step.toolCode, toolVersion: step.toolVersion } });
    const command = textProbeCommandSchema.safeParse(saved?.payload);
    if (!saved || !command.success || saved.id !== step.inputRef || saved.scopeId !== step.scopeId
      || saved.taskId !== step.taskId || saved.runId !== step.runId || saved.toolCode !== step.toolCode
      || saved.toolVersion !== step.toolVersion || saved.fingerprint !== step.requestFingerprint
      || requestFingerprint(command.data) !== step.requestFingerprint || !(saved.expiresAt instanceof Date)
      || !Number.isFinite(saved.expiresAt.getTime()) || saved.expiresAt <= this.now()) throw new BudgetError('FORBIDDEN');
    return { command: command.data, prepared: textProbeIntent(command.data.operationId, step.scopeId, textProbeCapability(command.data)) };
  }
  private async active(db: Reader, row: Pick<AiGatewayInvocation, 'scopeId' | 'taskId' | 'stepId' | 'runId' | 'actionId' | 'actorId' | 'stepFingerprint' | 'intentHash' | 'sceneCode' | 'leaseOwnerId' | 'fencingToken' | 'expiresAt'>, audience: string) {
    const task = await this.task(db, row.scopeId, row.taskId, row.actorId, audience);
    const run = await db.aiRun.findFirst({ where: { id: row.runId, scopeId: row.scopeId, taskId: row.taskId } });
    const step = await db.aiStep.findFirst({ where: { id: row.stepId, scopeId: row.scopeId, taskId: row.taskId, runId: row.runId } });
    const now = this.now();
    if (task.status !== 'RUNNING' || task.cancelRequestedAt || task.sceneCode !== row.sceneCode
      || !run || run.status !== 'RUNNING' || run.actorKind !== task.ownerKind || run.actorId !== row.actorId
      || run.leaseOwnerId !== row.leaseOwnerId || !run.leaseExpiresAt || run.leaseExpiresAt <= now
      || !run.fencingToken.equals(row.fencingToken) || row.expiresAt <= now
      || !step || step.status !== 'RUNNING' || step.actionId !== row.actionId
      || step.requestFingerprint !== row.stepFingerprint) throw new BudgetError('FORBIDDEN');
    if (step.toolCode === TEXT_CAPABILITY_PROBE_TOOL) {
      if (audience === 'client') throw new BudgetError('FORBIDDEN');
      const frozen = await this.probeInput(db, step);
      if (row.sceneCode !== TEXT_PROBE_SCENE || row.intentHash !== frozen.prepared.intentHash) throw new BudgetError('FORBIDDEN');
    } else if (step.requestFingerprint !== row.intentHash) throw new BudgetError('FORBIDDEN');
    return { task, run, step };
  }
  async register(value: RegisterGatewayInvocation): Promise<{ id: string; replayed: boolean }> {
    const parsed = registration.safeParse(structuredClone(value));
    if (!parsed.success || !isGatewayIntent(parsed.data.intent) || !isGatewayConfig(parsed.data.configuration)
      || !('tenantId' in parsed.data.configuration)) throw new BudgetError('INVALID');
    const input = { ...parsed.data, intent: parsed.data.intent, configuration: parsed.data.configuration };
    if (input.expiresAt <= this.now() || BigInt(input.lease.fencingToken) > 18446744073709551615n) throw new BudgetError('INVALID');
    const hasMedia = input.intent.messages.some(message => message.content.some(part => part.kind !== 'text'));
    const principal = await this.current();
    try {
      return await this.db.$transaction(async tx => {
        const step = await tx.aiStep.findFirst({ where: { id: input.stepId, scopeId: principal.scope.id, runId: input.lease.runId } });
        if (!step) throw new BudgetError('FORBIDDEN');
        let intentHash: string;
        if (step.toolCode === TEXT_CAPABILITY_PROBE_TOOL) {
          const frozen = await this.probeInput(tx, step);
          if (input.mode !== textProbeMode(frozen.command)
            || requestFingerprint(input.intent) !== requestFingerprint(frozen.prepared.intent)) throw new BudgetError('FORBIDDEN');
          intentHash = frozen.prepared.intentHash;
        } else if (step.toolCode === TASK_TEXT_MODEL_TOOL && this.modelPolicy) {
          // Explicit server scene policy, not a flag inferred from Agent input.
          // Original publication/plan permission remains the execution gate.
          if (hasMedia || !step.inputRef || input.mode !== 'invoke' || !tx.aiTaskActionInput) throw new BudgetError('FORBIDDEN');
          const saved = await tx.aiTaskActionInput.findFirst({ where: { id: step.inputRef, scopeId: step.scopeId,
            taskId: step.taskId, runId: step.runId, toolCode: step.toolCode, toolVersion: step.toolVersion,
            fingerprint: step.requestFingerprint } });
          if (!saved || saved.id !== step.inputRef || saved.scopeId !== step.scopeId || saved.taskId !== step.taskId
            || saved.runId !== step.runId || saved.toolCode !== step.toolCode || saved.toolVersion !== step.toolVersion
            || saved.fingerprint !== step.requestFingerprint || saved.expiresAt <= this.now()) throw new BudgetError('FORBIDDEN');
          const frozen = parseTaskModelInput(saved.payload, this.modelPolicy);
          if (frozen.identityHash !== taskModelIdentity(principal.context)
            || requestFingerprint(frozen.intent) !== requestFingerprint(input.intent)
            || requestFingerprint(frozen.configuration) !== requestFingerprint(input.configuration)
            || frozen.priceVersion !== input.priceVersion) throw new BudgetError('FORBIDDEN');
          intentHash = taskModelFingerprint(frozen, this.modelPolicy);
        } else if (hasMedia) {
          if (![TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL].includes(step.toolCode as typeof TASK_IMAGE_MODEL_TOOL | typeof TASK_AUDIO_MODEL_TOOL) || !step.inputRef || input.mode !== 'invoke'
            || typeof tx.aiTaskActionInput?.findFirst !== 'function') throw new BudgetError('FORBIDDEN');
          const mediaTool = step.toolCode === TASK_AUDIO_MODEL_TOOL ? TASK_AUDIO_MODEL_TOOL : TASK_IMAGE_MODEL_TOOL;
          const saved = await tx.aiTaskActionInput.findFirst({ where: { id: step.inputRef, scopeId: step.scopeId,
            taskId: step.taskId, runId: step.runId, toolCode: mediaTool, fingerprint: step.requestFingerprint } });
          if (!saved || saved.expiresAt <= this.now()) throw new BudgetError('FORBIDDEN');
          const policy = { sceneCode: input.intent.sceneCode, maxOutputTokens: input.intent.maxOutputTokens,
            kind: mediaTool === TASK_AUDIO_MODEL_TOOL ? 'audio' as const : 'image' as const };
          const frozen = parseTaskModelInput(saved.payload, policy);
          if (frozen.identityHash !== taskModelIdentity(principal.context)
            || requestFingerprint(frozen.intent) !== requestFingerprint(input.intent)
            || requestFingerprint(frozen.configuration) !== requestFingerprint(input.configuration)
            || frozen.priceVersion !== input.priceVersion) throw new BudgetError('FORBIDDEN');
          intentHash = taskModelFingerprint(frozen, policy);
        } else {
          intentHash = prepareGatewayTextIntent(input.intent, { sceneCode: input.intent.sceneCode,
            maxOutputTokens: input.intent.maxOutputTokens }, input.mode).intentHash;
        }
        const candidate = { scopeId: principal.scope.id, taskId: step.taskId, runId: step.runId, stepId: step.id, actionId: step.actionId,
          actorId: principal.actorId, stepFingerprint: step.requestFingerprint, intentHash, sceneCode: input.intent.sceneCode,
          leaseOwnerId: input.lease.holderId, fencingToken: new Prisma.Decimal(input.lease.fencingToken), expiresAt: input.expiresAt };
        const active = await this.active(tx, candidate, principal.context.audience);
        if (step.toolCode === TEXT_CAPABILITY_PROBE_TOOL) {
          const frozen = await this.probeInput(tx, step);
          if (input.mode !== textProbeMode(frozen.command)) throw new BudgetError('FORBIDDEN');
          if (requestFingerprint(input.intent) !== requestFingerprint(frozen.prepared.intent)) throw new BudgetError('FORBIDDEN');
        }
        if (input.expiresAt > active.run.leaseExpiresAt!) throw new BudgetError('INVALID');
        const taskLock = await tx.aiTask.updateMany({ where: { id: active.task.id, scopeId: candidate.scopeId, revision: active.task.revision, status: 'RUNNING', cancelRequestedAt: null, archivedAt: null }, data: { revision: active.task.revision } });
        const runLock = await tx.aiRun.updateMany({ where: { id: active.run.id, scopeId: candidate.scopeId, taskId: candidate.taskId, revision: active.run.revision,
          leaseOwnerId: candidate.leaseOwnerId, fencingToken: candidate.fencingToken, status: 'RUNNING', leaseExpiresAt: { gt: this.now() } }, data: { revision: active.run.revision } });
        const stepLock = await tx.aiStep.updateMany({ where: { id: step.id, scopeId: candidate.scopeId, revision: step.revision, status: 'RUNNING', requestFingerprint: candidate.stepFingerprint }, data: { revision: step.revision } });
        if (taskLock.count !== 1 || runLock.count !== 1 || stepLock.count !== 1) throw new BudgetError('FORBIDDEN');
        const profile = await this.profile(tx, input.configuration, principal.scope.tenantId!);
        if (step.toolCode === TEXT_CAPABILITY_PROBE_TOOL) {
          const frozen = await this.probeInput(tx, step);
          const originalProfile = await new PrismaProviderProfileRepository(tx).get({ id: profile.scopeId,
            kind: profile.scopeKind as 'PLATFORM' | 'TENANT' | 'WORKSPACE' }, frozen.command.profileKey);
          if (!originalProfile || originalProfile.id !== input.configuration.configId
            || capabilityProfileFingerprint(originalProfile) !== frozen.command.profileFingerprint) throw new BudgetError('FORBIDDEN');
        }
        const profileLock = await tx.aiProviderProfile.updateMany({ where: { id: profile.id, configRevision: profile.configRevision, enabled: true, disabledAt: null }, data: { configRevision: profile.configRevision } });
        if (profileLock.count !== 1) throw new BudgetError('FORBIDDEN');
        const configurationHash = requestFingerprint(input.configuration);
        const registrationHash = requestFingerprint({ ...candidate, fencingToken: input.lease.fencingToken, expiresAt: input.expiresAt.toISOString(),
          callId: input.intent.requestId, mode: input.mode, configurationHash, priceVersion: input.priceVersion, maxOutputTokens: input.intent.maxOutputTokens, identity: principal.identityHash });
        const existing = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: candidate.scopeId, callId: input.intent.requestId } } });
        await this.revalidate(principal);
        if (candidate.expiresAt <= this.now()) throw new BudgetError('FORBIDDEN');
        if (existing) {
          if (existing.registrationHash !== registrationHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
          return { id: existing.id, replayed: true };
        }
        const created = await tx.aiGatewayInvocation.create({ data: { ...candidate, callId: input.intent.requestId, mode: input.mode, registrationHash,
          configuration: { ...input.configuration, configurationScope: { ...input.configuration.configurationScope } }, configurationHash, priceVersion: input.priceVersion, maxOutputTokens: input.intent.maxOutputTokens } });
        await this.revalidate(principal);
        if (candidate.expiresAt <= this.now()) throw new BudgetError('FORBIDDEN');
        return { id: created.id, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof BudgetError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BudgetError('IDEMPOTENCY_CONFLICT');
      throw new BudgetError('PENDING_RECONCILIATION');
    }
  }
  private binding(row: AiGatewayInvocation, principal: Awaited<ReturnType<PrismaGatewayInvocationBindings['current']>>): BudgetGatewayInvocationBinding {
    if (row.actorId !== principal.actorId || row.scopeId !== principal.scope.id) throw new BudgetError('FORBIDDEN');
    return { actorId: row.actorId, sceneCode: row.sceneCode, expiresAt: new Date(row.expiresAt), association: {
      requestId: row.callId, runId: row.runId, stepId: row.stepId, actionId: row.actionId, idempotencyKey: row.callId,
      scope: structuredClone(principal.context.scope), config: this.configuration(row), priceVersion: row.priceVersion
    } };
  }
  async resolveForReserve(context: Readonly<GatewayContext>, request: Readonly<GatewayBudgetReserveRequest>) {
    context = structuredClone(context); request = structuredClone(request);
    const principal = await this.current(context);
    const row = await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: principal.scope.id, callId: request.callId } } });
    if (!row || row.intentHash !== request.intentHash || row.maxOutputTokens !== request.maxOutputTokens) throw new BudgetError('FORBIDDEN');
    const binding = this.binding(row, principal);
    if (binding.association.config.model !== request.model) throw new BudgetError('FORBIDDEN');
    await this.active(this.db, row, principal.context.audience);
    await this.profile(this.db, binding.association.config, principal.scope.tenantId!);
    await this.revalidate(principal);
    if (row.expiresAt <= this.now()) throw new BudgetError('FORBIDDEN');
    return binding;
  }
  async resolveForReservation(context: Readonly<GatewayContext>, reservationId: string) {
    context = structuredClone(context);
    const principal = await this.current(context);
    const reservation = await this.db.aiBudgetReservation.findFirst({ where: { id: reservationId, scopeId: principal.scope.id, scopeKind: 'WORKSPACE', actorId: principal.actorId } });
    if (!reservation) throw new BudgetError('FORBIDDEN');
    const row = await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: principal.scope.id, callId: reservation.callId } } });
    if (!row || reservation.configurationHash !== row.configurationHash || reservation.requestId !== row.callId
      || reservation.runId !== row.runId || reservation.stepId !== row.stepId || reservation.actionId !== row.actionId
      || reservation.idempotencyKey !== row.callId || reservation.sceneCode !== row.sceneCode || reservation.priceVersion !== row.priceVersion
      || reservation.tenantId !== principal.scope.tenantId || reservation.workspaceId !== principal.scope.workspaceId) throw new BudgetError('FORBIDDEN');
    const binding = this.binding(row, principal);
    if (reservation.configRevision !== binding.association.config.configRevision) throw new BudgetError('FORBIDDEN');
    await this.task(this.db, row.scopeId, row.taskId, row.actorId, principal.context.audience);
    await this.revalidate(principal);
    return binding;
  }
}
