'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const feature = file => fs.readFileSync(path.join(__dirname, '../apps/admin/src/features/rental-core', file), 'utf8');
function mutation(file, name, context) {
  const source = ts.createSourceFile(file, feature(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(expression, `${name} actual mutation must exist`);
  vm.runInNewContext(ts.transpileModule(`globalThis.result = (${expression});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  return context.result;
}

test('actual exchange preview and apply retain the stable order line identifier', async () => {
  const calls = [], context = { id: 'order', detail: { fulfillmentLocationId: 'location' },
    rentalCoreApi: { previewPostPickupExchange: (...args) => calls.push(args) }, exchangeServiceSelections: () => [] };
  const preview = mutation('RentalOrderDetailPage.tsx', 'previewPostPickupExchange', context);
  preview.mutationFn({ orderLineId: 'stable-line', allocationId: 'actual', replacementItemGroupId: 'replacement',
    condition: 'checked', priceBasis: 'original_order_price', originalDisposition: 'return_to_warehouse' });
  assert.equal(calls[0][1].orderLineId, 'stable-line');
  const source = feature('RentalOrderDetailPage.tsx');
  const tree = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const stableFields = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'orderLineId' && node.initializer.getText(tree) === 'values.orderLineId') stableFields.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(stableFields.length >= 2, 'preview and apply both use the selected stable line');
});

test('voucher preview, print and download use the same archived version and never local order amounts', () => {
  const source = ts.createSourceFile('documents.tsx', feature('OrderDocumentsPanel.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const queries = [], state = { type: 'settlement', snapshotId: 'original-snapshot' };
  const context = { exports: {}, useLocale: () => ({ t: value => value }), App: { useApp: () => ({ message: {} }) },
    useState: () => [state, () => {}], useEffect: () => {}, useQuery: options => { queries.push(options); return { data: undefined, isFetching: false }; },
    DOCUMENT_TYPES: [{ value: 'settlement', label: 'Settlement' }],
    rentalCoreApi: { orderDocumentVersion: (...args) => args, orderDocument: () => assert.fail('must read selected version'), orderDocumentVersions: () => [] },
    ListSection: 'section', Modal: 'aside', Space: 'div', Typography: { Text: 'span' }, Button: 'button', QueryState: 'div',
    FileTextOutlined: 'i', DownloadOutlined: 'i', PrinterOutlined: 'i', Select: 'select', safeVoucherHtml: () => assert.fail('no unarchived HTML'),
    require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); } };
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'OrderDocumentsPanel');
  vm.runInNewContext(ts.transpileModule(fn.getText(source).replace(/^export /, '') + '; globalThis.render=OrderDocumentsPanel;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  context.render({ order: { id: 'order', orderNo: 'ORDER' } });
  assert.deepEqual(Array.from(queries[0].queryFn()), ['order', 'settlement', 'original-snapshot']);
  assert.equal(queries[0].refetchInterval, false); assert.equal(queries[0].refetchOnWindowFocus, false);
});

test('actual extension callbacks discard late dates and requests, and submission requires the displayed date', async () => {
  const pending = [], shown = [];
  const context = { id: 'original-order', t: value => value, extensionPreviewGeneration: { current: 0 },
    extensionForm: { getFieldValue: () => ({ toISOString: () => context.date }) },
    setExtensionPreview: value => shown.push(value), date: 'first-date',
    rentalCoreApi: { previewOrderExtension: (id, input) => new Promise(resolve => pending.push({ id, input, resolve })) } };
  const preview = mutation('RentalOrderDetailPage.tsx', 'previewExtension', context);
  const first = preview.mutationFn({ newEndAt: { toISOString: () => 'first-date' } });
  context.date = 'second-date'; context.extensionPreviewGeneration.current++;
  pending[0].resolve({ newEndAt: 'first-date' }); preview.onSuccess(await first);
  assert.equal(shown.length, 0);
  const second = preview.mutationFn({ newEndAt: { toISOString: () => 'second-date' } });
  const third = preview.mutationFn({ newEndAt: { toISOString: () => 'second-date' } });
  pending[2].resolve({ newEndAt: 'second-date', amount: 30 }); preview.onSuccess(await third);
  pending[1].resolve({ newEndAt: 'second-date', amount: 20 }); preview.onSuccess(await second);
  assert.equal(shown.length, 1); assert.equal(shown[0].amount, 30);
  context.extensionPreview = shown[0];
  const applied = []; context.rentalCoreApi.requestOrderExtension = (...args) => applied.push(args);
  const apply = mutation('RentalOrderDetailPage.tsx', 'applyExtension', context);
  assert.throws(() => apply.mutationFn({ newEndAt: { toISOString: () => 'changed-date' } }), /重新试算/);
  apply.mutationFn({ newEndAt: { toISOString: () => 'second-date' } });
  assert.equal(applied.length, 1); assert.equal(applied[0][0], 'original-order');
});

test('actual allocation mutation sends the draft revision even after candidate and order refresh', async () => {
  const calls = [];
  const context = { order: { id: 'original-order', assignment: { revision: 9 } }, candidates: { data: { revision: 9 } },
    draftRevision: 3, open: true, confirmation: undefined, t: value => value,
    rentalCoreApi: { manageAllocations: (id, input) => calls.push({ id, input }) } };
  const command = mutation('OrderAllocationPanel.tsx', 'mutation', context);
  command.mutationFn({ action: 'preassign', items: [] });
  assert.equal(calls[0].input.expectedRevision, 3);
  context.draftRevision = undefined;
  assert.throws(() => command.mutationFn({ action: 'preassign' }), /原版本/);
  assert.equal(calls.length, 1);
});

test('address editor omits an unchanged blank telephone but preserves explicit replacements', () => {
  const calls = [], context = { customerId: 'customer', addressTarget: { id: 'address', revision: 4 },
    customerApi: { saveAddress: (...args) => calls.push(args) } };
  const command = mutation('../membership/CustomerProfileDetails.tsx', 'saveAddress', context);
  command.mutationFn({ recipient: 'Recipient', phone: '   ' });
  assert.equal(calls[0][1].phone, undefined); assert.equal(calls[0][1].revision, 4);
  command.mutationFn({ phone: ' 13800138000 ' }); assert.equal(calls[1][1].phone, '13800138000');
});

test('model save survives a later photo failure and retry skips photos already confirmed', async () => {
  const calls = [], fields = {}, context = { pendingFiles: [
    { uid: 'first', originFileObj: 'first' }, { uid: 'second', originFileObj: 'second' } ],
    setEditing: group => { context.editing = group; }, form: { setFieldValue: (key, value) => { fields[key] = value; } },
    setPendingFiles: update => { context.pendingFiles = update(context.pendingFiles); },
    queryClient: { invalidateQueries: async () => undefined },
    rentalCoreApi: { saveItemGroup: async values => { calls.push(['save', values.id]); return { id: 'committed-model' }; },
      uploadItemGroupImage: async (id, file) => { calls.push(['photo', id, file]); if (file === 'second' && !context.retry) throw Error('photo failed'); return { id }; } } };
  const command = mutation('../catalog/CatalogPage.tsx', 'save', context);
  await assert.rejects(command.mutationFn({ code: 'MODEL' }), /photo failed/);
  assert.equal(fields.id, 'committed-model'); assert.equal(context.editing.id, 'committed-model');
  assert.deepEqual(context.pendingFiles.map(row => row.uid), ['second']);
  context.retry = true; await command.mutationFn({ code: 'MODEL', id: fields.id });
  assert.equal(calls.filter(row => row[0] === 'photo' && row[2] === 'first').length, 1);
  assert.equal(calls.filter(row => row[0] === 'save' && row[1] === undefined).length, 1);
});

test('task-center rejection reaches the original continuation while unknown references remain blocked', async () => {
  const file = '../ai-native/TaskHumanApproval.tsx';
  const source = ts.createSourceFile(file, feature(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const initializers = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) initializers.set(node.name.getText(source), node.initializer.getText(source));
    ts.forEachChild(node, visit);
  }
  visit(source);
  const stored = new Map(), calls = [], messages = [];
  const context = { review: { taskId: 'task', runId: 'run', stepId: 'step', checkpointRef: 'checkpoint', taskRevision: 7,
      review: { proposal: { status: 'cancelled', payload: { proposalId: 'proposal', revision: 2 }, payloadHash: 'a'.repeat(64) } } },
    hasOrderReviewMaterial: () => true, expires: Date.now() + 60000, original: null, continuation: null, busy: false,
    taskId: 'task', continueKey: 'original-continuation', AI_PROPOSAL_DRAFT_VERSION: 'ain-proposal-draft-1',
    sessionStorage: { setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    setContinuation: () => {}, run: work => work(new AbortController().signal), same: () => true,
    setReview: () => {}, setReceipt: () => {}, setMessage: text => messages.push(text), t: text => text,
    aiTaskCenterApi: { continue: async input => { calls.push(input); return { ...input, kind: 'run_outcome', status: 'failed',
      automaticRetry: false, businessExecution: 'read_original_receipt' }; } } };
  const evaluate = name => vm.runInNewContext(ts.transpileModule(`globalThis.value = (${initializers.get(name)});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  evaluate('rejectionContinuation'); context.rejectionContinuation = context.value;
  evaluate('canContinue'); assert.equal(context.value, true); context.canContinue = context.value;
  evaluate('continueOriginal'); await context.value();
  assert.equal(calls.length, 1); assert.equal(calls[0].checkpointRef, 'checkpoint'); assert.equal(calls[0].expectedTaskRevision, 7);
  assert.equal(calls[0].proposal.reviewedPayloadHash, 'a'.repeat(64));
  assert.ok(stored.has(context.continueKey), 'a failed runner status alone must not erase an uncertain business reference');
  assert.match(messages[0], /原拒绝已交运行器收尾/);
  context.continuation = 'invalid'; evaluate('canContinue'); assert.equal(context.value, false);
  context.continuation = null; context.original = { pending: true }; evaluate('canContinue'); assert.equal(context.value, false);
  context.original = null; context.rejectionContinuation = false; context.review.review.proposal.status = 'pending_confirmation';
  evaluate('canContinue'); assert.equal(context.value, false);
  context.review.review.proposal.status = 'confirmed'; evaluate('canContinue'); assert.equal(context.value, true);
});

test('actual detail wrapper gives a new command lifecycle to another order, tenant or user', () => {
  const source = ts.createSourceFile('detail.tsx', feature('RentalOrderDetailPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RentalOrderDetailPage');
  assert.ok(declaration);
  const context = { route: 'a', auth: { user: { id: 'user' }, tenant: { tenantId: 'tenant' }, currentWorkspaceId: 'workspace', sessionVerified: true },
    useParams: () => ({ id: context.route }), useAuthStore: select => select(context.auth), currentSessionEpoch: () => 1,
    RentalOrderDetailContent: () => undefined, require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); } };
  const text = declaration.getText(source).replace(/^export /, '');
  vm.runInNewContext(ts.transpileModule(`import {jsx} from 'react/jsx-runtime'; ${text}; globalThis.render = RentalOrderDetailPage;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText, Object.assign(context, { exports: {} }));
  const initial = context.render().key;
  context.route = 'b'; assert.notEqual(context.render().key, initial);
  context.route = 'a'; context.auth.tenant.tenantId = 'other'; assert.notEqual(context.render().key, initial);
  context.auth.tenant.tenantId = 'tenant'; context.auth.user.id = 'other'; assert.notEqual(context.render().key, initial);
});

function humanReviewConsumer() {
  const file = '../ai-native/TaskHumanApproval.tsx', text = process.env.AI_AIN07_REVIEW_SOURCE
    ? fs.readFileSync(path.resolve(__dirname, '..', process.env.AI_AIN07_REVIEW_SOURCE), 'utf8') : feature(file);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['id', 'materialId', 'materialText', 'validPeriod', 'fulfillmentLabels', 'amountLabels',
    'hasProposalExecutionBoundary', 'hasOrderReviewMaterial', 'taskHumanStepKey', 'taskHumanSteps', 'taskHumanStepQuery',
    'stepStatusLabels', 'originalBusinessObservation', 'TaskProposalExecutionBoundary', 'TaskActionResults', 'TaskHumanReviewDetails']);
  const declarations = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.has(declaration.name.getText(source))));
  for (const name of ['TaskProposalExecutionBoundary', 'TaskActionResults', 'taskHumanSteps'])
    assert.ok(declarations.some(node => node.name?.text === name), `real consumer must contain ${name}`);
  const format = {}, safe = {};
  for (const [file, exports] of [['formatters.ts', format], ['safe-display.ts', safe]]) {
    vm.runInNewContext(ts.transpileModule(feature('../ai-native/' + file), { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
  }
  const shared = require('../packages/shared/src'), context = { exports: {}, ...format, ...safe,
    AI_PROPOSAL_DRAFT_VERSION: shared.AI_PROPOSAL_DRAFT_VERSION, AI_TASK_DRAFT_VERSION: shared.AI_TASK_DRAFT_VERSION,
    AI_STEP_STATUSES_DRAFT: shared.AI_STEP_STATUSES_DRAFT, AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION: shared.AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION,
    structuredClone, RENTAL_FULFILLMENT_MODES: shared.RENTAL_FULFILLMENT_MODES,
    RENTAL_PRICING_UNIT_CODES: shared.RENTAL_PRICING_UNIT_CODES, useLocale: () => ({ t: value => value }),
    Alert: props => require('react').createElement('aside', null, props.title),
    require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); } };
  vm.runInNewContext(ts.transpileModule(declarations.map(node => node.getText(source)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, context);
  return { source, context, ...context.exports };
}
const boundaryValue = atomicity => ({ kind: 'settings', taskId: 'task', runId: 'run', stepId: 'step', taskRevision: 1,
  review: { proposal: { payload: { contractVersion: require('../packages/shared/src').AI_PROPOSAL_DRAFT_VERSION,
    taskId: 'task', proposalId: 'proposal', revision: 1, atomicity, failurePolicy: 'stop_and_reconcile',
    actions: atomicity === 'single_action' ? [{}] : [{}, {}], expiresAt: '2099-01-01T00:00:00Z' } },
    change: { diff: { 'notifications.enabledEvents': { before: [], after: ['created'] },
      'notifications.editableChannels': { before: [], after: ['sms'] } }, baseRevision: 1 } } });
const confirmationSnapshot = () => ({ contractVersion: require('../packages/shared/src').AI_TASK_DRAFT_VERSION, taskId: 'task', steps: [
  { stepId: 'first', runId: 'run', sequence: 1, revision: 2, status: 'succeeded', kind: 'confirmation' },
  { stepId: 'second', runId: 'run', sequence: 2, revision: 3, status: 'unknown', kind: 'confirmation' }] });
const originalObservation = (stepId, status) => ({ taskId: 'task', runId: 'run', stepId, kind: 'order', status,
  observedAt: '2026-11-06T07:00:00Z', execution: 'read_only_no_start_no_reconnect_side_effect', payment: 'not_inferred', fulfillment: 'not_inferred',
  ...(status === 'committed' ? { order: { id: 'original-first-order', status: 'pending_allocation', quoteId: 'original-quote' } } : {}) });

test('AIN07 trusted confirmation renders atomic/failure/compensation boundaries and rejects missing policy', () => {
  const h = humanReviewConsumer(), render = require('react-dom/server').renderToStaticMarkup;
  const single = render(h.TaskHumanReviewDetails({ value: boundaryValue('single_action') }));
  assert.match(single, /只覆盖当前一个动作，不代表整个任务原子提交/);
  assert.match(single, /停止后续动作并核对原操作结果/); assert.match(single, /补偿须走原业务入口与审批/);
  assert.match(single, /外部副作用不承诺回滚/); assert.match(single, /原高风险审核链不变/);
  assert.match(render(h.TaskProposalExecutionBoundary({ value: boundaryValue('ordered_partial') })), /允许部分完成/);
  const missing = boundaryValue('single_action'); delete missing.review.proposal.payload.failurePolicy;
  assert.equal(h.hasOrderReviewMaterial(missing), false);
  assert.match(render(h.TaskHumanReviewDetails({ value: missing })), /不能批准或继续/);
  missing.review.proposal.payload.failurePolicy = 'automatic_rollback'; assert.equal(h.hasOrderReviewMaterial(missing), false);
});

test('AIN07 actual action results keep a committed predecessor beside unknown successor without inferring payment or rollback', () => {
  const h = humanReviewConsumer(), render = require('react-dom/server').renderToStaticMarkup, steps = h.taskHumanSteps(confirmationSnapshot(), 'task');
  const observations = { 'run:first': originalObservation('first', 'committed'), 'run:second': originalObservation('second', 'unknown') };
  const html = render(h.TaskActionResults({ steps, observations }));
  assert.match(html, /original-first-order/); assert.match(html, /原业务结果待核对，不能自动重试/);
  assert.match(html, /后继失败或待核对不会自动回滚此前已提交动作/);
  assert.match(html, /不代表完整未执行计划/); assert.equal(html.includes('付款成功'), false);
  const noReceipt = render(h.TaskActionResults({ steps, observations: {} }));
  assert.equal(noReceipt.includes('原Core订单已确认提交'), false); assert.match(noReceipt, /不推断未执行或已回滚/);
  const foreign = originalObservation('first', 'committed'); foreign.taskId = 'other'; foreign.order.id = 'foreign-order';
  assert.equal(render(h.TaskActionResults({ steps, observations: { 'run:first': foreign } })).includes('foreign-order'), false);
  assert.throws(() => h.taskHumanSteps({ ...confirmationSnapshot(), taskId: 'other' }, 'task'));
  assert.throws(() => h.taskHumanSteps({ ...confirmationSnapshot(), steps: Array(21).fill(confirmationSnapshot().steps[0]) }, 'task'));
});

test('AIN07 real refresh and original-result callback retain receipt scope while sending only original query fields', async () => {
  const h = humanReviewConsumer(), initializers = new Map(); let businessCallback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) initializers.set(node.name.getText(h.source), node.initializer.getText(h.source));
    if (ts.isCallExpression(node) && node.expression.getText(h.source) === 'aiTaskCenterApi.business') {
      let parent = node.parent;
      while (parent && !(ts.isArrowFunction(parent) && parent.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword))) parent = parent.parent;
      businessCallback = parent?.getText(h.source);
    }
    ts.forEachChild(node, visit);
  }
  visit(h.source); assert.ok(businessCallback);
  let rows = [], observations = { 'run:first': originalObservation('first', 'committed') }, sent;
  const context = { ...h.context.exports, structuredClone, taskId: 'task', same: () => true, selected: 'run:second', original: null, continuation: null,
    steps: h.taskHumanSteps(confirmationSnapshot(), 'task'), run: work => work(new AbortController().signal), t: value => value,
    setReview: () => {}, setReceipt: () => {}, setBusiness: () => {}, setSelected: () => {}, setMessage: () => {},
    setContinuation: () => {}, continueKey: 'held', sessionStorage: { removeItem: () => assert.fail('unknown cannot clear original continuation') },
    setSteps: value => { rows = value; }, setStepObservations: value => { observations = typeof value === 'function' ? value(observations) : value; },
    aiTaskCenterApi: { snapshot: async () => confirmationSnapshot(), business: async query => { sent = query; return originalObservation('second', 'unknown'); } } };
  const evaluate = text => vm.runInNewContext(ts.transpileModule(`globalThis.value=(${text});`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  evaluate(businessCallback); await context.value(new AbortController().signal);
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), { taskId: 'task', runId: 'run', stepId: 'second' });
  assert.equal(observations['run:first'].status, 'committed'); assert.equal(observations['run:second'].status, 'unknown');
  evaluate(initializers.get('readSteps')); await context.value();
  assert.equal(Object.keys(observations).length, 0, 'explicit current-scope refresh clears previous receipt projections');
  assert.equal(rows.length, 2);
});
