'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AiConnectionTestService } = require('../apps/api/src/modules/ai-native/connection-test.service');
const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');

const profile = { id: 'profile-w10', scopeId: 'tenant-w10', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT', serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model', credentialRef: 'vault:synthetic', configRevision: 7, enabled: true, allowedCapabilities: ['text', 'tools'], disabledAt: null };
const context = { tenantId: 'tenant-w10', workspaceId: 'space-w10', actorId: 'actor-w10' };

test('probe records one bounded evidence row per capability and does not send credential material', async () => {
  const requests = [], records = [];
  const service = new AiConnectionTestService({ invoke: async (_context, request) => { requests.push(request); return { text: 'synthetic-only' }; } }, { record: async input => { records.push(input); return input; } });
  const result = await service.run(context, profile, ['text', 'tools', 'text']);
  assert.deepEqual(result.map(row => row.capability), ['text', 'tools']);
  assert.equal(records.length, 2);
  assert.equal(records.every(row => row.source === 'connection_test'), true);
  assert.equal(records[0].details?.result, 'synthetic_probe_only');
  assert.equal(records[1].details?.errorCode, 'INVALID_RESPONSE');
  assert.equal(JSON.stringify(requests).includes('vault:synthetic'), false);
});

test('unsupported and transport failure remain distinguishable and never become supported evidence', async () => {
  const records = [];
  const service = new AiConnectionTestService({ invoke: async (_context, request) => request.features?.[0] === 'tools' ? Promise.reject(new ModelGatewayError('CAPABILITY_UNSUPPORTED')) : Promise.reject(new Error('offline transport')) }, { record: async input => { records.push(input); return input; } });
  const result = await service.run(context, profile, ['tools', 'streaming']);
  assert.deepEqual(result.map(row => [row.capability, row.status, row.errorCode]), [['tools', 'unverified', 'CAPABILITY_UNSUPPORTED'], ['streaming', 'unverified', 'CONFIG_INVALID']]);
  assert.equal(records.some(row => row.status === 'supported'), false);
});

test('configuration revision is part of the evidence identity and changed probes cannot reuse prior evidence', async () => {
  const records = [];
  const service = new AiConnectionTestService({ invoke: async () => ({ text: 'synthetic-only' }) }, { record: async input => { records.push(input); return input; } });
  await service.run(context, profile, ['text']);
  await service.run(context, { ...profile, configRevision: 8 }, ['text']);
  assert.notEqual(records[0].evidenceHash, records[1].evidenceHash);
  assert.deepEqual(records.map(row => row.profile.configRevision), [7, 8]);
});

// Database transactions and authorization/configuration ports are offline
// substitutes; the immutable request repository itself is production code.
function originalProbeHarness() {
  const { PrismaTextProbeOriginalRequestRepository } = require('../apps/api/src/modules/ai-native/prisma-text-probe-original-request.repository');
  const { AI_TOOL_DRAFT_VERSION } = require('@rental-os/shared');
  const consumer = require('./fixtures/ai-native/contract-consumer.cjs');
  const now = new Date('2026-10-11T00:00:00Z');
  const ctx = structuredClone(consumer.contexts[0]); ctx.authorizedAt = now.toISOString();
  const state = { rows: [], denied: false, lost: false, config: 1 };
  const limits = { maxSteps: 1, maxCalls: 1, maxConcurrent: 1, maxTotalMs: 5000, maxStepMs: 5000, maxOutputBytes: 1024 };
  const policy = { scopeId: 'scope-1', sceneCode: 'ai.capability.text', sceneVersion: 'v1', revision: 1, enabled: true,
    limits, allowedTools: [{ code: 'ai.capability.text.probe', version: AI_TOOL_DRAFT_VERSION }], expiresAt: new Date(now.getTime() + 60000) };
  const match = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const delegate = rows => ({ findFirst: async ({ where }) => structuredClone(rows.find(row => match(row, where)) ?? null),
    create: async ({ data }) => { rows.push(structuredClone(data)); return structuredClone(data); } });
  const db = { aiTaskOriginalRequest: { findFirst: async args => delegate(state.rows).findFirst(args) },
    aiTaskPlanPolicy: { findFirst: async ({ where }) => match(policy, where) ? structuredClone(policy) : null },
    $transaction: async callback => { const rows = structuredClone(state.rows);
      const result = await callback({ $queryRaw: async () => [], aiTaskPlanPolicy: db.aiTaskPlanPolicy, aiTaskOriginalRequest: delegate(rows) });
      state.rows = rows; if (state.lost) { state.lost = false; throw Error('commit response lost'); } return result; } };
  const input = { scopes: { resolveCurrent: async () => { if (state.denied) throw Error('revoked'); return { context: structuredClone(ctx),
    scope: { id: 'scope-1', kind: 'WORKSPACE', tenantId: ctx.scope.tenantId, workspaceId: ctx.scope.workspaceId } }; } },
    policy: { read: async () => ({ state: 'configured', revision: policy.revision, enabled: policy.enabled, limits: structuredClone(limits), expiresAt: policy.expiresAt.toISOString() }) },
    probe: { prepareCurrent: async command => ({ intent: structuredClone(command), configRevision: state.config }) },
    sceneVersion: 'v1', priceVersion: 'server-price-1' };
  return { state, policy, db, input, now, ctx, make: () => new PrismaTextProbeOriginalRequestRepository(db, input, () => now),
    command: { requestKey: 'original-probe-1', command: { operationId: 'probe-1', profileKey: 'default', profileFingerprint: 'a'.repeat(64) } } };
}

test('persisted probe original survives reconstruction, binds same-key payload and rechecks policy/configuration', async () => {
  const h = originalProbeHarness(), repo = h.make(), receipt = await repo.publish(h.command);
  assert.equal(receipt.replayed, false);
  const original = await h.make().read(receipt.inputRef);
  assert.deepEqual(original.command, h.command.command);
  assert.equal(original.priceVersion, 'server-price-1');
  assert.equal((await repo.publish(h.command)).inputRef, receipt.inputRef);
  assert.equal(h.state.rows.length, 1);
  await assert.rejects(repo.publish({ ...h.command, command: { ...h.command.command, operationId: 'other-probe' } }), { code: 'AI_REVISION_CONFLICT' });
  h.state.config++;
  await assert.rejects(repo.read(receipt.inputRef), { code: 'AI_REVISION_CONFLICT' });
  h.state.config--; h.policy.enabled = false;
  await assert.rejects(repo.read(receipt.inputRef), { code: 'AI_RESOURCE_UNAVAILABLE' });
});

test('probe original commit response loss is recoverable only by original key; revocation returns no stored input', async () => {
  const h = originalProbeHarness(), repo = h.make(); h.state.lost = true;
  await assert.rejects(repo.publish(h.command), { code: 'AI_RESULT_UNKNOWN', retryable: false });
  assert.equal(h.state.rows.length, 1);
  const recovered = await h.make().readOriginal(h.command.requestKey);
  assert.equal(recovered.state, 'stored');
  assert.equal((await repo.read(recovered.inputRef)).command.operationId, 'probe-1');
  h.state.denied = true;
  await assert.rejects(repo.read(recovered.inputRef));
  assert.equal(h.state.rows.length, 1);
});

