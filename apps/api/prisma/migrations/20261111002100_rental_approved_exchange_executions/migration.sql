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
    REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `rental_approved_exchange_preparation_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`preparationId`)
    REFERENCES `rental_exchange_inspection_preparations` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `rental_approved_exchange_consent_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`consentId`)
    REFERENCES `rental_exchange_inspection_consents` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `rental_approved_exchange_approval_fk` FOREIGN KEY (`tenantId`,`approvalId`)
    REFERENCES `enterprise_exchange_approvals` (`tenantId`,`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
