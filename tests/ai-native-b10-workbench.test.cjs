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
  vm.runInNewContext(output, { exports, AbortController, AbortSignal, structuredClone, TextEncoder, Uint8Array, crypto: require('node:crypto').webcrypto, require(name) {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name === '@rental-os/shared') return require('@rental-os/shared');
    throw Error(name);
  } });
  return exports;
}

test('first visible host closes original text/card client reports through existing logs and read view', async () => {
  const { LiveVisibleObservationSession } = loadLifecycleSession('visible-observation-session.ts');
  const { recordTaskVisibleObservation } = require('../apps/api/src/modules/ai-native/observability/task-visible-observation.service.ts');
  const { TaskPerformanceReader } = require('../apps/api/src/modules/ai-native/observability/task-performance.reader.ts');
  const { AiTaskRepository } = require('../apps/api/src/modules/ai-native/ai-task.repository.ts');
  const h = require('./fixtures/ai-native/contract-consumer.cjs'), shared = require('../packages/shared/src/index');
  const context = structuredClone(h.contexts[0]), taskId = 'visible-task', runId = 'visible-run';
  const originKey = '12345678-1234-4234-8234-123456789012', wall = new Date('2026-11-09T12:02:00Z');
  const task = { id: taskId, scopeId: 'visible-scope', sceneCode: 'order_explanation', sceneVersion: '1', status: 'SUCCEEDED',
    revision: 2, eventCursor: 0n, createdAt: new Date('2026-11-09T12:00:00Z'), updatedAt: new Date('2026-11-09T12:01:00Z'), cancelRequestedAt: null };
  const run = { id: runId, scopeId: task.scopeId, taskId, actorKind: 'USER', actorId: context.actor.userId, sequence: 1,
    status: 'SUCCEEDED', revision: 2, startedAt: task.createdAt, endedAt: task.updatedAt };
  const logs = new Map(), trace = []; let serverCurrent = true, sourceCurrent = true;
  const db = { aiTask: { findFirst: async ({ where }) => { assert.equal(where.id, taskId); return structuredClone(task); } },
    aiRun: { findFirst: async ({ where }) => { assert.equal(where.id, runId); assert.equal(where.taskId, taskId); return { id: runId }; },
      findMany: async () => [structuredClone(run)] }, aiStep: { findMany: async () => [] },
    aiTaskExecutionBudget: { findFirst: async () => null }, aiTaskExecutionCharge: { groupBy: async () => [] },
    aiGatewayInvocation: { findMany: async () => [] }, aiTaskInputRequest: { findFirst: async ({ where }) =>
      where.id === originKey && where.taskId === taskId ? { id: originKey } : null },
    operationLog: { findUnique: async ({ where }) => structuredClone(logs.get(where.id) ?? null),
      findMany: async ({ where }) => [...logs.values()].filter(row => row.action === where.action).map(row => structuredClone(row)),
      create: async ({ data }) => { trace.push('client-log-create'); assert.equal(logs.has(data.id), false); logs.set(data.id, structuredClone(data)); return structuredClone(data); } },
    $transaction: async work => work(db) };
  const authority = { resolve: async () => { if (!serverCurrent) throw Error('Original current authority denied'); return structuredClone(context); } };
  const tasks = new AiTaskRepository(db, authority, () => wall);
  const binding = async report => {
    assert.equal(report.taskId, taskId); assert.equal(report.runId, runId); assert.equal(report.originKey, originKey);
    const known = report.source.kind === 'model_result' ? ['visible-result', 'future-result'].includes(report.source.resultId)
      : report.source.proposalId === 'visible-proposal' && report.source.stepId === 'visible-step' && [1, 2].includes(report.source.proposalRevision);
    if (!known || !sourceCurrent) return null;
    return require('../apps/api/src/modules/rental-core/rental-idempotency.repository.ts').requestFingerprint({ taskId, runId, source: report.source });
  };
  let epoch = 1, clock = 0, clientCurrent = true, uuid = 0, deliveries = [];
  const driver = { available: () => true, current: () => clientCurrent, epoch: () => epoch, now: () => clock,
    uuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`, viewport: () => 'wide_viewport',
    report: async report => { const job = recordTaskVisibleObservation({ db, tasks, sourceBinding: binding, clock: () => wall }, report);
      deliveries.push(job); await job; } };
  const session = new LiveVisibleObservationSession('task_center', driver, { taskId });
  let resultId = 'visible-result', proposalRevision = 1;
  const source = kind => ({ taskId, runId, source: kind === 'text' ? { kind: 'model_result', resultId }
    : { kind: 'approval_card', stepId: 'visible-step', proposalId: 'visible-proposal', proposalRevision } });
  const document = { hidden: false, elementFromPoint: () => document.hit,
    createRange: () => ({ selectNodeContents() {}, getClientRects: () => [{ left: 1, top: 1, right: 50, bottom: 20 }] }),
    addEventListener() {}, removeEventListener() {} };
  const navigator = { onLine: true }, frames = [], window = { innerWidth: 1200, innerHeight: 800,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {}, addEventListener() {}, removeEventListener() {} };
  const element = { isConnected: true, hidden: false, inert: false, parentElement: null, textContent: 'Original model text',
    contains: other => other === element, getClientRects: () => [{ left: 1, top: 1, right: 50, bottom: 20 }], querySelector: () => element };
  document.hit = element;
  let cleanup;
  const hooks = { useRef: () => ({ current: element }), useSyncExternalStore: (_subscribe, get) => get(), useEffect: fn => { cleanup = fn(); } };
  const exports = {}, code = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/VisibleObservationBoundary.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, document, navigator, window, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    IntersectionObserver: class { constructor(fn) { this.callback = fn; } observe() { this.callback([{ isIntersecting: true, intersectionRatio: 1 }]); } disconnect() {} },
    require(name) { if (name === 'react') return hooks; if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (name === './VisibleObservationHost') return { useVisibleObservationHost: () => session }; throw Error(name); } });
  const mount = kind => { cleanup?.(); exports.VisibleObservationBoundary({ kind, reference: source(kind), ready: true, children: 'controlled-source' }); };
  const paint = () => { const next = frames.splice(0); next.forEach(fn => fn()); };
  const key = session.begin({ taskId, trigger: 'original_input_resume', originKey }); assert.ok(key); assert.equal(session.bindRun(key, runId), true);
  const originalRows = JSON.stringify({ task, run }, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  mount('text'); clock = 10; paint(); assert.equal(logs.size, 0, 'One frame is not first visible text'); clock = 20; paint();
  await Promise.resolve(); await Promise.all(deliveries); assert.equal(logs.size, 1);
  mount('card'); clock = 30; paint(); clock = 40; paint(); await Promise.resolve(); await Promise.all(deliveries); assert.equal(logs.size, 2);
  mount('text'); paint(); paint(); await Promise.resolve(); assert.equal(logs.size, 2, 'Rerender cannot re-report first text');
  for (const row of logs.values()) {
    assert.equal(row.detail.report.provenance, 'client_reported_not_business_fact'); assert.equal(row.detail.report.sampleSize, 1);
    assert.equal(row.detail.report.basis, 'viewport_intersection_after_two_frames');
    assert.doesNotMatch(JSON.stringify(row.detail), /Original model text|https?:|credential|apiKey/);
  }
  await recordTaskVisibleObservation({ db, tasks, sourceBinding: binding, clock: () => wall }, [...logs.values()][0].detail.report);
  assert.equal(logs.size, 2, 'Exact original observation receipt replay does not add a new log');
  const usage = { read: async () => ({ taskId, items: [], nextAfter: null, observedAt: wall.toISOString(), coverage: 'page_not_total', totals: 'not_computed',
    consistency: 'revalidated_reads_not_atomic_snapshot', absenceSemantics: 'no_record_is_not_proof_of_no_consumption', businessExecution: 'not_inferred_from_usage', admission: 'not_granted' }) };
  const reader = new TaskPerformanceReader(db, authority, usage, () => wall), observed = await reader.read({ taskId, usageLimit: 20 }, binding);
  assert.equal(observed.clientVisible.state, 'client_reported'); assert.equal(observed.clientVisible.observations.length, 2);
  assert.equal(observed.clientVisible.evaluation, 'not_slo_evidence'); assert.equal(observed.measurements.firstToken, 'client_reported');
  assert.equal(observed.measurements.firstCard, 'client_reported'); assert.equal(observed.measurements.slo, 'not_evaluated');
  assert.equal(JSON.stringify({ task, run }, (_, v) => typeof v === 'bigint' ? v.toString() : v), originalRows);
  assert.deepEqual(trace, ['client-log-create', 'client-log-create']);
  cleanup?.(); session.invalidate();
  resultId = 'future-result'; proposalRevision = 2;
  const hiddenKey = session.begin({ taskId, runId, trigger: 'original_input_resume', originKey }); assert.ok(hiddenKey);
  mount('text'); paint(); document.hidden = true; session.invalidate(); paint(); await Promise.resolve(); assert.equal(logs.size, 2);
  document.hidden = false; const epochKey = session.begin({ taskId, runId, trigger: 'original_input_resume', originKey }); assert.ok(epochKey);
  mount('card'); paint(); epoch++; paint(); await Promise.resolve(); assert.equal(logs.size, 2);
  const reopened = new LiveVisibleObservationSession('task_center', driver, { taskId }); assert.equal(reopened.visible(source('text'), 'text'), false);
  const hostEffects = [], hostExports = {}, hostSignal = new AbortController();
  const hostCode = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/VisibleObservationHost.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(hostCode, { exports: hostExports, document, navigator, window, IntersectionObserver: class {},
    crypto: require('node:crypto').webcrypto, performance: { now: () => clock }, require(name) {
      if (name === 'react') return { createContext: () => ({ Provider: 'visible-host' }), useContext() {},
        useRef: value => ({ current: value }), useMemo: fn => fn(), useEffect: fn => hostEffects.push(fn) };
      if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (name === '@/app/queryClient') return { currentSessionEpoch: () => epoch, currentSessionSignal: () => hostSignal.signal };
      if (name === '@/api/aiTaskCenter') return { aiTaskCenterApi: { reportVisible() { throw Error('No disposed host report is allowed'); } } };
      if (name === './visible-observation-session') return { LiveVisibleObservationSession }; throw Error(name);
    } });
  const mountHost = () => hostExports.VisibleObservationHost({ surface: 'task_center', taskId, current: () => clientCurrent }).props.value;
  const closedHost = mountHost(), originalAction = { taskId, runId, trigger: 'original_input_resume', originKey };
  assert.equal(closedHost.begin(originalAction), null, 'A rendered host is not yet a mounted observation origin');
  let closeHost = hostEffects[0](); assert.ok(closedHost.begin(originalAction)); closeHost();
  assert.equal(closedHost.begin(originalAction), null, 'An old callback cannot rearm an unmounted host');
  closeHost = hostEffects[0](); assert.equal(closedHost.visible(source('text'), 'text'), false, 'React effect replay does not restore timing');
  assert.ok(closedHost.begin(originalAction)); closeHost();
  const freshHost = mountHost(), closeFreshHost = hostEffects[1]();
  assert.equal(closedHost.begin(originalAction), null, 'Reopening the same scope does not reactivate the old host');
  assert.equal(freshHost.visible(source('text'), 'text'), false); closeFreshHost();
  sourceCurrent = false;
  const unavailable = await reader.read({ taskId, usageLimit: 20 }, binding); assert.equal(unavailable.clientVisible.state, 'not_recorded');
  assert.equal(unavailable.measurements.firstToken, 'not_recorded'); assert.equal(unavailable.measurements.slo, 'not_evaluated');
  // The actual report Controller must consume raw request.body, even if a
  // hypothetical global DTO pass supplied a sanitized argument separately.
  const controllerExports = {}, controllerCode = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/api/src/modules/ai-native/task-center.application.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(controllerCode, { exports: controllerExports, AbortController, require(name) {
    if (name === '@nestjs/common') return Object.fromEntries(['Body', 'Controller', 'Header', 'HttpCode', 'Inject', 'Post', 'Req'].map(key => [key, () => () => {}]));
    if (name === '@rental-os/shared') return shared;
    if (name === 'node:crypto' || name === 'zod') return require(name);
    if (name === './task-contract-validation') return require('../apps/api/src/modules/ai-native/task-contract-validation.ts');
    if (name === './scenes/request-abort') return { withRequestAbort: (_request, fn) => fn(new AbortController().signal) };
    if (name === './scenes/original-scenes.controller') return { respondAiScene: fn => fn() };
    return {}; // Explicit non-executed dependencies of the transport host.
  } });
  const sanitized = [...logs.values()][0].detail.report;
  const controller = new controllerExports.AiTaskCenterController({ visibleReport: async (_request, value) => recordTaskVisibleObservation({ db, tasks, sourceBinding: binding }, value) });
  await assert.rejects(controller.visibleReport({ headers: {}, body: { ...sanitized, arbitraryUrl: 'https://not-recorded.invalid' } }, sanitized));
  assert.equal(logs.size, 2, 'Raw unknown fields are rejected instead of disappearing in DTO stripping');
  serverCurrent = false; await assert.rejects(recordTaskVisibleObservation({ db, tasks, sourceBinding: binding }, [...logs.values()][0].detail.report));
  assert.equal(logs.size, 2); cleanup?.(); session.dispose(); reopened.dispose();
});

// Reuse the existing React host style for the real task consumer and canonical
// HTTP adapter. Only React lifetimes, session and HTTP are synthetic; no server
// request, business mutation or model is run by these observations.
function taskObservationHost(component) {
  const slots = [], effects = [], cleaners = new Map(), calls = [], listeners = new Set();
  let cursor = 0, allowed = true, epoch = 1, session = new AbortController(), responder = async () => { throw Error('No response configured'); };
  const document = { hidden: false, addEventListener: (_name, fn) => listeners.add(fn), removeEventListener: (_name, fn) => listeners.delete(fn) };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, index) => !Object.is(value, slots[i][index]))) {
      slots[i] = deps; effects.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); }); } }
  };
  const stub = name => props => React.createElement(name, props), shared = require('../packages/shared/src/index');
  const sessionHost = { currentSessionEpoch: () => epoch, currentSessionSignal: () => session.signal };
  const loadModule = file => {
    const exports = {}, code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, document, AbortController, AbortSignal, require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
      if (name === '@rental-os/shared') return shared;
      if (name === '@/app/queryClient') return sessionHost;
      if (name === './http') return { http: { post: async (url, query, options) => {
        calls.push({ url, query: structuredClone(query), signal: options.signal }); return { data: { data: await responder(url, query) } }; } } };
      if (name === './aiRequestTiming') return { AI_EXECUTION_RESPONSE_TIMEOUT_MS: 120000 };
      if (name === '@/api/aiTaskCenter') return { aiTaskCenterApi: api };
      if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert') };
      if (name === './management-locale') return { useAiManagementLocale: () => ({ t: text => text }) };
      if (name === './formatters') return { formatTimestamp: value => ({ value }) };
      if (name === './safe-display') return { safeDisplayText: value => value };
      if (name === './usage-quantity') return loadModule('apps/admin/src/features/ai-native/usage-quantity.ts');
      if (name === './TaskOutcomeObservation') return { TaskOutcomeObservation: stub('task-outcomes') };
      throw Error('Unexpected observation dependency: ' + name);
    } }); return exports;
  };
  const api = loadModule('apps/admin/src/api/aiTaskCenter.ts').aiTaskCenterApi;
  const source = loadModule(`apps/admin/src/features/ai-native/${component}.tsx`);
  let denied = 0;
  const render = props => { cursor = 0; const tree = source[component]({ ...props, current: () => allowed, onAccessDenied: () => { denied++; } });
    effects.splice(0).forEach(effect => effect()); return tree; };
  return { source, api, calls, render, respond: fn => { responder = fn; }, deny: () => { allowed = false; }, denied: () => denied,
    hide: () => { document.hidden = true; listeners.forEach(fn => fn()); },
    rotate: () => { session.abort(); session = new AbortController(); epoch++; }, dispose: () => cleaners.forEach(fn => fn?.()) };
}
function observationNodes(tree) {
  const result = []; const walk = node => React.Children.toArray(node).forEach(child => {
    if (React.isValidElement(child)) { result.push(child); walk(child.props.children); }
  }); walk(tree); return result;
}
function observationAction(tree, label) { return observationNodes(tree).find(node => node.props.label === label).props.onAction; }
function observationText(tree) {
  const out = []; const walk = node => React.Children.toArray(node).forEach(child => {
    if (React.isValidElement(child)) walk(child.props.children); else out.push(String(child));
  }); walk(tree); return out.join(' ');
}
const originalCostSummary = taskId => ({ taskId, observedAt: '2026-11-09T12:00:00Z', invocationLimit: 50,
  consistency: 'revalidated_reads_not_atomic_snapshot', execution: 'read_only_no_dispatch_or_release',
  basis: 'persisted_budget_records_not_provider_invoice', absenceSemantics: 'no_record_is_not_proof_of_no_consumption',
  businessExecution: 'not_inferred_from_usage', admission: 'not_granted', state: 'observed', coverage: 'all_registered_invocations',
  invocationCount: 1, recordedCount: 1, notRecordedCount: 0, accountingComplete: false,
  groups: [{ unit: 'money', currency: 'USD', scale: 6, reservedAtoms: '0', pendingAtoms: '2500000', settledAtoms: '1234567',
    releasedReservationAtoms: '0', settledExcessAtoms: '0' }] });
function originalOutcomeSample(taskIds, status = 'succeeded') {
  const shared = require('../packages/shared/src/index'), size = taskIds.length;
  const counts = Object.fromEntries(shared.AI_TASK_STATUSES_DRAFT.map(key => [key, key === status ? size : 0]));
  const terminal = shared.AI_TASK_TERMINAL_STATUSES_DRAFT.includes(status) ? size : 0;
  return { version: 'task-outcome-sample-1', observedAt: '2026-11-09T12:00:00Z', sceneCode: 'order_explanation', sceneVersion: '1',
    taskIds, sampleSize: size, statusCounts: counts, successRate: { state: terminal === size ? 'recorded' : 'pending',
      succeeded: counts.succeeded, terminal, total: size, percent: terminal === size ? (100 * counts.succeeded / size).toFixed(2) : null },
    takeoverRate: { tasksWithReceipt: 0, total: size, percent: '0.00', basis: 'original_same_owner_takeover_receipts' },
    coverage: 'requested_authorized_one_owner_workspace_scene_version', consistency: 'revalidated_reads_not_atomic_snapshot',
    slo: 'not_evaluated', execution: 'read_only_no_lease_or_model' };
}

test('task observations consume original cost and explicit single-task samples through canonical HTTP', async () => {
  const cost = taskObservationHost('TaskUsageObservation'), props = { taskId: 'task-a' };
  cost.respond((_url, query) => originalCostSummary(query.taskId));
  let tree = cost.render(props); assert.equal(cost.calls.length, 0, 'Mounting never fetches');
  await observationAction(tree, '读取任务成本')(); tree = cost.render(props);
  assert.equal(cost.calls.length, 1); assert.ok(cost.calls[0].url.endsWith('/usage-summary'));
  assert.deepEqual(cost.calls[0].query, { taskId: 'task-a' });
  assert.match(observationText(tree), /1\.234567 USD/); assert.match(observationText(tree), /2\.500000 USD/);
  assert.match(observationText(tree), /账务记录尚未齐全/);
  assert.deepEqual(Array.from(observationNodes(tree).find(node => Array.isArray(node.props.taskIds)).props.taskIds), ['task-a']);
  const sample = taskObservationHost('TaskOutcomeObservation'), selection = { taskIds: ['task-a'] };
  sample.respond((_url, query) => originalOutcomeSample(query.taskIds));
  tree = sample.render(selection); assert.equal(sample.calls.length, 0);
  await observationAction(tree, '读取任务样本')(); tree = sample.render(selection);
  assert.ok(sample.calls[0].url.endsWith('/outcomes')); assert.deepEqual(sample.calls[0].query, { taskIds: ['task-a'] });
  assert.match(observationText(tree), /样本数.*1/); assert.match(observationText(tree), /不代表全租户成功率/);
  assert.match(observationText(tree), /100\.00%/); assert.match(observationText(tree), /真实 SLO 未评估/);
  cost.dispose(); sample.dispose();
});

test('task observations retract original facts across selection, hidden session and current read refusal', async () => {
  for (const component of ['TaskUsageObservation', 'TaskOutcomeObservation']) {
    const host = taskObservationHost(component), props = id => component === 'TaskUsageObservation' ? { taskId: id } : { taskIds: [id] };
    const label = component === 'TaskUsageObservation' ? '读取任务成本' : '读取任务样本';
    let resolve; host.respond(() => new Promise(done => { resolve = done; }));
    let tree = host.render(props('task-a')), read = observationAction(tree, label)();
    host.render(props('task-b'));
    resolve(component === 'TaskUsageObservation' ? originalCostSummary('task-a') : originalOutcomeSample(['task-a']));
    await read; tree = host.render(props('task-b'));
    assert.doesNotMatch(observationText(tree), /1\.234567|100\.00%/);
    host.respond((_url, query) => component === 'TaskUsageObservation' ? originalCostSummary(query.taskId) : originalOutcomeSample(query.taskIds));
    await observationAction(tree, label)(); host.rotate(); tree = host.render(props('task-b'));
    assert.doesNotMatch(observationText(tree), /1\.234567|100\.00%/);
    host.respond(() => { throw Object.assign(Error('Denied'), { response: { status: 403 } }); });
    await assert.rejects(observationAction(tree, label)()); assert.equal(host.denied(), 1);
    host.hide(); tree = host.render(props('task-b'));
    assert.doesNotMatch(observationText(tree), /1\.234567|100\.00%/);
    const before = host.calls.length; await assert.rejects(observationAction(tree, label)()); assert.equal(host.calls.length, before);
    host.dispose();
  }
});

test('task observations preserve pending rates, absent cost and closed shared summary/sample schemas', async () => {
  const host = taskObservationHost('TaskOutcomeObservation'); host.respond((_url, query) => originalOutcomeSample(query.taskIds, 'running'));
  let tree = host.render({ taskIds: ['task-a'] }); await observationAction(tree, '读取任务样本')(); tree = host.render({ taskIds: ['task-a'] });
  assert.match(observationText(tree), /尚未计算/); assert.match(observationText(tree), /任务尚未全部结束/);
  assert.throws(() => host.source.validateTaskOutcomeObservation(originalOutcomeSample(['task-other']), ['task-a']));
  const cost = taskObservationHost('TaskUsageObservation'), summary = originalCostSummary('task-a');
  assert.equal(cost.source.validateTaskUsageSummary(summary, 'task-a').accountingComplete, false);
  const limited = { ...summary, state: 'limit_exceeded', coverage: 'not_computed' };
  for (const key of ['invocationCount', 'recordedCount', 'notRecordedCount', 'accountingComplete', 'groups']) delete limited[key];
  assert.equal(cost.source.validateTaskUsageSummary(limited, 'task-a').state, 'limit_exceeded');
  assert.throws(() => cost.source.validateTaskUsageSummary({ ...summary, accountingComplete: true }, 'task-a'));
  const shared = require('../packages/shared/src/index'), h = require('./fixtures/ai-native/contract-consumer.cjs');
  const validators = h.validatorsFor({ AiTaskBudgetUsageSummaryDraft: shared.AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiTaskBudgetUsageSummaryDraft,
    AiTaskOutcomeSampleDraft: shared.AI_TASK_PERFORMANCE_SCHEMAS.AiTaskOutcomeSampleDraft }, {});
  assert.equal(validators.AiTaskBudgetUsageSummaryDraft(summary), true); assert.equal(validators.AiTaskOutcomeSampleDraft(originalOutcomeSample(['task-a'])), true);
  assert.equal(validators.AiTaskBudgetUsageSummaryDraft({ ...summary, credential: 'refused' }), false);
  assert.equal(validators.AiTaskOutcomeSampleDraft({ ...originalOutcomeSample(['task-a']), credential: 'refused' }), false);
  // Exercise the original Guard's registered route permission resolver only;
  // unrelated service constructors are not instantiated or treated as grants.
  const guard = {}, guardCode = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/api/src/common/api-auth.guard.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(guardCode, { exports: guard, require(name) {
    if (name === '@rental-os/shared') return shared;
    if (name === '@nestjs/common') return { Injectable: () => value => value, Optional: () => () => {} };
    if (name === './platform-ai-access-policy') return require('../apps/api/src/common/platform-ai-access-policy.ts');
    return {}; // Explicit inert service dependencies for this pure route resolver.
  } });
  for (const action of ['outcomes', 'usageSummary']) assert.deepEqual(Array.from(guard.requiredPermissions('POST',
    `/${shared.AI_TASK_CENTER_HTTP_DRAFT.basePath}/${shared.AI_TASK_CENTER_HTTP_DRAFT[action]}`)), Array.from(shared.AI_TASK_CENTER_ENTRY_PERMISSIONS));
  cost.dispose(); host.dispose();
});

function originalRuntimeObservation(taskId) {
  const time = '2026-11-09T12:01:00Z';
  return { version: 'task-performance-1', observedAt: time,
    task: { taskId, sceneCode: 'order_explanation', sceneVersion: '1', status: 'succeeded', revision: 2,
      createdAt: '2026-11-09T12:00:00Z', lastChangedAt: time, cancelRequestedAt: '2026-11-09T12:00:30Z' },
    timing: { ageMs: '60000', firstRecordedStartAt: '2026-11-09T12:00:00Z', terminalEndedAt: time, endToEndMs: '60000' },
    resources: { state: 'recorded', revision: 2, policyVersion: 'resource-1', counters: [
      { resource: 'steps', limit: '10', consumed: '1', reservedAndUnknown: '0', remaining: '9', exhausted: false },
      { resource: 'calls', limit: '10', consumed: '1', reservedAndUnknown: '0', remaining: '9', exhausted: false },
      { resource: 'active_ms', limit: '100', consumed: '5', reservedAndUnknown: '7', remaining: '88', exhausted: false },
      { resource: 'output_bytes', limit: '1000', consumed: '0', reservedAndUnknown: '0', remaining: '1000', exhausted: false }] },
    runs: { items: [{ runId: 'run-a', sequence: 1, status: 'succeeded', startedAt: '2026-11-09T12:00:00Z', endedAt: time,
      elapsedMs: '60000' }], truncated: false, coverage: 'bounded_window' },
    steps: { items: [{ stepId: 'step-a', runId: 'run-a', sequence: 1, toolCode: 'original-read', toolVersion: '1',
      status: 'succeeded', effect: 'none', revision: 2, activeTime: { state: 'recorded', recordedMs: '5', reservedMs: '0',
        unknownMs: '7', basis: 'persistent_resource_not_provider_latency' } }], truncated: false, coverage: 'bounded_window' },
    financial: { taskId, items: [{ invocationId: 'invoke-a', callId: 'call-a', accounting: 'not_recorded' }], nextAfter: null,
      observedAt: time, coverage: 'page_not_total', totals: 'not_computed', consistency: 'revalidated_reads_not_atomic_snapshot',
      absenceSemantics: 'no_record_is_not_proof_of_no_consumption', businessExecution: 'not_inferred_from_usage', admission: 'not_granted' },
    modelDelivery: { items: [{ invocationId: 'invoke-a', runId: 'run-a', stepId: 'step-a', callId: 'call-a', mode: 'stream',
      transportWallMs: '50', firstValidatedTextMs: '10', basis: 'gateway_transport_including_usage_and_consumer_wait' }],
      unobservedInWindow: 0, truncated: false, coverage: 'completed_gateway_observations_only' },
    budgetAdmission: { denials: [{ invocationId: 'invoke-a', runId: 'run-a', stepId: 'step-a', callId: 'call-a',
      observedAt: time, code: 'budget_unavailable', observation: 'gate_rejected_not_release_evidence' }], truncated: false,
      coverage: 'recorded_rejections_only' },
    measurements: { firstToken: 'not_recorded', firstCard: 'not_recorded', toolLatency: 'resource_active_time_only',
      modelLatency: 'gateway_transport_wall_time_only', rates: 'not_computed', slo: 'not_evaluated' },
    consistency: 'revalidated_reads_not_atomic_snapshot', execution: 'read_only_no_dispatch_or_release' };
}

test('task runtime observation consumes original clocks and bounded records through the standard reader contract', async () => {
  const host = taskObservationHost('TaskUsageObservation'), props = { taskId: 'task-a' };
  host.respond((_url, query) => originalRuntimeObservation(query.taskId));
  let tree = host.render(props); assert.equal(host.calls.length, 0);
  await observationAction(tree, '读取运行观察')(); tree = host.render(props);
  assert.equal(host.calls.length, 1); assert.ok(host.calls[0].url.endsWith('/performance'));
  assert.deepEqual(host.calls[0].query, { taskId: 'task-a', usageLimit: 20 });
  const text = observationText(tree);
  assert.match(text, /任务完整耗时.*60000 ms/); assert.match(text, /模型调用窗口.*50 ms/);
  assert.match(text, /已记录耗时.*5 ms/); assert.match(text, /待核对耗时.*7 ms/);
  assert.match(text, /预算拒绝记录.*1/); assert.match(text, /取消请求不证明已回滚或退额/);
  assert.match(text, /首字、首卡尚未记录/); assert.match(text, /真实 SLO 未评估/);
  const validation = require('../apps/api/src/modules/ai-native/task-contract-validation.ts');
  assert.equal(validation.validateAiTaskObservation('AiTaskPerformanceObservationDraft', originalRuntimeObservation('task-a')).task.taskId, 'task-a');
  assert.throws(() => validation.validateAiTaskObservation('AiTaskPerformanceObservationDraft', { ...originalRuntimeObservation('task-a'), credential: 'refused' }));
  assert.throws(() => host.source.validateTaskRuntimeObservation(originalRuntimeObservation('other-task'), 'task-a'));
  const shared = require('../packages/shared/src/index'), guard = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'apps/api/src/common/api-auth.guard.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText,
  { exports: guard, require(name) {
    if (name === '@rental-os/shared') return shared;
    if (name === '@nestjs/common') return { Injectable: () => value => value, Optional: () => () => {} };
    if (name === './platform-ai-access-policy') return require('../apps/api/src/common/platform-ai-access-policy.ts');
    return {}; // Pure original route resolver; no service construction or execution grant.
  } });
  assert.deepEqual(Array.from(guard.requiredPermissions('POST', `/${shared.AI_TASK_CENTER_HTTP_DRAFT.basePath}/${shared.AI_TASK_CENTER_HTTP_DRAFT.performance}`)),
    Array.from(shared.AI_TASK_CENTER_ENTRY_PERMISSIONS));
  host.dispose();
});

test('task runtime observation preserves missing completion and withdraws old session or hidden results', async () => {
  const host = taskObservationHost('TaskUsageObservation'), props = { taskId: 'task-a' };
  host.respond((_url, query) => { const result = originalRuntimeObservation(query.taskId);
    result.task.status = 'running'; result.timing.endToEndMs = null; result.timing.terminalEndedAt = null;
    result.runs.items[0].status = 'running'; result.runs.items[0].endedAt = null; result.runs.items[0].elapsedMs = null;
    return result; });
  let tree = host.render(props); await observationAction(tree, '读取运行观察')(); tree = host.render(props);
  assert.match(observationText(tree), /任务完整耗时.*尚未核实/);
  host.rotate(); tree = host.render(props); assert.doesNotMatch(observationText(tree), /模型调用窗口/);
  let resolve; host.respond(() => new Promise(done => { resolve = done; }));
  const read = observationAction(tree, '读取运行观察')(); host.hide(); resolve(originalRuntimeObservation('task-a')); await read;
  tree = host.render(props); assert.doesNotMatch(observationText(tree), /60000 ms|模型调用窗口/);
  const before = host.calls.length; await assert.rejects(observationAction(tree, '读取运行观察')()); assert.equal(host.calls.length, before);
  host.dispose();
});

test('conversation Core quote confirms original human parameters once and recovers the saved quote after reply loss', { timeout: 90000 }, async () => {
  const shared = require('@rental-os/shared'), { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const candidate = { customerType: 'personal', customerId: 'customer-a', bookingIdentity: { bookingIdentity: 'personal' },
    fulfillmentMode: 'store_pickup_return', start: '2027-02-01T00:00:00.000Z', end: '2027-02-02T00:00:00.000Z' };
  const quotes = [];
  const h = await originalModelApplicationHarness('quote_clarification', undefined, candidate, [], async b => {
    const groups = b.core.listItemGroups('tenant_001').filter(row => row.status === 'enabled').slice(0, 2);
    candidate.items = groups.map((group, index) => ({ itemGroupId: group.id, quantity: index + 1 })); candidate.locationId = b.location.id;
    b.facts.listAssets = async () => groups.flatMap((group, row) => [1, 2, 3].map(index => ({ id: `quote-consumer-asset-${row}-${index}`,
      tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: group.id, locationId: b.location.id, status: 'available' })));
    b.facts.listStockBalances = async () => groups.map(group => ({ itemGroupId: group.id, locationId: b.location.id, onHandQuantity: 10, maintenanceQuantity: 0 }));
    b.businessFacts.findQuoteForOriginalOperation = async (tenantId, proof) => {
      const row = quotes.find(row => row.quote.tenantId === tenantId && row.key === proof.key);
      if (row && row.inputHash !== proof.inputHash) throw Error('Original input changed'); return row && structuredClone(row.quote);
    };
    b.businessFacts.findQuoteForOriginalReference = async (tenantId, key) => structuredClone(quotes.find(row => row.quote.tenantId === tenantId && row.key === key)?.quote);
    b.businessFacts.saveQuoteForOriginalOperation = async (quote, proof) => {
      const stored = await b.businessFacts.findQuoteForOriginalOperation(quote.tenantId, proof); if (stored) return stored;
      quotes.push({ ...proof, quote: structuredClone(quote) }); return structuredClone(quote);
    };
  }, { maxSteps: 8, maxCalls: 8 });
  const app = h.model.createApplication({ holderId: 'quote-consumer', leaseMs: 100000 }, { ...h.run, inputSource: 'original_scene' });
  assert.equal((await app.start(h.reference)).execution.outcome.status, 'paused');
  let query, preparation;
  for (let round = 0; round < 6; round++) {
    const input = await app.readInput(h.reference);
    assert.ok(input, JSON.stringify({ round, modelCalls: h.execution.sent.length, previousPreparation: preparation?.preparation?.status,
      taskStatus: h.state.aiTask[0].status, failures: h.state.failures }));
    const submission = { draftVersion: shared.AI_TASK_INPUT_DRAFT_VERSION, taskId: h.created.task.taskId, requestId: input.requestId,
      expectedRevision: input.revision, submissionKey: `quote-consumer-${round}`, answers: input.contract.fields.map(field => ({ fieldId: field.fieldId,
        value: field.kind === 'choice' ? field.options[0].value : field.kind === 'integer' ? 1
          : field.fieldId === 'starts_at' ? candidate.start : field.fieldId === 'ends_at' ? candidate.end : 'Human parameters only' })) };
    await app.submitAnswer({ original: h.reference, submission });
    query = { original: h.reference, reference: { taskId: submission.taskId, requestId: submission.requestId,
      expectedRevision: submission.expectedRevision, submissionKey: submission.submissionKey } };
    preparation = await app.readQuotePreparation(query);
    if (preparation.preparation.status === 'ready') break;
    await app.continueAnswer(query);
  }
  assert.equal(preparation.preparation.status, 'ready'); assert.equal(quotes.length, 0);
  // HTTP JSON omits undefined producer properties; the browser receives the
  // wire projection, not the in-process object's additional undefined keys.
  preparation = JSON.parse(JSON.stringify(preparation));
  if (process.env.AI_OFFLINE_WRITE_ROOT) fs.writeFileSync(path.join(process.env.AI_OFFLINE_WRITE_ROOT, 'synthetic-quote-preparation.json'), JSON.stringify(preparation));
  assert.ok(shared.validateAiSceneQuoteHttpResponse('AiSceneModelQuotePreparationResponseDraft', preparation), JSON.stringify({
    preparation: shared.validateAiSceneQuoteHttpResponse('AiSceneQuotePreparationDraft', preparation.preparation),
    sources: shared.validateAiSceneQuoteHttpResponse('AiSceneQuoteInputSourcesDraft', preparation.sources) }));
  const { AiOriginalSceneModelActionsController } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  const controller = new AiOriginalSceneModelActionsController({ readQuotePreparation: (_r, q) => app.readQuotePreparation(q),
    confirmClarifiedQuote: (_r, q) => app.confirmClarifiedQuote(q), readClarifiedQuoteReceipt: (_r, q) => app.readClarifiedQuoteReceipt(q) });
  const turn = { admissionKey: 'quote-admission', turnId: 'quote-turn', originalRequestKey: h.created.receipt.requestKey, requestHash: 'a'.repeat(64),
    capabilityCode: 'quote_clarification', capabilityVersion: h.created.receipt.sceneVersion, createdAt: h.created.receipt.createdAt, automaticRetry: false,
    status: 'original_bound', execution: 'not_inferred_from_association', material: 'retained', original: h.reference,
    task: { taskId: h.created.task.taskId, runId: h.created.task.runId } };
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let current = true, selected = { reference: query.reference, receiptId: preparation.receipt.receiptId }, alter = null, writes = 0, reads = 0;
  const consumerShared = process.env.AI_CONSUMER_SHARED_PACKAGE ? require(process.env.AI_CONSUMER_SHARED_PACKAGE) : shared;
  const api = loadLifecycleSession('../../api/aiConversations.ts', {
    '@rental-os/shared': consumerShared,
    '@/app/queryClient': { currentSessionEpoch: () => 1, currentSessionSignal: () => new AbortController().signal },
    '@/features/ai-native/conversation-history-reader': {}, './aiTaskCenter': {}, './http': { http: { post: async (url, command) => {
      if (url.endsWith('/admission')) return { data: { data: { ...command, result: turn, absence: 'not_proof_of_no_commit', retryable: false } } };
      assert.equal('submission' in command, false, 'no answer payload is replayed');
      if (url.endsWith('/input/quote-preparation')) { reads++; const packet = JSON.parse(JSON.stringify(await controller.readQuotePreparation({}, command))); alter?.(packet); return { data: { data: packet } }; }
      if (url.endsWith('/input/quote-receipt')) return { data: { data: JSON.parse(JSON.stringify(await controller.readClarifiedQuoteReceipt({}, command))) } };
      assert.ok(url.endsWith('/input/quote-confirm')); assert.ok(values.has('quote-journal')); writes++;
      await controller.confirmClarifiedQuote({}, command); throw Error('Lost quote response');
    } } }
  }).aiConversationsApi;
  const imports = { '@rental-os/shared': consumerShared, './budget-settings-session': loadLifecycleSession('budget-settings-session.ts') };
  const { ConversationQuoteConfirmationSession: Session } = loadLifecycleSession('conversation-quote-confirmation-session.ts', imports);
  const create = () => new Session('conversation-a', turn, api, () => current, () => selected, storage, 'quote-journal');
  const session = create(); await assert.rejects(session.confirm(), /AI_RESULT_UNKNOWN/); assert.equal(reads, 0);
  await session.inspect(); assert.equal(session.snapshot().ready, true); assert.equal(writes, 0);
  alter = value => { value.preparation.configVersion += '-changed'; value.preparation.review.configVersion += '-changed'; };
  await assert.rejects(session.confirm(), /AI_REVISION_CONFLICT/); assert.equal(writes, 0); alter = null;
  await session.inspect(); selected = { ...selected, receiptId: 'foreign-receipt' };
  await assert.rejects(session.confirm(), /AI_REVISION_CONFLICT/); assert.equal(writes, 0); selected.receiptId = preparation.receipt.receiptId;
  await session.inspect(); await assert.rejects(session.confirm(), /Lost quote response/); assert.equal(writes, 1); assert.equal(quotes.length, 1);
  assert.equal(session.snapshot().locked, true); assert.equal(values.get('quote-journal').includes('Human parameters'), false);
  const reopened = create(), before = h.execution.sent.length, oldReads = reads; await reopened.reconcile();
  assert.equal(reopened.snapshot().result.quote.id, quotes[0].quote.id); assert.equal(reads, oldReads); assert.equal(writes, 1);
  assert.equal(h.execution.sent.length, before); assert.equal(h.state.rentalOrder.length, 0); assert.equal(h.state.aiApproval.length, 0);
  await assert.rejects(reopened.confirm(), /AI_RESULT_UNKNOWN/); current = false;
  await assert.rejects(reopened.reconcile(), /AI_SCOPE_CHANGED/);
  assert.equal(shared.validateAiSceneQuoteHttpResponse('AiSceneModelQuotePreparationResponseDraft', preparation), true);
  const malformed = structuredClone(preparation); malformed.sources.fields[0].confirmed = true;
  assert.equal(shared.validateAiSceneQuoteHttpResponse('AiSceneModelQuotePreparationResponseDraft', malformed), false);
  assert.equal(shared.validateAiSceneQuoteHttpResponse('AiSceneModelQuotePreparationResponseDraft', { receipt: { state: 'not_observed', retryable: false }, preparation: 'unavailable' }), true);
  session.dispose(); reopened.dispose();
});

test('original selection material shares the human approval display without dropping customer fulfillment or services', () => {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-native/TaskHumanApproval.tsx'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}, stub = props => React.createElement('section', props);
  vm.runInNewContext(output, { exports, require(name) {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '@rental-os/shared') return require('@rental-os/shared');
    if (name === '@/api/aiTaskCenter') return { aiTaskCenterApi: {} };
    if (name === '@/components/ui') return { ActionButton: stub, Alert: stub, ConfirmAction: stub, Select: stub };
    if (name === './management-locale') return { useAiManagementLocale: () => ({ t: value => value }) };
    if (name === './safe-display') return { safeDisplayText: value => value ?? '' };
    if (name === './formatters') return { formatAmount: value => ({ value: String(value) }), formatTimestamp: value => ({ value }) };
    throw Error(name);
  } });
  const order = { customer: { id: 'customer-a', type: 'personal', name: 'Core person' },
    booking: { identity: 'personal', enterpriseContractAndPayer: false },
    lines: [{ itemGroupId: 'camera-a', name: 'Core camera', quantity: 2, pricingUnit: 'day_24h' }],
    period: { startAt: '2027-02-01T00:00:00Z', endAt: '2027-02-02T00:00:00Z', timeZone: 'Asia/Shanghai' },
    fulfillment: { mode: 'delivery', pickupLocationId: 'pickup-a', returnLocationId: 'return-a',
      deliveryAddress: { recipient: 'Original recipient', countryCode: 'CN', province: 'Original province', city: 'Original city', detail: 'Original address' } },
    services: [{ serviceId: 'service-a', name: 'Original service', quantity: 1, startAt: '2027-02-01T00:00:00Z',
      endAt: '2027-02-02T00:00:00Z', locationId: 'service-location', requiredByRule: true }] };
  const html = require('react-dom/server').renderToStaticMarkup(React.createElement(exports.TaskOrderMaterialDetails, { order }));
  for (const original of ['Core person', 'customer-a', 'Core camera', 'camera-a', 'Asia/Shanghai', 'pickup-a', 'return-a',
    'Original recipient', 'Original address', 'Original service', 'service-location', '2027-02-02T00:00:00Z']) assert.ok(html.includes(original), original);
  assert.match(html, /业务规则要求/);
});

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

test('actual platform capability consumer rejects legacy/private replies and retracts on disconnect, identity and hide', async () => {
  const file = path.join(root, 'apps/admin/src/features/ai-native/PlatformCapabilityObservation.tsx');
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], pending = [], cleaners = new Map(); let cursor = 0, calls = [], responder, epoch = 1;
  let user = { id: 'platform-owner', isSaasAdmin: true }, token = 'synthetic', permitted = true, sessionAbort = new AbortController();
  const subscribers = new Set(), events = new Map();
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo(factory, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i].deps[j]))) slots[i] = { value: factory(), deps }; return slots[i].value; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i][j]))) {
      slots[i] = deps; pending.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } }
  };
  const document = { hidden: false, addEventListener: (key, value) => events.set(key, value), removeEventListener: key => events.delete(key) };
  const store = { getState: () => ({ user, token, hasPermission: () => permitted }),
    subscribe: listener => { subscribers.add(listener); return () => subscribers.delete(listener); } };
  const stub = name => props => React.createElement(name, props), exports = {};
  const apiExports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'apps/admin/src/api/platformAiSettings.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: apiExports, AbortSignal, require(name) {
      if (name === '@rental-os/shared') return require('@rental-os/shared');
      if (name === '@/app/queryClient') return { currentSessionSignal: () => sessionAbort.signal };
      if (name === './http') return { request: () => { throw Error('no platform writes or other operations'); }, http: {
        get: async (url, options) => {
          assert.match(url, /^\/platform\/ai\/providers\/profile-[ab]\/capabilities$/u);
          assert.equal(options.headers['Cache-Control'], 'no-store');
          const profileId = url.split('/').at(-2); calls.push({ profileId, signal: options.signal });
          return { data: { data: await responder(profileId, options.signal) } };
        }
      } };
      throw Error(name);
    } });
  const formatTimestamp = loadLifecycleSession('formatters.ts').formatTimestamp;
  vm.runInNewContext(output, { exports, document, AbortController, structuredClone, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@/api/platformAiSettings') return apiExports;
    if (name === '@/app/locale') return { useLocale: () => ({ t: value => value }) };
    if (name === '@/app/queryClient') return { currentSessionEpoch: () => epoch, currentSessionSignal: () => sessionAbort.signal };
    if (name === '@/features/auth/authStore') return { useAuthStore: store };
    if (name === '@/components/ui') return { ActionButton: stub('action'), Alert: stub('alert') };
    if (name === './formatters') return { formatTimestamp };
    throw Error(name);
  } });
  const identity = () => JSON.stringify([user, epoch]);
  const nodes = tree => { const found = []; const visit = node => React.Children.toArray(node).forEach(child => {
    if (React.isValidElement(child)) { found.push(child); visit(child.props.children); }
  }); visit(tree); return found; };
  const render = (profileId = 'profile-a', owner = identity(), commit = true) => {
    cursor = 0; const tree = exports.PlatformCapabilityObservation({ profileId, identity: owner });
    if (commit) pending.splice(0).forEach(effect => effect()); return tree;
  };
  const read = tree => nodes(tree).find(node => node.props.label === '读取平台能力证据').props.onAction;
  const observation = (profileId = 'profile-a') => ({ profileId, configurationRevision: 1, enabled: true,
    observedAt: '2026-11-04T00:00:00Z', execution: 'read_only_no_probe_or_dispatch', admission: 'not_granted',
    items: ['text', 'streaming', 'tools', 'structured_output', 'vision', 'audio', 'embedding', 'reasoning']
      .map(capability => ({ capability, allowed: false, readiness: 'unverified', recorded: null })) });
  const visible = tree => nodes(tree).some(node => node.props.role === 'status');
  let tree = render(); assert.equal(calls.length, 0);
  responder = async id => observation(id); await read(tree)(); tree = render(); assert.equal(visible(tree), true);
  for (const patch of [value => ({ ...value, draftVersion: 'old-v0' }), value => ({ ...value, privateNote: 'secret' }),
    value => ({ ...value, items: value.items.map((item, i) => i ? item : { ...item, credential: 'secret' }) }),
    value => ({ ...value, items: new Array(8) }),
    value => ({ ...value, profileId: 'foreign-profile' })]) {
    responder = async () => patch(observation()); await assert.rejects(read(tree)()); tree = render(); assert.equal(visible(tree), false);
  }
  responder = async () => { throw Object.assign(Error('offline transport'), { code: 'ERR_NETWORK' }); };
  await assert.rejects(read(tree)()); tree = render(); assert.equal(visible(tree), false);
  responder = async id => observation(id); await read(tree)(); tree = render(); assert.equal(visible(tree), true);
  assert.equal(visible(render('profile-b', identity(), false)), false, 'new profile first paint has no old evidence');
  tree = render('profile-b'); tree = render('profile-a'); assert.equal(visible(tree), false, 'return does not resurrect old observation');
  await read(tree)(); tree = render(); permitted = false; subscribers.forEach(listener => listener());
  tree = render(); assert.equal(visible(tree), false); const beforeDenied = calls.length;
  await assert.rejects(read(tree)()); assert.equal(calls.length, beforeDenied); permitted = true;
  await read(render())(); tree = render();
  document.hidden = true; events.get('visibilitychange')?.(); tree = render(); assert.equal(visible(tree), false);
  document.hidden = false; events.get('visibilitychange')?.(); tree = render(); assert.equal(visible(tree), false, 'show never restores or rereads');
  let resolve; responder = () => new Promise(done => { resolve = done; });
  const late = read(tree)(); document.hidden = true; events.get('visibilitychange')?.();
  assert.equal(calls.at(-1).signal.aborted, true); document.hidden = false; resolve(observation()); await late;
  tree = render(); assert.equal(visible(tree), false, 'late hidden response cannot return after show');
  responder = async id => observation(id); await read(tree)(); tree = render();
  sessionAbort.abort(); sessionAbort = new AbortController(); epoch++; user = { ...user, id: 'other-platform-owner' };
  assert.equal(visible(render('profile-a', identity(), false)), false); tree = render();
  const old = read(tree); cleaners.forEach(cleanup => cleanup?.()); const beforeUnmount = calls.length;
  await assert.rejects(old()); assert.equal(calls.length, beforeUnmount);
});

test('conversation navigation keeps the original locator and rejects changed scope, session or contract', () => {
  const { readConversationNavigation: read } = loadLifecycleSession('conversation-navigation.ts');
  const shared = require('../packages/shared/src/index');
  const selection = { draftVersion: shared.AI_CONVERSATION_DRAFT_VERSION, conversationId: 'original-conversation',
    capabilityCode: 'order_explanation', identity: 'owner-space-a', sessionEpoch: 4 };
  assert.equal(JSON.stringify(read(selection, selection.identity, 4)), JSON.stringify(selection));
  assert.equal(read(selection, 'owner-space-b', 4), null);
  assert.equal(read(selection, selection.identity, 5), null);
  for (const patch of [{ draftVersion: 'unknown' }, { capabilityCode: 'unregistered' }, { conversationId: '../other' }, { url: '/anywhere' }]) {
    assert.equal(read({ ...selection, ...patch }, selection.identity, 4), null);
  }
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
  const originalDetail = nodes(tree).find(node => node.props.conversationId === 'conversation-1' && node.props.capabilityCode === 'order_explanation');
  assert.equal(calls.length, 1, 'selection alone does not fetch turns');
  await action(tree, '下一页').props.onAction(); tree = render();
  assert.equal(originalDetail.props.current(), false, 'pagination retracts the old selected conversation');
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

test('actual operator workspace keeps server records explicit and retracts on close, selection, scope and hide', () => {
  const source = fs.readFileSync(path.join(root, 'apps/admin/src/features/ai-operator/AiOperatorPage.tsx'), 'utf8');
  assert.match(source, /<WorkArea visible=\{workOpen\}/u);
  assert.match(source, /<WorkArea visible=\{mobileOpen\}/u);
  const output = ts.transpileModule(`${source}\nexport { WorkArea };`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const slots = [], pending = [], cleaners = new Map(); let cursor = 0, epoch = 1, permitted = true;
  const events = new Map(), document = { hidden: false, addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name) };
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => !Object.is(value, slots[i][j]))) {
      slots[i] = deps; pending.push(() => { cleaners.get(i)?.(); cleaners.set(i, effect()); });
    } },
  };
  let auth = { token: 'synthetic', tenant: { tenantId: 'tenant-a' }, currentWorkspaceId: 'space-a',
    user: { id: 'owner-a', isSaasAdmin: false }, hasPermission: () => permitted };
  const useAuthStore = () => auth; useAuthStore.getState = () => auth;
  const operator = { active: { id: 'local-a', artifact: { title: '演示', summary: '示例', columns: [], rows: [], note: '示例', kind: 'list' } },
    capability: { id: 'orders', action: '确认示例' }, enabled: true };
  const stub = name => props => React.createElement(name, props), exports = {};
  vm.runInNewContext(output, { exports, document, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (name === '@rental-os/shared') return { AI_TASK_CENTER_ENTRY_PERMISSIONS: ['ai:use'] };
    if (name === '@/features/auth/authStore') return { useAuthStore };
    if (name === './OperatorContext') return { useOperator: () => operator };
    if (name === '@/app/queryClient') return { currentSessionEpoch: () => epoch };
    if (name === '@/app/locale') return { useLocale: () => ({ locale: 'zh-CN' }) };
    if (name === '@/features/ai-native/ConversationHistory') return { ConversationHistory: stub('server-history') };
    if (name === '@/features/ai-native/ServerConversationPanel') return { ServerConversationPanel: stub('server-panel') };
    if (name === '@/features/ai-native/conversation-navigation' || name === 'react-router-dom') return {};
    if (name === '@/components/ui') return { Button: stub('button'), Modal: stub('modal') };
    if (name === '@/components/ui/AnimatedIcon') return { AnimatedIcon: stub('icon') };
    if (name === '@/components/workspace/ContentTransition') return { ContentTransition: stub('transition') };
    if (name === './confirmationDetails') return { confirmationDetails: () => ({ description: '示例确认', facts: [] }) };
    if (name === 'lucide-react') return Object.fromEntries(['Copy', 'Download', 'ShieldCheck'].map(key => [key, stub(key)]));
    if (name.endsWith('.css') || ['@/api/aiModelSettings', '@/features/ai-native/model-settings-session',
      '@/components/ui/ArcLocale', './archive/ai-chat/AiChat', './archive/agent-run/AgentRun', './archive/shared/BrandMark',
      './demo-response', '@/registry/components/resizable-panels/resizable-panels', '@/registry/components/card/card',
      './capabilities', '@/app/branding'].includes(name)) return {};
    throw Error(`unexpected import: ${name}`);
  } });
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => {
    if (React.isValidElement(child)) { out.push(child); walk(child.props.children); }
  }); walk(tree); return out; };
  const render = (visible = true, commit = true) => { cursor = 0; const tree = exports.WorkArea({ visible });
    if (commit) pending.splice(0).forEach(effect => effect()); return tree; };
  const toggle = tree => nodes(tree).find(node => typeof node.props['aria-pressed'] === 'boolean');
  const history = tree => nodes(tree).find(node => node.props.identity);
  const open = () => { toggle(render()).props.onClick(); return render(); };
  assert.equal(history(render()), undefined, 'mount never opens or fetches server history');
  let tree = open(), original = history(tree);
  assert.equal(original.props.current(), true); const journalIdentity = original.props.identity;
  assert.equal(nodes(tree).some(node => node.props.icon), false, 'demo copy/download footer is not shown over original records');
  assert.equal(nodes(tree).find(node => node.props.className === 'operator-confirmation').props.open, false);
  toggle(tree).props.onClick(); assert.equal(original.props.current(), false, 'close invalidates retained callbacks immediately');
  tree = render(); assert.equal(history(tree), undefined);
  tree = open(); assert.equal(original.props.current(), false, 'reopening the same owner does not reactivate callbacks from a closed mount');
  toggle(tree).props.onClick(); render();
  original = history(open()); render(false); assert.equal(original.props.current(), false);
  render(true); assert.equal(history(render()), undefined, 'expanding is not reopening or rereading');
  for (const change of [() => { operator.active = { ...operator.active, id: 'local-b' }; },
    () => { operator.capability = { ...operator.capability, id: 'brief' }; },
    () => { auth = { ...auth, currentWorkspaceId: 'space-b' }; },
    () => { auth = { ...auth, user: { ...auth.user, id: 'owner-b' } }; }, () => { epoch++; }]) {
    original = history(open()); change(); assert.equal(history(render(true, false)), undefined, 'changed owner first paint has no records');
    assert.equal(original.props.current(), false); render(); assert.equal(history(render()), undefined);
  }
  original = history(open()); permitted = false; assert.equal(original.props.current(), false);
  render(); permitted = true; render(); assert.equal(history(render()), undefined, 'permission recovery never restores the panel');
  original = history(open()); document.hidden = true; events.get('visibilitychange')();
  assert.equal(original.props.current(), false); document.hidden = false; render(); assert.equal(history(render()), undefined);
  auth = { ...auth, currentWorkspaceId: 'space-a', user: { ...auth.user, id: 'owner-a' } }; render();
  original = history(open()); assert.equal(original.props.identity, journalIdentity, 'original operation journal is not rotated per panel');
  cleaners.forEach(cleanup => cleanup?.()); assert.equal(original.props.current(), false, 'unmount closes stale callbacks');
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
    if (name === './ConversationOrderExecution') return { ConversationOrderExecution: stub('conversation-order-execution') };
    if (name === './ConversationOpeningExecution') return { ConversationOpeningExecution: stub('conversation-opening-execution') };
    if (name === './ConversationQuoteExecution') return { ConversationQuoteExecution: stub('conversation-quote-execution') };
    if (name === './formatters') return { formatTimestamp: time => ({ value: time }) };
    if (name === './safe-display') return { safeDisplayText: text => text };
    if (name.endsWith('.css')) return { default: {} };
    throw Error(name);
  } });
  const render = (conversationId = 'conversation-a') => {
    cursor = 0; const tree = exports.ConversationDetail({ conversationId, identity: 'owner-a', capabilityCode: 'order_explanation', current: () => current });
    effects.splice(0).forEach(effect => effect()); return tree;
  };
  const nodes = tree => { const out = []; const walk = node => React.Children.toArray(node).forEach(child => {
    if (React.isValidElement(child)) { out.push(child); walk(child.props.children); }
  }); walk(tree); return out; };
  const action = (tree, label) => nodes(tree).find(node => node.props.label === label);
  const result = query => ({ conversation: { conversationId: query.conversationId, revision: 1, currentTurn: null },
    turns: { items: [
      { turnId: 'turn-a', capabilityCode: 'order_explanation', original: { inputRef: 'input-a' }, material: 'erased',
        task: { taskId: 'task-a', runId: 'run-a' }, createdAt: '2026-11-03T00:00:00Z' },
      { turnId: 'turn-b', capabilityCode: 'order_explanation', original: { inputRef: 'input-b' }, material: 'retained',
        task: { taskId: 'task-b', runId: 'run-b' }, createdAt: '2026-11-03T00:00:00Z' },
      { turnId: 'turn-c', capabilityCode: 'order_explanation', original: { inputRef: 'input-c' }, material: 'retained',
        task: null, createdAt: '2026-11-03T00:00:00Z' },
      { turnId: 'turn-d', capabilityCode: 'opening_diagnosis', original: { inputRef: 'input-d' }, material: 'retained',
        task: { taskId: 'task-d', runId: 'run-d' }, createdAt: '2026-11-03T00:00:00Z' },
      { turnId: 'turn-e', capabilityCode: 'order_explanation', original: { inputRef: 'input-e' }, material: 'retained', creation: 'closed',
        task: { taskId: 'task-e', runId: 'run-e' }, createdAt: '2026-11-03T00:00:00Z' },
    ], nextBeforeId: 'turn-a' } });
  responder = async query => result(query);
  let tree = render(); tree = render(); assert.equal(calls.length, 0);
  await action(tree, '读取原轮次').props.onAction(); tree = render();
  assert.equal(calls.length, 1); assert.ok(nodes(tree).some(node => node.type === 'time'));
  const executions = nodes(tree).filter(node => node.props.identity === 'owner-a' && node.props.turn?.task);
  const execution = executions.find(node => node.props.turn.capabilityCode === 'order_explanation');
  const opening = executions.find(node => node.props.turn.capabilityCode === 'opening_diagnosis');
  assert.equal(executions.length, 1, 'only retained original tasks in the current conversation capability expose preparation');
  assert.equal(opening, undefined, 'foreign-capability metadata cannot supply an execution control');
  assert.ok(execution); assert.equal(execution.props.identity, 'owner-a'); assert.equal(execution.props.conversationId, 'conversation-a');
  assert.equal(execution.props.turn.task.taskId, 'task-b'); assert.equal(execution.props.turn.task.runId, 'run-b');
  assert.equal(execution.props.current(), true); assert.equal(calls.length, 1, 'rendering the original execution does not send a request');
  const text = nodes(tree).flatMap(node => React.Children.toArray(node.props.children).filter(child => typeof child === 'string')).join(' ');
  assert.match(text, /原输入已清理/); assert.match(text, /执行结果另行读取/);
  await action(tree, '更早轮次').props.onAction(); tree = render(); assert.equal(calls[1].query.beforeId, 'turn-a');
  const old = action(tree, '重读轮次首页').props.onAction;
  render('conversation-b'); tree = render('conversation-b');
  assert.equal(execution.props.current(), false, 'old execution cannot use the newly selected conversation');
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

for (const capability of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) test(`actual ${capability} admission distinguishes unsent preparation and clears draft on hide without automatic requests`, async () => {
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
    if (name === './QuoteCandidateFields') return { QuoteCandidateFields: stub('quote-fields') };
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
  const prepareLabel = capability === 'quote_clarification' ? '核对租赁条件' : '保留本轮发送定位';
  if (capability === 'opening_diagnosis') {
    assert.equal(find(tree, '订单标识'), undefined);
    assert.equal(find(tree, '诊断分区').props.options.length, 9);
    assert.equal(find(tree, '保留本轮发送定位').props.disabled, true);
    find(tree, '诊断分区').props.onChange(['item_groups']);
  } else if (capability === 'quote_clarification') nodes(tree).find(node => node.props.onChange && node.props.value?.customerType).props.onChange({ customerType: 'personal', customerName: 'customer-a', items: [{ productName: 'product-a', quantity: 2 }] });
  else find(tree, '订单标识').props.onChange({ currentTarget: { value: 'order-a' } }); tree = render();
  await find(tree, prepareLabel).props.onAction(); tree = render(); assert.equal(calls, 0);
  const raw = storageValues.get('ai-conversation-admission:owner-scope:conversation-a');
  assert.equal(JSON.parse(raw).capabilityCode, capability);
  assert.equal(raw.includes('item_groups'), false); assert.equal(raw.includes('order-a'), false);
  assert.equal(raw.includes('customer-a'), false); assert.equal(raw.includes('product-a'), false);
  assert.ok(capability === 'quote_clarification' ? nodes(tree).some(node => node.props.value?.customerName === 'customer-a')
    : nodes(tree).some(node => React.Children.toArray(node.props.children).includes(capability === 'opening_diagnosis' ? '商品组' : 'order-a')));
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
  else if (capability === 'quote_clarification') nodes(tree).find(node => node.props.onChange && node.props.value?.customerType).props.onChange({ customerType: 'personal', customerName: 'customer-b' });
  else find(tree, '订单标识').props.onChange({ currentTarget: { value: 'order-b' } }); tree = render('conversation-b');
  await find(tree, prepareLabel).props.onAction(); tree = render('conversation-b');
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

for (const capability of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) test(`original ${capability} task creation journals before sending and recovers only original metadata`, async () => {
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

for (const capability of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) test(`actual ${capability} task creation controls stay explicit and retract on hide and turn switch`, async () => {
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
    if (name === './ConversationOpeningExecution') return { ConversationOpeningExecution: stub('conversation-opening-execution') };
    if (name === './ConversationQuoteExecution') return { ConversationQuoteExecution: stub('conversation-quote-execution') };
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

for (const capability of ['opening_diagnosis', 'quote_clarification']) test(`${capability === 'opening_diagnosis' ? 'opening' : 'quote'} conversation executes its original model host once and reopens only the original receipt`, async () => {
  const shared = require('../packages/shared/src/index');
  const turn = { admissionKey: 'opening-admission', turnId: 'opening-turn', originalRequestKey: 'opening-original', requestHash: 'a'.repeat(64),
    capabilityCode: capability, capabilityVersion: '1', createdAt: '2026-11-03T00:00:00Z', automaticRetry: false,
    status: 'original_bound', execution: 'not_inferred_from_association', material: 'retained',
    original: { draftVersion: shared.AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: '11111111-1111-4111-8111-111111111111' },
    task: { taskId: '22222222-2222-4222-8222-222222222222', runId: '33333333-3333-4333-8333-333333333333' } };
  const original = { ...turn.original, revision: 1, contentHash: 'b'.repeat(64), sceneCode: turn.capabilityCode, sceneVersion: turn.capabilityVersion,
    requestKey: turn.originalRequestKey, previousInputRef: null, createdAt: turn.createdAt, expiresAt: '2027-01-01T00:00:00Z', state: 'stored' };
  const metadata = { state: 'observed', ...turn.task, status: 'queued', revision: 1, plan: 'not_observed', resultAvailable: false, execution: 'not_inferred_from_metadata' };
  const record = () => ({ state: 'observed', receipt: structuredClone(original), task: structuredClone(metadata) });
  const recovery = () => ({ task: structuredClone(metadata), steps: [], hasMore: false, automaticExecution: false, nextAction: 'host_plan_handoff',
    observedResults: 'preserved_even_if_task_cancelled', snapshot: 'bounded_sequential_read' });
  const reply = { original, ...turn.task, execution: { kind: 'run_outcome', outcome: { status: 'succeeded', completedSteps: 1, cleanupFailed: 0 } },
    businessExecution: 'not_inferred_from_model_result' };
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let starts = 0, current = true; const calls = [];
  const api = loadLifecycleSession('../../api/aiConversations.ts', {
    '@/app/queryClient': { currentSessionEpoch: () => 1, currentSessionSignal: () => new AbortController().signal },
    '@/features/ai-native/conversation-history-reader': {}, './aiTaskCenter': {}, './http': { http: { post: async (url, command, options) => {
      assert.equal(options.signal.aborted, false); calls.push(url);
      if (url === '/ai-native/conversations/admission') return { data: { data: { ...command, result: structuredClone(turn), absence: 'not_proof_of_no_commit', retryable: false } } };
      assert.equal(JSON.stringify(command), JSON.stringify(turn.original), 'only the original reference is sent');
      if (url.endsWith('/reconcile')) return { data: { data: record() } };
      if (url.endsWith('/recovery')) return { data: { data: recovery() } };
      assert.equal(url, capability === 'opening_diagnosis' ? '/ai-native/scene-requests/opening-model/start' : '/ai-native/scene-requests/model/start'); assert.equal(options.timeout, 120000);
      assert.ok(values.has('opening-journal')); starts++; return { data: { data: structuredClone(reply) } };
    } } },
  }).aiConversationsApi;
  const { ConversationSceneExecutionSession: Session } = loadLifecycleSession('conversation-opening-execution-session.ts');
  const create = () => new Session('conversation-a', api, () => current, storage, 'opening-journal', () => Date.parse('2026-11-09T00:00:00Z'), capability);
  const session = create(); await assert.rejects(session.start(), /AI_RESULT_UNKNOWN/); assert.equal(calls.length, 0);
  await session.inspect(turn); assert.equal(session.snapshot().ready, true); assert.equal(starts, 0);
  await session.start(); assert.equal(starts, 1); assert.equal(session.snapshot().acknowledgement.taskId, turn.task.taskId);
  assert.equal(values.get('opening-journal').includes('sections'), false); await assert.rejects(session.start(), /AI_RESULT_UNKNOWN/);
  const reopened = create(); await reopened.reconcile(); assert.equal(reopened.snapshot().ready, false); assert.equal(starts, 1);
  await assert.rejects(reopened.start(), /AI_RESULT_UNKNOWN/);
  assert.equal(shared.validateAiSceneModelStartDraft({ ...reply, taskId: 'foreign' }, turn.original, turn), false);
  assert.equal(shared.validateAiSceneModelStartDraft({ ...reply, original: { ...original, sceneCode: 'order_explanation' } }, turn.original, turn), false);
  assert.equal(shared.validateAiSceneRequestReconcileDraft({ ...record(), secret: 'rejected' }, turn.original, turn), false);
  assert.equal(shared.validateAiSceneRequestReceiptDraft({ ...original, expiresAt: '2026-02-31T00:00:00Z' }, turn.original, turn), false);
  current = false; await assert.rejects(reopened.reconcile(), /AI_SCOPE_CHANGED/); assert.equal(starts, 1);
  session.dispose(); reopened.dispose();
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
    if (name === './ConversationOrderHandoff') return { ConversationOrderHandoff: stub('order-handoff') };
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
  nodes(tree).find(node => node.props.onUnavailable).props.onUnavailable(); tree = render();
  assert.equal(text(tree), undefined); assert.deepEqual(values(tree), []);
  await read(tree).props.onAction(); tree = render();
  nodes(tree).find(node => node.props.onObserved).props.onObserved({ order: { id: 'order-a', version: '2026-11-04T00:00:00Z' }, scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' } });
  tree = render(); assert.equal(text(tree), undefined); assert.deepEqual(values(tree), []);
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
