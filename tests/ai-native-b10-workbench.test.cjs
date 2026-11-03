'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
function loadLifecycleSession(file = 'conversation-lifecycle-session.ts', imports = {}) {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, AbortController, structuredClone, TextEncoder, Uint8Array, crypto: require('node:crypto').webcrypto, require(name) {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name === '@rental-os/shared') return require('../packages/shared/src/index');
    throw Error(name);
  } });
  return exports;
}

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

test('actual conversation history stays explicit, capability-bound and retracts late hidden reads', async () => {
  const file = path.join(root, 'apps/admin/src/features/ai-native/ConversationHistory.tsx');
  const source = fs.readFileSync(file, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], pending = [], cleaners = new Map(); let cursor = 0, calls = [], current = true, responder;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++; if (!equal(slots[i], deps)) { slots[i] = deps; pending.push(() => {
      cleaners.get(i)?.(); cleaners.set(i, effect());
    }); } },
  };
  const document = { hidden: false, addEventListener(_name, handler) { this.change = handler; }, removeEventListener() { this.change = null; } };
  const stub = name => props => React.createElement(name, props);
  const shared = require('../packages/shared/src/ai-conversation-draft');
  const api = { list: async (query, signal) => { calls.push({ query, signal }); return responder(query, signal); } };
  const exports = {};
  vm.runInNewContext(output, { exports, document, AbortController, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@rental-os/shared') return { ...shared, AI_SCENE_CODES: ['order_explanation', 'opening_diagnosis', 'quote_clarification'] };
    if (name === '@/api/aiConversations') return { aiConversationsApi: api };
    if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert'), Select: stub('select'), Button: stub('button') };
    if (name === './ConversationDetail') return { ConversationDetail: stub('conversation-detail') };
    if (name === './ConversationLifecycle') return { ConversationLifecycle: stub('conversation-lifecycle') };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: text => text }) };
    if (name === './ConversationResult') return { ConversationResult: stub('conversation-result') };
    if (name === './ConversationAdmission') return { ConversationAdmission: stub('conversation-admission') };
    if (name === './formatters') return { formatTimestamp: time => ({ value: time }) };
    if (name === './safe-display') return { safeDisplayText: text => text };
    if (name.endsWith('.css')) return { default: {} };
    throw Error(name);
  } });
  const render = (enabled = true) => { cursor = 0; const tree = exports.ConversationHistory({ current: () => current, enabled, identity: 'owner-scope' });
    pending.splice(0).forEach(effect => effect()); return tree; };
  const nodes = tree => {
    const result = []; const walk = node => { for (const child of React.Children.toArray(node)) if (React.isValidElement(child)) {
      result.push(child); walk(child.props.children);
    } }; walk(tree); return result;
  };
  const action = (tree, label) => nodes(tree).find(node => node.props.label === label);
  const page = (capabilityCode = 'order_explanation', more = true) => ({ draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION,
    items: [{ conversationId: 'conversation-1', capabilityCode, revision: 1, status: 'active', createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' }],
    nextBeforeId: more ? 'conversation-1' : null, coverage: 'page_not_total' });
  assert.equal(render(false), null); assert.equal(calls.length, 0);
  let tree = render(); assert.equal(calls.length, 0);
  responder = async () => page();
  await action(tree, '读取本人对话').props.onAction(); tree = render();
  assert.equal(calls.length, 1); assert.equal(calls[0].query.beforeId, undefined);
  assert.ok(nodes(tree).some(node => node.type === 'time'));
  nodes(tree).find(node => typeof node.props.onClick === 'function' && node.props['aria-pressed'] === false).props.onClick();
  tree = render(); assert.ok(nodes(tree).some(node => node.props.conversationId === 'conversation-1'));
  assert.equal(calls.length, 1, 'selection alone does not fetch turns');
  await action(tree, '下一页').props.onAction(); tree = render();
  assert.equal(calls[1].query.beforeId, 'conversation-1');
  await action(tree, '上一页').props.onAction(); tree = render(); assert.equal(calls[2].query.beforeId, undefined);
  const select = nodes(tree).find(node => node.props['aria-label'] === '对话能力');
  select.props.onChange('opening_diagnosis'); tree = render();
  assert.ok(!nodes(tree).some(node => node.type === 'time')); assert.equal(calls.length, 3, 'changing a filter does not issue a request');
  responder = async () => page('opening_diagnosis', false);
  await action(tree, '读取本人对话').props.onAction(); tree = render();
  assert.equal(calls[3].query.capabilityCode, 'opening_diagnosis'); assert.equal(action(tree, '下一页').props.disabled, true);
  responder = async () => { throw Object.assign(Error('denied'), { response: { status: 403 } }); };
  await assert.rejects(action(tree, '重读对话首页').props.onAction(), /denied/); tree = render();
  assert.ok(!nodes(tree).some(node => node.type === 'time')); assert.ok(nodes(tree).some(node => node.props.title?.startsWith('对话历史当前不可读取')));
  let resolve; responder = () => new Promise(done => { resolve = done; });
  const hidden = action(tree, '读取本人对话').props.onAction();
  document.hidden = true; document.change(); assert.equal(calls.at(-1).signal.aborted, true);
  resolve(page()); await assert.rejects(hidden, /AI_SCOPE_CHANGED/); tree = render();
  assert.ok(!nodes(tree).some(node => node.type === 'time'));
  document.hidden = false; document.change(); tree = render();
  const closed = action(tree, '读取本人对话').props.onAction(); render(false);
  assert.equal(calls.at(-1).signal.aborted, true); resolve(page()); await assert.rejects(closed, /AI_SCOPE_CHANGED/);
  tree = render(); current = false;
  const count = calls.length; await assert.rejects(action(tree, '读取本人对话').props.onAction(), /AI_SCOPE_CHANGED/); assert.equal(calls.length, count);
  cleaners.forEach(cleanup => cleanup?.());
  const host = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/TaskCenterPage.tsx'), 'utf8');
  assert.match(host, /import \{ ConversationHistory \} from '\.\/ConversationHistory'/u);
  assert.match(host, /enabled=\{historyOpen\.includes\('conversations'\) && visible\}/u);
  assert.match(host, /<Accordion value=\{historyOpen\} onValueChange=\{setHistoryOpen\}/u);
});

test('actual conversation detail loads explicitly and retracts on switch, hide, refusal and unmount', async () => {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationDetail.tsx'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], effects = [], cleaners = new Map(); let cursor = 0, current = true, responder, calls = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => !Object.is(value, slots[i][index]))) {
      slots[i] = deps; effects.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } },
  };
  const document = { hidden: false, addEventListener(_name, handler) { this.change = handler; }, removeEventListener() { this.change = null; } };
  const stub = name => props => React.createElement(name, props), exports = {};
  vm.runInNewContext(output, { exports, document, AbortController, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@rental-os/shared') return require('../packages/shared/src/ai-conversation-draft');
    if (name === '@/api/aiConversations') return { aiConversationsApi: { detail: async (query, capability, signal) => {
      calls.push({ query, capability, signal }); return responder(query);
    } } };
    if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert') };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: text => text }) };
    if (name === './ConversationResult') return { ConversationResult: stub('conversation-result') };
    if (name === './ConversationAdmission') return { ConversationAdmission: stub('conversation-admission') };
    if (name === './formatters') return { formatTimestamp: time => ({ value: time }) };
    if (name === './safe-display') return { safeDisplayText: text => text };
    if (name.endsWith('.css')) return { default: {} };
    throw Error(name);
  } });
  const render = (conversationId = 'conversation-a') => {
    cursor = 0; const tree = exports.ConversationDetail({ conversationId, capabilityCode: 'order_explanation', current: () => current });
    effects.splice(0).forEach(effect => effect()); return tree;
  };
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => {
    if (React.isValidElement(child)) { out.push(child); walk(child.props.children); }
  }); walk(tree); return out; };
  const action = (tree, label) => nodes(tree).find(node => node.props.label === label);
  const result = query => ({ conversation: { conversationId: query.conversationId, revision: 1, currentTurn: null },
    turns: { items: [{ turnId: 'turn-a', original: { inputRef: 'input-a' }, material: 'erased',
      task: { taskId: 'task-a', runId: 'run-a' }, createdAt: '2026-11-03T00:00:00Z' }], nextBeforeId: 'turn-a' } });
  responder = async query => result(query);
  let tree = render(); tree = render(); assert.equal(calls.length, 0);
  await action(tree, '读取原轮次').props.onAction(); tree = render();
  assert.equal(calls.length, 1); assert.ok(nodes(tree).some(node => node.type === 'time'));
  const text = nodes(tree).flatMap(node => React.Children.toArray(node.props.children).filter(child => typeof child === 'string')).join(' ');
  assert.match(text, /原输入已清理/); assert.match(text, /执行结果另行读取/);
  await action(tree, '更早轮次').props.onAction(); tree = render(); assert.equal(calls[1].query.beforeId, 'turn-a');
  const old = action(tree, '重读轮次首页').props.onAction;
  render('conversation-b'); tree = render('conversation-b');
  assert.ok(!nodes(tree).some(node => node.type === 'time'));
  const count = calls.length; await assert.rejects(old(), /AI_SCOPE_CHANGED/); assert.equal(calls.length, count);
  responder = async () => { throw Error('unavailable'); };
  await assert.rejects(action(tree, '读取原轮次').props.onAction(), /unavailable/); tree = render('conversation-b');
  assert.ok(nodes(tree).some(node => node.props.title?.startsWith('对话详情当前不可读取')));
  let resolve; responder = () => new Promise(done => { resolve = done; });
  const hidden = action(tree, '读取原轮次').props.onAction(); document.hidden = true; document.change();
  assert.equal(calls.at(-1).signal.aborted, true); resolve(result({ conversationId: 'conversation-b' }));
  await assert.rejects(hidden, /AI_SCOPE_CHANGED/); tree = render('conversation-b');
  assert.ok(!nodes(tree).some(node => node.type === 'time'));
  document.hidden = false; document.change(); tree = render('conversation-b');
  const pending = action(tree, '读取原轮次').props.onAction(); cleaners.forEach(cleanup => cleanup?.());
  assert.equal(calls.at(-1).signal.aborted, true); resolve(result({ conversationId: 'conversation-b' }));
  await assert.rejects(pending, /AI_SCOPE_CHANGED/);
  current = false; const lastCount = calls.length;
  await assert.rejects(action(tree, '读取原轮次').props.onAction(), /AI_SCOPE_CHANGED/); assert.equal(calls.length, lastCount);
});

