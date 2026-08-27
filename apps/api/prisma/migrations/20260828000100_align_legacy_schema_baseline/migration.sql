-- DB-BASELINE-01：让空库全量迁移产物与 schema.prisma 完全一致。
--
-- 本迁移只对齐枚举/列定义、外键删除策略和索引名称，不删除表或业务列。
-- 应用前在开发库完成预检：枚举无越界值、收窄列最大长度 <= 32、四个外键无孤儿记录。

ALTER TABLE `OrderContractDocument` DROP FOREIGN KEY `OrderContractDocument_orderId_fkey`;
ALTER TABLE `OrderIdempotencyRecord` DROP FOREIGN KEY `OrderIdempotencyRecord_orderId_fkey`;
ALTER TABLE `OrderOperationLock` DROP FOREIGN KEY `OrderOperationLock_orderId_fkey`;
ALTER TABLE `OrderRemarkRecord` DROP FOREIGN KEY `OrderRemarkRecord_orderId_fkey`;

ALTER TABLE `MarketingPlan`
  MODIFY `status` ENUM('draft', 'effective', 'archived') NOT NULL DEFAULT 'draft';

ALTER TABLE `MarketingPlanVersion`
  MODIFY `status` ENUM('draft', 'effective', 'archived') NOT NULL;

ALTER TABLE `OrderEventSnapshot`
  MODIFY `triggerReason` VARCHAR(191) NULL;

ALTER TABLE `OrderNotificationRecord`
  ALTER COLUMN `tenantId` DROP DEFAULT,
  ALTER COLUMN `orderNo` DROP DEFAULT,
  ALTER COLUMN `event` DROP DEFAULT,
  ALTER COLUMN `eventLabel` DROP DEFAULT,
  MODIFY `channel` VARCHAR(191) NOT NULL,
  ALTER COLUMN `targetMasked` DROP DEFAULT,
  MODIFY `contentSummary` VARCHAR(191) NOT NULL,
  MODIFY `status` VARCHAR(191) NOT NULL,
  ALTER COLUMN `templateCode` DROP DEFAULT,
  MODIFY `failReason` VARCHAR(191) NULL,
  ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `OrderOperationRecord`
  MODIFY `status` VARCHAR(191) NOT NULL,
  MODIFY `lockStatus` VARCHAR(191) NULL,
  MODIFY `message` VARCHAR(191) NULL,
  ALTER COLUMN `updatedAt` DROP DEFAULT;

ALTER TABLE `Tenant`
  MODIFY `statusReason` VARCHAR(191) NULL;

ALTER TABLE `VehicleAttachmentRecord`
  MODIFY `url` VARCHAR(191) NOT NULL,
  MODIFY `remark` VARCHAR(191) NULL;

