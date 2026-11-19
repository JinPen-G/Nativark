'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ skipProject: true, transpileOnly: true, moduleTypes: { '**': 'cjs' }, compilerOptions: { module: 'commonjs', target: 'es2022' } });
const { NativeOperatorSession, nativeAgentRun } = require('../apps/admin/src/features/ai-operator/native-session');

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
  const source = fs.readFileSync(path.resolve(__dirname, '../apps/admin/src/features/ai-operator/NativeOperatorWorkspace.tsx'), 'utf8');
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
    if (name === 'react-router-dom') return { useNavigate: () => () => {} };
    if (name === '../ai-native/management-locale') return { useAiManagementLocale: () => ({ locale: 'zh-CN', t: value => value }) };
    if (name === '@/components/ui') return { Button: leaf('button'), Input: leaf('input'), Select: leaf('select') };
    if (['@/api/aiConversations', './native-session'].includes(name)) return {};
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
  const { stepLabel } = require('../apps/admin/src/features/ai-operator/archive/agent-run/agent-run-state');
  const { nativeResultText } = require('../apps/admin/src/features/ai-operator/native-session');
  const run = nativeAgentRun({ status: 'partially_succeeded', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:05Z',
    steps: [{ stepId: 'amount', sequence: 1, kind: 'model', status: 'unknown' }, { stepId: 'save', sequence: 2, kind: 'confirmation', status: 'failed' }] }, english);
  assert.equal(stepLabel(run.steps[0]), 'Step result awaiting verification 1 · amount');
  assert.equal(stepLabel(run.steps[1]), 'Failed step 2 · save');
  assert.match(nativeResultText({ result: { status:'material_erased' } }, english), /original input expired/u);
  assert.equal(nativeResultText({ result: { status:'observed', result:{status:'available',text:{value:'原回执内容'}} } }, english), '原回执内容');
});

test('Copilot verifies the original order, closure and idle revision before releasing a local conversation', async () => {
  const { CopilotOrderSession } = require('../apps/admin/src/features/copilot/copilot-order-session');
  const { commandHash } = require('../apps/admin/src/features/ai-native/budget-settings-session');
  const shared = require('@rental-os/shared');
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
