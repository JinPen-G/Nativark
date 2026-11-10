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
  CONSTRAINT `rental_exchange_preparation_order_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`orderId`) REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `rental_exchange_preparation_workspace_fk` FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
