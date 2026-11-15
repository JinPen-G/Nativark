-- 公共Core授权与成员分配；不创建任何Rental或示例业务表，不自动给存量用户开通新Core。
-- 现有组合库由获准的增量部署引入，新无Core宿主作为平台自己的迁移；本文件不自行执行。
CREATE TABLE `platform_core_access_locks` (
  `tenant_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `core_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (`tenant_id`, `core_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `platform_tenant_core_grants` (
  `tenant_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `core_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `operation_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (`tenant_id`, `core_id`),
  CONSTRAINT `platform_tenant_core_state` CHECK (`state` IN ('enabled', 'disabled')),
  CONSTRAINT `platform_tenant_core_revision` CHECK (`revision` BETWEEN 1 AND 9007199254740991)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `platform_member_core_assignments` (
  `tenant_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `core_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `user_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `state` VARCHAR(16) NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `operation_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (`tenant_id`, `core_id`, `user_id`),
  INDEX `platform_member_core_lookup` (`tenant_id`, `user_id`),
  CONSTRAINT `platform_member_core_state` CHECK (`state` IN ('assigned', 'revoked')),
  CONSTRAINT `platform_member_core_revision` CHECK (`revision` BETWEEN 1 AND 9007199254740991)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `platform_core_management_operations` (
  `tenant_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `core_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `operation_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `kind` VARCHAR(32) NOT NULL,
  `actor_tenant_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `actor_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `result` JSON NOT NULL,
  PRIMARY KEY (`tenant_id`, `core_id`, `operation_id`),
  CONSTRAINT `platform_core_management_kind` CHECK (`kind` IN ('tenant_grant', 'member_assignment'))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
