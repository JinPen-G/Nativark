-- Original runner orchestration measurement only; counters remain in the existing task resource ledger.
CREATE TABLE `ai_task_run_overheads` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `segment` VARCHAR(191) NOT NULL,
    `originHash` CHAR(64) NOT NULL,
    `policyHash` CHAR(64) NOT NULL,
    `leaseOwnerId` VARCHAR(191) NOT NULL,
    `fencingToken` DECIMAL(20, 0) NOT NULL,
    `runRevision` INTEGER UNSIGNED NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `chargeId` VARCHAR(36) NULL,
    `requestFingerprint` CHAR(64) NULL,
    `activeMs` BIGINT UNSIGNED NULL,
    `measurementHash` CHAR(64) NULL,
    INDEX `ai_task_run_overheads_run_idx`(`scopeId`, `taskId`, `runId`),
    PRIMARY KEY (`scopeId`, `taskId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_task_run_overheads_scopeId_taskId_runId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_task_run_overheads_scopeId_taskId_chargeId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `chargeId`) REFERENCES `ai_task_execution_charges`(`scopeId`, `taskId`, `chargeId`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_run_overheads_generation_positive` CHECK (`fencingToken` > 0 AND `runRevision` > 0);
ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_run_overheads_original_charge` CHECK ((`chargeId` IS NULL AND `requestFingerprint` IS NULL) OR (`chargeId` IS NOT NULL AND BINARY `id` = BINARY `chargeId` AND `requestFingerprint` IS NOT NULL));
ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_run_overheads_complete_measurement` CHECK ((`completedAt` IS NULL AND `activeMs` IS NULL AND `measurementHash` IS NULL) OR (`completedAt` IS NOT NULL AND `activeMs` IS NOT NULL AND `measurementHash` IS NOT NULL AND `chargeId` IS NOT NULL AND `completedAt` >= `startedAt`));
