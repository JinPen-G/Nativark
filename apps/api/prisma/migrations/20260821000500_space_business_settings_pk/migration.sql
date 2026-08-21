-- SPACE-03：业务设置主键改为经营空间
--
-- 原主键是 tenantId，于是同租户两个空间抢同一行：第二个空间保存业务设置会
-- 直接覆盖第一个空间的支付、押金、逾期、履约、取消规则。业务设置属于经营空间。
--
-- workspaceId 列与其回填已在第 29 条迁移完成且为 NOT NULL，此处只换主键，
-- 因此不需要再回填或对账。
--
-- 先补 tenantId 的独立索引：tenantId 上有指向 Tenant 的外键，
-- 而它原先是靠主键提供索引的；先删主键会让该外键失去可用索引。

-- CreateIndex
CREATE INDEX `rental_business_settings_tenant_idx` ON `rental_tenant_business_settings`(`tenantId`);

-- AlterTable
ALTER TABLE `rental_tenant_business_settings` DROP PRIMARY KEY, ADD PRIMARY KEY (`workspaceId`);
