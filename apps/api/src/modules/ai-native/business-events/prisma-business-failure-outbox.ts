import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { returnExceptionSource } from './return-exception-source';

export const BUSINESS_FAILURE_OUTBOX = Symbol('BUSINESS_FAILURE_OUTBOX');
export type FailureScope = { tenantId: string; workspaceId: string };
export interface BusinessFailureOutboxParticipant {
  notification(tx: Prisma.TransactionClient, scope: FailureScope, id: string): Promise<void>;
  refund(tx: Prisma.TransactionClient, scope: FailureScope, id: string): Promise<void>;
  inspection?(tx: Prisma.TransactionClient, scope: FailureScope, id: string): Promise<void>;
}
export class BusinessFailureError extends Error {
  constructor(readonly code: 'unavailable' | 'conflict' | 'not_ready' | 'result_unknown' | 'invalid_input') { super(code); }
}

export class PrismaBusinessFailureOutbox implements BusinessFailureOutboxParticipant {
  constructor(private readonly clock: () => Date = () => new Date()) {}

  async notification(tx: Prisma.TransactionClient, scope: FailureScope, id: string) {
    const row = await tx.rentalNotificationLog.findFirst({ where: { id, ...scope }, select: {
      id: true, tenantId: true, workspaceId: true, revision: true, status: true, provider: true,
      nextAttemptAt: true, businessObjectType: true, businessObjectId: true } });
    if (!row || row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId) throw new BusinessFailureError('unavailable');
    if (!['failed', 'delivery_failed'].includes(row.status) || row.status === 'failed' && row.nextAttemptAt !== null
      || ['mock', 'local_mock', 'simulation'].includes(row.provider)) return;
    await this.append(tx, scope, { kind: 'notification', id, revision: row.revision,
      orderId: row.businessObjectType === 'order' ? row.businessObjectId : null });
  }

  async refund(tx: Prisma.TransactionClient, scope: FailureScope, id: string) {
    const row = await tx.rentalPaymentRefund.findFirst({ where: { id, ...scope }, select: {
      id: true, tenantId: true, workspaceId: true, revision: true, status: true, orderId: true,
      succeededAt: true, fundedAt: true, provider: true } });
    if (!row || row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId) throw new BusinessFailureError('unavailable');
    if (row.status !== 'failed' || row.succeededAt || row.fundedAt || ['mock', 'local_mock', 'simulation'].includes(row.provider)) return;
    await this.append(tx, scope, { kind: 'refund', id, revision: row.revision, orderId: row.orderId });
  }

  async inspection(tx: Prisma.TransactionClient, scope: FailureScope, id: string) {
    const row = await tx.rentalInspectionRecord.findFirst({ where: { id, ...scope } });
    if (!row || row.id !== id || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId) throw new BusinessFailureError('unavailable');
    if (row.stage !== 'return') return;
    if (!Number.isSafeInteger(row.revision) || row.revision < 1 || row.revision > 4294967294 || !Array.isArray(row.exceptions)) throw new BusinessFailureError('unavailable');
    await tx.aiBusinessFailureOutbox.updateMany({ where: { ...scope, inspectionId: id, resourceRevision: { not: row.revision },
      status: { in: ['pending', 'claimed', 'retry_scheduled', 'ready'] } }, data: {
      status: 'expired', fence: { increment: 1 }, leaseOwner: null, leaseUntil: null, lastErrorCode: 'resource_changed_or_expired' } });
    for (const exception of row.exceptions) {
      if (!exception || typeof exception !== 'object' || Array.isArray(exception) || typeof exception.id !== 'string') continue;
      const source = returnExceptionSource(row, exception.id);
      if (!source) throw new BusinessFailureError('unavailable');
      if (!source.failed) continue;
      const previous = await tx.aiBusinessFailureOutbox.findFirst({ where: { ...scope, inspectionId: id, exceptionId: exception.id,
        OR: [{ status: 'closed' }, { automationInputs: { some: {} } }] } });
      if (previous) continue;
      const now = this.clock();
      if (!Number.isFinite(now.getTime())) throw new BusinessFailureError('unavailable');
      const eventType = 'inspection.return_exception';
      const traceId = requestFingerprint({ ...scope, inspectionId: id, exceptionId: exception.id });
      const causationId = requestFingerprint({ traceId, revision: row.revision });
      const deduplicationKey = requestFingerprint({ eventType, causationId });
      await tx.aiBusinessFailureOutbox.upsert({ where: { tenantId_workspaceId_deduplicationKey: { ...scope, deduplicationKey } }, update: {},
        create: { ...scope, id: randomUUID(), eventType, inspectionId: id, exceptionId: exception.id, orderId: row.orderId,
          notificationId: null, refundId: null,
          resourceRevision: row.revision, failureCode: 'review_pending', traceId, causationId, deduplicationKey,
          occurredAt: now, expiresAt: new Date(now.getTime() + 86400000), nextAttemptAt: now } });
    }
  }

  private async append(tx: Prisma.TransactionClient, scope: FailureScope,
    source: { kind: 'notification' | 'refund'; id: string; revision: number; orderId: string | null }) {
    if (!Number.isSafeInteger(source.revision) || source.revision < 1) throw new BusinessFailureError('unavailable');
    const now = this.clock();
    if (!Number.isFinite(now.getTime())) throw new BusinessFailureError('unavailable');
    const traceId = requestFingerprint({ ...scope, kind: source.kind, id: source.id });
    const causationId = requestFingerprint({ traceId, revision: source.revision });
    const eventType = source.kind === 'notification' ? 'notification.failed' : 'refund.failed';
    const deduplicationKey = requestFingerprint({ eventType, causationId });
    await tx.aiBusinessFailureOutbox.upsert({ where: { tenantId_workspaceId_deduplicationKey: { ...scope, deduplicationKey } },
      update: {}, create: { ...scope, id: randomUUID(), eventType,
        notificationId: source.kind === 'notification' ? source.id : null, refundId: source.kind === 'refund' ? source.id : null,
        inspectionId: null, exceptionId: null,
        resourceRevision: source.revision, orderId: source.orderId, failureCode: source.kind === 'notification' ? 'delivery_failed' : 'provider_failed',
        traceId, causationId, deduplicationKey, occurredAt: now, expiresAt: new Date(now.getTime() + 86400000), nextAttemptAt: now } });
  }
}
