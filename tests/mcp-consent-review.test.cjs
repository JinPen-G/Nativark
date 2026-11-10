"use strict";
/** Actual current review reader and original Auth account/workspace checks.
 * Review/subject SQL rows and completed MFA evidence are explicit fixtures,
 * not management approval, factor execution, real DB locks or production DI. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const { fixture: originalFixture, source } = require('./fixtures/mcp/original-identity.cjs');
const root = path.resolve(__dirname, '..'), signal = () => new AbortController().signal;
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-consent-review-verification-')), packageRoot = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(staged, 'package.json'));
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')], rootDir: path.join(packageRoot, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram([path.join(packageRoot, 'src/prisma-oauth-consent-review.ts')], options));
  const consumer = path.join(output, 'consumer.mts');
  fs.writeFileSync(consumer, [
    'export { createPrismaOAuthConsentReview } from "@rental-os/mcp-server/prisma-oauth-consent-review";',
    'import type { OriginalOAuthVerificationSource } from "@rental-os/mcp-server/prisma-oauth-consent-review";',
    'import type { OAuthSqlTransaction } from "@rental-os/mcp-server/prisma-oauth-store";',
    'interface Native extends OAuthSqlTransaction { originalMarker: "original"; }',
    'export const typed = (source: OriginalOAuthVerificationSource<Native>): OriginalOAuthVerificationSource<Native> => ({',
    'current: async (...args) => { const marker: "original" = args[4].originalMarker; void marker; return source.current(...args); } });',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href);
  fs.writeFileSync(path.join(output, 'scope.json'), JSON.stringify({ strict: 'review/OAuth closure and formal NodeNext/native consumer', actual: 'original Auth account/space source', external: 'review/subject SQL and completed verification fixtures', excluded: 'no actual management/MFA/UI/DB/DI or full API type proof' }, null, 2));
  return artifact;
}
const resource = 'https://mcp.example.invalid/mcp', scopes = ['rental.catalog.read'];
const config = { enabled: true, resourceUrl: resource, allowedScopes: scopes };
function fixture(api) {
  const f = originalFixture(), now = Math.floor(Date.now() / 1000); f.queries = []; f.verifyCalls = 0; f.queryHook = undefined; f.evidenceHook = undefined;
  f.input = { clientId: 'client-a', clientRevision: 1, resource, scopes, redirectUri: 'https://client.example.invalid/callback', state: 'original-state', codeChallenge: Buffer.alloc(32, 1).toString('base64url') };
  f.principal = { ...f.binding, sessionId: 'original-session', expiresAt: now + 600 };
  f.platform = { resource, revision: 1, enabled: true, expiresAt: now + 500, noticeVersion: 'review-v1', noticeText: 'Approved offline-fixture notice text.', verificationRequired: false, reviewRef: 'original-platform-review', reviewRevision: 1 };
  f.workspaceReview = { resource, tenantId: 'tenant-a', workspaceId: 'workspace-a', revision: 1, enabled: true, expiresAt: now + 400,
    noticeVersion: 'review-v1', verificationRequired: false, reviewRef: 'original-workspace-review', reviewRevision: 2 };
  f.subject = { resource, userId: 'user-a', tenantId: 'tenant-a', subject: 'issuer-subject-not-user-id', revision: 1, enabled: true, expiresAt: now + 300 };
  f.tx.originalMarker = 'original';
  f.tx.$queryRaw = async (parts, ...values) => { const sql = parts.join('?').replace(/\s+/g, ' ').trim(), table = /FROM (\w+)/.exec(sql)[1]; assert.match(sql, /FOR UPDATE$/); f.queries.push({ sql, values });
    const value = table === 'mcp_oauth_consent_reviews' ? f.platform : table === 'mcp_oauth_workspace_reviews' ? f.workspaceReview : f.subject;
    const indexes = table === 'mcp_oauth_consent_reviews' ? ['resource', 'revision'] : table === 'mcp_oauth_workspace_reviews' ? ['resource', 'tenantId', 'workspaceId', 'revision'] : ['resource', 'userId', 'tenantId', 'subject', 'revision'];
    const rows = value ? [{ ...Object.fromEntries(indexes.map(k => [k, value[k]])), recordJson: JSON.stringify(value) }] : []; return f.queryHook ? f.queryHook(table, rows) : rows;
  };
  f.tx.$executeRaw = () => { throw new Error('Review read must not write'); };
  const { createOriginalMcpGrantIdentity } = source('apps/api/src/modules/auth/original-mcp-grant-identity.ts'); f.identity = createOriginalMcpGrantIdentity(f.auth);
  f.verification = { current: async (p, input, policyHash, authorizationHash, tx) => { assert.equal(tx, f.tx); f.verifyCalls++;
    const proof = { method: 'mfa', reference: 'original-verified-record', revision: 3, expiresAt: now + 250, userId: p.userId, tenantId: p.tenantId,
      workspaceId: p.workspaceId, sessionId: p.sessionId, resource, policyHash, authorizationHash }; return f.evidenceHook ? f.evidenceHook(proof) : proof; } };
  f.reader = api.createPrismaOAuthConsentReview(config, f.identity, f.verification);
  f.read = () => f.reader.current(f.input, f.principal, f.tx, signal()); return f;
}

test('explicit current two-level exemption and original subject mapping produce only approved notice projection', async () => {
  const api = await compiled(), f = fixture(api), current = await f.read();
  assert.equal(current.subject, 'issuer-subject-not-user-id'); assert.equal(current.noticeText, f.platform.noticeText); assert.equal(current.verification.kind, 'not_required'); assert.equal(f.verifyCalls, 0);
  assert.equal(current.expiresAt, f.subject.expiresAt); assert.ok(Object.isFrozen(current)); assert.ok(Object.isFrozen(current.verification));
  assert.deepEqual(Object.keys(current).sort(), ['subject', 'noticeVersion', 'noticeText', 'expiresAt', 'verification'].sort()); assert.ok(f.calls.some(([kind]) => kind === 'tx-member'));
  assert.ok(f.queries.every(query => !query.sql.includes('tenant-a')), 'fixed original keys stay SQL parameters');
  const withoutMfa = api.createPrismaOAuthConsentReview(config, f.identity); assert.equal((await withoutMfa.current(f.input, f.principal, f.tx, signal())).verification.kind, 'not_required');
});

test('either required policy needs exact original MFA evidence; missing/cross-session/stale proof cannot become exemption', async () => {
  const api = await compiled(), f = fixture(api); f.workspaceReview.verificationRequired = true;
  assert.equal((await f.read()).verification.kind, 'satisfied'); assert.equal(f.verifyCalls, 2);
  const missing = api.createPrismaOAuthConsentReview(config, f.identity); await assert.rejects(() => missing.current(f.input, f.principal, f.tx, signal()), /unavailable/i);
  for (const kind of ['wrong-method', 'wrong-session', 'wrong-policy', 'wrong-authorization', 'expired', 'late-proof', 'getter', 'cancelled-proof']) {
    const candidate = fixture(api), controller = new AbortController(); candidate.platform.verificationRequired = true; let getters = 0;
    candidate.evidenceHook = value => { if (kind === 'wrong-method') value.method = 'password'; if (kind === 'wrong-session') value.sessionId = 'other-session';
      if (kind === 'wrong-policy') value.policyHash = '0'.repeat(64); if (kind === 'wrong-authorization') value.authorizationHash = '0'.repeat(64);
      if (kind === 'expired') value.expiresAt = 1; if (kind === 'late-proof' && candidate.verifyCalls > 1) value.reference = 'changed-original-proof';
      if (kind === 'getter') Object.defineProperty(value, 'reference', { enumerable: true, get() { getters++; return 'forged'; } });
      if (kind === 'cancelled-proof') controller.abort(); return value; };
    await assert.rejects(() => candidate.reader.current(candidate.input, candidate.principal, candidate.tx, controller.signal), /unavailable/i, kind); assert.equal(getters, 0);
  }
});

test('missing/invalid provenance, corrupted indexes, getters and same-revision policy mutation remain unavailable', async () => {
  const api = await compiled();
  for (const kind of ['missing-platform', 'missing-workspace', 'missing-subject', 'nonboolean', 'missing-provenance', 'private-field', 'wrong-index', 'getter', 'late-notice']) {
    const f = fixture(api); let getters = 0, reads = 0;
    if (kind === 'missing-platform') f.platform = undefined; if (kind === 'missing-workspace') f.workspaceReview = undefined; if (kind === 'missing-subject') f.subject = undefined;
    if (kind === 'nonboolean') f.platform.verificationRequired = 'false'; if (kind === 'missing-provenance') delete f.workspaceReview.reviewRef;
    if (kind === 'private-field') f.subject.actor = 'forged';
    f.queryHook = (table, rows) => { if (table === 'mcp_oauth_workspace_reviews' && kind === 'wrong-index') rows[0].tenantId = 'other-tenant';
      if (table === 'mcp_oauth_consent_reviews' && kind === 'getter') Object.defineProperty(rows[0], 'recordJson', { enumerable: true, get() { getters++; return '{}'; } });
      if (table === 'mcp_oauth_consent_reviews' && kind === 'late-notice' && ++reads > 1) rows[0].recordJson = JSON.stringify({ ...f.platform, noticeText: 'Changed at same revision' }); return rows; };
    await assert.rejects(() => f.read(), /unavailable/i, kind); assert.equal(getters, 0);
  }
  const disabled = fixture(api); disabled.workspaceReview.enabled = false; assert.equal(await disabled.read(), undefined);
  const expired = fixture(api); expired.subject.expiresAt = 1; assert.equal(await expired.read(), undefined);
  const mismatch = fixture(api); mismatch.workspaceReview.noticeVersion = 'unapproved-version'; assert.equal(await mismatch.read(), undefined);
});

test('original current identity, cancellation and metadata revisions remain independent of fake caller authority', async () => {
  const api = await compiled();
  for (const kind of ['inactive', 'member', 'password', 'saas', 'memory', 'caller-fields']) {
    const f = fixture(api); if (kind === 'inactive') f.user.isActive = false; if (kind === 'member') f.member.isActive = false;
    if (kind === 'password') f.user.mustChangePassword = true; if (kind === 'saas') f.user.isSaasAdmin = true; if (kind === 'memory') f.mysql = false;
    if (kind === 'caller-fields') f.principal.actor = 'administrator';
    if (['memory', 'caller-fields'].includes(kind)) await assert.rejects(() => f.read()); else assert.equal(await f.read(), undefined, kind);
  }
  const f = fixture(api), first = await f.read(); f.workspaceReview.revision++;
  assert.notEqual((await f.read()).verification.reference, first.verification.reference, 'same text with a new policy revision changes the current consent context');
  const disabledReader = api.createPrismaOAuthConsentReview({ ...config, enabled: false }, f.identity), disabledBefore = f.queries.length;
  assert.equal(await disabledReader.current(f.input, f.principal, f.tx, signal()), undefined); assert.equal(f.queries.length, disabledBefore);
  const controller = new AbortController(); controller.abort(); const before = f.queries.length;
  await assert.rejects(() => f.reader.current(f.input, f.principal, f.tx, controller.signal)); assert.equal(f.queries.length, before);
  const ddl = fs.readFileSync(path.join(root, 'packages/mcp-server/mysql-oauth-schema.sql'), 'utf8').split('-- Original current consent review policy')[1].split('-- Original platform review drafts')[0];
  assert.equal((ddl.match(/ENGINE=InnoDB/g) || []).length, 3); assert.equal((ddl.match(/ON DELETE RESTRICT/g) || []).length, 1); assert.match(ddl, /UNIQUE KEY mcp_oauth_subject_binding_unique/);
});
