'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reduce = require('./fixtures/ai-native/b04-render.cjs').loadFeature('event-reducer.ts');

const event = (cursor, extra = {}) => ({ cursor, revision: '1', taskId: 'task-1', version: 'v1', type: 'step.updated', ...extra });

test('event reducer requests resync on a cursor gap without coercing large cursors', () => {
  let state = reduce.initialEventTimeline('task-1', 'v1');
  state = reduce.reduceEvent(state, event('9007199254740993')).state;
  const result = reduce.reduceEvent(state, event('9007199254740995'));
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'cursor_gap');
  assert.equal(result.state.resetRequired, true);
  assert.equal(result.state.cursor, null);
  assert.equal(result.state.events.length, 0);
});

test('event reducer still accepts the next exact cursor and isolates task/version changes', () => {
  let state = reduce.initialEventTimeline('task-1', 'v1');
  state = reduce.reduceEvent(state, event('1')).state;
  assert.equal(reduce.reduceEvent(state, event('2')).accepted, true);
  const mixed = reduce.reduceEvent(state, event('2', { taskId: 'task-2' }));
  assert.equal(mixed.reason, 'scope_reset');
});
