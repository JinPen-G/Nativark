'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', lib: ['es2022'], experimentalDecorators: true, emitDecoratorMetadata: true } });
const { taskInputHarness } = require('./fixtures/ai-native/task-input-harness.cjs');

// Real request authority, encrypted resolver, frozen-input reader and budget;
// only Prisma storage and the provider POST are offline substitutes.
async function countingRequestHarness(mode = 'tenant_managed') {
  const { AsyncLocalStorage } = require('node:async_hooks');
  const { AI_TOOL_DRAFT_VERSION } = require('@rental-os/shared');
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { SecretBox } = require('../apps/api/src/common/secret-box');
  const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
  const { tenantModelCredentialReference } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
  const { PrismaGatewayInvocationBindings } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-invocation-bindings');
  const { PrismaGatewayPricingRecords } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-pricing-records');
  const { countTokensSceneCode } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.receipt');
  const { InputCountingRequestFactory } = require('../apps/api/src/modules/ai-native/input-counting/input-counting-request.factory');
  const { requestFingerprint: hash } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const model = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const h = await authorizedRunnerHarness(Object.fromEntries(['aiTaskPlanPolicy', 'aiTaskActionInput', 'aiProviderProfile', 'aiTenantModelConfiguration',
    'systemParameterSet', 'aiPlatformModelConnection', 'aiGatewayPriceRecord', 'aiGatewayInputBoundRecord',
    'aiBudgetReservation', 'aiBudgetAllocation', 'aiBudgetLedgerEntry', 'aiProviderCapability', 'aiProviderCapabilityEvidence'].map(name => [name, []])));
  const active = new AsyncLocalStorage(), transaction = h.db.$transaction.bind(h.db);
  h.db.$transaction = work => active.getStore() ? work(active.getStore()) : transaction(tx => active.run(tx, () => work(tx)));
  h.db.aiPlatformModelConnection.update = async () => { throw Error('unused platform management'); };
  const insertLog = h.db.operationLog.create.bind(h.db.operationLog);
  h.db.operationLog.create = args => {
    if (h.state.operationLog.some(row => row.id === args.data.id)) throw Error('synthetic operation primary-key conflict');
    return insertLog(args);
  };
  h.identity.user.permissions.push('system:params:manage');
  const sceneCode = 'order_explanation', clock = () => new Date(h.control.now);
  h.state.aiTask[0].sceneCode = sceneCode;
  for (const row of h.state.aiBudgetPolicy) {
    row.sceneCode = sceneCode; row.settingsJson.sceneCode = sceneCode; row.settingsJson.allowedScenes = [sceneCode];
  }
  h.state.aiBudgetPolicy.push(...h.state.aiBudgetPolicy.map(row => ({ ...h.clone(row), id: `count-${row.id}`,
    sceneCode: countTokensSceneCode(sceneCode), unitKind: 'calls', priceVersion: 'count-price',
    settingsJson: { ...h.clone(row.settingsJson), sceneCode: countTokensSceneCode(sceneCode), allowedScenes: [countTokensSceneCode(sceneCode)] } })));
  const key = 'synthetic-count-credential-only', secrets = new SecretBox({ get: () => 'synthetic-count-encryption-only' });
  const credentialRef = tenantModelCredentialReference('tenant-a', 1);
  h.state.aiTenantModelConfiguration.push({ tenantId: 'tenant-a', revision: 1, mode: 'tenant_managed', serviceEnabled: true,
    settings: { enabled: true, protocol: 'anthropic_messages', baseUrl: 'https://count.example.test', model: 'synthetic-model',
      timeoutMs: 10000, maxConcurrent: 1, maxOutputTokens: 32 }, credentialsEncrypted: secrets.encrypt({ apiKey: key,
      tenantId: 'tenant-a', protocol: 'anthropic_messages', baseUrl: 'https://count.example.test', model: 'synthetic-model' }) });
  h.state.aiProviderProfile.push({ id: 'profile-a', scopeId: 'scope-tenant', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
    configRevision: 1, credentialRef, protocol: 'anthropic_messages', provider: 'anthropic_messages', model: 'synthetic-model',
    serviceMode: 'tenant_managed', allowedCapabilities: ['text'], enabled: true, disabledAt: null });
  const config = { configId: 'profile-a', configRevision: 1, credentialRef, protocol: 'anthropic_messages', provider: 'anthropic_messages',
    model: 'synthetic-model', serviceMode: 'tenant_managed', tenantId: 'tenant-a', configurationScope: { kind: 'tenant', tenantId: 'tenant-a' } };
  if (mode === 'platform_managed') {
    const { createHash } = require('node:crypto');
    const profile = h.state.aiProviderProfile[0], baseUrl = 'https://platform-count.example.test';
    const ref = `platform-model:${createHash('sha256').update(profile.id).digest('hex')}:1`;
    Object.assign(profile, { scopeId: 'scope-platform', scopeKind: 'PLATFORM', serviceMode: mode, credentialRef: ref,
      platformConnection: { profileId: profile.id, configRevision: 1, baseUrl, maxOutputTokens: 32,
        credentialsEncrypted: secrets.encrypt({ profileId: profile.id, scopeId: 'scope-platform', revision: '1',
          protocol: profile.protocol, model: profile.model, baseUrl, apiKey: key }) } });
    Object.assign(config, { credentialRef: ref, serviceMode: mode, configurationScope: { kind: 'platform' } });
    h.state.aiTenantModelConfiguration[0].mode = mode;
  }
  const authorization = composePersistedTaskAuthorization({ ...h.authorization, db: h.db, clock });
  const context = await authorization.execution.authorize('task-a');
  const policy = { sceneCode, maxOutputTokens: 32, orderExplainTool: true };
  const intent = model.taskModelIntent('task-a', 'run-a', 'clarify', sceneCode,
    { messages: [{ role: 'user', content: [{ kind: 'text', text: 'Original frozen question' }] }], maxOutputTokens: 32 });
  const payload = { mode: 'invoke', intent, configuration: config, priceVersion: 'generation-price',
    routingHash: 'e'.repeat(64), identityHash: model.taskModelIdentity(context) };
  const fingerprint = model.taskModelFingerprint(payload, policy), expiresAt = new Date(clock().getTime() + 60000);
  h.state.aiTaskActionInput.push({ id: 'count-input', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a',
    toolCode: 'ai.model.text', toolVersion: AI_TOOL_DRAFT_VERSION, fingerprint, payload, expiresAt });
  h.state.aiStep.push({ id: 'count-step', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', actionId: 'count-action', revision: 1,
    status: 'RUNNING', toolCode: 'ai.model.text', toolVersion: AI_TOOL_DRAFT_VERSION, inputRef: 'count-input', requestFingerprint: fingerprint });
  Object.assign(h.state.aiRun[0], { status: 'RUNNING', leaseOwnerId: 'count-worker', leaseExpiresAt: expiresAt });
  const binding = await new PrismaGatewayInvocationBindings(h.db, authorization.scopes, clock, policy).register({ stepId: 'count-step',
    mode: 'invoke', lease: { runId: 'run-a', holderId: 'count-worker', fencingToken: h.state.aiRun[0].fencingToken.toFixed(0) },
    intent, configuration: config, priceVersion: 'generation-price', expiresAt });
  const price = { kind: 'gateway-price-1', priceVersion: 'generation-price', configuration: config,
    usageClass: 'plain_text_input_output_tokens', additionalBillingDimensions: 'none', validFrom: clock().toISOString(), expiresAt: expiresAt.toISOString(),
    billing: { unit: 'tokens', metric: 'input_plus_output', scale: 0, rounding: 'exact' },
    provenance: { reference: 'synthetic-reviewed-rate', revision: '1', documentHash: 'a'.repeat(64) } };
  const records = new PrismaGatewayPricingRecords(h.db);
  h.state.aiGatewayPriceRecord.push({ id: records.priceId('scope-a', hash(config), price.priceVersion), scopeId: 'scope-a',
    configurationHash: hash(config), priceVersion: price.priceVersion, payload: price, payloadHash: hash(price), sourceReference: price.provenance.reference });
  const effects = { sent: [], decrypts: 0, beforeDecrypt: null, reply: { status: 200, body: '{"input_tokens":12}' } };
  const server = { db: h.db, auth: h.authorization.auth, guard: new ApiAuthGuard(h.authorization.auth), subscriptions: h.authorization.subscriptions, clock,
    connectionConfiguration: { db: h.db, platformProfileId: 'platform-default', secrets: {
      encrypt: secrets.encrypt.bind(secrets), decrypt: value => { effects.decrypts++; effects.beforeDecrypt?.(); return secrets.decrypt(value); } } },
    configuration: { sceneCode, sceneMaxOutputTokens: 32, countingPriceVersion: 'count-price', timeoutMs: 10000,
      toolPolicy: { orderExplainTool: { name: 'rental_order_explain', version: AI_TOOL_DRAFT_VERSION } } },
    transport: { post: async packet => { assert.equal(packet.signal.aborted, false); assert.equal(packet.headers['x-api-key'], key);
      effects.sent.push({ url: packet.url, body: packet.body }); return structuredClone(effects.reply); } } };
  const request = { headers: { authorization: (await h.authorization.credentials.current()).authorization } };
  return { ...h, server, effects, request, binding, command: { callId: intent.requestId }, factory: new InputCountingRequestFactory(server) };
}

