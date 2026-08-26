-- 需求 4.5.7：年度日历草稿可作废（已作废状态）。
--
-- 只有草稿可作废；已发布版本须由新版本替代、已被替代版本须保留供历史报价追溯。
-- 三列均可空、不回填：存量版本没有作废动作，留空即"从未作废"。

ALTER TABLE `rental_business_calendars`
  ADD COLUMN `voidedAt` DATETIME(3) NULL,
  ADD COLUMN `voidedBy` VARCHAR(191) NULL,
  ADD COLUMN `voidReason` VARCHAR(191) NULL;
