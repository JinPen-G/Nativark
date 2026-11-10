'use strict';
const test = require('node:test'), assert = require('node:assert/strict'); require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test); require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AiConnectionTestService } = require('../apps/api/src/modules/ai-native/connection-test.service'); const profile = { id: 'profile-test', scopeId: 'tenant-a', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT', serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model', credentialRef: 'vault:test', configRevision: 4, enabled: true, allowedCapabilities: ['text', 'tools'], disabledAt: null }, context = { tenantId: 'tenant-a', workspaceId: 'space-a', actorId: 'actor-a' };
test('text-only connection probe cannot certify capability or live evidence', async () => { const calls = [], records = []; const service = new AiConnectionTestService({ invoke: async (_c, request) => { calls.push(request); return { text: 'synthetic success' }; } }, { record: async input => { records.push(input); return input; } }); const result = await service.run(context, profile, ['text', 'tools', 'text']); assert.deepEqual(result.map(row => row.status), ['unverified', 'unverified']); assert.equal(result[1].errorCode, 'INVALID_RESPONSE'); assert.equal(calls.length, 2); assert.deepEqual(calls[1].features, ['tools']); assert.equal(records.every(row => row.source === 'connection_test'), true); });
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
test('unattested capability rejection remains unverified alongside transport failures', async () => { const records = []; const service = new AiConnectionTestService({ invoke: async (_c, request) => { if (request.features?.[0] === 'tools') throw new (require('../apps/api/src/modules/ai-native/model-gateway.ports').ModelGatewayError)('CAPABILITY_UNSUPPORTED'); throw new Error('synthetic transport failure'); } }, { record: async input => { records.push(input); return input; } }); const result = await service.run(context, profile, ['tools', 'text']); assert.deepEqual(result.map(row => [row.capability, row.status, row.errorCode]), [['tools', 'unverified', 'CAPABILITY_UNSUPPORTED'], ['text', 'unverified', 'PROVIDER_FAILED']]); assert.equal(records.length, 2); });
test('probe never exposes credential fields to the gateway request', async () => { let request; const service = new AiConnectionTestService({ invoke: async (_c, value) => { request = value; return { text: 'ok' }; } }, { record: async input => input }); await service.run(context, profile, ['text']); assert.equal(Object.hasOwn(request, 'apiKey'), false); assert.equal(JSON.stringify(request).includes('vault:test'), false); });

test('versioned text challenge and unregistered probe cannot grant dispatch or live provenance', async () => {
  const { textProbeIntent, TEXT_PROBE_SCENE } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const { ChatCompletionsAdapter } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
  const { RoutedModelTransport } = require('../apps/api/src/modules/ai-native/routed-model-transport');
  const { prepareGatewayTextIntent } = require('../apps/api/src/modules/ai-native/gateway-intent');
  const { TextCapabilityProbeApplication } = require('../apps/api/src/modules/ai-native/text-capability-probe.application');
  assert.equal(typeof TextCapabilityProbeApplication, 'function');
  const { TextCapabilityProbeModule } = require('../apps/api/src/modules/ai-native/text-capability-probe.module');
  assert.deepEqual(Reflect.getMetadata('controllers', TextCapabilityProbeModule) ?? [], []);
  const inert = TextCapabilityProbeModule.register({});
  assert.equal(inert.controllers, undefined);
  assert.throws(() => inert.providers[0].useFactory(), error => error.code === 'CONFIG_INVALID');
  const prepared = textProbeIntent('probe-operation', 'probe-scope');
  assert.deepEqual(textProbeIntent('probe-operation', 'probe-scope'), prepared);
  assert.notEqual(textProbeIntent('probe-operation', 'another-scope').intent.requestId, prepared.intent.requestId);
  let sent = 0;
  const adapter = new ChatCompletionsAdapter({ post: async () => { sent++; throw Error('unexpected send'); } });
  assert.equal(adapter.evidenceMode, 'mock');
  const resolver = { resolve: async () => assert.fail('unregistered probe must not reach credentials') };
  const transport = new RoutedModelTransport({ tenant: resolver, platform: resolver }, [adapter]);
  const request = { ...prepareGatewayTextIntent(prepared.intent, { sceneCode: TEXT_PROBE_SCENE, maxOutputTokens: 32 }, 'invoke').request, model: profile.model };
  const route = { profile, scope: { id: profile.scopeId, kind: 'TENANT', tenantId: context.tenantId }, role: 'DEFAULT',
    preflight: { allowed: false, required: ['text'], missing: ['text'], stale: [] } };
  await assert.rejects(transport.invoke(context, request, route, new AbortController().signal), e => e.code === 'CONFIG_INVALID');
  await assert.rejects(transport.invoke(context, request, { ...route, probe: { purpose: 'capability_text_probe', operationId: 'probe-operation',
    profileFingerprint: 'a'.repeat(64), intentHash: prepared.intentHash } }, new AbortController().signal), e => e.code === 'FORBIDDEN');
  assert.equal(sent, 0);
});

