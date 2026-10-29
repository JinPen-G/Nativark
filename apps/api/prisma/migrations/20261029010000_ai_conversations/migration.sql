-- Independent operator conversation metadata. No copied message body, task
-- transition, business record, model invocation or budget is changed.
CREATE TABLE `ai_conversations` (
  `id` VARCHAR(36) NOT NULL COMMENT 'Conversation identifier, not task authority',
  `scopeId` VARCHAR(36) NOT NULL COMMENT 'Existing canonical workspace scope',
  `ownerId` VARCHAR(191) NOT NULL COMMENT 'Operator owner; current Auth still required',
  `capabilityCode` VARCHAR(64) NOT NULL COMMENT 'Registered scene capability',
  `revision` INTEGER UNSIGNED NOT NULL COMMENT 'CAS version for conversation mutations',
  `status` VARCHAR(16) NOT NULL COMMENT 'active, archived or deleted; not task state',
  `activeTurnId` VARCHAR(36) NULL COMMENT 'Occupied until original completion evidence permits release',
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  `deletedAt` DATETIME(3) NULL COMMENT 'Withdraw ordinary history without cancelling linked tasks',
  UNIQUE INDEX `ai_conversations_owner_key` (`scopeId`, `ownerId`, `id`),
  INDEX `ai_conversations_owner_page` (`scopeId`, `ownerId`, `status`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='AI conversation metadata; business and task records remain independent';

CREATE TABLE `ai_conversation_turns` (
  `id` VARCHAR(36) NOT NULL COMMENT 'Message round identifier',
  `scopeId` VARCHAR(36) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `conversationId` VARCHAR(36) NOT NULL,
  `admissionKey` VARCHAR(128) NOT NULL COMMENT 'Original round key reused after lost replies',
  `admissionRevision` INTEGER UNSIGNED NOT NULL COMMENT 'Original conversation CAS revision, immutable on replay',
  `inputHash` CHAR(64) NOT NULL COMMENT 'Hash of original typed request, no copied text',
  `originalRequestId` VARCHAR(36) NOT NULL COMMENT 'Original immutable authorized request',
  `originalRequestKey` VARCHAR(128) NOT NULL COMMENT 'Server-derived original request deduplication key',
  `capabilityCode` VARCHAR(64) NOT NULL,
  `capabilityVersion` VARCHAR(64) NOT NULL COMMENT 'Actual admitted original scene version',
  `createdAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ai_conversation_turn_admission` (`scopeId`, `ownerId`, `conversationId`, `admissionKey`),
  UNIQUE INDEX `ai_conversation_turn_original` (`scopeId`, `originalRequestId`),
  INDEX `ai_conversation_turn_page` (`scopeId`, `ownerId`, `conversationId`, `id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='AI rounds atomically associated with original requests; no independent execution state';

CREATE TABLE `ai_conversation_operations` (
  `scopeId` VARCHAR(36) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL COMMENT 'Exact metadata operation key',
  `conversationId` VARCHAR(36) NOT NULL,
  `operation` VARCHAR(16) NOT NULL COMMENT 'create, archive, delete or release_turn',
  `inputHash` CHAR(64) NOT NULL COMMENT 'Original command fingerprint',
  `revision` INTEGER UNSIGNED NOT NULL COMMENT 'Acknowledged conversation revision, not current head',
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`scopeId`, `ownerId`, `operationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='AI conversation operation receipts; deleting history does not erase these associations';

ALTER TABLE `ai_conversations` ADD CONSTRAINT `ai_conversations_scopeId_fkey`
  FOREIGN KEY (`scopeId`) REFERENCES `ai_scopes` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_conversation_turns` ADD CONSTRAINT `ai_conversation_turns_scopeId_ownerId_conversationId_fkey`
  FOREIGN KEY (`scopeId`, `ownerId`, `conversationId`) REFERENCES `ai_conversations` (`scopeId`, `ownerId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_conversation_turns` ADD CONSTRAINT `ai_conversation_turns_scopeId_originalRequestId_fkey`
  FOREIGN KEY (`scopeId`, `originalRequestId`) REFERENCES `ai_task_original_requests` (`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_conversation_operations` ADD CONSTRAINT `ai_conversation_operations_scopeId_ownerId_conversationId_fkey`
  FOREIGN KEY (`scopeId`, `ownerId`, `conversationId`) REFERENCES `ai_conversations` (`scopeId`, `ownerId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
