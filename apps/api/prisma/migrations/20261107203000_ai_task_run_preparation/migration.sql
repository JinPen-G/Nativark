-- Original Run preparation resource evidence only; no executable plan or new ledger.
-- Forward-only: old runs/charges are not backfilled. Rollback disables new
-- preparation while retaining all original markers, receipts and unknown occupancy.
CREATE TABLE `ai_task_run_preparations` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `definition` JSON NOT NULL,
    `definitionHash` CHAR(64) NOT NULL,
    `authorityHash` CHAR(64) NOT NULL,
    `policyVersion` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `leaseOwnerId` VARCHAR(191) NOT NULL,
    `fencingToken` DECIMAL(20, 0) NOT NULL,
    `runRevision` INTEGER UNSIGNED NOT NULL,
    `chargeId` VARCHAR(36) NULL,
    `requestFingerprint` CHAR(64) NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `activeMs` BIGINT UNSIGNED NULL,
    `prepared` BOOLEAN NOT NULL DEFAULT false,
    `planHash` CHAR(64) NULL,
    `measurementHash` CHAR(64) NULL,
    INDEX `ai_task_run_preparations_run_idx`(`scopeId`, `taskId`, `runId`),
    UNIQUE INDEX `ai_task_run_preparations_generation_key`(`scopeId`, `taskId`, `runId`, `fencingToken`),
    PRIMARY KEY (`scopeId`, `taskId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_task_run_preparations_scopeId_taskId_runId_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_task_run_preparations_scopeId_taskId_chargeId_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `chargeId`) REFERENCES `ai_task_execution_charges`(`scopeId`, `taskId`, `chargeId`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_run_preparation_charge_pair_check`
  CHECK ((`chargeId` IS NULL AND `requestFingerprint` IS NULL) OR (`chargeId` IS NOT NULL AND `requestFingerprint` IS NOT NULL));
ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_run_preparation_receipt_check`
  CHECK ((`completedAt` IS NULL AND `activeMs` IS NULL AND `measurementHash` IS NULL AND `prepared` = false AND `planHash` IS NULL)
    OR (`completedAt` IS NOT NULL AND `activeMs` IS NOT NULL AND `measurementHash` IS NOT NULL
      AND `chargeId` IS NOT NULL AND `requestFingerprint` IS NOT NULL AND `completedAt` >= `startedAt`
      AND ((`prepared` = false AND `planHash` IS NULL) OR (`prepared` = true AND `planHash` IS NOT NULL))));
ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_run_preparation_bounds_check`
  CHECK (`fencingToken` >= 1 AND `fencingToken` <= 18446744073709551615 AND `runRevision` >= 1
    AND (`activeMs` IS NULL OR `activeMs` <= 86400000));
