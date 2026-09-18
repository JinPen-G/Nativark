-- 租户统一会员。MySQL 8.0.16+（窗口函数、JSON_TABLE、强制 CHECK）。
-- 必须在停止会员/注册写入的维护窗口执行并事先备份；MySQL DDL 非事务性，失败后须检查
-- 已完成的阶段再恢复，不能把整个文件当作可回滚或可重复执行的事务。
-- 不关闭外键检查，不改旧迁移，不改客户/账号/订单/报价/库存以及订单、报价的 JSON 快照。
-- 所有映射及逐来源审计先完成并对账，最后才 DROP 旧表/空间列。
SET @tm_at = CURRENT_TIMESTAMP(3);

CREATE TEMPORARY TABLE `_tm_guard` (
  `finding` VARCHAR(191) NOT NULL,
  CONSTRAINT `tenant_membership_migration_guard` CHECK (`finding` = 'ok')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 未知状态、畸形权益不能被默默转换成可用会员/全租户权益。
INSERT INTO `_tm_guard`
SELECT 'unknown workspace membership status'
FROM `customer_workspace_links`
WHERE `status` NOT IN ('closed', 'exited', 'risk_restricted', 'suspended', 'pending_activation', 'active') LIMIT 1;
INSERT INTO `_tm_guard`
SELECT 'unknown corporate membership status or role'
FROM `customer_corporate_memberships`
WHERE `status` NOT IN ('exited', 'suspended', 'active') OR `role` NOT IN ('admin', 'employee') LIMIT 1;
INSERT INTO `_tm_guard`
SELECT 'plan version benefits must be an array'
FROM `customer_membership_plan_versions` WHERE JSON_TYPE(`benefits`) <> 'ARRAY' LIMIT 1;
INSERT INTO `_tm_guard`
SELECT 'assignment snapshot/benefits has an unsupported shape'
FROM `customer_membership_plan_assignments`
WHERE JSON_TYPE(`snapshot`) <> 'OBJECT'
   OR (JSON_CONTAINS_PATH(`snapshot`, 'one', '$.benefits') = 1
       AND JSON_TYPE(JSON_EXTRACT(`snapshot`, '$.benefits')) NOT IN ('ARRAY', 'NULL')) LIMIT 1;
INSERT INTO `_tm_guard`
SELECT 'plan version benefit must be an object'
FROM `customer_membership_plan_versions` v
JOIN JSON_TABLE(v.`benefits`, '$[*]' COLUMNS (`ord` FOR ORDINALITY)) j ON TRUE
WHERE JSON_TYPE(JSON_EXTRACT(v.`benefits`, CONCAT('$[', j.`ord` - 1, ']'))) <> 'OBJECT' LIMIT 1;
INSERT INTO `_tm_guard`
SELECT 'assignment benefit must be an object'
FROM `customer_membership_plan_assignments` a
JOIN JSON_TABLE(
  CASE WHEN JSON_TYPE(JSON_EXTRACT(a.`snapshot`, '$.benefits')) = 'ARRAY'
       THEN JSON_EXTRACT(a.`snapshot`, '$.benefits') ELSE JSON_ARRAY() END,
  '$[*]' COLUMNS (`ord` FOR ORDINALITY)
) j ON TRUE
WHERE JSON_TYPE(JSON_EXTRACT(a.`snapshot`, CONCAT('$.benefits[', j.`ord` - 1, ']'))) <> 'OBJECT' LIMIT 1;

-- 1. 映射。保留最早关系 ID/注册时间和首次订单；等级取 updatedAt/id 最新，状态取最严格。
-- 限制时间保留每类已知的最早发生时间，所有其他原时间戳在逐来源事件中保存。
CREATE TEMPORARY TABLE `_tm_members` ENGINE=InnoDB AS
SELECT l.`id`, l.`tenantId`, l.`customerId`,
       ROW_NUMBER() OVER (PARTITION BY l.`tenantId`, l.`customerId` ORDER BY l.`createdAt`, l.`id`) AS `keepRank`,
       FIRST_VALUE(l.`levelName`) OVER (
         PARTITION BY l.`tenantId`, l.`customerId` ORDER BY l.`updatedAt` DESC, l.`id` DESC
       ) AS `levelName`,
       FIRST_VALUE(l.`status`) OVER (
         PARTITION BY l.`tenantId`, l.`customerId`
         ORDER BY FIELD(l.`status`, 'closed', 'exited', 'risk_restricted', 'suspended', 'pending_activation', 'active'),
                  l.`updatedAt` DESC, l.`id` DESC
       ) AS `status`,
       MIN(l.`firstOrderAt`) OVER w AS `firstOrderAt`,
       MIN(l.`suspendedAt`) OVER w AS `suspendedAt`,
       MIN(l.`restrictedAt`) OVER w AS `restrictedAt`,
       MIN(l.`exitedAt`) OVER w AS `exitedAt`,
       MIN(l.`closedAt`) OVER w AS `closedAt`,
       MIN(l.`createdAt`) OVER w AS `createdAt`,
       MAX(l.`updatedAt`) OVER w AS `updatedAt`
FROM `customer_workspace_links` l
WINDOW w AS (PARTITION BY l.`tenantId`, l.`customerId`);

CREATE TEMPORARY TABLE `_tm_settings` ENGINE=InnoDB AS
SELECT s.`id`, s.`tenantId`,
       FIRST_VALUE(s.`id`) OVER (PARTITION BY s.`tenantId` ORDER BY s.`createdAt`, s.`id`) AS `targetId`,
       -- 缺设置的旧空间实际默认 manual，也算策略冲突，不能因另一空间 automatic 而放宽注册。
       CASE WHEN MIN(s.`registrationMode` = 'automatic') OVER w = 1
                  AND COUNT(*) OVER w = (SELECT COUNT(*) FROM `business_workspaces` b WHERE b.`tenantId` = s.`tenantId`)
            THEN 'automatic' ELSE 'manual' END AS `registrationMode`,
       MIN(s.`createdAt`) OVER w AS `createdAt`, MAX(s.`updatedAt`) OVER w AS `updatedAt`
FROM `customer_membership_registration_settings` s
WINDOW w AS (PARTITION BY s.`tenantId`);

CREATE TEMPORARY TABLE `_tm_corporate` ENGINE=InnoDB AS
SELECT c.`id`, c.`tenantId`, c.`corporateCustomerId`, c.`personalCustomerId`,
       FIRST_VALUE(c.`id`) OVER (
         PARTITION BY c.`tenantId`, c.`corporateCustomerId`, c.`personalCustomerId` ORDER BY c.`createdAt`, c.`id`
       ) AS `targetId`,
       CASE WHEN MIN(c.`role` = 'admin') OVER w = 1 THEN 'admin' ELSE 'employee' END AS `role`,
       CASE WHEN MAX(c.`status` = 'exited') OVER w = 1 THEN 'exited'
            WHEN MAX(c.`status` = 'suspended') OVER w = 1 THEN 'suspended'
            WHEN MIN(c.`effectiveTo`) OVER w <= MAX(c.`effectiveFrom`) OVER w
              OR MIN(c.`effectiveTo`) OVER w <= @tm_at THEN 'exited'
            ELSE 'active' END AS `status`,
       -- 有效期取交集：不得提前生效或延长任何来源的截止时间。MIN 忽略 NULL（无限期）。
       MAX(c.`effectiveFrom`) OVER w AS `effectiveFrom`, MIN(c.`effectiveTo`) OVER w AS `effectiveTo`,
       FIRST_VALUE(c.`department`) OVER latest AS `department`,
       FIRST_VALUE(c.`employeeNo`) OVER latest AS `employeeNo`,
       MIN(c.`createdAt`) OVER w AS `createdAt`, MAX(c.`updatedAt`) OVER w AS `updatedAt`
FROM `customer_corporate_memberships` c
WINDOW w AS (PARTITION BY c.`tenantId`, c.`corporateCustomerId`, c.`personalCustomerId`),
       latest AS (PARTITION BY c.`tenantId`, c.`corporateCustomerId`, c.`personalCustomerId` ORDER BY c.`updatedAt` DESC, c.`id` DESC);

-- 新键只转换冲突组及占用了迁移保留命名空间的旧键，避免新键撞上未修改的合法旧键。
-- SHA-256 输入含唯一 ID；映射表采用与业务表一致的字符集/排序规则和 UNIQUE，哈希碰撞
-- 或长度问题会在任何业务数据改动之前失败，不使用 INSERT IGNORE/REPLACE 丢记录。
CREATE TEMPORARY TABLE `_tm_review_keys` (
  `id` VARCHAR(191) NOT NULL PRIMARY KEY,
  `tenantId` VARCHAR(191) NOT NULL,
  `requestKey` VARCHAR(191) NULL,
  UNIQUE KEY (`tenantId`, `requestKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO `_tm_review_keys`
SELECT r.`id`, r.`tenantId`,
       CASE WHEN r.`requestKey` IS NULL THEN NULL
            WHEN COUNT(*) OVER (PARTITION BY r.`tenantId`, r.`requestKey`) > 1
              OR r.`requestKey` LIKE 'tm20260917:%'
            THEN CONCAT('tm20260917:', SHA2(CAST(JSON_ARRAY(r.`workspaceId`, r.`id`, r.`requestKey`) AS CHAR), 256))
            ELSE r.`requestKey` END
FROM `customer_membership_reviews` r;

CREATE TEMPORARY TABLE `_tm_challenge_keys` (
  `id` VARCHAR(191) NOT NULL PRIMARY KEY,
  `tenantId` VARCHAR(191) NOT NULL,
  `requestKey` VARCHAR(191) NULL,
  UNIQUE KEY (`tenantId`, `requestKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO `_tm_challenge_keys`
SELECT c.`id`, c.`tenantId`,
       CASE WHEN c.`requestKey` IS NULL THEN NULL
            WHEN COUNT(*) OVER (PARTITION BY c.`tenantId`, c.`requestKey`) > 1
              OR c.`requestKey` LIKE 'tm20260917:%'
            THEN CONCAT('tm20260917:', SHA2(CAST(JSON_ARRAY(c.`workspaceId`, c.`id`, c.`requestKey`) AS CHAR), 256))
            ELSE c.`requestKey` END
FROM `client_registration_challenges` c;

CREATE TEMPORARY TABLE `_tm_plan_codes` (
  `id` VARCHAR(191) NOT NULL PRIMARY KEY,
  `tenantId` VARCHAR(191) NOT NULL,
  `code` VARCHAR(191) NOT NULL,
  UNIQUE KEY (`tenantId`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO `_tm_plan_codes`
SELECT p.`id`, p.`tenantId`,
       CASE WHEN COUNT(*) OVER (PARTITION BY p.`tenantId`, p.`code`) > 1 OR LOCATE('_tm20260917_', p.`code`) > 0
            THEN CONCAT(LEFT(p.`code`, 91), '_ws_', LEFT(p.`workspaceId`, 16), '_tm20260917_',
                        SHA2(CAST(JSON_ARRAY(p.`workspaceId`, p.`id`) AS CHAR), 256))
            ELSE p.`code` END
FROM `customer_membership_plans` p;

-- 2. 权益逐条补范围，JSON_ARRAYAGG 的窗口 ORDER BY 保证原数组顺序，不使用无序聚合。
-- 显式 scope 保持原样；缺失或 JSON null 的 scope 限制在原空间，不能默认扩大成租户范围。
-- 空数组/缺失的 snapshot.benefits 不造出占位权益，快照中的其他字段原样保留。
CREATE TEMPORARY TABLE `_tm_version_benefits` ENGINE=InnoDB AS
SELECT rebuilt.`id`, rebuilt.`benefits`
FROM (
  SELECT entries.`id`, entries.`ord`,
         JSON_ARRAYAGG(
           CASE WHEN JSON_CONTAINS_PATH(entries.`benefit`, 'one', '$.scope') = 0
                  OR JSON_TYPE(JSON_EXTRACT(entries.`benefit`, '$.scope')) = 'NULL'
                THEN JSON_SET(entries.`benefit`, '$.scope', JSON_OBJECT('type', 'workspaces', 'workspaceIds', JSON_ARRAY(entries.`workspaceId`)))
                ELSE entries.`benefit` END
         ) OVER (PARTITION BY entries.`id` ORDER BY entries.`ord` ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS `benefits`
  FROM (
    SELECT v.`id`, v.`workspaceId`, j.`ord`, JSON_EXTRACT(v.`benefits`, CONCAT('$[', j.`ord` - 1, ']')) AS `benefit`
    FROM `customer_membership_plan_versions` v
    JOIN JSON_TABLE(v.`benefits`, '$[*]' COLUMNS (`ord` FOR ORDINALITY)) j ON TRUE
  ) entries
) rebuilt WHERE rebuilt.`ord` = 1;

CREATE TEMPORARY TABLE `_tm_assignment_benefits` ENGINE=InnoDB AS
SELECT rebuilt.`id`, rebuilt.`benefits`
FROM (
  SELECT entries.`id`, entries.`ord`,
         JSON_ARRAYAGG(
           CASE WHEN JSON_CONTAINS_PATH(entries.`benefit`, 'one', '$.scope') = 0
                  OR JSON_TYPE(JSON_EXTRACT(entries.`benefit`, '$.scope')) = 'NULL'
                THEN JSON_SET(entries.`benefit`, '$.scope', JSON_OBJECT('type', 'workspaces', 'workspaceIds', JSON_ARRAY(entries.`workspaceId`)))
                ELSE entries.`benefit` END
         ) OVER (PARTITION BY entries.`id` ORDER BY entries.`ord` ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS `benefits`
  FROM (
    SELECT a.`id`, a.`workspaceId`, j.`ord`, JSON_EXTRACT(a.`snapshot`, CONCAT('$.benefits[', j.`ord` - 1, ']')) AS `benefit`
    FROM `customer_membership_plan_assignments` a
    JOIN JSON_TABLE(
      CASE WHEN JSON_TYPE(JSON_EXTRACT(a.`snapshot`, '$.benefits')) = 'ARRAY'
           THEN JSON_EXTRACT(a.`snapshot`, '$.benefits') ELSE JSON_ARRAY() END,
      '$[*]' COLUMNS (`ord` FOR ORDINALITY)
    ) j ON TRUE
  ) entries
) rebuilt WHERE rebuilt.`ord` = 1;

-- 非空权益数组必须完成逐条映射且条数守恒；异常在业务表更新前中止。
INSERT INTO `_tm_guard`
SELECT 'version benefit mapping incomplete' FROM `customer_membership_plan_versions` v
LEFT JOIN `_tm_version_benefits` m ON m.`id` = v.`id`
WHERE JSON_LENGTH(v.`benefits`) > 0 AND (m.`id` IS NULL OR JSON_LENGTH(m.`benefits`) <> JSON_LENGTH(v.`benefits`)) LIMIT 1;
INSERT INTO `_tm_guard`
SELECT 'assignment benefit mapping incomplete' FROM `customer_membership_plan_assignments` a
LEFT JOIN `_tm_assignment_benefits` m ON m.`id` = a.`id`
WHERE JSON_TYPE(JSON_EXTRACT(a.`snapshot`, '$.benefits')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(a.`snapshot`, '$.benefits')) > 0
  AND (m.`id` IS NULL OR JSON_LENGTH(m.`benefits`) <> JSON_LENGTH(JSON_EXTRACT(a.`snapshot`, '$.benefits'))) LIMIT 1;

-- 只排序此时已生效且未到期的 active 授予。未来 active 保留，不能撤销当前授予。
CREATE TEMPORARY TABLE `_tm_current_assignments` ENGINE=InnoDB AS
SELECT a.`id`,
       ROW_NUMBER() OVER (PARTITION BY a.`tenantId`, a.`customerId` ORDER BY a.`createdAt` DESC, a.`id` DESC) AS `keepRank`,
       FIRST_VALUE(a.`id`) OVER (PARTITION BY a.`tenantId`, a.`customerId` ORDER BY a.`createdAt` DESC, a.`id` DESC) AS `winnerId`
FROM `customer_membership_plan_assignments` a
WHERE a.`status` = 'active' AND a.`effectiveFrom` <= @tm_at AND (a.`effectiveTo` IS NULL OR a.`effectiveTo` > @tm_at);

-- 保存对账基数；来源审核/验证码/版本/授予必须逐行存续。
CREATE TEMPORARY TABLE `_tm_counts` ENGINE=InnoDB AS
SELECT (SELECT COUNT(*) FROM `customer_workspace_links`) AS `links`,
       (SELECT COUNT(*) FROM `customer_membership_reviews`) AS `reviews`,
       (SELECT COUNT(*) FROM `client_registration_challenges`) AS `challenges`,
       (SELECT COUNT(*) FROM `customer_membership_plans`) AS `plans`,
       (SELECT COUNT(*) FROM `customer_membership_plan_versions`) AS `versions`,
       (SELECT COUNT(*) FROM `customer_membership_plan_assignments`) AS `assignments`,
       (SELECT COUNT(*) FROM `customer_corporate_memberships`) AS `corporate`,
       (SELECT COUNT(*) FROM `customer_membership_registration_settings`) AS `settings`;

CREATE TABLE `customer_memberships` (
  `id` VARCHAR(191) NOT NULL,
  `tenantId` VARCHAR(191) NOT NULL,
  `customerId` VARCHAR(191) NOT NULL,
  `levelName` VARCHAR(191) NOT NULL DEFAULT '普通会员',
  `status` VARCHAR(191) NOT NULL DEFAULT 'active',
  `firstOrderAt` DATETIME(3) NULL,
  `suspendedAt` DATETIME(3) NULL,
  `restrictedAt` DATETIME(3) NULL,
  `exitedAt` DATETIME(3) NULL,
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `customer_memberships_tenant_customer_key` (`tenantId`, `customerId`),
  KEY `customer_memberships_tenant_status_idx` (`tenantId`, `status`),
  CONSTRAINT `customer_memberships_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `customer_memberships_tenantId_customerId_fkey` FOREIGN KEY (`tenantId`, `customerId`) REFERENCES `customer_profiles` (`tenantId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 映射已验证唯一。先移除旧唯一键，避免多行原地改名出现暂态撞键；相关 FK 仍有其他索引支持。
ALTER TABLE `customer_membership_reviews` DROP INDEX `customer_membership_reviews_scope_request_key`;
ALTER TABLE `client_registration_challenges` DROP INDEX `client_registration_challenges_scope_request_key`;
ALTER TABLE `customer_membership_plans` DROP INDEX `customer_membership_plans_workspace_code_key`;

START TRANSACTION;
INSERT INTO `customer_memberships` (
  `id`, `tenantId`, `customerId`, `levelName`, `status`, `firstOrderAt`, `suspendedAt`, `restrictedAt`, `exitedAt`, `closedAt`, `createdAt`, `updatedAt`
)
SELECT `id`, `tenantId`, `customerId`, `levelName`, `status`, `firstOrderAt`, `suspendedAt`, `restrictedAt`, `exitedAt`, `closedAt`, `createdAt`, `updatedAt`
FROM `_tm_members` WHERE `keepRank` = 1;

-- 逐旧 link 追加租户会员状态事件（含完整原字段和目标 ID）；不覆写任何旧 workspace 历史。
INSERT INTO `customer_status_history` (
  `id`, `tenantId`, `customerId`, `scope`, `workspaceId`, `action`, `fromStatus`, `toStatus`, `reason`, `operator`, `at`, `createdAt`
)
SELECT UUID(), l.`tenantId`, l.`customerId`, 'membership', NULL, 'migrate_tenant_membership', l.`status`, m.`status`,
       CAST(JSON_OBJECT(
         'migration', '20260917010000_tenant_membership', 'membershipId', m.`id`,
         'source', JSON_OBJECT('id', l.`id`, 'workspaceId', l.`workspaceId`, 'levelName', l.`levelName`, 'status', l.`status`,
           'firstOrderAt', l.`firstOrderAt`, 'suspendedAt', l.`suspendedAt`, 'restrictedAt', l.`restrictedAt`,
           'exitedAt', l.`exitedAt`, 'closedAt', l.`closedAt`, 'createdAt', l.`createdAt`, 'updatedAt', l.`updatedAt`),
         'resultLevelName', m.`levelName`, 'rule', 'strictest_status_latest_level_earliest_registration'
       ) AS CHAR), 'migration:tenant_membership', @tm_at, @tm_at
FROM `customer_workspace_links` l
JOIN `customer_memberships` m ON m.`tenantId` = l.`tenantId` AND m.`customerId` = l.`customerId`;

-- 使用既有平台审计保存去掉的空间归属与改名映射，不增加第二套审计表。
INSERT INTO `OperationLog` (`id`, `tenantId`, `workspaceId`, `action`, `detail`, `createdAt`)
SELECT UUID(), s.`tenantId`, s.`workspaceId`, 'membership.migrate.registration_settings',
       JSON_OBJECT('migration', '20260917010000_tenant_membership', 'sourceId', s.`id`, 'targetId', m.`targetId`,
         'sourceWorkspaceId', s.`workspaceId`, 'registrationMode', s.`registrationMode`, 'resultMode', m.`registrationMode`,
         'createdAt', s.`createdAt`, 'updatedAt', s.`updatedAt`), @tm_at
FROM `customer_membership_registration_settings` s JOIN `_tm_settings` m ON m.`id` = s.`id`;

INSERT INTO `OperationLog` (`id`, `tenantId`, `workspaceId`, `action`, `detail`, `createdAt`)
SELECT UUID(), c.`tenantId`, c.`workspaceId`, 'membership.migrate.corporate',
       JSON_OBJECT('migration', '20260917010000_tenant_membership', 'sourceId', c.`id`, 'targetId', m.`targetId`,
         'sourceWorkspaceId', c.`workspaceId`, 'corporateCustomerId', c.`corporateCustomerId`, 'personalCustomerId', c.`personalCustomerId`,
         'source', JSON_OBJECT('role', c.`role`, 'status', c.`status`, 'department', c.`department`, 'employeeNo', c.`employeeNo`,
           'effectiveFrom', c.`effectiveFrom`, 'effectiveTo', c.`effectiveTo`, 'reason', c.`reason`, 'createdBy', c.`createdBy`,
           'createdAt', c.`createdAt`, 'updatedAt', c.`updatedAt`),
         'result', JSON_OBJECT('role', m.`role`, 'status', m.`status`, 'effectiveFrom', m.`effectiveFrom`, 'effectiveTo', m.`effectiveTo`)), @tm_at
FROM `customer_corporate_memberships` c JOIN `_tm_corporate` m ON m.`id` = c.`id`;

INSERT INTO `OperationLog` (`id`, `tenantId`, `workspaceId`, `action`, `detail`, `createdAt`)
SELECT UUID(), r.`tenantId`, r.`workspaceId`, 'membership.migrate.review',
       JSON_OBJECT('migration', '20260917010000_tenant_membership', 'reviewId', r.`id`, 'customerId', r.`customerId`,
         'sourceWorkspaceId', r.`workspaceId`, 'oldRequestKey', r.`requestKey`, 'requestKey', m.`requestKey`), @tm_at
FROM `customer_membership_reviews` r JOIN `_tm_review_keys` m ON m.`id` = r.`id`;

-- 不把验证码哈希、验证 token、注册 payload 或个人标识写入操作日志。
INSERT INTO `OperationLog` (`id`, `tenantId`, `workspaceId`, `action`, `detail`, `createdAt`)
SELECT UUID(), c.`tenantId`, c.`workspaceId`, 'membership.migrate.challenge',
       JSON_OBJECT('migration', '20260917010000_tenant_membership', 'challengeId', c.`id`,
         'sourceWorkspaceId', c.`workspaceId`, 'oldRequestKey', c.`requestKey`, 'requestKey', m.`requestKey`), @tm_at
FROM `client_registration_challenges` c JOIN `_tm_challenge_keys` m ON m.`id` = c.`id`;

INSERT INTO `OperationLog` (`id`, `tenantId`, `workspaceId`, `action`, `detail`, `createdAt`)
SELECT UUID(), p.`tenantId`, p.`workspaceId`, 'membership.migrate.plan',
       JSON_OBJECT('migration', '20260917010000_tenant_membership', 'planId', p.`id`,
         'sourceWorkspaceId', p.`workspaceId`, 'oldCode', p.`code`, 'code', m.`code`), @tm_at
FROM `customer_membership_plans` p JOIN `_tm_plan_codes` m ON m.`id` = p.`id`;

INSERT INTO `OperationLog` (`id`, `tenantId`, `workspaceId`, `action`, `detail`, `createdAt`)
SELECT UUID(), v.`tenantId`, v.`workspaceId`, 'membership.migrate.version',
       JSON_OBJECT('migration', '20260917010000_tenant_membership', 'planVersionId', v.`id`, 'planId', v.`planId`,
         'sourceWorkspaceId', v.`workspaceId`, 'rule', 'missing_benefit_scope_restricted_to_source_workspace'), @tm_at
FROM `customer_membership_plan_versions` v;

INSERT INTO `OperationLog` (`id`, `tenantId`, `workspaceId`, `action`, `detail`, `createdAt`)
SELECT UUID(), a.`tenantId`, a.`workspaceId`, 'membership.migrate.assignment',
       JSON_OBJECT('migration', '20260917010000_tenant_membership', 'assignmentId', a.`id`, 'customerId', a.`customerId`,
         'sourceWorkspaceId', a.`workspaceId`, 'planId', a.`planId`, 'planVersionId', a.`planVersionId`,
         'status', a.`status`, 'effectiveFrom', a.`effectiveFrom`, 'effectiveTo', a.`effectiveTo`,
         'revokedBy', a.`revokedBy`, 'revokedAt', a.`revokedAt`, 'revokeReason', a.`revokeReason`,
         'currentWinnerId', m.`winnerId`,
         'resultStatus', CASE WHEN a.`status` = 'active' AND a.`effectiveTo` <= @tm_at THEN 'expired'
                              WHEN m.`keepRank` > 1 THEN 'revoked' ELSE a.`status` END), @tm_at
FROM `customer_membership_plan_assignments` a LEFT JOIN `_tm_current_assignments` m ON m.`id` = a.`id`;

-- 3. 审计已保存，再更新保留行及删除被合并的设置/企业关系。客户、账号主档均不写入。
UPDATE `customer_membership_registration_settings` s JOIN `_tm_settings` m ON m.`id` = s.`id` AND m.`targetId` = s.`id`
SET s.`registrationMode` = m.`registrationMode`, s.`createdAt` = m.`createdAt`, s.`updatedAt` = m.`updatedAt`;
DELETE s FROM `customer_membership_registration_settings` s JOIN `_tm_settings` m ON m.`id` = s.`id` WHERE m.`targetId` <> s.`id`;

UPDATE `customer_corporate_memberships` c JOIN `_tm_corporate` m ON m.`id` = c.`id` AND m.`targetId` = c.`id`
SET c.`role` = m.`role`, c.`status` = m.`status`, c.`department` = m.`department`, c.`employeeNo` = m.`employeeNo`,
    c.`effectiveFrom` = m.`effectiveFrom`, c.`effectiveTo` = m.`effectiveTo`, c.`createdAt` = m.`createdAt`, c.`updatedAt` = m.`updatedAt`;
DELETE c FROM `customer_corporate_memberships` c JOIN `_tm_corporate` m ON m.`id` = c.`id` WHERE m.`targetId` <> c.`id`;

UPDATE `customer_membership_reviews` r JOIN `_tm_review_keys` m ON m.`id` = r.`id` SET r.`requestKey` = m.`requestKey`;
UPDATE `client_registration_challenges` c JOIN `_tm_challenge_keys` m ON m.`id` = c.`id` SET c.`requestKey` = m.`requestKey`;
UPDATE `customer_membership_plans` p JOIN `_tm_plan_codes` m ON m.`id` = p.`id` SET p.`code` = m.`code`;
UPDATE `customer_membership_plan_versions` v JOIN `_tm_version_benefits` m ON m.`id` = v.`id` SET v.`benefits` = CAST(m.`benefits` AS JSON);
UPDATE `customer_membership_plan_assignments` a JOIN `_tm_assignment_benefits` m ON m.`id` = a.`id`
SET a.`snapshot` = JSON_SET(a.`snapshot`, '$.benefits', CAST(m.`benefits` AS JSON));

UPDATE `customer_membership_plan_assignments`
SET `status` = 'expired', `updatedAt` = @tm_at
WHERE `status` = 'active' AND `effectiveTo` <= @tm_at;
UPDATE `customer_membership_plan_assignments` a JOIN `_tm_current_assignments` m ON m.`id` = a.`id`
SET a.`status` = 'revoked', a.`revokedAt` = @tm_at, a.`revokedBy` = 'migration:tenant_membership',
    a.`revokeReason` = CONCAT('租户会员统一迁移：跨空间当前有效授予合并，保留 ', m.`winnerId`, '；原空间 ', a.`workspaceId`),
    a.`updatedAt` = @tm_at
WHERE m.`keepRank` > 1;

-- 4. DROP 前对账。任何失败均留下旧表/空间列；审计与数据更新在同一事务中。
INSERT INTO `_tm_guard`
SELECT 'membership mapping incomplete' FROM `customer_workspace_links` l
LEFT JOIN `customer_memberships` m ON m.`tenantId` = l.`tenantId` AND m.`customerId` = l.`customerId`
WHERE m.`id` IS NULL LIMIT 1;
INSERT INTO `_tm_guard`
SELECT 'membership count mismatch'
WHERE (SELECT COUNT(*) FROM `customer_memberships`) <> (SELECT COUNT(*) FROM `_tm_members` WHERE `keepRank` = 1);
INSERT INTO `_tm_guard`
SELECT 'registration settings mapping incomplete' FROM `_tm_settings` m
LEFT JOIN `customer_membership_registration_settings` s ON s.`id` = m.`targetId`
WHERE s.`id` IS NULL LIMIT 1;
INSERT INTO `_tm_guard`
SELECT 'corporate mapping incomplete' FROM `_tm_corporate` m
LEFT JOIN `customer_corporate_memberships` c ON c.`id` = m.`targetId`
WHERE c.`id` IS NULL LIMIT 1;
INSERT INTO `_tm_guard`
SELECT 'review/challenge/plan/version/assignment row count changed' FROM `_tm_counts` n
WHERE n.`reviews` <> (SELECT COUNT(*) FROM `customer_membership_reviews`)
   OR n.`challenges` <> (SELECT COUNT(*) FROM `client_registration_challenges`)
   OR n.`plans` <> (SELECT COUNT(*) FROM `customer_membership_plans`)
   OR n.`versions` <> (SELECT COUNT(*) FROM `customer_membership_plan_versions`)
   OR n.`assignments` <> (SELECT COUNT(*) FROM `customer_membership_plan_assignments`);
INSERT INTO `_tm_guard`
SELECT 'membership source history count mismatch' FROM `_tm_counts` n
WHERE n.`links` <> (SELECT COUNT(*) FROM `customer_status_history`
  WHERE `action` = 'migrate_tenant_membership' AND `operator` = 'migration:tenant_membership' AND `at` = @tm_at);
INSERT INTO `_tm_guard`
SELECT 'source audit count mismatch' FROM `_tm_counts` n
WHERE n.`settings` + n.`corporate` + n.`reviews` + n.`challenges` + n.`plans` + n.`versions` + n.`assignments`
  <> (SELECT COUNT(*) FROM `OperationLog` WHERE `createdAt` = @tm_at
      AND JSON_UNQUOTE(JSON_EXTRACT(`detail`, '$.migration')) = '20260917010000_tenant_membership');
INSERT INTO `_tm_guard`
SELECT 'more than one current active assignment remains'
FROM `customer_membership_plan_assignments`
WHERE `status` = 'active' AND `effectiveFrom` <= @tm_at AND (`effectiveTo` IS NULL OR `effectiveTo` > @tm_at)
GROUP BY `tenantId`, `customerId` HAVING COUNT(*) > 1 LIMIT 1;
COMMIT;

-- 5. 收紧新租户索引，保留 plan/version/customer 的复合 tenant 外键。
-- 先加新索引再删旧索引，tenant 外键始终有可用的左前缀索引。
ALTER TABLE `customer_membership_registration_settings`
  ADD UNIQUE INDEX `customer_membership_registration_settings_tenantId_key` (`tenantId`);
ALTER TABLE `customer_membership_registration_settings`
  DROP FOREIGN KEY `customer_membership_registration_settings_tenantId_workspac_fkey`,
  DROP INDEX `customer_membership_registration_settings_workspaceId_key`,
  DROP INDEX `customer_membership_registration_settings_scope_key`,
  DROP COLUMN `workspaceId`;

ALTER TABLE `customer_membership_reviews`
  ADD UNIQUE INDEX `customer_membership_reviews_tenant_request_key` (`tenantId`, `requestKey`),
  ADD INDEX `customer_membership_reviews_tenant_status_type_idx` (`tenantId`, `status`, `reviewType`);
ALTER TABLE `customer_membership_reviews`
  DROP FOREIGN KEY `customer_membership_reviews_tenantId_workspaceId_fkey`,
  DROP INDEX `customer_membership_reviews_scope_status_type_idx`,
  CHANGE COLUMN `workspaceId` `sourceWorkspaceId` VARCHAR(191) NULL,
  ADD INDEX `customer_membership_reviews_source_workspace_idx` (`tenantId`, `sourceWorkspaceId`);
-- 开启外键检查时 ADD FK 使用 COPY；MySQL 不允许 COPY 在同条 ALTER 中 DROP/ADD FK。
ALTER TABLE `customer_membership_reviews`
  ADD CONSTRAINT `customer_membership_reviews_tenantId_sourceWorkspaceId_fkey`
    FOREIGN KEY (`tenantId`, `sourceWorkspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `customer_qualification_revisions`
  DROP FOREIGN KEY `customer_qualification_revisions_tenantId_workspaceId_fkey`;
ALTER TABLE `customer_qualification_revisions`
  ADD CONSTRAINT `customer_qualification_revisions_tenantId_workspaceId_fkey`
    FOREIGN KEY (`tenantId`, `workspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `customer_corporate_memberships`
  ADD UNIQUE INDEX `customer_corporate_memberships_tenant_company_person_key` (`tenantId`, `corporateCustomerId`, `personalCustomerId`);
ALTER TABLE `customer_corporate_memberships`
  DROP FOREIGN KEY `customer_corporate_memberships_tenantId_workspaceId_fkey`,
  DROP INDEX `customer_corporate_memberships_workspace_company_person_key`,
  DROP INDEX `customer_corporate_memberships_person_scope_status_idx`,
  DROP COLUMN `workspaceId`,
  ADD INDEX `customer_corporate_memberships_person_scope_status_idx` (`tenantId`, `personalCustomerId`, `status`);

ALTER TABLE `customer_membership_plans`
  ADD UNIQUE INDEX `customer_membership_plans_tenant_code_key` (`tenantId`, `code`);
ALTER TABLE `customer_membership_plans`
  DROP FOREIGN KEY `customer_membership_plans_tenantId_workspaceId_fkey`,
  DROP INDEX `customer_membership_plans_scope_type_status_idx`,
  DROP COLUMN `workspaceId`,
  ADD INDEX `customer_membership_plans_scope_type_status_idx` (`tenantId`, `targetType`, `status`);
ALTER TABLE `customer_membership_plan_versions`
  DROP FOREIGN KEY `customer_membership_plan_versions_tenantId_workspaceId_fkey`,
  DROP INDEX `customer_membership_plan_versions_scope_status_effective_idx`,
  DROP COLUMN `workspaceId`,
  ADD INDEX `customer_membership_plan_versions_scope_status_effective_idx` (`tenantId`, `status`, `effectiveFrom`);
ALTER TABLE `customer_membership_plan_assignments`
  DROP FOREIGN KEY `customer_membership_plan_assignments_tenantId_workspaceId_fkey`,
  DROP INDEX `customer_membership_plan_assignments_scope_customer_status_idx`,
  DROP COLUMN `workspaceId`,
  ADD INDEX `customer_membership_plan_assignments_scope_customer_status_idx` (`tenantId`, `customerId`, `status`);

ALTER TABLE `client_registration_challenges`
  ADD UNIQUE INDEX `client_registration_challenges_tenant_request_key` (`tenantId`, `requestKey`);
ALTER TABLE `client_registration_challenges`
  DROP FOREIGN KEY `client_registration_challenges_tenantId_workspaceId_fkey`,
  DROP INDEX `client_registration_challenges_lookup_idx`,
  CHANGE COLUMN `workspaceId` `sourceWorkspaceId` VARCHAR(191) NULL,
  ADD INDEX `client_registration_challenges_lookup_idx` (`tenantId`, `identifierHash`, `createdAt`),
  ADD INDEX `client_registration_challenges_source_workspace_idx` (`tenantId`, `sourceWorkspaceId`);
ALTER TABLE `client_registration_challenges`
  ADD CONSTRAINT `client_registration_challenges_tenantId_sourceWorkspaceId_fkey`
    FOREIGN KEY (`tenantId`, `sourceWorkspaceId`) REFERENCES `business_workspaces` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 无表通过外键引用旧 links；所有来源行已逐条进入 customer_status_history。
DROP TABLE `customer_workspace_links`;
DROP TEMPORARY TABLE `_tm_counts`, `_tm_current_assignments`, `_tm_assignment_benefits`, `_tm_version_benefits`,
  `_tm_plan_codes`, `_tm_challenge_keys`, `_tm_review_keys`, `_tm_corporate`, `_tm_settings`, `_tm_members`, `_tm_guard`;
