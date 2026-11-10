'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'ES2022', lib: ['ES2022'], esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup: orderSetup } = require('./fixtures/ai-native/order-facts.cjs');
const { setup: businessSetup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
async function setup() {
  const order = await orderSetup(), business = await businessSetup();
  const tools = composeAiAuthorizedBusinessTools({ core: order.core, guard: order.guard, credentials: order.credentials,
    business: business.business, reports: business.reports, memberships: business.memberships });
  return { ...order, service: tools.orderExplanationPreparation('order-a') };
}
test('AIN13 budgeted fee explanations retain original historical coverage and reference-only evidence', async () => {
  const { buildOrderExplanation } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  for (const mode of ['missing', 'references']) {
    const h = await setup();
    if (mode === 'references') {
      // Only saved original-order fixture fields are supplied. A version is not
      // a price snapshot; a calendar version alone is not applied daily content.
      h.state.order.ruleVersion = 'stored-original-rule-v1';
      h.state.order.ruleSnapshot = { fulfillment: { pickupInspectionRequired: false, returnInspectionRequired: true } };
      h.state.order.pricingPlanVersion = 'stored-original-plan-ref';
      h.state.order.calendarVersion = 'stored-calendar-reference-without-content';
    }
    const originalOrder = structuredClone(h.state.order), packet = await h.service.prepare({ question: 'fees' });
    const history = packet.payload.facts.history.value;
    assert.equal(history.complete, false); assert.equal(history.savedQuote.status, 'missing_link');
    assert.equal(history.rule.status, mode === 'references' ? 'available' : 'missing');
    assert.equal(history.price.status, mode === 'references' ? 'references_only' : 'missing');
    assert.equal(history.calendar.status, 'missing'); assert.equal(history.price.rateEvidence, 'not_loaded');
    const expected = { 'history.savedQuote.status': 'missing_link',
      'history.rule.status': mode === 'references' ? 'available' : 'missing',
      'history.price.status': mode === 'references' ? 'references_only' : 'missing', 'history.calendar.status': 'missing' };
    const complete = buildOrderExplanation(packet), fingerprint = requestFingerprint(packet.payload);
    const check = explanation => {
      const claims = new Map(explanation.claims.map(row => [row.field, row]));
      for (const [field, value] of Object.entries(expected)) {
        assert.ok(claims.has(field), `${field}: basis coverage cannot disappear under optional display reduction`);
        assert.equal(claims.get(field).sourceId, originalOrder.id); assert.equal(claims.get(field).value, value);
      }
      assert.equal(claims.get('amounts.finalPayable').value, 100); assert.equal(claims.get('amounts.currency').value, 'CNY');
      assert.ok(explanation.text.includes('版本引用不等于完整计价证据'));
      assert.ok(explanation.text.includes('不从版本串、当前日历或当前价格重建'));
    };
    check(complete);
    const cap = Buffer.byteLength(JSON.stringify(complete), 'utf8') - 1;
    if (mode === 'references') {
      const limited = buildOrderExplanation(packet, cap); check(limited);
      assert.ok(limited.text.includes('显示预算')); assert.ok(limited.claims.length < complete.claims.length);
      assert.ok(Buffer.byteLength(JSON.stringify(limited), 'utf8') <= cap);
    } else {
      assert.throws(() => buildOrderExplanation(packet, cap), /AI_RESOURCE_UNAVAILABLE/u,
        'with no optional details left, never discard necessary missing-basis coverage to fit');
    }
    assert.equal(requestFingerprint(packet.payload), fingerprint); assert.deepEqual(h.state.order, originalOrder);
    assert.equal(packet.payload.handoff.execution, 'not_attempted');
  }
});

test('AIN13 display budgets retain original change and inspection decision state citations', async () => {
  const { buildOrderExplanation } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  for (const mode of ['changes', 'inspections']) {
    const h = await setup(), at = '2026-10-07T00:00:00Z';
    const records = Array.from({ length: 2 }, (_, row) => ({ id: `state-inspection-${row}`, tenantId: 'tenant-a', orderId: 'order-a',
      stage: 'return', templateId: 'original-state-template', templateCode: 'original-state-template', templateVersion: 'v1', createdAt: at,
      exceptions: Array.from({ length: 10 }, (_, index) => ({ code: `state-exception-${index}`, description: 'Recorded exception, not a charge or liability ruling',
        reviewStatus: index % 2 ? 'approved' : 'rejected', customerResponseStatus: ['disputed', 'pending', 'confirmed'][index % 3] })) }));
    const changes = mode === 'changes' ? Array.from({ length: 20 }, (_, index) => ({ id: `state-change-${index}`,
      type: 'post_pickup_exchange', status: index % 2 ? 'pending' : 'applied', requestedAt: at,
      ...(index % 2 ? {} : { appliedAt: at }) })) : [];
    // Declared fixture transport only; real Core, original Guard/ALS and both
    // current readers validate these bounded original records. No business write.
    const lifecycle = h.facts.readOrderExplanationState.bind(h.facts);
    h.facts.listInspections = async () => structuredClone(records);
    h.facts.readOrderExplanationState = async (...args) => ({ ...await lifecycle(...args), changes: structuredClone(changes) });
    const packet = await h.service.prepare({ question: 'fees' }), before = requestFingerprint(packet.payload);
    const complete = buildOrderExplanation(packet), cap = Buffer.byteLength(JSON.stringify(complete), 'utf8') - 1;
    const limited = buildOrderExplanation(packet, cap), claims = new Map(limited.claims.map(row => [row.field, row]));
    assert.ok(Buffer.byteLength(JSON.stringify(limited), 'utf8') <= cap); assert.ok(limited.claims.length < complete.claims.length);
    assert.ok(limited.text.includes('显示预算'), 'reach actual optional display reduction without changing the source allowance');
    for (const change of changes) {
      const claim = claims.get(`changes.${change.id}.status`);
      assert.ok(claim, `${change.id}: change prose must retain its original status citation`);
      assert.equal(claim.sourceId, change.id); assert.equal(claim.value, change.status);
    }
    for (const record of records) for (const [index, exception] of record.exceptions.entries()) {
      for (const field of ['reviewStatus', 'customerResponseStatus']) {
        const claim = claims.get(`inspections.${record.id}.${index}.${field}`);
        assert.ok(claim, `${record.id}/${index}: review/dispute wording requires its exact recorded state citation`);
        assert.equal(claim.sourceId, record.id); assert.equal(claim.value, exception[field]);
      }
    }
    assert.ok(limited.text.includes('已记录客户争议')); assert.ok(limited.text.includes('不代表责任成立'));
    if (changes.length) assert.ok(limited.text.includes('已记录采用换货'));
    assert.equal(requestFingerprint(packet.payload), before, 'display reduction never mutates original facts or material');
    assert.equal(packet.payload.facts.inspections.value.records.length, records.length);
    assert.deepEqual(packet.payload.facts.order.value.lifecycle.value.changes, changes);
    assert.equal(packet.payload.handoff.execution, 'not_attempted');
    assert.throws(() => buildOrderExplanation(packet, 1), /AI_RESOURCE_UNAVAILABLE/u, 'insufficient critical-state space fails closed');
  }
});

test('AIN13 original bounded order discovery retains its parent and query before Guard waits', async () => {
  const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
  const { aiOrderCandidatesPageSchema } = require('@rental-os/shared');
  const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const h = await orderSetup(), b = await businessSetup(), queries = [];
  const tools = composeAiAuthorizedBusinessTools({ core: h.core, guard: h.guard, credentials: h.credentials,
    business: b.business, reports: b.reports, memberships: b.memberships });
  const routes = new AiBusinessReadRouteAuthority(h.guard, h.credentials);
  const query = { page: 1, pageSize: 2, status: 'reserved', keyword: 'S03' }, originalQuery = structuredClone(query);
  const originalOrder = structuredClone(h.state.order), actor = h.state.user.id, writes = structuredClone(b.businessFacts.writes);
  // Explicit bounded transport leaf over the original fixture order, not SQL
  // filtering/ownership emulation. Real Guard/ALS and Core paging/publicOrder run.
  h.facts.queryOrders = async (tenant, value) => {
    queries.push({ tenant, query: structuredClone(value), identity: structuredClone(getRequestIdentity()) });
    return { items: [{ ...structuredClone(h.state.order), memo: 'private-order-note', customerPhone: 'private-customer-phone' }], total: 1 };
  };
  const parent = await routes.withRead('order_candidates', query, async context => context), originalParent = structuredClone(parent);
  const check = result => {
    assert.equal(aiOrderCandidatesPageSchema.safeParse(result).success, true);
    assert.equal(result.scope.tenantId, 'tenant-a'); assert.equal(result.scope.workspaceId, 'workspace-a');
    assert.deepEqual(result.query, originalQuery); assert.equal(result.items.length, 1); assert.equal(result.total, 1);
    assert.equal(result.items[0].id, originalOrder.id); assert.equal(result.items[0].status, originalOrder.status);
    assert.deepEqual(result.items[0].source, { kind: 'order', id: originalOrder.id, version: originalOrder.updatedAt });
    assert.deepEqual(Object.keys(result.items[0]).sort(), ['endAt', 'id', 'orderNo', 'source', 'startAt', 'status', 'updatedAt']);
    assert.equal(result.coverage, 'page_of_current_visible_orders'); assert.equal(result.hasMore, false);
    assert.equal(result.execution, 'not_attempted'); assert.equal(result.consistency, 'current_non_atomic_observation');
    assert.equal(JSON.stringify(result).includes('private-'), false);
    const observed = queries.at(-1); assert.equal(observed.tenant, 'tenant-a');
    assert.equal(observed.identity.workspaceId, 'workspace-a'); assert.equal(observed.identity.userId, h.state.user.id);
    assert.deepEqual(observed.query, { ...originalQuery, skip: 0, take: 2 });
  };
  check(await tools.orders.read(query, { ...structuredClone(parent), requestId: 'new-discovery-observation', authorizedAt: '2020-01-01T00:00:00Z' }));
  const credential = h.credentials.current, beforeQueries = queries.length; let intercepted = false;
  h.credentials.current = async function(...args) {
    await Promise.resolve();
    if (!intercepted) { intercepted = true; parent.actor.userId = 'new-original-order-discovery'; h.state.user.id = parent.actor.userId; }
    return credential.apply(this, args);
  };
  try {
    await assert.rejects(tools.orders.read(query, parent), error => error.code === 'FORBIDDEN');
    assert.equal(intercepted, true); assert.equal(queries.length, beforeQueries, 'old parent rejected before any Core order query');
    h.credentials.current = credential;
    const current = await routes.withRead('order_candidates', query, async context => context);
    assert.equal(current.actor.userId, 'new-original-order-discovery'); check(await tools.orders.read(query, current));
    h.state.user.id = actor; check(await tools.orders.read(query, originalParent));
    let changed = false;
    h.credentials.current = async function(...args) {
      await Promise.resolve(); changed = true;
      query.page = 2; query.pageSize = 1; query.status = 'renting'; query.keyword = 'Changed after submission';
      return credential.apply(this, args);
    };
    check(await tools.orders.read(query, originalParent)); assert.equal(changed, true);
    assert.equal(query.page, 2, 'caller input really changed, but cannot rewrite the frozen discovery query');
    h.credentials.current = credential;
    h.state.user.permissions = []; const readsBeforeWithdrawal = queries.length;
    await assert.rejects(tools.orders.read(originalQuery, originalParent), error => error.code === 'FORBIDDEN');
    assert.equal(queries.length, readsBeforeWithdrawal); assert.deepEqual(h.state.order, originalOrder);
    assert.deepEqual(b.businessFacts.writes, writes);
  } finally { h.credentials.current = credential; h.state.user.id = actor; }
});

test('AIN13 order preparation and both source reopeners fix original parents before current Guard waits', async () => {
  const { AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION } = require('@rental-os/shared');
  for (const method of ['prepare', 'reopenCitation', 'reopenCitationV2']) {
    const h = await setup(), parent = await h.authority.resolve(), originalParent = structuredClone(parent);
    const originalActor = h.state.user.id, originalOrder = structuredClone(h.state.order);
    const material = await h.service.prepare({ question: 'status' }, parent);
    const reference = { question: 'status', resourceType: 'order', resourceId: 'order-a', scope: material.payload.scope,
      version: material.payload.orderVersion, field: 'order' };
    const command = method === 'prepare' ? { question: 'status' }
      : method === 'reopenCitationV2' ? { materialVersion: AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION, ...reference } : reference;
    const originalCommand = structuredClone(command), invoke = expected => h.service[method](command, expected);
    const check = value => {
      if (method === 'prepare') {
        assert.equal(value.payload.orderId, 'order-a'); assert.equal(value.payload.status, 'facts_only');
        assert.equal(value.payload.facts.order.value.status, originalOrder.status);
        assert.equal(value.payload.model.answer, 'not_generated'); assert.equal(value.payload.handoff.execution, 'not_attempted');
        assert.equal(value.payload.facts.amounts, undefined); assert.equal(value.payload.facts.payments, undefined);
      } else {
        assert.equal(value.status, 'available'); assert.equal(value.orderId, 'order-a'); assert.equal(value.field, 'order');
        assert.equal(value.value.value.status, originalOrder.status); assert.equal(value.reauthorization, 'current_order_authority_rechecked');
        if (method === 'reopenCitationV2') assert.equal(value.execution, 'not_attempted');
      }
    };
    check(await invoke({ ...structuredClone(parent), requestId: 'fresh-observation-metadata', authorizedAt: '2020-01-01T00:00:00Z' }));
    const originalCredentials = h.credentials.current, readsBefore = h.state.reads.length;
    let intercepted = false;
    h.credentials.current = async function(...args) {
      await Promise.resolve();
      if (!intercepted) {
        intercepted = true;
        // Change only this caller-owned parent and the independent synthetic
        // current user before actual credential/Guard resolution. The real
        // Auth/Guard/ALS still issues and checks the new user's own read grant.
        parent.actor.userId = 'new-original-source-reader'; h.state.user.id = parent.actor.userId;
      }
      return originalCredentials.apply(this, args);
    };
    try {
      await assert.rejects(invoke(parent), error => error.code === 'AI_ACCESS_DENIED',
        `${method}: a waiting caller cannot replace the original parent assertion`);
      assert.equal(intercepted, true); assert.equal(h.state.reads.length, readsBefore, 'old parent rejected before any Core fact read');
      h.credentials.current = originalCredentials;
      const current = await h.authority.resolve(); assert.equal(current.actor.userId, 'new-original-source-reader');
      check(await invoke(current)); assert.ok(h.state.reads.length > readsBefore, 'new current user needs a genuinely new bound request');
      h.state.user.id = originalActor; check(await invoke(originalParent));
      h.state.user.permissions = [];
      await assert.rejects(invoke(originalParent), error => error.code === 'AI_ACCESS_DENIED', 'snapshot cannot survive current revocation');
      assert.deepEqual(command, originalCommand); assert.deepEqual(h.state.order, originalOrder);
    } finally { h.credentials.current = originalCredentials; h.state.user.id = originalActor; }
  }
});

test('AIN13 client fee source changes during order waits cannot publish stale fee material', async () => {
  const { readClientOrderExplanation } = require('../apps/api/src/modules/ai-native/scenes/client-order-explanation');
  const order = { id: 'client-order-a', status: 'return_inspection', currency: 'CNY', finalPayableAmount: 0 };
  const feeSource = () => ({ apiVersion: 'client-test-1', orderId: order.id, items: [{ inspectionId: 'client-inspection-a',
    exceptionIndex: 0, stage: 'return', code: 'recorded-damage', description: 'Synthetic client-visible fee', amount: 3.25,
    currency: 'CNY', responseStatus: 'pending', evidenceCount: 1 }], pendingCount: 1 });
  // Explicit client projection callbacks only. This exercises the actual pure
  // aggregation, not HTTP/Auth/SQL, liability decisions or operator data.
  for (const mutate of [fees => { fees.items[0].responseStatus = 'confirmed'; fees.pendingCount = 0; },
    fees => { fees.items[0].amount = 4.25; }, fees => { fees.items[0].currency = 'USD'; },
    fees => { fees.pendingCount = 0; }, fees => { fees.items = []; fees.pendingCount = 0; }]) {
    const fees = feeSource(); let orderReads = 0, feeReads = 0;
    const readers = { order: async () => { const snapshot = structuredClone(order); if (++orderReads === 2) mutate(fees); return snapshot; },
      feeItems: async () => { feeReads++; return structuredClone(fees); } };
    await assert.rejects(readClientOrderExplanation(readers, order.id, 'fees'), error => error.message === 'AI_CLIENT_MATERIAL_STALE',
      'unchanged order fields cannot attest unchanged client fee/response evidence');
    assert.equal(orderReads, 3); assert.equal(feeReads, 2, 'reopen only the same fee source, no retry or next page');
  }
  const fees = feeSource(); let orderReads = 0, feeReads = 0;
  const stable = { order: async () => { orderReads++; fees.internalNote = `private-noise-${orderReads}`;
      fees.items[0].internalReview = `private-review-${orderReads}`; return structuredClone(order); },
    feeItems: async () => { feeReads++; return structuredClone(fees); } };
  const packet = await readClientOrderExplanation(stable, order.id, 'fees');
  assert.equal(orderReads, 3); assert.equal(feeReads, 2);
  assert.equal(packet.inspectionFees.value.items[0].amount, 3.25); assert.equal(packet.inspectionFees.value.items[0].responseStatus, 'pending');
  assert.equal(packet.amounts.finalPayableAmount.value, 0); assert.equal(packet.amounts.depositAmount.coverage, 'unknown');
  assert.equal(packet.orderVersion.coverage, 'unknown', 'missing updatedAt is not a synthetic revision');
  assert.equal(packet.businessExecution, 'not_attempted'); assert.equal(packet.model, 'not_requested');
  assert.equal(JSON.stringify(packet).includes('private-'), false, 'compare the same minimal client projection, not hidden reviewer fields');
  assert.ok(Object.isFrozen(packet.inspectionFees.value.items[0]));
  for (const question of ['status', 'fees']) {
    let reads = 0, forbiddenFees = 0;
    const readers = { order: async () => { reads++; return structuredClone(order); },
      ...(question === 'status' ? { feeItems: async () => { forbiddenFees++; throw Error('status must not read fees'); } } : {}) };
    const missing = await readClientOrderExplanation(readers, order.id, question);
    assert.equal(reads, 2); assert.equal(forbiddenFees, 0); assert.equal(missing.inspectionFees.coverage, 'unavailable');
  }
  let unavailableOrders = 0, unavailableFees = 0;
  const unavailable = await readClientOrderExplanation({ order: async () => { unavailableOrders++; return structuredClone(order); },
    feeItems: async () => { unavailableFees++; return undefined; } }, order.id, 'fees');
  assert.equal(unavailableOrders, 3); assert.equal(unavailableFees, 2); assert.equal(unavailable.inspectionFees.coverage, 'unavailable');
  let lastOrderReads = 0;
  await assert.rejects(readClientOrderExplanation({ order: async () => ({ ...order, status: ++lastOrderReads === 3 ? 'completed' : order.status }),
    feeItems: async () => feeSource() }, order.id, 'fees'), error => error.message === 'AI_CLIENT_MATERIAL_STALE',
    'closing fee waits must not erase the existing final order recheck');
  let foreignReads = 0;
  await assert.rejects(readClientOrderExplanation({ order: async () => structuredClone(order),
    feeItems: async () => ({ ...feeSource(), orderId: ++foreignReads === 2 ? 'another-order' : order.id }) }, order.id, 'fees'),
    error => error.message === 'AI_CLIENT_CONTEXT_UNAVAILABLE');
  const denied = new Error('synthetic-client-read-revoked'); let deniedReads = 0;
  await assert.rejects(readClientOrderExplanation({ order: async () => structuredClone(order), feeItems: async () => {
    if (++deniedReads === 2) throw denied; return feeSource(); } }, order.id, 'fees'), error => error === denied,
    'late source errors must propagate, never become successful missing coverage');
  assert.equal(deniedReads, 2); assert.deepEqual(order, { id: 'client-order-a', status: 'return_inspection', currency: 'CNY', finalPayableAmount: 0 });
});

test('AIN13 original allocation states explain preparation pickup consumption return and release without inferred transit', async () => {
  const h = await setup(); h.state.order.status = 'return_inspection';
  const originalOrder = structuredClone(h.state.order), actualLifecycle = h.facts.readOrderExplanationState;
  const states = ['pre_assigned', 'locked', 'allocated', 'picked_up', 'returned', 'released', 'consumed'];
  let allocations = states.map(status => ({ id: `allocation-state-${status}`, status, quantity: 2 }));
  // Declared synthetic lifecycle rows are returned through the actual Core,
  // Guard/ALS, preparation and public v2 source. Not SQL or transition proof.
  h.facts.readOrderExplanationState = async (...args) => ({ ...await actualLifecycle(...args), allocations: structuredClone(allocations) });
  const check = (display, rows) => {
    for (const row of rows) {
      const claim = display.claims.find(value => value.field === `allocations.${row.id}.status`);
      assert.ok(claim, row.id); assert.equal(claim.sourceId, row.id); assert.equal(claim.value, row.status);
      assert.ok(display.text.includes(`分配 ${JSON.stringify(row.id)}：`), 'status prose must name its original allocation');
    }
    assert.equal(display.text.includes('其他记录仍在途'), false, 'a pre-allocation/lock is not proof of pickup or transit');
    assert.equal(display.executionAllowed, false);
  };
  const internal = await h.service.prepare({ question: 'status' });
  const published = await h.service.preparePublicV2({ question: 'status' });
  check(internal.payload.explanation, allocations); check(published.payload.explanation, allocations);
  assert.deepEqual(published.payload.facts.lifecycle.value.allocations, allocations);
  assert.equal(published.payloadFingerprint, requestFingerprint(published.payload));
  assert.equal(internal.payloadFingerprint, requestFingerprint(internal.payload));
  assert.ok(Object.isFrozen(published.payload.facts.lifecycle.value.allocations[0]));
  for (const sentence of ['原分配记录为预分配，不证明已锁定、已领取或在途', '原分配记录为锁定，不证明已领取、在途',
    '原分配记录已分配，不证明已领取、全单交付或在途', '原分配记录已领取，不证明已归还',
    '原分配记录已归还，不证明全单归还、检查齐全', '原分配记录已释放，不证明资源已可租',
    '原分配记录已消耗，不作为待归还记录']) assert.ok(published.payload.explanation.text.includes(sentence), sentence);
  const opened = await h.service.reopenCitationV2({ materialVersion: published.version, question: 'status',
    scope: published.payload.scope, resourceType: 'order', resourceId: 'order-a', version: published.payload.orderVersion, field: 'lifecycle_records' });
  assert.equal(opened.status, 'available'); assert.deepEqual(opened.value.value.allocations, allocations);
  assert.equal(opened.execution, 'not_attempted'); assert.equal(opened.freshness, 'current_observation_not_frozen_material');
  assert.equal(published.payload.handoff.execution, 'not_attempted');
  const consumed = allocations.find(row => row.status === 'consumed');
  const invalid = await h.service.validateGenerated({ question: 'status', text: 'MODEL_FALSE all returned and inventory reusable',
    claims: [{ field: `allocations.${consumed.id}.status`, sourceId: consumed.id, value: 'returned' }] });
  assert.equal(invalid.valid, false); assert.equal(invalid.text.value, '');
  const sourced = await h.service.validateGenerated({ question: 'status', text: 'MODEL_FALSE consumed goods await return',
    claims: [{ field: `allocations.${consumed.id}.status`, sourceId: consumed.id, value: 'consumed' }] });
  assert.equal(sourced.valid, true); assert.equal(sourced.executionAllowed, false);
  assert.equal(sourced.text.value.includes('MODEL_FALSE'), false); assert.ok(sourced.text.value.includes('不作为待归还记录'));
  for (const status of ['pre_assigned', 'locked', 'allocated']) {
    allocations = [{ id: 'already-returned', status: 'returned', quantity: 1 }, { id: 'not-picked-up', status, quantity: 1 }];
    const mixed = await h.service.preparePublicV2({ question: 'status' });
    check(mixed.payload.explanation, allocations);
    assert.ok(mixed.payload.explanation.text.includes('其中未领取的记录不表示在途'));
    assert.deepEqual(mixed.payload.facts.lifecycle.value.allocations, allocations);
  }
  allocations = [{ id: consumed.id, status: 'consumed', quantity: 2 }];
  const onlyConsumed = await h.service.preparePublicV2({ question: 'status' });
  check(onlyConsumed.payload.explanation, allocations);
  assert.equal(onlyConsumed.payload.explanation.text.includes('部分记录已归还'), false);
  assert.equal(onlyConsumed.payload.facts.amounts, undefined); assert.equal(onlyConsumed.payload.facts.payments, undefined);
  assert.equal(onlyConsumed.payload.facts.history, undefined, 'status translation does not publish historical or financial facts');
  assert.deepEqual(h.state.order, originalOrder);
  h.state.member = false; await assert.rejects(h.service.preparePublicV2({ question: 'status' }));
  assert.deepEqual(h.state.order, originalOrder);
});

test('AIN13 repeated-question refresh retains the validated comparison version across actual source waits', async () => {
  const h = await setup(), version = h.state.order.updatedAt, originalOrder = structuredClone(h.state.order);
  const cases = [
    { previous: '2025-01-01T00:00:00Z', mutate: value => { value.previousOrderVersion = version; }, status: 'compared', changed: true },
    { previous: undefined, mutate: value => { value.previousOrderVersion = version; }, status: 'not_comparable' },
    { previous: version, mutate: value => { delete value.previousOrderVersion; }, status: 'compared', changed: false }
  ];
  for (const row of cases) {
    const command = { question: 'status' };
    if (row.previous !== undefined) command.previousOrderVersion = row.previous;
    let mutations = 0;
    // Mutate only the caller's comparison parameter during the original Core
    // read, not the order, business version, authority or a persisted request.
    h.state.afterRead = async () => { mutations++; row.mutate(command); };
    try {
      const result = await h.service.refresh(command);
      assert.ok(mutations > 0); assert.equal(result.current.payload.orderVersion, version);
      assert.equal(result.comparison.status, row.status, 'field presence belongs to the validated original input');
      if (row.status === 'compared') {
        assert.equal(result.comparison.orderChanged, row.changed, 'the caller object must not replace the original comparison version');
        assert.equal(result.comparison.basis, 'server_order_updated_at_only');
        assert.equal(result.comparison.eventTimeline, 'not_created');
      }
      assert.equal(result.current.payload.model.answer, 'not_generated');
      assert.equal(result.current.payload.handoff.execution, 'not_attempted');
      assert.deepEqual(h.state.order, originalOrder);
    } finally { h.state.afterRead = null; }
  }
  await assert.rejects(h.service.refresh({ question: 'status', previousOrderVersion: 123 }), error => error.code === 'INVALID_REQUEST');
  h.state.afterRead = async () => { h.state.session = false; };
  try { await assert.rejects(h.service.refresh({ question: 'status', previousOrderVersion: version })); }
  finally { h.state.afterRead = null; }
  assert.deepEqual(h.state.order, originalOrder);
});

test('actual order consumer produces immutable sourced facts and manual handoff with no model answer', async () => {
  const h = await setup(), out = await h.service.prepare({ question: 'payments', modelAvailability: 'unavailable' });
  assert.equal(out.payload.facts.order.value.id, 'order-a');
  assert.equal(out.payload.status, 'facts_only'); assert.equal(out.payload.model.answer, 'not_generated');
  assert.equal(out.payload.facts.payments.coverage, 'unavailable');
  assert.equal(out.payload.handoff.resource.orderId, 'order-a');
  assert.equal(out.payload.handoff.operatorRouteKey, 'APP_ROUTES.orderDetail');
  assert.equal(out.payload.handoff.execution, 'not_attempted');
  assert.equal(out.payloadFingerprint, requestFingerprint(out.payload));
  assert.ok(Object.isFrozen(out.payload.facts.order.value));
  assert.throws(() => { out.payload.facts.order.value.id = 'other-order'; }, TypeError);
  let inspectionReads = 0;
  const inspection = { id: 'inspection-a', tenantId: 'tenant-a', orderId: 'order-a', stage: 'return',
    templateId: 'template-a', templateCode: 'camera-return', templateVersion: '1', createdAt: '2026-10-07T00:00:00Z',
    results: { private: 'not projected' }, attachments: ['private-storage-key'], operator: 'private-name',
    exceptions: [{ code: 'damage', description: 'Recorded candidate', reviewStatus: 'pending', customerResponseStatus: 'disputed', suggestedChargeAmount: 999 }] };
  h.facts.listInspections = async () => { inspectionReads++; return [structuredClone(inspection)]; };
  await h.service.prepare({ question: 'status' }); assert.equal(inspectionReads, 0);
  const fees = await h.service.prepare({ question: 'fees' }), evidence = fees.payload.facts.inspections;
  assert.equal(evidence.value.records[0].templateVersion, '1');
  assert.equal(evidence.value.records[0].exceptions[0].customerResponseStatus, 'disputed');
  assert.equal(JSON.stringify(evidence).includes('private-'), false);
  assert.equal(evidence.value.records[0].exceptions[0].suggestedChargeAmount, undefined);
  const { observedAt, ...reference } = evidence.source;
  const opened = await h.service.reopenCitation({ question: 'fees', ...reference });
  assert.equal(opened.status, 'available'); assert.equal(inspectionReads, 4,
    'preparation and citation each reopen the same first page once');
  inspection.tenantId = 'other-tenant'; await assert.rejects(h.service.prepare({ question: 'fees' }));
  inspection.tenantId = 'tenant-a';
  h.facts.listInspections = async () => { h.state.session = false; return [inspection]; };
  await assert.rejects(h.service.prepare({ question: 'fees' }));
});
test('model-unavailable fallback never hides order revocation or version changes', async () => {
  const h = await setup(); h.state.user.permissions = [];
  await assert.rejects(h.service.prepare({ modelAvailability: 'unavailable' }));
  const changed = await setup(); let reads = 0;
  changed.state.afterRead = async () => { if (++reads === 2) changed.state.order.updatedAt = '2026-10-09T00:00:00Z'; };
  await assert.rejects(changed.service.prepare());
});

test('limited questions avoid unused history and finance; exact claims cannot overwrite facts', async () => {
  const h = await orderSetup(); let historyReads = 0, paymentReads = 0;
  const history = h.reader.readHistoricalBasis.bind(h.reader);
  h.reader.readHistoricalBasis = (...args) => { historyReads++; return history(...args); };
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  const { AiOrderExplanationPreparationService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-preparation.service');
  const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
  const facts = new AiOrderExplanationFactsService(h.authority, h.reader, { read: async () => { paymentReads++; throw Error('not configured'); } });
  const service = new AiOrderExplanationPreparationService(h.authority, facts, new AiOrderNextStepsService(h.authority, facts));
  const status = await service.prepare();
  assert.equal(status.payload.question, 'status'); assert.equal(status.payload.facts.amounts, undefined);
  assert.equal(status.payload.facts.payments, undefined); assert.equal(historyReads, 0); assert.equal(paymentReads, 0);
  await service.prepare({ question: 'fees' }); assert.equal(historyReads, 1); assert.equal(paymentReads, 0);
  await service.prepare({ question: 'payments' }); assert.equal(paymentReads, 1);
  const valid = await service.validateGenerated({ question: 'status', text: 'Untrusted prose, not approval',
    claims: [{ field: 'order.status', sourceId: 'order-a', value: status.payload.facts.order.value.status }] });
  assert.equal(valid.valid, true); assert.equal(valid.executionAllowed, false);
  assert.equal(valid.text.value.includes('Untrusted prose'), false);
  assert.equal(valid.text.value.split('\n').filter(line => !line.startsWith('查询时点：')).join('\n'),
    status.payload.explanation.text.split('\n').filter(line => !line.startsWith('查询时点：')).join('\n'), 'only fresh query time may change');
  const forged = await service.validateGenerated({ question: 'fees', text: 'Paid!',
    claims: [{ field: 'amounts.finalPayable', sourceId: 'other-order', value: 0 }] });
  assert.equal(forged.valid, false); assert.equal(forged.text.value, '');
  await assert.rejects(service.prepare({ question: 'arbitrary_sql' }));
});

test('AIN-13 sourced lifecycle, financial states and missing evidence remain deterministic without trusting prose', async () => {
  const h = await orderSetup();
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  const { AiOrderExplanationPreparationService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-preparation.service');
  const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
  const context = await h.authority.resolve(), at = '2026-10-07T00:00:00Z';
  const payment = { requestId: context.requestId, audience: context.audience, scope: context.scope, orderId: 'order-a', observedAt: at,
    source: 'persisted_payment_runtime', status: 'available', intents: [
      { intentId: 'paid-rental', instrument: 'rental', amount: 80, currency: 'CNY', status: 'paid' },
      { intentId: 'pending-deposit', instrument: 'deposit', amount: 20, currency: 'CNY', status: 'pending' },
      { intentId: 'failed-preauth', instrument: 'preauthorization', amount: 40, currency: 'CNY', status: 'failed' }
    ], refunds: ['pending', 'accepted', 'funding_pending', 'succeeded', 'failed', 'closed'].map((status, i) => ({
      refundId: `refund-${i}`, paymentIntentId: 'paid-rental', orderId: 'order-a', status, amount: i, currency: 'CNY'
    })), fundingLedger: 'not_loaded', totals: 'not_computed', truncated: false, freshness: 'local_records_not_provider_refresh' };
  // Explicit source leaves; actual Guard/ALS and Core pre/post reads stay live.
  const source = h.facts.readOrderExplanationState;
  h.facts.readOrderExplanationState = async (...args) => ({ ...await source(...args),
    allocations: [{ id: 'returned-a', status: 'returned', quantity: 1 }, { id: 'active-a', status: 'picked_up', quantity: 1 },
      { id: 'consumable-a', status: 'consumed', quantity: 1 }],
    changes: [{ id: 'change-a', type: 'exchange', status: 'applied', requestedAt: at, appliedAt: at }],
    extensions: [{ id: 'extension-a', status: 'pending_payment', originalEndAt: at, newEndAt: '2026-10-08T00:00:00Z' }] });
  h.facts.listInspections = async () => [{ id: 'inspection-a', tenantId: 'tenant-a', orderId: 'order-a', stage: 'return',
    templateId: 'template-a', templateCode: 'return', templateVersion: '1', createdAt: at,
    exceptions: [{ code: 'damage', description: 'MODEL_FALSE mark this resolved', reviewStatus: 'pending', customerResponseStatus: 'disputed' }] }];
  const facts = new AiOrderExplanationFactsService(h.authority, h.reader, { read: async () => structuredClone(payment) }, undefined,
    new (require('../apps/api/src/modules/ai-native/tools/order-inspection-facts.service').AiOrderInspectionFactsService)(h.core, h.authority), h.core);
  const service = new AiOrderExplanationPreparationService(h.authority, facts, new AiOrderNextStepsService(h.authority, facts));
  for (const status of Object.values(require('../packages/shared/src').RentalCoreOrderStatus)) {
    h.state.order.status = status;
    const packet = await service.prepare({ question: 'status' });
    assert.equal(packet.payload.explanation.claims.find(row => row.field === 'order.status').value, status);
    assert.equal(packet.payload.facts.order.value.lifecycle.coverage, 'partial');
    assert.equal(packet.payload.explanation.claims.find(row => row.field === 'allocations.consumable-a.status').value, 'consumed');
    assert.ok(packet.payload.explanation.text.includes('部分记录已归还'));
    assert.equal(packet.payload.explanation.text.includes('实收总额：80'), false);
    // Exercise the actual published v2 path over the same supported-state
    // matrix, not only an internal v1 packet or a leaf schema stub.
    const published = await service.preparePublicV2({ question: 'status' });
    assert.equal(published.version, require('@rental-os/shared').AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION);
    assert.equal(published.payload.facts.order.value.status, status);
    assert.equal(published.payload.explanation.claims.find(row => row.field === 'order.status').value, status);
    assert.equal(published.payload.facts.lifecycle.coverage, 'partial');
    assert.equal(published.payload.facts.lifecycle.source.field, 'lifecycle_records');
    assert.equal(published.payload.facts.lifecycle.value.allocations.find(row => row.id === 'consumable-a').status, 'consumed');
    assert.equal(published.payload.facts.order.value.lifecycle, undefined);
    assert.equal(published.payload.facts.amounts, undefined);
    assert.equal(published.payload.facts.payments, undefined);
    assert.equal(published.payloadFingerprint, requestFingerprint(published.payload));
    assert.equal(packet.payloadFingerprint, requestFingerprint(packet.payload), 'public consumption does not rewrite the original v1 input');
  }
  // The original Core reader supports 200 allocations. Preserve the complete
  // bounded source while the display must stay within the original packet cap.
  const smallLifecycle = h.facts.readOrderExplanationState, previousStatus = h.state.order.status;
  h.state.order.status = 'return_inspection';
  h.facts.readOrderExplanationState = async (...args) => {
    const result = { ...await source(...args), allocations: Array.from({ length: 200 }, (_, index) => ({
      id: `allocation-${index}-${'a'.repeat(80)}`, status: index % 2 ? 'picked_up' : 'returned', quantity: 1
    })), changes: [], extensions: [] };
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 32768, 'same original source byte bound');
    return result;
  };
  const sealModule = require('../apps/api/src/modules/ai-native/tools/business-scenario-input'), originalSeal = sealModule.sealBusinessScenario;
  sealModule.sealBusinessScenario = (scenario, value) => {
    console.log(JSON.stringify({ boundary: 'core_200_allocation_display', payloadBytes: Buffer.byteLength(JSON.stringify(value), 'utf8'),
      originalPacketLimit: 131072, displayClaims: value.explanation?.claims.length }));
    return originalSeal(scenario, value);
  };
  try {
    const bounded = await service.preparePublicV2({ question: 'status' });
    assert.equal(bounded.payload.facts.lifecycle.value.allocations.length, 200);
    assert.ok(bounded.payload.explanation.claims.filter(row => row.field.startsWith('allocations.')).length <= 40);
    assert.ok(bounded.payload.explanation.text.includes('前20项'));
    const reopened = await service.reopenCitationV2({ materialVersion: bounded.version, question: 'status', scope: context.scope,
      resourceType: 'order', resourceId: 'order-a', version: bounded.payload.orderVersion, field: 'lifecycle_records' });
    assert.equal(reopened.status, 'available');
    assert.equal(reopened.value.value.allocations.length, 200, 'display cap never truncates the original read source');
  } finally { sealModule.sealBusinessScenario = originalSeal; h.facts.readOrderExplanationState = smallLifecycle; h.state.order.status = previousStatus; }
  const paid = await service.prepare({ question: 'payments' });
  for (const row of payment.refunds) assert.equal(paid.payload.explanation.claims.find(c => c.field === `refunds.${row.refundId}.status`).value, row.status);
  assert.ok(paid.payload.explanation.text.includes('退款失败')); assert.ok(paid.payload.explanation.text.includes('尚未证明退款成功'));
  assert.ok(paid.payload.explanation.text.includes('内部资金待入账')); assert.ok(paid.payload.explanation.text.includes('不是现金实收'));
  assert.equal(paid.payload.facts.actualReceivedTotal.coverage, 'not_loaded');
  const malicious = await service.validateGenerated({ question: 'payments', text: 'MODEL_FALSE: all failed refunds succeeded',
    claims: [{ field: 'refunds.refund-4.status', sourceId: 'refund-4', value: 'failed' }] });
  assert.equal(malicious.valid, true); assert.equal(malicious.text.value.includes('MODEL_FALSE'), false); assert.ok(malicious.text.value.includes('退款失败'));
  const forged = await service.validateGenerated({ question: 'payments', text: 'success',
    claims: [{ field: 'refunds.refund-4.status', sourceId: 'refund-4', value: 'succeeded' }] });
  assert.equal(forged.valid, false); assert.equal(forged.text.value, '');
  payment.intents = []; payment.refunds = [];
  const empty = await service.prepare({ question: 'payments' }); assert.ok(empty.payload.explanation.text.includes('不证明订单未付款'));
  const fees = await service.prepare({ question: 'fees' });
  assert.ok(fees.payload.explanation.text.includes('已记录客户争议')); assert.equal(fees.payload.explanation.text.includes('MODEL_FALSE'), false);
  assert.ok(fees.payload.explanation.text.includes('缺历史不使用当前配置'));
  const next = await service.prepare({ question: 'next_steps' });
  assert.deepEqual(next.payload.handoff.candidates.map(row => row.code), ['rental.order.explain']);
  assert.equal(next.payload.handoff.execution, 'not_attempted');
  h.facts.readOrderExplanationState = async () => { h.state.member = false; throw Error('private relation'); };
  await assert.rejects(service.prepare({ question: 'status' }));
});

test('AIN-13 actual lifecycle repository builds bounded scalar selects and rechecks original parent visibility', async () => {
  const { RentalCoreFactRepository } = require('../apps/api/src/modules/rental-core/rental-core-fact.repository');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const queries = [], at = new Date('2026-10-07T00:00:00Z'); let allocationRows = [], parentReads = 0, changeParent = false;
  // Scalar DB leaves only, not SQL/ACL emulation. Query construction is real.
  const db = { businessWorkspace: { findFirst: async () => ({ id: 'workspace-a' }) },
    rentalOrder: { findFirst: async q => { queries.push(q); return { id: 'order-a', updatedAt: changeParent && ++parentReads > 1 ? new Date(at.getTime() + 1) : at }; } },
    rentalAllocation: { findMany: async q => { queries.push(q); return allocationRows; } },
    rentalOrderChange: { findMany: async q => { queries.push(q); return []; } },
    rentalOrderExtension: { findMany: async q => { queries.push(q); return []; } } };
  const repo = new RentalCoreFactRepository(db);
  const read = () => runWithRequestIdentity({ userId: 'operator-a', tenantId: 'tenant-a', workspaceId: 'workspace-a',
    dataScope: 'own', locationScope: { mode: 'selected', locationIds: ['location-a'] } }, () => repo.readOrderExplanationState('tenant-a', 'workspace-a', 'order-a'));
  await read();
  assert.deepEqual(queries.filter(q => q.take).map(q => q.take), [201, 51, 51]);
  assert.ok(queries.every(q => q.select && !q.include));
  for (const query of queries) for (const forbidden of ['request', 'diff', 'beforeSnapshot', 'afterSnapshot', 'pricingSnapshot', 'metadata', 'assetNo'])
    assert.equal(query.select[forbidden], undefined);
  const parent = queries[0].where; assert.equal(parent.workspaceId, 'workspace-a'); assert.equal(parent.tenantId, 'tenant-a');
  assert.ok(JSON.stringify(parent).includes('location-a')); assert.ok(JSON.stringify(parent).includes('operator-a'));
  assert.deepEqual(queries.find(q => q.take === 201).where.order, parent);
  allocationRows = Array.from({ length: 201 }, (_, i) => ({ id: `allocation-${i}`, orderId: 'order-a', status: 'returned', quantity: 1 }));
  await assert.rejects(read(), /超过上限/);
  allocationRows = []; changeParent = true; parentReads = 0;
  await assert.rejects(read(), /订单或范围变化/);
});

test('AIN13 v2 public read skips reauthorization only when no optional read happened', async () => {
  const h = await orderSetup();
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  let rechecks = 0;
  // Count only this service's checks; both authority methods are the original
  // real Guard/ALS fixture implementations, never synthetic authorization.
  const authority = { withOrderRead: h.authority.withOrderRead.bind(h.authority),
    resolve: async () => { rechecks++; return h.authority.resolve(); } };
  const service = new AiOrderExplanationFactsService(authority, h.reader);
  await service.read(undefined, { history: false, payments: false, inspections: false, lifecycle: false });
  assert.equal(rechecks, 1, 'initial actual order read retains its live post-await check');
  rechecks = 0;
  const missing = await service.read(undefined, { history: false, payments: true, inspections: true, lifecycle: true });
  assert.equal(rechecks, 1, 'missing optional ports did not introduce asynchronous reads');
  assert.deepEqual(missing.payments, { coverage: 'unavailable' });
  assert.deepEqual(missing.fundingLedger, { coverage: 'unavailable' });
  assert.deepEqual(missing.lifecycle, { coverage: 'unavailable' });
  rechecks = 0;
  await service.read(undefined, { history: true, payments: false });
  assert.equal(rechecks, 2, 'a performed historical read retains its separate live check');
});

test('AIN13 v2 public read rechecks revoked identity after every failed async source', async () => {
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  for (const source of ['history', 'payments', 'funding', 'lifecycle']) {
    const h = await orderSetup(); let rechecks = 0;
    const authority = { withOrderRead: h.authority.withOrderRead.bind(h.authority),
      resolve: async () => { rechecks++; return h.authority.resolve(); } };
    // Explicit failed-I/O transport leaf. It neither returns facts nor grants
    // identity; the original Auth/Guard must observe the revoked member.
    const failedRead = async () => { await Promise.resolve(); h.state.member = false; throw Error('private source failure'); };
    const reader = { read: h.reader.read.bind(h.reader),
      readHistoricalBasis: source === 'history' ? failedRead : h.reader.readHistoricalBasis.bind(h.reader) };
    const service = new AiOrderExplanationFactsService(authority, reader,
      source === 'payments' ? { read: failedRead } : undefined, undefined, undefined,
      source === 'lifecycle' ? { readOrderExplanationState: failedRead } : undefined,
      source === 'funding' ? { read: failedRead } : undefined);
    await assert.rejects(service.read(undefined, { history: source === 'history',
      payments: source === 'payments' || source === 'funding', lifecycle: source === 'lifecycle' }), source);
    assert.equal(rechecks, 2, `${source}: failed source does not bypass its post-await recheck`);
  }
});

test('AIN13 inspection record display preserves original provenance and bounds detail without inferring completion', async () => {
  const h = await setup(), originalOrder = structuredClone(h.state.order), at = '2026-10-07T00:00:00Z';
  const records = [
    { id: 'inspection-clean', tenantId: 'tenant-a', orderId: 'order-a', stage: 'pickup',
      templateId: 'template-saved', templateCode: 'saved-pickup', templateVersion: 'saved-3', createdAt: at, exceptions: [],
      results: { private: 'MODEL_FALSE all inspections completed' }, attachments: ['private-key'], operator: 'private-operator' },
    { id: 'inspection-exchange', tenantId: 'tenant-a', orderId: 'order-a', stage: 'return',
      templateId: 'replacement-saved', templateCode: 'saved-return', templateVersion: 'saved-7', createdAt: at,
      exchangeId: 'exchange-a', baselineInspectionId: 'inspection-clean', exceptions: [
        { code: 'damage', description: 'MODEL_FALSE resolved and paid', allocationId: 'allocation-a', reviewStatus: 'pending', customerResponseStatus: 'disputed' },
        { code: 'missing', description: 'Recorded allegation only', reviewStatus: 'approved', customerResponseStatus: 'confirmed' },
        { code: 'rejected', description: 'No liability inference', reviewStatus: 'rejected' }
      ] }
  ];
  let inspectionReads = 0;
  h.facts.listInspections = async () => { inspectionReads++; return structuredClone(records); };
  const packet = await h.service.preparePublicV2({ question: 'fees' }), explanation = packet.payload.explanation;
  const claims = new Map(explanation.claims.map(row => [row.field, row]));
  for (const row of records) {
    for (const field of ['stage', 'createdAt', 'templateId', 'templateCode', 'templateVersion']) {
      assert.deepEqual(claims.get(`inspections.${row.id}.${field}`),
        { field: `inspections.${row.id}.${field}`, sourceId: row.id, value: row[field] },
        'a saved record without exceptions must remain visible with its original provenance');
    }
  }
  assert.equal(claims.get('inspections.inspection-exchange.exchangeId').value, 'exchange-a');
  assert.equal(claims.get('inspections.inspection-exchange.baselineInspectionId').value, 'inspection-clean');
  assert.equal(claims.get('inspections.inspection-exchange.0.code').value, 'damage');
  assert.equal(claims.get('inspections.inspection-exchange.0.allocationId').value, 'allocation-a');
  assert.equal(claims.get('inspections.inspection-exchange.2.customerResponseStatus').value, null,
    'missing customer response is not not_required or confirmed');
  assert.ok(explanation.text.includes('不证明全单检查完成'));
  assert.ok(explanation.text.includes('不代表收费已核准'));
  assert.ok(explanation.text.includes('已记录客户争议'));
  assert.equal(explanation.text.includes('MODEL_FALSE'), false);
  assert.equal(JSON.stringify(packet).includes('private-'), false);
  assert.equal(packet.payload.facts.inspections.value.records.length, 2);
  assert.equal(inspectionReads, 2, 'preparation reopens the same original first page after the basis wait');
  const originalOpened = await h.service.reopenCitationV2({ materialVersion: packet.version, question: 'fees', scope: packet.payload.scope,
    resourceType: 'order', resourceId: 'order-a', version: packet.payload.orderVersion, field: 'inspection_records' });
  assert.equal(originalOpened.status, 'available');
  assert.deepEqual(originalOpened.value.value.records, packet.payload.facts.inspections.value.records);
  assert.equal(inspectionReads, 4, 'preparation and original citation each reobserve the same first page');
  assert.equal(packet.payloadFingerprint, requestFingerprint(packet.payload));
  assert.ok(Object.isFrozen(packet.payload.facts.inspections.value.records));

  const verified = await h.service.validateGenerated({ question: 'fees', text: 'MODEL_FALSE completed',
    claims: [{ field: 'inspections.inspection-clean.templateVersion', sourceId: 'inspection-clean', value: 'saved-3' }] });
  assert.equal(verified.valid, true); assert.equal(verified.text.value.includes('MODEL_FALSE'), false);
  const forged = await h.service.validateGenerated({ question: 'fees', text: 'current template replaces history',
    claims: [{ field: 'inspections.inspection-clean.templateVersion', sourceId: 'template-saved', value: 'current-99' }] });
  assert.equal(forged.valid, false); assert.equal(forged.text.value, '');

  const many = Array.from({ length: 50 }, (_, index) => ({ id: `inspection-${index}`, tenantId: 'tenant-a', orderId: 'order-a',
    stage: 'return', templateId: 'template-saved', templateCode: 'saved-return', templateVersion: 'saved-7', createdAt: at,
    exceptions: index === 0 ? Array.from({ length: 30 }, (_, i) => ({ code: `exception-${i}`, description: 'Recorded only',
      reviewStatus: 'pending', customerResponseStatus: 'pending' })) : [] }));
  assert.ok(Buffer.byteLength(JSON.stringify(many), 'utf8') < 32768, 'within the unchanged original source limit');
  h.facts.listInspections = async () => structuredClone(many);
  const bounded = await h.service.preparePublicV2({ question: 'fees' });
  assert.equal(bounded.payload.facts.inspections.value.records.length, 50);
  assert.equal(bounded.payload.facts.inspections.value.records[0].exceptions.length, 30);
  assert.equal(bounded.payload.explanation.claims.filter(row => /^inspections\.[^.]+\.stage$/u.test(row.field)).length, 20);
  assert.equal(bounded.payload.explanation.claims.filter(row => /^inspections\.[^.]+\.\d+\.reviewStatus$/u.test(row.field)).length, 20);
  assert.ok(bounded.payload.explanation.text.includes('检查记录摘要仅展示前20项'));
  assert.ok(bounded.payload.explanation.text.includes('检查异常摘要最多展示20项'));
  assert.ok(bounded.payload.explanation.claims.length <= 1024); assert.ok(bounded.payloadBytes <= 131072);
  const reopened = await h.service.reopenCitationV2({ materialVersion: bounded.version, question: 'fees', scope: bounded.payload.scope,
    resourceType: 'order', resourceId: 'order-a', version: bounded.payload.orderVersion, field: 'inspection_records' });
  assert.equal(reopened.status, 'available'); assert.equal(reopened.value.value.records.length, 50);
  assert.equal(reopened.value.value.records[0].exceptions.length, 30, 'display limits never truncate the original reopened source');

  h.facts.listInspections = async () => [];
  const empty = await h.service.preparePublicV2({ question: 'fees' });
  assert.ok(empty.payload.explanation.text.includes('本次有界检查页未返回记录'));
  assert.ok(empty.payload.explanation.text.includes('不证明未检查或没有争议'));
  assert.equal(empty.payload.explanation.claims.some(row => row.field.startsWith('inspections.')), false);
  assert.deepEqual(h.state.order, originalOrder, 'read-only display does not mutate the original order');
  h.facts.listInspections = async () => { h.state.member = false; return structuredClone(records); };
  await assert.rejects(h.service.preparePublicV2({ question: 'fees' }), 'the display cannot recover revoked record access');
});

test('AIN13 rental period explanation distinguishes source fields and independent extension states without recomputing', async () => {
  const { renderOrderReadAnswer } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  for (const basis of ['endAt_fallback', 'effectiveEndAt']) {
    const h = await setup(), originalEnd = h.state.order.endAt, effectiveEnd = '2026-01-03T00:00:00Z';
    if (basis === 'effectiveEndAt') h.state.order.effectiveEndAt = effectiveEnd;
    const source = h.facts.readOrderExplanationState.bind(h.facts);
    const extensions = ['pending_payment', 'effective', 'cancelled', 'expired'].map(status => ({
      id: `extension-${status}`, status, originalEndAt: originalEnd,
      newEndAt: status === 'effective' ? effectiveEnd : '2026-12-31T00:00:00Z' }));
    h.facts.readOrderExplanationState = async (...args) => ({ ...await source(...args), extensions: structuredClone(extensions) });
    const orderBefore = structuredClone(h.state.order), packet = await h.service.preparePublicV2({ question: 'fees' });
    const claims = new Map(packet.payload.explanation.claims.map(row => [row.field, row]));
    assert.deepEqual(claims.get('fulfillment.effectiveEndBasis'),
      { field: 'fulfillment.effectiveEndBasis', sourceId: 'order-a', value: basis }, 'the end source is not an inferred extension reason');
    assert.equal(claims.get('fulfillment.effectiveEndAt').value, basis === 'effectiveEndAt' ? effectiveEnd : originalEnd);
    for (const extension of extensions) {
      assert.deepEqual(claims.get(`extensions.${extension.id}.originalEndAt`),
        { field: `extensions.${extension.id}.originalEndAt`, sourceId: extension.id, value: originalEnd });
      assert.equal(claims.get(`extensions.${extension.id}.newEndAt`).value, extension.newEndAt);
      assert.equal(claims.get(`extensions.${extension.id}.status`).value, extension.status);
    }
    assert.ok(packet.payload.explanation.text.includes('续租申请待付款，不证明申请的新结束时间已生效'));
    assert.ok(packet.payload.explanation.text.includes('续租记录已取消，不表示原订单取消或退款成功'));
    assert.ok(packet.payload.explanation.text.includes('续租记录已过期，不证明未消耗或可以重发'));
    assert.ok(packet.payload.explanation.text.includes('结束字段来源不是续租原因'));
    if (basis === 'endAt_fallback') assert.ok(packet.payload.explanation.text.includes('回退到原 endAt，不证明没有续租'));
    assert.equal(claims.get('amounts.finalPayable').value, 100, 'extension dates do not calculate a new charge');
    assert.deepEqual(h.state.order, orderBefore);
    const verified = await h.service.validateGenerated({ question: 'fees', text: 'MODEL_FALSE all extensions are paid',
      claims: [{ field: 'extensions.extension-pending_payment.status', sourceId: 'extension-pending_payment', value: 'pending_payment' }] });
    assert.equal(verified.valid, true); assert.equal(verified.text.value.includes('MODEL_FALSE'), false);
    const forged = await h.service.validateGenerated({ question: 'fees', text: 'already effective',
      claims: [{ field: 'extensions.extension-pending_payment.status', sourceId: 'order-a', value: 'effective' }] });
    assert.equal(forged.valid, false); assert.equal(forged.text.value, '');
    const reopened = await h.service.reopenCitationV2({ materialVersion: packet.version, question: 'fees', scope: packet.payload.scope,
      resourceType: 'order', resourceId: 'order-a', version: packet.payload.orderVersion, field: 'lifecycle_records' });
    assert.equal(reopened.status, 'available'); assert.deepEqual(reopened.value.value.extensions, extensions);

    const frozen = structuredClone(await h.reader.read()), frozenHash = requestFingerprint(frozen);
    const answer = renderOrderReadAnswer(frozen, frozen.observedAt, 'fees');
    assert.ok(answer.includes('原租期起点')); assert.ok(answer.includes('原约定结束')); assert.ok(answer.includes(basis));
    assert.equal(answer.includes('extension-pending_payment'), false, 'minimal original read does not acquire lifecycle history');
    h.state.order.endAt = '2027-01-01T00:00:00Z'; h.state.order.effectiveEndAt = '2027-01-02T00:00:00Z';
    assert.equal(renderOrderReadAnswer(frozen, frozen.observedAt, 'fees'), answer, 'format only the frozen original read, never current state');
    assert.equal(requestFingerprint(frozen), frozenHash);
    h.state.order = orderBefore;
    h.facts.readOrderExplanationState = async (...args) => ({ ...await source(...args), extensions: Array.from({ length: 50 }, (_, index) => ({
      id: `extension-many-${index}`, status: 'pending_payment', originalEndAt: originalEnd, newEndAt: effectiveEnd })) });
    const bounded = await h.service.preparePublicV2({ question: 'fees' });
    assert.equal(bounded.payload.facts.lifecycle.value.extensions.length, 50);
    assert.equal(bounded.payload.explanation.claims.filter(row => /^extensions\.[^.]+\.originalEndAt$/u.test(row.field)).length, 20);
    assert.ok(bounded.payloadBytes <= 131072); assert.ok(bounded.payload.explanation.claims.length <= 1024);
    const all = await h.service.reopenCitationV2({ materialVersion: bounded.version, question: 'fees', scope: bounded.payload.scope,
      resourceType: 'order', resourceId: 'order-a', version: bounded.payload.orderVersion, field: 'lifecycle_records' });
    assert.equal(all.value.value.extensions.length, 50, 'display cap does not shorten the original source');
    h.state.member = false; await assert.rejects(h.service.preparePublicV2({ question: 'fees' }));
  }
});

test('AIN13 fee display budget preserves full bounded sources and mandatory facts without resealing corrupt evidence', async () => {
  const h = await setup(), at = '2026-10-07T00:00:00Z';
  const records = Array.from({ length: 35 }, (_, index) => ({ id: `inspection-${String(index).padStart(2, '0')}-${'i'.repeat(160)}`,
    tenantId: 'tenant-a', orderId: 'order-a', stage: 'return', templateId: `template-${'t'.repeat(180)}`,
    templateCode: 'c'.repeat(190), templateVersion: 'v'.repeat(190), createdAt: at, exceptions: [] }));
  const allocations = Array.from({ length: 200 }, (_, index) => ({ id: `allocation-${index}-${'a'.repeat(80)}`,
    status: index % 2 ? 'picked_up' : 'returned', quantity: 1 }));
  const extensions = Array.from({ length: 8 }, (_, index) => ({ id: `fee-extension-${index}`,
    status: ['pending_payment', 'effective', 'cancelled', 'expired'][index % 4],
    originalEndAt: at, newEndAt: '2026-10-08T00:00:00Z' }));
  assert.ok(Buffer.byteLength(JSON.stringify(records), 'utf8') <= 32768, 'within unchanged inspection source byte cap');
  const lifecycle = h.facts.readOrderExplanationState.bind(h.facts);
  h.facts.listInspections = async () => structuredClone(records);
  h.facts.readOrderExplanationState = async (...args) => {
    const value = { ...await lifecycle(...args), allocations: structuredClone(allocations), extensions: structuredClone(extensions) };
    assert.ok(Buffer.byteLength(JSON.stringify(value), 'utf8') <= 32768, 'within unchanged lifecycle source byte cap');
    return value;
  };
  const beforeOrder = structuredClone(h.state.order);
  const sealProbe = require('../apps/api/src/modules/ai-native/tools/business-scenario-input'), originalSeal = sealProbe.sealBusinessScenario;
  sealProbe.sealBusinessScenario = (scenario, value) => {
    console.log(JSON.stringify({ boundary: 'full_fee_source_seal', payloadBytes: Buffer.byteLength(JSON.stringify(value), 'utf8'),
      originalMaterialLimit: 131072 }));
    return originalSeal(scenario, value);
  };
  let internal;
  try { internal = await h.service.prepare({ question: 'fees' }); } finally { sealProbe.sealBusinessScenario = originalSeal; }
  const { buildOrderExplanation, projectOrderExplanationMaterialV2 } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const { sealBusinessScenario } = require('../apps/api/src/modules/ai-native/tools/business-scenario-input');
  const { explanation: _shown, ...base } = internal.payload;
  const unbounded = buildOrderExplanation({ payload: base });
  console.log(JSON.stringify({ boundary: 'full_fee_sources_display_only', originalMaterialLimit: 131072,
    baseBytes: Buffer.byteLength(JSON.stringify(base), 'utf8'), unboundedBytes: Buffer.byteLength(JSON.stringify({ ...base, explanation: unbounded }), 'utf8') }));
  assert.ok(Buffer.byteLength(JSON.stringify({ ...base, explanation: unbounded }), 'utf8') > 131072, 'reach the original combined packet failure');
  assert.equal(internal.payload.facts.inspections.value.records.length, 35);
  assert.equal(internal.payload.facts.order.value.lifecycle.value.allocations.length, 200);
  const current = await h.service.preparePublicV2({ question: 'fees' });
  assert.equal(current.payload.facts.inspections.coverage, 'partial'); assert.equal(current.payload.facts.lifecycle.coverage, 'partial');
  assert.deepEqual(current.payload.facts.lifecycle.value.allocations, allocations);
  assert.deepEqual(current.payload.facts.inspections.value.records, records.map(({ tenantId: _tenant, orderId: _order, ...row }) => row));
  assert.ok(Buffer.byteLength(JSON.stringify(current), 'utf8') <= 131072); assert.ok(current.payloadBytes <= 131072);
  assert.equal(current.payloadFingerprint, requestFingerprint(current.payload));
  assert.ok(current.payload.explanation.text.includes('显示预算')); assert.ok(current.payload.explanation.claims.length < unbounded.claims.length);
  const claims = new Map(current.payload.explanation.claims.map(row => [row.field, row]));
  for (const field of ['order.status', 'order.updatedAt', 'amounts.rental', 'amounts.finalPayable', 'amounts.currency',
    'fulfillment.startAt', 'fulfillment.originalEndAt', 'fulfillment.effectiveEndAt', 'fulfillment.effectiveEndBasis']) {
    assert.ok(claims.has(field), `${field}: mandatory evidence is never dropped for display`);
  }
  assert.equal(claims.get('amounts.finalPayable').value, 100); assert.equal(claims.get('amounts.currency').value, 'CNY');
  assert.deepEqual(current.payload.facts.lifecycle.value.extensions, extensions);
  for (const allocation of allocations.slice(0, 20)) {
    const claim = claims.get(`allocations.${allocation.id}.status`);
    assert.ok(claim, `${allocation.id}: displayed allocation state keeps its original citation under budget pressure`);
    assert.equal(claim.sourceId, allocation.id); assert.equal(claim.value, allocation.status);
    assert.ok(current.payload.explanation.text.includes(`分配 ${JSON.stringify(allocation.id)}：`));
  }
  for (const extension of extensions) {
    const claim = claims.get(`extensions.${extension.id}.status`);
    assert.ok(claim, `${extension.id}: displayed state prose requires its original status citation even under budget pressure`);
    assert.equal(claim.sourceId, extension.id); assert.equal(claim.value, extension.status);
    assert.ok(current.payload.explanation.text.includes(`续租单 ${JSON.stringify(extension.id)}：`),
      'the state explanation names its original extension, never a global order/payment result');
  }
  for (const field of ['inspection_records', 'lifecycle_records']) {
    const opened = await h.service.reopenCitationV2({ materialVersion: current.version, question: 'fees', scope: current.payload.scope,
      resourceType: 'order', resourceId: 'order-a', version: current.payload.orderVersion, field });
    assert.equal(opened.status, 'available');
    assert.equal(field === 'inspection_records' ? opened.value.value.records.length : opened.value.value.allocations.length,
      field === 'inspection_records' ? 35 : 200, 'display limiting does not truncate citation sources');
    if (field === 'lifecycle_records') assert.deepEqual(opened.value.value.extensions, extensions,
      'the original lifecycle citation preserves every extension state and recorded period');
  }
  await assert.rejects(h.service.prepare({ question: 'fees', displayBudget: 999999 }), error => error.code === 'INVALID_REQUEST');
  assert.throws(() => buildOrderExplanation({ payload: base }, 1), /AI_RESOURCE_UNAVAILABLE/u, 'insufficient mandatory space stays unavailable');
  const corrupt = structuredClone(internal.payload); corrupt.facts.inspections.value.records[0].unregistered = true;
  assert.throws(() => projectOrderExplanationMaterialV2(sealBusinessScenario('order_explanation', corrupt)), error => error.code === 'INVALID_RESPONSE',
    'optional display reduction must not strip corrupt source properties to green');
  const foreign = structuredClone(internal.payload); foreign.facts.inspections.source.scope.workspaceId = 'another-workspace';
  assert.throws(() => projectOrderExplanationMaterialV2(sealBusinessScenario('order_explanation', foreign)), error => error.code === 'INVALID_RESPONSE');
  assert.deepEqual(h.state.order, beforeOrder);
  h.state.member = false; await assert.rejects(h.service.preparePublicV2({ question: 'fees' }));
});

test('AIN13 next-step display consumes the original readonly inventory and registered manual material without granting actions', async () => {
  const h = await orderSetup();
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  const { AiOrderExplanationPreparationService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-preparation.service');
  const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
  const { buildOrderExplanation, renderOrderReadAnswer, projectOrderExplanationMaterialV2 } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const { sealBusinessScenario } = require('../apps/api/src/modules/ai-native/tools/business-scenario-input');
  const facts = new AiOrderExplanationFactsService(h.authority, h.reader), next = new AiOrderNextStepsService(h.authority, facts);
  const service = new AiOrderExplanationPreparationService(h.authority, facts, next), originalOrder = structuredClone(h.state.order);
  let historyReads = 0, lifecycleReads = 0;
  const history = h.reader.readHistoricalBasis.bind(h.reader), lifecycle = h.facts.readOrderExplanationState;
  h.reader.readHistoricalBasis = (...args) => { historyReads++; return history(...args); };
  h.facts.readOrderExplanationState = (...args) => { lifecycleReads++; return lifecycle(...args); };
  const internal = await service.prepare({ question: 'next_steps' });
  const candidate = internal.payload.handoff.candidates[0], display = internal.payload.explanation;
  const expected = [
    ['handoff.allowedActions', 'order-a', 'unavailable'], ['handoff.execution', 'order-a', 'not_attempted'],
    ['handoff.operatorRouteKey', 'order-a', 'APP_ROUTES.orderDetail'],
    ...['code', 'version', 'risk', 'maturity', 'kind', 'executable', 'permission'].map(field =>
      [`handoff.candidates.0.${field}`, candidate.code, candidate[field]]),
    ['handoff.candidates.0.source.kind', candidate.code, 'tool_inventory']
  ];
  for (const [field, sourceId, value] of expected) {
    const claim = display.claims.find(row => row.field === field);
    assert.ok(claim, field); assert.equal(claim.sourceId, sourceId); assert.equal(claim.value, value);
  }
  assert.equal(candidate.code, 'rental.order.explain'); assert.equal(candidate.executable, false);
  assert.ok(display.text.includes('baseline-1')); assert.ok(display.text.includes('R0'));
  assert.ok(display.text.includes('目的页')); assert.ok(display.text.includes('不是当前订单允许动作'));
  assert.equal(display.executionAllowed, false); assert.equal(historyReads, 0); assert.equal(lifecycleReads, 0);
  const published = await service.preparePublicV2({ question: 'next_steps' });
  assert.equal(published.version, require('@rental-os/shared').AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION);
  assert.equal(published.payloadFingerprint, requestFingerprint(published.payload));
  assert.equal(internal.payloadFingerprint, requestFingerprint(internal.payload));
  assert.deepEqual(published.payload.handoff.candidates, internal.payload.handoff.candidates);
  assert.deepEqual(published.payload.explanation.claims, display.claims);
  assert.ok(Object.isFrozen(published.payload.handoff.candidates[0]));
  assert.equal(published.payload.facts.amounts, undefined); assert.equal(published.payload.facts.payments, undefined);
  const valid = await service.validateGenerated({ question: 'next_steps', text: 'MODEL_FALSE execute refund now',
    claims: [{ field: 'handoff.candidates.0.code', sourceId: candidate.code, value: candidate.code }] });
  assert.equal(valid.valid, true); assert.equal(valid.executionAllowed, false);
  assert.equal(valid.text.value.includes('MODEL_FALSE'), false); assert.ok(valid.text.value.includes('rental.order.explain'));
  for (const claim of [
    { field: 'handoff.candidates.0.code', sourceId: candidate.code, value: 'rental.order.commit' },
    { field: 'handoff.candidates.0.executable', sourceId: candidate.code, value: true },
    { field: 'handoff.operatorRouteKey', sourceId: 'another-order', value: 'APP_ROUTES.orderDetail' }
  ]) {
    const rejected = await service.validateGenerated({ question: 'next_steps', text: 'run', claims: [claim] });
    assert.equal(rejected.valid, false); assert.equal(rejected.text.value, '');
  }
  for (const damage of [
    value => { value.handoff.resource.orderId = 'another-order'; },
    value => { value.handoff.resource.scope.workspaceId = 'another-workspace'; },
    value => { value.handoff.operatorRouteKey = 'https://not-registered.invalid'; },
    value => { value.handoff.candidates[0].code = 'rental.order.commit'; },
    value => { value.handoff.candidates[0].risk = 'R2'; },
    value => { value.handoff.candidates[0].executable = true; },
    value => { value.handoff.candidates[0].source.version = 'another-version'; }
  ]) {
    const corrupt = structuredClone(internal.payload); damage(corrupt);
    assert.throws(() => buildOrderExplanation({ payload: corrupt }), error => error.code === 'INVALID_RESPONSE');
    assert.throws(() => projectOrderExplanationMaterialV2(sealBusinessScenario('order_explanation', corrupt)),
      error => error.code === 'INVALID_RESPONSE');
  }
  // Deliberately remove the optional output of the actual current reader, not
  // a fabricated permission/available-actions port. No default tool is added.
  const actualNextRead = next.read.bind(next);
  next.read = async (...args) => ({ ...await actualNextRead(...args), candidates: [] });
  const empty = await service.preparePublicV2({ question: 'next_steps' });
  assert.deepEqual(empty.payload.handoff.candidates, []);
  assert.equal(empty.payload.explanation.claims.some(row => row.field.startsWith('handoff.candidates.')), false);
  assert.ok(empty.payload.explanation.text.includes('没有已核定只读候选'));
  const minimal = renderOrderReadAnswer({ order: { id: 'order-a', status: 'reserved', updatedAt: originalOrder.updatedAt } },
    '2026-11-07T00:00:00Z', 'next_steps');
  assert.equal(minimal.includes('rental.order.explain'), false); assert.equal(minimal.includes('APP_ROUTES.orderDetail'), false);
  assert.equal(historyReads, 0); assert.equal(lifecycleReads, 0); assert.deepEqual(h.state.order, originalOrder);
  const { AiScopeResolutionError } = require('../apps/api/src/modules/ai-native/ai-scope.repository');
  h.state.member = false; await assert.rejects(service.preparePublicV2({ question: 'next_steps' }),
    error => error instanceof AiScopeResolutionError && error.code === 'AI_ACCESS_DENIED');
});
