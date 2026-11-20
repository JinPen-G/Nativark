import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma } from '@prisma/client';
import type { AiUsageAssociationDraft, AiUsageQuantityDraft } from '@rental-os/shared';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { isGatewayConfig } from '../gateway-contract-validation';
import { BudgetError, type BudgetPolicy, type BudgetPolicyKey } from './budget.ports';
import { quantityAtoms } from './budget-quantity';

/** Checks the original monetary ledger inside the caller's budget transaction.
 * The canonical capacity and ordered policy locks must already be held. This
 * read grants no execution, changes no accounting, and never repairs an origin.
 * Every Run shares its original Task limit; expiry does not release a hold.
 */
type Tx = Prisma.TransactionClient;
type Money = Extract<AiUsageQuantityDraft, { unit: 'money' }>;
interface TaskMoneyInput {
  association: AiUsageAssociationDraft;
  actorId: string;
  sceneCode: string;
  consumerScope: BudgetPolicyKey;
  quantity: Money;
  policies: readonly BudgetPolicy[];
  phase: 'reserve' | 'dispatch';
}

// Aliases r/a are fixed in both queries. Ledger events are tested with EXISTS,
// not joined: repeated history must not multiply monetary reservations.
const terminalCount = prismaRuntime.sql`(SELECT COUNT(*) FROM ai_budget_ledger_entries e
  WHERE e.reservationId = r.id AND BINARY e.kind IN ('settle', 'reconcile', 'release')) = 1`;
const settledProof = prismaRuntime.sql`${terminalCount} AND (a.id IS NULL OR BINARY a.state = 'dispatched')
  AND EXISTS (SELECT 1 FROM ai_budget_ledger_entries e WHERE e.reservationId = r.id
    AND BINARY e.scopeId = BINARY r.scopeId AND BINARY e.scopeKind = BINARY r.scopeKind
    AND (BINARY e.tenantId <=> BINARY r.tenantId)
    AND BINARY e.kind IN ('settle', 'reconcile') AND e.moneyAmount = r.actualMoney
    AND BINARY e.moneyCurrency = BINARY r.moneyCurrency
    AND e.inputTokens IS NULL AND e.outputTokens IS NULL AND e.calls IS NULL
    AND e.evidenceHash REGEXP '^[a-f0-9]{64}$'
    AND BINARY e.evidenceHash = BINARY LOWER(e.evidenceHash))`;
const releasedProof = prismaRuntime.sql`${terminalCount}
  AND BINARY r.dispatchState = 'not_dispatched' AND r.actualMoney IS NULL
  AND (a.id IS NULL OR BINARY a.state = 'cancelled')
  AND EXISTS (SELECT 1 FROM ai_budget_ledger_entries e WHERE e.reservationId = r.id
    AND BINARY e.scopeId = BINARY r.scopeId AND BINARY e.scopeKind = BINARY r.scopeKind
    AND (BINARY e.tenantId <=> BINARY r.tenantId) AND BINARY e.kind = 'release'
    AND e.inputTokens IS NULL AND e.outputTokens IS NULL AND e.calls IS NULL
    AND e.moneyAmount IS NULL AND e.moneyCurrency IS NULL
    AND e.evidenceHash IS NULL AND e.reason IS NULL)
  AND NOT EXISTS (SELECT 1 FROM ai_budget_ledger_entries e WHERE e.reservationId = r.id
    AND BINARY e.kind IN ('dispatch', 'unknown', 'settle', 'reconcile'))`;
const moneyCandidate = prismaRuntime.sql`(BINARY r.unitKind = 'money' OR r.reservedMoney IS NOT NULL
  OR r.actualMoney IS NOT NULL OR r.moneyCurrency IS NOT NULL
  OR r.unitKind IS NULL OR BINARY r.unitKind NOT IN ('tokens', 'calls', 'money'))`;

