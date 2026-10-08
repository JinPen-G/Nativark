'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { CancelRecoveryStatus } = require('./fixtures/ai-native/b04-render.cjs').loadFeature('CancelRecoveryStatus.tsx');
test('cancel and recovery labels preserve uncertain side effects', () => { const html = renderToStaticMarkup(React.createElement(CancelRecoveryStatus, { status: 'cancel_requested' })); assert.ok(html.includes('取消已请求')); assert.ok(html.includes('动作可能已发生')); assert.ok(html.includes('disabled=""')); });
test('recovery candidate does not imply re-execution', () => { const html = renderToStaticMarkup(React.createElement(CancelRecoveryStatus, { status: 'recovery_candidate', canRecover: true, onRecover: async () => undefined })); assert.ok(html.includes('恢复不代表重新执行')); });
