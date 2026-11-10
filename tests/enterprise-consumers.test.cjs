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
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name === 'node:async_hooks') return require(name);
      throw new Error(`Unexpected runtime import in ${relative}: ${name}`);
    }, console, Date, Map, Set, JSON, Error, Promise, structuredClone, ...globals,
  }, { filename: source.filename, timeout: 1000 });
  return module.exports;
}
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
  receipt = { state: 'committed', result: { id: 'application-1' } }; await hooks.value.recover(async () => {}); hooks.flush(); assert.equal(storage.size, 0); assert.equal(writes.length, 1);
  hooks.unmount(); const first = create(), second = create(); hooks.mount(() => [first.useOriginalEnterpriseOperation(), second.useOriginalEnterpriseOperation()]);
  await Promise.allSettled(hooks.value.map(operation => operation.run(command, async () => {}))); assert.equal(writes.length, 2); assert.equal(storage.size, 1);
  assert.equal(reads.length, 2);
  hooks.unmount(); storage.clear();
  for (const commandPath of ['/membership/corporate/company-1/enterprise-portal', '/membership/enterprise-portal/settings', '/membership/enterprise-workflows/corporates/company-1/policy']) {
    module = create(); hooks.mount(() => module.useOriginalEnterpriseOperation('portal-access:company-1', '/membership/enterprise-portal/operations'));
    const before = writes.length; receipt = { state: 'not_recorded' };
    await assert.rejects(hooks.value.run(() => ({ path: commandPath, method: 'put', input: { expectedRevision: 1, reason: 'reviewed' } }), async () => {}));
    assert.equal(writes.length, before + 1); hooks.unmount(); epoch++; module = create();
    hooks.mount(() => module.useOriginalEnterpriseOperation('portal-access:company-1', '/membership/enterprise-portal/operations'));
    assert.equal(hooks.value.blocked, true); await assert.rejects(hooks.value.recover(async () => {})); assert.equal(writes.length, before + 1);
    receipt = { state: 'committed', result: {} }; let recovered;
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
  owner.read = async path => { reads.push(path); return { state: 'committed', result: {} }; };
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
  const row = { id: 'request-1', corporateCustomerId: 'company', requestType: 'profile_change', state: 'draft', revision: 1, objectRevision: 'original-r1', proposal: { legalName: 'Proposed name' }, reason: 'Original reason', evidenceFileIds: [] };
  const form = { resetFields() { for (const key of Object.keys(values)) delete values[key]; }, setFieldsValue(next) { Object.assign(values, next); }, getFieldValue(key) { return values[key]; }, setFieldValue(key, value) { values[key] = value; }, validateFields: async () => ({ ...values }) };
  const operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('query substitute must not dispatch'),
    async run(prepare, afterCommit) { const command = await prepare(); commands.push(plain(command)); if (command.input.objectRevision !== profile.profileRevision) throw new Error('original object revision conflict'); await afterCommit({}); } };
  const query = data => ({ data, isFetching: false, refetch: async () => ({ data }) });
  const Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
  const module = load('apps/enterprise-portal/src/ManagementRequestsPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: options => query(options.queryKey[0] === 'enterprise-profile' ? profile : [row]) },
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
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

check('Policy editor preserves reviewed bounds and refuses a stale save after any policy revision changes', async () => {
  const hooks = reactHost(), values = {}, writes = [], context = { identity: 'policy-owner', tenantCode: 'merchant', selectedCorporateId: 'company', signal: new AbortController().signal,
    entry: { corporates: [{ corporateCustomerId: 'company', actions: ['policy:manage'] }] } };
  const query = { data: { revision: 1, merchantRevision: 1, companyRevision: 1, employeeRevision: 0, merchant: { workspaceIds: ['w1'], categoryCodes: ['vehicle'] }, company: { workspaceIds: ['w1'], categoryCodes: ['vehicle'] }, workspaces: [], effectiveWorkspaceIds: ['w1'], effectiveCategoryCodes: ['vehicle'] },
    isFetching: false, refetch: async () => ({}) };
  const form = { resetFields() { for (const key of Object.keys(values)) delete values[key]; }, setFieldsValue: next => Object.assign(values, next), validateFields: async () => ({ ...values }) }, Form = Object.assign('form', { useForm: () => [form] });
  const operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('query host dispatch'), async run(prepare, afterCommit) { writes.push(plain(await prepare())); await afterCommit({}); } };
  const module = load('apps/enterprise-portal/src/PolicyPage.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, '@tanstack/react-query': { useQuery: options => options.queryKey[0] === 'enterprise-policy' ? query : { data: undefined } },
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, SaveButton: 'save', Select: 'select' },
    '@/components/EnterprisePolicyFields': { EnterprisePolicyFields: 'policy-fields', enterprisePolicyValues: policy => plain(policy), enterprisePolicyPayload: value => plain(value) },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': { useOriginalWorkflowOperation: () => operation } });
  hooks.mount(() => module.EnterprisePolicyPage());
  const edit = () => nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Edit policy');
  await hooks.act(() => edit().props.onClick()); values.reason = 'Unsaved narrowing';
  query.data = { ...query.data, merchantRevision: 2, merchant: { workspaceIds: [], categoryCodes: [] } }; hooks.rerender();
  const save = () => nodes(hooks.value).find(n => n.type === 'save'); assert.equal(save().props.disabled, true); assert.equal(values.reason, 'Unsaved narrowing');
  const fields = nodes(hooks.value).find(n => n.type === 'policy-fields'); assert.equal(fields.props.view.merchantRevision, 1, 'editor is based on original reviewed bounds');
  await assert.rejects(save().props.onSave(), /修订/u); assert.equal(writes.length, 0);
  await hooks.act(() => nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Cancel').props.onClick());
  await hooks.act(() => edit().props.onClick()); values.reason = 'Reviewed latest limits'; await save().props.onSave(); assert.equal(writes.length, 1); assert.equal(writes[0].input.expectedRevision, 1);
});

check('Join review binds one original request and revision; invitation material is whitelisted and transfer has an explicit decline', async () => {
  const hooks = reactHost(), commands = [], context = { identity: 'review-owner', selectedCorporateId: 'company', basePath: '/merchant/enterprise', loading: false, signal: new AbortController().signal, reload() {} };
  const rows = [{ id: 'join-1', kind: 'join_request', corporateCustomerId: 'company', applicantCustomerId: 'p1', state: 'pending', revision: 1, createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z', payload: { department: 'Original department', employeeNo: '42', noticeText: 'Original acknowledged notice', agreementVersion: 'original-v1', acknowledgedAt: '2026-11-01T12:00:00Z', privateToken: 'must-not-render' } },
    { id: 'join-2', kind: 'join_request', corporateCustomerId: 'company', applicantCustomerId: 'p2', state: 'pending', revision: 2, payload: {} }];
  const form = { resetFields() {}, setFieldValue() {}, setFieldsValue() {}, getFieldValue() {} }, Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
  const operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('query host must not dispatch'), async run(prepare, afterCommit) { const command = await prepare(); commands.push(plain(command)); await afterCommit({}); } };
  const review = load('apps/enterprise-portal/src/WorkflowReview.tsx', { 'react/jsx-runtime': hooks.jsx });
  const module = load('apps/enterprise-portal/src/WorkflowPages.tsx', { react: hooks.runtime, 'react/jsx-runtime': hooks.jsx,
    '@tanstack/react-query': { useQuery: options => ({ data: options.queryKey[0] === 'enterprise-own-relations' ? [] : rows, isFetching: false, refetch: async () => ({ data: rows }) }) },
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Table: 'table' },
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
  await nodes(actions(rows[1])).find(n => n.props.label === 'Approve').props.onAction(); assert.equal(commands[0].input.expectedRevision, 3); assert.equal(commands[0].path, '/enterprise/corporates/company/join-requests/join-2/decision');
  hooks.unmount(); rows.splice(0, rows.length, { ...rows[0], id: 'transfer-1', kind: 'administrator_transfer', payload: { fromCustomerId: 'outgoing', targetMembershipId: 'target-relation' } });
  hooks.mount(() => module.EnterpriseJoinPage());
  const table = nodes(hooks.value).find(n => n.type === 'table' && n.props.rowKey === 'id'), transferActions = table.props.columns.find(c => c.title === 'Actions').render(null, rows[0]);
  const decline = nodes(transferActions).find(n => n.props.label === 'Decline transfer'); assert.ok(decline); await decline.props.onAction();
  assert.equal(commands[1].input.accept, false); assert.equal(commands[1].path, '/enterprise/transfers/transfer-1/decision');
});

check('Member and administrator editors keep the reviewed relation revision and reject stale saves without resetting unsaved values', async () => {
  for (const kind of ['member', 'administrator']) {
    const hooks = reactHost(), values = {}, writes = [];
    const context = { identity: 'member-owner', selectedCorporateId: 'company', entry: { corporates: [{ corporateCustomerId: 'company', membershipId: 'actor-member', actions: ['members:manage', 'administrators:manage'] }] } };
    let member = { membershipId: 'target-member', role: 'employee', status: 'active', updatedAt: 'original-r1', displayName: 'Member' };
    const query = { data: { membershipId: 'target-member', role: 'employee', actions: [], updatedAt: 'original-r1', revision: 1 }, isFetching: false, refetch: async () => ({}) };
    const form = { resetFields() { for (const key of Object.keys(values)) delete values[key]; }, setFieldsValue: next => Object.assign(values, next), setFieldValue: (key, value) => { values[key] = value; }, validateFields: async () => ({ ...values }) };
    const operation = { blocked: false, busy: false, assertCurrent() {}, read: forbidden('query substitute reads'), run: async (prepare, afterCommit) => { const command = await prepare(); writes.push(plain(command)); await afterCommit({}); } };
    const Form = Object.assign('form', { useForm: () => [form], Item: 'field' });
    const module = load(kind === 'member' ? 'apps/enterprise-portal/src/MemberLifecycle.tsx' : 'apps/enterprise-portal/src/AdministratorEditor.tsx', {
      react: hooks.runtime, 'react/jsx-runtime': hooks.jsx, '@tanstack/react-query': { useQuery: () => query },
      '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Button: 'button', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select' },
      './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': { useOriginalWorkflowOperation: () => operation } });
    hooks.mount(() => kind === 'member' ? module.EnterpriseMemberLifecycle({ member, english: true, refresh: async () => {} }) : module.EnterpriseAdministratorEditor({ member, english: true, refresh: async () => {} }));
    const opener = () => nodes(hooks.value).find(n => n.type === 'button' && text(n) === (kind === 'member' ? 'Edit relation' : 'Administrator authority'));
    await hooks.act(() => opener().props.onClick()); values.reason = 'Unsaved reviewed reason'; values.department = 'Unsaved department';
    member = { ...member, updatedAt: 'current-r2' }; query.data = { ...query.data, updatedAt: 'current-r2', revision: 2 }; hooks.rerender();
    const save = () => nodes(hooks.value).find(n => n.type === 'save');
    assert.equal(save().props.disabled, true, kind); assert.equal(values.reason, 'Unsaved reviewed reason', kind);
    await assert.rejects(save().props.onSave(), /修订|revision/u); assert.equal(writes.length, 0, kind);
    const cancel = nodes(hooks.value).find(n => n.type === 'button' && text(n) === 'Cancel'); await hooks.act(() => cancel.props.onClick());
    await hooks.act(() => opener().props.onClick()); values.reason = 'Reviewed current relation'; await save().props.onSave();
    assert.equal(writes.length, 1, kind); assert.equal(writes[0].input.expectedUpdatedAt, 'current-r2');
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
    '@/components/ui/customer-entry': { ActionButton: 'action', Alert: 'alert', Checkbox: 'checkbox', Form, Input: Object.assign('input', { TextArea: 'textarea' }), SaveButton: 'save', Select: 'select', Table: 'table' },
    '@/app/locale': { useLocale: () => ({ locale: 'en-US' }) }, './enterprise-session': { useEnterprise: () => context }, './original-workflow-operation': { useOriginalWorkflowOperation: () => operation } });
  hooks.mount(() => module.EnterpriseExtensionApprovalsPage());
  const recover = () => nodes(hooks.value).find(n => n.type === 'action' && n.props.label === 'Read original operation');
  await assert.rejects(recover().props.onAction(), /unresolved/u); assert.equal(complete, false);
  result = { approval: { ...row, state: 'consumed', extensionId: 'ext1' }, original: { state: 'observed', extensionId: 'wrong', extensionState: 'pending_payment', retryable: false }, retryable: false };
  await assert.rejects(recover().props.onAction(), /unresolved/u); assert.equal(complete, false);
  result.original.extensionId = 'ext1'; await recover().props.onAction(); assert.equal(complete, true);
  const submitPending = operation.pending, submitRead = operation.read, submitRecover = operation.recover;
  operation.pending = { key: 'request-key', path: '/enterprise/extension-approvals', originalTarget: 'o1' };
  operation.recover = async after => { await after({ state: 'committed', result: { id: row.id } }, '/enterprise/extension-approvals'); complete = true; };
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
      return { tenantCode: 'merchant', customerId: f.customer, operationScope: JSON.stringify(['merchant', f.customer, f.service]), identity: signature,
        current: () => signature === JSON.stringify([f.customer, f.service, f.version]) };
    };
    const localStorage = { getItem: key => storage.get(key) ?? null,
      setItem(key, value) { if (f.storageMode === 'throw') throw new Error('storage denied'); if (f.storageMode !== 'drop') storage.set(key, value); }, removeItem: key => storage.delete(key) };
    const sessionApi = { enterpriseExtensionEligibility: (...args) => invoke('eligibility', args, eligibility()),
      enterpriseExtensionApprovals: (...args) => invoke('list', args, f.rows), enterpriseExtensionResult: (...args) => invoke('result', args, f.result),
      enterpriseExtensionRequestOriginal: (...args) => invoke('requestOriginal', args, f.receipt.state === 'committed' ? { state: 'observed', approval: f.result.approval, retryable: false } : { state: 'not_recorded', retryable: false }),
      enterpriseOperation: (...args) => invoke('receipt', args, f.receipt), enterpriseCommand: command };
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
      if (url.includes('/extension-request-operations/')) return invoke('requestOriginal', [url], f.receipt.state === 'committed' ? { state: 'observed', approval: f.result.approval, retryable: false } : { state: 'not_recorded', retryable: false });
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
