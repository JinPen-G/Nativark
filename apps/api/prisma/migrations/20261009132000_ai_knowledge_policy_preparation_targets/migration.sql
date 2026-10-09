ALTER TABLE `ai_knowledge_policy_management_authorities` ADD COLUMN `preparationTarget` JSON NULL;

CREATE TABLE `ai_knowledge_policy_preparation_targets` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(128) NOT NULL,
  `workspaceId` VARCHAR(128) NOT NULL,
  `managerId` VARCHAR(128) NOT NULL,
  `targetActorId` VARCHAR(128) NOT NULL,
  `targetAudience` VARCHAR(32) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `documentId` VARCHAR(128) NOT NULL,
  `specJson` JSON NOT NULL,
  `specHash` CHAR(64) NOT NULL,
  `authorityId` VARCHAR(36) NOT NULL,
  `authorityRevision` INTEGER UNSIGNED NOT NULL,
  `authorizationHash` CHAR(64) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(16) NOT NULL DEFAULT 'prepared',
  `expiresAt` DATETIME(3) NOT NULL,
  `uploadSessionId` VARCHAR(191) NULL,
  `attachmentId` VARCHAR(191) NULL,
  `bindingHash` CHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `boundAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_kp_target_document_key` (`documentId`),
  UNIQUE INDEX `ai_kp_target_operation_key` (`tenantId`, `workspaceId`, `managerId`, `operationKey`),
  UNIQUE INDEX `ai_kp_target_session_key` (`uploadSessionId`),
  UNIQUE INDEX `ai_kp_target_attachment_key` (`attachmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_knowledge_policy_preparation_targets` ADD CONSTRAINT `ai_kp_target_authority_fk`
  FOREIGN KEY (`tenantId`, `workspaceId`, `authorityId`) REFERENCES `ai_knowledge_policy_management_authorities` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
