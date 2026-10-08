'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true } });
const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const { AiMembershipCandidateReadFactsService } = require('../apps/api/src/modules/ai-native/membership-candidate-read-facts.service');
const identity = { tenantId: 't', workspaceId: 'w', userId: 'u', dataScope: 'own', isSaasAdmin: false };
test('paged candidates bound scope expansion and fail closed instead of silently truncating visibility', async () => {
  let customerReads = 0;
  const service = new MembershipService({ rentalOrder: { findMany: async q => {
    assert.equal(q.take, 201);
    assert.equal(q.where.tenantId, 't'); assert.equal(q.where.workspaceId, 'w');
    return Array.from({ length: 201 }, (_, i) => ({ customerId: `c${i}` }));
  } }, customerProfile: { findMany: async () => { customerReads++; return []; } } }, {});
  await assert.rejects(() => runWithRequestIdentity(identity, () => service.listPersonalOptionsPage('t', { limit: 5 })), /范围过大/);
  assert.equal(customerReads, 0);
});
test('invalid page limits are rejected before any database access', async () => {
  let reads = 0;
  const service = new MembershipService({ customerProfile: { findMany: async () => { reads++; return []; } } }, {});
  for (const limit of [0, 51, -1, NaN, 1.5]) await assert.rejects(() => service.listPersonalOptionsPage('t', { limit }));
  assert.equal(reads, 0);
});
test('truncated flag cannot bypass the candidate projection maximum', async () => {
  const context = { audience: 'operator', actor: { kind: 'user', userId: 'u' }, scope: { kind: 'workspace', tenantId: 't', workspaceId: 'w' }, access: { permissions: ['rental-os:order:create'] } };
  const row = { customerId: 'c', name: 'Synthetic', phoneMasked: '', membershipStatus: 'active' };
  const service = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async () => [], listPersonalOptionsPage: async () => ({ rows: [row, { ...row, customerId: 'c2' }], truncated: true }) }, { withRead: async (_k, _i, read) => read(context) });
  await assert.rejects(() => service.read({ limit: 1 }), e => e.code === 'INVALID_RESPONSE');
});
test('exact candidate lookup preserves scope and limits both database reads', async () => {
  const queries = [];
  const service = new MembershipService({ rentalOrder: { findMany: async q => { queries.push(q); return [{ customerId: 'selected' }]; } },
    customerProfile: { findMany: async q => { queries.push(q); return [{ id: 'selected', name: 'Synthetic', phoneMasked: '', membership: { status: 'active' } }]; } } }, {});
  const page = await runWithRequestIdentity(identity, () => service.listPersonalOptionsPage('t', { limit: 1, customerId: 'selected' }));
  assert.equal(queries[0].where.customerId, 'selected'); assert.equal(queries[0].take, 201);
  assert.equal(queries[1].where.id, 'selected'); assert.equal(queries[1].take, 2);
  assert.deepEqual(queries[1].where.AND, [{ OR: [{ id: { in: ['selected'] } }, { createdInWorkspaceId: 'w', createdByUserId: 'u' }] }]);
  assert.equal(page.rows[0].customerId, 'selected'); assert.equal(page.truncated, false);
});
test('projection forwards bounded search and pagination without silently falling back', async () => {
  const context = { audience: 'operator', actor: { kind: 'user', userId: 'u' }, scope: { kind: 'workspace', tenantId: 't', workspaceId: 'w' }, access: { permissions: ['rental-os:order:create'] } };
  const authority = { withRead: async (_k, _i, read) => read(context) };
  const query = { limit: 1, name: 'Synthetic', cursor: 'c0' };
  const row = { customerId: 'c1', name: 'Synthetic', phoneMasked: '', membershipStatus: 'active' };
  const service = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async () => { throw Error('legacy must not run'); },
    listPersonalOptionsPage: async (tenant, input) => { assert.equal(tenant, 't'); assert.deepEqual(input, query); return { rows: [row], truncated: true, nextCursor: 'c1' }; } }, authority);
  const result = await service.read(query); assert.equal(result.nextCursor, 'c1'); assert.equal(result.truncated, true);
  const legacy = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async () => { throw Error('must not run'); } }, authority);
  await assert.rejects(() => legacy.read(query), e => e.code === 'CAPABILITY_UNSUPPORTED');
});
