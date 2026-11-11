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
    REFERENCES `rental_exchange_inspection_media` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `rental_exchange_media_use_preparation_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`preparationId`)
    REFERENCES `rental_exchange_inspection_preparations` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT
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
    REFERENCES `rental_exchange_inspection_preparations` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `rental_exchange_consent_order_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`orderId`)
    REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `rental_exchange_consent_customer_fk` FOREIGN KEY (`tenantId`,`customerId`)
    REFERENCES `customer_profiles` (`tenantId`,`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
