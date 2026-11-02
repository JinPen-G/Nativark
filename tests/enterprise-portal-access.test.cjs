const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const path = require('node:path');
function load(file, deps = {}) {
  const source = fs.readFileSync(path.resolve(file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  const sandbox = { exports, require: name => { if (name in deps) return deps[name]; if (name.startsWith('node:')) return require(name); if (name === '@nestjs/common') return { Injectable: () => x => x, ForbiddenException: class extends Error {}, BadRequestException: class extends Error {}, ConflictException: class extends Error {}, NotFoundException: class extends Error {} }; throw new Error(`Unexpected dependency ${name}`); }, Date, Map, Set, JSON, console };
  vm.runInNewContext(output, sandbox, { filename: file });
  return exports;
}
const shared = require('../packages/shared/dist');
const { EnterpriseAccessService } = load('apps/api/src/modules/client/enterprise-access.service.ts', { '@rental-os/shared': shared });
const context = { tenantId: 't1', tenantCode: 'demo', customerId: 'p1', customerType: 'personal', sessionId: 'session', displayName: 'Admin', membershipStatus: 'active' };
function rows(action = ['portal:enter', 'members:read']) {
  return action.map(action => ({ corporateCustomerId: 'c1', corporateName: 'Company', membershipId: 'r1', role: 'admin', action, tenantRevision: 1, corporateRevision: 1, tenantEnabled: true, corporateEnabled: true }));
}
function fixture(accessRows) {
  return new EnterpriseAccessService({ $queryRaw: async () => accessRows(), tenant: { findFirst: async () => ({ name: 'Merchant' }) }, customerCorporateMembership: { findMany: async () => [{ id: 'm2', updatedAt: new Date('2026-01-01Z'), role: 'employee', status: 'active', personalCustomer: { name: 'Employee', phone: 'secret' }, department: 'Ops', employeeNo: '2', reason: 'private', effectiveFrom: new Date('2026-01-01Z'), effectiveTo: null }] } });
}
test('entry requires explicit actions; admin alone and employee do not admit', async () => {
  for (const records of [rows([]), rows().map(r => ({ ...r, action: null })), rows().map(r => ({ ...r, role: 'employee' })), rows().map(r => ({ ...r, tenantEnabled: false })), rows().map(r => ({ ...r, corporateEnabled: false }))]) {
    assert.equal((await fixture(() => records).entry(context, 'demo')).corporates.length, 0);
  }
  assert.equal((await fixture(rows).entry(context, 'demo')).corporates.length, 1);
});
test('cross tenant or corporate is denied', async () => {
  await assert.rejects(fixture(rows).entry(context, 'other'));
  await assert.rejects(fixture(rows).members(context, 'demo', 'c2'));
  await assert.rejects(fixture(rows).members({ ...context, customerType: 'corporate' }, 'demo', 'c1'));
});
test('member projection excludes private fields and rechecks revoked permissions', async () => {
  const response = await fixture(rows).members(context, 'demo', 'c1');
  assert.equal(response.items[0].displayName, 'Employee');
  assert.equal(JSON.stringify(response).includes('secret'), false);
  assert.equal(JSON.stringify(response).includes('private'), false);
  let reads = 0;
  await assert.rejects(fixture(() => ++reads === 1 ? rows() : []).members(context, 'demo', 'c1'));
});
test('entry-only grants survive separate action editing and invalid member-only grants refuse', () => {
  const { portalAccessGrants, isPortalRevisionConflict } = load('apps/admin/src/features/membership/enterprise-portal-config.ts', { '@rental-os/shared': shared });
  const result = portalAccessGrants({ enabled: true, entryMembershipIds: ['entry', 'reader'], memberMembershipIds: ['reader'], reason: 'Keep independent actions' });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ membershipId: 'entry', actions: ['portal:enter'] }, { membershipId: 'reader', actions: ['portal:enter', 'members:read'] }]);
  assert.throws(() => portalAccessGrants({ entryMembershipIds: [], memberMembershipIds: ['reader'] }));
  const previous = [{ membershipId: 'entry', actions: ['portal:enter', 'approvals:review', 'policy:manage'] }];
  assert.deepEqual(JSON.parse(JSON.stringify(portalAccessGrants({ entryMembershipIds: ['entry'], memberMembershipIds: [] }, previous))), previous);
  const changed = portalAccessGrants({ entryMembershipIds: ['entry'], memberMembershipIds: [], actionMembershipIds: { 'approvals:review': [], 'members:manage': ['entry'] } }, previous);
  assert.deepEqual(JSON.parse(JSON.stringify(changed)), [{ membershipId: 'entry', actions: ['portal:enter', 'policy:manage', 'members:manage'] }]);
  assert.throws(() => portalAccessGrants({ entryMembershipIds: ['entry'], memberMembershipIds: [], actionMembershipIds: { 'approvals:review': ['other'] } }));
  assert.throws(() => portalAccessGrants({ entryMembershipIds: ['entry'], memberMembershipIds: [], actionMembershipIds: { 'made-up': ['entry'] } }));
  assert.equal(isPortalRevisionConflict({ response: { status: 409, data: { code: 'enterprise_revision_conflict' } } }), true);
  assert.equal(isPortalRevisionConflict({ response: { status: 409, data: { code: 'unknown' } } }), false);
  assert.equal(isPortalRevisionConflict(new Error('network')), false);
});
test('revision conflict has an explicit pre-write rejection; committed original keys only replay receipts', async () => {
  class HttpError extends Error { constructor(body) { super(body.message ?? body); this.body = body; } }
  const common = { Injectable: () => x => x, ForbiddenException: HttpError, BadRequestException: HttpError, ConflictException: HttpError, NotFoundException: HttpError };
  const { EnterprisePortalService } = load('apps/api/src/modules/platform/enterprise-portal.service.ts', {
    '@nestjs/common': common, '@prisma/client': { Prisma: {} },
    '@rental-os/shared': { ENTERPRISE_PORTAL_ACTIONS: ['portal:enter', 'members:read'] },
    '../../common/request-identity': { requireRequestTenantId: () => 't1', requireRequestUserId: () => 'u1' },
  });
  let revision = 2, writes = 0; const receipts = new Map();
  const tx = {
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join('?');
      if (sql.includes('FROM Tenant')) return [{ id: 't1' }];
      if (sql.includes('enterprise_portal_operations')) return receipts.has(values[1]) ? [receipts.get(values[1])] : [];
      if (sql.includes('enterprise_portal_tenant_settings')) return [{ enabled: true, revision }];
      throw new Error(sql);
    },
    $executeRaw: async (strings, ...values) => {
      const sql = strings.join('?'); writes++;
      if (sql.includes('enterprise_portal_operations')) receipts.set(values[1], { actorUserId: values[2], requestHash: values[3], result: values[6] });
      else if (sql.includes('enterprise_portal_tenant_settings')) revision = values[2];
      else throw new Error(sql);
    },
  };
  const api = new EnterprisePortalService({ ...tx, $transaction: async fn => fn(tx) });
  const user = { id: 'u1', tenantId: 't1', isActive: true, dataScope: 'all', permissions: ['rental-os:corporate:manage'] };
  const input = { enabled: true, expectedRevision: 1, operationKey: 'conflict', reason: 'Explicit entry' };
  await assert.rejects(api.saveTenantSettings(user, input), error => error.body.code === 'enterprise_revision_conflict');
  assert.equal(writes, 0); assert.equal((await api.operation(user, input.operationKey)).state, 'not_recorded');
  const updated = { ...input, expectedRevision: 2, operationKey: 'accepted' };
  await api.saveTenantSettings(user, updated); const committedWrites = writes;
  revision = 10;
  assert.equal((await api.saveTenantSettings(user, updated)).revision, 3);
  assert.equal(writes, committedWrites); assert.equal(revision, 10);
  await assert.rejects(api.saveTenantSettings(user, { ...updated, enabled: false }));
  assert.equal(writes, committedWrites);
});
test('all seven portal operations retain matching Controller methods and OpenAPI references', () => {
  const api = fs.readFileSync('apps/api/src/contracts/openapi-document.ts', 'utf8');
  const client = fs.readFileSync('apps/api/src/modules/client/client-api.controller.ts', 'utf8');
  const membership = fs.readFileSync('apps/api/src/modules/platform/membership.controller.ts', 'utf8');
  const workflow = load('apps/api/src/modules/enterprise/enterprise-workflow-schemas.ts');
  const extension = load('apps/api/src/modules/enterprise/enterprise-extension-schemas.ts');
  const { ENTERPRISE_COMPONENT_SCHEMAS: schemas } = load('apps/api/src/contracts/enterprise-schemas.ts', { '@rental-os/shared': shared, '../modules/enterprise/enterprise-workflow-schemas': workflow, '../modules/enterprise/enterprise-extension-schemas': extension });
  for (const [method, prefix, route, file] of [
    ['get', '/api/client/v1/', 'enterprise/entry', client],
    ['get', '/api/client/v1/', 'enterprise/corporates/:corporateCustomerId/members', client],
    ['get', '/api/membership/', 'enterprise-portal/operations/:operationKey', membership],
    ['get', '/api/membership/', 'enterprise-portal/settings', membership],
    ['put', '/api/membership/', 'enterprise-portal/settings', membership],
    ['get', '/api/membership/', 'corporate/:corporateCustomerId/enterprise-portal', membership],
    ['put', '/api/membership/', 'corporate/:corporateCustomerId/enterprise-portal', membership],
  ]) {
    const decorator = method[0].toUpperCase() + method.slice(1);
    assert.ok(file.includes(`@${decorator}("${route}")`), route);
    const contract = prefix + route.replace(/:([A-Za-z]+)/g, '{$1}');
    assert.ok(api.includes(`("${method}", "${contract}"`), contract);
  }
  const check = value => {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) assert.ok(schemas[value.$ref.slice('#/components/schemas/'.length)]);
    Object.values(value).forEach(check);
  };
  Object.values(schemas).forEach(check);
});
test('SQL source guards current session, active memberships and grant relationship revision', () => {
  const code = fs.readFileSync('apps/api/src/modules/client/enterprise-access.service.ts', 'utf8');
  for (const guard of ["s.revokedAt IS NULL", "s.expiresAt>NOW(3)", "personalMember.status='active'", "corporateMember.status='active'", "account.status='active'", "g.membershipUpdatedAt=m.updatedAt", "m.effectiveTo>NOW(3)"]) assert.ok(code.includes(guard), guard);
  const migration = fs.readFileSync('apps/api/prisma/migrations/20261101000100_enterprise_portal_access/migration.sql', 'utf8');
  assert.ok(migration.includes('DEFAULT false'));
  assert.equal(/INSERT INTO/i.test(migration), false);
});
