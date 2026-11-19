-- No default permission or policy is installed. Missing policy keeps local business tools closed.
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
