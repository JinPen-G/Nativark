-- Ordinary profile versioning must deploy together with the owning repository
-- and its generated Client. This file does not activate an AI tool or approval.
ALTER TABLE `customer_profiles`
  ADD COLUMN `ordinaryRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1;

CREATE TABLE `customer_approved_profile_changes` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `changeKey` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `baseRevision` INTEGER UNSIGNED NOT NULL,
  `beforeName` VARCHAR(191) NOT NULL,
  `afterName` VARCHAR(191) NOT NULL,
  `changeHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `customer_profile_change_key` (`tenantId`, `customerId`, `actorId`, `changeKey`),
  UNIQUE INDEX `customer_profile_change_binding` (`tenantId`, `workspaceId`, `customerId`, `id`, `changeHash`),
  CONSTRAINT `customer_profile_change_revision_positive` CHECK (`baseRevision` >= 1),
  CONSTRAINT `customer_profile_change_customer_fk`
    FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `customer_profile_change_workspace_fk`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customer_approved_profile_operations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  `commandHash` CHAR(64) NOT NULL,
  `changeId` VARCHAR(36) NOT NULL,
  `changeHash` CHAR(64) NOT NULL,
  `baseRevision` INTEGER UNSIGNED NOT NULL,
  `resultRevision` INTEGER UNSIGNED NOT NULL,
  `resultName` VARCHAR(191) NOT NULL,
  `resultHash` CHAR(64) NOT NULL,
  `approvalRef` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `customer_profile_operation_key` (`tenantId`, `customerId`, `operationKey`),
  UNIQUE INDEX `customer_profile_change_once` (`tenantId`, `customerId`, `changeId`),
  CONSTRAINT `customer_profile_operation_revision` CHECK (`baseRevision` >= 1 AND `resultRevision` = `baseRevision` + 1),
  CONSTRAINT `customer_profile_operation_change_fk`
    FOREIGN KEY (`tenantId`, `workspaceId`, `customerId`, `changeId`, `changeHash`)
    REFERENCES `customer_approved_profile_changes` (`tenantId`, `workspaceId`, `customerId`, `id`, `changeHash`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
