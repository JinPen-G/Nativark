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
  const reads = [], ledger = [], status = method === 'reconcile' ? 'unknown' : 'reserved';
  const rows = [{ id: 'first', status }, { id: 'requested', status }];
  const service = new UsageAccountingService({ get: async (_, key) => { reads.push(key); return rows.find(r => r.id === key.id) ?? rows[0]; },
    appendLedger: async event => { ledger.push(event); }, transition: async (_, id) => ({ ...rows.find(r => r.id === id), status: 'settled' }) });
  const result = await service[method](scope, 'requested', 'event-1', 1, 2);
  assert.equal(result.id, 'requested'); assert.deepEqual(reads, [{ id: 'requested' }]); assert.equal(ledger[0].reservationId, 'requested');
});
test('usage lookup type no longer accepts an empty or ambiguous key', () => {
  assert.deepEqual(compileConsumer(`import type { UsageAccountingRepository } from '../apps/api/src/modules/ai-native/usage-accounting.ports';
    declare const r: UsageAccountingRepository; declare const s: Parameters<UsageAccountingRepository['get']>[0];
    r.get(s, { id: 'one' }); r.get(s, { callId: 'call' }); r.get(s, { idempotencyKey: 'key' });
    // @ts-expect-error empty lookups must not select the first reservation
    r.get(s, {});
    // @ts-expect-error only one exact lookup identity
    r.get(s, { id: 'one', callId: 'two' });`), []);
});
