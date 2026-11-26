/** Shared persistent Invocation and original budget bindings. The host supplies
 * its frozen input checks and original Task transaction. No provider I/O here. */
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient, AiGatewayInvocation, AiProviderProfile, AiStep } from '@prisma/client';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft, AiGatewayIntentDraft } from '@rental-os/platform-contracts/ai-gateway';
import { isGatewayConfig, isGatewayIntent, isPlatformGatewayContext, tenantGatewayContextSchema } from '@rental-os/platform-server/ai-gateway';
import { z } from 'zod';
import type { AiScopeRepository } from '../ai-scope.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { parseAiProviderProfileRecord } from '../provider-profile.repository';
import { readStoredTenantModelConfiguration } from '../tenant-model-config.repository';
import { tenantModelMode, tenantModelServiceEnabled } from '../model-config-compatibility';
import { gatewayPreparationReceipt } from '../gateway-preparation-audit';
import type { AiTaskTransactionBoundary } from '../../task-transactions';
import { AiTaskRepositoryError } from '../../task-errors';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { BudgetError } from './budget.ports';
import { gatewayBudgetPrincipal, gatewayPlatformBudgetPrincipal, gatewayTenantBudgetPrincipal } from './gateway-budget-principal';
import type { BudgetGatewayContext, BudgetGatewayBindingSource, BudgetGatewayInvocationBinding, GatewayBudgetReserveRequest } from './budget-gateway-adapter';

type Db = Pick<PrismaClient, '$transaction' | 'aiGatewayInvocation' | 'aiBudgetReservation' | 'aiTask' | 'aiRun' | 'aiStep' | 'aiScope' | 'aiProviderProfile'>
  & Partial<Pick<PrismaClient, 'aiTaskActionInput'>>;
export type GatewayInvocationReader = Omit<Db, '$transaction'>;
type Reader = GatewayInvocationReader;
export interface GatewayInvocationChecks {
  prepare(db: Reader, step: AiStep, context: AiExecutionContext, input: RegisterGatewayInvocation): Promise<string>;
  verify(db: Reader, step: AiStep, invocation: { sceneCode: string; intentHash: string }, audience: string): Promise<void>;
  profile?(db: Reader, step: AiStep, input: RegisterGatewayInvocation, profile: AiProviderProfile): Promise<void>;
}
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).min(1);
const registration = z.object({ stepId: id.max(36), mode: z.enum(['invoke', 'stream']),
  lease: z.object({ runId: id.max(36), holderId: id.max(191), fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/) }).strict(),
  intent: z.unknown(), configuration: z.unknown(), priceVersion: id.max(64), expiresAt: z.date() }).strict();
export interface RegisterGatewayInvocation {
  stepId: string; mode: 'invoke' | 'stream'; lease: { runId: string; holderId: string; fencingToken: string };
  intent: AiGatewayIntentDraft; configuration: AiGatewayConfigReferenceDraft; priceVersion: string; expiresAt: Date;
}