test('actual original-turn result stays explicit and retracts text on refusal, switch, hide and unmount', async () => {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationResult.tsx'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], effects = [], cleaners = new Map(); let cursor = 0, current = true, responder, calls = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => !Object.is(value, slots[i][index]))) {
      slots[i] = deps; effects.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } },
  };
  const document = { hidden: false, addEventListener(_name, fn) { this.change = fn; }, removeEventListener() { this.change = null; } };
  const stub = name => props => React.createElement(name, props), exports = {};
  vm.runInNewContext(output, { exports, document, AbortController, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@rental-os/shared') return require('../packages/shared/src/ai-conversation-draft');
    if (name === '@/api/aiConversations') return { aiConversationsApi: { result: async (query, turn, signal) => {
      calls.push({ query, turn, signal }); return responder(query, turn);
    } } };
    if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert') };
    if (name === './ModelText') return { ModelText: stub('model-text') };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: value => value }) };
    if (name === './ConversationClosure') return { ConversationClosure: stub('conversation-closure') };
    if (name === './ConversationTaskCreation') return { ConversationTaskCreation: stub('conversation-task-creation') };
    if (name === './safe-display') return { safeDisplayText: value => value };
    if (name.endsWith('.css')) return { default: {} };
    throw Error(name);
  } });
  const turn = { turnId: 'turn-a', admissionKey: 'admission-a', task: { taskId: 'task-a', runId: 'run-a' }, material: 'retained' };
  const render = (conversationId = 'conversation-a', selected = turn) => {
    cursor = 0; const tree = exports.ConversationResult({ conversationId, turn: selected, current: () => current });
    effects.splice(0).forEach(effect => effect()); return tree;
  };
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => {
    if (React.isValidElement(child)) { out.push(child); walk(child.props.children); }
  }); walk(tree); return out; };
  const action = tree => nodes(tree).find(node => typeof node.props.onAction === 'function');
  const displayed = tree => nodes(tree).find(node => node.props.text !== undefined);
  const result = { status: 'observed', turn, result: { status: 'available', text: { value: '<script>not executable</script>' } } };
  responder = async () => result;
  let tree = render(); tree = render(); assert.equal(calls.length, 0);
  await action(tree).props.onAction(); tree = render(); assert.equal(displayed(tree).props.text, result.result.text.value);
  assert.equal(calls[0].query.admissionKey, turn.admissionKey);
  const old = action(tree).props.onAction;
  render('conversation-b'); tree = render('conversation-b'); assert.equal(displayed(tree), undefined);
  const count = calls.length; await assert.rejects(old(), /AI_SCOPE_CHANGED/); assert.equal(calls.length, count);
  responder = async () => { throw Error('denied'); };
  await assert.rejects(action(tree).props.onAction(), /denied/); tree = render('conversation-b');
  assert.equal(displayed(tree), undefined); assert.ok(nodes(tree).some(node => node.props.title?.startsWith('原结果当前不可读取')));
  for (const status of ['stale', 'unknown', 'failed']) {
    responder = async () => ({ ...result, result: { status, text: null } });
    await action(tree).props.onAction(); tree = render('conversation-b'); assert.equal(displayed(tree), undefined);
  }
  const erased = { ...turn, material: 'erased' }; render('conversation-b', erased); tree = render('conversation-b', erased);
  responder = async () => ({ status: 'material_erased', turn: erased, result: null });
  await action(tree).props.onAction(); tree = render('conversation-b', erased); assert.equal(displayed(tree), undefined);
  render('conversation-b'); tree = render('conversation-b');
  let resolve; responder = () => new Promise(done => { resolve = done; });
  const pending = action(tree).props.onAction(); document.hidden = true; document.change();
  assert.equal(calls.at(-1).signal.aborted, true); resolve(result); await assert.rejects(pending, /AI_SCOPE_CHANGED/);
  tree = render('conversation-b'); assert.equal(displayed(tree), undefined);
  document.hidden = false; document.change(); tree = render('conversation-b');
  const unmounted = action(tree).props.onAction(); cleaners.forEach(fn => fn?.());
  assert.equal(calls.at(-1).signal.aborted, true); resolve(result); await assert.rejects(unmounted, /AI_SCOPE_CHANGED/);
  const before = calls.length; await assert.rejects(action(tree).props.onAction(), /AI_SCOPE_CHANGED/); assert.equal(calls.length, before);
  current = false; await assert.rejects(action(tree).props.onAction(), /AI_SCOPE_CHANGED/); assert.equal(calls.length, before);
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationDetail.tsx'), 'utf8');
  assert.match(source, /ConversationResult key=\{turn.turnId\}/u);
});

