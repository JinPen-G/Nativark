ALTER TABLE `VehicleMaintenanceRecord`
  ADD COLUMN `nextDueAt` DATETIME(3) NULL,
  ADD COLUMN `nextDueMileage` INTEGER NULL,
  ADD COLUMN `attachments` JSON NULL;

ALTER TABLE `VehicleTransferTask`
  ALTER COLUMN `status` SET DEFAULT 'pending',
  ADD COLUMN `approvedAt` DATETIME(3) NULL,
  ADD COLUMN `departedAt` DATETIME(3) NULL,
  ADD COLUMN `cancelledAt` DATETIME(3) NULL,
  ADD COLUMN `cancelReason` VARCHAR(191) NULL;

ALTER TABLE `StationCapacitySnapshot`
  ADD COLUMN `capacityLimit` INTEGER NULL,
  ADD COLUMN `controlledVehicles` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `maintenanceVehicles` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `disabledVehicles` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `rentingVehicles` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `businessStatus` VARCHAR(191) NOT NULL DEFAULT 'open',
  ADD COLUMN `closedByCalendar` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `VehicleStatusChangeRecord` (
  `id` VARCHAR(191) NOT NULL,
  `vehicleId` VARCHAR(191) NOT NULL,
  `fromEnabled` BOOLEAN NOT NULL,
  `toEnabled` BOOLEAN NOT NULL,
  `fromOperationStatus` VARCHAR(191) NOT NULL,
  `toOperationStatus` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(191) NULL,
  `operator` VARCHAR(191) NULL,
  `impactedOrderCount` INTEGER NOT NULL DEFAULT 0,
  `impactedOrderNos` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `VehicleStatusChangeRecord_vehicleId_createdAt_idx`(`vehicleId`, `createdAt`),
  INDEX `VehicleStatusChangeRecord_toOperationStatus_createdAt_idx`(`toOperationStatus`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `VehicleAttachmentRecord` (
  `id` VARCHAR(191) NOT NULL,
  `vehicleId` VARCHAR(191) NOT NULL,
  `category` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `url` VARCHAR(512) NOT NULL,
  `source` VARCHAR(191) NOT NULL DEFAULT 'manual',
  `operator` VARCHAR(191) NULL,
  `remark` VARCHAR(512) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `VehicleAttachmentRecord_vehicleId_category_idx`(`vehicleId`, `category`),
  INDEX `VehicleAttachmentRecord_vehicleId_createdAt_idx`(`vehicleId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `VehicleStatusChangeRecord`
  ADD CONSTRAINT `VehicleStatusChangeRecord_vehicleId_fkey`
  FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `VehicleAttachmentRecord`
  ADD CONSTRAINT `VehicleAttachmentRecord_vehicleId_fkey`
  FOREIGN KEY (`vehicleId`) REFERENCES `Vehicle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
