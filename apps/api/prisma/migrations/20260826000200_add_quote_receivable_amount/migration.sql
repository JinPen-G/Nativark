-- PRICE-01：报价的「本次实收」
--
-- 需求 4.4.1：`本次实收 = 租赁应付 + 应付押金`，且「应付押金、预授权金额、已支付、
-- 待支付和可退金额必须作为独立金额字段，不得用同一个字段或明细类型混用」。
--
-- 为什么需要它：押金此前是一条正数明细却不计入 payableAmount，于是
-- `sum(chargeLines)` 不等于任何单一总额，与「总额必须由已舍入明细汇总，保证明细之和
-- 等于对应总额」冲突。补上本字段后对应关系明确：
--   非押金明细之和 = payableAmount、押金明细之和 = depositAmount、
--   两者之和 = receivableAmount。预授权额度不计入其中任何一项。
ALTER TABLE `rental_quotes` ADD COLUMN `receivableAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

-- 存量报价按定义补算而不是留 0：payableAmount 与 depositAmount 当时就已存在，
-- 和值可以从既有事实**推导**出来，不属于"用默认值掩盖未知真值"。
UPDATE `rental_quotes` SET `receivableAmount` = `payableAmount` + `depositAmount`;
