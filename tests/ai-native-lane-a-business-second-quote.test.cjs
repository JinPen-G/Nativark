'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { RENTAL_CATEGORY_DEFINITIONS } = require('./fixtures/ai-native/local-shared.cjs');
test('AIN15 configured pricing-group targets use the original booking flow without inventing product-only rates', async () => {
  const h = await setup(), input = structuredClone(h.candidate), untouched = structuredClone(input);
  const store = h.business.configStore, read = store.readQuoteRateTargets.bind(store);
  const group = { ...structuredClone(h.quoteConfiguration.pricingGroups[0]), id: 'synthetic-known-pricing-group',
    name: 'Synthetic known pricing group', status: 'enabled', memberItemGroupIds: [h.group.id] };
  h.quoteConfiguration.pricingGroups = [group];
  let mode = 'grouped', rateReads = 0, stockReads = 0, quoteCalls = 0;
  // Only the existing persisted-target transport fixture varies. The original
  // Core rate reader and original Guards/ALS still resolve scope and version.
  store.readQuoteRateTargets = async (...args) => {
    rateReads++; const rows = await read(...args), selected = rows.filter(row => row.itemGroupId === h.group.id);
    assert.ok(selected.length > 0, 'retain a real original product/unit source');
    const grouped = selected.map(row => ({ ...row, pricingGroupId: group.id }));
    return mode === 'legacy' ? rows : mode === 'both' ? [...rows, ...grouped] : mode === 'missing' ? [] : grouped;
  };
  const stock = h.tools.availability.read.bind(h.tools.availability);
  h.tools.availability.read = async (...args) => { stockReads++; return stock(...args); };
  const create = h.business.createQuote.bind(h.business);
  h.business.createQuote = async (...args) => { quoteCalls++; return create(...args); };
  const grouped = await h.tools.quote.businessPreparation.prepareUnified(input);
  assert.equal(grouped.status, 'unavailable'); assert.equal(grouped.next, 'manual_review');
  assert.equal(grouped.reason, 'pricing_group_booking_requires_original_flow'); assert.equal(grouped.request, undefined);
  assert.deepEqual(grouped.missingFields, ['items.0.pricingUnit']);
  assert.equal(grouped.clarifications[0].reason, 'configured_group_rate_not_product_only_quote');
  assert.equal(grouped.clarifications[0].action, 'use_original_pricing_group_booking_flow');
  assert.equal(grouped.clarifications[0].candidates.length, 0, 'no fake product-only unit or automatically selected group');
  assert.ok(rateReads >= 2); assert.equal(stockReads, 0); assert.equal(quoteCalls, 0);
  assert.deepEqual(grouped.sideEffects, { quoteSaved: false, inventoryReserved: false, orderCreated: false, approvalGranted: false });
  const packet = await h.tools.quote.businessPreparation.prepareInput(input);
  assert.equal(packet.payload.facts.reason, grouped.reason); assert.equal(packet.payload.execution, 'not_attempted');
  assert.equal((await h.tools.quote.previewBusinessSelection({ ...input, selectionRevision: grouped.selectionRevision })).reason, grouped.reason);
  for (const boundary of ['disabled', 'not_member', 'missing']) {
    group.status = boundary === 'disabled' ? 'disabled' : 'enabled';
    group.memberItemGroupIds = boundary === 'not_member' ? [] : [h.group.id]; mode = boundary === 'missing' ? 'missing' : 'grouped';
    const current = await h.tools.quote.candidates.prepare(input);
    assert.equal(current.reason, 'current_product_rates_unavailable', `${boundary}: no evidence this current group rate applies`);
    assert.equal(current.request, undefined);
  }
  group.status = 'enabled'; group.memberItemGroupIds = [h.group.id];
  for (mode of ['legacy', 'both']) {
    const current = await h.tools.quote.candidates.prepare(input);
    assert.equal(current.status, 'needs_confirmation'); assert.equal(current.request.lines[0].itemGroupId, h.group.id);
    assert.equal(current.request.lines[0].pricingGroupId, undefined, 'never replace an original legacy rate by an observed group target');
    assert.equal(current.request.lines[0].pricingUnit, input.items[0].pricingUnit);
  }
  const forged = await h.tools.quote.candidates.prepare({ ...input, items: [{ ...input.items[0], pricingGroupId: group.id }] });
  assert.equal(forged.status, 'missing_input', 'do not widen the original candidate/public contract');
  assert.deepEqual(input, untouched); assert.equal(stockReads, 0); assert.equal(quoteCalls, 0); assert.equal(h.businessFacts.writes.length, 0);
  h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.quote.businessPreparation.prepareUnified(input), error => error.code === 'FORBIDDEN');
});

