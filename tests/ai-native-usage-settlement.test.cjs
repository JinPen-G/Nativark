'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const h = require('./fixtures/ai-native/usage-settlement.cjs');
const code = e => e.code === 'ACCOUNTING_PENDING';
for (const kind of ['settlement', 'reconcile']) test(`${kind} appends ledger and updates exact reservation in one transaction`, async () => {
  const f = h.setup(kind === 'reconcile' ? 'unknown' : 'reserved'), first = h.clone(f.state.rows[0]);
  const out = await f.service[kind === 'reconcile' ? 'reconcile' : 'settle'](h.scope, 'usage-target', 'event-1', 20, 30);
  assert.equal(out.id, 'usage-target'); assert.equal(out.status, 'settled'); assert.equal(out.actualInput, 20); assert.equal(out.actualOutput, 30);
  assert.equal(out.reservedUnits, 100); assert.equal(f.target().unknownReason, null); assert.deepEqual(f.state.rows[0], first);
  assert.deepEqual(f.state.calls.map(c => c[0]), ['auth','transaction','scope','read','ledger.read','cas','auth','ledger.create']);
  assert.deepEqual(f.state.calls[1][1], { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
  assert.equal(f.state.entries[0].kind, kind); assert.equal(f.state.entries.length, 1); assert.equal(f.state.commits, 1);
  const query = f.state.calls.find(c => c[0] === 'cas')[1];
  assert.equal(query.where.tenantId, h.scope.tenantId); assert.equal(query.where.workspaceId, h.scope.workspaceId); assert.equal(query.where.id, 'usage-target');
});
test('identical event replay does no writes, including reconciliation replay', async () => {
  for (const kind of ['settlement','reconcile']) {
    const f = h.setup(kind === 'reconcile' ? 'unknown' : 'reserved'), command = { ...h.input(), kind };
    await f.adapter.commitUsage(command); const before = h.clone(f.state.entries), calls = f.state.calls.length;
    const out = await f.adapter.commitUsage(command);
    assert.equal(out.actualOutput, 30); assert.deepEqual(f.state.entries, before);
    assert.deepEqual(f.state.calls.slice(calls).map(c => c[0]), ['auth','transaction','scope','read','ledger.read','auth']);
  }
});
for (const patch of [{ input: 21 }, { output: 31 }, { kind: 'reconcile' }, { eventKey: 'another-event' }]) test('settled reservation cannot acquire a conflicting second receipt', async () => {
  const f = h.setup(); await f.adapter.commitUsage(h.input()); const before = h.clone(f.state.entries);
  await assert.rejects(f.adapter.commitUsage({ ...h.input(), ...patch }), code); assert.deepEqual(f.state.entries, before);
});
for (const status of ['unknown','released','settled','invalid']) test(`ordinary settlement rejects ${status}`, async () => {
  const f = h.setup(status); await assert.rejects(f.adapter.commitUsage(h.input()), code); assert.equal(f.state.entries.length, 0);
});
test('reconcile cannot consume an ordinary reserved record', async () => {
  const f = h.setup(); await assert.rejects(f.adapter.commitUsage({ ...h.input(), kind: 'reconcile' }), code);
});
for (const phase of ['read','ledger.read','cas','ledger.create','commit']) test(`failure during ${phase} preserves both reservation and ledger in test transaction`, async () => {
  const f = h.setup(), before = h.clone(f.state.rows); f.state.fail = phase;
  await assert.rejects(f.adapter.commitUsage(h.input()), code); assert.deepEqual(f.state.rows, before); assert.equal(f.state.entries.length, 0);
  assert.equal(f.state.calls.filter(c => c[0] === 'transaction').length, 1);
});
test('commit acknowledgement loss may retain writes; explicit replay never adds another ledger row', async () => {
  const f = h.setup(); f.state.fail = 'ack'; await assert.rejects(f.adapter.commitUsage(h.input()), code);
  assert.equal(f.target().status, 'settled'); assert.equal(f.state.entries.length, 1);
  f.state.fail = ''; await f.adapter.commitUsage(h.input()); assert.equal(f.state.entries.length, 1);
});
for (const count of [0,2]) test(`CAS count ${count} fails closed`, async () => {
  const f = h.setup(); f.state.count = count; await assert.rejects(f.adapter.commitUsage(h.input()), code);
  assert.equal(f.state.entries.length, 0); assert.equal(f.target().status, 'reserved');
});
for (const mutate of [g => { g.authorized = false; }, g => { g.authorizationKey = 'changed'; }, g => { g.context.access.permissions = []; },
  g => { g.context.scope.workspaceId = 'other'; }, g => { g.expiresAt = h.now; }]) test('revocation after lock rolls back pending settlement', async () => {
  const f = h.setup(); f.state.hook = (count, grant) => { if (count === 2) mutate(grant); };
  await assert.rejects(f.adapter.commitUsage(h.input()), e => e.code === 'FORBIDDEN');
  assert.equal(f.target().status, 'reserved'); assert.equal(f.state.entries.length, 0);
});
for (const field of ['tenantId','workspaceId']) test(`other ${field} never settles or discloses reservation`, async () => {
  const f = h.setup(); f.target()[field] = 'other';
  await assert.rejects(f.adapter.commitUsage(h.input()), e => e.code === 'BUDGET_UNAVAILABLE'); assert.equal(f.state.entries.length, 0);
});
test('forged scope ID is not treated as a real scope', async () => {
  const f = h.setup(); await assert.rejects(f.adapter.commitUsage({ ...h.input(), scope: { ...h.scope, id: 'fake' } }), e => e.code === 'BUDGET_UNAVAILABLE');
});
test('invalid counts, unknown fields and unsupported platform storage refuse before auth', async () => {
  for (const patch of [{ input: -1 }, { output: Infinity }, { input: 4294967296 }, { output: 0.1 }, { eventKey: '' }, { actorId: 'admin' },
    { scope: { id: 'platform', kind: 'PLATFORM' } }]) {
    const f = h.setup(); await assert.rejects(f.adapter.commitUsage({ ...h.input(), ...patch }), e => e.code === 'INVALID_REQUEST'); assert.equal(f.state.calls.length, 0);
  }
});
test('actual usage above reservation is recorded, never clamped or presented as zero', async () => {
  const f = h.setup(); const out = await f.adapter.commitUsage({ ...h.input(), input: 500, output: 800 });
  assert.equal(out.actualInput, 500); assert.equal(out.actualOutput, 800); assert.equal(out.reservedUnits, 100);
});
test('parallel same receipt gets one committed ledger entry in serialized test double', async () => {
  const f = h.setup(); await Promise.all([f.adapter.commitUsage(h.input()), f.adapter.commitUsage(h.input())]); assert.equal(f.state.entries.length, 1);
});
test('legacy adapter with separate append/update is refused, never used as fallback', async () => {
  let writes = 0; const service = new h.UsageAccountingService({ appendLedger: async () => { writes++; }, transition: async () => { writes++; } });
  await assert.rejects(service.settle(h.scope, 'usage-target', 'event-1', 1, 2), code); assert.equal(writes, 0);
});
test('missing authority cannot construct an enabled settlement adapter', () => {
  assert.throws(() => new h.PrismaUsageSettlementRepository({}, null), e => e.code === 'FORBIDDEN');
});
