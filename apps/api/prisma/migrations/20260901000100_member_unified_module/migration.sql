-- MEMBER-01：统一新会员体系的首批持久化结构。
--
-- 只新增新体系事实，不触碰旧 Member/MembershipPlan：旧门市订单仍引用旧表，
-- 必须等替代入口和订单域完全切换后才能分阶段删除，避免迁移时中断现有业务。

-- AlterTable
ALTER TABLE `customer_accounts`
  ADD COLUMN `passwordHash` VARCHAR(191) NULL,
  ADD COLUMN `passwordUpdatedAt` DATETIME(3) NULL,
  ADD COLUMN `mustChangePassword` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `customer_membership_registration_settings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `registrationMode` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_membership_registration_settings_workspaceId_key`(`workspaceId`),
    UNIQUE INDEX `customer_membership_registration_settings_scope_key`(`tenantId`, `workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_reviews` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `reviewType` VARCHAR(191) NOT NULL,
    `qualificationType` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `channel` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `reason` TEXT NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_membership_reviews_scope_status_type_idx`(`tenantId`, `workspaceId`, `status`, `reviewType`),
    UNIQUE INDEX `customer_membership_reviews_scope_request_key`(`tenantId`, `workspaceId`, `requestKey`),
    INDEX `customer_membership_reviews_customer_created_idx`(`tenantId`, `customerId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_qualification_types` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(191) NOT NULL,
    `capabilityCode` VARCHAR(191) NULL,
    `requiredForBooking` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_membership_qualification_types_workspace_code_key`(`workspaceId`, `code`),
    INDEX `customer_membership_qualification_types_scope_status_idx`(`tenantId`, `workspaceId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_corporate_memberships` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NOT NULL,
    `personalCustomerId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'employee',
    `department` VARCHAR(191) NULL,
    `employeeNo` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,
    `reason` TEXT NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_corporate_memberships_workspace_company_person_key`(`workspaceId`, `corporateCustomerId`, `personalCustomerId`),
    INDEX `customer_corporate_memberships_person_scope_status_idx`(`tenantId`, `workspaceId`, `personalCustomerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_plans` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_membership_plans_workspace_code_key`(`workspaceId`, `code`),
    UNIQUE INDEX `customer_membership_plans_tenant_id_key`(`tenantId`, `id`),
    INDEX `customer_membership_plans_scope_type_status_idx`(`tenantId`, `workspaceId`, `targetType`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_plan_versions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `levelRank` INTEGER NOT NULL DEFAULT 1,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isRecommended` BOOLEAN NOT NULL DEFAULT false,
    `appVisible` BOOLEAN NOT NULL DEFAULT false,
    `effectiveFrom` DATETIME(3) NULL,
    `effectiveTo` DATETIME(3) NULL,
    `eligibility` JSON NOT NULL,
    `benefits` JSON NOT NULL,
    `createdBy` VARCHAR(191) NULL,
    `publishedBy` VARCHAR(191) NULL,
    `publishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_membership_plan_versions_plan_version_key`(`planId`, `version`),
    UNIQUE INDEX `customer_membership_plan_versions_tenant_id_key`(`tenantId`, `id`),
    INDEX `customer_membership_plan_versions_scope_status_effective_idx`(`tenantId`, `workspaceId`, `status`, `effectiveFrom`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_plan_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `planVersionId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,
    `reason` TEXT NULL,
    `grantedBy` VARCHAR(191) NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_membership_plan_assignments_scope_customer_status_idx`(`tenantId`, `workspaceId`, `customerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customer_membership_registration_settings` ADD CONSTRAINT `customer_membership_registration_settings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_registration_settings` ADD CONSTRAINT `customer_membership_registration_settings_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `customer_membership_reviews` ADD CONSTRAINT `customer_membership_reviews_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_reviews` ADD CONSTRAINT `customer_membership_reviews_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_reviews` ADD CONSTRAINT `customer_membership_reviews_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `customer_membership_qualification_types` ADD CONSTRAINT `customer_membership_qualification_types_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_qualification_types` ADD CONSTRAINT `customer_membership_qualification_types_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `customer_corporate_memberships` ADD CONSTRAINT `customer_corporate_memberships_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_corporate_memberships` ADD CONSTRAINT `customer_corporate_memberships_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_corporate_memberships` ADD CONSTRAINT `customer_corporate_memberships_tenantId_corporateCustomerId_fkey` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_corporate_memberships` ADD CONSTRAINT `customer_corporate_memberships_tenantId_personalCustomerId_fkey` FOREIGN KEY (`tenantId`, `personalCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `customer_membership_plans` ADD CONSTRAINT `customer_membership_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_plans` ADD CONSTRAINT `customer_membership_plans_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `customer_membership_plan_versions` ADD CONSTRAINT `customer_membership_plan_versions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_plan_versions` ADD CONSTRAINT `customer_membership_plan_versions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_plan_versions` ADD CONSTRAINT `customer_membership_plan_versions_tenantId_planId_fkey` FOREIGN KEY (`tenantId`, `planId`) REFERENCES `customer_membership_plans`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `customer_membership_plan_assignments` ADD CONSTRAINT `customer_membership_plan_assignments_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_plan_assignments` ADD CONSTRAINT `customer_membership_plan_assignments_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_plan_assignments` ADD CONSTRAINT `customer_membership_plan_assignments_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customer_membership_plan_assignments` ADD CONSTRAINT `customer_membership_plan_assignments_tenantId_planId_fkey` FOREIGN KEY (`tenantId`, `planId`) REFERENCES `customer_membership_plans`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `customer_membership_plan_assignments` ADD CONSTRAINT `customer_membership_plan_assignments_tenantId_planVersionId_fkey` FOREIGN KEY (`tenantId`, `planVersionId`) REFERENCES `customer_membership_plan_versions`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 新权限写入目录，并为已有相近管理权限的角色补授，避免升级后产生不可访问的新页面。
INSERT INTO `Permission` (`id`, `code`, `name`, `description`, `module`, `kind`, `createdAt`)
SELECT UUID(), wanted.`code`, wanted.`name`, wanted.`description`, '门市租赁', 'ACTION', CURRENT_TIMESTAMP(3)
FROM (
  SELECT 'store-rental:member:review' AS `code`, '会员注册审核' AS `name`, '处理个人会员注册审核，不含证件审核' AS `description`
  UNION ALL SELECT 'store-rental:member:qualification-review', '会员证件审核', '处理身份证件和品类资质审核'
  UNION ALL SELECT 'store-rental:member:account-manage', '会员账号与密码管理', '开通账号、设置临时密码和管理账号状态'
  UNION ALL SELECT 'store-rental:member:plan:manage', '会员方案编辑', '编辑个人和企业会员方案草稿、授予方案'
  UNION ALL SELECT 'store-rental:member:plan:publish', '会员方案发布', '发布会员方案版本'
  UNION ALL SELECT 'store-rental:corporate:employee-manage', '企业员工管理', '维护企业管理员和员工关系'
) AS wanted
WHERE NOT EXISTS (SELECT 1 FROM `Permission` AS existing WHERE existing.`code` = wanted.`code`);

INSERT INTO `RolePermission` (`roleId`, `permissionId`)
SELECT source.`roleId`, target.`id`
FROM (
  SELECT 'store-rental:member:manage' AS `sourceCode`, 'store-rental:member:review' AS `targetCode`
  UNION ALL SELECT 'store-rental:member:manage', 'store-rental:member:qualification-review'
  UNION ALL SELECT 'store-rental:member:manage', 'store-rental:member:account-manage'
  UNION ALL SELECT 'store-rental:member:manage', 'store-rental:member:plan:manage'
  UNION ALL SELECT 'store-rental:member:manage', 'store-rental:member:plan:publish'
  UNION ALL SELECT 'store-rental:corporate:manage', 'store-rental:corporate:employee-manage'
) AS mappings
JOIN `Permission` AS sourcePermission ON sourcePermission.`code` = mappings.`sourceCode`
JOIN `Permission` AS target ON target.`code` = mappings.`targetCode`
JOIN `RolePermission` AS source ON source.`permissionId` = sourcePermission.`id`
WHERE NOT EXISTS (
  SELECT 1 FROM `RolePermission` AS already
  WHERE already.`roleId` = source.`roleId` AND already.`permissionId` = target.`id`
);
