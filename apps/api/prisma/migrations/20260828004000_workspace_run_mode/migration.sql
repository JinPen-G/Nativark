-- CORE-EXT-02C（Review P1-4）：经营空间运行模式。
--
-- 为什么需要它：此前「缺品类必选能力」只在管理端显示一条告警，服务端没有任何门禁。
-- 隐藏按钮挡不住直接调 API，正式租户可以在能力不齐的情况下继续经营。
-- 但一律拒绝又会让演示与开发空间无法验证通用 Rental Core，而那是本阶段要保留的能力。
-- 因此把它做成空间的显式属性，由服务端按模式判定。
--
-- **默认值刻意是 development，而不是 production**：存量空间此前从未被这道门禁约束过，
-- 直接标成 production 会让所有缺必选能力的既有空间立刻无法报价下单——那是无法解释的回归。
-- development 如实描述了它们当前的状态（可跑通用流程、但未经生产条件核验）。
-- 新建空间同样默认 development；只有调用方显式请求或之后切换 production 时，应用层才会
-- 在同一事务/服务门禁中核验该品类的全部首期必选能力。尚未实现的必选能力同样算缺失。
-- 存量空间转正的路径是显式对账（能力页启用缺失的必选能力后，由有权限的人改运行模式），
-- 不做静默升级。
--
-- 安全性：只 ADD COLUMN 且带默认值，不改既有列、不删数据、无 DROP/TRUNCATE/DELETE。

ALTER TABLE `business_workspaces`
  ADD COLUMN `runMode` VARCHAR(191) NOT NULL DEFAULT 'development';
