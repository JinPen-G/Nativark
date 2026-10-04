'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiMembershipCandidateReadFactsService } = require('../apps/api/src/modules/ai-native/membership-candidate-read-facts.service');
const context = { contractVersion: 'ain-c03-draft-1', requestId: 'req-members', authorizedAt: '2026-10-05T00:00:00.000Z', audience: 'staff', actor: { kind: 'user', userId: 'staff-a' }, scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }, access: { permissions: ['rental-os:order:create'], dataScope: 'all', locationScope: { mode: 'all' } } };
const authority = value => ({ withRead: async (_kind, _input, read) => read(typeof value === 'function' ? value() : value) });
const row = { customerId: 'customer-a', name: 'Customer A', phoneMasked: '138****0000', membershipStatus: 'active' };

test('membership candidate projection delegates to the existing membership read and never selects a customer', async () => {
  const calls = [];
  const service = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async tenantId => { calls.push(tenantId); return [row]; } }, authority(context), () => new Date('2026-10-05T00:01:00.000Z'));
  const result = await service.read({ limit: 10 });
  assert.deepEqual(result.candidates, [row]); assert.deepEqual(calls, ['tenant-a']);
  assert.equal(Object.hasOwn(result, 'selectedCustomerId'), false);
});

test('membership candidate projection requires the existing create-order permission', async () => {
  const service = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async () => { throw new Error('must not reach membership'); } }, authority({ ...context, access: { ...context.access, permissions: [] } }));
  await assert.rejects(() => service.read({ limit: 10 }), error => error.code === 'FORBIDDEN');
});

test('membership candidate projection rejects an unbounded or malformed membership response', async () => {
  const tooMany = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async () => [row, { ...row, customerId: 'customer-b' }] }, authority(context));
  await assert.rejects(() => tooMany.read({ limit: 1 }), error => error.code === 'INVALID_RESPONSE');
  const malformed = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async () => [{ ...row, membershipStatus: 'unknown' }] }, authority(context));
  await assert.rejects(() => malformed.read({ limit: 10 }), error => error.code === 'INVALID_RESPONSE');
});
