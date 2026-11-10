import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import type { AiScopeRepository } from './ai-scope.repository';
import { gatewayPlatformBudgetPrincipal } from './budget/gateway-budget-principal';
import { checkedAccountingCall, type PrismaGatewayAccountingFacts } from './budget/prisma-gateway-accounting-facts';
import { isGatewayConfig } from './gateway-contract-validation';
import { ModelGatewayError } from './model-gateway.ports';
import type { GatewayAuditPreparation, GatewayBudgetDenialObservation, UnifiedGatewayAudit } from './unified-ai-gateway.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const contextSchema = z.object({ actorId: id }).strict();
const entrySchema = z.object({ callId: id.max(128), tenantId: z.null(), workspaceId: z.null(),
  event: z.enum(['ai.invoke.admitted', 'ai.stream.admitted']), status: z.literal('accepted') }).strict();
type Db = Pick<PrismaClient, '$transaction' | 'user' | 'operationLog' | 'aiTask' | 'aiScope'
  | 'aiGatewayInvocation' | 'aiInvocationAdmission' | 'aiGatewayAccountingReceipt' | 'aiBudgetReservation'>;
const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 };
const denied = () => new ModelGatewayError('FORBIDDEN');
const invalid = () => new ModelGatewayError('CONFIG_INVALID');

/** Platform task observations in the existing OperationLog, not a new ledger.
 * Call attribution remains null. The required journal foreign key comes ONLY
 * from the currently authorized SaaS user's persisted tenant, never a borrowed
 * business tenant/default workspace. Prepared/admitted do not attest dispatch.
 * Unknown write acknowledgement is retained; this producer never retries it. */
export class PrismaPlatformGatewayAudit implements UnifiedGatewayAudit {
  constructor(private readonly db: Db, private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    private readonly facts: Pick<PrismaGatewayAccountingFacts, 'assertClaim' | 'readDispatch'>,
    private readonly taskId: string, private readonly clock: () => Date = () => new Date()) {
    if (!id.max(36).safeParse(taskId).success || typeof db?.$transaction !== 'function'
      || typeof db.user?.findUnique !== 'function' || typeof db.operationLog?.create !== 'function'
      || typeof db.operationLog.findUnique !== 'function' || typeof scopes?.resolveCurrent !== 'function'
      || typeof facts?.assertClaim !== 'function' || typeof facts.readDispatch !== 'function'
      || typeof clock !== 'function') throw invalid();
  }

  private async current() {
    const resolved = structuredClone(await this.scopes.resolveCurrent());
    const principal = gatewayPlatformBudgetPrincipal(resolved.context);
    if (resolved.scope.kind !== 'PLATFORM' || 'tenantId' in resolved.scope || 'workspaceId' in resolved.scope) throw denied();
    const user = await this.db.user.findUnique({ where: { id: principal.actorId },
      select: { id: true, tenantId: true, isActive: true, isSaasAdmin: true } });
    if (!user || user.id !== principal.actorId || !user.isActive || !user.isSaasAdmin || !id.safeParse(user.tenantId).success) throw denied();
    const { requestId: _request, authorizedAt: _at, ...identity } = resolved.context;
    return { scopeId: resolved.scope.id, actorId: principal.actorId, journalTenantId: user.tenantId,
      hash: requestFingerprint({ identity, scope: resolved.scope, journalTenantId: user.tenantId }) };
  }

