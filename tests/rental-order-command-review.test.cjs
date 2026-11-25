'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const sourceLoader = require('../scripts/controller-sources.cjs').createControllerSourceLoader(
  root, path.dirname(path.dirname(require.resolve('typescript/package.json'))));
const sourceContract = name => sourceLoader.load(sourceLoader.resolveSource(__filename, name, true));
const feature = file => {
  if (file.startsWith('../ai-native/')) {
    const name = file.slice('../ai-native/'.length);
    for (const directory of ['packages/rental-core/admin/assistant/ai-native', 'packages/ai-native-admin/src/ai-native']) {
      const selected = path.join(root, directory, name);
      if (fs.existsSync(selected)) return fs.readFileSync(selected, 'utf8');
    }
  }
  return fs.readFileSync(path.join(root, (file.startsWith('../membership/') || file.startsWith('../catalog/'))
    ? 'packages/rental-core/admin/orders' : file.startsWith('../')
      ? 'apps/admin/src/features/rental-core' : 'packages/rental-core/admin/orders', file), 'utf8');
};
function mutation(file, name, context) {
  const source = ts.createSourceFile(file, feature(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name)
      expression = (ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer).getText(source);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name)
      expression = node.getText(source).replace(/^export\s+/, "");
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(expression, `${name} actual mutation must exist`);
  vm.runInNewContext(ts.transpileModule(`globalThis.result = (${expression});`, {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, context);
  return context.result;
}

test('actual exchange preview and apply retain the stable order line identifier', async () => {
  const calls = [], context = { id: 'order', detail: { fulfillmentLocationId: 'location' },
    postPickupExchangeEditor: { key: 'editor' }, postPickupExchangeForm: { getFieldsValue: () => ({}) },
    rentalCoreApi: { previewPostPickupExchange: (...args) => calls.push(args) }, exchangeServiceSelections: () => [] };
  const preview = mutation('RentalOrderDetailPage.tsx', 'previewPostPickupExchange', context);
  await preview.mutationFn({ orderLineId: 'stable-line', allocationId: 'actual', replacementItemGroupId: 'replacement',
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
    useRentalOrderContext: () => ({ api: context.rentalCoreApi, session: {}, runtime: { currentSessionEpoch: () => 1 } }),
    rentalOrderSessionIdentity: () => 'current-session',
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
  const controller = new AbortController(), request = queries[0].queryFn({ signal: controller.signal });
  assert.deepEqual(Array.from(request).slice(0, 3), ['order', 'settlement', 'original-snapshot']);
  assert.equal(request[3].signal, controller.signal);
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
    scope: 'catalog-scope', permissions: ['rental-os:catalog:manage'],
    editorGeneration: { current: 1 }, editorState: { generation: 1 },
    setEditorState: update => { context.editorState = update(context.editorState); context.editing = context.editorState.record; },
    form: { setFieldValue: (key, value) => { fields[key] = value; } },
    setPendingFiles: update => { context.pendingFiles = update(context.pendingFiles); },
    queryClient: { invalidateQueries: async () => undefined },
    rentalCoreApi: { saveItemGroup: async values => { calls.push(['save', values.id]); return { id: 'committed-model' }; },
      uploadItemGroupImage: async (id, file) => { calls.push(['photo', id, file]); if (file === 'second' && !context.retry) throw Error('photo failed'); return { id }; } } };
  context.isCurrentScope = () => context.scope === 'catalog-scope';
  context.allowed = () => context.permissions.includes('rental-os:catalog:manage');
  context.assertManage = mutation('../catalog/CatalogPage.tsx', 'assertManage', context);
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
  const identitySource = ts.createSourceFile('context.tsx', feature('page-context.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const identity = identitySource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'rentalOrderSessionIdentity');
  const context = { route: 'a', auth: { authenticated: true, user: { id: 'user' }, tenant: { tenantId: 'tenant' }, currentWorkspaceId: 'workspace', sessionVerified: true },
    useParams: () => ({ id: context.route }), useRentalOrderContext: () => ({ session: context.auth, runtime: { currentSessionEpoch: () => 1 } }),
    RentalOrderDetailContent: () => undefined, require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); } };
  const text = declaration.getText(source).replace(/^export /, '');
  vm.runInNewContext(ts.transpileModule(`import {jsx} from 'react/jsx-runtime'; ${identity.getText(identitySource)}; ${text}; globalThis.render = RentalOrderDetailPage;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText, Object.assign(context, { exports: {} }));
  const initial = context.render().key;
  context.route = 'b'; assert.notEqual(context.render().key, initial);
  context.route = 'a'; context.auth.tenant.tenantId = 'other'; assert.notEqual(context.render().key, initial);
  context.auth.tenant.tenantId = 'tenant'; context.auth.user.id = 'other'; assert.notEqual(context.render().key, initial);
  const legacy = fs.readFileSync(path.join(root, 'apps/admin/src/features/rental-core/RentalOrderDetailPage.tsx'), 'utf8');
  assert.match(legacy, /LegacyRentalOrderPageHost/);
  assert.match(legacy, /@rental-os\/rental-core\/admin\/orders/);
});

test('order stage actions retain the original permissions, preparation and awaited command methods', async () => {
  const source = ts.createSourceFile('detail.tsx', feature('RentalOrderDetailPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const content = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RentalOrderDetailContent');
  const start = content.body.statements.findIndex(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === 'pageActions'));
  assert.ok(start >= 0, 'the actual detail must declare its actions');
  const tail = Array.from(content.body.statements).slice(start);
  assert.ok(ts.isReturnStatement(tail.at(-1)));
  const code = ts.transpileModule(`function declaredActions() {
    ${tail.slice(0, -1).map(node => node.getText(source)).join('\n')}
    return pageActions;
  }
  globalThis.declareActions = declaredActions;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const contracts = ts.createSourceFile('contracts.ts', fs.readFileSync(path.join(root, 'packages/rental-core/src/contracts.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const statusDeclaration = contracts.statements.find(node => ts.isEnumDeclaration(node) && node.name.text === 'RentalCoreOrderStatus');
  const statusContext = { exports: {} };
  vm.runInNewContext(ts.transpileModule(statusDeclaration.getText(contracts), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, statusContext);
  const status = statusContext.exports.RentalCoreOrderStatus, calls = [], opened = [], errors = [];
  const confirmResult = deferred(), handoverResult = deferred(), settleResult = deferred();
  const context = {
    exports: {}, RentalCoreOrderStatus: status, id: 'order', detail: { status: status.Draft },
    canOperate: true, canPickup: true, canReturn: true, canSettleFunding: true,
    profile: { data: { terminology: { pickupLabel: '交付', returnLabel: '回收' } } },
    isCarrierShipping: false, locale: 'zh-CN', t: value => value, settleBlockers: [],
    action: { isPending: false, mutateAsync: type => { calls.push(['confirm', type]); return confirmResult.promise; } },
    handover: { isPending: false, mutateAsync: stage => { calls.push(['handover', stage]); return handoverResult.promise; } },
    settle: { isPending: false, mutateAsync: () => { calls.push(['settle']); return settleResult.promise; } },
    templates: { data: [{ id: 'pickup-template', stage: 'pickup', enabled: true }, { id: 'return-template', stage: 'return', enabled: true }] },
    lockResult: deferred(), refreshResult: deferred(), operationToken: undefined,
    inspectionPreparation: { current: undefined }, inspectionPreparing: false, inspectionClosing: false,
    inspectionIsCurrent: () => true, setInspectionPreparing: value => { context.inspectionPreparing = value; },
    operationLock: { isPending: false },
    rentalCoreApi: { operationLock: (...args) => { calls.push(['lock', ...args]); return context.lockResult.promise; } },
    refresh: () => context.refreshResult.promise, setOperationToken: value => { context.operationToken = value; },
    setInspectionReturnItems() {}, setCarrierEvidenceFiles() {}, setInspection: value => opened.push(value),
    message: { error: value => errors.push(value) },
    ArrowLeftOutlined: 'i', SafetyCertificateOutlined: 'i', CheckCircleOutlined: 'i',
    rentalOrderLocation: () => ({ coreId: 'rental', pageId: 'orders' }),
    require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); }
  };
  context.beginInspection = mutation('RentalOrderDetailPage.tsx', 'beginInspection', context);
  vm.runInNewContext(code, context);
  const actions = () => Array.from(context.declareActions());
  const primary = () => actions().find(action => action.emphasis === 'primary');
  assert.equal(calls.length, 0, 'declaring actions must not dispatch');
  assert.deepEqual(actions().map(action => action.id), ['back', 'confirm']);
  assert.equal(primary().execute(), confirmResult.promise);
  assert.deepEqual(calls.pop(), ['confirm', 'confirm']);
  context.canOperate = false; assert.deepEqual(actions().map(action => action.id), ['back']);
  context.detail = { status: status.ReadyForPickup };
  let current = primary();
  assert.equal(current.kind, 'open'); assert.equal(current.label.default, '交付检查');
  assert.equal(current.permissions[0].action, 'pickup');
  const preparation = current.open();
  assert.equal(current.open(), preparation, 'repeated preparation shares the original request');
  assert.equal(primary().pending, true);
  await Promise.resolve();
  assert.deepEqual(calls.pop(), ['lock', 'order', 'acquire', undefined]);
  assert.equal(opened.length, 0);
  context.lockResult.resolve({ token: 'original-lock' }); await Promise.resolve();
  assert.equal(opened.length, 0, 'opening still waits for the original refresh');
  context.refreshResult.resolve(); assert.equal(await preparation, true);
  assert.equal(primary().pending, false);
  assert.equal(opened[0], context.templates.data[0]);
  context.lockResult = deferred(); opened.length = 0;
  const failedPreparation = primary().open(); await Promise.resolve(); context.lockResult.reject(new Error('fixture lock failure'));
  assert.equal(await failedPreparation, false); assert.equal(opened.length, 0); assert.equal(errors.length, 1);
  assert.equal(primary().pending, false);
  context.detail.ruleSnapshot = { fulfillment: { pickupInspectionRequired: false, returnInspectionRequired: false } };
  current = primary(); assert.equal(current.kind, 'command'); assert.equal(current.label.default, '直接完成交付');
  assert.equal(current.execute(), handoverResult.promise); assert.deepEqual(calls.pop(), ['handover', 'pickup']);
  context.detail.status = status.Renting;
  current = primary(); assert.equal(current.kind, 'command'); assert.equal(current.permissions[0].action, 'return');
  assert.equal(current.execute(), handoverResult.promise); assert.deepEqual(calls.pop(), ['handover', 'return']);
  context.isCarrierShipping = true; assert.equal(primary().kind, 'open', 'carrier return retains its inspection gate');
  context.detail.status = status.ReadyForPickup; assert.equal(primary().kind, 'open', 'carrier pickup retains its inspection gate');
  context.isCarrierShipping = false; context.detail.status = status.Settling;
  context.settleBlockers = ['押金待处理', '预授权待处理']; context.settle.isPending = true;
  current = primary(); assert.equal(current.disabled, true); assert.equal(current.pending, true);
  assert.equal(current.permissions[0].action, 'settle');
  assert.equal(current.disabledReason.default, '服务端会拒绝关单：押金待处理、预授权待处理');
  context.settleBlockers = []; context.settle.isPending = false;
  assert.equal(primary().execute(), settleResult.promise); assert.deepEqual(calls.pop(), ['settle']);
  context.canSettleFunding = false; assert.deepEqual(actions().map(action => action.id), ['back']);
  context.canSettleFunding = true; context.canOperate = true;
  for (const value of Object.values(status)) {
    context.detail.status = value;
    assert.ok(actions().filter(action => action.emphasis === 'primary').length <= 1);
  }
  context.detail = undefined; assert.deepEqual(actions().map(action => action.id), ['back']);
});

test('inspection preparation binds the actual Core open driver to one request and the original page lifetime', async () => {
  const identitySource = ts.createSourceFile('context.tsx', feature('page-context.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const identity = identitySource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'rentalOrderSessionIdentity');
  const identityModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(identity.getText(identitySource), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, identityModule);
  function preparationFixture() {
    const state = { exports: {}, id: 'order', detail: { allocations: [] }, operationToken: 'saved-lock',
      session: { authenticated: true, sessionVerified: true, tenant: { tenantId: 'tenant' },
        currentWorkspaceId: 'workspace', user: { id: 'operator', tenantId: 'tenant' } }, epoch: 1,
      templates: { data: [{ id: 'template', stage: 'pickup', enabled: true }] },
      inspectionActive: { current: true }, inspectionPreparation: { current: undefined }, inspectionPreparing: false,
      lock: deferred(), refreshStarted: deferred(), refreshed: deferred(), calls: [], opened: [], errors: [], tokenWrites: [],
      t: value => value, rentalOrderSessionIdentity: identityModule.exports.rentalOrderSessionIdentity };
    state.context = { getSession: () => state.session };
    state.currentSessionEpoch = () => state.epoch;
    state.queryScope = state.rentalOrderSessionIdentity(state.session, state.epoch);
    state.inspectionIsCurrent = mutation('RentalOrderDetailPage.tsx', 'inspectionIsCurrent', state);
    state.rentalCoreApi = { operationLock: (...args) => { state.calls.push(args); return state.lock.promise; } };
    state.refresh = () => { state.calls.push(['refresh']); state.refreshStarted.resolve(); return state.refreshed.promise; };
    state.setInspectionPreparing = value => { state.inspectionPreparing = value; };
    state.setOperationToken = value => { state.operationToken = value; state.tokenWrites.push(value); };
    state.setInspectionReturnItems = value => { state.returnItems = value; };
    state.setCarrierEvidenceFiles = value => { state.evidence = value; };
    state.setInspection = value => state.opened.push(value);
    state.message = { error: value => state.errors.push(value) };
    state.beginInspection = mutation('RentalOrderDetailPage.tsx', 'beginInspection', state);
    return state;
  }
  const pageSource = ts.createSourceFile('CorePage.tsx', fs.readFileSync(path.join(root, 'packages/platform-admin/src/core/CorePage.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const driver = pageSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PageAction');
  const access = pageSource.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(pageSource) === 'access'));
  const contractSource = ts.createSourceFile('admin.ts', fs.readFileSync(path.join(root, 'packages/core-contracts/src/admin.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const pageText = contractSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'corePageText');
  function openDriver(state) {
    const refs = [], toasts = [];
    let refIndex = 0, mounted = false, cleanup;
    const host = { page: { key: 'rental:order-detail', coreId: 'rental', definition: { permissions: [] } }, canAccess: () => true };
    const context = { exports: {}, Button: 'button', Tooltip: 'span',
      useLocale: () => ({ locale: 'zh-CN', t: value => value }), useFeedback: () => ({ toast: value => toasts.push(value) }),
      useRef: initial => { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }); },
      useLayoutEffect: effect => { if (!mounted) { mounted = true; cleanup = effect(); } },
      require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); } };
    const code = `${pageText.getText(contractSource)}\n${access.getText(pageSource)}\n${driver.getText(pageSource)}\nglobalThis.renderAction = PageAction;`;
    vm.runInNewContext(ts.transpileModule(code, {
      fileName: 'driver.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
    }).outputText, context);
    return { toasts, unmount: () => cleanup(), button() {
      refIndex = 0;
      const action = { id: 'pickup', kind: 'open', label: { default: '领取检查' }, emphasis: 'primary',
        pending: state.inspectionPreparing, open: () => state.beginInspection('pickup') };
      return context.renderAction({ host, action }).props.children;
    } };
  }

  const state = preparationFixture(), page = openDriver(state);
  const button = page.button();
  button.props.onClick(); button.props.onClick();
  const request = state.inspectionPreparation.current.request;
  assert.equal(state.beginInspection('pickup'), request);
  assert.equal(await state.beginInspection('return', [{ allocationId: 'another-batch', quantity: 1 }]), false);
  assert.equal(page.button().props.loading, true);
  assert.deepEqual(state.calls, [['order', 'acquire', 'saved-lock']]);
  assert.equal(state.opened.length, 0);
  state.lock.resolve({ token: 'original-lock' }); await Promise.resolve();
  assert.equal(page.button().props.loading, true);
  assert.equal(state.opened.length, 0);
  state.refreshed.resolve(); assert.equal(await request, true);
  assert.equal(page.button().props.loading, false);
  assert.equal(state.opened[0], state.templates.data[0]);
  assert.deepEqual(page.toasts, []);

  const failed = preparationFixture(), failedPage = openDriver(failed);
  failedPage.button().props.onClick();
  const failure = failed.inspectionPreparation.current.request;
  await Promise.resolve(); failed.lock.reject(new Error('original lock rejection'));
  assert.equal(await failure, false);
  assert.equal(failedPage.button().props.loading, false);
  assert.equal(failed.opened.length, 0); assert.equal(failed.errors.length, 1);
  assert.deepEqual(failedPage.toasts, []);

  const changedBeforeDispatch = preparationFixture();
  const undispatched = changedBeforeDispatch.beginInspection('pickup');
  changedBeforeDispatch.session.currentWorkspaceId = 'another-workspace';
  assert.equal(await undispatched, false);
  assert.deepEqual(changedBeforeDispatch.calls, []);
  assert.deepEqual(changedBeforeDispatch.opened, []);

  const changedDuringLock = preparationFixture();
  const staleLock = changedDuringLock.beginInspection('pickup'); await Promise.resolve();
  changedDuringLock.epoch += 1; changedDuringLock.lock.resolve({ token: 'late-lock' });
  assert.equal(await staleLock, false);
  assert.deepEqual(changedDuringLock.tokenWrites, []);
  assert.deepEqual(changedDuringLock.opened, []);
  assert.deepEqual(changedDuringLock.errors, []);

  const unmounted = preparationFixture(), oldPage = openDriver(unmounted);
  oldPage.button().props.onClick(); const staleRefresh = unmounted.inspectionPreparation.current.request;
  await Promise.resolve(); unmounted.lock.resolve({ token: 'acknowledged-lock' }); await unmounted.refreshStarted.promise;
  oldPage.unmount(); unmounted.inspectionActive.current = false; unmounted.refreshed.resolve();
  assert.equal(await staleRefresh, false);
  assert.equal(unmounted.operationToken, 'acknowledged-lock');
  assert.deepEqual(unmounted.opened, []); assert.deepEqual(unmounted.errors, []);
  assert.deepEqual(unmounted.calls, [['order', 'acquire', 'saved-lock'], ['refresh']]);
  assert.equal(unmounted.inspectionPreparation.current, undefined);
});

test('order quick links focus the current declared action and retain legacy allocation without executing it', () => {
  const source = ts.createSourceFile('notice.tsx', feature('OrderQuickActionNotice.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'OrderQuickActionNotice');
  const quickActions = { exports: {} };
  vm.runInNewContext(ts.transpileModule(feature('orderQuickActions.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, quickActions);
  const focus = [], scroll = [], handled = { current: '' };
  let state, previousDependencies, effect;
  class FixtureButton {
    constructor(disabled = false) { this.disabled = disabled; }
    focus(options) { focus.push(['button', options]); }
    click() { assert.fail('a quick link must not execute an action'); }
  }
  const button = new FixtureButton();
  const target = {
    dataset: { corePage: 'rental:order-detail', coreAction: 'pickup' }, closest: () => null,
    querySelector: () => button, focus: options => focus.push(['declared', options]),
    scrollIntoView: options => scroll.push(options)
  };
  const allocation = {
    matches: selector => selector === '[data-order-action="allocation"]', querySelector: () => undefined,
    focus: options => focus.push(['allocation', options]), scrollIntoView: options => scroll.push(options)
  };
  const context = {
    exports: {}, Alert: 'alert', HTMLButtonElement: FixtureButton, URLSearchParams,
    location: { search: '?action=pickup', key: 'first' }, page: { key: 'rental:order-detail' }, reduced: true,
    targets: [{ ...target, dataset: { ...target.dataset, corePage: 'other:order-detail' } }, { ...target, closest: () => ({ inert: true }) }, target],
    document: { getElementById: id => id === 'rental-order-allocation' ? allocation : undefined,
      querySelectorAll: () => context.targets },
    useLocation: () => context.location, useCorePageHost: () => ({ page: context.page }),
    useLocale: () => ({ t: value => value }), useRef: () => handled,
    useState: () => [state, value => { state = value; }],
    useEffect: (next, dependencies) => {
      if (!previousDependencies || dependencies.some((value, index) => value !== previousDependencies[index])) effect = next;
      previousDependencies = Array.from(dependencies);
    },
    isMotionReduced: () => context.reduced, ...quickActions.exports,
    require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); }
  };
  vm.runInNewContext(ts.transpileModule(declaration.getText(source).replace(/^export /, '') + '; globalThis.render = OrderQuickActionNotice;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  const render = (ready = true) => {
    context.render({ orderId: 'order', ready });
    if (effect) { const pending = effect; effect = undefined; pending(); }
    return context.render({ orderId: 'order', ready });
  };
  assert.equal(render().props.type, 'info'); assert.equal(focus.length, 1); assert.equal(focus[0][0], 'button');
  assert.equal(focus[0][1].preventScroll, true); assert.equal(scroll[0].behavior, 'instant');
  render(); assert.equal(focus.length, 1, 'the same navigation focuses only once');
  button.disabled = true; context.location.key = 'disabled';
  assert.equal(render().props.type, 'info'); assert.equal(focus.at(-1)[0], 'declared');
  context.targets = context.targets.slice(0, 2); context.location.key = 'unavailable';
  assert.equal(render().props.type, 'warning'); assert.equal(focus.length, 2, 'foreign and inert actions remain unavailable');
  context.location = { search: '?action=allocation', key: 'allocation' };
  context.targets = [{ ...target, dataset: { ...target.dataset, coreAction: 'allocation' } }];
  assert.equal(render().props.type, 'info'); assert.equal(focus.at(-1)[0], 'allocation');
  context.location = { search: '?action=pickup', key: 'motion' }; context.targets = [target];
  context.reduced = false; button.disabled = false;
  assert.equal(render().props.type, 'info'); assert.equal(scroll.at(-1).behavior, 'smooth');
  const count = focus.length;
  context.location = { search: '?action=unknown', key: 'unknown' };
  assert.equal(render(), null); assert.equal(focus.length, count);
  context.location = { search: '?action=pickup', key: 'loading' };
  assert.equal(render(false), null); assert.equal(focus.length, count);
});

function editorFixture() {
  const slots = [], effects = [], cleanups = [], calls = [], toasts = [];
  let cursor = 0;
  const state = { identity: 'first', disabled: false, allowed: true, fields: { reason: 'original input' },
    validate: () => Promise.resolve({ ...state.fields }), save: values => Promise.resolve(values) };
  const hooks = {
    useRef(initial) {
      const index = cursor++;
      slots[index] ??= { current: initial };
      return slots[index];
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useCallback: callback => callback,
    useLayoutEffect(effect, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, at) => !Object.is(value, previous[at])))
        effects.push(() => { cleanups[index]?.(); cleanups[index] = effect(); });
      slots[index] = dependencies;
    },
  };
  const form = { getFieldsValue: () => ({ ...state.fields }), validateFields: fields => state.validate(fields) };
  const pageHost = { lifetimeKey: 'session', page: { key: 'rental:order', coreId: 'rental', definition: { permissions: [] } },
    canAccess: () => state.allowed };
  const locale = { useLocale: () => ({ t: value => value }) }, feedback = { useFeedback: () => ({ toast: value => toasts.push(value) }) };
  function load(file, dependencies = {}) {
    const loaded = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, { module: loaded, exports: loaded.exports, DOMException,
      require: name => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name}`); return dependencies[name]; } });
    return loaded.exports;
  }
  const { useCoreForm } = load('packages/platform-admin/src/core/useCoreForm.ts', {
    react: hooks, '../app/serverFormSnapshot': load('packages/platform-admin/src/app/serverFormSnapshot.ts'),
    '../app/locale': locale, '../components/ui': feedback, './CorePage': { useCorePageHost: () => pageHost },
  });
  const { useOrderEditor } = load('packages/rental-core/admin/orders/useOrderEditor.ts', {
    react: hooks, '@rental-os/platform-admin/core': { useCoreForm },
    '@rental-os/platform-admin/locale': locale, '@rental-os/platform-admin/ui': feedback,
  });
  return { state, form, pageHost, calls, toasts,
    render() {
      cursor = 0;
      const identity = state.identity;
      const editor = useOrderEditor({ form, identity, disabled: state.disabled,
        onSave: values => { calls.push({ identity, values }); return state.save(values); } });
      while (effects.length) effects.shift()();
      return editor;
    },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function nativeSubmit(editor) {
  let prevented = false, stopped = false;
  editor.formProps.onSubmitCapture({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true);
  assert.equal(stopped, true);
}

test('order editors share actual Core submissions, retain failed input and protect in-flight dismissal', async () => {
  const fixture = editorFixture(), operation = deferred(), failure = Error('save failed');
  fixture.state.save = () => operation.promise;
  let editor = fixture.render();
  fixture.state.fields.reason = 'edited input';
  editor.formProps.onValuesChange();
  const button = editor.submit(await editor.validate()), confirmation = editor.confirm();
  const buttonFailed = assert.rejects(button, error => error === failure);
  const confirmationFailed = assert.rejects(confirmation, error => error === failure);
  nativeSubmit(editor);
  await tick();
  assert.equal(fixture.calls.length, 1);
  editor = fixture.render();
  assert.equal(editor.busy, true);
  let dismissed = 0;
  editor.dismiss(() => dismissed++);
  assert.equal(dismissed, 0);
  operation.reject(failure);
  await Promise.all([buttonFailed, confirmationFailed]);
  await tick();
  editor = fixture.render();
  assert.equal(editor.busy, false);
  assert.equal(editor.dirty, true);
  assert.equal(editor.error, failure);
  assert.equal(fixture.state.fields.reason, 'edited input');
  assert.equal(fixture.toasts.length, 0, 'the initial button owns the shared failure feedback');
  fixture.state.save = values => Promise.resolve(values);
  await editor.confirm();
  editor = fixture.render();
  assert.equal(fixture.calls.length, 2);
  assert.equal(editor.dirty, false);
  editor.dismiss(() => dismissed++);
  assert.equal(dismissed, 1);
});

test('order native validation remains bound to its opening while another editor starts validation', async () => {
  const fixture = editorFixture(), original = deferred(), current = deferred();
  fixture.state.validate = () => original.promise;
  nativeSubmit(fixture.render());
  fixture.state.identity = undefined;
  fixture.render();
  fixture.state.identity = 'second';
  fixture.state.fields = { reason: 'second input' };
  fixture.state.validate = () => current.promise;
  nativeSubmit(fixture.render());
  original.resolve({ reason: 'first input' });
  await tick();
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.toasts.length, 0);
  current.resolve({ reason: 'second input' });
  await tick();
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].identity, 'second');
  assert.equal(fixture.calls[0].values.reason, 'second input');

  const validation = deferred(), editor = fixture.render();
  fixture.state.validate = () => validation.promise;
  const rejected = assert.rejects(editor.confirm(), error => error.name === 'AbortError');
  fixture.state.identity = undefined;
  fixture.render();
  fixture.state.identity = 'second';
  fixture.render();
  validation.resolve({ reason: 'discarded input' });
  await rejected;
  assert.equal(fixture.calls.length, 1, 'reopening the same target still creates a new validation generation');
});

test('order editors recheck target, permission, disabled state and host lifetime immediately before dispatch', async () => {
  for (const change of [fixture => { fixture.state.identity = 'other'; }, fixture => { fixture.state.allowed = false; },
    fixture => { fixture.state.disabled = true; }, fixture => { fixture.pageHost.lifetimeKey = 'other-session'; },
    fixture => fixture.unmount()]) {
    const fixture = editorFixture(), editor = fixture.render();
    const request = editor.submit({ ...fixture.state.fields });
    const rejected = assert.rejects(request);
    change(fixture);
    if (fixture.state.identity !== 'first' || fixture.state.disabled || fixture.pageHost.lifetimeKey !== 'session') fixture.render();
    await rejected;
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.state.fields.reason, 'original input');
  }
});

test('partial-return editor keeps a failed inspection start open and preserves direct return submission', async () => {
  const calls = [], context = { id: 'order', partialReturnOpen: true, partialReturnForm: {}, canReturn: true, t: value => value,
    order: { data: { ruleSnapshot: { fulfillment: { returnInspectionRequired: true } } } },
    beginInspection: async (...args) => { calls.push(args); return false; },
    setPartialReturnOpen: value => { context.partialReturnOpen = value; },
    partialReturn: { mutateAsync: values => { calls.push(['return', values]); return Promise.resolve(values); } } };
  const editor = mutation('RentalOrderDetailPage.tsx', 'partialReturnEditor', context);
  const values = { items: [{ allocationId: 'allocation', quantity: 1 }] };
  await assert.rejects(editor.onSave(values), /本批归还检查尚未开始/);
  assert.equal(context.partialReturnOpen, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'return');
  assert.equal(calls[0][1], values.items);
  context.beginInspection = async () => true;
  await editor.onSave(values);
  assert.equal(context.partialReturnOpen, false);
  context.order.data.ruleSnapshot.fulfillment.returnInspectionRequired = false;
  await editor.onSave(values);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1], values);
});

test('inspection editor preserves transformed results, attachment IDs and exception evidence in its awaited save', async () => {
  const calls = [], context = { id: 'order', inspectionForm: {}, inspection: { id: 'template', stage: 'pickup' },
    inspectionReturnItems: undefined, inspectionClosing: false, canPickup: true, canReturn: true, t: value => value,
    order: { data: { fulfillmentMode: 'carrier_shipping' } }, message: { error() {} },
    carrierEvidenceFiles: [{ status: 'done', response: { id: 'uploaded' } }, { status: 'error', response: { id: 'failed' } }],
    inspect: { mutateAsync: values => { calls.push(values); return Promise.resolve(values); } } };
  const editor = mutation('RentalOrderDetailPage.tsx', 'inspectionEditor', context);
  await editor.onSave({ condition: 'checked', attachmentsText: ' first, uploaded\nfirst ', exceptionDescription: 'damage found',
    exceptionAllocationId: 'allocation', exceptionChargeAmount: '12.5' });
  const payload = JSON.parse(JSON.stringify(calls[0]));
  assert.deepEqual(payload, { condition: 'checked', attachments: ['first', 'uploaded'], exceptions: [{ code: 'damage',
    description: 'damage found', allocationId: 'allocation', chargeAmount: 12.5, evidenceAttachments: ['first', 'uploaded'] }] });
  context.carrierEvidenceFiles = [];
  await assert.rejects(editor.onSave({ condition: 'checked' }), /必须上传/);
  assert.equal(calls.length, 1);
});

test('carrier editor rejects an unavailable timeline and awaits only completed evidence in its original event payload', async () => {
  const calls = [], context = { order: { id: 'order' }, queryScope: 'current-session', form: {},
    nextType: 'outbound_dispatched', events: { isError: false, isPending: false }, t: value => value, message: { error() {} },
    files: [{ status: 'done', response: { id: 'confirmed-file' } }, { status: 'error', response: { id: 'failed-file' } }],
    createEvent: { mutateAsync: values => { calls.push(values); return Promise.resolve(values); } } };
  context.onSubmit = mutation('CarrierShipmentPanel.tsx', 'onSubmit', context);
  const fixture = editorFixture();
  fixture.state.fields = { carrierName: 'Carrier', trackingNumber: 'tracking', occurredAt: { toISOString: () => '2026-11-18T00:00:00Z' } };
  for (const unavailable of [{ isError: true, isPending: false }, { isError: false, isPending: true }]) {
    context.events = unavailable;
    const options = mutation('CarrierShipmentPanel.tsx', 'editor', context);
    fixture.state.identity = options.identity;
    fixture.state.disabled = options.disabled;
    fixture.state.save = options.onSave;
    await assert.rejects(fixture.render().confirm(), /当前操作不可用/);
    assert.equal(calls.length, 0);
  }
  context.events = { isError: false, isPending: false };
  fixture.state.disabled = mutation('CarrierShipmentPanel.tsx', 'editor', context).disabled;
  await fixture.render().confirm();
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { type: 'outbound_dispatched', carrierName: 'Carrier', trackingNumber: 'tracking',
    occurredAt: '2026-11-18T00:00:00Z', evidenceFileAssetIds: ['confirmed-file'] });
  context.files = [];
  await assert.rejects(fixture.render().confirm(), /至少一份承运凭证/);
  assert.equal(calls.length, 1);
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
  const shared = sourceContract('@rental-os/shared'), context = { exports: {}, ...format, ...safe,
    AI_PROPOSAL_DRAFT_VERSION: shared.AI_PROPOSAL_DRAFT_VERSION, AI_TASK_DRAFT_VERSION: shared.AI_TASK_DRAFT_VERSION,
    AI_STEP_STATUSES_DRAFT: shared.AI_STEP_STATUSES_DRAFT, AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION: shared.AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION,
    structuredClone, RENTAL_FULFILLMENT_MODES: shared.RENTAL_FULFILLMENT_MODES,
    RENTAL_PRICING_UNIT_CODES: shared.RENTAL_PRICING_UNIT_CODES, useLocale: () => ({ t: value => value }),
    Alert: props => require('react').createElement('aside', null, props.title),
    require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); } };
  context.useRentalAssistant = () => ({ aiTaskCenterApi: context.aiTaskCenterApi });
  vm.runInNewContext(ts.transpileModule(declarations.map(node => node.getText(source)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, context);
  return { source, context, ...context.exports };
}
const boundaryValue = atomicity => ({ kind: 'settings', taskId: 'task', runId: 'run', stepId: 'step', taskRevision: 1,
  review: { proposal: { payload: { contractVersion: sourceContract('@rental-os/shared').AI_PROPOSAL_DRAFT_VERSION,
    taskId: 'task', proposalId: 'proposal', revision: 1, scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' }, atomicity, failurePolicy: 'stop_and_reconcile',
    actions: atomicity === 'single_action' ? [{}] : [{}, {}], expiresAt: '2099-01-01T00:00:00Z' } },
    change: { diff: { 'notifications.enabledEvents': { before: [], after: ['created'] },
      'notifications.editableChannels': { before: [], after: ['sms'] } }, baseRevision: 1 } } });
const confirmationSnapshot = () => ({ contractVersion: sourceContract('@rental-os/shared').AI_TASK_DRAFT_VERSION, taskId: 'task', steps: [
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
    runId: undefined, requestedProposal: undefined, reviewedOrder: { current: null }, reportOrderReview: () => {},
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


test('order creation API and page contribution retain original paths, signals and the create permission', async () => {
  const apiModule = { exports: {} }, calls = [], receipt = { id: 'original-response' };
  vm.runInNewContext(ts.transpileModule(feature('client.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module: apiModule, exports: apiModule.exports, require: name => {
    assert.equal(name, '../work-orders/client');
    return { createRentalWorkOrderApi: () => ({ workOrders: () => [], stockDispositions: () => [] }) };
  } });
  const api = apiModule.exports.createRentalOrderApi(async (url, options) => { calls.push({ url, options }); return receipt; });
  const controller = new AbortController(), options = { signal: controller.signal };
  const readers = [
    [() => api.bookingMembers(options), '/rental/v1/booking-members'],
    [() => api.bookingOptions('member/a', options), '/rental/v1/booking-members/member%2Fa/booking-options'],
    [() => api.bookingDeliveryAddresses('member/a', options), '/rental/v1/booking-members/member%2Fa/delivery-addresses'],
    [() => api.locations(options), '/rental/v1/locations'],
    [() => api.pricingPlans(options), '/rental/v1/pricing-plans'],
    [() => api.discountPlans(options), '/rental/v1/discount-plans'],
    [() => api.valueAddedServices(options), '/rental/v1/value-added-services'],
    [() => api.customerCoupons('member/a', options), '/rental/v1/customer-coupons']
  ];
  for (const [read, url] of readers) {
    assert.equal(await read(), receipt);
    const actual = calls.at(-1);
    assert.equal(actual.url, url); assert.equal(actual.options.signal, controller.signal);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).options.params)), { customerId: 'member/a' });
  const quoteInput = { customerId: 'member', lines: [] }, orderInput = { quoteId: 'original-quote' };
  assert.equal(await api.createQuote(quoteInput), receipt); assert.equal(calls.at(-1).url, '/rental/v1/quotes');
  assert.equal(calls.at(-1).options.method, 'post'); assert.equal(calls.at(-1).options.data, quoteInput);
  assert.equal(await api.createOrder(orderInput), receipt); assert.equal(calls.at(-1).url, '/rental/v1/orders');
  assert.equal(calls.at(-1).options.method, 'post'); assert.equal(calls.at(-1).options.data, orderInput);
  const originalApi = fs.readFileSync(path.join(root, 'apps/admin/src/api/rentalCore.ts'), 'utf8');
  assert.match(originalApi, /\.\.\.createRentalOrderApi\(request\)/);
  assert.doesNotMatch(originalApi, /^  (bookingMembers|bookingOptions|bookingDeliveryAddresses|pricingPlans|discountPlans|valueAddedServices|customerCoupons|createQuote|locations|createOrder):/m);

  const pagesModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(feature('pages.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module: pagesModule, exports: pagesModule.exports, require: name => {
    assert.equal(name, '@rental-os/rental-core/permissions');
    return sourceContract(name);
  } });
  const pages = pagesModule.exports.RENTAL_ORDER_PAGES;
  assert.equal(pages.orderCreate.path, '/orders/new'); assert.equal(pages.orderCreate.parent, 'orders');
  assert.deepEqual(JSON.parse(JSON.stringify(pages.orderCreate.permissions)), [{ resource: 'order', action: 'create' }]);
  assert.equal(pages.orderCreate.menu, undefined);
  const context = { exports: {}, RENTAL_ORDER_CORE_ID: 'rental', RENTAL_ORDER_PAGES: pages,
    RentalOrderPageContextProvider: 'provider', RentalOrdersPage: 'orders', RentalOrderDetailPage: 'detail', RentalOrderCreatePage: 'create',
    require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); } };
  const contribute = mutation('index.tsx', 'createRentalOrdersAdminContribution', context);
  const pageContext = {}, contribution = contribute('fixed-version', () => pageContext);
  assert.equal(contribution.pages.length, 3);
  const create = contribution.pages.find(page => page.id === pages.orderCreate.id).component();
  assert.equal(create.type, 'provider'); assert.equal(create.props.context, pageContext); assert.equal(create.props.children.type, 'create');
  assert.match(feature('../rental-core/RentalOrderCreatePage.tsx'), /LegacyRentalOrderPageHost page="orderCreate"/);
});

test('order creation awaits its validated quote and original order while discarding stale drafts and pages', async () => {
  const fingerprintModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'packages/platform-admin/src/app/serverFormSnapshot.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports: fingerprintModule.exports });
  function fixture() {
    const values = { customerId: 'member', bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false },
      fulfillmentMode: 'delivery', fulfillmentLocationId: 'pickup', returnLocationId: 'return', deliveryAddressMode: 'saved', deliveryAddressId: 'address',
      period: [require('dayjs')('2026-11-18T01:00:13.456Z'), require('dayjs')('2026-11-19T09:00:13.456Z')], pricingPlanId: 'plan',
      discountPlanId: 'discount', customerCouponId: 'coupon', lines: [{ pricingGroupId: 'group', itemGroupId: 'model', quantity: '2', usageQuantity: '3', note: 'original note' }] };
    const state = { values, quoteGeneration: { current: 0 }, currentQuote: { current: undefined }, currentSubmissionMode: { current: 'ordinary' },
      selectedMember: { customerId: 'member', name: 'Member' }, selectedServices: [{ serviceId: 'service', quantity: '4' }],
      deliveryDestination: 'customer_address', active: true, quoteRequest: deferred(), orderRequest: deferred(), quoteCalls: [], orderCalls: [], shown: [], created: [], errors: [],
      DOMException, t: value => value, formSnapshotFingerprint: fingerprintModule.exports.formSnapshotFingerprint };
    state.form = { getFieldsValue: () => state.values };
    state.quoteEditor = { isCurrent: () => state.active };
    state.createQuote = { mutateAsync: input => { state.quoteCalls.push(input); return state.quoteRequest.promise; } };
    state.createOrder = { mutateAsync: input => { state.orderCalls.push(input); return state.orderRequest.promise; } };
    state.setQuote = value => { state.quote = value; state.shown.push(value); };
    state.setCreated = value => state.created.push(value);
    state.message = { error: value => state.errors.push(value) };
    state.isDeliveryMode = mode => ['delivery', 'onsite_delivery'].includes(mode);
    state.quoteOrder = mutation('RentalOrderCreatePage.tsx', 'quoteOrder', state);
    state.submitOrder = mutation('RentalOrderCreatePage.tsx', 'submitOrder', state);
    state.invalidateQuote = mutation('RentalOrderCreatePage.tsx', 'invalidateQuote', state);
    return state;
  }
  const state = fixture(), quotePromise = state.quoteOrder(state.values);
  assert.equal(state.shown.length, 0); assert.equal(state.quoteCalls.length, 1);
  const input = state.quoteCalls[0];
  assert.equal(input.lines[0].quantity, 2); assert.equal(input.lines[0].usageQuantity, 3); assert.equal(input.services[0].quantity, 4);
  assert.equal(input.startAt, '2026-11-18T01:00:13.456Z'); assert.equal(input.endAt, '2026-11-19T09:00:13.456Z');
  assert.equal(input.deliveryAddressId, 'address'); assert.equal(input.deliveryAddressDraft, undefined);
  const original = { id: 'server-quote', request: input, currency: 'USD', payableAmount: 137 };
  state.quoteRequest.resolve(original); assert.equal(await quotePromise, original); assert.equal(state.currentQuote.current, original);
  const orderPromise = state.submitOrder(); assert.equal(state.created.length, 0);
  assert.equal(state.orderCalls[0].quoteId, original.id); assert.equal(state.orderCalls[0].customerId, 'member');
  assert.equal(state.orderCalls[0].bookingIdentity, original.request.bookingIdentity);
  assert.equal(state.orderCalls[0].lines[0].itemGroupId, 'model'); assert.equal(state.orderCalls[0].lines[0].quantity, 2);
  assert.equal('payableAmount' in state.orderCalls[0], false);
  const order = { id: 'original-order', orderNo: 'ORDER-1' }; state.orderRequest.resolve(order);
  assert.equal(await orderPromise, order); assert.equal(state.created[0], order);

  const stale = fixture(), lateQuote = stale.quoteOrder(stale.values);
  stale.invalidateQuote(); stale.quoteRequest.resolve(original);
  await assert.rejects(lateQuote, error => error.name === 'AbortError');
  assert.equal(stale.shown.filter(Boolean).length, 0); assert.equal(stale.currentQuote.current, undefined); assert.equal(stale.errors.length, 0);
  const changed = fixture(); changed.values = { ...changed.values, customerId: 'another' };
  await assert.rejects(changed.quoteOrder(state.values), error => error.name === 'AbortError'); assert.equal(changed.quoteCalls.length, 0);
  const hidden = fixture(); hidden.currentSubmissionMode.current = 'delegated';
  await assert.rejects(hidden.quoteOrder(hidden.values), error => error.name === 'AbortError'); assert.equal(hidden.quoteCalls.length, 0);
  const failed = fixture(), failure = new Error('original quote rejection'), failedQuote = failed.quoteOrder(failed.values);
  const rejection = assert.rejects(failedQuote, error => error === failure); failed.quoteRequest.reject(failure); await rejection;
  assert.deepEqual(failed.errors, ['original quote rejection']); assert.equal(failed.shown.length, 0);
  const unmounted = fixture(); unmounted.quote = original; unmounted.currentQuote.current = original;
  const pendingOrder = unmounted.submitOrder(); unmounted.active = false; unmounted.orderRequest.resolve(order);
  assert.equal(await pendingOrder, order); assert.equal(unmounted.created.length, 0);

  const validationCalls = [], validation = mutation('useOrderEditor.ts', 'validate', {
    key: 'editor', assertCurrent: () => {}, form: { validateFields: (...args) => { validationCalls.push(args); return Promise.resolve({}); } }
  });
  const validateOptions = { dirty: true, recursive: true }, fields = [['bookingIdentity', 'corporateCustomerId']];
  await validation(validateOptions); await validation(fields, validateOptions);
  assert.equal(validationCalls[0][0], validateOptions); assert.equal(validationCalls[0].length, 1);
  assert.equal(validationCalls[1][0], fields); assert.equal(validationCalls[1][1], validateOptions);

  const createSource = ts.createSourceFile('create.tsx', feature('RentalOrderCreatePage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const content = createSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RentalOrderCreateContent');
  const binding = content.body.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(createSource) === 'quoteForm'));
  assert.ok(binding, 'the quote form must retain its identity through unrelated query refreshes');
  const validationGate = deferred(), currentValues = { customerId: 'member' };
  const originalForm = { getFieldsValue: () => currentValues, validateFields: () => validationGate.promise };
  const editor = { key: 'current-draft', validate: () => validationGate.promise };
  let memoized;
  const bindingContext = { form: originalForm, quoteEditor: editor, useMemo: (create, dependencies) => {
    if (!memoized || dependencies.some((value, index) => value !== memoized.dependencies[index]))
      memoized = { dependencies, value: create() };
    return memoized.value;
  } };
  vm.runInNewContext(ts.transpileModule(`function bindForm() { ${binding.getText(createSource)} return quoteForm; }
    globalThis.bindForm = bindForm;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, bindingContext);

  const pageSource = ts.createSourceFile('CorePage.tsx', fs.readFileSync(path.join(root, 'packages/platform-admin/src/core/CorePage.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const driver = pageSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PageAction');
  const access = pageSource.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(pageSource) === 'access'));
  const buttonSource = ts.createSourceFile('ActionButton.tsx', fs.readFileSync(path.join(root, 'packages/platform-admin/src/components/ui/ActionButton.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const saveButton = buttonSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'SaveButton');
  const refs = [], saveCalls = [], savedSnapshots = [];
  let refIndex = 0;
  const driverContext = { exports: {}, ActionButton: 'action', corePageText: value => value.default,
    useLocale: () => ({ locale: 'zh-CN', t: value => value }), useFeedback: () => ({ toast: () => {} }),
    useRef: initial => { const index = refIndex++; return refs[index] ?? (refs[index] = { current: initial }); },
    useLayoutEffect: effect => effect(), useWorkspaceActionForm: () => 'current-quote-form',
    resolveActionButtonIntent: () => 'save', formSnapshotFingerprint: fingerprintModule.exports.formSnapshotFingerprint,
    notifyFormSaved: (form, snapshot) => savedSnapshots.push({ form, snapshot }),
    require: name => { assert.equal(name, 'react/jsx-runtime'); return require(name); } };
  vm.runInNewContext(ts.transpileModule(`${saveButton.getText(buttonSource)}
    ${access.getText(pageSource)}
    ${driver.getText(pageSource)}
    globalThis.renderAction = PageAction;`, {
    fileName: 'quote-driver.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
  }).outputText, driverContext);
  const host = { page: { key: 'rental:order-create', coreId: 'rental', definition: { permissions: [] } }, canAccess: () => true };
  const render = () => {
    refIndex = 0;
    const action = { id: 'quote', kind: 'save', label: { default: '生成报价' }, form: bindingContext.bindForm(),
      onSave: values => { saveCalls.push(values); return Promise.resolve(original); } };
    return driverContext.renderAction({ host, action }).props.children;
  };
  const first = render(), button = first.type(first.props), pending = button.props.onAction();
  assert.equal(saveCalls.length, 0, 'the actual SaveButton still waits for field validation');
  editor.validate = () => validationGate.promise;
  const refreshed = render();
  assert.equal(refreshed.props.form, first.props.form, 'a query refresh retains the same validated form binding');
  validationGate.resolve(currentValues);
  assert.equal(await pending, original);
  assert.equal(saveCalls.length, 1); assert.equal(saveCalls[0], currentValues); assert.equal(savedSnapshots.length, 1);
  editor.key = 'another-draft';
  assert.notEqual(bindingContext.bindForm(), first.props.form, 'another editing lifetime gets a separate form binding');
});

test('merchant original delegation preserves the historical D and verifies unknown without redispatch', async () => {
  const consumerSource = ts.createSourceFile('consumers.cjs', fs.readFileSync(path.join(root, 'tests/enterprise-consumers.test.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const helpers = consumerSource.statements.filter(node => ts.isFunctionDeclaration(node) && ['reactHost', 'emitter'].includes(node.name?.text));
  const helperContext = { assert };
  vm.runInNewContext(helpers.map(node => node.getText(consumerSource)).join("\n"), helperContext);
  const hooks = helperContext.reactHost(), events = helperContext.emitter(), storage = new Map(), calls = [];
  const session = { authenticated: true, sessionVerified: true, tenant: { tenantId: 'tenant' }, user: { id: 'operator', tenantId: 'tenant' },
    currentWorkspaceId: 'workspace', hasPermission: () => true };
  let epoch = 1, readGate, readStarted;
  const source = { delegationKey: 'original-D', personalCustomerId: 'member', corporateCustomerId: 'enterprise', quoteId: 'quote', workspaceId: 'workspace',
    requestReference: { quoteId: 'quote' }, state: 'issued', revision: 1, expiresAt: new Date(Date.now() + 86400000).toISOString(), confirmedAt: new Date().toISOString(),
    purpose: 'merchant_operator', original: { state: 'not_submitted', retryable: false }, retryable: false };
  let result = { delegationKey: 'original-D', state: 'unknown', orderId: null, retryable: false };
  const identity = mutation('page-context.tsx', 'rentalOrderSessionIdentity', { exports: {} });
  const context = { session, getSession: () => context.session, runtime: { currentSessionEpoch: () => epoch,
    currentSessionSignal: () => new AbortController().signal, subscribe: listener => events.on(listener) },
    requestOriginal: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/execute')) {
        assert.equal(JSON.parse([...storage.values()][0]).state, 'unknown');
        return result;
      }
      if (url.endsWith('/result')) return result;
      if (readGate) { readStarted.resolve(); await readGate.promise; }
      return source;
    } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(feature('enterprise-merchant-order-delegation.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { module, exports: module.exports, require: name => {
    if (name === 'react') return hooks.runtime;
    assert.equal(name, './page-context'); return { rentalOrderSessionIdentity: identity };
  }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    navigator: { locks: { request: async (_key, operation) => operation() } }, AbortController, AbortSignal, structuredClone });
  hooks.mount(() => module.exports.useMerchantOrderDelegationSource(context, true));
  try {
    const operation = hooks.value, original = await operation.read('original-D');
    assert.equal(original.delegationKey, source.delegationKey);
    assert.equal([...storage.keys()][0], 'rental-os:merchant-order-delegation-source:' + JSON.stringify(['tenant', 'operator', 'workspace']));
    await operation.execute(original, () => {});
    assert.equal(hooks.value.savedState, 'unknown');
    assert.equal(calls.filter(call => call.options.method === 'post').length, 1);
    const post = calls.find(call => call.options.method === 'post');
    assert.equal(post.url, '/membership/enterprise-workflows/order-delegations/original-D/execute');
    assert.deepEqual(JSON.parse(JSON.stringify(post.options.data)), { delegationKey: 'original-D', expectedRevision: 1, confirm: true });
    assert.equal(Object.hasOwn(post.options, '_authRetry'), false);
    await assert.rejects(hooks.value.execute(original, () => {}), /原 Core 结果/);
    await assert.rejects(hooks.value.read('another-D'), /未决提交/);
    result = { delegationKey: 'original-D', state: 'observed', orderId: 'order', retryable: true };
    await assert.rejects(hooks.value.readOriginal('original-D'), /无法核对/);
    assert.equal(hooks.value.savedState, 'unknown');
    result = { ...result, retryable: false };
    const observed = await hooks.value.readOriginal('original-D');
    assert.equal(observed.orderId, 'order'); assert.equal(hooks.value.savedState, 'observed');
    assert.equal(calls.filter(call => call.options.method === 'post').length, 1);
    readGate = deferred(); readStarted = deferred();
    const late = hooks.value.read('original-D'); await readStarted.promise;
    context.session = { ...session, currentWorkspaceId: 'another-workspace' }; epoch += 1; events.emit(); hooks.rerender();
    readGate.resolve(); await assert.rejects(late, /身份、空间或权限已变化/);
    assert.equal(JSON.parse([...storage.values()][0]).delegationKey, 'original-D');
  } finally { hooks.unmount(); }
});
