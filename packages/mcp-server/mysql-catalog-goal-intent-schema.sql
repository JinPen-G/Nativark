-- Original trusted Web catalog-goal transition INTENT only. Provision separately;
-- no auto migration/backfill/expiry cleanup and no goal/budget/Task/approval writes.
-- A accepted intent is not business completion or adoption; original future owner
-- must check fresh original settlement and preserve history in an atomic adoption.
CREATE TABLE mcp_catalog_goal_intents (
  id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operationKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ownerKey CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  userId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sessionId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  goalId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  goalRecordHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nextInputHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonceHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decidedAt BIGINT UNSIGNED NULL,
  recordJson JSON NOT NULL COMMENT 'Original goal, owner, input/policy hashes and expiry; no nonce/plain input/credentials',
  PRIMARY KEY (id),
  UNIQUE KEY mcp_catalog_goal_intent_owner_key (userId, tenantId, workspaceId, operationKey),
  CONSTRAINT mcp_catalog_goal_intent_state CHECK (
    (state = 'pending' AND revision = 1 AND decidedAt IS NULL) OR
    (state IN ('accepted','denied') AND revision = 2 AND decidedAt IS NOT NULL)
  )
) ENGINE=InnoDB;
