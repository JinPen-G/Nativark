-- SPACE-03（阶段 1）：经营事实归属经营空间
--
-- 严格遵循「先新增兼容结构 → 回填 → 对账 → 再收紧约束」：
--   1. 24 张经营事实/配置表先加**可空** workspaceId（此时不加 NOT NULL，
--      因为存量行还没有值，一步到位会让已有库升级直接失败）
--   2. 从租户的默认经营空间回填（归属只从 tenantId 推导，不猜测）
--   3. 对账：仍有 NULL 即让迁移带可读消息中止
--   4. 收紧为 NOT NULL，替换唯一键为含 workspaceId 的版本，最后加外键
--
-- 外键一律用复合形式 (tenantId, workspaceId) -> business_workspaces(tenantId, id)，
-- 使「事实挂到别的租户的空间上」在库层写不进去（与 workspace_members 同一手法）。
--
-- 唯一键必须含 workspaceId：否则同租户第二个空间无法复用商品编码、订单号、
-- 检查模板编码等业务键。奖励与订单动作的幂等键同理，必须按空间隔离。
--
-- 本阶段只改数据结构与约束，不改查询行为：服务层仍按 tenantId 读写，
-- 因此升级后行为不变。按空间过滤读写属 SPACE-03 后续阶段。

-- 1. 新增可空列
ALTER TABLE `rental_assets` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_benefit_accounts` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_business_calendars` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_coupon_templates` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_customer_coupons` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_discount_plans` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_fulfillment_locations` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_fulfillment_operators` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_inspection_records` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_inspection_templates` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_item_groups` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_notification_logs` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_notification_templates` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_order_idempotency_records` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_orders` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_pricing_plans` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_quotes` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_referrals` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_reservations` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_reward_ledger_entries` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_rule_versions` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_stock_balances` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_tenant_business_settings` ADD COLUMN `workspaceId` VARCHAR(191);
ALTER TABLE `rental_value_added_services` ADD COLUMN `workspaceId` VARCHAR(191);

-- 2. 从租户默认经营空间回填
--    用 JOIN 而不是 CONCAT('ws_', tenantId)：默认空间必须真的存在，
--    否则宁可留 NULL 让下一步对账报错，也不写入一个不存在的空间 id。
UPDATE `rental_assets` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_benefit_accounts` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_business_calendars` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_coupon_templates` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_customer_coupons` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_discount_plans` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_fulfillment_locations` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_fulfillment_operators` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_inspection_records` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_inspection_templates` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_item_groups` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_notification_logs` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_notification_templates` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_order_idempotency_records` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_orders` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_pricing_plans` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_quotes` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_referrals` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_reservations` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_reward_ledger_entries` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_rule_versions` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_stock_balances` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_tenant_business_settings` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;
UPDATE `rental_value_added_services` f INNER JOIN `business_workspaces` w ON w.`tenantId` = f.`tenantId` AND w.`defaultMarker` = 'default' SET f.`workspaceId` = w.`id` WHERE f.`workspaceId` IS NULL;

-- 3. 对账：任何一行没能归属到经营空间，就让本次迁移明确失败
--    手法与 SPACE-01 一致：带 CHECK 约束的临时表，只允许 'ok'。
CREATE TABLE `_space03_reconcile` (
    `finding` VARCHAR(191) NOT NULL,
    CONSTRAINT `space03_backfill_must_be_complete` CHECK (`finding` = 'ok')
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_assets 有未归属经营空间的行: ', COUNT(*)) FROM `rental_assets` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_benefit_accounts 有未归属经营空间的行: ', COUNT(*)) FROM `rental_benefit_accounts` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_business_calendars 有未归属经营空间的行: ', COUNT(*)) FROM `rental_business_calendars` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_coupon_templates 有未归属经营空间的行: ', COUNT(*)) FROM `rental_coupon_templates` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_customer_coupons 有未归属经营空间的行: ', COUNT(*)) FROM `rental_customer_coupons` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_discount_plans 有未归属经营空间的行: ', COUNT(*)) FROM `rental_discount_plans` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_fulfillment_locations 有未归属经营空间的行: ', COUNT(*)) FROM `rental_fulfillment_locations` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_fulfillment_operators 有未归属经营空间的行: ', COUNT(*)) FROM `rental_fulfillment_operators` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_inspection_records 有未归属经营空间的行: ', COUNT(*)) FROM `rental_inspection_records` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_inspection_templates 有未归属经营空间的行: ', COUNT(*)) FROM `rental_inspection_templates` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_item_groups 有未归属经营空间的行: ', COUNT(*)) FROM `rental_item_groups` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_notification_logs 有未归属经营空间的行: ', COUNT(*)) FROM `rental_notification_logs` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_notification_templates 有未归属经营空间的行: ', COUNT(*)) FROM `rental_notification_templates` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_order_idempotency_records 有未归属经营空间的行: ', COUNT(*)) FROM `rental_order_idempotency_records` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_orders 有未归属经营空间的行: ', COUNT(*)) FROM `rental_orders` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_pricing_plans 有未归属经营空间的行: ', COUNT(*)) FROM `rental_pricing_plans` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_quotes 有未归属经营空间的行: ', COUNT(*)) FROM `rental_quotes` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_referrals 有未归属经营空间的行: ', COUNT(*)) FROM `rental_referrals` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_reservations 有未归属经营空间的行: ', COUNT(*)) FROM `rental_reservations` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_reward_ledger_entries 有未归属经营空间的行: ', COUNT(*)) FROM `rental_reward_ledger_entries` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_rule_versions 有未归属经营空间的行: ', COUNT(*)) FROM `rental_rule_versions` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_stock_balances 有未归属经营空间的行: ', COUNT(*)) FROM `rental_stock_balances` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_tenant_business_settings 有未归属经营空间的行: ', COUNT(*)) FROM `rental_tenant_business_settings` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_value_added_services 有未归属经营空间的行: ', COUNT(*)) FROM `rental_value_added_services` WHERE `workspaceId` IS NULL HAVING COUNT(*) > 0;

