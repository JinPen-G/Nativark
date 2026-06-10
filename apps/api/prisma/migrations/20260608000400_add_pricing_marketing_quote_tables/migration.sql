-- CreateTable
CREATE TABLE `PriceAdjustmentSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `pricingPlanId` VARCHAR(191) NULL,
    `planName` VARCHAR(191) NOT NULL,
    `effectiveAt` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `summary` VARCHAR(191) NOT NULL,
    `changes` JSON NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `executedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,

    INDEX `PriceAdjustmentSchedule_tenantId_status_effectiveAt_idx`(`tenantId`, `status`, `effectiveAt`),
    INDEX `PriceAdjustmentSchedule_pricingPlanId_status_idx`(`pricingPlanId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingPlan` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `currentVersionNo` INTEGER NOT NULL DEFAULT 1,
    `customerScope` VARCHAR(191) NOT NULL,
    `supportedModes` JSON NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NOT NULL,
    `storeCodes` JSON NOT NULL,
    `vehicleGroupCodes` JSON NOT NULL,
    `manualVerification` BOOLEAN NOT NULL DEFAULT false,
    `qualificationName` VARCHAR(191) NULL,
    `requiredDocText` VARCHAR(191) NULL,
    `weekdayRate` DECIMAL(6, 4) NOT NULL DEFAULT 1,
    `holidayRate` DECIMAL(6, 4) NOT NULL DEFAULT 1,
    `fixedDeductionAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `description` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MarketingPlan_tenantId_status_effectiveFrom_effectiveTo_idx`(`tenantId`, `status`, `effectiveFrom`, `effectiveTo`),
    INDEX `MarketingPlan_tenantId_customerScope_priority_idx`(`tenantId`, `customerScope`, `priority`),
    UNIQUE INDEX `MarketingPlan_tenantId_code_key`(`tenantId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingPlanVersion` (
    `id` VARCHAR(191) NOT NULL,
    `marketingPlanId` VARCHAR(191) NOT NULL,
    `versionNo` INTEGER NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `content` JSON NOT NULL,
    `savedBy` VARCHAR(191) NULL,
    `changeReason` VARCHAR(191) NULL,
    `savedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MarketingPlanVersion_marketingPlanId_savedAt_idx`(`marketingPlanId`, `savedAt`),
    UNIQUE INDEX `MarketingPlanVersion_marketingPlanId_versionNo_key`(`marketingPlanId`, `versionNo`),
    UNIQUE INDEX `MarketingPlanVersion_versionId_key`(`versionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketingRuleLine` (
    `id` VARCHAR(191) NOT NULL,
    `marketingPlanVersionId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `vehicleGroupCodes` JSON NOT NULL,
    `membershipLevels` JSON NOT NULL,
    `minBillableDays` INTEGER NULL,
    `bookingLeadDays` INTEGER NULL,
    `weekdayAction` JSON NOT NULL,
    `holidayAction` JSON NOT NULL,
    `statutoryHolidayAction` JSON NULL,
    `maxDeductionAmount` DECIMAL(12, 2) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,

    INDEX `MarketingRuleLine_marketingPlanVersionId_priority_idx`(`marketingPlanVersionId`, `priority`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PricingQuoteSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `quoteNo` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `requestSnapshot` JSON NOT NULL,
    `pricingSnapshot` JSON NOT NULL,
    `marketingSnapshot` JSON NULL,
    `explanation` JSON NOT NULL,
    `payableAmount` DECIMAL(12, 2) NOT NULL,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PricingQuoteSnapshot_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    INDEX `PricingQuoteSnapshot_tenantId_orderId_idx`(`tenantId`, `orderId`),
    UNIQUE INDEX `PricingQuoteSnapshot_tenantId_quoteNo_key`(`tenantId`, `quoteNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PriceAdjustmentSchedule` ADD CONSTRAINT `PriceAdjustmentSchedule_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PriceAdjustmentSchedule` ADD CONSTRAINT `PriceAdjustmentSchedule_pricingPlanId_fkey` FOREIGN KEY (`pricingPlanId`) REFERENCES `PricingPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingPlan` ADD CONSTRAINT `MarketingPlan_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingPlanVersion` ADD CONSTRAINT `MarketingPlanVersion_marketingPlanId_fkey` FOREIGN KEY (`marketingPlanId`) REFERENCES `MarketingPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketingRuleLine` ADD CONSTRAINT `MarketingRuleLine_marketingPlanVersionId_fkey` FOREIGN KEY (`marketingPlanVersionId`) REFERENCES `MarketingPlanVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PricingQuoteSnapshot` ADD CONSTRAINT `PricingQuoteSnapshot_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PricingQuoteSnapshot` ADD CONSTRAINT `PricingQuoteSnapshot_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `StoreRentalOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
