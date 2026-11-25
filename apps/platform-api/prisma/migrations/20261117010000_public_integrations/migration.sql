-- 公共租户第三方配置与适配日志。沿原租户范围、加密字段、测试CAS及外键，只进入独立公共迁移链。
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
    `lastTestMode` VARCHAR(20) NOT NULL DEFAULT 'none',
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

CREATE TABLE `ExternalAdapterLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `capability` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `businessType` VARCHAR(191) NULL,
    `businessId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `requestJson` JSON NOT NULL,
    `responseJson` JSON NULL,
    `errorMessage` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExternalAdapterLog_tenantId_provider_capability_createdAt_idx`(`tenantId`, `provider`, `capability`, `createdAt`),
    INDEX `ExternalAdapterLog_tenantId_businessType_businessId_idx`(`tenantId`, `businessType`, `businessId`),
    INDEX `ExternalAdapterLog_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ExternalAdapterLog` ADD CONSTRAINT `ExternalAdapterLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
