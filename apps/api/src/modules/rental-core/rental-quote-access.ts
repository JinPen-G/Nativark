import { ForbiddenException } from '@nestjs/common';
import type { RentalQuoteSnapshotV1, RentalQuoteSourceSnapshot } from '@rental-os/shared';
import { getRequestIdentity, getRequestLocationIds } from '../../common/request-identity';

/** Quote provenance comes from the authenticated request, never quote parameters.
 * Scope is rechecked on reads; this snapshot is evidence, not an access grant. */
export function currentQuoteSource(tenantId: string): RentalQuoteSourceSnapshot | undefined {
  const identity = getRequestIdentity();
  // Pure pricing/configuration fixtures have no authenticated actor. They cannot
  // invent ownership; production quote routes always establish this identity.
  if (!identity?.userId) return undefined;
  if (identity.isSaasAdmin || identity.tenantId !== tenantId || !identity.workspaceId || !identity.audience
    || !['operator', 'staff', 'client'].includes(identity.audience)) {
    throw new ForbiddenException('报价创建来源未就绪');
  }
  return { version: 'rental-quote-source-1', tenantId, workspaceId: identity.workspaceId,
    actor: { kind: identity.audience === 'client' ? 'customer' : 'user', id: identity.userId }, audience: identity.audience };
}

export function assertQuoteReadAccess(quote: RentalQuoteSnapshotV1): void {
  const identity = getRequestIdentity();
  if (!identity?.userId || identity.isSaasAdmin || identity.tenantId !== quote.tenantId || !identity.workspaceId) {
    throw new ForbiddenException('报价访问身份未就绪');
  }
  const source = quote.sourceSnapshot;
  if (source && (source.version !== 'rental-quote-source-1' || source.tenantId !== identity.tenantId
    || source.workspaceId !== identity.workspaceId || !source.actor?.id
    || !['user', 'customer'].includes(source.actor.kind) || !['operator', 'staff', 'client'].includes(source.audience)
    || (source.actor.kind === 'customer') !== (source.audience === 'client'))) throw new ForbiddenException('报价来源范围不一致');
  if (identity.audience === 'client') {
    // An operator may quote on behalf of this customer. Customer access follows
    // the original request's customer, never the operator's creator identity.
    if (quote.request.customerId !== identity.userId) {
      throw new ForbiddenException('报价不属于当前客户');
    }
    return;
  }
  if (!['operator', 'staff'].includes(identity.audience ?? '')) throw new ForbiddenException('报价受众未就绪');
  if (identity.dataScope === 'own' && (!source || source.actor.kind !== 'user' || source.actor.id !== identity.userId
    || !['operator', 'staff'].includes(source.audience))) throw new ForbiddenException('报价不在当前账号本人范围内');
  const locations = getRequestLocationIds();
  if (!identity.dataScope || (identity.dataScope !== 'all' && identity.dataScope !== 'own' && locations === undefined)) {
    throw new ForbiddenException('报价组织或门店范围未解析');
  }
  if (locations !== undefined) {
    const requested = [quote.request.fulfillmentLocationId, quote.request.returnLocationId ?? quote.request.fulfillmentLocationId,
      ...(quote.request.services ?? []).map(row => row.serviceLocationId).filter((id): id is string => Boolean(id)),
      ...(quote.serviceSnapshots ?? []).map(row => row.serviceLocationId).filter((id): id is string => Boolean(id))];
    if (!locations.length || requested.some(id => !locations.includes(id))) throw new ForbiddenException('报价不在当前授权履约地点范围内');
  }
}
