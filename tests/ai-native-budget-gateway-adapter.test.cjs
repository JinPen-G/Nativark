'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { BudgetGatewayAdapter } = require('../apps/api/src/modules/ai-native/budget/budget-gateway-adapter');
const { BudgetError } = require('../apps/api/src/modules/ai-native/budget/budget.ports');
const context = { tenantId: 'tenant-1', workspaceId: 'space-1', actorId: 'actor-1' };
const association = {
  requestId: 'request-1', runId: 'run-1', stepId: 'step-1', actionId: 'action-1', idempotencyKey: 'call-1',
  scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'space-1' },
  config: { configId: 'config-1', configRevision: 3 }, priceVersion: 'price-1'
};
const binding = { actorId: 'actor-1', association, sceneCode: 'chat', expiresAt: new Date(Date.now() + 60_000) };
function harness() {
  const calls = [];
  const budget = {
    reserve: async command => { calls.push(['reserve', command]); return { id: 'reservation-1', association, callId: 'call-1', sceneCode: 'chat' }; },
    dispatch: async (...args) => { calls.push(['dispatch', ...args]); return { status: 'reserved' }; },
    settle: async (...args) => { calls.push(['settle', ...args]); return { status: 'settled' }; },
    release: async (...args) => { calls.push(['release', ...args]); return { status: 'released' }; },
    markUnknown: async (...args) => { calls.push(['unknown', ...args]); return { status: 'pending_reconciliation' }; },
    reconcile: async (...args) => { calls.push(['reconcile', ...args]); return { status: 'settled' }; }
  };
  const source = {
    resolveForReserve: async (...args) => { calls.push(['resolveReserve', ...args]); return structuredClone(binding); },
    resolveForReservation: async (...args) => { calls.push(['resolveReservation', ...args]); return structuredClone(binding); }
  };
  return { calls, source, adapter: new BudgetGatewayAdapter(budget, source) };
}

test('reserve uses trusted full association and never clones requestId into run/step/action', async () => {
  const h = harness();
  const id = await h.adapter.reserve(context, { callId: 'call-1', model: 'model-1', maxOutputTokens: 20 });
  assert.equal(id, 'reservation-1');
  const command = h.calls.find(row => row[0] === 'reserve')[1];
  assert.deepEqual(command.association, association);
  assert.notEqual(command.association.runId, command.association.requestId);
});

for (const [name, request] of Object.entries({
  empty_call: { callId: '', model: 'model-1', maxOutputTokens: 20 },
  malformed_call: { callId: 'call/forbidden', model: 'model-1', maxOutputTokens: 20 },
  empty_model: { callId: 'call-1', model: '', maxOutputTokens: 20 },
  malformed_model: { callId: 'call-1', model: 'model with spaces', maxOutputTokens: 20 },
  zero_output: { callId: 'call-1', model: 'model-1', maxOutputTokens: 0 },
  oversized_output: { callId: 'call-1', model: 'model-1', maxOutputTokens: 32769 },
  fractional_output: { callId: 'call-1', model: 'model-1', maxOutputTokens: 1.5 }
})) test(`reserve rejects ${name} before resolving durable binding`, async () => {
  const h = harness();
  await assert.rejects(() => h.adapter.reserve(context, request), error => error instanceof BudgetError && error.code === 'INVALID');
  assert.equal(h.calls.some(row => row[0] === 'resolveReserve' || row[0] === 'reserve'), false);
});

test('every post-reserve mutation re-resolves persistent binding instead of using process memory', async () => {
  const h = harness();
  await h.adapter.dispatch(context, 'reservation-1', 'dispatch:event-1');
  await h.adapter.markUnknown(context, 'reservation-1', 'unknown:event-1', 'provider-timeout');
  await h.adapter.reconcile(context, 'reservation-1', 'reconcile:event-1', 'evidence-1');
  assert.equal(h.calls.filter(row => row[0] === 'resolveReservation').length, 3);
  assert.deepEqual(h.calls.filter(row => row[0] === 'dispatch')[0].slice(1), ['reservation-1', association, 'dispatch:event-1']);
});

