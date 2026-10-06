'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { approvedOrderHarness } = require('./fixtures/ai-native/approved-order-composition.cjs');
async function setup() {
  const h = await approvedOrderHarness();
  const { composeAiApprovedOrder } = require('../apps/api/src/modules/ai-native/approval-execution/approved-order.composition');
  h.service = composeAiApprovedOrder(h.dependencies);
  h.submit = () => h.service.submit(h.command);
  return h;
}

test('AIN-07 provides explicit composition and refuses missing trusted dependencies', () => {
  const { composeAiApprovedOrder } = require('../apps/api/src/modules/ai-native/approval-execution/approved-order.composition');
  assert.equal(typeof composeAiApprovedOrder, 'function');
  assert.throws(() => composeAiApprovedOrder({}), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
});

test('persisted approval + real Auth/Guard/DTO/ALS + Core confirmation creates exactly one order', async () => {
  const h = await setup();
  const first = await h.submit();
  assert.equal(first.replayed, false); assert.equal(first.order.payableAmount, 123);
  const again = await h.submit();
  assert.equal(again.replayed, true); assert.equal(again.order.id, first.order.id);
  assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.records.aiApprovalConsumption[0].status, 'COMMITTED');
  assert.equal(h.state.prepares, 1); assert.equal(h.state.commits, 1);
});

for (const [name, mutate] of Object.entries({
  hash: h => { h.command.reviewedPayloadHash = 'f'.repeat(64); },
  revision: h => { h.command.proposalRevision++; },
  actor: h => { h.state.records.aiApproval[0].actorId = 'other'; },
  scope: h => { h.state.records.aiTask[0].scope.workspaceId = 'other'; },
  expired: h => { h.state.records.aiApproval[0].expiresAt = new Date('2001-01-01'); },
  cancelled: h => { h.state.records.aiTask[0].cancelRequestedAt = new Date(); },
  takeover: h => { h.state.records.aiRun[0].leaseOwnerId = 'new-holder'; },
  fence: h => { h.state.records.aiRun[0].fencingToken = '10'; },
  input: h => { h.state.snapshots.input.payload.lines[0].quantity = 2; },
  preview: h => { h.state.snapshots.preview.payload.payableAmount = 1; },
  'saved metadata': h => { h.state.records.aiProposalVersion[0].payload.actions[0].target.resourceId = 'forged'; },
  'AI entitlement': h => { h.state.entitled = false; },
  session: h => { h.state.session = false; },
  'risk exceptions': h => { h.state.snapshots.input.payload.capabilityExceptions = []; }
})) test(`rejects ${name} without a committed order or consumption`, async () => {
  const h = await setup(); mutate(h); await assert.rejects(h.submit());
  assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApprovalConsumption.length, 0);
});

for (const field of ['payload', 'context', 'scopeId', 'businessIdempotencyKey', 'approved', 'success']) test(`caller cannot supply ${field}`, async () => {
  const h = await setup(); h.command[field] = true;
  await assert.rejects(h.submit(), error => error.code === 'AI_INVALID_INPUT'); assert.equal(h.state.prepares, 0);
});

for (const failAt of ['rentalOrder.create', 'aiApprovalConsumption.create', 'aiApprovalConsumption.updateMany', 'rentalOrderIdempotencyRecord.create', 'quote.consume', 'core.inventory']) {
  test(`one transaction rolls back Core, quote, idempotency and approval on ${failAt}`, async () => {
    const h = await setup(); h.state.failAt = failAt;
    await assert.rejects(h.submit());
    assert.deepEqual(h.state.failures, [failAt]);
    assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApprovalConsumption.length, 0);
    assert.equal(h.state.records.rentalOrderIdempotencyRecord.length, 0); assert.equal(h.state.records.quote[0].consumedAt, undefined);
  });
}

test('COMMIT response lost: recovery uses original facts without creating another order', async () => {
  const h = await setup(); h.state.ackLost = true;
  await assert.rejects(h.submit()); assert.equal(h.state.records.rentalOrder.length, 1);
  h.state.ackLost = false;
  const result = await h.submit(); assert.equal(result.replayed, true); assert.equal(result.order.id, 'order-1');
  assert.equal(h.state.prepares, 1); assert.equal(h.state.commits, 1);
});

test('committed fact survives expired approval, cancelled task, old fence and AI entitlement expiry', async () => {
  const h = await setup(); await h.submit();
  h.state.entitled = false; h.state.clock = new Date('2099-01-02');
  h.state.records.aiTask[0].cancelRequestedAt = new Date(); h.state.records.aiRun[0].fencingToken = '11';
  h.state.records.rentalOrderIdempotencyRecord = [];
  assert.equal((await h.submit()).replayed, true); assert.equal(h.state.prepares, 1);
});

for (const [name, mutate] of Object.entries({ session: s => { s.session = false; }, resource: s => { s.resourceAccess = false; }, policy: s => { s.policy = false; } })) {
  test(`replay still rechecks current ${name} access`, async () => {
    const h = await setup(); await h.submit(); mutate(h.state);
    await assert.rejects(h.submit()); assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.prepares, 1);
  });
}

test('revocation after COMMIT suppresses response, never claims rollback', async () => {
  const h = await setup(); h.state.afterCommit = async () => { h.state.session = false; };
  await assert.rejects(h.submit()); assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption[0].status, 'COMMITTED'); assert.equal(h.state.commits, 1);
});

test('concurrent same-action submissions have one committed order', async () => {
  const h = await setup(); const results = await Promise.allSettled([h.submit(), h.submit()]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.commits, 1);
  assert.equal((await h.submit()).replayed, true);
});
