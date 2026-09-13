ALTER TABLE `file_upload_sessions`
  ADD COLUMN `cleanupAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `lastCleanupAt` DATETIME(3) NULL,
  ADD COLUMN `cleanupError` VARCHAR(500) NULL;
