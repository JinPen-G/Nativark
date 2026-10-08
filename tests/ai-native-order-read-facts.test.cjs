'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/order-facts.cjs');
const { runWithRequestIdentity, getRequestIdentity } = require('../apps/api/src/common/request-identity');
const denied = e => e.code === 'AI_ACCESS_DENIED';
for (const audience of ['operator','staff']) test(`real Guard and Core read produce bounded ${audience} facts`, async () => {
  const f = await setup(audience), out = await f.reader.read();
  assert.equal(out.audience, audience); assert.equal(out.order.id, 'order-a'); assert.equal(out.order.status, 'reserved');
  assert.equal(out.order.amounts.finalPayable, 100); assert.equal(out.order.amounts.deposit, 20);
  assert.equal(out.scope.workspaceId, 'workspace-a'); assert.equal(out.sources[0].basis.kind, 'current');
  assert.equal(out.paymentEvidence, 'not_loaded'); assert.equal(out.historicalFeeEvidence, 'not_loaded');
  assert.equal(f.state.reads.length, 1); assert.equal(f.state.reads[0].identity.userId, 'operator-a');
  assert.equal(f.state.reads[0].identity.staffApi, audience === 'staff');
});
test('PII, internal notes, tokens, raw lines and attachments never enter projection', async () => {
  const f = await setup(); Object.assign(f.state.order, { customerName: 'DO_NOT_LEAK', contactPhone: 'DO_NOT_LEAK', notes: 'DO_NOT_LEAK', secret: 'DO_NOT_LEAK', lines: [{ raw: 'DO_NOT_LEAK' }], assignment: { operationLock: { token: 'DO_NOT_LEAK' } } });
  const out = await f.reader.read(); assert.equal(JSON.stringify(out).includes('DO_NOT_LEAK'), false);
  assert.deepEqual(Object.keys(out.order).sort(), ['amounts','currency','effectiveEndAt','effectiveEndBasis','id','orderNo','originalEndAt','startAt','status','updatedAt']);
});
test('zero amounts remain zero and missing amounts remain unknown', async () => {
  const f = await setup(); f.state.order.finalPayableAmount = 0; delete f.state.order.depositAmount;
  const out = await f.reader.read(); assert.equal(out.order.amounts.finalPayable, 0); assert.equal(out.order.amounts.deposit, null);
});
test('original and effective end dates are separate with explicit legacy basis', async () => {
  const f = await setup(); const initial = await f.reader.read();
  assert.equal(initial.order.effectiveEndBasis, 'endAt_fallback'); assert.equal(initial.order.effectiveEndAt, f.state.order.endAt);
  f.state.order.effectiveEndAt = '2026-01-05T00:00:00Z'; const next = await f.reader.read();
  assert.equal(next.order.effectiveEndBasis, 'effectiveEndAt'); assert.equal(next.order.originalEndAt, f.state.order.endAt); assert.notEqual(next.order.effectiveEndAt, next.order.originalEndAt);
});
for (const patch of [{ id: 'other' }, { tenantId: 'other' }, { status: 'paid_by_chat' }, { currency: undefined }, { finalPayableAmount: NaN }, { rentalAmount: -1 }, { updatedAt: 'invalid' }]) test('invalid Core data cannot become a fabricated fact', async () => {
  const f = await setup(); Object.assign(f.state.order, patch); await assert.rejects(f.reader.read(), denied);
});
for (const mutate of [s => { s.session = false; }, s => { s.member = false; }, s => { s.user.permissions = []; }, s => { s.workspace = 'space-other'; }]) test('late order response is discarded after authorization changes', async () => {
  const f = await setup(); f.state.afterRead = () => mutate(f.state);
  await assert.rejects(f.reader.read(), denied); assert.equal(f.state.reads.length, 1);
});
test('denied initial authorization never reaches Core order reader', async () => {
  const f = await setup(); f.state.user.permissions = [];
  await assert.rejects(f.reader.read(), denied); assert.equal(f.state.reads.length, 0);
});
test('Core not-found does not leak raw resource error', async () => {
  const f = await setup(); f.state.order = null; await assert.rejects(f.reader.read(), e => denied(e) && e.message === 'AI_ACCESS_DENIED');
});
test('guarded Core read leaves parent identity unchanged', async () => {
  const f = await setup();
  await runWithRequestIdentity({ tenantId: 'parent', userId: 'parent', isSaasAdmin: true }, async () => {
    const before = { ...getRequestIdentity() }; await f.reader.read(); assert.deepEqual(getRequestIdentity(), before);
  });
});
