-- PRICE-02：年度日历的版本历史（需求 4.5.7）
--
-- 需求要求年度日历有「草稿、已发布、已被替代、已作废」四态，且
-- 「已发布版本不可直接修改。调整已发布内容时必须复制生成新草稿，新草稿发布后
--   原版本进入『已被替代』」「历史版本不得被后续改版覆盖」。
--
-- 原唯一键 (workspaceId, year) 每年只允许一行，结构上就无法同时保留
-- 已发布版本与新草稿，也逼得「编辑已发布日历」只能原地改——那正是需求禁止的。
-- 这里把唯一键换成 (workspaceId, year, version)。
--
-- 顺序：先加列 → 再换唯一键。存量每年只有一行，换键不会撞重复。
ALTER TABLE `rental_business_calendars`
  ADD COLUMN `supersededAt` DATETIME(3) NULL,
  ADD COLUMN `publishedBy` VARCHAR(191) NULL,
  ADD COLUMN `changeReason` VARCHAR(191) NULL,
  ADD COLUMN `previousVersion` VARCHAR(191) NULL;

-- 对账：换键前确认不存在 (workspaceId, year, version) 重复，否则新唯一键会建失败，
-- 与其让 DDL 报一个难读的 1062，不如在这里给出明确原因。
CREATE TABLE `_cal_ver_check` (
    `finding` VARCHAR(191) NOT NULL,
    CONSTRAINT `calendar_version_must_be_unique` CHECK (`finding` = 'ok')
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `_cal_ver_check` (`finding`)
SELECT CONCAT('同一空间同一年度存在重复版本号，无法建立新唯一键: ', COUNT(*))
FROM (
    SELECT `workspaceId`, `year`, `version`
    FROM `rental_business_calendars`
    GROUP BY `workspaceId`, `year`, `version`
    HAVING COUNT(*) > 1
) AS dup
HAVING COUNT(*) > 0;
DROP TABLE `_cal_ver_check`;

DROP INDEX `rental_business_calendars_tenant_year_key` ON `rental_business_calendars`;
CREATE UNIQUE INDEX `rental_business_calendars_ws_year_version_key`
  ON `rental_business_calendars`(`workspaceId`, `year`, `version`);
CREATE INDEX `rental_business_calendars_ws_year_status_idx`
  ON `rental_business_calendars`(`workspaceId`, `year`, `status`);
