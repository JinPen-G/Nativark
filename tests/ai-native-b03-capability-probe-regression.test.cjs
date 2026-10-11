'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiConnectionTestService } = require('../apps/api/src/modules/ai-native/connection-test.service');
const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');

const profile = { id: 'profile-w10', scopeId: 'tenant-w10', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT', serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model', credentialRef: 'vault:synthetic', configRevision: 7, enabled: true, allowedCapabilities: ['text', 'tools'], disabledAt: null };
const context = { tenantId: 'tenant-w10', workspaceId: 'space-w10', actorId: 'actor-w10' };

test('probe records one bounded evidence row per capability and does not send credential material', async () => {
  const requests = [], records = [];
  const service = new AiConnectionTestService({ invoke: async (_context, request) => { requests.push(request); return { text: 'synthetic-only' }; } }, { record: async input => { records.push(input); return input; } });
  const result = await service.run(context, profile, ['text', 'tools', 'text']);
  assert.deepEqual(result.map(row => row.capability), ['text', 'tools']);
  assert.equal(records.length, 2);
  assert.equal(records.every(row => row.source === 'connection_test'), true);
  assert.equal(records[0].details?.result, 'synthetic_probe_only');
  assert.equal(records[1].details?.errorCode, 'INVALID_RESPONSE');
  assert.equal(JSON.stringify(requests).includes('vault:synthetic'), false);
});

test('unsupported and transport failure remain distinguishable and never become supported evidence', async () => {
  const records = [];
  const service = new AiConnectionTestService({ invoke: async (_context, request) => request.features?.[0] === 'tools' ? Promise.reject(new ModelGatewayError('CAPABILITY_UNSUPPORTED')) : Promise.reject(new Error('offline transport')) }, { record: async input => { records.push(input); return input; } });
  const result = await service.run(context, profile, ['tools', 'streaming']);
  assert.deepEqual(result.map(row => [row.capability, row.status, row.errorCode]), [['tools', 'unverified', 'CAPABILITY_UNSUPPORTED'], ['streaming', 'unverified', 'CONFIG_INVALID']]);
  assert.equal(records.some(row => row.status === 'supported'), false);
});

test('configuration revision is part of the evidence identity and changed probes cannot reuse prior evidence', async () => {
  const records = [];
  const service = new AiConnectionTestService({ invoke: async () => ({ text: 'synthetic-only' }) }, { record: async input => { records.push(input); return input; } });
  await service.run(context, profile, ['text']);
  await service.run(context, { ...profile, configRevision: 8 }, ['text']);
  assert.notEqual(records[0].evidenceHash, records[1].evidenceHash);
  assert.deepEqual(records.map(row => row.profile.configRevision), [7, 8]);
});
