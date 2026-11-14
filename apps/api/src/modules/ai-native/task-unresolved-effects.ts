/** Conservative original-task hold shared by retention and conversation release.
 * A terminal task alone cannot prove its steps, approvals or model accounting
 * settled. Missing/oversized evidence keeps the hold; no records are changed. */
import type { Prisma } from '@prisma/client';
import { modelUsageSchema } from './model-gateway.ports';
import { isGatewayConfig } from './gateway-contract-validation';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
const terminal = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export async function aiTaskHasUnresolvedEffects(tx: Prisma.TransactionClient, scopeId: string, taskId: string,
  owner: { tenantId: string | null; workspaceId: string | null }): Promise<boolean> {
  const platform = owner.tenantId === null && owner.workspaceId === null;
  if (!platform && (owner.tenantId === null || owner.workspaceId === null)) return true;
  if (await tx.aiTask.findFirst({ where: { id: taskId, scopeId, status: { notIn: [...terminal] } }, select: { id: true } })
    || await tx.aiStep.findFirst({ where: { taskId, scopeId, status: { in: ['RUNNING', 'UNKNOWN'] } }, select: { id: true } })
    || await tx.aiTaskExecutionCharge.findFirst({ where: { taskId, scopeId, status: { in: ['RESERVED', 'UNKNOWN'] } }, select: { chargeId: true } })
    || await tx.aiApprovalConsumption.findFirst({ where: { taskId, scopeId, status: { in: ['RESERVED', 'UNKNOWN'] } }, select: { actionId: true } })
    || await tx.aiStep.findFirst({ where: { taskId, scopeId, effect: 'POSSIBLE' }, select: { id: true } })) return true;
  // Resolve persisted associations, not guessed call prefixes. Reservations
  // created before an accounting link was acknowledged still hold the task.
  const runs = await tx.aiRun.findMany({ where: { taskId, scopeId }, select: { id: true }, orderBy: { id: 'asc' }, take: 101 });
  const invocations = await tx.aiGatewayInvocation.findMany({ where: { taskId, scopeId }, select: { callId: true }, orderBy: { id: 'asc' }, take: 201 });
  if (runs.length > 100 || invocations.length > 200) return true;
  const calls = invocations.map(row => row.callId);
  if (platform) {
    // Platform reservations and admissions have null business attribution.
    // Checking WORKSPACE rows would silently discard an unresolved platform
    // charge; an absent original accounting association must retain its body.
    if (await tx.aiBudgetReservation.findFirst({ where: { scopeId, scopeKind: 'PLATFORM',
      status: { in: ['reserved', 'pending_reconciliation', 'unknown'] }, OR: [
        { runId: { in: runs.map(row => row.id) } }, { accountingReceipts: { some: { taskId, scopeId } } }
      ] }, select: { id: true } })) return true;
    const originalRuns = await tx.aiRun.findMany({ where: { taskId, scopeId }, take: 101 });
    if (originalRuns.length !== runs.length || originalRuns.some(run => !terminal.includes(run.status as typeof terminal[number])
      || run.leaseOwnerId !== null || run.leaseExpiresAt !== null)) return true;
    for (const invocation of invocations) {
      const source = await tx.aiGatewayInvocation.findFirst({ where: { taskId, scopeId, callId: invocation.callId } });
      const receipt = source && await tx.aiGatewayAccountingReceipt.findUnique({ where: { invocationId: source.id } });
      if (!source || !receipt || receipt.scopeKind !== 'PLATFORM' || receipt.scopeId !== scopeId
        || receipt.taskId !== taskId || receipt.tenantId !== null || receipt.workspaceId !== null) return true;
      const reservation = await tx.aiBudgetReservation.findUnique({ where: { id: receipt.reservationId } });
      const admission = await tx.aiInvocationAdmission.findUnique({ where: { id: receipt.admissionId } });
      if (!isGatewayConfig(source.configuration) || source.configuration.configurationScope.kind !== 'platform'
        || 'tenantId' in source.configuration || requestFingerprint(source.configuration) !== source.configurationHash
        || !reservation || !admission || reservation.scopeKind !== 'PLATFORM' || reservation.scopeId !== scopeId
        || reservation.tenantId !== null || reservation.workspaceId !== null || admission.scopeKind !== 'PLATFORM'
        || admission.tenantId !== null || admission.workspaceId !== null || admission.callId !== source.callId
        || admission.platformDedupKey !== source.callId || reservation.callId !== source.callId
        || reservation.requestId !== source.callId || reservation.idempotencyKey !== source.callId
        || reservation.configurationHash !== source.configurationHash
        || reservation.configRevision !== source.configuration.configRevision || admission.profileId !== source.configuration.configId
        || reservation.runId !== source.runId || reservation.stepId !== source.stepId
        || reservation.actionId !== source.actionId || admission.actorId !== source.actorId
        || reservation.actorId !== source.actorId || receipt.dispatchToken !== admission.dispatchId
        || receipt.requestHash !== admission.requestHash || !['settled', 'released'].includes(reservation.status)
        || !['completed', 'cancelled', 'revoked'].includes(admission.status)
        || receipt.state === 'cancelled' && (reservation.status !== 'released' || reservation.dispatchState !== 'not_dispatched')
        || receipt.state !== 'cancelled' && (receipt.state !== 'dispatched' || reservation.status !== 'settled'
          || reservation.dispatchState !== 'completed' || admission.status !== 'completed' || receipt.inputTokens === null
          || receipt.outputTokens === null || !receipt.usageHash)) return true;
      const events = await tx.aiBudgetLedgerEntry.findMany({ where: { reservationId: reservation.id,
        kind: { in: ['settle', 'reconcile', 'release'] } }, take: 2 });
      const event = events[0];
      if (events.length !== 1 || event.scopeId !== scopeId || event.scopeKind !== 'PLATFORM'
        || event.tenantId !== null || event.reservationId !== reservation.id || event.outputTokens !== null) return true;
      if (receipt.state === 'cancelled') {
        if (event.kind !== 'release' || event.evidenceHash !== null || event.inputTokens !== null || event.calls !== null
          || event.moneyAmount !== null || event.moneyCurrency !== null || receipt.usageHash !== null
          || receipt.inputTokens !== null || receipt.outputTokens !== null || receipt.usageDetails !== null
          || reservation.actualMoney !== null || reservation.actualTokens !== null || reservation.actualCalls !== null) return true;
        continue;
      }
      const usage = modelUsageSchema.safeParse({ inputTokens: Number(receipt.inputTokens), outputTokens: Number(receipt.outputTokens),
        ...(receipt.usageDetails != null ? { billingDetails: receipt.usageDetails } : {}) });
      if (!usage.success || requestFingerprint({ receiptId: receipt.id, invocationId: source.id, admissionId: receipt.admissionId,
        reservationId: receipt.reservationId, dispatchToken: receipt.dispatchToken, requestHash: receipt.requestHash,
        usage: usage.data }) !== receipt.usageHash || !['settle', 'reconcile'].includes(event.kind)
        || reservation.priceVersion !== source.priceVersion || event.reason !== null) return true;
      let quantity: object;
      if (reservation.unitKind === 'tokens') {
        if (reservation.actualTokens === null || reservation.actualTokens !== receipt.inputTokens! + receipt.outputTokens!
          || reservation.actualTokens > BigInt(Number.MAX_SAFE_INTEGER) || reservation.actualMoney !== null
          || reservation.actualCalls !== null || event.inputTokens !== reservation.actualTokens || event.calls !== null
          || event.moneyAmount !== null || event.moneyCurrency !== null) return true;
        quantity = { unit: 'tokens', value: Number(reservation.actualTokens) };
      } else if (reservation.unitKind === 'calls') {
        if (reservation.actualCalls !== 1 || reservation.actualTokens !== null || reservation.actualMoney !== null
          || event.calls !== 1 || event.inputTokens !== null || event.moneyAmount !== null || event.moneyCurrency !== null) return true;
        quantity = { unit: 'calls', value: 1 };
      } else if (reservation.unitKind === 'money') {
        const money = reservation.actualMoney;
        if (!money || !money.isFinite() || money.isNegative() || money.decimalPlaces() > 6
          || !/^[A-Z]{3}$/u.test(reservation.moneyCurrency ?? '') || reservation.actualTokens !== null || reservation.actualCalls !== null
          || !event.moneyAmount?.equals(money) || event.moneyCurrency !== reservation.moneyCurrency
          || event.inputTokens !== null || event.calls !== null) return true;
        quantity = { unit: 'money', amount: money.toFixed(6), currency: reservation.moneyCurrency, scale: 6 };
      } else return true;
      // Compare the original stored quantity and settlement evidence. This
      // does not price usage again or mutate the financial ledger.
      if (event.evidenceHash !== requestFingerprint({ usageHash: receipt.usageHash, priceVersion: source.priceVersion, quantity })) return true;
    }
    return false;
  }
  const businessOwner = { tenantId: owner.tenantId!, workspaceId: owner.workspaceId! };
  return Boolean(await tx.aiBudgetReservation.findFirst({ where: { scopeId, scopeKind: 'WORKSPACE',
    status: { in: ['reserved', 'pending_reconciliation'] }, OR: [
      { runId: { in: runs.map(row => row.id) } }, { accountingReceipts: { some: { taskId, scopeId } } }
    ] }, select: { id: true } })
    || calls.length && (await tx.aiInvocationAdmission.findFirst({ where: { ...businessOwner, callId: { in: calls },
      status: { notIn: ['completed', 'cancelled', 'revoked'] } }, select: { id: true } })
    // The original workspace usage contract persists `unknown`, unlike the
    // budget ledger's `pending_reconciliation`. Neither spelling proves settled.
    || await tx.aiUsageReservation.findFirst({ where: { ...businessOwner, callId: { in: calls },
      status: { in: ['reserved', 'unknown', 'pending_reconciliation'] } }, select: { id: true } })));
}
