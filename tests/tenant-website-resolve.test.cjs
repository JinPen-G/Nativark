// 多租户识别纯逻辑专项：一套部署服务多个租户，靠 resolveSite 从参数/域名/环境变量解析当前租户。
// 用 node --test 直接跑（import.meta.env 在 node 下为 undefined，已用可选链兜底）。
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modUrl = pathToFileURL(path.join(__dirname, '..', 'apps/tenant-website/src/data/resolveTenant.ts')).href;

test('原订单事实：网站白名单、零与未知、原订单绑定', async () => {
  const { customerOrderFacts } = await import(pathToFileURL(path.join(__dirname,
    '../apps/tenant-website/src/features/ai-native/customer-order-facts.ts')).href);
  const order = { id: 'own-order', status: 'pending', currency: 'CNY', finalPayableAmount: 0,
    depositAmount: 0, preAuthAmount: null, updatedAt: '2030-01-01T00:00:00Z', customerName: 'private', internalNote: 'secret' };
  const facts = customerOrderFacts(order, order.id);
  assert.equal(facts.receivable, '0 CNY'); assert.equal(facts.preAuth, '未知');
  assert.equal(facts.paid.startsWith('未知'), true); assert.equal(customerOrderFacts(order, 'other'), null);
  assert.equal(customerOrderFacts({ ...order, finalPayableAmount: NaN }, order.id).receivable, '未知');
  assert.equal(JSON.stringify(facts).includes('private'), false); assert.equal(JSON.stringify(facts).includes('secret'), false);
});

test('原订单页面：实际hook逻辑切上下文首次渲染清旧事实、迟到读取隔离', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
  const { customerOrderFacts } = await import(pathToFileURL(path.join(__dirname,
    '../apps/tenant-website/src/features/ai-native/customer-order-facts.ts')).href);
  let cursor = 0, orderId = 'A', session = {}, tree;
  const slots = [], pendingEffects = [], requests = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, v => { slots[i].value = v; }]; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) {
      const old = slots[i]; slots[i] = { deps }; pendingEffects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
    } }
  };
  const jsx = (type, props) => ({ type: typeof type === 'string' ? type : 'component', props });
  const imports = { react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { Link: 'link', useParams: () => ({ orderId }) },
    '@ant-design/icons': {}, '../SiteContext': { useSite: () => ({ tenant: {}, tenantCode: 'tenant',
      href: v => v, isRemote: true, language: 'zh', t: v => v }) },
    '../AuthContext': { useAuth: () => ({ isAuthenticated: true, session, currentWorkspace: { workspaceCode: 'space' } }) },
    '../data/authClient': { sessionApi: { order: id => new Promise(resolve => requests.push({ id, resolve })), paymentCapabilities: async () => ({ methods: [] }) } },
    '../data/siteRepository': {}, '../components/Img': {}, '../features/ai-native/customer-order-facts': { customerOrderFacts } };
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../apps/tenant-website/src/pages/OrderPages.tsx'), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: key => { assert.ok(Object.hasOwn(imports, key), key); return imports[key]; } });
  const render = (commit = true) => { cursor = 0; tree = module.exports.OrderDetailPage(); if (commit) while (pendingEffects.length) pendingEffects.shift()(); return JSON.stringify(tree); };
  const order = id => ({ id, orderNo: `order-${id}`, status: 'pending', currency: 'CNY', finalPayableAmount: 0 });
  render(); requests[0].resolve(order('A')); await new Promise(resolve => setImmediate(resolve));
  assert.ok(render().includes('原订单事实（非AI回答）'));
  orderId = 'B'; assert.equal(render(false).includes('order-A'), false, 'first new render cannot reuse old owner');
  render(); orderId = 'A'; session = {}; render();
  requests[1].resolve(order('B')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(render().includes('order-B'), false);
  requests[2].resolve(order('A')); await new Promise(resolve => setImmediate(resolve));
  assert.ok(render().includes('原订单事实（非AI回答）'));
  for (const slot of slots) slot?.cleanup?.();
  assert.equal(requests.length, 3, 'only original order reads, no AI request or business action');
});

