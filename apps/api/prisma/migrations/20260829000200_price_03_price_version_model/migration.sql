-- PRICE-03：不可变价格版本与调价计划（需求 4.4.3）。
--
-- 价格版本：某一生效时点、价格计划全部有效商品价格的完整不可变结果；
-- 每次调价追加新行，旧版本永久保留，历史报价按版本复算。
-- 调价计划：只保存差异（op + 受影响行），确认/到期时生成完整新版本。
--
-- 回填策略：不回填——存量计划行由应用层在首次读取时惰性生成 v1
-- （ensurePriceVersion，幂等），迁移阶段零数据风险。
--
-- 安全性：只 CreateTable，无 DROP/TRUNCATE/DELETE。

CREATE TABLE `rental_price_versions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `rates` JSON NOT NULL,
    `changeReason` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rental_price_versions_planId_version_key`(`planId`, `version`),
    INDEX `rental_price_versions_planId_effectiveFrom_idx`(`planId`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `rental_price_adjustment_plans` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `changes` JSON NOT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `resultVersionId` VARCHAR(191) NULL,
    `changeReason` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `confirmedBy` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rental_price_adjustment_plans_workspaceId_code_key`(`workspaceId`, `code`),
    INDEX `rental_price_adjustment_plans_planId_status_scheduledAt_idx`(`planId`, `status`, `scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rental_price_versions`
  ADD CONSTRAINT `rental_price_versions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_price_versions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_price_versions_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `rental_pricing_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `rental_price_adjustment_plans`
  ADD CONSTRAINT `rental_price_adjustment_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_price_adjustment_plans_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_price_adjustment_plans_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `rental_pricing_plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