test('conversation lifecycle journals before sending and reconciles without replaying unknown writes', async () => {
  const { ConversationLifecycleSession } = loadLifecycleSession();
  const { AI_CONVERSATION_DRAFT_VERSION: draftVersion } = require('../packages/shared/src/ai-conversation-draft');
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let sends = 0, keys = 0, current = true, reply;
  const receipt = command => ({ draftVersion, operationKey: command.operationKey, retryable: false, status: 'observed',
    conversationId: command.conversationId ?? 'conversation-a', revision: (command.expectedRevision ?? 0) + 1,
    operation: 'create', taskCancellation: 'not_requested', businessRecords: 'not_modified' });
  const ports = { create: async command => { sends++; assert.ok([...values.values()].some(value => { try { return JSON.parse(value).command.operationKey === command.operationKey; } catch { return false; } })); return reply(command); },
    archive: async command => { sends++; return { ...receipt(command), operation: 'archive' }; },
    delete: async command => { sends++; return { ...receipt(command), operation: 'delete' }; },
    operation: async command => reply(command) };
  const session = new ConversationLifecycleSession(ports, () => current, storage, 'owner', () => `operation-${++keys}`);
  reply = async command => receipt(command);
  assert.equal(session.snapshot().locked, false); assert.equal(sends, 0);
  await session.create('order_explanation'); assert.equal(sends, 1); assert.equal(values.size, 0);
  reply = async () => { throw Error('lost response'); };
  await assert.rejects(session.create('order_explanation'), /lost response/);
  assert.equal(session.snapshot().locked, true); assert.equal(values.size, 1);
  await assert.rejects(session.create('order_explanation'), /AI_RESULT_UNKNOWN/); assert.equal(sends, 2); assert.equal(keys, 2);
  const missing = command => ({ draftVersion, operationKey: command.operationKey, retryable: false, status: 'not_observed',
    nextAction: 'read_original_operation', absence: 'not_proof_of_no_commit' });
  reply = async command => missing(command);
  await assert.rejects(session.reconcile(), /AI_RESULT_UNKNOWN/); assert.equal(session.snapshot().locked, true); assert.equal(sends, 2);
  const reopened = new ConversationLifecycleSession(ports, () => current, storage, 'owner', () => `operation-${++keys}`);
  reply = async command => receipt(command); await reopened.reconcile();
  assert.equal(reopened.snapshot().locked, false); assert.equal(sends, 2); assert.equal(keys, 2);
  await reopened.mutate('archive', 'conversation-a', 1); assert.equal(reopened.snapshot().receipt.operation, 'archive');
  await reopened.mutate('delete', 'conversation-a', 2); assert.equal(reopened.snapshot().receipt.revision, 3);
  const offline = new ConversationLifecycleSession(ports, () => current, undefined, 'none');
  await assert.rejects(offline.create('order_explanation'), /AI_RESULT_UNKNOWN/); assert.equal(sends, 4);
  const broken = new ConversationLifecycleSession(ports, () => current, { ...storage, setItem() { throw Error('storage failed'); } }, 'broken', () => 'broken-key');
  await assert.rejects(broken.create('order_explanation'), /storage failed/); assert.equal(sends, 4); assert.equal(broken.snapshot().locked, true);
  const corrupt = new ConversationLifecycleSession(ports, () => current, storage, 'corrupt', () => 'corrupt-key');
  reply = async command => ({ ...receipt(command), taskCancellation: 'cancelled' });
  await assert.rejects(corrupt.create('order_explanation'), /AI_RESULT_UNKNOWN/); assert.equal(corrupt.snapshot().locked, true);
  current = false; await assert.rejects(corrupt.reconcile(), /AI_SCOPE_CHANGED/); assert.equal(values.size, 1);
  current = true; values.set('corrupt', '{bad json'); await assert.rejects(corrupt.reconcile()); assert.equal(corrupt.snapshot().locked, true);
  const conflict = new ConversationLifecycleSession(ports, () => current, storage, 'conflict', () => 'conflict-key');
  reply = async () => { throw Object.assign(Error('revision'), { response: { data: { code: 'AI_REVISION_CONFLICT' } } }); };
  await assert.rejects(conflict.create('order_explanation'), /revision/); assert.equal(conflict.snapshot().locked, false);
  let resolve; reply = () => new Promise(done => { resolve = done; });
  const pending = conflict.create('order_explanation'); conflict.retract();
  resolve(receipt({ operationKey: 'conflict-key' })); await assert.rejects(pending, /AI_SCOPE_CHANGED/);
  assert.equal(conflict.snapshot().locked, true); conflict.dispose();
  await assert.rejects(conflict.reconcile(), /AI_SCOPE_CHANGED/);
  for (const action of ['archive', 'delete']) {
    const key = `lost-${action}`, operation = new ConversationLifecycleSession({ ...ports,
      [action]: async () => { throw Error('lost mutation acknowledgement'); } }, () => current, storage, key, () => key);
    await assert.rejects(operation.mutate(action, 'conversation-a', 7), /lost mutation acknowledgement/);
    assert.equal(operation.snapshot().locked, true);
    reply = async command => ({ ...receipt(command), operation: action, conversationId: 'other-conversation', revision: 8 });
    await assert.rejects(operation.reconcile(), /AI_RESULT_UNKNOWN/); assert.equal(operation.snapshot().locked, true);
    reply = async command => ({ ...receipt(command), operation: action, conversationId: 'conversation-a', revision: 8 });
    await operation.reconcile(); assert.equal(operation.snapshot().locked, false);
  }
  const longId = 'x'.repeat(191), longKey = 'k'.repeat(128);
  const longReceipt = { draftVersion: 'ain-conversation-unstarted-draft-1', operationKey: longKey, retryable: false,
    status: 'observed', conversationId: longId, revision: 4294967294, operation: 'close_unstarted', creation: 'permanently_closed',
    task: 'not_created', taskCancellation: 'not_requested', businessRecords: 'not_modified' };
  const longPorts = { ...ports, closeUnstarted: async () => { throw Error('lost long closure'); }, operation: async () => longReceipt };
  const longClosure = new ConversationLifecycleSession(longPorts, () => current, storage, 'long-close', () => longKey, true);
  await assert.rejects(longClosure.close('closeUnstarted', longId, 4294967293, longId, longId), /lost long closure/);
  assert.ok(values.get('long-close').length > 1024); assert.ok(values.get('long-close').length <= 2048);
  const longRecovery = new ConversationLifecycleSession(longPorts, () => current, storage, 'long-close', () => { throw Error('no new long key'); }, true);
  await longRecovery.reconcile(); await longRecovery.completeClosure(async (_proof, acknowledge) => acknowledge());
  assert.equal(values.has('long-close'), false); assert.equal(longRecovery.snapshot().locked, false);
});

test('actual lifecycle controls are explicit, retract history and preserve original journal across panel closure', async () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationLifecycle.tsx'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], effects = [], cleaners = new Map(); let cursor = 0, current = true, clears = 0, keys = 0, sends = 0;
  const hooks = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i][j]))) {
      slots[i] = deps; effects.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } },
  };
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const document = { hidden: false, addEventListener(_event, fn) { this.change = fn; }, removeEventListener() { this.change = null; } };
  const stub = name => props => React.createElement(name, props), exports = {};
  const original = loadLifecycleSession();
  const shared = require('../packages/shared/src/ai-conversation-draft');
  const api = Object.fromEntries(['create', 'archive', 'delete', 'operation'].map(action => [action, async command => {
    sends++; return { draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION, operationKey: command.operationKey, retryable: false,
      status: 'observed', operation: action, conversationId: command.conversationId ?? 'new-conversation',
      revision: (command.expectedRevision ?? 0) + 1, taskCancellation: 'not_requested', businessRecords: 'not_modified' };
  }]));
  vm.runInNewContext(output, { exports, document, window: { sessionStorage: storage }, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@/api/aiConversations') return { aiConversationsApi: api };
    if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert'), ConfirmAction: stub('confirm') };
    if (name === './conversation-lifecycle-session') return { ConversationLifecycleSession: class extends original.ConversationLifecycleSession {
      constructor(...args) { super(...args, () => `ui-operation-${++keys}`); }
    } };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: v => v }) };
    if (name === './safe-display') return { safeDisplayText: v => v };
    throw Error(name);
  } });
  const target = { conversationId: 'conversation-a', revision: 1, status: 'active' };
  const render = (capability = 'order_explanation', selected = target, enabled = true) => {
    cursor = 0; const tree = exports.ConversationLifecycle({ identity: 'owner-scope', enabled, capability, target: selected,
      current: () => current, onCommitted: () => { clears++; } }); effects.splice(0).forEach(fn => fn()); return tree;
  };
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => {
    if (React.isValidElement(child)) { out.push(child); walk(child.props.children); }
  }); walk(tree); return out; };
  const find = (tree, label) => nodes(tree).find(node => node.props.label === label);
  let tree = render(); assert.equal(sends, 0);
  await find(tree, '新建当前能力对话').props.onAction(); tree = render(); assert.equal(sends, 1); assert.equal(clears, 2);
  const stale = find(tree, '删除所选对话').props.onConfirm;
  render('order_explanation', { ...target, revision: 2 }); tree = render('order_explanation', { ...target, revision: 2 });
  assert.throws(stale, /AI_SCOPE_CHANGED/); assert.equal(sends, 1);
  await find(tree, '归档所选对话').props.onConfirm(); tree = render('all');
  assert.equal(find(tree, '新建当前能力对话').props.disabled, true);
  assert.equal(typeof find(tree, '删除所选对话').props.onConfirm, 'function');
  document.hidden = true; document.change(); tree = render();
  await assert.rejects(find(tree, '新建当前能力对话').props.onAction(), /AI_SCOPE_CHANGED/);
  document.hidden = false; tree = render('order_explanation', target, false);
  assert.equal(find(tree, '删除所选对话').props.disabled, true);
  cleaners.forEach(fn => fn?.()); current = false;
  await assert.rejects(find(tree, '新建当前能力对话').props.onAction(), /AI_SCOPE_CHANGED/);
  assert.match(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationHistory.tsx'), 'utf8'), /ConversationLifecycle identity=\{identity\}/u);
});

