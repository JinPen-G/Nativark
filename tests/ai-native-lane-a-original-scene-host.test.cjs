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
  const { credentials, ...dependencies } = h.dependencies;
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  const options = { enabled: true, audience: 'operator' };
  const module = AiOriginalScenesModule.registerHttp(dependencies, options), controller = new AiOriginalScenesController(module.providers[0].useFactory());
  assert.throws(() => AiOriginalScenesModule.registerHttp(h.dependencies, options).providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.throws(() => AiOriginalScenesModule.registerHttp(dependencies, { ...options, enabled: false }).providers[0].useFactory(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.trace.length, before); assert.deepEqual(module.controllers, [AiOriginalScenesController]);
  for (const method of ['create', 'read', 'reissue', 'reconcile', 'reconcileReissue', 'createTask', 'material', 'recovery']) {
    assert.equal(Reflect.getMetadata('path', AiOriginalScenesController.prototype[method]), AI_SCENE_REQUEST_HTTP_DRAFT[method] || '/');
  }
  await assert.rejects(controller.create(request, { ...h.command(), actor: 'forged' }), e => e.getStatus() === 400 && e.getResponse().code === 'AI_INVALID_INPUT');
  const result = await controller.create(request, h.command()); assert.equal(result.stage, 'task_metadata_created');
  await assert.rejects(controller.read({ headers: {} }, h.ref(result.receipt.inputRef)), e => e.getStatus() === 403);
  const loaded = await controller.read(request, h.ref(result.receipt.inputRef));
  assert.equal(loaded.receipt.inputRef, result.receipt.inputRef);
  h.b.h.identity.session = false;
  await assert.rejects(controller.read(request, h.ref(result.receipt.inputRef)), e => e.getStatus() === 403 && e.getResponse().code === 'AI_ACCESS_DENIED');
});

test('request-bound original scenes snapshot commands and never borrow concurrent or ambient identity', { timeout: 30000 }, async () => {
  const h = await setup(), { credentials, ...dependencies } = h.dependencies;
  const { composeRequestBoundOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const app = composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: 'operator' });
  const authorization = (await credentials.current()).authorization;
  const request = { headers: { authorization } }, command = h.command();
  let unblock, reached;
  const paused = new Promise(resolve => { reached = resolve; }), resume = new Promise(resolve => { unblock = resolve; });
  let intercepted = false;
  h.control.beforeRead = async table => {
    if (!intercepted && table === 'aiTaskOriginalRequest') { intercepted = true; reached(); await resume; }
  };
  const running = app.create(request, command);
  await paused;
  try {
    request.headers.authorization = 'Bearer replacement'; command.input.orderId = 'another-order';
    command.requestKey = 'mutated-key';
    await runWithRequestIdentity({ tenantId: 'tenant_001', workspaceId: 'workspace-a', userId: h.b.h.identity.user.id }, async () => {
      await assert.rejects(app.create({ headers: {} }, h.command('order_explanation', 'forbidden')), e => e.code === 'AI_ACCESS_DENIED');
      await assert.rejects(app.create({ headers: { authorization: 'Bearer invalid' } }, h.command()), e => e.code === 'AI_ACCESS_DENIED');
    });
  } finally { unblock(); }
  const created = await running;
  assert.equal(created.receipt.requestKey, 'original-a');
  assert.equal(h.state.aiTaskOriginalRequest[0].payload.orderId, 'order-a'); assert.equal(h.state.aiTask.length, 1);
  const beforeRead = h.control.beforeRead;
  h.control.beforeRead = async table => { await beforeRead(table); if (table === 'aiTaskOriginalRequest') h.b.h.identity.session = false; };
  await assert.rejects(app.read({ headers: { authorization } }, h.ref(created.receipt.inputRef)), e => e.code === 'AI_ACCESS_DENIED');
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

test('original model application uses the fixed commands and persisted evidence from QUEUED through result readback', async () => {
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  for (const sceneCode of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) {
    const h = await originalModelApplicationHarness(sceneCode);
    assert.equal(h.execution.routeReads, 0); assert.equal(h.state.aiTaskRunPlan.length, 0);
    assert.equal(h.state.aiTask[0].status, 'QUEUED'); assert.equal(h.state.aiRun[0].status, 'QUEUED');
    assert.throws(() => h.model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, {}), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    assert.throws(() => h.model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, { financialEvidence: h.financial }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    await assert.rejects(h.app.start({ ...h.reference, holderId: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
    const result = await h.app.start(h.reference);
    assert.equal(result.execution.kind, 'run_outcome'); assert.equal(result.execution.outcome.status, 'succeeded');
    assert.equal(result.businessExecution, 'not_inferred_from_model_result');
    assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiStep[0].effect, 'NONE');
    assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), '1'); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
    assert.equal(h.state.aiTaskActionInput.length, 1); assert.equal(h.state.aiTaskRunPlan.length, 1);
    assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiGatewayInvocation.length, 1);
    assert.equal(h.state.aiGatewayAccountingReceipt[0].state, 'dispatched');
    assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, true);
    assert.equal(h.state.aiTaskExecutionCharge.length, 4); assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
    const frozen = h.state.aiTaskActionInput[0].payload.intent.messages.find(message => message.role === 'user');
    const supplied = JSON.parse(frozen.content.map(part => part.text).join(''));
    assert.equal(supplied.original.inputRef, h.reference.inputRef);
    const read = await h.model.readModelResult({ original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id });
    assert.equal(read.status, 'available'); assert.equal(read.text.value, h.execution.result.text);
    assert.deepEqual(await h.app.reconcile(h.reference), { kind: 'not_started', reason: 'recovery_lease_unavailable' });
    assert.equal(h.execution.sent.length, 1);
    const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
    await assert.rejects(h.app.resume({ original: h.reference, submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION,
      taskId: 'another-task', requestId: 'input-request', expectedRevision: 1, submissionKey: 'answer-a',
      answers: [{ fieldId: 'clarification_text', value: 'Synthetic clarification' }] } }), e => e.code === 'AI_ACCESS_DENIED');
    h.b.h.identity.session = false;
    await assert.rejects(h.app.readInput(h.reference), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  }
});

