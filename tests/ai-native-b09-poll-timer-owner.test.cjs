'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/ai-native/b09-host.cjs');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(app + ' cancelled old clock callback cannot erase new timer ownership', async () => {
    const { AiPollingController, AiPollingLoop } = load('apps/' + app + '/src/components/ai-native/polling-controller.ts');
    const pending = new Map(), retained = new Map(), cleared = []; let id = 0, calls = 0;
    const clock = {
      schedule(fn) { pending.set(++id, fn); retained.set(id, fn); return id; },
      clear(handle) { cleared.push(handle); pending.delete(handle); },
    };
    const loop = new AiPollingLoop(new AiPollingController(async () => { calls++; return { events: [], cursor: null, version: 'fixture-v1' }; }, () => ({ sync: 'synced' })), clock);
    const a = { audience: 'client', tenantId: 'synthetic-A', taskId: 'same' };
    loop.start(a); await flush(); assert.equal(pending.size, 1);
    loop.start({ ...a, tenantId: 'synthetic-B' }); await flush();
    assert.deepEqual([...pending.keys()], [2]);
    // A cancelled callback can already be queued by the host clock.
    retained.get(1)(); await flush(); assert.equal(calls, 2);
    loop.pause();
    assert.deepEqual(cleared, [1, 2]);
    assert.equal(pending.size, 0, 'pause must release the current timer after a stale callback');
    retained.get(2)(); await flush(); assert.equal(calls, 2);
    loop.destroy();
  });
  test(app + ' already consumed callback cannot erase a same-generation successor', async () => {
    const { AiPollingController, AiPollingLoop } = load('apps/' + app + '/src/components/ai-native/polling-controller.ts');
    const pending = new Map(), retained = new Map(); let id = 0, calls = 0;
    const loop = new AiPollingLoop(new AiPollingController(async () => { calls++; return { events: [], cursor: null, version: 'fixture-v1' }; }, () => ({ sync: 'synced' })), {
      schedule(fn) { pending.set(++id, fn); retained.set(id, fn); return id; }, clear(handle) { pending.delete(handle); },
    });
    loop.start({ audience: 'staff', tenantId: 'synthetic-A' }); await flush();
    pending.delete(1); retained.get(1)(); await flush();
    assert.equal(calls, 2); assert.deepEqual([...pending.keys()], [2]);
    retained.get(1)(); await flush(); assert.equal(calls, 2);
    loop.destroy(); assert.equal(pending.size, 0);
  });
}
