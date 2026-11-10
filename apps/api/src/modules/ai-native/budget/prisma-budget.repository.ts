import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { AiUsageSettingsDraft } from '@rental-os/shared';
import { BudgetError, type BudgetPolicy, type BudgetPolicyKey, type BudgetQuote, type BudgetRecord, type BudgetReserveCommand, type BudgetTransactionRepository, type BudgetUsageEvidence } from './budget.ports';
import { quantityAtoms, sameUnit } from './budget-quantity';
import { assertPlatformCreditLimit } from './platform-credit-limit';
import { assertByokMeterLimits, byokMeterScene } from './byok-usage-meter';
import { platformCreditScene } from './platform-credit-policy';
import { assertBudgetPolicyBinding } from './budget-policy-binding';
import { assertBudgetSettingsPermit, validateBudgetSettings } from './budget-settings';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import type { BudgetSettingsOperation } from './budget.ports';
import { checkedSettingsOperation, budgetSettingsReceiptSchema, settingsOperationId,
  platformBudgetOperationWhere, platformBudgetReceiptSchema } from './budget-settings-operation';

type Db = Pick<PrismaClient, 'aiScope' | 'aiBudgetPolicy' | 'aiBudgetReservation' | 'aiBudgetLedgerEntry' | 'aiBudgetAllocation' | '$transaction'>
  & Partial<Pick<PrismaClient, 'operationLog' | 'aiModelConfigurationOperation'>>;
