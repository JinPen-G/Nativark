"use strict";
/** Completed Web decisions, SQL transactions and audit are explicit fixtures.
 * Actual original Auth/Guard, grant/code/token adapters and ESM exports run here;
 * this is NOT browser consent/MFA/CSRF, actual MySQL locks or production DI. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const { fixture: identityFixture, source, identity: als } = require('./fixtures/mcp/original-identity.cjs');
const root = path.resolve(__dirname, '..'), signal = () => new AbortController().signal;
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-consent-grant-verification-'));
  const packageRoot = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(staged, 'package.json'));
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ['node'],
    typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')],
    rootDir: path.join(packageRoot, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram([path.join(packageRoot, 'src/prisma-oauth-consent-authority.ts')], options));
  const consumer = path.join(output, 'consumer.mts');
  fs.writeFileSync(consumer, [
    'export { createPrismaOAuthConsentAuthority } from "@rental-os/mcp-server/prisma-oauth-consent-authority";',
    'export { createPrismaOAuthAdmissionStore } from "@rental-os/mcp-server/prisma-oauth-admission-store";',
    'export { createPrismaOAuthGrantAuthority } from "@rental-os/mcp-server/prisma-oauth-grant-authority";',
    'export { createPrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";',
    'export { createPrismaPublicClientRegistry } from "@rental-os/mcp-server/prisma-public-client-registry";',
    'export { createPersistentOAuthAuthorization } from "@rental-os/mcp-server/persistent-oauth-authorization";',
    'export { createPersistentOAuthTokenService, createPersistentOAuthResourceVerifier, oauthCredentialDigest } from "@rental-os/mcp-server/persistent-oauth-tokens";',
    'import type { OriginalCompletedOAuthConsentSource } from "@rental-os/mcp-server/prisma-oauth-consent-authority";',
    'import type { OAuthSqlTransaction } from "@rental-os/mcp-server/prisma-oauth-store";',
    'interface Native extends OAuthSqlTransaction { originalMarker: "original"; }',
    'export const nativeType = (source: OriginalCompletedOAuthConsentSource<Native>): OriginalCompletedOAuthConsentSource<Native> => ({',
    '  current: async (...args) => { const marker: "original" = args[2].originalMarker; void marker; return source.current(...args); },',
    '  audit: async (...args) => { const marker: "original" = args[0].originalMarker; void marker; return source.audit(...args); }',
    '});',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href);
  fs.writeFileSync(path.join(output, 'scope.json'), JSON.stringify({ strict: 'consent/grant/code/token/admission dependency closure and formal NodeNext exports; original native generics',
    original: 'actual Auth/Platform/Guard code, transpileOnly with external Nest/Prisma fixtures',
    external: 'completed browser consent/current browser rights/SQL locks/audit are explicit fixtures; no real consent UI/MFA/CSRF/DB/DI or publication' }, null, 2));
  return artifact;
}
const resource = 'https://mcp.example.invalid/mcp', scopes = ['rental.catalog.read'];
const verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
function fixture(api) {
  const original = identityFixture(), now = Math.floor(Date.now() / 1000);
  const request = { clientId: 'client-a', clientRevision: 1, resource, redirectUri: 'http://127.0.0.1:49501/callback', scopes, state: 'state-for-this-browser', codeChallenge: challenge };
  const client = { clientId: request.clientId, revision: 1, enabled: true, expiresAt: now + 300, redirectUris: ['http://127.0.0.1:49152/callback'], scopes };
  const platform = { resource, revision: 1, enabled: true, expiresAt: now + 600, clientIds: [client.clientId], scopes, clientType: 'public' };
  const workspace = { resource, revision: 1, enabled: true, expiresAt: now + 500, clientIds: [client.clientId], scopes, tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const f = { original, request, browser: new Request('https://as.example.invalid/authorize'),
    consent: { kind: 'approved', id: 'original-consent-a', revision: 1, expiresAt: now + 400, request,
      subject: 'issuer-subject-not-user-id', userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    sourceEnabled: true, sourceReads: 0, sourceHook: undefined, queryHook: undefined, afterAudit: undefined,
    loseCommit: false, cancelCommit: undefined, failAudit: false, replay: false, tail: Promise.resolve(), transactions: 0, calls: [], audits: [] };
  const workspaceKey = [resource, workspace.tenantId, workspace.workspaceId].join('|');
  f.state = { mcp_oauth_public_clients: { [client.clientId]: { clientId: client.clientId, revision: 1, recordJson: JSON.stringify(client) } },
    mcp_oauth_platform_admissions: { [resource]: { resource, revision: 1, recordJson: JSON.stringify(platform) } },
    mcp_oauth_workspace_admissions: { [workspaceKey]: { resource, tenantId: workspace.tenantId, workspaceId: workspace.workspaceId, revision: 1, recordJson: JSON.stringify(workspace) } },
    mcp_oauth_grants: {}, mcp_oauth_grant_authorizations: {}, mcp_oauth_codes: {}, mcp_oauth_families: {}, mcp_oauth_access: {}, mcp_oauth_refresh: {} };
  f.database = { async $transaction(callback, options) {
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
    const previous = f.tail; let release; f.tail = new Promise(resolve => { release = resolve; }); await previous;
    f.transactions++; const working = structuredClone(f.state), audits = [];
    const text = (parts, values) => { assert.ok(Array.isArray(parts.raw)); const sql = parts.join('?').replace(/\s+/g, ' ').trim(); f.calls.push({ sql, values: structuredClone(values) }); return sql; };
    const tx = { ...original.tx, originalMarker: 'original',
      async $queryRaw(parts, ...values) {
        const sql = text(parts, values), table = /FROM (\w+)/.exec(sql)[1]; assert.match(sql, /FOR UPDATE$/);
        const key = table === 'mcp_oauth_workspace_admissions' ? values.join('|') : values[0];
        const row = table === 'mcp_oauth_codes' && sql.includes('WHERE authorizationId') ? Object.values(working[table]).find(value => value.authorizationId === key) : working[table][key];
        const rows = row ? [structuredClone(row)] : []; return f.queryHook ? await f.queryHook(table, rows, tx) : rows;
      },
      async $executeRaw(parts, ...values) {
        const sql = text(parts, values), table = /(?:INTO|UPDATE) (\w+)/.exec(sql)[1];
        if (sql.startsWith('INSERT')) {
          assert.ok(!working[table][values[0]], 'synthetic unique primary key');
          if (table === 'mcp_oauth_grants') working[table][values[0]] = Object.fromEntries(['id', 'subject', 'userId', 'clientId', 'resource', 'tenantId', 'workspaceId', 'recordJson'].map((k, i) => [k, values[i]]));
          else if (table === 'mcp_oauth_grant_authorizations') { assert.ok(working.mcp_oauth_grants[values[2]], 'synthetic grant FK');
            assert.ok(!Object.values(working[table]).some(row => row.grantId === values[2]), 'synthetic unique grant association');
            working[table][values[0]] = Object.fromEntries(['authorizationId', 'authorizationRevision', 'grantId', 'consentHash', 'contextHash'].map((k, i) => [k, values[i]])); }
          else if (table === 'mcp_oauth_codes') { assert.ok(!Object.values(working[table]).some(row => row.authorizationId === values[1]), 'synthetic one code per original authorization');
            working[table][values[0]] = { digest: values[0], authorizationId: values[1], recordJson: values[2], consumedFamilyId: null }; }
          else if (table === 'mcp_oauth_families') working[table][values[0]] = { recordJson: values[1], revoked: 0 };
          else working[table][values[0]] = { familyId: values[1], recordJson: values[2], ...(table === 'mcp_oauth_refresh' ? { used: 0 } : {}) };
          return 1;
        }
        if (table === 'mcp_oauth_codes') { const row = working[table][values[1]]; if (!row || row.consumedFamilyId !== null) return 0; row.consumedFamilyId = values[0]; return 1; }
        const row = working[table][values[0]], flag = table === 'mcp_oauth_refresh' ? 'used' : 'revoked'; if (!row || row[flag] !== 0) return 0; row[flag] = 1; return 1;
      },
    };
    f.native = tx; f.pendingAudit = audits;
    try { const result = await callback(tx); if (f.replay) await callback(tx); f.state = working; f.audits.push(...audits);
      f.cancelCommit?.abort(); if (f.loseCommit) throw new Error('synthetic commit-response-loss'); return result; } finally { release(); }
  } };
  f.store = api.createPrismaOAuthStore(f.database, { record: async (tx, value) => { assert.equal(tx, f.native); if (f.failCodeAudit) throw new Error('synthetic code audit'); f.pendingAudit.push({ kind: 'code', ...value }); } });
  f.registry = api.createPrismaPublicClientRegistry(f.database);
  f.admissions = api.createPrismaOAuthAdmissionStore({ resourceUrl: resource, allowedScopes: scopes }, f.database, f.registry, {
    authorize: async () => { throw new Error('management not exercised here'); }, audit: async () => { throw new Error('management not exercised here'); },
  });
  const { createOriginalMcpGrantIdentity } = source('apps/api/src/modules/auth/original-mcp-grant-identity.ts');
  f.identity = createOriginalMcpGrantIdentity(original.auth);
  f.source = { current: async (input, browser, tx) => { assert.equal(tx, f.native); assert.equal(tx.originalMarker, 'original'); assert.ok(Object.isFrozen(input)); assert.ok(Object.isFrozen(input.scopes)); f.sourceReads++;
    if (!f.sourceEnabled || browser !== f.browser) return undefined; const value = structuredClone(f.consent); return f.sourceHook ? f.sourceHook(value, input) : value; },
    audit: async (tx, value) => { assert.equal(tx, f.native); if (f.failAudit) throw new Error('private-original-audit-detail'); f.pendingAudit.push({ kind: 'grant', ...value }); f.afterAudit?.(); },
  };
  f.authority = api.createPrismaOAuthConsentAuthority({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.store, f.registry, f.admissions, f.identity, f.source);
  f.codes = api.createPersistentOAuthAuthorization({ enabled: true, resourceUrl: resource, allowedScopes: scopes, codeTtlSeconds: 60 }, f.store, f.authority);
  f.grants = api.createPrismaOAuthGrantAuthority({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.store, f.registry, f.identity);
  f.tokens = api.createPersistentOAuthTokenService({ enabled: true, resourceUrl: resource, allowedScopes: scopes, accessTtlSeconds: 60, refreshTtlSeconds: 100 }, f.store, f.grants.issuance);
  f.verifier = api.createPersistentOAuthResourceVerifier({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.store, f.grants.access);
  f.authorize = (sig = signal(), input = f.request) => f.codes.authorize(input, f.browser, sig);
  f.receipt = () => f.store.transaction(tx => f.authority.receipt(f.request, f.browser, tx, signal()), signal());
  f.disable = kind => { const row = kind === 'grant' ? Object.values(f.state.mcp_oauth_grants)[0] : kind === 'platform' ? f.state.mcp_oauth_platform_admissions[resource] : f.state.mcp_oauth_workspace_admissions[workspaceKey]; row.recordJson = JSON.stringify({ ...JSON.parse(row.recordJson), enabled: false }); };
  return f;
}
const noCreation = f => { assert.deepEqual(f.state.mcp_oauth_grants, {}); assert.deepEqual(f.state.mcp_oauth_grant_authorizations, {}); assert.deepEqual(f.state.mcp_oauth_codes, {}); };

test('completed original consent persists one grant/code with real original identity, token and Guard consumers', async () => {
  const api = await compiled(), f = fixture(api), outcome = await f.authorize(); assert.equal(outcome.kind, 'code');
  const grant = JSON.parse(Object.values(f.state.mcp_oauth_grants)[0].recordJson), code = JSON.parse(Object.values(f.state.mcp_oauth_codes)[0].recordJson);
  assert.equal(Object.keys(f.state.mcp_oauth_grants).length, 1); assert.equal(code.grantId, grant.id); assert.equal(code.authorizationId, f.consent.id);
  assert.equal(grant.userId, 'user-a'); assert.equal(grant.subject, 'issuer-subject-not-user-id'); assert.equal(grant.expiresAt, JSON.parse(f.state.mcp_oauth_public_clients['client-a'].recordJson).expiresAt);
  assert.deepEqual(f.audits.map(row => row.kind), ['grant', 'code']); assert.equal(f.original.configReads, 0, 'no original Web secret/token borrowed');
  const receipt = await f.receipt(); assert.deepEqual(Object.keys(receipt).sort(), ['state', 'authorizationId', 'authorizationRevision', 'grantId'].sort()); assert.equal(receipt.grantId, grant.id);
  const token = await f.tokens.exchangeCode({ clientId: 'client-a', clientRevision: 1, code: outcome.code, codeVerifier: verifier, redirectUri: f.request.redirectUri, resource }, signal());
  assert.equal((await f.verifier.verifyAccessToken(token.access_token)).subject, grant.subject);
  await f.store.transaction(tx => f.original.auth.withTrustedWorkspacePrincipal(f.store.native(tx), async () => f.grants.principal(grant.id, tx, signal()), signal(), resolve =>
    f.original.guard.withTrustedCatalogRead(2, resolve, async value => { assert.equal(value.userId, 'user-a'); assert.equal(als.requireRequestUserId(), 'user-a'); return 'original-catalog-permit'; }, signal())), signal());
  assert.equal(als.getRequestIdentity(), undefined);
  assert.ok(!JSON.stringify(f.state).includes(outcome.code)); assert.ok(!JSON.stringify(f.state).includes(token.access_token));
  assert.ok(f.calls.every(call => !call.sql.includes(f.consent.id)), 'original keys are tagged SQL parameters');
});

test('missing consent, caller confirmation, changed request, getters, expired admission and original account restrictions cannot create', async () => {
  const api = await compiled();
  for (const kind of ['missing', 'confirmed', 'wrong-request', 'extra-actor', 'getter', 'expired', 'disabled-policy', 'password-change', 'inactive-member', 'late-consent', 'scope-expansion', 'foreign-space']) {
    const f = fixture(api); let input = f.request, getterCalls = 0;
    if (kind === 'missing') f.sourceEnabled = false;
    if (kind === 'confirmed') input = { ...input, confirmed: true };
    if (kind === 'wrong-request') input = { ...input, state: 'different-original-state' };
    if (kind === 'extra-actor') f.sourceHook = value => ({ ...value, actor: 'administrator' });
    if (kind === 'getter') f.sourceHook = value => { Object.defineProperty(value, 'kind', { enumerable: true, get() { getterCalls++; return 'approved'; } }); return value; };
    if (kind === 'expired') f.consent.expiresAt = 1;
    if (kind === 'disabled-policy') f.disable('workspace');
    if (kind === 'password-change') f.original.user.mustChangePassword = true;
    if (kind === 'inactive-member') f.original.member.isActive = false;
    if (kind === 'late-consent') f.sourceHook = value => ({ ...value, subject: f.sourceReads > 1 ? 'late-different-subject' : value.subject });
    if (kind === 'scope-expansion') input = { ...input, scopes: ['rental.order.commit'] };
    if (kind === 'foreign-space') f.consent.tenantId = 'foreign-tenant';
    await assert.rejects(() => f.authorize(signal(), input), /unavailable/i, kind); noCreation(f); assert.equal(getterCalls, 0);
  }
  const denied = fixture(api); denied.consent.kind = 'denied'; assert.deepEqual(await denied.authorize(), { kind: 'denied', error: 'access_denied' }); noCreation(denied);
  assert.throws(() => api.createPrismaOAuthConsentAuthority({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, denied.store, denied.registry, denied.admissions, denied.identity), /unavailable/i);
});

test('two stores share the original authorization key; no second grant/code or revoked-grant revival, receipts stay independent', async () => {
  const api = await compiled(), f = fixture(api), otherStore = api.createPrismaOAuthStore(f.database, { record: async (tx, value) => { assert.equal(tx, f.native); f.pendingAudit.push({ kind: 'code', ...value }); } });
  const otherAuthority = api.createPrismaOAuthConsentAuthority({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, otherStore, f.registry, f.admissions, f.identity, f.source);
  const otherCodes = api.createPersistentOAuthAuthorization({ enabled: true, resourceUrl: resource, allowedScopes: scopes, codeTtlSeconds: 60 }, otherStore, otherAuthority);
  const results = await Promise.allSettled([f.authorize(), otherCodes.authorize(f.request, f.browser, signal())]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1); assert.equal(Object.keys(f.state.mcp_oauth_grants).length, 1); assert.equal(Object.keys(f.state.mcp_oauth_codes).length, 1);
  const grantId = Object.keys(f.state.mcp_oauth_grants)[0]; f.sourceHook = value => Object.fromEntries(Object.entries(value).reverse()); assert.equal((await f.receipt()).grantId, grantId);
  f.disable('platform'); f.disable('grant'); assert.equal((await f.receipt()).grantId, grantId, 'historical association does not claim current issuance');
  await assert.rejects(() => f.authorize()); assert.equal(Object.keys(f.state.mcp_oauth_grants).length, 1);
  f.sourceHook = undefined; f.consent.kind = 'denied'; await assert.rejects(() => f.authorize()); f.consent.kind = 'approved';
  f.sourceEnabled = false; await assert.rejects(() => f.receipt());
  const missing = fixture(api); assert.deepEqual(await missing.receipt(), { state: 'not_observed', retryable: false }); noCreation(missing);
});

test('audit rollback, late loss of rights, unknown commit/cancellation and corrupt association preserve exact evidence without retry', async () => {
  const api = await compiled();
  for (const mode of ['grant-audit', 'code-audit', 'late-membership', 'late-policy', 'replay']) {
    const f = fixture(api); f.failAudit = mode === 'grant-audit'; f.failCodeAudit = mode === 'code-audit'; f.replay = mode === 'replay';
    if (mode === 'late-membership') f.afterAudit = () => { f.original.member.isActive = false; };
    if (mode === 'late-policy') f.queryHook = (table, rows) => { if (table === 'mcp_oauth_workspace_admissions' && f.pendingAudit.some(row => row.kind === 'grant'))
      rows[0].recordJson = JSON.stringify({ ...JSON.parse(rows[0].recordJson), enabled: false }); return rows; };
    await assert.rejects(() => f.authorize()); noCreation(f); assert.deepEqual(f.audits, []);
  }
  for (const mode of ['unknown-commit', 'post-commit-cancel']) {
    const f = fixture(api), controller = new AbortController(); f.loseCommit = mode === 'unknown-commit'; f.cancelCommit = mode === 'post-commit-cancel' ? controller : undefined;
    const before = f.transactions; await assert.rejects(() => f.authorize(controller.signal)); assert.equal(f.transactions, before + 1);
    assert.equal(Object.keys(f.state.mcp_oauth_grants).length, 1); assert.equal(Object.keys(f.state.mcp_oauth_codes).length, 1);
    f.loseCommit = false; f.cancelCommit = undefined; assert.equal((await f.receipt()).state, 'observed');
    await assert.rejects(() => f.authorize()); assert.equal(Object.keys(f.state.mcp_oauth_codes).length, 1);
  }
  const corrupt = fixture(api); await corrupt.authorize(); corrupt.state.mcp_oauth_grant_authorizations[corrupt.consent.id].consentHash = '0'.repeat(64);
  await assert.rejects(() => corrupt.receipt(), /unavailable/i);
  const getter = fixture(api); await getter.authorize(); let getterCalls = 0;
  getter.queryHook = (table, rows) => { if (table === 'mcp_oauth_grants') Object.defineProperty(rows[0], 'recordJson', { enumerable: true, get() { getterCalls++; return '{}'; } }); return rows; };
  await assert.rejects(() => getter.receipt()); assert.equal(getterCalls, 0);
  const controller = new AbortController(), late = fixture(api); controller.abort(); await assert.rejects(() => late.authorize(controller.signal)); assert.equal(late.transactions, 0); noCreation(late);
  const ddl = fs.readFileSync(path.join(root, 'packages/mcp-server/mysql-oauth-schema.sql'), 'utf8').split('-- Completed original Web consent')[1].split('-- Trusted Web consent preparation')[0];
  assert.equal((ddl.match(/ENGINE=InnoDB/g) || []).length, 1); assert.equal((ddl.match(/ON DELETE RESTRICT/g) || []).length, 1);
  assert.match(ddl, /PRIMARY KEY \(authorizationId\)/); assert.match(ddl, /UNIQUE KEY mcp_oauth_grant_authorization_grant \(grantId\)/);
});
