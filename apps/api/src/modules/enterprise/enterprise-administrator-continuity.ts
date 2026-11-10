/** Other administrators count only with a current relationship and both portal grants.
 * Call under the existing Tenant lock; this does not grant or restore authority. */
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export async function assertOtherEnterpriseAdministrator(
  tx: Prisma.TransactionClient, tenantId: string, corporateCustomerId: string, membershipId: string
) {
  const others = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT m.id FROM customer_corporate_memberships m
    JOIN customer_profiles p ON p.tenantId=m.tenantId AND p.id=m.personalCustomerId AND p.customerType='personal' AND p.status='active' AND p.mergedIntoCustomerId IS NULL
    JOIN customer_accounts a ON a.tenantId=m.tenantId AND a.customerId=p.id AND a.status='active'
    JOIN customer_memberships pm ON pm.tenantId=m.tenantId AND pm.customerId=p.id AND pm.status='active'
    JOIN enterprise_portal_grants entry ON entry.tenantId=m.tenantId AND entry.corporateCustomerId=m.corporateCustomerId AND entry.membershipId=m.id AND entry.membershipUpdatedAt=m.updatedAt AND entry.action='portal:enter'
    JOIN enterprise_portal_grants manage ON manage.tenantId=m.tenantId AND manage.corporateCustomerId=m.corporateCustomerId AND manage.membershipId=m.id AND manage.membershipUpdatedAt=m.updatedAt AND manage.action='administrators:manage'
    WHERE m.tenantId=${tenantId} AND m.corporateCustomerId=${corporateCustomerId} AND m.id<>${membershipId} AND m.role='admin' AND m.status='active'
      AND m.effectiveFrom<=NOW(3) AND (m.effectiveTo IS NULL OR m.effectiveTo>NOW(3)) LIMIT 1`;
  if (!others.length) throw new ConflictException("最后受权管理员须先完成已接受交接，不能停用、终止或撤销管理入口");
}