test('persisted probe workflow cannot create or dispatch from a missing original and uses the configuration Guard', async () => {
  const { composePersistedTextProbeWorkflow } = require('../apps/api/src/modules/ai-native/text-capability-probe-task.composition');
  const h = originalProbeHarness();
  let writes = 0, dispatches = 0, guards = 0;
  const failWrite = async () => { writes++; throw Error('unexpected write'); };
  h.db.aiTask = { create: failWrite, findFirst: async () => null };
  h.db.aiScope = { findFirst: async ({ where }) => ({ id: 'scope-1', ...where }) };
  h.db.aiTaskPlanPolicy.updateMany = failWrite;
  const user = { id: h.ctx.actor.userId, tenantId: h.ctx.scope.tenantId, isActive: true, isSaasAdmin: false,
    permissions: h.ctx.access.permissions, dataScope: h.ctx.access.dataScope, locationScope: h.ctx.access.locationScope };
  const workflow = composePersistedTextProbeWorkflow({ db: h.db, auth: { resolveAccessContext: async () => ({ user, tenantUser: user,
    workspaceValid: true, workspaceId: h.ctx.scope.workspaceId }) }, credentials: { current: async () => ({
      authorization: 'Bearer offline-only', requestId: 'probe-request', audience: 'operator' }) },
    guard: { canActivate: async () => { guards++; return false; } },
    probe: { ...h.input.probe, prepare: async () => { throw Error('unexpected prepare'); },
      runHeldCurrent: async () => { dispatches++; throw Error('unexpected dispatch'); }, reconcileCurrent: async () => { throw Error('unexpected receipt'); } },
    host: { holderId: 'probe-host', leaseMs: 1000 }, sceneVersion: 'v1', priceVersion: 'server-price-1', clock: () => h.now });
  assert.equal(writes, 0); assert.equal(dispatches, 0); // composition itself is inert
  // Existing task creation deliberately maps an unresolvable input authority
  // to access denied, rather than revealing whether an input exists.
  await assert.rejects(workflow.startOriginal({ creationKey: 'original-task', inputRef: 'missing-original' }), { code: 'AI_ACCESS_DENIED' });
  await assert.rejects(workflow.requestCancellationOriginal({ creationKey: 'original-task', inputRef: 'missing-original', expectedRevision: 1 }), { code: 'AI_ACCESS_DENIED' });
  await assert.rejects(workflow.publishOriginal(h.command), { code: 'AI_ACCESS_DENIED' });
  assert.equal(guards, 1); assert.equal(writes, 0); assert.equal(dispatches, 0); assert.equal(h.state.rows.length, 0);
});

test('probe task cancellation uses current policy and CAS without calling the model or releasing accounting', async () => {
  const { composeTextCapabilityProbeTask } = require('../apps/api/src/modules/ai-native/text-capability-probe-task.composition');
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [] });
  let calls = 0;
  const forbidden = async () => { calls++; throw Error('cancellation cannot execute or settle'); };
  const root = composeTextCapabilityProbeTask({ ...h.authorization, db: h.db,
    task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'probe-input', priceVersion: 'price',
      command: { operationId: 'probe-a', profileKey: 'default', profileFingerprint: 'a'.repeat(64) }, limits: h.plan.limits },
    probe: { prepare: forbidden, runHeldCurrent: forbidden, prepareHeldInvocationCurrent: forbidden },
    financialEvidence: { readDispatch: forbidden }, host: { holderId: 'probe-host', leaseMs: 1000 }, clock: () => h.control.now });
  const revision = h.state.aiTask[0].revision;
  await assert.rejects(root.requestCancellation({ expectedRevision: revision + 1 }), { code: 'AI_REVISION_CONFLICT' });
  const result = await root.requestCancellation({ expectedRevision: revision });
  assert.equal(result.event.data.to, 'cancel_requested');
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.notEqual(h.state.aiTask[0].status, 'CANCELLED');
  assert.equal(calls, 0);
  h.identity.session = false;
  await assert.rejects(root.requestCancellation({ expectedRevision: h.state.aiTask[0].revision }));
  assert.equal(calls, 0);
});

