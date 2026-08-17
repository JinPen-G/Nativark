-- RC-01：Rental Core 规范化业务事实表
--
-- 背景：Rental Core 的业务事实此前只存在于 rental_core_state_snapshots /
-- rental_business_state_snapshots 两张表的整租户 JSON 聚合里。本迁移建立规范化事实表，
-- 使 MySQL 成为业务事实源，聚合快照降级为恢复副本（快照表保留，不删）。
--
-- 无破坏性语句：本迁移只有 CreateTable / AddColumn / AddForeignKey / CreateIndex，
-- 没有 DROP TABLE、DROP COLUMN、TRUNCATE 或 DELETE，不丢弃任何既有数据。
--
-- 关于 rental_orders 与 rental_order_lines 上新增的 NOT NULL 列：
-- 这两张表由 20260813000100_add_rental_core_v1 建立，但从未被任何代码写入
-- （全仓 grep prisma.rentalOrder / rentalOrderLine 零命中），因此在所有环境中均为空表，
-- 加 NOT NULL 列不需要默认值。若某环境确实存在历史行，本迁移会明确失败而不是
-- 用猜测的默认值静默回填——这是有意的，避免污染金额与快照字段。
--
-- 历史 JSON 快照中的既有事实由应用层 RentalSnapshotBackfillService 幂等回填，
-- 不在本 SQL 内用 JSON_TABLE 处理：订单→行→预占→分配的嵌套在纯 SQL 里易错且难测。

