-- SUB-01B：SaaS 版本订阅与 PRO 升级专项 — 数据层基线（全新领域，空库可全量建）。
-- 只新增订阅相关表；不修改/删除任何已应用迁移或已有表，无 DROP，符合《数据库启动与初始化》§4 迁移安全规则。
-- 服务状态不落库（由 startAt/endAt 推导）；金额一律可空并独立带币种，缺失表示待确认/待公布，不落 0。

-- CreateTable
CREATE TABLE `tenant_subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `plan` ENUM('standard', 'pro') NOT NULL,
    `source` ENUM('sale', 'pilot', 'historical_register', 'temp_extension') NOT NULL,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `serviceTimeZone` VARCHAR(64) NULL,
    `billingAnniversary` DATETIME(3) NULL,
    `currentAmount` DECIMAL(12, 2) NULL,
    `currentCurrency` VARCHAR(8) NULL,
    `sourceReason` VARCHAR(512) NULL,
    `handledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_subscriptions_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_subscription_segments` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `status` ENUM('current', 'scheduled', 'historical') NOT NULL,
    `plan` ENUM('standard', 'pro') NOT NULL,
    `source` ENUM('sale', 'pilot', 'historical_register', 'temp_extension') NOT NULL,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `amount` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(8) NULL,
    `reason` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_subscription_segments_tenantId_status_idx`(`tenantId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_feature_catalog` (
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `categories` JSON NOT NULL,
    `defaultOwnership` ENUM('standard', 'pro') NOT NULL,
    `currentOwnership` ENUM('standard', 'pro') NOT NULL,
    `releaseStatus` ENUM('planned', 'pilot', 'released', 'paused', 'retired') NOT NULL DEFAULT 'planned',
    `valueText` TEXT NULL,
    `prerequisiteText` TEXT NULL,
    `externalFeeNote` TEXT NULL,
    `contentVersion` VARCHAR(64) NULL,
    `effectiveAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_feature_grants` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `featureCode` VARCHAR(191) NOT NULL,
    `effectiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `operator` VARCHAR(191) NULL,
    `reason` VARCHAR(512) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokedReason` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tenant_feature_grants_tenantId_idx`(`tenantId`),
    UNIQUE INDEX `tenant_feature_grants_tenantId_featureCode_key`(`tenantId`, `featureCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_requests` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `type` ENUM('upgrade_pro', 'renew_standard', 'renew_pro', 'upgrade_consult', 'next_standard', 'no_renew') NOT NULL,
    `targetPlan` ENUM('standard', 'pro') NULL,
    `status` ENUM('pending', 'processed', 'rejected', 'cancelled') NOT NULL DEFAULT 'pending',
    `contactName` VARCHAR(120) NULL,
    `contactPhone` VARCHAR(32) NULL,
    `moduleIntent` JSON NULL,
    `note` TEXT NULL,
    `timeline` JSON NULL,
    `publicReason` VARCHAR(512) NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `handledAmount` DECIMAL(12, 2) NULL,
    `handledCurrency` VARCHAR(8) NULL,
    `periodText` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `subscription_requests_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `subscription_requests_tenantId_dedupeKey_key`(`tenantId`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_events` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NULL,
    `type` ENUM('provision', 'upgrade', 'renew', 'downgrade', 'temp_extension', 'term_correction', 'public_grant', 'public_revoke', 'tenant_grant', 'tenant_revoke', 'catalog_update', 'price_update') NOT NULL,
    `beforeJson` JSON NULL,
    `afterJson` JSON NULL,
    `amount` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(8) NULL,
    `handlingNote` TEXT NULL,
    `reason` VARCHAR(512) NULL,
    `operator` VARCHAR(191) NULL,
    `effectiveAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `subscription_events_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `subscription_events_type_createdAt_idx`(`type`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_standard_prices` (
    `id` VARCHAR(191) NOT NULL,
    `plan` ENUM('standard', 'pro') NOT NULL,
    `annualFee` DECIMAL(12, 2) NULL,
    `currency` VARCHAR(8) NULL,
    `taxInclusive` BOOLEAN NULL,
    `published` BOOLEAN NOT NULL DEFAULT false,
    `priceVersion` VARCHAR(64) NULL,
    `note` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscription_standard_prices_plan_key`(`plan`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tenant_subscriptions` ADD CONSTRAINT `tenant_subscriptions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_subscription_segments` ADD CONSTRAINT `tenant_subscription_segments_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_feature_grants` ADD CONSTRAINT `tenant_feature_grants_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_requests` ADD CONSTRAINT `subscription_requests_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_events` ADD CONSTRAINT `subscription_events_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