test('原预约交接：默认零读取、人工继续复验、上下文/卸载隔离且不创建报价', async () => {
  const url = pathToFileURL(path.join(__dirname, '..', 'apps/tenant-website/src/features/ai-native/booking-handoff.ts')).href;
  const { createBookingHandoffConsumer, handoffLocalInput, readOriginalBookingQuote, normalizeBookingAcceptanceObservation } = await import(url);
  const value = {
    contractVersion: 'ain-booking-draft-1', handoffRef: '22222222-2222-4222-8222-222222222222', bookingDraftId: '33333333-3333-4333-8333-333333333333', revision: 1,
    audience: 'customer', surface: 'tenant_website', scope: { kind: 'workspace', tenantId: 't', workspaceId: 'w' },
    expiresAt: '2030-01-02T00:00:00Z', actionCode: 'OPEN_BOOKING', submission: 'original_booking_page_required', inventory: 'not_reserved',
    fields: { quoteId: 'original-quote', timeZone: 'Asia/Shanghai', startAt: '2030-01-03T00:00:00Z', endAt: '2030-01-04T00:00:00Z',
      fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'loc', bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false },
      lines: [{ itemGroupId: 'p', quantity: 2 }] },
  };
  let reads = 0;
  const host = { enabled: true, mode: 'interactive', capability: { tenantCode: 'tenant', workspaceCode: 'space', customerId: 'customer', tenantId: 't', workspaceId: 'w', releaseRevision: 'r1' },
    handoffRef: value.handoffRef, readBookingHandoff: async () => { reads++; return structuredClone(value); } };
  const context = { tenantCode: 'tenant', workspaceCode: 'space', customerId: 'customer', authenticated: true, productId: 'p' };
  const states = [];
  const clock = () => Date.parse('2030-01-01T00:00:00Z');
  const disabled = createBookingHandoffConsumer(null, context, () => {}, clock);
  await disabled.read(); await disabled.continue(); assert.equal(reads, 0);
  const consumer = createBookingHandoffConsumer(host, context, s => states.push(s), clock);
  assert.equal(reads, 0, 'mount/import must not read');
  assert.equal((await consumer.read()).fields.quoteId, 'original-quote');
  assert.equal((await consumer.continue()).revision, 1); assert.equal(reads, 2);
  assert.equal(states.at(-1).status, 'continued');
  assert.equal(handoffLocalInput(value.fields.startAt, value.fields.timeZone), '2030-01-03T08:00');
  value.revision = 2;
  assert.equal(await consumer.continue(), null); assert.equal(states.at(-1).status, 'unavailable');
  const other = createBookingHandoffConsumer(host, { ...context, workspaceCode: 'other' }, () => {}, clock);
  const before = reads; await other.read(); assert.equal(reads, before);
  let resolve;
  const delayed = createBookingHandoffConsumer({ ...host, readBookingHandoff: () => { reads++; return new Promise(r => { resolve = r; }); } }, context, s => states.push(s), clock);
  const pending = delayed.read(); assert.equal(await delayed.read(), null, 'single flight');
  delayed.destroy(); const count = states.length; resolve(value); assert.equal(await pending, null); assert.equal(states.length, count);
  const failing = createBookingHandoffConsumer({ ...host, readBookingHandoff: () => { throw Error('private detail'); } }, context, s => states.push(s), clock);
  assert.equal(await failing.read(), null); assert.deepEqual(states.at(-1), { status: 'unavailable', handoff: null });
  const expired = createBookingHandoffConsumer({ ...host, readBookingHandoff: async () => ({ ...value, expiresAt: '2020-01-01T00:00:00Z' }) }, context, s => states.push(s), clock);
  assert.equal(await expired.read(), null); assert.equal(states.at(-1).handoff, null);
  value.revision = 1;
  const accepted = { acceptanceRef: '11111111-1111-4111-8111-111111111111', handoffRef: value.handoffRef,
    bookingDraftId: value.bookingDraftId, selectionRevision: 1, inputFingerprint: 'a'.repeat(64), quoteId: value.fields.quoteId,
    operationKey: 'booking-order:original', execution: 'not_attested' };
  const receipt = { state: 'observed', orderId: 'original-order', operationKey: accepted.operationKey,
    retryable: false, payment: 'not_inferred', fulfillment: 'not_inferred' };
  let submits = 0, receipts = 0, accepts = 0, finish;
  const submitting = createBookingHandoffConsumer({ ...host,
    acceptBookingSubmission: async () => { accepts++; return accepted; },
    submitAcceptedBooking: input => {
      submits++; assert.equal(input.decision, 'submit_original_booking'); assert.equal(input.acceptanceRef, accepted.acceptanceRef);
      return new Promise(resolve => { finish = resolve; });
    }, readBookingSubmission: async input => { receipts++; assert.equal(input.acceptanceRef, accepted.acceptanceRef); return receipt; }
  }, context, s => states.push(s), clock);
  await submitting.submit(); assert.equal(submits, 0, 'selection is not explicit submission');
  await submitting.reconcile(); assert.equal(accepts, 0, 'receipt read must not create an acceptance');
  await submitting.read(); await submitting.continue(); await submitting.accept(); assert.equal(states.at(-1).status, 'accepted');
  const sent = submitting.submit(); await submitting.submit(); assert.equal(submits, 1);
  submitting.pause(); const pausedCount = states.length; finish(receipt); await sent;
  assert.equal(states.length, pausedCount, 'hidden late result cannot restore old content');
  submitting.resume(); await submitting.reconcile(); assert.equal(receipts, 1); assert.equal(states.at(-1).status, 'order_observed');
  await submitting.submit(); assert.equal(submits, 1, 'original receipt recovery never resends');
  submitting.destroy(); const destroyedCount = states.length; await submitting.reconcile(); assert.equal(states.length, destroyedCount);
  const absent = createBookingHandoffConsumer({ ...host, acceptBookingSubmission: async () => accepted,
    submitAcceptedBooking: async () => { throw Error('private detail'); },
    readBookingSubmission: async () => ({ ...receipt, state: 'not_observed', orderId: null })
  }, context, s => states.push(s), clock);
  await absent.read(); await absent.continue(); await absent.accept(); await absent.submit();
  assert.equal(states.at(-1).status, 'pending_reconcile'); assert.equal(states.at(-1).handoff, null);
  await absent.reconcile(); assert.equal(states.at(-1).status, 'pending_reconcile'); assert.equal(states.at(-1).receipt.retryable, false);
  const originalQuote = { id: value.fields.quoteId, tenantId: 't', expiresAt: value.expiresAt,
    request: { ...value.fields, customerId: 'customer', customerType: 'personal' },
    payableAmount: 12, depositAmount: 0, preAuthAmount: 0, currency: 'CNY', ruleVersion: 'rules-1', pricingPlanVersion: 'prices-1',
    internalReview: 'never forwarded' };
  const quoteFacts = await readOriginalBookingQuote(value, 'customer', async id => { assert.equal(id, originalQuote.id); return originalQuote; }, clock);
  assert.equal(quoteFacts.payableAmount, 12); assert.equal(quoteFacts.depositAmount, 0); assert.equal(quoteFacts.internalReview, undefined);
  assert.equal(await readOriginalBookingQuote(value, 'other', async () => originalQuote, clock), null);
  assert.equal(await readOriginalBookingQuote(value, 'customer', async () => ({ ...originalQuote, expiresAt: '2000-01-01T00:00:00Z' }), clock), null);
  {

  const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
  const capability = { contractVersion: 'ain-client-host-capabilities-2', enabled: true, audience: 'customer',
    surface: 'tenant_website', channel: 'web', customerId: 'customer', customerType: 'personal',
    tenantCode: 'tenant', serviceCode: 'space', scope: { kind: 'workspace', tenantId: 't', workspaceId: 'w' },
    policy: { revision: 1, allowRead: true, allowCreate: true }, releaseRevision: 'r1',
    observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
    capabilities: { entryActions: ['CREATE_BOOKING_DRAFT', 'OPEN_BOOKING'], bookingDrafts: true, savedDeliveryAddresses: false, bookingReceiptRead: true },
    authorization: 'observation_only_recheck_each_action' };
  const events = new Map(), document = { hidden: false, addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) };
  const calls = []; let hold = false, finish, hostSubmitCalls = 0, holdSubmission = false, finishSubmission;
  const response = data => ({ ok: true, status: 200, json: async () => ({ data: structuredClone(data) }) });
  const fetch = async (address, init) => {
    calls.push(address); assert.equal(init.method, 'POST'); assert.equal(init.headers.get('Authorization'), 'Bearer synthetic-session');
    if (address === '/api/client/v1/ai-native/entry/host-capabilities/read') {
      assert.equal(init.body, '{}'); if (hold) return new Promise(resolve => { finish = () => resolve(response(capability)); });
      return response(capability);
    }
    if (address.endsWith('/booking-submissions/accept')) {
      assert.deepEqual(JSON.parse(init.body), { handoffRef: value.handoffRef }); return response(accepted);
    }
    if (address.endsWith('/booking-submissions/submit')) {
      hostSubmitCalls++; assert.deepEqual(JSON.parse(init.body), { acceptanceRef: accepted.acceptanceRef, decision: 'submit_original_booking' });
      if (holdSubmission) return new Promise(resolve => { finishSubmission = () => resolve(response(receipt)); });
      return response({ ...receipt, state: 'unknown', orderId: null });
    }
    if (address.endsWith('/booking-submissions/read')) {
      assert.deepEqual(JSON.parse(init.body), { acceptanceRef: accepted.acceptanceRef }); return response(receipt);
    }
    assert.equal(address, '/api/client/v1/ai-native/entry/booking-handoffs/read');
    assert.deepEqual(JSON.parse(init.body), { handoffRef: value.handoffRef }); return response(value);
  };
  const load = (file, imports) => {
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../apps/tenant-website/src', file), 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, { module, exports: module.exports, require: name => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency ${name}`); return imports[name];
    }, fetch, Headers, document, Date, structuredClone });
    return module.exports;
  };
  const auth = load('data/authClient.ts', { './apiClient': { API_BASE: '' } });
  let session = { accessToken: 'synthetic-session', customer: { customerId: 'customer', customerType: 'personal' }, workspace: { workspaceCode: 'space' } };
  auth.configureAuthBridge({ getSession: () => session, setSession: next => { session = next; } });
  const { createBookingHandoffHostFactory: factory } = load('features/ai-native/booking-host.factory.ts', { '../../data/authClient': auth,
    './booking-handoff': { normalizeBookingAcceptanceObservation } });
  const publication = { tenantCode: 'tenant', serviceCode: 'space', scope: capability.scope, releaseRevision: 'r1' };
  assert.equal(await factory().openFromUser(value.handoffRef), null); assert.equal(calls.length, 0);
  const owner = factory(publication); assert.equal(calls.length, 0);
  const trusted = await owner.openFromUser(value.handoffRef); assert.ok(trusted?.enabled);
  assert.equal(trusted.capability.workspaceCode, 'space'); assert.equal(typeof trusted.submitAcceptedBooking, 'function');
  assert.equal(JSON.stringify(trusted).includes('synthetic-session'), false);
  assert.equal((await trusted.readBookingHandoff({ handoffRef: value.handoffRef })).handoffRef, value.handoffRef);
  assert.equal(calls.length, 4, 'explicit action rechecks capabilities before and after the handoff read');
  capability.contractVersion = 'ain-client-host-capabilities-1';
  assert.equal(await factory(publication).openFromUser(value.handoffRef), null);
  capability.contractVersion = 'ain-client-host-capabilities-2';
  const receiptOnly = structuredClone(capability);
  capability.policy.allowCreate = false; capability.capabilities = { entryActions: [], bookingDrafts: false, savedDeliveryAddresses: false, bookingReceiptRead: true };
  const readOnly = await factory(publication, 'receipt_only').openFromUser(value.handoffRef);
  assert.ok(readOnly?.enabled); assert.equal(readOnly.mode, 'receipt_only'); assert.equal(readOnly.submitAcceptedBooking, undefined);
  Object.assign(capability, receiptOnly);
  assert.equal((await trusted.acceptBookingSubmission({ handoffRef: value.handoffRef })).acceptanceRef, accepted.acceptanceRef);
  const decision = { acceptanceRef: accepted.acceptanceRef, decision: 'submit_original_booking' };
  const sentFromHost = trusted.submitAcceptedBooking(decision);
  await assert.rejects(async () => trusted.submitAcceptedBooking(decision));
  assert.equal((await sentFromHost).state, 'unknown'); assert.equal(hostSubmitCalls, 1);
  await assert.rejects(async () => trusted.submitAcceptedBooking(decision));
  assert.equal((await trusted.readBookingSubmission({ acceptanceRef: accepted.acceptanceRef })).state, 'observed');
  assert.equal(hostSubmitCalls, 1);
  const lateOwner = factory(publication), lateHost = await lateOwner.openFromUser(value.handoffRef);
  await lateHost.acceptBookingSubmission({ handoffRef: value.handoffRef }); holdSubmission = true;
  const lateSubmit = lateHost.submitAcceptedBooking(decision), lateRejected = assert.rejects(lateSubmit);
  await new Promise(resolve => setImmediate(resolve)); lateOwner.hide(); finishSubmission();
  await lateRejected; assert.equal(lateHost.enabled, false); holdSubmission = false;
  capability.policy.revision++;
  await assert.rejects(trusted.readBookingHandoff({ handoffRef: value.handoffRef })); assert.equal(trusted.enabled, false);
  capability.policy.revision--; assert.equal(await owner.openFromUser(value.handoffRef), null);
  const logoutHost = await factory(publication).openFromUser(value.handoffRef), prior = session;
  session = null; assert.equal(logoutHost.enabled, false); session = prior; assert.equal(logoutHost.enabled, false);
  hold = true;
  const hidden = factory(publication), pendingOpen = hidden.openFromUser(value.handoffRef);
  document.hidden = true; events.get('visibilitychange')(); finish(); assert.equal(await pendingOpen, null);
  document.hidden = false; hold = false; assert.equal(await hidden.openFromUser(value.handoffRef), null);
  capability.enabled = false; assert.equal(await factory(publication).openFromUser(value.handoffRef), null); capability.enabled = true;
  capability.expiresAt = '2020-01-01T00:00:00Z'; assert.equal(await factory(publication).openFromUser(value.handoffRef), null);

  }
});

