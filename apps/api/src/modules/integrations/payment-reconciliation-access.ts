import { ForbiddenException } from '@nestjs/common';
import { getRequestIdentity } from '../../common/request-identity';

/** A statement can contain unmatched rows with no order to project safely.
 * Bulk reconciliation therefore requires the original full-workspace finance
 * grant; a caller-supplied tenant/workspace or an integration permission is not it. */
export function assertPaymentReconciliationAccess(tenantId: string, workspaceId: string) {
  const identity = getRequestIdentity();
  if (!identity?.userId || identity.tenantId !== tenantId || identity.workspaceId !== workspaceId || identity.isSaasAdmin
    || !['operator', 'staff'].includes(identity.audience ?? '') || identity.dataScope !== 'all'
    || identity.locationScope?.mode !== 'all'
    || !(identity.isPlatformAdmin || identity.permissions?.includes('*') || identity.permissions?.includes('rental-os:finance:reconcile'))) {
    throw new ForbiddenException('批量支付对账与文件批次需要当前完整经营空间财务对账权限');
  }
}
