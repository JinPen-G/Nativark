-- 纠正存量「押金/预授权混在 depositAmount」被错误计入本次实收的问题。
--
-- 背景：`20260826000200_add_quote_receivable_amount` 无条件执行
--   receivableAmount = payableAmount + depositAmount
-- 而紧随其后的 `20260826000200_split_deposit_and_preauth` 自己写明：存量 depositAmount
-- 里可能装的是**预授权额度**（旧实现二者共用一个字段）。两条迁移叠加的结果是：
-- 旧库里的预授权报价升级后被解释成「已经收取的押金」，历史资金口径出错。
--
-- 本迁移不修改已执行过的迁移（那会破坏校验和），而是按证据重新分类：
--   1) 规则快照明确是预授权口径（payment.depositMode = 'preauthorization'）
--      → 金额搬到 preAuthAmount，depositAmount 归 0，receivableAmount 回落为 payableAmount
--        （预授权是冻结，不是实收）。
--   2) 规则快照明确是押金口径（none / fixed / price_multiple）
--      → 原值本就正确，不动。
--   3) 无法可靠判定（快照缺少 payment.depositMode 或取值不在已知集合）
--      → 置 legacyDepositUnverified = true，并把该笔从 receivableAmount 中剔除。
--        不擅自算进实收：金额归属未确认时，少算比多算安全，且标记可供财务逐笔确认。
--
-- 安全性：只 ADD COLUMN + UPDATE，无 DROP/TRUNCATE/DELETE。
-- 只处理 preAuthAmount = 0 且 depositAmount > 0 的行——新口径记录（预授权已单列）不受影响。

ALTER TABLE `rental_quotes`
  ADD COLUMN `legacyDepositUnverified` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `rental_orders`
  ADD COLUMN `legacyDepositUnverified` BOOLEAN NOT NULL DEFAULT false;

-- (1) 明确是预授权口径的存量报价：搬到 preAuthAmount 并把实收改回不含它。
UPDATE `rental_quotes`
SET `preAuthAmount` = `depositAmount`,
    `receivableAmount` = `payableAmount`,
    `depositAmount` = 0.00
WHERE `preAuthAmount` = 0
  AND `depositAmount` > 0
  AND JSON_UNQUOTE(JSON_EXTRACT(`ruleSnapshot`, '$.payment.depositMode')) = 'preauthorization';

-- (3) 无法判定归属的存量报价：标记待确认，并从实收里剔除该笔。
UPDATE `rental_quotes`
SET `legacyDepositUnverified` = true,
    `receivableAmount` = `payableAmount`
WHERE `preAuthAmount` = 0
  AND `depositAmount` > 0
  AND (
    JSON_EXTRACT(`ruleSnapshot`, '$.payment.depositMode') IS NULL
    OR JSON_UNQUOTE(JSON_EXTRACT(`ruleSnapshot`, '$.payment.depositMode'))
       NOT IN ('none', 'fixed', 'price_multiple', 'preauthorization')
  );

-- 订单侧同样重新分类。订单没有 receivableAmount（它由 payableAmount + depositAmount 派生，
-- 刻意不落库），因此只搬金额与置标记。
UPDATE `rental_orders`
SET `preAuthAmount` = `depositAmount`,
    `depositAmount` = 0.00
WHERE `preAuthAmount` = 0
  AND `depositAmount` > 0
  AND JSON_UNQUOTE(JSON_EXTRACT(`ruleSnapshot`, '$.payment.depositMode')) = 'preauthorization';

UPDATE `rental_orders`
SET `legacyDepositUnverified` = true
WHERE `preAuthAmount` = 0
  AND `depositAmount` > 0
  AND (
    JSON_EXTRACT(`ruleSnapshot`, '$.payment.depositMode') IS NULL
    OR JSON_UNQUOTE(JSON_EXTRACT(`ruleSnapshot`, '$.payment.depositMode'))
       NOT IN ('none', 'fixed', 'price_multiple', 'preauthorization')
  );
