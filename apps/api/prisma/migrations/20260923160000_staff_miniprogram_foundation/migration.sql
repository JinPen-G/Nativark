-- STAFF-BE-01/02/04：显式保存员工地点授权、会话受众，并登记独立线下收款权限。
-- 旧会话统一标记 operator；不迁移或扩大任何已有角色权限。
ALTER TABLE `workspace_members`
  ADD COLUMN `locationScope` JSON NULL;

ALTER TABLE `auth_sessions`
  ADD COLUMN `audience` VARCHAR(16) NOT NULL DEFAULT 'operator';

INSERT INTO `Permission` (`id`, `code`, `name`, `description`, `module`, `kind`, `createdAt`)
SELECT UUID(), 'rental-os:order:offline-payment', '线下收款登记',
       '登记待确认的线下收款；不含确认到账、退款或资金结算',
       '租赁业务', 'ACTION', CURRENT_TIMESTAMP(3)
FROM (SELECT 1) AS seed
WHERE NOT EXISTS (SELECT 1 FROM `Permission` WHERE `code` = 'rental-os:order:offline-payment');

CREATE TABLE IF NOT EXISTS `rental_offline_payment_registrations` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `instrument` VARCHAR(20) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `paymentMethod` VARCHAR(24) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `evidenceFileAssetId` VARCHAR(191) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `registeredBy` VARCHAR(191) NULL,
  `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `confirmedBy` VARCHAR(191) NULL,
  `confirmedAt` DATETIME(3) NULL,
  `fundingEventId` VARCHAR(191) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `rental_offline_payments_idem_key` (`workspaceId`, `orderId`, `idempotencyKey`),
  INDEX `rental_offline_payments_pending_idx` (`tenantId`, `workspaceId`, `status`, `registeredAt`),
  INDEX `rental_offline_payments_order_idx` (`orderId`, `status`),
  CONSTRAINT `rental_offline_payment_registrations_tenantId_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_offline_payment_registrations_workspace_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `rental_offline_payment_registrations_orderId_fkey`
    FOREIGN KEY (`orderId`) REFERENCES `rental_orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
