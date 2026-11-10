'use strict';
// Real member/merchant services, access, receipts, ALS and relationship repository.
// SQL/model/transaction doubles below prove local guards, not MySQL concurrency or HTTP authorization.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const writeRoot = path.join(root, 'output', 'enterprise-offline', 'administrator-continuity');
assert.equal(process.env.DATABASE_URL, 'mysql://offline:offline@127.0.0.1:1/rental_os_offline');
assert.equal(path.resolve(process.env.AI_OFFLINE_WRITE_ROOT), writeRoot);
assert.equal(path.resolve(process.env.TEMP), writeRoot);
assert.equal(path.resolve(process.env.TMP), writeRoot);
assert.ok(process.execArgv.some(arg => arg.includes('prisma-offline-preload.cjs')));
const now = Date.parse('2026-11-04T12:00:00Z');
class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
class HttpError extends Error {
  constructor(body, status) { super(typeof body === 'string' ? body : body.message); this.body = body; this.status = status; }
  getStatus() { return this.status; }
}
const common = { Injectable: () => value => value, Optional: () => () => undefined };
for (const [name, status] of [['BadRequestException', 400], ['ConflictException', 409], ['ForbiddenException', 403], ['NotFoundException', 404]]) {
  common[name] = class extends HttpError { constructor(body) { super(body, status); } };
}
// Only the tagged-SQL shape is needed; no generated Prisma client or engine is loaded.
function sqlTag(strings, ...args) {
  const parts = [strings[0]], values = [];
  args.forEach((arg, index) => {
    if (arg && Array.isArray(arg.strings)) {
      parts[parts.length - 1] += arg.strings[0];
      arg.values.forEach((value, i) => { values.push(value); parts.push(arg.strings[i + 1]); });
      parts[parts.length - 1] += strings[index + 1];
    } else { values.push(arg); parts.push(strings[index + 1]); }
  });
  return { strings: parts, values };
}
const Prisma = { sql: sqlTag, TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } };
function load(relative, deps = {}) {
  const file = path.join(root, relative), exports = {};
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true },
  });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
  vm.runInNewContext(result.outputText, { exports, require: name => {
    if (name in deps) return deps[name];
    if (name.startsWith('node:')) return require(name);
    if (name === '@nestjs/common') return common;
    if (name === '@prisma/client') return { Prisma };
    if (name === 'class-validator') return require(name); // Existing real date validator, not a new authority adapter.
    throw new Error(`Unexpected runtime dependency: ${name}`);
  }, Date: ClockDate, Map, Set, JSON }, { filename: file });
  return exports;
}
const identity = load('apps/api/src/common/request-identity.ts');
const commands = load('apps/api/src/modules/enterprise/enterprise-command.service.ts', { '../../common/request-identity': identity });
const continuity = load('apps/api/src/modules/enterprise/enterprise-administrator-continuity.ts');
const shared = load('packages/shared/src/enterprise.ts');
const { SharedCustomerRepository } = load('apps/api/src/modules/platform/shared-customer.repository.ts', { '../../common/request-identity': identity });
const { EnterpriseAccessService } = load('apps/api/src/modules/client/enterprise-access.service.ts', { '@rental-os/shared': shared });
const { EnterpriseMembersService } = load('apps/api/src/modules/enterprise/enterprise-members.service.ts', {
  '@rental-os/shared': shared, './enterprise-command.service': commands, './enterprise-administrator-continuity': continuity,
});
const unused = () => { throw new Error('Unrelated business dependency must not execute in member continuity tests'); };
const { MembershipService } = load('apps/api/src/modules/platform/membership.service.ts', {
  '@rental-os/shared': shared, '../../common/request-identity': identity,
  './shared-customer.repository': { SharedCustomerRepository }, './customer-registration.transaction': { customerRegistrationTransaction: unused },
  './customer-registration.service': { CustomerRegistrationService: unused }, '../../common/password': { hashPassword: unused },
  '../rental-core/rental-qualification': { evaluateRentalQualification: unused }, '../rental-core/category-active-write': { lockActiveCategoryBinding: unused },
  '../enterprise/enterprise-policy.service': { EnterprisePolicyService: unused }, '../enterprise/enterprise-command.service': commands,
  '../client/enterprise-access.service': { EnterpriseAccessService }, '../enterprise/enterprise-administrator-continuity': continuity,
});
const copy = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
const ctx = customerId => ({ tenantId: 't1', tenantCode: 'merchant', customerId, customerType: 'personal', sessionId: `session-${customerId}` });
const inIdentity = (id, work) => identity.runWithRequestIdentity({ tenantId: 't1', userId: id, isSaasAdmin: false }, work);
const change = (key, row, extra = {}) => ({ operationKey: key, expectedRevision: 1, expectedUpdatedAt: row.updatedAt.toISOString(), reason: 'Explicit member decision', ...extra });
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(condition => matches(row, condition));
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('is' in value) return !!actual && matches(actual, value.is);
      if ('not' in value && actual === value.not) return false;
      if ('lte' in value && !(actual <= value.lte)) return false;
      if ('gt' in value && !(actual > value.gt)) return false;
      return true;
    }
    return actual === value;
  });
}
function sqlParts(strings, values) {
  if (!Array.isArray(strings)) { values = strings.values; strings = strings.strings; }
  const sql = strings.map((part, i) => (i ? `$${i - 1}` : '') + part).join('').replace(/\s+/g, ' ');
  const filters = Object.fromEntries([...sql.matchAll(/(?:\b\w+\.)?(\w+)=\$(\d+)/g)].map(m => [m[1], values[Number(m[2])]]));
  return { sql, values, filters };
}
function fixture() {
  const person = id => ({ id, tenantId: 't1', customerType: 'personal', status: 'active', mergedIntoCustomerId: null, name: id,
    account: { tenantId: 't1', customerId: id, status: 'active' }, membership: { tenantId: 't1', customerId: id, status: 'active' } });
  const relation = (id, personalCustomerId, role = 'admin') => ({ id, tenantId: 't1', corporateCustomerId: 'company', personalCustomerId,
    role, status: 'active', effectiveFrom: new ClockDate(now - 10000), effectiveTo: null, updatedAt: new ClockDate(now - 1000),
    createdAt: new ClockDate(now - 1000), department: 'Old', employeeNo: '1', reason: 'original' });
  let state = { profiles: [person('a'), person('b'), person('e'), { id: 'company', tenantId: 't1', customerType: 'corporate', name: 'Company',
    status: 'active', mergedIntoCustomerId: null, membership: { status: 'active' } }],
    relations: [relation('ra', 'a'), relation('rb', 'b'), relation('re', 'e', 'employee')], grants: [], receipts: [], portal: true, revision: 1 };
  function grant(row) {
    for (const action of ['portal:enter', 'members:read', 'members:manage', 'administrators:manage']) {
      state.grants.push({ tenantId: row.tenantId, corporateCustomerId: row.corporateCustomerId, membershipId: row.id, action, membershipUpdatedAt: row.updatedAt });
    }
  }
  grant(state.relations[0]); grant(state.relations[1]);
  let queue = Promise.resolve(), tenantLocked = false;
  const fault = { receipt: false, grant: false };
  const calls = { saves: 0, grantWrites: 0, rollbacks: 0, locks: 0, continuity: 0, sequence: [] };
  const profile = (id, tenantId = 't1') => state.profiles.find(p => p.id === id && p.tenantId === tenantId);
  const effective = row => row.status === 'active' && row.effectiveFrom <= new ClockDate() && (!row.effectiveTo || row.effectiveTo > new ClockDate());
  const eligible = p => p && p.customerType === 'personal' && p.status === 'active' && !p.mergedIntoCustomerId
    && p.account?.status === 'active' && p.account.tenantId === p.tenantId && p.account.customerId === p.id
    && p.membership?.status === 'active' && p.membership.tenantId === p.tenantId && p.membership.customerId === p.id;
  const grantsFor = row => state.grants.filter(g => g.tenantId === row.tenantId && g.corporateCustomerId === row.corporateCustomerId
    && g.membershipId === row.id && +g.membershipUpdatedAt === +row.updatedAt);
  const db = {
    async $queryRaw(strings, ...values) {
      const { sql, filters } = sqlParts(strings, values);
      calls.sequence.push(sql);
      if (sql.includes('FROM Tenant')) {
        assert.ok(sql.includes('FOR UPDATE'), 'member writes must keep the exclusive tenant fence');
        tenantLocked = true; calls.locks++; return [{ id: filters.id }];
      }
      if (sql.includes('manage.action=\'administrators:manage\'')) {
        assert.ok(tenantLocked, 'continuity must be checked under the original tenant lock'); calls.continuity++;
        // The model must not hide a missing SQL predicate: assert each real join/fence before simulating it.
        for (const required of ["p.customerType='personal'", "p.status='active'", 'p.mergedIntoCustomerId IS NULL',
          'p.tenantId=m.tenantId', 'p.id=m.personalCustomerId', 'a.tenantId=m.tenantId', 'a.customerId=p.id', "a.status='active'",
          'pm.tenantId=m.tenantId', 'pm.customerId=p.id', "pm.status='active'", "m.role='admin'", "m.status='active'",
          'm.effectiveFrom<=NOW(3)', 'm.effectiveTo IS NULL OR m.effectiveTo>NOW(3)', 'm.id<>$2', 'm.tenantId=$0', 'm.corporateCustomerId=$1']) assert.ok(sql.includes(required), required);
        for (const alias of ['entry', 'manage']) for (const required of ['tenantId=m.tenantId', 'corporateCustomerId=m.corporateCustomerId', 'membershipId=m.id', 'membershipUpdatedAt=m.updatedAt']) assert.ok(sql.includes(`${alias}.${required}`));
        assert.ok(sql.includes("entry.action='portal:enter'"));
        return state.relations.filter(r => r.tenantId === values[0] && r.corporateCustomerId === values[1] && r.id !== values[2]
          && r.role === 'admin' && effective(r) && eligible(profile(r.personalCustomerId, r.tenantId))
          && ['portal:enter', 'administrators:manage'].every(action => grantsFor(r).some(g => g.action === action))).slice(0, 1).map(r => ({ id: r.id }));
      }
      if (sql.includes('FROM customer_profiles p')) {
        const p = profile(filters.id, filters.tenantId);
        return eligible(p) && values[0] === `session-${p.id}` ? [{ id: p.id }] : [];
      }
      if (sql.includes('FROM customer_corporate_memberships m')) {
        assert.equal(values[0], 'merchant');
        return state.relations.filter(r => r.tenantId === filters.tenantId && r.personalCustomerId === filters.personalCustomerId && effective(r) && eligible(profile(r.personalCustomerId)))
          .flatMap(r => grantsFor(r).map(g => ({ corporateCustomerId: r.corporateCustomerId, corporateName: 'Company', membershipId: r.id,
            role: r.role, action: g.action, tenantRevision: 1, corporateRevision: state.revision, tenantEnabled: state.portal, corporateEnabled: state.portal })));
      }
      if (sql.includes('FROM enterprise_portal_operations')) return copy(state.receipts.filter(r => r.tenantId === filters.tenantId && r.operationKey === filters.operationKey));
      if (sql.includes('FROM enterprise_corporate_portals')) return state.portal ? [{ enabled: true, revision: state.revision }] : [];
      throw new Error(`Unhandled read: ${sql}`);
    },
    async $executeRaw(strings, ...values) {
      const { sql } = sqlParts(strings, values);
      assert.ok(tenantLocked);
      if (sql.startsWith('INSERT INTO enterprise_portal_operations')) {
        if (fault.receipt) throw new Error('Injected receipt failure');
        state.receipts.push({ tenantId: values[0], operationKey: values[1], actorUserId: values[2], requestHash: values[3], target: values[4], result: values[6] }); return 1;
      }
      if (sql.startsWith('DELETE FROM enterprise_portal_grants')) {
        calls.grantWrites++; state.grants = state.grants.filter(g => !(g.tenantId === values[0] && g.corporateCustomerId === values[1] && g.membershipId === values[2])); return 1;
      }
      if (sql.startsWith('INSERT INTO enterprise_portal_grants')) {
        calls.grantWrites++; if (fault.grant) throw new Error('Injected grant failure');
        state.grants.push({ tenantId: values[0], corporateCustomerId: values[1], membershipId: values[2], action: values[3], membershipUpdatedAt: values[4] }); return 1;
      }
      if (sql.startsWith('UPDATE enterprise_corporate_portals')) { state.revision++; return 1; }
      throw new Error(`Unhandled write: ${sql}`);
    },
    customerCorporateMembership: {
      async findFirst({ where }) { return copy(state.relations.find(r => matches({ ...r, personalCustomer: profile(r.personalCustomerId, r.tenantId) }, where)) ?? null); },
      async findUnique({ where }) { return copy(state.relations.find(r => matches(r, where.tenantId_corporateCustomerId_personalCustomerId)) ?? null); },
      async count() { throw new Error('Role-only counting must not decide administrator continuity'); },
      async upsert({ where, create, update }) {
        assert.ok(tenantLocked); calls.saves++;
        const row = state.relations.find(r => matches(r, where.tenantId_corporateCustomerId_personalCustomerId));
        if (row) { Object.assign(row, copy(update)); return copy(row); }
        const created = { id: 'new-relation', createdAt: new ClockDate(), updatedAt: new ClockDate(), ...copy(create) };
        state.relations.push(created); return copy(created);
      },
    },
    customerProfile: { async findFirst({ where }) { return copy(state.profiles.find(p => matches(p, where)) ?? null); } },
    customerMembership: { async findUnique({ where }) { return copy(profile(where.tenantId_customerId.customerId, where.tenantId_customerId.tenantId)?.membership ?? null); } },
    async $transaction(work) {
      let release; const previous = queue; queue = new Promise(resolve => { release = resolve; }); await previous;
      const before = copy(state); tenantLocked = false;
      try { return await work(db); } catch (error) { state = before; calls.rollbacks++; throw error; }
      finally { tenantLocked = false; release(); }
    },
  };
  const repository = new SharedCustomerRepository(db), command = new commands.EnterpriseCommandService(db), access = new EnterpriseAccessService(db);
  const members = new EnterpriseMembersService(db, command, access, repository);
  // Inject unrelated constructor dependencies so only the original member path is exercised.
  const merchant = new MembershipService(db, {}, repository, {}, {});
  const memberChange = (key = 'member-key', extra = {}, id = 'a', self = true) => {
    const row = state.relations.find(r => r.personalCustomerId === id);
    return inIdentity('a', () => members.changeMember(ctx('a'), 'company', row.id, change(key, row, { status: 'exited', ...extra }), self));
  };
  const merchantChange = (extra = {}, id = 'a') => {
    const row = state.relations.find(r => r.personalCustomerId === id);
    return inIdentity('operator', () => merchant.saveCorporateEmployee('t1', 'company', {
      personalCustomerId: id, role: 'employee', status: 'active', expectedUpdatedAt: row.updatedAt.toISOString(), reason: 'Merchant reviewed decision', ...extra,
    }, 'operator'));
  };
  return { state: () => state, calls, fault, members, access, memberChange, merchantChange,
    removePeerGrants: () => { state.grants = state.grants.filter(g => g.membershipId !== 'rb'); } };
}

