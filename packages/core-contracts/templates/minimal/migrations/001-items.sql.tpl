-- 只创建本 Core 的租户条目表。无账号、授权、初始业务数据；应用迁移须另获环境授权。
CREATE TABLE `{{TABLE}}` (
  `tenant_id` VARCHAR(80) COLLATE utf8mb4_bin NOT NULL,
  `id` VARCHAR(80) COLLATE utf8mb4_bin NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  PRIMARY KEY (`tenant_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
