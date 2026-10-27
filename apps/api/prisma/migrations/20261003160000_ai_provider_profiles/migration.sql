-- Provider, knowledge and usage persistence extends the existing AI foundation.
-- ai_scopes is owned by 20261003060000_ai_task_foundation: reuse its canonical
-- scope-key CHECK, indexes and RESTRICT foreign keys instead of redefining it.

CREATE TABLE `ai_invocation_admissions` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `callId` VARCHAR(128) NOT NULL,
  `requestHash` VARCHAR(128) NOT NULL,
  `profileId` VARCHAR(36) NULL,
  `status` VARCHAR(32) NOT NULL,
  `dispatchId` VARCHAR(128) NULL,
  `unknownReason` VARCHAR(128) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `admittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revokedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  UNIQUE INDEX `ai_invocation_admission_tenant_call_key` (`tenantId`,`callId`),
  INDEX `ai_invocation_admission_scope_status_idx` (`tenantId`,`workspaceId`,`status`),
  INDEX `ai_invocation_admission_expiry_idx` (`status`,`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_usage_reservations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `callId` VARCHAR(128) NOT NULL,
  `idempotencyKey` VARCHAR(128) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `reservedUnits` INT UNSIGNED NOT NULL,
  `actualInput` INT UNSIGNED NULL,
  `actualOutput` INT UNSIGNED NULL,
  `unknownReason` VARCHAR(128) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `settledAt` DATETIME(3) NULL,
  UNIQUE INDEX `ai_usage_reservation_tenant_key` (`tenantId`,`idempotencyKey`),
  UNIQUE INDEX `ai_usage_reservation_tenant_call_key` (`tenantId`,`callId`),
  INDEX `ai_usage_reservation_scope_status_idx` (`tenantId`,`workspaceId`,`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_usage_ledger_entries` (
  `id` VARCHAR(36) NOT NULL,
  `reservationId` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `eventKey` VARCHAR(128) NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `inputUnits` INT UNSIGNED NOT NULL DEFAULT 0,
  `outputUnits` INT UNSIGNED NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_usage_ledger_reservation_event_key` (`reservationId`,`eventKey`),
  INDEX `ai_usage_ledger_tenant_created_idx` (`tenantId`,`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_knowledge_documents` (
  `id` VARCHAR(36) NOT NULL, `tenantId` VARCHAR(191) NOT NULL, `workspaceId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(256) NOT NULL, `status` VARCHAR(32) NOT NULL, `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `withdrawnAt` DATETIME(3) NULL,
  INDEX `ai_knowledge_documents_scope_status_idx` (`tenantId`,`workspaceId`,`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ai_knowledge_versions` (
  `id` VARCHAR(36) NOT NULL, `documentId` VARCHAR(36) NOT NULL, `version` INT UNSIGNED NOT NULL, `status` VARCHAR(32) NOT NULL,
  `contentHash` VARCHAR(128) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_knowledge_versions_document_version_key` (`documentId`,`version`), INDEX `ai_knowledge_versions_document_status_idx` (`documentId`,`status`), PRIMARY KEY (`id`),
  CONSTRAINT `ai_knowledge_versions_document_fk` FOREIGN KEY (`documentId`) REFERENCES `ai_knowledge_documents` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ai_knowledge_chunks` (
  `id` VARCHAR(36) NOT NULL, `versionId` VARCHAR(36) NOT NULL, `chunkIndex` INT UNSIGNED NOT NULL, `text` TEXT NOT NULL, `tokenCount` INT UNSIGNED NOT NULL,
  UNIQUE INDEX `ai_knowledge_chunks_version_index_key` (`versionId`,`chunkIndex`), PRIMARY KEY (`id`),
  CONSTRAINT `ai_knowledge_chunks_version_fk` FOREIGN KEY (`versionId`) REFERENCES `ai_knowledge_versions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ai_knowledge_acl` (
  `id` VARCHAR(36) NOT NULL, `documentId` VARCHAR(36) NOT NULL, `subjectType` VARCHAR(32) NOT NULL, `subjectId` VARCHAR(191) NOT NULL, `permission` VARCHAR(32) NOT NULL,
  UNIQUE INDEX `ai_knowledge_acl_document_subject_key` (`documentId`,`subjectType`,`subjectId`), PRIMARY KEY (`id`),
  CONSTRAINT `ai_knowledge_acl_document_fk` FOREIGN KEY (`documentId`) REFERENCES `ai_knowledge_documents` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ai_knowledge_index_generations` (
  `id` VARCHAR(36) NOT NULL, `tenantId` VARCHAR(191) NOT NULL, `workspaceId` VARCHAR(191) NOT NULL, `generation` INT UNSIGNED NOT NULL, `status` VARCHAR(32) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE INDEX `ai_knowledge_index_scope_generation_key` (`tenantId`,`workspaceId`,`generation`), INDEX `ai_knowledge_index_scope_status_idx` (`tenantId`,`workspaceId`,`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_structured_memories` (
  `id` VARCHAR(36) NOT NULL, `tenantId` VARCHAR(191) NOT NULL, `workspaceId` VARCHAR(191) NOT NULL, `subjectType` VARCHAR(32) NOT NULL, `subjectId` VARCHAR(191) NOT NULL,
  `scopeRevision` INT UNSIGNED NOT NULL, `content` JSON NOT NULL, `contentHash` VARCHAR(128) NOT NULL, `status` VARCHAR(32) NOT NULL, `expiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ai_memory_subject_scope_idx` (`tenantId`,`workspaceId`,`subjectType`,`subjectId`,`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ai_human_confirmations` (
  `id` VARCHAR(36) NOT NULL, `tenantId` VARCHAR(191) NOT NULL, `workspaceId` VARCHAR(191) NOT NULL, `subjectId` VARCHAR(191) NOT NULL, `idempotencyKey` VARCHAR(128) NOT NULL,
  `proposalHash` VARCHAR(128) NOT NULL, `proposalRevision` INT UNSIGNED NOT NULL, `status` VARCHAR(32) NOT NULL, `confirmedBy` VARCHAR(191) NULL, `expiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_human_confirmation_tenant_key` (`tenantId`,`idempotencyKey`), INDEX `ai_human_confirmation_subject_idx` (`tenantId`,`workspaceId`,`subjectId`,`status`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_provider_profiles` (
  `id` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `scopeKind` ENUM('platform','tenant','workspace') NOT NULL,
  `profileKey` VARCHAR(64) NOT NULL,
  `role` ENUM('default','reasoning','vision','embedding') NOT NULL DEFAULT 'default',
  `serviceMode` VARCHAR(32) NOT NULL DEFAULT 'tenant_managed',
  `protocol` VARCHAR(64) NOT NULL,
  `provider` VARCHAR(128) NOT NULL,
  `model` VARCHAR(256) NOT NULL,
  `credentialRef` VARCHAR(191) NOT NULL,
  `configRevision` INT UNSIGNED NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `allowedCapabilities` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `disabledAt` DATETIME(3) NULL,
  UNIQUE INDEX `ai_provider_profiles_scope_key` (`scopeId`,`scopeKind`,`profileKey`),
  UNIQUE INDEX `ai_provider_profiles_scope_role` (`scopeId`,`scopeKind`,`role`),
  INDEX `ai_provider_profiles_route_idx` (`scopeKind`,`serviceMode`,`enabled`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_provider_profiles_scope_fk` FOREIGN KEY (`scopeId`,`scopeKind`) REFERENCES `ai_scopes` (`id`,`kind`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_provider_capability_evidence` (
  `id` VARCHAR(36) NOT NULL,
  `profileId` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `scopeKind` ENUM('platform','tenant','workspace') NOT NULL,
  `capability` VARCHAR(64) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `source` VARCHAR(32) NOT NULL,
  `observedRevision` INT UNSIGNED NOT NULL,
  `evidenceHash` VARCHAR(128) NOT NULL,
  `checkedAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NULL,
  `details` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_provider_capability_evidence_profile_capability_key` (`profileId`,`capability`),
  INDEX `ai_provider_capability_evidence_route_idx` (`scopeId`,`scopeKind`,`capability`,`observedRevision`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_provider_capability_evidence_profile_fk` FOREIGN KEY (`profileId`) REFERENCES `ai_provider_profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