test('current grant, identity, revision and lifetime determine whether another admin counts in both relation entries', async () => {
  const scenarios = [
    ['missing grants', f => f.removePeerGrants()],
    ['missing entry', f => { f.state().grants = f.state().grants.filter(g => g.membershipId !== 'rb' || g.action !== 'portal:enter'); }],
    ['missing manage', f => { f.state().grants = f.state().grants.filter(g => g.membershipId !== 'rb' || g.action !== 'administrators:manage'); }],
    ['old grant revision', f => { f.state().relations[1].updatedAt = new ClockDate(now - 500); }],
    ['wrong grant tenant', f => { for (const g of f.state().grants.filter(g => g.membershipId === 'rb')) g.tenantId = 't2'; }],
    ['wrong grant corporate', f => { for (const g of f.state().grants.filter(g => g.membershipId === 'rb')) g.corporateCustomerId = 'another'; }],
    ['wrong grant membership', f => { for (const g of f.state().grants.filter(g => g.membershipId === 'rb')) g.membershipId = 'unrelated'; }],
    ['inactive relationship', f => { f.state().relations[1].status = 'suspended'; }],
    ['future relationship', f => { f.state().relations[1].effectiveFrom = new ClockDate(now + 1000); }],
    ['expired relationship', f => { f.state().relations[1].effectiveTo = new ClockDate(now); }],
    ['employee with grants', f => { f.state().relations[1].role = 'employee'; }],
    ['merged person', f => { f.state().profiles[1].mergedIntoCustomerId = 'survivor'; }],
    ['inactive profile', f => { f.state().profiles[1].status = 'suspended'; }],
    ['not personal', f => { f.state().profiles[1].customerType = 'corporate'; }],
    ['inactive account', f => { f.state().profiles[1].account.status = 'suspended'; }],
    ['inactive membership', f => { f.state().profiles[1].membership.status = 'suspended'; }],
    ['foreign account', f => { f.state().profiles[1].account.tenantId = 't2'; }],
    ['foreign membership', f => { f.state().profiles[1].membership.tenantId = 't2'; }],
    ['foreign relation', f => { f.state().relations[1].tenantId = 't2'; }],
    ['other corporate', f => { f.state().relations[1].corporateCustomerId = 'another'; }],
  ];
  for (const [label, alter] of scenarios) for (const entry of ['memberChange', 'merchantChange']) {
    const f = fixture(); alter(f); const before = plain(f.state());
    await assert.rejects(f[entry](), error => error.status === 409, `${entry}: ${label}`);
    assert.deepEqual(plain(f.state()), before, `${label}: rejection must not change the relationship or receipt`);
    assert.equal(f.calls.saves, 0); assert.equal(f.calls.grantWrites, 0); assert.equal(f.calls.continuity, 1);
  }
});

