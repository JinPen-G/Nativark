'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { persistedApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-persisted.cjs');
const { composeAiApprovedOrder } = require('../apps/api/src/modules/ai-native/approval-execution/approved-order.composition');

async function committed() {
  const h = await persistedApprovedOrderHarness();
  const compose = () => composeAiApprovedOrder({ ...h.dependencies, policy: h.policy() });
  const first = await compose().submit(h.command);
  return { ...h, compose, first };
}
const unknown = e => e.code === 'AI_RESULT_UNKNOWN' && e.nextAction === 'reconcile' && e.retryable === false;
const denied = e => e.code === 'AI_ACCESS_DENIED';
const oneEffect = h => {
  assert.equal(h.state.prepares, 1);
  assert.equal(h.state.commits, 1);
  assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption[0].status, 'COMMITTED');
};

for (const method of ['submit', 'reconcile']) test(`${method} keeps a committed but missing result unknown without new consumption`, async () => {
  const h = await committed(), orders = structuredClone(h.state.records.rentalOrder);
  h.state.records.rentalOrder = [];
  h.state.records.rentalOrderIdempotencyRecord = [];
  await assert.rejects(h.compose()[method](h.command), unknown);
  oneEffect(h);
  assert.equal(h.state.records.rentalOrder.length, 0);
  h.state.records.rentalOrder = orders;
  const recovered = await h.compose().reconcile(h.command);
  assert.equal(recovered.replayed, true);
  assert.deepEqual(recovered.order, h.first.order);
  oneEffect(h);
});

for (const [label, change] of [
  ['foreign tenant', order => { order.tenantId = 'tenant-b'; }],
  ['different result id', order => { order.id = 'unrelated-order'; }]
]) test(`committed result rejects ${label}`, async () => {
  const h = await committed(), get = h.dependencies.core.getOrder;
  h.dependencies.core.getOrder = async (...args) => { const order = await get(...args); change(order); return order; };
  await assert.rejects(h.compose().reconcile(h.command), denied);
  oneEffect(h);
  h.dependencies.core.getOrder = get;
  assert.deepEqual((await h.compose().reconcile(h.command)).order, h.first.order);
});

for (const method of ['submit', 'reconcile']) test(`${method} cannot replace the original result with another quote's order`, async () => {
  const h = await committed(), original = h.state.records.rentalOrder[0];
  const other = { ...structuredClone(original), id: 'other-order', quoteId: 'other-quote' };
  h.state.records.rentalOrder.push(other);
  const receipt = h.state.records.aiApprovalConsumption[0], originalRef = receipt.resultRef;
  receipt.resultRef = other.id;
  // Same tenant/workspace/current read permission and self-consistent result ID
  // do not make a different quote the original approved business result.
  await assert.rejects(h.compose()[method](h.command), unknown);
  oneEffect(h); assert.equal(h.state.records.rentalOrder.length, 2);
  assert.equal(h.state.records.aiApprovalConsumption[0].resultRef, other.id, 'read-only reconciliation never repairs or rewrites a receipt');
  // The transaction fixture publishes a cloned committed state after reads;
  // restore the current row, not a stale object captured before that read.
  h.state.records.aiApprovalConsumption[0].resultRef = originalRef;
  assert.deepEqual((await h.compose().reconcile(h.command)).order, h.first.order);
  oneEffect(h); assert.equal(h.state.records.rentalOrder.length, 2);
});

for (const [label, change] of [
  ['workspace changed', state => { state.workspace = 'workspace-b'; }],
  ['membership withdrawn', state => { state.member = false; }]
]) test(`committed result rejects ${label} during Core read`, async () => {
  const h = await committed(), get = h.dependencies.core.getOrder;
  h.dependencies.core.getOrder = async (...args) => { const order = await get(...args); change(h.state); return order; };
  await assert.rejects(h.compose().reconcile(h.command), denied);
  oneEffect(h);
});

test('authority withdrawal while missing result is read takes precedence over unknown', async () => {
  const h = await committed();
  h.dependencies.core.getOrder = async () => { h.state.session = false; return undefined; };
  await assert.rejects(h.compose().reconcile(h.command), denied);
  oneEffect(h);
});

test('Core read failure is unknown while current read authority remains and never leaks its cause', async () => {
  const h = await committed();
  h.dependencies.core.getOrder = async () => { throw Error('private result-read credential'); };
  await assert.rejects(h.compose().reconcile(h.command), e => unknown(e) && !e.cause && !String(e.stack).includes('credential'));
  oneEffect(h);
});

test('later order state and rental period remain readable through the immutable original quote', async () => {
  const h = await committed(), row = h.state.records.rentalOrder[0];
  row.status = 'renting'; row.effectiveEndAt = '2026-11-15T09:00:00Z';
  const result = await h.compose().reconcile(h.command);
  assert.equal(result.replayed, true); assert.equal(result.order.id, h.first.order.id);
  assert.equal(result.order.quoteId, h.first.order.quoteId);
  assert.equal(result.order.status, 'renting'); assert.equal(result.order.effectiveEndAt, row.effectiveEndAt);
  oneEffect(h);
});

test('removed business receipt and expired approval permit only the original committed fact under current read authority', async () => {
  const h = await committed();
  h.state.records.rentalOrderIdempotencyRecord = [];
  h.state.records.aiBudgetPolicy = [];
  h.state.records.aiTask[0].cancelRequestedAt = new Date();
  h.state.records.aiApproval[0].expiresAt = new Date(h.state.records.aiApproval[0].issuedAt.getTime() + 1);
  h.state.clock = new Date(Date.now() + 1000);
  h.state.records.aiRun[0].fencingToken = '10';
  h.state.user.permissions = ['rental-os:order:view'];
  const result = await h.compose().reconcile(h.command);
  assert.equal(result.replayed, true);
  assert.deepEqual(result.order, h.first.order);
  oneEffect(h);
  h.state.member = false;
  await assert.rejects(h.compose().reconcile(h.command), denied);
  oneEffect(h);
});
