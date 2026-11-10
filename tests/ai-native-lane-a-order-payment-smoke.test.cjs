'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/order-facts.cjs');
const { PaymentRuntimeService } = require('../apps/api/src/modules/integrations/payment.runtime.service');
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiOrderPaymentFactsService } = require('../apps/api/src/modules/ai-native/tools/order-payment-facts.service');
test('AIN13 financial display preserves record meaning or omits the whole optional row', async () => {
  const h = await createFunding(), payment = await create();
  const at = new Date(h.state.order.updatedAt);
  const intents = ['rental', 'deposit', 'preauthorization'].map((instrument, i) => ({
    id: `financial-${instrument}`, tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', instrument,
    amount: 10 + i, currency: 'CNY', status: i === 2 ? 'pending' : 'paid', provider: 'stripe', method: 'stripe', expiresAt: at }));
  payment.db.rentalPaymentIntent.findMany = async () => structuredClone(intents);
  payment.db.rentalPaymentIntent.findFirst = async query => structuredClone(intents.find(row => row.id === query.where.id));
  payment.db.rentalPaymentRefund.findMany = async query => ['accepted', 'funding_pending', 'failed'].map((status, i) => ({
    id: `${query.where.paymentIntentId}-refund-${i}`, tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a',
    paymentIntentId: query.where.paymentIntentId, amount: 0.01, currency: 'CNY', status, createdAt: at, updatedAt: at }));
  const b = await require('./fixtures/ai-native/lane-a-business-consumption.cjs').setup();
  const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
  const service = composeAiAuthorizedBusinessTools({ core: h.core, guard: h.guard, credentials: h.credentials,
    funding: h.funding, payments: payment.payments, business: b.business, reports: b.reports, memberships: b.memberships }).orderExplanationPreparation('order-a');
  const packet = await service.prepare({ question: 'payments' });
  const { buildOrderExplanation } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const fingerprint = requestFingerprint(packet.payload), original = structuredClone(h.data), source = packet.payload.facts.fundingLedger.value;
  const complete = buildOrderExplanation(packet), fullBytes = Buffer.byteLength(JSON.stringify(complete), 'utf8');
  // Locate the successful display-only boundary with <=15 pure render calls,
  // rather than guessing a byte ratio that no longer reaches row omission.
  // No additional Guard/source/provider reads or Node/test jobs occur here.
  let lower = 1, upper = fullBytes;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    try { buildOrderExplanation(packet, middle); upper = middle; }
    catch (error) { assert.match(error.message, /AI_RESOURCE_UNAVAILABLE/u); lower = middle + 1; }
  }
  const cap = lower, limited = buildOrderExplanation(packet, cap);
  assert.ok(Buffer.byteLength(JSON.stringify(limited), 'utf8') <= cap); assert.ok(limited.text.includes('整条记录省略'));
  const all = new Map(complete.claims.map(row => [row.field, row])), shown = new Map(limited.claims.map(row => [row.field, row]));
  const records = [
    ...packet.payload.facts.payments.value.intents.map(row => ({ prefix: `payments.${row.intentId}.`, fields: ['status', 'instrument'], id: row.intentId, label: '支付单 ' })),
    ...packet.payload.facts.payments.value.refunds.map(row => ({ prefix: `refunds.${row.refundId}.`, fields: ['status', 'paymentIntentId'], id: row.refundId, label: '退款单 ' })),
    ...source.events.map(row => ({ prefix: `funding.${row.id}.`, fields: ['instrument', 'action', 'amount', 'accounting'], id: row.id })),
    ...source.offlineRegistrations.map(row => ({ prefix: `offline.${row.id}.`, fields: ['status', 'amount'], id: row.id }))
  ];
  let displayed = 0, omitted = 0;
  for (const record of records) {
    const visible = limited.claims.filter(row => row.field.startsWith(record.prefix));
    if (visible.length) {
      displayed++;
      for (const suffix of record.fields) {
        const field = record.prefix + suffix; assert.ok(shown.has(field), `${field}: never leave an ambiguous partial financial record`);
        assert.deepEqual(shown.get(field), all.get(field), 'retain exact source/value, not an inferred paid/accounting state');
      }
      if (record.label) {
        const amount = shown.get(record.prefix + 'amount'), currency = shown.get(record.prefix + 'currency');
        assert.equal(Boolean(amount), Boolean(currency), 'optional payment/refund amount and currency are never split');
        if (amount) { assert.deepEqual(amount, all.get(record.prefix + 'amount')); assert.deepEqual(currency, all.get(record.prefix + 'currency')); }
        const prose = complete.text.split('\n').find(line => line.startsWith(record.label) && line.includes(record.id) && !line.includes(' 状态：'));
        assert.ok(prose); assert.ok(limited.text.includes(prose), 'keep every originally required payment/refund state identity and its local prose');
      }
    } else {
      assert.equal(record.label, undefined, 'payment/refund status identity is mandatory, never a whole-row omission');
      omitted++;
      if (record.label) {
        const prose = complete.text.split('\n').find(line => line.startsWith(record.label) && line.includes(record.id) && !line.includes(' 状态：'));
        assert.ok(prose); assert.equal(limited.text.includes(prose), false, 'an omitted row cannot leave its paid/refund success prose');
      }
    }
  }
  assert.ok(displayed > 0 && omitted > 0, 'keep some records complete and omit others as whole optional rows');
  for (const field of ['amounts.finalPayable', 'amounts.currency', 'funding.currency', 'funding.rentalCash.collected',
    'funding.rentalCash.refunded', 'funding.rentalCash.netReceived', 'funding.deposit.balance', 'funding.preauthorization.coverage']) {
    assert.deepEqual(shown.get(field), all.get(field), `${field}: original necessary amounts/coverage survive row omission`);
  }
  assert.equal(source.events.find(row => row.id === 'mock-rental').accounting, 'simulation_or_unverified_not_real_funds');
  assert.equal(source.offlineRegistrations[0].status, 'pending');
  assert.equal(requestFingerprint(packet.payload), fingerprint); assert.deepEqual(h.data, original, 'display does not slice or rewrite original financial facts');
  assert.throws(() => buildOrderExplanation(packet, 1), /AI_RESOURCE_UNAVAILABLE/u, 'mandatory original facts never disappear to fit');
  const published = await service.preparePublicV2({ question: 'payments' }), ref = published.payload.facts.fundingLedger.source;
  const reopened = await service.reopenCitationV2({ materialVersion: published.version, question: 'payments', scope: ref.scope,
    resourceType: ref.resourceType, resourceId: ref.resourceId, version: ref.version, field: ref.field });
  assert.equal(reopened.status, 'available'); assert.equal(reopened.value.value.events.length, source.events.length);
  assert.deepEqual(reopened.value.value.deposit, source.deposit); assert.equal(reopened.value.value.preauthorization.coverage, 'unavailable');
  console.log(JSON.stringify({ boundary: 'complete_or_omitted_financial_display', fullBytes, cap, displayed, omitted, sourceEvents: source.events.length }));
});

