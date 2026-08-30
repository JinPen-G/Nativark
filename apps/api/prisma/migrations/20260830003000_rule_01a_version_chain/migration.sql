-- RULE-01A：规则版本链、生效时点与发布审计（需求 4.6.1、4.6.14）。
--
-- 一、五态版本链与生效时点
--   需求 4.6.1 的状态是「草稿、待生效、已生效、已被替代、已作废」，而此前只有
--   draft/published/retired 三态，且**没有生效时点**——规则靠「唯一一条 published」
--   匹配，与需求「按租期开始时间匹配，未来租期使用覆盖其开始时点的已发布规则」不符。
--   `effectiveFrom` 可空：存量行没有这个事实，回填时按 publishedAt 或 createdAt 兜底
--   （见下方 UPDATE），这两个时刻是该版本实际开始被使用的时刻，不是凭空编的。
--   `status` 的取值迁移：published → published（已生效）、retired → superseded（已被替代），
--   draft 不变。retired 与 superseded 语义一致（被新版本取代），因此可以直接改名。
--
-- 二、发布审计
--   需求 4.6.14 要求「发布规则、人工覆盖……必须填写原因并记录完整审计」。
--   独立只追加表：把审计挂在版本行上只能留最后一次操作，恢复与作废的历史会被覆盖。
--
-- 安全性：只 AddColumn / CreateTable / CreateIndex 与一次**状态改名**的 UPDATE，
-- 无 DROP/TRUNCATE/DELETE。UPDATE 只改 status 与回填 effectiveFrom，不动 config。

ALTER TABLE `rental_rule_versions` ADD COLUMN `effectiveFrom` DATETIME(3) NULL;
ALTER TABLE `rental_rule_versions` ADD COLUMN `publishedBy` VARCHAR(191) NULL;
ALTER TABLE `rental_rule_versions` ADD COLUMN `supersededAt` DATETIME(3) NULL;
ALTER TABLE `rental_rule_versions` ADD COLUMN `previousVersion` VARCHAR(191) NULL;
ALTER TABLE `rental_rule_versions` ADD COLUMN `restoredFromVersion` VARCHAR(191) NULL;
ALTER TABLE `rental_rule_versions` ADD COLUMN `restoreReason` VARCHAR(191) NULL;
ALTER TABLE `rental_rule_versions` ADD COLUMN `voidedAt` DATETIME(3) NULL;
ALTER TABLE `rental_rule_versions` ADD COLUMN `voidedBy` VARCHAR(191) NULL;
ALTER TABLE `rental_rule_versions` ADD COLUMN `voidReason` VARCHAR(191) NULL;

-- 回填生效时点：已发布版本取 publishedAt，其余取 createdAt。两者都是该版本
-- 实际开始被使用的时刻，因此不是猜测；缺了它，按租期开始时点匹配无从进行。
UPDATE `rental_rule_versions`
SET `effectiveFrom` = COALESCE(`publishedAt`, `createdAt`)
WHERE `effectiveFrom` IS NULL;

-- 状态改名：retired 与需求的「已被替代」同义，直接对齐命名，避免两套词汇并存。
UPDATE `rental_rule_versions` SET `status` = 'superseded' WHERE `status` = 'retired';

CREATE INDEX `rental_rule_versions_effective_idx`
  ON `rental_rule_versions`(`workspaceId`, `status`, `effectiveFrom`);

-- 规则版本审计（只追加）。发布、恢复、作废各记一条，含原因、操作者与前后状态。
CREATE TABLE `rental_rule_version_audits` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `ruleVersionId` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `operator` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_rule_version_audits_scope_idx`(`tenantId`, `workspaceId`, `at`),
    INDEX `rental_rule_version_audits_version_idx`(`ruleVersionId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rental_rule_version_audits`
  ADD CONSTRAINT `rental_rule_version_audits_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_rule_version_audits_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `rental_rule_version_audits_ruleVersionId_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `rental_rule_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
