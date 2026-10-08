'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { controlledApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-controlled.cjs');

test('opt-in application exposes typed original review facts and completes explicit decision through the original action', async () => {
  const h = await controlledApprovedOrderHarness({ prepare: false }), input = h.executorInput();
  const waiting = await h.root.waiting.execute(input, new AbortController().signal);
  const api = h.root.approvals, reference = waiting.payload.proposal;
  const review = await api.readProposal(input.taskId, reference);
  assert.equal(review.deterministic.target.resourceType, 'quote');
  assert.equal(review.deterministic.target.resourceId, 'quote-a');
  assert.equal(review.deterministic.currency, 'CNY');
  assert.equal(review.deterministic.quoteAmounts.payableAmount, 123);
  assert.equal(review.deterministic.quoteAmounts.receivableAmount, 123);
  assert.equal(review.deterministic.quoteAmounts.depositAmount, 0);
  assert.equal(review.deterministic.decisionExpiresAt, review.proposal.payload.expiresAt);
  assert.equal(review.deterministic.quoteExpiresAt, review.facts.preview.payload.expiresAt);
  assert.equal(review.generatedText, null);
  const command = { ...reference, decision: 'approve' };
  const approval = await api.decide(input.taskId, command);
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal((await h.compose().approvals.readReceipt(input.taskId, command)).record.approvalId, approval.approvalId);
  const committed = await h.root.waiting.execute(input, new AbortController().signal);
  assert.equal(committed.kind, 'succeeded');
  assert.equal((await h.compose().waiting.reconcile(input)).payload.businessResultRef, committed.payload.businessResultRef);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApproval.length, 1);
});

test('review amount and expiry projection never substitutes the latest quote or requires new execution eligibility', async () => {
  const h = await controlledApprovedOrderHarness(), original = await h.root.approvals.readProposal('task-a', h.review);
  h.state.records.quote[0].payableAmount = 9999;
  h.state.records.quote[0].currency = 'USD';
  h.state.records.quote[0].expiresAt = '2098-01-01T00:00:00.000Z';
  h.state.records.aiBudgetPolicy = [];
  h.state.records.aiTaskPlanPolicy[0].enabled = false;
  h.state.user.permissions = h.state.user.permissions.filter(p => p !== 'rental-os:order:create');
  const current = await h.root.approvals.readProposal('task-a', h.review);
  assert.deepEqual(current.deterministic, original.deterministic);
  assert.equal(current.deterministic.quoteAmounts.payableAmount, 123);
  assert.equal(current.deterministic.currency, 'CNY');
  assert.equal(current.generatedText, null);
  await assert.rejects(h.root.approvals.decide('task-a', { ...h.review, decision: 'approve' }),
    e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
});

test('shared decision input does not accept generated text or caller-supplied review amounts', async () => {
  const h = await controlledApprovedOrderHarness();
  for (const extra of [{ generatedText: 'approved' }, { quoteAmounts: { payableAmount: 1 } }, { context: h.context }]) {
    await assert.rejects(h.root.approvals.decide('task-a', { ...h.review, decision: 'approve', ...extra }), e => e.code === 'AI_INVALID_INPUT');
  }
  assert.equal(h.state.records.aiApproval.length, 0);
  assert.equal(h.state.records.rentalOrder.length, 0);
});