-- AlterTable
ALTER TABLE `rental_allocations` ADD COLUMN `assetNo` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `rental_fulfillment_locations` ADD COLUMN `operatorId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `rental_order_lines` ADD COLUMN `itemGroupCode` VARCHAR(191) NOT NULL,
    ADD COLUMN `itemGroupName` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `rental_orders` ADD COLUMN `adjustmentAmount` DECIMAL(12, 2) NOT NULL,
    ADD COLUMN `calendarVersion` VARCHAR(191) NULL,
    ADD COLUMN `cancellationReason` VARCHAR(191) NULL,
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `chargeLines` JSON NOT NULL,
    ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD COLUMN `couponAmount` DECIMAL(12, 2) NOT NULL,
    ADD COLUMN `depositAmount` DECIMAL(12, 2) NOT NULL,
    ADD COLUMN `discountAmount` DECIMAL(12, 2) NOT NULL,
    ADD COLUMN `finalPayableAmount` DECIMAL(12, 2) NOT NULL,
    ADD COLUMN `fulfillmentLocationName` VARCHAR(191) NOT NULL,
    ADD COLUMN `fulfillmentMode` VARCHAR(191) NOT NULL,
    ADD COLUMN `payableAmount` DECIMAL(12, 2) NOT NULL,
    ADD COLUMN `pricingPlanVersion` VARCHAR(191) NOT NULL,
    ADD COLUMN `quoteId` VARCHAR(191) NOT NULL,
    ADD COLUMN `quoteNo` VARCHAR(191) NOT NULL,
    ADD COLUMN `rentalAmount` DECIMAL(12, 2) NOT NULL,
    ADD COLUMN `returnLocationId` VARCHAR(191) NULL,
    ADD COLUMN `returnLocationName` VARCHAR(191) NULL,
    ADD COLUMN `ruleSnapshot` JSON NOT NULL,
    ADD COLUMN `ruleVersion` VARCHAR(191) NOT NULL,
    ADD COLUMN `serviceAmount` DECIMAL(12, 2) NOT NULL;

-- CreateTable
CREATE TABLE `rental_fulfillment_operators` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `contactName` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `settlementMode` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_fulfillment_operators_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `rental_fulfillment_operators_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_tenant_business_settings` (
    `tenantId` VARCHAR(191) NOT NULL,
    `categoryCode` ENUM('vehicle', 'camera', 'camping', 'construction') NOT NULL,
    `configVersion` VARCHAR(191) NOT NULL,
    `settings` JSON NOT NULL,
    `updatedBy` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_pricing_plans` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `categoryCode` ENUM('vehicle', 'camera', 'camping', 'construction') NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'CNY',
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `version` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `rates` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_pricing_plans_tenant_status_effective_idx`(`tenantId`, `status`, `effectiveFrom`, `effectiveTo`),
    UNIQUE INDEX `rental_pricing_plans_tenant_code_version_key`(`tenantId`, `code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_discount_plans` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `categoryCode` ENUM('vehicle', 'camera', 'camping', 'construction') NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `discountType` VARCHAR(191) NOT NULL,
    `discountValue` DECIMAL(12, 2) NOT NULL,
    `minimumSpend` DECIMAL(12, 2) NOT NULL,
    `maximumDiscount` DECIMAL(12, 2) NULL,
    `customerScope` VARCHAR(191) NOT NULL DEFAULT 'all',
    `applicableItemGroupIds` JSON NOT NULL,
    `applicableDayTypes` JSON NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `stackableWithCoupon` BOOLEAN NOT NULL DEFAULT true,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `version` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_discount_plans_tenant_status_priority_idx`(`tenantId`, `status`, `priority`),
    UNIQUE INDEX `rental_discount_plans_tenant_code_version_key`(`tenantId`, `code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_value_added_services` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `categoryCode` ENUM('vehicle', 'camera', 'camping', 'construction') NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `serviceType` VARCHAR(191) NOT NULL,
    `billingUnit` VARCHAR(191) NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `maximumQuantity` INTEGER NOT NULL DEFAULT 1,
    `coverageLimit` DECIMAL(12, 2) NULL,
    `deductible` DECIMAL(12, 2) NULL,
    `termsVersion` VARCHAR(191) NOT NULL,
    `terms` TEXT NOT NULL,
    `applicableItemGroupIds` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `version` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_value_added_services_tenant_status_type_idx`(`tenantId`, `status`, `serviceType`),
    UNIQUE INDEX `rental_value_added_services_tenant_code_version_key`(`tenantId`, `code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_rule_versions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `categoryCode` ENUM('vehicle', 'camera', 'camping', 'construction') NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `config` JSON NOT NULL,
    `changeReason` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishedAt` DATETIME(3) NULL,

    INDEX `rental_rule_versions_tenant_status_published_idx`(`tenantId`, `status`, `publishedAt`),
    UNIQUE INDEX `rental_rule_versions_tenant_version_key`(`tenantId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_business_calendars` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `region` VARCHAR(191) NOT NULL DEFAULT 'CN',
    `version` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `sourceName` VARCHAR(191) NULL,
    `sourceUrl` VARCHAR(191) NULL,
    `sourcePublishedAt` DATETIME(3) NULL,
    `importedAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `days` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_business_calendars_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `rental_business_calendars_tenant_year_key`(`tenantId`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_notification_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `eventCode` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `variableSchema` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `version` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_notification_templates_tenant_status_event_idx`(`tenantId`, `status`, `eventCode`),
    UNIQUE INDEX `rental_notification_templates_tenant_event_channel_ver_key`(`tenantId`, `eventCode`, `channel`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_quotes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `quoteNo` VARCHAR(191) NOT NULL,
    `categoryCode` ENUM('vehicle', 'camera', 'camping', 'construction') NOT NULL,
    `request` JSON NOT NULL,
    `chargeLines` JSON NOT NULL,
    `rentalAmount` DECIMAL(12, 2) NOT NULL,
    `discountAmount` DECIMAL(12, 2) NOT NULL,
    `couponAmount` DECIMAL(12, 2) NOT NULL,
    `serviceAmount` DECIMAL(12, 2) NOT NULL,
    `depositAmount` DECIMAL(12, 2) NOT NULL,
    `payableAmount` DECIMAL(12, 2) NOT NULL,
    `pricingPlanVersion` VARCHAR(191) NOT NULL,
    `ruleVersion` VARCHAR(191) NOT NULL,
    `ruleSnapshot` JSON NOT NULL,
    `calendarVersion` VARCHAR(191) NULL,
    `appliedDiscountPlanIds` JSON NOT NULL,
    `customerCouponId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `consumedOrderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_quotes_tenant_expires_consumed_idx`(`tenantId`, `expiresAt`, `consumedAt`),
    INDEX `rental_quotes_consumedOrderId_idx`(`consumedOrderId`),
    UNIQUE INDEX `rental_quotes_tenant_quote_no_key`(`tenantId`, `quoteNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_customer_coupons` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `templateCode` VARCHAR(191) NOT NULL,
    `templateName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'claimed',
    `claimedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NOT NULL,
    `lockedOrderId` VARCHAR(191) NULL,
    `lockedAt` DATETIME(3) NULL,
    `redeemedOrderId` VARCHAR(191) NULL,
    `redeemedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,

    INDEX `rental_customer_coupons_tenant_customer_status_idx`(`tenantId`, `customerId`, `status`),
    INDEX `rental_customer_coupons_tenant_template_customer_idx`(`tenantId`, `templateId`, `customerId`),
    INDEX `rental_customer_coupons_lockedOrderId_idx`(`lockedOrderId`),
    INDEX `rental_customer_coupons_redeemedOrderId_idx`(`redeemedOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_reward_ledger_entries` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `rewardType` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `triggerType` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `relatedCustomerId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'granted',
    `reason` VARCHAR(191) NOT NULL,
    `benefitReferenceIds` JSON NULL,
    `appliedAt` DATETIME(3) NULL,
    `reversedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_reward_ledger_tenant_customer_created_idx`(`tenantId`, `customerId`, `createdAt`),
    INDEX `rental_reward_ledger_tenant_trigger_status_idx`(`tenantId`, `triggerType`, `status`),
    UNIQUE INDEX `rental_reward_ledger_tenant_idempotency_key`(`tenantId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_benefit_accounts` (
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `pointsBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `marketingBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `availableRewardCouponCount` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `customerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_referrals` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `inviteeCustomerId` VARCHAR(191) NOT NULL,
    `referrerCustomerId` VARCHAR(191) NOT NULL,
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_referrals_tenant_referrer_idx`(`tenantId`, `referrerCustomerId`),
    UNIQUE INDEX `rental_referrals_tenant_invitee_key`(`tenantId`, `inviteeCustomerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_notification_logs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `templateVersion` VARCHAR(191) NOT NULL,
    `eventCode` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `renderedTitle` VARCHAR(191) NOT NULL,
    `renderedBody` TEXT NOT NULL,
    `variables` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `provider` VARCHAR(191) NOT NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `errorMessage` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_notification_logs_tenant_event_created_idx`(`tenantId`, `eventCode`, `createdAt`),
    INDEX `rental_notification_logs_tenant_status_created_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `rental_notification_logs_templateId_idx`(`templateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `rental_fulfillment_locations_operatorId_idx` ON `rental_fulfillment_locations`(`operatorId`);

-- CreateIndex
CREATE INDEX `rental_orders_tenantId_quoteId_idx` ON `rental_orders`(`tenantId`, `quoteId`);

-- AddForeignKey
ALTER TABLE `rental_fulfillment_locations` ADD CONSTRAINT `rental_fulfillment_locations_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `rental_fulfillment_operators`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_fulfillment_operators` ADD CONSTRAINT `rental_fulfillment_operators_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_tenant_business_settings` ADD CONSTRAINT `rental_tenant_business_settings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_plans` ADD CONSTRAINT `rental_pricing_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_discount_plans` ADD CONSTRAINT `rental_discount_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_value_added_services` ADD CONSTRAINT `rental_value_added_services_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_rule_versions` ADD CONSTRAINT `rental_rule_versions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_business_calendars` ADD CONSTRAINT `rental_business_calendars_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_templates` ADD CONSTRAINT `rental_notification_templates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_quotes` ADD CONSTRAINT `rental_quotes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_customer_coupons` ADD CONSTRAINT `rental_customer_coupons_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_customer_coupons` ADD CONSTRAINT `rental_customer_coupons_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `rental_coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_reward_ledger_entries` ADD CONSTRAINT `rental_reward_ledger_entries_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_benefit_accounts` ADD CONSTRAINT `rental_benefit_accounts_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_referrals` ADD CONSTRAINT `rental_referrals_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_logs` ADD CONSTRAINT `rental_notification_logs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_logs` ADD CONSTRAINT `rental_notification_logs_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `rental_notification_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