test('AIN13 original order aggregation payment funding and inspection retain parents before Guard waits', async () => {
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  const { AiOrderInspectionFactsService } = require('../apps/api/src/modules/ai-native/tools/order-inspection-facts.service');
  for (const kind of ['aggregate', 'payment', 'funding', 'inspection']) {
    const h = kind === 'payment' ? await create() : kind === 'funding' ? await createFunding() : await setup();
    const service = kind === 'payment' ? h.service : kind === 'funding' ? h.fundingReader
      : kind === 'inspection' ? new AiOrderInspectionFactsService(h.core, h.authority)
      : new AiOrderExplanationFactsService(h.authority, h.reader);
    const parent = await h.authority.resolve(), originalParent = structuredClone(parent);
    const actor = h.state.user.id, originalOrder = structuredClone(h.state.order);
    const originalFunds = kind === 'funding' ? structuredClone(h.data) : undefined;
    const invoke = expected => kind === 'aggregate' ? service.read(expected, { history: false, payments: false }) : service.read(expected);
    const check = value => {
      assert.equal(value.orderId, 'order-a');
      if (kind === 'funding') {
        assert.equal(value.tenantId, 'tenant-a'); assert.equal(value.workspaceId, 'workspace-a');
        assert.deepEqual(value.rentalCash, { coverage: 'available', collected: 0.3, refunded: 0.1, netReceived: 0.2 });
        assert.equal(value.deposit.balance, 5.01); assert.equal(value.preauthorization.coverage, 'unavailable');
        assert.equal(value.execution, 'not_attempted');
      } else {
        assert.equal(value.scope.tenantId, 'tenant-a'); assert.equal(value.scope.workspaceId, 'workspace-a');
        if (kind === 'aggregate') {
          assert.equal(value.order.value.status, originalOrder.status); assert.equal(value.payments.coverage, 'not_loaded');
          assert.equal(value.history.coverage, 'not_loaded'); assert.equal(value.actualReceivedTotal.coverage, 'not_loaded');
        } else if (kind === 'payment') {
          assert.equal(value.status, 'available'); assert.equal(value.intents[0].status, 'paid');
          assert.deepEqual(value.refunds.map(row => row.status), ['accepted', 'funding_pending', 'succeeded', 'failed']);
          assert.equal(value.totals, 'not_computed'); assert.equal(value.freshness, 'local_records_not_provider_refresh');
        } else {
          assert.equal(value.coverage, 'partial'); assert.equal(value.pageCoverage, 'page_not_total');
          assert.equal(value.attachments, 'not_loaded'); assert.equal(value.execution, 'not_attempted');
        }
      }
      assert.equal(JSON.stringify(value).includes('private-'), false);
    };
    check(await invoke({ ...structuredClone(parent), requestId: 'another-source-observation', authorizedAt: '2020-01-01T00:00:00Z' }));
    const read = h.authority.withOrderRead, beforeReads = h.state.reads.length, beforeQueries = h.queries?.length ?? 0;
    let intercepted = false;
    h.authority.withOrderRead = async function(...args) {
      await Promise.resolve();
      if (!intercepted) {
        intercepted = true;
        // Only this caller-owned original parent and the independent synthetic
        // current user change before the real order Guard. Finance privileges
        // still come from both real Guards, never this assertion or source data.
        parent.actor.userId = 'new-original-fact-reader'; h.state.user.id = parent.actor.userId;
      }
      return read.apply(this, args);
    };
    try {
      await assert.rejects(invoke(parent), error => error.code === 'AI_ACCESS_DENIED', kind);
      assert.equal(intercepted, true); assert.equal(h.state.reads.length, beforeReads);
      assert.equal(h.queries?.length ?? 0, beforeQueries, 'reject before any original financial or source query');
      h.authority.withOrderRead = read;
      const current = await h.authority.resolve(); assert.equal(current.actor.userId, 'new-original-fact-reader');
      check(await invoke(current)); assert.ok(h.state.reads.length > beforeReads);
      h.state.user.id = actor; check(await invoke(originalParent));
      h.state.user.permissions = [];
      await assert.rejects(invoke(originalParent), error => error.code === 'AI_ACCESS_DENIED', 'snapshot cannot survive current withdrawal');
      assert.deepEqual(h.state.order, originalOrder);
      if (kind === 'funding') assert.deepEqual(h.data, originalFunds);
    } finally { h.authority.withOrderRead = read; h.state.user.id = actor; }
  }
});

test('original funding aggregates retain exact cents at the bounded receipt cap', () => {
  const { rentalPaymentBalance } = require('../apps/api/src/modules/rental-core/rental-funding-events');
  const { sumMoney } = require('../apps/api/src/modules/rental-core/rental-money');
  const amounts = Array.from({ length: 200 }, (_, i) => ({ instrument: 'rental', action: i ? 'append' : 'initiate', amount: 9999999999.88 }));
  const expected = 1999999999976;
  assert.equal(rentalPaymentBalance(0, amounts).collected, expected);
  assert.equal(rentalPaymentBalance(0, amounts.map(e => ({ ...e, action: 'refund' }))).refunded, expected);
  assert.equal(rentalPaymentBalance(0, amounts.map(e => ({ ...e, instrument: 'deposit', action: 'capture' }))).securityCaptured, expected);
  assert.equal(sumMoney([0.01, 0.02, -0.01]), 0.02);
  for (const value of [NaN, Infinity, null, undefined, '1']) assert.throws(() => sumMoney([value]), RangeError);
  assert.throws(() => sumMoney([Number.MAX_SAFE_INTEGER]), RangeError);
});

