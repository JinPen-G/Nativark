'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, deferred } = require('./fixtures/ai-native/b09-host.cjs');

const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const context = { audience: 'client', tenantId: 'synthetic-tenant', workspaceId: 'synthetic-space', taskId: 'synthetic-task' };
const page = { cursor: '1', events: [], version: 'fixture-v1' };

for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(`B15-D ${app} bounds polling ownership and rejects stale context result`, async () => {
    const { AiPollingController, AiPollingLoop } = load(`apps/${app}/src/components/ai-native/polling-controller.ts`);
    const pending = deferred();
    const timers = new Map();
    let id = 0;
    let calls = 0;
    const clock = {
      schedule(fn) { const key = ++id; timers.set(key, fn); return key; },
      clear(key) { timers.delete(key); },
    };
    const controller = new AiPollingController(async (nextContext) => {
      calls += 1;
      assert.equal(typeof nextContext.tenantId, 'string');
      return calls === 1 ? pending.promise : page;
    }, () => ({ sync: 'synced' }));
    const loop = new AiPollingLoop(controller, clock, 2000, { classify: () => 'transient', notify() {} });
    loop.start(context);
    await flush();
    assert.equal(calls, 1);
    loop.start(context);
    await flush();
    assert.equal(calls, 1, 'same context cannot create a second in-flight request');
    loop.start({ ...context, tenantId: 'synthetic-other' });
    pending.resolve(page);
    await flush();
    assert.equal(calls, 1, 'the old request must settle before the new generation starts');
    const nextTimerKey = [...timers.keys()][0];
    const nextTimer = timers.get(nextTimerKey);
    assert.equal(typeof nextTimer, 'function');
    timers.delete(nextTimerKey);
    nextTimer();
    await flush();
    assert.equal(calls, 2);
    loop.destroy();
    assert.equal(timers.size, 0);
    const staleTimerCount = timers.size;
    for (const fn of [...timers.values()]) fn();
    await flush();
    assert.equal(timers.size, staleTimerCount);
  });
}