test('original order admission retains one key and hash without durable body or resend after uncertainty', async () => {
  const hashing = loadLifecycleSession('budget-settings-session.ts');
  const { ConversationAdmissionSession } = loadLifecycleSession('conversation-admission-session.ts', { './budget-settings-session': hashing });
  const shared = require('../packages/shared/src/index'), draftVersion = shared.AI_CONVERSATION_DRAFT_VERSION;
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let calls = 0, current = true, saved, reply;
  const ports = { admit: async command => { calls++; saved = command; return reply(command); }, admission: async command => reply(command) };
  const observation = { draftVersion, conversationId: 'conversation-a', revision: 1, capabilityCode: 'order_explanation', status: 'active',
    currentTurn: null, createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
    taskCancellation: 'separate_original_operation', businessRecords: 'not_modified' };
  const packet = async command => ({ draftVersion, conversationId: command.conversationId, admissionKey: command.admissionKey,
    result: { admissionKey: command.admissionKey, turnId: 'turn-a', originalRequestKey: 'original-key',
      requestHash: await hashing.commandHash(saved.request), capabilityCode: 'order_explanation', capabilityVersion: '1',
      createdAt: '2026-11-03T00:00:00Z', automaticRetry: false, status: 'original_bound',
      original: { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: 'input-a' }, execution: 'not_inferred_from_association', material: 'retained', task: null },
    absence: 'not_proof_of_no_commit', retryable: false });
  const session = new ConversationAdmissionSession('conversation-a', ports, () => current, storage, 'journal', () => 'admission-a');
  await assert.rejects(session.prepare({ ...observation, status: 'archived' }, 'order-a', 'status'), /AI_INVALID_INPUT/);
  await session.prepare(observation, 'order-a', 'fees'); assert.equal(calls, 0); assert.equal(session.snapshot().prepared, true);
  assert.equal(session.snapshot().reviewedInput.orderId, 'order-a');
  assert.equal(values.get('journal').includes('order-a'), false); assert.equal(values.get('journal').includes('fees'), false);
  reply = async () => { throw Error('lost response'); }; await assert.rejects(session.send(), /lost response/);
  assert.equal(calls, 1); assert.equal(session.snapshot().reviewedInput, null);
  await assert.rejects(session.send(), /AI_RESULT_UNKNOWN/); assert.equal(calls, 1);
  reply = async command => ({ draftVersion, conversationId: command.conversationId, admissionKey: command.admissionKey, result: null,
    absence: 'not_proof_of_no_commit', retryable: false });
  await assert.rejects(session.reconcile(), /AI_RESULT_UNKNOWN/); assert.equal(session.snapshot().locked, true);
  session.dispose();
  let allowNextKey = false;
  const restored = new ConversationAdmissionSession('conversation-a', ports, () => current, storage, 'journal', () => {
    assert.equal(allowNextKey, true, 'recovery must not regenerate a key before trusted rotation'); return 'admission-next';
  });
  reply = packet; const result = await restored.reconcile(); assert.equal(result.result.task, null); assert.equal(calls, 1);
  const occupied = { ...observation, revision: 2, currentTurn: result.result };
  assert.equal(restored.canClose(occupied), true);
  assert.equal(restored.canClose({ ...occupied, revision: 3 }), false);
  assert.equal(restored.canClose({ ...occupied, currentTurn: { ...result.result, admissionKey: 'another-key' } }), false);
  assert.equal(restored.canClose({ ...occupied, currentTurn: { ...result.result, requestHash: 'b'.repeat(64) } }), false);
  const noMarker = new ConversationAdmissionSession('conversation-a', ports, () => current, storage, 'missing', () => { throw Error('no new close key'); });
  assert.equal(noMarker.canClose(occupied), false);
  assert.throws(() => noMarker.assertClosure(occupied), /AI_RESULT_UNKNOWN/);
  assert.equal(restored.snapshot().locked, true); await assert.rejects(restored.prepare(observation, 'order-b', 'status'), /AI_RESULT_UNKNOWN/);
  reply = async command => ({ ...await packet(command), result: { ...(await packet(command)).result, requestHash: 'b'.repeat(64) } });
  await assert.rejects(restored.reconcile(), /AI_RESULT_UNKNOWN/);
  current = false; await assert.rejects(restored.reconcile(), /AI_SCOPE_CHANGED/); current = true;
  const closed = new ConversationAdmissionSession('conversation-a', ports, () => current, storage, 'unsent', () => 'unsent-key');
  await closed.prepare(observation, 'order-a', 'status'); closed.retract();
  await assert.rejects(closed.send(), /AI_RESULT_UNKNOWN/); assert.equal(calls, 1);
  const badStorage = new ConversationAdmissionSession('conversation-a', ports, () => current,
    { getItem: () => null, setItem: () => { throw Error('storage failed'); } }, 'broken', () => 'broken-key');
  await assert.rejects(badStorage.prepare(observation, 'order-a', 'status'), /storage failed/); assert.equal(calls, 1);
  const changedMarker = new ConversationAdmissionSession('conversation-a', ports, () => current, storage, 'tampered', () => 'tampered-key');
  await changedMarker.prepare(observation, 'order-a', 'status');
  values.set('tampered', JSON.stringify({ ...JSON.parse(values.get('tampered')), expectedRevision: 2 }));
  await assert.rejects(changedMarker.send(), /AI_RESULT_UNKNOWN/); assert.equal(calls, 1, 'changed journal cannot send the retained body');
  const interrupted = new ConversationAdmissionSession('conversation-a', ports, () => current, storage, 'interrupted', () => 'interrupted-key');
  await interrupted.prepare(observation, 'order-a', 'status');
  let resolve; reply = () => new Promise(done => { resolve = done; });
  const inFlight = interrupted.send();
  // Hash verification awaits before transmission; wait for the fake port, not a timer.
  for (let i = 0; i < 100 && !resolve; i++) await new Promise(done => setImmediate(done));
  assert.equal(typeof resolve, 'function'); interrupted.retract();
  resolve(await packet(saved)); await assert.rejects(inFlight, /AI_SCOPE_CHANGED/);
  assert.equal(interrupted.snapshot().locked, true); assert.equal(interrupted.snapshot().observation, null);
  const closure = { draftVersion: shared.AI_CONVERSATION_UNSTARTED_DRAFT_VERSION, operationKey: 'closure-a', retryable: false,
    status: 'observed', conversationId: 'conversation-a', revision: 3, operation: 'close_unstarted', creation: 'permanently_closed',
    task: 'not_created', taskCancellation: 'not_requested', businessRecords: 'not_modified' };
  const closedTurn = { ...(await packet({ ...observation, admissionKey: 'admission-a' })).result,
    requestHash: JSON.parse(values.get('journal')).requestHash, creation: 'permanently_closed', closeOperationKey: 'closure-a' };
  reply = async command => ({ ...await packet(command), result: { ...closedTurn, admissionKey: command.admissionKey } });
  const binding = { turnId: 'turn-a', originalInputRef: 'input-a', expectedRevision: 2 };
  const reads = { operation: async () => closure, read: async () => ({ ...observation, revision: 3 }) };
  const acknowledged = () => {};
  await assert.rejects(restored.rotate({ operation: async () => { throw Error('must not read without acknowledgement'); },
    read: reads.read }, 'closure-a', binding), /AI_RESULT_UNKNOWN/);
  assert.equal(values.get('journal').includes('rotation'), false);
  await assert.rejects(restored.rotate({ ...reads, operation: async () => ({ ...closure, task: 'created' }) }, 'closure-a', binding, acknowledged), /AI_RESULT_UNKNOWN/);
  assert.equal(restored.snapshot().locked, true);
  await assert.rejects(restored.rotate({ ...reads, read: async () => ({ ...observation, revision: 4 }) }, 'closure-a', binding, acknowledged), /AI_RESULT_UNKNOWN/);
  await assert.rejects(restored.rotate(reads, 'closure-a', { ...binding, turnId: 'another-turn' }, acknowledged), /AI_RESULT_UNKNOWN/);
  await assert.rejects(restored.rotate(reads, 'closure-a', { ...binding, expectedRevision: 3 }, acknowledged), /AI_RESULT_UNKNOWN/);
  await assert.rejects(restored.rotate({ ...reads, read: async () => ({ ...observation, revision: 3, currentTurn: closedTurn }) }, 'closure-a', binding, acknowledged), /AI_RESULT_UNKNOWN/);
  const originalMarker = values.get('journal');
  await assert.rejects(restored.rotate({ ...reads, read: async () => {
    values.set('journal', JSON.stringify({ ...JSON.parse(originalMarker), admissionKey: 'replacement-key' }));
    return { ...observation, revision: 3 };
  } }, 'closure-a', binding, acknowledged), /AI_RESULT_UNKNOWN/);
  assert.equal(JSON.parse(values.get('journal')).admissionKey, 'replacement-key', 'never remove a replacement journal');
  values.set('journal', originalMarker);
  await assert.rejects(restored.rotate(reads, 'closure-a', binding, () => { throw Error('closure journal deletion failed'); }), /closure journal deletion failed/);
  assert.equal(restored.snapshot().rotationPending, true);
  assert.equal(JSON.parse(values.get('journal')).rotation.operationKey, 'closure-a');
  const recoveredRotation = new ConversationAdmissionSession('conversation-a', ports, () => current, storage, 'journal', () => {
    assert.equal(allowNextKey, true, 'no new admission key while rotation is incomplete'); return 'admission-next';
  });
  assert.equal(recoveredRotation.snapshot().locked, true); assert.equal(recoveredRotation.snapshot().rotationPending, true);
  assert.equal(recoveredRotation.canClose(occupied), false, 'rotation cannot create another closure');
  await assert.rejects(recoveredRotation.resumeRotation(reads, () => false), /AI_RESULT_UNKNOWN/);
  await assert.rejects(recoveredRotation.prepare(observation, 'order-a', 'status'), /AI_RESULT_UNKNOWN/);
  await recoveredRotation.resumeRotation(reads, () => true); assert.equal(recoveredRotation.snapshot().locked, false); assert.equal(values.has('journal'), false);
  allowNextKey = true;
  await recoveredRotation.prepare({ ...observation, revision: 3 }, 'order-a', 'status'); assert.equal(recoveredRotation.snapshot().prepared, true);
  const longId = 'x'.repeat(191), longKey = 'k'.repeat(128), longHash = 'a'.repeat(64);
  const longOriginal = { draftVersion, conversationId: longId, admissionKey: longKey, expectedRevision: 4294967292,
    requestHash: longHash, capabilityCode: 'order_explanation' };
  values.set('long-rotation', JSON.stringify(longOriginal));
  const longTurn = { ...closedTurn, admissionKey: longKey, turnId: longId, requestHash: longHash,
    original: { ...closedTurn.original, inputRef: longId }, closeOperationKey: longKey };
  const longPorts = { ...ports, admission: async () => ({ draftVersion, conversationId: longId, admissionKey: longKey,
    result: longTurn, absence: 'not_proof_of_no_commit', retryable: false }) };
  const longReads = { operation: async () => ({ ...closure, conversationId: longId, operationKey: longKey, revision: 4294967294 }),
    read: async () => ({ ...observation, conversationId: longId, revision: 4294967294 }) };
  const longRotation = new ConversationAdmissionSession(longId, longPorts, () => current, storage, 'long-rotation');
  await assert.rejects(longRotation.rotate(longReads, longKey, { turnId: longId, originalInputRef: longId, expectedRevision: 4294967293 },
    () => { throw Error('long closure cleanup failed'); }), /long closure cleanup failed/);
  assert.ok(values.get('long-rotation').length > 1024); assert.ok(values.get('long-rotation').length <= 2048);
  const longRecovery = new ConversationAdmissionSession(longId, longPorts, () => current, storage, 'long-rotation');
  assert.equal(longRecovery.snapshot().rotationPending, true);
  await longRecovery.resumeRotation(longReads, () => true); assert.equal(values.has('long-rotation'), false);
});

