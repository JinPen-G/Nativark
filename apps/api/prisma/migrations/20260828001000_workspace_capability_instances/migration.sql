-- CORE-EXT-02A：经营空间 capability 实例、配置版本与生命周期审计。
--
-- 时间戳刻意排在 `20260828000200_preserve_unverified_legacy_security_amount` 之后：
-- 本迁移最初写作 `20260828000100_*`，与既有的 `20260828000100_align_legacy_schema_baseline`
-- 撞了同一前缀。Prisma 按目录全名排序，因此那样也能确定顺序，但会出现「未应用的迁移
-- 排在已应用的迁移之前」——开发库里 `...000200` 已应用，乱序部署没有必要冒这个险。
--
-- 为什么需要这两张表：早前空间能力直接读品类定义的 defaultCapabilities 数组，于是
-- 「品类声明了这个 code」== 「该空间已启用该功能」。这让只有 code、没有可执行模块的能力
-- 被当成可用功能，也没有任何地方能表达暂停、停用、配置版本与升级审计。
--
-- **本迁移刻意不回填任何启用状态**：旧 capabilities 数组只是品类声明，不能据此认定
-- 某空间已经启用了某能力（任务台账明确要求）。没有实例行 = 从未启用；
-- 因此升级后所有空间的能力一律显示为「已声明」或「已声明但未实现」，
-- 由有权限的人显式启用后才产生实例行。这样不会凭空开放任何菜单或 API。
--
-- 安全性：只 CreateTable + AddForeignKey，无 DROP/TRUNCATE/DELETE，不改任何既有表结构，
-- 也不动开发库业务数据。重复部署由 Prisma 迁移记录保证不会重放。

CREATE TABLE `workspace_capability_instances` (
  `id`                    VARCHAR(191) NOT NULL,
  `tenantId`              VARCHAR(191) NOT NULL,
  `workspaceId`           VARCHAR(191) NOT NULL,
  `code`                  VARCHAR(191) NOT NULL,
  `status`                VARCHAR(191) NOT NULL,
  `implementationVersion` VARCHAR(191) NOT NULL,
  `configVersion`         VARCHAR(191) NOT NULL,
  `config`                JSON         NOT NULL,
  `revision`              INT          NOT NULL DEFAULT 0,
  `enabledAt`             DATETIME(3)  NULL,
  `pausedAt`              DATETIME(3)  NULL,
  `disabledAt`            DATETIME(3)  NULL,
  `updatedBy`             VARCHAR(191) NULL,
  `createdAt`             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`             DATETIME(3)  NOT NULL,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `workspace_capability_instances_ws_code_key` (`workspaceId`, `code`),
  INDEX `workspace_capability_instances_tenant_code_idx` (`tenantId`, `code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `workspace_capability_audits` (
  `id`                    VARCHAR(191) NOT NULL,
  `tenantId`              VARCHAR(191) NOT NULL,
  `workspaceId`           VARCHAR(191) NOT NULL,
  `code`                  VARCHAR(191) NOT NULL,
  `action`                VARCHAR(191) NOT NULL,
  `fromStatus`            VARCHAR(191) NULL,
  `toStatus`              VARCHAR(191) NOT NULL,
  `implementationVersion` VARCHAR(191) NULL,
  `configVersion`         VARCHAR(191) NULL,
  `reason`                TEXT         NOT NULL,
  `operator`              VARCHAR(191) NULL,
  `at`                    DATETIME(3)  NOT NULL,
  `createdAt`             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `workspace_capability_audits_ws_code_idx` (`workspaceId`, `code`),
  INDEX `workspace_capability_audits_tenant_at_idx` (`tenantId`, `at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `workspace_capability_instances`
  ADD CONSTRAINT `workspace_capability_instances_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_capability_instances`
  ADD CONSTRAINT `workspace_capability_instances_tenantId_workspaceId_fkey`
  FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_capability_audits`
  ADD CONSTRAINT `workspace_capability_audits_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `workspace_capability_audits`
  ADD CONSTRAINT `workspace_capability_audits_tenantId_workspaceId_fkey`
  FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
