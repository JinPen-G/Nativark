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
