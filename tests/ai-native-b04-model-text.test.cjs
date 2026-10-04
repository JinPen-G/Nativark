'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const { ModelText } = require('./fixtures/ai-native/b04-render.cjs').loadFeature('ModelText.tsx');
test('real React render escapes malicious model text and does not execute tool candidates', () => {
  const html = renderToStaticMarkup(React.createElement(ModelText, { text: '<script>alert(1)</script><img src=x onerror=steal()>', kind: 'tool_candidate' }));
  assert.equal(html.includes('<script>'), false); assert.equal(html.includes('<img'), false);
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('未执行'));
});
test('long text is collapsed with a finite upper limit and accessible summary', () => {
  const html = renderToStaticMarkup(React.createElement(ModelText, { text: 'x'.repeat(30_000) }));
  assert.ok(html.includes('<details>')); assert.ok(html.includes('<summary>')); assert.ok(html.includes('已截断'));
  const renderedText = [...html.matchAll(/<p\b[^>]*>(x+)<\/p>/g)].map(match => match[1]).join('');
  assert.equal(renderedText.length, 20_000);
});