async function create() {
  const h = await setup(), queries = [], at = new Date('2026-10-07T00:00:00Z');
  h.state.user.permissions.push('rental-os:finance:view');
  const db = {
    // Declared original-order binding leaf; never decides authorization.
    rentalOrder: { findFirst: async () => ({ id: 'order-a', updatedAt: at }) },
    rentalPaymentIntent: {
      findMany: async query => { queries.push(query); return [{ id: 'intent-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', instrument: 'rental', provider: 'stripe', method: 'stripe', amount: 0, currency: 'CNY', status: 'paid', expiresAt: at, paidAt: at, checkoutUrl: 'https://do-not-project.invalid', failureReason: 'internal' }]; },
      findFirst: async query => { queries.push(query); return { id: 'intent-a' }; }
    },
    rentalPaymentRefund: { findMany: async query => { queries.push(query); return ['accepted', 'funding_pending', 'succeeded', 'failed'].map((status, index) => ({ id: `refund-${index}`, tenantId: 'tenant-a', workspaceId: 'workspace-a', paymentIntentId: 'intent-a', orderId: 'order-a', amount: 0, currency: 'CNY', status, createdAt: at, updatedAt: at, reason: 'private customer reason', externalRefundId: 'private-provider-id', failureReason: 'raw error' })); } }
  };
  const payments = new PaymentRuntimeService(db, {}, {});
  const routes = new AiBusinessReadRouteAuthority(h.guard, h.credentials);
  return { ...h, db, queries, payments, service: new AiOrderPaymentFactsService(payments, h.core, h.authority, routes) };
}
test('actual payment local read preserves paid/accepted/funding_pending/succeeded/failed and strips sensitive fields', async () => {
  const h = await create(), result = await h.service.read();
  assert.equal(result.intents[0].amount, 0); assert.equal(result.intents[0].status, 'paid');
  assert.deepEqual(result.refunds.map(row => row.status), ['accepted', 'funding_pending', 'succeeded', 'failed']);
  assert.equal(result.fundingLedger, 'not_loaded'); assert.equal(result.totals, 'not_computed');
  const text = JSON.stringify(result); for (const secret of ['checkoutUrl', 'failureReason', 'private customer reason', 'private-provider-id']) assert.equal(text.includes(secret), false);
  for (const query of h.queries) { assert.equal(query.where.tenantId, 'tenant-a'); assert.equal(query.where.workspaceId, 'workspace-a'); assert.equal(query.where.orderId, 'order-a'); }
  assert.deepEqual(h.queries.filter(query => query.take !== undefined).map(query => query.take), [21, 51, 51, 21],
    'same bounded pages reopened once, never an unbounded/provider read');
  for (const name of ['readOrderPaymentIntentsPage', 'readOrderPaymentRefundsPage']) {
    const unavailable = await create(); unavailable.payments[name] = undefined;
    // Missing bounded dependencies are unavailable, not evidence of revoked
    // access. The original authority masks the dependency payload, not its class.
    await assert.rejects(unavailable.service.read(), error => error.message === 'AI_RESOURCE_UNAVAILABLE');
    assert.equal(unavailable.queries.length, 0, 'no legacy query when either bounded capability is missing');
  }
});
test('AIN13 payment/refund observation refuses record and coverage drift across local read waits', async () => {
  for (const kind of ['intent_status', 'intent_empty', 'intent_coverage', 'refund_status', 'refund_empty', 'refund_coverage', 'order_currency']) {
    const h = await create(); let reached = false, intentReads = 0, refundReads = 0;
    const readIntents = h.payments.readOrderPaymentIntentsPage;
    h.payments.readOrderPaymentIntentsPage = async function(...args) {
      intentReads++; return readIntents.call(this, ...args);
    };
    if (kind === 'intent_coverage') {
      const read = h.db.rentalPaymentRefund.findMany;
      h.db.rentalPaymentRefund.findMany = async query => (await read(query)).map(row => ({ ...row,
        id: `${query.where.paymentIntentId}-${row.id}`, paymentIntentId: query.where.paymentIntentId }));
    }
    if (kind === 'intent_coverage' || kind === 'refund_coverage') {
      const leaf = kind === 'intent_coverage' ? h.db.rentalPaymentIntent : h.db.rentalPaymentRefund;
      const read = leaf.findMany, count = kind === 'intent_coverage' ? 20 : 50;
      leaf.findMany = async query => {
        const rows = await read(query);
        return Array.from({ length: count }, (_, i) => ({ ...rows[0], id: `stable-${i}` }));
      };
    }
    const readRefunds = h.payments.readOrderPaymentRefundsPage;
    // Observe the actual bounded Runtime page first, then alter only the
    // declared persisted transport leaf. No provider/Core mutation or retry.
    h.payments.readOrderPaymentRefundsPage = async function(...args) {
      const page = await readRefunds.call(this, ...args); refundReads++;
      if (!reached) {
        reached = true;
        if (kind.startsWith('intent_')) {
          const read = h.db.rentalPaymentIntent.findMany;
          h.db.rentalPaymentIntent.findMany = async query => {
            const rows = await read(query);
            if (kind === 'intent_empty') return [];
            if (kind === 'intent_coverage') return [...rows, { ...rows[0], id: 'intent-extra' }];
            return rows.map(row => ({ ...row, status: 'funding_failed' }));
          };
        } else if (kind.startsWith('refund_')) {
          const read = h.db.rentalPaymentRefund.findMany;
          h.db.rentalPaymentRefund.findMany = async query => {
            const rows = await read(query);
            if (kind === 'refund_empty') return [];
            if (kind === 'refund_coverage') return [...rows, { ...rows[0], id: 'refund-extra' }];
            return rows.map((row, i) => i ? row : { ...row, status: 'closed' });
          };
        } else h.state.order.currency = 'USD';
      }
      return page;
    };
    await assert.rejects(h.service.read(), error => error.message === 'AI_RESOURCE_UNAVAILABLE', kind);
    assert.equal(reached, true, `${kind} must reach the original refund read`);
    if (kind.startsWith('intent_')) assert.equal(intentReads, 2, `${kind} must reach the closing intent page`);
    if (kind.startsWith('refund_')) assert.equal(refundReads, 2, `${kind} must reach the closing refund page`);
  }
  const revoked = await create(), read = revoked.payments.readOrderPaymentRefundsPage; let reads = 0;
  revoked.payments.readOrderPaymentRefundsPage = async function(...args) {
    const page = await read.call(this, ...args);
    if (++reads === 2) revoked.state.user.permissions = ['rental-os:order:view'];
    return page;
  };
  await assert.rejects(revoked.service.read(), error => error.message === 'AI_ACCESS_DENIED');
  assert.equal(reads, 2, 'finance revocation on the closing page must not deliver previous facts');
  for (const refundCount of [0, 50]) {
    const capped = await create(), readIntents = capped.db.rentalPaymentIntent.findMany;
    capped.db.rentalPaymentIntent.findMany = async query => {
      const rows = await readIntents(query);
      return Array.from({ length: 20 }, (_, i) => ({ ...rows[0], id: `bounded-${i}` }));
    };
    const readRefunds = capped.db.rentalPaymentRefund.findMany;
    capped.db.rentalPaymentRefund.findMany = async query => {
      const rows = await readRefunds(query);
      return Array.from({ length: refundCount }, (_, i) => ({ ...rows[0], id: `${query.where.paymentIntentId}-r${i}`,
        paymentIntentId: query.where.paymentIntentId }));
    };
    const result = await capped.service.read(), pages = capped.queries.filter(query => query.take !== undefined);
    assert.equal(result.intents.length, 20); assert.equal(result.refunds.length, refundCount ? 100 : 0);
    assert.equal(result.truncated, !!refundCount, 'unread later intents are not complete coverage');
    assert.equal(pages.length, refundCount ? 6 : 42, 'at most two intent reads and twice twenty refund pages');
    assert.equal(pages.filter(query => query.take === 21).length, 2);
    assert.equal(pages.filter(query => query.take === 51).length, refundCount ? 4 : 40);
    assert.equal(result.totals, 'not_computed'); assert.equal(result.fundingLedger, 'not_loaded');
  }
});

