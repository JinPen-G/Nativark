-- B02-W01: provider profile ownership, role and revision state.
CREATE TABLE `ai_scopes` (
  `id` VARCHAR(36) NOT NULL,
  `kind` ENUM('platform','tenant','workspace') NOT NULL,
  `scopeKey` VARCHAR(512) NOT NULL,
  `tenantId` VARCHAR(191) NULL,
  `workspaceId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_scopes_scope_key` (`scopeKey`),
  UNIQUE INDEX `ai_scopes_id_kind` (`id`,`kind`),
  INDEX `ai_scopes_owner_idx` (`tenantId`,`workspaceId`),
  PRIMARY KEY (`id`)
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
  CONSTRAINT `ai_scopes_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ai_scopes_workspace_fk` FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ai_provider_profiles_scope_fk` FOREIGN KEY (`scopeId`,`scopeKind`) REFERENCES `ai_scopes` (`id`,`kind`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
