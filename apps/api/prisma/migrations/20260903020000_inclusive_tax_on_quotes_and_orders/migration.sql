-- 价内税：报价与订单各记税率与反算出的税额。
-- 价内税是对含税金额的拆分而不是追加，因此不新增费用明细类型，也不改动任何既有金额列；
-- 押金不计税（押金是代收保证金，不是收入）。
-- 默认 0 保证存量数据的复算结果与新增列之前完全一致。
ALTER TABLE `rental_quotes`
  ADD COLUMN `taxRate` DECIMAL(6, 4) NOT NULL DEFAULT 0,
  ADD COLUMN `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE `rental_orders`
  ADD COLUMN `taxRate` DECIMAL(6, 4) NOT NULL DEFAULT 0,
  ADD COLUMN `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0;
