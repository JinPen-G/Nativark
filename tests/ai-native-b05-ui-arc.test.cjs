'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const load = require('./fixtures/ai-native/b04-render.cjs').loadFeature;
const components = ['HumanConfirmShell', 'TaskList', 'MissingFieldsPanel', 'KnowledgeSources', 'MemoryPreferences', 'CancelRecoveryStatus'];
test('AI feature controls render through the UI adapter boundary in offline host mode', () => {
  for (const name of components) assert.equal(typeof load(`${name}.tsx`), 'object');
  const { HumanConfirmShell } = load('HumanConfirmShell.tsx');
  const { MissingFieldsPanel } = load('MissingFieldsPanel.tsx');
  const confirm = renderToStaticMarkup(React.createElement(HumanConfirmShell, { proposalId: 'p', revision: '1' }));
  const fields = renderToStaticMarkup(React.createElement(MissingFieldsPanel, { fields: [{ name: 'x', label: '字段', type: 'text', required: true }], draft: {} }));
  assert.ok(confirm.includes('disabled=""')); assert.ok(fields.includes('input')); assert.ok(fields.includes('disabled=""'));
});

test('supplement input keeps host draft controlled and exposes disabled/error states', () => {
  const { MissingFieldsPanel } = load('MissingFieldsPanel.tsx');
  const markup = renderToStaticMarkup(React.createElement(MissingFieldsPanel, {
    taskId: 'task-1', inputRevision: 3,
    fields: [
      { name: 'kind', label: '类型', type: 'select', required: true, options: ['A', 'B'], error: '请选择类型' },
      { name: 'count', label: '数量', type: 'number', required: true },
    ],
    draft: { kind: 'A', count: '2' }, readOnly: true, error: '暂不可提交',
  }));
  assert.ok(markup.includes('暂不可提交'));
  assert.ok(markup.includes('disabled=""'));
  assert.ok(markup.includes('请选择类型'));
  assert.ok(markup.includes('value="A"'));
});

test('task list disables navigation without a callback and retains rows during refresh errors', () => {
  const { TaskList } = load('TaskList.tsx');
  const markup = renderToStaticMarkup(React.createElement(TaskList, {
    tasks: [{ id: 't1', scene: 'chat', status: 'running', updatedAt: 'now' }],
    page: 0, hasNext: true, loading: true, error: '连接中断', paging: false,
  }));
  assert.ok(markup.includes('正在刷新任务'));
  assert.ok(markup.includes('连接中断'));
  assert.ok(markup.includes('t1'));
  assert.equal((markup.match(/disabled=""/g) ?? []).length, 2);
});
