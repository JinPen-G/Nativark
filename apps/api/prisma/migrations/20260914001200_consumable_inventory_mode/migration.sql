-- CAMP-01B：一次性耗材使用独立库存模式。
-- 耗材仍复用数量库存余额和流水，但领取时消耗，不生成可归还资产或归还处置。
ALTER TABLE `rental_item_groups`
  MODIFY `inventoryMode` ENUM('serialized','quantity','consumable','bundle') NOT NULL;

ALTER TABLE `rental_order_lines`
  MODIFY `inventoryMode` ENUM('serialized','quantity','consumable','bundle') NOT NULL;
