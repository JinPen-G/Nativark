CREATE TABLE `ai_task_run_plans` (
 `scopeId` VARCHAR(36) NOT NULL, `taskId` VARCHAR(36) NOT NULL, `runId` VARCHAR(36) NOT NULL,
 `planHash` CHAR(64) NOT NULL, `authorityHash` CHAR(64) NOT NULL, `policyVersion` VARCHAR(64) NOT NULL,
 `payload` JSON NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`scopeId`, `taskId`, `runId`),
 CONSTRAINT `ai_task_run_plans_run_fkey` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_result_artifacts` (
 `scopeId` VARCHAR(36) NOT NULL, `taskId` VARCHAR(36) NOT NULL, `id` VARCHAR(36) NOT NULL,
 `runId` VARCHAR(36) NOT NULL, `stepId` VARCHAR(36) NOT NULL, `actionId` VARCHAR(191) NOT NULL,
 `stepFingerprint` CHAR(64) NOT NULL, `leaseOwnerId` VARCHAR(191) NOT NULL, `fencingToken` DECIMAL(20,0) NOT NULL,
 `outcome` ENUM('pending','running','succeeded','failed','unknown','cancelled') NOT NULL,
 `errorCode` VARCHAR(128) NULL,
 `payload` JSON NOT NULL, `contentHash` CHAR(64) NOT NULL,
 `outputBytes` BIGINT UNSIGNED NOT NULL, `activeMs` BIGINT UNSIGNED NOT NULL,
 `completeMeasurement` BOOLEAN NOT NULL DEFAULT false, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`scopeId`, `taskId`, `id`),
 UNIQUE INDEX `ai_result_artifact_step_generation_key` (`scopeId`, `taskId`, `runId`, `stepId`, `fencingToken`),
 CONSTRAINT `ai_task_result_artifacts_step_fkey` FOREIGN KEY (`scopeId`, `taskId`, `stepId`) REFERENCES `ai_steps` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