test('active-role department/employee-number edits cannot silently invalidate the last management grant', async () => {
  for (const entry of ['member', 'merchant']) {
    const f = fixture(); f.removePeerGrants(); const before = plain(f.state());
    const action = entry === 'member' ? () => f.memberChange('edit', { status: 'active', department: 'New', employeeNo: '2' }, 'a', false)
      : () => f.merchantChange({ role: 'admin', status: 'active', department: 'New', employeeNo: '2' });
    await assert.rejects(action(), error => error.status === 409);
    assert.deepEqual(plain(f.state()), before); assert.equal(f.calls.saves, 0);
  }
});

test('a genuinely authorized remaining administrator permits exit/demotion and metadata edits without automatic regranting', async () => {
  for (const entry of ['member', 'merchant', 'member-edit', 'merchant-edit']) {
    const f = fixture(); const grants = plain(f.state().grants);
    const result = entry === 'member' ? await f.memberChange() : entry === 'merchant' ? await f.merchantChange()
      : entry === 'member-edit' ? await f.memberChange('edit', { status: 'active', department: 'New' }, 'a', false)
      : await f.merchantChange({ role: 'admin', department: 'New' });
    assert.ok(result.updatedAt); assert.equal(f.calls.saves, 1); assert.equal(f.calls.continuity, 1);
    assert.equal(f.calls.grantWrites, 0); assert.deepEqual(plain(f.state().grants), grants);
    await inIdentity('b', () => f.access.requireAction(ctx('b'), 'company', 'administrators:manage'));
    await assert.rejects(inIdentity('a', () => f.access.requireAction(ctx('a'), 'company', 'administrators:manage')), error => error.status === 403);
  }
});

