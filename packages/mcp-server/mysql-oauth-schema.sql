-- Storage contract for prisma-oauth-store.ts; NOT an installer or an applied migration.
-- Integrate through the original API's reviewed incremental migration before use.
-- Original accounts, registration, consent, grant and audit remain in their owners'
-- tables and must be locked/revalidated in the same Serializable transaction.
-- Never store plaintext credentials. Do not delete used digests or revoked families
-- while their replay/receipt obligations remain; no cleanup is implemented here.

CREATE TABLE mcp_oauth_families (
  id VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL,
  revoked TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT mcp_oauth_family_revoked CHECK (revoked IN (0, 1))
) ENGINE=InnoDB;

CREATE TABLE mcp_oauth_codes (
  digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authorizationId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL,
  consumedFamilyId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (digest),
  UNIQUE KEY mcp_oauth_code_authorization (authorizationId),
  UNIQUE KEY mcp_oauth_code_family (consumedFamilyId),
  CONSTRAINT mcp_oauth_code_family_fk FOREIGN KEY (consumedFamilyId)
    REFERENCES mcp_oauth_families (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE mcp_oauth_access (
  digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  familyId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (digest),
  KEY mcp_oauth_access_family (familyId),
  CONSTRAINT mcp_oauth_access_family_fk FOREIGN KEY (familyId)
    REFERENCES mcp_oauth_families (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE mcp_oauth_refresh (
  digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  familyId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL,
  used TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (digest),
  KEY mcp_oauth_refresh_family (familyId),
  CONSTRAINT mcp_oauth_refresh_family_fk FOREIGN KEY (familyId)
    REFERENCES mcp_oauth_families (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT mcp_oauth_refresh_used CHECK (used IN (0, 1))
) ENGINE=InnoDB;

-- Current public-client AS projection, NOT the full application/tenant/grant policy.
-- Original management authority and audit must participate in the same transaction.
CREATE TABLE mcp_oauth_public_clients (
  clientId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (clientId),
  CONSTRAINT mcp_oauth_public_client_revision CHECK (revision BETWEEN 1 AND 2147483647)
) ENGINE=InnoDB;

CREATE TABLE mcp_oauth_public_client_operations (
  operationKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actorId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  clientId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resultJson JSON NOT NULL,
  PRIMARY KEY (operationKey),
  KEY mcp_oauth_public_client_operation_owner (actorId, clientId),
  CONSTRAINT mcp_oauth_public_client_operation_fk FOREIGN KEY (clientId)
    REFERENCES mcp_oauth_public_clients (clientId) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Current grant/admission storage contract; NOT authoring, seeding or applied DDL.
-- Only original trusted policy/consent writers may populate these records, with
-- their own CAS/audit and human decision. No role tree or business approval is stored.
CREATE TABLE mcp_oauth_platform_admissions (
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (resource),
  CONSTRAINT mcp_oauth_platform_admission_revision CHECK (revision BETWEEN 1 AND 2147483647)
) ENGINE=InnoDB;

CREATE TABLE mcp_oauth_workspace_admissions (
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (resource, tenantId, workspaceId),
  CONSTRAINT mcp_oauth_workspace_admission_revision CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT mcp_oauth_workspace_admission_resource FOREIGN KEY (resource)
    REFERENCES mcp_oauth_platform_admissions (resource) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Principal IDs are immutable for a grant; another subject/user/space needs
-- another original human grant, not an in-place remapping of an old credential.
CREATE TABLE mcp_oauth_grants (
  id VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  userId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  clientId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (id),
  KEY mcp_oauth_grant_owner (clientId, tenantId, workspaceId),
  CONSTRAINT mcp_oauth_grant_client FOREIGN KEY (clientId)
    REFERENCES mcp_oauth_public_clients (clientId) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT mcp_oauth_grant_workspace FOREIGN KEY (resource, tenantId, workspaceId)
    REFERENCES mcp_oauth_workspace_admissions (resource, tenantId, workspaceId) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Admission management original-operation receipts; not grant authoring or approval.
CREATE TABLE mcp_oauth_admission_operations (
  operationKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actorId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  targetKind ENUM('platform', 'workspace') NOT NULL,
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resultJson JSON NOT NULL,
  PRIMARY KEY (operationKey),
  KEY mcp_oauth_admission_operation_owner (actorId, targetKind),
  CONSTRAINT mcp_oauth_admission_operation_kind CHECK (
    (targetKind = 'platform' AND tenantId IS NULL AND workspaceId IS NULL) OR
    (targetKind = 'workspace' AND tenantId IS NOT NULL AND workspaceId IS NOT NULL)),
  CONSTRAINT mcp_oauth_admission_operation_resource FOREIGN KEY (resource)
    REFERENCES mcp_oauth_platform_admissions (resource) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT mcp_oauth_admission_operation_workspace FOREIGN KEY (resource, tenantId, workspaceId)
    REFERENCES mcp_oauth_workspace_admissions (resource, tenantId, workspaceId) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Completed original Web consent -> immutable grant association. NOT a consent page
-- or an applied migration. Original human decision/session fences and grant/code
-- audits must share the same transaction. No plaintext state, code or token stored.
CREATE TABLE mcp_oauth_grant_authorizations (
  authorizationId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  authorizationRevision INT UNSIGNED NOT NULL,
  grantId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  consentHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  contextHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (authorizationId),
  UNIQUE KEY mcp_oauth_grant_authorization_grant (grantId),
  CONSTRAINT mcp_oauth_grant_authorization_revision CHECK (authorizationRevision BETWEEN 1 AND 2147483647),
  CONSTRAINT mcp_oauth_grant_authorization_fk FOREIGN KEY (grantId)
    REFERENCES mcp_oauth_grants (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Trusted Web consent preparation and nonce CAS; NOT an applied migration or UI.
-- The authorization key is fixed to the exact original OAuth request. Original
-- session/user/space and review evidence are immutable; nonce plaintext never stored.
CREATE TABLE mcp_oauth_browser_consents (
  id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  browserSessionId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  userId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonceHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  state ENUM('pending', 'approved', 'denied') NOT NULL,
  decidedAt BIGINT UNSIGNED NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (id),
  KEY mcp_oauth_browser_consent_owner (userId, tenantId, workspaceId),
  CONSTRAINT mcp_oauth_browser_consent_state CHECK (
    (state = 'pending' AND revision = 1 AND decidedAt IS NULL) OR
    (state IN ('approved', 'denied') AND revision = 2 AND decidedAt IS NOT NULL AND decidedAt > 0))
) ENGINE=InnoDB;

-- Original current consent review policy and issuer subject metadata only.
-- Trusted management writers own approval/provenance/CAS/audit; no seeding here.
-- These tables do not create accounts/roles, run MFA or revoke existing grants.
CREATE TABLE mcp_oauth_consent_reviews (
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (resource),
  CONSTRAINT mcp_oauth_consent_review_revision CHECK (revision BETWEEN 1 AND 2147483647)
) ENGINE=InnoDB;

CREATE TABLE mcp_oauth_workspace_reviews (
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (resource, tenantId, workspaceId),
  CONSTRAINT mcp_oauth_workspace_review_revision CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT mcp_oauth_workspace_review_resource FOREIGN KEY (resource)
    REFERENCES mcp_oauth_consent_reviews (resource) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE mcp_oauth_subject_bindings (
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  userId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (resource, userId, tenantId),
  UNIQUE KEY mcp_oauth_subject_binding_unique (resource, subject),
  CONSTRAINT mcp_oauth_subject_binding_revision CHECK (revision BETWEEN 1 AND 2147483647)
) ENGINE=InnoDB;

-- Original platform review drafts and current approved pointers only.
-- Nonce plaintext is never stored; old decisions remain immutable audit evidence.
CREATE TABLE mcp_oauth_public_client_review_drafts (
  operationKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  clientId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actorId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  browserSessionId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reviewRevision INT UNSIGNED NOT NULL,
  nonceHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decisionRevision INT UNSIGNED NOT NULL,
  state ENUM('pending', 'approved', 'denied') NOT NULL,
  decidedAt BIGINT UNSIGNED NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (operationKey),
  UNIQUE KEY mcp_oauth_client_review_association (clientId, operationKey),
  KEY mcp_oauth_client_review_owner (actorId, tenantId),
  CONSTRAINT mcp_oauth_client_review_revision CHECK (reviewRevision BETWEEN 1 AND 2147483647),
  CONSTRAINT mcp_oauth_client_review_decision CHECK (
    (state = 'pending' AND decisionRevision = 1 AND decidedAt IS NULL)
    OR (state IN ('approved', 'denied') AND decisionRevision = 2 AND decidedAt IS NOT NULL AND decidedAt > 0)
  )
) ENGINE=InnoDB;

CREATE TABLE mcp_oauth_public_client_reviews (
  clientId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  reference VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (clientId),
  UNIQUE KEY mcp_oauth_client_review_reference (reference),
  CONSTRAINT mcp_oauth_client_review_pointer_revision CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT mcp_oauth_client_review_pointer FOREIGN KEY (clientId, reference)
    REFERENCES mcp_oauth_public_client_review_drafts (clientId, operationKey) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Immutable original subject management receipts; never delete/rebind subjects.
CREATE TABLE mcp_oauth_subject_operations (
  operationKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actorId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  userId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resultJson JSON NOT NULL,
  PRIMARY KEY (operationKey),
  KEY mcp_oauth_subject_operation_owner (actorId, tenantId),
  CONSTRAINT mcp_oauth_subject_operation_binding FOREIGN KEY (resource, userId, tenantId)
    REFERENCES mcp_oauth_subject_bindings (resource, userId, tenantId) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Original approved notice projection saves, not review approval or MFA records.
CREATE TABLE mcp_oauth_consent_policy_operations (
  operationKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actorId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  targetKind ENUM('platform', 'workspace') NOT NULL,
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resultJson JSON NOT NULL,
  PRIMARY KEY (operationKey),
  KEY mcp_oauth_consent_policy_owner (actorId),
  CONSTRAINT mcp_oauth_consent_policy_scope CHECK (
    (targetKind = 'platform' AND tenantId IS NULL AND workspaceId IS NULL)
    OR (targetKind = 'workspace' AND tenantId IS NOT NULL AND workspaceId IS NOT NULL)
  ),
  CONSTRAINT mcp_oauth_consent_policy_platform FOREIGN KEY (resource)
    REFERENCES mcp_oauth_consent_reviews (resource) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT mcp_oauth_consent_policy_workspace FOREIGN KEY (resource, tenantId, workspaceId)
    REFERENCES mcp_oauth_workspace_reviews (resource, tenantId, workspaceId) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Original notice reviews precede projection creation. scopeKey hashes fixed
-- resource + canonical target; a pointer can only name its own original draft.
CREATE TABLE mcp_oauth_notice_review_drafts (
  operationKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  scopeKey CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actorId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actorTenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actorWorkspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  browserSessionId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  reviewRevision INT UNSIGNED NOT NULL,
  nonceHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  decisionRevision INT UNSIGNED NOT NULL,
  state ENUM('pending', 'approved', 'denied') NOT NULL,
  decidedAt BIGINT UNSIGNED NULL,
  recordJson JSON NOT NULL,
  PRIMARY KEY (operationKey),
  UNIQUE KEY mcp_oauth_notice_review_association (scopeKey, operationKey),
  KEY mcp_oauth_notice_review_owner (actorId, actorTenantId, actorWorkspaceId),
  CONSTRAINT mcp_oauth_notice_review_revision CHECK (reviewRevision BETWEEN 1 AND 2147483647),
  CONSTRAINT mcp_oauth_notice_review_decision CHECK (
    (state = 'pending' AND decisionRevision = 1 AND decidedAt IS NULL)
    OR (state IN ('approved', 'denied') AND decisionRevision = 2 AND decidedAt IS NOT NULL AND decidedAt > 0)
  )
) ENGINE=InnoDB;

CREATE TABLE mcp_oauth_notice_reviews (
  scopeKey CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT UNSIGNED NOT NULL,
  reference VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (scopeKey),
  UNIQUE KEY mcp_oauth_notice_review_reference (reference),
  CONSTRAINT mcp_oauth_notice_review_pointer_revision CHECK (revision BETWEEN 1 AND 2147483647),
  CONSTRAINT mcp_oauth_notice_review_pointer FOREIGN KEY (scopeKey, reference)
    REFERENCES mcp_oauth_notice_review_drafts (scopeKey, operationKey) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Original revoke-only grant operations. No token/subject or erasure receipt.
CREATE TABLE mcp_oauth_grant_operations (
  operationKey VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  actorId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grantId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payloadHash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resultJson JSON NOT NULL,
  PRIMARY KEY (operationKey),
  KEY mcp_oauth_grant_operation_owner (actorId, tenantId, workspaceId),
  CONSTRAINT mcp_oauth_grant_operation_grant FOREIGN KEY (grantId)
    REFERENCES mcp_oauth_grants (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;

-- Exact original Web-owner page; no tenant-wide enumeration or mutable usage sort.
CREATE INDEX mcp_oauth_grant_self_list
  ON mcp_oauth_grants (resource, userId, tenantId, workspaceId, id);

-- Last server-completed business read only, NOT a goal/call/financial ledger.
-- No client-selected clock, token, subject, input, output, count or delivery proof.
CREATE TABLE mcp_oauth_grant_last_use (
  grantId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resource VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  userId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tenantId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspaceId VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  clientId VARCHAR(200) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  grantRevision INT UNSIGNED NOT NULL,
  observedAtMs BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (grantId),
  CONSTRAINT mcp_oauth_grant_use_revision CHECK (grantRevision BETWEEN 1 AND 2147483647),
  CONSTRAINT mcp_oauth_grant_use_clock CHECK (observedAtMs BETWEEN 1 AND 9007199254740991),
  CONSTRAINT mcp_oauth_grant_use_grant FOREIGN KEY (grantId)
    REFERENCES mcp_oauth_grants (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB;
