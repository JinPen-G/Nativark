'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, deferred } = require('./fixtures/ai-native/b09-host.cjs');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
for (const app of ['miniprogram', 'staff-miniprogram']) {
  for (const callback of ['classify', 'notify']) {
    test(app + ' ' + callback + ' context switch cannot block the new polling generation', async () => {
      const { AiPollingController, AiPollingLoop } = load('apps/' + app + '/src/components/ai-native/polling-controller.ts');
      const first = deferred(), calls = [], timers = new Map(), notices = [];
      const a = { audience: 'client', tenantId: 'synthetic-A', taskId: 'same-task' };
      const b = { audience: 'staff', tenantId: 'synthetic-B', taskId: 'same-task' };
      const controller = new AiPollingController(context => {
        calls.push({ ...context });
        return calls.length === 1 ? first.promise : Promise.resolve({ cursor: null, events: [], version: 'fixture-v1' });
      }, () => ({ sync: 'synced' }));
      let loop;
      const recovery = {
        classify() { if (callback === 'classify') loop.retry(b); return 'permission'; },
        notify(value) { notices.push(value); if (callback === 'notify' && value === 'permission') loop.retry(b); },
      };
      loop = new AiPollingLoop(controller, { schedule(fn) { timers.set(1, fn); return 1; }, clear(id) { timers.delete(id); } }, 2000, recovery);
      loop.start(a); first.reject(new Error('synthetic-old-context')); await flush();
      assert.equal(timers.size, 1, 'new host-authorized generation must remain live');
      if (callback === 'classify') assert.deepEqual(notices, [], 'do not notify old failure after classifier changes generation');
      const next = timers.get(1); timers.delete(1); next(); await flush();
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[1], b);
      assert.equal(notices.at(-1), 'synced');
      loop.destroy(); assert.equal(timers.size, 0);
    });
  }
}
