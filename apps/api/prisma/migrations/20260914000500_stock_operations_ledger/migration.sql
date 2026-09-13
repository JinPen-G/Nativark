CREATE TABLE `rental_stock_ledger_entries` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `operationId` VARCHAR(191) NOT NULL,
  `entryKind` VARCHAR(8) NOT NULL,
  `operationType` VARCHAR(24) NOT NULL,
  `itemGroupId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `quantityDelta` INTEGER NOT NULL,
  `onHandBefore` INTEGER NOT NULL,
  `onHandAfter` INTEGER NOT NULL,
  `reservedQuantity` INTEGER NOT NULL,
  `maintenanceQuantity` INTEGER NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `operator` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `rental_stock_ledger_idem_entry_key` (`workspaceId`, `idempotencyKey`, `entryKind`),
  INDEX `rental_stock_ledger_scope_created_idx` (`tenantId`, `workspaceId`, `itemGroupId`, `locationId`, `createdAt`),
  INDEX `rental_stock_ledger_operation_idx` (`workspaceId`, `operationId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `rental_stock_ledger_entries_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_stock_ledger_entries_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_stock_ledger_entries_itemGroupId_fkey`
    FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `rental_stock_ledger_entries_locationId_fkey`
    FOREIGN KEY (`locationId`) REFERENCES `rental_fulfillment_locations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
