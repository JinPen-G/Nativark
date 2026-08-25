-- PRICE-01：报价的履约费用合计
--
-- 需求 4.4 的应付公式里「履约费用」是与增值服务并列的独立一项，此前既无字段
-- 也无计算，配送与异地归还一分钱不收，只能靠手工配一个 delivery 增值服务顶替。
--
-- 带 DEFAULT 0 新增，因此存量报价无需回填也不会失效：它们的履约费本来就是 0
-- （当时不收），这不是"用默认值掩盖未知真值"，而是与历史事实一致。
ALTER TABLE `rental_quotes` ADD COLUMN `fulfillmentAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;

-- 履约费配置本身也要落库，否则重启后报价不可复算。
-- 与 `rates` 同为「版本化 JSON 明细」，随价格计划版本一起发布与快照。
-- 可空：既有计划没有该配置，等价于不收履约费。
ALTER TABLE `rental_pricing_plans` ADD COLUMN `fulfillmentFees` JSON NULL;

-- 报价保存实际命中的费率快照。
--
-- 只存 pricingPlanVersion 不足以复算：编辑价格计划会覆盖同一行并递增版本号，
-- 旧版本的费率内容随之消失，历史报价指向一个已不存在的版本。
-- 可空：存量报价当时确实没有保存费率，留 NULL 是如实记录，不是用默认值掩盖未知。
ALTER TABLE `rental_quotes` ADD COLUMN `rateSnapshot` JSON NULL;
