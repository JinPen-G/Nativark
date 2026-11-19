-- Unapplied, additive human quote-choice receipts; no approval or business mutation.
CREATE TABLE `ai_task_quote_selections` (
  `id` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `originalRequestId` VARCHAR(36) NOT NULL,
  `originalInputHash` CHAR(64) NOT NULL,
  `audience` ENUM('operator','staff','client','automation') NOT NULL,
  `ownerKind` ENUM('saas_admin','user','customer','automation') NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `contractVersion` VARCHAR(64) NOT NULL,
  `selectionKey` VARCHAR(128) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL,
  `quoteId` VARCHAR(191) NOT NULL,
  `quoteHash` CHAR(64) NOT NULL,
  `quoteBasis` JSON NOT NULL,
  `payload` JSON NOT NULL,
  `inputHash` CHAR(64) NOT NULL,
  `selectionFingerprint` CHAR(64) NOT NULL,
  `authorizationBindingHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `supersededAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_quote_selection_key` (`scopeId`,`audience`,`ownerKind`,`ownerId`,`selectionKey`),
  UNIQUE INDEX `ai_quote_selection_revision` (`scopeId`,`taskId`,`runId`,`revision`),
  INDEX `ai_quote_selection_active` (`scopeId`,`taskId`,`runId`,`supersededAt`),
  CONSTRAINT `ai_quote_selection_revision_check` CHECK (`revision` > 0),
  CONSTRAINT `ai_quote_selection_owner_check` CHECK (`ownerKind` = 'user' AND `audience` IN ('operator','staff')),
  CONSTRAINT `ai_quote_selection_expiry_check` CHECK (`expiresAt` > `createdAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ai_task_quote_selections` ADD CONSTRAINT `ai_task_quote_selections_scopeId_originalRequestId_fkey`
  FOREIGN KEY (`scopeId`,`originalRequestId`) REFERENCES `ai_task_original_requests` (`scopeId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_quote_selections` ADD CONSTRAINT `ai_task_quote_selections_scopeId_taskId_runId_fkey`
  FOREIGN KEY (`scopeId`,`taskId`,`runId`) REFERENCES `ai_runs` (`scopeId`,`taskId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
