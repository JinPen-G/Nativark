-- DOC-PRINT-01：订单客户凭证的不可变服务端快照。
-- 同一订单同一凭证类型的内容变化产生新版本，旧快照不原地覆盖。
CREATE TABLE `rental_order_document_snapshots` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `documentType` VARCHAR(32) NOT NULL,
  `templateCode` VARCHAR(64) NOT NULL,
  `documentNo` VARCHAR(191) NOT NULL,
  `sourceOrderUpdatedAt` DATETIME(3) NOT NULL,
  `snapshotAt` DATETIME(3) NOT NULL,
  `contentHash` CHAR(64) NOT NULL,
  `snapshot` JSON NOT NULL,
  `html` LONGTEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `rental_order_document_snapshots_content_key` (`tenantId`, `workspaceId`, `orderId`, `documentType`, `contentHash`),
  INDEX `rental_order_document_snapshots_history_idx` (`tenantId`, `workspaceId`, `orderId`, `documentType`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `rental_order_document_snapshots_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_order_document_snapshots_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_order_document_snapshots_tenant_ws_order_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders` (`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
