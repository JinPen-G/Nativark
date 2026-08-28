-- CORE-EXT-02D（Review P1-5 / P1-6 / P1-10）：报价与订单固化 capability 的**判断记录**与**例外快照**。
--
-- 为什么 capabilitySnapshot 不够：那份快照只回答「当时启用了哪些能力、什么版本」，
-- 回答不了「当时判成了什么、依据是什么、谁批准了带风险继续」。缺了后者：
--   1. 报价发现的风险（如需转接环）无法返回给用户，也无法在下单时被引用，
--      运营只能看到一个 201，不知道要确认什么；
--   2. 例外确认被压缩成一个风险代码集合，原因、确认人、权限与时间全部丢失，
--      配货及后续履约无从还原「这单的风险已经有人裁决过」。
--
-- 因此本迁移各加两列：
--   * `capabilityDecisions`：不可变判断记录数组。每条含能力、实现版本、配置版本、
--     规则集版本、触发点、判定、风险代码、提示、证据、费用依据与当时器材组合，
--     并带一个 `id` 供下单引用（下单不得凭空重构判断）。
--   * `capabilityExceptions`（仅订单）：不可变例外快照数组。每条含能力、风险代码、
--     确认原因、确认人及其权限、确认时间、被确认的判断记录 id、实现/配置/规则集版本
--     与当时器材组合。审计里不能只剩 confirmed: true。
--
-- 为什么可空且不回填：存量报价与订单没有这些事实，编一个是猜测。
-- NULL 的语义由 Review P1-10 明确为 **legacy empty**：不执行下单后新增的 capability，
-- 且响应里标记为历史兼容订单——绝不静默回退到「当前已启用的能力」，
-- 否则订单创建后新启用的能力会反向影响旧订单。
--
-- 安全性：只 AddColumn，全部可空、无默认值变更，不触碰既有数据，无 DROP/TRUNCATE/DELETE。

ALTER TABLE `rental_quotes`  ADD COLUMN `capabilityDecisions` JSON NULL;
ALTER TABLE `rental_orders`  ADD COLUMN `capabilityDecisions` JSON NULL;
ALTER TABLE `rental_orders`  ADD COLUMN `capabilityExceptions` JSON NULL;
