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
  UNIQUE INDEX `ai_client_task_policy_binding` (`id`, `tenantId`, `workspaceId`, `channel`, `customerType`, `sceneCode`, `sceneVersion`),
  CONSTRAINT `ai_client_task_policy_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`)
    REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
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
