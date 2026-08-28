-- Review 修复：capability 生命周期审计补「变更后的完整配置快照」。
--
-- 为什么需要它：审计原先只记 `configVersion`（v1、v2…）。版本号能说明"配置变过"，
-- 但说不出"变成了什么"——CAM-01A 之后配置里已经承载可维护的兼容关系等结构化数据，
-- 只留版本号等于历史无法解释。补一列 JSON，写入时固化该次变更后的完整配置。
--
-- 存量行保持 NULL：那些变更发生时系统没有记录过配置本体，凭 configVersion 反推
-- 等于编造历史。NULL 明确表示"这条历史没有配置快照"，读取侧据此显示为未知而非空配置。
--
-- 安全性：单条 ADD COLUMN，可空、无默认值，不改既有列、不删数据、不动索引与外键。

ALTER TABLE `workspace_capability_audits`
  ADD COLUMN `configSnapshot` JSON NULL AFTER `configVersion`;
