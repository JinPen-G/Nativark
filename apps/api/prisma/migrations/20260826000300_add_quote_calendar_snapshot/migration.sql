-- PRICE-02：报价的结构化日历依据
--
-- 需求 4.5.6：「报价快照必须保存**每个**命中营业日期的年度、日期类型、营业状态、
-- 实际价格、来源和年度日历版本；跨年度报价不得只保存一个年份或版本号。」
--
-- 既有的 calendarVersion 是把各年度版本拼成的字符串（如 `2026:1.0|2027:1.1`），
-- 够人读但无法复算：它说不出哪一天是什么类型、按什么系数算了多少钱、
-- 依据来自人工覆盖还是官方日历。
--
-- 可空且不回填：存量报价当时确实没有这份快照，而 calendarVersion 里没有逐日信息，
-- 无法反推。留 NULL 是如实记录"当时没有"，不是用默认值掩盖未知真值。
ALTER TABLE `rental_quotes` ADD COLUMN `calendarSnapshot` JSON NULL;

-- 订单同样留一份：需求 4.5.7「订单始终使用订单快照」，与 ruleSnapshot 同理，
-- 报价被清理或日历改版后订单仍需可复算。
ALTER TABLE `rental_orders` ADD COLUMN `calendarSnapshot` JSON NULL;
