-- CORP-SETTLE-01A：企业授信占用、释放、结算与回款追加式流水。
-- 账户级事实按租户+企业主档归集；workspaceId/orderId 只作为业务追溯引用，
-- 不把一笔企业授信错误拆成多个空间额度。
CREATE TABLE `customer_corporate_credit_ledger` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NULL,
  `orderId` VARCHAR(191) NULL,
  `entryType` VARCHAR(24) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `reservedDelta` DECIMAL(12, 2) NOT NULL,
  `receivableDelta` DECIMAL(12, 2) NOT NULL,
  `reservedAfter` DECIMAL(12, 2) NOT NULL,
  `receivableAfter` DECIMAL(12, 2) NOT NULL,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `operator` VARCHAR(191) NULL,
  `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `customer_credit_ledger_idem_key` (`tenantId`, `customerId`, `idempotencyKey`),
  INDEX `customer_credit_ledger_account_time_idx` (`tenantId`, `customerId`, `occurredAt`),
  INDEX `customer_credit_ledger_order_idx` (`tenantId`, `customerId`, `orderId`),
  INDEX `customer_credit_ledger_scope_order_idx` (`tenantId`, `workspaceId`, `orderId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `customer_credit_ledger_tenant_fkey`
    FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `customer_credit_ledger_tenant_customer_fkey`
    FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
