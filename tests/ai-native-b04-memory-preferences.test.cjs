'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { MemoryPreferences } = require('./fixtures/ai-native/b04-render.cjs').loadFeature('MemoryPreferences.tsx');
test('memory states are explicit and automation is not user confirmation', () => { const html = renderToStaticMarkup(React.createElement(MemoryPreferences, { items: [{ id: 'm1', label: '交付方式', value: '门店', status: 'proposed', actorKind: 'automation', revision: '2' }, { id: 'm2', label: '语言', value: '中文', status: 'confirmed', actorKind: 'human', revision: '1' }, { id: 'm3', label: '旧偏好', value: '英文', status: 'revoked', actorKind: 'human', revision: '1' }] })); assert.ok(html.includes('待确认')); assert.ok(html.includes('已确认')); assert.ok(html.includes('已撤回')); assert.ok(html.includes('不代表用户已确认')); });
test('no host callback means no confirmation action is enabled', () => { const html = renderToStaticMarkup(React.createElement(MemoryPreferences, { items: [{ id: 'm1', label: '偏好', value: '门店', status: 'proposed', actorKind: 'human', revision: '1' }] })); assert.ok(html.includes('disabled=""')); });
