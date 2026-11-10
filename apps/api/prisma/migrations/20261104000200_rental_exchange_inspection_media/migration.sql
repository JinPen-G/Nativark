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
  PRIMARY KEY (`tenantId`,`workspaceId`,`id`),
  UNIQUE KEY `rental_exchange_media_original_key` (`tenantId`,`workspaceId`,`actorUserId`,`operationKey`),
  INDEX `rental_exchange_media_order` (`tenantId`,`workspaceId`,`orderId`),
  CONSTRAINT `rental_exchange_media_order_fk` FOREIGN KEY (`tenantId`,`workspaceId`,`orderId`) REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`) ON DELETE RESTRICT,
  CONSTRAINT `rental_exchange_media_workspace_fk` FOREIGN KEY (`tenantId`,`workspaceId`) REFERENCES `business_workspaces` (`tenantId`,`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
