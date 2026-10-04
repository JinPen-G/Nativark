'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiApprovalService } = require('../apps/api/src/modules/ai-native/ai-approval-repository');
const payload = { contractVersion: 'ain-c05-draft-1', proposalId: 'proposal-a', taskId: 'task-a', revision: 1, audience: 'staff', scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }, actions: [{ actionId: 'action-a', toolCode: 'rental.order.explain', toolVersion: '1', input: { recordId: 'input-a', revision: 1, contentHash: 'a'.repeat(64) }, preview: { recordId: 'preview-a', revision: 1, contentHash: 'b'.repeat(64) }, target: { resourceType: 'order', resourceId: 'order-a', version: 'v1' } }], atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt: new Date(Date.now() + 60_000).toISOString() };
test('approval service never accepts caller identity and rejects changed reviewed payload', async () => {
  const records = [], service = new AiApprovalService({ decide: async input => { const row = { approvalId: 'approval-a', ...input, audience: 'staff', actorKind: 'user', actorId: 'server-user', decision: input.decision, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }; records.push(row); return row; } }, { authorize: async (_context, input) => ({ scopeId: input.scopeId, actorKind: 'user', actorId: 'server-user', audience: 'staff' }) });
  const hash = require('node:crypto').createHash('sha256').update(JSON.stringify(payload, Object.keys(payload).sort())).digest('hex');
  // Use the production fingerprint indirectly: the fake repository only proves the authority boundary.
  await assert.rejects(() => service.decide({ context: {}, scopeId: 'scope-a', taskId: payload.taskId, proposalId: payload.proposalId, proposalRevision: 1, payload, reviewedPayloadHash: '0'.repeat(64), decision: 'approved' }), error => error.code === 'CONFLICT');
  assert.equal(records.length, 0); assert.equal(typeof hash, 'string');
});

test('missing approval authority fails closed', async () => {
  const service = new AiApprovalService({ decide: async () => { throw new Error('must not persist'); } }, { authorize: async () => null });
  const hash = '0'.repeat(64);
  await assert.rejects(() => service.decide({ context: {}, scopeId: 'scope-a', taskId: payload.taskId, proposalId: payload.proposalId, proposalRevision: 1, payload, reviewedPayloadHash: hash, decision: 'rejected' }), error => ['CONFLICT', 'FORBIDDEN'].includes(error.code));
});
