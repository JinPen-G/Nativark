-- 结算币种快照（需求 §948：一个订单只能属于一个结算币种）。
-- 事实来源是经营空间的业务设置（rental_tenant_business_settings 的主键就是 workspaceId，
-- 因此同一租户下香港店与深圳店天然各存一份）；报价与订单各存一份快照，
-- 之后空间改币种不影响已经出过的报价与订单。
-- 默认 CNY 与存量数据的既有含义一致——此前全库只有人民币一种口径。
ALTER TABLE `rental_quotes`
  ADD COLUMN `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY';

ALTER TABLE `rental_orders`
  ADD COLUMN `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY';
