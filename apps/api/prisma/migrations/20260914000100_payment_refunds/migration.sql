-- EXT-01D：真实支付退款单，退款申请与租金资金退款事实分离。
CREATE TABLE `rental_payment_refunds` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `paymentIntentId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `method` VARCHAR(24) NOT NULL,
    `amount` DECIMAL(12,2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL,
    `merchantRefundNo` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `idempotencyHash` CHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `externalRefundId` VARCHAR(191) NULL,
    `externalStatus` VARCHAR(40) NULL,
    `responseJson` JSON NULL,
    `reason` VARCHAR(500) NOT NULL,
    `requestedBy` VARCHAR(191) NULL,
    `failureReason` VARCHAR(500) NULL,
    `acceptedAt` DATETIME(3) NULL,
    `succeededAt` DATETIME(3) NULL,
    `fundedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `rental_payment_refunds_merchant_no_key` (`merchantRefundNo`),
    UNIQUE INDEX `rental_payment_refunds_intent_idem_key` (`paymentIntentId`, `idempotencyHash`),
    INDEX `rental_payment_refunds_order_status_idx` (`tenantId`, `workspaceId`, `orderId`, `status`),
    INDEX `rental_payment_refunds_provider_status_idx` (`tenantId`, `provider`, `status`, `updatedAt`),
    CONSTRAINT `rental_payment_refunds_tenantId_fkey`
      FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `rental_payment_refunds_tenantId_workspaceId_fkey`
      FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `rental_payment_refunds_tenantId_workspaceId_orderId_fkey`
      FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `rental_payment_refunds_paymentIntentId_fkey`
      FOREIGN KEY (`paymentIntentId`) REFERENCES `rental_payment_intents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
