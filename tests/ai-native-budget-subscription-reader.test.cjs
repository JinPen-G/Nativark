'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { SubscriptionService } = require('../apps/api/src/modules/subscription/subscription.service');
const { PrismaSubscriptionBudgetReader } = require('../apps/api/src/modules/ai-native/budget/prisma-subscription-budget-reader');
const { createPersistedBudgetSubsystem } = require('../apps/api/src/modules/ai-native/budget/budget.module');
const { SubscriptionBudgetEntitlementAdapter, ServerBudgetAuthorityAdapter } = require('../apps/api/src/modules/ai-native/budget/budget-dependency-adapters');
const now = new Date('2026-10-05T12:00:00Z'), code = 'ai.native.use';
const clone = structuredClone;
const context = { contractVersion: 'ain-c01-c02-draft-1', requestId: 'auth-1', authorizedAt: now.toISOString(), audience: 'operator', actor: { kind: 'user', userId: 'actor-1' }, scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'workspace-1' }, access: { permissions: ['ai:use'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
function fixture() {
  const state = { time: new Date(now), fail: false, afterRead: null, transactions: [], reads: [],
    subscription: { id: 'sub-1', tenantId: 'tenant-1', revision: 4, plan: 'PRO', source: 'HISTORICAL_REGISTER', startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), serviceTimeZone: 'UTC', billingAnniversary: new Date('2026-01-01') },
    segments: [], grants: [], features: [{ code, name: 'AI', module: 'ai-native', categories: [], currentOwnership: 'PRO', defaultOwnership: 'PRO', releaseStatus: 'RELEASED', externalFeeNote: 'private-pricing-note' }] };
  const tx = {
    tenant: { findUnique: async args => { state.reads.push(['tenant', clone(args)]); if (args.where.id !== 'tenant-1') return null; const row = { subscription: clone(state.subscription), subscriptionSegments: clone(state.segments.filter(s => s.status === 'SCHEDULED')) }; state.afterRead?.(); return row; } },
    subscriptionFeatureCatalog: { findMany: async args => { state.reads.push(['features', clone(args)]); return clone(state.features.filter(f => args.where.code.in.includes(f.code))); } },
    tenantFeatureGrant: { findMany: async args => { state.reads.push(['grants', clone(args)]); return clone(state.grants.filter(g => g.tenantId === args.where.tenantId && g.revokedAt === null && g.effectiveAt <= args.where.effectiveAt.lte)); } },
    aiBudgetPolicy: { findUnique: async () => null }
  };
  const db = { ...tx, $transaction: async (operation, options) => { state.transactions.push(options); if (state.fail) throw Error('private database detail'); const result = await operation(tx); return result; } };
  const subscriptions = new SubscriptionService(db);
  const reader = new PrismaSubscriptionBudgetReader(db, subscriptions, () => new Date(state.time));
  const authorization = { resolveContext: async () => clone(context), authorize: async () => ({ authorizationKey: 'grant-1', expiresAt: new Date(now.getTime() + 60_000) }) };
  return { state, db, subscriptions, reader, authorization };
}
test('reader uses actual SubscriptionService catalog rules and only returns the required feature', async () => {
  const h = fixture(); h.state.features.push({ ...h.state.features[0], code: 'other-feature' });
  const before = clone(h.state.subscription);
  assert.deepEqual(await h.reader.read('tenant-1', code), { revision: 4, entitlements: [{ code, available: true }] });
  assert.deepEqual(h.state.subscription, before);
  assert.equal(h.state.transactions[0].isolationLevel, 'Serializable');
  assert.deepEqual(h.state.reads.find(([name]) => name === 'features')[1].where, { code: { in: [code] } });
  assert.equal(h.state.reads.some(([name]) => name === 'prices'), false);
});
test('PRO does not imply an absent or unpublished AI feature is available', async () => {
  const h = fixture(); h.state.features = [];
  await assert.rejects(h.reader.read('tenant-1', code), error => error.code === 'FORBIDDEN');
  h.state.features = [{ code, categories: [], currentOwnership: 'PRO', defaultOwnership: 'PRO', releaseStatus: 'PLANNED' }];
  assert.equal((await h.reader.read('tenant-1', code)).entitlements[0].available, false);
});
test('pilot feature follows actual tenant grants and revocations, never grants from another tenant', async () => {
  const h = fixture(); h.state.features[0].releaseStatus = 'PILOT';
  assert.equal((await h.reader.read('tenant-1', code)).entitlements[0].available, false);
  h.state.grants.push({ tenantId: 'tenant-2', featureCode: code, effectiveAt: now, revokedAt: null });
  assert.equal((await h.reader.read('tenant-1', code)).entitlements[0].available, false);
  h.state.grants.push({ tenantId: 'tenant-1', featureCode: code, effectiveAt: now, revokedAt: null });
  assert.equal((await h.reader.read('tenant-1', code)).entitlements[0].available, true);
  h.state.grants[1].revokedAt = now;
  assert.equal((await h.reader.read('tenant-1', code)).entitlements[0].available, false);
});
for (const [name, update] of Object.entries({ expired: s => s.endAt = now, pending: s => s.startAt = new Date(now.getTime() + 1000) })) test(`actual subscription ${name} does not permit AI usage`, async () => {
  const h = fixture(); update(h.state.subscription);
  assert.equal((await h.reader.read('tenant-1', code)).entitlements[0].available, false);
});
test('unconfigured subscription cannot inherit standard public capability as an AI budget grant', async () => {
  const h = fixture(); h.state.subscription = null; h.state.features[0].currentOwnership = 'STANDARD';
  await assert.rejects(h.reader.read('tenant-1', code), error => error.code === 'FORBIDDEN');
});
test('scheduled term is projected by SubscriptionService without writing the subscription', async () => {
  const h = fixture(); h.state.subscription.endAt = now;
  h.state.segments.push({ id: 'next', tenantId: 'tenant-1', status: 'SCHEDULED', plan: 'PRO', source: 'HISTORICAL_REGISTER', startAt: now, endAt: new Date('2027-10-05'), createdAt: now });
  const before = clone(h.state.subscription);
  assert.deepEqual(await h.reader.read('tenant-1', code), { revision: 5, entitlements: [{ code, available: true }] });
  assert.deepEqual(h.state.subscription, before);
});
test('expiry during asynchronous reads rejects a stale positive entitlement', async () => {
  const h = fixture(); h.state.subscription.endAt = new Date(now.getTime() + 1000);
  h.state.afterRead = () => { h.state.time = new Date(now.getTime() + 1000); };
  await assert.rejects(h.reader.read('tenant-1', code), error => error.code === 'UNAVAILABLE');
});
test('crossing a scheduled boundary also rejects a stale entitlement even before current expiry', async () => {
  const h = fixture(); h.state.segments.push({ id: 'next', status: 'SCHEDULED', plan: 'STANDARD', startAt: new Date(now.getTime() + 1000), endAt: new Date('2028-01-01'), createdAt: now });
  h.state.afterRead = () => { h.state.time = new Date(now.getTime() + 1000); };
  await assert.rejects(h.reader.read('tenant-1', code), error => error.code === 'UNAVAILABLE');
});
test('category-limited features are not silently promoted to global AI entitlements', async () => {
  const h = fixture(); h.state.features[0].categories = ['camera'];
  await assert.rejects(h.reader.read('tenant-1', code), error => error.code === 'UNAVAILABLE');
});
test('reader and persisted composition preserve database errors and missing dependencies as unavailable', async () => {
  const h = fixture(); h.state.fail = true;
  await assert.rejects(h.reader.read('tenant-1', code), error => error.code === 'UNAVAILABLE' && !error.message.includes('private'));
  assert.throws(() => createPersistedBudgetSubsystem({ db: h.db, subscriptions: h.subscriptions, authorization: h.authorization }), error => error.code === 'UNAVAILABLE');
});
test('real entitlement source feeds BudgetService action-specific authorization in the persisted composition', async () => {
  const h = fixture();
  const service = createPersistedBudgetSubsystem({ db: h.db, subscriptions: h.subscriptions, authorization: h.authorization,
    quotes: { quote: async () => { throw Error('no quote needed'); } }, evidence: { dispatch: async () => { throw Error('no dispatch needed'); }, usage: async () => { throw Error('no usage needed'); } }, clock: () => new Date(h.state.time) });
  assert.equal(await service.settings({ scopeId: 'scope-1', scopeKind: 'WORKSPACE', sceneCode: 'rental.order.explain' }), null);
  h.state.features = [];
  await assert.rejects(service.settings({ scopeId: 'scope-1', scopeKind: 'WORKSPACE', sceneCode: 'rental.order.explain' }), error => error.code === 'FORBIDDEN');
});
test('formal subscription revision changes invalidate the budget authorization binding', async () => {
  const h = fixture();
  const authority = new ServerBudgetAuthorityAdapter(h.authorization, new SubscriptionBudgetEntitlementAdapter(h.reader));
  const before = await authority.resolve('reserve', {}); h.state.subscription.revision++;
  const after = await authority.resolve('reserve', {});
  assert.notEqual(before.authorizationKey, after.authorizationKey);
});
