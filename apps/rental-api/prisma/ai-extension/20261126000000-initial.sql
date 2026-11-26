-- Rental AI extension. Requires public AI 0.2.0 and Rental initial before execution.
ALTER TABLE `ai_scopes` ADD CONSTRAINT `ai_scopes_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE `ai_approved_order_snapshots` (
    `scopeId` VARCHAR(36) NOT NULL,
    `taskId` VARCHAR(36) NOT NULL,
    `proposalId` VARCHAR(36) NOT NULL,
    `proposalRevision` INTEGER UNSIGNED NOT NULL,
    `actionId` VARCHAR(191) NOT NULL,
    `actionFingerprint` CHAR(64) NOT NULL,
    `kind` ENUM('input', 'preview') NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `revision` INTEGER UNSIGNED NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `actorKind` ENUM('saas_admin', 'user', 'customer', 'automation') NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `audience` ENUM('operator', 'staff', 'client', 'automation') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_approved_order_snapshots_action_kind`(`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `kind`),
    PRIMARY KEY (`scopeId`, `recordId`, `revision`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_approved_order_snapshots` ADD CONSTRAINT `ai_approved_order_snapshots_action_fkey` FOREIGN KEY (`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `actionFingerprint`) REFERENCES `ai_proposal_actions`(`scopeId`, `taskId`, `proposalId`, `proposalRevision`, `actionId`, `requestFingerprint`) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE `ai_inspection_drafts` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `audience` VARCHAR(16) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `allocationId` VARCHAR(191) NOT NULL,
  `assetId` VARCHAR(191) NOT NULL,
  `stage` VARCHAR(16) NOT NULL,
  `templateId` VARCHAR(191) NOT NULL,
  `templateVersion` VARCHAR(128) NOT NULL,
  `bindingFingerprint` CHAR(64) NOT NULL,
  `evidenceFingerprint` CHAR(64) NOT NULL,
  `inputFingerprint` CHAR(64) NULL,
  `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `status` VARCHAR(32) NOT NULL,
  `state` JSON NOT NULL,
  `submissionActionId` VARCHAR(128) NULL,
  `inspectionId` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_inspection_draft_scope_key` (`id`, `tenantId`, `workspaceId`),
  INDEX `ai_inspection_draft_list_idx` (`tenantId`, `workspaceId`, `ownerId`, `audience`, `id`),
  CONSTRAINT `ai_inspection_drafts_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_inspection_drafts_revision_check` CHECK (`revision` BETWEEN 1 AND 1000),
  CONSTRAINT `ai_inspection_drafts_stage_check` CHECK (`stage` IN ('pickup', 'return')),
  CONSTRAINT `ai_inspection_drafts_audience_check` CHECK (`audience` IN ('operator', 'staff')),
  CONSTRAINT `ai_inspection_drafts_status_check` CHECK (`status` IN ('draft_saved', 'prepared', 'submission_unknown', 'submitted')),
  CONSTRAINT `ai_inspection_drafts_state_size_check` CHECK (OCTET_LENGTH(CAST(`state` AS CHAR)) <= 262144)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_inspection_operations` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `audience` VARCHAR(16) NOT NULL,
  `operationId` VARCHAR(128) NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `draftId` VARCHAR(36) NOT NULL,
  `expectedRevision` INTEGER UNSIGNED NOT NULL,
  `resultRevision` INTEGER UNSIGNED NOT NULL,
  `result` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_inspection_operation_scope_key` (`tenantId`, `workspaceId`, `operationId`),
  INDEX `ai_inspection_operation_draft_idx` (`draftId`, `createdAt`),
  CONSTRAINT `ai_inspection_operations_draft_fk` FOREIGN KEY (`draftId`, `tenantId`, `workspaceId`) REFERENCES `ai_inspection_drafts` (`id`, `tenantId`, `workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_inspection_operations_revision_check` CHECK (`resultRevision` = `expectedRevision` + 1 AND `resultRevision` <= 1000)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_inspection_evidence_bindings` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `ownerId` VARCHAR(191) NOT NULL,
  `audience` VARCHAR(16) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `allocationId` VARCHAR(191) NOT NULL,
  `assetId` VARCHAR(191) NOT NULL,
  `stage` VARCHAR(16) NOT NULL,
  `templateId` VARCHAR(191) NOT NULL,
  `templateVersion` VARCHAR(128) NOT NULL,
  `bindingFingerprint` CHAR(64) NOT NULL,
  `attachmentId` VARCHAR(191) NOT NULL,
  `attachmentRevision` INTEGER UNSIGNED NOT NULL,
  `uploadSessionId` VARCHAR(191) NOT NULL,
  `storageFingerprint` CHAR(64) NOT NULL,
  `contentHash` CHAR(64) NULL,
  `mediaType` VARCHAR(64) NULL,
  `sizeBytes` INTEGER UNSIGNED NULL,
  `width` INTEGER UNSIGNED NULL,
  `height` INTEGER UNSIGNED NULL,
  `durationMs` INTEGER UNSIGNED NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_inspection_evidence_revision_key` (`tenantId`, `workspaceId`, `attachmentId`, `attachmentRevision`),
  INDEX `ai_inspection_evidence_target_idx` (`tenantId`, `workspaceId`, `orderId`, `allocationId`),
  CONSTRAINT `ai_inspection_evidence_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_inspection_evidence_attachment_fk` FOREIGN KEY (`attachmentId`) REFERENCES `FileAsset` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_inspection_evidence_revision_check` CHECK (`attachmentRevision` > 0),
  CONSTRAINT `ai_inspection_evidence_stage_check` CHECK (`stage` IN ('pickup', 'return')),
  CONSTRAINT `ai_inspection_evidence_audience_check` CHECK (`audience` IN ('operator', 'staff'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

CREATE UNIQUE INDEX `ai_inspection_draft_action_key`
ON `ai_inspection_drafts` (`tenantId`, `workspaceId`, `submissionActionId`);

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

CREATE TABLE `ai_business_failure_outbox` (
  `id` VARCHAR(36) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `eventType` VARCHAR(32) NOT NULL,
  `notificationId` VARCHAR(191) NULL,
  `refundId` VARCHAR(191) NULL,
  `resourceRevision` INTEGER UNSIGNED NOT NULL,
  `orderId` VARCHAR(191) NULL,
  `failureCode` VARCHAR(32) NOT NULL,
  `traceId` VARCHAR(191) NOT NULL,
  `causationId` VARCHAR(191) NOT NULL,
  `deduplicationKey` CHAR(64) NOT NULL,
  `occurredAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
  `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `fence` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `leaseOwner` VARCHAR(128) NULL,
  `leaseUntil` DATETIME(3) NULL,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastErrorCode` VARCHAR(32) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_failure_outbox_dedup_key` (`tenantId`, `workspaceId`, `deduplicationKey`),
  INDEX `ai_failure_outbox_due_idx` (`tenantId`, `workspaceId`, `status`, `nextAttemptAt`),
  CONSTRAINT `ai_failure_outbox_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_failure_outbox_notification_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `notificationId`) REFERENCES `rental_notification_logs` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_failure_outbox_refund_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `refundId`) REFERENCES `rental_payment_refunds` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `ai_failure_outbox_resource_check` CHECK (
    (`eventType` = 'notification.failed' AND `notificationId` IS NOT NULL AND `refundId` IS NULL AND `failureCode` = 'delivery_failed') OR
    (`eventType` = 'refund.failed' AND `refundId` IS NOT NULL AND `notificationId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'provider_failed')
  ),
  CONSTRAINT `ai_failure_outbox_state_check` CHECK (`status` IN ('pending', 'claimed', 'retry_scheduled', 'ready', 'expired', 'dead_letter', 'closed')),
  CONSTRAINT `ai_failure_outbox_bounds_check` CHECK (`resourceRevision` > 0 AND `attempts` <= 3 AND `expiresAt` > `occurredAt`),
  CONSTRAINT `ai_failure_outbox_lease_check` CHECK ((`status` = 'claimed' AND `leaseOwner` IS NOT NULL AND `leaseUntil` IS NOT NULL) OR (`status` <> 'claimed' AND `leaseOwner` IS NULL AND `leaseUntil` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_business_failure_outbox` ADD UNIQUE INDEX `ai_failure_outbox_scope_id_key` (`tenantId`, `workspaceId`, `id`);

ALTER TABLE `ai_automation_subjects` ADD CONSTRAINT `ai_automation_subject_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_automation_inputs` ADD CONSTRAINT `ai_automation_input_event_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `eventId`) REFERENCES `ai_business_failure_outbox` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_client_scene_materials` ADD CONSTRAINT `ai_client_materials_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`)
    REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_client_task_policies` ADD CONSTRAINT `ai_client_task_policy_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`)
    REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE `ai_client_booking_drafts` (
  `id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `principalKind` VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
  `principalHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `materialRef` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `inputHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `bindingHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `policyHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `state` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL,
  `selectionRevision` INTEGER UNSIGNED NOT NULL,
  `selectedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `invalidReason` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_booking_draft_material_key` (`materialRef`),
  UNIQUE INDEX `ai_booking_draft_binding` (`id`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`),
  INDEX `ai_booking_draft_expiry` (`tenantId`, `workspaceId`, `expiresAt`),
  CONSTRAINT `ai_booking_draft_material_fk` FOREIGN KEY (`materialRef`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`)
    REFERENCES `ai_client_scene_materials` (`id`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_client_booking_draft_operations` (
  `id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `principalKind` VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
  `principalHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `operationKey` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  `inputHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `draftId` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `kind` VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
  `resultRevision` INTEGER UNSIGNED NOT NULL,
  `handoffRef` VARCHAR(36) COLLATE utf8mb4_bin NULL,
  `createdAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_booking_operation_key` (`tenantId`, `workspaceId`, `channel`, `principalHash`, `operationKey`),
  CONSTRAINT `ai_booking_operation_draft_fk` FOREIGN KEY (`draftId`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`)
    REFERENCES `ai_client_booking_drafts` (`id`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_client_booking_handoffs` (
  `id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  `principalKind` VARCHAR(16) COLLATE utf8mb4_bin NOT NULL,
  `principalHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `draftId` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `inputHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `selectionRevision` INTEGER UNSIGNED NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `ai_booking_handoff_draft_key` (`draftId`),
  INDEX `ai_booking_handoff_expiry` (`tenantId`, `workspaceId`, `expiresAt`),
  CONSTRAINT `ai_booking_handoff_draft_fk` FOREIGN KEY (`draftId`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`)
    REFERENCES `ai_client_booking_drafts` (`id`, `tenantId`, `workspaceId`, `channel`, `principalKind`, `principalHash`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_knowledge_policy_management_authorities` ADD CONSTRAINT `ai_kp_authority_workspace_fk`
  FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `ai_business_failure_outbox`
  DROP CHECK `ai_failure_outbox_resource_check`,
  ADD COLUMN `inspectionId` VARCHAR(191) NULL,
  ADD COLUMN `exceptionId` VARCHAR(191) NULL,
  ADD INDEX `ai_failure_outbox_inspection_idx` (`tenantId`, `workspaceId`, `inspectionId`, `exceptionId`),
  ADD CONSTRAINT `ai_failure_outbox_inspection_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `inspectionId`, `orderId`)
    REFERENCES `rental_inspection_records` (`tenantId`, `workspaceId`, `id`, `orderId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_resource_check` CHECK (
    (`eventType` = 'notification.failed' AND `notificationId` IS NOT NULL AND `refundId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `failureCode` = 'delivery_failed') OR
    (`eventType` = 'refund.failed' AND `refundId` IS NOT NULL AND `notificationId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'provider_failed') OR
    (`eventType` = 'inspection.return_exception' AND `inspectionId` IS NOT NULL AND `exceptionId` IS NOT NULL AND CHAR_LENGTH(`exceptionId`) > 0 AND `notificationId` IS NULL AND `refundId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'review_pending')
  );

CREATE TABLE `ai_desktop_business_policies` (
  `tenantId` VARCHAR(36) NOT NULL,
  `workspaceId` VARCHAR(36) NOT NULL,
  `revision` INTEGER UNSIGNED NOT NULL,
  `policyJson` JSON NOT NULL,
  `updatedBy` VARCHAR(36) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`, `workspaceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_desktop_business_policy_operations` (
  `tenantId` VARCHAR(36) NOT NULL,
  `workspaceId` VARCHAR(36) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `actorId` VARCHAR(36) NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `resultJson` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ai_desktop_business_operations_created_idx`(`tenantId`, `workspaceId`, `createdAt`),
  PRIMARY KEY (`tenantId`, `workspaceId`, `operationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ai_business_failure_outbox`
  DROP CHECK `ai_failure_outbox_resource_check`,
  ADD COLUMN `fulfillmentOrderId` VARCHAR(191) NULL,
  ADD COLUMN `configurationKind` VARCHAR(24) NULL,
  ADD COLUMN `configurationId` VARCHAR(191) NULL,
  ADD COLUMN `configurationProfileTenantId` VARCHAR(191) NULL,
  ADD COLUMN `configurationSnapshotWorkspaceId` VARCHAR(191) NULL,
  ADD COLUMN `configurationSettingsWorkspaceId` VARCHAR(191) NULL,
  ADD COLUMN `sectionCode` VARCHAR(64) NULL,
  ADD COLUMN `dueAt` DATETIME(3) NULL,
  ADD COLUMN `locationId` VARCHAR(191) NULL,
  ADD COLUMN `sourceHash` CHAR(64) NULL,
  ADD COLUMN `sourcePolicyId` VARCHAR(191) NULL,
  ADD COLUMN `sourcePolicyRevision` INTEGER UNSIGNED NULL,
  ADD INDEX `ai_failure_outbox_fulfillment_idx` (`tenantId`, `workspaceId`, `fulfillmentOrderId`),
  ADD INDEX `ai_failure_outbox_config_idx` (`tenantId`, `workspaceId`, `configurationKind`, `configurationId`, `sectionCode`),
  ADD CONSTRAINT `ai_failure_outbox_fulfillment_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `fulfillmentOrderId`)
    REFERENCES `rental_orders` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_location_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `locationId`)
    REFERENCES `rental_fulfillment_locations` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_config_profile_fk` FOREIGN KEY (`configurationProfileTenantId`)
    REFERENCES `tenant_rental_profiles` (`tenantId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_config_snapshot_fk` FOREIGN KEY (`tenantId`, `configurationSnapshotWorkspaceId`)
    REFERENCES `rental_core_state_snapshots` (`tenantId`, `workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_config_settings_fk` FOREIGN KEY (`tenantId`, `configurationSettingsWorkspaceId`)
    REFERENCES `rental_tenant_business_settings` (`tenantId`, `workspaceId`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `ai_failure_outbox_resource_check` CHECK (COALESCE((
    

    (
      `fulfillmentOrderId` IS NULL AND `configurationKind` IS NULL AND `configurationId` IS NULL
      AND `configurationProfileTenantId` IS NULL AND `configurationSnapshotWorkspaceId` IS NULL
      AND `configurationSettingsWorkspaceId` IS NULL AND `sectionCode` IS NULL
      AND `dueAt` IS NULL AND `locationId` IS NULL AND `sourceHash` IS NULL
      AND `sourcePolicyId` IS NULL AND `sourcePolicyRevision` IS NULL
      AND (
        (`eventType` = 'notification.failed' AND `notificationId` IS NOT NULL AND `refundId` IS NULL
          AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `failureCode` = 'delivery_failed')
        OR (`eventType` = 'refund.failed' AND `refundId` IS NOT NULL AND `notificationId` IS NULL
          AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'provider_failed')
        OR (`eventType` = 'inspection.return_exception' AND `inspectionId` IS NOT NULL
          AND `exceptionId` IS NOT NULL AND CHAR_LENGTH(`exceptionId`) > 0
          AND `notificationId` IS NULL AND `refundId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'review_pending')
      )
    )
    OR (
      `eventType` = 'fulfillment.resource_shortage' AND `failureCode` = 'resource_shortage'
      AND `notificationId` IS NULL AND `refundId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL
      AND `fulfillmentOrderId` IS NOT NULL AND `orderId` IS NOT NULL AND `orderId` = `fulfillmentOrderId`
      AND `dueAt` IS NOT NULL AND `dueAt` > `occurredAt` AND `locationId` IS NOT NULL
      AND `sourceHash` IS NOT NULL AND REGEXP_LIKE(`sourceHash`, '^[a-f0-9]{64}$', 'c')
      AND `sourcePolicyId` IS NOT NULL AND CHAR_LENGTH(`sourcePolicyId`) > 0
      AND `sourcePolicyRevision` IS NOT NULL AND `sourcePolicyRevision` BETWEEN 1 AND 4294967294
      AND `configurationKind` IS NULL AND `configurationId` IS NULL AND `configurationProfileTenantId` IS NULL
      AND `configurationSnapshotWorkspaceId` IS NULL AND `configurationSettingsWorkspaceId` IS NULL AND `sectionCode` IS NULL
    )
    OR (
      `eventType` = 'opening.missing_configuration' AND `failureCode` = 'missing_configuration'
      AND `notificationId` IS NULL AND `refundId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL
      AND `orderId` IS NULL AND `fulfillmentOrderId` IS NULL AND `dueAt` IS NULL AND `locationId` IS NULL
      AND `sourcePolicyId` IS NULL AND `sourcePolicyRevision` IS NULL
      AND `configurationKind` IS NOT NULL AND `configurationId` IS NOT NULL AND CHAR_LENGTH(`configurationId`) > 0
      AND `sourceHash` IS NOT NULL AND REGEXP_LIKE(`sourceHash`, '^[a-f0-9]{64}$', 'c')
      AND `sectionCode` IS NOT NULL AND `sectionCode` IN (
        'workspace_profile', 'accounts_roles', 'fulfillment_network', 'business_rule', 'business_calendar',
        'item_groups', 'pricing_groups_rates', 'price_version', 'membership_base'
      )
      AND (
        (`configurationKind` = 'tenant_profile' AND `configurationProfileTenantId` IS NOT NULL
          AND `configurationProfileTenantId` = `tenantId` AND `configurationId` = `configurationProfileTenantId`
          AND `configurationSnapshotWorkspaceId` IS NULL AND `configurationSettingsWorkspaceId` IS NULL)
        OR (`configurationKind` = 'core_snapshot' AND `configurationSnapshotWorkspaceId` IS NOT NULL
          AND `configurationSnapshotWorkspaceId` = `workspaceId` AND `configurationId` = `configurationSnapshotWorkspaceId`
          AND `configurationProfileTenantId` IS NULL AND `configurationSettingsWorkspaceId` IS NULL)
        OR (`configurationKind` = 'business_settings' AND `configurationSettingsWorkspaceId` IS NOT NULL
          AND `configurationSettingsWorkspaceId` = `workspaceId` AND `configurationId` = `configurationSettingsWorkspaceId`
          AND `configurationProfileTenantId` IS NULL AND `configurationSnapshotWorkspaceId` IS NULL)
      )
    )
  ), FALSE));

ALTER TABLE `ai_business_failure_outbox`
  DROP CHECK `ai_failure_outbox_resource_check`,
  ADD CONSTRAINT `ai_failure_outbox_resource_check` CHECK (COALESCE((
    

    (
      `fulfillmentOrderId` IS NULL AND `configurationKind` IS NULL AND `configurationId` IS NULL
      AND `configurationProfileTenantId` IS NULL AND `configurationSnapshotWorkspaceId` IS NULL
      AND `configurationSettingsWorkspaceId` IS NULL AND `sectionCode` IS NULL
      AND `dueAt` IS NULL AND `locationId` IS NULL AND `sourceHash` IS NULL
      AND `sourcePolicyId` IS NULL AND `sourcePolicyRevision` IS NULL
      AND (
        (`eventType` = 'notification.failed' AND `notificationId` IS NOT NULL AND `refundId` IS NULL
          AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `failureCode` = 'delivery_failed')
        OR (`eventType` = 'refund.failed' AND `refundId` IS NOT NULL AND `notificationId` IS NULL
          AND `inspectionId` IS NULL AND `exceptionId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'provider_failed')
        OR (`eventType` = 'inspection.return_exception' AND `inspectionId` IS NOT NULL
          AND `exceptionId` IS NOT NULL AND CHAR_LENGTH(`exceptionId`) > 0
          AND `notificationId` IS NULL AND `refundId` IS NULL AND `orderId` IS NOT NULL AND `failureCode` = 'review_pending')
      )
    )
    OR (
      `eventType` = 'fulfillment.resource_shortage' AND `failureCode` = 'resource_shortage'
      AND `notificationId` IS NULL AND `refundId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL
      AND `fulfillmentOrderId` IS NOT NULL AND `orderId` IS NOT NULL AND `orderId` = `fulfillmentOrderId`
      AND `dueAt` IS NOT NULL AND `dueAt` > `occurredAt` AND `locationId` IS NOT NULL
      AND `sourceHash` IS NOT NULL AND REGEXP_LIKE(`sourceHash`, '^[a-f0-9]{64}$', 'c')
      AND `sourcePolicyId` IS NOT NULL AND CHAR_LENGTH(`sourcePolicyId`) > 0
      AND `sourcePolicyRevision` IS NOT NULL AND `sourcePolicyRevision` BETWEEN 1 AND 4294967294
      AND `configurationKind` IS NULL AND `configurationId` IS NULL AND `configurationProfileTenantId` IS NULL
      AND `configurationSnapshotWorkspaceId` IS NULL AND `configurationSettingsWorkspaceId` IS NULL AND `sectionCode` IS NULL
    )
    OR (
      `eventType` = 'opening.missing_configuration' AND `failureCode` = 'missing_configuration'
      AND `notificationId` IS NULL AND `refundId` IS NULL AND `inspectionId` IS NULL AND `exceptionId` IS NULL
      AND `orderId` IS NULL AND `fulfillmentOrderId` IS NULL AND `dueAt` IS NULL AND `locationId` IS NULL
      AND `sourcePolicyId` IS NULL AND `sourcePolicyRevision` IS NULL
      AND `configurationKind` IS NOT NULL AND `configurationId` IS NOT NULL AND CHAR_LENGTH(`configurationId`) > 0
      AND `sourceHash` IS NOT NULL AND REGEXP_LIKE(`sourceHash`, '^[a-f0-9]{64}$', 'c')
      AND `sectionCode` IS NOT NULL AND `sectionCode` IN (
        'workspace_profile', 'accounts_roles', 'fulfillment_network', 'business_rule', 'business_calendar',
        'item_groups', 'pricing_groups_rates', 'price_version', 'membership_base'
      )
      AND (
        (`configurationKind` = 'tenant_profile' AND `configurationProfileTenantId` IS NOT NULL
          AND `configurationProfileTenantId` = `tenantId` AND `configurationId` = `configurationProfileTenantId`
          AND `configurationSnapshotWorkspaceId` IS NULL AND `configurationSettingsWorkspaceId` IS NULL)
        OR (`configurationKind` = 'core_snapshot' AND `configurationSnapshotWorkspaceId` IS NOT NULL
          AND `configurationSnapshotWorkspaceId` = `workspaceId` AND `configurationId` = `configurationSnapshotWorkspaceId`
          AND `configurationProfileTenantId` IS NULL AND `configurationSettingsWorkspaceId` IS NULL)
        OR (`configurationKind` = 'business_settings' AND `configurationSettingsWorkspaceId` IS NOT NULL
          AND `configurationSettingsWorkspaceId` = `workspaceId` AND `configurationId` = `configurationSettingsWorkspaceId`
          AND `configurationProfileTenantId` IS NULL AND `configurationSnapshotWorkspaceId` IS NULL)
      )
    )
  ), FALSE) = TRUE);
