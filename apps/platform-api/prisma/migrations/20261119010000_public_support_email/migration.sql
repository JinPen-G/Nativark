CREATE TABLE `tenant_support_mailboxes` (
  `id` VARCHAR(191) NOT NULL, `tenantId` VARCHAR(191) NOT NULL, `configId` VARCHAR(191) NOT NULL,
  `mailboxFingerprint` CHAR(64) NOT NULL, `uidValidity` VARCHAR(64) NULL,
  `lastUid` BIGINT UNSIGNED NOT NULL DEFAULT 0, `lastSyncedAt` DATETIME(3) NULL,
  `leaseToken` VARCHAR(64) NULL, `leaseUntil` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `tenant_support_mailbox_source_key` (`tenantId`, `configId`, `mailboxFingerprint`),
  CONSTRAINT `tenant_support_mailboxes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `tenant_support_emails` (
  `id` VARCHAR(191) NOT NULL, `tenantId` VARCHAR(191) NOT NULL, `configId` VARCHAR(191) NOT NULL,
  `mailboxFingerprint` CHAR(64) NOT NULL, `uidValidity` VARCHAR(64) NOT NULL, `uid` BIGINT UNSIGNED NOT NULL,
  `senderEmail` VARCHAR(320) NOT NULL, `senderName` VARCHAR(191) NOT NULL, `recipient` VARCHAR(1000) NOT NULL,
  `subject` VARCHAR(500) NOT NULL, `bodyText` MEDIUMTEXT NOT NULL, `attachments` JSON NOT NULL,
  `messageId` VARCHAR(191) NULL, `receivedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `tenant_support_email_uid_key` (`tenantId`, `configId`, `mailboxFingerprint`, `uidValidity`, `uid`),
  INDEX `tenant_support_email_received_idx` (`tenantId`, `receivedAt`),
  CONSTRAINT `tenant_support_emails_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
