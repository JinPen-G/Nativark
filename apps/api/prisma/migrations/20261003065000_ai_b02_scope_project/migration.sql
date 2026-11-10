-- AIN-03: complete the isolated B02 scope bridge after the original Foundation.
-- Normalize ONLY the new root's metadata key; keep original IDs and archive all
-- original fields, including the old key/updatedAt. This is not authorization.
-- Other old tables/receipts and UNKNOWN outcomes are never rewritten here.
-- Partial COMMIT/DDL must be observed, not resolved/replayed. Recovery uses the
-- verified pre-upgrade backup in a separately prechecked new isolated clone.

-- The migration-owned guard is dropped only after a fully verified phase;
-- a failure leaves evidence for backup-to-new-clone recovery, never cleanup.
CREATE TABLE `_ai_b02_project_check` (
  `ok` TINYINT NOT NULL,
  CONSTRAINT `ai_b02_project_guard` CHECK (`ok` = 1)
);
SET @b02_work = (SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ai_b02_scope_bridge_work');
INSERT INTO `_ai_b02_project_check` (`ok`) SELECT IF(
  @@FOREIGN_KEY_CHECKS = 1 AND @b02_work IN (0, 1)
  AND (SELECT COUNT(*) FROM `_prisma_migrations` WHERE migration_name = '20261003050000_ai_b02_scope_preserve'
    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) = 1
  AND (SELECT COUNT(*) FROM `_prisma_migrations` WHERE migration_name = '20261003060000_ai_task_foundation'
    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) = 1
  AND (SELECT COUNT(*) FROM `_prisma_migrations` WHERE finished_at IS NULL AND rolled_back_at IS NULL
    AND migration_name <> '20261003065000_ai_b02_scope_project') = 0
  AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_scopes' AND CONSTRAINT_NAME = 'ai_scopes_shape'
    AND CONSTRAINT_TYPE = 'CHECK' AND ENFORCED = 'YES') = 1
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ai_legacy_b02_scopes') = 8,
  1, 0);

-- Verify every original field before copying/removing the owned work table.
-- Binary string comparisons are intentional: a case-insensitive collation
-- cannot prove exact old IDs/keys/owner bytes survived the archive operation.
SET @b02_sql = IF(@b02_work = 1,
  'INSERT INTO `_ai_b02_project_check` (`ok`) SELECT IF(
    (SELECT COUNT(*) FROM `ai_scopes`) = 0
    AND (SELECT COUNT(*) FROM `ai_b02_scope_bridge_work`) <= 10000
    AND (SELECT COUNT(*) FROM `ai_b02_scope_bridge_work`) = (SELECT COUNT(*) FROM `ai_legacy_b02_scopes`)
    AND NOT EXISTS (SELECT 1 FROM `ai_b02_scope_bridge_work` w LEFT JOIN `ai_legacy_b02_scopes` a ON BINARY a.`id` = BINARY w.`id`
      WHERE a.`id` IS NULL OR NOT (BINARY a.`kind` <=> BINARY w.`kind`)
        OR NOT (BINARY a.`scopeKey` <=> BINARY w.`scopeKey`)
        OR NOT (BINARY a.`tenantId` <=> BINARY w.`tenantId`)
        OR NOT (BINARY a.`workspaceId` <=> BINARY w.`workspaceId`)
        OR NOT (a.`createdAt` <=> w.`createdAt`) OR NOT (a.`updatedAt` <=> w.`updatedAt`)
        OR a.`sourceSqlSha256` <> (SELECT checksum FROM `_prisma_migrations`
          WHERE migration_name = ''20261003160000_ai_provider_profiles'' AND finished_at IS NOT NULL AND rolled_back_at IS NULL))
    AND (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND REFERENCED_TABLE_NAME = ''ai_b02_scope_bridge_work'') = 2
    AND (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = ''ai_provider_profiles'' AND CONSTRAINT_NAME = ''ai_provider_profiles_scope_fk''
      AND REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ''ai_b02_scope_bridge_work''
      AND ((COLUMN_NAME = ''scopeId'' AND REFERENCED_COLUMN_NAME = ''id'')
        OR (COLUMN_NAME = ''scopeKind'' AND REFERENCED_COLUMN_NAME = ''kind''))) = 2,
    1, 0)',
  'INSERT INTO `_ai_b02_project_check` (`ok`) SELECT IF(COUNT(*) = 0, 1, 0) FROM `ai_legacy_b02_scopes`');
PREPARE ai_b02_project_statement FROM @b02_sql;
EXECUTE ai_b02_project_statement;
DEALLOCATE PREPARE ai_b02_project_statement;

-- This frozen migration expression matches aiPersistenceScopeColumns: ASCII
-- owner IDs use CHAR_LENGTH and the unambiguous length-prefixed canonical key.
-- UNIQUE and the original Foundation CHECK/FKs reject collisions/bad owners.
SET @b02_sql = IF(@b02_work = 1,
  'INSERT INTO `ai_scopes` (`id`,`kind`,`scopeKey`,`tenantId`,`workspaceId`,`createdAt`)
   SELECT `id`,`kind`, CASE `kind`
     WHEN ''platform'' THEN ''platform''
     WHEN ''tenant'' THEN CONCAT(''tenant:'', CHAR_LENGTH(`tenantId`), '':'', `tenantId`)
     WHEN ''workspace'' THEN CONCAT(''workspace:'', CHAR_LENGTH(`tenantId`), '':'', `tenantId`, '':'', CHAR_LENGTH(`workspaceId`), '':'', `workspaceId`)
   END, `tenantId`,`workspaceId`,`createdAt` FROM `ai_legacy_b02_scopes` ORDER BY `id`',
  'SELECT 1');
