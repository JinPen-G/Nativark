-- 需求 4.5.3 / 4.5.7：人工覆盖审计流水、发布版本差异、导入保留的覆盖日期。
--
-- 三列都可空：存量年度日历没有这些记录，回填不出真实的历史原因与差异，
-- 编造一个会让审计比空缺更危险。

ALTER TABLE `rental_business_calendars`
  ADD COLUMN `publishDiff` JSON NULL,
  ADD COLUMN `overrideAudits` JSON NULL,
  ADD COLUMN `importPreservedOverrides` JSON NULL;
