'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', lib: ['es2022'], experimentalDecorators: true, emitDecoratorMetadata: true } });
const { taskInputHarness } = require('./fixtures/ai-native/task-input-harness.cjs');

test('original native tool-result selectors bind encrypted calls and authorized receipts without dispatch', async () => {
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
  const { AiScopeRepository } = require('../apps/api/src/modules/ai-native/ai-scope.repository');
  const { SecretBox } = require('../apps/api/src/common/secret-box');
  const { PrismaNativeToolCallBindings } = require('../apps/api/src/modules/ai-native/model-input/prisma-native-tool-call-bindings');
  const { OriginalNativeToolResultSource } = require('../apps/api/src/modules/ai-native/model-input/original-native-tool-result.source');
  const { nativeToolResultReferenceSchema } = require('../apps/api/src/modules/ai-native/model-input/native-tool-result.ports');
  const model = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const shared = require('@rental-os/shared');
  const { requestFingerprint: hash } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const h = await authorizedRunnerHarness(Object.fromEntries(['aiTaskActionInput', 'aiGatewayToolCallBinding',
    'aiProviderProfile', 'aiPlatformModelConnection', 'systemParameterSet', 'aiBudgetReservation',
    'aiBudgetAllocation', 'aiBudgetLedgerEntry', 'aiTextCapabilityReceipt', 'aiProviderCapabilityEvidence'].map(name => [name, []])));
  const clock = () => new Date(h.control.now);
  const authorization = composePersistedTaskAuthorization({ ...h.authorization, db: h.db, clock });
  await authorization.tasks.claimRun(h.claim());
  const context = await authorization.execution.authorize('task-a');
  const scope = new AiScopeRepository(h.db, { resolve: () => authorization.execution.authorize('task-a') }, clock);
  const secrets = new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-native-tool-encryption-only' : undefined });
  const policy = { sceneCode: 'synthetic-clarification', maxOutputTokens: 32, orderExplainTool: true, nativeToolResults: true };
  const configuration = { configId: 'native-profile', configRevision: 1, credentialRef: 'native-credential',
    protocol: 'openai_chat_completions', provider: 'synthetic-provider', model: 'synthetic-model', tenantId: 'tenant-a',
    serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: 'tenant-a' } };
  const intent = model.taskModelIntent('task-a', 'run-a', 'native-parent', policy.sceneCode,
    { messages: [{ role: 'user', content: [{ kind: 'text', text: 'Read the original order' }] }], maxOutputTokens: 32 }, undefined, true);
  const input = { mode: 'invoke', intent, configuration, priceVersion: 'native-price', routingHash: 'a'.repeat(64), identityHash: model.taskModelIdentity(context) };
  const fingerprint = model.taskModelFingerprint(input, policy);
  const candidate = { contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, toolCode: 'rental.order.explain',
    toolVersion: shared.AI_TOOL_DRAFT_VERSION, input: { orderId: 'order-a' } };
  const parent = { id: 'native-parent-step', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', sequence: 1,
    toolCode: shared.AI_TEXT_MODEL_STEP_CODE, toolVersion: shared.AI_TOOL_DRAFT_VERSION,
    actionId: 'native-parent-action', inputRef: 'native-parent-input', requestFingerprint: fingerprint, status: 'RUNNING', resultRef: null };
  h.state.aiTaskActionInput.push({ scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', id: parent.inputRef,
    registrationRef: 'native-parent', toolCode: parent.toolCode, toolVersion: parent.toolVersion, payload: input, fingerprint });
  h.state.aiStep.push(parent);
  const held = h.state.aiRun[0];
  h.state.aiGatewayInvocation.push({ id: 'native-invocation', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a',
    stepId: parent.id, actionId: parent.actionId, actorId: 'user-a', stepFingerprint: fingerprint,
    callId: intent.requestId, mode: 'invoke', configuration, configurationHash: hash(configuration),
    registrationHash: 'b'.repeat(64), leaseOwnerId: held.leaseOwnerId, fencingToken: held.fencingToken,
    expiresAt: new Date(held.leaseExpiresAt) });
  h.state.aiGatewayAccountingReceipt.push({ id: 'native-accounting', scopeId: 'scope-a', taskId: 'task-a', invocationId: 'native-invocation',
    state: 'dispatched', dispatchToken: 'native-dispatch', inputTokens: 2n, outputTokens: 2n, usageHash: 'c'.repeat(64) });
  const create = h.db.aiGatewayToolCallBinding.create.bind(h.db.aiGatewayToolCallBinding);
  h.db.aiGatewayToolCallBinding.createMany = async ({ data }) => {
    for (const row of data) await create({ data: { ...row, createdAt: clock() } });
    return { count: data.length };
  };
  const beforeCommit = h.storeControl.beforeCommit;
  h.storeControl.beforeCommit = async draft => {
    if (beforeCommit) await beforeCommit(draft);
    // This new private receipt table has no revision column. Preserve the
    // generic store's other defaults, but model its real schema exactly here.
    for (const row of draft.aiGatewayToolCallBinding) delete row.revision;
  };
  const bindings = new PrismaNativeToolCallBindings(h.db, scope, secrets, 'task-a', clock);
  const narrow = { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'user-a' };
  const call = { id: 'native_call_private_1', type: 'function', function: { name: 'rental_order_explain', arguments: JSON.stringify(candidate.input) } };
  const signal = new AbortController().signal;
  const activeAt = h.control.now, expiredAt = new Date(held.leaseExpiresAt.getTime() + 1);
  const nativeWrites = () => h.trace.filter(value => value === 'aiGatewayToolCallBinding.createMany').length;
  const writesBefore = nativeWrites();
  // Awaiting an original private receipt must not carry a live lease past its
  // deadline into a new insert. This clock injection belongs only to the double.
  for (const delayedRead of ['aiGatewayToolCallBinding', 'aiGatewayAccountingReceipt']) {
    let originalBindingLookedUp = false;
    h.storeControl.beforeRead = async name => {
      if (name === 'aiGatewayToolCallBinding') originalBindingLookedUp = true;
      if (originalBindingLookedUp && name === delayedRead) h.control.now = expiredAt;
    };
    await assert.rejects(bindings.capture(narrow, intent.requestId, [call], [candidate], signal), { code: 'FORBIDDEN' });
    assert.equal(h.state.aiGatewayToolCallBinding.length, 0);
    assert.equal(nativeWrites(), writesBefore);
    h.storeControl.beforeRead = null; h.control.now = activeAt;
  }
  // A cancellation after the insert has been attempted cannot be reported as
  // successful capture; the transaction double rolls back, not the provider.
  const cancelled = new AbortController();
  h.storeControl.beforeWrite = async name => {
    if (name === 'aiGatewayToolCallBinding') cancelled.abort();
  };
  await assert.rejects(bindings.capture(narrow, intent.requestId, [call], [candidate], cancelled.signal), { code: 'ACCOUNTING_PENDING' });
  assert.equal(h.state.aiGatewayToolCallBinding.length, 0);
  h.storeControl.beforeWrite = null;
  // Acknowledged storage is not permission to deliver after the original lease
  // expires. Preserve its one encrypted receipt and do not repeat the insert.
  const exactSchemaBeforeCommit = h.storeControl.beforeCommit;
  h.storeControl.beforeCommit = async draft => {
    await exactSchemaBeforeCommit(draft); h.control.now = expiredAt;
  };
  await assert.rejects(bindings.capture(narrow, intent.requestId, [call], [candidate], signal), { code: 'ACCOUNTING_PENDING' });
  assert.equal(h.state.aiGatewayToolCallBinding.length, 1);
  h.storeControl.beforeCommit = exactSchemaBeforeCommit; h.control.now = activeAt;
  const writesAfterCommit = nativeWrites();
  assert.equal(JSON.stringify(h.state.aiGatewayToolCallBinding).includes(call.id), false);
  await bindings.capture(narrow, intent.requestId, [call], [candidate], signal);
  assert.equal(h.state.aiGatewayToolCallBinding.length, 1); // original receipt, not a new provider call
  assert.equal(nativeWrites(), writesAfterCommit); // no second private insert either
  parent.status = 'SUCCEEDED'; parent.resultRef = 'native-model-result';
  Object.assign(h.state.aiStep.find(step => step.id === parent.id), { status: parent.status, resultRef: parent.resultRef });
  const read = { id: 'native-read-step', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', sequence: 2,
    toolCode: 'rental.order.explain', toolVersion: shared.AI_TOOL_DRAFT_VERSION, actionId: 'native-read-action',
    inputRef: 'native-read-input', requestFingerprint: hash(candidate), status: 'SUCCEEDED', resultRef: 'native-read-result' };
  h.state.aiStep.push(read);
  h.state.aiTaskActionInput.push({ scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', id: read.inputRef,
    registrationRef: 'native-read', toolCode: read.toolCode, payload: candidate, fingerprint: read.requestFingerprint });
  const modelResult = { draftVersion: shared.AI_GATEWAY_DRAFT_VERSION, requestId: intent.requestId,
    actual: configuration, evidence: 'mock', status: 'completed', text: '', toolRequests: [candidate],
    usage: { kind: 'reported', inputTokens: 2, outputTokens: 2 } };
  const facts = { requestId: 'original-read', audience: 'operator', scope: context.scope, observedAt: clock().toISOString(),
    order: { id: 'order-a', status: 'OPEN' }, sources: [{ resourceId: 'order-a', observedAt: clock().toISOString(), basis: { kind: 'current' } }] };
  const artifact = { resultId: read.resultRef, runId: 'run-a', stepId: read.id, actionId: read.actionId,
    status: 'succeeded', completeMeasurement: true, payload: facts, contentHash: hash(facts) };
  let currentFacts = structuredClone(facts), permission = true, reads = 0;
  const route = { context, consumerScope: { kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    selection: { mode: 'tenant_managed' }, route: { scope: { id: 'scope-tenant', kind: 'TENANT', tenantId: 'tenant-a' }, profile: {
      id: configuration.configId, scopeId: 'scope-tenant', scopeKind: 'TENANT', configRevision: 1,
      credentialRef: configuration.credentialRef, protocol: configuration.protocol, provider: configuration.provider,
      model: configuration.model, serviceMode: 'tenant_managed' } } };
  // These receipt/Core ports are explicit doubles; real Auth, scope, SecretBox,
  // binding storage logic, frozen-input validation and the resolver are retained.
  const source = new OriginalNativeToolResultSource({ db: h.db, tasks: authorization.tasks, execution: authorization.execution,
    policy, task: { taskId: 'task-a', runId: 'run-a', modelRegistrationRef: 'native-parent', orderRegistrationRef: 'native-read' },
    modelEvidence: { readCompletedEvidence: async () => ({ artifact: { id: parent.resultRef, payload: modelResult,
      contentHash: hash(modelResult) }, evidence: { invocationId: 'native-invocation' } }) },
    toolInputs: { readReadonlyResultInput: async () => ({ context, input: candidate, inputRef: read.inputRef,
      fingerprint: read.requestFingerprint, registrationRef: 'native-read' }) },
    toolResults: { read: async () => structuredClone(artifact) },
    reopenBusinessSource: async () => { reads++; if (!permission) throw Error('synthetic Core read revoked'); return { facts: structuredClone(currentFacts) }; },
    bindings, routing: { resolve: async () => structuredClone(route), assertCurrent: async () => {} } });
  const reference = { referenceVersion: shared.AI_GATEWAY_TOOL_RESULT_REFERENCE_VERSION, taskId: 'task-a', runId: 'run-a',
    modelRegistrationRef: 'native-parent', toolRegistrationRef: 'native-read', callIndex: 0 };
  const material = { messages: [{ role: 'user', content: [{ kind: 'tool_result_reference', reference }] }], maxOutputTokens: 32 };
  const next = model.taskModelIntent('task-a', 'run-a', 'native-answer', policy.sceneCode, material, undefined, true);
  assert.throws(() => model.taskModelFingerprint({ ...input, intent: next }, { ...policy, nativeToolResults: false }), { code: 'CAPABILITY_UNSUPPORTED' });
  assert.throws(() => nativeToolResultReferenceSchema.parse({ ...reference, nativeCallId: call.id }));
  assert.throws(() => model.taskModelIntent('other-task', 'run-a', 'native-answer', policy.sceneCode, material, undefined, true));
  const resolved = await source.resolve(narrow, reference, signal);
  assert.equal(resolved.call.id, call.id); assert.equal(resolved.resultJson, JSON.stringify(facts));
  assert.equal(JSON.stringify(next).includes(call.id), false); assert.equal(JSON.stringify(next).includes('OPEN'), false);
  currentFacts.requestId = 'fresh-correlation'; currentFacts.observedAt = '2026-10-06T12:01:00Z'; currentFacts.sources[0].observedAt = currentFacts.observedAt;
  await source.assertCurrent(narrow, resolved, signal);
  currentFacts.order.status = 'CANCELLED';
  await assert.rejects(source.assertCurrent(narrow, resolved, signal));
  currentFacts.order.status = 'OPEN'; permission = false;
  await assert.rejects(source.resolve(narrow, reference, signal));
  permission = true; parent.status = 'UNKNOWN';
  h.state.aiStep.find(step => step.id === parent.id).status = 'UNKNOWN';
  await assert.rejects(source.resolve(narrow, reference, signal));
  assert.equal(h.state.aiGatewayToolCallBinding.length, 1); assert.ok(reads > 0);
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { composePersistedTaskGateway } = require('../apps/api/src/modules/ai-native/task-model-gateway.composition');
  // Inert codec declaration exercises only the production constructor wiring.
  // It is never invoked and is not live capability/Provider evidence.
  let dispatches = 0;
  h.db.aiPlatformModelConnection.update = async () => { throw Error('Unused platform mutation'); };
  const assembled = composePersistedTaskGateway({ ...h.authorization, db: h.db, clock,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), secrets,
    taskId: 'task-a', platformProfileId: 'unused-platform', routeScene: 'chat',
    pricing: { kind: 'calls', priceVersion: 'native-price' }, nativeToolResults: true,
    adapters: [new (require('../apps/api/src/modules/ai-native/chat-completions.adapter').ChatCompletionsAdapter)(
      { post: async () => { dispatches++; throw Error('Inert assembly fixture must not dispatch'); } },
      { orderExplainTool: { name: 'rental_order_explain', version: shared.AI_TOOL_DRAFT_VERSION } })] });
  h.state.aiStep.find(step => step.id === parent.id).status = 'SUCCEEDED';
  h.state.aiTask[0].status = 'SUCCEEDED'; h.state.aiRun[0].status = 'SUCCEEDED';
  for (const row of h.state.aiBudgetPolicy) row.enabled = false;
  await assert.rejects(authorization.execution.authorize('task-a'), { code: 'AI_ACCESS_DENIED' });
  const recoveredCall = await assembled.nativeToolBindings.readOriginal(context, 'native-invocation', 0);
  assert.equal(recoveredCall.bindingHash, resolved.bindingHash); assert.equal(recoveredCall.call.id, call.id);
  await assert.rejects(assembled.nativeToolBindings.capture(narrow, intent.requestId, [call], [candidate], signal));
  h.identity.session = false;
  await assert.rejects(assembled.nativeToolBindings.readOriginal(context, 'native-invocation', 0));
  assert.equal(h.state.aiGatewayToolCallBinding.length, 1); assert.equal(nativeWrites(), writesAfterCommit);
  assert.equal(dispatches, 0);
});

