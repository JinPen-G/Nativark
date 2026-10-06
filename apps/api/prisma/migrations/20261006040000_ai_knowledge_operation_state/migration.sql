ALTER TABLE `ai_knowledge_documents`
  ADD COLUMN `state` JSON NULL;

ALTER TABLE `ai_knowledge_chunks`
  ADD COLUMN `state` JSON NULL;

CREATE TABLE `ai_knowledge_operations` (
  `id` VARCHAR(36) NOT NULL,
  `documentId` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `operationId` VARCHAR(128) NOT NULL,
  `fingerprint` VARCHAR(128) NOT NULL,
  `failure` VARCHAR(32) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_knowledge_operations_scope_key` (`tenantId`, `workspaceId`, `documentId`, `operationId`),
  INDEX `ai_knowledge_operations_document_idx` (`documentId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_knowledge_operations_document_fk` FOREIGN KEY (`documentId`) REFERENCES `ai_knowledge_documents` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
