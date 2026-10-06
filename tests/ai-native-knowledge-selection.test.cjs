'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true } });
const { dbFactory } = require('./fixtures/ai-native/knowledge-persistent-content.cjs');
const { composePersistedKnowledge } = require('../apps/api/src/modules/ai-native/knowledge/persistent-knowledge.composition');
const scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'space-a' };
const context = { actor: { kind: 'user', userId: 'user-a' }, audience: 'operator', scope, requestId: 'req-a', contractVersion: 'test', authorizedAt: '2026-10-06T00:00:00Z' };
async function setup() {
  const db = dbFactory(), queries = [], state = { denied: new Set(), revoked: false, hook: null };
  db.aiKnowledgeDocument.findMany = async q => {
    queries.push(structuredClone(q));
    const rows = [...db.state.documents.values()].filter(r => Object.entries(q.where).every(([k,v]) => r[k] === v)).sort((a,b) => a.id.localeCompare(b.id)).slice(0,q.take);
    return rows.map(r => Object.fromEntries(Object.keys(q.select).map(k => [k,r[k]])));
  };
  const authorization = { async authorize(c, req) {
    if (state.hook) await state.hook(req);
    if (state.revoked || c.actor.userId !== 'user-a' || JSON.stringify(c.scope) !== JSON.stringify(scope) || state.denied.has(req.document?.documentId)) return null;
    return { scope: structuredClone(scope), actor: { actorKind: 'user', actorId: 'user-a' }, audience: 'operator', accessKey: 'synthetic-grant' };
  } };
  const bundle = composePersistedKnowledge({ db, authorization, memoryAuthorization: authorization,
    files: { read: async () => ({ mediaType: 'text/plain', bytes: new TextEncoder().encode('Synthetic camping guide') }) },
    clock: { now: () => Date.parse('2026-10-06T00:00:00Z') },
    gateway: { invoke: async () => { throw Error('not allowed'); }, stream: async function* () { throw Error('not allowed'); } },
    cache: { maxEntries: 10, maxBytes: 20000, ttlMs: 1000 }, policy: { sceneCode: 'knowledge', maxOutputTokens: 100 } });
  async function seed(id) {
    let head = await bundle.documents.create(context, { documentId: id, documentVersion: 'v1', attachmentId: `attachment-${id}`, title: 'Synthetic guide', validFrom: '2026-10-01T00:00:00Z', operationId: `create-${id}` });
    head = await bundle.documents.parseDocument(context, { documentId: id, expectedRevision: head.revision, operationId: `parse-${id}` });
    await bundle.index.request(context, { documentId: id, expectedRevision: head.revision, operationId: `index-${id}`, kind: 'upsert' });
    head = await bundle.index.runPending(context,id);
    await bundle.publication.publish(context, { documentId: id, expectedRevision: head.revision, operationId: `publish-${id}` });
  }
  return { db, queries, state, bundle, seed, authorization };
}
const recall = (s,c=context) => s.bundle.retrieval.recall(c,{ requestId: 'query-a', query: 'camping', limit: 5 });
test('default persistent selector drives real publication, repository and lexical recall', async () => {
  const s = await setup(); await s.seed('doc-a');
  assert.equal((await recall(s)).status,'ready');
  assert.deepEqual(s.queries[0].where,{ tenantId: 'tenant-a', workspaceId: 'space-a', status: 'published' });
  assert.equal(s.queries[0].take,101); assert.deepEqual(s.queries[0].select,{ id:true,tenantId:true,workspaceId:true,status:true });
});
test('denied document never reaches body query while permitted document remains searchable', async () => {
  const s = await setup(); await s.seed('doc-a'); await s.seed('doc-b'); s.state.denied.add('doc-a');
  s.db.queries.length=0;
  const result = await recall(s); assert.equal(result.status,'ready'); assert.equal(result.matches.length,1);
  assert.equal(result.matches[0].source.documentId,'doc-b');
  assert.ok(s.db.queries.every(q => q.where.version.documentId === 'doc-b'));
});
test('missing workspace and revoked identity read no candidate metadata or bodies', async () => {
  const s = await setup(); await s.seed('doc-a'); s.db.queries.length=0;
  assert.equal((await recall(s,{...context,scope:{kind:'tenant',tenantId:'tenant-a'}})).status,'unavailable');
  s.state.revoked=true; assert.equal((await recall(s)).status,'unavailable');
  assert.equal(s.queries.length,0); assert.equal(s.db.queries.length,0);
});
test('wrong-scope metadata, duplicates and overflow fail closed before body reads', async () => {
  for (const variant of ['scope','duplicate','overflow']) {
    const s=await setup(); await s.seed('doc-a'); s.db.queries.length=0;
    const row={id:'doc-a',tenantId:'tenant-a',workspaceId:'space-a',status:'published'};
    s.db.aiKnowledgeDocument.findMany=async()=>variant==='scope'?[{...row,tenantId:'other'}]:Array.from({length:variant==='overflow'?101:2},()=>row);
    assert.equal((await recall(s)).status,'unavailable'); assert.equal(s.db.queries.length,0);
  }
});
test('withdrawal during candidate authorization cannot reach the body reader', async () => {
  const s=await setup(); await s.seed('doc-a'); s.db.queries.length=0;
  s.state.hook=async req=> { if(req.document) { const r=s.db.state.documents.get('doc-a'); r.status='withdrawn'; r.withdrawnAt=new Date('2026-10-06'); r.state.document.publication='withdrawn'; } };
  assert.notEqual((await recall(s)).status,'ready'); assert.equal(s.db.queries.length,0);
});
test('caller mutation during metadata await invalidates the selection rather than changing scope', async () => {
  const s=await setup(); await s.seed('doc-a'); s.db.queries.length=0;
  const c=structuredClone(context), original=s.db.aiKnowledgeDocument.findMany;
  s.db.aiKnowledgeDocument.findMany=async q=>{const rows=await original(q);c.actor.userId='other';return rows;};
  assert.equal((await recall(s,c)).status,'unavailable'); assert.equal(s.db.queries.length,0);
});
test('grant revision change and forged document grant fail closed before body reads', async () => {
  for (const change of ['revision','actor','scope','audience']) {
    const s=await setup(); await s.seed('doc-a'); s.db.queries.length=0;
    const original=s.authorization.authorize;
    s.authorization.authorize=async(c,req)=> {
      const g=await original(c,req); if (!req.document) return g;
      return change==='revision'?{...g,accessKey:'new-grant'}:change==='actor'?{...g,actor:{actorKind:'user',actorId:'other'}}:change==='scope'?{...g,scope:{...scope,workspaceId:'other'}}:{...g,audience:'client'};
    };
    assert.equal((await recall(s)).status,'unavailable'); assert.equal(s.db.queries.length,0);
  }
});
test('metadata database failure is unavailable, not successful empty recall', async () => {
  const s=await setup(); s.db.aiKnowledgeDocument.findMany=async()=>{throw Error('synthetic read failure');};
  assert.equal((await recall(s)).status,'unavailable'); assert.equal(s.db.queries.length,0);
});
test('withdrawn cached source cannot be revived by default selection', async () => {
  const s=await setup(); await s.seed('doc-a'); const found=await recall(s);
  assert.equal(found.status,'ready'); const source=found.matches[0].source;
  await s.bundle.sources.readChunk(context,source);
  const row=s.db.state.documents.get('doc-a');
  await s.bundle.publication.withdraw(context,{documentId:'doc-a',expectedRevision:row.revision,operationId:'withdraw-a'});
  assert.notEqual((await recall(s)).status,'ready');
  await assert.rejects(s.bundle.sources.readChunk(context,source),e=>e.code==='unavailable');
});
test('published but unindexed or failed candidates retain actual retrieval readiness semantics', async () => {
  for (const indexing of ['not_indexed','failed']) {
    const s=await setup(); await s.seed('doc-a'); s.db.queries.length=0;
    s.db.state.documents.get('doc-a').state.document.indexing=indexing;
    const result=await recall(s);
    assert.equal(result.status,indexing==='failed'?'failed':'not_ready');
    assert.equal(s.db.queries.length,0);
  }
});
