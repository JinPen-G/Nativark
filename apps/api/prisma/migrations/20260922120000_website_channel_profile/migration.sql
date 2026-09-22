-- WEBSITE-CHANNEL-01：新增租户级「web 官网渠道」配置表。
--
-- 只存官网特有设定项（标语、Hero 主标题/副文案/大图、辅助色、页脚文案、联系地址、
-- 底部 CTA、SEO 与 Powered by / 官网启用开关）；商户名、Logo、用户协议、隐私政策、
-- 客服、帮助、发布服务继续复用通用的 client_channel_profiles，不在此重复。
-- 一租户一条（tenantId 唯一），保存时用 revision 乐观锁防止互相覆盖。

CREATE TABLE `website_channel_profiles` (
  `id`               VARCHAR(191) NOT NULL,
  `tenantId`         VARCHAR(191) NOT NULL,
  `revision`         INTEGER NOT NULL DEFAULT 1,
  `enabled`          BOOLEAN NOT NULL DEFAULT false,
  `slogan`           VARCHAR(120) NULL,
  `heroTitle`        VARCHAR(120) NULL,
  `heroDescription`  VARCHAR(400) NULL,
  `heroImageUrl`     VARCHAR(512) NULL,
  `secondaryColor`   VARCHAR(16) NULL,
  `footerText`       VARCHAR(600) NULL,
  `contactAddress`   VARCHAR(256) NULL,
  `ctaTitle`         VARCHAR(120) NULL,
  `ctaDescription`   VARCHAR(400) NULL,
  `seoTitle`         VARCHAR(120) NULL,
  `seoDescription`   VARCHAR(400) NULL,
  `seoKeywords`      VARCHAR(256) NULL,
  `showPoweredBy`    BOOLEAN NOT NULL DEFAULT true,
  `createdAt`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`        DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `website_channel_profiles_tenant_key` (`tenantId`),
  CONSTRAINT `website_channel_profiles_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
