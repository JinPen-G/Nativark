-- Fresh public AI installation. Existing mixed migration receipts are not aliases for this file.
CREATE TABLE `ai_legacy_b02_scopes` (
  `id` VARCHAR(36) NOT NULL COMMENT 'Original B02 scope ID; never a new authorization',
  `kind` ENUM('platform','tenant','workspace') NOT NULL COMMENT 'Original scope kind, not a live principal',
  `scopeKey` VARCHAR(512) NOT NULL COMMENT 'Exact original key before canonical projection',
  `tenantId` VARCHAR(191) NULL COMMENT 'Original owner reference; no current access grant',
  `workspaceId` VARCHAR(191) NULL COMMENT 'Original workspace reference; no fallback resolution',
  `createdAt` DATETIME(3) NOT NULL COMMENT 'Exact original creation time',
  `updatedAt` DATETIME(3) NOT NULL COMMENT 'Exact original update time; immutable provenance',
  `sourceSqlSha256` CHAR(64) NOT NULL COMMENT 'Exact original B02 SQL-byte checksum',
  PRIMARY KEY (`id`),
  INDEX `ai_legacy_b02_scopes_owner` (`tenantId`,`workspaceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  COMMENT 'Immutable standalone B02 origin; not consulted for current authorization or routing';

CREATE TABLE `ai_scopes` (
    `id` VARCHAR(36) NOT NULL,
    `kind` ENUM('platform', 'tenant', 'workspace') NOT NULL,
    `scopeKey` VARCHAR(512) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `workspaceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_scopes_key`(`scopeKey`),
    INDEX `ai_scopes_tenant_workspace`(`tenantId`, `workspaceId`),
    UNIQUE INDEX `ai_scopes_id_kind`(`id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_tasks` (
    `id` VARCHAR(36) NOT NULL,
    `scopeId` VARCHAR(36) NOT NULL,
    `scopeKind` ENUM('platform', 'tenant', 'workspace') NOT NULL,
    `audience` ENUM('operator', 'staff', 'client', 'automation') NOT NULL,
    `ownerKind` ENUM('saas_admin', 'user', 'customer', 'automation') NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `policyId` VARCHAR(191) NULL,
    `policyRevision` INTEGER UNSIGNED NULL,
    `policyExpiresAt` DATETIME(3) NULL,
    `contractVersion` VARCHAR(64) NOT NULL,
    `sceneCode` VARCHAR(128) NOT NULL,
    `sceneVersion` VARCHAR(64) NOT NULL,
    `traceId` VARCHAR(191) NOT NULL,
    `status` ENUM('queued', 'running', 'waiting_input', 'waiting_confirmation', 'waiting_external', 'cancel_requested', 'succeeded', 'partially_succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
    `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `eventCursor` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `inputRef` VARCHAR(191) NULL,
    `resultRef` VARCHAR(191) NULL,
    `cancelRequestedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ai_tasks_trace`(`traceId`),
    INDEX `ai_tasks_owner`(`scopeId`, `audience`, `ownerKind`, `ownerId`, `createdAt`),
    INDEX `ai_tasks_status`(`scopeId`, `status`, `updatedAt`),
    UNIQUE INDEX `ai_tasks_scope_id`(`scopeId`, `id`),
    UNIQUE INDEX `ai_tasks_scope_actor_kind`(`scopeId`, `id`, `ownerKind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_runs` (
    `id` VARCHAR(36) NOT NULL,
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `actorKind` ENUM('saas_admin', 'user', 'customer', 'automation') NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `authorizedAt` DATETIME(3) NOT NULL,
    `sequence` INTEGER UNSIGNED NOT NULL,
    `status` ENUM('queued', 'running', 'waiting_input', 'waiting_confirmation', 'waiting_external', 'cancel_requested', 'succeeded', 'partially_succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
    `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `fencingToken` DECIMAL(20, 0) NOT NULL DEFAULT 0,
    `leaseOwnerId` VARCHAR(191) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `gatewayRouteRef` VARCHAR(191) NULL,
    `promptVersion` VARCHAR(191) NULL,
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ai_runs_recovery`(`status`, `leaseExpiresAt`),
    UNIQUE INDEX `ai_runs_scope_task_id`(`scopeId`, `taskId`, `id`),
    UNIQUE INDEX `ai_runs_sequence`(`scopeId`, `taskId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_steps` (
    `id` VARCHAR(36) NOT NULL,
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `sequence` INTEGER UNSIGNED NOT NULL,
    `actionId` VARCHAR(191) NOT NULL,
    `requestFingerprint` CHAR(64) NOT NULL,
    `toolCode` VARCHAR(191) NOT NULL,
    `toolVersion` VARCHAR(191) NOT NULL,
    `status` ENUM('pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled') NOT NULL DEFAULT 'pending',
    `effect` ENUM('none', 'possible', 'committed') NOT NULL DEFAULT 'none',
    `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `inputRef` VARCHAR(191) NULL,
    `resultRef` VARCHAR(191) NULL,
    `errorCode` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ai_steps_task_status`(`scopeId`, `taskId`, `status`),
    UNIQUE INDEX `ai_steps_action`(`scopeId`, `taskId`, `actionId`),
    UNIQUE INDEX `ai_steps_action_fingerprint`(`scopeId`, `taskId`, `actionId`, `requestFingerprint`),
    UNIQUE INDEX `ai_steps_sequence`(`scopeId`, `runId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_proposals` (
    `id` VARCHAR(36) NOT NULL,
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `stateRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `currentRevision` INTEGER UNSIGNED NULL,
    `status` ENUM('pending_confirmation', 'confirmed', 'superseded', 'cancelled', 'expired') NOT NULL DEFAULT 'pending_confirmation',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ai_proposals_task_status`(`scopeId`, `taskId`, `status`),
    UNIQUE INDEX `ai_proposals_scope_task_id`(`scopeId`, `taskId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_proposal_versions` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `proposalId` VARCHAR(36) NOT NULL,
    `revision` INTEGER UNSIGNED NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_proposal_versions_scope_task`(`scopeId`, `taskId`, `proposalId`, `revision`),
    UNIQUE INDEX `ai_proposal_versions_hash`(`scopeId`, `taskId`, `proposalId`, `revision`, `payloadHash`),
    PRIMARY KEY (`scopeId`, `proposalId`, `revision`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_proposal_actions` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `proposalId` VARCHAR(36) NOT NULL,
    `proposalRevision` INTEGER UNSIGNED NOT NULL,
    `actionId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER UNSIGNED NOT NULL,
    `requestFingerprint` CHAR(64) NOT NULL,

    UNIQUE INDEX `ai_proposal_actions_binding`(`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `requestFingerprint`),
    UNIQUE INDEX `ai_proposal_actions_sequence`(`scopeId`, `proposalId`, `proposalRevision`, `sequence`),
    PRIMARY KEY (`scopeId`, `proposalId`, `proposalRevision`, `actionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_approvals` (
    `id` VARCHAR(36) NOT NULL,
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `proposalId` VARCHAR(36) NOT NULL,
    `proposalRevision` INTEGER UNSIGNED NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `audience` ENUM('operator', 'staff', 'client', 'automation') NOT NULL,
    `actorKind` ENUM('saas_admin', 'user', 'customer', 'automation') NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `decision` ENUM('approved', 'rejected') NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ai_approvals_binding`(`scopeId`, `taskId`, `id`, `proposalId`, `proposalRevision`),
    UNIQUE INDEX `ai_approvals_actor_decision`(`scopeId`, `proposalId`, `proposalRevision`, `actorKind`, `actorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_approval_consumptions` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `actionId` VARCHAR(191) NOT NULL,
    `approvalId` VARCHAR(36) NOT NULL,
    `proposalId` VARCHAR(36) NOT NULL,
    `proposalRevision` INTEGER UNSIGNED NOT NULL,
    `actionFingerprint` CHAR(64) NOT NULL,
    `businessIdempotencyKey` VARCHAR(191) NOT NULL,
    `status` ENUM('reserved', 'committed', 'unknown', 'failed_no_effect') NOT NULL DEFAULT 'reserved',
    `resultRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ai_consumptions_business_key`(`scopeId`, `businessIdempotencyKey`),
    PRIMARY KEY (`scopeId`, `taskId`, `actionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_events` (
    `cursor` BIGINT UNSIGNED NOT NULL,
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `taskRevision` INTEGER UNSIGNED NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `payload` JSON NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`scopeId`, `taskId`, `cursor`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_scopes` ADD CONSTRAINT `ai_scopes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_scopeId_scopeKind_fkey` FOREIGN KEY (`scopeId`, `scopeKind`) REFERENCES `ai_scopes`(`id`, `kind`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_scopeId_taskId_actorKind_fkey` FOREIGN KEY (`scopeId`, `taskId`, `actorKind`) REFERENCES `ai_tasks`(`scopeId`, `id`, `ownerKind`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_steps` ADD CONSTRAINT `ai_steps_scopeId_taskId_fkey` FOREIGN KEY (`scopeId`, `taskId`) REFERENCES `ai_tasks`(`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_steps` ADD CONSTRAINT `ai_steps_scopeId_taskId_runId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_scopeId_taskId_fkey` FOREIGN KEY (`scopeId`, `taskId`) REFERENCES `ai_tasks`(`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_scopeId_taskId_id_currentRevision_fkey` FOREIGN KEY (`scopeId`, `taskId`, `id`, `currentRevision`) REFERENCES `ai_proposal_versions`(`scopeId`, `taskId`, `proposalId`, `revision`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_proposal_versions` ADD CONSTRAINT `ai_proposal_versions_scopeId_taskId_proposalId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `proposalId`) REFERENCES `ai_proposals`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_proposal_actions` ADD CONSTRAINT `ai_proposal_actions_scopeId_taskId_proposalId_proposalRevis_fkey` FOREIGN KEY (`scopeId`, `taskId`, `proposalId`, `proposalRevision`) REFERENCES `ai_proposal_versions`(`scopeId`, `taskId`, `proposalId`, `revision`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_proposal_actions` ADD CONSTRAINT `ai_proposal_actions_scopeId_taskId_actionId_requestFingerpr_fkey` FOREIGN KEY (`scopeId`, `taskId`, `actionId`, `requestFingerprint`) REFERENCES `ai_steps`(`scopeId`, `taskId`, `actionId`, `requestFingerprint`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_approvals` ADD CONSTRAINT `ai_approvals_scopeId_taskId_proposalId_proposalRevision_pay_fkey` FOREIGN KEY (`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `payloadHash`) REFERENCES `ai_proposal_versions`(`scopeId`, `taskId`, `proposalId`, `revision`, `payloadHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_approval_consumptions` ADD CONSTRAINT `ai_approval_consumptions_scopeId_taskId_approvalId_proposal_fkey` FOREIGN KEY (`scopeId`, `taskId`, `approvalId`, `proposalId`, `proposalRevision`) REFERENCES `ai_approvals`(`scopeId`, `taskId`, `id`, `proposalId`, `proposalRevision`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_approval_consumptions` ADD CONSTRAINT `ai_approval_consumptions_scopeId_taskId_proposalId_proposal_fkey` FOREIGN KEY (`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `actionFingerprint`) REFERENCES `ai_proposal_actions`(`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `requestFingerprint`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_events` ADD CONSTRAINT `ai_task_events_scopeId_taskId_fkey` FOREIGN KEY (`scopeId`, `taskId`) REFERENCES `ai_tasks`(`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_scopes` ADD CONSTRAINT `ai_scopes_shape` CHECK (
  (`kind` = 'platform' AND `tenantId` IS NULL AND `workspaceId` IS NULL AND `scopeKey` = 'platform')
  OR (`kind` = 'tenant' AND `tenantId` IS NOT NULL AND CHAR_LENGTH(`tenantId`) > 0
      AND `workspaceId` IS NULL AND `scopeKey` = CONCAT('tenant:', CHAR_LENGTH(`tenantId`), ':', `tenantId`))
  OR (`kind` = 'workspace' AND `tenantId` IS NOT NULL AND CHAR_LENGTH(`tenantId`) > 0
      AND `workspaceId` IS NOT NULL AND CHAR_LENGTH(`workspaceId`) > 0
      AND `scopeKey` = CONCAT('workspace:', CHAR_LENGTH(`tenantId`), ':', `tenantId`, ':', CHAR_LENGTH(`workspaceId`), ':', `workspaceId`))
);

ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_actor_scope` CHECK (
  (`ownerKind` = 'saas_admin' AND `audience` = 'operator' AND `scopeKind` = 'platform')
  OR (`ownerKind` = 'user' AND `audience` IN ('operator', 'staff') AND `scopeKind` IN ('tenant', 'workspace'))
  OR (`ownerKind` = 'customer' AND `audience` = 'client' AND `scopeKind` IN ('tenant', 'workspace'))
  OR (`ownerKind` = 'automation' AND `audience` = 'automation' AND `scopeKind` IN ('tenant', 'workspace'))
);

ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_policy` CHECK (
  (`ownerKind` = 'automation' AND `policyId` IS NOT NULL AND CHAR_LENGTH(`policyId`) > 0
      AND `policyRevision` IS NOT NULL AND `policyRevision` > 0 AND `policyExpiresAt` IS NOT NULL)
  OR (`ownerKind` <> 'automation' AND `policyId` IS NULL AND `policyRevision` IS NULL AND `policyExpiresAt` IS NULL)
);

ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_revision_owner` CHECK (`revision` > 0 AND CHAR_LENGTH(`ownerId`) > 0);

ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_cancel_marker` CHECK (`status` <> 'cancel_requested' OR `cancelRequestedAt` IS NOT NULL);

ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_revision_sequence` CHECK (`revision` > 0 AND `sequence` > 0 AND CHAR_LENGTH(`actorId`) > 0);

ALTER TABLE `ai_runs` ADD CONSTRAINT `ai_runs_lease` CHECK (
  `fencingToken` >= 0 AND (
    (`leaseOwnerId` IS NULL AND `leaseExpiresAt` IS NULL)
    OR (`leaseOwnerId` IS NOT NULL AND CHAR_LENGTH(`leaseOwnerId`) > 0 AND `leaseExpiresAt` IS NOT NULL AND `fencingToken` > 0)
  )
);

ALTER TABLE `ai_steps` ADD CONSTRAINT `ai_steps_revision_sequence` CHECK (`revision` > 0 AND `sequence` > 0);

ALTER TABLE `ai_steps` ADD CONSTRAINT `ai_steps_outcome` CHECK (
  (`status` IN ('pending', 'cancelled') AND `effect` = 'none' AND `errorCode` IS NULL)
  OR (`status` = 'running' AND `effect` IN ('none', 'possible') AND `errorCode` IS NULL)
  OR (`status` = 'failed' AND `effect` = 'none' AND `errorCode` IS NOT NULL
      AND CHAR_LENGTH(`errorCode`) > 0 AND `errorCode` <> 'AI_RESULT_UNKNOWN')
  OR (`status` = 'succeeded' AND `effect` IN ('none', 'committed') AND `errorCode` IS NULL
      AND (`effect` = 'none' OR (`resultRef` IS NOT NULL AND CHAR_LENGTH(`resultRef`) > 0)))
  OR (`status` = 'unknown' AND `effect` = 'possible' AND `errorCode` IS NOT NULL AND `errorCode` = 'AI_RESULT_UNKNOWN')
);

ALTER TABLE `ai_proposals` ADD CONSTRAINT `ai_proposals_current` CHECK (
  `stateRevision` > 0 AND (`currentRevision` IS NULL OR `currentRevision` > 0)
  AND (`status` <> 'confirmed' OR `currentRevision` IS NOT NULL)
);

ALTER TABLE `ai_proposal_versions` ADD CONSTRAINT `ai_proposal_versions_revision` CHECK (`revision` > 0);

ALTER TABLE `ai_proposal_versions` ADD CONSTRAINT `ai_proposal_versions_payload_identity` CHECK (
  JSON_EXTRACT(`payload`, '$.proposalId') IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`payload`, '$.proposalId')) = 'STRING'
  AND JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.proposalId')) = `proposalId`
  AND JSON_EXTRACT(`payload`, '$.taskId') IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`payload`, '$.taskId')) = 'STRING'
  AND JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.taskId')) = `taskId`
  AND JSON_EXTRACT(`payload`, '$.revision') IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(`payload`, '$.revision')) = 'INTEGER'
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.revision')) AS UNSIGNED) = `revision`
);

ALTER TABLE `ai_proposal_actions` ADD CONSTRAINT `ai_proposal_actions_sequence` CHECK (`proposalRevision` > 0 AND `sequence` > 0);

ALTER TABLE `ai_approvals` ADD CONSTRAINT `ai_approvals_human` CHECK (
  (`actorKind` = 'saas_admin' AND `audience` = 'operator')
  OR (`actorKind` = 'user' AND `audience` IN ('operator', 'staff'))
  OR (`actorKind` = 'customer' AND `audience` = 'client')
);

ALTER TABLE `ai_approvals` ADD CONSTRAINT `ai_approvals_expiry` CHECK (
  `proposalRevision` > 0 AND CHAR_LENGTH(`actorId`) > 0 AND `expiresAt` > `issuedAt`
);

ALTER TABLE `ai_approval_consumptions` ADD CONSTRAINT `ai_consumptions_result` CHECK (
  `proposalRevision` > 0 AND CHAR_LENGTH(`businessIdempotencyKey`) > 0
  AND (`status` <> 'committed' OR (`resultRef` IS NOT NULL AND CHAR_LENGTH(`resultRef`) > 0))
);

ALTER TABLE `ai_task_events` ADD CONSTRAINT `ai_task_events_revision` CHECK (`taskRevision` > 0 AND `cursor` > 0);

ALTER TABLE `ai_task_events` ADD CONSTRAINT `ai_task_events_type` CHECK (
  `type` IN ('task.transition', 'step.changed', 'task.output_ready', 'access.revoked')
);

ALTER TABLE `ai_tasks` ADD COLUMN `creationFingerprint` CHAR(64) NULL,
    ADD COLUMN `creationKey` VARCHAR(128) NULL,
    ADD COLUMN `inputHash` CHAR(64) NULL,
    ADD COLUMN `inputRevision` INTEGER UNSIGNED NULL;

CREATE UNIQUE INDEX `ai_tasks_creation_key` ON `ai_tasks`(`scopeId`, `audience`, `ownerKind`, `ownerId`, `creationKey`);

ALTER TABLE `ai_tasks` ADD CONSTRAINT `ai_tasks_creation_evidence` CHECK (
  (`creationKey` IS NULL AND `creationFingerprint` IS NULL AND `inputRevision` IS NULL AND `inputHash` IS NULL)
  OR (`creationKey` IS NOT NULL AND CHAR_LENGTH(`creationKey`) > 0
      AND `creationFingerprint` IS NOT NULL AND CHAR_LENGTH(`creationFingerprint`) = 64
      AND `inputRef` IS NOT NULL AND CHAR_LENGTH(`inputRef`) > 0
      AND `inputRevision` IS NOT NULL AND `inputRevision` > 0
      AND `inputHash` IS NOT NULL AND CHAR_LENGTH(`inputHash`) = 64)
);

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

CREATE TABLE `ai_budget_policies` (
  `id` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `scopeKind` ENUM('platform','tenant','workspace') NOT NULL,
  `sceneCode` VARCHAR(128) NOT NULL,
  `configRevision` INT UNSIGNED NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `allowedModels` JSON NOT NULL,
  `allowedScenes` JSON NOT NULL,
  `settingsJson` JSON NOT NULL,
  `unitKind` VARCHAR(16) NOT NULL,
  `tokenLimit` BIGINT UNSIGNED NULL,
  `callLimit` INT UNSIGNED NULL,
  `moneyLimit` DECIMAL(24,6) NULL,
  `moneyCurrency` CHAR(3) NULL,
  `maxConcurrent` INT UNSIGNED NOT NULL DEFAULT 0,
  `maxCallsPerRun` INT UNSIGNED NOT NULL DEFAULT 0,
  `priceVersion` VARCHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_budget_policy_scope_scene_key` (`scopeId`,`scopeKind`,`sceneCode`),
  INDEX `ai_budget_policy_route_idx` (`scopeKind`,`enabled`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_budget_policies_scope_fk` FOREIGN KEY (`scopeId`,`scopeKind`) REFERENCES `ai_scopes` (`id`,`kind`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_budget_reservations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NULL,
  `workspaceId` VARCHAR(191) NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `scopeKind` ENUM('platform','tenant','workspace') NOT NULL,
  `sceneCode` VARCHAR(128) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(191) NOT NULL,
  `runId` VARCHAR(191) NOT NULL,
  `stepId` VARCHAR(191) NOT NULL,
  `actionId` VARCHAR(191) NOT NULL,
  `callId` VARCHAR(128) NOT NULL,
  `idempotencyKey` VARCHAR(128) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `configRevision` INT UNSIGNED NOT NULL,
  `priceVersion` VARCHAR(64) NULL,
  `unitKind` VARCHAR(16) NOT NULL,
  `reservedTokens` BIGINT UNSIGNED NULL,
  `reservedCalls` INT UNSIGNED NULL,
  `reservedMoney` DECIMAL(24,6) NULL,
  `moneyCurrency` CHAR(3) NULL,
  `actualTokens` BIGINT UNSIGNED NULL,
  `actualCalls` INT UNSIGNED NULL,
  `actualMoney` DECIMAL(24,6) NULL,
  `status` VARCHAR(32) NOT NULL,
  `dispatchState` VARCHAR(32) NOT NULL,
  `unknownReason` VARCHAR(128) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `settledAt` DATETIME(3) NULL,
  UNIQUE INDEX `ai_budget_reservation_scope_key` (`scopeId`,`scopeKind`,`idempotencyKey`),
  UNIQUE INDEX `ai_budget_reservation_call_key` (`scopeId`,`scopeKind`,`callId`),
  INDEX `ai_budget_reservation_policy_status_idx` (`scopeId`,`scopeKind`,`sceneCode`,`status`),
  INDEX `ai_budget_reservation_scope_status_idx` (`tenantId`,`workspaceId`,`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_budget_ledger_entries` (
  `id` VARCHAR(36) NOT NULL,
  `reservationId` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `scopeKind` ENUM('platform','tenant','workspace') NOT NULL,
  `tenantId` VARCHAR(191) NULL,
  `eventKey` VARCHAR(128) NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `inputTokens` BIGINT UNSIGNED NULL,
  `outputTokens` BIGINT UNSIGNED NULL,
  `calls` INT UNSIGNED NULL,
  `moneyAmount` DECIMAL(24,6) NULL,
  `moneyCurrency` CHAR(3) NULL,
  `evidenceHash` CHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_budget_ledger_reservation_event_key` (`reservationId`,`eventKey`),
  INDEX `ai_budget_ledger_scope_created_idx` (`scopeId`,`scopeKind`,`createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ai_budget_ledger_entries_reservation_fk` FOREIGN KEY (`reservationId`) REFERENCES `ai_budget_reservations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_budget_allocations` (
  `reservationId` VARCHAR(36) NOT NULL,
  `policyId` VARCHAR(36) NOT NULL,
  `policyRevision` INT UNSIGNED NOT NULL,
  INDEX `ai_budget_allocation_policy_idx` (`policyId`),
  PRIMARY KEY (`reservationId`,`policyId`),
  CONSTRAINT `ai_budget_allocations_reservation_fk` FOREIGN KEY (`reservationId`) REFERENCES `ai_budget_reservations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ai_budget_allocations_policy_fk` FOREIGN KEY (`policyId`) REFERENCES `ai_budget_policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_budget_ledger_entries`
  ADD COLUMN `reason` VARCHAR(128) NULL;

CREATE TABLE `ai_tenant_model_configurations` (
  `tenantId` VARCHAR(191) NOT NULL,
  `mode` VARCHAR(32) NOT NULL DEFAULT 'platform_managed',
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `settings` JSON NULL,
  `credentialsEncrypted` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`),
  CONSTRAINT `ai_tenant_model_configuration_tenant_fk` FOREIGN KEY (`tenantId`)
    REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_platform_model_connections` (
  `profileId` VARCHAR(36) NOT NULL,
  `configRevision` INTEGER UNSIGNED NOT NULL,
  `baseUrl` VARCHAR(2048) NOT NULL,
  `maxOutputTokens` INTEGER UNSIGNED NOT NULL,
  `credentialsEncrypted` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`profileId`),
  CONSTRAINT `ai_platform_model_connections_profile_fk` FOREIGN KEY (`profileId`)
    REFERENCES `ai_provider_profiles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_budget_reservations`
  ADD COLUMN `configurationHash` CHAR(64) NULL COMMENT 'Complete configuration binding; legacy NULL requires trusted reconciliation';

CREATE TABLE `ai_gateway_invocations` (
  `id` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `stepId` VARCHAR(36) NOT NULL,
  `actionId` VARCHAR(191) NOT NULL,
  `stepFingerprint` CHAR(64) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `callId` VARCHAR(128) NOT NULL,
  `sceneCode` VARCHAR(128) NOT NULL,
  `mode` VARCHAR(8) NOT NULL,
  `intentHash` CHAR(64) NOT NULL,
  `registrationHash` CHAR(64) NOT NULL,
  `configuration` JSON NOT NULL,
  `configurationHash` CHAR(64) NOT NULL,
  `priceVersion` VARCHAR(64) NOT NULL,
  `maxOutputTokens` INT UNSIGNED NOT NULL,
  `leaseOwnerId` VARCHAR(191) NOT NULL,
  `fencingToken` DECIMAL(20,0) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_gateway_invocations_scope_call_key` (`scopeId`, `callId`),
  UNIQUE INDEX `ai_gateway_invocations_scope_step_key` (`scopeId`, `stepId`),
  INDEX `ai_gateway_invocations_task_run_idx` (`scopeId`, `taskId`, `runId`),
  CONSTRAINT `ai_gateway_invocations_step_fk` FOREIGN KEY (`scopeId`, `taskId`, `actionId`, `stepFingerprint`)
    REFERENCES `ai_steps` (`scopeId`, `taskId`, `actionId`, `requestFingerprint`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_gateway_invocations_run_fk` FOREIGN KEY (`scopeId`, `taskId`, `runId`)
    REFERENCES `ai_runs` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

CREATE UNIQUE INDEX `ai_invocation_admission_scope_id` ON `ai_invocation_admissions` (`tenantId`, `workspaceId`, `id`);

CREATE UNIQUE INDEX `ai_budget_reservation_scope_id` ON `ai_budget_reservations` (`scopeId`, `scopeKind`, `id`);

CREATE TABLE `ai_gateway_accounting_receipts` (
  `id` VARCHAR(36) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `scopeKind` ENUM('platform','tenant','workspace') NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `invocationId` VARCHAR(36) NOT NULL,
  `reservationId` VARCHAR(36) NOT NULL,
  `admissionId` VARCHAR(36) NOT NULL,
  `dispatchToken` VARCHAR(128) NOT NULL,
  `requestHash` VARCHAR(128) NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'reserved',
  `inputTokens` BIGINT UNSIGNED NULL,
  `outputTokens` BIGINT UNSIGNED NULL,
  `usageHash` CHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_gateway_accounting_receipts_invocationId_key` (`invocationId`),
  UNIQUE INDEX `ai_gateway_accounting_receipts_reservationId_key` (`reservationId`),
  UNIQUE INDEX `ai_gateway_accounting_receipts_admissionId_key` (`admissionId`),
  INDEX `ai_gateway_accounting_scope_state_idx` (`scopeId`, `state`),
  CONSTRAINT `ai_gateway_accounting_invocation_fk` FOREIGN KEY (`scopeId`, `taskId`, `invocationId`)
    REFERENCES `ai_gateway_invocations` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_gateway_accounting_reservation_fk` FOREIGN KEY (`scopeId`, `scopeKind`, `reservationId`)
    REFERENCES `ai_budget_reservations` (`scopeId`, `scopeKind`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_gateway_accounting_admission_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `admissionId`)
    REFERENCES `ai_invocation_admissions` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_run_plans` (
 `scopeId` VARCHAR(36) NOT NULL, `taskId` VARCHAR(36) NOT NULL, `runId` VARCHAR(36) NOT NULL,
 `planHash` CHAR(64) NOT NULL, `authorityHash` CHAR(64) NOT NULL, `policyVersion` VARCHAR(64) NOT NULL,
 `payload` JSON NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`scopeId`, `taskId`, `runId`),
 CONSTRAINT `ai_task_run_plans_run_fkey` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_result_artifacts` (
 `scopeId` VARCHAR(36) NOT NULL, `taskId` VARCHAR(36) NOT NULL, `id` VARCHAR(36) NOT NULL,
 `runId` VARCHAR(36) NOT NULL, `stepId` VARCHAR(36) NOT NULL, `actionId` VARCHAR(191) NOT NULL,
 `stepFingerprint` CHAR(64) NOT NULL, `leaseOwnerId` VARCHAR(191) NOT NULL, `fencingToken` DECIMAL(20,0) NOT NULL,
 `outcome` ENUM('pending','running','succeeded','failed','unknown','cancelled') NOT NULL,
 `errorCode` VARCHAR(128) NULL,
 `payload` JSON NOT NULL, `contentHash` CHAR(64) NOT NULL,
 `outputBytes` BIGINT UNSIGNED NOT NULL, `activeMs` BIGINT UNSIGNED NOT NULL,
 `completeMeasurement` BOOLEAN NOT NULL DEFAULT false, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (`scopeId`, `taskId`, `id`),
 UNIQUE INDEX `ai_result_artifact_step_generation_key` (`scopeId`, `taskId`, `runId`, `stepId`, `fencingToken`),
 CONSTRAINT `ai_task_result_artifacts_step_fkey` FOREIGN KEY (`scopeId`, `taskId`, `stepId`) REFERENCES `ai_steps` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_action_policies` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `operation` VARCHAR(64) NOT NULL,
  `revision` INT UNSIGNED NOT NULL,
  `requiredPermissions` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`scopeId`, `taskId`, `operation`),
  INDEX `ai_task_action_policies_expiry_idx` (`scopeId`, `expiresAt`),
  CONSTRAINT `ai_task_action_policies_task_fkey` FOREIGN KEY (`scopeId`, `taskId`)
    REFERENCES `ai_tasks` (`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `ai_task_run_plans_hash_key` ON `ai_task_run_plans`(`scopeId`, `taskId`, `runId`, `planHash`);

CREATE UNIQUE INDEX `ai_task_result_artifacts_input_basis_key` ON `ai_task_result_artifacts`(`scopeId`, `taskId`, `runId`, `stepId`, `id`);

CREATE TABLE `ai_task_input_requests` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `id` VARCHAR(36) NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `stepId` VARCHAR(36) NOT NULL,
  `planHash` CHAR(64) NOT NULL,
  `planRevision` INTEGER UNSIGNED NOT NULL,
  `inputRef` VARCHAR(191) NOT NULL,
  `inputHash` CHAR(64) NOT NULL,
  `contractCode` VARCHAR(64) NOT NULL,
  `contractVersion` VARCHAR(64) NOT NULL,
  `contractHash` CHAR(64) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `allowedFields` JSON NOT NULL,
  `basisResultRef` VARCHAR(36) NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `leaseOwnerId` VARCHAR(191) NOT NULL,
  `fencingToken` DECIMAL(20,0) NOT NULL,
  `waitingTaskRevision` INTEGER UNSIGNED NOT NULL,
  `status` ENUM('pending','consumed') NOT NULL DEFAULT 'pending',
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`scopeId`, `taskId`, `id`),
  UNIQUE INDEX `ai_task_input_requests_plan_key` (`scopeId`, `taskId`, `id`, `planHash`),
  UNIQUE INDEX `ai_task_input_requests_pause_key` (`scopeId`, `taskId`, `runId`, `stepId`, `planHash`),
  INDEX `ai_task_input_requests_pending_idx` (`scopeId`, `taskId`, `status`, `expiresAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_input_receipts` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `id` VARCHAR(36) NOT NULL,
  `requestId` VARCHAR(36) NOT NULL,
  `planHash` CHAR(64) NOT NULL,
  `submissionKey` VARCHAR(191) NOT NULL,
  `answerHash` CHAR(64) NOT NULL,
  `answers` JSON NOT NULL,
  `actorKind` ENUM('saas_admin','user','customer','automation') NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `audience` ENUM('operator','staff','client','automation') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `consumedAt` DATETIME(3) NULL,
  `consumedTaskRevision` INTEGER UNSIGNED NULL,
  PRIMARY KEY (`scopeId`, `taskId`, `id`),
  UNIQUE INDEX `ai_task_input_receipts_request_key` (`scopeId`, `taskId`, `requestId`),
  UNIQUE INDEX `ai_task_input_receipts_request_plan_key` (`scopeId`, `taskId`, `requestId`, `planHash`),
  UNIQUE INDEX `ai_task_input_receipts_submission_key` (`scopeId`, `taskId`, `submissionKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_task_input_requests` ADD CONSTRAINT `ai_task_input_requests_plan_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `runId`, `planHash`) REFERENCES `ai_task_run_plans` (`scopeId`, `taskId`, `runId`, `planHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_input_requests` ADD CONSTRAINT `ai_task_input_requests_basis_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `runId`, `stepId`, `basisResultRef`) REFERENCES `ai_task_result_artifacts` (`scopeId`, `taskId`, `runId`, `stepId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_input_receipts` ADD CONSTRAINT `ai_task_input_receipts_request_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `requestId`, `planHash`) REFERENCES `ai_task_input_requests` (`scopeId`, `taskId`, `id`, `planHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;

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

ALTER TABLE `ai_structured_memories`
  ADD COLUMN `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `ownerKind` VARCHAR(32) NOT NULL DEFAULT 'user',
  ADD COLUMN `ownerId` VARCHAR(191) NOT NULL DEFAULT 'legacy-unavailable',
  ADD COLUMN `aclRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `confirmationRecordId` VARCHAR(36) NULL,
  ADD COLUMN `deletedAt` DATETIME(3) NULL,
  ADD COLUMN `state` JSON NULL;

ALTER TABLE `ai_human_confirmations`
  ADD COLUMN `state` JSON NULL;

CREATE TABLE `ai_memory_operations` (
  `id` VARCHAR(36) NOT NULL,
  `memoryId` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `operationId` VARCHAR(128) NOT NULL,
  `fingerprint` VARCHAR(128) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_memory_operations_scope_key` (`tenantId`, `workspaceId`, `memoryId`, `operationId`),
  INDEX `ai_memory_operations_memory_idx` (`memoryId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_plan_policies` (
  `scopeId` VARCHAR(36) NOT NULL,
  `sceneCode` VARCHAR(64) NOT NULL,
  `sceneVersion` VARCHAR(64) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `allowedTools` JSON NOT NULL,
  `limits` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `ai_task_plan_policies_expiry_idx`(`scopeId`, `expiresAt`),
  PRIMARY KEY (`scopeId`, `sceneCode`, `sceneVersion`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_action_inputs` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `id` VARCHAR(36) NOT NULL,
  `registrationRef` VARCHAR(191) NOT NULL,
  `toolCode` VARCHAR(64) NOT NULL,
  `toolVersion` VARCHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `policyRevision` INTEGER UNSIGNED NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_task_action_inputs_id_key`(`scopeId`, `taskId`, `id`),
  PRIMARY KEY (`scopeId`, `taskId`, `runId`, `registrationRef`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_task_plan_policies` ADD CONSTRAINT `ai_task_plan_policies_scope_fkey`
  FOREIGN KEY (`scopeId`) REFERENCES `ai_scopes`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_action_inputs` ADD CONSTRAINT `ai_task_action_inputs_run_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE `ai_knowledge_action_policies` (
  `tenantId` VARCHAR(128) NOT NULL,
  `workspaceId` VARCHAR(128) NOT NULL,
  `actorKind` VARCHAR(32) NOT NULL,
  `actorId` VARCHAR(128) NOT NULL,
  `audience` VARCHAR(32) NOT NULL,
  `domain` VARCHAR(16) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `resourceKey` CHAR(64) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `requiredPermissions` JSON NOT NULL,
  `resource` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`, `workspaceId`, `actorKind`, `actorId`, `audience`, `domain`, `action`, `resourceKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

ALTER TABLE `ai_scopes` ADD UNIQUE INDEX `ai_scopes_id_workspace_key` (`id`, `tenantId`, `workspaceId`);

CREATE TABLE `ai_automation_subjects` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `authorizationRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `permissions` JSON NOT NULL,
  `locationScope` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_automation_subject_scope_key` (`tenantId`, `workspaceId`, `id`),
  CONSTRAINT `ai_automation_subject_revision_check` CHECK (`authorizationRevision` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_automation_policies` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `subjectId` VARCHAR(36) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `mode` VARCHAR(24) NOT NULL DEFAULT 'disabled',
  `sceneCode` VARCHAR(64) NOT NULL,
  `sceneVersion` VARCHAR(64) NOT NULL,
  `allowedEventTypes` JSON NOT NULL,
  `maxTasksPerDay` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `cooldownSeconds` INTEGER UNSIGNED NOT NULL DEFAULT 60,
  `counterDay` DATETIME(3) NULL,
  `preparedCount` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `lastPreparedAt` DATETIME(3) NULL,
  `validFrom` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_automation_policy_scope_key` (`tenantId`, `workspaceId`, `subjectId`, `id`),
  CONSTRAINT `ai_automation_policy_subject_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `subjectId`) REFERENCES `ai_automation_subjects` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_policy_mode_check` CHECK (`mode` IN ('disabled', 'shadow', 'manual_confirmation')),
  CONSTRAINT `ai_automation_policy_limits_check` CHECK (`revision` > 0 AND `maxTasksPerDay` <= 10000 AND `cooldownSeconds` BETWEEN 1 AND 86400 AND `expiresAt` > `validFrom`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_automation_inputs` (
  `id` VARCHAR(36) NOT NULL,
  `inputRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `subjectId` VARCHAR(36) NOT NULL,
  `authorizationRevision` INTEGER UNSIGNED NOT NULL,
  `policyId` VARCHAR(36) NOT NULL,
  `policyRevision` INTEGER UNSIGNED NOT NULL,
  `eventId` VARCHAR(36) NOT NULL,
  `resourceRevision` INTEGER UNSIGNED NOT NULL,
  `deduplicationKey` CHAR(64) NOT NULL,
  `sceneCode` VARCHAR(64) NOT NULL,
  `sceneVersion` VARCHAR(64) NOT NULL,
  `creationKey` CHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `inputHash` CHAR(64) NOT NULL,
  `authorityHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'prepared',
  `taskId` VARCHAR(36) NULL,
  `runId` VARCHAR(36) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_automation_input_creation_key` (`creationKey`),
  UNIQUE INDEX `ai_automation_input_event_policy_key` (`tenantId`, `workspaceId`, `policyId`, `policyRevision`, `eventId`),
  INDEX `ai_automation_input_status_idx` (`tenantId`, `workspaceId`, `status`, `createdAt`),
  CONSTRAINT `ai_automation_input_policy_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `subjectId`, `policyId`) REFERENCES `ai_automation_policies` (`tenantId`, `workspaceId`, `subjectId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_input_scope_fk` FOREIGN KEY (`scopeId`, `tenantId`, `workspaceId`) REFERENCES `ai_scopes` (`id`, `tenantId`, `workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_input_task_fk` FOREIGN KEY (`scopeId`, `taskId`) REFERENCES `ai_tasks` (`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_input_run_fk` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_input_revision_check` CHECK (`inputRevision` = 1 AND `authorizationRevision` > 0 AND `policyRevision` > 0 AND `resourceRevision` > 0),
  CONSTRAINT `ai_automation_input_state_check` CHECK ((`status` IN ('prepared', 'creation_unknown') AND `taskId` IS NULL AND `runId` IS NULL) OR (`status` = 'linked' AND `taskId` IS NOT NULL AND `runId` IS NOT NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_client_scene_materials` (
  `id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `principalKind` VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
  `principalHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `bindingHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `publicationHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operationKey` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  `inputHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `materialHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `command` JSON NOT NULL,
  `material` JSON NOT NULL,
  `publication` JSON NOT NULL,
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_client_materials_operation_key` (`tenantId`, `workspaceId`, `channel`, `principalHash`, `operationKey`),
  INDEX `ai_client_materials_scope_expiry` (`tenantId`, `workspaceId`, `expiresAt`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_automation_inputs`
  ADD COLUMN `reviewRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN `reviewStatus` VARCHAR(16) NOT NULL DEFAULT 'open',
  ADD COLUMN `closeReason` VARCHAR(24) NULL,
  ADD COLUMN `feedbackCode` VARCHAR(24) NULL,
  ADD COLUMN `reviewedAt` DATETIME(3) NULL,
  ADD UNIQUE INDEX `ai_automation_input_review_target_key` (`tenantId`, `workspaceId`, `scopeId`, `id`, `eventId`),
  ADD CONSTRAINT `ai_automation_input_review_state_check` CHECK (`reviewRevision` > 0 AND ((`reviewStatus` = 'open' AND `closeReason` IS NULL) OR (`reviewStatus` = 'closed' AND `closeReason` IS NOT NULL AND `closeReason` IN ('resolved', 'dismissed', 'duplicate', 'not_applicable')))),
  ADD CONSTRAINT `ai_automation_input_feedback_check` CHECK (`feedbackCode` IS NULL OR `feedbackCode` IN ('helpful', 'not_helpful', 'incorrect', 'not_applicable'));

CREATE TABLE `ai_automation_review_grants` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `inputId` VARCHAR(36) NOT NULL,
  `eventId` VARCHAR(36) NOT NULL,
  `actorKind` VARCHAR(16) NOT NULL DEFAULT 'user',
  `actorId` VARCHAR(191) NOT NULL,
  `audience` VARCHAR(16) NOT NULL,
  `action` VARCHAR(16) NOT NULL,
  `expectedRevision` INTEGER UNSIGNED NOT NULL,
  `resourceHash` CHAR(64) NOT NULL,
  `requiredPermissions` JSON NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_automation_review_grant_scope_key` (`scopeId`, `inputId`, `id`),
  UNIQUE INDEX `ai_automation_review_grant_action_key` (`scopeId`, `actorId`, `audience`, `inputId`, `action`, `expectedRevision`),
  CONSTRAINT `ai_automation_review_grant_input_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `scopeId`, `inputId`, `eventId`) REFERENCES `ai_automation_inputs` (`tenantId`, `workspaceId`, `scopeId`, `id`, `eventId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_review_grant_shape_check` CHECK (`actorKind` = 'user' AND `audience` IN ('operator', 'staff') AND `action` IN ('close', 'feedback') AND `expectedRevision` > 0 AND `revision` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_automation_review_operations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `inputId` VARCHAR(36) NOT NULL,
  `eventId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NULL,
  `runId` VARCHAR(36) NULL,
  `actorKind` VARCHAR(16) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `audience` VARCHAR(16) NOT NULL,
  `action` VARCHAR(16) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `expectedRevision` INTEGER UNSIGNED NOT NULL,
  `resultRevision` INTEGER UNSIGNED NOT NULL,
  `eventFenceBefore` INTEGER UNSIGNED NOT NULL,
  `eventFenceAfter` INTEGER UNSIGNED NOT NULL,
  `resultStatus` VARCHAR(16) NOT NULL,
  `inputStatusAtCommit` VARCHAR(24) NOT NULL,
  `closeReason` VARCHAR(24) NULL,
  `feedbackCode` VARCHAR(24) NULL,
  `grantId` VARCHAR(36) NOT NULL,
  `grantRevision` INTEGER UNSIGNED NOT NULL,
  `authorizationHash` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_automation_review_operation_key` (`scopeId`, `actorId`, `audience`, `operationKey`),
  UNIQUE INDEX `ai_automation_review_operation_revision_key` (`scopeId`, `inputId`, `resultRevision`),
  CONSTRAINT `ai_automation_review_operation_input_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `scopeId`, `inputId`, `eventId`) REFERENCES `ai_automation_inputs` (`tenantId`, `workspaceId`, `scopeId`, `id`, `eventId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_review_operation_grant_fk` FOREIGN KEY (`scopeId`, `inputId`, `grantId`) REFERENCES `ai_automation_review_grants` (`scopeId`, `inputId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_review_operation_task_fk` FOREIGN KEY (`scopeId`, `taskId`) REFERENCES `ai_tasks` (`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_review_operation_run_fk` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_automation_review_operation_shape_check` CHECK (`actorKind` = 'user' AND `audience` IN ('operator', 'staff') AND `action` IN ('close', 'feedback') AND `expectedRevision` > 0 AND `resultRevision` = `expectedRevision` + 1 AND `grantRevision` > 0 AND `eventFenceAfter` >= `eventFenceBefore`),
  CONSTRAINT `ai_automation_review_operation_task_check` CHECK ((`taskId` IS NULL AND `runId` IS NULL) OR (`taskId` IS NOT NULL AND `runId` IS NOT NULL)),
  CONSTRAINT `ai_automation_review_operation_result_check` CHECK (`resultStatus` IN ('open', 'closed') AND `inputStatusAtCommit` IN ('prepared', 'creation_unknown', 'linked') AND (`action` <> 'close' OR (`resultStatus` = 'closed' AND `closeReason` IS NOT NULL AND `closeReason` IN ('resolved', 'dismissed', 'duplicate', 'not_applicable'))) AND (`action` <> 'feedback' OR (`feedbackCode` IS NOT NULL AND `feedbackCode` IN ('helpful', 'not_helpful', 'incorrect', 'not_applicable'))))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_automation_subjects`
  ADD COLUMN `enabledBy` VARCHAR(191) NULL,
  ADD COLUMN `enabledAudience` VARCHAR(16) NULL,
  ADD COLUMN `enabledAt` DATETIME(3) NULL,
  ADD CONSTRAINT `ai_auto_subject_enable_audit_check` CHECK ((`enabledBy` IS NULL AND `enabledAudience` IS NULL AND `enabledAt` IS NULL) OR (`enabledBy` IS NOT NULL AND `enabledAudience` IS NOT NULL AND `enabledAudience` = 'operator' AND `enabledAt` IS NOT NULL));

ALTER TABLE `ai_automation_policies`
  ADD COLUMN `enabledBy` VARCHAR(191) NULL,
  ADD COLUMN `enabledAudience` VARCHAR(16) NULL,
  ADD COLUMN `enabledAt` DATETIME(3) NULL,
  ADD CONSTRAINT `ai_auto_policy_enable_audit_check` CHECK ((`enabledBy` IS NULL AND `enabledAudience` IS NULL AND `enabledAt` IS NULL) OR (`enabledBy` IS NOT NULL AND `enabledAudience` IS NOT NULL AND `enabledAudience` = 'operator' AND `enabledAt` IS NOT NULL));

CREATE TABLE `ai_automation_management_grants` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `actorKind` VARCHAR(16) NOT NULL DEFAULT 'user',
  `actorId` VARCHAR(191) NOT NULL,
  `audience` VARCHAR(16) NOT NULL,
  `action` VARCHAR(16) NOT NULL,
  `resourceHash` CHAR(64) NOT NULL,
  `requiredPermissions` JSON NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_auto_management_grant_id_key` (`scopeId`, `id`),
  UNIQUE INDEX `ai_auto_management_grant_resource_key` (`scopeId`, `actorId`, `audience`, `action`, `resourceHash`),
  CONSTRAINT `ai_auto_management_grant_scope_fk` FOREIGN KEY (`scopeId`, `tenantId`, `workspaceId`) REFERENCES `ai_scopes` (`id`, `tenantId`, `workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_auto_management_grant_shape_check` CHECK (`actorKind` = 'user' AND `audience` = 'operator' AND `action` IN ('prepare', 'commit') AND `revision` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_automation_policy_preparations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `actorKind` VARCHAR(16) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `audience` VARCHAR(16) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `subjectId` VARCHAR(36) NOT NULL,
  `policyId` VARCHAR(36) NOT NULL,
  `expectedSubjectRevision` INTEGER UNSIGNED NULL,
  `expectedPolicyRevision` INTEGER UNSIGNED NULL,
  `commandJson` JSON NOT NULL,
  `changeHash` CHAR(64) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `commitResourceHash` CHAR(64) NOT NULL,
  `prepareGrantId` VARCHAR(36) NOT NULL,
  `prepareGrantRevision` INTEGER UNSIGNED NOT NULL,
  `authorizationHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_auto_preparation_id_key` (`scopeId`, `id`),
  UNIQUE INDEX `ai_auto_preparation_operation_key` (`scopeId`, `actorId`, `audience`, `operationKey`),
  CONSTRAINT `ai_auto_preparation_scope_fk` FOREIGN KEY (`scopeId`, `tenantId`, `workspaceId`) REFERENCES `ai_scopes` (`id`, `tenantId`, `workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_auto_preparation_grant_fk` FOREIGN KEY (`scopeId`, `prepareGrantId`) REFERENCES `ai_automation_management_grants` (`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_auto_preparation_shape_check` CHECK (`actorKind` = 'user' AND `audience` = 'operator' AND `prepareGrantRevision` > 0 AND (`expectedSubjectRevision` IS NULL OR `expectedSubjectRevision` > 0) AND (`expectedPolicyRevision` IS NULL OR `expectedPolicyRevision` > 0))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_automation_policy_management_operations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `actorKind` VARCHAR(16) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `audience` VARCHAR(16) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `preparationId` VARCHAR(36) NOT NULL,
  `subjectId` VARCHAR(36) NOT NULL,
  `policyId` VARCHAR(36) NOT NULL,
  `changeHash` CHAR(64) NOT NULL,
  `result` JSON NOT NULL,
  `resultHash` CHAR(64) NOT NULL,
  `grantId` VARCHAR(36) NOT NULL,
  `grantRevision` INTEGER UNSIGNED NOT NULL,
  `authorizationHash` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_auto_management_operation_prep_key` (`scopeId`, `preparationId`),
  UNIQUE INDEX `ai_auto_management_operation_key` (`scopeId`, `actorId`, `audience`, `operationKey`),
  CONSTRAINT `ai_auto_management_operation_scope_fk` FOREIGN KEY (`scopeId`, `tenantId`, `workspaceId`) REFERENCES `ai_scopes` (`id`, `tenantId`, `workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_auto_management_operation_prep_fk` FOREIGN KEY (`scopeId`, `preparationId`) REFERENCES `ai_automation_policy_preparations` (`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_auto_management_operation_grant_fk` FOREIGN KEY (`scopeId`, `grantId`) REFERENCES `ai_automation_management_grants` (`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_auto_management_operation_subject_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `subjectId`) REFERENCES `ai_automation_subjects` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_auto_management_operation_policy_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `subjectId`, `policyId`) REFERENCES `ai_automation_policies` (`tenantId`, `workspaceId`, `subjectId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_auto_management_operation_shape_check` CHECK (`actorKind` = 'user' AND `audience` = 'operator' AND `grantRevision` > 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_client_scene_materials`
  ADD UNIQUE INDEX `ai_client_materials_input_binding` (`id`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`);

CREATE TABLE `ai_client_task_policies` (
  `id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `customerType` VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
  `sceneCode` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `sceneVersion` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `allowCreate` BOOLEAN NOT NULL DEFAULT false,
  `allowRead` BOOLEAN NOT NULL DEFAULT false,
  `revision` INT UNSIGNED NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_client_task_policy_scope_scene` (`tenantId`, `workspaceId`, `channel`, `customerType`, `sceneCode`, `sceneVersion`),
  UNIQUE INDEX `ai_client_task_policy_binding` (`id`, `tenantId`, `workspaceId`, `channel`, `customerType`, `sceneCode`, `sceneVersion`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_client_task_inputs` (
  `id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `principalKind` VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
  `principalHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `creationKey` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `materialRef` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `materialInputHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `materialHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `materialRevision` INT UNSIGNED NOT NULL,
  `bindingHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `policyId` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `policyRevision` INT UNSIGNED NOT NULL,
  `policyHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `sceneCode` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `sceneVersion` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `inputHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `dispatchState` ENUM('UNKNOWN') NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_client_task_input_creation` (`tenantId`, `workspaceId`, `channel`, `principalHash`, `creationKey`),
  CONSTRAINT `ai_client_task_input_material_fk` FOREIGN KEY (`materialRef`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`)
    REFERENCES `ai_client_scene_materials` (`id`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_client_task_input_policy_fk` FOREIGN KEY (`policyId`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `sceneCode`, `sceneVersion`)
    REFERENCES `ai_client_task_policies` (`id`, `tenantId`, `workspaceId`, `channel`, `customerType`, `sceneCode`, `sceneVersion`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_knowledge_policy_management_authorities` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(128) NOT NULL,
  `workspaceId` VARCHAR(128) NOT NULL,
  `managerId` VARCHAR(128) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `basisRef` VARCHAR(128) NOT NULL,
  `basisVersion` VARCHAR(64) NOT NULL,
  `targetActorId` VARCHAR(128) NOT NULL,
  `targetAudience` VARCHAR(32) NOT NULL,
  `domain` VARCHAR(16) NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `resourceKey` CHAR(64) NOT NULL,
  `resource` JSON NOT NULL,
  `requiredPermissions` JSON NOT NULL,
  `allowedPermissions` JSON NOT NULL,
  `allowedOperations` JSON NOT NULL,
  `maxPolicySeconds` INTEGER UNSIGNED NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_kp_authority_scope_key` (`tenantId`, `workspaceId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_knowledge_policy_preparations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(128) NOT NULL,
  `workspaceId` VARCHAR(128) NOT NULL,
  `actorId` VARCHAR(128) NOT NULL,
  `audience` VARCHAR(32) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `policyKeyHash` CHAR(64) NOT NULL,
  `expectedRevision` INTEGER UNSIGNED NOT NULL,
  `commandJson` JSON NOT NULL,
  `beforeJson` JSON NOT NULL,
  `commitSlot` CHAR(64) NULL,
  `changeHash` CHAR(64) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `authorityId` VARCHAR(36) NOT NULL,
  `authorityRevision` INTEGER UNSIGNED NOT NULL,
  `authorizationHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_kp_preparation_commit_slot_key` (`commitSlot`),
  UNIQUE INDEX `ai_kp_preparation_scope_key` (`tenantId`, `workspaceId`, `id`),
  UNIQUE INDEX `ai_kp_preparation_operation_key` (`tenantId`, `workspaceId`, `actorId`, `audience`, `operationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_knowledge_policy_management_operations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(128) NOT NULL,
  `workspaceId` VARCHAR(128) NOT NULL,
  `actorId` VARCHAR(128) NOT NULL,
  `audience` VARCHAR(32) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `preparationId` VARCHAR(36) NOT NULL,
  `policyKeyHash` CHAR(64) NOT NULL,
  `resultRevision` INTEGER UNSIGNED NOT NULL,
  `changeHash` CHAR(64) NOT NULL,
  `resultJson` JSON NOT NULL,
  `resultHash` CHAR(64) NOT NULL,
  `authorityRevision` INTEGER UNSIGNED NOT NULL,
  `authorizationHash` CHAR(64) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_kp_operation_preparation_key` (`tenantId`, `workspaceId`, `preparationId`),
  UNIQUE INDEX `ai_kp_operation_original_key` (`tenantId`, `workspaceId`, `actorId`, `audience`, `operationKey`),
  UNIQUE INDEX `ai_kp_operation_policy_revision_key` (`policyKeyHash`, `resultRevision`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_knowledge_policy_preparations` ADD CONSTRAINT `ai_kp_preparation_authority_fk`
  FOREIGN KEY (`tenantId`, `workspaceId`, `authorityId`) REFERENCES `ai_knowledge_policy_management_authorities` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_knowledge_policy_management_operations` ADD CONSTRAINT `ai_kp_operation_preparation_fk`
  FOREIGN KEY (`tenantId`, `workspaceId`, `preparationId`) REFERENCES `ai_knowledge_policy_preparations` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

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

ALTER TABLE `ai_runs`
  ADD COLUMN `inputReceiptId` VARCHAR(36) NULL,
  ADD COLUMN `resourceOriginRunId` VARCHAR(36) NULL,
  ADD UNIQUE INDEX `ai_runs_input_receipt_key` (`scopeId`, `taskId`, `inputReceiptId`),
  ADD INDEX `ai_runs_resource_origin_idx` (`scopeId`, `taskId`, `resourceOriginRunId`),
  ADD CONSTRAINT `ai_runs_input_receipt_fkey` FOREIGN KEY (`scopeId`, `taskId`, `inputReceiptId`)
    REFERENCES `ai_task_input_receipts` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_runs_resource_origin_fkey` FOREIGN KEY (`scopeId`, `taskId`, `resourceOriginRunId`)
    REFERENCES `ai_runs` (`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

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

ALTER TABLE `ai_client_task_policies`
  ADD COLUMN `allowExecute` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `ai_client_task_policies`
  ADD COLUMN `allowRequestInput` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `allowSubmitInput` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `allowResumeInput` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `ai_client_task_policies`
  ADD COLUMN `allowCancel` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `ai_gateway_price_records` (
  `id` CHAR(64) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `configurationHash` CHAR(64) NOT NULL,
  `priceVersion` VARCHAR(64) NOT NULL,
  `sourceReference` VARCHAR(191) NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_gateway_price_records_scope_id` (`scopeId`, `id`),
  UNIQUE INDEX `ai_gateway_price_records_version` (`scopeId`, `configurationHash`, `priceVersion`),
  UNIQUE INDEX `ai_gateway_price_records_source` (`scopeId`, `sourceReference`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_gateway_input_bound_records` (
  `id` CHAR(64) NOT NULL,
  `scopeId` VARCHAR(36) NOT NULL,
  `invocationId` VARCHAR(36) NOT NULL,
  `priceRecordId` CHAR(64) NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_gateway_input_bounds_invocation` (`scopeId`, `invocationId`),
  CONSTRAINT `ai_gateway_input_bound_records_scopeId_priceRecordId_fkey`
    FOREIGN KEY (`scopeId`, `priceRecordId`) REFERENCES `ai_gateway_price_records` (`scopeId`, `id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_client_scene_materials` ADD COLUMN `erasedAt` DATETIME(3) NULL;

ALTER TABLE `ai_task_original_requests` ADD COLUMN `erasedAt` DATETIME(3) NULL;

CREATE TABLE `ai_data_erasures` (
  `id` CHAR(64) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(24) NOT NULL,
  `resourceId` VARCHAR(191) NOT NULL,
  `policyVersion` VARCHAR(64) NOT NULL,
  `targetHash` CHAR(64) NOT NULL,
  `state` VARCHAR(24) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `erasedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `ai_data_erasure_scope_created_idx` (`tenantId`, `workspaceId`, `createdAt`, `id`),
  INDEX `ai_data_erasure_scope_state_idx` (`tenantId`, `workspaceId`, `state`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_tenant_model_configurations`
  ADD COLUMN `serviceEnabled` BOOLEAN NULL;

CREATE TABLE `ai_model_configuration_operations` (
    `id` VARCHAR(36) NOT NULL,
    `scopeId` VARCHAR(36) NOT NULL,
    `scopeKind` ENUM('platform', 'tenant', 'workspace') NOT NULL,
    `targetId` VARCHAR(191) NOT NULL,
    `operationKey` VARCHAR(128) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NULL,
    `expectedRevision` INTEGER UNSIGNED NOT NULL,
    `resultRevision` INTEGER UNSIGNED NOT NULL,
    `commandHash` CHAR(64) NOT NULL,
    `result` JSON NOT NULL,
    `resultHash` CHAR(64) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ai_model_config_operation_original_key`(`scopeId`, `scopeKind`, `targetId`, `operationKey`),
    UNIQUE INDEX `ai_model_config_operation_revision_key`(`scopeId`, `scopeKind`, `targetId`, `resultRevision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_model_configuration_operations` ADD CONSTRAINT `ai_model_configuration_operations_scopeId_scopeKind_fkey`
    FOREIGN KEY (`scopeId`, `scopeKind`) REFERENCES `ai_scopes`(`id`, `kind`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_accounting_receipts`
  ADD COLUMN `usageDetails` JSON NULL;

ALTER TABLE `ai_invocation_admissions` MODIFY `tenantId` VARCHAR(191) NULL;

ALTER TABLE `ai_invocation_admissions` MODIFY `workspaceId` VARCHAR(191) NULL;

ALTER TABLE `ai_invocation_admissions` ADD COLUMN `scopeKind` ENUM('platform', 'tenant', 'workspace') NOT NULL DEFAULT 'workspace';

ALTER TABLE `ai_invocation_admissions` ADD COLUMN `platformDedupKey` VARCHAR(191) NULL;

ALTER TABLE `ai_invocation_admissions` ADD UNIQUE INDEX `ai_invocation_admission_platform_dedup_key` (`platformDedupKey`);

ALTER TABLE `ai_gateway_accounting_receipts` MODIFY `tenantId` VARCHAR(191) NULL;

ALTER TABLE `ai_gateway_accounting_receipts` MODIFY `workspaceId` VARCHAR(191) NULL;

ALTER TABLE `ai_budget_allocations` DROP FOREIGN KEY `ai_budget_allocations_policy_fk`,
  ADD CONSTRAINT `ai_budget_allocations_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `ai_budget_policies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_budget_allocations` DROP FOREIGN KEY `ai_budget_allocations_reservation_fk`,
  ADD CONSTRAINT `ai_budget_allocations_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `ai_budget_reservations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_budget_ledger_entries` DROP FOREIGN KEY `ai_budget_ledger_entries_reservation_fk`,
  ADD CONSTRAINT `ai_budget_ledger_entries_reservationId_fkey` FOREIGN KEY (`reservationId`) REFERENCES `ai_budget_reservations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_budget_policies` DROP FOREIGN KEY `ai_budget_policies_scope_fk`,
  ADD CONSTRAINT `ai_budget_policies_scopeId_scopeKind_fkey` FOREIGN KEY (`scopeId`, `scopeKind`) REFERENCES `ai_scopes`(`id`, `kind`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_accounting_receipts` DROP FOREIGN KEY `ai_gateway_accounting_admission_fk`,
  ADD CONSTRAINT `ai_gateway_accounting_receipts_tenantId_workspaceId_admissi_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `admissionId`) REFERENCES `ai_invocation_admissions`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_accounting_receipts` DROP FOREIGN KEY `ai_gateway_accounting_invocation_fk`,
  ADD CONSTRAINT `ai_gateway_accounting_receipts_scopeId_taskId_invocationId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `invocationId`) REFERENCES `ai_gateway_invocations`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_accounting_receipts` DROP FOREIGN KEY `ai_gateway_accounting_reservation_fk`,
  ADD CONSTRAINT `ai_gateway_accounting_receipts_scopeId_scopeKind_reservatio_fkey` FOREIGN KEY (`scopeId`, `scopeKind`, `reservationId`) REFERENCES `ai_budget_reservations`(`scopeId`, `scopeKind`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_invocations` DROP FOREIGN KEY `ai_gateway_invocations_run_fk`,
  ADD CONSTRAINT `ai_gateway_invocations_scopeId_taskId_runId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_gateway_invocations` DROP FOREIGN KEY `ai_gateway_invocations_step_fk`,
  ADD CONSTRAINT `ai_gateway_invocations_scopeId_taskId_actionId_stepFingerpr_fkey` FOREIGN KEY (`scopeId`, `taskId`, `actionId`, `stepFingerprint`) REFERENCES `ai_steps`(`scopeId`, `taskId`, `actionId`, `requestFingerprint`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_knowledge_acl` DROP FOREIGN KEY `ai_knowledge_acl_document_fk`,
  ADD CONSTRAINT `ai_knowledge_acl_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `ai_knowledge_documents`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_knowledge_chunks` DROP FOREIGN KEY `ai_knowledge_chunks_version_fk`,
  ADD CONSTRAINT `ai_knowledge_chunks_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `ai_knowledge_versions`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_knowledge_operations` DROP FOREIGN KEY `ai_knowledge_operations_document_fk`,
  ADD CONSTRAINT `ai_knowledge_operations_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `ai_knowledge_documents`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_knowledge_versions` DROP FOREIGN KEY `ai_knowledge_versions_document_fk`,
  ADD CONSTRAINT `ai_knowledge_versions_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `ai_knowledge_documents`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_platform_model_connections` DROP FOREIGN KEY `ai_platform_model_connections_profile_fk`,
  ADD CONSTRAINT `ai_platform_model_connections_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `ai_provider_profiles`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_provider_capability_evidence` DROP FOREIGN KEY `ai_provider_capability_evidence_profile_fk`,
  ADD CONSTRAINT `ai_provider_capability_evidence_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `ai_provider_profiles`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE `ai_provider_profiles` DROP FOREIGN KEY `ai_provider_profiles_scope_fk`,
  ADD CONSTRAINT `ai_provider_profiles_scopeId_scopeKind_fkey` FOREIGN KEY (`scopeId`, `scopeKind`) REFERENCES `ai_scopes`(`id`, `kind`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_budgets` DROP FOREIGN KEY `ai_task_execution_budgets_task_fk`,
  ADD CONSTRAINT `ai_task_execution_budgets_scopeId_taskId_fkey` FOREIGN KEY (`scopeId`, `taskId`) REFERENCES `ai_tasks`(`scopeId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_charges` DROP FOREIGN KEY `ai_task_execution_charges_budget_fk`,
  ADD CONSTRAINT `ai_task_execution_charges_scopeId_taskId_fkey` FOREIGN KEY (`scopeId`, `taskId`) REFERENCES `ai_task_execution_budgets`(`scopeId`, `taskId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_charges` DROP FOREIGN KEY `ai_task_execution_charges_invocation_fk`,
  ADD CONSTRAINT `ai_task_execution_charges_scopeId_taskId_gatewayInvocationI_fkey` FOREIGN KEY (`scopeId`, `taskId`, `gatewayInvocationId`) REFERENCES `ai_gateway_invocations`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_charges` DROP FOREIGN KEY `ai_task_execution_charges_run_fk`,
  ADD CONSTRAINT `ai_task_execution_charges_scopeId_taskId_runId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_execution_charges` DROP FOREIGN KEY `ai_task_execution_charges_step_fk`,
  ADD CONSTRAINT `ai_task_execution_charges_scopeId_taskId_stepId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `stepId`) REFERENCES `ai_steps`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_tenant_model_configurations` DROP FOREIGN KEY `ai_tenant_model_configuration_tenant_fk`,
  ADD CONSTRAINT `ai_tenant_model_configurations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ai_budget_policies` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_budget_reservations` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_human_confirmations` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_invocation_admissions` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_knowledge_documents` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_provider_capability_evidence` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_provider_profiles` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_structured_memories` ALTER COLUMN `updatedAt` DROP DEFAULT,
    ALTER COLUMN `ownerKind` DROP DEFAULT,
    ALTER COLUMN `ownerId` DROP DEFAULT;

ALTER TABLE `ai_usage_reservations` ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `ai_budget_reservations` ADD COLUMN `billingMode` VARCHAR(24) NOT NULL DEFAULT 'legacy_unknown';

UPDATE `ai_budget_reservations` r
JOIN `ai_gateway_accounting_receipts` a ON a.reservationId = r.id AND a.scopeId = r.scopeId AND a.scopeKind = r.scopeKind
JOIN `ai_gateway_invocations` i ON i.id = a.invocationId AND i.scopeId = a.scopeId AND i.taskId = a.taskId
SET r.billingMode = JSON_UNQUOTE(JSON_EXTRACT(i.configuration, '$.serviceMode'))
WHERE r.billingMode = 'legacy_unknown' AND r.actorId = i.actorId AND r.callId = i.callId
  AND r.configurationHash = i.configurationHash
  AND JSON_UNQUOTE(JSON_EXTRACT(i.configuration, '$.serviceMode')) IN ('platform_managed', 'tenant_managed');

CREATE TABLE `ai_tenant_ai_allowances` (
  `tenantId` VARCHAR(191) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `grantedAmount` DECIMAL(24,6) NOT NULL DEFAULT 0,
  `allocationsJson` JSON NOT NULL,
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`, `currency`),
  CONSTRAINT `ai_tenant_ai_allowances_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_tenant_ai_credit_requests` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `requestedBy` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `currency` VARCHAR(3) NOT NULL,
  `requestedAmount` DECIMAL(24,6) NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `revision` INT UNSIGNED NOT NULL DEFAULT 1,
  `grantedAmount` DECIMAL(24,6) NULL,
  `decidedBy` VARCHAR(191) NULL,
  `decisionOperationKey` VARCHAR(128) NULL,
  `decisionHash` CHAR(64) NULL,
  `decidedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_credit_request_operation_key` (`tenantId`, `requestedBy`, `operationKey`),
  UNIQUE INDEX `ai_credit_decision_operation_key` (`decidedBy`, `decisionOperationKey`),
  INDEX `ai_credit_request_tenant_state_idx` (`tenantId`, `state`, `createdAt`),
  INDEX `ai_credit_request_pending_idx` (`state`, `createdAt`),
  CONSTRAINT `ai_tenant_ai_credit_requests_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ai_budget_reservation_credit_idx` ON `ai_budget_reservations` (`tenantId`, `unitKind`, `moneyCurrency`, `status`);

CREATE INDEX `ai_gateway_invocations_created_idx` ON `ai_gateway_invocations` (`scopeId`, `createdAt`, `id`);

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

ALTER TABLE `ai_task_original_requests`
  ADD COLUMN `creationClosedAt` DATETIME(3) NULL,
  ADD COLUMN `creationCloseKey` VARCHAR(128) NULL;

ALTER TABLE `ai_task_events`
  DROP CHECK `ai_task_events_type`,
  ADD CONSTRAINT `ai_task_events_type` CHECK (
    `type` IN (
      'task.transition',
      'step.registered',
      'step.changed',
      'task.output_ready',
      'task.input_refreshed',
      'access.revoked'
    )
  );

CREATE TABLE `ai_gateway_tool_call_bindings` (
  `scopeId` VARCHAR(36) NOT NULL,
  `taskId` VARCHAR(36) NOT NULL,
  `invocationId` VARCHAR(36) NOT NULL,
  `callIndex` TINYINT UNSIGNED NOT NULL,
  `runId` VARCHAR(36) NOT NULL,
  `stepId` VARCHAR(36) NOT NULL,
  `actionId` VARCHAR(191) NOT NULL,
  `stepFingerprint` CHAR(64) NOT NULL,
  `actorId` VARCHAR(191) NOT NULL,
  `configurationHash` CHAR(64) NOT NULL,
  `inputHash` CHAR(64) NOT NULL,
  `bindingHash` CHAR(64) NOT NULL,
  `encryptedPayload` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`scopeId`, `taskId`, `invocationId`, `callIndex`),
  INDEX `ai_gateway_tool_calls_step_idx` (`scopeId`, `taskId`, `runId`, `stepId`),
  CONSTRAINT `ai_gateway_tool_calls_index_check` CHECK (`callIndex` BETWEEN 0 AND 7),
  CONSTRAINT `ai_gateway_tool_calls_invocation_fkey`
    FOREIGN KEY (`scopeId`, `taskId`, `invocationId`)
    REFERENCES `ai_gateway_invocations` (`scopeId`, `taskId`, `id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_task_run_preparations` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `definition` JSON NOT NULL,
    `definitionHash` CHAR(64) NOT NULL,
    `authorityHash` CHAR(64) NOT NULL,
    `policyVersion` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `leaseOwnerId` VARCHAR(191) NOT NULL,
    `fencingToken` DECIMAL(20, 0) NOT NULL,
    `runRevision` INTEGER UNSIGNED NOT NULL,
    `chargeId` VARCHAR(36) NULL,
    `requestFingerprint` CHAR(64) NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `activeMs` BIGINT UNSIGNED NULL,
    `prepared` BOOLEAN NOT NULL DEFAULT false,
    `planHash` CHAR(64) NULL,
    `measurementHash` CHAR(64) NULL,
    INDEX `ai_task_run_preparations_run_idx`(`scopeId`, `taskId`, `runId`),
    UNIQUE INDEX `ai_task_run_preparations_generation_key`(`scopeId`, `taskId`, `runId`, `fencingToken`),
    PRIMARY KEY (`scopeId`, `taskId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_task_run_preparations_scopeId_taskId_runId_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_task_run_preparations_scopeId_taskId_chargeId_fkey`
  FOREIGN KEY (`scopeId`, `taskId`, `chargeId`) REFERENCES `ai_task_execution_charges`(`scopeId`, `taskId`, `chargeId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_run_preparation_charge_pair_check`
  CHECK ((`chargeId` IS NULL AND `requestFingerprint` IS NULL) OR (`chargeId` IS NOT NULL AND `requestFingerprint` IS NOT NULL));

ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_run_preparation_receipt_check`
  CHECK ((`completedAt` IS NULL AND `activeMs` IS NULL AND `measurementHash` IS NULL AND `prepared` = false AND `planHash` IS NULL)
    OR (`completedAt` IS NOT NULL AND `activeMs` IS NOT NULL AND `measurementHash` IS NOT NULL
      AND `chargeId` IS NOT NULL AND `requestFingerprint` IS NOT NULL AND `completedAt` >= `startedAt`
      AND ((`prepared` = false AND `planHash` IS NULL) OR (`prepared` = true AND `planHash` IS NOT NULL))));

ALTER TABLE `ai_task_run_preparations` ADD CONSTRAINT `ai_run_preparation_bounds_check`
  CHECK (`fencingToken` >= 1 AND `fencingToken` <= 18446744073709551615 AND `runRevision` >= 1
    AND (`activeMs` IS NULL OR `activeMs` <= 86400000));

CREATE TABLE `ai_task_run_overheads` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `runId` VARCHAR(36) NOT NULL,
    `segment` VARCHAR(191) NOT NULL,
    `originHash` CHAR(64) NOT NULL,
    `policyHash` CHAR(64) NOT NULL,
    `leaseOwnerId` VARCHAR(191) NOT NULL,
    `fencingToken` DECIMAL(20, 0) NOT NULL,
    `runRevision` INTEGER UNSIGNED NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,
    `chargeId` VARCHAR(36) NULL,
    `requestFingerprint` CHAR(64) NULL,
    `activeMs` BIGINT UNSIGNED NULL,
    `measurementHash` CHAR(64) NULL,
    INDEX `ai_task_run_overheads_run_idx`(`scopeId`, `taskId`, `runId`),
    PRIMARY KEY (`scopeId`, `taskId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_task_run_overheads_scopeId_taskId_runId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `runId`) REFERENCES `ai_runs`(`scopeId`, `taskId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_task_run_overheads_scopeId_taskId_chargeId_fkey` FOREIGN KEY (`scopeId`, `taskId`, `chargeId`) REFERENCES `ai_task_execution_charges`(`scopeId`, `taskId`, `chargeId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_run_overheads_generation_positive` CHECK (`fencingToken` > 0 AND `runRevision` > 0);

ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_run_overheads_original_charge` CHECK ((`chargeId` IS NULL AND `requestFingerprint` IS NULL) OR (`chargeId` IS NOT NULL AND BINARY `id` = BINARY `chargeId` AND `requestFingerprint` IS NOT NULL));

ALTER TABLE `ai_task_run_overheads` ADD CONSTRAINT `ai_run_overheads_complete_measurement` CHECK ((`completedAt` IS NULL AND `activeMs` IS NULL AND `measurementHash` IS NULL) OR (`completedAt` IS NOT NULL AND `activeMs` IS NOT NULL AND `measurementHash` IS NOT NULL AND `chargeId` IS NOT NULL AND `completedAt` >= `startedAt`));
