-- TENANT-INTEGRATION-01：租户自有短信、支付与文件存储配置。
CREATE TABLE `tenant_integration_configs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `capability` VARCHAR(20) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `settings` JSON NOT NULL,
    `credentialsEncrypted` TEXT NULL,
    `secretFields` JSON NOT NULL,
    `lastTestStatus` VARCHAR(20) NOT NULL DEFAULT 'not_tested',
    `lastTestAt` DATETIME(3) NULL,
    `lastTestError` VARCHAR(500) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `tenant_integration_configs_scope_provider_key` (`tenantId`, `capability`, `provider`),
    INDEX `tenant_integration_configs_scope_capability_idx` (`tenantId`, `capability`, `enabled`),
    CONSTRAINT `tenant_integration_configs_tenantId_fkey`
      FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
