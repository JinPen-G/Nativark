-- MEMBER-01E：会员方案授予的停用/撤销审计。
ALTER TABLE `customer_membership_plan_assignments`
  ADD COLUMN `revokedBy` VARCHAR(191) NULL,
  ADD COLUMN `revokedAt` DATETIME(3) NULL,
  ADD COLUMN `revokeReason` TEXT NULL;
