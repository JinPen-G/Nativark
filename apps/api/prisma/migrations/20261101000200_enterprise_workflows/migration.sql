-- Enterprise requests never imply membership, approval or payment execution.
CREATE TABLE `enterprise_workflow_requests` (
  `tenantId` VARCHAR(191) NOT NULL,
  `id` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(40) NOT NULL,
  `applicantCustomerId` VARCHAR(191) NOT NULL,
  `corporateCustomerId` VARCHAR(191) NULL,
  `state` VARCHAR(40) NOT NULL DEFAULT 'draft',
  `revision` INTEGER NOT NULL DEFAULT 1,
  `payload` JSON NOT NULL,
  `decisionReason` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`, `id`),
  INDEX `enterprise_request_applicant` (`tenantId`, `applicantCustomerId`, `kind`, `createdAt`),
  INDEX `enterprise_request_company` (`tenantId`, `corporateCustomerId`, `kind`, `state`),
  CONSTRAINT `enterprise_request_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `enterprise_request_applicant_fk` FOREIGN KEY (`tenantId`, `applicantCustomerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `enterprise_request_company_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_invite_policies` (
  `tenantId` VARCHAR(191) NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `policy` JSON NOT NULL,
  PRIMARY KEY (`tenantId`),
  CONSTRAINT `enterprise_invite_policy_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_invites` (
  `tenantId` VARCHAR(191) NOT NULL,
  `id` VARCHAR(191) NOT NULL,
  `corporateCustomerId` VARCHAR(191) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `revision` INTEGER NOT NULL DEFAULT 1,
  `expiresAt` DATETIME(3) NOT NULL,
  `maxUses` INTEGER NOT NULL,
  `used` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`, `id`),
  UNIQUE KEY `enterprise_invite_token` (`tokenHash`),
  INDEX `enterprise_invite_company` (`tenantId`, `corporateCustomerId`, `createdAt`),
  CONSTRAINT `enterprise_invite_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `enterprise_invite_company_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
