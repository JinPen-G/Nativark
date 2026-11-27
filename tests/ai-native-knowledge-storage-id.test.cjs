'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const { createControllerSourceLoader } = require('../scripts/controller-sources.cjs');
const loader = createControllerSourceLoader(require('node:path').resolve(__dirname, '..'));
const contracts = loader.load(loader.resolveSource(__filename, '@rental-os/platform-contracts', true));
const { AI_KNOWLEDGE_DRAFT_VERSION } = contracts;
const { AiKnowledgeDocumentDraft: validDocument } = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(
  { AiKnowledgeDocumentDraft: contracts.AI_KNOWLEDGE_DRAFT_SCHEMAS.AiKnowledgeDocumentDraft }, loader.load(loader.resolveSource(__filename, '@rental-os/platform-contracts/ai-gateway', true)).AI_EXECUTION_CONTEXT_SCHEMAS);
const PrismaKnowledgeRepository = require('./fixtures/ai-native/knowledge-persistent-content.cjs').publicDocumentHarness().repo.constructor;
const scope = { kind: 'workspace', tenantId: 'synthetic_tenant', workspaceId: 'synthetic_workspace' };
function fixture(length) {
  const documentId = 'd'.repeat(length), document = { draftVersion: AI_KNOWLEDGE_DRAFT_VERSION, documentId,
    documentVersion: 'v1', attachmentId: 'synthetic_attachment', owner: { actorKind: 'user', actorId: 'synthetic_actor' },
    scope, aclRevision: 1, title: 'Synthetic storage boundary', publication: 'draft', parsing: 'pending', indexing: 'not_indexed',
    validFrom: '2026-11-04T00:00:00.000Z' };
  const next = { document, revision: 1 };
  let transactions = 0;
  const db = { aiKnowledgeDocument: {}, aiKnowledgeVersion: {}, aiKnowledgeChunk: {}, aiKnowledgeOperation: {}, aiDataErasure: {},
    async $transaction() { transactions++; throw Error('No synthetic database success supplied'); } };
  return { next, command: { scope, documentId, expectedRevision: 0, next, newVersion: true,
    operation: { id: 'synthetic_operation', fingerprint: 'a'.repeat(64) } }, repository: new PrismaKnowledgeRepository(db), count: () => transactions };
}
test('37-character generic reference remains valid but unsupported persisted write is rejected before transaction', async () => {
  const f = fixture(37); assert.equal(validDocument(f.next.document), true);
  await assert.rejects(() => f.repository.commit(f.command), error => error.code === 'invalid_input');
  assert.equal(f.count(), 0); assert.equal(f.command.documentId.length, 37);
  assert.equal(f.command.next.document.documentId, f.command.documentId);
});
test('36-character persisted ID reaches storage without changing the identity or inventing success', async () => {
  const f = fixture(36); assert.equal(validDocument(f.next.document), true);
  await assert.rejects(() => f.repository.commit(f.command), error => error.code === 'unavailable');
  assert.equal(f.count(), 1); assert.equal(f.command.documentId.length, 36);
});
