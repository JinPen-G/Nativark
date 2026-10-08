'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/ai-native/b09-host.cjs');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
for (const app of ['miniprogram', 'staff-miniprogram']) {
  test(app + ' poll loop respects cursor consumption acknowledgement', async () => {
    const base = 'apps/' + app + '/src/components/ai-native/';
    const { AiPollingController, AiPollingLoop } = load(base + 'polling-controller.ts');
    const { initialCursorState } = load(base + 'cursor-adapter.ts');
    const { consumeCursorPage } = load(base + 'cursor-page.ts');
    for (const type of ['reset_required', 'unrecognized', 'wrong-version', 'gap']) {
      let state = { ...initialCursorState('task', 'fixture-v1'), cursor: '9007199254740993' };
      let calls = 0;
      const notices = [], timers = new Map();
      const clock = { schedule(fn) { timers.set(1, fn); return 1; }, clear(id) { timers.delete(id); } };
      const event = { taskId: 'task', version: type === 'wrong-version' ? 'other' : 'fixture-v1', type: type === 'gap' || type === 'wrong-version' ? 'fixture.event' : type, cursor: '9007199254740995' };
      const controller = new AiPollingController(async () => { calls++; return { events: [event], cursor: event.cursor, version: event.version }; }, page => {
        state = consumeCursorPage(state, page.events, false, ['fixture.event']).state;
        return { sync: state.sync };
      });
      const loop = new AiPollingLoop(controller, clock, 2000, { classify: () => 'unknown', notify: value => notices.push(value) });
      const context = { audience: 'staff', tenantId: 'synthetic-A', taskId: 'task' };
      loop.start(context); await flush();
      assert.equal(state.sync, 'unsynced');
      assert.deepEqual(notices, ['unsynced']);
      assert.equal(timers.size, 0);
      loop.start(context); await flush(); assert.equal(calls, 1);
      // Explicit host reauthorization/resynchronization before manual retry.
      state = initialCursorState('task', 'fixture-v1');
      event.type = 'fixture.event'; event.version = 'fixture-v1';
      loop.retry(context); await flush();
      assert.equal(notices.at(-1), 'synced');
      assert.equal(state.cursor, '9007199254740995');
      assert.equal(timers.size, 1);
      loop.destroy(); assert.equal(timers.size, 0);
    }
  });
  test(app + ' a void listener does not prove synchronized consumption', async () => {
    const { AiPollingController, AiPollingLoop } = load('apps/' + app + '/src/components/ai-native/polling-controller.ts');
    const notices = [], timers = new Map();
    const loop = new AiPollingLoop(new AiPollingController(async () => ({ events: [], cursor: null, version: 'fixture-v1' }), () => {}), { schedule(fn) { timers.set(1, fn); return 1; }, clear(id) { timers.delete(id); } }, 2000, { classify: () => 'unknown', notify: value => notices.push(value) });
    loop.start({ audience: 'staff', tenantId: 'synthetic-A' }); await flush();
    assert.ok(!notices.includes('synced'));
    loop.destroy();
  });
}
