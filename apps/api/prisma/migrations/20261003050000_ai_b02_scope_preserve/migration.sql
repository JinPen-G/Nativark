-- AIN-03: preserve ONLY the byte-pinned standalone B02 scope in an isolated
-- upgrade clone, before the original Foundation creates its canonical root.
-- No old migration receipt, owner, profile, usage or business row is rewritten.
-- Fresh/current canonical chains merely create the empty provenance table.
-- An interrupted migration is NOT replayable: retain its receipt and restore
-- the verified pre-upgrade backup to a new isolated clone before retrying.

-- A durable, migration-owned CHECK guard keeps a failed phase visible. Do not
-- delete it or replay this SQL after an uncertain/failed migration receipt.
CREATE TABLE `_ai_b02_prepare_check` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `ai_b02_prepare_guard` CHECK (`ok` = 1)
);
SET @b02_scope_exists = (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_scopes');
SET @b02_legacy = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_scopes' AND COLUMN_NAME = 'updatedAt');
SET @b02_foundation = (SELECT COUNT(*) FROM `_prisma_migrations`
  WHERE migration_name = '20261003060000_ai_task_foundation'
    AND finished_at IS NOT NULL AND rolled_back_at IS NULL);
SET @b02_original = (SELECT COUNT(*) FROM `_prisma_migrations`
  WHERE migration_name = '20261003160000_ai_provider_profiles'
    AND checksum IN ('9cc1a6b407974f7d8028d8bd07a8f12b98375eadb990da869ca9a372dc91ea2f',
      'bdc9d0778f0250f6fb193398c97e83ebe390345e31f7f57b9800879e3bc4563f')
    AND finished_at IS NOT NULL AND rolled_back_at IS NULL);

-- No namespace collision, unfinished predecessor, missing old scope or mixed
-- Foundation/B02 shape can be silently interpreted as a fresh database.
INSERT INTO `_ai_b02_prepare_check` (`ok`) SELECT IF(
  @@FOREIGN_KEY_CHECKS = 1
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME IN ('ai_legacy_b02_scopes', 'ai_b02_scope_bridge_work')) = 0
  AND (SELECT COUNT(*) FROM `_prisma_migrations` WHERE finished_at IS NULL AND rolled_back_at IS NULL
    AND migration_name <> '20261003050000_ai_b02_scope_preserve') = 0
  AND (
    (@b02_scope_exists = 0 AND @b02_original = 0 AND @b02_foundation = 0)
    OR (@b02_scope_exists = 1 AND @b02_legacy = 0 AND @b02_foundation = 1
      AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_scopes' AND CONSTRAINT_NAME = 'ai_scopes_shape'
        AND CONSTRAINT_TYPE = 'CHECK' AND ENFORCED = 'YES') = 1)
    OR (@b02_scope_exists = 1 AND @b02_legacy = 1 AND @b02_foundation = 0 AND @b02_original = 1
      AND (SELECT COUNT(*) FROM `_prisma_migrations` WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 178
      AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_scopes') = 7
      AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_scopes'
        AND ((COLUMN_NAME = 'id' AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 36 AND IS_NULLABLE = 'NO')
          OR (COLUMN_NAME = 'scopeKey' AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 512 AND IS_NULLABLE = 'NO')
          OR (COLUMN_NAME IN ('tenantId', 'workspaceId') AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 191 AND IS_NULLABLE = 'YES')
          OR (COLUMN_NAME = 'kind' AND COLUMN_TYPE = 'enum(''platform'',''tenant'',''workspace'')' AND IS_NULLABLE = 'NO')
          OR (COLUMN_NAME IN ('createdAt', 'updatedAt') AND DATA_TYPE = 'datetime' AND DATETIME_PRECISION = 3 AND IS_NULLABLE = 'NO'))) = 7
      AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_scopes' AND CONSTRAINT_TYPE = 'CHECK') = 0
      AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_scopes' AND CONSTRAINT_NAME IN ('ai_scopes_tenant_fk', 'ai_scopes_workspace_fk')
        AND DELETE_RULE = 'RESTRICT' AND UPDATE_RULE = 'CASCADE') = 2
      AND (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_scopes' AND REFERENCED_TABLE_SCHEMA = DATABASE()
        AND ((CONSTRAINT_NAME = 'ai_scopes_tenant_fk' AND COLUMN_NAME = 'tenantId' AND REFERENCED_TABLE_NAME = 'Tenant' AND REFERENCED_COLUMN_NAME = 'id')
          OR (CONSTRAINT_NAME = 'ai_scopes_workspace_fk' AND REFERENCED_TABLE_NAME = 'business_workspaces'
            AND ((COLUMN_NAME = 'tenantId' AND REFERENCED_COLUMN_NAME = 'tenantId') OR (COLUMN_NAME = 'workspaceId' AND REFERENCED_COLUMN_NAME = 'id'))))) = 3
      AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_scopes') = 4
      AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_scopes' AND INDEX_NAME IN ('ai_scopes_scope_key', 'ai_scopes_owner_idx')) = 3
      AND (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME = 'ai_scopes') = 2
      AND (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'ai_provider_profiles' AND CONSTRAINT_NAME = 'ai_provider_profiles_scope_fk'
        AND REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'ai_scopes'
        AND ((COLUMN_NAME = 'scopeId' AND REFERENCED_COLUMN_NAME = 'id')
          OR (COLUMN_NAME = 'scopeKind' AND REFERENCED_COLUMN_NAME = 'kind'))) = 2
      AND (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
        AND EVENT_OBJECT_TABLE IN ('ai_scopes', 'ai_provider_profiles')) = 0)
  ), 1, 0);

