-- F08：把领取时段、券使用时段与适用租期分开保存。
-- 旧模板的领取窗沿用原有效期；旧券的适用租期规则从当前模板一次性回填。
ALTER TABLE `rental_coupon_templates`
  ADD COLUMN `claimFrom` DATETIME(3) NULL,
  ADD COLUMN `claimTo` DATETIME(3) NULL,
  ADD COLUMN `applicableRentalFrom` DATETIME(3) NULL,
  ADD COLUMN `applicableRentalTo` DATETIME(3) NULL;

ALTER TABLE `rental_customer_coupons`
  ADD COLUMN `applicableRentalFrom` DATETIME(3) NULL,
  ADD COLUMN `applicableRentalTo` DATETIME(3) NULL;

UPDATE `rental_coupon_templates`
SET `claimFrom` = `effectiveFrom`,
    `claimTo` = `effectiveTo`;

UPDATE `rental_customer_coupons` AS c
JOIN `rental_coupon_templates` AS t ON t.`id` = c.`templateId`
SET c.`applicableRentalFrom` = t.`applicableRentalFrom`,
    c.`applicableRentalTo` = t.`applicableRentalTo`;

ALTER TABLE `rental_coupon_templates`
  MODIFY COLUMN `claimFrom` DATETIME(3) NOT NULL,
  MODIFY COLUMN `claimTo` DATETIME(3) NOT NULL;
