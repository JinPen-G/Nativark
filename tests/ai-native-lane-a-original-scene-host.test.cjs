'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('ts-node').register({ transpileOnly: false, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');
const { AiOriginalScenesModule } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.module');
const { AiOriginalScenesController, AI_ORIGINAL_SCENES } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
const { AI_SCENE_REQUEST_HTTP_DRAFT } = require('../packages/shared/src/ai-scene-request-draft');
const { AI_SCENE_REQUEST_DRAFT_SCHEMAS } = require('../packages/shared/src/ai-scene-request-draft-schemas');
const Ajv = require('ajv'), addFormats = require('ajv-formats');
const ajv = new Ajv({ strict: true }); addFormats(ajv);
const recoveryValid = ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestRecoveryDraft);

test('opt-in module is inert; strict controller uses current authority without starting HTTP', async () => {
  const h = await setup(), before = h.trace.length;
  const noHttp = AiOriginalScenesModule.register(h.dependencies);
  assert.equal(noHttp.controllers, undefined); assert.deepEqual(noHttp.exports, [AI_ORIGINAL_SCENES]);
  const module = AiOriginalScenesModule.registerHttp(h.dependencies), controller = new AiOriginalScenesController(module.providers[0].useFactory());
  assert.equal(h.trace.length, before); assert.deepEqual(module.controllers, [AiOriginalScenesController]);
  for (const method of ['create', 'read', 'reissue', 'reconcile', 'reconcileReissue', 'createTask', 'material', 'recovery']) {
    assert.equal(Reflect.getMetadata('path', AiOriginalScenesController.prototype[method]), AI_SCENE_REQUEST_HTTP_DRAFT[method] || '/');
  }
  await assert.rejects(controller.create({ ...h.command(), actor: 'forged' }), e => e.getStatus() === 400 && e.getResponse().code === 'AI_INVALID_INPUT');
  const result = await controller.create(h.command()); assert.equal(result.stage, 'task_metadata_created');
  h.b.h.identity.session = false;
  await assert.rejects(controller.read(h.ref(result.receipt.inputRef)), e => e.getStatus() === 403 && e.getResponse().code === 'AI_ACCESS_DENIED');
});