test('ordinary employees and explicitly unmigrated merchant relationships retain their original paths', async () => {
  const member = fixture(); member.removePeerGrants();
  await member.memberChange('employee-exit', {}, 'e', false); assert.equal(member.calls.continuity, 0);
  const merchant = fixture(); merchant.state().portal = false; merchant.removePeerGrants();
  await merchant.merchantChange(); assert.equal(merchant.calls.continuity, 0);
});

test('revision conflict and missing actor authority reject before relationship writes', async () => {
  const stale = fixture(); const row = stale.state().relations[0];
  await assert.rejects(inIdentity('a', () => stale.members.changeMember(ctx('a'), 'company', 'ra', change('stale', row, {
    expectedUpdatedAt: new ClockDate(now - 2000).toISOString(), status: 'suspended',
  }))), error => error.status === 409 && error.body.code === 'enterprise_revision_conflict');
  assert.equal(stale.calls.saves, 0); assert.equal(stale.calls.continuity, 0);
  const revoked = fixture(); revoked.state().grants = revoked.state().grants.filter(g => g.membershipId !== 'ra' || g.action !== 'members:manage');
  await assert.rejects(revoked.memberChange('revoked', {}, 'e', false), error => error.status === 403);
  assert.equal(revoked.calls.saves, 0); assert.equal(revoked.state().receipts.length, 0);
});

