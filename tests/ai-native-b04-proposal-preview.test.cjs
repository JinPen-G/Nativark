'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { ProposalPreview } = require('./fixtures/ai-native/b04-render.cjs').loadFeature('ProposalPreview.tsx');
test('proposal preview displays host values and missing evidence without approval claim', () => { const html = renderToStaticMarkup(React.createElement(ProposalPreview, { proposal: { title: '更新取还规则', risk: 'R2', changes: [{ label: '提前天数', before: '7', after: '3' }] } })); assert.ok(html.includes('尚不能视为已批准')); assert.ok(html.includes('7')); assert.ok(html.includes('3')); });
