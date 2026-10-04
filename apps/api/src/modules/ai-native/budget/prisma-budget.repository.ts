import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiUsageSettingsDraft } from '@rental-os/shared';
import { BudgetError, type BudgetPolicy, type BudgetPolicyKey, type BudgetQuote, type BudgetRecord, type BudgetReserveCommand, type BudgetTransactionRepository, type BudgetUsageEvidence } from './budget.ports';
import { quantityAtoms } from './budget-quantity';
import { validateBudgetSettings } from './budget-settings';

type Db = Pick<PrismaClient, 'aiBudgetPolicy' | 'aiBudgetReservation' | 'aiBudgetLedgerEntry' | 'aiBudgetAllocation' | '$transaction'>;
type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
const scopeKinds = ['PLATFORM', 'TENANT', 'WORKSPACE'] as const;
const policyWhere = (key: BudgetPolicyKey) => ({ scopeId: key.scopeId, scopeKind: key.scopeKind, sceneCode: key.sceneCode });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rowScope = (value: BudgetPolicyKey) => ({ scopeId: value.scopeId, scopeKind: value.scopeKind });

function policy(row: { id: string; scopeId: string; scopeKind: string; sceneCode: string; configRevision: number; settingsJson: Prisma.JsonValue }): BudgetPolicy {
  if (!scopeKinds.includes(row.scopeKind as typeof scopeKinds[number])) throw new BudgetError('UNAVAILABLE');
  const settings = JSON.parse(JSON.stringify(row.settingsJson)) as AiUsageSettingsDraft;
  validateBudgetSettings(settings);
  return { id: row.id, scopeId: row.scopeId, scopeKind: row.scopeKind as BudgetPolicyKey['scopeKind'], sceneCode: row.sceneCode, revision: row.configRevision, settings };
}

function quantityFields(quantity: BudgetUsageEvidence['quantity'], prefix: 'reserved' | 'actual') {
  const atoms = quantityAtoms(quantity);
  if (quantity.unit === 'tokens') return { [`${prefix}Tokens`]: atoms };
  if (quantity.unit === 'calls') return { [`${prefix}Calls`]: Number(atoms) };
  const money = quantity as Extract<BudgetUsageEvidence['quantity'], { unit: 'money' }>;
  return { [`${prefix}Money`]: (Number(atoms) / 1_000_000).toFixed(6), moneyCurrency: money.currency };
}

/** Prisma adapter for C01. Policy rows are locked in PLATFORM→TENANT→WORKSPACE
 * order; all reservation and ledger writes share one serializable transaction.
 * It is deliberately not registered by AppModule: the composition root must
 * provide an already authorized BudgetAuthority and trusted quote/evidence ports.
 */
export class PrismaBudgetRepository implements BudgetTransactionRepository {
  constructor(private readonly db: Db) {}

