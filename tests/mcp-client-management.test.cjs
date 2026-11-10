"use strict";
/** Actual original SaaS Web + registry CAS + original OperationLog, with formal
 * captures and native types. Review/account/session/SQL/native log commit remain
 * explicit offline substitutes; no review producer, UI/CSRF/live DB/API type proof. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const { createRequire, registerHooks } = require('node:module'), { pathToFileURL } = require('node:url');
const { fixture: originalFixture, source, root, identity: als } = require('./fixtures/mcp/original-identity.cjs');
const { PlatformService } = source('apps/api/src/modules/platform/platform.service.ts');
const { OperationLogService } = source('apps/api/src/common/operation-log.service.ts');
const { createOriginalMcpPublicClientManagement } = source('apps/api/src/modules/auth/original-mcp-public-client-management.ts');
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
const signal = () => new AbortController().signal, options = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-client-management-verification-')), pkg = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(pkg, 'package.json'), path.join(staged, 'package.json'));
  const compiler = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')], rootDir: path.join(pkg, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram(['prisma-public-client-registry.ts', 'prisma-oauth-grant-authority.ts', 'prisma-oauth-consent-authority.ts', 'prisma-oauth-admission-store.ts', 'prisma-oauth-web-consent.ts', 'public-client-authorization.ts'].map(file => path.join(pkg, 'src', file)), compiler));
  const consumer = path.join(output, 'consumer.mts'); fs.writeFileSync(consumer, `
export { createPrismaPublicClientRegistry, captureRegisteredPublicClient, capturePublicClientRegistrationReceipt } from '@rental-os/mcp-server/prisma-public-client-registry';
export { createPublicClientAuthorization } from '@rental-os/mcp-server/public-client-authorization';
import { createPrismaPublicClientRegistry } from '@rental-os/mcp-server/prisma-public-client-registry';
import type { OriginalPublicClientManagement, PrismaPublicClientRegistry } from '@rental-os/mcp-server/prisma-public-client-registry';
import type { OAuthSqlTransaction, OAuthSqlDatabase } from '@rental-os/mcp-server/prisma-oauth-store';
import { createPrismaOAuthGrantAuthority } from '@rental-os/mcp-server/prisma-oauth-grant-authority';
import { createPrismaOAuthConsentAuthority } from '@rental-os/mcp-server/prisma-oauth-consent-authority';
import { createPrismaOAuthAdmissionStore } from '@rental-os/mcp-server/prisma-oauth-admission-store';
import { createPrismaOAuthWebConsent } from '@rental-os/mcp-server/prisma-oauth-web-consent';
interface Native extends OAuthSqlTransaction { originalAccount(): void }
export function nativeConsumer(database: OAuthSqlDatabase<Native>, tx: Native) {
  const management: OriginalPublicClientManagement<Native> = { authorize: async native => { native.originalAccount(); return { actorId: 'user-a' }; }, audit: async native => { native.originalAccount(); } };
  const registry: PrismaPublicClientRegistry<Native> = createPrismaPublicClientRegistry(database, management);
  const grant: Parameters<typeof createPrismaOAuthGrantAuthority<Native>>[2] = registry;
  const consent: Parameters<typeof createPrismaOAuthConsentAuthority<Native>>[2] = registry;
  const admission: Parameters<typeof createPrismaOAuthAdmissionStore<Native>>[2] = registry;
  const web: Parameters<typeof createPrismaOAuthWebConsent<Native>>[2] = registry;
  void [grant, consent, admission, web]; return registry.readIn(tx, 'client-a', new AbortController().signal);
}
`);
  check(ts.createProgram([consumer], { ...compiler, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  const prefix = pathToFileURL(staged + path.sep).href; registerHooks({ resolve(specifier, context, next) { if (context.parentURL?.startsWith(prefix) && specifier === '@modelcontextprotocol/server') return { url: pathToFileURL(installed.resolve(specifier)).href, shortCircuit: true }; return next(specifier, context); } });
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href); return artifact;
}
const { fixture } = require("./fixtures/mcp/public-client-management.cjs");

test('original SaaS/current review -> registry CAS -> native original audit -> official S256 precheck', async () => {
  const api = await compiled(), f = fixture(api);
  const saved = await als.runWithRequestIdentity({ userId: 'other-user', tenantId: 'other-tenant', workspaceId: 'other-space', audience: 'operator' }, () => f.registry.save(f.command, signal()));
  assert.equal(saved.registration.revision, 1); assert.equal(f.audits.length, 1); assert.equal(f.audits[0].action, 'mcp.oauth.client.registration.saved');
  assert.equal(f.audits[0].workspaceId, null); assert.equal(f.audits[0].tenantId, f.user.tenantId); assert.equal(f.audits[0].userId, f.user.id); assert.equal(f.audits[0].detail.targetId, 'client-a');
  assert.deepEqual(f.audits[0].detail.metadata, { operationKey: f.command.operationKey, revision: 1 }); assert.ok(!JSON.stringify(f.audits).includes('redirectUris')); assert.ok(!JSON.stringify(f.audits).includes('Bearer'));
  assert.equal((await f.registry.save(f.command, signal())).state, 'saved'); assert.equal((await f.registry.operation('client-a', f.command.operationKey, signal())).state, 'observed'); assert.equal(f.audits.length, 1);
  const { startAuthorization } = installed('@modelcontextprotocol/client'), issuer = 'https://auth.example.invalid/', resource = 'https://mcp.example.invalid/mcp';
  const started = await startAuthorization(issuer, { metadata: { issuer, authorization_endpoint: issuer + 'authorize', token_endpoint: issuer + 'token', response_types_supported: ['code'], grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'] }, clientInformation: { client_id: 'client-a' }, redirectUrl: 'http://127.0.0.1:49153/rental/callback', resource, scope: 'rental.catalog.read', state: 'original-state' });
  const precheck = api.createPublicClientAuthorization({ authorizationEndpoint: issuer + 'authorize', resourceUrl: resource, allowedScopes: ['rental.catalog.read'], timeoutMs: 1000 }, f.registry);
  assert.equal((await precheck(new Request(started.authorizationUrl), signal())).clientRevision, 1); assert.ok(f.reviewReads > 0);
});

test('missing/mismatched reviews, policy expansion, caller claims and non-SaaS identities never save clients', async () => {
  const api = await compiled();
  for (const kind of ['missing', 'callback', 'scope', 'expiry', 'review-ref', 'review-getter', 'tenant-admin', 'memory', 'password', 'staff', 'caller-actor']) {
    const f = fixture(api); let command = structuredClone(f.command), getters = 0;
    if (kind === 'missing') f.review = undefined; if (kind === 'callback') command.registration.redirectUris = ['https://other.example.invalid/callback']; if (kind === 'scope') command.registration.scopes = ['rental.order.write'];
    if (kind === 'expiry') f.review.expiresAt = 1; if (kind === 'review-ref') f.review.reference = '';
    if (kind === 'review-getter') f.reviewHook = row => { Object.defineProperty(row, 'reference', { enumerable: true, get() { getters++; return 'forged-review'; } }); return row; };
    if (kind === 'tenant-admin') { f.user.isSaasAdmin = false; f.user.isPlatformAdmin = true; } if (kind === 'memory') f.mysql = false; if (kind === 'password') f.user.mustChangePassword = true;
    if (kind === 'staff') { f.payload.aud = 'staff'; f.management = createOriginalMcpPublicClientManagement({ registration: api.captureRegisteredPublicClient, receipt: api.capturePublicClientRegistrationReceipt }, f.auth, f.browser(), f.readonly, f.logs, f.reviews); f.registry = api.createPrismaPublicClientRegistry(f.database, f.management); }
    if (kind === 'caller-actor') command.actorId = 'administrator';
    await assert.rejects(() => f.registry.save(command, signal()), undefined, kind); assert.deepEqual(f.state.clients, {}); assert.deepEqual(f.state.operations, {}); assert.deepEqual(f.audits, []); assert.equal(getters, 0);
  }
});

test('review-independent exact disable and owner receipt read never approve new clients or changed metadata', async () => {
  const api = await compiled(), f = fixture(api); await f.registry.save(f.command, signal()); f.review = undefined;
  const disable = { operationKey: 'client-original-disable', expectedRevision: 1, registration: { ...f.command.registration, enabled: false } };
  await f.registry.save(disable, signal()); assert.equal((await f.registry.read('client-a', signal())).enabled, false); assert.equal(f.audits.length, 2);
  const history = await f.registry.operation('client-a', f.command.operationKey, signal()); assert.equal(history.state, 'observed'); assert.equal(history.result.registration.enabled, true); assert.equal(f.audits.length, 2);
  for (const kind of ['scope', 'callback', 'expiry', 'new-client']) {
    const command = { operationKey: 'cannot-expand-' + kind, expectedRevision: 2, registration: { ...disable.registration } };
    if (kind === 'scope') command.registration.scopes = ['rental.order.write']; if (kind === 'callback') command.registration.redirectUris = ['https://other.example.invalid/callback'];
    if (kind === 'expiry') command.registration.expiresAt++; if (kind === 'new-client') { command.expectedRevision = 0; command.registration.clientId = 'new-client'; }
    await assert.rejects(() => f.registry.save(command, signal()), undefined, kind); assert.equal(f.audits.length, 2);
  }
  f.user.isSaasAdmin = false; await assert.rejects(() => f.registry.operation('client-a', f.command.operationKey, signal()));
});

test('late review/identity loss, audit failure, corrupt original receipt and unknown/cancel commit never authorize replay', async () => {
  const api = await compiled();
  for (const kind of ['late-review', 'late-saas', 'audit-failure', 'missing-id']) {
    const f = fixture(api);
    if (kind === 'late-review') f.reviewHook = (row, reads) => { if (reads >= 2) row.reference = 'changed-original-review'; return row; };
    if (kind === 'late-saas') f.afterAudit = () => { f.user.isSaasAdmin = false; }; if (kind === 'audit-failure') f.failAudit = true; if (kind === 'missing-id') f.auditResultHook = () => ({});
    await assert.rejects(() => f.registry.save(f.command, signal()), undefined, kind); assert.deepEqual(f.state.clients, {}); assert.deepEqual(f.state.operations, {}); assert.deepEqual(f.audits, []);
  }
  for (const kind of ['client', 'hash', 'getter']) {
    const f = fixture(api); await f.registry.save(f.command, signal()); const row = f.state.operations[f.command.operationKey]; let getters = 0;
    if (kind === 'client') row.clientId = 'other-client'; if (kind === 'hash') row.payloadHash = '0'.repeat(64);
    if (kind === 'getter') f.rowHook = (row, sql) => { if (sql.includes('public_client_operations')) Object.defineProperty(row, 'resultJson', { enumerable: true, get() { getters++; return '{}'; } }); return row; };
    await assert.rejects(() => f.database.$transaction(tx => f.management.audit(tx, { actorId: f.user.id, clientId: 'client-a', operationKey: f.command.operationKey, revision: 1 }, signal()), options)); assert.equal(f.audits.length, 1); assert.equal(getters, 0);
  }
  for (const kind of ['lost-response', 'post-commit-cancel']) {
    const f = fixture(api), controller = new AbortController(); f.loseCommit = kind === 'lost-response'; f.cancelCommit = kind === 'post-commit-cancel' ? controller : undefined;
    await assert.rejects(() => f.registry.save(f.command, controller.signal), error => error.kind === 'unknown'); assert.equal(f.audits.length, 1); assert.ok(f.state.operations[f.command.operationKey]);
    f.loseCommit = false; f.cancelCommit = undefined; assert.equal((await f.registry.operation('client-a', f.command.operationKey, signal())).state, 'observed'); assert.equal(f.audits.length, 1);
  }
  const cancelled = fixture(api), controller = new AbortController(); controller.abort(); await assert.rejects(() => cancelled.registry.save(cancelled.command, controller.signal)); assert.deepEqual(cancelled.audits, []);
});
