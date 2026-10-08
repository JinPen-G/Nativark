'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { controlledApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-controlled.cjs');
const { composeControlledApprovedOrder } = require('../apps/api/src/modules/ai-native/approval-execution/controlled-approved-order.composition');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const unavailable = e => ['AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code);

// One focused smoke file; no worker, real DB, HTTP, model or payment services.
test('formal publication through explicit approval commits once and historical reconcile bypasses expired execution proof', async () => {
  const h = await controlledApprovedOrderHarness(), records = h.state.records;
  assert.equal(records.aiTaskActionInput[0].id, h.published.id);
  assert.equal(records.aiStep[0].inputRef, h.published.id);
  assert.equal(records.aiTaskRunPlan.length, 1);
  const snapshot = records.aiApprovedOrderSnapshot.find(row => row.kind === 'INPUT');
  assert.deepEqual(snapshot.payload, records.aiTaskActionInput[0].payload);
  assert.equal(snapshot.contentHash, requestFingerprint(h.body));
  const command = await h.approve();
  assert.equal(h.state.records.aiApproval[0].decision, 'APPROVED');
  h.state.ackLost = true;
  await assert.rejects(h.root.submit(command), e => e.code === 'AI_RESULT_UNKNOWN' && e.retryable === false && e.nextAction === 'reconcile');
  h.state.ackLost = false;
  assert.equal(h.state.records.rentalOrder.length, 1);
  const original = h.state.records.aiTaskActionInput[0];
  original.expiresAt = new Date('2000-01-01');
  h.state.records.aiTaskPlanPolicy[0].enabled = false;
  h.state.records.aiBudgetPolicy = [];
  h.state.records.rentalOrderIdempotencyRecord = [];
  h.state.records.aiStep[0].status = 'SUCCEEDED';
  const recovered = await h.compose().reconcile(command);
  assert.equal(recovered.replayed, true);
  assert.equal((await h.compose().submit(command)).replayed, true);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption[0].resultRef, recovered.order.id);
  assert.equal(h.state.records.aiApprovalConsumption[0].status, 'COMMITTED');
  assert.equal(h.state.prepares, 1);
  assert.equal(h.state.commits, 1);
});

test('approved but uncommitted action cannot adopt a new formal policy revision', async () => {
  const h = await controlledApprovedOrderHarness(), command = await h.approve();
  await h.root.policy.put({ expectedRevision: 1, enabled: true, limits: h.state.records.aiTaskPlanPolicy[0].limits,
    expiresAt: '2099-01-01T00:00:00Z' });
  assert.equal(h.state.records.aiTaskPlanPolicy[0].revision, 2);
  await assert.rejects(h.root.submit(command), unavailable);
  assert.equal(h.state.prepares, 0);
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});

for (const [label, change] of [
  ['original policy changed', records => { records.aiTaskPlanPolicy[0].revision++; }],
  ['original step input removed', records => { records.aiStep[0].inputRef = null; }]
]) test(`Core commit-point proof rejects ${label} and rolls back the single action`, async () => {
  const h = await controlledApprovedOrderHarness(), command = await h.approve(); let injected = false;
  h.state.onOperation = ({ model, op, records, inTransaction }) => {
    if (!injected && inTransaction && model === 'rentalOrder' && op === 'create') { injected = true; change(records); }
  };
  await assert.rejects(h.root.submit(command), e => e.code === 'AI_RESULT_UNKNOWN' && e.retryable === false);
  assert.equal(injected, true);
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.rentalOrderIdempotencyRecord.length, 0);
  assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});

test('human review returns original snapshots, not a later quote or generated text', async () => {
  const h = await controlledApprovedOrderHarness();
  h.state.records.quote[0].payableAmount = 999;
  const view = await h.root.approvals.readProposal('task-a', h.review);
  assert.equal(view.proposal.payloadHash, h.review.reviewedPayloadHash);
  assert.equal(view.proposal.status, 'pending_confirmation');
  assert.equal(view.facts.preview.payload.payableAmount, 123);
  assert.equal(view.generatedText, null);
  assert.deepEqual(await h.root.approvals.readReceipt('task-a', { ...h.review, decision: 'approve' }), { kind: 'absent', retryable: false });
});

