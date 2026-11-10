-- Original corporate membership-state recipients only; empty by default, no historical backfill.
CREATE UNIQUE INDEX `customer_status_history_recipient_scope_key` ON `customer_status_history`(`tenantId`, `id`, `customerId`);
CREATE UNIQUE INDEX `corporate_memberships_status_recipient_key` ON `customer_corporate_memberships`(`tenantId`, `corporateCustomerId`, `id`, `personalCustomerId`);

CREATE TABLE `enterprise_corporate_status_recipients` (
  `tenantId` VARCHAR(191) NOT NULL,
  `historyId` VARCHAR(191) NOT NULL,
  `corporateCustomerId` VARCHAR(191) NOT NULL,
  `recipientCustomerId` VARCHAR(191) NOT NULL,
  `membershipId` VARCHAR(191) NOT NULL,
  `membershipUpdatedAt` DATETIME(3) NOT NULL,
  `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`, `historyId`, `recipientCustomerId`),
  INDEX `corporate_status_recipient_person_at_idx` (`tenantId`, `recipientCustomerId`, `capturedAt`),
  CONSTRAINT `corporate_status_recipient_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `corporate_status_recipient_company_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `corporate_status_recipient_person_fk` FOREIGN KEY (`tenantId`, `recipientCustomerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `corporate_status_recipient_history_fk` FOREIGN KEY (`tenantId`, `historyId`, `corporateCustomerId`) REFERENCES `customer_status_history` (`tenantId`, `id`, `customerId`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `corporate_status_recipient_relation_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`, `membershipId`, `recipientCustomerId`) REFERENCES `customer_corporate_memberships` (`tenantId`, `corporateCustomerId`, `id`, `personalCustomerId`) ON DELETE CASCADE ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
