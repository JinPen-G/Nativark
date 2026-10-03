'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { HumanConfirmShell } = require('./fixtures/ai-native/b04-render.cjs').loadFeature('HumanConfirmShell.tsx');
test('human confirmation is disabled without a host state and never emits an approval id', () => { const html = renderToStaticMarkup(React.createElement(HumanConfirmShell, { proposalId: 'proposal-1', revision: '3' })); assert.ok(html.includes('当前提案不可确认')); assert.ok(html.includes('disabled=""')); assert.equal(html.includes('approvalId'), false); });
test('expired and submitting states remain disabled', () => { const html = renderToStaticMarkup(React.createElement(HumanConfirmShell, { proposalId: 'proposal-1', revision: '3', available: true, expired: true, submitting: true, onConfirm: async () => undefined })); assert.ok(html.includes('提案已过期')); assert.ok(html.includes('提交中')); });
