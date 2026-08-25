ALTER TABLE `rental_reservations`
    ADD COLUMN `releasedQuantity` INTEGER NOT NULL DEFAULT 0;

ALTER TABLE `rental_allocations`
    ADD COLUMN `itemGroupId` VARCHAR(191) NULL;

-- 序列化分配可由资产主档准确回填实际商品。
UPDATE `rental_allocations` allocation
JOIN `rental_assets` asset ON asset.`id` = allocation.`assetId`
SET allocation.`itemGroupId` = asset.`itemGroupId`
WHERE allocation.`itemGroupId` IS NULL;

-- 非套装订单行的数量分配可由订单行准确回填。历史套装数量分配无法无歧义
-- 判断对应哪个组成项，保留 NULL；新代码写入后全部带实际组成商品。
UPDATE `rental_allocations` allocation
JOIN `rental_order_lines` line ON line.`id` = allocation.`orderLineId`
SET allocation.`itemGroupId` = line.`itemGroupId`
WHERE allocation.`itemGroupId` IS NULL
  AND line.`inventoryMode` <> 'BUNDLE';

CREATE INDEX `rental_allocations_itemGroupId_status_idx`
    ON `rental_allocations`(`itemGroupId`, `status`);

ALTER TABLE `rental_allocations`
    ADD CONSTRAINT `rental_allocations_itemGroupId_fkey`
    FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
