-- MEMBER-01C：保留每次个人证件提交与审核的不可变快照。
ALTER TABLE `customer_qualification_refs`
  ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'manual';

CREATE TABLE `customer_qualification_revisions` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `qualificationType` VARCHAR(191) NOT NULL,
  `categoryCode` VARCHAR(191) NOT NULL,
  `capabilityCode` VARCHAR(191) NULL,
  `applicableScope` JSON NOT NULL,
  `referenceNoMasked` VARCHAR(191) NULL,
  `issuedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NULL,
  `evidenceRef` VARCHAR(512) NULL,
  `source` VARCHAR(32) NOT NULL,
  `submittedBy` VARCHAR(191) NULL,
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `qualificationStatus` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `reviewStatus` VARCHAR(32) NOT NULL DEFAULT 'pending',
  `reviewReason` TEXT NULL,
  `reviewedBy` VARCHAR(191) NULL,
  `reviewedAt` DATETIME(3) NULL,
  `reviewId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `customer_qualification_revisions_reviewId_key` (`reviewId`),
  INDEX `customer_qualification_revisions_scope_customer_type_idx` (`tenantId`, `workspaceId`, `customerId`, `qualificationType`, `submittedAt`),
  INDEX `customer_qualification_revisions_customer_created_idx` (`tenantId`, `customerId`, `createdAt`),
  CONSTRAINT `customer_qualification_revisions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `customer_qualification_revisions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `customer_qualification_revisions_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `customer_qualification_revisions_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `customer_membership_reviews`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customer_qualification_refs`
  ADD COLUMN `currentRevisionId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `customer_qualification_refs_currentRevisionId_key` (`currentRevisionId`),
  ADD CONSTRAINT `customer_qualification_refs_currentRevisionId_fkey`
    FOREIGN KEY (`currentRevisionId`) REFERENCES `customer_qualification_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
