'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiProposalRepository } = require('../apps/api/src/modules/ai-native/ai-proposal-repository');

const payload = { contractVersion: 'ain-c05-draft-1', proposalId: 'proposal-r', taskId: 'task-r', revision: 1, audience: 'staff', scope: { kind: 'workspace', tenantId: 'tenant-r', workspaceId: 'workspace-r' }, actions: [{ actionId: 'action-r', toolCode: 'rental.order.explain', toolVersion: '1', input: { recordId: 'input-r', revision: 1, contentHash: 'a'.repeat(64) }, preview: { recordId: 'preview-r', revision: 1, contentHash: 'b'.repeat(64) }, target: { resourceType: 'order', resourceId: 'order-r', version: 'v1' } }], atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt: new Date(Date.now() + 60_000).toISOString() };

function dbHarness() {
  const proposals = new Map(), versions = new Map(), actions = new Map(), steps = new Set(['scope-r:task-r:action-r:' + 'c'.repeat(64)]);
  const tx = { aiProposal: { findFirst: async ({ where }) => { const p = proposals.get(`${where.scopeId}:${where.taskId}:${where.id}`); if (!p) return null; return { ...p, currentVersion: p.currentRevision ? { payloadHash: versions.get(`${where.scopeId}:${where.taskId}:${where.id}:${p.currentRevision}`).payloadHash } : null }; }, create: async ({ data }) => { proposals.set(`${data.scopeId}:${data.taskId}:${data.id}`, data); return data; } }, aiProposalVersion: { findFirst: async ({ where }) => versions.get(`${where.scopeId}:${where.taskId}:${where.proposalId}:${where.revision}`) ?? null, create: async ({ data }) => { versions.set(`${data.scopeId}:${data.taskId}:${data.proposalId}:${data.revision}`, data); return data; } }, aiStep: { findFirst: async ({ where }) => steps.has(`${where.scopeId}:${where.taskId}:${where.actionId}:${where.requestFingerprint}`) ? { actionId: where.actionId } : null }, aiProposalAction: { create: async ({ data }) => { actions.set(`${data.scopeId}:${data.proposalId}:${data.actionId}`, data); return data; } } };
  const transactional = async fn => { const p = new Map(proposals), v = new Map(versions), a = new Map(actions); try { return await fn(tx); } catch (error) { proposals.clear(); p.forEach((value, key) => proposals.set(key, value)); versions.clear(); v.forEach((value, key) => versions.set(key, value)); actions.clear(); a.forEach((value, key) => actions.set(key, value)); throw error; } };
  return { repo: new AiProposalRepository({ $transaction: transactional, ...tx }), proposals, versions, actions };
}

test('proposal repository persists immutable version and action references atomically', async () => {
  const h = dbHarness(), result = await h.repo.createPending({ scopeId: 'scope-r', taskId: 'task-r', payload, actions: [{ actionId: 'action-r', requestFingerprint: 'c'.repeat(64) }] });
  assert.equal(result.status, 'PENDING_CONFIRMATION'); assert.equal(result.currentRevision, null); assert.equal(h.versions.size, 1); assert.equal(h.actions.size, 1);
  assert.deepEqual(await h.repo.createPending({ scopeId: 'scope-r', taskId: 'task-r', payload, actions: [{ actionId: 'action-r', requestFingerprint: 'c'.repeat(64) }] }), result);
});

test('proposal action must already bind to an existing step', async () => {
  const h = dbHarness();
  await assert.rejects(() => h.repo.createPending({ scopeId: 'scope-r', taskId: 'task-r', payload, actions: [{ actionId: 'action-r', requestFingerprint: 'd'.repeat(64) }] }), error => error.code === 'INVALID');
  assert.equal(h.proposals.size, 0);
});
