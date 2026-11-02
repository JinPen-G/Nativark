'use strict';
// Behavioral tests execute the real services, command receipts, ALS and repository.
// The in-memory DB models tenant-lock serialization/rollback, not MySQL or external proof verification.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Prisma } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
assert.equal(process.env.DATABASE_URL, 'mysql://offline:offline@127.0.0.1:1/rental_os_offline');
assert.equal(path.resolve(process.env.AI_OFFLINE_WRITE_ROOT), path.join(root, 'output', 'enterprise-offline', 'workflows'));
let clock = Date.parse('2026-11-01T12:00:00Z');
class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
class HttpError extends Error {
  constructor(body, status) { super(typeof body === 'string' ? body : body.message); this.body = body; this.status = status; }
  getStatus() { return this.status; }
}
const common = { Injectable: () => value => value };
for (const [name, status] of [['BadRequestException', 400], ['ConflictException', 409], ['ForbiddenException', 403], ['NotFoundException', 404]]) common[name] = class extends HttpError { constructor(body) { super(body, status); } };
function load(relative, deps = {}) {
  const file = path.join(root, relative), exports = {};
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
  vm.runInNewContext(result.outputText, { exports, require: name => {
    if (name in deps) return deps[name];
    if (name.startsWith('node:')) return require(name);
    if (name === '@nestjs/common') return common;
    if (name === '@prisma/client') return { Prisma };
    throw new Error(`Unexpected runtime dependency: ${name}`);
  }, Date: ClockDate, Map, Set, JSON }, { filename: file });
  return exports;
}
const identity = load('apps/api/src/common/request-identity.ts');
const commandModule = load('apps/api/src/modules/enterprise/enterprise-command.service.ts', { '../../common/request-identity': identity });
const { EnterpriseCommandService, enterpriseHash } = commandModule;
const { SharedCustomerRepository } = load('apps/api/src/modules/platform/shared-customer.repository.ts', { '../../common/request-identity': identity });
const { EnterpriseAccessService } = load('apps/api/src/modules/client/enterprise-access.service.ts', { '@rental-os/shared': load('packages/shared/src/enterprise.ts') });
const { EnterpriseMembersService } = load('apps/api/src/modules/enterprise/enterprise-members.service.ts', { './enterprise-command.service': commandModule, '@rental-os/shared': load('packages/shared/src/enterprise.ts') });
const { EnterpriseApplicationService } = load('apps/api/src/modules/enterprise/enterprise-application.service.ts', { './enterprise-command.service': commandModule });
const { EnterpriseTaskCenterService } = load('apps/api/src/modules/enterprise/enterprise-task-center.service.ts');
const { EnterpriseManagementRequestService } = load('apps/api/src/modules/enterprise/enterprise-management-request.service.ts', { './enterprise-command.service': commandModule, '@rental-os/shared': require('../packages/shared/dist') });
const plain = value => JSON.parse(JSON.stringify(value));
const code = 'A'.repeat(43), otherCode = 'B'.repeat(43);
const context = id => ({ tenantId: 't1', tenantCode: 'merchant', customerId: id, customerType: 'personal', sessionId: `session-${id}`, membershipStatus: 'active' });
const user = { id: 'operator', tenantId: 't1', isActive: true, dataScope: 'all', permissions: ['rental-os:corporate:manage', 'rental-os:corporate:employee-manage'] };
const person = id => ({ id, tenantId: 't1', customerType: 'personal', status: 'active', mergedIntoCustomerId: null, name: id, phone: `phone-${id}`, account: { status: 'active' }, membership: { status: 'active' } });
const relation = (id, customerId, role = 'employee', corporate = 'company') => ({ id, tenantId: 't1', corporateCustomerId: corporate, personalCustomerId: customerId, role, status: 'active', effectiveFrom: new ClockDate(clock - 10000), effectiveTo: null, updatedAt: new ClockDate(clock - 1000), createdAt: new ClockDate(clock - 1000) });
const request = (id, kind, applicant, payload, state = 'pending', corporate = 'company') => ({ id, tenantId: 't1', kind, applicantCustomerId: applicant, corporateCustomerId: corporate, state, revision: 1, payload: JSON.stringify(payload), createdAt: new ClockDate(clock - 1000), updatedAt: new ClockDate(clock), decisionReason: null });
const application = extra => ({ legalName: 'Independent company', region: 'CN', legalIdentifier: '91310000MA1K123456', contactName: 'Representative', contactPhone: 'company-phone', authorityStatement: 'Authorized representative', evidenceFileIds: ['proof'], agreementVersion: 'v1', agreementAcknowledged: true, ...extra });
const change = (key, revision = 1, extra = {}) => ({ operationKey: key, expectedRevision: revision, reason: 'Explicit verified decision', ...extra });
const join = (key, inviteCode = code) => change(key, 0, { inviteCode, acknowledged: true, agreementVersion: 'v1', noticeHash: enterpriseHash({ agreementVersion: 'v1', noticeText: 'Merchant-approved enterprise invitation and visibility notice' }), department: 'Ops', employeeNo: '42' });
function match(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(condition => match(row, condition));
    if (key === 'AND') return value.every(condition => match(row, condition));
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('is' in value) return !!actual && match(actual, value.is);
      if ('in' in value && !value.in.includes(actual)) return false;
      if ('not' in value && actual === value.not) return false;
      if ('lte' in value && !(actual <= value.lte)) return false;
      if ('gt' in value && !(actual > value.gt)) return false;
      return true;
    }
    return actual === value || (actual instanceof Date && value instanceof Date && actual.getTime() === value.getTime());
  });
}
function sqlParts(strings, values) {
  if (!Array.isArray(strings)) { values = strings.values; strings = strings.strings; }
  let i = 0;
  const sql = strings.reduce((out, part, index) => out + (index ? `$${i++}` : '') + part, '').replace(/\s+/g, ' ');
  const bound = text => Object.fromEntries([...text.matchAll(/(?:\b\w+\.)?(\w+)=\$(\d+)/g)].map(m => [m[1], values[Number(m[2])]]));
  return { sql, values, bound };
}
function fixture() {
  clock = Date.parse('2026-11-01T12:00:00Z');
  const admin = relation('admin-r', 'admin', 'admin');
  let state = {
    tenants: [{ id: 't1', code: 'merchant', status: 'ACTIVE' }], tenantEnabled: true, corporateEnabled: true,
    profiles: [person('admin'), person('p1'), person('p2'), { id: 'company', tenantId: 't1', customerType: 'corporate', status: 'active', mergedIntoCustomerId: null, name: 'Company', corporateName: 'Independent company', updatedAt: new ClockDate(clock - 1000), phone: 'existing-company-phone', membership: { status: 'active' }, corporateProfile: { unifiedSocialCreditCode: '91310000MA1K123456', unifiedSocialCreditCodeMasked: '913****3456', legalName: 'Independent company', updatedAt: new ClockDate(clock - 1000) } }],
    sessions: ['admin', 'p1', 'p2'].map(id => ({ id: `session-${id}`, customerId: id, tenantId: 't1', revokedAt: null, expiresAt: new ClockDate(clock + 3600000) })),
    relations: [admin], grants: ['portal:enter', 'members:read', 'members:manage', 'administrators:manage', 'invites:manage'].map(action => ({ tenantId: 't1', corporateCustomerId: 'company', membershipId: admin.id, action, membershipUpdatedAt: admin.updatedAt })),
    invitePolicy: { maxLifetimeHours: 24, maxUses: 10, guessesPerWindow: 100, windowSeconds: 600, agreementVersion: 'v1', noticeText: 'Merchant-approved enterprise invitation and visibility notice' },
    invites: [{ id: 'invite', tenantId: 't1', corporateCustomerId: 'company', tokenHash: enterpriseHash(code), status: 'active', revision: 1, expiresAt: new ClockDate(clock + 3600000), maxUses: 1, used: 0, createdAt: new ClockDate(clock) }],
    workflows: [], receipts: [], rates: [], reviews: [], corporateProfiles: [],
    files: [{ id: 'proof', tenantId: 't1', businessType: 'customer', businessId: 'p1', uploadedBy: 'p1', uploadScene: 'enterprise-authority', status: 'active', storageProvider: 'oss' }],
  };
  const fault = { sql: '', model: '', dropTargetGrant: false }, counts = { commits: 0, rollbacks: 0, writes: 0, locks: 0 };
  const profileById = id => state.profiles.find(row => row.id === id);
  const hydrated = row => ({ ...row, personalCustomer: profileById(row.personalCustomerId) });
  const eligible = row => row && row.status === 'active' && !row.mergedIntoCustomerId && row.membership?.status === 'active' && (row.customerType === 'corporate' || row.account?.status === 'active');
  const effective = row => row.status === 'active' && row.effectiveFrom <= new ClockDate() && (!row.effectiveTo || row.effectiveTo > new ClockDate());
  const copy = value => structuredClone(value);
  const db = {
    $queryRaw: async (strings, ...values) => {
      const { sql, bound } = sqlParts(strings, values), filters = bound(sql);
      if (sql.includes('FROM Tenant')) { counts.locks++; return copy(state.tenants.filter(r => match(r, { id: filters.id, status: 'ACTIVE' }))); }
      if (sql.includes('FROM customer_profiles p')) {
        const p = profileById(filters.id), session = state.sessions.find(s => s.id === values[0] && s.customerId === p?.id && s.tenantId === filters.tenantId && !s.revokedAt && s.expiresAt > new ClockDate());
        return p?.tenantId === filters.tenantId && p.customerType === 'personal' && p.status === 'active' && !p.mergedIntoCustomerId && p.account?.status === 'active' && session && !['exited', 'closed'].includes(p.membership?.status) && (values.at(-1) || p.membership?.status === 'active') ? [{ id: p.id }] : [];
      }
      if (sql.includes("manage.action='administrators:manage'")) {
        return state.relations.filter(row => row.tenantId === values[0] && row.corporateCustomerId === values[1] && row.id !== values[2]
          && row.role === 'admin' && effective(row) && eligible(profileById(row.personalCustomerId))
          && ['portal:enter', 'administrators:manage'].every(action => state.grants.some(g => g.membershipId === row.id && g.action === action && +g.membershipUpdatedAt === +row.updatedAt))).map(row => ({ id: row.id }));
      }
      if (sql.includes('FROM customer_corporate_memberships m')) {
        const rows = [];
        for (const r of state.relations) {
          const p = profileById(r.personalCustomerId), c = profileById(r.corporateCustomerId);
          const session = state.sessions.find(s => s.id === values[1] && s.customerId === p?.id && s.tenantId === r.tenantId && !s.revokedAt && s.expiresAt > new ClockDate());
          if (r.tenantId !== filters.tenantId || r.personalCustomerId !== filters.personalCustomerId || values[0] !== 'merchant' || !effective(r) || !eligible(p) || !eligible(c) || !session) continue;
          const grants = state.grants.filter(g => g.membershipId === r.id && g.tenantId === r.tenantId && g.corporateCustomerId === r.corporateCustomerId && +g.membershipUpdatedAt === +r.updatedAt);
          for (const g of grants.length ? grants : [{ action: null }]) rows.push({ corporateCustomerId: c.id, corporateName: c.name, membershipId: r.id, role: r.role, action: g.action, tenantRevision: 1, corporateRevision: 1, tenantEnabled: state.tenantEnabled, corporateEnabled: state.corporateEnabled });
        }
        return copy(rows);
      }
      if (sql.includes('FROM customer_profiles WHERE')) return [{ id: filters.id }];
      if (sql.includes('FROM customer_corporate_profiles WHERE') || sql.includes('FROM customer_corporate_credits WHERE')) return [{ id: 'original-source' }];
      if (sql.includes('FROM enterprise_portal_operations')) return copy(state.receipts.filter(r => match(r, filters)));
      if (sql.includes('FROM enterprise_scope_policies')) return [{ revision: 1 }];
      if (sql.includes('FROM enterprise_invite_policies')) return state.invitePolicy ? [{ revision: 1, policy: copy(state.invitePolicy) }] : [];
      if (sql.includes('FROM client_api_rate_buckets')) return copy(state.rates.filter(r => r.scopeKey === filters.scopeKey && +r.bucketStart === +filters.bucketStart));
      if (sql.includes('FROM enterprise_invites i')) {
        const invite = state.invites.find(row => row.tenantId === values[0] && row.tokenHash === values[1] && row.status === 'active' && row.expiresAt > new ClockDate());
        const company = invite && profileById(invite.corporateCustomerId);
        return invite && eligible(company) && state.tenantEnabled && state.corporateEnabled ? [{ corporateName: company.corporateName, expiresAt: invite.expiresAt }] : [];
      }
      if (sql.includes('FROM enterprise_invites')) return copy(state.invites.filter(r => match(r, filters)));
      if (sql.includes('FROM enterprise_workflow_requests')) {
        let rows = state.workflows.filter(r => match(r, filters));
        const kind = sql.match(/kind='([^']+)'/), status = sql.match(/state='([^']+)'/);
        if (kind) rows = rows.filter(r => r.kind === kind[1]);
        if (status) rows = rows.filter(r => r.state === status[1]);
        if (sql.includes("kind IN ('join_request','administrator_transfer')")) rows = rows.filter(r => ['join_request', 'administrator_transfer'].includes(r.kind));
        if (sql.includes("state IN ('draft','pending','supplement_required')")) rows = rows.filter(r => ['draft', 'pending', 'supplement_required'].includes(r.state));
        if (sql.includes("JSON_EXTRACT(payload,'$.inviteId')")) rows = rows.filter(r => JSON.parse(r.payload).inviteId === values.at(-1));
        if (sql.includes("JSON_EXTRACT(payload,'$.requestType')")) rows = rows.filter(r => ['profile_change', 'scope_change'].includes(JSON.parse(r.payload).requestType));
        if (sql.includes('LIMIT 201')) rows = rows.slice(0, 201);
        return copy(rows);
      }
      if (sql.includes('FROM enterprise_portal_tenant_settings')) return [{ enabled: state.tenantEnabled }];
      if (sql.includes('FROM enterprise_portal_grants')) return copy(state.corporateEnabled ? state.grants.filter(g => g.tenantId === filters.tenantId && g.corporateCustomerId === filters.corporateCustomerId && g.membershipId === filters.membershipId && +g.membershipUpdatedAt === +filters.membershipUpdatedAt) : []);
      if (sql.includes('FROM enterprise_corporate_portals')) return state.tenantEnabled && state.corporateEnabled && eligible(profileById(filters.corporateCustomerId)) ? [{ id: filters.corporateCustomerId, revision: 1 }] : [];
      throw new Error(`Unhandled read: ${sql}`);
    },
    $executeRaw: async (strings, ...values) => {
      const { sql, bound } = sqlParts(strings, values); counts.writes++;
      if (fault.sql && sql.includes(fault.sql)) throw new Error('Injected storage failure');
      if (sql.startsWith('INSERT')) {
        const [, table, columns, raw] = sql.match(/INSERT INTO (\w+) \(([^)]+)\) VALUES \((.*?)\)(?: ON|$)/);
        const tokens = raw.split(',').map(s => s.trim());
        const row = Object.fromEntries(columns.split(',').map((s, i) => [s.trim(), /^\$\d+$/.test(tokens[i]) ? values[Number(tokens[i].slice(1))] : tokens[i] === 'true' ? true : tokens[i]?.startsWith("'") ? tokens[i].slice(1, -1) : /^\d+$/.test(tokens[i]) ? Number(tokens[i]) : new ClockDate()]));
        if (table === 'client_api_rate_buckets') {
          const current = state.rates.find(r => r.scopeKey === row.scopeKey && +r.bucketStart === +row.bucketStart);
          if (current) current.count++; else state.rates.push(row);
        } else if (table === 'enterprise_workflow_requests') state.workflows.push({ revision: 1, corporateCustomerId: null, decisionReason: null, createdAt: new ClockDate(), updatedAt: new ClockDate(), ...row });
        else if (table === 'enterprise_invites') state.invites.push({ revision: 1, status: 'active', used: 0, createdAt: new ClockDate(), ...row });
        else if (table === 'enterprise_portal_operations') state.receipts.push({ createdAt: new ClockDate(), ...row });
        else if (table === 'enterprise_portal_grants') { if (!fault.dropTargetGrant || row.membershipId === 'admin-r') state.grants.push(row); }
        else if (table === 'enterprise_corporate_portals') state.corporateEnabled = true;
        else if (table === 'enterprise_invite_policies') state.invitePolicy = JSON.parse(row.policy);
        else throw new Error(`Unhandled insert: ${sql}`);
        return 1;
      }
      const filters = bound(sql.split(' WHERE ')[1] ?? '');
      if (sql.startsWith('UPDATE enterprise_invites')) {
        const rows = state.invites.filter(r => match(r, filters));
        for (const row of rows) {
          if (sql.includes("status='revoked'")) { row.status = 'revoked'; row.revision++; }
          if (sql.includes('used=used+1')) row.used++;
          if (sql.includes('used=GREATEST')) row.used = Math.max(0, row.used - 1);
        }
        return rows.length;
      }
      if (sql.startsWith('UPDATE enterprise_workflow_requests')) {
        const pendingOnly = sql.includes("AND state='pending'");
        const rows = state.workflows.filter(r => match(r, filters) && (!pendingOnly || r.state === 'pending'));
        const assignments = bound(sql.split(' SET ')[1].split(' WHERE ')[0]);
        for (const row of rows) {
          Object.assign(row, assignments);
          const literal = sql.match(/SET state='([^']+)'/); if (literal) row.state = literal[1];
          if (sql.includes('revision=revision+1')) row.revision++;
          row.updatedAt = new ClockDate();
        }
        return rows.length;
      }
      if (sql.startsWith('DELETE FROM enterprise_portal_grants')) { state.grants = state.grants.filter(r => !match(r, filters)); return 1; }
      if (sql.startsWith('UPDATE enterprise_corporate_portals')) return 1;
      throw new Error(`Unhandled write: ${sql}`);
    },
    customerProfile: {
      findFirst: async ({ where }) => copy(state.profiles.find(r => match(r, where)) ?? null),
      create: async ({ data }) => {
        if (fault.model === 'profile-unique' || state.profiles.some(p => p.tenantId === data.tenantId && p.phone === data.phone)) throw new Prisma.PrismaClientKnownRequestError('sensitive phone-owner metadata', { code: 'P2002', clientVersion: 'test', meta: { target: ['tenantId', 'phone'] } });
        const row = { id: `new-company-${state.profiles.length}`, status: 'active', ...data }; state.profiles.push(row); return copy(row);
      },
    },
    customerCorporateProfile: {
      findFirst: async ({ where }) => copy(state.corporateProfiles.find(r => match(r, where)) ?? null),
      upsert: async ({ create }) => { state.corporateProfiles.push(create); return copy(create); },
    },
    customerCorporateCredit: { findFirst: async () => ({ revision: 1 }) },
    customerMembership: { create: async ({ data }) => { const row = { status: 'active', ...data }; profileById(data.customerId).membership = row; return copy(row); } },
    customerMembershipReview: {
      create: async ({ data }) => { const row = { id: `review-${state.reviews.length}`, ...data }; state.reviews.push(row); return copy(row); },
      update: async ({ where, data }) => { if (fault.model === 'review-update') throw new Error('Injected review failure'); const row = state.reviews.find(r => match(r, where)); Object.assign(row, data); return copy(row); },
    },
    customerCorporateMembership: {
      findMany: async ({ where, take }) => copy(state.relations.filter(row => match(row, where)).slice(0, take).map(row => ({ ...row, corporateCustomer: profileById(row.corporateCustomerId) }))),
      findUnique: async ({ where }) => copy(state.relations.find(r => match(r, where.tenantId_corporateCustomerId_personalCustomerId)) ?? null),
      findFirst: async ({ where }) => copy(state.relations.find(r => match(hydrated(r), where)) ?? null),
      count: async ({ where }) => state.relations.filter(r => match(hydrated(r), where)).length,
      upsert: async ({ where, create, update }) => {
        let row = state.relations.find(r => match(r, where.tenantId_corporateCustomerId_personalCustomerId));
        if (row) Object.assign(row, update); else { row = { id: `relation-${state.relations.length}`, updatedAt: new ClockDate(), createdAt: new ClockDate(), ...create }; state.relations.push(row); }
        return copy(row);
      },
    },
    clientChannelProfile: { findUnique: async () => ({ userAgreementVersion: 'v1', userAgreementBody: 'Real agreement' }) },
    fileAsset: { findMany: async ({ where }) => copy(state.files.filter(r => match(r, where))) },
  };
  let queue = Promise.resolve();
  db.$transaction = fn => {
    const result = queue.then(async () => {
      const before = copy(state); clock += 10;
      try { const value = await fn(db); counts.commits++; return value; }
      catch (error) { state = before; counts.rollbacks++; throw error; }
    });
    queue = result.catch(() => {}); return result;
  };
  const commands = new EnterpriseCommandService(db), customers = new SharedCustomerRepository(db), access = new EnterpriseAccessService(db);
  return {
    get state() { return state; }, db, fault, counts, customers, commands,
    members: new EnterpriseMembersService(db, commands, access, customers), apps: new EnterpriseApplicationService(db, customers, commands),
    as: (id, fn) => identity.runWithRequestIdentity({ tenantId: 't1', userId: id, ...(id === 'operator' ? { dataScope: 'all' } : {}) }, fn),
  };
}
const rejectsStatus = (promise, status, text) => assert.rejects(promise, error => error.getStatus?.() === status && (!text || error.message.includes(text)));

