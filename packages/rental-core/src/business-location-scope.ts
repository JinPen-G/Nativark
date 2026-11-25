/** 按当前组织及经营空间收窄已认证账号的配置地点范围，供 Guard、Auth 和员工文件权威共用。 */
import { ForbiddenException } from '@nestjs/common';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import { enabledOrganizationSubtreeIds, organizationLocationScope, type OrganizationLocationScope } from '@rental-os/platform-server/organization-location-scope';

export interface RentalBusinessLocationReader {
  organizationUnit: { findMany(input: { where: { tenantId: string }; select: { id: true; parentId: true; status: true } }):
    PromiseLike<Array<{ id: string; parentId: string | null; status: string }>> };
  rentalFulfillmentLocation: { findMany(input: { where: { tenantId: string; workspaceId: string;
    organizationId: { in: string[] } }; select: { id: true } }): PromiseLike<Array<{ id: string }>> };
}

export async function resolveUserBusinessLocationScope(
  user: SystemUserRow,
  workspaceId: string | undefined,
  configuredScope: OrganizationLocationScope,
  db?: RentalBusinessLocationReader
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