test('eight-kind selection keeps missing objective methods unverified without executable descriptors or text fallback', async () => {
  const { AI_CAPABILITY_PROBE_KINDS_DRAFT: kinds } = require('@rental-os/shared');
  const { textProbeCommandSchema, textProbeDescriptorSchema, textProbePreparation, textProbeIntent,
    textProbeMethod, textProbeRequirements } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const { PrismaTextCapabilityReceiptRepository } = require('../apps/api/src/modules/ai-native/prisma-text-capability-receipt.repository');
  assert.deepEqual(kinds, ['text', 'streaming', 'vision', 'audio', 'structured_output', 'tools', 'embedding', 'reasoning']);
  for (const capability of kinds) assert.equal(textProbeCommandSchema.safeParse({ operationId: 'probe',
    profileKey: 'default', profileFingerprint: 'a'.repeat(64), capability }).success, true);
  for (const capability of kinds.slice(0, 6)) assert.deepEqual(textProbePreparation('probe', 'scope', capability), textProbeIntent('probe', 'scope', capability));
  assert.deepEqual(textProbePreparation('probe', 'scope'), textProbeIntent('probe', 'scope', 'text'));
  assert.equal(textProbeCommandSchema.safeParse({ operationId: 'probe', profileKey: 'default',
    profileFingerprint: 'a'.repeat(64), capability: 'arbitrary' }).success, false);
  let reads = 0;
  const neverRead = async () => { reads++; assert.fail('no objective method cannot consume fabricated live receipts or ledger rows'); };
  const verifier = new PrismaTextCapabilityReceiptRepository({ $queryRaw: neverRead, $transaction: neverRead });
  for (const capability of ['embedding', 'reasoning']) {
    const command = { operationId: 'probe', profileKey: 'default', profileFingerprint: 'a'.repeat(64), capability };
    const prepared = textProbePreparation(command.operationId, 'scope', capability);
    assert.equal(prepared.intent, null); assert.equal(prepared.expected, null);
    assert.equal(textProbeMethod(command), `${capability}-unavailable-1`);
    assert.deepEqual(textProbeRequirements(command), capability === 'reasoning' ? ['text', 'reasoning'] : [capability]);
    assert.notEqual(prepared.intentHash, textProbeIntent('probe', 'scope').intentHash);
    assert.notEqual(prepared.intentHash, textProbePreparation('another-probe', 'scope', capability).intentHash);
    if (capability === 'embedding') {
      const { prepareGatewayEmbeddingProbeIntent } = require('../apps/api/src/modules/ai-native/gateway-intent');
      assert.throws(() => prepareGatewayEmbeddingProbeIntent(textProbeIntent('probe', 'scope', capability).intent,
        { sceneCode: 'ai.capability.text', maxOutputTokens: 32 }), { code: 'CAPABILITY_UNSUPPORTED' });
    }
    else {
      const { prepareGatewayTextIntent } = require('../apps/api/src/modules/ai-native/gateway-intent');
      // A native template is not a grant to use it on an ordinary text scene.
      assert.throws(() => prepareGatewayTextIntent(textProbeIntent('probe', 'scope', capability).intent,
        { sceneCode: 'ai.capability.text', maxOutputTokens: 32 }, 'invoke'), { code: 'CAPABILITY_UNSUPPORTED' });
    }
    const descriptor = { command, context, scopeId: 'scope', profileId: profile.id, methodVersion: 'text-echo-1',
      callId: 'old-text-call', intentHash: prepared.intentHash, challengeHash: prepared.challengeHash,
      profileFingerprint: command.profileFingerprint, configuration: {}, configurationHash: 'a'.repeat(64), stepId: 'step', runId: 'run' };
    assert.equal(textProbeDescriptorSchema.safeParse(descriptor).success, false);
    assert.equal(textProbeDescriptorSchema.safeParse({ ...descriptor, methodVersion: textProbeMethod(command) }).success, false);
    assert.equal(await verifier.verify({ profile, capability, status: 'supported', source: 'connection_test',
      evidenceHash: 'a'.repeat(64), checkedAt: new Date('2026-11-07T00:00:00Z'), expiresAt: new Date('2026-11-07T01:00:00Z'),
      details: { receiptId: 'forged-live-receipt', verification: { evidence: 'live', methodVersion: textProbeMethod(command),
        capability, profileFingerprint: 'a'.repeat(64) } } }), false);
  }
  assert.equal(reads, 0);
  // Explicit platform attribution uses the production authority/application;
  // Guard/profile/DB ports here are offline substitutes, not native authorization.
  const { PlatformCapabilityProbeAuthority } = require('../apps/api/src/modules/ai-native/platform-capability-probe/platform-probe.authority');
  const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const selected = { ...profile, id: 'platform-profile', scopeId: 'platform-scope', scopeKind: 'PLATFORM',
    serviceMode: 'platform_managed', allowedCapabilities: ['text'] };
  const platformContext = { actorId: context.actorId, scopeKind: 'platform' };
  let revoked = false, reserveAttempts = 0;
  const authorityFor = command => new PlatformCapabilityProbeAuthority({ profileId: selected.id,
    management: { manage: async () => { if (revoked) throw new ModelGatewayError('FORBIDDEN'); } },
    profiles: { get: async () => structuredClone(selected) },
    scopes: { resolveRoutingScopes: async () => ({ context: { actor: { kind: 'saas_admin', userId: context.actorId },
      audience: 'operator', scope: { kind: 'platform' }, requestId: 'platform-request', authorizedAt: '2026-11-07T00:00:00Z' },
      consumerScope: { id: selected.scopeId, kind: 'PLATFORM' }, configurationScope: { id: selected.scopeId, kind: 'PLATFORM' } }) },
    bindings: { resolveForReserve: async () => { reserveAttempts++; assert.fail('no platform reserve for absent methods'); } }
  }, platformContext, command);
  const app = probeApplicationWithBoundaryPorts();
  app.input = { ...app.input, identity: { currentRequest: async () => ({ context: platformContext, binding: 'platform-binding' }),
    authority: (_context, command) => authorityFor(command) } };
  for (const capability of ['embedding', 'reasoning']) {
    const command = { operationId: `platform-${capability}`, profileKey: selected.profileKey,
      profileFingerprint: capabilityProfileFingerprint(selected), capability };
    const prepared = await app.prepareCurrent(command);
    assert.equal(prepared.intent, null); assert.equal(prepared.configuration.consumerScope.kind, 'platform');
    assert.equal(Object.hasOwn(prepared.configuration, 'tenantId'), false);
    assert.equal((await app.reconcileCurrent(command)).reason, capability === 'embedding' ? 'capability_not_enabled' : 'objective_method_unavailable');
    assert.equal((await app.preflightCurrent(command)).allowed, false);
    const held = { stepId: 'step', lease: { runId: 'run', holderId: 'holder', fencingToken: '1' },
      priceVersion: 'price', expiresAt: new Date('2026-11-07T01:00:00Z') };
    assert.equal((await app.runHeldCurrent(command, held)).status, 'unverified');
    await assert.rejects(app.prepareHeldInvocationCurrent(command, held), { code: 'CAPABILITY_UNSUPPORTED' });
    const authority = authorityFor(command), route = await authority.resolve(platformContext, textProbeRequirements(command));
    await assert.rejects(authority.authorizeDispatch({ actorId: context.actorId }, {}, route.route), { code: 'CAPABILITY_UNSUPPORTED' });
    revoked = true;
    try { await assert.rejects(app.reconcileCurrent(command), { code: 'FORBIDDEN' }); }
    finally { revoked = false; }
  }
  assert.equal(reserveAttempts, 0);
});

