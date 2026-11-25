-- 公共异步任务台账；旧Rental组合库继续原迁移，本链用于独立公共库。

CREATE TABLE `AsyncJob` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `jobType` VARCHAR(191) NOT NULL,
    `businessType` VARCHAR(191) NULL,
    `businessId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `attempt` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `scheduledAt` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `operator` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `result` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AsyncJob_tenantId_jobType_status_idx`(`tenantId`, `jobType`, `status`),
    INDEX `AsyncJob_tenantId_scheduledAt_idx`(`tenantId`, `scheduledAt`),
    INDEX `AsyncJob_tenantId_businessType_businessId_idx`(`tenantId`, `businessType`, `businessId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AsyncJob` ADD CONSTRAINT `AsyncJob_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
