-- NOTICE：短信投递租约。纯新增列，不改动、不回填任何既有行。
--
-- 认领投递只写 leaseUntil、不再递增 attempts；attempts 只在记录投递结果时递增，
-- 因此进程在租约期内崩溃不会消耗一次重试机会，租约到期后该行自动回到待投递队列。

ALTER TABLE `rental_notification_logs`
  ADD COLUMN `leaseUntil` DATETIME(3) NULL AFTER `lastAttemptAt`;
