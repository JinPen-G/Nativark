-- 归属example-tickets Core。仅在选择该Core且完成部署授权后应用，公共无Core库不执行。
-- 同库身份和Core授权沿宿主读取；此处不新建用户、租户或默认授权。
CREATE TABLE `example_tickets_tenant_locks` (
  `tenant_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (`tenant_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `example_tickets` (
  `tenant_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `subject` VARCHAR(160) NOT NULL,
  `description` TEXT NOT NULL,
  `created_by` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `assignee_id` VARCHAR(36) COLLATE utf8mb4_bin NULL,
  `state` VARCHAR(20) NOT NULL,
  `revision` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenant_id`, `id`),
  INDEX `example_tickets_creator` (`tenant_id`, `created_by`, `created_at`, `id`),
  INDEX `example_tickets_assignee` (`tenant_id`, `assignee_id`, `created_at`, `id`),
  INDEX `example_tickets_state` (`tenant_id`, `state`, `created_at`, `id`),
  CONSTRAINT `example_tickets_state_valid` CHECK (`state` IN ('open', 'in_progress', 'closed')),
  CONSTRAINT `example_tickets_revision_valid` CHECK (`revision` BETWEEN 1 AND 9007199254740991)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE `example_ticket_operations` (
  `tenant_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `operation_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `actor_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `fingerprint` CHAR(64) NOT NULL,
  `ticket_id` VARCHAR(36) COLLATE utf8mb4_bin NOT NULL,
  `result` JSON NOT NULL,
  PRIMARY KEY (`tenant_id`, `operation_id`),
  INDEX `example_ticket_operations_object` (`tenant_id`, `ticket_id`),
  CONSTRAINT `example_ticket_operations_ticket` FOREIGN KEY (`tenant_id`, `ticket_id`) REFERENCES `example_tickets` (`tenant_id`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
