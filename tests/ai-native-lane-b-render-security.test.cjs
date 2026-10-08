'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { loadFeature } = require('./fixtures/ai-native/b04-render.cjs');
test('actual ModelText escapes hostile HTML/links and cannot turn model content into a tool action', () => {
  const { ModelText } = loadFeature('ModelText.tsx');
  const markup = renderToStaticMarkup(React.createElement(ModelText, { kind: 'tool_candidate', text: '<script>synthetic()</script><a href="javascript:synthetic()">execute</a>' }));
  assert.ok(markup.includes('&lt;script&gt;')); assert.ok(!markup.includes('<script>'));
  assert.ok(!markup.includes('<a ')); assert.ok(markup.includes('未执行'));
});
test('actual ModelText bounds long untrusted output instead of rendering an unbounded body', () => {
  const { ModelText } = loadFeature('ModelText.tsx');
  const markup = renderToStaticMarkup(React.createElement(ModelText, { text: 'x'.repeat(30000) }));
  assert.ok(markup.includes('已截断')); assert.ok(markup.length < 22000);
});
