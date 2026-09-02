-- PRICE-GROUP-01：产品型号与商业定价分组拆分。
CREATE TABLE `rental_pricing_groups` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `categoryCode` ENUM('CAMERA','CAMPING','VEHICLE','CONSTRUCTION') NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` VARCHAR(191) NULL,
  `defaultPricingUnit` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `rental_pricing_groups_ws_code_key`(`workspaceId`, `code`),
  UNIQUE INDEX `rental_pricing_groups_scope_id_key`(`tenantId`, `workspaceId`, `id`),
  INDEX `rental_pricing_groups_scope_status_idx`(`tenantId`, `categoryCode`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_pricing_group_members` (
  `id` VARCHAR(191) NOT NULL,
  `pricingGroupId` VARCHAR(191) NOT NULL,
  `itemGroupId` VARCHAR(191) NOT NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `rental_pricing_group_members_pair_key`(`pricingGroupId`, `itemGroupId`),
  INDEX `rental_pricing_group_members_item_idx`(`itemGroupId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rental_order_lines`
  ADD COLUMN `pricingGroupId` VARCHAR(191) NULL,
  ADD COLUMN `pricingGroupCode` VARCHAR(191) NULL,
  ADD COLUMN `pricingGroupName` VARCHAR(191) NULL,
  ADD COLUMN `pricingGroupMemberItemGroupIds` JSON NULL,
  ADD INDEX `rental_order_lines_pricingGroupId_idx`(`pricingGroupId`);

ALTER TABLE `rental_discount_plans`
  ADD COLUMN `applicablePricingGroupIds` JSON NOT NULL DEFAULT (JSON_ARRAY());

ALTER TABLE `rental_pricing_groups`
  ADD CONSTRAINT `rental_pricing_groups_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_pricing_groups_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_pricing_groups_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `rental_pricing_group_members`
  ADD CONSTRAINT `rental_pricing_group_members_pricingGroupId_fkey` FOREIGN KEY (`pricingGroupId`) REFERENCES `rental_pricing_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_pricing_group_members_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `rental_order_lines`
  ADD CONSTRAINT `rental_order_lines_pricingGroupId_fkey` FOREIGN KEY (`pricingGroupId`) REFERENCES `rental_pricing_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 存量每个产品型号生成一个同 id 的一成员分组。这样旧价格 JSON 的 itemGroupId
-- 可直接作为兼容定价分组 id，不需要重写不可变历史快照。
INSERT INTO `rental_pricing_groups`
  (`id`, `tenantId`, `workspaceId`, `categoryCode`, `code`, `name`, `description`, `status`, `version`, `createdAt`, `updatedAt`)
SELECT
  `id`, `tenantId`, `workspaceId`, `categoryCode`, `code`, `name`, `description`, `status`, 1, `createdAt`, `updatedAt`
FROM `rental_item_groups`;

INSERT INTO `rental_pricing_group_members`
  (`id`, `pricingGroupId`, `itemGroupId`, `sortOrder`, `createdAt`)
SELECT UUID(), `id`, `id`, 0, `createdAt`
FROM `rental_item_groups`;

-- 修正存量租户档案里把“车型组”误当产品型号的旧术语。
UPDATE `tenant_rental_profiles`
SET `terminology` = JSON_SET(
  `terminology`,
  '$.itemGroupLabel', '车辆型号',
  '$.navigationLabels.inventoryGroup', '车辆型号与车队',
  '$.navigationLabels.itemGroups', '车辆型号管理',
  '$.navigationLabels.pricingGroups', '车组管理'
)
WHERE `categoryCode` = 'VEHICLE';

UPDATE `tenant_rental_profiles`
SET `terminology` = JSON_SET(
  `terminology`,
  '$.itemGroupLabel', '装备型号',
  '$.navigationLabels.itemGroups', '装备型号',
  '$.navigationLabels.pricingGroups', '装备定价分组'
)
WHERE `categoryCode` = 'CAMPING';
