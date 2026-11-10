/** Current business-location projection shared by HTTP Guard and internal Auth
 * consumers. It only narrows the authenticated user's configured scope; it does
 * not authenticate, authorize a route/resource, grant a lease or seed mappings. */
import { ForbiddenException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { SystemUserRow } from '@rental-os/shared';
import { enabledOrganizationSubtreeIds, organizationLocationScope, type OrganizationLocationScope } from './organization-location-scope';

export async function resolveUserBusinessLocationScope(
  user: SystemUserRow,
  workspaceId: string | undefined,
  configuredScope: OrganizationLocationScope,
  db?: Pick<PrismaClient, 'organizationUnit' | 'rentalFulfillmentLocation'>
): Promise<OrganizationLocationScope> {
  if (user.dataScope !== 'organization') return structuredClone(configuredScope);
  if (!workspaceId || !user.organizationId || typeof db?.organizationUnit?.findMany !== 'function'
    || typeof db?.rentalFulfillmentLocation?.findMany !== 'function') {
    throw new ForbiddenException('组织数据范围缺少有效组织、经营空间或数据库上下文，已拒绝访问');
  }
  const organizations = await db.organizationUnit.findMany({
    where: { tenantId: user.tenantId }, select: { id: true, parentId: true, status: true }
  });
  const organizationIds = enabledOrganizationSubtreeIds(organizations, user.organizationId);
  if (!organizationIds.length) throw new ForbiddenException('当前账号所属组织不存在或已停用，已拒绝访问');
  const locations = await db.rentalFulfillmentLocation.findMany({
    where: { tenantId: user.tenantId, workspaceId, organizationId: { in: organizationIds } }, select: { id: true }
  });
  return organizationLocationScope(locations.map(location => location.id), configuredScope);
}
