'use strict';
// Real status services/repositories and enterprise current-authority consumers.
// SQL/model/transaction doubles prove local invalidation and rollback, not MySQL or HTTP.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const writeRoot = path.join(root, 'output/enterprise-offline/personal-status-revocation');
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
const Prisma = { sql: sqlTag, empty: sqlTag(['']), TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' } };
function load(relative, deps = {}) {
  const file = path.join(root, relative), exports = {};
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
  vm.runInNewContext(result.outputText, { exports, require: name => {
    if (name in deps) return deps[name];
    if (name.startsWith('node:')) return require(name);
    if (name === '@nestjs/common') return common;
    if (name === '@prisma/client') return { Prisma }; // No generated client or engine.
    if (name === './rental-category-code' && relative === 'packages/shared/src/core.ts') return load('packages/shared/src/rental-category-code.ts');
    throw new Error(`Unexpected runtime dependency: ${name}`);
  }, Date: ClockDate, Map, Set, JSON }, { filename: file });
  return exports;
}
const shared = { ...load('packages/shared/src/core.ts'), ...load('packages/shared/src/enterprise.ts') };
const identity = load('apps/api/src/common/request-identity.ts');
const commands = load('apps/api/src/modules/enterprise/enterprise-command.service.ts', { '../../common/request-identity': identity });
const customerModule = load('apps/api/src/modules/platform/shared-customer.repository.ts', { '../../common/request-identity': identity });
const operationsModule = load('apps/api/src/modules/platform/customer-operations.repository.ts', { './shared-customer.repository': customerModule });
const { CustomerOperationsService } = load('apps/api/src/modules/platform/customer-operations.service.ts', {
  '@rental-os/shared': shared, './shared-customer.repository': customerModule, './customer-operations.repository': operationsModule,
  '../../common/request-identity': identity,
  './customer-insights': load('apps/api/src/modules/platform/customer-insights.ts'),
});
const { EnterpriseAccessService } = load('apps/api/src/modules/client/enterprise-access.service.ts', { '@rental-os/shared': shared });
const fingerprints = load('apps/api/src/modules/rental-core/rental-idempotency.repository.ts', { './workspace-scope': {} });
const policyModule = load('apps/api/src/modules/enterprise/enterprise-policy.service.ts', {
  '@rental-os/shared': shared, '../../common/request-identity': identity, './enterprise-command.service': commands,
  '../rental-core/rental-idempotency.repository': fingerprints,
});
const approvalDeps = { '../../common/request-identity': identity, './enterprise-command.service': commands };
const { EnterpriseApprovalService } = load('apps/api/src/modules/enterprise/enterprise-approval.service.ts', approvalDeps);
const { EnterpriseExtensionApprovalService } = load('apps/api/src/modules/enterprise/enterprise-extension-approval.service.ts', {
  ...approvalDeps, '../rental-core/rental-idempotency.repository': fingerprints,
});
const copy = value => structuredClone(value), plain = value => JSON.parse(JSON.stringify(value));
function sqlParts(strings, ...values) {
  if (!Array.isArray(strings)) { values = strings.values; strings = strings.strings; }
  const sql = strings.map((s, i) => (i ? `$${i - 1}` : '') + s).join('').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  return { sql, values };
}
function fixture() {
  const person = (id, customerType = 'personal', tenantId = 't1') => ({ id, tenantId, customerType, status: 'active', mergedIntoCustomerId: null });
  const relation = (id, personalCustomerId, corporateCustomerId = 'company', tenantId = 't1') => ({ id, tenantId, personalCustomerId,
    corporateCustomerId, role: 'admin', status: 'active', department: 'Original', employeeNo: '1',
    effectiveFrom: new ClockDate(now - 10000), effectiveTo: null, updatedAt: new ClockDate(now) });
  const state = { profiles: [person('a'), person('b'), person('company', 'corporate'), person('a', 'personal', 't2'),
    person('second', 'corporate'), person('company', 'corporate', 't2')],
    accounts: [], memberships: [], relations: [relation('ra', 'a'), relation('rb', 'b'), relation('ra2', 'a', 'second'),
      relation('legacy', 'a', 'legacy'), relation('foreign', 'a', 'company', 't2'), relation('policy-only', 'a', 'policy-only'),
      relation('corporate-id', 'company'), relation('wrong-marker', 'a', 'wrong-marker')],
    portals: [{ tenantId: 't1', corporateCustomerId: 'company', enabled: true }, { tenantId: 't1', corporateCustomerId: 'second', enabled: false },
      { tenantId: 't2', corporateCustomerId: 'wrong-marker', enabled: true }], policies: [], grants: [], histories: [],
    receipts: [{ key: 'original-submit', orderId: 'order', result: 'consumed' }],
    orders: [{ id: 'order', customerId: 'a', corporateCustomerId: 'company', payer: 'company', workspaceId: 'w1', state: 'active' }] };
  for (const p of state.profiles) {
    state.accounts.push({ id: `account:${p.tenantId}:${p.id}`, tenantId: p.tenantId, customerId: p.id, status: 'active',
      loginPhone: 'test-only', loginPhoneMasked: '***', suspendedAt: null, closedAt: null, lastReason: null, lastOperator: null,
      createdAt: new ClockDate(now - 10000), updatedAt: new ClockDate(now - 1000) });
    state.memberships.push({ id: `membership:${p.tenantId}:${p.id}`, tenantId: p.tenantId, customerId: p.id, status: 'active', levelName: 'Member',
      createdAt: new ClockDate(now - 10000), updatedAt: new ClockDate(now - 1000) });
  }
  const policy = { workspaceIds: ['w1', 'w2'], categoryCodes: ['vehicle'], personalPaymentAllowed: true, enterprisePaymentAllowed: true,
    approvalMode: 'per_order', approvalLifetimeMinutes: 30, noticeVersion: 'v1', noticeText: 'Enterprise orders visible to company' };
  for (const scopeKey of ['merchant', 'company', 'member:ra', 'member:rb']) state.policies.push({ tenantId: 't1', corporateCustomerId: 'company',
    scopeKey, revision: 1, policy: copy(policy), membershipUpdatedAt: scopeKey.startsWith('member:') ? new ClockDate(now) : null });
  state.policies.push({ tenantId: 't1', corporateCustomerId: 'policy-only', scopeKey: 'merchant', revision: 1, policy: copy(policy) });
  for (const r of state.relations) for (const action of ['portal:enter', 'members:manage', 'administrators:manage', 'approvals:review', 'policy:manage']) {
    state.grants.push({ tenantId: r.tenantId, corporateCustomerId: r.corporateCustomerId, membershipId: r.id, membershipUpdatedAt: new ClockDate(now), action });
  }
  const calls = { sequence: [], invalidations: 0, histories: 0, rollbacks: 0, closability: 0, price: 0 };
  const faults = { invalidate: false, history: false, zero: false, close: false };
  let tenantLocked = false, customerLocked = false, queue = Promise.resolve();
  const profile = (id, tenantId = 't1') => state.profiles.find(p => p.id === id && p.tenantId === tenantId);
  const account = (id, tenantId = 't1') => state.accounts.find(p => p.customerId === id && p.tenantId === tenantId);
  const membership = (id, tenantId = 't1') => state.memberships.find(p => p.customerId === id && p.tenantId === tenantId);
  const eligible = (id, tenantId = 't1') => profile(id, tenantId)?.status === 'active' && !profile(id, tenantId)?.mergedIntoCustomerId
    && account(id, tenantId)?.status === 'active' && membership(id, tenantId)?.status === 'active';
  const corporateEligible = (id, tenantId = 't1') => profile(id, tenantId)?.customerType === 'corporate'
    && profile(id, tenantId)?.status === 'active' && !profile(id, tenantId)?.mergedIntoCustomerId && membership(id, tenantId)?.status === 'active';
  const currentGrants = r => state.grants.filter(g => g.tenantId === r.tenantId && g.corporateCustomerId === r.corporateCustomerId
    && g.membershipId === r.id && +g.membershipUpdatedAt === +r.updatedAt);
  const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
  const db = {
    async $queryRaw(strings, ...args) {
      const { sql, values } = sqlParts(strings, ...args); calls.sequence.push(sql);
      if (sql.includes('FROM Tenant')) { assert.ok(sql.includes('FOR UPDATE')); tenantLocked = true; return values[0] === 't1' ? [{ id: 't1' }] : []; }
      if (sql.includes('FROM customer_profiles') && sql.includes('FOR UPDATE')) {
        assert.ok(tenantLocked, 'Tenant lock must precede the original customer gate'); customerLocked = true;
        return profile(values[1], values[0]) ? [{ id: values[1] }] : [];
      }
      if (sql.includes('SELECT m.corporateCustomerId')) {
        assert.ok(sql.includes('g.membershipUpdatedAt=m.updatedAt') && sql.includes("corporateMember.status='active'") && sql.includes('c.mergedIntoCustomerId IS NULL'));
        return state.relations.filter(r => r.tenantId === values[2] && r.personalCustomerId === values[3] && eligible(r.personalCustomerId, r.tenantId) && corporateEligible(r.corporateCustomerId, r.tenantId))
          .flatMap(r => currentGrants(r).map(g => ({ corporateCustomerId: r.corporateCustomerId, corporateName: 'Company', membershipId: r.id,
            role: r.role, action: g.action, tenantRevision: 1, corporateRevision: 1, tenantEnabled: true,
            corporateEnabled: state.portals.some(p => p.tenantId === r.tenantId && p.corporateCustomerId === r.corporateCustomerId && p.enabled) })));
      }
      if (sql.includes('SELECT r.id,r.updatedAt')) {
        assert.ok(sql.includes("cm.status='active'") && sql.includes("c.customerType='corporate'") && sql.includes('c.mergedIntoCustomerId IS NULL'));
        const r = state.relations.find(r => r.tenantId === values[0] && r.corporateCustomerId === values[1] && r.personalCustomerId === values[2]);
        return r && eligible(r.personalCustomerId, r.tenantId) && corporateEligible(r.corporateCustomerId, r.tenantId) ? [{ id: r.id, updatedAt: r.updatedAt }] : [];
      }
      if (sql.includes('SELECT m.id FROM customer_corporate_memberships')) {
        assert.ok(sql.includes('m.updatedAt=$4') && sql.includes("g.action='approvals:review'") && sql.includes('g.membershipUpdatedAt=m.updatedAt'));
        const r = state.relations.find(r => r.tenantId === values[0] && r.corporateCustomerId === values[1] && r.personalCustomerId === values[2]
          && r.id === values[3] && +r.updatedAt === +values[4]);
        return r && eligible(r.personalCustomerId) && ['portal:enter', 'approvals:review'].every(a => currentGrants(r).some(g => g.action === a)) ? [{ id: r.id }] : [];
      }
      if (sql.includes('FROM enterprise_corporate_portals')) return state.portals.filter(p => p.tenantId === values[0] && p.corporateCustomerId === values[1]);
      if (sql.includes('FROM enterprise_portal_tenant_settings')) return [{ enabled: true }];
      if (sql.includes('FROM enterprise_scope_policies')) return copy(state.policies.filter(p => p.tenantId === values[0] && p.corporateCustomerId === values[1]));
      if (sql.includes('FROM business_workspaces')) return [{ categoryCode: 'VEHICLE' }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async $executeRaw(strings, ...args) {
      const { sql, values } = sqlParts(strings, ...args); calls.sequence.push(sql);
      assert.ok(tenantLocked && customerLocked, 'invalidation must join the original locked status transaction');
      const corporate = sql.includes("c.customerType='corporate'"), owner = corporate ? 'corporateCustomerId' : 'personalCustomerId';
      const ownerPredicates = corporate ? ['c.tenantId=m.tenantId', 'c.id=m.corporateCustomerId', "c.customerType='corporate'", 'm.corporateCustomerId=$1']
        : ['p.tenantId=m.tenantId', 'p.id=m.personalCustomerId', "p.customerType='personal'", 'm.personalCustomerId=$1'];
      for (const predicate of ['UPDATE customer_corporate_memberships m', ...ownerPredicates, 'm.tenantId=$0',
        'portal.tenantId=m.tenantId', 'portal.corporateCustomerId=m.corporateCustomerId', 'policy.tenantId=m.tenantId',
        'policy.corporateCustomerId=m.corporateCustomerId', 'GREATEST(NOW(3),TIMESTAMPADD(MICROSECOND,1000,m.updatedAt))']) assert.ok(sql.includes(predicate), predicate);
      assert.ok(!sql.includes('portal.enabled'), 'disabled migrated portals must still invalidate authority');
      assert.match(sql, /SET m\.updatedAt=[\s\S]+ WHERE/); assert.ok(!sql.includes('DELETE') && !sql.includes('INSERT'));
      if (corporate) assert.ok(!sql.includes('m.role=') && !sql.includes('m.status='), 'freeze must cover every role/status without mutating them');
      calls.invalidations++; if (faults.invalidate) throw new Error('Injected invalidation failure');
      let count = 0;
      for (const r of state.relations) if (r.tenantId === values[0] && r[owner] === values[1] && profile(values[1], values[0])?.customerType === (corporate ? 'corporate' : 'personal')
        && (state.portals.some(p => p.tenantId === r.tenantId && p.corporateCustomerId === r.corporateCustomerId)
          || state.policies.some(p => p.tenantId === r.tenantId && p.corporateCustomerId === r.corporateCustomerId))) {
        r.updatedAt = new ClockDate(Math.max(now, +r.updatedAt + 1)); count++;
      }
      return count;
    },
    customerProfile: { async findFirst({ where, select }) {
      assert.ok(tenantLocked && customerLocked, 'authority owner must come from the original locked master');
      assert.equal(select.customerType, true); return copy(state.profiles.find(r => matches(r, where)) ?? null);
    } },
    customerAccount: {
      async findFirst({ where }) { return copy(state.accounts.find(r => matches(r, where)) ?? null); },
      async updateMany({ where, data }) { assert.ok(customerLocked); calls.sequence.push('account-write'); if (faults.zero) return { count: 0 };
        const rows = state.accounts.filter(r => matches(r, where)); rows.forEach(r => Object.assign(r, copy(data))); return { count: rows.length }; },
    },
    customerMembership: {
      async findUnique({ where }) { return copy(state.memberships.find(r => matches(r, where.tenantId_customerId)) ?? null); },
      async updateMany({ where, data }) { assert.ok(customerLocked); calls.sequence.push('membership-write'); if (faults.zero) return { count: 0 };
        const rows = state.memberships.filter(r => matches(r, where)); rows.forEach(r => Object.assign(r, copy(data))); return { count: rows.length }; },
    },
    customerCorporateMembership: {
      async findUnique({ where }) { return copy(state.relations.find(r => matches(r, where.tenantId_corporateCustomerId_personalCustomerId)) ?? null); },
      async upsert({ where, update }) { assert.ok(tenantLocked && customerLocked);
        const row = state.relations.find(r => matches(r, where.tenantId_corporateCustomerId_personalCustomerId));
        assert.ok(row, 'this test only updates existing relations'); Object.assign(row, copy(update)); return copy(row); },
    },
    customerStatusHistoryEntry: { async create({ data }) { assert.ok(customerLocked); calls.histories++; calls.sequence.push('history-write');
      if (faults.history) throw new Error('Injected history failure'); state.histories.push(copy(data)); return data; } },
    async $transaction(work) {
      let release; const previous = queue; queue = new Promise(resolve => { release = resolve; }); await previous;
      const before = copy(state); tenantLocked = false; customerLocked = false;
      try { return await work(db); } catch (error) { Object.assign(state, before); calls.rollbacks++; throw error; }
      finally { tenantLocked = false; customerLocked = false; release(); }
    },
  };
  const customers = new customerModule.SharedCustomerRepository(db), operations = new operationsModule.CustomerOperationsRepository(db, customers);
  const closability = { async assertClosable() { calls.closability++; if (faults.close) return { closable: false, blockers: [{ message: 'Unresolved business' }] };
    return { closable: true, blockers: [], manualConfirmations: [{ message: 'Manual check' }] }; } };
  const api = new CustomerOperationsService(db, customers, operations, closability), access = new EnterpriseAccessService(db);
  const policies = new policyModule.EnterprisePolicyService(db, new commands.EnterpriseCommandService(db), access);
  const ctx = id => ({ tenantId: 't1', tenantCode: 'merchant', customerId: id, customerType: 'personal', sessionId: `session-${id}`, workspaceId: 'w1' });
  const as = (id, work) => identity.runWithRequestIdentity({ tenantId: 't1', userId: id, isSaasAdmin: false, workspaceId: 'w1' }, work);
  const bookingIdentity = { bookingIdentity: 'enterprise_employee', corporateCustomerId: 'company', enterpriseContractAndPayer: true,
    enterpriseDisclosure: { noticeVersion: 'v1', acknowledged: true } };
  const basis = async () => as('a', () => policies.authorize('t1', 'w1', 'a', bookingIdentity));
  const quote = { tenantId: 't1', id: 'quote', request: { bookingIdentity }, payableAmount: 10, currency: 'CNY',
    membershipSnapshot: { bookingIdentity: 'enterprise_employee', personalCustomerId: 'a', corporateCustomerId: 'company', corporateMembershipId: 'ra', enterpriseContractAndPayer: true } };
  const original = { corporateCustomerId: 'company', applicantCustomerId: 'a', workspaceId: 'w1', expiresAt: new ClockDate(now + 60000),
    quote, basis: null, approvedBy: 'b', reviewerMembershipId: 'rb', reviewerMembershipUpdatedAt: new ClockDate(now) };
  const booking = new EnterpriseApprovalService(db, {}, policies, access, {}, {}, {});
  const preview = { payableAmount: 10, currency: 'CNY' }, request = { newEndAt: '2026-11-05T12:00:00Z' };
  const order = { ...quote, id: 'order', updatedAt: 'original-order-revision' };
  const extensionRow = { ...original, orderId: 'order', expectedOrderUpdatedAt: order.updatedAt, request, preview,
    requestFingerprint: fingerprints.requestFingerprint({ orderId: 'order', extension: request, expectedOrderUpdatedAt: order.updatedAt }),
    previewFingerprint: fingerprints.requestFingerprint(preview) };
  const extension = new EnterpriseExtensionApprovalService(db, {}, policies, access, { lockOrderForUpdate: async () => copy(order) },
    { assertEnterpriseExtensionPrice: async () => { calls.price++; } }, {});
  const change = (scope, status, id = 'a', extra = {}) => api[scope === 'account' ? 'changeAccountStatus' : 'changeMembershipStatus']('t1', id,
    { status, reason: 'Explicit status decision', acknowledgedManualChecks: true, ...extra }, 'operator');
  return { state, calls, faults, db, api, customers, access, policies, basis, ctx, as, original, extensionRow,
    bookingCurrent: () => booking.current(original, 't1', db), extensionCurrent: () => extension.current(extensionRow, 't1', db), change };
}

test('account/member suspension invalidates all migrated personal relationships; restoration never rebinds old grants or policies', async () => {
  for (const scope of ['account', 'membership']) {
    const f = fixture(), before = plain(f.state), basis = await f.basis();
    f.original.basis = basis; f.original.quote.membershipSnapshot.enterpriseBasis = basis; f.extensionRow.basis = basis;
    await f.access.requireAction(f.ctx('a'), 'company', 'administrators:manage'); await f.bookingCurrent(); await f.extensionCurrent();
    const fenceStart = f.calls.sequence.length;
    await f.change(scope, 'suspended');
    await assert.rejects(f.access.requireAction(f.ctx('a'), 'company', 'administrators:manage'), e => e.status === 403);
    await assert.rejects(f.basis(), e => e.status === 403);
    await f.change(scope, 'active');
    await assert.rejects(f.access.requireAction(f.ctx('a'), 'company', 'administrators:manage'), e => e.status === 403);
    await assert.rejects(f.bookingCurrent(), e => e.status === 403);
    await assert.rejects(f.extensionCurrent(), e => e.status === 403);
    for (const id of ['ra', 'ra2', 'policy-only']) assert.equal(+f.state.relations.find(r => r.id === id).updatedAt, now + 1);
    for (const id of ['rb', 'legacy', 'foreign', 'corporate-id', 'wrong-marker']) assert.deepEqual(plain(f.state.relations.find(r => r.id === id)), before.relations.find(r => r.id === id));
    for (const key of ['grants', 'policies', 'orders', 'receipts']) assert.deepEqual(plain(f.state[key]), before[key]);
    assert.equal(f.calls.invalidations, 1); assert.equal(f.state.histories.length, 2);
    assert.ok(f.calls.sequence[fenceStart].includes('FROM Tenant')); assert.ok(f.calls.sequence[fenceStart + 1].includes('FROM customer_profiles'));
    assert.equal(f.state[scope === 'account' ? 'memberships' : 'accounts'][0].status, 'active');
  }
});

test('reviewer suspension invalidates old booking/extension approvals even after explicit current reauthorization', async () => {
  const f = fixture(), basis = await f.basis(); f.original.basis = basis; f.original.quote.membershipSnapshot.enterpriseBasis = basis; f.extensionRow.basis = basis;
  await f.change('membership', 'suspended', 'b'); await f.change('membership', 'active', 'b');
  await f.access.requireAction(f.ctx('a'), 'company', 'administrators:manage');
  for (const read of [f.bookingCurrent, f.extensionCurrent]) await assert.rejects(read(), e => e.status === 403);
  // Test setup for a separate explicit authorization: never an effect of restoration.
  const revision = f.state.relations.find(r => r.id === 'rb').updatedAt;
  for (const g of f.state.grants.filter(g => g.membershipId === 'rb')) g.membershipUpdatedAt = revision;
  await f.access.requireAction(f.ctx('b'), 'company', 'approvals:review');
  for (const read of [f.bookingCurrent, f.extensionCurrent]) await assert.rejects(read(), e => e.status === 403);
});

test('all restrictive status transitions revoke authority without blocking the last administrator safety freeze', async () => {
  for (const [scope, statuses] of [['account', ['suspended', 'closed']], ['membership', ['suspended', 'risk_restricted', 'exited', 'closed']]]) {
    for (const status of statuses) {
      const f = fixture(); f.state.grants = f.state.grants.filter(g => g.membershipId !== 'rb');
      assert.equal((await f.change(scope, status)).status, status); assert.equal(f.calls.invalidations, 1);
      assert.equal(f.state.histories[0].operator, 'operator'); assert.equal(f.state.histories[0].reason, 'Explicit status decision');
    }
  }
});

test('new explicit grant and employee policy authorization enables new work, never an old quote basis', async () => {
  const f = fixture(), originalBasis = await f.basis();
  await f.change('account', 'suspended'); await f.change('account', 'active');
  const revision = f.state.relations.find(r => r.id === 'ra').updatedAt;
  for (const g of f.state.grants.filter(g => g.membershipId === 'ra')) g.membershipUpdatedAt = revision;
  const policy = f.state.policies.find(p => p.scopeKey === 'member:ra'); policy.membershipUpdatedAt = revision; policy.revision++;
  await f.access.requireAction(f.ctx('a'), 'company', 'administrators:manage');
  const newBasis = await f.basis(); assert.equal(newBasis.membershipUpdatedAt, revision.toISOString());
  assert.throws(() => f.policies.assertSameBasis(originalBasis, newBasis), e => e.status === 409);
});

test('subsequent original relation edits cannot undo revocation in the same millisecond or after clock rollback', async () => {
  for (const offset of [0, 60000]) {
    const f = fixture(); f.state.relations[0].updatedAt = new ClockDate(now + offset);
    await f.change('account', 'suspended'); await f.change('account', 'active');
    const updated = await f.db.$transaction(async tx => {
      await f.api.lockCustomerStatusGate('t1', 'a', tx);
      return f.customers.saveEnterpriseRelation('t1', 'company', 'a', { role: 'admin', status: 'active',
        effectiveFrom: f.state.relations[0].effectiveFrom, department: 'Reviewed update', reason: 'Explicit edit', createdBy: 'operator' }, tx);
    });
    assert.equal(+updated.updatedAt, now + offset + 2);
    await assert.rejects(f.access.requireAction(f.ctx('a'), 'company', 'administrators:manage'), e => e.status === 403);
    await assert.rejects(f.basis(), e => e.status === 403);
  }
});

test('status, history and relationship revision roll back together on either write failure', async () => {
  for (const scope of ['account', 'membership']) for (const fault of ['invalidate', 'history']) {
    const f = fixture(), before = plain(f.state); f.faults[fault] = true;
    await assert.rejects(f.change(scope, 'suspended'), new RegExp(`Injected ${fault === 'invalidate' ? 'invalidation' : 'history'} failure`));
    assert.deepEqual(plain(f.state), before); assert.equal(f.calls.rollbacks, 1);
  }
});

test('CAS losers, invalid transitions, missing customer and original closure blockers do not invalidate authority', async () => {
  for (const scope of ['account', 'membership']) {
    const f = fixture(), before = plain(f.state); f.faults.zero = true;
    await assert.rejects(f.change(scope, 'suspended'), e => e.status === 409); assert.deepEqual(plain(f.state), before);
    assert.equal(f.calls.invalidations, 0); assert.equal(f.calls.histories, 0);
    await assert.rejects(f.change(scope, 'active'), e => e.status === 409);
    await assert.rejects(f.change(scope, 'suspended', 'missing'), e => e.status === 404);
    f.faults.zero = false; f.faults.close = true;
    await assert.rejects(f.change(scope, 'closed'), e => e.status === 409); assert.deepEqual(plain(f.state), before);
    assert.equal(f.calls.invalidations, 0);
  }
});

test('unmigrated corporate status preserves legacy relations; personal suspension/restore competitors never restore old revision', async () => {
  const corporate = fixture(), relations = plain(corporate.state.relations);
  corporate.state.portals = corporate.state.portals.filter(p => p.corporateCustomerId !== 'company');
  corporate.state.policies = corporate.state.policies.filter(p => p.corporateCustomerId !== 'company');
  await corporate.change('membership', 'suspended', 'company'); assert.deepEqual(plain(corporate.state.relations), relations);
  const f = fixture();
  const results = await Promise.allSettled([f.change('account', 'suspended'), f.change('account', 'active')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal(f.state.accounts[0].status, 'active'); assert.equal(+f.state.relations[0].updatedAt, now + 1);
  await assert.rejects(f.access.requireAction(f.ctx('a'), 'company', 'administrators:manage'), e => e.status === 403);
});

test('corporate membership suspension revokes the whole migrated enterprise; restoration never revives old authority or approvals', async () => {
  const f = fixture(); f.state.portals.find(p => p.corporateCustomerId === 'second').enabled = true;
  const before = plain(f.state), basis = await f.basis(); f.original.basis = basis;
  f.original.quote.membershipSnapshot.enterpriseBasis = basis; f.extensionRow.basis = basis;
  await f.access.requireAction(f.ctx('a'), 'company', 'administrators:manage'); await f.bookingCurrent(); await f.extensionCurrent();
  const start = f.calls.sequence.length;
  await f.change('membership', 'suspended', 'company', { customerType: 'personal' }); // Caller fields cannot select the authority owner.
  for (const id of ['a', 'b']) await assert.rejects(f.access.requireAction(f.ctx(id), 'company', 'administrators:manage'), e => e.status === 403);
  await assert.rejects(f.basis(), e => e.status === 403);
  await f.change('membership', 'active', 'company');
  for (const id of ['a', 'b']) await assert.rejects(f.access.requireAction(f.ctx(id), 'company', 'administrators:manage'), e => e.status === 403);
  for (const current of [f.bookingCurrent, f.extensionCurrent]) await assert.rejects(current(), e => e.status === 403);
  for (const r of f.state.relations) {
    const old = before.relations.find(x => x.id === r.id);
    if (r.tenantId === 't1' && r.corporateCustomerId === 'company') {
      assert.equal(+r.updatedAt, now + 1); assert.deepEqual(plain({ ...r, updatedAt: old.updatedAt }), old);
    } else assert.deepEqual(plain(r), old);
  }
  for (const key of ['profiles', 'accounts', 'grants', 'policies', 'orders', 'receipts']) assert.deepEqual(plain(f.state[key]), before[key]);
  await f.access.requireAction(f.ctx('a'), 'second', 'administrators:manage');
  assert.equal(f.calls.invalidations, 1); assert.equal(f.state.histories.length, 2);
  assert.ok(f.calls.sequence[start].includes('FROM Tenant') && f.calls.sequence[start + 1].includes('FROM customer_profiles'));
});

test('corporate restrictive transitions include every relationship role/status and closed-to-pending reopening never rebinds grants', async () => {
  for (const status of ['suspended', 'risk_restricted', 'exited', 'closed']) {
    const f = fixture(); f.state.relations[0].role = 'employee'; f.state.relations[1].status = 'exited';
    const before = plain(f.state); await f.change('membership', status, 'company');
    for (const r of f.state.relations.filter(r => r.tenantId === 't1' && r.corporateCustomerId === 'company')) {
      assert.equal(+r.updatedAt, now + 1); assert.equal(r.role, before.relations.find(x => x.id === r.id).role);
      assert.equal(r.status, before.relations.find(x => x.id === r.id).status);
    }
    for (const key of ['accounts', 'grants', 'policies', 'orders', 'receipts']) assert.deepEqual(plain(f.state[key]), before[key]);
    if (status === 'closed') {
      await assert.rejects(f.change('membership', 'active', 'company'), e => e.status === 409);
      await f.change('membership', 'pending_activation', 'company'); await f.change('membership', 'active', 'company');
      assert.equal(+f.state.relations[0].updatedAt, now + 2); assert.deepEqual(plain(f.state.grants), before.grants);
    }
    assert.equal(f.state.histories[0].operator, 'operator'); assert.equal(f.state.histories[0].reason, 'Explicit status decision');
  }
});

test('corporate migration is scoped by current tenant and company, including disabled portals or policy-only markers', async () => {
  for (const mode of ['disabled', 'policy-only', 'legacy', 'foreign-marker']) {
    const f = fixture();
    if (mode === 'disabled') f.state.portals.find(p => p.tenantId === 't1' && p.corporateCustomerId === 'company').enabled = false;
    if (mode !== 'disabled') f.state.portals = f.state.portals.filter(p => p.corporateCustomerId !== 'company');
    if (mode === 'legacy' || mode === 'foreign-marker') f.state.policies = f.state.policies.filter(p => p.corporateCustomerId !== 'company');
    if (mode === 'foreign-marker') f.state.portals.push({ tenantId: 't2', corporateCustomerId: 'company', enabled: true });
    const before = plain(f.state); await f.change('membership', 'suspended', 'company');
    for (const r of f.state.relations) {
      const shouldChange = ['disabled', 'policy-only'].includes(mode) && r.tenantId === 't1' && r.corporateCustomerId === 'company';
      if (shouldChange) assert.equal(+r.updatedAt, now + 1); else assert.deepEqual(plain(r), before.relations.find(x => x.id === r.id));
    }
  }
});

test('corporate status/history/authority fail atomically; CAS, closure checks and missing trusted master cannot revoke or bypass', async () => {
  for (const fault of ['invalidate', 'history', 'zero', 'close', 'master']) {
    const f = fixture(), before = plain(f.state);
    if (fault === 'master') f.db.customerProfile.findFirst = async () => null; else f.faults[fault] = true;
    const status = fault === 'close' ? 'closed' : 'suspended';
    await assert.rejects(f.change('membership', status, 'company'), e => fault === 'master' ? e.status === 404
      : ['zero', 'close'].includes(fault) ? e.status === 409 : /Injected/.test(e.message));
    assert.deepEqual(plain(f.state), before);
    if (['zero', 'close', 'master'].includes(fault)) assert.equal(f.calls.invalidations, 0);
  }
});

test('corporate account state is not enterprise membership authority; new explicit grants/policies do not resurrect old approvals', async () => {
  const account = fixture(), originalRelations = plain(account.state.relations);
  await account.change('account', 'suspended', 'company'); assert.deepEqual(plain(account.state.relations), originalRelations);
  await account.access.requireAction(account.ctx('a'), 'company', 'administrators:manage');
  const f = fixture(), oldBasis = await f.basis(); f.original.basis = oldBasis;
  f.original.quote.membershipSnapshot.enterpriseBasis = oldBasis; f.extensionRow.basis = oldBasis;
  await f.change('membership', 'suspended', 'company'); await f.change('membership', 'active', 'company');
  // Independent explicit reauthorization setup; never a consequence of status restoration.
  for (const r of f.state.relations.filter(r => r.tenantId === 't1' && r.corporateCustomerId === 'company')) {
    for (const g of f.state.grants.filter(g => g.tenantId === r.tenantId && g.corporateCustomerId === r.corporateCustomerId && g.membershipId === r.id)) g.membershipUpdatedAt = r.updatedAt;
    const policy = f.state.policies.find(p => p.corporateCustomerId === r.corporateCustomerId && p.scopeKey === `member:${r.id}`);
    if (policy) { policy.membershipUpdatedAt = r.updatedAt; policy.revision++; }
  }
  await f.access.requireAction(f.ctx('a'), 'company', 'administrators:manage');
  const newBasis = await f.basis(); assert.throws(() => f.policies.assertSameBasis(oldBasis, newBasis), e => e.status === 409);
  for (const current of [f.bookingCurrent, f.extensionCurrent]) await assert.rejects(current(), e => [403, 409].includes(e.status));
});
