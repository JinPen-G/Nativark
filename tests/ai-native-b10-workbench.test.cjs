'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');

test('B10 workbench is feature-local, opt-in and does not add routes or transport', () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/AiTaskWorkbench.tsx'), 'utf8');
  assert.match(source, /export function AiTaskWorkbench/);
  assert.match(source, /TaskList/);
  assert.match(source, /TaskTimeline/);
  assert.match(source, /MissingFieldsPanel/);
  assert.match(source, /HumanConfirmShell/);
  assert.doesNotMatch(source, /fetch\s*\(|axios\.|localStorage|sessionStorage|setInterval|setTimeout/);
  assert.doesNotMatch(source, /AppRouter|react-router|routes?/i);
  assert.match(source, /readTask\?/);
  assert.match(source, /onResync\?/);
});

test('workbench clears detail before every task/context/visibility transition', () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/AiTaskWorkbench.tsx'), 'utf8');
  assert.match(source, /setDetail\(null\)/);
  assert.match(source, /epoch\.current \+= 1/);
  assert.match(source, /abort\.abort\(\)/);
  assert.match(source, /currentEpoch !== epoch\.current/);
  assert.match(source, /visible/);
});

test('task list selection is explicit and unavailable rows are disabled', () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/TaskList.tsx'), 'utf8');
  assert.match(source, /onSelectTask/);
  assert.match(source, /task\.availability !== "available"/);
  assert.match(source, /selectedTaskId/);
});

test('actual workbench function renders host callbacks without starting transport', () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/AiTaskWorkbench.tsx'), 'utf8')
    .replace(/^import .*?;\r?\n/gm, '');
  const slots = [], effects = [];
  let cursor = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect) { cursor++; effects.push(effect); },
  };
  const stub = name => props => React.createElement(name, props);
  const wrapped = `const {useState,useRef,useEffect}=hooks; const TaskList=stub('task-list'),TaskTimeline=stub('task-timeline'),MissingFieldsPanel=stub('missing'),ProposalPreview=stub('proposal'),HumanConfirmShell=stub('confirm'),CancelRecoveryStatus=stub('cancel'),KnowledgeSources=stub('sources'),MemoryPreferences=stub('memory'),AiServiceSummary=stub('service'),CapabilityStatus=stub('capability'),ActionButton=stub('action'),Alert=stub('alert');\n${source}`;
  const js = ts.transpileModule(wrapped, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, hooks, stub, require(name) { if (name === 'react/jsx-runtime') return require('react/jsx-runtime'); throw new Error(name); }, AbortController });
  cursor = 0;
  let reads = 0;
  const reader = async () => { reads++; return { steps: [] }; };
  const tree = exports.AiTaskWorkbench({ tasks: [{ id: 'task-1', scene: 'scene', status: 'running' }], context: { audience: 'operator' }, readTask: reader });
  for (const effect of effects.splice(0)) effect();
  assert.equal(React.isValidElement(tree), true);
  assert.equal(reads, 0, 'no task is selected, so mounting does not read');
  const children = React.Children.toArray(tree.props.children);
  const list = children.find(child => typeof child?.props?.onSelectTask === 'function');
  assert.equal(typeof list.props.onSelectTask, 'function');
  list.props.onSelectTask('task-1');
  assert.equal(reads, 0, 'selection schedules host read through React effect, not directly from the list callback');
});
