-- Additive only. Never run automatically on application startup.
ALTER TABLE `ai_client_scene_materials` ADD COLUMN `erasedAt` DATETIME(3) NULL;
ALTER TABLE `ai_task_original_requests` ADD COLUMN `erasedAt` DATETIME(3) NULL;
CREATE TABLE `ai_data_erasures` (
  `id` CHAR(64) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(24) NOT NULL,
  `resourceId` VARCHAR(191) NOT NULL,
  `policyVersion` VARCHAR(64) NOT NULL,
  `targetHash` CHAR(64) NOT NULL,
  `state` VARCHAR(24) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `erasedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `ai_data_erasure_scope_created_idx` (`tenantId`, `workspaceId`, `createdAt`, `id`),
  INDEX `ai_data_erasure_scope_state_idx` (`tenantId`, `workspaceId`, `state`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
