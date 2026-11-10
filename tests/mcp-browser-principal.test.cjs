"use strict";
/** Actual original Web signature/session/Platform readers and browser bridge.
 * Original session/role SQL and framework are explicit offline fixtures; no real
 * Web login, MFA/CSRF/consent page, DB locks/DI or OAuth grant publication. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const { fixture: originalFixture, source, output, root } = require('./fixtures/mcp/original-identity.cjs');
const { PlatformService } = source('apps/api/src/modules/platform/platform.service.ts');
const { createOriginalMcpBrowserIdentity } = source('apps/api/src/modules/auth/original-mcp-browser-identity.ts');
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
const signal = () => new AbortController().signal;
function fixture() {
  const f = originalFixture(), now = Math.floor(Date.now() / 1000);
  f.session = { id: 'original-browser-session', userId: f.user.id, currentWorkspaceId: f.workspace.id, audience: 'operator', expiresAt: new Date((now + 1800) * 1000), revokedAt: null };
  f.payload = { sub: f.user.id, tid: f.user.tenantId, sid: f.session.id, wid: f.workspace.id, aud: 'operator', iat: now, exp: now + 900 };
  f.sql = []; f.sessionReads = 0; f.sessionHook = undefined;
  f.tx.$queryRaw = async (parts, ...values) => { const sql = parts.join('?').replace(/\s+/g, ' ').trim();
    assert.equal(sql, 'SELECT id FROM auth_sessions WHERE id = ? FOR UPDATE'); assert.deepEqual(values, [f.payload.sid]); f.sql.push({ sql, values }); return [{ id: f.session.id }]; };
  f.tx.authSession = { findFirst: async query => { f.sessionReads++; assert.equal(query.where.id, f.payload.sid); assert.equal(query.where.revokedAt, null);
    assert.ok(query.where.expiresAt.gt instanceof Date); let row = f.session.revokedAt === null && f.session.expiresAt > new Date() ? structuredClone(f.session) : null;
    return f.sessionHook ? await f.sessionHook(row, f.sessionReads) : row; } };
  f.platform.getAuthSession = (...args) => PlatformService.prototype.getAuthSession.call(f.platform, ...args);
  f.bridge = createOriginalMcpBrowserIdentity(f.auth);
  f.token = changes => f.auth.signAccessToken({ ...f.payload, ...changes });
  f.browser = (token = f.token(), init = {}) => new Request('https://as.example.invalid/consent', { headers: { authorization: 'Bearer ' + token }, ...init });
  f.read = (browser = f.browser(), sig = signal()) => f.bridge.current(browser, f.tx, sig);
  return f;
}

test('original signed Web session resolves fixed operator principal with same-transaction session lock and original roles', async () => {
  const f = fixture(), browser = f.browser(), current = await f.read(browser);
  assert.deepEqual(current, { userId: f.user.id, tenantId: f.user.tenantId, workspaceId: f.workspace.id, audience: 'operator', sessionId: f.session.id, expiresAt: f.payload.exp });
  assert.ok(Object.isFrozen(current)); assert.equal(f.sessionReads, 2); assert.equal(f.sql.length, 2);
  assert.ok(f.calls.some(([kind]) => kind === 'tx-user')); assert.ok(f.calls.some(([kind]) => kind === 'tx-member')); assert.ok(f.calls.some(([kind]) => kind === 'tx-workspace'));
  const originalContext = await f.platform.resolveTrustedWorkspacePrincipal(f.binding, f.tx);
  assert.ok(originalContext.user.permissions.includes('rental-core:catalog:view')); assert.ok(!originalContext.user.permissions.includes('unrelated:permission'), 'uses original space roles, not tenant role copy');
  assert.ok(!JSON.stringify(current).includes(browser.headers.get('authorization'))); assert.deepEqual(Object.keys(current).sort(), ['audience', 'expiresAt', 'sessionId', 'tenantId', 'userId', 'workspaceId'].sort());
  const typeRoots = [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')];
  const program = ts.createProgram([path.join(root, 'apps/api/src/modules/auth/trusted-browser-principal.ts')], {
    strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16,
    types: ['node'], typeRoots, rootDir: path.join(root, 'apps/api/src/modules/auth'), outDir: path.join(output, 'browser-principal-types'),
    paths: { '@rental-os/shared': [path.join(output, 'node_modules/@rental-os/shared/dist/index.d.ts')] },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(program.emit().emitSkipped, false);
});

test('MCP bearer, caller identity, malformed Web token, audience/workspace mismatch and missing explicit secret cannot authenticate', async () => {
  const f = fixture();
  assert.equal(await f.read(f.browser('opaque-mcp-resource-token')), undefined);
  assert.equal(await f.read(new Request('https://as.example.invalid/consent?userId=user-a&workspaceId=workspace-a&confirmed=true')), undefined);
  assert.equal(await f.read(f.browser(f.token() + '.extra')), undefined);
  assert.equal(await f.read(f.browser(f.token({ aud: 'staff' }))), undefined);
  assert.equal(await f.read(f.browser(f.token({ exp: 1 }))), undefined);
  assert.equal(await f.read(f.browser(f.token({ iat: f.payload.exp + 1 }))), undefined);
  assert.equal(await f.read(f.browser(f.token({ wid: 'another-space' }))), undefined);
  assert.equal(f.sessionReads, 1, 'only a structurally valid signed operator token with mismatching wid reaches original session');
  const unsigned = f.token(); assert.equal(await f.read(f.browser(unsigned.slice(0, -2) + 'xx')), undefined);
  const original = fixture(), browser = original.browser(); original.auth.configService = { get: () => undefined };
  assert.equal(await original.read(browser), undefined); assert.equal(original.sessionReads, 0, 'no development-secret fallback for trusted consent identity');
});

test('revoked/expired session, inactive member, password obligation, platform actor and memory fallback fail closed', async () => {
  for (const kind of ['revoked', 'expired-session', 'inactive-member', 'password', 'saas', 'memory', 'wrong-audience', 'missing-space', 'missing-native']) {
    const f = fixture();
    if (kind === 'revoked') f.session.revokedAt = new Date();
    if (kind === 'expired-session') f.session.expiresAt = new Date(1);
    if (kind === 'inactive-member') f.member.isActive = false;
    if (kind === 'password') f.user.mustChangePassword = true;
    if (kind === 'saas') f.user.isSaasAdmin = true;
    if (kind === 'memory') f.mysql = false;
    if (kind === 'wrong-audience') f.session.audience = 'staff';
    if (kind === 'missing-space') f.session.currentWorkspaceId = null;
    if (kind === 'missing-native') delete f.tx.authSession;
    if (['memory', 'missing-native'].includes(kind)) await assert.rejects(() => f.read(), /unavailable/i, kind);
    else assert.equal(await f.read(), undefined, kind);
  }
  const limited = fixture(); limited.session.expiresAt = new Date((limited.payload.exp - 10) * 1000);
  assert.equal((await limited.read()).expiresAt, limited.payload.exp - 10, 'original token/session minimum, not new OAuth lifetime');
});

test('late session switch/revocation, getter evidence and cancellation never release a late browser identity', async () => {
  for (const kind of ['switch', 'revoke', 'cancel']) {
    const f = fixture(), controller = new AbortController();
    f.sessionHook = (row, reads) => { if (reads >= 2) { if (kind === 'switch') row.currentWorkspaceId = 'new-space'; if (kind === 'revoke') row.revokedAt = new Date(); if (kind === 'cancel') controller.abort(); } return row; };
    await assert.rejects(() => f.read(f.browser(), controller.signal), /unavailable/i, kind);
  }
  const f = fixture(); let getters = 0;
  f.sessionHook = row => { Object.defineProperty(row, 'userId', { enumerable: true, get() { getters++; return 'user-a'; } }); return row; };
  await assert.rejects(() => f.read()); assert.equal(getters, 0);
  const controller = new AbortController(), early = fixture(); controller.abort(); await assert.rejects(() => early.read(early.browser(), controller.signal)); assert.equal(early.sessionReads, 0);
  const requestAbort = new AbortController(), requestCancelled = fixture(), browser = requestCancelled.browser(undefined, { signal: requestAbort.signal }); requestAbort.abort();
  await assert.rejects(() => requestCancelled.read(browser)); assert.equal(requestCancelled.sessionReads, 0);
  assert.throws(() => createOriginalMcpBrowserIdentity({}), /unavailable/i);
  fs.writeFileSync(path.join(output, 'browser-scope.json'), JSON.stringify({ actual: 'Auth Web signature verifier + Platform original session query/role map + browser bridge',
    strict: 'shared and internal browser/workspace binding declarations only', external: 'session/role SQL and Nest facade',
    excluded: 'complete API/Prisma types, live DB, Web login/consent/MFA/CSRF, management UI or production publication' }, null, 2));
});
