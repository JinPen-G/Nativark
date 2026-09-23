-- WEBSITE-CHANNEL-04：租户官网品牌图片（Logo / Hero / 品类入口图）直接上传入库。
--
-- 数量少、体积小（每租户一个 Logo、一个 Hero、若干品类图），字节直接存库、由公开接口
-- 按 tenantCode + assetId 提供，避免为官网另建对象存储与公开图床。写回各图片 URL 字段。

CREATE TABLE `website_assets` (
  `id`        VARCHAR(191) NOT NULL,
  `tenantId`  VARCHAR(191) NOT NULL,
  `scene`     VARCHAR(32) NOT NULL,
  `mimeType`  VARCHAR(64) NOT NULL,
  `sizeBytes` INTEGER NOT NULL,
  `data`      LONGBLOB NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `website_assets_tenant_idx` (`tenantId`),
  CONSTRAINT `website_assets_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