test('Responses reasoning channel requires native items and original counters, never a final text echo', async () => {
  const { ResponsesAdapter, AnthropicMessagesAdapter } = require('../apps/api/src/modules/ai-native/native-messages.adapter');
  const { textProbeIntent, textProbePreparation, REASONING_PROBE_METHOD } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const { ModelGatewayError, modelAdapterSupportsCapabilities, modelRequestSchema } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
  const prepared = textProbeIntent('native-reasoning', 'scope', 'reasoning');
  assert.deepEqual(textProbePreparation('native-reasoning', 'scope', 'reasoning', 'openai_responses'), prepared);
  assert.equal(textProbePreparation('native-reasoning', 'scope', 'reasoning', 'openai_chat_completions').intent, null);
  assert.equal(prepared.intent.requiredFeatures.includes('reasoning'), true);
  assert.equal(prepared.intent.messages[0].content[0].text.includes('PROBE_'), false);
  let payload = { status: 'completed', output: [{ type: 'reasoning', id: 'reasoning-1', summary: [{ text: 'unexported synthetic thought' }] },
    { type: 'message', id: 'answer', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: prepared.expected }] }],
    usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12, output_tokens_details: { reasoning_tokens: 4 } } };
  const sent = [], recorded = [];
  const adapter = new ResponsesAdapter({ post: async request => { sent.push(JSON.parse(request.body)); return { status: 200, body: JSON.stringify(payload) }; } });
  const value = { callId: prepared.intent.requestId, model: 'synthetic-reasoning', messages: [{ role: 'user', content: prepared.intent.messages[0].content[0].text }],
    maxOutputTokens: 32, features: ['reasoning'], signal: new AbortController().signal, recordUsage: async usage => recorded.push(usage) };
  assert.equal(modelRequestSchema.safeParse({ callId: value.callId, model: value.model, messages: value.messages,
    maxOutputTokens: value.maxOutputTokens, features: ['reasoning'] }).success, false); // No new grant through the old loose ingress.
  const result = await adapter.generate(value, 'offline-reasoning-key', { baseUrl: 'https://offline.example/v1' });
  assert.equal(result.text, prepared.expected); assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 7 });
  assert.deepEqual(recorded, [{ inputTokens: 5, outputTokens: 7 }]);
  assert.equal(result.reasoningEvidence.methodVersion, REASONING_PROBE_METHOD); assert.equal(result.reasoningEvidence.reasoningTokens, 4);
  assert.equal(result.reasoningEvidence.itemCount, 1); assert.match(result.reasoningEvidence.channelHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('unexported synthetic thought'), false);
  assert.equal(JSON.stringify(result).includes('reasoning-1'), false); assert.equal(sent.length, 1);
  assert.equal(modelAdapterSupportsCapabilities(adapter, ['text', 'reasoning']), true);
  assert.equal(modelAdapterSupportsCapabilities(new AnthropicMessagesAdapter({ post: async () => assert.fail('unsupported codec') }), ['reasoning']), false);
  const valid = structuredClone(payload);
  for (const scenario of ['text-only', 'missing-counter', 'counter-conflict']) {
    payload = structuredClone(valid);
    if (scenario === 'text-only') payload.output.shift();
    else if (scenario === 'missing-counter') delete payload.usage.output_tokens_details;
    else payload.usage.output_tokens_details.reasoning_tokens = 8;
    await assert.rejects(adapter.generate(value, 'offline-reasoning-key', { baseUrl: 'https://offline.example/v1' }),
      error => error instanceof ModelGatewayError && error.code === 'INVALID_RESPONSE');
  }
  payload = valid;
  const ordinary = await adapter.generate({ ...value, features: undefined }, 'offline-reasoning-key', { baseUrl: 'https://offline.example/v1' });
  assert.equal(ordinary.reasoningEvidence, undefined); // Existing text calls do not acquire a reasoning attestation.
});

test('native embedding probe returns bounded vector evidence and input-only usage, never text JSON or a loose grant', async () => {
  const { createNativeModelAdapter } = require('../apps/api/src/modules/ai-native/native-model-adapters');
  const { textProbeIntent, textProbePreparation, EMBEDDING_PROBE_METHOD } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const { modelRequestSchema, ModelGatewayError, modelAdapterSupportsCapabilities } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
  const { prepareGatewayEmbeddingProbeIntent, prepareGatewayTextIntent } = require('../apps/api/src/modules/ai-native/gateway-intent');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const prepared = textProbeIntent('native-embedding', 'scope', 'embedding');
  assert.deepEqual(textProbePreparation('native-embedding', 'scope', 'embedding', 'openai_chat_completions'), prepared);
  assert.equal(textProbePreparation('native-embedding', 'scope', 'embedding', 'openai_responses').intent, null);
  assert.throws(() => prepareGatewayEmbeddingProbeIntent(prepared.intent, { sceneCode: 'ai.capability.text', maxOutputTokens: 32 }), { code: 'CAPABILITY_UNSUPPORTED' });
  assert.throws(() => prepareGatewayTextIntent(prepared.intent, { sceneCode: 'ai.capability.text', maxOutputTokens: 32 }, 'invoke'), { code: 'CAPABILITY_UNSUPPORTED' });
  let payload = { object: 'list', model: 'synthetic-embedding', data: [
    { object: 'embedding', index: 0, embedding: [0.2, 0.5, 0.7] }, { object: 'embedding', index: 1, embedding: [0.8, -0.1, 0.3] }], usage: { prompt_tokens: 5, total_tokens: 5 } };
  const sent = [], recorded = [], transport = { post: async request => { assert.equal(request.url.endsWith('/embeddings'), true);
    sent.push(JSON.parse(request.body)); return { status: 200, body: JSON.stringify(payload) }; } };
  const adapter = createNativeModelAdapter('openai_chat_completions', { embeddingProbe: true }, transport);
  assert.equal(modelAdapterSupportsCapabilities(adapter, ['embedding']), true);
  assert.equal(modelAdapterSupportsCapabilities(adapter, ['text']), false);
  assert.equal(modelAdapterSupportsCapabilities(adapter, ['embedding', 'text']), false);
  assert.equal(sent.length, 0); // Local capability rejection must not dispatch.
  const ordinary = createNativeModelAdapter('openai_chat_completions', {}, transport);
  assert.equal(ordinary.features.includes('embedding'), false);
  assert.equal(modelAdapterSupportsCapabilities(ordinary, ['text']), true);
  assert.throws(() => createNativeModelAdapter('openai_responses', { embeddingProbe: true }, transport), { code: 'CAPABILITY_UNSUPPORTED' });
  const value = { callId: prepared.intent.requestId, model: payload.model,
    messages: prepared.intent.messages.map(message => ({ role: message.role, content: message.content[0].text })),
    maxOutputTokens: 32, features: ['embedding'], signal: new AbortController().signal, recordUsage: async usage => recorded.push(usage) };
  assert.equal(modelRequestSchema.safeParse({ callId: value.callId, model: value.model, messages: value.messages,
    maxOutputTokens: 32, features: ['embedding'] }).success, false);
  const result = await adapter.generate(value, 'offline-embedding-key', { baseUrl: 'https://offline.example/v1' });
  assert.equal(result.text, ''); assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 0 });
  assert.deepEqual(recorded, [{ inputTokens: 5, outputTokens: 0 }]);
  assert.equal(result.embeddingEvidence.methodVersion, EMBEDDING_PROBE_METHOD); assert.equal(result.embeddingEvidence.vectorCount, 2);
  assert.equal(result.embeddingEvidence.dimensions, 3); assert.equal(result.embeddingEvidence.inputHash, requestFingerprint(value.messages.map(message => message.content)));
  assert.equal(result.embeddingEvidence.vectorHash, requestFingerprint(payload.data.map(row => row.embedding)));
  assert.equal(Object.hasOwn(result, 'vectors'), false); assert.equal(Object.hasOwn(sent[0], 'messages'), false);
  assert.equal(Object.hasOwn(sent[0], 'max_completion_tokens'), false); assert.equal(sent.length, 1);
  const valid = structuredClone(payload);
  for (const scenario of ['text-json', 'identical-vectors', 'missing-counter', 'counter-conflict']) {
    payload = structuredClone(valid);
    if (scenario === 'text-json') { delete payload.data; payload.choices = [{ message: { content: JSON.stringify(valid.data) } }]; }
    else if (scenario === 'identical-vectors') payload.data[1].embedding = [...payload.data[0].embedding];
    else if (scenario === 'missing-counter') delete payload.usage.total_tokens;
    else payload.usage.total_tokens = 6;
    await assert.rejects(adapter.generate(value, 'offline-embedding-key', { baseUrl: 'https://offline.example/v1' }),
      error => error instanceof ModelGatewayError && error.code === 'INVALID_RESPONSE');
  }
});