for (const capability of ['order_explanation', 'opening_diagnosis']) test(`actual ${capability} admission distinguishes unsent preparation and clears draft on hide without automatic requests`, async () => {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationAdmission.tsx'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], effects = [], cleaners = new Map(); let cursor = 0, changed = 0, calls = 0, current = true, headVisible = true;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = next; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i][j]))) {
      slots[i] = deps; effects.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } },
  };
  const document = { hidden: false, addEventListener(_event, fn) { this.change = fn; }, removeEventListener() { this.change = null; } };
  const storageValues = new Map(), storage = { getItem: key => storageValues.get(key) ?? null, setItem: (key, value) => storageValues.set(key, value), removeItem: key => storageValues.delete(key) };
  const hashing = loadLifecycleSession('budget-settings-session.ts');
  const original = loadLifecycleSession('conversation-admission-session.ts', { './budget-settings-session': hashing });
  const shared = require('../packages/shared/src/index'), stub = name => props => React.createElement(name, props), exports = {};
  vm.runInNewContext(output, { exports, document, window: { sessionStorage: storage }, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@/api/aiConversations') return { aiConversationsApi: { admit: async () => { calls++; throw Error('lost acknowledgement'); },
      admission: async () => { calls++; throw Error('unavailable'); } } };
    if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert'), ConfirmAction: stub('confirm'), Input: stub('input'), Select: stub('select') };
    if (name === './conversation-admission-session') return { ConversationAdmissionSession: class extends original.ConversationAdmissionSession {
      constructor(...args) { super(...args, () => 'ui-admission'); }
    } };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: value => value }) };
    if (name === './ConversationClosure') return { ConversationClosure: stub('conversation-closure') };
    if (name === './ConversationTaskCreation') return { ConversationTaskCreation: stub('conversation-task-creation') };
    if (name === './safe-display') return { safeDisplayText: value => value };
    throw Error(name);
  } });
  const observation = { draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION, conversationId: 'conversation-a', revision: 1,
    capabilityCode: capability, status: 'active', currentTurn: null, createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
    taskCancellation: 'separate_original_operation', businessRecords: 'not_modified' };
  const render = (conversationId = 'conversation-a') => { cursor = 0; const tree = exports.ConversationAdmission({ conversationId,
    identity: 'owner-scope', capabilityCode: capability, observation: headVisible ? { ...observation, conversationId } : null,
    current: () => current, onChanged: () => { changed++; headVisible = false; } }); effects.splice(0).forEach(fn => fn()); return tree; };
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => { if (React.isValidElement(child)) {
    out.push(child); walk(child.props.children); } }); walk(tree); return out; };
  const find = (tree, label) => nodes(tree).find(node => node.props.label === label || node.props['aria-label'] === label);
  let tree = render(); assert.equal(calls, 0);
  if (capability === 'opening_diagnosis') {
    assert.equal(find(tree, '订单标识'), undefined);
    assert.equal(find(tree, '诊断分区').props.options.length, 9);
    assert.equal(find(tree, '保留本轮发送定位').props.disabled, true);
    find(tree, '诊断分区').props.onChange(['item_groups']);
  } else find(tree, '订单标识').props.onChange({ currentTarget: { value: 'order-a' } }); tree = render();
  await find(tree, '保留本轮发送定位').props.onAction(); tree = render(); assert.equal(calls, 0);
  const raw = storageValues.get('ai-conversation-admission:owner-scope:conversation-a');
  assert.equal(JSON.parse(raw).capabilityCode, capability);
  assert.equal(raw.includes('item_groups'), false); assert.equal(raw.includes('order-a'), false);
  assert.ok(nodes(tree).some(node => React.Children.toArray(node.props.children).includes(capability === 'opening_diagnosis' ? '商品组' : 'order-a')));
  const send = find(tree, '明确受理本轮请求').props.onConfirm;
  document.hidden = true; document.change(); tree = render();
  assert.equal(find(tree, '明确受理本轮请求'), undefined);
  document.hidden = false; tree = render();
  await assert.rejects(send(), /AI_RESULT_UNKNOWN/); assert.equal(calls, 0);
  await assert.rejects(find(tree, '核对原轮次受理').props.onAction(), /unavailable/); assert.equal(calls, 1);
  assert.ok(changed > 0); const old = find(tree, '核对原轮次受理').props.onAction;
  headVisible = true; render('conversation-b'); tree = render('conversation-b');
  await assert.rejects(old(), /AI_SCOPE_CHANGED/); assert.equal(calls, 1);
  if (capability === 'opening_diagnosis') find(tree, '诊断分区').props.onChange(['business_rule']);
  else find(tree, '订单标识').props.onChange({ currentTarget: { value: 'order-b' } }); tree = render('conversation-b');
  await find(tree, '保留本轮发送定位').props.onAction(); tree = render('conversation-b');
  await assert.rejects(find(tree, '明确受理本轮请求').props.onConfirm(), /lost acknowledgement/);
  tree = render('conversation-b'); assert.equal(calls, 2); assert.equal(find(tree, '明确受理本轮请求'), undefined);
  assert.ok(find(tree, '核对原轮次受理'));
  const markerForC = { ...JSON.parse(storageValues.get('ai-conversation-admission:owner-scope:conversation-b')), conversationId: 'conversation-c',
    rotation: { operationKey: 'closure-c', turnId: 'turn-c', originalInputRef: 'input-c', expectedRevision: 2 } };
  storageValues.set('ai-conversation-admission:owner-scope:conversation-c', JSON.stringify(markerForC));
  render('conversation-c'); tree = render('conversation-c');
  assert.ok(find(tree, '核对并完成中断的轮换')); assert.equal(calls, 2, 'restoring rotation never reads automatically');
  storageValues.set('ai-conversation-closure:owner-scope:conversation-c', 'still pending');
  await assert.rejects(find(tree, '核对并完成中断的轮换').props.onAction(), /AI_RESULT_UNKNOWN/); assert.equal(calls, 2);
  storageValues.delete('ai-conversation-closure:owner-scope:conversation-c');
  await assert.rejects(find(tree, '核对并完成中断的轮换').props.onAction(), /unavailable/); assert.equal(calls, 3);
  cleaners.forEach(fn => fn?.()); current = false;
  assert.match(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationDetail.tsx'), 'utf8'), /ConversationAdmission conversationId=\{conversationId\}/u);
});