// Real request authority, encrypted resolver, frozen-input reader and budget;
// only Prisma storage and the provider POST are offline substitutes.
async function countingRequestHarness(mode = 'tenant_managed', native = false) {
  const { AsyncLocalStorage } = require('node:async_hooks');
  const { AI_TOOL_DRAFT_VERSION, AI_GATEWAY_TOOL_RESULT_REFERENCE_VERSION } = require('@rental-os/shared');
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
    'aiGatewayToolCallBinding', 'systemParameterSet', 'aiPlatformModelConnection', 'aiGatewayPriceRecord', 'aiGatewayInputBoundRecord',
    'aiBudgetReservation', 'aiBudgetAllocation', 'aiBudgetLedgerEntry', 'aiProviderCapability', 'aiProviderCapabilityEvidence',
    'aiTenantAiAllowance'].map(name => [name, []])));
  const active = new AsyncLocalStorage(), transaction = h.db.$transaction.bind(h.db);
  h.db.$transaction = work => active.getStore() ? work(active.getStore()) : transaction(tx => active.run(tx, () => work(tx)));
  // This private fixture lacks the SQL Invocation -> Run relation. Evaluate
  // the SAME original scope/task/Task-ACL predicate against its existing Run
  // and Task rows BEFORE applying the requested limit; never remove that gate.
  const invocationRows = h.db.aiGatewayInvocation.findMany.bind(h.db.aiGatewayInvocation);
  h.db.aiGatewayInvocation.findMany = async args => {
    if (!args.where?.run?.is) return invocationRows(args);
    assert.equal(args.select?.runId, true);
    const { run, ...where } = args.where;
    const rows = await invocationRows({ ...args, where, take: undefined }), matched = [];
    for (const row of rows) {
      if (await h.db.aiRun.findFirst({ where: { ...run.is, id: row.runId }, select: { id: true } })) matched.push(row);
    }
    return matched.slice(0, args.take);
  };
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
  // Explicit modern scene policy in this offline store; never seeded by the API.
  h.state.aiTaskPlanPolicy.push({ scopeId: 'scope-a', sceneCode, sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [{ code: 'ai.model.text', version: AI_TOOL_DRAFT_VERSION }, { code: 'rental.order.explain', version: AI_TOOL_DRAFT_VERSION }],
    limits: { maxSteps: 4, maxCalls: 4, maxConcurrent: 1, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096 },
    expiresAt: new Date('2027-01-01') });
  const authorization = composePersistedTaskAuthorization({ ...h.authorization, db: h.db, clock });
  const context = await authorization.execution.authorize('task-a');
  const policy = { sceneCode, maxOutputTokens: 32, orderExplainTool: true, ...(native ? { nativeToolResults: true } : {}) };
  const nativeReference = { referenceVersion: AI_GATEWAY_TOOL_RESULT_REFERENCE_VERSION, taskId: 'task-a', runId: 'run-a',
    modelRegistrationRef: 'native-parent', toolRegistrationRef: 'native-read', callIndex: 0 };
  const intent = model.taskModelIntent('task-a', 'run-a', 'clarify', sceneCode,
    { messages: [{ role: 'user', content: [native ? { kind: 'tool_result_reference', reference: nativeReference }
      : { kind: 'text', text: 'Original frozen question' }] }], maxOutputTokens: 32 }, undefined, native);
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
  if (native) {
    const shared = require('@rental-os/shared');
    const { AiTaskRepository } = require('../apps/api/src/modules/ai-native/ai-task.repository');
    const { OriginalNativeToolResultSource } = require('../apps/api/src/modules/ai-native/model-input/original-native-tool-result.source');
    const { AiOrderRouteContextAuthority } = require('../apps/api/src/modules/ai-native/order-route-context.authority');
    server.configuration.nativeToolResults = true;
    const parentIntent = model.taskModelIntent('task-a', 'run-a', 'native-parent', sceneCode,
      { messages: [{ role: 'user', content: [{ kind: 'text', text: 'Original order question' }] }], maxOutputTokens: 32 }, undefined, true);
    const parentInput = { ...payload, intent: parentIntent }, parentFingerprint = model.taskModelFingerprint(parentInput, policy);
    const candidate = { contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, toolCode: 'rental.order.explain',
      toolVersion: shared.AI_TOOL_DRAFT_VERSION, input: { orderId: 'order-a' } };
    const parent = { id: 'native-parent-step', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', sequence: 1,
      toolCode: 'ai.model.text', inputRef: 'native-parent-input', requestFingerprint: parentFingerprint,
      status: 'SUCCEEDED', resultRef: 'native-parent-result' };
    const read = { id: 'native-read-step', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', sequence: 2,
      toolCode: 'rental.order.explain', inputRef: 'native-read-input', requestFingerprint: hash(candidate),
      actionId: 'native-read-action', status: 'SUCCEEDED', resultRef: 'native-read-result' };
    h.state.aiStep.push(parent, read);
    h.state.aiTaskActionInput.push({ id: parent.inputRef, scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a',
      registrationRef: 'native-parent', toolCode: parent.toolCode, payload: parentInput, fingerprint: parentFingerprint },
    { id: read.inputRef, scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', registrationRef: 'native-read',
      toolCode: read.toolCode, payload: candidate, fingerprint: read.requestFingerprint });
    const modelResult = { draftVersion: shared.AI_GATEWAY_DRAFT_VERSION, requestId: parentIntent.requestId,
      actual: config, evidence: 'mock', status: 'completed', text: '', toolRequests: [candidate],
      usage: { kind: 'reported', inputTokens: 2, outputTokens: 2 } };
    const facts = { requestId: 'original-read', audience: 'operator', scope: context.scope, observedAt: clock().toISOString(),
      order: { id: 'order-a', status: 'OPEN' }, sources: [{ resourceId: 'order-a', observedAt: clock().toISOString(), basis: { kind: 'current' } }] };
    const artifact = { resultId: read.resultRef, runId: 'run-a', stepId: read.id, actionId: read.actionId,
      status: 'succeeded', completeMeasurement: true, payload: facts, contentHash: hash(facts) };
    effects.nativeCreations = 0; effects.coreReads = 0;
    // Original receipt/binding/fact/route values are explicit fixtures. The
    // production resolver reopens via the real request Guard/credential/ALS port.
    server.nativeToolResultsForRequest = async input => {
      effects.nativeCreations++; assert.equal(input.db, h.db); assert.deepEqual(input.reference, nativeReference);
      assert.equal(typeof input.credentials?.current, 'function');
      assert.equal((await input.credentials.current()).authorization, request.headers.authorization);
      effects.nativeCredentials = input.credentials;
      const authority = new AiOrderRouteContextAuthority(input.guard, input.credentials, 'order-a', clock);
      return new OriginalNativeToolResultSource({ db: input.db, tasks: new AiTaskRepository(input.db, input.taskAuthority, clock),
        execution: input.execution, policy: input.scenePolicy, task: { taskId: 'task-a', runId: 'run-a',
          modelRegistrationRef: 'native-parent', orderRegistrationRef: 'native-read' },
        modelEvidence: { readCompletedEvidence: async () => ({ artifact: { id: parent.resultRef, payload: modelResult,
          contentHash: hash(modelResult) }, evidence: { invocationId: 'native-parent-invocation' } }) },
        toolInputs: { readReadonlyResultInput: async () => ({ context, input: candidate, inputRef: read.inputRef,
          fingerprint: read.requestFingerprint, registrationRef: 'native-read' }) }, toolResults: { read: async () => structuredClone(artifact) },
        reopenBusinessSource: () => authority.withOrderRead(async current => {
          assert.equal(model.taskModelIdentity(current), model.taskModelIdentity(context)); effects.coreReads++;
          return { facts: structuredClone(facts) };
        }), bindings: { readOriginal: async () => ({ configurationHash: hash(config), inputHash: hash(candidate),
          bindingHash: 'a'.repeat(64), call: { type: 'function', id: 'private-native-count-call',
            function: { name: 'rental_order_explain', arguments: JSON.stringify(candidate.input) } } }) },
        routing: { resolve: async () => {
          const profile = h.state.aiProviderProfile[0], owner = h.state.aiScope.find(row => row.id === profile.scopeId);
          return { context, consumerScope: context.scope.kind === 'workspace' ? { kind: 'WORKSPACE', tenantId: context.scope.tenantId,
            workspaceId: context.scope.workspaceId } : null, selection: { mode }, route: { profile, scope: owner } };
        }, assertCurrent: async () => {} } });
    };
  }
  return { ...h, server, effects, request, binding, taskAuthorization: authorization,
    command: { callId: intent.requestId }, factory: new InputCountingRequestFactory(server) };
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
  // Exercise the actual public cost composition over the SAME original count.
  // A settled counting request is not a generation receipt or provider invoice;
  // disabled configuration must preserve current-authorized observations only.
  const financial = () => structuredClone({ reservations: h.state.aiBudgetReservation,
    allocations: h.state.aiBudgetAllocation, ledger: h.state.aiBudgetLedgerEntry,
    bounds: h.state.aiGatewayInputBoundRecord });
  const originalFinancial = financial();
  const costs = await historical.taskCosts(h.request, { taskId: 'task-a', limit: 10 });
  assert.equal(costs.page.taskId, 'task-a'); assert.equal(costs.summary.taskId, 'task-a');
  const recorded = costs.page.items.filter(item => item.accounting === 'recorded');
  const absent = costs.page.items.filter(item => item.accounting === 'not_recorded');
  assert.equal(recorded.length, 1); assert.equal(absent.length, 1);
  assert.notEqual(recorded[0].callId, absent[0].callId);
  assert.equal(absent[0].callId, h.command.callId);
  assert.equal(costs.counting.length, 1); assert.equal(costs.counting[0].receipt.receiptId, receipt.receiptId);
  assert.equal(costs.counting[0].invocationId, h.state.aiGatewayInvocation[0].id);
  assert.equal(costs.summary.recordedCount, 1); assert.equal(costs.summary.notRecordedCount, 1);
  assert.equal(costs.summary.accountingComplete, false);
  assert.equal(costs.summary.groups.length, 1); assert.equal(costs.summary.groups[0].unit, 'calls');
  assert.equal(costs.summary.groups[0].currency, null); assert.equal(costs.summary.groups[0].settledAtoms, '1');
  // The composite must recheck receipt absence after its summary await. This
  // simulates visibility of the SAME original receipt, not a new count/write.
  const { InputCountTokensService } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.service');
  const { CountTokensReceiptNotFoundError } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.receipt');
  const originalReceiptRead = InputCountTokensService.prototype.readCountReceipt;
  let receiptInitiallyAbsent = false;
  const appearedReceipt = t.mock.method(InputCountTokensService.prototype, 'readCountReceipt', async function(command) {
    if (!receiptInitiallyAbsent && command.invocationId === h.state.aiGatewayInvocation[0].id) {
      receiptInitiallyAbsent = true; throw new CountTokensReceiptNotFoundError();
    }
    return originalReceiptRead.call(this, command);
  });
  await assert.rejects(historical.taskCosts(h.request, { taskId: 'task-a', limit: 10 }),
    e => e.getStatus() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN');
  appearedReceipt.mock.restore(); assert.equal(receiptInitiallyAbsent, true);
  // Read-only race: the first count-key query is absent, then that SAME
  // original reservation appears. No receipt or ledger is created/replayed.
  const reservationRead = h.db.aiBudgetReservation.findUnique.bind(h.db.aiBudgetReservation);
  let countInitiallyAbsent = false;
  const appearedCount = t.mock.method(h.db.aiBudgetReservation, 'findUnique', async args => {
    if (!countInitiallyAbsent && args.where.scopeId_scopeKind_callId?.callId === recorded[0].callId) {
      countInitiallyAbsent = true; return null;
    }
    return reservationRead(args);
  });
  await assert.rejects(historical.usagePage(h.request, { taskId: 'task-a', limit: 10 }),
    e => e.getStatus() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN');
  appearedCount.mock.restore(); assert.equal(countInitiallyAbsent, true);
  assert.deepEqual(costs.semantics, { execution: 'read_only_no_dispatch_or_release',
    basis: 'persisted_budget_records_not_provider_invoice',
    countingBasis: 'provider_count_tokens_receipt_not_generation_usage',
    absence: 'no_record_is_not_proof_of_no_consumption' });
  assert.deepEqual(financial(), originalFinancial);
  assert.deepEqual({ writes: h.trace.filter(line => /\.(create|update|upsert|createMany)$/u.test(line)).length,
    sent: h.effects.sent.length, decrypts: h.effects.decrypts }, baseline);
  h.identity.session = false;
  await assert.rejects(historical.receipt(h.request, h.command), e => e.getStatus() === 403);
  await assert.rejects(historical.taskCosts(h.request, { taskId: 'task-a', limit: 10 }), e => e.getStatus() === 403);
  assert.deepEqual(AiInputCountingModule.registerHttp(undefined).controllers, []);
  for (const value of [{ enabled: false, sceneCode: 'order_explanation' }, { enabled: true }, { enabled: true, sceneCode: 'forged' }])
    assert.throws(() => composeStandardInputCounting(deps, value), e => e.code === 'UNAVAILABLE');
  for (const mode of ['platform_managed', 'tenant_managed']) {
    const native = await countingRequestHarness(mode, true);
    t.mock.method(egress, 'createNativeModelEgressTransport', () => native.server.transport);
    const nativeDeps = { db: native.db, auth: native.server.auth, guard: native.server.guard,
      subscriptions: native.server.subscriptions, clock: native.server.clock,
      secrets: native.server.connectionConfiguration.secrets,
      nativeToolResultsForRequest: native.server.nativeToolResultsForRequest };
    const nativeConfiguration = { enabled: true, sceneCode: 'order_explanation', sceneMaxOutputTokens: 32,
      countingPriceVersion: 'count-price', platformProfileId: 'platform-default', timeoutMs: 10000, nativeToolResults: true };
    const constructionTrace = native.trace.length;
    const nativeController = new AiInputCountingController(composeStandardInputCounting(nativeDeps, nativeConfiguration));
    assert.equal(native.trace.length, constructionTrace); assert.equal(native.effects.nativeCreations, 0);
    assert.throws(() => composeStandardInputCounting({ ...nativeDeps, nativeToolResultsForRequest: undefined }, nativeConfiguration),
      { code: 'UNAVAILABLE' }, 'Native configuration never supplies a permissive source when Core is missing');
    assert.throws(() => composeStandardInputCounting(nativeDeps, { ...nativeConfiguration, sceneCode: 'opening_diagnosis' }),
      { code: 'UNAVAILABLE' });
    const counted = await nativeController.count(native.request, native.command);
    assert.equal(counted.state, 'observed'); assert.equal(counted.inputTokens, 12); assert.equal(counted.admission.status, 'settled');
    assert.equal(native.effects.nativeCreations, 1); assert.ok(native.effects.coreReads > 0);
    assert.equal(native.effects.sent.length, 1); assert.equal(native.state.aiBudgetReservation.length, 1);
    const body = JSON.parse(native.effects.sent[0].body);
    assert.equal(body.messages.at(-1).content[0].type, 'tool_result');
    assert.equal(body.messages.at(-1).content[0].tool_use_id, 'private-native-count-call');
    await assert.rejects(native.effects.nativeCredentials.current(), { code: 'FORBIDDEN' });
    assert.equal((await nativeController.count(native.request, native.command)).receiptId, counted.receiptId);
    assert.equal(native.effects.nativeCreations, 1, 'Original receipt replay never creates a new R0 resolver');
    assert.equal(native.effects.sent.length, 1); assert.equal(JSON.stringify(counted).includes('private-native-count-call'), false);
    const nativeHistory = new AiInputCountingController(composeStandardInputCounting(nativeDeps));
    assert.equal((await nativeHistory.receipt(native.request, native.command)).receiptId, counted.receiptId);
    assert.equal(native.effects.nativeCreations, 1, 'Disabled history never constructs the native source');
    // Verify the actual mixed host supplies ONE resolver to both generation and
    // the fourth preparation argument, and that the actual counting composition
    // receives it. Construction is inert; this is not a full model host run.
    const gatewayModule = require('../apps/api/src/modules/ai-native/task-model-gateway.composition');
    const modelModule = require('../apps/api/src/modules/ai-native/model-input/persisted-task-model-input.composition');
    const countModule = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.composition');
    const { composePersistedModelOrderTaskRunner } = require('../apps/api/src/modules/ai-native/model-input/persisted-model-order-runner.composition');
    const { PrismaOriginalRequestRepository } = require('../apps/api/src/modules/ai-native/task-request/prisma-original-request.repository');
    const dependencies = { ...native.authorization, db: native.db, guard: native.server.guard,
      clock: native.server.clock, secrets: native.server.connectionConfiguration.secrets, taskId: 'task-a',
      platformProfileId: 'platform-default', routeScene: 'chat', nativeProtocol: 'anthropic_messages', nativeToolResults: true,
      pricing: { kind: 'recorded', priceVersion: 'generation-price' },
      inputCounting: { countingPriceVersion: 'count-price', timeoutMs: 10000 } };
    const gateway = gatewayModule.composePersistedTaskGateway(dependencies), originalModel = modelModule.composePersistedTaskModelInput,
      originalCounting = countModule.composeTaskInputCountingChain;
    let sharedResolver, countedResolver;
    const modelMock = t.mock.method(modelModule, 'composePersistedTaskModelInput', value => {
      sharedResolver = value.nativeCounting;
      assert.equal(value.runtime.ports.nativeToolResults, sharedResolver);
      return originalModel(value);
    });
    const countingMock = t.mock.method(countModule, 'composeTaskInputCountingChain', value => {
      countedResolver = value.nativeToolResults; return originalCounting(value);
    });
    const noOriginalWork = async () => { throw Error('Inert construction cannot read or create an original request'); };
    const mixed = composePersistedModelOrderTaskRunner({ ...dependencies, ...gateway,
      scene: { code: 'order_explanation', version: '1' },
      gatewayScene: { routeScene: 'chat', sceneCode: 'order_explanation', maxOutputTokens: 32, orderExplainTool: true },
      core: { getOrder: noOriginalWork, readOrderFacts: noOriginalWork },
      originalRequests: new PrismaOriginalRequestRepository(native.db,
        { current: noOriginalWork, read: noOriginalWork, create: noOriginalWork }, native.server.clock),
      task: { taskId: 'task-a', runId: 'run-a', modelRegistrationRef: 'native-parent', orderRegistrationRef: 'native-read',
        answerRegistrationRef: 'native-answer', orderId: 'order-a',
        material: { messages: [{ role: 'user', content: [{ kind: 'text', text: 'Original order question' }] }], maxOutputTokens: 32 },
        limits: { maxSteps: 4, maxCalls: 4, maxConcurrent: 1, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096 } },
      host: { holderId: 'inert-native-host', leaseMs: 10000 }
    });
    modelMock.mock.restore(); countingMock.mock.restore();
    assert.equal(typeof sharedResolver?.resolve, 'function'); assert.equal(typeof sharedResolver?.assertCurrent, 'function');
    assert.equal(countedResolver, sharedResolver); assert.equal(typeof mixed.application.start, 'function');
    const bound = gatewayModule.composePersistedTaskGateway({ ...dependencies, nativeCounting: sharedResolver });
    assert.throws(() => bound.inputCounting.preparation(mixed.model.invocations, {},
      { sceneCode: 'order_explanation', maxOutputTokens: 32, orderExplainTool: true, nativeToolResults: true },
      { ...sharedResolver }), { code: 'CONFIG_INVALID' }, 'Distinct resolvers cannot be mixed even when their methods look alike');
    assert.equal(native.effects.sent.length, 1); assert.equal(native.effects.nativeCreations, 1);
    // Exercise the default production builder, without supplying its resolver.
    // This fixture intentionally lacks the completed model's persisted receipt;
    // it must reach the real evidence reader and then refuse, never dispatch.
    const missing = await countingRequestHarness(mode, true);
    t.mock.method(egress, 'createNativeModelEgressTransport', () => missing.server.transport);
    const { PrismaModelStepEvidenceAuthority } = require('../apps/api/src/modules/ai-native/model-input/prisma-model-step-evidence.authority');
    const originalRead = PrismaModelStepEvidenceAuthority.prototype.readCompletedEvidence;
    let completedReads = 0, coreReads = 0;
    const readMock = t.mock.method(PrismaModelStepEvidenceAuthority.prototype, 'readCompletedEvidence', async function (...args) {
      completedReads++; return originalRead.apply(this, args);
    });
    const built = new AiInputCountingController(composeStandardInputCounting({ db: missing.db,
      auth: missing.server.auth, guard: missing.server.guard, subscriptions: missing.server.subscriptions,
      clock: missing.server.clock, secrets: missing.server.connectionConfiguration.secrets,
      core: { getOrder() { coreReads++; throw Error('No completed receipt permits this read'); },
        readOrderFacts() { coreReads++; throw Error('No completed receipt permits this read'); } }
    }, nativeConfiguration));
    await assert.rejects(built.count(missing.request, missing.command));
    readMock.mock.restore();
    assert.ok(completedReads > 0, 'Request-local Guard/Auth wrappers reach the actual original model reader');
    assert.equal(coreReads, 0); assert.equal(missing.effects.sent.length, 0); assert.equal(missing.effects.nativeCreations, 0);
  }
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
  const native = await countingRequestHarness('tenant_managed', true), originalGuard = native.server.guard;
  const guard = { canActivate: execution => execution.switchToHttp().getRequest().url === '/api/rental/v1/orders/order-a'
    ? Promise.resolve(false) : originalGuard.canActivate(execution) };
  await assert.rejects(new InputCountingRequestFactory({ ...native.server, guard }).call(native.request, 'count', native.command), { code: 'FORBIDDEN' });
  assert.equal(native.effects.nativeCreations, 1); assert.equal(native.effects.coreReads, 0);
  assert.equal(native.effects.sent.length, 0); assert.equal(native.state.aiBudgetReservation.length, 0);
  await assert.rejects(native.effects.nativeCredentials.current(), { code: 'FORBIDDEN' });
  const { PrismaGatewayInvocationBindings } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-invocation-bindings');
  const saved = native.state.aiTaskActionInput.find(row => row.id === 'count-input');
  const unregistered = new PrismaGatewayInvocationBindings(native.db, native.taskAuthorization.scopes, native.server.clock,
    { sceneCode: 'order_explanation', maxOutputTokens: 32, orderExplainTool: true });
  await assert.rejects(unregistered.register({ stepId: 'count-step', mode: 'invoke',
    lease: { runId: 'run-a', holderId: 'count-worker', fencingToken: native.state.aiRun[0].fencingToken.toFixed(0) },
    intent: saved.payload.intent, configuration: saved.payload.configuration, priceVersion: 'generation-price', expiresAt: saved.expiresAt }), { code: 'FORBIDDEN' });
  assert.equal(native.state.aiGatewayInvocation.length, 1); assert.equal(native.effects.sent.length, 0);
  const model = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const nativePolicy = { sceneCode: 'order_explanation', maxOutputTokens: 32, orderExplainTool: true, nativeToolResults: true };
  const registered = new PrismaGatewayInvocationBindings(native.db, native.taskAuthorization.scopes, native.server.clock, nativePolicy);
  for (const field of ['taskId', 'runId']) {
    // Valid closed C03 shape and recomputed frozen hash are not proof that a
    // selector belongs to this step. These new metadata targets never dispatch.
    const foreign = structuredClone(saved), step = structuredClone(native.state.aiStep.find(row => row.id === 'count-step'));
    foreign.id = `foreign-${field}-input`; foreign.payload.intent.requestId = `model-foreign-${field}`;
    foreign.payload.intent.messages[0].content[0].reference[field] = `other-${field}`;
    foreign.fingerprint = model.taskModelFingerprint(foreign.payload, nativePolicy);
    Object.assign(step, { id: `foreign-${field}-step`, actionId: `foreign-${field}-action`,
      inputRef: foreign.id, requestFingerprint: foreign.fingerprint });
    native.state.aiTaskActionInput.push(foreign); native.state.aiStep.push(step);
    const before = native.state.aiGatewayInvocation.length;
    await assert.rejects(registered.register({ stepId: step.id, mode: 'invoke',
      lease: { runId: 'run-a', holderId: 'count-worker', fencingToken: native.state.aiRun[0].fencingToken.toFixed(0) },
      intent: foreign.payload.intent, configuration: foreign.payload.configuration, priceVersion: 'generation-price', expiresAt: foreign.expiresAt }), { code: 'FORBIDDEN' });
    assert.equal(native.state.aiGatewayInvocation.length, before);
    assert.equal(native.effects.sent.length, 0); assert.equal(native.state.aiBudgetReservation.length, 0);
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

async function recordedTaskHost(t, mode = 'observed', serviceMode = 'platform_managed') {
  const h = await countingRequestHarness(serviceMode);
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
      assert.equal(serviceMode, 'platform_managed', 'BYOK generation must not add a paid input-count call');
      const result = await h.server.transport.post(packet);
      if (mode === 'aborted') abort.abort();
      return result;
    }
    modelPosts++;
    assert.equal(h.state.aiBudgetReservation.length, serviceMode === 'platform_managed' ? 2 : 1);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, serviceMode === 'platform_managed' ? 1n : 0n);
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
  if (serviceMode === 'platform_managed') {
    // Declared synthetic SaaS price and approved tenant/space allowance. The
    // real platform path uses money; a token-unit policy cannot stand in for it.
    const { Prisma } = require('@prisma/client');
    const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
    const price = h.state.aiGatewayPriceRecord[0];
    price.payload.billing = { unit: 'money', currency: 'USD', scale: 6, inputPerMillion: '1.000000',
      outputPerMillion: '1.000000', rounding: 'ceil_total_micro_units' };
    price.payloadHash = requestFingerprint(price.payload);
    h.state.aiTenantAiAllowance.push({ tenantId: 'tenant-a', currency: 'USD', revision: 1,
      grantedAmount: new Prisma.Decimal('100.000000'), allocationsJson: { 'workspace-a': '100.000000' } });
    const policy = h.state.aiBudgetPolicy.find(row => row.scopeKind === 'PLATFORM' && row.sceneCode === 'order_explanation');
    policy.unitKind = 'money'; policy.moneyCurrency = 'USD'; policy.moneyLimit = new Prisma.Decimal('100.000000');
    policy.settingsJson.budget = { state: 'limited', quantity: { unit: 'money', amount: '100.000000', currency: 'USD', scale: 6 } };
  } else {
    // BYOK does not require a platform rate, amount allowance or input bound.
    h.state.aiGatewayPriceRecord.length = 0;
  }
  const limits = { ...h.plan.limits, maxCalls: 2, maxSteps: 1, maxStepMs: 15000, maxTotalMs: 20000, maxOutputBytes: 20000 };
  // The fixture already owns this unique scene-policy row. Configure that row
  // before the host starts, rather than append an impossible duplicate whose
  // older limits win findFirst. Production preparation ceilings stay unchanged.
  const policies = h.state.aiTaskPlanPolicy.filter(row => row.scopeId === 'scope-a'
    && row.sceneCode === 'order_explanation' && row.sceneVersion === '1');
  assert.equal(policies.length, 1);
  Object.assign(policies[0], { allowedTools: [{ code: 'ai.model.text', version: AI_TOOL_DRAFT_VERSION }], limits });
  const hostInput = { ...common, gateway, scene: { code: 'order_explanation', version: '1' },
    gatewayScene: { sceneCode: 'order_explanation', routeScene: 'chat', maxOutputTokens: 32, orderExplainTool: true },
    host: { holderId: 'recorded-worker', leaseMs: 100000 }, inputSource: h.source,
    task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'summary-counted', limits,
      material: { messages: [{ role: 'user', content: [{ kind: 'text', text: 'Original counted question' }] }], maxOutputTokens: 32 } } };
  const root = composePersistedTaskModelHost(hostInput);
  // No settings privilege is needed once the task's own action/plan policy is provisioned.
  h.identity.user.permissions = h.identity.user.permissions.filter(value => value !== 'system:params:manage');
  return { h, root, abort, modelPosts: () => modelPosts, rebuild: () => composePersistedTaskModelHost(hostInput) };
}

