// 多租户识别纯逻辑专项：一套部署服务多个租户，靠 resolveSite 从参数/域名/环境变量解析当前租户。
// 用 node --test 直接跑（import.meta.env 在 node 下为 undefined，已用可选链兜底）。
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modUrl = pathToFileURL(path.join(__dirname, '..', 'apps/tenant-website/src/data/resolveTenant.ts')).href;

test('原预约交接：默认零读取、人工继续复验、上下文/卸载隔离且不创建报价', async () => {
  const url = pathToFileURL(path.join(__dirname, '..', 'apps/tenant-website/src/features/ai-native/booking-handoff.ts')).href;
  const { createBookingHandoffConsumer, handoffLocalInput, readOriginalBookingQuote } = await import(url);
  const value = {
    contractVersion: 'ain-booking-draft-1', handoffRef: 'synthetic-ref', bookingDraftId: 'synthetic-draft', revision: 1,
    audience: 'customer', surface: 'tenant_website', scope: { kind: 'workspace', tenantId: 't', workspaceId: 'w' },
    expiresAt: '2030-01-02T00:00:00Z', actionCode: 'OPEN_BOOKING', submission: 'original_booking_page_required', inventory: 'not_reserved',
    fields: { quoteId: 'original-quote', timeZone: 'Asia/Shanghai', startAt: '2030-01-03T00:00:00Z', endAt: '2030-01-04T00:00:00Z',
      fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'loc', bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false },
      lines: [{ itemGroupId: 'p', quantity: 2 }] },
  };
  let reads = 0;
  const host = { enabled: true, capability: { tenantCode: 'tenant', workspaceCode: 'space', customerId: 'customer', tenantId: 't', workspaceId: 'w', releaseRevision: 'r1' },
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
  let submits = 0, receipts = 0, finish;
  const submitting = createBookingHandoffConsumer({ ...host,
    acceptBookingSubmission: async () => accepted,
    submitAcceptedBooking: input => {
      submits++; assert.equal(input.decision, 'submit_original_booking'); assert.equal(input.acceptanceRef, accepted.acceptanceRef);
      return new Promise(resolve => { finish = resolve; });
    }, readBookingSubmission: async input => { receipts++; assert.equal(input.acceptanceRef, accepted.acceptanceRef); return receipt; }
  }, context, s => states.push(s), clock);
  await submitting.submit(); assert.equal(submits, 0, 'selection is not explicit submission');
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