test('standard counting factory binds encrypted dispatch, original receipt and history without redispatch', { timeout: 60000 }, async t => {
  const { AiInputCountingController, AiInputCountingModule } = require('../apps/api/src/modules/ai-native/input-counting/input-counting-request.module');
  const { composeStandardInputCounting } = require('../apps/api/src/modules/ai-native/input-counting/input-counting-standard.application');
  const h = await countingRequestHarness();
  const egress = require('../apps/api/src/modules/ai-native/model-egress.transport');
  t.mock.method(egress, 'createNativeModelEgressTransport', () => h.server.transport);
  const deps = { db: h.db, auth: h.server.auth, guard: h.server.guard, subscriptions: h.server.subscriptions,
    clock: h.server.clock, secrets: h.server.connectionConfiguration.secrets };
  const beforeConstruction = h.trace.length;
  const standard = composeStandardInputCounting(deps, { enabled: true, sceneCode: 'order_explanation', sceneMaxOutputTokens: 32,
    countingPriceVersion: 'count-price', platformProfileId: 'platform-default', timeoutMs: 10000 });
  assert.equal(h.trace.length, beforeConstruction); assert.equal(h.effects.decrypts, 0);
  const controller = new AiInputCountingController(standard);
  const receipt = await controller.count(h.request, h.command);
  assert.equal(receipt.state, 'observed'); assert.equal(receipt.inputTokens, 12); assert.equal(receipt.admission.status, 'settled');
  assert.equal(h.effects.sent.length, 1); assert.ok(h.effects.decrypts > 0);
  assert.equal(h.state.aiBudgetReservation.length, 1); assert.equal(h.state.aiBudgetReservation[0].actualCalls, 1);
  assert.equal(h.state.aiBudgetAllocation.length, 3); assert.equal(h.state.aiGatewayInvocation.length, 1);
  assert.match(h.effects.sent[0].url, /\/v1\/messages\/count_tokens$/u);
  assert.equal((await controller.count(h.request, h.command)).receiptId, receipt.receiptId);
  const published = await controller.publishInputBound(h.request, { ...h.command, reference: receipt.reference });
  assert.equal(h.state.aiGatewayInputBoundRecord.length, 1);
  const baseline = { writes: h.trace.filter(line => /\.(create|update|upsert|createMany)$/u.test(line)).length, sent: h.effects.sent.length, decrypts: h.effects.decrypts };
  const historyDeps = { ...deps, secrets: {
    encrypt() { throw Error('history must not encrypt'); }, decrypt() { throw Error('history must not decrypt'); } } };
  const historical = new AiInputCountingController(composeStandardInputCounting(historyDeps));
  h.state.aiProviderProfile[0].enabled = false; h.state.aiTenantModelConfiguration[0].serviceEnabled = false;
  h.state.subscriptionFeatureCatalog[0].releaseStatus = 'PLANNED';
  assert.equal((await historical.receipt(h.request, h.command)).receiptId, receipt.receiptId);
  assert.equal((await historical.readInputBound(h.request, h.command)).id, published.id);
  assert.deepEqual((await historical.observe(h.request, h.command)).lifecycle, { receiptRecorded: 'observed' });
  await assert.rejects(historical.count(h.request, h.command), e => e.getStatus() === 503);
  await assert.rejects(historical.publishInputBound(h.request, { ...h.command, reference: receipt.reference }), e => e.getStatus() === 503);
  assert.deepEqual({ writes: h.trace.filter(line => /\.(create|update|upsert|createMany)$/u.test(line)).length, sent: h.effects.sent.length, decrypts: h.effects.decrypts }, baseline);
  h.identity.session = false;
  await assert.rejects(historical.receipt(h.request, h.command), e => e.getStatus() === 403);
  assert.deepEqual(AiInputCountingModule.registerHttp(undefined).controllers, []);
  for (const value of [{ enabled: false, sceneCode: 'order_explanation' }, { enabled: true }, { enabled: true, sceneCode: 'forged' }])
    assert.throws(() => composeStandardInputCounting(deps, value), e => e.code === 'UNAVAILABLE');
  const fs = require('node:fs'), app = fs.readFileSync(require('node:path').join(__dirname, '../apps/api/src/app.module.ts'), 'utf8');
  assert.match(app, /controllers:\s*\[[\s\S]*?\bAiInputCountingController\b/u);
  assert.match(app, /providers:\s*\[[\s\S]*?\bAI_NATIVE_INPUT_COUNTING_PROVIDER\b/u);
});

test('standard counting refuses forged input and revoked or aborted request-local connections', { timeout: 60000 }, async () => {
  const { AiInputCountingController } = require('../apps/api/src/modules/ai-native/input-counting/input-counting-request.module');
  const { InputCountingRequestFactory } = require('../apps/api/src/modules/ai-native/input-counting/input-counting-request.factory');
  for (const mode of ['revoked', 'aborted']) {
    const h = await countingRequestHarness(), abort = new AbortController(), controller = new AiInputCountingController(h.factory);
    await assert.rejects(controller.count(h.request, { ...h.command, taskId: 'other-task' }), e => e.getStatus() === 400);
    await assert.rejects(controller.count(h.request, { ...h.command, configuration: {} }), e => e.getStatus() === 400);
    assert.equal(h.effects.decrypts, 0); assert.equal(h.state.aiBudgetReservation.length, 0);
    h.effects.beforeDecrypt = () => mode === 'revoked' ? h.identity.session = false : abort.abort();
    await assert.rejects(h.factory.call(h.request, 'count', h.command, abort.signal), e => e.code === 'PENDING_RECONCILIATION');
    assert.equal(h.effects.sent.length, 0); assert.equal(h.state.aiBudgetReservation.length, 1);
    assert.equal(h.state.aiBudgetReservation[0].dispatchState, 'not_dispatched');
    h.identity.session = true; h.effects.beforeDecrypt = null;
    await assert.rejects(h.factory.call(h.request, 'count', h.command), e => e.code === 'PENDING_RECONCILIATION');
    assert.equal(h.effects.sent.length, 0, 'the original dispatch claim is never replaced');
    assert.equal(h.state.aiBudgetReservation.length, 1);
    assert.throws(() => new InputCountingRequestFactory({ ...h.server, resolvers: { tenant: { resolve() {} }, platform: { resolve() {} } } }), e => e.code === 'UNAVAILABLE');
  }
});

test('standard counting platform connection follows current tenant selection and retains unknown provider results', { timeout: 60000 }, async () => {
  const good = await countingRequestHarness('platform_managed');
  const result = await good.factory.call(good.request, 'count', good.command);
  assert.equal(result.state, 'observed'); assert.equal(good.effects.sent.length, 1);
  assert.equal(good.effects.sent[0].url, 'https://platform-count.example.test/v1/messages/count_tokens');
  const changed = await countingRequestHarness('platform_managed');
  changed.effects.beforeDecrypt = () => { changed.state.aiTenantModelConfiguration[0].mode = 'tenant_managed'; };
  await assert.rejects(changed.factory.call(changed.request, 'count', changed.command), e => e.code === 'PENDING_RECONCILIATION');
  assert.equal(changed.effects.sent.length, 0); assert.equal(changed.state.aiBudgetReservation.length, 1);
  const unknown = await countingRequestHarness('platform_managed');
  unknown.effects.reply = { status: 503, body: '{}' };
  assert.equal((await unknown.factory.call(unknown.request, 'count', unknown.command)).state, 'unknown');
  assert.equal((await unknown.factory.call(unknown.request, 'count', unknown.command)).state, 'unknown');
  assert.equal(unknown.effects.sent.length, 1); assert.equal(unknown.state.aiBudgetReservation.length, 1);
  assert.equal(unknown.state.aiBudgetReservation[0].status, 'pending_reconciliation');
});

for (const mode of ['observed', 'unknown', 'aborted']) test(`recorded task host ${mode} preserves original counting and generation meters`, { timeout: 60000 }, async t => {
  const h = await countingRequestHarness();
  const { composePersistedTaskModelHost, composePersistedTaskGateway } = require('../apps/api/src/modules/ai-native/task-model-gateway.composition');
  const { AI_TOOL_DRAFT_VERSION } = require('@rental-os/shared');
  const egress = require('../apps/api/src/modules/ai-native/model-egress.transport');
  const capabilities = require('../apps/api/src/modules/ai-native/prisma-text-capability-receipt.repository');
  // Explicit capability proof substitute: this exercises orchestration, not a live supplier probe.
  t.mock.method(capabilities, 'createPersistedTextCapabilityEvidence', () => ({ preflight: async (_profile, required) =>
    ({ allowed: true, required, missing: [], stale: [] }) }));
  let modelPosts = 0;
  const abort = new AbortController();
  if (mode === 'unknown') h.effects.reply = { status: 503, body: '{}' };
  t.mock.method(egress, 'createNativeModelEgressTransport', () => ({ post: async packet => {
    if (packet.url.endsWith('/count_tokens')) {
      const result = await h.server.transport.post(packet);
      if (mode === 'aborted') abort.abort();
      return result;
    }
    modelPosts++;
    assert.equal(h.state.aiBudgetReservation.length, 2);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 1n);
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 1n);
    return { status: 200, body: JSON.stringify({ id: 'synthetic-message', type: 'message', role: 'assistant', model: 'synthetic-model',
      content: [{ type: 'text', text: 'Original counted response' }], stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 2 } }) };
  } }));
  const gateway = { secrets: h.server.connectionConfiguration.secrets, platformProfileId: 'platform-default', routeScene: 'chat',
    pricing: { kind: 'recorded', priceVersion: 'generation-price' }, nativeProtocol: 'anthropic_messages',
    inputCounting: { countingPriceVersion: 'count-price', timeoutMs: 10000 } };
  const common = { ...h.authorization, db: h.db, guard: h.server.guard, clock: h.server.clock };
  assert.throws(() => composePersistedTaskGateway({ ...common, ...gateway, taskId: 'task-a', pricing: { kind: 'calls', priceVersion: 'calls' } }), e => e.code === 'CONFIG_INVALID');
  h.state.aiProviderProfile[0].allowedCapabilities = ['text', 'tools'];
  for (const table of ['aiTaskActionInput', 'aiStep', 'aiGatewayInvocation', 'aiTaskRunPlan']) h.state[table].length = 0;
  Object.assign(h.state.aiRun[0], { sequence: 1, leaseOwnerId: null, leaseExpiresAt: null });
  for (const row of h.state.aiBudgetPolicy.filter(row => row.sceneCode === 'order_explanation')) {
    row.unitKind = 'tokens'; row.settingsJson.budget = { state: 'limited', quantity: { unit: 'tokens', value: 1000 } };
  }
  const limits = { ...h.plan.limits, maxCalls: 2, maxSteps: 1, maxStepMs: 15000, maxTotalMs: 20000, maxOutputBytes: 20000 };
  h.state.aiTaskPlanPolicy.push({ scopeId: 'scope-a', sceneCode: 'order_explanation', sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [{ code: 'ai.model.text', version: AI_TOOL_DRAFT_VERSION }], limits, expiresAt: new Date('2027-01-01') });
  const hostInput = { ...common, gateway, scene: { code: 'order_explanation', version: '1' },
    gatewayScene: { sceneCode: 'order_explanation', routeScene: 'chat', maxOutputTokens: 32, orderExplainTool: true },
    host: { holderId: 'recorded-worker', leaseMs: 100000 }, inputSource: h.source,
    task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'summary-counted', limits,
      material: { messages: [{ role: 'user', content: [{ kind: 'text', text: 'Original counted question' }] }], maxOutputTokens: 32 } } };
  const root = composePersistedTaskModelHost(hostInput);
  // No settings privilege is needed once the task's own action/plan policy is provisioned.
  h.identity.user.permissions = h.identity.user.permissions.filter(value => value !== 'system:params:manage');
  const outcome = await root.application.start({ taskId: 'task-a', runId: 'run-a' }, abort.signal);
  assert.equal(outcome.kind, 'run_outcome', JSON.stringify(outcome));
  if (mode !== 'observed') {
    assert.equal(outcome.outcome.status, 'unknown', JSON.stringify(outcome));
    assert.equal(h.effects.sent.length, 1); assert.equal(modelPosts, 0);
    assert.equal(h.state.aiGatewayInputBoundRecord.length, 0);
    assert.equal(h.state.aiBudgetReservation.length, 1); assert.notEqual(h.state.aiBudgetReservation[0].status, 'released');
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 2n);
    const invocation = h.clone(h.state.aiGatewayInvocation[0]);
    const recovered = await composePersistedTaskModelHost(hostInput).recoverOriginal();
    assert.equal(recovered.kind, 'run_outcome'); assert.equal(recovered.outcome.status, 'unknown');
    assert.equal(h.effects.sent.length, 1); assert.equal(modelPosts, 0);
    assert.deepEqual(h.state.aiGatewayInvocation[0], invocation);
    assert.equal(h.state.aiTaskExecutionBudget.length, 1);
    return;
  }
  assert.equal(outcome.outcome.status, 'succeeded', JSON.stringify(outcome));
  assert.equal(h.effects.sent.length, 1); assert.equal(modelPosts, 1);
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.state.aiGatewayInputBoundRecord.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  assert.deepEqual(h.state.aiBudgetReservation.map(row => [row.unitKind, row.status]).sort(), [['calls', 'settled'], ['tokens', 'settled']]);
  assert.equal(h.state.aiBudgetReservation.find(row => row.unitKind === 'tokens').actualTokens, 14n);
});

