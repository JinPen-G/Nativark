ALTER TABLE `rental_tenant_business_settings`
  ADD COLUMN `settingsRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1;

CREATE TABLE `rental_approved_settings_changes` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `changeKey` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `baseRevision` INTEGER UNSIGNED NOT NULL,
  `baseSettingsHash` CHAR(64) NOT NULL,
  `categoryVersionId` VARCHAR(191) NOT NULL,
  `categoryAdoptionRevision` INTEGER NOT NULL,
  `beforeNotifications` JSON NOT NULL,
  `afterNotifications` JSON NOT NULL,
  `changeHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `approved_settings_change_key` (`workspaceId`, `actorId`, `changeKey`),
  UNIQUE INDEX `approved_settings_change_binding` (`tenantId`, `workspaceId`, `id`, `changeHash`),
  CONSTRAINT `approved_settings_change_revision_positive` CHECK (`baseRevision` >= 1),
  CONSTRAINT `rental_approved_settings_changes_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_approved_settings_operations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  `commandHash` CHAR(64) NOT NULL,
  `changeId` VARCHAR(36) NOT NULL,
  `changeHash` CHAR(64) NOT NULL,
  `baseRevision` INTEGER UNSIGNED NOT NULL,
  `resultRevision` INTEGER UNSIGNED NOT NULL,
  `resultHash` CHAR(64) NOT NULL,
  `approvalRef` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `approved_settings_operation_key` (`workspaceId`, `operationKey`),
  UNIQUE INDEX `approved_settings_change_once` (`workspaceId`, `changeId`),
  INDEX `rental_approved_settings_operations_change_binding_idx` (`tenantId`, `workspaceId`, `changeId`, `changeHash`),
  CONSTRAINT `approved_settings_result_revision` CHECK (`baseRevision` >= 1 AND `resultRevision` = `baseRevision` + 1),
  CONSTRAINT `approved_settings_operation_change_fk`
    FOREIGN KEY (`tenantId`, `workspaceId`, `changeId`, `changeHash`)
    REFERENCES `rental_approved_settings_changes` (`tenantId`, `workspaceId`, `id`, `changeHash`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
