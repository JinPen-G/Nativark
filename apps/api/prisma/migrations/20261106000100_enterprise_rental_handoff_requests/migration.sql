-- Dedicated personal rental handoff requests. No order, subject, grant or funding mutation.
CREATE TABLE `enterprise_rental_handoff_requests` (
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `id` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `applicantCustomerId` VARCHAR(191) NOT NULL,
  `corporateCustomerId` VARCHAR(191) NOT NULL,
  `corporateMembershipId` VARCHAR(191) NOT NULL,
  `state` VARCHAR(40) NOT NULL DEFAULT 'pending',
  `revision` INTEGER NOT NULL DEFAULT 1,
  `material` JSON NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `pendingMarker` CHAR(64) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenantId`, `workspaceId`, `id`),
  UNIQUE INDEX `enterprise_handoff_pending_key` (`tenantId`, `workspaceId`, `pendingMarker`),
  INDEX `enterprise_handoff_own_idx` (`tenantId`, `workspaceId`, `applicantCustomerId`, `createdAt`),
  CONSTRAINT `enterprise_handoff_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `enterprise_handoff_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT,
  CONSTRAINT `enterprise_handoff_order_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders` (`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