test('material handoff reauthorizes originals and contains facts, not stale unavailable preparation wrappers', async () => {
  const h = await setup();
  for (const scene of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) {
    const created = await h.app.create(h.command(scene, `material-${scene}`));
    const packet = await h.app.prepareTaskMaterial(h.ref(created.receipt.inputRef));
    assert.equal(packet.original.inputRef, created.receipt.inputRef); assert.equal(packet.task.taskId, created.task.taskId);
    assert.equal(packet.plan, 'requires_host_plan_start'); assert.equal(packet.model, 'not_called');
    assert.ok(Object.isFrozen(packet.material)); assert.match(packet.materialHash, /^[a-f0-9]{64}$/);
    assert.equal(packet.material.task, undefined);
    if (scene === 'opening_diagnosis') {
      assert.deepEqual(packet.material.sections.map(s => s.key), ['item_groups']);
      assert.equal(packet.material.configuration.pricing, undefined);
    }
  }
  const row = h.state.aiTaskOriginalRequest[0]; h.state.aiTaskPlanPolicy[0].enabled = false;
  await assert.rejects(h.app.prepareTaskMaterial(h.ref(row.id)), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal((await h.app.readTaskReceipt(row.id)).state, 'observed');
});

test('recovery reads original action IDs and observed results after cancel or AI shutdown, never dispatches', async () => {
  const h = await setup(), created = await h.app.create(h.command()), task = h.state.aiTask[0];
  h.state.aiTaskActionPolicy.push({ scopeId: task.scopeId, taskId: task.id, operation: 'read_metadata', revision: 1,
    requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  h.state.aiStep.push({ id: 'step-unknown', taskId: task.id, runId: created.task.runId, actionId: 'original-action', status: 'UNKNOWN', effect: 'POSSIBLE', revision: 4, resultRef: 'receipt-unknown', createdAt: new Date(), secretBody: 'must-not-be-returned' },
    { id: 'step-known', taskId: task.id, runId: created.task.runId, actionId: 'committed-action', status: 'SUCCEEDED', effect: 'COMMITTED', revision: 3, resultRef: 'receipt-known', createdAt: new Date() });
  task.status = 'CANCELLED'; task.revision++;
  h.state.aiTaskPlanPolicy[0].enabled = false;
  const before = h.trace.filter(x => x.endsWith('.create')).length;
  const result = await h.app.readRecovery(h.ref(created.receipt.inputRef));
  assert.equal(recoveryValid(result), true, JSON.stringify(recoveryValid.errors));
  assert.equal(result.task.status, 'cancelled'); assert.equal(result.steps.length, 2); assert.equal(result.automaticExecution, false);
  assert.equal(result.steps.find(s => s.actionId === 'original-action').nextAction, 'reconcile_original_action');
  assert.equal(result.steps.find(s => s.actionId === 'committed-action').resultAvailable, true);
  assert.equal(JSON.stringify(result).includes('must-not-be-returned'), false);
  assert.equal(h.trace.filter(x => x.endsWith('.create')).length, before);
  h.state.aiTaskActionPolicy.length = 0;
  await assert.rejects(h.app.readRecovery(h.ref(created.receipt.inputRef)), e => e.code === 'AI_RESOURCE_UNAVAILABLE' || e.code === 'AI_ACCESS_DENIED');
});

test('empty metadata recovery does not create a task or infer a safe replay', async () => {
  const h = await setup(), saved = await h.app.requests.save(h.command());
  const result = await h.app.readRecovery(h.ref(saved.inputRef));
  assert.equal(recoveryValid(result), true); assert.equal(result.task.state, 'not_observed');
  assert.equal(result.task.retryable, false); assert.equal(h.state.aiTask.length, 0);
});

test('persisted scene model result is bound to its original input and current authorized facts', async () => {
  const { AiOriginalSceneResultService } = require('../apps/api/src/modules/ai-native/scenes/original-scene-result.service');
  const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
  const { taskModelIntent, taskModelIdentity, taskModelFingerprint, TASK_TEXT_MODEL_TOOL } = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const { requestFingerprint: hash } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  for (const sceneCode of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) {
  const h = await setup({ aiTaskResultArtifact: [], aiGatewayInvocation: [], aiTaskEvent: [] });
  const created = await h.app.create(h.command(sceneCode)), task = h.state.aiTask[0], ref = h.ref(created.receipt.inputRef);
  const packet = await h.app.prepareTaskMaterial(ref), original = await h.app.requests.readHistorical(ref);
  const policy = { sceneCode, routeScene: 'chat', maxOutputTokens: 64 };
  const config = structuredClone(require('./fixtures/ai-native/gateway-contracts.cjs').config);
  config.tenantId = original.context.scope.tenantId; config.configurationScope.tenantId = config.tenantId;
  const input = { mode: 'invoke', intent: taskModelIntent(task.id, created.task.runId, `scene-model:${ref.inputRef}`, policy.sceneCode,
    { maxOutputTokens: 32, messages: [{ role: 'user', content: [{ kind: 'text', text: JSON.stringify({ original: packet.original,
      materialHash: packet.materialHash, trust: packet.trust, facts: packet.material }) }] }] }),
    configuration: config, priceVersion: 'price-1', routingHash: 'a'.repeat(64), identityHash: taskModelIdentity(original.context) };
  const fingerprint = taskModelFingerprint(input, policy), now = new Date(h.b.h.control.now);
  const payload = { ...structuredClone(require('./fixtures/ai-native/gateway-contracts.cjs').completed),
    requestId: input.intent.requestId, actual: config, text: 'Synthetic untrusted explanation' };
  h.state.aiTaskActionPolicy.push({ scopeId: task.scopeId, taskId: task.id, operation: 'read_step_terminal', revision: 1,
    requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  h.state.aiStep.push({ scopeId: task.scopeId, taskId: task.id, runId: created.task.runId, id: 'model-step', actionId: 'model-action',
    inputRef: 'model-input', requestFingerprint: fingerprint, status: 'SUCCEEDED', resultRef: 'model-result',
    toolCode: TASK_TEXT_MODEL_TOOL, toolVersion: AI_TOOL_DRAFT_VERSION });
  h.state.aiTaskActionInput.push({ scopeId: task.scopeId, taskId: task.id, runId: created.task.runId, id: 'model-input',
    registrationRef: `scene-model:${ref.inputRef}`, toolCode: TASK_TEXT_MODEL_TOOL, toolVersion: AI_TOOL_DRAFT_VERSION, fingerprint, payload: input });
  h.state.aiGatewayInvocation.push({ scopeId: task.scopeId, taskId: task.id, runId: created.task.runId, stepId: 'model-step', actionId: 'model-action',
    actorId: task.ownerId, sceneCode: task.sceneCode, callId: input.intent.requestId, mode: 'invoke', stepFingerprint: fingerprint,
    intentHash: fingerprint, priceVersion: input.priceVersion, configurationHash: hash(config) });
  h.state.aiTaskResultArtifact.push({ scopeId: task.scopeId, taskId: task.id, runId: created.task.runId, stepId: 'model-step', actionId: 'model-action',
    id: 'model-result', stepFingerprint: fingerprint, outcome: 'SUCCEEDED', payload, contentHash: hash(payload), errorCode: null,
    outputBytes: BigInt(Buffer.byteLength(JSON.stringify(payload))), activeMs: 1n, completeMeasurement: true, createdAt: now });
  const tasks = composePersistedTaskAuthorization(h.dependencies).tasks;
  const reader = new AiOriginalSceneResultService(h.db, tasks, h.app, policy, h.dependencies.clock);
  const { composeAiTaskCenterScene } = require('../apps/api/src/modules/ai-native/task-center-scene.composition');
  const { AiTaskEventRepository } = require('../apps/api/src/modules/ai-native/ai-task-event.repository');
  const authorization = composePersistedTaskAuthorization(h.dependencies);
  h.state.aiTaskActionPolicy.push({ scopeId: task.scopeId, taskId: task.id, operation: 'read_events', revision: 1,
    requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  h.state.aiTask[0].eventCursor = 9007199254740993n;
  h.state.aiTaskEvent.push({ scopeId: task.scopeId, taskId: task.id, cursor: 9007199254740993n, taskRevision: task.revision,
    type: 'task.output_ready', payload: { data: { resultId: 'model-result' } }, occurredAt: now });
  const center = composeAiTaskCenterScene({ list: { readPage: async () => { throw Error('not used'); } }, scenes: h.app, modelResults: reader,
    events: new AiTaskEventRepository(h.db, authorization.authority, h.dependencies.clock) });
  const events = await center.readEvents({ original: ref, after: '9007199254740992', limit: 10 });
  assert.equal(events.nextCursor, '9007199254740993'); assert.equal(events.events[0].data.resultId, 'model-result');
  await assert.rejects(center.readEvents({ original: ref, after: 9007199254740992, limit: 10 }), e => e.code === 'AI_INVALID_INPUT');
  const command = { original: ref, resultId: 'model-result' };
  const result = await center.readModelResult(command);
  assert.equal(result.status, 'available'); assert.equal(result.text.value, payload.text);
  assert.equal(result.sceneCode, sceneCode);
  if (sceneCode === 'order_explanation') {
  assert.deepEqual(result.sources.map(source => source.field), ['order']);
  const reopened = await center.reopenModelSource({ ...command, sourceIndex: 0 });
  assert.equal(reopened.reference.resourceId, 'order-a'); assert.equal(reopened.source.status, 'available');
  } else {
    assert.deepEqual(result.sources, []);
    if (sceneCode === 'opening_diagnosis') {
      assert.deepEqual(result.facts.sections.map(section => section.key), ['item_groups']);
      assert.equal(result.facts.configuration.pricing, undefined);
    } else {
      assert.equal(result.facts.payload.facts.status, 'missing_input');
      assert.equal(result.facts.payload.execution, 'not_attempted');
      assert.ok(result.facts.payload.facts.missingFields.length > 0);
    }
    await assert.rejects(center.reopenModelSource({ ...command, sourceIndex: 0 }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  }
  await assert.rejects(center.reopenModelSource({ ...command, sourceIndex: 1 }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(center.reopenModelSource({ ...command, sourceIndex: 0, url: 'https://invalid.example' }), e => e.code === 'AI_INVALID_INPUT');
  assert.equal(JSON.stringify(result).includes('credential-test'), false);
  h.state.aiGatewayInvocation[0].actionId = 'another-call';
  await assert.rejects(reader.read(command), e => e.code === 'AI_ACCESS_DENIED');
  h.state.aiGatewayInvocation[0].actionId = 'model-action';
  h.state.aiTaskResultArtifact[0].outcome = 'UNKNOWN'; h.state.aiStep[0].status = 'UNKNOWN';
  const unknown = await reader.read(command); assert.equal(unknown.status, 'unknown'); assert.equal(unknown.text, null);
  h.b.h.identity.session = false;
  await assert.rejects(reader.read(command), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  }
});

test('original model application prepares under the actual claimed lease and stops at a missing model transition authority', async () => {
  const { composeAiOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/original-scene-model.composition');
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const { TASK_TEXT_MODEL_TOOL } = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  const { AiTaskRepositoryError } = require('../apps/api/src/modules/ai-native/ai-task.repository');
  const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
  const tables = Object.fromEntries(['aiTaskResultArtifact', 'aiGatewayInvocation', 'aiTaskExecutionBudget', 'aiTaskExecutionCharge',
    'aiTaskEvent', 'aiTaskInputRequest', 'aiTaskInputReceipt', 'aiGatewayAccountingReceipt', 'aiInvocationAdmission'].map(key => [key, []]));
  const h = await setup(tables);
  const beforeWrite = h.control.beforeWrite;
  h.control.beforeWrite = async (table, args, data) => {
    await beforeWrite?.(table, args, data);
    if (table === 'aiTask') {
      args.data.cancelRequestedAt ??= null; // Actual database defaults, not an authorization override.
      args.data.updatedAt ??= h.dependencies.clock();
    }
  };
  for (const [id, scope] of [['scope-platform', { kind: 'platform' }], ['scope-tenant', { kind: 'tenant', tenantId: 'tenant_001' }]]) {
    h.state.aiScope.push({ id, ...aiPersistenceScopeColumns(scope) });
  }
  h.state.aiBudgetPolicy = clone(h.b.h.state.aiBudgetPolicy).map(row => {
    const next = JSON.parse(JSON.stringify(row).replaceAll('tenant-a', 'tenant_001').replaceAll('synthetic-clarification', 'order_explanation'));
    return next;
  });
  const limits = { ...h.b.h.plan.limits, maxTotalMs: 30000, maxStepMs: 5000 };
  h.state.aiTaskPlanPolicy[0].allowedTools = [{ code: TASK_TEXT_MODEL_TOOL, version: AI_TOOL_DRAFT_VERSION }];
  h.state.aiTaskPlanPolicy[0].limits = limits;
  const created = await h.app.create(h.command()), task = h.state.aiTask[0];
  for (const operation of ['read_metadata', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'read_step_terminal']) {
    h.state.aiTaskActionPolicy.push({ scopeId: task.scopeId, taskId: task.id, operation, revision: 1,
      requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  }
  const profile = { id: 'profile-a', scopeId: 'scope-tenant', scopeKind: 'TENANT', configRevision: 1, credentialRef: 'vault-a',
    protocol: 'openai_chat_completions', provider: 'synthetic', model: 'synthetic-model', serviceMode: 'tenant_managed', enabled: true, disabledAt: null };
  let model, routeReads = 0, transitionAttempts = 0;
  const runtime = { evidence: 'mock', verifyEvidence: async () => true, ports: { routing: {
    resolve: async (_caller, required) => {
      routeReads++; const context = await model.runtime.authorization.execution.authorize(task.id);
      return { context, consumerScope: { id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant_001', workspaceId: 'workspace-a' },
        route: { profile, scope: { id: 'scope-tenant', kind: 'TENANT', tenantId: 'tenant_001' }, role: 'DEFAULT',
          preflight: { allowed: true, required, missing: [], stale: [] } }, selection: { mode: 'tenant_managed', revision: 1 },
        scene: 'chat', requiredCapabilities: required };
    }, assertCurrent: async () => {} } } };
  model = composeAiOriginalSceneModel({ ...h.dependencies, scene: { code: 'order_explanation', version: '1' },
    gatewayScene: { sceneCode: 'order_explanation', routeScene: 'chat', maxOutputTokens: 64 }, priceVersion: 'price-1', runtime });
  const base = h.b.h.configuration();
  assert.throws(() => model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, {}), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  const app = model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, { commands: {
    ...base.commands, register: (plan, lease) => ({ ...base.commands.register(plan, lease), expectedTaskRevision: h.state.aiTask[0].revision }) },
    inputSource: h.b.h.source, transitionAuthority: { resolve: async () => { transitionAttempts++; throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); } },
    financialEvidence: { readDispatch: async () => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); } } });
  assert.equal(routeReads, 0); assert.equal(h.state.aiTaskRunPlan.length, 0);
  await model.runtime.authorization.authority.resolve(task.id, 'claim_run');
  await assert.rejects(app.start({ ...h.ref(created.receipt.inputRef), holderId: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
  await assert.rejects(app.start(h.ref(created.receipt.inputRef)), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(transitionAttempts, 1); assert.equal(h.state.aiRun[0].status, 'RUNNING');
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), '1');
  assert.equal(h.state.aiTaskActionInput.length, 1); assert.equal(h.state.aiTaskRunPlan.length, 1);
  const frozen = h.state.aiTaskActionInput[0].payload.intent.messages.find(message => message.role === 'user');
  const supplied = JSON.parse(frozen.content.map(part => part.text).join(''));
  assert.equal(supplied.original.inputRef, created.receipt.inputRef); assert.equal(supplied.facts.payload.orderId, 'order-a');
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  const reference = h.ref(created.receipt.inputRef), writes = h.state.aiTaskActionInput.length;
  assert.deepEqual(await app.reconcile(reference), { kind: 'not_started', reason: 'recovery_lease_unavailable' });
  const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  await assert.rejects(app.resume({ original: reference, submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION,
    taskId: 'another-task', requestId: 'input-request', expectedRevision: 1, submissionKey: 'answer-a',
    answers: [{ fieldId: 'clarification_text', value: 'Synthetic clarification' }] } }), e => e.code === 'AI_ACCESS_DENIED');
  h.state.aiTaskPlanPolicy[0].enabled = false;
  assert.equal(await app.readInput(reference), null); // Reading/cancel remain possible after AI execution is disabled.
  const cancelled = await app.requestCancel({ original: reference, expectedRevision: h.state.aiTask[0].revision });
  assert.equal(cancelled.cancellation, 'requested_not_rollback'); assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal(h.state.aiTaskActionInput.length, writes); assert.equal(h.state.aiGatewayInvocation.length, 0);
  h.b.h.identity.session = false;
  await assert.rejects(app.readInput(reference), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
});

test('client scene authenticates through actual client Guard/Auth and rechecks after the business read', async () => {
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { ClientAuthService } = require('../apps/api/src/modules/client/client-auth.service');
  const { ClientApiService } = require('../apps/api/src/modules/client/client-api.service');
  const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { composeAiClientScenes, createAiGuardedClientSession } = require('../apps/api/src/modules/ai-native/client-scene.composition');
  let revoked = false, revokeDuringRead = false, authorization, reads = 0;
  const session = { id: 'session-client', expiresAt: new Date('2027-01-01'), tenant: { code: 'tenant', status: 'ACTIVE' },
    customer: { customerType: 'personal', name: 'Synthetic', phone: 'synthetic' },
    workspace: { tenantId: 'tenant-client', status: 'ACTIVE', code: 'camera', name: 'Synthetic', categoryCode: 'camera' } };
  const auth = Object.assign(Object.create(ClientAuthService.prototype), { secret: () => 'synthetic-offline-secret-not-production', prisma: {
    clientAuthSession: { findFirst: async () => revoked ? null : structuredClone(session), updateMany: async () => ({ count: 1 }) },
    customerAccount: { findFirst: async () => ({ status: 'active', customer: { status: 'active' } }) },
    customerMembership: { findFirst: async () => ({ status: 'active' }) }
  } });
  const token = auth.sign({ typ: 'client', sub: 'person-client', tid: 'tenant-client', sid: session.id,
    wid: 'workspace-client', iat: 1, exp: Math.floor(new Date('2027-01-01').getTime() / 1000) });
  authorization = `Bearer ${token}`;
  const guard = new ApiAuthGuard({ resolveAccessContext: async () => { throw Error('operator auth forbidden'); } }, undefined,
    auth, { assertAllowed: async () => {} });
  const client = Object.assign(Object.create(ClientApiService.prototype), { core: { getOrder: async (tenantId, id) => {
    reads++; assert.equal(tenantId, 'tenant-client'); assert.equal(getRequestIdentity().workspaceId, 'workspace-client');
    if (revokeDuringRead) revoked = true;
    return { id, tenantId, customerId: id === 'other-order' ? 'another-customer' : 'person-client',
      status: 'reserved', lines: [], chargeLines: [], allocations: [], internalNote: 'never expose' };
  } } });
  const source = createAiGuardedClientSession(guard, { current: async () => ({ authorization, ip: '127.0.0.1' }) });
  const app = composeAiClientScenes({ client, session: source });
  assert.equal(reads, 0);
  const result = await app.member.order('own-order'); assert.equal(result.id, 'own-order'); assert.equal(result.internalNote, undefined);
  await assert.rejects(app.member.orders({ page: 1, tenantId: 'forged' }), e => e.getStatus?.() === 400);
  await assert.rejects(app.member.order('other-order'), e => e.getStatus?.() === 404);
  authorization = 'Bearer operator-token';
  await assert.rejects(app.member.order('own-order')); authorization = `Bearer ${token}`;
  revokeDuringRead = true;
  await assert.rejects(app.member.order('own-order'), e => e.getStatus?.() === 401);
});
