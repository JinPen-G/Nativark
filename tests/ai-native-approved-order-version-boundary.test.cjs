'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { persistedApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-persisted.cjs');
const { AiProposalRepository } = require('../apps/api/src/modules/ai-native/ai-proposal-repository');
const { PrismaAiApprovalRepository } = require('../apps/api/src/modules/ai-native/ai-approval-repository');
const { PrismaApprovedOrderSnapshotSource } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order-snapshot.source');
const { composeAiApprovedOrder } = require('../apps/api/src/modules/ai-native/approval-execution/approved-order.composition');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

async function setup(change = () => {}) {
  const h = await persistedApprovedOrderHarness();
  for (const table of ['aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval']) h.state.records[table] = [];
  change(h);
  h.payload.actions[0].preview.contentHash = requestFingerprint(h.state.snapshots.preview.payload);
  h.state.snapshots.preview.contentHash = h.payload.actions[0].preview.contentHash;
  h.state.records.aiApprovedOrderSnapshot = ['INPUT', 'PREVIEW'].map(kind => ({
    ...h.state.snapshots[kind === 'INPUT' ? 'input' : 'preview'], kind,
    proposalId: 'proposal-a', proposalRevision: 1, actionFingerprint: requestFingerprint(h.body),
    actorKind: 'USER', actorId: 'operator-a', audience: 'OPERATOR'
  }));
  Object.assign(h.dependencies.db, h.client(null, false));
  await new AiProposalRepository(h.dependencies.db).createPending({ scopeId: 'scope-a', taskId: 'task-a', payload: h.payload,
    actions: h.payload.actions.map(action => ({ actionId: action.actionId, requestFingerprint: action.input.contentHash })) });
  const reviewedPayloadHash = h.state.records.aiProposalVersion[0].payloadHash;
  const approval = await new PrismaAiApprovalRepository(h.dependencies.db).decide({ scopeId: 'scope-a', taskId: 'task-a',
    proposalId: 'proposal-a', proposalRevision: 1, payload: h.payload, reviewedPayloadHash, decision: 'approved' },
  { scopeId: 'scope-a', actorKind: 'user', actorId: 'operator-a', audience: 'operator' });
  const command = { ...h.command, reviewedPayloadHash, approvalId: approval.approvalId };
  const root = composeAiApprovedOrder({ ...h.dependencies, policy: h.policy(),
    snapshots: new PrismaApprovedOrderSnapshotSource(h.dependencies.db, h.policy()) });
  return { ...h, root, command };
}
const noEffect = h => {
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.aiApprovalConsumption.length, 0);
};
const rejected = e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT', 'AI_RESULT_UNKNOWN'].includes(e.code);

test('matching approved target version executes the stored snapshot only once', async () => {
  const h = await setup();
  assert.equal((await h.root.submit(h.command)).replayed, false);
  assert.equal((await h.root.submit(h.command)).replayed, true);
  h.state.records.quote[0].pricingPlanVersion = 'changed-after-commit';
  assert.equal((await h.root.reconcile(h.command)).replayed, true);
  assert.equal(h.state.records.rentalOrder.length, 1);
});

for (const [label, change] of [
  ['target version differs', h => { h.payload.actions[0].target.version = 'other-version'; }],
  ['preview version missing', h => {
    delete h.state.snapshots.preview.payload.pricingPlanVersion;
    delete h.state.records.quote[0].pricingPlanVersion;
  }],
  ['preview version empty', h => {
    h.state.snapshots.preview.payload.pricingPlanVersion = '';
    h.state.records.quote[0].pricingPlanVersion = '';
  }]
]) test(`validly hashed and explicitly approved proposal rejects ${label}`, async () => {
  const h = await setup(change);
  await assert.rejects(h.root.submit(h.command), rejected);
  assert.equal(h.state.prepares, 0);
  noEffect(h);
});

for (const field of ['pricingPlanVersion', 'ruleVersion', 'payableAmount']) test(`live quote ${field} change cannot silently alter an approved snapshot`, async () => {
  const h = await setup();
  h.state.records.quote[0][field] = field === 'payableAmount' ? 456 : 'new-version';
  await assert.rejects(h.root.submit(h.command), rejected);
  noEffect(h);
});

for (const count of [1, 2]) test(`ordered_partial with ${count} action(s) remains unsupported before any Core effect`, async () => {
  const h = await setup(h => {
    h.payload.atomicity = 'ordered_partial';
    if (count === 2) {
      h.payload.actions.push({ ...structuredClone(h.payload.actions[0]), actionId: 'action-b' });
      h.state.records.aiStep.push({ ...structuredClone(h.state.records.aiStep[0]), id: 'step-b', actionId: 'action-b' });
    }
  });
  await assert.rejects(h.root.submit(h.command), rejected);
  noEffect(h);
});
