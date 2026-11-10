-- Initial original catalog-goal frontier. Metadata only, NOT a second business
-- Task/Run, grant, financial ledger or executable operation. Apply separately with
-- authorized original schema provisioning; this source never installs/backfills.
-- Owner/workspace key excludes token/client/query/resource; no expiry/cleanup or
-- automatic rollover may remove it and reset original counters. Old history must
-- be explicitly adopted by its original author, never assumed empty.
CREATE TABLE mcp_read_catalog_goals (
  ownerKey CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  goalId CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grantId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grantRevision INT UNSIGNED NOT NULL,
  userId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authorityHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL COMMENT 'Immutable original goal/owner/policy/input hash; no credentials/input body',
  PRIMARY KEY (ownerKey),
  UNIQUE KEY mcp_catalog_goal_id (goalId),
  CONSTRAINT mcp_catalog_goal_revision CHECK (grantRevision BETWEEN 1 AND 2147483647)
) ENGINE=InnoDB;

-- Bounded owner-history checks run ONLY in original preparation's Auth transaction,
-- which ends before separate budget locks. Missing indices fail closed; no scans.
ALTER TABLE mcp_oauth_grants
  ADD KEY mcp_catalog_goal_grant_owner (userId, tenantId, workspaceId, id);
ALTER TABLE mcp_read_goal_budgets
  ADD KEY mcp_catalog_goal_budget_grant (grantId, goalId);
ALTER TABLE mcp_read_target_bindings
  ADD KEY mcp_catalog_goal_binding_owner (userId, tenantId, workspaceId, bindingKey);
