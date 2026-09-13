-- EXT-02A：业务短信投递队列与安全重试字段。
-- recipient 只保留脱敏值；recipientEncrypted 由应用 AES-GCM 加密，不能作为接口字段返回。
ALTER TABLE `rental_notification_templates`
  ADD COLUMN `providerTemplateCode` VARCHAR(191) NULL AFTER `body`;

ALTER TABLE `rental_notification_logs`
  ADD COLUMN `recipientEncrypted` TEXT NULL AFTER `recipient`,
  ADD COLUMN `nextAttemptAt` DATETIME(3) NULL AFTER `attempts`,
  ADD COLUMN `lastAttemptAt` DATETIME(3) NULL AFTER `nextAttemptAt`,
  ADD COLUMN `maxAttempts` INT NOT NULL DEFAULT 3 AFTER `lastAttemptAt`;

CREATE INDEX `rental_notification_logs_ws_retry_idx`
  ON `rental_notification_logs` (`tenantId`, `workspaceId`, `status`, `nextAttemptAt`);