test('original model application retains unknown usage and cancellation without redispatch or invented zero usage', async () => {
  const { originalModelApplicationHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h = await originalModelApplicationHarness();
  delete h.execution.result.usage;
  const result = await h.app.start(h.reference);
  assert.equal(result.execution.kind, 'run_outcome'); assert.equal(result.execution.outcome.status, 'unknown');
  assert.equal(h.state.aiStep[0].status, 'UNKNOWN'); assert.equal(h.state.aiStep[0].effect, 'POSSIBLE');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assert.equal(h.state.aiGatewayAccountingReceipt[0].inputTokens, null);
  assert.equal(h.state.aiBudgetReservation[0].status, 'pending_reconciliation');
  assert.equal(h.execution.sent.length, 1);
  const read = await h.model.readModelResult({ original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id });
  assert.equal(read.status, 'unknown'); assert.equal(read.text, null);
  await h.app.reconcile(h.reference); assert.equal(h.execution.sent.length, 1);
  h.state.aiTaskPlanPolicy[0].enabled = false;
  assert.equal(await h.app.readInput(h.reference), null);
  const cancelled = await h.app.requestCancel({ original: h.reference, expectedRevision: h.state.aiTask[0].revision });
  assert.equal(cancelled.cancellation, 'requested_not_rollback'); assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiTaskActionInput.length, 1);

  const aborted = await originalModelApplicationHarness(), signal = new AbortController(); signal.abort();
  const stopped = await aborted.app.start(aborted.reference, signal.signal);
  assert.deepEqual(stopped.execution, { kind: 'not_started', reason: 'host_aborted' });
  assert.equal(aborted.state.aiTask[0].status, 'QUEUED'); assert.equal(aborted.state.aiTaskRunPlan.length, 0);
  assert.equal(aborted.execution.sent.length, 0);
});