// Construct the real application (including private one-shot execution state).
// Unreplaced external/database ports fail closed, rather than fake success.
function probeApplicationWithBoundaryPorts() {
  const { TextCapabilityProbeApplication } = require('../apps/api/src/modules/ai-native/text-capability-probe.application');
  const unavailable = async () => { throw Error('unexpected offline boundary'); };
  const delegate = { findFirst: unavailable, findUnique: unavailable, findMany: unavailable,
    create: unavailable, updateMany: unavailable, upsert: unavailable };
  const db = { $transaction: unavailable, $queryRaw: unavailable, aiScope: delegate, aiProviderProfile: delegate,
    aiProviderCapabilityEvidence: delegate, aiTaskExecutionCharge: delegate };
  return new TextCapabilityProbeApplication({ db, scopes: { resolveCurrent: unavailable, resolveRoutingScopes: unavailable },
    management: { authorize: unavailable }, configuration: { selectionForInvocation: unavailable, profile: unavailable, credential: unavailable },
    authorization: { resolveContext: unavailable, authorize: unavailable }, subscriptions: { readCategoryCommercialContext: unavailable },
    pricing: { quote: unavailable, quantity: unavailable }, audit: { append: unavailable }, protocol: { post: unavailable } });
}

test('current probe host derives identity and rejects changed authority after waiting', async () => {
  const { TextCapabilityProbeApplication } = require('../apps/api/src/modules/ai-native/text-capability-probe.application');
  const app = probeApplicationWithBoundaryPorts();
  let actor = 'actor-a', change = false;
  app.input = { scopes: { resolveCurrent: async () => ({ scope: { id: 'scope', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'space-a' },
    context: { actor: { kind: 'user', userId: actor }, audience: 'operator', scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'space-a' } } }) } };
  app.prepare = async (actual, command) => { assert.deepEqual(actual, context); assert.equal(command.operationId, 'probe');
    if (change) actor = 'another-user'; return { status: 'prepared' }; };
  const command = { operationId: 'probe', profileKey: 'default', profileFingerprint: 'a'.repeat(64) };
  assert.equal((await app.prepareCurrent(command)).status, 'prepared');
  change = true;
  await assert.rejects(app.prepareCurrent(command), e => e.code === 'FORBIDDEN');
});

test('text capability probe resolves the platform-managed profile without tenant fallback', async () => {
  const { TextCapabilityProbeAuthority } = require('../apps/api/src/modules/ai-native/text-capability-probe.authority');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const { textProbeConfiguration } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const platformProfile = { ...profile, id: 'platform-profile', scopeId: 'platform-a', scopeKind: 'PLATFORM',
    serviceMode: 'platform_managed' };
  const command = { operationId: 'platform-probe', profileKey: 'default', profileFingerprint: capabilityProfileFingerprint(platformProfile) };
  const executionContext = { actor: { kind: 'user', userId: context.actorId }, audience: 'operator',
    scope: { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId }, requestId: 'request', authorizedAt: '2026-10-11T12:00:00.000Z' };
  const authority = new TextCapabilityProbeAuthority({
    management: { authorize: async () => undefined },
    configuration: { selectionForInvocation: async () => ({ mode: 'platform_managed', revision: 4 }) },
    scopes: { resolveRoutingScopes: async mode => { assert.equal(mode, 'platform_managed'); return {
      context: executionContext, consumerScope: { id: 'workspace-scope', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId },
      configurationScope: { id: 'platform-a', kind: 'PLATFORM' }
    }; } },
    profiles: { get: async (scope, key) => { assert.deepEqual(scope, { id: 'platform-a', kind: 'PLATFORM' }); assert.equal(key, 'default'); return platformProfile; } },
    bindings: { resolveForReserve: async () => { throw new Error('not reached during resolve'); } }
  }, context, command);
  const resolved = await authority.resolve(context, ['text']);
  assert.equal(resolved.selection.mode, 'platform_managed');
  assert.equal(resolved.route.profile.serviceMode, 'platform_managed');
  assert.deepEqual(textProbeConfiguration(platformProfile, { kind: 'workspace', tenantId: context.tenantId }).configurationScope, { kind: 'platform' });
});