test('formal human policy is required and order read permission never authorizes approval', async () => {
  const h = await controlledApprovedOrderHarness(), command = { ...h.review, decision: 'approve' };
  const policy = h.state.records.aiTaskActionPolicy.find(row => row.operation === 'decide_approval');
  h.state.records.aiTaskActionPolicy = h.state.records.aiTaskActionPolicy.filter(row => row !== policy);
  await assert.rejects(h.root.approvals.decide('task-a', command), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  h.state.records.aiTaskActionPolicy.push(policy);
  h.state.user.permissions = h.state.user.permissions.filter(p => p !== 'rental-os:order:create');
  assert.equal((await h.root.approvals.readProposal('task-a', h.review)).proposal.status, 'pending_confirmation');
  await assert.rejects(h.root.approvals.decide('task-a', command), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.records.aiApproval.length, 0);
});

test('strict human commands reject caller identity and ordinary confirmation text', async () => {
  const h = await controlledApprovedOrderHarness();
  for (const command of [{ ...h.review, decision: 'approve', context: h.context },
    { ...h.review, decision: 'yes' }, { ...h.review, decision: 'approve', actorId: 'operator-a' }]) {
    await assert.rejects(h.root.approvals.decide('task-a', command), e => e.code === 'AI_INVALID_INPUT');
  }
  assert.equal(h.state.records.aiApproval.length, 0);
});

test('waiting human approval retries the original durable decision and rejects the opposite decision', async () => {
  const h = await controlledApprovedOrderHarness();
  h.state.records.aiTask[0].status = 'WAITING_CONFIRMATION';
  const command = { ...h.review, decision: 'approve' };
  const first = await h.root.approvals.decide('task-a', command);
  assert.deepEqual(await h.compose().approvals.decide('task-a', command), first);
  assert.equal(h.state.records.aiApproval.length, 1);
  assert.equal(h.state.records.rentalOrder.length, 0);
  await assert.rejects(h.root.approvals.decide('task-a', { ...command, decision: 'reject' }), e => e.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(h.root.approvals.readReceipt('task-a', { ...command, decision: 'reject' }), e => e.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(h.root.approvals.readReceipt('task-a', { ...command, proposalRevision: 2 }), e => e.code === 'AI_REVISION_CONFLICT');
});

test('lost decision acknowledgement reconciles the receipt without another approval or Core execution', async () => {
  const h = await controlledApprovedOrderHarness(), command = { ...h.review, decision: 'approve' };
  h.state.decisionAckLost = true;
  await assert.rejects(h.root.approvals.decide('task-a', command), e => e.code === 'AI_RESULT_UNKNOWN'
    && e.retryable === false && e.nextAction === 'read_decision_receipt');
  h.state.decisionAckLost = false;
  const row = h.state.records.aiApproval[0];
  assert.ok(row);
  h.state.records.aiBudgetPolicy = [];
  h.state.records.aiTaskActionPolicy = h.state.records.aiTaskActionPolicy.filter(p => p.operation !== 'decide_approval');
  h.state.records.aiTaskActionInput[0].expiresAt = new Date('2000-01-01');
  const receipt = await h.compose().approvals.readReceipt('task-a', command);
  assert.equal(receipt.kind, 'recorded');
  assert.equal(receipt.record.approvalId, row.id);
  assert.equal(h.state.records.aiApproval.length, 1);
  assert.equal(h.state.records.rentalOrder.length, 0);
  h.state.session = false;
  await assert.rejects(h.root.approvals.readReceipt('task-a', command), e => e.code === 'AI_ACCESS_DENIED');
});

test('confirmed proposal with a missing decision receipt stays unknown, not absent', async () => {
  const h = await controlledApprovedOrderHarness();
  await h.approve();
  h.state.records.aiApproval = [];
  const receipt = await h.root.approvals.readReceipt('task-a', { ...h.review, decision: 'approve' });
  assert.deepEqual(receipt, { kind: 'unknown', retryable: false, nextAction: 'read_decision_receipt' });
  await assert.rejects(h.root.approvals.decide('task-a', { ...h.review, decision: 'approve' }), e => e.code === 'AI_REVISION_CONFLICT');
  assert.equal(h.state.records.aiApproval.length, 0);
});

test('human rejection is durable and cannot be used as approval to create an order', async () => {
  const h = await controlledApprovedOrderHarness();
  const rejected = await h.root.approvals.decide('task-a', { ...h.review, decision: 'reject' });
  assert.equal(rejected.decision, 'rejected');
  const { expiresAt: _, ...prepared } = h.prepareCommand;
  await assert.rejects(h.root.submit({ ...prepared, approvalId: rejected.approvalId, reviewedPayloadHash: h.review.reviewedPayloadHash }), unavailable);
  assert.equal(h.state.records.rentalOrder.length, 0);
});

test('revocation after awaited review reads suppresses the proposal', async () => {
  const h = await controlledApprovedOrderHarness(); let revoked = false;
  h.state.onOperation = ({ model }) => {
    if (!revoked && model === 'aiApprovedOrderSnapshot') { revoked = true; h.state.session = false; }
  };
  await assert.rejects(h.root.approvals.readProposal('task-a', h.review), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(revoked, true);
});

test('decision transaction rechecks human policy before accepting the CAS', async () => {
  const h = await controlledApprovedOrderHarness(); let changed = false;
  h.state.onOperation = ({ model, op, records, inTransaction }) => {
    if (!changed && inTransaction && model === 'aiApproval' && op === 'create') {
      changed = true;
      records.aiTaskActionPolicy.find(p => p.operation === 'decide_approval').revision++;
    }
  };
  await assert.rejects(h.root.approvals.decide('task-a', { ...h.review, decision: 'approve' }),
    e => ['AI_ACCESS_DENIED', 'AI_RESULT_UNKNOWN'].includes(e.code));
  assert.equal(changed, true);
  assert.equal(h.state.records.aiApproval.length, 0);
  assert.equal(h.state.records.aiProposal[0].status, 'PENDING_CONFIRMATION');
});

test('controlled composition fails closed without real normalization dependency', async () => {
  const h = await controlledApprovedOrderHarness();
  assert.throws(() => composeControlledApprovedOrder({ ...h.dependencies, confirmation: {
    createApprovedOrder: h.dependencies.confirmation.createApprovedOrder.bind(h.dependencies.confirmation),
    assertOrderMatchesQuote: h.dependencies.confirmation.assertOrderMatchesQuote.bind(h.dependencies.confirmation)
  } }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
});
