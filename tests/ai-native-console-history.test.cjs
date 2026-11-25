'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourceLoader = require('../scripts/controller-sources.cjs').createControllerSourceLoader(root,
  path.dirname(path.dirname(require.resolve('typescript/package.json'))));
const source = file => sourceLoader.load(path.join(root, file));
const assistant = file => source(`packages/rental-core/admin/assistant/${file}`);
const { NativeOperatorSession, nativeAgentRun } = assistant('ai-operator/native-session.ts');

function hookFixture() {
  const fs = require('node:fs'), ts = require('typescript');
  const file = path.join(root, 'tests/enterprise-consumers.test.cjs');
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reactHost');
  assert.ok(declaration);
  return new Function('assert', `${declaration.getText(ast)}; return reactHost();`)(assert);
}
function compileAssistant(file, imports, globals = {}, expose = '') {
  const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm'), exports = {};
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const output = ts.transpileModule(text + expose, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(output, { exports, AbortController, AbortSignal, structuredClone,
    TextEncoder, crypto: require('node:crypto').webcrypto, ...globals, require(name) {
      assert.ok(Object.hasOwn(imports, name), `undeclared test transport: ${name}`);
      return imports[name];
    } });
  return exports;
}

test('selected assistant keeps current navigation and the original operation through response loss and late scope changes', async () => {
  const React = require('react'), hooks = hookFixture(), shared = source('packages/shared/src/index.ts');
  const values = new Map(), calls = [], navigations = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let epoch = 4, sessionAbort = new AbortController(), reply, context;
  const auth = { token: 'fixture-only', sessionVerified: true, user: { id: 'owner', isSaasAdmin: false },
    tenant: { tenantId: 'tenant' }, currentWorkspaceId: 'workspace', hasPermission: () => true };
  const useAuthStore = Object.assign(() => auth, { getState: () => auth });
  const session = { useAuthStore, currentSessionEpoch: () => epoch, currentSessionSignal: () => sessionAbort.signal,
    http: { post: async (url, data, options) => { calls.push({ url, data, options }); return { data: { data: await reply(url, data) } }; } } };
  session.runtime = { getSession: () => auth, subscribe: () => () => {}, currentSessionEpoch: session.currentSessionEpoch,
    currentSessionSignal: session.currentSessionSignal, request: () => assert.fail('no extra runtime request') };
  const aiHost = compileAssistant('packages/ai-native-admin/src/host.tsx', {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), '@rental-os/platform-admin/runtime': {},
  });
  const routes = { orders: { path: '/rental/orders', label: '订单', permission: 'order:view', menu: true } };
  const navigation = allowed => ({ routes, canAccess: route => allowed && route === routes.orders,
    resolve: href => allowed && href.startsWith('/rental/orders/') ? href.replace('/rental/', '/cores/rental/') : null,
    originalPath: pathname => pathname.replace('/cores/rental/', '/rental/') });
  let currentNavigation = navigation(true);
  const imports = { react: { ...hooks.runtime, createContext: React.createContext, useContext: () => context },
    'react/jsx-runtime': require('react/jsx-runtime'), 'react-router-dom': {
      useLocation: () => ({ pathname: '/cores/rental/orders/original', search: '?tab=history', hash: '#receipt' }),
      useNavigate: () => (href, options) => navigations.push({ href, options }),
    }, '@rental-os/ai-native-admin/host': aiHost,
    '@rental-os/ai-native-admin/source/api/aiTaskCenter': source('packages/ai-native-admin/src/api/aiTaskCenter.ts') };
  for (const name of ['aiConversations', 'aiQuoteSelections', 'aiWorkbenchDisplays', 'aiTaskOrderHandoff', 'aiEntryActions'])
    imports[`./api/${name}`] = assistant(`api/${name}.ts`);
  const host = compileAssistant('packages/rental-core/admin/assistant/host.tsx', imports);
  context = host.createRentalAssistantContext({ session, useNavigation: () => currentNavigation });
  assert.equal(context.aiHost.runtime, session.runtime);
  assert.equal(Object.hasOwn(context.aiHost.getSession(), 'token'), false);
  hooks.mount(() => ({ ports: host.useRentalAssistant(), location: host.useLocation(), navigate: host.useNavigate() }));
  assert.equal(calls.length, 0);
  const first = hooks.value, check = first.ports.canAccessRoute;
  assert.equal(first.location.pathname, '/rental/orders/original');
  assert.equal(first.location.search, '?tab=history');
  first.navigate('/rental/orders/original?tab=history#receipt', { state: { conversationId: 'original-conversation' } });
  assert.equal(navigations[0].href, '/cores/rental/orders/original?tab=history#receipt');
  assert.equal(navigations[0].options.state.conversationId, 'original-conversation');
  const { ConversationLifecycleSession } = assistant('ai-native/conversation-lifecycle-session.ts');
  const current = () => check(routes.orders);
  const lifecycle = new ConversationLifecycleSession(context.aiConversationsApi, current, storage, 'journal', () => 'original-operation');
  reply = async () => { throw Error('lost response'); };
  await assert.rejects(lifecycle.create('order_explanation'), /lost response/);
  const journal = values.get('journal');
  assert.equal(JSON.parse(journal).command.operationKey, 'original-operation');
  assert.equal(calls.length, 1);
  await assert.rejects(lifecycle.create('order_explanation'), /AI_RESULT_UNKNOWN/);
  reply = async (_url, command) => ({ draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION,
    operationKey: command.operationKey, status: 'not_observed', retryable: false,
    nextAction: 'read_original_operation', absence: 'not_proof_of_no_commit' });
  await assert.rejects(lifecycle.reconcile(), /AI_RESULT_UNKNOWN/);
  assert.equal(calls.length, 2); assert.equal(calls[1].data.operationKey, 'original-operation');
  assert.ok(calls[1].url.endsWith('/operation'));
  currentNavigation = navigation(false); hooks.rerender();
  assert.equal(hooks.value.ports.canAccessRoute, check); assert.equal(check(routes.orders), false);
  assert.throws(() => first.navigate('/rental/orders/original'), /AI_ACCESS_DENIED/);
  await assert.rejects(lifecycle.reconcile(), /AI_SCOPE_CHANGED/);
  assert.equal(calls.length, 2); assert.equal(values.get('journal'), journal);
  currentNavigation = navigation(true); hooks.rerender();
  const receipt = { draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION, operationKey: 'original-operation', status: 'observed',
    retryable: false, conversationId: 'original-conversation', revision: 1, operation: 'create',
    taskCancellation: 'not_requested', businessRecords: 'not_modified' };
  let release; reply = () => new Promise(resolve => { release = resolve; });
  const late = lifecycle.reconcile(); sessionAbort.abort(); sessionAbort = new AbortController(); epoch++;
  release(receipt); await assert.rejects(late, /AI_SCOPE_CHANGED/);
  assert.equal(values.get('journal'), journal);
  const reopened = new ConversationLifecycleSession(context.aiConversationsApi, current, storage, 'journal', () => assert.fail('no new operation key'));
  reply = async () => receipt; await reopened.reconcile();
  assert.equal(reopened.snapshot().receipt.conversationId, 'original-conversation');
  assert.equal(values.has('journal'), false);
  assert.equal(calls.filter(call => call.url.endsWith('/create')).length, 1);
  hooks.unmount(); lifecycle.dispose(); reopened.dispose();
});