test('probe validates execution before occupying operation key and never redispatches original registration', async () => {
  const { TextCapabilityProbeApplication } = require('../apps/api/src/modules/ai-native/text-capability-probe.application');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const command = { operationId: 'original-probe', profileKey: profile.profileKey, profileFingerprint: capabilityProfileFingerprint(profile) };
  const execution = { stepId: 'step', lease: { runId: 'run', holderId: 'holder', fencingToken: '1' }, priceVersion: 'price-1', expiresAt: new Date('2026-10-12T00:00:00Z') };
  // Exercise the real application's orchestration with boundary ports replaced;
  // no provider or database is contacted and no live provenance is asserted.
  for (const scenario of ['invalid', 'original_registration', 'original_receipt']) {
    let writes = 0, registrations = 0;
    const app = probeApplicationWithBoundaryPorts();
    app.authority = () => ({ resolve: async () => ({ consumerScope: { id: 'scope' }, route: { profile } }) });
    app.receipts = { find: async () => scenario === 'original_receipt' ? { id: 'receipt' } : null,
      begin: async () => { writes++; assert.fail('must not create a receipt on rejected/replayed execution'); } };
    app.accounting = { bindings: { register: async () => { registrations++;
      if (scenario === 'invalid') throw Object.assign(new Error('denied'), { code: 'FORBIDDEN' });
      return { id: 'invocation', replayed: true }; } } };
    app.collect = async () => ({ status: 'unverified', reason: 'original_receipt_pending' });
    if (scenario === 'invalid') await assert.rejects(app.run(context, command, execution), e => e.code === 'FORBIDDEN');
    else assert.equal((await app.run(context, command, execution)).status, 'unverified');
    assert.equal(writes, 0);
    assert.equal(registrations, scenario === 'original_receipt' ? 0 : 1);
  }
});

test('platform probe requires its explicit vault resolver before preparation or new invocation writes', async () => {
  const { TextCapabilityProbeApplication } = require('../apps/api/src/modules/ai-native/text-capability-probe.application');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const selected = { ...profile, scopeKind: 'PLATFORM', scopeId: 'platform-a', serviceMode: 'platform_managed' };
  const command = { operationId: 'platform-operation', profileKey: selected.profileKey, profileFingerprint: capabilityProfileFingerprint(selected) };
  const app = probeApplicationWithBoundaryPorts();
  app.input = { configuration: { selectionForInvocation: async () => { throw Error('BYOK must not be read'); },
    profile: async () => { throw Error('BYOK must not be read'); }, credential: async () => { throw Error('BYOK must not be read'); } } };
  app.authority = () => ({ resolve: async () => ({ consumerScope: { id: 'workspace-scope' }, route: { profile: selected } }) });
  let writes = 0, original = false;
  app.receipts = { find: async () => original ? { id: 'original-receipt' } : null, begin: async () => { writes++; throw Error('unexpected write'); } };
  app.accounting = { bindings: { register: async () => { writes++; throw Error('unexpected write'); } } };
  app.collect = async () => ({ status: 'unverified', reason: 'original_receipt_pending' });
  await assert.rejects(app.prepare(context, command), { code: 'CREDENTIAL_UNAVAILABLE' });
  await assert.rejects(app.run(context, command, { stepId: 'step', lease: { runId: 'run' }, priceVersion: 'price', expiresAt: new Date() }), { code: 'CREDENTIAL_UNAVAILABLE' });
  assert.equal(writes, 0);
  original = true;
  assert.equal((await app.run(context, command, { stepId: 'step', lease: { runId: 'run' }, priceVersion: 'price', expiresAt: new Date() })).reason, 'original_receipt_pending');
  app.input.platformConnection = { resolve: async () => { throw Error('preparation must not decrypt credentials'); } };
  assert.equal((await app.prepare(context, command)).configuration.serviceMode, 'platform_managed');
});

test('runner-owned probe registration reaches the original receipt once without a second registration', async () => {
  const { TextCapabilityProbeApplication } = require('../apps/api/src/modules/ai-native/text-capability-probe.application');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const app = probeApplicationWithBoundaryPorts();
  app.input = { db: { aiTaskExecutionCharge: { findMany: async ({ where }) => {
    assert.equal(where.gatewayInvocationId, 'invocation'); assert.equal(where.resource, 'CALLS');
    assert.equal(where.leaseOwnerId, 'holder'); assert.equal(where.fencingToken, '1'); return [{ id: 'original-call-charge' }];
  } } }, scopes: { resolveCurrent: async () => ({ scope: { id: 'workspace-scope', kind: 'WORKSPACE',
    tenantId: context.tenantId, workspaceId: context.workspaceId }, context: { actor: { kind: 'user', userId: context.actorId },
    audience: 'operator', scope: { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId } } }) } };
  app.authority = () => ({ resolve: async () => ({ consumerScope: { id: 'workspace-scope' }, route: { profile } }) });
  let registrations = 0, starts = 0;
  app.accounting = { bindings: { register: async () => ({ id: 'invocation', replayed: ++registrations > 1 }) } };
  app.receipts = { find: async () => null, begin: async () => { starts++; throw Object.assign(Error('stop before dispatch'), { code: 'OFFLINE_BOUNDARY' }); } };
  const command = { operationId: 'owned-probe', profileKey: profile.profileKey, profileFingerprint: capabilityProfileFingerprint(profile) };
  const held = { stepId: 'step', lease: { runId: 'run', holderId: 'holder', fencingToken: '1' },
    priceVersion: 'price', expiresAt: new Date('2026-10-12T00:00:00Z') };
  const prepared = await app.prepareHeldInvocationCurrent(command, held);
  assert.equal(prepared.invocationId, 'invocation');
  assert.equal(registrations, 1); assert.equal(starts, 0);
  await assert.rejects(prepared.execute(), { code: 'OFFLINE_BOUNDARY' });
  assert.equal(starts, 1); assert.equal(registrations, 1);
  await assert.rejects(prepared.execute(), { code: 'ACCOUNTING_PENDING' });
  await assert.rejects(app.prepareHeldInvocationCurrent(command, held), { code: 'ACCOUNTING_PENDING' });
  assert.equal(starts, 1); assert.equal(registrations, 2);
});

