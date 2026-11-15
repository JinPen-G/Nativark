-- 新公共宿主的统一订阅期限存储；源自原SUB两份不可变迁移，本链不覆盖旧组合库。
-- 本迁移不创建默认订阅、期限或付款记录。

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

ALTER TABLE `tenant_subscriptions` ADD CONSTRAINT `tenant_subscriptions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

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

ALTER TABLE `tenant_subscription_segments` ADD CONSTRAINT `tenant_subscription_segments_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `tenant_subscriptions` ADD COLUMN `currentTaxInclusive` BOOLEAN NULL;

ALTER TABLE `tenant_subscription_segments`
  ADD COLUMN `taxInclusive` BOOLEAN NULL,
  ADD COLUMN `billingAnniversary` DATETIME(3) NULL;
