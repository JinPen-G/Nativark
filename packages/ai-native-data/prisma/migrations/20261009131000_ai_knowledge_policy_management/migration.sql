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

ALTER TABLE `ai_knowledge_policy_management_authorities` ADD CONSTRAINT `ai_kp_authority_workspace_fk`
  FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_knowledge_policy_preparations` ADD CONSTRAINT `ai_kp_preparation_authority_fk`
  FOREIGN KEY (`tenantId`, `workspaceId`, `authorityId`) REFERENCES `ai_knowledge_policy_management_authorities` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `ai_knowledge_policy_management_operations` ADD CONSTRAINT `ai_kp_operation_preparation_fk`
  FOREIGN KEY (`tenantId`, `workspaceId`, `preparationId`) REFERENCES `ai_knowledge_policy_preparations` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