test('tenantCodeFromHost：只认配置的基础域名的直接子域，保留字/裸域/客户域名返回 null', async () => {
  const { tenantCodeFromHost } = await import(modUrl);
  assert.equal(tenantCodeFromHost('guangying.rentalos.com', 'rentalos.com'), 'guangying');
  assert.equal(tenantCodeFromHost('shanye.rentalos.com:443', 'rentalos.com'), 'shanye');
  assert.equal(tenantCodeFromHost('www.rentalos.com', 'rentalos.com'), null, 'www 是保留子域');
  assert.equal(tenantCodeFromHost('api.rentalos.com', 'rentalos.com'), null, 'api 是保留子域');
  assert.equal(tenantCodeFromHost('rentalos.com', 'rentalos.com'), null, '裸域不是租户');
  assert.equal(tenantCodeFromHost('other.com', 'rentalos.com'), null, '非基础域名不认');
  assert.equal(tenantCodeFromHost('localhost', 'rentalos.com'), null);
  assert.equal(tenantCodeFromHost('127.0.0.1', 'rentalos.com'), null);
  // 未配基础域名时一律 null，把客户自定义域名交给后端反查，不再猜最左一段。
  assert.equal(tenantCodeFromHost('demo.example.com', undefined), null);
  assert.equal(tenantCodeFromHost('shop.brand.com', undefined), null);
});

