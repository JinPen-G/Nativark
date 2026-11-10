const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Prisma } = require('@prisma/client');
const shared = require('../packages/shared/dist');
class HttpError extends Error { constructor(body) { super(typeof body === 'string' ? body : body.message); this.body = body; } }
const common = { Injectable: () => value => value, BadRequestException: HttpError, ConflictException: HttpError, ForbiddenException: HttpError };
function load(file, deps = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  vm.runInNewContext(source, { exports, require: name => deps[name] ?? (name === '@nestjs/common' ? common : name === '@prisma/client' ? { Prisma } : name === '@rental-os/shared' ? shared : (() => { throw new Error(name); })()), Date, Map, Set, JSON }, { filename: file });
  return exports;
}
const idempotencyModule = load('apps/api/src/modules/rental-core/rental-idempotency.repository.ts', { 'node:crypto': require('node:crypto'), './workspace-scope': {} });
const { EnterprisePolicyService } = load('apps/api/src/modules/enterprise/enterprise-policy.service.ts', { '../rental-core/rental-idempotency.repository': idempotencyModule, './enterprise-command.service': { enterpriseJson: value => typeof value === 'string' ? JSON.parse(value) : value }, '../../common/request-identity': { getRequestIdentity: () => ({ tenantId: 't1', userId: 'p1', isSaasAdmin: false }) } });
const input = { bookingIdentity: 'enterprise_employee', corporateCustomerId: 'company', enterpriseContractAndPayer: false, enterpriseDisclosure: { noticeVersion: 'v1', acknowledged: true } };
function fixture() {
  const policy = { workspaceIds: ['w1'], categoryCodes: ['vehicle'], personalPaymentAllowed: true, enterprisePaymentAllowed: true, approvalMode: 'without_per_order', noticeVersion: 'v1', noticeText: 'Enterprise identity orders are visible to the company.' };
  const state = { portal: [{ enabled: true }], tenant: [{ enabled: true }], policies: [{ scopeKey: 'merchant', revision: 1, policy: { ...policy } }, { scopeKey: 'company', revision: 1, policy: { ...policy } }], person: true, relation: true, memberPerson: { tenantId: 't1', customerType: 'personal', status: 'active', mergedIntoCustomerId: null, accountStatus: 'active', membershipStatus: 'active' }, memberUpdatedAt: new Date('2026-10-31T00:00:00.000Z'), category: 'VEHICLE', writes: 0 };
  const db = {
    $queryRaw: async strings => { const sql = Array.isArray(strings) ? strings.join('?') : strings.sql; if (sql.includes('customer_corporate_memberships')) return state.person && state.relation ? [{ id: 'member', updatedAt: new Date('2026-10-31T00:00:00Z') }] : []; if (sql.includes('FROM business_workspaces')) return [{ categoryCode: state.category }]; if (sql.includes('FROM Tenant')) return [{ id: 't1' }]; if (sql.includes('enterprise_corporate_portals')) return state.portal; if (sql.includes('enterprise_portal_tenant_settings')) return state.tenant; if (sql.includes('enterprise_scope_policies')) return state.policies; throw new Error(sql); },
    $executeRaw: async () => { state.writes++; },
    customerProfile: { findFirst: async args => args.where.id === 'company' || state.person ? { id: args.where.id } : null },
    customerCorporateMembership: { findFirst: async args => {
      if (!state.relation) return null;
      const expected = args.where.personalCustomer?.is, person = state.memberPerson;
      if (expected && (!person || person.tenantId !== expected.tenantId || person.customerType !== expected.customerType || person.status !== expected.status
        || person.mergedIntoCustomerId !== expected.mergedIntoCustomerId || person.accountStatus !== expected.account.is.status || person.membershipStatus !== expected.membership.is.status)) return null;
      return { id: 'member', updatedAt: state.memberUpdatedAt };
    } },
    businessWorkspace: { findFirst: async () => ({ categoryCode: state.category }), findMany: async () => [{ id: 'w1', name: 'Work', categoryCode: state.category }] },
  };
  const commands = { conflict: () => new HttpError({ code: 'enterprise_revision_conflict' }), operator: () => ({ tenantId: 't1', actor: 'operator:u1' }), customer: async () => {}, execute: async (tenant, actor, action, target, request, apply, verify) => { if (verify) await verify(db); return apply(db); } };
  const access = { requireAction: async () => ({ permissionRevision: '1:1' }) };
  return { state, db, api: new EnterprisePolicyService(db, commands, access), policy };
}
test('only truly unmigrated companies keep legacy behavior; disabled migrated portal fails closed', async () => {
  const { api, state } = fixture(); state.portal = []; state.policies = [];
  assert.equal(await api.authorize('t1', 'w1', 'p1', input), undefined);
  state.portal = [{ enabled: false }];
  await assert.rejects(api.authorize('t1', 'w1', 'p1', input));
  state.portal = [{ enabled: true }];
  await assert.rejects(api.authorize('t1', 'w1', 'p1', input));
});
test('current workspace/category intersection and disclosure are mandatory, including personal-payment benefits', async () => {
  const { api, state } = fixture();
  assert.equal((await api.authorize('t1', 'w1', 'p1', input)).guaranteePayer, 'enterprise');
  await assert.rejects(api.authorize('t1', 'w2', 'p1', input));
  state.category = 'CAMERA'; await assert.rejects(api.authorize('t1', 'w1', 'p1', input)); state.category = 'VEHICLE';
  await assert.rejects(api.authorize('t1', 'w1', 'p1', { ...input, enterpriseDisclosure: { acknowledged: false, noticeVersion: 'v1' } }));
  state.policies[0].policy.noticeVersion = 'v2'; await assert.rejects(api.authorize('t1', 'w1', 'p1', input));
});
test('employee admission grants no payment authority; company/member policy cannot loosen merchant limits', async () => {
  const { api, state, policy } = fixture(), paying = { ...input, enterpriseContractAndPayer: true };
  await assert.rejects(api.authorize('t1', 'w1', 'p1', paying));
  state.policies.push({ scopeKey: 'member:member', revision: 1, membershipUpdatedAt: new Date('2026-10-31T00:00:00Z'), policy: { ...policy } });
  assert.equal((await api.authorize('t1', 'w1', 'p1', paying)).approvalMode, 'without_per_order');
  await assert.rejects(api.companySave({ tenantId: 't1', customerId: 'p1' }, 'company', { expectedRevision: 1, policy: { ...policy, categoryCodes: ['camera'] } }));
  state.policies[0].policy.approvalMode = 'per_order'; state.policies[0].policy.approvalLifetimeMinutes = 30;
  await assert.rejects(api.companySave({ tenantId: 't1', customerId: 'p1' }, 'company', { expectedRevision: 1, policy }));
  assert.equal(state.writes, 0);
});
test('current relation, tenant shutdown and frozen policy revision recheck reject new business', async () => {
  const { api, state } = fixture(); const basis = await api.authorize('t1', 'w1', 'p1', input);
  state.relation = false; await assert.rejects(api.authorize('t1', 'w1', 'p1', input)); state.relation = true;
  state.tenant = [{ enabled: false }]; await assert.rejects(api.authorize('t1', 'w1', 'p1', input)); state.tenant = [{ enabled: true }];
  state.policies[1].revision++;
  assert.throws(() => api.assertSameBasis(basis, { ...basis, companyRevision: 2 }));
  assert.doesNotThrow(() => api.assertSameBasis(basis, { ...basis, acknowledgedAt: 'later' }));
});
test('quote limits use original rental payable and currency, never deposit or unknown zero', async () => {
  const { api, state, db } = fixture(); state.policies[0].policy.maxRequestAmount = '100.00'; state.policies[0].policy.currency = 'CNY';
  await api.assertQuoteAmount('t1', 'company', 'member', { currency: 'CNY', payableAmount: 100, depositAmount: 5000 }, db);
  await assert.rejects(api.assertQuoteAmount('t1', 'company', 'member', { currency: 'CNY', payableAmount: 100.01 }, db));
  await assert.rejects(api.assertQuoteAmount('t1', 'company', 'member', { currency: 'USD', payableAmount: 1 }, db));
  await assert.rejects(api.assertQuoteAmount('t1', 'company', 'member', { payableAmount: 0 }, db));
});
test('merchant visibility notice changes require a new version before persistence', async () => {
  const { api, state, policy } = fixture();
  await assert.rejects(api.merchantSave({}, 'company', { expectedRevision: 1, policy: { ...policy, noticeText: 'Changed enterprise visibility terms' } }));
  assert.equal(state.writes, 0);
  await api.merchantSave({}, 'company', { expectedRevision: 1, policy: { ...policy, noticeVersion: 'v2', noticeText: 'Changed enterprise visibility terms' } });
  assert.equal(state.writes, 1);
});
test('policy save original smoke: own company/member receipt survives lost grants and current policy changes without exposing limits or rewriting', async () => {
  const f = fixture(), receipts = new Map(), policies = new Map(f.state.policies.map(row => [row.scopeKey, row])); let currentActor = 'p1', permitted = true;
  const identity = { requireRequestTenantId: () => 't1', requireRequestUserId: () => currentActor };
  const { EnterpriseCommandService } = load('apps/api/src/modules/enterprise/enterprise-command.service.ts', { '../../common/request-identity': identity, 'node:crypto': require('node:crypto') });
  f.db.$transaction = callback => callback(f.db);
  f.db.$queryRaw = async (strings, ...values) => {
    const sql = Array.isArray(strings) ? strings.join('?') : strings.sql, parameters = Array.isArray(strings) ? values : strings.values;
    if (sql.includes('FROM Tenant')) return [{ id: 't1' }];
    if (sql.includes('FROM customer_profiles')) return f.state.person ? [{ id: currentActor }] : [];
    if (sql.includes('enterprise_portal_operations')) {
      if (!sql.includes('LEFT JOIN')) { const row = receipts.get(parameters[1]); return row ? [row] : []; }
      const [corporate, scopeKey, tenant, key, actor, target] = parameters, row = receipts.get(key);
      if (!row || row.tenantId !== tenant || row.actorUserId !== actor || row.target !== target) return [];
      return [{ operationKey: key, result: row.result, scopeKey: corporate === 'company' && policies.has(scopeKey) ? scopeKey : null }];
    }
    if (sql.includes('enterprise_scope_policies')) return [...policies.values()];
    throw new Error(`Unexpected offline query: ${sql}`);
  };
  f.db.$executeRaw = async (strings, ...values) => {
    const sql = strings.join('?'); f.state.writes++;
    if (sql.includes('INSERT INTO enterprise_scope_policies')) { policies.set(values[2], { scopeKey: values[2], revision: values[3], policy: JSON.parse(values[4]) }); return 1; }
    if (sql.includes('INSERT INTO enterprise_portal_operations')) { receipts.set(values[1], { tenantId: values[0], actorUserId: values[2], requestHash: values[3], target: values[4], result: values[6] }); return 1; }
    throw new Error(`Unexpected offline write: ${sql}`);
  };
  const commands = new EnterpriseCommandService(f.db), access = { requireAction: async () => { if (!permitted) throw new HttpError('No current grant'); return { permissionRevision: '1:1' }; } };
  const api = new EnterprisePolicyService(f.db, commands, access), context = { tenantId: 't1', customerId: 'p1', customerType: 'personal', sessionId: 's1' };
  const company = await api.companySave(context, 'company', { expectedRevision: 1, operationKey: 'company-key', reason: 'Explicit narrowing', policy: f.policy });
  const employeeInput = { expectedRevision: 0, operationKey: 'employee-key', reason: 'Explicit employee policy', policy: { ...f.policy, enterprisePaymentAllowed: false }, expectedMembershipUpdatedAt: f.state.memberUpdatedAt.toISOString() };
  const employee = await api.companySave(context, 'company', employeeInput, 'member');
  assert.equal(company.revision, 2); assert.equal(employee.revision, 1); const writes = f.state.writes;
  f.state.memberUpdatedAt = new Date('2026-10-31T00:00:01.000Z'); f.state.memberPerson = null;
  assert.equal((await api.companySave(context, 'company', employeeInput, 'member')).membershipUpdatedAt, '2026-10-31T00:00:00.000Z', 'same original K replays its original binding, never the current restored relation');
  assert.equal(f.state.writes, writes);
  permitted = false; f.state.relation = false; policies.get('company').revision = 90; policies.get('company').policy.noticeText = 'Current changed notice';
  assert.deepEqual(JSON.parse(JSON.stringify(await api.readCompanySave(context, 'company', 'company-key'))), { state: 'committed', result: { corporateCustomerId: 'company', scopeKey: 'company', revision: 2 } });
  assert.deepEqual(JSON.parse(JSON.stringify(await api.readCompanySave(context, 'company', 'employee-key', 'member'))), { state: 'committed', result: { corporateCustomerId: 'company', scopeKey: 'member:member', revision: 1 } });
  assert.equal((await api.readCompanySave(context, 'another-company', 'company-key')).state, 'not_recorded');
  assert.equal((await api.readCompanySave(context, 'company', 'employee-key')).state, 'not_recorded');
  assert.equal((await api.readCompanySave(context, 'company', 'missing')).state, 'not_recorded');
  currentActor = 'p2'; assert.equal((await api.readCompanySave({ ...context, customerId: 'p2' }, 'company', 'company-key')).state, 'not_recorded'); currentActor = 'p1';
  const original = receipts.get('company-key').result; receipts.get('company-key').result = '{broken private receipt';
  await assert.rejects(api.readCompanySave(context, 'company', 'company-key'), error => !error.message.includes('private')); receipts.get('company-key').result = original;
  policies.delete('company'); await assert.rejects(api.readCompanySave(context, 'company', 'company-key'));
  f.state.person = false; await assert.rejects(api.readCompanySave(context, 'company', 'employee-key', 'member'));
  assert.equal(f.state.writes, writes, 'reads never persist/regrant/recalculate current policy');
});

