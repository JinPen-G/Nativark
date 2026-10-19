import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiUsageSettingsDraft } from '@rental-os/shared';
import { BudgetError, type BudgetPolicy, type BudgetPolicyKey, type BudgetQuote, type BudgetRecord, type BudgetReserveCommand, type BudgetTransactionRepository, type BudgetUsageEvidence } from './budget.ports';
import { quantityAtoms, sameUnit } from './budget-quantity';
import { validateBudgetSettings } from './budget-settings';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

type Db = Pick<PrismaClient, 'aiScope' | 'aiBudgetPolicy' | 'aiBudgetReservation' | 'aiBudgetLedgerEntry' | 'aiBudgetAllocation' | '$transaction'>;
type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
const scopeKinds = ['PLATFORM', 'TENANT', 'WORKSPACE'] as const;
const policyWhere = (key: BudgetPolicyKey) => ({ scopeId: key.scopeId, scopeKind: key.scopeKind, sceneCode: key.sceneCode });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decimalAtoms = (value: Prisma.Decimal | null) => value === null ? 0n : BigInt(value.toFixed(6).replace('.', ''));
const decimalString = (atoms: bigint) => {
  const raw = atoms.toString().padStart(7, '0');
  return `${raw.slice(0, -6)}.${raw.slice(-6)}`;
};
const policyEnabled = (settings: AiUsageSettingsDraft) => Object.values(settings.gates).every(gate => gate.enabled)
  && settings.budget.state === 'limited' && settings.maxConcurrent > 0 && settings.maxCallsPerRun > 0
  && settings.allowedModels.length > 0 && settings.allowedScenes.length > 0;

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
  return { [`${prefix}Money`]: decimalString(atoms), moneyCurrency: money.currency };
}
function ledgerQuantityFields(quantity: BudgetUsageEvidence['quantity']) {
  const atoms = quantityAtoms(quantity);
  if (quantity.unit === 'tokens') return { inputTokens: atoms };
  if (quantity.unit === 'calls') return { calls: Number(atoms) };
  return { moneyAmount: decimalString(atoms), moneyCurrency: (quantity as Extract<BudgetUsageEvidence['quantity'], { unit: 'money' }>).currency };
}
function sameLedgerPayload(existing: { kind: string; evidenceHash: string | null; reason: string | null; inputTokens: bigint | null; calls: number | null; moneyAmount: Prisma.Decimal | null; moneyCurrency: string | null }, input: { action: string; usage?: BudgetUsageEvidence; reason?: string }) {
  const incoming = input.usage ? ledgerQuantityFields(input.usage.quantity) : {};
  return existing.kind === input.action && existing.evidenceHash === (input.usage?.evidenceHash ?? null)
    && (existing.reason ?? null) === (input.reason ?? null)
    && (existing.inputTokens ?? null) === ((incoming as { inputTokens?: bigint }).inputTokens ?? null)
    && (existing.calls ?? null) === ((incoming as { calls?: number }).calls ?? null)
    && (existing.moneyAmount?.toFixed(6) ?? null) === ((incoming as { moneyAmount?: string }).moneyAmount ?? null)
    && (existing.moneyCurrency ?? null) === ((incoming as { moneyCurrency?: string }).moneyCurrency ?? null);
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
    key = structuredClone(key);
    settings = structuredClone(settings);
    validateBudgetSettings(settings);
    if (settings.sceneCode !== key.sceneCode) throw new BudgetError('INVALID');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new BudgetError('INVALID');
    await revalidate();
    let callbackCompleted = false;
    try {
      return await this.db.$transaction(async tx => {
        const where = policyWhere(key);
        if (expectedRevision === 0) {
          const created = await tx.aiBudgetPolicy.create({ data: {
            id: randomUUID(), ...where, configRevision: 1, enabled: policyEnabled(settings), allowedModels: json(settings.allowedModels), allowedScenes: json(settings.allowedScenes), settingsJson: json(settings), unitKind: settings.budget.state === 'limited' ? settings.budget.quantity.unit : 'tokens',
            maxConcurrent: settings.maxConcurrent, maxCallsPerRun: settings.maxCallsPerRun, priceVersion: undefined
          }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } });
          await revalidate();
          const saved = policy(created);
          callbackCompleted = true;
          return saved;
        }
        const changed = await tx.aiBudgetPolicy.updateMany({ where: { ...where, configRevision: expectedRevision }, data: { configRevision: { increment: 1 }, enabled: policyEnabled(settings), allowedModels: json(settings.allowedModels), allowedScenes: json(settings.allowedScenes), settingsJson: json(settings), unitKind: settings.budget.state === 'limited' ? settings.budget.quantity.unit : 'tokens', maxConcurrent: settings.maxConcurrent, maxCallsPerRun: settings.maxCallsPerRun, priceVersion: undefined } });
        if (changed.count !== 1) throw new BudgetError('REVISION_CONFLICT');
        await revalidate();
        const next = await tx.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: where }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } });
        if (!next) throw new BudgetError('UNAVAILABLE');
        if (settings.budget.state === 'limited') {
          const meter = settings.budget.quantity;
          // The successful CAS holds this policy's write lock until COMMIT;
          // admission takes that same lock before inserting allocations.
          // Meter bindings are immutable and released reservations cannot be
          // reopened. Do not reinterpret an old unresolved/charged meter as
          // zero, even after a disabled/not-configured intermediate policy.
          const incompatible = await tx.aiBudgetAllocation.findFirst({ where: { policyId: next.id,
            reservation: { status: { in: ['reserved', 'pending_reconciliation', 'settled'] }, OR: [
              { unitKind: { not: meter.unit } },
              ...(meter.unit === 'money' ? [{ moneyCurrency: { not: meter.currency } }, { moneyCurrency: null }] : [])
            ] } }, select: { reservationId: true } });
          if (incompatible) throw new BudgetError('REVISION_CONFLICT');
        }
        await revalidate();
        const saved = policy(next);
        callbackCompleted = true;
        return saved;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      // Callback completion is not a COMMIT acknowledgement. Never tell a
      // caller to retry an apparently conflicting write after its result was
      // lost; read the same policy/revision first. No transaction retry here.
      if (callbackCompleted) throw new BudgetError('PENDING_RECONCILIATION');
      if (error instanceof BudgetError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BudgetError('REVISION_CONFLICT');
      throw new BudgetError('PENDING_RECONCILIATION');
    }
  }

  private async lockPolicies(tx: Tx, keys: readonly BudgetPolicyKey[]) {
    const ordered = [...keys].sort((a, b) => scopeKinds.indexOf(a.scopeKind) - scopeKinds.indexOf(b.scopeKind) || a.scopeId.localeCompare(b.scopeId) || a.sceneCode.localeCompare(b.sceneCode));
    const rows = [] as Array<{ id: string; scopeId: string; scopeKind: string; sceneCode: string; configRevision: number; settingsJson: Prisma.JsonValue }>;
    for (const key of ordered) {
      const found = structuredClone(await tx.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: policyWhere(key) }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } }));
      if (!found) throw new BudgetError('UNAVAILABLE');
      // Locking the policy row is explicit and database-side; a stale update
      // cannot pass if another transaction changed its revision.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_budget_policies WHERE id = ${found.id} FOR UPDATE`);
      const locked = structuredClone(await tx.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: policyWhere(key) }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } }));
      if (!locked) throw new BudgetError('UNAVAILABLE');
      if (locked.id !== found.id || Object.entries(policyWhere(key)).some(([field, expected]) => locked[field as keyof typeof locked] !== expected))
        throw new BudgetError('REVISION_CONFLICT');
      rows.push(locked);
    }
    return rows;
  }

  private async assertScopeOwnership(tx: Tx, row: { scopeId: string; scopeKind: string }, association: BudgetQuote['association']) {
    const scope = await tx.aiScope.findUnique({ where: { id: row.scopeId }, select: { id: true, kind: true, tenantId: true, workspaceId: true } });
    if (!scope || scope.kind !== row.scopeKind) throw new BudgetError('FORBIDDEN');
    if (row.scopeKind === 'PLATFORM') return;
    if (association.scope.kind === 'platform') throw new BudgetError('FORBIDDEN');
    if (scope.tenantId !== association.scope.tenantId) throw new BudgetError('FORBIDDEN');
    if (row.scopeKind === 'WORKSPACE' && (association.scope.kind !== 'workspace' || scope.workspaceId !== association.scope.workspaceId)) throw new BudgetError('FORBIDDEN');
  }

  /** Read aggregate rows, never the policy's entire reservation history. The
   * allocation join charges each consumer once to every intersected policy.
   * Expired and unknown holds remain active; TTL is not non-consumption proof.
   * Caller already holds the same fixed-order policy locks as reserve(). */
  private async consumption(tx: Tx, policyId: string, quantity: BudgetQuote['quantity'], runId: string) {
    const where: Prisma.AiBudgetReservationWhereInput = { allocations: { some: { policyId } },
      status: { in: ['reserved', 'pending_reconciliation', 'settled'] } };
    const groups = await tx.aiBudgetReservation.groupBy({ by: ['status', 'unitKind', 'moneyCurrency'], where,
      orderBy: [{ status: 'asc' }, { unitKind: 'asc' }, { moneyCurrency: 'asc' }], take: 4,
      _count: { _all: true, reservedTokens: true, reservedCalls: true, reservedMoney: true,
        actualTokens: true, actualCalls: true, actualMoney: true },
      _sum: { reservedTokens: true, reservedCalls: true, reservedMoney: true,
        actualTokens: true, actualCalls: true, actualMoney: true } });
    if (!Array.isArray(groups) || groups.length > 3) throw new BudgetError('UNAVAILABLE');
    let used = 0n, concurrent = 0n;
    const seen = new Set<string>();
    for (const group of groups) {
      if (!['reserved', 'pending_reconciliation', 'settled'].includes(group.status) || seen.has(group.status)
        || !Number.isSafeInteger(group._count._all) || group._count._all < 1) throw new BudgetError('UNAVAILABLE');
      seen.add(group.status);
      if (group.unitKind !== quantity.unit || (quantity.unit === 'money'
        ? group.moneyCurrency !== quantity.currency : group.moneyCurrency !== null)) throw new BudgetError('EXHAUSTED');
      const field = `${group.status === 'settled' ? 'actual' : 'reserved'}${quantity.unit === 'tokens' ? 'Tokens' : quantity.unit === 'calls' ? 'Calls' : 'Money'}` as
        'reservedTokens' | 'reservedCalls' | 'reservedMoney' | 'actualTokens' | 'actualCalls' | 'actualMoney';
      const sum = group._sum[field];
      // SQL SUM ignores NULL. Missing stored usage must not silently become 0.
      if (group._count[field] !== group._count._all || sum === null) throw new BudgetError('UNAVAILABLE');
      let atoms: bigint;
      if (quantity.unit === 'money') {
        if (!(sum instanceof Prisma.Decimal) || !sum.isFinite() || sum.isNegative() || sum.decimalPlaces() > 6) throw new BudgetError('UNAVAILABLE');
        atoms = decimalAtoms(sum);
      } else if (quantity.unit === 'tokens') {
        if (typeof sum !== 'bigint' || sum < 0n) throw new BudgetError('UNAVAILABLE');
        atoms = sum;
      } else {
        if (typeof sum !== 'number' || !Number.isSafeInteger(sum) || sum < 0) throw new BudgetError('UNAVAILABLE');
        atoms = BigInt(sum);
      }
      used += atoms;
      if (group.status !== 'settled') concurrent += BigInt(group._count._all);
    }
    const runCalls = await tx.aiBudgetReservation.count({ where: { ...where, runId } });
    if (!Number.isSafeInteger(runCalls) || runCalls < 0) throw new BudgetError('UNAVAILABLE');
    return { used, concurrent, runCalls: BigInt(runCalls) };
  }

  async reserve(quote: BudgetQuote, command: BudgetReserveCommand, identityHash: string, revalidate: () => Promise<void>) {
    quote = structuredClone(quote);
    command = structuredClone(command);
    quantityAtoms(quote.quantity);
    const consumer = quote.consumerScope;
    const tenantId = quote.association.scope.kind === 'platform' ? null : quote.association.scope.tenantId;
    const workspaceId = quote.association.scope.kind === 'workspace' ? quote.association.scope.workspaceId : null;
    const requestHash = hash({ identityHash, association: quote.association, callId: quote.callId, sceneCode: quote.sceneCode, model: quote.model, actorId: quote.actorId, consumerScope: quote.consumerScope, quantity: quote.quantity, policies: quote.policies, evidenceHash: quote.evidenceHash, expiresAt: quote.expiresAt.toISOString() });
    try {
      return await this.db.$transaction(async tx => {
        const rows = await this.lockPolicies(tx, quote.policies);
        if (rows.some(row => row.sceneCode !== command.sceneCode)) throw new BudgetError('EXHAUSTED');
        if (new Set(quote.policies.map(policy => `${policy.scopeKind}:${policy.scopeId}:${policy.sceneCode}`)).size !== quote.policies.length) throw new BudgetError('INVALID');
        if (!rows.some(row => row.scopeId === consumer.scopeId && row.scopeKind === consumer.scopeKind && row.sceneCode === command.sceneCode)) throw new BudgetError('FORBIDDEN');
        for (const row of rows) await this.assertScopeOwnership(tx, row, quote.association);
        // Exact retries observe the original reservation BEFORE checking free
        // capacity: the first successful request may have taken the final unit.
        // This is not a new reservation, lease, dispatch grant or retry of usage.
        const existing = structuredClone(await tx.aiBudgetReservation.findUnique({ where: { scopeId_scopeKind_idempotencyKey: {
          scopeId: consumer.scopeId, scopeKind: consumer.scopeKind, idempotencyKey: quote.association.idempotencyKey
        } }, select: { id: true, requestHash: true } }));
        if (existing) {
          if (existing.requestHash !== requestHash) throw new BudgetError('IDEMPOTENCY_CONFLICT');
          const links = await tx.aiBudgetAllocation.findMany({ where: { reservationId: existing.id },
            select: { policyId: true }, take: 4 });
          if (links.length !== rows.length || new Set(links.map(link => link.policyId)).size !== rows.length
            || links.some(link => !rows.some(row => row.id === link.policyId))) throw new BudgetError('PENDING_RECONCILIATION');
          const replay = structuredClone(await this.readRecord(tx, existing.id, quote.association));
          if (!replay || replay.actorId !== quote.actorId || replay.callId !== quote.callId || replay.sceneCode !== quote.sceneCode) throw new BudgetError('IDEMPOTENCY_CONFLICT');
          await revalidate();
          return replay;
        }
        const requested = quantityAtoms(quote.quantity);
        for (const row of rows) {
          const settings = policy(row).settings;
          if (!settings.gates.platform.enabled || !settings.gates.tenant.enabled || !settings.gates.scene.enabled || settings.budget.state !== 'limited' || settings.maxConcurrent < 1 || settings.maxCallsPerRun < 1 || !settings.allowedModels.includes(quote.model) || !settings.allowedScenes.includes(command.sceneCode)) throw new BudgetError('EXHAUSTED');
          if (settings.budget.quantity.unit !== quote.quantity.unit || (settings.budget.quantity.unit === 'money' && quote.quantity.unit === 'money' && settings.budget.quantity.currency !== quote.quantity.currency)) throw new BudgetError('EXHAUSTED');
          const limit = quantityAtoms(settings.budget.quantity);
          const usage = await this.consumption(tx, row.id, quote.quantity, quote.association.runId);
          if (usage.concurrent >= BigInt(settings.maxConcurrent) || usage.runCalls >= BigInt(settings.maxCallsPerRun)
            || usage.used + requested > limit) throw new BudgetError('EXHAUSTED');
        }
        await revalidate();
        const data = { id: randomUUID(), tenantId, workspaceId, scopeId: consumer.scopeId, scopeKind: consumer.scopeKind, sceneCode: command.sceneCode, actorId: quote.actorId, requestId: quote.association.requestId, runId: quote.association.runId, stepId: quote.association.stepId, actionId: quote.association.actionId, callId: quote.callId, idempotencyKey: quote.association.idempotencyKey, requestHash, configurationHash: requestFingerprint(quote.association.config), configRevision: quote.association.config.configRevision, priceVersion: quote.association.priceVersion, unitKind: quote.quantity.unit, ...quantityFields(quote.quantity, 'reserved'), status: 'reserved', dispatchState: 'not_dispatched', expiresAt: quote.expiresAt };
        const created = await tx.aiBudgetReservation.create({ data, select: { id: true, tenantId: true, workspaceId: true, scopeId: true, scopeKind: true, sceneCode: true, actorId: true, requestId: true, runId: true, stepId: true, actionId: true, callId: true, idempotencyKey: true, configRevision: true, priceVersion: true, unitKind: true, reservedTokens: true, reservedCalls: true, reservedMoney: true, moneyCurrency: true, actualTokens: true, actualCalls: true, actualMoney: true, status: true, dispatchState: true, unknownReason: true, expiresAt: true, updatedAt: true } });
        await tx.aiBudgetAllocation.createMany({ data: rows.map(row => ({ reservationId: created.id, policyId: row.id, policyRevision: row.configRevision })) });
        return this.record(created, quote.association);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        // A transaction/commit failure does not prove that no reservation was
        // committed. Never translate it into EXHAUSTED, which would invite a
        // caller to retry a possibly durable reservation.
        if (error instanceof BudgetError) throw error;
        throw new BudgetError('PENDING_RECONCILIATION');
      }
      if (error instanceof BudgetError) throw error;
      const existing = await this.db.aiBudgetReservation.findFirst({ where: { scopeId: consumer.scopeId, scopeKind: consumer.scopeKind, idempotencyKey: quote.association.idempotencyKey }, select: { id: true, requestHash: true } });
      if (existing?.requestHash === requestHash) {
        const replay = await this.get(existing.id, quote.association);
        if (replay) return replay;
      }
      if (existing) throw new BudgetError('IDEMPOTENCY_CONFLICT');
      // A unique-key race whose winner is not visible yet is also ambiguous;
      // do not claim exhaustion or issue a second reservation.
      throw new BudgetError('PENDING_RECONCILIATION');
    }
  }

  private record(row: { id: string; scopeId: string; scopeKind: string; actorId: string; status: string; dispatchState: string; reservedTokens: bigint | null; reservedCalls: number | null; reservedMoney: Prisma.Decimal | null; moneyCurrency: string | null; actualTokens?: bigint | null; actualCalls?: number | null; actualMoney?: Prisma.Decimal | null; unknownReason: string | null; expiresAt: Date; updatedAt: Date; callId: string; idempotencyKey: string; sceneCode: string; configRevision: number }, association: BudgetRecord['association']): BudgetRecord {
    const tokenValue = row.reservedTokens === null ? null : Number(row.reservedTokens);
    if (tokenValue !== null && !Number.isSafeInteger(tokenValue)) throw new BudgetError('UNAVAILABLE');
    const reserved = tokenValue !== null ? { unit: 'tokens' as const, value: tokenValue } : row.reservedCalls !== null ? { unit: 'calls' as const, value: row.reservedCalls } : { unit: 'money' as const, amount: row.reservedMoney?.toFixed(6) ?? '0.000000', currency: row.moneyCurrency ?? '', scale: 6 as const };
    const actualTokenValue = row.actualTokens === undefined || row.actualTokens === null ? null : Number(row.actualTokens);
    if (actualTokenValue !== null && !Number.isSafeInteger(actualTokenValue)) throw new BudgetError('UNAVAILABLE');
    const actual = actualTokenValue !== null ? { unit: 'tokens' as const, value: actualTokenValue } : row.actualCalls !== undefined && row.actualCalls !== null ? { unit: 'calls' as const, value: row.actualCalls } : row.actualMoney ? { unit: 'money' as const, amount: row.actualMoney.toFixed(6), currency: row.moneyCurrency ?? '', scale: 6 as const } : null;
    return { id: row.id, scopeId: row.scopeId, scopeKind: row.scopeKind as BudgetRecord['scopeKind'], actorId: row.actorId, revision: row.configRevision, storageVersion: row.updatedAt, association, callId: row.callId, sceneCode: row.sceneCode, status: row.status === 'settled' ? 'settled' : row.status === 'released' ? 'released' : row.status === 'pending_reconciliation' ? 'pending_reconciliation' : 'reserved', reserved, actual, dispatched: ['dispatched', 'unknown', 'completed'].includes(row.dispatchState), unknownReason: row.unknownReason, expiresAt: row.expiresAt };
  }

  private async readRecord(db: Pick<Tx, 'aiBudgetReservation'>, id: string, association: BudgetRecord['association']) {
    const row = await db.aiBudgetReservation.findUnique({ where: { id }, select: { id: true, scopeId: true, scopeKind: true, actorId: true, status: true, dispatchState: true, reservedTokens: true, reservedCalls: true, reservedMoney: true, moneyCurrency: true, actualTokens: true, actualCalls: true, actualMoney: true, unknownReason: true, expiresAt: true, updatedAt: true, callId: true, idempotencyKey: true, sceneCode: true, configRevision: true, configurationHash: true, tenantId: true, workspaceId: true, requestId: true, runId: true, stepId: true, actionId: true, priceVersion: true } });
    if (!row || row.scopeKind !== association.scope.kind.toUpperCase() || !row.configurationHash
      || row.configurationHash !== requestFingerprint(association.config)
      || row.requestId !== association.requestId || row.runId !== association.runId || row.stepId !== association.stepId || row.actionId !== association.actionId
      || row.idempotencyKey !== association.idempotencyKey || row.priceVersion !== association.priceVersion || row.configRevision !== association.config.configRevision
      || (association.scope.kind !== 'platform' && row.tenantId !== association.scope.tenantId)
      || (association.scope.kind === 'workspace' && row.workspaceId !== association.scope.workspaceId)) return null;
    return this.record(row, association);
  }

  async get(id: string, association: BudgetRecord['association']) {
    return this.readRecord(this.db, id, structuredClone(association));
  }

  async mutate(record: BudgetRecord, input: { action: 'dispatch' | 'settle' | 'release' | 'unknown' | 'reconcile'; eventKey: string; usage?: BudgetUsageEvidence; reason?: string }, revalidate: () => Promise<void>) {
    record = structuredClone(record);
    input = structuredClone(input);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.eventKey)) throw new BudgetError('INVALID');
    if (input.usage && !sameUnit(record.reserved, input.usage.quantity)) throw new BudgetError('INVALID');
    if ((input.action === 'settle' || input.action === 'reconcile') && !input.usage) throw new BudgetError('INVALID');
    return this.db.$transaction(async tx => {
      await revalidate();
      const current = await this.readRecord(tx, record.id, record.association);
      if (!current || current.scopeId !== record.scopeId || current.scopeKind !== record.scopeKind
        || current.actorId !== record.actorId || current.callId !== record.callId || current.sceneCode !== record.sceneCode) throw new BudgetError('FORBIDDEN');
      const existing = await tx.aiBudgetLedgerEntry.findUnique({ where: { reservationId_eventKey: { reservationId: record.id, eventKey: input.eventKey } }, select: { kind: true, evidenceHash: true, reason: true, inputTokens: true, calls: true, moneyAmount: true, moneyCurrency: true } });
      if (existing) {
        if (!sameLedgerPayload(existing, input)) throw new BudgetError('IDEMPOTENCY_CONFLICT');
        const replay = await this.readRecord(tx, record.id, record.association);
        if (!replay) throw new BudgetError('UNAVAILABLE');
        return replay;
      }
      await revalidate();
      const next = input.action === 'dispatch' ? { status: 'reserved', dispatchState: 'dispatched' } : input.action === 'unknown' ? { status: 'pending_reconciliation', dispatchState: 'unknown', unknownReason: input.reason ?? 'result_unknown' } : input.action === 'release' ? { status: 'released', dispatchState: 'not_dispatched' } : { status: 'settled', dispatchState: 'completed', ...(input.usage ? quantityFields(input.usage.quantity, 'actual') : {}) };
      const changed = await tx.aiBudgetReservation.updateMany({ where: { id: record.id, scopeId: record.scopeId, scopeKind: record.scopeKind, actorId: record.actorId, callId: record.callId,
        configurationHash: requestFingerprint(record.association.config), status: record.status === 'pending_reconciliation' ? 'pending_reconciliation' : 'reserved', updatedAt: record.storageVersion }, data: next });
      if (changed.count !== 1) throw new BudgetError('PENDING_RECONCILIATION');
      await tx.aiBudgetLedgerEntry.create({ data: { id: randomUUID(), reservationId: record.id, scopeId: record.scopeId, scopeKind: record.scopeKind, tenantId: record.association.scope.kind === 'platform' ? null : record.association.scope.tenantId, eventKey: input.eventKey, kind: input.action, evidenceHash: input.usage?.evidenceHash, reason: input.reason, ...(input.usage ? ledgerQuantityFields(input.usage.quantity) : {}) } });
      const result = await this.readRecord(tx, record.id, record.association);
      if (!result) throw new BudgetError('FORBIDDEN');
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
  }
}
