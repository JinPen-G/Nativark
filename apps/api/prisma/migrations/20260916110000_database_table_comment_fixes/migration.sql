-- 修正两张表的表级备注：
-- - User 同时存放租户运营账号与 SaaS 平台管理员（isSaasAdmin），
--   原备注「租户运营账户」漏掉了平台侧账号；
-- - rental_fulfillment_operators 存的是自营/合作方经营主体，
--   不是「操作员」（人），与 operatorType/operatorName 的列备注同源。
-- 仅改 TABLE_COMMENT，不改任何列定义、索引与数据。

ALTER TABLE `User` COMMENT = '运营账号（租户运营账号与 SaaS 平台管理员）';
ALTER TABLE `rental_fulfillment_operators` COMMENT = '履约运营方（self_operated 自营 / partner 合作方）';
