-- Reports and operations observability tables for store-rental reporting.
CREATE TABLE `ReportExportJob` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `reportType` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'completed',
    `filters` JSON NOT NULL,
    `rowCount` INTEGER NOT NULL DEFAULT 0,
    `downloadUrl` VARCHAR(191) NULL,
    `operator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `ReportExportJob_tenantId_reportType_createdAt_idx`(`tenantId`, `reportType`, `createdAt`),
    INDEX `ReportExportJob_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `OpsEventLog` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `level` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `message` VARCHAR(191) NOT NULL,
    `payload` JSON NULL,
    `traceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OpsEventLog_tenantId_level_createdAt_idx`(`tenantId`, `level`, `createdAt`),
    INDEX `OpsEventLog_tenantId_category_createdAt_idx`(`tenantId`, `category`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ReportExportJob` ADD CONSTRAINT `ReportExportJob_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `OpsEventLog` ADD CONSTRAINT `OpsEventLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
