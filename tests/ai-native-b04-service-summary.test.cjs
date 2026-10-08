'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const { AiServiceSummary } = require('./fixtures/ai-native/b04-render.cjs').loadFeature('AiServiceSummary.tsx');
const render = summary => renderToStaticMarkup(React.createElement(AiServiceSummary, { summary }));
const base = { draftVersion: 'ain-c07-draft-2', tenantId: 'a', configId: 'c', configRevision: 1, enabled: true, connectionState: 'not_tested' };
test('platform service never renders provider model URL or hidden keys from input extras', () => { const html = render({ ...base, mode: 'platform_managed', serviceName: 'Rental OS AI', availability: 'not_verified', provider: 'private-provider', model: 'private-model', apiKey: 'private-key', baseUrl: 'https://private' }); assert.ok(html.includes('Rental OS AI')); for (const secret of ['private-provider', 'private-model', 'private-key', 'https://private']) assert.equal(html.includes(secret), false); });
test('missing config, BYOK missing credential, mock-only and unavailable remain distinct', () => { assert.ok(render(null).includes('配置不可用')); assert.ok(render({ ...base, mode: 'tenant_managed', protocol: 'openai', model: 'm', credentialState: 'missing' }).includes('未配置凭据')); assert.ok(render({ ...base, mode: 'tenant_managed', protocol: 'openai', model: 'm', credentialState: 'configured', connectionState: 'mock_only' }).includes('仅模拟验证')); assert.ok(render({ ...base, mode: 'platform_managed', availability: 'unavailable' }).includes('服务不可用')); });