test('AIN15 repeated resolved product lines preserve intent and require original-form correction before quotation', async () => {
  const { originalQuoteAnswerContract, applyOriginalQuoteAnswers } = require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
  const h = await setup(), duplicate = { ...structuredClone(h.candidate), items: [structuredClone(h.candidate.items[0]), { ...structuredClone(h.candidate.items[0]), quantity: 2 }] };
  const untouched = structuredClone(duplicate), writes = structuredClone(h.businessFacts.writes);
  // Existing stock transport only; the original Core calculates availability
  // and quote amounts, with real Guard/ALS/readers and production composition.
  h.facts.listAssets = async () => Array.from({ length: 5 }, (_, index) => ({ id: `synthetic-duplicate-line-asset-${index}`,
    tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: h.group.id, locationId: h.location.id, status: 'available' }));
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: h.location.id, onHandQuantity: 5, maintenanceQuantity: 0 }];
  let stockReads = 0; const readStock = h.tools.availability.read.bind(h.tools.availability);
  h.tools.availability.read = async (...args) => { stockReads++; return readStock(...args); };
  const quoteRequests = [], create = h.business.createQuote.bind(h.business);
  h.business.createQuote = async (...args) => { quoteRequests.push(structuredClone(args[2])); return create(...args); };
  const blocked = await h.tools.quote.businessPreparation.prepareUnified(duplicate);
  assert.equal(blocked.status, 'unavailable'); assert.equal(blocked.next, 'manual_review');
  assert.equal(blocked.reason, 'duplicate_product_lines_require_original_form'); assert.equal(blocked.request, undefined);
  assert.deepEqual(blocked.missingFields, ['items.1']);
  assert.deepEqual(blocked.clarifications.map(row => ({ field: row.field, action: row.action, candidates: row.candidates })),
    [{ field: 'items.1', action: 'use_original_booking_flow', candidates: [] }]);
  assert.deepEqual(blocked.sideEffects, { quoteSaved: false, inventoryReserved: false, orderCreated: false, approvalGranted: false });
  assert.equal(stockReads, 0); assert.equal(quoteRequests.length, 0); assert.deepEqual(h.businessFacts.writes, writes);
  const asserted = await h.tools.quote.previewBusinessSelection({ ...duplicate, selectionRevision: blocked.selectionRevision });
  assert.equal(asserted.status, 'unavailable'); assert.equal(asserted.reason, blocked.reason); assert.equal(quoteRequests.length, 0);
  const mixed = { ...duplicate, items: [structuredClone(duplicate.items[0]), { ...duplicate.items[1], itemGroupId: h.group.id, productName: 'Ignored untrusted product name' }] };
  const mixedResult = await h.tools.quote.candidates.prepare(mixed);
  assert.equal(mixedResult.status, 'unavailable'); assert.deepEqual(mixedResult.missingFields, ['items.1']);
  const unobserved = await h.tools.quote.candidates.prepare({ ...duplicate, items: duplicate.items.map(row => ({ ...row, productName: 'not an observed product' })) });
  assert.equal(unobserved.status, 'missing_input'); assert.notEqual(unobserved.reason, blocked.reason,
    'equal free-text names cannot prove two resolved products are identical');
  assert.deepEqual(duplicate, untouched, 'never add quantities, drop a repeated row, alter a unit or choose another product');
  // Declared explicit correction from the original human form: one row, quantity
  // three. This is not a candidate-service merge or model-derived replacement.
  let selected = { ...structuredClone(duplicate), items: [{ ...structuredClone(h.candidate.items[0]), quantity: 3 }], selectionRevision: blocked.selectionRevision };
  let prepared = await h.tools.quote.businessPreparation.prepareUnified(selected);
  assert.equal(prepared.status, 'missing_input'); assert.ok(prepared.missingFields.includes('selectionRevision'));
  assert.notEqual(prepared.selectionRevision, blocked.selectionRevision); assert.equal(stockReads, 0); assert.equal(quoteRequests.length, 0);
  for (let round = 0; round < 4 && prepared.status === 'missing_input'; round++) {
    const contract = originalQuoteAnswerContract(selected, prepared, `Reconfirm the original-form correction ${round}`);
    const values = { item_selection: selected.items[0].itemGroupId ?? h.group.id, pricing_unit_selection: selected.items[0].pricingUnit,
      customer_selection: selected.customerId, pickup_location: selected.locationId ?? h.location.id, return_location: selected.returnLocationId,
      fulfillment_selection: selected.fulfillmentMode };
    selected = applyOriginalQuoteAnswers(selected, [{ contract, answers: contract.fields.filter(row => row.required).map(row => {
      assert.ok(row.options?.some(option => option.value === values[row.fieldId]), `re-offer current ${row.fieldId}`);
      return { fieldId: row.fieldId, value: values[row.fieldId] };
    }) }]);
    prepared = await h.tools.quote.businessPreparation.prepareUnified(selected);
  }
  assert.equal(prepared.status, 'ready'); assert.equal(prepared.request.lines.length, 1); assert.equal(prepared.request.lines[0].quantity, 3);
  assert.equal(prepared.request.lines[0].itemGroupId, h.group.id); assert.equal(quoteRequests.length, 0);
  assert.equal(prepared.request.startAt, new Date(untouched.start).toISOString()); assert.equal(prepared.request.endAt, new Date(untouched.end).toISOString());
  const quoted = await h.tools.quote.previewBusinessSelection(selected);
  assert.equal(quoted.status, 'quoted'); assert.equal(quoted.quotePersistence, 'saved'); assert.equal(quoted.confirmationReview.orderApproval, 'not_granted');
  assert.equal(quoteRequests.length, 1); assert.equal(quoteRequests[0].lines.length, 1); assert.equal(quoteRequests[0].lines[0].quantity, 3);
  assert.equal(quoted.quote.lineUnits[0].quantity, 3); assert.deepEqual(duplicate, untouched);
  const afterQuote = structuredClone(h.businessFacts.writes);
  h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.quote.businessPreparation.prepareUnified(duplicate), error => error.code === 'FORBIDDEN');
  assert.equal(quoteRequests.length, 1); assert.deepEqual(h.businessFacts.writes, afterQuote);
});

