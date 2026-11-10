'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { RentalCoreController } = require('../apps/api/src/modules/rental-core/rental-core.controller');
const { returnPricingSlices } = require('../apps/api/src/modules/rental-core/rental-return-pricing');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const { RentalServiceCapacityService } = require('../apps/api/src/modules/rental-core/rental-service-capacity.service');
const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
const { fulfillmentAdmissionFixture } = require('./helpers/fulfillment-admission-fixture.cjs');
const { exchangeServiceConfirmationHash } = require('../apps/api/src/modules/rental-core/rental-service-catalog');
const { requiredPermissions } = require('../apps/api/src/common/api-auth.guard');
const { exchangePickupInspectionRequirements } = require('../apps/api/src/modules/rental-core/rental-exchange-inspection');
const start = '2026-10-01T00:00:00.000Z';
const at = days => new Date(Date.parse(start) + days * 86400000).toISOString();
const clone = structuredClone;
function fixture({ unit = 'day_24h', days = 10, old = 10, next = 20, minimum = 1, tiers = [], cap, quantity = 1 } = {}) {
  const rate = (id, amount) => ({ itemGroupId: id, itemGroupCode: id.toUpperCase(), unit, baseAmount: amount,
    minimumUnits: minimum, weekendMultiplier: 1, holidayMultiplier: 1, tiers: clone(tiers), maxAmount: cap });
  const rates = [rate('a', old), rate('b', next), rate('c', 30)];
  const context = { profile: { categoryCode: 'camera' }, category: { code: 'camera' },
    settings: { calendar: { timeZone: 'UTC' }, pricing: { holidayPricingEnabled: false, currency: 'CNY' } },
    groups: ['a', 'b', 'c'].map(id => ({ id, code: id.toUpperCase(), name: id.toUpperCase(), status: 'enabled', inventoryMode: 'quantity', attributes: {} })),
    pricingGroups: [] };
  const pricingContext = { timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false, dayRates: rates.filter(row => row.unit === 'day_24h') };
  const rule = { pricing: {}, payment: { depositMode: 'none' }, overdue: { graceMinutes: 0, feeMode: 'hourly', feeMultiplier: 1 },
    earlyReturn: { mode: 'none' }, qualification: { required: false }, fulfillment: { pickupBufferMinutes: 15, returnBufferMinutes: 30 } };
  const business = Object.create(RentalBusinessService.prototype);
  business.workspaceOf = () => 'w'; business.calendarsForDateRange = () => [];
  business.resolveSpaceRates = async () => ({ versionId: 'price-next', version: '2', rates: clone(rates) });
  business.coreConfigStore = { listInspectionTemplates: async () => [{ id: 'return', tenantId: 't', categoryCode: 'camera', stage: 'return', enabled: true, fields: [] }] };
  business.configStore = { readServicesForExchange: async () => [] };
  const original = business.priceRentalLine({ group: context.groups[0], quantity, rate: rates[0], startAt: start, endAt: at(days),
    timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false, planId: 'price-original', planVersion: '1', codePrefix: 'rental', chargeType: 'rental' });
  const quote = { id: 'q', tenantId: 't', categoryCode: 'camera', currency: 'CNY', priceVersionId: 'price-original', priceVersion: '1', pricingPlanVersion: '1', ruleVersion: 'r1',
    request: { startAt: start, endAt: at(days), lines: [{ itemGroupId: 'a', quantity, pricingUnit: unit }] },
    rentalAmount: original.amount, rentalLineAmounts: { a: original.amount }, payableAmount: original.amount,
    serviceAmount: 0, fulfillmentAmount: 0, discountAmount: 0, couponAmount: 0,
    depositAmount: 0, preAuthAmount: 0, discountEvaluations: [], chargeLines: [original.chargeLine],
    rateSnapshot: [clone(rates[0])], calendarSnapshot: original.calendarRows, pricingContext, ruleSnapshot: rule };
  business.factStore = { findQuote: async () => clone(quote) };
  business.loadQuote = async (tenant, _context, id, tx) => {
    assert.equal(tenant, 't'); assert.equal(id, 'q'); return clone(quote);
  };
  const order = { id: 'o', tenantId: 't', quoteId: 'q', currency: quote.currency, status: 'renting', categoryCode: 'camera', updatedAt: 'revision', startAt: start, endAt: at(days),
    fulfillmentLocationId: 'loc', returnLocationId: 'loc', fulfillmentMode: 'store_pickup_return', customerType: 'personal',
    depositAmount: 0, preAuthAmount: 0, finalPayableAmount: original.amount, payableAmount: original.amount, adjustmentAmount: 0,
    lines: [{ id: 'line', itemGroupId: 'a', itemGroupCode: 'A', itemGroupName: 'A', inventoryMode: 'quantity', quantity,
      amount: original.amount, unitPrice: original.amount / quantity }], allocations: [{ id: 'allocation', orderId: 'o', orderLineId: 'line', itemGroupId: 'a', status: 'picked_up', quantity }],
    reservations: [{ id: 'reservation', orderId: 'o', orderLineId: 'line', itemGroupId: 'a', locationId: 'loc', status: 'fulfilled', quantity, releasedQuantity: 0 }],
    inspectionTemplateSnapshots: [{ id: 'return', code: 'RETURN', version: '1', stage: 'return', enabled: true, fields: [] }],
    ruleSnapshot: rule, serviceSnapshots: [], chargeLines: clone(quote.chargeLines) };
  const changes = [], extensions = [];
  const quoteExchange = (point = at(5), priceBasis = 'replacement_current_price', replacementItemGroupId = 'b', serviceInput = {}) =>
    business.quotePostPickupExchange('t', context, { order, previousChanges: changes, previousExtensions: extensions,
      orderLineId: 'line', replacementItemGroupId, priceBasis, appliedAt: point, ...serviceInput,
      fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal', tx: { original: true } });
  const core = Object.create(RentalCoreService.prototype);
  core.factContext = async () => ({ profile: { categoryCode: 'camera' }, itemGroups: context.groups, pricingGroups: [] });
  core.lockedOrder = async () => order; core.resolveWorkspaceId = () => 'w';
  core.assertOrderQualification = async () => undefined; core.assertOrderFulfillmentAdmission = async () => undefined;
  core.businessConfigStore = { readServicesForExchange: async () => [] };
  core.loadInventorySnapshot = async () => ({ assets: [], reservations: [], stockBalances: [] });
  core.availableQuantity = () => 100; core.validateAllocationEquipment = async () => undefined;
  core.runHook = async () => undefined; core.orderHookInstances = () => [];
  core.listInspectionTemplates = async () => clone(order.inspectionTemplateSnapshots);
  core.recordReturnDispositions = async () => undefined; core.quarantinedReturnQuantities = () => [];
  core.factStore = { lockInventoryTargets: async () => undefined, insertInspection: async () => undefined, upsertWorkOrder: async () => undefined,
    listOrderChanges: async () => clone(changes), saveOrderAggregate: async () => undefined,
    insertOrderChange: async row => changes.push(clone(row)) };
  const apply = async (point = at(5), priceBasis = 'replacement_current_price', replacementItemGroupId = 'b', serviceInput = {}, inputPatch = {}, tx = {}) => {
    const result = await quoteExchange(point, priceBasis, replacementItemGroupId, serviceInput);
    const basis = await business.captureExchangeExecutionBasis('t', context, priceBasis, point, result.priced);
    const allocation = order.allocations.find(row => row.orderLineId === 'line' && ['picked_up', 'locked'].includes(row.status));
    assert.equal(allocation.status, 'picked_up', 'Core must preserve actual handover status for another formal exchange');
    const input = { type: 'post_pickup_exchange', orderLineId: 'line', allocationId: allocation.id, replacementItemGroupId,
      priceBasis, originalDisposition: 'return_to_warehouse', reason: 'fault', customerConfirmed: true,
      expectedUpdatedAt: order.updatedAt, inspectionSnapshot: { customerConfirmed: true }, services: serviceInput.services,
      cancelServiceOccurrenceIds: serviceInput.exchangeCancelledServiceOccurrenceIds };
    const serviceHash = exchangeServiceConfirmationHash({ orderId: 'o', expectedUpdatedAt: order.updatedAt, orderLineId: 'line',
      replacementItemGroupId, cancelledIds: input.cancelServiceOccurrenceIds ?? [] }, result.priced.serviceSnapshots ?? []);
    input.serviceConfirmationHash = serviceHash; Object.assign(input, inputPatch);
    const preview = { ...result.priced, differenceAmount: result.priced.pricingSnapshot.differenceAmount, exchange: {
      ...input, replacementPricingGroupId: result.replacementPricingGroupId,
      serviceConfirmationHash: serviceHash, originalItemGroupId: order.lines[0].itemGroupId, originalAmount: result.originalAmount,
      replacementAmount: result.replacementAmount, executionBasis: basis } };
    const applied = await runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, () =>
      core.applyPostPickupExchange('t', 'o', preview, input, `exchange-${changes.length}`, 'Operator', tx));
    return { ...result, applied };
  };
  const controller = Object.create(RentalCoreController.prototype);
  controller.business = business; controller.service = { lockOrderForUpdate: async () => clone(order), resolveWorkspaceId: () => 'w',
    listOrderChanges: async () => clone(changes), listOrderExtensions: async () => clone(extensions) };
  const overdue = items => controller.returnCharges('t', context, 'o', new Date(Date.parse(order.effectiveEndAt ?? order.endAt) + 3600000).toISOString(), {}, items, 'batch', false);
  return { business, core, controller, context, order, quote, rates, changes, extensions, quoteExchange, apply, overdue };
}

test('bundle component batches retain one bounded review instead of charging the parent rental repeatedly', async () => {
  const f = fixture();
  f.order.lines[0].inventoryMode = 'bundle';
  f.order.allocations = [
    { id: 'body', orderLineId: 'line', itemGroupId: 'body', quantity: 1, status: 'picked_up' },
    { id: 'battery', orderLineId: 'line', itemGroupId: 'battery', quantity: 2, status: 'picked_up' }
  ];
  const first = await f.overdue([{ allocationId: 'body', quantity: 1 }]);
  assert.equal(first.overdue.amount, 0, 'component quantities cannot authorize a parent rental charge');
  assert.ok(first.overdue.review.maximumAmount > 0);
  f.core.applyOverdueTo(f.order, first.overdue.amount, first.overdue.returnedAt, 'first', first.overdue.review);
  f.order.allocations[0].status = 'returned';
  const last = await f.overdue();
  f.core.applyOverdueTo(f.order, last.overdue.amount, last.overdue.returnedAt, undefined, last.overdue.review);
  assert.equal(f.order.feeReviews.length, 1);
  assert.equal(f.order.feeReviews[0].suggestedAmount, null);
  assert.equal(f.order.feeReviews[0].sourceId, 'bundle-return');
  assert.equal(f.order.chargeLines.filter(row => row.type === 'overdue').length, 0);
  f.core.factStore.saveOrderAggregate = async () => undefined;
  await assert.rejects(f.core.reviewOrderFeeReview('t', 'o', f.order.feeReviews[0].id,
    { decision: 'approved', amount: 0, reason: 'not all returned' }, 'operator', {}), /整单归还/);
  f.order.status = 'settling';
  const ceiling = f.order.feeReviews[0].maximumAmount;
  await assert.rejects(f.core.reviewOrderFeeReview('t', 'o', f.order.feeReviews[0].id,
    { decision: 'approved', amount: ceiling + 1, reason: 'above bound' }, 'operator', {}), /上限/);
  await f.core.reviewOrderFeeReview('t', 'o', f.order.feeReviews[0].id,
    { decision: 'approved', amount: ceiling, reason: 'original batch evidence checked' }, 'operator', {});
  assert.equal(f.order.chargeLines.filter(row => row.type === 'overdue').length, 1);
});

test('bundle pricing review follows actual Core partial return and final handover without blocking the goods', async () => {
  const f = fixture(); f.order.lines[0].inventoryMode = 'bundle';
  const components = ['body', 'battery'].map(id => ({ id, inventoryMode: 'quantity' }));
  f.core.state = () => ({ itemGroups: components }); f.core.factContext = async () => ({ itemGroups: components });
  f.core.returnStockTransfers = () => []; f.core.factStore.listAssets = async () => [];
  f.core.factStore.listExtensions = async () => [];
  f.order.allocations = components.map((row, index) => ({ id: row.id, orderLineId: 'line', itemGroupId: row.id,
    quantity: index + 1, status: 'picked_up', metadata: { reservationId: `r-${row.id}` } }));
  f.order.reservations = components.map((row, index) => ({ id: `r-${row.id}`, orderLineId: 'line', itemGroupId: row.id,
    quantity: index + 1, releasedQuantity: 0, status: 'fulfilled' }));
  const items = [{ allocationId: 'body', quantity: 1 }], charges = await f.overdue(items);
  await f.core.partialReturnOrder('t', 'o', { items, batchNo: 'actual-first' }, {}, charges);
  assert.equal(f.order.status, 'renting'); assert.equal(f.order.allocations[0].status, 'returned');
  assert.equal(f.order.allocations[1].status, 'picked_up'); assert.equal(f.order.feeReviews.length, 1);
  const final = await f.overdue();
  await f.core.completeHandoverWithoutInspection('t', 'o', 'return', final.overdue.amount, {}, 'operator', undefined,
    { ...final.overdue.review, returnedAt: final.overdue.returnedAt });
  assert.equal(f.order.status, 'settling'); assert.ok(f.order.allocations.every(row => row.status === 'returned'));
  assert.equal(f.order.feeReviews.length, 1); assert.equal(f.order.feeReviews[0].status, 'pending');
  assert.equal(f.order.chargeLines.filter(row => row.type === 'overdue').length, 0);
});

test('whole unsplit bundles keep automatic parent pricing and returned exchange history never supplies an old ceiling', async () => {
  const f = fixture(); f.order.lines[0].inventoryMode = 'bundle';
  f.order.allocations = [{ id: 'body', orderLineId: 'line', itemGroupId: 'body', quantity: 1, status: 'picked_up' },
    { id: 'battery', orderLineId: 'line', itemGroupId: 'battery', quantity: 2, status: 'picked_up' }];
  const whole = await f.overdue();
  assert.equal(whole.overdue.review, undefined);
  assert.equal(whole.overdue.amount, f.business.calculateOverdueCharge('t', f.context, f.quote, at(10 + 1/24), at(10)));
  f.order.allocations.push({ id: 'old-replacement', orderLineId: 'other', itemGroupId: 'replacement', quantity: 1, status: 'returned', metadata: { exchangeId: 'original-exchange' } });
  const partial = await f.overdue([{ allocationId: 'body', quantity: 1 }]);
  assert.equal(partial.overdue.review.maximumAmount, undefined);
  f.core.applyOverdueTo(f.order, 0, partial.overdue.returnedAt, 'first', partial.overdue.review);
  f.order.allocations[0].status = 'returned';
  assert.equal((await f.overdue()).overdue.review.maximumAmount, undefined);
});

test('exchange rechecks mandatory services before changing any rental resource or charging facts', async () => {
  const f = fixture(); const before = clone(f.order);
  const mandatory = { id: 'operator', tenantId: 't', code: 'OP', name: '必需操作员', version: '1', termsVersion: '1',
    status: 'enabled', selectionMode: 'mandatory', mandatoryRule: { itemGroupIds: ['b'] }, applicableItemGroupIds: ['b'],
    applicableFulfillmentModes: [], applicableLocationIds: [], customerScope: 'all' };
  f.core.businessConfigStore.readServicesForExchange = async () => [mandatory];
  await assert.rejects(f.apply(), /须先选择并确认服务/);
  assert.deepEqual(f.order, before); assert.equal(f.changes.length, 0);
  f.core.businessConfigStore = {};
  await assert.rejects(f.apply(), /服务权威未装配/);
  assert.deepEqual(f.order, before);
});

test('exchange executes current membership, original equipment and delivery gates before any resource release', async () => {
  const f = fixture(), trace = [];
  for (const group of f.context.groups) group.inventoryMode = 'serialized';
  f.order.lines[0].inventoryMode = 'serialized';
  f.order.allocations[0].assetId = 'original-asset';
  const asset = { id: 'replacement', itemGroupId: 'b', assetNo: 'B', locationId: 'loc', status: 'available',
    attributes: { insuranceExpiry: '2020-01-01', inspectionExpiry: '2099-01-01' } };
  f.core.loadInventorySnapshot = async () => ({ assets: [clone(asset)], reservations: [], stockBalances: [] });
  const apply = () => f.apply(at(5), 'replacement_current_price', 'b', {}, { replacementAssetId: asset.id }, tx);
  const source = { locations: [{ id: 'loc', code: 'LOC', name: 'Current', status: 'enabled', operatorId: 'op', type: 'store', capabilities: ['pickup', 'return'] }],
    operators: [{ id: 'op', code: 'OP', name: 'Operator', status: 'enabled', type: 'self_operated' }] };
  const admission = fulfillmentAdmissionFixture('t', 'w', source);
  const now = new Date(), relation = { id: 'relationship', tenantId: 't', corporateCustomerId: 'corp', personalCustomerId: 'customer',
    status: 'active', effectiveFrom: now, effectiveTo: null };
  let qualified = false;
  const tx = { ...admission.tx,
    $queryRaw: query => query.sql.includes('customer_membership_qualification_types') ? Promise.resolve([]) : admission.tx.$queryRaw(query),
    customerProfile: { findFirst: async ({ where }) => ({ id: where.id, tenantId: 't', customerType: where.id === 'corp' ? 'corporate' : 'personal', name: where.id }) },
    customerMembership: { findUnique: async () => ({ status: 'active' }) },
    customerQualificationRef: { findMany: async () => qualified ? [{ id: 'license', customerId: 'customer', qualificationType: 'driver_license',
      status: 'approved', expiresAt: new Date('2099-01-01'), issuedAt: null, verifiedAt: now, createdAt: now, updatedAt: now }] : [] },
    customerMembershipQualificationType: { findMany: async () => [] },
    customerMembershipPlanAssignment: { findFirst: async () => null },
    customerCorporateMembership: { findFirst: async () => relation.status === 'active' ? clone(relation) : null }
  };
  f.core.memberships = new MembershipService({ customerProfile: { findFirst: async () => { throw Error('ambient membership read'); } } }, {
    lockCustomerBusinessGate: async (_tenant, id, transaction) => { assert.equal(transaction, tx); trace.push(`customer:${id}`); return true; }
  });
  delete f.core.assertOrderQualification; delete f.core.assertOrderFulfillmentAdmission; delete f.core.validateAllocationEquipment;
  f.core.configStore = { readFulfillmentAdmission: (tenant, workspace, requirements, transaction) => {
    assert.equal(transaction, tx); trace.push('fulfillment'); return admission.read(tenant, workspace, requirements, tx);
  } };
  const state = { profile: { categoryCode: 'vehicle' }, businessSettings: { calendar: { timeZone: 'UTC' } }, itemGroups: f.context.groups, pricingGroups: [] };
  f.core.state = () => state;
  f.order.membershipSnapshot = { bookingIdentity: 'enterprise_employee', personalCustomerId: 'customer', corporateCustomerId: 'corp',
    corporateMembershipId: 'relationship', enterpriseContractAndPayer: false, qualifications: [], resolvedAt: now.toISOString() };
  f.order.ruleSnapshot.qualification = { required: true, documentTypes: ['driver_license'], minimumValidityDays: 0 };
  const before = clone(f.order);
  let writes = 0;
  f.core.factStore.insertInspection = async () => { writes++; };
  f.core.factStore.saveOrderAggregate = async () => { writes++; };
  f.core.factStore.listAssets = async () => [clone(asset)];
  f.core.orderHookInstances = () => [];
  let deliverySeen = false;
  delete f.core.runHook;
  f.core.hooks = { evaluate: async input => {
    assert.equal(input.tx, tx); trace.push(input.point);
    if (input.point === 'pickup_delivery') {
      deliverySeen = true; assert.deepEqual(input.subject.order.lines.map(row => row.itemGroupId), ['b']);
      assert.equal(input.subject.inspectionSkipped, true); assert.equal(input.subject.stage, 'pickup');
      throw Error('replacement delivery rejected');
    }
  } };
  await assert.rejects(apply(), /资格校验未通过/);
  assert.deepEqual(f.order, before); assert.equal(writes, 0);
  qualified = true; relation.status = 'exited';
  await assert.rejects(apply(), /有效员工/);
  relation.status = 'active'; relation.id = 'new-relationship';
  await assert.rejects(apply(), /后继新关系/);
  relation.id = 'relationship'; source.operators[0].status = 'disabled';
  await assert.rejects(apply(), /经营主体已停用/);
  source.operators[0].status = 'enabled';
  f.order.ruleSnapshot.fulfillment.pickupInspectionRequired = true;
  await assert.rejects(apply(), /独立领取检查/);
  delete f.order.ruleSnapshot.fulfillment.pickupInspectionRequired;
  await assert.rejects(f.apply(at(5), 'replacement_current_price', 'b', {}, { replacementAssetId: 'replacement' }, tx), /车辆保险/);
  assert.deepEqual(f.order, before); assert.equal(writes, 0);
  f.core.factStore.listAssets = async () => [];
  await assert.rejects(apply(), /实际交付资产缺失/);
  assert.equal(writes, 0); assert.deepEqual(f.order, before);
  asset.attributes.insuranceExpiry = '2099-01-01';
  f.core.factStore.listAssets = async () => [clone(asset)];
  await assert.rejects(apply(), /replacement delivery rejected/);
  assert.equal(deliverySeen, true); assert.equal(writes, 0); assert.deepEqual(f.order, before);
  assert.ok(trace.includes('allocation_dispatch')); assert.ok(trace.indexOf('customer:corp') < trace.indexOf('fulfillment'));
  f.core.hooks.evaluate = async input => { assert.equal(input.tx, tx); trace.push(input.point); };
  const result = await apply();
  assert.equal(result.applied.change.status, 'applied'); assert.equal(writes, 2);
  assert.equal(f.order.lines[0].itemGroupId, 'b'); assert.equal(f.order.allocations[0].status, 'returned');
  assert.equal(f.order.allocations.at(-1).status, 'picked_up');
  assert.ok(trace.includes('pickup_delivery'), 'valid current membership and delivery authority permit a normal exchange');
});

test('replacement pickup inspection commits distinct new-resource evidence and delivery observations with the exchange', async () => {
  const f = fixture(), records = [], hooks = [];
  f.order.ruleSnapshot.fulfillment.pickupInspectionRequired = true;
  const template = { id: 'pickup', tenantId: 't', categoryCode: 'camera', code: 'PICKUP', version: '2', name: 'New pickup',
    stage: 'pickup', enabled: true, fields: [{ code: 'checked', label: 'Checked', type: 'boolean', required: true },
      { code: 'counter', label: 'Counter', type: 'number', required: true, usageMetric: true }] };
  f.business.coreConfigStore.listInspectionTemplates = async () => [template];
  f.core.configStore = { listInspectionTemplates: async (_tenant, _workspace, tx) => { assert.equal(tx.original, true); return [template]; } };
  f.core.getWorkspaceCategory = async () => ({ code: 'camera' });
  const priced = await f.quoteExchange();
  const basis = await f.business.captureExchangeExecutionBasis('t', f.context, 'replacement_current_price', at(5), priced.priced);
  const requirements = exchangePickupInspectionRequirements({ orderId: 'o', expectedUpdatedAt: 'revision', orderLineId: 'line',
    allocationId: 'allocation', replacementItemGroupId: 'b', locationId: 'loc', basis });
  const pickup = { templateId: template.id, templateVersion: template.version, confirmationHash: requirements.confirmationHash,
    results: { checked: true, counter: 1000 }, customerConfirmed: true };
  f.core.factStore.insertInspection = async (record, tx) => { assert.equal(tx.original, true); records.push(clone(record)); };
  f.core.markPickedUp = async () => assert.fail('exchange pickup must not advance whole-order handover');
  f.core.runHook = async (_tenant, point, _ref, payload) => hooks.push({ point, payload: clone(payload) });
  const before = clone(f.order);
  for (const patch of [{ confirmationHash: '0'.repeat(64) }, { templateVersion: 'old' }, { results: {} },
    { results: { checked: 'true', counter: 1000 } }, { results: { checked: true, counter: -1 } }, { customerConfirmed: false }]) {
    await assert.rejects(f.apply(at(5), 'replacement_current_price', 'b', {}, { replacementPickupInspection: { ...pickup, ...patch } }, { original: true }));
    assert.deepEqual(f.order, before); assert.equal(records.length, 0);
  }
  await assert.rejects(f.apply(at(5), 'replacement_current_price', 'b', {},
    { replacementPickupInspection: { ...pickup, attachments: ['foreign-file'] } }, { original: true, $queryRaw: async () => [] }), /凭证未完成/);
  assert.deepEqual(f.order, before); assert.equal(records.length, 0);
  f.core.configStore.listInspectionTemplates = async () => [{ ...template, fields: [...template.fields,
    { code: 'new_required', label: 'Added during lock wait', type: 'boolean', required: true }] }];
  await assert.rejects(f.apply(at(5), 'replacement_current_price', 'b', {}, { replacementPickupInspection: pickup }, { original: true }), /模板已变化/);
  assert.deepEqual(f.order, before); assert.equal(records.length, 0);
  f.core.configStore.listInspectionTemplates = async () => [template, { ...template, id: 'added', code: 'ADDED' }];
  await assert.rejects(f.apply(at(5), 'replacement_current_price', 'b', {}, { replacementPickupInspection: pickup }, { original: true }), /模板已变化/);
  assert.deepEqual(f.order, before); assert.equal(records.length, 0);
  f.core.configStore.listInspectionTemplates = async () => [template];
  const result = await f.apply(at(5), 'replacement_current_price', 'b', {}, { replacementPickupInspection: pickup }, { original: true });
  assert.equal(records.length, 2);
  const recorded = records.find(row => row.stage === 'pickup');
  assert.equal(recorded.exchangeId, result.applied.change.id); assert.equal(recorded.templateId, 'pickup');
  assert.equal(recorded.customerConfirmedAt, at(5)); assert.deepEqual(recorded.usageReadings, [{ fieldCode: 'counter', current: 1000 }]);
  const actual = f.order.allocations.find(row => row.status === 'picked_up');
  assert.deepEqual(recorded.pickupItems, [{ allocationId: actual.id, itemGroupId: 'b', quantity: 1 }]);
  assert.equal(f.order.status, 'renting'); assert.equal(f.order.allocations[0].status, 'returned');
  const delivery = hooks.find(row => row.point === 'pickup_delivery');
  assert.equal(delivery.payload.inspectionSkipped, false); assert.deepEqual(delivery.payload.results, pickup.results);
  assert.equal(delivery.payload.order.allocations[0].id, actual.id);
});

test('original exchange controller publishes pickup binding and validated apply DTO retains it through execution', async () => {
  const f = fixture();
  const template = { id: 'pickup', tenantId: 't', categoryCode: 'camera', code: 'PICKUP', version: '2', name: 'Pickup',
    enabled: true, stage: 'pickup', fields: [{ code: 'checked', label: 'Checked', type: 'boolean', required: true }] };
  f.order.ruleSnapshot.fulfillment.pickupInspectionRequired = true;
  f.business.coreConfigStore.listInspectionTemplates = async () => [template];
  f.core.configStore = { listInspectionTemplates: async () => [template] };
  f.core.getWorkspaceCategory = async () => ({ code: 'camera' });
  f.controller.context = async () => f.context;
  const originalPrice = f.business.quotePostPickupExchange.bind(f.business);
  f.business.quotePostPickupExchange = (tenant, context, args) => originalPrice(tenant, context, { ...args, appliedAt: at(5) });
  const capture = f.business.captureExchangeExecutionBasis.bind(f.business);
  f.business.captureExchangeExecutionBasis = (tenant, context, mode, _at, priced) => capture(tenant, context, mode, at(5), priced);
  f.controller.prisma = { $transaction: async work => work({ original: true }) };
  const req = { user: { tenantId: 't', id: 'operator', displayName: 'Operator', permissions: ['rental-os:order:operate'] },
    headers: { 'idempotency-key': 'exchange-pickup-original' } };
  const request = { type: 'post_pickup_exchange', orderLineId: 'line', allocationId: 'allocation', replacementItemGroupId: 'b',
    priceBasis: 'replacement_current_price', originalDisposition: 'return_to_warehouse', inspectionSnapshot: { customerConfirmed: true } };
  const preview = await f.controller.previewPostPickupExchange(req, 'o', request);
  assert.equal(preview.exchange.pickupInspection.required, true); assert.deepEqual(preview.exchange.pickupInspection.templates, [template]);
  const { plainToInstance } = require('class-transformer'), { validateSync } = require('class-validator');
  const { ApplyRentalOrderChangeDto } = require('../apps/api/src/modules/rental-core/rental-order-request.dto');
  const input = plainToInstance(ApplyRentalOrderChangeDto, { ...request, expectedUpdatedAt: f.order.updatedAt, customerConfirmed: true, reason: 'Fault',
    replacementPickupInspection: { templateId: 'pickup', templateVersion: '2', confirmationHash: preview.exchange.pickupInspection.confirmationHash,
      results: { checked: true }, customerConfirmed: true } });
  // The old fixture uses a synthetic revision; validate a real timestamp at the DTO boundary.
  const valid = plainToInstance(ApplyRentalOrderChangeDto, { ...input, expectedUpdatedAt: at(0) });
  assert.deepEqual(validateSync(valid, { whitelist: true, forbidNonWhitelisted: true }), []);
  assert.equal(valid.replacementPickupInspection.results.checked, true);
  assert.ok(validateSync(plainToInstance(ApplyRentalOrderChangeDto, { ...valid,
    replacementPickupInspection: { ...valid.replacementPickupInspection, confirmationHash: 'invalid' } }),
    { whitelist: true, forbidNonWhitelisted: true }).length > 0);
  let originalRequest, writes = 0;
  f.controller.idempotent = { execute: async command => { originalRequest = command.request; return command.run({ original: true }); } };
  f.controller.service = f.core; f.core.lockOrderForUpdate = async () => f.order;
  f.core.listOrderExtensions = async () => f.extensions; f.core.listOrderChanges = async () => f.changes;
  f.core.factStore.insertInspection = async () => { writes++; };
  f.controller.usesCorporateCredit = async () => false; f.controller.committed = async (_tenant, value) => value;
  f.business.refreshFromDatabase = async () => {};
  await runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator' }, () => f.controller.applyPostPickupExchange(req, 'o', input));
  assert.equal(originalRequest.replacementPickupInspection.confirmationHash, preview.exchange.pickupInspection.confirmationHash);
  assert.equal(writes, 2); assert.equal(f.order.status, 'renting');
});

test('pickup template authority waits on the original workspace writer and uses current scoped rows', async () => {
  const { RentalCoreConfigRepository } = require('../apps/api/src/modules/rental-core/rental-core-config.repository');
  const trace = [];
  const tx = { $queryRaw: async query => {
    trace.push(query.sql); assert.deepEqual(query.values, ['t', 'w']);
    if (query.sql.includes('business_workspaces')) return [{ id: 'w' }];
    assert.match(query.sql, /LOCK IN SHARE MODE/);
    return [{ id: 'pickup', tenantId: 't', categoryCode: 'CAMERA', code: 'PICKUP', name: 'Pickup', stage: 'pickup',
      version: '2', fields: [], enabled: 1 }];
  } };
  const repository = new RentalCoreConfigRepository({ rentalInspectionTemplate: { findMany: () => assert.fail('ambient template read') } });
  const [template] = await repository.listInspectionTemplates('t', 'w', tx);
  assert.equal(template.enabled, true); assert.equal(template.categoryCode, 'camera');
  assert.ok(trace[0].includes('business_workspaces')); assert.ok(trace[1].includes('rental_inspection_templates'));
});

test('replacement pickup files keep original frozen ownership and staff batch/signature boundaries', async () => {
  const f = fixture(), hash = 'a'.repeat(64), staging = 'tenant-files/t/file/blob';
  const file = { id: 'file', tenantId: 't', businessModule: 'rental-core', businessType: 'rental_order', businessId: 'o',
    status: 'active', mimeType: 'image/jpeg', uploadScene: 'pickup-evidence', uploadedBy: 'operator', storageProvider: 's3',
    storageKey: `${staging}.committed/12345678-1234-4234-8234-123456789abc/${hash}`, checksum: hash,
    metadata: { workspaceId: 'w', fileUploadVersion: 2, fileContentVersion: 1, contentHash: hash, stagingStorageKey: staging,
      uploadedByUserId: 'operator', handoverStage: 'pickup', handoverBatchId: 'original-key', handoverLocationId: 'loc' } };
  let current = file;
  const tx = { $queryRaw: async query => { assert.match(query.sql, /LOCK IN SHARE MODE/); return [current]; } };
  const check = () => f.core.assertExchangePickupFiles('t', f.order, ['file'], undefined, 'original-key', tx);
  await check();
  for (const patch of [{ businessId: 'other-order' }, { tenantId: 'foreign' }, { status: 'pending' }, { uploadScene: 'return-evidence' },
    { metadata: { ...file.metadata, workspaceId: 'foreign' } }, { checksum: 'b'.repeat(64) }, { storageKey: staging }]) {
    current = { ...file, ...patch }; await assert.rejects(check(), /本空间、本订单已冻结/);
  }
  current = { ...file, uploadScene: 'handover-signature' };
  await runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', staffApi: true }, async () => {
    await assert.rejects(check(), /客户现场签字/);
    await f.core.assertExchangePickupFiles('t', f.order, ['file'], 'file', 'original-key', tx);
    await assert.rejects(f.core.assertExchangePickupFiles('t', f.order, ['file'], 'file', 'different-key', tx), /批次或地点/);
    current = { ...current, uploadedBy: 'other-operator' };
    await assert.rejects(f.core.assertExchangePickupFiles('t', f.order, ['file'], 'file', 'original-key', tx), /当前员工/);
  });
});

