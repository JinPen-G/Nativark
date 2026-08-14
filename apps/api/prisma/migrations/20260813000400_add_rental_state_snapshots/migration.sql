CREATE TABLE `rental_core_state_snapshots` (
  `tenantId` VARCHAR(191) NOT NULL,
  `state` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`),
  CONSTRAINT `rental_core_state_snapshots_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_business_state_snapshots` (
  `tenantId` VARCHAR(191) NOT NULL,
  `state` JSON NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`),
  CONSTRAINT `rental_business_state_snapshots_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
