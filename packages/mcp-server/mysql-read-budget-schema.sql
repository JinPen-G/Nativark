-- MCP automatic READ metering projections, not a second business Task/finance DB.
-- Structure source only: apply through a separately authorized original migration.
-- Original goal/source and current business authority are required; never seed a
-- goal from client IDs, token/connection/Agent IDs or a claimed human category.
-- No cascading deletion, expiry refund, automatic unknown recovery or replay.
-- Scalar grant/goal indices must match immutable JSON; missing old schema rejects,
-- never falls back to unbounded JSON scans or auto-backfills/reset of old history.
CREATE TABLE mcp_read_goal_budgets (
  goalId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grantId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Original immutable grant locator, not authority',
  bindingHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL COMMENT 'Immutable original goal/grant/subject/scope/purpose/input/policy binding; no credentials',
  revision INT UNSIGNED NOT NULL,
  consumedCalls INT UNSIGNED NOT NULL,
  consumedActiveMs INT UNSIGNED NOT NULL,
  reservedActiveMs INT UNSIGNED NOT NULL,
  concurrentReads INT UNSIGNED NOT NULL,
  PRIMARY KEY (goalId),
  UNIQUE KEY mcp_read_goal_grant (goalId, grantId),
  CONSTRAINT mcp_read_goal_limits CHECK (revision >= 1 AND consumedCalls <= 20 AND concurrentReads <= 2 AND concurrentReads <= consumedCalls AND consumedActiveMs + reservedActiveMs <= 300000),
  CONSTRAINT mcp_read_goal_holds CHECK ((concurrentReads = 0 AND reservedActiveMs = 0) OR (concurrentReads > 0 AND reservedActiveMs > 0))
) ENGINE=InnoDB;

CREATE TABLE mcp_read_calls (
  callId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  goalId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grantId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Owner-bound index locator; CURRENT original Web rights still required',
  callBindingHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL COMMENT 'Original fixed reservation; never token, model input or reader output',
  state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  activeMs INT UNSIGNED NULL,
  PRIMARY KEY (callId),
  KEY mcp_read_calls_goal (goalId, grantId),
  KEY mcp_read_calls_owner (grantId, callId),
  CONSTRAINT mcp_read_call_goal FOREIGN KEY (goalId, grantId) REFERENCES mcp_read_goal_budgets (goalId, grantId) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT mcp_read_call_state CHECK (state IN ('reserved', 'unknown', 'returned', 'failed')),
  CONSTRAINT mcp_read_call_settlement CHECK ((state IN ('reserved', 'unknown') AND activeMs IS NULL) OR (state IN ('returned', 'failed') AND activeMs IS NOT NULL AND activeMs <= 15000))
) ENGINE=InnoDB;

-- Original goal/call associations, not goal creation or a second task store.
-- The ORIGINAL trusted goal writer supplies/revalidates these in its transaction.
-- Original goal/grant/tool/input keys cannot be retargeted to reset counters. No raw input,
-- token, current permission or automatic deletion/expiry is stored here.
CREATE TABLE mcp_read_target_bindings (
  bindingKey CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  goalId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grantId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grantRevision INT UNSIGNED NOT NULL,
  userId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  toolName VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  inputHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (bindingKey),
  UNIQUE KEY mcp_read_binding_invocation (goalId, grantId, toolName, inputHash),
  KEY mcp_read_binding_goal (goalId, grantId),
  CONSTRAINT mcp_read_binding_revision CHECK (grantRevision >= 1 AND grantRevision <= 2147483647)
) ENGINE=InnoDB;
