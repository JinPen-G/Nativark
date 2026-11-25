CREATE TABLE `ai_task_action_policies` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `operation` VARCHAR(64) NOT NULL,
  `revision` INT UNSIGNED NOT NULL,
  `requiredPermissions` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`scopeId`, `taskId`, `operation`),
  INDEX `ai_task_action_policies_expiry_idx` (`scopeId`, `expiresAt`),
  CONSTRAINT `ai_task_action_policies_task_fkey` FOREIGN KEY (`scopeId`, `taskId`)
    REFERENCES `ai_tasks` (`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
