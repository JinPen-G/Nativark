import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import type { AiScopeRepository } from './ai-scope.repository';
import { gatewayBudgetPrincipal } from './budget/gateway-budget-principal';
import { checkedAccountingCall } from './budget/prisma-gateway-accounting-facts';
import type { PrismaGatewayAccountingFacts } from './budget/prisma-gateway-accounting-facts';
import { isGatewayConfig } from './gateway-contract-validation';
import { ModelGatewayError } from './model-gateway.ports';
import type { GatewayBudgetDenialObservation, GatewayInvocationObservation, UnifiedGatewayAudit } from './unified-ai-gateway.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

type Db = Pick<PrismaClient, '$transaction' | 'operationLog' | 'aiTask' | 'aiGatewayInvocation'
  | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission' | 'aiBudgetReservation'>;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const entrySchema = z.object({ callId: id.max(128), tenantId: id, workspaceId: id,
  event: z.enum(['ai.invoke.admitted', 'ai.stream.admitted']), status: z.literal('accepted') }).strict();
const denied = () => new ModelGatewayError('FORBIDDEN');
const invalid = () => new ModelGatewayError('CONFIG_INVALID');
export const gatewayDeliveryTimingSchema = z.object({ version: z.literal('gateway-delivery-time-1'),
  transportWallMs: z.number().int().min(0).max(120000), firstValidatedTextMs: z.number().int().min(0).max(120000).nullable() }).strict()
  .refine(value => value.firstValidatedTextMs === null || value.firstValidatedTextMs <= value.transportWallMs);
