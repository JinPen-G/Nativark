'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
// Characterization only, NOT a bounded-query safety acceptance test. Mainline
// owns the underlying service; no duplicate membership scope algorithm here.
for (const dataScope of ['all', 'own']) test(`KNOWN GAP: ${dataScope} member lookup has no database row bound`, async () => {
  const queries = [];
  const members = new MembershipService({ customerProfile: { findMany: async q => { queries.push(['customer', q]); return []; } },
    rentalOrder: { findMany: async q => { queries.push(['orders', q]); return []; } } }, {});
  await runWithRequestIdentity({ tenantId: 'tenant-a', userId: 'operator-a', workspaceId: 'workspace-a', isSaasAdmin: false,
    dataScope, locationScope: { mode: 'all', locationIds: [] } }, () => members.listPersonalOptions('tenant-a'));
  assert.equal(queries.at(-1)[0], 'customer');
  assert.equal(queries.at(-1)[1].take, undefined);
  assert.equal(queries.at(-1)[1].where.tenantId, 'tenant-a');
  if (dataScope === 'own') {
    assert.equal(queries[0][0], 'orders'); assert.equal(queries[0][1].take, undefined);
    assert.equal(queries[0][1].where.workspaceId, 'workspace-a');
    assert.deepEqual(queries[0][1].distinct, ['customerId']);
  }
});