for (const capability of ['order_explanation', 'opening_diagnosis']) test(`original ${capability} task creation journals before sending and recovers only original metadata`, async () => {
  const { ConversationTaskCreationSession: Session } = loadLifecycleSession('conversation-task-creation-session.ts');
  const shared = require('../packages/shared/src/index');
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const original = { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: '11111111-1111-4111-8111-111111111111' };
  const task = { taskId: '22222222-2222-4222-8222-222222222222', runId: '33333333-3333-4333-8333-333333333333' };
  const turn = { admissionKey: 'admission-a', turnId: 'turn-a', originalRequestKey: 'original-a', requestHash: 'a'.repeat(64),
    capabilityCode: capability, capabilityVersion: '1', createdAt: '2026-11-03T00:00:00Z', automaticRetry: false,
    status: 'original_bound', original, execution: 'not_inferred_from_association', material: 'retained', task: null };
  let created = false, current = true, writes = 0, lost = true, mutate;
  const recovery = () => ({ task: created ? { state: 'observed', ...task, status: 'queued', revision: 1,
    plan: 'not_observed', resultAvailable: false, execution: 'not_inferred_from_metadata' } : { state: 'not_observed', retryable: false },
    ...(created ? { steps: [], hasMore: false, automaticExecution: false, nextAction: 'host_plan_handoff',
      observedResults: 'preserved_even_if_task_cancelled', snapshot: 'bounded_sequential_read' }
      : { nextAction: 'reconcile_request_or_explicit_create_task', automaticExecution: false }) });
  const ports = { admission: async query => ({ draftVersion: query.draftVersion, conversationId: query.conversationId,
    admissionKey: query.admissionKey, result: { ...turn, task: created ? task : null }, absence: 'not_proof_of_no_commit', retryable: false }),
  createTask: async query => { writes++; assert.deepEqual(query, original); assert.ok(values.has('journal'));
    created = true; if (lost) throw Error('lost creation acknowledgement'); return { ...task, revision: 1, status: 'queued', replayed: false }; },
  recovery: async () => { const value = recovery(); mutate?.(value); return value; } };
  const session = new Session('conversation-a', ports, () => current, storage, 'journal');
  assert.equal(writes, 0);
  await assert.rejects(session.create({ ...turn, material: 'erased' }), /AI_RESULT_UNKNOWN/);
  await assert.rejects(session.create(turn), /lost creation acknowledgement/); assert.equal(writes, 1);
  assert.equal(session.snapshot().locked, true); assert.equal(values.get('journal').includes('orderId'), false);
  await assert.rejects(session.create(turn), /AI_RESULT_UNKNOWN/); assert.equal(writes, 1);
  const marker = JSON.parse(values.get('journal')); assert.equal(marker.capabilityCode, capability); assert.equal(marker.capabilityVersion, '1');
  const reopened = new Session('conversation-a', ports, () => current, storage, 'journal');
  const crossScene = new Session('conversation-a', { ...ports, admission: async query => ({ draftVersion: query.draftVersion,
    conversationId: query.conversationId, admissionKey: query.admissionKey, result: { ...turn,
      capabilityCode: capability === 'opening_diagnosis' ? 'order_explanation' : 'opening_diagnosis', task },
    absence: 'not_proof_of_no_commit', retryable: false }) }, () => current, storage, 'journal');
  await assert.rejects(crossScene.reconcile(), /AI_RESULT_UNKNOWN/); assert.equal(writes, 1);
  const crossVersion = new Session('conversation-a', { ...ports, admission: async query => ({ ...query,
    result: { ...turn, capabilityVersion: '2', task }, absence: 'not_proof_of_no_commit', retryable: false }) }, () => current, storage, 'journal');
  await assert.rejects(crossVersion.reconcile(), /AI_RESULT_UNKNOWN/); assert.equal(writes, 1);
  const legacy = { ...marker }; delete legacy.capabilityCode; delete legacy.capabilityVersion;
  values.set('legacy', JSON.stringify(legacy));
  const old = new Session('conversation-a', ports, () => current, storage, 'legacy');
  if (capability === 'order_explanation') assert.equal((await old.reconcile()).task.taskId, task.taskId);
  else await assert.rejects(old.reconcile(), /AI_RESULT_UNKNOWN/);
  const observed = await reopened.reconcile(); assert.equal(observed.task.taskId, task.taskId); assert.equal(writes, 1);
  mutate = value => { value.task.taskId = '44444444-4444-4444-8444-444444444444'; };
  await assert.rejects(reopened.reconcile(), /AI_RESULT_UNKNOWN/); assert.equal(reopened.snapshot().recovery, null);
  mutate = value => { value.credential = 'secret'; };
  await assert.rejects(reopened.reconcile(), /AI_RESULT_UNKNOWN/); mutate = undefined;
  created = false; const absent = await reopened.reconcile(); assert.equal(absent.task.state, 'not_observed');
  await assert.rejects(reopened.create(turn), /AI_RESULT_UNKNOWN/); assert.equal(writes, 1);
  current = false; await assert.rejects(reopened.reconcile(), /AI_SCOPE_CHANGED/); current = true;
  const broken = new Session('conversation-a', ports, () => current, { getItem: () => null, setItem: () => { throw Error('storage failed'); } }, 'broken');
  await assert.rejects(broken.create(turn), /storage failed/); assert.equal(writes, 1);
  const fenced = new Session('conversation-a', { ...ports, admission: async query => ({
    draftVersion: query.draftVersion, conversationId: query.conversationId, admissionKey: query.admissionKey,
    result: { ...turn, creation: 'permanently_closed', closeOperationKey: 'closed-original' }, absence: 'not_proof_of_no_commit', retryable: false }) },
  () => current, storage, 'fenced');
  await assert.rejects(fenced.create(turn), /AI_RESULT_UNKNOWN/); assert.equal(values.has('fenced'), false); assert.equal(writes, 1);
  const replacement = values.get('journal');
  mutate = () => values.set('journal', JSON.stringify({ ...JSON.parse(replacement), admissionKey: 'replacement' }));
  await assert.rejects(reopened.reconcile(), /AI_RESULT_UNKNOWN/); assert.equal(JSON.parse(values.get('journal')).admissionKey, 'replacement');
  mutate = undefined; values.delete('journal'); lost = false;
  const successful = new Session('conversation-a', ports, () => current, storage, 'journal');
  await successful.create(turn); assert.equal(successful.snapshot().recovery.task.taskId, task.taskId); assert.equal(writes, 2);
  successful.retract(); assert.equal(successful.snapshot().recovery, null); successful.dispose();
  await assert.rejects(successful.reconcile(), /AI_SCOPE_CHANGED/);
  for (const value of [recovery(), { task: { state: 'not_observed', retryable: false },
    nextAction: 'reconcile_request_or_explicit_create_task', automaticExecution: false }]) {
    assert.equal(shared.validateAiSceneRequestRecoveryDraft(value), true);
    assert.equal(shared.validateAiSceneRequestRecoveryDraft({ ...value, automaticExecution: true }), false);
    assert.equal(shared.validateAiSceneRequestRecoveryDraft({ ...value, credential: 'secret' }), false);
  }
});

for (const capability of ['order_explanation', 'opening_diagnosis']) test(`actual ${capability} task creation controls stay explicit and retract on hide and turn switch`, async () => {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationTaskCreation.tsx'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], effects = [], cleaners = new Map(); let cursor = 0, calls = 0, current = true;
  const hooks = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i][j]))) {
      slots[i] = deps; effects.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } },
  };
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const document = { hidden: false, addEventListener(_name, fn) { this.change = fn; }, removeEventListener() {} };
  const original = loadLifecycleSession('conversation-task-creation-session.ts'), shared = require('../packages/shared/src/index');
  const stub = name => props => React.createElement(name, props), exports = {};
  const turn = { admissionKey: 'admission-a', turnId: 'turn-a', originalRequestKey: 'original-a', requestHash: 'a'.repeat(64),
    capabilityCode: capability, capabilityVersion: '1', createdAt: '2026-11-03T00:00:00Z', automaticRetry: false,
    status: 'original_bound', original: { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: '11111111-1111-4111-8111-111111111111' },
    execution: 'not_inferred_from_association', material: 'retained', task: null };
  vm.runInNewContext(output, { exports, document, window: { sessionStorage: storage }, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@/api/aiConversations') return { aiConversationsApi: {
      admission: async query => ({ draftVersion: query.draftVersion, conversationId: query.conversationId, admissionKey: query.admissionKey,
        result: { ...turn, admissionKey: query.admissionKey }, absence: 'not_proof_of_no_commit', retryable: false }),
      createTask: async () => { calls++; throw Error('lost task acknowledgement'); }, recovery: async () => { calls++; throw Error('unavailable'); } } };
    if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert'), ConfirmAction: stub('confirm') };
    if (name === './conversation-task-creation-session') return original;
    if (name === './ConversationOrderExecution') return { ConversationOrderExecution: stub('conversation-order-execution') };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: value => value }) };
    if (name === './safe-display') return { safeDisplayText: value => value };
    throw Error(name);
  } });
  const render = (admissionKey = 'admission-a') => { cursor = 0; const tree = exports.ConversationTaskCreation({ identity: 'owner-scope',
    conversationId: 'conversation-a', turn: { ...turn, admissionKey }, current: () => current, onChanged: () => {} });
    effects.splice(0).forEach(fn => fn()); return tree; };
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => { if (React.isValidElement(child)) {
    out.push(child); walk(child.props.children); } }); walk(tree); return out; };
  const find = (tree, label) => nodes(tree).find(node => node.props.label === label);
  let tree = render(); assert.equal(calls, 0);
  await assert.rejects(find(tree, '明确创建原任务').props.onConfirm(), /lost task acknowledgement/); tree = render();
  assert.equal(calls, 1); assert.equal(find(tree, '明确创建原任务'), undefined);
  await assert.rejects(find(tree, '核对原任务创建').props.onAction(), /unavailable/); assert.equal(calls, 2);
  document.hidden = true; document.change();
  await assert.rejects(find(tree, '核对原任务创建').props.onAction(), /AI_SCOPE_CHANGED/); assert.equal(calls, 2);
  document.hidden = false; tree = render();
  const old = find(tree, '核对原任务创建').props.onAction;
  render('admission-b'); tree = render('admission-b');
  await assert.rejects(old(), /AI_SCOPE_CHANGED/); assert.equal(calls, 2);
  assert.ok(find(tree, '明确创建原任务'));
  cleaners.forEach(fn => fn?.()); current = false;
  await assert.rejects(find(tree, '明确创建原任务').props.onConfirm(), /AI_SCOPE_CHANGED/); assert.equal(calls, 2);
});

