import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { AiBusinessFailureOutbox, PrismaClient } from '@prisma/client';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestDataScope, getRequestIdentity, getRequestLocationIds, runWithRequestIdentity } from '../../../common/request-identity';
import type { AuthService } from '../../auth/auth.service';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { canManageWorkspaceWideNotifications, canResolveNotificationOrderScope } from '../../rental-core/rental-workbench-todos';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { BusinessFailureError } from './prisma-business-failure-outbox';

export type FailureSource = { revision: number; failed: boolean; orderId: string | null; paymentIntentId?: string };
export class BusinessFailureReadAuthority {
  private readonly identities: AiTaskCurrentIdentityAuthority;
  constructor(private readonly db: Pick<PrismaClient, 'rentalNotificationLog' | 'rentalPaymentRefund'>,
    auth: Pick<AuthService, 'resolveAccessContext'>, private readonly credentials: AiTaskCredentialSource,
    private readonly guard: Pick<ApiAuthGuard, 'canActivate'>, private readonly core: Pick<RentalCoreService, 'getOrder'>,
    clock: () => Date = () => new Date()) {
    this.identities = new AiTaskCurrentIdentityAuthority(auth, credentials, clock);
  }

  async current() {
    const context = await this.identities.resolve();
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || !['operator', 'staff'].includes(context.audience)) throw new BusinessFailureError('unavailable');
    return { context, scope: { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId } };
  }

  async withEvent<T>(event: AiBusinessFailureOutbox, execute: (source: FailureSource) => Promise<T>): Promise<T> {
    const authorize = async <R>(read: (source: FailureSource, principal: string) => Promise<R>): Promise<R> => {
      const current = await this.current(), context = current.context;
      if (event.tenantId !== current.scope.tenantId || event.workspaceId !== current.scope.workspaceId) throw new BusinessFailureError('unavailable');
      const source = await this.source(event);
      const path = event.notificationId ? '/rental/v1/notification-logs'
        : `/rental/v1/orders/${encodeURIComponent(source.orderId!)}/payment-intents/${encodeURIComponent(source.paymentIntentId!)}/refunds`;
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
            if (!source.orderId || !canResolveNotificationOrderScope(getRequestDataScope(), getRequestLocationIds())) throw new BusinessFailureError('unavailable');
            await this.core.getOrder(event.tenantId, source.orderId);
          }
          if (event.refundId) await this.core.getOrder(event.tenantId, source.orderId!);
        } catch { throw new BusinessFailureError('unavailable'); }
        const principal = requestFingerprint({ actor: context.actor, audience: context.audience, scope: context.scope,
          access: 'access' in context ? context.access : null });
        return read(source, principal);
      });
    };
    return authorize(async (source, principal) => {
      const result = await execute(source);
      await authorize(async (latest, latestPrincipal) => {
        if (principal !== latestPrincipal || requestFingerprint(source) !== requestFingerprint(latest)) throw new BusinessFailureError('unavailable');
      });
      return result;
    });
  }

  private async source(event: AiBusinessFailureOutbox): Promise<FailureSource> {
    const scope = { tenantId: event.tenantId, workspaceId: event.workspaceId };
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
