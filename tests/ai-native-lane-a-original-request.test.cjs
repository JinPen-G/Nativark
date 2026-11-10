'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
require('ts-node').register({ transpileOnly: false, moduleTypes: { [`${process.cwd().replace(/\\/g, '/')}/apps/admin/src/**`]: 'cjs' }, compilerOptions: { rootDir: path.resolve(__dirname, '..'), module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
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


test('AIN13 human order handoff consumer preserves original Task scope and rechecks current facts before registered navigation', { timeout: 120000 }, async () => {
  const Module = require('node:module'), vm = require('node:vm'), shared = require('@rental-os/shared'), ts = require('typescript');
  const { plainToInstance } = require('class-transformer'), { validateSync } = require('class-validator');
  const { ExecutionContextHost } = require('@nestjs/core/helpers/execution-context-host');
  const { composeRequestBoundTaskOrderHandoff, AiTaskOrderHandoffController } = require('../apps/api/src/modules/ai-native/task-order-handoff.application');
  const { AiTaskOrderHandoffQueryDto } = require('../apps/api/src/modules/ai-native/task-order-handoff.dto');
  const { createOrderHumanHandoffSession } = require('../apps/admin/src/features/ai-native/order-human-handoff-session');
  const { clone } = require('./fixtures/ai-native/task-input-store.cjs');
  const h = await setup(), orderFactory = require('./fixtures/ai-native/authorization-baseline.cjs').order;
  let order = orderFactory({ tenantId: 'tenant_001' }), coreReads = 0;
  h.b.facts.findOrder = async (_tenantId, id) => { coreReads++; return id === order.id ? clone(order) : null; };
  const created = await h.app.create(h.command('order_explanation', 'human-handoff-original'));
  assert.equal(created.stage, 'task_metadata_created');
  const query = { taskId: created.task.taskId, runId: created.task.runId };
  const { credentials, ...dependencies } = h.dependencies;
  const application = composeRequestBoundTaskOrderHandoff(dependencies);
  const controller = new AiTaskOrderHandoffController(application);
  const currentCredential = await credentials.current(), noPolicy = clone(h.state);
  await assert.rejects(application.read({ headers: { authorization: currentCredential.authorization } }, query), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.deepEqual(h.state, noPolicy);
  // This newly created sample Task has an explicit persisted read policy.
  // Production must obtain it through the original policy/host flow; neither
  // the reader nor the test supplies an always-authorized policy adapter.
  h.state.aiTaskActionPolicy.push({ scopeId: h.state.aiScope[0].id, taskId: query.taskId, operation: 'read_metadata',
    revision: 1, requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01T00:00:00Z') });
  const before = clone(h.state);

  const httpFile = require.resolve('../apps/admin/src/api/http'), queryFile = require.resolve('../apps/admin/src/app/queryClient');
  const oldHttp = Module._cache[httpFile], oldQuery = Module._cache[queryFile], requests = [];
  let epoch = 1, switchEpoch = false, admissionReads = 0;
  const turn = { admissionKey: 'human-handoff-admission', turnId: 'human-handoff-turn', originalRequestKey: created.receipt.requestKey,
    requestHash: created.receipt.contentHash, capabilityCode: 'order_explanation', capabilityVersion: created.receipt.sceneVersion,
    createdAt: created.receipt.createdAt, automaticRetry: false, status: 'original_bound', original: h.ref(created.receipt.inputRef),
    execution: 'not_inferred_from_association', material: 'retained', task: query };
  assert.equal(shared.validateAiConversationTurnDraft(turn), true);
  Module._cache[queryFile] = { id: queryFile, filename: queryFile, loaded: true, exports: {
    currentSessionEpoch: () => epoch, currentSessionSignal: () => new AbortController().signal } };
  const transport = async (url, body, options) => {
    assert.equal(options.signal.aborted, false); requests.push({ url, body: structuredClone(body) });
    if (url === `/${shared.AI_CONVERSATION_HTTP_DRAFT.basePath}/admission`) {
      admissionReads++;
      // The existing conversation reader's observation is the transport fact
      // double. It never grants this new backend Task/order authorization.
      return { data: { data: { ...body, result: clone(turn), absence: 'not_proof_of_no_commit', retryable: false } } };
    }
    assert.equal(url, `/${shared.AI_TASK_ORDER_HANDOFF_HTTP.basePath}/${shared.AI_TASK_ORDER_HANDOFF_HTTP.read}`);
    const transformed = plainToInstance(AiTaskOrderHandoffQueryDto, clone(body));
    assert.deepEqual(validateSync(transformed, { whitelist: true }), []); // Actual global transport pipe.
    if ('scope' in body) assert.equal(Object.hasOwn(transformed, 'scope'), false);
    const credential = await credentials.current();
    const request = { headers: { authorization: credential.authorization }, body: clone(body), method: 'POST', url: '/api' + url, originalUrl: '/api' + url };
    try {
      await h.dependencies.guard.canActivate(new ExecutionContextHost([request]));
      const value = await controller.read(request, transformed);
      if (switchEpoch) { switchEpoch = false; epoch++; }
      return { data: { data: value } };
    } catch (error) { error.response = { status: error.getStatus?.() ?? 500 }; throw error; }
  };
  Module._cache[httpFile] = { id: httpFile, filename: httpFile, loaded: true, exports: { http: { post: transport } } };
  try {
    const { aiTaskOrderHandoffApi } = require('../apps/admin/src/api/aiTaskOrderHandoff');
    const { aiConversationsApi } = require('../apps/admin/src/api/aiConversations');
    const jsx = require('react/jsx-runtime');
    const transpile = rel => ts.transpileModule(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const conversation = {};
    vm.runInNewContext(transpile('apps/admin/src/features/ai-native/ConversationOrderHandoff.tsx'), { exports: conversation, require(name) {
      if (name === 'react') return { useRef: value => ({ current: value }) };
      if (name === 'react/jsx-runtime') return jsx;
      if (name === '@rental-os/shared') return shared;
      if (name === '@/api/aiConversations') return { aiConversationsApi };
      if (name === './OrderHumanHandoff') return { OrderHumanHandoff: () => null };
      throw Error(name);
    } });
    let active = true;
    const binding = conversation.ConversationOrderHandoff({ identity: 'human-owner', conversationId: 'human-conversation', turn, current: () => active }).props;
    const session = createOrderHumanHandoffSession({ query, scope: { kind: 'workspace', tenantId: 'tenant_001', workspaceId: 'workspace-a' },
      current: () => active, api: aiTaskOrderHandoffApi, verify: binding.verify, validate: binding.validate, changed() {} });
    assert.equal(requests.length, 0); const readingBefore = coreReads;
    await assert.rejects(transport(`/${shared.AI_TASK_ORDER_HANDOFF_HTTP.basePath}/read`, { ...query, scope: 'forged' }, { signal: new AbortController().signal }));
    assert.equal(coreReads, readingBefore, 'raw-body rejection occurs before data consumption despite DTO stripping');
    await session.read(); assert.deepEqual(h.state, before); assert.equal(admissionReads, 2);
    assert.equal(session.view.frame.order.id, 'order-a'); assert.equal(session.view.frame.order.status, 'reserved');
    assert.equal(session.view.frame.next.allowedActions, 'unavailable'); assert.equal(session.view.frame.next.candidates[0].executable, false);
    assert.equal('amounts' in session.view.frame.order, false); assert.equal('customerName' in session.view.frame.order, false);
    assert.equal(session.view.frame.origin.inputRef, turn.original.inputRef);
    const responseSchema = new Ajv({ strict: false }); addFormats(responseSchema);
    const valid = responseSchema.compile(shared.AI_TASK_ORDER_HANDOFF_SCHEMAS.AiTaskOrderHandoffResponse);
    assert.equal(valid(session.view.frame), true, JSON.stringify(valid.errors));
    assert.equal(shared.aiTaskOrderHandoffResponse.safeParse({ ...session.view.frame, url: 'javascript:forged' }).success, false);
    const navigation = {}, icon = () => null;
    vm.runInNewContext(transpile('apps/admin/src/app/navigation.tsx'), { exports: navigation, require(name) {
      if (name === 'react/jsx-runtime') return jsx;
      if (name === '@rental-os/shared') return shared;
      if (name === '@/components/ui/icons') return new Proxy({}, { get: () => icon });
      if (name === './navigation-terminology') return { applyTenantNavigationLabels: value => value };
      if (name === './categoryGovernancePreview') return { CATEGORY_GOVERNANCE_PREVIEW_ENABLED: false };
      throw Error(name);
    } });
    const destination = navigation.APP_ROUTES.orderDetail;
    assert.equal(destination.permission, 'rental-os:order:view'); assert.equal(destination.audience, 'tenant');
    const routes = [], { generatePath } = require('react-router-dom');
    const navigate = value => routes.push(generatePath(destination.path, { id: encodeURIComponent(value.order.id) }));
    order = { ...order, status: 'renting', updatedAt: '2026-01-01T00:01:00Z' };
    assert.equal(await session.open(navigate), false); assert.equal(routes.length, 0); assert.equal(session.view.changedOrder, true);
    assert.equal(session.view.frame.order.status, 'renting'); assert.deepEqual(h.state, before);
    assert.equal(await session.open(navigate), true); assert.deepEqual(routes, ['/rental/orders/order-a']); assert.deepEqual(h.state, before);
    const permissions = [...h.b.h.identity.user.permissions]; h.b.h.identity.user.permissions = [];
    await assert.rejects(session.open(navigate)); assert.equal(session.view.frame, null); assert.equal(routes.length, 1);
    h.b.h.identity.user.permissions = permissions;
    await session.read(); switchEpoch = true;
    await assert.rejects(session.open(navigate), error => error.message === 'AI_SCOPE_CHANGED'); assert.equal(routes.length, 1); assert.equal(session.view.frame, null);
    await assert.rejects(aiTaskOrderHandoffApi.read({ ...query, runId: 'wrong-run' }, new AbortController().signal));
    h.state.aiTask[0].archivedAt = new Date(); await assert.rejects(session.read()); h.state.aiTask[0].archivedAt = null;
    assert.deepEqual(h.state, before); assert.equal(h.state.aiStep.length, 0); assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiRun.length, 1);
    assert.equal(h.state.aiTaskExecutionCharge.length, 0); assert.equal(h.state.aiTenantModelConfiguration.length, 0);
    active = false; session.dispose(); await assert.rejects(session.read()); assert.equal(routes.length, 1);
  } finally {
    if (oldHttp) Module._cache[httpFile] = oldHttp; else delete Module._cache[httpFile];
    if (oldQuery) Module._cache[queryFile] = oldQuery; else delete Module._cache[queryFile];
  }
});
