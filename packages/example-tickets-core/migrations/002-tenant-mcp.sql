-- 工单tenant宿主的可选授权记录；不是默认安装、账号Seed或第二套OAuth凭据账。
-- 仅MCP选装包声明本迁移；五表只引用本迁移自有表，不依赖MCP表的建表顺序。
-- 运行准入仍须同库核定正式MCP数据能力。原5份MCP SQL及其历史迁移保持不变。
-- 不存bearer/code/refresh token或OAuth state原文，不自动清理未决同意/原结果。
CREATE TABLE `example_tickets_mcp_policies` (
  `tenant_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `client_id` VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` INT UNSIGNED NOT NULL,
  `record_json` JSON NOT NULL,
  PRIMARY KEY (`tenant_id`, `client_id`),
  CONSTRAINT `example_tickets_mcp_policy_revision` CHECK (`revision` BETWEEN 1 AND 2147483647)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `example_tickets_mcp_consents` (
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tenant_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` INT UNSIGNED NOT NULL,
  `record_json` JSON NOT NULL,
  PRIMARY KEY (`id`),
  KEY `example_tickets_mcp_consent_owner` (`tenant_id`, `user_id`),
  CONSTRAINT `example_tickets_mcp_consent_revision` CHECK (`revision` IN (1, 2))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `example_tickets_mcp_grants` (
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tenant_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `consent_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `revision` INT UNSIGNED NOT NULL,
  `revoked` TINYINT UNSIGNED NOT NULL,
  `record_json` JSON NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `example_tickets_mcp_grant_consent` (`consent_id`),
  KEY `example_tickets_mcp_grant_owner` (`tenant_id`, `user_id`),
  CONSTRAINT `example_tickets_mcp_grant_revision` CHECK (`revision` BETWEEN 1 AND 2147483647),
  CONSTRAINT `example_tickets_mcp_grant_revoked` CHECK (`revoked` IN (0, 1)),
  CONSTRAINT `example_tickets_mcp_grant_consent_fk` FOREIGN KEY (`consent_id`)
    REFERENCES `example_tickets_mcp_consents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 人类显式选择的读取目标。唯一owner前沿不能因新授权、刷新token、查询变化或进程重启重置。
CREATE TABLE `example_tickets_mcp_goals` (
  `owner_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `tenant_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `user_id` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `record_json` JSON NOT NULL,
  PRIMARY KEY (`owner_key`),
  UNIQUE KEY `example_tickets_mcp_goal_id` (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `example_tickets_mcp_read_bindings` (
  `binding_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `goal_id` CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `record_json` JSON NOT NULL,
  PRIMARY KEY (`binding_key`),
  KEY `example_tickets_mcp_binding_goal` (`goal_id`),
  CONSTRAINT `example_tickets_mcp_binding_goal_fk` FOREIGN KEY (`goal_id`)
    REFERENCES `example_tickets_mcp_goals` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
