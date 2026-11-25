-- 公共通知模板与发送台账。原字段及外键沿用 add_infra_adapters；适配日志复用公共集成表。

CREATE TABLE `NotificationTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `trigger` VARCHAR(191) NOT NULL,
    `channels` JSON NOT NULL,
    `content` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NotificationTemplate_tenantId_category_enabled_idx`(`tenantId`, `category`, `enabled`),
    UNIQUE INDEX `NotificationTemplate_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NotificationTemplate` ADD CONSTRAINT `NotificationTemplate_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `NotificationSendLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `templateCode` VARCHAR(191) NULL,
    `businessType` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `targetName` VARCHAR(191) NULL,
    `targetMasked` VARCHAR(191) NULL,
    `channels` JSON NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'mock',
    `status` VARCHAR(191) NOT NULL,
    `requestJson` JSON NOT NULL,
    `responseJson` JSON NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NotificationSendLog_tenantId_businessType_businessId_idx`(`tenantId`, `businessType`, `businessId`),
    INDEX `NotificationSendLog_tenantId_templateCode_createdAt_idx`(`tenantId`, `templateCode`, `createdAt`),
    INDEX `NotificationSendLog_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NotificationSendLog` ADD CONSTRAINT `NotificationSendLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
