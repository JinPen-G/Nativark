-- Dedicated revisioned dual-mode configuration. Existing system-rules are not
-- rewritten or assumed to contain valid encrypted credentials by this migration.
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
