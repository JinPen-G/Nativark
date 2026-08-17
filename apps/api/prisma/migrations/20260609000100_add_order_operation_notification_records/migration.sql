CREATE TABLE `OrderOperationRecord` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `orderNo` VARCHAR(191) NOT NULL,
  `action` VARCHAR(191) NOT NULL,
  `actionLabel` VARCHAR(191) NOT NULL,
  `status` VARCHAR(64) NOT NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `requestHash` VARCHAR(191) NOT NULL,
  `lockStatus` VARCHAR(64) NULL,
  `operator` VARCHAR(191) NULL,
  `message` VARCHAR(512) NULL,
  `payload` JSON NULL,
  `expiresAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `OrderOperationRecord_tenant_order_action_key` (`tenantId`, `orderId`, `action`, `idempotencyKey`),
  INDEX `OrderOperationRecord_tenant_order_created_idx` (`tenantId`, `orderId`, `createdAt`),
  INDEX `OrderOperationRecord_tenant_order_action_hash_idx` (`tenantId`, `orderId`, `action`, `requestHash`),
  INDEX `OrderOperationRecord_tenant_action_status_idx` (`tenantId`, `action`, `status`, `createdAt`),
  CONSTRAINT `OrderOperationRecord_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 将 20260608000300_add_order_fulfillment_records 创建的旧结构 OrderNotificationRecord
-- 原地升级为当前 schema：先新增列并回填映射（tenantId/orderNo 来自订单，scene→event/eventLabel，
-- target→targetMasked，content→contentSummary，超过 512 字符按目标结构截断），
-- 再移除已映射的旧列；全程不删除任何已有通知记录。
ALTER TABLE `OrderNotificationRecord`
  ADD COLUMN `tenantId` VARCHAR(191) NOT NULL DEFAULT '' AFTER `id`,
  ADD COLUMN `orderNo` VARCHAR(191) NOT NULL DEFAULT '' AFTER `orderId`,
  ADD COLUMN `event` VARCHAR(191) NOT NULL DEFAULT '' AFTER `orderNo`,
  ADD COLUMN `eventLabel` VARCHAR(191) NOT NULL DEFAULT '' AFTER `event`,
  ADD COLUMN `targetMasked` VARCHAR(191) NOT NULL DEFAULT '' AFTER `channel`,
  ADD COLUMN `contentSummary` VARCHAR(512) NOT NULL DEFAULT '' AFTER `targetMasked`,
  ADD COLUMN `templateCode` VARCHAR(191) NOT NULL DEFAULT '' AFTER `status`,
  ADD COLUMN `relatedAction` VARCHAR(191) NULL AFTER `operator`,
  ADD COLUMN `failReason` VARCHAR(512) NULL AFTER `idempotencyKey`,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

UPDATE `OrderNotificationRecord` `n`
  JOIN `StoreRentalOrder` `o` ON `o`.`id` = `n`.`orderId`
  SET `n`.`tenantId` = `o`.`tenantId`,
      `n`.`orderNo` = `o`.`orderNo`;

UPDATE `OrderNotificationRecord`
  SET `event` = `scene`,
      `eventLabel` = `scene`,
      `targetMasked` = `target`,
      `templateCode` = CONCAT('LEGACY_', `scene`),
      `contentSummary` = LEFT(`content`, 512)
  WHERE `event` = '';

-- 外键依赖旧 orderId_scene 复合索引作为前缀索引，必须先删约束再改造；
-- 改造后显式重建 orderId 索引（避免 InnoDB 自动生成与 schema 不一致的同名约束索引），再恢复外键
ALTER TABLE `OrderNotificationRecord`
  DROP FOREIGN KEY `OrderNotificationRecord_orderId_fkey`;

ALTER TABLE `OrderNotificationRecord`
  DROP INDEX `OrderNotificationRecord_orderId_scene_createdAt_idx`,
  DROP INDEX `OrderNotificationRecord_orderId_idempotencyKey_idx`,
  MODIFY COLUMN `channel` VARCHAR(64) NOT NULL,
  MODIFY COLUMN `status` VARCHAR(64) NOT NULL,
  DROP COLUMN `scene`,
  DROP COLUMN `target`,
  DROP COLUMN `content`,
  ADD INDEX `OrderNotificationRecord_orderId_idx` (`orderId`),
  ADD INDEX `OrderNotificationRecord_tenant_order_created_idx` (`tenantId`, `orderId`, `createdAt`),
  ADD INDEX `OrderNotificationRecord_tenant_event_status_idx` (`tenantId`, `event`, `status`, `createdAt`),
  ADD INDEX `OrderNotificationRecord_tenant_related_action_idx` (`tenantId`, `relatedAction`, `createdAt`);

ALTER TABLE `OrderNotificationRecord`
  ADD CONSTRAINT `OrderNotificationRecord_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
