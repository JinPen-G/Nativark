-- 公共文件与原上传/清理收据，复用原三份迁移的文件语句。
-- 原组合迁移链保持；本追加只用于独立公共库，不创建业务或AI检查表。

CREATE TABLE `FileAsset` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `businessModule` VARCHAR(191) NOT NULL,
    `businessType` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `fileExt` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `sizeBytes` INTEGER NOT NULL DEFAULT 0,
    `storageProvider` VARCHAR(191) NOT NULL DEFAULT 'local_mock',
    `storageKey` VARCHAR(191) NOT NULL,
    `publicUrl` VARCHAR(191) NULL,
    `checksum` VARCHAR(191) NULL,
    `uploadScene` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `uploadedBy` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FileAsset_tenantId_businessType_businessId_idx`(`tenantId`, `businessType`, `businessId`),
    INDEX `FileAsset_tenantId_uploadScene_createdAt_idx`(`tenantId`, `uploadScene`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `FileAsset` ADD CONSTRAINT `FileAsset_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `file_upload_sessions` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `fileAssetId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(40) NOT NULL,
  `storageKey` VARCHAR(500) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'pending_upload',
  `idempotencyKey` VARCHAR(191) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `completedAt` DATETIME(3) NULL,
  `failureReason` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `file_upload_sessions_fileAssetId_key` (`fileAssetId`),
  UNIQUE INDEX `file_upload_sessions_scope_idem_key` (`tenantId`, `idempotencyKey`),
  INDEX `file_upload_sessions_scope_status_idx` (`tenantId`, `status`, `expiresAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `file_upload_sessions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `file_upload_sessions_fileAssetId_fkey` FOREIGN KEY (`fileAssetId`) REFERENCES `FileAsset` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `file_upload_sessions`
  ADD COLUMN `cleanupAttempts` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `lastCleanupAt` DATETIME(3) NULL,
  ADD COLUMN `cleanupError` VARCHAR(500) NULL;