test('ordinary order access does not grant finance read and cannot read any payment record', async () => {
  const h = await create(); h.state.user.permissions = ['rental-os:order:view'];
  await assert.rejects(h.service.read()); assert.equal(h.queries.length, 0);
});

async function createFunding() {
  const h = await setup(), queries = [], at = new Date(h.state.order.updatedAt), scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a' };
  h.state.user.permissions.push('rental-os:finance:view');
  // Persisted Core scalar timestamps are canonical ISO strings; this fixture's
  // original sample predates that projection and used the equivalent short Z.
  h.state.order.updatedAt = at.toISOString();
  const event = (id, instrument, action, amount, provider = 'offline') => ({ ...scope, id, instrument, action, amount, provider,
    paymentMethod: provider === 'offline' ? 'offline_cash' : null, idempotencyKey: `operation:${id}`, at, createdAt: at,
    reason: 'private-reason', operator: 'private-operator', failureCode: 'private-error' });
  const data = { legacy: false, legacyAmount: 0, events: [event('rent-a', 'rental', 'initiate', 0.1, 'stripe'),
    event('rent-b', 'rental', 'append', 0.2), event('rent-refund', 'rental', 'refund', 0.1, 'stripe'),
    event('deposit-a', 'deposit', 'initiate', 10.01), event('deposit-capture', 'deposit', 'capture', 2),
    event('deposit-refund', 'deposit', 'refund', 3), event('mock-rental', 'rental', 'initiate', 999, 'mock'),
    event('preauth-a', 'preauthorization', 'initiate', 99, 'mock'), event('preauth-release', 'preauthorization', 'release', 20, 'mock'),
    event('preauth-fail', 'preauthorization', 'fail', 999, 'mock')], registrations: [
      { ...scope, id: 'pending-offline', instrument: 'rental', amount: 888, paymentMethod: 'offline_cash', status: 'pending',
        registeredAt: at, confirmedAt: null, confirmedBy: null, fundingEventId: null, evidenceFileAssetId: 'private-file' }
    ], afterEvents: null, wrongParent: false };
  // Explicit scalar transport leaves, not SQL/ACL/provider emulation. The actual
  // domain constructs bounded selects and uses original accounting helpers;
  // real Auth/Guard/ALS wraps it. This test does not establish live DB isolation.
  const db = { rentalOrder: { findFirst: async q => { queries.push({ kind: 'parent', query: q }); return {
    id: 'order-a', tenantId: data.wrongParent ? 'foreign-tenant' : 'tenant-a', workspaceId: 'workspace-a', updatedAt: at,
    currency: h.state.order.currency, legacyDepositUnverified: data.legacy, legacyDepositUnverifiedAmount: data.legacyAmount }; } },
    rentalFundingEvent: { findMany: async q => { queries.push({ kind: 'events', query: q }); const rows = structuredClone(data.events);
      if (data.afterEvents) await data.afterEvents(); return rows; } },
    rentalOfflinePaymentRegistration: { findMany: async q => { queries.push({ kind: 'registrations', query: q }); return structuredClone(data.registrations); } },
    $transaction: async (work, options) => { queries.push({ kind: 'transaction', options }); return work(db); } };
  const { RentalFundingService } = require('../apps/api/src/modules/rental-core/rental-funding.service');
  const { AiOrderFundingFactsService } = require('../apps/api/src/modules/ai-native/tools/order-funding-facts.service');
  const funding = new RentalFundingService(db), routes = new AiBusinessReadRouteAuthority(h.guard, h.credentials);
  return { ...h, data, event, queries, funding, fundingReader: new AiOrderFundingFactsService(funding, h.core, h.authority, routes) };
}

