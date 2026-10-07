'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { composeFormalPersistedHumanKnowledge } = h.load('persistent-knowledge.composition');

test('formal opt-in composition wires current Auth, policy sources and bounded file runtime', async () => {
  const { ports, identity, db } = fixture();
  const policy = async (_context, request, resource) => ({ action: request.action, scope: request.scope, audience: 'operator', actor: { actorKind: 'user', actorId: 'user-1' }, revision: 1, expiresAt: new Date(h.now + 3600000).toISOString(), requiredPermissions: ['synthetic-policy'], grantKey: 'formal-policy-1', ...(resource ? { resource } : {}) });
  const bundle = composeFormalPersistedHumanKnowledge({ ...ports, knowledgePolicy: { resolve: policy }, fileRuntime: { assertKnowledgeBinding: async () => {}, readKnowledgeBytes: async () => ({ mediaType: 'text/plain', bytes: Buffer.from('formal bounded source') }) }, memory: { db, policy: { resolve: async () => null } } });
  const prepared = await bundle.management.prepareCreate(h.draft());
  assert.equal(prepared.status, 'ready_to_create');
  const created = await bundle.management.create(h.draft());
  assert.equal(created.documentId, 'doc-1');
  const parsed = await bundle.management.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-formal-1' });
  assert.equal(parsed.parsing, 'parsed');
  assert.equal(bundle.preparation.constructor.name, 'HumanKnowledgeInputService');
  assert.equal(identity.credentials.current !== undefined, true);
});
