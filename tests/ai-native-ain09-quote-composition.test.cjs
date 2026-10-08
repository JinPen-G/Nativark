'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { createAiQuotePreviewService } = require('../apps/api/src/modules/ai-native/quote-preview.composition');

const core = { createQuote: async () => { throw new Error('not reached'); } };
const context = { current: async () => ({}) };
const authority = { withQuote: async () => { throw new Error('not reached'); } };

test('AIN-09 composition requires every trusted dependency and does not provide defaults', () => {
  assert.throws(() => createAiQuotePreviewService({ core: null, context, authority }), /CORE_UNAVAILABLE/);
  assert.throws(() => createAiQuotePreviewService({ core, context: null, authority }), /CONTEXT_UNAVAILABLE/);
  assert.throws(() => createAiQuotePreviewService({ core, context, authority: null }), /AUTHORITY_UNAVAILABLE/);
});

test('AIN-09 composition returns the explicit preview service without registering routes', () => {
  const service = createAiQuotePreviewService({ core, context, authority });
  assert.equal(typeof service.preview, 'function');
});
