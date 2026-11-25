-- Rental 0.1.1 承接原换货工作流的六张 raw SQL 表。
-- 原主键、外键、确认字段和不可重放收据按历史迁移最终结构保留。
-- MySQL 外键的原默认更新动作显式写为 RESTRICT，供同源物理核验读取。
-- 原迁移来自 apps/api/prisma/migrations，按下列顺序核定。
-- 20261103000100_enterprise_exchange_approvals
-- 20261103000200_enterprise_exchange_confirmation
-- 20261104000100_rental_exchange_inspection_preparations
-- 20261104000200_rental_exchange_inspection_media
-- 20261104000300_rental_exchange_inspection_media_claim
-- 20261111002000_rental_exchange_inspection_acceptance
-- 20261111002100_rental_approved_exchange_executions

-- Exchange approval grants spending only; no inventory, payment or physical fulfillment.
CREATE TABLE `enterprise_exchange_approvals` (
  `tenantId` VARCHAR(191) NOT NULL,
  `id` VARCHAR(191) NOT NULL,
  `corporateCustomerId` VARCHAR(191) NOT NULL,
  `applicantCustomerId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `expectedOrderUpdatedAt` VARCHAR(40) NOT NULL,
  `requestFingerprint` CHAR(64) NOT NULL,
  `previewFingerprint` CHAR(64) NOT NULL,
  `request` JSON NOT NULL,
  `preview` JSON NOT NULL,
  `basis` JSON NOT NULL,
  `state` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `revision` INTEGER NOT NULL DEFAULT 1,
  `reason` VARCHAR(500) NOT NULL,
  `decisionReason` VARCHAR(500) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `approvedBy` VARCHAR(191) NULL,
  `reviewerMembershipId` VARCHAR(191) NULL,
  `reviewerMembershipUpdatedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `employeeConfirmationOperationKey` VARCHAR(128) NULL,
  `employeeConfirmedAt` DATETIME(3) NULL,
  `employeeConfirmationFingerprint` CHAR(64) NULL,
  PRIMARY KEY (`tenantId`,`id`),
  INDEX `enterprise_exchange_applicant` (`tenantId`,`applicantCustomerId`,`workspaceId`,`state`),
  INDEX `enterprise_exchange_company` (`tenantId`,`corporateCustomerId`,`workspaceId`,`state`),
  CONSTRAINT `enterprise_exchange_order_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`orderId`) REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `enterprise_exchange_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `enterprise_exchange_company_fk` FOREIGN KEY (`tenantId`,`corporateCustomerId`) REFERENCES `customer_profiles` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `enterprise_exchange_applicant_fk` FOREIGN KEY (`tenantId`,`applicantCustomerId`) REFERENCES `customer_profiles` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `enterprise_exchange_workspace_fk` FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Append-only inspection preparation; never a fulfillment, payment or consent record.
CREATE TABLE `rental_exchange_inspection_preparations` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `payloadHash` CHAR(64) NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`,`workspaceId`,`id`),
  UNIQUE KEY `rental_exchange_preparation_original_key` (`tenantId`,`workspaceId`,`actorUserId`,`operationKey`),
  INDEX `rental_exchange_preparation_order` (`tenantId`,`workspaceId`,`orderId`),
  CONSTRAINT `rental_exchange_preparation_order_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`orderId`) REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_exchange_preparation_workspace_fk` FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Original binding is immutable. Completion evidence is appended once, with file/session state.
-- No TTL deletion, customer consent, preparation acceptance or exchange execution.
CREATE TABLE `rental_exchange_inspection_media` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `id` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `binding` JSON NOT NULL,
  `bindingHash` CHAR(64) NOT NULL,
  `completion` JSON NULL,
  `completionHash` CHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completionClaimId` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  `completionClaimedAt` DATETIME(3) NULL,
  PRIMARY KEY (`tenantId`,`workspaceId`,`id`),
  UNIQUE KEY `rental_exchange_media_original_key` (`tenantId`,`workspaceId`,`actorUserId`,`operationKey`),
  INDEX `rental_exchange_media_order` (`tenantId`,`workspaceId`,`orderId`),
  CONSTRAINT `rental_exchange_media_order_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`orderId`) REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_exchange_media_workspace_fk` FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Additive original evidence links. These tables do not confirm physical
-- handover, consume an expense approval or imply a successful payment.
CREATE TABLE `rental_exchange_inspection_media_uses` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `sourceId` VARCHAR(191) NOT NULL,
  `preparationId` VARCHAR(191) NOT NULL,
  `evidenceHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`,`workspaceId`,`sourceId`),
  INDEX `rental_exchange_media_use_preparation` (`tenantId`,`workspaceId`,`preparationId`),
  CONSTRAINT `rental_exchange_media_use_source_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`sourceId`)
    REFERENCES `rental_exchange_inspection_media` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_exchange_media_use_preparation_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`preparationId`)
    REFERENCES `rental_exchange_inspection_preparations` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_exchange_inspection_consents` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `preparationId` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `requestHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payloadHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`,`workspaceId`,`id`),
  UNIQUE KEY `rental_exchange_consent_original_key` (`tenantId`,`workspaceId`,`customerId`,`operationKey`),
  UNIQUE KEY `rental_exchange_consent_preparation` (`tenantId`,`workspaceId`,`preparationId`,`customerId`),
  CONSTRAINT `rental_exchange_consent_preparation_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`preparationId`)
    REFERENCES `rental_exchange_inspection_preparations` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_exchange_consent_order_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`orderId`)
    REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_exchange_consent_customer_fk` FOREIGN KEY (`tenantId`,`customerId`)
    REFERENCES `customer_profiles` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The original Core key, change and enterprise approval commit together. No TTL
-- deletion or lease expiry may turn this evidence into permission to reexecute.
CREATE TABLE `rental_approved_exchange_executions` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `approvalId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `changeId` VARCHAR(191) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `preparationId` VARCHAR(191) NOT NULL,
  `consentId` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `approvalHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request` JSON NOT NULL,
  `payloadHash` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payload` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`,`workspaceId`,`approvalId`),
  UNIQUE KEY `rental_approved_exchange_original_key` (`tenantId`,`workspaceId`,`actorUserId`,`operationKey`),
  UNIQUE KEY `rental_approved_exchange_change` (`tenantId`,`workspaceId`,`changeId`),
  UNIQUE KEY `rental_approved_exchange_preparation` (`tenantId`,`workspaceId`,`preparationId`),
  UNIQUE KEY `rental_approved_exchange_consent` (`tenantId`,`workspaceId`,`consentId`),
  CONSTRAINT `rental_approved_exchange_order_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`orderId`)
    REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_approved_exchange_preparation_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`preparationId`)
    REFERENCES `rental_exchange_inspection_preparations` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_approved_exchange_consent_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`consentId`)
    REFERENCES `rental_exchange_inspection_consents` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `rental_approved_exchange_approval_fk` FOREIGN KEY (`tenantId`,`approvalId`)
    REFERENCES `enterprise_exchange_approvals` (`tenantId`,`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