test('original order execution keeps first start explicit and observes uncertainty without replay', async () => {
  const { ConversationOrderExecutionSession: Session } = loadLifecycleSession('conversation-order-execution-session.ts');
  const shared = require('../packages/shared/src/index');
  const values = new Map(), storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const turn = { admissionKey: 'admission-a', turnId: 'turn-a', originalRequestKey: 'original-a', requestHash: 'a'.repeat(64),
    capabilityCode: 'order_explanation', capabilityVersion: '1', createdAt: '2026-11-03T00:00:00Z', automaticRetry: false,
    status: 'original_bound', original: { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: '11111111-1111-4111-8111-111111111111' },
    execution: 'not_inferred_from_association', material: 'retained', task: {
      taskId: '22222222-2222-4222-8222-222222222222', runId: '33333333-3333-4333-8333-333333333333' } };
  const preparation = { original: { ...turn.original, revision: 1, contentHash: 'b'.repeat(64), sceneCode: 'order_explanation', sceneVersion: '1',
    requestKey: 'original-a', previousInputRef: null, createdAt: turn.createdAt, expiresAt: '2027-01-01T00:00:00Z', state: 'stored' },
    preparation: { publishedInputs: 0, requiredInputs: 3, missing: ['model_request', 'order_read', 'model_answer'], planPublished: false, execution: 'not_attested' },
    observation: 'revalidated_not_atomic', automaticRetry: false };
  const recovery = { task: { state: 'observed', ...turn.task, status: 'queued', revision: 1, plan: 'not_observed',
    resultAvailable: false, execution: 'not_inferred_from_metadata' }, steps: [], hasMore: false, automaticExecution: false,
    nextAction: 'host_plan_handoff', observedResults: 'preserved_even_if_task_cancelled', snapshot: 'bounded_sequential_read' };
  let writes = 0, current = true, alter, reply = async () => { throw Error('lost start acknowledgement'); };
  const ports = { admission: async query => ({ ...query, result: turn, absence: 'not_proof_of_no_commit', retryable: false }),
    recovery: async () => { const value = structuredClone(recovery); alter?.(value); return value; },
    orderPreparation: async () => structuredClone(preparation), orderStart: async () => { writes++; assert.ok(values.has('journal')); return reply(); } };
  const session = new Session('conversation-a', ports, () => current, storage, 'journal');
  assert.equal(writes, 0); await assert.rejects(session.start(), /AI_RESULT_UNKNOWN/);
  await session.inspect(turn); assert.equal(session.snapshot().ready, true); assert.equal(writes, 0);
  alter = value => { value.task.status = 'running'; value.task.revision = 2; };
  await assert.rejects(session.start(), /AI_RESULT_UNKNOWN/); assert.equal(writes, 0); alter = undefined;
  await session.inspect(turn); await assert.rejects(session.start(), /lost start acknowledgement/);
  assert.equal(writes, 1); assert.equal(session.snapshot().locked, true);
  await assert.rejects(session.start(), /AI_RESULT_UNKNOWN/); assert.equal(writes, 1);
  const reopened = new Session('conversation-a', ports, () => current, storage, 'journal');
  await reopened.reconcile(); assert.equal(reopened.snapshot().ready, false); assert.equal(writes, 1);
  await assert.rejects(reopened.start(), /AI_RESULT_UNKNOWN/);
  alter = value => { value.task.taskId = '44444444-4444-4444-8444-444444444444'; };
  await assert.rejects(reopened.reconcile(), /AI_RESOURCE_UNAVAILABLE/); assert.equal(reopened.snapshot().observation, null); alter = undefined;
  current = false; await assert.rejects(reopened.reconcile(), /AI_SCOPE_CHANGED/); current = true;
  const empty = new Session('conversation-a', ports, () => current, { getItem: () => null, setItem: () => { throw Error('storage failed'); } }, 'broken');
  await empty.inspect(turn); await assert.rejects(empty.start(), /storage failed/); assert.equal(writes, 1);
  const packet = { original: preparation.original, outcome: { kind: 'run_outcome', outcome: { status: 'unknown', completedSteps: 0, cleanupFailed: 0 } },
    businessExecution: 'readonly_not_business_commit' };
  assert.equal(shared.validateAiOrderReadStartDraft(packet, turn.original, turn), true);
  assert.equal(shared.validateAiOrderReadStartDraft({ ...packet, credential: 'hidden' }, turn.original, turn), false);
  assert.equal(shared.validateAiOrderReadPreparationDraft(preparation, turn.original, turn), true);
  assert.equal(shared.validateAiOrderReadPreparationDraft({ ...preparation, preparation: { ...preparation.preparation, publishedInputs: 1 } }, turn.original, turn), false);
  assert.equal(shared.validateAiOrderReadPreparationDraft({ ...preparation, original: { ...preparation.original, expiresAt: '2026-02-31T00:00:00Z' } }, turn.original, turn), false);
  const raw = values.get('journal'); let observations = 0;
  alter = value => { if (++observations === 2) value.task.revision = 2; };
  await assert.rejects(reopened.reconcile(), /AI_REVISION_CONFLICT/); alter = undefined;
  alter = () => values.set('journal', JSON.stringify({ ...JSON.parse(raw), admissionKey: 'replacement' }));
  await assert.rejects(reopened.reconcile(), /AI_RESULT_UNKNOWN/); assert.equal(JSON.parse(values.get('journal')).admissionKey, 'replacement'); alter = undefined;
  values.delete('journal'); reply = async () => packet;
  const success = new Session('conversation-a', ports, () => current, storage, 'journal');
  await success.inspect(turn); await success.start(); assert.equal(success.snapshot().acknowledgement.outcome.outcome.status, 'unknown');
  await assert.rejects(success.start(), /AI_RESULT_UNKNOWN/); assert.equal(writes, 2);
  success.retract(); assert.equal(success.snapshot().acknowledgement, null); success.dispose();
  await assert.rejects(success.reconcile(), /AI_SCOPE_CHANGED/);
});

test('actual order execution requires separate reading and confirmation and rejects hidden or stale turns', async () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationOrderExecution.tsx'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], effects = [], cleaners = new Map(); let cursor = 0, reads = 0, sends = 0, current = true;
  const hooks = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i][j]))) {
      slots[i] = deps; effects.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } },
  };
  const shared = require('../packages/shared/src/index'), sessions = loadLifecycleSession('conversation-order-execution-session.ts');
  const values = new Map(), storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const document = { hidden: false, addEventListener(_name, fn) { this.change = fn; }, removeEventListener() {} };
  const turn = { admissionKey: 'admission-a', turnId: 'turn-a', originalRequestKey: 'original-a', requestHash: 'a'.repeat(64),
    capabilityCode: 'order_explanation', capabilityVersion: '1', createdAt: '2026-11-03T00:00:00Z', automaticRetry: false,
    status: 'original_bound', original: { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: '11111111-1111-4111-8111-111111111111' },
    execution: 'not_inferred_from_association', material: 'retained', task: { taskId: '22222222-2222-4222-8222-222222222222', runId: '33333333-3333-4333-8333-333333333333' } };
  const preparation = { original: { ...turn.original, revision: 1, contentHash: 'b'.repeat(64), sceneCode: 'order_explanation', sceneVersion: '1', requestKey: 'original-a',
    previousInputRef: null, createdAt: turn.createdAt, expiresAt: '2027-01-01T00:00:00Z', state: 'stored' },
    preparation: { publishedInputs: 0, requiredInputs: 3, missing: ['model_request', 'order_read', 'model_answer'], planPublished: false, execution: 'not_attested' },
    observation: 'revalidated_not_atomic', automaticRetry: false };
  const stub = name => props => React.createElement(name, props), exports = {};
  vm.runInNewContext(output, { exports, document, window: { sessionStorage: storage }, require(name) {
    if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@/api/aiConversations') return { aiConversationsApi: {
      admission: async query => { reads++; return { ...query, result: { ...turn, admissionKey: query.admissionKey }, absence: 'not_proof_of_no_commit', retryable: false }; },
      recovery: async () => ({ task: { state: 'observed', ...turn.task, status: 'queued', revision: 1, plan: 'not_observed', resultAvailable: false,
        execution: 'not_inferred_from_metadata' }, steps: [], hasMore: false, automaticExecution: false, nextAction: 'host_plan_handoff',
        observedResults: 'preserved_even_if_task_cancelled', snapshot: 'bounded_sequential_read' }),
      orderPreparation: async () => preparation, orderStart: async () => { sends++; throw Error('lost start'); } } };
    if (name === '@/components/ui') return { ActionButton: stub('action'), ConfirmAction: stub('confirm'), Alert: stub('alert') };
    if (name === './conversation-order-execution-session') return sessions;
    if (name === './ConversationOrderResults') return { ConversationOrderResults: stub('conversation-order-results') };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: v => v }) };
    throw Error(name);
  } });
  const render = (admissionKey = 'admission-a') => { cursor = 0; const tree = exports.ConversationOrderExecution({ identity: 'owner', conversationId: 'conversation-a',
    turn: { ...turn, admissionKey }, current: () => current }); effects.splice(0).forEach(fn => fn()); return tree; };
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => { if (React.isValidElement(child)) { out.push(child); walk(child.props.children); } }); walk(tree); return out; };
  const find = (tree, label) => nodes(tree).find(node => node.props.label === label);
  let tree = render(); assert.equal(reads, 0); assert.equal(sends, 0); assert.equal(find(tree, '明确启动订单解读'), undefined);
  await find(tree, '读取原执行准备').props.onAction(); tree = render(); assert.equal(sends, 0);
  const staleConfirm = find(tree, '明确启动订单解读').props.onConfirm;
  document.hidden = true; document.change(); assert.throws(staleConfirm, /AI_SCOPE_CHANGED/); assert.equal(sends, 0);
  document.hidden = false; tree = render(); assert.equal(find(tree, '明确启动订单解读'), undefined);
  await find(tree, '读取原执行准备').props.onAction(); tree = render();
  await assert.rejects(find(tree, '明确启动订单解读').props.onConfirm(), /lost start/); tree = render(); assert.equal(sends, 1);
  assert.equal(find(tree, '明确启动订单解读'), undefined);
  await find(tree, '只读核对原执行').props.onAction(); assert.equal(sends, 1);
  const old = find(tree, '只读核对原执行').props.onAction; render('admission-b'); tree = render('admission-b');
  assert.throws(old, /AI_SCOPE_CHANGED/); assert.equal(sends, 1);
  cleaners.forEach(fn => fn?.()); current = false; assert.throws(() => find(tree, '读取原执行准备').props.onAction(), /AI_SCOPE_CHANGED/);
});

