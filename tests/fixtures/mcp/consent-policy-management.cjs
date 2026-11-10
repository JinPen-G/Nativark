"use strict";
/** Shared original policy management fixture. Completed reviews, SQL and commits
 * are explicit substitutes; no identity/permission/audit method is replaced. */
const assert = require('node:assert/strict');
const { fixture: originalFixture } = require('./public-client-management.cjs');
const { source } = require('./original-identity.cjs');
const { createOriginalMcpConsentPolicyManagement } = source('apps/api/src/modules/auth/original-mcp-consent-policy-management.ts');
const resource = 'https://mcp.example.invalid/mcp', platform = { kind: 'platform' }, workspace = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
function fixture(api, kind = 'platform') {
  const f = originalFixture(api), now = Math.floor(Date.now() / 1000); f.now = now;
  Object.assign(f.state, { platforms: {}, workspaces: {}, policyOperations: {} }); f.policyReviewReads = 0;
  const common = { resource, revision: 1, enabled: true, expiresAt: now + 500, noticeVersion: 'notice-v1', verificationRequired: false, reviewRef: 'approved-notice-a', reviewRevision: 2 };
  f.platformPolicy = { ...common, noticeText: 'Reviewed external-model/storage boundary fixture notice.' };
  f.workspacePolicy = { ...common, tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  f.subject = { resource, userId: 'user-a', tenantId: 'tenant-a', subject: 'original-subject-fixture', revision: 1, enabled: true, expiresAt: now + 600 };
  f.queryExtra = (working, sql, values) => {
    let rows;
    if (sql.includes('FROM mcp_oauth_consent_policy_operations')) rows = working.policyOperations[values[0]] ? [structuredClone(working.policyOperations[values[0]])] : [];
    else if (sql.includes('FROM mcp_oauth_workspace_reviews')) rows = working.workspaces[values.join('|')] ? [structuredClone(working.workspaces[values.join('|')])] : [];
    else if (sql.includes('FROM mcp_oauth_consent_reviews')) rows = working.platforms[values[0]] ? [structuredClone(working.platforms[values[0]])] : [];
    else if (sql.includes('FROM mcp_oauth_subject_bindings')) rows = [{ ...f.subject, recordJson: JSON.stringify(f.subject) }];
    if (rows !== undefined) return f.policyRowHook ? f.policyRowHook(rows, sql) : rows;
  };
  f.executeExtra = (working, sql, values) => {
    if (sql.includes('INTO mcp_oauth_consent_policy_operations')) { assert.ok(!working.policyOperations[values[0]]); working.policyOperations[values[0]] = Object.fromEntries(['actorId', 'targetKind', 'resource', 'tenantId', 'workspaceId', 'payloadHash', 'resultJson'].map((k, i) => [k, values[i + 1]])); return 1; }
    const table = sql.includes('mcp_oauth_workspace_reviews') ? 'workspaces' : sql.includes('mcp_oauth_consent_reviews') ? 'platforms' : undefined; if (!table) return undefined;
    if (sql.startsWith('INSERT')) { const key = table === 'platforms' ? values[0] : values.slice(0, 3).join('|'); assert.ok(!working[table][key]); working[table][key] = table === 'platforms' ? { resource: values[0], revision: values[1], recordJson: values[2] } : { resource: values[0], tenantId: values[1], workspaceId: values[2], revision: values[3], recordJson: values[4] }; return 1; }
    const key = table === 'platforms' ? values[2] : values.slice(2, 5).join('|'), row = working[table][key]; if (!row || row.revision !== values.at(-1) || f.casFail) return 0;
    row.revision = values[0]; row.recordJson = values[1]; return 1;
  };
  f.reviews = { current: async (tx, target, sig) => { assert.equal(tx, f.native); assert.equal(sig.aborted, false); f.policyReviewReads++;
    const row = f.approved && JSON.stringify(f.approved.target) === JSON.stringify(target) ? structuredClone(f.approved) : undefined; return f.reviewHook ? f.reviewHook(row, f.policyReviewReads) : row; } };
  f.configure = scope => {
    if (scope.kind === 'workspace') { f.user.isSaasAdmin = false; f.session.currentWorkspaceId = 'workspace-a'; f.payload.wid = 'workspace-a'; const role = f.user.roleAssignments[0].role; role.permissions = [{ permission: { code: 'system:integration:manage' } }]; role.dataScope = 'ALL'; }
    const capture = { policy: api.captureOAuthConsentPolicy, target: api.captureOAuthConsentPolicyTarget, receipt: api.captureOAuthConsentPolicyReceipt };
    const readOnly = { readIn: (...args) => f.store.readIn(...args) };
    f.management = createOriginalMcpConsentPolicyManagement(capture, { resourceUrl: resource }, f.auth, f.platform, f.browser(), readOnly, f.logs, f.reviews);
    f.store = api.createPrismaOAuthConsentPolicyStore({ resourceUrl: resource }, f.database, f.management);
    f.command = { operationKey: 'policy-save-' + scope.kind, expectedRevision: 0, target: scope, policy: scope.kind === 'platform' ? f.platformPolicy : f.workspacePolicy };
    f.approved = { reference: f.command.policy.reviewRef, revision: f.command.policy.reviewRevision, expiresAt: now + 600, target: scope, policy: structuredClone(f.command.policy) };
  }; f.configure(kind === 'workspace' ? workspace : platform);
  return f;
}
module.exports = { fixture };