test('AIN15 fulfillment locations require explicit capability-compatible clarification before original quotation', async () => {
  const { originalQuoteAnswerContract, applyOriginalQuoteAnswers } = require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
  const h = await setup('vehicle'), candidate = structuredClone(h.candidate), untouched = structuredClone(candidate);
  assert.equal(RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === 'vehicle').businessModel.defaults.fulfillment.allowDifferentReturnLocation, true);
  // Only the existing configuration/stock transport fixtures supply these rows.
  // Guards, candidate/business preparation, answer mapping and Core admission run.
  const pickup = structuredClone(h.location); pickup.capabilities = ['pickup'];
  const returns = { ...structuredClone(h.location), id: 'synthetic-return-point', code: 'SYNTHETIC_RETURN', name: 'Synthetic return point', capabilities: ['return'] };
  const storage = { ...structuredClone(h.location), id: 'synthetic-storage-point', code: 'SYNTHETIC_STORAGE', name: 'Synthetic storage point', capabilities: ['storage'] };
  const disabled = { ...structuredClone(returns), id: 'synthetic-disabled-return', code: 'SYNTHETIC_DISABLED', status: 'disabled' };
  h.quoteConfiguration.locations = [pickup, returns, storage, disabled];
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([h.core, h.business], 'tenant_001', 'workspace-a', h.quoteConfiguration);
  h.facts.listAssets = async () => [{ id: 'synthetic-fulfillment-asset', tenantId: 'tenant_001', workspaceId: 'workspace-a', itemGroupId: h.group.id, locationId: pickup.id, status: 'available' }];
  h.facts.listStockBalances = async () => [{ itemGroupId: h.group.id, locationId: pickup.id, onHandQuantity: 3, maintenanceQuantity: 0 }];
  let stockReads = 0; const readStock = h.tools.availability.read.bind(h.tools.availability);
  h.tools.availability.read = async (...args) => { stockReads++; return readStock(...args); };
  const quoteRequests = [], createQuote = h.business.createQuote.bind(h.business);
  h.business.createQuote = async (...args) => { quoteRequests.push(structuredClone(args[2])); return createQuote(...args); };
  const beforeWrites = structuredClone(h.businessFacts.writes);
  const missing = await h.tools.quote.businessPreparation.prepareUnified(candidate);
  assert.equal(missing.status, 'missing_input'); assert.equal(missing.next, 'clarify_input'); assert.equal(missing.request, undefined);
  assert.ok(missing.missingFields.includes('returnLocation'));
  const returnChoice = missing.clarifications.find(row => row.field === 'returnLocation');
  assert.equal(returnChoice.reason, 'return_location_capability_required');
  assert.deepEqual(returnChoice.candidates.map(row => row.id), [returns.id]);
  assert.equal(stockReads, 0, 'a missing necessary return choice cannot advance to availability');
  assert.equal(quoteRequests.length, 0); assert.deepEqual(h.businessFacts.writes, beforeWrites);
  assert.deepEqual(missing.sideEffects, { quoteSaved: false, inventoryReserved: false, orderCreated: false, approvalGranted: false });
  assert.deepEqual(candidate, untouched, 'no automatic return point or pickup replacement');
  const invalidReturn = await h.tools.quote.candidates.prepare({ ...candidate, returnLocationId: storage.id, returnLocationName: returns.name });
  assert.equal(invalidReturn.status, 'missing_input'); assert.equal(invalidReturn.request, undefined);
  assert.ok(invalidReturn.missingFields.includes('returnLocation'));
  assert.deepEqual(invalidReturn.clarifications.find(row => row.field === 'returnLocation').candidates.map(row => row.id), [returns.id]);
  const contract = originalQuoteAnswerContract(candidate, missing, 'Explicitly choose the return point');
  assert.deepEqual(contract.fields.find(row => row.fieldId === 'return_location').options.map(row => row.value), [returns.id]);
  assert.throws(() => applyOriginalQuoteAnswers(candidate, [{ contract, answers: [{ fieldId: 'return_location', value: storage.id }] }]));
  let selected = applyOriginalQuoteAnswers(candidate, [{ contract, answers: [{ fieldId: 'return_location', value: returns.id }] }]);
  let prepared = await h.tools.quote.businessPreparation.prepareUnified(selected);
  assert.equal(prepared.status, 'missing_input'); assert.ok(prepared.missingFields.includes('selectionRevision'));
  assert.notEqual(prepared.selectionRevision, missing.selectionRevision);
  assert.equal(stockReads, 0); assert.equal(quoteRequests.length, 0, 'the changed choice requires a new confirmation before Core');
  for (let round = 0; round < 4 && prepared.status === 'missing_input'; round++) {
    const current = originalQuoteAnswerContract(selected, prepared, `Reconfirm the chosen locations ${round}`);
    const values = { item_selection: selected.items[0].itemGroupId ?? h.group.id, pricing_unit_selection: selected.items[0].pricingUnit,
      customer_selection: selected.customerId, pickup_location: selected.locationId ?? pickup.id, return_location: selected.returnLocationId,
      fulfillment_selection: selected.fulfillmentMode };
    selected = applyOriginalQuoteAnswers(selected, [{ contract: current, answers: current.fields.filter(row => row.required).map(row => {
      assert.ok(row.options?.some(option => option.value === values[row.fieldId]), `current explicit ${row.fieldId} must remain offered`);
      return { fieldId: row.fieldId, value: values[row.fieldId] };
    }) }]);
    prepared = await h.tools.quote.businessPreparation.prepareUnified(selected);
  }
  assert.equal(prepared.status, 'ready'); assert.equal(prepared.request.fulfillmentLocationId, pickup.id);
  assert.equal(prepared.request.returnLocationId, returns.id); assert.equal(prepared.reservation, 'not_reserved');
  assert.equal(quoteRequests.length, 0); assert.deepEqual(h.businessFacts.writes, beforeWrites);
  const quoted = await h.tools.quote.previewBusinessSelection(selected);
  assert.equal(quoted.status, 'quoted'); assert.equal(quoted.quotePersistence, 'saved');
  assert.equal(quoted.confirmationReview.orderApproval, 'not_granted');
  assert.equal(quoteRequests.length, 1); assert.equal(quoteRequests[0].fulfillmentLocationId, pickup.id);
  assert.equal(quoteRequests[0].returnLocationId, returns.id); assert.deepEqual(candidate, untouched);
  const savedQuoteWrites = structuredClone(h.businessFacts.writes);
  // A changed capability invalidates the old revision; it cannot be turned into
  // another confirmed quotation merely because stock remains available.
  returns.capabilities = [];
  const changed = await h.tools.quote.businessPreparation.prepareUnified(selected);
  assert.equal(changed.status, 'missing_input'); assert.equal(changed.request, undefined);
  assert.ok(changed.missingFields.includes('returnLocation')); assert.notEqual(changed.selectionRevision, prepared.selectionRevision);
  assert.equal(changed.clarifications.find(row => row.field === 'returnLocation').candidates.length, 0);
  assert.equal(quoteRequests.length, 1); assert.deepEqual(h.businessFacts.writes, savedQuoteWrites);
  h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.quote.businessPreparation.prepareUnified(selected), error => error.code === 'FORBIDDEN');
  assert.equal(quoteRequests.length, 1);
  for (const [category, mode] of [['camera', 'store_pickup_return'], ['camera', 'delivery'], ['construction', 'onsite_delivery']]) {
    const current = await setup(category), base = structuredClone(current.location);
    const description = await current.tools.quote.businessPreparation.describeInput();
    assert.ok(description.fulfillmentModes.includes(mode));
    const address = { id: 'synthetic-fulfillment-address', revision: 1, recipient: 'Synthetic recipient', phoneMasked: '138****0000',
      countryCode: 'CN', province: 'Synthetic province', city: 'Synthetic city', detail: 'Synthetic detail', isDefault: true, updatedAt: '2026-11-07T00:00:00Z' };
    current.business.listCustomerDeliveryAddresses = async () => [structuredClone(address)];
    const addressInput = description.deliveryDestination === 'customer_address' && ['delivery', 'onsite_delivery'].includes(mode)
      ? { deliveryAddressId: address.id } : {};
    const required = ['delivery', 'onsite_delivery'].includes(mode) ? 'delivery' : 'pickup';
    const unsupported = { ...base, capabilities: [required === 'pickup' ? 'delivery' : 'pickup', 'return'] };
    const supported = { ...structuredClone(base), id: `synthetic-${category}-${required}`, code: 'SYNTHETIC_SUPPORTED', name: 'Synthetic supported location', capabilities: [required, 'return'] };
    const noCapability = { ...structuredClone(base), id: 'synthetic-no-capability', code: 'SYNTHETIC_EMPTY', name: 'Synthetic empty capabilities', capabilities: [] };
    current.quoteConfiguration.locations = [unsupported, supported, noCapability];
    const intent = { ...current.candidate, ...addressInput, fulfillmentMode: mode, locationId: unsupported.id, locationName: supported.name };
    const result = await current.tools.quote.candidates.prepare(intent);
    assert.equal(result.status, 'missing_input'); assert.equal(result.request, undefined); assert.ok(result.missingFields.includes('location'));
    assert.deepEqual(result.clarifications.find(row => row.field === 'location').candidates.map(row => row.id), [supported.id]);
    assert.equal(intent.locationId, unsupported.id, 'an incompatible explicit ID cannot be rescued by a valid name');
    const nameOnly = { ...current.candidate, ...addressInput, fulfillmentMode: mode, locationName: supported.name };
    let valid = await current.tools.quote.candidates.prepare(nameOnly);
    if (valid.status === 'missing_input' && valid.missingFields.includes('selectionRevision')) {
      // This isolated candidate check does not quote. The complete host-answer
      // and changed-revision path is exercised above through the original flow.
      nameOnly.selectionRevision = valid.selectionRevision;
      valid = await current.tools.quote.candidates.prepare(nameOnly);
    }
    assert.equal(valid.status, 'needs_confirmation'); assert.equal(valid.request.fulfillmentLocationId, supported.id);
    assert.equal(valid.request.returnLocationId, undefined, 'keep Core same-point fallback when it really supports return');
    assert.equal(nameOnly.returnLocationId, undefined); assert.equal(current.businessFacts.writes.length, 0);
  }
});

