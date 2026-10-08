CREATE TABLE `ai_client_scene_materials` (
  `id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `principalKind` VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
  `principalHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `bindingHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publicationHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operationKey` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  `inputHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `materialHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `command` JSON NOT NULL,
  `material` JSON NOT NULL,
  `publication` JSON NOT NULL,
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_client_materials_operation_key` (`tenantId`, `workspaceId`, `channel`, `principalHash`, `operationKey`),
  INDEX `ai_client_materials_scope_expiry` (`tenantId`, `workspaceId`, `expiresAt`),
  CONSTRAINT `ai_client_materials_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`)
    REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
