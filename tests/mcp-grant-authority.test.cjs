"use strict";
/** Actual current-grant/AS/identity adapters. SQL rows and original consent/audit
 * are explicit substitutes, never a production grant or MySQL lock proof. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { createRequire, registerHooks } = require('node:module'), { pathToFileURL } = require('node:url');
const { fixture: identityFixture, source, identity: als } = require('./fixtures/mcp/original-identity.cjs');
const { createOriginalMcpGrantManagement } = source('apps/api/src/modules/auth/original-mcp-grant-management.ts');
const { createOriginalMcpGrantControlPlane } = source('apps/api/src/modules/auth/original-mcp-grant-control-plane.ts');
const { OperationLogService } = source('apps/api/src/common/operation-log.service.ts');
const { PlatformService } = source('apps/api/src/modules/platform/platform.service.ts');
const root = path.resolve(__dirname, '..'), signal = () => new AbortController().signal;
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-grant-authority-verification-'));
  const packageRoot = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(staged, 'package.json'));
  const typeRoots = [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')];
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ['node'], typeRoots,
    rootDir: path.join(packageRoot, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
    assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram([path.join(packageRoot, 'src/grant-control-plane.ts')], options));
  const consumer = path.join(output, 'consumer.mts');
  fs.writeFileSync(consumer, [
    'export { createPrismaOAuthGrantAuthority, capturePersistedOAuthGrant } from "@rental-os/mcp-server/prisma-oauth-grant-authority";',
    'export { createPrismaOAuthGrantManagementStore, captureOAuthGrantRevocationReceipt } from "@rental-os/mcp-server/prisma-oauth-grant-management";',
    'export { createPrismaOAuthGrantUseStore } from "@rental-os/mcp-server/prisma-oauth-grant-use";',
    'export { createPrismaMcpReadBudget } from "@rental-os/mcp-server/prisma-mcp-read-budget";',
    'export { createPrismaMcpReadReceiptStore } from "@rental-os/mcp-server/prisma-mcp-read-receipt";',
    'import { createPrismaMcpReadReceiptStore } from "@rental-os/mcp-server/prisma-mcp-read-receipt";',
    'export function typedReadReceipt(db: OAuthSqlDatabase<OriginalNative>, grants: Pick<import("@rental-os/mcp-server/prisma-oauth-grant-management").PrismaOAuthGrantManagementStore<OriginalNative>, "readIn">, owner: Pick<import("@rental-os/mcp-server/prisma-oauth-grant-management").OriginalOAuthGrantManagement<OriginalNative>, "authorize">) { return createPrismaMcpReadReceiptStore({ resourceUrl: "https://mcp.example.invalid/mcp" }, db, grants, owner); }',
    'export { createMcpGrantControlPlane } from "@rental-os/mcp-server/grant-control-plane";',
    'import { createMcpGrantControlPlane } from "@rental-os/mcp-server/grant-control-plane";',
    'import type { McpGrantControlPlaneConfig, OriginalMcpGrantControlPlaneDependencies } from "@rental-os/mcp-server/grant-control-plane";',
    'export function typedGrant(config: McpGrantControlPlaneConfig, original: OriginalMcpGrantControlPlaneDependencies<OriginalNative>) { return createMcpGrantControlPlane(config, original); }',
    'export { createPersistentOAuthAccessReader } from "@rental-os/mcp-server/persistent-oauth-tokens";',
    'export { createPrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";',
    'export { createPrismaPublicClientRegistry } from "@rental-os/mcp-server/prisma-public-client-registry";',
    'export { createPersistentOAuthTokenService, createPersistentOAuthResourceVerifier, oauthCredentialDigest } from "@rental-os/mcp-server/persistent-oauth-tokens";',
    'import type { OAuthSqlTransaction, OAuthSqlDatabase, PrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";',
    'import { createPrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";',
    'interface OriginalNative extends OAuthSqlTransaction { originalMarker: "original"; }',
    'export function richNative(database: OAuthSqlDatabase<OriginalNative>): PrismaOAuthStore<OriginalNative> {',
    '  return createPrismaOAuthStore(database, { record: async native => { const marker: "original" = native.originalMarker; void marker; } });',
    '}',
    'export const markerInOriginalTransaction = (store: PrismaOAuthStore<OriginalNative>) => store.transaction(async tx => store.native(tx).originalMarker, new AbortController().signal);',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  const stagedUrl = pathToFileURL(staged + path.sep).href;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(stagedUrl) && specifier === '@modelcontextprotocol/server') return { url: pathToFileURL(installed.resolve(specifier)).href, shortCircuit: true };
    return next(specifier, context);
  } });
  try { artifact = { ...await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href),
    ...await import(pathToFileURL(path.join(staged, 'dist/read-tools.js')).href) }; } finally { hooks.deregister(); }
  fs.writeFileSync(path.join(output, 'scope.json'), JSON.stringify({ strict: 'grant authority/OAuth closure and generic original-native NodeNext consumer',
    identity: 'actual original Auth/Platform/Guard adapter sources; external Nest/Prisma facade',
    excluded: 'no applied schema, actual Prisma client types, DB/DI boot, trusted consent UI or business publication' }, null, 2));
  return artifact;
}
const resource = 'https://mcp.example.invalid/mcp', scopes = ['rental.catalog.read'];
function fixture(api) {
  const original = identityFixture(), now = Math.floor(Date.now() / 1000);
  const client = { clientId: 'client-a', revision: 1, enabled: true, expiresAt: now + 300, redirectUris: ['http://127.0.0.1:49152/callback'], scopes };
  const platform = { resource, revision: 1, enabled: true, expiresAt: now + 600, clientIds: ['client-a'], scopes, clientType: 'public' };
  const workspace = { resource, revision: 1, enabled: true, expiresAt: now + 500, clientIds: ['client-a'], scopes, tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const grant = { id: 'grant-a', subject: 'issuer-subject-not-user-id', revision: 1, enabled: true, expiresAt: now + 400,
    clientId: 'client-a', resource, scopes, userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a',
    clientRevision: 1, platformRevision: 1, workspaceRevision: 1, consentRef: 'trusted-consent', consentRevision: 1 };
  const f = { original, client, platform, workspace, grant, tail: Promise.resolve(), queries: [], transactions: 0, queryHook: undefined, audits: [] };
  const key = [resource, 'tenant-a', 'workspace-a'].join('|');
  const state = f.state = {
    mcp_oauth_public_clients: { 'client-a': { clientId: 'client-a', revision: 1, recordJson: JSON.stringify(client) } },
    mcp_oauth_platform_admissions: { [resource]: { resource, revision: 1, recordJson: JSON.stringify(platform) } },
    mcp_oauth_workspace_admissions: { [key]: { resource, tenantId: 'tenant-a', workspaceId: 'workspace-a', revision: 1, recordJson: JSON.stringify(workspace) } },
    mcp_oauth_grants: { 'grant-a': { id: 'grant-a', subject: grant.subject, userId: grant.userId, clientId: 'client-a', resource, tenantId: 'tenant-a', workspaceId: 'workspace-a', recordJson: JSON.stringify(grant) } },
    mcp_oauth_codes: {}, mcp_oauth_families: {}, mcp_oauth_access: {}, mcp_oauth_refresh: {}, client_api_rate_buckets: {},
  };
  f.set = (kind, changes) => {
    const row = kind === 'grant' ? f.state.mcp_oauth_grants['grant-a'] : kind === 'client' ? f.state.mcp_oauth_public_clients['client-a']
      : kind === 'platform' ? f.state.mcp_oauth_platform_admissions[resource] : f.state.mcp_oauth_workspace_admissions[key];
    row.recordJson = JSON.stringify({ ...JSON.parse(row.recordJson), ...changes });
    if ('revision' in changes && kind !== 'grant') row.revision = changes.revision;
  };
  f.database = { async $transaction(callback, options) {
    assert.equal(options.isolationLevel, 'Serializable'); const previous = f.tail; let release; f.tail = new Promise(resolve => { release = resolve; }); await previous;
    f.transactions++; const working = structuredClone(f.state); const pendingAudit = [];
    const text = (parts, values) => { assert.ok(Array.isArray(parts.raw)); const sql = parts.join('?').replace(/\s+/g, ' ').trim(); f.queries.push({ sql, values: structuredClone(values) }); return sql; };
    const native = { ...original.tx, ...(f.nativeExtra ?? {}), originalMarker: 'original',
      async $queryRaw(parts, ...values) {
        const sql = text(parts, values), table = /FROM (\w+)/.exec(sql)[1];
        if (table==='client_api_rate_buckets') {
          if (f.missingReceiptRateSchema) throw Error('explicit missing original rate table');
          const row=working[table][values[0]+'|'+values[1].getTime()];return f.missingReceiptRateRow ? [] : row ? [{ count:row.count }] : [];
        }
        if (!sql.endsWith('FOR UPDATE')) assert.equal(sql, 'SELECT goalId FROM mcp_read_calls WHERE callId = ?');
        const extra = f.queryExtra?.(working, sql, values); if (extra !== undefined) return extra;
        const lookup = table === 'mcp_oauth_workspace_admissions' ? values.join('|') : values[0];
        const row = table === 'mcp_oauth_codes' && sql.includes('WHERE authorizationId') ? Object.values(working[table]).find(row => row.authorizationId === lookup) : working[table][lookup];
        const rows = row ? [structuredClone(row)] : []; return f.queryHook ? await f.queryHook(table, rows, sql) : rows;
      },
      async $executeRaw(parts, ...values) {
        const sql = text(parts, values), table = /(?:INTO|UPDATE) (\w+)/.exec(sql)[1];
        if (table==='client_api_rate_buckets') {
          if (f.missingReceiptRateSchema) throw Error('explicit missing original rate table');
          const key=values[1]+'|'+values[2].getTime(),old=working[table][key];working[table][key]={ scopeKey:values[1],bucketStart:values[2],count:(old?.count ?? 0)+1 };return old ? 2 : 1;
        }
        const extra = f.executeExtra?.(working, sql, values); if (extra !== undefined) return extra;
        if (sql.startsWith('INSERT')) {
          assert.ok(!working[table][values[0]], 'synthetic unique digest/id');
          if (table === 'mcp_oauth_codes') working[table][values[0]] = { digest: values[0], authorizationId: values[1], recordJson: values[2], consumedFamilyId: null };
          else if (table === 'mcp_oauth_families') working[table][values[0]] = { recordJson: values[1], revoked: 0 };
          else { assert.ok(working.mcp_oauth_families[values[1]], 'synthetic family FK'); working[table][values[0]] = { familyId: values[1], recordJson: values[2], ...(table === 'mcp_oauth_refresh' ? { used: 0 } : {}) }; }
          return 1;
        }
        if (table === 'mcp_oauth_codes') { const row = working[table][values[1]]; if (!row || row.consumedFamilyId !== null) return 0; row.consumedFamilyId = values[0]; return 1; }
        const row = working[table][values[0]], flag = table === 'mcp_oauth_refresh' ? 'used' : 'revoked';
        if (!row || row[flag] !== 0) return 0; row[flag] = 1; return 1;
      },
    };
    f.native = native; f.pendingAudit = pendingAudit;
    try { const result = await callback(native); f.state = working; f.audits.push(...pendingAudit); f.cancelCommit?.abort(); if (f.loseCommit) throw new Error('private commit-response-loss'); return result; } finally { release(); }
  } };
  f.store = api.createPrismaOAuthStore(f.database, { record: async (native, value) => { assert.equal(native.originalMarker, 'original'); f.pendingAudit.push(value); } });
  f.registry = api.createPrismaPublicClientRegistry(f.database);
  const { createOriginalMcpGrantIdentity } = source('apps/api/src/modules/auth/original-mcp-grant-identity.ts');
  f.currentIdentity = createOriginalMcpGrantIdentity(original.auth);
  f.authority = api.createPrismaOAuthGrantAuthority({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.store, f.registry, f.currentIdentity);
  f.read = () => f.store.transaction(tx => f.authority.access.current('grant-a', tx, signal()), signal());
  f.tokens = api.createPersistentOAuthTokenService({ enabled: true, resourceUrl: resource, allowedScopes: scopes, accessTtlSeconds: 60, refreshTtlSeconds: 100 }, f.store, f.authority.issuance);
  f.verifier = api.createPersistentOAuthResourceVerifier({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.store, f.authority.access);
  f.issue = async () => {
    const verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
    await f.store.transaction(tx => tx.insertCode({ digest: api.oauthCredentialDigest('original-code'), authorizationId: 'trusted-consent', authorizationRevision: 1,
      grantId: grant.id, subject: grant.subject, grantRevision: 1, clientId: client.clientId, resource, scopes, redirectUri: client.redirectUris[0],
      codeChallengeMethod: 'S256', codeChallenge: challenge, expiresAt: now + 90, consumedFamilyId: null }), signal());
    return f.tokens.exchangeCode({ clientId: 'client-a', clientRevision: 1, code: 'original-code', codeVerifier: verifier, redirectUri: client.redirectUris[0], resource }, signal());
  };
  return f;
}

test('current SQL admission/grant is bound to real original identity and original token lifecycle', async () => {
  const api = await compiled(), f = fixture(api);
  const current = await f.read(); assert.equal(current.subject, f.grant.subject); assert.equal(current.expiresAt, f.client.expiresAt);
  assert.deepEqual(Object.keys(current).sort(), ['clientId', 'expiresAt', 'id', 'resource', 'revision', 'scopes', 'subject'].sort());
  const token = await f.issue(), verified = await f.verifier.verifyAccessToken(token.access_token);
  assert.equal(verified.subject, f.grant.subject); assert.equal(f.original.configReads, 0, 'no original Web token or secret is used');
  await f.store.transaction(async tx => {
    const native = f.store.native(tx); assert.equal(native.originalMarker, 'original');
    return f.original.auth.withTrustedWorkspacePrincipal(native, async () => f.authority.principal('grant-a', tx, signal()), signal(), resolve =>
      f.original.guard.withTrustedCatalogRead(2, resolve, async value => {
        assert.equal(value.userId, 'user-a'); assert.equal(value.tenantId, 'tenant-a'); assert.equal(value.workspaceId, 'workspace-a');
        assert.equal(als.requireRequestUserId(), 'user-a'); assert.deepEqual(value.locationScope, { mode: 'selected', locationIds: ['loc-a'] }); return 'internal-read-only';
      }, signal()));
  }, signal());
  assert.equal(als.getRequestIdentity(), undefined);
  const rotated = await f.tokens.refresh({ clientId: 'client-a', clientRevision: 1, resource, refreshToken: token.refresh_token }, signal());
  assert.notEqual(rotated.refresh_token, token.refresh_token);
  await f.tokens.revoke({ clientId: 'client-a', clientRevision: 1, token: rotated.refresh_token }, signal());
  await assert.rejects(() => f.verifier.verifyAccessToken(token.access_token));
  assert.ok(f.queries.every(query => !query.sql.includes('grant-a')), 'grant/client keys are SQL parameters');
});

test('platform/workspace/client/grant and original account restrictions fail closed without resetting a family', async () => {
  const api = await compiled();
  for (const kind of ['platform-disabled', 'workspace-disabled', 'client-disabled', 'grant-disabled', 'empty-policy', 'scope-expansion', 'client-revision', 'platform-revision', 'workspace-revision', 'inactive-user', 'inactive-member', 'password-change', 'cross-user']) {
    const f = fixture(api);
    if (kind === 'empty-policy') f.set('platform', { clientIds: [], scopes: [] });
    else if (kind === 'scope-expansion') f.set('grant', { scopes: ['rental.order.commit'] });
    else if (kind.endsWith('-disabled')) f.set(kind.split('-')[0], { enabled: false });
    else if (kind.endsWith('-revision')) f.set(kind.split('-')[0], { revision: 2 });
    else if (kind === 'inactive-user') f.original.user.isActive = false;
    else if (kind === 'inactive-member') f.original.member.isActive = false;
    else if (kind === 'password-change') f.original.user.mustChangePassword = true;
    else if (kind === 'cross-user') { f.set('grant', { userId: 'another-user' }); f.state.mcp_oauth_grants['grant-a'].userId = 'another-user'; }
    assert.equal(await f.read(), undefined, kind); assert.deepEqual(f.state.mcp_oauth_families, {});
  }
  const f = fixture(api), token = await f.issue(); f.set('platform', { enabled: false });
  await assert.rejects(() => f.verifier.verifyAccessToken(token.access_token), error => error.kind === 'invalid');
  await assert.rejects(() => f.tokens.refresh({ clientId: 'client-a', clientRevision: 1, resource, refreshToken: token.refresh_token }, signal()));
  await f.tokens.revoke({ clientId: 'another-client', clientRevision: 1, token: token.access_token }, signal());
  assert.ok(Object.values(f.state.mcp_oauth_families).every(row => row.revoked === 0));
  await f.tokens.revoke({ clientId: 'client-a', clientRevision: 1, token: token.access_token }, signal());
  assert.ok(Object.values(f.state.mcp_oauth_families).every(row => row.revoked === 1), 'issuance disable does not disable owned revocation');
});

test('missing linked evidence, corrupted bindings, getters and cancellation remain unavailable', async () => {
  const api = await compiled();
  for (const kind of ['missing-grant', 'missing-platform', 'missing-workspace', 'missing-client', 'index-mismatch', 'principal-index-mismatch', 'private-field']) {
    const f = fixture(api);
    if (kind === 'missing-grant') f.state.mcp_oauth_grants = {};
    if (kind === 'missing-platform') f.state.mcp_oauth_platform_admissions = {};
    if (kind === 'missing-workspace') f.state.mcp_oauth_workspace_admissions = {};
    if (kind === 'missing-client') f.state.mcp_oauth_public_clients = {};
    if (kind === 'index-mismatch') f.state.mcp_oauth_grants['grant-a'].tenantId = 'another-tenant';
    if (kind === 'principal-index-mismatch') f.set('grant', { userId: 'another-user' });
    if (kind === 'private-field') f.set('grant', { actor: 'forged' });
    await assert.rejects(() => f.read(), /unavailable/i, kind);
  }
  const f = fixture(api); let getters = 0;
  f.queryHook = (table, rows) => { if (table === 'mcp_oauth_grants') Object.defineProperty(rows[0], 'recordJson', { enumerable: true, get() { getters++; return '{}'; } }); return rows; };
  await assert.rejects(() => f.read()); assert.equal(getters, 0);
  f.queryHook = undefined; const controller = new AbortController(); controller.abort();
  const before = f.transactions; await assert.rejects(() => f.store.transaction(tx => f.authority.access.current('grant-a', tx, controller.signal), controller.signal)); assert.equal(f.transactions, before);
  f.set('grant', { scopes: null });
  assert.equal(await f.store.transaction(tx => f.authority.issuance.revocationOwner('grant-a', 'client-a', tx, signal()), signal()), true, 'ownership ignores damaged issuance metadata');
});

test('same-revision late grant mutation and current-identity cancellation never release a late permit', async () => {
  const api = await compiled(), f = fixture(api); let reads = 0;
  f.queryHook = (table, rows) => { if (table === 'mcp_oauth_grants' && ++reads >= 2) {
    const row = JSON.parse(rows[0].recordJson); row.subject = 'changed-subject'; rows[0].recordJson = JSON.stringify(row);
  } return rows; };
  await assert.rejects(() => f.read()); assert.deepEqual(f.state.mcp_oauth_families, {});
  const cancelled = fixture(api), controller = new AbortController();
  cancelled.queryHook = (table, rows) => { if (table === 'mcp_oauth_workspace_admissions') controller.abort(); return rows; };
  await assert.rejects(() => cancelled.store.transaction(tx => cancelled.authority.access.current('grant-a', tx, controller.signal), controller.signal));
  const ddl = fs.readFileSync(path.join(root, 'packages/mcp-server/mysql-oauth-schema.sql'), 'utf8').split('-- Current grant/admission storage contract')[1].split('-- Admission management original-operation receipts')[0];
  assert.equal((ddl.match(/ENGINE=InnoDB/g) || []).length, 3);
  assert.equal((ddl.match(/ON DELETE RESTRICT/g) || []).length, 3);
  assert.match(ddl, /subject VARCHAR\(200\)/); assert.match(ddl, /userId VARCHAR\(36\)/);
});

test('original Web owner/tenant manager reads credential-free grant summary and revoke CAS disables original tokens', async () => {
  const api = await compiled();
  const setup = () => {
    const f = fixture(api), now = Math.floor(Date.now() / 1000), session = { id: 'grant-management-session', userId: 'user-a', audience: 'operator', currentWorkspaceId: 'workspace-a', expiresAt: new Date((now + 900) * 1000), revokedAt: null };
    f.state.mcp_oauth_grant_operations = {}; f.state.mcp_oauth_grant_last_use = {};
    f.state.mcp_read_goal_budgets = {}; f.state.mcp_read_calls = {}; // explicit SQL/target substitutes; actual budget/receipt code below
    f.original.platform.getAuthSession = (...args) => PlatformService.prototype.getAuthSession.call(f.original.platform, ...args);
    f.original.platform.assertTrustedWorkspaceIntegrationManagement = (...args) => PlatformService.prototype.assertTrustedWorkspaceIntegrationManagement.call(f.original.platform, ...args);
    f.nativeExtra = { authSession: { findFirst: async () => structuredClone(session) }, operationLog: { create: async ({ data }) => { if (f.failAudit) throw new Error('private audit failure'); f.pendingAudit.push(data); return { id: 'original-grant-management-audit' }; } } };
    f.queryExtra = (working, sql, values) => {
      if (sql.startsWith('SELECT callId, goalId, grantId FROM mcp_read_calls WHERE grantId')) {
        const rows = Object.values(working.mcp_read_calls).filter(row => row.grantId === values[0] && (!sql.includes('AND callId >') || row.callId > values[1]))
          .sort((a, b) => a.callId < b.callId ? -1 : a.callId > b.callId ? 1 : 0).slice(0, values.at(-1)).map(row => ({ callId: row.callId, goalId: row.goalId, grantId: row.grantId }));
        return f.indexHook ? f.indexHook(rows) : rows;
      }
      if (sql.startsWith('SELECT goalId FROM mcp_read_calls')) { const row = working.mcp_read_calls[values[0]]; return row ? [{ goalId: row.goalId }] : []; }
      if (sql.includes('FROM auth_sessions')) return [{ id: session.id }];
      if (sql.includes('FROM mcp_oauth_grant_last_use')) { assert.match(sql, /CAST\(observedAtMs AS CHAR\)/); const row = working.mcp_oauth_grant_last_use[values[0]]; return row ? [{ ...structuredClone(row), observedAtMs: String(row.observedAtMs) }] : []; }
      if (sql.includes('FROM mcp_oauth_grants WHERE resource')) return Object.values(working.mcp_oauth_grants)
        .filter(row => row.resource === values[0] && row.userId === values[1] && row.tenantId === values[2] && row.workspaceId === values[3] && (!sql.includes('AND id >') || row.id > values[4]))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, values.at(-1)).map(row => structuredClone(row));
    };
    f.executeExtra = (working, sql, values) => {
      if (sql.startsWith('INSERT INTO mcp_read_goal_budgets')) {
        assert.ok(!working.mcp_read_goal_budgets[values[0]], 'synthetic unique ORIGINAL goal');
        working.mcp_read_goal_budgets[values[0]] = { goalId: values[0], grantId: values[1], bindingHash: values[2], recordJson: values[3], revision: 1,
          consumedCalls: values[4], consumedActiveMs: values[5], reservedActiveMs: values[6], concurrentReads: values[7] }; return 1;
      }
      if (sql.startsWith('INSERT INTO mcp_read_calls')) {
        assert.ok(!working.mcp_read_calls[values[0]] && working.mcp_read_goal_budgets[values[1]]?.grantId === values[2], 'synthetic unique call / ORIGINAL goal-grant FK');
        working.mcp_read_calls[values[0]] = { callId: values[0], goalId: values[1], grantId: values[2], callBindingHash: values[3], recordJson: values[4], state: 'reserved', activeMs: null }; return 1;
      }
      if (sql.startsWith('UPDATE mcp_read_goal_budgets')) {
        const row = working.mcp_read_goal_budgets[values[5]]; if (!row || row.revision !== values[6] || row.bindingHash !== values[7]) return 0;
        Object.assign(row, { revision: values[0], consumedCalls: values[1], consumedActiveMs: values[2], reservedActiveMs: values[3], concurrentReads: values[4] }); return 1;
      }
      if (sql.startsWith('UPDATE mcp_read_calls')) {
        const unknown = sql.includes("SET state = 'unknown'"), row = working.mcp_read_calls[values[unknown ? 0 : 2]];
        if (!row || row.state !== 'reserved' || row.callBindingHash !== values[unknown ? 1 : 3]) return 0;
        row.state = unknown ? 'unknown' : values[0]; row.activeMs = unknown ? null : values[1]; return 1;
      }
      if (sql.includes('INTO mcp_oauth_grant_last_use')) { assert.equal(f.authorityHeld, false, 'usage starts after original authority transaction settles'); if (f.failUse) throw new Error('use persistence failure'); assert.ok(!working.mcp_oauth_grant_last_use[values[0]]); working.mcp_oauth_grant_last_use[values[0]] = Object.fromEntries(['grantId', 'resource', 'userId', 'tenantId', 'workspaceId', 'clientId', 'grantRevision', 'observedAtMs'].map((k, i) => [k, values[i]])); return 1; }
      if (sql.startsWith('UPDATE mcp_oauth_grant_last_use')) { const row = working.mcp_oauth_grant_last_use[values[2]]; if (!row || row.observedAtMs !== values[3]) return 0; row.observedAtMs = values[0]; row.grantRevision = values[1]; return 1; }
      if (sql.startsWith('UPDATE mcp_oauth_grants')) { const row = working.mcp_oauth_grants[values[1]], g = row && JSON.parse(row.recordJson); if (!g || g.revision !== Number(values[6]) || !g.enabled || f.casFail) return 0; row.recordJson = values[0]; return 1; }
      if (sql.includes('INTO mcp_oauth_grant_operations')) { assert.ok(!working.mcp_oauth_grant_operations[values[0]]); working.mcp_oauth_grant_operations[values[0]] = Object.fromEntries(['actorId', 'grantId', 'resource', 'tenantId', 'workspaceId', 'payloadHash', 'resultJson'].map((k, i) => [k, values[i + 1]])); return 1; }
    };
    const browser = new Request('https://admin.example.invalid/mcp/grants', { headers: { authorization: 'Bearer ' + f.original.auth.signAccessToken({ sub: 'user-a', tid: 'tenant-a', sid: session.id, wid: 'workspace-a', aud: 'operator', iat: now, exp: now + 800 }) } });
    f.browser = browser;
    f.receiptTraffic={ forRequest:()=>({ current:async(request,native)=>{
      assert.equal(native,f.native);assert.deepEqual(request.owner,{ userId:'user-a',tenantId:'tenant-a',workspaceId:'workspace-a' });
      assert.match(request.queryHash,/^[a-f0-9]{64}$/);assert.ok(['exact_call','call_index'].includes(request.kind));
      f.rateFacts=(f.rateFacts ?? []).concat([request]);
      return f.missingReceiptRatePolicy ? undefined : { policyRef:'original-test-receipt-policy',policyRevision:1,expiresAt:now+800,windowSeconds:3600,limit:f.receiptRateLimit ?? 100 };
    } }) };
    const readOnly = { readIn: (...args) => f.managementStore.readIn(...args) }, logs = f.logs = new OperationLogService({ operationLog: { create() { throw new Error('Global audit forbidden'); } } });
    const author = createOriginalMcpGrantManagement({ grant: api.capturePersistedOAuthGrant, receipt: api.captureOAuthGrantRevocationReceipt }, { resourceUrl: resource }, f.original.auth, f.original.platform, browser, readOnly, logs);
    f.useStore = api.createPrismaOAuthGrantUseStore({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.store, f.authority);
    f.managementStore = api.createPrismaOAuthGrantManagementStore({ resourceUrl: resource }, f.database, author, f.useStore); return f;
  };
  const f = setup(), token = await f.issue(), summary = await f.managementStore.read('grant-a', signal());
  assert.equal(summary.revocationState, 'not_revoked'); assert.deepEqual(summary.oauthAdmission, { state: 'unavailable' }, 'legacy wiring cannot infer current OAuth admission'); assert.equal(summary.lastUse.state, 'unavailable'); assert.ok(!JSON.stringify(summary).includes(f.grant.subject));
  assert.ok(!JSON.stringify(summary).includes(token.access_token));
  const cloneGrant = (id, userId) => ({ ...structuredClone(f.state.mcp_oauth_grants['grant-a']), id, userId,
    recordJson: JSON.stringify({ ...f.grant, id, userId }) });
  f.state.mcp_oauth_grants['grant-b'] = cloneGrant('grant-b', 'user-a'); f.state.mcp_oauth_grants['grant-c'] = cloneGrant('grant-c', 'other-user');
  const auditBeforeList = f.audits.length, first = await f.managementStore.list({ limit: 1 }, signal());
  assert.deepEqual(first.items.map(item => item.grantId), ['grant-a']); assert.ok(first.nextCursor); assert.ok(!JSON.stringify(first).includes(f.grant.subject));
  const second = await f.managementStore.list({ limit: 1, cursor: first.nextCursor }, signal()); assert.deepEqual(second.items.map(item => item.grantId), ['grant-b']); assert.equal(second.nextCursor, undefined);
  await assert.rejects(() => f.managementStore.list({ limit: 1, userId: 'other-user' }, signal())); assert.equal(f.audits.length, auditBeforeList, 'listing does not record use or revoke');
  assert.deepEqual(f.state.mcp_oauth_grant_last_use, {}, 'summary/list and OAuth verification do not record business use');
  let handler; f.authorityHeld = false;
  const access = api.createPersistentOAuthAccessReader({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.authority.access);
  const authorization = { subject: f.grant.subject, token: token.access_token, clientId: 'client-a', resource, scopes };
  const bindings = api.captureReadTools({
    tools: [{ name: 'rental_catalog_read', description: 'fixture-only authorized read', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
      read: async () => { f.reads = (f.reads ?? 0) + 1; if (f.failRead) throw new Error('private read failure'); return { value: 'fixture-read' }; } }],
    publication: { allows: async () => true },
    authority: { withRead: async (auth, name, input, consume, s) => {
      f.authorityHeld = true;
      try { return await f.store.transaction(async tx => {
        const bound = await access.readIn(tx, auth.token, s);
        return f.original.auth.withTrustedWorkspacePrincipal(f.store.native(tx), () => f.authority.principal(bound.grantId, tx, s), s,
          resolve => f.original.guard.withTrustedCatalogRead(2, resolve, () => consume(), s));
      }, s); } finally { f.authorityHeld = false; }
    } },
    accounting: { withCall: async (auth, name, input, consume) => consume() }, // explicit external accounting, NOT production admission
    release: { project: async (auth, name, value) => f.badOutput ? { value: 123 } : value },
    usage: f.useStore.reads,
  });
  await api.registerReadTools({ registerTool(name, metadata, callback) { handler = callback; } }, bindings, authorization, signal(), () => f.verifier.verifyAccessToken(token.access_token));
  assert.deepEqual(f.state.mcp_oauth_grant_last_use, {}, 'discovery does not record use');
  const invokeHandler=()=>handler({}, { mcpReq:{ signal:signal() } }); // explicit SDK request-context fixture
  f.failRead = true; assert.equal((await invokeHandler()).isError, true); f.failRead = false;
  f.badOutput = true; assert.equal((await invokeHandler()).isError, true); f.badOutput = false;
  assert.deepEqual(f.state.mcp_oauth_grant_last_use, {}, 'failed reads/output validation do not claim completion');
  const completed = await invokeHandler(); assert.equal(completed.structuredContent.value, 'fixture-read');
  const use = (await f.managementStore.read('grant-a', signal())).lastUse;
  assert.equal(use.state, 'observed'); assert.equal(use.kind, 'server_read_completed'); assert.ok(Number.isSafeInteger(use.observedAtMs));
  assert.deepEqual((await f.managementStore.list({ limit: 1 }, signal())).items[0].lastUse, use);
  assert.ok(!JSON.stringify(f.state.mcp_oauth_grant_last_use).includes(token.access_token)); assert.ok(!JSON.stringify(f.state.mcp_oauth_grant_last_use).includes(f.grant.subject));
  await assert.rejects(() => f.useStore.reads.completed({ ...authorization, subject: 'wrong-subject' }, signal()));
  const command = { operationKey: 'grant-revoke-a', grantId: 'grant-a', expectedRevision: 1 };
  f.casFail = true; await assert.rejects(() => f.managementStore.revoke(command, signal()), e => e.kind === 'conflict'); f.casFail = false;
  const before = f.audits.length, revoked = await f.managementStore.revoke(command, signal()); assert.equal(revoked.revision, 2); assert.equal(f.audits.at(-1).action, 'mcp.oauth.grant.revoked');
  await assert.rejects(() => f.verifier.verifyAccessToken(token.access_token)); await assert.rejects(() => f.tokens.refresh({ clientId: 'client-a', clientRevision: 1, resource, refreshToken: token.refresh_token }, signal()));
  const historical = await f.managementStore.read('grant-a', signal()); assert.equal(historical.revocationState, 'revoked'); assert.deepEqual(historical.lastUse, use, 'revocation does not erase server-observed use');
  await assert.rejects(() => f.useStore.reads.completed(authorization, signal()));
  assert.deepEqual(await f.managementStore.revoke(command, signal()), revoked);
  assert.equal(f.audits.length, before + 1); assert.equal((await f.managementStore.operation('grant-a', command.operationKey, signal())).state, 'observed');
  const failed = setup(); failed.failAudit = true; await assert.rejects(() => failed.managementStore.revoke(command, signal())); assert.equal(JSON.parse(failed.state.mcp_oauth_grants['grant-a'].recordJson).enabled, true);
  const unknown = setup(); unknown.loseCommit = true; await assert.rejects(() => unknown.managementStore.revoke(command, signal()), e => e.kind === 'unknown'); unknown.loseCommit = false;
  assert.equal((await unknown.managementStore.operation('grant-a', command.operationKey, signal())).state, 'observed'); assert.equal(unknown.audits.length, 1);
  const manager = setup(); manager.set('grant', { userId: 'other-user' }); manager.state.mcp_oauth_grants['grant-a'].userId = 'other-user';
  await assert.rejects(() => manager.managementStore.revoke(command, signal())); const role = manager.original.user.roleAssignments[0].role; role.permissions = [{ permission: { code: 'system:integration:manage' } }]; role.dataScope = 'ALL';
  assert.equal((await manager.managementStore.revoke(command, signal())).state, 'revoked');

  // Actual API factory -> fixed Web transport -> original per-request manager/store.
  const web = setup(), config = { enabled: true, resourceUrl: resource, requestTimeoutMs: 5000, maxResponseBytes: 65536,
    listEndpoint: 'https://admin.example.invalid/mcp/grants/list', summaryEndpoint: 'https://admin.example.invalid/mcp/grants/summary',
    revocationEndpoint: 'https://admin.example.invalid/mcp/grants/revoke', receiptEndpoint: 'https://admin.example.invalid/mcp/grants/receipt',
    readCallReceiptEndpoint: 'https://admin.example.invalid/mcp/grants/read-call-receipt', readCallListEndpoint: 'https://admin.example.invalid/mcp/grants/read-calls' };
  const control = createOriginalMcpGrantControlPlane(api, config, web.original.auth, web.original.platform, web.logs, { database: web.database, usage: web.useStore, receiptTraffic:web.receiptTraffic });
  const request = (url, method = 'GET', data) => { const headers = new Headers(web.browser.headers);
    if (method === 'POST') { headers.set('origin', 'https://admin.example.invalid'); headers.set('content-type', 'application/x-www-form-urlencoded'); }
    return new Request(url, { method, headers, ...(data === undefined ? {} : { body: new URLSearchParams(data).toString() }) }); };
  const webToken = await web.issue(), webAudit = web.audits.length;
  // Create actual durable metering rows before revoke; target/SQL remain explicit
  // substitutes. No new goal/read is admitted by the historical receipt route.
  const callRef = { callId: 'original-read-call-a', toolName: 'rental_catalog_read', inputHash: 'a'.repeat(64),
    authorization: { subject: web.grant.subject, clientId: web.grant.clientId, resource, scopes, token: webToken.access_token } };
  const target = { goalId: 'trusted-goal-fixture', goalRevision: 1, grantId: web.grant.id, subject: web.grant.subject, clientId: web.grant.clientId,
    resource, scopes, purpose: 'catalog', originalInputHash: 'b'.repeat(64), policyVersion: 'policy-1' };
  const readBudget = api.createPrismaMcpReadBudget(web.database, { resolve: async (call, native) => { assert.equal(native, web.native); return structuredClone(target); } });
  const callTicket = await readBudget.reserve(callRef, signal()); await readBudget.settle(callRef, callTicket, { outcome: 'returned', activeMs: 4 }, signal());
  const heldRef = { ...callRef, callId: 'original-read-call-held' };
  await readBudget.reserve(heldRef, signal()); await readBudget.markUnknown(heldRef, signal());
  const readReceipt = (callId = callRef.callId) => request(config.readCallReceiptEndpoint + '?' + new URLSearchParams({ grantId: 'grant-a', callId }));
  const readIndex = (extra = {}) => request(config.readCallListEndpoint + '?' + new URLSearchParams({ grantId: 'grant-a', limit: '1', ...extra }));
  const businessState=()=>JSON.stringify({ ...web.state,client_api_rate_buckets:undefined });
  const indexBefore = businessState(), indexAudit = web.audits.length;
  const indexed = await control.fetch(readIndex()); assert.equal(indexed.status, 200); assert.equal(indexed.headers.get('cache-control'), 'no-store');
  const firstCalls = await indexed.json(); assert.deepEqual(firstCalls.items, [{ callId: callRef.callId, goalId: target.goalId }]); assert.ok(firstCalls.nextCursor);
  const secondCalls = await (await control.fetch(readIndex({ cursor: firstCalls.nextCursor }))).json();
  assert.deepEqual(secondCalls.items, [{ callId: heldRef.callId, goalId: target.goalId }]); assert.equal(secondCalls.nextCursor, undefined);
  assert.equal(businessState(), indexBefore); assert.equal(web.audits.length, indexAudit, 'owner paging cannot consume/release goal resources, log use, or change business state');
  assert.equal(Object.values(web.state.client_api_rate_buckets)[0].count,2,'each page consumes its independent receipt class once, not per validation transaction');
  assert.ok(web.queries.filter(q => q.sql.includes('FROM mcp_read_calls WHERE grantId')).every(q => /ORDER BY callId ASC LIMIT \? FOR UPDATE$/.test(q.sql) && q.values.at(-1) === 2));
  assert.ok(!JSON.stringify(firstCalls).includes(webToken.access_token)); assert.ok(!JSON.stringify(firstCalls).includes(web.grant.subject));
  assert.equal((await control.fetch(readIndex({ limit: '21' }))).status, 400);
  assert.equal((await control.fetch(readIndex({ actorId: 'other-user' }))).status, 400);
  assert.equal((await control.fetch(request(config.readCallListEndpoint, 'POST'))).status, 405);
  assert.equal((await control.fetch(readIndex({ cursor: 'not-a-valid-json-cursor' }))).status, 400);
  const indexCursor = JSON.parse(Buffer.from(firstCalls.nextCursor, 'base64url').toString('utf8'));
  const changedScopeCursor = Buffer.from(JSON.stringify({ ...indexCursor, workspaceId: 'other-space' })).toString('base64url');
  assert.equal((await control.fetch(readIndex({ cursor: changedScopeCursor }))).status, 400, 'cursor cannot switch original owner scope');
  web.state.mcp_oauth_grants['grant-b'] = { ...structuredClone(web.state.mcp_oauth_grants['grant-a']), id: 'grant-b', recordJson: JSON.stringify({ ...web.grant, id: 'grant-b' }) };
  assert.equal((await control.fetch(readIndex({ grantId: 'grant-b', cursor: firstCalls.nextCursor }))).status, 400, 'same owner/new grant is not cursor permission');
  assert.deepEqual(await (await control.fetch(readIndex({ grantId: 'grant-b' }))).json(), { items: [] });
  const listOnlyConfig = { ...config }; delete listOnlyConfig.readCallReceiptEndpoint;
  const listOnly = createOriginalMcpGrantControlPlane(api, listOnlyConfig, web.original.auth, web.original.platform, web.logs, { database: web.database, receiptTraffic:web.receiptTraffic });
  assert.deepEqual(await (await listOnly.fetch(readIndex())).json(), firstCalls, 'omitting receipt route never reinterprets owner-list parameters'); await listOnly.close();
  web.indexHook = rows => [{ ...rows[0], grantId: 'other-grant' }]; assert.equal((await control.fetch(readIndex())).status, 503); web.indexHook = undefined;
  const originalScalar = web.state.mcp_read_goal_budgets[target.goalId].grantId; web.state.mcp_read_goal_budgets[target.goalId].grantId = 'other-grant';
  assert.equal((await control.fetch(readIndex())).status, 503); web.state.mcp_read_goal_budgets[target.goalId].grantId = originalScalar;
  let lookaheadReads = 0; web.queryHook = (table, rows) => { if (table === 'mcp_read_calls' && ++lookaheadReads === 2) web.original.member.isActive = false; return rows; };
  assert.notEqual((await control.fetch(readIndex())).status, 200, 'rights lost while validating lookahead suppress whole page'); web.queryHook = undefined; web.original.member.isActive = true;
  const evidenceBefore = businessState(), auditsBefore = web.audits.length;
  const accounting = await control.fetch(readReceipt(firstCalls.items[0].callId)); assert.equal(accounting.status, 200); assert.equal(accounting.headers.get('cache-control'), 'no-store');
  const observedCall = await accounting.json(); assert.equal(observedCall.callId, callRef.callId); assert.equal(observedCall.accountingState, 'returned');
  assert.deepEqual(observedCall.activity, { state: 'settled', activeMs: 4 }); assert.equal(observedCall.callsConsumed, true); assert.equal(observedCall.retryable, false);
  const held = await (await control.fetch(readReceipt(heldRef.callId))).json(); assert.equal(held.accountingState, 'unknown'); assert.deepEqual(held.activity, { state: 'held', reservedMs: 15000 });
  assert.deepEqual(await (await control.fetch(readReceipt('missing-original-call'))).json(), { state: 'not_observed', retryable: false });
  assert.equal(businessState(), evidenceBefore); assert.equal(web.audits.length, auditsBefore, 'read-only accounting evidence cannot modify goal quota/use/audit');
  for (const privateValue of [webToken.access_token, web.grant.subject, target.originalInputHash, callRef.inputHash]) assert.ok(!JSON.stringify([observedCall, held]).includes(privateValue));
  assert.equal((await control.fetch(request(config.readCallReceiptEndpoint, 'POST'))).status, 405);
  const extraReceipt = readReceipt(); assert.equal((await control.fetch(new Request(extraReceipt.url + '&actorId=other-user', { headers: extraReceipt.headers }))).status, 400);
  const wrongReceiptOrigin = readReceipt(); wrongReceiptOrigin.headers.set('origin', 'https://other.example.invalid'); assert.equal((await control.fetch(wrongReceiptOrigin)).status, 403);
  const mcpReceipt = readReceipt(); mcpReceipt.headers.set('authorization', 'Bearer ' + webToken.access_token); assert.notEqual((await control.fetch(mcpReceipt)).status, 200);
  assert.equal((await control.fetch(new Request(readIndex().url))).status, 403);
  const wrongIndexOrigin = readIndex(); wrongIndexOrigin.headers.set('origin', 'https://other.example.invalid'); assert.equal((await control.fetch(wrongIndexOrigin)).status, 403);
  const mcpIndex = readIndex(); mcpIndex.headers.set('authorization', 'Bearer ' + webToken.access_token); assert.notEqual((await control.fetch(mcpIndex)).status, 200);
  const originalRecord = web.state.mcp_read_calls[callRef.callId].recordJson;
  web.state.mcp_read_calls[callRef.callId].recordJson = JSON.stringify({ ...JSON.parse(originalRecord), grantId: 'other-grant' });
  assert.equal((await control.fetch(readReceipt())).status, 503); web.state.mcp_read_calls[callRef.callId].recordJson = originalRecord;
  let callReads = 0; web.queryHook = (table, rows) => { if (table === 'mcp_read_calls' && ++callReads === 2) web.original.member.isActive = false; return rows; };
  assert.notEqual((await control.fetch(readReceipt())).status, 200, 'lost CURRENT Web membership suppresses late accounting evidence');
  web.queryHook = undefined; web.original.member.isActive = true;
  const managerControl = createOriginalMcpGrantControlPlane(api, config, manager.original.auth, manager.original.platform, manager.logs, { database: manager.database, receiptTraffic:manager.receiptTraffic });
  assert.equal((await managerControl.fetch(new Request(config.readCallReceiptEndpoint + '?grantId=grant-a&callId=missing-original-call', { headers: manager.browser.headers }))).status, 403,
    'tenant grant-management permission is not an owner-only call-receipt index');
  assert.equal((await managerControl.fetch(new Request(config.readCallListEndpoint + '?grantId=grant-a', { headers: manager.browser.headers }))).status, 403); await managerControl.close();
  const pageResponse = await control.fetch(request(config.listEndpoint + '?limit=1')); assert.equal(pageResponse.status, 200);
  assert.equal(pageResponse.headers.get('cache-control'), 'no-store'); assert.deepEqual((await pageResponse.json()).items.map(item => item.grantId), ['grant-a']);
  const summaryResponse = await control.fetch(request(config.summaryEndpoint + '?grantId=grant-a')); assert.equal(summaryResponse.status, 200);
  const webSummary = await summaryResponse.json(); assert.equal(webSummary.lastUse.state, 'unavailable'); assert.ok(!JSON.stringify(webSummary).includes(web.grant.subject));
  assert.equal((await control.fetch(new Request(config.listEndpoint))).status, 403);
  assert.notEqual((await control.fetch(new Request(config.summaryEndpoint + '?grantId=grant-a', { headers: { authorization: 'Bearer ' + webToken.access_token } }))).status, 200, 'MCP access cannot authorize Web governance');
  assert.equal((await control.fetch(request(config.listEndpoint + '?userId=other-user'))).status, 400);
  assert.equal((await control.fetch(request(config.revocationEndpoint))).status, 405);
  const wrongOrigin = request(config.revocationEndpoint, 'POST', command); wrongOrigin.headers.set('origin', 'https://other.example.invalid');
  assert.equal((await control.fetch(wrongOrigin)).status, 403);
  assert.equal((await control.fetch(request(config.revocationEndpoint, 'POST', { ...command, actorId: 'forged' }))).status, 400);
  const duplicate = request(config.revocationEndpoint, 'POST', command); const duplicateBody = await duplicate.text();
  assert.equal((await control.fetch(new Request(config.revocationEndpoint, { method: 'POST', headers: duplicate.headers, body: duplicateBody + '&grantId=other-grant' }))).status, 400);
  web.casFail = true; assert.equal((await control.fetch(request(config.revocationEndpoint, 'POST', command))).status, 409); web.casFail = false;
  web.loseCommit = true; const ambiguous = await control.fetch(request(config.revocationEndpoint, 'POST', command)); web.loseCommit = false;
  assert.equal(ambiguous.status, 503); assert.deepEqual(await ambiguous.json(), { error: 'grant_unknown', retryable: false });
  const receiptUrl = config.receiptEndpoint + '?' + new URLSearchParams({ grantId: 'grant-a', operationKey: command.operationKey });
  const receiptResponse = await control.fetch(request(receiptUrl)); assert.equal(receiptResponse.status, 200); assert.equal((await receiptResponse.json()).result.revision, 2);
  assert.deepEqual(await (await control.fetch(readIndex())).json(), firstCalls, 'independent CURRENT owner may list accounting after grant revoke');
  assert.deepEqual(await (await control.fetch(readReceipt())).json(), observedCall, 'independent CURRENT owner may observe accounting after grant revoke');
  assert.equal((await (await control.fetch(readReceipt(heldRef.callId))).json()).accountingState, 'unknown');
  assert.equal(web.state.mcp_read_goal_budgets[target.goalId].concurrentReads, 1, 'historical lookup cannot release unknown occupancy');
  assert.equal((await control.fetch(request(config.revocationEndpoint, 'POST', command))).status, 200); assert.equal(web.audits.length, webAudit + 1);
  assert.deepEqual(web.state.mcp_oauth_grant_last_use, {}, 'Web control traffic is not business use');
  const countBefore=Object.values(web.state.client_api_rate_buckets)[0].count,beforeLimits=businessState();
  web.receiptRateLimit=countBefore;assert.equal((await control.fetch(readReceipt())).status,503);assert.equal((await control.fetch(readIndex())).status,503);
  assert.equal(Object.values(web.state.client_api_rate_buckets)[0].count,countBefore);assert.equal(businessState(),beforeLimits);web.receiptRateLimit=100;
  web.missingReceiptRatePolicy=true;assert.equal((await control.fetch(readReceipt())).status,503);web.missingReceiptRatePolicy=false;
  web.missingReceiptRateSchema=true;assert.equal((await control.fetch(readIndex())).status,503);web.missingReceiptRateSchema=false;
  web.missingReceiptRateRow=true;assert.equal((await control.fetch(readReceipt())).status,503);web.missingReceiptRateRow=false;
  assert.equal(businessState(),beforeLimits);assert.equal(web.state.mcp_read_goal_budgets[target.goalId].concurrentReads,1);
  const noRate=createOriginalMcpGrantControlPlane(api,config,web.original.auth,web.original.platform,web.logs,{ database:web.database });
  assert.equal((await noRate.fetch(readReceipt())).status,503);assert.equal((await noRate.fetch(readIndex())).status,503);
  assert.equal((await noRate.fetch(request(config.summaryEndpoint+'?grantId=grant-a'))).status,200,'missing receipt limits do not disable independent governance summary');await noRate.close();
  assert.ok(web.rateFacts.some(v=>v.kind==='exact_call') && web.rateFacts.some(v=>v.kind==='call_index'));
  assert.ok(web.rateFacts.some(v=>v.grantRevision===2),'revoked grant history remains a current Web-owned query, no new grant/MFA required');
  const beforeUnknownCount=Object.values(web.state.client_api_rate_buckets)[0].count;
  web.loseCommit=true;assert.equal((await control.fetch(readReceipt())).status,503);web.loseCommit=false;
  assert.equal(Object.values(web.state.client_api_rate_buckets)[0].count,beforeUnknownCount+1,'lost locator/receipt-rate commit acknowledgement cannot refund an already consumed original bucket');assert.equal(businessState(),beforeLimits);
  const unready = api.createMcpGrantControlPlane(config); assert.equal((await unready.fetch(request(config.listEndpoint))).status, 503);
  assert.throws(() => api.createMcpGrantControlPlane({ ...config, receiptEndpoint: config.listEndpoint }), /distinct/);
  const close = control.close(); assert.equal(control.close(), close); await close;
  assert.equal((await control.fetch(request(receiptUrl))).status, 503); assert.equal((await control.fetch(readReceipt())).status, 503); await unready.close();
});
