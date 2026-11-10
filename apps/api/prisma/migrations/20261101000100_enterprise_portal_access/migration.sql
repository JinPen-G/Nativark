-- No backfill grants: existing admin relationships do not activate the portal.
CREATE UNIQUE INDEX `corporate_memberships_portal_scope_key`
  ON `customer_corporate_memberships` (`tenantId`, `corporateCustomerId`, `id`);

CREATE TABLE `enterprise_portal_tenant_settings` (
  `tenantId` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`),
  CONSTRAINT `enterprise_portal_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_corporate_portals` (
  `tenantId` VARCHAR(191) NOT NULL,
  `corporateCustomerId` VARCHAR(191) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`, `corporateCustomerId`),
  UNIQUE INDEX `enterprise_corporate_portals_corporateCustomerId_key` (`corporateCustomerId`),
  CONSTRAINT `enterprise_portal_corporate_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `enterprise_portal_corporate_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_portal_grants` (
  `tenantId` VARCHAR(191) NOT NULL,
  `corporateCustomerId` VARCHAR(191) NOT NULL,
  `membershipId` VARCHAR(191) NOT NULL,
  `action` VARCHAR(40) NOT NULL,
  `membershipUpdatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`, `corporateCustomerId`, `membershipId`, `action`),
  CONSTRAINT `enterprise_portal_grant_portal_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `enterprise_corporate_portals` (`tenantId`, `corporateCustomerId`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `enterprise_portal_grant_membership_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`, `membershipId`) REFERENCES `customer_corporate_memberships` (`tenantId`, `corporateCustomerId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_portal_operations` (
  `tenantId` VARCHAR(191) NOT NULL,
  `operationKey` VARCHAR(128) NOT NULL,
  `actorUserId` VARCHAR(191) NOT NULL,
  `requestHash` CHAR(64) NOT NULL,
  `target` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `result` JSON NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`, `operationKey`),
  CONSTRAINT `enterprise_portal_operation_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
