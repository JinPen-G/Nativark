const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { KnowledgeCitationSession } = require('../apps/api/src/modules/ai-native/knowledge/knowledge-citation-session.ts');

const source = (id, version = 'v1') => ({ kind: 'document', documentId: 'doc-1', documentVersion: version,
  chunkId: 'chunk-1', scope: { kind: 'workspace', tenantId: 't-1', workspaceId: 'w-1' }, aclRevision: 1,
  locator: { kind: 'page', page: 1, paragraph: 1 } });
const hash = (value) => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
const entry = (text) => ({ sourceId: hash(source('x')), source: source('x'),
  document: source('x'), chunkId: 'chunk-1', truncated: false, contentFingerprint: hash(text) });

test('safe citation opening bounds the batch and hides denied source details', async () => {
  const text = '受权片段';
  const e = entry(text);
  const session = new KnowledgeCitationSession({ observationId: 'obs', requestId: 'req', queryFingerprint: 'q', observedAt: new Date().toISOString(), trust: 'untrusted_data', purpose: 'context_only', status: 'ready', sources: [e] }, {
    check: async () => {}, verify: async () => {}, read: async () => ({ ...source('x'), text, trust: 'untrusted_data', draftVersion: 'v1', documentId: 'doc-1', documentVersion: 'v1', scope: source('x').scope, aclRevision: 1, locator: source('x').locator, chunkId: 'chunk-1' }), recollect: async () => session,
  });
  const result = await session.openManySafe({ sourceIds: [e.sourceId, 'a'.repeat(64)], maxSnippetChars: 20, maxTotalBytes: 4096 });
  assert.equal(result.status, 'complete');
  assert.equal(result.items[0].status, 'available');
  assert.equal(result.items[1].status, 'unavailable');
  assert.equal('title' in result.items[1], false);
});
