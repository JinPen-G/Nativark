-- 新会员预约身份的报价/订单不可变快照。历史记录保持 NULL，不回填臆测关系或权益。
ALTER TABLE `rental_quotes` ADD COLUMN `membershipSnapshot` JSON NULL;
ALTER TABLE `rental_orders` ADD COLUMN `membershipSnapshot` JSON NULL;
