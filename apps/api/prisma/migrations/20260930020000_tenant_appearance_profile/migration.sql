-- 品牌与外观（管理后台 UI 身份）从客户端渠道配置中拆出为独立表：
-- 存品牌名/Logo/Favicon、主题色与四个圆角分组，并从 client_channel_profiles 一次性回填，保证观感不变。
-- 旧列暂留在 client_channel_profiles 作为过渡期回滚安全网，待所有读取切到新表并验证后，另行迁移 DROP。
CREATE TABLE `tenant_appearance_profiles` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `brandName` VARCHAR(120) NULL,
  `brandLogoUrl` VARCHAR(512) NULL,
  `faviconUrl` VARCHAR(512) NULL,
  `themeColor` VARCHAR(16) NULL,
  `adminCornerRadius` SMALLINT UNSIGNED NULL,
  `adminContainerRadius` SMALLINT UNSIGNED NULL,
  `adminButtonRadius` SMALLINT UNSIGNED NULL,
  `adminInputRadius` SMALLINT UNSIGNED NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `tenant_appearance_profiles_tenant_key`(`tenantId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 回填：把既有租户的品牌/外观从客户端渠道表复制过来（一租户一条）。
INSERT INTO `tenant_appearance_profiles`
  (`id`, `tenantId`, `revision`, `brandName`, `brandLogoUrl`, `faviconUrl`, `themeColor`,
   `adminCornerRadius`, `adminContainerRadius`, `adminButtonRadius`, `adminInputRadius`, `createdAt`, `updatedAt`)
SELECT
  UUID(), `tenantId`, 1, `brandName`, `brandLogoUrl`, `faviconUrl`, `themeColor`,
  `adminCornerRadius`, `adminContainerRadius`, `adminButtonRadius`, `adminInputRadius`, NOW(3), NOW(3)
FROM `client_channel_profiles`;
