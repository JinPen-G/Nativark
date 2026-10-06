-- Additive only: old runs receive no implicit input request, receipt or authority.
CREATE UNIQUE INDEX `ai_task_run_plans_hash_key` ON `ai_task_run_plans`(`scopeId`, `taskId`, `runId`, `planHash`);
CREATE UNIQUE INDEX `ai_task_result_artifacts_input_basis_key` ON `ai_task_result_artifacts`(`scopeId`, `taskId`, `runId`, `stepId`, `id`);

CREATE TABLE `ai_task_input_requests` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `id` VARCHAR(36) NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `stepId` VARCHAR(36) NOT NULL,
  `planHash` CHAR(64) NOT NULL,
  `planRevision` INTEGER UNSIGNED NOT NULL,
  `inputRef` VARCHAR(191) NOT NULL,
  `inputHash` CHAR(64) NOT NULL,
  `contractCode` VARCHAR(64) NOT NULL,
  `contractVersion` VARCHAR(64) NOT NULL,
  `contractHash` CHAR(64) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `allowedFields` JSON NOT NULL,
  `basisResultRef` VARCHAR(36) NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `leaseOwnerId` VARCHAR(191) NOT NULL,
  `fencingToken` DECIMAL(20,0) NOT NULL,
  `waitingTaskRevision` INTEGER UNSIGNED NOT NULL,
  `status` ENUM('pending','consumed') NOT NULL DEFAULT 'pending',
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`scopeId`, `taskId`, `id`),
  UNIQUE INDEX `ai_task_input_requests_plan_key` (`scopeId`, `taskId`, `id`, `planHash`),
  UNIQUE INDEX `ai_task_input_requests_pause_key` (`scopeId`, `taskId`, `runId`, `stepId`, `planHash`),
  INDEX `ai_task_input_requests_pending_idx` (`scopeId`, `taskId`, `status`, `expiresAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_input_receipts` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `id` VARCHAR(36) NOT NULL,
  `requestId` VARCHAR(36) NOT NULL,
  `planHash` CHAR(64) NOT NULL,
  `submissionKey` VARCHAR(191) NOT NULL,
  `answerHash` CHAR(64) NOT NULL,
  `answers` JSON NOT NULL,
  `actorKind` ENUM('saas_admin','user','customer','automation') NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `audience` ENUM('operator','staff','client','automation') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `consumedAt` DATETIME(3) NULL,
  `consumedTaskRevision` INTEGER UNSIGNED NULL,
  PRIMARY KEY (`scopeId`, `taskId`, `id`),
  UNIQUE INDEX `ai_task_input_receipts_request_key` (`scopeId`, `taskId`, `requestId`),
  UNIQUE INDEX `ai_task_input_receipts_request_plan_key` (`scopeId`, `taskId`, `requestId`, `planHash`),
  UNIQUE INDEX `ai_task_input_receipts_submission_key` (`scopeId`, `taskId`, `submissionKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_task_input_requests` ADD CONSTRAINT `ai_task_input_requests_plan_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `runId`, `planHash`) REFERENCES `ai_task_run_plans` (`scopeId`, `taskId`, `runId`, `planHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_input_requests` ADD CONSTRAINT `ai_task_input_requests_basis_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `runId`, `stepId`, `basisResultRef`) REFERENCES `ai_task_result_artifacts` (`scopeId`, `taskId`, `runId`, `stepId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_input_receipts` ADD CONSTRAINT `ai_task_input_receipts_request_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `requestId`, `planHash`) REFERENCES `ai_task_input_requests` (`scopeId`, `taskId`, `id`, `planHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;
