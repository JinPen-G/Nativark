-- ORDER-CHANGE-01A：取货前整行部分取消。原订单行保留原始数量与金额，
-- 通过 cancelledQuantity 与 append-only 变更记录表达取消事实。
ALTER TABLE `rental_order_lines`
  ADD COLUMN `cancelledQuantity` INTEGER NOT NULL DEFAULT 0 AFTER `quantity`;

CREATE TABLE `rental_order_changes` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `sequence` INTEGER NOT NULL,
  `type` VARCHAR(32) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `request` JSON NOT NULL,
  `beforeSnapshot` JSON NOT NULL,
  `afterSnapshot` JSON NOT NULL,
  `diff` JSON NOT NULL,
  `refundAmount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `additionalAmount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `depositDelta` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `preAuthDelta` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `requestedBy` VARCHAR(191) NOT NULL,
  `appliedBy` VARCHAR(191) NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `appliedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `rental_order_changes_idem_key` (`workspaceId`, `orderId`, `idempotencyKey`),
  UNIQUE INDEX `rental_order_changes_seq_key` (`orderId`, `sequence`),
  INDEX `rental_order_changes_scope_idx` (`tenantId`, `workspaceId`, `orderId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `rental_order_changes_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_order_changes_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_order_changes_tenantId_workspaceId_orderId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders` (`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
