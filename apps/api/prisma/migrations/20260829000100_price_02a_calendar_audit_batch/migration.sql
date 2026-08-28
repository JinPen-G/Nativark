-- PRICE-02A：覆盖审计增加范围批次标识（需求 4.5.9）。
--
-- 一次范围提交（连续日期/日期时间范围的新增、修改或移除）是**一次**经营决策：
-- 需求要求共用调整原因、操作者、操作时间和批次标识，只推进一次并发修订。
-- 审计仍按日期逐行落库（供版本详情逐日回放），`batchId` 把同一批次的行聚合成
-- 一次范围操作；单日编辑不产生批次，保持 NULL。
--
-- 安全性：只 ADD COLUMN 且可空，不改既有列、不回填、无 DROP/TRUNCATE/DELETE。

ALTER TABLE `rental_calendar_override_audits`
  ADD COLUMN `batchId` VARCHAR(191) NULL;
