"use strict";
/** Actual notice review producer -> approved source -> original projection store.
 * Original verification/account/session/SQL/native log/commit remain substitutes;
 * no true UI/MFA/DB/DI/full API or production approval/release proof. */
const assert = require('node:assert/strict'), { test } = require('node:test'), fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const { source, root } = require('./fixtures/mcp/original-identity.cjs');
const { fixture: policyFixture } = require('./fixtures/mcp/consent-policy-management.cjs');
const { createOriginalMcpNoticeReviewManagement } = source('apps/api/src/modules/auth/original-mcp-notice-review-management.ts');
const { createOriginalMcpConsentPolicyManagement } = source('apps/api/src/modules/auth/original-mcp-consent-policy-management.ts');
const { createOriginalMcpReviewControlPlane } = source('apps/api/src/modules/auth/original-mcp-review-control-plane.ts');
const { createOriginalMcpReviewedGovernanceControlPlane } = source('apps/api/src/modules/auth/original-mcp-reviewed-governance-control-plane.ts');
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
const signal = () => new AbortController().signal, resource = 'https://mcp.example.invalid/mcp', platform = { kind: 'platform' }, workspace = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
const options = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-notice-review-verification-')), pkg = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(pkg, 'package.json'), path.join(staged, 'package.json'));
  const opts = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')], rootDir: path.join(pkg, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')] } };
  const check = p => { const diag = ts.getPreEmitDiagnostics(p); assert.equal(diag.length, 0, diag.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(p.emit().emitSkipped, false); };
  check(ts.createProgram(['review-control-plane.ts', 'reviewed-governance-control-plane.ts'].map(file => path.join(pkg, 'src', file)), opts));
  const consumer = path.join(output, 'consumer.mts'); fs.writeFileSync(consumer, [
    'export { createMcpReviewControlPlane } from "@rental-os/mcp-server/review-control-plane";',
    'export { createMcpReviewedGovernanceControlPlane } from "@rental-os/mcp-server/reviewed-governance-control-plane";',
    'export { publicClientReviewRegistrationHash } from "@rental-os/mcp-server/prisma-public-client-review";',
    'export { createPrismaOAuthNoticeReview, oauthNoticeCandidateHash, oauthNoticeScopeKey } from "@rental-os/mcp-server/prisma-oauth-notice-review";',
    'export { createPrismaOAuthConsentPolicyStore, captureOAuthConsentPolicyReceipt, captureOAuthConsentPolicyTarget } from "@rental-os/mcp-server/prisma-oauth-consent-policy-store";',
    'export { captureOAuthConsentPolicy } from "@rental-os/mcp-server/prisma-oauth-consent-review";',
    'export { createPrismaPublicClientRegistry, captureRegisteredPublicClient, capturePublicClientRegistrationReceipt } from "@rental-os/mcp-server/prisma-public-client-registry";',
    'import type { OriginalOAuthNoticeReviewManagement } from "@rental-os/mcp-server/prisma-oauth-notice-review";',
    'import type { OAuthSqlTransaction } from "@rental-os/mcp-server/prisma-oauth-store";',
    'interface Native extends OAuthSqlTransaction { originalAccount: { id: string }; }',
    'export const typed = (m: OriginalOAuthNoticeReviewManagement<Native>): OriginalOAuthNoticeReviewManagement<Native> => ({ forRequest: browser => { const p=m.forRequest(browser); return {',
    'current: async (tx,...args) => { const id: string=tx.originalAccount.id; void id; return p.current(tx,...args); }, audit: async (tx,...args)=>{ const id:string=tx.originalAccount.id; void id; return p.audit(tx,...args); } }; } });',
  ].join('\n')); check(ts.createProgram([consumer], { ...opts, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href); return artifact;
}
function fixture(api, kind = 'platform') {
  const f = policyFixture(api, kind); f.approved = undefined; Object.assign(f.state, { noticeDrafts: {}, noticePointers: {} });
  const readExtra = f.queryExtra, writeExtra = f.executeExtra;
  f.queryExtra = (working, sql, values) => {
    const table = sql.includes('FROM mcp_oauth_notice_review_drafts') ? 'noticeDrafts' : sql.includes('FROM mcp_oauth_notice_reviews') ? 'noticePointers' : undefined;
    if (!table) return readExtra(working, sql, values); const rows = working[table][values[0]] ? [structuredClone(working[table][values[0]])] : [];
    return f.noticeRowHook ? f.noticeRowHook(rows, sql) : rows;
  };
  f.executeExtra = (working, sql, values) => {
    if (sql.includes('INTO mcp_oauth_notice_review_drafts')) { assert.ok(!working.noticeDrafts[values[0]]); working.noticeDrafts[values[0]] = Object.fromEntries(['operationKey', 'scopeKey', 'actorId', 'actorTenantId', 'actorWorkspaceId', 'browserSessionId', 'reviewRevision', 'nonceHash', 'decisionRevision', 'state', 'decidedAt', 'recordJson'].map((k,i)=>[k,values[i]])); return 1; }
    if (sql.startsWith('UPDATE mcp_oauth_notice_review_drafts')) { const row=working.noticeDrafts[values[3]]; if (!row || row.decisionRevision !== values[4] || row.state !== values[5] || row.nonceHash !== values[6]) return 0; row.decisionRevision=values[0]; row.state=values[1]; row.decidedAt=values[2]; return 1; }
    if (sql.includes('INTO mcp_oauth_notice_reviews')) { assert.ok(!working.noticePointers[values[0]]); working.noticePointers[values[0]]={scopeKey:values[0],revision:values[1],reference:values[2]}; return 1; }
    if (sql.startsWith('UPDATE mcp_oauth_notice_reviews')) { const row=working.noticePointers[values[2]]; if (!row || row.revision!==values[3] || f.pointerFail) return 0; row.revision=values[0]; row.reference=values[1]; return 1; }
    return writeExtra(working,sql,values);
  };
  f.scope = kind === 'workspace' ? workspace : platform;
  f.config = { enabled:true, resourceUrl:resource, prepareEndpoint:'https://admin.example.invalid/mcp/notice/prepare', decisionEndpoint:'https://admin.example.invalid/mcp/notice/decide', receiptEndpoint:'https://admin.example.invalid/mcp/notice/receipt', policyRevision:1, actionTtlSeconds:90, maxReviewLifetimeSeconds:900 };
  f.verificationReads = 0;
  f.verification = { current: async (tx,p,target,policy,sig)=>{ assert.equal(tx,f.native); assert.equal(sig.aborted,false); f.verificationReads++;
    const proof={kind:'not_required',reference:'original-notice-verification-policy',revision:1,expiresAt:f.now+700,userId:p.userId,tenantId:p.tenantId,workspaceId:p.workspaceId,sessionId:p.sessionId,candidateHash:api.oauthNoticeCandidateHash(target,policy)};
    return f.verificationHook ? f.verificationHook(proof) : proof;
  } };
  const captures = { candidateHash:api.oauthNoticeCandidateHash,scopeKey:api.oauthNoticeScopeKey,target:api.captureOAuthConsentPolicyTarget };
  f.author = createOriginalMcpNoticeReviewManagement(captures,{resourceUrl:resource},f.auth,f.platform,f.logs,f.verification);
  f.review = api.createPrismaOAuthNoticeReview(f.config,f.database,{readIn:(...args)=>f.store.readIn(...args)},f.author);
  f.store = api.createPrismaOAuthConsentPolicyStore({resourceUrl:resource},f.database,createOriginalMcpConsentPolicyManagement({policy:api.captureOAuthConsentPolicy,target:api.captureOAuthConsentPolicyTarget,receipt:api.captureOAuthConsentPolicyReceipt},{resourceUrl:resource},f.auth,f.platform,f.browser(),{readIn:(...args)=>f.store.readIn(...args)},f.logs,f.review.source));
  f.input = {operationKey:'notice-review-'+kind,expectedRevision:0,target:f.scope,policy:{...f.command.policy,reviewRef:'notice-review-'+kind,reviewRevision:1}};
  f.request = (endpoint,method,body,contentType,origin='https://admin.example.invalid')=>new Request(endpoint,{method,headers:{authorization:'Bearer '+f.auth.signAccessToken(f.payload),origin,...(contentType?{'content-type':contentType}:{})},...(body===undefined?{}:{body})});
  f.prepare = (input=f.input,sig=signal())=>f.review.prepare(f.request(f.config.prepareEndpoint,'POST',JSON.stringify(input),'application/json'),sig);
  f.decision = (nonce,decision='approve',input=f.input)=>f.request(f.config.decisionEndpoint,'POST',new URLSearchParams({operationKey:input.operationKey,target:JSON.stringify(input.target),expectedRevision:'1',decision,nonce}).toString(),'application/x-www-form-urlencoded');
  f.receipt = (input=f.input)=>f.review.receipt(f.request(f.config.receiptEndpoint+'?'+new URLSearchParams({operationKey:input.operationKey,target:JSON.stringify(input.target)}),'GET',undefined),signal());
  f.current = (target=f.scope)=>f.database.$transaction(tx=>f.review.source.current(tx,target,signal()),options);
  return f;
}

test('actual pending/nonce decision produces original platform/workspace review source consumed by projection CAS',async()=>{
  const api=await compiled();
  for(const kind of ['platform','workspace']){
    const f=fixture(api,kind), prepared=await f.prepare(); assert.equal(prepared.state,'prepared'); assert.equal(await f.current(),undefined); assert.deepEqual(f.state.platforms,{});
    assert.ok(!JSON.stringify(f.state).includes(prepared.nonce)); assert.equal(f.audits[0].action,'mcp.oauth.notice.review.'+kind+'.prepared');
    const approved=await f.review.decide(f.decision(prepared.nonce),signal()); assert.equal(approved.decision,'approved'); const source=await f.current(); assert.equal(source.reference,f.input.operationKey);
    const saved=await f.store.save({operationKey:'projection-'+kind,expectedRevision:0,target:f.scope,policy:source.policy},signal()); assert.equal(saved.policy.reviewRef,source.reference);
    assert.equal(f.audits[1].action,'mcp.oauth.notice.review.'+kind+'.approved'); assert.equal(f.audits[2].action,'mcp.oauth.consent.policy.'+kind+'.saved');
    assert.equal(f.audits[0].workspaceId,kind==='workspace'?'workspace-a':null); assert.ok(!JSON.stringify(f.audits).includes('Reviewed external-model/storage'));
    assert.equal((await f.receipt()).decision,'approved'); assert.equal(f.audits.length,3);
  }
});

test('origin/nonce/target/form and original applicable verification/identity cannot be replaced by caller confirmation',async()=>{
  const api=await compiled();
  for(const kind of ['missing-proof','session','scope','hash','expiry','getter','not-saas','tenant-wildcard']){
    const f=fixture(api,kind==='tenant-wildcard'?'workspace':'platform'); let getters=0;
    if(kind==='not-saas')f.user.isSaasAdmin=false; if(kind==='tenant-wildcard'){f.user.roleAssignments[0].role.permissions=[];f.member.role.fixedAllPermissions=true;}
    f.verificationHook=v=>{if(kind==='missing-proof')return undefined;if(kind==='session')v.sessionId='other-session';if(kind==='scope')v.workspaceId='other-space';if(kind==='hash')v.candidateHash='0'.repeat(64);if(kind==='expiry')v.expiresAt=1;
      if(kind==='getter')Object.defineProperty(v,'reference',{enumerable:true,get(){getters++;return 'forged';}});return v;};
    await assert.rejects(()=>f.prepare(),undefined,kind); assert.equal(getters,0);assert.deepEqual(f.state.noticeDrafts,{});assert.equal(f.audits.length,0);
  }
  const f=fixture(api),prepared=await f.prepare();
  for(const kind of ['origin','nonce','target','confirmed','duplicate','get']){
    let body=new URLSearchParams({operationKey:f.input.operationKey,target:JSON.stringify(kind==='target'?workspace:platform),expectedRevision:'1',decision:'approve',nonce:kind==='nonce'?Buffer.alloc(32,7).toString('base64url'):prepared.nonce});
    if(kind==='confirmed')body.set('confirmed','true');if(kind==='duplicate')body.append('nonce',prepared.nonce);
    const request=f.request(f.config.decisionEndpoint,kind==='get'?'GET':'POST',kind==='get'?undefined:body.toString(),'application/x-www-form-urlencoded',kind==='origin'?'https://other.example.invalid':'https://admin.example.invalid');
    await assert.rejects(()=>f.review.decide(request,signal()),undefined,kind);assert.equal(f.audits.length,1);assert.equal(await f.current(),undefined);
  }
});

test('original-key repeats, decision competition and denial keep immutable history and independent owner receipts',async()=>{
  const api=await compiled(),f=fixture(api),p=await f.prepare();assert.equal((await f.prepare()).state,'observed');assert.equal(f.audits.length,1);
  const results=await Promise.all([f.review.decide(f.decision(p.nonce),signal()),f.review.decide(f.decision(p.nonce),signal())]);assert.deepEqual(results[0],results[1]);assert.equal(f.audits.length,2);
  await assert.rejects(()=>f.review.decide(f.decision(p.nonce,'deny'),signal()),e=>e.kind==='conflict');
  const denied=fixture(api),dp=await denied.prepare();assert.equal((await denied.review.decide(denied.decision(dp.nonce,'deny'),signal())).decision,'denied');assert.equal(await denied.current(),undefined);
  const input={...f.input,operationKey:'notice-denied-second',expectedRevision:1,policy:{...f.input.policy,reviewRef:'notice-denied-second',reviewRevision:2}};
  const second=await f.prepare(input);await f.review.decide(f.decision(second.nonce,'deny',input),signal());assert.equal((await f.current()).reference,f.input.operationKey);
  f.verificationHook=()=>undefined;const before=f.verificationReads;assert.equal((await f.receipt()).decision,'approved');assert.equal(f.verificationReads,before);
  f.user.isSaasAdmin=false;await assert.rejects(()=>f.receipt());
});

test('audit/late authority failures roll back; ambiguous prepare/decision commits retain original read-only receipts',async()=>{
  const api=await compiled();
  for(const kind of ['prepare-audit','approve-audit','missing-id','late-authority']){
    const f=fixture(api);if(kind==='prepare-audit')f.failAudit=true;if(kind==='missing-id')f.auditResultHook=()=>({});
    if(kind==='prepare-audit'||kind==='missing-id'){await assert.rejects(()=>f.prepare());assert.deepEqual(f.state.noticeDrafts,{});}else{const p=await f.prepare();if(kind==='approve-audit')f.failAudit=true;else f.afterAudit=()=>{f.user.isSaasAdmin=false;};
      await assert.rejects(()=>f.review.decide(f.decision(p.nonce),signal()));assert.equal(Object.values(f.state.noticeDrafts)[0].state,'pending');assert.deepEqual(f.state.noticePointers,{});}
  }
  for(const stage of ['prepare','decide']){
    const f=fixture(api);let p;if(stage==='decide')p=await f.prepare();f.loseCommit=true;
    await assert.rejects(()=>stage==='prepare'?f.prepare():f.review.decide(f.decision(p.nonce),signal()),e=>e.kind==='unknown');f.loseCommit=false;
    assert.equal((await f.receipt()).decision,stage==='prepare'?'pending':'approved');assert.equal(f.audits.length,stage==='prepare'?1:2);
  }
  const f=fixture(api),p=await f.prepare(),controller=new AbortController();f.cancelCommit=controller;
  await assert.rejects(()=>f.review.decide(f.decision(p.nonce),controller.signal),e=>e.kind==='unknown');f.cancelCommit=undefined;assert.equal((await f.receipt()).decision,'approved');assert.equal(f.audits.length,2);
  f.state.noticePointers[Object.keys(f.state.noticePointers)[0]].reference='missing-original-draft';await assert.rejects(()=>f.current());
});

test('original host control-plane HTTP composition prepares/decides/reads notice review without widening Guard or enabling business', async () => {
  const api = await compiled(), f = fixture(api);
  const config = { enabled: true, requestTimeoutMs: 5000, maxResponseBytes: 65536,
    notice: f.config, client: { prepareEndpoint: 'https://admin.example.invalid/mcp/client-review/prepare', decisionEndpoint: 'https://admin.example.invalid/mcp/client-review/decide',
      receiptEndpoint: 'https://admin.example.invalid/mcp/client-review/receipt', allowedScopes: ['rental.catalog.read'], policyRevision: 1, actionTtlSeconds: 90, maxReviewLifetimeSeconds: 900 } };
  const original = { database: f.database, registrations: f.readonly, policies: { readIn: (...args) => f.store.readIn(...args) } };
  const clientVerification = { current: async (tx, p, registration) => { assert.equal(tx, f.native); return { kind: 'not_required', reference: 'original-client-verification-policy', revision: 1, expiresAt: f.now + 600,
    userId: p.userId, tenantId: p.tenantId, sessionId: p.sessionId, registrationHash: api.publicClientReviewRegistrationHash(registration) }; } };
  const control = createOriginalMcpReviewControlPlane(api, config, f.auth, f.platform, f.logs, original, { client: clientVerification, notice: f.verification });
  const preparedResponse = await control.fetch(f.request(f.config.prepareEndpoint, 'POST', JSON.stringify(f.input), 'application/json'));
  assert.equal(preparedResponse.status, 200); assert.equal(preparedResponse.headers.get('cache-control'), 'no-store'); const prepared = await preparedResponse.json(); assert.equal(prepared.state, 'prepared');
  const decisionResponse = await control.fetch(f.decision(prepared.nonce)); assert.equal(decisionResponse.status, 200); assert.equal((await decisionResponse.json()).decision, 'approved');
  const receiptResponse = await control.fetch(f.request(f.config.receiptEndpoint + '?' + new URLSearchParams({ operationKey: f.input.operationKey, target: JSON.stringify(platform) }), 'GET', undefined));
  assert.equal(receiptResponse.status, 200); assert.equal((await receiptResponse.json()).decision, 'approved'); assert.equal(f.audits.length, 2);
  assert.equal((await control.fetch(f.request(f.config.prepareEndpoint, 'GET', undefined))).status, 405);
  assert.equal((await control.fetch(f.request('https://other.example.invalid/mcp/notice/prepare', 'POST', JSON.stringify(f.input), 'application/json'))).status, 404);
  assert.equal((await control.fetch(f.request(f.config.prepareEndpoint, 'POST', JSON.stringify(f.input), 'application/json', 'https://other.example.invalid'))).status, 403);
  const unready = api.createMcpReviewControlPlane(config); assert.equal((await unready.fetch(f.request(f.config.prepareEndpoint, 'POST', JSON.stringify(f.input), 'application/json'))).status, 503);
  assert.throws(() => api.createMcpReviewControlPlane({ ...config, client: { ...config.client, prepareEndpoint: config.notice.prepareEndpoint } }), /distinct/);
  const close = control.close(); assert.equal(control.close(), close); await close;
  assert.equal((await control.fetch(f.decision(prepared.nonce))).status, 503); assert.equal(f.audits.length, 2); await unready.close();

  const web = fixture(api), governance = { enabled: true, resourceUrl: resource, requestTimeoutMs: 5000, maxResponseBytes: 65536,
    client: { readEndpoint: 'https://admin.example.invalid/mcp/client/read', saveEndpoint: 'https://admin.example.invalid/mcp/client/save', receiptEndpoint: 'https://admin.example.invalid/mcp/client/operation' },
    notice: { readEndpoint: 'https://admin.example.invalid/mcp/notice/read', saveEndpoint: 'https://admin.example.invalid/mcp/notice/save', receiptEndpoint: 'https://admin.example.invalid/mcp/notice/operation' } };
  const governed = createOriginalMcpReviewedGovernanceControlPlane(api, governance, web.auth, web.platform, web.logs, { database: web.database, noticeReview: web.review.source });
  const saveInput = { operationKey: 'web-reviewed-notice-save', expectedRevision: 0, target: web.scope, policy: web.input.policy };
  const post = input => web.request(governance.notice.saveEndpoint, 'POST', JSON.stringify(input), 'application/json');
  assert.equal((await governed.fetch(post(saveInput))).status, 403); assert.deepEqual(web.state.platforms, {});
  const review = await web.prepare(); await web.review.decide(web.decision(review.nonce), signal());
  assert.equal((await governed.fetch(post({ ...saveInput, policy: { ...saveInput.policy, reviewRef: 'forged-review-reference' } }))).status, 403);
  const savedResponse = await governed.fetch(post(saveInput)); assert.equal(savedResponse.status, 200); assert.equal((await savedResponse.json()).policy.reviewRef, web.input.operationKey);
  const readUrl = governance.notice.readEndpoint + '?' + new URLSearchParams({ target: JSON.stringify(web.scope) });
  const readResponse = await governed.fetch(web.request(readUrl, 'GET')); assert.equal(readResponse.status, 200); assert.equal((await readResponse.json()).state, 'configured');
  const receiptUrl = governance.notice.receiptEndpoint + '?' + new URLSearchParams({ target: JSON.stringify(web.scope), operationKey: saveInput.operationKey });
  const governedReceipt = await governed.fetch(web.request(receiptUrl, 'GET')); assert.equal(governedReceipt.status, 200); assert.equal((await governedReceipt.json()).result.policy.revision, 1);
  assert.equal(web.audits.length, 3);
  const closeOnly = createOriginalMcpReviewedGovernanceControlPlane(api, governance, web.auth, web.platform, web.logs, { database: web.database });
  const disabled = { ...saveInput, operationKey: 'web-notice-disable', expectedRevision: 1, policy: { ...saveInput.policy, revision: 2, enabled: false } };
  assert.equal((await closeOnly.fetch(post(disabled))).status, 200);
  const reenabled = { ...disabled, operationKey: 'web-notice-reenable', expectedRevision: 2, policy: { ...disabled.policy, revision: 3, enabled: true } };
  assert.equal((await closeOnly.fetch(post(reenabled))).status, 403); assert.equal(web.audits.length, 4);
  assert.equal((await closeOnly.fetch(web.request(governance.notice.saveEndpoint, 'GET'))).status, 405);
  const unreadyGovernance = api.createMcpReviewedGovernanceControlPlane(governance); assert.equal((await unreadyGovernance.fetch(web.request(readUrl, 'GET'))).status, 503);
  await governed.close(); assert.equal((await governed.fetch(web.request(readUrl, 'GET'))).status, 503); await closeOnly.close(); await unreadyGovernance.close();
});
