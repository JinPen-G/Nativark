'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/order-facts.cjs');
const { AiOrderReadFactsService } = require('../apps/api/src/modules/ai-native/order-read-facts.service');
const saved = () => ({ id: 'quote-old', tenantId: 'tenant-a', ruleVersion: 'old-rule', pricingPlanVersion: 'old-plan',
  priceVersionId: 'price-old', priceVersion: '2', createdAt: '2026-01-01T00:00:00Z', currency: 'CNY',
  rateSnapshot: [{ id: 'rate-old', itemGroupId: 'item-a', unit: 'day_24h', baseAmount: 123, internal: 'DO_NOT_LEAK' }],
  pricingContext: { timeZone: 'Asia/Shanghai', dayRates: [], calendars: [] },
  ruleSnapshot: { fulfillment: { pickupInspectionRequired: true, returnInspectionRequired: false } }, inspectionTemplateSnapshots: [] });
async function bound(source = async () => ({ status: 'available', quote: saved() })) {
  const h = await setup(); h.state.order.quoteId = 'quote-old'; h.state.order.ruleVersion = 'old-rule'; h.state.order.pricingPlanVersion = 'old-plan';
  return { ...h, reader: new AiOrderReadFactsService(h.core, h.authority, () => new Date('2026-10-07T00:00:00Z'), { read: source }) };
}
test('saved quote history is loaded only by the original order quoteId and scope', async () => {
  const h = await bound(async (scope, quoteId) => {
    assert.equal(scope.workspaceId, 'workspace-a'); assert.equal(quoteId, 'quote-old'); return { status: 'available', quote: saved() };
  });
  const out = await h.reader.readHistoricalBasis();
  assert.equal(out.savedQuote.status, 'available'); assert.equal(out.savedQuote.rates[0].baseAmount, 123);
  assert.equal(out.savedQuote.timeZone, 'Asia/Shanghai'); assert.equal(out.complete, false);
  assert.equal(JSON.stringify(out).includes('DO_NOT_LEAK'), false);
  assert.equal((await h.reader.read()).paymentEvidence, 'not_loaded');
});
test('missing quote link and missing saved quote remain distinct', async () => {
  const h = await bound(async () => ({ status: 'missing' }));
  assert.equal((await h.reader.readHistoricalBasis()).savedQuote.status, 'missing');
  delete h.state.order.quoteId;
  assert.equal((await h.reader.readHistoricalBasis()).savedQuote.status, 'missing_link');
});
for (const patch of [{ id: 'quote-other' }, { tenantId: 'tenant-b' }, { ruleVersion: 'current-rule' },
  { pricingPlanVersion: 'current-plan' }, { currency: 'USD' }, { rateSnapshot: [{ id: 'bad', itemGroupId: 'item-a', unit: 'day_24h', baseAmount: NaN }] }]) {
  test(`mismatched or malformed saved quote is rejected: ${Object.keys(patch)}`, async () => {
    const h = await bound(async () => ({ status: 'available', quote: { ...saved(), ...patch } }));
    await assert.rejects(h.reader.readHistoricalBasis());
  });
}
test('missing saved context or rates is not replaced with current values', async () => {
  const h = await bound(async () => { const q = saved(); delete q.pricingContext; delete q.rateSnapshot; return { status: 'available', quote: q }; });
  const out = await h.reader.readHistoricalBasis();
  assert.equal(out.savedQuote.contextStatus, 'missing'); assert.equal(out.savedQuote.ratesStatus, 'missing');
});
test('revocation while loading historical quote suppresses the entire late history', async () => {
  let h; h = await bound(async () => { h.state.user.permissions = []; return { status: 'available', quote: saved() }; });
  await assert.rejects(h.reader.readHistoricalBasis());
});
test('actual saved quote source uses original Core business store within guarded order scope', async () => {
  const h = await setup('operator', 'tenant_001');
  const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
  const { AiOrderSavedQuoteSource } = require('../apps/api/src/modules/ai-native/tools/order-saved-quote.source');
  const stores = require('./helpers/absorbing-config-store.cjs');
  const business = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), stores.createAbsorbingBusinessFactStore(), stores.createAbsorbingConfigStore());
  // Historical R0 has no current fulfillment/config dependency. Use an explicitly
  // saved leaf, not an R1 quote creation fixture; SQL provenance is tested in MySQL.
  const old = { ...saved(), tenantId: 'tenant_001' };
  // Explicit saved leaf; it validates caller binding, not Prisma/ACL semantics.
  business.factStore.readOrderLinkedQuoteFacts = async (tenant, workspace, orderId, id) => {
    assert.equal(tenant, 'tenant_001'); assert.equal(workspace, 'workspace-a'); assert.equal(orderId, 'order-a');
    return id === old.id ? structuredClone(old) : undefined;
  };
  business.states.clear(); h.core.states.clear();
  business.loadQuote = async () => { throw Error('historical read must not warm state'); };
  h.core.getOrder = async () => { throw Error('historical read must not load aggregate'); };
  Object.assign(h.state.order, { quoteId: old.id, ruleVersion: old.ruleVersion, pricingPlanVersion: old.pricingPlanVersion });
  const source = new AiOrderSavedQuoteSource(business);
  const reader = new AiOrderReadFactsService(h.core, h.authority, undefined, source);
  const result = await reader.readHistoricalBasis();
  assert.equal(result.savedQuote.quoteId, old.id);
  assert.equal(result.savedQuote.rates[0].baseAmount, old.rateSnapshot[0].baseAmount);
  assert.equal(result.savedQuote.timeZone, old.pricingContext.timeZone);
  assert.equal(business.states.size, 0); assert.equal(h.core.states.size, 0);
  await assert.rejects(source.read({ kind: 'workspace', tenantId: 'tenant-b', workspaceId: 'workspace-b' }, old.id, 'order-a'));
  h.state.order.quoteId = 'missing-quote';
  assert.equal((await reader.readHistoricalBasis()).savedQuote.status, 'missing');
});

