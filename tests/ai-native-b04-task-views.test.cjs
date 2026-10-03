'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const fixture = require('./fixtures/ai-native/b04-render.cjs');
const { TaskList } = fixture.loadFeature('TaskList.tsx'), { TaskTimeline } = fixture.loadFeature('TaskTimeline.tsx');
test('task list separates loading, empty, forbidden and failure states', () => { assert.ok(renderToStaticMarkup(React.createElement(TaskList, { page: 1, loading: true })).includes('首次加载中')); assert.ok(renderToStaticMarkup(React.createElement(TaskList, { page: 1, forbidden: true, tasks: [] })).includes('无权限')); assert.ok(renderToStaticMarkup(React.createElement(TaskList, { page: 1, error: 'offline', tasks: [] })).includes('加载失败')); assert.ok(renderToStaticMarkup(React.createElement(TaskList, { page: 1, tasks: [] })).includes('暂无')); });
test('timeline keeps registered and unknown states explicit', () => { const html = renderToStaticMarkup(React.createElement(TaskTimeline, { taskId: 't1', steps: [{ id: 's1', taskId: 't1', action: 'run', status: 'registered' }, { id: 's2', taskId: 't1', action: 'future', status: 'future' }] })); assert.ok(html.includes('已登记，尚未执行')); assert.ok(html.includes('待核对')); assert.equal(html.includes('自动重试'), false); });