test('actual persistent runner continues a second step within cumulative output budget', async () => {
  const h = await taskInputHarness();
  const result = await h.make().runner.run(h.claim());
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 20n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedOutputBytes, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes,
    h.state.aiTaskResultArtifact.reduce((n, artifact) => n + artifact.outputBytes, 0n));
});

test('exhausted cumulative output prevents the next effect without resetting any counters', async () => {
  const h = await taskInputHarness();
  h.control.execute = async () => ({ kind: 'succeeded', payload: 'x'.repeat(4094) });
  await assert.rejects(h.make().runner.run(h.claim()), e => e.code === 'AI_RUN_LIMIT');
  assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes, 4096n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedOutputBytes, 0n);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
});

// Actual runner/resource/evidence repositories; invocation preparation, provider
// outcomes and financial dispatch reader are explicit offline doubles, not live I/O.
async function countedModelHarness(mode = 'observed', maxCalls = 2) {
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const { requestFingerprint: hash } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { CountingTaskModelInvocationPreparation } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.task-bound');
  const { PrismaCountTokensReceipts, countTokensCallId, countTokensSceneCode } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.receipt');
  const h = await taskInputHarness({ aiScope: [{ id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'workspace-a', scopeKey: 'workspace:8:tenant-a:11:workspace-a' }], aiBudgetReservation: [], aiTaskActionInput: [] });
  const abort = new AbortController(), counts = [], generations = [];
  const config = { configId: 'profile-a', configRevision: 1, credentialRef: 'synthetic-vault', protocol: 'anthropic_messages',
    provider: 'synthetic', model: 'synthetic-model', serviceMode: 'tenant_managed', tenantId: 'tenant-a', configurationScope: { kind: 'tenant', tenantId: 'tenant-a' } };
  const { AI_TOOL_DRAFT_VERSION } = require('@rental-os/shared');
  const model = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const policy = { sceneCode: 'synthetic-clarification', maxOutputTokens: 32 };
  const intent = model.taskModelIntent('task-a', 'run-a', 'clarify', policy.sceneCode,
    { messages: [{ role: 'user', content: [{ kind: 'text', text: 'Synthetic bounded input' }] }], maxOutputTokens: 32 });
  const body = { mode: 'invoke', intent, configuration: config, priceVersion: 'generation-price',
    routingHash: 'e'.repeat(64), identityHash: model.taskModelIdentity(h.context()) };
  const fingerprint = model.taskModelFingerprint(body, policy);
  h.state.aiTaskActionInput.push({ id: 'input-clarify', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a',
    registrationRef: 'clarify', toolCode: 'ai.model.text', toolVersion: AI_TOOL_DRAFT_VERSION, payload: body,
    fingerprint, expiresAt: new Date(h.control.now.getTime() + 100000) });
  const registration = h.registrationAuthority.resolve;
  h.registrationAuthority.resolve = async command => ({ ...await registration(command), toolCode: 'ai.model.text', toolVersion: AI_TOOL_DRAFT_VERSION, requestFingerprint: fingerprint });
  h.plan.steps = [{ registrationRef: 'clarify', operation: 'external_unknown', toolCode: 'ai.model.text', toolVersion: AI_TOOL_DRAFT_VERSION }];
  h.plan.limits.maxCalls = maxCalls;
  Object.assign(h.state.aiTaskRunPlan[0], { payload: h.clone(h.plan), planHash: hash(h.plan) });
  const invocations = new CountingTaskModelInvocationPreparation({ prepare: async (ref, lease, signal) => {
    assert.equal(signal.aborted, false);
    const step = h.state.aiStep.find(row => row.id === ref.registered.stepId);
    const invocation = await h.db.aiGatewayInvocation.create({ data: { id: 'invocation-a', scopeId: 'scope-a', taskId: 'task-a',
      runId: 'run-a', stepId: step.id, actionId: step.actionId, stepFingerprint: step.requestFingerprint, actorId: 'user-a',
      callId: intent.requestId, sceneCode: 'synthetic-clarification', mode: 'invoke', intentHash: fingerprint, registrationHash: 'a'.repeat(64),
      configuration: config, configurationHash: hash(config), priceVersion: 'generation-price', maxOutputTokens: 32,
      leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), expiresAt: new Date(lease.expiresAt) } });
    if (mode === 'registration_abort') abort.abort();
    return { invocationId: invocation.id };
  } }, { taskCount: async (_command, signal) => {
    assert.equal(signal.aborted, false);
    assert.equal(h.state.aiTaskResultArtifact.length, 1);
    assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 2n);
    counts.push('count'); h.control.tick += 10;
    const invocation = h.state.aiGatewayInvocation[0], countCallId = countTokensCallId(invocation.callId);
    const receipt = { version: 'ai-count-tokens-receipt-1', state: mode === 'unknown' ? 'unknown' : 'observed',
      tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'user-a', callId: invocation.callId, countCallId,
      invocationId: invocation.id, scopeId: 'scope-a', sceneCode: invocation.sceneCode, protocol: config.protocol, model: config.model,
      registrationHash: invocation.registrationHash, intentHash: invocation.intentHash, configurationHash: invocation.configurationHash,
      priceVersion: invocation.priceVersion, maxOutputTokens: 32, method: 'provider_count_tokens_receipt', countRequestHash: 'c'.repeat(64),
      admission: { reservationId: 'count-budget', sceneCode: countTokensSceneCode(invocation.sceneCode), unit: 'calls' },
      observedAt: h.control.now.toISOString(), expiresAt: new Date(h.control.now.getTime() + 60000).toISOString(),
      ...(mode === 'unknown' ? {} : { inputTokens: 12 }) };
    await h.db.aiBudgetReservation.create({ data: { id: 'count-budget', scopeId: 'scope-a', scopeKind: 'WORKSPACE',
      tenantId: receipt.tenantId, workspaceId: receipt.workspaceId, actorId: receipt.actorId, callId: countCallId,
      requestId: countCallId, idempotencyKey: countCallId, runId: invocation.runId, stepId: invocation.stepId, actionId: invocation.actionId,
      sceneCode: receipt.admission.sceneCode, priceVersion: 'count-price', configurationHash: hash(config), configRevision: 1,
      unitKind: 'calls', reservedCalls: 1, actualCalls: mode === 'unknown' ? null : 1,
      status: mode === 'unknown' ? 'pending_reconciliation' : 'settled', dispatchState: mode === 'unknown' ? 'unknown' : 'completed' } });
    const receipts = new PrismaCountTokensReceipts(h.db);
    await receipts.claimDispatch({ tenantId: receipt.tenantId, workspaceId: receipt.workspaceId, actorId: receipt.actorId,
      callId: receipt.callId, reservationId: receipt.admission.reservationId, registrationHash: receipt.registrationHash,
      intentHash: receipt.intentHash, configurationHash: receipt.configurationHash, countRequestHash: receipt.countRequestHash });
    await receipts.append(receipt);
    if (mode === 'abort') abort.abort();
    return receipt;
  }, publish: async () => { assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 1n); } });
  const configuration = { ...h.configuration(), invocations, toolCatalog: { resolve: async () => ({ modelCall: true }) },
    financialEvidence: { readDispatch: async () => ({ state: 'dispatched', reservationId: 'generation-budget', requestId: intent.requestId,
      callId: intent.requestId, actorId: 'user-a', scopeKey: 'WORKSPACE:scope-a', runId: 'run-a', stepId: h.state.aiStep[0].id,
      actionId: h.state.aiStep[0].actionId, sceneCode: 'synthetic-clarification', priceVersion: 'generation-price',
      configurationHash: hash(config), configRevision: 1, dispatchToken: 'generation-dispatch' }) },
    executors: { resolve: async () => ({ operation: 'external_unknown', execute: async () => {
      generations.push('generation'); h.control.tick += 10;
      await h.db.aiGatewayAccountingReceipt.create({ data: { scopeId: 'scope-a', scopeKind: 'WORKSPACE', taskId: 'task-a',
        invocationId: 'invocation-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', reservationId: 'generation-budget',
        admissionId: 'generation-admission', dispatchToken: 'generation-dispatch', requestHash: 'd'.repeat(64), state: 'dispatched' } });
      await h.db.aiInvocationAdmission.create({ data: { id: 'generation-admission', tenantId: 'tenant-a', workspaceId: 'workspace-a',
        actorId: 'user-a', callId: intent.requestId, requestHash: 'd'.repeat(64), profileId: config.configId,
        dispatchId: 'generation-dispatch', status: 'completed', revokedAt: null } });
      return { kind: 'succeeded', payload: { draftVersion: 'ain-c03-draft-2', requestId: intent.requestId,
        actual: config, evidence: 'mock', status: 'completed', text: 'Synthetic response', toolRequests: [],
        usage: { kind: 'reported', inputTokens: 12, outputTokens: 2 } } };
    } }) } };
  const { PrismaModelStepEvidenceAuthority } = require('../apps/api/src/modules/ai-native/model-input/prisma-model-step-evidence.authority');
  const { AiStepTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-step-transition.repository');
  configuration.transitions = new AiStepTransitionRepository(h.db,
    new PrismaModelStepEvidenceAuthority(h.db, h.taskAuthority, h.planAuthority, policy, configuration.financialEvidence,
      () => new Date(h.control.now)), () => new Date(h.control.now));
  const root = require('../apps/api/src/modules/ai-native/runner/persistent-task-runner.composition').composePersistentTaskRunner(configuration);
  return { ...h, root, counts, generations, abort };
}

