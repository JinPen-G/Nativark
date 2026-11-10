"use strict";
/** Actual approved-projection store/current reader/original management/audit.
 * Completed review, SQL/account/session/commit and native log are substitutes;
 * this does not approve notices, perform MFA or prove true UI/DB/full API types. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const { source, root } = require('./fixtures/mcp/original-identity.cjs');
const { fixture: originalFixture } = require('./fixtures/mcp/public-client-management.cjs');
const { createOriginalMcpConsentPolicyManagement } = source('apps/api/src/modules/auth/original-mcp-consent-policy-management.ts');
const { createOriginalMcpGrantIdentity } = source('apps/api/src/modules/auth/original-mcp-grant-identity.ts');
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
const signal = () => new AbortController().signal, resource = 'https://mcp.example.invalid/mcp', platform = { kind: 'platform' }, workspace = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
const options = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-consent-policy-verification-')), pkg = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(pkg, 'package.json'), path.join(staged, 'package.json'));
  const opts = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')], rootDir: path.join(pkg, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diag = ts.getPreEmitDiagnostics(program); assert.equal(diag.length, 0, diag.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram([path.join(pkg, 'src/prisma-oauth-consent-policy-store.ts')], opts));
  const consumer = path.join(output, 'consumer.mts'); fs.writeFileSync(consumer, [
    'export { createPrismaOAuthConsentPolicyStore, captureOAuthConsentPolicyTarget, captureOAuthConsentPolicyReceipt } from "@rental-os/mcp-server/prisma-oauth-consent-policy-store";',
    'export { createPrismaOAuthConsentReview, captureOAuthConsentPolicy } from "@rental-os/mcp-server/prisma-oauth-consent-review";',
    'export { createPrismaPublicClientRegistry, captureRegisteredPublicClient, capturePublicClientRegistrationReceipt } from "@rental-os/mcp-server/prisma-public-client-registry";',
    'import type { OriginalOAuthConsentPolicyManagement, OriginalOAuthConsentPolicyReviewSource } from "@rental-os/mcp-server/prisma-oauth-consent-policy-store";',
    'import type { OAuthSqlTransaction } from "@rental-os/mcp-server/prisma-oauth-store";',
    'interface Native extends OAuthSqlTransaction { originalAccount: { id: string }; }',
    'export const typed = (p: OriginalOAuthConsentPolicyManagement<Native>, r: OriginalOAuthConsentPolicyReviewSource<Native>): OriginalOAuthConsentPolicyManagement<Native> => ({',
    'authorize: async (tx, ...args) => { const id: string = tx.originalAccount.id; void id; await r.current(tx, args[0].target, args[1]); return p.authorize(tx, ...args); },',
    'audit: async (tx, ...args) => { const id: string = tx.originalAccount.id; void id; return p.audit(tx, ...args); } });',
  ].join('\n')); check(ts.createProgram([consumer], { ...opts, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href); return artifact;
}
const { fixture } = require('./fixtures/mcp/consent-policy-management.cjs');

test('original current SaaS/tenant managers save reviewed platform/workspace projections consumed by current consent', async () => {
  const api = await compiled(), f = fixture(api);
  const saved = await f.store.save(f.command, signal()); assert.equal(saved.policy.noticeText, f.platformPolicy.noticeText); assert.equal(f.audits[0].workspaceId, null); assert.equal(f.audits[0].action, 'mcp.oauth.consent.policy.platform.saved');
  f.configure(workspace); const ws = await f.store.save(f.command, signal()); assert.equal(ws.policy.workspaceId, 'workspace-a'); assert.equal(f.audits[1].workspaceId, 'workspace-a'); assert.equal(f.audits[1].action, 'mcp.oauth.consent.policy.workspace.saved');
  assert.deepEqual(f.audits[1].detail.metadata, { operationKey: f.command.operationKey, revision: 1 }); assert.ok(!JSON.stringify(f.audits).includes(f.platformPolicy.noticeText));
  const reader = api.createPrismaOAuthConsentReview({ enabled: true, resourceUrl: resource, allowedScopes: ['rental.catalog.read'] }, createOriginalMcpGrantIdentity(f.auth));
  const input = { clientId: 'client-a', clientRevision: 1, resource, scopes: ['rental.catalog.read'], redirectUri: 'https://client.example.invalid/callback', state: 'state-a', codeChallenge: Buffer.alloc(32, 1).toString('base64url') };
  const current = () => f.database.$transaction(tx => reader.current(input, { ...f.binding, sessionId: f.session.id, expiresAt: f.now + 800 }, tx, signal()), options);
  assert.equal((await current()).noticeText, saved.policy.noticeText);
  f.approved = undefined; await f.store.save({ ...f.command, expectedRevision: 1, operationKey: 'disable-workspace', policy: { ...f.command.policy, revision: 2, enabled: false } }, signal());
  assert.equal(await current(), undefined); assert.deepEqual((await f.store.operation(workspace, 'policy-save-workspace', signal())).result, ws);
});

test('missing/stale/wrong review cannot approve notice or verification changes; only exact existing disable is review-independent', async () => {
  const api = await compiled();
  for (const kind of ['missing', 'reference', 'revision', 'expiry', 'text', 'verification', 'scope', 'getter', 'actor']) {
    const f = fixture(api); let getters = 0, command = structuredClone(f.command);
    if (kind === 'missing') f.approved = undefined; if (kind === 'reference') f.approved.reference = 'other-review'; if (kind === 'revision') f.approved.revision++;
    if (kind === 'expiry') f.approved.expiresAt = 1; if (kind === 'text') command.policy.noticeText = 'Unreviewed text'; if (kind === 'verification') command.policy.verificationRequired = true;
    if (kind === 'scope') f.approved.target = workspace; if (kind === 'actor') command.actorId = 'administrator';
    if (kind === 'getter') f.reviewHook = row => { Object.defineProperty(row, 'reference', { enumerable: true, get() { getters++; return 'approved-notice-a'; } }); return row; };
    await assert.rejects(() => f.store.save(command, signal()), undefined, kind); assert.deepEqual(f.state.platforms, {}); assert.equal(f.audits.length, 0); assert.equal(getters, 0);
  }
  const f = fixture(api); await f.store.save(f.command, signal()); f.approved = undefined;
  const close = { ...f.command, operationKey: 'close-only', expectedRevision: 1, policy: { ...f.command.policy, revision: 2, enabled: false } };
  for (const field of ['noticeText', 'noticeVersion', 'verificationRequired', 'expiresAt', 'reviewRef']) {
    const changed = structuredClone(close); changed.policy[field] = field === 'verificationRequired' ? true : field === 'expiresAt' ? f.now + 700 : 'changed';
    await assert.rejects(() => f.store.save(changed, signal()), undefined, field);
  }
  await f.store.save(close, signal()); const priorReads = f.policyReviewReads; await f.store.operation(platform, f.command.operationKey, signal()); assert.equal(f.policyReviewReads, priorReads);
  await assert.rejects(() => f.store.save({ ...close, expectedRevision: 2, operationKey: 'reenable', policy: { ...close.policy, revision: 3, enabled: true } }, signal()));
});

test('SaaS and tenant scopes stay separate; original-key CAS, malformed history and current rights are enforced', async () => {
  const api = await compiled();
  for (const kind of ['tenant-platform', 'saas-workspace', 'limited', 'wildcard', 'cross-space', 'mcp-token']) {
    const f = fixture(api, kind === 'tenant-platform' || kind === 'mcp-token' ? 'platform' : 'workspace');
    if (kind === 'tenant-platform') f.user.isSaasAdmin = false; if (kind === 'saas-workspace') f.user.isSaasAdmin = true;
    if (kind === 'limited') f.user.roleAssignments[0].role.dataScope = 'ORGANIZATION';
    if (kind === 'wildcard') { f.user.roleAssignments[0].role.permissions = []; f.member.role.fixedAllPermissions = true; }
    if (kind === 'cross-space') f.session.currentWorkspaceId = 'other-space';
    if (kind === 'mcp-token') { f.browser = () => new Request('https://admin.example.invalid/mcp', { headers: { authorization: 'Bearer opaque-mcp-token' } }); f.configure(platform); }
    await assert.rejects(() => f.store.save(f.command, signal()), undefined, kind); assert.equal(f.audits.length, 0);
  }
  const f = fixture(api); const results = await Promise.all([f.store.save(f.command, signal()), f.store.save(f.command, signal())]); assert.deepEqual(results[0], results[1]); assert.equal(f.audits.length, 1);
  await assert.rejects(() => f.store.save({ ...f.command, operationKey: 'conflicting-key' }, signal()), e => e.kind === 'conflict');
  assert.deepEqual(await f.store.operation(platform, 'unseen', signal()), { state: 'not_observed', retryable: false });
  f.approved = undefined; f.casFail = true;
  await assert.rejects(() => f.store.save({ ...f.command, expectedRevision: 1, operationKey: 'native-cas-fail', policy: { ...f.command.policy, revision: 2, enabled: false } }, signal()), e => e.kind === 'conflict');
  assert.equal(f.state.platforms[resource].revision, 1); assert.equal(f.audits.length, 1); f.casFail = false;
  for (const kind of ['actor', 'scope', 'hash', 'getter']) {
    const item = fixture(api); await item.store.save(item.command, signal()); const row = item.state.policyOperations[item.command.operationKey]; let getters = 0;
    if (kind === 'actor') row.actorId = 'another-user'; if (kind === 'scope') row.workspaceId = 'other-space'; if (kind === 'hash') row.payloadHash = '0'.repeat(64);
    if (kind === 'getter') item.policyRowHook = (rows, sql) => { if (sql.includes('FROM mcp_oauth_consent_policy_operations')) Object.defineProperty(rows[0], 'payloadHash', { enumerable: true, get() { getters++; return row.payloadHash; } }); return rows; };
    await assert.rejects(() => item.store.operation(platform, item.command.operationKey, signal()), undefined, kind); assert.equal(getters, 0); assert.equal(item.audits.length, 1);
  }
});

test('late original review/identity/audit failure rolls back; unknown commits use original receipts without re-approving', async () => {
  const api = await compiled();
  for (const kind of ['audit', 'missing-id', 'late-identity', 'late-review']) {
    const f = fixture(api); if (kind === 'audit') f.failAudit = true; if (kind === 'missing-id') f.auditResultHook = () => ({});
    if (kind === 'late-identity') f.afterAudit = () => { f.user.isSaasAdmin = false; }; if (kind === 'late-review') f.afterAudit = () => { f.approved = undefined; };
    await assert.rejects(() => f.store.save(f.command, signal()), undefined, kind); assert.deepEqual(f.state.platforms, {}); assert.deepEqual(f.state.policyOperations, {}); assert.equal(f.audits.length, 0);
  }
  for (const kind of ['lost-response', 'post-commit-cancel']) {
    const f = fixture(api), controller = new AbortController(); f.loseCommit = kind === 'lost-response'; if (kind === 'post-commit-cancel') f.cancelCommit = controller;
    await assert.rejects(() => f.store.save(f.command, controller.signal), e => e.kind === 'unknown'); assert.equal(f.audits.length, 1);
    f.loseCommit = false; f.cancelCommit = undefined; f.approved = undefined; assert.equal((await f.store.operation(platform, f.command.operationKey, signal())).state, 'observed'); assert.equal(f.audits.length, 1);
  }
  const f = fixture(api), controller = new AbortController(); controller.abort(); const before = f.calls.length;
  await assert.rejects(() => f.store.save(f.command, controller.signal)); assert.equal(f.calls.length, before);
  const audit = { actorId: 'user-a', target: platform, operationKey: 'unassociated', resource, revision: 1 };
  await assert.rejects(() => f.database.$transaction(tx => f.management.audit(tx, audit, signal()), options)); assert.equal(f.audits.length, 0);
  const saved = fixture(api); await saved.store.save(saved.command, signal());
  for (const changed of [{ actorId: 'other-user' }, { resource: 'https://other.example.invalid/mcp' }, { target: workspace }, { revision: 2 }]) {
    await assert.rejects(() => saved.database.$transaction(tx => saved.management.audit(tx, { ...audit, operationKey: saved.command.operationKey, ...changed }, signal()), options)); assert.equal(saved.audits.length, 1);
  }
});
