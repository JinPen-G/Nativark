-- MKT-02A：增值服务目录补齐适用范围、必选条件、计费单位与保险边界（需求 4.4.11）。
--
-- 全部为可空或带默认值的新增列，不回填、不改动既有语义：
--   `minimumQuantity` 默认 1——存量服务都至少选一份；
--   `applicableFulfillmentModes` / `applicableLocationIds` 默认空数组＝不限制，
--     与既有 `applicableItemGroupIds` 的空数组语义一致；
--   `customerScope` 默认 all；
--   `selectionMode` 默认 optional——存量服务都是客户可选，默认成 mandatory 会让
--     所有既有报价立刻因「漏选强制服务」被拒；
--   `mandatoryRule` 仅 selectionMode = mandatory 使用；
--   `insuranceProviderStatus` / `insuranceProviderName` 仅 serviceType = insurance 使用。
--     取值域只有 simulated / reserved，没有「已投保」——未接入真实服务商前不得
--     向客户展示已投保或虚构保单号，损坏免赔也不得冒充保险（需求 4.4.11）。
--
-- 报价固化服务快照（服务、价格、单位数、资格判据、条款正文与版本）。可空不回填：
-- 存量报价没有这份快照，编一份出来等于伪造当时命中的条款。
--
-- 安全性：只 AddColumn，无 DROP/TRUNCATE/DELETE。

ALTER TABLE `rental_value_added_services` ADD COLUMN `minimumQuantity` INT NOT NULL DEFAULT 1;
ALTER TABLE `rental_value_added_services` ADD COLUMN `applicableFulfillmentModes` JSON NULL;
ALTER TABLE `rental_value_added_services` ADD COLUMN `applicableLocationIds` JSON NULL;
ALTER TABLE `rental_value_added_services` ADD COLUMN `customerScope` VARCHAR(191) NOT NULL DEFAULT 'all';
ALTER TABLE `rental_value_added_services` ADD COLUMN `selectionMode` VARCHAR(191) NOT NULL DEFAULT 'optional';
ALTER TABLE `rental_value_added_services` ADD COLUMN `mandatoryRule` JSON NULL;
ALTER TABLE `rental_value_added_services` ADD COLUMN `insuranceProviderStatus` VARCHAR(191) NULL;
ALTER TABLE `rental_value_added_services` ADD COLUMN `insuranceProviderName` VARCHAR(191) NULL;

CREATE INDEX `rental_value_added_services_selection_idx`
  ON `rental_value_added_services`(`workspaceId`, `status`, `selectionMode`);

ALTER TABLE `rental_quotes` ADD COLUMN `serviceSnapshots` JSON NULL;
