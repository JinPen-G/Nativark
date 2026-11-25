CREATE UNIQUE INDEX `ai_steps_scope_task_id` ON `ai_steps` (`scopeId`, `taskId`, `id`);
CREATE UNIQUE INDEX `ai_gateway_invocations_scope_task_id` ON `ai_gateway_invocations` (`scopeId`, `taskId`, `id`);

CREATE TABLE `ai_task_execution_budgets` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `policyVersion` VARCHAR(64) NOT NULL,
  `policyFingerprint` CHAR(64) NOT NULL,
  `maxSteps` BIGINT UNSIGNED NOT NULL,
  `maxCalls` BIGINT UNSIGNED NOT NULL,
  `maxActiveMs` BIGINT UNSIGNED NOT NULL,
  `maxOutputBytes` BIGINT UNSIGNED NOT NULL,
  `reservedSteps` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `consumedSteps` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `reservedCalls` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `consumedCalls` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `reservedActiveMs` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `consumedActiveMs` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `reservedOutputBytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `consumedOutputBytes` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`scopeId`, `taskId`),
  CONSTRAINT `ai_task_execution_budgets_task_fk` FOREIGN KEY (`scopeId`, `taskId`)
    REFERENCES `ai_tasks` (`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_execution_charges` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `chargeId` VARCHAR(36) NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `stepId` VARCHAR(36) NULL,
  `actionId` VARCHAR(191) NULL,
  `stepFingerprint` CHAR(64) NULL,
  `gatewayInvocationId` VARCHAR(36) NULL,
  `leaseOwnerId` VARCHAR(191) NOT NULL,
  `fencingToken` DECIMAL(20,0) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `resource` ENUM('steps','calls','active_ms','output_bytes') NOT NULL,
  `amount` BIGINT UNSIGNED NOT NULL,
  `actualAmount` BIGINT UNSIGNED NULL,
  `status` ENUM('reserved','recorded','unknown') NOT NULL DEFAULT 'reserved',
  `outcomeFingerprint` CHAR(64) NULL,
  `evidenceRef` VARCHAR(191) NULL,
  `unknownReason` VARCHAR(128) NULL,
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`scopeId`, `taskId`, `chargeId`),
  INDEX `ai_task_execution_charges_status_idx` (`scopeId`, `taskId`, `status`),
  INDEX `ai_task_execution_charges_run_idx` (`scopeId`, `taskId`, `runId`),
  CONSTRAINT `ai_task_execution_charges_budget_fk` FOREIGN KEY (`scopeId`, `taskId`)
    REFERENCES `ai_task_execution_budgets` (`scopeId`, `taskId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_task_execution_charges_run_fk` FOREIGN KEY (`scopeId`, `taskId`, `runId`)
    REFERENCES `ai_runs` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_task_execution_charges_step_fk` FOREIGN KEY (`scopeId`, `taskId`, `stepId`)
    REFERENCES `ai_steps` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_task_execution_charges_invocation_fk` FOREIGN KEY (`scopeId`, `taskId`, `gatewayInvocationId`)
    REFERENCES `ai_gateway_invocations` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
