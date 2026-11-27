'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { blockNetwork, compileConsumer } = require('./fixtures/ai-native/contract-consumer.cjs');
blockNetwork(test);
const { createControllerSourceLoader } = require('../scripts/controller-sources.cjs');
const sourceLoader = createControllerSourceLoader(require('node:path').resolve(__dirname, '..'));
const { ModelGatewayService, GatewayCapacityService } = sourceLoader.load(
  sourceLoader.resolveSource(__filename, '@rental-os/platform-server/ai-gateway', true));
const ctx = { tenantId: 'tenant-1', workspaceId: 'space-1', actorId: 'actor-1' };
const input = { callId: 'call-1', model: 'model-1', messages: [{ role: 'user', content: 'Synthetic only' }], maxOutputTokens: 10 };
const never = () => new Promise(() => {});
const tick = () => new Promise(resolve => setImmediate(resolve));
test('rolling replicas keep independent process and tenant admission limits and preserve waiting deadlines', async () => {
  // The configured ceilings belong to the original Rental host; the gate is public.
  const { load } = require('./fixtures/ai-native/rental-compatibility-source.cjs');
  const { DEFAULT_GATEWAY_CAPACITY_LIMITS: limits } = load('@rental-os/ai-native-server/runtime/gateway-capacity.runtime');
  const timers = new Set(); let time = 1000;
  const clock = { now: () => time, setTimer(callback) { timers.add(callback); return callback; }, clearTimer: timer => timers.delete(timer) };
  const gates = [new GatewayCapacityService(limits, clock), new GatewayCapacityService(limits, clock)];
  const signal = new AbortController().signal;
  const request = (tenant, callId) => ({ context: { ...ctx, tenantId: tenant }, profile: { id: 'profile', scopeId: 'platform', scopeKind: 'PLATFORM',
    serviceMode: 'platform_managed', protocol: 'fixture', provider: 'fixture', configRevision: 1 }, callId, expiresAt: new Date(time + 60000) });
  const leases = [], waiting = [];
  try {
    for (const gate of gates) {
      for (let index = 0; index < 4; index++) leases.push(await gate.acquire(request('active-tenant', `call-${index}`), signal));
      for (let tenant = 0; tenant < 8; tenant++) {
        for (let item = 0; item < 4; item++) waiting.push(assert.rejects(gate.acquire(request(`tenant-${tenant}`, `queued-${item}`), signal), {code:'TIMEOUT'}));
        if (tenant === 0) await assert.rejects(gate.acquire(request('tenant-0','over-tenant'), signal), {code:'RATE_LIMITED'});
      }
      await assert.rejects(gate.acquire(request('extra-tenant','over-queue'), signal), {code:'RATE_LIMITED'});
    }
    assert.equal(gates.reduce((total, gate) => total + gate.readStatistics().active, 0), 8);
    assert.equal(gates.reduce((total, gate) => total + gate.readStatistics().queued, 0), 64);
    time += 15000; for (const callback of [...timers]) callback(); await Promise.all(waiting);
    for (const gate of gates) { const stats = gate.readStatistics(); assert.equal(stats.queued, 0); assert.equal(stats.totals.timedOut, 32); assert.equal(stats.active, 4); }
  } finally { for (const lease of leases) lease.release(); }
});
function harness(deadline = 30) {
  const events = [], signals = [], profile = { enabled: true, provider: 'synthetic', allowedModels: ['model-1'], credentialRef: 'vault-1', timeoutMs: 1000, maxConcurrent: 1, maxOutputTokens: 100 };
  const ports = { authorize: async (_, signal) => { signals.push(signal); events.push('authorize'); }, profile: async (_, signal) => { signals.push(signal); return profile; }, credential: async (_, __, signal) => { signals.push(signal); return 'synthetic-secret'; }, budget: {
    reserve: async (_, __, signal) => { signals.push(signal); events.push('reserve'); return 'reservation-1'; },
    settle: async () => { events.push('settle'); }, release: async () => { events.push('release'); }, reconcile: async () => { events.push('reconcile'); }
  } };
  const adapter = { provider: 'synthetic', features: [], generate: async () => { events.push('generate'); return { text: 'Synthetic result', usage: { inputTokens: 1, outputTokens: 1 } }; } };
  const gateway = new ModelGatewayService(ports, [adapter], deadline);
  return { ports, adapter, profile, events, signals, gateway, run: signal => gateway.generate(ctx, input, signal) };
}
const rejected = (p, code) => assert.rejects(p, e => e.code === code && e.message === code);
for (const stage of ['authorize', 'profile', 'credential', 'reserve']) test(`total deadline bounds uncooperative ${stage} before dispatch`, { timeout: 1500 }, async () => {
  const f = harness(); if (stage === 'reserve') f.ports.budget.reserve = never; else f.ports[stage] = never;
  await rejected(f.run(), 'TIMEOUT'); assert.equal(f.events.includes('generate'), false);
  assert.ok(f.signals.every(s => s?.aborted));
});
for (const stage of ['authorize', 'profile', 'credential', 'reserve']) test(`cancellation is observed while waiting for ${stage}`, { timeout: 1500 }, async () => {
  const f = harness(1000), stop = new AbortController(); let entered = false;
  const stalled = () => { entered = true; return never(); };
  if (stage === 'reserve') f.ports.budget.reserve = stalled; else f.ports[stage] = stalled;
  const result = f.run(stop.signal); while (!entered) await tick(); stop.abort();
  await rejected(result, 'CANCELLED'); assert.equal(f.events.includes('generate'), false);
});
test('late reservation after timeout is compensated without dispatch or duplicate release', { timeout: 1500 }, async () => {
  const f = harness(); let complete;
  f.ports.budget.reserve = () => new Promise(resolve => { complete = resolve; });
  await rejected(f.run(), 'TIMEOUT'); assert.equal(f.events.includes('release'), false);
  complete('reservation-late'); await tick(); await tick();
  assert.equal(f.events.filter(e => e === 'release').length, 1); assert.equal(f.events.includes('generate'), false);
  assert.equal(f.events.includes('reconcile'), false);
});
test('late predispatch reservation compensation failure marks reconciliation, not a model retry', { timeout: 1500 }, async () => {
  const f = harness(); let complete;
  f.ports.budget.reserve = () => new Promise(resolve => { complete = resolve; });
  f.ports.budget.release = async () => { f.events.push('release'); throw new Error('synthetic-private'); };
  await rejected(f.run(), 'TIMEOUT'); complete('reservation-late'); await tick(); await tick();
  assert.equal(f.events.filter(e => e === 'reconcile').length, 1); assert.equal(f.events.includes('generate'), false);
});
test('timeout during reauthorization releases known reservation and never dispatches', { timeout: 1500 }, async () => {
  const f = harness(); let calls = 0;
  f.ports.authorize = async () => { if (++calls === 2) await never(); };
  await rejected(f.run(), 'TIMEOUT'); assert.equal(f.events.filter(e => e === 'release').length, 1); assert.equal(f.events.includes('generate'), false);
});
test('profile timeout tightens the ORIGINAL budget, not a fresh adapter-only timeout', { timeout: 1500 }, async () => {
  const f = harness(1000); f.profile.timeoutMs = 5;
  f.ports.authorize = () => new Promise(resolve => setTimeout(resolve, 15));
  await rejected(f.run(), 'TIMEOUT'); assert.equal(f.events.includes('reserve'), false); assert.equal(f.events.includes('generate'), false);
});
for (const stage of ['settle', 'reconcile']) test(`hung ${stage} is accounting_pending, no automatic retry or full release`, { timeout: 1500 }, async () => {
  const f = harness(); if (stage === 'reconcile') f.adapter.generate = async () => { f.events.push('generate'); return { text: 'Synthetic usage missing' }; };
  f.ports.budget[stage] = () => { f.events.push(stage); return never(); };
  await rejected(f.run(), 'ACCOUNTING_PENDING'); assert.equal(f.events.filter(e => e === 'generate').length, 1); assert.equal(f.events.includes('release'), false);
});
test('uncooperative adapter remains concurrency-accounted until actual resolution', { timeout: 1500 }, async () => {
  const f = harness(); let resolve;
  f.adapter.generate = () => { f.events.push('generate'); return new Promise(r => { resolve = r; }); };
  await rejected(f.run(), 'TIMEOUT'); await rejected(f.run(), 'RATE_LIMITED');
  resolve({ text: 'late', usage: { inputTokens: 1, outputTokens: 1 } }); await tick();
  f.adapter.generate = async () => ({ text: 'next', usage: { inputTokens: 1, outputTokens: 1 } });
  assert.equal((await f.run()).text, 'next'); assert.equal(f.events.filter(e => e === 'settle').length, 1);
});
test('deadline cannot be disabled, infinite or silently invalid', () => {
  const f = harness(); for (const limit of [0, -1, Infinity, 120001, 1.5]) assert.throws(() => new ModelGatewayService(f.ports, [f.adapter], limit), e => e.code === 'CONFIG_INVALID');
});
test('actual noEmit consumer includes gateway implementation; no transpileOnly type bypass', () => {
  assert.deepEqual(compileConsumer('/// <reference types="node" />\nimport { ModelGatewayService } from "@rental-os/platform-server/ai-gateway"; import type { GatewayPorts, ModelAdapter } from "@rental-os/platform-server/ai-gateway"; declare const ports: GatewayPorts; declare const adapter: ModelAdapter; new ModelGatewayService(ports, [adapter], 10);'), []);
});
