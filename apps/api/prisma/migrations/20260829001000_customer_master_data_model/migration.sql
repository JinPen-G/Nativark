-- CUSTOMER-01A：客户主档数据模型（租户级身份 + 空间级会员关系）。
--
-- 建模边界（需求 4.8.1 / 4.8.4 / 4.8.5 / 4.8.6 / 4.8.3）：
--   * 客户主档回答「客户是谁」，客户账号回答「客户如何登录」，空间会员关系回答
--     「客户在某空间有什么资格」。三者分开建模：停用账号阻止登录全部空间，
--     而暂停某个空间的会员关系不影响登录与其他空间业务。共用一个状态字段做不到这一点。
--   * 个人与企业共用统一客户框架但资料结构分开：企业专属字段（统一社会信用代码、
--     法人、注册地址）落在 customer_corporate_profiles，避免个人客户带一堆恒空列。
--   * 联系人与经办人是两回事：联系人只用于联系；经办人被授权代办业务，
--     因此带授权范围与有效期——没有有效期的授权事后无法判断当时是否有效。
--   * 状态历史只追加。解除限制同样是一条独立记录，不回改、不删除原限制事实。
--   * 资质引用只存原始事实与脱敏号码，**不**存「是否适用于某空间」的结论——
--     那属 SHARED-QUAL-01，本迁移不越界。
--   * 合并映射两侧都用 (tenantId, customerId) 复合外键指向主档，
--     这是「禁止跨租户合并」的**库层**保证，而非只靠服务层判断。
--
-- 安全性：只 CREATE TABLE / ADD COLUMN / CREATE INDEX / ADD CONSTRAINT。
-- 无 DROP、TRUNCATE、DELETE，不改任何既有列的类型或约束，既有数据不受影响。
-- 新增列全部可空或带默认值，因此存量 customer_profiles 与 customer_workspace_links
-- 行不需要回填即可继续使用（status 沿用既有 active）。

-- AlterTable
ALTER TABLE `customer_profiles` ADD COLUMN `mergedIntoCustomerId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `customer_workspace_links` ADD COLUMN `closedAt` DATETIME(3) NULL,
    ADD COLUMN `exitedAt` DATETIME(3) NULL,
    ADD COLUMN `restrictedAt` DATETIME(3) NULL,
    ADD COLUMN `suspendedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `customer_accounts` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `loginPhone` VARCHAR(191) NOT NULL,
    `loginPhoneMasked` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `suspendedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `lastReason` TEXT NULL,
    `lastOperator` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_accounts_tenant_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `customer_accounts_tenant_customer_key`(`tenantId`, `customerId`),
    UNIQUE INDEX `customer_accounts_tenant_login_key`(`tenantId`, `loginPhone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_corporate_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `legalName` VARCHAR(191) NOT NULL,
    `unifiedSocialCreditCode` VARCHAR(191) NOT NULL,
    `unifiedSocialCreditCodeMasked` VARCHAR(191) NOT NULL,
    `registeredAddress` VARCHAR(191) NULL,
    `legalRepName` VARCHAR(191) NULL,
    `legalRepPhoneMasked` VARCHAR(191) NULL,
    `industry` VARCHAR(191) NULL,
    `scale` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_corporate_profiles_tenant_customer_key`(`tenantId`, `customerId`),
    UNIQUE INDEX `customer_corporate_profiles_tenant_uscc_key`(`tenantId`, `unifiedSocialCreditCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_contacts` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `phoneMasked` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `relation` VARCHAR(191) NULL,
    `linkedCustomerId` VARCHAR(191) NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_contacts_tenant_customer_idx`(`tenantId`, `customerId`),
    INDEX `customer_contacts_tenant_phone_idx`(`tenantId`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_authorized_agents` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `agentName` VARCHAR(191) NOT NULL,
    `agentPhone` VARCHAR(191) NOT NULL,
    `agentPhoneMasked` VARCHAR(191) NOT NULL,
    `agentIdNoMasked` VARCHAR(191) NULL,
    `authorityScope` JSON NOT NULL,
    `validFrom` DATETIME(3) NOT NULL,
    `validTo` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `evidenceRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_agents_tenant_customer_idx`(`tenantId`, `customerId`),
    INDEX `customer_agents_tenant_phone_idx`(`tenantId`, `agentPhone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_status_history` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `scope` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `operator` VARCHAR(191) NULL,
    `approver` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_status_history_customer_at_idx`(`tenantId`, `customerId`, `at`),
    INDEX `customer_status_history_ws_at_idx`(`tenantId`, `workspaceId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_risk_records` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NULL,
    `riskType` VARCHAR(191) NOT NULL,
    `level` VARCHAR(191) NOT NULL,
    `detail` TEXT NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `raisedBy` VARCHAR(191) NULL,
    `raisedAt` DATETIME(3) NOT NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `closeReason` TEXT NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_risk_customer_status_idx`(`tenantId`, `customerId`, `status`),
    INDEX `customer_risk_ws_status_idx`(`tenantId`, `workspaceId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_qualification_refs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `qualificationType` VARCHAR(191) NOT NULL,
    `referenceNoMasked` VARCHAR(191) NULL,
    `issuedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'not_submitted',
    `evidenceRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_qualification_refs_tenant_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `customer_qualification_refs_unique_type_key`(`tenantId`, `customerId`, `qualificationType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_merge_mappings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `sourceCustomerId` VARCHAR(191) NOT NULL,
    `targetCustomerId` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `operator` VARCHAR(191) NULL,
    `approver` VARCHAR(191) NULL,
    `fieldDiff` JSON NULL,
    `membershipSnapshot` JSON NULL,
    `mergedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_merge_mappings_target_idx`(`tenantId`, `targetCustomerId`),
    UNIQUE INDEX `customer_merge_mappings_source_key`(`tenantId`, `sourceCustomerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `customer_workspace_links_ws_status_idx` ON `customer_workspace_links`(`tenantId`, `workspaceId`, `status`);

-- AddForeignKey
ALTER TABLE `customer_accounts` ADD CONSTRAINT `customer_accounts_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_accounts` ADD CONSTRAINT `customer_accounts_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_profiles` ADD CONSTRAINT `customer_corporate_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_profiles` ADD CONSTRAINT `customer_corporate_profiles_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_contacts` ADD CONSTRAINT `customer_contacts_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_contacts` ADD CONSTRAINT `customer_contacts_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_authorized_agents` ADD CONSTRAINT `customer_authorized_agents_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_authorized_agents` ADD CONSTRAINT `customer_authorized_agents_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_status_history` ADD CONSTRAINT `customer_status_history_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_status_history` ADD CONSTRAINT `customer_status_history_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_risk_records` ADD CONSTRAINT `customer_risk_records_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_risk_records` ADD CONSTRAINT `customer_risk_records_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_qualification_refs` ADD CONSTRAINT `customer_qualification_refs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_qualification_refs` ADD CONSTRAINT `customer_qualification_refs_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_merge_mappings` ADD CONSTRAINT `customer_merge_mappings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_merge_mappings` ADD CONSTRAINT `customer_merge_mappings_tenantId_sourceCustomerId_fkey` FOREIGN KEY (`tenantId`, `sourceCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_merge_mappings` ADD CONSTRAINT `customer_merge_mappings_tenantId_targetCustomerId_fkey` FOREIGN KEY (`tenantId`, `targetCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
