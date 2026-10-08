-- Additive, unapplied creation-input storage; existing task creationKey remains the creation receipt.
CREATE TABLE `ai_task_original_requests` (
  `id` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `audience` ENUM('operator','staff','client','automation') NOT NULL,
  `ownerKind` ENUM('saas_admin','user','customer','automation') NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `contractVersion` VARCHAR(64) NOT NULL,
  `sceneCode` VARCHAR(64) NOT NULL,
  `sceneVersion` VARCHAR(64) NOT NULL,
  `requestKey` VARCHAR(128) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL,
  `payload` JSON NOT NULL,
  `contentHash` CHAR(64) NOT NULL,
  `authorizationBindingHash` CHAR(64) NOT NULL,
  `policyRevision` INTEGER UNSIGNED NOT NULL,
  `policyHash` CHAR(64) NOT NULL,
  `previousRequestId` VARCHAR(36) NULL,
  `status` ENUM('stored','revoked') NOT NULL DEFAULT 'stored',
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_original_requests_scope_id` (`scopeId`,`id`),
  UNIQUE INDEX `ai_original_requests_request_key` (`scopeId`,`audience`,`ownerKind`,`ownerId`,`requestKey`),
  INDEX `ai_original_requests_owner` (`scopeId`,`audience`,`ownerKind`,`ownerId`,`createdAt`),
  CONSTRAINT `ai_original_requests_revision_check` CHECK (`revision` > 0 AND `policyRevision` > 0),
  CONSTRAINT `ai_original_requests_owner_check` CHECK (`ownerKind` = 'user' AND `audience` IN ('operator','staff')),
  CONSTRAINT `ai_original_requests_expiry_check` CHECK (`expiresAt` > `createdAt`),
  CONSTRAINT `ai_original_requests_parent_check` CHECK ((`previousRequestId` IS NULL AND `revision` = 1) OR (`previousRequestId` IS NOT NULL AND `previousRequestId` <> `id` AND `revision` > 1)),
  CONSTRAINT `ai_original_requests_hash_check` CHECK (REGEXP_LIKE(`contentHash`, '^[a-f0-9]{64}$', 'c') AND REGEXP_LIKE(`authorizationBindingHash`, '^[a-f0-9]{64}$', 'c') AND REGEXP_LIKE(`policyHash`, '^[a-f0-9]{64}$', 'c'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `ai_task_original_requests` ADD CONSTRAINT `ai_task_original_requests_scopeId_fkey`
  FOREIGN KEY (`scopeId`) REFERENCES `ai_scopes` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_task_original_requests` ADD CONSTRAINT `ai_task_original_requests_scopeId_previousRequestId_fkey`
  FOREIGN KEY (`scopeId`,`previousRequestId`) REFERENCES `ai_task_original_requests` (`scopeId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
