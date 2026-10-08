'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { PrismaBudgetRepository } = require('../apps/api/src/modules/ai-native/budget/prisma-budget.repository');
const { PersistedBudgetEvidenceAdapter, ServerBudgetAuthorityAdapter, SubscriptionBudgetEntitlementAdapter } = require('../apps/api/src/modules/ai-native/budget/budget-dependency-adapters');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const clone = structuredClone;
const config = { configId: 'profile-1', configRevision: 3, credentialRef: 'vault-1', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model-1', tenantId: 'tenant-1', serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: 'tenant-1' } };
const association = { requestId: 'request-1', runId: 'run-1', stepId: 'step-1', actionId: 'action-1', idempotencyKey: 'call-1', priceVersion: 'price-1', scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'workspace-1' }, config };
const now = new Date('2026-10-05T12:00:00Z');
const context = { contractVersion: 'ain-c01-c02-draft-1', requestId: 'auth-1', authorizedAt: now.toISOString(), audience: 'operator', actor: { kind: 'user', userId: 'actor-1' }, scope: association.scope, access: { permissions: ['ai:use'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
function stored() {
  return { id: 'budget-1', tenantId: 'tenant-1', workspaceId: 'workspace-1', scopeId: 'scope-1', scopeKind: 'WORKSPACE', actorId: 'actor-1', sceneCode: 'rental.order.explain', requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, callId: 'call-1', idempotencyKey: 'call-1', priceVersion: 'price-1', configRevision: 3, configurationHash: requestFingerprint(config), status: 'reserved', dispatchState: 'dispatched', unitKind: 'tokens', reservedTokens: 20n, reservedCalls: null, reservedMoney: null, moneyCurrency: null, actualTokens: null, actualCalls: null, actualMoney: null, unknownReason: null, expiresAt: new Date(now.getTime() + 60_000), updatedAt: now };
}
function repository(row) { return new PrismaBudgetRepository({ aiBudgetReservation: { findUnique: async () => clone(row) } }); }
for (const [field, value] of Object.entries({ configId: 'profile-2', credentialRef: 'vault-2', model: 'model-2', provider: 'other', protocol: 'other-protocol', serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } })) {
  test(`persisted reservation refuses substituted configuration ${field} at the same revision`, async () => {
    const input = clone(association); input.config[field] = value;
    assert.equal(await repository(stored()).get('budget-1', input), null);
  });
}
test('persisted reservation without a historical configuration binding cannot inherit caller configuration', async () => {
  assert.equal(await repository({ ...stored(), configurationHash: null }).get('budget-1', association), null);
});
test('bound configuration round-trips regardless of object property order', async () => {
  const input = clone(association); input.config = Object.fromEntries(Object.entries(input.config).reverse());
  assert.deepEqual((await repository(stored()).get('budget-1', input)).association, input);
});
function record() {
  return { id: 'budget-1', scopeId: 'scope-1', scopeKind: 'WORKSPACE', actorId: 'actor-1', revision: 3, storageVersion: now, association: clone(association), callId: 'call-1', sceneCode: 'rental.order.explain', status: 'reserved', reserved: { unit: 'tokens', value: 20 }, actual: null, dispatched: true, unknownReason: null, expiresAt: new Date(now.getTime() + 60_000) };
}
test('unbound configuration is rejected before any budget mutation', async () => {
  const row = stored(), input = record(); input.association.config.configId = 'other';
  let writes = 0;
  const tx = { aiBudgetReservation: { findUnique: async () => row, updateMany: async () => { writes++; return { count: 1 }; } }, aiBudgetLedgerEntry: { findUnique: async () => null, create: async () => { writes++; } } };
  const repo = new PrismaBudgetRepository({ $transaction: async operation => operation(tx) });
  await assert.rejects(repo.mutate(input, { action: 'unknown', eventKey: 'unknown-1', reason: 'timeout' }, async () => {}));
  assert.equal(writes, 0);
});
function evidence(extra = {}) {
  return { reservationId: 'budget-1', requestId: 'request-1', runId: 'run-1', stepId: 'step-1', actionId: 'action-1', callId: 'call-1', actorId: 'actor-1', scopeKey: 'WORKSPACE:scope-1', sceneCode: 'rental.order.explain', configRevision: 3, configurationHash: requestFingerprint(config), priceVersion: 'price-1', dispatchToken: 'dispatch-1', ...extra };
}
const usage = extra => evidence({ quantity: { unit: 'tokens', value: 4 }, inputTokens: 1, outputTokens: 3, evidenceHash: 'a'.repeat(64), ...extra });
for (const [name, changes] of Object.entries({ missing_token: { dispatchToken: '' }, different_token: { dispatchToken: 'dispatch-2' }, different_configuration: { configurationHash: 'b'.repeat(64) }, missing_configuration: { configurationHash: undefined } })) {
  test(`usage evidence rejects ${name}`, async () => {
    const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => evidence({ state: 'dispatched' }), readUsage: async () => usage(changes) });
    await assert.rejects(adapter.usage(record(), 'usage-1', false));
  });
}
test('dispatch evidence rejects unknown enum instead of permitting settlement', async () => {
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => evidence({ state: 'complete-ish' }), readUsage: async () => usage() });
  await assert.rejects(adapter.dispatch(record()));
});
test('dispatch evidence rejects a different scene on the same reservation binding', async () => {
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => evidence({ state: 'dispatched', sceneCode: 'rental.order.quote' }), readUsage: async () => usage() });
  await assert.rejects(adapter.dispatch(record()));
});
test('usage evidence is rechecked against the dispatch owner after asynchronous read', async () => {
  let token = 'dispatch-1';
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => evidence({ state: 'dispatched', dispatchToken: token }), readUsage: async () => { token = 'dispatch-2'; return usage(); } });
  await assert.rejects(adapter.usage(record(), 'usage-1', false));
});
test('usage verification snapshots caller record before awaiting persistence', async () => {
  const current = record();
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => evidence({ state: 'dispatched' }), readUsage: async () => { current.actorId = 'actor-2'; return usage({ actorId: 'actor-2' }); } });
  await assert.rejects(adapter.usage(current, 'usage-1', false));
});
test('verified usage projects quantity only, not private source fields', async () => {
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => evidence({ state: 'dispatched' }), readUsage: async () => usage({ privateMetadata: 'not-public' }) });
  assert.deepEqual(await adapter.usage(record(), 'usage-1', false), { quantity: { unit: 'tokens', value: 4 }, inputTokens: 1, outputTokens: 3, evidenceHash: 'a'.repeat(64) });
});
test('usage cannot be accepted with proof of not-dispatched', async () => {
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => evidence({ state: 'not_dispatched', dispatchToken: null }), readUsage: async () => usage() });
  await assert.rejects(adapter.usage(record(), 'usage-1', true));
});
function authority(entitlements, changedContext) {
  const grant = { authorizationKey: 'action-grant', expiresAt: new Date(now.getTime() + 60_000) };
  return new ServerBudgetAuthorityAdapter({ resolveContext: async () => clone(changedContext?.() ?? context), authorize: async () => clone(grant) }, entitlements);
}
test('entitlement truthiness cannot grant budget access', async () => {
  await assert.rejects(authority({ check: async () => ({ available: 'true', revision: 1 }) }).resolve('reserve', { association }));
});
test('entitlement revision forms part of the session authorization binding', async () => {
  let revision = 1;
  const adapter = authority({ check: async () => ({ available: true, revision }) });
  const before = await adapter.resolve('reserve', { association }); revision = 2;
  const after = await adapter.resolve('reserve', { association });
  assert.notEqual(before.authorizationKey, after.authorizationKey);
});
test('context revocation during entitlement resolution is rejected', async () => {
  let current = clone(context);
  const adapter = authority({ check: async () => { current.actor.userId = 'revoked-actor'; return { available: true, revision: 1 }; } }, () => current);
  await assert.rejects(adapter.resolve('reserve', { association }));
});
test('conflicting duplicate entitlement rows cannot be resolved by choosing the first', async () => {
  const adapter = new SubscriptionBudgetEntitlementAdapter({ read: async () => ({ revision: 1, entitlements: [{ code: 'ai.native.use', available: true }, { code: 'ai.native.use', available: false }] }) });
  await assert.rejects(adapter.check(context, 'ai.native.use'));
});