test('owned probe returns the real public Gateway envelope, not the capability summary', async () => {
  const { ChatCompletionsAdapter } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const { textProbeIntent } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const { isGatewayResult } = require('../apps/api/src/modules/ai-native/gateway-contract-validation');
  // Actual application/Public/Unified/transport/adapter; only DB, authorization,
  // accounting lifecycle and protocol IO are explicit offline boundary ports.
  for (const scenario of ['reported', 'missing_usage', 'lost_response']) {
    const app = probeApplicationWithBoundaryPorts(), events = [];
    const selected = { ...profile, scopeKind: 'PLATFORM', scopeId: 'platform-a', serviceMode: 'platform_managed' };
    const command = { operationId: `envelope-${scenario}`, profileKey: selected.profileKey,
      profileFingerprint: capabilityProfileFingerprint(selected) };
    const current = structuredClone(require('./fixtures/ai-native/contract-consumer.cjs').contexts[0]);
    current.actor = { kind: 'user', userId: context.actorId }; current.audience = 'operator';
    current.scope = { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId };
    const scope = { id: 'workspace-scope', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId };
    const preparedIntent = textProbeIntent(command.operationId, scope.id);
    const resolution = { context: current, consumerScope: scope, selection: { mode: selected.serviceMode, revision: selected.configRevision },
      scene: 'chat', requiredCapabilities: ['text'], route: { profile: selected, scope: { id: 'platform-a', kind: 'PLATFORM' }, role: 'DEFAULT',
        preflight: { allowed: false, required: ['text'], missing: ['text'], stale: [] }, probe: { purpose: 'capability_text_probe',
          operationId: command.operationId, profileFingerprint: command.profileFingerprint, intentHash: preparedIntent.intentHash } } };
    app.input = { db: { aiTaskExecutionCharge: { findMany: async () => [{ id: 'reserved-call' }] } },
      scopes: { resolveCurrent: async () => ({ context: current, scope }) },
      configuration: { selectionForInvocation: async () => assert.fail('no tenant fallback'), profile: async () => null, credential: async () => null },
      platformConnection: { resolve: async () => ({ profileFingerprint: command.profileFingerprint, baseUrl: 'https://offline.example/v1',
        credential: 'synthetic-secret', maxOutputTokens: 32 }) }, audit: { append: async () => {} } };
    app.authority = () => ({ resolve: async () => structuredClone(resolution), assertCurrent: async () => {},
      authorizeDispatch: async (_context, request) => { assert.equal(request.callId, preparedIntent.intent.requestId); } });
    app.accounting = { bindings: { register: async () => { events.push('register'); return { id: 'invocation', replayed: false }; } },
      budget: { reserve: async () => { events.push('reserve'); return { id: 'reservation' }; }, dispatch: async () => { events.push('dispatch'); },
        recordUsage: async () => {},
        settle: async () => { events.push('settle'); }, abandon: async () => { events.push('unknown'); } } };
    app.admission = { admit: async () => ({ id: 'admission' }) };
    app.dispatch = { claim: async () => { events.push('claim'); }, finish: async (_binding, state) => { events.push(state); } };
    app.receipts = { find: async () => null, begin: async () => ({ created: true, receipt: { id: 'receipt' } }),
      observe: async (_id, _observation, mode) => { assert.equal(mode, 'mock'); events.push('observe'); } };
    app.collect = async () => ({ capability: 'text', status: 'unverified', receiptId: 'receipt' });
    const adapter = new ChatCompletionsAdapter({ post: async () => {
      events.push('protocol'); if (scenario === 'lost_response') throw Error('offline lost response');
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'bounded mock reply' }, finish_reason: 'stop' }],
        ...(scenario === 'reported' ? { usage: { prompt_tokens: 1, completion_tokens: 2 } } : {}) }) };
    } });
    app.adapter = () => adapter;
    const held = await app.prepareHeldInvocationCurrent(command, { stepId: 'step', lease: { runId: 'run', holderId: 'holder', fencingToken: '1' },
      priceVersion: 'price', expiresAt: new Date('2026-10-13T00:00:00Z') });
    const result = await held.execute();
    assert.equal(isGatewayResult(result), true); assert.equal(result.requestId, preparedIntent.intent.requestId);
    assert.equal(result.actual.configId, selected.id); assert.equal(result.evidence, 'mock');
    assert.equal(result.status, scenario === 'lost_response' ? 'unknown' : 'completed');
    assert.equal(result.usage.kind, scenario === 'reported' ? 'reported' : 'unknown');
    assert.equal(events.filter(event => event === 'register').length, 1);
    assert.equal(events.filter(event => event === 'protocol').length, 1);
    assert.equal(events.includes('settle'), scenario === 'reported');
    await assert.rejects(held.execute(), { code: 'ACCOUNTING_PENDING' });
    assert.equal(events.filter(event => event === 'protocol').length, 1);
  }
});

test('probe receipt cache usage retains original categories without adding them to input tokens', () => {
  const { probeUsageSchema } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const original = { inputTokens: 3, outputTokens: 2, billingDetails: { cachedInputTokens: 1, cacheCreationInputTokens: 1 } };
  assert.equal(probeUsageSchema.safeParse(original).success, true);
  assert.deepEqual(probeUsageSchema.parse(original), original);
  assert.equal(probeUsageSchema.safeParse({ ...original, billingDetails: { cachedInputTokens: 3, cacheCreationInputTokens: 1 } }).success, false);
  assert.equal(probeUsageSchema.safeParse({ ...original, billingDetails: { cachedInputTokens: 1 } }).success, false);
  assert.deepEqual(probeUsageSchema.parse({ inputTokens: 1, outputTokens: 2 }), { inputTokens: 1, outputTokens: 2 });
});

