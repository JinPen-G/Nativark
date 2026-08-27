-- 人工覆盖审计独立成表（需求 4.5.3 + 4.5.8「完整审计」）。
--
-- 早前这些记录塞在 rental_business_calendars.overrideAudits JSON 里，而该 JSON 会随整年
-- 日历一起被反复重写，实现只能靠 slice(-500) 截断，最早的记录被静默删除。
-- 审计是只追加的事实，不属于年度日历这份可变配置，因此按条落行、永不改写、永不截断。
--
-- 安全性：只 CreateTable + 从既有 JSON 回填，无 DROP/TRUNCATE/DELETE。
-- 回填用 JSON_TABLE（MySQL 8.0+），把每个年度版本已有的审计条目逐条展开成行；
-- 回填后旧 JSON 列保留原值不动（后续写入不再使用它），因此本迁移可重复执行前先判空。

CREATE TABLE `rental_calendar_override_audits` (
  `id`          VARCHAR(191) NOT NULL,
  `tenantId`    VARCHAR(191) NOT NULL,
  `workspaceId` VARCHAR(191) NOT NULL,
  `year`        INT          NOT NULL,
  `version`     VARCHAR(191) NOT NULL,
  `date`        VARCHAR(191) NOT NULL,
  `action`      VARCHAR(191) NOT NULL,
  `reason`      TEXT         NOT NULL,
  `operator`    VARCHAR(191) NULL,
  `at`          DATETIME(3)  NOT NULL,
  `before`      JSON         NULL,
  `after`       JSON         NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `rental_calendar_override_audits_workspaceId_year_version_idx` (`workspaceId`, `year`, `version`),
  INDEX `rental_calendar_override_audits_workspaceId_year_date_idx` (`workspaceId`, `year`, `date`),
  INDEX `rental_calendar_override_audits_tenantId_year_idx` (`tenantId`, `year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `rental_calendar_override_audits`
  ADD CONSTRAINT `rental_calendar_override_audits_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `rental_calendar_override_audits`
  ADD CONSTRAINT `rental_calendar_override_audits_tenantId_workspaceId_fkey`
  FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 回填既有 JSON 审计。UUID() 生成主键；`at` 缺失时退回该日历行的 updatedAt，
-- 因为审计行的 at 是 NOT NULL，而历史 JSON 里理论上总有 at（写入侧一直必填）。
INSERT INTO `rental_calendar_override_audits`
  (`id`, `tenantId`, `workspaceId`, `year`, `version`, `date`, `action`, `reason`, `operator`, `at`, `before`, `after`)
SELECT
  UUID(),
  c.`tenantId`,
  c.`workspaceId`,
  c.`year`,
  c.`version`,
  a.`date`,
  a.`action`,
  COALESCE(a.`reason`, ''),
  a.`operator`,
  COALESCE(STR_TO_DATE(a.`at`, '%Y-%m-%dT%H:%i:%s.%fZ'), c.`updatedAt`),
  a.`before`,
  a.`after`
FROM `rental_business_calendars` c
JOIN JSON_TABLE(
  c.`overrideAudits`,
  '$[*]' COLUMNS (
    `date`     VARCHAR(32)  PATH '$.date',
    `action`   VARCHAR(32)  PATH '$.action',
    `reason`   TEXT         PATH '$.reason',
    `operator` VARCHAR(191) PATH '$.operator',
    `at`       VARCHAR(64)  PATH '$.at',
    `before`   JSON         PATH '$.before',
    `after`    JSON         PATH '$.after'
  )
) a
WHERE c.`overrideAudits` IS NOT NULL
  AND JSON_TYPE(c.`overrideAudits`) = 'ARRAY';
