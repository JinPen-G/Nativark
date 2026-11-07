const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { Prisma } = require('@prisma/client');

test('order summary uses the exact same scoped filters as the total and covers more than the returned page', async () => {
  const filename = path.resolve(__dirname, '../apps/api/src/modules/rental-core/rental-core-fact.repository.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exported = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name.startsWith('node:') || ['@nestjs/common', '@prisma/client', '@rental-os/shared'].includes(name)) return require(name);
    if (name === './workspace-scope') return { resolveScopeWorkspaceId: async () => 'workspace-a' };
    if (name === './rental-order-list-sort') return { rentalOrderListSort: () => Prisma.sql`o.\`createdAt\` DESC` };
    if (name === '../../common/request-identity') return { getRequestDataScope: () => 'own', getRequestUserId: () => 'operator-a', getRequestLocationIds: () => ['location-a'] };
    return {};
  }, exported, exported.exports);
  const statements = [];
  const repository = new exported.exports.RentalCoreFactRepository({
    $queryRaw: async query => {
      statements.push(query);
      if (query.sql.includes('GROUP BY o.`status`')) return [{ status: 'reserved', count: 2n, pendingFeeCount: 1n }, { status: 'completed', count: 3n, pendingFeeCount: 0n }];
      if (query.sql.includes('COUNT(*)')) return [{ total: 5n }];
      return [{ id: 'visible-order' }];
    },
    rentalOrder: { findMany: async query => { assert.equal(query.where.tenantId, 'tenant-a'); assert.equal(query.where.workspaceId, 'workspace-a'); return [{ id: 'visible-order' }]; } }
  });
  repository.toDomainOrder = row => row;
  const result = await repository.queryOrders('tenant-a', { keyword: 'a%_', pendingFeeOnly: true, skip: 20, take: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.total, 5);
  assert.deepEqual(result.summary, { statusBreakdown: [{ status: 'reserved', count: 2 }, { status: 'completed', count: 3 }], pendingFeeCount: 1 });
  const total = statements.find(query => query.sql.includes('COUNT(*)') && !query.sql.includes('GROUP BY'));
  const summary = statements.find(query => query.sql.includes('GROUP BY'));
  assert.deepEqual(summary.values, total.values);
  assert.ok(summary.values.includes('tenant-a') && summary.values.includes('workspace-a') && summary.values.includes('operator-a') && summary.values.includes('location-a'));
  assert.ok(summary.values.includes('%a\\%\\_%'));
  assert.doesNotMatch(summary.sql, /LIMIT|OFFSET/);
});