test('actual original order results read explicitly and retract amounts and text on failure or hide', async () => {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationOrderResults.tsx'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], effects = [], cleaners = new Map(); let cursor = 0, calls = 0, current = true, respond;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = v; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i][j]))) {
      slots[i] = deps; effects.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } },
  };
  const document = { hidden: false, addEventListener(_name, fn) { this.change = fn; }, removeEventListener() {} };
  const stub = name => props => React.createElement(name, props), exports = {}, signals = [];
  vm.runInNewContext(output, { exports, AbortController, document, require(name) {
    if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@/api/aiConversations') return { aiConversationsApi: {} };
    if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert') };
    if (name === './conversation-order-results-reader') return { readConversationOrderResults: async (_api, _id, _turn, signal) => { calls++; signals.push(signal); return respond(); } };
    if (name === './ModelText') return { ModelText: stub('model-text') };
    if (name === './safe-display') return { safeDisplayText: v => v };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: v => v }) };
    throw Error(name);
  } });
  const result = { facts: { result: { status: 'available', facts: { order: { orderNo: 'ORDER-A', status: 'renting', currency: 'CNY',
    amounts: { rental: 0, service: null, discount: 0, coupon: null, deposit: 100, preAuthorization: null, finalPayable: 100 } },
    observedAt: '2026-11-03T00:00:00Z', scope: { workspaceId: 'workspace-a' }, sources: [{ resourceId: 'order-a' }] } } },
    answer: { result: { status: 'available', text: '<script>untrusted answer</script>' } } };
  const render = (conversationId = 'conversation-a') => { cursor = 0; const tree = exports.ConversationOrderResults({ conversationId,
    turn: { turnId: 'turn-a' }, current: () => current }); effects.splice(0).forEach(fn => fn()); return tree; };
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => { if (React.isValidElement(child)) { out.push(child); walk(child.props.children); } }); walk(tree); return out; };
  const read = tree => nodes(tree).find(node => node.props.label === '读取原订单事实与回答');
  const text = tree => nodes(tree).find(node => node.type?.name === 'model-text' || node.props.text)?.props.text;
  const values = tree => nodes(tree).filter(node => node.type === 'dd').map(node => node.props.children);
  let tree = render(); assert.equal(calls, 0);
  respond = async () => result; await read(tree).props.onAction(); tree = render();
  assert.equal(text(tree), result.answer.result.text); assert.ok(values(tree).includes('0 CNY')); assert.ok(values(tree).includes('未加载'));
  respond = async () => { throw Error('denied'); };
  await assert.rejects(read(tree).props.onAction(), /denied/); tree = render(); assert.equal(text(tree), undefined); assert.deepEqual(values(tree), []);
  respond = async () => ({ facts: { result: { status: 'stale', facts: null } }, answer: { result: { status: 'stale', text: null } } });
  await read(tree).props.onAction(); tree = render(); assert.equal(text(tree), undefined); assert.deepEqual(values(tree), []);
  let resolve; respond = () => new Promise(done => { resolve = done; });
  const pending = read(tree).props.onAction(); document.hidden = true; document.change();
  assert.equal(signals.at(-1).aborted, true); resolve(result); await assert.rejects(pending, /AI_SCOPE_CHANGED/);
  document.hidden = false; tree = render(); assert.equal(text(tree), undefined);
  const old = read(tree).props.onAction; render('conversation-b'); tree = render('conversation-b');
  await assert.rejects(old(), /AI_SCOPE_CHANGED/);
  cleaners.forEach(fn => fn?.()); current = false; await assert.rejects(read(tree).props.onAction(), /AI_SCOPE_CHANGED/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationOrderResults.tsx'), 'utf8'), /dangerouslySetInnerHTML|localStorage|sessionStorage|setInterval/);
});

test('actual closure controls preserve original receipts and require explicit idle-head revalidation', async () => {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/ConversationClosure.tsx'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], effects = [], cleaners = new Map(); let cursor = 0, current = true, calls = 0, rotations = 0, lost = true;
  const hooks = {
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i].deps[j]))) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useSyncExternalStore(_subscribe, snapshot) { cursor++; return snapshot(); },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => !Object.is(v, slots[i][j]))) {
      slots[i] = deps; effects.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } },
  };
  const shared = require('../packages/shared/src/index'), original = loadLifecycleSession();
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const document = { hidden: false, addEventListener(_event, fn) { this.change = fn; }, removeEventListener() { this.change = null; } };
  const stub = name => props => React.createElement(name, props), exports = {};
  const receipt = { draftVersion: shared.AI_CONVERSATION_UNSTARTED_DRAFT_VERSION, operationKey: 'closure-ui', retryable: false, status: 'observed',
    conversationId: 'conversation-a', revision: 3, operation: 'close_unstarted', creation: 'permanently_closed', task: 'not_created',
    taskCancellation: 'not_requested', businessRecords: 'not_modified' };
  vm.runInNewContext(output, { exports, document, window: { sessionStorage: storage }, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@rental-os/shared') return shared;
    if (name === '@/api/aiConversations') return { aiConversationsApi: { closeUnstarted: async command => {
      calls++; assert.equal(command.turnId, 'turn-a'); if (lost) throw Error('lost closure response'); return receipt;
    }, operation: async () => { calls++; return receipt; } } };
    if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert'), ConfirmAction: stub('confirm') };
    if (name === './conversation-lifecycle-session') return { ConversationLifecycleSession: class extends original.ConversationLifecycleSession {
      constructor(ports, current, storage, key, _newKey, retain) { super(ports, current, storage, key, () => 'closure-ui', retain); }
    } };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: value => value }) };
    throw Error(name);
  } });
  const observation = { draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION, conversationId: 'conversation-a', revision: 2,
    capabilityCode: 'order_explanation', status: 'active', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
    taskCancellation: 'separate_original_operation', businessRecords: 'not_modified', currentTurn: {
      admissionKey: 'admission-a', turnId: 'turn-a', originalRequestKey: 'original-key', requestHash: 'a'.repeat(64), capabilityCode: 'order_explanation',
      capabilityVersion: '1', createdAt: '2026-11-03T00:00:00Z', automaticRetry: false, status: 'original_bound',
      original: { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: 'input-a' }, execution: 'not_inferred_from_association', material: 'retained', task: null } };
  const render = (conversationId = 'conversation-a', canClose = true, beforeClose = () => {}) => { cursor = 0;
    const tree = exports.ConversationClosure({ identity: 'owner-scope', conversationId, observation, current: () => current, canClose, beforeClose,
      onChanged: () => {}, onRotate: async (proof, acknowledge) => { assert.equal(proof.turnId, 'turn-a'); assert.equal(proof.expectedRevision, 2); rotations++; acknowledge(); } });
    effects.splice(0).forEach(fn => fn()); return tree;
  };
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => { if (React.isValidElement(child)) {
    out.push(child); walk(child.props.children); } }); walk(tree); return out; };
  const find = (tree, label) => nodes(tree).find(node => node.props.label === label);
  let tree = render('conversation-a', false); assert.equal(calls, 0); assert.equal(rotations, 0);
  assert.equal(find(tree, '关闭原请求创建入口').props.disabled, true);
  await assert.rejects(find(tree, '关闭原请求创建入口').props.onConfirm(), /AI_RESULT_UNKNOWN/); assert.equal(values.size, 0);
  tree = render('conversation-a', true, () => { throw Error('admission marker changed'); });
  await assert.rejects(find(tree, '关闭原请求创建入口').props.onConfirm(), /admission marker changed/);
  assert.equal(calls, 0); assert.equal(values.size, 0, 'missing or changed admission must not create a closure journal');
  tree = render();
  await assert.rejects(find(tree, '关闭原请求创建入口').props.onConfirm(), /lost closure response/); tree = render();
  assert.equal(values.size, 1); assert.equal(find(tree, '关闭原请求创建入口').props.disabled, true);
  assert.equal(find(tree, '复验空闲对话并准备下一轮'), undefined);
  lost = false; await find(tree, '核对原轮次关闭收据').props.onAction(); tree = render();
  assert.equal(values.size, 1); assert.equal(rotations, 0, 'receipt reading cannot rotate implicitly');
  await find(tree, '复验空闲对话并准备下一轮').props.onAction(); tree = render();
  assert.equal(rotations, 1); assert.equal(values.size, 0);
  const old = find(tree, '关闭原请求创建入口').props.onConfirm;
  render('conversation-b'); tree = render('conversation-b');
  await assert.rejects(old(), /AI_SCOPE_CHANGED/); assert.equal(calls, 2);
  document.hidden = true; document.change();
  await assert.rejects(find(tree, '关闭原请求创建入口').props.onConfirm(), /AI_SCOPE_CHANGED/); assert.equal(calls, 2);
  cleaners.forEach(fn => fn?.()); current = false;
});