ALTER TABLE `OrderContractDocument`
  ADD CONSTRAINT `OrderContractDocument_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `OrderRemarkRecord`
  ADD CONSTRAINT `OrderRemarkRecord_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `OrderOperationLock`
  ADD CONSTRAINT `OrderOperationLock_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `OrderIdempotencyRecord`
  ADD CONSTRAINT `OrderIdempotencyRecord_orderId_fkey`
  FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 部分既有环境曾按 schema 手工改过索引名。静态 RENAME 会在这些环境报 1176，
-- 而 MySQL DDL 非事务化，失败前的列/外键改动已经提交。每个重命名因此必须可重放：
-- 仅当旧名存在且新名不存在时执行；新名已经存在时保持原状。
SET @rename_index_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderNotificationRecord' AND index_name = 'OrderNotificationRecord_tenant_event_status_idx')
  AND NOT EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderNotificationRecord' AND index_name = 'OrderNotificationRecord_tenantId_event_status_createdAt_idx'),
  'ALTER TABLE `OrderNotificationRecord` RENAME INDEX `OrderNotificationRecord_tenant_event_status_idx` TO `OrderNotificationRecord_tenantId_event_status_createdAt_idx`',
  'SELECT 1'
);
PREPARE rename_index_stmt FROM @rename_index_sql; EXECUTE rename_index_stmt; DEALLOCATE PREPARE rename_index_stmt;

SET @rename_index_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderNotificationRecord' AND index_name = 'OrderNotificationRecord_tenant_order_created_idx')
  AND NOT EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderNotificationRecord' AND index_name = 'OrderNotificationRecord_tenantId_orderId_createdAt_idx'),
  'ALTER TABLE `OrderNotificationRecord` RENAME INDEX `OrderNotificationRecord_tenant_order_created_idx` TO `OrderNotificationRecord_tenantId_orderId_createdAt_idx`',
  'SELECT 1'
);
PREPARE rename_index_stmt FROM @rename_index_sql; EXECUTE rename_index_stmt; DEALLOCATE PREPARE rename_index_stmt;

SET @rename_index_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderNotificationRecord' AND index_name = 'OrderNotificationRecord_tenant_related_action_idx')
  AND NOT EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderNotificationRecord' AND index_name = 'OrderNotificationRecord_tenantId_relatedAction_createdAt_idx'),
  'ALTER TABLE `OrderNotificationRecord` RENAME INDEX `OrderNotificationRecord_tenant_related_action_idx` TO `OrderNotificationRecord_tenantId_relatedAction_createdAt_idx`',
  'SELECT 1'
);
PREPARE rename_index_stmt FROM @rename_index_sql; EXECUTE rename_index_stmt; DEALLOCATE PREPARE rename_index_stmt;

SET @rename_index_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderOperationRecord' AND index_name = 'OrderOperationRecord_tenant_action_status_idx')
  AND NOT EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderOperationRecord' AND index_name = 'OrderOperationRecord_tenantId_action_status_createdAt_idx'),
  'ALTER TABLE `OrderOperationRecord` RENAME INDEX `OrderOperationRecord_tenant_action_status_idx` TO `OrderOperationRecord_tenantId_action_status_createdAt_idx`',
  'SELECT 1'
);
PREPARE rename_index_stmt FROM @rename_index_sql; EXECUTE rename_index_stmt; DEALLOCATE PREPARE rename_index_stmt;

SET @rename_index_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderOperationRecord' AND index_name = 'OrderOperationRecord_tenant_order_action_hash_idx')
  AND NOT EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderOperationRecord' AND index_name = 'OrderOperationRecord_tenantId_orderId_action_requestHash_idx'),
  'ALTER TABLE `OrderOperationRecord` RENAME INDEX `OrderOperationRecord_tenant_order_action_hash_idx` TO `OrderOperationRecord_tenantId_orderId_action_requestHash_idx`',
  'SELECT 1'
);
PREPARE rename_index_stmt FROM @rename_index_sql; EXECUTE rename_index_stmt; DEALLOCATE PREPARE rename_index_stmt;

SET @rename_index_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderOperationRecord' AND index_name = 'OrderOperationRecord_tenant_order_action_key')
  AND NOT EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderOperationRecord' AND index_name = 'OrderOperationRecord_tenantId_orderId_action_idempotencyKey_key'),
  'ALTER TABLE `OrderOperationRecord` RENAME INDEX `OrderOperationRecord_tenant_order_action_key` TO `OrderOperationRecord_tenantId_orderId_action_idempotencyKey_key`',
  'SELECT 1'
);
PREPARE rename_index_stmt FROM @rename_index_sql; EXECUTE rename_index_stmt; DEALLOCATE PREPARE rename_index_stmt;

SET @rename_index_sql = IF(
  EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderOperationRecord' AND index_name = 'OrderOperationRecord_tenant_order_created_idx')
  AND NOT EXISTS(SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'OrderOperationRecord' AND index_name = 'OrderOperationRecord_tenantId_orderId_createdAt_idx'),
  'ALTER TABLE `OrderOperationRecord` RENAME INDEX `OrderOperationRecord_tenant_order_created_idx` TO `OrderOperationRecord_tenantId_orderId_createdAt_idx`',
  'SELECT 1'
);
PREPARE rename_index_stmt FROM @rename_index_sql; EXECUTE rename_index_stmt; DEALLOCATE PREPARE rename_index_stmt;
