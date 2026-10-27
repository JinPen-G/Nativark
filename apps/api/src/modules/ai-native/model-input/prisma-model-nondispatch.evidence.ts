/** Read-only original-call evidence for a model step denied before transport.
 * Callers supply current authorized ownership and recheck authority afterwards.
 * Absence/expiry alone is never proof; this grants neither retry nor refund. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { isGatewayConfig } from '../gateway-contract-validation';
import { requestFingerprint as hash } from '../../rental-core/rental-idempotency.repository';

const invocationSelect = { id: true, scopeId: true, taskId: true, runId: true, stepId: true, actionId: true,
  actorId: true, callId: true, registrationHash: true, intentHash: true, configuration: true,
  configurationHash: true, priceVersion: true, maxOutputTokens: true, mode: true, sceneCode: true,
  leaseOwnerId: true, fencingToken: true } satisfies Prisma.AiGatewayInvocationSelect;
type Invocation = Prisma.AiGatewayInvocationGetPayload<{ select: typeof invocationSelect }>;
type Db = Pick<PrismaClient, 'aiGatewayInvocation' | 'aiInvocationAdmission' | 'aiGatewayAccountingReceipt' | 'aiBudgetReservation'>;

function invocationBinding(row: Invocation) {
  if (!isGatewayConfig(row.configuration) || !('tenantId' in row.configuration)
    || hash(row.configuration) !== row.configurationHash) return null;
  return { id: row.id, scopeId: row.scopeId, taskId: row.taskId, runId: row.runId, stepId: row.stepId,
    actionId: row.actionId, actorId: row.actorId, callId: row.callId, registrationHash: row.registrationHash,
    intentHash: row.intentHash, configurationHash: row.configurationHash, tenantId: row.configuration.tenantId, configId: row.configuration.configId,
    configRevision: row.configuration.configRevision, priceVersion: row.priceVersion,
    maxOutputTokens: row.maxOutputTokens, mode: row.mode, sceneCode: row.sceneCode,
    leaseOwnerId: row.leaseOwnerId, fencingToken: row.fencingToken.toFixed(0) };
}

export async function readModelNonDispatchEvidence(db: Db,
  owner: Readonly<{ scopeId: string; tenantId: string; workspaceId: string; actorId: string }>, value: Invocation) {
  // This binding must come from the caller's current authorized task/context,
  // not from an HTTP payload. It is evidence selection, never authorization.
  const { scopeId, tenantId, workspaceId, actorId } = structuredClone(owner), expected = invocationBinding(value);
  if (!expected || !scopeId || !tenantId || !workspaceId || !actorId
    || expected.scopeId !== scopeId || expected.tenantId !== tenantId || expected.actorId !== actorId) return null;
  const read = async () => {
    const [invocation, admission, receipt, reservation] = await Promise.all([
      db.aiGatewayInvocation.findFirst({ where: { id: expected.id, scopeId: expected.scopeId,
        taskId: expected.taskId, runId: expected.runId, stepId: expected.stepId, actorId, callId: expected.callId },
        select: invocationSelect }).then(row => row ? invocationBinding(row) : null),
      db.aiInvocationAdmission.findFirst({ where: { tenantId, workspaceId, actorId, callId: expected.callId },
        select: { id: true, tenantId: true, workspaceId: true, actorId: true, callId: true, profileId: true,
          status: true, dispatchId: true, requestHash: true, revokedAt: true, completedAt: true, unknownReason: true } })
        .then(row => row ? structuredClone(row) : null),
      db.aiGatewayAccountingReceipt.findFirst({ where: { scopeId: expected.scopeId, invocationId: expected.id },
        select: { id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true, taskId: true,
          invocationId: true, reservationId: true, admissionId: true, dispatchToken: true, requestHash: true,
          state: true, usageHash: true, inputTokens: true, outputTokens: true } })
        .then(row => row ? { ...structuredClone(row), inputTokens: row.inputTokens?.toString() ?? null,
          outputTokens: row.outputTokens?.toString() ?? null } : null),
      db.aiBudgetReservation.findFirst({ where: { scopeId: expected.scopeId, scopeKind: 'WORKSPACE', callId: expected.callId },
        select: { id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true, actorId: true,
          callId: true, requestId: true, idempotencyKey: true, runId: true, stepId: true, actionId: true,
          sceneCode: true, priceVersion: true, configRevision: true, configurationHash: true, status: true, dispatchState: true } })
        .then(row => row ? structuredClone(row) : null)
    ]);
    if (!invocation || hash(invocation) !== hash(expected) || !admission
      || admission.tenantId !== tenantId || admission.workspaceId !== workspaceId || admission.actorId !== actorId
      || admission.callId !== expected.callId || admission.profileId !== expected.configId || admission.status !== 'cancelled'
      || !(admission.revokedAt instanceof Date) || !Number.isFinite(admission.revokedAt.getTime())
      || admission.completedAt !== null || admission.unknownReason !== null
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(admission.dispatchId ?? '')
      || !/^[a-f0-9]{64}$/u.test(admission.requestHash)) return null;
    // A lost reserve/link acknowledgement is not an empty balance. If either
    // financial row exists, require the complete original released linkage.
    if (receipt || reservation) {
      if (!receipt || !reservation || receipt.scopeId !== expected.scopeId || receipt.scopeKind !== 'WORKSPACE'
        || receipt.tenantId !== tenantId || receipt.workspaceId !== workspaceId || receipt.taskId !== expected.taskId
        || receipt.invocationId !== expected.id || receipt.reservationId !== reservation.id
        || receipt.admissionId !== admission.id || receipt.dispatchToken !== admission.dispatchId
        || receipt.requestHash !== admission.requestHash || receipt.state !== 'cancelled'
        || receipt.usageHash !== null || receipt.inputTokens !== null || receipt.outputTokens !== null
        || reservation.scopeId !== expected.scopeId || reservation.scopeKind !== 'WORKSPACE'
        || reservation.tenantId !== tenantId || reservation.workspaceId !== workspaceId || reservation.actorId !== actorId
        || reservation.callId !== expected.callId || reservation.requestId !== expected.callId || reservation.idempotencyKey !== expected.callId
        || reservation.runId !== expected.runId || reservation.stepId !== expected.stepId || reservation.actionId !== expected.actionId
        || reservation.sceneCode !== expected.sceneCode || reservation.priceVersion !== expected.priceVersion
        || reservation.configRevision !== expected.configRevision || reservation.configurationHash !== expected.configurationHash
        || reservation.status !== 'released' || reservation.dispatchState !== 'not_dispatched') return null;
    }
    return { invocation, admission: { ...admission, revokedAt: admission.revokedAt.toISOString() }, receipt, reservation };
  };
  try {
    const before = await read();
    if (!before) return null;
    const after = await read();
    if (!after || hash(before) !== hash(after)) return null;
    return { state: 'not_dispatched' as const, invocationId: expected.id, callId: expected.callId,
      admissionId: after.admission.id, dispatchToken: after.admission.dispatchId!,
      reservationId: after.reservation?.id ?? null, proofHash: hash(after),
      meaning: 'original_failure_not_retry_or_refund_permission' as const };
  } catch {
    // Storage/commit uncertainty remains unknown, never inferred non-consumption.
    return null;
  }
}
