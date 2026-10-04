'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { PrismaAdmissionRepository } = require('../apps/api/src/modules/ai-native/invocation-admission.repository');
const { InvocationDispatchService } = require('../apps/api/src/modules/ai-native/invocation-dispatch.service');
const { UnifiedAiGatewayService } = require('../apps/api/src/modules/ai-native/unified-ai-gateway.service');
const scope = { id: 'scope-1', kind: 'WORKSPACE', tenantId: 'tenant-1', workspaceId: 'workspace-1' };
const binding = () => ({ scope: { ...scope }, id: 'admission-1', actorId: 'actor-1', callId: 'call-1', requestHash: 'hash-1', profileId: 'profile-1', dispatchId: 'dispatch-1' });
function setup() {
  const state = { row: { id: 'admission-1', tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorId: 'actor-1', callId: 'call-1', requestHash: 'hash-1', profileId: 'profile-1', status: 'admitted', dispatchId: null, unknownReason: null, expiresAt: new Date(Date.now() + 60000), admittedAt: new Date(), updatedAt: new Date(), revokedAt: null, completedAt: null }, writes: [], transactions: [], loseAck: false };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => value && typeof value === 'object' && 'gt' in value ? row[key] > value.gt : row[key] instanceof Date ? +row[key] === +value : row[key] === value);
  let queue = Promise.resolve();
  const db = { $transaction: (run, options) => {
    const pending = queue.then(async () => {
      state.transactions.push(options);
      let working = structuredClone(state.row);
      const tx = { aiScope: { findFirst: async ({ where }) => matches(scope, where) ? { ...scope } : null }, aiInvocationAdmission: {
        updateMany: async ({ where, data }) => { state.writes.push(structuredClone(where)); if (!matches(working, where)) return { count: 0 }; working = { ...working, ...data }; return { count: 1 }; },
        findFirst: async ({ where }) => matches(working, where) ? structuredClone(working) : null
      } };
      const result = await run(tx); state.row = working;
      if (state.loseAck) { state.loseAck = false; throw new Error('ack lost after commit'); }
      return result;
    });
    queue = pending.catch(() => {}); return pending;
  } };
  const repository = new PrismaAdmissionRepository(db);
  return { state, repository, service: new InvocationDispatchService(repository) };
}
test('concurrent claims issue exactly one token and cannot reclaim even the winning token', async () => {
  const f = setup();
  const results = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => f.service.claim({ ...binding(), dispatchId: `dispatch-${i}` })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const winner = results.find(r => r.status === 'fulfilled').value;
  await assert.rejects(f.service.claim({ ...binding(), dispatchId: winner.dispatchId }), e => e.code === 'ACCOUNTING_PENDING');
  assert.equal(f.state.row.dispatchId, winner.dispatchId);
  assert.equal(f.state.transactions[0].isolationLevel, 'Serializable');
  assert.equal(f.state.transactions[0].timeout, 5000);
  assert.equal(f.state.writes[0].dispatchId, null);
  assert.ok(f.state.writes[0].expiresAt.gt instanceof Date);
});
for (const field of ['id', 'actorId', 'callId', 'requestHash', 'profileId']) test(`claim binds ${field}`, async () => {
  const f = setup(); await assert.rejects(f.service.claim({ ...binding(), [field]: 'other' }), e => e.code === 'ACCOUNTING_PENDING'); assert.equal(f.state.row.dispatchId, null);
});
for (const field of ['id', 'tenantId', 'workspaceId']) test(`claim binds scope ${field}`, async () => {
  const f = setup(); await assert.rejects(f.service.claim({ ...binding(), scope: { ...scope, [field]: 'other' } })); assert.equal(f.state.row.dispatchId, null);
});
for (const mutation of [r => { r.expiresAt = new Date(0); }, r => { r.revokedAt = new Date(); }, r => { r.completedAt = new Date(); }, r => { r.status = 'unknown'; }, r => { r.dispatchId = 'already-claimed'; }]) test('ineligible admission cannot be claimed', async () => {
  const f = setup(); mutation(f.state.row); const before = structuredClone(f.state.row); await assert.rejects(f.service.claim(binding())); assert.deepEqual(f.state.row, before);
});
test('lost claim acknowledgement leaves token consumed and never grants retry permission', async () => {
  const f = setup(); f.state.loseAck = true; await assert.rejects(f.service.claim(binding()), e => e.code === 'ACCOUNTING_PENDING');
  assert.equal(f.state.row.dispatchId, 'dispatch-1'); await assert.rejects(f.service.claim(binding()));
});
for (const outcome of ['completed', 'cancelled', 'unknown']) test(`only matching token can finish as ${outcome}`, async () => {
  const f = setup(); await f.service.claim(binding());
  for (const field of ['dispatchId', 'id', 'actorId', 'requestHash', 'profileId']) await assert.rejects(f.service.finish({ ...binding(), [field]: 'other' }, outcome));
  assert.equal(f.state.row.status, 'admitted');
  // Expiry stops new claims, not accounting for a dispatch already owned.
  f.state.row.expiresAt = new Date(0);
  const result = await f.service.finish(binding(), outcome); assert.equal(result.status, outcome);
  await assert.rejects(f.service.finish(binding(), outcome)); await assert.rejects(f.service.claim(binding()));
});
test('legacy transition cannot remove or bypass a dispatch token', async () => {
  const f = setup(); await f.service.claim(binding());
  await assert.rejects(f.repository.transition(scope, 'call-1', 'admitted', 'cancelled'));
  await assert.rejects(f.repository.transition(scope, 'call-1', 'admitted', 'cancelled', { dispatchId: null }));
  assert.equal(f.state.row.status, 'admitted'); assert.equal(f.state.row.dispatchId, 'dispatch-1');
});
test('service validates full readback and rejects malformed input before repository calls', async () => {
  const f = setup(); await assert.rejects(f.service.claim({ ...binding(), unexpected: true }), e => e.code === 'INVALID_REQUEST'); assert.equal(f.state.transactions.length, 0);
  const service = new InvocationDispatchService({ claimDispatch: async () => ({ ...f.state.row, scope, dispatchId: 'forged' }), finishDispatch: async () => null });
  await assert.rejects(service.claim(binding()), e => e.code === 'ACCOUNTING_PENDING');
});
function gatewaySetup() {
  const f = setup(), events = [];
  const ports = {
    routing: require('./fixtures/ai-native/unified-routing.cjs')(async () => ({ profile: { id: 'profile-1', model: 'synthetic' } }), scope),
    admission: { admit: async input => { f.state.row.requestHash = input.requestHash; return { ...structuredClone(f.state.row), scope: { ...scope } }; }, transition: async () => { throw Error('legacy cleanup forbidden'); } },
    dispatch: f.service,
    usage: { reserve: async () => { events.push('reserve'); return { id: 'usage-1' }; }, settle: async () => { events.push('settle'); }, markUnknown: async () => { events.push('unknown-usage'); } },
    audit: { append: async () => {} },
    transport: { invoke: async () => { events.push('transport'); return { text: 'done', usage: { inputTokens: 1, outputTokens: 2 } }; },
      stream: async function* () { events.push('transport'); yield { kind: 'result', result: { text: 'done', usage: { inputTokens: 1, outputTokens: 2 } } }; } }
  };
  const gateway = new UnifiedAiGatewayService(ports, 10000);
  const context = { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorId: 'actor-1' };
  const request = { callId: 'call-1', model: 'synthetic', messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 5 };
  const run = async (mode, signal) => { if (mode === 'invoke') return gateway.invoke(context, request, signal); const out = []; for await (const event of gateway.stream(context, request, signal)) out.push(event); return out; };
  return { ...f, ports, events, run };
}
for (const mode of ['invoke', 'stream']) test(`${mode}: concurrent loser never reserves or mutates winner accounting`, async () => {
  const f = gatewaySetup(); let release, entered;
  const ready = new Promise(r => { entered = r; }), wait = new Promise(r => { release = r; });
  f.ports.usage.reserve = async () => { f.events.push('reserve'); entered(); await wait; return { id: 'usage-1' }; };
  const winner = f.run(mode); await ready;
  const token = f.state.row.dispatchId;
  await assert.rejects(f.run(mode), e => e.code === 'ACCOUNTING_PENDING');
  assert.deepEqual(f.events, ['reserve']); assert.equal(f.state.row.dispatchId, token); assert.equal(f.state.row.status, 'admitted');
  release(); await winner; assert.deepEqual(f.events, ['reserve', 'transport', 'settle']); assert.equal(f.state.row.status, 'completed');
});
for (const mode of ['invoke', 'stream']) test(`${mode}: lost claim acknowledgement prevents budget and transport`, async () => {
  const f = gatewaySetup(); f.state.loseAck = true;
  await assert.rejects(f.run(mode), e => e.code === 'ACCOUNTING_PENDING'); assert.deepEqual(f.events, []);
  assert.ok(f.state.row.dispatchId); assert.equal(f.state.row.status, 'admitted');
  await assert.rejects(f.run(mode), e => e.code === 'ACCOUNTING_PENDING'); assert.deepEqual(f.events, []);
});
for (const mode of ['invoke', 'stream']) test(`${mode}: late successful claim is cleaned up only with its own token`, async () => {
  const f = gatewaySetup(), controller = new AbortController(); let release, entered;
  const ready = new Promise(r => { entered = r; }), wait = new Promise(r => { release = r; });
  f.ports.dispatch = { claim: async b => { const record = await f.service.claim(b); entered(); await wait; return record; }, finish: (...args) => f.service.finish(...args) };
  const pending = assert.rejects(f.run(mode, controller.signal), e => e.code === 'CANCELLED');
  await ready; controller.abort(); await pending; assert.deepEqual(f.events, []); release();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(f.state.row.status, 'cancelled'); assert.deepEqual(f.events, []);
});
test('caller mutation during transaction cannot change the captured binding', async () => {
  const f = setup(), value = binding(), pending = f.service.claim(value); value.actorId = 'forged'; value.scope.tenantId = 'forged';
  assert.equal((await pending).actorId, 'actor-1'); assert.equal(f.state.row.dispatchId, 'dispatch-1');
});