test('retained service applicability and capacity are checked from original receipts without repricing', async () => {
  const f = fixture();
  const service = { id: 'operator', tenantId: 't', code: 'OP', name: '操作员', version: '2', termsVersion: '2',
    status: 'enabled', selectionMode: 'optional', applicableItemGroupIds: ['b'], applicableFulfillmentModes: [],
    applicableLocationIds: [], customerScope: 'all' };
  const occurrence = { occurrenceId: 'original-service', workspaceId: 'w', serviceId: 'operator', serviceName: '原操作员', serviceVersion: '1',
    termsVersion: '1', terms: '原条款', amount: 7, quantity: 1, capacityQuantity: 1, requiresCapacity: true,
    reservationKey: 'original-capacity', requiredByRule: false, applicableItemGroupIds: ['a', 'b'],
    executionStatus: 'not_started', serviceLocationId: 'loc', scheduledStartAt: at(5), scheduledEndAt: at(10) };
  f.order.serviceSnapshots = [clone(occurrence)];
  f.core.businessConfigStore.readServicesForExchange = async () => [service];
  f.business.configStore.readServicesForExchange = async () => [service];
  const before = clone(f.order); let checked = false;
  f.core.serviceCapacities = { assertServiceChangeForExchange: async (_tenant, orderId, rows) => {
    assert.equal(orderId, 'o'); assert.equal(rows[0].reservationKey, 'original-capacity'); throw Error('原容量收据失效');
  } };
  await assert.rejects(f.apply(), /原容量收据失效/); assert.deepEqual(f.order, before);
  f.core.serviceCapacities.assertServiceChangeForExchange = async (_tenant, _orderId, rows) => { checked = true; assert.deepEqual(rows, [occurrence]); };
  await f.apply(); assert.equal(checked, true); assert.deepEqual(f.order.serviceSnapshots, [occurrence]);
});

function exchangeCapacityFixture() {
  const capacity = { id: 'capacity', tenantId: 't', workspaceId: 'w', serviceId: 'operator', locationId: 'loc',
    windowStart: new Date(at(5)), windowEnd: new Date(at(10)), totalCapacity: 1, reservedQuantity: 0, usedQuantity: 0, status: 'enabled' };
  const receipts = [], trace = [], previousCapacities = [];
  let refuseReservation = false;
  const tx = { businessWorkspace: { findFirst: async () => ({ id: 'w' }) },
    $queryRaw: async query => {
      assert.match(query.sql, /FOR UPDATE/);
      if (/rental_service_reservations/.test(query.sql)) { trace.push('current-receipts'); return clone(receipts); }
      assert.match(query.sql, /rental_service_capacities/); trace.push('current-capacity');
      const selected = previousCapacities.find(row => query.values.includes(row.id));
      return [{ ...(selected ?? capacity) }];
    },
    rentalServiceReservation: {
      findFirst: async ({ where }) => receipts.find(row => row.idempotencyKey === where.idempotencyKey) ?? null,
      findMany: async () => { throw Error('must not read a repeatable-read receipt snapshot'); },
      create: async ({ data }) => { trace.push('reserve-receipt'); receipts.push({ id: `receipt-${receipts.length}`, ...data }); },
      updateMany: async ({ where, data }) => {
        const row = receipts.find(value => value.id === where.id && value.status === where.status);
        if (!row) return { count: 0 };
        trace.push(data.status); Object.assign(row, data); return { count: 1 };
      }
    },
    rentalServiceCapacity: {
      findFirst: async () => { throw Error('must not read a repeatable-read capacity snapshot'); },
      updateMany: async ({ where, data }) => {
        if (data.reservedQuantity?.increment && refuseReservation) return { count: 0 };
        const target = previousCapacities.find(row => row.id === where.id) ?? capacity;
        for (const key of ['reservedQuantity', 'usedQuantity']) {
          const condition = where[key];
          if (typeof condition === 'number' && target[key] !== condition || condition?.gte && target[key] < condition.gte) return { count: 0 };
        }
        for (const key of ['reservedQuantity', 'usedQuantity']) target[key] += (data[key]?.increment ?? 0) - (data[key]?.decrement ?? 0);
        trace.push(data.reservedQuantity?.increment ? 'reserve-capacity' : data.usedQuantity?.increment ? 'confirm-capacity' : 'release-capacity');
        return { count: 1 };
      }
    }
  };
  return { capacity, receipts, trace, previousCapacities, tx, service: new RentalServiceCapacityService({}), refuse: () => { refuseReservation = true; } };
}
const exchangeOperator = { id: 'operator', tenantId: 't', categoryCode: 'camera', code: 'OP', name: '操作员', version: '2', termsVersion: '2',
  terms: '新商品操作条款', status: 'enabled', selectionMode: 'mandatory', mandatoryRule: { itemGroupIds: ['b'] },
  applicableItemGroupIds: ['b'], applicableFulfillmentModes: [], applicableLocationIds: [], customerScope: 'all',
  billingUnit: 'per_order', price: 20, minimumQuantity: 1, maximumQuantity: 1, requiresCapacity: true };
const selectedExchangeServices = { services: [{ serviceId: 'operator', quantity: 1, serviceLocationId: 'loc', scheduledStartAt: at(6), scheduledEndAt: at(7) }] };

test('serialized exchange refuses another order reservation over the rental and either buffer boundary', async () => {
  for (const interval of [[at(5), at(6)], [new Date(Date.parse(at(5)) - 10 * 60000).toISOString(), at(5)],
    [at(10), new Date(Date.parse(at(10)) + 20 * 60000).toISOString()]]) {
    const f = fixture(); for (const group of f.context.groups) group.inventoryMode = 'serialized';
    f.order.lines[0].inventoryMode = 'serialized'; f.order.allocations[0].assetId = 'old-asset';
    const asset = { id: 'new-asset', itemGroupId: 'b', assetNo: 'B', locationId: 'loc', status: 'reserved', attributes: {} };
    f.core.loadInventorySnapshot = async () => ({ assets: [clone(asset)], stockBalances: [], reservations: [{
      id: 'other-reservation', orderId: 'other-order', itemGroupId: 'b', locationId: 'loc', assetIds: [asset.id], quantity: 1,
      status: 'reserved', startAt: interval[0], endAt: interval[1]
    }] });
    const before = clone(f.order); let writes = 0;
    f.core.factStore.saveOrderAggregate = async () => { writes++; }; f.core.factStore.insertInspection = async () => { writes++; };
    await assert.rejects(f.apply(at(5), 'replacement_current_price', 'b', {}, { replacementAssetId: asset.id }),
      error => error.status === 409 && /其他订单的租期或缓冲时间冲突/.test(error.message));
    assert.deepEqual(f.order, before); assert.equal(writes, 0); assert.equal(f.changes.length, 0);
  }
});

test('exchange adds independently priced services, confirms their own capacity, and preserves original occurrence history', async () => {
  const f = fixture(), c = exchangeCapacityFixture();
  f.business.configStore.readServicesForExchange = f.core.businessConfigStore.readServicesForExchange = async () => [exchangeOperator];
  f.core.serviceCapacities = c.service;
  const original = { occurrenceId: 'old-service', workspaceId: 'w', serviceId: 'old', serviceName: '已完成原服务', amount: 7,
    terms: '原条款', quantity: 1, executionStatus: 'completed', requiresCapacity: false };
  f.order.serviceSnapshots = [clone(original)];
  const before = clone(f.order);
  const priced = await f.quoteExchange(at(5), 'replacement_current_price', 'b', selectedExchangeServices);
  assert.equal(priced.priced.serviceAmount, 20); assert.equal(priced.priced.pricingSnapshot.differenceAmount, 70);
  assert.deepEqual(c.receipts, []); assert.equal(c.capacity.usedQuantity, 0);
  await assert.rejects(f.apply(at(5), 'replacement_current_price', 'b', selectedExchangeServices, { serviceConfirmationHash: undefined }, c.tx), /重新试算并取得客户确认/);
  assert.deepEqual(f.order, before); assert.equal(c.receipts.length, 0);
  const result = await f.apply(at(5), 'replacement_current_price', 'b', selectedExchangeServices, {}, c.tx);
  assert.deepEqual(f.order.serviceSnapshots[0], original);
  const added = f.order.serviceSnapshots[1];
  assert.equal(added.origin, 'exchange'); assert.equal(added.exchangeId, result.applied.change.id);
  assert.equal(added.customerConfirmationChannel, 'admin_recorded'); assert.equal(added.customerConfirmationRecordedBy, 'Operator');
  assert.equal(added.executionStatus, 'not_started'); assert.equal(added.amount, 20); assert.equal(added.terms, exchangeOperator.terms);
  assert.equal(c.receipts.length, 1); assert.equal(c.receipts[0].status, 'confirmed'); assert.equal(c.receipts[0].idempotencyKey, added.reservationKey);
  assert.equal(c.capacity.reservedQuantity, 0); assert.equal(c.capacity.usedQuantity, 1);
  assert.equal(f.order.finalPayableAmount, 170); assert.equal(result.applied.change.additionalAmount, 70);
  assert.deepEqual(result.applied.change.diff.addedServices, [added]);
});

test('joint rental benefits and mandatory replacement services share the original capacity and delivery commit gates', async () => {
  const f = fixture(), c = exchangeCapacityFixture(), hooks = [];
  adoptedMarketingLayers(f);
  f.business.configStore.readServicesForExchange = f.core.businessConfigStore.readServicesForExchange = async () => [exchangeOperator];
  f.core.serviceCapacities = c.service;
  const before = clone(f.order);
  f.core.runHook = async (_tenant, point, _reference, payload, transaction) => {
    assert.equal(transaction, c.tx); hooks.push(point);
    if (point === 'pickup_delivery') {
      assert.equal(payload.order.serviceSnapshots[0].serviceId, 'operator');
      throw Error('current replacement delivery is unsafe');
    }
  };
  await assert.rejects(f.apply(at(5), 'replacement_current_price', 'b', selectedExchangeServices, {}, c.tx), /delivery is unsafe/);
  assert.deepEqual(f.order, before); assert.equal(f.changes.length, 0); assert.equal(c.receipts.length, 0);
  f.core.runHook = async (_tenant, point, _reference, payload, transaction) => {
    assert.equal(transaction, c.tx); hooks.push(point);
    if (point === 'pickup_delivery') assert.equal(payload.order.serviceSnapshots[0].amount, 20);
  };
  const result = await f.apply(at(5), 'replacement_current_price', 'b', selectedExchangeServices, {}, c.tx);
  assert.equal(f.order.finalPayableAmount, 129.35, 'original joint rental net 109.35 plus independently confirmed service 20');
  assert.equal(result.applied.change.additionalAmount, 56.45);
  assert.equal(c.receipts.length, 1); assert.equal(c.receipts[0].status, 'confirmed');
  assert.equal(f.order.serviceSnapshots[0].exchangeId, result.applied.change.id);
  assert.ok(hooks.includes('pickup_delivery'));
});

test('new exchange services reject stale terms, foreign locations and current currency changes before any resource write', async () => {
  const f = fixture();
  const optional = { ...exchangeOperator, selectionMode: 'optional' };
  f.business.configStore.readServicesForExchange = async () => [optional];
  f.core.businessConfigStore.readServicesForExchange = async () => [{ ...optional, terms: 'changed after preview' }];
  const before = clone(f.order);
  await assert.rejects(f.apply(at(5), 'replacement_current_price', 'b', selectedExchangeServices), /重新试算并取得客户确认/);
  assert.deepEqual(f.order, before); assert.equal(f.changes.length, 0);
  f.context.settings.pricing.currency = 'USD';
  await assert.rejects(f.quoteExchange(at(5), 'original_order_price', 'b', selectedExchangeServices), /新增服务当前价格币种/);
  f.context.settings.pricing.currency = 'CNY';
  await assert.rejects(f.quoteExchange(at(5), 'original_order_price', 'b', { services: [{ ...selectedExchangeServices.services[0],
    serviceLocationId: 'foreign' }] }), /地点和时段/);
});

test('equal gross replacement price cannot bypass original rental benefit applicability', async () => {
  for (const kind of ['plan', 'coupon', 'membership']) {
    const f = fixture({ next: 10 });
    if (kind === 'plan') {
      f.quote.discountAmount = 10;
      f.quote.discountEvaluations = [{ applied: true, appliesTo: 'rental', discountAmount: 10, rentalAllocations: { a: 10 } }];
    } else if (kind === 'coupon') {
      f.quote.couponAmount = 10;
      f.quote.couponEvaluation = { appliesTo: 'rental', discountAmount: 10, rentalAllocations: { a: 10 } };
    } else {
      f.quote.discountAmount = 10;
      f.quote.membershipBenefitEvaluations = [{ appliesTo: 'rental', appliedAmount: 10, allocations: { a: 10 } }];
    }
    f.quote.payableAmount = 90; f.order.payableAmount = f.order.finalPayableAmount = 90;
    f.order.chargeLines.push({ code: kind, type: kind === 'coupon' ? 'coupon' : 'discount', amount: -10 });
    const before = clone(f.order);
    await assert.rejects(f.apply(), /原优惠/);
    assert.deepEqual(f.order, before); assert.equal(f.changes.length, 0);
    assert.equal((await f.quoteExchange(at(5), 'original_order_price')).priced.pricingSnapshot.differenceAmount, 0,
      'explicit original-price continuation retains its original rental terms');
    if (kind === 'coupon') {
      f.quote.couponEvaluation.applicableItemGroupIds = [];
      f.quote.discountAmount = 1; f.quote.discountEvaluations = [{ applied: true, appliesTo: 'rental', discountAmount: 1 }];
      assert.equal((await f.quoteExchange(at(5), 'original_order_price')).priced.pricingSnapshot.differenceAmount, 0,
        'new coupon scope does not disable the existing original-price joint-benefit continuation');
    }
  }
});

function adoptedRentalMembership(f, { calculation = 'percentage', value = 10, maximum } = {}) {
  const amount = f.business.membershipBenefitAmount({ calculation, value, maximum }, f.quote.rentalAmount);
  f.quote.membershipBenefitEvaluations = [{ source: 'personal', planId: 'member-plan', planVersionId: 'member-v1', planName: 'Original member',
    type: 'rental_discount', appliesTo: 'rental', calculation, configuredValue: value, configuredMaximum: maximum,
    scope: { type: 'tenant' }, scopeMatched: true, base: f.quote.rentalAmount, appliedAmount: amount,
    allocations: { a: amount }, detail: 'Original membership' }];
  f.quote.discountAmount = amount; f.quote.payableAmount -= amount;
  f.order.payableAmount = f.order.finalPayableAmount = f.quote.payableAmount;
  f.order.chargeLines.push({ code: 'membership', type: 'discount', amount: -amount });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
}

test('current-price exchange retains performed membership net and books only remaining net difference', async () => {
  const f = fixture(); adoptedRentalMembership(f); const before = clone(f.quote);
  const result = await f.apply();
  const receipt = result.priced.linePricing.membershipPricing;
  assert.equal(receipt.originalReduction, 10); assert.equal(receipt.replacementReduction, 15);
  assert.equal(receipt.originalNetAmount, 90); assert.equal(receipt.replacementNetAmount, 135);
  const summary = result.priced.pricingSnapshot.membershipBenefitEvaluations[0];
  assert.equal(summary.appliedAmount, result.priced.pricingSnapshot.recalculatedDiscountAmount);
  assert.equal(summary.base, 150); assert.deepEqual(summary.allocations, { line: 15 });
  assert.equal(result.applied.change.additionalAmount, 45); assert.equal(f.order.finalPayableAmount, 135);
  assert.equal(f.order.lines[0].amount, 150, 'gross stable-line price stays separate from reductions');
  assert.equal(result.priced.linePricing.segments[0].membershipBenefit.appliedAmount, 5);
  assert.deepEqual(f.quote, before);
  const second = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(second.applied.change.additionalAmount, 27); assert.equal(f.order.finalPayableAmount, 162);
  const charges = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
  assert.equal(charges.earlyReturn.amount, 54, 'two remaining days at 30 less the original 10% benefit');
});

test('original-price first exchange retains complete membership evidence for later current pricing', async () => {
  const f = fixture(); adoptedRentalMembership(f);
  assert.equal((await f.apply(at(5), 'original_order_price')).priced.linePricing.membershipPricing.replacementReduction, 10);
  const second = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(second.applied.change.additionalAmount, 54); assert.equal(f.order.finalPayableAmount, 144);
});