test('resolveSite：演示 > tenantCode > 子域名 > 自定义域名(交后端反查) > 兜底', async () => {
  const { resolveSite } = await import(modUrl);
  const base = { baseDomain: 'rentalos.com', defaultTenant: undefined };
  // 1. 演示形态（三种）显式优先，走本地静态数据。
  assert.deepEqual(resolveSite('?tenant=single', 'guangying.rentalos.com', base), { kind: 'demo', demoKey: 'single' });
  assert.deepEqual(resolveSite('?tenant=double', 'x.rentalos.com', base), { kind: 'demo', demoKey: 'double' });
  // 2. 显式 tenantCode 高于域名（联调/后台跳转）。
  assert.deepEqual(resolveSite('?tenantCode=demo', 'other.rentalos.com', base), { kind: 'remote', tenantCode: 'demo' });
  // 3. 平台子域名：同一份代码，不同子域 = 不同租户。
  assert.deepEqual(resolveSite('', 'guangying.rentalos.com', base), { kind: 'remote', tenantCode: 'guangying' });
  // 4. 客户自定义域名：需后端按 Host 反查，fallback 为演示 multiple。
  assert.deepEqual(resolveSite('', 'www.brand.com', base), { kind: 'host', host: 'www.brand.com', fallback: { kind: 'demo', demoKey: 'multiple' } });
  // 5. 单租户部署：VITE_DEFAULT_TENANT 兜底（本地地址不反查，直接兜底到该租户）。
  assert.deepEqual(resolveSite('', 'localhost:4186', { baseDomain: 'rentalos.com', defaultTenant: 'demo' }), { kind: 'remote', tenantCode: 'demo' });
  // 6. 平台裸域名（无参数）→ 兜底演示 multiple，不当作自定义域名反查。
  assert.deepEqual(resolveSite('', 'rentalos.com', base), { kind: 'demo', demoKey: 'multiple' });
  // 7. 自定义域名但配了默认租户 → host 反查，fallback 为该默认租户。
  assert.deepEqual(resolveSite('', 'shop.brand.com', { baseDomain: 'rentalos.com', defaultTenant: 'demo' }), { kind: 'host', host: 'shop.brand.com', fallback: { kind: 'remote', tenantCode: 'demo' } });
});
