'use strict';
const test = require('node:test'), assert = require('node:assert/strict'); require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test); require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiConnectionTestService } = require('../apps/api/src/modules/ai-native/connection-test.service'); const profile = { id: 'profile-test', scopeId: 'tenant-a', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT', serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model', credentialRef: 'vault:test', configRevision: 4, enabled: true, allowedCapabilities: ['text', 'tools'], disabledAt: null }, context = { tenantId: 'tenant-a', workspaceId: 'space-a', actorId: 'actor-a' };
test('text-only connection probe cannot certify capability or live evidence', async () => { const calls = [], records = []; const service = new AiConnectionTestService({ invoke: async (_c, request) => { calls.push(request); return { text: 'synthetic success' }; } }, { record: async input => { records.push(input); return input; } }); const result = await service.run(context, profile, ['text', 'tools', 'text']); assert.deepEqual(result.map(row => row.status), ['unverified', 'unverified']); assert.equal(calls.length, 2); assert.deepEqual(calls[1].features, ['tools']); assert.equal(records.every(row => row.source === 'connection_test'), true); });
test('local capability preflight rejection remains unverified without a provider dispatch', async () => {
  const { ProviderRouterService } = require('../apps/api/src/modules/ai-native/provider-router.service');
  const records = [], preflights = [];
  let dispatches = 0;
  const router = new ProviderRouterService({
    profiles: { list: async () => [structuredClone(profile)] },
    capabilities: { preflight: async (_profile, required) => {
      preflights.push([...required]);
      return { allowed: false, required, missing: [...required], stale: [] };
    } }
  });
  const service = new AiConnectionTestService({ invoke: async (_context, request) => {
    if (!request.features?.includes('tools')) throw new Error('synthetic transport failure');
    await router.resolve({
      consumerScope: { id: context.workspaceId, kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId },
      configurationScope: { id: profile.scopeId, kind: 'TENANT', tenantId: context.tenantId },
      mode: profile.serviceMode, scene: 'chat', requiredCapabilities: ['text', 'tools']
    });
    dispatches++;
    return { text: 'unexpected provider dispatch' };
  } }, { record: async input => { records.push(input); return input; } });
  const result = await service.run(context, profile, ['tools', 'text']);
  assert.deepEqual(preflights, [['text', 'tools']]);
  assert.equal(dispatches, 0);
  assert.deepEqual(result.map(row => [row.capability, row.status, row.errorCode]), [
    ['tools', 'unverified', 'CAPABILITY_UNSUPPORTED'], ['text', 'unverified', 'PROVIDER_FAILED']
  ]);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(row => [row.capability, row.status, row.details.errorCode]),
    result.map(row => [row.capability, row.status, row.errorCode]));
});
test('probe never exposes credential fields or disguises missing typed challenges as text', async () => {
  const requests=[],records=[];
  const service=new AiConnectionTestService({invoke:async(_c,value)=>{requests.push(value);return {text:'ok'};}},
    {record:async input=>{records.push(input);return input;}});
  const result=await service.run(context,profile,['text','vision','audio','embedding','reasoning']);
  assert.equal(requests.length,1);assert.equal(Object.hasOwn(requests[0],'apiKey'),false);
  assert.equal(JSON.stringify(requests).includes('vault:test'),false);
  assert.equal(records.length,5);
  assert.ok(result.slice(1).every(row=>row.status==='unverified'&&row.errorCode==='CONFIG_INVALID'));
});

test('probe refuses changed identity or profile while awaiting the original Gateway result', async () => {
  for (const target of ['profile', 'identity']) {
    const currentProfile=structuredClone(profile), currentContext=structuredClone(context), records=[], calls=[];
    const service=new AiConnectionTestService({invoke:async(c,request)=>{
      calls.push({context:structuredClone(c),request:structuredClone(request)});
      if(target==='profile') currentProfile.configRevision++;
      else currentContext.actorId='another-actor';
      return {text:'synthetic-only'};
    }},{record:async input=>{records.push(input);return input;}});
    await assert.rejects(service.run(currentContext,currentProfile,['text','tools']),
      error=>error.code===(target==='profile'?'CONFIG_INVALID':'FORBIDDEN'));
    assert.equal(records.length,0);assert.equal(calls.length,1);
    assert.equal(calls[0].context.actorId,context.actorId);
    assert.equal(calls[0].request.model,profile.model);
  }
});
