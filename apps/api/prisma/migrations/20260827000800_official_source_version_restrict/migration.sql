-- 官方来源版本外键改为 RESTRICT（不可变承诺的数据库兜底）。
--
-- 来源版本声明为「只追加、旧版本保留」，而原外键是 ON DELETE CASCADE：直接删来源
-- （直连库或未来新增删除入口）会级联清空全部不可变历史版本。改为 RESTRICT，
-- 仍有版本的来源不能删除，只能停用（isActive=false）。已引用它的空间日历与报价不受影响。
--
-- 安全性：只重建外键约束，不动数据，无 DROP TABLE/TRUNCATE/DELETE。

ALTER TABLE `official_calendar_source_versions`
  DROP FOREIGN KEY `official_calendar_source_versions_sourceId_fkey`;

ALTER TABLE `official_calendar_source_versions`
  ADD CONSTRAINT `official_calendar_source_versions_sourceId_fkey`
  FOREIGN KEY (`sourceId`) REFERENCES `official_calendar_sources`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