test('membership fixed reductions and caps are not restarted by repeated replacements', async () => {
  for (const config of [{ calculation: 'amount', value: 20 }, { calculation: 'percentage', value: 50, maximum: 20 }]) {
    const f = fixture(); adoptedRentalMembership(f, config);
    const first = await f.apply(); assert.equal(first.priced.linePricing.membershipPricing.replacementReduction, 20);
    assert.equal(first.applied.change.additionalAmount, 50); assert.equal(f.order.finalPayableAmount, 130);
    const retained = clone(first.priced.linePricing.segments[0]);
    const second = await f.apply(at(7), 'replacement_current_price', 'c');
    assert.equal(second.priced.linePricing.membershipPricing.replacementReduction, 20);
    assert.deepEqual(second.priced.linePricing.segments[0], retained);
    assert.equal(f.order.finalPayableAmount, 160);
    const original = await f.apply(at(8), 'original_order_price', 'b');
    assert.equal(original.applied.change.additionalAmount, 0); assert.equal(f.order.finalPayableAmount, 160);
  }
});

test('membership net receipt rejects missing allocations or corrupted periods before any exchange write', async () => {
  const f = fixture(); adoptedRentalMembership(f);
  delete f.quote.membershipBenefitEvaluations[0].allocations;
  await assert.rejects(f.apply(), /原优惠/); assert.equal(f.changes.length, 0);
  f.quote.membershipBenefitEvaluations[0].allocations = { a: 10 };
  await f.apply();
  const basis = f.changes[0].diff.exchange.executionBasis.linePricing;
  basis.segments[0].membershipBenefit.appliedAmount++;
  const before = clone(f.order);
  await assert.rejects(f.apply(at(7), 'replacement_current_price', 'c'), /原优惠/);
  assert.deepEqual(f.order, before); assert.equal(f.changes.length, 1);
});

test('membership history must reconcile its internally balanced net with the original booked exchange', async () => {
  const f = fixture(); adoptedRentalMembership(f); await f.apply();
  const pricing = f.changes[0].diff.exchange.executionBasis.linePricing;
  pricing.segments[1].membershipBenefit.appliedAmount = 15;
  pricing.segments[1].membershipBenefit.allocations = { line: 15 };
  pricing.membershipPricing.replacementReduction = 20; pricing.membershipPricing.replacementNetAmount = 130;
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /原优惠/);
  const early = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
  assert.equal(early.earlyReturn.amount, null, 'corrupted but internally balanced benefit is not a booked net fact');
});

test('negative membership exchange keeps pending review distinct from the original approved receivable reduction', async () => {
  const f = fixture({ next: 5 }); adoptedRentalMembership(f); await f.apply();
  assert.equal(f.changes[0].refundAmount, 22.5); assert.equal(f.order.finalPayableAmount, 90);
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /尚未完整核减/);
  assert.equal((await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true)).earlyReturn.amount, null);
  f.order.feeReviews[0].status = 'approved'; f.order.feeReviews[0].decidedAmount = 22.5;
  f.order.chargeLines.push({ code: `early_return_refund:o:${f.changes[0].id}`, type: 'early_return_refund', amount: -22.5 });
  f.order.adjustmentAmount = -22.5; f.order.finalPayableAmount = 67.5;
  const second = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(second.applied.change.additionalAmount, 67.5); assert.equal(f.order.finalPayableAmount, 135);
});

test('original-price membership splits preserve the same cent tail regardless of exchange count', async () => {
  const indirect = fixture({ days: 3, next: 10 }); adoptedRentalMembership(indirect, { calculation: 'amount', value: 20 });
  await indirect.apply(at(1)); await indirect.apply(at(2), 'original_order_price', 'c');
  const direct = fixture({ days: 3, next: 10 }); adoptedRentalMembership(direct, { calculation: 'amount', value: 20 });
  await direct.apply(at(2));
  const refund = async f => (await f.controller.returnCharges('t', f.context, 'o', at(2), {}, undefined, 'return', true)).earlyReturn.amount;
  assert.equal(await refund(indirect), await refund(direct)); assert.equal(await refund(direct), 3.33);
});

function adoptedRentalCoupon(f, { scope = [], type = 'percentage', value = 10, maximum, minimumSpend = 0 } = {}) {
  const amount = f.business.discountAmount(f.quote.rentalAmount, type, value, maximum);
  f.quote.couponAmount = amount; f.quote.payableAmount -= amount;
  f.quote.couponEvaluation = { couponId: 'coupon-original', templateId: 'coupon-template', templateVersion: '1', templateCode: 'OLD', templateName: 'Original coupon',
    applicableItemGroupIds: scope, appliesTo: 'rental', discountType: type, discountValue: value, minimumSpend, maximumDiscount: maximum,
    stackableWithDiscountPlans: true, baseBeforeDiscount: f.quote.rentalAmount, runningBase: f.quote.rentalAmount,
    discountAmount: amount, rentalAllocations: { a: amount }, formula: 'Original coupon' };
  f.order.payableAmount = f.order.finalPayableAmount = f.quote.payableAmount;
  f.order.chargeLines.push({ code: 'coupon', type: 'coupon', amount: -amount });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
}

test('current-price coupon exchange uses frozen item scope and only the remaining net difference', async () => {
  for (const scope of [[], ['a', 'b'], ['a']]) {
    const f = fixture(); adoptedRentalCoupon(f, { scope }); const before = clone(f.quote);
    const result = await f.apply(), eligible = scope.length === 0 || scope.includes('b');
    assert.equal(result.priced.linePricing.couponPricing.originalReduction, 10);
    assert.equal(result.priced.linePricing.couponPricing.replacementReduction, eligible ? 15 : 5);
    assert.equal(result.applied.change.additionalAmount, eligible ? 45 : 55);
    assert.equal(f.order.finalPayableAmount, eligible ? 135 : 145);
    assert.equal(result.priced.pricingSnapshot.couponEvaluation.discountAmount, eligible ? 15 : 5);
    assert.deepEqual(f.quote, before);
    const early = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
    assert.equal(early.earlyReturn.amount, eligible ? 36 : 40);
  }
});

test('coupon fixed amount and cap keep original consumed budget across repeated replacements', async () => {
  for (const config of [{ type: 'fixed_amount', value: 20 }, { type: 'percentage', value: 50, maximum: 20 }]) {
    const f = fixture(); adoptedRentalCoupon(f, config);
    const first = await f.apply(); assert.equal(first.priced.linePricing.couponPricing.replacementReduction, 20);
    const second = await f.apply(at(7), 'replacement_current_price', 'c');
    assert.equal(second.priced.linePricing.couponPricing.replacementReduction, 20); assert.equal(f.order.finalPayableAmount, 160);
    await f.apply(at(8), 'original_order_price', 'b'); assert.equal(f.order.finalPayableAmount, 160);
  }
  const f = fixture({ next: 5 }); adoptedRentalCoupon(f, { scope: ['a', 'b'], minimumSpend: 80 });
  await f.apply(); assert.equal(f.changes[0].refundAmount, 20, 'remaining 25 is below frozen coupon threshold');
});

test('original-price first exchange preserves complete coupon evidence for a later current-price exchange', async () => {
  const f = fixture(); adoptedRentalCoupon(f);
  const first = await f.apply(at(5), 'original_order_price');
  assert.equal(first.priced.linePricing.couponPricing.replacementReduction, 10);
  const second = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(second.applied.change.additionalAmount, 54); assert.equal(f.order.finalPayableAmount, 144);
});

test('coupon minimum spend uses the eligible performed and replacement rental together', async () => {
  const f = fixture({ old: 100, next: 80 }); adoptedRentalCoupon(f, { type: 'fixed_amount', value: 100, minimumSpend: 500 });
  const result = await f.apply();
  assert.equal(result.priced.linePricing.couponPricing.replacementReduction, 100);
  assert.equal(result.priced.linePricing.couponPricing.replacementNetAmount, 800);
  assert.equal(result.applied.change.refundAmount, 100);
});

test('coupon exchange rejects legacy missing scope and balanced but unbooked historical reductions', async () => {
  const f = fixture(); adoptedRentalCoupon(f); delete f.quote.couponEvaluation.applicableItemGroupIds;
  await assert.rejects(f.apply(), /原优惠券/); assert.equal(f.changes.length, 0);
  f.quote.couponEvaluation.applicableItemGroupIds = []; await f.apply();
  const pricing = f.changes[0].diff.exchange.executionBasis.linePricing;
  pricing.segments[1].couponBenefit.discountAmount = 15; pricing.segments[1].couponBenefit.rentalAllocations = { line: 15 };
  pricing.couponPricing.replacementReduction = 20; pricing.couponPricing.replacementNetAmount = 130;
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /原优惠券/);
  assert.equal((await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true)).earlyReturn.amount, null);
});

test('coupon exchange controller synchronizes original budget in the transaction and never applies after budget failure', async () => {
  const f = fixture(); adoptedCouponAndMember(f); const quoted = await f.quoteExchange();
  const tx = { transaction: 'original' }, trace = [];
  const preview = { ...quoted.priced, differenceAmount: quoted.priced.pricingSnapshot.differenceAmount,
    exchange: { executionBasis: { linePricing: quoted.priced.linePricing } } };
  f.controller.idempotent = { execute: args => args.run(tx) };
  f.controller.pricePostPickupExchange = async () => ({ order: f.order, preview });
  f.controller.business.repriceCouponForOrder = async (tenant, id, amount, transaction) => {
    assert.equal(tenant, 't'); assert.equal(id, 'o'); assert.equal(amount, 15); assert.equal(transaction, tx);
    trace.push('budget'); throw Error('coupon budget unavailable');
  };
  f.controller.service.applyPostPickupExchange = async () => { trace.push('apply'); return { order: f.order, change: { additionalAmount: 40.5 } }; };
  f.controller.usesCorporateCredit = async () => false;
  f.controller.business.refreshFromDatabase = async () => undefined; f.controller.committed = async (_tenant, order) => order;
  const req = { user: { tenantId: 't', displayName: 'Operator' }, headers: {} };
  const input = { type: 'post_pickup_exchange', expectedUpdatedAt: f.order.updatedAt };
  await assert.rejects(f.controller.applyPostPickupExchange(req, 'o', input), /coupon budget unavailable/);
  assert.deepEqual(trace, ['budget']);
  f.controller.business.repriceCouponForOrder = async (_tenant, _id, amount, transaction) => {
    assert.equal(amount, 15); assert.equal(transaction, tx); trace.push('budget');
  };
  await f.controller.applyPostPickupExchange(req, 'o', input);
  assert.deepEqual(trace, ['budget', 'budget', 'apply']);
});

test('negative coupon exchange budget waits for the original complete reduction and fee-review transaction', async () => {
  const f = fixture({ next: 5 }); adoptedRentalCoupon(f); await f.apply();
  assert.equal(f.changes[0].refundAmount, 22.5);
  const review = f.order.feeReviews[0], tx = { original: true }, budgets = [];
  f.business.factStore = { ...f.business.factStore, repriceOrderCoupon: async (tenant, id, amount, transaction) => {
    assert.equal(tenant, 't'); assert.equal(id, 'o'); assert.equal(transaction, tx); budgets.push(amount);
  } };
  await f.business.synchronizeExchangeCoupon('t', f.order, review.id, f.changes, tx);
  assert.deepEqual(budgets, []);
  review.status = 'approved'; review.decidedAmount = 10;
  await f.business.synchronizeExchangeCoupon('t', f.order, review.id, f.changes, tx); assert.deepEqual(budgets, []);
  review.decidedAmount = 22.5;
  await assert.rejects(f.business.synchronizeExchangeCoupon('t', f.order, review.id, f.changes, tx), /核减费用/);
  f.order.chargeLines.push({ code: `early_return_refund:o:${f.changes[0].id}`, type: 'early_return_refund', amount: -22.5 });
  f.order.finalPayableAmount = 67.5; f.order.adjustmentAmount = -22.5;
  f.controller.idempotent = { execute: args => args.run(tx) };
  f.controller.service.reviewOrderFeeReview = async (_tenant, _id, _review, _body, _operator, transaction) => {
    assert.equal(transaction, tx); return f.order;
  };
  f.controller.committed = async (_tenant, order) => order;
  await f.controller.reviewOrderFeeReview({ user: { tenantId: 't', displayName: 'Operator' }, headers: {} }, 'o', review.id,
    { decision: 'approved', reason: 'Original reduction' });
  assert.deepEqual(budgets, [7.5]);
  const early = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
  assert.equal(early.earlyReturn.amount, 9);
});

test('coupon cent tail is stable across equal-price exchange and original-price continuation', async () => {
  const indirect = fixture({ days: 3, next: 10 }); adoptedRentalCoupon(indirect, { type: 'fixed_amount', value: 20 });
  await indirect.apply(at(1)); await indirect.apply(at(2), 'original_order_price', 'c');
  const direct = fixture({ days: 3, next: 10 }); adoptedRentalCoupon(direct, { type: 'fixed_amount', value: 20 }); await direct.apply(at(2));
  const refund = async f => (await f.controller.returnCharges('t', f.context, 'o', at(2), {}, undefined, 'return', true)).earlyReturn.amount;
  assert.equal(await refund(indirect), 3.33); assert.equal(await refund(indirect), await refund(direct));
});

function adoptedRentalPlan(f, changes = {}) {
  const plan = { id: 'original-plan', tenantId: 't', categoryCode: 'camera', code: 'PLAN', name: 'Original plan', status: 'enabled',
    version: '1', discountType: 'percentage', discountValue: 10, minimumSpend: 0, appliesTo: 'rental', customerScope: 'all',
    applicableItemGroupIds: [], applicablePricingGroupIds: [], applicableDayTypes: [], priority: 1, stackableWithOtherPlans: true,
    stackableWithCoupon: true, effectiveFrom: '2000-01-01T00:00:00Z', ...changes };
  const { selectDiscountPlans } = require('../apps/api/src/modules/rental-core/rental-discount-selection');
  f.quote.request.customerType = 'personal';
  const selected = selectDiscountPlans([plan], { bases: { rental: f.quote.rentalAmount, fulfillment: 0, service: 0 },
    minimumSpendBase: f.quote.rentalAmount, customerType: 'personal', hasCustomer: false, itemGroupIds: ['a'], pricingGroupIds: [],
    rentalLines: [{ id: 'a', itemGroupId: 'a', amount: f.quote.rentalAmount }], dayTypes: new Set(), rentalStartAt: start, workspaceId: 'w' });
  assert.equal(selected.applied.length, 1);
  f.quote.discountEvaluations = selected.evaluations; f.quote.discountAmount = selected.discountByTarget.rental;
  f.quote.payableAmount -= f.quote.discountAmount; f.order.payableAmount = f.order.finalPayableAmount = f.quote.payableAmount;
  f.order.chargeLines.push({ code: 'plan', type: 'discount', amount: -f.quote.discountAmount });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
}

test('adopted marketing plan prices only replacement time and retains performed net through repeated exchange', async () => {
  for (const scope of [[], ['a', 'b'], ['a']]) {
    const f = fixture(); adoptedRentalPlan(f, { applicableItemGroupIds: scope });
    const first = await f.apply(), eligible = scope.length === 0 || scope.includes('b');
    assert.equal(first.priced.linePricing.discountPricing.replacementReduction, eligible ? 15 : 5);
    assert.equal(f.order.finalPayableAmount, eligible ? 135 : 145);
    assert.equal(first.priced.pricingSnapshot.discountEvaluations[0].discountAmount, eligible ? 15 : 5);
    const early = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
    assert.equal(early.earlyReturn.amount, eligible ? 36 : 40);
    const second = await f.apply(at(7), 'replacement_current_price', 'c');
    assert.equal(second.priced.linePricing.discountPricing.replacementReduction, scope.length === 0 ? 18 : eligible ? 9 : 5);
  }
});

test('original marketing fixed amount, threshold and cap do not restart across original-price and current-price exchange', async () => {
  for (const changes of [{ discountType: 'fixed_amount', discountValue: 20 }, { discountValue: 50, maximumDiscount: 20 },
    { discountType: 'threshold_amount', discountValue: 20, thresholdAmount: 80 }]) {
    const f = fixture(); adoptedRentalPlan(f, changes);
    await f.apply(at(5), 'original_order_price');
    const second = await f.apply(at(7), 'replacement_current_price', 'c');
    assert.equal(second.priced.linePricing.discountPricing.replacementReduction, 20);
  }
  const f = fixture({ old: 100, next: 80 }); adoptedRentalPlan(f, { discountType: 'threshold_amount', discountValue: 100, thresholdAmount: 500 });
  const priced = await f.apply(); assert.equal(priced.priced.linePricing.discountPricing.replacementNetAmount, 800);
  assert.equal(priced.applied.change.refundAmount, 100);
});

test('marketing exchange refuses absent frozen rule and internally balanced but unbooked reductions', async () => {
  const f = fixture(); adoptedRentalPlan(f); const original = clone(f.quote.discountEvaluations[0].planSnapshot);
  delete f.quote.discountEvaluations[0].planSnapshot;
  await assert.rejects(f.apply(), /原优惠/); assert.equal(f.changes.length, 0);
  f.quote.discountEvaluations[0].planSnapshot = original; await f.apply();
  const pricing = f.changes[0].diff.exchange.executionBasis.linePricing;
  pricing.segments[1].discountBenefit.discountAmount = 15; pricing.segments[1].discountBenefit.rentalAllocations = { line: 15 };
  pricing.discountPricing.replacementReduction = 20; pricing.discountPricing.replacementNetAmount = 130;
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /原优惠/);
});

test('same-price percentage exchange preserves the original cent remainder for plan coupon and membership', async () => {
  for (const kind of ['plan', 'coupon', 'membership']) {
    const f = fixture({ days: 2, old: 100.01, next: 100.01 });
    if (kind === 'plan') adoptedRentalPlan(f, { discountValue: 50 });
    else if (kind === 'coupon') adoptedRentalCoupon(f, { value: 50 });
    else adoptedRentalMembership(f, { value: 50 });
    const priced = await f.apply(at(1));
    assert.equal(priced.priced.pricingSnapshot.differenceAmount, 0, kind);
    assert.equal(f.order.finalPayableAmount, 100.01, kind);
    const net = priced.priced.linePricing[`${kind === 'plan' ? 'discount' : kind}Pricing`];
    assert.equal(net.replacementReduction, 100.01, kind);
  }
});

test('same-price percentage exchange retains a cent tail when fresh rounding would be zero', async () => {
  for (const kind of ['plan', 'coupon', 'membership']) {
    const f = fixture({ days: 3, old: 0.01, next: 0.01 });
    if (kind === 'plan') adoptedRentalPlan(f, { discountValue: 20 });
    else if (kind === 'coupon') adoptedRentalCoupon(f, { value: 20 });
    else adoptedRentalMembership(f, { value: 20 });
    const result = await f.apply(at(1));
    assert.equal(result.priced.pricingSnapshot.differenceAmount, 0, kind);
    assert.equal(Math.round(f.order.finalPayableAmount * 100), 2, kind);
  }
  for (const kind of ['plan', 'coupon']) {
    const f = fixture({ days: 3, old: 0.01, next: 0.01 });
    if (kind === 'plan') adoptedRentalPlan(f, { discountValue: 20, applicableItemGroupIds: ['a'] });
    else adoptedRentalCoupon(f, { value: 20, scope: ['a'] });
    const result = await f.apply(at(1));
    assert.equal(result.priced.pricingSnapshot.differenceAmount, 0.01, kind);
  }
});

test('member-only marketing requires the original membership snapshot rather than a customer id', async () => {
  const f = fixture(); adoptedRentalPlan(f); f.quote.request.customerId = 'customer-only';
  f.quote.discountEvaluations[0].planSnapshot.customerScope = 'member';
  await assert.rejects(f.apply(), /原优惠营销金额无法/); assert.equal(f.changes.length, 0);
  f.quote.membershipSnapshot = { personalCustomerId: 'customer-only' };
  assert.equal((await f.apply()).applied.change.additionalAmount, 45);
});

test('marketing cent tail and negative reduction remain bound to original periods and approved fees', async () => {
  const indirect = fixture({ days: 3, next: 10 }); adoptedRentalPlan(indirect, { discountType: 'fixed_amount', discountValue: 20 });
  await indirect.apply(at(1)); await indirect.apply(at(2), 'original_order_price', 'c');
  const direct = fixture({ days: 3, next: 10 }); adoptedRentalPlan(direct, { discountType: 'fixed_amount', discountValue: 20 });
  await direct.apply(at(2));
  const refund = async f => (await f.controller.returnCharges('t', f.context, 'o', at(2), {}, undefined, 'return', true)).earlyReturn.amount;
  assert.equal(await refund(indirect), 3.33); assert.equal(await refund(indirect), await refund(direct));
  const negative = fixture({ next: 5 }); adoptedRentalPlan(negative); await negative.apply();
  assert.equal(negative.changes[0].refundAmount, 22.5); assert.equal(negative.order.finalPayableAmount, 90);
  await assert.rejects(negative.quoteExchange(at(7), 'replacement_current_price', 'c'), /尚未完整核减/);
  negative.order.feeReviews[0].status = 'approved'; negative.order.feeReviews[0].decidedAmount = 22.5;
  negative.order.chargeLines.push({ code: `early_return_refund:o:${negative.changes[0].id}`, type: 'early_return_refund', amount: -22.5 });
  negative.order.finalPayableAmount = 67.5; negative.order.adjustmentAmount = -22.5;
  const next = await negative.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(next.applied.change.additionalAmount, 67.5); assert.equal(negative.order.finalPayableAmount, 135);
});

function adoptedCouponAndMember(f, scope = []) {
  adoptedRentalCoupon(f, { value: 10, scope });
  adoptedRentalMembership(f, { value: 10 });
  const member = f.quote.membershipBenefitEvaluations[0];
  member.base = f.quote.rentalAmount - f.quote.couponAmount;
  const oldAmount = member.appliedAmount;
  member.appliedAmount = f.business.membershipBenefitAmount({ calculation: 'percentage', value: 10 }, member.base);
  member.allocations = { a: member.appliedAmount };
  f.quote.discountAmount = member.appliedAmount;
  f.quote.payableAmount += oldAmount - member.appliedAmount;
  f.order.payableAmount = f.order.finalPayableAmount = f.quote.payableAmount;
  f.order.chargeLines.find(row => row.code === 'membership').amount = -member.appliedAmount;
}

test('coupon then membership exchange applies the adopted layers to the remaining net base', async () => {
  for (const scope of [[], ['a']]) {
    const f = fixture(); adoptedCouponAndMember(f, scope); const before = clone(f.quote);
    const result = await f.apply(), eligible = scope.length === 0;
    assert.equal(f.quote.payableAmount, 81);
    assert.equal(result.priced.linePricing.couponPricing.replacementReduction, eligible ? 15 : 5);
    assert.equal(result.priced.linePricing.membershipPricing.replacementReduction, eligible ? 13.5 : 14.5);
    assert.equal(result.applied.change.additionalAmount, eligible ? 40.5 : 49.5);
    assert.equal(f.order.finalPayableAmount, eligible ? 121.5 : 130.5);
    assert.equal(result.priced.pricingSnapshot.membershipBenefitEvaluations[0].base, eligible ? 135 : 145);
    const early = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
    assert.equal(early.earlyReturn.amount, eligible ? 32.4 : 36);
    const second = await f.apply(at(7), 'replacement_current_price', 'c');
    assert.equal(second.applied.change.additionalAmount, eligible ? 24.3 : 27);
    assert.deepEqual(f.quote, before);
  }
});

test('coupon-member original-price first exchange and approved negative difference retain both net sources', async () => {
  const original = fixture(); adoptedCouponAndMember(original);
  await original.apply(at(5), 'original_order_price');
  assert.equal((await original.apply(at(7), 'replacement_current_price', 'c')).applied.change.additionalAmount, 48.6);
  const f = fixture({ next: 5 }); adoptedCouponAndMember(f); await f.apply();
  assert.equal(f.changes[0].refundAmount, 20.25); assert.equal(f.order.finalPayableAmount, 81);
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /尚未完整核减/);
  f.order.feeReviews[0].status = 'approved'; f.order.feeReviews[0].decidedAmount = 20.25;
  f.order.chargeLines.push({ code: `early_return_refund:o:${f.changes[0].id}`, type: 'early_return_refund', amount: -20.25 });
  f.order.finalPayableAmount = 60.75; f.order.adjustmentAmount = -20.25;
  assert.equal((await f.apply(at(7), 'replacement_current_price', 'c')).applied.change.additionalAmount, 60.75);
});

test('coupon-member splits never allocate more than the segment net base at cent boundaries', async () => {
  const f = fixture({ days: 2, old: 0.01, next: 0.01 });
  adoptedRentalCoupon(f, { type: 'fixed_amount', value: 0.01 });
  adoptedRentalMembership(f, { calculation: 'amount', value: 0.01 });
  const member = f.quote.membershipBenefitEvaluations[0]; member.base = 0.01;
  const result = await f.apply(at(1));
  assert.equal(result.priced.pricingSnapshot.differenceAmount, 0);
  for (const segment of result.priced.linePricing.segments) {
    assert.ok(segment.couponBenefit.discountAmount + segment.membershipBenefit.appliedAmount <= segment.amount);
    assert.equal(segment.membershipBenefit.base, Math.round((segment.amount - segment.couponBenefit.discountAmount) * 100) / 100);
  }
  const pricing = f.changes[0].diff.exchange.executionBasis.linePricing;
  pricing.membershipPricing.replacementReduction = 0;
  pricing.membershipPricing.replacementNetAmount = pricing.replacementAmount;
  pricing.segments.forEach(segment => { segment.membershipBenefit.appliedAmount = 0; segment.membershipBenefit.allocations = { line: 0 }; });
  await assert.rejects(f.quoteExchange(at(1.5), 'replacement_current_price', 'c'), /原优惠/);
});

