-- 企业资料由管理端直接编辑，必须用单调递增版本阻止并发静默覆盖。
-- 不用 updatedAt 作为并发令牌：DATETIME(3) 在同一毫秒内的两次写入可能相同。
ALTER TABLE `customer_corporate_invoice_profiles`
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `customer_corporate_contracts`
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1;

ALTER TABLE `customer_corporate_credits`
    ADD COLUMN `revision` INTEGER NOT NULL DEFAULT 1;
