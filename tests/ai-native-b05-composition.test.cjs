'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadFeature } = require('./fixtures/ai-native/b04-render.cjs');

test('B05 offline host composition covers success, partial, unknown and revoked states', () => {
  const { ReadOnlyBoard } = loadFeature('ReadOnlyBoard.tsx');
  const markup = renderToStaticMarkup(React.createElement(ReadOnlyBoard, {
    taskId: 'task-1',
    tasks: [
      { id: 'task-1', scene: 'order', status: 'partially_succeeded', updatedAt: '2026-10-03T00:00:00Z' },
      { id: 'task-2', scene: 'unknown', status: 'future_status', updatedAt: 'invalid' },
    ],
    steps: [
      { id: 'step-1', taskId: 'task-1', action: 'candidate', status: 'registered' },
      { id: 'step-2', taskId: 'task-1', action: 'future', status: 'future_status' },
    ],
    modelText: 'x'.repeat(30000),
    usage: { status: 'unknown' },
    sources: [{ id: 'source-1', title: 'withdrawn secret', version: '2', status: 'withdrawn' }],
    memories: [{ id: 'memory-1', label: '偏好', value: 'revoked secret', status: 'revoked', actorKind: 'automation', revision: '3' }],
  }));
  assert.ok(markup.includes('部分完成'));
  assert.ok(markup.includes('无法识别／待刷新'));
  assert.ok(markup.includes('未知用量'));
  assert.ok(markup.includes('来源内容不可用'));
  assert.ok(markup.includes('内容不可用'));
  assert.ok(markup.includes('内容超过展示上限'));
  assert.ok(markup.includes('已登记，尚未执行'));
});

test('B05 event reset and version changes never preserve a prior cursor', () => {
  const reducer = loadFeature('event-reducer.ts');
  let state = reducer.initialEventTimeline('task-1', 'v1');
  const event = (cursor, extra = {}) => ({ cursor, revision: '1', taskId: 'task-1', version: 'v1', type: 'updated', ...extra });
  state = reducer.reduceEvent(state, event('9007199254740993')).state;
  const reset = reducer.reduceEvent(state, event('9007199254740994', { type: 'reset_required' }));
  assert.equal(reset.state.resetRequired, true);
  assert.equal(reset.state.cursor, null);
  const blocked = reducer.reduceEvent(reset.state, event('9007199254740995'));
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, 'scope_reset');
});
