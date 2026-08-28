-- CORE-EXT-02D：报价与订单固化「已启用能力的版本快照」。
--
-- 为什么需要它：capability 升级或改配置后，已发出的有效报价与由它下单的在途订单必须
-- 继续按**下单当时**的实现版本与配置校验和履约，不能被升级悄悄改写；停用一个能力也
-- 不得让历史订单读不出「当时为什么这么放行/阻止/收费」。因此在报价与订单上各留一份
-- 不可变快照，在途环节的 Hook 判定用它而不是当前实例。
--
-- 为什么可空且不回填：存量报价与订单生成时没有这份快照，无法反推「当时启用了哪些能力、
-- 版本是多少」，回填一个会是猜测而非事实。NULL 表示「当时没有能力快照」，读取侧退回
-- 按当前已启用实例判定——与升级前的既有行为一致，不是回退。
--
-- 安全性：只 AddColumn，两列均可空、无默认值变更，不触碰既有数据，无 DROP/TRUNCATE。

ALTER TABLE `rental_quotes`  ADD COLUMN `capabilitySnapshot` JSON NULL;
ALTER TABLE `rental_orders`  ADD COLUMN `capabilitySnapshot` JSON NULL;
