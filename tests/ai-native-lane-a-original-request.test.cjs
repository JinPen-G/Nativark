'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
require('ts-node').register({ transpileOnly: false, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');
const { composeAiOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.composition');
const { AI_SCENE_REQUEST_DRAFT_SCHEMAS } = require('../packages/shared/src/ai-scene-request-draft-schemas');
const Ajv = require('ajv'), addFormats = require('ajv-formats');
const ajv = new Ajv({ strict: true }); addFormats(ajv);
const createValid = ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestCreateDraft);
const receiptValid = ajv.compile(AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft);
const code = code => error => error.code === code;

for (const scene of ['order_explanation', 'opening_diagnosis', 'quote_clarification']) test(`real Auth/Guard/Subscription and repository create ${scene} metadata with an immutable original`, { timeout: 30000 }, async () => {
  const h = await setup(), command = h.command(scene);
  assert.equal(createValid(command), true);
  const result = await h.app.create(command);
  assert.equal(result.stage, 'task_metadata_created', JSON.stringify(result));
  assert.equal(receiptValid(result.receipt), true, JSON.stringify(receiptValid.errors));
  assert.equal(result.task.status, 'queued'); assert.equal(result.model, 'not_called');
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiRun.length, 1);
  const row = h.state.aiTaskOriginalRequest[0], task = h.state.aiTask[0];
  assert.equal(task.inputRef, row.id); assert.equal(task.inputHash, row.contentHash); assert.equal(task.inputRevision, row.revision);
  assert.equal(row.ownerId, h.b.h.identity.user.id); assert.equal(row.scopeId, 'scope-a');
  const read = await h.app.read(h.ref(row.id)); assert.ok(Object.isFrozen(read.request.input));
  const replay = await h.app.create(command);
  assert.equal(replay.stage, 'existing_request'); assert.equal(replay.task.taskId, task.id); assert.equal(replay.task.plan, 'not_observed');
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiTaskOriginalRequest.length, 1);
});

test('closed contract and before-await snapshot prevent caller identity/hash and changed input reuse', async () => {
  const h = await setup(), command = h.command();
  for (const patch of [{ actor: 'admin' }, { scopeId: 'other' }, { creationAllowed: true }, { hash: '0'.repeat(64) }]) {
    assert.equal(createValid({ ...command, ...patch }), false);
    await assert.rejects(h.app.create({ ...command, ...patch }), code('AI_INVALID_INPUT'));
  }
  const saved = h.app.requests.save(command); command.input.question = 'payments';
  const receipt = await saved;
  assert.equal(h.state.aiTaskOriginalRequest[0].payload.question, 'status');
  await assert.rejects(h.app.requests.save(command), code('AI_REVISION_CONFLICT'));
  const next = await h.app.reissue({ ...command, requestKey: 'original-b', previousInputRef: receipt.inputRef });
  assert.equal(next.receipt.revision, 2); assert.equal(next.receipt.previousInputRef, receipt.inputRef);
  assert.equal(h.state.aiTaskOriginalRequest[0].payload.question, 'status');
});

test('missing creation policy, disabled scene and revoked permissions do not manufacture authority', async () => {
  const h = await setup();
  const absent = composeAiOriginalScenes({ ...h.dependencies, creationRules: [] });
  await assert.rejects(absent.create(h.command()), code('AI_RESOURCE_UNAVAILABLE'));
  h.state.aiTaskPlanPolicy[0].enabled = false;
  await assert.rejects(h.app.create(h.command()), code('AI_RESOURCE_UNAVAILABLE'));
  h.state.aiTaskPlanPolicy[0].enabled = true;
  h.b.h.identity.user.permissions = h.b.h.identity.user.permissions.filter(p => p !== 'rental-os:order:operate');
  await assert.rejects(h.app.create(h.command()), code('AI_ACCESS_DENIED'));
  assert.equal(h.state.aiTaskOriginalRequest.length, 0);
});

test('revocation, different scope, expiry and old policies reject input creation; retained receipt remains read only', async () => {
  const h = await setup(), receipt = await h.app.requests.save(h.command());
  h.state.aiTaskPlanPolicy[0].revision++;
  await assert.rejects(h.app.createTask(h.ref(receipt.inputRef)), code('AI_REVISION_CONFLICT'));
  h.state.aiTaskPlanPolicy[0].revision--;
  h.b.h.identity.session = false;
  await assert.rejects(h.app.read(h.ref(receipt.inputRef)), code('AI_ACCESS_DENIED'));
  h.b.h.identity.session = true;
  h.b.h.identity.workspace = 'workspace-other';
  await assert.rejects(h.app.read(h.ref(receipt.inputRef)));
  h.b.h.identity.workspace = 'workspace-a';
  h.b.h.control.now = new Date(new Date(receipt.expiresAt).getTime() + 1);
  await assert.rejects(h.app.read(h.ref(receipt.inputRef)), code('AI_ACCESS_DENIED'));
  const result = await h.app.reconcile(h.command());
  assert.equal(result.state, 'observed'); assert.equal(result.receipt.state, 'expired'); assert.equal(result.task.state, 'not_observed');
  assert.equal(h.state.aiTask.length, 0);
});

test('lost request COMMIT acknowledgement is reconciled by the original key without a second save', async () => {
  const h = await setup();
  h.control.beforeCommit = async draft => { if (draft.aiTaskOriginalRequest.length > h.state.aiTaskOriginalRequest.length) h.control.loseReply = true; };
  await assert.rejects(h.app.requests.save(h.command()), code('AI_RESULT_UNKNOWN'));
  assert.equal(h.state.aiTaskOriginalRequest.length, 1);
  const before = h.trace.filter(x => x === 'aiTaskOriginalRequest.create').length;
  const result = await h.app.reconcile(h.command());
  assert.equal(result.state, 'observed'); assert.equal(h.trace.filter(x => x === 'aiTaskOriginalRequest.create').length, before);
  await assert.rejects(h.app.reconcile({ ...h.command(), input: { orderId: 'order-a', question: 'fees' } }), code('AI_REVISION_CONFLICT'));
});

test('lost task COMMIT acknowledgement retains the original task/run receipt and never implies execution', async () => {
  const h = await setup();
  h.control.beforeCommit = async draft => { if (draft.aiTask.length > h.state.aiTask.length) h.control.loseReply = true; };
  const result = await h.app.create(h.command());
  assert.equal(result.stage, 'request_stored'); assert.equal(result.creation.state, 'requires_reconciliation');
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiRun.length, 1);
  h.state.aiTaskPlanPolicy[0].enabled = false;
  const reconciled = await h.app.reconcile(h.command());
  assert.equal(reconciled.task.state, 'observed'); assert.equal(reconciled.task.taskId, h.state.aiTask[0].id);
  assert.equal(reconciled.task.execution, 'not_inferred_from_metadata');
  assert.equal(h.state.aiTask.length, 1);
});

test('migration only adds scoped original request objects and no business writes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../apps/api/prisma/migrations/20261007190000_ai_native_scene_requests/migration.sql'), 'utf8');
  assert.match(sql, /ai_original_requests_request_key/); assert.match(sql, /FOREIGN KEY \(`scopeId`,`previousRequestId`\)/);
  assert.doesNotMatch(sql, /(?:^|;)\s*(?:DROP|DELETE|INSERT)\b/im);
});