export class GatewayInvocationStore implements BudgetGatewayBindingSource {
  constructor(private readonly db: Db, private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly clock: () => Date, private readonly transactions: Pick<AiTaskTransactionBoundary<Prisma.TransactionClient>, 'withAiTaskTransaction'>,
    private readonly checks: GatewayInvocationChecks, private readonly consumer: 'tenant' | 'legacy' = 'legacy') {
    if (typeof scopes?.resolveCurrent !== 'function' || typeof db?.$transaction !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  private now() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new BudgetError('UNAVAILABLE');
    return now;
  }
  private async current(context?: Readonly<BudgetGatewayContext>) {
    const resolved = structuredClone(await this.scopes.resolveCurrent());
    const { scope, context: principal } = resolved;
    if ((scope.kind === 'TENANT') !== (this.consumer === 'tenant')) throw new BudgetError('FORBIDDEN');
    const subject = scope.kind === 'PLATFORM' ? gatewayPlatformBudgetPrincipal(principal)
      : scope.kind === 'TENANT' ? gatewayTenantBudgetPrincipal(principal) : gatewayBudgetPrincipal(principal);
    const columns = aiPersistenceScopeColumns(principal.scope);
    const expected = scope.kind === 'PLATFORM' ? context === undefined || isPlatformGatewayContext(context)
      : scope.kind === 'TENANT' ? context === undefined || (tenantGatewayContextSchema.safeParse(context).success
        && 'tenantId' in context && context.tenantId === scope.tenantId)
        : context === undefined || ('tenantId' in context && 'workspaceId' in context && !('scopeKind' in context)
          && context.tenantId === scope.tenantId && context.workspaceId === scope.workspaceId);
    if (!expected || scope.kind !== columns.kind || (scope.tenantId ?? null) !== columns.tenantId
      || (scope.workspaceId ?? null) !== columns.workspaceId || context && context.actorId !== subject.actorId)
      throw new BudgetError('FORBIDDEN');
    const { requestId: _, authorizedAt: __, ...identity } = principal;
    return { scope, context: principal, actorId: subject.actorId, actorKind: subject.actorKind, identityHash: requestFingerprint({ identity, scope }) };
  }
  private async revalidate(initial: Awaited<ReturnType<GatewayInvocationStore['current']>>) {
    if ((await this.current()).identityHash !== initial.identityHash) throw new BudgetError('FORBIDDEN');
  }
  private configuration(row: AiGatewayInvocation): AiGatewayConfigReferenceDraft {
    if (!isGatewayConfig(row.configuration) || requestFingerprint(row.configuration) !== row.configurationHash) throw new BudgetError('UNAVAILABLE');
    return structuredClone(row.configuration);
  }
  private async profile(db: Reader, configuration: AiGatewayConfigReferenceDraft, owner: 'platform' | { tenantId: string }) {
    if ('consumerScope' in configuration && configuration.consumerScope?.kind === 'platform') {
      if (owner !== 'platform') throw new BudgetError('FORBIDDEN');
      // Explicit SaaS/platform consumer config; no tenant attribution exists to borrow.
      if (configuration.serviceMode !== 'platform_managed' || configuration.configurationScope.kind !== 'platform') throw new BudgetError('FORBIDDEN');
      const scopeRow = await db.aiScope.findFirst({ where: aiPersistenceScopeColumns({ kind: 'platform' }) });
      const profile = await db.aiProviderProfile.findFirst({ where: { id: configuration.configId, enabled: true, disabledAt: null } });
      if (!scopeRow || !profile || profile.scopeId !== scopeRow.id || profile.scopeKind !== scopeRow.kind
        || profile.configRevision !== configuration.configRevision || profile.credentialRef !== configuration.credentialRef
        || profile.protocol !== configuration.protocol || profile.provider !== configuration.provider || profile.model !== configuration.model
        || profile.serviceMode !== 'platform_managed') throw new BudgetError('FORBIDDEN');
      return profile;
    }
    if (!('tenantId' in configuration) || typeof owner === 'string' || configuration.tenantId !== owner.tenantId) throw new BudgetError('FORBIDDEN');
    const scopeRow = await db.aiScope.findFirst({ where: aiPersistenceScopeColumns(configuration.configurationScope) });
    const profile = await db.aiProviderProfile.findFirst({ where: { id: configuration.configId, enabled: true, disabledAt: null } });
    if (!scopeRow || !profile || profile.id !== configuration.configId || profile.scopeId !== scopeRow.id || profile.scopeKind !== scopeRow.kind
      || profile.configRevision !== configuration.configRevision || profile.credentialRef !== configuration.credentialRef
      || profile.protocol !== configuration.protocol || profile.provider !== configuration.provider || profile.model !== configuration.model
      || profile.serviceMode !== configuration.serviceMode
      || (profile.serviceMode === 'platform_managed' ? scopeRow.kind !== 'PLATFORM'
        : scopeRow.kind !== 'TENANT' || scopeRow.tenantId !== owner.tenantId)) throw new BudgetError('FORBIDDEN');
    return profile;
  }
  private async task(db: Reader, scopeId: string, taskId: string, actorId: string, audience: string, ownerKind: 'USER' | 'CUSTOMER' | 'SAAS_ADMIN' | 'AUTOMATION') {
    const task = await db.aiTask.findFirst({ where: { id: taskId, scopeId, ownerId: actorId, ownerKind } });
    if (!task || task.audience.toLowerCase() !== audience || task.archivedAt) throw new BudgetError('FORBIDDEN');
    return task;
  }
  private async active(db: Reader, row: Pick<AiGatewayInvocation, 'scopeId' | 'taskId' | 'stepId' | 'runId' | 'actionId' | 'actorId' | 'stepFingerprint' | 'intentHash' | 'sceneCode' | 'leaseOwnerId' | 'fencingToken' | 'expiresAt'>, audience: string, ownerKind: 'USER' | 'CUSTOMER' | 'SAAS_ADMIN' | 'AUTOMATION') {
    const task = await this.task(db, row.scopeId, row.taskId, row.actorId, audience, ownerKind);
    const run = await db.aiRun.findFirst({ where: { id: row.runId, scopeId: row.scopeId, taskId: row.taskId } });
    const step = await db.aiStep.findFirst({ where: { id: row.stepId, scopeId: row.scopeId, taskId: row.taskId, runId: row.runId } });
    const now = this.now();
    if (task.status !== 'RUNNING' || task.cancelRequestedAt || task.sceneCode !== row.sceneCode
      || !run || run.status !== 'RUNNING' || run.actorKind !== task.ownerKind || run.actorId !== row.actorId
      || run.leaseOwnerId !== row.leaseOwnerId || !run.leaseExpiresAt || run.leaseExpiresAt <= now
      || !run.fencingToken.equals(row.fencingToken) || row.expiresAt <= now
      || !step || step.status !== 'RUNNING' || step.actionId !== row.actionId
      || step.requestFingerprint !== row.stepFingerprint) throw new BudgetError('FORBIDDEN');
    if (this.consumer === 'tenant' && (task.id !== row.taskId || task.scopeId !== row.scopeId || task.scopeKind !== 'TENANT'
      || task.ownerId !== row.actorId || task.ownerKind !== 'USER' || run.id !== row.runId || run.scopeId !== row.scopeId
      || run.taskId !== row.taskId || step.id !== row.stepId || step.scopeId !== row.scopeId || step.runId !== row.runId
      || step.taskId !== row.taskId)) throw new BudgetError('FORBIDDEN');
    await this.checks.verify(db, step, row, audience);
    return { task, run, step };
  }
  async register(value: RegisterGatewayInvocation): Promise<{ id: string; replayed: boolean }> {
    const parsed = registration.safeParse(structuredClone(value));
    if (!parsed.success || !isGatewayIntent(parsed.data.intent) || !isGatewayConfig(parsed.data.configuration)
      || !('tenantId' in parsed.data.configuration || 'consumerScope' in parsed.data.configuration)) throw new BudgetError('INVALID');
    const input = { ...parsed.data, intent: parsed.data.intent, configuration: parsed.data.configuration };
    if (input.expiresAt <= this.now() || BigInt(input.lease.fencingToken) > 18446744073709551615n) throw new BudgetError('INVALID');
    const principal = await this.current();
    try {
      const result = await this.db.$transaction(async tx => {
        return this.transactions.withAiTaskTransaction(tx, { kind: 'step', stepId: input.stepId }, async () => {
          const step = await tx.aiStep.findFirst({ where: { id: input.stepId, scopeId: principal.scope.id, runId: input.lease.runId } });
          if (!step) throw new BudgetError('FORBIDDEN');
          const intentHash = await this.checks.prepare(tx, step, principal.context, input);
          const candidate = { scopeId: principal.scope.id, taskId: step.taskId, runId: step.runId, stepId: step.id, actionId: step.actionId,
            actorId: principal.actorId, stepFingerprint: step.requestFingerprint, intentHash, sceneCode: input.intent.sceneCode,
            leaseOwnerId: input.lease.holderId, fencingToken: new prismaRuntime.Decimal(input.lease.fencingToken), expiresAt: input.expiresAt };
          const active = await this.active(tx, candidate, principal.context.audience, principal.actorKind);
          if (input.expiresAt > active.run.leaseExpiresAt!) throw new BudgetError('INVALID');
          const taskLock = await tx.aiTask.updateMany({ where: { id: active.task.id, scopeId: candidate.scopeId, revision: active.task.revision, status: 'RUNNING', cancelRequestedAt: null, archivedAt: null }, data: { revision: active.task.revision } });
          const runLock = await tx.aiRun.updateMany({ where: { id: active.run.id, scopeId: candidate.scopeId, taskId: candidate.taskId, revision: active.run.revision,
            leaseOwnerId: candidate.leaseOwnerId, fencingToken: candidate.fencingToken, status: 'RUNNING', leaseExpiresAt: { gt: this.now() } }, data: { revision: active.run.revision } });
          const stepLock = await tx.aiStep.updateMany({ where: { id: step.id, scopeId: candidate.scopeId, revision: step.revision, status: 'RUNNING', requestFingerprint: candidate.stepFingerprint }, data: { revision: step.revision } });
          if (taskLock.count !== 1 || runLock.count !== 1 || stepLock.count !== 1) throw new BudgetError('FORBIDDEN');
          const profile = await this.profile(tx, input.configuration, principal.scope.kind === 'PLATFORM' ? 'platform' : { tenantId: principal.scope.tenantId! });
          await this.checks.profile?.(tx, step, input, profile);
          if (this.consumer === 'tenant') await this.assertSelection(tx, principal.scope.tenantId!, input.configuration);
          const profileLock = await tx.aiProviderProfile.updateMany({ where: { id: profile.id, configRevision: profile.configRevision, enabled: true, disabledAt: null }, data: { configRevision: profile.configRevision } });
          if (profileLock.count !== 1) throw new BudgetError('FORBIDDEN');
          const configurationHash = requestFingerprint(input.configuration);
          const registrationHash = requestFingerprint({ ...candidate, fencingToken: input.lease.fencingToken, expiresAt: input.expiresAt.toISOString(),
            callId: input.intent.requestId, mode: input.mode, configurationHash, priceVersion: input.priceVersion, maxOutputTokens: input.intent.maxOutputTokens, identity: principal.identityHash });
          const existing = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: candidate.scopeId, callId: input.intent.requestId } } });
          if (this.consumer === 'legacy') await this.revalidate(principal);
          if (candidate.expiresAt <= this.now()) throw new BudgetError('FORBIDDEN');
          if (existing) {
            if (existing.registrationHash !== registrationHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
            return { id: existing.id, replayed: true };
          }
          const created = await tx.aiGatewayInvocation.create({ data: { ...candidate, callId: input.intent.requestId, mode: input.mode, registrationHash,
            configuration: { ...input.configuration, configurationScope: { ...input.configuration.configurationScope },
              ...('consumerScope' in input.configuration && input.configuration.consumerScope
                ? { consumerScope: { ...input.configuration.consumerScope } } : {}) } as unknown as Prisma.InputJsonValue, configurationHash, priceVersion: input.priceVersion, maxOutputTokens: input.intent.maxOutputTokens } });
          if (this.consumer === 'legacy') await this.revalidate(principal);
          if (candidate.expiresAt <= this.now()) throw new BudgetError('FORBIDDEN');
          return { id: created.id, replayed: false };
        });
      }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      if (this.consumer === 'tenant') {
        try { await this.revalidate(principal); } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
      }
      return result;
    } catch (error) {
      if (error instanceof BudgetError) throw error;
      if (this.consumer === 'tenant' && error instanceof AiTaskRepositoryError && error.code === 'AI_ACCESS_DENIED') throw new BudgetError('FORBIDDEN');
      if (error instanceof prismaRuntime.PrismaClientKnownRequestError && error.code === 'P2002') throw new BudgetError('IDEMPOTENCY_CONFLICT');
      throw new BudgetError('PENDING_RECONCILIATION');
    }
  }
  private async assertSelection(tx: Prisma.TransactionClient, tenantId: string, configuration: AiGatewayConfigReferenceDraft) {
    const selected = await readStoredTenantModelConfiguration(tx, tenantId);
    if (!selected || selected.tenantId !== tenantId || tenantModelMode(selected) !== configuration.serviceMode
      || !tenantModelServiceEnabled(selected) || configuration.serviceMode === 'tenant_managed'
        && selected.revision !== configuration.configRevision) throw new BudgetError('FORBIDDEN');
  }
  /** Final pre-egress read on the same Native as the current Task participant. */
  async assertTenantDispatch(tx: Prisma.TransactionClient, scopeId: string, tenantId: string, actorId: string, request: {
    callId: string; model: string; maxOutputTokens: number; profileHash: string; intentHash: string; taskId: string; stepId: string
  }) {
    const invocation = await this.assertTenantInvocation(tx, scopeId, tenantId, actorId, request, true);
    const configuration = this.configuration(invocation);
    const rows = await tx.aiGatewayAccountingReceipt.findMany({ where: { invocationId: invocation.id, scopeId,
      scopeKind: 'TENANT', tenantId, workspaceId: null, state: 'dispatched' }, take: 2 });
    if (rows.length !== 1) throw new BudgetError('PENDING_RECONCILIATION');
    const receipt = rows[0];
    const admission = await tx.aiInvocationAdmission.findUnique({ where: { id: receipt.admissionId } });
    const reservation = await tx.aiBudgetReservation.findUnique({ where: { id: receipt.reservationId } });
    if (invocation.taskId !== request.taskId || invocation.stepId !== request.stepId
      || receipt.invocationId !== invocation.id || receipt.scopeId !== scopeId || receipt.scopeKind !== 'TENANT'
      || receipt.tenantId !== tenantId || receipt.workspaceId !== null || receipt.taskId !== invocation.taskId || receipt.state !== 'dispatched'
      || !admission || admission.id !== receipt.admissionId || admission.scopeKind !== 'TENANT' || admission.tenantId !== tenantId || admission.workspaceId !== null
      || admission.platformDedupKey !== null
      || admission.actorId !== actorId || admission.callId !== request.callId || admission.profileId !== configuration.configId
      || admission.status !== 'admitted' || !admission.dispatchId || admission.dispatchId !== receipt.dispatchToken
      || admission.requestHash !== receipt.requestHash || admission.revokedAt || admission.completedAt
      || !reservation || reservation.id !== receipt.reservationId || reservation.scopeId !== scopeId || reservation.scopeKind !== 'TENANT'
      || reservation.tenantId !== tenantId || reservation.workspaceId !== null || reservation.actorId !== actorId
      || reservation.callId !== request.callId || reservation.requestId !== request.callId || reservation.idempotencyKey !== request.callId
      || reservation.runId !== invocation.runId || reservation.stepId !== invocation.stepId || reservation.actionId !== invocation.actionId
      || reservation.sceneCode !== invocation.sceneCode || reservation.priceVersion !== invocation.priceVersion
      || reservation.configurationHash !== invocation.configurationHash || reservation.configRevision !== configuration.configRevision
      || reservation.status !== 'reserved' || reservation.dispatchState !== 'dispatched'
      || admission.expiresAt <= this.now() || invocation.expiresAt <= this.now() || reservation.expiresAt <= this.now())
      throw new BudgetError('FORBIDDEN');
    const preparation = gatewayPreparationReceipt(invocation, tenantId, receipt.requestHash, request.profileHash);
    const audit = await tx.operationLog.findUnique({ where: { id: preparation.id } });
    if (!audit || audit.id !== preparation.id || audit.tenantId !== tenantId || audit.workspaceId !== null || audit.userId !== actorId
      || audit.action !== preparation.action || requestFingerprint(audit.detail) !== requestFingerprint(preparation.detail)
      || admission.expiresAt <= this.now() || reservation.expiresAt <= this.now() || invocation.expiresAt <= this.now())
      throw new BudgetError('FORBIDDEN');
    return { invocation, reservationId: reservation.id };
  }
  async assertTenantInvocation(tx: Prisma.TransactionClient, scopeId: string, tenantId: string, actorId: string, request: {
    callId: string; model: string; maxOutputTokens?: number; profileHash?: string; intentHash?: string; mode?: string
  }, requireCurrentSelection = false) {
    if (this.consumer !== 'tenant') throw new BudgetError('FORBIDDEN');
    const canonical = aiPersistenceScopeColumns({ kind: 'tenant', tenantId });
    const scope = await tx.aiScope.findFirst({ where: { id: scopeId, ...canonical } });
    if (!scope || scope.id !== scopeId || scope.kind !== 'TENANT' || scope.tenantId !== tenantId
      || scope.workspaceId !== null || scope.scopeKey !== canonical.scopeKey) throw new BudgetError('FORBIDDEN');
    const invocation = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId, callId: request.callId } } });
    if (!invocation || invocation.scopeId !== scopeId || invocation.actorId !== actorId || invocation.callId !== request.callId
      || request.maxOutputTokens !== undefined && invocation.maxOutputTokens !== request.maxOutputTokens
      || request.intentHash !== undefined && invocation.intentHash !== request.intentHash
      || request.mode !== undefined && invocation.mode !== request.mode) throw new BudgetError('FORBIDDEN');
    const configuration = this.configuration(invocation);
    if (configuration.model !== request.model) throw new BudgetError('FORBIDDEN');
    await this.active(tx, invocation, 'operator', 'USER');
    const profile = await this.profile(tx, configuration, { tenantId });
    if (requireCurrentSelection) await this.assertSelection(tx, tenantId, configuration);
    if (request.profileHash !== undefined) {
      if (requestFingerprint(parseAiProviderProfileRecord(profile)) !== request.profileHash)
        throw new BudgetError('FORBIDDEN');
    }
    return invocation;
  }
  private binding(row: AiGatewayInvocation, principal: Awaited<ReturnType<GatewayInvocationStore['current']>>): BudgetGatewayInvocationBinding {
    if (row.actorId !== principal.actorId || row.scopeId !== principal.scope.id) throw new BudgetError('FORBIDDEN');
    return { actorId: row.actorId, sceneCode: row.sceneCode, expiresAt: new Date(row.expiresAt), association: {
      requestId: row.callId, runId: row.runId, stepId: row.stepId, actionId: row.actionId, idempotencyKey: row.callId,
      scope: structuredClone(principal.context.scope), config: this.configuration(row), priceVersion: row.priceVersion
    } };
  }
  async resolveForReserve(context: Readonly<BudgetGatewayContext>, request: Readonly<GatewayBudgetReserveRequest>) {
    context = structuredClone(context); request = structuredClone(request);
    const principal = await this.current(context);
    const row = await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: principal.scope.id, callId: request.callId } } });
    if (!row || row.intentHash !== request.intentHash || row.maxOutputTokens !== request.maxOutputTokens) throw new BudgetError('FORBIDDEN');
    const binding = this.binding(row, principal);
    if (binding.association.config.model !== request.model) throw new BudgetError('FORBIDDEN');
    await this.active(this.db, row, principal.context.audience, principal.actorKind);
    await this.profile(this.db, binding.association.config, principal.scope.kind === 'PLATFORM' ? 'platform' : { tenantId: principal.scope.tenantId! });
    await this.revalidate(principal);
    if (row.expiresAt <= this.now()) throw new BudgetError('FORBIDDEN');
    return binding;
  }
  async resolveForReservation(context: Readonly<BudgetGatewayContext>, reservationId: string) {
    context = structuredClone(context);
    const principal = await this.current(context);
    const reservation = await this.db.aiBudgetReservation.findFirst({ where: { id: reservationId, scopeId: principal.scope.id,
      scopeKind: principal.scope.kind, actorId: principal.actorId } });
    if (!reservation) throw new BudgetError('FORBIDDEN');
    const row = await this.db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: principal.scope.id, callId: reservation.callId } } });
    if (!row || reservation.configurationHash !== row.configurationHash || reservation.requestId !== row.callId
      || reservation.runId !== row.runId || reservation.stepId !== row.stepId || reservation.actionId !== row.actionId
      || reservation.idempotencyKey !== row.callId || reservation.sceneCode !== row.sceneCode || reservation.priceVersion !== row.priceVersion
      || reservation.tenantId !== (principal.scope.tenantId ?? null) || reservation.workspaceId !== (principal.scope.workspaceId ?? null)) throw new BudgetError('FORBIDDEN');
    const binding = this.binding(row, principal);
    if (reservation.configRevision !== binding.association.config.configRevision) throw new BudgetError('FORBIDDEN');
    await this.task(this.db, row.scopeId, row.taskId, row.actorId, principal.context.audience, principal.actorKind);
    await this.revalidate(principal);
    return binding;
  }
}
