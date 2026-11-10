'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { persistedApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-persisted.cjs');
const { composeAiApprovedOrder } = require('../apps/api/src/modules/ai-native/approval-execution/approved-order.composition');
const denied = e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_REVISION_CONFLICT', 'AI_STORAGE_UNAVAILABLE'].includes(e.code);
const reference = h => { const { lease, ...r } = h.command; return r; };

test('persisted policy uses real Auth, stored read_metadata and execution entitlement before Core submission', async () => {
  const h = await persistedApprovedOrderHarness(); h.dependencies.policy = h.policy();
  const root = composeAiApprovedOrder(h.dependencies);
  assert.equal((await root.submit(h.command)).replayed, false);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.ok(h.state.trace.some(s => s.includes('aiTaskActionPolicy.findUnique')));
  assert.ok(h.state.trace.some(s => s.includes('subscriptionFeatureCatalog.findMany')));
  assert.equal((await root.submit(h.command)).replayed, true);
  assert.equal(h.state.prepares, 1);
});
for (const [name, mutate] of Object.entries({
  'missing policy': s => { s.records.aiTaskActionPolicy = []; },
  'missing subscription feature': s => { s.records.subscriptionFeatureCatalog = []; },
  'platform disabled': s => { s.records.aiBudgetPolicy[0].enabled = false; },
  'tenant disabled': s => { s.records.aiBudgetPolicy[1].enabled = false; },
  'scene disabled': s => { s.records.aiBudgetPolicy[2].enabled = false; },
  'session revoked': s => { s.session = false; },
  'membership revoked': s => { s.member = false; },
  'scope changed': s => { s.workspace = 'workspace-b'; },
  'owner changed': s => { s.records.aiTask[0].ownerId = 'other'; },
  'audience changed': s => { s.records.aiTask[0].audience = 'STAFF'; },
  'cancelled task': s => { s.records.aiTask[0].cancelRequestedAt = new Date(); }
})) test(`formal policy denies ${name} before any Core effect`, async () => {
  const h = await persistedApprovedOrderHarness(); h.dependencies.policy = h.policy(); mutate(h.state);
  await assert.rejects(composeAiApprovedOrder(h.dependencies).submit(h.command), denied);
  assert.equal(h.state.prepares, 0);
});
test('foreign current workspace is access-denied while an own task with absent policy stays unavailable', async () => {
  const own = await persistedApprovedOrderHarness(); own.state.records.aiTaskActionPolicy = [];
  await assert.rejects(own.policy().authorizeRead('task-a'), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  const h = await persistedApprovedOrderHarness();
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  h.state.records.aiScope.push({ id: 'scope-other', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-b' }) });
  h.state.workspace = 'workspace-b';
  const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
  const current = await composePersistedTaskAuthorization(h.policyDependencies).scopes.resolveCurrent();
  assert.equal(current.context.scope.workspaceId, 'workspace-b'); assert.equal(current.scope.id, 'scope-other');
  await assert.rejects(h.policy().authorizeRead('task-a'), error => error.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.prepares, 0); assert.equal(h.state.records.rentalOrder.length, 0);
});

test('history remains readable with current read policy after cancellation, AI expiry and lost create permission', async () => {
  const h = await persistedApprovedOrderHarness(); h.dependencies.policy = h.policy(); const root = composeAiApprovedOrder(h.dependencies);
  await root.submit(h.command);
  h.state.records.subscriptionFeatureCatalog = []; h.state.records.aiBudgetPolicy = [];
  h.state.records.aiTaskActionPolicy = h.state.records.aiTaskActionPolicy.filter(p => p.operation === 'read_metadata');
  h.state.records.aiTask[0].cancelRequestedAt = new Date(); h.state.user.permissions = ['rental-os:order:view'];
  assert.equal((await root.reconcile(h.command)).replayed, true); assert.equal(h.state.prepares, 1);
  h.state.records.aiTaskActionPolicy = [];
  await assert.rejects(root.reconcile(h.command), denied);
});
for (const [name, change] of Object.entries({
  'tool code': a => { a.toolCode = 'rental.order.read'; },
  'tool version': a => { a.toolVersion = 'other'; },
  'action id': a => { a.actionId = 'other'; },
  'input reference': a => { a.input.recordId = 'other'; },
  'target': a => { a.target.resourceId = 'other'; }
})) test(`formal policy cannot authorize caller-replaced ${name}`, async () => {
  const h = await persistedApprovedOrderHarness(); const action = structuredClone(h.action); change(action);
  await assert.rejects(h.policy().resolve({ ...reference(h), action }, 'execute'), denied);
});
test('formal policy rechecks action binding after external entitlement reads', async () => {
  const h = await persistedApprovedOrderHarness(); let changed = false;
  h.state.onOperation = ({ model, records }) => { if (!changed && model === 'subscriptionFeatureCatalog') {
    changed = true; records.aiProposalAction[0].requestFingerprint = 'f'.repeat(64);
  } };
  await assert.rejects(h.policy().resolve({ ...reference(h), action: h.action }, 'execute'), denied);
  assert.equal(changed, true);
});
test('formal policy hides raw dependency errors and token-shaped cause', async () => {
  const h = await persistedApprovedOrderHarness(); h.policyDependencies.auth = { resolveAccessContext: async () => { throw Error('secret=offline-private-token'); } };
  await assert.rejects(h.policy().resolve(reference(h), 'read'), e => denied(e) && !JSON.stringify(e).includes('offline-private-token') && !e.cause);
});
