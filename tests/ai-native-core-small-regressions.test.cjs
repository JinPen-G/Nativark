'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { blockNetwork, compileConsumer } = require('./fixtures/ai-native/contract-consumer.cjs'); blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { UnifiedAiGatewayService } = require('../apps/api/src/modules/ai-native/unified-ai-gateway.service');
const { UsageAccountingService } = require('../apps/api/src/modules/ai-native/usage-accounting.service');
const scope = { id: 'scope-1', kind: 'WORKSPACE', tenantId: 'tenant-1', workspaceId: 'space-1' };
const context = { tenantId: 'tenant-1', workspaceId: 'space-1', actorId: 'actor-1' };
const request = { callId: 'call-1', model: 'synthetic', messages: [{ role: 'user', content: 'synthetic' }], maxOutputTokens: 10 };
for (const mode of ['invoke', 'stream']) test(`pre-cancelled ${mode} touches no dependency`, async () => {
  let calls = 0;
  const ports = new Proxy({}, { get() { calls++; throw Error('must never resolve any port'); } });
  const gateway = new UnifiedAiGatewayService(ports), controller = new AbortController(); controller.abort();
  const operation = mode === 'invoke' ? gateway.invoke(context, request, controller.signal) : gateway.stream(context, request, controller.signal).next();
  await assert.rejects(operation, e => e.code === 'CANCELLED'); assert.equal(calls, 0);
});
for (const method of ['settle', 'reconcile']) test(`${method} selects exact reservation when another row is first`, async () => {
  const h = require('./fixtures/ai-native/usage-settlement.cjs');
  const f = h.setup(method === 'reconcile' ? 'unknown' : 'reserved');
  const result = await f.service[method](h.scope, 'usage-target', 'event-1', 1, 2);
  assert.equal(result.id, 'usage-target');
  assert.ok(f.state.calls.filter(c => c[0] === 'read').every(c => c[1].where.id === 'usage-target'));
  assert.equal(f.state.entries[0].reservationId, 'usage-target');
});
test('usage lookup type no longer accepts an empty or ambiguous key', () => {
  assert.deepEqual(compileConsumer(`import type { UsageAccountingRepository } from '../apps/api/src/modules/ai-native/usage-accounting.ports';
    declare const r: UsageAccountingRepository; declare const s: Parameters<UsageAccountingRepository['get']>[0];
    r.get(s, { id: 'one' }); r.get(s, { callId: 'call' }); r.get(s, { idempotencyKey: 'key' });
    // @ts-expect-error empty lookups must not select the first reservation
    r.get(s, {});
    // @ts-expect-error only one exact lookup identity
    r.get(s, { id: 'one', callId: 'two' });
    // @ts-expect-error settlement cannot bypass the atomic ledger operation
    r.transition(s, 'one', 'reserved', 'settled', { input: 1, output: 2 });`), []);
});
