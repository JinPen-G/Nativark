CREATE TABLE `rental_asset_status_history` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `assetId` VARCHAR(191) NOT NULL,
  `assetNo` VARCHAR(191) NOT NULL,
  `fromStatus` ENUM('available', 'reserved', 'rented', 'inspection', 'maintenance', 'disabled') NULL,
  `toStatus` ENUM('available', 'reserved', 'rented', 'inspection', 'maintenance', 'disabled') NOT NULL,
  `source` VARCHAR(24) NOT NULL,
  `sourceId` VARCHAR(191) NULL,
  `reason` VARCHAR(500) NOT NULL,
  `operator` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `rental_asset_status_history_scope_idx` (`tenantId`, `workspaceId`, `assetId`, `createdAt`),
  INDEX `rental_asset_status_history_source_idx` (`workspaceId`, `source`, `sourceId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `rental_asset_status_history_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_asset_status_history_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_asset_status_history_assetId_fkey`
    FOREIGN KEY (`assetId`) REFERENCES `rental_assets` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
