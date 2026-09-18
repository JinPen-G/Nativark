-- MP-R1：微信小程序渠道、发布范围与微信身份底座。
-- 纯新增结构；不改动客户、账号、会员、订单、库存、报价、支付与既有快照，
-- 也不回填或删除任何既有行。client_auth_sessions 只追加可空关联列。
SET @mp_at = CURRENT_TIMESTAMP(3);

CREATE TABLE `mini_program_channels` (
  `id`                    VARCHAR(191) NOT NULL,
  `tenantId`              VARCHAR(191) NOT NULL,
  `appId`                 VARCHAR(191) NOT NULL,
  `appSecretEncrypted`    TEXT NULL,
  `enabled`               BOOLEAN NOT NULL DEFAULT false,
  `revision`              INTEGER NOT NULL DEFAULT 1,
  `lastTestStatus`        VARCHAR(32) NOT NULL DEFAULT 'not_tested',
  `lastTestAt`            DATETIME(3) NULL,
  `lastTestError`         VARCHAR(500) NULL,
  `brandName`             VARCHAR(191) NULL,
  `brandLogoUrl`          VARCHAR(512) NULL,
  `customerServicePhone`  VARCHAR(32) NULL,
  `userAgreementVersion`  VARCHAR(64) NULL,
  `privacyPolicyVersion`  VARCHAR(64) NULL,
  `createdAt`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`             DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mini_program_channels_tenant_app_key` (`tenantId`, `appId`),
  UNIQUE KEY `mini_program_channels_app_id_key` (`appId`),
  KEY `mini_program_channels_tenant_enabled_idx` (`tenantId`, `enabled`),
  CONSTRAINT `mini_program_channels_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `mini_program_channel_workspaces` (
  `id`          VARCHAR(191) NOT NULL,
  `tenantId`    VARCHAR(191) NOT NULL,
  `channelId`   VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `enabled`     BOOLEAN NOT NULL DEFAULT true,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `mini_program_channel_workspace_key` (`channelId`, `workspaceId`),
  KEY `mini_program_channel_workspace_scope_idx` (`tenantId`, `workspaceId`, `enabled`),
  CONSTRAINT `mini_program_channel_workspaces_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `mini_program_channel_workspaces_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `mini_program_channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- 发布空间必须与渠道同租户：复合外键在库层表达，不能只靠服务层判断。
  CONSTRAINT `mini_program_channel_workspaces_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `client_wechat_identities` (
  `id`         VARCHAR(191) NOT NULL,
  `tenantId`   VARCHAR(191) NOT NULL,
  `channelId`  VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `openId`     VARCHAR(191) NOT NULL,
  `unionId`    VARCHAR(191) NULL,
  `appId`      VARCHAR(191) NOT NULL,
  `boundAt`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastUsedAt` DATETIME(3) NULL,
  `createdAt`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`  DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `client_wechat_identities_tenant_id_key` (`tenantId`, `id`),
  UNIQUE KEY `client_wechat_identity_open_key` (`tenantId`, `channelId`, `openId`),
  UNIQUE KEY `client_wechat_identity_customer_key` (`tenantId`, `channelId`, `customerId`),
  KEY `client_wechat_identity_customer_idx` (`tenantId`, `customerId`),
  CONSTRAINT `client_wechat_identities_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `client_wechat_identities_channelId_fkey` FOREIGN KEY (`channelId`) REFERENCES `mini_program_channels` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- 微信身份必须落在同租户客户主档上，杜绝跨租户绑定。
  CONSTRAINT `client_wechat_identities_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 仅追加可空列，并加复合外键；既有会话行保持 wechatIdentityId = NULL（历史运营/密码登录会话）。
ALTER TABLE `client_auth_sessions`
  ADD COLUMN `wechatIdentityId` VARCHAR(191) NULL;
ALTER TABLE `client_auth_sessions`
  ADD CONSTRAINT `client_auth_sessions_tenantId_wechatIdentityId_fkey`
    FOREIGN KEY (`tenantId`, `wechatIdentityId`) REFERENCES `client_wechat_identities` (`tenantId`, `id`) ON DELETE NO ACTION ON UPDATE CASCADE;
