ALTER TABLE `ai_structured_memories`
  ADD COLUMN `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `ownerKind` VARCHAR(32) NOT NULL DEFAULT 'user',
  ADD COLUMN `ownerId` VARCHAR(191) NOT NULL DEFAULT 'legacy-unavailable',
  ADD COLUMN `aclRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `confirmationRecordId` VARCHAR(36) NULL,
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `state` JSON NULL;

ALTER TABLE `ai_human_confirmations`
  ADD COLUMN `state` JSON NULL;

CREATE TABLE `ai_memory_operations` (
  `id` VARCHAR(36) NOT NULL,
  `memoryId` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `operationId` VARCHAR(128) NOT NULL,
  `fingerprint` VARCHAR(128) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_memory_operations_scope_key` (`tenantId`, `workspaceId`, `memoryId`, `operationId`),
  INDEX `ai_memory_operations_memory_idx` (`memoryId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
