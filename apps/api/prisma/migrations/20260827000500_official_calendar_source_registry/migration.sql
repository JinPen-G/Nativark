-- 公共官方日历来源注册表与来源版本（需求 4.5.2/4.5.8）。
--
-- 官方节假日数据是**公共基础来源**，由 SaaS 平台管理员维护：不得由经营空间直接导入
-- 原始数据，也不得导入后自动影响全部经营空间。因此这两张表都是平台级的，
-- 没有 tenantId / workspaceId——加上它们等于又把公共数据切回租户私有。
--
-- 来源版本只追加：同一来源同一年度的每次官方调整都新增一行，旧版本保留，
-- 供空间日历追溯自己当初引用的是哪一版官方数据（「已发布的经营空间日历、
-- 有效报价和订单不得被静默覆盖」）。
--
-- 安全性：只 CreateTable，无 DROP/TRUNCATE/DELETE，无需回填（此前不存在公共来源库）。

CREATE TABLE `official_calendar_sources` (
  `id`        VARCHAR(191) NOT NULL,
  `region`    VARCHAR(191) NOT NULL DEFAULT 'CN',
  `name`      VARCHAR(191) NOT NULL,
  `url`       VARCHAR(191) NOT NULL,
  `notes`     TEXT         NULL,
  `isActive`  BOOLEAN      NOT NULL DEFAULT true,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `official_calendar_sources_region_name_key` (`region`, `name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `official_calendar_source_versions` (
  `id`          VARCHAR(191) NOT NULL,
  `sourceId`    VARCHAR(191) NOT NULL,
  `year`        INT          NOT NULL,
  `version`     VARCHAR(191) NOT NULL,
  `publishedAt` DATETIME(3)  NOT NULL,
  `importedAt`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `importedBy`  VARCHAR(191) NULL,
  `days`        JSON         NOT NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `official_calendar_source_versions_source_year_version_key` (`sourceId`, `year`, `version`),
  INDEX `official_calendar_source_versions_year_idx` (`year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `official_calendar_source_versions`
  ADD CONSTRAINT `official_calendar_source_versions_sourceId_fkey`
  FOREIGN KEY (`sourceId`) REFERENCES `official_calendar_sources`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 空间年度日历记录它引用的公共来源版本（需求 4.5.7：发布记录必须保存官方来源版本）。
-- 只存标识与版本号、不加外键：来源注册表是平台级资源，删除公共来源不该级联影响
-- 租户的历史日历——追溯需要的是「当时引用了哪一版」这个事实本身。
ALTER TABLE `rental_business_calendars`
  ADD COLUMN `sourceVersionId` VARCHAR(191) NULL,
  ADD COLUMN `sourceVersion` VARCHAR(191) NULL;