test('coupon-member fixed amounts and caps consume each adopted layer only once', async () => {
  for (const capped of [false, true]) {
    const f = fixture(); adoptedCouponAndMember(f);
    const coupon = f.quote.couponEvaluation, member = f.quote.membershipBenefitEvaluations[0];
    coupon.discountType = capped ? 'percentage' : 'fixed_amount'; coupon.discountValue = capped ? 50 : 20;
    coupon.maximumDiscount = capped ? 20 : undefined; coupon.discountAmount = 20; coupon.rentalAllocations = { a: 20 };
    member.calculation = capped ? 'percentage' : 'amount'; member.configuredValue = capped ? 50 : 10;
    member.configuredMaximum = capped ? 10 : undefined; member.base = 80; member.appliedAmount = 10; member.allocations = { a: 10 };
    f.quote.couponAmount = 20; f.quote.discountAmount = 10; f.quote.payableAmount = 70;
    f.order.payableAmount = f.order.finalPayableAmount = 70;
    f.order.chargeLines.find(row => row.code === 'coupon').amount = -20;
    f.order.chargeLines.find(row => row.code === 'membership').amount = -10;
    const first = await f.apply();
    assert.equal(first.priced.linePricing.couponPricing.replacementReduction, 20);
    assert.equal(first.priced.linePricing.membershipPricing.replacementReduction, 10);
    assert.equal(f.order.finalPayableAmount, 120);
    const second = await f.apply(at(7), 'replacement_current_price', 'c');
    assert.equal(second.priced.linePricing.couponPricing.replacementReduction, 20);
    assert.equal(second.priced.linePricing.membershipPricing.replacementReduction, 10);
    assert.equal(f.order.finalPayableAmount, 150);
  }
});

function adoptedMarketingLayers(f, { coupon = true, member = true, plan = {}, couponConfig = {}, memberConfig = {} } = {}) {
  adoptedRentalPlan(f, plan);
  const marketing = f.quote.discountEvaluations[0].discountAmount;
  if (coupon) {
    adoptedRentalCoupon(f, couponConfig);
    const row = f.quote.couponEvaluation;
    row.runningBase = Math.round((f.quote.rentalAmount - marketing) * 100) / 100;
    row.discountAmount = f.business.discountAmount(row.runningBase, row.discountType, row.discountValue, row.maximumDiscount);
    row.rentalAllocations = { a: row.discountAmount }; f.quote.couponAmount = row.discountAmount;
    f.order.chargeLines.find(row => row.code === 'coupon').amount = -f.quote.couponAmount;
  }
  let membership = 0;
  if (member) {
    adoptedRentalMembership(f, memberConfig);
    const row = f.quote.membershipBenefitEvaluations[0];
    row.base = Math.round((f.quote.rentalAmount - marketing - f.quote.couponAmount) * 100) / 100;
    row.appliedAmount = f.business.membershipBenefitAmount({ calculation: row.calculation, value: row.configuredValue,
      maximum: row.configuredMaximum }, row.base);
    row.allocations = { a: row.appliedAmount }; membership = row.appliedAmount;
    f.order.chargeLines.find(row => row.code === 'membership').amount = -membership;
  }
  f.quote.discountAmount = Math.round((marketing + membership) * 100) / 100;
  f.quote.payableAmount = Math.round((f.quote.rentalAmount - f.quote.discountAmount - f.quote.couponAmount) * 100) / 100;
  f.order.payableAmount = f.order.finalPayableAmount = f.quote.payableAmount;
}

function adoptedStackableMarketingLayers(f, { first = {}, second = {}, ...options } = {}) {
  adoptedMarketingLayers(f, { ...options, plan: first });
  const { selectDiscountPlans } = require('../apps/api/src/modules/rental-core/rental-discount-selection');
  const firstPlan = clone(f.quote.discountEvaluations[0].planSnapshot);
  const secondPlan = { ...clone(firstPlan), id: 'second-plan', code: 'SECOND', priority: 2, discountValue: 20, ...second };
  const selected = selectDiscountPlans([secondPlan, firstPlan], {
    bases: { rental: f.quote.rentalAmount, fulfillment: 0, service: 0 }, minimumSpendBase: f.quote.rentalAmount,
    customerType: 'personal', hasCustomer: true, itemGroupIds: ['a'], pricingGroupIds: [],
    rentalLines: [{ id: 'a', itemGroupId: 'a', amount: f.quote.rentalAmount }], dayTypes: new Set(), rentalStartAt: start, workspaceId: 'w'
  });
  assert.equal(selected.applied.length, 2);
  f.quote.discountEvaluations = selected.evaluations;
  const money = value => Math.round(value * 100) / 100, marketing = selected.discountByTarget.rental;
  if (f.quote.couponEvaluation) {
    const coupon = f.quote.couponEvaluation; coupon.runningBase = money(f.quote.rentalAmount - marketing);
    coupon.discountAmount = f.quote.couponAmount = f.business.discountAmount(coupon.runningBase, coupon.discountType, coupon.discountValue, coupon.maximumDiscount);
    coupon.rentalAllocations = { a: coupon.discountAmount };
    f.order.chargeLines.find(row => row.code === 'coupon').amount = -coupon.discountAmount;
  }
  const member = f.quote.membershipBenefitEvaluations?.[0];
  if (member) {
    member.base = money(f.quote.rentalAmount - marketing - f.quote.couponAmount);
    member.appliedAmount = f.business.membershipBenefitAmount({ calculation: member.calculation, value: member.configuredValue, maximum: member.configuredMaximum }, member.base);
    member.allocations = { a: member.appliedAmount };
    f.order.chargeLines.find(row => row.code === 'membership').amount = -member.appliedAmount;
  }
  f.quote.discountAmount = money(marketing + (member?.appliedAmount ?? 0));
  f.quote.payableAmount = money(f.quote.rentalAmount - f.quote.discountAmount - f.quote.couponAmount);
  f.order.payableAmount = f.order.finalPayableAmount = f.quote.payableAmount;
  f.order.chargeLines.find(row => row.code === 'plan').amount = -marketing;
}

test('adopted stackable marketing plans retain individual budgets before coupon and membership through exchange', async () => {
  const f = fixture(); adoptedStackableMarketingLayers(f);
  const original = clone(f.quote);
  const first = await f.apply();
  assert.equal(first.priced.linePricing.discountPricing.version, 2);
  assert.equal(first.priced.linePricing.discountPricing.replacementReduction, 42);
  assert.equal(f.order.finalPayableAmount, 87.48);
  const replacement = first.priced.linePricing.segments[1];
  assert.deepEqual(replacement.discountLayers.map(row => [row.evaluation.planId, row.evaluation.base, row.evaluation.discountAmount]),
    [['original-plan', 100, 10], ['second-plan', 90, 18]]);
  assert.equal(replacement.couponBenefit.runningBase, 72); assert.equal(replacement.membershipBenefit.base, 64.8);
  const early = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
  assert.equal(early.earlyReturn.amount, 23.33);
  await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(f.order.finalPayableAmount, 104.98);
  assert.deepEqual(f.quote, original);
});

test('stackable marketing preserves independent fixed caps, scope and original-price cent tails', async () => {
  for (const second of [{ discountType: 'fixed_amount', discountValue: 20 }, { discountValue: 50, maximumDiscount: 20 },
    { discountType: 'threshold_amount', discountValue: 20, thresholdAmount: 80 }]) {
    const f = fixture(); adoptedStackableMarketingLayers(f, { first: { discountType: 'fixed_amount', discountValue: 10 }, second });
    await f.apply(at(5), 'original_order_price'); await f.apply(at(7), 'replacement_current_price', 'c');
    const receipt = f.changes.at(-1).diff.exchange.executionBasis.linePricing;
    assert.deepEqual(receipt.segments.reduce((sum, row) => sum.map((amount, index) =>
      Math.round((amount + row.discountLayers[index].evaluation.discountAmount) * 100) / 100), [0, 0]), [10, 20]);
    assert.equal(receipt.discountPricing.replacementReduction, 30);
  }
  const scoped = fixture(); adoptedStackableMarketingLayers(scoped, { second: { applicableItemGroupIds: ['a'] } });
  const first = await scoped.apply();
  assert.deepEqual(first.priced.linePricing.segments[1].discountLayers.map(row => row.evaluation.discountAmount), [10, 0]);
  assert.equal(first.priced.linePricing.segments[1].couponBenefit.runningBase, 90);
  await scoped.apply(at(7), 'replacement_current_price', 'c');
  const tiny = fixture({ days: 3, old: 0.01, next: 0.01 });
  adoptedStackableMarketingLayers(tiny, { first: { discountType: 'fixed_amount', discountValue: 0.01 },
    second: { discountType: 'fixed_amount', discountValue: 0.01 }, coupon: false, member: false });
  await tiny.apply(at(1), 'original_order_price', 'c'); await tiny.apply(at(2));
  assert.equal(tiny.order.finalPayableAmount, 0.01);
  assert.equal(tiny.changes.at(-1).diff.exchange.executionBasis.linePricing.discountPricing.replacementReduction, 0.02);
});

test('stackable marketing rejects missing identities and balanced transfers between plans before successor writes', async () => {
  const f = fixture(); adoptedStackableMarketingLayers(f);
  const quote = clone(f.quote);
  for (const patch of [rows => { delete rows[1].planSnapshot; }, rows => { rows[1].planSnapshot.stackableWithOtherPlans = false; },
    rows => { for (const row of rows) row.planSnapshot.exclusiveGroup = 'same'; }, rows => { rows[1].base++; }]) {
    f.quote.discountEvaluations = clone(quote.discountEvaluations);
    patch(f.quote.discountEvaluations);
    await assert.rejects(f.apply(), /原优惠/); assert.equal(f.changes.length, 0);
  }
  f.quote.discountEvaluations = clone(quote.discountEvaluations);
  await f.apply();
  const pricing = f.changes[0].diff.exchange.executionBasis.linePricing, layers = pricing.segments[1].discountLayers;
  layers[0].evaluation.discountAmount++; layers[0].evaluation.rentalAllocations.line++;
  layers[1].evaluation.base--; layers[1].evaluation.discountAmount--; layers[1].evaluation.rentalAllocations.line--;
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /原优惠/);
});

test('stackable marketing negative exchange and partial returns consume original approved net only', async () => {
  const negative = fixture({ next: 5 }); adoptedStackableMarketingLayers(negative);
  await negative.apply();
  const change = negative.changes[0], review = negative.order.feeReviews[0];
  await assert.rejects(negative.quoteExchange(at(7), 'replacement_current_price', 'c'), /尚未完整核减/);
  review.status = 'approved'; review.decidedAmount = change.refundAmount;
  negative.order.chargeLines.push({ code: `early_return_refund:o:${change.id}`, type: 'early_return_refund', amount: -change.refundAmount });
  negative.order.adjustmentAmount = -change.refundAmount;
  negative.order.finalPayableAmount = Math.round((negative.order.payableAmount - change.refundAmount) * 100) / 100;
  const writes = [], tx = { original: true };
  negative.business.factStore.repriceOrderCoupon = async (_tenant, _order, amount, transaction) => {
    assert.equal(transaction, tx); writes.push(amount);
  };
  await negative.business.synchronizeExchangeCoupon('t', negative.order, review.id, negative.changes, tx);
  assert.deepEqual(writes, [5.4]);
  await negative.apply(at(7), 'replacement_current_price', 'c');
  const f = fixture({ quantity: 3 }); adoptedStackableMarketingLayers(f);
  await f.apply();
  const allocation = f.order.allocations.find(row => row.status === 'picked_up');
  const items = [{ allocationId: allocation.id, quantity: 1 }];
  f.core.factStore.listAssets = async () => [];
  const returned = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
  f.core.stampPartialReturnReceipts(f.order, items, returned, 'batch-first', at(6));
  const refund = f.business.calculateEarlyReturnRefund('t', f.context, f.quote, f.order.endAt, at(8), 0, undefined,
    { ...f.order, changes: f.changes }, f.extensions);
  assert.equal(refund.amount, 93.31, '58.32×4/5 plus116.64×2/5 aggregates93.312 before rounding the one order fee');
  const saved = f.changes[0].diff.exchange.executionBasis.linePricing;
  saved.segments[1].discountLayers.reverse();
  const bad = f.business.calculateEarlyReturnRefund('t', f.context, f.quote, f.order.endAt, at(8), 0, undefined,
    { ...f.order, changes: f.changes }, f.extensions);
  assert.equal(bad.amount, null);
});

test('damaged stackable marketing rows remain a source conflict rather than an exception outside review handling', async () => {
  const f = fixture(); adoptedStackableMarketingLayers(f); await f.apply();
  const saved = clone(f.changes[0]);
  for (const mutate of [pricing => { pricing.discountPricing.evaluations[0] = null; },
    pricing => { pricing.segments[1].discountLayers[0] = null; }, pricing => { pricing.segments[1].discountLayers[0].evaluation = null; }]) {
    f.changes[0] = clone(saved); mutate(f.changes[0].diff.exchange.executionBasis.linePricing);
    await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), error => error.getStatus?.() === 409);
    const refund = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
    assert.equal(refund.earlyReturn.amount, null);
  }
});

test('marketing then coupon then membership uses each remaining base through exchange and early return', async () => {
  for (const options of [{}, { coupon: false }, { member: false }, { plan: { applicableItemGroupIds: ['a'] } }]) {
    const f = fixture(); adoptedMarketingLayers(f, options); const original = clone(f.quote);
    const first = await f.apply();
    const pricing = first.priced.linePricing;
    for (const segment of pricing.segments) {
      const marketing = segment.discountBenefit.discountAmount;
      const coupon = segment.couponBenefit?.discountAmount ?? 0;
      if (segment.couponBenefit) assert.equal(segment.couponBenefit.runningBase, Math.round((segment.amount - marketing) * 100) / 100);
      if (segment.membershipBenefit) assert.equal(segment.membershipBenefit.base, Math.round((segment.amount - marketing - coupon) * 100) / 100);
    }
    const early = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
    if (options.coupon !== false && options.member !== false && !options.plan) {
      assert.equal(f.quote.payableAmount, 72.9);
      assert.equal(first.applied.change.additionalAmount, 36.45);
      assert.equal(f.order.finalPayableAmount, 109.35);
      assert.equal(early.earlyReturn.amount, 29.16);
      assert.equal(first.priced.pricingSnapshot.couponEvaluation.runningBase, 135);
      assert.equal(first.priced.pricingSnapshot.membershipBenefitEvaluations[0].base, 121.5);
    } else assert.ok(early.earlyReturn.amount > 0);
    await f.apply(at(7), 'replacement_current_price', 'c');
    assert.deepEqual(f.quote, original);
    if (!Object.keys(options).length) assert.equal(f.order.finalPayableAmount, 131.22);
  }
});

test('joint marketing layers preserve cent bounds, original-price receipts and one-time fixed budgets', async () => {
  const tiny = fixture({ days: 3, old: 0.01, next: 0.01 });
  adoptedMarketingLayers(tiny, { plan: { discountType: 'fixed_amount', discountValue: 0.01 },
    couponConfig: { type: 'fixed_amount', value: 0.01 }, memberConfig: { calculation: 'amount', value: 0.01 } });
  assert.equal((await tiny.apply(at(1))).applied.change.additionalAmount, 0);
  await tiny.apply(at(2), 'original_order_price', 'c');
  for (const segment of tiny.changes.at(-1).diff.exchange.executionBasis.linePricing.segments) {
    assert.ok(Math.round((segment.discountBenefit.discountAmount + segment.couponBenefit.discountAmount
      + segment.membershipBenefit.appliedAmount) * 100) <= Math.round(segment.amount * 100));
  }
  const f = fixture(); adoptedMarketingLayers(f, { plan: { discountType: 'fixed_amount', discountValue: 20 },
    couponConfig: { type: 'fixed_amount', value: 10 }, memberConfig: { calculation: 'amount', value: 5 } });
  await f.apply(at(5), 'original_order_price');
  await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(f.order.finalPayableAmount, 125);
  const same = fixture({ days: 2, old: 100.01, next: 100.01 });
  adoptedMarketingLayers(same, { plan: { discountValue: 50 }, couponConfig: { value: 50 }, memberConfig: { value: 50 } });
  assert.equal((await same.apply(at(1))).priced.pricingSnapshot.differenceAmount, 0);
});

test('negative three-layer exchange synchronizes only its fully approved original coupon budget', async () => {
  const f = fixture({ next: 5 }); adoptedMarketingLayers(f); await f.apply();
  const change = f.changes[0], review = f.order.feeReviews[0], tx = { original: true }, budgets = [];
  assert.equal(change.refundAmount, 18.23, 'remaining membership 20.25 at 10% rounds to 2.03, preserving the performed 4.05');
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /尚未完整核减/);
  f.business.factStore = { ...f.business.factStore, repriceOrderCoupon: async (_tenant, _order, amount, transaction) => {
    assert.equal(transaction, tx); budgets.push(amount);
  } };
  review.status = 'approved'; review.decidedAmount = 10;
  await f.business.synchronizeExchangeCoupon('t', f.order, review.id, f.changes, tx);
  assert.deepEqual(budgets, []);
  review.decidedAmount = change.refundAmount;
  f.order.chargeLines.push({ code: `early_return_refund:o:${change.id}`, type: 'early_return_refund', amount: -change.refundAmount });
  f.order.adjustmentAmount = -change.refundAmount;
  f.order.finalPayableAmount = Math.round((f.order.payableAmount - change.refundAmount) * 100) / 100;
  await f.business.synchronizeExchangeCoupon('t', f.order, review.id, f.changes, tx);
  assert.deepEqual(budgets, [6.75]);
  const next = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(f.order.finalPayableAmount, 109.35);
  assert.equal(next.applied.change.additionalAmount, 54.68, '109.35 less the approved original 54.67 net');
});

test('joint history cannot shift equal reductions between marketing and coupon to release budget', async () => {
  const f = fixture({ next: 5 }); adoptedMarketingLayers(f); await f.apply();
  const change = f.changes[0], pricing = change.diff.exchange.executionBasis.linePricing;
  const segment = pricing.segments[1];
  segment.discountBenefit.discountAmount++; segment.discountBenefit.rentalAllocations.line++;
  pricing.discountPricing.replacementReduction++; pricing.discountPricing.replacementNetAmount--;
  segment.couponBenefit.discountAmount--; segment.couponBenefit.rentalAllocations.line--;
  segment.couponBenefit.runningBase--;
  pricing.couponPricing.replacementReduction--; pricing.couponPricing.replacementNetAmount++;
  const review = f.order.feeReviews[0]; review.status = 'approved'; review.decidedAmount = change.refundAmount;
  f.order.chargeLines.push({ code: `early_return_refund:o:${change.id}`, type: 'early_return_refund', amount: -change.refundAmount });
  let writes = 0;
  f.business.factStore = { ...f.business.factStore, repriceOrderCoupon: async () => { writes++; } };
  await assert.rejects(f.business.synchronizeExchangeCoupon('t', f.order, review.id, f.changes, {}), /原优惠/);
  assert.equal(writes, 0);
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /原优惠/);
});

test('joint marketing rejects unstackable coupons and reconciles all layers to booked change', async () => {
  const f = fixture(); adoptedMarketingLayers(f);
  f.quote.couponEvaluation.stackableWithDiscountPlans = false;
  await assert.rejects(f.apply(), /原优惠/); assert.equal(f.changes.length, 0);
  f.quote.couponEvaluation.stackableWithDiscountPlans = true;
  await f.apply();
  const pricing = f.changes[0].diff.exchange.executionBasis.linePricing;
  pricing.discountPricing.replacementReduction++;
  pricing.discountPricing.replacementNetAmount--;
  pricing.segments[1].discountBenefit.discountAmount++;
  pricing.segments[1].discountBenefit.rentalAllocations.line++;
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /原优惠/);
});

test('exchange preserves independent service and fulfillment discounts and cancels only the original service net', async () => {
  for (const cancel of [false, true]) {
    const f = fixture();
    const original = { occurrenceId: 'original-service', workspaceId: 'w', serviceId: 'setup', serviceName: '原服务',
      serviceVersion: '1', termsVersion: '1', terms: '原条款', quantity: 1, amount: 10, discountAllocatedAmount: 5,
      executionStatus: cancel ? 'not_started' : 'completed', requiresCapacity: false, applicableItemGroupIds: ['a'] };
    f.quote.serviceAmount = 10; f.quote.fulfillmentAmount = 20; f.quote.discountAmount = 5; f.quote.couponAmount = 5;
    f.quote.discountEvaluations = [{ applied: true, appliesTo: 'service', discountAmount: 3 }];
    f.quote.membershipBenefitEvaluations = [{ appliesTo: 'service', appliedAmount: 2 }];
    f.quote.couponEvaluation = { appliesTo: 'fulfillment', discountAmount: 5 };
    f.quote.serviceSnapshots = [clone(original)];
    f.quote.payableAmount = 120; f.order.payableAmount = f.order.finalPayableAmount = 120;
    f.order.serviceSnapshots = [clone(original)];
    f.order.chargeLines = [...clone(f.quote.chargeLines), { code: 'service', type: 'service', amount: 10 },
      { code: 'fulfillment', type: 'fulfillment', amount: 20 }, { code: 'discount', type: 'discount', amount: -5 },
      { code: 'coupon', type: 'coupon', amount: -5 }];
    const before = clone(f.quote);
    const result = await f.apply(at(5), 'replacement_current_price', 'b',
      cancel ? { exchangeCancelledServiceOccurrenceIds: [original.occurrenceId] } : {});
    assert.equal(result.priced.pricingSnapshot.differenceAmount, cancel ? 45 : 50);
    assert.equal(f.order.finalPayableAmount, cancel ? 165 : 170);
    assert.equal(f.order.serviceSnapshots[0].discountAllocatedAmount, 5);
    if (cancel) assert.equal(f.order.serviceSnapshots[0].refundAmount, 5);
    else assert.deepEqual(f.order.serviceSnapshots[0], original);
    assert.deepEqual(f.quote, before, 'original discount and coupon receipts remain immutable');
  }
  for (const mutate of [f => { f.quote.discountAmount = 5; },
    f => { f.quote.couponAmount = 5; },
    f => { f.quote.discountAmount = 5; f.quote.discountEvaluations = [{ applied: true, appliesTo: 'service', discountAmount: 3 }]; },
    f => { f.quote.couponAmount = 5; f.quote.couponEvaluation = { appliesTo: 'service', discountAmount: 3 }; },
    f => { f.quote.discountAmount = NaN; },
    f => { f.quote.discountAmount = 5; f.quote.discountEvaluations = [{ applied: true, appliesTo: 'service', discountAmount: 5 }]; },
    f => { f.quote.discountAmount = 5; f.quote.discountEvaluations = [{ applied: true, appliesTo: 'service', discountAmount: 5 }];
      f.quote.serviceSnapshots = [{ amount: 3, discountAllocatedAmount: 5 }]; },
    f => { f.quote.discountEvaluations = [{ applied: true, discountAmount: 5 }]; },
    f => { f.quote.membershipBenefitEvaluations = [{ appliedAmount: 5 }]; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.quoteExchange(), /原优惠/);
    assert.equal(f.changes.length, 0);
  }
});

test('exchange cancellation releases only the original capacity, reprices new service net once, and rolls back a failed reservation fixture', async () => {
  const f = fixture(), c = exchangeCapacityFixture();
  f.business.configStore.readServicesForExchange = f.core.businessConfigStore.readServicesForExchange = async () => [exchangeOperator];
  f.core.serviceCapacities = c.service;
  const original = { occurrenceId: 'original-operator', workspaceId: 'w', serviceId: 'operator', serviceName: '原操作员', serviceVersion: '1',
    termsVersion: '1', terms: '原条款', amount: 10, discountAllocatedAmount: 3, quantity: 1, capacityQuantity: 1, requiresCapacity: true,
    executionStatus: 'not_started', requiredByRule: true, applicableItemGroupIds: ['a'], reservationKey: 'old-capacity', serviceLocationId: 'loc',
    scheduledStartAt: at(5), scheduledEndAt: at(10) };
  f.order.serviceSnapshots = [clone(original)]; f.order.payableAmount = f.order.finalPayableAmount = 107;
  c.capacity.usedQuantity = 1;
  c.receipts.push({ id: 'original-receipt', orderId: 'o', tenantId: 't', workspaceId: 'w', idempotencyKey: 'old-capacity',
    capacityId: c.capacity.id, serviceId: 'operator', quantity: 1, status: 'confirmed' });
  const serviceInput = { ...selectedExchangeServices, exchangeCancelledServiceOccurrenceIds: [original.occurrenceId] };
  const scoped = work => runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, work);
  const priced = await f.quoteExchange(at(5), 'replacement_current_price', 'b', serviceInput);
  await scoped(() => c.service.assertAvailableForExchange('t', 'o', priced.priced.serviceSnapshots, [original], c.tx));
  assert.equal(c.capacity.usedQuantity, 1); assert.equal(c.receipts[0].status, 'confirmed', 'preview must not release original capacity');
  await f.apply(at(5), 'replacement_current_price', 'b', serviceInput, {}, c.tx);
  assert.equal(f.order.finalPayableAmount, 170); assert.equal(f.changes[0].additionalAmount, 63);
  assert.equal(f.order.serviceSnapshots[0].amount, 10); assert.equal(f.order.serviceSnapshots[0].terms, '原条款');
  assert.equal(f.order.serviceSnapshots[0].refundAmount, 7); assert.equal(f.order.serviceSnapshots[0].executionStatus, 'cancelled');
  assert.equal(c.receipts[0].status, 'released'); assert.equal(c.receipts[1].status, 'confirmed'); assert.equal(c.capacity.usedQuantity, 1);
  assert.ok(c.trace.indexOf('released') < c.trace.indexOf('reserve-receipt'));
  const failed = fixture(), noCapacity = exchangeCapacityFixture();
  failed.business.configStore.readServicesForExchange = failed.core.businessConfigStore.readServicesForExchange = async () => [exchangeOperator];
  failed.core.serviceCapacities = noCapacity.service; noCapacity.refuse();
  const saved = clone(failed.order);
  // Explicit transaction substitute: verifies exception propagation and rollback ordering, not a MySQL COMMIT claim.
  await assert.rejects((async () => {
    try { await failed.apply(at(5), 'replacement_current_price', 'b', selectedExchangeServices, {}, noCapacity.tx); }
    catch (error) { Object.assign(failed.order, clone(saved)); throw error; }
  })(), /容量已被其他订单占用/);
  assert.deepEqual(failed.order, saved); assert.equal(failed.changes.length, 0); assert.equal(noCapacity.receipts.length, 0);
});