test('persisted text verifier consumes original settlement and rejects mock, missing or changed receipts', async () => {
  const { PrismaTextCapabilityReceiptRepository } = require('../apps/api/src/modules/ai-native/prisma-text-capability-receipt.repository');
  const { ProviderCapabilityService } = require('../apps/api/src/modules/ai-native/provider-capability.service');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { textProbeIntent, textProbeConfiguration, textDigest, textProbeEvidenceHash, TEXT_PROBE_METHOD, TEXT_PROBE_TTL_MS } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const now = new Date('2026-10-11T12:00:00.000Z'), prepared = textProbeIntent('probe-operation', 'probe-scope');
  const fingerprint = capabilityProfileFingerprint(profile), configuration = textProbeConfiguration(profile, { kind: 'workspace', tenantId: context.tenantId });
  const descriptor = { command: { operationId: 'probe-operation', profileKey: profile.profileKey, profileFingerprint: fingerprint },
    context, scopeId: 'probe-scope', profileId: profile.id, profileFingerprint: fingerprint, methodVersion: TEXT_PROBE_METHOD,
    callId: prepared.intent.requestId, intentHash: prepared.intentHash, challengeHash: prepared.challengeHash,
    configuration, configurationHash: requestFingerprint(configuration), runId: 'run', stepId: 'step' };
  const observation = { admissionId: 'admission', dispatchId: 'dispatch', requestHash: 'a'.repeat(64), reservationId: 'reservation',
    transport: 'mock', matched: true, responseHash: textDigest(prepared.expected), usage: { inputTokens: 1, outputTokens: 2 },
    checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + TEXT_PROBE_TTL_MS).toISOString() };
  const stored = { id: 'proof', descriptor, descriptorHash: requestFingerprint(descriptor), observation, observationHash: requestFingerprint(observation) };
  const common = { scopeId: descriptor.scopeId, taskId: 'task', actorId: context.actorId, callId: descriptor.callId,
    runId: descriptor.runId, stepId: descriptor.stepId, actionId: 'action', sceneCode: 'ai.capability.text', priceVersion: 'price' };
  const rows = {
    aiGatewayInvocation: { ...common, id: 'invocation', intentHash: descriptor.intentHash, stepFingerprint: requestFingerprint(descriptor.command),
      mode: 'invoke', maxOutputTokens: 32, configuration, configurationHash: descriptor.configurationHash },
    aiInvocationAdmission: { id: 'admission', ...context, scopeKind: 'WORKSPACE', platformDedupKey: null,
      callId: descriptor.callId, requestHash: observation.requestHash,
      profileId: profile.id, dispatchId: 'dispatch', revokedAt: null, status: 'completed', completedAt: now },
    aiGatewayAccountingReceipt: { id: 'accounting', scopeId: descriptor.scopeId, scopeKind: 'WORKSPACE', taskId: 'task',
      tenantId: context.tenantId, workspaceId: context.workspaceId, invocationId: 'invocation', admissionId: 'admission',
      reservationId: 'reservation', dispatchToken: 'dispatch', requestHash: observation.requestHash, state: 'dispatched', inputTokens: 1n, outputTokens: 2n },
    aiBudgetReservation: { ...common, id: 'reservation', scopeKind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId,
      requestId: descriptor.callId, idempotencyKey: descriptor.callId, configRevision: profile.configRevision,
      configurationHash: descriptor.configurationHash, dispatchState: 'completed', status: 'settled', unitKind: 'tokens', actualTokens: 3n }
  };
  rows.aiGatewayAccountingReceipt.usageHash = requestFingerprint({ receiptId: 'accounting', invocationId: 'invocation', admissionId: 'admission',
    reservationId: 'reservation', dispatchToken: 'dispatch', requestHash: observation.requestHash, usage: observation.usage });
  // Original Prisma payload, not a bare hash standing in for settlement.
  rows.aiGatewayAccountingReceipt.usageDetails = null;
  Object.assign(rows.aiBudgetReservation, { billingMode: profile.serviceMode, actualCalls: null, actualMoney: null, moneyCurrency: null });
  let ledger = [{ reservationId: 'reservation', scopeId: descriptor.scopeId, scopeKind: 'WORKSPACE', tenantId: context.tenantId,
    kind: 'settle', inputTokens: 3n, outputTokens: null, calls: null, moneyAmount: null, moneyCurrency: null, reason: null,
    evidenceHash: requestFingerprint({ usageHash: rows.aiGatewayAccountingReceipt.usageHash, priceVersion: 'price', quantity: { unit: 'tokens', value: 3 } }) }];
  const clone = require('./fixtures/ai-native/task-input-store.cjs').clone;
  const db = Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, { findUnique: async ({ where }) =>
    Object.entries(where).every(([key, value]) => row[key] === value) ? clone(row) : null }]));
  db.aiBudgetLedgerEntry = { findMany: async () => clone(ledger) };
  db.$queryRaw = async query => query.values[0] === stored.id ? [structuredClone(stored)] : [];
  db.$transaction = async operation => operation(db);
  const verifier = new PrismaTextCapabilityReceiptRepository(db, () => now);
  const input = () => ({ profile, capability: 'text', status: 'supported', source: 'connection_test',
    evidenceHash: textProbeEvidenceHash(stored), checkedAt: now, expiresAt: new Date(observation.expiresAt),
    details: { receiptId: 'proof', verification: { evidence: 'live', methodVersion: TEXT_PROBE_METHOD, capability: 'text', profileFingerprint: fingerprint } } });
  assert.equal(await verifier.verify(input()), false);
  // A synthetic persisted native receipt tests verification, not a live probe execution.
  observation.transport = 'node_https'; stored.observationHash = requestFingerprint(observation);
  assert.equal(await verifier.verify(input()), true);
  let evidenceRows = [];
  db.aiProviderProfile = { updateMany: async ({ where }) => ({ count: where.id === profile.id && where.configRevision === profile.configRevision ? 1 : 0 }),
    findFirst: async () => structuredClone(profile) };
  db.aiProviderCapabilityEvidence = { findMany: async ({ take }) => {
    assert.equal(take, 9); return structuredClone(evidenceRows);
  }, findUnique: async () => evidenceRows[0] ?? null, upsert: async ({ create }) => {
    evidenceRows = [structuredClone(create)]; return structuredClone(create);
  } };
  const { createPersistedTextCapabilityEvidence } = require('../apps/api/src/modules/ai-native/prisma-text-capability-receipt.repository');
  const capabilities = createPersistedTextCapabilityEvidence(db, () => now);
  assert.equal((await capabilities.record(input())).status, 'supported');
  assert.equal((await capabilities.preflight(profile, ['text'])).allowed, true);
  const originalLedger = structuredClone(ledger), originalReservation = structuredClone(rows.aiBudgetReservation);
  for (const patch of [{ inputTokens: null }, { inputTokens: 4n }, { calls: 1 }, { outputTokens: 2n },
    { reservationId: 'foreign-reservation' }, { scopeId: 'foreign-scope' }, { tenantId: 'foreign-tenant' }, { reason: 'unknown' }]) {
    ledger = [{ ...originalLedger[0], ...patch }];
    assert.equal(await verifier.verify(input()), false, 'a matching hash must not override an inconsistent original ledger payload');
    assert.equal((await capabilities.preflight(profile, ['text'])).allowed, false);
  }
  ledger = originalLedger;
  for (const patch of [{ actualCalls: 1 }, { actualMoney: new (require('@prisma/client').Prisma.Decimal)('0.000000') }, { moneyCurrency: 'USD' }]) {
    Object.assign(rows.aiBudgetReservation, originalReservation, patch);
    assert.equal(await verifier.verify(input()), false, 'a terminal token record must not contain another unit');
  }
  Object.assign(rows.aiBudgetReservation, originalReservation);
  assert.equal(await verifier.verify(input()), true);
  // Calls remain calls; the original token counters are not another financial quantity.
  Object.assign(rows.aiBudgetReservation, { unitKind: 'calls', actualTokens: null, actualCalls: 1 });
  ledger = [{ ...originalLedger[0], inputTokens: null, calls: 1,
    evidenceHash: requestFingerprint({ usageHash: rows.aiGatewayAccountingReceipt.usageHash, priceVersion: 'price', quantity: { unit: 'calls', value: 1 } }) }];
  assert.equal(await verifier.verify(input()), true);
  ledger[0].calls = null; assert.equal(await verifier.verify(input()), false);
  Object.assign(rows.aiBudgetReservation, originalReservation); ledger = originalLedger;
  // Cache categories are part of original inputTokens, never extra tokens or a new price.
  observation.usage = { inputTokens: 3, outputTokens: 2, billingDetails: { cachedInputTokens: 1, cacheCreationInputTokens: 1 } };
  stored.observationHash = requestFingerprint(observation);
  rows.aiGatewayAccountingReceipt.inputTokens = 3n;
  rows.aiGatewayAccountingReceipt.usageDetails = observation.usage.billingDetails;
  rows.aiGatewayAccountingReceipt.usageHash = requestFingerprint({ receiptId: 'accounting', invocationId: 'invocation', admissionId: 'admission',
    reservationId: 'reservation', dispatchToken: 'dispatch', requestHash: observation.requestHash, usage: observation.usage });
  rows.aiBudgetReservation.actualTokens = 5n;
  ledger = [{ ...originalLedger[0], inputTokens: 5n,
    evidenceHash: requestFingerprint({ usageHash: rows.aiGatewayAccountingReceipt.usageHash, priceVersion: 'price', quantity: { unit: 'tokens', value: 5 } }) }];
  assert.equal(await verifier.verify(input()), true);
  rows.aiGatewayAccountingReceipt.usageDetails = { cachedInputTokens: 0, cacheCreationInputTokens: 1 };
  assert.equal(await verifier.verify(input()), false);
  rows.aiGatewayAccountingReceipt.usageDetails = null; assert.equal(await verifier.verify(input()), false);
  rows.aiGatewayAccountingReceipt.usageDetails = observation.usage.billingDetails;
  // Separate synthetic platform-paid fixture, not a conversion or repricing of
  // any real tenant call. A recorded zero is still different from missing money.
  const savedDescriptor = clone(descriptor), savedInvocation = clone(rows.aiGatewayInvocation), savedReservation = clone(rows.aiBudgetReservation);
  const platformProfile = { ...profile, scopeId: 'synthetic-platform-config', scopeKind: 'PLATFORM', serviceMode: 'platform_managed' };
  const platformFingerprint = capabilityProfileFingerprint(platformProfile);
  descriptor.command.profileFingerprint = platformFingerprint; descriptor.profileFingerprint = platformFingerprint;
  descriptor.configuration = textProbeConfiguration(platformProfile, { kind: 'workspace', tenantId: context.tenantId });
  descriptor.configurationHash = requestFingerprint(descriptor.configuration); stored.descriptorHash = requestFingerprint(descriptor);
  Object.assign(rows.aiGatewayInvocation, { configuration: descriptor.configuration, configurationHash: descriptor.configurationHash,
    stepFingerprint: requestFingerprint(descriptor.command) });
  Object.assign(rows.aiBudgetReservation, { billingMode: 'platform_managed', unitKind: 'money', actualTokens: null,
    actualCalls: null, moneyCurrency: 'USD', configurationHash: descriptor.configurationHash });
  for (const amount of ['0.123456', '0.000000']) {
    const money = new (require('@prisma/client').Prisma.Decimal)(amount); rows.aiBudgetReservation.actualMoney = money;
    const event = { ...originalLedger[0], inputTokens: null, moneyAmount: money, moneyCurrency: 'USD',
      evidenceHash: requestFingerprint({ usageHash: rows.aiGatewayAccountingReceipt.usageHash, priceVersion: 'price',
        quantity: { unit: 'money', amount, currency: 'USD', scale: 6 } }) };
    const moneyInput = () => ({ ...input(), profile: platformProfile, details: { receiptId: 'proof', verification: {
      evidence: 'live', methodVersion: TEXT_PROBE_METHOD, capability: 'text', profileFingerprint: platformFingerprint } } });
    ledger = [event]; assert.equal(await verifier.verify(moneyInput()), true);
    for (const patch of [{ moneyAmount: null }, { moneyAmount: new (require('@prisma/client').Prisma.Decimal)('0.999999') },
      { moneyCurrency: 'EUR' }, { inputTokens: 1n }, { calls: 1 }]) {
      ledger = [{ ...event, ...patch }]; assert.equal(await verifier.verify(moneyInput()), false);
    }
    ledger = [event]; rows.aiBudgetReservation.actualMoney = null;
    assert.equal(await verifier.verify(moneyInput()), false); rows.aiBudgetReservation.actualMoney = money;
    rows.aiBudgetReservation.billingMode = 'tenant_managed'; assert.equal(await verifier.verify(moneyInput()), false);
    rows.aiBudgetReservation.billingMode = 'legacy_unknown'; assert.equal(await verifier.verify(moneyInput()), false);
    rows.aiBudgetReservation.billingMode = 'platform_managed';
  }
  Object.assign(descriptor, savedDescriptor); stored.descriptorHash = requestFingerprint(descriptor);
  Object.assign(rows.aiGatewayInvocation, savedInvocation); Object.assign(rows.aiBudgetReservation, savedReservation);
  ledger = [];
  assert.equal((await capabilities.preflight(profile, ['text'])).allowed, false);
  rows.aiInvocationAdmission.status = 'unknown';
  assert.equal(await verifier.verify(input()), false);
  assert.equal(await verifier.verify({ ...input(), profile: { ...profile, configRevision: profile.configRevision + 1 } }), false);
});
