-- MKT-01B review：补齐券作用对象、报价计算快照，并把迁移前已发券固化为当前可知权益。
-- 06000 已在专用开发库应用，不修改其校验和；本迁移只做可审计的向前修正。

ALTER TABLE `rental_coupon_templates`
  ADD COLUMN `appliesTo` VARCHAR(191) NOT NULL DEFAULT 'rental',
  ADD COLUMN `stackableWithDiscountPlans` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `rental_customer_coupons`
  ADD COLUMN `appliesTo` VARCHAR(191) NOT NULL DEFAULT 'rental',
  ADD COLUMN `stackableWithDiscountPlans` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `rental_quotes` ADD COLUMN `couponEvaluation` JSON NULL;

-- 旧三态向需求六态迁移；新接口不再接受 enabled/disabled。
UPDATE `rental_coupon_templates`
SET `status` = CASE
  WHEN `status` = 'enabled' THEN 'active'
  WHEN `status` = 'disabled' THEN 'paused'
  ELSE `status`
END;

-- 存量券当时没有权益快照，历史版本无法凭空恢复；上线时只能把迁移时仍可读取的模板
-- 固化为它的基线，并明确标记来源。此后报价绝不再回读模板。
UPDATE `rental_customer_coupons` AS c
JOIN `rental_coupon_templates` AS t ON t.`id` = c.`templateId`
SET c.`templateVersion` = COALESCE(c.`templateVersion`, t.`version`),
    c.`discountType` = COALESCE(c.`discountType`, t.`discountType`),
    c.`discountValue` = COALESCE(c.`discountValue`, t.`discountValue`),
    c.`minimumSpend` = COALESCE(c.`minimumSpend`, t.`minimumSpend`),
    c.`maximumDiscount` = COALESCE(c.`maximumDiscount`, t.`maximumDiscount`),
    c.`applicableItemGroupIds` = COALESCE(c.`applicableItemGroupIds`, t.`applicableItemGroupIds`),
    c.`appliesTo` = t.`appliesTo`,
    c.`stackableWithDiscountPlans` = t.`stackableWithDiscountPlans`,
    c.`grantReason` = COALESCE(c.`grantReason`, 'legacy_snapshot_backfill');

ALTER TABLE `rental_customer_coupons`
  MODIFY `templateVersion` VARCHAR(191) NOT NULL,
  MODIFY `discountType` VARCHAR(191) NOT NULL,
  MODIFY `discountValue` DECIMAL(12, 2) NOT NULL,
  MODIFY `minimumSpend` DECIMAL(12, 2) NOT NULL,
  MODIFY `applicableItemGroupIds` JSON NOT NULL,
  MODIFY `grantReason` VARCHAR(191) NOT NULL;