test('explicit administrator reauthorization remains possible, while role-only other admins cannot justify revocation', async () => {
  const f = fixture(); f.removePeerGrants(); const row = f.state().relations[0];
  const input = change('regrant', row, { role: 'admin', actions: ['portal:enter', 'members:manage', 'administrators:manage'] });
  const result = await inIdentity('a', () => f.members.changeAdministrator(ctx('a'), 'company', 'ra', input));
  assert.equal(result.revision, 2); assert.equal(f.calls.continuity, 0);
  await inIdentity('a', () => f.access.requireAction(ctx('a'), 'company', 'administrators:manage'));
  const before = plain(f.state()), writes = f.calls.grantWrites;
  assert.deepEqual(plain(await inIdentity('a', () => f.members.changeAdministrator(ctx('a'), 'company', 'ra', input))), plain(result));
  assert.equal(f.calls.saves, 1); assert.equal(f.calls.grantWrites, writes); assert.deepEqual(plain(f.state()), before);
  await assert.rejects(inIdentity('a', () => f.members.changeAdministrator(ctx('a'), 'company', 'ra', change('revoke', f.state().relations[0], {
    expectedRevision: 2, role: 'admin', actions: ['portal:enter', 'members:manage'],
  }))), error => error.status === 409);
  assert.deepEqual(plain(f.state()), before);
});

