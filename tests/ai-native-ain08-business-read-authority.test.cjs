'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { enterRequestIdentity } = require('../apps/api/src/common/request-identity');

test('business read authority builds a server-selected route and passes only its verified context', async () => {
  const requests = [];
  const authority = new AiBusinessReadRouteAuthority({ canActivate: async execution => {
    const request = execution.switchToHttp().getRequest(); requests.push(request);
    request.user = { id: 'operator-a', tenantId: 'tenant-a', isActive: true, isSaasAdmin: false, permissions: ['rental-os:order:create'] };
    enterRequestIdentity({ tenantId: 'tenant-a', userId: 'operator-a', workspaceId: 'workspace-a', isSaasAdmin: false, dataScope: 'all', locationScope: { mode: 'all', locationIds: [] }, staffApi: false });
    return true;
  } }, { current: async () => ({ authorization: 'Bearer synthetic', requestId: 'request-a', audience: 'operator' }) });
  const result = await authority.withRead('availability', { locationId: 'attacker-location' }, async context => {
    assert.equal(context.scope.kind, 'workspace');
    assert.equal(context.scope.tenantId, 'tenant-a');
    assert.equal(context.scope.workspaceId, 'workspace-a');
    return { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId };
  });
  assert.deepEqual(result, { tenantId: 'tenant-a', workspaceId: 'workspace-a' });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(request => request.url), ['/api/rental/v1/availability', '/api/rental/v1/availability']);
  assert.deepEqual(requests[0].body, { locationId: 'attacker-location' });
});

test('business read authority rejects a credential that is not an operator or staff session', async () => {
  let calls = 0;
  const authority = new AiBusinessReadRouteAuthority({ canActivate: async () => { calls++; return true; } }, { current: async () => ({ authorization: 'Bearer synthetic', requestId: 'request-a', audience: 'client' }) });
  await assert.rejects(() => authority.withRead('catalog', { limit: 1 }, async () => undefined), error => error.code === 'FORBIDDEN');
  assert.equal(calls, 0);
});