for (const mode of ['observed', 'unknown', 'aborted']) test(`recorded task host ${mode} preserves original counting and generation meters`, { timeout: 60000 }, async t => {
  const { h, root, abort, modelPosts, rebuild } = await recordedTaskHost(t, mode);
  const outcome = await root.application.start({ taskId: 'task-a', runId: 'run-a' }, abort.signal);
  assert.equal(outcome.kind, 'run_outcome', JSON.stringify(outcome));
  if (mode !== 'observed') {
    assert.equal(outcome.outcome.status, 'unknown', JSON.stringify(outcome));
    assert.equal(h.effects.sent.length, 1); assert.equal(modelPosts(), 0);
    assert.equal(h.state.aiGatewayInputBoundRecord.length, 0);
    assert.equal(h.state.aiBudgetReservation.length, 1); assert.notEqual(h.state.aiBudgetReservation[0].status, 'released');
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 2n);
    const invocation = h.clone(h.state.aiGatewayInvocation[0]);
    const recovered = await rebuild().recoverOriginal();
    assert.equal(recovered.kind, 'run_outcome'); assert.equal(recovered.outcome.status, 'unknown');
    assert.equal(h.effects.sent.length, 1); assert.equal(modelPosts(), 0);
    assert.deepEqual(h.state.aiGatewayInvocation[0], invocation);
    assert.equal(h.state.aiTaskExecutionBudget.length, 1);
    return;
  }
  assert.equal(outcome.outcome.status, 'succeeded', JSON.stringify(outcome));
  assert.equal(h.effects.sent.length, 1); assert.equal(modelPosts(), 1);
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.state.aiGatewayInputBoundRecord.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  assert.deepEqual(h.state.aiBudgetReservation.map(row => [row.unitKind, row.status]).sort(), [['calls', 'settled'], ['money', 'settled']]);
  assert.equal(h.state.aiBudgetReservation.find(row => row.unitKind === 'money').actualMoney.toFixed(6), '0.000014');
  assert.deepEqual(h.state.aiTaskResultArtifact[0].payload.usage, { kind: 'reported', inputTokens: 12, outputTokens: 2 });
});

