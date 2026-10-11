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

test('current probe host derives identity and rejects changed authority after waiting', async () => {
  const { TextCapabilityProbeApplication } = require('../apps/api/src/modules/ai-native/text-capability-probe.application');
  const app = Object.create(TextCapabilityProbeApplication.prototype);
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

test('probe validates execution before occupying operation key and never redispatches original registration', async () => {
  const { TextCapabilityProbeApplication } = require('../apps/api/src/modules/ai-native/text-capability-probe.application');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const command = { operationId: 'original-probe', profileKey: profile.profileKey, profileFingerprint: capabilityProfileFingerprint(profile) };
  const execution = { stepId: 'step', lease: { runId: 'run', holderId: 'holder', fencingToken: '1' }, priceVersion: 'price-1', expiresAt: new Date('2026-10-12T00:00:00Z') };
  // Exercise the real application's orchestration with boundary ports replaced;
  // no provider or database is contacted and no live provenance is asserted.
  for (const scenario of ['invalid', 'original_registration', 'original_receipt']) {
    let writes = 0, registrations = 0;
    const app = Object.create(TextCapabilityProbeApplication.prototype);
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

test('persisted text verifier consumes original settlement and rejects mock, missing or changed receipts', async () => {
  const { PrismaTextCapabilityReceiptRepository } = require('../apps/api/src/modules/ai-native/prisma-text-capability-receipt.repository');
  const { ProviderCapabilityService } = require('../apps/api/src/modules/ai-native/provider-capability.service');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { textProbeIntent, textProbeConfiguration, textDigest, textProbeEvidenceHash, TEXT_PROBE_METHOD, TEXT_PROBE_TTL_MS } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const now = new Date('2026-10-11T12:00:00.000Z'), prepared = textProbeIntent('probe-operation', 'probe-scope');
  const fingerprint = capabilityProfileFingerprint(profile), configuration = textProbeConfiguration(profile, context.tenantId);
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
    aiGatewayInvocation: { ...common, id: 'invocation', intentHash: descriptor.intentHash, stepFingerprint: descriptor.intentHash,
      mode: 'invoke', maxOutputTokens: 32, configuration, configurationHash: descriptor.configurationHash },
    aiInvocationAdmission: { id: 'admission', ...context, callId: descriptor.callId, requestHash: observation.requestHash,
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
  let ledger = [{ evidenceHash: requestFingerprint({ usageHash: rows.aiGatewayAccountingReceipt.usageHash, priceVersion: 'price', quantity: { unit: 'tokens', value: 3 } }) }];
  const db = Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, { findUnique: async ({ where }) =>
    Object.entries(where).every(([key, value]) => row[key] === value) ? structuredClone(row) : null }]));
  db.aiBudgetLedgerEntry = { findMany: async () => structuredClone(ledger) };
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
  ledger = [];
  assert.equal((await capabilities.preflight(profile, ['text'])).allowed, false);
  rows.aiInvocationAdmission.status = 'unknown';
  assert.equal(await verifier.verify(input()), false);
  assert.equal(await verifier.verify({ ...input(), profile: { ...profile, configRevision: profile.configRevision + 1 } }), false);
});
