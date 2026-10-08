'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { AiApprovedOrderRouteAuthority } = require('../apps/api/src/modules/ai-native/approval-execution/approved-order-route.authority');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { getRequestIdentity, runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const { AI_CONTRACT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
function setup(audience = 'operator') {
  const state = { user: user({ permissions: ['rental-os:order:create'] }), session: true, member: true, workspace: 'workspace-a' };
  const auth = new AuthService({ getAuthSession: async () => state.session ? { id: 'session-a', userId: state.user.id, audience, currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.member ? state.user : undefined, listUserWorkspaces: async () => [] },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-approved-route-secret' : undefined });
  const credentials = { current: async () => ({ requestId: 'approved-request', audience, authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', aud: audience, exp: Math.floor(Date.now() / 1000) + 600 })}` }) };
  const request = { quoteId: 'quote-a', customerType: 'personal', customerId: 'customer-a', customerName: 'Synthetic customer',
    fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'location-a', startAt: '2026-10-06T10:00:00Z', endAt: '2026-10-07T10:00:00Z', lines: [{ itemGroupId: 'item-a', quantity: 1 }] };
  const context = { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: 'request-a', authorizedAt: new Date().toISOString(), audience,
    actor: { kind: 'user', userId: 'operator-a' }, scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    access: { permissions: ['rental-os:order:create'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
  const fingerprint = requestFingerprint({ ...request, capabilityExceptions: undefined });
  const input = { context, scopeId: 'scope-a', taskId: 'task-a', actionId: 'action-a', approvalId: 'approval-a', proposalId: 'proposal-a', proposalRevision: 1,
    actionFingerprint: fingerprint, businessIdempotencyKey: 'key-a', lease: { runId: 'run-a', holderId: 'worker-a', revision: 1, fencingToken: '1' } };
  const binding = { tenantId: 'tenant-a', workspaceId: 'workspace-a', idempotencyKey: 'key-a', requestFingerprint: fingerprint, request };
  return { state, input, binding, authority: new AiApprovedOrderRouteAuthority(new ApiAuthGuard(auth, undefined, undefined, undefined, {}), credentials) };
}
for (const audience of ['operator', 'staff']) test(`real AuthService/Guard binds ${audience} write to isolated ALS and validates the real DTO`, async () => {
  const h = setup(audience); let calls = 0;
  await runWithRequestIdentity({ userId: 'parent', tenantId: 'parent', isSaasAdmin: true }, async () => {
    const parent = structuredClone(getRequestIdentity());
    const result = await h.authority.withOrderWrite(h.input, h.binding, async (context, body, name) => {
      calls++; assert.equal(getRequestIdentity().workspaceId, 'workspace-a'); assert.equal(getRequestIdentity().staffApi, audience === 'staff');
      assert.equal(context.actor.userId, 'operator-a'); assert.deepEqual(body, h.binding.request); assert.equal(name, 'Synthetic operator'); return 'request-committed';
    });
    assert.equal(result, 'request-committed'); assert.deepEqual(getRequestIdentity(), parent);
  });
  assert.equal(calls, 1);
});
for (const [name, mutate] of [['session', s => { s.session = false; }], ['membership', s => { s.member = false; }],
  ['permission', s => { s.user.permissions = []; }], ['workspace', s => { s.workspace = 'workspace-b'; }]]) {
  test(`current ${name} revocation refuses before approved callback`, async () => {
    const h = setup(); mutate(h.state); let writes = 0;
    await assert.rejects(h.authority.withOrderWrite(h.input, h.binding, async () => { writes++; }), e => e.code === 'AI_ACCESS_DENIED'); assert.equal(writes, 0);
  });
  test(`late ${name} revocation suppresses output but never repeats a committed callback`, async () => {
    const h = setup(); let writes = 0;
    await assert.rejects(h.authority.withOrderWrite(h.input, h.binding, async () => { writes++; mutate(h.state); return { committed: true }; }), e => e.code === 'AI_ACCESS_DENIED'); assert.equal(writes, 1);
  });
}
test('forged binding, actor, audience, fingerprint and extra DTO fields cannot authorize', async () => {
  for (const mutate of [h => { h.binding.workspaceId = 'other'; }, h => { h.input.context.actor.userId = 'other'; }, h => { h.input.context.audience = 'staff'; },
    h => { h.binding.requestFingerprint = 'a'.repeat(64); }, h => { h.binding.request.operatorToken = 'synthetic-forged'; }, h => { h.binding.request.lines[0].quantity = 'wrong-type'; }]) {
    const h = setup(); mutate(h); let calls = 0;
    await assert.rejects(h.authority.withOrderWrite(h.input, h.binding, async () => { calls++; }), e => e.code === 'AI_ACCESS_DENIED'); assert.equal(calls, 0);
  }
});
test('risk exceptions are unavailable rather than bypassing Controller-owned confirmation', async () => {
  const h = setup(); h.binding.request.capabilityExceptions = [{ capabilityCode: 'synthetic', reason: 'Synthetic', confirmedBy: 'forged' }];
  await assert.rejects(h.authority.resolve(h.input, h.binding, 'execute'), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
});
test('own and empty selected scope remain current Guard restrictions, not caller escalation', async () => {
  const h = setup(); h.state.user.dataScope = 'own'; h.state.user.locationScope = { mode: 'selected', locationIds: [] };
  await assert.rejects(h.authority.withOrderWrite(h.input, h.binding, async () => assert.fail('not authorized')), e => e.code === 'AI_ACCESS_DENIED');
});

test('callback failure stays uncertain without exposing internal error details', async () => {
  const h = setup(); let attempts = 0;
  await assert.rejects(h.authority.withOrderWrite(h.input, h.binding, async () => {
    attempts++; throw new Error('private-callback-detail');
  }), error => error.code === 'AI_RESULT_UNKNOWN' && error.nextAction === 'reconcile'
    && !String(error.stack).includes('private-callback-detail'));
  assert.equal(attempts, 1);
});