test('receipt or explicit grant failures roll the relationship change back under the same transaction', async () => {
  for (const kind of ['receipt', 'grant']) {
    const f = fixture(); const before = plain(f.state()); f.fault[kind] = true;
    const action = kind === 'receipt' ? () => f.memberChange() : () => inIdentity('a', () => f.members.changeAdministrator(ctx('a'), 'company', 'rb', change('grant-failure', f.state().relations[1], {
      role: 'admin', actions: ['portal:enter', 'members:manage', 'administrators:manage'],
    })));
    await assert.rejects(action(), new RegExp(`Injected ${kind} failure`));
    assert.deepEqual(plain(f.state()), before); assert.equal(f.calls.rollbacks, 1); assert.equal(f.calls.saves, 1);
  }
});

test('self-exit repeats only read the exact original receipt, never mutate or reauthorize a second time', async () => {
  const f = fixture(); const input = change('exact-exit', f.state().relations[0], { status: 'exited' });
  const run = () => inIdentity('a', () => f.members.changeMember(ctx('a'), 'company', 'ra', input, true));
  const first = await run(), before = plain(f.state());
  assert.deepEqual(plain(await run()), plain(first)); assert.deepEqual(plain(f.state()), before);
  assert.equal(f.calls.saves, 1); assert.equal(f.calls.continuity, 1); assert.equal(f.calls.grantWrites, 0);
});

test('competing portal and merchant removals leave one current administrator after serialized tenant-locked commits', async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.memberChange('competing-exit'), f.merchantChange({}, 'b')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  assert.equal(f.calls.saves, 1); assert.equal(f.calls.locks, 2);
  assert.ok(f.calls.sequence[0].includes('FROM Tenant'));
  await inIdentity('b', () => f.access.requireAction(ctx('b'), 'company', 'administrators:manage'));
});
