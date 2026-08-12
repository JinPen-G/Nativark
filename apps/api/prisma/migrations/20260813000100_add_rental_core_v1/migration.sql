-- Rental Core v0.1 is additive. Existing store-rental tables remain unchanged.

CREATE TABLE `rental_category_definitions` (
  `code` ENUM('vehicle','camera','camping','construction') NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` VARCHAR(191) NOT NULL,
  `supportedInventoryModes` JSON NOT NULL,
  `defaultCapabilities` JSON NOT NULL,
  `terminology` JSON NOT NULL,
  `attributeSchema` JSON NOT NULL,
  `version` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `tenant_rental_profiles` (
  `tenantId` VARCHAR(191) NOT NULL,
  `categoryCode` ENUM('vehicle','camera','camping','construction') NOT NULL,
  `capabilities` JSON NOT NULL,
  `terminology` JSON NOT NULL,
  `configVersion` VARCHAR(191) NOT NULL,
  `initializedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`),
  INDEX `tenant_rental_profiles_categoryCode_idx` (`categoryCode`),
  CONSTRAINT `tenant_rental_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `tenant_rental_profiles_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_fulfillment_locations` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `capabilities` JSON NOT NULL,
  `address` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_fulfillment_locations_tenantId_code_key` (`tenantId`, `code`),
  INDEX `rental_fulfillment_locations_tenantId_status_idx` (`tenantId`, `status`),
  CONSTRAINT `rental_fulfillment_locations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_item_groups` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `categoryCode` ENUM('vehicle','camera','camping','construction') NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `inventoryMode` ENUM('serialized','quantity','bundle') NOT NULL,
  `unit` VARCHAR(191) NOT NULL DEFAULT '件',
  `description` VARCHAR(191) NULL,
  `attributes` JSON NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_item_groups_tenantId_code_key` (`tenantId`, `code`),
  INDEX `rental_item_groups_tenantId_categoryCode_inventoryMode_status_idx` (`tenantId`, `categoryCode`, `inventoryMode`, `status`),
  CONSTRAINT `rental_item_groups_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_item_groups_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_bundle_components` (
  `id` VARCHAR(191) NOT NULL,
  `bundleItemGroupId` VARCHAR(191) NOT NULL,
  `componentItemGroupId` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `optional` BOOLEAN NOT NULL DEFAULT false,
  `substitutionGroup` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_bundle_components_bundleItemGroupId_componentItemGroupId_key` (`bundleItemGroupId`, `componentItemGroupId`),
  INDEX `rental_bundle_components_componentItemGroupId_idx` (`componentItemGroupId`),
  CONSTRAINT `rental_bundle_components_bundleItemGroupId_fkey` FOREIGN KEY (`bundleItemGroupId`) REFERENCES `rental_item_groups` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_bundle_components_componentItemGroupId_fkey` FOREIGN KEY (`componentItemGroupId`) REFERENCES `rental_item_groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_assets` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `itemGroupId` VARCHAR(191) NOT NULL,
  `assetNo` VARCHAR(191) NOT NULL,
  `serialNo` VARCHAR(191) NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `status` ENUM('available','reserved','rented','inspection','maintenance','disabled') NOT NULL DEFAULT 'available',
  `attributes` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_assets_tenantId_assetNo_key` (`tenantId`, `assetNo`),
  UNIQUE INDEX `rental_assets_tenantId_serialNo_key` (`tenantId`, `serialNo`),
  INDEX `rental_assets_tenantId_itemGroupId_locationId_status_idx` (`tenantId`, `itemGroupId`, `locationId`, `status`),
  CONSTRAINT `rental_assets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_assets_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `rental_assets_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `rental_fulfillment_locations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_stock_balances` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `itemGroupId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `onHandQuantity` INTEGER NOT NULL DEFAULT 0,
  `reservedQuantity` INTEGER NOT NULL DEFAULT 0,
  `maintenanceQuantity` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_stock_balances_tenantId_itemGroupId_locationId_key` (`tenantId`, `itemGroupId`, `locationId`),
  INDEX `rental_stock_balances_tenantId_locationId_idx` (`tenantId`, `locationId`),
  CONSTRAINT `rental_stock_balances_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_stock_balances_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `rental_stock_balances_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `rental_fulfillment_locations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_orders` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `orderNo` VARCHAR(191) NOT NULL,
  `categoryCode` ENUM('vehicle','camera','camping','construction') NOT NULL,
  `status` ENUM('draft','reserved','ready_for_pickup','renting','return_inspection','completed','cancelled') NOT NULL DEFAULT 'reserved',
  `customerType` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NULL,
  `customerName` VARCHAR(191) NOT NULL,
  `contactPhone` VARCHAR(191) NULL,
  `fulfillmentLocationId` VARCHAR(191) NOT NULL,
  `startAt` DATETIME(3) NOT NULL,
  `endAt` DATETIME(3) NOT NULL,
  `totalAmount` DECIMAL(12,2) NOT NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_orders_tenantId_orderNo_key` (`tenantId`, `orderNo`),
  INDEX `rental_orders_tenantId_status_startAt_idx` (`tenantId`, `status`, `startAt`),
  INDEX `rental_orders_tenantId_customerType_customerId_idx` (`tenantId`, `customerType`, `customerId`),
  CONSTRAINT `rental_orders_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_orders_fulfillmentLocationId_fkey` FOREIGN KEY (`fulfillmentLocationId`) REFERENCES `rental_fulfillment_locations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_order_lines` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `itemGroupId` VARCHAR(191) NOT NULL,
  `inventoryMode` ENUM('serialized','quantity','bundle') NOT NULL,
  `quantity` INTEGER NOT NULL,
  `unitPrice` DECIMAL(12,2) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `note` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `rental_order_lines_orderId_itemGroupId_idx` (`orderId`, `itemGroupId`),
  CONSTRAINT `rental_order_lines_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_order_lines_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_reservations` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `orderLineId` VARCHAR(191) NOT NULL,
  `itemGroupId` VARCHAR(191) NOT NULL,
  `locationId` VARCHAR(191) NOT NULL,
  `quantity` INTEGER NOT NULL,
  `startAt` DATETIME(3) NOT NULL,
  `endAt` DATETIME(3) NOT NULL,
  `status` ENUM('soft','confirmed','fulfilled','released','expired','cancelled') NOT NULL DEFAULT 'soft',
  `expiresAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `rental_reservations_tenantId_itemGroupId_locationId_startAt_endAt_status_idx` (`tenantId`, `itemGroupId`, `locationId`, `startAt`, `endAt`, `status`),
  INDEX `rental_reservations_orderId_orderLineId_idx` (`orderId`, `orderLineId`),
  CONSTRAINT `rental_reservations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_reservations_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_reservations_orderLineId_fkey` FOREIGN KEY (`orderLineId`) REFERENCES `rental_order_lines` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_reservations_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `rental_reservations_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `rental_fulfillment_locations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_allocations` (
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `orderLineId` VARCHAR(191) NOT NULL,
  `assetId` VARCHAR(191) NULL,
  `quantity` INTEGER NOT NULL DEFAULT 1,
  `status` VARCHAR(191) NOT NULL DEFAULT 'allocated',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `rental_allocations_orderId_orderLineId_idx` (`orderId`, `orderLineId`),
  INDEX `rental_allocations_assetId_status_idx` (`assetId`, `status`),
  CONSTRAINT `rental_allocations_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_allocations_orderLineId_fkey` FOREIGN KEY (`orderLineId`) REFERENCES `rental_order_lines` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_allocations_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `rental_assets` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_inspection_templates` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `categoryCode` ENUM('vehicle','camera','camping','construction') NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `stage` VARCHAR(191) NOT NULL,
  `version` VARCHAR(191) NOT NULL,
  `fields` JSON NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_inspection_templates_tenantId_code_version_key` (`tenantId`, `code`, `version`),
  INDEX `rental_inspection_templates_tenantId_categoryCode_stage_enabled_idx` (`tenantId`, `categoryCode`, `stage`, `enabled`),
  CONSTRAINT `rental_inspection_templates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_inspection_templates_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_inspection_records` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `stage` VARCHAR(191) NOT NULL,
  `templateId` VARCHAR(191) NOT NULL,
  `templateCode` VARCHAR(191) NOT NULL,
  `templateVersion` VARCHAR(191) NOT NULL,
  `results` JSON NOT NULL,
  `exceptions` JSON NOT NULL,
  `attachments` JSON NOT NULL,
  `operator` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `rental_inspection_records_tenantId_orderId_stage_idx` (`tenantId`, `orderId`, `stage`),
  CONSTRAINT `rental_inspection_records_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_inspection_records_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_inspection_records_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `rental_inspection_templates` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
