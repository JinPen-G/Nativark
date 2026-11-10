'use strict';
/** Bounded offline consumer behavior: transpile unchanged worktree sources in memory.
 * React/WeChat/API/DB substitutes are test hosts, not production implementations.
 * No application boot, generated client, dist output, network or real database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'enterprise-offline', 'workflows');
const preload = path.join(root, 'tests', 'fixtures', 'ai-native', 'prisma-offline-preload.cjs');
assert.equal(process.env.DATABASE_URL, 'mysql://offline:offline@127.0.0.1:1/rental_os_offline');
for (const name of ['AI_OFFLINE_WRITE_ROOT', 'TEMP', 'TMP']) {
  assert.ok(process.env[name] && path.isAbsolute(process.env[name]), `${name} must be absolute`);
  assert.equal(path.resolve(process.env[name]), output, name);
}
assert.ok(process.env.AI_OFFLINE_AUDIT && path.isAbsolute(process.env.AI_OFFLINE_AUDIT));
assert.equal(path.dirname(path.resolve(process.env.AI_OFFLINE_AUDIT)), output);
assert.ok(process.execArgv.some(arg => path.resolve(arg) === preload), 'Use the worktree offline preload explicitly with node -r');

const sources = new Map();
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const forbidden = name => () => { throw new Error(`Unexpected dependency side effect: ${name}`); };
function load(relative, dependencies, globals = {}) {
  let source = sources.get(relative);
  if (!source) {
    const filename = path.join(root, relative), text = fs.readFileSync(filename, 'utf8');
    const result = ts.transpileModule(text, { fileName: filename, reportDiagnostics: true, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      experimentalDecorators: true, emitDecoratorMetadata: false,
    } });
    assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
    source = { filename, text, code: result.outputText, hash: crypto.createHash('sha256').update(text).digest('hex') };
    sources.set(relative, source);
    console.log(`SOURCE ${source.filename} sha256=${source.hash} lines=${text.split('\n').length}`);
  }
  const exports = {}, module = { exports };
  vm.runInNewContext(source.code, {
    exports, module, require(name) {
      if (relative === 'packages/shared/src/enterprise-workflows.ts' && name === './enterprise') return enterpriseContracts;
      if (relative === 'packages/shared/src/enterprise-workflows.ts' && name === './core') return load('packages/shared/src/core.ts', {}, globals);
      if (name === '@rental-os/shared') return { ...enterpriseContracts, ...enterpriseWorkflowContracts, ...transferDecisionContracts, ...extensionContracts, ...(dependencies[name] ?? {}) };
      if (relative === 'apps/enterprise-portal/src/WorkflowPages.tsx' && name === '@/components/ui/customer-entry' && dependencies[name]?.Form && !dependencies[name].Form.useWatch) {
        // Only the new region watch: real Form remains the owner in production.
        const ui = dependencies[name]; Object.assign(ui.Form, { useWatch: (field, form) => form.getFieldValue?.(field) }); return ui;
      }
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (['apps/enterprise-portal/src/WorkflowPages.tsx','apps/enterprise-portal/src/OwnRentalHandoffs.tsx'].includes(relative) && name === 'react-router-dom') return { useLocation: () => ({ search: '' }) };
      if (name === '@/components/enterprise-management-material') return load('apps/admin/src/components/enterprise-management-material.ts', dependencies, globals);
      if (name === '@/components/enterprise-application-material') return load('apps/admin/src/components/enterprise-application-material.ts', dependencies, globals);
      if (relative.startsWith('apps/enterprise-portal/src/')) {
        if (name === './administrator-transfer-review') return transferReview;
        if (name === './enterprise-action-labels') return actionLabels;
        if (name === './TransferDecisionRecovery') return load('apps/enterprise-portal/src/TransferDecisionRecovery.tsx', dependencies, globals);
        if (name === './MerchantContact') return load('apps/enterprise-portal/src/MerchantContact.tsx', dependencies, globals);
        if (name === './MembershipAudit') return load('apps/enterprise-portal/src/MembershipAudit.tsx', dependencies, globals);
        if (name === './OwnMessages') return load('apps/enterprise-portal/src/OwnMessages.tsx', { react: { useRef: forbidden('uninvoked original-message child hook') }, ...dependencies }, globals);
        if (name === './ApplicationReviewMessages') return load('apps/enterprise-portal/src/ApplicationReviewMessages.tsx', { react: { useRef: forbidden('uninvoked original-application-review child hook') }, ...dependencies }, globals);
        if (name === './JoinReviewMessages') return load('apps/enterprise-portal/src/JoinReviewMessages.tsx', { react: { useRef: forbidden('uninvoked original-join-review child hook') }, ...dependencies }, globals);
        if (name === './ManagementReviewMessages') return load('apps/enterprise-portal/src/ManagementReviewMessages.tsx', { react: { useRef: forbidden('uninvoked original-management-review child hook') }, ...dependencies }, globals);
        if (name === './ApprovalNotices') return load('apps/enterprise-portal/src/ApprovalNotices.tsx', { react: { useRef: forbidden('uninvoked original-approval-notice child hook') }, ...dependencies }, globals);
        if (name === './RelationshipMessages') return load('apps/enterprise-portal/src/RelationshipMessages.tsx', { react: { useRef: forbidden('uninvoked original-relationship-message child hook') }, ...dependencies }, globals);
        if (name === './TransferMessages') return load('apps/enterprise-portal/src/TransferMessages.tsx', { react: { useRef: forbidden('uninvoked original-transfer-message child hook') }, ...dependencies }, globals);
        if (name === './OwnStatusMessages') return load('apps/enterprise-portal/src/OwnStatusMessages.tsx', { react: { useRef: forbidden('uninvoked original-status-message child hook') }, ...dependencies }, globals);
        if (name === './CorporateStatusMessages') return load('apps/enterprise-portal/src/CorporateStatusMessages.tsx', { react: { useRef: forbidden('uninvoked corporate-status-message child hook') }, ...dependencies }, globals);
        if (name === './EmployeePolicyMessages') return load('apps/enterprise-portal/src/EmployeePolicyMessages.tsx', { react: { useRef: forbidden('uninvoked employee-policy-message child hook') }, ...dependencies }, globals);
        if (name === './RetainedMergeMessages') return load('apps/enterprise-portal/src/RetainedMergeMessages.tsx', { react: { useRef: forbidden('uninvoked retained-merge-message child hook') }, ...dependencies }, globals);
        if (name === './OwnRentalHandoffOrders') return load('apps/enterprise-portal/src/OwnRentalHandoffOrders.tsx', dependencies, globals);
        if (name === './OwnRentalHandoffs') return load('apps/enterprise-portal/src/OwnRentalHandoffs.tsx', dependencies, globals);
        if (name === './OwnRentalFulfillment') return load('apps/enterprise-portal/src/OwnRentalFulfillment.tsx', dependencies, globals);
        if (name === './RentalHandoffMaterial') return load('apps/enterprise-portal/src/RentalHandoffMaterial.tsx', dependencies, globals);
        if (name === './ManagementRequestFeedback') return load('apps/enterprise-portal/src/ManagementRequestFeedback.tsx', dependencies, globals);
        if (name === './MemberOperationRecovery') return load('apps/enterprise-portal/src/MemberOperationRecovery.tsx', dependencies, globals);
      }
      if (relative === 'apps/api/src/modules/client/client-api.service.ts' && name === '../rental-core/rental-core-fact.repository') return {}; // Read-only non-tx fixtures never invoke this new port.
      if (relative === 'apps/enterprise-portal/src/OwnRentalFulfillment.tsx' && name === 'react-router-dom') return { useLocation: () => ({ search: '' }) };
      if (relative === 'apps/enterprise-portal/src/OwnRentalHandoffOrders.tsx' && name === '@tanstack/react-query') return { useQuery: forbidden('uninvoked original-source child hook') };
      if (relative === 'apps/enterprise-portal/src/OwnRentalHandoffOrders.tsx' && name === 'react-router-dom') return { Link: 'link' };
      if (relative === 'apps/enterprise-portal/src/OwnRentalHandoffOrders.tsx' && name === '@rental-os/web-client') return load('packages/web-client/src/enterprise-entry.ts', {});
      if (relative === 'apps/admin/src/features/membership/EnterpriseRentalHandoffs.tsx' && name === './EnterpriseRentalHandoffQueue') return load('apps/admin/src/features/membership/EnterpriseRentalHandoffQueue.tsx', dependencies, globals);
      if (name === 'node:async_hooks') return require(name);
      throw new Error(`Unexpected runtime import in ${relative}: ${name}`);
    }, console, Date, Map, Set, JSON, Error, Promise, URLSearchParams, structuredClone, ...globals,
  }, { filename: source.filename, timeout: 1000 });
  return module.exports;
}
const enterpriseContracts = load('packages/shared/src/enterprise.ts', {});
const enterpriseWorkflowContracts = load('packages/shared/src/enterprise-workflows.ts', {});
const transferDecisionContracts = load('packages/shared/src/enterprise-transfer-decision.ts', {});
const extensionContracts = load('packages/shared/src/enterprise-expense.ts', {});
const actionLabels = load('apps/enterprise-portal/src/enterprise-action-labels.ts', {});
const transferReview = load('apps/enterprise-portal/src/administrator-transfer-review.ts', {});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function emitter() {
  const listeners = new Set();
  return { on(fn) { listeners.add(fn); return () => listeners.delete(fn); }, emit(event) { for (const fn of [...listeners]) fn(event); } };
}

// Only hook scheduling/JSX construction is substituted. Events invoke the actual
// transpiled closures, including their storage, await, owner and cleanup checks.
function reactHost() {
  let slots = [], index = 0, effects = [], dirty = false, disposed = true, renderBody, value;
  const jsx = (type, props) => ({ type, props: props || {} });
  const runtime = {
    useRef(initial) { const n = index++; if (!slots[n]) slots[n] = { current: initial }; return slots[n]; },
    useState(initial) {
      const n = index++;
      if (!slots[n]) slots[n] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[n].value, next => {
        const result = typeof next === 'function' ? next(slots[n].value) : next;
        if (!Object.is(slots[n].value, result)) { slots[n].value = result; dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const n = index++, old = slots[n];
      if (!old || !deps || !old.deps || deps.some((d, i) => !Object.is(d, old.deps[i]))) {
        slots[n] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[n].cleanup?.(); slots[n].cleanup = effect(); });
      }
    },
  };
  const host = {
    runtime, jsx: { jsx, jsxs: jsx, Fragment: Symbol('Fragment') },
    mount(body) { slots = []; effects = []; disposed = false; renderBody = body; dirty = true; host.flush(); },
    flush() {
      if (disposed) return;
      for (let n = 0; dirty; n++) {
        assert.ok(n < 30, 'bounded hook rerender'); dirty = false; index = 0; effects = [];
        value = renderBody(); const pending = effects; effects = []; for (const effect of pending) effect();
      }
    },
    get value() { host.flush(); return value; },
    rerender() { dirty = true; host.flush(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); disposed = true; },
    async settle() { for (let n = 0; n < 24; n++) { await Promise.resolve(); host.flush(); } },
    async act(action) { action(); host.flush(); await host.settle(); },
  };
  return host;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (tree && typeof tree === 'object') return text(tree.props?.children);
  return tree === undefined || tree === null || typeof tree === 'boolean' ? '' : String(tree);
}
function approval(state = 'pending', quoteId = 'q1') {
  return { id: `approval-${quoteId}`, quoteId, state, revision: 2, expiresAt: '2026-11-02T12:00:00Z' };
}
function webFixture(kind = 'approval') {
  const hooks = reactHost(), events = emitter(), storage = new Map(), calls = [], orders = [];
  const f = {
    hooks, storage, calls, orders, storageMode: '', generation: 1, customer: 'p1', workspace: 's1', tenant: 'merchant',
    rows: [approval()], receipt: { state: 'committed', result: { id: 'approval-q1' } }, handlers: {},
    result: { approval: approval('consumed'), original: { state: 'observed', orderId: 'order-1', retryable: false } },
    orderResult: { state: 'observed', orderId: 'order-1', retryable: false },
    props: { quoteId: 'q1', identity: 'quote-owner-p1-s1', english: false, onOrder: id => orders.push(id) },
  };
  const scope = () => JSON.stringify([f.tenant, f.customer, f.workspace]);
  const captureEnterpriseHostSession = () => {
    const signature = JSON.stringify([f.tenant, f.generation, f.customer, f.workspace]);
    return { tenantCode: f.tenant, operationScope: scope(), identity: signature,
      current: () => signature === JSON.stringify([f.tenant, f.generation, f.customer, f.workspace]) };
  };
  const invoke = async (name, args, fallback) => {
    calls.push({ name, args: plain(args) });
    return Object.hasOwn(f.handlers, name) ? f.handlers[name](...args) : plain(fallback);
  };
  const sessionApi = {
    enterpriseCommand: (...args) => invoke('command', args, {}),
    enterpriseApprovals: (...args) => invoke('approvals', args, f.rows),
    enterpriseOperation: (...args) => invoke('operation', args, f.receipt),
    enterpriseApprovalResult: (...args) => invoke('approvalResult', args, f.result),
    createOrder: (...args) => invoke('createOrder', args, { order: { id: 'ignored-http-order' } }),
    enterpriseOrderOriginal: (...args) => invoke('orderOriginal', args, f.orderResult),
  };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem(key, value) { if (f.storageMode === 'throw') throw new Error('host storage full'); if (f.storageMode !== 'drop') storage.set(key, value); },
    removeItem: key => storage.delete(key),
  };
  const filename = kind === 'approval' ? 'EnterpriseBookingApproval.tsx' : 'useEnterpriseOrderSubmission.ts';
  const module = load(`apps/tenant-website/src/components/${filename}`, {
    react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '../data/authClient': { captureEnterpriseHostSession, sessionApi, subscribeCustomerSession: (_tenant, listener) => events.on(listener) },
  }, { localStorage, crypto: { randomUUID: () => crypto.randomUUID() } });
  const mount = () => hooks.mount(() => kind === 'approval' ? module.EnterpriseBookingApproval(f.props) : module.useEnterpriseOrderSubmission(id => orders.push(id)));
  f.pending = () => plain(JSON.parse(storage.get(`${kind === 'approval' ? 'rental-os:enterprise-operation:' : 'rental-os:enterprise-order:'}${scope()}`) || 'null'));
  f.button = label => { const hit = nodes(hooks.value).find(node => node.type === 'button' && text(node) === label); assert.ok(hit, `button: ${label}`); return hit; };
  f.click = async label => { const button = f.button(label); assert.equal(Boolean(button.props.disabled), false, `enabled: ${label}`); await hooks.act(() => button.props.onClick()); };
  f.purpose = async () => { const textarea = nodes(hooks.value).find(node => node.type === 'textarea'); await hooks.act(() => textarea.props.onChange({ target: { value: 'Verified business purpose' } })); };
  f.check = async () => { const checkbox = nodes(hooks.value).find(node => node.type === 'input' && node.props.type === 'checkbox'); assert.ok(checkbox); await hooks.act(() => checkbox.props.onChange({ target: { checked: true } })); };
  f.changeIdentity = () => { f.customer = 'p2'; f.generation++; f.props = { ...f.props, identity: 'quote-owner-p2-s1' }; events.emit({ type: 'changed' }); hooks.flush(); };
  f.remount = () => { hooks.unmount(); mount(); };
  f.count = name => calls.filter(call => call.name === name).length;
  mount(); return f;
}

function miniFixture() {
  const storage = new Map(), calls = [], redirects = [], events = emitter();
  const f = { storage, calls, redirects, events, storageMode: '', handlers: {}, version: 1, customer: 'p1', service: 's1',
    rows: [approval()], receipt: { state: 'committed', result: { id: 'approval-q1' } },
    result: { approval: approval('consumed'), original: { state: 'observed', orderId: 'order-1', retryable: false } },
    orderResult: { state: 'observed', orderId: 'order-1', retryable: false }, confirm: true, keys: 0,
  };
  const now = Date.parse('2026-11-01T12:00:00Z');
  const wx = {
    getStorageSync: key => plain(storage.get(key)),
    setStorageSync(key, value) { if (f.storageMode === 'throw') throw new Error('host storage full'); if (f.storageMode !== 'drop') storage.set(key, plain(value)); },
    removeStorageSync: key => storage.delete(key),
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    showModal: async options => { calls.push({ name: 'modal', options }); return { confirm: f.confirm }; },
    switchTab: forbidden('wx.switchTab'),
  };
  const session = { contextVersion: () => f.version, currentServiceCode: () => f.service,
    currentSession: () => ({ customer: { customerId: f.customer, customerType: 'personal' } }), membershipStatus: () => 'active', sessionEvents: events };
  const clock = { serverNow: () => now, remainingMs: value => Date.parse(value) - now, formatRemaining: () => '1 day' };
  const keys = { newKey: prefix => `${prefix}-${++f.keys}` };
  const storageModule = load('apps/miniprogram/src/core/storage.ts', {}, { wx });
  const cart = load('apps/miniprogram/src/core/cart.ts', { './clock': clock, './keys': keys, './session': session, './storage': storageModule });
  const request = async (url, options = {}) => {
    calls.push({ name: 'api', url, options: plain(options) });
    if (Object.hasOwn(f.handlers, url)) return f.handlers[url](options);
    if (url === '/enterprise/my-approvals') return plain(f.rows);
    if (url === '/enterprise/my-rental-policies') return [];
    if (url.startsWith('/enterprise/operations/')) return plain(f.receipt);
    if (url.startsWith('/enterprise/approvals/') && url.endsWith('/result')) return plain(f.result);
    if (url.startsWith('/enterprise/quotes/')) return plain(f.orderResult);
    if (options.method === 'POST') return {};
    throw new Error(`Unexpected API substitute request: ${url}`);
  };
  const enterprise = load('apps/miniprogram/src/api/enterprise.ts', { '../core/http': { request } });
  const quote = { id: 'q1', expiresAt: '2026-11-02T12:00:00Z', currency: 'CNY', request: { lines: [{ itemGroupId: 'item', quantity: 1 }] },
    chargeLines: [], membershipSnapshot: { bookingIdentity: 'enterprise_employee', enterpriseContractAndPayer: true, enterpriseBasis: { approvalMode: 'per_order' } },
    rentalLineAmounts: {}, payableAmount: 100, depositAmount: 200, preAuthAmount: 0, ruleVersion: 'v1' };
  const cartState = { serviceCode: 's1', serviceName: 'Rental service', revision: 1, lines: [{ key: 'item', itemGroupId: 'item', itemName: 'Item', quantity: 1 }],
    services: [], fulfillmentMode: 'store_pickup_return', locationId: 'l1', startAt: '2026-11-02T12:00:00Z', endAt: '2026-11-03T12:00:00Z',
    bookingIdentity: { bookingIdentity: 'enterprise_employee', corporateCustomerId: 'company', enterpriseContractAndPayer: true,
      enterpriseDisclosure: { acknowledged: true, noticeVersion: 'notice-1' } }, quote: { id: 'q1', revision: 1, expiresAt: quote.expiresAt }, updatedAt: now };
  storage.set(storageModule.STORAGE_KEYS.cart, cartState);
  const catalog = { locations: [], services: [], items: [], timeZone: 'UTC', fulfillment: { enabledModes: [] } };
  const dependencies = {
    '../../api/addresses': { listAddresses: forbidden('address read') }, '../../api/enterprise': enterprise,
    '../../core/keys': keys, '../../core/storage': storageModule,
    '../../api/catalog': { createQuote: forbidden('new quote'), fetchCoupons: async () => [], fetchQuote: async () => plain(quote) },
    '../../api/orders': { createOrder: async (...args) => { calls.push({ name: 'legacyOrder', args: plain(args) }); return { order: { id: 'legacy-replayed-order' }, replayed: true }; }, readBookingHostCapabilities: forbidden('AI publication') },
    '../../api/payments': { fetchPaymentCapabilities: async () => ({}) }, '../../core/cart': cart,
    '../../core/catalogStore': { catalogPricingUnitLabel: () => 'day', loadCatalog: async () => catalog, primaryLocation: () => undefined },
    '../../core/clock': clock, '../../core/errors': { describeError: e => ({ message: e?.message || String(e) }) },
    '../../core/http': { isApiError: (e, code) => e?.code === code }, '../../core/labels': { chargeLabel: type => type },
    '../../core/money': { formatMoney: amount => String(amount), startingPriceParts: () => ({ available: false }) },
    '../../core/page': { loadingState: () => ({ status: 'loading' }), readyState: () => ({ status: 'ready' }), blockedState: () => ({ status: 'blocked' }),
      errorState: () => ({ status: 'error' }), handleCommonViewAction: () => false },
    '../../core/payment': { jsapiEnabled: () => false, offlineMethods: () => ['cash'] }, '../../core/session': session,
    '../../config/public': { PUBLIC_CONFIG: { tenantCode: 'merchant' } },
    '../../components/ai-native/booking-handoff': { createCustomerBookingConsumer: forbidden('AI host') },
    '../../components/ai-native/booking-host.factory': { createCustomerBookingHostFactory: forbidden('AI factory') },
    '../../core/merchant': { cachedMerchant: () => undefined },
    '../../core/time': { formatBusinessDate: value => value, formatBusinessTime: () => '12:00', splitInstant: () => ({ date: '2026-11-02', time: '12:00' }),
      todayInZone: () => '2026-11-01', zoneLabel: () => 'UTC', zonedToInstant: forbidden('new period') },
    '../../core/theme-behavior': { themeBehavior: {} },
    '../../core/ui': { ROUTES: { order: '/pages/order/index', pay: '/pages/pay/index', checkout: '/pages/checkout/index' },
      buildUrl: (route, params) => `${route}?id=${params.id}`, redirect: url => redirects.push(url), navigate: forbidden('navigation'),
      requireSignIn: () => true, toast: message => calls.push({ name: 'toast', message }) },
    '../../core/zones': { rememberZone() {}, zoneOf: () => 'UTC' },
  };
  let definition;
  load('apps/miniprogram/src/pages/checkout/index.ts', dependencies, { wx, Page: value => { definition = value; }, setInterval: () => 1, clearInterval() {} });
  const mount = () => {
    const page = { ...definition, data: plain(definition.data), patches: [], setData(patch) { this.patches.push(plain(patch)); Object.assign(this.data, patch); } };
    page.onLoad(); page.aiVisible = true; page.enterpriseViewEpoch = 1;
    Object.assign(page.data, { quote: plain(quote), cart: plain(cartState), enterprisePurpose: 'Verified business purpose', agreed: true });
    return page;
  };
  f.page = mount(); f.cart = cart; f.storageModule = storageModule; f.quote = quote;
  f.countPost = () => calls.filter(call => call.name === 'api' && call.options.method === 'POST').length;
  f.countRead = () => calls.filter(call => call.name === 'api' && call.options.method !== 'POST').length;
  f.operation = () => plain(storage.get(f.page.enterpriseStorageKey()));
  f.seedOperation = (kind, extra = {}) => {
    const operation = { key: 'original-key', quoteId: 'q1', kind, version: f.version, viewEpoch: f.page.enterpriseViewEpoch,
      customerId: f.customer, serviceCode: f.service, ...(kind === 'submit' ? { approvalId: 'approval-q1' } : {}), ...extra };
    storage.set(f.page.enterpriseStorageKey(), plain(operation)); f.page.enterpriseOperation = operation;
    f.page.setData({ enterprisePending: true }); return operation;
  };
  f.remount = async () => { f.page.onUnload(); f.page = mount(); f.page.onShow(); for (let n = 0; n < 24; n++) await Promise.resolve(); };
  f.changeIdentity = () => { f.customer = 'p2'; f.version++; events.emit({ type: 'signed-out' }); };
  return f;
}

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
check('Web approval: request is not an order; original approval + unchecked explicit submit; then one submit and original result', async () => {
  const f = webFixture(); await f.purpose(); await f.click('申请企业批准');
  assert.equal(f.count('command'), 1); assert.equal(f.calls.find(c => c.name === 'command').args[0], 'approvals');
  assert.equal(f.orders.length, 0); assert.equal(f.count('approvalResult'), 0); assert.equal(f.pending(), null);
  f.rows = [approval('approved')]; await f.click('核对原批准与提交结果');
  assert.equal(f.button('核对后提交').props.disabled, true, 'approval is not explicit user confirmation');
  await f.check(); await f.click('核对后提交');
  const writes = f.calls.filter(c => c.name === 'command');
  assert.equal(writes.length, 2); assert.equal(writes[1].args[0], 'approvals/submit'); assert.equal(writes[1].args[1].confirm, true);
  assert.notEqual(writes[0].args[1].operationKey, writes[1].args[1].operationKey);
  assert.equal(f.count('approvalResult'), 1); assert.deepEqual(f.orders, ['order-1']); assert.equal(f.pending(), null);
});
check('Web approval: failed/silently dropped durable reference means zero dispatch', async () => {
  for (const mode of ['throw', 'drop']) {
    const f = webFixture(); f.storageMode = mode; await f.purpose(); await f.click('申请企业批准');
    assert.equal(f.count('command'), 0, mode); assert.equal(f.count('operation'), 0); assert.ok(nodes(f.hooks.value).some(n => n.props?.role === 'alert'));
  }
});
check('Web approval: lost request response survives remount; not_recorded never clears key or enables another request', async () => {
  const f = webFixture(); f.handlers.command = async () => { throw new Error('lost response after dispatch'); };
  await f.purpose(); await f.click('申请企业批准'); const original = f.pending(); assert.ok(original?.key);
  f.remount(); f.receipt = { state: 'not_recorded' }; await f.click('核对原批准与提交结果');
  assert.deepEqual(f.pending(), original); assert.equal(f.count('command'), 1); assert.equal(f.button('申请企业批准').props.disabled, true);
  assert.equal(f.calls.find(c => c.name === 'operation').args[0], original.key);
});
check('Web approval: committed receipt then failed follow-up remains committed and recovers read-only', async () => {
  const f = webFixture(); f.handlers.approvals = async () => { throw new Error('projection read failed after commit'); };
  await f.purpose(); await f.click('申请企业批准'); assert.equal(f.pending()?.state, 'committed');
  delete f.handlers.approvals; await f.click('核对原批准与提交结果');
  assert.equal(f.count('command'), 1); assert.equal(f.count('operation'), 0, 'committed reference need not be rewritten'); assert.equal(f.pending(), null);
});
check('Web approval: executing approval + not_observed result retains original request', async () => {
  const f = webFixture(); f.handlers.command = async () => { throw new Error('lost response'); };
  await f.purpose(); await f.click('申请企业批准'); const original = f.pending();
  f.rows = [approval('executing')]; f.result = { approval: approval('executing'), original: { state: 'not_observed', orderId: null, retryable: false } };
  await f.click('核对原批准与提交结果');
  assert.ok(f.pending()?.key === original.key, 'executing is unresolved, not permission to clear the durable original');
  assert.equal(f.count('command'), 1); assert.equal(f.orders.length, 0);
});
check('Web explicit submit: lost response; executing/not_observed preserved; observed original resolves without POST', async () => {
  const f = webFixture(); f.rows = [approval('approved')]; await f.purpose(); await f.click('核对原批准与提交结果'); await f.check();
  f.handlers.command = async () => { throw new Error('lost submit response'); }; await f.click('核对后提交');
  const original = f.pending(); assert.equal(original.kind, 'submit');
  f.result = { approval: approval('executing'), original: { state: 'not_observed', orderId: null, retryable: false } };
  await f.click('核对原批准与提交结果'); assert.equal(f.pending().key, original.key); assert.equal(f.pending().state, 'committed');
  f.result = { approval: approval('consumed'), original: { state: 'observed', orderId: 'order-1' } };
  await f.click('核对原批准与提交结果'); assert.equal(f.count('command'), 1); assert.deepEqual(f.orders, ['order-1']); assert.equal(f.pending(), null);
});
check('Web sealed execution: only the matching server terminal releases request/submit, never creates or navigates, and re-quote is explicit', async () => {
  for (const kind of ['request', 'submit']) {
    const f = webFixture(); let requotes = 0; f.props.onNewQuote = () => { requotes++; }; f.remount();
    await f.purpose();
    if (kind === 'submit') { f.rows = [approval('approved')]; await f.click('核对原批准与提交结果'); await f.check(); }
    f.handlers.command = async () => { throw new Error('lost original response'); };
    await f.click(kind === 'request' ? '申请企业批准' : '核对后提交'); const original = f.pending();
    f.rows = [approval('closed')];
    f.result = { approval: approval('closed'), original: { state: 'not_observed', orderId: null, retryable: false }, retryable: false };
    await f.click('核对原批准与提交结果'); assert.equal(f.pending().key, original.key, 'list state/absence is not a seal');
    f.result = { approval: approval('closed', 'wrong-quote'), original: { state: 'closed', retryable: false }, retryable: false };
    await f.click('核对原批准与提交结果'); assert.equal(f.pending().key, original.key, 'foreign terminal cannot release original');
    f.result = { approval: approval('closed'), original: { state: 'closed', retryable: false }, retryable: false };
    await f.click('核对原批准与提交结果'); assert.equal(f.pending(), null); assert.equal(f.orders.length, 0); assert.equal(f.count('command'), 1); assert.equal(requotes, 0);
    assert.ok(text(f.hooks.value).includes('新申请须重新报价'));
    await f.click('重新获取报价'); assert.equal(requotes, 1); assert.equal(f.count('command'), 1, 'new quote callback does not repeat enterprise command');
  }
});
check('Web approval: unmount and customer generation change isolate late write responses and keep opaque original', async () => {
  for (const action of ['unmount', 'identity']) {
    const f = webFixture(), gate = deferred(); f.handlers.command = () => gate.promise;
    await f.purpose(); await f.click('申请企业批准'); const before = [...f.storage.entries()];
    if (action === 'unmount') f.hooks.unmount(); else f.changeIdentity();
    gate.resolve({ orderId: 'late-order' }); await f.hooks.settle();
    assert.deepEqual([...f.storage.entries()], before, action); assert.equal(f.orders.length, 0, action); assert.equal(f.count('command'), 1);
  }
});
check('Web regular enterprise hook: durable reference then one POST; even success reads original rather than trusting HTTP order', async () => {
  const f = webFixture('order'); assert.equal(f.hooks.value.ready, true); await f.hooks.value.submit('q1'); f.hooks.flush();
  assert.equal(f.count('createOrder'), 1); assert.equal(f.count('orderOriginal'), 1); assert.deepEqual(f.orders, ['order-1']); assert.equal(f.pending(), null);
  const post = f.calls.find(c => c.name === 'createOrder'), read = f.calls.find(c => c.name === 'orderOriginal');
  assert.deepEqual(post.args[0], { quoteId: 'q1' }); assert.deepEqual(read.args, ['q1', post.args[1]]);
});
check('Web regular enterprise hook: storage failure zero dispatch; lost response/remount/not_observed never replay POST', async () => {
  for (const mode of ['throw', 'drop']) {
    const f = webFixture('order'); f.storageMode = mode; await assert.rejects(f.hooks.value.submit('q1')); assert.equal(f.count('createOrder'), 0, mode);
  }
  const f = webFixture('order'); f.handlers.createOrder = async () => { throw new Error('POST response lost'); };
  await assert.rejects(f.hooks.value.submit('q1')); const original = f.pending(); f.remount();
  f.orderResult = { state: 'not_observed', orderId: null, retryable: false }; await f.hooks.value.recover(); f.hooks.flush();
  assert.deepEqual(f.pending(), original); await assert.rejects(f.hooks.value.submit('q2')); assert.equal(f.count('createOrder'), 1);
  f.orderResult = { state: 'observed', orderId: 'order-1' }; await f.hooks.value.recover(); f.hooks.flush();
  assert.equal(f.count('createOrder'), 1); assert.deepEqual(f.orders, ['order-1']); assert.equal(f.pending(), null);
});
check('Web regular enterprise hook: commit then failed read remains read-only; unmount/identity late result cannot publish', async () => {
  const committed = webFixture('order'); committed.handlers.orderOriginal = async () => { throw new Error('read failed after POST commit'); };
  await assert.rejects(committed.hooks.value.submit('q1')); assert.ok(committed.pending());
  delete committed.handlers.orderOriginal; await committed.hooks.value.recover(); assert.equal(committed.count('createOrder'), 1); assert.deepEqual(committed.orders, ['order-1']);
  for (const action of ['unmount', 'identity']) {
    const f = webFixture('order'), gate = deferred(); f.handlers.orderOriginal = () => gate.promise;
    const promise = f.hooks.value.submit('q1'); const rejection = assert.rejects(promise, /身份|空间/); await f.hooks.settle();
    const before = [...f.storage.entries()]; if (action === 'unmount') f.hooks.unmount(); else f.changeIdentity();
    gate.resolve({ state: 'observed', orderId: 'late-order' }); await rejection; await f.hooks.settle();
    assert.deepEqual([...f.storage.entries()], before, action); assert.equal(f.orders.length, 0, action);
  }
});
check('Mini original methods: request/approved view do not create order; modal cancel blocks; explicit submit reads original', async () => {
  const f = miniFixture(), p = f.page; await p.onEnterpriseApproval();
  assert.equal(f.countPost(), 1); assert.equal(f.redirects.length, 0); assert.equal(p.data.enterpriseApproval.state, 'pending'); assert.equal(f.operation(), undefined);
  f.rows = [approval('approved')]; await p.onReadEnterpriseApproval(); f.confirm = false; await p.onSubmit(); assert.equal(f.countPost(), 1);
  f.confirm = true; await p.onSubmit(); assert.equal(f.countPost(), 2); assert.equal(f.redirects.length, 1); assert.equal(f.operation(), undefined);
  const posts = f.calls.filter(c => c.name === 'api' && c.options.method === 'POST');
  assert.equal(posts[1].url, '/enterprise/approvals/submit'); assert.equal(posts[1].options.data.confirm, true);
  assert.notEqual(posts[0].options.data.operationKey, posts[1].options.data.operationKey);
  for (const post of posts) assert.equal(post.options.replayAfterRefresh, false);
});
check('Mini request/explicit submit/waived order: throwing or silently dropped storage means zero POST', async () => {
  for (const mode of ['throw', 'drop']) for (const kind of ['request', 'submit', 'order']) {
    const f = miniFixture(); f.storageMode = mode; f.page.data.enterpriseApproval = approval('approved');
    if (kind === 'request') await f.page.onEnterpriseApproval();
    else if (kind === 'submit') await f.page.onSubmitEnterpriseApproval();
    else await f.page.submitEnterpriseOrder('q1');
    assert.equal(f.countPost(), 0, `${mode}/${kind}`); assert.ok(f.page.data.enterpriseError, `${mode}/${kind}: visible failure`);
  }
});
check('Mini request: lost response/remount/not_recorded keeps original; committed then failed read recovers read-only', async () => {
  const f = miniFixture(); f.handlers['/enterprise/approvals'] = async () => { throw new Error('request response lost'); };
  await f.page.onEnterpriseApproval(); const original = f.operation(); assert.ok(original?.key); await f.remount();
  f.receipt = { state: 'not_recorded' }; await f.page.onReadEnterpriseApproval(); assert.equal(f.operation().key, original.key);
  await f.page.onEnterpriseApproval(); assert.equal(f.countPost(), 1);
  f.receipt = { state: 'committed', result: { id: 'approval-q1' } };
  f.handlers['/enterprise/my-approvals'] = async () => { throw new Error('read failed after commit'); };
  await f.page.onReadEnterpriseApproval(); assert.equal(f.operation().key, original.key);
  delete f.handlers['/enterprise/my-approvals']; await f.page.onReadEnterpriseApproval(); assert.equal(f.operation(), undefined); assert.equal(f.countPost(), 1);
});
check('Mini request and submit: executing/not_observed never clear original or dispatch; observed resolves through result reader', async () => {
  for (const kind of ['request', 'submit']) {
    const f = miniFixture(); f.seedOperation(kind); f.rows = [approval('executing')];
    f.result = { approval: approval('executing'), original: { state: 'not_observed', orderId: null, retryable: false } };
    await f.page.onReadEnterpriseApproval(); assert.equal(f.operation().key, 'original-key', kind); assert.equal(f.redirects.length, 0);
    await f.page.onSubmitEnterpriseApproval(); assert.equal(f.countPost(), 0);
    f.result = { approval: approval('consumed'), original: { state: 'observed', orderId: 'order-1' } };
    await f.page.onReadEnterpriseApproval(); assert.equal(f.operation(), undefined, kind); assert.equal(f.redirects.length, 1); assert.equal(f.countPost(), 0);
  }
});
check('Mini sealed execution: exact server terminal clears only the operation, preserves cart, and never retries or re-quotes automatically', async () => {
  for (const kind of ['request', 'submit']) {
    const f = miniFixture(); f.seedOperation(kind); f.rows = [approval('closed')];
    f.result = { approval: approval('closed'), original: { state: 'not_observed', orderId: null, retryable: false }, retryable: false };
    await f.page.onReadEnterpriseApproval(); assert.equal(f.operation().key, 'original-key');
    f.result = { approval: approval('closed', 'wrong-quote'), original: { state: 'closed', retryable: false }, retryable: false };
    await f.page.onReadEnterpriseApproval(); assert.equal(f.operation().key, 'original-key');
    f.result = { approval: approval('closed'), original: { state: 'closed', retryable: false }, retryable: false };
    await f.page.onReadEnterpriseApproval(); assert.equal(f.operation(), undefined); assert.equal(f.page.data.enterpriseApproval.state, 'closed');
    assert.equal(f.cart.getCart().quote.id, 'q1'); assert.equal(f.redirects.length, 0); assert.equal(f.countPost(), 0); assert.equal(f.page.data.agreed, false);
    await f.page.onEnterpriseApproval(); await f.page.onSubmitEnterpriseApproval(); assert.equal(f.countPost(), 0, 'closed quote/approval cannot be reused');
    assert.ok(f.page.data.enterpriseError.includes('新的批准'));
  }
});
check('Mini waived mode: actual onSubmit calls no-replay POST; lost response + onRecover only reads original', async () => {
  const f = miniFixture(); f.page.data.quote.membershipSnapshot.enterpriseBasis.approvalMode = 'waived';
  f.handlers['/orders'] = async () => { throw new Error('order response lost after commit'); }; await f.page.onSubmit();
  const original = f.operation(); assert.equal(original.kind, 'order'); assert.equal(f.countPost(), 1);
  const post = f.calls.find(c => c.name === 'api' && c.url === '/orders'); assert.equal(post.options.replayAfterRefresh, false); assert.equal(post.options.idempotencyKey, original.key);
  f.orderResult = { state: 'not_observed', orderId: null, retryable: false }; await f.remount(); await f.page.onRecover();
  assert.equal(f.operation().key, original.key); await f.page.onSubmit(); assert.equal(f.countPost(), 1);
  f.orderResult = { state: 'observed', orderId: 'order-1' }; await f.page.onRecover(); assert.equal(f.countPost(), 1); assert.equal(f.operation(), undefined); assert.equal(f.redirects.length, 1);
});
check('Mini original request/result: hide/show epoch, unload and identity changes isolate delayed projections', async () => {
  for (const action of ['hide-show', 'unload', 'identity']) {
    const f = miniFixture(); f.seedOperation('submit'); const gate = deferred(); f.handlers['/enterprise/approvals/approval-q1/result'] = () => gate.promise;
    const reading = f.page.onReadEnterpriseApproval(); for (let n = 0; n < 12; n++) await Promise.resolve();
    assert.ok(f.calls.some(c => c.name === 'api' && c.url.endsWith('/result')), action);
    if (action === 'hide-show') { f.page.onHide(); f.page.onShow(); for (let n = 0; n < 24; n++) await Promise.resolve(); }
    else if (action === 'unload') f.page.onUnload(); else f.changeIdentity();
    const before = [...f.storage.entries()].map(plain), patchCount = f.page.patches.length;
    gate.resolve({ approval: approval('consumed'), original: { state: 'observed', orderId: 'late-order' } }); await reading;
    assert.deepEqual([...f.storage.entries()].map(plain), before, action); assert.equal(f.redirects.length, 0, action);
    assert.equal(f.page.patches.length, patchCount, `${action}: no late setData`); assert.equal(f.countPost(), 0);
  }
});
check('Mini POST response: hidden/unloaded/changed owner cannot refresh, clear or navigate late result', async () => {
  for (const action of ['hide', 'unload', 'identity']) {
    const f = miniFixture(), gate = deferred(); f.handlers['/enterprise/approvals'] = () => gate.promise;
    const writing = f.page.onEnterpriseApproval(); assert.equal(f.countPost(), 1); const before = [...f.storage.entries()].map(plain);
    if (action === 'hide') f.page.onHide(); else if (action === 'unload') f.page.onUnload(); else f.changeIdentity();
    const reads = f.countRead(), patches = f.page.patches.length; gate.resolve({ id: 'approval-q1' }); await writing;
    assert.equal(f.countRead(), reads, action); assert.equal(f.page.patches.length, patches, action); assert.equal(f.redirects.length, 0);
    assert.deepEqual([...f.storage.entries()].map(plain), before, action);
  }
});
check('Mini legacy enterprise cart: explicit onRecover migrates original key and performs GET only', async () => {
  const f = miniFixture(); f.cart.getCart().submission = { key: 'legacy-key', quoteId: 'q1', status: 'unknown', startedAt: 1 };
  f.orderResult = { state: 'not_observed', orderId: null, retryable: false }; await f.page.onRecover();
  assert.equal(f.operation().key, 'legacy-key'); assert.equal(f.countPost(), 0); assert.equal(f.calls.filter(c => c.name === 'legacyOrder').length, 0);
});
check('Mini legacy enterprise cart: page preparation must not automatically POST-replay unknown enterprise submission', async () => {
  const f = miniFixture(); f.cart.getCart().submission = { key: 'legacy-key', quoteId: 'q1', status: 'unknown', startedAt: 1 };
  f.orderResult = { state: 'not_observed', orderId: null, retryable: false }; await f.page.prepare();
  assert.equal(f.calls.filter(c => c.name === 'legacyOrder').length, 0, 'prepare must route enterprise original lookup, never legacy submit(true)');
  assert.equal(f.countPost(), 0); assert.equal(f.redirects.length, 0);
});

// Service dependencies are read-only substitutes; original public reader AND
// private assertClientOrder/clientOwnsOrder execute, with actual ALS ownership.
const common = { Injectable: () => value => value, Optional: () => () => {} };
for (const [name, status] of [['BadRequestException', 400], ['ConflictException', 409], ['ForbiddenException', 403], ['NotFoundException', 404],
  ['ServiceUnavailableException', 503], ['UnauthorizedException', 401]]) common[name] = class extends Error {
  constructor(message) { super(typeof message === 'string' ? message : JSON.stringify(message)); this.status = status; }
};
check('Handoff material smoke: original own DB/Core snapshot and relationship basis, legacy/partial subjects, current scope and late UI isolation never create a request or grant', async () => {
  const identity = load('apps/api/src/common/request-identity.ts',{'@nestjs/common':common});
  const dependencies = {'@nestjs/common':common,'@rental-os/shared':{},'@prisma/client':{Prisma:{}},'../../common/request-identity':identity,'../rental-core/rental-idempotency.repository':{requestFingerprint:forbidden('no fingerprint')},'../rental-core/rental-inspection-customer-response':{validateInspectionCustomerResponse:forbidden('no inspection')}};
  for(const name of ['../ai-native/business-events/prisma-business-failure-outbox','../database/prisma.service','../platform/membership.service','../rental-core/rental-core.service','../rental-core/rental-category-resolver.service','../rental-core/rental-business.service','../rental-core/rental-order-confirmation.service','../rental-core/rental-idempotent-action.service','../rental-core/rental-funding.service','../rental-core/rental-service-capacity.service','../integrations/tenant-integration.service','../integrations/payment.runtime.service','../integrations/file-storage.runtime.service','./client-auth.service','../rental-core/rental-document.service','../platform/customer-corporate-settlement.service','./client-delivery-address.service','./client-wechat-auth.service'])dependencies[name]={};
  const {ClientApiService}=load('apps/api/src/modules/client/client-api.service.ts',dependencies);
  const setup=()=>{const f={calls:[]},snapshot={bookingIdentity:'enterprise_employee',personalCustomerId:'p1',corporateCustomerId:'company',corporateMembershipId:'original-relation',enterpriseContractAndPayer:true,resolvedAt:'2026-11-01T00:00:00.000Z',enterpriseBasis:{membershipUpdatedAt:'2026-10-31T00:00:00.000Z'},personalCustomerName:'must-not-render',qualifications:['must-not-render']};f.context={tenantId:'t1',workspaceId:'w1',workspaceCode:'service-1',customerId:'p1',customerType:'personal',membershipStatus:'suspended'};f.scope={tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false};f.row={id:'order-1',tenantId:'t1',workspaceId:'w1',customerId:'p1',orderNo:'Original rental',status:'renting',updatedAt:new Date('2026-11-02T00:00:00.000Z'),membershipSnapshot:snapshot,contractSubjectCustomerId:'company',payerSubjectCustomerId:'company',userSubjectCustomerId:'p1'};f.coreOrder={...f.row,updatedAt:f.row.updatedAt.toISOString()};const db={rentalOrder:{findFirst:async query=>{f.calls.push(plain(query));f.afterDb?.();return f.row;}},$transaction:forbidden('read does not write')},core={getOrder:async()=>f.coreOrder,persist:forbidden('no persist')};f.service=new ClientApiService(db,{}, {},core,{}, {},{}, {},{}, {},{}, {},{});f.read=scope=>identity.runWithRequestIdentity(scope??f.scope,()=>f.service.rentalHandoffMaterial(f.context,'order-1'));return f;};
  const normal=setup();normal.row.status='RENTING';const material=await normal.read();assert.deepEqual(normal.calls[0].where,{tenantId:'t1',workspaceId:'w1',id:'order-1'});assert.equal(material.corporateMembershipId,'original-relation');assert.deepEqual(plain(material.subjects),{contract:'corporate',payer:'corporate',user:'self'});assert.equal(JSON.stringify(material).includes('must-not-render'),false);assert.equal(material.readOnly,true);
  const legacy=setup();for(const field of ['contractSubjectCustomerId','payerSubjectCustomerId','userSubjectCustomerId']){legacy.row[field]=null;legacy.coreOrder[field]=undefined;}delete legacy.row.membershipSnapshot.enterpriseBasis;const prior=await legacy.read();assert.equal(prior.subjectBasis,'legacy_customer_fallback');assert.equal(prior.membershipUpdatedAt,null);assert.deepEqual(plain(prior.subjects),{contract:'personal',payer:'personal',user:'self'});
  const other=setup();other.row.payerSubjectCustomerId='p2';other.coreOrder.payerSubjectCustomerId='p2';const safe=await other.read();assert.equal(safe.subjects.payer,'unavailable');assert.equal(JSON.stringify(safe).includes('p2'),false);
  const missing=setup();delete missing.row.membershipSnapshot.corporateMembershipId;await assert.rejects(missing.read(),error=>error.status===409);
  const changed=setup();changed.coreOrder.updatedAt='2026-11-03T00:00:00.000Z';await assert.rejects(changed.read(),error=>error.status===409);
  const wrong=setup();wrong.row.customerId='p2';wrong.row.membershipSnapshot.personalCustomerId='p2';await assert.rejects(wrong.read(),error=>error.status===404);
  const badScope=setup();for(const patch of [{workspaceId:'w2'},{tenantId:'t2'},{userId:'p2'},{isSaasAdmin:true},{staffApi:true},{dataScope:'all'}])await assert.rejects(badScope.read({...badScope.scope,...patch}),error=>error.status===403);assert.equal(badScope.calls.length,0);
  const lateScope=setup();lateScope.afterDb=()=>{lateScope.context.workspaceCode='another-service';};await assert.rejects(lateScope.read(),error=>error.status===403);
  const ui=()=>{const hooks=reactHost(),f={hooks,reads:[],props:{orderId:'order-1',english:true}};f.context={identity:'owner',tenantCode:'merchant',loading:false,session:{customer:{customerId:'p1',customerType:'personal'},workspace:{workspaceCode:'service-1'}},signal:new AbortController().signal,read:async path=>{f.reads.push(path);return f.handler?f.handler():material;},write:forbidden('material never writes'),reload:forbidden('material never grants')};const page=load('apps/enterprise-portal/src/RentalHandoffMaterial.tsx',{react:hooks.runtime,'react/jsx-runtime':hooks.jsx,'./enterprise-session':{useEnterprise:()=>f.context},'./original-workflow-operation':{useOriginalWorkflowOperation:()=>({blocked:false,assertCurrent(){},run:forbidden('reading never submits')})},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',ConfirmAction:'confirm',Input:{TextArea:'textarea'}}},{AbortController,AbortSignal});hooks.mount(()=>page.EnterpriseRentalHandoffMaterialReview(f.props));f.read=()=>nodes(hooks.value).find(node=>node.type==='action').props.onAction();f.dispose=()=>hooks.unmount();return f;};
  const view=ui();assert.equal(view.reads.length,0);await view.read();view.hooks.flush();assert.deepEqual(view.reads,['/orders/order-1/enterprise-handoff-material']);assert.ok(text(view.hooks.value).includes('original-relation'));assert.equal(text(view.hooks.value).includes('must-not-render'),false);view.dispose();
  const late=ui(),pending=deferred();late.handler=()=>pending.promise;const reading=late.read();late.props.orderId='order-2';late.hooks.rerender();pending.resolve(material);await assert.rejects(reading);assert.equal(text(late.hooks.value).includes('original-relation'),false);late.dispose();
});

check('Handoff request smoke: explicit frozen confirmation, same self scope and exact original-K recovery without current material or enterprise selection', async () => {
  const material = { orderId:'order-1',orderNo:'Original rental',orderUpdatedAt:'2026-11-02T00:00:00.000Z',workspaceCode:'s1',corporateCustomerId:'old-company',corporateMembershipId:'old-relation',membershipResolvedAt:'2026-11-01T00:00:00.000Z',membershipUpdatedAt:null,enterpriseContractAndPayer:true,subjects:{contract:'corporate',payer:'corporate',user:'self'},subjectBasis:'recorded_columns',scope:'current_workspace_original_own_order',readOnly:true };
  const created = {id:'handoff-1',orderId:'order-1',state:'pending',revision:1,effect:'request_only_no_business_change'};
  const setup = () => {
    const f=transferConsumerFixture(true); f.context.session.customer.customerType='personal';
    const h=reactHost(),gate=f.makeGate(h.runtime);f.props={orderId:'order-1',english:true};f.material=plain(material);
    const page=load('apps/enterprise-portal/src/RentalHandoffMaterial.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>f.context},'./original-workflow-operation':gate,'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',ConfirmAction:'confirm',Input:{TextArea:'textarea'}}},{AbortController,AbortSignal});
    f.readHandler=async path=>path.endsWith('/enterprise-handoff-material')?plain(f.material):plain(f.receipt);f.writeHandler=async()=>plain(created);
    f.mount=()=>h.mount(()=>page.EnterpriseRentalHandoffMaterialReview(f.props));f.mount();f.handoff=h;
    f.button=label=>{const node=nodes(h.value).find(n=>n.props.label===label);assert.ok(node,label);return node;};
    f.read=()=>f.button('Read original enterprise and responsibility basis').props.onAction();
    f.reason=value=>h.act(()=>nodes(h.value).find(n=>n.props.id==='enterprise-rental-handoff-reason').props.onChange({target:{value}}));
    f.prepare=async()=>{await f.read();await f.reason('  Original handoff reason  ');const b=f.button('Submit handoff request');b.props.onStateChange('confirming');return b;};
    f.pending=()=>[...f.storage.entries()].find(([key])=>key.includes('rental-handoff'));
    const dispose=f.dispose;f.dispose=()=>{h.unmount();dispose();};return f;
  };
  const normal=setup();assert.equal(normal.reads.length,0);const submit=await normal.prepare();assert.equal(normal.commands.length,0);await submit.props.onConfirm();assert.equal(normal.commands.length,1);assert.equal(normal.commands[0].path,'/enterprise/orders/order-1/handoff-requests');assert.equal(normal.commands[0].input.materialKey,JSON.stringify(material));assert.equal(normal.commands[0].input.reason,'Original handoff reason');assert.equal(normal.pending(),undefined);normal.dispose();
  for(const change of [async f=>f.reason('Changed reason'),async f=>{f.material.orderUpdatedAt='2026-11-03T00:00:00.000Z';},async f=>{f.props.orderId='order-2';f.handoff.rerender();}]){const f=setup(),button=await f.prepare();await change(f);await assert.rejects(button.props.onConfirm());assert.equal(f.commands.length,0);assert.equal(f.pending(),undefined);f.dispose();}
  const lost=setup(),button=await lost.prepare();lost.writeHandler=async()=>{throw new Error('response unknown');};await assert.rejects(button.props.onConfirm());const original=lost.pending();assert.ok(original);const reference=JSON.parse(original[1]);assert.deepEqual(Object.keys(reference).sort(),['key','path','state']);assert.equal(original[1].includes('reason'),false);
  lost.handoff.unmount();lost.context.selectedCorporateId='';lost.context.identity+='-login';lost.generation+='-login';lost.props.orderId='';lost.mount();lost.receipt={state:'not_recorded'};let recovery=lost.button('Read original handoff creation');await assert.rejects(recovery.props.onAction());assert.equal(lost.pending()[1],original[1]);
  lost.receipt={state:'committed',result:{...created,orderId:'foreign'}};await assert.rejects(lost.button('Read original handoff creation').props.onAction());assert.equal(lost.pending()[1],original[1]);
  lost.receipt={state:'committed',result:created};await lost.button('Read original handoff creation').props.onAction();assert.equal(lost.pending(),undefined);assert.equal(lost.commands.length,1);assert.equal(lost.context.selectedCorporateId,'');assert.ok(lost.reads.at(-1).endsWith(`/orders/order-1/handoff-requests/create-operations/${reference.key}`));lost.dispose();
  const local=setup();local.props.orderId='';const key='rental-os:enterprise-workflow:'+JSON.stringify(['rental-handoff','merchant','recipient','s1','']);local.storage.set(key,JSON.stringify({key:'local-K',path:'/enterprise/orders/order-1/handoff-requests',state:'committed'}));local.handoff.rerender();local.receipt={state:'committed',result:created};await local.button('Read original handoff creation').props.onAction();assert.equal(local.commands.length,0);assert.ok(local.reads.at(-1).endsWith('/create-operations/local-K'));local.dispose();
});

check('ClientApiService original reader: actual ALS and private ownership, scoped DB/Core reads, missing/unknown/foreign fail closed', async () => {
  const identity = load('apps/api/src/common/request-identity.ts', { '@nestjs/common': common });
  const dependencies = { '@nestjs/common': common, '@rental-os/shared': {}, '@prisma/client': { Prisma: {} }, '../../common/request-identity': identity,
    '../rental-core/rental-idempotency.repository': { requestFingerprint: forbidden('new fingerprint') },
    '../rental-core/rental-inspection-customer-response': { validateInspectionCustomerResponse: forbidden('inspection') } };
  for (const name of ['../ai-native/business-events/prisma-business-failure-outbox', '../database/prisma.service', '../platform/membership.service',
    '../rental-core/rental-core.service', '../rental-core/rental-category-resolver.service', '../rental-core/rental-business.service',
    '../rental-core/rental-order-confirmation.service', '../rental-core/rental-idempotent-action.service', '../rental-core/rental-funding.service',
    '../rental-core/rental-service-capacity.service', '../integrations/tenant-integration.service', '../integrations/payment.runtime.service',
    '../integrations/file-storage.runtime.service', './client-auth.service', '../rental-core/rental-document.service',
    '../platform/customer-corporate-settlement.service', './client-delivery-address.service', './client-wechat-auth.service']) dependencies[name] = {};
  const { ClientApiService } = load('apps/api/src/modules/client/client-api.service.ts', dependencies);
  const context = { tenantId: 't1', workspaceId: 'w1', customerId: 'p1', customerType: 'personal', membershipStatus: 'active' };
  const customerIdentity = { tenantId: 't1', workspaceId: 'w1', userId: 'p1', isSaasAdmin: false };
  let hit = { orderId: 'order-1' }, persisted = { id: 'order-1', quoteId: 'q1', customerId: 'company', membershipSnapshot: { bookingIdentity: 'enterprise_employee', personalCustomerId: 'p1' } };
  let coreOrder = { ...persisted, tenantId: 't1' }; const reads = [];
  const prisma = { rentalOrderIdempotencyRecord: { findFirst: async query => { reads.push({ name: 'receipt', query: plain(query) }); return plain(hit); } },
    rentalOrder: { findFirst: async query => { reads.push({ name: 'persisted', query: plain(query) }); return plain(persisted); } }, $transaction: forbidden('DB transaction') };
  const core = { getOrder: async (...args) => { reads.push({ name: 'core', args }); return plain(coreOrder); }, createOrder: forbidden('Core write'), persist: forbidden('Core persist') };
  const service = new ClientApiService(prisma, {}, {}, core, {}, {}, {}, {}, {}, {}, {}, {}, {});
  const read = (scope = customerIdentity, quoteId = 'q1') => identity.runWithRequestIdentity(scope, () => service.readEnterpriseOrderOriginal(context, quoteId, 'original-key'));
  assert.deepEqual(plain(await read()), { state: 'observed', orderId: 'order-1', retryable: false });
  assert.deepEqual(reads[0].query.where, { tenantId: 't1', workspaceId: 'w1', action: 'rental.order.create', idempotencyKey: 'original-key' });
  assert.deepEqual(reads[1].query.where, { tenantId: 't1', workspaceId: 'w1', id: 'order-1' }); assert.deepEqual(reads[2].args, ['t1', 'order-1']);
  hit = null; assert.deepEqual(plain(await read()), { state: 'not_observed', orderId: null, retryable: false });
  hit = { orderId: null }; assert.deepEqual(plain(await read()), { state: 'unknown', orderId: null, retryable: false }); hit = { orderId: 'order-1' };
  await assert.rejects(read(customerIdentity, 'other-quote'), e => e.status === 404);
  persisted.membershipSnapshot.personalCustomerId = 'p2'; await assert.rejects(read(), e => e.status === 404); persisted.membershipSnapshot.personalCustomerId = 'p1';
  coreOrder = { ...coreOrder, customerId: 'p2', membershipSnapshot: { personalCustomerId: 'p2' } }; await assert.rejects(read(), e => e.status === 404);
  const before = reads.length;
  for (const extra of [{ userId: 'p2' }, { tenantId: 't2' }, { workspaceId: 'w2' }, { staffApi: true }, { isSaasAdmin: true }, { dataScope: 'all' }]) {
    await assert.rejects(read({ ...customerIdentity, ...extra }), e => e.status === 403);
  }
  assert.equal(reads.length, before, 'invalid owner never reaches DB');
});

check('Authority upload: lost object response survives reload, never repeats PUT, and completion unknown stays read-only', async () => {
  const storage = new Map(), hooks = reactHost(), writes = [], files = [];
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  let puts = 0, completeLost = true, observation = { state: 'observed', session: { sessionId: 'session-1', mode: 'provider', status: 'pending_upload' }, file: { id: 'file-1', status: 'pending_upload' } };
  const context = { identity: 'owner', tenantCode: 'merchant', session: { customer: { customerId: 'p1' } }, signal: new AbortController().signal,
    read: async () => plain(observation), write: async (path, input) => {
      writes.push({ path, input });
      if (path.endsWith('upload-sessions')) return { sessionId: 'session-1', mode: 'provider', status: 'pending_upload', uploadUrl: 'https://objects.example/original' };
      if (completeLost) throw new Error('completion lost'); return { id: 'file-1', status: 'active' };
    } };
  const module = load('apps/enterprise-portal/src/AuthorityUpload.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@/components/ui/customer-entry': { ActionButton: 'button', Alert: 'alert', Button: 'button' }, './enterprise-session': { useEnterprise: () => context } },
    { localStorage, navigator: { locks: { request: (_name, fn) => fn() } }, crypto: { randomUUID: () => 'original-file-key' }, URL,
      fetch: async () => { puts++; throw new Error('object response lost'); } });
  const mount = () => hooks.mount(() => module.AuthorityUpload({ english: true, disabled: false, onFile: id => files.push(id), onBusy() {} }));
  const click = async label => { const button = nodes(hooks.value).find(node => node.type === 'button' && node.props.label === label); assert.ok(button, label); assert.equal(Boolean(button.props.disabled), false); await button.props.onAction(); hooks.flush(); };
  mount(); await hooks.act(() => nodes(hooks.value).find(node => node.type === 'input').props.onChange({ target: { files: [{ name: 'proof.pdf', type: 'application/pdf', size: 123 }] } }));
  await assert.rejects(click('Upload evidence')); assert.equal(puts, 1); assert.equal(writes.length, 1);
  assert.equal([...storage.values()][0].includes('objects.example'), false); assert.equal([...storage.values()][0].includes('proof.pdf'), false);
  hooks.unmount(); mount(); await click('Read original file result');
  await assert.rejects(click('Verify and archive the original object')); assert.equal(writes.length, 2); assert.equal(puts, 1);
  hooks.unmount(); mount(); await click('Read original file result');
  assert.equal(nodes(hooks.value).some(node => node.props.label === 'Verify and archive the original object'), false);
  assert.equal(writes.length, 2); assert.equal(files.length, 0);
  observation.session.status = 'completed'; observation.file.status = 'active'; await click('Read original file result');
  assert.deepEqual(files, ['file-1']); assert.equal(storage.size, 0); assert.equal(writes.length, 2); assert.equal(puts, 1);
});

check('Merchant workflow original survives reload/re-authentication with opaque references, fails closed on storage and coordinates independent realms', async () => {
  const hooks = reactHost(), storage = new Map(), writes = [], reads = [], events = emitter();
  let denied = false, epoch = 1;
  const auth = { sessionVerified: true, token: 'synthetic-token', tenant: { tenantId: 'merchant' }, currentWorkspaceId: 'w1', user: { id: 'operator', tenantId: 'merchant', permissions: ['*'], tenantMembership: {} }, hasTenantMembershipPermission: () => true };
  const useAuthStore = () => auth; useAuthStore.getState = () => auth; useAuthStore.subscribe = listener => events.on(listener);
  const localStorage = { getItem: key => { if (denied) throw new Error('storage denied'); return storage.get(key) ?? null; }, setItem: (key, value) => { if (denied) throw new Error('storage denied'); storage.set(key, value); }, removeItem: key => storage.delete(key) };
  let receipt = { state: 'not_recorded' };
  const locks = new Map(), navigator = { locks: { request: (key, fn) => { const running = (locks.get(key) ?? Promise.resolve()).then(fn); locks.set(key, running.catch(() => {})); return running; } } };
  const dependencies = { react: hooks.runtime, '@/features/auth/authStore': { useAuthStore }, '@/app/queryClient': { currentSessionEpoch: () => epoch, currentSessionSignal: () => new AbortController().signal },
    '@/api/http': { http: { request: async config => { if (config.method === 'get') { reads.push(config.url); return { data: { data: plain(receipt) } }; } writes.push(plain(config)); assert.equal(config._authRetry, true); throw new Error('original response lost'); } } } };
  const create = () => load('apps/admin/src/features/membership/original-enterprise-operation.ts', dependencies, { localStorage, navigator, AbortController, AbortSignal, crypto: { randomUUID: () => crypto.randomUUID() } });
  let module = create(); hooks.mount(() => module.useOriginalEnterpriseOperation());
  const command = () => ({ path: '/membership/enterprise-workflows/applications/application-1/decision', method: 'post', input: { reason: 'Private review proof', expectedRevision: 1, decision: 'approve' } });
  denied = true; await assert.rejects(hooks.value.run(command, async () => {})); assert.equal(writes.length, 0); denied = false;
  await assert.rejects(hooks.value.run(command, async () => {})); assert.equal(writes.length, 1); const raw = [...storage.values()][0];
  assert.equal(raw.includes('Private review'), false); assert.equal(raw.includes('synthetic-token'), false); assert.equal(raw.includes('body'), false);
  hooks.unmount(); epoch++; auth.token = 'synthetic-new-login'; module = create(); hooks.mount(() => module.useOriginalEnterpriseOperation());
  assert.equal(hooks.value.blocked, true); await assert.rejects(hooks.value.run(command, async () => {})); await assert.rejects(hooks.value.recover(async () => {})); assert.equal(storage.size, 1); assert.equal(writes.length, 1);
  receipt = { state: 'committed', result: { id: 'application-1' } }; await assert.rejects(hooks.value.recover(async () => {})); assert.equal(storage.size, 1);
  receipt = { state: 'committed', result: { id: 'application-1', state: 'approved', revision: 2, corporateCustomerId: 'company' } }; await hooks.value.recover(async () => {}); hooks.flush(); assert.equal(storage.size, 0); assert.equal(writes.length, 1);
  hooks.unmount(); const first = create(), second = create(); hooks.mount(() => [first.useOriginalEnterpriseOperation(), second.useOriginalEnterpriseOperation()]);
  await Promise.allSettled(hooks.value.map(operation => operation.run(command, async () => {}))); assert.equal(writes.length, 2); assert.equal(storage.size, 1);
  assert.equal(reads.length, 3);
  assert.ok(reads.every(value => /^\/membership\/enterprise-workflows\/applications\/application-1\/decision-operations\//u.test(value)));
  hooks.unmount(); storage.clear();
  for (const commandPath of ['/membership/corporate/company-1/enterprise-portal', '/membership/enterprise-portal/settings', '/membership/enterprise-workflows/corporates/company-1/policy']) {
    module = create(); hooks.mount(() => module.useOriginalEnterpriseOperation('portal-access:company-1', '/membership/enterprise-portal/operations'));
    const before = writes.length; receipt = { state: 'not_recorded' };
    await assert.rejects(hooks.value.run(() => ({ path: commandPath, method: 'put', input: { expectedRevision: 1, reason: 'reviewed' } }), async () => {}));
    assert.equal(writes.length, before + 1); hooks.unmount(); epoch++; module = create();
    hooks.mount(() => module.useOriginalEnterpriseOperation('portal-access:company-1', '/membership/enterprise-portal/operations'));
    assert.equal(hooks.value.blocked, true); await assert.rejects(hooks.value.recover(async () => {})); assert.equal(writes.length, before + 1);
    receipt = { state: 'committed', result: commandPath.endsWith('/policy') ? { corporateCustomerId: 'company-1', scopeKey: 'merchant', revision: 2 } : {} }; let recovered;
    await hooks.value.recover(async path => { recovered = path; }); assert.equal(recovered, commandPath); assert.equal(storage.size, 0); hooks.unmount();
  }
  module = create(); hooks.mount(() => module.useOriginalEnterpriseOperation());
  for (const unsafe of ['/membership/corporate/%2e%2e/enterprise-portal', '/membership/corporate/a%2fb/enterprise-portal', '/membership/enterprise-workflows/arbitrary', 'https://example.test/write']) {
    const before = writes.length;
    await assert.rejects(hooks.value.run(() => ({ path: unsafe, method: 'put', input: {} }), async () => {}));
    assert.equal(writes.length, before); assert.equal(storage.size, 0);
  }
});

check('Enterprise workflow helper: durable original reference survives reload/new login, excludes input and blocks storage failure dispatch', async () => {
  const storage = new Map(), writes = [], reads = []; let failStorage = false, identity = 'identity-1', generation = 'generation-1';
  const localStorage = { getItem(key) { if (failStorage) throw new Error('storage denied'); return storage.get(key) ?? null; }, setItem(key, value) { if (failStorage) throw new Error('storage denied'); storage.set(key, value); }, removeItem(key) { storage.delete(key); } };
  const context = () => ({ identity, tenantCode: 'merchant', session: { customer: { customerId: 'p1' }, workspace: { workspaceCode: 's1' } }, selectedCorporateId: 'company', signal: new AbortController().signal,
    async write(path, input) { writes.push({ path, input }); throw new Error('first response lost'); }, async read(path) { reads.push(path); return { state: 'not_recorded' }; } });
  let owner = context();
  const hooks = reactHost(), dependencies = { react: hooks.runtime, '@rental-os/web-client': { customerSessionGeneration: () => generation }, './enterprise-session': { useEnterprise: () => owner } };
  const locks = new Map(), navigator = { locks: { request: (name, fn) => { const result = (locks.get(name) ?? Promise.resolve()).then(fn); locks.set(name, result.catch(() => {})); return result; } } };
  const create = () => load('apps/enterprise-portal/src/original-workflow-operation.ts', dependencies, { localStorage, navigator, AbortSignal, crypto: { randomUUID: () => 'original-key' } });
  let module = create(); hooks.mount(() => module.useOriginalWorkflowOperation('applications'));
  const command = () => ({ path: '/enterprise/applications', input: { reason: 'Private representative proof', inviteCode: 'secret-code', expectedRevision: 0 } });
  failStorage = true; await assert.rejects(hooks.value.run(command, async () => {})); assert.equal(writes.length, 0); failStorage = false;
  await assert.rejects(hooks.value.run(command, async () => {})); hooks.flush(); assert.equal(writes.length, 1);
  const raw = [...storage.values()][0]; assert.equal(raw.includes('Private'), false); assert.equal(raw.includes('secret-code'), false); assert.equal(raw.includes('body'), false);
  hooks.unmount(); identity = 'identity-new-login'; generation = 'generation-new-login'; owner = context(); module = create(); hooks.mount(() => module.useOriginalWorkflowOperation('applications'));
  assert.equal(hooks.value.pending.key, 'original-key'); assert.equal(hooks.value.blocked, true);
  await assert.rejects(hooks.value.run(command, async () => {})); assert.equal(writes.length, 1);
  await assert.rejects(hooks.value.recover(async () => {})); assert.equal(storage.size, 1); assert.equal(reads.length, 1);
  owner.read = async path => { reads.push(path); return { state: 'committed', result: { id: 'original-application', state: 'draft', revision: 1 } }; };
  await hooks.value.recover(async () => {}); hooks.flush(); assert.equal(storage.size, 0); assert.equal(writes.length, 1);
  hooks.unmount(); const firstRealm = create(), secondRealm = create();
  hooks.mount(() => [firstRealm.useOriginalWorkflowOperation('invites'), secondRealm.useOriginalWorkflowOperation('invites')]);
  const [first, second] = hooks.value;
  const results = await Promise.allSettled([first.run(command, async () => {}), second.run(command, async () => {})]);
  assert.ok(results.every(result => result.status === 'rejected')); assert.equal(writes.length, 2, 'two independent realms dispatch one new original command only');
  assert.equal(storage.size, 1);
});

check('Enterprise approval review: one-row confirmation resets on original revision/quote changes and cannot submit unread rows', async () => {
  const hooks = reactHost(), commands = [], operation = {
    blocked: false, busy: false, assertCurrent() {}, read: forbidden('unexpected approval result'),
    async run(prepare, afterCommit) { const command = await prepare(); commands.push(plain(command)); await afterCommit({}); },
  };
  const dependencies = { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@/components/ui/customer-entry': { ActionButton: 'button', Alert: 'alert', Checkbox: 'checkbox', Input: { TextArea: 'textarea' } },
    './ApprovalReview': { EnterpriseApprovalReview: 'review' },
  };
  const module = load('apps/enterprise-portal/src/ApprovalDecision.tsx', dependencies);
  const review = load('apps/enterprise-portal/src/ApprovalReview.tsx', { 'react/jsx-runtime': hooks.jsx, '@rental-os/shared': { formatRentalMoney: forbidden('money in identity key') }, '@/components/ui/customer-entry': {} });
  let row = { ...approval('approved'), quote: { quoteNo: 'Q1' }, amount: '100', currency: 'CNY' };
  const props = () => ({ row, reviewMode: false, english: true, operation, closureOperation: operation, refresh: async () => {}, unavailable: false, canDecide: true });
  const mount = () => hooks.mount(() => module.EnterpriseApprovalDecision(props()));
  const button = () => nodes(hooks.value).find(node => node.type === 'button' && node.props.label === 'Explicitly submit this request');
  const tick = async () => hooks.act(() => nodes(hooks.value).find(node => node.type === 'checkbox').props.onChange({ target: { checked: true } }));
  const reason = async () => hooks.act(() => nodes(hooks.value).find(node => node.type === 'textarea').props.onChange({ target: { value: 'Reviewed this original request' } }));
  mount(); assert.equal(button().props.disabled, true); await reason(); assert.equal(button().props.disabled, true); await tick(); assert.equal(button().props.disabled, false);
  const before = review.approvalReviewKey('identity', row);
  for (const change of [{ id: 'approval-q2' }, { revision: 3 }, { quoteId: 'q2' }, { amount: '101' }, { quote: { quoteNo: 'changed' } }]) assert.notEqual(review.approvalReviewKey('identity', { ...row, ...change }), before);
  assert.notEqual(review.approvalReviewKey('new-identity', row), before);
  hooks.unmount(); row = { ...row, id: 'approval-q2', quoteId: 'q2', revision: 3 }; mount();
  assert.equal(button().props.disabled, true); await assert.rejects(button().props.onAction()); assert.equal(commands.length, 0);
  await reason(); await tick(); await button().props.onAction();
  assert.equal(commands.length, 1); assert.equal(commands[0].input.approvalId, 'approval-q2'); assert.equal(commands[0].input.expectedRevision, 3); assert.equal(commands[0].input.confirm, true);
  const page = fs.readFileSync(path.join(root, 'apps/enterprise-portal/src/ApprovalsPage.tsx'), 'utf8');
  assert.match(page, /key=\{approvalReviewKey\(`\$\{context.identity\}:\$\{mode\}`, review\)\}/);
  assert.doesNotMatch(page, /\[confirmed,/);
});

check('Management editor preserves the original reviewed object revision until explicit adoption, never silently rebases an unsaved proposal', async () => {
  const hooks = reactHost(), commands = [], values = {}, context = { identity: 'customer-company', selectedCorporateId: 'company', signal: new AbortController().signal,
    entry: { corporates: [{ corporateCustomerId: 'company', actions: ['requests:manage'] }] } };
  const profile = { corporateCustomerId: 'company', corporateName: 'Company', legalName: 'Current company', legalIdentifierMasked: null, registeredAddress: null, membershipStatus: 'active',
    profileRevision: 'current-r2', creditRevision: 1, merchantPolicyRevision: 1, requestTypes: ['profile_change'], unavailable: [] };
  const row = { id: 'request-1', corporateCustomerId: 'company', applicantCustomerId: 'p1', requestType: 'profile_change', state: 'draft', revision: 1, objectRevision: 'original-r1', proposal: { legalName: 'Proposed name' }, reason: 'Original reason', evidenceFileIds: [], decisionReason: null,
    effect: 'review_only_no_business_change', createdAt: '2026-11-05T10:00:00.001Z', updatedAt: '2026-11-05T10:00:00.002Z' };
  const form = { resetFields() { for (const key of Object.keys(values)) delete values[key]; }, setFieldsValue(next) { Object.assign(values, next); }, getFieldValue(key) { return values[key]; }, setFieldValue(key, value) { values[key] = value; }, validateFields: async () => ({ ...values }) };
  const operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('query substitute must not dispatch'),
    async run(prepare, afterCommit) { const command = await prepare(); commands.push(plain(command)); if (command.input.objectRevision !== profile.profileRevision) throw new Error('original object revision conflict'); await afterCommit({}); } };
  const query = data => ({ data, isFetching: false, refetch: async () => ({ data }) });
  const Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
  const module = load('apps/enterprise-portal/src/ManagementRequestsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: options => query(options.queryKey[0] === 'enterprise-profile' ? profile : [row]), useQueryClient: () => ({ setQueryData: forbidden('list editor does not overwrite detail feedback') }) }, 'react-router-dom': { Link: 'link', useLocation: () => ({ search: '' }) }, '@rental-os/web-client': load('packages/web-client/src/enterprise-entry.ts', {}),
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', ConfirmAction: 'confirm', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context },
    './original-workflow-operation': { useOriginalWorkflowOperation: () => operation }, './AuthorityUpload': { AuthorityUpload: 'upload' } });
  hooks.mount(() => module.EnterpriseManagementRequestsPage());
  const table = nodes(hooks.value).find(n => n.type === 'table'), actions = table.props.columns.find(c => c.title === 'Actions').render(null, row);
  await hooks.act(() => nodes(actions).find(n => n.type === 'button').props.onClick());
  const save = () => nodes(hooks.value).find(n => n.type === 'save' && n.props.label === 'Request merchant review');
  await assert.rejects(save().props.onSave(), /revision conflict/u); assert.equal(commands[0].input.objectRevision, 'original-r1'); assert.equal(values.legalName, 'Proposed name');
  const notice = nodes(hooks.value).find(n => n.type === 'alert' && n.props.action?.props.label === 'Use this reviewed current revision'); assert.ok(notice);
  await hooks.act(() => notice.props.action.props.onAction());
  profile.profileRevision = 'current-r3'; hooks.rerender();
  await assert.rejects(save().props.onSave(), /revision conflict/u); assert.equal(commands[1].input.objectRevision, 'current-r2');
  const updatedNotice = nodes(hooks.value).find(n => n.type === 'alert' && n.props.action?.props.label === 'Use this reviewed current revision');
  await hooks.act(() => updatedNotice.props.action.props.onAction()); await save().props.onSave();
  assert.equal(commands[2].input.objectRevision, 'current-r3'); assert.equal(commands[2].input.requestId, 'request-1'); assert.equal(commands[2].input.expectedRevision, 1);
});

function managementReviewFixture() {
  const f = memberRecoveryEntryFixture(), hooks = reactHost(); f.managementHooks = hooks; f.managementValues = {};
  f.context.entry.corporates[0].actions.push('requests:manage');
  f.managementProfile = { corporateCustomerId: 'company', corporateName: 'Company', legalName: 'Verified company', legalIdentifierMasked: null, registeredAddress: null, membershipStatus: 'active',
    profileRevision: 'original-r1', creditRevision: 1, merchantPolicyRevision: 1, requestTypes: ['profile_change', 'credit_change', 'scope_change'], unavailable: ['formal_bills', 'payment_proof', 'bill_dispute', 'contract_files'] };
  f.managementRow = { id: 'request-1', corporateCustomerId: 'company', applicantCustomerId: f.context.session.customer.customerId, requestType: 'profile_change', state: 'draft', revision: 1,
    objectRevision: 'original-r1', proposal: { legalName: 'Proposed company' }, evidenceFileIds: ['evidence-original'], reason: '  Original reason  ', decisionReason: null,
    effect: 'review_only_no_business_change', createdAt: '2026-11-05T10:00:00.001Z', updatedAt: '2026-11-05T10:00:00.002Z' };
  f.managementProfileQuery = { data: f.managementProfile, isFetching: false, refetch: async () => ({ data: f.managementProfile }) };
  f.managementListQuery = { data: [f.managementRow], isFetching: false, refetch: async () => ({ data: [f.managementRow] }) };
  const form = { resetFields() { f.managementValues = {}; }, setFieldsValue: next => Object.assign(f.managementValues, next), getFieldValue: key => f.managementValues[key], setFieldValue: (key, value) => { f.managementValues[key] = value; },
    validateFields: () => f.managementValidation ? f.managementValidation() : Promise.resolve(plain(f.managementValues)) };
  const Form = Object.assign('form', { useForm: () => [form], Item: 'field' }), gate = f.makeGate(hooks.runtime);
  const page = load('apps/enterprise-portal/src/ManagementRequestsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: options => options.queryKey[0] === 'enterprise-profile' ? f.managementProfileQuery : f.managementListQuery, useQueryClient: () => ({ setQueryData: (key, value) => { f.managementCachedKey = plain(key); f.managementCachedFeedback = plain(value); } }) }, 'react-router-dom': { Link: 'link', useLocation: () => ({ search: f.managementSearch ?? '' }) }, '@rental-os/web-client': load('packages/web-client/src/enterprise-entry.ts', {}),
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', ConfirmAction: 'confirm', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => f.context }, './AuthorityUpload': { AuthorityUpload: 'upload' },
    './original-workflow-operation': { useOriginalWorkflowOperation: scope => gate.useOriginalWorkflowOperation(scope) } });
  f.writeHandler = async (_path, input) => ({ id: input.requestId ?? 'new-request', state: input.submit ? 'pending' : 'draft', revision: input.expectedRevision + 1, effect: 'review_only_no_business_change' });
  hooks.mount(() => page.EnterpriseManagementRequestsPage());
  f.editManagement = () => hooks.act(() => {
    const table = nodes(hooks.value).find(node => node.type === 'table'), actions = table.props.columns.find(column => column.title === 'Actions').render(null, f.managementRow);
    nodes(actions).find(node => node.type === 'button').props.onClick();
  });
  f.saveManagement = (submit = true) => nodes(hooks.value).find(node => node.type === 'save' && node.props.label === (submit ? 'Request merchant review' : 'Save draft')).props.onSave();
  const dispose = f.dispose; f.dispose = () => { hooks.unmount(); dispose(); }; return f;
}
check('Management save freezes original row, full facts and copied evidence through async validation and original lock; stale material cannot create K, normal transformations remain review-only', async () => {
  const f = managementReviewFixture(); await f.editManagement();
  f.managementValues.evidence.push('evidence-added'); assert.deepEqual(f.managementRow.evidenceFileIds, ['evidence-original'], 'form attachments do not alias the original row');
  f.managementValues.legalName = '  Proposed name  '; await f.saveManagement(false);
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].path, '/enterprise/corporates/company/management-requests');
  assert.equal(f.commands[0].input.objectRevision, 'original-r1'); assert.equal(f.commands[0].input.expectedRevision, 1); assert.equal(f.commands[0].input.requestId, 'request-1');
  assert.equal(f.commands[0].input.reason, '  Original reason  '); assert.deepEqual(f.commands[0].input.proposal, { legalName: 'Proposed name' });
  assert.deepEqual(f.commands[0].input.evidenceFileIds, ['evidence-original', 'evidence-added']); assert.equal(f.commands[0].input.submit, false); assert.equal(f.storage.size, 0); f.dispose();
  for (const type of ['credit_change', 'scope_change']) {
    const normal = managementReviewFixture(); await normal.managementHooks.act(() => nodes(normal.managementHooks.value).find(node => node.type === 'select').props.onChange(type));
    Object.assign(normal.managementValues, type === 'credit_change' ? { requestedCreditLimit: '100.00', currency: 'CNY', reason: 'Ask original merchant', evidence: [] }
      : { workspaces: 'w1， w2\nw3', categories: 'vehicle, equipment', reason: 'Ask original merchant', evidence: [] });
    await normal.saveManagement(); assert.equal(normal.commands[0].input.requestType, type); assert.equal(normal.commands[0].input.objectRevision, '1');
    assert.equal(normal.commands[0].input.expectedRevision, 0); assert.equal(normal.commands[0].input.submit, true);
    assert.deepEqual(normal.commands[0].input.proposal, type === 'credit_change' ? { requestedCreditLimit: '100.00', currency: 'CNY' } : { workspaceIds: ['w1', 'w2', 'w3'], categoryCodes: ['vehicle', 'equipment'] }); normal.dispose();
  }
  const firstValidation = managementReviewFixture(); await firstValidation.editManagement();
  nodes(firstValidation.managementHooks.value).find(node => node.type === 'save' && node.props.label === 'Request merchant review').props.onClickCapture();
  firstValidation.managementValues.legalName = 'Changed while shared SaveButton validated'; await assert.rejects(firstValidation.saveManagement());
  assert.equal(firstValidation.commands.length, 0); assert.equal(firstValidation.storage.size, 0, 'click capture precedes shared SaveButton validation'); firstValidation.dispose();
  for (const change of ['row', 'facts', 'input', 'authority', 'upload']) {
    const stale = managementReviewFixture(); await stale.editManagement(); const frozen = plain(stale.managementValues), waiting = deferred(); stale.managementValidation = () => waiting.promise;
    const saving = stale.saveManagement(); await stale.managementHooks.settle();
    if (change === 'row') stale.managementRow.proposal.legalName = 'Changed original proposal at the same revision';
    if (change === 'facts') stale.managementProfile.legalName = 'Changed verified name at the same revision';
    if (change === 'input') stale.managementValues.evidence.push('late-evidence');
    if (change === 'authority') stale.context.entry.corporates[0].actions = [];
    if (change === 'upload') await stale.managementHooks.act(() => nodes(stale.managementHooks.value).find(node => node.type === 'upload').props.onBusy(true));
    waiting.resolve(frozen); await assert.rejects(saving); assert.equal(stale.commands.length, 0); assert.equal(stale.storage.size, 0, `${change}: refusal precedes opaque K`);
    assert.equal(stale.managementValues.reason, '  Original reason  '); stale.dispose();
  }
});

check('Management original saves use only the original enterprise/K GET, including local committed markers; loss of management preserves the same read-only slot without granting facts or replay', async () => {
  const f = managementReviewFixture(); await f.editManagement(); f.writeHandler = async () => { throw new Error('original save response lost'); };
  await assert.rejects(f.saveManagement()); f.managementHooks.flush(); const [key, raw] = [...f.storage][0];
  assert.equal(key, f.referenceKey('company', 'management-requests')); assert.deepEqual(JSON.parse(raw), { key: 'original-transfer-key', path: '/enterprise/corporates/company/management-requests', state: 'unknown' });
  assert.equal(raw.includes('proposal'), false); assert.equal(raw.includes('evidence'), false); assert.equal(raw.includes('reason'), false);
  const originalPath = '/enterprise/corporates/company/management-requests/save-operations/original-transfer-key';
  f.loseManagement(); f.managementHooks.rerender(); assert.ok(nodes(f.managementHooks.value).some(node => typeof node.type === 'function' && node.type.name === 'EnterpriseMemberOperationRecovery'));
  const foreign = f.referenceKey('company', 'management-requests', 'another-person'); f.storage.set(foreign, '{private-foreign-material'); f.forbiddenStorageKeys = new Set([foreign]);
  const recovery = f.mountRecovery(), read = () => recovery.button('Read original management request save').props.onAction();
  f.receipt = { state: 'not_recorded' }; await assert.rejects(read()); assert.equal(f.storage.get(key), raw);
  const saved = { corporateCustomerId: 'company', id: 'request-1', state: 'pending', revision: 2, effect: 'review_only_no_business_change' };
  for (const result of [{}, { ...saved, corporateCustomerId: 'other-company' }, { ...saved, id: 'bad/id' }, { ...saved, state: 'approved' }, { ...saved, revision: '2' }, { ...saved, effect: 'credit_applied' }]) {
    f.receipt = { state: 'committed', result }; await assert.rejects(read()); assert.equal(f.storage.get(key), raw);
  }
  assert.ok(f.reads.every(path => path === originalPath)); assert.equal(f.commands.length, 1); assert.equal(f.context.selectedCorporateId, '');
  const narrow = reactHost(), gate = f.makeGate(narrow.runtime); narrow.mount(() => gate.useOriginalWorkflowOperation('management-requests', { originalCorporateId: 'company', originalOperationKey: 'original-transfer-key', originalManagementSave: true }));
  await assert.rejects(narrow.value.run(() => ({ path: '/enterprise/corporates/company/management-requests', input: {} }), async () => {}));
  await assert.rejects(narrow.value.read('/enterprise/operations/original-transfer-key')); narrow.unmount();
  f.receipt = { state: 'committed', result: saved }; f.onReload = () => assert.equal(f.storage.has(key), false, 'exact retirement precedes current entry reload');
  await read(); assert.equal(f.storage.has(key), false); assert.equal(f.storage.get(foreign), '{private-foreign-material'); assert.equal(f.reloads, 1); assert.deepEqual(f.context.entry.corporates, []);
  assert.ok(!f.storageReads.includes(foreign)); assert.ok(f.lockNames.every(name => name === key + ':dispatch')); assert.equal(f.commands.length, 1); f.dispose();
  const known = managementReviewFixture(); await known.editManagement(); known.managementListQuery.refetch = async () => { throw new Error('current request read failed'); };
  await assert.rejects(known.saveManagement(), /current request read failed/u); known.managementHooks.flush(); const [knownKey] = [...known.storage.keys()]; assert.equal(JSON.parse(known.storage.get(knownKey)).state, 'committed');
  const recoverKnown = () => nodes(known.managementHooks.value).find(node => node.type === 'action' && node.props.label === 'Read original request result').props.onAction();
  known.receipt = { state: 'committed', result: { ...saved, id: 'another-request' } }; await assert.rejects(recoverKnown()); assert.ok(known.storage.has(knownKey));
  known.receipt = { state: 'committed', result: saved }; await assert.rejects(recoverKnown(), /current request read failed/u);
  assert.equal(known.storage.has(knownKey), false, 'today read failure cannot retain or replay an already verified original'); assert.equal(known.commands.length, 1); assert.ok(known.reads.every(path => path === originalPath)); known.dispose();
});

check('Management withdrawal captures the original when confirmation opens, rechecks after live callback changes, and recovers only original request/K from the same personal slot', async () => {
  const button = f => {
    const table = nodes(f.managementHooks.value).find(node => node.type === 'table'), actions = table.props.columns.find(column => column.title === 'Actions').render(null, f.managementRow);
    return nodes(actions).find(node => node.type === 'confirm');
  };
  const normal = managementReviewFixture(); normal.writeHandler = async () => ({ id: 'request-1', state: 'withdrawn', revision: 2 });
  await assert.rejects(button(normal).props.onConfirm()); assert.equal(normal.commands.length, 0, 'cannot confirm without opening original confirmation');
  button(normal).props.onStateChange('confirming'); assert.equal(normal.commands.length, 0); await button(normal).props.onConfirm();
  assert.equal(normal.commands.length, 1); assert.equal(normal.commands[0].path, '/enterprise/management-requests/request-1/withdraw'); assert.equal(normal.commands[0].input.expectedRevision, 1);
  assert.equal(normal.commands[0].input.reason, '本人明确撤回企业管理申请，原业务事实不变'); assert.equal(normal.storage.size, 0); assert.equal(button(normal).props.onUndo, undefined); normal.dispose();
  for (const change of ['revision', 'material', 'applicant', 'upload']) {
    const stale = managementReviewFixture(); button(stale).props.onStateChange('confirming');
    if (change === 'revision') stale.managementRow.revision++;
    if (change === 'material') stale.managementRow.proposal.legalName = 'Changed material at same revision';
    if (change === 'applicant') stale.managementRow.applicantCustomerId = 'another-person';
    if (change === 'upload') await stale.managementHooks.act(() => nodes(stale.managementHooks.value).find(node => node.type === 'upload').props.onBusy(true));
    stale.managementHooks.rerender(); await assert.rejects(button(stale).props.onConfirm()); assert.equal(stale.commands.length, 0); assert.equal(stale.storage.size, 0); stale.dispose();
  }
  const lost = managementReviewFixture(); lost.context.selectedCorporateId = ''; lost.context.entry.corporates = []; lost.context.identity = 'personal-no-management'; lost.managementHooks.rerender();
  lost.writeHandler = async () => { throw new Error('withdrawal response lost'); }; button(lost).props.onStateChange('confirming'); await assert.rejects(button(lost).props.onConfirm()); lost.managementHooks.flush();
  const key = lost.referenceKey('', 'management-requests'), raw = lost.storage.get(key); assert.deepEqual(JSON.parse(raw), { key: 'original-transfer-key', path: '/enterprise/management-requests/request-1/withdraw', state: 'unknown' });
  assert.equal(raw.includes('reason'), false); assert.equal(raw.includes('proposal'), false); assert.equal(raw.includes('evidence'), false);
  const recovery = lost.mountRecovery(), read = () => recovery.button('Read original management request withdrawal').props.onAction();
  lost.receipt = { state: 'not_recorded' }; await assert.rejects(read()); assert.equal(lost.storage.get(key), raw);
  for (const result of [{}, { id: 'other-request', state: 'withdrawn', revision: 2 }, { id: 'request-1', state: 'pending', revision: 2 }, { id: 'request-1', state: 'withdrawn', revision: 1 }]) {
    lost.receipt = { state: 'committed', result }; await assert.rejects(read()); assert.equal(lost.storage.get(key), raw);
  }
  assert.ok(lost.reads.every(path => path === '/enterprise/management-requests/request-1/withdraw-operations/original-transfer-key'));
  lost.receipt = { state: 'committed', result: { id: 'request-1', state: 'withdrawn', revision: 2 } }; await read(); assert.equal(lost.storage.has(key), false); assert.equal(lost.commands.length, 1);
  assert.equal(lost.context.selectedCorporateId, ''); assert.deepEqual(lost.context.entry.corporates, []); assert.ok(lost.lockNames.every(name => name === key + ':dispatch')); lost.dispose();
});

function merchantManagementReviewFixture() {
  const hooks = reactHost(), events = emitter(), f = { hooks, storage: new Map(), reads: [], writes: [], downloads: 0, epoch: 1, allowed: true, finance: true };
  const auth = { sessionVerified: true, token: 'synthetic-operator-token', tenant: { tenantId: 'merchant' }, currentWorkspaceId: 'w1', user: { id: 'operator', tenantId: 'merchant', permissions: ['rental-os:corporate:manage', 'rental-os:finance:manage'], tenantMembership: {} },
    hasTenantMembershipPermission: name => f.allowed && (name !== 'rental-os:finance:manage' || f.finance) };
  f.auth = auth; const useAuthStore = () => auth; useAuthStore.getState = () => auth; useAuthStore.subscribe = listener => events.on(listener);
  f.row = { id: 'request-1', corporateCustomerId: 'company', applicantCustomerId: 'recipient', requestType: 'profile_change', state: 'pending', revision: 1, objectRevision: 'original-r1',
    proposal: { legalName: 'Original proposal' }, evidenceFileIds: ['original-file'], reason: 'Original source reason', decisionReason: null, effect: 'review_only_no_business_change', createdAt: '2026-11-05T10:00:00.001Z', updatedAt: '2026-11-05T10:00:00.002Z' };
  f.query = { data: [f.row], isFetching: false, refetch: async () => ({ data: [f.row] }) };
  const localStorage = { getItem: key => f.storage.get(key) ?? null, setItem: (key, value) => f.storage.set(key, value), removeItem: key => f.storage.delete(key) }, locks = new Map();
  const navigator = { locks: { request: (key, action) => { const task = (locks.get(key) ?? Promise.resolve()).then(async () => { if (f.lockBarrier) await f.lockBarrier; return action(); }); locks.set(key, task.catch(() => {})); return task; } } };
  const transport = { http: { request: async config => {
    if (config.method === 'get') { f.reads.push(config.url); if (config.responseType === 'blob') return { data: f.media ? await f.media : { type: 'image/png', size: 1 } }; return { data: { data: f.readHandler ? await f.readHandler(config) : plain(f.receipt ?? { state: 'not_recorded' }) } }; }
    f.writes.push(plain(config)); return { data: { data: f.writeHandler ? await f.writeHandler(config) : { id: f.row.id, state: config.data.decision === 'approve' ? 'approved' : config.data.decision === 'reject' ? 'rejected' : 'supplement_required', revision: 2, effect: 'review_only_no_business_change' } } };
  } } };
  const query = { currentSessionEpoch: () => f.epoch, currentSessionSignal: () => new AbortController().signal }, dependencies = { react: hooks.runtime, '@/features/auth/authStore': { useAuthStore }, '@/app/queryClient': query, '@/api/http': transport };
  const gate = load('apps/admin/src/features/membership/original-enterprise-operation.ts', dependencies, { localStorage, navigator, AbortController, AbortSignal, crypto: { randomUUID: () => 'merchant-management-K' } });
  const component = load('apps/admin/src/features/membership/EnterpriseManagementRequests.tsx', { ...dependencies, 'react/jsx-runtime': hooks.jsx, '@tanstack/react-query': { useQuery: () => f.query },
    '@/components/ui': { ActionButton: 'action', Alert: 'alert', ConfirmAction: 'confirm', Input: Object.assign('input', { TextArea: 'textarea' }), Table: 'table' },
    '@/app/locale': { useLocale: () => ({ t: value => value }) }, './original-enterprise-operation': gate },
    { URL: { createObjectURL: () => 'blob:original-local', revokeObjectURL() {} }, document: { createElement: () => ({ click() { f.downloads++; } }) } });
  hooks.mount(() => component.EnterpriseManagementRequests());
  f.table = () => nodes(hooks.value).find(node => node.type === 'table'); f.actions = () => f.table().props.columns.find(column => column.title === '审核').render(null, f.table().props.dataSource[0]);
  f.review = () => hooks.act(() => nodes(f.actions()).find(node => node.props.label === '核对本条申请').props.onAction());
  f.reason = value => hooks.act(() => nodes(f.actions()).find(node => node.type === 'textarea').props.onChange({ target: { value } }));
  f.confirm = (label = '记录审核通过') => nodes(f.actions()).find(node => node.props.label === label); f.dispose = () => hooks.unmount(); return f;
}
check('Merchant management review freezes bounded original material and native confirmation input, preserves original decision payloads, and denies stale media or extra finance authority', async () => {
  const normal = merchantManagementReviewFixture(); await normal.review(); await normal.reason('  Explicit original review  ');
  await assert.rejects(normal.confirm().props.onConfirm()); assert.equal(normal.writes.length, 0); normal.confirm().props.onStateChange('confirming'); await normal.confirm().props.onConfirm();
  assert.equal(normal.writes.length, 1); assert.equal(normal.writes[0].url, '/membership/enterprise-workflows/management-requests/request-1/decision'); assert.equal(normal.writes[0].method, 'post');
  assert.deepEqual(normal.writes[0].data, { expectedRevision: 1, decision: 'approve', reason: 'Explicit original review', operationKey: 'merchant-management-K' }); assert.equal(normal.writes[0]._authRetry, true); assert.equal(normal.storage.size, 0); normal.dispose();
  const reason = merchantManagementReviewFixture(); await reason.review(); await reason.reason('First reviewed reason'); reason.confirm().props.onStateChange('confirming');
  await reason.reason('Changed after confirmation opened'); await assert.rejects(reason.confirm().props.onConfirm()); assert.equal(reason.writes.length, 0); assert.equal(reason.storage.size, 0); reason.dispose();
  const stale = merchantManagementReviewFixture(); await stale.review(); await stale.reason('Original review'); const barrier = deferred(); stale.lockBarrier = barrier.promise;
  stale.confirm('拒绝申请').props.onStateChange('confirming'); const deciding = stale.confirm('拒绝申请').props.onConfirm(); await stale.hooks.settle(); stale.row.proposal.legalName = 'Different proposal at same revision';
  barrier.resolve(); await assert.rejects(deciding); assert.equal(stale.writes.length, 0); assert.equal(stale.storage.size, 0); assert.equal(nodes(stale.actions()).find(node => node.type === 'textarea').props.value, 'Original review'); stale.dispose();
  const finance = merchantManagementReviewFixture(); finance.row.requestType = 'credit_change'; finance.row.proposal = { requestedCreditLimit: '100.00', currency: 'CNY' }; finance.hooks.rerender(); await finance.review(); await finance.reason('Financial review');
  finance.confirm().props.onStateChange('confirming'); finance.finance = false; await assert.rejects(finance.confirm().props.onConfirm(), /财务管理权/u); assert.equal(finance.writes.length, 0); assert.equal(finance.storage.size, 0); finance.dispose();
  const media = merchantManagementReviewFixture(), pending = deferred(); media.media = pending.promise;
  const action = media.table().props.columns.find(column => column.title === '申请材料').render(null, media.table().props.dataSource[0]); const reading = nodes(action).find(node => node.type === 'action').props.onAction();
  await Promise.resolve(); media.row.evidenceFileIds = ['replacement-file']; pending.resolve({ type: 'image/png', size: 1 }); await assert.rejects(reading); assert.equal(media.downloads, 0); assert.equal(media.writes.length, 0); media.dispose();
  const corrupt = merchantManagementReviewFixture(); corrupt.row.proposal.internalSecret = 'must-not-render'; corrupt.hooks.rerender(); assert.deepEqual(plain(corrupt.table().props.dataSource), []);
  assert.ok(nodes(corrupt.hooks.value).some(node => node.type === 'alert' && node.props.title === '申请材料不可核对')); assert.equal(JSON.stringify(corrupt.hooks.value).includes('must-not-render'), false); corrupt.dispose();
});

check('Merchant original review recovery always uses exact request/K with current finance permission, including local committed input; invalid proof and replaced references never retire or replay', async () => {
  const f = merchantManagementReviewFixture(); await f.review(); await f.reason('Original reviewer reason'); f.writeHandler = async () => { throw new Error('original review response lost'); };
  f.confirm().props.onStateChange('confirming'); await assert.rejects(f.confirm().props.onConfirm()); f.hooks.flush(); const [key, raw] = [...f.storage][0];
  assert.equal(JSON.parse(raw).path, '/membership/enterprise-workflows/management-requests/request-1/decision'); assert.equal(raw.includes('reason'), false); assert.equal(raw.includes('proposal'), false); assert.equal(raw.includes('token'), false);
  const recover = () => nodes(f.hooks.value).find(node => node.props.label === '核对原审核结果').props.onAction(), result = { corporateCustomerId: 'company', requestType: 'profile_change', id: 'request-1', state: 'approved', revision: 2, effect: 'review_only_no_business_change' };
  await assert.rejects(recover()); assert.equal(f.storage.get(key), raw);
  for (const invalid of [{}, { ...result, id: 'other-request' }, { ...result, requestType: 'unknown' }, { ...result, state: 'pending' }, { ...result, revision: '2' }, { ...result, effect: 'credit_changed' }]) {
    f.receipt = { state: 'committed', result: invalid }; await assert.rejects(recover()); assert.equal(f.storage.get(key), raw);
  }
  f.finance = false; f.receipt = { state: 'committed', result: { ...result, requestType: 'credit_change' } }; await assert.rejects(recover(), /财务管理权/u); assert.equal(f.storage.get(key), raw);
  f.receipt = { state: 'committed', result }; f.query.refetch = async () => { assert.equal(f.storage.has(key), false); throw new Error('current queue failed'); };
  await assert.rejects(recover(), /current queue failed/u); f.hooks.flush(); assert.equal(f.storage.has(key), false); assert.equal(f.writes.length, 1);
  assert.ok(nodes(f.hooks.value).some(node => node.type === 'alert' && node.props.title === '原审核收据已核对，不代表业务变更或当前授权'));
  assert.ok(f.reads.every(path => path === '/membership/enterprise-workflows/management-requests/request-1/decision-operations/merchant-management-K')); f.dispose();
  const known = merchantManagementReviewFixture(); await known.review(); await known.reason('Reviewed known commit'); known.query.refetch = async () => { throw new Error('read failed after commit'); };
  known.confirm().props.onStateChange('confirming'); await assert.rejects(known.confirm().props.onConfirm()); known.hooks.flush(); assert.equal(JSON.parse([...known.storage.values()][0]).state, 'committed');
  const readKnown = () => nodes(known.hooks.value).find(node => node.props.label === '核对原审核结果').props.onAction(); await assert.rejects(readKnown()); assert.equal(known.reads.length, 1); assert.equal(known.storage.size, 1);
  const [knownKey] = [...known.storage.keys()], replaced = JSON.stringify({ key: 'another-K', path: '/membership/enterprise-workflows/management-requests/another-request/decision', state: 'unknown' });
  known.readHandler = async () => { known.storage.set(knownKey, replaced); return { state: 'committed', result }; }; await assert.rejects(readKnown()); assert.equal(known.storage.get(knownKey), replaced); assert.equal(known.writes.length, 1); known.dispose();
});

function managementFeedbackFixture() {
  const hooks = reactHost(), f = { hooks, props: { requestId: 'request-feedback', english: true }, reads: [], query: { data: undefined, isFetching: false }, storage: new Map([['original-K', 'unresolved-original']]) };
  f.context = { identity: 'feedback-owner', tenantCode: 'merchant', basePath: '/merchant/enterprise', selectedCorporateId: '', session: { customer: { customerId: 'recipient' } }, signal: new AbortController().signal,
    read: async path => { f.reads.push(path); return f.reader ? f.reader() : plain(f.response); }, write: forbidden('feedback never writes'), reload: forbidden('feedback never grants/reloads an enterprise') };
  f.response = { id: 'request-feedback', corporateCustomerId: 'company', applicantCustomerId: 'recipient', requestType: 'profile_change', state: 'supplement_required', revision: 2, objectRevision: 'original-object-r1',
    proposal: { legalName: 'Original proposal' }, evidenceFileIds: ['original-file'], reason: 'Original request reason', decisionReason: 'Add original authority evidence', effect: 'review_only_no_business_change', createdAt: '2026-11-05T10:00:00.001Z', updatedAt: '2026-11-05T10:00:00.002Z' };
  f.query.refetch = async () => { f.query.isFetching = true; hooks.rerender(); try { const value = await f.options.queryFn({ signal: new AbortController().signal }); f.query.data = value; return { data: value }; } finally { f.query.isFetching = false; hooks.rerender(); } };
  const page = load('apps/enterprise-portal/src/ManagementRequestFeedback.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: options => { f.options = options; return f.query; } }, './enterprise-session': { useEnterprise: () => f.context }, '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert' } },
    { AbortSignal, localStorage: { getItem: forbidden('feedback cannot consume original K'), setItem: forbidden('feedback cannot overwrite original K'), removeItem: forbidden('feedback cannot retire original K') } });
  hooks.mount(() => page.EnterpriseManagementRequestFeedback(f.props)); f.read = () => nodes(hooks.value).find(node => node.props.label === 'Read this request again').props.onAction(); f.dispose = () => hooks.unmount(); return f;
}
check('Persisted management task links locate exact own feedback without selecting an enterprise, rebasing input or consuming K; foreign/late material never becomes visible', async () => {
  const f = managementFeedbackFixture(); await f.read(); assert.deepEqual(f.reads, ['/enterprise/management-requests/request-feedback']);
  for (const value of ['request-feedback', 'Original proposal', 'Add original authority evidence', 'original-object-r1', 'original-file', '2026-11-05T10:00:00.002Z']) assert.ok(text(f.hooks.value).includes(value), value);
  assert.equal(f.context.selectedCorporateId, ''); assert.equal(f.storage.get('original-K'), 'unresolved-original'); assert.equal(nodes(f.hooks.value).some(node => node.props.onSave || node.props.onConfirm), false); f.dispose();
  for (const patch of [{ id: 'other-request' }, { applicantCustomerId: 'other-person' }, { proposal: { legalName: 'Original', privateData: 'must-not-render' } }]) {
    const bad = managementFeedbackFixture(); Object.assign(bad.response, patch); await assert.rejects(bad.read()); assert.equal(text(bad.hooks.value).includes('must-not-render'), false); assert.equal(bad.storage.get('original-K'), 'unresolved-original'); bad.dispose();
  }
  const late = managementFeedbackFixture(), pending = deferred(); late.reader = () => pending.promise; const reading = late.read(); late.props.requestId = 'another-request'; late.hooks.rerender(); pending.resolve(late.response);
  await assert.rejects(reading); assert.equal(text(late.hooks.value).includes('Add original authority evidence'), false); assert.equal(late.context.selectedCorporateId, ''); late.dispose();
  const entry = managementReviewFixture(); entry.managementSearch = '?requestId=request-feedback'; entry.managementHooks.rerender(); const feedback = nodes(entry.managementHooks.value).find(node => typeof node.type === 'function' && node.type.name === 'EnterpriseManagementRequestFeedback');
  assert.equal(feedback.props.requestId, 'request-feedback'); assert.equal(entry.commands.length, 0); entry.dispose();
  const hooks = reactHost(), row = { id: 'request-feedback', kind: 'management_request', page: 'profile', revision: 2, state: 'supplement_required', requiresAction: true }, context = { identity: 'task-owner', basePath: '/merchant/enterprise', selectedCorporateId: '', read: forbidden('query host cannot dispatch') };
  const page = load('apps/enterprise-portal/src/TasksPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, '@tanstack/react-query': { useQuery: () => ({ data: { items: [row] }, isFetching: false }) },
    'react-router-dom': { Link: 'link' }, '@rental-os/web-client': load('packages/web-client/src/enterprise-entry.ts', {}), './enterprise-session': { useEnterprise: () => context }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Table: 'table' } });
  hooks.mount(() => page.EnterpriseTasksPage()); const column = nodes(hooks.value).find(node => node.type === 'table').props.columns.find(column => column.title === 'Page');
  assert.equal(column.render(null, row).props.to, '/merchant/enterprise/profile?requestId=request-feedback');
  for (const invalid of [{ ...row, id: '../other' }, { ...row, kind: 'constructor' }, { ...row, page: '../../finance' }]) assert.equal(nodes(column.render(null, invalid)).some(node => node.type === 'link'), false);
  hooks.unmount();
});

check('Exact management feedback enters the original supplemental editor only after explicit re-read; list failures do not rebase a detail save and late locator/material changes create no K', async () => {
  const setup = () => {
    const f = managementReviewFixture(); f.managementSearch = '?requestId=request-1'; f.managementRow.state = 'supplement_required'; f.managementRow.revision = 2; f.managementRow.decisionReason = 'Add original evidence';
    f.managementListQuery.data = []; f.managementListQuery.error = new Error('bounded list unavailable'); f.managementListQuery.refetch = forbidden('detail save must not depend on the bounded list');
    f.readHandler = async path => { assert.equal(path, '/enterprise/management-requests/request-1'); return plain(f.managementRow); }; f.managementHooks.rerender();
    f.feedback = () => nodes(f.managementHooks.value).find(node => typeof node.type === 'function' && node.type.name === 'EnterpriseManagementRequestFeedback');
    return f;
  };
  const normal = setup(); assert.equal(normal.feedback().props.editDisabled, false); await normal.feedback().props.onEdit(plain(normal.managementRow)); await normal.managementHooks.settle();
  assert.equal(normal.managementValues.legalName, 'Proposed company'); assert.equal(normal.managementValues.reason, '  Original reason  ');
  normal.managementValues.evidence.push('new-evidence'); assert.deepEqual(normal.managementRow.evidenceFileIds, ['evidence-original']);
  normal.managementValues.reason = '  Explicit supplement  '; normal.writeHandler = async (_path, input) => { normal.managementRow.state = 'pending'; normal.managementRow.revision = 3; return { id: 'request-1', state: 'pending', revision: 3, effect: 'review_only_no_business_change' }; };
  await normal.saveManagement(); assert.equal(normal.commands.length, 1); assert.equal(normal.commands[0].input.requestId, 'request-1'); assert.equal(normal.commands[0].input.expectedRevision, 2);
  assert.equal(normal.commands[0].input.objectRevision, 'original-r1'); assert.equal(normal.commands[0].input.reason, '  Explicit supplement  '); assert.deepEqual(normal.commands[0].input.evidenceFileIds, ['evidence-original', 'new-evidence']);
  assert.equal(normal.storage.size, 0); assert.equal(normal.managementCachedFeedback.state, 'pending'); assert.deepEqual(normal.managementCachedKey, ['enterprise-management-feedback', JSON.stringify([normal.context.identity, 'request-1'])]); normal.dispose();
  const stale = setup(); await stale.feedback().props.onEdit(plain(stale.managementRow)); await stale.managementHooks.settle(); stale.managementValues.reason = 'Unsaved original supplement';
  stale.managementRow.proposal.legalName = 'Changed original material at same revision'; await assert.rejects(stale.saveManagement()); assert.equal(stale.commands.length, 0); assert.equal(stale.storage.size, 0); assert.equal(stale.managementValues.reason, 'Unsaved original supplement'); stale.dispose();
  const late = setup(), waiting = deferred(), original = plain(late.managementRow); late.readHandler = () => waiting.promise;
  const entering = late.feedback().props.onEdit(original); late.managementSearch = '?requestId=another-request'; late.managementHooks.rerender(); waiting.resolve(original);
  await assert.rejects(entering); assert.deepEqual(late.managementValues, {}); assert.equal(late.commands.length, 0); assert.equal(late.storage.size, 0); late.dispose();
  const switched = setup(); await switched.feedback().props.onEdit(plain(switched.managementRow)); await switched.managementHooks.settle(); switched.managementValues.reason = 'Keep old editor input';
  switched.managementSearch = '?requestId=another-request'; switched.managementHooks.rerender(); await assert.rejects(switched.saveManagement()); assert.equal(switched.managementValues.reason, 'Keep old editor input'); assert.equal(switched.commands.length, 0); switched.dispose();
  const handoff = managementFeedbackFixture(); handoff.props.onEdit = async row => { handoff.edited = row; }; handoff.context.selectedCorporateId = 'company'; handoff.context.entry = { corporates: [{ corporateCustomerId: 'company', actions: ['requests:manage'] }] }; handoff.hooks.rerender(); await handoff.read();
  const edit = nodes(handoff.hooks.value).find(node => node.props.label === 'Edit this original request'); assert.equal(edit.props.disabled, false); await edit.props.onAction(); assert.equal(handoff.edited.id, 'request-feedback');
  handoff.edited.evidenceFileIds.push('test-separate-copy'); assert.deepEqual(plain(handoff.query.data.evidenceFileIds), ['original-file']); assert.equal(handoff.storage.get('original-K'), 'unresolved-original'); handoff.dispose();
});

check('Own detail withdrawal needs no management/list/profile grant, freezes its independent confirmation and exact read, and recovers K before refreshing current own feedback', async () => {
  const setup = (personal = true) => {
    const f = managementReviewFixture(); f.managementSearch = '?requestId=request-1'; f.managementRow.state = 'pending'; f.managementRow.revision = 2;
    if (personal) { f.context.entry.corporates[0].actions = []; f.managementListQuery.data = []; f.managementListQuery.error = new Error('list unavailable'); f.managementListQuery.refetch = forbidden('detail withdrawal does not read list'); f.managementProfileQuery.error = new Error('profile forbidden'); f.managementProfileQuery.refetch = forbidden('own withdrawal does not need profile grant'); }
    f.readHandler = async path => { assert.equal(path, '/enterprise/management-requests/request-1'); return plain(f.managementRow); }; f.managementHooks.rerender();
    f.detailWithdrawal = () => nodes(f.managementHooks.value).find(node => typeof node.type === 'function' && node.type.name === 'EnterpriseManagementRequestFeedback').props.renderWithdrawal(plain(f.managementRow));
    return f;
  };
  const normal = setup(); assert.equal(normal.detailWithdrawal().props.disabled, false); await assert.rejects(normal.detailWithdrawal().props.onConfirm()); assert.equal(normal.commands.length, 0);
  normal.detailWithdrawal().props.onStateChange('confirming'); normal.writeHandler = async () => { normal.managementRow.state = 'withdrawn'; normal.managementRow.revision = 3; return { id: 'request-1', state: 'withdrawn', revision: 3 }; };
  await normal.detailWithdrawal().props.onConfirm(); assert.equal(normal.commands.length, 1); assert.equal(normal.commands[0].path, '/enterprise/management-requests/request-1/withdraw'); assert.equal(normal.commands[0].input.expectedRevision, 2);
  assert.equal(normal.storage.size, 0); assert.equal(normal.managementCachedFeedback.state, 'withdrawn'); assert.equal(normal.detailWithdrawal().props.onUndo, undefined); normal.dispose();
  const stale = setup(); const original = stale.detailWithdrawal(); original.props.onStateChange('confirming'); stale.managementRow.proposal.legalName = 'Changed at same revision'; await assert.rejects(original.props.onConfirm()); assert.equal(stale.commands.length, 0); assert.equal(stale.storage.size, 0); stale.dispose();
  const surface = setup(false); const detail = surface.detailWithdrawal(); detail.props.onStateChange('confirming');
  const table = nodes(surface.managementHooks.value).find(node => node.type === 'table'), actions = table.props.columns.find(column => column.title === 'Actions').render(null, surface.managementRow); nodes(actions).find(node => node.type === 'confirm').props.onStateChange('confirming');
  surface.managementSearch = '?requestId=another-request'; surface.managementHooks.rerender(); await assert.rejects(detail.props.onConfirm()); assert.equal(surface.commands.length, 0, 'detail cannot borrow the list confirmation to bypass its locator'); assert.equal(surface.storage.size, 0); surface.dispose();
  const lost = setup(); lost.writeHandler = async () => { throw new Error('detail withdrawal response lost'); }; lost.detailWithdrawal().props.onStateChange('confirming'); await assert.rejects(lost.detailWithdrawal().props.onConfirm()); lost.managementHooks.flush();
  const [key, raw] = [...lost.storage][0]; assert.equal(JSON.parse(raw).path, '/enterprise/management-requests/request-1/withdraw');
  const recovery = () => nodes(lost.managementHooks.value).find(node => node.props.label === 'Read original request result').props.onAction();
  lost.readHandler = async path => path.endsWith('/withdraw-operations/original-transfer-key') ? { state: 'not_recorded' } : plain(lost.managementRow); await assert.rejects(recovery()); assert.equal(lost.storage.get(key), raw);
  lost.managementRow.state = 'withdrawn'; lost.managementRow.revision = 3;
  lost.readHandler = async path => { if (path.endsWith('/withdraw-operations/original-transfer-key')) return { state: 'committed', result: { id: 'request-1', state: 'withdrawn', revision: 3 } }; assert.equal(lost.storage.has(key), false); return plain(lost.managementRow); };
  await recovery(); assert.equal(lost.storage.has(key), false); assert.equal(lost.commands.length, 1); assert.equal(lost.managementCachedFeedback.state, 'withdrawn'); lost.dispose();
  const reader = managementFeedbackFixture(); reader.props.renderWithdrawal = row => ({ type: 'registered-withdrawal', props: { original: row } }); reader.hooks.rerender(); await reader.read();
  const rendered = nodes(reader.hooks.value).find(node => node.type === 'registered-withdrawal'); assert.equal(rendered.props.original.id, 'request-feedback'); rendered.props.original.evidenceFileIds.push('independent-copy'); assert.deepEqual(plain(reader.query.data.evidenceFileIds), ['original-file']); reader.dispose();
});

check('Management list feedback uses only registered own-ID locators in both origins, shares review-only state labels, and preserves K and unsaved editor input', async () => {
  const f = managementReviewFixture(); f.context.basePath = '/merchant/enterprise';
  const table = () => nodes(f.managementHooks.value).find(node => node.type === 'table'), cell = row => table().props.columns.find(column => column.title === 'Original feedback').render(null, row);
  const labels = load('apps/enterprise-portal/src/ManagementRequestFeedback.tsx', { react: {}, 'react/jsx-runtime': {}, '@tanstack/react-query': {}, '@/components/ui/customer-entry': {}, './enterprise-session': {} });
  const states = { draft: ['草稿', 'Draft'], pending: ['待商户审核', 'Awaiting merchant review'], supplement_required: ['要求补件', 'Additional evidence requested'], approved: ['已记录审核通过', 'Review recorded as approved'], rejected: ['申请被拒绝', 'Request rejected'], withdrawn: ['已撤回', 'Withdrawn'] };
  for (const [state, expected] of Object.entries(states)) {
    assert.equal(table().props.columns.find(column => column.title === 'State').render(null, { ...f.managementRow, state }), expected[1]);
    assert.equal(labels.managementRequestStateLabel(state, false), expected[0]); assert.equal(labels.managementRequestStateLabel(state, true), expected[1]);
    assert.equal(cell({ ...f.managementRow, state }).props.to, '/merchant/enterprise/profile?requestId=request-1');
  }
  assert.equal(labels.managementRequestStateLabel('constructor', true), 'Request state unavailable');
  for (const change of [{ id: 'bad/id' }, { applicantCustomerId: 'another-person' }, { state: 'unknown' }, { effect: 'credit_applied' }, { evidenceFileIds: ['bad/file'] }]) assert.equal(cell({ ...f.managementRow, ...change }), 'Original entry unavailable');
  await f.editManagement(); f.managementValues.reason = 'Keep this unsaved original proposal';
  const other = cell({ ...f.managementRow, id: 'another-request', state: 'rejected' }); f.managementSearch = '?' + other.props.to.split('?')[1]; f.managementHooks.rerender();
  const detail = nodes(f.managementHooks.value).find(node => typeof node.type === 'function' && node.type.name === 'EnterpriseManagementRequestFeedback');
  assert.equal(detail.props.requestId, 'another-request'); assert.equal(detail.props.editDisabled, true); assert.equal(f.managementValues.reason, 'Keep this unsaved original proposal'); assert.equal(f.commands.length, 0); assert.equal(f.reads.length, 0); f.dispose();
  const personal = managementReviewFixture(); personal.context.entry.corporates = []; personal.context.selectedCorporateId = ''; personal.context.identity = 'personal-list-only'; personal.managementHooks.rerender();
  const key = personal.referenceKey('', 'management-requests'), raw = JSON.stringify({ key: 'original-transfer-key', path: '/enterprise/management-requests/request-1/withdraw', state: 'unknown' }); personal.storage.set(key, raw);
  const original = () => nodes(personal.managementHooks.value).find(node => node.type === 'table').props.columns.find(column => column.title === 'Original feedback');
  for (const base of ['/merchant/enterprise', '/enterprise']) {
    personal.context.basePath = base; personal.managementHooks.rerender(); const link = original().render(null, personal.managementRow); assert.equal(link.props.to, `${base}/profile?requestId=request-1`); assert.equal(link.props.target, undefined);
    personal.managementSearch = '?' + link.props.to.split('?')[1]; personal.managementHooks.rerender(); assert.equal(personal.storage.get(key), raw); assert.equal(personal.context.selectedCorporateId, ''); assert.equal(personal.commands.length, 0); assert.equal(personal.reads.length, 0);
  }
  personal.context.basePath = '//unregistered'; personal.managementHooks.rerender(); assert.equal(original().render(null, personal.managementRow), 'Original entry unavailable');
  personal.context.basePath = '/enterprise'; personal.managementListQuery.isFetching = true; personal.managementHooks.rerender(); assert.equal(original().render(null, personal.managementRow), 'Original entry unavailable');
  assert.equal(personal.storage.get(key), raw); personal.dispose();
});

function merchantApplicationReviewFixture() {
    const hooks = reactHost(), events = emitter(), f = { hooks, storage: new Map(), reads: [], materialReads: [], claimReads: [], writes: [], downloads: 0, epoch: 1 };
    const auth = { sessionVerified: true, token: 'fixture-operator-token', tenant: { tenantId: 'merchant' }, currentWorkspaceId: 'w1', user: { id: 'operator', tenantId: 'merchant', permissions: ['rental-os:corporate:manage', 'rental-os:corporate:employee-manage'], tenantMembership: {} }, hasTenantMembershipPermission: name => auth.user.permissions.includes(name) && f.deniedPermission !== name };
    f.auth = auth; const useAuthStore = () => auth; useAuthStore.getState = () => auth; useAuthStore.subscribe = listener => events.on(listener);
    f.row = { id: 'application-1', kind: 'corporate_application', state: 'pending', revision: 1, applicantCustomerId: 'recipient', createdAt: '2026-11-05T10:00:00.001Z', updatedAt: '2026-11-05T10:00:00.002Z', payload: { legalName: 'Original company', region: 'CN', legalIdentifier: '91310000MA1K123456', contactName: 'Original representative', contactPhone: 'company-phone', authorityStatement: 'Original authority evidence', agreementVersion: 'v1', agreementAcknowledged: true, agreementAcknowledgedAt: '2026-11-05T10:00:00.001Z', evidenceFileIds: ['original-file'], privateToken: 'must-not-render' } };
    f.query = { data: [f.row], isFetching: false, refetch: async () => ({ data: f.query.data }) };
    const localStorage = { getItem: key => f.storage.get(key) ?? null, setItem: (key, value) => f.storage.set(key, value), removeItem: key => f.storage.delete(key) }, locks = new Map();
    const navigator = { locks: { request: (key, action) => { const task = (locks.get(key) ?? Promise.resolve()).then(async () => { if (f.lockBarrier) await f.lockBarrier; return action(); }); locks.set(key, task.catch(() => {})); return task; } } };
    const transport = { http: { request: async config => {
      if (config.method === 'get') {
        const materialPrefix = '/membership/enterprise-workflows/applications/';
        if (config.url.startsWith(materialPrefix) && config.url.endsWith('/claim-material') && /^[a-zA-Z0-9_-]{1,191}$/u.test(config.url.slice(materialPrefix.length, -'/claim-material'.length))) { f.claimReads.push(config.url); return { data: { data: f.claimHandler ? await f.claimHandler() : f.claimResponse } }; }
        if (config.url.startsWith(materialPrefix) && /^[a-zA-Z0-9_-]{1,191}$/u.test(config.url.slice(materialPrefix.length))) { f.materialReads.push(config.url); return { data: { data: f.materialHandler ? await f.materialHandler(config.url) : plain(f.row) } }; }
        f.reads.push(config.url); return config.responseType === 'blob' ? { data: f.media ? await f.media : { type: 'image/png', size: 1 } } : { data: { data: f.readHandler ? await f.readHandler(config.url) : f.receipt ?? { state: 'not_recorded' } } };
      }
      f.writes.push(plain(config)); return { data: { data: f.writeHandler ? await f.writeHandler(config) : { id: f.row.id, state: config.data.decision === 'approve' ? 'approved' : config.data.decision === 'reject' ? 'rejected' : 'supplement_required', revision: 2, corporateCustomerId: 'company' } } };
    } } };
    const dependencies = { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, '@/features/auth/authStore': { useAuthStore }, '@/app/queryClient': { currentSessionEpoch: () => f.epoch, currentSessionSignal: () => new AbortController().signal }, '@/api/http': transport };
    const gate = load('apps/admin/src/features/membership/original-enterprise-operation.ts', dependencies, { localStorage, navigator, AbortController, AbortSignal, crypto: { randomUUID: () => 'merchant-application-K' } });
    const form = { resetFields() {}, setFieldsValue() {}, getFieldValue() {}, validateFields: forbidden('review does not save invitation policy') }, Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
    const page = load('apps/admin/src/features/membership/EnterpriseApplications.tsx', { ...dependencies, '@tanstack/react-query': { useQuery: options => options.queryKey[0] === 'enterprise-merchant-applications' ? f.query : { data: null, isFetching: false } }, './original-enterprise-operation': gate, '@/components/ui': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', ConfirmAction: 'confirm', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Table: 'table' }, '@/app/locale': { useLocale: () => ({ t: value => value }) } }, { URL: { createObjectURL: () => 'blob:original-local', revokeObjectURL() {} }, document: { createElement: () => ({ click() { f.downloads++; } }) } });
    hooks.mount(() => page.EnterpriseApplications()); f.table = () => nodes(hooks.value).find(node => node.type === 'table'); f.actions = row => f.table().props.columns.find(column => column.title === '操作').render(null, row ?? f.table().props.dataSource[0]);
    f.review = () => { const original = nodes(f.actions()).find(node => node.props.label === '核对本条申请').props.onAction(); hooks.flush(); return Promise.resolve(original).finally(() => hooks.flush()); };
    f.reason = value => hooks.act(() => nodes(hooks.value).find(node => node.props.id === 'enterprise-application-review-reason').props.onChange({ target: { value } }));
    f.verify = value => hooks.act(() => nodes(hooks.value).find(node => node.type === 'checkbox').props.onChange({ target: { checked: value } })); f.confirm = (label = '批准并开通首管') => nodes(f.actions()).find(node => node.props.label === label);
    f.recover = () => nodes(hooks.value).find(node => node.type === 'action' && ['核对原操作', '刷新已提交结果'].includes(node.props.label)).props.onAction();
    const awaitAction = original => { hooks.flush(); return Promise.resolve(original).finally(() => hooks.flush()); };
    f.readClaim = () => awaitAction(nodes(hooks.value).find(node => node.props.label === '核对存量认领目标').props.onAction());
    f.setLocator = value => hooks.act(() => nodes(hooks.value).find(node => node.props.id === 'enterprise-application-locator').props.onChange({ target: { value } }));
    f.readFeedback = () => awaitAction(nodes(hooks.value).find(node => node.type === 'action' && node.props.label === '读取本条申请反馈').props.onAction());
    f.feedback = () => nodes(hooks.value).find(node => node.props['data-enterprise-application-feedback']);
    f.reviewFeedback = () => awaitAction(nodes(f.feedback()).find(node => node.props.label === '核对本条申请').props.onAction());
    f.feedbackConfirm = (label = '批准并开通首管') => nodes(f.feedback()).find(node => node.props.label === label);
    f.remount = () => { hooks.unmount(); f.epoch++; auth.token = 'fixture-new-login'; hooks.mount(() => page.EnterpriseApplications()); };
    f.dispose = () => hooks.unmount(); return f;
}

check('Merchant application evidence reads independent detail under frozen source and dual permission; changed locator/material, remount or invalid bytes never download or retire K', async () => {
  const setup = async () => { const f = merchantApplicationReviewFixture(); f.query.data = undefined; f.query.error = new Error('bounded queue unavailable'); f.hooks.rerender(); await f.setLocator('application-1'); await f.readFeedback(); f.evidence = () => nodes(f.feedback()).find(node => node.props.label === '读取材料 1'); return f; };
  const normal = await setup(), raw = JSON.stringify({ key: 'original-K', path: '/membership/enterprise-workflows/applications/application-1/decision', state: 'unknown' });
  normal.storage.set('rental-os:enterprise-operator-workflow:' + JSON.stringify(['merchant','operator','w1','enterprise-applications','/membership/enterprise-workflows/operations']), raw); normal.hooks.rerender();
  assert.ok(text(normal.feedback()).includes('original-file')); await normal.evidence().props.onAction(); assert.equal(normal.downloads, 1); assert.deepEqual(normal.reads, ['/membership/enterprise-workflows/applications/application-1/files/original-file']); assert.equal([...normal.storage.values()][0], raw); assert.equal(normal.writes.length, 0); normal.dispose();
  for (const transition of [async f => f.setLocator('application-2'), async f => { await f.readFeedback(); }, async f => { f.deniedPermission = 'rental-os:corporate:employee-manage'; }, async f => { f.remount(); }, async f => { f.row.payload.evidenceFileIds = ['replacement']; await f.readFeedback(); }]) {
    const late = await setup(), pending = deferred(); late.media = pending.promise; const reading = late.evidence().props.onAction(); await late.hooks.settle(); await transition(late); pending.resolve({ type: 'image/png', size: 1 }); await assert.rejects(reading); assert.equal(late.downloads, 0); assert.equal(late.writes.length, 0); late.dispose();
  }
  const old = await setup(), original = old.evidence(); await old.setLocator('application-2'); await assert.rejects(original.props.onAction()); assert.equal(old.reads.length, 0); assert.equal(old.downloads, 0); old.dispose();
  for (const media of [{ type: 'text/html', size: 1 }, { type: 'image/png', size: 0 }, { type: 'application/pdf', size: 20*1024*1024+1 }]) { const invalid = await setup(); invalid.media = Promise.resolve(media); await assert.rejects(invalid.evidence().props.onAction()); assert.equal(invalid.downloads, 0); assert.equal(invalid.writes.length, 0); invalid.dispose(); }
});

check('Own handoff feedback smoke: bounded list, original task locator, frozen withdrawal and same creation scope K recover without altering rentals or enterprise choice', async () => {
  const setup=()=>{const f=transferConsumerFixture(true),h=reactHost();f.context.session.customer.customerType='personal';f.search='';f.handoffRow={id:'handoff-1',orderId:'order-1',state:'pending',revision:1,reason:'Original request reason',createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',effect:'request_only_no_business_change',material:{orderId:'order-1',orderNo:'Original rental',orderUpdatedAt:'2026-11-02T00:00:00.000Z',workspaceCode:'s1',corporateCustomerId:'company',corporateMembershipId:'original-relation',membershipResolvedAt:'2026-11-01T00:00:00.000Z',membershipUpdatedAt:null,enterpriseContractAndPayer:true,subjects:{contract:'corporate',payer:'corporate',user:'self'},subjectBasis:'recorded_columns',scope:'current_workspace_original_own_order',readOnly:true},privateField:'must-not-render'};
    f.readHandler=async path=>path==='/enterprise/handoff-requests'?[plain(f.handoffRow)]:path.includes('/withdraw-operations/')?plain(f.receipt):plain(f.handoffRow);f.result={id:'handoff-1',orderId:'order-1',state:'withdrawn',revision:2,effect:'request_only_no_business_change'};f.writeHandler=async()=>{f.handoffRow.state='withdrawn';f.handoffRow.revision=2;return f.result;};
    f.mount=()=>{const gate=f.makeGate(h.runtime),page=load('apps/enterprise-portal/src/OwnRentalHandoffs.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{useLocation:()=>({search:f.search})},'./enterprise-session':{useEnterprise:()=>f.context},'./original-workflow-operation':gate,'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',ConfirmAction:'confirm',Input:Object.assign('input',{TextArea:'textarea'}),Table:'table'}},{AbortController,AbortSignal});h.mount(()=>page.EnterpriseOwnRentalHandoffs({english:true}));};f.mount();f.ownerH=h;
    f.button=label=>{const b=nodes(h.value).find(n=>n.props.label===label);assert.ok(b,label);return b;};f.id=value=>h.act(()=>nodes(h.value).find(n=>n.props.id==='own-rental-handoff-id').props.onChange({target:{value}}));f.detail=()=>f.button('Read this original handoff feedback').props.onAction();f.reason=value=>h.act(()=>nodes(h.value).find(n=>n.props.id==='own-rental-handoff-withdraw-reason').props.onChange({target:{value}}));f.prepare=async()=>{await f.id('handoff-1');await f.detail();await f.reason('  Original withdrawal reason  ');const b=f.button('Withdraw this handoff request');b.props.onStateChange('confirming');return b;};const oldDispose=f.dispose;f.dispose=()=>{h.unmount();oldDispose();};return f;};
  const normal=setup();assert.equal(normal.reads.length,0);await normal.button('Read my handoff requests').props.onAction();const table=nodes(normal.ownerH.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].privateField,undefined);const b=await normal.prepare();assert.equal(normal.commands.length,0);await b.props.onConfirm();assert.equal(normal.commands.length,1);assert.equal(normal.commands[0].path,'/enterprise/handoff-requests/handoff-1/withdraw');assert.equal(normal.commands[0].input.reason,'Original withdrawal reason');assert.equal(text(normal.ownerH.value).includes('Request withdrawn'),true);assert.equal(normal.storage.size,0);normal.dispose();
  const stale=setup(),held=await stale.prepare();stale.handoffRow.reason='Changed at same revision';await assert.rejects(held.props.onConfirm());assert.equal(stale.commands.length,0);assert.equal(stale.storage.size,0);stale.dispose();
  const rebound=setup(),oldConfirm=await rebound.prepare();await rebound.id('handoff-2');rebound.handoffRow={...rebound.handoffRow,id:'handoff-2'};await rebound.detail();assert.equal(nodes(rebound.ownerH.value).find(n=>n.props.id==='own-rental-handoff-withdraw-reason').props.value,'');assert.equal(rebound.button('Withdraw this handoff request').props.disabled,true);await assert.rejects(oldConfirm.props.onConfirm());assert.equal(rebound.commands.length,0);rebound.dispose();
  const loading=setup(),oldRead=loading.button('Read my handoff requests');loading.context.loading=true;loading.ownerH.rerender();await assert.rejects(oldRead.props.onAction());assert.equal(loading.reads.length,0);loading.dispose();
  const lost=setup(),submit=await lost.prepare();lost.writeHandler=async()=>{throw new Error('lost withdrawal response');};await assert.rejects(submit.props.onConfirm());const [key,raw]=[...lost.storage][0];assert.ok(key.includes('rental-handoff'));assert.equal(JSON.parse(key.slice('rental-os:enterprise-workflow:'.length))[4],'');assert.deepEqual(Object.keys(JSON.parse(raw)).sort(),['key','path','state']);lost.ownerH.unmount();lost.context.identity+='-login';lost.context.selectedCorporateId='';lost.generation+='-login';lost.mount();lost.receipt={state:'not_recorded'};await assert.rejects(lost.button('Read original handoff withdrawal').props.onAction());assert.equal(lost.storage.get(key),raw);lost.receipt={state:'committed',result:lost.result};await lost.button('Read original handoff withdrawal').props.onAction();assert.equal(lost.storage.size,0);assert.equal(lost.commands.length,1);assert.equal(lost.context.selectedCorporateId,'');assert.ok(lost.reads.at(-1).includes('/handoff-1/withdraw-operations/'));lost.dispose();
  const deep=setup();deep.handoffRow.state='reviewed';deep.handoffRow.revision=2;deep.handoffRow.merchantReview={operatorId:'operator',reason:'Original merchant opinion',reviewedAt:'2026-11-02T00:00:00.000Z'};deep.search='?handoffRequestId=handoff-1';deep.ownerH.rerender();await deep.ownerH.settle();assert.ok(text(deep.ownerH.value).includes('Original merchant opinion'));assert.equal(nodes(deep.ownerH.value).some(n=>n.props.label==='Withdraw this handoff request'),false);assert.equal(deep.commands.length,0);deep.search='?handoffRequestId=handoff-1&handoffRequestId=other';deep.ownerH.rerender();assert.equal(text(deep.ownerH.value).includes('Original merchant opinion'),false);deep.dispose();
  const taskH=reactHost(),task={id:'handoff-1',kind:'rental_handoff',page:'join',state:'reviewed',revision:2,requiresAction:true},taskContext={identity:'task-owner',basePath:'/merchant/enterprise',selectedCorporateId:''};const page=load('apps/enterprise-portal/src/TasksPage.tsx',{react:taskH.runtime,'react/jsx-runtime':taskH.jsx,'./enterprise-session':{useEnterprise:()=>taskContext},'@/app/locale':{useLocale:()=>({locale:'en-US'})},'@tanstack/react-query':{useQuery:()=>({data:{items:[task]},isFetching:false})},'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts',{}),'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}});taskH.mount(()=>page.EnterpriseTasksPage());const col=nodes(taskH.value).find(n=>n.type==='table').props.columns.find(c=>c.title==='Page');assert.equal(col.render(null,task).props.to,'/merchant/enterprise/join?handoffRequestId=handoff-1');taskH.unmount();
});

check('Merchant handoff smoke: frozen explicit opinion, workspace permissions, opaque original-K and exact recovery do not execute Core or rebind material', async () => {
  const setup=()=>{const hooks=reactHost(),events=emitter(),f={hooks,storage:new Map(),reads:[],writes:[],epoch:1};
    f.auth={sessionVerified:true,token:'synthetic',tenant:{tenantId:'t1'},currentWorkspaceId:'w1',user:{id:'operator',tenantId:'t1',dataScope:'all',permissions:['rental-os:corporate:manage','rental-os:order:view','rental-os:order:operate'],tenantMembership:{}},hasPermission:p=>f.auth.user.permissions.includes(p),hasTenantMembershipPermission:()=>{throw new Error('Rental route must not use tenant membership fallback');}};
    const useAuthStore=()=>f.auth;useAuthStore.getState=()=>f.auth;useAuthStore.subscribe=fn=>events.on(fn);
    f.row={id:'handoff-1',orderId:'order-1',applicantCustomerId:'p1',state:'pending',revision:1,reason:'Original personal reason',createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',effect:'request_only_no_business_change',material:{orderId:'order-1',orderNo:'Original rental',orderUpdatedAt:'2026-11-02T00:00:00.000Z',workspaceCode:'s1',corporateCustomerId:'company',corporateMembershipId:'original-relation',membershipResolvedAt:'2026-11-01T00:00:00.000Z',membershipUpdatedAt:null,enterpriseContractAndPayer:true,subjects:{contract:'corporate',payer:'corporate',user:'self'},subjectBasis:'recorded_columns',scope:'current_workspace_original_own_order',readOnly:true},privateField:'must-not-render'};
    f.result={id:'handoff-1',orderId:'order-1',state:'reviewed',revision:2,effect:'request_only_no_business_change'};
    const transport={http:{request:async config=>{if(config.method==='get'){f.reads.push(config.url);return{data:{data:f.readHandler?await f.readHandler(config.url):config.url.includes('/review-operations/')?f.receipt??{state:'not_recorded'}:plain(f.row)}};}f.writes.push(plain(config));return{data:{data:f.writeHandler?await f.writeHandler(config):plain(f.result)}};}}};
    const deps={react:hooks.runtime,'react/jsx-runtime':hooks.jsx,'@/features/auth/authStore':{useAuthStore},'@/app/queryClient':{currentSessionEpoch:()=>f.epoch,currentSessionSignal:()=>new AbortController().signal},'@/api/http':transport};
    const globals={AbortController,AbortSignal,localStorage:{getItem:k=>f.storage.get(k)??null,setItem:(k,v)=>f.storage.set(k,v),removeItem:k=>f.storage.delete(k)},navigator:{locks:{request:async(_key,fn)=>{if(f.lockBarrier)await f.lockBarrier;return fn();}}},crypto:{randomUUID:()=> 'merchant-handoff-K'}};
    f.mount=()=>{const gate=load('apps/admin/src/features/membership/original-enterprise-operation.ts',deps,globals),page=load('apps/admin/src/features/membership/EnterpriseRentalHandoffs.tsx',{...deps,'./original-enterprise-operation':gate,'@/app/locale':{useLocale:()=>({t:s=>s})},'@/components/ui':{ActionButton:'action',Alert:'alert',Input:Object.assign('input',{TextArea:'textarea'}),ConfirmAction:'confirm'}},globals);hooks.mount(()=>page.EnterpriseRentalHandoffs());};f.mount();
    f.button=label=>{const b=nodes(hooks.value).find(n=>n.props.label===label);assert.ok(b,label);return b;};f.id=value=>hooks.act(()=>nodes(hooks.value).find(n=>n.props.id==='merchant-rental-handoff-id').props.onChange({target:{value}}));f.read=()=>f.button('读取原交接申请').props.onAction();f.reason=value=>hooks.act(()=>nodes(hooks.value).find(n=>n.props.id==='merchant-rental-handoff-opinion').props.onChange({target:{value}}));
    f.prepare=async()=>{await f.id('handoff-1');await f.read();await f.reason('  Merchant original opinion  ');const b=f.button('记录本条处理意见');b.props.onStateChange('confirming');return b;};f.dispose=()=>hooks.unmount();return f;
  };
  const normal=setup(),b=await normal.prepare();assert.equal(normal.writes.length,0);await b.props.onConfirm();assert.equal(normal.writes.length,1);assert.equal(normal.writes[0].url,'/rental/v1/enterprise-handoff-requests/handoff-1/review');assert.equal(normal.writes[0].data.reason,'Merchant original opinion');assert.equal(JSON.parse(normal.writes[0].data.materialKey).privateField,undefined);assert.equal(normal.storage.size,0);normal.dispose();
  const stale=setup(),held=await stale.prepare();stale.row.reason='Changed at same revision';await assert.rejects(held.props.onConfirm());assert.equal(stale.writes.length,0);assert.equal(stale.storage.size,0);stale.dispose();
  const input=setup(),button=await input.prepare();await input.reason('Different opinion');await assert.rejects(button.props.onConfirm());assert.equal(input.writes.length,0);input.dispose();
  const lost=setup(),submit=await lost.prepare();lost.writeHandler=async()=>{throw new Error('lost response');};await assert.rejects(submit.props.onConfirm());const [key,raw]=[...lost.storage][0];assert.deepEqual(Object.keys(JSON.parse(raw)).sort(),['key','path','state']);assert.equal(raw.includes('opinion'),false);lost.hooks.unmount();lost.epoch++;lost.auth.token='new synthetic login';lost.mount();
  lost.receipt={state:'not_recorded'};await assert.rejects(lost.button('核对原交接处理结果').props.onAction());assert.equal(lost.storage.get(key),raw);lost.receipt={state:'committed',result:{...lost.result,state:'pending'}};await assert.rejects(lost.button('核对原交接处理结果').props.onAction());assert.equal(lost.storage.get(key),raw);
  lost.receipt={state:'committed',result:lost.result};await lost.button('核对原交接处理结果').props.onAction();assert.equal(lost.storage.size,0);assert.equal(lost.writes.length,1);assert.ok(lost.reads.at(-1).endsWith('/handoff-1/review-operations/merchant-handoff-K'));lost.dispose();
  const denied=setup();denied.auth.user.permissions=['rental-os:corporate:manage'];denied.hooks.rerender();assert.equal(denied.button('读取原交接申请').props.disabled,true);await assert.rejects(denied.read());assert.equal(denied.reads.length,0);denied.dispose();
});

check('Merchant application review binds one original applicant, native confirmation and current permissions; changed consent/material or late evidence cannot grant or download', async () => {
  const setup = merchantApplicationReviewFixture;
  const normal = setup(); assert.equal(normal.confirm(), undefined); await normal.review(); await normal.reason('  Reviewed original applicant  '); assert.equal(normal.confirm().props.disabled, true); await normal.verify(true);
  assert.equal(normal.table().props.dataSource[0].payload.privateToken, undefined); await assert.rejects(normal.confirm().props.onConfirm()); assert.equal(normal.writes.length, 0); normal.confirm().props.onStateChange('confirming'); await normal.confirm().props.onConfirm();
  assert.equal(normal.writes.length, 1); assert.equal(normal.writes[0].url, '/membership/enterprise-workflows/applications/application-1/decision'); assert.deepEqual(normal.writes[0].data, { decision: 'approve', verifiedRepresentative: true, expectedRevision: 1, reason: 'Reviewed original applicant', operationKey: 'merchant-application-K' }); assert.equal(normal.writes[0]._authRetry, true); assert.equal(normal.storage.size, 0); normal.dispose();
  const stale = setup(); await stale.review(); await stale.reason('Keep original reason'); const barrier = deferred(); stale.lockBarrier = barrier.promise; stale.confirm('拒绝').props.onStateChange('confirming'); const deciding = stale.confirm('拒绝').props.onConfirm(); await stale.hooks.settle(); stale.row.payload.contactName = 'Changed at the same revision'; barrier.resolve(); await assert.rejects(deciding); assert.equal(stale.writes.length, 0); assert.equal(stale.storage.size, 0); assert.equal(nodes(stale.hooks.value).find(node => node.props.id === 'enterprise-application-review-reason').props.value, 'Keep original reason'); stale.dispose();
  const changed = setup(); await changed.review(); await changed.reason('Original reason'); await changed.verify(true); changed.confirm().props.onStateChange('confirming'); await changed.verify(false); await assert.rejects(changed.confirm().props.onConfirm()); assert.equal(changed.writes.length, 0); assert.equal(changed.storage.size, 0); changed.dispose();
  const permission = setup(); await permission.review(); await permission.reason('Current reviewer'); await permission.verify(true); const held = permission.confirm(); held.props.onStateChange('confirming'); permission.auth.user.permissions = ['rental-os:corporate:manage']; await assert.rejects(held.props.onConfirm()); assert.equal(permission.writes.length, 0); assert.equal(permission.storage.size, 0); permission.dispose();
  const missing = setup(); delete missing.row.payload.agreementAcknowledgedAt; missing.hooks.rerender(); await missing.review(); await missing.reason('Request original consent evidence'); await missing.verify(true); assert.equal(missing.confirm().props.disabled, true); missing.confirm().props.onStateChange('confirming'); await assert.rejects(missing.confirm().props.onConfirm()); assert.equal(missing.writes.length, 0); missing.confirm('要求补件').props.onStateChange('confirming'); await missing.confirm('要求补件').props.onConfirm(); assert.equal(missing.writes[0].data.decision, 'supplement'); missing.dispose();
  const media = setup(), pending = deferred(); media.media = pending.promise; const evidence = media.table().props.columns.find(column => column.title === '授权材料').render(null, media.table().props.dataSource[0]); const reading = nodes(evidence).find(node => node.type === 'action').props.onAction(); await Promise.resolve(); media.row.payload.evidenceFileIds = ['replacement-file']; pending.resolve({ type: 'image/png', size: 1 }); await assert.rejects(reading); assert.equal(media.downloads, 0); assert.equal(media.writes.length, 0); media.dispose();
  const bound = setup(); await bound.review(); const other = { ...plain(bound.row), id: 'application-2', applicantCustomerId: 'another-applicant' }; bound.query.data.push(other); bound.hooks.rerender(); assert.equal(nodes(bound.actions(other)).find(node => node.props.label === '核对本条申请').props.disabled, true); await assert.rejects(nodes(bound.actions(other)).find(node => node.props.label === '核对本条申请').props.onAction()); assert.equal(bound.writes.length, 0); bound.dispose();
  const corrupt = setup(); corrupt.row.payload.contactName = 'x'.repeat(121); corrupt.hooks.rerender(); assert.deepEqual(plain(corrupt.table().props.dataSource), []); assert.ok(nodes(corrupt.hooks.value).some(node => node.props.title === '企业申请材料不可核对')); corrupt.dispose();
  const locale = load('apps/admin/src/app/locale.tsx', { react: { createContext: () => ({}) }, 'react/jsx-runtime': {} }); assert.equal(locale.translateAdminText('已核验本条原申请的代表资格及附件', 'en-US'), 'I verified the representative authority and evidence for this original application');
});

check('Merchant claim target is explicitly read and frozen with the original applicant; current administrator or changed target facts refuse before K', async () => {
  const setup = () => { const f = merchantApplicationReviewFixture(); f.row.payload.existingCorporateCustomerId = 'company'; f.claimResponse = { applicationId: 'application-1', applicationRevision: 1, corporateCustomerId: 'company', corporateName: 'Original company', legalIdentifierMasked: '913****3456', migrated: true, hasCurrentAdministrator: false, readOnly: true }; f.hooks.rerender(); return f; };
  const normal = setup(); await normal.review(); await normal.reason('Verify original claim'); await normal.verify(true); assert.equal(normal.confirm().props.disabled, true); normal.confirm().props.onStateChange('confirming'); await assert.rejects(normal.confirm().props.onConfirm()); assert.equal(normal.storage.size, 0); await normal.readClaim(); assert.equal(normal.confirm().props.disabled, false); normal.confirm().props.onStateChange('confirming'); await normal.confirm().props.onConfirm(); assert.equal(normal.writes.length, 1); assert.equal(normal.claimReads.length, 2); assert.equal(normal.writes[0].data.verifiedRepresentative, true); normal.dispose();
  const blocked = setup(); blocked.claimResponse.hasCurrentAdministrator = true; await blocked.review(); await blocked.reason('Existing admin cannot be replaced'); await blocked.verify(true); await blocked.readClaim(); assert.equal(blocked.confirm().props.disabled, true); blocked.confirm().props.onStateChange('confirming'); await assert.rejects(blocked.confirm().props.onConfirm()); assert.equal(blocked.writes.length, 0); blocked.dispose();
  const changed = setup(); await changed.review(); await changed.reason('Read original target'); await changed.verify(true); await changed.readClaim(); changed.confirm().props.onStateChange('confirming'); changed.claimHandler = async () => ({ ...changed.claimResponse, hasCurrentAdministrator: true }); await assert.rejects(changed.confirm().props.onConfirm()); assert.equal(changed.storage.size, 0); assert.equal(changed.writes.length, 0); changed.dispose();
  const stale = setup(); await stale.review(); await stale.reason('Frozen target'); await stale.verify(true); await stale.readClaim(); const original = stale.confirm(); original.props.onStateChange('confirming'); await stale.readClaim(); await assert.rejects(original.props.onConfirm()); assert.equal(stale.writes.length, 0); stale.dispose();
  const invalid = setup(); await invalid.review(); invalid.claimResponse.corporateCustomerId = 'another-company'; await assert.rejects(invalid.readClaim()); assert.equal(invalid.writes.length, 0); invalid.dispose();
});

check('Merchant application locator reads bounded original feedback without a list, preserves unknown K, and binds explicit detail review to current ID and permissions', async () => {
  const terminal = merchantApplicationReviewFixture(); terminal.query.data = undefined; terminal.query.error = new Error('bounded list unavailable'); terminal.query.refetch = forbidden('independent feedback does not read the list'); terminal.row.state = 'supplement_required'; terminal.row.revision = 3; terminal.row.decisionReason = 'Provide original authority evidence'; terminal.hooks.rerender();
  const storageKey = `rental-os:enterprise-operator-workflow:${JSON.stringify(['merchant','operator','w1','enterprise-applications','/membership/enterprise-workflows/operations'])}`, raw = JSON.stringify({ key: 'original-pending-K', path: '/membership/enterprise-workflows/applications/application-1/decision', state: 'unknown' }); terminal.storage.set(storageKey, raw); terminal.hooks.rerender();
  await terminal.setLocator('application-1'); await terminal.readFeedback(); assert.ok(text(terminal.feedback()).includes('Provide original authority evidence')); assert.ok(text(terminal.feedback()).includes('要求补件')); assert.equal(text(terminal.feedback()).includes('must-not-render'), false); assert.equal(terminal.feedbackConfirm(), undefined); assert.equal(terminal.storage.get(storageKey), raw); assert.equal(terminal.reads.length, 0); assert.equal(terminal.writes.length, 0); terminal.dispose();
  const normal = merchantApplicationReviewFixture(); normal.query.data = undefined; normal.query.error = new Error('list unavailable'); normal.query.refetch = forbidden('detail review remains independent of the list'); normal.hooks.rerender(); await normal.setLocator('application-1'); await normal.readFeedback(); assert.equal(normal.feedbackConfirm(), undefined); await normal.reviewFeedback(); await normal.reason('Reviewed original detail'); await normal.verify(true);
  normal.writeHandler = async () => { normal.row.state = 'approved'; normal.row.revision = 2; normal.row.corporateCustomerId = 'company'; return { id: 'application-1', state: 'approved', revision: 2, corporateCustomerId: 'company' }; };
  normal.feedbackConfirm().props.onStateChange('confirming'); await normal.feedbackConfirm().props.onConfirm(); normal.hooks.flush(); assert.equal(normal.writes.length, 1); assert.equal(normal.writes[0].data.expectedRevision, 1); assert.equal(normal.storage.size, 0); assert.ok(text(normal.feedback()).includes('原申请审核通过')); assert.equal(normal.materialReads.length, 4); normal.dispose();
  const switched = merchantApplicationReviewFixture(); await switched.setLocator('application-1'); await switched.readFeedback(); await switched.reviewFeedback(); await switched.reason('Keep this original reason'); await switched.verify(true); const held = switched.feedbackConfirm(); held.props.onStateChange('confirming'); assert.equal(switched.confirm(), undefined, 'list cannot borrow a detail confirmation'); await assert.rejects(switched.review());
  await switched.setLocator('application-2'); assert.equal(switched.feedback(), undefined); await assert.rejects(held.props.onConfirm()); assert.equal(switched.writes.length, 0); assert.equal(switched.storage.size, 0); assert.equal(nodes(switched.hooks.value).find(n => n.props.id === 'enterprise-application-review-reason').props.value, 'Keep this original reason'); switched.dispose();
  const invalid = merchantApplicationReviewFixture(); for (const id of ['bad/id', '../application', ' application-1 ', 'x'.repeat(192)]) { await invalid.setLocator(id); await assert.rejects(invalid.readFeedback()); } assert.equal(invalid.materialReads.length, 0); assert.equal(invalid.writes.length, 0); invalid.dispose();
  const late = merchantApplicationReviewFixture(), pending = deferred(); late.materialHandler = path => path.endsWith('/application-1') ? pending.promise : Promise.resolve({ ...plain(late.row), id: 'application-2' }); await late.setLocator('application-1'); const first = late.readFeedback(); await late.hooks.settle(); await late.setLocator('application-2'); await late.readFeedback(); pending.resolve(plain(late.row)); await assert.rejects(first); assert.equal(late.feedback().props['data-enterprise-application-feedback'], 'application-2'); assert.equal(late.writes.length, 0); late.dispose();
  const permission = merchantApplicationReviewFixture(), waiting = deferred(); permission.materialHandler = () => waiting.promise; await permission.setLocator('application-1'); const reading = permission.readFeedback(); await permission.hooks.settle(); permission.deniedPermission = 'rental-os:corporate:employee-manage'; waiting.resolve(plain(permission.row)); await assert.rejects(reading); assert.equal(permission.feedback(), undefined); assert.equal(permission.storage.size, 0); permission.dispose();
  const material = merchantApplicationReviewFixture(); material.query.error = new Error('list unavailable'); material.hooks.rerender(); await material.setLocator('application-1'); await material.readFeedback(); await material.reviewFeedback(); await material.reason('Original evidence'); material.feedbackConfirm('拒绝').props.onStateChange('confirming'); material.materialHandler = async () => ({ ...plain(material.row), payload: { ...plain(material.row.payload), authorityStatement: 'Changed after review' } }); await assert.rejects(material.feedbackConfirm('拒绝').props.onConfirm()); assert.equal(material.writes.length, 0); assert.equal(material.storage.size, 0); material.dispose();
});

check('Merchant application material reads one registered original before review and after confirmation; changed server facts, late identity or input never create K', async () => {
  const normal = merchantApplicationReviewFixture(); await normal.review(); assert.deepEqual(normal.materialReads, ['/membership/enterprise-workflows/applications/application-1']);
  await normal.reason('Original representative'); await normal.verify(true); normal.confirm().props.onStateChange('confirming'); await normal.confirm().props.onConfirm();
  assert.equal(normal.materialReads.length, 2); assert.equal(normal.writes.length, 1); assert.equal(normal.writes[0].data.expectedRevision, 1); assert.equal(normal.storage.size, 0); normal.dispose();
  const changed = merchantApplicationReviewFixture(); await changed.review(); await changed.reason('Keep reviewed reason'); changed.confirm('拒绝').props.onStateChange('confirming');
  changed.materialHandler = async () => ({ ...plain(changed.row), payload: { ...plain(changed.row.payload), contactName: 'Changed on the server at the same revision' } });
  await assert.rejects(changed.confirm('拒绝').props.onConfirm()); assert.equal(changed.writes.length, 0); assert.equal(changed.storage.size, 0); assert.equal(nodes(changed.hooks.value).find(n => n.props.id === 'enterprise-application-review-reason').props.value, 'Keep reviewed reason'); assert.equal(changed.row.payload.contactName, 'Original representative'); changed.dispose();
  const invalid = merchantApplicationReviewFixture(); invalid.materialHandler = async () => ({ ...plain(invalid.row), id: 'another-application' }); await assert.rejects(invalid.review()); assert.equal(invalid.confirm(), undefined); assert.equal(invalid.writes.length, 0); invalid.dispose();
  const permission = merchantApplicationReviewFixture(), pending = deferred(); permission.materialHandler = () => pending.promise; const reading = permission.review(); await permission.hooks.settle();
  await assert.rejects(permission.review()); assert.equal(permission.materialReads.length, 1); permission.deniedPermission = 'rental-os:corporate:employee-manage'; pending.resolve(plain(permission.row)); await assert.rejects(reading); assert.equal(permission.confirm(), undefined); assert.equal(permission.storage.size, 0); permission.dispose();
  const identity = merchantApplicationReviewFixture(), delayed = deferred(); identity.materialHandler = () => delayed.promise; const old = identity.review(); await identity.hooks.settle(); identity.remount(); delayed.resolve(plain(identity.row)); await assert.rejects(old); assert.equal(identity.confirm(), undefined); assert.equal(identity.writes.length, 0); identity.dispose();
  const input = merchantApplicationReviewFixture(); await input.review(); await input.reason('First reason'); input.confirm('拒绝').props.onStateChange('confirming'); const exact = deferred(); input.materialHandler = () => exact.promise; const deciding = input.confirm('拒绝').props.onConfirm(); await input.hooks.settle(); await input.reason('Changed while rereading'); exact.resolve(plain(input.row)); await assert.rejects(deciding); assert.equal(input.writes.length, 0); assert.equal(input.storage.size, 0); input.dispose();
});

check('Merchant application decision recovery uses exact ID/K even for local committed, preserves changed references and current dual permission, then retires before current queue reads', async () => {
  const lose = async () => {
    const f = merchantApplicationReviewFixture(); await f.review(); await f.reason('Original review reason');
    f.writeHandler = async () => { throw new Error('original decision response lost'); };
    f.confirm('拒绝').props.onStateChange('confirming'); await assert.rejects(f.confirm('拒绝').props.onConfirm()); f.hooks.flush(); return f;
  };
  const result = { id: 'application-1', state: 'rejected', revision: 2, corporateCustomerId: null }, path = '/membership/enterprise-workflows/applications/application-1/decision-operations/merchant-application-K';
  const f = await lose(), [key, raw] = [...f.storage][0]; assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['key', 'path', 'state']); assert.equal(raw.includes('Original review reason'), false);
  await assert.rejects(f.recover()); assert.equal(f.storage.get(key), raw);
  for (const invalid of [{ id: 'application-1' }, { ...result, id: 'another' }, { ...result, state: 'pending' }, { ...result, state: 'approved', corporateCustomerId: null }, { ...result, state: 'approved', corporateCustomerId: 'company' }, { ...result, revision: 3 }, { ...result, revision: '2' }, { ...result, privateToken: 'not-accepted' }]) {
    f.receipt = { state: 'committed', result: invalid }; await assert.rejects(f.recover()); assert.equal(f.storage.get(key), raw);
  }
  f.receipt = { state: 'committed', result }; const reads = f.reads.length; f.deniedPermission = 'rental-os:corporate:employee-manage'; await assert.rejects(f.recover()); assert.equal(f.reads.length, reads); assert.equal(f.storage.get(key), raw); f.deniedPermission = undefined;
  f.query.refetch = async () => { assert.equal(f.storage.has(key), false); throw new Error('current queue failed after original K retired'); };
  await assert.rejects(f.recover(), /current queue failed/u); f.hooks.flush(); assert.equal(f.storage.size, 0); assert.equal(f.writes.length, 1);
  assert.ok(nodes(f.hooks.value).some(n => n.props.title === '原审核收据已核对，不代表当前授权')); assert.ok(f.reads.every(value => value === path)); f.dispose();
  const known = merchantApplicationReviewFixture(); await known.review(); await known.reason('Known original commit'); known.query.refetch = async () => { throw new Error('current queue unavailable'); };
  known.confirm('拒绝').props.onStateChange('confirming'); await assert.rejects(known.confirm('拒绝').props.onConfirm()); known.hooks.flush(); assert.equal(JSON.parse([...known.storage.values()][0]).state, 'committed');
  await assert.rejects(known.recover()); assert.deepEqual(known.reads, [path]); assert.equal(known.storage.size, 1);
  known.remount(); known.receipt = { state: 'committed', result }; known.query.refetch = async () => ({ data: [] }); await known.recover(); assert.equal(known.storage.size, 0); assert.equal(known.writes.length, 1); known.dispose();
  const replaced = await lose(), [otherKey] = [...replaced.storage.keys()], replacement = JSON.stringify({ key: 'different-K', path: '/membership/enterprise-workflows/applications/application-2/decision', state: 'unknown' });
  replaced.readHandler = async () => { replaced.storage.set(otherKey, replacement); return { state: 'committed', result }; }; await assert.rejects(replaced.recover()); assert.equal(replaced.storage.get(otherKey), replacement); assert.equal(replaced.writes.length, 1); replaced.dispose();
  const late = await lose(), waiting = deferred(); late.readHandler = () => waiting.promise; const recovering = late.recover(); await late.hooks.settle(); late.deniedPermission = 'rental-os:corporate:employee-manage'; waiting.resolve({ state: 'committed', result }); await assert.rejects(recovering); assert.equal(late.storage.size, 1); assert.equal(late.writes.length, 1); late.dispose();
  const wrongPost = merchantApplicationReviewFixture(); await wrongPost.review(); await wrongPost.reason('Original decision'); wrongPost.writeHandler = async () => ({ ...result, id: 'another-application' }); wrongPost.confirm('拒绝').props.onStateChange('confirming'); await assert.rejects(wrongPost.confirm('拒绝').props.onConfirm()); assert.equal(wrongPost.storage.size, 1); assert.equal(wrongPost.writes.length, 1); wrongPost.dispose();
});

function policyTestMaterial() {
  return { workspaceIds: ['w1'], categoryCodes: ['vehicle'], personalPaymentAllowed: true, enterprisePaymentAllowed: true,
    approvalMode: 'per_order', noticeVersion: 'original-v1', noticeText: 'Original merchant disclosure', approvalLifetimeMinutes: 60, maxRequestAmount: '100.00', currency: 'CNY' };
}
function policyFormRuntime(hooks, Form) {
  const shared = load('packages/shared/src/core.ts', {});
  const fields = load('apps/admin/src/components/EnterprisePolicyFields.tsx', { '@rental-os/shared': shared, 'react/jsx-runtime': hooks.jsx,
    './ui/customer-entry': { Form, Checkbox: 'checkbox', Input: Object.assign('input', { TextArea: 'textarea' }), Select: 'select' } });
  const material = load('apps/admin/src/components/enterprise-policy-material.ts', { '@rental-os/shared': shared, './EnterprisePolicyFields': fields });
  return { shared, fields: { ...fields, EnterprisePolicyFields: 'policy-fields' }, material };
}

check('Policy editor preserves reviewed bounds and refuses a stale save after any policy revision changes', async () => {
  const hooks = reactHost(), values = {}, writes = [], context = { identity: 'policy-owner', tenantCode: 'merchant', selectedCorporateId: 'company', signal: new AbortController().signal, reload() {},
    entry: { corporates: [{ corporateCustomerId: 'company', actions: ['policy:manage'] }] } };
  const query = { data: { revision: 1, merchantRevision: 1, companyRevision: 1, employeeRevision: 0, merchant: policyTestMaterial(), company: policyTestMaterial(), workspaces: [], effectiveWorkspaceIds: ['w1'], effectiveCategoryCodes: ['vehicle'] },
    isFetching: false, refetch: async () => ({}) };
  const form = { resetFields() { for (const key of Object.keys(values)) delete values[key]; }, setFieldsValue: next => Object.assign(values, next), getFieldValue: name => values[name], validateFields: async () => ({ ...values }) }, Form = Object.assign('form', { useForm: () => [form] });
  const runtime = policyFormRuntime(hooks, Form);
  const operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('query host dispatch'), async run(prepare, afterCommit) { writes.push(plain(await prepare())); await afterCommit({}); } };
  const module = load('apps/enterprise-portal/src/PolicyPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, '@tanstack/react-query': { useQuery: options => options.queryKey[0] === 'enterprise-policy' ? query : { data: undefined } },
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, SaveButton: 'save', Select: 'select' },
    '@/components/EnterprisePolicyFields': runtime.fields, '@/components/enterprise-policy-material': runtime.material, '@rental-os/shared': runtime.shared,
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': { useOriginalWorkflowOperation: () => operation } });
  hooks.mount(() => module.EnterprisePolicyPage());
  const edit = () => nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Edit policy');
  await hooks.act(() => edit().props.onClick()); values.reason = 'Unsaved narrowing';
  query.data = { ...query.data, merchantRevision: 2, merchant: { ...policyTestMaterial(), workspaceIds: [], categoryCodes: [] } }; hooks.rerender();
  const save = () => nodes(hooks.value).find(n => n.type === 'save'); assert.equal(save().props.disabled, true); assert.equal(values.reason, 'Unsaved narrowing');
  const fields = nodes(hooks.value).find(n => n.type === 'policy-fields'); assert.equal(fields.props.view.merchantRevision, 1, 'editor is based on original reviewed bounds');
  await assert.rejects(save().props.onSave(), /修订/u); assert.equal(writes.length, 0);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Cancel').props.onClick());
  await hooks.act(() => edit().props.onClick()); values.reason = 'Reviewed latest limits'; await save().props.onSave(); assert.equal(writes.length, 1); assert.equal(writes[0].input.expectedRevision, 1);
});

function policyReviewConsumerFixture() {
  const f = memberRecoveryEntryFixture(), hooks = reactHost(); f.policyHooks = hooks; f.policyValues = {}; f.policyRefreshes = 0;
  f.context.entry.corporates[0].actions.push('policy:manage', 'members:read');
  f.policyView = { revision: 1, merchantRevision: 1, companyRevision: 1, employeeRevision: 0, merchant: policyTestMaterial(), company: policyTestMaterial(),
    effectiveWorkspaceIds: ['w1'], effectiveCategoryCodes: ['vehicle'], workspaces: [{ id: 'w1', name: 'Original workspace', categoryCode: 'vehicle' }] };
  f.policyQuery = { data: f.policyView, isFetching: false, refetch: async () => { f.policyRefreshes++; if (f.policyRefreshError) throw new Error('current policy unreadable'); return { data: f.policyView }; } };
  f.policyMembers = { data: { items: [f.member], total: 1 }, isFetching: false, refetch: async () => { f.policyMemberRefreshes = (f.policyMemberRefreshes ?? 0) + 1; f.policyMemberRefresh?.(); return { data: f.policyMembers.data }; } };
  const form = { resetFields() { f.policyValues = {}; }, setFieldsValue(values) { Object.assign(f.policyValues, values); }, getFieldValue: name => f.policyValues[name],
    validateFields: () => f.policyValidation ? f.policyValidation() : Promise.resolve(plain(f.policyValues)) };
  const Form = Object.assign('form', { useForm: () => [form], Item: 'field' }), runtime = policyFormRuntime(hooks, Form), gate = f.makeGate(hooks.runtime);
  const page = load('apps/enterprise-portal/src/PolicyPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: options => options.queryKey[0] === 'enterprise-policy' ? f.policyQuery : f.policyMembers },
    '@rental-os/shared': runtime.shared, '@/components/EnterprisePolicyFields': runtime.fields, '@/components/enterprise-policy-material': runtime.material,
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, SaveButton: 'save', Select: 'select' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => f.context },
    './original-workflow-operation': { useOriginalWorkflowOperation: scope => { f.policyOperation = gate.useOriginalWorkflowOperation(scope); return f.policyOperation; } } });
  f.writeHandler = async (_path, input) => ({ scopeKey: 'company', revision: input.expectedRevision + 1, policy: plain(input.policy) });
  hooks.mount(() => page.EnterprisePolicyPage());
  f.openPolicy = async () => { await hooks.act(() => nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Edit policy').props.onClick()); f.policyValues.reason = '  Explicit policy change  '; };
  f.savePolicy = () => nodes(hooks.value).find(n => n.type === 'save').props.onSave();
  const dispose = f.dispose; f.dispose = () => { hooks.unmount(); dispose(); }; return f;
}

check('Policy review freezes full material, separate arrays and original target through async validation; normal input transforms and original PUT survive', async () => {
  const f = policyReviewConsumerFixture(); f.policyView.merchant.privateNote = 'not-rendered'; f.policyHooks.rerender(); await f.openPolicy();
  const original = nodes(f.policyHooks.value).find(n => n.type === 'policy-fields').props.view;
  f.policyValues.workspaceIds.push('w2'); assert.deepEqual(f.policyView.company.workspaceIds, ['w1']); assert.deepEqual(plain(original.company.workspaceIds), ['w1']);
  f.policyValues.workspaceIds = ['w1']; assert.equal(JSON.stringify(original).includes('not-rendered'), false);
  const waiting = deferred(), frozen = plain(f.policyValues); f.policyValidation = () => waiting.promise;
  const saving = f.savePolicy(); await f.policyHooks.settle(); f.policyView.merchant.noticeText = 'Different text at the same revision';
  waiting.resolve(frozen); await assert.rejects(saving); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 0);
  assert.equal(f.policyValues.reason, '  Explicit policy change  '); assert.equal(original.merchant.noticeText, 'Original merchant disclosure'); f.dispose();

  const member = policyReviewConsumerFixture(); member.policyView.revision = 0;
  await member.policyHooks.act(() => nodes(member.policyHooks.value).find(n => n.type === 'select').props.onChange('target-r')); await member.openPolicy();
  assert.equal(member.policyValues.enterprisePaymentAllowed, false, 'no employee policy defaults to no company payment, not automatic membership authority');
  assert.equal(member.policyView.company.enterprisePaymentAllowed, true);
  const targetWait = deferred(), targetInput = plain(member.policyValues); member.policyValidation = () => targetWait.promise;
  const targetSave = member.savePolicy(); await member.policyHooks.settle(); member.member.updatedAt = '2026-11-05T03:00:01.000Z'; targetWait.resolve(targetInput);
  await assert.rejects(targetSave); assert.equal(member.commands.length, 0); assert.equal(member.storage.size, 0); member.dispose();

  const actor = policyReviewConsumerFixture(); await actor.openPolicy(); const actorWait = deferred(), actorInput = plain(actor.policyValues);
  actor.policyValidation = () => actorWait.promise; const actorSave = actor.savePolicy(); await actor.policyHooks.settle();
  actor.context.entry.corporates[0].actions = []; actor.policyHooks.rerender(); actorWait.resolve(actorInput);
  await assert.rejects(actorSave); assert.equal(actor.commands.length, 0); assert.equal(actor.storage.size, 0); actor.dispose();

  const inputs = policyReviewConsumerFixture(); await inputs.openPolicy(); const inputWait = deferred(), inputBefore = plain(inputs.policyValues);
  inputs.policyValidation = () => inputWait.promise; const inputSave = inputs.savePolicy(); await inputs.policyHooks.settle(); inputs.policyValues.reason = 'Later changed reason'; inputWait.resolve(inputBefore);
  await assert.rejects(inputSave); assert.equal(inputs.commands.length, 0); assert.equal(inputs.storage.size, 0); assert.equal(inputs.policyValues.reason, 'Later changed reason'); inputs.dispose();

  const normal = policyReviewConsumerFixture(); await normal.openPolicy(); const grants = plain(normal.context.entry);
  normal.policyValues.maxRequestAmount = ' 50.00 '; normal.policyValues.currency = ' cny '; normal.policyValues.approvalLifetimeMinutes = '30'; await normal.savePolicy(); normal.policyHooks.flush();
  assert.equal(normal.commands.length, 1); assert.equal(normal.commands[0].path, '/enterprise/corporates/company/policy'); assert.equal(normal.commands[0].method, 'PUT');
  assert.equal(normal.commands[0].input.expectedRevision, 1); assert.equal(normal.commands[0].input.reason, '  Explicit policy change  ');
  assert.equal(normal.commands[0].input.policy.maxRequestAmount, '50.00'); assert.equal(normal.commands[0].input.policy.currency, 'CNY'); assert.equal(normal.commands[0].input.policy.approvalLifetimeMinutes, 30);
  assert.equal(normal.storage.size, 0); assert.equal(normal.policyRefreshes, 1); assert.deepEqual(plain(normal.context.entry), grants); normal.dispose();
});

check('Policy original recovery retains exact existing company/member scopes after lost grants, requires narrow server evidence and never replays or projects limits', async () => {
  const f = policyReviewConsumerFixture(); await f.openPolicy(); f.writeHandler = async () => { throw new Error('lost policy response'); };
  await assert.rejects(f.savePolicy()); f.policyHooks.flush(); const own = f.referenceKey('company', 'policy:'), raw = f.storage.get(own);
  assert.deepEqual(JSON.parse(raw), { key: 'original-transfer-key', path: '/enterprise/corporates/company/policy', state: 'unknown' });
  assert.ok(!raw.includes('50.00') && !raw.includes('noticeText') && !raw.includes('reason') && !raw.includes('body'));
  const foreign = [f.referenceKey('company', 'policy:', 'another-person'), f.referenceKey('company', 'policy:', 'recipient', 'another-workspace')];
  for (const key of foreign) f.storage.set(key, '{private-foreign-policy'); f.forbiddenStorageKeys = new Set(foreign);
  f.loseManagement(); f.policyHooks.rerender(); const root = f.mountRecovery(), button = () => root.button('Read original policy save');
  assert.ok(nodes(f.policyHooks.value).some(n => typeof n.type === 'function' && n.type.name === 'EnterpriseMemberOperationRecovery'));
  assert.equal(f.context.selectedCorporateId, ''); f.receipt = { state: 'not_recorded' }; await assert.rejects(button().props.onAction()); assert.equal(f.storage.get(own), raw);
  f.receipt = { state: 'committed', result: { corporateCustomerId: 'wrong-company', scopeKey: 'company', revision: 2 } };
  await assert.rejects(button().props.onAction()); assert.equal(f.storage.get(own), raw);
  f.receipt = { state: 'committed', result: { corporateCustomerId: 'company', scopeKey: 'company', revision: 2 } };
  await button().props.onAction(); assert.equal(f.storage.has(own), false); assert.equal(f.commands.length, 1); assert.equal(f.context.selectedCorporateId, '');
  assert.ok(f.reads.every(p => p === '/enterprise/corporates/company/policy/save-operations/original-transfer-key'));
  assert.ok(f.storageReads.every(key => !foreign.includes(key))); for (const key of foreign) assert.equal(f.storage.get(key), '{private-foreign-policy'); f.dispose();

  const member = policyReviewConsumerFixture(); member.policyView.revision = 0;
  await member.policyHooks.act(() => nodes(member.policyHooks.value).find(n => n.type === 'select').props.onChange('target-r')); await member.openPolicy();
  member.writeHandler = async () => { throw new Error('lost employee policy response'); }; await assert.rejects(member.savePolicy()); member.policyHooks.flush();
  const key = member.referenceKey('company', 'policy:target-r'); member.loseManagement(); const reader = member.mountRecovery();
  member.receipt = { state: 'committed', result: { corporateCustomerId: 'company', scopeKey: 'member:target-r', revision: 1 } };
  const realm = reactHost(), gate = member.makeGate(realm.runtime); realm.mount(() => gate.useOriginalWorkflowOperation('policy:target-r', { originalCorporateId: 'company', originalOperationKey: 'original-transfer-key', originalMembershipId: 'target-r', originalPolicySave: true }));
  await assert.rejects(realm.value.run(() => ({ path: '/enterprise/corporates/company/members/target-r/policy', method: 'PUT', input: {} }), async () => {}));
  await assert.rejects(realm.value.read('/enterprise/operations/original-transfer-key')); realm.unmount();
  await reader.button('Read original policy save').props.onAction(); assert.equal(member.storage.has(key), false); assert.equal(member.commands.length, 1);
  assert.deepEqual(member.reads, ['/enterprise/corporates/company/members/target-r/policy/save-operations/original-transfer-key']); member.dispose();

  const committed = policyReviewConsumerFixture(); await committed.openPolicy(); committed.policyRefreshError = true; await assert.rejects(committed.savePolicy()); committed.policyHooks.flush();
  const committedKey = committed.referenceKey('company', 'policy:'); assert.equal(JSON.parse(committed.storage.get(committedKey)).state, 'committed');
  committed.receipt = { state: 'not_recorded' }; await assert.rejects(nodes(committed.policyHooks.value).find(n => n.props.label === 'Read original policy result').props.onAction());
  assert.equal(committed.reads.length, 1, 'a local known-commit marker still requires the original server GET'); assert.equal(committed.commands.length, 1); assert.ok(committed.storage.has(committedKey)); committed.dispose();
});

check('Employee policy sends the reviewed relation revision and refreshes conflicts without rebinding input or retiring a replaced reference', async () => {
  const open = async f => { f.policyView.revision = 0; await f.policyHooks.act(() => nodes(f.policyHooks.value).find(n => n.type === 'select').props.onChange('target-r')); await f.openPolicy(); };
  const f = policyReviewConsumerFixture(), expected = f.member.updatedAt; await open(f);
  f.writeHandler = async (_path, input) => ({ scopeKey: 'member:target-r', revision: 1, policy: plain(input.policy), membershipUpdatedAt: input.expectedMembershipUpdatedAt });
  await f.savePolicy(); f.policyHooks.flush(); assert.equal(f.commands.length, 1); assert.equal(f.commands[0].input.expectedMembershipUpdatedAt, expected);
  assert.equal(f.commands[0].input.expectedRevision, 0); assert.equal(f.commands[0].input.policy.enterprisePaymentAllowed, false);
  assert.equal(f.policyMemberRefreshes, 1); assert.equal(f.storage.size, 0); assert.equal(f.reloads, 1); f.dispose();

  const conflict = policyReviewConsumerFixture(), originalDate = conflict.member.updatedAt; await open(conflict);
  conflict.writeHandler = async (_path, input) => { assert.equal(input.expectedMembershipUpdatedAt, originalDate); conflict.member.updatedAt = '2026-11-05T03:00:01.000Z'; throw Object.assign(new Error('Original relation changed'), { status: 409, code: 'enterprise_revision_conflict' }); };
  await assert.rejects(conflict.savePolicy()); conflict.policyHooks.flush(); assert.equal(conflict.storage.size, 0); assert.equal(conflict.policyMemberRefreshes, 1);
  assert.equal(conflict.policyValues.reason, '  Explicit policy change  '); assert.equal(nodes(conflict.policyHooks.value).find(n => n.type === 'save').props.disabled, true);
  await assert.rejects(conflict.savePolicy()); assert.equal(conflict.commands.length, 1, 'old review cannot issue a second key after refresh'); conflict.dispose();

  const replaced = policyReviewConsumerFixture(); await open(replaced); const key = replaced.referenceKey('company', 'policy:target-r');
  const replacement = JSON.stringify({ key: 'another-original-key', path: '/enterprise/corporates/company/members/target-r/policy', state: 'unknown' });
  replaced.writeHandler = async () => { replaced.storage.set(key, replacement); throw Object.assign(new Error('Relation revision refused'), { status: 409, code: 'enterprise_revision_conflict' }); };
  await assert.rejects(replaced.savePolicy()); assert.equal(replaced.storage.get(key), replacement); assert.equal(replaced.policyRefreshes, 0); assert.equal(replaced.reloads, 0); assert.equal(replaced.commands.length, 1); replaced.dispose();
});

function merchantPolicyConsumerFixture() {
  const hooks = reactHost(), events = emitter(), f = { hooks, values: {}, storage: new Map(), reads: [], writes: [], epoch: 1, allowed: true, props: { corporateCustomerId: 'company' } };
  const auth = { sessionVerified: true, token: 'synthetic-operator-token', tenant: { tenantId: 'merchant' }, currentWorkspaceId: 'w1', user: { id: 'operator', tenantId: 'merchant', permissions: ['rental-os:corporate:manage'], tenantMembership: {} }, hasTenantMembershipPermission: () => f.allowed };
  f.auth = auth; const useAuthStore = () => auth; useAuthStore.getState = () => auth; useAuthStore.subscribe = listener => events.on(listener);
  const localStorage = { getItem: key => f.storage.get(key) ?? null, setItem: (key, value) => f.storage.set(key, value), removeItem: key => f.storage.delete(key) };
  const locks = new Map(), navigator = { locks: { request: (key, fn) => { const running = (locks.get(key) ?? Promise.resolve()).then(fn); locks.set(key, running.catch(() => {})); return running; } } };
  f.view = { revision: 1, merchantRevision: 1, companyRevision: 0, employeeRevision: 0, merchant: policyTestMaterial(), effectiveWorkspaceIds: [], effectiveCategoryCodes: [], workspaces: [{ id: 'w1', name: 'Original work', categoryCode: 'vehicle' }] };
  f.query = { data: f.view, isFetching: false, refetch: async () => { if (f.refreshError) throw new Error('Current limits unavailable'); return { data: f.view }; } };
  const form = { resetFields() { f.values = {}; }, setFieldsValue: values => Object.assign(f.values, values), getFieldValue: name => f.values[name], validateFields: () => f.validation ? f.validation() : Promise.resolve(plain(f.values)) };
  const Form = Object.assign('form', { useForm: () => [form], Item: 'field' }), runtime = policyFormRuntime(hooks, Form);
  f.receipt = { state: 'not_recorded' };
  const gate = load('apps/admin/src/features/membership/original-enterprise-operation.ts', { react: hooks.runtime, '@/features/auth/authStore': { useAuthStore },
    '@/app/queryClient': { currentSessionEpoch: () => f.epoch, currentSessionSignal: () => new AbortController().signal },
    '@/api/http': { http: { request: async config => { if (config.method === 'get') { f.reads.push(config.url); return { data: { data: f.readHandler ? await f.readHandler(config) : plain(f.receipt) } }; }
      f.writes.push(plain(config)); return { data: { data: f.writeHandler ? await f.writeHandler(config) : { scopeKey: 'merchant', revision: 2, policy: plain(config.data.policy) } } }; } } } },
    { localStorage, navigator, AbortController, AbortSignal, crypto: { randomUUID: () => 'merchant-policy-key' } });
  const component = load('apps/admin/src/features/membership/EnterpriseRentalPolicy.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: () => f.query }, '@/features/auth/authStore': { useAuthStore }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) },
    '@/components/ui': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, SaveButton: 'save' }, '@/components/EnterprisePolicyFields': runtime.fields,
    '@/components/enterprise-policy-material': runtime.material, './original-enterprise-operation': gate });
  hooks.mount(() => component.EnterpriseRentalPolicy(f.props));
  f.open = async () => { await hooks.act(() => nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Configure upper bounds').props.onClick()); f.values.reason = '  Reviewed merchant limits  '; };
  f.save = () => nodes(hooks.value).find(n => n.type === 'save').props.onSave();
  f.recover = () => nodes(hooks.value).find(n => n.props.label === 'Read original policy result').props.onAction(); f.dispose = () => hooks.unmount(); return f;
}

check('Merchant policy editor freezes original material and asynchronously validated input; original receipts survive failed current reads without replay', async () => {
  const stale = merchantPolicyConsumerFixture(); await stale.open(); const original = nodes(stale.hooks.value).find(n => n.type === 'policy-fields').props.view;
  stale.values.workspaceIds.push('w2'); assert.deepEqual(stale.view.merchant.workspaceIds, ['w1']); assert.deepEqual(plain(original.merchant.workspaceIds), ['w1']); stale.values.workspaceIds = ['w1'];
  const wait = deferred(), frozen = plain(stale.values); stale.validation = () => wait.promise; const saving = stale.save(); await stale.hooks.settle();
  stale.view.merchant.noticeText = 'Changed body with the same version/revision'; wait.resolve(frozen); await assert.rejects(saving);
  assert.equal(stale.writes.length, 0); assert.equal(stale.storage.size, 0); assert.equal(stale.values.reason, '  Reviewed merchant limits  '); assert.equal(original.merchant.noticeText, 'Original merchant disclosure'); stale.dispose();
  const normal = merchantPolicyConsumerFixture(); await normal.open(); normal.values.currency = ' cny '; normal.values.maxRequestAmount = ' 50.00 '; normal.values.approvalLifetimeMinutes = '30';
  await normal.save(); assert.equal(normal.writes.length, 1); assert.equal(normal.writes[0].method, 'put'); assert.equal(normal.writes[0]._authRetry, true);
  assert.equal(normal.writes[0].data.expectedRevision, 1); assert.equal(normal.writes[0].data.reason, '  Reviewed merchant limits  '); assert.equal(normal.writes[0].data.policy.currency, 'CNY'); assert.equal(normal.writes[0].data.policy.maxRequestAmount, '50.00'); assert.equal(normal.writes[0].data.policy.approvalLifetimeMinutes, 30); assert.equal(normal.storage.size, 0); normal.dispose();
  const lost = merchantPolicyConsumerFixture(); await lost.open(); lost.writeHandler = async () => { throw new Error('Lost original response'); }; await assert.rejects(lost.save()); lost.hooks.flush();
  const raw = [...lost.storage.values()][0]; assert.ok(!raw.includes('noticeText') && !raw.includes('Reviewed merchant') && !raw.includes('synthetic-operator-token'));
  await assert.rejects(lost.recover()); assert.equal([...lost.storage.values()][0], raw);
  lost.receipt = { state: 'committed', result: { corporateCustomerId: 'other', scopeKey: 'merchant', revision: 2 } }; await assert.rejects(lost.recover()); assert.equal([...lost.storage.values()][0], raw);
  lost.receipt = { state: 'committed', result: { corporateCustomerId: 'company', scopeKey: 'merchant', revision: 2 } }; lost.refreshError = true;
  await assert.rejects(lost.recover()); lost.hooks.flush(); assert.equal(lost.storage.size, 0, 'exact original retired before current read failure'); assert.equal(lost.writes.length, 1);
  assert.ok(lost.reads.every(p => p === '/membership/enterprise-workflows/corporates/company/policy/save-operations/merchant-policy-key')); assert.ok(nodes(lost.hooks.value).some(n => n.type === 'alert' && n.props.title.includes('Original policy save verified'))); lost.dispose();
  const known = merchantPolicyConsumerFixture(); await known.open(); known.refreshError = true; await assert.rejects(known.save()); known.hooks.flush();
  assert.equal(JSON.parse([...known.storage.values()][0]).state, 'committed'); await assert.rejects(known.recover()); assert.equal(known.reads.length, 1); assert.equal(known.storage.size, 1); known.dispose();
});

check('Join review binds one original request and revision; invitation material is whitelisted and transfer has an explicit decline', async () => {
  const hooks = reactHost(), commands = [], context = { identity: 'review-owner', selectedCorporateId: 'company', basePath: '/merchant/enterprise', loading: false, signal: new AbortController().signal, reload() {} };
  const rows = [{ id: 'join-1', kind: 'join_request', corporateCustomerId: 'company', applicantCustomerId: 'p1', state: 'pending', revision: 1, createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z', payload: { inviteId: 'invite-1', noticeHash: 'a'.repeat(64), department: 'Original department', employeeNo: '42', noticeText: 'Original acknowledged notice', agreementVersion: 'original-v1', acknowledgedAt: '2026-11-01T12:00:00Z', privateToken: 'must-not-render' } },
    { id: 'join-2', kind: 'join_request', corporateCustomerId: 'company', applicantCustomerId: 'p2', state: 'pending', revision: 2, createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z', payload: { inviteId: 'invite-2', noticeHash: 'b'.repeat(64), noticeText: 'Original second notice', agreementVersion: 'original-v1', acknowledgedAt: '2026-11-01T12:00:00Z' } }];
  const form = { resetFields() {}, setFieldValue() {}, setFieldsValue() {}, getFieldValue() {} }, Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
  const operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('query host must not dispatch'), async run(prepare, afterCommit) { const command = await prepare(); commands.push(plain(command)); await afterCommit({}); } };
  const review = load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx });
  const module = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: options => ({ data: options.queryKey[0] === 'enterprise-own-relations' ? [] : rows, isFetching: false, refetch: async () => ({ data: rows }) }) },
    '@/components/ui/customer-entry': { ActionButton: 'action', ConfirmAction: 'confirm', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context },
    './original-workflow-operation': { useOriginalWorkflowOperation: () => operation }, './AuthorityUpload': { AuthorityUpload: 'upload' }, './WorkflowReview': review,
    '@rental-os/web-client': { readEnterpriseInvite: () => undefined, clearEnterpriseInvite: forbidden('do not clear unrelated invitation') } });
  hooks.mount(() => module.EnterpriseJoinReviewPage());
  const actions = row => nodes(hooks.value).find(n => n.type === 'table').props.columns.find(c => c.title === 'Actions').render(null, row);
  assert.equal(actions(rows[0]).props.label, 'Review this request'); await hooks.act(() => actions(rows[0]).props.onAction());
  let tree = actions(rows[0]), approve = nodes(tree).find(n => n.props.label === 'Approve'); assert.equal(approve.props.disabled, true);
  const originalView = nodes(tree).find(n => n.type === review.EnterpriseWorkflowReview); assert.ok(originalView);
  const rendered = review.EnterpriseWorkflowReview(originalView.props); assert.ok(text(rendered).includes('Original acknowledged notice')); assert.equal(text(rendered).includes('must-not-render'), false);
  await hooks.act(() => nodes(tree).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed first original member' } }));
  tree = actions(rows[0]); approve = nodes(tree).find(n => n.props.label === 'Approve'); assert.equal(approve.props.disabled, false);
  assert.equal(actions(rows[1]).props.label, 'Review this request'); await hooks.act(() => actions(rows[1]).props.onAction());
  assert.equal(actions(rows[0]).props.label, 'Review this request'); tree = actions(rows[1]); assert.equal(nodes(tree).find(n => n.props.label === 'Approve').props.disabled, true);
  await hooks.act(() => nodes(tree).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed second original member' } }));
  rows[1] = { ...rows[1], revision: 3 }; hooks.rerender(); assert.equal(actions(rows[1]).props.label, 'Review this request', 'new request revision invalidates review');
  await hooks.act(() => actions(rows[1]).props.onAction()); tree = actions(rows[1]); await hooks.act(() => nodes(tree).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed current original member' } }));
  await nodes(actions(rows[1])).find(n => n.props.label === 'Approve').props.onConfirm(); assert.equal(commands[0].input.expectedRevision, 3); assert.equal(commands[0].path, '/enterprise/corporates/company/join-requests/join-2/decision');
  hooks.unmount(); rows.splice(0, rows.length, { ...rows[0], id: 'transfer-1', kind: 'administrator_transfer', payload: { fromCustomerId: 'outgoing', targetMembershipId: 'target-relation' } });
  hooks.mount(() => module.EnterpriseJoinPage());
  const table = nodes(hooks.value).find(n => n.type === 'table' && n.props.rowKey === 'id'), transferActions = table.props.columns.find(c => c.title === 'Actions').render(null, rows[0]);
  const decline = nodes(transferActions).find(n => n.props.label === 'Decline transfer'); assert.ok(decline); await decline.props.onAction();
  assert.equal(commands[1].input.accept, false); assert.equal(commands[1].path, '/enterprise/transfers/transfer-1/decision');
});

function transferRow() {
  return { id: 'transfer-1', kind: 'administrator_transfer', corporateCustomerId: 'company', applicantCustomerId: 'recipient', state: 'pending', revision: 7,
    createdAt: '2026-11-04T12:00:00.000Z', payload: { fromCustomerId: 'outgoing', targetMembershipId: 'target-relation',
      authorityBasis: { version: 1, fromMembershipId: 'original-outgoing-relation', fromUpdatedAt: '2026-11-04T11:00:00.001Z', targetUpdatedAt: '2026-11-04T11:00:00.002Z', permissionRevision: '3:4', actions: [...enterpriseContracts.ENTERPRISE_PORTAL_ACTIONS] },
      privateToken: 'must-not-render', currentGrants: ['must-not-render'], currentProfile: 'must-not-render' } };
}
function transferConsumerFixture(realOperation = false) {
  const hooks = reactHost(), f = { hooks, rows: [transferRow()], commands: [], reads: [], storage: new Map(), reloads: 0, generation: 'transfer-generation',
    receipt: { state: 'not_recorded' }, writeError: undefined, query: { isFetching: false, error: undefined } };
  const context = { identity: 'transfer-recipient', tenantCode: 'merchant', selectedCorporateId: 'company', basePath: '/merchant/enterprise', loading: false,
    session: { customer: { customerId: 'recipient' }, workspace: { workspaceCode: 's1' } }, signal: new AbortController().signal,
    reload() { f.reloads++; f.onReload?.(); }, async write(path, input, method) { f.commands.push(plain({ path, input, ...(method ? { method } : {}) })); if (f.writeHandler) return f.writeHandler(path, input, method); if (f.writeError) throw f.writeError; return { id: f.rows[0].id, state: 'approved', revision: 8 }; },
    async read(path) { f.reads.push(path); return f.readHandler ? f.readHandler(path) : plain(f.receipt); } };
  f.context = context;
  const localStorage = { get length() { return f.storage.size; }, key(index) { if (f.enumerationFailure) throw new Error('private storage failure'); return [...f.storage.keys()][index] ?? null; },
    getItem(key) { if (f.forbiddenStorageKeys?.has(key)) throw new Error('other owner value must not be read'); f.storageReads?.push(key); return f.storage.get(key) ?? null; },
    setItem(key, value) { if (f.storageFailure && value.includes('closureKey')) throw new Error('C storage unavailable'); if (!f.dropClosure || !value.includes('closureKey')) f.storage.set(key, value); }, removeItem: key => f.storage.delete(key) };
  const locks = new Map(), navigator = { locks: { request(name, action) { f.lockNames?.push(name); const task = (locks.get(name) ?? Promise.resolve()).then(action); locks.set(name, task.catch(() => {})); return task; } } };
  let keys = 0;
  const makeGate = (runtime = hooks.runtime) => load('apps/enterprise-portal/src/original-workflow-operation.ts', { react: runtime,
    '@rental-os/web-client': { customerSessionGeneration: () => f.generation }, './enterprise-session': { useEnterprise: () => context } },
    { localStorage, navigator, AbortSignal, crypto: { randomUUID: () => ++keys === 1 ? 'original-transfer-key' : 'closure-transfer-key' } });
  const stub = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('query host dispatch'),
    async run(prepare, afterCommit) { const command = await prepare(); f.commands.push(plain(command)); if (f.writeError) throw f.writeError; await afterCommit({}); } };
  const joinForm = { values: {}, resetFields() { this.values = {}; }, setFieldValue(key, value) { this.values[key] = value; }, getFieldValue(key) { return this.values[key]; }, setFieldsValue(values) { Object.assign(this.values, values); } }; f.joinForm = joinForm;
  const Form = Object.assign('form', { useForm: () => [joinForm], Item: 'field' });
  const mount = () => {
    const gate = realOperation ? makeGate() : undefined;
    const review = load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx });
    const page = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
      '@tanstack/react-query': { useQuery: options => ({ ...f.query, ...(options.queryKey[0] === 'enterprise-own-relations' ? f.relationsQuery ?? {} : {}), data: options.queryKey[0] === 'enterprise-own-relations' ? f.relations ?? [] : f.rows, refetch: async () => { if (f.refreshError) throw new Error('refresh failed'); return { data: options.queryKey[0] === 'enterprise-own-relations' ? f.relations ?? [] : f.rows }; } }) },
      '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', ConfirmAction: 'confirm', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Table: 'table' },
      '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context },
      './original-workflow-operation': gate ?? { useOriginalWorkflowOperation: () => stub }, './WorkflowReview': review, './AuthorityUpload': { AuthorityUpload: 'upload' },
      '@rental-os/web-client': { readEnterpriseInvite: () => undefined, clearEnterpriseInvite: forbidden('transfer must not consume an invitation') } });
    hooks.mount(() => page.EnterpriseJoinPage());
  };
  f.makeGate = makeGate;
  f.newRealm = () => { const realm = reactHost(), gate = makeGate(realm.runtime); realm.mount(() => gate.useOriginalWorkflowOperation('join')); return realm; };
  const panelHooks = reactHost(); f.panelHooks = panelHooks;
  const recovery = load('apps/enterprise-portal/src/TransferDecisionRecovery.tsx', { react: panelHooks.runtime, 'react/jsx-runtime': panelHooks.jsx,
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Checkbox: 'checkbox', ConfirmAction: 'confirm', Input: { TextArea: 'textarea' } },
    './enterprise-session': { useEnterprise: () => context }, './WorkflowReview': load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': panelHooks.jsx }) });
  f.operation = () => nodes(hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus').props.operation;
  const mountPanel = () => panelHooks.mount(() => recovery.EnterpriseTransferDecisionRecovery({ row: f.rows[0], operation: f.operation(), refresh: async () => { if (f.refreshError) throw new Error('refresh failed'); }, unavailable: Boolean(f.query.error || f.query.isFetching), english: true }));
  f.remount = () => { panelHooks.unmount(); hooks.unmount(); f.generation += '-login'; context.identity += '-login'; mount(); mountPanel(); };
  f.panel = () => { panelHooks.rerender(); return panelHooks.value; };
  f.panelButton = label => { const button = nodes(f.panel()).find(n => n.props.label === label); assert.ok(button, label); return button; };
  f.dispose = () => { panelHooks.unmount(); hooks.unmount(); };
  f.actions = () => nodes(nodes(hooks.value).find(n => n.type === 'table' && n.props.rowKey === 'id').props.columns.find(c => c.title === 'Actions').render(null, f.rows[0]));
  f.button = label => { const button = f.actions().find(n => n.props.label === label); assert.ok(button, label); return button; };
  mount(); mountPanel(); return f;
}

function memberExitConsumerFixture() {
  const f = transferConsumerFixture(true); f.rows = [];
  f.relations = [{ corporateCustomerId: 'company', corporateName: 'Original enterprise', membershipId: 'exit-member', displayName: 'Recipient',
    updatedAt: '2026-11-05T03:00:00.001Z', role: 'employee', status: 'active', department: 'Original team', employeeNo: '42', effectiveFrom: '2026-11-01T00:00:00.000Z', privateToken: 'not-rendered' }];
  f.result = { membershipId: 'exit-member', status: 'exited', updatedAt: '2026-11-05T03:00:01.001Z' };
  f.writeHandler = async () => plain(f.result); f.hooks.rerender();
  f.exitAction = () => nodes(f.hooks.value).find(n => n.type === 'table' && n.props.rowKey === 'membershipId').props.columns.find(c => c.title === 'Actions').render(null, f.relations[0]);
  f.exitReview = () => nodes(f.hooks.value).find(n => n.props['aria-label'] === 'Review enterprise exit');
  f.exitConfirm = () => nodes(f.exitReview()).find(n => n.type === 'confirm');
  f.reviewExit = async () => { await f.exitAction().props.onAction(); f.hooks.flush(); };
  f.confirmExitInputs = async (reason = 'Explicit original exit reason') => {
    await f.hooks.act(() => nodes(f.exitReview()).find(n => n.props['aria-label'] === 'Original enterprise exit reason').props.onChange({ target: { value: reason } }));
    await f.hooks.act(() => nodes(f.exitReview()).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } }));
  };
  f.exitRecovery = () => { const status = nodes(f.hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus'); return status.type(status.props); };
  f.readExit = () => nodes(f.exitRecovery()).find(n => n.props.label === 'Read original exit result').props.onAction();
  return f;
}

check('Own exit requires original row review, reason, explicit checkbox and native confirmation; current changes never rebind old input', async () => {
  const f = memberExitConsumerFixture(), before = plain(f.relations[0]);
  assert.equal(f.exitAction().props.label, 'Review this exit'); await f.reviewExit(); assert.equal(f.commands.length, 0);
  assert.ok(text(f.exitReview()).includes('Original enterprise') && text(f.exitReview()).includes(before.updatedAt));
  assert.equal(text(f.exitReview()).includes('not-rendered'), false); assert.equal(f.exitConfirm().props.disabled, true); assert.equal(f.exitConfirm().props.onUndo, undefined);
  await f.confirmExitInputs(); const stale = f.exitConfirm().props.onConfirm;
  f.relations[0] = { ...f.relations[0], updatedAt: '2026-11-05T03:00:00.002Z' }; f.hooks.rerender();
  assert.equal(f.exitConfirm().props.disabled, true); await assert.rejects(stale()); assert.equal(f.commands.length, 0);
  assert.equal(nodes(f.exitReview()).find(n => n.type === 'textarea').props.value, 'Explicit original exit reason');
  await f.reviewExit(); assert.equal(nodes(f.exitReview()).find(n => n.type === 'textarea').props.value, '');
  await f.confirmExitInputs('Reviewed current original exit');
  f.onReload = () => { assert.equal(f.storage.size, 0, 'retire the exact reference before entry reload'); };
  await f.exitConfirm().props.onConfirm(); assert.equal(f.commands.length, 1); assert.equal(f.reloads, 1);
  assert.equal(f.commands[0].path, '/enterprise/corporates/company/members/exit-member/exit');
  assert.equal(f.commands[0].input.expectedUpdatedAt, '2026-11-05T03:00:00.002Z'); assert.equal(f.commands[0].input.status, 'exited');
  assert.equal(f.commands[0].input.reason, 'Reviewed current original exit'); assert.deepEqual(plain(f.relations[0]), { ...before, updatedAt: '2026-11-05T03:00:00.002Z' }, 'UI does not set relationship or portal authority');
  f.dispose();
});

check('Lost own exit response preserves opaque original K/path; re-login reads exact company/member/K only and reloads entry after retirement', async () => {
  const f = memberExitConsumerFixture(); f.writeHandler = async () => { throw new Error('exit response lost'); };
  await f.reviewExit(); await f.confirmExitInputs(); await assert.rejects(f.exitConfirm().props.onConfirm()); f.hooks.flush();
  const reference = [...f.storage.values()][0]; assert.equal(f.commands.length, 1);
  assert.equal(reference.includes('Explicit original exit reason'), false); assert.equal(reference.includes('body'), false); assert.equal(reference.includes('not-rendered'), false);
  f.remount(); assert.equal(f.operation().blocked, true); assert.equal(f.exitAction().props.disabled, true);
  f.receipt = { state: 'not_recorded' }; await assert.rejects(f.readExit()); assert.equal(f.storage.size, 1); assert.equal(f.reloads, 0);
  assert.ok(f.reads.every(path => path === '/enterprise/corporates/company/members/exit-member/exit-operations/original-transfer-key'));
  f.receipt = { state: 'committed', result: f.result }; f.relations[0].status = 'exited'; f.hooks.rerender();
  f.onReload = () => assert.equal(f.storage.size, 0); await f.readExit(); assert.equal(f.reloads, 1); assert.equal(f.commands.length, 1);
  assert.equal(f.storage.size, 0); f.dispose();
});

check('Own exit recovery rejects missing/bad exact evidence even after a local committed marker; bad original paths never fall back to generic receipts', async () => {
  const bad = [undefined, {}, { membershipId: 'other', status: 'exited', updatedAt: '2026-11-05T03:00:01.001Z' },
    { membershipId: 'exit-member', status: 'active', updatedAt: '2026-11-05T03:00:01.001Z' }, { membershipId: 'exit-member', status: 'exited', updatedAt: '2026-02-30T03:00:01.001Z' }];
  for (const result of bad) {
    const f = memberExitConsumerFixture(); f.refreshError = true; await f.reviewExit(); await f.confirmExitInputs();
    await assert.rejects(f.exitConfirm().props.onConfirm()); f.hooks.flush(); assert.equal(f.operation().pending.state, 'committed');
    f.refreshError = false; f.receipt = { state: 'committed', result }; await assert.rejects(f.readExit()); assert.equal(f.storage.size, 1); assert.equal(f.reloads, 0);
    assert.equal(f.reads.at(-1), '/enterprise/corporates/company/members/exit-member/exit-operations/original-transfer-key'); f.dispose();
  }
  const f = memberExitConsumerFixture(); f.writeHandler = async () => ({}); await f.reviewExit(); await f.confirmExitInputs();
  await assert.rejects(f.exitConfirm().props.onConfirm()); assert.equal(f.storage.size, 1); assert.equal(f.reloads, 0);
  const [storageKey, raw] = [...f.storage][0]; f.storage.set(storageKey, JSON.stringify({ ...JSON.parse(raw), path: '/enterprise/corporates/company/members/exit-member/exit/unknown' }));
  f.remount(); const reads = f.reads.length; await assert.rejects(f.operation().recover(async () => {})); assert.equal(f.reads.length, reads); assert.equal(f.storage.size, 1); f.dispose();
});

check('Own exit identity/reference changes and failed refresh preserve pending evidence without clearing another operation or reloading entry', async () => {
  for (const failure of ['identity', 'reference', 'refresh']) {
    const f = memberExitConsumerFixture(); f.writeHandler = async () => { throw new Error('exit lost'); }; await f.reviewExit(); await f.confirmExitInputs();
    await assert.rejects(f.exitConfirm().props.onConfirm()); f.hooks.flush();
    const [storageKey, raw] = [...f.storage][0]; f.receipt = { state: 'committed', result: f.result };
    if (failure === 'refresh') f.refreshError = true;
    else f.readHandler = async () => {
      if (failure === 'identity') { f.generation += '-changed'; f.context.identity += '-changed'; }
      else f.storage.set(storageKey, JSON.stringify({ ...JSON.parse(raw), key: 'other-original-key' }));
      return plain(f.receipt);
    };
    await assert.rejects(f.readExit()); assert.equal(f.storage.size, 1); assert.equal(f.reloads, 0); assert.equal(f.commands.length, 1);
    if (failure === 'reference') assert.equal(JSON.parse(f.storage.get(storageKey)).key, 'other-original-key'); f.dispose();
  }
});

check('Own exit stores before one dispatch, blocks a second realm and stale confirmation, and never treats generic failures as a safe replay', async () => {
  const f = memberExitConsumerFixture(); await f.reviewExit(); await f.confirmExitInputs();
  f.storageFailure = true; const originalWrite = f.writeHandler;
  const savedSet = f.storage.set.bind(f.storage); f.storage.set = () => { throw new Error('storage unavailable'); };
  await assert.rejects(f.exitConfirm().props.onConfirm()); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 0);
  f.storage.set = savedSet; f.storageFailure = false; f.hooks.flush();
  f.writeHandler = async () => { assert.equal(f.storage.size, 1, 'opaque K/path must precede write'); throw Object.assign(new Error('generic server error'), { status: 503 }); };
  await assert.rejects(f.exitConfirm().props.onConfirm()); f.hooks.flush(); assert.equal(f.commands.length, 1); assert.equal(f.storage.size, 1);
  const realm = f.newRealm(); await assert.rejects(realm.value.run(() => ({ path: '/enterprise/corporates/company/members/exit-member/exit', input: {} }), async () => {}));
  assert.equal(f.commands.length, 1); realm.unmount(); f.dispose();
  const stale = memberExitConsumerFixture(); await stale.reviewExit(); await stale.confirmExitInputs(); const confirm = stale.exitConfirm().props.onConfirm;
  stale.relationsQuery = { isFetching: true }; stale.hooks.rerender(); await assert.rejects(confirm()); assert.equal(stale.commands.length, 0); stale.dispose();
});

function merchantBootstrap(phone = '+86 (400) 800-1234') {
  return { apiVersion: 'v1', tenantCode: 'merchant', client: 'web', merchant: { name: 'Original merchant', servicePhone: phone, serviceHours: 'Mon-Fri 09:00-18:00', privateToken: 'not-for-display', logoUrl: 'javascript:never-follow' },
    adminLogin: { privateToken: 'not-for-display' }, services: [], source: 'workspace_directory' };
}
function merchantContactFixture() {
  const hooks = reactHost(), f = { hooks, reads: [], result: merchantBootstrap() };
  const context = { identity: 'contact-owner', tenantCode: 'merchant', loading: false, session: { customer: { customerId: 'p1' } }, signal: new AbortController().signal,
    read: async (path, signal) => { f.reads.push({ path, signal }); return f.readHandler ? f.readHandler(path, signal) : plain(f.result); }, write: forbidden('merchant contact must never write') };
  const module = load('apps/enterprise-portal/src/MerchantContact.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert' }, './enterprise-session': { useEnterprise: () => context } }, { AbortController, AbortSignal });
  f.context = context; f.module = module;
  hooks.mount(() => module.EnterpriseMerchantContact({ english: true }));
  f.button = () => nodes(hooks.value).find(n => n.props.label === 'Read merchant contact');
  f.link = () => nodes(hooks.value).find(n => n.type === 'a');
  f.read = async () => { await f.button().props.onAction(); hooks.flush(); };
  return f;
}

check('Own fulfillment smoke: explicit current-service personal GET, bounded original fields, late/foreign isolation and no handoff, counts, grants or original-K changes', async () => {
  const setup = () => {
    const hooks = reactHost(), f = { hooks, reads: [], originalK: new Map([['exit-K','unresolved-original']]) };
    f.context = { identity:'fulfillment-owner',tenantCode:'merchant',loading:false,selectedCorporateId:'',session:{customer:{customerId:'recipient',customerType:'personal'},workspace:{workspaceCode:'service-1'}},signal:new AbortController().signal,
      read:async(path,signal)=>{f.reads.push({path,signal});return f.handler?f.handler():f.response;},write:forbidden('fulfillment never writes'),reload:forbidden('fulfillment never grants'),selectCorporate:forbidden('personal order never selects an enterprise') };
    f.response = { orderId:'own-order',orderNo:'Original rental',status:'renting',fulfillmentMode:'self_pickup',fulfillmentLocationName:'Original pickup',startAt:'2026-11-01T00:00:00.000Z',endAt:'2026-11-10T00:00:00.000Z',allocations:[{id:'allocation-1',orderLineId:'line-1',quantity:1,status:'picked_up',assetNo:'original-asset',privateData:'must-not-render'}],privateToken:'must-not-render',corporateCustomerId:'must-not-infer',amount:999999 };
    const page = load('apps/enterprise-portal/src/OwnRentalFulfillment.tsx',{react:hooks.runtime,'react/jsx-runtime':hooks.jsx,'./enterprise-session':{useEnterprise:()=>f.context},'./original-workflow-operation':{useOriginalWorkflowOperation:forbidden('nested handoff hooks are not mounted in the parent-only host')},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Input:'input',Table:'table'}},{AbortController,AbortSignal,localStorage:{getItem:forbidden('no original K access'),setItem:forbidden('no persistent facts'),removeItem:forbidden('no original K retirement')}});
    hooks.mount(()=>page.EnterpriseOwnRentalFulfillment({english:true}));f.codec=page.ownFulfillmentMaterial;
    f.input=value=>hooks.act(()=>nodes(hooks.value).find(node=>node.props.id==='enterprise-own-fulfillment-order').props.onChange({target:{value}}));
    f.read=()=>nodes(hooks.value).find(node=>node.props.label==='Read original fulfillment').props.onAction();f.dispose=()=>hooks.unmount();return f;
  };
  const normal=setup();assert.equal(normal.reads.length,0);await normal.input('own-order');await normal.read();normal.hooks.flush();assert.deepEqual(normal.reads.map(row=>row.path),['/orders/own-order/fulfillment']);assert.equal(normal.originalK.get('exit-K'),'unresolved-original');assert.equal(text(normal.hooks.value).includes('must-not-render'),false);assert.ok(text(normal.hooks.value).includes('Original rental'));assert.ok(text(normal.hooks.value).includes('Not provided in the original record'));
  const projected=normal.codec(normal.response,'own-order');assert.equal(Object.hasOwn(projected,'effectiveEndAt'),false);assert.equal(projected.corporateCustomerId,undefined);assert.equal(projected.allocations[0].privateData,undefined);projected.allocations[0].assetNo='test-copy';assert.equal(normal.response.allocations[0].assetNo,'original-asset');normal.dispose();
  for(const transition of [async f=>f.input('another-order'),async f=>{f.context.identity='another-owner';f.hooks.rerender();},async f=>{f.context.session.workspace.workspaceCode='service-2';f.hooks.rerender();},async f=>{f.context.loading=true;f.hooks.rerender();},async f=>f.dispose()]) {
    const late=setup(),pending=deferred();await late.input('own-order');late.handler=()=>pending.promise;const reading=late.read();await late.hooks.settle();await transition(late);pending.resolve(late.response);await assert.rejects(reading);assert.equal(text(late.hooks.value).includes('Original rental'),false);assert.equal(late.originalK.get('exit-K'),'unresolved-original');late.dispose();
  }
  for(const patch of [{orderId:'another-order'},{status:'unknown'},{startAt:'invalid'},{allocations:[{id:'allocation-1',orderLineId:'line-1',quantity:0,status:'picked_up'}]}]){const bad=setup();await bad.input('own-order');Object.assign(bad.response,patch);await assert.rejects(bad.read());bad.hooks.flush();assert.equal(text(bad.hooks.value).includes('Original rental'),false);bad.dispose();}
  const stale=setup();await stale.input('own-order');const oldAction=nodes(stale.hooks.value).find(node=>node.props.label==='Read original fulfillment');await stale.input('another-order');await assert.rejects(oldAction.props.onAction());assert.equal(stale.reads.length,0);stale.dispose();
  const invalid=setup();for(const id of ['../order','https://foreign.invalid/order',' own-order ']){await invalid.input(id);await assert.rejects(invalid.read());}assert.equal(invalid.reads.length,0);invalid.dispose();
  const missing=setup();missing.context.session.workspace=undefined;missing.hooks.rerender();await assert.rejects(missing.read());assert.equal(missing.reads.length,0);missing.dispose();
  const parent=transferConsumerFixture(true);assert.ok(nodes(parent.hooks.value).some(node=>typeof node.type==='function'&&node.type.name==='EnterpriseOwnRentalFulfillment'));parent.dispose();
});

check('Merchant contact decoder accepts only exact public merchant/web binding and bounded phone/hour text; never follows raw URLs or invents fields', async () => {
  const f = merchantContactFixture(), decode = f.module.merchantContactFromBootstrap;
  assert.deepEqual(plain(decode(merchantBootstrap(), 'merchant')), { name: 'Original merchant', phone: '+86 (400) 800-1234', href: 'tel:+864008001234', hours: 'Mon-Fri 09:00-18:00' });
  const missingHours = merchantBootstrap('4008001234'); delete missingHours.merchant.serviceHours;
  assert.equal(decode(missingHours, 'merchant').hours, undefined);
  for (const phone of ['', 'javascript:alert(1)', 'https://example.test/call', '+123;ext=45', '*123#', '123\n456', '1'.repeat(33), '++12345', '<12345>']) assert.throws(() => decode(merchantBootstrap(phone), 'merchant'));
  for (const extra of [{ tenantCode: 'foreign' }, { client: 'app' }, { apiVersion: 'v2' }, { merchant: null }]) assert.throws(() => decode({ ...merchantBootstrap(), ...extra }, 'merchant'));
  for (const hours of ['x'.repeat(65), '<img src=x>', 'https://example.test/schedule']) assert.throws(() => decode({ ...merchantBootstrap(), merchant: { ...merchantBootstrap().merchant, serviceHours: hours } }, 'merchant'));
  assert.throws(() => decode(merchantBootstrap(), '')); f.hooks.unmount();
});

check('Merchant contact is explicitly read, minimally rendered and user-dialed; an unresolved exit does not block public contact or clear its K', async () => {
  const f = merchantContactFixture(); assert.equal(f.reads.length, 0); assert.equal(f.link(), undefined);
  await f.read(); assert.equal(f.reads.length, 1); assert.equal(f.reads[0].path, '/public/bootstrap?tenantCode=merchant&client=web');
  assert.equal(f.link().props.href, 'tel:+864008001234'); assert.ok(text(f.hooks.value).includes('Original merchant')); assert.ok(text(f.hooks.value).includes('Mon-Fri 09:00-18:00'));
  assert.equal(text(f.hooks.value).includes('not-for-display'), false); assert.equal(text(f.hooks.value).includes('javascript'), false);
  let prevented = false; f.link().props.onClick({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, false, 'only native link semantics, no automated call/write'); f.hooks.unmount();
  const exit = memberExitConsumerFixture(); exit.writeHandler = async () => { throw new Error('original exit unknown'); };
  await exit.reviewExit(); await exit.confirmExitInputs(); await assert.rejects(exit.exitConfirm().props.onConfirm()); exit.hooks.flush(); const original = [...exit.storage.values()][0];
  const contactNode = nodes(exit.hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'EnterpriseMerchantContact'); assert.ok(contactNode);
  const contactHost = reactHost(); const module = load('apps/enterprise-portal/src/MerchantContact.tsx', { react: contactHost.runtime, 'react/jsx-runtime': contactHost.jsx,
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert' }, './enterprise-session': { useEnterprise: () => exit.context } }, { AbortController, AbortSignal });
  exit.readHandler = async path => { assert.equal(path, '/public/bootstrap?tenantCode=merchant&client=web'); return merchantBootstrap(); };
  contactHost.mount(() => module.EnterpriseMerchantContact(contactNode.props));
  await nodes(contactHost.value).find(n => n.props.label === 'Read merchant contact').props.onAction(); contactHost.flush();
  assert.ok(nodes(contactHost.value).find(n => n.type === 'a')); assert.equal(exit.commands.length, 1); assert.equal([...exit.storage.values()][0], original);
  contactHost.unmount(); exit.dispose();
});

check('Merchant contact failed rereads discard old visible data; identity change/unmount cancel late reads and stale dial closures', async () => {
  const f = merchantContactFixture(); await f.read(); const oldLink = f.link();
  f.result = merchantBootstrap('not-a-phone'); await assert.rejects(f.read()); f.hooks.flush(); assert.equal(f.link(), undefined); assert.ok(nodes(f.hooks.value).find(n => n.type === 'alert').props.title.includes('not configured'));
  let prevented = false; oldLink.props.onClick({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true);
  const pending = deferred(); f.readHandler = () => pending.promise; const reading = f.read(); f.hooks.flush();
  const signal = f.reads.at(-1).signal; f.context.identity = 'another-owner'; f.context.tenantCode = 'another-merchant'; f.hooks.rerender(); assert.equal(signal.aborted, true);
  pending.resolve(merchantBootstrap()); await assert.rejects(reading); assert.equal(f.link(), undefined); f.hooks.unmount();
  const unmounted = merchantContactFixture(); const late = deferred(); unmounted.readHandler = () => late.promise; const result = unmounted.read(); const unmountSignal = unmounted.reads[0].signal;
  unmounted.hooks.unmount(); assert.equal(unmountSignal.aborted, true); late.resolve(merchantBootstrap()); await assert.rejects(result);
});

check('Merchant contact reread invalidates retained dial closures synchronously and coordinates double reads without submitting business commands', async () => {
  const f = merchantContactFixture(); await f.read(); const oldLink = f.link(), pending = deferred(); f.readHandler = () => pending.promise;
  const reading = f.button().props.onAction(); let prevented = false;
  oldLink.props.onClick({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true, 'reread must revoke old dial before React rerender');
  await assert.rejects(f.button().props.onAction()); assert.equal(f.reads.length, 2);
  pending.resolve(merchantBootstrap('4008005678')); await reading; f.hooks.flush(); assert.equal(f.link().props.href, 'tel:4008005678');
  f.context.session = null; f.hooks.rerender(); assert.equal(f.link(), undefined); assert.equal(f.button().props.disabled, true); f.hooks.unmount();
});

check('Handoff review shows only original registered terms, exact UTC milliseconds and shared labels; missing or malformed terms are not reconstructed', async () => {
  const hooks = reactHost(), review = load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx }), row = transferRow();
  for (const english of [false, true]) {
    const tree = review.EnterpriseWorkflowReview({ row, english }), content = text(tree);
    for (const value of ['original-outgoing-relation', '2026-11-04T11:00:00.001Z', '2026-11-04T11:00:00.002Z', '3:4']) assert.ok(content.includes(value), value);
    for (const action of enterpriseContracts.ENTERPRISE_PORTAL_ACTIONS) assert.ok(content.includes(actionLabels.enterpriseActionLabel(action, english)), action);
    assert.equal(content.includes('must-not-render'), false); assert.equal(nodes(tree).some(n => n.props.dangerouslySetInnerHTML), false);
  }
  const material = transferReview.readAdministratorTransferMaterial(row); material.actions.splice(0); assert.equal(row.payload.authorityBasis.actions.length, 12, 'review cannot mutate the original set');
  const invalid = [null, [], {}, { version: 2 }, { fromMembershipId: '' }, { fromUpdatedAt: 'not-a-revision' }, { fromUpdatedAt: '2026-11-04T11:00:00Z' },
    { targetUpdatedAt: null }, { permissionRevision: 'current' }, { permissionRevision: 4 }, { actions: [] }, { actions: ['portal:enter'] },
    { actions: ['administrators:manage'] }, { actions: ['portal:enter', 'administrators:manage', 'portal:enter'] },
    { actions: ['portal:enter', 'administrators:manage', 'script:execute'] }, { actions: 'all' }];
  for (const replacement of invalid) {
    const candidate = plain(row); candidate.payload.authorityBasis = replacement === null || Array.isArray(replacement) || Object.keys(replacement).length === 0 ? replacement : { ...candidate.payload.authorityBasis, ...replacement };
    assert.equal(transferReview.readAdministratorTransferMaterial(candidate), undefined);
    assert.ok(text(review.EnterpriseWorkflowReview({ row: candidate, english: true })).includes('cannot be accepted'));
  }
  for (const payload of [null, [], {}, { ...row.payload, fromCustomerId: '' }, { ...row.payload, targetMembershipId: '' }]) {
    assert.equal(transferReview.readAdministratorTransferMaterial({ ...row, payload }), undefined);
    assert.ok(text(review.EnterpriseWorkflowReview({ row: { ...row, payload }, english: true })).includes('cannot be accepted'));
  }
  assert.equal(transferReview.readAdministratorTransferMaterial({ ...row, kind: 'join_request' }), undefined);
});

check('Transfer acceptance is gated before dispatch for legacy material, preserves the exact original id/revision, and does not send grants; explicit decline remains separate', async () => {
  const f = transferConsumerFixture();
  assert.equal(f.button('Accept transfer').props.disabled, false); await f.button('Accept transfer').props.onAction();
  assert.deepEqual(f.commands[0], { path: '/enterprise/transfers/transfer-1/decision', input: { expectedRevision: 7, accept: true, reason: '本人明确接受管理员交接' } }); assert.equal(f.reloads, 1);
  delete f.rows[0].payload.authorityBasis; f.hooks.rerender();
  assert.equal(f.button('Accept transfer').props.disabled, true); await assert.rejects(f.button('Accept transfer').props.onAction(), /missing|unsupported/u); assert.equal(f.commands.length, 1);
  assert.equal(f.button('Decline transfer').props.disabled, false); await f.button('Decline transfer').props.onAction();
  assert.equal(f.commands[1].input.accept, false); assert.equal(f.commands[1].input.expectedRevision, 7); assert.equal(f.reloads, 1, 'decline does not claim grant changes');
  f.query.isFetching = true; f.hooks.rerender(); assert.equal(f.button('Decline transfer').props.disabled, true);
  f.query.isFetching = false; f.rows[0].state = 'approved'; f.hooks.rerender(); assert.equal(f.actions().length, 0, 'accepted transfer offers no undo'); f.hooks.unmount();
});

check('Transfer acceptance unknown survives original-gate reload and changed/missing material; no receipt or pending list cannot unlock decline or resend', async () => {
  const f = transferConsumerFixture(true); f.writeError = new Error('acceptance response lost');
  await assert.rejects(f.button('Accept transfer').props.onAction(), /response lost/u); f.hooks.flush(); assert.equal(f.commands.length, 1); assert.equal(f.reloads, 0);
  const original = [...f.storage.values()][0]; assert.ok(original.includes('original-transfer-key')); assert.ok(original.includes('/enterprise/transfers/transfer-1/decision'));
  assert.equal(original.includes('authorityBasis'), false); assert.equal(original.includes('actions'), false); assert.equal(original.includes('body'), false);
  f.rows[0].payload.authorityBasis.permissionRevision = '99:99'; f.remount();
  assert.equal(f.button('Accept transfer').props.disabled, true); assert.equal(f.button('Decline transfer').props.disabled, true);
  await assert.rejects(f.button('Decline transfer').props.onAction(), /original result|原操作/u); assert.equal(f.commands.length, 1); assert.equal([...f.storage.values()][0], original);
  const status = nodes(f.hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus'); assert.ok(status);
  const recover = f.panelButton('Read original result'); assert.ok(recover);
  await assert.rejects(recover.props.onAction()); assert.deepEqual(f.reads, ['/enterprise/transfers/transfer-1/decision-operations/original-transfer-key']); assert.equal([...f.storage.values()][0], original);
  delete f.rows[0].payload.authorityBasis; f.hooks.rerender(); await assert.rejects(f.button('Accept transfer').props.onAction(), /missing|unsupported/u);
  assert.equal(f.commands.length, 1); assert.equal([...f.storage.values()][0], original);
  f.receipt = { state: 'committed', result: { id: 'transfer-1', state: 'approved', revision: 8 } }; f.rows[0].state = 'approved';
  await recover.props.onAction(); f.hooks.flush(); assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 1); f.hooks.unmount();
});

check('Transfer recovery uses the registered joint reader and rejects unbound or malformed committed replies without replay or local marker promotion', async () => {
  const f = transferConsumerFixture(true); f.writeError = new Error('response lost');
  await assert.rejects(f.button('Accept transfer').props.onAction()); f.hooks.flush(); const original = [...f.storage.values()][0];
  const operation = () => nodes(f.hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus').props.operation;
  for (const result of [undefined, {}, { id: 'other-transfer', state: 'approved', revision: 8 }, { id: 'transfer-1', state: 'pending', revision: 8 }, { id: 'transfer-1', state: {}, revision: 8 }, { id: 'transfer-1', state: 'approved', revision: '8' }, { id: 'transfer-1', state: 'approved', revision: 1 }]) {
    f.receipt = { state: 'committed', result }; await assert.rejects(operation().recover(async () => {})); f.hooks.flush();
    assert.equal([...f.storage.values()][0], original); assert.equal(operation().pending.state, 'unknown'); assert.equal(f.commands.length, 1);
  }
  assert.ok(f.reads.every(path => path === '/enterprise/transfers/transfer-1/decision-operations/original-transfer-key'));
  f.receipt = { state: 'committed', result: { id: 'transfer-1', state: 'rejected', revision: 8 } }; await operation().recover(async () => {}); f.hooks.flush();
  assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 1); f.hooks.unmount();
});

check('Transfer original reader isolates late reference changes, refresh failure and unsafe cached paths; it never overwrites or clears another original', async () => {
  for (const phase of ['reading', 'refreshing']) {
    const f = transferConsumerFixture(true); f.writeError = new Error('response lost'); await assert.rejects(f.button('Accept transfer').props.onAction()); f.hooks.flush();
    const operation = nodes(f.hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus').props.operation, storageKey = [...f.storage.keys()][0];
    const foreign = JSON.stringify({ key: 'another-original', path: '/enterprise/transfers/other-transfer/decision', state: 'unknown' });
    f.context.read = async path => { f.reads.push(path); if (phase === 'reading') f.storage.set(storageKey, foreign); return { state: 'committed', result: { id: 'transfer-1', state: 'approved', revision: 8 } }; };
    await assert.rejects(operation.recover(async () => { if (phase === 'refreshing') f.storage.set(storageKey, foreign); }));
    assert.equal(f.storage.get(storageKey), foreign); assert.equal(f.commands.length, 1); f.hooks.unmount();
  }
  const f = transferConsumerFixture(true); f.writeError = new Error('response lost'); await assert.rejects(f.button('Accept transfer').props.onAction()); f.hooks.flush();
  const storageKey = [...f.storage.keys()][0], unsafe = JSON.stringify({ key: 'original-transfer-key', path: '/enterprise/transfers/%2Fother/decision', state: 'unknown' });
  f.storage.set(storageKey, unsafe); f.remount();
  const operation = nodes(f.hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus').props.operation;
  await assert.rejects(operation.recover(async () => {}), /transfer reference|交接路径/u); assert.equal(f.reads.length, 0); assert.equal(f.storage.get(storageKey), unsafe); assert.equal(f.commands.length, 1); f.hooks.unmount();
});

function transferResolution(f, outcome = 'closed') {
  return { version: 1, purpose: 'administrator_transfer_resolution', outcome, tenantId: 'tenant-uuid', corporateCustomerId: 'company', applicantCustomerId: 'recipient', transferId: f.rows[0].id,
    originalOperationKey: 'original-transfer-key', closureOperationKey: 'closure-transfer-key', decision: { id: f.rows[0].id, state: outcome === 'closed' ? 'rejected' : 'approved', revision: f.rows[0].revision + 1 }, retryable: false };
}
async function unknownTransfer(f) { f.writeError = new Error('original acceptance response lost'); await assert.rejects(f.button('Accept transfer').props.onAction()); f.hooks.flush(); }
function installTransferProof(f, resolution) {
  f.readHandler = async path => path.endsWith('/operations/closure-transfer-key') ? { state: 'committed', result: plain(resolution) }
    : { state: 'committed', result: resolution.outcome === 'closed' ? plain(resolution) : plain(resolution.decision) };
}

check('Transfer C is durably saved without business input before one dispatch; lost response and reload only read the exact K/C pair', async () => {
  const f = transferConsumerFixture(true); await unknownTransfer(f); const original = [...f.storage.values()][0];
  f.writeHandler = async (_path, input) => { const saved = [...f.storage.values()][0]; assert.ok(saved.includes('closure-transfer-key')); assert.ok(saved.includes('original-transfer-key')); assert.equal(saved.includes('Confidential refusal reason'), false); assert.equal(input.confirm, true); throw new Error('C response lost'); };
  await assert.rejects(f.operation().closeTransferDecision(() => ({ expectedRevision: 7, reason: 'Confidential refusal reason' }), async () => {})); f.hooks.flush();
  assert.equal(f.commands.length, 2); assert.equal(f.commands[1].path, '/enterprise/transfers/transfer-1/decision-operations/original-transfer-key/close');
  const retained = [...f.storage.values()][0]; assert.notEqual(retained, original); assert.equal(retained.includes('body'), false);
  await assert.rejects(f.operation().closeTransferDecision(() => ({ expectedRevision: 7, reason: 'second C' }), async () => {})); assert.equal(f.commands.length, 2);
  f.remount(); assert.equal([...f.storage.values()][0], retained); installTransferProof(f, transferResolution(f));
  await f.panelButton('Read original K/C result').props.onAction(); assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 2); assert.equal(f.reloads, 0);
  assert.deepEqual(f.reads, ['/enterprise/transfers/transfer-1/decision-operations/original-transfer-key', '/enterprise/operations/closure-transfer-key']); f.dispose();
});

check('Transfer C absence and corrupted named evidence never clear K/C or re-dispatch; both actor/target/key/corporate/tenant and decision must match', async () => {
  const f = transferConsumerFixture(true); await unknownTransfer(f); f.writeHandler = async () => { throw new Error('C response lost'); };
  await assert.rejects(f.operation().closeTransferDecision(() => ({ expectedRevision: 7, reason: 'Explicit refusal' }), async () => {})); f.hooks.flush();
  const saved = [...f.storage.values()][0], resolution = transferResolution(f);
  for (const update of [{ applicantCustomerId: 'other' }, { transferId: 'other' }, { originalOperationKey: 'other' }, { closureOperationKey: 'other' }, { corporateCustomerId: 'other' }, { tenantId: 'other' }, { version: 2 }, { retryable: true }, { outcome: 'observed' }]) {
    f.readHandler = async path => path.endsWith('/operations/closure-transfer-key') ? { state: 'committed', result: { ...resolution, ...update } } : { state: 'committed', result: resolution };
    await assert.rejects(f.operation().recoverTransferDecision(async () => {})); assert.equal([...f.storage.values()][0], saved);
  }
  f.readHandler = async path => path.endsWith('/operations/closure-transfer-key') ? { state: 'not_recorded' } : { state: 'committed', result: resolution };
  await assert.rejects(f.operation().recoverTransferDecision(async () => {})); assert.equal([...f.storage.values()][0], saved); assert.equal(f.commands.length, 2); f.dispose();
});

check('Only a direct named pre-write C refusal retires C, never K; generic 503/auth failure or GET unavailable preserves both references', async () => {
  for (const [status, code] of [[503, 'enterprise_transfer_resolution_unavailable'], [409, 'enterprise_revision_conflict'], [503, undefined], [403, undefined]]) {
    const f = transferConsumerFixture(true); await unknownTransfer(f); const original = [...f.storage.values()][0];
    f.writeHandler = async () => { throw Object.assign(new Error('C refused'), { status, code }); };
    await assert.rejects(f.operation().closeTransferDecision(() => ({ expectedRevision: 7, reason: 'Explicit refusal' }), async () => {})); f.hooks.flush();
    const known = Boolean(code); assert.equal([...f.storage.values()][0] === original, known); assert.equal(Boolean(f.operation().pending.closureKey), !known); assert.equal(f.commands.length, 2);
    if (!known) { f.readHandler = async () => { throw Object.assign(new Error('read unavailable'), { status: 503, code: 'enterprise_transfer_resolution_unavailable' }); }; const retained = [...f.storage.values()][0]; await assert.rejects(f.operation().recoverTransferDecision(async () => {})); assert.equal([...f.storage.values()][0], retained); }
    f.dispose();
  }
  const f = transferConsumerFixture(true); await unknownTransfer(f); f.writeHandler = async () => { f.generation += '-changed'; throw Object.assign(new Error('late named refusal'), { status: 503, code: 'enterprise_transfer_resolution_unavailable' }); };
  await assert.rejects(f.operation().closeTransferDecision(() => ({ expectedRevision: 7, reason: 'Explicit refusal' }), async () => {}));
  assert.ok([...f.storage.values()][0].includes('closure-transfer-key'), 'a new identity never retires the old C from a late response'); assert.equal(f.commands.length, 2); f.dispose();
});

check('Transfer C storage failure blocks dispatch, and refresh or a late reference replacement cannot erase an unconfirmed pair', async () => {
  const concurrent = transferConsumerFixture(true); await unknownTransfer(concurrent); concurrent.writeHandler = async () => { throw new Error('C lost'); };
  const first = concurrent.newRealm(), second = concurrent.newRealm();
  const outcomes = await Promise.allSettled([first.value.closeTransferDecision(() => ({ expectedRevision: 7, reason: 'Explicit first refusal' }), async () => {}), second.value.closeTransferDecision(() => ({ expectedRevision: 7, reason: 'Explicit second refusal' }), async () => {})]);
  assert.ok(outcomes.every(outcome => outcome.status === 'rejected')); assert.equal(concurrent.commands.length, 2, 'two independent realms dispatch only one C under the original Web Lock');
  assert.ok([...concurrent.storage.values()][0].includes('closure-transfer-key')); first.unmount(); second.unmount(); concurrent.dispose();
  for (const drop of [false, true]) {
    const f = transferConsumerFixture(true); await unknownTransfer(f); f.storageFailure = !drop; f.dropClosure = drop;
    await assert.rejects(f.operation().closeTransferDecision(() => ({ expectedRevision: 7, reason: 'Explicit refusal' }), async () => {})); assert.equal(f.commands.length, 1); assert.equal(Boolean(JSON.parse([...f.storage.values()][0]).closureKey), false); f.dispose();
  }
  const f = transferConsumerFixture(true); await unknownTransfer(f); f.writeHandler = async () => ({}); const resolution = transferResolution(f); installTransferProof(f, resolution);
  await assert.rejects(f.operation().closeTransferDecision(() => ({ expectedRevision: 7, reason: 'Explicit refusal' }), async () => { throw new Error('refresh failed'); })); f.hooks.flush();
  assert.ok([...f.storage.values()][0].includes('closure-transfer-key')); const storageKey = [...f.storage.keys()][0], foreign = JSON.stringify({ key: 'foreign-K', path: '/enterprise/transfers/foreign/decision', state: 'unknown' });
  await assert.rejects(f.operation().recoverTransferDecision(async () => { f.storage.set(storageKey, foreign); })); assert.equal(f.storage.get(storageKey), foreign); assert.equal(f.commands.length, 2); f.dispose();
});

check('Transfer refusal UI requires this original review, reason and explicit confirmation; changed revisions are not rebound and existing C has no retry action', async () => {
  const f = transferConsumerFixture(true); await unknownTransfer(f);
  await f.panelHooks.act(() => f.panelButton('Review original refusal').props.onAction());
  let confirm = f.panelButton('Confirm original refusal'); assert.equal(confirm.props.disabled, true);
  await f.panelHooks.act(() => nodes(f.panel()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed refusal' } }));
  await f.panelHooks.act(() => nodes(f.panel()).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } })); assert.equal(f.panelButton('Confirm original refusal').props.disabled, false);
  f.rows[0] = { ...f.rows[0], revision: 8 }; confirm = f.panelButton('Confirm original refusal'); assert.equal(confirm.props.disabled, true); await assert.rejects(confirm.props.onConfirm()); assert.equal(f.commands.length, 1);
  await f.panelHooks.act(() => f.panelButton('Review original refusal').props.onAction()); assert.equal(f.panelButton('Confirm original refusal').props.disabled, true);
  await f.panelHooks.act(() => nodes(f.panel()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed current original' } }));
  await f.panelHooks.act(() => nodes(f.panel()).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } })); f.writeHandler = async () => { throw new Error('C lost'); };
  await assert.rejects(f.panelButton('Confirm original refusal').props.onConfirm()); f.hooks.flush(); assert.equal(f.commands[1].input.expectedRevision, 8);
  assert.equal(nodes(f.panel()).some(n => n.props.label === 'Confirm original refusal'), false); assert.ok(f.panelButton('Read original K/C result')); f.dispose();
});

check('Verified original acceptance reloads portal entry only after reference retirement; decline/closed results never claim an undo or new authority', async () => {
  for (const closure of [false, true]) {
    const f = transferConsumerFixture(true); await unknownTransfer(f); const controller = new AbortController(); f.context.signal = controller.signal;
    f.onReload = () => { assert.equal(f.storage.size, 0, 'entry reload happens outside the retired original gate'); controller.abort(); };
    if (closure) {
      await f.panelHooks.act(() => f.panelButton('Review original refusal').props.onAction());
      await f.panelHooks.act(() => nodes(f.panel()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Explicit refusal' } }));
      await f.panelHooks.act(() => nodes(f.panel()).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } })); f.writeHandler = async () => ({}); installTransferProof(f, transferResolution(f, 'observed'));
      await f.panelButton('Confirm original refusal').props.onConfirm();
    } else { f.receipt = { state: 'committed', result: { id: f.rows[0].id, state: 'approved', revision: 8 } }; await f.panelButton('Read original result').props.onAction(); }
    assert.equal(f.reloads, 1); assert.equal(f.commands.length, closure ? 2 : 1); f.dispose();
  }
});

check('A named pre-write transfer refusal releases only that attempt, retains the original workflow and never reloads authority or auto-accepts', async () => {
  const f = transferConsumerFixture(true), before = plain(f.rows[0]);
  f.writeError = Object.assign(new Error('original relationship revision changed'), { status: 409, code: 'enterprise_revision_conflict' });
  await assert.rejects(f.button('Accept transfer').props.onAction(), /revision changed/u); await f.hooks.settle();
  assert.equal(f.commands.length, 1); assert.equal(f.storage.size, 0); assert.equal(f.reloads, 0); assert.deepEqual(f.rows[0], before);
  delete f.rows[0].payload.authorityBasis; f.hooks.rerender(); assert.equal(f.button('Accept transfer').props.disabled, true);
  assert.equal(f.button('Decline transfer').props.disabled, false); assert.equal(f.commands.length, 1, 'refresh and missing material never issue another write'); f.hooks.unmount();
});

function transferInitiationConsumerFixture() {
  const f = transferConsumerFixture(true), hooks = reactHost(); f.memberHooks = hooks; f.memberRefreshes = 0;
  f.context.entry = { corporates: [{ corporateCustomerId: 'company', membershipId: 'from-r', actions: ['members:manage', 'administrators:manage'] }] };
  f.member = { membershipId: 'target-r', displayName: 'Original target', role: 'employee', status: 'active', updatedAt: '2026-11-05T03:00:00.000Z', effectiveFrom: '2026-11-01T00:00:00.000Z' };
  f.initiation = { id: 'original-workflow', state: 'pending', revision: 1 }; f.writeHandler = async () => plain(f.initiation);
  f.editorValues = {};
  const form = { resetFields() { for (const key of Object.keys(f.editorValues)) delete f.editorValues[key]; }, setFieldsValue(values) { Object.assign(f.editorValues, values); }, getFieldValue: name => f.editorValues[name], validateFields: async () => ({ ...f.editorValues }) };
  const Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
  const mount = () => {
    const gate = f.makeGate(hooks.runtime);
    const page = load('apps/enterprise-portal/src/MemberLifecycle.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
      '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select' },
      './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': { useOriginalWorkflowOperation: scope => { f.memberOperation = gate.useOriginalWorkflowOperation(scope); return f.memberOperation; } } });
    hooks.mount(() => page.EnterpriseMemberLifecycle({ member: f.member, english: true, refresh: async () => { f.memberRefreshes++; if (f.memberRefreshError) throw new Error('today member list unavailable'); } }));
  };
  const button = label => { const node = nodes(hooks.value).find(n => n.props.label === label); assert.ok(node, label); return node; };
  f.requestHandoff = () => button('Request administrator handoff').props.onAction();
  f.readHandoff = () => button('Read original handoff request').props.onAction();
  f.openMember = () => hooks.act(() => nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Edit relation').props.onClick());
  f.saveMember = () => button('Save relation').props.onSave();
  f.readMember = () => button('Read original member change').props.onAction();
  f.remountMembers = () => { hooks.unmount(); f.generation += '-login'; f.context.identity += '-login'; mount(); };
  const dispose = f.dispose; f.dispose = () => { hooks.unmount(); dispose(); };
  mount(); return f;
}

check('Lost handoff initiation response retains the original members scope K/path; re-login only reads the exact company/key and never guesses from today members', async () => {
  const f = transferInitiationConsumerFixture(), before = plain(f.member);
  f.writeHandler = async () => { throw new Error('initiation response lost'); };
  await assert.rejects(f.requestHandoff()); f.memberHooks.flush(); assert.equal(f.commands.length, 1);
  const [key, raw] = [...f.storage][0]; assert.ok(key.includes('members')); assert.ok(!key.includes('join'));
  assert.deepEqual(JSON.parse(raw), { key: 'original-transfer-key', path: '/enterprise/corporates/company/transfers', state: 'unknown' });
  assert.ok(!raw.includes('reason') && !raw.includes('body') && !raw.includes('Original target'));
  f.remountMembers(); f.receipt = { state: 'not_recorded' }; await assert.rejects(f.readHandoff()); assert.equal(f.storage.size, 1);
  f.context.entry.corporates[0].actions = []; f.memberHooks.rerender(); f.memberRefreshError = true;
  assert.ok(nodes(f.memberHooks.value).some(n => n.type === 'alert' && n.props.title.includes('does not mean it is still pending today')));
  f.receipt = { state: 'committed', result: f.initiation }; f.onReload = () => assert.equal(f.storage.size, 0, 'retirement precedes current admission reload');
  await f.readHandoff(); assert.equal(f.memberRefreshes, 0, 'current member-list authorization is not required for a historical receipt');
  assert.equal(f.reloads, 1); assert.equal(f.commands.length, 1); assert.deepEqual(plain(f.member), before);
  assert.deepEqual(f.context.entry.corporates[0].actions, []); assert.ok(f.reads.every(path => path === '/enterprise/corporates/company/transfers/request-operations/original-transfer-key')); f.dispose();
});

check('Even a locally committed handoff always uses the narrow original reader; invalid pending/revision/ID evidence keeps the key and malformed paths cannot fall back', async () => {
  for (const result of [undefined, {}, { id: '', state: 'pending', revision: 1 }, { id: 'original-workflow', state: 'approved', revision: 2 }, { id: 'original-workflow', state: 'pending', revision: '1' }, { id: 'unregistered/path', state: 'pending', revision: 1 }]) {
    const f = transferInitiationConsumerFixture(); f.memberRefreshError = true;
    await assert.rejects(f.requestHandoff()); f.memberHooks.flush(); assert.equal(f.memberOperation.pending.state, 'committed');
    f.receipt = { state: 'committed', result }; await assert.rejects(f.readHandoff()); assert.equal(f.storage.size, 1); assert.equal(f.commands.length, 1); assert.equal(f.reloads, 0);
    assert.equal(f.reads.at(-1), '/enterprise/corporates/company/transfers/request-operations/original-transfer-key'); f.dispose();
  }
  const f = transferInitiationConsumerFixture(); f.writeHandler = async () => ({}); await assert.rejects(f.requestHandoff()); f.memberHooks.flush();
  assert.equal(f.memberOperation.pending.state, 'unknown'); assert.equal(f.memberRefreshes, 0);
  const [key, raw] = [...f.storage][0]; f.storage.set(key, JSON.stringify({ ...JSON.parse(raw), path: '/enterprise/corporates/company/transfers/unregistered' }));
  f.remountMembers(); const reads = f.reads.length; await assert.rejects(f.memberOperation.recover(async () => {})); assert.equal(f.reads.length, reads); assert.equal(f.storage.size, 1); f.dispose();
});

check('Handoff initiation exact reads cannot clear a replaced key or accept a late cross-identity response; the original request is never dispatched again', async () => {
  for (const change of ['reference', 'identity', 'company', 'unmount']) {
    const f = transferInitiationConsumerFixture(); f.writeHandler = async () => { throw new Error('lost'); };
    await assert.rejects(f.requestHandoff()); f.memberHooks.flush(); const [key, raw] = [...f.storage][0];
    const pending = deferred(); f.readHandler = async () => pending.promise;
    const reading = f.readHandoff(); await Promise.resolve(); await Promise.resolve();
    if (change === 'reference') f.storage.set(key, JSON.stringify({ ...JSON.parse(raw), key: 'someone-else-key' }));
    else if (change === 'identity') { f.context.identity = 'different-person'; f.context.session = { ...f.context.session, customer: { customerId: 'different-person' } }; f.memberHooks.rerender(); }
    else if (change === 'company') { f.context.selectedCorporateId = 'other'; f.memberHooks.rerender(); }
    else f.memberHooks.unmount();
    pending.resolve({ state: 'committed', result: f.initiation }); await assert.rejects(reading);
    assert.equal(f.storage.size, 1); assert.equal(f.reloads, 0); assert.equal(f.commands.length, 1);
    assert.equal(JSON.parse(f.storage.get(key)).key, change === 'reference' ? 'someone-else-key' : 'original-transfer-key'); f.dispose();
  }
});

check('Handoff initiation rereads after a known commit refresh failed without requiring a new write or changing the target relationship', async () => {
  const f = transferInitiationConsumerFixture(), before = plain(f.member); f.memberRefreshError = true;
  await assert.rejects(f.requestHandoff()); f.memberHooks.flush(); assert.equal(f.memberRefreshes, 1);
  f.receipt = { state: 'committed', result: f.initiation }; f.onReload = () => assert.equal(f.storage.size, 0);
  await f.readHandoff(); assert.equal(f.commands.length, 1); assert.equal(f.memberRefreshes, 1); assert.equal(f.reloads, 1);
  assert.deepEqual(plain(f.member), before); assert.equal(f.storage.size, 0); f.dispose();
});

function memberRecoveryEntryFixture() {
  const f = transferInitiationConsumerFixture(); f.lockNames = []; f.storageReads = [];
  const realms = [];
  f.referenceKey = (corp = 'company', scope = 'members', customer = 'recipient', workspace = 's1', tenant = 'merchant') => 'rental-os:enterprise-workflow:' + JSON.stringify([scope, tenant, customer, workspace, corp]);
  f.reference = (corp = 'company', key = 'original-transfer-key') => JSON.stringify({ key, path: `/enterprise/corporates/${corp}/transfers`, state: 'unknown' });
  f.mountRecovery = () => {
    const hooks = reactHost(), gate = f.makeGate(hooks.runtime); realms.push(hooks);
    const module = load('apps/enterprise-portal/src/MemberOperationRecovery.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
      '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert' }, './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': gate });
    // Explicitly execute the internal component closures. Hook/JSX scheduling is
    // still substituted; this does not establish React DOM or real portal mounting.
    hooks.mount(() => {
      const tree = module.EnterpriseMemberOperationRecovery({ english: true });
      const children = nodes(tree).filter(n => typeof n.type === 'function' && n.type.name === 'OriginalMemberOperation').map(n => n.type(n.props));
      return { type: 'recovery-host', props: { children: [tree, ...children] } };
    });
    hooks.gate = gate;
    hooks.button = label => { const button = nodes(hooks.value).find(n => n.props.label === label); assert.ok(button, label); return button; };
    hooks.readOriginal = () => hooks.button('Read original handoff request').props.onAction();
    hooks.readMember = () => hooks.button('Read original member change').props.onAction();
    hooks.readAdministrator = () => hooks.button('Read original administrator change').props.onAction();
    hooks.readInviteCreation = () => hooks.button('Read original invite creation').props.onAction();
    hooks.discover = () => hooks.button('Refresh original references').props.onAction();
    return hooks;
  };
  f.loseManagement = () => { f.memberHooks.unmount(); f.context.selectedCorporateId = ''; f.context.entry = { state: 'unavailable', corporates: [], ownRelations: [] }; f.context.identity = 'personal-with-no-management'; };
  const dispose = f.dispose; f.dispose = () => { for (const realm of realms) realm.unmount(); dispose(); };
  return f;
}

check('Own member reference discovery matches only the exact existing tenant/customer/workspace namespace; foreign values are never read and corrupt/unsupported originals remain unavailable', async () => {
  const f = memberRecoveryEntryFixture(), own = f.referenceKey(); f.storage.set(own, f.reference());
  const foreign = [f.referenceKey('company', 'join'), f.referenceKey('company', 'members', 'another-person'), f.referenceKey('company', 'members', 'recipient', 'other-space'), f.referenceKey('company', 'members', 'recipient', 's1', 'other-merchant')];
  for (const key of foreign) f.storage.set(key, '{private-foreign-material'); f.forbiddenStorageKeys = new Set(foreign);
  const bad = f.referenceKey('broken'), unsupported = f.referenceKey('edited');
  f.storage.set(bad, '{private-broken-material'); f.storage.set(unsupported, JSON.stringify({ key: 'edit-key', path: '/enterprise/corporates/edited/members/member-r/policy', state: 'unknown' }));
  const gate = f.makeGate(); const refs = plain(gate.originalMemberWorkflowReferences('merchant', 'recipient', 's1'));
  assert.equal(refs.length, 3); assert.equal(refs.filter(row => row.recoverable).length, 1); assert.equal(refs.find(row => row.recoverable).operationKey, 'original-transfer-key');
  assert.ok(f.storageReads.every(key => !foreign.includes(key))); assert.equal(f.storage.size, 7);
  assert.equal(refs.some(row => JSON.stringify(row).includes('private-broken-material')), false);
  const root = f.mountRecovery(); assert.ok(nodes(root.value).some(n => n.type === 'alert' && n.props.title.includes('has no dedicated reader')));
  assert.ok(!JSON.stringify(root.value).includes('private-broken-material')); assert.equal(f.commands.length, 0); assert.equal(f.reads.length, 0); f.dispose();
});

check('Own recovery remains accessible with no selected company or member-list grant; it reads the old members K without clearing join/foreign references or locally granting authority', async () => {
  const f = memberRecoveryEntryFixture(); f.writeHandler = async () => { throw new Error('lost initiation'); };
  await assert.rejects(f.requestHandoff()); const originalKey = f.referenceKey();
  const joinKey = f.referenceKey('', 'join'), foreignKey = f.referenceKey('other-company', 'members', 'another-person');
  f.storage.set(joinKey, JSON.stringify({ key: 'own-join-K', path: '/enterprise/join', state: 'unknown' })); f.storage.set(foreignKey, '{private-foreign'); f.forbiddenStorageKeys = new Set([foreignKey]);
  const preserved = [f.storage.get(joinKey), f.storage.get(foreignKey)]; f.loseManagement(); const root = f.mountRecovery();
  assert.equal(root.button('Read original handoff request').props.disabled, false); assert.equal(f.context.selectedCorporateId, '');
  f.receipt = { state: 'not_recorded' }; await assert.rejects(root.readOriginal()); assert.ok(f.storage.has(originalKey)); assert.equal(f.reloads, 0);
  f.receipt = { state: 'committed', result: f.initiation }; f.onReload = () => assert.equal(f.storage.has(originalKey), false);
  await root.readOriginal(); assert.equal(f.reloads, 1); assert.equal(f.memberRefreshes, 0); assert.equal(f.commands.length, 1);
  assert.equal(f.reads.at(-1), '/enterprise/corporates/company/transfers/request-operations/original-transfer-key');
  assert.equal(f.lockNames[0], originalKey + ':dispatch'); assert.ok(f.lockNames.every(name => name === originalKey + ':dispatch'));
  assert.deepEqual([f.storage.get(joinKey), f.storage.get(foreignKey)], preserved); assert.equal(f.context.selectedCorporateId, ''); assert.deepEqual(f.context.entry.corporates, []);
  assert.ok(sources.get('apps/enterprise-portal/src/WorkflowPages.tsx').text.includes('<EnterpriseMemberOperationRecovery english={en}/>'), 'the actual own join page mounts the independent recovery entry'); f.dispose();
});

check('Read-only member recovery cannot dispatch writes/closure commands or generic GETs; replacing the discovered K cannot read or retire another reference', async () => {
  const f = memberRecoveryEntryFixture(); f.storage.set(f.referenceKey(), f.reference()); f.loseManagement();
  const hooks = reactHost(), gate = f.makeGate(hooks.runtime); hooks.mount(() => gate.useOriginalWorkflowOperation('members', { originalCorporateId: 'company', originalOperationKey: 'original-transfer-key' }));
  await assert.rejects(hooks.value.run(() => ({ path: '/enterprise/corporates/company/transfers', input: {} }), async () => {}));
  await assert.rejects(hooks.value.closeTransferDecision(() => ({ reason: 'no write', expectedRevision: 1 }), async () => {}));
  await assert.rejects(hooks.value.closeExtensionRequest('no write', async () => {})); await assert.rejects(hooks.value.closeExchangeRequest('no write', async () => {}));
  await assert.rejects(hooks.value.read('/enterprise/operations/original-transfer-key')); assert.equal(f.commands.length, 0); assert.equal(f.reads.length, 0);
  f.storage.set(f.referenceKey(), f.reference('company', 'replacement-K')); await assert.rejects(hooks.value.recover(async () => {}));
  assert.equal(f.reads.length, 0); assert.equal(JSON.parse(f.storage.get(f.referenceKey())).key, 'replacement-K');
  hooks.unmount(); const wrong = reactHost(); wrong.mount(() => gate.useOriginalWorkflowOperation('members', { originalCorporateId: 'company', originalOperationKey: 'wrong-K' }));
  await assert.rejects(wrong.value.recover(async () => {})); assert.equal(f.reads.length, 0); assert.equal(f.storage.size, 1); wrong.unmount(); f.dispose();
});

check('Own reference refresh never infers rollback; enumeration/bad evidence and late identity/workspace/unmount responses keep originals isolated', async () => {
  for (const change of ['identity', 'workspace', 'unmount', 'reference']) {
    const f = memberRecoveryEntryFixture(); f.storage.set(f.referenceKey(), f.reference()); f.loseManagement(); const root = f.mountRecovery(), pending = deferred();
    f.readHandler = async () => pending.promise; const reading = root.readOriginal(); await Promise.resolve(); await Promise.resolve();
    if (change === 'identity') { f.context.session = { customer: { customerId: 'another-person' }, workspace: { workspaceCode: 's1' } }; f.context.identity = 'another-person'; f.generation += '-changed'; root.rerender(); }
    else if (change === 'workspace') { f.context.session = { ...f.context.session, workspace: { workspaceCode: 'other-space' } }; f.context.identity += '-space'; f.generation += '-space'; root.rerender(); }
    else if (change === 'unmount') root.unmount();
    else f.storage.set(f.referenceKey(), f.reference('company', 'replacement-K'));
    pending.resolve({ state: 'committed', result: f.initiation }); await assert.rejects(reading);
    assert.equal(f.reloads, 0); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 1);
    if (change === 'identity' || change === 'workspace') assert.equal(JSON.stringify(root.value).includes('original-transfer-key'), false);
    f.dispose();
  }
  const f = memberRecoveryEntryFixture(); f.storage.set(f.referenceKey(), f.reference()); f.loseManagement(); f.enumerationFailure = true;
  const root = f.mountRecovery(); assert.ok(nodes(root.value).some(n => n.type === 'alert' && n.props.title.includes('could not be read')));
  assert.equal(JSON.stringify(root.value).includes('private storage failure'), false); assert.equal(f.storage.size, 1);
  f.enumerationFailure = false; await root.discover(); f.receipt = { state: 'committed', result: { id: 'wrong-state', state: 'approved', revision: 2 } };
  await assert.rejects(root.readOriginal()); assert.equal(f.storage.size, 1); assert.equal(f.reloads, 0); assert.equal(f.commands.length, 0); f.dispose();
});

check('Two own recovery realms share the original dispatch lock; the second cannot reread or clear an already retired original', async () => {
  const f = memberRecoveryEntryFixture(); f.storage.set(f.referenceKey(), f.reference()); f.loseManagement();
  const first = f.mountRecovery(), second = f.mountRecovery(), pending = deferred(); f.readHandler = async () => pending.promise;
  const reading = first.readOriginal(); await Promise.resolve(); await Promise.resolve();
  const competing = second.readOriginal(); await Promise.resolve(); await Promise.resolve(); assert.equal(f.reads.length, 1);
  pending.resolve({ state: 'committed', result: f.initiation }); await reading; await assert.rejects(competing);
  assert.equal(f.reads.length, 1); assert.equal(f.reloads, 1); assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 0); f.dispose();
});

function memberChangeConsumerFixture() {
  const f = memberRecoveryEntryFixture(); f.memberResult = { membershipId: 'target-r', status: 'suspended', updatedAt: '2026-11-05T03:00:01.001Z' };
  f.writeHandler = async () => plain(f.memberResult);
  f.reviewMember = async () => { await f.openMember(); Object.assign(f.editorValues, { status: 'suspended', department: 'Original team', employeeNo: '42', reason: 'Explicit original member change' }); };
  return f;
}

check('Member change uses the original PUT once, retains opaque company/member/K on response loss, and recovers after the member table and company selection disappear', async () => {
  const f = memberChangeConsumerFixture(), before = plain(f.member); f.writeHandler = async () => { throw new Error('lost PUT response'); };
  await f.reviewMember(); await assert.rejects(f.saveMember()); f.memberHooks.flush();
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].method, 'PUT'); assert.equal(f.commands[0].path, '/enterprise/corporates/company/members/target-r');
  const raw = f.storage.get(f.referenceKey()); assert.deepEqual(JSON.parse(raw), { key: 'original-transfer-key', path: '/enterprise/corporates/company/members/target-r', state: 'unknown' });
  assert.ok(!raw.includes('Original team') && !raw.includes('reason') && !raw.includes('body'));
  f.loseManagement(); const root = f.mountRecovery(); assert.equal(root.button('Read original member change').props.disabled, false);
  f.receipt = { state: 'not_recorded' }; await assert.rejects(root.readMember()); assert.equal(f.storage.size, 1); assert.equal(f.reloads, 0);
  f.receipt = { state: 'committed', result: f.memberResult }; f.onReload = () => assert.equal(f.storage.has(f.referenceKey()), false);
  await root.readMember(); assert.equal(f.reads.at(-1), '/enterprise/corporates/company/members/target-r/change-operations/original-transfer-key');
  assert.equal(f.commands.length, 1); assert.equal(f.memberRefreshes, 0); assert.equal(f.reloads, 1); assert.equal(f.context.selectedCorporateId, '');
  assert.deepEqual(plain(f.member), before); assert.deepEqual(f.context.entry.corporates, []); assert.ok(f.lockNames.every(name => name === f.referenceKey() + ':dispatch')); f.dispose();
});

check('Known-commit member changes still read exact original evidence; wrong target/status/date, invalid paths or non-PUT preparation cannot clear or fabricate results', async () => {
  for (const result of [undefined, { membershipId: 'other-r', status: 'suspended', updatedAt: '2026-11-05T03:00:01.001Z' }, { membershipId: 'target-r', status: 'approved', updatedAt: '2026-11-05T03:00:01.001Z' }, { membershipId: 'target-r', status: 'suspended', updatedAt: '2026-02-30T03:00:01.001Z' }]) {
    const f = memberChangeConsumerFixture(); f.memberRefreshError = true; await f.reviewMember(); await assert.rejects(f.saveMember()); f.memberHooks.flush();
    assert.equal(f.memberOperation.pending.state, 'committed'); f.receipt = { state: 'committed', result }; await assert.rejects(f.readMember());
    assert.equal(f.storage.size, 1); assert.equal(f.reloads, 0); assert.equal(f.commands.length, 1);
    assert.equal(f.reads.at(-1), '/enterprise/corporates/company/members/target-r/change-operations/original-transfer-key'); f.dispose();
  }
  for (const command of [{ path: '/enterprise/corporates/company/members/target-r/unregistered', method: 'PUT', input: {} }, { path: '/enterprise/corporates/company/members/target-r', input: {} }]) {
    const f = memberChangeConsumerFixture(); await assert.rejects(f.memberOperation.run(() => command, async () => {})); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 0); f.dispose();
  }
  const f = memberChangeConsumerFixture(); f.writeHandler = async () => ({}); await f.reviewMember(); await assert.rejects(f.saveMember()); f.memberHooks.flush();
  assert.equal(f.memberOperation.pending.state, 'unknown'); assert.equal(f.memberRefreshes, 0);
  const key = f.referenceKey(); f.storage.set(key, JSON.stringify({ ...JSON.parse(f.storage.get(key)), path: '/enterprise/corporates/company/members/target-r/unregistered' }));
  f.remountMembers(); const reads = f.reads.length; await assert.rejects(f.memberOperation.recover(async () => {})); assert.equal(f.reads.length, reads); assert.equal(f.storage.size, 1); f.dispose();
});

check('Discovered member recovery binds the original relation as well as company/K; late reference/identity/unmount responses and wrong readonly target cannot clear it', async () => {
  for (const change of ['reference', 'identity', 'unmount']) {
    const f = memberChangeConsumerFixture(); f.writeHandler = async () => { throw new Error('lost'); }; await f.reviewMember(); await assert.rejects(f.saveMember());
    f.loseManagement(); const root = f.mountRecovery(), pending = deferred(); f.readHandler = async () => pending.promise;
    const reading = root.readMember(); await Promise.resolve(); await Promise.resolve();
    if (change === 'reference') f.storage.set(f.referenceKey(), JSON.stringify({ key: 'replacement-K', path: '/enterprise/corporates/company/members/other-r', state: 'unknown' }));
    else if (change === 'identity') { f.context.identity = 'new-owner'; f.context.session = { customer: { customerId: 'new-owner' }, workspace: { workspaceCode: 's1' } }; f.generation += '-owner'; root.rerender(); }
    else root.unmount();
    pending.resolve({ state: 'committed', result: f.memberResult }); await assert.rejects(reading); assert.equal(f.storage.size, 1); assert.equal(f.reloads, 0); assert.equal(f.commands.length, 1); f.dispose();
  }
  const f = memberChangeConsumerFixture(); f.storage.set(f.referenceKey(), JSON.stringify({ key: 'member-K', path: '/enterprise/corporates/company/members/target-r', state: 'unknown' })); f.loseManagement();
  const hooks = reactHost(), gate = f.makeGate(hooks.runtime); hooks.mount(() => gate.useOriginalWorkflowOperation('members', { originalCorporateId: 'company', originalOperationKey: 'member-K', originalMembershipId: 'other-r' }));
  await assert.rejects(hooks.value.recover(async () => {})); assert.equal(f.reads.length, 0); assert.equal(f.storage.size, 1); hooks.unmount(); f.dispose();
});

check('Original member-change read accepts the three registered states as history without regranting, and a competing realm uses the same original lock', async () => {
  for (const status of ['active', 'suspended', 'exited']) {
    const f = memberChangeConsumerFixture(); f.writeHandler = async () => { throw new Error('lost'); }; await f.reviewMember(); await assert.rejects(f.saveMember()); f.loseManagement();
    const root = f.mountRecovery(); f.receipt = { state: 'committed', result: { ...f.memberResult, status } }; await root.readMember();
    assert.equal(f.commands.length, 1); assert.equal(f.reloads, 1); assert.deepEqual(f.context.entry.corporates, []); f.dispose();
  }
  const f = memberChangeConsumerFixture(); f.writeHandler = async () => { throw new Error('lost'); }; await f.reviewMember(); await assert.rejects(f.saveMember()); f.loseManagement();
  const first = f.mountRecovery(), second = f.mountRecovery(), pending = deferred(); f.readHandler = async () => pending.promise;
  const reading = first.readMember(); await Promise.resolve(); await Promise.resolve(); const competing = second.readMember(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.reads.length, 1); pending.resolve({ state: 'committed', result: f.memberResult }); await reading; await assert.rejects(competing);
  assert.equal(f.reads.length, 1); assert.equal(f.commands.length, 1); assert.equal(f.storage.size, 0); assert.equal(f.reloads, 1); f.dispose();
});

function administratorChangeConsumerFixture() {
  const f = memberRecoveryEntryFixture(), hooks = reactHost(); f.authorityHooks = hooks; f.authorityValues = {}; f.authorityRefreshes = 0; f.currentGrantReads = 0;
  f.context.entry.corporates[0].actions.unshift('portal:enter');
  f.currentAuthority = { membershipId: 'target-r', role: 'employee', actions: [], updatedAt: '2026-11-05T03:00:00.000Z', revision: 1 };
  f.authorityResult = { membershipId: 'target-r', role: 'admin', actions: ['portal:enter', 'members:manage'], updatedAt: '2026-11-05T03:00:01.001Z', revision: 2 };
  f.writeHandler = async () => plain(f.authorityResult);
  const form = { resetFields() { for (const key of Object.keys(f.authorityValues)) delete f.authorityValues[key]; }, setFieldsValue(values) { Object.assign(f.authorityValues, values); }, setFieldValue(key, value) { f.authorityValues[key] = value; }, validateFields: async () => f.authorityValidation ? f.authorityValidation() : ({ ...f.authorityValues }) };
  const Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
  const mount = () => {
    const gate = f.makeGate(hooks.runtime), module = load('apps/enterprise-portal/src/AdministratorEditor.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
      '@tanstack/react-query': { useQuery: () => ({ data: f.currentAuthority, isFetching: Boolean(f.authorityFetching), error: f.authorityQueryError, refetch: async () => { f.currentGrantReads++; return { data: f.currentAuthority }; } }) },
      '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select' },
      './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': { useOriginalWorkflowOperation: scope => { f.authorityOperation = gate.useOriginalWorkflowOperation(scope); return f.authorityOperation; } } });
    hooks.mount(() => module.EnterpriseAdministratorEditor({ member: f.member, english: true, refresh: async () => { f.authorityRefreshes++; if (f.authorityRefreshError) throw new Error('today member list unavailable'); } }));
  };
  f.reviewAdministrator = async () => { await hooks.act(() => nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Administrator authority').props.onClick()); Object.assign(f.authorityValues, { role: 'admin', actions: ['portal:enter', 'members:manage'], reason: 'Explicit original administrator change' }); };
  f.saveAdministrator = () => nodes(hooks.value).find(n => n.props.label === 'Save administrator authority').props.onSave();
  f.readAuthority = () => nodes(hooks.value).find(n => n.props.label === 'Read original authority result').props.onAction();
  f.remountAuthority = () => { hooks.unmount(); f.generation += '-login'; f.context.identity += '-login'; mount(); };
  f.loseAuthority = () => { hooks.unmount(); f.loseManagement(); };
  const dispose = f.dispose; f.dispose = () => { hooks.unmount(); dispose(); }; mount(); return f;
}

check('Administrator editor dispatches the original PUT once and own recovery reads exact company/member/action/K after grant loss, without current grants or local reauthorization', async () => {
  const f = administratorChangeConsumerFixture(); f.writeHandler = async () => { throw new Error('lost administrator PUT'); };
  await f.reviewAdministrator(); await assert.rejects(f.saveAdministrator()); f.authorityHooks.flush();
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].method, 'PUT'); assert.equal(f.commands[0].input.expectedRevision, 1);
  assert.equal(f.commands[0].input.expectedUpdatedAt, '2026-11-05T03:00:00.000Z'); assert.equal(f.commands[0].path, '/enterprise/corporates/company/members/target-r/administrator');
  const raw = f.storage.get(f.referenceKey()); assert.deepEqual(JSON.parse(raw), { key: 'original-transfer-key', path: '/enterprise/corporates/company/members/target-r/administrator', state: 'unknown' });
  assert.ok(!raw.includes('Explicit original administrator change') && !raw.includes('actions') && !raw.includes('body'));
  f.loseAuthority(); const root = f.mountRecovery(); assert.equal(root.button('Read original administrator change').props.disabled, false);
  f.receipt = { state: 'not_recorded' }; await assert.rejects(root.readAdministrator()); assert.equal(f.storage.size, 1);
  f.receipt = { state: 'committed', result: f.authorityResult }; f.onReload = () => assert.equal(f.storage.size, 0);
  await root.readAdministrator(); assert.equal(f.reads.at(-1), '/enterprise/corporates/company/members/target-r/administrator/change-operations/original-transfer-key');
  assert.equal(f.commands.length, 1); assert.equal(f.currentGrantReads, 0); assert.equal(f.authorityRefreshes, 0); assert.equal(f.reloads, 1);
  assert.equal(f.context.selectedCorporateId, ''); assert.deepEqual(f.context.entry.corporates, []); f.dispose();
});

check('Administrator known-commit recovery still reads original five fields; malformed role/actions/revision/calendar retain the K and never fallback or regrant', async () => {
  for (const change of [null, { role: ['admin'] }, { actions: ['portal:enter', 'unknown:grant'] }, { actions: ['portal:enter', 'portal:enter'] }, { actions: ['members:manage'] }, { role: 'employee', actions: ['portal:enter'] }, { revision: 0 }, { updatedAt: '2026-02-30T03:00:01.001Z' }, { membershipId: 'other-r' }]) {
    const f = administratorChangeConsumerFixture(); f.authorityRefreshError = true; await f.reviewAdministrator(); await assert.rejects(f.saveAdministrator()); f.authorityHooks.flush();
    assert.equal(f.authorityOperation.pending.state, 'committed'); f.receipt = { state: 'committed', result: change === null ? null : { ...f.authorityResult, ...change } };
    await assert.rejects(f.readAuthority()); assert.equal(f.storage.size, 1); assert.equal(f.commands.length, 1); assert.equal(f.reloads, 0);
    assert.equal(f.reads.at(-1), '/enterprise/corporates/company/members/target-r/administrator/change-operations/original-transfer-key'); f.dispose();
  }
  const f = administratorChangeConsumerFixture(); f.writeHandler = async () => ({}); await f.reviewAdministrator(); await assert.rejects(f.saveAdministrator()); f.authorityHooks.flush();
  assert.equal(f.authorityOperation.pending.state, 'unknown'); assert.equal(f.authorityRefreshes, 0);
  f.storage.set(f.referenceKey(), JSON.stringify({ ...JSON.parse(f.storage.get(f.referenceKey())), path: '/enterprise/corporates/company/members/target-r/administrator/unregistered' }));
  f.remountAuthority(); const reads = f.reads.length; await assert.rejects(f.authorityOperation.recover(async () => {})); assert.equal(f.reads.length, reads); assert.equal(f.storage.size, 1); f.dispose();
});

check('Administrator readonly recovery requires the original action family, relation and K; late identity/unmount/reference replacement responses cannot retire another original', async () => {
  const f = administratorChangeConsumerFixture(); f.storage.set(f.referenceKey(), JSON.stringify({ key: 'admin-K', path: '/enterprise/corporates/company/members/target-r/administrator', state: 'unknown' })); f.loseAuthority();
  const hooks = reactHost(), gate = f.makeGate(hooks.runtime);
  hooks.mount(() => gate.useOriginalWorkflowOperation('members', { originalCorporateId: 'company', originalOperationKey: 'admin-K', originalMembershipId: 'target-r' }));
  await assert.rejects(hooks.value.recover(async () => {})); assert.equal(f.reads.length, 0); assert.equal(f.storage.size, 1); hooks.unmount(); f.dispose();
  for (const change of ['identity', 'unmount', 'reference']) {
    const row = administratorChangeConsumerFixture(); row.writeHandler = async () => { throw new Error('lost'); }; await row.reviewAdministrator(); await assert.rejects(row.saveAdministrator()); row.loseAuthority();
    const root = row.mountRecovery(), pending = deferred(); row.readHandler = async () => pending.promise;
    const reading = root.readAdministrator(); await Promise.resolve(); await Promise.resolve();
    if (change === 'identity') { row.context.session = { customer: { customerId: 'new-owner' }, workspace: { workspaceCode: 's1' } }; row.context.identity = 'new-owner'; row.generation += '-owner'; root.rerender(); }
    else if (change === 'unmount') root.unmount();
    else row.storage.set(row.referenceKey(), JSON.stringify({ key: 'replacement-K', path: '/enterprise/corporates/company/members/other-r/administrator', state: 'unknown' }));
    pending.resolve({ state: 'committed', result: row.authorityResult }); await assert.rejects(reading); assert.equal(row.storage.size, 1); assert.equal(row.reloads, 0); assert.equal(row.commands.length, 1); row.dispose();
  }
});

check('Original administrator history accepts admin with or without grants and employee with none; two recovery realms share the original members lock without duplicate reads or writes', async () => {
  for (const [role, actions] of [['admin', ['portal:enter', 'members:manage']], ['admin', []], ['employee', []]]) {
    const f = administratorChangeConsumerFixture(); f.writeHandler = async () => { throw new Error('lost'); }; await f.reviewAdministrator(); await assert.rejects(f.saveAdministrator()); f.loseAuthority();
    const root = f.mountRecovery(); f.receipt = { state: 'committed', result: { ...f.authorityResult, role, actions } }; await root.readAdministrator();
    assert.equal(f.reloads, 1); assert.equal(f.commands.length, 1); assert.deepEqual(f.context.entry.corporates, []); f.dispose();
  }
  const f = administratorChangeConsumerFixture(); f.writeHandler = async () => { throw new Error('lost'); }; await f.reviewAdministrator(); await assert.rejects(f.saveAdministrator()); f.loseAuthority();
  const first = f.mountRecovery(), second = f.mountRecovery(), pending = deferred(); f.readHandler = async () => pending.promise;
  const reading = first.readAdministrator(); await Promise.resolve(); await Promise.resolve(); const competing = second.readAdministrator(); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.reads.length, 1); pending.resolve({ state: 'committed', result: f.authorityResult }); await reading; await assert.rejects(competing);
  assert.equal(f.reads.length, 1); assert.equal(f.commands.length, 1); assert.equal(f.storage.size, 0); assert.equal(f.reloads, 1);
  assert.ok(f.lockNames.every(name => name === f.referenceKey() + ':dispatch')); f.dispose();
});

check('Administrator original material is projected and cloned; malformed fields do not open an editor or create a key, and query/form arrays cannot mutate the review', async () => {
  for (const material of [undefined, null, [], { membershipId: 'other-r', role: 'employee', actions: [], updatedAt: '2026-11-05T03:00:00.000Z', revision: 1 },
    { membershipId: 'target-r', role: 'owner', actions: [], updatedAt: '2026-11-05T03:00:00.000Z', revision: 1 },
    { membershipId: 'target-r', role: 'admin', actions: ['portal:enter', 'portal:enter'], updatedAt: '2026-11-05T03:00:00.000Z', revision: 1 },
    { membershipId: 'target-r', role: 'employee', actions: ['portal:enter'], updatedAt: '2026-11-05T03:00:00.000Z', revision: 1 },
    { membershipId: 'target-r', role: 'employee', actions: [], updatedAt: '2026-02-30T03:00:00.000Z', revision: 1 },
    { membershipId: 'target-r', role: 'employee', actions: [], updatedAt: '2026-11-05T03:00:00.000Z', revision: 0 }]) {
    const f = administratorChangeConsumerFixture(); f.currentAuthority = material; f.authorityHooks.rerender(); await f.reviewAdministrator();
    assert.equal(nodes(f.authorityHooks.value).some(n => n.type === 'save'), false); assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 0); f.dispose();
  }
  const f = administratorChangeConsumerFixture(); f.currentAuthority = { ...f.currentAuthority, role: 'admin', actions: ['portal:enter', 'members:manage'], privateNote: 'not-rendered' };
  f.authorityHooks.rerender(); await f.reviewAdministrator(); assert.ok(text(f.authorityHooks.value).includes('2026-11-05T03:00:00.000Z'));
  assert.equal(JSON.stringify(f.authorityHooks.value).includes('not-rendered'), false);
  f.authorityValues.actions.push('administrators:manage'); assert.deepEqual(f.currentAuthority.actions, ['portal:enter', 'members:manage'], 'form receives a separate array');
  f.currentAuthority.actions.push('administrators:manage'); f.authorityHooks.rerender();
  assert.equal(nodes(f.authorityHooks.value).find(n => n.type === 'save').props.disabled, true, 'same timestamp/revision cannot hide changed original actions');
  await assert.rejects(f.saveAdministrator()); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 0); f.dispose();
});

check('Administrator role/action/reason and foreign form fields fail before durable K creation without silently trimming, filtering or delegating unavailable actions', async () => {
  const f = administratorChangeConsumerFixture(); await f.reviewAdministrator();
  for (const change of [{ role: 'owner' }, { role: 'employee', actions: ['portal:enter'] }, { actions: 'portal:enter' }, { actions: ['members:manage'] },
    { actions: ['portal:enter', 'portal:enter'] }, { actions: ['portal:enter', 'finance:read'] }, { reason: ' ' }, { reason: 42 }, { reason: 'x'.repeat(501) }, { expectedRevision: 999 }]) {
    f.authorityValues = { role: 'admin', actions: ['portal:enter', 'members:manage'], reason: 'Explicit original administrator change', ...change };
    await assert.rejects(f.saveAdministrator()); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 0); assert.equal(f.reloads, 0);
  }
  f.dispose();
});

check('Administrator validateFields yield rechecks original material/row/context/query/actor actions; stale callbacks cannot create K or overwrite retained input', async () => {
  for (const change of ['material', 'row', 'fetching', 'error', 'actor', 'identity', 'close']) {
    const f = administratorChangeConsumerFixture(); await f.reviewAdministrator(); const pending = deferred(); f.authorityValidation = () => pending.promise;
    const values = plain(f.authorityValues), saving = f.saveAdministrator(); await Promise.resolve(); await Promise.resolve();
    if (change === 'material') f.currentAuthority = { ...f.currentAuthority, role: 'admin', actions: ['portal:enter'] };
    else if (change === 'row') f.member = { ...f.member, updatedAt: '2026-11-05T03:00:02.000Z' };
    else if (change === 'fetching') f.authorityFetching = true;
    else if (change === 'error') f.authorityQueryError = new Error('private source error');
    else if (change === 'actor') f.context.entry.corporates[0].actions = ['members:manage', 'administrators:manage'];
    else if (change === 'identity') f.context.identity += '-changed';
    else nodes(f.authorityHooks.value).find(n => n.type === 'button' && text(n) === 'Cancel').props.onClick();
    f.authorityHooks.rerender(); pending.resolve(values); await assert.rejects(saving); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 0); assert.equal(f.reloads, 0);
    if (!['identity', 'close'].includes(change)) assert.equal(f.authorityValues.reason, 'Explicit original administrator change', 'retain original input without rebinding');
    assert.equal(JSON.stringify(f.authorityHooks.value).includes('private source error'), false); f.dispose();
  }
});

check('Normal administrator save retires the exact key before current admission reload; original revision/default empty actions/reason are preserved and returned roles never set page authority', async () => {
  const f = administratorChangeConsumerFixture(), before = plain(f.context.entry); await f.reviewAdministrator();
  f.onReload = () => { assert.equal(f.storage.size, 0); f.authorityHooks.flush(); assert.equal(f.authorityOperation.pending, undefined); };
  await f.saveAdministrator(); assert.equal(f.commands.length, 1); assert.equal(f.reloads, 1); assert.equal(f.authorityRefreshes, 1);
  assert.equal(f.commands[0].input.expectedRevision, 1); assert.equal(f.commands[0].input.expectedUpdatedAt, '2026-11-05T03:00:00.000Z'); assert.deepEqual(plain(f.context.entry), before);
  assert.equal(f.currentAuthority.role, 'employee', 'UI never copies returned admin into current grants'); f.dispose();
  const empty = administratorChangeConsumerFixture(); await empty.reviewAdministrator(); empty.authorityValues = { role: 'employee', reason: '  Explicit empty grants  ' };
  empty.writeHandler = async () => ({ ...empty.authorityResult, role: 'employee', actions: [] }); await empty.saveAdministrator();
  assert.deepEqual(empty.commands[0].input.actions, []); assert.equal(empty.commands[0].input.reason, '  Explicit empty grants  '); assert.equal(empty.reloads, 1); empty.dispose();
});

function inviteCreationConsumerFixture() {
  const f = memberRecoveryEntryFixture(), hooks = reactHost(); f.inviteHooks = hooks; f.inviteRefreshes = 0; f.copies = [];
  f.context.entry.corporates[0].actions.push('invites:manage');
  f.createdInvite = { id: 'created-invite', corporateCustomerId: 'company', status: 'active', revision: 1, expiresAt: '2026-11-05T04:00:00.000Z', maxUses: 1, used: 0, createdAt: '2026-11-05T03:00:00.000Z' };
  f.inviteCreation = { invite: f.createdInvite, codeRetrievableAgain: false }; f.firstCreation = { ...f.inviteCreation, code: 'A'.repeat(43) };
  f.writeHandler = async () => plain(f.firstCreation);
  const form = { resetFields() {} }, Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
  const mount = () => {
    const gate = f.makeGate(hooks.runtime), module = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
      '@tanstack/react-query': { useQuery: () => ({ data: [], isFetching: false, refetch: async () => { f.inviteRefreshes++; if (f.inviteRefreshError) throw new Error('refresh unavailable'); return { data: [] }; } }) },
      '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', ConfirmAction: 'confirm', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Table: 'table' },
      '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': gate,
      './AuthorityUpload': { AuthorityUpload: 'upload' }, './WorkflowReview': { EnterpriseWorkflowReview: 'review' },
      '@rental-os/web-client': { clearEnterpriseInvite: forbidden('creation is not joining'), readEnterpriseInvite: () => undefined } },
      { navigator: { clipboard: { writeText: async value => f.copies.push(value) } }, window: { location: { origin: 'https://registered.example' } }, URL, URLSearchParams });
    hooks.mount(() => module.EnterpriseInvitesPage());
  };
  f.createInvite = () => nodes(hooks.value).find(n => n.props.label === 'Create invite').props.onSave({ lifetimeHours: 1, maxUses: 1 });
  f.creationGate = () => nodes(hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus').props.operation;
  f.creationStatus = () => { const status = nodes(hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus'); return status.type(status.props); };
  f.readCreation = () => nodes(f.creationStatus()).find(n => n.props.label === 'Read original invite creation').props.onAction();
  f.copyCreation = () => nodes(hooks.value).find(n => n.props.label === 'Copy invite code').props.onAction();
  f.inviteReferenceKey = () => f.referenceKey('company', 'invites');
  f.remountInvites = () => { hooks.unmount(); f.generation += '-login'; f.context.identity += '-login'; mount(); };
  f.loseInviteAccess = () => { hooks.unmount(); f.loseManagement(); };
  const dispose = f.dispose; f.dispose = () => { hooks.unmount(); dispose(); }; mount(); return f;
}

check('Lost invitation creation only recovers the exact original company/K and explicitly reports the once-only code unavailable, never regenerating or guessing from a list', async () => {
  const f = inviteCreationConsumerFixture(); f.writeHandler = async () => { throw new Error('lost create response'); };
  await assert.rejects(f.createInvite()); f.inviteHooks.flush(); assert.equal(f.commands.length, 1);
  const raw = f.storage.get(f.inviteReferenceKey()); assert.deepEqual(JSON.parse(raw), { key: 'original-transfer-key', path: '/enterprise/corporates/company/invites', state: 'unknown' });
  assert.ok(!raw.includes('A'.repeat(43)) && !raw.includes('maxUses') && !raw.includes('body'));
  f.receipt = { state: 'not_recorded' }; await assert.rejects(f.readCreation()); assert.equal(f.storage.size, 1);
  f.receipt = { state: 'committed', result: f.inviteCreation }; await f.readCreation(); f.inviteHooks.flush();
  assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 1); assert.equal(f.inviteRefreshes, 0);
  assert.ok(nodes(f.inviteHooks.value).some(n => n.type === 'alert' && n.props.title.includes('raw code is unavailable')));
  assert.equal(nodes(f.inviteHooks.value).some(n => n.props.label === 'Copy invite code'), false); assert.deepEqual(f.copies, []);
  assert.ok(f.reads.every(path => path === '/enterprise/corporates/company/invites/create-operations/original-transfer-key')); f.dispose();
});

check('Creation receipt recovery preserves a still-known matching first-response code but never reads a code from the server; re-login loses memory without replaying creation', async () => {
  const f = inviteCreationConsumerFixture(); f.inviteRefreshError = true; await assert.rejects(f.createInvite()); f.inviteHooks.flush();
  assert.equal(f.creationGate().pending.state, 'committed'); await f.copyCreation(); assert.equal(f.copies[0], f.firstCreation.code);
  f.receipt = { state: 'committed', result: f.inviteCreation }; await f.readCreation(); await f.copyCreation();
  assert.equal(f.copies[1], f.firstCreation.code); assert.equal(f.commands.length, 1); assert.equal(f.storage.size, 0); f.dispose();
  const lost = inviteCreationConsumerFixture(); lost.inviteRefreshError = true; await assert.rejects(lost.createInvite()); lost.remountInvites();
  assert.equal(nodes(lost.inviteHooks.value).some(n => n.props.label === 'Copy invite code'), false);
  lost.receipt = { state: 'committed', result: lost.inviteCreation }; await lost.readCreation(); assert.equal(lost.commands.length, 1); assert.deepEqual(lost.copies, []); lost.dispose();
});

check('Own invitation recovery uses the same original invites namespace/lock after grant and selection loss; foreign values/member references remain isolated and readonly mode cannot write', async () => {
  const f = inviteCreationConsumerFixture(); f.writeHandler = async () => { throw new Error('lost'); }; await assert.rejects(f.createInvite());
  const memberKey = f.referenceKey(); f.storage.set(memberKey, JSON.stringify({ key: 'member-K', path: '/enterprise/corporates/company/members/target-r', state: 'unknown' }));
  const foreign = f.referenceKey('company', 'invites', 'another-person'); f.storage.set(foreign, '{private-foreign'); f.forbiddenStorageKeys = new Set([foreign]);
  f.loseInviteAccess(); const root = f.mountRecovery(); f.receipt = { state: 'committed', result: f.inviteCreation };
  f.onReload = () => assert.equal(f.storage.has(f.inviteReferenceKey()), false); await root.readInviteCreation();
  assert.equal(f.reads.at(-1), '/enterprise/corporates/company/invites/create-operations/original-transfer-key'); assert.equal(f.commands.length, 1); assert.equal(f.reloads, 1);
  assert.ok(f.storage.has(memberKey) && f.storage.has(foreign)); assert.equal(f.context.selectedCorporateId, ''); assert.deepEqual(f.context.entry.corporates, []);
  assert.ok(f.lockNames.every(name => name === f.inviteReferenceKey() + ':dispatch'));
  f.storage.set(f.inviteReferenceKey(), JSON.stringify({ key: 'kept-K', path: '/enterprise/corporates/company/invites', state: 'unknown' }));
  const hooks = reactHost(), gate = f.makeGate(hooks.runtime); hooks.mount(() => gate.useOriginalWorkflowOperation('invites', { originalCorporateId: 'company', originalOperationKey: 'kept-K' }));
  await assert.rejects(hooks.value.run(() => ({ path: '/enterprise/corporates/company/invites', input: {} }), async () => {}));
  await assert.rejects(hooks.value.read('/enterprise/operations/kept-K')); assert.equal(f.commands.length, 1); hooks.unmount(); f.dispose();
});

check('Invite creation exact recovery rejects secret-bearing/bad original evidence, corrupt paths and late identity/reference/unmount responses without clearing or dispatching another request', async () => {
  for (const change of [{ code: 'A'.repeat(43) }, { codeRetrievableAgain: true }, { invite: { status: 'revoked' } }, { invite: { id: '' } }, { invite: { corporateCustomerId: 'other' } }, { invite: { maxUses: 0 } }, { invite: { expiresAt: '2026-02-30T04:00:00.000Z' } }]) {
    const f = inviteCreationConsumerFixture(); f.inviteRefreshError = true; await assert.rejects(f.createInvite());
    f.receipt = { state: 'committed', result: { ...f.inviteCreation, ...change, ...(change.invite ? { invite: { ...f.createdInvite, ...change.invite } } : {}) } };
    await assert.rejects(f.readCreation()); assert.equal(f.storage.size, 1); assert.equal(f.commands.length, 1); f.dispose();
  }
  for (const change of ['identity', 'reference', 'unmount']) {
    const f = inviteCreationConsumerFixture(); f.writeHandler = async () => { throw new Error('lost'); }; await assert.rejects(f.createInvite());
    const pending = deferred(); f.readHandler = async () => pending.promise; const reading = f.readCreation(); await Promise.resolve(); await Promise.resolve();
    if (change === 'identity') { f.context.identity = 'new-owner'; f.context.session = { customer: { customerId: 'new-owner' }, workspace: { workspaceCode: 's1' } }; f.generation += '-owner'; f.inviteHooks.rerender(); }
    else if (change === 'unmount') f.inviteHooks.unmount();
    else f.storage.set(f.inviteReferenceKey(), JSON.stringify({ key: 'replacement-K', path: '/enterprise/corporates/company/invites', state: 'unknown' }));
    pending.resolve({ state: 'committed', result: f.inviteCreation }); await assert.rejects(reading); assert.equal(f.storage.size, 1); assert.equal(f.commands.length, 1); f.dispose();
  }
  const f = inviteCreationConsumerFixture(); f.writeHandler = async () => ({ ...f.firstCreation, code: 'javascript:unregistered' }); await assert.rejects(f.createInvite());
  assert.equal(f.creationGate().pending.state, 'unknown'); assert.equal(f.inviteRefreshes, 0); assert.equal(f.copies.length, 0);
  f.storage.set(f.inviteReferenceKey(), JSON.stringify({ key: 'original-transfer-key', path: '/enterprise/corporates/company/invites/unregistered', state: 'unknown' }));
  f.remountInvites(); const reads = f.reads.length; await assert.rejects(f.creationGate().recover(async () => {})); assert.equal(f.reads.length, reads); assert.equal(f.storage.size, 1); f.dispose();
});

check('Invitation revocation smoke: native confirmation waits for one POST, unknown reads exact K, and readonly recovery survives loss of access', async () => {
  const f = inviteCreationConsumerFixture(); await f.createInvite();
  const table = nodes(f.inviteHooks.value).find(n => n.type === 'table');
  const confirm = table.props.columns.find(c => c.title === 'Actions').render(null, f.createdInvite);
  assert.equal(confirm.type, 'confirm'); assert.equal(confirm.props.onUndo, undefined);
  f.writeHandler = async () => { throw new Error('lost revoke response'); }; await assert.rejects(confirm.props.onConfirm());
  const read = () => nodes(f.creationStatus()).find(n => n.props.label === 'Read original invite revocation').props.onAction();
  f.receipt = { state: 'not_recorded' }; await assert.rejects(read()); assert.equal(f.storage.size, 1);
  f.receipt = { state: 'committed', result: { id: f.createdInvite.id, status: 'revoked', revision: 2 } }; await read();
  assert.equal(f.commands.length, 2); assert.equal(f.storage.size, 0); assert.equal(nodes(f.inviteHooks.value).some(n => n.props.label === 'Copy invite code'), false);
  assert.ok(f.reads.every(path => path === '/enterprise/corporates/company/invites/created-invite/revoke-operations/closure-transfer-key')); f.dispose();
  const own = inviteCreationConsumerFixture(); own.storage.set(own.inviteReferenceKey(), JSON.stringify({ key: 'revoke-K', path: '/enterprise/corporates/company/invites/created-invite/revoke', state: 'unknown' }));
  own.loseInviteAccess(); const root = own.mountRecovery();
  own.receipt = { state: 'committed', result: { id: 'created-invite', status: 'revoked', revision: 2 } };
  const button = nodes(root.value).find(n => n.props.label === 'Read original invite revocation'); await button.props.onAction();
  assert.equal(own.commands.length, 0); assert.equal(own.storage.size, 0); assert.equal(own.reloads, 1); own.dispose();
});

check('Join withdrawal smoke: native confirmation awaits one POST; stale confirmation refuses; exact K recovery survives selection loss without member removal', async () => {
  const f = transferConsumerFixture(true); f.rows = [{ ...transferRow(), id: 'original-join', kind: 'join_request', state: 'pending', revision: 1, applicantCustomerId: 'recipient' }]; f.hooks.rerender();
  const confirm = f.button('Withdraw request'); assert.equal(confirm.type, 'confirm'); assert.equal(confirm.props.onUndo, undefined);
  f.rows = [{ ...f.rows[0], revision: 2 }]; f.hooks.rerender(); await assert.rejects(confirm.props.onConfirm(), /original own join/u); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 0);
  f.rows = [{ ...f.rows[0], revision: 1 }]; f.hooks.rerender(); const delayed = deferred(); f.writeHandler = () => delayed.promise;
  let finished = false; const sending = f.button('Withdraw request').props.onConfirm().finally(() => { finished = true; });
  await new Promise(setImmediate); assert.equal(f.commands.length, 1); assert.equal(finished, false); delayed.reject(new Error('lost withdrawal response')); await assert.rejects(sending); f.hooks.flush();
  const read = () => { const status = nodes(f.hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus'); return nodes(status.type(status.props)).find(n => n.props.label === 'Read original join withdrawal').props.onAction(); };
  f.receipt = { state: 'not_recorded' }; await assert.rejects(read()); assert.equal(f.storage.size, 1);
  f.receipt = { state: 'committed', result: { id: 'other-request', state: 'withdrawn', revision: 2 } }; await assert.rejects(read()); assert.equal(f.storage.size, 1);
  f.refreshError = true; f.receipt = { state: 'committed', result: { id: 'original-join', state: 'withdrawn', revision: 2 } }; await read();
  assert.equal(f.commands.length, 1); assert.equal(f.storage.size, 0); assert.ok(f.reads.every(path => path === '/enterprise/join-requests/original-join/withdraw-operations/original-transfer-key')); f.dispose();
  const own = memberRecoveryEntryFixture(); own.storage.set(own.referenceKey('', 'join'), JSON.stringify({ key: 'withdraw-K', path: '/enterprise/join-requests/original-join/withdraw', state: 'committed' }));
  const other = own.referenceKey('', 'join', 'other-customer'); own.storage.set(other, 'other-private-value'); own.forbiddenStorageKeys = new Set([other]); own.loseManagement(); const root = own.mountRecovery();
  own.receipt = { state: 'committed', result: { id: 'original-join', state: 'withdrawn', revision: 2 } }; await root.button('Read original join withdrawal').props.onAction();
  assert.equal(own.commands.length, 0); assert.equal(own.reloads, 1); assert.equal(own.storage.size, 1); assert.equal(own.storage.get(other), 'other-private-value'); assert.ok(own.reads.every(path => path === '/enterprise/join-requests/original-join/withdraw-operations/withdraw-K')); own.dispose();
});

check('Join review smoke: frozen original notice, native confirmation and exact receipt survive lost response and management loss', async () => {
  const f = memberRecoveryEntryFixture(), hooks = reactHost(), gate = f.makeGate(hooks.runtime);
  const rows = [{ id: 'review-join', kind: 'join_request', state: 'pending', revision: 1, corporateCustomerId: 'company', applicantCustomerId: 'employee', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', payload: { inviteId: 'original-invite', noticeHash: 'a'.repeat(64), agreementVersion: 'v1', noticeText: 'Original notice', acknowledgedAt: '2026-11-05T00:00:00.000Z', privateToken: 'must-not-render' } }];
  const review = load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx });
  const page = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': gate, './WorkflowReview': review, './AuthorityUpload': { AuthorityUpload: 'unused-upload' },
    '@rental-os/web-client': { readEnterpriseInvite: forbidden('review cannot read raw invite'), clearEnterpriseInvite: forbidden('review cannot clear invite') },
    '@tanstack/react-query': { useQuery: () => ({ data: rows, isFetching: false, refetch: async () => { if (f.refreshError) throw new Error('list unavailable'); return { data: rows }; } }) },
    '@/components/ui/customer-entry': { ActionButton: 'action', ConfirmAction: 'confirm', Alert: 'alert', Input: { TextArea: 'textarea' }, Table: 'table' }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) } });
  hooks.mount(() => page.EnterpriseJoinReviewPage()); const actions = () => nodes(hooks.value).find(n => n.type === 'table').props.columns.find(c => c.title === 'Actions').render(null, rows[0]);
  await hooks.act(() => actions().props.onAction()); await hooks.act(() => nodes(actions()).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed original employee' } }));
  const held = nodes(actions()).find(n => n.props.label === 'Approve'); assert.equal(held.type, 'confirm'); assert.equal(held.props.onUndo, undefined);
  rows[0].payload.noticeText = 'Changed without revision'; hooks.rerender(); assert.equal(nodes(actions()).find(n => n.props.label === 'Approve').props.disabled, true);
  const frozen = nodes(actions()).find(n => n.type === review.EnterpriseWorkflowReview).props.row; assert.equal(frozen.payload.noticeText, 'Original notice'); assert.equal(JSON.stringify(frozen).includes('must-not-render'), false);
  await assert.rejects(held.props.onConfirm(), /review material/u); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 0);
  rows[0].payload.noticeText = 'Original notice'; hooks.rerender(); const delayed = deferred(); f.writeHandler = () => delayed.promise;
  let finished = false; const sending = nodes(actions()).find(n => n.props.label === 'Approve').props.onConfirm().finally(() => { finished = true; }); await new Promise(setImmediate);
  assert.equal(finished, false); assert.equal(f.commands.length, 1); delayed.reject(new Error('lost review response')); await assert.rejects(sending); hooks.flush();
  const read = () => { const status = nodes(hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus'); return nodes(status.type(status.props)).find(n => n.props.label === 'Read original join review').props.onAction(); };
  f.receipt = { state: 'committed', result: { id: 'wrong-request', state: 'approved', revision: 2 } }; await assert.rejects(read()); assert.equal(f.storage.size, 1);
  hooks.unmount(); f.loseManagement(); const root = f.mountRecovery(); f.receipt = { state: 'committed', result: { id: 'review-join', state: 'approved', revision: 2 } }; await root.button('Read original join review').props.onAction();
  assert.equal(f.commands.length, 1); assert.equal(f.storage.size, 0); assert.equal(f.reloads, 1); assert.ok(f.reads.every(p => p === '/enterprise/corporates/company/join-requests/review-join/decision-operations/original-transfer-key')); f.dispose();
});

check('Join submission smoke: immutable invitation notice, stale form refusal, one dispatch and exact own K recovery without raw-code consumption', async () => {
  const f = transferConsumerFixture(true), code = 'a'.repeat(43), originalNotice = { corporateName: 'Original enterprise', expiresAt: '2026-11-06T00:00:00.000Z', agreementVersion: 'v1', noticeText: 'Original notice', noticeHash: 'b'.repeat(64), semantics: 'join_request_only', privateToken: 'must-not-render' };
  f.rows = []; f.context.selectedCorporateId = ''; f.hooks.rerender(); f.joinForm.setFieldValue('inviteCode', code); f.writeHandler = async path => { assert.equal(path, '/enterprise/invites/preview'); return originalNotice; };
  const details = () => nodes(f.hooks.value).find(n => n.props.label === 'Read invitation details'); await details().props.onAction(); f.hooks.flush();
  originalNotice.noticeText = 'Mutated transport alias'; assert.equal(text(f.hooks.value).includes('Mutated transport alias'), false); assert.equal(text(f.hooks.value).includes('must-not-render'), false);
  f.joinForm.setFieldValue('acknowledged', true); const save = nodes(f.hooks.value).find(n => n.props.label === 'Request to join');
  const values = { ...f.joinForm.values }; f.joinForm.setFieldValue('department', 'Changed during validation'); await assert.rejects(save.props.onSave(values), /notice or input/u); assert.equal(f.storage.size, 0);
  f.joinForm.setFieldValue('department', undefined); const delayed = deferred(); f.writeHandler = () => delayed.promise;
  const sending = save.props.onSave({ ...f.joinForm.values }); await new Promise(setImmediate); assert.equal(f.commands.filter(c => c.path === '/enterprise/join').length, 1); delayed.reject(new Error('lost join response')); await assert.rejects(sending); f.hooks.flush();
  const read = () => { const status = nodes(f.hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus'); return nodes(status.type(status.props)).find(n => n.props.label === 'Read original join submission').props.onAction(); };
  f.receipt = { state: 'not_recorded' }; await assert.rejects(read()); assert.equal(f.storage.size, 1);
  f.receipt = { state: 'committed', result: { id: 'original-request', state: 'pending', revision: 1 } }; f.refreshError = true; await read();
  assert.equal(f.storage.size, 0); assert.equal(f.joinForm.getFieldValue('inviteCode'), code); assert.equal(f.commands.filter(c => c.path === '/enterprise/join').length, 1); assert.ok(f.reads.every(p => p === '/enterprise/join/request-operations/original-transfer-key')); f.dispose();
  const own = memberRecoveryEntryFixture(); own.storage.set(own.referenceKey('', 'join'), JSON.stringify({ key: 'original-join-K', path: '/enterprise/join', state: 'committed' })); own.loseManagement(); const root = own.mountRecovery(); own.receipt = { state: 'committed', result: { state: 'agreement_unavailable' } };
  await root.button('Read original join submission').props.onAction(); assert.equal(own.storage.size, 0); assert.equal(own.commands.length, 0); assert.equal(own.reloads, 1); own.dispose();
});

check('Application withdrawal smoke: native confirmation rejects stale requests; one POST and exact recovery preserve evidence and survive selection loss', async () => {
  const f = memberRecoveryEntryFixture(), hooks = reactHost(), gate = f.makeGate(hooks.runtime), row = { id: 'original-application', kind: 'corporate_application', state: 'pending', revision: 1, applicantCustomerId: 'recipient', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', payload: { evidenceFileIds: ['original-proof'] } }; f.rows = [row];
  const Form = Object.assign('form', { useForm: () => [f.joinForm], Item: 'field' });
  const page = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': gate, './AuthorityUpload': { AuthorityUpload: 'unused-upload' },
    './WorkflowReview': load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx }), '@rental-os/web-client': { readEnterpriseInvite: forbidden('application cannot read invite'), clearEnterpriseInvite: forbidden('application cannot consume invite') },
    '@tanstack/react-query': { useQuery: options => ({ data: options.queryKey[0] === 'enterprise-agreement' ? { body: 'Original agreement', version: 'v1' } : f.rows, isFetching: false, refetch: async () => { if (f.refreshError) throw new Error('list unavailable'); return { data: f.rows }; } }) },
    '@/components/ui/customer-entry': { ActionButton: 'action', ConfirmAction: 'confirm', Alert: 'alert', Form, Input: 'input', Checkbox: 'checkbox', Table: 'table', Button: 'button' }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) } });
  hooks.mount(() => page.EnterpriseApplicationPage()); const actions = () => nodes(hooks.value).find(n => n.type === 'table').props.columns.find(c => c.title === 'Actions').render(null, f.rows[0]);
  const held = nodes(actions()).find(n => n.props.label === 'Withdraw'); assert.equal(held.type, 'confirm'); assert.equal(held.props.onUndo, undefined);
  await assert.rejects(held.props.onConfirm()); assert.equal(f.storage.size, 0); held.props.onStateChange('confirming');
  row.revision = 2; hooks.rerender(); await assert.rejects(held.props.onConfirm(), /own application changed/u); assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 0);
  row.revision = 1; hooks.rerender(); const delayed = deferred(); f.writeHandler = () => delayed.promise; let finished = false;
  nodes(actions()).find(n => n.props.label === 'Withdraw').props.onStateChange('confirming');
  const sending = nodes(actions()).find(n => n.props.label === 'Withdraw').props.onConfirm().finally(() => { finished = true; }); await new Promise(setImmediate); assert.equal(finished, false); assert.equal(f.commands.length, 1); delayed.reject(new Error('lost application withdrawal')); await assert.rejects(sending); hooks.flush();
  const read = () => { const status = nodes(hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus'); return nodes(status.type(status.props)).find(n => n.props.label === 'Read original application withdrawal').props.onAction(); };
  f.receipt = { state: 'not_recorded' }; await assert.rejects(read()); assert.equal(f.storage.size, 1);
  hooks.unmount(); f.loseManagement(); const root = f.mountRecovery(); f.receipt = { state: 'committed', result: { id: row.id, state: 'withdrawn', revision: 2 } }; await root.button('Read original application withdrawal').props.onAction();
  assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 1); assert.equal(f.reloads, 1); assert.deepEqual(row.payload.evidenceFileIds, ['original-proof']); assert.ok(f.reads.every(p => p === '/enterprise/applications/original-application/withdraw-operations/original-transfer-key')); f.dispose();
});

check('Application region smoke: live form mapping blocks unmapped submit before K, preserves legacy drafts and own receipts, and merchant can reject rather than approve', async () => {
  const f = memberRecoveryEntryFixture(), hooks = reactHost(), gate = f.makeGate(hooks.runtime), document = { tenantCode:'merchant',kind:'user_agreement',name:'Agreement',body:'Original agreement',version:'v1' };
  f.rows = []; const Form = Object.assign('form',{useForm:()=>[f.joinForm],Item:'field'}); f.joinForm.validateFields = async()=>({...f.joinForm.values});
  const page = load('apps/enterprise-portal/src/WorkflowPages.tsx',{react:hooks.runtime,'react/jsx-runtime':hooks.jsx,'./enterprise-session':{useEnterprise:()=>f.context},'./original-workflow-operation':gate,'./AuthorityUpload':{AuthorityUpload:'upload'},'./WorkflowReview':load('apps/enterprise-portal/src/WorkflowReview.tsx',{'react/jsx-runtime':hooks.jsx}),'@rental-os/web-client':{readEnterpriseInvite:forbidden('no invitation'),clearEnterpriseInvite:forbidden('no invitation')},'@tanstack/react-query':{useQuery:options=>({data:options.queryKey[0]==='enterprise-agreement'?document:f.rows,isFetching:false,refetch:async()=>({data:f.rows})})},'@/components/ui/customer-entry':{ActionButton:'action',SaveButton:'save',ConfirmAction:'confirm',Alert:'alert',Form,Input:'input',Checkbox:'checkbox',Table:'table',Button:'button'},'@/app/locale':{useLocale:()=>({locale:'en-US'})}});
  hooks.mount(()=>page.EnterpriseApplicationPage()); const input={legalName:'Original company',region:'HK',legalIdentifier:'HK-reference',contactName:'Representative',contactPhone:'company-phone',authorityStatement:'Original proof',evidenceFileIds:'proof',agreementVersion:'v1',existingCorporateCustomerId:'company'};
  f.joinForm.setFieldsValue(input);hooks.rerender();await hooks.act(()=>nodes(hooks.value).find(node=>node.type==='checkbox').props.onChange({target:{checked:true}}));
  const submit=()=>nodes(hooks.value).find(node=>node.props.label==='Submit application');assert.equal(submit().props.disabled,true);submit().props.onStateChange('confirming');await assert.rejects(submit().props.onConfirm(),/no registered identity mapping/u);assert.equal(f.commands.length,0);assert.equal(f.storage.size,0);
  f.joinForm.setFieldValue('region','CN');hooks.rerender();assert.equal(submit().props.disabled,false);const original=submit();original.props.onStateChange('confirming');f.joinForm.setFieldValue('region','HK');hooks.rerender();await assert.rejects(original.props.onConfirm());assert.equal(f.commands.length,0);assert.equal(f.storage.size,0);
  f.writeHandler=async()=>({id:'region-draft',state:'draft',revision:1});const save=nodes(hooks.value).find(node=>node.props.label==='Save draft');save.props.onClickCapture();await save.props.onSave({...f.joinForm.values});assert.equal(f.commands.length,1);assert.equal(f.commands[0].input.submit,false);assert.equal(f.commands[0].input.application.region,'HK');
  hooks.unmount();f.storage.set(f.referenceKey('company','applications'),JSON.stringify({key:'historical-region-K',path:'/enterprise/applications',state:'unknown'}));f.loseManagement();const recovery=f.mountRecovery();f.receipt={state:'committed',result:{id:'historical-region',state:'pending',revision:2}};await recovery.button('Read original application save').props.onAction();assert.equal(f.commands.length,1);assert.equal(f.storage.size,0);f.dispose();
  const merchant=merchantApplicationReviewFixture();merchant.row.payload.region='HK';merchant.hooks.rerender();await merchant.review();await merchant.reason('Unmapped identity requires review');await merchant.verify(true);assert.equal(merchant.confirm().props.disabled,true);merchant.confirm().props.onStateChange('confirming');await assert.rejects(merchant.confirm().props.onConfirm(),/暂无正式企业主档映射/u);assert.equal(merchant.writes.length,0);assert.equal(merchant.storage.size,0);merchant.confirm('拒绝').props.onStateChange('confirming');await merchant.confirm('拒绝').props.onConfirm();assert.equal(merchant.writes[0].data.decision,'reject');merchant.dispose();
});

check('Application save smoke: frozen original draft, async agreement changes refuse before K, CSV preserved and original save recovers without current material', async () => {
  const f = memberRecoveryEntryFixture(), hooks = reactHost(), gate = f.makeGate(hooks.runtime);
  const input = { legalName: 'Original company', region: 'CN', legalIdentifier: '91310000MA1K123456', contactName: 'Representative', contactPhone: 'company-phone', authorityStatement: 'Original proof', evidenceFileIds: ['proof'], agreementVersion: 'v1' };
  const row = { id: 'original-draft', kind: 'corporate_application', state: 'supplement_required', revision: 2, applicantCustomerId: 'recipient', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', payload: { ...input, privateToken: 'not-editable' } }; f.rows = [row];
  const document = { tenantCode: 'merchant', kind: 'user_agreement', name: 'Agreement', body: 'Original agreement', version: 'v1' }, Form = Object.assign('form', { useForm: () => [f.joinForm], Item: 'field' });
  f.joinForm.validateFields = async () => f.validation ? f.validation.promise : { ...f.joinForm.values };
  const page = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': gate, './AuthorityUpload': { AuthorityUpload: 'unused-upload' }, './WorkflowReview': load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx }),
    '@rental-os/web-client': { readEnterpriseInvite: forbidden('application cannot read invite'), clearEnterpriseInvite: forbidden('application cannot consume invite') },
    '@tanstack/react-query': { useQuery: options => ({ data: options.queryKey[0] === 'enterprise-agreement' ? document : f.rows, isFetching: false, refetch: async () => { if (f.refreshError) throw new Error('list unavailable'); return { data: f.rows }; } }) },
    '@/components/ui/customer-entry': { ActionButton: 'action', SaveButton: 'save', ConfirmAction: 'confirm', Alert: 'alert', Form, Input: 'input', Checkbox: 'checkbox', Table: 'table', Button: 'button' }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) } });
  hooks.mount(() => page.EnterpriseApplicationPage()); const edit = () => nodes(nodes(hooks.value).find(n => n.type === 'table').props.columns.find(c => c.title === 'Actions').render(null, f.rows[0])).find(n => n.type === 'button');
  row.id = 17; hooks.rerender(); assert.equal(edit().props.disabled, true); row.id = 'original-draft'; hooks.rerender();
  await hooks.act(() => edit().props.onClick()); assert.equal(f.joinForm.values.privateToken, undefined); row.payload.legalName = 'Changed cache alias'; hooks.rerender(); assert.equal(f.joinForm.values.legalName, 'Original company');
  await assert.rejects(nodes(hooks.value).find(n => n.props.label === 'Save draft').props.onSave({ ...f.joinForm.values })); assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 0);
  row.payload.legalName = 'Original company'; hooks.rerender(); await hooks.act(() => nodes(hooks.value).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } }));
  f.validation = deferred(); const submitting = nodes(hooks.value).find(n => n.props.label === 'Submit application').props.onConfirm(); await new Promise(setImmediate);
  document.body = 'Changed same-version agreement'; hooks.rerender(); f.validation.resolve({ ...f.joinForm.values }); await assert.rejects(submitting); assert.equal(f.commands.length, 0); assert.equal(f.storage.size, 0); f.validation = undefined;
  const delayed = deferred(); f.writeHandler = () => delayed.promise; const saving = nodes(hooks.value).find(n => n.props.label === 'Save draft').props.onSave({ ...f.joinForm.values }); await new Promise(setImmediate);
  assert.equal(f.commands.length, 1); assert.deepEqual(f.commands[0].input.application.evidenceFileIds, ['proof']); assert.equal(f.commands[0].input.expectedRevision, 2); delayed.reject(new Error('lost save response')); await assert.rejects(saving); hooks.flush();
  const read = () => { const status = nodes(hooks.value).find(n => typeof n.type === 'function' && n.type.name === 'OperationStatus'); return nodes(status.type(status.props)).find(n => n.props.label === 'Read original application save').props.onAction(); };
  f.receipt = { state: 'not_recorded' }; await assert.rejects(read()); assert.equal(f.storage.size, 1);
  hooks.unmount(); f.loseManagement(); const root = f.mountRecovery(); f.receipt = { state: 'committed', result: { id: row.id, state: 'draft', revision: 3 } }; await root.button('Read original application save').props.onAction();
  assert.equal(f.storage.size, 0); assert.equal(f.commands.length, 1); assert.equal(f.reloads, 1); assert.ok(f.reads.every(p => p === '/enterprise/applications/save-operations/original-transfer-key')); f.dispose();
});

check('Application feedback smoke: awaited exact reads isolate older replies, project original evidence and never resolve an unknown command', async () => {
  const f = memberRecoveryEntryFixture(), hooks = reactHost(); f.storage.set(f.referenceKey('company', 'applications'), JSON.stringify({ key: 'unresolved-K', path: '/enterprise/applications', state: 'unknown' })); const retained = [...f.storage.values()][0], gate = f.makeGate(hooks.runtime);
  const row = id => ({ id, kind: 'corporate_application', state: 'approved', revision: 3, applicantCustomerId: 'recipient', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:01.000Z', decisionReason: 'Original merchant feedback', payload: { legalName: `Original ${id}`, region: 'CN', agreementVersion: 'original-v1', agreementAcknowledged: true, agreementAcknowledgedAt: '2026-11-05T00:00:00.000Z', authorityStatement: 'Original representative evidence', evidenceFileIds: ['proof'], privateToken: 'must-not-render' } });
  const a = row('feedback-a'), b = row('feedback-b'); f.rows = [a, b]; const Form = Object.assign('form', { useForm: () => [f.joinForm], Item: 'field' }), review = load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx });
  const page = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': gate, './WorkflowReview': review, './AuthorityUpload': { AuthorityUpload: 'unused-upload' }, '@rental-os/web-client': { readEnterpriseInvite: forbidden('feedback cannot read invite'), clearEnterpriseInvite: forbidden('feedback cannot clear invite') },
    '@tanstack/react-query': { useQuery: () => ({ data: f.rows, isFetching: false, refetch: async () => ({ data: f.rows }) }) }, '@/components/ui/customer-entry': { ActionButton: 'action', SaveButton: 'save', ConfirmAction: 'confirm', Alert: 'alert', Form, Input: 'input', Checkbox: 'checkbox', Table: 'table', Button: 'button' }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) } });
  hooks.mount(() => page.EnterpriseApplicationPage()); const action = row => nodes(nodes(hooks.value).find(n => n.type === 'table').props.columns.find(c => c.title === 'Actions').render(null, row)).find(n => n.props.label === 'Read application feedback');
  const older = deferred(); f.readHandler = path => path.endsWith('/feedback-a') ? older.promise : Promise.resolve(b); const readingA = action(a).props.onAction(); await new Promise(setImmediate);
  await action(b).props.onAction(); hooks.flush(); older.resolve(a); await assert.rejects(readingA); hooks.flush();
  const panel = () => nodes(hooks.value).find(n => n.props['aria-label'] === 'Your application feedback'), material = () => nodes(panel()).find(n => n.type === review.EnterpriseWorkflowReview);
  assert.equal(material().props.row.id, b.id); assert.equal(material().props.row.payload.privateToken, undefined); const rendered = review.EnterpriseWorkflowReview(material().props); assert.ok(text(rendered).includes('Original merchant feedback')); assert.ok(text(rendered).includes('original-v1')); assert.ok(text(rendered).includes('proof')); assert.equal(nodes(rendered).some(n => n.type === 'a'), false);
  b.payload.legalName = 'Mutated response alias'; hooks.rerender(); assert.equal(material().props.row.payload.legalName, 'Original feedback-b');
  f.readHandler = async () => ({ ...b, applicantCustomerId: 'someone-else' }); await assert.rejects(action(b).props.onAction()); hooks.flush(); assert.equal(material(), undefined);
  assert.equal(f.commands.length, 0); assert.equal([...f.storage.values()][0], retained); assert.ok(f.reads.every(p => p === '/enterprise/applications/feedback-a' || p === '/enterprise/applications/feedback-b')); hooks.unmount(); f.dispose();
});

check('Application detail editing rereads the own original without list grant, freezes validation/confirmation and full consent material, and preserves another feedback selection', async () => {
  const setup = () => {
    const f = memberRecoveryEntryFixture(), hooks = reactHost(), gate = f.makeGate(hooks.runtime); f.applicationHooks = hooks;
    f.applicationRow = { id: 'detail-application', kind: 'corporate_application', state: 'supplement_required', revision: 2, applicantCustomerId: 'recipient', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:01.000Z', decisionReason: 'Supply original representative evidence',
      payload: { legalName: 'Original company', region: 'CN', legalIdentifier: '91310000MA1K123456', contactName: 'Representative', contactPhone: 'company-phone', authorityStatement: 'Original proof', evidenceFileIds: ['proof'], agreementVersion: 'v1', agreementAcknowledged: true, agreementAcknowledgedAt: '2026-11-05T00:00:00.000Z', privateToken: 'not-editable' } };
    f.applicationList = { data: [f.applicationRow], isFetching: false, refetch: async () => { throw new Error('list unavailable'); } };
    const document = { tenantCode: 'merchant', kind: 'user_agreement', name: 'Agreement', body: 'Original agreement', version: 'v1' }, Form = Object.assign('form', { useForm: () => [f.joinForm], Item: 'field' });
    f.joinForm.validateFields = async () => ({ ...f.joinForm.values });
    const page = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': gate, './AuthorityUpload': { AuthorityUpload: 'unused-upload' }, './WorkflowReview': load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx }),
      '@rental-os/web-client': { readEnterpriseInvite: forbidden('detail editor cannot read invite'), clearEnterpriseInvite: forbidden('detail editor cannot consume invite') }, '@tanstack/react-query': { useQuery: options => options.queryKey[0] === 'enterprise-agreement' ? { data: document, isFetching: false } : f.applicationList },
      '@/components/ui/customer-entry': { ActionButton: 'action', SaveButton: 'save', ConfirmAction: 'confirm', Alert: 'alert', Form, Input: 'input', Checkbox: 'checkbox', Table: 'table', Button: 'button' }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) } });
    hooks.mount(() => page.EnterpriseApplicationPage()); f.named = label => nodes(hooks.value).find(node => node.props.label === label);
    f.readHandler = async path => { assert.equal(path, '/enterprise/applications/detail-application'); return plain(f.applicationRow); };
    f.readFeedback = row => nodes(nodes(hooks.value).find(node => node.type === 'table').props.columns.find(column => column.title === 'Actions').render(null, row)).find(node => node.props.label === 'Read application feedback').props.onAction();
    f.openDetail = async () => { await f.readFeedback(f.applicationRow); hooks.flush(); f.applicationList.error = new Error('list unavailable'); f.applicationList.data = []; hooks.rerender(); assert.equal(f.named('Edit this original application').props.disabled, false); await hooks.act(() => f.named('Edit this original application').props.onAction()); };
    f.saveDetail = async () => { f.named('Save draft').props.onClickCapture(); return f.named('Save draft').props.onSave({ ...f.joinForm.values }); };
    const dispose = f.dispose; f.dispose = () => { hooks.unmount(); dispose(); }; return f;
  };
  const normal = setup(); await normal.openDetail(); assert.equal(normal.joinForm.values.legalName, 'Original company'); assert.equal(normal.joinForm.values.privateToken, undefined); assert.equal(normal.joinForm.values.evidenceFileIds, 'proof');
  const originalEvidence = normal.applicationRow.payload.evidenceFileIds; normal.joinForm.values.evidenceFileIds = 'proof, new-proof';
  normal.writeHandler = async (path, input) => { assert.equal(path, '/enterprise/applications'); normal.applicationRow = { ...normal.applicationRow, state: 'draft', revision: 3, payload: plain(input.application) }; return { id: 'detail-application', state: 'draft', revision: 3 }; };
  await normal.saveDetail(); assert.equal(normal.commands.length, 1); assert.equal(normal.commands[0].input.requestId, 'detail-application'); assert.equal(normal.commands[0].input.expectedRevision, 2); assert.deepEqual(normal.commands[0].input.application.evidenceFileIds, ['proof', 'new-proof']); assert.deepEqual(originalEvidence, ['proof']); assert.equal(normal.storage.size, 0); assert.ok(normal.reads.every(path => path === '/enterprise/applications/detail-application')); normal.dispose();
  for (const change of ['body', 'consent']) {
    const stale = setup(); await stale.openDetail(); if (change === 'body') stale.applicationRow.payload.legalName = 'Changed at same revision'; else stale.applicationRow.payload.agreementAcknowledgedAt = '2026-11-05T00:00:02.000Z';
    await assert.rejects(stale.saveDetail()); assert.equal(stale.commands.length, 0); assert.equal(stale.storage.size, 0); assert.equal(stale.joinForm.values.legalName, 'Original company'); stale.dispose();
  }
  const validation = setup(); await validation.openDetail(); validation.named('Save draft').props.onClickCapture(); validation.joinForm.values.legalName = 'Changed during first validation'; await assert.rejects(validation.named('Save draft').props.onSave({ ...validation.joinForm.values })); assert.equal(validation.storage.size, 0); assert.equal(validation.commands.length, 0); validation.dispose();
  const identity = setup(); await identity.openDetail(); const retainedInput = { ...identity.joinForm.values }; identity.named('Save draft').props.onClickCapture(); identity.context.identity = 'changed-application-account'; identity.applicationHooks.rerender(); identity.joinForm.setFieldsValue(retainedInput);
  await assert.rejects(identity.named('Save draft').props.onSave(retainedInput), /identity or input/u); assert.equal(identity.storage.size, 0); assert.equal(identity.commands.length, 0); identity.dispose();
  const confirmation = setup(); await confirmation.openDetail(); await confirmation.applicationHooks.act(() => nodes(confirmation.applicationHooks.value).find(node => node.type === 'checkbox').props.onChange({ target: { checked: true } }));
  confirmation.named('Submit application').props.onStateChange('confirming'); confirmation.joinForm.values.authorityStatement = 'Changed after opening confirmation'; confirmation.applicationHooks.rerender(); await assert.rejects(confirmation.named('Submit application').props.onConfirm()); assert.equal(confirmation.storage.size, 0); assert.equal(confirmation.commands.length, 0); confirmation.dispose();
  const switched = setup(); await switched.openDetail(); switched.joinForm.values.authorityStatement = 'Keep unsaved original evidence'; const other = { ...plain(switched.applicationRow), id: 'another-application' }; switched.readHandler = async () => other;
  await switched.readFeedback(other); switched.applicationHooks.flush(); assert.equal(switched.named('Edit this original application').props.disabled, true); await assert.rejects(switched.saveDetail()); assert.equal(switched.joinForm.values.authorityStatement, 'Keep unsaved original evidence'); assert.equal(switched.commands.length, 0);
  await switched.applicationHooks.act(() => nodes(switched.applicationHooks.value).find(node => node.type === 'button' && text(node) === 'Close original editor').props.onClick()); assert.equal(switched.named('Edit this original application').props.disabled, false); switched.dispose();
});

check('Application detail withdrawal freezes separate confirmations, rereads own material before K, and awaits exact recovery before current feedback without touching another draft', async () => {
  const setup = () => {
    const f = memberRecoveryEntryFixture(), hooks = reactHost(), gate = f.makeGate(hooks.runtime); f.applicationHooks = hooks;
    f.context.selectedCorporateId = ''; f.context.entry.corporates = []; f.context.identity = 'personal-detail-withdrawal';
    f.applicationRow = { id: 'own-withdrawal', kind: 'corporate_application', state: 'pending', revision: 2, applicantCustomerId: 'recipient', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:01.000Z',
      payload: { legalName: 'Original company', region: 'CN', legalIdentifier: '91310000MA1K123456', contactName: 'Representative', contactPhone: 'company-phone', authorityStatement: 'Original proof', evidenceFileIds: ['proof'], agreementVersion: 'v1', agreementAcknowledged: true, agreementAcknowledgedAt: '2026-11-05T00:00:00.000Z' } };
    f.applicationList = { data: [f.applicationRow], isFetching: false, refetch: forbidden('detail withdrawal does not need current list') };
    const Form = Object.assign('form', { useForm: () => [f.joinForm], Item: 'field' });
    const page = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': gate, './AuthorityUpload': { AuthorityUpload: 'unused-upload' }, './WorkflowReview': load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx }),
      '@rental-os/web-client': { readEnterpriseInvite: forbidden('withdrawal cannot read invite'), clearEnterpriseInvite: forbidden('withdrawal cannot consume invite') }, '@tanstack/react-query': { useQuery: options => options.queryKey[0] === 'enterprise-agreement' ? { error: new Error('agreement unavailable'), isFetching: false } : f.applicationList },
      '@/components/ui/customer-entry': { ActionButton: 'action', SaveButton: 'save', ConfirmAction: 'confirm', Alert: 'alert', Form, Input: 'input', Checkbox: 'checkbox', Table: 'table', Button: 'button' }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) } });
    hooks.mount(() => page.EnterpriseApplicationPage());
    f.actions = row => nodes(hooks.value).find(node => node.type === 'table').props.columns.find(column => column.title === 'Actions').render(null, row);
    f.readFeedback = row => nodes(f.actions(row)).find(node => node.props.label === 'Read application feedback').props.onAction();
    f.readHandler = async path => { assert.equal(path, '/enterprise/applications/own-withdrawal'); if (f.failCurrent) throw new Error('current own feedback failed'); return plain(f.applicationRow); };
    f.readOwn = async (loseList = true) => { await f.readFeedback(f.applicationRow); hooks.flush(); if (loseList) { f.applicationList.error = new Error('list unavailable'); f.applicationList.data = []; hooks.rerender(); } };
    f.withdrawalButton = () => nodes(hooks.value).find(node => node.props.label === 'Withdraw');
    f.recover = () => { const status = nodes(hooks.value).find(node => typeof node.type === 'function' && node.type.name === 'OperationStatus'); return nodes(status.type(status.props)).find(node => node.props.label === 'Read original application withdrawal').props.onAction(); };
    const dispose = f.dispose; f.dispose = () => { hooks.unmount(); dispose(); }; return f;
  };
  const normal = setup(), other = { ...plain(normal.applicationRow), id: 'another-draft', state: 'draft', revision: 1 }; normal.applicationList.data.push(other);
  await normal.applicationHooks.act(() => nodes(normal.actions(other)).find(node => node.type === 'button').props.onClick()); normal.joinForm.values.authorityStatement = 'Keep another draft input';
  await normal.readOwn(); assert.equal(normal.withdrawalButton().props.disabled, false); assert.equal(normal.withdrawalButton().props.onUndo, undefined); await assert.rejects(normal.withdrawalButton().props.onConfirm()); assert.equal(normal.commands.length, 0);
  normal.withdrawalButton().props.onStateChange('confirming'); normal.writeHandler = async () => { normal.applicationRow.state = 'withdrawn'; normal.applicationRow.revision = 3; return { id: 'own-withdrawal', state: 'withdrawn', revision: 3 }; };
  await normal.withdrawalButton().props.onConfirm(); assert.equal(normal.commands.length, 1); assert.equal(normal.commands[0].path, '/enterprise/applications/own-withdrawal/withdraw'); assert.equal(normal.commands[0].input.expectedRevision, 2); assert.equal(normal.storage.size, 0); assert.equal(normal.joinForm.values.authorityStatement, 'Keep another draft input'); assert.deepEqual(normal.applicationRow.payload.evidenceFileIds, ['proof']); normal.dispose();
  const stale = setup(); await stale.readOwn(); const held = stale.withdrawalButton(); held.props.onStateChange('confirming'); stale.applicationRow.payload.evidenceFileIds.push('changed-at-same-revision'); await assert.rejects(held.props.onConfirm()); assert.equal(stale.commands.length, 0); assert.equal(stale.storage.size, 0); stale.dispose();
  const surface = setup(); await surface.readOwn(false); const detail = surface.withdrawalButton(); detail.props.onStateChange('confirming'); nodes(surface.actions(surface.applicationRow)).find(node => node.props.label === 'Withdraw').props.onStateChange('confirming');
  const another = { ...plain(surface.applicationRow), id: 'another-application' }; surface.readHandler = async () => another; await surface.readFeedback(another); surface.applicationHooks.flush(); await assert.rejects(detail.props.onConfirm()); assert.equal(surface.commands.length, 0, 'detail cannot borrow a list confirmation after switching feedback'); assert.equal(surface.storage.size, 0); surface.dispose();
  const lost = setup(); await lost.readOwn(); lost.withdrawalButton().props.onStateChange('confirming'); lost.writeHandler = async () => { throw new Error('withdrawal response lost'); }; await assert.rejects(lost.withdrawalButton().props.onConfirm()); lost.applicationHooks.flush(); const [key, raw] = [...lost.storage][0];
  lost.readHandler = async path => path.includes('/withdraw-operations/') ? { state: 'not_recorded' } : plain(lost.applicationRow); await assert.rejects(lost.recover()); assert.equal(lost.storage.get(key), raw);
  const delayed = deferred(); lost.applicationRow.state = 'withdrawn'; lost.applicationRow.revision = 3; lost.readHandler = async path => { if (path.includes('/withdraw-operations/')) return { state: 'committed', result: { id: 'own-withdrawal', state: 'withdrawn', revision: 3 } }; assert.equal(lost.storage.has(key), false); return delayed.promise; };
  let finished = false; const recovering = lost.recover().finally(() => { finished = true; }); await new Promise(setImmediate); assert.equal(finished, false, 'recovery awaits the actual current feedback promise'); assert.equal(lost.storage.has(key), false); delayed.resolve(plain(lost.applicationRow)); await recovering; assert.equal(lost.commands.length, 1); lost.dispose();
  const known = setup(); await known.readOwn(); known.withdrawalButton().props.onStateChange('confirming'); known.writeHandler = async () => { known.applicationRow.state = 'withdrawn'; known.applicationRow.revision = 3; known.failCurrent = true; return { id: 'own-withdrawal', state: 'withdrawn', revision: 3 }; };
  await assert.rejects(known.withdrawalButton().props.onConfirm()); known.applicationHooks.flush(); const [knownKey, knownRaw] = [...known.storage][0]; assert.equal(JSON.parse(knownRaw).state, 'committed');
  known.readHandler = async path => { if (path.includes('/withdraw-operations/')) return { state: 'committed', result: { id: 'own-withdrawal', state: 'withdrawn', revision: 3 } }; assert.equal(known.storage.has(knownKey), false); throw new Error('current feedback still failed'); };
  await assert.rejects(known.recover()); assert.equal(known.storage.has(knownKey), false); assert.equal(known.commands.length, 1); assert.equal(known.withdrawalButton(), undefined); known.dispose();
});

check('Application task locator reads exact own feedback without list/management access, preserves K, and isolates invalid/late URL changes from editors and confirmations', async () => {
  const taskHooks = reactHost(), task = { id: 'url-a', kind: 'corporate_application', page: 'applications', state: 'supplement_required', revision: 2, requiresAction: true }, taskContext = { identity: 'task-owner', basePath: '/merchant/enterprise', selectedCorporateId: '', read: forbidden('task query substitute') };
  const taskPage = load('apps/enterprise-portal/src/TasksPage.tsx', { react: taskHooks.runtime, 'react/jsx-runtime': taskHooks.jsx, '@tanstack/react-query': { useQuery: () => ({ data: { items: [task] }, isFetching: false }) }, 'react-router-dom': { Link: 'link' }, '@rental-os/web-client': load('packages/web-client/src/enterprise-entry.ts', {}), './enterprise-session': { useEnterprise: () => taskContext }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Table: 'table' } });
  taskHooks.mount(() => taskPage.EnterpriseTasksPage()); const taskColumn = nodes(taskHooks.value).find(node => node.type === 'table').props.columns.find(column => column.title === 'Page');
  for (const base of ['/merchant/enterprise', '/enterprise']) { taskContext.basePath = base; taskHooks.rerender(); const column = nodes(taskHooks.value).find(node => node.type === 'table').props.columns.find(item => item.title === 'Page'); assert.equal(column.render(null, task).props.to, `${base}/applications?requestId=url-a`); assert.equal(column.render(null, { ...task, kind: 'management_request', page: 'profile' }).props.to, `${base}/profile?requestId=url-a`); }
  for (const invalid of [{ ...task, id: '../foreign' }, { ...task, page: 'profile' }, { ...task, kind: 'constructor' }]) assert.equal(nodes(taskColumn.render(null, invalid)).some(node => node.type === 'link'), false); taskHooks.unmount();
  const setup = (search, retain = false, reader) => {
    const f = memberRecoveryEntryFixture(), hooks = reactHost(), gate = f.makeGate(hooks.runtime); f.applicationHooks = hooks; f.applicationSearch = search; f.context.selectedCorporateId = ''; f.context.entry.corporates = []; f.context.identity = 'personal-url-reader';
    const row = id => ({ id, kind: 'corporate_application', state: 'supplement_required', revision: 2, applicantCustomerId: 'recipient', createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:01.000Z', payload: { legalName: `Original ${id}`, region: 'CN', legalIdentifier: '91310000MA1K123456', contactName: 'Representative', contactPhone: 'company-phone', authorityStatement: 'Original evidence', evidenceFileIds: ['proof'], agreementVersion: 'v1' } });
    f.urlRows = { a: row('url-a'), b: row('url-b') }; f.readHandler = async path => reader ? reader(path, f) : plain(path.endsWith('/url-b') ? f.urlRows.b : f.urlRows.a);
    f.retainedKey = f.referenceKey('', 'applications'); f.retainedRaw = JSON.stringify({ key: 'held-original-K', path: '/enterprise/applications', state: 'unknown' }); if (retain) f.storage.set(f.retainedKey, f.retainedRaw);
    const Form = Object.assign('form', { useForm: () => [f.joinForm], Item: 'field' }), review = load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx }); f.reviewType = review.EnterpriseWorkflowReview; f.joinForm.validateFields = async () => ({ ...f.joinForm.values });
    const page = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, 'react-router-dom': { useLocation: () => ({ search: f.applicationSearch }) }, './enterprise-session': { useEnterprise: () => f.context }, './original-workflow-operation': gate, './WorkflowReview': review, './AuthorityUpload': { AuthorityUpload: 'unused-upload' }, '@rental-os/web-client': { readEnterpriseInvite: forbidden('locator cannot read invite'), clearEnterpriseInvite: forbidden('locator cannot consume invite') },
      '@tanstack/react-query': { useQuery: options => options.queryKey[0] === 'enterprise-agreement' ? { data: { tenantCode: 'merchant', kind: 'user_agreement', name: 'Agreement', body: 'Original agreement', version: 'v1' }, isFetching: false } : { data: [], error: new Error('bounded list unavailable'), isFetching: false, refetch: forbidden('URL feedback does not need current list') } },
      '@/components/ui/customer-entry': { ActionButton: 'action', SaveButton: 'save', ConfirmAction: 'confirm', Alert: 'alert', Form, Input: 'input', Checkbox: 'checkbox', Table: 'table', Button: 'button' }, '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) } });
    hooks.mount(() => page.EnterpriseApplicationPage()); f.named = label => nodes(hooks.value).find(node => node.props.label === label); f.material = () => nodes(hooks.value).find(node => node.type === f.reviewType)?.props.row;
    f.tick = async () => { await new Promise(setImmediate); hooks.flush(); }; const dispose = f.dispose; f.dispose = () => { hooks.unmount(); dispose(); }; return f;
  };
  const own = setup('?requestId=url-a', true); await own.tick(); assert.equal(own.material().id, 'url-a'); assert.deepEqual(own.reads, ['/enterprise/applications/url-a']); assert.equal(own.storage.get(own.retainedKey), own.retainedRaw); assert.equal(own.context.selectedCorporateId, ''); assert.equal(own.commands.length, 0); assert.equal(own.joinForm.values.legalName, undefined); own.dispose();
  for (const search of ['?requestId=url-a&requestId=url-b', '?requestId=../foreign', '?requestId=']) { const invalid = setup(search, true); await invalid.tick(); assert.equal(invalid.reads.length, 0); assert.equal(invalid.material(), undefined); assert.equal(invalid.storage.get(invalid.retainedKey), invalid.retainedRaw); assert.equal(invalid.commands.length, 0); invalid.dispose(); }
  const pending = deferred(), late = setup('?requestId=url-a', false, (path, f) => path.endsWith('/url-a') ? pending.promise : plain(f.urlRows.b)); await new Promise(setImmediate); late.applicationSearch = '?requestId=url-b'; late.applicationHooks.rerender(); await late.tick(); assert.equal(late.material().id, 'url-b'); pending.resolve(plain(late.urlRows.a)); await late.tick(); assert.equal(late.material().id, 'url-b'); assert.equal(late.commands.length, 0); late.dispose();
  const stale = setup('?requestId=url-a'); await stale.tick(); await stale.applicationHooks.act(() => stale.named('Edit this original application').props.onAction()); stale.joinForm.values.authorityStatement = 'Keep old editor input'; const held = stale.named('Withdraw'); held.props.onStateChange('confirming');
  stale.applicationSearch = '?requestId=url-b'; stale.applicationHooks.rerender(); await stale.tick(); assert.equal(stale.material().id, 'url-b'); assert.equal(stale.named('Edit this original application').props.disabled, true); await assert.rejects(held.props.onConfirm()); stale.named('Save draft').props.onClickCapture(); await assert.rejects(stale.named('Save draft').props.onSave({ ...stale.joinForm.values })); assert.equal(stale.joinForm.values.authorityStatement, 'Keep old editor input'); assert.equal(stale.storage.size, 0); assert.equal(stale.commands.length, 0); stale.dispose();
  const foreign = setup('?requestId=url-a', true, (_path, f) => ({ ...plain(f.urlRows.a), applicantCustomerId: 'another-person' })); await foreign.tick(); assert.equal(foreign.material(), undefined); assert.equal(foreign.storage.get(foreign.retainedKey), foreign.retainedRaw); assert.equal(foreign.commands.length, 0); foreign.dispose();
});

function memberPeriodConsumerFixture() {
  const hooks = reactHost(), f = { hooks, values: {}, writes: [], member: { membershipId: 'period-member', displayName: 'Original member', role: 'employee', status: 'suspended', updatedAt: 'original-period-r1', effectiveFrom: '2026-11-01T00:00:00.000Z', effectiveTo: '2026-12-01T00:00:00.000Z' } };
  const context = { identity: 'period-owner', selectedCorporateId: 'company', entry: { corporates: [{ corporateCustomerId: 'company', membershipId: 'admin-member', actions: ['members:manage', 'administrators:manage'] }] } };
  const form = { resetFields() { for (const key of Object.keys(f.values)) delete f.values[key]; }, setFieldsValue: values => Object.assign(f.values, values),
    getFieldValue: key => f.values[key], validateFields: async () => f.validation ? f.validation() : { ...f.values } };
  const Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
  const operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('period test unexpected read'), run: async (prepare, after) => { const command = await prepare(); f.writes.push(plain(command)); await after({}); } };
  const module = load('apps/enterprise-portal/src/MemberLifecycle.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select' },
    './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': { useOriginalWorkflowOperation: () => operation } });
  hooks.mount(() => module.EnterpriseMemberLifecycle({ member: f.member, english: true, refresh: async () => {} }));
  f.open = async () => { await hooks.act(() => nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Edit relation').props.onClick()); f.values.reason = 'Explicit original period review'; };
  f.save = () => nodes(hooks.value).find(n => n.type === 'save'); return f;
}

check('Member period editor shows original UTC start and restore non-regrant warning; invalid or backwards instants fail before preparing a command', async () => {
  const f = memberPeriodConsumerFixture(); await f.open(); assert.ok(text(f.hooks.value).includes('2026-11-01T00:00:00.000Z'));
  assert.ok(nodes(f.hooks.value).find(n => n.type === 'alert' && n.props.title.includes('does not restore old administrator grants')));
  for (const end of ['not-a-date', '2026-02-30T00:00:00.000Z', '2026-10-01T00:00:00.000Z', '2026-12-01T00:00:00Z']) {
    f.values.effectiveTo = end; await assert.rejects(f.save().props.onSave()); assert.equal(f.writes.length, 0);
  }
  f.values.status = 'active'; f.values.effectiveTo = '2026-12-01T00:00:00.000Z'; await f.save().props.onSave();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].method, 'PUT'); assert.equal(f.writes[0].input.expectedUpdatedAt, 'original-period-r1');
  assert.equal(f.writes[0].input.effectiveTo, '2026-12-01T00:00:00.000Z'); assert.equal(f.writes[0].input.actions, undefined); f.hooks.unmount();
});

check('Member period editor keeps empty end explicit and exit server-owned; no client timestamp, grant or approval is fabricated', async () => {
  for (const status of ['active', 'exited']) {
    const f = memberPeriodConsumerFixture(); await f.open(); const before = plain(f.member);
    f.values.status = status; f.values.effectiveTo = status === 'exited' ? 'ignored stale end text' : ' '; await f.save().props.onSave();
    assert.equal(f.writes[0].input.status, status); assert.equal(f.writes[0].input.effectiveTo, undefined); assert.equal(f.writes[0].input.expectedUpdatedAt, before.updatedAt);
    assert.deepEqual(plain(f.member), before); assert.equal(f.writes[0].input.effectiveFrom, undefined); f.hooks.unmount();
  }
});

check('Member period delayed validation cannot submit against replacement revision/start, and missing original start is unavailable', async () => {
  for (const change of ['revision', 'start']) {
    const f = memberPeriodConsumerFixture(); await f.open(); const pending = deferred(); f.validation = () => pending.promise;
    const saving = f.save().props.onSave();
    f.member = { ...f.member, ...(change === 'revision' ? { updatedAt: 'current-period-r2' } : { effectiveFrom: '2026-11-02T00:00:00.000Z' }) }; f.hooks.rerender();
    pending.resolve({ ...f.values }); await assert.rejects(saving); assert.equal(f.writes.length, 0); assert.equal(f.values.reason, 'Explicit original period review'); f.hooks.unmount();
  }
  const f = memberPeriodConsumerFixture(); delete f.member.effectiveFrom; f.hooks.rerender(); await f.open();
  assert.equal(f.save().props.disabled, true); await assert.rejects(f.save().props.onSave()); assert.equal(f.writes.length, 0); f.hooks.unmount();
});

check('Member and administrator editors keep the reviewed relation revision and reject stale saves without resetting unsaved values', async () => {
  for (const kind of ['member', 'administrator']) {
    const hooks = reactHost(), values = {}, writes = [];
    const firstRevision = kind === 'administrator' ? '2026-11-05T03:00:00.000Z' : 'original-r1';
    const secondRevision = kind === 'administrator' ? '2026-11-05T03:00:01.000Z' : 'current-r2';
    const context = { identity: 'member-owner', selectedCorporateId: 'company', reload() {}, entry: { corporates: [{ corporateCustomerId: 'company', membershipId: 'actor-member', actions: ['members:manage', 'administrators:manage'] }] } };
    let member = { membershipId: 'target-member', role: 'employee', status: 'active', updatedAt: firstRevision, displayName: 'Member', effectiveFrom: '2026-11-01T00:00:00.000Z' };
    const query = { data: { membershipId: 'target-member', role: 'employee', actions: [], updatedAt: firstRevision, revision: 1 }, isFetching: false, refetch: async () => ({}) };
    const form = { resetFields() { for (const key of Object.keys(values)) delete values[key]; }, setFieldsValue: next => Object.assign(values, next), setFieldValue: (key, value) => { values[key] = value; }, validateFields: async () => ({ ...values }) };
    const operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('query substitute reads'), run: async (prepare, afterCommit) => { const command = await prepare(); writes.push(plain(command)); await afterCommit({}); } };
    const Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
    const module = load(kind === 'member' ? 'apps/enterprise-portal/src/MemberLifecycle.tsx' : 'apps/enterprise-portal/src/AdministratorEditor.tsx', {
      react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, '@tanstack/react-query': { useQuery: () => query },
      '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select' },
      './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': { useOriginalWorkflowOperation: () => operation } });
    hooks.mount(() => kind === 'member' ? module.EnterpriseMemberLifecycle({ member, english: true, refresh: async () => {} }) : module.EnterpriseAdministratorEditor({ member, english: true, refresh: async () => {} }));
    const opener = () => nodes(hooks.value).find(n => n.type === 'button' && text(n) === (kind === 'member' ? 'Edit relation' : 'Administrator authority'));
    await hooks.act(() => opener().props.onClick()); values.reason = 'Unsaved reviewed reason'; if (kind === 'member') values.department = 'Unsaved department';
    member = { ...member, updatedAt: secondRevision }; query.data = { ...query.data, updatedAt: secondRevision, revision: 2 }; hooks.rerender();
    const save = () => nodes(hooks.value).find(n => n.type === 'save');
    assert.equal(save().props.disabled, true, kind); assert.equal(values.reason, 'Unsaved reviewed reason', kind);
    await assert.rejects(save().props.onSave(), /修订|revision/u); assert.equal(writes.length, 0, kind);
    const cancel = nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Cancel'); await hooks.act(() => cancel.props.onClick());
    await hooks.act(() => opener().props.onClick()); values.reason = 'Reviewed current relation'; await save().props.onSave();
    assert.equal(writes.length, 1, kind); assert.equal(writes[0].input.expectedUpdatedAt, secondRevision);
  }
});

check('Approval page keeps unresolved submission while exposing a separate closure gate; result absence cannot clear the original', async () => {
  const hooks = reactHost(), reads = [], row = { ...approval('executing'), applicantCustomerId: 'p1', quote: {} };
  let result = { approval: row, original: { state: 'not_observed', orderId: null, retryable: false }, retryable: false }, completed = false;
  const closure = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('closure read in this test') };
  const operation = { blocked: true, busy: false, pending: { key: 'original-submit', path: '/enterprise/approvals/submit' }, assertCurrent() {},
    async read(path) { reads.push(path); return path.startsWith('/enterprise/operations/') ? { state: 'committed', result: { approvalId: row.id } } : plain(result); },
    async recover(afterCommit) { await afterCommit({ state: 'committed', result: { approvalId: row.id } }, '/enterprise/approvals/submit'); completed = true; } };
  const context = { identity: 'identity', selectedCorporateId: 'company', signal: new AbortController().signal, session: { customer: { customerId: 'p1' } }, entry: { corporates: [] } };
  const Form = Object.assign('form', { useForm: () => [{ resetFields() {} }], Item: 'field' });
  const module = load('apps/enterprise-portal/src/ApprovalsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: () => ({ data: [row], isFetching: false, refetch: async () => ({ data: [row] }) }) },
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context },
    './original-workflow-operation': { useOriginalWorkflowOperation: scope => scope === 'approval-execution-close' ? closure : operation },
    './ApprovalReview': { approvalReviewKey: () => 'original-row-key' }, './ApprovalDecision': { EnterpriseApprovalDecision: 'decision' } });
  hooks.mount(() => module.EnterpriseApprovalsPage());
  const table = nodes(hooks.value).find(n => n.type === 'table'), action = table.props.columns.find(c => c.key === 'actions').render(null, row);
  assert.equal(action.props.disabled, false, 'unknown original must not hide its closure target'); await hooks.act(() => action.props.onAction());
  const decision = nodes(hooks.value).find(n => n.type === 'decision'); assert.equal(decision.props.closureOperation, closure); assert.equal(decision.props.operation, operation);
  const recover = nodes(hooks.value).find(n => n.type === 'action' && n.props.label === 'Read original operation');
  await assert.rejects(recover.props.onAction(), /unresolved/u); assert.equal(completed, false);
  result = { approval: { ...row, state: 'closed' }, original: { state: 'closed', retryable: false }, retryable: false };
  await recover.props.onAction(); assert.equal(completed, true); assert.ok(reads.every(path => path.endsWith('/result')), 'the supplied receipt retains the original target');
});

check('Enterprise execution closure: explicit per-row confirmation/reason only, review queue cannot close, sealed state has no submit action', async () => {
  const hooks = reactHost(), commands = [], operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('unexpected closure read'),
    async run(prepare, afterCommit) { const command = await prepare(); commands.push(plain(command)); await afterCommit({}); } };
  const module = load('apps/enterprise-portal/src/ApprovalDecision.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@/components/ui/customer-entry': { ActionButton: 'button', Alert: 'alert', Checkbox: 'checkbox', Input: { TextArea: 'textarea' } }, './ApprovalReview': { EnterpriseApprovalReview: 'review' } });
  let row = { ...approval('executing'), quote: {} }, reviewMode = false;
  const mount = () => hooks.mount(() => module.EnterpriseApprovalDecision({ row, reviewMode, english: true, operation, closureOperation: operation, refresh: async () => {}, unavailable: false, canDecide: true }));
  const button = () => nodes(hooks.value).find(n => n.type === 'button' && n.props.label === 'Request controlled closure');
  mount(); assert.equal(button().props.disabled, true); await assert.rejects(button().props.onAction()); assert.equal(commands.length, 0);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'textarea').props.onChange({ target: { value: 'End the original execution without retrying' } }));
  assert.equal(button().props.disabled, true); await hooks.act(() => nodes(hooks.value).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } }));
  await button().props.onAction(); assert.equal(commands.length, 1); assert.equal(commands[0].path, '/enterprise/approvals/approval-q1/close-execution'); assert.equal(commands[0].input.confirm, true);
  hooks.unmount(); row = { ...row, id: 'approval-q2', revision: 3 }; mount(); assert.equal(button().props.disabled, true, 'another row must be explicitly reviewed');
  hooks.unmount(); reviewMode = true; mount(); assert.equal(button(), undefined, 'reviewers cannot close another applicant execution');
  hooks.unmount(); reviewMode = false; row = { ...row, state: 'closed' }; mount();
  assert.equal(button(), undefined); assert.equal(nodes(hooks.value).some(n => n.props.label === 'Explicitly submit this request'), false);
});

check('Extension approval page preserves unknown submit; exact original extension resolves, and row confirmation does not leak', async () => {
  const hooks = reactHost(), commands = [];
  const row = { id: 'expense-1', orderId: 'o1', applicantCustomerId: 'p1', corporateCustomerId: 'c1', workspaceId: 'w1', expectedOrderUpdatedAt: '2026-11-01T00:00:00Z', state: 'approved', revision: 2, expiresAt: '2099-01-01T00:00:00Z', reason: 'Business rental',
    preview: { originalEndAt: '2090-01-02T00:00:00Z', newEndAt: '2090-01-03T00:00:00Z', rentalAmount: 100, serviceAmount: 0, payableAmount: 100, depositDelta: 10, preAuthDelta: 0, currency: 'CNY', settlementMode: 'immediate', paymentRequired: true, chargeLines: [] } };
  let result = { approval: row, original: { state: 'not_submitted', retryable: false }, retryable: false }, complete = false;
  const context = { identity: 'expense-owner', selectedCorporateId: 'c1', session: { customer: { customerId: 'p1' } }, entry: { corporates: [] } };
  const operation = { blocked: false, busy: false, pending: { key: 'submit-key', path: '/enterprise/extension-approvals/submit', originalTarget: row.id }, assertCurrent() {},
    read: async path => path.startsWith('/enterprise/operations/') ? { state: 'committed', result: { approvalId: row.id } } : plain(result),
    recover: async after => { await after({ state: 'committed', result: { approvalId: row.id, extensionId: 'ext1' } }, '/enterprise/extension-approvals/submit'); complete = true; },
    run: async (prepare, after) => { commands.push(plain(await prepare())); await after({}); } };
  const Form = Object.assign('form', { useForm: () => [{ resetFields() {} }], Item: 'field' });
  const module = load('apps/enterprise-portal/src/ExtensionApprovalsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: () => ({ data: [row], isFetching: false, refetch: async () => ({}) }) }, dayjs: {},
    '@rental-os/shared': { formatRentalMoney: (n, c) => `${n} ${c}` }, '@/components/ui/DatePicker': { DatePicker: 'date' },
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': { useOriginalWorkflowOperation: () => operation } });
  hooks.mount(() => module.EnterpriseExtensionApprovalsPage());
  const recover = () => nodes(hooks.value).find(n => n.type === 'action' && n.props.label === 'Read original operation');
  await assert.rejects(recover().props.onAction(), /unresolved/u); assert.equal(complete, false);
  result = { approval: { ...row, state: 'consumed', extensionId: 'ext1' }, original: { state: 'observed', extensionId: 'wrong', extensionState: 'pending_payment', retryable: false }, retryable: false };
  await assert.rejects(recover().props.onAction(), /unresolved/u); assert.equal(complete, false);
  result.original.extensionId = 'ext1'; await recover().props.onAction(); assert.equal(complete, true);
  const submitPending = operation.pending, submitRead = operation.read, submitRecover = operation.recover;
  operation.pending = { key: 'request-key', path: '/enterprise/extension-approvals', originalTarget: 'o1' };
  operation.recoverExtensionRequest = async after => {
    const original = await operation.read('/enterprise/orders/o1/extension-request-operations/request-key');
    if (!extensionContracts.enterpriseExtensionRequestMatches(original, 'o1', 'request-key', 'p1', 's1')) throw new Error('原申请仍待精确核对');
    await after(original); complete = true;
  };
  let recoveredApproval = { ...row, orderId: 'another-order' };
  operation.read = async path => {
    assert.equal(path, '/enterprise/orders/o1/extension-request-operations/request-key');
    return { state: 'observed', approval: plain(recoveredApproval), retryable: false };
  };
  complete = false; await assert.rejects(recover().props.onAction(), /精确核对/u); assert.equal(complete, false);
  recoveredApproval = { ...row, applicantCustomerId: 'another-person' };
  await assert.rejects(recover().props.onAction(), /精确核对/u); assert.equal(complete, false);
  recoveredApproval = row; await hooks.act(() => recover().props.onAction()); assert.equal(complete, true);
  operation.pending = submitPending; operation.read = submitRead; operation.recover = submitRecover;
  const table = nodes(hooks.value).find(n => n.type === 'table'); await hooks.act(() => table.props.columns.find(c => c.key === 'actions').render(null, row).props.onAction());
  const child = nodes(hooks.value).find(n => typeof n.type === 'function'); assert.ok(child);
  hooks.unmount(); hooks.mount(() => child.type(child.props));
  const submit = () => nodes(hooks.value).find(n => n.type === 'action' && n.props.label === 'Explicitly submit this extension');
  assert.equal(submit().props.disabled, true); await assert.rejects(submit().props.onAction()); assert.equal(commands.length, 0);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed original extension' } }));
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } }));
  await submit().props.onAction(); assert.equal(commands.length, 1); assert.equal(commands[0].input.approvalId, row.id); assert.equal(commands[0].input.confirm, true);
  const closing = [], closureOperation = { ...operation, pending: undefined, run: async (prepare, after) => { closing.push(plain(await prepare())); await after({}); } };
  hooks.unmount(); hooks.mount(() => child.type({ ...child.props, closureOperation, row: { ...row, state: 'expired' } }));
  assert.equal(nodes(hooks.value).find(n => n.type === 'action' && n.props.label === 'Explicitly submit this extension'), undefined, 'expiry still blocks new execution');
  const closeButton = () => nodes(hooks.value).find(n => n.type === 'action' && n.props.label === 'Request controlled closure'); assert.ok(closeButton());
  assert.equal(closeButton().props.disabled, true); await assert.rejects(closeButton().props.onAction()); assert.equal(closing.length, 0);
  await hooks.act(() => nodes(hooks.value).filter(n => n.type === 'textarea').at(-1).props.onChange({ target: { value: 'Seal only the original' } }));
  await hooks.act(() => nodes(hooks.value).filter(n => n.type === 'checkbox').at(-1).props.onChange({ target: { checked: true } }));
  result = { approval: { ...row, state: 'closed', closedOperationKey: 'submit-key' }, original: { state: 'closed', retryable: false }, retryable: false };
  await closeButton().props.onAction(); assert.equal(closing.length, 1); assert.equal(closing[0].input.originalOperationKey, 'submit-key'); assert.equal(closing[0].input.confirm, true);
  hooks.unmount(); hooks.mount(() => child.type({ ...child.props, closureOperation, row: { ...row, id: 'expense-2', revision: 3 } })); assert.equal(submit().props.disabled, true); assert.equal(closeButton(), undefined, 'another row cannot close an unresolved submit');
});

check('Extension request recovery rejects an unrelated order and retains the exact original key on both consumers', async () => {
  for (const web of [false, true]) {
    const f = extensionFixture(web); await f.settle();
    f.handlers.command = async () => { throw new Error('acknowledgement lost'); };
    if (web) { await f.fill('date', '2090-01-03T00:00'); await f.fill('textarea', 'Original purpose'); await f.click('申请续租批准'); }
    else { await f.page.onPreview(); f.page.onEnterpriseReason({ detail: { value: 'Original purpose' } }); await f.page.onRequestEnterpriseExtension(); }
    const original = f.pending(); assert.ok(original);
    f.handlers.requestOriginal = async () => ({ state: 'observed', approval: { ...extensionApproval(), orderId: 'another-order' }, retryable: false });
    if (web) await f.click('核对原续租申请与结果');
    else await f.page.onReadEnterpriseExtension();
    assert.equal(f.pending().key, original.key); assert.equal(f.count('command'), 1);
  }
});

function extensionApproval(state = 'pending') {
  return { id: 'expense-1', orderId: 'o1', applicantCustomerId: 'p1', corporateCustomerId: 'c1', workspaceId: 'w1',
    expectedOrderUpdatedAt: '2026-11-01T00:00:00Z', state, revision: 2, expiresAt: '2099-01-01T00:00:00Z', reason: 'Original purpose',
    ...(state === 'consumed' ? { extensionId: 'ext1' } : {}),
    preview: { originalEndAt: '2090-01-02T00:00:00Z', newEndAt: '2090-01-03T00:00:00Z', rentalAmount: 100, serviceAmount: 0,
      payableAmount: 100, depositDelta: 10, preAuthDelta: 0, currency: 'CNY', settlementMode: 'immediate', paymentRequired: true, chargeLines: [] } };
}
function extensionFixture(web = false) {
  const hooks = reactHost(), events = emitter(), storage = new Map(), calls = [], locks = new Map();
  const f = { hooks, events, storage, calls, handlers: {}, storageMode: '', customer: 'p1', version: 1, service: 's1', keys: 0,
    rows: [], extensions: [], confirm: true, required: true,
    order: { id: 'o1', orderNo: 'O-1', updatedAt: '2026-11-01T00:00:00Z', endAt: '2090-01-02T00:00:00Z', status: 'renting', currency: 'CNY', lines: [] },
    props: { orderId: 'o1', identity: 'original-order-owner', english: false },
    result: { approval: extensionApproval(), original: { state: 'not_submitted', retryable: false }, retryable: false },
    receipt: { state: 'committed', result: { id: 'expense-1' } } };
  const invoke = async (name, args, fallback) => { calls.push({ name, args: plain(args) }); return Object.hasOwn(f.handlers, name) ? f.handlers[name](...args) : plain(fallback); };
  f.count = name => calls.filter(c => c.name === name).length;
  const eligibility = () => ({ orderId: 'o1', expectedOrderUpdatedAt: f.order.updatedAt, approvalRequired: f.required });
  const command = async (path, input) => {
    calls.push({ name: 'command', path, input: plain(input) });
    if (f.handlers.command) return f.handlers.command(path, input);
    if (path.endsWith('/close-execution')) {
      f.result = { approval: { ...extensionApproval('closed'), closedOperationKey: input.originalOperationKey }, original: { state: 'closed', retryable: false }, retryable: false };
      f.receipt = { state: 'committed', result: { approvalId: 'expense-1', state: 'closed', closedOperationKey: input.originalOperationKey } }; f.rows = [f.result.approval]; return {};
    }
    if (path.endsWith('/close')) {
      const originalKey = decodeURIComponent(path.split('/').at(-2));
      f.requestOriginal = { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: f.service, applicantCustomerId: f.customer, closedOperationKey: originalKey, retryable: false };
      f.receipt = { state: 'committed', result: { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: f.service, applicantCustomerId: f.customer, originalOperationKey: originalKey, closureOperationKey: input.operationKey, retryable: false } };
      return plain(f.requestOriginal);
    }
    const submit = path.endsWith('/submit');
    f.result = { approval: extensionApproval(submit ? 'consumed' : 'pending'), original: submit
      ? { state: 'observed', extensionId: 'ext1', extensionState: 'pending_payment', retryable: false }
      : { state: 'not_submitted', retryable: false }, retryable: false };
    f.receipt = { state: 'committed', result: submit ? { approvalId: 'expense-1', extensionId: 'ext1' } : { id: 'expense-1' } };
    f.rows = [f.result.approval]; if (submit) f.extensions = [{ id: 'ext1', newEndAt: f.result.approval.preview.newEndAt, payableAmount: 100, status: 'pending_payment' }];
    return {};
  };
  if (web) {
    const capture = () => {
      const signature = JSON.stringify([f.customer, f.service, f.version]);
      return { tenantCode: 'merchant', customerId: f.customer, workspaceCode: f.service, operationScope: JSON.stringify(['merchant', f.customer, f.service]), identity: signature,
        current: () => signature === JSON.stringify([f.customer, f.service, f.version]) };
    };
    const localStorage = { getItem: key => storage.get(key) ?? null,
      setItem(key, value) { if (f.storageMode === 'throw') throw new Error('storage denied'); if (f.storageMode !== 'drop') storage.set(key, value); }, removeItem: key => storage.delete(key) };
    const sessionApi = { enterpriseExtensionEligibility: (...args) => invoke('eligibility', args, eligibility()),
      enterpriseExtensionApprovals: (...args) => invoke('list', args, f.rows), enterpriseExtensionResult: (...args) => invoke('result', args, f.result),
      enterpriseExtensionRequestOriginal: (...args) => invoke('requestOriginal', args, f.requestOriginal ?? (f.receipt.state === 'committed' ? { state: 'observed', approval: f.result.approval, retryable: false } : { state: 'not_recorded', retryable: false })),
      enterpriseOperation: (...args) => invoke('receipt', args, f.receipt), enterpriseCommand: command,
      closeEnterpriseExtensionRequest: (order, key, input) => command(`/enterprise/orders/${encodeURIComponent(order)}/extension-request-operations/${encodeURIComponent(key)}/close`, input) };
    const module = load('apps/tenant-website/src/components/EnterpriseExtensionApproval.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
      '@rental-os/shared': { formatRentalMoney: n => String(n) }, '../data/authClient': { captureEnterpriseHostSession: capture, sessionApi, subscribeCustomerSession: (_t, fn) => events.on(fn) } },
    { localStorage, crypto: { randomUUID: () => `extension-key-${++f.keys}` }, navigator: { locks: { request(key, fn) {
      const next = (locks.get(key) ?? Promise.resolve()).then(fn); locks.set(key, next.catch(() => {})); return next;
    } } } });
    f.mount = () => hooks.mount(() => module.EnterpriseExtensionApproval(f.props));
    f.button = label => { const node = nodes(hooks.value).find(n => n.type === 'button' && text(n) === label); assert.ok(node, label); return node; };
    f.click = label => hooks.act(() => { const b = f.button(label); assert.equal(Boolean(b.props.disabled), false, label); b.props.onClick(); });
    f.fill = (type, value) => hooks.act(() => { const n = nodes(hooks.value).find(n => type === 'date' ? n.type === 'input' && n.props.type === 'datetime-local' : n.type === type); assert.ok(n, type); n.props.onChange({ target: { value } }); });
    f.check = () => hooks.act(() => nodes(hooks.value).find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }));
    f.mount();
  } else {
    const wx = { getStorageSync: key => plain(storage.get(key)), setStorageSync(key, value) {
      if (f.storageMode === 'throw') throw new Error('storage denied'); if (f.storageMode !== 'drop') storage.set(key, plain(value));
    }, removeStorageSync: key => storage.delete(key), getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
      showModal: options => invoke('modal', [options], { confirm: f.confirm }), stopPullDownRefresh() {} };
    const session = { currentSession: () => ({ customer: { customerId: f.customer } }), currentServiceCode: () => f.service,
      contextVersion: () => f.version, isSignedIn: () => Boolean(f.customer), sessionEvents: events };
    const storageModule = load('apps/miniprogram/src/core/storage.ts', {}, { wx }); f.storageModule = storageModule;
    const api = load('apps/miniprogram/src/api/enterprise.ts', { '../core/http': { request: async (url, options = {}) => {
      if (options.method === 'POST') { assert.equal(options.replayAfterRefresh, false); return command(url, options.data); }
      if (url.endsWith('/extension-eligibility')) return invoke('eligibility', [url], eligibility());
      if (url.endsWith('/my-extension-approvals')) return invoke('list', [url], f.rows);
      if (url.includes('/extension-request-operations/')) return invoke('requestOriginal', [url], f.requestOriginal ?? (f.receipt.state === 'committed' ? { state: 'observed', approval: f.result.approval, retryable: false } : { state: 'not_recorded', retryable: false }));
      if (url.includes('/operations/')) return invoke('receipt', [url], f.receipt);
      if (url.endsWith('/result')) return invoke('result', [url], f.result);
      throw new Error(url);
    } } });
    const helper = load('apps/miniprogram/src/core/enterprise-extension-operation.ts', { '../api/enterprise': api, '../config/public': { PUBLIC_CONFIG: { tenantCode: 'merchant' } },
      './keys': { newKey: prefix => `${prefix}-${++f.keys}` }, './session': session, './storage': storageModule }, { wx });
    let definition;
    load('apps/miniprogram/src/pages/extend/index.ts', { '../../core/theme-behavior': { themeBehavior: {} }, '../../api/enterprise': api,
      '../../core/enterprise-extension-operation': helper, '../../core/session': session,
      '../../api/orders': { fetchOrder: (...args) => invoke('order', args, f.order), listExtensions: (...args) => invoke('extensions', args, f.extensions),
        previewExtension: (...args) => invoke('preview', args, extensionApproval().preview), applyExtension: (...args) => invoke('ordinary', args, { extension: { status: 'pending_payment', payableAmount: 100 } }),
        fetchFunding: (...args) => invoke('funding', args, {}), activatePaidExtension: (...args) => invoke('activate', args, { extension: { status: 'effective' } }) },
      '../../core/errors': { describeError: e => ({ message: e.message }) }, '../../core/flow': { ensureServiceForOrder: async () => true }, '../../core/http': { isApiError: (e, code) => e.code === code },
      '../../core/keys': { actionKey: () => 'ordinary-key', releaseActionKey() {} }, '../../core/money': { describeDelta: n => String(n) },
      '../../core/page': { loadingState: () => ({ status: 'loading' }), readyState: () => ({ status: 'ready' }), blockedState: () => ({ status: 'blocked' }), errorState: e => ({ status: 'error', message: e.message }), handleCommonViewAction: () => false },
      '../../core/payment': { rentalDue: () => 0 }, '../../core/time': { formatBusinessDateTime: s => s, splitInstant: () => ({ date: '2090-01-02', time: '00:00' }), todayInZone: () => '2090-01-01', zoneLabel: () => 'UTC', zonedToInstant: () => '2090-01-03T00:00:00Z' },
      '../../core/ui': { ROUTES: { order: '/order', pay: '/pay', extend: '/extend' }, buildUrl: (route, params) => `${route}?id=${params.id}`, navigate: url => calls.push({ name: 'navigate', url }), requireSignIn: () => true, toast: message => calls.push({ name: 'toast', message }) },
      '../../core/zones': { zoneOf: () => 'UTC', ensureCurrentZone: async () => {} } }, { wx, Page: value => { definition = value; } });
    f.page = { ...definition, data: plain(definition.data), patches: [], setData(patch) { this.patches.push(plain(patch)); Object.assign(this.data, patch); } };
    f.page.onLoad({ id: 'o1', service: 's1' }); f.page.onShow();
    f.helper = helper; f.wx = wx;
  }
  f.pending = () => { const value = [...storage.values()][0]; return value ? web ? JSON.parse(value) : plain(value) : undefined; };
  f.changeIdentity = (sameCustomer = false) => { if (!sameCustomer) f.customer = 'p2'; f.version++; events.emit({ type: 'signed-in' }); if (web) hooks.rerender(); };
  f.settle = () => hooks.settle();
  return f;
}
check('Website extension: original request then explicit consumed result; pending payment is not rental effect', async () => {
  const f = extensionFixture(true); await f.settle(); await f.fill('textarea', 'Reviewed purpose'); await f.fill('date', '2090-01-03T00:00');
  await f.click('申请续租批准'); assert.equal(f.count('command'), 1); assert.equal(f.pending(), undefined); assert.equal(f.result.approval.state, 'pending');
  f.rows = [extensionApproval('approved')]; f.result.approval = f.rows[0]; await f.click('核对原续租申请与结果'); await f.fill('select', 'expense-1');
  assert.equal(f.button('核对后提交本条续租').props.disabled, true); await f.check(); await f.click('核对后提交本条续租');
  assert.equal(f.count('command'), 2); assert.equal(f.pending(), undefined); assert.ok(text(f.hooks.value).includes('待补款，原归还时间不变'));
  assert.equal(f.calls.filter(c => c.name === 'command')[1].input.confirm, true);
});
check('Website extension: durable failures, unknown response, mismatched original and same-account generation isolate dispatch', async () => {
  for (const mode of ['throw', 'drop']) { const f = extensionFixture(true); await f.settle(); f.storageMode = mode; await f.fill('textarea', 'Purpose'); await f.fill('date', '2090-01-03T00:00'); await f.click('申请续租批准'); assert.equal(f.count('command'), 0); }
  const f = extensionFixture(true); f.rows = [extensionApproval('approved')]; await f.settle(); await f.click('核对原续租申请与结果'); await f.fill('select', 'expense-1'); await f.fill('textarea', 'Purpose'); await f.check();
  f.handlers.command = async () => { throw new Error('lost submit'); }; await f.click('核对后提交本条续租'); const original = f.pending();
  f.receipt = { state: 'not_recorded' }; await f.click('核对原续租申请与结果'); assert.deepEqual(f.pending(), original);
  f.receipt = { state: 'committed', result: { approvalId: 'expense-1', extensionId: 'ext1' } };
  f.result = { approval: extensionApproval('consumed'), original: { state: 'observed', extensionId: 'wrong', extensionState: 'pending_payment', retryable: false }, retryable: false };
  await f.click('核对原续租申请与结果'); assert.deepEqual(f.pending(), original); assert.equal(f.count('command'), 1);
  f.changeIdentity(true); await f.settle(); assert.equal(nodes(f.hooks.value).find(n => n.type === 'textarea').props.value, '');
  f.result.original.extensionId = 'ext1'; await f.click('核对原续租申请与结果'); assert.equal(f.pending(), undefined); assert.equal(f.count('command'), 1);
  const late = extensionFixture(true), gate = deferred(); await late.settle(); await late.fill('textarea', 'Private old purpose'); await late.fill('date', '2090-01-03T00:00'); late.handlers.command = () => gate.promise;
  await late.click('申请续租批准'); const saved = late.pending(); late.changeIdentity(true); await late.settle(); const reads = late.count('receipt'); gate.resolve({}); await late.settle();
  assert.deepEqual(late.pending(), saved); assert.equal(late.count('receipt'), reads); assert.equal(late.button('申请续租批准').props.disabled, true);
});
check('Mini extension: approval is not submission; modal cancel, exact original result and original pending-payment entry', async () => {
  const f = extensionFixture(); await f.settle(); await f.page.onPreview(); f.page.onEnterpriseReason({ detail: { value: 'Purpose' } });
  await f.page.onRequestEnterpriseExtension(); assert.equal(f.count('command'), 1); assert.equal(f.pending(), undefined); assert.equal(f.page.data.enterpriseApproval.state, 'pending');
  f.result.approval = extensionApproval('approved'); await f.page.onReadEnterpriseExtension(); f.confirm = false; await f.page.onSubmitEnterpriseExtension(); assert.equal(f.count('command'), 1);
  f.confirm = true; await f.page.onSubmitEnterpriseExtension(); assert.equal(f.count('command'), 2); assert.equal(f.pending(), undefined);
  assert.equal(f.page.data.pending.id, 'ext1'); assert.equal(f.page.data.order.endAt, '2090-01-02T00:00:00Z'); assert.equal(f.page.data.preview, undefined); assert.ok(f.page.data.enterpriseResult.includes('原租期不变'));
  assert.equal(f.count('navigate'), 0); assert.equal(f.count('ordinary'), 0);
});
check('Mini extension: storage/CAS/unknown original, hidden and changed owner never clear or retry; opaque re-login recovery', async () => {
  for (const mode of ['throw', 'drop']) { const f = extensionFixture(); await f.settle(); await f.page.onPreview(); f.page.onEnterpriseReason({ detail: { value: 'Purpose' } }); f.storageMode = mode; await f.page.onRequestEnterpriseExtension(); assert.equal(f.count('command'), 0); }
  const f = extensionFixture(); await f.settle(); await f.page.onPreview(); f.page.onEnterpriseReason({ detail: { value: 'Purpose' } });
  f.handlers.command = async () => { throw { status: 409, code: 'CONFLICT', body: { code: 'enterprise_revision_conflict' }, message: 'pre-write CAS' }; };
  await f.page.onRequestEnterpriseExtension(); assert.equal(f.pending(), undefined, 'real mini transport puts business code in body');
  f.handlers.command = async () => { throw new Error('lost request'); }; await f.page.onRequestEnterpriseExtension(); const saved = f.pending();
  f.receipt = { state: 'not_recorded' }; await f.page.onReadEnterpriseExtension(); assert.deepEqual(f.pending(), saved); assert.equal(f.count('command'), 2);
  f.storageModule.clearPrivateStorage(); assert.deepEqual(f.pending(), saved, 'sign-out cannot erase an opaque unresolved operation');
  f.changeIdentity(); await f.settle(); assert.equal(f.page.data.enterpriseReason, ''); assert.equal(f.page.data.order, undefined);
  for (const action of ['hide', 'identity']) {
    const late = extensionFixture(), gate = deferred(); await late.settle(); await late.page.onPreview(); late.page.onEnterpriseReason({ detail: { value: 'Purpose' } }); late.handlers.command = () => gate.promise;
    const writing = late.page.onRequestEnterpriseExtension(); const before = late.pending(); if (action === 'hide') late.page.onHide(); else late.changeIdentity();
    const patches = late.page.patches.length; gate.resolve({}); await writing; assert.deepEqual(late.pending(), before); assert.equal(late.count('receipt'), 0); assert.equal(late.page.patches.length, patches);
  }
});
check('Mini extension: resolved personal eligibility preserves ordinary flow; unknown gate blocks; terminal history permits new approval', async () => {
  const f = extensionFixture(); f.required = false; f.handlers.list = async () => { throw new Error('enterprise table unavailable'); }; await f.settle(); await f.page.load();
  assert.equal(f.page.data.view.status, 'ready'); assert.equal(f.page.data.enterpriseRequired, false); await f.page.onPreview(); await f.page.onApply(); assert.equal(f.count('ordinary'), 1);
  const missing = extensionFixture(); missing.handlers.eligibility = async () => { throw new Error('eligibility unavailable'); }; await missing.settle(); await missing.page.load(); await missing.page.onPreview(); await missing.page.onApply(); assert.equal(missing.count('ordinary'), 0);
  const expired = extensionFixture(); expired.rows = [extensionApproval('expired')]; await expired.settle(); await expired.page.load(); await expired.page.onPreview(); expired.page.onEnterpriseReason({ detail: { value: 'New explicit purpose' } }); await expired.page.onRequestEnterpriseExtension(); assert.equal(expired.count('command'), 1);
  const late = extensionFixture(), gate = deferred(); await late.settle(); late.page.data.pending = { id: 'ext1', status: 'pending_payment' }; late.handlers.funding = () => gate.promise;
  const activation = late.page.onActivate(); late.changeIdentity(); const patches = late.page.patches.length; gate.resolve({}); await activation;
  assert.equal(late.count('activate'), 0, 'late funding read cannot activate for changed customer'); assert.equal(late.count('navigate'), 0); assert.equal(late.page.patches.length, patches);
});

check('Extension controlled closure: confirmation is separate, exact sealed key releases only original submit, and lost closure never POSTs again', async () => {
  const f = extensionFixture(true); f.rows = [extensionApproval('approved')]; await f.settle(); await f.click('核对原续租申请与结果'); await f.fill('select', 'expense-1'); await f.fill('textarea', 'Submit reason'); await f.check();
  f.handlers.command = async () => { throw new Error('lost submit'); }; await f.click('核对后提交本条续租'); const original = f.pending();
  assert.equal(f.button('请求受控结束原提交').props.disabled, true, 'submission checkbox never confirms closure');
  const fields = nodes(f.hooks.value).filter(n => n.type === 'textarea'), boxes = nodes(f.hooks.value).filter(n => n.type === 'input' && n.props.type === 'checkbox');
  await f.hooks.act(() => fields.at(-1).props.onChange({ target: { value: 'Seal only the original submission' } })); await f.hooks.act(() => boxes.at(-1).props.onChange({ target: { checked: true } }));
  delete f.handlers.command; await f.click('请求受控结束原提交'); assert.equal(f.count('command'), 2); assert.equal(f.pending(), undefined); assert.ok(text(f.hooks.value).includes('原提交已封闭'));
  assert.equal(f.calls.filter(c => c.name === 'command')[1].input.originalOperationKey, original.key);
  const mini = extensionFixture(); mini.rows = [extensionApproval('approved')]; await mini.settle(); await mini.page.load(); mini.page.onEnterpriseReason({ detail: { value: 'Submit reason' } });
  mini.handlers.command = async () => { throw new Error('lost submit'); }; await mini.page.onSubmitEnterpriseExtension(); const pending = mini.pending(); mini.confirm = false;
  await mini.page.onCloseEnterpriseExtension(); assert.equal(mini.count('command'), 1); assert.deepEqual(mini.pending(), pending);
  mini.confirm = true; await mini.page.onCloseEnterpriseExtension(); const closing = mini.pending(); assert.ok(closing.closureKey); assert.equal(mini.count('command'), 2);
  mini.receipt = { state: 'not_recorded' }; await mini.page.onReadEnterpriseExtension(); assert.deepEqual(mini.pending(), closing); assert.equal(mini.count('command'), 2);
  mini.receipt = { state: 'committed', result: { approvalId: 'expense-1', state: 'closed', closedOperationKey: pending.key } };
  mini.result = { approval: { ...extensionApproval('closed'), closedOperationKey: 'wrong' }, original: { state: 'closed', retryable: false }, retryable: false };
  await mini.page.onReadEnterpriseExtension(); assert.deepEqual(mini.pending(), closing);
  mini.result.approval.closedOperationKey = pending.key; await mini.page.onReadEnterpriseExtension(); assert.equal(mini.pending(), undefined); assert.equal(mini.count('command'), 2); assert.equal(mini.count('ordinary'), 0);
});

check('Unknown extension application closure: no approval row, independent confirmation, reliable storage, lost closure ACK and exact original seal', async () => {
  for (const web of [true, false]) {
    const f = extensionFixture(web); await f.settle();
    f.handlers.command = async () => { throw new Error('lost request'); }; f.receipt = { state: 'not_recorded' };
    if (web) { await f.fill('textarea', 'Request purpose'); await f.fill('date', '2090-01-03T00:00'); await f.click('申请续租批准'); }
    else { await f.page.onPreview(); f.page.onEnterpriseReason({ detail: { value: 'Request purpose' } }); await f.page.onRequestEnterpriseExtension(); }
    const original = f.pending(); assert.equal(original.kind, 'request'); assert.equal(f.rows.length, 0);
    if (web) {
      assert.equal(f.button('请求受控结束原提交').props.disabled, true);
      await f.hooks.act(() => nodes(f.hooks.value).filter(n => n.type === 'textarea').at(-1).props.onChange({ target: { value: 'Independent closure' } }));
      await f.hooks.act(() => nodes(f.hooks.value).filter(n => n.type === 'input' && n.props.type === 'checkbox').at(-1).props.onChange({ target: { checked: true } }));
    } else { assert.equal(f.page.data.enterpriseCanClose, true); f.confirm = false; await f.page.onCloseEnterpriseExtension(); assert.equal(f.count('command'), 1); f.confirm = true; }
    for (const mode of ['throw', 'drop']) {
      f.storageMode = mode;
      if (web) await f.click('请求受控结束原提交'); else await f.page.onCloseEnterpriseExtension();
      assert.equal(f.count('command'), 1, 'no closure when C cannot be reliably saved');
    }
    f.storageMode = '';
    if (web) await f.click('请求受控结束原提交'); else await f.page.onCloseEnterpriseExtension();
    const closing = f.pending(); assert.ok(closing.closureKey); assert.notEqual(closing.closureKey, closing.key); assert.equal(f.count('command'), 2);
    const sealed = { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: 's1', applicantCustomerId: 'p1', closedOperationKey: original.key, retryable: false };
    f.requestOriginal = { ...sealed, closedOperationKey: 'wrong' };
    f.receipt = { state: 'committed', result: { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: 's1', applicantCustomerId: 'p1', originalOperationKey: original.key, closureOperationKey: closing.closureKey, retryable: false } };
    if (web) await f.click('核对原续租申请与结果'); else await f.page.onReadEnterpriseExtension();
    assert.deepEqual(f.pending(), closing); assert.equal(f.count('command'), 2);
    f.requestOriginal = sealed;
    if (web) await f.click('核对原续租申请与结果'); else await f.page.onReadEnterpriseExtension();
    assert.equal(f.pending(), undefined); assert.equal(f.count('command'), 2); assert.equal(f.count('ordinary'), 0);
  }
});

check('Enterprise Web real operation gate closes an unknown request with no approval row; generic missing receipt stays blocked', async () => {
  const hooks = reactHost(), storage = new Map(), writes = [], reads = []; let key = 0, closed, closeReceipt, failStorage = false;
  const context = { identity: 'request-owner', tenantCode: 'merchant', session: { customer: { customerId: 'p1' }, workspace: { workspaceCode: 's1' } }, selectedCorporateId: 'c1', entry: { corporates: [] }, signal: new AbortController().signal,
    async write(path, input) {
      writes.push({ path, input: plain(input) });
      if (!path.endsWith('/close')) throw new Error('request ACK lost');
      const originalKey = decodeURIComponent(path.split('/').at(-2));
      closed = { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: 's1', applicantCustomerId: 'p1', closedOperationKey: originalKey, retryable: false };
      closeReceipt = { ...closed, originalOperationKey: originalKey, closureOperationKey: input.operationKey }; delete closeReceipt.closedOperationKey;
      throw new Error('closure ACK lost');
    },
    async read(path) {
      reads.push(path);
      if (path.includes('/extension-request-operations/')) return closed ?? { state: 'not_recorded', retryable: false };
      if (path.includes('/operations/')) return closeReceipt ? { state: 'committed', result: closeReceipt } : { state: 'not_recorded' };
      throw new Error(path);
    } };
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem(key, value) { if (failStorage) throw new Error('storage failed'); storage.set(key, value); }, removeItem: key => storage.delete(key) };
  const gate = load('apps/enterprise-portal/src/original-workflow-operation.ts', { react: hooks.runtime, '@rental-os/web-client': { customerSessionGeneration: () => 'request-generation' }, './enterprise-session': { useEnterprise: () => context } },
    { localStorage, AbortSignal, navigator: { locks: { request: (_key, fn) => Promise.resolve().then(fn) } }, crypto: { randomUUID: () => `original-${++key}` } });
  let operation;
  hooks.mount(() => { operation = gate.useOriginalWorkflowOperation('extension-approvals:mine'); return operation; });
  await assert.rejects(operation.run(() => ({ path: '/enterprise/extension-approvals', originalTarget: 'o1', input: { expectedRevision: 0, reason: 'private' } }), async () => {})); hooks.flush();
  await assert.rejects(hooks.value.recover(async () => { throw new Error('generic callback must not run'); }), /收据/u); assert.equal(storage.size, 1);
  hooks.unmount();
  const Form = Object.assign('form', { useForm: () => [{ resetFields() {} }], Item: 'field' });
  const page = load('apps/enterprise-portal/src/ExtensionApprovalsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: () => ({ data: [], isFetching: false, refetch: async () => ({}) }) }, dayjs: {},
    '@/components/ui/DatePicker': { DatePicker: 'date' }, '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': gate });
  hooks.mount(() => page.EnterpriseExtensionApprovalsPage());
  const action = label => nodes(hooks.value).find(n => n.type === 'action' && n.props.label === label);
  assert.equal(action('Request original application closure').props.disabled, true);
  await assert.rejects(async () => action('Request original application closure').props.onAction()); assert.equal(writes.length, 1);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'textarea' && n.props['aria-label'] === 'Original request closure reason').props.onChange({ target: { value: 'Independent original closure' } }));
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } }));
  failStorage = true; await assert.rejects(async () => action('Request original application closure').props.onAction()); assert.equal(writes.length, 1); failStorage = false;
  await assert.rejects(action('Request original application closure').props.onAction(), /ACK/u); hooks.flush(); assert.equal(writes.length, 2);
  const saved = [...storage.values()][0]; assert.ok(JSON.parse(saved).closureKey); assert.equal(saved.includes('Independent'), false);
  closeReceipt.originalOperationKey = 'wrong'; await assert.rejects(action('Read original operation').props.onAction()); assert.equal(storage.size, 1);
  closeReceipt.originalOperationKey = closed.closedOperationKey; await action('Read original operation').props.onAction(); hooks.flush();
  assert.equal(storage.size, 0); assert.equal(writes.length, 2); assert.ok(nodes(hooks.value).some(n => String(n.props.title).includes('Original request key sealed')));
});

check('Exchange page real operation keeps durable original order through lost ACK and reload; no automatic redispatch', async () => {
  const hooks = reactHost(), storage = new Map(), writes = [], reads = [], values = {}; let counter = 0, receipt = { state: 'not_recorded' }, failStorage = false;
  const row = { id: 'exchange-1', orderId: 'o1', workspaceId: 'w1', applicantCustomerId: 'p1', corporateCustomerId: 'c1', revision: 1, state: 'pending',
    expiresAt: '2099-01-01T00:00:00Z', reason: 'Original purpose', exchange: { priceBasis: 'original_order_price' },
    preview: { originalItemGroupName: 'Original', replacementItemGroupName: 'Replacement', originalAmount: 100, replacementAmount: 140, additionalAmount: 40, refundAmount: 0, depositDelta: 10, preAuthDelta: 0, currency: 'CNY' } };
  const context = { identity: 'exchange-owner', tenantCode: 'merchant', selectedCorporateId: 'c1', signal: new AbortController().signal,
    session: { customer: { customerId: 'p1' }, workspace: { workspaceCode: 's1' } }, entry: { corporates: [] },
    async read(path) { reads.push(path); if (path.startsWith('/orders/')) return { id: 'o1', updatedAt: 'original-revision' };
      if (path.includes('/exchange-request-operations/')) return receipt.state === 'committed' ? { state: 'observed', approval: plain(row), retryable: false } : { state: 'not_recorded', retryable: false };
      if (path.includes('/operations/')) return plain(receipt); if (path.endsWith('/exchange-1')) return plain(row); throw new Error(path); },
    async write(path, input) { writes.push({ path, input: plain(input) }); throw new Error('request ACK lost'); } };
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem(key, value) { if (failStorage) throw new Error('storage failed'); storage.set(key, value); }, removeItem: key => storage.delete(key) };
  const gate = load('apps/enterprise-portal/src/original-workflow-operation.ts', { react: hooks.runtime, '@rental-os/web-client': { customerSessionGeneration: () => 'exchange-generation' }, './enterprise-session': { useEnterprise: () => context } },
    { localStorage, AbortSignal, navigator: { locks: { request: (_key, fn) => Promise.resolve().then(fn) } }, crypto: { randomUUID: () => `exchange-${++counter}` } });
  const form = { resetFields() { for (const key of Object.keys(values)) delete values[key]; }, setFieldsValue: next => Object.assign(values, next), validateFields: async () => ({ ...values }) };
  let choicesFetching = false;
  const choiceData = (allocation, replacement) => ({ orderId: 'o1', orderNo: 'Order 1', expectedOrderUpdatedAt: 'original-revision', applicantCustomerId: 'p1', workspaceId: 'w1',
    selectedAllocationId: allocation || undefined, selectedReplacementItemGroupId: replacement || undefined, reservation: 'not_reserved',
    lines: [{ orderLineId: 'line1', allocationId: 'a1', itemGroupId: 'old', itemGroupName: 'Original', quantity: 1 }],
    replacements: [{ itemGroupId: 'new', name: 'Replacement', inventoryMode: 'quantity', pricingGroups: [] }], assets: [] });
  const Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
  const page = load('apps/enterprise-portal/src/ExchangeApprovalsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: ({ queryKey }) => queryKey[0] === 'enterprise-exchange-orders'
      ? { data: { items: [{ id: 'o1', orderNo: 'Order 1', lines: [{ itemGroupName: 'Original' }] }], total: 1 }, isFetching: false }
      : queryKey[0] === 'enterprise-exchange-choices' ? { data: choiceData(queryKey[3], queryKey[4]), isFetching: choicesFetching }
      : { data: [row], isFetching: false, refetch: async () => ({}) } },
    '@rental-os/shared': { formatRentalMoney: n => String(n) }, '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': gate });
  const mount = () => { hooks.mount(() => page.EnterpriseExchangeApprovalsPage()); Object.assign(values, { orderId: 'o1', orderLineId: 'line1', allocationId: 'a1', replacementItemGroupId: 'new', priceBasis: 'original_order_price', reason: 'Private application purpose' }); };
  const save = () => nodes(hooks.value).find(n => n.type === 'save'), recover = () => nodes(hooks.value).find(n => n.props.label === 'Read original exchange operation');
  const choose = async () => {
    for (const [field, value] of [['orderId', 'o1'], ['allocationId', 'a1'], ['replacementItemGroupId', 'new']]) {
      const control = nodes(nodes(hooks.value).find(n => n.type === 'field' && n.props.name === field)).find(n => n.type === 'select');
      values[field] = value; await hooks.act(() => control.props.onChange(value));
    }
    values.reason = 'Private application purpose'; values.priceBasis = 'original_order_price';
  };
  mount(); await choose(); choicesFetching = true; hooks.rerender(); await assert.rejects(save().props.onSave(), /choices/u); assert.equal(writes.length, 0);
  choicesFetching = false; hooks.rerender(); failStorage = true; await assert.rejects(save().props.onSave(), /storage/u); assert.equal(writes.length, 0); failStorage = false;
  await assert.rejects(save().props.onSave(), /ACK/u); hooks.flush(); assert.equal(writes.length, 1);
  const reference = JSON.parse([...storage.values()][0]); assert.equal(reference.originalTarget, 'o1'); assert.equal(JSON.stringify(reference).includes('Private'), false);
  hooks.unmount(); context.identity = 'exchange-permission-reloaded'; mount(); await assert.rejects(recover().props.onAction(), /核对/u); assert.equal(storage.size, 1); assert.equal(writes.length, 1);
  receipt = { state: 'committed', result: { id: row.id } }; row.orderId = 'wrong-order'; await assert.rejects(recover().props.onAction(), /核对/u); assert.equal(storage.size, 1);
  row.orderId = 'o1'; await recover().props.onAction(); hooks.flush(); assert.equal(storage.size, 0); assert.equal(writes.length, 1);
  const table = nodes(hooks.value).find(n => n.type === 'table'); await hooks.act(() => table.props.columns.find(c => c.title === 'Actions').render(null, row).props.onAction());
  const review = nodes(hooks.value).find(n => typeof n.type === 'function' && n.props.row);
  // Invoke the actual nested component with its original module's hook runtime,
  // using a new mount so the row's confirmation is independent of page state.
  hooks.unmount(); hooks.mount(() => review.type(review.props));
  const withdraw = () => nodes(hooks.value).find(n => n.props.label === 'Withdraw this exchange request');
  assert.equal(withdraw().props.disabled, true); await assert.rejects(async () => withdraw().props.onAction()); assert.equal(writes.length, 1);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed withdrawal' } }));
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } }));
  // Old page operation is unmounted, so even a retained approved-looking button
  // cannot dispatch after ownership/lifecycle changes.
  await assert.rejects(async () => withdraw().props.onAction(), /Identity/u); assert.equal(writes.length, 1);
  assert.equal(reads.filter(p => p.includes('/exchange-request-operations/')).length, 3);
});

check('Exchange review requires independent confirmation, blocks self review and keeps the original revision', async () => {
  const hooks = reactHost(), commands = [];
  const context = { identity: 'exchange-reviewer', session: { customer: { customerId: 'reviewer' } } };
  const operation = { blocked: false, assertCurrent() {}, run: async prepare => { commands.push(plain(await prepare())); } };
  const Form = Object.assign('form', { useForm: () => [{ resetFields() {} }], Item: 'field' });
  const page = load('apps/enterprise-portal/src/ExchangeApprovalsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: ({ queryKey }) => queryKey[0] === 'enterprise-exchange-approvals' ? { data: [row], isFetching: false } : { data: undefined, isFetching: false } },
    '@rental-os/shared': { formatRentalMoney: n => String(n) }, '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => ({ ...context, entry: { corporates: [] } }) }, './original-workflow-operation': { useOriginalWorkflowOperation: () => operation } });
  let row = { id: 'original-1', orderId: 'o1', applicantCustomerId: 'p1', revision: 3, state: 'pending', expiresAt: '2099-01-01T00:00:00Z', reason: 'Purpose', exchange: { priceBasis: 'original_order_price' },
    preview: { originalItemGroupName: 'Original', replacementItemGroupName: 'Replacement', originalAmount: 100, replacementAmount: 140, additionalAmount: 40, refundAmount: 0, depositDelta: 10, preAuthDelta: 0, currency: 'CNY' } };
  hooks.mount(() => page.EnterpriseExchangeApprovalsPage());
  const table = nodes(hooks.value).find(n => n.type === 'table'); await hooks.act(() => table.props.columns.find(c => c.title === 'Actions').render(null, row).props.onAction());
  const nested = nodes(hooks.value).find(n => typeof n.type === 'function' && n.props.row);
  const mount = () => hooks.mount(() => nested.type({ ...nested.props, row, reviewMode: true }));
  const approve = () => nodes(hooks.value).find(n => n.props.label === 'Approve this exchange expense');
  hooks.unmount(); mount(); await assert.rejects(async () => approve().props.onAction()); assert.equal(commands.length, 0);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed original expense' } }));
  await assert.rejects(async () => approve().props.onAction()); assert.equal(commands.length, 0);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } }));
  await approve().props.onAction(); assert.equal(commands.length, 1); assert.equal(commands[0].input.expectedRevision, 3); assert.equal(commands[0].path, '/enterprise/exchange-approvals/original-1/decision');
  row = { ...row, id: 'original-2', revision: 4 }; hooks.unmount(); mount(); assert.equal(approve().props.disabled, true);
  row = { ...row, applicantCustomerId: 'reviewer' }; hooks.unmount(); mount(); assert.equal(approve(), undefined);
});

check('Exchange unknown request closes with independent confirmation, durable closure key and exact seal; no approval row required', async () => {
  const hooks = reactHost(), storage = new Map(), writes = []; let counter = 0, failStorage = false, seal, receipt;
  const context = { identity: 'exchange-close-owner', tenantCode: 'merchant', selectedCorporateId: 'c1', signal: new AbortController().signal,
    session: { customer: { customerId: 'p1' }, workspace: { workspaceCode: 's1' } }, entry: { corporates: [] },
    async write(path, input) {
      writes.push({ path, input: plain(input) }); assert.ok(path.endsWith('/exchange-request-operations/request-key/close'));
      seal = { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: 's1', applicantCustomerId: 'p1', closedOperationKey: 'request-key', retryable: false };
      receipt = { state: 'committed', result: { ...seal, originalOperationKey: 'request-key', closureOperationKey: input.operationKey } }; delete receipt.result.closedOperationKey;
      throw new Error('closure ACK lost');
    },
    async read(path) { if (path.includes('/exchange-request-operations/')) return plain(seal ?? { state: 'not_recorded', retryable: false }); if (path.includes('/operations/')) return plain(receipt ?? { state: 'not_recorded' }); throw new Error(path); } };
  const storageKey = 'rental-os:enterprise-workflow:' + JSON.stringify(['exchange-approvals:mine', 'merchant', 'p1', 's1', 'c1']);
  storage.set(storageKey, JSON.stringify({ key: 'request-key', path: '/enterprise/exchange-approvals', state: 'unknown', originalTarget: 'o1' }));
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem(key, value) { if (failStorage) throw new Error('storage failed'); storage.set(key, value); }, removeItem: key => storage.delete(key) };
  const gate = load('apps/enterprise-portal/src/original-workflow-operation.ts', { react: hooks.runtime, '@rental-os/web-client': { customerSessionGeneration: () => 'close-generation' }, './enterprise-session': { useEnterprise: () => context } },
    { localStorage, AbortSignal, navigator: { locks: { request: (_key, fn) => Promise.resolve().then(fn) } }, crypto: { randomUUID: () => `closure-${++counter}` } });
  const Form = Object.assign('form', { useForm: () => [{ resetFields() {} }], Item: 'field' });
  const page = load('apps/enterprise-portal/src/ExchangeApprovalsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: ({ queryKey }) => queryKey[0] === 'enterprise-exchange-approvals' ? { data: [], isFetching: false, refetch: async () => ({}) } : { isFetching: false } },
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': gate });
  hooks.mount(() => page.EnterpriseExchangeApprovalsPage());
  const action = label => nodes(hooks.value).find(n => n.props.label === label), close = () => action('Request original application closure');
  assert.equal(close().props.disabled, true); await assert.rejects(async () => close().props.onAction()); assert.equal(writes.length, 0);
  await hooks.act(() => nodes(hooks.value).find(n => n.props['aria-label'] === 'Original request closure reason').props.onChange({ target: { value: 'Independent closure reason' } }));
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } }));
  failStorage = true; await assert.rejects(close().props.onAction(), /storage/u); assert.equal(writes.length, 0); failStorage = false;
  await assert.rejects(close().props.onAction(), /ACK/u); hooks.flush(); assert.equal(writes.length, 1); assert.equal(close(), undefined);
  const saved = storage.get(storageKey); assert.ok(JSON.parse(saved).closureKey); assert.equal(saved.includes('Independent'), false);
  receipt.result.originalOperationKey = 'wrong'; await assert.rejects(action('Read original exchange operation').props.onAction()); assert.equal(storage.size, 1);
  receipt.result.originalOperationKey = 'request-key'; await action('Read original exchange operation').props.onAction(); hooks.flush();
  assert.equal(storage.size, 0); assert.equal(writes.length, 1); assert.ok(nodes(hooks.value).some(n => n.props.title === 'Original request key sealed'));
});

check('Applicant confirms an approved expense independently; confirmation is not merchant inspection or physical execution', async () => {
  const hooks = reactHost(), writes = []; let row = { id: 'expense-consent', orderId: 'o1', applicantCustomerId: 'p1', revision: 2, state: 'approved', expiresAt: '2099-01-01T00:00:00Z', reason: 'Purpose', exchange: { priceBasis: 'original_order_price' },
    preview: { originalItemGroupName: 'Original', replacementItemGroupName: 'Replacement', originalAmount: 100, replacementAmount: 140, additionalAmount: 40, refundAmount: 0, depositDelta: 10, preAuthDelta: 0, currency: 'CNY' } };
  const context = { identity: 'consent-owner', session: { customer: { customerId: 'p1' } }, entry: { corporates: [] } };
  const operation = { blocked: false, assertCurrent() {}, run: async prepare => { writes.push(plain(await prepare())); } };
  const Form = Object.assign('form', { useForm: () => [{ resetFields() {} }], Item: 'field' });
  const module = load('apps/enterprise-portal/src/ExchangeApprovalsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: ({ queryKey }) => queryKey[0] === 'enterprise-exchange-approvals' ? { data: [row], isFetching: false } : {} }, '@rental-os/shared': { formatRentalMoney: n => String(n) },
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': { useOriginalWorkflowOperation: () => operation } });
  hooks.mount(() => module.EnterpriseExchangeApprovalsPage()); const table = nodes(hooks.value).find(n => n.type === 'table');
  await hooks.act(() => table.props.columns.find(c => c.title === 'Actions').render(null, row).props.onAction());
  const child = nodes(hooks.value).find(n => typeof n.type === 'function' && n.props.row);
  hooks.unmount(); const mount = () => hooks.mount(() => child.type({ ...child.props, row })); mount();
  const confirm = () => nodes(hooks.value).find(n => n.props.label === 'Confirm this approved expense');
  await assert.rejects(async () => confirm().props.onAction()); assert.equal(writes.length, 0);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'textarea').props.onChange({ target: { value: 'I reviewed the approved expense' } }));
  await assert.rejects(async () => confirm().props.onAction()); assert.equal(writes.length, 0);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'checkbox').props.onChange({ target: { checked: true } }));
  await confirm().props.onAction(); assert.equal(writes.length, 1); assert.equal(writes[0].path, '/enterprise/exchange-approvals/expense-consent/expense-confirmation');
  assert.equal(writes[0].originalTarget, row.id); assert.equal(writes[0].input.confirm, true); assert.equal(writes[0].input.expectedRevision, 2); assert.equal(writes[0].input.inspectionSnapshot, undefined);
  row = { ...row, revision: 3, employeeConfirmation: { operationKey: 'confirm-key', scope: 'expense_only_not_inspection_or_execution' } }; hooks.unmount(); mount();
  assert.equal(confirm(), undefined); assert.ok(nodes(hooks.value).some(n => n.props.title === 'Expense confirmed by applicant; exchange not executed'));
});
check('Confirmation recovery with real workflow gate requires both original receipt and exact applicant consent key; never redispatches', async () => {
  const hooks = reactHost(), storage = new Map(), writes = []; let receipt = { state: 'not_recorded' };
  const path = '/enterprise/exchange-approvals/consent-1/expense-confirmation';
  const result = { approval: { id: 'consent-1', applicantCustomerId: 'p1', employeeConfirmation: { operationKey: 'original-confirm' } }, original: { state: 'not_confirmed', retryable: false } };
  const context = { identity: 'consent-recovery', tenantCode: 'merchant', selectedCorporateId: 'c1', signal: new AbortController().signal, session: { customer: { customerId: 'p1' }, workspace: { workspaceCode: 's1' } }, entry: { corporates: [] },
    read: async target => target.includes('/operations/') ? plain(receipt) : plain(result), write: async (...args) => { writes.push(args); throw new Error('no redispatch'); } };
  const storageKey = 'rental-os:enterprise-workflow:' + JSON.stringify(['exchange-approvals:mine', 'merchant', 'p1', 's1', 'c1']);
  storage.set(storageKey, JSON.stringify({ key: 'original-confirm', path, state: 'unknown', originalTarget: 'consent-1' }));
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const gate = load('apps/enterprise-portal/src/original-workflow-operation.ts', { react: hooks.runtime, '@rental-os/web-client': { customerSessionGeneration: () => 'consent-generation' }, './enterprise-session': { useEnterprise: () => context } },
    { localStorage, AbortSignal, navigator: { locks: { request: (_key, fn) => Promise.resolve().then(fn) } } });
  const Form = Object.assign('form', { useForm: () => [{ resetFields() {} }], Item: 'field' });
  const page = load('apps/enterprise-portal/src/ExchangeApprovalsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: ({ queryKey }) => queryKey[0] === 'enterprise-exchange-approvals' ? { data: [], isFetching: false, refetch: async () => ({}) } : {} },
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': gate });
  hooks.mount(() => page.EnterpriseExchangeApprovalsPage()); const recover = () => nodes(hooks.value).find(n => n.props.label === 'Read original exchange operation');
  await assert.rejects(recover().props.onAction(), /收据/u); assert.equal(storage.size, 1);
  receipt = { state: 'committed', result: { id: 'consent-1' } }; await assert.rejects(recover().props.onAction(), /确认/u); assert.equal(storage.size, 1);
  result.original = { state: 'observed', operationKey: 'wrong-key', retryable: false }; await assert.rejects(recover().props.onAction(), /核对/u); assert.equal(storage.size, 1);
  result.original.operationKey = 'original-confirm'; await recover().props.onAction(); hooks.flush(); assert.equal(storage.size, 0); assert.equal(writes.length, 0);
});

function exchangeProgressFixture() {
  const hooks = reactHost(), events = emitter(), calls = [], storage = new Map();
  const f = { hooks, events, calls, storage, storageMode: '', writes: [], receipt: { state: 'not_recorded' }, confirmation: undefined, writeHandler: undefined, tenant: 'merchant', workspace: 'w1', customer: 'p1', generation: 1, authenticated: true, bound: false,
    props: { orderId: 'o1', identity: 'order-o1', english: true }, handler: undefined,
    rows: [{ id: 'x1', orderId: 'o1', workspaceId: 'workspace-1', applicantCustomerId: 'p1', state: 'approved', revision: 2, reason: 'Original purpose', expiresAt: '2099-01-01T00:00:00Z',
      preview: { originalItemGroupName: 'Old item', replacementItemGroupName: 'New item', additionalAmount: 40, depositDelta: 10, preAuthDelta: 0, currency: 'CNY' } }] };
  const capture = () => {
    if (!f.authenticated) return null;
    const identity = JSON.stringify([f.tenant, f.customer, f.workspace, f.generation]);
    return { identity, operationScope: JSON.stringify([f.tenant, f.customer, f.workspace]), tenantCode: f.tenant, customerId: f.customer, workspaceCode: f.workspace, current: () => f.authenticated && identity === JSON.stringify([f.tenant, f.customer, f.workspace, f.generation]) };
  };
  const localStorage = { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key), setItem(key, value) { if (f.storageMode === 'throw') throw new Error('storage unavailable'); if (f.storageMode !== 'drop') storage.set(key, value); } };
  const sessionApi = { enterpriseOrderExchangeApprovals: async id => { calls.push(id); return f.handler ? f.handler(id) : plain(f.rows); },
    enterpriseOperation: async () => plain(f.receipt), enterpriseExchangeConfirmation: async () => plain(f.confirmation),
    confirmEnterpriseExchangeExpense: async (id, input) => { f.writes.push({ id, input: plain(input) }); if (f.writeHandler) return f.writeHandler(id, input); throw new Error('response lost'); } };
  const consent = load('apps/tenant-website/src/components/enterprise-exchange-confirmation.ts', { '../data/authClient': { sessionApi } },
    { localStorage, navigator: { locks: { request: (_key, fn) => Promise.resolve().then(fn) } }, crypto: { randomUUID: () => 'original-web-consent' } });
  const { enterpriseHref } = load('packages/web-client/src/enterprise-entry.ts', {});
  const page = load('apps/tenant-website/src/components/EnterpriseExchangeProgress.tsx', {
    react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, '@rental-os/shared': { formatRentalMoney: n => String(n) }, '@rental-os/web-client': { enterpriseHref },
    '../SiteContext': { useSite: () => ({ tenantCode: f.tenant, enterpriseDomainBound: f.bound }) },
    './enterprise-exchange-confirmation': consent,
    '../data/authClient': { captureEnterpriseHostSession: capture, subscribeCustomerSession: (_t, fn) => events.on(fn), sessionApi }
  });
  f.mount = () => hooks.mount(() => page.EnterpriseExchangeProgress(f.props)); f.mount();
  return f;
}
check('Website original-order exchange progress renders expense-only state and registered same-origin entry; wrong references and failed reads hide prior facts', async () => {
  const f = exchangeProgressFixture(); await f.hooks.settle();
  assert.deepEqual(f.calls, ['o1']); assert.ok(text(f.hooks.value).includes('Approved; applicant expense confirmation pending'));
  assert.ok(text(f.hooks.value).includes('do not reserve stock'));
  assert.equal(nodes(f.hooks.value).find(n => n.type === 'a').props.href, '/merchant/enterprise/exchange-approvals');
  f.rows[0].employeeConfirmation = { operationKey: 'consent-key', confirmedAt: '2026-11-03T00:00:00Z', scope: 'expense_only_not_inspection_or_execution' };
  const refresh = () => nodes(f.hooks.value).find(n => n.type === 'button' && text(n) === 'Read original exchange progress').props.onClick();
  await f.hooks.act(refresh); assert.ok(text(f.hooks.value).includes('Expense confirmed; exchange not executed'));
  f.handler = async () => { throw new Error('read unavailable'); }; await f.hooks.act(refresh);
  assert.equal(nodes(f.hooks.value).filter(n => n.type === 'article').length, 0); assert.ok(text(f.hooks.value).includes('read unavailable'));
  f.handler = async () => [{ ...f.rows[0], orderId: 'other-order' }]; await f.hooks.act(refresh);
  assert.equal(nodes(f.hooks.value).filter(n => n.type === 'article').length, 0); assert.ok(text(f.hooks.value).includes('references do not match'));
  f.handler = async () => []; await f.hooks.act(refresh); assert.equal(f.hooks.value, null);
  f.bound = true; f.handler = undefined; f.hooks.rerender(); await f.hooks.settle();
  assert.equal(nodes(f.hooks.value).find(n => n.type === 'a').props.href, '/enterprise/exchange-approvals');
});
check('Website exchange progress isolates logout, same-account login and late reads; it performs only original-order GETs', async () => {
  const f = exchangeProgressFixture(); await f.hooks.settle();
  const late = deferred(); f.handler = () => late.promise;
  await f.hooks.act(() => nodes(f.hooks.value).find(n => n.type === 'button' && text(n) === 'Read original exchange progress').props.onClick());
  f.generation++; f.authenticated = false; f.events.emit(); f.hooks.flush(); assert.equal(f.hooks.value, null);
  late.resolve(f.rows); await f.hooks.settle(); assert.equal(f.hooks.value, null);
  f.authenticated = true; f.handler = undefined; f.hooks.rerender(); await f.hooks.settle(); assert.equal(nodes(f.hooks.value).filter(n => n.type === 'article').length, 1);
  const priorRead = deferred(); f.handler = () => priorRead.promise;
  await f.hooks.act(() => nodes(f.hooks.value).find(n => n.type === 'button' && text(n) === 'Read original exchange progress').props.onClick());
  f.props = { ...f.props, orderId: 'o2', identity: 'order-o2' }; f.rows = [{ ...f.rows[0], orderId: 'o2', id: 'x2' }]; f.handler = undefined;
  f.hooks.rerender(); await f.hooks.settle(); priorRead.resolve([{ ...f.rows[0], orderId: 'o1', id: 'x1' }]); await f.hooks.settle();
  assert.equal(nodes(f.hooks.value).filter(n => n.type === 'article').length, 1); assert.ok(text(f.hooks.value).includes('Approved; applicant expense confirmation pending'));
  assert.ok(f.calls.every(id => ['o1', 'o2'].includes(id)));
});

function miniExchangeProgressFixture() {
  const events = emitter(), calls = [], storage = new Map(), f = { events, calls, storage, storageMode: '', confirm: true, keys: 0, version: 1, customer: 'p1', service: 's1', signedIn: true, handler: undefined,
    rows: [{ id: 'x1', orderId: 'o1', workspaceId: 'w1', applicantCustomerId: 'p1', revision: 2, state: 'approved', expiresAt: '2099-01-01T00:00:00Z', reason: 'Original purpose',
      preview: { originalItemGroupName: 'Old', replacementItemGroupName: 'New', additionalAmount: 40, depositDelta: 10, preAuthDelta: 0, currency: 'CNY' } }] };
  const session = { contextVersion: () => f.version, currentSession: () => f.signedIn ? { customer: { customerId: f.customer, customerType: 'personal' } } : undefined,
    currentServiceCode: () => f.service, isSignedIn: () => f.signedIn, sessionEvents: events };
  const wx = { stopPullDownRefresh() {}, getStorageSync: key => plain(storage.get(key)), removeStorageSync: key => storage.delete(key),
    setStorageSync(key, value) { if (f.storageMode === 'throw') throw new Error('storage unavailable'); if (f.storageMode !== 'drop') storage.set(key, plain(value)); },
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }), showModal: async () => ({ confirm: f.confirm }) };
  const keys = { newKey: () => `expense-${++f.keys}`, actionKey: forbidden('action key'), pendingActionKey: () => undefined, releaseActionKey: forbidden('release key') };
  const storageModule = load('apps/miniprogram/src/core/storage.ts', {}, { wx }); f.storageModule = storageModule;
  const enterprise = load('apps/miniprogram/src/api/enterprise.ts', { '../core/http': { request: async (url, options) => {
    calls.push({ url, options: plain(options) });
    if (f.handler) return f.handler(url, options);
    if (url.endsWith('/exchange-approvals')) return plain(f.rows);
    throw new Error('unexpected original read');
  } } });
  const consent = load('apps/miniprogram/src/core/enterprise-exchange-confirmation.ts', { '../api/enterprise': enterprise, '../config/public': { PUBLIC_CONFIG: { tenantCode: 'merchant' } }, './session': session, './keys': keys, './storage': storageModule }, { wx });
  const order = { id: 'o1', orderNo: 'Order 1', status: 'renting', currency: 'CNY', startAt: '2090-01-01T00:00:00Z', endAt: '2090-01-02T00:00:00Z', lines: [], allocations: [], chargeLines: [], finalPayableAmount: 100 };
  const mutations = { cancelOrder: forbidden('cancel'), respondToFee: forbidden('fee response'), previewCancellation: forbidden('cancellation preview') };
  const dependencies = { '../../core/theme-behavior': { themeBehavior: {} }, '../../api/enterprise': enterprise, '../../core/enterprise-exchange-confirmation': consent,
    '../../api/orders': { ...mutations, fetchOrder: async () => plain(order), fetchFunding: async () => undefined, fetchFulfillment: async () => undefined, listExtensions: async () => [], fetchFeeItems: async () => ({ items: [], pendingCount: 0 }) },
    '../../contracts/planned': { contractMissing: () => false }, '../../core/cart': { isDeliveryMode: () => false }, '../../core/catalogStore': { loadCatalog: async () => ({}) },
    '../../core/clock': { serverNow: () => 0 }, '../../core/errors': { describeError: e => ({ message: e.message }) }, '../../core/flow': { ensureServiceForOrder: async () => true },
    '../../core/http': { isApiError: () => false }, '../../core/keys': keys,
    '../../core/labels': { chargeLabel: v => v, extensionLabel: v => v, fulfillmentLabel: v => v }, '../../core/merchant': { cachedMerchant: () => undefined },
    '../../core/money': { formatMoney: (n, currency) => `${n} ${currency}` }, '../../core/page': { loadingState: () => ({ status: 'loading' }), readyState: () => ({ status: 'ready' }), blockedState: () => ({ status: 'blocked' }), errorState: () => ({ status: 'error' }), handleCommonViewAction: () => false },
    '../../core/status': { presentOrder: () => ({ actions: [], label: 'Renting' }) }, '../../core/session': session,
    '../../core/time': { formatBusinessDateTime: (v, zone) => `${v} ${zone}`, zoneLabel: v => v },
    '../../core/ui': { ROUTES: { order: 'order' }, buildUrl: () => 'order', requireSignIn: () => true, toast() {}, navigate: forbidden('navigation'), callPhone: forbidden('call') },
    '../../core/zones': { zoneOf: () => 'UTC', ensureCurrentZone: async () => undefined }, '../../components/ai-native/customer-order-facts': { customerOrderFacts: () => null } };
  let definition;
  load('apps/miniprogram/src/pages/order/index.ts', dependencies, { Page: value => { definition = value; }, wx });
  f.page = { ...definition, data: plain(definition.data), setData(patch) { Object.assign(this.data, plain(patch)); } };
  f.page.onLoad({ id: 'o1', service: 's1' }); f.page.setData({ order, view: { status: 'ready' }, timeZone: 'UTC' });
  f.runtime = { session, wx, keys, enterprise, order, dependencies };
  return f;
}
check('Mini original-order exchange progress uses its registered GET, preserves currency and expense-only state, and rejects bad references without writes', async () => {
  const f = miniExchangeProgressFixture(), p = f.page; await p.loadExchangeProgress();
  assert.equal(f.calls[0].url, '/enterprise/orders/o1/exchange-approvals'); assert.equal(p.data.exchangeRequests.length, 1);
  assert.equal(p.data.exchangeRequests[0].amount, '40 CNY'); assert.equal(p.data.exchangeRequests[0].stateLabel, '已批准，待本人确认费用');
  f.rows[0].employeeConfirmation = { confirmedAt: '2026-11-03T00:00:00Z', operationKey: 'expense-key', scope: 'expense_only_not_inspection_or_execution' }; await p.loadExchangeProgress();
  assert.equal(p.data.exchangeRequests[0].stateLabel, '本人已确认费用，换货未执行'); assert.ok(p.data.exchangeRequests[0].confirmedAt.endsWith('UTC'));
  f.handler = async () => [{ ...f.rows[0], orderId: 'foreign' }]; await p.loadExchangeProgress(); assert.equal(p.data.exchangeRequests.length, 0); assert.ok(p.data.exchangeLoadError.includes('不匹配'));
  f.handler = async () => { throw new Error('read unavailable'); }; await p.loadExchangeProgress(); assert.equal(p.data.exchangeRequests.length, 0); assert.equal(p.data.exchangeLoadError, 'read unavailable');
  f.handler = async () => []; await p.loadExchangeProgress(); assert.equal(p.data.exchangeRequests.length, 0); assert.equal(p.data.exchangeLoadError, '');
  const wxml = fs.readFileSync(path.join(root, 'apps/miniprogram/src/pages/order/index.wxml'), 'utf8');
  assert.ok(wxml.includes('bindtap="onReadExchangeProgress"')); assert.ok(wxml.includes('不确认商户检查')); assert.ok(wxml.includes('小程序不传登录凭据'));
});
check('Mini exchange progress loads with the real order page, hides on lifecycle/session change and discards late original reads', async () => {
  const f = miniExchangeProgressFixture(), p = f.page;
  await p.load(); for (let i = 0; i < 12; i++) await Promise.resolve(); assert.equal(p.data.exchangeRequests.length, 1);
  const late = deferred(); f.handler = () => late.promise; const reading = p.loadExchangeProgress(); p.onHide();
  assert.equal(p.data.exchangeRequests.length, 0); late.resolve(f.rows); await reading; assert.equal(p.data.exchangeRequests.length, 0);
  f.handler = undefined; p.onShow(); for (let i = 0; i < 24; i++) await Promise.resolve(); assert.equal(p.data.exchangeRequests.length, 1);
  const old = deferred(); f.handler = () => old.promise; const pending = p.loadExchangeProgress(); f.version++; f.signedIn = false; f.events.emit({ type: 'signed-out' });
  assert.equal(p.data.exchangeRequests.length, 0); old.resolve(f.rows); await pending; assert.equal(p.data.exchangeRequests.length, 0);
  f.signedIn = true; f.handler = undefined; p.onShow(); for (let i = 0; i < 24; i++) await Promise.resolve(); assert.equal(p.data.exchangeRequests.length, 1);
  const earlier = deferred(); f.handler = () => earlier.promise; const first = p.loadExchangeProgress(); f.handler = async () => [];
  await p.loadExchangeProgress(); earlier.resolve(f.rows); await first; assert.equal(p.data.exchangeRequests.length, 0); p.onUnload();
  assert.ok(f.calls.every(call => call.options?.method === undefined));
});

check('Mini expense consent requires row review and independent confirmation, persists only opaque references and never repeats an unknown dispatch', async () => {
  const f = miniExchangeProgressFixture(), p = f.page; await p.loadExchangeProgress();
  p.onOpenExchangeConsent({ currentTarget: { dataset: { id: 'x1' } } });
  await p.onConfirmExchangeExpense(); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 0);
  p.onExchangeConsentReason({ detail: { value: 'I reviewed this expense' } }); f.confirm = false;
  await p.onConfirmExchangeExpense(); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 0); assert.equal(f.storage.size, 0);
  f.confirm = true; f.handler = async (_url, options) => { if (options?.method === 'POST') throw new Error('response lost'); return plain(f.rows); };
  await p.onConfirmExchangeExpense(); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1); assert.equal(p.data.exchangePending, true);
  const stored = [...f.storage.values()][0]; assert.deepEqual(Object.keys(stored).sort(), ['approvalId', 'key', 'orderId', 'workspaceId']);
  const dispatch = f.calls.find(c => c.options?.method === 'POST'); assert.equal(dispatch.options.replayAfterRefresh, false);
  assert.equal(dispatch.options.data.expectedRevision, 2); assert.equal(dispatch.options.data.confirm, true); assert.equal(dispatch.options.data.inspectionSnapshot, undefined);
  await p.onConfirmExchangeExpense(); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1);
  f.handler = async url => url.includes('/operations/') ? { state: 'not_recorded' } : plain(f.rows);
  await p.onRecoverExchangeExpense(); assert.equal(f.storage.size, 1); assert.equal(p.data.exchangePending, true);
  const confirmation = { operationKey: stored.key, confirmedAt: '2026-11-03T00:00:00Z', scope: 'expense_only_not_inspection_or_execution' };
  const receipt = { state: 'committed', result: { id: 'x1', orderId: 'o1', workspaceId: 'w1', applicantCustomerId: 'p1', ...confirmation } };
  const result = { approval: { ...f.rows[0], employeeConfirmation: confirmation }, original: { state: 'observed', retryable: false, operationKey: 'wrong-key' } };
  f.handler = async url => url.includes('/operations/') ? plain(receipt) : url.endsWith('/expense-confirmation') ? plain(result) : plain(f.rows);
  await p.onRecoverExchangeExpense(); assert.equal(f.storage.size, 1);
  result.original.operationKey = stored.key; f.rows = [result.approval];
  await p.onRecoverExchangeExpense(); assert.equal(f.storage.size, 0); assert.equal(p.data.exchangePending, false);
  assert.equal(p.data.exchangeRequests[0].stateLabel, '本人已确认费用，换货未执行'); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1);
});
check('Mini expense consent fails closed on storage, survives sign-out and reload, and old-owner responses never erase retained references', async () => {
  for (const mode of ['throw', 'drop']) {
    const f = miniExchangeProgressFixture(), p = f.page; await p.loadExchangeProgress();
    p.onOpenExchangeConsent({ currentTarget: { dataset: { id: 'x1' } } }); p.onExchangeConsentReason({ detail: { value: 'Reviewed' } }); f.storageMode = mode;
    await p.onConfirmExchangeExpense(); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 0, mode); assert.equal(f.storage.size, 0);
  }
  const f = miniExchangeProgressFixture(), p = f.page; await p.loadExchangeProgress();
  p.onOpenExchangeConsent({ currentTarget: { dataset: { id: 'x1' } } }); p.onExchangeConsentReason({ detail: { value: 'Reviewed' } });
  const late = deferred(); f.handler = (_url, options) => options?.method === 'POST' ? late.promise : Promise.resolve(plain(f.rows));
  const dispatch = p.onConfirmExchangeExpense(); for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(f.storage.size, 1); f.version++; f.signedIn = false; f.events.emit({ type: 'signed-out' }); f.storageModule.clearPrivateStorage();
  assert.equal(f.storage.size, 1); late.resolve({}); await dispatch;
  assert.equal(p.data.exchangeRequests.length, 0); assert.equal(f.storage.size, 1); assert.equal(f.calls.filter(c => c.url.includes('/operations/')).length, 0);
  f.signedIn = true; f.handler = undefined; p.onShow(); for (let i = 0; i < 24; i++) await Promise.resolve();
  assert.equal(p.data.exchangePending, true); assert.equal(p.data.exchangeBlocked, true);
  const stored = [...f.storage.values()][0]; f.handler = async url => url.includes('/operations/') ? { state: 'not_recorded' } : plain(f.rows);
  await p.onRecoverExchangeExpense(); assert.equal(f.storage.size, 1); assert.equal([...f.storage.values()][0].key, stored.key);
  assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1); p.onUnload();
});

check('Website expense consent requires independent per-row review, preserves its original reference after ACK loss and only clears exact receipt evidence', async () => {
  const f = exchangeProgressFixture(); await f.hooks.settle();
  const button = label => nodes(f.hooks.value).find(n => n.type === 'button' && text(n) === label);
  await f.hooks.act(() => button('Review this approved expense').props.onClick());
  await f.hooks.act(() => button('Confirm this expense only').props.onClick()); assert.equal(f.writes.length, 0);
  await f.hooks.act(() => nodes(f.hooks.value).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed expense' } }));
  await f.hooks.act(() => button('Confirm this expense only').props.onClick()); assert.equal(f.writes.length, 0);
  await f.hooks.act(() => nodes(f.hooks.value).find(n => n.type === 'input').props.onChange({ target: { checked: true } }));
  await f.hooks.act(() => button('Confirm this expense only').props.onClick()); assert.equal(f.writes.length, 1); assert.equal(f.storage.size, 1);
  const ref = JSON.parse([...f.storage.values()][0]); assert.deepEqual(Object.keys(ref).sort(), ['approvalId', 'key', 'orderId', 'workspaceId']);
  assert.equal(f.writes[0].input.expectedRevision, 2); assert.equal(f.writes[0].input.inspectionSnapshot, undefined);
  await f.hooks.act(() => button('Read original expense consent').props.onClick()); assert.equal(f.storage.size, 1); assert.equal(f.writes.length, 1);
  const consent = { operationKey: ref.key, confirmedAt: '2026-11-03T00:00:00Z', scope: 'expense_only_not_inspection_or_execution' };
  f.receipt = { state: 'committed', result: { id: 'x1', orderId: 'o1', workspaceId: 'workspace-1', applicantCustomerId: 'p1', ...consent } };
  f.confirmation = { approval: { ...f.rows[0], employeeConfirmation: consent }, original: { state: 'observed', retryable: false, operationKey: 'wrong-key' } };
  await f.hooks.act(() => button('Read original expense consent').props.onClick()); assert.equal(f.storage.size, 1);
  f.confirmation.original.operationKey = ref.key; f.rows = [f.confirmation.approval];
  await f.hooks.act(() => button('Read original expense consent').props.onClick()); assert.equal(f.storage.size, 0); assert.equal(f.writes.length, 1);
  assert.ok(text(f.hooks.value).includes('Expense confirmed; exchange not executed')); assert.equal(button('Confirm this expense only'), undefined);
});
check('Website expense consent fails closed on durable-storage failures and isolates late writes across logout and reload', async () => {
  for (const mode of ['throw', 'drop']) {
    const f = exchangeProgressFixture(); await f.hooks.settle();
    const button = label => nodes(f.hooks.value).find(n => n.type === 'button' && text(n) === label);
    await f.hooks.act(() => button('Review this approved expense').props.onClick());
    await f.hooks.act(() => nodes(f.hooks.value).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed' } }));
    await f.hooks.act(() => nodes(f.hooks.value).find(n => n.type === 'input').props.onChange({ target: { checked: true } }));
    f.storageMode = mode; await f.hooks.act(() => button('Confirm this expense only').props.onClick()); assert.equal(f.writes.length, 0); assert.equal(f.storage.size, 0);
  }
  const f = exchangeProgressFixture(); await f.hooks.settle(); const button = label => nodes(f.hooks.value).find(n => n.type === 'button' && text(n) === label);
  await f.hooks.act(() => button('Review this approved expense').props.onClick());
  await f.hooks.act(() => nodes(f.hooks.value).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Reviewed' } }));
  await f.hooks.act(() => nodes(f.hooks.value).find(n => n.type === 'input').props.onChange({ target: { checked: true } }));
  const late = deferred(); f.writeHandler = () => late.promise; await f.hooks.act(() => button('Confirm this expense only').props.onClick());
  assert.equal(f.writes.length, 1); assert.equal(f.storage.size, 1);
  f.generation++; f.authenticated = false; f.events.emit(); f.hooks.flush(); late.resolve({}); await f.hooks.settle();
  assert.equal(f.hooks.value, null); assert.equal(f.storage.size, 1);
  f.hooks.unmount(); f.authenticated = true; f.mount(); await f.hooks.settle(); assert.ok(button('Read original expense consent'));
  await f.hooks.act(() => button('Read original expense consent').props.onClick()); assert.equal(f.storage.size, 1); assert.equal(f.writes.length, 1);
});

function webExchangeRequestFixture() {
  const hooks = reactHost(), events = emitter(), storage = new Map(), writes = [];
  const f = { hooks, events, storage, writes, generation: 1, authenticated: true, storageMode: '', handler: undefined, updatedAt: '2026-11-03T00:00:00Z',
    props: { orderId: 'o1', identity: 'own-o1', english: true, allowNewRequest: true }, original: { state: 'not_recorded', retryable: false }, receipt: { state: 'not_recorded' } };
  const capture = () => {
    if (!f.authenticated) return null; const generation = f.generation;
    return { customerId: 'p1', workspaceCode: 's1', operationScope: 'merchant-p1-s1', identity: `identity-${generation}`, current: () => f.authenticated && generation === f.generation };
  };
  const sessionApi = {
    enterpriseExchangeChoices: async (_id, query) => ({ orderId: 'o1', orderNo: 'Order 1', workspaceId: 'w1', applicantCustomerId: 'p1', expectedOrderUpdatedAt: '2026-11-03T00:00:00Z', reservation: 'not_reserved',
      ...query && { selectedAllocationId: query.allocationId, selectedReplacementItemGroupId: query.replacementItemGroupId },
      lines: [{ orderLineId: 'line1', allocationId: 'a1', itemGroupName: 'Original', quantity: 1 }], replacements: [{ itemGroupId: 'new', name: 'New', inventoryMode: 'serialized', pricingGroups: [] }], assets: [{ assetId: 'asset1', assetNo: 'Asset 1' }] }),
    originalExchangeOrder: async () => ({ id: 'o1', updatedAt: f.updatedAt }),
    requestEnterpriseExchangeApproval: async input => { writes.push({ kind: 'request', input: plain(input) }); if (f.handler) return f.handler('request', input); throw new Error('ACK lost'); },
    closeEnterpriseExchangeRequest: async (_id, _key, input) => { writes.push({ kind: 'close', input: plain(input) }); if (f.handler) return f.handler('close', input); throw new Error('close ACK lost'); },
    enterpriseExchangeRequestOriginal: async () => plain(f.original), enterpriseOperation: async () => plain(f.receipt)
  };
  let sequence = 0; const localStorage = { getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key), setItem(key, value) { if (f.storageMode === 'throw') throw new Error('storage full'); if (f.storageMode !== 'drop') storage.set(key, value); } };
  const helper = load('apps/tenant-website/src/components/enterprise-exchange-request.ts', { '../data/authClient': { sessionApi } },
    { localStorage, navigator: { locks: { request: (_key, fn) => Promise.resolve().then(fn) } }, crypto: { randomUUID: () => `original-key-${++sequence}` } });
  const page = load('apps/tenant-website/src/components/EnterpriseExchangeRequest.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '../data/authClient': { captureEnterpriseHostSession: capture, sessionApi, subscribeCustomerSession: (_t, fn) => events.on(fn) }, './enterprise-exchange-request': helper });
  f.mount = () => hooks.mount(() => page.EnterpriseExchangeRequest(f.props)); f.mount();
  f.button = label => nodes(hooks.value).find(n => n.type === 'button' && text(n) === label);
  f.select = async (index, value) => hooks.act(() => nodes(hooks.value).filter(n => n.type === 'select')[index].props.onChange({ target: { value } }));
  f.choose = async () => { await hooks.act(() => f.button('Read exchange choices').props.onClick()); await f.select(0, 'a1'); await f.select(1, 'new'); await f.select(2, 'asset1'); await hooks.act(() => nodes(hooks.value).find(n => n.type === 'textarea').props.onChange({ target: { value: 'Original purpose' } })); };
  return f;
}
check('Website exchange request selects original whole-line candidates, refuses stale order and retains exact unknown key through permanent closure', async () => {
  const f = webExchangeRequestFixture(); await f.choose(); f.updatedAt = 'changed';
  await f.hooks.act(() => f.button('Request this exchange expense approval').props.onClick()); assert.equal(f.writes.length, 0); assert.equal(f.storage.size, 0);
  f.updatedAt = '2026-11-03T00:00:00Z'; await f.hooks.act(() => f.button('Read exchange choices').props.onClick()); await f.select(2, 'asset1');
  await f.hooks.act(() => f.button('Request this exchange expense approval').props.onClick()); assert.equal(f.writes.length, 1); assert.equal(f.storage.size, 1);
  const original = JSON.parse([...f.storage.values()][0]); assert.deepEqual(Object.keys(original).sort(), ['key', 'orderId']);
  assert.equal(f.writes[0].input.exchange.orderLineId, 'line1'); assert.equal(f.writes[0].input.exchange.replacementAssetId, 'asset1'); assert.equal(f.writes[0].input.inspectionSnapshot, undefined);
  await f.hooks.act(() => f.button('Read original exchange request').props.onClick()); assert.equal(f.storage.size, 1); assert.equal(f.writes.length, 1);
  await f.hooks.act(() => f.button('Request original-key closure').props.onClick()); assert.equal(f.writes.length, 1);
  await f.hooks.act(() => nodes(f.hooks.value).filter(n => n.type === 'textarea').at(-1).props.onChange({ target: { value: 'End only original request' } }));
  await f.hooks.act(() => nodes(f.hooks.value).find(n => n.type === 'input').props.onChange({ target: { checked: true } }));
  await f.hooks.act(() => f.button('Request original-key closure').props.onClick()); assert.equal(f.writes.length, 2); assert.equal(f.button('Request original-key closure'), undefined);
  const closing = JSON.parse([...f.storage.values()][0]); assert.notEqual(closing.closureKey, closing.key);
  f.props.allowNewRequest = false; f.hooks.unmount(); f.mount(); await f.hooks.settle(); assert.ok(f.button('Read original exchange request'));
  f.original = { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: 's1', applicantCustomerId: 'p1', closedOperationKey: closing.key, retryable: false };
  f.receipt = { state: 'committed', result: { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: 's1', applicantCustomerId: 'p1', originalOperationKey: closing.key, closureOperationKey: 'wrong', retryable: false } };
  await f.hooks.act(() => f.button('Read original exchange request').props.onClick()); assert.equal(f.storage.size, 1);
  f.receipt.result.closureOperationKey = closing.closureKey;
  await f.hooks.act(() => f.button('Read original exchange request').props.onClick()); assert.equal(f.storage.size, 0); assert.equal(f.writes.length, 2);
});
check('Website exchange request fails closed before dispatch on storage and isolates late application replies after logout', async () => {
  for (const mode of ['throw', 'drop']) {
    const f = webExchangeRequestFixture(); await f.choose(); f.storageMode = mode;
    await f.hooks.act(() => f.button('Request this exchange expense approval').props.onClick()); assert.equal(f.writes.length, 0); assert.equal(f.storage.size, 0);
  }
  const f = webExchangeRequestFixture(); await f.choose(); const late = deferred(); f.handler = () => late.promise;
  await f.hooks.act(() => f.button('Request this exchange expense approval').props.onClick()); assert.equal(f.storage.size, 1);
  f.authenticated = false; f.generation++; f.events.emit(); f.hooks.flush(); late.resolve({}); await f.hooks.settle(); assert.equal(f.hooks.value, null); assert.equal(f.storage.size, 1);
  f.authenticated = true; f.hooks.unmount(); f.mount(); await f.hooks.settle(); assert.ok(f.button('Read original exchange request'));
  f.original = { state: 'observed', retryable: false, approval: { id: 'x1', orderId: 'wrong-order', applicantCustomerId: 'p1', workspaceId: 'w1', state: 'pending' } };
  await f.hooks.act(() => f.button('Read original exchange request').props.onClick()); assert.equal(f.storage.size, 1);
  f.original.approval.orderId = 'o1'; await f.hooks.act(() => f.button('Read original exchange request').props.onClick()); assert.equal(f.storage.size, 0); assert.equal(f.writes.length, 1);
});

function miniExchangeRequestFixture() {
  const f = miniExchangeProgressFixture(), { session, wx, keys, enterprise, order, dependencies } = f.runtime;
  f.updatedAt = '2026-11-03T00:00:00Z'; f.status = 'renting'; f.original = { state: 'not_recorded', retryable: false }; f.receipt = { state: 'not_recorded' };
  f.requestHandler = undefined; f.choiceHandler = undefined;
  f.handler = async (url, options) => {
    if (options?.method === 'POST') { if (f.requestHandler) return f.requestHandler(url, options); throw new Error('ACK lost'); }
    if (url.includes('/exchange-choices')) {
      if (f.choiceHandler) return f.choiceHandler(url);
      const query = new URLSearchParams(url.split('?')[1]);
      return { orderId: 'o1', orderNo: 'Order 1', workspaceId: 'w1', applicantCustomerId: f.customer, expectedOrderUpdatedAt: '2026-11-03T00:00:00Z', reservation: 'not_reserved',
        selectedAllocationId: query.get('allocationId') ?? undefined, selectedReplacementItemGroupId: query.get('replacementItemGroupId') ?? undefined,
        lines: [{ orderLineId: 'line1', allocationId: 'a1', itemGroupId: 'old', itemGroupName: 'Original', quantity: 1 }],
        replacements: [{ itemGroupId: 'new', name: 'New', inventoryMode: 'serialized', pricingGroups: [{ id: 'price1', name: 'Normal' }] }, { itemGroupId: 'bulk', name: 'Bulk', inventoryMode: 'quantity', pricingGroups: [] }],
        assets: [{ assetId: 'asset1', assetNo: 'Asset 1' }] };
    }
    if (url.includes('/exchange-request-operations/')) return plain(f.original);
    if (url.includes('/operations/')) return plain(f.receipt);
    throw new Error(url);
  };
  const orders = { fetchOrder: async () => ({ ...plain(order), updatedAt: f.updatedAt, status: f.status }) };
  const helper = load('apps/miniprogram/src/core/enterprise-exchange-request.ts', { '../api/enterprise': enterprise, '../api/orders': orders,
    '../config/public': { PUBLIC_CONFIG: { tenantCode: 'merchant' } }, './session': session, './keys': keys, './storage': f.storageModule }, { wx });
  const ui = load('apps/miniprogram/src/core/ui.ts', { './session': session }, { wx });
  let definition;
  load('apps/miniprogram/src/pages/exchange/index.ts', { '../../api/enterprise': enterprise, '../../api/orders': orders, '../../core/enterprise-exchange-request': helper,
    '../../core/theme-behavior': dependencies['../../core/theme-behavior'], '../../core/errors': dependencies['../../core/errors'], '../../core/flow': dependencies['../../core/flow'],
    '../../core/session': session, '../../core/ui': ui }, { wx, Page: value => { definition = value; } });
  f.mount = async () => {
    f.page = { ...definition, data: plain(definition.data), setData(patch) { Object.assign(this.data, plain(patch)); } };
    f.page.onLoad({ id: 'o1', service: 's1' }); f.page.onShow();
    for (let i = 0; i < 24; i++) await Promise.resolve();
  };
  f.choose = async () => {
    const p = f.page; await p.readChoices(); await p.readChoices('a1', ''); await p.readChoices('a1', 'new');
    p.onAsset({ detail: { value: '0' } }); p.onPricing({ detail: { value: '1' } }); p.onPrice({ detail: { value: '1' } }); p.onReason({ detail: { value: 'Original purpose' } });
  };
  f.ui = ui; return f;
}
check('Mini exchange request uses registered whole-line choices and original revision, keeps unknown K and independently seals it with exact C evidence', async () => {
  const f = miniExchangeRequestFixture(); await f.mount(); await f.choose(); const p = f.page;
  assert.equal(f.ui.safeRoute('/pages/exchange/index?id=o1&token=private'), '/pages/exchange/index?id=o1');
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'apps/miniprogram/src/app.json'), 'utf8')).pages.includes('pages/exchange/index'));
  f.updatedAt = 'changed'; await p.onRequest(); assert.equal(f.storage.size, 0); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 0);
  f.updatedAt = '2026-11-03T00:00:00Z'; await f.choose(); await p.onRequest();
  const stored = [...f.storage.values()][0], post = f.calls.find(c => c.options?.method === 'POST');
  assert.deepEqual(Object.keys(stored).sort(), ['key', 'orderId']); assert.equal(post.options.replayAfterRefresh, false); assert.equal(post.options.data.expectedOrderUpdatedAt, f.updatedAt);
  assert.deepEqual(post.options.data.exchange, { orderLineId: 'line1', allocationId: 'a1', replacementItemGroupId: 'new', replacementAssetId: 'asset1', replacementPricingGroupId: 'price1', priceBasis: 'replacement_current_price' });
  assert.equal(post.options.data.inspectionSnapshot, undefined); assert.equal(p.data.pending, true);
  await p.onRequest(); await p.onRecover(); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1); assert.equal(f.storage.size, 1);
  p.onClosureReason({ detail: { value: 'End only original request' } }); f.confirm = false; await p.onCloseRequest(); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1);
  f.confirm = true; await p.onCloseRequest(); const closing = [...f.storage.values()][0]; assert.notEqual(closing.closureKey, closing.key);
  assert.equal(p.data.closing, true); await p.onCloseRequest(); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 2);
  f.status = 'returned'; p.onHide(); await f.mount(); assert.equal(f.page.data.pending, true); assert.equal(f.page.data.order.status, 'returned');
  f.original = { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: 's1', applicantCustomerId: 'p1', closedOperationKey: closing.key, retryable: false };
  f.receipt = { state: 'committed', result: { state: 'closed', orderId: 'o1', workspaceId: 'w1', workspaceCode: 's1', applicantCustomerId: 'p1', originalOperationKey: closing.key, closureOperationKey: 'wrong', retryable: false } };
  await f.page.onRecover(); assert.equal(f.storage.size, 1); f.receipt.result.closureOperationKey = closing.closureKey; await f.page.onRecover();
  assert.equal(f.storage.size, 0); assert.equal(f.page.data.pending, false); assert.ok(f.page.data.notice.includes('永久封闭')); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 2);
  const wxml = fs.readFileSync(path.join(root, 'apps/miniprogram/src/pages/exchange/index.wxml'), 'utf8');
  assert.ok(wxml.includes('bindtap="onRecover"')); assert.ok(wxml.includes('bindtap="onCloseRequest"')); assert.ok(wxml.includes('不执行换货'));
});
check('Mini exchange request clears downstream choices, isolates late replies and keeps opaque originals across logout without redispatch', async () => {
  for (const mode of ['throw', 'drop']) {
    const f = miniExchangeRequestFixture(); await f.mount(); await f.choose(); f.storageMode = mode; await f.page.onRequest();
    assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 0, mode); assert.equal(f.storage.size, 0);
  }
  const f = miniExchangeRequestFixture(); await f.mount(); await f.choose(); const p = f.page;
  await p.readChoices('a1', 'bulk'); assert.equal(p.data.assetId, ''); assert.equal(p.data.pricingId, ''); assert.equal(p.data.canRequest, true);
  await p.readChoices('a1', 'new'); assert.equal(p.data.canRequest, false); await p.onRequest(); assert.equal(f.storage.size, 0);
  const oldChoices = deferred(); f.choiceHandler = () => oldChoices.promise; const reading = p.readChoices(); p.onHide(); oldChoices.resolve({ orderId: 'foreign' }); await reading;
  assert.equal(p.data.choices, null); assert.equal(p.data.order, null);
  f.choiceHandler = async () => ({ orderId: 'foreign' }); await f.mount(); await f.page.readChoices();
  assert.equal(f.page.data.choices, null); assert.equal(f.page.data.canRequest, false); assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 0);
  f.page.onHide(); f.choiceHandler = undefined; await f.mount(); await f.choose(); const late = deferred(); f.requestHandler = () => late.promise;
  const dispatch = f.page.onRequest(); for (let i = 0; i < 10; i++) await Promise.resolve(); assert.equal(f.storage.size, 1);
  f.version++; f.signedIn = false; f.events.emit({ type: 'signed-out' }); f.storageModule.clearPrivateStorage(); late.resolve({}); await dispatch;
  assert.equal(f.storage.size, 1); assert.equal(f.page.data.order, null); assert.equal(f.calls.filter(c => c.url.includes('/exchange-request-operations/')).length, 0);
  f.signedIn = true; await f.mount(); assert.equal(f.page.data.pending, true);
  f.original = { state: 'observed', retryable: false, approval: { id: 'x1', orderId: 'foreign', workspaceId: 'w1', applicantCustomerId: 'p1', state: 'pending' } };
  await f.page.onRecover(); assert.equal(f.storage.size, 1); f.original.approval.orderId = 'o1'; await f.page.onRecover(); assert.equal(f.storage.size, 0);
  assert.equal(f.calls.filter(c => c.options?.method === 'POST').length, 1);
  for (const code of ['enterprise_revision_conflict', 'unknown']) {
    const g = miniExchangeRequestFixture(); await g.mount(); await g.choose();
    g.requestHandler = async () => { throw Object.assign(new Error('refused'), { status: 409, body: { code } }); };
    await g.page.onRequest(); assert.equal(g.storage.size, code === 'enterprise_revision_conflict' ? 0 : 1);
    assert.equal(g.calls.filter(c => c.options?.method === 'POST').length, 1);
  }
  const g = miniExchangeRequestFixture(); await g.mount(); await g.choose(); await g.page.onRequest();
  g.page.onClosureReason({ detail: { value: 'Independent closure' } }); g.storageMode = 'throw'; await g.page.onCloseRequest();
  assert.equal(g.calls.filter(c => c.options?.method === 'POST').length, 1); assert.equal([...g.storage.values()][0].closureKey, undefined);
  g.storageMode = ''; const key = [...g.storage.keys()][0]; g.storage.set(key, { ...g.storage.get(key), reason: 'not an opaque reference' });
  await g.page.onRecover(); assert.equal(g.storage.size, 1); assert.equal(g.calls.filter(c => c.url.includes('/exchange-request-operations/')).length, 0);
});

function adminInspectionFixture() {
  const hooks = reactHost(), storage = new Map(), calls = [], events = emitter();
  const f = { hooks, storage, calls, events, epoch: 1, storageMode: '', viewKey: 'v1', original: { state: 'not_recorded', retryable: false }, handler: undefined,
    order: { id: 'o1', updatedAt: '2026-11-04T00:00:00Z', status: 'renting', fulfillmentMode: 'pickup', lines: [{ id: 'line', itemGroupId: 'old', itemGroupName: 'Original', inventoryMode: 'serialized', quantity: 1 }],
      allocations: [{ id: 'allocation', orderLineId: 'line', status: 'picked_up', assetNo: 'OLD', quantity: 1 }] },
    auth: { sessionVerified: true, token: 'synthetic-token', tenant: { tenantId: 't1' }, currentWorkspaceId: 'w1', user: { id: 'operator', tenantId: 't1', permissions: ['rental-os:order:operate'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }, hasPermission: () => true } };
  const useAuthStore = () => f.auth; useAuthStore.getState = () => f.auth; useAuthStore.subscribe = fn => events.on(fn);
  const localStorage = { getItem: key => { if (f.storageMode === 'throw') throw new Error('storage unavailable'); return storage.get(key) ?? null; },
    setItem: (key, value) => { if (f.storageMode === 'throw') throw new Error('storage unavailable'); if (f.storageMode !== 'drop') storage.set(key, value); }, removeItem: key => storage.delete(key) };
  const locks = new Map(), navigator = { locks: { request: (key, fn) => { const pending = (locks.get(key) ?? Promise.resolve()).then(fn); locks.set(key, pending.catch(() => {})); return pending; } } };
  const query = { currentSessionEpoch: () => f.epoch, currentSessionSignal: () => new AbortController().signal };
  const transport = { http: { request: async config => {
    calls.push(plain({ ...config, signal: undefined }));
    const result = f.handler ? await f.handler(config) : config.url.endsWith('/requirements') ? plain(f.requirements) : config.method === 'get' ? plain(f.original) : (() => { throw new Error('ACK lost'); })();
    return { data: { data: result } };
  } } };
  const original = load('apps/admin/src/features/membership/original-enterprise-operation.ts', { react: hooks.runtime, '@/features/auth/authStore': { useAuthStore }, '@/app/queryClient': query, '@/api/http': transport }, { localStorage, navigator, AbortController, AbortSignal });
  const dependencies = { react: hooks.runtime, '@/api/http': transport, '@/features/auth/authStore': { useAuthStore }, '@/app/queryClient': query,
    '../membership/original-enterprise-operation': original };
  f.createHelper = () => load('apps/admin/src/features/rental-core/original-exchange-inspection.ts', dependencies, { localStorage, navigator, AbortController, AbortSignal, crypto: { randomUUID: () => crypto.randomUUID() } });
  f.helper = f.createHelper();
  const exchange = { orderLineId: 'line', allocationId: 'allocation', replacementItemGroupId: 'new', replacementAssetId: 'asset', priceBasis: 'original_order_price', originalDisposition: 'return_to_warehouse' };
  f.requirements = { orderId: 'o1', workspaceId: 'w1', expectedOrderUpdatedAt: f.order.updatedAt, exchange, requirementsHash: 'a'.repeat(64), media: 'unavailable', reservation: 'not_reserved', executionBasis: {},
    templates: [{ side: 'original_return', template: { id: 'old-template', name: 'Original return', version: 'v1', fields: [{ code: 'ok', label: 'Condition', type: 'boolean', required: true }] } },
      { side: 'replacement_pickup', template: { id: 'new-template', name: 'Replacement pickup', version: 'v1', fields: [{ code: 'reading', label: 'Reading', type: 'number', required: true, usageMetric: true }] } }] };
  f.input = { expectedRevision: 0, expectedOrderUpdatedAt: f.order.updatedAt, exchange, reason: 'Private inspection facts', requirementsHash: f.requirements.requirementsHash,
    inspections: f.requirements.templates.map(row => ({ side: row.side, templateId: row.template.id, templateVersion: row.template.version, results: { ok: false } })) };
  f.record = key => ({ ...plain(f.requirements), id: 'prepared-1', actorUserId: 'operator', operationKey: key, requestHash: 'b'.repeat(64), revision: 1, state: 'prepared',
    reason: 'Private inspection facts', createdAt: '2026-11-04T00:00:00Z', inspections: plain(f.input.inspections), exceptions: [], customerConsent: 'not_connected', execution: 'not_connected' });
  f.mountHelper = () => hooks.mount(() => f.helper.useOriginalExchangeInspection('o1', 'operation-token-double', f.viewKey));
  const form = Object.assign('form', {});
  const Form = { Item: 'field', useForm: () => [{}] };
  const ui = { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, Input: Object.assign('input', { TextArea: 'textarea' }), ListSection: 'section', SaveButton: 'save', Select: 'select' };
  const rentalCoreApi = { itemGroups: async () => [], pricingGroups: async () => [], allocationCandidates: async () => {} };
  const data = { groups: [{ id: 'new', name: 'New', status: 'enabled', inventoryMode: 'serialized' }], pricing: [], candidates: { reservations: [{ orderLineId: 'line', candidates: [{ assetId: 'asset', assetNo: 'NEW', available: true }] }] } };
  const page = load('apps/admin/src/features/rental-core/ExchangeInspectionPreparationPanel.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, antd: { InputNumber: 'number' },
    '@tanstack/react-query': { useQuery: options => ({ data: options.queryKey[0].includes('groups') ? data.groups : options.queryKey[0].includes('pricing') ? data.pricing : data.candidates, isFetching: false }) },
    '@/components/ui': ui, '@/api/rentalCore': { rentalCoreApi }, '@/app/locale': { useLocale: () => ({ t: value => value }) }, './original-exchange-inspection': f.helper,
    './ExchangeInspectionMediaPanel': { ExchangeInspectionMediaPanel: 'media-panel' }, './OrderDetail.module.css': { default: {} } });
  f.mediaDependencies = dependencies; f.mediaGlobals = { localStorage, navigator, AbortController, AbortSignal, URL, TextEncoder,
    crypto: { randomUUID: () => crypto.randomUUID(), subtle: crypto.webcrypto.subtle } }; f.ui = ui;
  f.pageModule = page; f.mountPanel = () => hooks.mount(() => page.ExchangeInspectionPreparationPanel({ order: f.order, operationToken: 'operation-token-double' }));
  f.action = label => nodes(hooks.value).find(node => node.type === 'action' && node.props.label === label);
  f.select = async (index, value) => hooks.act(() => nodes(hooks.value).filter(node => node.type === 'select')[index].props.onChange(value));
  f.choose = async () => { await hooks.act(() => nodes(hooks.value).find(node => node.type === 'button' && text(node) === '填写换货检查准备').props.onClick()); await f.select(0, 'allocation'); await f.select(1, 'new'); await f.select(2, 'asset'); };
  return f;
}
check('Merchant inspection original uses its own registered order/actor key, no 401 write replay, and missing or mismatched evidence never clears pending', async () => {
  const f = adminInspectionFixture(); f.mountHelper(); f.storageMode = 'throw'; await assert.rejects(f.hooks.value.run(f.input)); assert.equal(f.calls.length, 0);
  f.storageMode = 'drop'; await assert.rejects(f.hooks.value.run(f.input)); assert.equal(f.calls.length, 0); f.storageMode = '';
  await assert.rejects(f.hooks.value.run(f.input)); f.hooks.flush(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0]._authRetry, true); assert.equal(f.calls[0].headers['X-Operation-Token'], 'operation-token-double');
  const raw = [...f.storage.values()][0], reference = JSON.parse(raw); assert.deepEqual(Object.keys(reference).sort(), ['key', 'orderId', 'requirementsHash']); assert.equal(raw.includes('Private'), false); assert.equal(raw.includes('token'), false);
  await assert.rejects(f.hooks.value.run(f.input)); await assert.rejects(f.hooks.value.recover()); assert.equal(f.storage.size, 1);
  f.original = { state: 'observed', retryable: false, preparation: f.record(reference.key) }; f.original.preparation.actorUserId = 'another'; await assert.rejects(f.hooks.value.recover()); assert.equal(f.storage.size, 1);
  f.original.preparation.actorUserId = 'operator'; f.original.preparation.requirementsHash = 'c'.repeat(64); await assert.rejects(f.hooks.value.recover()); assert.equal(f.storage.size, 1);
  f.original.preparation.requirementsHash = reference.requirementsHash; const result = await f.hooks.value.recover(); assert.equal(result.id, 'prepared-1'); assert.equal(f.storage.size, 0);
  assert.equal(f.calls.filter(call => call.url.endsWith('/preparations')).length, 1);
  f.hooks.unmount(); const a = f.createHelper(), b = f.createHelper(); f.hooks.mount(() => [a.useOriginalExchangeInspection('o1'), b.useOriginalExchangeInspection('o1')]);
  await Promise.allSettled(f.hooks.value.map(helper => helper.run(f.input))); assert.equal(f.calls.filter(call => call.url.endsWith('/preparations')).length, 2); assert.equal(f.storage.size, 1);
});
check('Merchant inspection page binds typed template facts, blocks stale/foreign requirements, and isolates logout or revision-late writes without redispatch', async () => {
  const f = adminInspectionFixture(); f.mountPanel(); await f.choose(); await f.action('读取本次检查要求').props.onAction(); f.hooks.flush();
  const editor = nodes(f.hooks.value).find(node => node.type === f.pageModule.InspectionPreparationEditor); assert.ok(editor);
  const save = editor.props.onSave; f.hooks.unmount(); f.hooks.mount(() => f.pageModule.InspectionPreparationEditor({ ...editor.props, onSave: async input => { f.editorInput = plain(input); } }));
  await nodes(f.hooks.value).find(node => node.type === 'save').props.onSave({ inspections: [{ results: { ok: false } }, { results: { reading: 0 } }], reason: 'Reviewed facts' });
  assert.equal(f.editorInput.inspections[0].results.ok, false); assert.equal(f.editorInput.inspections[1].results.reading, 0); assert.equal(f.editorInput.customerConfirmed, undefined); assert.equal(f.editorInput.inspectionSnapshot, undefined);
  f.hooks.unmount(); f.mountPanel(); await f.choose(); f.requirements.workspaceId = 'foreign'; await assert.rejects(f.action('读取本次检查要求').props.onAction()); f.hooks.flush(); assert.equal(nodes(f.hooks.value).some(node => node.type === f.pageModule.InspectionPreparationEditor), false); assert.equal(f.storage.size, 0);
  f.requirements.workspaceId = 'w1'; await f.action('读取本次检查要求').props.onAction(); f.hooks.flush(); const currentEditor = nodes(f.hooks.value).find(node => node.type === f.pageModule.InspectionPreparationEditor);
  const late = deferred(); f.handler = config => config.url.endsWith('/preparations') ? late.promise : plain(f.original);
  const dispatch = currentEditor.props.onSave(f.input); await f.hooks.settle(); assert.equal(f.storage.size, 1);
  f.order = { ...f.order, updatedAt: 'changed' }; f.hooks.rerender(); late.resolve(f.record(JSON.parse([...f.storage.values()][0]).key)); await assert.rejects(dispatch);
  assert.equal(f.storage.size, 1); assert.equal(f.calls.some(call => call.method === 'get'), false); assert.ok(f.action('核对原检查准备结果'));
  const stored = JSON.parse([...f.storage.values()][0]); f.epoch++; f.auth.sessionVerified = false; f.auth.token = undefined; f.events.emit(); f.hooks.rerender(); assert.equal(f.action('核对原检查准备结果'), undefined);
  f.auth.sessionVerified = true; f.auth.token = 'synthetic-new-login'; f.handler = undefined; f.hooks.unmount(); f.mountPanel(); assert.ok(f.action('核对原检查准备结果'));
  f.original = { state: 'observed', retryable: false, preparation: f.record(stored.key) }; await f.action('核对原检查准备结果').props.onAction(); f.hooks.flush(); assert.equal(f.storage.size, 0);
  assert.equal(f.calls.filter(call => call.url.endsWith('/preparations')).length, 1); assert.ok(text(f.hooks.value).includes('未执行换货'));
});

function adminImageFixture() {
  const f = adminInspectionFixture(); f.puts = []; f.sources = new Map();
  f.file = { name: 'Private image.png', type: 'image/png', size: 123 };
  f.mediaRequirements = { ...plain(f.requirements), media: 'dedicated_source_only', templates: f.requirements.templates.map(row => ({ ...plain(row), template: { ...plain(row.template), fields: [{ code: 'photo', label: 'Photo', type: 'photo', required: true }, { code: 'other', label: 'Other photo', type: 'photo' }] } })) };
  f.body = { expectedOrderUpdatedAt: f.order.updatedAt, exchange: plain(f.requirements.exchange), requirementsHash: f.requirements.requirementsHash,
    side: 'original_return', templateId: 'old-template', templateVersion: 'v1', fieldCode: 'photo', fileName: f.file.name, mimeType: f.file.type, sizeBytes: f.file.size };
  f.ticket = source => ({ source, uploadUrl: `https://images.example.com/evidence/object?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=fixture%2F20261104%2Fregion%2Fs3%2Faws4_request&X-Amz-Date=20261104T010000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=${'c'.repeat(64)}`, uploadHeaders: { 'Content-Type': source.mimeType } });
  f.finish = source => ({ ...plain(source), state: 'completed', completion: { contentHash: 'd'.repeat(64), sizeBytes: source.sizeBytes, mimeType: source.mimeType, width: 10, height: 20, completedAt: '2026-11-04T02:00:00Z' } });
  f.handler = async config => {
    if (config.url.endsWith('/requirements')) return plain(f.mediaRequirements);
    if (config.url.endsWith('/uploads')) {
      assert.equal(f.reference(config.data.operationKey).phase, 'create_attempted', 'create dispatch follows durable seal');
      const source = { ...plain(config.data), id: 'source-' + f.sources.size, orderId: 'o1', workspaceId: 'w1', actorUserId: 'operator', requestHash: 'b'.repeat(64),
        sessionId: 'session-' + f.sources.size, fileAssetId: 'file-' + f.sources.size, createdAt: '2026-11-04T01:00:00Z', expiresAt: '2099-11-04T02:00:00Z', state: 'pending_upload', preparationUse: 'not_connected', retryable: false };
      f.sources.set(source.operationKey, source); if (f.createHook) return f.createHook(source); return f.ticket(source);
    }
    const key = config.url.split('/operations/')[1]?.split('/')[0], source = f.sources.get(key);
    if (config.url.endsWith('/complete')) { assert.equal(f.reference(key).phase, 'complete_attempted', 'complete dispatch follows durable seal'); if (f.completeHook) return f.completeHook(source); const value = f.finish(source); f.sources.set(key, value); return { state: 'observed', source: value, retryable: false }; }
    if (f.readHook) return f.readHook(source);
    return source ? { state: 'observed', source: plain(source), retryable: false } : { state: 'not_recorded', retryable: false };
  };
  f.mediaGlobals.fetch = async (url, config) => { assert.ok(JSON.parse([...f.storage.values()][0]).some(row => row.phase === 'put_attempted'), 'PUT dispatch follows durable seal'); f.puts.push({ url, ...config }); return f.putHook ? f.putHook() : { ok: true }; };
  f.createMedia = () => load('apps/admin/src/features/rental-core/original-exchange-inspection-media.ts', f.mediaDependencies, f.mediaGlobals);
  f.media = f.createMedia(); f.mountMedia = () => f.hooks.mount(() => f.media.useOriginalExchangeInspectionMedia('o1', 'operation-token-double', f.viewKey));
  f.mediaPage = load('apps/admin/src/features/rental-core/ExchangeInspectionMediaPanel.tsx', { react: f.hooks.runtime, 'react/jsx-runtime': f.hooks.jsx,
    '@/components/ui': { ...f.ui, FileUpload: 'files' }, '@/components/workspace/ContentTransition': { ContentTransition: 'transition' }, '@/app/locale': { useLocale: () => ({ t: value => value }) },
    './original-exchange-inspection-media': f.media, './OrderDetail.module.css': { default: {} } });
  f.request = { expectedOrderUpdatedAt: f.order.updatedAt, exchange: plain(f.body.exchange) }; f.newDisabled = false; f.unavailable = false;
  f.mountMediaPage = () => f.hooks.mount(() => f.mediaPage.ExchangeInspectionMediaPanel({ orderId: 'o1', orderRevision: f.order.updatedAt, operationToken: 'operation-token-double', request: f.request, newDisabled: f.newDisabled, unavailable: f.unavailable }));
  f.reference = key => JSON.parse([...f.storage.values()].find(value => value.startsWith('['))).find(row => !key || row.key === key);
  return f;
}
check('Merchant image source writes seal three stages once, verify exact evidence, retain opaque keys and isolate duplicate fields', async () => {
  const f = adminImageFixture(); f.mountMedia();
  const value = await f.hooks.value.run(f.body, f.file); assert.equal(value.state, 'completed'); assert.equal(value.preparationUse, 'not_connected');
  assert.equal(f.puts.length, 1); assert.equal(f.puts[0].credentials, 'omit'); assert.equal(f.puts[0].redirect, 'error'); assert.deepEqual(plain(f.puts[0].headers), { 'Content-Type': 'image/png' });
  assert.equal(f.puts[0].headers.Authorization, undefined); assert.equal(f.puts[0].headers['X-Operation-Token'], undefined);
  const reference = f.reference(), raw = [...f.storage.values()][0]; assert.equal(reference.phase, 'completed'); assert.ok(reference.sourceHash);
  assert.deepEqual(Object.keys(reference).sort(), ['bindingHash', 'fieldHash', 'key', 'orderId', 'phase', 'requirementsHash', 'sourceHash']);
  for (const text of ['Private', 'images.example', 'uploadUrl', 'operation-token', 'replacementAssetId', 'contentHash']) assert.equal(raw.includes(text), false, text);
  const writes = f.calls.filter(call => call.method === 'post'); assert.equal(writes.length, 2); assert.equal(writes[0]._authRetry, true); assert.equal(writes[1]._authRetry, true);
  assert.equal(writes[0].headers['X-Operation-Token'], 'operation-token-double');
  await assert.rejects(f.hooks.value.run({ ...f.body, fileName: 'another.png' }, { ...f.file, name: 'another.png' })); assert.equal(f.puts.length, 1);
  const restored = await f.hooks.value.recover(reference.key); assert.equal(restored.id, value.id); assert.equal(f.storage.size, 1);
  await f.hooks.value.run({ ...f.body, fieldCode: 'other' }, f.file); assert.equal(f.puts.length, 2); assert.equal(JSON.parse([...f.storage.values()][0]).length, 2);
  const wrong = adminImageFixture(); wrong.mountMedia();
  for (const body of [{ ...wrong.body, sizeBytes: 0 }, { ...wrong.body, expectedOrderUpdatedAt: 'invalid' }, { ...wrong.body, exchange: { ...wrong.body.exchange, customerConfirmed: true } }, { ...wrong.body, fieldCode: '__proto__' }]) await assert.rejects(wrong.hooks.value.run(body, wrong.file));
  assert.equal(wrong.calls.length, 0); assert.equal(wrong.storage.size, 0);
  for (const query of [`x-oss-signature-version=OSS4-HMAC-SHA256&x-oss-additional-headers=content-type%3Bhost&x-oss-credential=fixture%2F20261104%2Fregion%2Foss%2Faliyun_v4_request&x-oss-date=20261104T010000Z&x-oss-expires=3600&x-oss-signature=${'c'.repeat(64)}`,
    `q-sign-algorithm=sha1&q-ak=fixture&q-sign-time=1%3B2&q-key-time=1%3B2&q-header-list=host&q-url-param-list=&q-signature=${'c'.repeat(40)}`]) {
    const provider = adminImageFixture(); provider.mountMedia(); provider.createHook = source => ({ ...provider.ticket(source), uploadUrl: 'https://images.example.com/evidence/object?' + query });
    assert.equal((await provider.hooks.value.run(provider.body, provider.file)).state, 'completed'); assert.equal(provider.puts.length, 1);
  }
});
check('Merchant image storage failure, lost stage acknowledgements and restarted realms never replay upload or completion', async () => {
  for (const mode of ['throw', 'drop']) {
    const f = adminImageFixture(); f.mountMedia(); f.storageMode = mode; await assert.rejects(f.hooks.value.run(f.body, f.file)); assert.equal(f.calls.length, 0); assert.equal(f.puts.length, 0);
  }
  for (const stage of ['create', 'put', 'complete', 'put-store', 'complete-store']) {
    const f = adminImageFixture(); f.mountMedia();
    if (stage === 'create') f.createHook = () => { throw new Error('lost create ACK'); };
    if (stage === 'put') f.putHook = () => { throw new Error('lost PUT ACK'); };
    if (stage === 'complete') f.completeHook = source => { f.sources.set(source.operationKey, f.finish(source)); throw new Error('lost complete ACK'); };
    if (stage === 'put-store') f.createHook = source => { f.storageMode = 'drop'; return f.ticket(source); };
    if (stage === 'complete-store') f.putHook = () => { f.storageMode = 'drop'; return { ok: true }; };
    await assert.rejects(f.hooks.value.run(f.body, f.file)); f.storageMode = ''; const reference = f.reference();
    assert.equal(reference.phase, stage.startsWith('create') || stage === 'put-store' ? 'create_attempted' : stage === 'complete' ? 'complete_attempted' : 'put_attempted', stage);
    const count = f.calls.filter(call => call.method === 'post').length, puts = f.puts.length;
    f.hooks.unmount(); f.media = f.createMedia(); f.epoch++; f.mountMedia();
    const observed = await f.hooks.value.recover(reference.key);
    if (stage === 'complete') assert.equal(observed.state, 'completed');
    else await assert.rejects(f.hooks.value.run({ ...f.body, fieldCode: 'other' }, f.file));
    await assert.rejects(f.hooks.value.run(f.body, f.file));
    assert.equal(f.calls.filter(call => call.method === 'post').length, count, stage); assert.equal(f.puts.length, puts, stage);
    assert.ok(f.storage.size);
  }
  const f = adminImageFixture(); f.hooks.unmount(); const a = f.createMedia(), b = f.createMedia(); f.hooks.mount(() => [a.useOriginalExchangeInspectionMedia('o1'), b.useOriginalExchangeInspectionMedia('o1')]);
  const results = await Promise.allSettled(f.hooks.value.map(helper => helper.run(f.body, f.file))); assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(f.puts.length, 1);
});
check('Merchant image original rejects corrupt or foreign evidence and unsafe upload tickets without dropping the original reference', async () => {
  for (const mutate of [ticket => { ticket.uploadUrl = 'http://images.example.com/object'; }, ticket => { ticket.uploadUrl = 'https://127.0.0.1/object'; }, ticket => { ticket.uploadUrl = 'https://user:pass@images.example.com/object'; },
    ticket => { ticket.uploadUrl += '#fragment'; }, ticket => { ticket.uploadUrl += '&X-Amz-Signature=another'; }, ticket => { ticket.uploadUrl += '&returnUrl=arbitrary'; }, ticket => { ticket.uploadUrl = ticket.uploadUrl.replace('&X-Amz-Expires=3600', ''); },
    ticket => { ticket.uploadHeaders.Authorization = 'not-an-app-token'; }, ticket => { ticket.uploadHeaders['Content-Type'] = 'image/jpeg'; },
    ticket => { ticket.source.actorUserId = 'foreign'; }, ticket => { ticket.source.exchange.replacementAssetId = 'different'; }, ticket => { ticket.source.expiresAt = '2000-01-01T00:00:00Z'; }]) {
    const f = adminImageFixture(); f.mountMedia(); f.createHook = source => { const ticket = f.ticket(plain(source)); mutate(ticket); return ticket; };
    await assert.rejects(f.hooks.value.run(f.body, f.file)); assert.equal(f.puts.length, 0); assert.equal(f.reference().phase, 'create_attempted'); assert.equal(f.storage.size, 1);
  }
  const f = adminImageFixture(); f.mountMedia(); f.createHook = source => ({ state: 'observed', source, retryable: false }); await assert.rejects(f.hooks.value.run(f.body, f.file)); assert.equal(f.puts.length, 0);
  const reference = f.reference(); f.readHook = () => ({ state: 'not_recorded', retryable: false }); await assert.rejects(f.hooks.value.recover(reference.key)); assert.equal(f.storage.size, 1);
  f.readHook = source => ({ state: 'observed', source: { ...plain(source), state: 'completion_unknown' }, retryable: false }); assert.equal((await f.hooks.value.recover(reference.key)).state, 'completion_unknown');
  f.readHook = source => ({ state: 'observed', source: { ...f.finish(source), completion: { ...f.finish(source).completion, width: 0 } }, retryable: false }); await assert.rejects(f.hooks.value.recover(reference.key));
  const key = [...f.storage.keys()][0]; f.storage.set(key, JSON.stringify([{ ...reference, uploadUrl: 'forbidden' }])); f.hooks.rerender(); assert.ok(f.hooks.value.storageError); await assert.rejects(f.hooks.value.run(f.body, f.file)); assert.equal(f.puts.length, 0);
  const capacity = Array.from({ length: 64 }, (_, index) => ({ ...reference, key: 'ref-' + index, fieldHash: index.toString(16).padStart(64, '0') })); f.storage.set(key, JSON.stringify(capacity)); await assert.rejects(f.hooks.value.run(f.body, f.file), /上限/); assert.equal(f.puts.length, 0);
});
check('Merchant image panel has independent required-photo selection and stale-page recovery never accepts images as prepared facts', async () => {
  const f = adminImageFixture(); f.mountPanel(); await f.choose(); const slot = nodes(f.hooks.value).find(node => node.type === 'media-panel'); assert.ok(slot.props.request); assert.equal(slot.props.request.exchange.replacementAssetId, 'asset');
  f.hooks.unmount(); f.mountMediaPage(); await f.action('读取本次影像要求').props.onAction(); f.hooks.flush();
  const select = nodes(f.hooks.value).find(node => node.type === 'select'); await f.hooks.act(() => select.props.onChange(select.props.options[0].value));
  const picker = nodes(f.hooks.value).find(node => node.type === 'files'); assert.equal(picker.props.onUpload, undefined); assert.equal(picker.props.multiple, false);
  await f.hooks.act(() => picker.props.onChange([{ id: 'picked-file', file: f.file }])); await f.action('上传并核验本条影像').props.onAction(); f.hooks.flush();
  assert.ok(text(f.hooks.value).includes('影像来源已核验，尚未用于检查准备')); assert.equal(f.calls.some(call => call.url.endsWith('/preparations')), false);
  const reference = f.reference(); f.hooks.unmount(); f.request = undefined; f.order = { ...f.order, status: 'returned', updatedAt: '2026-11-04T04:00:00Z' }; f.mountMediaPage();
  assert.ok(f.action('核对原影像来源')); assert.equal(f.action('读取本次影像要求'), undefined); await f.action('核对原影像来源').props.onAction(); assert.equal(f.storage.size, 1);
  f.epoch++; f.auth.sessionVerified = false; f.auth.token = undefined; f.events.emit(); f.hooks.rerender(); assert.equal(f.action('核对原影像来源'), undefined); assert.equal(text(f.hooks.value).includes('Private image'), false);
  f.auth.sessionVerified = true; f.auth.token = 'synthetic-relogin'; f.hooks.unmount(); f.mountMediaPage(); assert.ok(f.action('核对原影像来源')); assert.equal(f.reference().key, reference.key);
  for (const boundary of ['create', 'put', 'complete']) for (const change of ['selection', 'selection-return', 'authority-return', 'unmount', 'logout']) {
    const g = adminImageFixture(); g.mountMedia(); const late = deferred();
    if (boundary === 'create') g.createHook = source => late.promise.then(() => g.ticket(source));
    if (boundary === 'put') g.putHook = () => late.promise;
    if (boundary === 'complete') g.completeHook = source => late.promise.then(() => ({ state: 'observed', source: g.finish(source), retryable: false }));
    const reached = () => boundary === 'create' ? g.sources.size > 0 : boundary === 'put' ? g.puts.length > 0 : g.calls.some(call => call.url.endsWith('/complete'));
    const pending = g.hooks.value.run(g.body, g.file); const rejected = assert.rejects(pending);
    for (let n = 0; n < 100 && !reached(); n++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.ok(reached(), `${boundary}/${change} entered actual dispatch boundary`);
    if (change === 'selection' || change === 'selection-return') {
      const previous = g.viewKey; g.viewKey = 'changed-selection'; g.hooks.rerender();
      if (change === 'selection-return') { g.viewKey = previous; g.hooks.rerender(); }
    } else if (change === 'authority-return') {
      // Both permission changes occur before React commits a render. The old chain must still die.
      const previous = g.auth.user.permissions; g.auth.user.permissions = []; g.events.emit();
      g.auth.user.permissions = previous; g.events.emit(); g.hooks.rerender();
    } else if (change === 'unmount') g.hooks.unmount();
    else { g.epoch++; g.auth.sessionVerified = false; g.auth.token = undefined; g.events.emit(); g.hooks.rerender(); }
    late.resolve({ ok: true }); await rejected;
    assert.equal(g.calls.some(call => call.method === 'get'), false); assert.equal(g.reference().phase, boundary === 'create' ? 'create_attempted' : boundary === 'put' ? 'put_attempted' : 'complete_attempted');
  }
});

check('Membership audit consumer smoke: scoped original projection, no grant mutation, late revocation and retained callbacks', async () => {
  const h=reactHost(),reply={tenantCode:'merchant',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'original_member_and_administrator_commands',unavailable:['invites_and_transfers','approvals','profile_requests','order_and_financial_audit'],items:[{operationKey:'audit-K',membershipId:'employee-a',actorCustomerId:'other-person',action:'member.change',reason:'Original reason',createdAt:'2026-11-01T00:00:00.000Z',result:{membershipId:'employee-a',status:'suspended',updatedAt:'2026-11-01T00:00:00.000Z',privateField:'not-projected'},privateField:'not-projected'}]};
  const context={identity:'audit-owner',tenantCode:'merchant',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'}},entry:{corporates:[{corporateCustomerId:'company',actions:['portal:enter','audit:read'],permissionRevision:'1:1'}]}};let options,reads=0,delay;const query={isFetching:false,data:undefined,refetch:async()=>{query.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};context.read=async path=>{reads++;assert.equal(path,'/enterprise/corporates/company/membership-audit');if(delay)await delay;return plain(reply);};context.write=forbidden('audit business command');
  const page=load('apps/enterprise-portal/src/MembershipAudit.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>context},'@tanstack/react-query':{useQuery:o=>{options=o;return query;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseMembershipAuditRecords({english:true}));assert.equal(options.enabled,true);const originalActions=plain(context.entry.corporates[0].actions);await query.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].privateField,undefined);assert.equal(table.props.dataSource[0].result.privateField,undefined);assert.equal(table.props.dataSource[0].result.status,'suspended');assert.deepEqual(context.entry.corporates[0].actions,originalActions);const button=nodes(h.value).find(n=>n.props.label==='Read membership audit again');context.entry.corporates[0].actions=['portal:enter'];h.rerender();await assert.rejects(button.props.onAction());assert.equal(reads,1);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);
  context.entry.corporates[0].actions=originalActions;h.rerender();const gate=deferred();delay=gate.promise;const running=options.queryFn({signal:new AbortController().signal});await Promise.resolve();context.selectedCorporateId='another-company';h.rerender();gate.resolve();await assert.rejects(running);assert.equal(reads,2);h.unmount();
});

check('Retained merge messages consumer smoke: no merged-person/private material or inherited authority, late identity hidden', async () => {
 const h=reactHost(),ctx={identity:'retained-msg',tenantCode:'merchant',basePath:'/merchant/enterprise',selectedCorporateId:'',loading:false,signal:new AbortController().signal,session:{customer:{customerId:'p1',customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_original_retained_master_merge_records',delivery:'not_reported',readState:'not_recorded',items:[{id:'merge-a',mergedAt:'2026-11-01T00:00:00.000Z',effect:'retained_master_record_only',sourceCustomerId:'private-person',fieldDiff:'private-diff',reason:'private-reason'}]};let options,pause,reads=0;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-retained-merge-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('merge messages are not a merge, recovery or grant');
 const page=load('apps/enterprise-portal/src/RetainedMergeMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseRetainedMergeMessagesPanel({english:true}));assert.equal(options.enabled,true);await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].effect,'retained_master_record_only');assert.equal(table.props.dataSource[0].sourceCustomerId,undefined);assert.equal(table.props.dataSource[0].fieldDiff,undefined);assert.equal(table.props.dataSource[0].reason,undefined);assert.equal(ctx.entry.corporates.length,0);assert.equal(ctx.selectedCorporateId,'');assert.equal(nodes(h.value).some(n=>n.type==='link'),false);
 const held=nodes(h.value).find(n=>n.props.label==='Read retained merge records again'),gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();assert.equal(nodes(h.value).some(n=>n.type==='table'),false);await assert.rejects(held.props.onAction());gate.resolve();await assert.rejects(pending);assert.equal(reads,2);h.unmount();
});

check('Own employee policy messages consumer smoke: original revisions not authority, private fields omitted and stale personal scope', async () => {
 const h=reactHost(),ctx={identity:'employee-policy',tenantCode:'merchant',basePath:'/merchant/enterprise',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal',customerId:'p1'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_original_retained_employee_policy_save_receipts',delivery:'not_reported',readState:'not_recorded',unavailable:['company_and_merchant_policy_recipient_history','unassociated_employee_policy_history'],items:[{operationKey:'policy-a-K',corporateCustomerId:'company',membershipId:'original-member',revision:1,membershipUpdatedAt:'2026-11-01T00:00:00.000Z',createdAt:'2026-11-01T00:00:00.000Z',effect:'original_employee_policy_save_only',policy:{private:'not-public'},reason:'private'}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-employee-policy-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('original employee policy messages are not a save, grant or K recovery');
 const page=load('apps/enterprise-portal/src/EmployeePolicyMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts'),'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseEmployeePolicyMessagesPanel({english:true}));assert.equal(options.enabled,true);await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].reason,undefined);assert.equal(table.props.dataSource[0].policy,undefined);assert.equal(table.props.dataSource[0].revision,1);assert.equal(table.props.dataSource[0].membershipUpdatedAt,reply.items[0].membershipUpdatedAt);assert.equal(table.props.columns.find(c=>c.title==='Own page').render().props.to,'/merchant/enterprise/join');assert.deepEqual(ctx.entry.corporates,[]);assert.equal(ctx.selectedCorporateId,undefined);
 const held=nodes(h.value).find(n=>n.props.label==='Read original employee policy saves');ctx.identity='new-login';h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,1);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.identity='employee-policy';h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();gate.resolve();await assert.rejects(pending);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);h.unmount();
});

check('Own corporate status messages consumer smoke: captured history not current grants, uncaptured unavailable, private fields omitted and stale identity', async () => {
 const h=reactHost(),ctx={identity:'corporate-status',tenantCode:'merchant',basePath:'/merchant/enterprise',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal',customerId:'p1'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_original_captured_corporate_membership_status_events',delivery:'not_reported',readState:'not_recorded',unavailable:['uncaptured_corporate_status_history'],items:[{historyId:'event-a',corporateCustomerId:'company',membershipId:'original-member',membershipUpdatedAt:'2026-11-01T00:00:00.000Z',capturedAt:'2026-11-01T00:00:00.000Z',at:'2026-11-01T00:00:00.000Z',action:'suspend',fromStatus:'active',toStatus:'suspended',reason:'private'}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-corporate-status-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('captured history is not status write, grant or K recovery');
 const page=load('apps/enterprise-portal/src/CorporateStatusMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts'),'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseCorporateStatusMessagesPanel({english:true}));assert.equal(options.enabled,true);await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].reason,undefined);assert.equal(table.props.dataSource[0].membershipUpdatedAt,reply.items[0].membershipUpdatedAt);assert.equal(table.props.columns.find(c=>c.title==='Own page').render().props.to,'/merchant/enterprise/join');assert.deepEqual(ctx.entry.corporates,[]);assert.equal(ctx.selectedCorporateId,undefined);
 const held=nodes(h.value).find(n=>n.props.label==='Read original corporate status');ctx.identity='new-login';h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,1);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.identity='corporate-status';h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();gate.resolve();await assert.rejects(pending);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);h.unmount();
});

check('Own status messages consumer smoke: private material omitted, no current grant/status mutations, stale account identity hidden', async () => {
 const h=reactHost(),ctx={identity:'status-msg',tenantCode:'merchant',basePath:'/merchant/enterprise',selectedCorporateId:'',loading:false,signal:new AbortController().signal,session:{customer:{customerId:'p1',customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_original_account_membership_status_history',delivery:'not_reported',readState:'not_recorded',items:[{id:'status-a',scope:'membership',action:'suspend',fromStatus:'active',toStatus:'suspended',at:'2026-11-01T00:00:00.000Z',reason:'private-reason',operator:'private-operator'}]};let options,pause,reads=0;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-status-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('status messages do not change status or authority');
 const page=load('apps/enterprise-portal/src/OwnStatusMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseOwnStatusMessagesPanel({english:true}));assert.equal(options.enabled,true);await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].toStatus,'suspended');assert.equal(table.props.dataSource[0].reason,undefined);assert.equal(table.props.dataSource[0].operator,undefined);assert.equal(ctx.session.customer.customerType,'personal');assert.equal(ctx.entry.corporates.length,0);assert.equal(ctx.selectedCorporateId,'');const held=nodes(h.value).find(n=>n.props.label==='Read my status changes again'),gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();assert.equal(nodes(h.value).some(n=>n.type==='table'),false);await assert.rejects(held.props.onAction());gate.resolve();await assert.rejects(pending);assert.equal(reads,2);h.unmount();
});

check('Transfer messages consumer smoke: original party only, registered personal page, no authority mutation and stale identity hidden', async () => {
 const h=reactHost(),ctx={identity:'transfer-msg',tenantCode:'merchant',basePath:'/merchant/enterprise',selectedCorporateId:'',loading:false,signal:new AbortController().signal,session:{customer:{customerId:'p1',customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_original_administrator_transfer_receipts',delivery:'not_reported',readState:'not_recorded',items:[{corporateCustomerId:'company',participation:'recipient',receipt:{operationKey:'transfer-K',objectId:'transfer-1',objectType:'administrator_transfer',actorCustomerId:'admin',action:'administrator.transfer',reason:'Original reason',createdAt:'2026-11-01T00:00:00.000Z',result:{id:'transfer-1',state:'pending',revision:1,privateField:'private'},privateField:'private'}}]};let options,pause,reads=0;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-transfer-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('transfer message is not a decision or recovery');
 const page=load('apps/enterprise-portal/src/TransferMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts',{}),'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseTransferMessagesPanel({english:true}));assert.equal(options.enabled,true);await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].participation,'recipient');assert.equal(table.props.dataSource[0].receipt.result.state,'pending');assert.equal(table.props.dataSource[0].receipt.privateField,undefined);assert.equal(table.props.dataSource[0].receipt.result.privateField,undefined);assert.equal(table.props.columns.at(-1).render().props.to,'/merchant/enterprise/join');assert.equal(ctx.entry.corporates.length,0);assert.equal(ctx.selectedCorporateId,'');
 const held=nodes(h.value).find(n=>n.props.label==='Read transfer messages again'),gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();assert.equal(nodes(h.value).some(n=>n.type==='table'),false);await assert.rejects(held.props.onAction());gate.resolve();await assert.rejects(pending);assert.equal(reads,2);h.unmount();
});

check('Relationship messages consumer smoke: original historical role/actions do not grant authority or recover K, late identity hidden', async () => {
 const h=reactHost(),ctx={identity:'relation-msg',tenantCode:'merchant',basePath:'/merchant/enterprise',selectedCorporateId:'',loading:false,signal:new AbortController().signal,session:{customer:{customerId:'p1',customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_original_member_administrator_command_receipts',delivery:'not_reported',readState:'not_recorded',items:[{corporateCustomerId:'company',receipt:{operationKey:'admin-K',membershipId:'original-rel',actorCustomerId:'admin',action:'administrator.change',reason:'Original reason',createdAt:'2026-11-01T00:00:00.000Z',result:{membershipId:'original-rel',role:'admin',actions:['portal:enter'],updatedAt:'2026-11-01T00:00:00.000Z',revision:2,privateField:'private'},privateField:'private'}}]};let options,pause,reads=0;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-relationship-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('relationship message is not an action');const page=load('apps/enterprise-portal/src/RelationshipMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts',{}),'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseRelationshipMessagesPanel({english:true}));await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].receipt.result.role,'admin');assert.equal(table.props.dataSource[0].receipt.privateField,undefined);assert.equal(table.props.dataSource[0].receipt.result.privateField,undefined);assert.equal(table.props.columns.at(-1).render().props.to,'/merchant/enterprise/join');assert.equal(ctx.entry.corporates.length,0);assert.equal(ctx.selectedCorporateId,'');const held=nodes(h.value).find(n=>n.props.label==='Read personal changes again'),gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();assert.equal(nodes(h.value).some(n=>n.type==='table'),false);await assert.rejects(held.props.onAction());gate.resolve();await assert.rejects(pending);assert.equal(reads,2);h.unmount();
});

check('Approval notices consumer smoke: current authority, original page only, private projection and stale reviewer rejection', async () => {
 const h=reactHost(),ctx={identity:'approval-msg',tenantCode:'merchant',basePath:'/merchant/enterprise',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerId:'admin',customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[{corporateCustomerId:'company',permissionRevision:'1:1',actions:['approvals:review']}]}},reply={tenantCode:'merchant',customerId:'admin',workspaceCode:'s1',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'current_workspace_nonself_pending_approval_records',delivery:'not_reported',readState:'not_recorded',items:[{approvalId:'booking-1',kind:'booking_approval',state:'pending',revision:1,createdAt:'2026-11-01T00:00:00.000Z',expiresAt:'2099-01-01T00:00:00.000Z',page:'approvals',amount:'private',applicantCustomerId:'other-person'}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/corporates/company/approval-notices');if(pause)await pause;return plain(reply);};ctx.write=forbidden('notice cannot approve, execute or recover');
 const page=load('apps/enterprise-portal/src/ApprovalNotices.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts',{}),'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseApprovalNoticesPanel({english:true,review:true}));await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].amount,undefined);assert.equal(table.props.dataSource[0].applicantCustomerId,undefined);assert.equal(table.props.columns.at(-1).render(null,table.props.dataSource[0]).props.to,'/merchant/enterprise/approvals');assert.equal(ctx.selectedCorporateId,'company');
 const held=nodes(h.value).find(n=>n.props.label==='Read approval reminders again'),gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.entry.corporates[0].actions=[];h.rerender();assert.equal(options.enabled,false);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);await assert.rejects(held.props.onAction());gate.resolve();await assert.rejects(pending);assert.equal(reads,2);h.unmount();
});

check('Own management review messages consumer smoke: review-only history is not business change, safe own locator without grant and stale identity', async () => {
 const h=reactHost(),ctx={identity:'own-management-reviews',tenantCode:'merchant',basePath:'/merchant/enterprise',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal',customerId:'p1'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_original_management_review_only_receipts',delivery:'not_reported',readState:'not_recorded',items:[{requestId:'request-a',corporateCustomerId:'company',requestType:'profile_change',operationKey:'approved-K',state:'approved',revision:4,effect:'review_only_no_business_change',reason:'Original review reason',createdAt:'2026-11-01T00:00:00.000Z',proposal:'private'},{requestId:'request-b',corporateCustomerId:'company',requestType:'scope_change',operationKey:'rejected-K',state:'rejected',revision:2,effect:'review_only_no_business_change',reason:'Original rejection',createdAt:'2026-11-02T00:00:00.000Z'}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-management-review-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('management history is not review, business change or K recovery');
 const page=load('apps/enterprise-portal/src/ManagementReviewMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts'),'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseManagementReviewMessagesPanel({english:true}));assert.equal(options.enabled,true);await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource.length,2);assert.equal(table.props.dataSource[0].proposal,undefined);assert.equal(table.props.columns.find(c=>c.title==='Original review result').render(undefined,table.props.dataSource[0]),'Approval recorded (review only)');assert.equal(table.props.columns.find(c=>c.title==='Own page').render(undefined,table.props.dataSource[0]).props.to,'/merchant/enterprise/profile?requestId=request-a');assert.equal(ctx.selectedCorporateId,undefined);assert.deepEqual(ctx.entry.corporates,[]);
 const held=nodes(h.value).find(n=>n.props.label==='Read original management reviews');ctx.identity='new-login';h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,1);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.identity='own-management-reviews';h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();gate.resolve();await assert.rejects(pending);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);h.unmount();
});

check('Own join review messages consumer smoke: original results without enterprise grant, operation reason not invented refusal, registered own page and stale identity', async () => {
 const h=reactHost(),ctx={identity:'own-join-reviews',tenantCode:'merchant',basePath:'/merchant/enterprise',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal',customerId:'p1'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_original_join_review_receipts',delivery:'not_reported',readState:'not_recorded',items:[{requestId:'join-a',corporateCustomerId:'company',operationKey:'approved-K',state:'approved',revision:2,reason:'Original operation reason',createdAt:'2026-11-01T00:00:00.000Z',inviteCode:'secret'},{requestId:'join-b',corporateCustomerId:'company',operationKey:'rejected-K',state:'rejected',revision:2,reason:'Original review attempt',createdAt:'2026-11-02T00:00:00.000Z'}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-join-review-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('join-review history is not review or recovery');
 const page=load('apps/enterprise-portal/src/JoinReviewMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts'),'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseJoinReviewMessagesPanel({english:true}));assert.equal(options.enabled,true);await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource.length,2);assert.equal(table.props.dataSource[0].inviteCode,undefined);assert.equal(table.props.columns.find(c=>c.title==='Own page').render().props.to,'/merchant/enterprise/join');assert(nodes(h.value).some(n=>String(n.props.description).includes('operation reason is not proof of the specific rejection reason')));assert.equal(ctx.selectedCorporateId,undefined);assert.deepEqual(ctx.entry.corporates,[]);
 const held=nodes(h.value).find(n=>n.props.label==='Read original join reviews');ctx.identity='new-login';h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,1);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.identity='own-join-reviews';h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();gate.resolve();await assert.rejects(pending);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);h.unmount();
});

check('Own application review messages consumer smoke: original history without corporate grant, registered own locator, no K/authority mutation and stale identity', async () => {
 const h=reactHost(),ctx={identity:'own-reviews',tenantCode:'merchant',basePath:'/merchant/enterprise',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal',customerId:'p1'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_original_application_review_receipts',delivery:'not_reported',readState:'not_recorded',items:[{requestId:'app-a',operationKey:'supplement-K',state:'supplement_required',revision:2,feedback:'Original supplement feedback',createdAt:'2026-11-01T00:00:00.000Z',privateMaterial:'private'},{requestId:'app-a',operationKey:'approved-K',state:'approved',revision:4,corporateCustomerId:'company',feedback:'Original approved feedback',createdAt:'2026-11-02T00:00:00.000Z'}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-application-review-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('review messages are not review or recovery');
 const page=load('apps/enterprise-portal/src/ApplicationReviewMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts'),'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseApplicationReviewMessagesPanel({english:true}));assert.equal(options.enabled,true);await q.refetch();const table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource.length,2);assert.equal(table.props.dataSource[0].privateMaterial,undefined);const column=table.props.columns.find(c=>c.title==='Original page'),link=column.render(undefined,table.props.dataSource[0]);assert.equal(link.props.to,'/merchant/enterprise/applications?requestId=app-a');assert.equal(ctx.selectedCorporateId,undefined);assert.deepEqual(ctx.entry.corporates,[]);
 const held=nodes(h.value).find(n=>n.props.label==='Read original application reviews');ctx.identity='new-login';h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,1);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.identity='own-reviews';h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();gate.resolve();await assert.rejects(pending);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);h.unmount();
});

check('Own message feedback consumer smoke: personal current feedback, registered locator, missing source and late identity isolation', async () => {
 const h=reactHost(),ctx={identity:'own-messages',tenantCode:'merchant',basePath:'/merchant/enterprise',selectedCorporateId:'unreadable-company',loading:false,signal:new AbortController().signal,session:{customer:{customerId:'p1',customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[]}},reply={tenantCode:'merchant',customerId:'p1',coverage:'own_current_persisted_request_feedback',delivery:'not_reported',readState:'not_recorded',unavailable:['relationship_and_administrator_changes','approval_feedback','order_and_financial_alerts','external_notifications','delivery_and_read_receipts'],items:[{requestId:'app-a',kind:'corporate_application',state:'approved',revision:2,updatedAt:'2026-11-01T00:00:00.000Z',page:'applications',feedback:'Original feedback',privateField:'private'}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/my-messages');if(pause)await pause;return plain(reply);};ctx.write=forbidden('messages do not acknowledge or execute');
 const page=load('apps/enterprise-portal/src/OwnMessages.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts',{}),'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseOwnMessagesPanel({english:true}));assert.equal(options.enabled,true);await q.refetch();let table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].privateField,undefined);const link=table.props.columns.at(-1).render(undefined,table.props.dataSource[0]);assert.equal(link.props.to,'/merchant/enterprise/applications?requestId=app-a');assert.equal(ctx.selectedCorporateId,'unreadable-company');
 const held=nodes(h.value).find(n=>n.props.label==='Read personal feedback again'),gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.session.customer.customerId='p2';h.rerender();assert.equal(nodes(h.value).some(n=>n.type==='table'),false);await assert.rejects(held.props.onAction());gate.resolve();await assert.rejects(pending);assert.equal(reads,2);h.unmount();
});

check('Merchant portal audit consumer smoke: original activation not current grants, legacy unavailable and stale audit scope', async () => {
 const h=reactHost(),ctx={identity:'merchant-portal-audit',tenantCode:'merchant',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[{corporateCustomerId:'company',actions:['portal:enter','audit:read'],permissionRevision:'1:1'}]}},reply={tenantCode:'merchant',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'original_member_and_administrator_commands',unavailable:['invites_and_transfers','approvals','profile_requests','order_and_financial_audit'],items:[],merchantPortalCoverage:'original_bare_actor_corporate_portal_configuration_metadata',merchantPortalItems:[{operationKey:'portal-K',actor:{kind:'operator',id:'original-operator'},action:'portal.configuration',reason:'Original configuration reason',createdAt:'2026-11-01T00:00:00.000Z',result:{corporateCustomerId:'company',enabled:true,revision:1,grants:[{private:true}]},private:true}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/corporates/company/membership-audit');if(pause)await pause;return plain(reply);};ctx.write=forbidden('original portal metadata is not activation, regrant or recovery');
 const page=load('apps/enterprise-portal/src/MembershipAudit.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseMembershipAuditRecords({english:true}));await q.refetch();const table=nodes(h.value).find(n=>n.type==='table'&&n.props.dataSource[0]?.operationKey==='portal-K');assert.deepEqual(plain(table.props.dataSource[0].result),{corporateCustomerId:'company',enabled:true,revision:1});assert.equal(table.props.dataSource[0].private,undefined);const granted=plain(ctx.entry.corporates[0].actions);delete reply.merchantPortalItems;delete reply.merchantPortalCoverage;await q.refetch();assert(nodes(h.value).some(n=>n.props.title==='Original merchant portal configuration metadata unavailable'));assert.deepEqual(ctx.entry.corporates[0].actions,granted);
 const held=nodes(h.value).find(n=>n.props.label==='Read membership audit again');ctx.entry.corporates[0].actions=[];h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,2);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.entry.corporates[0].actions=granted;h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.selectedCorporateId='other';h.rerender();gate.resolve();await assert.rejects(pending);h.unmount();
});

check('Merchant policy audit consumer smoke: original operator metadata only, legacy unavailable, no policy mutation, stale grant and scope', async () => {
 const h=reactHost(),ctx={identity:'merchant-policy-audit',tenantCode:'merchant',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[{corporateCustomerId:'company',actions:['portal:enter','audit:read'],permissionRevision:'1:1'}]}},reply={tenantCode:'merchant',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'original_member_and_administrator_commands',unavailable:['invites_and_transfers','approvals','profile_requests','order_and_financial_audit'],items:[],merchantPolicyCoverage:'original_merchant_policy_save_metadata',merchantPolicyItems:[{operationKey:'merchant-K',actor:{kind:'operator',id:'reviewer'},action:'policy.merchant',scopeKey:'merchant',reason:'Original configuration reason',createdAt:'2026-11-01T00:00:00.000Z',result:{scopeKey:'merchant',revision:1,policy:{private:true}},private:true}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/corporates/company/membership-audit');if(pause)await pause;return plain(reply);};ctx.write=forbidden('merchant metadata is not policy write or recovery');
 const page=load('apps/enterprise-portal/src/MembershipAudit.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseMembershipAuditRecords({english:true}));await q.refetch();const table=nodes(h.value).find(n=>n.type==='table'&&n.props.dataSource[0]?.operationKey==='merchant-K');assert.deepEqual(plain(table.props.dataSource[0].result),{scopeKey:'merchant',revision:1});assert.equal(table.props.dataSource[0].private,undefined);const granted=plain(ctx.entry.corporates[0].actions);delete reply.merchantPolicyItems;delete reply.merchantPolicyCoverage;await q.refetch();assert(nodes(h.value).some(n=>n.props.title==='Original merchant-policy save metadata unavailable'));assert.deepEqual(ctx.entry.corporates[0].actions,granted);
 const held=nodes(h.value).find(n=>n.props.label==='Read membership audit again');ctx.entry.corporates[0].actions=[];h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,2);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.entry.corporates[0].actions=granted;h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.selectedCorporateId='other';h.rerender();gate.resolve();await assert.rejects(pending);h.unmount();
});

check('Application approval audit consumer smoke: original operator approval binding, no private material/current grant, legacy unavailable and stale scope', async () => {
 const h=reactHost(),ctx={identity:'application-audit',tenantCode:'merchant',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[{corporateCustomerId:'company',actions:['portal:enter','audit:read'],permissionRevision:'1:1'}]}},reply={tenantCode:'merchant',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'original_member_and_administrator_commands',unavailable:['invites_and_transfers','approvals','profile_requests','order_and_financial_audit'],items:[],applicationApprovalCoverage:'original_application_approval_company_binding_receipts',applicationApprovalItems:[{operationKey:'approve-K',objectId:'app-a',actor:{kind:'operator',id:'reviewer'},action:'application.review',reason:'Original public reason',createdAt:'2026-11-01T00:00:00.000Z',result:{id:'app-a',state:'approved',revision:2,corporateCustomerId:'company',privateMaterial:'private'},privateMaterial:'private'}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/corporates/company/membership-audit');if(pause)await pause;return plain(reply);};ctx.write=forbidden('approval audit is not approval/claim or recovery');
 const page=load('apps/enterprise-portal/src/MembershipAudit.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseMembershipAuditRecords({english:true}));await q.refetch();const table=nodes(h.value).find(n=>n.type==='table'&&n.props.dataSource[0]?.operationKey==='approve-K');assert.equal(table.props.dataSource[0].result.state,'approved');assert.equal(table.props.dataSource[0].privateMaterial,undefined);assert.equal(table.props.dataSource[0].result.privateMaterial,undefined);const granted=plain(ctx.entry.corporates[0].actions);delete reply.applicationApprovalItems;delete reply.applicationApprovalCoverage;await q.refetch();assert(nodes(h.value).some(n=>n.props.title==='Original application/company approval audit unavailable'));assert.deepEqual(ctx.entry.corporates[0].actions,granted);
 const held=nodes(h.value).find(n=>n.props.label==='Read membership audit again');ctx.entry.corporates[0].actions=[];h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,2);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.entry.corporates[0].actions=granted;h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.selectedCorporateId='other';h.rerender();gate.resolve();await assert.rejects(pending);h.unmount();
});

check('Policy command audit consumer smoke: metadata only, no current limits/authority, legacy unavailable and stale grant', async () => {
 const h=reactHost(),ctx={identity:'policy-audit',tenantCode:'merchant',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[{corporateCustomerId:'company',actions:['portal:enter','audit:read'],permissionRevision:'1:1'}]}},reply={tenantCode:'merchant',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'original_member_and_administrator_commands',unavailable:['invites_and_transfers','approvals','profile_requests','order_and_financial_audit'],items:[],policyCoverage:'original_customer_company_and_member_policy_commands',policyItems:[{operationKey:'policy-K',actorCustomerId:'admin',action:'policy.company',scopeKey:'member:employee-a',reason:'Original reason',createdAt:'2026-11-01T00:00:00.000Z',result:{scopeKey:'member:employee-a',revision:2,membershipUpdatedAt:'2026-11-01T00:00:00.000Z',policy:{maxRequestAmount:'private-limit'}}}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/corporates/company/membership-audit');if(pause)await pause;return plain(reply);};ctx.write=forbidden('policy metadata audit is not a save/grant or recovery');
 const page=load('apps/enterprise-portal/src/MembershipAudit.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseMembershipAuditRecords({english:true}));await q.refetch();const table=nodes(h.value).find(n=>n.type==='table'&&n.props.dataSource[0]?.operationKey==='policy-K');assert.equal(table.props.dataSource[0].result.revision,2);assert.equal(table.props.dataSource[0].result.policy,undefined);const granted=plain(ctx.entry.corporates[0].actions);delete reply.policyItems;delete reply.policyCoverage;await q.refetch();assert(nodes(h.value).some(n=>n.props.title==='Original customer policy-command metadata unavailable'));assert.deepEqual(ctx.entry.corporates[0].actions,granted);
 const held=nodes(h.value).find(n=>n.props.label==='Read membership audit again');ctx.entry.corporates[0].actions=[];h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,2);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.entry.corporates[0].actions=granted;h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.selectedCorporateId='other';h.rerender();gate.resolve();await assert.rejects(pending);h.unmount();
});

check('Join request audit consumer smoke: original pending stays history, private material cloned out, legacy unavailable and stale grant rejected', async () => {
 const h=reactHost(),ctx={identity:'join-audit',tenantCode:'merchant',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[{corporateCustomerId:'company',actions:['portal:enter','audit:read'],permissionRevision:'1:1'}]}},reply={tenantCode:'merchant',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'original_member_and_administrator_commands',unavailable:['invites_and_transfers','approvals','profile_requests','order_and_financial_audit'],items:[],joiningCoverage:'original_corporate_associated_join_request_commands',joiningItems:[{operationKey:'join-K',objectId:'join-a',actorCustomerId:'p1',action:'join.submit',reason:'Original reason',createdAt:'2026-11-01T00:00:00.000Z',result:{id:'join-a',state:'pending',revision:1,privateMaterial:'private'},privateMaterial:'private'}]};let options,reads=0,pause;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async path=>{reads++;assert.equal(path,'/enterprise/corporates/company/membership-audit');if(pause)await pause;return plain(reply);};ctx.write=forbidden('join audit is not admission or recovery');
 const page=load('apps/enterprise-portal/src/MembershipAudit.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseMembershipAuditRecords({english:true}));await q.refetch();let table=nodes(h.value).find(n=>n.type==='table'&&n.props.dataSource[0]?.operationKey==='join-K');assert.equal(table.props.dataSource[0].result.state,'pending');assert.equal(table.props.dataSource[0].privateMaterial,undefined);assert.equal(table.props.dataSource[0].result.privateMaterial,undefined);const granted=plain(ctx.entry.corporates[0].actions);delete reply.joiningItems;delete reply.joiningCoverage;await q.refetch();assert(nodes(h.value).some(n=>n.props.title==='Original associated join-request audit unavailable'));assert.deepEqual(ctx.entry.corporates[0].actions,granted);
 const held=nodes(h.value).find(n=>n.props.label==='Read membership audit again');ctx.entry.corporates[0].actions=[];h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,2);assert.equal(nodes(h.value).some(n=>n.type==='table'),false);ctx.entry.corporates[0].actions=granted;h.rerender();const gate=deferred();pause=gate.promise;const pending=options.queryFn({signal:new AbortController().signal});await Promise.resolve();ctx.selectedCorporateId='other-company';h.rerender();gate.resolve();await assert.rejects(pending);h.unmount();
});

check('Expense approval audit consumer smoke: original expense-only results, missing legacy source and no recovery mutation', async () => {
 const h=reactHost(),ctx={identity:'audit-ui',tenantCode:'merchant',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[{corporateCustomerId:'company',permissionRevision:'1:1',actions:['audit:read']}]}},reply={tenantCode:'merchant',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'original_member_and_administrator_commands',workflowCoverage:'original_invite_and_administrator_transfer_commands',workflowItems:[],businessCoverage:'original_management_and_current_workspace_booking_commands',bookingWorkspace:{state:'available',code:'s1'},businessItems:[],expenseCoverage:'original_current_workspace_associated_expense_approval_commands',expenseItems:[{operationKey:'expense-K',objectId:'exchange-a',objectType:'exchange_approval',actorCustomerId:'p1',action:'exchange.expense.confirm',reason:'Original expense consent',createdAt:'2026-11-01T00:00:00.000Z',result:{id:'exchange-a',revision:3,confirmedAt:'2026-11-01T00:00:00.000Z',scope:'expense_only_not_inspection_or_execution',orderId:'private',amount:'private'},privateField:'private'}],unavailable:['remaining_approval_audit','order_and_financial_audit'],items:[]};
 let options,reads=0;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async()=>{reads++;return plain(reply);};ctx.write=forbidden('audit write');const page=load('apps/enterprise-portal/src/MembershipAudit.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseMembershipAuditRecords({english:true}));await q.refetch();let tables=nodes(h.value).filter(n=>n.type==='table');assert.equal(tables.length,4);assert.equal(tables[3].props.dataSource[0].result.scope,'expense_only_not_inspection_or_execution');assert.equal(tables[3].props.dataSource[0].result.orderId,undefined);assert.equal(tables[3].props.dataSource[0].result.amount,undefined);assert.equal(tables[3].props.dataSource[0].privateField,undefined);assert.equal(ctx.selectedCorporateId,'company');const held=nodes(h.value).find(n=>n.props.label==='Read membership audit again');reply.bookingWorkspace={state:'unavailable'};reply.expenseItems=[];reply.unavailable.unshift('approvals');await q.refetch();assert.equal(nodes(h.value).filter(n=>n.type==='table').length,3);assert(nodes(h.value).some(n=>n.props.title==='Original extension/exchange audit source unavailable'));reply.bookingWorkspace={state:'available',code:'s1'};reply.unavailable.shift();delete reply.expenseCoverage;delete reply.expenseItems;await q.refetch();assert.equal(nodes(h.value).filter(n=>n.type==='table').length,3);assert(nodes(h.value).some(n=>n.props.title==='Original extension/exchange audit source unavailable'));ctx.entry.corporates[0].actions=[];h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,3);h.unmount();
});

check('Booking management audit consumer smoke: minimal original receipts and held workspace callbacks reject', async () => {
 const h=reactHost(),ctx={identity:'audit-ui',tenantCode:'merchant',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'},workspace:{workspaceCode:'s1'}},entry:{corporates:[{corporateCustomerId:'company',permissionRevision:'1:1',actions:['audit:read']}]}},reply={tenantCode:'merchant',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'original_member_and_administrator_commands',workflowCoverage:'original_invite_and_administrator_transfer_commands',workflowItems:[],businessCoverage:'original_management_and_current_workspace_booking_commands',bookingWorkspace:{state:'available',code:'s1'},businessItems:[{operationKey:'review-K',objectId:'request-1',objectType:'management_request',actor:{kind:'operator',id:'merchant',privateField:'private'},action:'management-request.review',reason:'Original review reason',createdAt:'2026-11-01T00:00:00.000Z',result:{id:'request-1',state:'approved',revision:2,effect:'review_only_no_business_change',proposal:'private',amount:'100'},privateField:'private'}],unavailable:['remaining_approval_audit','order_and_financial_audit'],items:[]};
 let options,reads=0;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async()=>{reads++;return plain(reply);};ctx.write=forbidden('audit write');const page=load('apps/enterprise-portal/src/MembershipAudit.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseMembershipAuditRecords({english:true}));await q.refetch();const tables=nodes(h.value).filter(n=>n.type==='table');assert.equal(tables.length,3);assert.equal(tables[2].props.dataSource[0].actor.kind,'operator');assert.equal(tables[2].props.dataSource[0].result.effect,'review_only_no_business_change');assert.equal(tables[2].props.dataSource[0].result.amount,undefined);assert.equal(tables[2].props.dataSource[0].actor.privateField,undefined);assert.equal(ctx.selectedCorporateId,'company');
 const held=nodes(h.value).find(n=>n.props.label==='Read membership audit again');ctx.session.workspace.workspaceCode='s2';h.rerender();assert.equal(nodes(h.value).filter(n=>n.type==='table').length,0);await assert.rejects(held.props.onAction());assert.equal(reads,1);h.unmount();
});

check('Invite transfer audit consumer smoke: original workflow rows, legacy unavailable, no K/C or enterprise mutation', async () => {
 const h=reactHost(),ctx={identity:'audit-ui',tenantCode:'merchant',selectedCorporateId:'company',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'}},entry:{corporates:[{corporateCustomerId:'company',permissionRevision:'1:1',actions:['audit:read']}]}};
 const reply={tenantCode:'merchant',corporateCustomerId:'company',permissionRevision:'1:1',coverage:'original_member_and_administrator_commands',workflowCoverage:'original_invite_and_administrator_transfer_commands',unavailable:['approvals','profile_requests','order_and_financial_audit'],items:[],workflowItems:[{operationKey:'inv-K',objectId:'invite-1',objectType:'invite',actorCustomerId:'admin',action:'invite.revoke',reason:'Original revoke',createdAt:'2026-11-01T00:00:00.000Z',result:{id:'invite-1',status:'revoked',revision:2,privateField:'not-shared'},privateField:'not-shared'},{operationKey:'close-C',objectId:'transfer-1',objectType:'administrator_transfer',actorCustomerId:'recipient',action:'administrator.decision.close',reason:'Original closure',createdAt:'2026-11-01T00:00:00.000Z',result:{id:'transfer-1',state:'rejected',revision:2,outcome:'closed'}}]};let options,reads=0;const q={isFetching:false,data:undefined,refetch:async()=>{q.data=await options.queryFn({signal:new AbortController().signal});h.rerender();}};ctx.read=async()=>{reads++;return plain(reply);};ctx.write=forbidden('audit write');const page=load('apps/enterprise-portal/src/MembershipAudit.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>ctx},'@tanstack/react-query':{useQuery:o=>{options=o;return q;}},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}},{AbortSignal});h.mount(()=>page.EnterpriseMembershipAuditRecords({english:true}));await q.refetch();const tables=nodes(h.value).filter(n=>n.type==='table');assert.equal(tables.length,2);assert.equal(tables[1].props.dataSource[0].privateField,undefined);assert.equal(tables[1].props.dataSource[0].result.privateField,undefined);assert.equal(tables[1].props.dataSource[1].result.outcome,'closed');assert.equal(ctx.selectedCorporateId,'company');assert.deepEqual(ctx.entry.corporates[0].actions,['audit:read']);const held=nodes(h.value).find(n=>n.props.label==='Read membership audit again');ctx.entry.corporates[0].actions=[];h.rerender();await assert.rejects(held.props.onAction());assert.equal(reads,1);h.unmount();
});

(async () => {
  console.log(`Enterprise consumers run=${new Date().toISOString()} tests=${checks.length} audit=${process.env.AI_OFFLINE_AUDIT}`);
  let failures = 0;
  for (const { name, fn } of checks) {
    let timer;
    try {
      await Promise.race([fn(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Bounded scenario timed out (3000 ms)')), 3000); })]);
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++; console.log(`FAIL ${name}\n${error.stack || error}`);
    } finally { clearTimeout(timer); }
  }
  for (const [relative, source] of sources) {
    const current = crypto.createHash('sha256').update(fs.readFileSync(source.filename, 'utf8')).digest('hex');
    if (current !== source.hash) { failures++; console.log(`SOURCE_CHANGED_DURING_RUN ${relative} loaded=${source.hash} current=${current}; reverify current source explicitly`); }
  }
  console.log(`RESULT ${checks.length - failures}/${checks.length} passed; failures=${failures}`);
  console.log('COVERAGE actual TSX event closures + hook + full checkout Page; mini API/storage/cart; ClientApiService reader/private ownership/ALS.');
  console.log('NOT_COVERED real React DOM/browser/WeChat runtime, actual HTTP/auth adapter refresh, Prisma/MySQL locking, Core writes/inventory/payment, external services, full typecheck/build, existing 35 enterprise combinations, formal acceptance.');
  process.exitCode = failures ? 1 : 0;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

check('Handoff order source smoke: original task link, bounded projection, authorized queue pagination and stale read isolation', async () => {
  const h=reactHost(),context={identity:'source-owner',basePath:'/merchant/enterprise',loading:false,signal:new AbortController().signal,session:{customer:{customerType:'personal'},workspace:{workspaceCode:'s1'}}};
  const material={orderId:'order-a',orderNo:'Original rental',orderUpdatedAt:'2026-11-02T00:00:00.000Z',workspaceCode:'s1',corporateCustomerId:'company',corporateMembershipId:'original-relation',membershipResolvedAt:'2026-11-01T00:00:00.000Z',membershipUpdatedAt:null,enterpriseContractAndPayer:true,subjects:{contract:'corporate',payer:'corporate',user:'self'},subjectBasis:'recorded_columns',scope:'current_workspace_original_own_order',readOnly:true,privateField:'must-not-render'};
  const source={state:'available',coverage:'current_workspace_original_own_enterprise_employee_orders',items:[{status:'renting',material,privateField:'must-not-render'}]};
  const page=load('apps/enterprise-portal/src/OwnRentalHandoffOrders.tsx',{react:h.runtime,'react/jsx-runtime':h.jsx,'./enterprise-session':{useEnterprise:()=>context},'react-router-dom':{Link:'link'},'@rental-os/web-client':load('packages/web-client/src/enterprise-entry.ts',{}),'@tanstack/react-query':{useQuery:()=>({})},'@/components/ui/customer-entry':{ActionButton:'action',Alert:'alert',Table:'table'}});
  h.mount(()=>page.EnterpriseRentalHandoffOrderTable({source,english:true}));let table=nodes(h.value).find(n=>n.type==='table');assert.equal(table.props.dataSource[0].privateField,undefined);assert.equal(table.props.dataSource[0].material.privateField,undefined);assert.equal(table.props.columns.at(-1).render(null,table.props.dataSource[0]).props.to,'/merchant/enterprise/join?handoffOrderId=order-a');source.items.push(source.items[0]);h.rerender();assert.equal(nodes(h.value).some(n=>n.type==='table'),false);h.unmount();
  const hooks=reactHost(),auth={sessionVerified:true,currentWorkspaceId:'w1',user:{dataScope:'all'},hasPermission:()=>true},useAuthStore=()=>auth;useAuthStore.getState=()=>auth;
  let identity='merchant-one',reads=[],located=[],allowed=true;const gate={useOriginalEnterpriseOperation:()=>({identity,busy:false,assertCurrent:()=>{if(!allowed)throw new Error('authority changed');},read:async path=>{reads.push(path);const p=Number(path.split('=').at(-1));return{coverage:'current_workspace_authorized_original_order_page',orderPage:{page:p,pageSize:50,total:51},items:p===1?[]:[{id:'handoff-a',orderId:'order-a',applicantCustomerId:'p1',state:'pending',revision:1,reason:'Original reason',material,createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',effect:'request_only_no_business_change'}]};}})};
  const queue=load('apps/admin/src/features/membership/EnterpriseRentalHandoffQueue.tsx',{react:hooks.runtime,'react/jsx-runtime':hooks.jsx,'@/features/auth/authStore':{useAuthStore},'./original-enterprise-operation':gate,'@/app/locale':{useLocale:()=>({t:s=>s})},'@/components/ui':{ActionButton:'action',Alert:'alert',Table:'table'}});
  hooks.mount(()=>queue.EnterpriseRentalHandoffQueue({onLocate:id=>located.push(id)}));const button=label=>{const b=nodes(hooks.value).find(n=>n.props.label===label);assert(b,label);return b;};await button('读取首个受权订单页').props.onAction();assert.equal(button('下一受权订单页').props.disabled,false);assert.equal(button('上一受权订单页').props.disabled,true);assert(text(hooks.value).includes('本订单页没有待核对申请'));await button('下一受权订单页').props.onAction();table=nodes(hooks.value).find(n=>n.type==='table');const locate=nodes(table.props.columns.at(-1).render(null,table.props.dataSource[0])).find(n=>n.type==='action');await locate.props.onAction();assert.deepEqual(located,['handoff-a']);assert.deepEqual(reads,['/rental/v1/enterprise-handoff-requests?page=1','/rental/v1/enterprise-handoff-requests?page=2']);identity='merchant-two';hooks.rerender();await assert.rejects(locate.props.onAction());assert.equal(located.length,1);allowed=false;await assert.rejects(button('读取首个受权订单页').props.onAction());assert.equal(reads.length,2);hooks.unmount();
});
