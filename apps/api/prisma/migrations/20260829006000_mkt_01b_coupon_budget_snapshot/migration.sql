-- MKT-01B：优惠券模板预算与客户券权益快照（需求 4.4.10）。
--
-- 两组新增列，全部可空或带默认值，不回填、不改动既有语义：
--
-- 一、模板预算与使用限额
--   `totalBudget` 为空表示不限总优惠预算（存量模板都是这个语义）；
--   `lockedBudget` / `redeemedBudget` 分别记录已锁定与已核销的优惠金额，
--   可用预算 = totalBudget - lockedBudget - redeemedBudget（需求明确的公式）；
--   `perCustomerUseLimit` 与既有 `perCustomerLimit` 分开：前者是**每人使用**次数，
--   后者是每人领取次数，需求把两者并列要求，用一个字段表达不了「可领 3 张、只能用 1 张」。
--
-- 二、客户券的权益快照
--   需求要求「客户优惠券在发放时固化权益；模板后续修改、暂停或结束不得改变已发券的
--   面值、适用条件和有效期」。此前客户券只存模板 id、编码与名称，报价计算却回读模板，
--   于是改一次模板面值就改掉了所有存量券的实际减免——本次把权益字段固化到券上。
--   `lockedDiscountAmount` 记录锁定时预占的优惠金额，释放时按它退还预算，
--   避免用「当前重算值」退还导致预算漂移。
--   `templateVersion` 让券能指回发放当时的模板版本。
--   释放、过期与作废各自留原因字段（需求要求可追溯）。
--
-- 安全性：只 AddColumn 与 CreateIndex，无 DROP/TRUNCATE/DELETE。

ALTER TABLE `rental_coupon_templates` ADD COLUMN `totalBudget` DECIMAL(12, 2) NULL;
ALTER TABLE `rental_coupon_templates` ADD COLUMN `lockedBudget` DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE `rental_coupon_templates` ADD COLUMN `redeemedBudget` DECIMAL(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE `rental_coupon_templates` ADD COLUMN `perCustomerUseLimit` INT NOT NULL DEFAULT 1;

ALTER TABLE `rental_customer_coupons` ADD COLUMN `templateVersion` VARCHAR(191) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `discountType` VARCHAR(191) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `discountValue` DECIMAL(12, 2) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `minimumSpend` DECIMAL(12, 2) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `maximumDiscount` DECIMAL(12, 2) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `applicableItemGroupIds` JSON NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `grantReason` VARCHAR(191) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `lockedDiscountAmount` DECIMAL(12, 2) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `releaseReason` VARCHAR(191) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `expiredAt` DATETIME(3) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `voidedAt` DATETIME(3) NULL;
ALTER TABLE `rental_customer_coupons` ADD COLUMN `voidReason` VARCHAR(191) NULL;

-- 并发锁券要按 (券, 状态) 定位，锁定后的预算回收也要按锁定订单反查，两条索引都已存在；
-- 这里补一条按模板统计已锁定/已核销预算用的索引。
CREATE INDEX `rental_customer_coupons_template_status_idx` ON `rental_customer_coupons`(`tenantId`, `templateId`, `status`);