test('policy membership basis smoke: original UTC relation revision gates persistence and survives DTO/schema projection without changing monetary bounds', async () => {
  const f = fixture(), context = { tenantId: 't1', customerId: 'p1' }, original = f.state.memberUpdatedAt.toISOString();
  const request = { expectedRevision: 0, operationKey: 'basis-key', reason: 'Explicit employee policy', policy: { ...f.policy, enterprisePaymentAllowed: false }, expectedMembershipUpdatedAt: original };
  for (const expectedMembershipUpdatedAt of [undefined, null, 'not-a-date', '2026-10-31T00:00:00Z']) {
    await assert.rejects(f.api.companySave(context, 'company', { ...request, expectedMembershipUpdatedAt }, 'member'), error => error.body?.code === 'enterprise_revision_conflict');
    assert.equal(f.state.writes, 0);
  }
  f.state.memberUpdatedAt = new Date('2026-10-31T00:00:01.000Z');
  await assert.rejects(f.api.companySave(context, 'company', request, 'member'), error => error.body?.code === 'enterprise_revision_conflict'); assert.equal(f.state.writes, 0);
  f.state.relation = false; await assert.rejects(f.api.companySave(context, 'company', { ...request, expectedMembershipUpdatedAt: f.state.memberUpdatedAt.toISOString() }, 'member'));
  f.state.relation = true; const persisted = []; f.db.$executeRaw = async (_strings, ...values) => { persisted.push(values); f.state.writes++; return 1; };
  const current = f.state.memberUpdatedAt.toISOString(), saved = await f.api.companySave(context, 'company', { ...request, expectedMembershipUpdatedAt: current }, 'member');
  assert.equal(saved.membershipUpdatedAt, current); assert.equal(persisted[0][5].toISOString(), current); assert.equal(f.state.writes, 1);
  const priorWrites = f.state.writes; await assert.rejects(f.api.companySave(context, 'company', { ...request, expectedRevision: 1 })); assert.equal(f.state.writes, priorWrites, 'company scope cannot misuse an employee revision');
  require('reflect-metadata');
  const validation = require('class-validator'), transform = require('class-transformer');
  // Reuse the existing native-realm DTO host: class-validator's nested instanceof
  // Object check would otherwise reject real DTO classes constructed in a VM realm.
  const Module = require('node:module'), dtoFile = path.resolve('apps/api/src/modules/enterprise/enterprise-request.dto.ts');
  const compiled = ts.transpileModule(fs.readFileSync(dtoFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
  const dtoModule = new Module(dtoFile, module); dtoModule.filename = dtoFile; dtoModule.paths = Module._nodeModulePaths(path.dirname(dtoFile));
  const nativeRequire = dtoModule.require.bind(dtoModule); dtoModule.require = name => name === '@rental-os/shared' ? shared : nativeRequire(name); dtoModule._compile(compiled.outputText, dtoFile);
  const dto = dtoModule.exports.SaveEnterpriseScopePolicyRequestDto;
  const errors = body => validation.validateSync(transform.plainToInstance(dto, body));
  assert.equal(errors(request).length, 0, 'formal member basis remains in the DTO');
  for (const expectedMembershipUpdatedAt of [null, 1, '2026-10-31T00:00:00Z', '2026-02-30T00:00:00.000Z']) assert.ok(errors({ ...request, expectedMembershipUpdatedAt }).length > 0);
  const company = { ...request }; delete company.expectedMembershipUpdatedAt; assert.equal(errors(company).length, 0, 'company and merchant scopes retain their original input');
  const schemas = load('apps/api/src/modules/enterprise/enterprise-workflow-schemas.ts').ENTERPRISE_WORKFLOW_SCHEMAS;
  assert.equal(schemas.SaveEnterpriseScopePolicyRequest.properties.expectedMembershipUpdatedAt.format, 'date-time');
  assert.equal(schemas.SaveEnterpriseScopePolicyRequest.required.includes('expectedMembershipUpdatedAt'), false, 'only the member operation requires it');
  assert.equal(schemas.EnterpriseScopePolicySaved.properties.membershipUpdatedAt.format, 'date-time');
});

test('policy target person smoke: current same-tenant active personal account/member is required before a new employee policy binding', async () => {
  const f = fixture(), context = { tenantId: 't1', customerId: 'p1' }, person = { ...f.state.memberPerson };
  const request = { operationKey: 'target-person-key', expectedRevision: 0, reason: 'Reviewed target policy', policy: { ...f.policy, enterprisePaymentAllowed: false }, expectedMembershipUpdatedAt: f.state.memberUpdatedAt.toISOString() };
  for (const change of [null, { tenantId: 'another-tenant' }, { customerType: 'corporate' }, { status: 'inactive' }, { mergedIntoCustomerId: 'another-person' }, { accountStatus: 'suspended' }, { membershipStatus: 'pending_review' }]) {
    f.state.memberPerson = change === null ? null : { ...person, ...change };
    await assert.rejects(f.api.companySave(context, 'company', request, 'member'), error => error.body?.code === 'enterprise_revision_conflict');
    assert.equal(f.state.writes, 0); assert.equal(f.state.person, true, 'actor identity is still available; a different target cannot borrow it');
  }
  f.state.memberPerson = null;
  const companyInput = { ...request, expectedRevision: 1 }; delete companyInput.expectedMembershipUpdatedAt;
  await f.api.companySave(context, 'company', companyInput); assert.equal(f.state.writes, 1, 'company policy is not tied to a selected employee');
  f.state.memberPerson = person; const result = await f.api.companySave(context, 'company', request, 'member');
  assert.equal(result.membershipUpdatedAt, request.expectedMembershipUpdatedAt); assert.equal(result.policy.enterprisePaymentAllowed, false); assert.equal(f.state.writes, 2);
});

test('merchant policy original smoke: exact operator/company/key receipt excludes current limits and never reapplies a saved policy', async () => {
  const f = fixture(), receipts = new Map(); let currentActor = 'u1', currentTenant = 't1';
  const { EnterpriseCommandService } = load('apps/api/src/modules/enterprise/enterprise-command.service.ts', { 'node:crypto': require('node:crypto'),
    '../../common/request-identity': { requireRequestTenantId: () => currentTenant, requireRequestUserId: () => currentActor } });
  f.db.$transaction = callback => callback(f.db);
  f.db.$queryRaw = async (strings, ...values) => {
    const sql = Array.isArray(strings) ? strings.join('?') : strings.sql, parameters = Array.isArray(strings) ? values : strings.values;
    if (sql.includes('FROM Tenant')) return [{ id: currentTenant }];
    if (sql.includes('enterprise_portal_operations')) {
      if (!sql.includes('LEFT JOIN')) { const row = receipts.get(parameters[1]); return row ? [row] : []; }
      const [corporate, tenant, key, actor, target] = parameters, row = receipts.get(key);
      if (!row || row.tenantId !== tenant || row.actorUserId !== actor || row.target !== target) return [];
      return [{ operationKey: key, result: row.result, scopeKey: corporate === 'company' && f.state.policies.some(p => p.scopeKey === 'merchant') ? 'merchant' : null }];
    }
    if (sql.includes('enterprise_scope_policies')) return f.state.policies;
    throw new Error(`Unexpected offline merchant query: ${sql}`);
  };
  f.db.$executeRaw = async (strings, ...values) => {
    const sql = strings.join('?'); f.state.writes++;
    if (sql.includes('INSERT INTO enterprise_scope_policies')) { const row = f.state.policies.find(p => p.scopeKey === values[2]); Object.assign(row, { revision: values[3], policy: JSON.parse(values[4]) }); return 1; }
    if (sql.includes('INSERT INTO enterprise_portal_operations')) { receipts.set(values[1], { tenantId: values[0], actorUserId: values[2], requestHash: values[3], target: values[4], result: values[6] }); return 1; }
    throw new Error(`Unexpected offline merchant write: ${sql}`);
  };
  const user = { id: 'u1', tenantId: 't1', isActive: true, isPlatformAdmin: false, isSaasAdmin: false, dataScope: 'all', permissions: ['rental-os:corporate:manage'] };
  const api = new EnterprisePolicyService(f.db, new EnterpriseCommandService(f.db), {});
  await api.merchantSave(user, 'company', { operationKey: 'merchant-policy-key', expectedRevision: 1, reason: 'Explicit merchant upper bounds', policy: { ...f.policy, maxRequestAmount: '100.00', currency: 'CNY' } });
  const writes = f.state.writes; f.db.customerProfile.findFirst = async () => null;
  f.state.policies.find(p => p.scopeKey === 'merchant').revision = 90; f.state.policies.find(p => p.scopeKey === 'merchant').policy.noticeText = 'Current changed notice';
  const expected = { state: 'committed', result: { corporateCustomerId: 'company', scopeKey: 'merchant', revision: 2 } };
  assert.deepEqual(JSON.parse(JSON.stringify(await api.readMerchantSave(user, 'company', 'merchant-policy-key'))), expected);
  assert.equal((await api.readMerchantSave(user, 'another-company', 'merchant-policy-key')).state, 'not_recorded');
  assert.equal((await api.readMerchantSave(user, 'company', 'missing-key')).state, 'not_recorded');
  currentActor = 'u2'; assert.equal((await api.readMerchantSave({ ...user, id: 'u2' }, 'company', 'merchant-policy-key')).state, 'not_recorded'); currentActor = 'u1';
  currentTenant = 't2'; assert.equal((await api.readMerchantSave({ ...user, tenantId: 't2' }, 'company', 'merchant-policy-key')).state, 'not_recorded'); currentTenant = 't1';
  const receipt = receipts.get('merchant-policy-key'), original = receipt.result; receipt.result = '{private broken receipt';
  await assert.rejects(api.readMerchantSave(user, 'company', 'merchant-policy-key'), error => !error.message.includes('private')); receipt.result = original;
  receipt.result = JSON.stringify({ scopeKey: 'company', revision: 2, policy: f.policy }); await assert.rejects(api.readMerchantSave(user, 'company', 'merchant-policy-key')); receipt.result = original;
  f.state.policies = f.state.policies.filter(p => p.scopeKey !== 'merchant'); await assert.rejects(api.readMerchantSave(user, 'company', 'merchant-policy-key'));
  await assert.rejects(api.readMerchantSave({ ...user, permissions: [] }, 'company', 'merchant-policy-key'));
  assert.equal(f.state.writes, writes, 'original reads never recreate limits, activate the enterprise or write a second receipt');
});

test('current per-order policy refuses ordinary creation without its bound Core participant', async () => {
  const { api, state, db, policy } = fixture();
  for (const row of state.policies) { row.policy.approvalMode = 'per_order'; row.policy.approvalLifetimeMinutes = 30; }
  state.policies.push({ scopeKey: 'member:member', revision: 1, membershipUpdatedAt: new Date('2026-10-31T00:00:00Z'), policy: { ...policy, approvalMode: 'per_order', approvalLifetimeMinutes: 30 } });
  const paying = { ...input, enterpriseContractAndPayer: true }, basis = await api.authorize('t1', 'w1', 'p1', paying);
  await assert.rejects(api.assertOrderCreation('t1', 'w1', { request: { bookingIdentity: paying }, currency: 'CNY', payableAmount: 1, membershipSnapshot: { bookingIdentity: 'enterprise_employee', enterpriseContractAndPayer: true, personalCustomerId: 'p1', corporateCustomerId: 'company', corporateMembershipId: 'member', enterpriseBasis: basis } }, db));
  assert.equal(state.writes, 0);
});
