"use strict";
/** Actual original signed Web/current SaaS -> platform admission CAS/original audit.
 * SQL/session/account rows and native OperationLog/DB commit are offline substitutes;
 * no public Guard/UI/CSRF, API boot or live DB/full API type proof. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const { fixture: originalFixture, source, root, output, identity: als } = require('./fixtures/mcp/original-identity.cjs');
const { PlatformService } = source('apps/api/src/modules/platform/platform.service.ts');
const { createOriginalMcpPlatformManagement, createOriginalMcpPlatformAdmissionManagement } = source('apps/api/src/modules/auth/original-mcp-platform-management.ts');
const { createOriginalMcpAdmissionControlPlane } = source('apps/api/src/modules/auth/original-mcp-admission-control-plane.ts');
const { OperationLogService } = source('apps/api/src/common/operation-log.service.ts');
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
const signal = () => new AbortController().signal;
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const target = fs.mkdtempSync(path.join(root, 'output/mcp-platform-management-verification-')), pkg = path.join(root, 'packages/mcp-server'), staged = path.join(target, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(pkg, 'package.json'), path.join(staged, 'package.json'));
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')], rootDir: path.join(pkg, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram([path.join(pkg, 'src/admission-control-plane.ts')], options));
  const consumer = path.join(target, 'consumer.mts'); fs.writeFileSync(consumer, [
    'export { createPrismaOAuthAdmissionStore, captureOAuthAdmissionTarget } from "@rental-os/mcp-server/prisma-oauth-admission-store";',
    'export { createMcpAdmissionControlPlane } from "@rental-os/mcp-server/admission-control-plane";',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: target, outDir: path.join(target, 'consumer-build') }));
  check(ts.createProgram([path.join(root, 'apps/api/src/modules/auth/trusted-platform-browser-principal.ts')], { ...options,
    rootDir: path.join(root, 'apps/api/src/modules/auth'), outDir: path.join(output, 'platform-principal-types') }));
  const auditSource = fs.readFileSync(path.join(root, 'apps/api/src/common/operation-log.service.ts'), 'utf8');
  const auditAst = ts.createSourceFile('operation-log.service.ts', auditSource, ts.ScriptTarget.ES2022, true);
  const auditType = auditAst.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'OriginalOAuthAuditRecord'); assert.ok(auditType);
  // Compile the actual internal event type only, not substituted Prisma/Nest API types.
  const auditConsumer = path.join(target, 'audit-scope.ts');
  fs.writeFileSync(auditConsumer, auditType.getText(auditAst) + '\n' + `
const base = { tenantId: 'tenant-a', userId: 'user-a', targetType: 'mcp-oauth-admission' as const, targetId: 'op-a', operationKey: 'op-a', revision: 1, grantId: null };
const platform: OriginalOAuthAuditRecord = { ...base, workspaceId: null, action: 'mcp.oauth.admission.platform.saved' };
const workspace: OriginalOAuthAuditRecord = { ...base, workspaceId: 'workspace-a', action: 'mcp.oauth.admission.workspace.saved' };
// @ts-expect-error platform events never have a workspace
const invalidPlatform: OriginalOAuthAuditRecord = { ...base, workspaceId: 'workspace-a', action: 'mcp.oauth.admission.platform.saved' };
// @ts-expect-error existing workspace events cannot become null-scoped
const invalidWorkspace: OriginalOAuthAuditRecord = { ...base, workspaceId: null, action: 'mcp.oauth.admission.workspace.saved' };
void [platform, workspace, invalidPlatform, invalidWorkspace];
`);
  check(ts.createProgram([auditConsumer], { ...options, rootDir: target, outDir: path.join(target, 'audit-types') }));
  artifact = await import(pathToFileURL(path.join(target, 'consumer-build/consumer.mjs')).href); return artifact;
}
const resource = 'https://mcp.example.invalid/mcp', target = { kind: 'platform' }, options = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
function fixture(api) {
  const f = originalFixture(), now = Math.floor(Date.now() / 1000); f.user.isSaasAdmin = true; f.tenantStatus = 'ACTIVE'; f.accountReads = 0; f.sessionReads = 0; f.queries = [];
  f.session = { id: 'platform-original-session', userId: f.user.id, currentWorkspaceId: null, audience: 'operator', expiresAt: new Date((now + 1800) * 1000), revokedAt: null };
  f.payload = { sub: f.user.id, tid: f.user.tenantId, sid: f.session.id, aud: 'operator', iat: now, exp: now + 900 };
  Object.setPrototypeOf(f.platform, PlatformService.prototype);
  f.platform.getAuthSession = (...args) => PlatformService.prototype.getAuthSession.call(f.platform, ...args);
  f.repository.prisma = { user: { findFirst() { throw new Error('Global account fallback forbidden'); } }, authSession: { findFirst() { throw new Error('Global session fallback forbidden'); } } };
  f.tx.user = { async findFirst(query) { f.accountReads++; assert.equal(query.where.isActive, true); assert.equal(query.where.tenant.status, 'ACTIVE');
    const row = query.where.id === f.user.id && f.user.isActive && f.tenantStatus === 'ACTIVE' ? structuredClone(f.user) : null;
    return f.accountHook ? await f.accountHook(row, f.accountReads) : row; } };
  f.tx.authSession = { async findFirst(query) { f.sessionReads++; assert.equal(query.where.id, f.session.id); assert.equal(query.where.revokedAt, null); assert.ok(query.where.expiresAt.gt instanceof Date);
    const row = f.session.revokedAt === null && f.session.expiresAt > new Date() ? structuredClone(f.session) : null;
    return f.sessionHook ? await f.sessionHook(row, f.sessionReads) : row; } };
  f.lockSession = async (parts, ...values) => { const sql = parts.join('?').replace(/\s+/g, ' ').trim(); assert.equal(sql, 'SELECT id FROM auth_sessions WHERE id = ? FOR UPDATE'); assert.deepEqual(values, [f.session.id]); f.queries.push({ sql, values }); return [{ id: f.session.id }]; };
  f.tx.$queryRaw = f.lockSession;
  f.browser = (changes = {}, init = {}) => new Request('https://admin.example.invalid/mcp/platform?isSaasAdmin=true', { headers: { authorization: 'Bearer ' + f.auth.signAccessToken({ ...f.payload, ...changes }) }, ...init });
  f.authorizer = createOriginalMcpPlatformManagement(f.auth, f.browser());
  f.principal = (browser = f.browser(), sig = signal()) => f.auth.resolveTrustedPlatformBrowserPrincipal(browser.headers.get('authorization'), f.tx, sig);
  f.state = { platforms: {}, operations: {} }; f.audits = []; f.tail = Promise.resolve();
  f.database = { async $transaction(callback, selectedOptions) {
    assert.deepEqual(selectedOptions, options); const before = f.tail; let release; f.tail = new Promise(resolve => { release = resolve; }); await before;
    const working = structuredClone(f.state), audits = [];
    const tx = { ...f.tx, operationLog: { async create({ data, select }) {
      assert.deepEqual(select, { id: true }); if (f.failAudit) throw new Error('private original audit failure');
      audits.push(structuredClone(data)); f.pendingAudit = { actorId: data.userId, ...data.detail.metadata }; f.afterAudit?.();
      const row = { id: 'original-platform-audit-' + (f.audits.length + audits.length) };
      return f.auditResultHook ? f.auditResultHook(row) : row;
    } }, async $queryRaw(parts, ...values) {
      const sql = parts.join('?').replace(/\s+/g, ' ').trim(); if (sql.includes('FROM auth_sessions')) return f.lockSession(parts, ...values);
      f.queries.push({ sql, values }); assert.match(sql, /FOR UPDATE$/);
      const table = sql.includes('FROM mcp_oauth_admission_operations') ? 'operations' : sql.includes('FROM mcp_oauth_platform_admissions') ? 'platforms' : undefined;
      assert.ok(table, 'known original SQL only'); const row = working[table][values[0]] ? structuredClone(working[table][values[0]]) : undefined;
      return row ? [table === 'operations' && f.operationHook ? f.operationHook(row, sql) : row] : [];
    }, async $executeRaw(parts, ...values) {
      const sql = parts.join('?').replace(/\s+/g, ' ').trim();
      if (sql.includes('INTO mcp_oauth_platform_admissions')) { assert.ok(!working.platforms[values[0]]); working.platforms[values[0]] = { resource: values[0], revision: values[1], recordJson: values[2] }; return 1; }
      if (sql.includes('INTO mcp_oauth_admission_operations')) { assert.ok(!working.operations[values[0]]); working.operations[values[0]] = Object.fromEntries(['actorId', 'targetKind', 'resource', 'tenantId', 'workspaceId', 'payloadHash', 'resultJson'].map((key, i) => [key, values[i + 1]])); return 1; }
      throw new Error('Unexpected platform management fixture write');
    } };
    f.native = tx;
    try { const result = await callback(tx); f.state = working; f.audits.push(...audits); f.cancelCommit?.abort(); if (f.loseCommit) throw new Error('private commit-response-loss'); return result; } finally { release(); }
  } };
  f.logs = new OperationLogService({ operationLog: { create() { throw new Error('Global audit fallback forbidden'); } } });
  f.management = createOriginalMcpPlatformAdmissionManagement({ resourceUrl: resource }, f.auth, f.browser(), f.logs);
  f.store = api.createPrismaOAuthAdmissionStore({ resourceUrl: resource, allowedScopes: ['rental.catalog.read'] }, f.database,
    { readIn: async (tx, clientId) => { assert.equal(tx, f.native); return { clientId }; } }, f.management);
  f.command = { operationKey: 'platform-original-save', expectedRevision: 0, target, policy: { enabled: true, clientType: 'public', expiresAt: now + 500, clientIds: ['client-a'], scopes: ['rental.catalog.read'] } };
  f.read = (request = { action: 'read', target }, sig = signal()) => f.database.$transaction(tx => f.authorizer.authorize(tx, request, sig), options);
  return f;
}

test('original current SaaS Web account authorizes only platform admission and exact original receipt', async () => {
  const api = await compiled(), f = fixture(api), principal = await f.principal();
  assert.deepEqual(principal, { userId: f.user.id, tenantId: f.user.tenantId, audience: 'operator', sessionId: f.session.id, expiresAt: f.payload.exp }); assert.ok(Object.isFrozen(principal));
  assert.equal(f.accountReads, 2); assert.equal(f.sessionReads, 2); assert.ok(!Object.hasOwn(principal, 'workspaceId')); assert.ok(!JSON.stringify(principal).includes(f.browser().headers.get('authorization')));
  assert.deepEqual(await f.read(), { actorId: f.user.id, kind: 'platform' });
  const saved = await als.runWithRequestIdentity({ userId: 'other-user', tenantId: 'other-tenant', workspaceId: 'other-space', audience: 'operator' }, () => f.store.save(f.command, signal())); assert.equal(saved.policy.revision, 1); assert.equal(f.pendingAudit.actorId, f.user.id);
  assert.equal(f.audits.length, 1); assert.equal(f.audits[0].action, 'mcp.oauth.admission.platform.saved');
  assert.equal(f.audits[0].workspaceId, null); assert.equal(f.audits[0].tenantId, f.user.tenantId); assert.equal(f.audits[0].userId, f.user.id);
  assert.deepEqual(f.audits[0].detail.metadata, { operationKey: f.command.operationKey, revision: 1 }); assert.equal(f.audits[0].detail.targetId, f.command.operationKey);
  assert.ok(!JSON.stringify(f.audits).includes('clientIds')); assert.ok(!JSON.stringify(f.audits).includes('Bearer'));
  assert.equal((await f.store.operation(target, f.command.operationKey, signal())).state, 'observed');
  assert.equal((await f.store.save(f.command, signal())).state, 'saved'); assert.equal(f.audits.length, 1, 'same original key and receipt read do not repeat audit');
  assert.equal(await f.read({ action: 'save', target: { kind: 'workspace', tenantId: f.user.tenantId, workspaceId: f.workspace.id } }), undefined);
  assert.deepEqual(await f.platform.assertTrustedSaasManagement({ userId: f.user.id, tenantId: f.user.tenantId }, f.tx), { userId: f.user.id, tenantId: f.user.tenantId });

  const web = fixture(api), config = { enabled: true, resourceUrl: resource, allowedScopes: ['rental.catalog.read'], requestTimeoutMs: 5000, maxResponseBytes: 65536,
    readEndpoint: 'https://admin.example.invalid/mcp/admission/read', saveEndpoint: 'https://admin.example.invalid/mcp/admission/save', receiptEndpoint: 'https://admin.example.invalid/mcp/admission/receipt' };
  const control = createOriginalMcpAdmissionControlPlane(api, config, web.auth, web.platform, web.logs,
    { database: web.database, registrations: { readIn: async (tx, clientId) => { assert.equal(tx, web.native); return { clientId }; } } });
  const request = (url, data) => { const headers = new Headers(web.browser().headers); if (data !== undefined) { headers.set('origin', 'https://admin.example.invalid'); headers.set('content-type', 'application/json'); }
    return new Request(url, { headers, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) }); };
  const response = await control.fetch(request(config.saveEndpoint, web.command)); assert.equal(response.status, 200); assert.equal((await response.json()).policy.revision, 1);
  assert.equal(web.audits[0].workspaceId, null); assert.equal(web.audits[0].action, 'mcp.oauth.admission.platform.saved');
  const readUrl = config.readEndpoint + '?' + new URLSearchParams({ target: JSON.stringify(target) });
  const readResponse = await control.fetch(request(readUrl)); assert.equal(readResponse.status, 200); assert.equal((await readResponse.json()).state, 'configured');
  const receiptUrl = config.receiptEndpoint + '?' + new URLSearchParams({ target: JSON.stringify(target), operationKey: web.command.operationKey });
  assert.equal((await control.fetch(request(receiptUrl))).status, 200); assert.equal(web.audits.length, 1);
  const spaceUrl = config.readEndpoint + '?' + new URLSearchParams({ target: JSON.stringify({ kind: 'workspace', tenantId: web.user.tenantId, workspaceId: web.workspace.id }) });
  assert.notEqual((await control.fetch(request(spaceUrl))).status, 200, 'current SaaS authority is never a workspace fallback');
  assert.equal((await control.fetch(request(config.saveEndpoint))).status, 405);
  assert.equal((await control.fetch(new Request(readUrl, { headers: { authorization: 'Bearer opaque-mcp-token' } }))).status === 200, false);
  assert.throws(() => api.createMcpAdmissionControlPlane({ ...config, receiptEndpoint: config.readEndpoint }), /distinct/);
  await control.close(); assert.equal((await control.fetch(request(receiptUrl))).status, 503);
});

test('tenant administrators, wildcard roles, caller claims and invalid original account/session evidence fail closed', async () => {
  const api = await compiled();
  for (const kind of ['tenant-admin', 'workspace-wildcard', 'no-saas', 'inactive', 'tenant-frozen', 'password', 'missing-password', 'memory', 'revoked', 'expired', 'staff', 'wrong-user', 'wrong-tenant', 'missing-native']) {
    const f = fixture(api); let changes = {};
    if (['tenant-admin', 'workspace-wildcard', 'no-saas'].includes(kind)) f.user.isSaasAdmin = false;
    if (kind === 'tenant-admin') f.user.isPlatformAdmin = true; if (kind === 'workspace-wildcard') f.member.role.fixedAllPermissions = true;
    if (kind === 'inactive') f.user.isActive = false; if (kind === 'tenant-frozen') f.tenantStatus = 'FROZEN'; if (kind === 'password') f.user.mustChangePassword = true; if (kind === 'missing-password') delete f.user.mustChangePassword;
    if (kind === 'memory') f.mysql = false; if (kind === 'revoked') f.session.revokedAt = new Date(); if (kind === 'expired') f.session.expiresAt = new Date(1);
    if (kind === 'staff') changes = { aud: 'staff' }; if (kind === 'wrong-user') f.session.userId = 'other-user'; if (kind === 'wrong-tenant') changes = { tid: 'other-tenant' }; if (kind === 'missing-native') delete f.tx.authSession;
    assert.equal(await f.principal(f.browser(changes)).catch(() => undefined), undefined, kind); assert.deepEqual(f.state.platforms, {});
  }
  const f = fixture(api); let getters = 0;
  await assert.rejects(() => f.read({ action: 'read', target, actorId: f.user.id }));
  const badTarget = {}; Object.defineProperty(badTarget, 'kind', { enumerable: true, get() { getters++; return 'platform'; } }); await assert.rejects(() => f.read({ action: 'read', target: badTarget })); assert.equal(getters, 0);
  await assert.rejects(() => f.platform.assertTrustedSaasManagement({ userId: f.user.id, tenantId: f.user.tenantId, isSaasAdmin: true }, f.tx));
});

test('MCP bearer, malformed Web tokens, missing explicit secret and session switch cannot create platform authority', async () => {
  const api = await compiled(), f = fixture(api);
  for (const bearer of ['opaque-mcp-token', f.auth.signAccessToken(f.payload) + '.extra', f.auth.signAccessToken({ ...f.payload, exp: 1 }), f.auth.signAccessToken({ ...f.payload, wid: null })]) {
    assert.equal(await f.principal(new Request('https://admin.example.invalid/mcp/platform', { headers: { authorization: 'Bearer ' + bearer } })), undefined);
  }
  const missing = fixture(api), browser = missing.browser(); missing.auth.configService = { get: () => undefined }; assert.equal(await missing.principal(browser), undefined); assert.equal(missing.sessionReads, 0);
  const switched = fixture(api); switched.session.currentWorkspaceId = switched.workspace.id; assert.equal(await switched.principal(), undefined);
  const signedSpace = fixture(api); signedSpace.session.currentWorkspaceId = signedSpace.workspace.id;
  const current = await signedSpace.principal(signedSpace.browser({ wid: signedSpace.workspace.id })); assert.ok(current); assert.ok(!Object.hasOwn(current, 'workspaceId'), 'signed selection still grants no workspace business authority');
  const limited = fixture(api); limited.session.expiresAt = new Date((limited.payload.exp - 10) * 1000); assert.equal((await limited.principal()).expiresAt, limited.payload.exp - 10);
});

test('late original SaaS loss, session getters and cancellation reject; save rollback and unknown use only original key', async () => {
  const api = await compiled();
  for (const kind of ['saas-loss', 'session-revoke', 'cancel']) {
    const f = fixture(api), controller = new AbortController();
    if (kind === 'saas-loss') f.accountHook = (row, reads) => { if (reads >= 2) row.isSaasAdmin = false; return row; };
    else f.sessionHook = (row, reads) => { if (reads >= 2) { if (kind === 'session-revoke') row.revokedAt = new Date(); else controller.abort(); } return row; };
    await assert.rejects(() => f.principal(f.browser(), controller.signal));
  }
  const accessor = fixture(api); let getters = 0; accessor.sessionHook = row => { Object.defineProperty(row, 'userId', { enumerable: true, get() { getters++; return accessor.user.id; } }); return row; };
  await assert.rejects(() => accessor.principal()); assert.equal(getters, 0);
  const lost = fixture(api); lost.afterAudit = () => { lost.user.isSaasAdmin = false; }; await assert.rejects(() => lost.store.save(lost.command, signal())); assert.deepEqual(lost.state.platforms, {}); assert.deepEqual(lost.state.operations, {});
  assert.deepEqual(lost.audits, []);
  for (const kind of ['write-failure', 'missing-id', 'id-getter']) {
    const failed = fixture(api); let getters = 0;
    if (kind === 'write-failure') failed.failAudit = true;
    if (kind === 'missing-id') failed.auditResultHook = () => ({});
    if (kind === 'id-getter') failed.auditResultHook = row => { Object.defineProperty(row, 'id', { enumerable: true, get() { getters++; return 'audit'; } }); return row; };
    await assert.rejects(() => failed.store.save(failed.command, signal()), undefined, kind);
    assert.deepEqual(failed.state.platforms, {}); assert.deepEqual(failed.state.operations, {}); assert.deepEqual(failed.audits, []); assert.equal(getters, 0);
  }
  const receipt = { actorId: 'user-a', operationKey: 'platform-original-save', target, resource, revision: 1 };
  const absent = fixture(api); await assert.rejects(() => absent.database.$transaction(tx => absent.management.audit(tx, receipt, signal()), options)); assert.deepEqual(absent.audits, []);
  for (const kind of ['actor', 'workspace', 'operation-key', 'policy-revision', 'getter']) {
    const wrong = fixture(api); await wrong.store.save(wrong.command, signal()); const row = wrong.state.operations[wrong.command.operationKey]; let getters = 0;
    if (kind === 'actor') row.actorId = 'other-user'; if (kind === 'workspace') row.workspaceId = 'workspace-a';
    if (kind === 'operation-key' || kind === 'policy-revision') { const saved = JSON.parse(row.resultJson); if (kind === 'operation-key') saved.operationKey = 'other-key'; else saved.policy.revision = 2; row.resultJson = JSON.stringify(saved); }
    if (kind === 'getter') wrong.operationHook = selected => { Object.defineProperty(selected, 'resultJson', { enumerable: true, get() { getters++; return row.resultJson; } }); return selected; };
    await assert.rejects(() => wrong.database.$transaction(tx => wrong.management.audit(tx, receipt, signal()), options), undefined, kind); assert.equal(wrong.audits.length, 1); assert.equal(getters, 0);
  }
  for (const kind of ['platform-space', 'workspace-null', 'grant-id', 'target-id']) {
    const invalid = fixture(api), event = { tenantId: invalid.user.tenantId, userId: invalid.user.id, workspaceId: null, action: 'mcp.oauth.admission.platform.saved', targetType: 'mcp-oauth-admission', targetId: receipt.operationKey, operationKey: receipt.operationKey, revision: 1, grantId: null };
    if (kind === 'platform-space') event.workspaceId = 'workspace-a'; if (kind === 'workspace-null') event.action = 'mcp.oauth.admission.workspace.saved';
    if (kind === 'grant-id') event.grantId = 'grant-a'; if (kind === 'target-id') event.targetId = 'other-key';
    await assert.rejects(() => invalid.database.$transaction(tx => invalid.logs.recordOriginalOAuthAudit(tx, event, signal()), options)); assert.deepEqual(invalid.audits, []);
  }
  const postCommit = fixture(api), postAbort = new AbortController(); postCommit.cancelCommit = postAbort;
  await assert.rejects(() => postCommit.store.save(postCommit.command, postAbort.signal), error => error.kind === 'unknown'); assert.equal(postCommit.audits.length, 1);
  postCommit.cancelCommit = undefined; assert.equal((await postCommit.store.operation(target, postCommit.command.operationKey, signal())).state, 'observed'); assert.equal(postCommit.audits.length, 1);
  const unknown = fixture(api); unknown.loseCommit = true; await assert.rejects(() => unknown.store.save(unknown.command, signal()), error => error.kind === 'unknown'); assert.ok(unknown.state.operations[unknown.command.operationKey]);
  unknown.loseCommit = false; assert.equal((await unknown.store.operation(target, unknown.command.operationKey, signal())).state, 'observed'); assert.equal(unknown.audits.length, 1, 'unknown receipt read does not repeat the platform event');
  const early = fixture(api), controller = new AbortController(); controller.abort(); await assert.rejects(() => early.read(undefined, controller.signal)); assert.equal(early.sessionReads, 0);
  const stopped = fixture(api), requestAbort = new AbortController(), browser = stopped.browser({}, { signal: requestAbort.signal }); stopped.authorizer = createOriginalMcpPlatformManagement(stopped.auth, browser); requestAbort.abort(); await assert.rejects(() => stopped.read()); assert.equal(stopped.sessionReads, 0);
  assert.throws(() => createOriginalMcpPlatformManagement({}, fixture(api).browser()), /unavailable/i);
});