const calendar = () => ({ date: '2026-01-01', year: 2026, dayType: 'tenant_special', businessStatus: 'limited', source: 'tenant_override',
  calendarVersion: '7', itemGroupId: 'item-a', unitCount: 1, unitAmount: 42, multiplier: 1.5, amount: 63,
  priceAt: '2026-01-01T00:00:00Z', hitLayer: 'periodic', pricingPlanVersion: 'old-plan' });
test('original applied calendar survives quote absence; missing and saved empty remain different and never reprice', async () => {
  const h = await bound(async () => ({ status: 'missing' }));
  h.state.order.calendarFacts = { status: 'available', rows: [calendar()] };
  const source = await h.reader.readHistoricalBasis();
  assert.equal(source.savedQuote.status, 'missing'); assert.deepEqual(source.calendar.rows, [calendar()]);
  h.state.order.calendarFacts = { status: 'available', rows: [] };
  assert.deepEqual((await h.reader.readHistoricalBasis()).calendar, { status: 'available', rows: [] });
  delete h.state.order.calendarFacts;
  assert.deepEqual((await h.reader.readHistoricalBasis()).calendar, { status: 'missing' });
  h.state.order.calendarFacts = { status: 'unavailable' };
  assert.deepEqual((await h.reader.readHistoricalBasis()).calendar, { status: 'unavailable' });
  for (const day of [{ ...calendar(), year: 2025 }, { ...calendar(), date: '2026-02-30' }, { ...calendar(), unitAmount: null }]) {
    h.state.order.calendarFacts = { status: 'available', rows: [day] }; await assert.rejects(h.reader.readHistoricalBasis());
  }
});
test('fee renderer consumes original rate/calendar scalars while published material and source reopening retain old closed history', async () => {
  const h = await bound(); h.state.order.calendarFacts = { status: 'available', rows: [calendar()] };
  h.state.order.inspectionTemplateSnapshots = [{ id: 'template-old', tenantId: 'tenant-a', code: 'saved-return', stage: 'return', version: 'saved-7' }];
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  const { AiOrderExplanationPreparationService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-preparation.service');
  const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
  const { projectOrderExplanationMaterial } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const facts = new AiOrderExplanationFactsService(h.authority, h.reader), service = new AiOrderExplanationPreparationService(h.authority, facts, new AiOrderNextStepsService(h.authority, facts));
  const packet = await service.prepare({ question: 'fees' }), claims = new Map(packet.payload.explanation.claims.map(row => [row.field, row]));
  assert.equal(claims.get('amounts.finalPayable').value, 100, 'calendar amount 63 is not full rental/payable');
  assert.equal(claims.get('history.rates.rate-old.baseAmount').value, 123);
  assert.equal(claims.get('history.calendar.0.amount').value, 63); assert.equal(claims.get('history.calendar.0.hitLayer').value, 'periodic');
  assert.equal(claims.get('history.savedQuote.timeZone').value, 'Asia/Shanghai');
  assert.equal(claims.get('history.templates.template-old.version').value, 'saved-7');
  assert.equal(claims.get('history.templates.template-old.stage').value, 'return');
  assert.ok(packet.payload.explanation.text.includes('未乘商品数量、未封顶'));
  const publicPacket = projectOrderExplanationMaterial(packet);
  assert.equal(publicPacket.payload.facts.history.value.calendar, undefined);
  assert.equal(packet.payload.facts.history.value.calendar.status, 'available', 'projection never mutates frozen original input');
  const shared = require('@rental-os/shared'), contracts = require('./fixtures/ai-native/contract-consumer.cjs');
  const defs = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS')).map(([, schemas]) => schemas));
  const validate = contracts.validatorsFor(shared.AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, defs).AiOrderExplanationMaterialDraft;
  assert.equal(validate(publicPacket), true, JSON.stringify(validate.errors));
  const { observedAt, ...reference } = packet.payload.facts.history.source;
  const reopened = await service.reopenCitation({ question: 'fees', ...reference });
  assert.equal(reopened.status, 'available'); assert.equal(reopened.value.value.calendar, undefined);
  const forged = await service.validateGenerated({ question: 'fees', text: 'Current price is the historical price',
    claims: [{ field: 'history.calendar.0.amount', sourceId: 'order-a', value: 999 }] });
  assert.equal(forged.valid, false); assert.equal(forged.text.value, '');
});

test('named v2 preparation and source reopening consume original history/lifecycle while v1 packets stay closed', async () => {
  const h = await bound(); h.state.order.calendarFacts = { status: 'available', rows: [calendar()] };
  const originalLifecycle = h.facts.readOrderExplanationState;
  h.facts.readOrderExplanationState = async (...args) => ({ ...await originalLifecycle(...args),
    allocations: [{ id: 'returned-old', status: 'returned', quantity: 1 }, { id: 'picked-old', status: 'picked_up', quantity: 1 }] });
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  const { AiOrderExplanationPreparationService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-preparation.service');
  const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
  const { projectOrderExplanationMaterial, projectOrderExplanationMaterialV2 } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const shared = require('@rental-os/shared'), { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const facts = new AiOrderExplanationFactsService(h.authority, h.reader, undefined, undefined, undefined, h.core);
  const service = new AiOrderExplanationPreparationService(h.authority, facts, new AiOrderNextStepsService(h.authority, facts));
  const internal = await service.prepare({ question: 'fees' }), before = requestFingerprint(internal), projected = projectOrderExplanationMaterialV2(internal);
  assert.equal(requestFingerprint(internal), before, 'new publication cannot replace the frozen original input/hash');
  assert.equal(internal.version, 'lane-a-business-content-1'); assert.equal(projectOrderExplanationMaterial(internal).payload.facts.history.value.calendar, undefined);
  assert.equal(projected.version, shared.AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION); assert.ok(Object.isFrozen(projected.payload.facts));
  const defs = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS')).map(([, schemas]) => schemas));
  const validate = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(shared.AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, defs);
  for (const question of ['status', 'fees', 'payments', 'next_steps']) {
    const packet = await service.preparePublicV2({ question });
    assert.equal(validate.AiOrderExplanationMaterialV2(packet), true, JSON.stringify(validate.AiOrderExplanationMaterialV2.errors));
    assert.equal(packet.payloadFingerprint, requestFingerprint(packet.payload)); assert.equal(packet.payload.explanation.executionAllowed, false);
    if (question === 'fees') {
      assert.equal(packet.payload.facts.history.value.calendar.rows[0].amount, 63);
      assert.equal(packet.payload.facts.lifecycle.value.allocations[1].status, 'picked_up');
      for (const reference of [packet.payload.facts.history.source, packet.payload.facts.lifecycle.source]) {
        const { observedAt, ...source } = reference, command = { ...source, question, materialVersion: packet.version };
        const reopened = await service.reopenCitationV2(command);
        assert.equal(validate.AiOrderSourceReadV2(reopened), true, JSON.stringify(validate.AiOrderSourceReadV2.errors));
        assert.equal(reopened.status, 'available'); assert.equal(reopened.value.source.field, reference.field);
        if (reference.field === 'saved_basis') assert.equal(reopened.value.value.calendar.rows[0].amount, 63);
        else assert.equal(reopened.value.value.allocations[0].status, 'returned');
        assert.equal((await service.reopenCitationV2({ ...command, version: 'old' })).status, 'stale');
        await assert.rejects(service.reopenCitationV2({ ...command, actor: { kind: 'user', userId: 'self-authorized' } }));
        await assert.rejects(service.reopenCitationV2({ ...command, scope: { kind: 'workspace', tenantId: 'tenant-b', workspaceId: 'workspace-b' } }));
      }
    }
    if (question === 'payments') assert.deepEqual(packet.payload.facts.fundingLedger, { coverage: 'unavailable' });
  }
  const bad = structuredClone(projected); bad.payload.facts.history.value.calendar.rows[0].unknown = 'must reject';
  assert.equal(validate.AiOrderExplanationMaterialV2(bad), false);
  assert.equal(validate.AiOrderExplanationMaterialDraft(projected), false, 'v2 is never accepted under the old named schema');
  const legacy = projectOrderExplanationMaterial(internal); assert.equal(validate.AiOrderExplanationMaterialV2(legacy), false);
  h.state.member = false;
  await assert.rejects(service.preparePublicV2({ question: 'fees' }));
  const { observedAt, ...reference } = projected.payload.facts.history.source;
  await assert.rejects(service.reopenCitationV2({ ...reference, question: 'fees', materialVersion: projected.version }));
});

test('AIN13 frozen exchange missing applicable basis does not reuse original templates', async () => {
  const h = await bound();
  const originalTemplate = { id: 'template-old', tenantId: 'tenant-a', code: 'original-return', stage: 'return', version: 'saved-7' };
  h.state.order.inspectionTemplateSnapshots = [structuredClone(originalTemplate)];
  const originalLifecycle = h.facts.readOrderExplanationState;
  let change = { id: 'exchange-a', type: 'post_pickup_exchange', status: 'applied',
    requestedAt: '2026-10-07T00:00:00Z', appliedAt: '2026-10-07T00:00:00Z' };
  // Only a saved lifecycle transport leaf is replaced. The real Core order
  // reads and original Guard/ALS remain live; no replacement-basis port is faked.
  h.facts.readOrderExplanationState = async (...args) => ({ ...await originalLifecycle(...args), changes: [structuredClone(change)] });
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  const { AiOrderExplanationPreparationService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-preparation.service');
  const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const facts = new AiOrderExplanationFactsService(h.authority, h.reader, undefined, undefined, undefined, h.core);
  const service = new AiOrderExplanationPreparationService(h.authority, facts, new AiOrderNextStepsService(h.authority, facts));
  const packet = await service.preparePublicV2({ question: 'fees' });
  assert.ok(packet.payload.explanation.text.includes('已记录采用换货，但换货商品的冻结检查模板及资源适用关系未读取'));
  assert.ok(packet.payload.explanation.text.includes('原订单模板引用不能证明换货商品的适用依据'));
  assert.equal(packet.payload.explanation.executionAllowed, false);
  assert.equal(packet.payloadFingerprint, requestFingerprint(packet.payload));
  assert.deepEqual(packet.payload.facts.history.value.inspection.templates, [{ id: 'template-old', code: 'original-return', stage: 'return', version: 'saved-7' }]);
  assert.deepEqual(h.state.order.inspectionTemplateSnapshots, [originalTemplate]);
  const forged = await service.validateGenerated({ question: 'fees', text: 'Use current replacement template; inspection passed',
    claims: [{ field: 'history.templates.template-old.version', sourceId: 'template-old', value: 'current-replacement-version' }] });
  assert.equal(forged.valid, false); assert.equal(forged.text.value, '');
  for (const patch of [{ type: 'partial_line_cancel', status: 'applied' }, { type: 'post_pickup_exchange', status: 'cancelled' }]) {
    change = { ...change, ...patch };
    const other = await service.preparePublicV2({ question: 'fees' });
    assert.equal(other.payload.explanation.text.includes('已记录采用换货，但'), false, 'cancellation or unapplied change is not applied exchange evidence');
  }
});

async function frozenInspectionSetup() {
  const h = await bound();
  const old = { id: 'template-old', tenantId: 'tenant-a', code: 'original-return', stage: 'return', version: 'old-7', enabled: true };
  const replacement = { id: 'template-new', tenantId: 'tenant-a', code: 'replacement-return', stage: 'return', version: 'frozen-2', enabled: true };
  h.state.order.inspectionTemplateSnapshots = [structuredClone(old)];
  const basisInput = { tenantId: 'tenant-a', workspaceId: 'workspace-a', orderId: 'order-a', sourceOrderUpdatedAt: h.state.order.updatedAt,
    originalTemplateRefs: [old], allocations: [
      { id: 'original-resource', orderLineId: 'line-old', itemGroupId: 'item-old', status: 'picked_up', quantity: 1 },
      { id: 'replacement-resource', orderLineId: 'line-new', itemGroupId: 'item-new', status: 'locked', quantity: 1, exchangeId: 'exchange-a' }],
    exchanges: [{ id: 'exchange-a', type: 'post_pickup_exchange', status: 'applied', templateRefs: [replacement] }] };
  let basisReads = 0;
  // Persisted reference transport only; actual Core readOrderInspectionBasis and
  // its single applicability helper run, with the original Auth/Guard/ALS.
  h.facts.readOrderInspectionBasis = async (tenant, workspace, orderId) => {
    assert.equal(tenant, 'tenant-a'); assert.equal(workspace, 'workspace-a'); assert.equal(orderId, 'order-a'); basisReads++;
    return structuredClone(basisInput);
  };
  const lifecycle = h.facts.readOrderExplanationState;
  h.facts.readOrderExplanationState = async (...args) => ({ ...await lifecycle(...args), changes: [{ id: 'exchange-a', type: 'post_pickup_exchange', status: 'applied', requestedAt: '2026-10-07T00:00:00Z' }] });
  h.core.states.clear(); h.core.getOrder = async () => { throw Error('No aggregate fallback'); };
  h.core.listInspectionTemplates = async () => { throw Error('No current-template fallback'); };
  const { AiOrderInspectionFactsService } = require('../apps/api/src/modules/ai-native/tools/order-inspection-facts.service');
  const { AiOrderRouteContextAuthority } = require('../apps/api/src/modules/ai-native/order-route-context.authority');
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  const { AiOrderExplanationPreparationService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-preparation.service');
  const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
  const inspectionAuthority = new AiOrderRouteContextAuthority(h.guard, h.credentials, 'order-a', undefined, 'inspections');
  const inspections = new AiOrderInspectionFactsService(h.core, inspectionAuthority);
  const facts = new AiOrderExplanationFactsService(h.authority, h.reader, undefined, undefined, inspections, h.core);
  const service = new AiOrderExplanationPreparationService(h.authority, facts, new AiOrderNextStepsService(h.authority, facts));
  return { ...h, basisInput, basisReads: () => basisReads, inspections, inspectionAuthority, service };
}

test('AIN13 frozen exchange v2 consumes Core applicability and preserves original wire and source authority', async () => {
  const h = await frozenInspectionSetup(), beforeInput = structuredClone(h.basisInput);
  const shared = require('@rental-os/shared'), { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { projectOrderExplanationMaterial, projectOrderExplanationMaterialV2 } = require('../apps/api/src/modules/ai-native/tools/order-explanation-renderer');
  const defs = Object.assign({}, ...Object.entries(shared).filter(([name]) => name.endsWith('_SCHEMAS')).map(([, schemas]) => schemas));
  const validators = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(shared.AI_BUSINESS_MATERIAL_DRAFT_SCHEMAS, defs);
  for (const question of ['status', 'payments', 'next_steps']) await h.service.preparePublicV2({ question });
  assert.equal(h.basisReads(), 0, 'unselected inspection basis never introduces a Core read');
  const internal = await h.service.prepare({ question: 'fees' }), hashBefore = requestFingerprint(internal);
  const packet = projectOrderExplanationMaterialV2(internal), basis = packet.payload.facts.inspections.value.frozenBasis;
  assert.equal(basis.status, 'available'); assert.equal(basis.value.contractVersion, 'rental-order-inspection-basis-1');
  assert.equal(basis.value.recordResourceCoverage, 'not_projected'); assert.equal(h.basisReads(), 1);
  assert.deepEqual(basis.value.applicableTemplateRefs.map(row => ({ sourceTemplateId: row.sourceTemplateId, version: row.version, allocationIds: row.allocationIds })), [
    { sourceTemplateId: 'template-old', version: 'old-7', allocationIds: ['original-resource'] },
    { sourceTemplateId: 'template-new', version: 'frozen-2', allocationIds: ['replacement-resource'] }]);
  assert.equal(basis.value.applicableTemplateRefs[1].id, 'exchange:replacement-resource:template-new');
  assert.equal(validators.AiOrderExplanationMaterialV2(packet), true, JSON.stringify(validators.AiOrderExplanationMaterialV2.errors));
  const claim = packet.payload.explanation.claims.find(row => row.field === 'inspectionBasis.applicable.1.version');
  assert.deepEqual({ sourceId: claim.sourceId, value: claim.value }, { sourceId: 'template-new', value: 'frozen-2' });
  assert.ok(packet.payload.explanation.text.includes('模板适用关系由原Core决定'));
  assert.equal(packet.payload.explanation.text.includes('已记录采用换货，但换货商品的冻结检查模板及资源适用关系未读取'), false);
  assert.deepEqual(h.basisInput, beforeInput); assert.equal(h.core.states.size, 0); assert.equal(packet.payload.explanation.executionAllowed, false);
  const legacy = projectOrderExplanationMaterial(internal);
  assert.equal(legacy.payload.facts.inspections.value.frozenBasis, undefined);
  assert.equal(validators.AiOrderExplanationMaterialDraft(legacy), true, JSON.stringify(validators.AiOrderExplanationMaterialDraft.errors));
  assert.equal(requestFingerprint(internal), hashBefore, 'v2/v1 publication cannot rewrite frozen original input');
  const { observedAt, ...reference } = packet.payload.facts.inspections.source;
  const command = { ...reference, question: 'fees', materialVersion: packet.version };
  const source = await h.service.reopenCitationV2(command);
  assert.equal(source.status, 'available'); assert.equal(source.value.value.frozenBasis.value.applicableTemplateRefs[1].sourceTemplateId, 'template-new');
  assert.equal(validators.AiOrderSourceReadV2(source), true, JSON.stringify(validators.AiOrderSourceReadV2.errors));
  const oldSource = await h.service.reopenCitation({ ...reference, question: 'fees' });
  assert.equal(oldSource.status, 'available'); assert.equal(oldSource.value.value.frozenBasis, undefined);
  const forged = await h.service.validateGenerated({ question: 'fees', text: 'The new resource passed inspection; use current template',
    claims: [{ field: claim.field, sourceId: basis.value.applicableTemplateRefs[1].id, value: claim.value }] });
  assert.equal(forged.valid, false); assert.equal(forged.text.value, '');
  const oldV2 = structuredClone(packet); delete oldV2.payload.facts.inspections.value.frozenBasis;
  assert.equal(validators.AiOrderExplanationMaterialV2(oldV2), true, 'older v2 packets without optional basis remain structurally readable');
  h.state.member = false; await assert.rejects(h.service.reopenCitationV2(command));
});

test('AIN13 frozen exchange basis rejects corrupt sources and respects missing scopes, bounds and live revocation', async () => {
  const h = await frozenInspectionSetup(), { AiOrderInspectionFactsService } = require('../apps/api/src/modules/ai-native/tools/order-inspection-facts.service');
  const base = await h.inspections.read(), basis = base.frozenBasis.value;
  const core = { readOrderFacts: h.core.readOrderFacts.bind(h.core), readInspectionFactsPage: h.core.readInspectionFactsPage.bind(h.core) };
  const missing = await new AiOrderInspectionFactsService(core, h.inspectionAuthority).read();
  assert.deepEqual(missing.frozenBasis, { status: 'unavailable' });
  const failed = await new AiOrderInspectionFactsService({ ...core, readOrderInspectionBasis: async () => { throw Error('missing frozen source'); } }, h.inspectionAuthority).read();
  assert.deepEqual(failed.frozenBasis, { status: 'unavailable' });
  for (const mutate of [value => { value.orderId = 'foreign-order'; }, value => { value.sourceOrderUpdatedAt = '2025-01-01T00:00:00Z'; },
    value => { value.applicableTemplateRefs[1].sourceTemplateId = 'not-original'; }, value => { value.applicableTemplateRefs[1].allocationIds = ['original-resource']; },
    value => { value.originalTemplateRefs[0].fields = [{ code: 'private-unprojected' }]; }]) {
    const bad = structuredClone(basis); mutate(bad);
    await assert.rejects(new AiOrderInspectionFactsService({ ...core, readOrderInspectionBasis: async () => bad }, h.inspectionAuthority).read());
  }
  const huge = structuredClone(basis); huge.exchanges = Array.from({ length: 50 }, (_, i) => ({ id: `exchange-${i}`, type: 'post_pickup_exchange', status: 'applied',
    templateRefs: Array.from({ length: 50 }, (_, j) => ({ id: `template-${i}-${j}`, tenantId: 'tenant-a', code: 'C'.repeat(191), version: '1', stage: 'return', enabled: true })) }));
  const limited = await new AiOrderInspectionFactsService({ ...core, readOrderInspectionBasis: async () => huge }, h.inspectionAuthority).read();
  assert.deepEqual(limited.frozenBasis, { status: 'unavailable' }, 'no sliced partial snapshot is relabelled available');
  h.basisInput.allocations[1].id = 'A'.repeat(191); h.basisInput.exchanges[0].templateRefs[0].id = 'T'.repeat(191);
  const longAlias = await h.inspections.read();
  assert.ok(longAlias.frozenBasis.value.applicableTemplateRefs[1].id.length > 191);
  assert.equal(longAlias.frozenBasis.value.applicableTemplateRefs[1].sourceTemplateId, 'T'.repeat(191), 'long display IDs never replace the real template FK');
  h.basisInput.allocations = []; h.basisInput.exchanges = [];
  const unscoped = await h.inspections.read(); assert.equal(unscoped.frozenBasis.value.applicableTemplateRefs[0].allocationIds, undefined, 'missing Core restriction is not guessed population');
  h.basisInput.originalTemplateRefs = []; h.state.order.inspectionTemplateSnapshots = []; const empty = await h.inspections.read();
  assert.equal(empty.frozenBasis.status, 'available'); assert.deepEqual(empty.frozenBasis.value.applicableTemplateRefs, [], 'genuine saved empty remains different from missing port');
  const revoked = await frozenInspectionSetup();
  const revokedCore = { readOrderFacts: revoked.core.readOrderFacts.bind(revoked.core), readInspectionFactsPage: revoked.core.readInspectionFactsPage.bind(revoked.core),
    readOrderInspectionBasis: async () => { await Promise.resolve(); revoked.state.member = false; throw Error('late private failure'); } };
  await assert.rejects(new AiOrderInspectionFactsService(revokedCore, revoked.inspectionAuthority).read());
});

test('AIN13 inspection waits reject changed review, customer response and first-page coverage', async () => {
  for (const kind of ['review', 'customer_response', 'removed', 'appeared', 'coverage']) {
    const h = await frozenInspectionSetup(), orderVersion = h.state.order.updatedAt;
    const record = { id: 'inspection-a', tenantId: 'tenant-a', orderId: 'order-a', stage: 'return',
      templateId: 'template-old', templateCode: 'original-return', templateVersion: 'old-7', createdAt: '2026-10-07T00:00:00Z',
      results: { secret: 'private-result' }, attachments: ['private-asset'], operator: 'private-operator',
      exceptions: [{ code: 'damage', description: 'Recorded dispute', reviewStatus: 'pending', customerResponseStatus: 'disputed' }] };
    let rows = kind === 'appeared' ? [] : kind === 'coverage'
      ? Array.from({ length: 50 }, (_, i) => ({ ...structuredClone(record), id: `inspection-${String(i).padStart(3, '0')}` }))
      : [structuredClone(record)];
    h.facts.listInspections = async () => structuredClone(rows);
    const readPage = h.facts.readInspectionFactsPage, readBasis = h.facts.readOrderInspectionBasis;
    let pageReads = 0, changed = false;
    h.facts.readInspectionFactsPage = async (...args) => {
      pageReads++; assert.deepEqual(args.slice(0, 3), ['tenant-a', 'workspace-a', 'order-a']);
      assert.deepEqual(args[3], { limit: 50 }, 'reopen the same first page without cursor chasing');
      return readPage(...args);
    };
    h.facts.readOrderInspectionBasis = async (...args) => {
      const basis = await readBasis(...args);
      if (!changed) {
        changed = true;
        if (kind === 'review') rows[0].exceptions[0].reviewStatus = 'approved';
        if (kind === 'customer_response') rows[0].exceptions[0].customerResponseStatus = 'confirmed';
        if (kind === 'removed') rows = [];
        if (kind === 'appeared') rows.push(structuredClone(record));
        if (kind === 'coverage') rows.push({ ...structuredClone(record), id: 'inspection-z-more' });
      }
      return basis;
    };
    await assert.rejects(h.inspections.read(), error => error.message === 'AI_RESOURCE_UNAVAILABLE', kind);
    assert.equal(changed, true); assert.equal(pageReads, 2, 'the closing actual Core page must be reached');
    assert.equal(h.state.order.updatedAt, orderVersion, 'order revalidation alone cannot attest these record changes');
    // An explicit new read may observe the new stable state; never retry the
    // original read internally or turn a dispute/review into settlement evidence.
    const current = await h.inspections.read(); assert.equal(pageReads, 4);
    assert.equal(current.records.length, Math.min(50, rows.length));
    if (kind === 'review') assert.equal(current.records[0].exceptions[0].reviewStatus, 'approved');
    if (kind === 'customer_response') assert.equal(current.records[0].exceptions[0].customerResponseStatus, 'confirmed');
    assert.equal(current.truncated, kind === 'coverage');
    assert.equal(current.pageCoverage, 'page_not_total'); assert.equal(current.queryPages, 1); assert.equal(current.queryLimit, 50);
    assert.equal(current.frozenBasis.status, 'available'); assert.equal(current.execution, 'not_attempted');
    assert.equal(current.semantics, 'recorded_inspection_and_review_only_not_liability_or_settlement');
    assert.equal(JSON.stringify(current).includes('private-'), false);
  }
  const h = await frozenInspectionSetup(), readPage = h.facts.readInspectionFactsPage; let pageReads = 0;
  h.facts.readInspectionFactsPage = async (...args) => {
    const page = await readPage(...args); if (++pageReads === 2) h.state.member = false; return page;
  };
  await assert.rejects(h.inspections.read(), error => error.message === 'AI_ACCESS_DENIED');
  assert.equal(pageReads, 2, 'closing-page revocation cannot deliver the earlier observation');
});
