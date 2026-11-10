"use strict";
/** Actual original Web Auth + tenant integration permission + admission CAS/audit.
 * SQL/session/role rows and native OperationLog/commit are offline substitutes;
 * no platform/SaaS management, UI/CSRF/API boot or true DB/type proof. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const { fixture: originalFixture, source, root } = require('./fixtures/mcp/original-identity.cjs');
const { PlatformService } = source('apps/api/src/modules/platform/platform.service.ts');
const { createOriginalMcpWorkspaceManagement, createOriginalMcpWorkspaceAdmissionManagement } = source('apps/api/src/modules/auth/original-mcp-workspace-management.ts');
const { createOriginalMcpAdmissionControlPlane } = source('apps/api/src/modules/auth/original-mcp-admission-control-plane.ts');
const { OperationLogService } = source('apps/api/src/common/operation-log.service.ts');
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
const signal = () => new AbortController().signal;
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-workspace-management-verification-')), pkg = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(pkg, 'package.json'), path.join(staged, 'package.json'));
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')], rootDir: path.join(pkg, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram([path.join(pkg, 'src/admission-control-plane.ts')], options));
  const consumer = path.join(output, 'consumer.mts'); fs.writeFileSync(consumer, [
    'export { createPrismaOAuthAdmissionStore, captureOAuthAdmissionTarget } from "@rental-os/mcp-server/prisma-oauth-admission-store";',
    'export { createMcpAdmissionControlPlane } from "@rental-os/mcp-server/admission-control-plane";',
    'import { createMcpAdmissionControlPlane } from "@rental-os/mcp-server/admission-control-plane";',
    'import type { OriginalMcpAdmissionControlPlaneDependencies, McpAdmissionControlPlaneConfig } from "@rental-os/mcp-server/admission-control-plane";',
    'import type { OAuthSqlTransaction } from "@rental-os/mcp-server/prisma-oauth-store";',
    'interface Native extends OAuthSqlTransaction { originalMarker: "original"; }',
    'export const rich = (config: McpAdmissionControlPlaneConfig, original: OriginalMcpAdmissionControlPlaneDependencies<Native>) => createMcpAdmissionControlPlane(config, original);',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href); return artifact;
}
const resource = 'https://mcp.example.invalid/mcp', target = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
function fixture(api) {
  const f = originalFixture(), now = Math.floor(Date.now() / 1000); f.state = { workspaces: {}, operations: {} }; f.audits = []; f.auditRows = []; f.queries = []; f.afterAudit = undefined; f.failAudit = false; f.tail = Promise.resolve();
  const session = f.session = { id: 'original-session', userId: f.user.id, currentWorkspaceId: f.workspace.id, audience: 'operator', expiresAt: new Date((now + 1800) * 1000), revokedAt: null };
  f.payload = { sub: f.user.id, tid: f.user.tenantId, sid: session.id, wid: session.currentWorkspaceId, aud: 'operator', iat: now, exp: now + 900 };
  f.tx.authSession = { findFirst: async query => query.where.id === session.id && session.revokedAt === null && session.expiresAt > new Date() ? structuredClone(session) : null };
  f.platform.getAuthSession = (...args) => PlatformService.prototype.getAuthSession.call(f.platform, ...args);
  f.platform.assertTrustedWorkspaceIntegrationManagement = (...args) => PlatformService.prototype.assertTrustedWorkspaceIntegrationManagement.call(f.platform, ...args);
  f.browser = () => new Request('https://admin.example.invalid/mcp/admission', { headers: { authorization: 'Bearer ' + f.auth.signAccessToken(f.payload) } });
  f.authorizer = createOriginalMcpWorkspaceManagement(f.auth, f.platform, f.browser());
  f.enableManagement = () => { const role = f.user.roleAssignments[0].role; role.permissions = [{ permission: { code: 'system:integration:manage' } }]; role.dataScope = 'ALL'; };
  f.database = { async $transaction(callback, options) {
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 }); const before = f.tail; let release; f.tail = new Promise(resolve => { release = resolve; }); await before;
    const working = structuredClone(f.state), audit = [], auditRows = [];
    const tx = { ...f.tx, operationLog: { create: async ({ data, select }) => { assert.deepEqual(select, { id: true });
        if (f.failAudit) throw new Error('private audit write failure'); auditRows.push(structuredClone(data));
        audit.push({ actorId: data.userId, revision: data.detail.metadata.revision }); f.afterAudit?.(); return { id: 'original-management-audit-' + (f.auditRows.length + auditRows.length) }; } },
      async $queryRaw(parts, ...values) { const sql = parts.join('?').replace(/\s+/g, ' ').trim(); f.queries.push({ sql, values }); assert.match(sql, /FOR UPDATE$/);
        if (sql.includes('FROM auth_sessions')) { assert.deepEqual(values, [session.id]); return [{ id: session.id }]; }
        const table = sql.includes('FROM mcp_oauth_admission_operations') ? 'operations' : 'workspaces', key = table === 'operations' ? values[0] : values.join('|');
        return working[table][key] ? [structuredClone(working[table][key])] : [];
      },
      async $executeRaw(parts, ...values) { const sql = parts.join('?').replace(/\s+/g, ' ').trim();
        if (sql.includes('INTO mcp_oauth_workspace_admissions')) { const key = values.slice(0, 3).join('|'); assert.ok(!working.workspaces[key]); working.workspaces[key] = { resource: values[0], tenantId: values[1], workspaceId: values[2], revision: values[3], recordJson: values[4] }; return 1; }
        if (sql.includes('INTO mcp_oauth_admission_operations')) { assert.ok(!working.operations[values[0]]); working.operations[values[0]] = Object.fromEntries(['actorId', 'targetKind', 'resource', 'tenantId', 'workspaceId', 'payloadHash', 'resultJson'].map((k, i) => [k, values[i + 1]])); return 1; }
        throw new Error('Unexpected management fixture write');
      },
    }; f.native = tx; f.pendingAudit = audit;
    try { const result = await callback(tx); f.state = working; f.audits.push(...audit); f.auditRows.push(...auditRows); f.cancelCommit?.abort(); if (f.loseCommit) throw new Error('private commit-response-loss'); return result; } finally { release(); }
  } };
  const logs = f.logs = new OperationLogService({ operationLog: { create() { throw new Error('Global audit fallback forbidden'); } } });
  const management = f.management = createOriginalMcpWorkspaceAdmissionManagement({ resourceUrl: resource }, f.auth, f.platform, f.browser(), logs);
  f.store = api.createPrismaOAuthAdmissionStore({ resourceUrl: resource, allowedScopes: ['rental.catalog.read'] }, f.database, { readIn: async (tx, clientId) => { assert.equal(tx, f.native); return { clientId }; } }, management);
  f.command = { operationKey: 'original-workspace-save', expectedRevision: 0, target, policy: { enabled: true, expiresAt: now + 500, clientIds: ['client-a'], scopes: ['rental.catalog.read'] } };
  f.readManagement = (request = { action: 'read', target }) => f.database.$transaction(tx => f.authorizer.authorize(tx, request, signal()), { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
  return f;
}

test('original tenant integration rights authorize exact workspace and are consumed by original admission CAS', async () => {
  const api = await compiled(), f = fixture(api); f.enableManagement();
  assert.deepEqual(await f.readManagement(), { actorId: 'user-a', kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' });
  const saved = await f.store.save(f.command, signal()); assert.equal(saved.policy.revision, 1); assert.equal(f.audits[0].actorId, 'user-a');
  assert.equal((await f.store.operation(target, f.command.operationKey, signal())).state, 'observed'); assert.equal(f.audits.length, 1);
  assert.equal(f.auditRows[0].action, 'mcp.oauth.admission.workspace.saved'); assert.equal(f.auditRows[0].tenantId, target.tenantId);
  assert.equal(f.auditRows[0].workspaceId, target.workspaceId); assert.equal(f.auditRows[0].detail.metadata.operationKey, f.command.operationKey);
  assert.ok(f.calls.some(([kind]) => kind === 'tx-user')); assert.ok(f.calls.some(([kind]) => kind === 'tx-member')); assert.ok(f.queries.every(query => !query.sql.includes('tenant-a')));

  const web = fixture(api); web.enableManagement();
  web.platform.assertTrustedSaasManagement = (...args) => PlatformService.prototype.assertTrustedSaasManagement.call(web.platform, ...args);
  const config = { enabled: true, resourceUrl: resource, allowedScopes: ['rental.catalog.read'], requestTimeoutMs: 5000, maxResponseBytes: 65536,
    readEndpoint: 'https://admin.example.invalid/mcp/admission/read', saveEndpoint: 'https://admin.example.invalid/mcp/admission/save', receiptEndpoint: 'https://admin.example.invalid/mcp/admission/receipt' };
  const control = createOriginalMcpAdmissionControlPlane(api, config, web.auth, web.platform, web.logs,
    { database: web.database, registrations: { readIn: async (tx, clientId) => { assert.equal(tx, web.native); return { clientId }; } } });
  const request = (url, data) => { const headers = new Headers(web.browser().headers); if (data !== undefined) { headers.set('origin', 'https://admin.example.invalid'); headers.set('content-type', 'application/json'); }
    return new Request(url, { headers, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) }); };
  const readUrl = config.readEndpoint + '?' + new URLSearchParams({ target: JSON.stringify(target) });
  const initial = await control.fetch(request(readUrl)); assert.equal(initial.status, 200); assert.equal((await initial.json()).state, 'not_configured');
  assert.equal((await control.fetch(new Request(readUrl))).status, 403);
  const crossScope = config.readEndpoint + '?' + new URLSearchParams({ target: JSON.stringify({ kind: 'platform' }) });
  assert.notEqual((await control.fetch(request(crossScope))).status, 200, 'tenant management is not current SaaS authority');
  const wrongOrigin = request(config.saveEndpoint, web.command); wrongOrigin.headers.set('origin', 'https://other.example.invalid'); assert.equal((await control.fetch(wrongOrigin)).status, 403);
  assert.equal((await control.fetch(request(config.saveEndpoint, { ...web.command, actorId: 'forged' }))).status, 400);
  const input = { ...web.command, policy: { ...web.command.policy, clientIds: Array.from({ length: 50 }, (_, i) => 'registered-fixture-client-' + i) } };
  web.loseCommit = true; const ambiguous = await control.fetch(request(config.saveEndpoint, input)); web.loseCommit = false;
  assert.equal(ambiguous.status, 503); assert.deepEqual(await ambiguous.json(), { error: 'admission_unknown', retryable: false }); assert.equal(web.auditRows.length, 1);
  const receiptUrl = config.receiptEndpoint + '?' + new URLSearchParams({ target: JSON.stringify(target), operationKey: input.operationKey });
  const receipt = await control.fetch(request(receiptUrl)); assert.equal(receipt.status, 200); assert.equal((await receipt.json()).result.policy.clientIds.length, 50, 'valid original metadata is not clipped to the other Web routes 32-item ceiling');
  const current = await control.fetch(request(readUrl)); assert.equal(current.status, 200); assert.equal(current.headers.get('cache-control'), 'no-store'); assert.equal((await current.json()).policy.clientIds.length, 50);
  assert.equal((await control.fetch(request(config.saveEndpoint, input))).status, 200); assert.equal(web.auditRows.length, 1);
  assert.equal((await control.fetch(request(config.saveEndpoint, { ...input, operationKey: 'competing-original-cas' }))).status, 409);
  const unready = api.createMcpAdmissionControlPlane(config); assert.equal((await unready.fetch(request(readUrl))).status, 503);
  await control.close(); assert.equal((await control.fetch(request(readUrl))).status, 503); await unready.close();
});

test('workspace wildcard, incomplete tenant scope and caller authority cannot substitute for original tenant rights', async () => {
  const api = await compiled();
  for (const kind of ['no-permission', 'workspace-wildcard', 'limited-scope', 'inactive-tenant-role', 'caller-actor', 'target-getter']) {
    const f = fixture(api); let request = { action: 'read', target: { ...target } }, getters = 0;
    if (kind === 'workspace-wildcard') { f.member.role.fixedAllPermissions = true; f.member.dataScope = 'ALL'; }
    if (kind === 'limited-scope') { f.enableManagement(); f.user.roleAssignments[0].role.dataScope = 'ORGANIZATION'; }
    if (kind === 'inactive-tenant-role') { f.enableManagement(); f.user.roleAssignments[0].role.isActive = false; }
    if (kind === 'caller-actor') { f.enableManagement(); request.actorId = 'administrator'; }
    if (kind === 'target-getter') { f.enableManagement(); Object.defineProperty(request.target, 'kind', { enumerable: true, get() { getters++; return 'workspace'; } }); }
    await assert.rejects(() => f.readManagement(request), /unavailable/i, kind); assert.equal(getters, 0); assert.deepEqual(f.state.workspaces, {});
  }
});

test('SaaS/platform, another space, staff, expired/revoked Web sessions and memory sources never gain workspace authority', async () => {
  const api = await compiled(), f = fixture(api); f.enableManagement();
  assert.equal(await f.readManagement({ action: 'save', target: { kind: 'platform' } }), undefined);
  assert.equal(await f.readManagement({ action: 'read', target: { ...target, tenantId: 'other-tenant' } }), undefined);
  assert.equal(await f.readManagement({ action: 'read', target: { ...target, workspaceId: 'other-space' } }), undefined);
  for (const kind of ['saas', 'staff', 'revoked', 'expired', 'password', 'memory', 'mcp-bearer']) {
    const item = fixture(api); item.enableManagement();
    if (kind === 'saas') item.user.isSaasAdmin = true; if (kind === 'revoked') item.session.revokedAt = new Date(); if (kind === 'password') item.user.mustChangePassword = true; if (kind === 'memory') item.mysql = false;
    if (kind === 'expired') item.session.expiresAt = new Date(1);
    if (kind === 'staff') item.payload.aud = 'staff';
    if (['staff', 'mcp-bearer'].includes(kind)) { const browser = kind === 'staff' ? item.browser() : new Request('https://admin.example.invalid/mcp', { headers: { authorization: 'Bearer opaque-mcp-token' } }); item.authorizer = createOriginalMcpWorkspaceManagement(item.auth, item.platform, browser); }
    const result = await item.readManagement().catch(() => undefined); assert.equal(result, undefined, kind);
  }
});

test('lost original management rights at commit recheck roll back the CAS and receipt; cancellation does not use late authority', async () => {
  const api = await compiled(), f = fixture(api); f.enableManagement(); f.afterAudit = () => { f.user.roleAssignments[0].role.permissions = []; };
  await assert.rejects(() => f.store.save(f.command, signal())); assert.deepEqual(f.state.workspaces, {}); assert.deepEqual(f.state.operations, {}); assert.deepEqual(f.audits, []);
  const failed = fixture(api); failed.enableManagement(); failed.failAudit = true;
  await assert.rejects(() => failed.store.save(failed.command, signal())); assert.deepEqual(failed.state.workspaces, {}); assert.deepEqual(failed.state.operations, {}); assert.deepEqual(failed.auditRows, []);
  const unassociated = fixture(api); unassociated.enableManagement();
  const receipt = { actorId: 'user-a', operationKey: 'missing-original-operation', target, resource, revision: 1 };
  await assert.rejects(() => unassociated.database.$transaction(tx => unassociated.management.audit(tx, receipt, signal()), { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 }));
  assert.deepEqual(unassociated.auditRows, []);
  const mismatched = fixture(api); mismatched.enableManagement();
  await assert.rejects(() => mismatched.database.$transaction(tx => mismatched.management.audit(tx, { ...receipt, actorId: 'other-user' }, signal()), { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 }));
  assert.deepEqual(mismatched.auditRows, []);
  for (const kind of ['actor', 'workspace', 'operation-key', 'policy-revision']) {
    const wrong = fixture(api); wrong.enableManagement(); await wrong.store.save(wrong.command, signal());
    const row = wrong.state.operations[wrong.command.operationKey];
    if (kind === 'actor') row.actorId = 'other-user';
    if (kind === 'workspace') row.workspaceId = 'other-space';
    if (kind === 'operation-key' || kind === 'policy-revision') {
      const saved = JSON.parse(row.resultJson);
      if (kind === 'operation-key') saved.operationKey = 'other-operation'; else saved.policy.revision = 2;
      row.resultJson = JSON.stringify(saved);
    }
    await assert.rejects(() => wrong.database.$transaction(tx => wrong.management.audit(tx, { ...receipt, operationKey: wrong.command.operationKey }, signal()), { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 }), undefined, kind);
    assert.equal(wrong.auditRows.length, 1, 'mismatched saved association adds no audit event');
  }
  for (const mode of ['lost-response', 'post-commit-cancel']) {
    const unknown = fixture(api); unknown.enableManagement(); const cancelled = new AbortController();
    unknown.loseCommit = mode === 'lost-response'; unknown.cancelCommit = mode === 'post-commit-cancel' ? cancelled : undefined;
    await assert.rejects(() => unknown.store.save(unknown.command, cancelled.signal), error => error.kind === 'unknown');
    assert.equal(unknown.auditRows.length, 1); assert.ok(unknown.state.operations[unknown.command.operationKey]);
    unknown.loseCommit = false; unknown.cancelCommit = undefined;
    assert.equal((await unknown.store.operation(target, unknown.command.operationKey, signal())).state, 'observed');
    assert.equal(unknown.auditRows.length, 1, 'receipt read does not repeat the saved event');
  }
  const controller = new AbortController(); controller.abort(); const before = f.queries.length;
  await assert.rejects(() => f.authorizer.authorize(f.tx, { action: 'read', target }, controller.signal)); assert.equal(f.queries.length, before);
  assert.throws(() => createOriginalMcpWorkspaceManagement({}, f.platform, f.browser()), /unavailable/i);
});