export function gatewayDeliveryLogId(scopeId: string, invocationId: string) {
  const digest = requestFingerprint({ version: 'ai-gateway-delivery-audit-1', scopeId, invocationId });
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
export function gatewayBudgetDenialLogId(scopeId: string, invocationId: string) {
  const digest = requestFingerprint({ version: 'ai-gateway-budget-denial-1', scopeId, invocationId });
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** Durable admission/delivery observations in the existing OperationLog,
 * never a second task or financial ledger. Retain only IDs/hashes and timing.
 * An admission record attests neither provider dispatch nor business success.
 * A lost write acknowledgement is unknown: this adapter never retries writes. */
export class PrismaTaskGatewayAudit implements UnifiedGatewayAudit {
  private readonly resolve: AiScopeRepository['resolveCurrent'];
  private readonly claim: PrismaGatewayAccountingFacts['assertClaim'];
  private readonly dispatch: PrismaGatewayAccountingFacts['readDispatch'];
  constructor(private readonly db: Db, scopes: Pick<AiScopeRepository, 'resolveCurrent'>,
    facts: Pick<PrismaGatewayAccountingFacts, 'assertClaim' | 'readDispatch'>,
    private readonly taskId: string, private readonly clock: () => Date = () => new Date()) {
    if (!id.max(36).safeParse(taskId).success || typeof db?.$transaction !== 'function'
      || typeof db.operationLog?.create !== 'function' || typeof db.operationLog.findUnique !== 'function'
      || typeof scopes?.resolveCurrent !== 'function' || typeof facts?.assertClaim !== 'function'
      || typeof facts.readDispatch !== 'function' || typeof clock !== 'function') throw invalid();
    this.resolve = scopes.resolveCurrent.bind(scopes);
    this.claim = facts.assertClaim.bind(facts);
    this.dispatch = facts.readDispatch.bind(facts);
  }

  append(value: Parameters<UnifiedGatewayAudit['append']>[0]) { return this.persist(value); }

  /** Original budget-gate rejection only. No reservation, financial event,
   * provider error details or proof that an external effect did not happen. */
  async budgetDenied(value: GatewayBudgetDenialObservation, signal?: AbortSignal) {
    const input = structuredClone(value), call = checkedAccountingCall(input.call);
    if (input.code !== 'BUDGET_UNAVAILABLE') throw new ModelGatewayError('INVALID_REQUEST');
    const open = () => { if (signal?.aborted) throw new ModelGatewayError('CANCELLED'); };
    open();
    let attemptedWrite = false;
    try {
      const current = async () => {
        open();
        const resolved = structuredClone(await this.resolve()), subject = gatewayBudgetPrincipal(resolved.context);
        if (resolved.scope.kind !== 'WORKSPACE' || resolved.scope.id !== call.binding.scope.id
          || resolved.scope.tenantId !== subject.tenantId || resolved.scope.workspaceId !== subject.workspaceId
          || subject.actorId !== call.context.actorId || subject.tenantId !== call.context.tenantId
          || subject.workspaceId !== call.context.workspaceId) throw denied();
        const { authorizedAt: _at, requestId: _request, ...identity } = resolved.context;
        return { resolved, subject, hash: requestFingerprint({ identity, scope: resolved.scope }) };
      };
      const before = await current(); open();
      await this.claim(structuredClone(call)); open();
      const load = async (tx: Prisma.TransactionClient) => {
        open();
        const task = await tx.aiTask.findFirst({ where: { id: this.taskId, scopeId: call.binding.scope.id,
          ownerKind: before.subject.actorKind, ownerId: before.subject.actorId,
          audience: before.resolved.context.audience === 'client' ? 'CLIENT' : before.resolved.context.audience === 'staff' ? 'STAFF' : 'OPERATOR',
          archivedAt: null }, select: { id: true, contractVersion: true } });
        const invocation = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
          scopeId: call.binding.scope.id, callId: call.request.callId } }, select: { id: true, scopeId: true, taskId: true,
          runId: true, stepId: true, actionId: true, callId: true, actorId: true, mode: true, sceneCode: true,
          intentHash: true, registrationHash: true, configuration: true, configurationHash: true, priceVersion: true, maxOutputTokens: true } });
        const admission = await tx.aiInvocationAdmission.findUnique({ where: { id: call.binding.id }, select: {
          id: true, tenantId: true, workspaceId: true, actorId: true, callId: true, profileId: true, dispatchId: true,
          requestHash: true, status: true, revokedAt: true, completedAt: true, expiresAt: true } });
        const now = this.clock();
        if (!task || task.contractVersion !== AI_TASK_DRAFT_VERSION || !invocation || invocation.taskId !== task.id
          || invocation.scopeId !== call.binding.scope.id || invocation.actorId !== call.context.actorId
          || invocation.callId !== call.request.callId || invocation.intentHash !== call.request.intentHash
          || invocation.maxOutputTokens !== call.request.maxOutputTokens || !['invoke', 'stream'].includes(invocation.mode)
          || !isGatewayConfig(invocation.configuration) || requestFingerprint(invocation.configuration) !== invocation.configurationHash
          || invocation.configuration.configId !== call.binding.profileId || invocation.configuration.model !== call.request.model
          || !admission || admission.id !== call.binding.id || admission.tenantId !== call.context.tenantId || admission.workspaceId !== call.context.workspaceId
          || admission.actorId !== call.context.actorId || admission.callId !== call.request.callId
          || admission.profileId !== call.binding.profileId || admission.dispatchId !== call.binding.dispatchId
          || admission.requestHash !== call.binding.requestHash || admission.status !== 'admitted' || admission.revokedAt || admission.completedAt
          || !(now instanceof Date) || !Number.isFinite(now.getTime()) || admission.expiresAt <= now
          || !(admission.expiresAt instanceof Date) || admission.expiresAt.getTime() !== call.expiresAt.getTime()) throw denied();
        // A failed link/COMMIT is not a clean budget denial. Never manufacture
        // a refusal observation around an existing original financial hold.
        const reservation = await tx.aiBudgetReservation.findUnique({ where: { scopeId_scopeKind_callId: {
          scopeId: invocation.scopeId, scopeKind: 'WORKSPACE', callId: invocation.callId } }, select: { id: true } });
        const receipt = await tx.aiGatewayAccountingReceipt.findUnique({ where: { invocationId: invocation.id }, select: { id: true } });
        if (reservation || receipt) throw new ModelGatewayError('ACCOUNTING_PENDING');
        open(); return { task, invocation, admission };
      };
      const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 };
      const source = await this.db.$transaction(load, options), { invocation } = source;
      const auditId = gatewayBudgetDenialLogId(invocation.scopeId, invocation.id);
      const data = { id: auditId, tenantId: call.context.tenantId, workspaceId: call.context.workspaceId,
        userId: before.subject.actorKind === 'USER' ? before.subject.actorId : null, action: 'ai.gateway.budget_denied',
        detail: { operator: 'AI Native Gateway', targetType: 'ai_gateway_invocation', targetId: invocation.id,
          metadata: { version: 'ai-gateway-budget-denial-1', code: input.code, taskId: invocation.taskId,
            runId: invocation.runId, stepId: invocation.stepId, actionId: invocation.actionId, callId: invocation.callId,
            actorKind: before.subject.actorKind, actorId: before.subject.actorId, mode: invocation.mode, sceneCode: invocation.sceneCode,
            registrationHash: invocation.registrationHash, configurationHash: invocation.configurationHash, priceVersion: invocation.priceVersion,
            admissionId: call.binding.id, requestHash: call.binding.requestHash, dispatchBindingHash: requestFingerprint(call.binding.dispatchId),
            observation: 'gate_rejected_not_release_evidence' } } };
      const check = (row: Prisma.OperationLogGetPayload<{}> | null) => {
        if (!row || row.tenantId !== data.tenantId || row.workspaceId !== data.workspaceId || row.userId !== data.userId
          || row.id !== auditId || row.action !== data.action || !isDeepStrictEqual(row.detail, data.detail)) throw invalid();
      };
      if ((await current()).hash !== before.hash) throw denied();
      open();
      try {
        await this.db.$transaction(async tx => {
          if (!isDeepStrictEqual(await load(tx), source)) throw denied();
          const existing = await tx.operationLog.findUnique({ where: { id: auditId } });
          if (existing) { check(existing); return; }
          open(); attemptedWrite = true;
          check(await tx.operationLog.create({ data }));
        }, options);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        open(); check(await this.db.operationLog.findUnique({ where: { id: auditId } }));
      }
      if ((await current()).hash !== before.hash) throw denied();
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError(attemptedWrite ? 'ACCOUNTING_PENDING' : 'PROVIDER_UNAVAILABLE');
    }
  }

  /** Completion observation only, not settlement, dispatch permission, token
   * counting or a UI first-paint receipt. Never retain the response body. */
  record(value: GatewayInvocationObservation) {
    const observation = structuredClone(value), parsed = gatewayDeliveryTimingSchema.safeParse(observation.timing);
    if (!parsed.success || !observation.delivery || !['invoke', 'stream'].includes(observation.delivery.mode)
      || observation.delivery.mode === 'invoke' && parsed.data.firstValidatedTextMs !== null
      || observation.delivery.mode === 'stream' && parsed.data.firstValidatedTextMs !== null && observation.delivery.deltaBytes < 1) {
      throw new ModelGatewayError('INVALID_RESPONSE');
    }
    return this.persist({ tenantId: observation.call.context.tenantId, workspaceId: observation.call.context.workspaceId,
      callId: observation.call.request.callId,
      event: `ai.${observation.delivery.mode}.admitted`, status: 'accepted' }, observation);
  }

  private async persist(value: Parameters<UnifiedGatewayAudit['append']>[0], observation?: GatewayInvocationObservation) {
    const parsed = entrySchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const entry = Object.freeze(parsed.data);
    let attemptedWrite = false;
    try {
      const current = async () => {
        const resolved = structuredClone(await this.resolve()), subject = gatewayBudgetPrincipal(resolved.context);
        if (resolved.scope.kind !== 'WORKSPACE' || resolved.scope.tenantId !== subject.tenantId
          || resolved.scope.workspaceId !== subject.workspaceId || subject.tenantId !== entry.tenantId
          || subject.workspaceId !== entry.workspaceId) throw denied();
        const { authorizedAt: _at, requestId: _request, ...identity } = resolved.context;
        return { resolved, subject, binding: requestFingerprint({ identity, scope: resolved.scope }) };
      };
      const before = await current(), scopeId = before.resolved.scope.id;
      const audience = before.resolved.context.audience === 'client' ? 'CLIENT'
        : before.resolved.context.audience === 'staff' ? 'STAFF' : 'OPERATOR';
      const verifyCurrent = async () => { if ((await current()).binding !== before.binding) throw denied(); };
      const load = async (tx: Prisma.TransactionClient) => {
        const task = await tx.aiTask.findFirst({ where: { id: this.taskId, scopeId,
          ownerKind: before.subject.actorKind, ownerId: before.subject.actorId,
          audience, archivedAt: null },
          select: { id: true, scopeId: true, ownerKind: true, ownerId: true, audience: true, contractVersion: true } });
        const invocation = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId, callId: entry.callId } },
          select: { id: true, scopeId: true, taskId: true, runId: true, stepId: true, actionId: true, actorId: true,
            callId: true, mode: true, sceneCode: true, configuration: true, configurationHash: true,
            intentHash: true, registrationHash: true, priceVersion: true, maxOutputTokens: true } });
        if (!task || task.id !== this.taskId || task.scopeId !== scopeId || task.ownerKind !== before.subject.actorKind
          || task.ownerId !== before.subject.actorId || task.audience !== audience
          || task.contractVersion !== AI_TASK_DRAFT_VERSION || !invocation || invocation.taskId !== task.id
          || invocation.scopeId !== scopeId || invocation.callId !== entry.callId || invocation.actorId !== before.subject.actorId
          || entry.event !== `ai.${invocation.mode}.admitted` || !isGatewayConfig(invocation.configuration)
          || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw denied();
        const receipt = await tx.aiGatewayAccountingReceipt.findUnique({ where: { invocationId: invocation.id }, select: {
          id: true, invocationId: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true,
          taskId: true, admissionId: true, reservationId: true, dispatchToken: true, requestHash: true, state: true } });
        if (!receipt || receipt.invocationId !== invocation.id || receipt.scopeId !== scopeId || receipt.scopeKind !== 'WORKSPACE'
          || receipt.taskId !== task.id || receipt.tenantId !== entry.tenantId || receipt.workspaceId !== entry.workspaceId) throw denied();
        const admission = await tx.aiInvocationAdmission.findUnique({ where: { id: receipt.admissionId }, select: {
          id: true, tenantId: true, workspaceId: true, actorId: true, callId: true, profileId: true,
          dispatchId: true, requestHash: true, status: true, revokedAt: true, completedAt: true, expiresAt: true } });
        const reservation = await tx.aiBudgetReservation.findUnique({ where: { id: receipt.reservationId }, select: {
          id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true, actorId: true, callId: true,
          requestId: true, runId: true, stepId: true, actionId: true, sceneCode: true, priceVersion: true,
          configurationHash: true, configRevision: true, status: true, dispatchState: true } });
        if (!admission || admission.id !== receipt.admissionId || admission.tenantId !== entry.tenantId
          || admission.workspaceId !== entry.workspaceId || admission.actorId !== before.subject.actorId
          || admission.callId !== entry.callId || admission.profileId !== invocation.configuration.configId
          || !admission.dispatchId || admission.dispatchId !== receipt.dispatchToken || admission.requestHash !== receipt.requestHash
          || !reservation || reservation.id !== receipt.reservationId || reservation.scopeId !== scopeId
          || reservation.scopeKind !== 'WORKSPACE' || reservation.tenantId !== entry.tenantId || reservation.workspaceId !== entry.workspaceId
          || reservation.actorId !== before.subject.actorId || reservation.callId !== entry.callId || reservation.requestId !== entry.callId
          || reservation.runId !== invocation.runId || reservation.stepId !== invocation.stepId || reservation.actionId !== invocation.actionId
          || reservation.sceneCode !== invocation.sceneCode || reservation.priceVersion !== invocation.priceVersion
          || reservation.configurationHash !== invocation.configurationHash || reservation.configRevision !== invocation.configuration.configRevision) throw denied();
        return { invocation, receipt, admission, reservation };
      };
      const options = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 };
      const source = await this.db.$transaction(load, options), { invocation, receipt, admission } = source;
      if (observation && (observation.reservationId !== receipt.reservationId || observation.delivery?.mode !== invocation.mode
        || observation.route.profile.id !== admission.profileId
        || observation.call.binding.id !== admission.id || observation.call.binding.dispatchId !== receipt.dispatchToken
        || observation.call.binding.requestHash !== receipt.requestHash || observation.call.binding.scope.id !== scopeId
        || observation.call.binding.actorId !== before.subject.actorId || observation.call.context.actorId !== before.subject.actorId
        || observation.call.request.intentHash !== invocation.intentHash || observation.call.request.model !== (invocation.configuration as { model: string }).model
        || observation.call.request.maxOutputTokens !== invocation.maxOutputTokens
        || !(observation.call.expiresAt instanceof Date) || observation.call.expiresAt.getTime() !== admission.expiresAt.getTime()
        || !isGatewayConfig(invocation.configuration) || observation.route.profile.configRevision !== invocation.configuration.configRevision
        || observation.route.profile.protocol !== invocation.configuration.protocol || observation.route.profile.provider !== invocation.configuration.provider
        || observation.route.profile.model !== invocation.configuration.model || observation.route.profile.credentialRef !== invocation.configuration.credentialRef)) throw denied();
      await this.claim(structuredClone(observation?.call ?? { context: { tenantId: entry.tenantId, workspaceId: entry.workspaceId, actorId: before.subject.actorId },
        binding: { scope: before.resolved.scope as { id: string; kind: 'WORKSPACE'; tenantId: string; workspaceId: string },
          id: admission.id, actorId: before.subject.actorId, callId: invocation.callId, profileId: admission.profileId,
          requestHash: receipt.requestHash, dispatchId: receipt.dispatchToken },
        request: { callId: invocation.callId, model: (invocation.configuration as { model: string }).model,
          maxOutputTokens: invocation.maxOutputTokens, intentHash: invocation.intentHash }, expiresAt: admission.expiresAt }));
      // Reuse the single ledger's full association verifier, not a caller's
      // assertion that "accepted" means unsent or eligible for a refund.
      const evidence = await this.dispatch(receipt.reservationId);
      if (evidence.reservationId !== receipt.reservationId || evidence.callId !== invocation.callId
        || evidence.dispatchToken !== receipt.dispatchToken || evidence.actorId !== before.subject.actorId
        || evidence.scopeKey !== `WORKSPACE:${scopeId}`) throw denied();
      if (observation && evidence.state !== 'dispatched') throw denied();
      const digest = requestFingerprint({ version: 'ai-gateway-admission-audit-1', scopeId, invocationId: invocation.id, event: entry.event });
      const auditId = observation ? gatewayDeliveryLogId(scopeId, invocation.id)
        : `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const data = { id: auditId, tenantId: entry.tenantId, workspaceId: entry.workspaceId,
        userId: before.subject.actorKind === 'USER' ? before.subject.actorId : null,
        action: observation ? 'ai.gateway.delivery_observed' : entry.event,
        detail: { operator: 'AI Native Gateway', targetType: 'ai_gateway_invocation', targetId: invocation.id,
          detail: observation ? 'Gateway transport wall time only; not client paint, provider latency, settlement or business success.'
            : 'Admission only; provider dispatch, billing and business success are not attested.',
          metadata: { version: observation ? 'ai-gateway-delivery-audit-1' : 'ai-gateway-admission-audit-1', status: entry.status, callId: invocation.callId,
            taskId: invocation.taskId, runId: invocation.runId, stepId: invocation.stepId, actionId: invocation.actionId,
            actorKind: before.subject.actorKind, actorId: before.subject.actorId, sceneCode: invocation.sceneCode,
            configurationHash: invocation.configurationHash, priceVersion: invocation.priceVersion,
            reservationId: receipt.reservationId, admissionId: admission.id, requestHash: receipt.requestHash,
            dispatchBindingHash: requestFingerprint(receipt.dispatchToken),
            ...(observation ? { mode: invocation.mode, registrationHash: invocation.registrationHash,
              timing: gatewayDeliveryTimingSchema.parse(observation.timing) } : {}) } } };
      const check = (row: Prisma.OperationLogGetPayload<{}> | null) => {
        if (!row || row.id !== data.id || row.tenantId !== data.tenantId || row.workspaceId !== data.workspaceId
          || row.userId !== data.userId || row.action !== data.action || requestFingerprint(row.detail) !== requestFingerprint(data.detail)) throw invalid();
      };
      await verifyCurrent();
      try {
        await this.db.$transaction(async tx => {
          const latest = await load(tx);
          if (!isDeepStrictEqual(latest, source)) throw denied();
          const previous = await tx.operationLog.findUnique({ where: { id: auditId } });
          if (previous) { check(previous); return; }
          const now = this.clock();
          if (!(now instanceof Date) || !Number.isFinite(now.getTime())
            || latest.receipt.state !== (observation ? 'dispatched' : 'reserved')
            || latest.reservation.status !== 'reserved' || latest.reservation.dispatchState !== (observation ? 'dispatched' : 'not_dispatched')
            || latest.admission.status !== 'admitted' || latest.admission.revokedAt || latest.admission.completedAt
            || latest.admission.expiresAt <= now) throw denied();
          // Both admission and delivery observations are facts, not dispatch authority.
          // Current authorization is checked outside this transaction on both
          // sides; never wait on another authorization transaction while holding it.
          attemptedWrite = true;
          check(await tx.operationLog.create({ data }));
        }, options);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        // Unique-key loser may observe the exact immutable row, never retry the insert.
        check(await this.db.operationLog.findUnique({ where: { id: auditId } }));
      }
      await verifyCurrent();
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (['FORBIDDEN', 'AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED'].includes(String(code))) throw denied();
      throw new ModelGatewayError(attemptedWrite ? 'ACCOUNTING_PENDING' : 'PROVIDER_UNAVAILABLE');
    }
  }
}