test('authorized original probe request lifecycle executes through persisted runner and one financial ledger', async () => {
  const { composeAuthorizedPersistedTextProbeWorkflow } = require('../apps/api/src/modules/ai-native/text-capability-probe.composition');
  const { PrismaTaskPlanPolicyRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-policy.repository');
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { SecretBox } = require('../apps/api/src/common/secret-box');
  const { tenantModelCredentialReference } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const { TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const h = await authorizedRunnerHarness({ aiProviderProfile: [], aiPlatformModelConnection: [], aiTenantModelConfiguration: [],
    systemParameterSet: [], aiTaskOriginalRequest: [], aiTaskPlanPolicy: [], aiTaskActionInput: [], aiProviderCapabilityEvidence: [],
    aiBudgetReservation: [], aiBudgetAllocation: [], aiBudgetLedgerEntry: [], aiTextCapabilityReceipt: [] });
  h.control.now = new Date();
  h.identity.user.permissions.push('system:params:manage');
  h.db.aiPlatformModelConnection.update = async () => assert.fail('no platform config mutation');
  const secrets = new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'offline-probe-encryption-key' : undefined });
  const settings = { enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://offline.example/v1',
    model: 'synthetic-model', timeoutMs: 30000, maxConcurrent: 1, maxOutputTokens: 32 };
  h.state.aiTenantModelConfiguration.push({ tenantId: 'tenant-a', revision: 1, mode: 'tenant_managed', settings,
    credentialsEncrypted: secrets.encrypt({ apiKey: 'offline-probe-secret', tenantId: 'tenant-a',
      protocol: settings.protocol, baseUrl: settings.baseUrl, model: settings.model }) });
  const profile = { id: 'tenant-profile', scopeId: 'scope-tenant', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'tenant_managed', protocol: settings.protocol, provider: settings.protocol, model: settings.model,
    credentialRef: tenantModelCredentialReference('tenant-a', 1), configRevision: 1, enabled: true, disabledAt: null, allowedCapabilities: ['text'] };
  h.state.aiProviderProfile.push(profile, { ...profile, id: 'old-default', profileKey: 'old-default', enabled: false, disabledAt: new Date(h.control.now) });
  for (const policy of h.state.aiBudgetPolicy) {
    policy.sceneCode = TEXT_PROBE_SCENE; policy.unitKind = 'calls'; policy.settingsJson.sceneCode = TEXT_PROBE_SCENE;
    policy.settingsJson.allowedScenes = [TEXT_PROBE_SCENE];
  }
  const guard = new ApiAuthGuard(h.authorization.auth);
  const clock = () => new Date(h.control.now);
  const policy = new PrismaTaskPlanPolicyRepository(h.db, { ...h.authorization, guard,
    scene: { code: TEXT_PROBE_SCENE, version: '1' }, tool: TEXT_CAPABILITY_PROBE_TOOL }, clock);
  await policy.put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: new Date(h.control.now.getTime() + 60000).toISOString() });
  let sends = 0, omitUsage = false;
  const dependencies = { ...h.authorization, db: h.db, guard, secrets,
    platformProfileId: 'platform-default', pricing: { mode: 'persisted_calls', priceVersion: 'price' },
    audit: { append: async () => {} }, protocol: { post: async () => { sends++;
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'offline reply' }, finish_reason: 'stop' }],
        ...(omitUsage ? {} : { usage: { prompt_tokens: 1, completion_tokens: 2 } }) }) }; } },
    host: { holderId: 'probe-host', leaseMs: 100000 }, sceneVersion: '1', priceVersion: 'price', clock, monotonic: () => h.control.tick };
  const root = composeAuthorizedPersistedTextProbeWorkflow(dependencies);
  const { credentials, ...httpDependencies } = dependencies;
  const { TextCapabilityProbeModule } = require('../apps/api/src/modules/ai-native/text-capability-probe.module');
  const { TextCapabilityProbeController, TEXT_CAPABILITY_PROBE_REQUESTS } = require('../apps/api/src/modules/ai-native/text-capability-probe.controller');
  assert.deepEqual(TextCapabilityProbeModule.registerHttp().controllers, []);
  assert.throws(() => TextCapabilityProbeModule.registerHttp({ enabled: true }));
  const registered = TextCapabilityProbeModule.registerHttp({ enabled: true, dependencies: httpDependencies });
  const factory = registered.providers.find(provider => provider.provide === TEXT_CAPABILITY_PROBE_REQUESTS).useValue;
  const http = new TextCapabilityProbeController(factory);
  const header = (await credentials.current()).authorization;
  const request = () => ({ headers: { authorization: header } });
  const { AI_TEXT_CAPABILITY_HTTP_DRAFT: routes } = require('../packages/shared/src');
  const { requiredPermissions, UNMATCHED_ROUTE_PERMISSION } = require('../apps/api/src/common/api-auth.guard');
  const { isStaffBusinessRouteAllowed } = require('../apps/api/src/common/staff-api-policy');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { basePath, method, ...operations } = routes;
  const entryGuard = new ApiAuthGuard(dependencies.auth);
  const entry = path => runWithRequestIdentity({}, () => entryGuard.canActivate({ switchToHttp: () => ({ getRequest: () => ({
    method, url: `/api${path}`, headers: { authorization: header } }) }) }));
  for (const operation of Object.values(operations)) {
    const path = `/${basePath}/${operation}`;
    assert.deepEqual(requiredPermissions(method, path), ['system:params:manage']);
    assert.deepEqual(requiredPermissions('GET', path), [UNMATCHED_ROUTE_PERMISSION]);
    assert.equal(isStaffBusinessRouteAllowed(method, path), false);
    assert.equal(await entry(path), true);
  }
  const permissionIndex = h.identity.user.permissions.indexOf('system:params:manage');
  h.identity.user.permissions.splice(permissionIndex, 1);
  await assert.rejects(entry(`/${basePath}/${routes.start}`));
  h.identity.user.permissions.splice(permissionIndex, 0, 'system:params:manage');
  const components = require('../apps/api/src/contracts/ai-leaf-components').AI_LEAF_COMPONENT_SCHEMAS;
  assert.ok(components.AiTextCapabilityHistoryResponseDraft);
  const key = { requestKey: 'probe-complete' };
  const { AI_TEXT_CAPABILITY_HTTP_SCHEMAS: schemas } = require('../packages/shared/src/ai-text-capability-http-draft');
  const ajv = new (require('ajv'))({ strict: true });
  require('ajv-formats')(ajv);
  const checked = (name, value) => { const valid = ajv.compile(schemas[name]); assert.ok(valid(value), JSON.stringify(valid.errors)); return value; };
  const open = factory.open.bind(factory), requests = [];
  factory.open = value => { const opened = open(value); requests.push(opened); return opened; };
  // Preparation/read cannot decrypt, dispatch, publish or reserve.
  const decrypt = secrets.decrypt.bind(secrets); let decrypts = 0;
  secrets.decrypt = (...args) => { decrypts++; return decrypt(...args); };
  checked('AiTextCapabilityPrepareResponseDraft', await http.prepare(request(), key));
  assert.equal((await http.readOriginal(request(), key)).state, 'not_observed');
  assert.equal(decrypts, 0); assert.equal(sends, 0); assert.equal(h.state.aiTaskOriginalRequest.length, 0);
  for (const field of ['actorId', 'tenantId', 'workspaceId', 'lease', 'holder', 'fencingToken', 'registrationRef', 'command', 'model', 'profileKey', 'priceVersion', 'limits']) {
    await assert.rejects(http.publish(request(), { ...key, [field]: 'forged' }), error => error.getStatus() === 400);
  }
  const original = checked('AiTextCapabilityPublishResponseDraft', await http.publish(request(), key));
  assert.equal((await http.publish(request(), key)).inputRef, original.inputRef);
  const created = checked('AiTextCapabilityCreateTaskResponseDraft', await http.createTask(request(), key));
  await assert.rejects(http.readTask(request(), key), error => error.getStatus() === 403);
  await assert.rejects(http.createTask(request(), key), error => error.getStatus() === 403);
  assert.equal(decrypts, 0); assert.equal(sends, 0);
  const authorizeTask = async taskId => {
    for (const operation of ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'read_step_terminal', 'request_input']) {
      await root.workflow.taskPolicies.put({ taskId, operation, requiredPermissions: ['rental-os:order:view'],
        expiresAt: new Date('2027-01-01T00:00:00Z') }, null);
    }
  };
  await authorizeTask(created.taskId);
  const reread = checked('AiTextCapabilityReadTaskResponseDraft', await new TextCapabilityProbeController(
    TextCapabilityProbeModule.registerHttp({ enabled: true, dependencies: httpDependencies }).providers[0].useValue).readTask(request(), key));
  assert.equal(reread.task.taskId, created.taskId);
  assert.equal((await http.createTask(request(), key)).taskId, created.taskId);
  assert.equal(JSON.stringify({ original, created, reread }).includes('registrationRef'), false);
  const result = checked('AiTextCapabilityRunResponseDraft', await http.start(request(), key));
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'succeeded', JSON.stringify({ sends,
    steps: h.state.aiStep.map(row => ({ status: row.status, errorCode: row.errorCode })),
    artifacts: h.state.aiTaskResultArtifact.map(row => ({ outcome: row.outcome, errorCode: row.errorCode,
      status: row.payload?.status, error: row.payload?.error?.code })),
    reservations: h.state.aiBudgetReservation.map(row => ({ status: row.status, dispatchState: row.dispatchState })),
    admissions: h.state.aiInvocationAdmission.map(row => ({ status: row.status })),
    trace: h.trace?.slice(-15) }));
  assert.equal(sends, 1); assert.equal(h.state.aiGatewayInvocation.length, 1);
  assert.equal(h.state.aiBudgetReservation.length, 1); assert.equal(h.state.aiBudgetReservation[0].status, 'settled');
  assert.equal(h.state.aiBudgetLedgerEntry.filter(row => row.kind === 'settle').length, 1);
  assert.equal(h.state.aiTaskResultArtifact.length, 1); assert.equal(h.state.aiTaskResultArtifact[0].payload.status, 'completed');
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  // Simulate an evidence commit whose acknowledgement is lost, not a failed probe.
  h.state.aiProviderCapabilityEvidence.splice(0);
  const evidenceTransaction = h.db.$transaction.bind(h.db); let loseEvidenceReply = true;
  h.db.$transaction = async (...args) => { const saved = await evidenceTransaction(...args);
    if (loseEvidenceReply && saved?.profileId === profile.id && saved?.capability === 'text') {
      loseEvidenceReply = false; throw Error('evidence acknowledgement lost');
    } return saved; };
  await assert.rejects(http.readCapabilityReceipt(request(), key), error => error.getStatus() === 409
    && error.getResponse().nextAction === 'readCapabilityReceipt' && error.getResponse().retryable === false);
  h.db.$transaction = evidenceTransaction;
  const receipt = checked('AiTextCapabilityReceiptResponseDraft', await http.readCapabilityReceipt(request(), key));
  assert.equal(receipt.status, 'unverified'); // synthetic IO never certifies a real provider
  assert.equal(receipt.observation.mode, 'mock');
  assert.equal(receipt.observation.configurationRevision, profile.configRevision);
  const preflight = checked('AiTextCapabilityPreflightResponseDraft', await http.preflight(request(), key));
  assert.equal(preflight.allowed, false);
  checked('AiTextCapabilityInspectResponseDraft', await http.inspect(request(), key));
  checked('AiTextCapabilityRunResponseDraft', await http.reconcile(request(), key));
  await assert.rejects(http.start(request(), key), error => error.getStatus() === 403);
  assert.equal(sends, 1); // terminal task cannot reacquire claim_run permission
  for (const closed of requests) await assert.rejects(closed.readOriginal(key), { code: 'AI_ACCESS_DENIED' });

  // A second explicit original tests cancellation, not recovery via replacement.
  const cancelKey = { requestKey: 'probe-cancel' };
  await http.publish(request(), cancelKey);
  const cancellable = await http.createTask(request(), cancelKey);
  for (const operation of ['read_metadata', 'transition_task']) await root.workflow.taskPolicies.put({ taskId: cancellable.taskId,
    operation, requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01T00:00:00Z') }, null);
  const cancelled = checked('AiTextCapabilityCancelResponseDraft', await http.cancel(request(), { ...cancelKey, expectedRevision: cancellable.revision }));
  assert.equal(cancelled.status, 'cancel_requested');
  assert.equal(h.state.aiTask.find(task => task.id === cancellable.taskId).status, 'CANCEL_REQUESTED');
  assert.equal(sends, 1);

  // A committed original with a lost response is read with the same requestKey.
  const transaction = h.db.$transaction.bind(h.db); let loseReply = true;
  h.db.$transaction = async (...args) => { const result = await transaction(...args);
    if (loseReply && result?.state === 'stored') { loseReply = false; throw Error('commit response lost with private detail'); } return result; };
  const lostKey = { requestKey: 'probe-lost' };
  await assert.rejects(http.publish(request(), lostKey), error => error.getStatus() === 409
    && error.getResponse().nextAction === 'readOriginal' && error.getResponse().retryable === false);
  const recovered = checked('AiTextCapabilityReadOriginalResponseDraft', await http.readOriginal(request(), lostKey));
  assert.equal(recovered.state, 'stored');
  assert.equal(sends, 1);
  h.db.$transaction = transaction;

  // Missing usage leaves the original run unknown; recovery reacquires that
  // released run for receipt inspection, never another provider dispatch.
  h.control.now = new Date(h.control.now.getTime() + 1000); omitUsage = true;
  const unknownKey = { requestKey: 'probe-missing-usage' };
  await http.publish(request(), unknownKey);
  const unknownTask = await http.createTask(request(), unknownKey);
  await authorizeTask(unknownTask.taskId);
  const unknown = await http.start(request(), unknownKey);
  assert.equal(unknown.outcome.status, 'unknown');
  const originalRun = h.state.aiRun.find(row => row.id === unknownTask.runId);
  assert.equal(originalRun.leaseOwnerId, null);
  const beforeFence = originalRun.fencingToken.toFixed(0), beforeSends = sends;
  const recoveredRun = checked('AiTextCapabilityRunResponseDraft', await http.reconcile(request(), unknownKey));
  assert.equal(recoveredRun.kind, 'run_outcome');
  assert.equal(sends, beforeSends);
  assert.equal(BigInt(h.state.aiRun.find(row => row.id === unknownTask.runId).fencingToken.toFixed(0)) > BigInt(beforeFence), true);

  // The fixed shared vocabulary permits selection, not invented protocol
  // support. This is the same production HTTP/original/task chain over offline
  // DB/identity substitutes, with zero native model evidence.
  const { AI_CAPABILITY_PROBE_KINDS_DRAFT: kinds } = require('@rental-os/shared');
  const probeContract = require('../apps/api/src/modules/ai-native/text-capability-probe');
  // The current text-only profile is not widened to pretend it supports eight
  // kinds. Missing local methods may be described, but still cannot invoke.
  const eightFactory = TextCapabilityProbeModule.registerHttp({ enabled: true,
    dependencies: { ...httpDependencies, probeCapabilities: kinds } }).providers[0].useValue;
  const eightHttp = new TextCapabilityProbeController(eightFactory);
  await assert.rejects(http.prepare(request(), { requestKey: 'not-whitelisted', capability: 'embedding' }));
  const executionCounts = () => JSON.stringify({ sends, decrypts,
    invocations: h.state.aiGatewayInvocation, admissions: h.state.aiInvocationAdmission,
    reservations: h.state.aiBudgetReservation, ledger: h.state.aiBudgetLedgerEntry,
    receipts: h.state.aiTextCapabilityReceipt, charges: h.state.aiTaskExecutionCharge },
    (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  for (const capability of ['embedding', 'reasoning']) {
    const originalKey = { requestKey: `probe-no-method-${capability}` }, selection = { ...originalKey, capability };
    const noExecution = executionCounts();
    const prepared = checked('AiTextCapabilityPrepareResponseDraft', await eightHttp.prepare(request(), selection));
    assert.equal(prepared.capability, capability); assert.equal(prepared.methodVersion, `${capability}-unavailable-1`);
    const stored = checked('AiTextCapabilityPublishResponseDraft', await eightHttp.publish(request(), selection));
    assert.equal((await eightHttp.publish(request(), selection)).inputRef, stored.inputRef);
    await assert.rejects(eightHttp.publish(request(), { ...originalKey, capability: 'text' }), error => error.getStatus() === 409);
    const task = checked('AiTextCapabilityCreateTaskResponseDraft', await eightHttp.createTask(request(), originalKey));
    await authorizeTask(task.taskId);
    const row = h.state.aiTaskOriginalRequest.find(value => value.id === stored.inputRef);
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    const command = payload.command;
    const preparation = await root.application.prepareCurrent(command);
    assert.equal(preparation.intent, null); assert.equal(preparation.expected, null);
    assert.equal(payload.preparationHash, require('../apps/api/src/modules/rental-core/rental-idempotency.repository').requestFingerprint(preparation));
    const taskState = () => JSON.stringify({ task: h.state.aiTask.find(value => value.id === task.taskId),
      run: h.state.aiRun.find(value => value.id === task.runId) }, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    const stateBeforeRun = taskState();
    const preflightMethod = root.application.capabilities.preflight;
    root.application.capabilities.preflight = async () => assert.fail('remote evidence cannot supply a missing method');
    try { assert.equal((await root.application.preflightCurrent(command)).allowed, false); }
    finally { root.application.capabilities.preflight = preflightMethod; }
    const preflight = checked('AiTextCapabilityPreflightResponseDraft', await eightHttp.preflight(request(), originalKey));
    assert.equal(preflight.capability, capability); assert.equal(preflight.allowed, false); assert.equal(preflight.missing, true);
    for (const operation of ['start', 'reconcile']) {
      const result = checked('AiTextCapabilityRunResponseDraft', await eightHttp[operation](request(), originalKey));
      assert.equal(result.kind, 'not_started'); assert.equal(result.reason, 'task_not_runnable');
    }
    const observed = checked('AiTextCapabilityReceiptResponseDraft', await eightHttp.readCapabilityReceipt(request(), originalKey));
    assert.equal(observed.capability, capability); assert.equal(observed.status, 'unverified');
    assert.equal(observed.reason, capability === 'embedding' ? 'capability_not_enabled' : 'objective_method_unavailable'); assert.equal(observed.observation, null);
    const held = { stepId: 'unavailable-step', lease: { runId: task.runId, holderId: 'unavailable-holder', fencingToken: '1' },
      priceVersion: 'price', expiresAt: new Date(h.control.now.getTime() + 1000) };
    assert.equal((await root.application.runHeldCurrent(command, held)).status, 'unverified');
    await assert.rejects(root.application.prepareHeldInvocationCurrent(command, held), { code: 'CAPABILITY_UNSUPPORTED' });
    const current = await root.application.currentRequest(), authority = root.application.authority(current.context, command);
    const route = await authority.resolve(current.context, probeContract.textProbeRequirements(command));
    await assert.rejects(authority.authorizeDispatch(current.context, {}, route.route), { code: 'CAPABILITY_UNSUPPORTED' });
    const locator = { creationKey: require('../apps/api/src/modules/ai-native/text-capability-probe-task.composition').textProbeTaskCreationKey(originalKey.requestKey), inputRef: stored.inputRef };
    assert.equal((await root.workflow.startOriginal(locator)).kind, 'not_started');
    assert.equal((await root.workflow.reconcileOriginal(locator)).kind, 'not_started');
    await assert.rejects(eightHttp.releaseUnsent(request(), originalKey), error => error.getStatus() === 409);
    assert.equal(taskState(), stateBeforeRun);
    h.identity.user.permissions.splice(permissionIndex, 1);
    try { await assert.rejects(eightHttp.readCapabilityReceipt(request(), originalKey), error => error.getStatus() === 403); }
    finally { h.identity.user.permissions.splice(permissionIndex, 0, 'system:params:manage'); }
    assert.equal(executionCounts(), noExecution);
  }

  // Historical consumption keeps the old receipt after mode/revision changes,
  // disablement and expiry, but never treats it as current capability evidence.
  await root.workflow.taskPolicies.put({ taskId: cancellable.taskId, operation: 'read_step_terminal',
    requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01T00:00:00Z') }, null);
  h.control.now = new Date(h.control.now.getTime() + 3600001);
  h.state.aiTenantModelConfiguration[0].mode = 'platform_managed';
  h.state.aiTenantModelConfiguration[0].revision++;
  const disabledProfile = h.state.aiProviderProfile.find(row => row.id === profile.id);
  disabledProfile.enabled = false; disabledProfile.disabledAt = new Date(h.control.now); disabledProfile.configRevision++;
  for (const row of h.state.aiTaskPlanPolicy) row.enabled = false;
  const { AiTaskRepository } = require('../apps/api/src/modules/ai-native/ai-task.repository');
  const { AiTaskCreationRepository } = require('../apps/api/src/modules/ai-native/ai-task-creation.repository');
  const { ProviderCapabilityService } = require('../apps/api/src/modules/ai-native/provider-capability.service');
  const { PrismaTextProbeOriginalRequestRepository } = require('../apps/api/src/modules/ai-native/prisma-text-probe-original-request.repository');
  let writeAttempts = 0;
  const blocked = [[AiTaskRepository.prototype, 'claimRecoveryRun'], [AiTaskCreationRepository.prototype, 'create'],
    [ProviderCapabilityService.prototype, 'record'], [PrismaTextProbeOriginalRequestRepository.prototype, 'publish']]
    .map(([target, method]) => { const originalMethod = target[method];
      target[method] = async () => { writeAttempts++; throw Error('history must be read-only'); }; return { target, method, originalMethod }; });
  // Synthetic historical receipt metadata only: this remains mock and does
  // not revise accounting, certify a capability or invoke the provider again.
  const historicalReceipt = h.state.aiTextCapabilityReceipt.find(row => row.id === receipt.receiptId);
  const cachedObservation = typeof historicalReceipt.observation === 'string'
    ? JSON.parse(historicalReceipt.observation) : structuredClone(historicalReceipt.observation);
  cachedObservation.usage.billingDetails = { cachedInputTokens: 1, cacheCreationInputTokens: 0 };
  historicalReceipt.observation = typeof historicalReceipt.observation === 'string' ? JSON.stringify(cachedObservation) : cachedObservation;
  historicalReceipt.observationHash = require('../apps/api/src/modules/rental-core/rental-idempotency.repository').requestFingerprint(cachedObservation);
  const stateJson = () => JSON.stringify(h.state, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
  try {
    const beforeHistory = stateJson(), beforeDecrypts = decrypts;
    const history = checked('AiTextCapabilityHistoryResponseDraft', await http.readHistory(request(), key));
    assert.equal(history.task.taskId, created.taskId); assert.equal(history.run.runId, created.runId);
    assert.equal(history.configurationRevision, 1); assert.equal(history.observation.receiptId, receipt.receiptId);
    assert.equal(history.original.validity, 'expired'); assert.equal(history.observation.validity, 'expired');
    assert.equal(history.currentCapability, 'not_assessed'); assert.equal(history.applicability, 'historical_only');
    assert.equal(history.observation.mode, 'mock'); assert.equal(history.resultObserved, true);
    assert.deepEqual(history.observation.reportedUsage, { inputTokens: 1, outputTokens: 2 });
    const cancelledHistory = checked('AiTextCapabilityHistoryResponseDraft', await http.readHistory(request(), cancelKey));
    assert.equal(cancelledHistory.task.status, 'cancel_requested'); assert.equal(cancelledHistory.observation, null);
    assert.equal((await http.readHistory(request(), { requestKey: 'absent-history' })).state, 'not_observed');
    await assert.rejects(http.readHistory(request(), { ...key, taskId: 'forged-task' }), error => error.getStatus() === 400);
    await assert.rejects(http.readTask(request(), key)); // current consumer remains fail-closed
    assert.equal(writeAttempts, 0); assert.equal(sends, beforeSends); assert.equal(decrypts, beforeDecrypts); assert.equal(stateJson(), beforeHistory);
    const readPolicy = h.state.aiTaskActionPolicy.find(row => row.taskId === created.taskId && row.operation === 'read_step_terminal');
    readPolicy.expiresAt = new Date(h.control.now.getTime() - 1);
    await assert.rejects(http.readHistory(request(), key), error => error.getStatus() === 403);
    assert.equal(writeAttempts, 0);
  } finally { for (const { target, method, originalMethod } of blocked) target[method] = originalMethod; }

  // Revoke between the buffered read and response: return no cached receipt.
  const find = h.db.aiTaskOriginalRequest.findFirst.bind(h.db.aiTaskOriginalRequest);
  h.db.aiTaskOriginalRequest.findFirst = async args => { const row = await find(args); h.identity.session = false; return row; };
  await assert.rejects(http.readOriginal(request(), key), error => error.getStatus() === 403);
  assert.equal(sends, beforeSends);
});

test('native Responses reasoning crosses original HTTP task and single ledger without exporting thought text', async () => {
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const { composeAuthorizedPersistedTextProbeWorkflow } = require('../apps/api/src/modules/ai-native/text-capability-probe.composition');
  const { PrismaTaskPlanPolicyRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-policy.repository');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { SecretBox } = require('../apps/api/src/common/secret-box');
  const { tenantModelCredentialReference } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
  const { TEXT_PROBE_SCENE, TEXT_CAPABILITY_PROBE_TOOL, REASONING_PROBE_METHOD } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const h = await authorizedRunnerHarness({ aiProviderProfile: [], aiPlatformModelConnection: [], aiTenantModelConfiguration: [],
    systemParameterSet: [], aiTaskOriginalRequest: [], aiTaskPlanPolicy: [], aiTaskActionInput: [], aiProviderCapabilityEvidence: [],
    aiBudgetReservation: [], aiBudgetAllocation: [], aiBudgetLedgerEntry: [], aiTextCapabilityReceipt: [] });
  h.control.now = new Date(); h.identity.user.permissions.push('system:params:manage');
  h.db.aiPlatformModelConnection.update = async () => assert.fail('BYOK probe must not mutate platform configuration');
  const guard = new ApiAuthGuard(h.authorization.auth), clock = () => new Date(h.control.now);
  const secrets = new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'offline-reasoning-encryption' : undefined });
  const settings = { enabled: true, protocol: 'openai_responses', baseUrl: 'https://offline.example/v1',
    model: 'synthetic-model', timeoutMs: 30000, maxConcurrent: 1, maxOutputTokens: 32 };
  h.state.aiTenantModelConfiguration.push({ tenantId: 'tenant-a', revision: 1, mode: 'tenant_managed', settings,
    credentialsEncrypted: secrets.encrypt({ apiKey: 'offline-reasoning-key', tenantId: 'tenant-a',
      protocol: settings.protocol, baseUrl: settings.baseUrl, model: settings.model }) });
  const profile = { id: 'tenant-profile', scopeId: 'scope-tenant', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'tenant_managed', protocol: settings.protocol, provider: settings.protocol, model: settings.model,
    credentialRef: tenantModelCredentialReference('tenant-a', 1), configRevision: 1, enabled: true, disabledAt: null, allowedCapabilities: ['text', 'reasoning'] };
  h.state.aiProviderProfile.push(profile);
  for (const policy of h.state.aiBudgetPolicy) { policy.sceneCode = TEXT_PROBE_SCENE; policy.unitKind = 'calls';
    policy.settingsJson.sceneCode = TEXT_PROBE_SCENE; policy.settingsJson.allowedScenes = [TEXT_PROBE_SCENE]; }
  await new PrismaTaskPlanPolicyRepository(h.db, { ...h.authorization, guard,
    scene: { code: TEXT_PROBE_SCENE, version: '1' }, tool: TEXT_CAPABILITY_PROBE_TOOL }, clock)
    .put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: new Date(h.control.now.getTime() + 60000).toISOString() });
  let sends = 0;
  const dependencies = { ...h.authorization, db: h.db, guard, secrets, platformProfileId: 'platform-default',
    pricing: { mode: 'persisted_calls', priceVersion: 'price' }, audit: { append: async () => {} },
    protocol: { post: async request => { sends++; assert.equal(request.url.endsWith('/responses'), true);
      const body = JSON.parse(request.body), question = body.input[0].content, match = /Compute \((\d+) \+ (\d+)\) \* (\d+)/u.exec(question);
      assert.ok(match); assert.equal(body.store, false);
      return { status: 200, body: JSON.stringify({ status: 'completed', output: [
        { type: 'reasoning', id: 'reasoning-native-1', summary: [{ text: 'unexported synthetic thought' }] },
        { type: 'message', id: 'answer-native-1', role: 'assistant', status: 'completed', content: [{ type: 'output_text',
          text: String((Number(match[1]) + Number(match[2])) * Number(match[3])) }] }],
        usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12, output_tokens_details: { reasoning_tokens: 4 } } }) }; } },
    host: { holderId: 'reasoning-host', leaseMs: 100000 }, sceneVersion: '1', priceVersion: 'price', clock, monotonic: () => h.control.tick };
  const root = composeAuthorizedPersistedTextProbeWorkflow(dependencies), { credentials, ...httpDependencies } = dependencies;
  const { TextCapabilityProbeModule } = require('../apps/api/src/modules/ai-native/text-capability-probe.module');
  const { TextCapabilityProbeController } = require('../apps/api/src/modules/ai-native/text-capability-probe.controller');
  const http = new TextCapabilityProbeController(TextCapabilityProbeModule.registerHttp({ enabled: true,
    dependencies: { ...httpDependencies, probeCapabilities: ['text', 'reasoning'] } }).providers[0].useValue);
  const request = { headers: { authorization: (await credentials.current()).authorization } }, key = { requestKey: 'native-reasoning-original' };
  assert.equal((await http.prepare(request, { ...key, capability: 'reasoning' })).methodVersion, REASONING_PROBE_METHOD);
  const original = await http.publish(request, { ...key, capability: 'reasoning' });
  const task = await http.createTask(request, key);
  for (const operation of ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'read_step_terminal', 'request_input'])
    await root.workflow.taskPolicies.put({ taskId: task.taskId, operation, requiredPermissions: ['rental-os:order:view'],
      expiresAt: new Date('2027-01-01T00:00:00Z') }, null);
  const result = await http.start(request, key);
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'succeeded');
  assert.equal(sends, 1); assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.state.aiBudgetReservation.length, 1);
  assert.equal(h.state.aiBudgetReservation[0].status, 'settled'); assert.equal(h.state.aiBudgetLedgerEntry.filter(row => row.kind === 'settle').length, 1);
  const publicReceipt = await http.readCapabilityReceipt(request, key);
  assert.equal(publicReceipt.status, 'unverified'); assert.equal(publicReceipt.observation.mode, 'mock');
  const stored = h.state.aiTextCapabilityReceipt.find(row => row.id === publicReceipt.receiptId), observation = typeof stored.observation === 'string' ? JSON.parse(stored.observation) : structuredClone(stored.observation);
  assert.equal(observation.matched, true); assert.equal(observation.reasoningEvidence.methodVersion, REASONING_PROBE_METHOD);
  assert.equal(observation.reasoningEvidence.reasoningTokens, 4); assert.deepEqual(observation.usage, { inputTokens: 5, outputTokens: 7 });
  assert.equal(JSON.stringify({ publicReceipt, stored }).includes('unexported synthetic thought'), false);
  assert.equal(JSON.stringify({ publicReceipt, stored }).includes('reasoning-native-1'), false);
  // Synthetic live marker tests ONLY the original verifier's coherent payload
  // boundary. It does not convert this mock execution into supplier evidence.
  const { PrismaTextCapabilityReceiptRepository } = require('../apps/api/src/modules/ai-native/prisma-text-capability-receipt.repository');
  const { textProbeEvidenceHash } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  // The generic in-memory insert delegate omits nullable DB columns. MySQL/
  // Prisma returns NULL for these schema-defined columns; model those defaults,
  // not missing usage, quantities or timestamps, before testing the real verifier.
  for (const row of h.state.aiBudgetReservation) for (const field of ['actualTokens', 'actualMoney', 'moneyCurrency'])
    if (row[field] === undefined) row[field] = null;
  for (const row of h.state.aiBudgetLedgerEntry) for (const field of ['inputTokens', 'outputTokens', 'moneyAmount', 'moneyCurrency', 'reason'])
    if (row[field] === undefined) row[field] = null;
  const verifier = new PrismaTextCapabilityReceiptRepository(h.db, clock), savedObservation = stored.observation, savedHash = stored.observationHash;
  const currentStored = () => h.state.aiTextCapabilityReceipt.find(row => row.id === stored.id);
  try {
    const live = { ...observation, transport: 'node_https' };
    const verify = async value => {
      currentStored().observation = typeof savedObservation === 'string' ? JSON.stringify(value) : value;
      currentStored().observationHash = requestFingerprint(value);
      const receipt = await verifier.read(stored.id);
      return verifier.verify({ profile, capability: 'reasoning', status: 'supported', source: 'connection_test',
        evidenceHash: textProbeEvidenceHash(receipt), checkedAt: new Date(value.checkedAt), expiresAt: new Date(value.expiresAt),
        details: { receiptId: stored.id, verification: { evidence: 'live', methodVersion: REASONING_PROBE_METHOD,
          capability: 'reasoning', profileFingerprint: capabilityProfileFingerprint(profile) } } });
    };
    assert.equal(await verify(live), true);
    const missing = structuredClone(live); delete missing.reasoningEvidence;
    assert.equal(await verify(missing), false);
    assert.equal(await verify({ ...live, reasoningEvidence: { ...live.reasoningEvidence, reasoningTokens: 8 } }), false);
  } finally { currentStored().observation = savedObservation; currentStored().observationHash = savedHash; }
  assert.equal((await http.publish(request, { ...key, capability: 'reasoning' })).inputRef, original.inputRef);
  assert.equal((await http.reconcile(request, key)).kind, 'not_started'); assert.equal(sends, 1);
});

