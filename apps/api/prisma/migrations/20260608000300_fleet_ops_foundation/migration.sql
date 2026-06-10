-- CreateTable
CREATE TABLE `VehicleTransferTask` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `taskNo` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'completed',
    `sourceStoreName` VARCHAR(191) NOT NULL,
    `sourceStationName` VARCHAR(191) NOT NULL,
    `targetStoreName` VARCHAR(191) NOT NULL,
    `targetStationName` VARCHAR(191) NOT NULL,
    `targetServiceType` ENUM('STORE_STANDARD', 'STORE_24H') NOT NULL DEFAULT 'STORE_STANDARD',
    `vehicleCount` INTEGER NOT NULL DEFAULT 0,
    `reason` VARCHAR(191) NULL,
    `operator` VARCHAR(191) NULL,
    `items` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `VehicleTransferTask_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    UNIQUE INDEX `VehicleTransferTask_tenantId_taskNo_key`(`tenantId`, `taskNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleCredentialRecord` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `credentialType` VARCHAR(191) NOT NULL,
    `credentialName` VARCHAR(191) NOT NULL,
    `certNo` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `issueAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `reminderDays` INTEGER NOT NULL DEFAULT 30,
    `attachments` JSON NOT NULL,
    `operator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VehicleCredentialRecord_vehicleId_credentialType_idx`(`vehicleId`, `credentialType`),
    INDEX `VehicleCredentialRecord_vehicleId_status_idx`(`vehicleId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VehicleOnboardItem` (
    `id` VARCHAR(191) NOT NULL,
    `vehicleId` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `standardQuantity` INTEGER NOT NULL DEFAULT 1,
    `actualQuantity` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'normal',
    `priceAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `operator` VARCHAR(191) NULL,
    `remark` VARCHAR(191) NULL,

    INDEX `VehicleOnboardItem_vehicleId_category_idx`(`vehicleId`, `category`),
    INDEX `VehicleOnboardItem_vehicleId_status_idx`(`vehicleId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TboxDevice` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `cid` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `modelNo` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `onlineStatus` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    `boundVehicleId` VARCHAR(191) NULL,
    `batteryLevel` INTEGER NULL,
    `signalStrength` INTEGER NULL,
    `lastHeartbeatAt` DATETIME(3) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TboxDevice_boundVehicleId_key`(`boundVehicleId`),
    INDEX `TboxDevice_tenantId_status_onlineStatus_idx`(`tenantId`, `status`, `onlineStatus`),
    UNIQUE INDEX `TboxDevice_tenantId_cid_key`(`tenantId`, `cid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TboxCommandRecord` (
    `id` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `command` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `vehiclePlateNo` VARCHAR(191) NULL,
    `operator` VARCHAR(191) NULL,
    `requestPayload` JSON NULL,
    `responsePayload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TboxCommandRecord_deviceId_createdAt_idx`(`deviceId`, `createdAt`),
    INDEX `TboxCommandRecord_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StationCalendarDay` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `businessStatus` VARCHAR(191) NOT NULL DEFAULT 'open',
    `openTime` VARCHAR(191) NOT NULL DEFAULT '09:00',
    `closeTime` VARCHAR(191) NOT NULL DEFAULT '20:00',
    `capacityLimit` INTEGER NULL,
    `note` VARCHAR(191) NULL,
    `operator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StationCalendarDay_stationId_businessStatus_idx`(`stationId`, `businessStatus`),
    UNIQUE INDEX `StationCalendarDay_stationId_date_key`(`stationId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StationCapacitySnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `stationId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `totalSpaces` INTEGER NOT NULL DEFAULT 0,
    `availableSpaces` INTEGER NOT NULL DEFAULT 0,
    `reservedSpaces` INTEGER NOT NULL DEFAULT 0,
    `occupiedVehicles` INTEGER NOT NULL DEFAULT 0,
    `pendingPickupVehicles` INTEGER NOT NULL DEFAULT 0,
    `pendingReturnVehicles` INTEGER NOT NULL DEFAULT 0,
    `operator` VARCHAR(191) NULL,
    `source` VARCHAR(191) NOT NULL DEFAULT 'system',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StationCapacitySnapshot_stationId_date_idx`(`stationId`, `date`),
    INDEX `StationCapacitySnapshot_stationId_createdAt_idx`(`stationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `VehicleTransferTask` ADD CONSTRAINT `VehicleTransferTask_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleCredentialRecord` ADD CONSTRAINT `VehicleCredentialRecord_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `VehicleOnboardItem` ADD CONSTRAINT `VehicleOnboardItem_vehicleId_fkey` FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TboxDevice` ADD CONSTRAINT `TboxDevice_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TboxDevice` ADD CONSTRAINT `TboxDevice_boundVehicleId_fkey` FOREIGN KEY (`boundVehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TboxCommandRecord` ADD CONSTRAINT `TboxCommandRecord_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `TboxDevice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StationCalendarDay` ADD CONSTRAINT `StationCalendarDay_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `StoreStation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StationCapacitySnapshot` ADD CONSTRAINT `StationCapacitySnapshot_stationId_fkey` FOREIGN KEY (`stationId`) REFERENCES `StoreStation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
