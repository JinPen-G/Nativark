"use strict";
/** Actual SaaS Web + verification adapter + persistent review nonce/CAS/source ->
 * registry -> original logs. Only native SQL/log commit and original verification
 * evidence remain explicit substitutes; no real UI/MFA/DB/full API type proof. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path');
const { createRequire, registerHooks } = require('node:module'), { pathToFileURL } = require('node:url');
const { root, source } = require('./fixtures/mcp/original-identity.cjs');
const { fixture: baseFixture } = require('./fixtures/mcp/public-client-management.cjs');
const { createOriginalMcpClientReviewManagement } = source('apps/api/src/modules/auth/original-mcp-client-review-management.ts');
const { createOriginalMcpPublicClientManagement } = source('apps/api/src/modules/auth/original-mcp-public-client-management.ts');
const { createOriginalMcpReviewedGovernanceControlPlane } = source('apps/api/src/modules/auth/original-mcp-reviewed-governance-control-plane.ts');
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
const signal = () => new AbortController().signal, origin = 'https://admin.example.invalid';
const config = { enabled: true, prepareEndpoint: origin + '/mcp/client-review/prepare', decisionEndpoint: origin + '/mcp/client-review/decide', receiptEndpoint: origin + '/mcp/client-review/receipt', allowedScopes: ['rental.catalog.read'], policyRevision: 1, actionTtlSeconds: 120, maxReviewLifetimeSeconds: 900 };
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-client-review-verification-')), pkg = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(pkg, 'package.json'), path.join(staged, 'package.json'));
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')], rootDir: path.join(pkg, 'src'), outDir: path.join(staged, 'dist'), paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram(['reviewed-governance-control-plane.ts', 'public-client-authorization.ts'].map(file => path.join(pkg, 'src', file)), options));
  const consumer = path.join(output, 'consumer.mts'); fs.writeFileSync(consumer, `
export { createPrismaPublicClientReview, publicClientReviewRegistrationHash } from '@rental-os/mcp-server/prisma-public-client-review';
export { createPrismaPublicClientRegistry, captureRegisteredPublicClient, capturePublicClientRegistrationReceipt } from '@rental-os/mcp-server/prisma-public-client-registry';
export { createPublicClientAuthorization } from '@rental-os/mcp-server/public-client-authorization';
export { createMcpReviewedGovernanceControlPlane } from '@rental-os/mcp-server/reviewed-governance-control-plane';
export { createPrismaOAuthConsentPolicyStore, captureOAuthConsentPolicyTarget, captureOAuthConsentPolicyReceipt } from '@rental-os/mcp-server/prisma-oauth-consent-policy-store';
export { captureOAuthConsentPolicy } from '@rental-os/mcp-server/prisma-oauth-consent-review';
import type { PublicClientRegistrationReviewSource } from '@rental-os/mcp-server/prisma-public-client-review';
import type { OAuthSqlTransaction } from '@rental-os/mcp-server/prisma-oauth-store';
interface Native extends OAuthSqlTransaction { originalAccount(): void }
export const nativeSource = (source: PublicClientRegistrationReviewSource<Native>, tx: Native) => source.current(tx, 'client-a', new AbortController().signal);
`);
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  const prefix = pathToFileURL(staged + path.sep).href; registerHooks({ resolve(specifier, context, next) { if (context.parentURL?.startsWith(prefix) && specifier === '@modelcontextprotocol/server') return { url: pathToFileURL(installed.resolve(specifier)).href, shortCircuit: true }; return next(specifier, context); } });
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href); return artifact;
}
function fixture(api) {
  const f = baseFixture(api); f.review = undefined; f.state.reviewDrafts = {}; f.state.reviewPointers = {};
  const now = Math.floor(Date.now() / 1000), registration = api.captureRegisteredPublicClient({ ...f.command.registration, revision: 1 });
  f.verification = { kind: 'not_required', reference: 'original-admin-verification-policy', revision: 1, expiresAt: now + 900, userId: f.user.id, tenantId: f.user.tenantId, sessionId: f.session.id, registrationHash: api.publicClientReviewRegistrationHash(registration) };
  f.verifyReads = 0; f.verifier = { async current(tx) { assert.equal(tx, f.native); f.verifyReads++; const v = f.verification ? structuredClone(f.verification) : undefined; return f.verifyHook ? f.verifyHook(v, f.verifyReads) : v; } };
  f.queryExtra = (working, sql, values) => {
    const table = sql.includes('FROM mcp_oauth_public_client_review_drafts') ? 'reviewDrafts' : sql.includes('FROM mcp_oauth_public_client_reviews') ? 'reviewPointers' : undefined;
    if (!table) return undefined; const row = working[table][values[0]] ? structuredClone(working[table][values[0]]) : undefined;
    return row ? [f.reviewRowHook ? f.reviewRowHook(row, sql) : row] : [];
  };
  f.executeExtra = (working, sql, values) => {
    if (sql.includes('INSERT INTO mcp_oauth_public_client_review_drafts')) { assert.ok(!working.reviewDrafts[values[0]]); working.reviewDrafts[values[0]] = Object.fromEntries(['operationKey', 'clientId', 'actorId', 'tenantId', 'browserSessionId', 'reviewRevision', 'nonceHash', 'decisionRevision', 'state', 'decidedAt', 'recordJson'].map((name, i) => [name, values[i]])); return 1; }
    if (sql.includes('UPDATE mcp_oauth_public_client_review_drafts')) { const row = working.reviewDrafts[values[3]]; if (!row || row.decisionRevision !== values[4] || row.state !== values[5] || row.nonceHash !== values[6]) return 0; row.decisionRevision = values[0]; row.state = values[1]; row.decidedAt = values[2]; return 1; }
    if (sql.includes('INSERT INTO mcp_oauth_public_client_reviews')) { assert.ok(!working.reviewPointers[values[0]]); assert.equal(working.reviewDrafts[values[2]].clientId, values[0]); working.reviewPointers[values[0]] = { clientId: values[0], revision: values[1], reference: values[2] }; return 1; }
    if (sql.includes('UPDATE mcp_oauth_public_client_reviews')) { const row = working.reviewPointers[values[2]]; if (!row || row.revision !== values[3]) return 0; assert.equal(working.reviewDrafts[values[1]].clientId, values[2]); row.revision = values[0]; row.reference = values[1]; return 1; }
    return undefined;
  };
  f.manager = createOriginalMcpClientReviewManagement({ registrationHash: api.publicClientReviewRegistrationHash }, f.auth, f.logs, f.verifier);
  f.reviews = api.createPrismaPublicClientReview(config, f.database, f.readonly, f.manager);
  f.management = createOriginalMcpPublicClientManagement({ registration: api.captureRegisteredPublicClient, receipt: api.capturePublicClientRegistrationReceipt }, f.auth, f.browser(), f.readonly, f.logs, f.reviews.source);
  f.registry = api.createPrismaPublicClientRegistry(f.database, f.management);
  f.input = { operationKey: 'review-original-key', expectedRevision: 0, registration };
  f.request = (url, method, body, changes = {}) => new Request(url, { method, headers: { authorization: 'Bearer ' + f.auth.signAccessToken(f.payload), origin, 'content-type': method === 'GET' ? 'application/json' : url === config.prepareEndpoint ? 'application/json' : 'application/x-www-form-urlencoded', ...changes }, ...(body !== undefined ? { body } : {}) });
  f.prepare = (input = f.input, changes = {}, sig = signal()) => f.reviews.prepare(f.request(config.prepareEndpoint, 'POST', JSON.stringify(input), changes), sig).catch(error => { if (f.transactionFailure) error.cause = f.transactionFailure; throw error; });
  f.decide = (prepared, decision = 'approve', changes = {}, sig = signal()) => f.reviews.decide(f.request(config.decisionEndpoint, 'POST', new URLSearchParams({ operationKey: prepared.operationKey, clientId: prepared.registration.clientId, expectedRevision: '1', decision, nonce: prepared.nonce }).toString(), changes), sig);
  f.receipt = (sig = signal()) => f.reviews.receipt(f.request(config.receiptEndpoint + '?operationKey=' + f.input.operationKey, 'GET', undefined), sig);
  f.current = () => f.database.$transaction(tx => f.reviews.source.current(tx, 'client-a', signal()), { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
  return f;
}

test('actual original Web review nonce -> approved pointer/source -> registry CAS -> original audit without seeded approval', async () => {
  const api = await compiled(), f = fixture(api); assert.equal(await f.current(), undefined);
  const prepared = await f.prepare(); assert.equal(prepared.state, 'prepared'); assert.equal(await f.current(), undefined); assert.deepEqual(f.state.clients, {});
  assert.ok(!JSON.stringify(f.state).includes(prepared.nonce)); assert.equal(f.audits[0].action, 'mcp.oauth.client.review.prepared'); assert.equal(f.audits[0].workspaceId, null);
  const approved = await f.decide(prepared); assert.equal(approved.decision, 'approved');
  const current = await f.current(); assert.equal(current.reference, f.input.operationKey); assert.equal(current.revision, 1); assert.deepEqual(current.registration, f.input.registration);
  const saved = await f.registry.save(f.command, signal()); assert.equal(saved.registration.revision, 1); assert.deepEqual(f.audits.map(row => row.action), ['mcp.oauth.client.review.prepared', 'mcp.oauth.client.review.approved', 'mcp.oauth.client.registration.saved']);
  assert.ok(f.audits.every(row => row.userId === f.user.id && row.tenantId === f.user.tenantId && row.workspaceId === null)); assert.ok(!JSON.stringify(f.audits).includes(prepared.nonce));
  assert.equal((await f.receipt()).decision, 'approved'); assert.equal(f.audits.length, 3);

  const web = fixture(api), governance = { enabled: true, resourceUrl: 'https://mcp.example.invalid/mcp', requestTimeoutMs: 5000, maxResponseBytes: 65536,
    client: { readEndpoint: origin + '/mcp/client/read', saveEndpoint: origin + '/mcp/client/save', receiptEndpoint: origin + '/mcp/client/operation' },
    notice: { readEndpoint: origin + '/mcp/notice/read', saveEndpoint: origin + '/mcp/notice/save', receiptEndpoint: origin + '/mcp/notice/operation' } };
  const control = createOriginalMcpReviewedGovernanceControlPlane(api, governance, web.auth, web.platform, web.logs, { database: web.database, clientReview: web.reviews.source });
  const readUrl = governance.client.readEndpoint + '?clientId=client-a', readResponse = await control.fetch(web.request(readUrl, 'GET'));
  assert.equal(readResponse.status, 200); assert.equal((await readResponse.json()).state, 'not_configured');
  assert.equal((await control.fetch(web.request(governance.client.saveEndpoint, 'POST', JSON.stringify(web.command), { 'content-type': 'application/json' }))).status, 403);
  assert.deepEqual(web.state.clients, {}, 'no request reference or missing review can register a client');
  const draft = await web.prepare(); await web.decide(draft);
  web.loseCommit = true; const uncertain = await control.fetch(web.request(governance.client.saveEndpoint, 'POST', JSON.stringify(web.command), { 'content-type': 'application/json' })); web.loseCommit = false;
  assert.equal(uncertain.status, 503); assert.deepEqual(await uncertain.json(), { error: 'governance_unknown', retryable: false });
  const receiptUrl = governance.client.receiptEndpoint + '?' + new URLSearchParams({ clientId: 'client-a', operationKey: web.command.operationKey });
  const receiptResponse = await control.fetch(web.request(receiptUrl, 'GET')); assert.equal(receiptResponse.status, 200); assert.equal((await receiptResponse.json()).result.registration.revision, 1);
  const configured = await control.fetch(web.request(readUrl, 'GET')); assert.equal(configured.status, 200); assert.equal(configured.headers.get('cache-control'), 'no-store'); assert.equal((await configured.json()).registration.clientId, 'client-a');
  assert.equal(web.audits.length, 3); web.user.isSaasAdmin = false; assert.notEqual((await control.fetch(web.request(readUrl, 'GET'))).status, 200, 'managed read never borrows the unguarded internal AS reader'); web.user.isSaasAdmin = true;
  const closeOnly = createOriginalMcpReviewedGovernanceControlPlane(api, governance, web.auth, web.platform, web.logs, { database: web.database });
  const disabled = { operationKey: 'web-client-disable', expectedRevision: 1, registration: { ...web.command.registration, enabled: false } };
  assert.equal((await closeOnly.fetch(web.request(governance.client.saveEndpoint, 'POST', JSON.stringify(disabled), { 'content-type': 'application/json' }))).status, 200);
  const reenable = { ...disabled, operationKey: 'web-client-reenable', expectedRevision: 2, registration: { ...disabled.registration, enabled: true } };
  assert.equal((await closeOnly.fetch(web.request(governance.client.saveEndpoint, 'POST', JSON.stringify(reenable), { 'content-type': 'application/json' }))).status, 403); assert.equal(web.audits.length, 4);
  assert.equal((await control.fetch(new Request(readUrl))).status, 403);
  await control.close(); assert.equal((await control.fetch(web.request(readUrl, 'GET'))).status, 503); await closeOnly.close();
});

test('Origin/nonce/form and missing or mismatched original verification never publish approval', async () => {
  const api = await compiled();
  for (const kind of ['missing-proof', 'wrong-user', 'wrong-session', 'wrong-hash', 'expired-proof', 'getter-proof', 'caller-actor', 'scope']) {
    const f = fixture(api); let input = structuredClone(f.input), getters = 0;
    if (kind === 'missing-proof') f.verification = undefined; if (kind === 'wrong-user') f.verification.userId = 'other-user'; if (kind === 'wrong-session') f.verification.sessionId = 'other-session'; if (kind === 'wrong-hash') f.verification.registrationHash = '0'.repeat(64); if (kind === 'expired-proof') f.verification.expiresAt = 1;
    if (kind === 'getter-proof') f.verifyHook = row => { Object.defineProperty(row, 'kind', { enumerable: true, get() { getters++; return 'not_required'; } }); return row; };
    if (kind === 'caller-actor') input.actorId = 'administrator'; if (kind === 'scope') input.registration.scopes = ['rental.order.write'];
    await assert.rejects(() => f.prepare(input), undefined, kind); assert.deepEqual(f.state.reviewDrafts, {}); assert.deepEqual(f.state.reviewPointers, {}); assert.deepEqual(f.audits, []); assert.equal(getters, 0);
  }
  for (const kind of ['origin', 'nonce', 'confirmed', 'get', 'client']) {
    const f = fixture(api), prepared = await f.prepare(), params = new URLSearchParams({ operationKey: prepared.operationKey, clientId: 'client-a', expectedRevision: '1', decision: 'approve', nonce: prepared.nonce });
    if (kind === 'nonce') params.set('nonce', 'A'.repeat(43)); if (kind === 'confirmed') params.set('confirmed', 'true'); if (kind === 'client') params.set('clientId', 'other-client');
    const request = f.request(config.decisionEndpoint, kind === 'get' ? 'GET' : 'POST', kind === 'get' ? undefined : params.toString(), kind === 'origin' ? { origin: 'https://other.example.invalid' } : {});
    await assert.rejects(() => f.reviews.decide(request, signal()), undefined, kind); assert.deepEqual(f.state.reviewPointers, {}); assert.equal(f.state.reviewDrafts[f.input.operationKey].state, 'pending'); assert.equal(f.audits.length, 1);
  }
});

test('same original key/decision is not republished; pointer CAS and original denial preserve current approval', async () => {
  const api = await compiled(), f = fixture(api), a = await f.prepare(), b = await f.prepare({ ...f.input, operationKey: 'second-review-key' });
  const duplicate = await f.prepare(); assert.equal(duplicate.state, 'observed'); assert.ok(!Object.hasOwn(duplicate, 'nonce'));
  const [one, two] = await Promise.all([f.decide(a), f.decide(a)]); assert.equal(one.decision, 'approved'); assert.equal(two.decision, 'approved'); assert.equal(f.audits.length, 3);
  await assert.rejects(() => f.decide(b)); assert.equal(f.state.reviewDrafts[b.operationKey].state, 'pending');
  const denied = await f.decide(b, 'deny'); assert.equal(denied.decision, 'denied'); assert.equal((await f.current()).reference, a.operationKey);
  await assert.rejects(() => f.decide(a, 'deny')); assert.equal(f.state.reviewPointers['client-a'].reference, a.operationKey);
  f.verification = undefined; assert.equal((await f.receipt()).decision, 'approved');
  f.user.isSaasAdmin = false; await assert.rejects(() => f.receipt());
});

test('audit/late loss rollback and unknown/cancel commits keep exact receipts; corrupt published evidence fails closed', async () => {
  const api = await compiled();
  for (const kind of ['audit-failure', 'late-saas', 'missing-id']) {
    const f = fixture(api); if (kind === 'audit-failure') f.failAudit = true; if (kind === 'late-saas') f.afterAudit = () => { f.user.isSaasAdmin = false; }; if (kind === 'missing-id') f.auditResultHook = () => ({});
    await assert.rejects(() => f.prepare(), undefined, kind); assert.deepEqual(f.state.reviewDrafts, {}); assert.deepEqual(f.state.reviewPointers, {}); assert.deepEqual(f.audits, []);
  }
  const failedApproval = fixture(api), failedDraft = await failedApproval.prepare(); failedApproval.failAudit = true;
  await assert.rejects(() => failedApproval.decide(failedDraft)); assert.deepEqual(failedApproval.state.reviewPointers, {}); assert.equal(failedApproval.state.reviewDrafts[failedDraft.operationKey].state, 'pending'); assert.equal(failedApproval.audits.length, 1);
  const policyChanged = fixture(api), approvedDraft = await policyChanged.prepare(); await policyChanged.decide(approvedDraft);
  const newPolicy = api.createPrismaPublicClientReview({ ...config, policyRevision: 2 }, policyChanged.database, policyChanged.readonly, policyChanged.manager);
  assert.equal(await policyChanged.database.$transaction(tx => newPolicy.source.current(tx, 'client-a', signal()), { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 }), undefined);
  assert.equal((await policyChanged.receipt()).decision, 'approved', 'new policy is not historical receipt erasure');
  const preparation = fixture(api); preparation.loseCommit = true; await assert.rejects(() => preparation.prepare(), error => error.kind === 'unknown'); assert.ok(preparation.state.reviewDrafts[preparation.input.operationKey]); preparation.loseCommit = false; const observed = await preparation.prepare(); assert.equal(observed.state, 'observed'); assert.ok(!Object.hasOwn(observed, 'nonce')); assert.equal(preparation.audits.length, 1);
  for (const mode of ['lost-response', 'post-commit-cancel']) {
    const f = fixture(api), prepared = await f.prepare(), controller = new AbortController(); f.loseCommit = mode === 'lost-response'; f.cancelCommit = mode === 'post-commit-cancel' ? controller : undefined;
    await assert.rejects(() => f.decide(prepared, 'approve', {}, controller.signal), error => error.kind === 'unknown'); assert.equal(f.state.reviewPointers['client-a'].reference, prepared.operationKey); assert.equal(f.audits.length, 2);
    f.loseCommit = false; f.cancelCommit = undefined; assert.equal((await f.receipt()).decision, 'approved'); assert.equal(f.audits.length, 2);
  }
  const corrupt = fixture(api), prepared = await corrupt.prepare(); await corrupt.decide(prepared); corrupt.state.reviewPointers['client-a'].revision = 2; await assert.rejects(() => corrupt.current());
  const cancelled = fixture(api), controller = new AbortController(); controller.abort(); await assert.rejects(() => cancelled.prepare(cancelled.input, {}, controller.signal)); assert.deepEqual(cancelled.state.reviewDrafts, {});
});
