-- CLIENT-CHANNEL-01：客户端渠道配置改为租户级（小程序与 APP 共用）。
--
-- 1. 新增 client_channel_profiles（一租户一条：品牌、客服、协议名称/版本/外链/正文、帮助、横幅、登录方式开关、默认服务）
--    与 client_channel_workspaces（发布到客户端的服务空间）。
-- 2. 把 mini_program_channels 上的品牌/客服/协议字段搬到租户级配置（每租户取最近更新的渠道行），
--    发布空间从 mini_program_channel_workspaces 搬到 client_channel_workspaces，然后删除旧列与旧表。
-- 3. mini_program_channels 只保留微信凭证、启用状态与连通性测试结果；微信身份表不变。
-- 搬迁只读取既有行，不伪造协议正文；协议名称在有版本时按缺省名称补齐，正文留空由商户在后台填写。

CREATE TABLE `client_channel_profiles` (
  `id`                    VARCHAR(191) NOT NULL,
  `tenantId`              VARCHAR(191) NOT NULL,
  `revision`              INTEGER NOT NULL DEFAULT 1,
  `brandName`             VARCHAR(191) NULL,
  `brandLogoUrl`          VARCHAR(512) NULL,
  `customerServicePhone`  VARCHAR(32) NULL,
  `customerServiceHours`  VARCHAR(64) NULL,
  `userAgreementName`     VARCHAR(64) NULL,
  `userAgreementVersion`  VARCHAR(64) NULL,
  `userAgreementUrl`      VARCHAR(512) NULL,
  `userAgreementBody`     MEDIUMTEXT NULL,
  `privacyPolicyName`     VARCHAR(64) NULL,
  `privacyPolicyVersion`  VARCHAR(64) NULL,
  `privacyPolicyUrl`      VARCHAR(512) NULL,
  `privacyPolicyBody`     MEDIUMTEXT NULL,
  `helpIntro`             TEXT NULL,
  `helpFaqJson`           JSON NULL,
  `bannerTitle`           VARCHAR(64) NULL,
  `bannerSubtitle`        VARCHAR(120) NULL,
  `smsLoginEnabled`       BOOLEAN NOT NULL DEFAULT true,
  `passwordLoginEnabled`  BOOLEAN NOT NULL DEFAULT true,
  `defaultWorkspaceId`    VARCHAR(191) NULL,
  `createdAt`             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`             DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `client_channel_profiles_tenant_key` (`tenantId`),
  CONSTRAINT `client_channel_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `client_channel_workspaces` (
  `id`          VARCHAR(191) NOT NULL,
  `tenantId`    VARCHAR(191) NOT NULL,
  `profileId`   VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `enabled`     BOOLEAN NOT NULL DEFAULT true,
  `createdAt`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `client_channel_workspace_key` (`tenantId`, `workspaceId`),
  KEY `client_channel_workspace_scope_idx` (`tenantId`, `enabled`),
  CONSTRAINT `client_channel_workspaces_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `client_channel_workspaces_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `client_channel_profiles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  -- 发布空间必须与配置同租户：复合外键在库层表达，不能只靠服务层判断。
  CONSTRAINT `client_channel_workspaces_tenantId_workspaceId_fkey` FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 搬迁品牌/客服/协议：每租户取最近更新的一条小程序渠道行。
INSERT INTO `client_channel_profiles`
  (`id`, `tenantId`, `revision`, `brandName`, `brandLogoUrl`, `customerServicePhone`, `customerServiceHours`,
   `userAgreementName`, `userAgreementVersion`, `userAgreementUrl`,
   `privacyPolicyName`, `privacyPolicyVersion`, `privacyPolicyUrl`,
   `smsLoginEnabled`, `passwordLoginEnabled`, `createdAt`, `updatedAt`)
SELECT
  UUID(), `c`.`tenantId`, 1, `c`.`brandName`, `c`.`brandLogoUrl`, `c`.`customerServicePhone`, `c`.`customerServiceHours`,
  CASE WHEN `c`.`userAgreementVersion` IS NOT NULL THEN '用户服务协议' ELSE NULL END, `c`.`userAgreementVersion`, `c`.`userAgreementUrl`,
  CASE WHEN `c`.`privacyPolicyVersion` IS NOT NULL THEN '隐私政策' ELSE NULL END, `c`.`privacyPolicyVersion`, `c`.`privacyPolicyUrl`,
  true, true, `c`.`createdAt`, `c`.`updatedAt`
FROM `mini_program_channels` `c`
WHERE `c`.`id` = (
  SELECT `c2`.`id` FROM `mini_program_channels` `c2`
  WHERE `c2`.`tenantId` = `c`.`tenantId`
  ORDER BY `c2`.`updatedAt` DESC, `c2`.`id` ASC
  LIMIT 1
);

-- 搬迁发布空间：只取上一步选中的那条渠道行的发布记录。
INSERT INTO `client_channel_workspaces` (`id`, `tenantId`, `profileId`, `workspaceId`, `enabled`, `createdAt`)
SELECT UUID(), `w`.`tenantId`, `p`.`id`, `w`.`workspaceId`, `w`.`enabled`, `w`.`createdAt`
FROM `mini_program_channel_workspaces` `w`
JOIN `client_channel_profiles` `p` ON `p`.`tenantId` = `w`.`tenantId`
WHERE `w`.`channelId` = (
  SELECT `c2`.`id` FROM `mini_program_channels` `c2`
  WHERE `c2`.`tenantId` = `w`.`tenantId`
  ORDER BY `c2`.`updatedAt` DESC, `c2`.`id` ASC
  LIMIT 1
);

DROP TABLE `mini_program_channel_workspaces`;

ALTER TABLE `mini_program_channels`
  DROP COLUMN `brandName`,
  DROP COLUMN `brandLogoUrl`,
  DROP COLUMN `customerServicePhone`,
  DROP COLUMN `customerServiceHours`,
  DROP COLUMN `userAgreementVersion`,
  DROP COLUMN `userAgreementUrl`,
  DROP COLUMN `privacyPolicyVersion`,
  DROP COLUMN `privacyPolicyUrl`;