test('actual Operator and Copilot retract on a Core menu change without changing identity or losing original journals', async () => {
  const React = require('react'), shared = source('packages/shared/src/index.ts');
  const operatorHooks = hookFixture(), copilotHooks = hookFixture(), records = new Map(), listeners = new Map();
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const events = { addEventListener: (name, callback) => {
    const active = listeners.get(name) ?? new Set(); active.add(callback); listeners.set(name, active);
  }, removeEventListener: (name, callback) => listeners.get(name)?.delete(callback) };
  const document = { ...events, hidden: false, activeElement: null }, window = { ...events,
    sessionStorage: storage, localStorage: storage, location: { pathname: '/cores/rental/orders/original-order' } };
  const auth = { token: 'fixture-only', sessionVerified: true, user: { id: 'owner', isSaasAdmin: false }, tenant: { tenantId: 'tenant' },
    currentWorkspaceId: 'workspace', hasPermission: () => true, hasCapability: () => true, hasTenantMembershipPermission: () => true };
  const identity = JSON.stringify(['tenant', 'workspace', 'owner']);
  const operatorKey = `ai-native-console:${identity}:locators`, copilotKey = `ai-copilot-order:${identity}:original-order`;
  records.set(operatorKey, JSON.stringify([{ chatId: 'unknown-chat', scene: 'quote_clarification', conversationId: null, pending: true }]));
  records.set(copilotKey, JSON.stringify({ version: 1, createKey: 'unknown-create', conversationId: null }));
  records.set(`ai-copilot-order-create:${identity}:unknown-create`, JSON.stringify({ action: 'create', command: {
    draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION, operationKey: 'unknown-create', capabilityCode: 'order_explanation',
  } }));
  const originalJournals = JSON.stringify([...records]);
  const APP_ROUTES = {
    aiOperator: { path: '/ai-operator', label: 'Agent工作台', permission: 'report:view' },
    orders: { path: '/rental/orders', label: '订单', permission: 'order:view', menu: true },
    orderDetail: { path: '/rental/orders/:id', label: '订单详情', permission: 'order:view' },
  };
  let menuAllowed = true, releaseHistory, releaseOperation, historyReads = 0, operationReads = 0, observedOperationSignal;
  const ports = { APP_ROUTES, useAuthStore: Object.assign(() => auth, { getState: () => auth }), currentSessionEpoch: () => 7,
    canAccessRoute: route => Boolean(route && menuAllowed), aiTaskCenterApi: {},
    aiConversationsApi: {
      list: () => { historyReads++; return new Promise(resolve => { releaseHistory = resolve; }); },
      operation: (query, signal) => { operationReads++; assert.equal(query.operationKey, 'unknown-create'); observedOperationSignal = signal;
        return new Promise(resolve => { releaseOperation = resolve; }); },
      create: () => assert.fail('unknown operation cannot be resent'),
    } };
  const operator = compileAssistant('packages/rental-core/admin/assistant/ai-operator/OperatorContext.tsx', {
    react: { ...operatorHooks.runtime, createContext: React.createContext }, 'react/jsx-runtime': require('react/jsx-runtime'),
    '../host': { useRentalAssistant: () => ports, useLocation: () => ({ pathname: '/ai-operator' }) },
    '@rental-os/shared': shared,
    '@rental-os/ai-native-admin/source/ai-native/management-locale': { useAiManagementLocale: () => ({ locale: 'zh-CN', t: text => text }) },
    './archive/ai-chat/chat-state': assistant('ai-operator/archive/ai-chat/chat-state.ts'),
    './capabilities': assistant('ai-operator/capabilities.ts'), './native-session': assistant('ai-operator/native-session.ts'),
  }, { window, document }, '\nexport { useOperatorState };');
  operatorHooks.mount(() => operator.useOperatorState());
  const original = operatorHooks.value, native = original.native;
  assert.equal(original.current(), true);
  const lateHistory = native.history('quote_clarification', new AbortController().signal);
  menuAllowed = false; operatorHooks.rerender();
  assert.equal(original.current(), false); assert.equal(operatorHooks.value.native, native);
  releaseHistory({ items: [], nextBeforeId: null }); await assert.rejects(lateHistory, /AI_SCOPE_CHANGED/);
  assert.equal(JSON.stringify([...records]), originalJournals);
  menuAllowed = true; operatorHooks.rerender();
  assert.equal(operatorHooks.value.current(), true); assert.equal(historyReads, 1);
  assert.equal(native.locatorsSnapshot()[0].chatId, 'unknown-chat'); operatorHooks.unmount();

  const copilotReact = { ...copilotHooks.runtime, createContext: React.createContext,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const globals = { window, document, navigator: { onLine: true }, HTMLElement: class {}, requestAnimationFrame: () => {} };
  const copilotOrder = compileAssistant('packages/rental-core/admin/assistant/copilot/useCopilotOrder.ts', {
    react: copilotReact, '../host': { useRentalAssistant: () => ports }, '@rental-os/shared': shared,
    './copilot-order-session': assistant('copilot/copilot-order-session.ts'),
  }, globals);
  const governance = compileAssistant('packages/rental-core/admin/governance/shared.ts', { react: copilotReact });
  const provider = compileAssistant('packages/rental-core/admin/assistant/copilot/CopilotProvider.tsx', {
    react: copilotReact, 'react/jsx-runtime': require('react/jsx-runtime'),
    '../host': { useRentalAssistant: () => ports, useLocation: () => ({ pathname: '/rental/orders/original-order' }), useNavigate: () => () => {} },
    'react-router-dom': require('react-router-dom'), '@rental-os/platform-admin/locale': { useLocale: () => ({ t: text => text }) },
    '@rental-os/platform-admin/source/components/ui/BusinessUiScope': {}, '@rental-os/platform-admin/source/components/ui/App': {},
    './context': assistant('copilot/context.ts'), './destinations': assistant('copilot/destinations.ts'),
    './useCopilotOrder': copilotOrder, '../../governance/shared': governance,
  }, globals, '\nexport { useCopilotState };');
  copilotHooks.mount(() => provider.useCopilotState());
  copilotHooks.value.show(); copilotHooks.rerender();
  assert.equal(copilotHooks.value.available, true); assert.equal(copilotHooks.value.observationCurrent(), true);
  const lateRead = copilotHooks.value.readOriginal();
  assert.equal(operationReads, 1);
  menuAllowed = false; copilotHooks.rerender();
  assert.equal(copilotHooks.value.available, false); assert.equal(copilotHooks.value.observationCurrent(), false);
  assert.equal(observedOperationSignal.aborted, true);
  releaseOperation({ draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION, operationKey: 'unknown-create', status: 'not_observed',
    retryable: false, nextAction: 'read_original_operation', absence: 'not_proof_of_no_commit' });
  await lateRead; copilotHooks.rerender();
  assert.equal(copilotHooks.value.order.text, ''); assert.equal(copilotHooks.value.order.facts, null);
  assert.equal(JSON.stringify([...records]), originalJournals);
  menuAllowed = true; copilotHooks.rerender();
  assert.equal(operationReads, 1, 'restoring the menu does not read or replay an operation');
  assert.equal(copilotHooks.value.order.hasOriginal, true);
  copilotHooks.unmount();
});

test('actual Copilot controls capture the original page path and transfer the same conversation without starting work', () => {
  const React = require('react'), hooks = hookFixture(), shared = source('packages/shared/src/index.ts');
  const captures = [], transfers = [], additions = [], sends = [], listeners = new Map();
  let allowed = true, closed = 0;
  const auth = { token: 'fixture-only', sessionVerified: true, user: { id: 'owner' }, tenant: { tenantId: 'tenant' }, currentWorkspaceId: 'space' };
  const identity = JSON.stringify(['tenant', 'space', 'owner']);
  const record = { key: 'record', label: '原订单', recordId: 'original', source: '订单', capturedAt: '2026-01-01T00:00:00Z' };
  const copilot = { identity, available: true, open: true, busy: false, contexts: [], turns: [], draft: '', orderId: 'original',
    order: { conversationId: 'original-conversation', facts: null, steps: [], hasOriginal: true, complete: false },
    registerVisibleHost: () => () => {}, close: () => { closed++; }, add: rows => additions.push(rows),
    send: (...args) => sends.push(args), clear: () => assert.fail('capture and transfer do not create a new conversation') };
  const document = { querySelectorAll: () => [record], addEventListener: (event, callback) => listeners.set(event, callback),
    removeEventListener: event => listeners.delete(event) };
  const background = { querySelector: () => record };
  const leaf = name => props => React.createElement(name, props);
  const ui = { Button: leaf('button'), Modal: leaf('modal'), Select: leaf('select'), AnimatedIcon: leaf('icon') };
  const imports = {
    react: hooks.runtime, 'react/jsx-runtime': require('react/jsx-runtime'), '@rental-os/shared': shared,
    '../host': { useRentalAssistant: () => ({ APP_ROUTES: { aiOperator: { path: '/ai-operator' } },
      canAccessRoute: () => allowed, currentSessionEpoch: () => 3, useAuthStore: Object.assign(() => auth, { getState: () => auth }) }),
      useLocation: () => ({ pathname: '/rental/orders/original' }), useNavigate: () => (href, options) => transfers.push({ href, options }) },
    '@rental-os/platform-admin/locale': { useLocale: () => ({ locale: 'zh-CN', t: text => text }) },
    '@animate-ui/react/primitives/base-ui/context-menu': {}, 'react-markdown': leaf('markdown'),
    'lucide-react': Object.fromEntries(['ArrowUp', 'FileText', 'PanelRightClose', 'Plus', 'RotateCcw', 'ShieldCheck', 'Square', 'X'].map(name => [name, leaf(name)])),
    '@rental-os/ai-native-admin/source/ai-native/safe-display': { safeDisplayText: text => text },
    '@rental-os/ai-native-admin/source/ai-native/VisibleObservationHost': { useVisibleObservationHost: () => null },
    '@rental-os/ai-native-admin/source/ai-native/VisibleObservationBoundary': {},
    './CopilotProvider': { useCopilot: () => copilot, ORDER_QUESTIONS: [] }, './CopilotNavigation': {}, './destinations': {},
    './context': { readRecord: (_node, pathname) => { captures.push(pathname); return { ...record, path: pathname }; } },
    './archive/ai-side-panel/side-panel.css': {}, './copilot.css': {},
  };
  for (const name of Object.keys(ui)) imports[`@rental-os/platform-admin/source/components/ui/${name}`] = { [name]: ui[name] };
  const module = compileAssistant('packages/rental-core/admin/assistant/copilot/CopilotLayout.tsx', imports, {
    document, window: { location: { pathname: '/cores/rental/orders/original' } }, MutationObserver: class { observe() {} disconnect() {} },
  }, '\nexport { CopilotPanel };');
  hooks.mount(() => module.CopilotPanel({ narrow: false, open: true, background }));
  const find = label => {
    let found; const walk = value => React.Children.forEach(value, child => {
      if (!React.isValidElement(child)) return;
      if (child.props.children === label) found = child;
      walk(child.props.children);
    }); walk(hooks.value); assert.ok(found, label); return found;
  };
  find('分析当前资料').props.onClick();
  assert.equal(captures[0], '/rental/orders/original'); assert.equal(additions[0][0].path, '/rental/orders/original');
  assert.equal(sends[0][2], additions[0]);
  find('在 Agent 控制台继续').props.onClick();
  const { readConversationNavigation } = assistant('ai-native/conversation-navigation.ts');
  const selection = readConversationNavigation(transfers[0].options.state.aiConversation, identity, 3);
  assert.equal(selection.conversationId, 'original-conversation'); assert.equal(transfers[0].href, '/ai-operator'); assert.equal(closed, 1);
  assert.equal(readConversationNavigation(transfers[0].options.state.aiConversation, identity, 4), null);
  allowed = false; find('在 Agent 控制台继续').props.onClick();
  assert.equal(transfers.length, 1); assert.equal(closed, 1);
  hooks.unmount(); assert.equal(listeners.size, 0);
});


test('historical quote and original quote or opening controls keep one original journal and never start on reopen', async () => {
  const React = require('react'), shared = source('packages/shared/src/index.ts');
  const sessions = assistant('ai-native/conversation-opening-execution-session.ts');
  const identity = JSON.stringify(['tenant', 'workspace', 'user']);
  for (const kind of ['historical_quote', 'quote', 'opening']) {
    const hooks = hookFixture(), values = new Map(), calls = [], listeners = new Set();
    let allowed = true;
    const capabilityCode = kind === 'opening' ? 'opening_diagnosis' : 'quote_clarification';
    const turn = { admissionKey: 'admission-original', turnId: 'turn-original', originalRequestKey: 'request-original',
      requestHash: 'a'.repeat(64), capabilityCode, capabilityVersion: '1', createdAt: '2026-11-03T00:00:00Z',
      automaticRetry: false, status: 'original_bound',
      original: { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: '11111111-1111-4111-8111-111111111111' },
      execution: 'not_inferred_from_association', material: 'retained',
      task: { taskId: '22222222-2222-4222-8222-222222222222', runId: '33333333-3333-4333-8333-333333333333' } };
    const conversationId = 'conversation-original';
    const journalKey = 'ai-conversation-' + (kind === 'opening' ? 'opening' : 'quote') + '-start:'
      + identity + ':' + conversationId + ':' + turn.admissionKey;
    const marker = { draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION, conversationId, admissionKey: turn.admissionKey,
      turnId: turn.turnId, requestHash: turn.requestHash, originalRequestKey: turn.originalRequestKey,
      capabilityCode, capabilityVersion: turn.capabilityVersion, original: turn.original, task: turn.task };
    values.set(journalKey, JSON.stringify(marker));
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const document = { hidden: false, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
    const api = { admission: async (query, signal) => { calls.push({ query, signal }); throw Error('original receipt unavailable'); },
      quoteStart: () => assert.fail('reopening cannot start a quote'), openingStart: () => assert.fail('reopening cannot start an opening diagnosis') };
    const stub = name => props => React.createElement(name, props);
    const imports = { react: { ...hooks.runtime, useSyncExternalStore(subscribe, snapshot) {
      const [, update] = hooks.runtime.useState(0);
      hooks.runtime.useEffect(() => subscribe(() => update(value => value + 1)), [subscribe]);
      return snapshot();
    } }, 'react/jsx-runtime': require('react/jsx-runtime'), '@rental-os/shared': shared,
      '../host': { useRentalAssistant: () => ({ aiConversationsApi: api, useAuthStore: () => ({ hasPermission: () => true }) }) },
      '@rental-os/platform-admin/ui': { ActionButton: stub('action'), Alert: stub('alert'), ConfirmAction: stub('confirm') },
      '@rental-os/ai-native-admin/source/ai-native/management-locale': { useAiManagementLocale: () => ({ t: value => value }) },
      '@rental-os/ai-native-admin/source/ai-native/formatters': { formatTimestamp: value => ({ value }) },
      '@rental-os/ai-native-admin/source/ai-native/safe-display': { safeDisplayText: value => value },
      '@rental-os/ai-native-admin/source/ai-native/VisibleObservationHost': { VisibleObservationHost: stub('visible-host'), useVisibleObservationHost: () => null },
      '@rental-os/ai-native-admin/source/ai-native/TaskCancellation': { TaskCancellation: stub('task-cancellation') },
      '@rental-os/ai-native-admin/source/ai-native/AiManagement.module.css': { default: {} },
      './conversation-opening-execution-session': sessions,
    };
    for (const name of ['ConversationResult', 'ConversationAdmission', 'ConversationOrderExecution', 'ConversationOpeningExecution',
      'ConversationQuoteConfirmation', 'ConversationQuoteSelection', 'TaskClarification']) imports['./' + name] = { [name]: stub(name) };
    for (const name of ['TaskReadPolicy', 'ReadinessDiagnosticsCard', 'TaskRuleDraft']) imports['../../task-center/' + name] = { [name]: stub(name) };
    const name = kind === 'historical_quote' ? 'ConversationQuoteTurn' : kind === 'quote' ? 'ConversationQuoteExecution' : 'ConversationOpeningExecution';
    const file = kind === 'historical_quote' ? 'ConversationDetail' : name;
    const module = compileAssistant('packages/rental-core/admin/assistant/ai-native/' + file + '.tsx', imports,
      { document, window: { sessionStorage: storage } }, kind === 'historical_quote' ? '\nexport { ConversationQuoteTurn };' : '');
    hooks.mount(() => module[name]({ identity, conversationId, turn, current: () => allowed, onAccessDenied() {} }));
    const nodes = () => { const out = []; const walk = tree => React.Children.forEach(tree, node => {
      if (React.isValidElement(node)) { out.push(node); walk(node.props.children); }
    }); walk(hooks.value); return out; };
    const readLabel = kind === 'opening' ? '核对原开业诊断' : '核对原报价执行';
    const read = () => { const button = nodes().find(node => node.props.label === readLabel); assert.ok(button, kind); return button.props.onAction; };
    assert.equal(calls.length, 0, kind + ' is explicit on reopen');
    assert.equal(nodes().some(node => ['启动报价澄清', '启动开业诊断'].includes(node.props.label)), false);
    await assert.rejects(read()(), /original receipt unavailable/); await hooks.settle();
    assert.equal(calls.length, 1); assert.equal(calls[0].query.admissionKey, turn.admissionKey);
    assert.equal(calls[0].query.conversationId, conversationId);
    const stale = read(); allowed = false;
    await assert.rejects(async () => stale(), /AI_SCOPE_CHANGED/); assert.equal(calls.length, 1);
    assert.equal(values.get(journalKey), JSON.stringify(marker)); assert.equal(values.size, 1);
    hooks.unmount(); assert.equal(listeners.size, 0);
  }
});


test('restored calendar rule and notification entry controls retain original locators across remount and session changes', async () => {
  const React = require('react'), shared = source('packages/shared/src/index.ts');
  for (const kind of ['calendar', 'rule', 'notification']) {
    const hooks = hookFixture(), records = new Map(), calls = [], listeners = new Set();
    let epoch = 1, sessionAbort = new AbortController(), allowed = true, sensitive = false, finish;
    let response = async () => { throw Error('original response unavailable'); };
    const auth = { token: 'fixture-only', sessionVerified: true, tenant: { tenantId: 'tenant' }, currentWorkspaceId: 'workspace',
      user: { id: 'user', isSaasAdmin: false }, hasPermission: () => true, hasTenantMembershipPermission: () => sensitive };
    const useAuthStore = Object.assign(() => auth, { getState: () => auth });
    const session = { useAuthStore, currentSessionEpoch: () => epoch, currentSessionSignal: () => sessionAbort.signal,
      http: { post: async (url, data, options) => { calls.push({ url, data, options }); return { data: { data: await response() } }; } },
      runtime: { request: () => assert.fail('an unresolved draft cannot read templates or send business') } };
    const key = kind === 'calendar' ? 'rental-os-calendar-entry:' + JSON.stringify(['tenant', 'workspace', 'user', '2026-11-24'])
      : kind === 'rule' ? 'rental-os-rule-source:' + JSON.stringify(['tenant', 'workspace', 'user', 'rule-original'])
      : 'rental-os:notification-draft:tenant:workspace:user:customer-original';
    const original = kind === 'notification' ? '44444444-4444-4444-8444-444444444444' : JSON.stringify({ operationKey: '44444444-4444-4444-8444-444444444444' });
    records.set(key, original);
    const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
    const document = { hidden: false, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
    const stub = name => props => React.createElement(name, props);
    const runtime = { ...hooks.runtime, useId: () => 'entry', useReducer(reducer, initial) {
      const [value, set] = hooks.runtime.useState(initial); return [value, action => set(value => reducer(value, action))];
    } };
    const ports = { ...session,
      aiTaskCalendarDraftApi: source('packages/rental-core/admin/task-center/api/aiTaskCalendarDraft.ts').createAiTaskCalendarDraftApi(session),
      aiTaskRuleDraftApi: source('packages/rental-core/admin/task-center/api/aiTaskRuleDraft.ts').createAiTaskRuleDraftApi(session) };
    const imports = { react: runtime, 'react/jsx-runtime': require('react/jsx-runtime'), '@rental-os/shared': shared,
      '../host': { useRentalAssistant: () => ({ ...session, session }) }, '../../task-center/runtime': { useRentalTaskCenter: () => ports },
      '@rental-os/platform-admin/ui': Object.fromEntries(['ActionButton', 'Alert', 'Button', 'ConfirmAction', 'Select', 'Input'].map(name => [name, stub(name)])),
      '@rental-os/ai-native-admin/source/ai-native/management-locale': { useAiManagementLocale: () => ({ t: value => value, locale: 'zh-CN' }) },
      '@rental-os/ai-native-admin/source/ai-native/formatters': { formatTimestamp: value => ({ value }) },
      '@rental-os/ai-native-admin/source/ai-native/safe-display': { safeDisplayText: value => value, displayTextContent: value => value },
      '@rental-os/ai-native-admin/source/ai-native/AiManagement.module.css': { default: {} },
      '../../task-center/task-calendar-draft-session': source('packages/rental-core/admin/task-center/task-calendar-draft-session.ts'),
      '../../task-center/CalendarDraftPreparation': { CalendarDraftPreparation: stub('calendar-preparation'), useCalendarDraftLocale: () => ({ t: value => value }) },
      '../../task-center/TaskCalendarDraft': { TaskCalendarDraft: stub('calendar-draft') },
      '../../task-center/TaskRuleDraft': { TaskRuleDraft: stub('rule-draft') },
      './rule-source-entry-session': assistant('ai-native/rule-source-entry-session.ts'),
      './notification-draft-session': assistant('ai-native/notification-draft-session.ts'),
      '../api/aiNotificationDrafts': assistant('api/aiNotificationDrafts.ts'),
      '../../governance/client': source('packages/rental-core/admin/governance/client.ts'),
    };
    const name = kind === 'calendar' ? 'CalendarSourceEntry' : kind === 'rule' ? 'RuleSourceEntry' : 'NotificationDraftFlow';
    const module = compileAssistant('packages/rental-core/admin/assistant/ai-native/' + name + '.tsx', imports,
      { document, window: { localStorage: storage }, setTimeout, clearTimeout });
    const mount = () => hooks.mount(() => module[name]({ identity: 'original-owner', date: '2026-11-24', targetId: 'rule-original',
      version: '1', customerId: 'customer-original', current: () => allowed, onAccessDenied() {}, onComplete() {} }));
    mount(); assert.equal(calls.length, 0);
    if (kind === 'notification') { assert.equal(hooks.value, null, 'tenant membership sensitive authority is required'); sensitive = true; hooks.rerender(); }
    const label = kind === 'calendar' ? '核对原日历任务' : kind === 'rule' ? '核对原规则任务' : '核对原通知草稿';
    const action = () => { let found; const walk = tree => React.Children.forEach(tree, node => {
      if (React.isValidElement(node)) { if (node.props.label === label) found = node.props.onAction; walk(node.props.children); }
    }); walk(hooks.value); assert.ok(found, label); return found; };
    await assert.rejects(action()(), /original response unavailable/); await hooks.settle();
    assert.equal(calls.length, 1); assert.equal(calls[0].data.operationKey, '44444444-4444-4444-8444-444444444444');
    assert.equal(records.get(key), original); assert.equal(records.size, 1);
    response = () => new Promise(resolve => { finish = resolve; });
    const pending = action()(); assert.equal(calls.length, 2);
    sessionAbort.abort(); sessionAbort = new AbortController(); epoch++; hooks.rerender(); finish({});
    await assert.rejects(pending, /AI_SCOPE_CHANGED/); await hooks.settle();
    assert.equal(records.get(key), original);
    hooks.unmount(); mount(); assert.equal(calls.length, 2, 'remount only restores the original locator');
    const stale = action(); allowed = false;
    await assert.rejects(async () => stale(), /AI_SCOPE_CHANGED/); assert.equal(calls.length, 2);
    assert.equal(records.get(key), original); assert.equal(records.size, 1);
    hooks.unmount(); assert.equal(listeners.size, 0);
  }
});

test('restored category controls keep platform and workspace ownership and the original unknown operation', async () => {
  const React = require('react'), shared = source('packages/shared/src/index.ts');
  const sessionSource = assistant('ai-native/category-assist-session.ts');
  for (const mode of ['platform', 'workspace']) {
    const hooks = hookFixture(), records = new Map(), calls = [], listeners = new Set();
    const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
    let epoch = 3, abort = new AbortController(), permitted = true, live = true, release;
    let response = async () => ({ outcome: 'unknown' });
    const auth = { token: 'fixture-only', sessionVerified: true, user: { id: 'owner', isSaasAdmin: mode === 'platform' },
      tenant: { tenantId: 'tenant' }, currentWorkspaceId: mode === 'platform' ? null : 'workspace', hasPermission: () => permitted };
    const owner = { tenantId: 'tenant', actorId: 'owner', workspaceId: auth.currentWorkspaceId, mode };
    const store = sessionSource.categoryAssistStore(owner, storage), pending = { kind: mode === 'platform' ? 'create' : 'adopt',
      key: 'original-category-operation', code: 'camera', intentHash: 'a'.repeat(64),
      ...(mode === 'platform' ? { versionLabel: '1.0', definitionHash: 'b'.repeat(64) } : {
        versionId: 'target-version', sourceVersionId: 'source-version', sourceRevision: 2, preparationRevision: 3,
        targetPolicyRevision: 4, operation: 'upgrade' }) };
    store.reserve(pending);
    const key = 'rental-os-category-assist:' + JSON.stringify(['tenant', 'owner', auth.currentWorkspaceId, mode]);
    assert.equal(store.key, key); const original = records.get(key);
    assert.equal(sessionSource.categoryAssistStore({ mode, workspaceId: auth.currentWorkspaceId, actorId: 'owner', tenantId: 'tenant' }, storage).key, key);
    const session = { useAuthStore: Object.assign(() => auth, { getState: () => auth }), currentSessionEpoch: () => epoch,
      currentSessionSignal: () => abort.signal, http: { request: async options => {
        calls.push(options); return { data: { data: await response(options) } };
      } }, runtime: { request: () => assert.fail('no preparation read while reconciling the original receipt') } };
    const stub = name => props => React.createElement(name, props);
    const document = { hidden: false, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
    const runtime = { ...hooks.runtime, useReducer(reducer, initial) {
      const [value, set] = hooks.runtime.useState(initial); return [value, action => set(value => reducer(value, action))];
    } };
    const flow = compileAssistant('packages/rental-core/admin/assistant/ai-native/CategoryAssistFlow.tsx', {
      react: runtime, 'react/jsx-runtime': require('react/jsx-runtime'), '@rental-os/shared': shared,
      antd: { InputNumber: stub('InputNumber') }, '../host': { useRentalAssistant: () => ({ ...session, session }) },
      '../api/aiCategoryDraft': assistant('api/aiCategoryDraft.ts'), './category-assist-session': sessionSource,
      '../../governance/category-preparation-client': source('packages/rental-core/admin/governance/category-preparation-client.ts'),
      '../../governance/CategoryConditionalCapabilitiesEditor': { CategoryConditionalCapabilitiesEditor: stub('conditional') },
      '../../governance/CategoryCompatibilityRelationsEditor': { CategoryCompatibilityRelationsEditor: stub('compatibility') },
      '../../governance/categoryDraftFields': source('packages/rental-core/admin/governance/categoryDraftFields.ts'),
      '../../governance/categoryDraftSections': source('packages/rental-core/admin/governance/categoryDraftSections.ts'),
      '../../governance/categoryPreparationCapabilities': source('packages/rental-core/admin/governance/categoryPreparationCapabilities.ts'),
      '../../governance/categoryPreparationFields': source('packages/rental-core/admin/governance/categoryPreparationFields.ts'),
      '@rental-os/platform-admin/ui': Object.fromEntries(['ActionButton', 'Alert', 'App', 'Button', 'ConfirmAction', 'Form', 'Input', 'Select', 'Switch', 'Tabs'].map(name => [name, stub(name)])),
      '@rental-os/platform-admin/forms': { UnsavedChangesGuard: stub('guard') },
      '@rental-os/platform-admin/source/components/workspace/ContentTransition': { ContentTransition: stub('transition') },
      '@rental-os/platform-admin/locale': { useLocale: () => ({ t: value => value, locale: 'zh-CN' }) },
      '@rental-os/ai-native-admin/source/ai-native/safe-display': { safeDisplayText: value => value },
      '@rental-os/ai-native-admin/source/ai-native/AiManagement.module.css': { default: {} },
    }, { document, window: { localStorage: storage } });
    const mount = () => hooks.mount(() => flow.CategoryAssistFlow({ mode, code: 'camera', current: () => live }));
    const action = () => { let found; const walk = tree => React.Children.forEach(tree, node => {
      if (!React.isValidElement(node)) return;
      if (node.props.label === '核对原操作结果') found = node.props.onAction;
      walk(node.props.children);
    }); walk(hooks.value); assert.ok(found); return found; };
    mount(); assert.ok(hooks.value, 'platform mode remains available without a workspace');
    assert.equal(calls.length, 0, 'opening the page does not dispatch the original write or read');
    await action()(); await hooks.settle();
    assert.equal(calls.length, 1); assert.equal(calls[0].method, 'get');
    assert.ok(calls[0].url.endsWith('/original-category-operation')); assert.equal(records.get(key), original);
    hooks.unmount(); mount(); assert.equal(calls.length, 1);
    permitted = false; await assert.rejects(action()(), /AI_ACCESS_DENIED/); assert.equal(calls.length, 1);
    permitted = true; response = () => new Promise(resolve => { release = resolve; });
    const late = action()(); assert.equal(calls.length, 2);
    abort.abort(); abort = new AbortController(); epoch++; hooks.rerender(); release({ outcome: 'unknown' });
    await assert.rejects(late, /AI_SCOPE_CHANGED/); await hooks.settle();
    assert.equal(calls[1].signal.aborted, true); assert.equal(records.get(key), original);
    const stale = action(); live = false; await assert.rejects(stale(), /AI_SCOPE_CHANGED/); assert.equal(calls.length, 2);
    hooks.unmount(); assert.equal(listeners.size, 0); assert.equal(records.size, 1);
  }
});

test('archived history and later pages remain readable with a full journal of unresolved sends', async () => {
  const scene = 'order_explanation', signal = new AbortController().signal;
  const originals = Array.from({ length: 100 }, (_, index) => ({ chatId: `chat-${index}`, scene, conversationId: null, pending: true }));
  const storage = { getItem: () => JSON.stringify(originals), setItem: () => assert.fail('history wrote to the journal') };
  const session = new NativeOperatorSession({ storage, identity: 'owner', current: () => true, tasks: {}, api: {
    list: async query => { assert.equal(query.status, 'archived'); assert.equal(query.beforeId, 'cursor'); return { items: [], nextBeforeId: null }; },
    detail: async () => ({ conversation: { status: 'archived', currentTurn: null }, turns: { items: [] } }),
  } });
  assert.equal((await session.history(scene, signal, 'archived', 'cursor')).nextBeforeId, null);
  assert.equal((await session.open('history', 'original', scene, signal)).historical, true);
  assert.deepEqual(session.locatorsSnapshot(), originals);
});

test('the actual run distinguishes partial completion and an unknown step', () => {
  const run = nativeAgentRun({ status: 'partially_succeeded', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:05Z',
    steps: [{ stepId: 'step', sequence: 1, kind: 'model', status: 'unknown' }] });
  assert.equal(run.status, 'partial'); assert.equal(run.steps[0].status, 'unknown');
});

test('retracting the console permanently rejects a late original read while a fresh read remains available', async () => {
  let release, observedSignal, changed = 0, first = true;
  const delayed = new Promise(resolve => { release = resolve; });
  const detail = { conversation: { status: 'archived', currentTurn: null }, turns: { items: [] } };
  const session = new NativeOperatorSession({ identity: 'owner', current: () => true,
    storage: { getItem: () => null, setItem: () => assert.fail('a historical read changed a journal') }, tasks: {},
    changed: () => { changed++; }, api: { detail: async (_query, _scene, signal) => {
      observedSignal = signal;
      if (first) { first = false; return delayed; }
      return detail;
    } } });
  const pending = session.open('history', 'original', 'order_explanation', new AbortController().signal);
  session.retract();
  release(detail);
  await assert.rejects(pending, /AI_SCOPE_CHANGED/);
  assert.equal(observedSignal.aborted, true);
  assert.equal(changed, 0);
  assert.equal(session.frame('history'), null);
  await session.open('history', 'original', 'order_explanation', new AbortController().signal);
  assert.equal(changed, 1);
  assert.equal(session.frame('history').historical, true);
});

test('native work area callbacks expire on hide, selection change and unmount without reviving on reopen', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript'), React = require('react');
  const source = fs.readFileSync(path.join(root, 'packages/rental-core/admin/assistant/ai-operator/NativeOperatorWorkspace.tsx'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const slots = [], effects = [], layouts = [], cleaners = new Map(), admissions = []; let cursor = 0, closureKey;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(factory, dependencies) { const index = cursor++;
      if (!slots[index] || dependencies.some((value, offset) => value !== slots[index].dependencies[offset])) slots[index] = { dependencies, value: factory() };
      return slots[index].value;
    },
    useEffect(effect, dependencies) { const index = cursor++;
      if (!slots[index] || dependencies.some((value, offset) => value !== slots[index][offset])) {
        slots[index] = dependencies; effects.push(() => { cleaners.get(index)?.(); cleaners.set(index, effect()); });
      }
    },
    useLayoutEffect(effect, dependencies) { const index = cursor++;
      if (!slots[index] || dependencies.some((value, offset) => value !== slots[index][offset])) {
        slots[index] = dependencies; layouts.push(() => { cleaners.get(index)?.(); cleaners.set(index, effect()); });
      }
    },
  };
  const operator = { activeId: 'chat', active: { native: { conversationId: 'conversation', phase: 'result', turn: { turnId: 'turn' } } },
    capability: { nativeScene: 'order_explanation' }, current: () => true };
  const exports = {}, leaf = name => props => React.createElement(name, props);
  const leaves = ['ConversationResult', 'ConversationQuoteConfirmation', 'ConversationQuoteSelection', 'ConversationOrderHandoff',
    'ConversationClosure', 'TaskCancellation', 'ContentTransition', 'AgentRun'];
  vm.runInNewContext(output, { exports, sessionStorage: { getItem: () => null }, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === './OperatorContext') return { useOperator: () => operator };
    if (name === '../host') return { useNavigate: () => () => {}, useRentalAssistant: () => ({ aiConversationsApi: {} }) };
    if (name === '@rental-os/ai-native-admin/source/ai-native/management-locale') return { useAiManagementLocale: () => ({ locale: 'zh-CN', t: value => value }) };
    if (name === '@rental-os/platform-admin/ui') return { Button: leaf('button'), Input: leaf('input'), Select: leaf('select') };
    if (name === './native-session') return {};
    if (name === '../ai-native/conversation-admission-session') return { ConversationAdmissionSession: class {
      constructor(_conversationId, _api, current) { this.current = current; admissions.push(this); }
      activate() {} dispose() {} canClose() { return false; }
    } };
    const component = leaves.find(value => name.endsWith(`/${value}`));
    if (component) return { [component]: leaf(component) };
    throw Error(`Unexpected work area dependency: ${name}`);
  } });
  const render = visible => {
    cursor = 0;
    const tree = exports.NativeOperatorWorkspace({ visible });
    let current, closure;
    const walk = value => React.Children.forEach(value, child => {
      if (!React.isValidElement(child)) return;
      if (child.props.conversationId) current = child.props.current;
      if (child.type.name === 'NativeRoundClosure') closure = child;
      walk(child.props.children);
    });
    walk(tree);
    if (closureKey !== closure?.key || !closure) {
      for (const [index, cleanup] of cleaners) if (index >= cursor) { cleanup?.(); cleaners.delete(index); }
      slots.splice(cursor); closureKey = closure?.key;
    }
    if (closure) closure.type(closure.props);
    layouts.splice(0).forEach(effect => effect());
    if (visible) assert.equal(current(), true, 'Child passive effects can read the original result before parent passive effects');
    effects.splice(0).forEach(effect => effect());
    return current;
  };
  const original = render(true); assert.equal(original(), true);
  render(false); assert.equal(original(), false);
  const reopened = render(true); assert.equal(reopened(), true); assert.equal(original(), false);
  assert.equal(admissions.length, 2); assert.equal(admissions[0].current(), false); assert.equal(admissions[1].current(), true);
  operator.activeId = 'other'; render(true); assert.equal(reopened(), false);
  operator.activeId = 'chat'; const current = render(true); assert.equal(reopened(), false); assert.equal(current(), true);
  assert.equal(admissions.length, 4); assert.equal(admissions.at(-1).current(), true);
  cleaners.forEach(cleaner => cleaner?.()); assert.equal(current(), false);
});

test('English task steps, their accessible names and historical results follow the selected locale', () => {
  const english = (_chinese, text) => text;
  const { stepLabel } = assistant('ai-operator/archive/agent-run/agent-run-state.ts');
  const { nativeResultText } = assistant('ai-operator/native-session.ts');
  const run = nativeAgentRun({ status: 'partially_succeeded', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:05Z',
    steps: [{ stepId: 'amount', sequence: 1, kind: 'model', status: 'unknown' }, { stepId: 'save', sequence: 2, kind: 'confirmation', status: 'failed' }] }, english);
  assert.equal(stepLabel(run.steps[0]), 'Step result awaiting verification 1 · amount');
  assert.equal(stepLabel(run.steps[1]), 'Failed step 2 · save');
  assert.match(nativeResultText({ result: { status:'material_erased' } }, english), /original input expired/u);
  assert.equal(nativeResultText({ result: { status:'observed', result:{status:'available',text:{value:'原回执内容'}} } }, english), '原回执内容');
});

test('Copilot verifies the original order, closure and idle revision before releasing a local conversation', async () => {
  const { CopilotOrderSession } = assistant('copilot/copilot-order-session.ts');
  const { commandHash } = assistant('ai-native/budget-settings-session.ts');
  const shared = source('packages/shared/src/index.ts');
  const draftVersion = shared.AI_CONVERSATION_DRAFT_VERSION, conversationId = 'conversation';
  const requestHash = await commandHash({sceneCode:'order_explanation',input:{orderId:'order',question:'fees'}});
  const proof = {operationKey:'close',admissionKey:'admit',turnId:'turn',originalInputRef:'input',requestHash};
  const head = {draftVersion,conversationId,revision:3,status:'active',capabilityCode:'order_explanation',currentTurn:null,closedTurn:proof};
  const turn = {admissionKey:'admit',turnId:'turn',originalRequestKey:'request',requestHash,capabilityCode:'order_explanation',capabilityVersion:'v1',
    createdAt:new Date().toISOString(),status:'original_bound',automaticRetry:false,original:{draftVersion:shared.AI_SCENE_REQUEST_DRAFT_VERSION,inputRef:'input'},
    execution:'not_inferred_from_association',material:'retained',task:null,creation:'permanently_closed',closeOperationKey:'close'};
  const receipt = {draftVersion:shared.AI_CONVERSATION_UNSTARTED_DRAFT_VERSION,status:'observed',operationKey:'close',retryable:false,
    conversationId,revision:3,operation:'close_unstarted',creation:'permanently_closed',task:'not_created',taskCancellation:'not_requested',businessRecords:'not_modified'};
  for (const scenario of ['closed','empty','otherOrder','oldReceipt','changedOnRead','changedBeforeClear','wrongKey']) {
    const raw = JSON.stringify({version:1,createKey:'create',conversationId}), key = 'ai-copilot-order:owner:order';
    const records = new Map([[key,raw]]); let reads = 0;
    const session = new CopilotOrderSession({
      detail: async (_input,_scene,_signal,includeClosedTurn) => {
        assert.equal(includeClosedTurn,true); reads++;
        return {conversation:{...head,revision:scenario === 'changedOnRead' && reads > 1 || scenario === 'changedBeforeClear' && reads > 2 ? 5 : 3,
          closedTurn:scenario === 'empty' ? undefined : scenario === 'otherOrder' ? {...proof,requestHash:'a'.repeat(64)} : proof}};
      },
      admission: async () => ({draftVersion,conversationId,admissionKey:'admit',result:turn,absence:'not_proof_of_no_commit',retryable:false}),
      operation: async () => ({...receipt,revision:scenario === 'oldReceipt' ? 2 : 3,operationKey:scenario === 'wrongKey' ? 'different' : 'close'}),
    }, {getItem:key => records.get(key) ?? null,removeItem:key => records.delete(key),setItem:() => assert.fail('unexpected write')},'owner','order',() => true);
    session.activate();
    if (scenario === 'closed' || scenario === 'changedBeforeClear') {
      await session.read(); assert.equal(session.snapshot().complete,true);
      if (scenario === 'closed') { await session.newChat(); assert.equal(records.has(key),false); continue; }
    } else await assert.rejects(session.read());
    await assert.rejects(session.newChat()); assert.equal(records.get(key),raw);
  }
});
