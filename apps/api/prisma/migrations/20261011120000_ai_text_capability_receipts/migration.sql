CREATE TABLE `ai_text_capability_receipts` (
  `id` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `profileId` VARCHAR(36) NOT NULL,
  `operationId` VARCHAR(128) NOT NULL,
  `descriptor` JSON NOT NULL,
  `descriptorHash` CHAR(64) NOT NULL,
  `observation` JSON NULL,
  `observationHash` CHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ai_text_capability_scope_operation_key` (`scopeId`, `operationId`),
  KEY `ai_text_capability_profile_idx` (`profileId`),
  CONSTRAINT `ai_text_capability_profile_fk` FOREIGN KEY (`profileId`) REFERENCES `ai_provider_profiles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
