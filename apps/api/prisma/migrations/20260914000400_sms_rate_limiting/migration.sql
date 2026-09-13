ALTER TABLE `rental_notification_logs`
  ADD COLUMN `recipientFingerprint` CHAR(64) NULL,
  ADD INDEX `rental_notification_logs_sms_rate_idx` (`tenantId`, `workspaceId`, `channel`, `recipientFingerprint`, `createdAt`);

CREATE TABLE `rental_notification_rate_buckets` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `scopeKey` VARCHAR(128) NOT NULL,
  `bucketStart` DATETIME(3) NOT NULL,
  `count` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `rental_notification_rate_bucket_key` (`tenantId`, `workspaceId`, `scopeKey`, `bucketStart`),
  INDEX `rental_notification_rate_bucket_scope_idx` (`tenantId`, `workspaceId`, `bucketStart`),
  PRIMARY KEY (`id`),
  CONSTRAINT `rental_notification_rate_buckets_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_notification_rate_buckets_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
