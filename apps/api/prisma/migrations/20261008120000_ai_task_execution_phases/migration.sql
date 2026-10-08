-- Additive execution facts only; no backfill, dispatch, or monetary ledger.
CREATE TABLE `ai_task_execution_phase_starts` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `stepId` VARCHAR(36) NOT NULL,
    `originalArtifactId` VARCHAR(36) NOT NULL,
    `inputRef` VARCHAR(36) NOT NULL,
    `stepsChargeId` VARCHAR(36) NOT NULL,
    `activeMsChargeId` VARCHAR(36) NOT NULL,
    `outputBytesChargeId` VARCHAR(36) NOT NULL,
    `actionId` VARCHAR(191) NOT NULL,
    `leaseOwnerId` VARCHAR(191) NOT NULL,
    `stepFingerprint` CHAR(64) NOT NULL,
    `planHash` CHAR(64) NOT NULL,
    `fencingToken` DECIMAL(20, 0) NOT NULL,
    `runRevision` INTEGER UNSIGNED NOT NULL,
    `stepRevision` INTEGER UNSIGNED NOT NULL,
    `sequence` INTEGER UNSIGNED NOT NULL,
    `previousReceiptId` VARCHAR(36) NULL,
    `decisionRef` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ai_exec_phase_start_identity_key`(`scopeId`, `taskId`, `runId`, `stepId`, `id`),
    UNIQUE INDEX `ai_exec_phase_start_sequence_key`(`scopeId`, `taskId`, `stepId`, `sequence`),
    UNIQUE INDEX `ai_exec_phase_start_previous_key`(`scopeId`, `taskId`, `previousReceiptId`),
    PRIMARY KEY (`scopeId`, `taskId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_execution_phase_receipts` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `stepId` VARCHAR(36) NOT NULL,
    `phaseId` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `errorCode` VARCHAR(128) NULL,
    `payload` JSON NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `activeMs` BIGINT UNSIGNED NOT NULL,
    `outputBytes` BIGINT UNSIGNED NOT NULL,
    `proposalId` VARCHAR(36) NULL,
    `proposalRevision` INTEGER UNSIGNED NULL,
    `reviewedPayloadHash` CHAR(64) NULL,
    `decisionRef` VARCHAR(36) NULL,
    `businessResultRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ai_exec_phase_receipt_phase_key`(`scopeId`, `taskId`, `phaseId`),
    UNIQUE INDEX `ai_exec_phase_receipt_identity_key`(`scopeId`, `taskId`, `runId`, `stepId`, `id`),
    PRIMARY KEY (`scopeId`, `taskId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `ai_approvals_scope_task_id` ON `ai_approvals`(`scopeId`, `taskId`, `id`);

ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_run_fk` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_step_fk` FOREIGN KEY (`scopeId`, `taskId`, `stepId`) REFERENCES `ai_steps`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_artifact_fk` FOREIGN KEY (`scopeId`, `taskId`, `runId`, `stepId`, `originalArtifactId`) REFERENCES `ai_task_result_artifacts`(`scopeId`, `taskId`, `runId`, `stepId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_input_fk` FOREIGN KEY (`scopeId`, `taskId`, `inputRef`) REFERENCES `ai_task_action_inputs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_plan_fk` FOREIGN KEY (`scopeId`, `taskId`, `runId`, `planHash`) REFERENCES `ai_task_run_plans`(`scopeId`, `taskId`, `runId`, `planHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_steps_charge_fk` FOREIGN KEY (`scopeId`, `taskId`, `stepsChargeId`) REFERENCES `ai_task_execution_charges`(`scopeId`, `taskId`, `chargeId`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_active_charge_fk` FOREIGN KEY (`scopeId`, `taskId`, `activeMsChargeId`) REFERENCES `ai_task_execution_charges`(`scopeId`, `taskId`, `chargeId`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_output_charge_fk` FOREIGN KEY (`scopeId`, `taskId`, `outputBytesChargeId`) REFERENCES `ai_task_execution_charges`(`scopeId`, `taskId`, `chargeId`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_previous_fk` FOREIGN KEY (`scopeId`, `taskId`, `runId`, `stepId`, `previousReceiptId`) REFERENCES `ai_task_execution_phase_receipts`(`scopeId`, `taskId`, `runId`, `stepId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_starts` ADD CONSTRAINT `ai_exec_phase_start_decision_fk` FOREIGN KEY (`scopeId`, `taskId`, `decisionRef`) REFERENCES `ai_approvals`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_receipts` ADD CONSTRAINT `ai_exec_phase_receipt_start_fk` FOREIGN KEY (`scopeId`, `taskId`, `runId`, `stepId`, `phaseId`) REFERENCES `ai_task_execution_phase_starts`(`scopeId`, `taskId`, `runId`, `stepId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_receipts` ADD CONSTRAINT `ai_exec_phase_receipt_proposal_fk` FOREIGN KEY (`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `reviewedPayloadHash`) REFERENCES `ai_proposal_versions`(`scopeId`, `taskId`, `proposalId`, `revision`, `payloadHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_execution_phase_receipts` ADD CONSTRAINT `ai_exec_phase_receipt_decision_fk` FOREIGN KEY (`scopeId`, `taskId`, `decisionRef`, `proposalId`, `proposalRevision`) REFERENCES `ai_approvals`(`scopeId`, `taskId`, `id`, `proposalId`, `proposalRevision`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_phase_starts`
  ADD CONSTRAINT `ai_exec_phase_start_versions_check` CHECK (`fencingToken` > 0 AND `runRevision` BETWEEN 1 AND 4294967294 AND `stepRevision` BETWEEN 1 AND 4294967294),
  ADD CONSTRAINT `ai_exec_phase_start_sequence_check` CHECK ((`sequence` = 1 AND `previousReceiptId` IS NULL AND `decisionRef` IS NULL) OR (`sequence` = 2 AND `previousReceiptId` IS NOT NULL AND `decisionRef` IS NOT NULL)),
  ADD CONSTRAINT `ai_exec_phase_start_charges_check` CHECK (`stepsChargeId` <> `activeMsChargeId` AND `stepsChargeId` <> `outputBytesChargeId` AND `activeMsChargeId` <> `outputBytesChargeId`),
  ADD CONSTRAINT `ai_exec_phase_start_hash_check` CHECK (REGEXP_LIKE(`stepFingerprint`, '^[a-f0-9]{64}$', 'c') AND REGEXP_LIKE(`planHash`, '^[a-f0-9]{64}$', 'c'));

ALTER TABLE `ai_task_execution_phase_receipts`
  ADD CONSTRAINT `ai_exec_phase_receipt_kind_check` CHECK (BINARY `kind` IN ('confirmation', 'succeeded', 'failed', 'unknown')),
  ADD CONSTRAINT `ai_exec_phase_receipt_hash_check` CHECK (REGEXP_LIKE(`contentHash`, '^[a-f0-9]{64}$', 'c')),
  ADD CONSTRAINT `ai_exec_phase_receipt_proposal_check` CHECK ((`proposalId` IS NULL AND `proposalRevision` IS NULL AND `reviewedPayloadHash` IS NULL) OR (`proposalId` IS NOT NULL AND `proposalRevision` IS NOT NULL AND `reviewedPayloadHash` IS NOT NULL AND `proposalRevision` BETWEEN 1 AND 4294967294 AND REGEXP_LIKE(`reviewedPayloadHash`, '^[a-f0-9]{64}$', 'c'))),
  ADD CONSTRAINT `ai_exec_phase_receipt_decision_check` CHECK (`decisionRef` IS NULL OR `proposalId` IS NOT NULL),
  ADD CONSTRAINT `ai_exec_phase_receipt_wait_check` CHECK (`kind` <> 'confirmation' OR (`proposalId` IS NOT NULL AND `decisionRef` IS NULL AND `businessResultRef` IS NULL AND `errorCode` IS NULL)),
  ADD CONSTRAINT `ai_exec_phase_receipt_success_check` CHECK (`kind` <> 'succeeded' OR (`businessResultRef` IS NOT NULL AND `errorCode` IS NULL)),
  ADD CONSTRAINT `ai_exec_phase_receipt_failure_check` CHECK (`kind` <> 'failed' OR (`errorCode` IS NOT NULL AND `businessResultRef` IS NULL));
