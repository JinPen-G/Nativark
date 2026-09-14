-- EXT-01D：生产支付对账文件只追加导入批次与差异行，不直接改变支付或资金事实。
CREATE TABLE `payment_reconciliation_batches` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `provider` VARCHAR(40) NOT NULL,
  `fileName` VARCHAR(180) NOT NULL,
  `fileSha256` CHAR(64) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `totalRows` INTEGER NOT NULL,
  `matchedRows` INTEGER NOT NULL DEFAULT 0,
  `differenceRows` INTEGER NOT NULL DEFAULT 0,
  `acknowledgedRows` INTEGER NOT NULL DEFAULT 0,
  `importedBy` VARCHAR(191) NULL,
  `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `payment_reconciliation_batch_file_key` (`tenantId`, `workspaceId`, `provider`, `fileSha256`),
  INDEX `payment_reconciliation_batch_scope_idx` (`tenantId`, `workspaceId`, `status`, `importedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `payment_reconciliation_batches_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `payment_reconciliation_batches_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_reconciliation_lines` (
  `id` VARCHAR(191) NOT NULL,
  `batchId` VARCHAR(191) NOT NULL,
  `rowNumber` INTEGER NOT NULL,
  `kind` VARCHAR(16) NOT NULL,
  `merchantOrderNo` VARCHAR(191) NOT NULL,
  `merchantRefundNo` VARCHAR(191) NULL,
  `externalId` VARCHAR(191) NULL,
  `statementStatus` VARCHAR(80) NOT NULL,
  `normalizedStatus` VARCHAR(24) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `currency` VARCHAR(8) NOT NULL,
  `occurredAt` DATETIME(3) NULL,
  `localRecordId` VARCHAR(191) NULL,
  `localStatus` VARCHAR(32) NULL,
  `differenceCodes` JSON NOT NULL,
  `differenceDetail` VARCHAR(1000) NULL,
  `reviewStatus` VARCHAR(24) NOT NULL DEFAULT 'not_required',
  `reviewReason` VARCHAR(500) NULL,
  `reviewedBy` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `payment_reconciliation_line_row_key` (`batchId`, `rowNumber`),
  INDEX `payment_reconciliation_line_review_idx` (`batchId`, `reviewStatus`),
  PRIMARY KEY (`id`),
  CONSTRAINT `payment_reconciliation_lines_batchId_fkey`
    FOREIGN KEY (`batchId`) REFERENCES `payment_reconciliation_batches` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