for (const code of ['camera', 'camping', 'vehicle', 'construction']) test(`${code}: current definition drives input options and modified parameters require preparation`, async () => {
  const h = await setup(code), definition = RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === code);
  const description = await h.tools.quote.businessPreparation.describeInput();
  assert.equal(description.categoryCode, code);
  assert.ok(description.pricingUnits.every(unit => definition.businessModel.pricingUnits.includes(unit)));
  h.candidate.fulfillmentMode = description.fulfillmentModes[0];
  const { originalQuoteAnswerContract, applyOriginalQuoteAnswers } = require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
  const incomplete = structuredClone(h.candidate); delete incomplete.items[0].pricingUnit;
  const missing = await h.tools.quote.candidates.prepare(incomplete);
  assert.equal(missing.status, 'missing_input'); assert.ok(missing.missingFields.includes('items.0.pricingUnit'));
  const contract = originalQuoteAnswerContract(incomplete, missing, 'Select the current pricing unit');
  const choice = contract.fields.find(field => field.fieldId === 'pricing_unit_selection');
  assert.ok(choice.options.length > 0 && choice.options.every(row => description.pricingUnits.includes(row.value)));
  const explicit = applyOriginalQuoteAnswers(incomplete, [{ contract, answers: [{ fieldId: choice.fieldId, value: h.candidate.items[0].pricingUnit }] }]);
  // The answered unit changes the candidate fingerprint: the current contract
  // re-offers the current choices until the exact candidate is reconfirmed,
  // and any modified parameter (quantity) reopens the same reconfirmation.
  // Reconfirm answers re-select the candidate's own current values.
  const reconfirmWith = (candidateValue, preparation, key) => {
    const round = originalQuoteAnswerContract(candidateValue, preparation, key);
    return applyOriginalQuoteAnswers(candidateValue, [{ contract: round,
      answers: round.fields.filter(field => field.kind === 'choice').map(field => {
        const current = field.fieldId === 'pricing_unit_selection' ? candidateValue.items[0].pricingUnit
          : field.fieldId === 'item_selection' ? candidateValue.items[0].itemGroupId
          : field.fieldId === 'customer_selection' ? candidateValue.customerId
          : field.fieldId === 'pickup_location' ? candidateValue.locationId : field.options[0].value;
        // The reconfirm contract must re-offer the candidate's own current
        // value ("offer current authorized choices again"); falling back to
        // options[0] would mask a product violation of that contract. Fields
        // the candidate has not resolved yet (e.g. a name-only location) take
        // the first re-offered option as the explicit first selection.
        if (current !== undefined) assert.ok(field.options.some(option => option.value === current),
          `the reconfirm round must re-offer the current ${field.fieldId}`);
        return { fieldId: field.fieldId, value: current !== undefined ? current : field.options[0].value };
      }) }]);
  };
  let candidate = explicit, settled = await h.tools.quote.candidates.prepare(explicit);
  for (let round = 0; round < 4 && settled.status === 'missing_input'; round++) {
    candidate = reconfirmWith(candidate, settled, `Reconfirm the current candidate ${round}`);
    settled = await h.tools.quote.candidates.prepare(candidate);
  }
  assert.equal(settled.status, 'needs_confirmation');
  const modified = { ...candidate, items: [{ ...candidate.items[0], quantity: 2 }] };
  let reopened = await h.tools.quote.candidates.prepare(modified);
  assert.equal(reopened.status, 'missing_input'); assert.ok(reopened.missingFields.includes('selectionRevision'));
  let adjusted = modified;
  for (let round = 0; round < 4 && reopened.status === 'missing_input'; round++) {
    adjusted = reconfirmWith(adjusted, reopened, `Reconfirm the modified candidate ${round}`);
    reopened = await h.tools.quote.candidates.prepare(adjusted);
  }
  const revised = reopened;
  assert.equal(revised.request.lines[0].quantity, 2);
  assert.notDeepEqual(revised.request, settled.request); assert.equal(revised.reservation, 'not_reserved');
  const alternatives = await h.tools.quote.businessPreparation.alternatives({ candidate: h.candidate, limit: 2 });
  assert.equal(alternatives.status, 'candidates_only'); assert.ok(alternatives.rows.length <= 2);
  assert.ok(alternatives.rows.every(row => row.price === 'not_quoted' && row.candidate.id !== h.group.id));
  assert.equal(alternatives.automaticReplacement, false);
  const secondGroup=h.core.listItemGroups('tenant_001').find(row=>row.id!==h.group.id);
  assert.ok(secondGroup);
  const multi={...h.candidate,items:[structuredClone(h.candidate.items[0]),{productName:secondGroup.name,quantity:2}]};
  const unitProbe=await h.tools.quote.candidates.prepare(multi);
  const secondUnits=unitProbe.clarifications.find(row=>row.field==='items.1.pricingUnit').candidates;
  assert.ok(secondUnits.length>0,'use only the original product\'s actual rate-supported units');
  multi.items[1].pricingUnit=secondUnits[0].id;
  const preparedMulti=await h.tools.quote.candidates.prepare(multi);
  assert.equal(preparedMulti.status,'needs_confirmation');assert.equal(preparedMulti.request.lines.length,2);
  const untouched=structuredClone(multi),availability=h.tools.quote.businessPreparation.availability;
  const readAvailability=availability.read,requests=[];
  availability.read=async function(query,...args){requests.push(structuredClone(query));return readAvailability.call(this,query,...args);};
  try{
    const selected=await h.tools.quote.businessPreparation.alternatives({candidate:multi,lineIndex:1,limit:2});
    assert.equal(selected.status,'candidates_only');assert.equal(selected.targetLineIndex,1);assert.equal(selected.originalLineCount,2);
    assert.equal(selected.originalItemGroupId,preparedMulti.request.lines[1].itemGroupId);
    const existingIds=new Set(preparedMulti.request.lines.map(line=>line.itemGroupId));
    const actualPool=h.core.listItemGroups('tenant_001').filter(row=>row.status==='enabled'&&!existingIds.has(row.id));
    assert.equal(selected.rows.length,Math.min(2,actualPool.length),'only actual non-colliding products may be alternatives');
    if(actualPool.length)assert.ok(selected.rows.length>0&&selected.rows.length<=2);
    else{assert.equal(selected.rows.length,0);assert.equal(selected.notQueried,0);}
    assert.equal(requests.length,selected.rows.length);
    for(const [index,row] of selected.rows.entries()){
      assert.equal(preparedMulti.request.lines.some(line=>line.itemGroupId===row.candidate.id),false,'do not collide with any existing line');
      assert.deepEqual(requests[index].lines,[{itemGroupId:preparedMulti.request.lines[0].itemGroupId,quantity:preparedMulti.request.lines[0].quantity},
        {itemGroupId:row.candidate.id,quantity:preparedMulti.request.lines[1].quantity}]);
      assert.equal(requests[index].startAt,preparedMulti.request.startAt);assert.equal(requests[index].endAt,preparedMulti.request.endAt);
      assert.equal(row.price,'not_quoted');assert.equal(row.compatibility,'not_verified');
    }
    assert.equal(selected.automaticReplacement,false);assert.equal(selected.selection,'explicit_reprepare_required');
    const reads=requests.length;
    const noTarget=await h.tools.quote.businessPreparation.alternatives({candidate:multi,limit:2});
    assert.equal(noTarget.status,'unavailable');assert.equal(noTarget.reason,'explicit_line_selection_required');
    for(const lineIndex of [-1,0.5,2])await assert.rejects(h.tools.quote.businessPreparation.alternatives({candidate:multi,lineIndex,limit:2}),
      error=>error.code==='INVALID_REQUEST');
    assert.equal(requests.length,reads,'invalid or absent target never queries another replacement');
    assert.deepEqual(multi,untouched,'read-only alternatives must not replace a persisted or incoming candidate');
    const catalog=h.tools.quote.businessPreparation.sources.catalog,readCatalog=catalog.read;let pageReads=0;
    // Declared changed projection after stock waits. Keep the actual catalog
    // Guard/read intact; this does not edit Core or emulate a configuration save.
    catalog.read=async function(query,...args){
      const page=await readCatalog.call(this,query,...args);
      if(query.limit===100&&!query.itemGroupId&&!query.name&&++pageReads===2){
        const changed=structuredClone(page),changedId=selected.rows[0]?.candidate.id??preparedMulti.request.lines[0].itemGroupId;
        changed.items.find(row=>row.id===changedId).name+=' changed';return changed;
      }
      return page;
    };
    try{await assert.rejects(h.tools.quote.businessPreparation.alternatives({candidate:multi,lineIndex:1,limit:2}),error=>error.code==='CONFIG_INVALID');
      assert.equal(pageReads,2);assert.deepEqual(multi,untouched);}
    finally{catalog.read=readCatalog;}
  }finally{availability.read=readAvailability;}
  h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.quote.businessPreparation.describeInput());
});

