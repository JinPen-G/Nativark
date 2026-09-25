-- ACCESS-DATA-01：履约地点显式关联租户组织，用于组织范围的业务地点解析。
-- 旧地点保持 NULL；不从经营主体、地点名称或用户组织猜测归属，未配置前组织范围继续 fail-closed。
ALTER TABLE `OrganizationUnit`
  ADD UNIQUE INDEX `organization_units_tenant_id_key` (`tenantId`, `id`);

ALTER TABLE `rental_fulfillment_locations`
  ADD COLUMN `organizationId` VARCHAR(191) NULL COMMENT '履约地点所属组织单元 ID' AFTER `workspaceId`,
  ADD INDEX `rental_locations_tenant_ws_org_idx` (`tenantId`, `workspaceId`, `organizationId`),
  ADD CONSTRAINT `rental_fulfillment_locations_tenantId_organizationId_fkey`
    FOREIGN KEY (`tenantId`, `organizationId`) REFERENCES `OrganizationUnit` (`tenantId`, `id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
