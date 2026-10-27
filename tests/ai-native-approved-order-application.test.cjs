'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
const { controlledApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-controlled.cjs');
const { AI_APPROVAL_APPLICATION_DRAFT_VERSION: draftVersion } = require('../packages/shared/src/ai-approval-application-draft.ts');
const { approvalApplicationContract, approvalApplicationError } = require('../apps/api/src/modules/ai-native/approval-execution/approval-application-contracts.ts');
const eligibility = (h, intent = 'inspect') => h.root.application.readReprepareEligibility('task-a', { draftVersion, original: h.review, intent });

test('public contract consumes real review/decision/receipt and preserves the committed action', async () => {
  const h = await controlledApprovedOrderHarness(), api = h.root.application;
  const review = await api.readProposal('task-a', h.review);
  assert.equal(review.draftVersion, draftVersion);
  assert.equal(review.deterministic.quoteAmounts.payableAmount, 123);
  assert.equal(Object.hasOwn(review, 'facts'), false);
  assert.equal(review.generatedText, null);
  assert.equal((await eligibility(h)).state, 'pending');
  const changed = await eligibility(h, 'change_plan');
  assert.equal(changed.state, 'change_requested');
  assert.equal(changed.canRequestReprepare, true);
  const command = { ...h.review, decision: 'approve' };
  const decision = await api.decide('task-a', command);
  assert.equal(decision.kind, 'recorded');
  assert.deepEqual(await h.compose().application.readReceipt('task-a', command), decision);
  assert.equal((await eligibility(h, 'change_plan')).state, 'approved_uncommitted');
  const result = await h.root.waiting.execute(h.executorInput(), new AbortController().signal);
  assert.equal(result.kind, 'succeeded');
  const before = structuredClone(h.state.records.aiApprovalConsumption);
  for (const intent of ['inspect', 'change_plan']) {
    const current = await eligibility(h, intent);
    assert.equal(current.state, 'committed');
    assert.equal(current.canRequestReprepare, false);
    assert.equal(current.nextAction, 'read_original_result');
  }
  assert.deepEqual(h.state.records.aiApprovalConsumption, before);
  assert.equal(h.state.records.rentalOrder.length, 1);
});

test('explicit rejection and immutable expiry offer new materials without creating any effect', async () => {
  const rejected = await controlledApprovedOrderHarness();
  await rejected.root.application.decide('task-a', { ...rejected.review, decision: 'reject' });
  assert.equal((await eligibility(rejected)).state, 'rejected');
  const expired = await controlledApprovedOrderHarness();
  expired.state.clock = new Date('2099-01-01T00:00:01Z');
  for (const row of expired.state.records.aiTaskActionPolicy) row.expiresAt = new Date('2100-01-01');
  assert.equal((await eligibility(expired)).state, 'expired');
  for (const h of [rejected, expired]) {
    assert.equal(h.state.records.rentalOrder.length, 0);
    assert.equal(h.state.records.aiProposal.length, 1);
  }
});

test('superseded and explicitly expired heads are readable but cannot obtain a new decision', async () => {
  for (const [status, state] of [['SUPERSEDED', 'superseded'], ['EXPIRED', 'expired']]) {
    const h = await controlledApprovedOrderHarness();
    h.state.records.aiProposal[0].status = status;
    assert.equal((await eligibility(h)).state, state);
    await assert.rejects(h.root.application.decide('task-a', { ...h.review, decision: 'approve' }));
    assert.equal(h.state.records.aiApproval.length, 0);
  }
});

test('uncertain step or consumed quote overrides rejection, expiry and change requests', async () => {
  for (const mark of ['step', 'quote']) {
    const h = await controlledApprovedOrderHarness();
    await h.root.application.decide('task-a', { ...h.review, decision: 'reject' });
    if (mark === 'step') h.state.records.aiStep[0].effect = 'POSSIBLE';
    else h.state.records.quote[0].consumedOrderId = 'external-order';
    const state = await eligibility(h, 'change_plan');
    assert.equal(state.state, 'unknown');
    assert.equal(state.canRequestReprepare, false);
    assert.equal(h.state.records.rentalOrder.length, 0);
  }
});

test('lost business ACK reads the original committed receipt; broken evidence remains unknown', async () => {
  const h = await controlledApprovedOrderHarness();
  const command = await h.approve(); h.state.ackLost = true;
  await assert.rejects(h.root.submit(command), e => e.code === 'AI_RESULT_UNKNOWN');
  assert.equal((await eligibility(h, 'change_plan')).state, 'committed');
  const order = structuredClone(h.state.records.rentalOrder);
  h.state.records.rentalOrderIdempotencyRecord[0].requestHash = 'f'.repeat(64);
  assert.equal((await eligibility(h, 'change_plan')).state, 'unknown');
  h.state.records.aiApprovalConsumption[0].status = 'UNKNOWN';
  assert.equal((await eligibility(h)).state, 'unknown');
  assert.deepEqual(h.state.records.rentalOrder, order);
});

test('read authority is current and independent from new execution policy', async () => {
  const h = await controlledApprovedOrderHarness();
  h.state.records.aiBudgetPolicy = [];
  h.state.user.permissions = h.state.user.permissions.filter(p => p !== 'rental-os:order:create');
  assert.equal((await eligibility(h)).state, 'pending');
  h.state.session = false;
  await assert.rejects(eligibility(h));
});

test('schema rejects spoofed authority, stale hash, illegal state combinations and leaks no raw errors', async () => {
  const h = await controlledApprovedOrderHarness();
  for (const extra of [{ context: h.context }, { approved: true }, { quoteAmounts: { payableAmount: 1 } }]) {
    await assert.rejects(h.root.application.decide('task-a', { ...h.review, decision: 'approve', ...extra }), e => e.code === 'AI_INVALID_INPUT');
  }
  await assert.rejects(h.root.application.readReprepareEligibility('task-a', { draftVersion, original: { ...h.review, reviewedPayloadHash: 'f'.repeat(64) }, intent: 'inspect' }), e => e.code === 'AI_REVISION_CONFLICT');
  assert.throws(() => approvalApplicationContract('AiApprovalReprepareEligibilityDraft', {
    draftVersion, original: h.review, state: 'committed', canRequestReprepare: true, nextAction: 'provide_new_materials'
  }), e => e.code === 'AI_INVALID_INPUT');
  assert.deepEqual(approvalApplicationError(Object.assign(new Error('private storage message'), { code: 'AI_RESULT_UNKNOWN', nextAction: 'read_reprepare_receipt' })), {
    code: 'result_unknown', retryable: false, nextAction: 'read_reprepare_receipt'
  });
});

test('receipt read races never promote an uncertain action into reprepare eligibility', async () => {
  const h = await controlledApprovedOrderHarness();
  let reads = 0;
  h.state.onOperation = async ({ model, op, records }) => {
    if (model === 'rentalOrderIdempotencyRecord' && op === 'findUnique' && ++reads === 1) records.aiStep[0].effect = 'POSSIBLE';
  };
  await assert.rejects(eligibility(h, 'change_plan'), e => e.code === 'AI_REVISION_CONFLICT');
  assert.equal(h.state.records.rentalOrder.length, 0);
});
