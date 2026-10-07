'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { persistedApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-persisted.cjs');
const { PrismaApprovedOrderOriginalInputSource } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order-original-input.source');
const { composePersistedApprovedOrder } = require('../apps/api/src/modules/ai-native/approval-execution/persisted-approved-order.composition');
const { PrismaAiApprovalRepository } = require('../apps/api/src/modules/ai-native/ai-approval-repository');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

async function setup() {
  const h = await persistedApprovedOrderHarness();
  for (const table of ['aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval', 'aiApprovedOrderSnapshot']) h.state.records[table] = [];
  Object.assign(h.state.records.aiStep[0], { inputRef: 'original-input-a', revision: 1 });
  h.state.records.aiTaskActionInput = [{ id: 'original-input-a', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a',
    registrationRef: 'order-a', toolCode: 'rental.order.commit', toolVersion: '1', payload: structuredClone(h.body),
    fingerprint: requestFingerprint(h.body), policyRevision: 1, expiresAt: new Date('2099-01-01') }];
  Object.assign(h.state.records.quote[0], { chargeLines: [], rateSnapshot: [], calendarSnapshot: [], calendarWarnings: [],
    appliedDiscountPlanIds: [], discountEvaluations: [], serviceSnapshots: [], rentalAmount: 123, discountAmount: 0,
    couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, receivableAmount: 123 });
  Object.assign(h.dependencies.db, h.client(null, false));
  const inputSource = new PrismaApprovedOrderOriginalInputSource(h.policy(), '1', h.dependencies.clock);
  const compose = () => composePersistedApprovedOrder({ ...h.dependencies, ...h.policyDependencies, inputSource });
  const command = { taskId: 'task-a', proposalId: 'proposal-a', proposalRevision: 1, actionId: 'action-a',
    expiresAt: h.payload.expiresAt, lease: h.command.lease };
  return { ...h, compose, prepareCommand: command };
}

for (const [label, change] of [
  ['payload changed', records => { records.aiTaskActionInput[0].payload.customerName = 'changed'; }],
  ['input deleted', records => { records.aiTaskActionInput = []; }],
  ['input expired', records => { records.aiTaskActionInput[0].expiresAt = new Date('2000-01-01'); }],
  ['step input reference removed', records => { records.aiStep[0].inputRef = null; }],
  ['step replaced with identical body', records => { records.aiStep[0].id = 'replacement-step'; }],
  ['step revision changed', records => { records.aiStep[0].revision++; }],
  ['step rebound to identical input', records => {
    records.aiTaskActionInput.push({ ...structuredClone(records.aiTaskActionInput[0]), id: 'replacement-input' });
    records.aiStep[0].inputRef = 'replacement-input';
  }]
]) test(`preparation rejects ${label} after snapshot staging`, async () => {
  const h = await setup(); let injected = false;
  h.state.onOperation = ({ model, op, records, inTransaction }) => {
    if (!injected && inTransaction && model === 'aiApprovedOrderSnapshot' && op === 'create') {
      injected = true; change(records);
    }
  };
  await assert.rejects(h.compose().prepare(h.prepareCommand), e => ['AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  assert.equal(injected, true);
  for (const table of ['aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApprovedOrderSnapshot', 'aiApproval', 'aiApprovalConsumption', 'rentalOrder']) {
    assert.equal(h.state.records[table].length, 0, table);
  }
});

test('stored original input drives preparation, approval and one Core commit across lost response and source removal', async () => {
  const h = await setup(), root = h.compose(), pending = await root.prepare(h.prepareCommand);
  const original = h.state.records.aiTaskActionInput[0], input = h.state.records.aiApprovedOrderSnapshot.find(row => row.kind === 'INPUT');
  assert.equal(input.contentHash, original.fingerprint);
  assert.deepEqual(input.payload, original.payload);
  assert.equal(h.state.records.aiStep[0].inputRef, original.id);
  assert.equal(h.state.records.aiApproval.length, 0);
  const payload = h.state.records.aiProposalVersion[0].payload;
  const approved = await new PrismaAiApprovalRepository(h.dependencies.db).decide({ scopeId: 'scope-a', taskId: 'task-a',
    proposalId: 'proposal-a', proposalRevision: 1, payload, reviewedPayloadHash: pending.reviewedPayloadHash, decision: 'approved' },
  { scopeId: 'scope-a', actorKind: 'user', actorId: 'operator-a', audience: 'operator' });
  const command = { ...h.command, approvalId: approved.approvalId, reviewedPayloadHash: pending.reviewedPayloadHash };
  h.state.ackLost = true;
  await assert.rejects(root.submit(command), e => e.code === 'AI_RESULT_UNKNOWN' && e.nextAction === 'reconcile' && e.retryable === false);
  h.state.ackLost = false;
  h.state.records.aiTaskActionInput = [];
  h.state.records.rentalOrderIdempotencyRecord = [];
  h.state.records.quote[0].request = { unrelated: true };
  h.state.records.aiBudgetPolicy = [];
  const result = await h.compose().reconcile(command);
  assert.equal(result.replayed, true);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption[0].status, 'COMMITTED');
  assert.equal(h.state.records.aiApprovalConsumption[0].resultRef, result.order.id);
  assert.equal(h.state.prepares, 1);
});
