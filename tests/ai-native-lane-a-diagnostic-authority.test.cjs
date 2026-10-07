'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiDiagnosticRouteAuthority } = require('../apps/api/src/modules/ai-native/tools/diagnostic-route.authority');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
async function setup() {
  const h = await authorizedRunnerHarness();
  h.identity.user.permissions.push('rental-os:report:view');
  const bridge = new AiBusinessReadRouteAuthority(new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), h.authorization.credentials);
  return { ...h, authority: new AiDiagnosticRouteAuthority(bridge) };
}
const input = { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' };
test('formal diagnostic bridge runs original Guard and ALS for both fixed routes', async () => {
  const h = await setup();
  for (const kind of ['opening', 'risk']) assert.equal(await h.authority.withRead(kind, kind === 'opening' ? { limit: 50 } : input, async c => {
    assert.equal(getRequestIdentity().userId, c.actor.userId);
    assert.equal(c.scope.workspaceId, 'workspace-a');
    return 'read';
  }), 'read');
});
test('missing original report permission rejects before reader', async () => {
  const h = await setup(); h.identity.user.permissions = ['rental-os:order:view'];
  let called = false;
  await assert.rejects(h.authority.withRead('risk', input, async () => { called = true; }));
  assert.equal(called, false);
});
for (const kind of ['opening', 'risk']) test(`${kind} rejects revocation while reader is pending`, async () => {
  const h = await setup();
  await assert.rejects(h.authority.withRead(kind, kind === 'opening' ? { limit: 50 } : input, async () => {
    h.identity.user.permissions = []; return { private: true };
  }));
});
test('opening aggregate remains unavailable for selected locations until a scoped source exists', async () => {
  const h = await setup(); h.identity.user.locationScope = { mode: 'selected', locationIds: ['location-a'] };
  let called = false;
  await assert.rejects(h.authority.withRead('opening', { limit: 50 }, async () => { called = true; }));
  assert.equal(called, false);
});
test('opening does not authorize workspace aggregate for own-only identities', async () => {
  const h = await setup(); h.identity.user.dataScope = 'own';
  await assert.rejects(h.authority.withRead('opening', { limit: 50 }, async () => true));
});
test('scope switching during risk read rejects late data', async () => {
  const h = await setup();
  await assert.rejects(h.authority.withRead('risk', input, async () => { h.identity.workspace = 'workspace-b'; return true; }));
});
test('unknown diagnostic and caller identity fields are rejected before consumption', async () => {
  const h = await setup();
  await assert.rejects(h.authority.withRead('sql', input, async () => true));
  await assert.rejects(h.authority.withRead('risk', { ...input, tenantId: 'tenant-b' }, async () => true));
});
