import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import type { AiScopeRepository } from './ai-scope.repository';
import { gatewayBudgetPrincipal } from './budget/gateway-budget-principal';
import type { PrismaGatewayAccountingFacts } from './budget/prisma-gateway-accounting-facts';
import { isGatewayConfig } from './gateway-contract-validation';
import { ModelGatewayError } from './model-gateway.ports';
import type { UnifiedGatewayAudit } from './unified-ai-gateway.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

type Db = Pick<PrismaClient, '$transaction' | 'operationLog' | 'aiTask' | 'aiGatewayInvocation'
  | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission' | 'aiBudgetReservation'>;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const entrySchema = z.object({ callId: id.max(128), tenantId: id, workspaceId: id,
  event: z.enum(['ai.invoke.admitted', 'ai.stream.admitted']), status: z.literal('accepted') }).strict();
const denied = () => new ModelGatewayError('FORBIDDEN');
const invalid = () => new ModelGatewayError('CONFIG_INVALID');

/** Durable admission audit in the existing OperationLog, never a second task
 * or financial ledger. Only original server-owned IDs/hashes are retained.
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

  async append(value: Parameters<UnifiedGatewayAudit['append']>[0]) {
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
            intentHash: true, priceVersion: true, maxOutputTokens: true } });
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
      await this.claim({ context: { tenantId: entry.tenantId, workspaceId: entry.workspaceId, actorId: before.subject.actorId },
        binding: { scope: before.resolved.scope as { id: string; kind: 'WORKSPACE'; tenantId: string; workspaceId: string },
          id: admission.id, actorId: before.subject.actorId, callId: invocation.callId, profileId: admission.profileId,
          requestHash: receipt.requestHash, dispatchId: receipt.dispatchToken },
        request: { callId: invocation.callId, model: (invocation.configuration as { model: string }).model,
          maxOutputTokens: invocation.maxOutputTokens, intentHash: invocation.intentHash }, expiresAt: admission.expiresAt });
      // Reuse the single ledger's full association verifier, not a caller's
      // assertion that "accepted" means unsent or eligible for a refund.
      const evidence = await this.dispatch(receipt.reservationId);
      if (evidence.reservationId !== receipt.reservationId || evidence.callId !== invocation.callId
        || evidence.dispatchToken !== receipt.dispatchToken || evidence.actorId !== before.subject.actorId
        || evidence.scopeKey !== `WORKSPACE:${scopeId}`) throw denied();
      const digest = requestFingerprint({ version: 'ai-gateway-admission-audit-1', scopeId, invocationId: invocation.id, event: entry.event });
      const auditId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
      const data = { id: auditId, tenantId: entry.tenantId, workspaceId: entry.workspaceId,
        userId: before.subject.actorKind === 'USER' ? before.subject.actorId : null, action: entry.event,
        detail: { operator: 'AI Native Gateway', targetType: 'ai_gateway_invocation', targetId: invocation.id,
          detail: 'Admission only; provider dispatch, billing and business success are not attested.',
          metadata: { version: 'ai-gateway-admission-audit-1', status: entry.status, callId: invocation.callId,
            taskId: invocation.taskId, runId: invocation.runId, stepId: invocation.stepId, actionId: invocation.actionId,
            actorKind: before.subject.actorKind, actorId: before.subject.actorId, sceneCode: invocation.sceneCode,
            configurationHash: invocation.configurationHash, priceVersion: invocation.priceVersion,
            reservationId: receipt.reservationId, admissionId: admission.id, requestHash: receipt.requestHash,
            dispatchBindingHash: requestFingerprint(receipt.dispatchToken) } } };
      const check = (row: Prisma.OperationLogGetPayload<{}> | null) => {
        if (!row || row.id !== data.id || row.tenantId !== data.tenantId || row.workspaceId !== data.workspaceId
          || row.userId !== data.userId || row.action !== data.action || requestFingerprint(row.detail) !== requestFingerprint(data.detail)) throw invalid();
      };
      await verifyCurrent();
      try {
        await this.db.$transaction(async tx => {
          const latest = await load(tx);
          if (requestFingerprint(latest) !== requestFingerprint(source)) throw denied();
          const previous = await tx.operationLog.findUnique({ where: { id: auditId } });
          if (previous) { check(previous); return; }
          const now = this.clock();
          if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || latest.receipt.state !== 'reserved'
            || latest.reservation.status !== 'reserved' || latest.reservation.dispatchState !== 'not_dispatched'
            || latest.admission.status !== 'admitted' || latest.admission.revokedAt || latest.admission.completedAt
            || latest.admission.expiresAt <= now) throw denied();
          // The audit is an original admission fact, not dispatch authority.
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
