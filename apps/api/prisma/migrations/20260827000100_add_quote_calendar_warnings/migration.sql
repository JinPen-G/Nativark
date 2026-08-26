-- 需求 4.5.2：报价保存"该年度官方日历尚未确认"的提示。
--
-- 可空、不回填：存量报价按生成当时的口径产出，无法回填"当时是否提示过"，
-- 编造一个提示比留空更容易误导追溯。

ALTER TABLE `rental_quotes`
  ADD COLUMN `calendarWarnings` JSON NULL;
