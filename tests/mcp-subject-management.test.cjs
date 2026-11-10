"use strict";
/** Actual issuer mapping CAS + original Auth/tenant management + native audit.
 * Session/account/SQL/commit and notice provenance are explicit offline fixtures;
 * no public Controller/UI/MFA/DB/DI or full API/actual Prisma type proof. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const { fixture: originalFixture, source, root, identity } = require('./fixtures/mcp/original-identity.cjs');
const { PlatformService } = source('apps/api/src/modules/platform/platform.service.ts');
const { OperationLogService } = source('apps/api/src/common/operation-log.service.ts');
const { createOriginalMcpSubjectManagement } = source('apps/api/src/modules/auth/original-mcp-subject-management.ts');
const { createOriginalMcpSubjectControlPlane } = source('apps/api/src/modules/auth/original-mcp-subject-control-plane.ts');
const { createOriginalMcpGrantIdentity } = source('apps/api/src/modules/auth/original-mcp-grant-identity.ts');
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
const signal = () => new AbortController().signal;
const resource = 'https://mcp.example.invalid/mcp', target = { userId: 'user-a', tenantId: 'tenant-a' };
const transactionOptions = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-subject-management-verification-')), pkg = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(pkg, 'package.json'), path.join(staged, 'package.json'));
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')], rootDir: path.join(pkg, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram([path.join(pkg, 'src/subject-control-plane.ts')], options));
  const consumer = path.join(output, 'consumer.mts'); fs.writeFileSync(consumer, [
    'export { createPrismaOAuthSubjectStore, captureOAuthSubjectReceipt, captureOAuthSubjectTarget } from "@rental-os/mcp-server/prisma-oauth-subject-store";',
    'export { createMcpSubjectControlPlane } from "@rental-os/mcp-server/subject-control-plane";',
    'export { createPrismaOAuthConsentReview, captureOAuthSubjectBinding } from "@rental-os/mcp-server/prisma-oauth-consent-review";',
    'import type { OriginalOAuthSubjectManagement, PrismaOAuthSubjectStore } from "@rental-os/mcp-server/prisma-oauth-subject-store";',
    'import type { OAuthSqlTransaction } from "@rental-os/mcp-server/prisma-oauth-store";',
    'interface Native extends OAuthSqlTransaction { originalAccount: { id: string }; }',
    'export const typed = (port: OriginalOAuthSubjectManagement<Native>): OriginalOAuthSubjectManagement<Native> => ({',
    'authorize: async (tx, ...args) => { const id: string = tx.originalAccount.id; void id; return port.authorize(tx, ...args); },',
    'audit: async (tx, ...args) => { const id: string = tx.originalAccount.id; void id; return port.audit(tx, ...args); } });',
    'export const read = (store: PrismaOAuthSubjectStore<Native>, tx: Native, signal: AbortSignal) => store.readIn(tx, { userId: tx.originalAccount.id, tenantId: "tenant-a" }, signal);',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href);
  fs.writeFileSync(path.join(output, 'scope.json'), JSON.stringify({ strict: 'subject/review dependency closure + generated formal NodeNext exports + rich native consumers', actual: 'original Auth/Platform/subject management/audit source', external: 'Nest/Prisma/session/account/SQL/native log/commit/notice fixtures', excluded: 'public UI/CSRF/MFA/DB/DI/full API types and production release' }, null, 2));
  return artifact;
}
function fixture(api) {
  const f = originalFixture(), now = Math.floor(Date.now() / 1000); f.now = now; f.state = { subjects: {}, operations: {} }; f.auditRows = []; f.queries = []; f.writes = []; f.tail = Promise.resolve();
  const session = f.session = { id: 'original-session', userId: f.user.id, currentWorkspaceId: f.workspace.id, audience: 'operator', expiresAt: new Date((now + 1800) * 1000), revokedAt: null };
  f.payload = { sub: f.user.id, tid: f.user.tenantId, sid: session.id, wid: session.currentWorkspaceId, aud: 'operator', iat: now, exp: now + 900 };
  const originalUserRead = f.tx.user.findFirst;
  f.tx.user.findFirst = async query => f.otherUser && query.where.id === f.otherUser.id ? (f.otherUser.isActive ? structuredClone(f.otherUser) : null) : originalUserRead(query);
  f.tx.authSession = { findFirst: async query => query.where.id === session.id && session.revokedAt === null && session.expiresAt > new Date() ? structuredClone(session) : null };
  f.platform.getAuthSession = (...args) => PlatformService.prototype.getAuthSession.call(f.platform, ...args);
  f.platform.assertTrustedWorkspaceIntegrationManagement = (...args) => PlatformService.prototype.assertTrustedWorkspaceIntegrationManagement.call(f.platform, ...args);
  f.platform.assertTrustedWorkspaceSubjectManagement = (...args) => PlatformService.prototype.assertTrustedWorkspaceSubjectManagement.call(f.platform, ...args);
  f.enableManagement = () => { const r = f.user.roleAssignments[0].role; r.permissions = [{ permission: { code: 'system:integration:manage' } }]; r.dataScope = 'ALL'; };
  f.browser = () => new Request('https://admin.example.invalid/mcp/subjects', { headers: { authorization: 'Bearer ' + f.auth.signAccessToken(f.payload) } });
  f.database = { async $transaction(callback, options) {
    assert.deepEqual(options, transactionOptions); const before = f.tail; let release; f.tail = new Promise(resolve => { release = resolve; }); await before;
    const working = structuredClone(f.state), audits = [];
    const tx = { ...f.tx, operationLog: { create: async ({ data, select }) => {
      assert.deepEqual(select, { id: true }); if (f.failAudit) throw new Error('private audit failure'); audits.push(structuredClone(data)); f.afterAudit?.(working);
      if (f.missingAuditId) return {}; return { id: 'original-subject-log-' + (f.auditRows.length + audits.length) };
    } }, async $queryRaw(parts, ...values) {
      const sql = parts.join('?').replace(/\s+/g, ' ').trim(); assert.match(sql, /FOR UPDATE$/); f.queries.push({ sql, values });
      if (sql.includes('FROM auth_sessions')) { assert.deepEqual(values, [session.id]); return [{ id: session.id }]; }
      let rows;
      if (sql.includes('FROM mcp_oauth_subject_bindings')) rows = working.subjects[values.join('|')] ? [structuredClone(working.subjects[values.join('|')])] : [];
      else if (sql.includes('FROM mcp_oauth_subject_operations')) rows = working.operations[values[0]] ? [structuredClone(working.operations[values[0]])] : [];
      else if (sql.includes('FROM mcp_oauth_consent_reviews')) rows = [{ resource, revision: 1, recordJson: JSON.stringify(f.platformReview) }];
      else if (sql.includes('FROM mcp_oauth_workspace_reviews')) rows = [{ resource, tenantId: 'tenant-a', workspaceId: 'workspace-a', revision: 1, recordJson: JSON.stringify(f.workspaceReview) }];
      else throw new Error('Unexpected fixture read');
      return f.queryHook ? f.queryHook(sql, rows) : rows;
    }, async $executeRaw(parts, ...values) {
      const sql = parts.join('?').replace(/\s+/g, ' ').trim(); f.writes.push({ sql, values });
      if (sql.startsWith('INSERT INTO mcp_oauth_subject_bindings')) {
        const key = values.slice(0, 3).join('|'); assert.ok(!working.subjects[key]); assert.ok(!Object.values(working.subjects).some(row => row.resource === values[0] && row.subject === values[3]));
        working.subjects[key] = Object.fromEntries(['resource', 'userId', 'tenantId', 'subject', 'revision', 'recordJson'].map((k, i) => [k, values[i]])); return 1;
      }
      if (sql.startsWith('UPDATE mcp_oauth_subject_bindings')) {
        const key = values.slice(2, 5).join('|'), row = working.subjects[key]; if (!row || row.subject !== values[5] || row.revision !== values[6] || f.casFail) return 0;
        row.revision = values[0]; row.recordJson = values[1]; return 1;
      }
      if (sql.startsWith('INSERT INTO mcp_oauth_subject_operations')) {
        assert.ok(!working.operations[values[0]]); working.operations[values[0]] = Object.fromEntries(['actorId', 'workspaceId', 'resource', 'userId', 'tenantId', 'payloadHash', 'resultJson'].map((k, i) => [k, values[i + 1]])); return 1;
      }
      throw new Error('Unexpected fixture write');
    } }; f.native = tx;
    try { const result = await callback(tx); f.state = working; f.auditRows.push(...audits); f.cancelCommit?.abort(); if (f.loseCommit) throw new Error('private commit response loss'); return result; }
    catch (error) { f.transactionFailure = error; throw error; } finally { release(); }
  } };
  const logs = f.logs = new OperationLogService({ operationLog: { create() { throw new Error('Global audit forbidden'); } } });
  f.management = createOriginalMcpSubjectManagement({ receipt: api.captureOAuthSubjectReceipt }, { resourceUrl: resource }, f.auth, f.platform, f.browser(), logs);
  f.store = api.createPrismaOAuthSubjectStore({ resourceUrl: resource }, f.database, f.management);
  f.command = { operationKey: 'subject-save-a', expectedRevision: 0, target, enabled: true, expiresAt: now + 600 };
  f.platformReview = { resource, revision: 1, enabled: true, expiresAt: now + 700, noticeVersion: 'review-v1', noticeText: 'Original approved fixture notice.', verificationRequired: false, reviewRef: 'original-platform-review', reviewRevision: 1 };
  f.workspaceReview = { resource, tenantId: 'tenant-a', workspaceId: 'workspace-a', revision: 1, enabled: true, expiresAt: now + 700, noticeVersion: 'review-v1', verificationRequired: false, reviewRef: 'original-workspace-review', reviewRevision: 1 };
  f.reader = api.createPrismaOAuthConsentReview({ enabled: true, resourceUrl: resource, allowedScopes: ['rental.catalog.read'] }, createOriginalMcpGrantIdentity(f.auth));
  f.input = { clientId: 'client-a', clientRevision: 1, resource, scopes: ['rental.catalog.read'], redirectUri: 'https://client.example.invalid/callback', state: 'state-a', codeChallenge: Buffer.alloc(32, 1).toString('base64url') };
  f.current = () => f.database.$transaction(tx => f.reader.current(f.input, { ...f.binding, sessionId: session.id, expiresAt: now + 800 }, tx, signal()), transactionOptions);
  return f;
}

test('original tenant manager creates one opaque issuer subject; current consent reads it and CAS never rebinds it', async () => {
  const api = await compiled(), f = fixture(api); f.enableManagement();
  assert.equal((await f.store.read(target, signal())).state, 'not_configured');
  const saved = await identity.runWithRequestIdentity({ workspaceId: 'unrelated-als-space' }, () => f.store.save(f.command, signal()));
  assert.match(saved.binding.subject, /^[a-f0-9-]{36}$/); assert.notEqual(saved.binding.subject, target.userId); assert.equal(saved.binding.revision, 1);
  assert.equal((await f.current()).subject, saved.binding.subject);
  assert.equal(f.auditRows[0].workspaceId, 'workspace-a'); assert.equal(f.auditRows[0].tenantId, target.tenantId); assert.equal(f.auditRows[0].detail.targetId, target.userId);
  assert.equal(f.auditRows[0].action, 'mcp.oauth.subject.binding.saved'); assert.deepEqual(f.auditRows[0].detail.metadata, { operationKey: f.command.operationKey, revision: 1 });
  const oldGrantSnapshot = Object.freeze({ subject: saved.binding.subject, revision: 1 });
  const disabled = await f.store.save({ ...f.command, operationKey: 'subject-disable-a', expectedRevision: 1, enabled: false, expiresAt: 1 }, signal());
  assert.equal(disabled.binding.subject, saved.binding.subject); assert.equal(await f.current(), undefined);
  assert.deepEqual((await f.store.operation(target, f.command.operationKey, signal())).result, saved, 'old original receipt survives changed/expired mapping');
  const renewed = await f.store.save({ ...f.command, operationKey: 'subject-renew-a', expectedRevision: 2 }, signal());
  assert.equal(renewed.binding.subject, saved.binding.subject); assert.equal((await f.current()).subject, saved.binding.subject);
  assert.equal(oldGrantSnapshot.subject, saved.binding.subject); assert.equal(f.auditRows.length, 3);
  assert.ok(f.writes.every(row => /^(INSERT INTO|UPDATE) mcp_oauth_subject_(bindings|operations)/.test(row.sql)), 'no grant/token/business writes');
  assert.ok(f.queries.every(row => !row.sql.includes('tenant-a'))); assert.ok(Object.isFrozen(saved.binding));

  const web = fixture(api); web.enableManagement();
  const config = { enabled: true, resourceUrl: resource, requestTimeoutMs: 5000, maxResponseBytes: 65536,
    readEndpoint: 'https://admin.example.invalid/mcp/subject/read', saveEndpoint: 'https://admin.example.invalid/mcp/subject/save', receiptEndpoint: 'https://admin.example.invalid/mcp/subject/operation' };
  const control = createOriginalMcpSubjectControlPlane(api, config, web.auth, web.platform, web.logs, web.database);
  const request = (url, data) => { const headers = new Headers(web.browser().headers); if (data !== undefined) { headers.set('origin', 'https://admin.example.invalid'); headers.set('content-type', 'application/json'); }
    return new Request(url, { headers, ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }) }); };
  const readUrl = config.readEndpoint + '?' + new URLSearchParams(target);
  const initial = await control.fetch(request(readUrl)); assert.equal(initial.status, 200); assert.equal((await initial.json()).state, 'not_configured');
  assert.equal((await control.fetch(new Request(readUrl))).status, 403);
  assert.equal((await control.fetch(request(config.saveEndpoint))).status, 405);
  assert.equal((await control.fetch(request(config.saveEndpoint, { ...web.command, subject: 'caller-subject' }))).status, 400);
  assert.equal((await control.fetch(request(config.saveEndpoint, { ...web.command, actorId: 'forged' }))).status, 400);
  const wrongOrigin = request(config.saveEndpoint, web.command); wrongOrigin.headers.set('origin', 'https://other.example.invalid'); assert.equal((await control.fetch(wrongOrigin)).status, 403);
  web.loseCommit = true; const uncertain = await control.fetch(request(config.saveEndpoint, web.command)); web.loseCommit = false;
  assert.equal(uncertain.status, 503); assert.deepEqual(await uncertain.json(), { error: 'subject_unknown', retryable: false }); assert.equal(web.auditRows.length, 1);
  const originalSubject = Object.values(web.state.subjects)[0].subject;
  const receiptUrl = config.receiptEndpoint + '?' + new URLSearchParams({ ...target, operationKey: web.command.operationKey });
  const receiptResponse = await control.fetch(request(receiptUrl)); assert.equal(receiptResponse.status, 200); const receiptView = await receiptResponse.json();
  assert.equal(receiptView.result.binding.revision, 1); assert.equal(Object.hasOwn(receiptView.result.binding, 'subject'), false); assert.ok(!JSON.stringify(receiptView).includes(originalSubject));
  const currentResponse = await control.fetch(request(readUrl)); assert.equal(currentResponse.status, 200); assert.equal(currentResponse.headers.get('cache-control'), 'no-store'); const currentView = await currentResponse.json();
  assert.deepEqual(Object.keys(currentView.binding).sort(), ['resource', 'userId', 'tenantId', 'revision', 'enabled', 'expiresAt'].sort()); assert.ok(!JSON.stringify(currentView).includes(originalSubject));
  const duplicateResponse = await control.fetch(request(config.saveEndpoint, web.command)); assert.equal(duplicateResponse.status, 200); assert.ok(!(await duplicateResponse.text()).includes(originalSubject)); assert.equal(web.auditRows.length, 1);
  const closeCommand = { ...web.command, operationKey: 'web-subject-disable', expectedRevision: 1, enabled: false, expiresAt: 1 };
  assert.equal((await control.fetch(request(config.saveEndpoint, closeCommand))).status, 200);
  const renewedResponse = await control.fetch(request(config.saveEndpoint, { ...web.command, operationKey: 'web-subject-renew', expectedRevision: 2 })); assert.equal(renewedResponse.status, 200); assert.ok(!(await renewedResponse.text()).includes(originalSubject));
  assert.equal(Object.values(web.state.subjects)[0].subject, originalSubject); assert.equal(web.auditRows.length, 3);
  const forbiddenTarget = config.readEndpoint + '?' + new URLSearchParams({ ...target, tenantId: 'other-tenant' }); assert.notEqual((await control.fetch(request(forbiddenTarget))).status, 200);
  assert.notEqual((await control.fetch(new Request(readUrl, { headers: { authorization: 'Bearer opaque-mcp-token' } }))).status, 200);
  const unready = api.createMcpSubjectControlPlane(config); assert.equal((await unready.fetch(request(readUrl))).status, 503);
  assert.throws(() => api.createMcpSubjectControlPlane({ ...config, receiptEndpoint: config.readEndpoint }), /distinct/);
  await control.close(); assert.equal((await control.fetch(request(receiptUrl))).status, 503); await unready.close();
});

test('caller subject/actor, cross-tenant target, SaaS/wildcard/limited rights and non-Web credentials never authorize subject metadata', async () => {
  const api = await compiled();
  for (const kind of ['subject', 'actor', 'getter', 'no-rights', 'wildcard', 'limited', 'saas', 'staff', 'mcp-token', 'revoked', 'memory', 'cross-tenant', 'target-absent', 'target-saas']) {
    const f = fixture(api); f.enableManagement(); let command = structuredClone(f.command), getters = 0;
    if (kind === 'subject') command.subject = 'caller-subject'; if (kind === 'actor') command.actorId = 'administrator';
    if (kind === 'getter') Object.defineProperty(command.target, 'userId', { enumerable: true, get() { getters++; return 'user-a'; } });
    if (['no-rights', 'wildcard'].includes(kind)) f.user.roleAssignments[0].role.permissions = [];
    if (kind === 'wildcard') { f.member.role.fixedAllPermissions = true; f.member.dataScope = 'ALL'; }
    if (kind === 'limited') f.user.roleAssignments[0].role.dataScope = 'ORGANIZATION';
    if (kind === 'saas') f.user.isSaasAdmin = true; if (kind === 'revoked') f.session.revokedAt = new Date(); if (kind === 'memory') f.mysql = false;
    if (kind === 'cross-tenant') command.target.tenantId = 'other-tenant'; if (kind === 'target-absent') command.target.userId = 'absent-user';
    if (kind === 'target-saas') { f.otherUser = { ...structuredClone(f.user), id: 'user-b', isSaasAdmin: true }; command.target.userId = 'user-b'; }
    if (['staff', 'mcp-token'].includes(kind)) {
      if (kind === 'staff') f.payload.aud = 'staff';
      const browser = kind === 'staff' ? f.browser() : new Request('https://admin.example.invalid/mcp', { headers: { authorization: 'Bearer opaque-mcp-token' } });
      const management = createOriginalMcpSubjectManagement({ receipt: api.captureOAuthSubjectReceipt }, { resourceUrl: resource }, f.auth, f.platform, browser, f.logs);
      f.store = api.createPrismaOAuthSubjectStore({ resourceUrl: resource }, f.database, management);
    }
    await assert.rejects(() => f.store.save(command, signal()), undefined, kind); assert.deepEqual(f.state, { subjects: {}, operations: {} }, kind); assert.equal(f.auditRows.length, 0); assert.equal(getters, 0);
  }
  const f = fixture(api); f.enableManagement(); f.otherUser = { ...structuredClone(f.user), id: 'user-b' };
  const saved = await f.store.save({ ...f.command, target: { ...target, userId: 'user-b' } }, signal()); assert.equal(saved.binding.userId, 'user-b');
  assert.equal(f.auditRows[0].userId, 'user-a', 'tenant metadata manager is not target/business principal');
});

test('original-key replay and concurrent CAS keep one subject/audit; receipts remain owner-scoped without resaving', async () => {
  const api = await compiled(), f = fixture(api); f.enableManagement();
  const results = await Promise.all([f.store.save(f.command, signal()), f.store.save(f.command, signal())]); assert.deepEqual(results[0], results[1]); assert.equal(f.auditRows.length, 1);
  await assert.rejects(() => f.store.save({ ...f.command, operationKey: 'other-key' }, signal()), e => e.kind === 'conflict');
  await assert.rejects(() => f.store.save({ ...f.command, enabled: false }, signal()), e => e.kind === 'conflict');
  f.casFail = true; await assert.rejects(() => f.store.save({ ...f.command, operationKey: 'cas-failure', expectedRevision: 1 }, signal()), e => e.kind === 'conflict'); assert.equal(f.auditRows.length, 1); f.casFail = false;
  assert.deepEqual(await f.store.operation(target, 'missing-original-key', signal()), { state: 'not_observed', retryable: false });
  for (const kind of ['actor', 'tenant', 'user', 'hash', 'subject-index', 'receipt-subject', 'getter']) {
    const item = fixture(api); item.enableManagement(); await item.store.save(item.command, signal()); const row = item.state.operations[item.command.operationKey]; let getters = 0;
    if (kind === 'actor') row.actorId = 'different-actor'; if (kind === 'tenant') row.tenantId = 'other-tenant'; if (kind === 'user') row.userId = 'other-user'; if (kind === 'hash') row.payloadHash = '0'.repeat(64);
    if (kind === 'subject-index') item.state.subjects[[resource, target.userId, target.tenantId].join('|')].subject = 'changed-index';
    if (kind === 'receipt-subject') { const saved = JSON.parse(row.resultJson); saved.binding.subject = 'forged-subject'; row.resultJson = JSON.stringify(saved); }
    if (kind === 'getter') item.queryHook = (sql, rows) => { if (sql.includes('FROM mcp_oauth_subject_operations')) Object.defineProperty(rows[0], 'payloadHash', { enumerable: true, get() { getters++; return row.payloadHash; } }); return rows; };
    if (kind === 'subject-index') await assert.rejects(() => item.store.read(target, signal())); else await assert.rejects(() => item.store.operation(target, item.command.operationKey, signal()));
    assert.equal(getters, 0); assert.equal(item.auditRows.length, 1);
  }
  f.user.roleAssignments[0].role.permissions = []; await assert.rejects(() => f.store.operation(target, f.command.operationKey, signal())); assert.equal(f.auditRows.length, 1);
});

test('native audit/late authority failures roll back; ambiguous commits keep original receipts and never regenerate', async () => {
  const api = await compiled();
  for (const kind of ['audit', 'missing-id', 'late-rights', 'late-target', 'late-receipt']) {
    const f = fixture(api); f.enableManagement();
    if (kind === 'audit') f.failAudit = true; if (kind === 'missing-id') f.missingAuditId = true;
    if (kind === 'late-rights') f.afterAudit = () => { f.user.roleAssignments[0].role.permissions = []; };
    if (kind === 'late-target') f.afterAudit = () => { f.user.isActive = false; };
    if (kind === 'late-receipt') f.afterAudit = working => { working.operations[f.command.operationKey].payloadHash = '0'.repeat(64); };
    await assert.rejects(() => f.store.save(f.command, signal()), undefined, kind); assert.deepEqual(f.state, { subjects: {}, operations: {} }); assert.equal(f.auditRows.length, 0);
  }
  for (const kind of ['lost-response', 'post-commit-cancel']) {
    const f = fixture(api); f.enableManagement(); const controller = new AbortController(); f.loseCommit = kind === 'lost-response'; if (kind === 'post-commit-cancel') f.cancelCommit = controller;
    await assert.rejects(() => f.store.save(f.command, controller.signal), e => e.kind === 'unknown'); assert.equal(f.auditRows.length, 1);
    f.loseCommit = false; f.cancelCommit = undefined; const observed = await f.store.operation(target, f.command.operationKey, signal()); assert.equal(observed.state, 'observed');
    assert.equal(Object.keys(f.state.subjects).length, 1); assert.equal(f.auditRows.length, 1); assert.equal(observed.result.binding.subject, Object.values(f.state.subjects)[0].subject);
  }
  const f = fixture(api); f.enableManagement(); const controller = new AbortController(); controller.abort();
  await assert.rejects(() => f.store.save(f.command, controller.signal)); assert.equal(f.queries.length, 0);
  const input = { actorId: 'user-a', workspaceId: 'workspace-a', operationKey: 'unassociated', target, resource, revision: 1 };
  await assert.rejects(() => f.database.$transaction(tx => f.management.audit(tx, input, signal()), transactionOptions)); assert.equal(f.auditRows.length, 0);
  for (const changed of [{ workspaceId: null }, { grantId: 'grant-a' }, { targetType: 'mcp-oauth-grant' }, { targetId: 'invalid long target ' }]) {
    await assert.rejects(() => f.database.$transaction(tx => f.logs.recordOriginalOAuthAudit(tx, { tenantId: 'tenant-a', userId: 'user-a', workspaceId: 'workspace-a', action: 'mcp.oauth.subject.binding.saved', targetType: 'mcp-oauth-subject-binding', targetId: 'user-a', operationKey: 'key-a', revision: 1, grantId: null, ...changed }, signal()), transactionOptions));
  }
  assert.equal(f.auditRows.length, 0);
});
