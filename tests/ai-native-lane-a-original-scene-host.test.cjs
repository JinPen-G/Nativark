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
  // Exercise the real task-center consumer, with current original/task
  // repositories intact; only the optional downstream host boundary is fake.
  await assert.rejects(center.readInput({ original: ref }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  let reviews = 0;
  const detail = composeAiTaskCenterScene({ list: { readPage: async () => { throw Error('not used'); } }, scenes: h.app,
    input: { read: async original => { assert.deepEqual(original, ref); return null; } },
    approvals: { readSelectedProposal: async () => { reviews++; throw Error('must not reach another task'); },
      readSelectedDecisionReceipt: async () => { throw Error('not used'); } } });
  assert.equal((await detail.readInput({ original: ref, taskId: task.id })).input, null);
  const another = { selection: { draftVersion: 'ain-quote-selection-draft-1', originalInputRef: ref.inputRef,
    selectionId: '00000000-0000-4000-8000-000000000001', taskId: '00000000-0000-4000-8000-000000000002', runId: created.task.runId, inputHash: 'a'.repeat(64) }, proposal: {} };
  await assert.rejects(detail.readApprovalReview({ original: ref, reference: another }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(reviews, 0);
  const revoked = composeAiTaskCenterScene({ list: { readPage: async () => { throw Error('not used'); } }, scenes: h.app,
    input: { read: async () => { h.b.h.identity.session = false; return { stale: 'must not return' }; } } });
  await assert.rejects(revoked.readInput({ original: ref }), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  h.b.h.identity.session = true;
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
  let revoked = false, revokeDuringRead = false, authorization, reads = 0, rateAllowed = true;
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
    auth, { assertAllowed: async () => { if (!rateAllowed) throw Error('client policy unavailable'); } });
  const client = Object.assign(Object.create(ClientApiService.prototype), { core: { getOrder: async (tenantId, id) => {
    reads++; assert.equal(tenantId, 'tenant-client'); assert.equal(getRequestIdentity().workspaceId, 'workspace-client');
    if (revokeDuringRead) revoked = true;
    return { id, tenantId, customerId: id === 'other-order' ? 'another-customer' : 'person-client',
      status: 'reserved', quoteId: 'quote-client', currency: 'CNY', payableAmount: 0, rentalAmount: 12,
      lines: [], chargeLines: [], allocations: [], internalNote: 'never expose' };
  } }, feeItems: async (context, id) => {
    assert.equal(context.tenantId, 'tenant-client'); assert.equal(id, 'own-order');
    return { apiVersion: 'client-v1', orderId: id, items: [{ inspectionId: 'inspection-client', exceptionIndex: 0,
      stage: 'return', code: 'damage', description: '待本人核对', amount: 12, currency: 'CNY',
      responseStatus: 'pending', evidenceCount: 1, internalReview: 'private-review' }], pendingCount: 1, internalNote: 'private-fees' };
  } });
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
  revoked = false; revokeDuringRead = false;
  let published = true, now = new Date();
  const workspace = { id: 'workspace-client', code: 'camera', name: 'Synthetic', categoryCode: 'camera', isDefault: true, status: 'ACTIVE' };
  const channelProfile = () => ({ helpIntro: 'Public help only', helpFaqJson: [{ question: 'How?', answer: 'Ask the merchant.' }],
    updatedAt: new Date('2026-10-01'), publishedWorkspaces: published ? [{ workspaceId: workspace.id, workspace }] : [] });
  Object.assign(client, {
    prisma: { tenant: { findFirst: async ({ where }) => where.code === 'tenant' ? { id: 'tenant-client', code: 'tenant', name: 'Synthetic' } : null },
      clientChannelProfile: { findUnique: async () => channelProfile() }, tenantAppearanceProfile: { findUnique: async () => null },
      businessWorkspace: { findMany: async () => [{ id: workspace.id }], findFirst: async ({ where }) => {
        assert.equal(where.clientChannelPublications.some.enabled, true);
        return published && where.tenantId === 'tenant-client' && where.code === 'camera' ? workspace : null;
      } } },
    tenantIntegrations: { catalog: async () => ({ configs: [] }) },
    buildCatalog: async (_tenant, tenantCode, current) => ({ tenantCode, workspace: current, items: [] }),
    profileRow: async context => ({ id: context.customerId, customerType: context.customerType, name: 'Synthetic',
      phoneMasked: '***', identityVerified: false, account: { status: 'active' }, contacts: [], internalReview: 'never expose' }),
    currentWorkspace: async () => workspace,
    context: async () => ({ profile: {}, settings: {} }),
    business: { getQuote: () => ({ id: 'quote-client' }), calculateCancellationCharge: () => 12 }
  });
  Object.assign(client.core, { listCategories: () => [{ code: 'camera', name: 'Synthetic' }],
    getBusinessSettings: () => ({ fulfillment: { enabledModes: [] } }) });
  const { composeRequestBoundClientApplication } = require('../apps/api/src/modules/ai-native/scenes/client-request.application');
  const { createTaskInputStore, clone } = require('./fixtures/ai-native/task-input-store.cjs');
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const { AsyncLocalStorage } = require('node:async_hooks');
  const scopes = [{ kind: 'platform' }, { kind: 'tenant', tenantId: 'tenant-client' },
    { kind: 'workspace', tenantId: 'tenant-client', workspaceId: 'workspace-client' }].map((scope, index) => ({ id: `client-scope-${index}`, ...aiPersistenceScopeColumns(scope) }));
  const sceneCode = 'client_material', sceneVersion = '1';
  const settingsFor = scope => ({ draftVersion: 'ain-c07-draft-2', config: { configRevision: 1 },
    scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant-client' },
    sceneCode, allowedScenes: [sceneCode], allowedModels: ['synthetic-model'], maxConcurrent: 1, maxCallsPerRun: 1,
    budget: { state: 'limited', quantity: { unit: 'calls', value: 10 } },
    gates: Object.fromEntries(['platform', 'tenant', 'scene'].map(kind => [kind, { enabled: true, revision: 1 }])) });
  const taskStore = createTaskInputStore({ aiScope: scopes, aiTask: [], aiRun: [], aiStep: [], aiTaskRunPlan: [],
    aiBudgetPolicy: scopes.map(scope => ({ id: `${scope.id}-budget`, scopeId: scope.id, scopeKind: scope.kind, sceneCode,
      configRevision: 1, enabled: true, settingsJson: settingsFor(scope) })) },
    { aiTask: [['id'], ['scopeId', 'audience', 'ownerKind', 'ownerId', 'creationKey']] });
  taskStore.control.beforeWrite = async (table, args) => {
    if (table === 'aiTask') Object.assign(args.data, { scope: clone(scopes[2]), archivedAt: null });
  };
  let materialRows = [], taskInputs = [], taskPolicies = [], lostReply = false, materialWrites = 0;
  let bookingRows = { ai_client_booking_drafts: [], ai_client_booking_draft_operations: [], ai_client_booking_handoffs: [] };
  let loseBookingReply = false;
  let lostInputReply = false, lostTaskReply = false, revokeAfterClaim = false, commercialAvailable = true;
  const materialDb = (transactionRows, transactionInputs, transactionBookings) => {
    const rows = () => transactionRows ?? materialRows, inputs = () => transactionInputs ?? taskInputs;
    const bookings = () => transactionBookings ?? bookingRows;
    return { ...client.prisma,
      tenant: { ...client.prisma.tenant, findUnique: async () => ({ subscription: { startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01') }, subscriptionSegments: [] }) },
      $queryRaw: async query => {
        const bookingTable = query.sql.match(/FROM (ai_client_booking_\w+)\b/u)?.[1];
        if (bookingTable) {
          const [tenantId, workspaceId, channel, principalHash, reference] = query.values;
          const field = query.sql.includes('AND operationKey =') ? 'operationKey' : query.sql.includes('AND materialRef =') ? 'materialRef' : 'id';
          return structuredClone(bookings()[bookingTable].filter(row => row.tenantId === tenantId && row.workspaceId === workspaceId
            && row.channel === channel && row.principalHash === principalHash && row[field] === reference));
        }
        if (query.sql.includes('FROM ai_client_task_policies')) {
          const [tenantId, workspaceId, channel, customerType, sceneCode, sceneVersion] = query.values;
          return structuredClone(taskPolicies.filter(row => row.tenantId === tenantId && row.workspaceId === workspaceId
            && row.channel === channel && row.customerType === customerType && row.sceneCode === sceneCode && row.sceneVersion === sceneVersion));
        }
        const taskInput = query.sql.includes('FROM ai_client_task_inputs');
        assert.ok(taskInput || query.sql.includes('FROM ai_client_scene_materials'));
        const [tenantId, workspaceId, channel, principalHash, reference] = query.values;
        const field = taskInput ? 'creationKey' : query.sql.includes('AND operationKey =') ? 'operationKey' : 'id';
        return structuredClone((taskInput ? inputs() : rows()).filter(row => row.tenantId === tenantId && row.workspaceId === workspaceId
          && row.channel === channel && row.principalHash === principalHash && row[field] === reference));
      },
      $executeRaw: async query => {
        const bookingTable = query.sql.match(/(?:INSERT INTO|UPDATE) (ai_client_booking_\w+)\b/u)?.[1];
        if (bookingTable) {
          const table = bookings()[bookingTable];
          if (query.sql.startsWith('INSERT')) {
            const columns = query.sql.match(/\(([^)]+)\)\s+VALUES/u)[1].split(',').map(value => value.trim());
            const row = Object.fromEntries(columns.map((key, index) => [key, structuredClone(query.values[index])]));
            const scopeMatch = other => ['tenantId', 'workspaceId', 'channel', 'principalKind', 'principalHash'].every(key => other[key] === row[key]);
            const key = bookingTable === 'ai_client_booking_drafts' ? 'materialRef' : bookingTable === 'ai_client_booking_handoffs' ? 'draftId' : 'operationKey';
            assert.equal(table.some(other => other.id === row.id || (scopeMatch(other) && other[key] === row[key])), false);
            assert.ok((bookingTable === 'ai_client_booking_drafts' ? rows() : bookings().ai_client_booking_drafts)
              .some(other => scopeMatch(other) && other.id === (row.materialRef ?? row.draftId)));
            table.push(row); return 1;
          }
          const columns = query.sql.match(/SET ([\s\S]+?)\s+WHERE/u)[1].split(',').map(value => value.trim().split(' ')[0]);
          const conditions = [...query.sql.split('WHERE')[1].matchAll(/(\w+)\s*(=|>)\s*\?/gu)];
          const targets = table.filter(row => conditions.every(([_, field, operator], index) => {
            const value = query.values[columns.length + index];
            return operator === '=' ? row[field] === value : row[field] > value;
          }));
          for (const row of targets) columns.forEach((key, index) => { row[key] = structuredClone(query.values[index]); });
          return targets.length;
        }
        const taskInput = query.sql.startsWith('INSERT INTO ai_client_task_inputs');
        assert.ok(taskInput || query.sql.startsWith('INSERT INTO ai_client_scene_materials'));
        const columns = query.sql.match(/\(([^)]+)\)\s+VALUES/u)[1].split(',').map(value => value.trim());
        const row = Object.fromEntries(columns.map((key, index) => [key, structuredClone(query.values[index])]));
        if (!taskInput) for (const key of ['command', 'material', 'publication']) row[key] = JSON.parse(row[key]);
        const key = taskInput ? 'creationKey' : 'operationKey', table = taskInput ? inputs() : rows();
        assert.equal(table.some(current => current.tenantId === row.tenantId && current.workspaceId === row.workspaceId
          && current.channel === row.channel && current.principalHash === row.principalHash && current[key] === row[key]), false);
        table.push(row); if (!taskInput) materialWrites++; return 1;
      } };
  };
  const db = { ...taskStore.db, ...materialDb() }, activeTransaction = new AsyncLocalStorage();
  const taskProjection = client => ({ ...client.aiTask, findFirst: async args => {
    if (!args.select?.runs) return client.aiTask.findFirst(args);
    const row = await client.aiTask.findFirst({ ...args, select: undefined });
    if (!row) return null;
    row.runs = await client.aiRun.findMany({ where: { taskId: row.id, sequence: 1 }, take: 1 });
    return row;
  } });
  db.aiTask = taskProjection(taskStore.db);
  const scopeUpsert = async ({ where }) => clone(scopes.find(scope => scope.scopeKey === where.scopeKey));
  db.aiScope = { ...db.aiScope, upsert: scopeUpsert };
  let transactionTail = Promise.resolve();
  db.$transaction = work => {
    if (activeTransaction.getStore()) return work(activeTransaction.getStore());
    const pending = transactionTail.then(async () => {
      const rows = structuredClone(materialRows), inputs = structuredClone(taskInputs), bookings = structuredClone(bookingRows);
      const priorInputs = inputs.length, priorTasks = taskStore.state.aiTask.length;
      const priorOperations = bookings.ai_client_booking_draft_operations.length;
      const result = await taskStore.db.$transaction(tx => {
        const current = { ...tx, ...materialDb(rows, inputs, bookings), aiTask: taskProjection(tx), aiScope: { ...tx.aiScope, upsert: scopeUpsert } };
        return activeTransaction.run(current, () => work(current));
      });
      materialRows = rows; taskInputs = inputs; bookingRows = bookings;
      if (revokeAfterClaim && inputs.length > priorInputs) taskPolicies[0].allowCreate = false;
      if ((lostInputReply && inputs.length > priorInputs) || (lostTaskReply && taskStore.state.aiTask.length > priorTasks)) throw Error('synthetic client task COMMIT response lost');
      if (loseBookingReply && bookings.ai_client_booking_draft_operations.length > priorOperations) throw Error('synthetic booking COMMIT response lost');
      if (lostReply) throw Error('synthetic material COMMIT response lost');
      return result;
    });
    transactionTail = pending.catch(() => {});
    return pending;
  };
  const dependencies = { guard, client, db, clock: () => now };
  const configuration = { enabled: true, tenantCode: 'tenant', serviceCode: 'camera', channel: 'app' };
  const requests = composeRequestBoundClientApplication(dependencies, configuration), request = { headers: { authorization } };
  let operation = 0;
  const prepare = (req, command) => requests.prepare(req, { operationKey: `client-operation-${++operation}`, command });
  assert.throws(() => composeRequestBoundClientApplication({ ...dependencies, session: source }, configuration), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  const help = await requests.readPublic({ headers: {} }, { kind: 'help' });
  assert.equal(help.material.intro, 'Public help only'); assert.ok(Object.isFrozen(help.material));
  assert.equal(help.materialRef, null); assert.equal(materialRows.length, 0);
  rateAllowed = false;
  await assert.rejects(requests.readPublic({ headers: {} }, { kind: 'help' }), /client policy unavailable/);
  rateAllowed = true;
  assert.equal((await requests.readPublic({ headers: {} }, { kind: 'catalog' })).material.workspace.workspaceCode, 'camera');
  await assert.rejects(prepare({ headers: {} }, { kind: 'help' }), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  await assert.rejects(prepare({ headers: {} }, { kind: 'profile' }), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  await assert.rejects(prepare(request, { kind: 'order', orderId: 'own-order', tenantId: 'forged' }), /AI_CLIENT_INVALID_INPUT/);
  const own = await prepare(request, { kind: 'order', orderId: 'own-order' });
  assert.equal(own.material.internalNote, undefined);
  const clientExplanation = await requests.readOrderExplanation(request, { orderId: 'own-order', question: 'fees' });
  assert.equal(clientExplanation.facts.inspectionFees.value.items[0].amount, 12);
  assert.equal(clientExplanation.facts.inspectionFees.value.items[0].responseStatus, 'pending');
  assert.equal(JSON.stringify(clientExplanation).includes('private-'), false);
  const originalFees = client.feeItems;
  client.feeItems = undefined;
  const missingFees = await requests.readOrderExplanation(request, { orderId: 'own-order', question: 'fees' });
  assert.equal(missingFees.facts.inspectionFees.coverage, 'unavailable');
  assert.equal(missingFees.facts.amounts.payableAmount.value, 0);
  client.feeItems = async (...args) => ({ ...await originalFees(...args), orderId: 'another-order' });
  await assert.rejects(requests.readOrderExplanation(request, { orderId: 'own-order', question: 'fees' }), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  client.feeItems = originalFees;
  const cancelPreview = await requests.readOrderCancellationPreview(request, { orderId: 'own-order' });
  assert.equal(cancelPreview.preview.cancellationCharge, 12);
  assert.equal(cancelPreview.handoff.execution, 'not_attempted');
  assert.equal(cancelPreview.businessResult, 'not_inferred');
  const explanation = await requests.readOrderExplanation(request, { orderId: 'own-order', question: 'fees' });
  assert.equal(explanation.facts.amounts.payableAmount.value, 0);
  assert.equal(explanation.facts.amounts.depositAmount.coverage, 'unknown');
  assert.equal(explanation.facts.gaps.payments, 'not_loaded_no_received_total_inferred');
  assert.equal(explanation.facts.customerName, undefined); assert.equal(explanation.facts.internalNote, undefined);
  assert.equal((await requests.readOrderExplanation(request, { orderId: 'own-order' })).facts.amounts, undefined);
  await assert.rejects(requests.readOrderExplanation(request, { orderId: 'other-order' }), e => e.getStatus?.() === 404);
  await assert.rejects(requests.readOrderExplanation(request, { orderId: 'own-order', question: 'sql' }), /AI_CLIENT_INVALID_INPUT/);
  revokeDuringRead = true;
  await assert.rejects(requests.readOrderExplanation(request, { orderId: 'own-order' }), e => e.getStatus?.() === 401);
  revoked = false; revokeDuringRead = false;
  assert.equal(own.durability, 'persisted_client_material_not_task_history');
  const restarted = composeRequestBoundClientApplication(dependencies, configuration);
  assert.equal((await restarted.readSource(request, { materialRef: own.materialRef })).materialHash, own.materialHash);
  const originalCommand = { operationKey: own.operationKey, command: { kind: 'order', orderId: 'own-order' } };
  await assert.rejects(restarted.readOperation({ headers: {} }, originalCommand), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  const beforeReplay = materialWrites;
  assert.equal((await restarted.prepare(request, originalCommand)).replayed, true);
  assert.equal(materialWrites, beforeReplay);
  await assert.rejects(restarted.prepare(request, { ...originalCommand, command: { kind: 'profile' } }), e => e.code === 'AI_CLIENT_REVISION_CONFLICT');
  const missing = await restarted.readOperation(request, { ...originalCommand, operationKey: 'not-observed' });
  assert.equal(missing.state, 'unknown'); assert.equal(missing.retryable, false);
  const lostCommand = { ...originalCommand, operationKey: 'client-ack' };
  lostReply = true;
  await assert.rejects(restarted.prepare(request, lostCommand), e => e.code === 'AI_CLIENT_RESULT_UNKNOWN' && e.nextAction === 'readOperation');
  lostReply = false;
  const afterLost = materialWrites, recovered = await requests.readOperation(request, lostCommand);
  assert.equal(recovered.state, 'saved'); assert.equal(materialWrites, afterLost);
  assert.equal((await restarted.readSource(request, { materialRef: recovered.materialRef })).materialHash, recovered.materialHash);
  const distinctCase = await restarted.prepare(request, { ...lostCommand, operationKey: 'CLIENT-ACK' });
  assert.notEqual(distinctCase.materialRef, recovered.materialRef);
  assert.equal(materialRows.some(row => row.principalKind === 'guest'), false);
  assert.equal(JSON.stringify(materialRows).includes(authorization), false);
  assert.equal(JSON.stringify(materialRows).includes('session-client'), false);
  assert.equal((await prepare(request, { kind: 'profile' })).material.internalReview, undefined);
  const preview = await prepare(request, { kind: 'cancellation_preview', orderId: 'own-order' });
  assert.equal(preview.material.cancellationCharge, 12); assert.equal(preview.material.estimated, true);
  assert.equal(preview.handoff.path, '/api/client/v1/orders/own-order/cancel'); assert.equal(preview.handoff.execution, 'not_attempted');
  assert.equal((await requests.readSource(request, { materialRef: preview.materialRef })).materialHash, preview.materialHash);
  await assert.rejects(prepare(request, { kind: 'order', orderId: 'other-order' }), e => e.getStatus?.() === 404);
  const subscriptions = { readCategoryCommercialContext: async (tenantId, _tx, _now, features) => {
    assert.equal(tenantId, 'tenant-client'); assert.deepEqual(features, ['ai.native.use']);
    return { revision: 1, serviceStatus: 'active', newBusinessAllowed: true,
      entitlements: [{ code: 'ai.native.use', available: commercialAvailable, categories: [] }] };
  } };
  const taskDependencies = { ...dependencies, tasks: { db, subscriptions, sceneCode, sceneVersion } };
  const clientTasks = composeRequestBoundClientApplication(taskDependencies, configuration);
  const taskCommand = { creationKey: 'client-create-1', materialRef: own.materialRef };
  await assert.rejects(clientTasks.createTask({ headers: {} }, taskCommand), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  await assert.rejects(clientTasks.createTask(request, { ...taskCommand, sceneCode: 'forged' }), /AI_CLIENT_INVALID_INPUT/);
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(taskInputs.length, 0); assert.equal(taskStore.state.aiTask.length, 0);
  taskPolicies.push({ id: 'b77ec266-e3a2-48a4-98be-d5b49222d5b1', tenantId: 'tenant-client', workspaceId: 'workspace-client',
    channel: 'app', customerType: 'personal', sceneCode, sceneVersion, enabled: 1, allowCreate: 1, allowRead: 1,
    revision: 1, expiresAt: new Date('2027-01-01') });
  taskPolicies[0].allowCreate = 0;
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal((await clientTasks.readTaskCreation(request, taskCommand)).state, 'unknown');
  taskPolicies[0].allowCreate = 1;
  taskStore.state.aiBudgetPolicy[0].enabled = false;
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  taskStore.state.aiBudgetPolicy[0].enabled = true;
  taskStore.state.aiBudgetPolicy[2].settingsJson.maxConcurrent = 0;
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  taskStore.state.aiBudgetPolicy[2].settingsJson.maxConcurrent = 1;
  commercialAvailable = false;
  await assert.rejects(clientTasks.createTask(request, taskCommand), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  commercialAvailable = true;
  assert.equal(taskInputs.length, 0);
  const created = await clientTasks.createTask(request, taskCommand);
  assert.equal(created.state, 'observed'); assert.equal(created.task.status, 'queued');
  assert.equal(taskStore.state.aiTask.length, 1); assert.equal(taskStore.state.aiRun.length, 1);
  assert.equal(taskStore.state.aiTask[0].ownerKind, 'CUSTOMER'); assert.equal(taskStore.state.aiTask[0].ownerId, 'person-client');
  assert.equal(taskStore.state.aiTask[0].audience, 'CLIENT'); assert.equal(taskStore.state.aiTask[0].inputRef, taskInputs[0].id);
  assert.equal(taskStore.state.aiTask[0].inputHash, taskInputs[0].inputHash);
  assert.equal(taskStore.state.aiRun[0].fencingToken.toFixed(0), '0'); assert.equal(taskInputs[0].dispatchState, 'UNKNOWN');
  const countCreates = () => taskStore.trace.filter(value => value === 'aiTask.create').length;
  const { AI_ENTRY_ACTION_CONTRACT_VERSION } = require('../packages/shared/src/ai-entry-action-draft');
  const entryConfig = { ...configuration, channel: 'web', entry: { enabled: true, releaseRevision: 'entry-1' } };
  client.prisma.websiteChannelProfile = { findUnique: async () => null };
  taskPolicies.push({ ...taskPolicies[0], channel: 'web', id: '70156b36-e02f-4aba-9f41-54d850bc1bdb' });
  const entry = composeRequestBoundClientApplication(taskDependencies, entryConfig);
  const entryMaterial = await entry.prepare(request, { operationKey: 'entry-order', command: { kind: 'order', orderId: 'own-order' } });
  const issued = await entry.issueAction(request, { actionCode: 'OPEN_ORDER', materialRef: entryMaterial.materialRef });
  assert.equal(issued.contractVersion, AI_ENTRY_ACTION_CONTRACT_VERSION);
  assert.equal(issued.surface, 'tenant_website'); assert.equal(issued.audience, 'customer');
  assert.equal(issued.resource.resourceVersion, entryMaterial.materialHash);
  const entryRestart = composeRequestBoundClientApplication(taskDependencies, entryConfig);
  assert.deepEqual(await entryRestart.readAction(request, issued), issued);
  const beforeActionReplay = materialWrites;
  assert.equal((await entryRestart.consumeOrderAction(request, issued)).orderId, 'own-order');
  assert.equal((await entryRestart.consumeOrderAction(request, issued)).execution, 'navigation_not_business_submission');
  assert.equal(materialWrites, beforeActionReplay); assert.equal(countCreates(), 1);
  for (const altered of [{ ...issued, url: 'javascript:alert(1)' }, { ...issued, contractVersion: 'unknown' },
    { ...issued, actionCode: 'OPEN_PAYMENT' }, { ...issued, surface: 'client_miniprogram' },
    { ...issued, resource: { ...issued.resource, id: 'other-order' } }]) await assert.rejects(entryRestart.readAction(request, altered));
  await assert.rejects(requests.readAction(request, issued), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  taskStore.state.aiBudgetPolicy[0].enabled = false;
  await assert.rejects(entry.readAction(request, issued), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  taskStore.state.aiBudgetPolicy[0].enabled = true;
  taskPolicies[1].revision++;
  await assert.rejects(entry.readAction(request, issued), e => ['AI_ACCESS_DENIED', 'AI_PROPOSAL_STALE'].includes(e.code));
  taskPolicies[1].revision--;
  revokeDuringRead = true; await assert.rejects(entry.readAction(request, issued));
  revoked = false; revokeDuringRead = false;
  const taskRestart = composeRequestBoundClientApplication(taskDependencies, configuration), beforeDuplicate = countCreates();
  let bookingAvailable = true, stockObservation = 5, corporateAllowed = true;
  const bookingSelection = { quoteId: 'quote-client', timeZone: 'Asia/Shanghai',
    startAt: new Date(now.getTime() + 86400000).toISOString(), endAt: new Date(now.getTime() + 172800000).toISOString(),
    fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'location-client',
    bookingIdentity: { bookingIdentity: 'personal', enterpriseContractAndPayer: false }, lines: [{ itemGroupId: 'item-client', quantity: 1 }] };
  let bookingQuote = { id: 'quote-client', tenantId: 'tenant-client', categoryCode: 'camera',
    request: { ...bookingSelection, customerType: 'personal', customerId: 'person-client' },
    membershipSnapshot: { bookingIdentity: 'personal', personalCustomerId: 'person-client', enterpriseContractAndPayer: false },
    pricingContext: { timeZone: 'Asia/Shanghai' }, pricingPlanVersion: 'prices-1', ruleVersion: 'rules-1', currency: 'CNY',
    payableAmount: 12, depositAmount: 0, preAuthAmount: 0, chargeLines: [{ type: 'rental', amount: 12 }],
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600000).toISOString() };
  client.auth = auth;
  auth.listPublicWorkspaces = async () => ({ workspaces: [{ ...workspace }] });
  client.memberships = { listBookingOptions: async () => corporateAllowed ? [{ corporateCustomerId: 'corporate-client',
    corporateCustomerName: 'Synthetic Corp', corporateMembershipId: 'relation-client' }] : [] };
  client.buildCatalog = async (_tenant, tenantCode, summary) => ({ tenantCode, workspace: summary, categoryCode: 'camera',
    timeZone: 'Asia/Shanghai', items: [{ id: 'item-client', code: 'item', name: 'Synthetic Item' }], pricingGroups: [], services: [],
    locations: [{ id: 'location-client', code: 'loc', name: 'Synthetic Location', status: 'enabled', capabilities: ['pickup', 'return'] }],
    fulfillment: { enabledModes: ['store_pickup_return'], allowDifferentReturnLocation: false, deliveryDestination: 'customer_address' } });
  client.business.getQuote = (_tenant, _context, id) => ({ ...structuredClone(bookingQuote), id,
    request: { ...structuredClone(bookingQuote.request), customerId: id === 'foreign-quote' ? 'someone-else' : 'person-client' } });
  client.core.availability = async (_tenant, command) => ({ ...command, available: bookingAvailable,
    lines: command.lines.map(line => ({ itemGroupId: line.itemGroupId, requestedQuantity: line.quantity,
      available: bookingAvailable, availableQuantity: stockObservation, reasons: [] })) });
  const bookingApp = composeRequestBoundClientApplication(taskDependencies, entryConfig);
  const makeBookingAction = async key => {
    const material = await bookingApp.prepare(request, { operationKey: key, command: { kind: 'booking_quote', selection: bookingSelection } });
    return bookingApp.issueAction(request, { actionCode: 'CREATE_BOOKING_DRAFT', materialRef: material.materialRef });
  };
  for (const selection of [{ ...bookingSelection, startAt: '明天下午' }, { ...bookingSelection, source: 'model_candidate' },
    { ...bookingSelection, timeZone: 'UTC' }, { ...bookingSelection, quoteId: 'foreign-quote' }]) {
    await assert.rejects(bookingApp.prepare(request, { operationKey: 'invalid-booking', command: { kind: 'booking_quote', selection } }));
  }
  const draftAction = await makeBookingAction('booking-material-1');
  const createDraft = { operationKey: 'create-draft-1', action: draftAction };
  const draftCreated = await bookingApp.createBookingDraft(request, createDraft);
  assert.equal(draftCreated.draft.state, 'draft_created'); assert.equal(draftCreated.draft.action, null);
  assert.equal(draftCreated.draft.material.quote.depositAmount, 0);
  assert.equal(draftCreated.draft.material.sources.returnLocationId, 'core_normalized');
  assert.equal(draftCreated.draft.material.availability, 'available_at_observation_not_reserved');
  assert.equal((await bookingApp.createBookingDraft(request, createDraft)).draft.bookingDraftId, draftCreated.draft.bookingDraftId);
  await assert.rejects(bookingApp.createBookingDraft(request, { ...createDraft, operationKey: 'different-key-same-action' }), e => e.code === 'AI_REVISION_CONFLICT');
  const selectDraft = { bookingDraftId: draftCreated.draft.bookingDraftId, expectedRevision: 1,
    inputFingerprint: draftCreated.draft.inputFingerprint, operationKey: 'select-draft-1', decision: 'continue_booking' };
  await assert.rejects(bookingApp.chooseBookingDraft(request, { ...selectDraft, expectedRevision: 2 }), e => e.code === 'AI_REVISION_CONFLICT');
  const selected = await bookingApp.chooseBookingDraft(request, selectDraft);
  assert.equal(selected.draft.state, 'user_selected'); assert.equal(selected.draft.selectionRevision, 1);
  assert.equal(selected.draft.action.actionCode, 'OPEN_BOOKING');
  assert.equal((await bookingApp.chooseBookingDraft(request, selectDraft)).replayed, true);
  const handoffCommand = { operationKey: 'handoff-draft-1', action: selected.draft.action };
  const handed = await bookingApp.handoffBookingDraft(request, handoffCommand);
  assert.equal(handed.handoff.fields.quoteId, bookingSelection.quoteId);
  assert.equal(handed.handoff.submission, 'original_booking_page_required');
  assert.equal(handed.handoff.inventory, 'not_reserved');
  assert.equal((await bookingApp.readBookingDraft(request, { bookingDraftId: draftCreated.draft.bookingDraftId })).state, 'handed_to_booking_page');
  assert.equal((await bookingApp.handoffBookingDraft(request, handoffCommand)).handoff.handoffRef, handed.handoff.handoffRef);
  assert.equal((await bookingApp.readBookingHandoff(request, { handoffRef: handed.handoff.handoffRef })).actionCode, 'OPEN_BOOKING');
  assert.equal(bookingRows.ai_client_booking_drafts.length, 1); assert.equal(bookingRows.ai_client_booking_handoffs.length, 1);
  assert.equal(bookingRows.ai_client_booking_draft_operations.length, 3);
  assert.equal(bookingApp.submitBookingDraft, undefined);
  await assert.rejects(bookingApp.readBookingHandoff(request, { handoffRef: handed.handoff.handoffRef, submitted: true }));
  await assert.rejects(bookingApp.readAction(request, { ...selected.draft.action, surface: 'client_miniprogram' }));
  stockObservation++;
  await assert.rejects(bookingApp.readBookingHandoff(request, { handoffRef: handed.handoff.handoffRef }));
  assert.equal(bookingRows.ai_client_booking_drafts[0].state, 'stale'); stockObservation--;
  await assert.rejects(bookingApp.readBookingDraft(request, { bookingDraftId: draftCreated.draft.bookingDraftId }), e => e.code === 'AI_PROPOSAL_STALE');
  const lostDraftAction = await makeBookingAction('booking-material-lost');
  loseBookingReply = true;
  await assert.rejects(bookingApp.createBookingDraft(request, { action: lostDraftAction, operationKey: 'create-draft-lost' }), e => e.code === 'AI_RESULT_UNKNOWN');
  loseBookingReply = false;
  const afterLostBooking = bookingRows.ai_client_booking_drafts.length;
  const recoveredBooking = await bookingApp.readBookingOperation(request, { operationKey: 'create-draft-lost' });
  assert.equal(recoveredBooking.state, 'observed'); assert.equal(recoveredBooking.businessSubmission, 'not_attested');
  assert.equal(bookingRows.ai_client_booking_drafts.length, afterLostBooking);
  const recoveredDraft = await bookingApp.readBookingDraft(request, { bookingDraftId: recoveredBooking.bookingDraftId });
  await bookingApp.chooseBookingDraft(request, { bookingDraftId: recoveredDraft.bookingDraftId, expectedRevision: recoveredDraft.revision,
    inputFingerprint: recoveredDraft.inputFingerprint, operationKey: 'abandon-lost-draft', decision: 'abandon' });
  await assert.rejects(bookingApp.readBookingDraft(request, { bookingDraftId: recoveredDraft.bookingDraftId }), e => e.code === 'AI_PROPOSAL_STALE');
  const rejectedAction = await makeBookingAction('rejected-before-draft');
  bookingAvailable = false;
  await assert.rejects(bookingApp.readAction(request, rejectedAction));
  bookingAvailable = true;
  await assert.rejects(bookingApp.createBookingDraft(request, { action: rejectedAction, operationKey: 'revive-rejected-action' }), e => e.code === 'AI_PROPOSAL_STALE');
  const repeatedAction = await makeBookingAction('concurrent-booking');
  const repeatedDrafts = await Promise.all([1, 2].map(() => bookingApp.createBookingDraft(request, { action: repeatedAction, operationKey: 'concurrent-draft' })));
  assert.equal(repeatedDrafts[0].draft.bookingDraftId, repeatedDrafts[1].draft.bookingDraftId);
  assert.deepEqual(repeatedDrafts.map(value => value.replayed).sort(), [false, true]);
  bookingSelection.bookingIdentity = { bookingIdentity: 'enterprise_employee', corporateCustomerId: 'corporate-client', enterpriseContractAndPayer: true };
  bookingQuote = { ...bookingQuote, request: { ...bookingQuote.request, bookingIdentity: structuredClone(bookingSelection.bookingIdentity) },
    membershipSnapshot: { ...bookingSelection.bookingIdentity, personalCustomerId: 'person-client', corporateMembershipId: 'relation-client' } };
  const corporateAction = await makeBookingAction('corporate-booking');
  const corporateDraft = await bookingApp.createBookingDraft(request, { action: corporateAction, operationKey: 'create-corporate-draft' });
  corporateAllowed = false;
  await assert.rejects(bookingApp.readBookingDraft(request, { bookingDraftId: corporateDraft.draft.bookingDraftId }), e => e.code === 'AI_ACCESS_DENIED');
  corporateAllowed = true;
  assert.equal(bookingRows.ai_client_booking_drafts.find(row => row.id === corporateDraft.draft.bookingDraftId).state, 'stale');
  const persistedBooking = JSON.stringify(bookingRows);
  assert.equal(persistedBooking.includes(authorization), false); assert.equal(persistedBooking.includes('session-client'), false);
  assert.equal(persistedBooking.includes('submitted'), false);
  assert.equal(countCreates(), 1);

  taskPolicies[0].allowCreate = 0; taskStore.state.aiBudgetPolicy[0].enabled = false;
  assert.equal((await taskRestart.createTask(request, taskCommand)).task.taskId, created.task.taskId);
  assert.equal((await taskRestart.readTaskCreation(request, taskCommand)).task.runId, created.task.runId);
  const clientScene = await taskRestart.readTaskScene(request, { ...taskCommand, question: 'fees' });
  assert.equal(clientScene.task.taskId, created.task.taskId);
  assert.equal(clientScene.facts.orderId, 'own-order'); assert.equal(clientScene.facts.amounts.payableAmount.value, 0);
  assert.equal(clientScene.taskOutcome, 'not_inferred_from_order_facts');
  assert.equal(clientScene.execution, 'read_only_no_task_start');
  assert.equal(countCreates(), beforeDuplicate);
  taskPolicies[0].allowRead = 0;
  await assert.rejects(taskRestart.readTaskCreation(request, taskCommand), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(taskRestart.readTaskScene(request, taskCommand), e => e.code === 'AI_ACCESS_DENIED');
  taskPolicies[0].allowRead = 1; taskPolicies[0].allowCreate = 1; taskStore.state.aiBudgetPolicy[0].enabled = true;
  await assert.rejects(taskRestart.createTask(request, { ...taskCommand, materialRef: distinctCase.materialRef }), e => e.code === 'AI_REVISION_CONFLICT');
  const taskLost = { ...taskCommand, creationKey: 'task-lost-ack' };
  lostTaskReply = true;
  await assert.rejects(clientTasks.createTask(request, taskLost), e => e.code === 'AI_CLIENT_TASK_RESULT_UNKNOWN');
  lostTaskReply = false;
  const afterTaskLost = countCreates(), taskRecovered = await taskRestart.readTaskCreation(request, taskLost);
  assert.equal(taskRecovered.state, 'observed'); assert.equal(taskRecovered.task.status, 'queued');
  assert.equal(countCreates(), afterTaskLost); assert.equal(taskStore.state.aiTask.length, 2);
  const inputLost = { ...taskCommand, creationKey: 'claim-lost-ack' };
  lostInputReply = true;
  await assert.rejects(clientTasks.createTask(request, inputLost), e => e.code === 'AI_CLIENT_TASK_RESULT_UNKNOWN');
  lostInputReply = false;
  assert.equal((await taskRestart.createTask(request, inputLost)).state, 'unknown');
  assert.equal((await taskRestart.readTaskCreation(request, inputLost)).task, null);
  assert.equal(countCreates(), afterTaskLost);
  const preDispatchRevoked = { ...taskCommand, creationKey: 'policy-revoked-after-claim' };
  revokeAfterClaim = true;
  await assert.rejects(clientTasks.createTask(request, preDispatchRevoked), e => e.code === 'AI_CLIENT_TASK_RESULT_UNKNOWN');
  revokeAfterClaim = false; taskPolicies[0].allowCreate = 1;
  assert.equal((await taskRestart.createTask(request, preDispatchRevoked)).state, 'unknown');
  assert.equal(countCreates(), afterTaskLost); assert.equal(taskStore.state.aiRun.length, 2);
  assert.equal(JSON.stringify(taskInputs).includes(authorization), false); assert.equal(JSON.stringify(taskInputs).includes('session-client'), false);
  assert.equal(clientTasks.capabilities.tasks, 'create_and_read_only'); assert.equal(clientTasks.capabilities.models, 'unavailable');
  session.customer.customerType = 'corporate';
  assert.equal((await prepare(request, { kind: 'profile' })).material.customerType, 'corporate');
  await assert.rejects(prepare(request, { kind: 'order', orderId: 'other-order' }), e => e.getStatus?.() === 404);
  const beforeSwitchRead = reads;
  await assert.rejects(requests.readSource(request, { materialRef: own.materialRef }), /AI_CLIENT_MATERIAL_STALE/);
  assert.equal(reads, beforeSwitchRead); session.customer.customerType = 'personal';
  session.id = 'new-client-session';
  const switchedRequest = { headers: { authorization: `Bearer ${auth.sign({ typ: 'client', sub: 'person-client', tid: 'tenant-client',
    sid: session.id, wid: 'workspace-client', iat: 1, exp: Math.floor(new Date('2027-01-01').getTime() / 1000) })}` } };
  await assert.rejects(requests.readSource(switchedRequest, { materialRef: own.materialRef }), /AI_CLIENT_MATERIAL_STALE/);
  await assert.rejects(taskRestart.readTaskCreation(switchedRequest, taskCommand), /AI_CLIENT_MATERIAL_STALE/);
  await assert.rejects(taskRestart.readTaskScene(switchedRequest, taskCommand), /AI_CLIENT_MATERIAL_STALE/);
  await assert.rejects(bookingApp.readBookingDraft(switchedRequest, { bookingDraftId: repeatedDrafts[0].draft.bookingDraftId }), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(bookingApp.readBookingHandoff(switchedRequest, { handoffRef: handed.handoff.handoffRef }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(countCreates(), afterTaskLost);
  session.id = 'session-client';
  published = false;
  await assert.rejects(requests.readSource(request, { materialRef: own.materialRef }), /AI_CLIENT_CONTEXT_UNAVAILABLE/);
  published = true; const retainedRows = materialRows.length; now = new Date(now.getTime() + 300001);
  await assert.rejects(bookingApp.readBookingDraft(request, { bookingDraftId: repeatedDrafts[0].draft.bookingDraftId }), e => e.code === 'AI_PROPOSAL_STALE');
  assert.equal(bookingRows.ai_client_booking_drafts.find(row => row.id === repeatedDrafts[0].draft.bookingDraftId).state, 'expired');
  await assert.rejects(requests.readSource(request, { materialRef: own.materialRef }), /AI_CLIENT_MATERIAL_STALE/);
  assert.equal(materialRows.length, retainedRows);
  await assert.rejects(requests.readSource(request, { materialRef: own.materialRef, taskId: 'foreign-history' }), /AI_CLIENT_INVALID_INPUT/);
  for (const feature of ['tasks', 'models', 'events', 'downloads', 'historyMigration']) assert.equal(requests.capabilities[feature], 'unavailable');
  assert.equal(requests.start, undefined); assert.equal(requests.cancelOrder, undefined);
});
