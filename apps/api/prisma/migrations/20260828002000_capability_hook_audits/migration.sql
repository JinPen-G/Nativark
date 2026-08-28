-- CORE-EXT-02B：capability Hook 执行审计。
--
-- 为什么需要它：验收要求「可选提示可审计」。一次被放行但带提示的判定，事后必须能查出
-- 是哪个能力、哪个实现版本与配置版本、在哪个节点、基于什么依据给出的提示；能力自身
-- 故障导致的降级放行同样必须留痕，不能被吞成「能力不存在」。
--
-- 四类产物（阻止原因、提示、关联任务、费用依据）用 JSON 列而不是四张子表：它们只被
-- 整体读取，不需要按内部字段检索；拆表会把一次判定的写入变成五次，而它们必须与 Core
-- 的业务变更在**同一事务**里落库——事务回滚时审计要一起消失，否则会留下
-- 「提示已记、业务已回滚」的半成品。
--
-- 安全性：只 CreateTable + AddForeignKey，无 DROP/TRUNCATE/DELETE，不改任何既有表结构。
-- 时间戳排在 20260828001000 之后，保证不会出现「未应用的迁移排在已应用的迁移之前」。

CREATE TABLE `capability_hook_audits` (
  `id`                    VARCHAR(191) NOT NULL,
  `tenantId`              VARCHAR(191) NOT NULL,
  `workspaceId`           VARCHAR(191) NOT NULL,
  `point`                 VARCHAR(191) NOT NULL,
  `capability`            VARCHAR(191) NOT NULL,
  `implementationVersion` VARCHAR(191) NOT NULL,
  `configVersion`         VARCHAR(191) NOT NULL,
  `decision`              VARCHAR(191) NOT NULL,
  `failed`                BOOLEAN      NOT NULL DEFAULT false,
  `subjectType`           VARCHAR(191) NOT NULL,
  `subjectId`             VARCHAR(191) NOT NULL,
  `blockReasons`          JSON         NULL,
  `notices`               JSON         NULL,
  `linkedTasks`           JSON         NULL,
  `feeBases`              JSON         NULL,
  `operator`              VARCHAR(191) NULL,
  `at`                    DATETIME(3)  NOT NULL,
  `createdAt`             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `capability_hook_audits_ws_point_idx` (`workspaceId`, `point`),
  INDEX `capability_hook_audits_tenant_subject_idx` (`tenantId`, `subjectType`, `subjectId`),
  INDEX `capability_hook_audits_tenant_at_idx` (`tenantId`, `at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `capability_hook_audits`
  ADD CONSTRAINT `capability_hook_audits_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `capability_hook_audits`
  ADD CONSTRAINT `capability_hook_audits_tenantId_workspaceId_fkey`
  FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
