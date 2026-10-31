'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { controlledApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-controlled.cjs');
const { AI_TOOL_DRAFT_VERSION } = require('../packages/shared/src/index.ts');
const signal = () => new AbortController().signal;
const denied = e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT'].includes(e.code);

test('registered order executor actually prepares, waits, reads human approval and submits the original action once', async () => {
  const h = await controlledApprovedOrderHarness({ prepare: false }), input = h.executorInput();
  const initialTask = structuredClone(h.state.records.aiTask[0]);
  const initialEvents = structuredClone(h.state.records.aiTaskEvent);
  const executor = await h.root.waiting.resolve('rental.order.commit', AI_TOOL_DRAFT_VERSION);
  assert.equal(executor.operation, 'idempotent');
  assert.equal(await h.root.waiting.resolve('rental.order.commit', 'foreign'), null);
  const pending = await executor.execute(input, signal());
  assert.equal(pending.kind, 'paused');
  assert.equal(pending.pause, 'confirmation');
  assert.equal(pending.payload.effectState, 'awaiting_decision');
  assert.equal(pending.payload.binding.actionId, input.actionId);
  assert.equal(pending.payload.presentedLease.fencingToken, input.lease.fencingToken);
  assert.equal(h.state.records.aiApproval.length, 0);
  assert.equal(h.state.prepares, 0);
  assert.equal(h.state.records.aiProposal.length, 1);
  assert.equal((await executor.execute({ ...input, clarifications: [{ requestId: 'text', receiptId: 'yes', answers: {} }] }, signal())).kind, 'paused');
  assert.equal(h.state.records.aiApproval.length, 0);
  await h.root.approvals.decide(input.taskId, { ...pending.payload.proposal, decision: 'approve', reviewVersion: 'ain-approval-order-review-draft-2' });
  const submitted = await executor.execute(input, signal());
  assert.equal(submitted.kind, 'succeeded');
  assert.equal(submitted.payload.effectState, 'committed');
  assert.equal(submitted.payload.businessResultRef, h.state.records.rentalOrder[0].id);
  assert.equal((await h.compose().waiting.readInterrupted(input)).kind, 'succeeded');
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  assert.equal(h.state.prepares, 1);
  assert.deepEqual(h.state.records.aiTask[0], initialTask);
  assert.equal(h.state.records.aiStep[0].status, 'RUNNING');
  assert.deepEqual(h.state.records.aiTaskEvent, initialEvents);
  assert.equal(h.state.records.aiTaskResultArtifact.length, 0);
});

test('rejection stops the original action without business success', async () => {
  const h = await controlledApprovedOrderHarness(), input = h.executorInput();
  await h.root.approvals.decide(input.taskId, { ...h.review, decision: 'reject' });
  const result = await h.root.waiting.execute(input, signal());
  assert.equal(result.kind, 'failed');
  assert.equal(result.errorCode, 'AI_APPROVAL_REJECTED');
  assert.equal(h.state.records.rentalOrder.length, 0);
});

for (const approved of [false, true]) test(`cancel ${approved ? 'after approval' : 'while waiting'} blocks new Core submission`, async () => {
  const h = await controlledApprovedOrderHarness(), input = h.executorInput();
  if (approved) await h.approve();
  h.state.records.aiTask[0].cancelRequestedAt = new Date();
  await assert.rejects(h.root.waiting.execute(input, signal()), denied);
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.prepares, 0);
  assert.equal((await h.root.waiting.readInterrupted(input)).kind, 'unknown');
});

test('Core lost acknowledgement remains unknown and cancellation cannot erase a committed order', async () => {
  const h = await controlledApprovedOrderHarness(), input = h.executorInput();
  await h.approve(); h.state.ackLost = true;
  const uncertain = await h.root.waiting.execute(input, signal());
  assert.equal(uncertain.kind, 'unknown');
  h.state.ackLost = false;
  h.state.records.aiTask[0].cancelRequestedAt = new Date();
  h.state.records.aiTask[0].status = 'CANCELLED';
  h.state.records.aiStep[0].status = 'SUCCEEDED';
  h.state.records.aiTaskActionInput[0].expiresAt = new Date('2000-01-01');
  h.state.records.aiTaskPlanPolicy[0].enabled = false;
  h.state.records.aiBudgetPolicy = [];
  const recovered = await h.compose().waiting.readInterrupted(input);
  assert.equal(recovered.kind, 'succeeded');
  assert.equal(recovered.payload.businessResultRef, h.state.records.rentalOrder[0].id);
  assert.equal(recovered.payload.replayed, true);
  assert.equal(h.state.prepares, 1);
  h.state.records.rentalOrder = [];
  assert.equal((await h.root.waiting.reconcile(input)).kind, 'unknown');
  assert.equal(h.state.prepares, 1);
});

test('missing preparation acknowledgement is recovered as a waiting proposal, not an automatic approval', async () => {
  const h = await controlledApprovedOrderHarness({ prepare: false }), input = h.executorInput();
  h.state.proposalAckLost = true;
  const result = await h.root.waiting.execute(input, signal());
  assert.equal(result.kind, 'unknown');
  assert.equal(result.payload.effectState, 'preparation_unknown');
  h.state.proposalAckLost = false;
  const waiting = await h.compose().waiting.readWaiting(input);
  assert.equal(waiting.kind, 'waiting_reference');
  assert.equal(waiting.receipt.kind, 'absent');
  assert.equal((await h.root.waiting.execute(input, signal())).kind, 'paused');
  assert.equal(h.state.records.aiProposal.length, 1);
  assert.equal(h.state.records.aiApproval.length, 0);
  assert.equal(h.state.records.rentalOrder.length, 0);
});

test('stale lease and changed original input cannot continue a waiting action', async () => {
  const h = await controlledApprovedOrderHarness(), input = h.executorInput();
  await assert.rejects(h.root.waiting.execute({ ...input, lease: { ...input.lease, revision: input.lease.revision + 1 } }, signal()), denied);
  await h.approve();
  await assert.rejects(h.root.waiting.execute({ ...input, fingerprint: '0'.repeat(64) }, signal()), denied);
  h.state.records.aiTaskPlanPolicy[0].revision++;
  await assert.rejects(h.root.waiting.execute(input, signal()), denied);
  assert.equal(h.state.records.rentalOrder.length, 0);
});

test('aborted and recovery-only invocations never call submit', async () => {
  const h = await controlledApprovedOrderHarness(), input = h.executorInput(), controller = new AbortController();
  await h.approve(); controller.abort();
  await assert.rejects(h.root.waiting.execute(input, controller.signal), denied);
  const recovery = { ...input, lease: { ...input.lease, purpose: 'recovery_only' } };
  assert.equal((await h.root.waiting.execute(recovery, signal())).kind, 'unknown');
  assert.equal(h.state.prepares, 0);
  assert.equal(h.state.records.rentalOrder.length, 0);
});