test('native Embedding probe crosses original HTTP task and ledger with opaque vectors and zero generated tokens', async () => {
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const { composeAuthorizedPersistedTextProbeWorkflow } = require('../apps/api/src/modules/ai-native/text-capability-probe.composition');
  const { PrismaTaskPlanPolicyRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-policy.repository');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { SecretBox } = require('../apps/api/src/common/secret-box');
  const { tenantModelCredentialReference } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
  const { TEXT_PROBE_SCENE, TEXT_CAPABILITY_PROBE_TOOL, EMBEDDING_PROBE_METHOD, textProbeEvidenceHash } = require('../apps/api/src/modules/ai-native/text-capability-probe');
  const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const h = await authorizedRunnerHarness({ aiProviderProfile: [], aiPlatformModelConnection: [], aiTenantModelConfiguration: [],
    systemParameterSet: [], aiTaskOriginalRequest: [], aiTaskPlanPolicy: [], aiTaskActionInput: [], aiProviderCapabilityEvidence: [],
    aiBudgetReservation: [], aiBudgetAllocation: [], aiBudgetLedgerEntry: [], aiTextCapabilityReceipt: [] });
  h.control.now = new Date(); h.identity.user.permissions.push('system:params:manage');
  h.db.aiPlatformModelConnection.update = async () => assert.fail('BYOK probe must not mutate platform configuration');
  const guard = new ApiAuthGuard(h.authorization.auth), clock = () => new Date(h.control.now);
  const secrets = new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'offline-embedding-encryption' : undefined });
  const settings = { enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://offline.example/v1',
    model: 'synthetic-embedding', timeoutMs: 30000, maxConcurrent: 1, maxOutputTokens: 32 };
  h.state.aiTenantModelConfiguration.push({ tenantId: 'tenant-a', revision: 1, mode: 'tenant_managed', settings,
    credentialsEncrypted: secrets.encrypt({ apiKey: 'offline-embedding-key', tenantId: 'tenant-a',
      protocol: settings.protocol, baseUrl: settings.baseUrl, model: settings.model }) });
  const profile = { id: 'tenant-profile', scopeId: 'scope-tenant', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'tenant_managed', protocol: settings.protocol, provider: settings.protocol, model: settings.model,
    credentialRef: tenantModelCredentialReference('tenant-a', 1), configRevision: 1, enabled: true, disabledAt: null, allowedCapabilities: ['embedding'] };
  h.state.aiProviderProfile.push(profile);
  for (const policy of h.state.aiBudgetPolicy) { policy.sceneCode = TEXT_PROBE_SCENE; policy.unitKind = 'calls';
    policy.settingsJson.sceneCode = TEXT_PROBE_SCENE; policy.settingsJson.allowedScenes = [TEXT_PROBE_SCENE]; }
  await new PrismaTaskPlanPolicyRepository(h.db, { ...h.authorization, guard,
    scene: { code: TEXT_PROBE_SCENE, version: '1' }, tool: TEXT_CAPABILITY_PROBE_TOOL }, clock)
    .put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: new Date(h.control.now.getTime() + 60000).toISOString() });
  let sends = 0;
  const dependencies = { ...h.authorization, db: h.db, guard, secrets, platformProfileId: 'platform-default',
    pricing: { mode: 'persisted_calls', priceVersion: 'price' }, audit: { append: async () => {} },
    protocol: { post: async request => { sends++; assert.equal(request.url.endsWith('/embeddings'), true);
      const body = JSON.parse(request.body); assert.equal(body.input.length, 2); assert.notEqual(body.input[0], body.input[1]);
      assert.equal(Object.hasOwn(body, 'messages'), false);
      return { status: 200, body: JSON.stringify({ object: 'list', model: body.model, data: [
        { object: 'embedding', index: 0, embedding: [0.2, 0.5, 0.7] }, { object: 'embedding', index: 1, embedding: [0.8, -0.1, 0.3] }],
        usage: { prompt_tokens: 5, total_tokens: 5 } }) }; } },
    host: { holderId: 'embedding-host', leaseMs: 100000 }, sceneVersion: '1', priceVersion: 'price', clock, monotonic: () => h.control.tick };
  const root = composeAuthorizedPersistedTextProbeWorkflow(dependencies), { credentials, ...httpDependencies } = dependencies;
  const { TextCapabilityProbeModule } = require('../apps/api/src/modules/ai-native/text-capability-probe.module');
  const { TextCapabilityProbeController } = require('../apps/api/src/modules/ai-native/text-capability-probe.controller');
  const http = new TextCapabilityProbeController(TextCapabilityProbeModule.registerHttp({ enabled: true,
    dependencies: { ...httpDependencies, probeCapability: 'embedding', probeCapabilities: ['embedding'] } }).providers[0].useValue);
  const request = { headers: { authorization: (await credentials.current()).authorization } }, key = { requestKey: 'native-embedding-original' };
  assert.equal((await http.prepare(request, { ...key, capability: 'embedding' })).methodVersion, EMBEDDING_PROBE_METHOD);
  const original = await http.publish(request, { ...key, capability: 'embedding' }), task = await http.createTask(request, key);
  for (const operation of ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'read_step_terminal', 'request_input'])
    await root.workflow.taskPolicies.put({ taskId: task.taskId, operation, requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01T00:00:00Z') }, null);
  const result = await http.start(request, key);
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'succeeded');
  assert.equal(sends, 1); assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.state.aiBudgetReservation.length, 1);
  assert.equal(h.state.aiBudgetReservation[0].status, 'settled'); assert.equal(h.state.aiBudgetLedgerEntry.filter(row => row.kind === 'settle').length, 1);
  const publicReceipt = await http.readCapabilityReceipt(request, key);
  assert.equal(publicReceipt.status, 'unverified'); assert.equal(publicReceipt.observation.mode, 'mock');
  const stored = () => h.state.aiTextCapabilityReceipt.find(row => row.id === publicReceipt.receiptId);
  const observation = typeof stored().observation === 'string' ? JSON.parse(stored().observation) : structuredClone(stored().observation);
  assert.equal(observation.matched, true); assert.deepEqual(observation.usage, { inputTokens: 5, outputTokens: 0 });
  assert.equal(observation.embeddingEvidence.methodVersion, EMBEDDING_PROBE_METHOD); assert.equal(observation.embeddingEvidence.vectorCount, 2);
  assert.equal(Object.hasOwn(publicReceipt.observation, 'embeddingEvidence'), false);
  assert.equal(JSON.stringify(stored()).includes('[0.2,0.5,0.7]'), false);
  // Model known SQL NULL defaults only; synthetic live marker is verifier logic,
  // not native environment/provider evidence or a change to production facts.
  for (const row of h.state.aiBudgetReservation) for (const field of ['actualTokens', 'actualMoney', 'moneyCurrency']) if (row[field] === undefined) row[field] = null;
  for (const row of h.state.aiBudgetLedgerEntry) for (const field of ['inputTokens', 'outputTokens', 'moneyAmount', 'moneyCurrency', 'reason']) if (row[field] === undefined) row[field] = null;
  const { PrismaTextCapabilityReceiptRepository } = require('../apps/api/src/modules/ai-native/prisma-text-capability-receipt.repository');
  const verifier = new PrismaTextCapabilityReceiptRepository(h.db, clock), oldObservation = stored().observation, oldHash = stored().observationHash;
  try {
    const live = { ...observation, transport: 'node_https' };
    const verify = async value => { stored().observation = typeof oldObservation === 'string' ? JSON.stringify(value) : value; stored().observationHash = requestFingerprint(value);
      const receipt = await verifier.read(stored().id);
      return verifier.verify({ profile, capability: 'embedding', status: 'supported', source: 'connection_test',
        evidenceHash: textProbeEvidenceHash(receipt), checkedAt: new Date(value.checkedAt), expiresAt: new Date(value.expiresAt), details: {
          receiptId: receipt.id, verification: { evidence: 'live', methodVersion: EMBEDDING_PROBE_METHOD, capability: 'embedding', profileFingerprint: capabilityProfileFingerprint(profile) } } }); };
    assert.equal(await verify(live), true);
    const missing = structuredClone(live); delete missing.embeddingEvidence; assert.equal(await verify(missing), false);
    assert.equal(await verify({ ...live, embeddingEvidence: { ...live.embeddingEvidence, inputHash: 'a'.repeat(64) } }), false);
  } finally { stored().observation = oldObservation; stored().observationHash = oldHash; }
  assert.equal((await http.publish(request, { ...key, capability: 'embedding' })).inputRef, original.inputRef);
  assert.equal((await http.reconcile(request, key)).kind, 'not_started'); assert.equal(sends, 1);
});