test('BYOK task host records one original generation without platform pricing or input counting', { timeout: 60000 }, async t => {
  const { h, root, abort, modelPosts } = await recordedTaskHost(t, 'observed', 'tenant_managed');
  const outcome = await root.application.start({ taskId: 'task-a', runId: 'run-a' }, abort.signal);
  assert.equal(outcome.outcome.status, 'succeeded');
  assert.equal(modelPosts(), 1); assert.deepEqual(h.effects.sent, []);
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.state.aiGatewayInputBoundRecord.length, 0);
  assert.equal(h.state.aiGatewayPriceRecord.length, 0); assert.equal(h.state.aiTenantAiAllowance.length, 0);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  assert.deepEqual(h.state.aiBudgetReservation.map(row => [row.unitKind, row.status, row.actualCalls]), [['calls', 'settled', 1]]);
  assert.deepEqual(h.state.aiTaskResultArtifact[0].payload.usage, { kind: 'reported', inputTokens: 12, outputTokens: 2 });
  assert.equal((await root.recoverOriginal()).kind, 'not_started');
  assert.equal(modelPosts(), 1); assert.equal(h.state.aiGatewayInvocation.length, 1);
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

test('exhausted cumulative output prevents the next effect and records partial success without resetting counters', async () => {
  const h = await taskInputHarness();
  h.control.execute = async () => ({ kind: 'succeeded', payload: 'x'.repeat(4094) });
  assert.deepEqual(await h.make().runner.run(h.claim()), { status: 'partially_succeeded', completedSteps: 1, cleanupFailed: 0 });
  assert.equal(h.state.aiTask[0].status, 'PARTIALLY_SUCCEEDED'); assert.equal(h.state.aiRun[0].status, 'PARTIALLY_SUCCEEDED');
  assert.equal(h.state.aiRun[0].leaseOwnerId, null); assert.equal(h.state.aiStep[1].status, 'PENDING');
  assert.equal(h.state.aiStep[1].effect, 'NONE');
  const stepCharges = h.state.aiTaskExecutionCharge.filter(charge => charge.stepId !== null);
  assert.equal(stepCharges.length, 3);
  assert.ok(stepCharges.every(charge => charge.stepId === h.state.aiStep[0].id));
  const runCharges = h.state.aiTaskExecutionCharge.filter(charge => charge.stepId === null);
  assert.equal(runCharges.length, h.state.aiTaskRunOverhead.length);
  assert.ok(runCharges.every(charge => charge.resource === 'ACTIVE_MS' && charge.actionId === null
    && charge.gatewayInvocationId === null && h.state.aiTaskRunOverhead.some(row => row.id === charge.chargeId
      && row.completedAt && row.activeMs === charge.actualAmount)));
  assert.ok(h.state.aiTaskExecutionCharge.every(charge => charge.status === 'RECORDED'));
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
  const stepCharges = h.state.aiTaskExecutionCharge.filter(row => row.stepId === h.state.aiStep[0].id);
  assert.deepEqual(stepCharges.map(row => row.resource).sort(), ['ACTIVE_MS', 'CALLS', 'CALLS', 'OUTPUT_BYTES', 'STEPS']);
  assert.equal(new Set(stepCharges.map(row => row.chargeId)).size, 5);
  assert.ok(stepCharges.filter(row => row.resource === 'CALLS').every(row => row.actualAmount === 1n
    && row.gatewayInvocationId === h.state.aiGatewayInvocation[0].id));
  const runCharges = h.state.aiTaskExecutionCharge.filter(row => row.stepId === null);
  assert.equal(runCharges.length, h.state.aiTaskRunOverhead.length);
  assert.equal(h.state.aiTaskExecutionCharge.length, stepCharges.length + runCharges.length);
  assert.ok(runCharges.every(row => row.resource === 'ACTIVE_MS' && row.actionId === null && row.gatewayInvocationId === null
    && h.state.aiTaskRunOverhead.some(time => time.id === row.chargeId && time.completedAt && time.activeMs === row.actualAmount)));
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
  const stepCharges = h.state.aiTaskExecutionCharge.filter(row => row.stepId !== null);
  assert.equal(stepCharges.length, 3);
  assert.deepEqual(stepCharges.map(row => row.resource).sort(), ['ACTIVE_MS', 'OUTPUT_BYTES', 'STEPS']);
  assert.ok(stepCharges.every(row => row.stepId === h.state.aiStep[0].id && row.status === 'UNKNOWN'));
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  const runCharges = h.state.aiTaskExecutionCharge.filter(row => row.stepId === null);
  assert.equal(runCharges.length, h.state.aiTaskRunOverhead.length);
  assert.ok(runCharges.every(row => row.resource === 'ACTIVE_MS' && row.status === 'RECORDED'
    && row.gatewayInvocationId === null && h.state.aiTaskRunOverhead.some(time => time.id === row.chargeId
      && time.completedAt && time.activeMs === row.actualAmount)));
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
