'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { MissingFieldsPanel } = require('./fixtures/ai-native/b04-render.cjs').loadFeature('MissingFieldsPanel.tsx');
test('missing fields consume only host definitions and preserve field errors', () => { const html = renderToStaticMarkup(React.createElement(MissingFieldsPanel, { fields: [{ name: 'pickupDate', label: '取件日期', type: 'date', required: true, error: '日期不可用' }], draft: { pickupDate: '' } })); assert.ok(html.includes('取件日期')); assert.ok(html.includes('日期不可用')); assert.ok(html.includes('disabled=""')); });
test('no fields does not infer a form from model text', () => { assert.ok(renderToStaticMarkup(React.createElement(MissingFieldsPanel, { draft: {} })).includes('定义不可用')); });
