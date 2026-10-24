'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { RENTAL_CATEGORY_DEFINITIONS } = require('./fixtures/ai-native/local-shared.cjs');
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
        return { fieldId: field.fieldId, value: field.options.some(option => option.value === current) ? current : field.options[0].value };
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
  h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.quote.businessPreparation.describeInput());
});