  async settings(key: BudgetPolicyKey) {
    const row = await this.db.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: policyWhere(key) }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } });
    return row ? policy(row) : null;
  }

  async saveSettings(key: BudgetPolicyKey, settings: AiUsageSettingsDraft, expectedRevision: number, revalidate: () => Promise<void>) {
    validateBudgetSettings(settings);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new BudgetError('INVALID');
    await revalidate();
    try {
      return await this.db.$transaction(async tx => {
        const where = policyWhere(key);
        if (expectedRevision === 0) {
          const created = await tx.aiBudgetPolicy.create({ data: {
            id: randomUUID(), ...where, configRevision: 1, enabled: false, allowedModels: json(settings.allowedModels), allowedScenes: json(settings.allowedScenes), settingsJson: json(settings), unitKind: settings.budget.state === 'limited' ? settings.budget.quantity.unit : 'tokens',
            maxConcurrent: settings.maxConcurrent, maxCallsPerRun: settings.maxCallsPerRun, priceVersion: undefined
          }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } });
          await revalidate(); return policy(created);
        }
        const changed = await tx.aiBudgetPolicy.updateMany({ where: { ...where, configRevision: expectedRevision }, data: { configRevision: { increment: 1 }, enabled: false, allowedModels: json(settings.allowedModels), allowedScenes: json(settings.allowedScenes), settingsJson: json(settings), unitKind: settings.budget.state === 'limited' ? settings.budget.quantity.unit : 'tokens', maxConcurrent: settings.maxConcurrent, maxCallsPerRun: settings.maxCallsPerRun, priceVersion: undefined } });
        if (changed.count !== 1) throw new BudgetError('REVISION_CONFLICT');
        await revalidate();
        const next = await tx.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: where }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } });
        if (!next) throw new BudgetError('UNAVAILABLE');
        return policy(next);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) { if (error instanceof BudgetError) throw error; throw new BudgetError('REVISION_CONFLICT'); }
  }

  private async lockPolicies(tx: Tx, keys: readonly BudgetPolicyKey[]) {
    const ordered = [...keys].sort((a, b) => scopeKinds.indexOf(a.scopeKind) - scopeKinds.indexOf(b.scopeKind) || a.scopeId.localeCompare(b.scopeId));
    const rows = [] as Array<{ id: string; scopeId: string; scopeKind: string; sceneCode: string; configRevision: number; settingsJson: Prisma.JsonValue }>;
    for (const key of ordered) {
      const found = await tx.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: policyWhere(key) }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } });
      if (!found) throw new BudgetError('UNAVAILABLE');
      // Locking the policy row is explicit and database-side; a stale update
      // cannot pass if another transaction changed its revision.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_budget_policies WHERE id = ${found.id} FOR UPDATE`);
      rows.push(found);
    }
    return rows;
  }

  async reserve(quote: BudgetQuote, command: BudgetReserveCommand, identityHash: string, revalidate: () => Promise<void>) {
    const consumer = quote.consumerScope;
    const tenantId = quote.association.scope.kind === 'platform' ? null : quote.association.scope.tenantId;
    const workspaceId = quote.association.scope.kind === 'workspace' ? quote.association.scope.workspaceId : null;
    const requestHash = hash({ identityHash, association: quote.association, callId: quote.callId, quantity: quote.quantity, policies: quote.policies, evidenceHash: quote.evidenceHash });
    try {
      return await this.db.$transaction(async tx => {
        const rows = await this.lockPolicies(tx, quote.policies);
        const active = await tx.aiBudgetReservation.findMany({ where: { scopeId: consumer.scopeId, scopeKind: consumer.scopeKind, sceneCode: command.sceneCode, status: { in: ['reserved', 'pending_reconciliation'] } }, select: { reservedTokens: true, reservedCalls: true, reservedMoney: true, moneyCurrency: true, runId: true } });
        const requested = quantityAtoms(quote.quantity);
        for (const row of rows) {
          const settings = policy(row).settings;
          if (!settings.gates.platform.enabled || !settings.gates.tenant.enabled || !settings.gates.scene.enabled || settings.budget.state !== 'limited' || settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !settings.allowedModels.includes(quote.model) || !settings.allowedScenes.includes(command.sceneCode)) throw new BudgetError('EXHAUSTED');
          const concurrent = active.length;
          if (concurrent >= settings.maxConcurrent || active.filter(item => item.runId === quote.association.runId).length >= settings.maxCallsPerRun) throw new BudgetError('EXHAUSTED');
          const limit = quantityAtoms(settings.budget.quantity);
          const used = settings.budget.quantity.unit === 'tokens' ? active.reduce((sum, item) => sum + (item.reservedTokens ?? 0n), 0n) : settings.budget.quantity.unit === 'calls' ? BigInt(active.reduce((sum, item) => sum + (item.reservedCalls ?? 0), 0)) : active.reduce((sum, item) => sum + BigInt(Math.round(Number(item.reservedMoney ?? 0) * 1_000_000)), 0n);
          if (used + requested > limit) throw new BudgetError('EXHAUSTED');
        }
        await revalidate();
        const data = { id: randomUUID(), tenantId, workspaceId, scopeId: consumer.scopeId, scopeKind: consumer.scopeKind, sceneCode: command.sceneCode, actorId: quote.association.scope.kind === 'platform' ? 'platform' : (quote.association.scope.kind === 'tenant' ? quote.association.scope.tenantId : quote.association.scope.workspaceId), requestId: quote.association.requestId, runId: quote.association.runId, stepId: quote.association.stepId, actionId: quote.association.actionId, callId: quote.callId, idempotencyKey: quote.association.idempotencyKey, requestHash, configRevision: quote.association.config.configRevision, priceVersion: quote.association.priceVersion, unitKind: quote.quantity.unit, ...quantityFields(quote.quantity, 'reserved'), status: 'reserved', dispatchState: 'not_dispatched', expiresAt: quote.expiresAt };
        const created = await tx.aiBudgetReservation.create({ data, select: { id: true, tenantId: true, workspaceId: true, scopeId: true, scopeKind: true, sceneCode: true, actorId: true, requestId: true, runId: true, stepId: true, actionId: true, callId: true, idempotencyKey: true, configRevision: true, priceVersion: true, unitKind: true, reservedTokens: true, reservedCalls: true, reservedMoney: true, moneyCurrency: true, actualTokens: true, actualCalls: true, actualMoney: true, status: true, dispatchState: true, unknownReason: true, expiresAt: true, updatedAt: true } });
        await tx.aiBudgetAllocation.createMany({ data: rows.map(row => ({ reservationId: created.id, policyId: row.id, policyRevision: row.configRevision })) });
        return this.record(created, quote.association);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof BudgetError) throw error;
      const existing = await this.db.aiBudgetReservation.findFirst({ where: { scopeId: consumer.scopeId, scopeKind: consumer.scopeKind, idempotencyKey: quote.association.idempotencyKey }, select: { requestHash: true } });
      if (existing?.requestHash === requestHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
      throw new BudgetError('EXHAUSTED');
    }
  }

  private record(row: { id: string; scopeId: string; scopeKind: string; status: string; dispatchState: string; reservedTokens: bigint | null; reservedCalls: number | null; reservedMoney: Prisma.Decimal | null; moneyCurrency: string | null; actualTokens?: bigint | null; actualCalls?: number | null; actualMoney?: Prisma.Decimal | null; unknownReason: string | null; expiresAt: Date; updatedAt: Date; callId: string; idempotencyKey: string; sceneCode: string; configRevision: number }, association: BudgetRecord['association']): BudgetRecord {
    const tokenValue = row.reservedTokens === null ? null : Number(row.reservedTokens);
    if (tokenValue !== null && !Number.isSafeInteger(tokenValue)) throw new BudgetError('UNAVAILABLE');
    const reserved = tokenValue !== null ? { unit: 'tokens' as const, value: tokenValue } : row.reservedCalls !== null ? { unit: 'calls' as const, value: row.reservedCalls } : { unit: 'money' as const, amount: row.reservedMoney?.toFixed(6) ?? '0.000000', currency: row.moneyCurrency ?? '', scale: 6 as const };
    const actualTokenValue = row.actualTokens === undefined || row.actualTokens === null ? null : Number(row.actualTokens);
    if (actualTokenValue !== null && !Number.isSafeInteger(actualTokenValue)) throw new BudgetError('UNAVAILABLE');
    const actual = actualTokenValue !== null ? { unit: 'tokens' as const, value: actualTokenValue } : row.actualCalls !== undefined && row.actualCalls !== null ? { unit: 'calls' as const, value: row.actualCalls } : row.actualMoney ? { unit: 'money' as const, amount: row.actualMoney.toFixed(6), currency: row.moneyCurrency ?? '', scale: 6 as const } : null;
    return { id: row.id, scopeId: row.scopeId, scopeKind: row.scopeKind as BudgetRecord['scopeKind'], revision: row.configRevision, storageVersion: row.updatedAt, association, callId: row.callId, sceneCode: row.sceneCode, status: row.status === 'settled' ? 'settled' : row.status === 'released' ? 'released' : row.status === 'pending_reconciliation' ? 'pending_reconciliation' : 'reserved', reserved, actual, dispatched: row.dispatchState === 'dispatched' || row.dispatchState === 'unknown', unknownReason: row.unknownReason, expiresAt: row.expiresAt };
  }

  async get(id: string, association: BudgetRecord['association']) {
    const row = await this.db.aiBudgetReservation.findUnique({ where: { id }, select: { id: true, scopeId: true, scopeKind: true, status: true, dispatchState: true, reservedTokens: true, reservedCalls: true, reservedMoney: true, moneyCurrency: true, actualTokens: true, actualCalls: true, actualMoney: true, unknownReason: true, expiresAt: true, updatedAt: true, callId: true, idempotencyKey: true, sceneCode: true, configRevision: true, tenantId: true, workspaceId: true } });
    if (!row || (association.scope.kind !== 'platform' && row.tenantId !== association.scope.tenantId) || (association.scope.kind === 'workspace' && row.workspaceId !== association.scope.workspaceId)) return null;
    return this.record(row, association);
  }

  async mutate(record: BudgetRecord, input: { action: 'dispatch' | 'settle' | 'release' | 'unknown' | 'reconcile'; eventKey: string; usage?: BudgetUsageEvidence; reason?: string }, revalidate: () => Promise<void>) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.eventKey)) throw new BudgetError('INVALID');
    return this.db.$transaction(async tx => {
      const existing = await tx.aiBudgetLedgerEntry.findUnique({ where: { reservationId_eventKey: { reservationId: record.id, eventKey: input.eventKey } }, select: { kind: true, evidenceHash: true } });
      if (existing) return record;
      await revalidate();
      const next = input.action === 'dispatch' ? { status: 'reserved', dispatchState: 'dispatched' } : input.action === 'unknown' ? { status: 'pending_reconciliation', dispatchState: 'unknown', unknownReason: input.reason ?? 'result_unknown' } : input.action === 'release' ? { status: 'released', dispatchState: 'not_dispatched' } : { status: 'settled', dispatchState: 'completed', ...(input.usage ? quantityFields(input.usage.quantity, 'actual') : {}) };
      const changed = await tx.aiBudgetReservation.updateMany({ where: { id: record.id, status: record.status === 'pending_reconciliation' ? 'pending_reconciliation' : 'reserved', updatedAt: record.storageVersion }, data: next });
      if (changed.count !== 1) throw new BudgetError('PENDING_RECONCILIATION');
      if (input.action !== 'dispatch') await tx.aiBudgetLedgerEntry.create({ data: { id: randomUUID(), reservationId: record.id, scopeId: record.scopeId, scopeKind: record.scopeKind, tenantId: record.association.scope.kind === 'platform' ? null : record.association.scope.tenantId, eventKey: input.eventKey, kind: input.action, evidenceHash: input.usage?.evidenceHash, ...(input.usage ? quantityFields(input.usage.quantity, 'actual') : {}) } });
      return this.get(record.id, record.association) as Promise<BudgetRecord>;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
}
