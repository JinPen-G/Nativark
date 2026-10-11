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

test('authorized original probe executes through persisted runner and one financial ledger', async () => {
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
  h.state.aiProviderProfile.push(profile);
  for (const policy of h.state.aiBudgetPolicy) {
    policy.sceneCode = TEXT_PROBE_SCENE; policy.unitKind = 'calls'; policy.settingsJson.sceneCode = TEXT_PROBE_SCENE;
    policy.settingsJson.allowedScenes = [TEXT_PROBE_SCENE];
  }
  const guard = new ApiAuthGuard(h.authorization.auth);
  const clock = () => new Date(h.control.now);
  const policy = new PrismaTaskPlanPolicyRepository(h.db, { ...h.authorization, guard,
    scene: { code: TEXT_PROBE_SCENE, version: '1' }, tool: TEXT_CAPABILITY_PROBE_TOOL }, clock);
  await policy.put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: '2027-01-01T00:00:00Z' });
  let sends = 0;
  const root = composeAuthorizedPersistedTextProbeWorkflow({ ...h.authorization, db: h.db, guard, secrets,
    platformProfileId: 'platform-default', pricing: { mode: 'persisted_calls', priceVersion: 'price' },
    audit: { append: async () => {} }, protocol: { post: async () => { sends++;
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'offline reply' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 2 } }) }; } },
    host: { holderId: 'probe-host', leaseMs: 100000 }, sceneVersion: '1', priceVersion: 'price', clock, monotonic: () => h.control.tick });
  const original = await root.workflow.publishOriginal({ requestKey: 'probe-complete', command: {
    operationId: 'probe-complete', profileKey: profile.profileKey, profileFingerprint: capabilityProfileFingerprint(profile) } });
  const key = { creationKey: 'probe-task-complete', inputRef: original.inputRef };
  const created = await root.workflow.createTask(key);
  for (const operation of ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'read_step_terminal', 'request_input']) {
    await root.workflow.taskPolicies.put({ taskId: created.taskId, operation, requiredPermissions: ['rental-os:order:view'],
      expiresAt: new Date('2027-01-01T00:00:00Z') }, null);
  }
  const result = await root.workflow.startOriginal(key);
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
  const receipt = await root.workflow.readCapabilityReceipt(key);
  assert.equal(receipt.status, 'unverified'); // synthetic IO never certifies a real provider
  await assert.rejects(() => root.workflow.startOriginal(key), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(sends, 1); // terminal task cannot reacquire claim_run permission
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