  private async original(tx: Prisma.TransactionClient, callId: string, current: Awaited<ReturnType<PrismaPlatformGatewayAudit['current']>>) {
    const [owner, user, task, invocation] = await Promise.all([
      tx.aiScope.findFirst({ where: { id: current.scopeId, kind: 'PLATFORM', scopeKey: 'platform', tenantId: null, workspaceId: null } }),
      tx.user.findUnique({ where: { id: current.actorId }, select: { id: true, tenantId: true, isActive: true, isSaasAdmin: true } }),
      tx.aiTask.findFirst({ where: { id: this.taskId, scopeId: current.scopeId, scopeKind: 'PLATFORM',
        ownerKind: 'SAAS_ADMIN', ownerId: current.actorId, audience: 'OPERATOR', archivedAt: null } }),
      tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: current.scopeId, callId } } })
    ]);
    if (!owner || owner.id !== current.scopeId || owner.kind !== 'PLATFORM' || owner.scopeKey !== 'platform'
      || owner.tenantId !== null || owner.workspaceId !== null || !user || user.id !== current.actorId
      || user.tenantId !== current.journalTenantId || !user.isActive || !user.isSaasAdmin
      || !task || task.id !== this.taskId || task.scopeId !== current.scopeId || task.scopeKind !== 'PLATFORM'
      || task.ownerKind !== 'SAAS_ADMIN' || task.ownerId !== current.actorId || task.audience !== 'OPERATOR'
      || task.archivedAt !== null || task.contractVersion !== AI_TASK_DRAFT_VERSION || !invocation
      || invocation.scopeId !== current.scopeId || invocation.taskId !== task.id || invocation.actorId !== current.actorId
      || invocation.callId !== callId || !['invoke', 'stream'].includes(invocation.mode)
      || !isGatewayConfig(invocation.configuration) || invocation.configuration.serviceMode !== 'platform_managed'
      || invocation.configuration.configurationScope.kind !== 'platform' || 'tenantId' in invocation.configuration
      || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw denied();
    return { taskId: task.id, invocationId: invocation.id, scopeId: invocation.scopeId, actorId: invocation.actorId,
      runId: invocation.runId, stepId: invocation.stepId, actionId: invocation.actionId,
      stepFingerprint: invocation.stepFingerprint, callId: invocation.callId, mode: invocation.mode,
      sceneCode: invocation.sceneCode, intentHash: invocation.intentHash, registrationHash: invocation.registrationHash,
      configuration: invocation.configuration, configurationHash: invocation.configurationHash,
      priceVersion: invocation.priceVersion, maxOutputTokens: invocation.maxOutputTokens };
  }

  private data(current: Awaited<ReturnType<PrismaPlatformGatewayAudit['current']>>,
    source: Awaited<ReturnType<PrismaPlatformGatewayAudit['original']>>, action: string, metadata: object) {
    const digest = requestFingerprint({ version: 'ai-platform-gateway-audit-1', scopeId: source.scopeId,
      invocationId: source.invocationId, action });
    const logId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    return { id: logId, tenantId: current.journalTenantId, workspaceId: null, userId: current.actorId, action,
      detail: { version: 'ai-platform-gateway-audit-1', attribution: { scopeKind: 'PLATFORM', tenantId: null, workspaceId: null },
        taskId: source.taskId, invocationId: source.invocationId, scopeId: source.scopeId,
        runId: source.runId, stepId: source.stepId, actionId: source.actionId, callId: source.callId,
        actorKind: 'SAAS_ADMIN', actorId: source.actorId, mode: source.mode, sceneCode: source.sceneCode,
        registrationHash: source.registrationHash, configurationHash: source.configurationHash,
        priceVersion: source.priceVersion, ...metadata } };
  }

  private async write(current: Awaited<ReturnType<PrismaPlatformGatewayAudit['current']>>,
    load: (tx: Prisma.TransactionClient) => Promise<object>, source: object,
    data: ReturnType<PrismaPlatformGatewayAudit['data']>, signal?: AbortSignal) {
    const open = () => { if (signal?.aborted) throw new ModelGatewayError('CANCELLED'); };
    const check = (row: Prisma.OperationLogGetPayload<{}> | null) => {
      if (!row || row.id !== data.id || row.tenantId !== data.tenantId || row.workspaceId !== null
        || row.userId !== data.userId || row.action !== data.action || !isDeepStrictEqual(row.detail, data.detail)) throw invalid();
    };
    let attempted = false;
    try {
      open(); if ((await this.current()).hash !== current.hash) throw denied();
      await this.db.$transaction(async tx => {
        open(); if (!isDeepStrictEqual(await load(tx), source)) throw denied();
        const previous = await tx.operationLog.findUnique({ where: { id: data.id } });
        if (previous) { check(previous); return; }
        open(); if (!isDeepStrictEqual(await load(tx), source)) throw denied();
        attempted = true; check(await tx.operationLog.create({ data }));
      }, options);
      open(); if ((await this.current()).hash !== current.hash) throw denied();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Observe a unique-key winner once; never retry or alter the insert.
        try {
          open(); if ((await this.current()).hash !== current.hash) throw denied();
          await this.db.$transaction(async tx => {
            if (!isDeepStrictEqual(await load(tx), source)) throw denied();
            check(await tx.operationLog.findUnique({ where: { id: data.id } }));
          }, options);
          open(); if ((await this.current()).hash !== current.hash) throw denied(); return;
        } catch (observationError) {
          // A conflicting insert was already attempted. Revocation or a failed
          // winner read cannot prove its original observation is absent.
          if (attempted) throw new ModelGatewayError('ACCOUNTING_PENDING');
          if (observationError instanceof ModelGatewayError) throw observationError;
          throw new ModelGatewayError('ACCOUNTING_PENDING');
        }
      }
      // Once the insert is attempted, later cancellation/current-identity errors
      // are not proof that the original journal write rolled back. Match the
      // workspace audit boundary: keep its acknowledgement unknown, never retry.
      if (attempted) throw new ModelGatewayError('ACCOUNTING_PENDING');
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    }
  }

  private async observe(operation: () => Promise<void>) {
    try { await operation(); }
    catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      // Read-side infrastructure failures are not acknowledgements, and their
      // private messages must not escape this producer. write() retains unknown.
      throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    }
  }

  prepare(value: GatewayAuditPreparation, signal?: AbortSignal) {
    return this.observe(() => this.prepareObservation(value, signal));
  }
  append(value: Parameters<UnifiedGatewayAudit['append']>[0]) {
    return this.observe(() => this.appendObservation(value));
  }
  budgetDenied(value: GatewayBudgetDenialObservation, signal?: AbortSignal) {
    return this.observe(() => this.budgetDeniedObservation(value, signal));
  }

  private async prepareObservation(value: GatewayAuditPreparation, signal?: AbortSignal) {
    const input = structuredClone(value), context = contextSchema.safeParse(input.context), profile = input.profile;
    if (!context.success || !id.max(128).safeParse(input.callId).success || !['invoke', 'stream'].includes(input.mode)
      || !/^[a-f0-9]{64}$/u.test(input.intentHash) || !/^[a-f0-9]{64}$/u.test(input.requestHash)
      || !/^[a-f0-9]{64}$/u.test(input.configurationHash) || !profile || !profile.enabled || profile.disabledAt !== null
      || profile.scopeKind !== 'PLATFORM' || profile.serviceMode !== 'platform_managed'
      || requestFingerprint(profile) !== input.configurationHash) throw denied();
    const current = await this.current(); if (context.data.actorId !== current.actorId || profile.scopeId !== current.scopeId) throw denied();
    const load = (tx: Prisma.TransactionClient) => this.original(tx, input.callId, current);
    const source = await this.db.$transaction(load, options), config = source.configuration;
    if (source.mode !== input.mode || source.intentHash !== input.intentHash || config.configId !== profile.id
      || config.configRevision !== profile.configRevision || config.protocol !== profile.protocol || config.provider !== profile.provider
      || config.model !== profile.model || config.credentialRef !== profile.credentialRef) throw denied();
    await this.write(current, load, source, this.data(current, source, 'ai.platform.gateway.prepared', {
      intentHash: input.intentHash, requestHash: input.requestHash, profileHash: input.configurationHash,
      observation: 'prepared_not_admitted_or_dispatched' }), signal);
  }

  private async appendObservation(value: Parameters<UnifiedGatewayAudit['append']>[0]) {
    const parsed = entrySchema.safeParse(structuredClone(value)); if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const entry = parsed.data, current = await this.current();
    const load = async (tx: Prisma.TransactionClient) => {
      const source = await this.original(tx, entry.callId, current);
      const receipt = await tx.aiGatewayAccountingReceipt.findUnique({ where: { invocationId: source.invocationId } });
      if (!receipt || receipt.scopeKind !== 'PLATFORM' || receipt.scopeId !== current.scopeId || receipt.taskId !== source.taskId
        || receipt.tenantId !== null || receipt.workspaceId !== null || receipt.state !== 'reserved') throw denied();
      const [admission, reservation] = await Promise.all([
        tx.aiInvocationAdmission.findUnique({ where: { id: receipt.admissionId } }),
        tx.aiBudgetReservation.findUnique({ where: { id: receipt.reservationId } })
      ]);
      const now = this.clock(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw invalid();
      if (entry.event !== `ai.${source.mode}.admitted` || !admission || admission.scopeKind !== 'PLATFORM'
        || admission.tenantId !== null || admission.workspaceId !== null || admission.platformDedupKey !== source.callId
        || admission.actorId !== current.actorId || admission.callId !== source.callId || admission.profileId !== source.configuration.configId
        || !admission.dispatchId || admission.dispatchId !== receipt.dispatchToken || admission.requestHash !== receipt.requestHash
        || admission.status !== 'admitted' || admission.revokedAt || admission.completedAt || admission.expiresAt <= now
        || !reservation || reservation.scopeId !== current.scopeId || reservation.scopeKind !== 'PLATFORM'
        || reservation.tenantId !== null || reservation.workspaceId !== null || reservation.actorId !== current.actorId
        || reservation.callId !== source.callId || reservation.requestId !== source.callId || reservation.idempotencyKey !== source.callId
        || reservation.runId !== source.runId || reservation.stepId !== source.stepId || reservation.actionId !== source.actionId
        || reservation.sceneCode !== source.sceneCode || reservation.priceVersion !== source.priceVersion
        || reservation.configurationHash !== source.configurationHash || reservation.configRevision !== source.configuration.configRevision
        || reservation.status !== 'reserved' || reservation.dispatchState !== 'not_dispatched') throw denied();
      return { source, receipt, admission };
    };
    const loaded = await this.db.$transaction(load, options), { source, receipt, admission } = loaded;
    await this.facts.assertClaim({ context: { actorId: current.actorId }, binding: { scope: { id: current.scopeId, kind: 'PLATFORM' },
      id: admission.id, actorId: current.actorId, callId: source.callId, profileId: admission.profileId!,
      requestHash: receipt.requestHash, dispatchId: receipt.dispatchToken }, request: { callId: source.callId,
        model: source.configuration.model, maxOutputTokens: source.maxOutputTokens, intentHash: source.intentHash }, expiresAt: admission.expiresAt });
    const evidence = await this.facts.readDispatch(receipt.reservationId);
    if (evidence.reservationId !== receipt.reservationId || evidence.callId !== source.callId || evidence.actorId !== current.actorId
      || evidence.dispatchToken !== receipt.dispatchToken || evidence.scopeKey !== `PLATFORM:${current.scopeId}`) throw denied();
    await this.write(current, load, loaded, this.data(current, source, 'ai.platform.gateway.admitted', {
      reservationId: receipt.reservationId, admissionId: admission.id, requestHash: receipt.requestHash,
      dispatchBindingHash: requestFingerprint(receipt.dispatchToken), observation: 'admitted_not_dispatched' }));
  }

  private async budgetDeniedObservation(value: GatewayBudgetDenialObservation, signal?: AbortSignal) {
    let call;
    try { call = checkedAccountingCall(value.call); } catch { throw denied(); }
    if ('tenantId' in call.context || call.binding.scope.kind !== 'PLATFORM' || value.code !== 'BUDGET_UNAVAILABLE') throw denied();
    const current = await this.current();
    if (call.context.actorId !== current.actorId || call.binding.scope.id !== current.scopeId) throw denied();
    await this.facts.assertClaim(call);
    const load = async (tx: Prisma.TransactionClient) => {
      const source = await this.original(tx, call.request.callId, current);
      const admission = await tx.aiInvocationAdmission.findUnique({ where: { id: call.binding.id } });
      const now = this.clock(); if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw invalid();
      if (!admission || admission.scopeKind !== 'PLATFORM' || admission.tenantId !== null || admission.workspaceId !== null
        || admission.platformDedupKey !== source.callId || admission.actorId !== current.actorId || admission.callId !== source.callId
        || admission.profileId !== source.configuration.configId || admission.profileId !== call.binding.profileId
        || admission.dispatchId !== call.binding.dispatchId || admission.requestHash !== call.binding.requestHash
        || admission.status !== 'admitted' || admission.revokedAt || admission.completedAt || admission.expiresAt <= now
        || admission.expiresAt.getTime() !== call.expiresAt.getTime() || source.intentHash !== call.request.intentHash
        || source.configuration.model !== call.request.model || source.maxOutputTokens !== call.request.maxOutputTokens) throw denied();
      const [receipt, reservation] = await Promise.all([
        tx.aiGatewayAccountingReceipt.findUnique({ where: { invocationId: source.invocationId } }),
        tx.aiBudgetReservation.findUnique({ where: { scopeId_scopeKind_callId: { scopeId: current.scopeId, scopeKind: 'PLATFORM', callId: source.callId } } })
      ]);
      if (receipt || reservation) throw new ModelGatewayError('ACCOUNTING_PENDING');
      return { source, admission };
    };
    const loaded = await this.db.$transaction(load, options);
    await this.write(current, load, loaded, this.data(current, loaded.source, 'ai.platform.gateway.budget_denied', {
      code: value.code, admissionId: loaded.admission.id, requestHash: call.binding.requestHash,
      dispatchBindingHash: requestFingerprint(call.binding.dispatchId), observation: 'gate_rejected_not_release_evidence' }), signal);
  }
}
