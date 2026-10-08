'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { controlledApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-controlled.cjs');
const { composeRequestBoundApprovedOrderApplication } = require('../apps/api/src/modules/ai-native/approval-execution/request-bound-approved-order.application.ts');
const { AI_APPROVAL_APPLICATION_DRAFT_VERSION: draftVersion } = require('../packages/shared/src/ai-approval-application-draft.ts');
async function harness() {
  const h = await controlledApprovedOrderHarness();
  const { credentials, ...dependencies } = h.dependencies;
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  return { ...h, request, dependencies, app: composeRequestBoundApprovedOrderApplication(dependencies, { enabled: true, audience: 'operator' }) };
}

test('request-bound application uses real human services and hands the decision to the original Core action', async () => {
  const h = await harness(), command = { ...h.review, decision: 'approve' };
  const view = await h.app.readProposal(h.request, 'task-a', h.review);
  assert.equal(view.ok, true);
  assert.equal(view.value.deterministic.quoteAmounts.payableAmount, 123);
  const decision = await h.app.decide(h.request, 'task-a', command);
  assert.equal(decision.ok, true);
  assert.equal(decision.value.kind, 'recorded');
  assert.deepEqual(await h.app.readReceipt(h.request, 'task-a', command), decision);
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal((await h.root.waiting.execute(h.executorInput(), new AbortController().signal)).kind, 'succeeded');
  const eligibility = await h.app.readReprepareEligibility(h.request, 'task-a', { draftVersion, original: h.review, intent: 'change_plan' });
  assert.equal(eligibility.ok, true);
  assert.equal(eligibility.value.state, 'committed');
  assert.equal(h.state.records.rentalOrder.length, 1);
});

test('explicit opt-in and server-selected audience cannot inherit ambient credentials', async () => {
  const h = await harness();
  assert.throws(() => composeRequestBoundApprovedOrderApplication(h.dependencies, { enabled: false, audience: 'operator' }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.throws(() => composeRequestBoundApprovedOrderApplication({ ...h.dependencies, credentials: { current: async () => ({}) } }, { enabled: true, audience: 'operator' }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  const staff = composeRequestBoundApprovedOrderApplication(h.dependencies, { enabled: true, audience: 'staff' });
  assert.equal((await staff.readProposal(h.request, 'task-a', h.review)).ok, false);
  for (const authorization of [undefined, '', [h.request.headers.authorization], 'Bearer invalid', 'Bearer x\r\nHost: x']) {
    const result = await h.app.readProposal({ headers: { authorization } }, 'task-a', h.review);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'access_denied');
    assert.equal(result.error.retryable, false);
  }
});

test('concurrent requests and later header mutations cannot swap the captured bearer', async () => {
  const h = await harness(), good = h.app.readProposal(h.request, 'task-a', h.review);
  h.request.headers.authorization = 'Bearer invalid';
  const [first, second] = await Promise.all([good, h.app.readProposal(h.request, 'task-a', h.review)]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error.code, 'access_denied');
});

test('session revocation remains effective on every new call and prevents decisions', async () => {
  const h = await harness();
  assert.equal((await h.app.readProposal(h.request, 'task-a', h.review)).ok, true);
  h.state.session = false;
  const result = await h.app.decide(h.request, 'task-a', { ...h.review, decision: 'approve' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'access_denied');
  assert.equal(h.state.records.aiApproval.length, 0);
});

test('unknown decision is redacted and recovered with the same request-bound receipt, never auto-approved', async () => {
  const h = await harness(), command = { ...h.review, decision: 'reject' };
  h.state.decisionAckLost = true;
  const lost = await h.app.decide(h.request, 'task-a', command);
  assert.deepEqual(lost, { ok: false, error: { code: 'result_unknown', retryable: false, nextAction: 'read_decision_receipt' } });
  const receipt = await h.app.readReceipt(h.request, 'task-a', command);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.value.record.decision, 'rejected');
  assert.equal(h.state.records.aiApproval.length, 1);
  assert.equal(h.state.records.rentalOrder.length, 0);
});

test('body-supplied credentials or amounts are rejected rather than becoming request authority', async () => {
  const h = await harness();
  for (const extra of [{ authorization: h.request.headers.authorization }, { audience: 'staff' }, { scope: h.context.scope }, { quoteAmounts: { payableAmount: 1 } }]) {
    const result = await h.app.decide(h.request, 'task-a', { ...h.review, decision: 'approve', ...extra });
    assert.deepEqual(result, { ok: false, error: { code: 'invalid_request', retryable: false, nextAction: 'correct_request' } });
  }
  assert.equal(h.state.records.aiApproval.length, 0);
});