test('completed same-service work remains historical and a disabled original capacity can be cancelled for a current replacement', async () => {
  const completed = fixture(), c = exchangeCapacityFixture();
  completed.business.configStore.readServicesForExchange = completed.core.businessConfigStore.readServicesForExchange = async () => [exchangeOperator];
  completed.core.serviceCapacities = c.service;
  const original = { occurrenceId: 'original-work', workspaceId: 'w', serviceId: 'operator', serviceName: '已完成安装', serviceType: 'support',
    serviceVersion: '1', termsVersion: '1', terms: '原安装条款', quantity: 1, amount: 7, executionStatus: 'completed',
    scheduledStartAt: at(0), scheduledEndAt: at(10), requiresCapacity: false };
  completed.order.serviceSnapshots = [clone(original)];
  await completed.apply(at(5), 'replacement_current_price', 'b', selectedExchangeServices, {}, c.tx);
  assert.deepEqual(completed.order.serviceSnapshots[0], original);
  assert.equal(completed.order.serviceSnapshots[1].executionStatus, 'not_started');
  const f = fixture(), capacity = exchangeCapacityFixture();
  f.business.configStore.readServicesForExchange = f.core.businessConfigStore.readServicesForExchange = async () => [exchangeOperator];
  f.core.serviceCapacities = capacity.service;
  const disabled = { ...capacity.capacity, id: 'disabled-original', status: 'disabled', usedQuantity: 1 };
  capacity.previousCapacities.push(disabled);
  const old = { ...original, occurrenceId: 'unstarted-original', executionStatus: 'not_started', requiredByRule: true,
    serviceType: 'operator', requiresCapacity: true, capacityQuantity: 1, reservationKey: 'disabled-original-key',
    serviceLocationId: 'loc', applicableItemGroupIds: ['a'], scheduledStartAt: at(5) };
  f.order.serviceSnapshots = [clone(old)];
  capacity.receipts.push({ id: 'old-receipt', orderId: 'o', idempotencyKey: old.reservationKey, serviceId: 'operator',
    quantity: 1, capacityId: disabled.id, status: 'confirmed' });
  await f.apply(at(5), 'replacement_current_price', 'b', { ...selectedExchangeServices,
    exchangeCancelledServiceOccurrenceIds: [old.occurrenceId] }, {}, capacity.tx);
  assert.equal(disabled.usedQuantity, 0); assert.equal(capacity.capacity.usedQuantity, 1);
  assert.equal(capacity.receipts[0].status, 'released'); assert.equal(capacity.receipts[1].status, 'confirmed');
});

test('actual quote -> Core exchange -> return uses performed 50 and remaining 100, not whole-period 200', async () => {
  const f = fixture(); const before = clone(f.quote);
  const result = await f.apply();
  assert.equal(result.originalAmount, 100); assert.equal(result.replacementAmount, 150);
  assert.equal(result.priced.pricingSnapshot.differenceAmount, 50);
  assert.equal(f.order.finalPayableAmount, 150); assert.equal(f.order.lines[0].amount, 150);
  assert.deepEqual(result.priced.linePricing.segments.map(row => row.amount), [50, 100]);
  assert.equal(result.priced.linePricing.overdueBasis.billableUnits, 5);
  assert.equal(result.priced.linePricing.overdueBasis.billedHours, 120);
  assert.equal((await f.overdue()).overdue.amount, 0.83);
  assert.equal(f.changes[0].appliedAt, f.changes[0].diff.exchange.executionBasis.effectiveFrom);
  assert.equal(f.order.allocations.at(-1).metadata.assignedAt, f.changes[0].appliedAt);
  assert.deepEqual(f.quote, before);
});

test('original price keeps exact prepaid units and no price difference through a second exchange', async () => {
  const f = fixture({ days: 2, minimum: 3 });
  assert.equal((await f.apply(at(1), 'original_order_price')).priced.pricingSnapshot.differenceAmount, 0);
  assert.equal(f.order.finalPayableAmount, 30);
  assert.equal(f.changes[0].diff.exchange.executionBasis.linePricing.overdueBasis.billableUnits, 3);
  assert.equal((await f.apply(at(1.5), 'original_order_price', 'c')).priced.pricingSnapshot.differenceAmount, 0);
  assert.equal(f.order.lines[0].itemGroupId, 'c'); assert.equal(f.order.finalPayableAmount, 30);
  assert.equal((await f.overdue()).overdue.amount, 0.42);
});

test('A -> B -> C prices only each remaining segment; partial return uses actual held quantity', async () => {
  const f = fixture({ quantity: 3 });
  await f.apply();
  const second = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(second.originalAmount, 450); assert.equal(second.replacementAmount, 540);
  assert.equal(second.priced.pricingSnapshot.differenceAmount, 90); assert.equal(f.order.finalPayableAmount, 540);
  assert.deepEqual(second.priced.linePricing.segments.map(row => row.amount), [150, 120, 270]);
  assert.equal((await f.overdue([{ allocationId: f.order.allocations.at(-1).id, quantity: 1 }])).overdue.amount, 1.25);
  f.rates[2].baseAmount = 9999;
  assert.equal((await f.overdue()).overdue.amount, 3.75);
});

test('selected old tier is not recomputed for used time; remaining cap includes performed rental', async () => {
  const tier = fixture({ tiers: [{ minUnits: 7, unitAmount: 8 }] });
  const t = await tier.quoteExchange();
  assert.equal(t.originalAmount, 80); assert.deepEqual(t.priced.linePricing.segments.map(row => row.amount), [40, 100]);
  assert.equal(t.priced.pricingSnapshot.differenceAmount, 60);
  const capped = fixture({ cap: 120 }); const c = await capped.quoteExchange();
  assert.deepEqual(c.priced.linePricing.segments.map(row => row.amount), [50, 70]);
  assert.equal(c.replacementAmount, 120); assert.equal(c.priced.pricingSnapshot.differenceAmount, 20);
});

test('week, month and calendar-day split with the original strategy rather than daily prorating', async () => {
  for (const [unit, days, point, original, expected] of [['week', 14, 7, 10, 30], ['month', 60, 30, 10, 30],
    ['calendar_day', 10, 5, 10, 150], ['night', 10, 5, 10, 120], ['shift', 2, 1, 10, 90]]) {
    const f = fixture({ unit, days, old: original });
    const result = await f.quoteExchange(at(point));
    assert.equal(result.replacementAmount, expected, unit);
    assert.equal(result.priced.linePricing.segments[0].rate.unit, unit);
  }
});

test('frozen old calendar and current remaining calendar are separate; hourly-to-daily preserves billed coverage', async () => {
  const f = fixture();
  f.quote.rateSnapshot[0].dayTypePrices = { workday: 2 };
  f.quote.rentalAmount = f.quote.payableAmount = f.quote.chargeLines[0].amount = f.quote.rentalLineAmounts.a = 200;
  f.order.lines[0].amount = f.order.finalPayableAmount = 200;
  const result = await f.quoteExchange();
  assert.deepEqual(result.priced.linePricing.segments.map(row => row.amount), [100, 100]);
  const h = fixture({ unit: 'hour', days: 1, old: 10, next: 20 });
  h.quote.ruleSnapshot.pricing = { hourToDayEnabled: true, hourToDayThresholdHours: 6 };
  h.quote.pricingContext.dayRates = [{ ...h.rates[0], unit: 'day_24h', baseAmount: 100 }];
  h.rates.push({ ...h.rates[1], unit: 'day_24h', baseAmount: 150 });
  h.quote.rentalAmount = h.quote.payableAmount = h.quote.chargeLines[0].amount = h.quote.rentalLineAmounts.a = 100;
  h.order.lines[0].amount = h.order.finalPayableAmount = 100;
  const short = await h.quoteExchange(at(0.02));
  assert.equal(short.priced.linePricing.segments[0].amount, 10, 'a frozen day price cannot become the hourly rate for the used prefix');
  assert.equal(short.replacementAmount, 160);
  const hr = await h.apply(at(0.5));
  assert.equal(hr.replacementAmount, 250);
  assert.equal(hr.priced.linePricing.overdueBasis.billedHours, 24);
  assert.equal((await h.overdue()).overdue.amount, 6.25);
});

test('original-price carried blocks split cumulatively; new prices after another exchange do not double consumed units', async () => {
  const f = fixture({ days: 4, minimum: 1 });
  await f.apply(at(0.5), 'original_order_price');
  const second = await f.apply(at(1.2), 'replacement_current_price', 'c');
  assert.deepEqual(second.priced.linePricing.segments.map(row => row.amount), [10, 10, 90]);
  assert.equal(second.replacementAmount, 110);
});

test('a completed original-total extension is a frozen source and a later early return remains manual', async () => {
  const f = fixture();
  const full = f.business.priceRentalLine({ group: f.context.groups[0], quantity: 1, rate: f.rates[0], startAt: start, endAt: at(12),
    timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false, planId: 'price-original', planVersion: '1', codePrefix: 'rental', chargeType: 'rental' });
  f.extensions.push({ id: 'ext', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1, status: 'effective', originalEndAt: at(10), newEndAt: at(12),
    rateSnapshot: [clone(f.rates[0])], ruleSnapshot: clone(f.quote.ruleSnapshot), executionBasis: { pricingMode: 'original_total' },
    pricingSnapshot: { context: clone(f.quote.pricingContext), fullChargeLines: [full.chargeLine], recalculatedDiscountAmount: 0, recalculatedCouponAmount: 0 } });
  f.order.effectiveEndAt = at(12); f.order.finalPayableAmount = 120; f.order.adjustmentAmount = 20;
  f.order.chargeLines.push({ code: 'extension:1', name: '已生效续租', type: 'extension', amount: 20 });
  f.extensions[0].pricingSnapshot.rentalLineAmounts = { a: 120 };
  f.extensions[0].pricingSnapshot.recalculatedRentalAmount = 120;
  f.extensions[0].pricingSnapshot.fullChargeLines[0].code = 'rental:RENAMED';
  for (const map of [null, [120], {}, { foreign: 120 }, { a: 121 }, { a: -1 }, { a: NaN }]) {
    f.extensions[0].pricingSnapshot.rentalLineAmounts = map;
    await assert.rejects(f.quoteExchange(at(5)), error => error.getStatus() === 409);
  }
  f.extensions[0].pricingSnapshot.rentalLineAmounts = { a: 120 };
  const result = await f.apply(at(5));
  assert.equal(result.originalAmount, 120); assert.equal(result.replacementAmount, 190);
  assert.equal(f.order.finalPayableAmount, 190);
  f.order.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  const early = f.business.calculateEarlyReturnRefund('t', f.context, f.quote, at(12), at(8), 0, undefined, { ...f.order, changes: f.changes });
  assert.equal(early.amount, null); assert.equal(early.requiresReview, true); assert.equal(early.maximumAmount, 190);
  f.extensions[0].pricingSnapshot.refundReview = { status: 'pending', amount: 20 };
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /原续租负差额尚未完整核减/);
});

test('exchange early return uses original remaining segments without repricing performed rental', async () => {
  const f = fixture();
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  await f.apply(at(5));
  f.controller.service.lockOrderForUpdate = async () => clone(f.order);
  const calculate = point => f.controller.returnCharges('t', f.context, 'o', point, {}, undefined, 'return', true);
  assert.equal((await calculate(at(8))).earlyReturn.amount, 40, 'only two remaining days of the replacement at 20');
  f.order.ruleSnapshot.earlyReturn.maxRefundAmount = 25;
  assert.equal((await calculate(at(8))).earlyReturn.amount, 25);
  delete f.order.ruleSnapshot.earlyReturn.maxRefundAmount;
  const saved = clone(f.changes[0]);
  delete f.changes[0].diff.exchange.executionBasis.linePricing;
  assert.equal((await calculate(at(8))).earlyReturn.amount, null);
  f.changes[0] = saved;
  f.quote.discountEvaluations = [{ applied: true, appliesTo: 'rental', discountAmount: 10 }];
  assert.equal((await calculate(at(8))).earlyReturn.amount, null, 'gross segments cannot stand in for missing net benefit allocation');
  f.quote.discountEvaluations = [];
  f.order.ruleSnapshot.earlyReturn.mode = 'manual_review';
  const reviewed = (await calculate(at(8))).earlyReturn;
  assert.equal(reviewed.amount, 40); assert.equal(reviewed.requiresReview, true);
  f.order.ruleSnapshot.earlyReturn.mode = 'auto';
  const second = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(second.replacementAmount, 180);
  assert.equal((await calculate(at(8))).earlyReturn.amount, 60, 'second exchange retains earlier performed periods');
});

test('exchange before partial returns consumes the current handed-over cohort and each batch receipt', async () => {
  const f = fixture({ quantity: 3 });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  await f.apply(at(5));
  const current = f.order.allocations.find(row => row.status === 'picked_up');
  f.core.factStore.listAssets = async () => [];
  const items = [{ allocationId: current.id, quantity: 1 }];
  const ids = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
  f.core.stampPartialReturnReceipts(f.order, items, ids, 'first-replacement-return', at(6));
  const frozen = clone(f.order), history = clone(f.changes);
  const calculate = point => f.controller.returnCharges('t', f.context, 'o', at(point), {}, undefined, 'last-replacement-return', true);
  assert.equal((await calculate(8)).earlyReturn.amount, 160, 'replacement first piece four unused days80 plus final two pieces two days80; old handover is not a physical final return');
  assert.equal((await calculate(11)).earlyReturn.amount, 80, 'late final batch retains the first actual replacement return');
  assert.deepEqual(f.order, frozen); assert.deepEqual(f.changes, history);
  const first = f.order.allocations.find(row => row.metadata?.returnReceipt);
  first.metadata.returnReceipt.returnedAt = at(4);
  assert.equal((await calculate(8)).earlyReturn.amount, null, 'a batch before replacement handover cannot consume its new period');
  Object.assign(f.order, clone(frozen));
  const returned = f.order.allocations.find(row => row.metadata?.returnReceipt);
  returned.metadata.returnReceipt.sourceAllocationId = 'unrelated-allocation';
  assert.equal((await calculate(8)).earlyReturn.amount, null, 'the returned piece must come from the original replacement allocation');
  Object.assign(f.order, clone(frozen));
  f.order.allocations.find(row => row.metadata?.returnReceipt).itemGroupId = 'c';
  assert.equal((await calculate(8)).earlyReturn.amount, null, 'batch identity cannot borrow another model under the same source id');
  Object.assign(f.order, clone(frozen));
  const fee = f.order.chargeLines.find(row => row.code === `exchange:${f.changes[0].id}`);
  fee.amount -= 1;
  assert.equal((await calculate(8)).earlyReturn.amount, null, 'a valid cohort does not replace the missing matching net receivable');
  Object.assign(f.order, clone(frozen));
  f.changes.push({ status: 'rejected', type: 'service_cancel' });
  assert.equal((await calculate(8)).earlyReturn.amount, 160);
  f.changes.at(-1).status = 'unknown';
  assert.equal((await calculate(8)).earlyReturn.amount, null, 'unknown changes remain outside the proved exchange-only history');
  f.changes.pop();
  f.order.ruleSnapshot.earlyReturn.minAdvanceHours = 72;
  assert.equal((await calculate(8)).earlyReturn.amount, 80, 'only the first batch meets the original final deadline advance requirement');
  f.order.ruleSnapshot.earlyReturn.minAdvanceHours = 0;
  const secondItems = [{ allocationId: current.id, quantity: 1 }];
  const secondIds = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, secondItems, {}, []);
  f.core.stampPartialReturnReceipts(f.order, secondItems, secondIds, 'second-replacement-return', at(7));
  assert.equal((await calculate(8)).earlyReturn.amount, 180, 'three batches consume one piece each:80+60+40');
  Object.assign(f.order, clone(frozen));
  f.order.ruleSnapshot.earlyReturn.maxRefundAmount = 100;
  assert.equal((await calculate(8)).earlyReturn.amount, 100);
  delete f.order.ruleSnapshot.earlyReturn.maxRefundAmount;
  f.order.ruleSnapshot.earlyReturn.mode = 'manual_review';
  assert.equal((await calculate(8)).earlyReturn.requiresReview, true);
});

test('partial exchange returns preserve adopted net benefits, repeated handovers and independent extension periods', async () => {
  for (const scenario of ['joint', 'original', 'repeated', 'extension', 'joint-extension', 'stacked-extension']) {
    const f = fixture({ quantity: 3 });
    f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
    if (scenario === 'joint' || scenario === 'original' || scenario === 'joint-extension') adoptedMarketingLayers(f);
    if (scenario === 'stacked-extension') adoptedStackableMarketingLayers(f);
    await f.apply(at(5), scenario === 'original' ? 'original_order_price' : 'replacement_current_price');
    let firstAt = 6, finalAt = 8, expected = scenario === 'joint' ? 116.64 : scenario === 'original' ? 58.32 : 160;
    if (scenario === 'repeated') {
      await f.apply(at(7), 'replacement_current_price', 'c');
      firstAt = 8; finalAt = 9; expected = 120;
    }
    if (scenario.endsWith('extension')) {
      f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
      f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '2',
        effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], quotes: [], calendars: [], ruleVersions: [] });
      f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
      const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], previousChanges: f.changes,
        lines: f.order.lines, newEndAt: at(12), appliedAt: at(5.5), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
      assert.equal(priced.rentalAmount, 120);
      f.extensions.push({ ...clone(priced), id: 'replacement-extension', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1,
        status: 'effective', effectiveAt: at(5.5) });
      f.order.effectiveEndAt = at(12); f.order.finalPayableAmount += 120; f.order.adjustmentAmount += 120;
      f.order.chargeLines.push({ code: 'extension:1:rental', type: 'extension', sourceId: 'replacement-extension', amount: 120 });
      finalAt = 11; expected = scenario === 'joint-extension' ? 138.32 : scenario === 'stacked-extension' ? 126.66 : 160;
      const whole = await f.controller.returnCharges('t', f.context, 'o', at(11), {}, undefined, 'whole-preview', true);
      assert.equal(whole.earlyReturn.amount, 60, 'only the independent added period remains at day11');
    }
    f.core.factStore.listAssets = async () => [];
    const current = f.order.allocations.find(row => row.status === 'picked_up');
    const items = [{ allocationId: current.id, quantity: 1 }];
    const ids = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
    f.core.stampPartialReturnReceipts(f.order, items, ids, 'current-cohort-return', at(firstAt));
    const calculate = () => f.controller.returnCharges('t', f.context, 'o', at(finalAt), {}, undefined, 'final-cohort', true);
    assert.equal((await calculate()).earlyReturn.amount, expected, scenario);
    const frozen = clone(f.order);
    const retired = f.order.allocations.find(row => row.status === 'returned' && !row.metadata?.returnReceipt);
    retired.quantity += 1;
    assert.equal((await calculate()).earlyReturn.amount, null, 'a retired flag without matching immutable exchange allocation cannot be excluded');
    Object.assign(f.order, clone(frozen));
    if (scenario.endsWith('extension')) {
      f.extensions[0].effectiveAt = at(7);
      assert.equal((await calculate()).earlyReturn.amount, null, 'an extension after a physical return cannot cover the original full cohort');
    }
  }
});

test('partial exchange returns keep untouched stable lines and their own earlier physical batches', async () => {
  const f = fixture({ quantity: 3 });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.request.lines.push({ itemGroupId: 'c', quantity: 1, pricingUnit: 'day_24h' });
  f.quote.rateSnapshot.push(clone(f.rates[2])); f.quote.rentalLineAmounts.c = 300;
  f.quote.rentalAmount = f.quote.payableAmount = 600;
  f.quote.chargeLines.push({ code: 'rental:C', type: 'rental', amount: 300 });
  f.order.lines.push({ ...clone(f.order.lines[0]), id: 'line-c', itemGroupId: 'c', itemGroupCode: 'C', itemGroupName: 'C', quantity: 1, amount: 300, unitPrice: 300 });
  f.order.payableAmount = f.order.finalPayableAmount = 600; f.order.chargeLines = clone(f.quote.chargeLines);
  f.order.allocations.push({ id: 'allocation-c', orderId: 'o', orderLineId: 'line-c', itemGroupId: 'c', quantity: 1, status: 'picked_up' });
  f.order.reservations.push({ id: 'reservation-c', orderId: 'o', orderLineId: 'line-c', itemGroupId: 'c', locationId: 'loc', status: 'fulfilled', quantity: 1, releasedQuantity: 0 });
  f.core.factStore.listAssets = async () => [];
  const first = [{ allocationId: 'allocation-c', quantity: 1 }];
  const firstIds = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, first, {}, []);
  f.core.stampPartialReturnReceipts(f.order, first, firstIds, 'untouched-c-return', at(2));
  await f.apply(at(5));
  const current = f.order.allocations.find(row => row.status === 'picked_up');
  const second = [{ allocationId: current.id, quantity: 1 }];
  const secondIds = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, second, {}, []);
  f.core.stampPartialReturnReceipts(f.order, second, secondIds, 'replacement-b-return', at(6));
  const calculate = () => f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'last-return', true);
  assert.equal((await calculate()).earlyReturn.amount, 400, 'untouched C refunds240 at day2; exchanged A/B cohort refunds160, without using the final time for C');
  f.order.ruleSnapshot.earlyReturn.maxRefundAmount = 350;
  assert.equal((await calculate()).earlyReturn.amount, 350, 'one whole-order cap, not one cap per stable line');
  delete f.order.ruleSnapshot.earlyReturn.maxRefundAmount;
  delete f.order.allocations.find(row => row.id === 'allocation-c').metadata.returnReceipt;
  assert.equal((await calculate()).earlyReturn.amount, null, 'the other stable line still needs its own original batch time');
});

test('partial exchange refund requires the original negative difference review and booked reduction', async () => {
  const f = fixture({ quantity: 3, next: 5 });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  await f.apply(at(5)); assert.equal(f.changes[0].refundAmount, 75);
  f.core.factStore.listAssets = async () => [];
  const current = f.order.allocations.find(row => row.status === 'picked_up'), items = [{ allocationId: current.id, quantity: 1 }];
  const ids = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
  f.core.stampPartialReturnReceipts(f.order, items, ids, 'lower-price-return', at(6));
  const calculate = () => f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'last-lower-price-return', true);
  assert.equal((await calculate()).earlyReturn.amount, null, 'physical return receipts do not approve the original75 theoretical reduction');
  f.order.feeReviews[0].status = 'approved'; f.order.feeReviews[0].decidedAmount = 75;
  assert.equal((await calculate()).earlyReturn.amount, null, 'review approval without actual same-source charge still cannot consume new net');
  f.order.chargeLines.push({ code: `early_return_refund:o:${f.changes[0].id}`, type: 'early_return_refund', amount: -75 });
  f.order.finalPayableAmount = 225; f.order.adjustmentAmount = -75;
  assert.equal((await calculate()).earlyReturn.amount, 40, 'booked replacement net gives20+10+10');
});

test('converted-hour exchange partial returns use frozen purchased coverage rather than nominal hourly units', async () => {
  const f = fixture({ unit: 'hour', days: 1, quantity: 3 });
  f.quote.ruleSnapshot.pricing = { hourToDayEnabled: true, hourToDayThresholdHours: 6 };
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.pricingContext.dayRates = [{ ...clone(f.rates[0]), unit: 'day_24h', baseAmount: 100 }];
  f.rates.push({ ...clone(f.rates[1]), unit: 'day_24h', baseAmount: 150 });
  f.quote.rentalAmount = f.quote.payableAmount = f.quote.chargeLines[0].amount = f.quote.rentalLineAmounts.a = 300;
  f.order.lines[0].amount = f.order.payableAmount = f.order.finalPayableAmount = 300; f.order.chargeLines = clone(f.quote.chargeLines);
  await f.apply(at(0.5));
  const segment = f.changes[0].diff.exchange.executionBasis.linePricing.segments.at(-1);
  assert.equal(segment.billableUnits, 12); assert.equal(segment.billedHours, 24);
  assert.equal((await f.controller.returnCharges('t', f.context, 'o', at(0.5 + 2 / 24), {}, undefined, 'whole-converted-return', true)).earlyReturn.amount, 412.5,
    'the same frozen coverage applies before any partial return as well');
  f.core.factStore.listAssets = async () => [];
  const current = f.order.allocations.find(row => row.status === 'picked_up'), items = [{ allocationId: current.id, quantity: 1 }];
  const ids = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
  f.core.stampPartialReturnReceipts(f.order, items, ids, 'converted-exchange-return', at(0.5 + 2 / 24));
  const calculate = () => f.controller.returnCharges('t', f.context, 'o', at(1), {}, undefined, 'last-converted-exchange', true);
  assert.equal((await calculate()).earlyReturn.amount, 137.5, 'new150 unused22 of original24 purchased hours');
  f.order.allocations.find(row => row.metadata?.returnReceipt).metadata.returnReceipt.returnedAt = at(0.5 + 8 / 24);
  assert.equal((await calculate()).earlyReturn.amount, 0, 'eight actual hours cross the original6-hour threshold and consume the purchased day');
});

