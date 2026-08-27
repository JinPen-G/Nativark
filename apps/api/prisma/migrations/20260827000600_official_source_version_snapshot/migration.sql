-- 官方来源版本：来源信息快照 + 数值序号（需求 4.5.2「来源版本不可变、可历史追溯」）。
--
-- 为什么要快照：读取历史版本时若去 join 来源主档，而主档允许改名称/URL/地区，
-- 一改就会让昨天登记的旧版本显示成新名称新 URL，租户引用旧版本也拿到改后的信息，
-- 等于历史版本的含义被事后改写。主档继续维护，但历史版本一律用登记当时的快照。
--
-- 为什么要 sequence：字符串版本号在 1.10 之后会被字典序排到 1.9 之前；而「先查最大值
-- 再 create」在并发下必然出错。改为整数序号 + (sourceId, year, sequence) 唯一键，
-- 并发撞号时由服务层转成明确的 409 或安全重试。
--
-- 安全性：只 ADD COLUMN + 从既有数据回填 + CreateIndex，无 DROP/TRUNCATE/DELETE。

ALTER TABLE `official_calendar_source_versions`
  ADD COLUMN `sequence` INT NULL,
  ADD COLUMN `sourceNameSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `sourceUrlSnapshot` VARCHAR(191) NULL,
  ADD COLUMN `regionSnapshot` VARCHAR(191) NULL;

-- 快照回填：迁移时点的主档值是可得的最佳真相。
UPDATE `official_calendar_source_versions` v
JOIN `official_calendar_sources` s ON s.`id` = v.`sourceId`
SET
  v.`sourceNameSnapshot` = s.`name`,
  v.`sourceUrlSnapshot` = s.`url`,
  v.`regionSnapshot` = s.`region`
WHERE v.`sourceNameSnapshot` IS NULL;

-- 序号回填：存量行的版本号都由服务端按 `1.N` 生成，因此 N+1 就是它的序号。
UPDATE `official_calendar_source_versions`
SET `sequence` = CAST(SUBSTRING_INDEX(`version`, '.', -1) AS UNSIGNED) + 1
WHERE `sequence` IS NULL;

-- 回填完成后再收紧为 NOT NULL：先加可空列再回填，才能在已有数据的库上安全执行。
ALTER TABLE `official_calendar_source_versions`
  MODIFY COLUMN `sequence` INT NOT NULL,
  MODIFY COLUMN `sourceNameSnapshot` VARCHAR(191) NOT NULL,
  MODIFY COLUMN `sourceUrlSnapshot` VARCHAR(191) NOT NULL,
  MODIFY COLUMN `regionSnapshot` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `official_calendar_source_versions_source_year_sequence_key`
  ON `official_calendar_source_versions` (`sourceId`, `year`, `sequence`);
