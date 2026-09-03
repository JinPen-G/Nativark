-- 续租 / 延期记录（需求 4.6.9）+ 订单当前约定归还时间。
--
-- 需求原文：「延期是订单变更，不得直接修改原订单结束时间」。因此 rental_orders.endAt
-- 保持为原始约定，新增 effectiveEndAt 表示当前该还的时间；只有本表 status='effective'
-- 的记录才推进它。逾期判定与占用冲突检查读 effectiveEndAt，空值回落到 endAt。
--
-- 只追加表：一次续租一行，金额与费率/规则/日历快照一并固化，事后可复算这一段。
-- 幂等：(workspaceId, orderId, idempotencyKey) 唯一，重复提交只落一条。
-- (orderId, sequence) 唯一：序号进订单费用明细的 code，必须不重不漏。
--
-- 安全性：一条 ADD COLUMN（可空、无默认值回填）+ CreateTable / CreateIndex / AddConstraint，
-- 无 DROP/TRUNCATE/DELETE，不改任何既有数据。

ALTER TABLE `rental_orders` ADD COLUMN `effectiveEndAt` DATETIME(3) NULL;

CREATE TABLE `rental_order_extensions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `originalEndAt` DATETIME(3) NOT NULL,
    `newEndAt` DATETIME(3) NOT NULL,
    `billableUnits` DECIMAL(12, 2) NOT NULL,
    `rentalAmount` DECIMAL(12, 2) NOT NULL,
    `serviceAmount` DECIMAL(12, 2) NOT NULL,
    `depositDelta` DECIMAL(12, 2) NOT NULL,
    `preAuthDelta` DECIMAL(12, 2) NOT NULL,
    `payableAmount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `priceVersionId` VARCHAR(191) NULL,
    `priceVersion` VARCHAR(191) NULL,
    `ruleVersion` VARCHAR(191) NOT NULL,
    `rateSnapshot` JSON NOT NULL,
    `ruleSnapshot` JSON NOT NULL,
    `calendarSnapshot` JSON NOT NULL,
    `settlementMode` VARCHAR(20) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `memo` VARCHAR(500) NULL,
    `paidAt` DATETIME(3) NULL,
    `effectiveAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_order_extensions_scope_idx`(`tenantId`, `workspaceId`, `orderId`),
    INDEX `rental_order_extensions_status_idx`(`orderId`, `status`, `newEndAt`),
    UNIQUE INDEX `rental_order_extensions_idem_key`(`workspaceId`, `orderId`, `idempotencyKey`),
    UNIQUE INDEX `rental_order_extensions_seq_key`(`orderId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rental_order_extensions`
  ADD CONSTRAINT `rental_order_extensions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_order_extensions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_order_extensions_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
