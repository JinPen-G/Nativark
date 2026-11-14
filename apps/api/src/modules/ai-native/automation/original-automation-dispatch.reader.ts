/** Original automatic-call dispatch evidence under current human business
 * access. Expired automated execution grants remain expired; no scope lease,
 * financial mutation, provider request or replacement reservation is created. */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { isGatewayConfig } from '../gateway-contract-validation';
import type { BudgetEvidenceBinding } from '../budget/budget-dependency-adapters';
import { BudgetError } from '../budget/budget.ports';
import type { AutomationExplanationAuthority } from './automation-model-explanation.composition';
import type { AutomationTaskModelOrigin } from './automation-task-model.authority';

type Db = Pick<PrismaClient, 'aiBudgetReservation' | 'aiGatewayInvocation' | 'aiGatewayAccountingReceipt' | 'aiInvocationAdmission'>;
const id = z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const fingerprint = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value,
  (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item)));
const denied = () => new BudgetError('FORBIDDEN');

export function createOriginalAutomationDispatchReader(db: Db,
  authority: Pick<AutomationExplanationAuthority, 'original' | 'withOriginalRead'>) {
  if (typeof authority?.withOriginalRead !== 'function'
    || ['aiBudgetReservation', 'aiGatewayInvocation', 'aiGatewayAccountingReceipt', 'aiInvocationAdmission']
      .some(key => typeof db?.[key as keyof Db]?.findUnique !== 'function')) throw new BudgetError('UNAVAILABLE');
  const read = async (reservationId: string, origin: AutomationTaskModelOrigin) => {
    if (origin.original.taskId !== authority.original.taskId || origin.original.runId !== authority.original.runId
      || origin.original.inputRef !== authority.original.inputRef) throw denied();
    const reservation = await db.aiBudgetReservation.findUnique({ where: { id: reservationId } });
    if (!reservation || reservation.id !== reservationId || reservation.scopeId !== origin.scopeId
      || reservation.scopeKind !== 'WORKSPACE' || reservation.tenantId !== origin.scope.tenantId
      || reservation.workspaceId !== origin.scope.workspaceId || reservation.actorId !== origin.subjectId
      || reservation.runId !== origin.original.runId || reservation.sceneCode !== origin.sceneCode) throw denied();
    const invocation = await db.aiGatewayInvocation.findUnique({ where: { scopeId_callId: {
      scopeId: origin.scopeId, callId: reservation.callId } } });
    const receipt = await db.aiGatewayAccountingReceipt.findUnique({ where: { reservationId } });
    if (!invocation || !receipt || !isGatewayConfig(invocation.configuration)
      || invocation.scopeId !== origin.scopeId || invocation.taskId !== origin.original.taskId
      || invocation.runId !== origin.original.runId || invocation.actorId !== origin.subjectId
      || invocation.sceneCode !== origin.sceneCode || invocation.callId !== reservation.callId
      || invocation.callId !== reservation.requestId || invocation.callId !== reservation.idempotencyKey
      || invocation.stepId !== reservation.stepId || invocation.actionId !== reservation.actionId
      || invocation.priceVersion !== reservation.priceVersion || invocation.configurationHash !== reservation.configurationHash
      || invocation.configuration.configRevision !== reservation.configRevision
      || requestFingerprint(invocation.configuration) !== invocation.configurationHash
      || !('tenantId' in invocation.configuration) || invocation.configuration.tenantId !== origin.scope.tenantId
      || receipt.scopeId !== origin.scopeId || receipt.scopeKind !== 'WORKSPACE'
      || receipt.taskId !== origin.original.taskId || receipt.invocationId !== invocation.id
      || receipt.reservationId !== reservationId || receipt.tenantId !== origin.scope.tenantId
      || receipt.workspaceId !== origin.scope.workspaceId || !['reserved', 'dispatched', 'cancelled'].includes(receipt.state)) throw denied();
    const admission = await db.aiInvocationAdmission.findUnique({ where: { id: receipt.admissionId } });
    if (!admission || admission.id !== receipt.admissionId || admission.scopeKind !== 'WORKSPACE'
      || admission.tenantId !== origin.scope.tenantId || admission.workspaceId !== origin.scope.workspaceId
      || admission.actorId !== origin.subjectId || admission.callId !== invocation.callId
      || admission.profileId !== invocation.configuration.configId || admission.requestHash !== receipt.requestHash
      || admission.dispatchId !== receipt.dispatchToken) throw denied();
    const state = receipt.state === 'dispatched' ? 'dispatched' as const
      : receipt.state === 'cancelled' ? 'not_dispatched' as const : 'unknown' as const;
    const evidence: BudgetEvidenceBinding & { state: typeof state; dispatchToken: string | null } = {
      reservationId, requestId: invocation.callId, callId: invocation.callId, runId: invocation.runId,
      stepId: invocation.stepId, actionId: invocation.actionId, actorId: invocation.actorId,
      scopeKey: `WORKSPACE:${origin.scopeId}`, sceneCode: invocation.sceneCode,
      configRevision: invocation.configuration.configRevision, configurationHash: invocation.configurationHash,
      priceVersion: invocation.priceVersion, state, dispatchToken: state === 'not_dispatched' ? null : receipt.dispatchToken };
    if (state !== 'not_dispatched' && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(receipt.dispatchToken)) throw denied();
    return { evidence, hash: fingerprint({ origin, reservation, invocation, receipt, admission }) };
  };
  return Object.freeze({ readDispatch: async (value: string) => {
    const reservationId = id.parse(value);
    let initialHash: string | undefined;
    let reading = false;
    return authority.withOriginalRead(async origin => {
      if (reading) throw denied();
      reading = true;
      const before = await read(reservationId, origin), after = await read(reservationId, origin);
      if (before.hash !== after.hash) throw new BudgetError('PENDING_RECONCILIATION');
      initialHash = before.hash;
      return before.evidence;
    }, async origin => {
      if (initialHash === undefined || (await read(reservationId, origin)).hash !== initialHash) {
        throw new BudgetError('PENDING_RECONCILIATION');
      }
    });
  } });
}