test('AIN13 original funds separate real cash, deposit disposition, pending registration and simulated preauthorization', async () => {
  const h = await createFunding(), result = await h.fundingReader.read();
  assert.deepEqual(result.rentalCash, { coverage: 'available', collected: 0.3, refunded: 0.1, netReceived: 0.2 });
  assert.deepEqual(result.deposit, { coverage: 'available', collected: 10.01, captured: 2, refunded: 3, balance: 5.01 });
  assert.equal(result.preauthorization.coverage, 'unavailable'); assert.equal(result.settlementBalance, 'not_computed');
  assert.equal(result.offlineRegistrations[0].status, 'pending'); assert.equal(result.offlineRegistrations[0].confirmedAt, null);
  assert.equal(result.events.find(e => e.id === 'mock-rental').accounting, 'simulation_or_unverified_not_real_funds');
  assert.equal(result.events.find(e => e.id === 'preauth-release').recordedProvider, 'mock');
  assert.deepEqual(h.queries.filter(q => q.kind === 'transaction').map(q => q.options.isolationLevel), ['RepeatableRead']);
  for (const row of h.queries.filter(q => q.query)) {
    const q = row.query; assert.equal(q.where.tenantId, 'tenant-a'); assert.equal(q.where.workspaceId, 'workspace-a');
    assert.equal(q.where.orderId ?? q.where.id, 'order-a'); assert.ok(q.select && !q.include);
    for (const key of ['reason', 'operator', 'failureCode', 'responseJson', 'evidenceFileAssetId', 'membershipSnapshot', 'balanceAfter']) assert.equal(q.select[key], undefined);
  }
  assert.deepEqual(h.queries.filter(q => q.query?.take).map(q => q.query.take), [201, 201]);
  assert.equal(JSON.stringify(result).includes('private-'), false);
  // Exact old confirmation normalization is retained, without rewriting rows.
  const legacy = h.event('legacy-rental', 'rental', 'append', 0.4, 'mock');
  legacy.paymentMethod = 'offline_cash'; legacy.idempotencyKey = 'staff-offline:confirmed-registration'; h.data.events.push(legacy);
  h.data.registrations.push({ tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', id: 'confirmed-registration',
    instrument: 'rental', amount: 0.4, paymentMethod: 'offline_cash', status: 'confirmed', registeredAt: new Date(legacy.at),
    confirmedAt: new Date(legacy.at), confirmedBy: 'private-confirmer', fundingEventId: legacy.id });
  const confirmed = await h.fundingReader.read(); assert.equal(confirmed.rentalCash.collected, 0.7);
  assert.equal(confirmed.events.find(e => e.id === legacy.id).recordedProvider, 'mock');
  assert.equal(confirmed.events.find(e => e.id === legacy.id).accountingProvider, 'offline'); assert.equal(legacy.provider, 'mock');
  h.data.registrations.at(-1).confirmedBy = null;
  const unknown = await h.fundingReader.read(); assert.deepEqual(unknown.rentalCash, { coverage: 'unavailable' });
  assert.deepEqual(unknown.deposit, { coverage: 'unavailable' });
});

test('AIN13 funds caps, NULL, foreign parent, legacy security and current revocation fail closed', async () => {
  for (const mutate of [h => { h.data.events = Array.from({ length: 201 }, (_, i) => h.event(`many-${i}`, 'rental', 'append', 1)); },
    h => { h.data.events[0].amount = null; }, h => { h.data.wrongParent = true; },
    h => { h.data.events[0].tenantId = 'foreign-tenant'; }, h => { h.data.events[0].provider = 'invented'; }]) {
    const h = await createFunding(); mutate(h); await assert.rejects(h.fundingReader.read());
  }
  const legacy = await createFunding(); legacy.data.legacy = true; legacy.data.legacyAmount = 40;
  const old = await legacy.fundingReader.read(); assert.equal(old.deposit.coverage, 'unavailable');
  assert.deepEqual(old.legacySecurity, { unverified: true, unverifiedAmount: 40 });
  const admin = await createFunding(); admin.state.user.isPlatformAdmin = true; admin.state.user.permissions = [];
  assert.equal((await admin.fundingReader.read()).rentalCash.coverage, 'available', 'original current tenant-admin finance grant is retained');
  const denied = await createFunding(); denied.state.user.permissions = ['rental-os:order:view'];
  await assert.rejects(denied.fundingReader.read()); assert.equal(denied.queries.length, 0);
  const revoked = await createFunding(); revoked.data.afterEvents = async () => { revoked.state.member = false; };
  await assert.rejects(revoked.fundingReader.read());
});

test('AIN13 confirmed registration without its original event cannot become available zero cash or deposit', async () => {
  for (const instrument of ['rental', 'deposit']) {
    const h = await createFunding(), at = new Date(h.state.order.updatedAt); h.data.events = [];
    h.data.registrations = [{ tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', id: 'confirmed-missing',
      instrument, amount: 100, paymentMethod: 'offline_cash', status: 'confirmed', registeredAt: at,
      confirmedAt: at, confirmedBy: 'private-confirmer', fundingEventId: null }];
    const result = await h.fundingReader.read();
    assert.deepEqual(result.rentalCash, { coverage: 'unavailable' }, 'missing receipt is not a verified zero');
    assert.deepEqual(result.deposit, { coverage: 'unavailable' });
  }
});

