'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
if (process.env.DATABASE_URL !== 'mysql://offline:offline@127.0.0.1:1/rental_os_offline' || !process.env.AI_OFFLINE_WRITE_ROOT) {
  throw Error('Run only with the existing offline guard and lane-b-local-runtime preloads');
}
require('ts-node').register({ project: path.resolve(__dirname, '../apps/api/tsconfig.json'), transpileOnly: false,
  compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { randomUUID } = require('node:crypto');
const { HumanAutomationPolicyRequestFactory } = require('../apps/api/src/modules/ai-native/automation/human-automation-policy-request.composition');
const { HumanAutomationPolicyRequestController } = require('../apps/api/src/modules/ai-native/automation/human-automation-policy-request.controller');
const { HumanAutomationPolicyRequestModule } = require('../apps/api/src/modules/ai-native/automation/human-automation-policy-request.module');
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard, requiredPermissions } = require('../apps/api/src/common/api-auth.guard');
const { isStaffBusinessRouteAllowed } = require('../apps/api/src/common/staff-api-policy');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
const { AI_TOOL_DRAFT_VERSION } = require('../packages/shared/src/ai-native');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
const errorCode = code => error => error.getResponse?.().code === code;

test('CCB13 operator policy proposals require original grants, fresh revisions and original-key recovery', async () => {
  const now = new Date(), expiresAt = new Date(now.getTime() + 3600000), scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const actor = user({ permissions: ['system:params:manage', 'rental-os:order:view'] });
  const state = Object.fromEntries(['subjects', 'policies', 'preparations', 'operations', 'grants'].map(name => [name, new Map()]));
  let active = true, writes = 0, lostCommitReply = false, afterPlanRead;
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const delegate = name => ({
    async findFirst({ where }) { return structuredClone([...state[name].values()].find(row => matches(row, where)) ?? null); },
    async create({ data }) { writes++; const row = { createdAt: now, ...structuredClone(data) }; state[name].set(row.id, row); return structuredClone(row); },
    async updateMany({ where, data }) {
      writes++; let count = 0;
      for (const row of state[name].values()) if (matches(row, where)) {
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : structuredClone(value);
        count++;
      }
      return { count };
    }
  });
  const db = {
    aiScope: { findFirst: async () => ({ id: 'scope-workspace', ...aiPersistenceScopeColumns({ kind: 'workspace', ...scope }) }) },
    businessWorkspace: { findFirst: async () => ({ id: scope.workspaceId, tenantId: scope.tenantId, status: 'ACTIVE' }) },
    rentalFulfillmentLocation: { findMany: async () => [{ id: 'location-a', ...scope }] },
    aiTaskPlanPolicy: { findFirst: async () => {
      if (afterPlanRead) { const hook = afterPlanRead; afterPlanRead = undefined; hook(); }
      return { scopeId: 'scope-workspace', sceneCode: 'failure.review', sceneVersion: '1', revision: 1, enabled: true, expiresAt,
        allowedTools: [{ code: 'rental.catalog.search', version: AI_TOOL_DRAFT_VERSION }],
        limits: { maxSteps: 1, maxCalls: 1, maxConcurrent: 1, maxTotalMs: 1000, maxStepMs: 1000, maxOutputBytes: 4096 } };
    } },
    aiAutomationSubject: delegate('subjects'), aiAutomationPolicy: delegate('policies'),
    aiAutomationPolicyPreparation: delegate('preparations'), aiAutomationPolicyManagementOperation: delegate('operations'),
    aiAutomationManagementGrant: delegate('grants'), $queryRaw: async () => [],
    $transaction: async work => {
      const before = structuredClone(state); let result;
      try { result = await work(db); } catch (error) { Object.assign(state, before); throw error; }
      if (lostCommitReply && state.operations.size > before.operations.size) { lostCommitReply = false; throw Error('lost management commit reply'); }
      return result;
    }
  };
  const auth = new AuthService({ getAuthSession: async id => active ? { id, userId: actor.id, audience: id === 'staff-session' ? 'staff' : 'operator', currentWorkspaceId: scope.workspaceId } : undefined,
    findUserById: async () => actor, findWorkspaceScopedUser: async () => actor, listUserWorkspaces: async () => [] },
  { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-secret' : undefined });
  const request = audience => ({ headers: { authorization: `Bearer ${auth.signAccessToken({ sub: actor.id, tid: scope.tenantId,
    sid: audience === 'staff' ? 'staff-session' : 'operator-session', aud: audience, exp: Math.floor(Date.now() / 1000) + 600 })}` } });
  const dependencies = { db, auth, guard: new ApiAuthGuard(auth), clock: () => now };
  const enter = (audience, route) => runWithRequestIdentity({}, () => dependencies.guard.canActivate({
    switchToHttp: () => ({ getRequest: () => ({ ...request(audience), method: 'POST', url: `/api${route}` }) }) }));
  const prefix = '/ai-native/automation/operator/policies/';
  for (const action of ['read', 'preview', 'prepare', 'preparation', 'review', 'operation', 'commit']) {
    assert.deepEqual(requiredPermissions('POST', prefix + action), ['system:params:manage']);
    assert.notDeepEqual(requiredPermissions('GET', prefix + action), ['system:params:manage']);
    assert.equal(isStaffBusinessRouteAllowed('POST', prefix + action), false);
    assert.equal(await enter('operator', prefix + action), true);
  }
  assert.notDeepEqual(requiredPermissions('POST', prefix + 'execute'), ['system:params:manage']);
  await assert.rejects(enter('staff', prefix + 'read'));
  actor.permissions = ['rental-os:order:view'];
  await assert.rejects(enter('operator', prefix + 'read'));
  actor.permissions = ['system:params:manage', 'rental-os:order:view'];
  assert.deepEqual(HumanAutomationPolicyRequestModule.register().controllers, []);
  assert.throws(() => HumanAutomationPolicyRequestModule.register({ enabled: true }), /unavailable/);
  assert.throws(() => new HumanAutomationPolicyRequestFactory({ ...dependencies, credentials: {} }), /unavailable/);
  assert.throws(() => new HumanAutomationPolicyRequestFactory({ ...dependencies, guard: undefined }), /unavailable/);
  assert.equal(HumanAutomationPolicyRequestModule.register({ enabled: true, dependencies }).controllers.length, 1);
  const controller = new HumanAutomationPolicyRequestController(new HumanAutomationPolicyRequestFactory(dependencies));
  const call = (action, value) => controller[action](request('operator'), value);
  const proposal = { operationKey: 'create-disabled', subjectId: null, policyId: null, expectedSubjectRevision: null, expectedPolicyRevision: null,
    subject: { enabled: false, revoked: false, permissions: ['rental-os:order:view'], locationScope: { mode: 'all', locationIds: [] }, expiresAt: expiresAt.toISOString() },
    policy: { mode: 'disabled', revoked: false, sceneCode: 'failure.review', sceneVersion: '1', allowedEventTypes: ['inspection.return_exception'],
      maxTasksPerDay: 2, cooldownSeconds: 1, validFrom: new Date(now.getTime() - 1000).toISOString(), expiresAt: expiresAt.toISOString() } };
  await assert.rejects(controller.preview(request('staff'), proposal), errorCode('AI_RESOURCE_UNAVAILABLE'));
  await assert.rejects(call('preview', { ...proposal, grant: { enabled: true } }), errorCode('AI_INVALID_INPUT'));
  await assert.rejects(call('preview', { ...proposal, policy: { ...proposal.policy, recipients: ['forged'] } }), errorCode('AI_INVALID_INPUT'));
  await assert.rejects(call('preview', { ...proposal, subject: { ...proposal.subject, enabled: true } }), errorCode('AI_INVALID_INPUT'));
  const body = structuredClone(proposal), incoming = request('operator');
  const pending = runWithRequestIdentity({ tenantId: 'foreign', workspaceId: 'foreign', userId: 'foreign' }, () => controller.preview(incoming, body));
  incoming.headers.authorization = 'Bearer changed'; body.policy.mode = 'shadow';
  const preview = await pending; assert.equal(preview.command.policy.mode, 'disabled'); assert.equal(preview.executionPermission, false); assert.equal(writes, 0);
  afterPlanRead = () => { actor.permissions.push('system:integration:manage'); };
  await assert.rejects(call('preview', proposal), errorCode('AI_RESOURCE_UNAVAILABLE'));
  actor.permissions.pop();
  await assert.rejects(call('prepare', proposal), errorCode('AI_RESOURCE_UNAVAILABLE')); assert.equal(state.preparations.size, 0);
  // These explicit synthetic records stand for an existing authorized issuer;
  // neither the HTTP factory nor the management service creates a grant.
  const grant = (action, resourceHash) => { const id = randomUUID(); state.grants.set(id, { id, ...scope, scopeId: 'scope-workspace',
    actorKind: 'user', actorId: actor.id, audience: 'operator', action, resourceHash, requiredPermissions: ['system:params:manage'],
    enabled: true, revision: 1, expiresAt }); };
  grant('prepare', preview.prepareResourceHash);
  const prepared = await call('prepare', proposal);
  assert.equal(prepared.state, 'prepared'); assert.equal(state.subjects.size, 0); assert.equal(state.policies.size, 0);
  assert.equal((await call('preparation', { operationKey: proposal.operationKey })).preparationId, prepared.preparationId);
  assert.equal((await call('review', { preparationId: prepared.preparationId })).changeHash, prepared.changeHash);
  const commit = value => ({ preparationId: value.preparationId, changeHash: value.changeHash, confirm: 'apply_automation_policy_change' });
  await assert.rejects(call('commit', commit(prepared)), errorCode('AI_RESOURCE_UNAVAILABLE'));
  await assert.rejects(call('commit', { ...commit(prepared), confirm: 'execute_automatically' }), errorCode('AI_INVALID_INPUT'));
  grant('commit', prepared.commitResourceHash); lostCommitReply = true;
  assert.equal((await call('commit', commit(prepared))).state, 'unknown');
  state.grants.clear(); const recoveryWrites = writes;
  const receipt = await call('operation', { operationKey: proposal.operationKey });
  assert.equal(receipt.state, 'observed'); assert.equal(receipt.result.subject.enabled, false); assert.equal(receipt.result.policy.mode, 'disabled');
  assert.equal(receipt.result.subject.enabledBy, null); assert.equal(receipt.businessActionRequested, false);
  assert.equal((await call('commit', commit(prepared))).operationId, receipt.operationId); assert.equal(writes, recoveryWrites);
  const ids = { subjectId: receipt.result.subject.id, policyId: receipt.result.policy.id };
  const enable = { ...structuredClone(proposal), ...ids, operationKey: 'enable-old', expectedSubjectRevision: 1, expectedPolicyRevision: 1,
    subject: { ...proposal.subject, enabled: true }, policy: { ...proposal.policy, mode: 'manual_confirmation' } };
  const enablePreview = await call('preview', enable); grant('prepare', enablePreview.prepareResourceHash);
  const oldDraft = await call('prepare', enable); grant('commit', oldDraft.commitResourceHash);
  state.policies.get(ids.policyId).revision++;
  assert.equal((await call('review', { preparationId: oldDraft.preparationId })).state, 'stale');
  await assert.rejects(call('commit', commit(oldDraft)), errorCode('AI_REVISION_CONFLICT'));
  assert.equal(state.operations.size, 1); assert.equal(state.subjects.get(ids.subjectId).enabled, false);
  const fresh = { ...enable, operationKey: 'enable-current', expectedPolicyRevision: 2 };
  const freshPreview = await call('preview', fresh); grant('prepare', freshPreview.prepareResourceHash);
  const freshDraft = await call('prepare', fresh); grant('commit', freshDraft.commitResourceHash);
  const enabled = await call('commit', commit(freshDraft));
  assert.equal(enabled.result.policy.mode, 'manual_confirmation'); assert.equal(enabled.result.subject.enabledBy, actor.id);
  assert.equal(enabled.executionPermission, false); assert.equal((await call('read', ids)).policy.revision, 3);
  actor.dataScope = 'own'; await assert.rejects(call('read', ids), errorCode('AI_RESOURCE_UNAVAILABLE')); actor.dataScope = 'all';
  actor.isSaasAdmin = true; await assert.rejects(call('read', ids), errorCode('AI_RESOURCE_UNAVAILABLE')); actor.isSaasAdmin = false;
  active = false; await assert.rejects(call('operation', { operationKey: fresh.operationKey }), errorCode('AI_RESOURCE_UNAVAILABLE'));
  assert.equal(state.operations.size, 2);
});