test('counted model consumes two persistent CALLS with one marker and exact count replay', async () => {
  const h = await countedModelHarness();
  assert.equal((await h.root.runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.counts, ['count']); assert.deepEqual(h.generations, ['generation']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  assert.equal(h.state.aiTaskExecutionCharge.length, 5);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
  assert.equal(h.state.aiTaskResultArtifact.length, 1);
  assert.equal(h.state.aiTaskResultArtifact[0].activeMs, 20n);
});

for (const mode of ['unknown', 'abort']) test(`count ${mode} keeps its original marker and never generates`, async () => {
  const h = await countedModelHarness(mode);
  assert.equal((await h.root.runner.run(h.claim(), h.abort.signal)).status, 'unknown');
  assert.deepEqual(h.counts, ['count']); assert.deepEqual(h.generations, []);
  assert.equal(h.state.aiTaskResultArtifact.length, 1);
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 2n);
  const original = h.clone(h.state.aiGatewayInvocation[0]);
  assert.equal((await h.root.runner.run({ ...h.claim(), recovery: true })).status, 'unknown');
  assert.deepEqual(h.counts, ['count']); assert.deepEqual(h.generations, []);
  assert.deepEqual(h.state.aiGatewayInvocation[0], original);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, mode === 'abort' ? 1n : 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, mode === 'abort' ? 1n : 2n);
});