test('exchange early return requires original positive change and extension charge receipts', async () => {
  const f = fixture({ next: 40 });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  await f.apply(at(5));
  assert.equal(f.order.finalPayableAmount, 250);
  const calculate = () => f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'return', true);
  assert.equal((await calculate()).earlyReturn.amount, 80);
  const original = clone(f.order.chargeLines);
  f.order.chargeLines = f.order.chargeLines.filter(row => row.code !== `exchange:${f.changes[0].id}`);
  f.order.finalPayableAmount = 100; f.order.adjustmentAmount = 0;
  assert.equal((await calculate()).earlyReturn.amount, null, 'gross receipt cannot replace a missing positive charge');
  f.order.chargeLines = original; f.order.finalPayableAmount = 250; f.order.adjustmentAmount = 150;
  const charge = f.order.chargeLines.find(row => row.code === `exchange:${f.changes[0].id}`);
  charge.amount = 149;
  assert.equal((await calculate()).earlyReturn.amount, null, 'wrong original charge cannot authorize gross-segment refund');
  charge.amount = 150; f.order.chargeLines.push(clone(charge));
  assert.equal((await calculate()).earlyReturn.amount, null, 'duplicate original charge must not be counted twice');
});

test('partial prior return cannot apply the last return time to every original item', async () => {
  const f = fixture();
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  const other = { ...clone(f.order.lines[0]), id: 'other', itemGroupId: 'c', itemGroupCode: 'C', itemGroupName: 'C', amount: 300, unitPrice: 300 };
  f.order.lines.push(other); f.quote.request.lines.push({ itemGroupId: 'c', quantity: 1, pricingUnit: 'day_24h' });
  f.quote.rateSnapshot.push(clone(f.rates[2])); f.quote.rentalLineAmounts.c = 300; f.quote.rentalAmount = f.quote.payableAmount = 400;
  f.order.payableAmount = f.order.finalPayableAmount = 400;
  f.order.allocations.push({ id: 'other-allocation', orderId: 'o', orderLineId: 'other', itemGroupId: 'c', quantity: 1, status: 'picked_up' });
  f.order.allocations[0].status = 'returned';
  const result = await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'final-return', true);
  assert.equal(result.earlyReturn.amount, null, 'earlier return batch has no timestamp in the last batch');
  assert.equal(result.earlyReturn.requiresReview, true);
  assert.equal(result.earlyReturn.maximumAmount, 400);
  assert.match(result.earlyReturn.basis.join(';'), /分批|数量/);
  f.quote.ruleSnapshot.earlyReturn.mode = 'none';
  assert.equal((await f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'final-return', true)).earlyReturn.amount, 0,
    'explicit no-refund policy stays unchanged');
});

test('original-price exchange early return preserves original plan, coupon and membership net rental', async () => {
  for (const kind of ['plan', 'coupon', 'membership']) {
    const f = fixture();
    f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
    if (kind === 'plan') {
      f.quote.discountAmount = 10;
      f.quote.discountEvaluations = [{ applied: true, appliesTo: 'rental', discountAmount: 10, rentalAllocations: { a: 10 } }];
    } else if (kind === 'coupon') {
      f.quote.couponAmount = 10;
      f.quote.couponEvaluation = { appliesTo: 'rental', discountAmount: 10, rentalAllocations: { a: 10 } };
    } else {
      f.quote.discountAmount = 10;
      f.quote.membershipBenefitEvaluations = [{ appliesTo: 'rental', appliedAmount: 10, allocations: { a: 10 } }];
    }
    f.quote.payableAmount = 90; f.order.payableAmount = f.order.finalPayableAmount = 90;
    f.order.chargeLines.push({ code: kind, type: kind === 'coupon' ? 'coupon' : 'discount', amount: -10 });
    await f.apply(at(5), 'original_order_price');
    const before = clone(f.quote);
    const calculate = point => f.controller.returnCharges('t', f.context, 'o', point, {}, undefined, 'return', true);
    assert.equal((await calculate(at(8))).earlyReturn.amount, 18, 'two unused original days from net 90, not gross 100');
    await f.apply(at(7), 'original_order_price', 'c');
    assert.equal((await calculate(at(8))).earlyReturn.amount, 18, 'another original-price exchange cannot restart discount allocation');
    const actual = f.order.allocations.find(row => row.status === 'picked_up');
    actual.quantity = 0;
    await assert.rejects(calculate(at(8)), error => error.status === 409,
      'zero allocation quantity is rejected by the original return scope before refund calculation');
    actual.quantity = 1;
    const saved = clone(f.changes[0]);
    f.changes[0].diff.exchange.executionBasis.priceBasis = 'replacement_current_price';
    assert.equal((await calculate(at(8))).earlyReturn.amount, null, 'current-price history cannot borrow original benefits');
    f.changes[0] = saved;
    f.order.lines[0].amount = 101;
    await assert.rejects(calculate(at(8)), error => error.status === 409, 'overdue also rejects a mismatched gross receipt');
    f.order.lines[0].amount = 100;
    assert.deepEqual(f.quote, before);
  }
});

test('return uses each independent extension original period and current-price receipt instead of averaging the whole rental', async () => {
  const f = fixture();
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
  f.rates[0].baseAmount = 40;
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', name: 'Current', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], quotes: [], calendars: [], ruleVersions: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(12), appliedAt: at(5), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 80);
  const extension = { ...clone(priced), id: 'extension-original', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1, status: 'effective' };
  f.extensions.push(extension); f.order.effectiveEndAt = at(12);
  f.order.adjustmentAmount = 80; f.order.finalPayableAmount = 180;
  f.order.chargeLines.push({ code: 'extension:1:rental', type: 'extension', sourceId: extension.id, amount: 80 });
  f.controller.service.lockOrderForUpdate = async () => clone(f.order);
  const calculate = point => f.controller.returnCharges('t', f.context, 'o', point, {}, undefined, 'final-return', true);
  assert.equal((await calculate(at(11))).earlyReturn.amount, 40, 'one unused purchased extension day at 40');
  assert.equal((await calculate(at(5))).earlyReturn.amount, 130, '50 original unused rental plus all 80 extension rental');
  f.quote.discountEvaluations = [{ applied: true, appliesTo: 'rental', discountAmount: 10, rentalAllocations: { a: 10 } }];
  assert.equal((await calculate(at(5))).earlyReturn.amount, 125, 'original discount applies only to the original period');
  f.quote.discountEvaluations = [];
  f.order.ruleSnapshot.earlyReturn.maxRefundAmount = 60;
  assert.equal((await calculate(at(5))).earlyReturn.amount, 60, 'order refund cap applies once after adding periods');
  for (const mutate of [row => { delete row.executionBasis.incrementalPricing; },
    row => { row.executionBasis.incrementalPricing.lines = null; },
    row => { row.executionBasis.incrementalPricing.lines[0].exchangeId = 'unrelated-exchange'; },
    row => { row.executionBasis.incrementalPricing.lines[0].amount++; },
    row => { row.executionBasis.incrementalPricing.lines[0].billableUnits = 4; row.billableUnits = 4; },
    row => { row.executionBasis.incrementalPricing.lines[0].selectedUnitAmount = 1; },
    row => { row.originalEndAt = at(9); }, row => { row.workspaceId = 'foreign'; },
    row => { row.currency = 'USD'; }]) {
    const invalid = clone(extension); mutate(invalid); f.extensions[0] = invalid;
    const refund = (await calculate(at(11))).earlyReturn;
    assert.equal(refund.amount, null); assert.equal(refund.requiresReview, true);
  }
  f.extensions[0] = extension;
  f.order.chargeLines.find(row => row.sourceId === extension.id).amount = 79;
  assert.equal((await calculate(at(11))).earlyReturn.amount, null, 'original extension amount must match its charge');
  f.order.chargeLines.find(row => row.sourceId === extension.id).amount = 80;
  delete f.order.ruleSnapshot.earlyReturn.maxRefundAmount;
  f.rates[0].baseAmount = 10;
  const second = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: f.extensions, lines: f.order.lines,
    newEndAt: at(14), appliedAt: at(11), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(second.rentalAmount, 20);
  f.extensions.push({ ...clone(second), id: 'extension-second', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 3, status: 'effective' });
  f.order.effectiveEndAt = at(14); f.order.adjustmentAmount = 100; f.order.finalPayableAmount = 200;
  f.order.chargeLines.push({ code: 'extension:3:rental', type: 'extension', sourceId: 'extension-second', amount: 20 });
  assert.equal((await calculate(at(11))).earlyReturn.amount, 60, 'future second period keeps its own 20, first period retains 40');
  assert.equal((await calculate(at(13))).earlyReturn.amount, 10, 'cancelled sequence gap does not break continuous effective periods');
});

test('original-total extension before partial returns consumes the frozen whole-period net and original charge ledger', async () => {
  const f = fixture({ quantity: 3 });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'original_total' };
  f.quote.pricingContext.calendars = [{ tenantId: 't', year: 2026, version: 'original-week-rule', status: 'superseded', days: Array.from({ length: 14 }, (_, index) => ({
    date: at(index).slice(0, 10), dayType: 'workday', source: 'week_rule', pricingMultiplier: 1, closed: false })) }];
  f.business.state = () => ({ calendars: [], discountPlans: [] });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(12), appliedAt: at(1), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 60); assert.equal(priced.pricingSnapshot.recalculatedRentalAmount, 360);
  const extension = { ...clone(priced), id: 'original-total-before-return', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1,
    status: 'effective', effectiveAt: at(1) };
  f.extensions.push(extension); f.order.effectiveEndAt = at(12); f.order.adjustmentAmount = 60; f.order.finalPayableAmount = 360;
  for (const fee of priced.pricingSnapshot.chargeLines.filter(row => row.amount !== 0)) f.order.chargeLines.push({ ...clone(fee),
    code: `extension:1:${fee.code}`, sourceId: extension.id, sourceVersion: priced.priceVersion });
  f.core.factStore.listAssets = async () => [];
  const items = [{ allocationId: 'allocation', quantity: 1 }];
  const ids = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
  f.core.stampPartialReturnReceipts(f.order, items, ids, 'first-whole-period-return', at(2));
  const calculate = point => f.controller.returnCharges('t', f.context, 'o', at(point), {}, undefined, 'final-whole-period-return', true);
  const frozen = clone(f.order), quote = clone(f.quote), receipt = clone(extension);
  assert.equal((await calculate(8)).earlyReturn.amount, 180, 'whole-period120 per piece: first100 and final two40 each, not original+incremental repricing');
  assert.equal((await calculate(12)).earlyReturn.amount, 100, 'on-time last batch retains the original first physical return');
  assert.deepEqual(f.order, frozen); assert.deepEqual(f.quote, quote); assert.deepEqual(extension, receipt);
  f.order.chargeLines.find(row => row.sourceId === extension.id).amount = 59;
  assert.equal((await calculate(8)).earlyReturn.amount, null, 'frozen net cannot replace a missing matching original extension charge');
  Object.assign(f.order, clone(frozen));
  extension.pricingSnapshot.rentalLineAmounts.a = 361;
  assert.equal((await calculate(8)).earlyReturn.amount, null);
  Object.assign(extension, clone(receipt));
  extension.pricingSnapshot.context.calendars = [];
  assert.equal((await calculate(8)).earlyReturn.amount, null, 'already billed calendar cannot be reconstructed from current configuration');
  Object.assign(extension, clone(receipt));
  extension.effectiveAt = at(3);
  assert.equal((await calculate(8)).earlyReturn.amount, null, 'whole-period repricing must predate every actual return batch');
  Object.assign(extension, clone(receipt));
  f.order.ruleSnapshot.earlyReturn.maxRefundAmount = 150;
  assert.equal((await calculate(8)).earlyReturn.amount, 150);
});

test('original-total partial returns keep producer request order when stable lines load in another order', async () => {
  const f = fixture();
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'original_total' };
  f.quote.pricingContext.calendars = [{ tenantId: 't', year: 2026, version: 'original-week-rule', status: 'superseded', days: Array.from({ length: 14 }, (_, index) => ({
    date: at(index).slice(0, 10), dayType: 'workday', source: 'week_rule', pricingMultiplier: 1, closed: false })) }];
  f.quote.request.lines.push({ itemGroupId: 'c', quantity: 1, pricingUnit: 'day_24h' });
  f.quote.rateSnapshot.push(clone(f.rates[2])); f.quote.rentalLineAmounts.c = 300;
  f.quote.rentalAmount = f.quote.payableAmount = 400; f.quote.chargeLines.push({ code: 'rental:C', type: 'rental', amount: 300 });
  f.order.lines.unshift({ ...clone(f.order.lines[0]), id: 'line-c', itemGroupId: 'c', itemGroupCode: 'C', itemGroupName: 'C', amount: 300, unitPrice: 300 });
  f.order.payableAmount = f.order.finalPayableAmount = 400; f.order.chargeLines = clone(f.quote.chargeLines);
  f.order.allocations.push({ id: 'allocation-c', orderId: 'o', orderLineId: 'line-c', itemGroupId: 'c', quantity: 1, status: 'picked_up' });
  f.order.reservations.push({ id: 'reservation-c', orderId: 'o', orderLineId: 'line-c', itemGroupId: 'c', locationId: 'loc', status: 'fulfilled', quantity: 1, releasedQuantity: 0 });
  f.business.state = () => ({ calendars: [], discountPlans: [] });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(12), appliedAt: at(1), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.deepEqual(priced.pricingSnapshot.fullChargeLines.filter(row => row.type === 'rental').map(row => row.amount), [360, 120]);
  const extension = { ...clone(priced), id: 'reordered-full', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1, status: 'effective', effectiveAt: at(1) };
  f.extensions.push(extension); f.order.effectiveEndAt = at(12); f.order.adjustmentAmount = 80; f.order.finalPayableAmount = 480;
  for (const fee of priced.pricingSnapshot.chargeLines.filter(row => row.amount !== 0)) f.order.chargeLines.push({ ...clone(fee), code: `extension:1:${fee.code}`, sourceId: extension.id, sourceVersion: priced.priceVersion });
  f.core.factStore.listAssets = async () => [];
  const items = [{ allocationId: 'allocation-c', quantity: 1 }];
  const ids = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
  f.core.stampPartialReturnReceipts(f.order, items, ids, 'c-return', at(2));
  const calculate = () => f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'a-final', true);
  assert.equal((await calculate()).earlyReturn.amount, 340, 'original full C360 refunds300 and A120 refunds40 regardless of loading order');
});

test('original-total partial return retains the produced marketing coupon membership net without selecting current plans', async () => {
  const f = fixture({ quantity: 3 }); adoptedMarketingLayers(f);
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'original_total' };
  f.quote.pricingContext.calendars = [{ tenantId: 't', year: 2026, version: 'original-week-rule', status: 'superseded', days: Array.from({ length: 14 }, (_, index) => ({
    date: at(index).slice(0, 10), dayType: 'workday', source: 'week_rule', pricingMultiplier: 1, closed: false })) }];
  f.business.state = () => ({ calendars: [], discountPlans: [] });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(12), appliedAt: at(1), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.pricingSnapshot.recalculatedPayableAmount, 262.44);
  assert.equal(priced.payableAmount, 43.74);
  const extension = { ...clone(priced), id: 'full-net', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1,
    status: 'effective', effectiveAt: at(1) };
  f.extensions.push(extension); f.order.effectiveEndAt = at(12); f.order.adjustmentAmount = 43.74; f.order.finalPayableAmount = 262.44;
  for (const fee of priced.pricingSnapshot.chargeLines.filter(row => row.amount !== 0)) f.order.chargeLines.push({ ...clone(fee),
    code: `extension:1:${fee.code}`, sourceId: extension.id, sourceVersion: priced.priceVersion });
  f.core.factStore.listAssets = async () => [];
  const items = [{ allocationId: 'allocation', quantity: 1 }];
  const ids = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
  f.core.stampPartialReturnReceipts(f.order, items, ids, 'first-net-return', at(2));
  f.business.state = () => { throw new Error('return must not read current plans or calendars'); };
  const calculate = () => f.controller.returnCharges('t', f.context, 'o', at(8), {}, undefined, 'final-net', true);
  assert.equal((await calculate()).earlyReturn.amount, 131.22, 'each produced full-period net87.48 gives72.9+29.16+29.16');
  const receipt = clone(extension);
  extension.pricingSnapshot.discountEvaluations = [];
  assert.equal((await calculate()).earlyReturn.amount, null, 'missing produced marketing reductions cannot be replaced by current configuration');
  Object.assign(extension, clone(receipt));
  delete extension.pricingSnapshot.couponEvaluation;
  assert.equal((await calculate()).earlyReturn.amount, null);
  Object.assign(extension, clone(receipt));
  f.order.ruleSnapshot.earlyReturn.mode = 'manual_review';
  assert.equal((await calculate()).earlyReturn.requiresReview, true);
});

test('original-total partial return does not treat a pending tier reduction as booked net rental', async () => {
  const f = fixture({ quantity: 3, days: 2, tiers: [{ minUnits: 3, unitAmount: 5 }] });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'original_total' };
  f.quote.pricingContext.calendars = [{ tenantId: 't', year: 2026, version: 'original-week-rule', status: 'superseded', days: Array.from({ length: 4 }, (_, index) => ({
    date: at(index).slice(0, 10), dayType: 'workday', source: 'week_rule', pricingMultiplier: 1, closed: false })) }];
  f.business.state = () => ({ calendars: [], discountPlans: [] });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(3), appliedAt: at(0.5), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.pricingSnapshot.differenceAmount, -15);
  const extension = { ...clone(priced), id: 'tier-reduction', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1,
    status: 'effective', effectiveAt: at(0.5) };
  f.extensions.push(extension); f.order.effectiveEndAt = at(3);
  f.core.factStore.listAssets = async () => [];
  const items = [{ allocationId: 'allocation', quantity: 1 }];
  const ids = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
  f.core.stampPartialReturnReceipts(f.order, items, ids, 'first-tier-return', at(1));
  const calculate = () => f.controller.returnCharges('t', f.context, 'o', at(2), {}, undefined, 'last-tier-return', true);
  assert.equal((await calculate()).earlyReturn.amount, null, 'the theoretical45 is not the still-booked60 before original review');
  extension.pricingSnapshot.refundReview = { ...extension.pricingSnapshot.refundReview, status: 'approved', reviewedAt: at(0.75) };
  assert.equal((await calculate()).earlyReturn.amount, null, 'approval label alone does not prove original receivable reduction');
  f.order.adjustmentAmount = -15; f.order.finalPayableAmount = 45;
  f.order.chargeLines.push({ code: 'extension:1:refund', type: 'early_return_refund', amount: -15, sourceId: extension.id, sourceVersion: priced.priceVersion });
  assert.equal((await calculate()).earlyReturn.amount, 20, 'booked original whole-period45 refunds10+5+5, without dropping back to the shorter old tier');
});

test('independent extension before partial returns preserves each original batch net and later purchased period', async () => {
  const f = fixture({ quantity: 3 });
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
  adoptedMarketingLayers(f);
  f.rates[0].baseAmount = 40;
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], quotes: [], calendars: [], ruleVersions: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(12), appliedAt: at(1), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 240);
  const extension = { ...clone(priced), id: 'original-extension', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1,
    status: 'effective', effectiveAt: at(1) };
  f.extensions.push(extension); f.order.effectiveEndAt = at(12); f.order.adjustmentAmount = 240;
  f.order.finalPayableAmount += 240;
  f.order.chargeLines.push({ code: 'extension:1:rental', type: 'extension', sourceId: extension.id, amount: 240 });
  const preReturnOrder = clone(f.order);
  f.order.allocations[0].quantity = 1;
  const returned = point => ({ id: `returned-${point}`, orderId: 'o', orderLineId: 'line', itemGroupId: 'a', quantity: 1,
    status: 'returned', metadata: { returnReceipt: { batchId: `batch-${point}`, returnedAt: at(point),
      sourceAllocationId: 'allocation', orderLineId: 'line', quantity: 1 } } });
  f.order.allocations.push(returned(2), returned(11));
  const calculate = point => f.controller.returnCharges('t', f.context, 'o', at(point), {}, undefined, 'final', true);
  const frozenQuote = clone(f.quote), frozenExtension = clone(extension), frozenOrder = clone(f.order);
  assert.equal((await calculate(12)).earlyReturn.amount, 178.32,
    'original per piece net72.9: first unused8/10=58.32; extension per piece80: first80 + second40 + final0');
  assert.deepEqual(f.quote, frozenQuote); assert.deepEqual(extension, frozenExtension); assert.deepEqual(f.order, frozenOrder);
  assert.equal((await calculate(13)).earlyReturn.amount, 178.32, 'late final piece does not erase the earlier returned pieces refundable original periods');
  const charge = f.order.chargeLines.find(row => row.sourceId === extension.id);
  charge.amount = 239;
  assert.equal((await calculate(12)).earlyReturn.amount, null, 'each original extension still needs its matching original charge');
  charge.amount = 240;
  f.order.ruleSnapshot.earlyReturn.maxRefundAmount = 100;
  assert.equal((await calculate(12)).earlyReturn.amount, 100);
  delete f.order.ruleSnapshot.earlyReturn.maxRefundAmount;
  const original = clone(f.order);
  delete f.order.allocations[1].metadata.returnReceipt;
  assert.equal((await calculate(12)).earlyReturn.amount, null);
  Object.assign(f.order, clone(original));
  delete extension.effectiveAt;
  assert.equal((await calculate(12)).earlyReturn.amount, null, 'missing effective timestamp cannot prove extension preceded the first physical return');
  extension.effectiveAt = at(3);
  assert.equal((await calculate(12)).earlyReturn.amount, null, 'a later extension cannot charge an already returned item');
  extension.effectiveAt = at(1);
  f.order.ruleSnapshot.earlyReturn.minAdvanceHours = 48;
  assert.equal((await calculate(12)).earlyReturn.amount, 138.32, 'first batch qualifies, day11 return is below the final deadline advance threshold');
  f.order.ruleSnapshot.earlyReturn.minAdvanceHours = 0;
  const previousAmount = f.order.finalPayableAmount;
  const second = await f.business.quoteOrderExtension('t', f.context, { order: preReturnOrder, previousExtensions: f.extensions, lines: preReturnOrder.lines,
    newEndAt: at(14), appliedAt: at(1), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(second.rentalAmount, 240);
  f.extensions.push({ ...clone(second), id: 'second-before-returns', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 3,
    status: 'effective', effectiveAt: at(1) });
  f.order.effectiveEndAt = at(14); f.order.finalPayableAmount += 240; f.order.adjustmentAmount += 240;
  f.order.chargeLines.push({ code: 'extension:3:rental', type: 'extension', sourceId: 'second-before-returns', amount: 240 });
  assert.equal((await calculate(14)).earlyReturn.amount, 338.32, 'two continuous purchased periods both predate physical batches; cancelled sequence gaps are not period gaps');
  f.extensions.pop(); f.order.chargeLines.pop(); f.order.effectiveEndAt = at(12); f.order.finalPayableAmount = previousAmount; f.order.adjustmentAmount -= 240;
  f.order.ruleSnapshot.earlyReturn.mode = 'manual_review';
  assert.equal((await calculate(12)).earlyReturn.requiresReview, true);
  f.order.ruleSnapshot.earlyReturn.mode = 'auto';
  Object.assign(f.quote, { rentalAmount: 0.03, rentalLineAmounts: { a: 0.03 }, discountAmount: 0, couponAmount: 0,
    discountEvaluations: [], membershipBenefitEvaluations: [], couponEvaluation: undefined, payableAmount: 0.03 });
  f.quote.chargeLines = [{ type: 'rental', amount: 0.03 }]; f.quote.rateSnapshot[0].baseAmount = 0.001;
  f.order.lines[0].amount = 0.03; f.order.finalPayableAmount = 0.06; f.order.adjustmentAmount = 0.03;
  f.order.chargeLines = [{ type: 'rental', amount: 0.03 }, { code: 'extension:1:rental', type: 'extension', sourceId: extension.id, amount: 0.03 }];
  extension.rentalAmount = extension.payableAmount = 0.03; extension.rateSnapshot[0].baseAmount = 0.005;
  extension.executionBasis.incrementalPricing.lines[0].amount = 0.03;
  extension.executionBasis.incrementalPricing.lines[0].selectedUnitAmount = 0.005;
  assert.equal((await calculate(12)).earlyReturn.amount, 0.02, 'original 0.008 and extension 0.015 combine before the single original fee rounds');
});