test('AIN13 optional funds detail stays within original claim and material caps without losing full-source totals', async () => {
  const h = await createFunding(), at = new Date(h.state.order.updatedAt);
  h.data.events = Array.from({ length: 180 }, (_, i) => h.event(`e${i}`, 'rental', 'append', 0.01));
  h.data.registrations = Array.from({ length: 60 }, (_, i) => ({ tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a',
    id: `r${i}`, instrument: 'rental', amount: 1, paymentMethod: 'offline_cash', status: 'pending', registeredAt: at,
    confirmedAt: null, confirmedBy: null, fundingEventId: null }));
  const source = await h.fundingReader.read(); assert.ok(Buffer.byteLength(JSON.stringify(source), 'utf8') <= 65536);
  const b = await require('./fixtures/ai-native/lane-a-business-consumption.cjs').setup();
  const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
  const tools = composeAiAuthorizedBusinessTools({ core: h.core, guard: h.guard, credentials: h.credentials, funding: h.funding,
    business: b.business, reports: b.reports, memberships: b.memberships });
  const packet = await tools.orderExplanationPreparation('order-a').prepare({ question: 'payments' });
  assert.ok(packet.payload.explanation.claims.length <= 1024); assert.ok(packet.payloadBytes <= 131072);
  assert.equal(packet.payload.facts.fundingLedger.value.events.length, 180, 'source population is not a sliced page');
  assert.equal(packet.payload.facts.fundingLedger.value.rentalCash.collected, 1.8, 'original domain uses all complete source rows');
  assert.ok(packet.payload.explanation.text.includes('明细显示有上限'));
  // Declared scalar payment-page leaves, consumed by the original payment
  // reader/Guard. No provider or SQL emulation; exercise the combined packet
  // budget without widening the existing 128 KiB/1,024 claim limits.
  const intentIds = Array.from({ length: 10 }, (_, i) => `i${i}-${'x'.repeat(40)}`);
  const payments = { readOrderPaymentIntentsPage: async () => ({ truncated: false, rows: intentIds.map(intentId => ({
    intentId, instrument: 'rental', amount: 1, currency: 'CNY', status: 'paid', expiresAt: at.toISOString() })) }),
    readOrderPaymentRefundsPage: async (_tenant, _workspace, orderId, paymentIntentId, query) => ({ truncated: false,
      rows: Array.from({ length: Math.min(10, query.limit) }, (_, i) => ({ refundId: `${paymentIntentId}-r${i}`,
        paymentIntentId, orderId, amount: 0.01, currency: 'CNY', status: 'pending', createdAt: at.toISOString(), updatedAt: at.toISOString() })) }) };
  const crowded = composeAiAuthorizedBusinessTools({ core: h.core, guard: h.guard, credentials: h.credentials, funding: h.funding, payments,
    business: b.business, reports: b.reports, memberships: b.memberships });
  const service = crowded.orderExplanationPreparation('order-a');
  const bounded = await service.prepare({ question: 'payments' });
  const { buildOrderExplanation, orderExplanationDisplayBudget, projectOrderExplanationMaterial } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { explanation: _display, ...base } = structuredClone(bounded.payload);
  base.facts.fundingLedger = { coverage: 'partial', value: source };
  base.gaps = base.gaps.map(row => row.field === 'fundingLedger' ? { ...row, status: 'partial' } : row);
  const unbounded = buildOrderExplanation({ payload: base });
  console.log(JSON.stringify({ boundary: 'payment_display_only', baseBytes: Buffer.byteLength(JSON.stringify(base), 'utf8'),
    unboundedBytes: Buffer.byteLength(JSON.stringify({ ...base, explanation: unbounded }), 'utf8'), originalMaterialLimit: 131072 }));
  assert.ok(orderExplanationDisplayBudget(base) > 0, 'full authorized sources fit; only repeated display causes the overflow');
  assert.ok(Buffer.byteLength(JSON.stringify({ ...base, explanation: unbounded }), 'utf8') > 131072);
  assert.ok(bounded.payloadBytes <= 131072); assert.equal(bounded.payload.facts.payments.value.refunds.length, 100);
  assert.equal(bounded.payload.facts.fundingLedger.coverage, 'partial', 'display budget must not relabel a valid available funding source');
  assert.equal(bounded.payload.facts.fundingLedger.value.events.length, 180);
  assert.equal(bounded.payload.facts.fundingLedger.value.offlineRegistrations.length, 60);
  assert.equal(bounded.payload.facts.fundingLedger.value.rentalCash.collected, 1.8);
  const claims = new Map(bounded.payload.explanation.claims.map(row => [row.field, row]));
  for (const [field, value] of [['funding.rentalCash.collected', 1.8], ['funding.rentalCash.refunded', 0],
    ['funding.rentalCash.netReceived', 1.8], ['funding.deposit.balance', 0], ['funding.currency', 'CNY'],
    ['funding.preauthorization.coverage', 'unavailable'], ['amounts.finalPayable', 100], ['amounts.currency', 'CNY']]) {
    assert.equal(claims.get(field)?.value, value, field);
  }
  assert.ok(bounded.payload.explanation.text.includes('显示预算'));
  const published = await service.preparePublicV2({ question: 'payments' });
  assert.ok(Buffer.byteLength(JSON.stringify(published), 'utf8') <= 131072);
  assert.equal(published.payload.facts.fundingLedger.value.events.length, 180);
  assert.equal(published.payload.facts.payments.value.refunds.length, 100);
  assert.equal(published.payload.explanation.claims.find(row => row.field === 'funding.deposit.balance').value, 0);
  assert.equal(published.payloadFingerprint, requestFingerprint(published.payload));
  const { projectOrderExplanationMaterialV2 } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const { sealBusinessScenario } = require('../apps/api/src/modules/ai-native/tools/business-scenario-input');
  const corrupt = structuredClone(bounded.payload); corrupt.facts.fundingLedger.value.unreviewedProviderResponse = {};
  assert.throws(() => projectOrderExplanationMaterialV2(sealBusinessScenario('order_explanation', corrupt)),
    'display budgeting cannot sanitize unknown source data into a valid packet');
  const foreign = structuredClone(bounded.payload); foreign.facts.fundingLedger.value.workspaceId = 'another-workspace';
  assert.throws(() => projectOrderExplanationMaterialV2(sealBusinessScenario('order_explanation', foreign)), error => error.code === 'INVALID_RESPONSE');
  assert.deepEqual(projectOrderExplanationMaterial(bounded).payload.facts.fundingLedger, { coverage: 'not_loaded' }, 'old wire still withholds funding');
  const ref = published.payload.facts.fundingLedger.source;
  const reopened = await service.reopenCitationV2({ materialVersion: published.version, question: 'payments',
    scope: ref.scope, resourceType: ref.resourceType, resourceId: ref.resourceId, version: ref.version, field: ref.field });
  assert.equal(reopened.status, 'available'); assert.equal(reopened.value.value.events.length, 180);
  assert.equal(reopened.value.value.rentalCash.collected, 1.8, 'display reduction does not truncate the original total source');
  const forged = await service.validateGenerated({ question: 'payments', text: 'MODEL_FALSE paid in full',
    claims: [{ field: 'funding.rentalCash.collected', sourceId: 'order-a', value: 0 }] });
  assert.equal(forged.valid, false); assert.equal(forged.text.value, '');
  assert.throws(() => buildOrderExplanation({ payload: base }, 1), /AI_RESOURCE_UNAVAILABLE/u, 'mandatory financial facts cannot be discarded');
  // Retain the original unavailable fallback for a genuinely oversized source
  // combination, not merely the extra deterministic display. Each page remains
  // the same bounded persisted transport under the original finance Guard.
  const sourceBytes = Buffer.byteLength(JSON.stringify(source), 'utf8');
  const padding = Math.floor((65000 - sourceBytes) / h.data.events.length);
  assert.ok(padding > 0);
  h.data.events = h.data.events.map(row => ({ ...row, id: row.id + 'q'.repeat(padding) }));
  const largeSource = await h.fundingReader.read();
  assert.ok(Buffer.byteLength(JSON.stringify(largeSource), 'utf8') <= 65536, 'retain the original funding source byte cap');
  const largeIds = intentIds.map((_, i) => `intent-${i}-${'z'.repeat(178)}`);
  payments.readOrderPaymentIntentsPage = async () => ({ truncated: false, rows: largeIds.map(intentId => ({
    intentId, instrument: 'rental', amount: 1, currency: 'CNY', status: 'paid', expiresAt: at.toISOString() })) });
  payments.readOrderPaymentRefundsPage = async (_tenant, _workspace, orderId, paymentIntentId, query) => ({ truncated: false,
    rows: Array.from({ length: Math.min(10, query.limit) }, (_, i) => ({ refundId: `${paymentIntentId}-r${i}`,
      paymentIntentId, orderId, amount: 0.01, currency: 'CNY', status: 'succeeded', createdAt: at.toISOString(), updatedAt: at.toISOString(),
      acceptedAt: at.toISOString(), succeededAt: at.toISOString(), fundedAt: at.toISOString() })) });
  const oversized = await service.prepare({ question: 'payments' });
  const { explanation: _largeDisplay, ...largeBase } = structuredClone(oversized.payload);
  largeBase.facts.fundingLedger = { coverage: 'partial', value: largeSource };
  largeBase.gaps = largeBase.gaps.map(row => row.field === 'fundingLedger' ? { ...row, status: 'partial' } : row);
  console.log(JSON.stringify({ boundary: 'payment_sources_too_large', baseBytes: Buffer.byteLength(JSON.stringify(largeBase), 'utf8') }));
  assert.throws(() => orderExplanationDisplayBudget(largeBase), /AI_RESOURCE_UNAVAILABLE/u, 'reach a real combined-source bound');
  assert.ok(oversized.payloadBytes <= 131072);
  assert.equal(oversized.payload.facts.payments.value.refunds.length, 100);
  assert.equal(oversized.payload.facts.fundingLedger.coverage, 'unavailable', 'optional source cannot break valid original payment material');
  assert.equal(oversized.payload.facts.fundingLedger.value, undefined);
  assert.equal(oversized.payload.explanation.claims.some(c => c.field.startsWith('funding.')), false);
  const rows = oversized.payload.facts.payments.value, statuses = new Map(oversized.payload.explanation.claims.map(row => [row.field, row]));
  console.log(JSON.stringify({ boundary: 'resource_bound_payment_states',
    displayedIntentStates: oversized.payload.explanation.claims.filter(row => /^payments\..+\.status$/u.test(row.field)).length,
    displayedRefundStates: oversized.payload.explanation.claims.filter(row => /^refunds\..+\.status$/u.test(row.field)).length,
    expectedIntentStates: rows.intents.length, expectedRefundStates: 20 }));
  for (const row of rows.refunds.slice(0, 20)) {
    const claim = statuses.get(`refunds.${row.refundId}.status`);
    assert.ok(claim, `refund ${row.refundId}: optional display reduction cannot remove the original state identity`);
    assert.equal(claim.sourceId, row.refundId); assert.equal(claim.value, row.status);
  }
  for (const row of rows.intents) {
    assert.equal(statuses.get(`payments.${row.intentId}.status`)?.value, row.status);
    assert.equal(statuses.get(`payments.${row.intentId}.status`)?.sourceId, row.intentId);
    assert.ok(oversized.payload.explanation.text.includes(`支付单 ${JSON.stringify(row.intentId)}：`));
  }
  for (const row of rows.refunds.slice(0, 20)) assert.ok(oversized.payload.explanation.text.includes(`退款单 ${JSON.stringify(row.refundId)}：`));
  // Change only declared persisted-page state leaves; the original payment
  // reader, Guard and v2 projection still run. Success prose must stay linked
  // to one original refund, never become a global outcome when detail shrinks.
  const pageRead = payments.readOrderPaymentRefundsPage;
  payments.readOrderPaymentRefundsPage = async (...args) => {
    const page = await pageRead(...args);
    return { ...page, rows: page.rows.map((row, i) => {
      const result = { ...row, status: ['succeeded', 'failed', 'accepted'][i % 3] };
      if (result.status !== 'succeeded') { delete result.succeededAt; delete result.fundedAt; }
      return result;
    }) };
  };
  const mixed = await service.preparePublicV2({ question: 'payments' }), mixedRows = mixed.payload.facts.payments.value.refunds;
  assert.ok(Buffer.byteLength(JSON.stringify(mixed), 'utf8') <= 131072); assert.equal(mixedRows.length, 100);
  assert.equal(mixed.payload.explanation.claims.filter(row => /^refunds\..+\.status$/u.test(row.field)).length, 20);
  const labels = { succeeded: '退款记录成功', failed: '退款失败', accepted: '退款已受理，尚未证明退款成功' };
  for (const row of mixedRows.slice(0, 20)) {
    const claim = mixed.payload.explanation.claims.find(value => value.field === `refunds.${row.refundId}.status`);
    assert.equal(claim.sourceId, row.refundId); assert.equal(claim.value, row.status);
    assert.ok(mixed.payload.explanation.text.includes(`退款单 ${JSON.stringify(row.refundId)}：${labels[row.status]}`));
  }
  assert.equal(mixed.payloadFingerprint, requestFingerprint(mixed.payload));
  assert.equal(mixed.payload.explanation.executionAllowed, false);
  const paymentSource = mixed.payload.facts.payments.source;
  const reopenedPayments = await service.reopenCitationV2({ materialVersion: mixed.version, question: 'payments',
    scope: paymentSource.scope, resourceType: paymentSource.resourceType, resourceId: paymentSource.resourceId,
    version: paymentSource.version, field: paymentSource.field });
  assert.equal(reopenedPayments.status, 'available'); assert.equal(reopenedPayments.value.value.refunds.length, 100);
  assert.deepEqual(reopenedPayments.value.value.refunds.map(row => row.status), mixedRows.map(row => row.status));
});