function count(value: unknown): bigint {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  if (prismaRuntime.Decimal.isDecimal(value) && value.isFinite() && value.isInteger() && !value.isNegative())
    return BigInt(value.toFixed(0));
  throw new BudgetError('UNAVAILABLE');
}
function singleRow(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value) || value.length !== 1 || !value[0] || typeof value[0] !== 'object')
    throw new BudgetError('UNAVAILABLE');
  return value[0] as Record<string, unknown>;
}
function moneyAtoms(value: unknown): bigint {
  if (!prismaRuntime.Decimal.isDecimal(value) || !value.isFinite() || value.isNegative() || value.decimalPlaces() > 6)
    throw new BudgetError('UNAVAILABLE');
  // SUM may exceed one DECIMAL(24,6) row. Keep the wide aggregate exact rather
  // than rounding/casting it down or interpreting missing money as zero.
  return BigInt(value.toFixed(6).replace('.', ''));
}
function limits(input: TaskMoneyInput): bigint[] {
  const ordinary = input.policies.filter(policy => policy.sceneCode === input.sceneCode);
  const platform = ordinary.filter(policy => policy.scopeKind === 'PLATFORM');
  if (platform.length !== 1 || platform[0].settings.maxMoneyPerTask === undefined)
    throw new BudgetError('UNAVAILABLE');
  const result: bigint[] = [];
  for (const policy of ordinary) {
    const cap = policy.settings.maxMoneyPerTask;
    if (cap === undefined) continue;
    if (cap.unit !== 'money' || cap.currency !== input.quantity.currency) throw new BudgetError('UNAVAILABLE');
    let atoms: bigint;
    try { atoms = quantityAtoms(cap); } catch { throw new BudgetError('UNAVAILABLE'); }
    if (atoms === 0n) throw new BudgetError('EXHAUSTED');
    result.push(atoms);
  }
  // platform-credit:* settings are internal allowance intersections. Neither
  // their large total budget nor a private-namespace cap is a SaaS Task limit.
  return result;
}
async function target(tx: Tx, input: TaskMoneyInput) {
  if (typeof tx?.$queryRaw !== 'function') throw new BudgetError('UNAVAILABLE');
  for (const name of ['aiScope', 'aiRun', 'aiTask', 'aiGatewayInvocation', 'aiBudgetReservation',
    'aiGatewayAccountingReceipt', 'aiBudgetLedgerEntry'] as const) {
    if (typeof tx[name]?.findFirst !== 'function' || typeof tx[name]?.findUnique !== 'function')
      throw new BudgetError('UNAVAILABLE');
  }
  const { association, consumerScope, actorId, sceneCode } = input;
  const scope = await tx.aiScope.findUnique({ where: { id: consumerScope.scopeId },
    select: { id: true, kind: true, tenantId: true, workspaceId: true } });
  const tenantId = association.scope.kind === 'platform' ? null : association.scope.tenantId;
  const workspaceId = association.scope.kind === 'workspace' ? association.scope.workspaceId : null;
  if (!scope || scope.id !== consumerScope.scopeId || scope.kind !== consumerScope.scopeKind
    || scope.kind !== association.scope.kind.toUpperCase() || scope.tenantId !== tenantId || scope.workspaceId !== workspaceId
    || association.config.serviceMode !== 'platform_managed') throw new BudgetError('FORBIDDEN');
  const invocation = await tx.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
    scopeId: scope.id, callId: association.requestId } }, select: { id: true, scopeId: true, taskId: true,
      runId: true, stepId: true, actionId: true, actorId: true, callId: true, sceneCode: true,
      configuration: true, configurationHash: true, priceVersion: true } });
  if (!invocation || invocation.scopeId !== scope.id || invocation.actorId !== actorId
    || invocation.callId !== association.requestId || invocation.callId !== association.idempotencyKey
    || invocation.runId !== association.runId || invocation.stepId !== association.stepId
    || invocation.actionId !== association.actionId || invocation.sceneCode !== sceneCode
    || invocation.priceVersion !== association.priceVersion || !isGatewayConfig(invocation.configuration)
    || requestFingerprint(invocation.configuration) !== invocation.configurationHash
    || requestFingerprint(association.config) !== invocation.configurationHash) throw new BudgetError('FORBIDDEN');
  const run = await tx.aiRun.findFirst({ where: { id: invocation.runId, scopeId: scope.id, taskId: invocation.taskId },
    select: { id: true, scopeId: true, taskId: true, actorId: true, actorKind: true } });
  const task = await tx.aiTask.findFirst({ where: { id: invocation.taskId, scopeId: scope.id },
    select: { id: true, scopeId: true, scopeKind: true, ownerId: true, ownerKind: true, sceneCode: true } });
  if (!run || !task || run.id !== association.runId || run.scopeId !== scope.id || run.taskId !== task.id
    || task.scopeId !== scope.id || task.scopeKind !== scope.kind || task.ownerId !== actorId
    || run.actorId !== actorId || run.actorKind !== task.ownerKind || task.sceneCode !== sceneCode)
    throw new BudgetError('FORBIDDEN');
  return { scopeId: scope.id, scopeKind: scope.kind, tenantId, workspaceId, taskId: task.id };
}

