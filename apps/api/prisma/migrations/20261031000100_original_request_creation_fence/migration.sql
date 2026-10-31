-- Preserve original content, expiry and Task receipts. No TTL-driven release.
ALTER TABLE `ai_task_original_requests`
  ADD COLUMN `creationClosedAt` DATETIME(3) NULL,
  ADD COLUMN `creationCloseKey` VARCHAR(128) NULL;