test('scene knowledge stays separate from Core and reauthorizes frozen sources and human preferences', { timeout: 60000 }, async () => {
  const { originalModelApplicationHarness, originalSceneKnowledgeFixture } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  for (const sceneCode of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) {
    const h = await originalModelApplicationHarness(sceneCode, originalSceneKnowledgeFixture), k = h.supplemental;
    const run = await h.app.start(h.reference);
    assert.equal(run.execution.outcome.status, 'succeeded'); assert.equal(h.execution.sent.length, 1);
    const frozen = h.state.aiTaskActionInput[0].payload.intent.messages.find(message => message.role === 'user');
    const envelope = JSON.parse(frozen.content.map(part => part.text).join(''));
    assert.equal(envelope.knowledge.originalInputRef, h.reference.inputRef);
    assert.equal(envelope.materialHash, requestFingerprint(envelope.facts));
    assert.equal(envelope.knowledge.contentHash, requestFingerprint(envelope.knowledge.material));
    assert.equal(envelope.knowledge.material.sources[0].snippet, k.text);
    assert.equal(envelope.knowledge.material.sources[0].trust, 'untrusted_data');
    assert.equal(envelope.knowledge.material.preferences.items[0].preference.value, 'zh-CN');
    assert.equal(envelope.knowledge.material.preferences.semantics, 'preference_not_authority');
    assert.equal(JSON.stringify(envelope.facts).includes('999999'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(envelope.knowledge.material)) <= 16384);
    assert.equal(envelope.knowledge.material.sections.businessFacts, 'core_authoritative_only');
    const searchKeys = new Set(k.policyReads.filter(row => row.domain === 'knowledge' && row.action === 'search').map(row => row.resourceKey));
    assert.ok(searchKeys.size >= 2, 'scope and document search are distinct persisted grants');
    const command = { original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id };
    const read = await h.model.readModelResult(command);
    assert.equal(read.status, 'available'); assert.deepEqual(read.knowledge, envelope.knowledge);
    const searchCount = k.db.queries.filter(query => query.where.text?.contains !== undefined).length;
    assert.ok(searchCount > 0);
    const opened = await h.model.reopenModelSource({ ...command, sourceKind: 'knowledge', sourceIndex: 0 });
    assert.equal(opened.source.text, k.text); assert.equal(opened.reference.documentId, k.document.documentId);
    assert.equal(k.db.queries.filter(query => query.where.text?.contains !== undefined).length, searchCount,
      'readback must not recollect replacement sources');
    assert.equal(k.fileReads(), 1, 'source reopen reads stored chunks, never raw storage');
    await assert.rejects(h.model.reopenModelSource({ ...command, sourceKind: 'knowledge', sourceIndex: 4 }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    await assert.rejects(h.model.reopenModelSource({ ...command, sourceKind: 'knowledge', sourceIndex: 0, url: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
    const sourcePolicy = k.policyRows.find(row => row.domain === 'knowledge' && row.action === 'resolve_source' && row.resource.documentId);
    sourcePolicy.enabled = false;
    await assert.rejects(h.model.readModelResult(command), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    await assert.rejects(h.model.reopenModelSource({ ...command, sourceKind: 'knowledge', sourceIndex: 0 }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    sourcePolicy.enabled = true;
    await k.bundle.memory.revoke({ memoryId: 'scene-preference', expectedRevision: 2 });
    await assert.rejects(h.model.readModelResult(command), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiTaskResultArtifact.length, 1);
  }
});

test('scene knowledge revocation at final Gateway route check prevents transport without false success', { timeout: 30000 }, async () => {
  const { originalModelApplicationHarness, originalSceneKnowledgeFixture } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h = await originalModelApplicationHarness('order_explanation', originalSceneKnowledgeFixture);
  let revoked = false;
  h.execution.beforeRouteCheck = async () => {
    if (h.execution.events.includes('dispatch')) {
      revoked = true;
      h.supplemental.policyRows.filter(row => row.action === 'resolve_source').forEach(row => { row.enabled = false; });
    }
  };
  const result = await h.app.start(h.reference);
  assert.equal(revoked, true); assert.equal(h.execution.sent.length, 0);
  assert.notEqual(result.execution.outcome.status, 'succeeded');
  assert.equal(h.state.aiTaskActionInput.length, 1); assert.equal(h.state.aiGatewayInvocation.length, 1);
  assert.ok(h.state.aiTaskResultArtifact.every(row => row.outcome !== 'SUCCEEDED'));
  const read = await h.model.readModelResult({ original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id });
  assert.equal(read.text, null);
});

test('scene knowledge with missing exact policy cannot publish model material or invent empty readiness', { timeout: 30000 }, async () => {
  const { originalModelApplicationHarness, originalSceneKnowledgeFixture } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h = await originalModelApplicationHarness('order_explanation', originalSceneKnowledgeFixture);
  h.supplemental.policyRows.filter(row => row.action === 'search').forEach(row => { row.enabled = false; });
  await assert.rejects(h.app.start(h.reference), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.aiTaskActionInput.length, 0); assert.equal(h.state.aiTaskRunPlan.length, 0);
  assert.equal(h.execution.sent.length, 0); assert.equal(h.state.aiGatewayInvocation.length, 0);
});

test('request-bound model runs original scenes and reads knowledge results without borrowing request identity', { timeout: 60000 }, async () => {
  const { requestBoundOriginalModelHarness, originalSceneKnowledgeFixture } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const { composeRequestBoundOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  for (const sceneCode of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) {
    const h = await requestBoundOriginalModelHarness(sceneCode, originalSceneKnowledgeFixture), app = h.requests;
    const request = structuredClone(h.request), reference = structuredClone(h.reference);
    assert.equal(h.execution.sent.length, 0); assert.equal(h.factoryCalls.length, 0);
    assert.equal(h.state.aiRun[0].status, 'QUEUED');
    assert.throws(() => composeRequestBoundOriginalSceneModel(h.modelDependencies, h.options), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    assert.throws(() => composeRequestBoundOriginalSceneModel(h.requestDependencies, { ...h.options, enabled: false }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    assert.throws(() => composeRequestBoundOriginalSceneModel(h.requestDependencies, { ...h.options, runServices: h.run }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
    for (const method of ['runtime', 'createApplication', 'prepareHeldRun', 'submitSelectedOrder']) assert.equal(app[method], undefined);
    await assert.rejects(app.start(h.request, { ...h.reference, lease: {}, prompt: 'forged' }), e => e.code === 'AI_INVALID_INPUT');
    h.options.host.holderId = 'mutated-after-assembly';
    h.execution.beforeTransport = async () => {
      request.headers.authorization = 'Bearer mutated-after-await'; reference.inputRef = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      await runWithRequestIdentity({ tenantId: 'tenant_001', workspaceId: 'workspace-a', userId: h.b.h.identity.user.id }, async () => {
        await assert.rejects(app.readInput({ headers: {} }, h.reference), e => e.code === 'AI_ACCESS_DENIED');
        await assert.rejects(app.readInput({ headers: { authorization: 'Bearer wrong' } }, h.reference), e => e.code === 'AI_ACCESS_DENIED');
      });
    };
    const run = await app.start(request, reference);
    assert.equal(run.execution.outcome.status, 'succeeded'); assert.equal(run.original.inputRef, h.reference.inputRef);
    assert.equal(h.state.aiGatewayInvocation[0].leaseOwnerId, 'request-worker');
    assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), '1'); assert.equal(h.execution.sent.length, 1);
    assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.state.aiTaskExecutionCharge.length, 4);
    for (const input of h.factoryCalls) await assert.rejects(input.credentials.current(), e => e.code === 'AI_ACCESS_DENIED');
    const resultCommand = { original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id };
    const result = await app.readModelResult(h.request, resultCommand);
    assert.equal(result.status, 'available'); assert.equal(result.knowledge.originalInputRef, h.reference.inputRef);
    const source = await app.reopenModelSource(h.request, { ...resultCommand, sourceKind: 'knowledge', sourceIndex: 0 });
    assert.equal(source.reference.documentId, h.supplemental.document.documentId);
    assert.equal(await app.readInput(h.request, h.reference), null);
    assert.deepEqual(await app.reconcile(h.request, h.reference), { kind: 'not_started', reason: 'recovery_lease_unavailable' });
    await assert.rejects(app.resume(h.request, { original: h.reference, submission: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION,
      taskId: 'another-task', requestId: 'input-request', expectedRevision: 1, submissionKey: 'answer-a',
      answers: [{ fieldId: 'clarification_text', value: 'Synthetic clarification' }] } }), e => e.code === 'AI_ACCESS_DENIED');
    h.b.h.identity.session = false;
    await assert.rejects(app.readModelResult(h.request, resultCommand), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
    await assert.rejects(app.reopenModelSource(h.request, { ...resultCommand, sourceKind: 'knowledge', sourceIndex: 0 }), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
    assert.equal(h.execution.sent.length, 1);
  }
});

test('request-bound model keeps unknown receipts and cancellation distinct from redispatch', { timeout: 30000 }, async () => {
  const { requestBoundOriginalModelHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const h = await requestBoundOriginalModelHarness(), app = h.requests;
  delete h.execution.result.usage;
  const run = await app.start(h.request, h.reference);
  assert.equal(run.execution.outcome.status, 'unknown'); assert.equal(h.execution.sent.length, 1);
  const command = { original: h.reference, resultId: h.state.aiTaskResultArtifact[0].id };
  assert.equal((await app.readModelResult(h.request, command)).text, null);
  await app.reconcile(h.request, h.reference);
  h.state.aiTaskPlanPolicy[0].enabled = false;
  const cancel = await app.requestCancel(h.request, { original: h.reference, expectedRevision: h.state.aiTask[0].revision });
  assert.equal(cancel.cancellation, 'requested_not_rollback');
  assert.equal(h.state.aiGatewayAccountingReceipt[0].inputTokens, null);
  assert.equal(h.state.aiBudgetReservation[0].status, 'pending_reconciliation');
  assert.equal(h.execution.sent.length, 1); assert.equal(h.state.aiGatewayInvocation.length, 1);
  const aborted = await requestBoundOriginalModelHarness(), signal = new AbortController(); signal.abort();
  const stopped = await aborted.requests.start(aborted.request, aborted.reference, signal.signal);
  assert.deepEqual(stopped.execution, { kind: 'not_started', reason: 'host_aborted' });
  assert.equal(aborted.state.aiRun[0].status, 'QUEUED'); assert.equal(aborted.state.aiTaskActionInput.length, 0);
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
