/** Conservative original-task hold shared by retention and conversation release.
 * A terminal task alone cannot prove its steps, approvals or model accounting
 * settled. Missing/oversized evidence keeps the hold; no records are changed. */
import type { Prisma } from '@prisma/client';
const terminal = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export async function aiTaskHasUnresolvedEffects(tx: Prisma.TransactionClient, scopeId: string, taskId: string,
  owner: { tenantId: string; workspaceId: string }): Promise<boolean> {
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
  const calls = invocations.map(row => row.callId), workspace = { tenantId: owner.tenantId, workspaceId: owner.workspaceId };
  return Boolean(await tx.aiBudgetReservation.findFirst({ where: { scopeId, scopeKind: 'WORKSPACE',
    status: { in: ['reserved', 'pending_reconciliation'] }, OR: [
      { runId: { in: runs.map(row => row.id) } }, { accountingReceipts: { some: { taskId, scopeId } } }
    ] }, select: { id: true } })
    || calls.length && (await tx.aiInvocationAdmission.findFirst({ where: { ...workspace, callId: { in: calls },
      status: { notIn: ['completed', 'cancelled', 'revoked'] } }, select: { id: true } })
    // The original workspace usage contract persists `unknown`, unlike the
    // budget ledger's `pending_reconciliation`. Neither spelling proves settled.
    || await tx.aiUsageReservation.findFirst({ where: { ...workspace, callId: { in: calls },
      status: { in: ['reserved', 'unknown', 'pending_reconciliation'] } }, select: { id: true } })));
}
