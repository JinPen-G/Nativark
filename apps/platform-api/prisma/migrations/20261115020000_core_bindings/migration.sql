-- Core绑定与原初始化收据随本Core业务初始化在同一事务提交，授权锁复用平台已登记锁表。
-- 迁移由平台数据所有者登记并按目标环境授权执行，本文件只提供独立源码。
CREATE TABLE `platform_core_bindings` (
  `tenant_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `core_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `scope_hash` CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `container_type` VARCHAR(200) COLLATE utf8mb4_bin NULL,
  `container_id` VARCHAR(200) COLLATE utf8mb4_bin NULL,
  `binding_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `data_version` VARCHAR(80) NOT NULL,
  PRIMARY KEY (`tenant_id`, `core_id`, `scope_hash`),
  UNIQUE KEY `platform_core_binding_identity` (`tenant_id`, `core_id`, `binding_id`),
  CONSTRAINT `platform_core_binding_container` CHECK ((`container_type` IS NULL AND `container_id` IS NULL) OR (`container_type` IS NOT NULL AND `container_id` IS NOT NULL)),
  CONSTRAINT `platform_core_binding_revision` CHECK (`revision` BETWEEN 1 AND 9007199254740991)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `platform_core_binding_operations` (
  `tenant_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `core_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `scope_hash` CHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `operation_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `actor_tenant_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `actor_id` VARCHAR(200) COLLATE utf8mb4_bin NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `operation` JSON NOT NULL,
  `binding` JSON NOT NULL,
  PRIMARY KEY (`tenant_id`, `core_id`, `scope_hash`, `operation_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
