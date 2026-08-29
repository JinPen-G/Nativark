-- CUSTOMER-01B：敏感资料访问审计。
--
-- 为什么需要独立一张表（需求 4.8.5 / 4.8.14）：证件号、证件影像、生物识别等资料必须
-- 「限制访问、脱敏展示并保留访问审计」，而访问审计与业务变更审计是两件事——
-- 业务审计回答「谁改了什么」，访问审计回答「谁看过什么」。后者没有状态变化可挂靠，
-- 因此不能塞进 customer_status_history：那张表的每行都要求 toStatus，
-- 一次纯读取没有目标状态，硬写一个假状态会污染状态时间线。
--
-- 只追加，不更新、不删除。`revealed` 区分「看了脱敏值」与「解密查看了明文」：
-- 前者是日常操作，后者需要单独授权，事后追责的粒度完全不同。
--
-- 安全性：单条 CREATE TABLE + 外键，无 DROP/TRUNCATE/DELETE，不改任何既有表结构。

CREATE TABLE `customer_sensitive_access_audits` (
  `id`          VARCHAR(191) NOT NULL,
  `tenantId`    VARCHAR(191) NOT NULL,
  -- 访问发生在哪个经营空间。跨空间读取同一主档是设计允许的（主档租户内共享），
  -- 但必须记下是从哪个空间发起的，否则无法按空间还原访问时间线。
  `workspaceId` VARCHAR(191) NULL,
  `customerId`  VARCHAR(191) NOT NULL,
  -- 被访问的资料类别：identity_no / qualification_ref / contact_phone / corporate_uscc …
  `field`       VARCHAR(191) NOT NULL,
  -- list / detail / export / reveal
  `action`      VARCHAR(191) NOT NULL,
  -- true 表示查看了明文（需单独授权）；false 表示只看到脱敏值。
  `revealed`    BOOLEAN      NOT NULL DEFAULT false,
  `operator`    VARCHAR(191) NULL,
  -- 依据的权限码。事后要能解释「他当时凭什么能看」。
  `permission`  VARCHAR(191) NULL,
  `reason`      TEXT         NULL,
  `at`          DATETIME(3)  NOT NULL,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  INDEX `customer_sensitive_access_customer_at_idx` (`tenantId`, `customerId`, `at`),
  INDEX `customer_sensitive_access_ws_at_idx` (`tenantId`, `workspaceId`, `at`),
  INDEX `customer_sensitive_access_operator_at_idx` (`tenantId`, `operator`, `at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customer_sensitive_access_audits`
  ADD CONSTRAINT `customer_sensitive_access_audits_tenantId_fkey`
  FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `customer_sensitive_access_audits`
  ADD CONSTRAINT `customer_sensitive_access_audits_tenantId_customerId_fkey`
  FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles`(`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
