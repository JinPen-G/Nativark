ALTER TABLE `OrganizationUnit`
  ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'enabled';

DROP INDEX `OrganizationUnit_tenantId_type_idx` ON `OrganizationUnit`;

CREATE INDEX `OrganizationUnit_tenantId_type_status_idx`
  ON `OrganizationUnit`(`tenantId`, `type`, `status`);
