-- 新空库Rental基线，由固定Prisma模型生成；先应用公共迁移。
-- 存量混合库继续原链。本文件不迁移业务事实、不初始化账号或重放操作。
-- CreateTable
CREATE TABLE `business_workspaces` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `categoryVersionId` VARCHAR(191) NULL,
    `categoryAdoptionRevision` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('active', 'frozen', 'disabled') NOT NULL DEFAULT 'active',
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `defaultMarker` VARCHAR(191) NOT NULL,
    `runMode` VARCHAR(191) NOT NULL DEFAULT 'development',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `business_workspaces_category_idx`(`categoryCode`),
    INDEX `business_workspaces_tenant_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `business_workspaces_tenant_code_key`(`tenantId`, `code`),
    UNIQUE INDEX `business_workspaces_tenant_default_key`(`tenantId`, `defaultMarker`),
    UNIQUE INDEX `business_workspaces_tenant_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspace_members` (
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `roleId` VARCHAR(191) NULL,
    `dataScope` ENUM('all', 'organization', 'store', 'own') NULL,
    `locationScope` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `workspace_members_tenant_user_idx`(`tenantId`, `userId`),
    INDEX `workspace_members_role_idx`(`tenantId`, `roleId`),
    PRIMARY KEY (`workspaceId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_core_state_snapshots` (
    `workspaceId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `state` JSON NOT NULL,
    `configurationRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `core_snapshot_tenant_idx`(`tenantId`),
    UNIQUE INDEX `core_snapshot_tenant_ws_key`(`tenantId`, `workspaceId`),
    PRIMARY KEY (`workspaceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_business_state_snapshots` (
    `workspaceId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `state` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `business_snapshot_tenant_idx`(`tenantId`),
    UNIQUE INDEX `business_snapshot_tenant_ws_key`(`tenantId`, `workspaceId`),
    PRIMARY KEY (`workspaceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerType` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `phoneMasked` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `identityVerified` BOOLEAN NOT NULL DEFAULT false,
    `identityNoMasked` VARCHAR(191) NULL,
    `gender` VARCHAR(16) NULL,
    `birthday` DATE NULL,
    `sourceChannel` VARCHAR(32) NULL,
    `region` VARCHAR(64) NULL,
    `avatarStorageKey` VARCHAR(191) NULL,
    `createdByUserId` VARCHAR(191) NULL,
    `createdInWorkspaceId` VARCHAR(191) NULL,
    `qualifications` JSON NOT NULL,
    `corporateName` VARCHAR(191) NULL,
    `corporateTaxNo` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `sourceMemberId` VARCHAR(191) NULL,
    `mergedIntoCustomerId` VARCHAR(191) NULL,
    `ordinaryRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_profiles_tenant_status_idx`(`tenantId`, `status`),
    INDEX `customer_profiles_creator_scope_idx`(`tenantId`, `createdInWorkspaceId`, `createdByUserId`),
    UNIQUE INDEX `customer_profiles_tenant_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `customer_profiles_tenant_phone_key`(`tenantId`, `phone`),
    UNIQUE INDEX `customer_profiles_tenant_source_member_key`(`tenantId`, `sourceMemberId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_approved_profile_changes` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `changeKey` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    `baseRevision` INTEGER UNSIGNED NOT NULL,
    `beforeName` VARCHAR(191) NOT NULL,
    `afterName` VARCHAR(191) NOT NULL,
    `changeHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customer_profile_change_key`(`tenantId`, `customerId`, `actorId`, `changeKey`),
    UNIQUE INDEX `customer_profile_change_binding`(`tenantId`, `workspaceId`, `customerId`, `id`, `changeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_approved_profile_operations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `operationKey` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `commandHash` CHAR(64) NOT NULL,
    `changeId` VARCHAR(36) NOT NULL,
    `changeHash` CHAR(64) NOT NULL,
    `baseRevision` INTEGER UNSIGNED NOT NULL,
    `resultRevision` INTEGER UNSIGNED NOT NULL,
    `resultName` VARCHAR(191) NOT NULL,
    `resultHash` CHAR(64) NOT NULL,
    `approvalRef` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customer_profile_operation_key`(`tenantId`, `customerId`, `operationKey`),
    UNIQUE INDEX `customer_profile_change_once`(`tenantId`, `customerId`, `changeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_identity_verifications` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `credentialType` VARCHAR(32) NOT NULL,
    `result` VARCHAR(16) NOT NULL,
    `evidenceFileAssetIds` JSON NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `reviewerUserId` VARCHAR(191) NOT NULL,
    `reviewerName` VARCHAR(120) NOT NULL,
    `reviewedAt` DATETIME(3) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_identity_verifications_customer_time_idx`(`tenantId`, `customerId`, `reviewedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_memberships` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `levelName` VARCHAR(191) NOT NULL DEFAULT '普通会员',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `firstOrderAt` DATETIME(3) NULL,
    `suspendedAt` DATETIME(3) NULL,
    `restrictedAt` DATETIME(3) NULL,
    `exitedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_memberships_tenant_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `customer_memberships_tenant_customer_key`(`tenantId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
    `passwordHash` VARCHAR(191) NULL,
    `passwordUpdatedAt` DATETIME(3) NULL,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_accounts_tenant_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `customer_accounts_tenant_customer_key`(`tenantId`, `customerId`),
    UNIQUE INDEX `customer_accounts_tenant_login_key`(`tenantId`, `loginPhone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_channel_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `brandName` VARCHAR(191) NULL,
    `brandLogoUrl` VARCHAR(512) NULL,
    `faviconUrl` VARCHAR(512) NULL,
    `customerServicePhone` VARCHAR(32) NULL,
    `customerServiceHours` VARCHAR(64) NULL,
    `userAgreementName` VARCHAR(64) NULL,
    `userAgreementVersion` VARCHAR(64) NULL,
    `userAgreementUrl` VARCHAR(512) NULL,
    `userAgreementBody` MEDIUMTEXT NULL,
    `privacyPolicyName` VARCHAR(64) NULL,
    `privacyPolicyVersion` VARCHAR(64) NULL,
    `privacyPolicyUrl` VARCHAR(512) NULL,
    `privacyPolicyBody` MEDIUMTEXT NULL,
    `helpIntro` TEXT NULL,
    `helpFaqJson` JSON NULL,
    `bannerTitle` VARCHAR(64) NULL,
    `bannerSubtitle` VARCHAR(120) NULL,
    `themeColor` VARCHAR(16) NULL,
    `adminCornerRadius` SMALLINT UNSIGNED NULL,
    `adminContainerRadius` SMALLINT UNSIGNED NULL,
    `adminButtonRadius` SMALLINT UNSIGNED NULL,
    `adminInputRadius` SMALLINT UNSIGNED NULL,
    `smsLoginEnabled` BOOLEAN NOT NULL DEFAULT true,
    `passwordLoginEnabled` BOOLEAN NOT NULL DEFAULT true,
    `defaultWorkspaceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_channel_profiles_tenant_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_channel_workspaces` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `profileId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `client_channel_workspace_scope_idx`(`tenantId`, `enabled`),
    UNIQUE INDEX `client_channel_workspace_key`(`tenantId`, `workspaceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `website_channel_profiles` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `slogan` VARCHAR(120) NULL,
    `heroTitle` VARCHAR(120) NULL,
    `heroDescription` VARCHAR(400) NULL,
    `heroImageUrl` VARCHAR(512) NULL,
    `secondaryColor` VARCHAR(16) NULL,
    `footerText` VARCHAR(600) NULL,
    `contactAddress` VARCHAR(256) NULL,
    `ctaTitle` VARCHAR(120) NULL,
    `ctaDescription` VARCHAR(400) NULL,
    `seoTitle` VARCHAR(120) NULL,
    `seoDescription` VARCHAR(400) NULL,
    `seoKeywords` VARCHAR(256) NULL,
    `showPoweredBy` BOOLEAN NOT NULL DEFAULT true,
    `customDomain` VARCHAR(191) NULL,
    `categoryImagesJson` JSON NULL,
    `advantagesJson` JSON NULL,
    `stepsJson` JSON NULL,
    `testimonialsJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `website_channel_profiles_tenant_key`(`tenantId`),
    UNIQUE INDEX `website_channel_profiles_domain_key`(`customDomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `website_assets` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `scene` VARCHAR(32) NOT NULL,
    `mimeType` VARCHAR(64) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `data` LONGBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `website_assets_tenant_idx`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mini_program_channels` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `appId` VARCHAR(191) NOT NULL,
    `appSecretEncrypted` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `lastTestStatus` VARCHAR(32) NOT NULL DEFAULT 'not_tested',
    `lastTestAt` DATETIME(3) NULL,
    `lastTestError` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `mini_program_channels_tenant_enabled_idx`(`tenantId`, `enabled`),
    UNIQUE INDEX `mini_program_channels_tenant_app_key`(`tenantId`, `appId`),
    UNIQUE INDEX `mini_program_channels_app_id_key`(`appId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_wechat_identities` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `openId` VARCHAR(191) NOT NULL,
    `unionId` VARCHAR(191) NULL,
    `appId` VARCHAR(191) NOT NULL,
    `boundAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastUsedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `client_wechat_identity_customer_idx`(`tenantId`, `customerId`),
    UNIQUE INDEX `client_wechat_identities_tenant_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `client_wechat_identity_open_key`(`tenantId`, `channelId`, `openId`),
    UNIQUE INDEX `client_wechat_identity_customer_key`(`tenantId`, `channelId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_delivery_addresses` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `phoneMasked` VARCHAR(32) NOT NULL,
    `countryCode` VARCHAR(8) NOT NULL DEFAULT 'CN',
    `province` VARCHAR(64) NOT NULL,
    `city` VARCHAR(64) NOT NULL,
    `district` VARCHAR(64) NULL,
    `detail` VARCHAR(255) NOT NULL,
    `postalCode` VARCHAR(16) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_delivery_addresses_owner_idx`(`tenantId`, `customerId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_order_delivery_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `addressId` VARCHAR(191) NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `client_order_delivery_snapshots_quote_key`(`quoteId`),
    UNIQUE INDEX `client_order_delivery_snapshots_order_key`(`orderId`),
    INDEX `client_order_delivery_snapshots_customer_idx`(`tenantId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_registration_challenges` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `sourceWorkspaceId` VARCHAR(191) NULL,
    `method` VARCHAR(16) NOT NULL,
    `purpose` VARCHAR(32) NOT NULL DEFAULT 'registration',
    `identifierHash` CHAR(64) NOT NULL,
    `maskedDestination` VARCHAR(64) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending_verification',
    `deliveryMode` VARCHAR(24) NOT NULL DEFAULT 'development',
    `requestKey` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `verificationTokenHash` CHAR(64) NULL,
    `consumedAt` DATETIME(3) NULL,
    `registrationId` VARCHAR(191) NULL,
    `registeredCustomerId` VARCHAR(191) NULL,
    `registrationResult` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `client_registration_challenges_lookup_idx`(`tenantId`, `identifierHash`, `createdAt`),
    INDEX `client_registration_challenges_source_workspace_idx`(`tenantId`, `sourceWorkspaceId`),
    INDEX `client_registration_challenges_expiry_idx`(`expiresAt`, `status`),
    UNIQUE INDEX `client_registration_challenges_tenant_request_key`(`tenantId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_auth_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `refreshTokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `wechatIdentityId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `client_auth_sessions_refreshTokenHash_key`(`refreshTokenHash`),
    INDEX `client_auth_sessions_customer_idx`(`tenantId`, `customerId`, `revokedAt`),
    INDEX `client_auth_sessions_workspace_idx`(`tenantId`, `workspaceId`, `revokedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_api_rate_buckets` (
    `id` VARCHAR(191) NOT NULL,
    `scopeKey` CHAR(64) NOT NULL,
    `bucketStart` DATETIME(3) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `client_api_rate_bucket_expiry_idx`(`bucketStart`),
    UNIQUE INDEX `client_api_rate_bucket_key`(`scopeKey`, `bucketStart`),
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
    `revision` INTEGER NOT NULL DEFAULT 1,
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
    `revision` INTEGER NOT NULL DEFAULT 1,
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
    `revision` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_credits_tenant_customer_key`(`tenantId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_corporate_credit_ledger` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `entryType` VARCHAR(24) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reservedDelta` DECIMAL(12, 2) NOT NULL,
    `receivableDelta` DECIMAL(12, 2) NOT NULL,
    `reservedAfter` DECIMAL(12, 2) NOT NULL,
    `receivableAfter` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `operator` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_credit_ledger_account_time_idx`(`tenantId`, `customerId`, `occurredAt`),
    INDEX `customer_credit_ledger_order_idx`(`tenantId`, `customerId`, `orderId`),
    INDEX `customer_credit_ledger_scope_order_idx`(`tenantId`, `workspaceId`, `orderId`),
    UNIQUE INDEX `customer_credit_ledger_idem_key`(`tenantId`, `customerId`, `idempotencyKey`),
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
    UNIQUE INDEX `customer_status_history_recipient_scope_key`(`tenantId`, `id`, `customerId`),
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
    `source` VARCHAR(32) NOT NULL DEFAULT 'manual',
    `currentRevisionId` VARCHAR(191) NULL,
    `evidenceRef` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_qualification_refs_currentRevisionId_key`(`currentRevisionId`),
    INDEX `customer_qualification_refs_tenant_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `customer_qualification_refs_unique_type_key`(`tenantId`, `customerId`, `qualificationType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_registration_settings` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `registrationMode` VARCHAR(191) NOT NULL DEFAULT 'manual',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customer_membership_registration_settings_tenantId_key`(`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_reviews` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `sourceWorkspaceId` VARCHAR(191) NULL,
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

    INDEX `customer_membership_reviews_tenant_status_type_idx`(`tenantId`, `status`, `reviewType`),
    INDEX `customer_membership_reviews_source_workspace_idx`(`tenantId`, `sourceWorkspaceId`),
    INDEX `customer_membership_reviews_customer_created_idx`(`tenantId`, `customerId`, `createdAt`),
    UNIQUE INDEX `customer_membership_reviews_tenant_request_key`(`tenantId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_qualification_revisions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `qualificationType` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(191) NOT NULL,
    `capabilityCode` VARCHAR(191) NULL,
    `applicableScope` JSON NOT NULL,
    `referenceNoMasked` VARCHAR(191) NULL,
    `issuedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `evidenceRef` VARCHAR(512) NULL,
    `source` VARCHAR(32) NOT NULL,
    `submittedBy` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `qualificationStatus` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `reviewStatus` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `reviewReason` TEXT NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customer_qualification_revisions_reviewId_key`(`reviewId`),
    INDEX `customer_qualification_revisions_scope_customer_type_idx`(`tenantId`, `workspaceId`, `customerId`, `qualificationType`, `submittedAt`),
    INDEX `customer_qualification_revisions_customer_created_idx`(`tenantId`, `customerId`, `createdAt`),
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

    INDEX `customer_membership_qualification_types_scope_status_idx`(`tenantId`, `workspaceId`, `status`),
    UNIQUE INDEX `customer_membership_qualification_types_workspace_code_key`(`workspaceId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_corporate_memberships` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
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

    INDEX `customer_corporate_memberships_person_scope_status_idx`(`tenantId`, `personalCustomerId`, `status`),
    UNIQUE INDEX `corporate_memberships_status_recipient_key`(`tenantId`, `corporateCustomerId`, `id`, `personalCustomerId`),
    UNIQUE INDEX `corporate_memberships_portal_scope_key`(`tenantId`, `corporateCustomerId`, `id`),
    UNIQUE INDEX `customer_corporate_memberships_tenant_company_person_key`(`tenantId`, `corporateCustomerId`, `personalCustomerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_corporate_status_recipients` (
    `tenantId` VARCHAR(191) NOT NULL,
    `historyId` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NOT NULL,
    `recipientCustomerId` VARCHAR(191) NOT NULL,
    `membershipId` VARCHAR(191) NOT NULL,
    `membershipUpdatedAt` DATETIME(3) NOT NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `corporate_status_recipient_person_at_idx`(`tenantId`, `recipientCustomerId`, `capturedAt`),
    PRIMARY KEY (`tenantId`, `historyId`, `recipientCustomerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_portal_tenant_settings` (
    `tenantId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_corporate_portals` (
    `tenantId` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `enterprise_corporate_portals_corporateCustomerId_key`(`corporateCustomerId`),
    PRIMARY KEY (`tenantId`, `corporateCustomerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_portal_grants` (
    `tenantId` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NOT NULL,
    `membershipId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `membershipUpdatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `corporateCustomerId`, `membershipId`, `action`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_workflow_requests` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(40) NOT NULL,
    `applicantCustomerId` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NULL,
    `state` VARCHAR(40) NOT NULL DEFAULT 'draft',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `payload` JSON NOT NULL,
    `decisionReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `enterprise_request_applicant`(`tenantId`, `applicantCustomerId`, `kind`, `createdAt`),
    INDEX `enterprise_request_company`(`tenantId`, `corporateCustomerId`, `kind`, `state`),
    PRIMARY KEY (`tenantId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_invite_policies` (
    `tenantId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `policy` JSON NOT NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_invites` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `expiresAt` DATETIME(3) NOT NULL,
    `maxUses` INTEGER NOT NULL,
    `used` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `enterprise_invite_token`(`tokenHash`),
    INDEX `enterprise_invite_company`(`tenantId`, `corporateCustomerId`, `createdAt`),
    PRIMARY KEY (`tenantId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_scope_policies` (
    `tenantId` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NOT NULL,
    `scopeKey` VARCHAR(191) NOT NULL,
    `membershipUpdatedAt` DATETIME(3) NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `policy` JSON NOT NULL,

    PRIMARY KEY (`tenantId`, `corporateCustomerId`, `scopeKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_booking_approvals` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NOT NULL,
    `applicantCustomerId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `requestFingerprint` CHAR(64) NOT NULL,
    `request` JSON NOT NULL,
    `quote` JSON NOT NULL,
    `basis` JSON NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `purpose` VARCHAR(500) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `approvedBy` VARCHAR(191) NULL,
    `reviewerMembershipId` VARCHAR(191) NULL,
    `reviewerMembershipUpdatedAt` DATETIME(3) NULL,
    `executionKey` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `enterprise_approval_company`(`tenantId`, `corporateCustomerId`, `state`),
    UNIQUE INDEX `enterprise_approval_quote`(`tenantId`, `quoteId`),
    PRIMARY KEY (`tenantId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_extension_approvals` (
    `tenantId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NOT NULL,
    `applicantCustomerId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `expectedOrderUpdatedAt` VARCHAR(40) NOT NULL,
    `requestFingerprint` CHAR(64) NOT NULL,
    `previewFingerprint` CHAR(64) NOT NULL,
    `request` JSON NOT NULL,
    `preview` JSON NOT NULL,
    `basis` JSON NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `reason` VARCHAR(500) NOT NULL,
    `decisionReason` VARCHAR(500) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `approvedBy` VARCHAR(191) NULL,
    `reviewerMembershipId` VARCHAR(191) NULL,
    `reviewerMembershipUpdatedAt` DATETIME(3) NULL,
    `extensionId` VARCHAR(191) NULL,
    `executionKey` VARCHAR(128) NULL,
    `closedOperationKey` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `enterprise_extension_applicant`(`tenantId`, `applicantCustomerId`, `workspaceId`, `state`),
    INDEX `enterprise_extension_company`(`tenantId`, `corporateCustomerId`, `workspaceId`, `state`),
    UNIQUE INDEX `enterprise_extension_consumed`(`tenantId`, `workspaceId`, `extensionId`),
    PRIMARY KEY (`tenantId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_rental_handoff_requests` (
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `applicantCustomerId` VARCHAR(191) NOT NULL,
    `corporateCustomerId` VARCHAR(191) NOT NULL,
    `corporateMembershipId` VARCHAR(191) NOT NULL,
    `state` VARCHAR(40) NOT NULL DEFAULT 'pending',
    `revision` INTEGER NOT NULL DEFAULT 1,
    `material` JSON NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `pendingMarker` CHAR(64) NULL,
    `merchantReviewReason` VARCHAR(500) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `enterprise_handoff_own_idx`(`tenantId`, `workspaceId`, `applicantCustomerId`, `createdAt`),
    UNIQUE INDEX `enterprise_handoff_pending_key`(`tenantId`, `workspaceId`, `pendingMarker`),
    PRIMARY KEY (`tenantId`, `workspaceId`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enterprise_portal_operations` (
    `tenantId` VARCHAR(191) NOT NULL,
    `operationKey` VARCHAR(128) NOT NULL,
    `actorUserId` VARCHAR(191) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `target` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `result` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`tenantId`, `operationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_plans` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_membership_plans_scope_type_status_idx`(`tenantId`, `targetType`, `status`),
    UNIQUE INDEX `customer_membership_plans_tenant_code_key`(`tenantId`, `code`),
    UNIQUE INDEX `customer_membership_plans_tenant_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_plan_versions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
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
    `disabledBy` VARCHAR(191) NULL,
    `disabledAt` DATETIME(3) NULL,
    `disableReason` TEXT NULL,
    `restoredFromVersionId` VARCHAR(191) NULL,
    `restoreReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_membership_plan_versions_scope_status_effective_idx`(`tenantId`, `status`, `effectiveFrom`),
    UNIQUE INDEX `customer_membership_plan_versions_plan_version_key`(`planId`, `version`),
    UNIQUE INDEX `customer_membership_plan_versions_tenant_id_key`(`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_membership_plan_assignments` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `planVersionId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `effectiveFrom` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `effectiveTo` DATETIME(3) NULL,
    `reason` TEXT NULL,
    `grantedBy` VARCHAR(191) NULL,
    `revokedBy` VARCHAR(191) NULL,
    `revokedAt` DATETIME(3) NULL,
    `revokeReason` TEXT NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `customer_membership_plan_assignments_scope_customer_status_idx`(`tenantId`, `customerId`, `status`),
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

-- CreateTable
CREATE TABLE `customer_sensitive_access_audits` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `field` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `revealed` BOOLEAN NOT NULL DEFAULT false,
    `operator` VARCHAR(191) NULL,
    `permission` VARCHAR(191) NULL,
    `reason` TEXT NULL,
    `at` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_sensitive_access_customer_at_idx`(`tenantId`, `customerId`, `at`),
    INDEX `customer_sensitive_access_ws_at_idx`(`tenantId`, `workspaceId`, `at`),
    INDEX `customer_sensitive_access_operator_at_idx`(`tenantId`, `operator`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DocumentPrintJob` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `documentNo` VARCHAR(191) NOT NULL,
    `documentType` VARCHAR(191) NOT NULL,
    `templateCode` VARCHAR(191) NOT NULL,
    `businessType` VARCHAR(191) NOT NULL,
    `businessId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `fileAssetId` VARCHAR(191) NULL,
    `operator` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `result` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DocumentPrintJob_tenantId_documentType_createdAt_idx`(`tenantId`, `documentType`, `createdAt`),
    INDEX `DocumentPrintJob_tenantId_businessType_businessId_idx`(`tenantId`, `businessType`, `businessId`),
    UNIQUE INDEX `DocumentPrintJob_tenantId_documentNo_key`(`tenantId`, `documentNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TBoxDevice` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `cid` VARCHAR(191) NOT NULL,
    `simNo` VARCHAR(191) NULL,
    `model` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'unbound',
    `boundVehicleId` VARCHAR(191) NULL,
    `boundPlateNo` VARCHAR(191) NULL,
    `vehicleModel` VARCHAR(191) NULL,
    `firmwareVersion` VARCHAR(191) NULL,
    `appVersion` VARCHAR(191) NULL,
    `warrantyExpireAt` DATETIME(3) NULL,
    `supportsIButton` BOOLEAN NOT NULL DEFAULT false,
    `iButtonCode` VARCHAR(191) NULL,
    `powerOnAt` DATETIME(3) NULL,
    `lastHeartbeatAt` DATETIME(3) NULL,
    `telemetry` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TBoxDevice_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `TBoxDevice_tenantId_boundPlateNo_idx`(`tenantId`, `boundPlateNo`),
    UNIQUE INDEX `TBoxDevice_tenantId_cid_key`(`tenantId`, `cid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_category_definitions` (
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `supportedInventoryModes` JSON NOT NULL,
    `defaultCapabilities` JSON NOT NULL,
    `terminology` JSON NOT NULL,
    `attributeSchema` JSON NOT NULL,
    `businessModel` JSON NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `openingScope` VARCHAR(24) NOT NULL DEFAULT 'all',
    `openingTenantIds` JSON NULL,
    `openingRevision` INTEGER NOT NULL DEFAULT 0,
    `recommendedVersionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_category_versions` (
    `id` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `versionLabel` VARCHAR(64) NOT NULL,
    `structureVersion` INTEGER NOT NULL DEFAULT 1,
    `sourceVersionId` VARCHAR(191) NULL,
    `sourceKind` VARCHAR(32) NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `definition` JSON NOT NULL,
    `dependencyDigest` JSON NULL,
    `publishedAt` DATETIME(3) NULL,
    `publishedBy` VARCHAR(191) NULL,
    `publishReason` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_category_versions_code_status_idx`(`categoryCode`, `status`),
    UNIQUE INDEX `rental_category_versions_code_id_key`(`categoryCode`, `id`),
    UNIQUE INDEX `rental_category_versions_code_label_key`(`categoryCode`, `versionLabel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_category_version_policies` (
    `versionId` VARCHAR(191) NOT NULL,
    `createScope` VARCHAR(24) NOT NULL DEFAULT 'all',
    `createTenantIds` JSON NULL,
    `upgradeScope` VARCHAR(24) NOT NULL DEFAULT 'all',
    `upgradeTenantIds` JSON NULL,
    `restoreScope` VARCHAR(24) NOT NULL DEFAULT 'all',
    `restoreTenantIds` JSON NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`versionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_category_governance_audits` (
    `id` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `versionId` VARCHAR(191) NULL,
    `action` VARCHAR(48) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(512) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_category_governance_audits_code_time_idx`(`categoryCode`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_category_adoption_audits` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `fromVersionId` VARCHAR(191) NULL,
    `toVersionId` VARCHAR(191) NOT NULL,
    `fromRevision` INTEGER NOT NULL,
    `toRevision` INTEGER NOT NULL,
    `action` VARCHAR(24) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(512) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_category_adoptions_tenant_ws_time_idx`(`tenantId`, `workspaceId`, `createdAt`),
    UNIQUE INDEX `rental_category_adoptions_workspace_revision_key`(`workspaceId`, `toRevision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_category_adoption_preparations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `targetVersionId` VARCHAR(191) NOT NULL,
    `sourceRevision` INTEGER NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `patches` JSON NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_category_preparations_tenant_ws_idx`(`tenantId`, `workspaceId`),
    UNIQUE INDEX `rental_category_preparations_ws_version_key`(`workspaceId`, `targetVersionId`),
    UNIQUE INDEX `rental_category_preparations_tenant_ws_id_key`(`tenantId`, `workspaceId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_category_preparation_batches` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `preparationId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(128) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `inputFingerprint` CHAR(64) NOT NULL,
    `result` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_category_preparation_batches_tenant_ws_time_idx`(`tenantId`, `workspaceId`, `createdAt`),
    UNIQUE INDEX `rental_category_preparation_batches_prep_batch_key`(`preparationId`, `batchId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tenant_rental_profiles` (
    `tenantId` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `capabilities` JSON NOT NULL,
    `terminology` JSON NOT NULL,
    `configVersion` VARCHAR(191) NOT NULL,
    `configurationRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `initializedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tenant_rental_profiles_categoryCode_idx`(`categoryCode`),
    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspace_capability_instances` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `implementationVersion` VARCHAR(191) NOT NULL,
    `configVersion` VARCHAR(191) NOT NULL,
    `config` JSON NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `enabledAt` DATETIME(3) NULL,
    `pausedAt` DATETIME(3) NULL,
    `disabledAt` DATETIME(3) NULL,
    `updatedBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `workspace_capability_instances_tenant_code_idx`(`tenantId`, `code`),
    UNIQUE INDEX `workspace_capability_instances_ws_code_key`(`workspaceId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workspace_capability_audits` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `fromStatus` VARCHAR(191) NULL,
    `toStatus` VARCHAR(191) NOT NULL,
    `implementationVersion` VARCHAR(191) NULL,
    `configVersion` VARCHAR(191) NULL,
    `configSnapshot` JSON NULL,
    `reason` TEXT NOT NULL,
    `operator` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `workspace_capability_audits_ws_code_idx`(`workspaceId`, `code`),
    INDEX `workspace_capability_audits_tenant_at_idx`(`tenantId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `capability_hook_audits` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `point` VARCHAR(191) NOT NULL,
    `capability` VARCHAR(191) NOT NULL,
    `implementationVersion` VARCHAR(191) NOT NULL,
    `configVersion` VARCHAR(191) NOT NULL,
    `decision` VARCHAR(191) NOT NULL,
    `failed` BOOLEAN NOT NULL DEFAULT false,
    `subjectType` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `blockReasons` JSON NULL,
    `notices` JSON NULL,
    `linkedTasks` JSON NULL,
    `feeBases` JSON NULL,
    `operator` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `capability_hook_audits_ws_point_idx`(`workspaceId`, `point`),
    INDEX `capability_hook_audits_tenant_subject_idx`(`tenantId`, `subjectType`, `subjectId`),
    INDEX `capability_hook_audits_tenant_at_idx`(`tenantId`, `at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_coupon_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `discountType` VARCHAR(191) NOT NULL,
    `discountValue` DECIMAL(12, 2) NOT NULL,
    `minimumSpend` DECIMAL(12, 2) NOT NULL,
    `maximumDiscount` DECIMAL(12, 2) NULL,
    `appliesTo` VARCHAR(191) NOT NULL DEFAULT 'rental',
    `stackableWithDiscountPlans` BOOLEAN NOT NULL DEFAULT true,
    `totalQuota` INTEGER NOT NULL,
    `claimedQuantity` INTEGER NOT NULL DEFAULT 0,
    `perCustomerLimit` INTEGER NOT NULL DEFAULT 1,
    `perCustomerUseLimit` INTEGER NOT NULL DEFAULT 1,
    `totalBudget` DECIMAL(12, 2) NULL,
    `lockedBudget` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `redeemedBudget` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `claimFrom` DATETIME(3) NOT NULL,
    `claimTo` DATETIME(3) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NOT NULL,
    `applicableRentalFrom` DATETIME(3) NULL,
    `applicableRentalTo` DATETIME(3) NULL,
    `applicableItemGroupIds` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `version` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_coupon_templates_tenant_status_effective_idx`(`tenantId`, `status`, `effectiveFrom`, `effectiveTo`),
    UNIQUE INDEX `rental_coupon_templates_ws_code_key`(`workspaceId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_fulfillment_locations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `operatorId` VARCHAR(191) NULL,
    `operatorType` VARCHAR(191) NULL,
    `operatorName` VARCHAR(191) NULL,
    `parentLocationId` VARCHAR(191) NULL,
    `capabilities` JSON NOT NULL,
    `address` VARCHAR(191) NULL,
    `province` VARCHAR(64) NULL,
    `city` VARCHAR(64) NULL,
    `district` VARCHAR(64) NULL,
    `timezone` VARCHAR(64) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `contactName` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `businessHours` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_fulfillment_locations_tenantId_status_idx`(`tenantId`, `status`),
    INDEX `rental_locations_tenant_ws_org_idx`(`tenantId`, `workspaceId`, `organizationId`),
    INDEX `rental_fulfillment_locations_operatorId_idx`(`operatorId`),
    UNIQUE INDEX `rental_locations_ws_code_key`(`workspaceId`, `code`),
    UNIQUE INDEX `rental_locations_scope_id_key`(`tenantId`, `workspaceId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_item_groups` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `inventoryMode` ENUM('serialized', 'quantity', 'consumable', 'bundle') NOT NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT '件',
    `description` VARCHAR(191) NULL,
    `attributes` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_item_groups_tenant_category_mode_status_idx`(`tenantId`, `categoryCode`, `inventoryMode`, `status`),
    UNIQUE INDEX `rental_item_groups_ws_code_key`(`workspaceId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_pricing_groups` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `defaultPricingUnit` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_pricing_groups_scope_status_idx`(`tenantId`, `categoryCode`, `status`),
    UNIQUE INDEX `rental_pricing_groups_ws_code_key`(`workspaceId`, `code`),
    UNIQUE INDEX `rental_pricing_groups_scope_id_key`(`tenantId`, `workspaceId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_pricing_group_members` (
    `id` VARCHAR(191) NOT NULL,
    `pricingGroupId` VARCHAR(191) NOT NULL,
    `itemGroupId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_pricing_group_members_item_idx`(`itemGroupId`),
    UNIQUE INDEX `rental_pricing_group_members_pair_key`(`pricingGroupId`, `itemGroupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_bundle_components` (
    `id` VARCHAR(191) NOT NULL,
    `bundleItemGroupId` VARCHAR(191) NOT NULL,
    `componentItemGroupId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `optional` BOOLEAN NOT NULL DEFAULT false,
    `substitutionGroup` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_bundle_components_componentItemGroupId_idx`(`componentItemGroupId`),
    UNIQUE INDEX `rental_bundle_components_bundle_component_key`(`bundleItemGroupId`, `componentItemGroupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_assets` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `itemGroupId` VARCHAR(191) NOT NULL,
    `assetNo` VARCHAR(191) NOT NULL,
    `serialNo` VARCHAR(191) NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `status` ENUM('available', 'reserved', 'rented', 'inspection', 'maintenance', 'disabled') NOT NULL DEFAULT 'available',
    `attributes` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_assets_tenantId_itemGroupId_locationId_status_idx`(`tenantId`, `itemGroupId`, `locationId`, `status`),
    UNIQUE INDEX `rental_assets_ws_asset_no_key`(`workspaceId`, `assetNo`),
    UNIQUE INDEX `rental_assets_ws_serial_no_key`(`workspaceId`, `serialNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_asset_status_history` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NOT NULL,
    `assetNo` VARCHAR(191) NOT NULL,
    `fromStatus` ENUM('available', 'reserved', 'rented', 'inspection', 'maintenance', 'disabled') NULL,
    `toStatus` ENUM('available', 'reserved', 'rented', 'inspection', 'maintenance', 'disabled') NOT NULL,
    `source` VARCHAR(24) NOT NULL,
    `sourceId` VARCHAR(191) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `operator` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_asset_status_history_scope_idx`(`tenantId`, `workspaceId`, `assetId`, `createdAt`),
    INDEX `rental_asset_status_history_source_idx`(`workspaceId`, `source`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_attribute_unique_values` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(32) NOT NULL,
    `fieldCode` VARCHAR(64) NOT NULL,
    `normalizedHash` CHAR(64) NOT NULL,
    `normalizedValue` VARCHAR(512) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_attribute_unique_values_tenantId_workspaceId_entityId_idx`(`tenantId`, `workspaceId`, `entityId`),
    UNIQUE INDEX `rental_attr_unique_value_key`(`workspaceId`, `entityType`, `fieldCode`, `normalizedHash`),
    UNIQUE INDEX `rental_attr_unique_entity_key`(`workspaceId`, `entityType`, `fieldCode`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_stock_balances` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `itemGroupId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `onHandQuantity` INTEGER NOT NULL DEFAULT 0,
    `reservedQuantity` INTEGER NOT NULL DEFAULT 0,
    `maintenanceQuantity` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_stock_balances_tenantId_locationId_idx`(`tenantId`, `locationId`),
    UNIQUE INDEX `rental_stock_ws_group_location_key`(`workspaceId`, `itemGroupId`, `locationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_stock_ledger_entries` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `operationId` VARCHAR(191) NOT NULL,
    `entryKind` VARCHAR(8) NOT NULL,
    `operationType` VARCHAR(24) NOT NULL,
    `itemGroupId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `quantityDelta` INTEGER NOT NULL,
    `onHandBefore` INTEGER NOT NULL,
    `onHandAfter` INTEGER NOT NULL,
    `maintenanceDelta` INTEGER NOT NULL DEFAULT 0,
    `reservedQuantity` INTEGER NOT NULL,
    `maintenanceQuantity` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `batchNo` VARCHAR(100) NULL,
    `sourceDocumentNo` VARCHAR(100) NULL,
    `sourceOrderId` VARCHAR(191) NULL,
    `sourceInspectionId` VARCHAR(191) NULL,
    `sourceDispositionId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `requestFingerprint` CHAR(64) NOT NULL,
    `operator` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_stock_ledger_scope_created_idx`(`tenantId`, `workspaceId`, `itemGroupId`, `locationId`, `createdAt`),
    INDEX `rental_stock_ledger_batch_idx`(`tenantId`, `workspaceId`, `batchNo`, `createdAt`),
    INDEX `rental_stock_ledger_document_idx`(`tenantId`, `workspaceId`, `sourceDocumentNo`, `createdAt`),
    INDEX `rental_stock_ledger_order_idx`(`tenantId`, `workspaceId`, `sourceOrderId`, `createdAt`),
    INDEX `rental_stock_ledger_inspection_idx`(`tenantId`, `workspaceId`, `sourceInspectionId`, `createdAt`),
    INDEX `rental_stock_ledger_disposition_idx`(`tenantId`, `workspaceId`, `sourceDispositionId`, `createdAt`),
    INDEX `rental_stock_ledger_operation_idx`(`workspaceId`, `operationId`),
    UNIQUE INDEX `rental_stock_ledger_idem_entry_key`(`workspaceId`, `idempotencyKey`, `entryKind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_stock_dispositions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `inspectionId` VARCHAR(191) NULL,
    `returnBatchKey` VARCHAR(191) NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `itemGroupId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `bufferUntil` DATETIME(3) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `blockReason` VARCHAR(500) NULL,
    `restoredQuantity` INTEGER NOT NULL DEFAULT 0,
    `restoredAt` DATETIME(3) NULL,
    `restoredBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_stock_dispositions_scope_idx`(`tenantId`, `workspaceId`, `itemGroupId`, `locationId`),
    INDEX `rental_stock_dispositions_scope_status_idx`(`tenantId`, `workspaceId`, `status`),
    INDEX `rental_stock_dispositions_asset_status_idx`(`workspaceId`, `assetId`, `status`),
    INDEX `rental_stock_dispositions_orderId_inspectionId_idx`(`orderId`, `inspectionId`),
    UNIQUE INDEX `rental_stock_disp_batch_resource_key`(`workspaceId`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_work_orders` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `workNo` VARCHAR(191) NOT NULL,
    `type` VARCHAR(24) NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `dispositionId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `inspectionId` VARCHAR(191) NULL,
    `itemGroupId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `assetId` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL,
    `assigneeId` VARCHAR(191) NULL,
    `assigneeName` VARCHAR(191) NULL,
    `reason` TEXT NOT NULL,
    `result` TEXT NULL,
    `attachments` JSON NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewReason` TEXT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_work_orders_tenantId_workspaceId_status_type_idx`(`tenantId`, `workspaceId`, `status`, `type`),
    INDEX `rental_work_orders_asset_status_idx`(`workspaceId`, `assetId`, `status`),
    INDEX `rental_work_orders_orderId_inspectionId_idx`(`orderId`, `inspectionId`),
    UNIQUE INDEX `rental_work_orders_ws_no_key`(`workspaceId`, `workNo`),
    UNIQUE INDEX `rental_work_orders_disp_type_key`(`workspaceId`, `dispositionId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_orders` (
    `categoryVersionId` VARCHAR(191) NULL,
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(191) NOT NULL,
    `assignment` JSON NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `status` ENUM('draft', 'reserved', 'pickup_overdue', 'ready_for_pickup', 'renting', 'return_inspection', 'settling', 'completed', 'cancelled', 'no_show') NOT NULL DEFAULT 'reserved',
    `customerType` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `contactPhone` VARCHAR(191) NULL,
    `membershipSnapshot` JSON NULL,
    `membershipBenefitEvaluations` JSON NULL,
    `fulfillmentMode` VARCHAR(191) NOT NULL,
    `fulfillmentLocationId` VARCHAR(191) NOT NULL,
    `fulfillmentLocationName` VARCHAR(191) NOT NULL,
    `fulfillmentLocationSnapshot` JSON NULL,
    `returnLocationId` VARCHAR(191) NULL,
    `returnLocationName` VARCHAR(191) NULL,
    `returnLocationSnapshot` JSON NULL,
    `deliveryAddressSnapshot` JSON NULL,
    `startAt` DATETIME(3) NOT NULL,
    `actualRentalStartAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NOT NULL,
    `effectiveEndAt` DATETIME(3) NULL,
    `carrierRentalDueAt` DATETIME(3) NULL,
    `quoteId` VARCHAR(191) NOT NULL,
    `quoteNo` VARCHAR(191) NOT NULL,
    `pricingPlanVersion` VARCHAR(191) NOT NULL,
    `ruleVersion` VARCHAR(191) NOT NULL,
    `ruleSnapshot` JSON NOT NULL,
    `inspectionTemplateSnapshots` JSON NULL,
    `calendarVersion` VARCHAR(191) NULL,
    `calendarSnapshot` JSON NULL,
    `capabilitySnapshot` JSON NULL,
    `capabilityRequirementsSnapshot` JSON NULL,
    `capabilityDecisions` JSON NULL,
    `capabilityExceptions` JSON NULL,
    `serviceSnapshots` JSON NULL,
    `priceVersionId` VARCHAR(191) NULL,
    `priceVersion` VARCHAR(191) NULL,
    `contractSubjectCustomerId` VARCHAR(191) NULL,
    `payerSubjectCustomerId` VARCHAR(191) NULL,
    `userSubjectCustomerId` VARCHAR(191) NULL,
    `agentId` VARCHAR(191) NULL,
    `subjectSnapshot` JSON NULL,
    `chargeLines` JSON NOT NULL,
    `feeReviews` JSON NULL,
    `rentalAmount` DECIMAL(12, 2) NOT NULL,
    `discountAmount` DECIMAL(12, 2) NOT NULL,
    `couponAmount` DECIMAL(12, 2) NOT NULL,
    `serviceAmount` DECIMAL(12, 2) NOT NULL,
    `fulfillmentAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `depositAmount` DECIMAL(12, 2) NOT NULL,
    `preAuthAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `legacyDepositUnverified` BOOLEAN NOT NULL DEFAULT false,
    `legacyDepositUnverifiedAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `payableAmount` DECIMAL(12, 2) NOT NULL,
    `adjustmentAmount` DECIMAL(12, 2) NOT NULL,
    `finalPayableAmount` DECIMAL(12, 2) NOT NULL,
    `taxRate` DECIMAL(6, 4) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `totalAmount` DECIMAL(12, 2) NOT NULL,
    `cancellationReason` VARCHAR(191) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `pickupOverdueAt` DATETIME(3) NULL,
    `noShowNoticeAt` DATETIME(3) NULL,
    `noShowAt` DATETIME(3) NULL,
    `noShowReason` VARCHAR(191) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_orders_tenantId_status_startAt_idx`(`tenantId`, `status`, `startAt`),
    INDEX `rental_orders_tenantId_customerType_customerId_idx`(`tenantId`, `customerType`, `customerId`),
    INDEX `rental_orders_tenantId_quoteId_idx`(`tenantId`, `quoteId`),
    INDEX `rental_orders_contract_subject_idx`(`tenantId`, `contractSubjectCustomerId`),
    INDEX `rental_orders_payer_subject_idx`(`tenantId`, `payerSubjectCustomerId`),
    INDEX `rental_orders_user_subject_idx`(`tenantId`, `userSubjectCustomerId`),
    UNIQUE INDEX `rental_orders_ws_order_no_key`(`workspaceId`, `orderNo`),
    UNIQUE INDEX `rental_orders_scope_id_key`(`tenantId`, `workspaceId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_order_document_snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `documentType` VARCHAR(32) NOT NULL,
    `templateCode` VARCHAR(64) NOT NULL,
    `documentNo` VARCHAR(191) NOT NULL,
    `sourceOrderUpdatedAt` DATETIME(3) NOT NULL,
    `snapshotAt` DATETIME(3) NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `snapshot` JSON NOT NULL,
    `html` LONGTEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_order_document_snapshots_history_idx`(`tenantId`, `workspaceId`, `orderId`, `documentType`, `createdAt`),
    UNIQUE INDEX `rental_order_document_snapshots_content_key`(`tenantId`, `workspaceId`, `orderId`, `documentType`, `contentHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_funding_events` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `instrument` VARCHAR(20) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `balanceAfter` DECIMAL(12, 2) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'mock',
    `paymentMethod` VARCHAR(24) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `operator` VARCHAR(191) NULL,
    `failureCode` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_funding_events_scope_idx`(`tenantId`, `workspaceId`, `orderId`),
    INDEX `rental_funding_events_instrument_idx`(`orderId`, `instrument`, `at`),
    UNIQUE INDEX `rental_funding_events_idem_key`(`workspaceId`, `orderId`, `instrument`, `action`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_carrier_shipment_events` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `carrierName` VARCHAR(120) NOT NULL,
    `trackingNumber` VARCHAR(191) NOT NULL,
    `evidenceFileAssetIds` JSON NOT NULL,
    `recordedBy` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_carrier_shipment_events_order_time_idx`(`tenantId`, `workspaceId`, `orderId`, `occurredAt`),
    UNIQUE INDEX `rental_carrier_shipment_events_idem_key`(`tenantId`, `workspaceId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_offline_payment_registrations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `instrument` VARCHAR(20) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `paymentMethod` VARCHAR(24) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `evidenceFileAssetId` VARCHAR(191) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `registeredBy` VARCHAR(191) NULL,
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmedBy` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `fundingEventId` VARCHAR(191) NULL,

    INDEX `rental_offline_payments_pending_idx`(`tenantId`, `workspaceId`, `status`, `registeredAt`),
    INDEX `rental_offline_payments_order_idx`(`orderId`, `status`),
    UNIQUE INDEX `rental_offline_payments_idem_key`(`workspaceId`, `orderId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_payment_intents` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `instrument` VARCHAR(24) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `method` VARCHAR(24) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
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

    UNIQUE INDEX `rental_payment_intents_merchant_order_no_key`(`merchantOrderNo`),
    INDEX `rental_payment_intents_provider_status_idx`(`tenantId`, `provider`, `status`),
    INDEX `rental_payment_intents_order_status_idx`(`tenantId`, `workspaceId`, `orderId`, `status`),
    UNIQUE INDEX `rental_payment_intents_scope_idem_key`(`tenantId`, `workspaceId`, `orderId`, `instrument`, `idempotencyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_payment_refunds` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `paymentIntentId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `method` VARCHAR(24) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL,
    `merchantRefundNo` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `idempotencyHash` CHAR(64) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
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

    UNIQUE INDEX `rental_payment_refunds_merchant_no_key`(`merchantRefundNo`),
    INDEX `rental_payment_refunds_order_status_idx`(`tenantId`, `workspaceId`, `orderId`, `status`),
    INDEX `rental_payment_refunds_provider_status_idx`(`tenantId`, `provider`, `status`, `updatedAt`),
    UNIQUE INDEX `rental_payment_refunds_scope_id_key`(`tenantId`, `workspaceId`, `id`),
    UNIQUE INDEX `rental_payment_refunds_intent_idem_key`(`paymentIntentId`, `idempotencyHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

    INDEX `payment_webhook_events_scope_created_idx`(`tenantId`, `provider`, `createdAt`),
    UNIQUE INDEX `payment_webhook_events_provider_event_key`(`provider`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_reconciliation_batches` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(40) NOT NULL,
    `fileName` VARCHAR(180) NOT NULL,
    `fileSha256` CHAR(64) NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `totalRows` INTEGER NOT NULL,
    `matchedRows` INTEGER NOT NULL DEFAULT 0,
    `differenceRows` INTEGER NOT NULL DEFAULT 0,
    `acknowledgedRows` INTEGER NOT NULL DEFAULT 0,
    `importedBy` VARCHAR(191) NULL,
    `importedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payment_reconciliation_batch_scope_idx`(`tenantId`, `workspaceId`, `status`, `importedAt`),
    UNIQUE INDEX `payment_reconciliation_batch_file_key`(`tenantId`, `workspaceId`, `provider`, `fileSha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_reconciliation_lines` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `merchantOrderNo` VARCHAR(191) NOT NULL,
    `merchantRefundNo` VARCHAR(191) NULL,
    `externalId` VARCHAR(191) NULL,
    `statementStatus` VARCHAR(80) NOT NULL,
    `normalizedStatus` VARCHAR(24) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL,
    `occurredAt` DATETIME(3) NULL,
    `localRecordId` VARCHAR(191) NULL,
    `localStatus` VARCHAR(32) NULL,
    `differenceCodes` JSON NOT NULL,
    `differenceDetail` VARCHAR(1000) NULL,
    `reviewStatus` VARCHAR(24) NOT NULL DEFAULT 'not_required',
    `reviewReason` VARCHAR(500) NULL,
    `reviewedBy` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payment_reconciliation_line_review_idx`(`batchId`, `reviewStatus`),
    UNIQUE INDEX `payment_reconciliation_line_row_key`(`batchId`, `rowNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_order_extensions` (
    `executionBasis` JSON NULL,
    `pricingSnapshot` JSON NULL,
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `originalEndAt` DATETIME(3) NOT NULL,
    `newEndAt` DATETIME(3) NOT NULL,
    `billableUnits` DECIMAL(12, 2) NOT NULL,
    `rentalAmount` DECIMAL(12, 2) NOT NULL,
    `serviceAmount` DECIMAL(12, 2) NOT NULL,
    `depositDelta` DECIMAL(12, 2) NOT NULL,
    `preAuthDelta` DECIMAL(12, 2) NOT NULL,
    `payableAmount` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `priceVersionId` VARCHAR(191) NULL,
    `priceVersion` VARCHAR(191) NULL,
    `ruleVersion` VARCHAR(191) NOT NULL,
    `rateSnapshot` JSON NOT NULL,
    `ruleSnapshot` JSON NOT NULL,
    `calendarSnapshot` JSON NOT NULL,
    `serviceSnapshots` JSON NULL,
    `settlementMode` VARCHAR(20) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `memo` VARCHAR(500) NULL,
    `paidAt` DATETIME(3) NULL,
    `effectiveAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_order_extensions_scope_idx`(`tenantId`, `workspaceId`, `orderId`),
    INDEX `rental_order_extensions_status_idx`(`orderId`, `status`, `newEndAt`),
    UNIQUE INDEX `rental_order_extensions_idem_key`(`workspaceId`, `orderId`, `idempotencyKey`),
    UNIQUE INDEX `rental_order_extensions_seq_key`(`orderId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_order_changes` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `status` VARCHAR(24) NOT NULL,
    `request` JSON NOT NULL,
    `beforeSnapshot` JSON NOT NULL,
    `afterSnapshot` JSON NOT NULL,
    `diff` JSON NOT NULL,
    `refundAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `additionalAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `depositDelta` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `preAuthDelta` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `requestedBy` VARCHAR(191) NOT NULL,
    `appliedBy` VARCHAR(191) NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_order_changes_scope_idx`(`tenantId`, `workspaceId`, `orderId`, `createdAt`),
    UNIQUE INDEX `rental_order_changes_idem_key`(`workspaceId`, `orderId`, `idempotencyKey`),
    UNIQUE INDEX `rental_order_changes_seq_key`(`orderId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_order_lines` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `itemGroupId` VARCHAR(191) NOT NULL,
    `pricingGroupId` VARCHAR(191) NULL,
    `pricingGroupCode` VARCHAR(191) NULL,
    `pricingGroupName` VARCHAR(191) NULL,
    `reservationPrecision` VARCHAR(20) NOT NULL DEFAULT 'group',
    `pricingGroupMemberItemGroupIds` JSON NULL,
    `itemGroupCode` VARCHAR(191) NOT NULL,
    `itemGroupName` VARCHAR(191) NOT NULL,
    `inventoryMode` ENUM('serialized', 'quantity', 'consumable', 'bundle') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `cancelledQuantity` INTEGER NOT NULL DEFAULT 0,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_order_lines_orderId_itemGroupId_idx`(`orderId`, `itemGroupId`),
    INDEX `rental_order_lines_pricingGroupId_idx`(`pricingGroupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_reservations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `orderLineId` VARCHAR(191) NOT NULL,
    `itemGroupId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `releasedQuantity` INTEGER NOT NULL DEFAULT 0,
    `startAt` DATETIME(3) NOT NULL,
    `endAt` DATETIME(3) NOT NULL,
    `status` ENUM('soft', 'confirmed', 'fulfilled', 'released', 'expired', 'cancelled') NOT NULL DEFAULT 'soft',
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_reservations_tenant_group_loc_period_status_idx`(`tenantId`, `itemGroupId`, `locationId`, `startAt`, `endAt`, `status`),
    INDEX `rental_reservations_orderId_orderLineId_idx`(`orderId`, `orderLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_allocations` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `orderLineId` VARCHAR(191) NOT NULL,
    `itemGroupId` VARCHAR(191) NULL,
    `assetId` VARCHAR(191) NULL,
    `assetNo` VARCHAR(191) NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(191) NOT NULL DEFAULT 'allocated',
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_allocations_orderId_orderLineId_idx`(`orderId`, `orderLineId`),
    INDEX `rental_allocations_itemGroupId_status_idx`(`itemGroupId`, `status`),
    INDEX `rental_allocations_assetId_status_idx`(`assetId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_inspection_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `fields` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_inspection_templates_tenant_category_stage_idx`(`tenantId`, `categoryCode`, `stage`, `enabled`),
    UNIQUE INDEX `rental_inspection_tpl_ws_code_ver_key`(`workspaceId`, `code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_inspection_records` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `stage` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `templateCode` VARCHAR(191) NOT NULL,
    `templateVersion` VARCHAR(191) NOT NULL,
    `results` JSON NOT NULL,
    `exceptions` JSON NOT NULL,
    `attachments` JSON NOT NULL,
    `operator` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_inspection_records_tenantId_orderId_stage_idx`(`tenantId`, `orderId`, `stage`),
    UNIQUE INDEX `rental_inspection_event_source_key`(`tenantId`, `workspaceId`, `id`, `orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_fulfillment_operators` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
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
    UNIQUE INDEX `rental_operators_ws_code_key`(`workspaceId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_tenant_business_settings` (
    `workspaceId` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `configVersion` VARCHAR(191) NOT NULL,
    `settingsRevision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `settings` JSON NOT NULL,
    `updatedBy` VARCHAR(191) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_business_settings_tenant_idx`(`tenantId`),
    UNIQUE INDEX `rental_business_settings_scope_key`(`tenantId`, `workspaceId`),
    PRIMARY KEY (`workspaceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_approved_settings_changes` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `changeKey` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    `baseRevision` INTEGER UNSIGNED NOT NULL,
    `baseSettingsHash` CHAR(64) NOT NULL,
    `categoryVersionId` VARCHAR(191) NOT NULL,
    `categoryAdoptionRevision` INTEGER NOT NULL,
    `beforeNotifications` JSON NOT NULL,
    `afterNotifications` JSON NOT NULL,
    `changeHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `approved_settings_change_key`(`workspaceId`, `actorId`, `changeKey`),
    UNIQUE INDEX `approved_settings_change_binding`(`tenantId`, `workspaceId`, `id`, `changeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_approved_settings_operations` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `operationKey` VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
    `commandHash` CHAR(64) NOT NULL,
    `changeId` VARCHAR(36) NOT NULL,
    `changeHash` CHAR(64) NOT NULL,
    `baseRevision` INTEGER UNSIGNED NOT NULL,
    `resultRevision` INTEGER UNSIGNED NOT NULL,
    `resultHash` CHAR(64) NOT NULL,
    `approvalRef` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_approved_settings_operations_change_binding_idx`(`tenantId`, `workspaceId`, `changeId`, `changeHash`),
    UNIQUE INDEX `approved_settings_operation_key`(`workspaceId`, `operationKey`),
    UNIQUE INDEX `approved_settings_change_once`(`workspaceId`, `changeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_pricing_plans` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'CNY',
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `version` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `rates` JSON NOT NULL,
    `fulfillmentFees` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_pricing_plans_tenant_status_effective_idx`(`tenantId`, `status`, `effectiveFrom`, `effectiveTo`),
    UNIQUE INDEX `rental_pricing_plans_tenant_code_version_key`(`workspaceId`, `code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_price_versions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `rates` JSON NOT NULL,
    `changeReason` VARCHAR(191) NULL,
    `createdBy` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_price_versions_workspaceId_effectiveFrom_idx`(`workspaceId`, `effectiveFrom`),
    UNIQUE INDEX `rental_price_versions_workspaceId_sequence_key`(`workspaceId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_price_adjustment_plans` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
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

    INDEX `rental_price_adjustment_plans_planId_status_scheduledAt_idx`(`planId`, `status`, `scheduledAt`),
    UNIQUE INDEX `rental_price_adjustment_plans_workspaceId_code_key`(`workspaceId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_discount_plans` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `discountType` VARCHAR(191) NOT NULL,
    `discountValue` DECIMAL(12, 2) NOT NULL,
    `minimumSpend` DECIMAL(12, 2) NOT NULL,
    `thresholdAmount` DECIMAL(12, 2) NULL,
    `maximumDiscount` DECIMAL(12, 2) NULL,
    `appliesTo` VARCHAR(191) NOT NULL DEFAULT 'rental',
    `exclusiveGroup` VARCHAR(191) NULL,
    `stackableWithOtherPlans` BOOLEAN NOT NULL DEFAULT false,
    `customerScope` VARCHAR(191) NOT NULL DEFAULT 'all',
    `applicableItemGroupIds` JSON NOT NULL,
    `applicablePricingGroupIds` JSON NOT NULL,
    `applicableDayTypes` JSON NOT NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `stackableWithCoupon` BOOLEAN NOT NULL DEFAULT true,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NULL,
    `version` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_discount_plans_tenant_status_priority_idx`(`tenantId`, `status`, `priority`),
    INDEX `rental_discount_plans_group_idx`(`workspaceId`, `exclusiveGroup`),
    UNIQUE INDEX `rental_discount_plans_tenant_code_version_key`(`workspaceId`, `code`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_service_capacities` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `serviceId` VARCHAR(191) NOT NULL,
    `locationId` VARCHAR(191) NOT NULL,
    `windowStart` DATETIME(3) NOT NULL,
    `windowEnd` DATETIME(3) NOT NULL,
    `totalCapacity` INTEGER NOT NULL,
    `reservedQuantity` INTEGER NOT NULL DEFAULT 0,
    `usedQuantity` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_service_capacities_scope_idx`(`tenantId`, `workspaceId`, `serviceId`, `windowStart`),
    UNIQUE INDEX `rental_service_capacities_window_key`(`workspaceId`, `serviceId`, `locationId`, `windowStart`, `windowEnd`),
    UNIQUE INDEX `rental_service_capacities_scope_id_key`(`tenantId`, `workspaceId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_service_reservations` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `capacityId` VARCHAR(191) NOT NULL,
    `serviceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'reserved',
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `reservedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `usedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `releaseReason` VARCHAR(191) NULL,

    INDEX `rental_service_reservations_order_idx`(`tenantId`, `orderId`, `status`),
    INDEX `rental_service_reservations_capacity_idx`(`capacityId`, `status`),
    UNIQUE INDEX `rental_service_reservations_idempotency_key`(`tenantId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_value_added_services` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `serviceType` VARCHAR(191) NOT NULL,
    `billingUnit` VARCHAR(191) NOT NULL,
    `price` DECIMAL(12, 2) NOT NULL,
    `minimumQuantity` INTEGER NOT NULL DEFAULT 1,
    `maximumQuantity` INTEGER NOT NULL DEFAULT 1,
    `coverageLimit` DECIMAL(12, 2) NULL,
    `deductible` DECIMAL(12, 2) NULL,
    `termsVersion` VARCHAR(191) NOT NULL,
    `terms` TEXT NOT NULL,
    `applicableItemGroupIds` JSON NOT NULL,
    `applicableFulfillmentModes` JSON NULL,
    `applicableLocationIds` JSON NULL,
    `customerScope` VARCHAR(191) NOT NULL DEFAULT 'all',
    `selectionMode` VARCHAR(191) NOT NULL DEFAULT 'optional',
    `mandatoryRule` JSON NULL,
    `insuranceProviderStatus` VARCHAR(191) NULL,
    `insuranceProviderName` VARCHAR(191) NULL,
    `requiresCapacity` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `version` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_value_added_services_tenant_status_type_idx`(`tenantId`, `status`, `serviceType`),
    INDEX `rental_value_added_services_selection_idx`(`workspaceId`, `status`, `selectionMode`),
    UNIQUE INDEX `rental_value_added_services_tenant_code_version_key`(`workspaceId`, `code`, `version`),
    UNIQUE INDEX `rental_value_added_services_scope_id_key`(`tenantId`, `workspaceId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_value_added_service_versions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `serviceId` VARCHAR(191) NOT NULL,
    `serviceVersion` VARCHAR(191) NOT NULL,
    `termsVersion` VARCHAR(191) NOT NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_value_added_service_versions_scope_idx`(`tenantId`, `workspaceId`, `serviceId`, `createdAt`),
    UNIQUE INDEX `rental_value_added_service_versions_service_version_key`(`serviceId`, `serviceVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
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

-- CreateTable
CREATE TABLE `rental_rule_versions` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `config` JSON NOT NULL,
    `changeReason` VARCHAR(191) NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `effectiveFrom` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishedAt` DATETIME(3) NULL,
    `publishedBy` VARCHAR(191) NULL,
    `supersededAt` DATETIME(3) NULL,
    `previousVersion` VARCHAR(191) NULL,
    `restoredFromVersion` VARCHAR(191) NULL,
    `restoreReason` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedBy` VARCHAR(191) NULL,
    `voidReason` VARCHAR(191) NULL,

    INDEX `rental_rule_versions_tenant_status_published_idx`(`tenantId`, `status`, `publishedAt`),
    INDEX `rental_rule_versions_effective_idx`(`workspaceId`, `status`, `effectiveFrom`),
    UNIQUE INDEX `rental_rule_versions_tenant_version_key`(`workspaceId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_business_calendars` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `region` VARCHAR(191) NOT NULL DEFAULT 'CN',
    `version` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `sourceName` VARCHAR(191) NULL,
    `sourceUrl` VARCHAR(191) NULL,
    `sourcePublishedAt` DATETIME(3) NULL,
    `sourceVersionId` VARCHAR(191) NULL,
    `sourceVersion` VARCHAR(191) NULL,
    `importedAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `supersededAt` DATETIME(3) NULL,
    `publishedBy` VARCHAR(191) NULL,
    `changeReason` VARCHAR(191) NULL,
    `previousVersion` VARCHAR(191) NULL,
    `restoredFromVersion` VARCHAR(191) NULL,
    `restoreReason` VARCHAR(191) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedBy` VARCHAR(191) NULL,
    `voidReason` VARCHAR(191) NULL,
    `publishDiff` JSON NULL,
    `overrideAudits` JSON NULL,
    `importPreservedOverrides` JSON NULL,
    `days` JSON NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_business_calendars_ws_year_status_idx`(`workspaceId`, `year`, `status`),
    INDEX `rental_business_calendars_tenantId_status_idx`(`tenantId`, `status`),
    UNIQUE INDEX `rental_business_calendars_ws_year_version_key`(`workspaceId`, `year`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_calendar_override_audits` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `year` INTEGER NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `reason` TEXT NOT NULL,
    `operator` VARCHAR(191) NULL,
    `at` DATETIME(3) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `batchId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_calendar_override_audits_workspaceId_year_version_idx`(`workspaceId`, `year`, `version`),
    INDEX `rental_calendar_override_audits_workspaceId_year_date_idx`(`workspaceId`, `year`, `date`),
    INDEX `rental_calendar_override_audits_tenantId_year_idx`(`tenantId`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_notification_templates` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `eventCode` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `providerTemplateCode` VARCHAR(191) NULL,
    `variableSchema` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'enabled',
    `version` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_notification_templates_tenant_status_event_idx`(`tenantId`, `status`, `eventCode`),
    UNIQUE INDEX `rental_notification_templates_tenant_event_channel_ver_key`(`workspaceId`, `eventCode`, `channel`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_quotes` (
    `sourceSnapshot` JSON NULL,
    `inventoryBasis` JSON NULL,
    `deliveryAddressSnapshot` JSON NULL,
    `rentalLineAmounts` JSON NULL,
    `originalOperationKey` VARCHAR(64) NULL,
    `originalInputHash` VARCHAR(64) NULL,
    `categoryVersionId` VARCHAR(191) NULL,
    `pricingContext` JSON NULL,
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `quoteNo` VARCHAR(191) NOT NULL,
    `categoryCode` VARCHAR(64) NOT NULL,
    `request` JSON NOT NULL,
    `membershipSnapshot` JSON NULL,
    `membershipBenefitEvaluations` JSON NULL,
    `chargeLines` JSON NOT NULL,
    `rentalAmount` DECIMAL(12, 2) NOT NULL,
    `discountAmount` DECIMAL(12, 2) NOT NULL,
    `couponAmount` DECIMAL(12, 2) NOT NULL,
    `serviceAmount` DECIMAL(12, 2) NOT NULL,
    `fulfillmentAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `depositAmount` DECIMAL(12, 2) NOT NULL,
    `preAuthAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `payableAmount` DECIMAL(12, 2) NOT NULL,
    `receivableAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxRate` DECIMAL(6, 4) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'CNY',
    `legacyDepositUnverified` BOOLEAN NOT NULL DEFAULT false,
    `legacyDepositUnverifiedAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `pricingPlanVersion` VARCHAR(191) NOT NULL,
    `rateSnapshot` JSON NULL,
    `ruleVersion` VARCHAR(191) NOT NULL,
    `ruleSnapshot` JSON NOT NULL,
    `inspectionTemplateSnapshots` JSON NULL,
    `calendarVersion` VARCHAR(191) NULL,
    `calendarSnapshot` JSON NULL,
    `calendarWarnings` JSON NULL,
    `appliedDiscountPlanIds` JSON NOT NULL,
    `discountEvaluations` JSON NULL,
    `serviceSnapshots` JSON NULL,
    `couponEvaluation` JSON NULL,
    `capabilitySnapshot` JSON NULL,
    `capabilityRequirementsSnapshot` JSON NULL,
    `capabilityDecisions` JSON NULL,
    `priceVersionId` VARCHAR(191) NULL,
    `priceVersion` VARCHAR(191) NULL,
    `customerCouponId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `consumedAt` DATETIME(3) NULL,
    `consumedOrderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_quotes_tenant_expires_consumed_idx`(`tenantId`, `expiresAt`, `consumedAt`),
    INDEX `rental_quotes_consumedOrderId_idx`(`consumedOrderId`),
    UNIQUE INDEX `rental_quotes_tenant_quote_no_key`(`workspaceId`, `quoteNo`),
    UNIQUE INDEX `rental_quotes_original_operation_key`(`tenantId`, `workspaceId`, `originalOperationKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_customer_coupons` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `templateCode` VARCHAR(191) NOT NULL,
    `templateName` VARCHAR(191) NOT NULL,
    `templateVersion` VARCHAR(191) NOT NULL,
    `discountType` VARCHAR(191) NOT NULL,
    `discountValue` DECIMAL(12, 2) NOT NULL,
    `minimumSpend` DECIMAL(12, 2) NOT NULL,
    `maximumDiscount` DECIMAL(12, 2) NULL,
    `appliesTo` VARCHAR(191) NOT NULL DEFAULT 'rental',
    `stackableWithDiscountPlans` BOOLEAN NOT NULL DEFAULT true,
    `applicableItemGroupIds` JSON NOT NULL,
    `grantReason` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'claimed',
    `claimedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `applicableRentalFrom` DATETIME(3) NULL,
    `applicableRentalTo` DATETIME(3) NULL,
    `effectiveFrom` DATETIME(3) NOT NULL,
    `effectiveTo` DATETIME(3) NOT NULL,
    `lockedOrderId` VARCHAR(191) NULL,
    `lockedAt` DATETIME(3) NULL,
    `lockedDiscountAmount` DECIMAL(12, 2) NULL,
    `redeemedOrderId` VARCHAR(191) NULL,
    `redeemedAt` DATETIME(3) NULL,
    `releasedAt` DATETIME(3) NULL,
    `releaseReason` VARCHAR(191) NULL,
    `expiredAt` DATETIME(3) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidReason` VARCHAR(191) NULL,

    INDEX `rental_customer_coupons_tenant_customer_status_idx`(`tenantId`, `customerId`, `status`),
    INDEX `rental_customer_coupons_tenant_template_customer_idx`(`tenantId`, `templateId`, `customerId`),
    INDEX `rental_customer_coupons_lockedOrderId_idx`(`lockedOrderId`),
    INDEX `rental_customer_coupons_redeemedOrderId_idx`(`redeemedOrderId`),
    INDEX `rental_customer_coupons_template_status_idx`(`tenantId`, `templateId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_reward_ledger_entries` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
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
    UNIQUE INDEX `rental_reward_ledger_tenant_idempotency_key`(`workspaceId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_benefit_accounts` (
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `pointsBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `marketingBalance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `availableRewardCouponCount` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_benefit_accounts_tenant_customer_idx`(`tenantId`, `customerId`),
    PRIMARY KEY (`workspaceId`, `customerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_referrals` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `inviteeCustomerId` VARCHAR(191) NOT NULL,
    `referrerCustomerId` VARCHAR(191) NOT NULL,
    `registeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_referrals_tenant_referrer_idx`(`tenantId`, `referrerCustomerId`),
    UNIQUE INDEX `rental_referrals_tenant_invitee_key`(`workspaceId`, `inviteeCustomerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_notification_logs` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `templateVersion` VARCHAR(191) NOT NULL,
    `eventCode` VARCHAR(191) NOT NULL,
    `channel` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `recipientEncrypted` TEXT NULL,
    `recipientFingerprint` CHAR(64) NULL,
    `renderedTitle` VARCHAR(191) NOT NULL,
    `renderedBody` TEXT NOT NULL,
    `variables` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `revision` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `provider` VARCHAR(191) NOT NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `errorMessage` VARCHAR(191) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `lastAttemptAt` DATETIME(3) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `businessObjectType` VARCHAR(191) NULL,
    `businessObjectId` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rental_notification_logs_tenant_event_created_idx`(`tenantId`, `eventCode`, `createdAt`),
    INDEX `rental_notification_logs_tenant_status_created_idx`(`tenantId`, `status`, `createdAt`),
    INDEX `rental_notification_logs_templateId_idx`(`templateId`),
    INDEX `rental_notification_logs_ws_retry_idx`(`tenantId`, `workspaceId`, `status`, `nextAttemptAt`),
    INDEX `rental_notification_logs_sms_rate_idx`(`tenantId`, `workspaceId`, `channel`, `recipientFingerprint`, `createdAt`),
    UNIQUE INDEX `rental_notification_logs_scope_id_key`(`tenantId`, `workspaceId`, `id`),
    UNIQUE INDEX `rental_notification_logs_ws_idempotency_key`(`workspaceId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_notification_rate_buckets` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `scopeKey` VARCHAR(128) NOT NULL,
    `bucketStart` DATETIME(3) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_notification_rate_bucket_scope_idx`(`tenantId`, `workspaceId`, `bucketStart`),
    UNIQUE INDEX `rental_notification_rate_bucket_key`(`tenantId`, `workspaceId`, `scopeKey`, `bucketStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rental_order_idempotency_records` (
    `id` VARCHAR(191) NOT NULL,
    `tenantId` VARCHAR(191) NOT NULL,
    `workspaceId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `requestHash` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'succeeded',
    `response` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `rental_idempotency_tenant_order_action_idx`(`tenantId`, `orderId`, `action`),
    UNIQUE INDEX `rental_idempotency_tenant_action_key`(`workspaceId`, `action`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_currentWorkspaceId_fkey` FOREIGN KEY (`currentWorkspaceId`) REFERENCES `business_workspaces`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OperationLog` ADD CONSTRAINT `OperationLog_rentalOrderId_fkey` FOREIGN KEY (`rentalOrderId`) REFERENCES `rental_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OperationLog` ADD CONSTRAINT `OperationLog_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_workspaces` ADD CONSTRAINT `business_workspaces_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_workspaces` ADD CONSTRAINT `business_workspaces_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_workspaces` ADD CONSTRAINT `business_workspaces_categoryCode_categoryVersionId_fkey` FOREIGN KEY (`categoryCode`, `categoryVersionId`) REFERENCES `rental_category_versions`(`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_tenantId_userId_fkey` FOREIGN KEY (`tenantId`, `userId`) REFERENCES `User`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_members` ADD CONSTRAINT `workspace_members_tenantId_roleId_fkey` FOREIGN KEY (`tenantId`, `roleId`) REFERENCES `Role`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_core_state_snapshots` ADD CONSTRAINT `rental_core_state_snapshots_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_core_state_snapshots` ADD CONSTRAINT `rental_core_state_snapshots_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_business_state_snapshots` ADD CONSTRAINT `rental_business_state_snapshots_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_business_state_snapshots` ADD CONSTRAINT `rental_business_state_snapshots_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_profiles` ADD CONSTRAINT `customer_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_approved_profile_changes` ADD CONSTRAINT `customer_profile_change_customer_fk` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `customer_approved_profile_changes` ADD CONSTRAINT `customer_profile_change_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `customer_approved_profile_operations` ADD CONSTRAINT `customer_profile_operation_change_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `customerId`, `changeId`, `changeHash`) REFERENCES `customer_approved_profile_changes`(`tenantId`, `workspaceId`, `customerId`, `id`, `changeHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `customer_identity_verifications` ADD CONSTRAINT `customer_identity_verifications_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_identity_verifications` ADD CONSTRAINT `customer_identity_verifications_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_memberships` ADD CONSTRAINT `customer_memberships_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_memberships` ADD CONSTRAINT `customer_memberships_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_accounts` ADD CONSTRAINT `customer_accounts_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_accounts` ADD CONSTRAINT `customer_accounts_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_channel_profiles` ADD CONSTRAINT `client_channel_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_channel_workspaces` ADD CONSTRAINT `client_channel_workspaces_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_channel_workspaces` ADD CONSTRAINT `client_channel_workspaces_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `client_channel_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_channel_workspaces` ADD CONSTRAINT `client_channel_workspaces_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `website_channel_profiles` ADD CONSTRAINT `website_channel_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `website_assets` ADD CONSTRAINT `website_assets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mini_program_channels` ADD CONSTRAINT `mini_program_channels_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_wechat_identities` ADD CONSTRAINT `client_wechat_identities_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_wechat_identities` ADD CONSTRAINT `client_wechat_identities_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `mini_program_channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_wechat_identities` ADD CONSTRAINT `client_wechat_identities_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_delivery_addresses` ADD CONSTRAINT `customer_delivery_addresses_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_delivery_addresses` ADD CONSTRAINT `customer_delivery_addresses_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_order_delivery_snapshots` ADD CONSTRAINT `client_order_delivery_snapshots_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_order_delivery_snapshots` ADD CONSTRAINT `client_order_delivery_snapshots_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_order_delivery_snapshots` ADD CONSTRAINT `client_order_delivery_snapshots_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_registration_challenges` ADD CONSTRAINT `client_registration_challenges_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_registration_challenges` ADD CONSTRAINT `client_registration_challenges_tenantId_sourceWorkspaceId_fkey` FOREIGN KEY (`tenantId`, `sourceWorkspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_auth_sessions` ADD CONSTRAINT `client_auth_sessions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_auth_sessions` ADD CONSTRAINT `client_auth_sessions_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_auth_sessions` ADD CONSTRAINT `client_auth_sessions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_auth_sessions` ADD CONSTRAINT `client_auth_sessions_tenantId_wechatIdentityId_fkey` FOREIGN KEY (`tenantId`, `wechatIdentityId`) REFERENCES `client_wechat_identities`(`tenantId`, `id`) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_profiles` ADD CONSTRAINT `customer_corporate_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_profiles` ADD CONSTRAINT `customer_corporate_profiles_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE `customer_corporate_credit_ledger` ADD CONSTRAINT `customer_corporate_credit_ledger_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_credit_ledger` ADD CONSTRAINT `customer_corporate_credit_ledger_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE `customer_qualification_refs` ADD CONSTRAINT `customer_qualification_refs_currentRevisionId_fkey` FOREIGN KEY (`currentRevisionId`) REFERENCES `customer_qualification_revisions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_registration_settings` ADD CONSTRAINT `customer_membership_registration_settings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_reviews` ADD CONSTRAINT `customer_membership_reviews_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_reviews` ADD CONSTRAINT `customer_membership_reviews_tenantId_sourceWorkspaceId_fkey` FOREIGN KEY (`tenantId`, `sourceWorkspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_reviews` ADD CONSTRAINT `customer_membership_reviews_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_qualification_revisions` ADD CONSTRAINT `customer_qualification_revisions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_qualification_revisions` ADD CONSTRAINT `customer_qualification_revisions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_qualification_revisions` ADD CONSTRAINT `customer_qualification_revisions_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_qualification_revisions` ADD CONSTRAINT `customer_qualification_revisions_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `customer_membership_reviews`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_qualification_types` ADD CONSTRAINT `customer_membership_qualification_types_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_qualification_types` ADD CONSTRAINT `customer_membership_qualification_types_tenantId_workspaceI_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_memberships` ADD CONSTRAINT `customer_corporate_memberships_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_memberships` ADD CONSTRAINT `customer_corporate_memberships_tenantId_corporateCustomerId_fkey` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_corporate_memberships` ADD CONSTRAINT `customer_corporate_memberships_tenantId_personalCustomerId_fkey` FOREIGN KEY (`tenantId`, `personalCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_corporate_status_recipients` ADD CONSTRAINT `corporate_status_recipient_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `enterprise_corporate_status_recipients` ADD CONSTRAINT `corporate_status_recipient_company_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `enterprise_corporate_status_recipients` ADD CONSTRAINT `corporate_status_recipient_person_fk` FOREIGN KEY (`tenantId`, `recipientCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `enterprise_corporate_status_recipients` ADD CONSTRAINT `corporate_status_recipient_history_fk` FOREIGN KEY (`tenantId`, `historyId`, `corporateCustomerId`) REFERENCES `customer_status_history`(`tenantId`, `id`, `customerId`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `enterprise_corporate_status_recipients` ADD CONSTRAINT `corporate_status_recipient_relation_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`, `membershipId`, `recipientCustomerId`) REFERENCES `customer_corporate_memberships`(`tenantId`, `corporateCustomerId`, `id`, `personalCustomerId`) ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `enterprise_portal_tenant_settings` ADD CONSTRAINT `enterprise_portal_tenant_settings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_corporate_portals` ADD CONSTRAINT `enterprise_corporate_portals_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_corporate_portals` ADD CONSTRAINT `enterprise_corporate_portals_tenantId_corporateCustomerId_fkey` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_portal_grants` ADD CONSTRAINT `enterprise_portal_grants_tenantId_corporateCustomerId_fkey` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `enterprise_corporate_portals`(`tenantId`, `corporateCustomerId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_portal_grants` ADD CONSTRAINT `enterprise_portal_grants_tenantId_corporateCustomerId_membe_fkey` FOREIGN KEY (`tenantId`, `corporateCustomerId`, `membershipId`) REFERENCES `customer_corporate_memberships`(`tenantId`, `corporateCustomerId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_workflow_requests` ADD CONSTRAINT `enterprise_workflow_requests_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_workflow_requests` ADD CONSTRAINT `enterprise_workflow_requests_tenantId_applicantCustomerId_fkey` FOREIGN KEY (`tenantId`, `applicantCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_workflow_requests` ADD CONSTRAINT `enterprise_workflow_requests_tenantId_corporateCustomerId_fkey` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_invite_policies` ADD CONSTRAINT `enterprise_invite_policies_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_invites` ADD CONSTRAINT `enterprise_invites_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_invites` ADD CONSTRAINT `enterprise_invites_tenantId_corporateCustomerId_fkey` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_scope_policies` ADD CONSTRAINT `enterprise_scope_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_scope_policies` ADD CONSTRAINT `enterprise_scope_company_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_booking_approvals` ADD CONSTRAINT `enterprise_approval_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_booking_approvals` ADD CONSTRAINT `enterprise_approval_company_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_booking_approvals` ADD CONSTRAINT `enterprise_approval_applicant_fk` FOREIGN KEY (`tenantId`, `applicantCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_booking_approvals` ADD CONSTRAINT `enterprise_approval_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_extension_approvals` ADD CONSTRAINT `enterprise_extension_tenant_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_extension_approvals` ADD CONSTRAINT `enterprise_extension_company_fk` FOREIGN KEY (`tenantId`, `corporateCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_extension_approvals` ADD CONSTRAINT `enterprise_extension_applicant_fk` FOREIGN KEY (`tenantId`, `applicantCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_extension_approvals` ADD CONSTRAINT `enterprise_extension_workspace_fk` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_extension_approvals` ADD CONSTRAINT `enterprise_extension_order_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_rental_handoff_requests` ADD CONSTRAINT `enterprise_rental_handoff_requests_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_rental_handoff_requests` ADD CONSTRAINT `enterprise_rental_handoff_requests_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_rental_handoff_requests` ADD CONSTRAINT `enterprise_rental_handoff_requests_tenantId_workspaceId_ord_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enterprise_portal_operations` ADD CONSTRAINT `enterprise_portal_operations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_plans` ADD CONSTRAINT `customer_membership_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_plan_versions` ADD CONSTRAINT `customer_membership_plan_versions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_plan_versions` ADD CONSTRAINT `customer_membership_plan_versions_tenantId_planId_fkey` FOREIGN KEY (`tenantId`, `planId`) REFERENCES `customer_membership_plans`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_plan_assignments` ADD CONSTRAINT `customer_membership_plan_assignments_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_plan_assignments` ADD CONSTRAINT `customer_membership_plan_assignments_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_plan_assignments` ADD CONSTRAINT `customer_membership_plan_assignments_tenantId_planId_fkey` FOREIGN KEY (`tenantId`, `planId`) REFERENCES `customer_membership_plans`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_membership_plan_assignments` ADD CONSTRAINT `customer_membership_plan_assignments_tenantId_planVersionId_fkey` FOREIGN KEY (`tenantId`, `planVersionId`) REFERENCES `customer_membership_plan_versions`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_merge_mappings` ADD CONSTRAINT `customer_merge_mappings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_merge_mappings` ADD CONSTRAINT `customer_merge_mappings_tenantId_sourceCustomerId_fkey` FOREIGN KEY (`tenantId`, `sourceCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_merge_mappings` ADD CONSTRAINT `customer_merge_mappings_tenantId_targetCustomerId_fkey` FOREIGN KEY (`tenantId`, `targetCustomerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_sensitive_access_audits` ADD CONSTRAINT `customer_sensitive_access_audits_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_sensitive_access_audits` ADD CONSTRAINT `customer_sensitive_access_audits_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentPrintJob` ADD CONSTRAINT `DocumentPrintJob_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TBoxDevice` ADD CONSTRAINT `TBoxDevice_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_definitions` ADD CONSTRAINT `rental_category_definitions_code_recommendedVersionId_fkey` FOREIGN KEY (`code`, `recommendedVersionId`) REFERENCES `rental_category_versions`(`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_versions` ADD CONSTRAINT `rental_category_versions_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_version_policies` ADD CONSTRAINT `rental_category_version_policies_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `rental_category_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_governance_audits` ADD CONSTRAINT `rental_category_governance_audits_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_adoption_audits` ADD CONSTRAINT `rental_category_adoption_audits_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_adoption_preparations` ADD CONSTRAINT `rental_category_adoption_preparations_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_adoption_preparations` ADD CONSTRAINT `rental_category_adoption_preparations_targetVersionId_fkey` FOREIGN KEY (`targetVersionId`) REFERENCES `rental_category_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_category_preparation_batches` ADD CONSTRAINT `rental_category_preparation_batches_tenantId_workspaceId_pr_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `preparationId`) REFERENCES `rental_category_adoption_preparations`(`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_rental_profiles` ADD CONSTRAINT `tenant_rental_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_rental_profiles` ADD CONSTRAINT `tenant_rental_profiles_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_capability_instances` ADD CONSTRAINT `workspace_capability_instances_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_capability_instances` ADD CONSTRAINT `workspace_capability_instances_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_capability_audits` ADD CONSTRAINT `workspace_capability_audits_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workspace_capability_audits` ADD CONSTRAINT `workspace_capability_audits_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `capability_hook_audits` ADD CONSTRAINT `capability_hook_audits_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `capability_hook_audits` ADD CONSTRAINT `capability_hook_audits_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_coupon_templates` ADD CONSTRAINT `rental_coupon_templates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_coupon_templates` ADD CONSTRAINT `rental_coupon_templates_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_fulfillment_locations` ADD CONSTRAINT `rental_fulfillment_locations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_fulfillment_locations` ADD CONSTRAINT `rental_fulfillment_locations_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_fulfillment_locations` ADD CONSTRAINT `rental_fulfillment_locations_tenantId_organizationId_fkey` FOREIGN KEY (`tenantId`, `organizationId`) REFERENCES `OrganizationUnit`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_fulfillment_locations` ADD CONSTRAINT `rental_fulfillment_locations_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `rental_fulfillment_operators`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_item_groups` ADD CONSTRAINT `rental_item_groups_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_item_groups` ADD CONSTRAINT `rental_item_groups_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_item_groups` ADD CONSTRAINT `rental_item_groups_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_groups` ADD CONSTRAINT `rental_pricing_groups_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_groups` ADD CONSTRAINT `rental_pricing_groups_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_groups` ADD CONSTRAINT `rental_pricing_groups_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_group_members` ADD CONSTRAINT `rental_pricing_group_members_pricingGroupId_fkey` FOREIGN KEY (`pricingGroupId`) REFERENCES `rental_pricing_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_group_members` ADD CONSTRAINT `rental_pricing_group_members_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_bundle_components` ADD CONSTRAINT `rental_bundle_components_bundleItemGroupId_fkey` FOREIGN KEY (`bundleItemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_bundle_components` ADD CONSTRAINT `rental_bundle_components_componentItemGroupId_fkey` FOREIGN KEY (`componentItemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_assets` ADD CONSTRAINT `rental_assets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_assets` ADD CONSTRAINT `rental_assets_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_assets` ADD CONSTRAINT `rental_assets_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_assets` ADD CONSTRAINT `rental_assets_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `rental_fulfillment_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_asset_status_history` ADD CONSTRAINT `rental_asset_status_history_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_asset_status_history` ADD CONSTRAINT `rental_asset_status_history_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_asset_status_history` ADD CONSTRAINT `rental_asset_status_history_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `rental_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_attribute_unique_values` ADD CONSTRAINT `rental_attribute_unique_values_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_attribute_unique_values` ADD CONSTRAINT `rental_attribute_unique_values_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_balances` ADD CONSTRAINT `rental_stock_balances_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_balances` ADD CONSTRAINT `rental_stock_balances_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_balances` ADD CONSTRAINT `rental_stock_balances_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_balances` ADD CONSTRAINT `rental_stock_balances_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `rental_fulfillment_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_ledger_entries` ADD CONSTRAINT `rental_stock_ledger_entries_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_ledger_entries` ADD CONSTRAINT `rental_stock_ledger_entries_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_ledger_entries` ADD CONSTRAINT `rental_stock_ledger_entries_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_ledger_entries` ADD CONSTRAINT `rental_stock_ledger_entries_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `rental_fulfillment_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_dispositions` ADD CONSTRAINT `rental_stock_dispositions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_dispositions` ADD CONSTRAINT `rental_stock_dispositions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_dispositions` ADD CONSTRAINT `rental_stock_dispositions_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_stock_dispositions` ADD CONSTRAINT `rental_stock_dispositions_inspectionId_fkey` FOREIGN KEY (`inspectionId`) REFERENCES `rental_inspection_records`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_work_orders` ADD CONSTRAINT `rental_work_orders_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_work_orders` ADD CONSTRAINT `rental_work_orders_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_work_orders` ADD CONSTRAINT `rental_work_orders_dispositionId_fkey` FOREIGN KEY (`dispositionId`) REFERENCES `rental_stock_dispositions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_work_orders` ADD CONSTRAINT `rental_work_orders_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_orders` ADD CONSTRAINT `rental_orders_categoryCode_categoryVersionId_fkey` FOREIGN KEY (`categoryCode`, `categoryVersionId`) REFERENCES `rental_category_versions`(`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_orders` ADD CONSTRAINT `rental_orders_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_orders` ADD CONSTRAINT `rental_orders_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_orders` ADD CONSTRAINT `rental_orders_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_orders` ADD CONSTRAINT `rental_orders_fulfillmentLocationId_fkey` FOREIGN KEY (`fulfillmentLocationId`) REFERENCES `rental_fulfillment_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_document_snapshots` ADD CONSTRAINT `rental_order_document_snapshots_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_document_snapshots` ADD CONSTRAINT `rental_order_document_snapshots_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_document_snapshots` ADD CONSTRAINT `rental_order_document_snapshots_tenant_ws_order_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_funding_events` ADD CONSTRAINT `rental_funding_events_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_funding_events` ADD CONSTRAINT `rental_funding_events_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_funding_events` ADD CONSTRAINT `rental_funding_events_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_carrier_shipment_events` ADD CONSTRAINT `rental_carrier_shipment_events_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_carrier_shipment_events` ADD CONSTRAINT `rental_carrier_shipment_events_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_carrier_shipment_events` ADD CONSTRAINT `rental_carrier_shipment_events_tenant_ws_order_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_offline_payment_registrations` ADD CONSTRAINT `rental_offline_payment_registrations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_offline_payment_registrations` ADD CONSTRAINT `rental_offline_payment_registrations_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_offline_payment_registrations` ADD CONSTRAINT `rental_offline_payment_registrations_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_payment_intents` ADD CONSTRAINT `rental_payment_intents_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_payment_intents` ADD CONSTRAINT `rental_payment_intents_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_payment_intents` ADD CONSTRAINT `rental_payment_intents_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_payment_refunds` ADD CONSTRAINT `rental_payment_refunds_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_payment_refunds` ADD CONSTRAINT `rental_payment_refunds_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_payment_refunds` ADD CONSTRAINT `rental_payment_refunds_tenantId_workspaceId_orderId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_payment_refunds` ADD CONSTRAINT `rental_payment_refunds_paymentIntentId_fkey` FOREIGN KEY (`paymentIntentId`) REFERENCES `rental_payment_intents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_webhook_events` ADD CONSTRAINT `payment_webhook_events_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_reconciliation_batches` ADD CONSTRAINT `payment_reconciliation_batches_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_reconciliation_batches` ADD CONSTRAINT `payment_reconciliation_batches_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_reconciliation_lines` ADD CONSTRAINT `payment_reconciliation_lines_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `payment_reconciliation_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_extensions` ADD CONSTRAINT `rental_order_extensions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_extensions` ADD CONSTRAINT `rental_order_extensions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_extensions` ADD CONSTRAINT `rental_order_extensions_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_changes` ADD CONSTRAINT `rental_order_changes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_changes` ADD CONSTRAINT `rental_order_changes_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_changes` ADD CONSTRAINT `rental_order_changes_tenantId_workspaceId_orderId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_lines` ADD CONSTRAINT `rental_order_lines_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_lines` ADD CONSTRAINT `rental_order_lines_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_lines` ADD CONSTRAINT `rental_order_lines_pricingGroupId_fkey` FOREIGN KEY (`pricingGroupId`) REFERENCES `rental_pricing_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_reservations` ADD CONSTRAINT `rental_reservations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_reservations` ADD CONSTRAINT `rental_reservations_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_reservations` ADD CONSTRAINT `rental_reservations_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_reservations` ADD CONSTRAINT `rental_reservations_orderLineId_fkey` FOREIGN KEY (`orderLineId`) REFERENCES `rental_order_lines`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_reservations` ADD CONSTRAINT `rental_reservations_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_reservations` ADD CONSTRAINT `rental_reservations_locationId_fkey` FOREIGN KEY (`locationId`) REFERENCES `rental_fulfillment_locations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_allocations` ADD CONSTRAINT `rental_allocations_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_allocations` ADD CONSTRAINT `rental_allocations_orderLineId_fkey` FOREIGN KEY (`orderLineId`) REFERENCES `rental_order_lines`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_allocations` ADD CONSTRAINT `rental_allocations_itemGroupId_fkey` FOREIGN KEY (`itemGroupId`) REFERENCES `rental_item_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_allocations` ADD CONSTRAINT `rental_allocations_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `rental_assets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_inspection_templates` ADD CONSTRAINT `rental_inspection_templates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_inspection_templates` ADD CONSTRAINT `rental_inspection_templates_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_inspection_templates` ADD CONSTRAINT `rental_inspection_templates_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_inspection_records` ADD CONSTRAINT `rental_inspection_records_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_inspection_records` ADD CONSTRAINT `rental_inspection_records_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_inspection_records` ADD CONSTRAINT `rental_inspection_records_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_inspection_records` ADD CONSTRAINT `rental_inspection_records_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `rental_inspection_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_fulfillment_operators` ADD CONSTRAINT `rental_fulfillment_operators_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_fulfillment_operators` ADD CONSTRAINT `rental_fulfillment_operators_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_tenant_business_settings` ADD CONSTRAINT `rental_tenant_business_settings_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_tenant_business_settings` ADD CONSTRAINT `rental_tenant_business_settings_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_tenant_business_settings` ADD CONSTRAINT `rental_tenant_business_settings_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_approved_settings_changes` ADD CONSTRAINT `rental_approved_settings_changes_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `rental_approved_settings_operations` ADD CONSTRAINT `approved_settings_operation_change_fk` FOREIGN KEY (`tenantId`, `workspaceId`, `changeId`, `changeHash`) REFERENCES `rental_approved_settings_changes`(`tenantId`, `workspaceId`, `id`, `changeHash`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `rental_pricing_plans` ADD CONSTRAINT `rental_pricing_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_plans` ADD CONSTRAINT `rental_pricing_plans_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_pricing_plans` ADD CONSTRAINT `rental_pricing_plans_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_price_versions` ADD CONSTRAINT `rental_price_versions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_price_versions` ADD CONSTRAINT `rental_price_versions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_price_adjustment_plans` ADD CONSTRAINT `rental_price_adjustment_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_price_adjustment_plans` ADD CONSTRAINT `rental_price_adjustment_plans_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_price_adjustment_plans` ADD CONSTRAINT `rental_price_adjustment_plans_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `rental_pricing_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_discount_plans` ADD CONSTRAINT `rental_discount_plans_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_discount_plans` ADD CONSTRAINT `rental_discount_plans_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_discount_plans` ADD CONSTRAINT `rental_discount_plans_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_service_capacities` ADD CONSTRAINT `rental_service_capacities_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_service_capacities` ADD CONSTRAINT `rental_service_capacities_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_service_capacities` ADD CONSTRAINT `rental_service_capacities_tenantId_workspaceId_serviceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `serviceId`) REFERENCES `rental_value_added_services`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_service_capacities` ADD CONSTRAINT `rental_service_capacities_tenantId_workspaceId_locationId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `locationId`) REFERENCES `rental_fulfillment_locations`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_service_reservations` ADD CONSTRAINT `rental_service_reservations_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_service_reservations` ADD CONSTRAINT `rental_service_reservations_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_service_reservations` ADD CONSTRAINT `rental_service_reservations_tenantId_workspaceId_capacityId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `capacityId`) REFERENCES `rental_service_capacities`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_service_reservations` ADD CONSTRAINT `rental_service_reservations_tenantId_workspaceId_serviceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `serviceId`) REFERENCES `rental_value_added_services`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_service_reservations` ADD CONSTRAINT `rental_service_reservations_tenantId_workspaceId_orderId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `orderId`) REFERENCES `rental_orders`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_value_added_services` ADD CONSTRAINT `rental_value_added_services_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_value_added_services` ADD CONSTRAINT `rental_value_added_services_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_value_added_services` ADD CONSTRAINT `rental_value_added_services_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_value_added_service_versions` ADD CONSTRAINT `rental_value_added_service_versions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_value_added_service_versions` ADD CONSTRAINT `rental_value_added_service_versions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_value_added_service_versions` ADD CONSTRAINT `rental_value_added_service_versions_tenantId_workspaceId_se_fkey` FOREIGN KEY (`tenantId`, `workspaceId`, `serviceId`) REFERENCES `rental_value_added_services`(`tenantId`, `workspaceId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_rule_version_audits` ADD CONSTRAINT `rental_rule_version_audits_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_rule_version_audits` ADD CONSTRAINT `rental_rule_version_audits_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_rule_version_audits` ADD CONSTRAINT `rental_rule_version_audits_ruleVersionId_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `rental_rule_versions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_rule_versions` ADD CONSTRAINT `rental_rule_versions_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_rule_versions` ADD CONSTRAINT `rental_rule_versions_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_rule_versions` ADD CONSTRAINT `rental_rule_versions_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_business_calendars` ADD CONSTRAINT `rental_business_calendars_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_business_calendars` ADD CONSTRAINT `rental_business_calendars_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_calendar_override_audits` ADD CONSTRAINT `rental_calendar_override_audits_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_calendar_override_audits` ADD CONSTRAINT `rental_calendar_override_audits_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_templates` ADD CONSTRAINT `rental_notification_templates_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_templates` ADD CONSTRAINT `rental_notification_templates_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_quotes` ADD CONSTRAINT `rental_quotes_categoryCode_categoryVersionId_fkey` FOREIGN KEY (`categoryCode`, `categoryVersionId`) REFERENCES `rental_category_versions`(`categoryCode`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_quotes` ADD CONSTRAINT `rental_quotes_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_quotes` ADD CONSTRAINT `rental_quotes_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_quotes` ADD CONSTRAINT `rental_quotes_categoryCode_fkey` FOREIGN KEY (`categoryCode`) REFERENCES `rental_category_definitions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_customer_coupons` ADD CONSTRAINT `rental_customer_coupons_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_customer_coupons` ADD CONSTRAINT `rental_customer_coupons_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_customer_coupons` ADD CONSTRAINT `rental_customer_coupons_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `rental_coupon_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_reward_ledger_entries` ADD CONSTRAINT `rental_reward_ledger_entries_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_reward_ledger_entries` ADD CONSTRAINT `rental_reward_ledger_entries_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_benefit_accounts` ADD CONSTRAINT `rental_benefit_accounts_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_benefit_accounts` ADD CONSTRAINT `rental_benefit_accounts_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_referrals` ADD CONSTRAINT `rental_referrals_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_referrals` ADD CONSTRAINT `rental_referrals_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_logs` ADD CONSTRAINT `rental_notification_logs_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_logs` ADD CONSTRAINT `rental_notification_logs_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_logs` ADD CONSTRAINT `rental_notification_logs_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `rental_notification_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_rate_buckets` ADD CONSTRAINT `rental_notification_rate_buckets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_notification_rate_buckets` ADD CONSTRAINT `rental_notification_rate_buckets_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_idempotency_records` ADD CONSTRAINT `rental_order_idempotency_records_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_idempotency_records` ADD CONSTRAINT `rental_order_idempotency_records_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rental_order_idempotency_records` ADD CONSTRAINT `rental_order_idempotency_records_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `rental_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 原批准/快照/检查修订约束，Prisma源码不能表示CHECK，按原业务归属保留。
ALTER TABLE `rental_approved_settings_changes` ADD CONSTRAINT `approved_settings_change_revision_positive` CHECK (`baseRevision` >= 1);
ALTER TABLE `rental_approved_settings_operations` ADD CONSTRAINT `approved_settings_result_revision` CHECK (`baseRevision` >= 1 AND `resultRevision` = `baseRevision` + 1);
ALTER TABLE `rental_inspection_records` ADD CONSTRAINT `rental_inspection_revision_check` CHECK (`revision` BETWEEN 1 AND 4294967294);
ALTER TABLE `tenant_rental_profiles` ADD CONSTRAINT `tenant_profile_config_revision_check` CHECK (`configurationRevision` BETWEEN 1 AND 4294967294);
ALTER TABLE `rental_core_state_snapshots` ADD CONSTRAINT `core_snapshot_config_revision_check` CHECK (`configurationRevision` BETWEEN 1 AND 4294967294);
ALTER TABLE `customer_approved_profile_changes` ADD CONSTRAINT `customer_profile_change_revision_positive` CHECK (`baseRevision` >= 1);
ALTER TABLE `customer_approved_profile_operations` ADD CONSTRAINT `customer_profile_operation_revision` CHECK (`baseRevision` >= 1 AND `resultRevision` = `baseRevision` + 1);
