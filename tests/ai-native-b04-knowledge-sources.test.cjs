'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { KnowledgeSources } = require('./fixtures/ai-native/b04-render.cjs').loadFeature('KnowledgeSources.tsx');
test('knowledge source states are explicit and source is not rendered as a URL', () => { const html = renderToStaticMarkup(React.createElement(KnowledgeSources, { sources: [{ id: 'doc-1', title: '退货规则', version: 'v2', status: 'available' }, { id: 'doc-2', title: '旧规则', version: 'v1', status: 'withdrawn' }, { id: 'doc-3', title: '私有规则', version: 'v4', status: 'forbidden' }] })); assert.ok(html.includes('可查看')); assert.ok(html.includes('已撤回')); assert.ok(html.includes('无权限')); assert.equal(html.includes('href='), false); assert.equal(html.includes('doc-1'), false); });
test('open action is host-controlled and disabled without a host callback', () => { const html = renderToStaticMarkup(React.createElement(KnowledgeSources, { sources: [{ id: 'doc-1', title: '规则', version: 'v2', status: 'available' }] })); assert.ok(html.includes('disabled=""')); });