type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
type StoredPolicy = { id: string; scopeId: string; scopeKind: string; sceneCode: string; configRevision: number; settingsJson: Prisma.JsonValue };
const scopeKinds = ['PLATFORM', 'TENANT', 'WORKSPACE'] as const;
const policyWhere = (key: BudgetPolicyKey) => ({ scopeId: key.scopeId, scopeKind: key.scopeKind, sceneCode: key.sceneCode });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decimalAtoms = (value: Prisma.Decimal | null) => value === null ? 0n : BigInt(value.toFixed(6).replace('.', ''));
const decimalString = (atoms: bigint) => {
  const raw = atoms.toString().padStart(7, '0');
  return `${raw.slice(0, -6)}.${raw.slice(-6)}`;
};
const policyMeterFields = (settings: AiUsageSettingsDraft) => {
  const quantity = settings.budget.state === 'not_configured' ? undefined : settings.budget.quantity;
  return { unitKind: quantity?.unit ?? 'tokens',
    tokenLimit: quantity?.unit === 'tokens' ? quantityAtoms(quantity) : null,
    callLimit: quantity?.unit === 'calls' ? Number(quantityAtoms(quantity)) : null,
    moneyLimit: quantity?.unit === 'money' ? decimalString(quantityAtoms(quantity)) : null,
    moneyCurrency: quantity?.unit === 'money' ? quantity.currency : null };
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
 * Tenant reserve, original mutation and settings CAS all lock the canonical
 * tenant scope before ordered policies; reverse-order scope waits are forbidden.
 * It is deliberately not registered by AppModule: the composition root must
 * provide an already authorized BudgetAuthority and trusted quote/evidence ports.
 */
export class PrismaBudgetRepository implements BudgetTransactionRepository {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  async settings(key: BudgetPolicyKey) {
    const row = await this.db.aiBudgetPolicy.findUnique({ where: { scopeId_scopeKind_sceneCode: policyWhere(key) }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } });
    return row ? policy(row) : null;
  }

  async saveSettings(key: BudgetPolicyKey, settings: AiUsageSettingsDraft, expectedRevision: number, revalidate: () => Promise<void>, operation?: BudgetSettingsOperation) {
    key = structuredClone(key);
    settings = structuredClone(settings);
    operation = operation && checkedSettingsOperation(operation);
    const original = async (db: Partial<Pick<Prisma.TransactionClient, 'operationLog' | 'aiModelConfigurationOperation'>>) => {
      if (!operation) return null;
      if (operation.kind === 'platform') {
        if (key.scopeKind !== 'PLATFORM' || !db.aiModelConfigurationOperation) throw new BudgetError('UNAVAILABLE');
        return db.aiModelConfigurationOperation.findUnique({ where: {
          scopeId_scopeKind_targetId_operationKey: platformBudgetOperationWhere(key, operation.operationKey) } });
      }
      if (key.scopeKind === 'PLATFORM' || !db.operationLog) throw new BudgetError('UNAVAILABLE');
      return db.operationLog.findUnique({ where: { id: settingsOperationId(key, operation.operationKey) } });
    };
    validateBudgetSettings(settings);
    if (settings.sceneCode !== key.sceneCode) throw new BudgetError('INVALID');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new BudgetError('INVALID');
    await revalidate();
    let callbackCompleted = false;
    try {
      return await this.db.$transaction(async tx => {
        // A policy CAS changes available capacity too. It must not hold the
        // policy write lock while waiting for admission's canonical tenant lock.
        if (settings.scope.kind === 'tenant') await this.lockTenantCapacity(tx, settings.scope.tenantId,
          key.scopeKind === 'TENANT' ? key.scopeId : undefined);
        if (operation) {
          // Any reused key is observation-only, including a lost COMMIT reply.
          // Do not run another CAS or return today's policy as the old result.
          if (await original(tx))
            throw new BudgetError('PENDING_RECONCILIATION');
        }
        const receipt = async (saved: BudgetPolicy) => {
          if (!operation) return;
          if (operation.kind === 'platform') {
            const detail = platformBudgetReceiptSchema.safeParse({ ...operation, version: 'platform-budget-settings-save-1',
              ...policyWhere(key), policyId: saved.id, expectedRevision, savedRevision: saved.revision,
              settingsHash: requestFingerprint(saved.settings) });
            if (!detail.success) throw new BudgetError('INVALID');
            await tx.aiModelConfigurationOperation.create({ data: { id: randomUUID(), ...platformBudgetOperationWhere(key, operation.operationKey),
              actorId: operation.actorId, workspaceId: null, expectedRevision, resultRevision: saved.revision, commandHash: operation.commandHash,
              result: json(detail.data), resultHash: requestFingerprint(detail.data), recordedAt: this.clock() } });
            await revalidate();
            return;
          }
          const detail = budgetSettingsReceiptSchema.safeParse({ ...operation, version: 'budget-settings-save-1',
            ...policyWhere(key), policyId: saved.id, expectedRevision, savedRevision: saved.revision,
            settingsHash: requestFingerprint(saved.settings) });
          if (!detail.success) throw new BudgetError('INVALID');
          await tx.operationLog.create({ data: { id: settingsOperationId(key, operation.operationKey),
            tenantId: operation.tenantId, workspaceId: operation.workspaceId, userId: operation.actorId,
            action: 'ai.budget.settings.saved', detail: json(detail.data), createdAt: this.clock() } });
          await revalidate();
        };
        const where = policyWhere(key);
        if (expectedRevision === 0) {
          const created = await tx.aiBudgetPolicy.create({ data: {
            id: randomUUID(), ...where, configRevision: 1, enabled: policyEnabled(settings), allowedModels: json(settings.allowedModels), allowedScenes: json(settings.allowedScenes), settingsJson: json(settings), ...policyMeterFields(settings),
            maxConcurrent: settings.maxConcurrent, maxCallsPerRun: settings.maxCallsPerRun, priceVersion: undefined
          }, select: { id: true, scopeId: true, scopeKind: true, sceneCode: true, configRevision: true, settingsJson: true } });
          await revalidate();
          const saved = policy(created);
          await receipt(saved);
          callbackCompleted = true;
          return saved;
        }
        const changed = await tx.aiBudgetPolicy.updateMany({ where: { ...where, configRevision: expectedRevision }, data: { configRevision: { increment: 1 }, enabled: policyEnabled(settings), allowedModels: json(settings.allowedModels), allowedScenes: json(settings.allowedScenes), settingsJson: json(settings), ...policyMeterFields(settings), maxConcurrent: settings.maxConcurrent, maxCallsPerRun: settings.maxCallsPerRun, priceVersion: undefined } });
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
        await receipt(saved);
        callbackCompleted = true;
        return saved;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      // Callback completion is not a COMMIT acknowledgement. Never tell a
      // caller to retry an apparently conflicting write after its result was
      // lost; read the same policy/revision first. No transaction retry here.
      if (callbackCompleted) throw new BudgetError('PENDING_RECONCILIATION');
      if (operation && (error instanceof BudgetError && error.code === 'REVISION_CONFLICT'
        || error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        // A competing request with this SAME original key may have committed
        // while our CAS waited. A conflict cannot erase its unknown-save lock.
        try {
          await revalidate();
          const recorded = await original(this.db);
          await revalidate();
          if (recorded) throw new BudgetError('PENDING_RECONCILIATION');
        } catch { throw new BudgetError('PENDING_RECONCILIATION'); }
      }
      if (error instanceof BudgetError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BudgetError('REVISION_CONFLICT');
      throw new BudgetError('PENDING_RECONCILIATION');
    }
  }

  /** Tenant capacity is shared across policy/config versions and units. The
   * canonical row must be locked before any policy read/write in this transaction;
   * resolving it by its stored key avoids a SERIALIZABLE shared-lock upgrade. */
  private async lockTenantCapacity(tx: Tx, tenantId: string, scopeId?: string) {
    if (scopeId) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE id = ${scopeId} FOR UPDATE`);
    } else {
      const { scopeKey } = aiPersistenceScopeColumns({ kind: 'tenant', tenantId });
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ai_scopes WHERE scopeKey = ${scopeKey} AND kind = 'TENANT' FOR UPDATE`);
    }
  }

  private async lockPolicies(tx: Tx, keys: readonly BudgetPolicyKey[]) {
    const ordered = [...keys].sort((a, b) => scopeKinds.indexOf(a.scopeKind) - scopeKinds.indexOf(b.scopeKind) || a.scopeId.localeCompare(b.scopeId) || a.sceneCode.localeCompare(b.sceneCode));
    const rows: StoredPolicy[] = [];
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

  private async assertIntersection(tx: Tx, rows: readonly StoredPolicy[], association: BudgetQuote['association'], sceneCode: string) {
    const required = association.scope.kind === 'workspace' ? scopeKinds : association.scope.kind === 'tenant' ? scopeKinds.slice(0, 2) : scopeKinds.slice(0, 1);
    if (rows.length !== required.length || new Set(rows.map(row => row.id)).size !== rows.length
      || required.some(kind => rows.filter(row => row.scopeKind === kind).length !== 1)) throw new BudgetError('UNAVAILABLE');
    const storedScene = rows[0]?.sceneCode;
    const creditScene = platformCreditScene(sceneCode, association);
    if (association.config.serviceMode === 'platform_managed' && rows.some(row => row.sceneCode === creditScene)) {
      for (const row of rows) {
        if (row.sceneCode !== (row.scopeKind === 'PLATFORM' ? sceneCode : creditScene)) throw new BudgetError('FORBIDDEN');
        await this.assertScopeOwnership(tx, row, association);
      }
      return;
    }
    if (storedScene !== sceneCode && (association.config.serviceMode !== 'tenant_managed'
      || storedScene !== byokMeterScene(sceneCode, association))) throw new BudgetError('FORBIDDEN');
    for (const row of rows) {
      if (row.sceneCode !== storedScene) throw new BudgetError('FORBIDDEN');
      await this.assertScopeOwnership(tx, row, association);
    }
  }

  /** All changes to held/charged capacity take admission's same policy locks.
   * Current gates/revisions only control NEW dispatch; old debt and proven
   * unsent releases must still converge after policies have been changed. */
  private async lockReservationPolicies(tx: Tx, record: BudgetRecord) {
    const links = structuredClone(await tx.aiBudgetAllocation.findMany({ where: { reservationId: record.id },
      select: { policyId: true, policyRevision: true }, take: 4 }));
    if (links.length < 1 || links.length > 3 || new Set(links.map(link => link.policyId)).size !== links.length) throw new BudgetError('UNAVAILABLE');
    const keys: BudgetPolicyKey[] = [];
    for (const link of links) {
      const found = structuredClone(await tx.aiBudgetPolicy.findUnique({ where: { id: link.policyId },
        select: { id: true, scopeId: true, scopeKind: true, sceneCode: true } }));
      if (!found || found.id !== link.policyId || !scopeKinds.includes(found.scopeKind)) throw new BudgetError('UNAVAILABLE');
      keys.push({ scopeId: found.scopeId, scopeKind: found.scopeKind, sceneCode: found.sceneCode });
    }
    const rows = await this.lockPolicies(tx, keys);
    await this.assertIntersection(tx, rows, record.association, record.sceneCode);
    if (rows.some(row => !links.some(link => link.policyId === row.id))) throw new BudgetError('REVISION_CONFLICT');
    return { rows, links };
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
    assertBudgetPolicyBinding(quote, command.sceneCode);
    const consumer = quote.consumerScope;
    const tenantId = quote.association.scope.kind === 'platform' ? null : quote.association.scope.tenantId;
    const workspaceId = quote.association.scope.kind === 'workspace' ? quote.association.scope.workspaceId : null;
    const requestHash = hash({ identityHash, association: quote.association, callId: quote.callId, sceneCode: quote.sceneCode, model: quote.model, actorId: quote.actorId, consumerScope: quote.consumerScope, quantity: quote.quantity, policies: quote.policies, evidenceHash: quote.evidenceHash, expiresAt: quote.expiresAt.toISOString() });
    const assertFresh = () => {
      const now = this.clock();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())
        || !(command.expiresAt instanceof Date) || !(quote.expiresAt instanceof Date)
        || !Number.isFinite(command.expiresAt.getTime()) || !Number.isFinite(quote.expiresAt.getTime())
        || command.expiresAt <= now || quote.expiresAt <= now) throw new BudgetError('UNAVAILABLE');
    };
    let callbackCompleted = false;
    try {
      const result = structuredClone(await this.db.$transaction(async tx => {
        if (tenantId) {
          const tenants = quote.policies.filter(key => key.scopeKind === 'TENANT');
          if (tenants.length !== 1) throw new BudgetError('UNAVAILABLE');
          // Both payment modes and original mutations use the SAME first lock.
          // Scope ownership remains checked below before financial insertion.
          await this.lockTenantCapacity(tx, tenantId, tenants[0].scopeId);
        }
        const rows = await this.lockPolicies(tx, quote.policies);
        if (new Set(quote.policies.map(policy => `${policy.scopeKind}:${policy.scopeId}:${policy.sceneCode}`)).size !== quote.policies.length) throw new BudgetError('INVALID');
        if (!rows.some(row => row.scopeId === consumer.scopeId && row.scopeKind === consumer.scopeKind && row.sceneCode === consumer.sceneCode)) throw new BudgetError('FORBIDDEN');
        await this.assertIntersection(tx, rows, quote.association, command.sceneCode);
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
          callbackCompleted = true;
          return replay;
        }
        const requested = quantityAtoms(quote.quantity);
        if (quote.association.config.serviceMode === 'tenant_managed'
          && rows[0].sceneCode === byokMeterScene(command.sceneCode, quote.association)) {
          const tenant = rows.find(row => row.scopeKind === 'TENANT');
          if (!tenant || !tenantId || quote.quantity.unit !== 'calls' || requested !== 1n) throw new BudgetError('FORBIDDEN');
          // Same-key observation above does not need fresh free capacity. Only
          // a NEW admission checks old calls across config/price/mode versions.
          await assertByokMeterLimits(tx, { tenantScopeId: tenant.scopeId, tenantId,
            sceneCode: command.sceneCode, runId: quote.association.runId });
        }
        if (quote.quantity.unit === 'money' && tenantId) {
          // A tenant-owned provider is usage-only, never platform money billing.
          if (quote.association.config.serviceMode !== 'platform_managed') throw new BudgetError('FORBIDDEN');
          await assertPlatformCreditLimit(tx, tenantId, workspaceId, quote.quantity.currency, quote.quantity.amount);
        }
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
        assertFresh();
        const data = { id: randomUUID(), tenantId, workspaceId, billingMode: quote.association.config.serviceMode, scopeId: consumer.scopeId, scopeKind: consumer.scopeKind, sceneCode: command.sceneCode, actorId: quote.actorId, requestId: quote.association.requestId, runId: quote.association.runId, stepId: quote.association.stepId, actionId: quote.association.actionId, callId: quote.callId, idempotencyKey: quote.association.idempotencyKey, requestHash, configurationHash: requestFingerprint(quote.association.config), configRevision: quote.association.config.configRevision, priceVersion: quote.association.priceVersion, unitKind: quote.quantity.unit, ...quantityFields(quote.quantity, 'reserved'), status: 'reserved', dispatchState: 'not_dispatched', expiresAt: quote.expiresAt };
        const created = await tx.aiBudgetReservation.create({ data, select: { id: true, tenantId: true, workspaceId: true, scopeId: true, scopeKind: true, sceneCode: true, actorId: true, requestId: true, runId: true, stepId: true, actionId: true, callId: true, idempotencyKey: true, configRevision: true, priceVersion: true, unitKind: true, reservedTokens: true, reservedCalls: true, reservedMoney: true, moneyCurrency: true, actualTokens: true, actualCalls: true, actualMoney: true, status: true, dispatchState: true, unknownReason: true, expiresAt: true, updatedAt: true } });
        const record = structuredClone(this.record(created, quote.association));
        await tx.aiBudgetAllocation.createMany({ data: rows.map(row => ({ reservationId: record.id, policyId: row.id, policyRevision: row.configRevision })) });
        await revalidate();
        assertFresh();
        callbackCompleted = true;
        return record;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 }));
      // Revocation after COMMIT cannot undo a possibly durable reservation.
      await revalidate();
      return result;
    } catch (error) {
      if (callbackCompleted) throw new BudgetError('PENDING_RECONCILIATION');
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        // A transaction/commit failure does not prove that no reservation was
        // committed. Never translate it into EXHAUSTED, which would invite a
        // caller to retry a possibly durable reservation.
        if (error instanceof BudgetError) throw error;
        throw new BudgetError('PENDING_RECONCILIATION');
      }
      if (error instanceof BudgetError) throw error;
      await revalidate();
      const existing = structuredClone(await this.db.aiBudgetReservation.findFirst({ where: { scopeId: consumer.scopeId, scopeKind: consumer.scopeKind, idempotencyKey: quote.association.idempotencyKey }, select: { id: true, requestHash: true } }));
      if (existing?.requestHash === requestHash) {
        const replay = structuredClone(await this.get(existing.id, quote.association));
        await revalidate();
        if (replay && replay.actorId === quote.actorId && replay.callId === quote.callId && replay.sceneCode === quote.sceneCode) return replay;
      }
      await revalidate();
      if (existing) throw new BudgetError('IDEMPOTENCY_CONFLICT');
      // A unique-key race whose winner is not visible yet is also ambiguous;
      // do not claim exhaustion or issue a second reservation.
      throw new BudgetError('PENDING_RECONCILIATION');
    }
  }

  private record(row: { id: string; scopeId: string; scopeKind: string; actorId: string; unitKind: string; status: string; dispatchState: string; reservedTokens: bigint | null; reservedCalls: number | null; reservedMoney: Prisma.Decimal | null; moneyCurrency: string | null; actualTokens?: bigint | null; actualCalls?: number | null; actualMoney?: Prisma.Decimal | null; unknownReason: string | null; expiresAt: Date; updatedAt: Date; callId: string; idempotencyKey: string; sceneCode: string; configRevision: number }, association: BudgetRecord['association']): BudgetRecord {
    // Persisted facts must not become zero or a known state through projection.
    // Validate the meter before Decimal.toFixed can round malformed evidence.
    if (!['reserved', 'settled', 'released', 'pending_reconciliation'].includes(row.status)
      || !['not_dispatched', 'dispatched', 'unknown', 'completed'].includes(row.dispatchState)
      || !['PLATFORM', 'TENANT', 'WORKSPACE'].includes(row.scopeKind)
      || !['money', 'tokens', 'calls'].includes(row.unitKind)
      || !(row.updatedAt instanceof Date) || !Number.isFinite(row.updatedAt.getTime())
      || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime())) throw new BudgetError('UNAVAILABLE');
    const reservedValues = [row.reservedTokens, row.reservedCalls, row.reservedMoney];
    const actualValues = [row.actualTokens, row.actualCalls, row.actualMoney];
    const meter = ['tokens', 'calls', 'money'].indexOf(row.unitKind);
    if (reservedValues.some((value, index) => (value !== null && value !== undefined) !== (index === meter))
      || actualValues.some((value, index) => (value !== null && value !== undefined) !== (row.status === 'settled' && index === meter))
      || (row.unitKind === 'money' ? typeof row.moneyCurrency !== 'string' || !/^[A-Z]{3}$/.test(row.moneyCurrency)
        : row.moneyCurrency !== null)) throw new BudgetError('UNAVAILABLE');
    for (const value of [row.reservedMoney, row.actualMoney]) {
      if (value !== null && value !== undefined && (!Prisma.Decimal.isDecimal(value)
        || !value.isFinite() || value.isNegative() || value.decimalPlaces() > 6)) throw new BudgetError('UNAVAILABLE');
    }
    const tokenValue = row.reservedTokens === null ? null : Number(row.reservedTokens);
    if (tokenValue !== null && !Number.isSafeInteger(tokenValue)) throw new BudgetError('UNAVAILABLE');
    const reserved = tokenValue !== null ? { unit: 'tokens' as const, value: tokenValue } : row.reservedCalls !== null ? { unit: 'calls' as const, value: row.reservedCalls } : { unit: 'money' as const, amount: row.reservedMoney!.toFixed(6), currency: row.moneyCurrency!, scale: 6 as const };
    const actualTokenValue = row.actualTokens === undefined || row.actualTokens === null ? null : Number(row.actualTokens);
    if (actualTokenValue !== null && !Number.isSafeInteger(actualTokenValue)) throw new BudgetError('UNAVAILABLE');
    const actual = actualTokenValue !== null ? { unit: 'tokens' as const, value: actualTokenValue } : row.actualCalls !== undefined && row.actualCalls !== null ? { unit: 'calls' as const, value: row.actualCalls } : row.actualMoney ? { unit: 'money' as const, amount: row.actualMoney.toFixed(6), currency: row.moneyCurrency ?? '', scale: 6 as const } : null;
    try { quantityAtoms(reserved); if (actual !== null) quantityAtoms(actual); }
    catch { throw new BudgetError('UNAVAILABLE'); }
    return { id: row.id, scopeId: row.scopeId, scopeKind: row.scopeKind as BudgetRecord['scopeKind'], actorId: row.actorId, revision: row.configRevision, storageVersion: row.updatedAt, association, callId: row.callId, sceneCode: row.sceneCode, status: row.status as BudgetRecord['status'], reserved, actual, dispatched: ['dispatched', 'unknown', 'completed'].includes(row.dispatchState), unknownReason: row.unknownReason, expiresAt: row.expiresAt };
  }

  private async readRecord(db: Pick<Tx, 'aiBudgetReservation'>, id: string, association: BudgetRecord['association']) {
    const row = await db.aiBudgetReservation.findUnique({ where: { id }, select: { id: true, scopeId: true, scopeKind: true, actorId: true, unitKind: true, status: true, dispatchState: true, reservedTokens: true, reservedCalls: true, reservedMoney: true, moneyCurrency: true, actualTokens: true, actualCalls: true, actualMoney: true, unknownReason: true, expiresAt: true, updatedAt: true, callId: true, idempotencyKey: true, sceneCode: true, configRevision: true, configurationHash: true, tenantId: true, workspaceId: true, requestId: true, runId: true, stepId: true, actionId: true, priceVersion: true } });
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

  /** Read the exact original event and payload under current read authority.
   * No policy locks, mutation replay or new ledger event. Missing is not rollback. */
  async readMutation(record: BudgetRecord, input: { action: 'release' | 'reconcile'; eventKey: string; usage?: BudgetUsageEvidence }, revalidate: () => Promise<void>) {
    record = structuredClone(record); input = structuredClone(input);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.eventKey)
      || !['release', 'reconcile'].includes(input.action) || input.action === 'reconcile' && !input.usage
      || input.action === 'release' && input.usage || input.usage && !sameUnit(record.reserved, input.usage.quantity)) throw new BudgetError('INVALID');
    try {
      return await this.db.$transaction(async tx => {
        await revalidate();
        const current = await this.readRecord(tx, record.id, record.association);
        if (!current || current.scopeId !== record.scopeId || current.scopeKind !== record.scopeKind
          || current.actorId !== record.actorId || current.callId !== record.callId) throw new BudgetError('FORBIDDEN');
        const event = await tx.aiBudgetLedgerEntry.findUnique({ where: { reservationId_eventKey: {
          reservationId: record.id, eventKey: input.eventKey } }, select: { scopeId: true, scopeKind: true, tenantId: true,
          kind: true, evidenceHash: true, reason: true, inputTokens: true, calls: true, moneyAmount: true, moneyCurrency: true } });
        if (event && (event.scopeId !== record.scopeId || event.scopeKind !== record.scopeKind
          || event.tenantId !== (record.association.scope.kind === 'platform' ? null : record.association.scope.tenantId)
          || !sameLedgerPayload(event, input) || current.status !== (input.action === 'release' ? 'released' : 'settled')
          || input.action === 'release' && current.dispatched
          || input.usage && requestFingerprint(current.actual) !== requestFingerprint(input.usage.quantity))) throw new BudgetError('PENDING_RECONCILIATION');
        await revalidate();
        return event ? structuredClone(current) : null;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof BudgetError) throw error;
      throw new BudgetError('UNAVAILABLE');
    }
  }

  async mutate(record: BudgetRecord, input: { action: 'dispatch' | 'settle' | 'release' | 'unknown' | 'reconcile'; eventKey: string; usage?: BudgetUsageEvidence; reason?: string }, revalidate: () => Promise<void>) {
    record = structuredClone(record);
    input = structuredClone(input);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.eventKey)) throw new BudgetError('INVALID');
    if (input.usage && !sameUnit(record.reserved, input.usage.quantity)) throw new BudgetError('INVALID');
    if ((input.action === 'settle' || input.action === 'reconcile') && !input.usage) throw new BudgetError('INVALID');
    let callbackCompleted = false;
    try { return await this.db.$transaction(async tx => {
      await revalidate();
      if (record.association.scope.kind !== 'platform')
        await this.lockTenantCapacity(tx, record.association.scope.tenantId);
      const { rows, links } = await this.lockReservationPolicies(tx, record);
      const current = await this.readRecord(tx, record.id, record.association);
      if (!current || current.scopeId !== record.scopeId || current.scopeKind !== record.scopeKind
        || current.actorId !== record.actorId || current.callId !== record.callId || current.sceneCode !== record.sceneCode) throw new BudgetError('FORBIDDEN');
      const existing = await tx.aiBudgetLedgerEntry.findUnique({ where: { reservationId_eventKey: { reservationId: record.id, eventKey: input.eventKey } }, select: { kind: true, evidenceHash: true, reason: true, inputTokens: true, calls: true, moneyAmount: true, moneyCurrency: true } });
      if (existing) {
        if (!sameLedgerPayload(existing, input)) throw new BudgetError('IDEMPOTENCY_CONFLICT');
        const replay = await this.readRecord(tx, record.id, record.association);
        if (!replay) throw new BudgetError('UNAVAILABLE');
        await revalidate();
        callbackCompleted = true;
        return replay;
      }
      // Terminal facts can only be observed through their original event;
      // they cannot acquire a second release or settlement key.
      if (current.status === 'settled' || current.status === 'released'
        || input.action === 'release' && (current.dispatched || current.status !== 'reserved')
        || input.action === 'settle' && current.status === 'pending_reconciliation') throw new BudgetError('PENDING_RECONCILIATION');
      await revalidate();
      if (input.action === 'dispatch') {
        for (const row of rows) {
          if (links.find(link => link.policyId === row.id)?.policyRevision !== row.configRevision) throw new BudgetError('REVISION_CONFLICT');
          assertBudgetSettingsPermit(policy(row).settings, record.association.config.model, record.sceneCode);
        }
        const now = this.clock();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || current.status !== 'reserved' || current.dispatched
          || current.expiresAt <= now) throw new BudgetError('UNAVAILABLE');
      }
      const next = input.action === 'dispatch' ? { status: 'reserved', dispatchState: 'dispatched' } : input.action === 'unknown' ? { status: 'pending_reconciliation', dispatchState: 'unknown', unknownReason: input.reason ?? 'result_unknown' } : input.action === 'release' ? { status: 'released', dispatchState: 'not_dispatched' } : { status: 'settled', dispatchState: 'completed', ...(input.usage ? quantityFields(input.usage.quantity, 'actual') : {}) };
      const changed = await tx.aiBudgetReservation.updateMany({ where: { id: record.id, scopeId: record.scopeId, scopeKind: record.scopeKind, actorId: record.actorId, callId: record.callId,
        configurationHash: requestFingerprint(record.association.config), status: record.status === 'pending_reconciliation' ? 'pending_reconciliation' : 'reserved', updatedAt: record.storageVersion,
        ...(input.action === 'dispatch' ? { dispatchState: 'not_dispatched', expiresAt: { gt: this.clock() } } : {}) }, data: next });
      if (changed.count !== 1) throw new BudgetError('PENDING_RECONCILIATION');
      await tx.aiBudgetLedgerEntry.create({ data: { id: randomUUID(), reservationId: record.id, scopeId: record.scopeId, scopeKind: record.scopeKind, tenantId: record.association.scope.kind === 'platform' ? null : record.association.scope.tenantId, eventKey: input.eventKey, kind: input.action, evidenceHash: input.usage?.evidenceHash, reason: input.reason, ...(input.usage ? ledgerQuantityFields(input.usage.quantity) : {}) } });
      const result = await this.readRecord(tx, record.id, record.association);
      if (!result) throw new BudgetError('FORBIDDEN');
      await revalidate();
      callbackCompleted = true;
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 }); }
    catch (error) {
      // A completed callback is not a COMMIT acknowledgement. This includes
      // exact replay reads; never turn an ambiguous transaction into a retry.
      if (callbackCompleted || !(error instanceof BudgetError)) throw new BudgetError('PENDING_RECONCILIATION');
      throw error;
    }
  }
}
