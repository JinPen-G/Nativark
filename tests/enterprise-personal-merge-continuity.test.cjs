'use strict';
// Exercises the original merge service, repositories and current enterprise access.
// Tagged SQL/model/transaction doubles do not prove MySQL locks, HTTP Guard or live auth.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const writeRoot = path.join(root, 'output/enterprise-offline/personal-merge-continuity');
assert.equal(process.env.DATABASE_URL, 'mysql://offline:offline@127.0.0.1:1/rental_os_offline');
for (const key of ['AI_OFFLINE_WRITE_ROOT', 'TEMP', 'TMP']) assert.equal(path.resolve(process.env[key]), writeRoot);
assert.ok(process.execArgv.some(arg => arg.includes('prisma-offline-preload.cjs')));
const now = Date.parse('2026-11-04T12:00:00Z');
class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
class HttpError extends Error { constructor(body, status) { super(typeof body === 'string' ? body : body.message); this.body = body; this.status = status; } }
const common = { Injectable: () => value => value, Inject: () => () => {}, Optional: () => () => {} };
for (const [name, status] of [['BadRequestException', 400], ['ConflictException', 409], ['ForbiddenException', 403], ['NotFoundException', 404]]) {
  common[name] = class extends HttpError { constructor(body) { super(body, status); } };
}
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
const Prisma = { sql: sqlTag, empty: sqlTag(['']) };
const $Enums = { RentalOrderV1Status: Object.fromEntries(['DRAFT', 'RESERVED', 'READY_FOR_PICKUP', 'RENTING', 'RETURN_INSPECTION'].map(s => [s, s])) };
function load(relative, deps = {}) {
  const file = path.join(root, relative), exports = {};
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
  vm.runInNewContext(result.outputText, { exports, require: name => {
    if (name in deps) return deps[name];
    if (name.startsWith('node:')) return require(name);
    if (name === '@nestjs/common') return common;
    if (name === '@prisma/client') return { Prisma, $Enums }; // No generated client or engine.
    throw new Error(`Unexpected runtime dependency: ${name}`);
  }, Date: ClockDate, Map, Set, JSON }, { filename: file });
  return exports;
}
const identity = load('apps/api/src/common/request-identity.ts');
const customerModule = load('apps/api/src/modules/platform/shared-customer.repository.ts', { '../../common/request-identity': identity });
const operationsModule = load('apps/api/src/modules/platform/customer-operations.repository.ts', { './shared-customer.repository': customerModule });
const continuity = load('apps/api/src/modules/enterprise/enterprise-administrator-continuity.ts');
const unused = () => { throw new Error('Unrelated funding or closure path must not execute'); };
const { CustomerMergeService } = load('apps/api/src/modules/platform/customer-merge.service.ts', {
  './shared-customer.repository': customerModule, './customer-operations.repository': operationsModule,
  '../enterprise/enterprise-administrator-continuity': continuity,
  '../rental-core/rental-funding-events': new Proxy({}, { get: () => unused }),
});
const shared = { ...load('packages/shared/src/core.ts'), ...load('packages/shared/src/enterprise.ts') };
const { CustomerOperationsService } = load('apps/api/src/modules/platform/customer-operations.service.ts', {
  '@rental-os/shared': shared, './shared-customer.repository': customerModule, './customer-operations.repository': operationsModule,
  '../../common/request-identity': identity,
});
const { EnterpriseAccessService } = load('apps/api/src/modules/client/enterprise-access.service.ts', { '@rental-os/shared': shared });
const commands = load('apps/api/src/modules/enterprise/enterprise-command.service.ts', { '../../common/request-identity': identity });
const fingerprints = load('apps/api/src/modules/rental-core/rental-idempotency.repository.ts', { './workspace-scope': {} });
const { EnterprisePolicyService } = load('apps/api/src/modules/enterprise/enterprise-policy.service.ts', {
  '@rental-os/shared': shared, '../../common/request-identity': identity, './enterprise-command.service': commands,
  '../rental-core/rental-idempotency.repository': fingerprints,
});
const copy = value => structuredClone(value), plain = value => JSON.parse(JSON.stringify(value));
function sqlParts(strings, ...values) {
  if (!Array.isArray(strings)) { values = strings.values; strings = strings.strings; }
  return { sql: strings.map((s, i) => (i ? `$${i - 1}` : '') + s).join('').replace(/`/g, '').replace(/\s+/g, ' ').trim(), values };
}
function fixture() {
  const profile = (id, customerType = 'personal', tenantId = 't1') => ({ id, tenantId, customerType, status: 'active', mergedIntoCustomerId: null,
    name: id, phone: `fixture-${id}`, phoneMasked: '***', identityVerified: true, qualifications: {},
    createdAt: new ClockDate(now - 10000), updatedAt: new ClockDate(now - 1000) });
  const relation = (id, person, corporate = 'company', tenant = 't1') => ({ id, tenantId: tenant, corporateCustomerId: corporate,
    personalCustomerId: person, role: 'admin', status: 'active', effectiveFrom: new ClockDate(now - 10000), effectiveTo: null,
    updatedAt: new ClockDate(now - 1000) });
  let state = { profiles: [...['a', 'b', 'survivor', 'survivor2'].map(id => profile(id)), profile('company', 'corporate')], accounts: [], memberships: [],
    relations: [relation('ra', 'a'), relation('rb', 'b')], grants: [],
    portals: [{ tenantId: 't1', corporateCustomerId: 'company', enabled: true }], policies: [], mappings: [], histories: [], audits: [], risks: [],
    orders: [{ id: 'original-order', tenantId: 't1', customerId: 'a', userSubjectCustomerId: 'a', contractSubjectCustomerId: 'company', payerSubjectCustomerId: 'company', workspaceId: 'w2' }],
    receipts: [{ key: 'original-submit', orderId: 'original-order', result: 'consumed' }], refunds: [{ originalPayer: 'a', orderId: 'original-order' }] };
  const addPerson = p => {
    state.profiles.push(p);
    state.accounts.push({ id: `account:${p.tenantId}:${p.id}`, tenantId: p.tenantId, customerId: p.id, status: 'active', loginPhone: 'fixture-only', loginPhoneMasked: '***', createdAt: p.createdAt, updatedAt: p.updatedAt });
    state.memberships.push({ id: `member:${p.tenantId}:${p.id}`, tenantId: p.tenantId, customerId: p.id, status: 'active', levelName: 'Original member', createdAt: p.createdAt, updatedAt: p.updatedAt });
  };
  const originals = state.profiles; state.profiles = []; originals.forEach(addPerson);
  const grant = r => ['portal:enter', 'administrators:manage'].forEach(action => state.grants.push({ tenantId: r.tenantId,
    corporateCustomerId: r.corporateCustomerId, membershipId: r.id, membershipUpdatedAt: r.updatedAt, action }));
  state.relations.forEach(grant);
  const calls = { sequence: [], customerLocks: [], continuity: 0, sourceChecks: 0, marks: 0, accountWrites: 0, rollbacks: 0, transactionStarts: 0, corporateInvalidations: 0 };
  const faults = { mapping: false, account: false, history: false, markZero: false, tenantMissing: false, invalidate: false };
  let queue = Promise.resolve(), tenantLocked = false, tenantFence, lockedIds = new Set(), beforeTransaction;
  const person = (id, tenant = 't1') => state.profiles.find(p => p.id === id && p.tenantId === tenant);
  const account = (id, tenant = 't1') => state.accounts.find(p => p.customerId === id && p.tenantId === tenant);
  const membership = (id, tenant = 't1') => state.memberships.find(p => p.customerId === id && p.tenantId === tenant);
  const eligible = (id, tenant = 't1') => person(id, tenant)?.customerType === 'personal' && person(id, tenant)?.status === 'active'
    && !person(id, tenant)?.mergedIntoCustomerId && account(id, tenant)?.status === 'active' && membership(id, tenant)?.status === 'active';
  const corporateEligible = (id, tenant = 't1') => person(id, tenant)?.customerType === 'corporate' && person(id, tenant)?.status === 'active'
    && !person(id, tenant)?.mergedIntoCustomerId && membership(id, tenant)?.status === 'active';
  const effective = r => r.role === 'admin' && r.status === 'active' && r.effectiveFrom <= new ClockDate() && (!r.effectiveTo || r.effectiveTo > new ClockDate());
  const currentGrants = r => state.grants.filter(g => g.tenantId === r.tenantId && g.corporateCustomerId === r.corporateCustomerId
    && g.membershipId === r.id && +g.membershipUpdatedAt === +r.updatedAt);
  const authorized = r => effective(r) && eligible(r.personalCustomerId, r.tenantId)
    && ['portal:enter', 'administrators:manage'].every(action => currentGrants(r).some(g => g.action === action));
  const migrated = r => [...state.portals, ...state.policies].some(p => p.tenantId === r.tenantId && p.corporateCustomerId === r.corporateCustomerId);
  const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
  const assertAuthoritySql = sql => {
    for (const term of ["p.customerType='personal'", "p.status='active'", 'p.mergedIntoCustomerId IS NULL', 'p.tenantId=m.tenantId', 'p.id=m.personalCustomerId',
      'a.tenantId=m.tenantId', 'a.customerId=p.id', "a.status='active'", 'pm.tenantId=m.tenantId', 'pm.customerId=p.id', "pm.status='active'",
      "m.role='admin'", "m.status='active'", 'm.effectiveFrom<=NOW(3)', 'm.effectiveTo IS NULL OR m.effectiveTo>NOW(3)', 'm.tenantId=$0']) assert.ok(sql.includes(term), term);
    for (const alias of ['entry', 'manage']) for (const term of ['tenantId=m.tenantId', 'corporateCustomerId=m.corporateCustomerId', 'membershipId=m.id', 'membershipUpdatedAt=m.updatedAt']) assert.ok(sql.includes(`${alias}.${term}`));
    assert.ok(sql.includes("entry.action='portal:enter'") && sql.includes("manage.action='administrators:manage'"));
  };
  const db = {
    async $queryRaw(strings, ...args) {
      const { sql, values } = sqlParts(strings, ...args); calls.sequence.push(sql);
      if (sql.includes('FROM Tenant')) {
        assert.equal(lockedIds.size, 0, 'Tenant fence must not be acquired or upgraded after any customer gate');
        assert.ok(sql.includes('FOR UPDATE') || sql.includes('LOCK IN SHARE MODE'));
        tenantFence = sql.includes('FOR UPDATE') ? 'exclusive' : 'shared'; tenantLocked = true;
        return !faults.tenantMissing && values[0] === 't1' ? [{ id: 't1' }] : []; }
      if (sql.includes('FROM customer_profiles') && sql.includes('FOR UPDATE')) {
        assert.ok(tenantLocked, 'Tenant must precede the original customer gates');
        calls.customerLocks.push(values[1]); lockedIds.add(values[1]); return person(values[1], values[0]) ? [{ id: values[1] }] : [];
      }
      if (sql.includes('manage.action=\'administrators:manage\'')) {
        assert.ok(tenantLocked && tenantFence === 'exclusive' && lockedIds.size === 2, 'exclusive Tenant and both customer gates must precede continuity'); assertAuthoritySql(sql);
        if (sql.includes('m.personalCustomerId=$1')) {
          calls.sourceChecks++;
          for (const alias of ['portal', 'policy']) for (const term of ['tenantId=m.tenantId', 'corporateCustomerId=m.corporateCustomerId']) assert.ok(sql.includes(`${alias}.${term}`));
          assert.ok(sql.includes(' OR EXISTS ') && !sql.includes('portal.enabled'), 'disabled portals and policy-only migration are still markers');
          return state.relations.filter(r => r.tenantId === values[0] && r.personalCustomerId === values[1] && authorized(r) && migrated(r))
            .map(r => ({ id: r.id, corporateCustomerId: r.corporateCustomerId }));
        }
        calls.continuity++; assert.ok(sql.includes('m.corporateCustomerId=$1') && sql.includes('m.id<>$2'));
        return state.relations.filter(r => r.tenantId === values[0] && r.corporateCustomerId === values[1] && r.id !== values[2] && authorized(r)).slice(0, 1).map(r => ({ id: r.id }));
      }
      if (sql.includes('SELECT m.corporateCustomerId')) {
        assert.ok(sql.includes("c.customerType='corporate'") && sql.includes("c.status='active'") && sql.includes('c.mergedIntoCustomerId IS NULL') && sql.includes("corporateMember.status='active'"));
        const id = values[3], tenant = values[2];
        return state.relations.filter(r => r.tenantId === tenant && r.personalCustomerId === id && eligible(id, tenant) && corporateEligible(r.corporateCustomerId, tenant) && effective(r) && migrated(r))
          .flatMap(r => currentGrants(r).map(g => ({ corporateCustomerId: r.corporateCustomerId, corporateName: 'Company', membershipId: r.id, role: r.role,
            action: g.action, tenantRevision: 1, corporateRevision: 1, tenantEnabled: true,
            corporateEnabled: state.portals.some(p => p.tenantId === tenant && p.corporateCustomerId === r.corporateCustomerId && p.enabled) })));
      }
      if (sql.startsWith('SELECT enabled FROM enterprise_corporate_portals')) return copy(state.portals.filter(p => p.tenantId === values[0] && p.corporateCustomerId === values[1]));
      if (sql.startsWith('SELECT scopeKey,revision,policy,membershipUpdatedAt')) return copy(state.policies.filter(p => p.tenantId === values[0] && p.corporateCustomerId === values[1]));
      if (sql.startsWith('SELECT enabled FROM enterprise_portal_tenant_settings')) return values[0] === 't1' ? [{ enabled: true }] : [];
      if (sql.startsWith('SELECT r.id,r.updatedAt')) {
        for (const term of ["p.customerType='personal'", "p.status='active'", 'p.mergedIntoCustomerId IS NULL', "a.status='active'", "pm.status='active'",
          "c.customerType='corporate'", "c.status='active'", 'c.mergedIntoCustomerId IS NULL', "cm.status='active'", 'r.tenantId=$0', 'r.corporateCustomerId=$1', 'r.personalCustomerId=$2']) assert.ok(sql.includes(term), term);
        return state.relations.filter(r => r.tenantId === values[0] && r.corporateCustomerId === values[1] && r.personalCustomerId === values[2]
          && eligible(r.personalCustomerId, r.tenantId) && corporateEligible(r.corporateCustomerId, r.tenantId) && r.status === 'active'
          && r.effectiveFrom <= values[3] && (!r.effectiveTo || r.effectiveTo > values[4])).map(r => ({ id: r.id, updatedAt: r.updatedAt }));
      }
      if (sql.startsWith('SELECT categoryCode FROM business_workspaces')) return values[0] === 't1' && values[1] === 'w2' ? [{ categoryCode: 'vehicle' }] : [];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async $executeRaw(strings, ...args) {
      const { sql, values } = sqlParts(strings, ...args); calls.sequence.push(sql);
      assert.ok(sql.startsWith('UPDATE customer_corporate_memberships m JOIN customer_profiles c'));
      for (const term of ['c.tenantId=m.tenantId', 'c.id=m.corporateCustomerId', "c.customerType='corporate'", 'm.tenantId=$0', 'm.corporateCustomerId=$1',
        'GREATEST(NOW(3),TIMESTAMPADD(MICROSECOND,1000,m.updatedAt))', 'portal.tenantId=m.tenantId', 'portal.corporateCustomerId=m.corporateCustomerId',
        'policy.tenantId=m.tenantId', 'policy.corporateCustomerId=m.corporateCustomerId']) assert.ok(sql.includes(term), term);
      assert.ok(sql.includes(' OR EXISTS ') && !sql.includes('portal.enabled'));
      assert.ok(tenantLocked && tenantFence === 'exclusive' && lockedIds.size === 2 && lockedIds.has(values[1]));
      const source = person(values[1], values[0]); assert.equal(source?.customerType, 'corporate'); assert.equal(source.status, 'merged');
      calls.corporateInvalidations++; if (faults.invalidate) throw new Error('Injected invalidate failure');
      const rows = state.relations.filter(r => r.tenantId === values[0] && r.corporateCustomerId === values[1] && migrated(r));
      rows.forEach(r => { r.updatedAt = new ClockDate(Math.max(now, +r.updatedAt + 1)); }); return rows.length;
    },
    customerProfile: {
      async findFirst({ where }) { const p = person(where.id, where.tenantId); return p ? copy({ ...p, membership: membership(p.id, p.tenantId), account: account(p.id, p.tenantId) ?? null }) : null; },
      async updateMany({ where, data }) { assert.ok(tenantLocked && lockedIds.has(where.id)); calls.marks++; calls.sequence.push('mark-merged');
        if (faults.markZero) return { count: 0 }; const rows = state.profiles.filter(p => matches(p, where)); rows.forEach(p => Object.assign(p, copy(data))); return { count: rows.length }; },
    },
    customerAccount: {
      async findFirst({ where }) { return copy(state.accounts.find(a => matches(a, where)) ?? null); },
      async updateMany({ where, data }) { assert.ok(tenantLocked); calls.accountWrites++; if (faults.account) throw new Error('Injected account failure');
        const rows = state.accounts.filter(a => matches(a, where)); rows.forEach(a => Object.assign(a, copy(data))); return { count: rows.length }; },
    },
    customerRiskRecord: { async create({ data }) {
      assert.ok(tenantLocked && tenantFence === 'shared' && lockedIds.has(data.customerId), 'risk FK insert must follow shared Tenant then customer gates, without upgrading');
      calls.sequence.push('risk-fk-insert'); if (faults.risk) throw new Error('Injected risk failure');
      const row = { id: 'original-risk', status: 'open', createdAt: new ClockDate(), updatedAt: new ClockDate(), ...copy(data) };
      state.risks.push(row); return copy(row);
    } },
    rentalOrder: { async count({ where }) { return state.orders.filter(o => matches(o, where)).length; } },
    customerMergeMapping: {
      async create({ data }) { assert.ok(tenantLocked); if (faults.mapping) throw new Error('Injected mapping failure'); state.mappings.push(copy(data)); return data; },
      async findFirst({ where }) { return copy(state.mappings.find(m => matches(m, where)) ?? null); },
    },
    customerStatusHistoryEntry: { async create({ data }) { assert.ok(tenantLocked); if (faults.history) throw new Error('Injected history failure'); state.histories.push(copy(data)); return data; } },
    customerSensitiveAccessAudit: { async create({ data }) { state.audits.push(copy(data)); return data; } },
    async $transaction(work) {
      calls.transactionStarts++; if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = undefined; hook(); }
      let release; const previous = queue; queue = new Promise(resolve => { release = resolve; }); await previous;
      const before = copy(state); tenantLocked = false; lockedIds = new Set();
      // Use client ownership, not a global lock flag: the previous commit's audit can
      // legitimately run while another transaction holds its own tenant fence.
      const tx = { ...db, customerSensitiveAccessAudit: { create: async () => { throw new Error('Sensitive access audit must use the original post-transaction client'); } } };
      try { return await work(tx); } catch (error) { state = { ...before, audits: state.audits }; calls.rollbacks++; throw error; }
      finally { tenantLocked = false; lockedIds = new Set(); release(); }
    },
  };
  const customers = new customerModule.SharedCustomerRepository(db), operations = new operationsModule.CustomerOperationsRepository(db, customers);
  const service = new CustomerMergeService(db, customers, operations), access = new EnterpriseAccessService(db);
  const policy = new EnterprisePolicyService(db, new commands.EnterpriseCommandService(db), access);
  const revalidate = (personalCustomerId, corporateCustomerId = 'company') => policy.revalidateQuote('t1', 'w2', {
    tenantId: 't1', membershipSnapshot: { personalCustomerId, enterpriseBasis: { noticeVersion: 'v1' } },
    request: { bookingIdentity: { bookingIdentity: 'enterprise_employee', corporateCustomerId, enterpriseContractAndPayer: true,
      enterpriseDisclosure: { noticeVersion: 'v1', acknowledged: true } } },
  }, db);
  const input = (source = 'a', target = 'survivor') => ({ sourceCustomerId: source, targetCustomerId: target, reason: 'Reviewed duplicate', approver: 'reviewer', fieldResolutions: { name: 'target' } });
  const enter = (id, corporate = 'company') => access.requireAction({ tenantId: 't1', tenantCode: 'merchant', customerId: id, customerType: 'personal', sessionId: `session-${id}` }, corporate, 'administrators:manage');
  const riskService = new CustomerOperationsService(db, customers, operations, service);
  const riskInput = { riskType: shared.CUSTOMER_RISK_TYPES[0], level: shared.CUSTOMER_RISK_LEVELS[0], detail: 'Reviewed original risk', scope: 'tenant' };
  const risk = (input = riskInput, workspaceId = 'w1', tenant = 't1', customer = 'a', user = { dataScope: 'all' }) =>
    riskService.createRiskRecord(tenant, workspaceId, customer, input, 'operator', user);
  return { state: () => state, calls, faults, service, input, enter, revalidate, addPerson, profile, relation, grant, risk, riskInput,
    setBeforeTransaction: fn => { beforeTransaction = fn; }, removePeerGrants: () => { state.grants = state.grants.filter(g => g.membershipId !== 'rb'); },
    merge: (source = 'a', target = 'survivor', tenant = 't1') => service.mergeCustomers(tenant, input(source, target), 'operator') };
}

function corporateFixture() {
  const f = fixture(); f.addPerson(f.profile('retained-company', 'corporate'));
  f.addPerson(f.profile('employee')); f.addPerson(f.profile('other-company', 'corporate'));
  f.addPerson(f.profile('company', 'corporate', 't2')); f.addPerson(f.profile('a', 'personal', 't2'));
  const target = f.relation('target-admin', 'survivor', 'retained-company');
  const other = f.relation('other-admin', 'a', 'other-company');
  const foreign = f.relation('foreign-admin', 'a', 'company', 't2');
  const employee = { ...f.relation('source-employee', 'employee'), role: 'employee', department: 'Original team', employeeNo: 'original-id' };
  f.state().relations.push(target, other, foreign, employee); [target, other, foreign].forEach(f.grant);
  for (const corporate of ['retained-company', 'other-company']) f.state().portals.push({ tenantId: 't1', corporateCustomerId: corporate, enabled: true });
  f.state().portals.push({ tenantId: 't2', corporateCustomerId: 'company', enabled: true });
  const policy = { workspaceIds: ['w2'], categoryCodes: ['vehicle'], personalPaymentAllowed: true, enterprisePaymentAllowed: true,
    approvalMode: 'per_order', approvalLifetimeMinutes: 30, noticeVersion: 'v1', noticeText: 'Original enterprise notice' };
  for (const corporate of ['company', 'retained-company', 'other-company']) {
    for (const scopeKey of ['merchant', 'company', ...f.state().relations.filter(r => r.tenantId === 't1' && r.corporateCustomerId === corporate).map(r => `member:${r.id}`)]) {
      const relation = f.state().relations.find(r => `member:${r.id}` === scopeKey);
      f.state().policies.push({ tenantId: 't1', corporateCustomerId: corporate, scopeKey, revision: 1, policy: copy(policy), membershipUpdatedAt: relation?.updatedAt ?? null });
    }
  }
  f.state().approvals = [{ id: 'original-approved', tenantId: 't1', corporateCustomerId: 'company', applicantCustomerId: 'employee', state: 'approved',
    reviewerMembershipId: 'ra', reviewerMembershipUpdatedAt: copy(f.state().relations[0].updatedAt) }];
  return f;
}

test('risk registration uses shared Tenant then the original customer gate before its FK insert, without widening scope', async () => {
  for (const scope of ['tenant', 'workspace']) {
    const f = fixture(), before = plain(f.state()); const result = await f.risk({ ...f.riskInput, scope });
    assert.equal(result.status, 'open'); assert.equal(result.customerId, 'a'); assert.equal(result.tenantId, 't1');
    assert.equal(result.workspaceId, scope === 'tenant' ? undefined : 'w1'); assert.equal(result.raisedBy, 'operator');
    assert.ok(f.calls.sequence[0].includes('FROM Tenant') && f.calls.sequence[0].includes('LOCK IN SHARE MODE'));
    assert.ok(f.calls.sequence[1].includes('FROM customer_profiles')); assert.equal(f.calls.sequence[2], 'risk-fk-insert');
    for (const key of ['profiles', 'accounts', 'memberships', 'relations', 'grants', 'orders', 'receipts']) assert.deepEqual(plain(f.state()[key]), before[key]);
  }
  const failed = fixture(), original = plain(failed.state()); failed.faults.risk = true;
  await assert.rejects(failed.risk(), /Injected risk failure/); assert.deepEqual(plain(failed.state()), original);
  const forbidden = fixture();
  await assert.rejects(forbidden.risk(forbidden.riskInput, 'w1', 't1', 'a', { dataScope: 'store' }), e => e.status === 403);
  await assert.rejects(forbidden.risk({ ...forbidden.riskInput, detail: ' ' }), e => e.status === 400);
  await assert.rejects(forbidden.risk(forbidden.riskInput, ''), e => e.status === 403);
  assert.equal(forbidden.calls.transactionStarts, 0);
  const missing = fixture(); missing.faults.tenantMissing = true;
  await assert.rejects(missing.risk(), e => e.status === 404); assert.equal(missing.calls.customerLocks.length, 0); assert.equal(missing.state().risks.length, 0);
});

test('last authorized source administrator cannot be merged; all original facts remain untouched', async () => {
  const f = fixture(); f.removePeerGrants(); const before = plain(f.state());
  await assert.rejects(f.merge(), e => e.status === 409 && /最后受权管理员/.test(e.message));
  assert.deepEqual(plain(f.state()), before); assert.equal(f.calls.marks, 0); assert.equal(f.calls.accountWrites, 0);
  assert.equal(f.calls.continuity, 1); assert.equal(f.calls.rollbacks, 1);
});

test('peer authority requires current grants, matching tenant/company/revision, active identity and effective admin relation', async () => {
  const cases = [
    ['no entry', f => { f.state().grants = f.state().grants.filter(g => g.membershipId !== 'rb' || g.action !== 'portal:enter'); }],
    ['no manage', f => { f.state().grants = f.state().grants.filter(g => g.membershipId !== 'rb' || g.action !== 'administrators:manage'); }],
    ['old revision', f => { f.state().relations[1].updatedAt = new ClockDate(now); }],
    ['foreign grant', f => { f.state().grants.filter(g => g.membershipId === 'rb').forEach(g => { g.tenantId = 't2'; }); }],
    ['other company grant', f => { f.state().grants.filter(g => g.membershipId === 'rb').forEach(g => { g.corporateCustomerId = 'other'; }); }],
    ['wrong membership grant', f => { f.state().grants.filter(g => g.membershipId === 'rb').forEach(g => { g.membershipId = 'other'; }); }],
    ['suspended account', f => { f.state().accounts[1].status = 'suspended'; }],
    ['suspended member', f => { f.state().memberships[1].status = 'suspended'; }],
    ['inactive profile', f => { f.state().profiles[1].status = 'suspended'; }],
    ['merged profile', f => { f.state().profiles[1].mergedIntoCustomerId = 'survivor2'; }],
    ['corporate profile', f => { f.state().profiles[1].customerType = 'corporate'; }],
    ['employee', f => { f.state().relations[1].role = 'employee'; }],
    ['suspended relation', f => { f.state().relations[1].status = 'suspended'; }],
    ['future relation', f => { f.state().relations[1].effectiveFrom = new ClockDate(now + 1); }],
    ['expired relation', f => { f.state().relations[1].effectiveTo = new ClockDate(now); }],
    ['other company relation', f => { f.state().relations[1].corporateCustomerId = 'other'; }],
    ['foreign relation', f => { f.state().relations[1].tenantId = 't2'; }],
    ['foreign account', f => { f.state().accounts[1].tenantId = 't2'; }],
    ['foreign membership', f => { f.state().memberships[1].tenantId = 't2'; }],
  ];
  for (const [label, alter] of cases) { const f = fixture(); alter(f); const before = plain(f.state());
    await assert.rejects(f.merge(), e => e.status === 409, label); assert.deepEqual(plain(f.state()), before, label); assert.equal(f.calls.marks, 0); }
});

test('remaining current administrator permits original merge without moving membership, grants, order subjects or receipts', async () => {
  const f = fixture(), before = plain(f.state()); const result = await f.merge();
  assert.equal(result.sourceCustomerId, 'a'); assert.equal(result.targetCustomerId, 'survivor');
  assert.equal(f.state().profiles[0].status, 'merged'); assert.equal(f.state().profiles[0].mergedIntoCustomerId, 'survivor');
  assert.equal(f.state().accounts[0].status, 'closed');
  for (const key of ['memberships', 'relations', 'grants', 'policies', 'orders', 'receipts', 'refunds']) assert.deepEqual(plain(f.state()[key]), before[key], key);
  assert.deepEqual(plain(f.state().profiles.slice(1)), before.profiles.slice(1));
  assert.equal(f.state().mappings.length, 1); assert.equal(f.state().histories.length, 3); assert.equal(f.state().audits.length, 1);
  assert.equal(f.state().mappings[0].membershipSnapshot.source.customerId, 'a');
  assert.equal(f.state().mappings[0].membershipSnapshot.target.customerId, 'survivor');
  assert.equal(f.state().mappings[0].membershipSnapshot.preservedReferences.find(r => r.kind === 'order_user_subject').count, 1);
  await f.enter('b'); await assert.rejects(f.enter('a'), e => e.status === 403); await assert.rejects(f.enter('survivor'), e => e.status === 403);
});

test('all source managed enterprises are checked, including disabled portal and policy-only migration; unrelated tenant markers do not opt in', async () => {
  for (const marker of ['disabled', 'policy-only']) {
    const f = fixture(), extra = f.relation('ra2', 'a', 'second'); f.state().relations.push(extra); f.grant(extra);
    if (marker === 'disabled') f.state().portals.push({ tenantId: 't1', corporateCustomerId: 'second', enabled: false });
    else f.state().policies.push({ tenantId: 't1', corporateCustomerId: 'second', scopeKey: 'merchant' });
    const before = plain(f.state()); await assert.rejects(f.merge(), e => e.status === 409); assert.deepEqual(plain(f.state()), before);
    assert.equal(f.calls.continuity, 2); assert.equal(f.calls.marks, 0);
  }
  const foreign = fixture(); foreign.removePeerGrants(); foreign.state().portals[0].tenantId = 't2';
  await foreign.merge(); assert.equal(foreign.calls.continuity, 0);
});

test('already inactive source authority, ordinary employee, unmigrated personal and corporate merges retain original semantics', async () => {
  const cases = [
    f => { f.state().accounts[0].status = 'suspended'; },
    f => { f.state().memberships[0].status = 'suspended'; },
    f => { f.state().profiles[0].status = 'suspended'; },
    f => { f.state().relations[0].role = 'employee'; },
    f => { f.state().relations[0].effectiveTo = new ClockDate(now); },
    f => { f.state().grants = f.state().grants.filter(g => g.membershipId !== 'ra'); },
    f => { f.state().portals = []; },
    f => { f.state().profiles[0].customerType = 'corporate'; f.state().profiles[2].customerType = 'corporate'; },
  ];
  for (const alter of cases) { const f = fixture(); f.removePeerGrants(); alter(f); const before = plain(f.state()); await f.merge();
    assert.equal(f.calls.continuity, 0); assert.equal(f.state().mappings.length, 1);
    for (const key of ['memberships', 'relations', 'grants', 'orders', 'receipts']) assert.deepEqual(plain(f.state()[key]), before[key]); }
});

test('Tenant then sorted customer gates precede locked source authority; revocation after outside preview still blocks', async () => {
  const f = fixture(); f.setBeforeTransaction(f.removePeerGrants); const before = plain(f.state());
  await assert.rejects(f.merge(), e => e.status === 409);
  assert.ok(f.calls.sequence[0].includes('FROM Tenant'));
  assert.deepEqual(f.calls.customerLocks, ['a', 'survivor']); assert.equal(f.calls.marks, 0);
  assert.deepEqual(plain(f.state().profiles), before.profiles); assert.equal(f.state().mappings.length, 0);
  const reversed = fixture(); await reversed.merge('b', 'a'); assert.deepEqual(reversed.calls.customerLocks, ['a', 'b']);
  // The survivor itself is a valid remaining administrator, but inherits no source grant.
  await reversed.enter('a'); await assert.rejects(reversed.enter('b'), e => e.status === 403);
});

test('mapping, account and history failures or mark CAS loser roll back the entire original merge', async () => {
  for (const fault of ['mapping', 'account', 'history', 'markZero']) {
    const f = fixture(), before = plain(f.state()); f.faults[fault] = true;
    await assert.rejects(f.merge(), fault === 'markZero' ? e => e.status === 409 : new RegExp(`Injected ${fault} failure`));
    assert.deepEqual(plain(f.state()), before); assert.equal(f.calls.rollbacks, 1);
  }
});

test('serialized competing source merges cannot remove both admins; invalid original inputs never write', async () => {
  const f = fixture(); const results = await Promise.allSettled([f.merge(), f.merge('b', 'survivor2')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  assert.equal(f.state().mappings.length, 1); assert.equal(f.calls.marks, 1); await f.enter('b');
  const snapshot = plain(f.state()); await assert.rejects(f.merge(), e => e.status === 409); assert.deepEqual(plain(f.state()), snapshot);
  const invalid = fixture(), before = plain(invalid.state());
  await assert.rejects(invalid.merge('a', 'a'), e => e.status === 409);
  await assert.rejects(invalid.merge('a', 'missing'), e => e.status === 404);
  await assert.rejects(invalid.merge('a', 'survivor', 't2'), e => e.status === 404);
  await assert.rejects(invalid.service.mergeCustomers('t1', { ...invalid.input(), reason: ' ' }), e => e.status === 400);
  invalid.faults.tenantMissing = true; await assert.rejects(invalid.merge(), e => e.status === 404);
  assert.deepEqual(plain(invalid.state()), before); assert.equal(invalid.calls.marks, 0); assert.equal(invalid.calls.continuity, 0);
});

test('corporate merge revokes only the original enterprise revisions and preserves the survivor and all business sources', async () => {
  const f = corporateFixture(); await f.enter('a'); await f.enter('survivor', 'retained-company');
  const sourceBasis = await f.revalidate('employee'), targetBasis = await f.revalidate('survivor', 'retained-company');
  assert.ok(sourceBasis && targetBasis); const before = plain(f.state());
  const result = await f.merge('company', 'retained-company');
  assert.equal(result.sourceCustomerId, 'company'); assert.equal(result.targetCustomerId, 'retained-company');
  assert.equal(f.calls.corporateInvalidations, 1); assert.equal(f.calls.continuity, 0);
  const merged = f.state().profiles.find(p => p.id === 'company' && p.tenantId === 't1');
  assert.equal(merged.status, 'merged'); assert.equal(merged.mergedIntoCustomerId, 'retained-company');
  for (const key of ['memberships', 'grants', 'policies', 'approvals', 'orders', 'receipts', 'refunds']) assert.deepEqual(plain(f.state()[key]), before[key], key);
  for (const r of f.state().relations) {
    const original = before.relations.find(p => p.id === r.id);
    if (r.tenantId === 't1' && r.corporateCustomerId === 'company') {
      assert.ok(+r.updatedAt > Date.parse(original.updatedAt));
      assert.deepEqual({ ...plain(r), updatedAt: original.updatedAt }, original, 'only the authority revision changes');
    } else assert.deepEqual(plain(r), original, 'no target/other/foreign relationship mutation');
  }
  for (const p of f.state().profiles.filter(p => p.id !== 'company' || p.tenantId !== 't1')) assert.deepEqual(plain(p), before.profiles.find(q => q.id === p.id && q.tenantId === p.tenantId));
  for (const a of f.state().accounts.filter(a => a.customerId !== 'company' || a.tenantId !== 't1')) assert.deepEqual(plain(a), before.accounts.find(q => q.id === a.id));
  assert.equal(f.state().mappings.length, 1); assert.equal(f.state().histories.length, 3); assert.equal(f.state().audits.length, 1);
  assert.equal(result.membershipSnapshot.preservedReferences.find(r => r.kind === 'order_contract_subject').count, 1);
  assert.equal(result.membershipSnapshot.preservedReferences.find(r => r.kind === 'order_payer_subject').count, 1);
  await assert.rejects(f.enter('a'), e => e.status === 403); await assert.rejects(f.revalidate('employee'), e => e.status === 403);
  await f.enter('a', 'other-company'); await f.enter('survivor', 'retained-company');
  assert.deepEqual(plain(await f.revalidate('survivor', 'retained-company')), plain(targetBasis));
  await assert.rejects(f.enter('a', 'retained-company'), e => e.status === 403);
  await assert.rejects(f.revalidate('employee', 'retained-company'), e => e.status === 403);
  // Diagnostic status restoration is not an API or recovery path. Even if a stale
  // external writer restores the master, old grants and member policies stay invalid.
  merged.status = 'active'; merged.mergedIntoCustomerId = null;
  await assert.rejects(f.enter('a'), e => e.status === 403);
  await assert.rejects(f.revalidate('employee'), e => e.status === 403 && /员工关系已变化/.test(e.message));
  assert.equal(f.state().approvals[0].reviewerMembershipUpdatedAt.toISOString(), before.approvals[0].reviewerMembershipUpdatedAt);
});

test('corporate merge uses durable disabled/policy-only migration markers but does not opt in foreign or unmigrated enterprises', async () => {
  for (const marker of ['disabled', 'policy-only', 'foreign-only', 'unmigrated']) {
    const f = corporateFixture();
    if (marker === 'disabled') f.state().portals.find(p => p.tenantId === 't1' && p.corporateCustomerId === 'company').enabled = false;
    if (marker !== 'disabled') f.state().portals = f.state().portals.filter(p => p.tenantId !== 't1' || p.corporateCustomerId !== 'company');
    if (marker === 'foreign-only' || marker === 'unmigrated') f.state().policies = f.state().policies.filter(p => p.corporateCustomerId !== 'company');
    if (marker === 'unmigrated') f.state().portals = f.state().portals.filter(p => p.corporateCustomerId !== 'company');
    const before = plain(f.state()); await f.merge('company', 'retained-company');
    assert.equal(f.calls.corporateInvalidations, 1);
    const optedIn = marker === 'disabled' || marker === 'policy-only';
    for (const row of f.state().relations) {
      const original = before.relations.find(r => r.id === row.id);
      if (optedIn && row.tenantId === 't1' && row.corporateCustomerId === 'company') assert.ok(+row.updatedAt > Date.parse(original.updatedAt), marker);
      else assert.deepEqual(plain(row), original, marker);
    }
    for (const key of ['memberships', 'grants', 'policies', 'approvals', 'orders', 'receipts', 'refunds']) assert.deepEqual(plain(f.state()[key]), before[key], marker);
  }
});

test('corporate merge advances every migrated relationship monotonically regardless of role/status/time and works without a corporate login', async () => {
  const f = corporateFixture(); f.state().accounts = f.state().accounts.filter(a => a.customerId !== 'company');
  const rows = [
    { ...f.relation('ended', 'survivor'), status: 'terminated', effectiveTo: new ClockDate(now - 1), updatedAt: new ClockDate(now + 1000) },
    { ...f.relation('pending', 'survivor2'), role: 'employee', status: 'pending', effectiveFrom: new ClockDate(now + 1000), updatedAt: new ClockDate(now) },
  ];
  f.state().relations.push(...rows); const before = plain(f.state()); await f.merge('company', 'retained-company');
  for (const r of f.state().relations.filter(r => r.tenantId === 't1' && r.corporateCustomerId === 'company')) {
    const original = before.relations.find(p => p.id === r.id); assert.ok(+r.updatedAt > Date.parse(original.updatedAt));
    assert.deepEqual({ ...plain(r), updatedAt: original.updatedAt }, original);
  }
  assert.equal(f.calls.accountWrites, 0); assert.equal(f.state().histories.length, 2);
  for (const key of ['accounts', 'memberships', 'grants', 'policies', 'orders', 'receipts', 'refunds']) assert.deepEqual(plain(f.state()[key]), before[key]);
});

test('corporate authority revocation and mapping/account/history writes roll back together; a CAS loser does not advance revisions', async () => {
  for (const fault of ['invalidate', 'mapping', 'account', 'history', 'markZero']) {
    const f = corporateFixture(), before = plain(f.state()); f.faults[fault] = true;
    await assert.rejects(f.merge('company', 'retained-company'), fault === 'markZero' ? e => e.status === 409 : new RegExp(`Injected ${fault} failure`));
    assert.deepEqual(plain(f.state()), before, fault); assert.equal(f.calls.rollbacks, 1);
    assert.equal(f.calls.corporateInvalidations, fault === 'markZero' ? 0 : 1);
  }
});

test('corporate merge serializes late grants and competing mappings under original Tenant/customer gates without inheriting source authority', async () => {
  const f = corporateFixture();
  f.setBeforeTransaction(() => { const r = f.relation('late-admin', 'survivor2'); f.state().relations.push(r); f.grant(r); });
  await f.merge('company', 'retained-company');
  assert.equal(f.calls.corporateInvalidations, 1);
  const late = f.state().relations.find(r => r.id === 'late-admin'); assert.ok(+late.updatedAt > now - 1000);
  await assert.rejects(f.enter('survivor2'), e => e.status === 403); await assert.rejects(f.enter('survivor2', 'retained-company'), e => e.status === 403);
  const corporateQueries = f.calls.sequence.filter(s => s.includes('FROM Tenant') || s.includes('FROM customer_profiles') && s.includes('FOR UPDATE') || s.startsWith('UPDATE customer_corporate_memberships'));
  assert.ok(corporateQueries[0].includes('FROM Tenant') && corporateQueries[0].includes('FOR UPDATE'));
  assert.deepEqual(f.calls.customerLocks, ['company', 'retained-company']); assert.ok(corporateQueries.at(-1).startsWith('UPDATE customer_corporate_memberships'));
  const concurrent = corporateFixture(); const results = await Promise.allSettled([
    concurrent.merge('company', 'retained-company'), concurrent.merge('company', 'other-company')
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.status === 409).length, 1);
  assert.equal(concurrent.state().mappings.length, 1); assert.equal(concurrent.calls.corporateInvalidations, 1);
  const after = plain(concurrent.state()); await assert.rejects(concurrent.merge('company', 'retained-company'), e => e.status === 409);
  assert.deepEqual(plain(concurrent.state()), after); assert.equal(concurrent.calls.corporateInvalidations, 1);
  const invalid = corporateFixture(); const before = plain(invalid.state());
  await assert.rejects(invalid.merge('company', 'missing'), e => e.status === 404);
  await assert.rejects(invalid.merge('company', 'retained-company', 't2'), e => e.status === 404);
  await assert.rejects(invalid.merge('company', 'a'), e => e.status === 409);
  assert.deepEqual(plain(invalid.state()), before); assert.equal(invalid.calls.corporateInvalidations, 0);
  const untrusted = corporateFixture();
  untrusted.setBeforeTransaction(() => { untrusted.state().profiles.filter(p => ['company', 'retained-company'].includes(p.id) && p.tenantId === 't1').forEach(p => { p.customerType = 'unknown'; }); });
  await assert.rejects(untrusted.merge('company', 'retained-company'), e => e.status === 409 && /主体类型/.test(e.message));
  assert.equal(untrusted.calls.marks, 0); assert.equal(untrusted.calls.corporateInvalidations, 0);
});