test('converted-hour independent extension partial returns retain each frozen purchased coverage', async () => {
  const f = fixture({ unit: 'hour', days: 1, quantity: 3, old: 10, next: 40 });
  f.quote.ruleSnapshot.pricing = { hourToDayEnabled: true, hourToDayThresholdHours: 6 };
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
  f.quote.pricingContext.dayRates = [{ ...clone(f.rates[0]), unit: 'day_24h', baseAmount: 100 }];
  f.quote.rentalAmount = f.quote.payableAmount = f.quote.rentalLineAmounts.a = f.quote.chargeLines[0].amount = 300;
  f.order.lines[0].amount = 300; f.order.lines[0].unitPrice = 100; f.order.payableAmount = f.order.finalPayableAmount = 300;
  f.order.chargeLines = clone(f.quote.chargeLines);
  f.rates[0].baseAmount = 40;
  f.rates.push({ ...clone(f.rates[0]), unit: 'day_24h', baseAmount: 150 });
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], quotes: [], calendars: [], ruleVersions: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(2), appliedAt: at(0.1), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 450);
  const extension = { ...clone(priced), id: 'converted-extension', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1,
    status: 'effective', effectiveAt: at(0.1) };
  f.extensions.push(extension); f.order.effectiveEndAt = at(2); f.order.finalPayableAmount = 750; f.order.adjustmentAmount = 450;
  f.order.chargeLines.push({ code: 'extension:1:rental', type: 'extension', sourceId: extension.id, amount: 450 });
  const wholeReturn = point => f.controller.returnCharges('t', f.context, 'o', at(point), {}, undefined, 'whole-converted', true);
  assert.equal((await wholeReturn(1 + 2 / 24)).earlyReturn.amount, 412.5, 'whole return also consumes22 of24 purchased new hours per piece, without repricing the original day');
  assert.equal((await wholeReturn(1.5)).earlyReturn.amount, 0, 'crossing the original conversion threshold consumes the purchased daily block');
  f.core.factStore.listAssets = async () => [];
  for (const [index, point] of [0.25, 1.5].entries()) {
    const items = [{ allocationId: 'allocation', quantity: 1 }];
    const ids = await f.core.applyPartialReturnItems('t', { itemGroups: f.context.groups }, f.order, items, {}, []);
    f.core.stampPartialReturnReceipts(f.order, items, ids, `converted-batch-${index}`, at(point));
  }
  const calculate = () => f.controller.returnCharges('t', f.context, 'o', at(2), {}, undefined, 'last-converted', true);
  assert.equal((await calculate()).earlyReturn.amount, 225, 'old100 first unused18/24=75 plus first new150; second uses12 hours beyond the frozen6-hour threshold and consumes its whole24-hour block');
  f.order.allocations.find(row => row.metadata?.returnReceipt?.batchId === 'converted-batch-1').metadata.returnReceipt.returnedAt = at(1 + 2 / 24);
  assert.equal((await calculate()).earlyReturn.amount, 362.5, 'second uses only two hours before conversion: new150 retains22/24=137.5; total75+150+137.5');
  const receipt = clone(extension);
  extension.executionBasis.incrementalPricing.lines[0].billedHours = 1;
  assert.equal((await calculate()).earlyReturn.amount, null, 'bad purchased coverage cannot authorize refund');
  Object.assign(extension, clone(receipt));
  extension.executionBasis.incrementalPricing.context.dayRates = [];
  assert.equal((await calculate()).earlyReturn.amount, null, 'missing original conversion price remains unknown');
  Object.assign(extension, clone(receipt));
  f.order.ruleSnapshot.earlyReturn.minAdvanceHours = 24;
  assert.equal((await calculate()).earlyReturn.amount, 225, 'original final deadline threshold applies per physical batch');
});

test('independent extension early return keeps distinct line rates and original membership allocation', async () => {
  const f = fixture();
  f.quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
  f.quote.request.lines.push({ itemGroupId: 'c', quantity: 1, pricingUnit: 'day_24h' });
  f.quote.rateSnapshot.push(clone(f.rates[2])); f.quote.rentalLineAmounts.c = 300;
  f.quote.rentalAmount = 400; f.quote.payableAmount = 380;
  f.quote.membershipBenefitEvaluations = [{ appliesTo: 'rental', appliedAmount: 20, allocations: { a: 20 } }];
  f.quote.chargeLines.push({ code: 'rental:C', type: 'rental', amount: 300 }, { code: 'membership', type: 'discount', amount: -20 });
  f.order.lines.push({ ...clone(f.order.lines[0]), id: 'line-c', itemGroupId: 'c', itemGroupCode: 'C', itemGroupName: 'C', amount: 300, unitPrice: 300 });
  f.order.allocations.push({ id: 'allocation-c', orderId: 'o', orderLineId: 'line-c', itemGroupId: 'c', quantity: 1, status: 'picked_up' });
  f.order.payableAmount = f.order.finalPayableAmount = 380; f.order.chargeLines = clone(f.quote.chargeLines);
  f.rates[0].baseAmount = 40; f.rates[2].baseAmount = 60;
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], quotes: [], calendars: [], ruleVersions: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(12), appliedAt: at(5), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 200);
  f.extensions.push({ ...clone(priced), id: 'extension', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1, status: 'effective' });
  f.order.effectiveEndAt = at(12); f.order.adjustmentAmount = 200; f.order.finalPayableAmount = 580;
  f.order.chargeLines.push({ code: 'extension:1:rental', type: 'extension', sourceId: 'extension', amount: 200 });
  f.controller.service.lockOrderForUpdate = async () => clone(f.order);
  const calculate = point => f.controller.returnCharges('t', f.context, 'o', point, {}, undefined, 'return', true);
  assert.equal((await calculate(at(11))).earlyReturn.amount, 100);
  assert.equal((await calculate(at(5))).earlyReturn.amount, 390, '190 original net plus 200 new rental, without extending old membership discount');
  f.quote.discountAmount = 20;
  f.extensions[0].effectiveAt = at(1);
  const returned = f.order.allocations.find(row => row.orderLineId === 'line-c');
  returned.status = 'returned'; returned.metadata = { returnReceipt: { batchId: 'early-c', returnedAt: at(2),
    sourceAllocationId: returned.id, orderLineId: 'line-c', quantity: 1 } };
  assert.equal((await calculate(at(11))).earlyReturn.amount, 400,
    'C original300 unused8/10=240 plus extension C120; A membership net80 already used, extension A40 unused');
  const before = clone(f.quote);
  delete f.quote.membershipBenefitEvaluations[0].allocations;
  assert.equal((await calculate(at(11))).earlyReturn.amount, null, 'partial extension cannot borrow a missing original line membership allocation');
  Object.assign(f.quote, before);
  const extensionBefore = clone(f.extensions[0]);
  f.extensions[0].effectiveAt = at(3);
  assert.equal((await calculate(at(11))).earlyReturn.amount, null);
  f.extensions[0] = extensionBefore;
});

test('new incremental extension persists its exact billed context through request/payment and later exchange', async () => {
  const f = fixture();
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental', forceImmediateWhenOverdue: true };
  f.rates[0].baseAmount = 40;
  const state = { pricingPlans: [{ id: 'current-plan', code: 'CURRENT', name: 'Current', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], quotes: [], calendars: [], ruleVersions: [] };
  f.business.state = () => state;
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  f.core.state = () => ({ profile: { categoryCode: 'camera', terminology: { pickupLabel: '领取' } }, itemGroups: f.context.groups });
  f.core.assertOrderExtensionAvailable = async () => undefined;
  let fundingChecks = 0;
  f.core.funding = { assertReadyForExtension: async () => { fundingChecks++; } };
  f.core.factStore.listExtensions = async () => clone(f.extensions);
  f.core.factStore.insertExtension = async row => f.extensions.push(clone(row));
  f.core.factStore.markExtensionEffective = async (_tenant, id, effectiveAt, paidAt) => {
    const row = f.extensions.find(item => item.id === id); assert.ok(row); Object.assign(row, { status: 'effective', effectiveAt, paidAt });
  };
  const twoLines = [...f.order.lines, { ...clone(f.order.lines[0]), id: 'line-2' }];
  const multiple = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: twoLines,
    newEndAt: at(12), appliedAt: at(5), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(multiple.rentalAmount, 160); assert.equal(multiple.rateSnapshot.length, 1);
  assert.deepEqual(multiple.executionBasis.incrementalPricing.lines.map(row => row.orderLineId), ['line', 'line-2']);
  require('../apps/api/src/modules/rental-core/rental-exchange-pricing-source').assertIncrementalPricingSnapshot(
    multiple.executionBasis.incrementalPricing, 160, 4, { tenantId: 't', startAt: at(10), endAt: at(12), lines: twoLines, rates: multiple.rateSnapshot });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(12), appliedAt: at(5), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 80); assert.equal(priced.pricingSnapshot, undefined, 'incremental pricing must not enter original-total settlement');
  const saved = clone(priced.executionBasis.incrementalPricing);
  assert.equal(saved.lines[0].orderLineId, 'line'); assert.equal(saved.lines[0].billableUnits, 2); assert.equal(saved.lines[0].billedHours, 48);
  const scoped = work => runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, work);
  const calendar = { tenantId: 't', year: 2026, version: 'calendar-original', days: [] };
  const beforeRequest = clone(f.order);
  for (const mutate of [value => { value.executionBasis.incrementalPricing = null; },
    value => { value.executionBasis.incrementalPricing.lines[0] = null; },
    value => { value.executionBasis.incrementalPricing.lines[0].amount++; },
    value => { value.executionBasis.incrementalPricing.lines[0].billableUnits++; },
    value => { value.executionBasis.incrementalPricing.startAt = at(9); },
    value => { value.executionBasis.incrementalPricing.endAt = at(13); },
    value => { delete value.executionBasis.incrementalPricing.lines[0].orderLineId; },
    value => { value.executionBasis.incrementalPricing.lines[0].orderLineId = 'another-line'; },
    value => { value.executionBasis.incrementalPricing.lines[0].itemGroupId = 'another-group'; },
    value => { value.executionBasis.incrementalPricing.lines[0].quantity++; },
    value => { value.executionBasis.incrementalPricing.context.calendars = [{ ...calendar, tenantId: 'other' }]; },
    value => { value.executionBasis.incrementalPricing.context.timeZone = 'not-a-time-zone'; },
    value => { value.rateSnapshot = []; },
    value => { value.rateSnapshot.push(clone(value.rateSnapshot[0])); },
    value => { value.rateSnapshot[0].unit = 'hour'; },
    value => { value.orderId = 'another-order'; },
    value => { value.pricingSnapshot = {}; }]) {
    const invalid = clone(priced); mutate(invalid);
    await assert.rejects(scoped(() => f.core.requestOrderExtension('t', 'o', invalid,
      { idempotencyKey: 'invalid-source', operator: 'Operator' }, {})), error => error.status === 409);
    assert.equal(f.extensions.length, 0); assert.deepEqual(f.order, beforeRequest); assert.equal(fundingChecks, 0);
  }
  const requested = await scoped(() => f.core.requestOrderExtension('t', 'o', priced, { idempotencyKey: 'extension-original', operator: 'Operator' }, {}));
  assert.equal(requested.extension.status, 'pending_payment'); assert.equal(f.order.effectiveEndAt, undefined);
  assert.deepEqual(f.extensions[0].executionBasis.incrementalPricing, saved);
  const pending = clone(f.extensions[0]);
  for (const mutate of [value => { value.executionBasis.incrementalPricing = null; },
    value => { value.executionBasis.incrementalPricing.lines[0].amount++; },
    value => { value.executionBasis.incrementalPricing.lines[0].orderLineId = 'another-line'; },
    value => { value.executionBasis.incrementalPricing.lines[0].billedHours = 0; },
    value => { value.newEndAt = at(13); },
    value => { value.executionBasis.incrementalPricing.endAt = at(13); },
    value => { value.executionBasis.incrementalPricing.context.calendars = [{ ...calendar, tenantId: 'other' }]; },
    value => { value.workspaceId = 'other'; }, value => { value.orderId = 'other'; },
    value => { value.pricingSnapshot = {}; }]) {
    const invalid = clone(pending); mutate(invalid); f.extensions[0] = invalid;
    await assert.rejects(scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {})), error => error.status === 409);
    assert.equal(f.extensions[0].status, 'pending_payment'); assert.deepEqual(f.order, beforeRequest); assert.equal(fundingChecks, 0);
  }
  f.extensions[0] = { ...clone(pending), newEndAt: pending.originalEndAt };
  await assert.rejects(scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {})), error => error.status === 400);
  assert.equal(f.extensions[0].status, 'pending_payment'); assert.deepEqual(f.order, beforeRequest); assert.equal(fundingChecks, 0);
  f.extensions[0] = pending;
  await scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {}));
  assert.equal(f.order.effectiveEndAt, at(12)); assert.equal(f.order.finalPayableAmount, 180); assert.equal(fundingChecks, 1);
  f.context.settings.calendar.timeZone = 'Asia/Shanghai'; f.rates[0].baseAmount = 999;
  const effective = clone(f.extensions[0]), beforeExchange = clone(f.order);
  // Corrupt the original extension before any exchange/negative review exists:
  // each assertion must reach the receipt gate, not the unrelated refund gate.
  for (const [mutate, message] of [[value => { value.executionBasis.incrementalPricing.lines[0].amount++; }, /逐行金额/],
    [value => { value.executionBasis.incrementalPricing.lines[0] = null; }, /逐行金额/],
    [value => { value.executionBasis.incrementalPricing.lines[0].billableUnits++; }, /逐行金额/],
    [value => { value.executionBasis.incrementalPricing.lines[0].billedHours++; }, /已计单位无法复算/],
    [value => { value.executionBasis.incrementalPricing.lines[0].pricingUnit = 'hour'; }, /唯一稳定行来源/],
    [value => { value.executionBasis.incrementalPricing.context.calendars = [{ ...calendar, tenantId: 'other' }]; }, /本租户计价上下文/],
    [value => { delete value.priceVersion; }, /原价格版本/],
    [value => { value.executionBasis.incrementalPricing.startAt = at(9); }, /本租户计价上下文/],
    [value => { value.executionBasis.incrementalPricing.endAt = at(13); }, /本租户计价上下文/],
    [value => { delete value.executionBasis.incrementalPricing; }, /逐行计价日历/]]) {
    const invalid = clone(effective); mutate(invalid); f.extensions[0] = invalid;
    await assert.rejects(f.quoteExchange(at(11)), message);
    assert.equal(f.changes.length, 0); assert.deepEqual(f.order, beforeExchange);
  }
  f.extensions[0] = effective;
  const changed = await f.apply(at(11));
  assert.equal(changed.originalAmount, 180); assert.equal(changed.replacementAmount, 160);
  assert.deepEqual(changed.priced.linePricing.segments.map(row => row.amount), [100, 40, 20]);
  assert.equal(changed.priced.linePricing.previousSegments[1].context.timeZone, 'UTC');
  assert.equal(changed.priced.linePricing.previousSegments[1].source.id, requested.extension.id);
  assert.equal((await f.overdue()).overdue.amount, 0.83, 'return after the effective extension and exchange uses the last billed 20/24-hour source');
  await assert.rejects(f.quoteExchange(at(11.5), 'replacement_current_price', 'c'), /此前换货负差额尚未完整核减/);
});

test('exchange -> incremental extension -> return -> exchange retains old sources and prices only the new period', async () => {
  const f = fixture({ quantity: 3 });
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental', forceImmediateWhenOverdue: true };
  await f.apply(at(5));
  assert.equal(f.order.finalPayableAmount, 450);
  f.rates[1].baseAmount = 40;
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], services: [], calendars: [], ruleVersions: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  f.core.state = () => ({ profile: { categoryCode: 'camera', terminology: { pickupLabel: '领取' } }, itemGroups: f.context.groups });
  f.core.assertOrderExtensionAvailable = async () => undefined;
  f.core.funding = { assertReadyForExtension: async () => undefined };
  f.core.factStore.listExtensions = async () => clone(f.extensions);
  f.core.factStore.insertExtension = async row => f.extensions.push(clone(row));
  f.core.factStore.markExtensionEffective = async (_tenant, id, effectiveAt, paidAt) => {
    Object.assign(f.extensions.find(row => row.id === id), { status: 'effective', effectiveAt, paidAt });
  };
  const pricing = () => f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: f.extensions,
    previousChanges: f.changes, tx: { original: true }, lines: f.order.lines, newEndAt: at(12), appliedAt: at(7),
    settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  const changeBefore = clone(f.changes[0]);
  const versioned = f.business.resolveSpaceRates;
  f.business.resolveSpaceRates = async () => ({ rates: f.rates });
  await assert.rejects(pricing(), /已发布价格版本/);
  f.business.resolveSpaceRates = versioned;
  f.context.settings.pricing.currency = 'USD';
  await assert.rejects(pricing(), /币种不一致/);
  f.context.settings.pricing.currency = 'CNY';
  f.controller.context = async () => f.context;
  f.controller.service.getOrder = async () => clone(f.order);
  f.controller.service.assertOrderExtensionAvailable = async () => undefined;
  const tx = { original: true };
  const originalLoader = f.business.loadQuote;
  f.business.loadQuote = async (tenant, context, id, receivedTx) => {
    assert.equal(receivedTx, tx, 'Controller must keep original quote reads in its transaction');
    return originalLoader(tenant, context, id, receivedTx);
  };
  const originalRates = f.business.resolveSpaceRates;
  f.business.resolveSpaceRates = async (tenant, context, at, receivedTx) => {
    assert.equal(receivedTx, tx, 'new price-version reads use the same transaction');
    return originalRates(tenant, context, at, receivedTx);
  };
  const { priced } = await f.controller.priceExtension('t', 'o', { newEndAt: at(12) }, tx);
  f.business.loadQuote = originalLoader; f.business.resolveSpaceRates = originalRates;
  assert.equal((await pricing()).rentalAmount, priced.rentalAmount);
  assert.equal(priced.rentalAmount, 240); assert.equal(priced.pricingSnapshot, undefined);
  assert.equal(priced.executionBasis.incrementalPricing.lines[0].itemGroupId, 'b');
  assert.equal(priced.executionBasis.incrementalPricing.lines[0].pricingUnit, 'day_24h');
  assert.equal(priced.executionBasis.incrementalPricing.lines[0].exchangeId, f.changes[0].id);
  const scoped = work => runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, work);
  const oldPriced = clone(priced); delete oldPriced.executionBasis.incrementalPricing;
  await assert.rejects(scoped(() => f.core.requestOrderExtension('t', 'o', oldPriced,
    { idempotencyKey: 'extension-without-source', operator: 'Operator' }, {})), /缺少原稳定行计价收据/);
  assert.equal(f.extensions.length, 0);
  const requested = await scoped(() => f.core.requestOrderExtension('t', 'o', priced,
    { idempotencyKey: 'extension-after-exchange', operator: 'Operator' }, {}));
  assert.equal(f.order.effectiveEndAt, undefined); assert.equal(f.order.finalPayableAmount, 450);
  const pending = clone(f.extensions[0]); delete f.extensions[0].executionBasis.incrementalPricing;
  await assert.rejects(scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {})), /缺少原稳定行计价收据/);
  f.extensions[0] = pending;
  const held = f.order.allocations.at(-1), originalId = held.metadata.exchangeId;
  held.metadata.exchangeId = 'another-confirmed-exchange';
  await assert.rejects(scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {})), /换货来源已变化/);
  assert.equal(f.order.effectiveEndAt, undefined); assert.equal(f.extensions[0].status, 'pending_payment');
  held.metadata.exchangeId = originalId;
  await scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {}));
  assert.equal(f.order.effectiveEndAt, at(12)); assert.equal(f.order.finalPayableAmount, 690);
  assert.equal(f.order.lines[0].amount, 450, 'new extension does not overwrite the prior exchange billed base');
  assert.deepEqual(f.changes[0], changeBefore);
  f.order.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  const originalCharges = clone(f.order.chargeLines);
  f.order.chargeLines = f.order.chargeLines.filter(row => row.sourceId !== requested.extension.id);
  assert.equal((await f.controller.returnCharges('t', f.context, 'o', at(11), tx, undefined, 'early-return', true)).earlyReturn.amount, null,
    'complete extension pricing does not replace its missing booked rental charge');
  f.order.chargeLines = originalCharges;
  const early = await f.controller.returnCharges('t', f.context, 'o', at(11), tx, undefined, 'early-return', true);
  assert.equal(early.earlyReturn.amount, 120, 'three items keep the extension remaining day at 40 each');
  f.rates[1].baseAmount = 999;
  assert.equal((await f.overdue()).overdue.amount, 5);
  assert.equal((await f.overdue([{ allocationId: f.order.allocations.at(-1).id, quantity: 1 }])).overdue.amount, 1.67);
  const receipt = clone(f.extensions[0]);
  for (const mutate of [row => { row.executionBasis.incrementalPricing.lines[0].amount++; },
    row => { row.executionBasis.incrementalPricing.context.timeZone = 'invalid-zone'; },
    row => { row.executionBasis.incrementalPricing.lines[0].exchangeId = 'other'; },
    row => { row.workspaceId = 'other'; }]) {
    f.extensions[0] = clone(receipt); mutate(f.extensions[0]);
    await assert.rejects(f.overdue(), error => error.status === 409);
  }
  f.extensions[0] = receipt;
  const second = await f.apply(at(11), 'replacement_current_price', 'c');
  assert.equal(second.originalAmount, 690); assert.equal(second.replacementAmount, 660);
  assert.equal(second.priced.pricingSnapshot.differenceAmount, -30);
  assert.deepEqual(second.priced.linePricing.segments.map(row => row.amount), [150, 300, 120, 90]);
  assert.equal((await f.overdue()).overdue.amount, 3.75, 'pending reduction does not prevent real return pricing');
});

test('original-price successor preserves adopted benefits and independently purchased extension without granting new discounts', async () => {
  for (const stacked of [false, true]) {
    const f = fixture();
    if (stacked) adoptedStackableMarketingLayers(f); else adoptedMarketingLayers(f);
    f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
    await f.apply(at(5));
    f.rates[1].baseAmount = 40;
    f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '2',
      effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], services: [], calendars: [], ruleVersions: [] });
    f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
    const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, lines: f.order.lines,
      previousChanges: f.changes, previousExtensions: [], newEndAt: at(12), appliedAt: at(7), settlementMode: 'immediate',
      fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
    f.extensions.push({ ...clone(priced), id: 'new-extension', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1,
      status: 'effective', effectiveAt: at(7) });
    f.order.effectiveEndAt = at(12); f.order.finalPayableAmount += 80; f.order.adjustmentAmount += 80;
    f.order.chargeLines.push({ code: 'extension:1:rental', type: 'extension', sourceId: 'new-extension', amount: 80 });
    const net = f.order.finalPayableAmount, original = clone(f.quote), extension = clone(f.extensions[0]);
    const result = await f.apply(at(11), 'original_order_price', 'c');
    assert.equal(result.priced.pricingSnapshot.differenceAmount, 0); assert.equal(f.order.finalPayableAmount, net);
    assert.deepEqual(result.priced.linePricing.segments.slice(-2).map(row => row.amount), [40, 40]);
    for (const segment of result.priced.linePricing.segments.filter(row => row.source.kind === 'extension')) {
      assert.equal(segment.discountBenefit, undefined); assert.equal(segment.discountLayers, undefined);
      assert.equal(segment.couponBenefit, undefined); assert.equal(segment.membershipBenefit, undefined);
    }
    const early = await f.controller.returnCharges('t', f.context, 'o', at(11), {}, undefined, 'whole-return', true);
    assert.equal(early.earlyReturn.amount, 40);
    await f.apply(at(11.5), 'original_order_price', 'b');
    assert.equal(f.order.finalPayableAmount, net); assert.equal((await f.overdue()).overdue.amount, 1.67);
    assert.deepEqual(f.quote, original); assert.deepEqual(f.extensions[0], extension);
    const saved = clone(f.changes), receipt = f.changes[1].diff.exchange.executionBasis.linePricing;
    receipt.previousSegments.at(-1).source.id = 'foreign-extension';
    await assert.rejects(f.quoteExchange(at(11.75), 'original_order_price', 'c'), error => error.status === 409);
    f.changes.splice(0, f.changes.length, ...saved);
    const latest = f.changes.at(-1), review = { id: 'history-review', type: 'early_return_refund', status: 'approved',
      sourceId: latest.id, decidedAmount: latest.refundAmount };
    f.order.feeReviews = [review];
    f.order.chargeLines.push({ code: `early_return_refund:o:${latest.id}`, type: 'early_return_refund', amount: -latest.refundAmount });
    const writes = [], tx = { sameOrder: true };
    f.business.factStore.repriceOrderCoupon = async (_tenant, _order, amount, transaction) => {
      assert.equal(transaction, tx); writes.push(amount);
    };
    await f.business.synchronizeExchangeCoupon('t', f.order, review.id, f.changes, tx, f.extensions);
    assert.deepEqual(writes, [latest.diff.exchange.executionBasis.linePricing.couponPricing.replacementReduction]);
    await assert.rejects(f.business.synchronizeExchangeCoupon('t', f.order, review.id, f.changes, tx), error => error.status === 409);
    f.order.chargeLines.find(row => row.sourceId === 'new-extension').amount = 79;
    await assert.rejects(f.quoteExchange(at(11.75), 'original_order_price', 'c'), error => error.status === 409);
  }
});

