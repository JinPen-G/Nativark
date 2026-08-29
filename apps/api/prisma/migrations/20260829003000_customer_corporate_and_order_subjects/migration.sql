-- CUSTOMER-01C：企业开票/合同/授信账期，以及订单的四类主体。
--
-- 建模要点（需求 4.8.4）：
--   * 开票资料、合同与授信各自成表，不平铺进企业资料：一家企业可以同时持有多份
--     开票资料与多份有效合同，平铺就只能存最后一份、覆盖掉历史；而订单引用的是
--     「下单当时生效的那一份」，必须能各自留存起止与状态。
--   * 订单四类主体（签约/付款/使用人/经办人）各存一个可索引的 id 列，
--     另加一份 subjectSnapshot 快照。id 列服务于按角色反查（01D 的合并与注销要用）；
--     快照保存下单当时的名称、脱敏证件与授权范围——主体改名或授权到期都不得篡改历史订单。
--   * 授信**只存事实，不接进定价链**。额度占用与释放需要与订单、支付、退款联动，
--     属后续任务；本阶段不在没有联动设计的前提下改动金额链路。
--
-- 安全性：只 CREATE TABLE / ADD COLUMN / CREATE INDEX / ADD CONSTRAINT。
-- 无 DROP/TRUNCATE/DELETE。订单新增五列全部可空，存量订单无需回填——
-- 读取侧对空值回落到 customerId 作为签约/付款/使用人三个主体。

-- AlterTable
ALTER TABLE `rental_orders` ADD COLUMN `agentId` VARCHAR(191) NULL,
    ADD COLUMN `contractSubjectCustomerId` VARCHAR(191) NULL,
    ADD COLUMN `payerSubjectCustomerId` VARCHAR(191) NULL,
    ADD COLUMN `subjectSnapshot` JSON NULL,
    ADD COLUMN `userSubjectCustomerId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `customer_corporate_invoice_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `invoiceType` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `taxNo` VARCHAR(191) NOT NULL,
    `registeredAddress` VARCHAR(191) NULL,
    `bankName` VARCHAR(191) NULL,
    `bankAccountMasked` VARCHAR(191) NULL,
    `contactPhoneMasked` VARCHAR(191) NULL,
    `receiveEmail` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `defaultMarker` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_invoice_profiles_tenant_customer_idx`(`tenantId`, `customerId`),
    UNIQUE INDEX `customer_invoice_profiles_default_key`(`tenantId`, `customerId`, `defaultMarker`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_corporate_contracts` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `contractNo` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `signedAt` DATETIME(3) NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `fileRef` VARCHAR(191) NULL,
    `terminatedReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_contracts_customer_status_idx`(`tenantId`, `customerId`, `status`),
    UNIQUE INDEX `customer_contracts_tenant_no_key`(`tenantId`, `contractNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_corporate_credits` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `creditLimit` DECIMAL(12, 2) NOT NULL,
    `settlementTermDays` INTEGER NOT NULL DEFAULT 0,
    `billingCycle` VARCHAR(191) NOT NULL DEFAULT 'monthly',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `approvedBy` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_credits_tenant_customer_key`(`tenantId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `rental_orders_contract_subject_idx` ON `rental_orders`(`tenantId`, `contractSubjectCustomerId`);

-- CreateIndex
CREATE INDEX `rental_orders_payer_subject_idx` ON `rental_orders`(`tenantId`, `payerSubjectCustomerId`);

-- CreateIndex
CREATE INDEX `rental_orders_user_subject_idx` ON `rental_orders`(`tenantId`, `userSubjectCustomerId`);

-- AddForeignKey
ALTER TABLE `customer_corporate_invoice_profiles` ADD CONSTRAINT `customer_corporate_invoice_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_invoice_profiles` ADD CONSTRAINT `customer_corporate_invoice_profiles_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_contracts` ADD CONSTRAINT `customer_corporate_contracts_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_contracts` ADD CONSTRAINT `customer_corporate_contracts_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_credits` ADD CONSTRAINT `customer_corporate_credits_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_credits` ADD CONSTRAINT `customer_corporate_credits_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
