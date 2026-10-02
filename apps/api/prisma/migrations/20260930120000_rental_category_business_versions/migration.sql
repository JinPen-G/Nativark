-- 增量保存新业务证据；不得用空间当前绑定伪造旧报价/订单的品类版本。
ALTER TABLE `rental_quotes` ADD COLUMN `categoryVersionId` VARCHAR(191) NULL COMMENT '报价实际采用的不可变品类版本；存量无证据为空';
ALTER TABLE `rental_orders` ADD COLUMN `categoryVersionId` VARCHAR(191) NULL COMMENT '从有效报价继承的品类版本；存量无证据为空';
ALTER TABLE `rental_quotes` ADD CONSTRAINT `rental_quotes_categoryCode_categoryVersionId_fkey` FOREIGN KEY (`categoryCode`, `categoryVersionId`) REFERENCES `rental_category_versions` (`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `rental_orders` ADD CONSTRAINT `rental_orders_categoryCode_categoryVersionId_fkey` FOREIGN KEY (`categoryCode`, `categoryVersionId`) REFERENCES `rental_category_versions` (`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
