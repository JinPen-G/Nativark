'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { ProviderRouterService } = require('../apps/api/src/modules/ai-native/provider-router.service');
const { InvocationAdmissionService } = require('../apps/api/src/modules/ai-native/invocation-admission.service');

const platform = { id: 'matrix-platform', kind: 'PLATFORM' }, tenant = { id: 'matrix-tenant', kind: 'TENANT' }, other = { id: 'matrix-other', kind: 'TENANT' };
const profile = (scope, mode, key = 'default') => ({ id: `${scope.id}-${key}`, scopeId: scope.id, scopeKind: scope.kind, profileKey: key, role: 'DEFAULT', serviceMode: mode, protocol: 'openai_chat_completions', provider: 'synthetic', model: key, credentialRef: `vault:${key}`, configRevision: 1, enabled: true, allowedCapabilities: ['text'], disabledAt: null });
const route = (records) => new ProviderRouterService({ profiles: { list: async scope => records.filter(row => row.scopeId === scope.id && row.scopeKind === scope.kind), get: async () => null, create: async () => { throw new Error('unused'); }, update: async () => null }, capabilities: { preflight: async (row, required) => ({ allowed: required.every(capability => row.allowedCapabilities.includes(capability)), required, missing: required.filter(capability => !row.allowedCapabilities.includes(capability)), stale: [] }) } });

test('mode and scope matrix has no cross-scope fallback', async () => {
  const service = route([profile(platform, 'platform_managed'), profile(tenant, 'tenant_managed'), profile(other, 'tenant_managed')]);
  const platformResult = await service.resolve({ consumerScope: tenant, platformScope: platform, mode: 'platform_managed', scene: 'chat', requiredCapabilities: ['text'] });
  assert.equal(platformResult.profile.scopeId, platform.id);
  const tenantResult = await service.resolve({ consumerScope: tenant, platformScope: platform, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: ['text'] });
  assert.equal(tenantResult.profile.scopeId, tenant.id);
  await assert.rejects(route([profile(other, 'tenant_managed')]).resolve({ consumerScope: tenant, platformScope: platform, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: ['text'] }), e => e.code === 'PROVIDER_UNAVAILABLE');
});

test('unknown admission cannot be reused as an admitted or safe retry', async () => {
  const rows = new Map(), scope = { id: 'matrix-tenant:matrix-space', kind: 'WORKSPACE', tenantId: 'matrix-tenant', workspaceId: 'matrix-space' };
  const repository = { get: async (s, callId) => rows.get(`${s.tenantId}:${s.workspaceId}:${callId}`) ?? null, create: async input => { const key = `${input.scope.tenantId}:${input.scope.workspaceId}:${input.callId}`; const row = { id: 'admission-matrix', ...input, status: 'admitted' }; rows.set(key, row); return row; }, transition: async (s, callId, from, to) => { const row = rows.get(`${s.tenantId}:${s.workspaceId}:${callId}`); if (!row || row.status !== from) return null; row.status = to; return row; } };
  const service = new InvocationAdmissionService(repository), input = { scope, actorId: 'actor', callId: 'call', requestHash: 'hash', expiresAt: new Date(Date.now() + 60_000) };
  await service.admit(input); await service.transition(scope, 'call', 'admitted', 'unknown', { unknownReason: 'transport_lost' });
  await assert.rejects(service.admit(input), e => e.code === 'ACCOUNTING_PENDING');
  await assert.rejects(service.transition(scope, 'call', 'unknown', 'admitted'), e => e.code === 'ACCOUNTING_PENDING');
});