test('cross-tenant binding is rejected before budget mutation', async () => {
  const h = harness();
  await assert.rejects(() => h.adapter.dispatch({ ...context, tenantId: 'tenant-2' }, 'reservation-1', 'event-1'), error => error instanceof BudgetError && error.code === 'FORBIDDEN');
  assert.equal(h.calls.filter(row => row[0] === 'dispatch').length, 0);
});

test('a resolver that cannot supply the durable association fails closed', async () => {
  const h = harness();
  h.source.resolveForReservation = async () => { throw new BudgetError('UNAVAILABLE'); };
  await assert.rejects(() => h.adapter.release(context, 'reservation-1', 'event-1'), error => error instanceof BudgetError && error.code === 'UNAVAILABLE');
  assert.equal(h.calls.filter(row => row[0] === 'release').length, 0);
});

test('settlement requires an evidence reference; raw provider usage is not a budget proof', async () => {
  const h = harness();
  await h.adapter.settle(context, 'reservation-1', 'event-1', 'persisted-usage-evidence');
  const call = h.calls.find(row => row[0] === 'settle');
  assert.deepEqual(call.slice(1), ['reservation-1', association, 'event-1', 'persisted-usage-evidence']);
});

test('mutable caller identity cannot authorize a different actor while the binding source waits', async () => {
  const h = harness();
  let resolve;
  const waiting = new Promise(done => { resolve = done; });
  h.source.resolveForReservation = () => waiting;
  const caller = { ...context };
  const pending = h.adapter.dispatch(caller, 'reservation-1', 'event-1');
  caller.actorId = 'actor-forged';
  resolve({ ...structuredClone(binding), actorId: 'actor-forged' });
  await assert.rejects(pending, error => error.code === 'FORBIDDEN');
  assert.equal(h.calls.filter(row => row[0] === 'dispatch').length, 0);
});

test('reserve binds the initial request even if the caller changes it during resolution', async () => {
  const h = harness();
  let resolve;
  h.source.resolveForReserve = () => new Promise(done => { resolve = done; });
  const request = { callId: 'call-1', model: 'model-1', maxOutputTokens: 20 };
  const pending = h.adapter.reserve({ ...context }, request);
  request.callId = 'call-other';
  resolve(structuredClone(binding));
  assert.equal(await pending, 'reservation-1');
  assert.equal(h.calls.find(row => row[0] === 'reserve')[1].callId, 'call-1');
});

test('workspace Gateway consumers cannot bind reservations to platform consumption', async () => {
  const h = harness();
  h.source.resolveForReservation = async () => ({ ...structuredClone(binding), association: { ...association, scope: { kind: 'platform' } } });
  await assert.rejects(() => h.adapter.dispatch(context, 'reservation-1', 'event-1'), error => error.code === 'FORBIDDEN');
  assert.equal(h.calls.filter(row => row[0] === 'dispatch').length, 0);
});

for (const method of ['settle', 'release', 'markUnknown', 'reconcile']) {
  test(`${method} isolates identity changes during persistent binding lookup`, async () => {
    const h = harness();
    let resolve;
    h.source.resolveForReservation = () => new Promise(done => { resolve = done; });
    const caller = { ...context };
    const pending = h.adapter[method](caller, 'reservation-1', 'event-1', method === 'markUnknown' ? 'provider_timeout' : 'evidence-1');
    caller.actorId = 'actor-forged';
    resolve({ ...structuredClone(binding), actorId: 'actor-forged' });
    await assert.rejects(pending, error => error.code === 'FORBIDDEN');
    assert.equal(h.calls.filter(row => row[0] === (method === 'markUnknown' ? 'unknown' : method)).length, 0);
  });
}

test('tenant owner is not the workspace consumer even when tenant IDs match', async () => {
  const h = harness();
  h.source.resolveForReservation = async () => ({ ...structuredClone(binding), association: { ...association, scope: { kind: 'tenant', tenantId: context.tenantId } } });
  await assert.rejects(() => h.adapter.release(context, 'reservation-1', 'event-1'), error => error.code === 'FORBIDDEN');
  assert.equal(h.calls.filter(row => row[0] === 'release').length, 0);
});
