-- 公共官方日历来源及不可变年度版本。
-- 沿原来源注册表、快照/sequence 与 RESTRICT 最终定义创建独立公共表。

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
  `id`                 VARCHAR(191) NOT NULL,
  `sourceId`           VARCHAR(191) NOT NULL,
  `year`               INT          NOT NULL,
  `version`            VARCHAR(191) NOT NULL,
  `sequence`           INT          NOT NULL,
  `sourceNameSnapshot` VARCHAR(191) NOT NULL,
  `sourceUrlSnapshot`  VARCHAR(191) NOT NULL,
  `regionSnapshot`     VARCHAR(191) NOT NULL,
  `publishedAt`        DATETIME(3)  NOT NULL,
  `importedAt`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `importedBy`         VARCHAR(191) NULL,
  `days`               JSON         NOT NULL,
  `createdAt`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `official_calendar_source_versions_source_year_version_key` (`sourceId`, `year`, `version`),
  UNIQUE INDEX `official_calendar_source_versions_source_year_sequence_key` (`sourceId`, `year`, `sequence`),
  INDEX `official_calendar_source_versions_year_idx` (`year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `official_calendar_source_versions`
  ADD CONSTRAINT `official_calendar_source_versions_sourceId_fkey`
  FOREIGN KEY (`sourceId`) REFERENCES `official_calendar_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
