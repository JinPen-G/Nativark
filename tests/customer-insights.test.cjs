const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { Prisma } = require('@prisma/client');
const filename = path.resolve(__dirname, '../apps/api/src/modules/platform/customer-insights.ts');
const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
const { readCustomerInsights } = loaded.exports;

test('customer insights reuse the authorized predicate in every read and keep currencies separate', async () => {
  const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a', OR: [{ customerId: 'customer-a' }, { payerSubjectCustomerId: 'customer-a' }] };
  const groups = [
    { status: 'COMPLETED', currency: 'CNY', _count: { _all: 2 }, _sum: { finalPayableAmount: new Prisma.Decimal('0.1') } },
    { status: 'RENTING', currency: 'CNY', _count: { _all: 1 }, _sum: { finalPayableAmount: new Prisma.Decimal('0.2') } },
    { status: 'COMPLETED', currency: 'USD', _count: { _all: 1 }, _sum: { finalPayableAmount: new Prisma.Decimal('25') } },
    { status: 'CANCELLED', currency: 'CNY', _count: { _all: 1 }, _sum: { finalPayableAmount: new Prisma.Decimal('999') } }
  ];
  let reads = 0;
  const prisma = { rentalOrder: {
    groupBy: async query => {
      reads++;
      const where = query.where.AND[0].AND ? query.where.AND[0] : query.where;
      assert.equal(where.AND[0], scope);
      assert.deepEqual(where.AND[1], { status: { not: 'DRAFT' } });
      return query.where.AND[0].AND ? groups.slice(0, 1) : groups;
    },
    findFirst: async query => { assert.equal(query.where.AND[0], scope); return { createdAt: new Date('2026-11-03T10:00:00Z') }; }
  } };
  const result = await readCustomerInsights(prisma, scope, new Date('2026-11-08T10:00:00Z'));
  assert.equal(result.totalOrders, 5);
  assert.equal(result.completedOrders, 3);
  assert.equal(result.activeOrders, 1);
  assert.deepEqual(result.amounts, [{ currency: 'CNY', payableAmount: 0.3, orders: 3 }, { currency: 'USD', payableAmount: 25, orders: 1 }]);
  assert.equal(result.months.length, 12);
  assert.equal(result.months[0].month, '2025-12');
  assert.equal(result.months[11].month, '2026-11');
  assert.equal(result.timeZone, 'UTC');
  assert.equal(reads, 13);
});

test('empty history is a real zero and missing monetary aggregates are never filled with zero', async () => {
  const empty = { rentalOrder: { groupBy: async () => [], findFirst: async () => null } };
  const result = await readCustomerInsights(empty, { tenantId: 't', workspaceId: 'w', customerId: 'c' });
  assert.equal(result.totalOrders, 0);
  assert.equal(result.lastOrderAt, undefined);
  assert.deepEqual(result.amounts, []);
  assert.ok(result.months.every(row => row.orders === 0 && row.amounts.length === 0));
  const missing = { rentalOrder: { groupBy: async () => [{ status: 'COMPLETED', currency: 'CNY', _count: { _all: 1 }, _sum: { finalPayableAmount: null } }], findFirst: async () => null } };
  const withoutAmount = await readCustomerInsights(missing, { tenantId: 't', workspaceId: 'w', customerId: 'c' });
  assert.deepEqual(withoutAmount.amounts, []);
});

test('the original profile gate rejects tenant, workspace, financial and restricted-scope access before analytics reads', async () => {
  const serviceFile = path.resolve(__dirname, '../apps/api/src/modules/platform/customer-operations.service.ts');
  const compiled = ts.transpileModule(fs.readFileSync(serviceFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exported = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === '@nestjs/common' || name === '@prisma/client' || name === '@rental-os/shared') return require(name);
    if (name === '../../common/request-identity') return { getRequestWorkspaceId: () => 'workspace-a', getRequestDataScope: () => 'all', getRequestLocationIds: () => undefined };
    if (name === './customer-insights') return { readCustomerInsights: () => { throw new Error('analytics must never run for denied access'); } };
    return {};
  }, exported, exported.exports);
  const service = new exported.exports.CustomerOperationsService({}, {}, {});
  const user = { isActive: true, isSaasAdmin: false, tenantId: 'tenant-a', dataScope: 'all', permissions: ['rental-os:order:view', 'rental-os:finance:view', 'rental-os:marketing:manage'] };
  for (const denied of [{ ...user, tenantId: 'tenant-b' }, { ...user, isSaasAdmin: true }, { ...user, dataScope: 'own' }, { ...user, locationScope: { mode: 'selected', locationIds: ['location-a'] } }, { ...user, permissions: ['rental-os:order:view'] }]) {
    await assert.rejects(service.getProfileOverview('tenant-a', 'workspace-a', 'customer-a', denied), error => error.getStatus?.() === 403);
  }
  await assert.rejects(service.getProfileOverview('tenant-a', 'workspace-b', 'customer-a', user), error => error.getStatus?.() === 403);
});
