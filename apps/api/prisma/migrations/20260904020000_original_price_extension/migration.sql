-- 只追加可空快照字段，不改写历史报价或续租记录。
ALTER TABLE `rental_quotes` ADD COLUMN `pricingContext` JSON NULL;
ALTER TABLE `rental_order_extensions` ADD COLUMN `pricingSnapshot` JSON NULL;
