-- MEMBER-01E：会员方案版本停用与历史版本恢复审计。
ALTER TABLE `customer_membership_plan_versions`
  ADD COLUMN `disabledBy` VARCHAR(191) NULL,
  ADD COLUMN `disabledAt` DATETIME(3) NULL,
  ADD COLUMN `disableReason` TEXT NULL,
  ADD COLUMN `restoredFromVersionId` VARCHAR(191) NULL,
  ADD COLUMN `restoreReason` TEXT NULL;
