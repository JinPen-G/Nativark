-- PRICE-03：不可变价格版本（空间级）与调价计划（需求 4.4.3，Codex 复审 P1-2/P1-4）。
--
-- 价格版本：某一生效时点、**当前经营空间全部有效商品价格**的完整、不可变结果
-- （跨计划聚合的"商品 × 计价单位"全集）；每次调价追加新行，旧版本永久保留。
-- 调价计划：只保存差异；确认（立即/定时）时基于基础版本生成完整新版本。
--
-- 回填：每个有价格计划的经营空间生成 v1（rates = 该空间全部**启用中**计划费率的并集，
-- effectiveFrom = 最早计划生效时刻）。用 JSON_TABLE + JSON_ARRAYAGG 聚合，
-- 不做字符串切片——详见下方回填语句的说明。
-- 报价/订单：补 priceVersionId/priceVersion 两列（可空不回填——存量报价没有
-- 此事实，编一个是猜测）。
--
-- 安全性：只 CreateTable/AddColumn/回填 INSERT，无 DROP/TRUNCATE/DELETE；
-- 回填可重复执行（按 (workspaceId, sequence=1) 幂等判重）。

CREATE TABLE `rental_price_versions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `sequence` INT NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `rates` JSON NOT NULL,
    `changeReason` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `rental_price_versions_workspaceId_sequence_key`(`workspaceId`, `sequence`),
    INDEX `rental_price_versions_workspaceId_effectiveFrom_idx`(`workspaceId`, `effectiveFrom`),
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
    `baseVersionId` VARCHAR(191) NULL,
    `finalRates` JSON NULL,
    `cancelReason` VARCHAR(191) NULL,
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
  ADD CONSTRAINT `rental_price_versions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `rental_price_adjustment_plans`
  ADD CONSTRAINT `rental_price_adjustment_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_price_adjustment_plans_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_price_adjustment_plans_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `rental_pricing_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `rental_quotes` ADD COLUMN `priceVersionId` VARCHAR(191) NULL;
ALTER TABLE `rental_quotes` ADD COLUMN `priceVersion` VARCHAR(191) NULL;
ALTER TABLE `rental_orders` ADD COLUMN `priceVersionId` VARCHAR(191) NULL;
ALTER TABLE `rental_orders` ADD COLUMN `priceVersion` VARCHAR(191) NULL;

-- 回填：每个有**启用中**价格计划的空间生成一条 v1 完整版本。
--
-- 用 JSON_TABLE 把每个计划的 rates 数组摊平成行，再 JSON_ARRAYAGG 聚成空间全集。
-- 不用 `CONCAT + GROUP_CONCAT + SUBSTRING(rates, 2, LENGTH(rates)-2)` 拼字符串：
-- LENGTH 返回**字节数**而 SUBSTRING 按**字符**截取，rates 里含中文（商品名、单位说明）
-- 时会少截掉尾部的 `]`，拼出 `[{...}]]` 这种「根后面还有值」的非法 JSON——
-- 本迁移此前就是在这一句上失败的（MySQL 3140）。JSON_ARRAYAGG 同时免掉
-- group_concat_max_len 截断风险。
--
-- 只取 status='enabled'：草稿与停用计划不参与报价，把它们的费率写进"全部有效价格"
-- 会造出报价取不到、但版本里存在的幽灵价格。
--
-- 幂等：已存在 sequence=1 的空间跳过，重复执行不再撞 (workspaceId, sequence) 唯一键。
INSERT INTO `rental_price_versions`
  (`id`, `tenantId`, `workspaceId`, `sequence`, `effectiveFrom`, `rates`, `changeReason`, `createdBy`)
SELECT
  UUID(),
  f.`tenantId`,
  f.`workspaceId`,
  1,
  MIN(f.`effectiveFrom`),
  JSON_ARRAYAGG(f.`rate`),
  'PRICE-03 存量版本回填',
  NULL
FROM (
  SELECT p.`tenantId`, p.`workspaceId`, p.`effectiveFrom`, jt.`rate`
  FROM `rental_pricing_plans` p
  JOIN JSON_TABLE(p.`rates`, '$[*]' COLUMNS (`rate` JSON PATH '$')) jt
  WHERE p.`status` = 'enabled'
    AND NOT EXISTS (
      SELECT 1 FROM `rental_price_versions` v
      WHERE v.`tenantId` = p.`tenantId` AND v.`workspaceId` = p.`workspaceId` AND v.`sequence` = 1
    )
) f
GROUP BY f.`tenantId`, f.`workspaceId`;