PREPARE ai_b02_project_statement FROM @b02_sql;
EXECUTE ai_b02_project_statement;
DEALLOCATE PREPARE ai_b02_project_statement;

-- MySQL rejects dropping/adding the same FK name in one ALTER (1826). Add a
-- protecting canonical FK first; every later DROP still leaves enforcement.
-- Restore the original name/actions for the existing later alignment SQL.
SET @b02_sql = IF(@b02_work = 1,
  'ALTER TABLE `ai_provider_profiles` ADD CONSTRAINT `ai_provider_profiles_scope_bridge_fk`
     FOREIGN KEY (`scopeId`,`scopeKind`) REFERENCES `ai_scopes` (`id`,`kind`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE ai_b02_project_statement FROM @b02_sql;
EXECUTE ai_b02_project_statement;
DEALLOCATE PREPARE ai_b02_project_statement;

SET @b02_sql = IF(@b02_work = 1,
  'ALTER TABLE `ai_provider_profiles` DROP FOREIGN KEY `ai_provider_profiles_scope_fk`', 'SELECT 1');
PREPARE ai_b02_project_statement FROM @b02_sql;
EXECUTE ai_b02_project_statement;
DEALLOCATE PREPARE ai_b02_project_statement;

SET @b02_sql = IF(@b02_work = 1,
  'ALTER TABLE `ai_provider_profiles` ADD CONSTRAINT `ai_provider_profiles_scope_fk`
     FOREIGN KEY (`scopeId`,`scopeKind`) REFERENCES `ai_scopes` (`id`,`kind`) ON DELETE RESTRICT ON UPDATE CASCADE',
  'SELECT 1');
PREPARE ai_b02_project_statement FROM @b02_sql;
EXECUTE ai_b02_project_statement;
DEALLOCATE PREPARE ai_b02_project_statement;

SET @b02_sql = IF(@b02_work = 1,
  'ALTER TABLE `ai_provider_profiles` DROP FOREIGN KEY `ai_provider_profiles_scope_bridge_fk`', 'SELECT 1');
PREPARE ai_b02_project_statement FROM @b02_sql;
EXECUTE ai_b02_project_statement;
DEALLOCATE PREPARE ai_b02_project_statement;

SET @b02_sql = IF(@b02_work = 1,
  'INSERT INTO `_ai_b02_project_check` (`ok`) SELECT IF(
    (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND REFERENCED_TABLE_NAME = ''ai_b02_scope_bridge_work'') = 0
    AND (SELECT COUNT(*) FROM `ai_scopes`) = (SELECT COUNT(*) FROM `ai_legacy_b02_scopes`)
    AND NOT EXISTS (SELECT 1 FROM `ai_legacy_b02_scopes` a LEFT JOIN `ai_scopes` c ON BINARY c.`id` = BINARY a.`id`
      WHERE c.`id` IS NULL OR NOT (BINARY c.`kind` <=> BINARY a.`kind`)
        OR NOT (BINARY c.`tenantId` <=> BINARY a.`tenantId`) OR NOT (BINARY c.`workspaceId` <=> BINARY a.`workspaceId`)
        OR NOT (c.`createdAt` <=> a.`createdAt`)
        OR NOT (BINARY c.`scopeKey` <=> BINARY CASE a.`kind`
          WHEN ''platform'' THEN ''platform''
          WHEN ''tenant'' THEN CONCAT(''tenant:'', CHAR_LENGTH(a.`tenantId`), '':'', a.`tenantId`)
          WHEN ''workspace'' THEN CONCAT(''workspace:'', CHAR_LENGTH(a.`tenantId`), '':'', a.`tenantId`, '':'', CHAR_LENGTH(a.`workspaceId`), '':'', a.`workspaceId`) END))
    AND NOT EXISTS (SELECT 1 FROM `ai_b02_scope_bridge_work` w LEFT JOIN `ai_legacy_b02_scopes` a ON BINARY a.`id` = BINARY w.`id`
      WHERE a.`id` IS NULL OR NOT (BINARY a.`kind` <=> BINARY w.`kind`) OR NOT (BINARY a.`scopeKey` <=> BINARY w.`scopeKey`)
        OR NOT (BINARY a.`tenantId` <=> BINARY w.`tenantId`) OR NOT (BINARY a.`workspaceId` <=> BINARY w.`workspaceId`)
        OR NOT (a.`createdAt` <=> w.`createdAt`) OR NOT (a.`updatedAt` <=> w.`updatedAt`)), 1, 0)',
  'INSERT INTO `_ai_b02_project_check` (`ok`) VALUES (1)');
PREPARE ai_b02_project_statement FROM @b02_sql;
EXECUTE ai_b02_project_statement;
DEALLOCATE PREPARE ai_b02_project_statement;

-- Only the work table created by the successful prepare migration is removed;
-- its complete old rows remain in ai_legacy_b02_scopes and the original backup.
SET @b02_sql = IF(@b02_work = 1, 'DROP TABLE `ai_b02_scope_bridge_work`', 'SELECT 1');
PREPARE ai_b02_project_statement FROM @b02_sql;
EXECUTE ai_b02_project_statement;
DEALLOCATE PREPARE ai_b02_project_statement;
DROP TABLE `_ai_b02_project_check`;
