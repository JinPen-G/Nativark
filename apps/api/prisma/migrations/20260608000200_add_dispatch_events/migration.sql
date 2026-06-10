-- CreateTable
CREATE TABLE `DispatchEvent` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `eventType` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NULL,
    `planId` VARCHAR(191) NULL,
    `beforeVehicle` VARCHAR(191) NULL,
    `targetVehicle` VARCHAR(191) NULL,
    `reasonCode` VARCHAR(191) NULL,
    `reasonText` VARCHAR(191) NULL,
    `riskLevel` VARCHAR(191) NOT NULL,
    `operator` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DispatchEvent_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `DispatchEvent_tenantId_orderId_createdAt_idx`(`tenantId`, `orderId`, `createdAt`),
    INDEX `DispatchEvent_tenantId_planId_createdAt_idx`(`tenantId`, `planId`, `createdAt`),
    INDEX `DispatchEvent_tenantId_eventType_createdAt_idx`(`tenantId`, `eventType`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DispatchEvent` ADD CONSTRAINT `DispatchEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DispatchEvent` ADD CONSTRAINT `DispatchEvent_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
