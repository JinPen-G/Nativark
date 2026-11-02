'use strict';
const { AuthService } = require('../../../apps/api/src/modules/auth/auth.service');
const { SubscriptionService } = require('../../../apps/api/src/modules/subscription/subscription.service');
const { composePersistedTaskAuthorization } = require('../../../apps/api/src/modules/ai-native/task-authorization.composition');
const { aiPersistenceScopeColumns } = require('../../../apps/api/src/modules/ai-native/persistence-scope');
const { AI_TASK_INPUT_DRAFT_VERSION } = require('./local-shared.cjs');
const { user } = require('./authorization-baseline.cjs');
const { taskInputHarness } = require('./task-input-harness.cjs');
const contract = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, code: 'synthetic-clarification', version: '1',
  fields: [{ fieldId: 'clarification_text', kind: 'text', label: 'Context', required: true, maxLength: 100 }] };
const operations = ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task',
  'read_step_terminal', 'takeover_run', 'request_input', 'submit_input', 'resume_input'];

// Real AuthService, SubscriptionService and authorization composition; database, registry and tool facts are synthetic.
async function authorizedRunnerHarness(extraTables = {}) {
  const scene = 'synthetic-clarification';
  const scopes = [{ id: 'scope-platform', ...aiPersistenceScopeColumns({ kind: 'platform' }) },
    { id: 'scope-tenant', ...aiPersistenceScopeColumns({ kind: 'tenant', tenantId: 'tenant-a' }) },
    { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) }];
  const h = await taskInputHarness({
    aiScope: scopes,
    aiTaskActionPolicy: operations.map(operation => ({ scopeId: 'scope-a', taskId: 'task-a', operation, revision: 1,
      requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01T00:00:00Z') })),
    aiBudgetPolicy: scopes.map(scope => ({ id: `policy-${scope.id}`, scopeId: scope.id, scopeKind: scope.kind, sceneCode: scene, configRevision: 1, enabled: true,
      settingsJson: { draftVersion: 'ain-c07-draft-2', scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant-a' },
        config: { configRevision: 1 }, gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
        sceneCode: scene, allowedModels: ['synthetic-model'], allowedScenes: [scene], budget: { state: 'limited', quantity: { unit: 'calls', value: 10 } }, maxConcurrent: 1, maxCallsPerRun: 5 } })),
    tenant: [{ id: 'tenant-a', subscription: { id: 'sub-a', tenantId: 'tenant-a', revision: 4, plan: 'PRO', source: 'HISTORICAL_REGISTER',
      startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), serviceTimeZone: 'UTC', billingAnniversary: new Date('2026-01-01') }, subscriptionSegments: [] }],
    subscriptionFeatureCatalog: [{ code: 'ai.native.use', name: 'Synthetic AI catalog feature', module: 'ai', categories: [], currentOwnership: 'PRO',
      defaultOwnership: 'PRO', releaseStatus: 'RELEASED', valueText: null, externalFeeNote: null }],
    tenantFeatureGrant: [], aiTenantModelConfiguration: [], aiTaskInputRequest: [], aiTaskInputReceipt: [], ...extraTables
  }, { aiTaskInputRequest: [['scopeId', 'taskId', 'id'], ['scopeId', 'taskId', 'runId', 'stepId', 'planHash']],
    aiTaskInputReceipt: [['scopeId', 'taskId', 'requestId'], ['scopeId', 'taskId', 'submissionKey']] });
  const identity = { user: user({ id: 'user-a' }), session: true, membership: true, workspace: 'workspace-a' };
  const auth = new AuthService({
    getAuthSession: async () => identity.session ? { id: 'session-a', userId: identity.user.id, audience: 'operator', currentWorkspaceId: identity.workspace } : undefined,
    findUserById: async () => identity.user,
    findWorkspaceScopedUser: async () => identity.membership ? identity.user : undefined,
    listUserWorkspaces: async () => []
  }, { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-runner-authority-secret' : undefined });
  // One request retains one credential. Regenerating its exp on every read
  // falsely simulates identity replacement at each wall-clock second boundary.
  const tokenExpiresAt = Math.floor(Date.now() / 1000) + 600;
  const authorization = { auth, credentials: { current: async () => ({ requestId: 'synthetic-runner-request', audience: 'operator',
    authorization: `Bearer ${auth.signAccessToken({ sub: identity.user.id, tid: identity.user.tenantId, sid: 'session-a', wid: identity.workspace, aud: 'operator', exp: tokenExpiresAt })}` }) },
    subscriptions: new SubscriptionService(h.db) };
  const current = composePersistedTaskAuthorization({ ...authorization, db: h.db, clock: () => new Date(h.control.now) });
  h.control.needsInput = false;
  h.source = {
    resolve: async b => h.control.needsInput && b.registrationRef === 'clarify'
      ? { kind: 'required', contract: structuredClone(contract), inputRef: b.inputRef, inputHash: b.inputHash, expiresAt: '2026-10-06T18:00:00Z' }
      : { kind: 'not_required' },
    validateAnswers: async b => ({ disposition: 'context_only', planHash: b.planHash, inputRef: b.inputRef, inputHash: b.inputHash })
  };
  const configuration = () => ({ ...h.configuration(), authorization, inputSource: h.source,
    registrationAuthority: { resolve: async c => ({ ...await h.registrationAuthority.resolve(c), context: await current.authority.resolve(c.taskId, 'transition_task') }) },
    transitionAuthority: { resolve: async c => ({ ...await h.transitionAuthority.resolve(c), context: await current.authority.resolve(c.taskId, 'transition_task') }) } });
  const compose = () => require('../../../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition').composeAuthorizedPersistentTaskInputRunner(configuration());
  const submit = (root, patch = {}) => root.inputs.submit({ draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: 'task-a',
    requestId: h.state.aiTaskInputRequest[0].id, expectedRevision: 1, submissionKey: 'answer-a',
    answers: [{ fieldId: 'clarification_text', value: 'Explain the existing order only' }], ...patch });
  return { ...h, identity, authorization, configuration, compose, submit, contract };
}
module.exports = { authorizedRunnerHarness };