-- Validate the legacy owner shape without inventing membership/permissions.
-- The new root's existing CHECK/FKs and UNIQUE remain the final enforcement.
SET @b02_sql = IF(@b02_legacy = 1,
  'INSERT INTO `_ai_b02_prepare_check` (`ok`) SELECT IF(COUNT(*) <= 10000 AND SUM(IF(
    REGEXP_LIKE(`id`, ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$'', ''c'')
    AND ((`kind` = ''platform'' AND `tenantId` IS NULL AND `workspaceId` IS NULL)
      OR (`kind` = ''tenant'' AND REGEXP_LIKE(`tenantId`, ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$'', ''c'') AND `workspaceId` IS NULL)
      OR (`kind` = ''workspace'' AND REGEXP_LIKE(`tenantId`, ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$'', ''c'')
        AND REGEXP_LIKE(`workspaceId`, ''^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$'', ''c''))), 0, 1)) = 0,
    1, IF(COUNT(*) = 0, 1, 0)) FROM `ai_scopes`',
  'INSERT INTO `_ai_b02_prepare_check` (`ok`) VALUES (1)');
PREPARE ai_b02_prepare_statement FROM @b02_sql;
EXECUTE ai_b02_prepare_statement;
DEALLOCATE PREPARE ai_b02_prepare_statement;

CREATE TABLE `ai_legacy_b02_scopes` (
  `id` VARCHAR(36) NOT NULL COMMENT 'Original B02 scope ID; never a new authorization',
  `kind` ENUM('platform','tenant','workspace') NOT NULL COMMENT 'Original scope kind, not a live principal',
  `scopeKey` VARCHAR(512) NOT NULL COMMENT 'Exact original key before canonical projection',
  `tenantId` VARCHAR(191) NULL COMMENT 'Original owner reference; no current access grant',
  `workspaceId` VARCHAR(191) NULL COMMENT 'Original workspace reference; no fallback resolution',
  `createdAt` DATETIME(3) NOT NULL COMMENT 'Exact original creation time',
  `updatedAt` DATETIME(3) NOT NULL COMMENT 'Exact original update time; immutable provenance',
  `sourceSqlSha256` CHAR(64) NOT NULL COMMENT 'Exact original B02 SQL-byte checksum',
  PRIMARY KEY (`id`),
  INDEX `ai_legacy_b02_scopes_owner` (`tenantId`,`workspaceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  COMMENT 'Immutable standalone B02 origin; not consulted for current authorization or routing';

SET @b02_sql = IF(@b02_legacy = 1,
  'INSERT INTO `ai_legacy_b02_scopes` (`id`,`kind`,`scopeKey`,`tenantId`,`workspaceId`,`createdAt`,`updatedAt`,`sourceSqlSha256`)
   SELECT `id`,`kind`,`scopeKey`,`tenantId`,`workspaceId`,`createdAt`,`updatedAt`,
     (SELECT checksum FROM `_prisma_migrations` WHERE migration_name = ''20261003160000_ai_provider_profiles''
       AND finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM `ai_scopes` ORDER BY `id`',
  'SELECT 1');
PREPARE ai_b02_prepare_statement FROM @b02_sql;
EXECUTE ai_b02_prepare_statement;
DEALLOCATE PREPARE ai_b02_prepare_statement;

-- MySQL keeps existing profile FKs pointing at the renamed work table until
-- the post-Foundation migration atomically rebinds them to the copied IDs.
SET @b02_sql = IF(@b02_legacy = 1,
  'RENAME TABLE `ai_scopes` TO `ai_b02_scope_bridge_work`', 'SELECT 1');
PREPARE ai_b02_prepare_statement FROM @b02_sql;
EXECUTE ai_b02_prepare_statement;
DEALLOCATE PREPARE ai_b02_prepare_statement;
DROP TABLE `_ai_b02_prepare_check`;