test('original-price exchange after incremental extension uses the latest billed overdue source', async () => {
  const f = fixture();
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
  await f.apply(at(5));
  const firstChange = clone(f.changes[0]);
  f.rates[1].baseAmount = 40;
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], services: [], calendars: [], ruleVersions: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, lines: f.order.lines,
    previousChanges: f.changes, previousExtensions: [], newEndAt: at(12), appliedAt: at(7), settlementMode: 'immediate',
    fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 80);
  f.extensions.push({ ...clone(priced), id: 'new-extension', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1, status: 'effective' });
  f.order.effectiveEndAt = at(12); f.order.finalPayableAmount = 230; f.order.adjustmentAmount = 130;
  f.order.chargeLines.push({ code: 'extension:1', name: '已生效续租', type: 'extension', amount: 80 });
  assert.equal((await f.overdue()).overdue.amount, 1.67);
  const result = await f.apply(at(11), 'original_order_price', 'c');
  assert.equal(result.originalAmount, 230); assert.equal(result.replacementAmount, 230);
  assert.equal(result.priced.pricingSnapshot.differenceAmount, 0);
  assert.deepEqual(result.priced.linePricing.segments.map(row => row.amount), [50, 100, 40, 40]);
  assert.equal(result.priced.linePricing.overdueBasis.source.id, 'new-extension');
  assert.equal(result.priced.linePricing.overdueBasis.amount, 80);
  assert.equal(result.priced.linePricing.overdueBasis.billableUnits, 2);
  assert.equal(result.priced.linePricing.overdueBasis.billedHours, 48);
  assert.equal((await f.overdue()).overdue.amount, 1.67, 'same prepaid period/rate after original-price exchange');
  assert.deepEqual(f.changes[0], firstChange);
  f.rates[1].baseAmount = 9999;
  assert.equal((await f.overdue()).overdue.amount, 1.67, 'later current prices cannot change original overdue');
  const again = await f.apply(at(11.5), 'original_order_price', 'b');
  assert.equal(again.priced.pricingSnapshot.differenceAmount, 0);
  assert.equal(again.priced.linePricing.segments.at(-1).amount, 0, 'already purchased units are not billed again');
  assert.equal(again.priced.linePricing.overdueBasis.amount, 80);
  assert.equal(again.priced.linePricing.overdueBasis.billedHours, 48);
  assert.equal((await f.overdue()).overdue.amount, 1.67, 'a later zero tail cannot replace purchased coverage');
});

test('extended hourly return never borrows the earlier exchange daily price when its own source lacks it', async () => {
  const f = fixture({ unit: 'hour', days: 1, old: 10, next: 20 });
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
  f.quote.ruleSnapshot.overdue = { graceMinutes: 0, feeMode: 'hourly_to_daily', hourlyRatePercent: 10, dailyAfterHours: 6, feeMultiplier: 1 };
  f.rates.push({ ...clone(f.rates[1]), unit: 'day_24h', baseAmount: 100 });
  await f.apply(at(0.5));
  const current = { ...clone(f.rates[1]), baseAmount: 5 };
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '3',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: [current] }], services: [], calendars: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  f.business.resolveSpaceRates = async () => ({ versionId: 'new-price', version: '3', rates: [current] });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, lines: f.order.lines,
    previousChanges: f.changes, previousExtensions: [], newEndAt: at(2), appliedAt: at(0.7), settlementMode: 'immediate',
    fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 120);
  f.extensions.push({ ...clone(priced), id: 'new-extension', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1, status: 'effective' });
  f.order.effectiveEndAt = at(2);
  const original = clone(f.extensions[0]);
  await assert.rejects(f.overdue(), /原订单缺少对应日价快照/);
  f.extensions[0].executionBasis.incrementalPricing.context.dayRates.push({ ...clone(current), unit: 'day_24h', baseAmount: 200 });
  assert.equal((await f.overdue()).overdue.amount, 20, 'new extension daily source, not old exchange daily 100');
  assert.deepEqual(original.executionBasis.incrementalPricing.context.dayRates, []);
});

test('incremental receipt binding keeps same-target stable lines and consumed/usage boundaries distinct', () => {
  const { assertIncrementalPricingSnapshot } = require('../apps/api/src/modules/rental-core/rental-exchange-pricing-source');
  const f = fixture(), source = { version: 1, startAt: at(10), endAt: at(12), context: clone(f.quote.pricingContext),
    lines: [{ orderLineId: 'line', itemGroupId: 'a', quantity: 1, pricingUnit: 'day_24h', amount: 20,
      billableUnits: 2, billedHours: 48, selectedUnitAmount: 10 }] };
  const second = { ...clone(f.order.lines[0]), id: 'line-2' }, consumed = { ...clone(second), id: 'consumed', inventoryMode: 'consumable' };
  const binding = { tenantId: 't', startAt: at(10), endAt: at(12), lines: [...f.order.lines, second, consumed], rates: [f.rates[0]] };
  source.lines.push({ ...clone(source.lines[0]), orderLineId: 'line-2' });
  assert.doesNotThrow(() => assertIncrementalPricingSnapshot(source, 40, 4, binding));
  for (const mutate of [value => { value.lines[1].orderLineId = 'line'; },
    value => { value.lines[1].orderLineId = 'consumed'; }, value => { value.lines[1].pricingGroupId = 'other'; }]) {
    const invalid = clone(source); mutate(invalid);
    assert.throws(() => assertIncrementalPricingSnapshot(invalid, 40, 4, binding), error => error.status === 409);
  }
  const usage = { ...clone(source), lines: [{ ...clone(source.lines[0]), pricingUnit: 'usage', billedHours: 0 }] };
  const usageBinding = { ...binding, lines: f.order.lines, rates: [{ ...f.rates[0], unit: 'usage' }] };
  assert.doesNotThrow(() => assertIncrementalPricingSnapshot(usage, 20, 2, usageBinding), 'usage has no invented time denominator');
  usage.lines[0].billedHours = 48;
  assert.throws(() => assertIncrementalPricingSnapshot(usage, 20, 2, usageBinding), error => error.status === 409);
});

test('exchange into another original target retains the other stable line original source', async () => {
  const f = fixture();
  f.quote.request.lines.push({ itemGroupId: 'c', quantity: 1, pricingUnit: 'day_24h' });
  f.quote.rateSnapshot.push(clone(f.rates[2]));
  f.quote.chargeLines.push({ code: 'rental:C', name: 'C rental', type: 'rental', amount: 300 });
  f.quote.rentalAmount = 400; f.quote.rentalLineAmounts.c = 300; f.quote.payableAmount = 400;
  const other = { ...clone(f.order.lines[0]), id: 'line-2', itemGroupId: 'c', itemGroupCode: 'C', itemGroupName: 'C', amount: 300, unitPrice: 300 };
  f.order.lines.push(other); f.order.payableAmount = 400; f.order.finalPayableAmount = 400;
  f.order.chargeLines = clone(f.quote.chargeLines);
  await f.apply(at(5), 'replacement_current_price', 'c');
  assert.equal(f.order.lines[0].itemGroupId, 'c');
  const priced = await f.business.quotePostPickupExchange('t', f.context, { order: f.order, previousChanges: f.changes,
    previousExtensions: [], orderLineId: 'line-2', replacementItemGroupId: 'b', priceBasis: 'replacement_current_price',
    appliedAt: at(5), fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal', tx: {} });
  assert.equal(priced.originalAmount, 300); assert.equal(priced.replacementAmount, 250);
  assert.deepEqual(f.order.lines[1], other);
});

test('an unchanged usage-priced other line does not need a time-splittable security source for exchange', async () => {
  const f = fixture();
  f.quote.request.lines.push({ itemGroupId: 'c', quantity: 1, pricingUnit: 'usage' });
  f.quote.rateSnapshot.push({ ...clone(f.rates[2]), unit: 'usage' });
  f.quote.chargeLines.push({ code: 'rental:C', type: 'rental', amount: 30 });
  f.quote.rentalAmount = f.quote.payableAmount = 130; f.quote.rentalLineAmounts.c = 30;
  f.order.lines.push({ ...clone(f.order.lines[0]), id: 'line-2', itemGroupId: 'c', amount: 30 });
  f.order.payableAmount = f.order.finalPayableAmount = 130; f.order.chargeLines = clone(f.quote.chargeLines);
  const result = await f.quoteExchange();
  assert.equal(result.originalAmount, 100); assert.equal(result.replacementAmount, 150);
  assert.equal(result.priced.pricingSnapshot.differenceAmount, 50);
});

test('a second stable line exchange keeps the already replaced other line security rate source', async () => {
  const f = fixture();
  f.quote.request.lines.push({ itemGroupId: 'c', quantity: 1, pricingUnit: 'day_24h' });
  f.quote.rateSnapshot.push(clone(f.rates[2]));
  f.quote.chargeLines.push({ code: 'rental:C', type: 'rental', amount: 300 });
  f.quote.rentalAmount = f.quote.payableAmount = 400; f.quote.rentalLineAmounts.c = 300;
  const other = { ...clone(f.order.lines[0]), id: 'line-2', itemGroupId: 'c', itemGroupCode: 'C', itemGroupName: 'C', amount: 300, unitPrice: 300 };
  f.order.lines.push(other); f.order.payableAmount = f.order.finalPayableAmount = 400;
  f.order.allocations.push({ id: 'allocation-c', orderId: 'o', orderLineId: other.id, itemGroupId: 'c', quantity: 1, status: 'picked_up' });
  f.order.chargeLines = clone(f.quote.chargeLines);
  await f.apply(at(5), 'replacement_current_price', 'b');
  const preserved = clone(f.order.lines[0]);
  const priced = await f.business.quotePostPickupExchange('t', f.context, { order: f.order, previousChanges: f.changes,
    previousExtensions: [], orderLineId: 'line-2', replacementItemGroupId: 'b', priceBasis: 'replacement_current_price',
    appliedAt: at(6), fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal', tx: {} });
  assert.equal(priced.originalAmount, 300); assert.equal(priced.replacementAmount, 260);
  assert.deepEqual(f.order.lines[0], preserved, 'other line uses its original exchange receipt without being repriced');
  const source = f.changes[0].diff.exchange.executionBasis.linePricing;
  const damaged = clone(source); delete f.changes[0].diff.exchange.executionBasis.linePricing;
  await assert.rejects(f.business.quotePostPickupExchange('t', f.context, { order: f.order, previousChanges: f.changes,
    previousExtensions: [], orderLineId: 'line-2', replacementItemGroupId: 'b', priceBasis: 'replacement_current_price',
    appliedAt: at(6), fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal', tx: {} }), /稳定行计价收据/);
  f.changes[0].diff.exchange.executionBasis.linePricing = damaged;
});

test('shared-target quote charges retain each model amount through preparation, exchange and overdue', async () => {
  const f = fixture();
  const group = { id: 'p', code: 'P', name: 'Shared price', memberItemGroupIds: ['a', 'b', 'c'] };
  f.context.pricingGroups = [group];
  const rate = { ...clone(f.rates[0]), pricingGroupId: 'p', pricingGroupCode: 'P' };
  f.quote.rateSnapshot = [clone(rate), clone(rate)];
  f.quote.request.lines = [{ itemGroupId: 'a', pricingGroupId: 'p', quantity: 1, pricingUnit: 'day_24h' },
    { itemGroupId: 'c', pricingGroupId: 'p', quantity: 2, pricingUnit: 'day_24h' }];
  f.quote.chargeLines = [100, 200].map(amount => ({ code: 'rental:RENAMED', name: 'Original model rental', type: 'rental', amount }));
  f.quote.rentalAmount = 300; f.quote.rentalLineAmounts = { p: 300 }; f.quote.payableAmount = 300;
  f.quote.inspectionTemplateSnapshots = []; f.quote.ruleSnapshot.payment.unpaidHoldMinutes = 30;
  const loc = { id: 'loc', name: 'Location', capabilities: ['pickup', 'return'], operatorId: 'op' };
  f.core.state = () => ({ profile: { categoryCode: 'camera' }, itemGroups: f.context.groups, pricingGroups: [group], locations: [loc], operators: [] });
  f.core.availability = async () => ({ available: true });
  f.core.fulfillmentAdmission = async () => ({ locations: [loc], operators: [] });
  f.core.validateFulfillmentSelection = () => ({ fulfillmentLocation: loc, returnLocation: loc });
  f.core.locationSnapshot = () => ({ name: 'Location' });
  const prepared = await runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator' }, () =>
    f.core.prepareOrder('t', { customerName: 'Customer', customerType: 'personal', fulfillmentMode: 'store_pickup_return',
      fulfillmentLocationId: 'loc', startAt: start, endAt: at(10), lines: clone(f.quote.request.lines).reverse() }, 'Operator', f.quote));
  assert.deepEqual(prepared.lines.map(row => [row.itemGroupId, row.amount]), [['c', 200], ['a', 100]]);
  assert.equal(prepared.lines.reduce((sum, row) => sum + row.amount, 0), 300);
  f.order.lines[0] = { ...prepared.lines[1], id: 'line' };
  const other = { ...prepared.lines[0], id: 'line-2' }; f.order.lines.push(other);
  f.order.finalPayableAmount = 300; f.order.payableAmount = 300; f.order.chargeLines = clone(f.quote.chargeLines);
  f.order.allocations.push({ id: 'allocation-2', orderId: 'o', orderLineId: other.id, itemGroupId: 'c', status: 'picked_up', quantity: 2 });
  f.business.resolveSpaceRates = async () => ({ versionId: 'price-next', version: '2', rates: [{ ...rate, baseAmount: 20 }] });
  const originalOther = clone(other);
  f.quote.rateSnapshot[1].baseAmount = 99;
  await assert.rejects(f.quoteExchange(), error => error.status === 409);
  f.quote.rateSnapshot[1].baseAmount = rate.baseAmount;
  const result = await f.apply();
  assert.equal(result.originalAmount, 100); assert.equal(result.replacementAmount, 150);
  assert.equal(result.priced.pricingSnapshot.differenceAmount, 50); assert.equal(f.order.finalPayableAmount, 350);
  assert.deepEqual(f.order.lines[1], originalOther);
  assert.equal((await f.overdue([{ allocationId: f.order.allocations.find(row => row.metadata?.exchangeId && row.status === 'picked_up').id, quantity: 1 }])).overdue.amount, 0.83);
  const missing = clone(f.quote); missing.chargeLines.pop();
  const { quoteRentalLineSource } = require('../apps/api/src/modules/rental-core/rental-quote-line-source');
  assert.throws(() => quoteRentalLineSource(missing, 0), /逐行租金明细不完整/);
});

test('approved negative difference is read from the original review; missing or partial approval cannot be reused', async () => {
  const f = fixture({ next: 5 }); await f.apply();
  assert.equal(f.order.finalPayableAmount, 100); assert.equal(f.changes[0].refundAmount, 25);
  f.order.feeReviews[0].status = 'approved'; f.order.feeReviews[0].decidedAmount = 10;
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /尚未完整核减/);
  f.order.feeReviews[0].decidedAmount = 25;
  f.order.chargeLines.push({ code: `early_return_refund:o:${f.changes[0].id}`, name: '原换货核减', type: 'early_return_refund', amount: -25 });
  f.order.adjustmentAmount = -25; f.order.finalPayableAmount = 75;
  const second = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(second.originalAmount, 75); assert.equal(second.replacementAmount, 150);
  assert.equal(second.priced.pricingSnapshot.differenceAmount, 75); assert.equal(f.order.finalPayableAmount, 150);
});

test('named public schemas keep new billed-period fields optional for historical records and expose original price sources', async () => {
  const { OPENAPI_COMPONENT_SCHEMAS: schemas, API_CONTRACT_OPERATIONS: operations } = require('../apps/api/src/contracts/openapi-document');
  const source = schemas.RentalExchangePricingSegment;
  for (const key of ['orderLineId', 'quantity', 'startAt', 'endAt', 'billableUnits', 'billedHours', 'amount', 'source', 'splitBasis']) {
    assert.ok(source.properties[key], key);
  }
  assert.deepEqual(source.properties.source.properties.kind.enum, ['quote', 'extension', 'price_version']);
  assert.equal(schemas.RentalExchangeExecutionBasis.required.includes('linePricing'), false, 'old read records remain representable');
  assert.equal(schemas.RentalExchangeExecutionBasis.properties.linePricing.properties.overdueBasis.$ref, '#/components/schemas/RentalExchangePricingSegment');
  assert.equal(schemas.RentalExtensionPricingSnapshot.properties.rentalLineAmounts.type, 'object');
  for (const key of ['membershipBenefit', 'membershipSplitBasis', 'couponBenefit', 'couponSplitBasis', 'discountBenefit', 'discountSplitBasis']) {
    assert.ok(source.properties[key], key); assert.equal(source.required.includes(key), false);
  }
  const net = schemas.RentalExchangeExecutionBasis.properties.linePricing;
  assert.equal(net.required.includes('membershipPricing'), false);
  assert.equal(net.properties.membershipPricing.properties.version.enum[0], 1);
  assert.equal(net.required.includes('couponPricing'), false);
  assert.equal(net.properties.couponPricing.properties.version.enum[0], 1);
  assert.equal(net.required.includes('discountPricing'), false);
  assert.equal(net.properties.discountPricing.oneOf[0].properties.version.enum[0], 1);
  assert.equal(net.properties.discountPricing.oneOf[1].properties.version.enum[0], 2);
  assert.equal(net.properties.discountPricing.oneOf[1].properties.evaluations.minItems, 2);
  assert.equal(source.required.includes('discountLayers'), false);
  assert.ok(source.properties.discountLayers.items.properties.splitBasis);
  assert.equal(operations.find(row => row.operationId === 'previewRentalOrderPostPickupExchange').responseSchema, 'RentalPostPickupExchangePreview');
  assert.equal(operations.find(row => row.operationId === 'applyRentalOrderPostPickupExchange').requestSchema, 'RentalPostPickupExchangeApplyRequest');
  assert.ok(schemas.RentalPostPickupExchangePreview.properties.exchange.properties.serviceSnapshots);
  assert.equal(schemas.RentalPostPickupExchangeRequest.properties.services.items.$ref, '#/components/schemas/RentalExchangeServiceSelection');
  assert.ok(schemas.RentalPostPickupExchangeRequest.properties.serviceConfirmationHash);
  assert.equal(operations.find(row => row.operationId === 'rentalOrderExchangeServiceOptions').responseSchema, 'RentalExchangeServiceOptions');
  assert.equal(schemas.RentalExchangeServiceOptions.type, 'array');
  assert.equal(schemas.RentalExchangeServiceOptions.items.$ref, '#/components/schemas/RentalExchangeServiceOption');
  assert.equal(schemas.RentalPostPickupExchangeApplyRequest.allOf[1].properties.replacementPickupInspection.$ref,
    '#/components/schemas/RentalExchangePickupInspectionRequest');
  assert.equal(schemas.RentalPostPickupExchangePreview.properties.exchange.properties.pickupInspection.$ref,
    '#/components/schemas/RentalExchangePickupInspectionRequirements');
  const f = fixture(); f.core.lockOrderForUpdate = async () => clone(f.order);
  f.core.businessConfigStore.readServicesForExchange = async () => [];
  await runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator' }, async () => {
    assert.deepEqual(await f.core.exchangeServiceOptions('t', 'o', {}), []);
    f.core.businessConfigStore.readServicesForExchange = async () => [exchangeOperator];
    assert.deepEqual(await f.core.exchangeServiceOptions('t', 'o', {}), [exchangeOperator]);
  });
  assert.deepEqual(requiredPermissions('GET', '/rental/v1/orders/o/changes/post-pickup-exchange/services'), ['rental-os:order:operate']);
  const { AI_EXTENSION_PREVIEW_HTTP_SCHEMAS } = require('@rental-os/shared');
  const couponSchema = AI_EXTENSION_PREVIEW_HTTP_SCHEMAS.AiExtensionCouponEvaluationDraft;
  assert.equal(couponSchema.properties.applicableItemGroupIds.type, 'array');
  assert.equal(couponSchema.required.includes('applicableItemGroupIds'), false, 'legacy coupon scope remains absent');
  const pricing = AI_EXTENSION_PREVIEW_HTTP_SCHEMAS.AiExtensionPricingSnapshotDraft;
  assert.deepEqual(pricing.properties.scope.enum, ['order', 'exchange_line']);
  assert.equal(pricing.required.includes('scope'), false);
  assert.equal(pricing.properties.rentalLineAmounts.type, 'object');
  assert.equal(pricing.required.includes('rentalLineAmounts'), false, 'historical receipts remain optional, never backfilled');
  const execution = AI_EXTENSION_PREVIEW_HTTP_SCHEMAS.AiExtensionExecutionBasisDraft;
  assert.equal(execution.required.includes('incrementalPricing'), false);
  assert.deepEqual(execution.properties.incrementalPricing.required, ['version', 'startAt', 'endAt', 'context', 'lines']);
  assert.deepEqual(schemas.AiExtensionExecutionBasisDraft, execution, 'OpenAPI uses the original shared closed schema');
});

test('current-price exchange cannot relabel currency and Core rejects unbound currency before resource writes', async () => {
  const changed = fixture(); changed.context.settings.pricing.currency = 'USD';
  await assert.rejects(changed.quoteExchange(), error => error.status === 409 && /币种/.test(error.message));
  const retained = await changed.quoteExchange(at(5), 'original_order_price');
  assert.equal(retained.priced.currency, 'CNY'); assert.equal(retained.replacementAmount, 100);
  for (const currency of [undefined, null, '', 'USD', 'XYZ']) {
    const f = fixture(), result = await f.quoteExchange();
    const input = { type: 'post_pickup_exchange', orderLineId: 'line', allocationId: 'allocation', replacementItemGroupId: 'b',
      priceBasis: 'replacement_current_price', originalDisposition: 'return_to_warehouse', reason: 'fault', customerConfirmed: true,
      expectedUpdatedAt: f.order.updatedAt, inspectionSnapshot: { customerConfirmed: true } };
    const basis = await f.business.captureExchangeExecutionBasis('t', f.context, input.priceBasis, at(5), result.priced);
    const preview = { ...result.priced, currency, differenceAmount: result.priced.pricingSnapshot.differenceAmount, exchange: {
      ...input, originalItemGroupId: 'a', originalAmount: result.originalAmount, replacementAmount: result.replacementAmount, executionBasis: basis } };
    let resources = 0;
    f.core.assertOrderQualification = async () => { resources++; };
    const before = clone(f.order);
    await assert.rejects(runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, () =>
      f.core.applyPostPickupExchange('t', 'o', preview, input, 'bad-currency', 'Operator', {})), error => error.status === 409);
    assert.deepEqual(f.order, before); assert.equal(f.changes.length, 0); assert.equal(resources, 0);
  }
});

test('missing/ambiguous original history, unsupported usage, pending reduction and invalid time fail closed', async () => {
  for (const mutate of [f => { f.quote.pricingContext = undefined; }, f => { f.quote.chargeLines[0].amount++; },
    f => { f.quote.request.lines.push(clone(f.quote.request.lines[0])); },
    f => { f.quote.discountEvaluations = [{ applied: true, discountAmount: 10 }]; },
    f => { f.quote.currency = undefined; },
    f => { f.order.lines[0].amount++; },
    f => { f.order.effectiveEndAt = at(12); },
    f => { f.order.allocations[0].metadata = { exchangeId: 'missing' }; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.quoteExchange(), error => error.status === 409);
    assert.equal(f.changes.length, 0); assert.equal(f.order.allocations.length, 1);
  }
  const invalid = fixture();
  for (const point of [at(-1), at(10), at(11), 'bad-time']) await assert.rejects(invalid.quoteExchange(point), /确认必须/);
  const lowered = fixture({ next: 5 }); await lowered.apply();
  await assert.rejects(lowered.quoteExchange(at(7), 'replacement_current_price', 'c'), /尚未完整核减/);
  const missing = fixture(); await missing.apply(); delete missing.changes[0].diff.exchange.executionBasis.linePricing;
  await assert.rejects(missing.quoteExchange(at(7), 'replacement_current_price', 'c'), /稳定行计价收据/);
  const unsupported = fixture(); unsupported.quote.rateSnapshot[0].unit = 'usage'; unsupported.quote.request.lines[0].pricingUnit = 'usage';
  await assert.rejects(unsupported.quoteExchange(), /使用量和包段/);
  const unversioned = fixture(); unversioned.business.resolveSpaceRates = async () => ({ rates: unversioned.rates });
  await assert.rejects(unversioned.quoteExchange(), /已发布价格版本/);
  const oldWhole = fixture();
  await assert.rejects(oldWhole.business.quoteOrderExtension('t', oldWhole.context, { order: oldWhole.order, lines: oldWhole.order.lines,
    newEndAt: oldWhole.order.endAt, mode: 'post_pickup_exchange' }), /稳定行剩余计价入口/);
  const backward = fixture(); await backward.apply();
  await assert.rejects(backward.quoteExchange(at(4), 'replacement_current_price', 'c'), /确认必须/);
  backward.business.state = () => ({ });
  backward.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'original_total' };
  await assert.rejects(backward.business.quoteOrderExtension('t', backward.context, { order: backward.order,
    newEndAt: at(12) }), /换货后全租期重算/);
  await assert.rejects(backward.business.quoteOrderExtension('t', backward.context, { order: backward.order,
    newEndAt: at(12), mode: 'carrier_return_repricing' }), /换货后全租期或承运重算/);
  const damaged = fixture(); await damaged.apply(); damaged.changes[0].diff.exchange.executionBasis.linePricing.overdueBasis.billedHours = -1;
  assert.throws(() => returnPricingSlices('t', 'w', damaged.quote, damaged.order, damaged.changes), /计价段/);
});