test('AIN13 funds-backed explanation consumes original domain while the old public material stays closed', async () => {
  const h = await createFunding(), b = await require('./fixtures/ai-native/lane-a-business-consumption.cjs').setup();
  const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
  const { projectOrderExplanationMaterial } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const tools = composeAiAuthorizedBusinessTools({ core: h.core, guard: h.guard, credentials: h.credentials, funding: h.funding,
    business: b.business, reports: b.reports, memberships: b.memberships });
  const service = tools.orderExplanationPreparation('order-a'), packet = await service.prepare({ question: 'payments' });
  assert.equal(packet.payload.facts.fundingLedger.coverage, 'partial');
  assert.equal(packet.payload.explanation.claims.find(c => c.field === 'funding.rentalCash.collected').value, 0.3);
  assert.equal(packet.payload.explanation.claims.find(c => c.field === 'funding.deposit.balance').value, 5.01);
  assert.ok(packet.payload.explanation.text.includes('不是实际冻结证据'));
  assert.ok(packet.payload.explanation.text.includes('企业回款核销不是另一笔现金'));
  const { AI_NATIVE_ORIGINAL_REQUEST_PROVIDER } = require('../apps/api/src/modules/ai-native/ai-native-application.providers');
  const { RentalFundingService } = require('../apps/api/src/modules/rental-core/rental-funding.service');
  assert.ok(AI_NATIVE_ORIGINAL_REQUEST_PROVIDER.inject.includes(RentalFundingService), 'standard composition injects the original bounded funding domain');
  const beforeHash = requestFingerprint(packet), publicPacket = projectOrderExplanationMaterial(packet);
  assert.deepEqual(publicPacket.payload.facts.fundingLedger, { coverage: 'not_loaded' });
  assert.equal(requestFingerprint(packet), beforeHash); assert.equal(publicPacket.payloadFingerprint, requestFingerprint(publicPacket.payload));
  const shared = require('@rental-os/shared'), contracts = require('./fixtures/ai-native/contract-consumer.cjs');
  const defs = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS')).map(([, schemas]) => schemas));
  const validate = contracts.validatorsFor(shared.AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, defs).AiOrderExplanationMaterialDraft;
  assert.equal(validate(publicPacket), true, JSON.stringify(validate.errors));
  const malicious = await service.validateGenerated({ question: 'payments', text: 'Deposit was fully refunded; preauth released!',
    claims: [{ field: 'funding.deposit.balance', sourceId: 'order-a', value: 5.01 }] });
  assert.equal(malicious.valid, true); assert.equal(malicious.text.value.includes('Deposit was fully refunded'), false);
  const forged = await service.validateGenerated({ question: 'payments', text: 'Fully refunded',
    claims: [{ field: 'funding.deposit.balance', sourceId: 'order-a', value: 0 }] });
  assert.equal(forged.valid, false); assert.equal(forged.text.value, '');
  h.state.user.permissions = ['rental-os:order:view'];
  const unavailable = await service.prepare({ question: 'payments' });
  assert.equal(unavailable.payload.facts.fundingLedger.coverage, 'unavailable');
  assert.equal(unavailable.payload.explanation.claims.some(c => c.field.startsWith('funding.')), false);
});

