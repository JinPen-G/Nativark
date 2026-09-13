-- EXT-01D：支付宝/微信支付意图、回调幂等与租金资金入账事实。
CREATE TABLE `rental_payment_intents` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `instrument` VARCHAR(24) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `method` VARCHAR(24) NOT NULL,
    `amount` DECIMAL(12,2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `merchantOrderNo` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `idempotencyHash` CHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `checkoutUrl` TEXT NULL,
    `externalTransactionId` VARCHAR(191) NULL,
    `responseJson` JSON NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `rental_payment_intents_merchant_order_no_key` (`merchantOrderNo`),
    UNIQUE INDEX `rental_payment_intents_scope_idem_key` (`tenantId`, `workspaceId`, `orderId`, `instrument`, `idempotencyHash`),
    INDEX `rental_payment_intents_provider_status_idx` (`tenantId`, `provider`, `status`),
    INDEX `rental_payment_intents_order_status_idx` (`tenantId`, `workspaceId`, `orderId`, `status`),
    CONSTRAINT `rental_payment_intents_tenantId_fkey`
      FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `rental_payment_intents_tenantId_workspaceId_fkey`
      FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `rental_payment_intents_orderId_fkey`
      FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payment_webhook_events` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `paymentIntentId` VARCHAR(191) NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `errorMessage` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,
    PRIMARY KEY (`id`),
    UNIQUE INDEX `payment_webhook_events_provider_event_key` (`provider`, `eventId`),
    INDEX `payment_webhook_events_scope_created_idx` (`tenantId`, `provider`, `createdAt`),
    CONSTRAINT `payment_webhook_events_tenantId_fkey`
      FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