test('join normal, duplicate, full and original-key replay; guesses persist independently of refusals', async () => {
  const f = fixture(), input = join('join-first');
  const first = await f.as('p1', () => f.members.join(context('p1'), input));
  assert.equal(first.state, 'pending'); assert.equal(f.state.invites[0].used, 1);
  assert.deepEqual(plain(await f.as('p1', () => f.members.join(context('p1'), input))), plain(first));
  assert.equal((await f.as('p1', () => f.members.join(context('p1'), join('new-key')))).id, first.id);
  const secondInstance = new EnterpriseMembersService(f.db, f.commands, new EnterpriseAccessService(f.db), f.customers);
  await rejectsStatus(f.as('p2', () => secondInstance.join(context('p2'), join('full'))), 403);
  assert.equal(f.state.workflows.length, 1); assert.equal(f.state.invites[0].used, 1);
  await rejectsStatus(f.as('p1', () => f.members.join(context('p1'), { ...input, department: 'Changed' })), 409);
  await rejectsStatus(f.as('p1', () => f.members.join(context('p1'), join('invalid', otherCode))), 403);
  assert.equal(f.state.rates.reduce((sum, r) => sum + r.count, 0), 6);
  assert.equal(JSON.stringify(f.state.receipts).includes(code), false);
  assert.ok(f.counts.locks >= 5);
  const concurrent = fixture();
  const contenders = await Promise.allSettled(['p1', 'p2'].map(id => concurrent.as(id, () => concurrent.members.join(context(id), join(`concurrent-${id}`)))));
  assert.equal(contenders.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(contenders.filter(r => r.status === 'rejected').length, 1);
  assert.equal(concurrent.state.invites[0].used, 1); assert.equal(concurrent.state.workflows.length, 1);
  const g = fixture(); g.state.invitePolicy = null;
  await rejectsStatus(g.as('p1', () => g.members.join(context('p1'), input)), 409, '尚未配置');
  assert.equal(g.state.rates.length, 0);
  const h = fixture(); h.state.invitePolicy.guessesPerWindow = 1;
  await rejectsStatus(h.as('p1', () => h.members.join(context('p1'), join('guess', otherCode))), 403);
  await rejectsStatus(h.as('p1', () => h.members.join(context('p1'), join('limited'))), 403, '尝试');
  assert.equal(h.state.rates[0].count, 2); assert.equal(h.state.workflows.length, 0);
  const creator = fixture(), create = change('create-invite', 0, { lifetimeHours: 1, maxUses: 1 });
  const invitation = await creator.as('admin', () => creator.members.createInvite(context('admin'), 'company', create));
  assert.match(invitation.code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(creator.state.receipts).includes(invitation.code), false);
  assert.equal((await creator.as('admin', () => creator.members.createInvite(context('admin'), 'company', create))).code, undefined);
  assert.equal(creator.state.invites.length, 2);
});

test('active effective relations read at maxUses; suspended/exited/expired relations never revive without review', async () => {
  for (const state of ['active', 'suspended', 'exited', 'expired']) {
    const f = fixture(), member = relation('r1', 'p1');
    if (state === 'expired') member.effectiveTo = new ClockDate(clock - 1); else member.status = state;
    f.state.relations.push(member); f.state.invites[0].used = 1;
    if (state === 'active') assert.equal((await f.as('p1', () => f.members.join(context('p1'), join(state)))).membershipId, 'r1');
    else await rejectsStatus(f.as('p1', () => f.members.join(context('p1'), join(state))), 403);
    assert.equal(f.state.relations[1].status, member.status); assert.equal(f.state.invites[0].used, 1);
  }
  const f = fixture(), old = relation('exited-r', 'p1'); old.status = 'exited'; old.effectiveTo = new ClockDate(clock - 1); f.state.relations.push(old);
  const result = await f.as('p1', () => f.members.join(context('p1'), join('reapply')));
  assert.equal(f.state.relations[1].status, 'exited');
  f.state.profiles[1].membership.status = 'pending';
  await rejectsStatus(f.as('admin', () => f.members.decideJoin(context('admin'), 'company', result.id, change('review-blocked', 1, { decision: 'approve' }))), 409);
  assert.equal(f.state.workflows[0].state, 'pending');
  f.state.profiles[1].membership.status = 'active';
  await f.as('admin', () => f.members.decideJoin(context('admin'), 'company', result.id, change('review', 1, { decision: 'approve' })));
  assert.equal(f.state.relations[1].id, 'exited-r'); assert.equal(f.state.relations[1].role, 'employee'); assert.equal(f.state.relations[1].effectiveTo, null);
  assert.equal(f.state.grants.some(g => g.membershipId === 'exited-r'), false);
  const expired = fixture(), historical = relation('expired-r', 'p1');
  historical.effectiveTo = new ClockDate(clock - 1); expired.state.relations.push(historical);
  const fresh = await expired.as('p1', () => expired.members.join(context('p1'), join('expired-reapply')));
  assert.equal(fresh.state, 'pending'); assert.equal(expired.state.relations[1].effectiveTo.getTime(), historical.effectiveTo.getTime());
  await expired.as('admin', () => expired.members.decideJoin(context('admin'), 'company', fresh.id, change('expired-approve', 1, { decision: 'approve' })));
  assert.equal(expired.state.relations[1].effectiveTo, null);
});

test('revoke and expiry create terminal local facts exactly once; approved members and unrelated requests remain', async () => {
  const f = fixture(), first = await f.as('p1', () => f.members.join(context('p1'), join('join')));
  f.state.workflows.push(request('approved', 'join_request', 'p2', { inviteId: 'invite' }, 'approved'));
  f.state.workflows.push(request('unrelated', 'join_request', 'p2', { inviteId: 'another' }));
  f.state.invites[0].used = 2;
  const revoke = change('revoke');
  await f.as('admin', () => f.members.revokeInvite(context('admin'), 'company', 'invite', revoke));
  assert.equal(f.state.workflows[0].state, 'rejected'); assert.equal(f.state.workflows[0].revision, 2); assert.equal(f.state.invites[0].used, 1);
  assert.equal(JSON.parse(f.state.workflows[0].payload).decisionHistory[0].source, 'invite.revoke');
  assert.equal(f.state.workflows[1].state, 'approved'); assert.equal(f.state.workflows[2].state, 'pending');
  await f.as('admin', () => f.members.revokeInvite(context('admin'), 'company', 'invite', revoke));
  assert.equal(f.state.invites[0].used, 1);
  await rejectsStatus(f.as('admin', () => f.members.decideJoin(context('admin'), 'company', first.id, change('late', 2, { decision: 'approve' }))), 409);
  for (const entry of ['read', 'join', 'review']) {
    const g = fixture(), pending = await g.as('p1', () => g.members.join(context('p1'), join('first')));
    g.state.invites[0].expiresAt = new ClockDate(clock - 1);
    if (entry === 'read') assert.equal((await g.as('p1', () => g.members.joinRequests(context('p1'))))[0].state, 'rejected');
    if (entry === 'join') await rejectsStatus(g.as('p2', () => g.members.join(context('p2'), join('expired'))), 403);
    if (entry === 'review') assert.equal((await g.as('admin', () => g.members.decideJoin(context('admin'), 'company', pending.id, change('expired-review', 1, { decision: 'approve' })))).state, 'rejected');
    assert.equal(g.state.workflows[0].state, 'rejected'); assert.equal(g.state.invites[0].used, 0);
    const history = JSON.parse(g.state.workflows[0].payload).decisionHistory;
    assert.equal(history.length, 1); assert.ok(g.state.workflows[0].decisionReason.includes('到期'));
    await g.as('p1', () => g.members.joinRequests(context('p1'))); assert.equal(g.state.invites[0].used, 0);
  }
});

test('terminal transition/counter/receipt are one transaction; rejection and withdrawal free uses once', async () => {
  const f = fixture(); await f.as('p1', () => f.members.join(context('p1'), join('first')));
  f.fault.sql = 'UPDATE enterprise_invites SET used=GREATEST';
  await assert.rejects(f.as('admin', () => f.members.revokeInvite(context('admin'), 'company', 'invite', change('fail'))), /Injected/);
  assert.equal(f.state.invites[0].status, 'active'); assert.equal(f.state.invites[0].used, 1); assert.equal(f.state.workflows[0].state, 'pending');
  assert.equal(f.state.receipts.some(r => r.operationKey === 'fail'), false); assert.equal(f.counts.rollbacks, 1);
  f.fault.sql = '';
  const id = f.state.workflows[0].id, withdraw = change('withdraw');
  await f.as('p1', () => f.members.withdrawJoin(context('p1'), id, withdraw));
  await f.as('p1', () => f.members.withdrawJoin(context('p1'), id, withdraw));
  assert.equal(f.state.invites[0].used, 0); assert.equal(f.state.workflows[0].state, 'withdrawn');
  const next = await f.as('p2', () => f.members.join(context('p2'), join('next')));
  await f.as('admin', () => f.members.decideJoin(context('admin'), 'company', next.id, change('reject', 1, { decision: 'reject' })));
  assert.equal(f.state.invites[0].used, 0);
  const g = fixture(); g.fault.sql = 'INSERT INTO enterprise_portal_operations';
  await assert.rejects(g.as('p1', () => g.members.join(context('p1'), join('receipt-fail'))), /Injected/);
  assert.equal(g.state.workflows.length, 0); assert.equal(g.state.invites[0].used, 0); assert.equal(g.state.rates[0].count, 1);
});

test('task center derives durable own facts and action-specific queues; receipts remain private', async () => {
  const f = fixture(); f.state.workflows.push(request('own-app', 'corporate_application', 'admin', application(), 'supplement_required', null));
  await f.as('p1', () => f.members.join(context('p1'), join('queue-join')));
  let approvalsRead = 0;
  const approvals = { list: async () => { approvalsRead++; return []; } };
  let extensionQueueReads = 0;
  const service = new EnterpriseTaskCenterService(f.db, f.commands, f.apps, f.members, approvals, new EnterpriseAccessService(f.db), { mine: async () => [{ id: 'own-management', corporateCustomerId: 'company', state: 'supplement_required', revision: 2, createdAt: new ClockDate().toISOString() }] }, { list: async (_context, corporateId) => {
    if (corporateId) { extensionQueueReads++; return [{ id: 'extension-review', state: 'pending', revision: 1, corporateCustomerId: 'company', applicantCustomerId: 'p1' }, { id: 'extension-self', state: 'pending', revision: 1, corporateCustomerId: 'company', applicantCustomerId: 'admin' }]; }
    return [{ id: 'extension-own', state: 'approved', revision: 2, corporateCustomerId: 'company', expiresAt: '2099-01-01T00:00:00Z' }];
  } });
  const tasks = await f.as('admin', () => service.tasks(context('admin'), 'company'));
  assert.equal(tasks.items.some(row => row.id === 'own-app' && row.requiresAction), true);
  assert.equal(tasks.items.some(row => row.id === 'extension-own' && row.kind === 'extension_approval' && row.page === 'extension-approvals' && row.requiresAction), true);
  assert.equal(tasks.items.some(row => row.kind === 'join_request' && row.page === 'join-requests'), true);
  assert.equal(approvalsRead, 1, 'no review queue without approvals:review');
  assert.equal(extensionQueueReads, 0, 'no extension queue without exact review action');
  assert.equal(tasks.items.some(row => row.id === 'own-management' && row.kind === 'management_request' && row.page === 'profile' && row.requiresAction), true);
  assert.deepEqual(plain(tasks.unavailable), ['order_alerts', 'financial_alerts', 'external_notifications']);
  assert.equal(JSON.stringify(tasks).includes(code), false); assert.equal(JSON.stringify(tasks).includes('contactPhone'), false);
  await rejectsStatus(f.as('p2', () => service.tasks(context('p2'), 'company')), 403);
  const audit = await f.as('p1', () => service.ownAudit(context('p1')));
  assert.equal(audit.length, 1); assert.equal(audit[0].operationKey, 'queue-join'); assert.equal(audit[0].actor, 'p1');
  assert.equal(JSON.stringify(audit).includes(code), false);
  const readsBeforeRestricted = approvalsRead;
  const restrictedTasks = await f.as('p1', () => service.tasks({ ...context('p1'), membershipStatus: 'suspended' }));
  assert.equal(approvalsRead, readsBeforeRestricted + 1, 'own original approvals are re-read, not omitted by cached restricted status');
  assert.equal(restrictedTasks.items.some(row => row.kind === 'join_request'), true);
  f.state.grants.push({ ...f.state.grants[0], action: 'approvals:review' });
  const reviewTasks = await f.as('admin', () => service.tasks(context('admin'), 'company'));
  assert.equal(extensionQueueReads, 1); assert.equal(reviewTasks.items.some(row => row.id === 'extension-review' && row.requiresAction && row.page === 'extension-approvals'), true);
  assert.equal(reviewTasks.items.some(row => row.id === 'extension-self'), false, 'task queue does not invite self approval');
});

test('invitation preview projects merchant-approved details only and charges invalid guesses without admission', async () => {
  const f = fixture(); const preview = await f.as('p1', () => f.members.previewInvite(context('p1'), code));
  assert.equal(preview.corporateName, 'Independent company'); assert.equal(preview.noticeText, f.state.invitePolicy.noticeText);
  assert.equal(preview.semantics, 'join_request_only'); assert.equal(f.state.invites[0].used, 0); assert.equal(f.state.workflows.length, 0);
  assert.equal(JSON.stringify(preview).includes(code), false); assert.equal('corporateCustomerId' in preview, false);
  await rejectsStatus(f.as('p1', () => f.members.previewInvite(context('p1'), otherCode)), 403);
  assert.equal(f.state.rates[0].count, 2);
  f.state.invites[0].expiresAt = new ClockDate(clock - 1);
  await rejectsStatus(f.as('p1', () => f.members.previewInvite(context('p1'), code)), 403);
  f.state.invitePolicy.noticeText = undefined;
  await rejectsStatus(f.as('p1', () => f.members.previewInvite(context('p1'), code)), 409);
  assert.equal(f.state.invites[0].used, 0);
});

test('management proposals keep drafts, revisions and original receipts; review never changes master, credit, policy or ledger', async () => {
  const f = fixture(), access = new EnterpriseAccessService(f.db), api = new EnterpriseManagementRequestService(f.db, f.commands, access);
  f.state.grants.push({ ...f.state.grants[0], action: 'requests:manage' });
  const profile = await f.as('admin', () => api.profile(context('admin'), 'company'));
  assert.equal(profile.legalIdentifierMasked, '913****3456'); assert.equal(JSON.stringify(profile).includes('91310000MA1K123456'), false);
  const originalProfile = plain(f.state.profiles.at(-1));
  const input = change('profile-proposal', 0, { requestType: 'profile_change', objectRevision: profile.profileRevision, proposal: { legalName: 'Proposed new legal name' }, evidenceFileIds: [], submit: true });
  const created = await f.as('admin', () => api.save(context('admin'), 'company', input));
  assert.equal(created.state, 'pending'); assert.equal(created.effect, 'review_only_no_business_change');
  await f.as('admin', () => api.save(context('admin'), 'company', input)); assert.equal(f.state.workflows.length, 1);
  await rejectsStatus(f.as('admin', () => api.save(context('admin'), 'company', { ...input, operationKey: 'duplicate-profile' })), 409);
  await rejectsStatus(f.as('p1', () => api.save(context('p1'), 'company', { ...input, operationKey: 'employee-forbidden' })), 403);
  await rejectsStatus(f.as('admin', () => api.save(context('admin'), 'company', { ...input, operationKey: 'illegal-field', proposal: { creditLimit: '100000' } })), 400);
  const reviewed = await f.as('operator', () => api.review(user, created.id, change('review-proposal', 1, { decision: 'approve' })));
  assert.equal(reviewed.effect, 'review_only_no_business_change'); assert.deepEqual(plain(f.state.profiles.at(-1)), originalProfile);
  assert.equal(f.state.workflows[0].state, 'approved');
  await f.as('operator', () => api.review(user, created.id, change('review-proposal', 1, { decision: 'approve' })));
  await rejectsStatus(f.as('p1', () => api.withdraw(context('p1'), created.id, change('not-owner', 2))), 404);
  assert.equal((await f.as('p1', () => api.mine(context('p1')))).length, 0);
});
test('management request evidence and original object revision reject foreign files and stale review without business writes', async () => {
  const f = fixture(), api = new EnterpriseManagementRequestService(f.db, f.commands, new EnterpriseAccessService(f.db));
  f.state.grants.push({ ...f.state.grants[0], action: 'requests:manage' });
  const profile = await f.as('admin', () => api.profile(context('admin'), 'company'));
  const input = change('evidence-proposal', 0, { requestType: 'profile_change', objectRevision: profile.profileRevision, proposal: { legalName: 'Proposed' }, evidenceFileIds: ['proof'], submit: true });
  await rejectsStatus(f.as('admin', () => api.save(context('admin'), 'company', input)), 403, '材料');
  f.state.files.push({ ...f.state.files[0], id: 'admin-proof', businessId: 'admin', uploadedBy: 'admin' });
  const created = await f.as('admin', () => api.save(context('admin'), 'company', { ...input, operationKey: 'own-evidence', evidenceFileIds: ['admin-proof'] }));
  const before = await f.as('operator', () => api.evidenceOwner(user, created.id, 'admin-proof'));
  assert.equal(before.applicantCustomerId, 'admin');
  await rejectsStatus(f.as('operator', () => api.evidenceOwner(user, created.id, 'proof')), 403);
  f.state.profiles.at(-1).updatedAt = new ClockDate(clock + 1000);
  await rejectsStatus(f.as('operator', () => api.review(user, created.id, change('stale-original', 1, { decision: 'approve' }))), 409);
  assert.equal(f.state.workflows[0].state, 'pending');
  const tasks = new EnterpriseTaskCenterService(f.db, f.commands, f.apps, f.members, { list: async () => [] }, new EnterpriseAccessService(f.db), api, { list: async () => [] });
  const mine = await f.as('admin', () => tasks.tasks(context('admin')));
  assert.equal(mine.items.some(row => row.id === created.id && row.page === 'profile'), true);
});

test('actual Nest ValidationPipe management DTOs preserve valid proposals without treating optional undefined fields as foreign business writes', async () => {
  require('reflect-metadata');
  const { ValidationPipe } = require('@nestjs/common');
  // Nest/class-validator use instanceof Object for nested DTOs. Execute the real
  // DTO in this realm; VM constructors would manufacture a host-only validation error.
  const Module = require('node:module'), file = path.join(root, 'apps/api/src/modules/enterprise/enterprise-request.dto.ts');
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
  const dtoModule = new Module(file, module); dtoModule.filename = file; dtoModule.paths = Module._nodeModulePaths(path.dirname(file)); dtoModule._compile(compiled.outputText, file);
  const dto = dtoModule.exports;
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  for (const [requestType, proposal] of [['profile_change', { legalName: 'Proposed legal name' }], ['credit_change', { requestedCreditLimit: '250.50', currency: 'CNY' }], ['scope_change', { workspaceIds: ['workspace'], categoryCodes: ['vehicle'] }]]) {
    const f = fixture(), api = new EnterpriseManagementRequestService(f.db, f.commands, new EnterpriseAccessService(f.db));
    f.state.grants.push({ ...f.state.grants[0], action: 'requests:manage' });
    const profile = await f.as('admin', () => api.profile(context('admin'), 'company'));
    const objectRevision = requestType === 'profile_change' ? profile.profileRevision : String(requestType === 'credit_change' ? profile.creditRevision : profile.merchantPolicyRevision);
    const transformed = await pipe.transform(change(`pipe-${requestType}`, 0, { requestType, objectRevision, proposal, evidenceFileIds: [], submit: true }), { type: 'body', metatype: dto.SaveEnterpriseManagementRequestDto });
    const before = plain(f.state.profiles), created = await f.as('admin', () => api.save(context('admin'), 'company', transformed));
    assert.equal(created.state, 'pending'); assert.deepEqual(plain(f.state.profiles), before);
    const stored = (await f.as('admin', () => api.mine(context('admin'))))[0]; assert.deepEqual(plain(stored.proposal), proposal);
    const workflow = load('apps/api/src/modules/enterprise/enterprise-workflow-schemas.ts');
    assert.ok(Object.keys(plain(created)).every(key => key in workflow.ENTERPRISE_WORKFLOW_SCHEMAS.EnterpriseCommandResult.properties), 'public management result uses its formal whitelist');
    const invalid = await pipe.transform(change(`pipe-foreign-${requestType}`, 0, { requestType, objectRevision, proposal: { ...proposal, ...(requestType === 'profile_change' ? { currency: 'CNY' } : { legalName: 'Not this request type' }) }, evidenceFileIds: [], submit: true }), { type: 'body', metatype: dto.SaveEnterpriseManagementRequestDto });
    await rejectsStatus(f.as('admin', () => api.save(context('admin'), 'company', invalid)), 400, '其他业务字段');
  }
});
test('credit proposals require original CNY revision and merchant financial authority; supplement and withdrawal keep business unchanged', async () => {
  const f = fixture(), api = new EnterpriseManagementRequestService(f.db, f.commands, new EnterpriseAccessService(f.db));
  f.state.grants.push({ ...f.state.grants[0], action: 'requests:manage' });
  const input = change('credit-proposal', 0, { requestType: 'credit_change', objectRevision: '1', proposal: { requestedCreditLimit: '1200.50', currency: 'CNY' }, evidenceFileIds: [], submit: true });
  await rejectsStatus(f.as('admin', () => api.save(context('admin'), 'company', { ...input, operationKey: 'wrong-currency', proposal: { ...input.proposal, currency: 'USD' } })), 400);
  const created = await f.as('admin', () => api.save(context('admin'), 'company', input));
  assert.equal((await f.as('operator', () => api.merchantList(user))).length, 0, 'nonfinancial merchant cannot read credit proposals');
  await rejectsStatus(f.as('operator', () => api.review(user, created.id, change('credit-unauthorized', 1, { decision: 'approve' }))), 403);
  const finance = { ...user, permissions: [...user.permissions, 'rental-os:finance:manage'] };
  assert.equal((await f.as('operator', () => api.merchantList(finance))).length, 1);
  await f.as('operator', () => api.review(finance, created.id, change('credit-supplement', 1, { decision: 'supplement' })));
  const edited = await f.as('admin', () => api.save(context('admin'), 'company', { ...input, operationKey: 'credit-edit', requestId: created.id, expectedRevision: 2, submit: false }));
  assert.equal(edited.state, 'draft'); await f.as('admin', () => api.withdraw(context('admin'), created.id, change('credit-withdraw', 3)));
  assert.equal(f.state.workflows[0].state, 'withdrawn'); assert.equal(f.state.reviews.length, 0); assert.equal(f.state.corporateProfiles.length, 0);
});

test('invitation consent binds the exact notice, rejects same-version edits and cannot reuse an old pending acknowledgement', async () => {
  const f = fixture(), previous = plain(f.state.invitePolicy);
  const save = policy => f.as('operator', () => f.members.savePolicy(user, change('notice-save', 1, { policy })));
  await rejectsStatus(save({ ...previous, noticeText: 'Changed merchant notice' }), 409);
  assert.deepEqual(plain(f.state.invitePolicy), previous);
  const joined = await f.as('p1', () => f.members.join(context('p1'), join('old-notice-join')));
  assert.equal(JSON.parse(f.state.workflows[0].payload).noticeText, previous.noticeText);
  f.state.invitePolicy.noticeText = 'A different current notice';
  await rejectsStatus(f.as('admin', () => f.members.decideJoin(context('admin'), 'company', joined.id, change('old-notice-review', 1, { decision: 'approve' }))), 409);
  assert.equal(f.state.relations.some(row => row.personalCustomerId === 'p1'), false);
  await rejectsStatus(f.as('p2', () => f.members.join(context('p2'), join('stale-preview-join'))), 409);
  assert.equal(f.state.workflows.length, 1); assert.equal(f.state.invites[0].used, 1);
});

test('own relationship reader and explicit exit remain customer-only; restricted membership does not extend new company authority', async () => {
  const f = fixture(); f.state.relations.push(relation('own-r', 'p1'));
  const relations = await f.as('p1', () => f.members.ownRelations(context('p1')));
  assert.equal(relations.length, 1); assert.equal(relations[0].membershipId, 'own-r');
  assert.equal(JSON.stringify(relations).includes('phone-'), false);
  f.state.profiles[1].membership.status = 'suspended';
  await f.as('p1', () => f.members.changeMember(context('p1'), 'company', 'own-r', change('own-exit', 0, {
    status: 'exited', expectedUpdatedAt: f.state.relations[1].updatedAt.toISOString() }), true));
  assert.equal(f.state.relations[1].status, 'exited'); assert.equal(f.state.relations[0].role, 'admin');
  assert.equal(f.state.profiles[1].membership.status, 'suspended');
  await rejectsStatus(f.as('p2', () => f.members.changeMember(context('p2'), 'company', 'own-r', change('foreign-exit', 0, {
    status: 'exited', expectedUpdatedAt: f.state.relations[1].updatedAt.toISOString() }), true)), 404);
});

test('explicit administrator promotion, narrowing and last-authorized-admin protection share original receipts', async () => {
  const f = fixture(); f.state.relations.push(relation('target-r', 'p1'));
  const expected = f.state.relations[1].updatedAt.toISOString();
  const promotion = change('promote', 1, { role: 'admin', actions: ['portal:enter', 'members:manage'], expectedUpdatedAt: expected });
  await rejectsStatus(f.as('admin', () => f.members.changeAdministrator(context('admin'), 'company', 'target-r', { ...promotion, actions: ['portal:enter', 'finance:read'] })), 403);
  await rejectsStatus(f.as('p1', () => f.members.changeAdministrator(context('p1'), 'company', 'target-r', promotion)), 403);
  await f.as('admin', () => f.members.changeAdministrator(context('admin'), 'company', 'target-r', promotion));
  assert.equal(f.state.relations[1].role, 'admin');
  assert.ok(f.state.grants.some(g => g.membershipId === 'target-r' && g.action === 'members:manage' && +g.membershipUpdatedAt === +f.state.relations[1].updatedAt));
  const writes = f.counts.writes;
  await f.as('admin', () => f.members.changeAdministrator(context('admin'), 'company', 'target-r', promotion));
  assert.equal(f.counts.writes, writes, 'original key replays without promoting or regranting again');
  const last = change('last-revoke', 1, { role: 'employee', actions: [], expectedUpdatedAt: f.state.relations[0].updatedAt.toISOString() });
  await rejectsStatus(f.as('admin', () => f.members.changeAdministrator(context('admin'), 'company', 'admin-r', last)), 409, '最后受权管理员');
  f.fault.sql = 'INSERT INTO enterprise_portal_grants';
  const before = plain(f.state.relations[1]);
  await assert.rejects(f.as('admin', () => f.members.changeAdministrator(context('admin'), 'company', 'target-r', change('failed-grant', 1, {
    role: 'admin', actions: ['portal:enter', 'administrators:manage'], expectedUpdatedAt: f.state.relations[1].updatedAt.toISOString() }))), /Injected/);
  assert.deepEqual(plain(f.state.relations[1]), before);
  assert.equal(f.state.receipts.some(r => r.operationKey === 'failed-grant'), false);
});

test('last admin future expiry/exit fail; accepted transfer proves current target and grants, with rollback', async () => {
  const f = fixture(), original = structuredClone(f.state.relations[0]);
  for (const extra of [{ status: 'exited' }, { status: 'active', effectiveTo: new ClockDate(clock + 3600000).toISOString() }]) await rejectsStatus(f.as('admin', () => f.members.changeMember(context('admin'), 'company', 'admin-r', change(`change-${extra.status}`, 0, { expectedUpdatedAt: original.updatedAt.toISOString(), ...extra }), extra.status === 'exited')), 409, '最后管理员');
  assert.deepEqual(f.state.relations[0], original);
  f.state.relations.push(relation('target-r', 'p1'));
  const transfer = await f.as('admin', () => f.members.transfer(context('admin'), 'company', change('transfer', 0, { targetMembershipId: 'target-r' })));
  const accept = change('accept', 1, { accept: true });
  for (const [select, field, value] of [[() => f.state.relations[1], 'effectiveTo', new ClockDate(clock - 1)], [() => f.state.profiles[1].account, 'status', 'suspended'], [() => f.state.profiles[0].membership, 'status', 'pending']]) {
    const old = select()[field]; select()[field] = value;
    await assert.rejects(f.as('p1', () => f.members.acceptTransfer(context('p1'), transfer.id, accept)));
    // Rollback replaces the snapshot, so restore through a fresh selector, not a stale object.
    select()[field] = old;
  }
  f.state.profiles[1].account.status = 'active'; f.state.profiles[0].membership.status = 'active';
  f.state.tenantEnabled = false;
  await rejectsStatus(f.as('p1', () => f.members.acceptTransfer(context('p1'), transfer.id, accept)), 403);
  f.state.tenantEnabled = true; f.fault.dropTargetGrant = true;
  await rejectsStatus(f.as('p1', () => f.members.acceptTransfer(context('p1'), transfer.id, accept)), 403);
  assert.equal(f.state.relations[0].role, 'admin'); assert.equal(f.state.relations[1].role, 'employee'); assert.equal(f.state.workflows[0].state, 'pending');
  f.fault.dropTargetGrant = false;
  assert.equal((await f.as('p1', () => f.members.acceptTransfer(context('p1'), transfer.id, accept))).state, 'approved');
  assert.equal(f.state.relations[0].role, 'employee'); assert.equal(f.state.relations[1].role, 'admin');
  assert.ok(f.state.grants.some(g => g.membershipId === 'target-r' && g.action === 'administrators:manage' && +g.membershipUpdatedAt === +f.state.relations[1].updatedAt));
  const writes = f.counts.writes; await f.as('p1', () => f.members.acceptTransfer(context('p1'), transfer.id, accept)); assert.equal(f.counts.writes, writes);
  const restricted = fixture(); restricted.state.relations.push(relation('other-admin', 'p1', 'admin'));
  restricted.state.grants = restricted.state.grants.filter(g => g.action !== 'administrators:manage');
  await rejectsStatus(restricted.as('admin', () => restricted.members.changeMember(context('admin'), 'company', 'other-admin', change('restricted', 0, { status: 'suspended', expectedUpdatedAt: restricted.state.relations[1].updatedAt.toISOString() }))), 403);
  assert.equal(restricted.state.relations[1].status, 'active');
});

test('private application draft/pending dedup, consent stamped by server, revision/supplement/replay', async () => {
  const f = fixture(); const app = application({ agreementAcknowledgedAt: '1900-01-01T00:00:00Z' });
  await rejectsStatus(f.as('p1', () => f.apps.save(context('p1'), change('no-consent', 0, { application: application({ agreementAcknowledged: false }), submit: true }))), 400);
  const input = change('save-draft', 0, { application: app, submit: false });
  const draft = await f.as('p1', () => f.apps.save(context('p1'), input));
  assert.equal(JSON.parse(f.state.workflows[0].payload).agreementAcknowledgedAt, undefined);
  assert.equal((await f.as('p1', () => f.apps.save(context('p1'), { ...input, operationKey: 'duplicate' }))).id, draft.id);
  await rejectsStatus(f.as('p1', () => f.apps.save(context('p1'), { ...input, operationKey: 'changed', application: application({ contactName: 'Different' }) })), 409);
  const submit = change('submit', 1, { requestId: draft.id, application: app, submit: true });
  const pending = await f.as('p1', () => f.apps.save(context('p1'), submit));
  assert.equal(pending.revision, 2); assert.equal(f.state.workflows.length, 1);
  assert.equal(new Date(JSON.parse(f.state.workflows[0].payload).agreementAcknowledgedAt).getUTCFullYear(), 2026);
  await f.as('operator', () => f.apps.review(user, pending.id, change('supplement', 2, { decision: 'supplement', verifiedRepresentative: false })));
  assert.deepEqual(plain(await f.as('p1', () => f.apps.save(context('p1'), submit))), plain(pending));
  await rejectsStatus(f.as('p1', () => f.apps.save(context('p1'), { ...submit, operationKey: 'stale' })), 409);
  const corrected = await f.as('p1', () => f.apps.save(context('p1'), { ...submit, operationKey: 'corrected', expectedRevision: 3 }));
  assert.equal(corrected.revision, 4); assert.equal(corrected.state, 'pending');
  assert.equal((await f.as('p1', () => f.apps.save(context('p1'), change('pending-copy', 0, { application: app, submit: true })))).id, draft.id);
  assert.equal(JSON.stringify(f.state.receipts).includes('Authorized representative'), false);
  f.state.workflows.push(request('duplicate-draft', 'corporate_application', 'p1', app, 'draft', null));
  await rejectsStatus(f.as('p1', () => f.apps.save(context('p1'), { ...submit, operationKey: 'many', expectedRevision: 4 })), 409);
});

test('merchant approval is atomic, preserves review, never fabricates phone or leaks P2002 race metadata', async () => {
  for (const mode of ['success', 'phone-conflict', 'unique-race', 'review-failure', 'missing-proof', 'missing-consent']) {
    const f = fixture();
    const data = application({ agreementAcknowledgedAt: new ClockDate().toISOString() });
    if (mode === 'phone-conflict') data.contactPhone = 'phone-p1';
    if (mode === 'missing-consent') delete data.agreementAcknowledgedAt;
    f.state.workflows.push(request('application', 'corporate_application', 'p1', data, 'pending', null));
    if (mode === 'unique-race') f.fault.model = 'profile-unique';
    if (mode === 'review-failure') f.fault.model = 'review-update';
    if (mode === 'missing-proof') f.state.files[0].storageProvider = 'local_mock';
    const before = structuredClone(f.state.profiles), input = change('approve', 1, { decision: 'approve', verifiedRepresentative: true });
    const action = () => f.as('operator', () => f.apps.review(user, 'application', input));
    if (mode === 'success') {
      const result = await action(); assert.equal(result.state, 'approved');
      assert.equal(f.state.reviews.length, 1); assert.equal(f.state.reviews[0].status, 'approved');
      assert.equal(f.state.profiles.at(-1).phone, 'company-phone');
      assert.equal(f.state.relations.at(-1).role, 'admin');
      assert.ok(f.state.grants.some(g => g.membershipId === f.state.relations.at(-1).id && g.action === 'administrators:manage'));
      const writes = f.counts.writes; await action(); assert.equal(f.counts.writes, writes); assert.equal(f.state.profiles.length, before.length + 1);
    } else {
      await assert.rejects(action(), error => mode === 'review-failure' ? /Injected/.test(error.message) : [403, 409].includes(error.getStatus?.()) && !error.message.includes('sensitive'));
      assert.deepEqual(f.state.profiles, before); assert.equal(f.state.relations.length, 1); assert.equal(f.state.workflows[0].state, 'pending');
      assert.equal(f.state.reviews.length, 0); assert.equal(f.state.receipts.length, 0);
    }
  }
});

test('same-subject competition cannot claim an existing active admin; frozen-admin recovery requires archived proof', async () => {
  const f = fixture(), data = application({ existingCorporateCustomerId: 'company', agreementAcknowledgedAt: new ClockDate().toISOString() });
  f.state.workflows.push(request('claim', 'corporate_application', 'p1', data));
  const review = change('claim-review', 1, { decision: 'approve', verifiedRepresentative: true });
  await rejectsStatus(f.as('operator', () => f.apps.review(user, 'claim', review)), 409, '已有管理员');
  f.state.profiles[0].account.status = 'suspended'; f.state.files[0].status = 'pending_upload';
  await rejectsStatus(f.as('operator', () => f.apps.review(user, 'claim', review)), 403, '材料');
  assert.equal(f.state.relations.length, 1);
  f.state.files[0].status = 'active';
  assert.equal((await f.as('operator', () => f.apps.review(user, 'claim', review))).state, 'approved');
  assert.equal(f.state.relations.at(-1).personalCustomerId, 'p1'); assert.equal(f.state.profiles.length, 4);
  const g = fixture(); g.state.corporateProfiles.push({ id: 'existing-subject', tenantId: 't1', unifiedSocialCreditCode: data.legalIdentifier });
  g.state.workflows.push(request('competing', 'corporate_application', 'p2', application({ evidenceFileIds: ['p2-proof'], agreementAcknowledgedAt: new ClockDate().toISOString() }), 'pending', null));
  g.state.files.push({ ...g.state.files[0], id: 'p2-proof', businessId: 'p2', uploadedBy: 'p2' });
  await rejectsStatus(g.as('operator', () => g.apps.review(user, 'competing', review)), 409, '主体已登记');
  assert.equal(g.state.relations.length, 1);
});

test('workflow read projections exclude raw tenant/ORM fields and use the public schema whitelist', async () => {
  const f = fixture(), schema = load('apps/api/src/modules/enterprise/enterprise-workflow-schemas.ts').ENTERPRISE_WORKFLOW_SCHEMAS.EnterpriseWorkflowView;
  await f.as('p1', () => f.apps.save(context('p1'), change('projected-application', 0, { application: application(), submit: false })));
  await f.as('p2', () => f.members.join(context('p2'), join('projected-join')));
  for (const rows of [await f.as('p1', () => f.apps.mine(context('p1'))), await f.as('p2', () => f.members.joinRequests(context('p2')))]) {
    assert.ok(rows.length);
    for (const row of rows) { assert.ok(!('tenantId' in row)); assert.ok(Object.keys(plain(row)).every(key => key in schema.properties)); }
  }
});
test('bounded lists refuse 201 rather than hide unresolved rows; current identity and cross-tenant actors reject', async () => {
  const f = fixture();
  f.state.workflows = Array.from({ length: 201 }, (_, i) => request(`application-${i}`, 'corporate_application', 'p1', application(), 'draft', null));
  await rejectsStatus(f.as('p1', () => f.apps.mine(context('p1'))), 409);
  await rejectsStatus(f.as('operator', () => f.apps.merchantList(user)), 409);
  await rejectsStatus(f.as('p1', () => f.apps.save(context('p1'), change('overflow', 0, { application: application(), submit: false }))), 409);
  f.state.workflows = Array.from({ length: 201 }, (_, i) => request(`join-${i}`, 'join_request', 'p1', { inviteId: 'invite' }));
  await rejectsStatus(f.as('p1', () => f.members.joinRequests(context('p1'))), 409);
  await rejectsStatus(f.as('admin', () => f.members.joinRequests(context('admin'), 'company')), 409);
  f.state.invites = Array.from({ length: 201 }, (_, i) => ({ ...f.state.invites[0], id: `invite-${i}` }));
  await rejectsStatus(f.as('admin', () => f.members.invites(context('admin'), 'company')), 409);
  const g = fixture();
  await rejectsStatus(g.as('p1', () => g.members.join({ ...context('p1'), tenantId: 't2' }, join('wrong-tenant'))), 403);
  g.state.sessions[1].revokedAt = new ClockDate();
  await rejectsStatus(g.as('p1', () => g.members.join(context('p1'), join('revoked-session'))), 403);
  assert.equal(g.state.workflows.length, 0); assert.equal(g.state.rates.length, 0);
});
