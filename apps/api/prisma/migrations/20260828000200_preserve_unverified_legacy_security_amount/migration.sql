-- 存量保证金额无法从规则快照判定是押金还是预授权时，不能继续留在 depositAmount。
--
-- 20260827000900 已将这类记录标记为 legacyDepositUnverified，并从报价实收中剔除，
-- 但原金额仍留在 depositAmount；任何未识别该布尔标记的下游仍会把它展示为应付押金。
-- 本迁移把原始金额移到独立待确认字段，既不丢数据，也不再污染押金/预授权正式口径。

ALTER TABLE `rental_quotes`
  ADD COLUMN `legacyDepositUnverifiedAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE `rental_orders`
  ADD COLUMN `legacyDepositUnverifiedAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

UPDATE `rental_quotes`
SET `legacyDepositUnverifiedAmount` = `depositAmount`,
    `depositAmount` = 0.00,
    `receivableAmount` = `payableAmount`
WHERE `legacyDepositUnverified` = true
  AND `legacyDepositUnverifiedAmount` = 0
  AND `depositAmount` > 0;

UPDATE `rental_orders`
SET `legacyDepositUnverifiedAmount` = `depositAmount`,
    `depositAmount` = 0.00
WHERE `legacyDepositUnverified` = true
  AND `legacyDepositUnverifiedAmount` = 0
  AND `depositAmount` > 0;
