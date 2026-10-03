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
