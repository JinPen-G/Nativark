-- PRICE-01：押金与预授权额度分开存，订单侧补齐履约费
--
-- 需求 4.4 要求「同时独立计算：应付押金；预授权金额」。此前二者共用
-- `depositAmount` 一个字段，只把明细行改个名字，于是「实收 500 押金」与
-- 「冻结 500 额度」在数据上完全无法区分——对账、退款与风控都读不出真实资金状态。
--
-- 三列都带 DEFAULT 0 新增，存量数据无需回填也不失效：
--   * 存量报价/订单的履约费本来就是 0（当时不收）；
--   * 存量的预授权金额此前记在 depositAmount 里，保持原样不动。
-- 后者意味着**存量数据仍是旧口径**（预授权额度混在押金里），这是如实保留而非
-- 就地改写——把历史金额从一个字段搬到另一个字段属于改写业务事实，需要单独授权。
ALTER TABLE `rental_quotes` ADD COLUMN `preAuthAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE `rental_orders` ADD COLUMN `fulfillmentAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE `rental_orders` ADD COLUMN `preAuthAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0.00;
