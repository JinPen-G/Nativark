'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { FileStorageKnowledgeFileAdapter } = require('../apps/api/src/modules/ai-native/knowledge/file-storage-knowledge.adapter.ts');

test('knowledge file adapter requires workspace context and does not expose URLs', async () => {
  const calls = [];
  const adapter = new FileStorageKnowledgeFileAdapter({ readKnowledgeBytes: async (...args) => { calls.push(args); throw Object.assign(new Error('no persistent source'), { code: 'unavailable' }); } });
  const document = { documentId: 'doc-1', attachmentId: 'file-1' };
  await assert.rejects(() => adapter.read({ scope: { kind: 'tenant', tenantId: 't-1' }, actor: { kind: 'user', userId: 'u-1' } }, document, 1024), { code: 'unavailable' });
  await assert.rejects(() => adapter.read({ scope: { kind: 'workspace', tenantId: 't-1', workspaceId: 'w-1' }, actor: { kind: 'user', userId: 'u-1' } }, document, 1024), { code: 'unavailable' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].businessType, 'ai_knowledge_document');
  assert.equal(calls[0][2].uploadScene, 'ai-knowledge');
  assert.equal('url' in calls[0][2], false);
});