test('registration acknowledged before CALLS interruption retains the original unresolved invocation', async () => {
  const h = await countedModelHarness('registration_abort');
  assert.equal((await h.root.runner.run(h.claim(), h.abort.signal)).status, 'unknown');
  assert.equal(h.state.aiGatewayInvocation.length, 1);
  assert.equal(h.state.aiTaskExecutionCharge.length, 3);
  const original = h.clone(h.state.aiGatewayInvocation[0]);
  assert.equal(h.state.aiStep[0].status, 'UNKNOWN');
  assert.equal((await h.root.runner.run({ ...h.claim(), recovery: true })).status, 'unknown');
  assert.deepEqual(h.state.aiGatewayInvocation[0], original);
  assert.deepEqual(h.counts, []); assert.deepEqual(h.generations, []);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
});

test('one remaining task CALLS allowance prevents both count and generation', async () => {
  const h = await countedModelHarness('observed', 1);
  assert.equal((await h.root.runner.run(h.claim())).status, 'unknown');
  assert.deepEqual(h.counts, []); assert.deepEqual(h.generations, []);
  assert.equal(h.state.aiTaskResultArtifact.length, 1);
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
});

test('two workers cannot claim and execute the same remaining steps', async () => {
  const h = await taskInputHarness(), claim = h.claim();
  const results = await Promise.allSettled([h.make().runner.run(claim), h.make().runner.run({ ...claim, holderId: 'workerId-b' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'AI_REVISION_CONFLICT').length, 1);
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
});
