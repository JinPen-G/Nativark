-- No grants are seeded. Provisioning requires a separately authorized server path.
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
