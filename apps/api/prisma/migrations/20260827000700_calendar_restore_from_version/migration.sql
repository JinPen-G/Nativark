-- 历史版本恢复（需求 4.5.7：「恢复旧规则也必须以旧内容生成新的发布版本，
-- 不得删除新版本或把旧版本原地改回」）。
--
-- 记录新草稿是从哪个历史版本恢复而来以及恢复原因；被恢复的那个版本本身不做任何改动，
-- 当前已发布版本也不受影响——恢复走的是"复制成新草稿 → 预检 → 填原因 → 发布"这条正路。
--
-- 安全性：只 ADD COLUMN、可空、无需回填。

ALTER TABLE `rental_business_calendars`
  ADD COLUMN `restoredFromVersion` VARCHAR(191) NULL,
  ADD COLUMN `restoreReason` VARCHAR(191) NULL;
