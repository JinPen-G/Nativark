-- 只建本 Core 自有表；没有账号、角色、默认授权或业务 Seed。
CREATE TABLE `{{TABLE_PREFIX}}_locks` (
  `tenant_id` VARCHAR(36) NOT NULL,
  PRIMARY KEY (`tenant_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `{{TABLE}}` (
  `tenant_id` VARCHAR(36) NOT NULL,
  `id` VARCHAR(36) NOT NULL,
  `created_by` VARCHAR(36) NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `description` TEXT NOT NULL,
  `state` VARCHAR(20) NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenant_id`, `id`),
  INDEX `{{TABLE_PREFIX}}_owner` (`tenant_id`, `created_by`, `created_at`, `id`),
  CONSTRAINT `{{TABLE_PREFIX}}_state_valid` CHECK (`state` IN ('active', 'archived')),
  CONSTRAINT `{{TABLE_PREFIX}}_revision_valid` CHECK (`revision` BETWEEN 1 AND 9007199254740991)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `{{TABLE_PREFIX}}_operations` (
  `tenant_id` VARCHAR(36) NOT NULL,
  `operation_id` VARCHAR(36) NOT NULL,
  `actor_id` VARCHAR(36) NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `item_id` VARCHAR(36) NOT NULL,
  `result` JSON NOT NULL,
  PRIMARY KEY (`tenant_id`, `operation_id`),
  INDEX `{{TABLE_PREFIX}}_operation` (`tenant_id`, `item_id`),
  CONSTRAINT `{{TABLE_PREFIX}}_operation_item` FOREIGN KEY (`tenant_id`, `item_id`) REFERENCES `{{TABLE}}` (`tenant_id`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
