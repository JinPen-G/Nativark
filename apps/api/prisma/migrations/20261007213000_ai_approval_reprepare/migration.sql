CREATE TABLE `ai_approval_reprepares` (
    `id` VARCHAR(36) NOT NULL,
    `scopeId` VARCHAR(36) NOT NULL,
    `operationKey` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `commandHash` CHAR(64) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `audience` ENUM('operator', 'staff', 'client', 'automation') NOT NULL,
    `originalTaskId` VARCHAR(36) NOT NULL,
    `originalProposalId` VARCHAR(36) NOT NULL,
    `originalRevision` INTEGER UNSIGNED NOT NULL,
    `originalPayloadHash` CHAR(64) NOT NULL,
    `originalActionId` VARCHAR(191) NOT NULL,
    `originalFingerprint` CHAR(64) NOT NULL,
    `replacementTaskId` VARCHAR(36) NOT NULL,
    `replacementRunId` VARCHAR(36) NOT NULL,
    `replacementActionId` VARCHAR(191) NOT NULL,
    `replacementFingerprint` CHAR(64) NOT NULL,
    `replacementInputRef` VARCHAR(36) NOT NULL,
    `originalInputRef` VARCHAR(191) NOT NULL,
    `quoteSelectionRef` VARCHAR(36) NOT NULL,
    `planHash` CHAR(64) NOT NULL,
    `proofHash` CHAR(64) NOT NULL,
    `replacementProposalId` VARCHAR(36) NOT NULL,
    `replacementRevision` INTEGER UNSIGNED NOT NULL,
    `replacementPayloadHash` CHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ai_reprepares_operation_key`(`scopeId`, `operationKey`),
    UNIQUE INDEX `ai_reprepares_original_key`(`scopeId`, `originalTaskId`, `originalProposalId`, `originalRevision`),
    UNIQUE INDEX `ai_reprepares_replacement_key`(`scopeId`, `replacementTaskId`, `replacementActionId`),
    CONSTRAINT `ai_reprepares_distinct_task_check` CHECK (`originalTaskId` <> `replacementTaskId`),
    CONSTRAINT `ai_reprepares_human_check` CHECK (`audience` IN ('operator', 'staff')),
    CONSTRAINT `ai_reprepares_revision_check` CHECK (`originalRevision` > 0 AND `replacementRevision` > 0),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_approval_reprepares` ADD CONSTRAINT `ai_reprepares_original_version_fk` FOREIGN KEY (`scopeId`, `originalTaskId`, `originalProposalId`, `originalRevision`, `originalPayloadHash`) REFERENCES `ai_proposal_versions`(`scopeId`, `taskId`, `proposalId`, `revision`, `payloadHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_approval_reprepares` ADD CONSTRAINT `ai_reprepares_original_action_fk` FOREIGN KEY (`scopeId`, `originalTaskId`, `originalProposalId`, `originalRevision`, `originalActionId`, `originalFingerprint`) REFERENCES `ai_proposal_actions`(`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `requestFingerprint`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_approval_reprepares` ADD CONSTRAINT `ai_reprepares_replacement_run_fk` FOREIGN KEY (`scopeId`, `replacementTaskId`, `replacementRunId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_approval_reprepares` ADD CONSTRAINT `ai_reprepares_replacement_step_fk` FOREIGN KEY (`scopeId`, `replacementTaskId`, `replacementActionId`, `replacementFingerprint`) REFERENCES `ai_steps`(`scopeId`, `taskId`, `actionId`, `requestFingerprint`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_approval_reprepares` ADD CONSTRAINT `ai_reprepares_replacement_version_fk` FOREIGN KEY (`scopeId`, `replacementTaskId`, `replacementProposalId`, `replacementRevision`, `replacementPayloadHash`) REFERENCES `ai_proposal_versions`(`scopeId`, `taskId`, `proposalId`, `revision`, `payloadHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;
