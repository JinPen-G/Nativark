-- MKT-02A Review + MKT-02B：订单服务快照、不可变服务版本、容量窗口与预留流水。
-- 仅新增列、索引和表；不删除或覆盖既有业务事实。

ALTER TABLE `rental_value_added_services`
  ADD COLUMN `requiresCapacity` BOOLEAN NOT NULL DEFAULT false,
  ADD UNIQUE INDEX `rental_value_added_services_scope_id_key`(`tenantId`, `workspaceId`, `id`);

ALTER TABLE `rental_fulfillment_locations`
  ADD UNIQUE INDEX `rental_locations_scope_id_key`(`tenantId`, `workspaceId`, `id`);

ALTER TABLE `rental_orders`
  ADD COLUMN `serviceSnapshots` JSON NULL,
  ADD UNIQUE INDEX `rental_orders_scope_id_key`(`tenantId`, `workspaceId`, `id`);

CREATE TABLE `rental_value_added_service_versions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `serviceId` VARCHAR(191) NOT NULL,
    `serviceVersion` VARCHAR(191) NOT NULL,
    `termsVersion` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rental_value_added_service_versions_service_version_key`(`serviceId`, `serviceVersion`),
    INDEX `rental_value_added_service_versions_scope_idx`(`tenantId`, `workspaceId`, `serviceId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `rental_value_added_service_versions`
  (`id`, `tenantId`, `workspaceId`, `serviceId`, `serviceVersion`, `termsVersion`, `snapshot`, `createdAt`)
SELECT
  UUID(), s.`tenantId`, s.`workspaceId`, s.`id`, s.`version`, s.`termsVersion`,
  JSON_OBJECT(
    'id', s.`id`, 'tenantId', s.`tenantId`, 'workspaceId', s.`workspaceId`,
    'categoryCode', LOWER(s.`categoryCode`), 'code', s.`code`, 'name', s.`name`,
    'serviceType', s.`serviceType`, 'billingUnit', s.`billingUnit`, 'price', CAST(s.`price` AS DOUBLE),
    'minimumQuantity', s.`minimumQuantity`, 'maximumQuantity', s.`maximumQuantity`,
    'coverageLimit', s.`coverageLimit`, 'deductible', s.`deductible`,
    'termsVersion', s.`termsVersion`, 'terms', s.`terms`,
    'applicableItemGroupIds', COALESCE(s.`applicableItemGroupIds`, JSON_ARRAY()),
    'applicableFulfillmentModes', COALESCE(s.`applicableFulfillmentModes`, JSON_ARRAY()),
    'applicableLocationIds', COALESCE(s.`applicableLocationIds`, JSON_ARRAY()),
    'customerScope', s.`customerScope`, 'selectionMode', s.`selectionMode`,
    'mandatoryRule', s.`mandatoryRule`, 'insuranceProviderStatus', s.`insuranceProviderStatus`,
    'insuranceProviderName', s.`insuranceProviderName`, 'requiresCapacity', false,
    'status', s.`status`, 'version', s.`version`
  ),
  s.`createdAt`
FROM `rental_value_added_services` s;

ALTER TABLE `rental_value_added_service_versions`
  ADD CONSTRAINT `rental_value_added_service_versions_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_value_added_service_versions_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_value_added_service_versions_tenantId_workspaceId_se_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`, `serviceId`) REFERENCES `rental_value_added_services`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `rental_service_capacities` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `serviceId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `windowStart` DATETIME(3) NOT NULL,
    `windowEnd` DATETIME(3) NOT NULL,
    `totalCapacity` INT NOT NULL,
    `reservedQuantity` INT NOT NULL DEFAULT 0,
    `usedQuantity` INT NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rental_service_capacities_window_key`(`workspaceId`, `serviceId`, `locationId`, `windowStart`, `windowEnd`),
    UNIQUE INDEX `rental_service_capacities_scope_id_key`(`tenantId`, `workspaceId`, `id`),
    INDEX `rental_service_capacities_scope_idx`(`tenantId`, `workspaceId`, `serviceId`, `windowStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_service_reservations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `capacityId` VARCHAR(191) NOT NULL,
    `serviceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `quantity` INT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'reserved',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `reservedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `usedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `releaseReason` VARCHAR(191) NULL,

    UNIQUE INDEX `rental_service_reservations_idempotency_key`(`tenantId`, `idempotencyKey`),
    INDEX `rental_service_reservations_order_idx`(`tenantId`, `orderId`, `status`),
    INDEX `rental_service_reservations_capacity_idx`(`capacityId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rental_service_capacities`
  ADD CONSTRAINT `rental_service_capacities_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_service_capacities_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_service_capacities_tenantId_workspaceId_serviceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`, `serviceId`) REFERENCES `rental_value_added_services`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_service_capacities_tenantId_workspaceId_locationId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`, `locationId`) REFERENCES `rental_fulfillment_locations`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `rental_service_reservations`
  ADD CONSTRAINT `rental_service_reservations_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_service_reservations_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_service_reservations_tenantId_workspaceId_capacityId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`, `capacityId`) REFERENCES `rental_service_capacities`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_service_reservations_tenantId_workspaceId_serviceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`, `serviceId`) REFERENCES `rental_value_added_services`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_service_reservations_tenantId_workspaceId_orderId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
