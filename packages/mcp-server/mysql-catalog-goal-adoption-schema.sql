-- Original catalog-goal closure/adoption metadata only. Apply separately with
-- authorization; NO runtime create/backfill/delete or automatic goal rollover.
-- Current mcp_read_catalog_goals becomes a materialized CURRENT frontier. Each
-- former complete original record is preserved here BEFORE its pointer CAS in
-- the SAME transaction. Business completion is NOT inferred from resource rows.
CREATE TABLE mcp_catalog_goal_adoptions (
  id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ownerKey CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operationKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  userId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  oldGoalId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  newGoalId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  intentRecordHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL COMMENT 'Original intent hash, old/new goal and resource settlement; no nonce/token/input body',
  PRIMARY KEY (id),
  UNIQUE KEY mcp_catalog_goal_adoption_old (oldGoalId),
  UNIQUE KEY mcp_catalog_goal_adoption_new (newGoalId),
  UNIQUE KEY mcp_catalog_goal_adoption_owner_key (userId,tenantId,workspaceId,operationKey),
  CONSTRAINT mcp_catalog_goal_adoption_intent FOREIGN KEY (id) REFERENCES mcp_catalog_goal_intents (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT mcp_catalog_goal_adoption_different CHECK (oldGoalId <> newGoalId)
) ENGINE=InnoDB;
CREATE TABLE mcp_catalog_goal_history (
  goalId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ownerKey CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adoptionId CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  adoptionHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL COMMENT 'Complete unchanged original goal metadata; NOT business success or cleared quota',
  PRIMARY KEY (goalId),
  UNIQUE KEY mcp_catalog_goal_history_adoption (adoptionId),
  CONSTRAINT mcp_catalog_goal_history_receipt FOREIGN KEY (adoptionId) REFERENCES mcp_catalog_goal_adoptions (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
