import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AiUsageQuantityDraft } from '@rental-os/shared';
import type { AiScopeRepository } from '../ai-scope.repository';
import type { GatewayAccountingCall } from '../gateway-accounting.ports';
import { dispatchBindingSchema } from '../invocation-dispatch.service';
import { isGatewayConfig } from '../gateway-contract-validation';
import type { ModelUsage } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { BudgetError, type BudgetRecord } from './budget.ports';
import type { BudgetGatewayBindingSource } from './budget-gateway-adapter';
import type { BudgetEvidenceBinding, PersistedBudgetEvidenceSource } from './budget-dependency-adapters';
import { PrismaBudgetRepository } from './prisma-budget.repository';
import { quantityAtoms, sameUnit } from './budget-quantity';

type Db = ConstructorParameters<typeof PrismaBudgetRepository>[0] & Pick<PrismaClient, 'aiGatewayAccountingReceipt' | 'aiGatewayInvocation' | 'aiInvocationAdmission' | 'aiTask' | 'aiRun'>;
type Reader = Omit<Db, '$transaction'>;
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const callSchema = z.object({ context: z.object({ tenantId: id, workspaceId: id, actorId: id }).strict(), binding: dispatchBindingSchema,
  request: z.object({ callId: id.max(128), model: z.string().min(1).max(256), maxOutputTokens: z.number().int().min(1).max(32768), intentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), expiresAt: z.date() }).strict();
const usageSchema = z.object({ inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
export interface GatewayActualUsagePricing {
  quantity(record: Readonly<BudgetRecord>, usage: Readonly<ModelUsage>): Promise<AiUsageQuantityDraft>;
}
export interface GatewayAccountingFacts {
  assertClaim(call: GatewayAccountingCall): Promise<void>;
  link(call: GatewayAccountingCall, reservationId: string): Promise<void>;
  dispatch(call: GatewayAccountingCall, reservationId: string): Promise<void>;
  cancelIfUnsent(call: GatewayAccountingCall, reservationId: string): Promise<boolean>;
  recordUsage(call: GatewayAccountingCall, reservationId: string, usage: ModelUsage): Promise<string>;
}
export function checkedAccountingCall(value: GatewayAccountingCall): GatewayAccountingCall {
  const parsed = callSchema.safeParse(structuredClone(value));
  if (!parsed.success) throw new BudgetError('INVALID');
  const call = parsed.data, binding = call.binding;
  if (binding.scope.kind !== 'WORKSPACE' || call.context.actorId !== binding.actorId || call.context.tenantId !== binding.scope.tenantId
    || call.context.workspaceId !== binding.scope.workspaceId || call.request.callId !== binding.callId || !binding.profileId) throw new BudgetError('FORBIDDEN');
  return call;
}

export class PrismaGatewayAccountingFacts implements GatewayAccountingFacts, PersistedBudgetEvidenceSource {
  constructor(private readonly db: Db, private readonly bindings: BudgetGatewayBindingSource,
    private readonly scopes: Pick<AiScopeRepository, 'resolveCurrent'>, private readonly pricing: GatewayActualUsagePricing,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof bindings?.resolveForReserve !== 'function' || typeof bindings?.resolveForReservation !== 'function'
      || typeof scopes?.resolveCurrent !== 'function' || typeof pricing?.quantity !== 'function') throw new BudgetError('UNAVAILABLE');
  }
  private async current(reservationId: string) {
    const resolved = structuredClone(await this.scopes.resolveCurrent());
    if (resolved.context.actor.kind !== 'user' || resolved.context.scope.kind !== 'workspace') throw new BudgetError('FORBIDDEN');
    const context = { actorId: resolved.context.actor.userId, tenantId: resolved.context.scope.tenantId, workspaceId: resolved.context.scope.workspaceId };
    return { context, binding: structuredClone(await this.bindings.resolveForReservation(structuredClone(context), reservationId)) };
  }
  private async admission(db: Reader, call: GatewayAccountingCall, active: boolean) {
    const b = call.binding;
    const row = await db.aiInvocationAdmission.findFirst({ where: { id: b.id, actorId: b.actorId, tenantId: call.context.tenantId, workspaceId: call.context.workspaceId,
      callId: b.callId, requestHash: b.requestHash, profileId: b.profileId, dispatchId: b.dispatchId } });
    if (!row || (active && (row.status !== 'admitted' || row.revokedAt || row.completedAt || row.expiresAt <= this.clock()))) throw new BudgetError('PENDING_RECONCILIATION');
    return row;
  }
  async assertClaim(value: GatewayAccountingCall) {
    const call = checkedAccountingCall(value);
    const binding = await this.bindings.resolveForReserve(call.context, call.request);
    if (binding.association.config.configId !== call.binding.profileId) throw new BudgetError('FORBIDDEN');
    await this.admission(this.db, call, true);
  }
  private async rows(db: Reader, reservationId: string) {
    const receipt = await db.aiGatewayAccountingReceipt.findUnique({ where: { reservationId } });
    if (!receipt) throw new BudgetError('PENDING_RECONCILIATION');
    const [invocation, reservation, admission] = await Promise.all([
      db.aiGatewayInvocation.findUnique({ where: { id: receipt.invocationId } }),
      db.aiBudgetReservation.findUnique({ where: { id: reservationId } }),
      db.aiInvocationAdmission.findUnique({ where: { id: receipt.admissionId } })
    ]);
    if (!invocation || !reservation || !admission || !isGatewayConfig(invocation.configuration)
      || !['reserved', 'dispatched', 'cancelled'].includes(receipt.state) || receipt.scopeKind !== 'WORKSPACE'
      || receipt.scopeId !== invocation.scopeId || receipt.scopeId !== reservation.scopeId || receipt.scopeKind !== reservation.scopeKind
      || receipt.taskId !== invocation.taskId || receipt.tenantId !== reservation.tenantId || receipt.workspaceId !== reservation.workspaceId
      || receipt.tenantId !== admission.tenantId || receipt.workspaceId !== admission.workspaceId
      || receipt.dispatchToken !== admission.dispatchId || receipt.requestHash !== admission.requestHash
      || admission.profileId !== invocation.configuration.configId || admission.actorId !== invocation.actorId || admission.actorId !== reservation.actorId
      || admission.callId !== invocation.callId || invocation.callId !== reservation.callId || invocation.callId !== reservation.requestId
      || invocation.callId !== reservation.idempotencyKey || invocation.runId !== reservation.runId || invocation.stepId !== reservation.stepId
      || invocation.actionId !== reservation.actionId || invocation.sceneCode !== reservation.sceneCode || invocation.priceVersion !== reservation.priceVersion
      || invocation.configuration.configRevision !== reservation.configRevision || invocation.configurationHash !== reservation.configurationHash
      || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw new BudgetError('FORBIDDEN');
    return { receipt, invocation, reservation, admission };
  }
  private matchCall(rows: Awaited<ReturnType<PrismaGatewayAccountingFacts['rows']>>, call: GatewayAccountingCall) {
    const { receipt, invocation, admission } = rows;
    if (receipt.admissionId !== call.binding.id || receipt.dispatchToken !== call.binding.dispatchId || receipt.requestHash !== call.binding.requestHash
      || receipt.scopeId !== call.binding.scope.id || receipt.tenantId !== call.context.tenantId || receipt.workspaceId !== call.context.workspaceId
      || admission.actorId !== call.context.actorId || admission.profileId !== call.binding.profileId || invocation.callId !== call.request.callId
      || invocation.intentHash !== call.request.intentHash || invocation.maxOutputTokens !== call.request.maxOutputTokens
      || !isGatewayConfig(invocation.configuration) || invocation.configuration.model !== call.request.model) throw new BudgetError('FORBIDDEN');
  }
  async link(value: GatewayAccountingCall, reservationId: string) {
    const call = checkedAccountingCall(value);
    await this.bindings.resolveForReservation(call.context, reservationId);
    await this.db.$transaction(async tx => {
      await this.admission(tx, call, true);
      const invocation = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: { scopeId: call.binding.scope.id, callId: call.request.callId } } });
      if (!invocation || invocation.intentHash !== call.request.intentHash) throw new BudgetError('FORBIDDEN');
      const existing = await tx.aiGatewayAccountingReceipt.findUnique({ where: { reservationId } });
      if (!existing) await tx.aiGatewayAccountingReceipt.create({ data: { scopeId: invocation.scopeId, scopeKind: 'WORKSPACE', taskId: invocation.taskId,
        tenantId: call.context.tenantId, workspaceId: call.context.workspaceId, invocationId: invocation.id, reservationId,
        admissionId: call.binding.id, dispatchToken: call.binding.dispatchId, requestHash: call.binding.requestHash, state: 'reserved' } });
      const rows = await this.rows(tx, reservationId); this.matchCall(rows, call);
      if (rows.receipt.state !== 'reserved') throw new BudgetError('PENDING_RECONCILIATION');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
  async dispatch(value: GatewayAccountingCall, reservationId: string) {
    const call = checkedAccountingCall(value);
    await this.assertClaim(call);
    await this.db.$transaction(async tx => {
      const rows = await this.rows(tx, reservationId); this.matchCall(rows, call);
      const task = await tx.aiTask.findFirst({ where: { id: rows.invocation.taskId, scopeId: rows.invocation.scopeId, ownerId: call.context.actorId, ownerKind: 'USER', status: 'RUNNING', cancelRequestedAt: null, archivedAt: null } });
      const run = await tx.aiRun.findFirst({ where: { id: rows.invocation.runId, taskId: rows.invocation.taskId, scopeId: rows.invocation.scopeId,
        status: 'RUNNING', actorId: call.context.actorId, actorKind: 'USER', leaseOwnerId: rows.invocation.leaseOwnerId, fencingToken: rows.invocation.fencingToken, leaseExpiresAt: { gt: this.clock() } } });
      if (!task || !run || rows.invocation.expiresAt <= this.clock()) throw new BudgetError('FORBIDDEN');
      await this.admission(tx, call, true);
      if (rows.reservation.status !== 'reserved' || rows.reservation.dispatchState !== 'dispatched') throw new BudgetError('PENDING_RECONCILIATION');
      const changed = await tx.aiGatewayAccountingReceipt.updateMany({ where: { id: rows.receipt.id, state: 'reserved', dispatchToken: call.binding.dispatchId }, data: { state: 'dispatched' } });
      if (changed.count !== 1) throw new BudgetError('PENDING_RECONCILIATION');
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
  async cancelIfUnsent(value: GatewayAccountingCall, reservationId: string) {
    const call = checkedAccountingCall(value);
    await this.bindings.resolveForReservation(call.context, reservationId);
    return this.db.$transaction(async tx => {
      const rows = await this.rows(tx, reservationId); this.matchCall(rows, call);
      if (rows.receipt.state === 'cancelled') return true;
      if (rows.receipt.state !== 'reserved') return false;
      const changed = await tx.aiGatewayAccountingReceipt.updateMany({ where: { id: rows.receipt.id, state: 'reserved', dispatchToken: call.binding.dispatchId }, data: { state: 'cancelled' } });
      if (changed.count !== 1) throw new BudgetError('PENDING_RECONCILIATION');
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
  private usageHash(receipt: { id: string; invocationId: string; admissionId: string; reservationId: string; dispatchToken: string; requestHash: string }, usage: ModelUsage) {
    return requestFingerprint({ receiptId: receipt.id, invocationId: receipt.invocationId, admissionId: receipt.admissionId, reservationId: receipt.reservationId,
      dispatchToken: receipt.dispatchToken, requestHash: receipt.requestHash, usage });
  }
  async recordUsage(value: GatewayAccountingCall, reservationId: string, input: ModelUsage) {
    const call = checkedAccountingCall(value), usage = usageSchema.parse(structuredClone(input));
    await this.bindings.resolveForReservation(call.context, reservationId);
    return this.db.$transaction(async tx => {
      const rows = await this.rows(tx, reservationId); this.matchCall(rows, call);
      if (rows.receipt.state !== 'dispatched') throw new BudgetError('PENDING_RECONCILIATION');
      const usageHash = this.usageHash(rows.receipt, usage);
      if (rows.receipt.usageHash !== null) {
        if (rows.receipt.usageHash !== usageHash || rows.receipt.inputTokens !== BigInt(usage.inputTokens) || rows.receipt.outputTokens !== BigInt(usage.outputTokens)) throw new BudgetError('IDEMPOTENCY_CONFLICT');
        return rows.receipt.id;
      }
      const changed = await tx.aiGatewayAccountingReceipt.updateMany({ where: { id: rows.receipt.id, state: 'dispatched', usageHash: null, inputTokens: null, outputTokens: null },
        data: { inputTokens: BigInt(usage.inputTokens), outputTokens: BigInt(usage.outputTokens), usageHash } });
      if (changed.count !== 1) throw new BudgetError('PENDING_RECONCILIATION');
      return rows.receipt.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
  private evidenceBinding(rows: Awaited<ReturnType<PrismaGatewayAccountingFacts['rows']>>): BudgetEvidenceBinding {
    const { receipt, invocation, reservation } = rows;
    return { reservationId: receipt.reservationId, requestId: invocation.callId, runId: invocation.runId, stepId: invocation.stepId, actionId: invocation.actionId,
      callId: invocation.callId, actorId: invocation.actorId, scopeKey: `${reservation.scopeKind}:${reservation.scopeId}`, configRevision: reservation.configRevision,
      configurationHash: invocation.configurationHash, priceVersion: invocation.priceVersion };
  }
  private evidenceFingerprint(rows: Awaited<ReturnType<PrismaGatewayAccountingFacts['rows']>>) {
    const { receipt, invocation, admission } = rows;
    return requestFingerprint({ binding: this.evidenceBinding(rows), receiptId: receipt.id,
      invocationId: receipt.invocationId, admissionId: receipt.admissionId, state: receipt.state,
      dispatchToken: receipt.dispatchToken, requestHash: receipt.requestHash, usageHash: receipt.usageHash,
      inputTokens: receipt.inputTokens?.toString() ?? null, outputTokens: receipt.outputTokens?.toString() ?? null,
      intentHash: invocation.intentHash, model: invocation.configuration, maxOutputTokens: invocation.maxOutputTokens,
      actorId: admission.actorId, profileId: admission.profileId });
  }
  private async revalidateCurrent(reservationId: string, initial: Awaited<ReturnType<PrismaGatewayAccountingFacts['current']>>) {
    const current = await this.current(reservationId);
    if (requestFingerprint({ context: current.context, binding: current.binding })
      !== requestFingerprint({ context: initial.context, binding: initial.binding })) throw new BudgetError('FORBIDDEN');
  }
  async readDispatch(reservationId: string) {
    const initial = await this.current(reservationId);
    const rows = await this.rows(this.db, reservationId);
    await this.revalidateCurrent(reservationId, initial);
    const state = rows.receipt.state === 'cancelled' ? 'not_dispatched' : rows.receipt.state === 'dispatched' ? 'dispatched' : 'unknown';
    return { ...this.evidenceBinding(rows), state, dispatchToken: state === 'not_dispatched' ? null : rows.receipt.dispatchToken } as const;
  }
  async readUsage(reservationId: string, evidenceRef: string, _reconcile: boolean) {
    const initial = await this.current(reservationId), { binding } = initial;
    const rows = await this.rows(this.db, reservationId), receipt = rows.receipt;
    if (receipt.id !== evidenceRef || receipt.state !== 'dispatched' || receipt.inputTokens === null || receipt.outputTokens === null || !receipt.usageHash) throw new BudgetError('PENDING_RECONCILIATION');
    const usage = usageSchema.parse({ inputTokens: Number(receipt.inputTokens), outputTokens: Number(receipt.outputTokens) });
    if (this.usageHash(receipt, usage) !== receipt.usageHash) throw new BudgetError('FORBIDDEN');
    const record = await new PrismaBudgetRepository(this.db).get(reservationId, binding.association);
    if (!record) throw new BudgetError('FORBIDDEN');
    const quantity = structuredClone(await this.pricing.quantity(structuredClone(record), structuredClone(usage)));
    quantityAtoms(quantity);
    if (!sameUnit(record.reserved, quantity)) throw new BudgetError('FORBIDDEN');
    if (quantity.unit === 'tokens' && BigInt(quantity.value) !== receipt.inputTokens + receipt.outputTokens) throw new BudgetError('FORBIDDEN');
    if (quantity.unit === 'calls' && quantity.value !== 1) throw new BudgetError('FORBIDDEN');
    const current = await this.rows(this.db, reservationId);
    if (this.evidenceFingerprint(current) !== this.evidenceFingerprint(rows)) throw new BudgetError('PENDING_RECONCILIATION');
    await this.revalidateCurrent(reservationId, initial);
    return { ...this.evidenceBinding(rows), ...usage, quantity, dispatchToken: receipt.dispatchToken,
      evidenceHash: requestFingerprint({ usageHash: receipt.usageHash, priceVersion: record.association.priceVersion, quantity }) };
  }
}
