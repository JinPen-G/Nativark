ALTER TABLE `FinanceDocument`
  ADD COLUMN `relatedFeeIds` JSON NULL,
  ADD COLUMN `originalDocumentId` VARCHAR(191) NULL,
  ADD COLUMN `originalDocumentNo` VARCHAR(191) NULL,
  ADD COLUMN `replacementDocumentId` VARCHAR(191) NULL,
  ADD COLUMN `replacementDocumentNo` VARCHAR(191) NULL,
  ADD COLUMN `voidReason` VARCHAR(191) NULL,
  ADD COLUMN `voidedBy` VARCHAR(191) NULL,
  ADD COLUMN `reissuedAt` DATETIME(3) NULL,
  ADD COLUMN `auditTrail` JSON NULL;

CREATE INDEX `FinanceDocument_tenantId_originalDocumentId_idx`
  ON `FinanceDocument`(`tenantId`, `originalDocumentId`);

CREATE INDEX `FinanceDocument_tenantId_replacementDocumentId_idx`
  ON `FinanceDocument`(`tenantId`, `replacementDocumentId`);