-- 归属必须落在**本租户**的空间上（回填错位会在这里暴露）
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_assets 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_assets` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_benefit_accounts 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_benefit_accounts` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_business_calendars 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_business_calendars` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_coupon_templates 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_coupon_templates` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_customer_coupons 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_customer_coupons` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_discount_plans 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_discount_plans` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_fulfillment_locations 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_fulfillment_locations` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_fulfillment_operators 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_fulfillment_operators` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_inspection_records 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_inspection_records` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_inspection_templates 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_inspection_templates` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_item_groups 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_item_groups` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_notification_logs 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_notification_logs` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_notification_templates 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_notification_templates` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_order_idempotency_records 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_order_idempotency_records` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_orders 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_orders` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_pricing_plans 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_pricing_plans` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_quotes 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_quotes` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_referrals 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_referrals` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_reservations 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_reservations` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_reward_ledger_entries 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_reward_ledger_entries` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_rule_versions 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_rule_versions` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_stock_balances 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_stock_balances` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_tenant_business_settings 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_tenant_business_settings` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
INSERT INTO `_space03_reconcile` (`finding`) SELECT CONCAT('rental_value_added_services 的 workspaceId 跨租户: ', COUNT(*)) FROM `rental_value_added_services` f LEFT JOIN `business_workspaces` w ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE f.`workspaceId` IS NOT NULL AND w.`id` IS NULL HAVING COUNT(*) > 0;
DROP TABLE `_space03_reconcile`;

-- 4. 收紧为 NOT NULL
ALTER TABLE `rental_assets` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_benefit_accounts` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_business_calendars` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_coupon_templates` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_customer_coupons` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_discount_plans` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_fulfillment_locations` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_fulfillment_operators` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_inspection_records` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_inspection_templates` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_item_groups` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_notification_logs` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_notification_templates` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_order_idempotency_records` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_orders` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_pricing_plans` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_quotes` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_referrals` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_reservations` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_reward_ledger_entries` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_rule_versions` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_stock_balances` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_tenant_business_settings` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;
ALTER TABLE `rental_value_added_services` MODIFY COLUMN `workspaceId` VARCHAR(191) NOT NULL;

-- 5. 唯一键替换为含 workspaceId 的版本
DROP INDEX `rental_assets_tenantId_assetNo_key` ON `rental_assets`;
DROP INDEX `rental_assets_tenantId_serialNo_key` ON `rental_assets`;
DROP INDEX `rental_business_calendars_tenant_year_key` ON `rental_business_calendars`;
DROP INDEX `rental_coupon_templates_tenantId_code_key` ON `rental_coupon_templates`;
DROP INDEX `rental_discount_plans_tenant_code_version_key` ON `rental_discount_plans`;
DROP INDEX `rental_fulfillment_locations_tenantId_code_key` ON `rental_fulfillment_locations`;
DROP INDEX `rental_fulfillment_operators_tenantId_code_key` ON `rental_fulfillment_operators`;
DROP INDEX `rental_inspection_templates_tenantId_code_version_key` ON `rental_inspection_templates`;
DROP INDEX `rental_item_groups_tenantId_code_key` ON `rental_item_groups`;
DROP INDEX `rental_notification_templates_tenant_event_channel_ver_key` ON `rental_notification_templates`;
DROP INDEX `rental_idempotency_tenant_action_key` ON `rental_order_idempotency_records`;
DROP INDEX `rental_orders_tenantId_orderNo_key` ON `rental_orders`;
DROP INDEX `rental_pricing_plans_tenant_code_version_key` ON `rental_pricing_plans`;
DROP INDEX `rental_quotes_tenant_quote_no_key` ON `rental_quotes`;
DROP INDEX `rental_referrals_tenant_invitee_key` ON `rental_referrals`;
DROP INDEX `rental_reward_ledger_tenant_idempotency_key` ON `rental_reward_ledger_entries`;
DROP INDEX `rental_rule_versions_tenant_version_key` ON `rental_rule_versions`;
DROP INDEX `rental_stock_balances_tenantId_itemGroupId_locationId_key` ON `rental_stock_balances`;
DROP INDEX `rental_value_added_services_tenant_code_version_key` ON `rental_value_added_services`;
CREATE UNIQUE INDEX `rental_assets_ws_asset_no_key` ON `rental_assets`(`workspaceId`, `assetNo`);
CREATE UNIQUE INDEX `rental_assets_ws_serial_no_key` ON `rental_assets`(`workspaceId`, `serialNo`);
CREATE UNIQUE INDEX `rental_business_calendars_tenant_year_key` ON `rental_business_calendars`(`workspaceId`, `year`);
CREATE UNIQUE INDEX `rental_coupon_templates_ws_code_key` ON `rental_coupon_templates`(`workspaceId`, `code`);
CREATE UNIQUE INDEX `rental_discount_plans_tenant_code_version_key` ON `rental_discount_plans`(`workspaceId`, `code`, `version`);
CREATE UNIQUE INDEX `rental_locations_ws_code_key` ON `rental_fulfillment_locations`(`workspaceId`, `code`);
CREATE UNIQUE INDEX `rental_operators_ws_code_key` ON `rental_fulfillment_operators`(`workspaceId`, `code`);
CREATE UNIQUE INDEX `rental_inspection_tpl_ws_code_ver_key` ON `rental_inspection_templates`(`workspaceId`, `code`, `version`);
CREATE UNIQUE INDEX `rental_item_groups_ws_code_key` ON `rental_item_groups`(`workspaceId`, `code`);
CREATE UNIQUE INDEX `rental_notification_templates_tenant_event_channel_ver_key` ON `rental_notification_templates`(`workspaceId`, `eventCode`, `channel`, `version`);
CREATE UNIQUE INDEX `rental_idempotency_tenant_action_key` ON `rental_order_idempotency_records`(`workspaceId`, `action`, `idempotencyKey`);
CREATE UNIQUE INDEX `rental_orders_ws_order_no_key` ON `rental_orders`(`workspaceId`, `orderNo`);
CREATE UNIQUE INDEX `rental_pricing_plans_tenant_code_version_key` ON `rental_pricing_plans`(`workspaceId`, `code`, `version`);
CREATE UNIQUE INDEX `rental_quotes_tenant_quote_no_key` ON `rental_quotes`(`workspaceId`, `quoteNo`);
CREATE UNIQUE INDEX `rental_referrals_tenant_invitee_key` ON `rental_referrals`(`workspaceId`, `inviteeCustomerId`);
CREATE UNIQUE INDEX `rental_reward_ledger_tenant_idempotency_key` ON `rental_reward_ledger_entries`(`workspaceId`, `idempotencyKey`);
CREATE UNIQUE INDEX `rental_rule_versions_tenant_version_key` ON `rental_rule_versions`(`workspaceId`, `version`);
CREATE UNIQUE INDEX `rental_stock_ws_group_location_key` ON `rental_stock_balances`(`workspaceId`, `itemGroupId`, `locationId`);
CREATE UNIQUE INDEX `rental_value_added_services_tenant_code_version_key` ON `rental_value_added_services`(`workspaceId`, `code`, `version`);

-- 6. 复合外键：空间与事实必须同租户
ALTER TABLE `rental_coupon_templates` ADD CONSTRAINT `rental_coupon_templates_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_fulfillment_locations` ADD CONSTRAINT `rental_fulfillment_locations_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_item_groups` ADD CONSTRAINT `rental_item_groups_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_assets` ADD CONSTRAINT `rental_assets_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_stock_balances` ADD CONSTRAINT `rental_stock_balances_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_orders` ADD CONSTRAINT `rental_orders_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_reservations` ADD CONSTRAINT `rental_reservations_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_inspection_templates` ADD CONSTRAINT `rental_inspection_templates_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_inspection_records` ADD CONSTRAINT `rental_inspection_records_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_fulfillment_operators` ADD CONSTRAINT `rental_fulfillment_operators_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_tenant_business_settings` ADD CONSTRAINT `rental_tenant_business_settings_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_pricing_plans` ADD CONSTRAINT `rental_pricing_plans_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_discount_plans` ADD CONSTRAINT `rental_discount_plans_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_value_added_services` ADD CONSTRAINT `rental_value_added_services_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_rule_versions` ADD CONSTRAINT `rental_rule_versions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_business_calendars` ADD CONSTRAINT `rental_business_calendars_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_notification_templates` ADD CONSTRAINT `rental_notification_templates_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_quotes` ADD CONSTRAINT `rental_quotes_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_customer_coupons` ADD CONSTRAINT `rental_customer_coupons_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_reward_ledger_entries` ADD CONSTRAINT `rental_reward_ledger_entries_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_benefit_accounts` ADD CONSTRAINT `rental_benefit_accounts_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_referrals` ADD CONSTRAINT `rental_referrals_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_notification_logs` ADD CONSTRAINT `rental_notification_logs_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `rental_order_idempotency_records` ADD CONSTRAINT `rental_order_idempotency_records_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