test('AIN15 alternative waits reopen original time clarification without old stock or source downgrade', async () => {
  const { AiQuoteCandidatePreparationService } = require('../apps/api/src/modules/ai-native/tools/quote-candidate-preparation.service');
  const { AiQuoteBusinessPreparationService } = require('../apps/api/src/modules/ai-native/tools/quote-business-preparation.service');
  const { originalQuoteAnswerContract, applyOriginalQuoteAnswers } = require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
  for (const code of ['camera', 'camping', 'vehicle', 'construction']) {
    const h = await setup(code), original = h.tools.quote.businessPreparation, originalCandidates = h.tools.quote.candidates;
    const candidate = structuredClone(h.candidate);
    // The common fixture's store-pickup sample is not every category's mode.
    // As in the original category cases, explicitly select only a current
    // authorized mode offered by the actual description, not an invented one.
    const description = await original.describeInput(); assert.ok(description.fulfillmentModes.length);
    candidate.fulfillmentMode = description.fulfillmentModes[0];
    const untouched = structuredClone(candidate);
    const initialAt = Date.parse(candidate.start) - 60000; let at = initialAt;
    // Inject only the existing candidate clock, keeping the actual guarded
    // catalog/member/rate/context/availability ports from the original fixture.
    const candidates = new AiQuoteCandidatePreparationService(originalCandidates.readers, originalCandidates.contexts, () => new Date(at));
    const business = new AiQuoteBusinessPreparationService(candidates, original.availability, original.authority, original.sources);
    const prepared = await candidates.prepare(candidate); assert.equal(prepared.status, 'needs_confirmation',
      JSON.stringify({ code, missingFields: prepared.missingFields, clarifications: prepared.clarifications }));
    const normal = await business.alternatives({ candidate, limit: 1 });
    assert.equal(normal.status, 'candidates_only'); assert.equal(normal.rows.length, 1, `${code} uses a real non-colliding seed candidate`);
    const availability = original.availability, catalog = original.sources.catalog;
    const readStock = availability.read, readCatalog = catalog.read;
    const version = h.quoteConfiguration.settings.configVersion, permissions = [...h.h.identity.user.permissions];
    for (const boundary of ['stock_start', 'stock_end', 'catalog_start', 'catalog_change', 'configuration_change', 'withdrawal']) {
      at = initialAt; let stockReads = 0, fullPages = 0;
      availability.read = async function(query, ...args) {
        stockReads++; const page = await readStock.call(this, query, ...args);
        if (boundary !== 'catalog_start') at = Date.parse(boundary === 'stock_end' ? prepared.request.endAt : prepared.request.startAt);
        if (boundary === 'configuration_change') h.quoteConfiguration.settings.configVersion = 'changed-during-alternative-wait';
        if (boundary === 'withdrawal') h.h.identity.user.permissions = [];
        return page;
      };
      catalog.read = async function(query, ...args) {
        const page = await readCatalog.call(this, query, ...args);
        if (query.limit === 100 && !query.name && !query.itemGroupId && ++fullPages === 2) {
          if (boundary === 'catalog_start') at = Date.parse(prepared.request.startAt);
          if (boundary === 'catalog_change') {
            const changed = structuredClone(page); changed.items.find(row => row.id === normal.rows[0].candidate.id).name += ' changed';
            return changed;
          }
        }
        return page;
      };
      try {
        if (['catalog_change', 'configuration_change', 'withdrawal'].includes(boundary)) {
          await assert.rejects(business.alternatives({ candidate, limit: 1 }), error =>
            error.code === (boundary === 'withdrawal' ? 'FORBIDDEN' : 'CONFIG_INVALID'), `${code}: ${boundary}`);
          if (boundary === 'catalog_change') assert.equal(fullPages, 2, 'source drift must reach the original catalog closing read');
        } else {
          const result = await business.alternatives({ candidate, limit: 1 });
          assert.equal(result.status, 'missing_input', `${code}: ${boundary}`);
          const elapsed = boundary === 'stock_end' ? ['start', 'end'] : ['start'];
          for (const field of elapsed) {
            assert.ok(result.missingFields.includes(field));
            assert.ok(result.clarifications.some(row => row.field === field && row.reason === 'rental_time_elapsed' && row.action === 'supply_absolute_time'));
          }
          for (const field of ['request', 'rows', 'availability', 'automaticReplacement']) assert.equal(result[field], undefined, 'no old stock/candidate material');
          const contract = originalQuoteAnswerContract(candidate, result, 'Choose a new explicit period');
          for (const field of elapsed) assert.ok(contract.fields.some(row => row.fieldId === (field === 'start' ? 'starts_at' : 'ends_at') && row.required));
          const start = new Date(at + 3600000).toISOString(), end = new Date(at + 7200000).toISOString();
          const updated = applyOriginalQuoteAnswers(candidate, [{ contract, answers: contract.fields.map(row => ({
            fieldId: row.fieldId, value: row.fieldId === 'starts_at' ? start : end })) }]);
          availability.read = readStock; catalog.read = readCatalog;
          const renewed = await business.prepareUnified(updated);
          assert.ok(['ready', 'unavailable'].includes(renewed.status));
          assert.equal(renewed.status, renewed.availability.result.available ? 'ready' : 'unavailable');
          assert.equal(renewed.request.startAt, start); assert.notEqual(renewed.request.startAt, prepared.request.startAt);
          assert.equal(renewed.availability.result.startAt, renewed.request.startAt);
          assert.deepEqual(renewed.sideEffects, { quoteSaved: false, inventoryReserved: false, orderCreated: false, approvalGranted: false });
        }
        assert.equal(stockReads, 1, 'no alternative stock retry or automatic quotation after expiry');
        assert.deepEqual(candidate, untouched, 'do not shift or overwrite the original candidate');
      } finally {
        availability.read = readStock; catalog.read = readCatalog;
        h.quoteConfiguration.settings.configVersion = version; h.h.identity.user.permissions = [...permissions];
      }
    }
  }
});