test('text request host distinguishes an early response disconnect from normal body or response close', async () => {
  const { EventEmitter } = require('node:events');
  const { TextCapabilityProbeController } = require('../apps/api/src/modules/ai-native/text-capability-probe.controller');
  for (const finished of [false, true]) {
    let signal, finish, closed = 0;
    // Transport-only unit substitute; not an authorization or runner proof.
    const http = new TextCapabilityProbeController({ open: () => ({
      start: async (_body, currentSignal) => { signal = currentSignal; await new Promise(resolve => { finish = resolve; });
        return { kind: 'not_started', reason: 'host_aborted' }; }, close: () => { closed++; },
    }) });
    const req = Object.assign(new EventEmitter(), { headers: { authorization: 'Bearer synthetic' }, complete: true });
    const res = Object.assign(new EventEmitter(), { writableFinished: finished, destroyed: false });
    const pending = http.start(req, { requestKey: 'disconnect' }, res);
    req.emit('close'); assert.equal(signal.aborted, false);
    res.emit('close'); assert.equal(signal.aborted, !finished);
    finish(); await pending;
    assert.equal(closed, 1); assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
  }
});

test('authorized probe root is inert, binds its own financial evidence and refuses unconfigured original requests', async () => {
  const { composeAuthorizedPersistedTextProbeWorkflow } = require('../apps/api/src/modules/ai-native/text-capability-probe.composition');
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const h = await authorizedRunnerHarness({ aiProviderProfile: [], aiPlatformModelConnection: [],
    aiTenantModelConfiguration: [], systemParameterSet: [], aiTaskOriginalRequest: [], aiTaskPlanPolicy: [],
    aiProviderCapabilityEvidence: [], aiBudgetReservation: [], aiBudgetAllocation: [], aiBudgetLedgerEntry: [] });
  // Existing store only implements updateMany. Platform configuration needs
  // Prisma update too; no operation in this scenario may ever invoke it.
  h.db.aiPlatformModelConnection.update = async () => { throw Error('unexpected platform configuration write'); };
  h.db.aiProviderCapabilityEvidence.upsert = async () => { throw Error('unexpected capability evidence write'); };
  let guards = 0, decrypts = 0, transports = 0;
  const root = composeAuthorizedPersistedTextProbeWorkflow({ ...h.authorization, db: h.db,
    guard: { canActivate: async () => { guards++; return false; } },
    secrets: { encrypt: () => { throw Error('not requested'); }, decrypt: () => { decrypts++; throw Error('not requested'); } },
    platformProfileId: 'platform-default', pricing: { mode: 'persisted_calls', priceVersion: 'server-price' },
    audit: { append: async () => { throw Error('no execution'); } },
    protocol: { post: async () => { transports++; throw Error('network forbidden'); } },
    host: { holderId: 'probe-host', leaseMs: 1000 }, sceneVersion: 'v1', priceVersion: 'server-price', clock: () => h.control.now });
  assert.equal(guards, 0); assert.equal(decrypts, 0); assert.equal(transports, 0);
  assert.equal(root.application.financialEvidence.readDispatch instanceof Function, true);
  await assert.rejects(root.workflow.publishOriginal({ requestKey: 'probe-original', command: {
    operationId: 'probe-operation', profileKey: 'default', profileFingerprint: 'a'.repeat(64) } }));
  assert.equal(h.state.aiTaskOriginalRequest.length, 0);
  assert.equal(decrypts, 0); assert.equal(transports, 0);
});
