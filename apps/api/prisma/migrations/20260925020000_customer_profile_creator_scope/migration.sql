-- ACCESS-DATA-01: creator scope for tenant-shared customer profiles.
-- Existing profiles and self-service registrations remain NULL and are not
-- retroactively attributed to an operator.
ALTER TABLE `customer_profiles`
  ADD COLUMN `createdByUserId` VARCHAR(191) NULL,
  ADD COLUMN `createdInWorkspaceId` VARCHAR(191) NULL,
  ADD INDEX `customer_profiles_creator_scope_idx` (`tenantId`, `createdInWorkspaceId`, `createdByUserId`);