test('AIN15 preparation configuration and rate leaves retain the original principal despite restored outer actor', async () => {
  for (const kind of ['configuration', 'rates']) {
    const operations = kind === 'configuration'
      ? ['describeInput', 'prepareUnified', 'inputSources', 'alternatives', 'reviewAnsweredParameters']
      : ['prepareUnified', 'inputSources', 'alternatives', 'reviewAnsweredParameters'];
    for (const operation of operations) {
      const h = await setup(), preparation = h.tools.quote.businessPreparation;
      const invoke = () => operation === 'describeInput' ? preparation.describeInput()
        : operation === 'inputSources' ? preparation.authority.withRead('quote_context', {}, context => preparation.inputSources(h.candidate, context))
        : operation === 'alternatives' ? preparation.alternatives({ candidate: h.candidate, limit: 1 })
        : preparation[operation](h.candidate);
      const normal = await invoke();
      if (operation === 'describeInput') assert.ok(normal.pricingUnits.length > 0);
      if (operation === 'prepareUnified') assert.deepEqual(normal.sideEffects,
        { quoteSaved: false, inventoryReserved: false, orderCreated: false, approvalGranted: false });
      if (operation === 'inputSources') {
        assert.equal(normal.status, 'prepared_input_sources'); assert.ok(normal.fields.every(row => row.confirmed === false));
      }
      if (operation === 'alternatives') assert.equal(normal.automaticReplacement, false);
      if (operation === 'reviewAnsweredParameters') assert.equal(normal.humanConfirmation, 'required_before_preview');
      const unchanged = structuredClone(h.candidate), actor = h.h.identity.user.id;
      const readConfiguration = h.core.readQuoteConfiguration.bind(h.core), readRates = h.business.readQuoteRateTargets.bind(h.business);
      let leafAttempts = 0, configurationReads = 0, rateReads = 0, quoteAttempts = 0;
      h.core.readQuoteConfiguration = async (...args) => { configurationReads++; return readConfiguration(...args); };
      h.business.readQuoteRateTargets = async (...args) => { rateReads++; return readRates(...args); };
      h.business.createQuote = async () => { quoteAttempts++; throw Error('preparation is never a quote callback'); };
      const leaf = kind === 'rates' ? h.tools.quote.candidates.readers.rates
        : operation === 'describeInput' ? preparation.sources.contexts : h.tools.quote.candidates.contexts;
      const method = kind === 'rates' ? 'read' : 'current', readLeaf = leaf[method].bind(leaf);
      leaf[method] = async (...args) => {
        // The real nested Guard sees B throughout its own read and closing
        // check, then A is restored before the enclosing Guard rechecks.
        // Identical context/rate values cannot attest this source principal.
        leafAttempts++; h.h.identity.user.id = 'other-preparation-leaf-reader';
        try { return await readLeaf(...args); }
        finally { h.h.identity.user.id = actor; }
      };
      await assert.rejects(invoke(), error => error.code === 'FORBIDDEN', `${kind}:${operation}`);
      assert.equal(leafAttempts, 1, 'reject on the first original leaf Guard');
      if (kind === 'configuration') assert.equal(configurationReads, 0, 'different principal never enters Core configuration');
      else assert.ok(configurationReads > 0, 'the unchanged original configuration is observed before the rate boundary');
      assert.equal(rateReads, 0, 'different principal never enters original effective rate lookup');
      assert.equal(quoteAttempts, 0); assert.equal(h.h.identity.user.id, actor); assert.deepEqual(h.candidate, unchanged);
    }
  }
});
