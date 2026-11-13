/** Current original-business access for event consumers and receipt recovery.
 * Current failure checks belong to withEvent; withOriginalEvent verifies only
 * the frozen event and its original resource links, and grants no new action. */
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { AiBusinessFailureOutbox, Prisma, PrismaClient } from '@prisma/client';
import { AI_EVENTS_DRAFT_VERSION, type AiBusinessEventDraft } from '@rental-os/shared';
import { z } from 'zod';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestDataScope, getRequestIdentity, getRequestLocationIds, runWithRequestIdentity } from '../../../common/request-identity';
import type { AuthService } from '../../auth/auth.service';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { canManageWorkspaceWideNotifications, canResolveNotificationOrderScope } from '../../rental-core/rental-workbench-todos';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { BusinessFailureError, isResourceFailureEvent, readBusinessFailureResourceBinding, readBusinessFailureResource,
  resourceFailureEvent, requireBusinessFailureResourcePorts, type BusinessFailureResourcePorts } from './prisma-business-failure-outbox';
import { returnExceptionSource } from './return-exception-source';

export type FailureSource = { revision: number; failed: boolean; orderId: string | null; paymentIntentId?: string;
  sourceHash?: string; capturedSourceHash?: string; resourceEvent?: AiBusinessEventDraft };
const originalId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u);
const originalTime = z.date().refine(value => Number.isFinite(value.getTime()));
const originalEvent = z.object({ id: z.string().uuid(), tenantId: originalId, workspaceId: originalId,
  eventType: z.enum(['notification.failed', 'refund.failed', 'inspection.return_exception',
    'fulfillment.resource_shortage', 'opening.missing_configuration']),
  notificationId: originalId.nullable(), refundId: originalId.nullable(), inspectionId: originalId.nullish(),
  exceptionId: originalId.nullish(), orderId: originalId.nullable(),
  resourceRevision: z.number().int().min(1).max(4294967294), failureCode: originalId,
  traceId: originalId, causationId: originalId, deduplicationKey: z.string().regex(/^[a-f0-9]{64}$/u),
  occurredAt: originalTime, expiresAt: originalTime });
export class BusinessFailureReadAuthority {
  private readonly identities: AiTaskCurrentIdentityAuthority;
  constructor(private readonly db: Pick<PrismaClient, 'rentalNotificationLog' | 'rentalPaymentRefund' | 'rentalInspectionRecord'>,
    auth: Pick<AuthService, 'resolveAccessContext'>, private readonly credentials: AiTaskCredentialSource,
    private readonly guard: Pick<ApiAuthGuard, 'canActivate'>, private readonly core: Pick<RentalCoreService, 'getOrder'>,
    private readonly clock: () => Date = () => new Date(), private readonly resources?: BusinessFailureResourcePorts) {
    this.identities = new AiTaskCurrentIdentityAuthority(auth, credentials, clock);
    requireBusinessFailureResourcePorts(resources);
  }

