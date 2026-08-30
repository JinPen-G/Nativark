-- RULE-01B：押金与预授权的模拟资金事件（需求 4.4.7 line 527、4.6.3）。
--
-- 只追加表：押金/预授权的发起、追加、抵扣、退款、释放、失败各记一行，
-- 不通过修改原报价/订单明细表达。provider 恒为明确标记的 mock。
-- 幂等：(workspaceId, orderId, instrument, action, idempotencyKey) 唯一，
-- 重复提交只落一条——恢复流程可安全重放。
--
-- 安全性：只 CreateTable / CreateIndex / AddConstraint，无 DROP/TRUNCATE/DELETE，
-- 不改任何既有表与数据。

CREATE TABLE `rental_funding_events` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `instrument` VARCHAR(20) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `balanceAfter` DECIMAL(12, 2) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'mock',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `operator` VARCHAR(191) NULL,
    `failureCode` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_funding_events_scope_idx`(`tenantId`, `workspaceId`, `orderId`),
    INDEX `rental_funding_events_instrument_idx`(`orderId`, `instrument`, `at`),
    UNIQUE INDEX `rental_funding_events_idem_key`(`workspaceId`, `orderId`, `instrument`, `action`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rental_funding_events`
  ADD CONSTRAINT `rental_funding_events_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_funding_events_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_funding_events_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
