-- 归属 crm Core；仅在选择本 Core 且获得部署授权后应用。不得放入零 Core 底座迁移。
-- 首次初始化与公共绑定共用宿主事务；此迁移不创建账号、角色、租户或默认授权。
CREATE TABLE `crm_pipeline_versions` (
  `tenant_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `version` BIGINT UNSIGNED NOT NULL,
  `definition` JSON NOT NULL,
  PRIMARY KEY (`tenant_id`, `version`),
  CONSTRAINT `crm_pipeline_version_valid` CHECK (`version` BETWEEN 1 AND 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `crm_settings` (
  `tenant_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `time_zone` VARCHAR(80) NOT NULL,
  `default_currency` CHAR(3) NOT NULL,
  `default_source_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `sources` JSON NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `pipeline_version` BIGINT UNSIGNED NOT NULL,
  `created_by` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `updated_by` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenant_id`),
  INDEX `crm_settings_pipeline` (`tenant_id`, `pipeline_version`),
  CONSTRAINT `crm_settings_revision_valid` CHECK (`revision` BETWEEN 1 AND 9007199254740991),
  CONSTRAINT `crm_settings_pipeline_valid` CHECK (`pipeline_version` BETWEEN 1 AND 9007199254740991),
  CONSTRAINT `crm_settings_pipeline_fk` FOREIGN KEY (`tenant_id`, `pipeline_version`)
    REFERENCES `crm_pipeline_versions` (`tenant_id`, `version`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `crm_setting_operations` (
  `tenant_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `operation_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `actor_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `result` JSON NOT NULL,
  PRIMARY KEY (`tenant_id`, `operation_id`),
  CONSTRAINT `crm_setting_operations_settings_fk` FOREIGN KEY (`tenant_id`)
    REFERENCES `crm_settings` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
