-- Default closed, no policy/input seed. Existing task/run tables precede these FK targets.
CREATE TABLE `ai_task_plan_policies` (
  `scopeId` VARCHAR(36) NOT NULL,
  `sceneCode` VARCHAR(64) NOT NULL,
  `sceneVersion` VARCHAR(64) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `allowedTools` JSON NOT NULL,
  `limits` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ai_task_plan_policies_expiry_idx`(`scopeId`, `expiresAt`),
  PRIMARY KEY (`scopeId`, `sceneCode`, `sceneVersion`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ai_task_action_inputs` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `id` VARCHAR(36) NOT NULL,
  `registrationRef` VARCHAR(191) NOT NULL,
  `toolCode` VARCHAR(64) NOT NULL,
  `toolVersion` VARCHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `policyRevision` INTEGER UNSIGNED NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_task_action_inputs_id_key`(`scopeId`, `taskId`, `id`),
  PRIMARY KEY (`scopeId`, `taskId`, `runId`, `registrationRef`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ai_task_plan_policies` ADD CONSTRAINT `ai_task_plan_policies_scope_fkey`
  FOREIGN KEY (`scopeId`) REFERENCES `ai_scopes`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_action_inputs` ADD CONSTRAINT `ai_task_action_inputs_run_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
