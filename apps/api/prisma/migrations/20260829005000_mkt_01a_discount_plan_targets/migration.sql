-- MKT-01A：自动优惠方案补齐作用对象、满额减免门槛、互斥组与方案间叠加开关（需求 4.4.10）。
--
-- 全部为可空或带默认值的新增列，不改动既有数据语义：
--   `appliesTo` 默认 rental——存量方案都是租金优惠，且需求明确普通优惠不得减免
--     押金、预授权与异常费用，因此取值域里根本没有这三项；
--   `stackableWithOtherPlans` 默认 false——早前的实现一次只应用一个方案
--     （`eligible.slice(0, 1)`），默认 false 才能保持存量报价口径不变；
--   `thresholdAmount` 仅 `discountType = 'threshold_amount'` 使用，存量行为空；
--   `exclusiveGroup` 为空表示「自成一组」，只与自己互斥，不会挤掉别的方案。
--
-- 安全性：只 AddColumn，无 DROP/TRUNCATE/DELETE，不回填。

ALTER TABLE `rental_discount_plans` ADD COLUMN `appliesTo` VARCHAR(191) NOT NULL DEFAULT 'rental';
ALTER TABLE `rental_discount_plans` ADD COLUMN `thresholdAmount` DECIMAL(12, 2) NULL;
ALTER TABLE `rental_discount_plans` ADD COLUMN `exclusiveGroup` VARCHAR(191) NULL;
ALTER TABLE `rental_discount_plans` ADD COLUMN `stackableWithOtherPlans` BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX `rental_discount_plans_group_idx` ON `rental_discount_plans`(`workspaceId`, `exclusiveGroup`);

-- 报价固化逐方案评估（需求 4.4.10：已应用与未应用方案、原因、基数、公式、版本、空间范围）。
-- 可空不回填：存量报价没有这份评估，编一份出来等于伪造当时的取舍依据。
ALTER TABLE `rental_quotes` ADD COLUMN `discountEvaluations` JSON NULL;
