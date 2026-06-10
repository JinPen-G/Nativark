-- CreateTable
CREATE TABLE `FileAsset` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessModule` VARCHAR(191) NOT NULL,
    `businessType` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `fileExt` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL DEFAULT 0,
    `storageProvider` VARCHAR(191) NOT NULL DEFAULT 'local_mock',
    `storageKey` VARCHAR(191) NOT NULL,
    `publicUrl` VARCHAR(191) NULL,
    `checksum` VARCHAR(191) NULL,
    `uploadScene` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `uploadedBy` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FileAsset_tenantId_businessType_businessId_idx`(`tenantId`, `businessType`, `businessId`),
    INDEX `FileAsset_tenantId_uploadScene_createdAt_idx`(`tenantId`, `uploadScene`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE `DocumentPrintJob` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `documentNo` VARCHAR(191) NOT NULL,
    `documentType` VARCHAR(191) NOT NULL,
    `templateCode` VARCHAR(191) NOT NULL,
    `businessType` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `fileAssetId` VARCHAR(191) NULL,
    `operator` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `result` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DocumentPrintJob_tenantId_documentType_createdAt_idx`(`tenantId`, `documentType`, `createdAt`),
    INDEX `DocumentPrintJob_tenantId_businessType_businessId_idx`(`tenantId`, `businessType`, `businessId`),
    UNIQUE INDEX `DocumentPrintJob_tenantId_documentNo_key`(`tenantId`, `documentNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TBoxDevice` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `cid` VARCHAR(191) NOT NULL,
    `simNo` VARCHAR(191) NULL,
    `model` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'unbound',
    `boundVehicleId` VARCHAR(191) NULL,
    `boundPlateNo` VARCHAR(191) NULL,
    `vehicleModel` VARCHAR(191) NULL,
    `firmwareVersion` VARCHAR(191) NULL,
    `appVersion` VARCHAR(191) NULL,
    `warrantyExpireAt` DATETIME(3) NULL,
    `supportsIButton` BOOLEAN NOT NULL DEFAULT false,
    `iButtonCode` VARCHAR(191) NULL,
    `powerOnAt` DATETIME(3) NULL,
    `lastHeartbeatAt` DATETIME(3) NULL,
    `telemetry` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TBoxDevice_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `TBoxDevice_tenantId_boundPlateNo_idx`(`tenantId`, `boundPlateNo`),
    UNIQUE INDEX `TBoxDevice_tenantId_cid_key`(`tenantId`, `cid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `FileAsset` ADD CONSTRAINT `FileAsset_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationTemplate` ADD CONSTRAINT `NotificationTemplate_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationSendLog` ADD CONSTRAINT `NotificationSendLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExternalAdapterLog` ADD CONSTRAINT `ExternalAdapterLog_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AsyncJob` ADD CONSTRAINT `AsyncJob_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentPrintJob` ADD CONSTRAINT `DocumentPrintJob_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TBoxDevice` ADD CONSTRAINT `TBoxDevice_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
