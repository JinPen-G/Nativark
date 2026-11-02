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
  const state = { portal: [{ enabled: true }], tenant: [{ enabled: true }], policies: [{ scopeKey: 'merchant', revision: 1, policy: { ...policy } }, { scopeKey: 'company', revision: 1, policy: { ...policy } }], person: true, relation: true, category: 'VEHICLE', writes: 0 };
  const db = {
    $queryRaw: async strings => { const sql = Array.isArray(strings) ? strings.join('?') : strings.sql; if (sql.includes('customer_corporate_memberships')) return state.person && state.relation ? [{ id: 'member', updatedAt: new Date('2026-10-31T00:00:00Z') }] : []; if (sql.includes('FROM business_workspaces')) return [{ categoryCode: state.category }]; if (sql.includes('FROM Tenant')) return [{ id: 't1' }]; if (sql.includes('enterprise_corporate_portals')) return state.portal; if (sql.includes('enterprise_portal_tenant_settings')) return state.tenant; if (sql.includes('enterprise_scope_policies')) return state.policies; throw new Error(sql); },
    $executeRaw: async () => { state.writes++; },
    customerProfile: { findFirst: async args => args.where.id === 'company' || state.person ? { id: args.where.id } : null },
    customerCorporateMembership: { findFirst: async () => state.relation ? { id: 'member', updatedAt: new Date('2026-10-31T00:00:00Z') } : null },
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
test('current per-order policy refuses ordinary creation without its bound Core participant', async () => {
  const { api, state, db, policy } = fixture();
  for (const row of state.policies) { row.policy.approvalMode = 'per_order'; row.policy.approvalLifetimeMinutes = 30; }
  state.policies.push({ scopeKey: 'member:member', revision: 1, membershipUpdatedAt: new Date('2026-10-31T00:00:00Z'), policy: { ...policy, approvalMode: 'per_order', approvalLifetimeMinutes: 30 } });
  const paying = { ...input, enterpriseContractAndPayer: true }, basis = await api.authorize('t1', 'w1', 'p1', paying);
  await assert.rejects(api.assertOrderCreation('t1', 'w1', { request: { bookingIdentity: paying }, currency: 'CNY', payableAmount: 1, membershipSnapshot: { bookingIdentity: 'enterprise_employee', enterpriseContractAndPayer: true, personalCustomerId: 'p1', corporateCustomerId: 'company', corporateMembershipId: 'member', enterpriseBasis: basis } }, db));
  assert.equal(state.writes, 0);
});
