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