  async current() {
    const context = await this.identities.resolve();
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || !['operator', 'staff'].includes(context.audience)) throw new BusinessFailureError('unavailable');
    return { context, scope: { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId } };
  }

  /** Receipt-only authorization. Policy removal, expiry and resolution do not
   * erase a captured event. No current failure, policy or readiness callback is
   * invoked here; the original business row and current read access must remain. */
  async withOriginalEvent<T>(value: AiBusinessFailureOutbox, execute: (event: AiBusinessEventDraft) => Promise<T>,
    tx?: Prisma.TransactionClient, revalidate?: (event: AiBusinessEventDraft) => Promise<void>): Promise<T> {
    const event = structuredClone(value), parsed = originalEvent.safeParse(event), now = this.clock();
    if (!parsed.success || !originalTime.safeParse(now).success || parsed.data.occurredAt > now
      || parsed.data.expiresAt <= parsed.data.occurredAt || typeof execute !== 'function'
      || revalidate !== undefined && typeof revalidate !== 'function') throw new BusinessFailureError('unavailable');
    const authorize = async <R>(read: (original: AiBusinessEventDraft, binding: string) => Promise<R>): Promise<R> => {
      const current = await this.current(), context = current.context;
      if (event.tenantId !== current.scope.tenantId || event.workspaceId !== current.scope.workspaceId
        || !('access' in context)) throw new BusinessFailureError('unavailable');
      const before = await this.originalBinding(event, tx);
      const credential = structuredClone(await this.credentials.current());
      if (!credential || credential.audience !== context.audience || typeof credential.authorization !== 'string')
        throw new BusinessFailureError('unavailable');
      return runWithRequestIdentity({}, async () => {
        const staff = credential.audience === 'staff', path = before.path;
        const request: { url: string; originalUrl: string; method: string; headers: object; query: object; body: object;
          staffApiRequest: boolean; user?: { id: string; tenantId: string; isActive: boolean } } = {
          url: `/api${path}`, originalUrl: `/api${staff ? path.replace('/rental/v1/', '/staff/v1/') : path}`,
          method: 'GET', headers: { authorization: credential.authorization }, query: {}, body: {}, staffApiRequest: staff };
        try {
          if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new BusinessFailureError('unavailable');
          const identity = getRequestIdentity();
          if (!request.user?.isActive || !identity || context.actor.kind !== 'user'
            || request.user.id !== context.actor.userId || request.user.tenantId !== event.tenantId
            || identity.userId !== context.actor.userId || identity.tenantId !== event.tenantId
            || identity.workspaceId !== event.workspaceId || identity.staffApi !== staff || identity.isSaasAdmin
            || identity.dataScope !== context.access.dataScope
            || identity.organizationId !== context.access.organizationId
            || requestFingerprint(identity.locationScope) !== requestFingerprint(context.access.locationScope))
            throw new BusinessFailureError('unavailable');
          if (event.notificationId && !canManageWorkspaceWideNotifications(getRequestDataScope(), getRequestLocationIds())) {
            if (!before.orderId || !canResolveNotificationOrderScope(getRequestDataScope(), getRequestLocationIds()))
              throw new BusinessFailureError('unavailable');
            await this.core.getOrder(event.tenantId, before.orderId);
          } else if (before.orderId && (event.refundId || event.inspectionId || event.eventType === 'fulfillment.resource_shortage')) {
            await this.core.getOrder(event.tenantId, before.orderId);
          }
          const after = await this.originalBinding(event, tx);
          if (requestFingerprint(before) !== requestFingerprint(after)) throw new BusinessFailureError('unavailable');
          return read(structuredClone(after.event), requestFingerprint({ actor: context.actor, audience: context.audience,
            scope: context.scope, access: context.access, original: after }));
        } catch { throw new BusinessFailureError('unavailable'); }
      });
    };
    return authorize(async (original, binding) => {
      const result = await execute(original);
      await authorize(async (_latest, currentBinding) => {
        if (currentBinding !== binding) throw new BusinessFailureError('unavailable');
        // The closing Guard/Core read may outlive the caller's last DB read.
        // Receipt consumers recheck their original rows under this final access.
        await revalidate?.(_latest);
      });
      return result;
    });
  }

  private async originalBinding(event: AiBusinessFailureOutbox, tx?: Prisma.TransactionClient) {
    const scope = { tenantId: event.tenantId, workspaceId: event.workspaceId }, reader = tx ?? this.db;
    const base = { draftVersion: AI_EVENTS_DRAFT_VERSION, eventId: event.id, eventVersion: '1' as const,
      scope: { kind: 'workspace' as const, ...scope }, occurredAt: event.occurredAt.toISOString(),
      traceId: event.traceId, causationId: event.causationId, deduplicationKey: event.deduplicationKey, causalDepth: 1 };
    let material: AiBusinessEventDraft, orderId: string | null = event.orderId, paymentIntentId: string | undefined;
    if (isResourceFailureEvent(event)) {
      if (!this.resources) throw new BusinessFailureError('unavailable');
      const reference = await readBusinessFailureResourceBinding(event, this.resources, tx);
      material = resourceFailureEvent(event, reference);
    } else if (event.eventType === 'inspection.return_exception' && event.inspectionId && event.exceptionId && orderId
      && !event.notificationId && !event.refundId && event.failureCode === 'review_pending') {
      const row = await reader.rentalInspectionRecord.findFirst({ where: { id: event.inspectionId, ...scope, orderId },
        select: { id: true, tenantId: true, workspaceId: true, orderId: true, stage: true } });
      if (!row || row.id !== event.inspectionId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.orderId !== orderId || row.stage !== 'return') throw new BusinessFailureError('unavailable');
      material = { ...base, type: event.eventType, resource: { kind: 'inspection', id: row.id, version: event.resourceRevision },
        payload: { orderId, exceptionId: event.exceptionId } };
    } else if (event.eventType === 'notification.failed' && event.notificationId && !event.refundId
      && !event.inspectionId && !event.exceptionId && event.failureCode === 'delivery_failed') {
      const row = await reader.rentalNotificationLog.findFirst({ where: { id: event.notificationId, ...scope },
        select: { id: true, tenantId: true, workspaceId: true, businessObjectType: true, businessObjectId: true } });
      if (!row || row.id !== event.notificationId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || (row.businessObjectType === 'order' ? row.businessObjectId : null) !== orderId) throw new BusinessFailureError('unavailable');
      material = { ...base, type: event.eventType, resource: { kind: 'notification', id: row.id, version: event.resourceRevision },
        payload: { failureCode: 'delivery_failed' } };
    } else if (event.eventType === 'refund.failed' && event.refundId && orderId && !event.notificationId
      && !event.inspectionId && !event.exceptionId && event.failureCode === 'provider_failed') {
      const row = await reader.rentalPaymentRefund.findFirst({ where: { id: event.refundId, ...scope, orderId },
        select: { id: true, tenantId: true, workspaceId: true, orderId: true, paymentIntentId: true } });
      if (!row || row.id !== event.refundId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.orderId !== orderId || !originalId.safeParse(row.paymentIntentId).success) throw new BusinessFailureError('unavailable');
      paymentIntentId = row.paymentIntentId;
      material = { ...base, type: event.eventType, resource: { kind: 'refund', id: row.id, version: event.resourceRevision },
        payload: { orderId, failureCode: 'provider_failed' } };
    } else { throw new BusinessFailureError('unavailable'); }
    const path = material.type === 'opening.missing_configuration' ? '/rental/v1/tenant-readiness'
      : material.type === 'fulfillment.resource_shortage' ? `/rental/v1/orders/${encodeURIComponent(orderId!)}`
        : material.type === 'inspection.return_exception' ? `/rental/v1/orders/${encodeURIComponent(orderId!)}/inspections`
          : material.type === 'notification.failed' ? '/rental/v1/notification-logs'
            : `/rental/v1/orders/${encodeURIComponent(orderId!)}/payment-intents/${encodeURIComponent(paymentIntentId!)}/refunds`;
    return { event: material, orderId, ...(paymentIntentId ? { paymentIntentId } : {}), path };
  }

  async withEvent<T>(event: AiBusinessFailureOutbox, execute: (source: FailureSource) => Promise<T>): Promise<T> {
    const authorize = async <R>(read: (source: FailureSource, principal: string) => Promise<R>): Promise<R> => {
      const current = await this.current(), context = current.context;
      if (event.tenantId !== current.scope.tenantId || event.workspaceId !== current.scope.workspaceId) throw new BusinessFailureError('unavailable');
      if (isResourceFailureEvent(event) && !this.resources) throw new BusinessFailureError('unavailable');
      const reference = isResourceFailureEvent(event) ? await readBusinessFailureResourceBinding(event, this.resources!) : null;
      const original = reference ? null : await this.source(event);
      const path = reference ? reference.kind === 'order_assignment'
        ? `/rental/v1/orders/${encodeURIComponent(reference.id)}` : '/rental/v1/tenant-readiness'
        : event.notificationId ? '/rental/v1/notification-logs'
          : event.inspectionId ? `/rental/v1/orders/${encodeURIComponent(original!.orderId!)}/inspections`
            : `/rental/v1/orders/${encodeURIComponent(original!.orderId!)}/payment-intents/${encodeURIComponent(original!.paymentIntentId!)}/refunds`;
      const credentials = structuredClone(await this.credentials.current());
      if (!credentials || credentials.audience !== context.audience || typeof credentials.authorization !== 'string') throw new BusinessFailureError('unavailable');
      return runWithRequestIdentity({}, async () => {
        const staff = credentials.audience === 'staff';
        const request: { url: string; originalUrl: string; method: string; headers: object; query: object; body: object; staffApiRequest: boolean; user?: { id: string; tenantId: string; isActive: boolean } } = {
          url: `/api${path}`, originalUrl: `/api${staff ? path.replace('/rental/v1/', '/staff/v1/') : path}`,
          method: 'GET', headers: { authorization: credentials.authorization }, query: {}, body: {}, staffApiRequest: staff };
        try {
          if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new BusinessFailureError('unavailable');
          const identity = getRequestIdentity();
          if (!request.user?.isActive || !identity || identity.tenantId !== event.tenantId || identity.workspaceId !== event.workspaceId
            || context.actor.kind !== 'user' || identity.userId !== context.actor.userId || request.user.id !== context.actor.userId
            || identity.staffApi !== staff || identity.isSaasAdmin) throw new BusinessFailureError('unavailable');
          if (event.notificationId && !canManageWorkspaceWideNotifications(getRequestDataScope(), getRequestLocationIds())) {
            if (!original!.orderId || !canResolveNotificationOrderScope(getRequestDataScope(), getRequestLocationIds())) throw new BusinessFailureError('unavailable');
            await this.core.getOrder(event.tenantId, original!.orderId);
          }
          if (event.refundId || event.inspectionId) await this.core.getOrder(event.tenantId, original!.orderId!);
          if (reference?.kind === 'order_assignment') await this.core.getOrder(event.tenantId, reference.id);
        } catch { throw new BusinessFailureError('unavailable'); }
        // Original Guard/ALS must be established before any new Core/readiness
        // callback. The stored reference locates evidence; it grants no access.
        const observed = reference ? await readBusinessFailureResource(current.scope, reference, this.resources!, this.clock()) : null;
        const source: FailureSource = observed ? { revision: observed.revision, failed: observed.failed, orderId: observed.orderId,
          sourceHash: observed.sourceHash, capturedSourceHash: observed.capturedSourceHash,
          resourceEvent: resourceFailureEvent(event, reference!) } : original!;
        const principal = requestFingerprint({ actor: context.actor, audience: context.audience, scope: context.scope,
          access: 'access' in context ? context.access : null });
        return read(source, principal);
      });
    };
    return authorize(async (source, principal) => {
      const sourceBinding = requestFingerprint(source);
      const result = await execute(source);
      await authorize(async (latest, latestPrincipal) => {
        if (principal !== latestPrincipal || sourceBinding !== requestFingerprint(latest)) throw new BusinessFailureError('unavailable');
      });
      return result;
    });
  }

  private async source(event: AiBusinessFailureOutbox): Promise<FailureSource> {
    const scope = { tenantId: event.tenantId, workspaceId: event.workspaceId };
    if (event.eventType === 'inspection.return_exception' && event.inspectionId && event.exceptionId && event.orderId
      && !event.notificationId && !event.refundId && event.failureCode === 'review_pending') {
      const row = await this.db.rentalInspectionRecord.findFirst({ where: { id: event.inspectionId, ...scope, orderId: event.orderId } });
      if (!row || row.id !== event.inspectionId || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
        || row.orderId !== event.orderId) throw new BusinessFailureError('unavailable');
      const source = returnExceptionSource(row, event.exceptionId);
      if (!source) throw new BusinessFailureError('unavailable');
      return source;
    }
    if (event.inspectionId || event.exceptionId) throw new BusinessFailureError('unavailable');
    if (event.eventType === 'notification.failed' && event.notificationId && !event.refundId) {
      const row = await this.db.rentalNotificationLog.findFirst({ where: { id: event.notificationId, ...scope }, select: {
        id: true, revision: true, status: true, provider: true, nextAttemptAt: true, businessObjectType: true, businessObjectId: true } });
      if (!row) throw new BusinessFailureError('unavailable');
      const orderId = row.businessObjectType === 'order' ? row.businessObjectId : null;
      if (orderId !== event.orderId) throw new BusinessFailureError('unavailable');
      return { revision: row.revision, orderId, failed: ['failed', 'delivery_failed'].includes(row.status)
        && (row.status !== 'failed' || row.nextAttemptAt === null) && !['mock', 'local_mock', 'simulation'].includes(row.provider) };
    }
    if (event.eventType === 'refund.failed' && event.refundId && !event.notificationId) {
      const row = await this.db.rentalPaymentRefund.findFirst({ where: { id: event.refundId, ...scope }, select: {
        id: true, revision: true, status: true, orderId: true, paymentIntentId: true, fundedAt: true, succeededAt: true, provider: true } });
      if (!row || row.orderId !== event.orderId) throw new BusinessFailureError('unavailable');
      return { revision: row.revision, orderId: row.orderId, paymentIntentId: row.paymentIntentId,
        failed: row.status === 'failed' && !row.fundedAt && !row.succeededAt && !['mock', 'local_mock', 'simulation'].includes(row.provider) };
    }
    throw new BusinessFailureError('unavailable');
  }
}
