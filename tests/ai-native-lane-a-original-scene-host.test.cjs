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