export async function assertTaskMoneyLimit(tx: Tx, value: TaskMoneyInput): Promise<void> {
  const input = structuredClone(value);
  if (input.quantity.unit !== 'money' || !['reserve', 'dispatch'].includes(input.phase)) throw new BudgetError('INVALID');
  const requested = quantityAtoms(input.quantity), caps = limits(input), bound = await target(tx, input);
  // Start with scope and every surviving original anchor, not an INNER JOIN or
  // actor/Task filter: damaged rows would otherwise disappear before counting.
  const integrity = singleRow(await tx.$queryRaw(prismaRuntime.sql`/* task_money_origin */
    SELECT CAST(COUNT(*) AS CHAR) AS joinedRows, CAST(COUNT(DISTINCT r.id) AS CHAR) AS reservationRows,
      CAST(COALESCE(SUM(CASE WHEN
        BINARY r.scopeId = BINARY ${bound.scopeId} AND BINARY r.scopeKind = BINARY ${bound.scopeKind}
        AND (BINARY r.tenantId <=> BINARY ${bound.tenantId}) AND (BINARY r.workspaceId <=> BINARY ${bound.workspaceId})
        AND u.id IS NOT NULL AND t.id IS NOT NULL AND g.id IS NOT NULL
        AND BINARY u.scopeId = BINARY r.scopeId AND BINARY t.scopeId = BINARY r.scopeId
        AND BINARY t.scopeKind = BINARY r.scopeKind AND BINARY g.scopeId = BINARY r.scopeId
        AND BINARY u.taskId = BINARY t.id AND BINARY g.taskId = BINARY t.id
        AND BINARY g.runId = BINARY r.runId AND BINARY g.stepId = BINARY r.stepId
        AND BINARY g.actionId = BINARY r.actionId AND BINARY g.sceneCode = BINARY r.sceneCode
        AND BINARY t.sceneCode = BINARY r.sceneCode
        AND BINARY r.actorId = BINARY u.actorId AND BINARY r.actorId = BINARY t.ownerId
        AND BINARY r.actorId = BINARY g.actorId AND BINARY u.actorKind = BINARY t.ownerKind
        AND BINARY r.requestId = BINARY g.callId AND BINARY r.idempotencyKey = BINARY g.callId
        AND BINARY r.configurationHash = BINARY g.configurationHash AND BINARY r.priceVersion = BINARY g.priceVersion
        AND JSON_TYPE(JSON_EXTRACT(g.configuration, '$.configRevision')) = 'INTEGER'
        AND r.configRevision > 0 AND r.configRevision = CAST(JSON_UNQUOTE(JSON_EXTRACT(g.configuration, '$.configRevision')) AS UNSIGNED)
        AND JSON_UNQUOTE(JSON_EXTRACT(g.configuration, '$.serviceMode')) = 'platform_managed'
        AND BINARY r.billingMode IN ('platform_managed', 'legacy_unknown')
        AND (a.id IS NULL OR (BINARY a.scopeId = BINARY r.scopeId AND BINARY a.scopeKind = BINARY r.scopeKind
          AND BINARY a.taskId = BINARY t.id AND BINARY a.invocationId = BINARY g.id
          AND (BINARY a.tenantId <=> BINARY r.tenantId) AND (BINARY a.workspaceId <=> BINARY r.workspaceId)
          AND BINARY a.state IN ('reserved', 'dispatched', 'cancelled')))
        AND BINARY r.unitKind = 'money' AND r.reservedMoney IS NOT NULL AND r.reservedMoney >= 0
        AND r.reservedTokens IS NULL AND r.reservedCalls IS NULL AND r.actualTokens IS NULL AND r.actualCalls IS NULL
        AND r.moneyCurrency REGEXP '^[A-Z]{3}$' AND BINARY r.moneyCurrency = BINARY UPPER(r.moneyCurrency)
        AND ((BINARY r.status = 'reserved' AND BINARY r.dispatchState IN ('not_dispatched', 'dispatched') AND r.actualMoney IS NULL)
          OR (BINARY r.status = 'pending_reconciliation' AND BINARY r.dispatchState = 'unknown' AND r.actualMoney IS NULL)
          OR (BINARY r.status = 'settled' AND BINARY r.dispatchState = 'completed' AND r.actualMoney IS NOT NULL
            AND r.actualMoney >= 0 AND ${settledProof})
          OR (BINARY r.status = 'released' AND ${releasedProof}))
        THEN 0 ELSE 1 END), 0) AS CHAR) AS badRows
    FROM ai_budget_reservations r
    LEFT JOIN ai_runs u ON u.id = r.runId
    LEFT JOIN ai_tasks t ON t.id = u.taskId
    LEFT JOIN ai_gateway_invocations g ON g.scopeId = r.scopeId AND g.callId = r.callId
    LEFT JOIN ai_gateway_accounting_receipts a ON a.reservationId = r.id
    WHERE ${moneyCandidate} AND (r.scopeId = ${bound.scopeId} OR u.scopeId = ${bound.scopeId}
      OR t.scopeId = ${bound.scopeId} OR g.scopeId = ${bound.scopeId} OR a.scopeId = ${bound.scopeId}
      OR (${bound.scopeKind} = 'WORKSPACE' AND r.tenantId = ${bound.tenantId} AND r.workspaceId = ${bound.workspaceId}))`));
  if (count(integrity.joinedRows) !== count(integrity.reservationRows) || count(integrity.badRows) !== 0n)
    throw new BudgetError('UNAVAILABLE');

  // A proven release contributes neither money nor currency to consumption.
  // Keep its original scope and release proof in the integrity check above.
  const aggregate = singleRow(await tx.$queryRaw(prismaRuntime.sql`/* task_money_sum */
    WITH original_money AS (
      SELECT r.moneyCurrency, CASE
        WHEN BINARY r.status = 'settled' AND ${settledProof} THEN r.actualMoney
        WHEN BINARY r.status IN ('reserved', 'pending_reconciliation') THEN r.reservedMoney
        ELSE NULL END AS amount
      FROM ai_budget_reservations r JOIN ai_runs u ON u.id = r.runId
      LEFT JOIN ai_gateway_accounting_receipts a ON a.reservationId = r.id
      WHERE r.scopeId = ${bound.scopeId} AND u.taskId = ${bound.taskId} AND ${moneyCandidate}
        AND NOT (BINARY r.status = 'released' AND ${releasedProof})
    )
    SELECT CAST(COUNT(*) AS CHAR) AS rowCount, CAST(COUNT(amount) AS CHAR) AS amountCount,
      CAST(COALESCE(SUM(CASE WHEN BINARY moneyCurrency = BINARY ${input.quantity.currency} THEN 0 ELSE 1 END), 0) AS CHAR) AS currencyErrors,
      SUM(amount) AS usedMoney FROM original_money`));
  const rows = count(aggregate.rowCount);
  if (rows !== count(aggregate.amountCount) || count(aggregate.currencyErrors) !== 0n) throw new BudgetError('UNAVAILABLE');
  const used = aggregate.usedMoney === null && rows === 0n ? 0n : moneyAtoms(aggregate.usedMoney);
  if (rows === 0n && used !== 0n) throw new BudgetError('UNAVAILABLE');
  const total = used + (input.phase === 'reserve' ? requested : 0n);
  if (caps.some(cap => total > cap)) throw new BudgetError('EXHAUSTED');
}
