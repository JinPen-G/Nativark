-- 修复 20260902000100 在已应用开发库中使用了 Prisma 枚举名而非数据库映射值。
-- 先转成文本，避免 MySQL 在直接替换 ENUM 取值域时把现有值变为空值。
ALTER TABLE `rental_pricing_groups`
  DROP FOREIGN KEY `rental_pricing_groups_categoryCode_fkey`;

ALTER TABLE `rental_pricing_groups`
  MODIFY `categoryCode` VARCHAR(32) NOT NULL;

UPDATE `rental_pricing_groups`
SET `categoryCode` = LOWER(`categoryCode`);

ALTER TABLE `rental_pricing_groups`
  MODIFY `categoryCode` ENUM('camera','camping','vehicle','construction') NOT NULL;

ALTER TABLE `rental_pricing_groups`
  ADD CONSTRAINT `rental_pricing_groups_categoryCode_fkey`
  FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
