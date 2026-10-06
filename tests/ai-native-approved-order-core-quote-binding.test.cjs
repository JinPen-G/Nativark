'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const compiler = require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const input = { fulfillmentMode: 'pickup', fulfillmentLocationId: 'location-a', returnLocationId: 'location-b', startAt: '2026-10-10T00:00:00Z', endAt: '2026-10-11T00:00:00Z', customerType: 'personal', customerId: 'customer-a', bookingIdentity: { bookingIdentity: 'personal' }, lines: [{ itemGroupId: 'item-a', pricingGroupId: 'price-a', quantity: 2 }] };
const quote = { request: structuredClone(input) };

test('approved snapshot preparation can consume the existing Core validator as a public typed port', () => {
  assert.doesNotThrow(() => compiler.compile(`import { RentalOrderConfirmationService } from '../apps/api/src/modules/rental-core/rental-order-confirmation.service';
    const validate = RentalOrderConfirmationService.prototype.assertOrderMatchesQuote;
    export type QuoteBindingPort = Pick<RentalOrderConfirmationService, 'assertOrderMatchesQuote'>;
    export { validate };`, path.join(__dirname, 'ai-native-approved-order-core-port.ts')));
});
test('Core quote binding remains pure and rejects changed customer, booking identity, locations, dates and pricing groups', () => {
  const validate = RentalOrderConfirmationService.prototype.assertOrderMatchesQuote;
  assert.doesNotThrow(() => validate.call(null, input, quote));
  for (const change of [{ customerId: 'other' }, { bookingIdentity: { bookingIdentity: 'enterprise' } }, { fulfillmentLocationId: 'other' }, { returnLocationId: 'other' }, { fulfillmentMode: 'delivery' }, { startAt: '2026-10-10T12:00:00Z' }, { endAt: '2026-10-12T00:00:00Z' }, { lines: [{ ...input.lines[0], pricingGroupId: 'other' }] }, { lines: [{ ...input.lines[0], quantity: 3 }] }]) {
    assert.throws(() => validate.call(null, { ...input, ...change }, quote), error => error.getStatus() === 400);
  }
  assert.deepEqual(quote.request, input);
});