test('named v2 funds publication and source reopening expose original accounting without altering v1 or executing funds', async () => {
  const h = await createFunding(), b = await require('./fixtures/ai-native/lane-a-business-consumption.cjs').setup();
  const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
  const { projectOrderExplanationMaterial } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const service = composeAiAuthorizedBusinessTools({ core: h.core, guard: h.guard, credentials: h.credentials, funding: h.funding,
    business: b.business, reports: b.reports, memberships: b.memberships }).orderExplanationPreparation('order-a');
  const original = await service.prepare({ question: 'payments' }), hash = requestFingerprint(original);
  const packet = await service.preparePublicV2({ question: 'payments' });
  const shared = require('@rental-os/shared'), contracts = require('./fixtures/ai-native/contract-consumer.cjs');
  const defs = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS')).map(([, schemas]) => schemas));
  const validate = contracts.validatorsFor(shared.AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, defs);
  assert.equal(validate.AiOrderExplanationMaterialV2(packet), true, JSON.stringify(validate.AiOrderExplanationMaterialV2.errors));
  const ledger = packet.payload.facts.fundingLedger;
  assert.equal(ledger.coverage, 'partial'); assert.equal(ledger.source.field, 'funding_records');
  assert.deepEqual(ledger.value.rentalCash, { coverage: 'available', collected: .3, refunded: .1, netReceived: .2 });
  assert.equal(ledger.value.deposit.balance, 5.01); assert.equal(ledger.value.preauthorization.coverage, 'unavailable');
  assert.equal(packet.payload.facts.actualReceivedTotal.coverage, 'not_loaded');
  assert.equal(requestFingerprint(original), hash);
  assert.deepEqual(projectOrderExplanationMaterial(original).payload.facts.fundingLedger, { coverage: 'not_loaded' });
  const { observedAt, ...reference } = ledger.source, command = { ...reference, question: 'payments', materialVersion: packet.version };
  const reopened = await service.reopenCitationV2(command);
  assert.equal(validate.AiOrderSourceReadV2(reopened), true, JSON.stringify(validate.AiOrderSourceReadV2.errors));
  assert.equal(reopened.status, 'available'); assert.equal(reopened.value.value.deposit.balance, 5.01);
  assert.equal(reopened.execution, 'not_attempted');
  h.data.events.find(e => e.id === 'rent-refund').amount = .2;
  assert.equal((await service.reopenCitationV2(command)).value.value.rentalCash.netReceived, .1, 'source reopening is a new authorized observation, not the frozen payment snapshot');
  assert.equal(ledger.value.rentalCash.netReceived, .2, 'previous publication is immutable');
  const malformed = structuredClone(packet); malformed.payload.facts.fundingLedger.value.unreviewedProviderResponse = {};
  assert.equal(validate.AiOrderExplanationMaterialV2(malformed), false);
  const wrongField = structuredClone(reopened); wrongField.field = 'saved_basis';
  assert.equal(validate.AiOrderSourceReadV2(wrongField), false, 'each source field has a closed corresponding value');
  h.state.user.permissions = ['rental-os:order:view'];
  assert.equal((await service.reopenCitationV2(command)).status, 'missing');
  const denied = await service.preparePublicV2({ question: 'payments' });
  assert.deepEqual(denied.payload.facts.fundingLedger, { coverage: 'unavailable' });
  assert.equal(denied.payload.explanation.claims.some(c => c.field.startsWith('funding.')), false);
});
