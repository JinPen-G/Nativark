'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiApprovalService, PrismaAiApprovalRepository } = require('../apps/api/src/modules/ai-native/ai-approval-repository');
const { fingerprintAiProposalDraft } = require('../apps/api/src/modules/ai-native/proposal-binding-draft');

function request() {
  const payload = { contractVersion: 'ain-c05-draft-1', proposalId: 'proposal-a', taskId: 'task-a', revision: 1, audience: 'staff', scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }, actions: [{ actionId: 'action-a', toolCode: 'rental.order.explain', toolVersion: '1', input: { recordId: 'input-a', revision: 1, contentHash: 'a'.repeat(64) }, preview: { recordId: 'preview-a', revision: 1, contentHash: 'b'.repeat(64) }, target: { resourceType: 'order', resourceId: 'order-a', version: 'v1' } }], atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt: '2099-01-01T00:00:00.000Z' };
  return { context: {}, scopeId: 'scope-a', taskId: 'task-a', proposalId: 'proposal-a', proposalRevision: 1, payload, reviewedPayloadHash: fingerprintAiProposalDraft(payload), decision: 'rejected' };
}

test('a rejection cannot turn into approval while authority is awaited', async () => {
  const input = request(); let release, reached;
  const ready = new Promise(resolve => { reached = resolve; });
  let saved;
  const service = new AiApprovalService({ decide: async value => { saved = structuredClone(value); return saved; } },
    { authorize: () => { reached(); return new Promise(resolve => { release = resolve; }); } });
  const pending = service.decide(input); await ready;
  input.decision = 'approved'; input.payload.actions[0].target.resourceId = 'different-order';
  release({ scopeId: 'scope-a', actorKind: 'user', actorId: 'server-user', audience: 'staff' });
  await pending; assert.equal(saved.decision, 'rejected'); assert.equal(saved.payload.actions[0].target.resourceId, 'order-a');
  assert.equal(fingerprintAiProposalDraft(saved.payload), saved.reviewedPayloadHash);
});

for (const decision of ['approved', 'rejected']) test(`actual approval repository replays its own ${decision} decision`, async () => {
  const req = request(); req.decision = decision;
  const { context, ...command } = req;
  let row = null, writes = 0;
  const head = { status: 'PENDING_CONFIRMATION', currentRevision: null, stateRevision: 1 };
  const tx = {
    aiProposal: { findFirst: async () => structuredClone(head), updateMany: async args => { assert.equal(head.status, args.where.status); Object.assign(head, { ...args.data, stateRevision: head.stateRevision + 1 }); return { count: 1 }; } },
    aiProposalVersion: { findFirst: async () => ({ payloadHash: req.reviewedPayloadHash, expiresAt: new Date(req.payload.expiresAt) }) },
    aiApproval: { findFirst: async () => structuredClone(row), create: async args => { writes++; row = structuredClone(args.data); return structuredClone(row); } }
  };
  const repository = new PrismaAiApprovalRepository({ $transaction: callback => callback(tx) });
  const principal = { scopeId: 'scope-a', actorKind: 'user', actorId: 'server-user', audience: 'staff' };
  const first = await repository.decide(command, principal);
  assert.deepEqual(await repository.decide(command, principal), first); assert.equal(writes, 1);
  const original = structuredClone(row);
  // A matching payload/decision is not the same original approval receipt.
  for (const [field, value] of [['taskId', 'other-task'], ['audience', 'OPERATOR'],
    ['expiresAt', new Date(Date.parse(req.payload.expiresAt) - 1000)],
    ['issuedAt', new Date('2100-01-01T00:00:00.000Z')]]) {
    row = { ...structuredClone(original), [field]: value };
    await assert.rejects(repository.decide(command, principal), error => error.code === 'CONFLICT');
    assert.equal(writes, 1, 'inconsistent receipt must not cause another approval');
    assert.equal(row[field] instanceof Date ? row[field].toISOString() : row[field], value instanceof Date ? value.toISOString() : value);
  }
  row = original;
  assert.deepEqual(await repository.decide(command, principal), first);
  const readVersion = tx.aiProposalVersion.findFirst;
  tx.aiProposalVersion.findFirst = async () => ({ ...await readVersion(), expiresAt: new Date(Date.parse(req.payload.expiresAt) - 1000) });
  await assert.rejects(repository.decide(command, principal), error => error.code === 'CONFLICT');
  assert.equal(writes, 1);
  tx.aiProposalVersion.findFirst = readVersion;
  await assert.rejects(repository.decide({ ...command, decision: decision === 'approved' ? 'rejected' : 'approved' }, principal), error => error.code === 'CONFLICT');
});
