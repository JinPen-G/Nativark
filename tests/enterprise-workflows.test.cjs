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
for (const [name, status] of [['BadRequestException', 400], ['ConflictException', 409], ['ForbiddenException', 403], ['NotFoundException', 404], ['ServiceUnavailableException', 503]]) common[name] = class extends HttpError { constructor(body) { super(body, status); } };
function load(relative, deps = {}) {
  const file = path.join(root, relative), exports = {};
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
  vm.runInNewContext(result.outputText, { exports, require: name => {
    if (name in deps) return deps[name];
    if (name.startsWith('node:')) return require(name);
    if (name === '@nestjs/common') return common;
    if (name === '@prisma/client') return { Prisma };
    if (name === '../rental-core/rental-idempotency.repository') return load('apps/api/src/modules/rental-core/rental-idempotency.repository.ts', { './workspace-scope': { resolveScopeWorkspaceId: () => { throw new Error('Audit must not invoke Core scope resolution'); } } });
    if (name === './enterprise-transfer-receipt-projection') return load('apps/api/src/modules/enterprise/enterprise-transfer-receipt-projection.ts', { '@rental-os/shared': require('@rental-os/shared'), './enterprise-command.service': commandModule });
    if (name === 'class-validator') return require(name); // Real ISO calendar validation, no business adapter.
    throw new Error(`Unexpected runtime dependency: ${name}`);
  }, Date: ClockDate, Map, Set, JSON }, { filename: file });
  return exports;
}
const identity = load('apps/api/src/common/request-identity.ts');
const commandModule = load('apps/api/src/modules/enterprise/enterprise-command.service.ts', { '../../common/request-identity': identity });
const { EnterpriseCommandService, enterpriseHash } = commandModule;
const { SharedCustomerRepository } = load('apps/api/src/modules/platform/shared-customer.repository.ts', { '../../common/request-identity': identity });
const { EnterpriseAccessService } = load('apps/api/src/modules/client/enterprise-access.service.ts', { '@rental-os/shared': load('packages/shared/src/enterprise.ts') });
const transferDecisionModule = load('packages/shared/src/enterprise-transfer-decision.ts');
const continuityModule = load('apps/api/src/modules/enterprise/enterprise-administrator-continuity.ts');
const { EnterpriseMembersService } = load('apps/api/src/modules/enterprise/enterprise-members.service.ts', {
  './enterprise-command.service': commandModule, './enterprise-administrator-continuity': continuityModule,
  '@rental-os/shared': { ...load('packages/shared/src/enterprise.ts'), ...transferDecisionModule },
});
const { EnterpriseApplicationService } = load('apps/api/src/modules/enterprise/enterprise-application.service.ts', {
  './enterprise-command.service': commandModule, './enterprise-administrator-continuity': continuityModule,
  '@rental-os/shared': require('@rental-os/shared'),
});
const { EnterpriseTaskCenterService } = load('apps/api/src/modules/enterprise/enterprise-task-center.service.ts', { '@rental-os/shared': require('@rental-os/shared'), '../../common/request-identity': identity, './enterprise-command.service': commandModule });
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
    tenants: [{ id: 't1', code: 'merchant', status: 'ACTIVE' }], tenantEnabled: true, corporateEnabled: true, tenantRevision: 1, corporateRevision: 1,
    profiles: [person('admin'), person('p1'), person('p2'), { id: 'company', tenantId: 't1', customerType: 'corporate', status: 'active', mergedIntoCustomerId: null, name: 'Company', corporateName: 'Independent company', updatedAt: new ClockDate(clock - 1000), phone: 'existing-company-phone', membership: { status: 'active' }, corporateProfile: { unifiedSocialCreditCode: '91310000MA1K123456', unifiedSocialCreditCodeMasked: '913****3456', legalName: 'Independent company', status: 'active', updatedAt: new ClockDate(clock - 1000) } }],
    sessions: ['admin', 'p1', 'p2'].map(id => ({ id: `session-${id}`, customerId: id, tenantId: 't1', revokedAt: null, expiresAt: new ClockDate(clock + 3600000) })),
    relations: [admin], grants: ['portal:enter', 'members:read', 'members:manage', 'administrators:manage', 'invites:manage'].map(action => ({ tenantId: 't1', corporateCustomerId: 'company', membershipId: admin.id, action, membershipUpdatedAt: admin.updatedAt })),
    invitePolicy: { maxLifetimeHours: 24, maxUses: 10, guessesPerWindow: 100, windowSeconds: 600, agreementVersion: 'v1', noticeText: 'Merchant-approved enterprise invitation and visibility notice' },
    invites: [{ id: 'invite', tenantId: 't1', corporateCustomerId: 'company', tokenHash: enterpriseHash(code), status: 'active', revision: 1, expiresAt: new ClockDate(clock + 3600000), maxUses: 1, used: 0, createdAt: new ClockDate(clock) }],
    workflows: [], receipts: [], rates: [], reviews: [], corporateProfiles: [],
    portalMarkers: [{ tenantId: 't1', corporateCustomerId: 'company' }], policyMarkers: [],
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
      if (sql.includes('AS migrated')) {
        for (const predicate of ['portal.tenantId=$0', 'portal.corporateCustomerId=$1', 'policy.tenantId=$2', 'policy.corporateCustomerId=$3']) assert.ok(sql.includes(predicate));
        assert.equal(values[0], values[2]); assert.equal(values[1], values[3]); assert.ok(!sql.includes('portal.enabled'));
        if (fault.migration === 'missing') return []; if (fault.migration === 'invalid') return [{ migrated: 'unknown' }];
        const migrated = [...state.portalMarkers, ...state.policyMarkers].some(m => m.tenantId === values[0] && m.corporateCustomerId === values[1]);
        const rows = [{ migrated: fault.migration ?? migrated }];
        fault.afterClaimMaterialRead?.(); return rows;
      }
      if (sql.includes('FROM customer_profiles p')) {
        const p = profileById(filters.id), session = state.sessions.find(s => s.id === values[0] && s.customerId === p?.id && s.tenantId === filters.tenantId && !s.revokedAt && s.expiresAt > new ClockDate());
        return p?.tenantId === filters.tenantId && p.customerType === 'personal' && p.status === 'active' && !p.mergedIntoCustomerId && p.account?.status === 'active' && session && !['exited', 'closed'].includes(p.membership?.status) && (values.at(-1) || p.membership?.status === 'active') ? [{ id: p.id }] : [];
      }
      if (sql.includes("manage.action='administrators:manage'")) {
        for (const predicate of ["p.customerType='personal'", 'p.mergedIntoCustomerId IS NULL', 'm.tenantId=$0', 'm.corporateCustomerId=$1', 'm.id<>$2 OR $3 IS NULL']) assert.ok(sql.includes(predicate));
        assert.equal(values[2], values[3], 'nullable exclusion binds the same original membership twice');
        for (const alias of ['entry', 'manage']) for (const field of ['tenantId=m.tenantId', 'corporateCustomerId=m.corporateCustomerId', 'membershipId=m.id', 'membershipUpdatedAt=m.updatedAt']) assert.ok(sql.includes(`${alias}.${field}`));
        return state.relations.filter(row => row.tenantId === values[0] && row.corporateCustomerId === values[1] && (values[2] === null || row.id !== values[2])
          && row.role === 'admin' && effective(row) && profileById(row.personalCustomerId)?.customerType === 'personal' && eligible(profileById(row.personalCustomerId))
          && ['portal:enter', 'administrators:manage'].every(action => state.grants.some(g => g.tenantId === row.tenantId && g.corporateCustomerId === row.corporateCustomerId && g.membershipId === row.id && g.action === action && +g.membershipUpdatedAt === +row.updatedAt))).slice(0, 1).map(row => ({ id: row.id }));
      }
      if (sql.includes('o.operationKey AS managementSaveKey')) {
        for (const predicate of ['FROM enterprise_portal_operations o', 'LEFT JOIN enterprise_workflow_requests w', 'w.tenantId=o.tenantId', "w.id=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(o.result),o.result,'{}'),'$.id'))", 'w.corporateCustomerId=$0', 'w.applicantCustomerId=$1', "w.kind='finance_request'", 'o.tenantId=$2', 'o.operationKey=$3', 'o.actorUserId=$4', 'o.target=$5']) assert.ok(sql.includes(predicate), predicate);
        assert.equal(values[4], `customer:${values[1]}`); assert.equal(values[5], `management-request.save:${values[0]}`);
        for (const forbidden of ['w.state', 'w.revision', 'w.payload', 'customer_corporate_credits', 'enterprise_portal_grants', 'customer_profiles']) assert.ok(!sql.includes(forbidden), 'current state, material or authority is not original-save evidence');
        const receipt = state.receipts.find(r => r.tenantId === values[2] && r.operationKey === values[3] && r.actorUserId === values[4] && r.target === values[5]);
        let result, rows = [];
        if (receipt) {
          try { result = typeof receipt.result === 'string' ? JSON.parse(receipt.result) : receipt.result; } catch { /* Bad original JSON still preserves the left-hand receipt. */ }
          const row = state.workflows.find(w => w.tenantId === receipt.tenantId && w.id === result?.id && w.corporateCustomerId === values[0] && w.applicantCustomerId === values[1] && w.kind === 'finance_request');
          rows = copy([{ managementSaveKey: receipt.operationKey, managementSaveResult: receipt.result, requestId: row?.id ?? null, corporateCustomerId: row?.corporateCustomerId ?? null }]);
        }
        if (fault.afterManagementSaveRead) fault.afterManagementSaveRead(); return rows;
      }
      if (sql.includes('o.operationKey AS applicationReviewKey')) {
        for (const predicate of ['FROM enterprise_portal_operations o', 'LEFT JOIN enterprise_workflow_requests w', 'w.tenantId=o.tenantId', 'w.id=$0', "w.kind='corporate_application'", 'o.tenantId=$1', 'o.operationKey=$2', 'o.actorUserId=$3', 'o.target=$4']) assert.ok(sql.includes(predicate), predicate);
        assert.equal(values[4], `application.review:${values[0]}`);
        for (const forbidden of ['w.state', 'w.revision', 'w.payload', 'w.corporateCustomerId', 'enterprise_portal_grants', 'customer_profiles']) assert.ok(!sql.includes(forbidden), 'current state/material/grants cannot substitute for the original review');
        const receipt = state.receipts.find(row => row.tenantId === values[1] && row.operationKey === values[2] && row.actorUserId === values[3] && row.target === values[4]);
        const request = receipt && state.workflows.find(row => row.tenantId === receipt.tenantId && row.id === values[0] && row.kind === 'corporate_application');
        const rows = receipt ? copy([{ applicationReviewKey: receipt.operationKey, reviewResult: receipt.result, requestId: request?.id ?? null }]) : [];
        fault.afterApplicationReviewRead?.(); return rows;
      }
      if (sql.includes('o.operationKey AS managementReviewKey')) {
        for (const predicate of ['LEFT JOIN enterprise_workflow_requests w', 'w.tenantId=o.tenantId', 'w.id=$0', "w.kind='finance_request'", 'o.tenantId=$1', 'o.operationKey=$2', 'o.actorUserId=$3', 'o.target=$4', "JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(w.payload),w.payload,'{}'),'$.requestType'))"]) assert.ok(sql.includes(predicate));
        assert.equal(values[4], `management-request.review:${values[0]}`);
        const receipt = state.receipts.find(row => row.tenantId === values[1] && row.operationKey === values[2] && row.actorUserId === values[3] && row.target === values[4]);
        const request = receipt && state.workflows.find(row => row.tenantId === receipt.tenantId && row.id === values[0] && row.kind === 'finance_request');
        let requestType = null; try { requestType = JSON.parse(request?.payload ?? '{}').requestType ?? null; } catch {}
        const rows = receipt ? copy([{ managementReviewKey: receipt.operationKey, reviewResult: receipt.result, requestId: request?.id ?? null, corporateCustomerId: request?.corporateCustomerId ?? null, requestType }]) : [];
        fault.afterManagementReviewRead?.(); return rows;
      }
      if (sql.includes('o.operationKey AS managementWithdrawalKey')) {
        for (const predicate of ['FROM enterprise_portal_operations o', 'LEFT JOIN enterprise_workflow_requests w', 'w.tenantId=o.tenantId', 'w.id=$0', 'w.applicantCustomerId=$1', "w.kind='finance_request'", 'o.tenantId=$2', 'o.operationKey=$3', 'o.actorUserId=$4', 'o.target=$5']) assert.ok(sql.includes(predicate));
        assert.equal(values[4], `customer:${values[1]}`); assert.equal(values[5], `management-request.withdraw:${values[0]}`);
        const receipt = state.receipts.find(row => row.tenantId === values[2] && row.operationKey === values[3] && row.actorUserId === values[4] && row.target === values[5]);
        const request = receipt && state.workflows.find(row => row.tenantId === receipt.tenantId && row.id === values[0] && row.applicantCustomerId === values[1] && row.kind === 'finance_request');
        const rows = receipt ? copy([{ requestId: request?.id ?? null, managementWithdrawalKey: receipt.operationKey, withdrawalResult: receipt.result }]) : [];
        fault.afterManagementWithdrawalRead?.(); return rows;
      }
      if (sql.includes('o.operationKey AS applicationWithdrawalKey')) {
        for (const predicate of ['w.tenantId=o.tenantId', 'w.id=$0', 'w.applicantCustomerId=$1', "w.kind='corporate_application'", 'o.tenantId=$2', 'o.operationKey=$3', 'o.actorUserId=$4', 'o.target=$5']) assert.ok(sql.includes(predicate));
        assert.equal(values[4], `customer:${values[1]}`); assert.equal(values[5], `application.withdraw:${values[0]}`);
        const receipt = state.receipts.find(r => r.tenantId === values[2] && r.operationKey === values[3] && r.actorUserId === values[4] && r.target === values[5]); if (!receipt) return [];
        const row = state.workflows.find(w => w.tenantId === receipt.tenantId && w.id === values[0] && w.applicantCustomerId === values[1] && w.kind === 'corporate_application');
        return copy([{ requestId: row?.id ?? null, applicationWithdrawalKey: receipt.operationKey, withdrawalResult: receipt.result }]);
      }
      if (sql.includes('o.operationKey AS reviewKey')) {
        for (const predicate of ['w.tenantId=o.tenantId', 'w.id=$0', 'w.corporateCustomerId=$1', "w.kind='join_request'", 'o.tenantId=$2', 'o.operationKey=$3', 'o.actorUserId=$4', 'o.target=$5']) assert.ok(sql.includes(predicate));
        assert.equal(values[5], `join.review:${values[0]}`);
        const receipt = state.receipts.find(r => r.tenantId === values[2] && r.operationKey === values[3] && r.actorUserId === values[4] && r.target === values[5]);
        if (!receipt) return [];
        const row = state.workflows.find(w => w.tenantId === receipt.tenantId && w.id === values[0] && w.corporateCustomerId === values[1] && w.kind === 'join_request');
        return copy([{ requestId: row?.id ?? null, reviewKey: receipt.operationKey, reviewResult: receipt.result }]);
      }
      if (sql.includes('o.operationKey AS withdrawalKey')) {
        for (const predicate of ['w.tenantId=o.tenantId', 'w.id=$0', "w.kind='join_request'", 'w.applicantCustomerId=$1', 'o.tenantId=$2', 'o.operationKey=$3', 'o.actorUserId=$4', 'o.target=$5']) assert.ok(sql.includes(predicate));
        assert.equal(values[4], `customer:${values[1]}`); assert.equal(values[5], `join.withdraw:${values[0]}`);
        const receipt = state.receipts.find(r => r.tenantId === values[2] && r.operationKey === values[3] && r.actorUserId === values[4] && r.target === values[5]);
        if (!receipt) return [];
        const row = state.workflows.find(w => w.tenantId === receipt.tenantId && w.id === values[0] && w.kind === 'join_request' && w.applicantCustomerId === values[1]);
        return copy([{ requestId: row?.id ?? null, withdrawalKey: receipt.operationKey, withdrawalResult: receipt.result }]);
      }
      if (sql.includes('o.operationKey AS revokeKey')) {
        for (const predicate of ['i.tenantId=o.tenantId', 'i.id=$0', 'i.corporateCustomerId=$1', 'o.tenantId=$2', 'o.operationKey=$3', 'o.actorUserId=$4', 'o.target=$5']) assert.ok(sql.includes(predicate));
        assert.equal(values[5], `invite.revoke:${values[0]}`);
        const receipt = state.receipts.find(r => r.tenantId === values[2] && r.operationKey === values[3] && r.actorUserId === values[4] && r.target === values[5]);
        if (!receipt) return [];
        const invite = state.invites.find(i => i.tenantId === receipt.tenantId && i.id === values[0] && i.corporateCustomerId === values[1]);
        return copy([{ inviteId: invite?.id ?? null, revokeKey: receipt.operationKey, revokeResult: receipt.result }]);
      }
      if (sql.includes('o.operationKey AS adminKey')) {
        for (const predicate of ['FROM enterprise_portal_operations o', 'm.tenantId=o.tenantId', 'm.id=$0', 'm.corporateCustomerId=$1', 'o.tenantId=$2', 'o.operationKey=$3', 'o.actorUserId=$4', 'o.target=$5']) assert.ok(sql.includes(predicate), predicate);
        assert.equal(values[5], `administrator.change:${values[0]}`);
        assert.ok(!sql.includes('m.role=') && !sql.includes('m.updatedAt=') && !sql.includes('enterprise_portal_grants'), 'today grants/role are not this original receipt');
        const receipt = state.receipts.find(r => r.tenantId === values[2] && r.operationKey === values[3] && r.actorUserId === values[4] && r.target === values[5]);
        if (!receipt) return [];
        const row = state.relations.find(r => r.tenantId === receipt.tenantId && r.id === values[0] && r.corporateCustomerId === values[1]);
        const result = copy([{ membershipId: row?.id ?? null, adminKey: receipt.operationKey, adminResult: receipt.result }]);
        if (fault.afterAdministratorRead) fault.afterAdministratorRead(); return result;
      }
      if (sql.includes('o.operationKey AS changeKey')) {
        for (const predicate of ['FROM enterprise_portal_operations o', 'm.tenantId=o.tenantId', 'm.id=$0', 'm.corporateCustomerId=$1', 'o.tenantId=$2', 'o.operationKey=$3', 'o.actorUserId=$4', 'o.target=$5']) assert.ok(sql.includes(predicate), predicate);
        assert.equal(values[5], `member.change:${values[0]}`);
        assert.ok(!sql.includes('m.status=') && !sql.includes('m.updatedAt=') && !sql.includes('m.personalCustomerId'), 'current target state/PII is not receipt evidence');
        const receipt = state.receipts.find(r => r.tenantId === values[2] && r.operationKey === values[3] && r.actorUserId === values[4] && r.target === values[5]);
        if (!receipt) return [];
        const row = state.relations.find(r => r.tenantId === receipt.tenantId && r.id === values[0] && r.corporateCustomerId === values[1]);
        const result = copy([{ membershipId: row?.id ?? null, changeKey: receipt.operationKey, changeResult: receipt.result }]);
        if (fault.afterChangeRead) fault.afterChangeRead(); return result;
      }
      if (sql.includes('o.operationKey AS exitKey')) {
        for (const predicate of ['o.tenantId=m.tenantId', 'o.operationKey=$0', 'o.actorUserId=$1', 'o.target=$2', 'm.tenantId=$3', 'm.corporateCustomerId=$4', 'm.id=$5', 'm.personalCustomerId=$6']) assert.ok(sql.includes(predicate), predicate);
        assert.equal(values[1], `customer:${values[6]}`); assert.equal(values[2], `member.exit:${values[5]}`);
        assert.ok(!sql.includes("m.status='exited'") && !sql.includes('m.updatedAt='), 'current relationship state/revision is not evidence of this original key');
        const row = state.relations.find(r => r.tenantId === values[3] && r.corporateCustomerId === values[4] && r.id === values[5] && r.personalCustomerId === values[6]);
        if (!row) return [];
        const receipt = state.receipts.find(r => r.tenantId === row.tenantId && r.operationKey === values[0] && r.actorUserId === values[1] && r.target === values[2]);
        const result = copy([{ id: row.id, exitKey: receipt?.operationKey ?? null, exitResult: receipt?.result ?? null }]);
        if (fault.afterExitRead) fault.afterExitRead();
        return result;
      }
      if (sql.includes('FROM customer_corporate_memberships m')) {
        const rows = [];
        for (const r of state.relations) {
          const p = profileById(r.personalCustomerId), c = profileById(r.corporateCustomerId);
          const session = state.sessions.find(s => s.id === values[1] && s.customerId === p?.id && s.tenantId === r.tenantId && !s.revokedAt && s.expiresAt > new ClockDate());
          if (r.tenantId !== filters.tenantId || r.personalCustomerId !== filters.personalCustomerId || values[0] !== 'merchant' || !effective(r) || !eligible(p) || !eligible(c) || !session) continue;
          const grants = state.grants.filter(g => g.membershipId === r.id && g.tenantId === r.tenantId && g.corporateCustomerId === r.corporateCustomerId && +g.membershipUpdatedAt === +r.updatedAt);
          for (const g of grants.length ? grants : [{ action: null }]) rows.push({ corporateCustomerId: c.id, corporateName: c.name, membershipId: r.id, role: r.role, action: g.action, tenantRevision: state.tenantRevision, corporateRevision: state.corporateRevision, tenantEnabled: state.tenantEnabled, corporateEnabled: state.corporateEnabled });
        }
        return copy(rows);
      }
      if (sql.includes('FROM customer_profiles WHERE')) return [{ id: filters.id }];
      if (sql.includes('FROM customer_corporate_profiles WHERE') || sql.includes('FROM customer_corporate_credits WHERE')) return [{ id: 'original-source' }];
      if (sql.includes('LEFT JOIN enterprise_portal_operations o')) {
        for (const predicate of ['o.tenantId=w.tenantId', 'o.operationKey=$0', 'o.actorUserId=$1', 'o.target IN ($2,$3)', 'w.tenantId=$4', 'w.id=$5', 'w.applicantCustomerId=$6', "w.kind='administrator_transfer'"]) assert.ok(sql.includes(predicate), predicate);
        assert.equal(values[1], `customer:${values[6]}`); assert.equal(values[2], `administrator.accept:${values[5]}`); assert.equal(values[3], `administrator.decision.sealed:${values[5]}`);
        const workflow = state.workflows.find(w => w.tenantId === values[4] && w.id === values[5] && w.applicantCustomerId === values[6] && w.kind === 'administrator_transfer');
        if (!workflow) return [];
        const receipt = state.receipts.find(o => o.tenantId === workflow.tenantId && o.operationKey === values[0] && o.actorUserId === values[1] && [values[2], values[3]].includes(o.target));
        return copy([{ id: workflow.id, corporateCustomerId: workflow.corporateCustomerId, state: workflow.state, revision: workflow.revision, decisionKey: receipt?.operationKey ?? null, decisionResult: receipt?.result ?? null, decisionTarget: receipt?.target ?? null, decisionHash: receipt?.requestHash ?? null }]);
      }
      if (sql.includes('SELECT operationKey,result FROM enterprise_portal_operations') && values[3]?.startsWith('invite.create:')) {
        for (const predicate of ['tenantId=$0', 'operationKey=$1', 'actorUserId=$2', 'target=$3']) assert.ok(sql.includes(predicate), predicate);
        assert.ok(values[2].startsWith('customer:')); return copy(state.receipts.filter(r => match(r, filters)));
      }
      if (sql.includes('SELECT operationKey,result FROM enterprise_portal_operations')) {
        for (const predicate of ['tenantId=$0', 'operationKey=$1', 'actorUserId=$2', 'target=$3']) assert.ok(sql.includes(predicate), predicate);
        assert.ok(values[2].startsWith('customer:')); assert.ok(values[3].startsWith('administrator.transfer:'));
        return copy(state.receipts.filter(r => match(r, filters)));
      }
      if (sql.includes('operationKey AS saveKey')) {
        for (const predicate of ['tenantId=$0', 'operationKey=$1', 'actorUserId=$2', 'target=$3']) assert.ok(sql.includes(predicate)); assert.equal(values[3], 'application.save:self');
        return copy(state.receipts.filter(r => match(r, filters)).map(r => ({ saveKey: r.operationKey, saveResult: r.result })));
      }
      if (sql.includes('operationKey AS submissionKey')) {
        for (const predicate of ['tenantId=$0', 'operationKey=$1', 'actorUserId=$2', 'target=$3']) assert.ok(sql.includes(predicate)); assert.equal(values[3], 'join.submit:self');
        return copy(state.receipts.filter(r => match(r, filters)).map(r => ({ submissionKey: r.operationKey, submissionResult: r.result })));
      }
      if (sql.includes('FROM enterprise_portal_operations')) return copy(state.receipts.filter(r => match(r, filters)));
      if (sql.includes('FROM enterprise_scope_policies')) return [{ revision: 1 }];
      if (sql.includes('FROM enterprise_invite_policies')) return state.invitePolicy ? [{ revision: 1, policy: copy(state.invitePolicy) }] : [];
      if (sql.includes('FROM client_api_rate_buckets')) return copy(state.rates.filter(r => r.scopeKey === filters.scopeKey && +r.bucketStart === +filters.bucketStart));
      if (sql.includes('FROM enterprise_invites i')) {
        const invite = state.invites.find(row => row.tenantId === values[0] && row.tokenHash === values[1] && row.status === 'active' && row.expiresAt > new ClockDate());
        const company = invite && profileById(invite.corporateCustomerId);
        return invite && eligible(company) && state.tenantEnabled && state.corporateEnabled ? [{ corporateName: company.corporateName, expiresAt: invite.expiresAt }] : [];
      }
      if (sql.startsWith('SELECT id,corporateCustomerId FROM enterprise_invites')) {
        for (const predicate of ['tenantId=$0', 'id=$1', 'corporateCustomerId=$2']) assert.ok(sql.includes(predicate));
        assert.ok(!sql.includes('tokenHash') && !sql.includes('status=') && !sql.includes('used='));
        const result = state.invites.filter(r => match(r, filters)).map(r => ({ id: r.id, corporateCustomerId: r.corporateCustomerId }));
        if (fault.afterInviteCreationRead) fault.afterInviteCreationRead(); return copy(result);
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
        const result = copy(rows);
        if (sql.includes("kind='finance_request'") && filters.id && filters.applicantCustomerId && sql.startsWith('SELECT *')) fault.afterManagementDetailRead?.();
        if (sql.includes("kind='corporate_application'") && filters.id && values.length === 2 && sql.startsWith('SELECT *')) {
          for (const predicate of ['tenantId=$0', 'id=$1']) assert.ok(sql.includes(predicate));
          fault.afterMerchantApplicationMaterialRead?.();
        }
        if (sql.startsWith('SELECT id,kind,applicantCustomerId,corporateCustomerId,payload')) {
          for (const predicate of ['tenantId=$0', 'id=$1', 'corporateCustomerId=$2', "kind='administrator_transfer'"]) assert.ok(sql.includes(predicate));
          assert.ok(!sql.includes("state='pending'") && !sql.includes('revision='), 'later decisions never substitute for the initiating receipt');
          if (fault.afterInitiationRead) fault.afterInitiationRead();
        }
        return result;
      }
      if (sql.includes('FROM enterprise_portal_tenant_settings')) return [{ enabled: state.tenantEnabled, revision: state.tenantRevision }];
      if (sql.includes('FROM enterprise_portal_grants')) return copy(state.corporateEnabled ? state.grants.filter(g => g.tenantId === filters.tenantId && g.corporateCustomerId === filters.corporateCustomerId && g.membershipId === filters.membershipId && +g.membershipUpdatedAt === +filters.membershipUpdatedAt) : []);
      if (sql.includes('FROM enterprise_corporate_portals')) return state.tenantEnabled && state.corporateEnabled && eligible(profileById(filters.corporateCustomerId)) ? [{ id: filters.corporateCustomerId, revision: state.corporateRevision }] : [];
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
        else if (table === 'enterprise_portal_operations') {
          if (fault.operationKey === row.operationKey) throw new Error('Injected specific receipt failure');
          assert.equal(state.receipts.some(r => r.tenantId === row.tenantId && r.operationKey === row.operationKey), false, 'original tenant/key primary key remains unique');
          state.receipts.push({ createdAt: new ClockDate(), ...row });
        }
        else if (table === 'enterprise_portal_grants') { if (!fault.dropTargetGrant || row.membershipId === 'admin-r') state.grants.push(row); }
        else if (table === 'enterprise_corporate_portals') {
          const existing = state.portalMarkers.some(m => m.tenantId === row.tenantId && m.corporateCustomerId === row.corporateCustomerId);
          if (existing) state.corporateRevision++; else { state.portalMarkers.push({ tenantId: row.tenantId, corporateCustomerId: row.corporateCustomerId }); state.corporateRevision = Number(row.revision ?? 1); }
          state.corporateEnabled = true;
        }
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
        if (fault.workflowCAS) return 0;
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
      if (sql.startsWith('UPDATE enterprise_corporate_portals')) { if (sql.includes('revision=revision+1')) state.corporateRevision++; return 1; }
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

test('handoff request smoke: dedicated request and receipt commit, original replay, pending dedup, own scope, canonical projection and full rollback', async () => {
  require('reflect-metadata'); // Real DTO decorator prerequisite; no substitute validation or removed assertions.
  const {CreateEnterpriseRentalHandoffRequestDto}=load('apps/api/src/modules/enterprise/enterprise-request.dto.ts',{'class-transformer':require('class-transformer'),'@rental-os/shared':require('@rental-os/shared')});
  const validator=require('class-validator'),dto=change('dto-K',0,{confirm:true,materialKey:'original'});
  assert.equal(validator.validateSync(Object.assign(new CreateEnterpriseRentalHandoffRequestDto(),dto)).length,0);
  for(const patch of [{expectedRevision:1},{confirm:false},{confirm:'true'},{materialKey:''}])assert.ok(validator.validateSync(Object.assign(new CreateEnterpriseRentalHandoffRequestDto(),dto,patch)).length>0);
  const {EnterpriseRentalHandoffService}=load('apps/api/src/modules/enterprise/enterprise-rental-handoff.service.ts',{'../../common/request-identity':identity,'./enterprise-command.service':commandModule,'@rental-os/shared':require('@rental-os/shared')});
  const setup=()=>{
    const f=fixture();f.state.handoffs=[];f.orderState='renting';f.materialReads=0;
    f.material={orderId:'order-1',orderNo:'Original rental',orderUpdatedAt:'2026-11-02T00:00:00.000Z',workspaceCode:'s1',corporateCustomerId:'company',corporateMembershipId:'original-relation',membershipResolvedAt:'2026-11-01T00:00:00.000Z',membershipUpdatedAt:null,enterpriseContractAndPayer:true,subjects:{contract:'corporate',payer:'corporate',user:'self'},subjectBasis:'recorded_columns',scope:'current_workspace_original_own_order',readOnly:true};
    const query=f.db.$queryRaw,execute=f.db.$executeRaw;
    f.db.$queryRaw=async(strings,...values)=>{const {sql,bound}=sqlParts(strings,values),filters=bound(sql);
      if(sql.includes('FROM rental_orders')){assert.ok(sql.includes('FOR UPDATE'));assert.equal(filters.tenantId,'t1');assert.equal(filters.workspaceId,'w1');return filters.id==='order-1'?[{id:'order-1',status:f.orderState}]:[];}
      if(sql.includes('FROM enterprise_rental_handoff_requests')){assert.equal(filters.tenantId,'t1');assert.equal(filters.workspaceId,'w1');assert.equal(filters.applicantCustomerId,'p1');return f.state.handoffs.filter(r=>match(r,filters)&&(!sql.includes("state='pending'")||r.state==='pending'));}
      if(sql.includes('SELECT operationKey,result FROM enterprise_portal_operations')&&String(values[3]).startsWith('rental-handoff.create:'))return f.state.receipts.filter(r=>match(r,filters));
      return query(strings,...values);
    };
    f.db.$executeRaw=async(strings,...values)=>{const {sql}=sqlParts(strings,values);if(!sql.includes('INSERT INTO enterprise_rental_handoff_requests'))return execute(strings,...values);
      const [tenantId,workspaceId,id,orderId,applicantCustomerId,corporateCustomerId,corporateMembershipId,material,reason,pendingMarker]=values;
      f.state.handoffs.push({tenantId,workspaceId,id,orderId,applicantCustomerId,corporateCustomerId,corporateMembershipId,material,reason,pendingMarker,state:'pending',revision:1,createdAt:new ClockDate(),updatedAt:new ClockDate()});return 1;};
    f.client={...context('p1'),workspaceId:'w1',workspaceCode:'s1'};
    f.api=new EnterpriseRentalHandoffService(f.db,f.commands,{rentalHandoffMaterial:async(ctx,id,tx)=>{f.materialReads++;assert.equal(tx,f.db);if(f.materialFailure)throw f.materialFailure;return plain(f.material);}});
    f.as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn);
    f.input=key=>change(key,0,{confirm:true,materialKey:JSON.stringify(f.material)});return f;
  };
  const f=setup(),input=f.input('handoff-K'),created=await f.as(()=>f.api.create(f.client,'order-1',input));assert.equal(f.state.handoffs.length,1);assert.equal(f.state.receipts.length,1);assert.equal(f.state.relations.length,1);
  // MySQL JSON reorders properties: canonical projection retains the same key.
  const row=f.state.handoffs[0],parsed=JSON.parse(row.material);row.material=JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()));row.material=JSON.stringify({...JSON.parse(row.material),privateField:'must-not-leak'});
  const view=await f.as(()=>f.api.detail(f.client,created.id));assert.equal(view.material.privateField,undefined);assert.deepEqual(plain(view.material),f.material);
  const duplicate=await f.as(()=>f.api.create(f.client,'order-1',f.input('second-K')));assert.equal(duplicate.id,created.id);assert.equal(f.state.handoffs.length,1);
  f.materialFailure=new Error('current Core unavailable');row.state='reviewed';row.revision=2;assert.deepEqual(plain(await f.as(()=>f.api.create(f.client,'order-1',input))),plain(created));const reads=f.materialReads;
  assert.deepEqual(plain(await f.as(()=>f.api.readCreate(f.client,'order-1','handoff-K'))),{state:'committed',result:plain(created)});assert.equal(f.materialReads,reads);assert.deepEqual(plain(await f.as(()=>f.api.readCreate(f.client,'order-1','missing-K'))),{state:'not_recorded'});
  await rejectsStatus(f.as(()=>f.api.create(f.client,'order-1',{...input,reason:'different'})),409);
  const rollback=setup();rollback.fault.sql='INSERT INTO enterprise_portal_operations';await assert.rejects(rollback.as(()=>rollback.api.create(rollback.client,'order-1',rollback.input('rollback-K'))),/Injected storage failure/);assert.equal(rollback.state.handoffs.length,0);assert.equal(rollback.state.receipts.length,0);
  const changed=setup();const old=changed.input('changed-K');changed.material.orderUpdatedAt='2026-11-03T00:00:00.000Z';await rejectsStatus(changed.as(()=>changed.api.create(changed.client,'order-1',old)),409);assert.equal(changed.state.handoffs.length,0);
  const foreign=setup();await rejectsStatus(identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'other',userId:'p1',isSaasAdmin:false},()=>foreign.api.create(foreign.client,'order-1',foreign.input('bad-scope-K'))),403);assert.equal(foreign.counts.locks,0);
});

test('merchant handoff smoke: original workspace order range, frozen opinion, exact receipt and full rollback never change Core or original material', async () => {
  const {EnterpriseRentalHandoffService}=load('apps/api/src/modules/enterprise/enterprise-rental-handoff.service.ts',{'../../common/request-identity':identity,'./enterprise-command.service':commandModule,'@rental-os/shared':require('@rental-os/shared')});
  require('reflect-metadata');const {ReviewEnterpriseRentalHandoffRequestDto}=load('apps/api/src/modules/enterprise/enterprise-request.dto.ts',{'class-transformer':require('class-transformer'),'@rental-os/shared':require('@rental-os/shared')});const validator=require('class-validator');
  const setup=()=>{const f=fixture();f.orderReads=0;f.operator={...user,permissions:['rental-os:corporate:manage','rental-os:order:view','rental-os:order:operate']};
    const material={orderId:'order-1',orderNo:'Original rental',orderUpdatedAt:'2026-11-02T00:00:00.000Z',workspaceCode:'s1',corporateCustomerId:'company',corporateMembershipId:'original-relation',membershipResolvedAt:'2026-11-01T00:00:00.000Z',membershipUpdatedAt:null,enterpriseContractAndPayer:true,subjects:{contract:'corporate',payer:'corporate',user:'self'},subjectBasis:'recorded_columns',scope:'current_workspace_original_own_order',readOnly:true};
    f.state.handoffs=[{tenantId:'t1',workspaceId:'w1',id:'handoff-1',orderId:'order-1',applicantCustomerId:'p1',corporateCustomerId:'company',corporateMembershipId:'original-relation',state:'pending',revision:1,material:JSON.stringify(material),reason:'Original applicant reason',createdAt:new ClockDate(),updatedAt:new ClockDate()}];
    const query=f.db.$queryRaw,write=f.db.$executeRaw;
    f.db.$queryRaw=async(strings,...values)=>{const {sql,bound}=sqlParts(strings,values),filters=bound(sql);if(sql.includes('FROM enterprise_rental_handoff_requests')){assert.equal(filters.workspaceId,'w1');return f.state.handoffs.filter(r=>match(r,filters));}if(sql.includes('SELECT operationKey,result FROM enterprise_portal_operations')&&String(values[3]).startsWith('rental-handoff.review:'))return f.state.receipts.filter(r=>match(r,filters));return query(strings,...values);};
    f.db.$executeRaw=async(strings,...values)=>{const {sql,bound}=sqlParts(strings,values);if(!sql.startsWith('UPDATE enterprise_rental_handoff_requests'))return write(strings,...values);const filters=bound(sql.slice(sql.indexOf(' WHERE ')));const row=f.state.handoffs.find(r=>match(r,filters)&&r.state==='pending');if(!row)return 0;Object.assign(row,{state:'reviewed',revision:2,pendingMarker:null,merchantReviewReason:values[0],reviewedBy:values[1],reviewedAt:new ClockDate(),updatedAt:new ClockDate()});return 1;};
    f.service=new EnterpriseRentalHandoffService(f.db,f.commands,{rentalHandoffMaterial:()=>{throw new Error('Never reconstruct historical request');}},{findOrder:async(tenantId,id,tx)=>{f.orderReads++;assert.equal(tx,f.db);assert.equal(tenantId,'t1');return f.orderDenied?undefined:{id,tenantId};}});
    f.as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'operator',isSaasAdmin:false,dataScope:'all'},fn);
    f.input=async key=>change(key,1,{confirm:true,materialKey:JSON.stringify(await f.as(()=>f.service.merchantDetail(f.operator,'handoff-1')))});return f;};
  const f=setup(),input=await f.input('review-K'),before=JSON.parse(f.state.handoffs[0].material);assert.equal(validator.validateSync(Object.assign(new ReviewEnterpriseRentalHandoffRequestDto(),input)).length,0);for(const patch of [{confirm:false},{expectedRevision:0},{materialKey:''}])assert.ok(validator.validateSync(Object.assign(new ReviewEnterpriseRentalHandoffRequestDto(),input,patch)).length>0);
  const result=await f.as(()=>f.service.review(f.operator,'handoff-1',input));assert.deepEqual(plain(result),{id:'handoff-1',orderId:'order-1',state:'reviewed',revision:2,effect:'request_only_no_business_change'});assert.deepEqual(JSON.parse(f.state.handoffs[0].material),before);assert.equal(f.state.handoffs[0].reason,'Original applicant reason');assert.equal(f.state.receipts.length,1);
  const detail=await f.as(()=>f.service.merchantDetail(f.operator,'handoff-1'));assert.equal(detail.merchantReview.reason,input.reason);assert.deepEqual(plain(await f.as(()=>f.service.review(f.operator,'handoff-1',input))),plain(result));f.state.handoffs[0].state='withdrawn';assert.deepEqual(plain(await f.as(()=>f.service.readReview(f.operator,'handoff-1','review-K'))),{state:'committed',result:plain(result)});
  assert.deepEqual(plain(await f.as(()=>f.service.readReview(f.operator,'handoff-1','absent'))),{state:'not_recorded'});f.orderDenied=true;await rejectsStatus(f.as(()=>f.service.readReview(f.operator,'handoff-1','review-K')),404);
  const stale=setup(),frozen=await stale.input('stale-K');stale.state.handoffs[0].reason='Changed at same revision';await rejectsStatus(stale.as(()=>stale.service.review(stale.operator,'handoff-1',frozen)),409);assert.equal(stale.state.receipts.length,0);
  const rollback=setup(),r=await rollback.input('rollback-K');rollback.fault.sql='INSERT INTO enterprise_portal_operations';await assert.rejects(rollback.as(()=>rollback.service.review(rollback.operator,'handoff-1',r)),/Injected storage failure/);assert.equal(rollback.state.handoffs[0].state,'pending');assert.equal(rollback.state.handoffs[0].reviewedBy,undefined);assert.equal(rollback.state.receipts.length,0);
  const denied=setup();denied.operator.permissions=['rental-os:corporate:manage'];await rejectsStatus(denied.as(()=>denied.service.merchantDetail(denied.operator,'handoff-1')),403);assert.equal(denied.orderReads,0);
});

test('own handoff smoke: bounded personal feedback/task projection, pending withdrawal, original receipt and rollback do not change rental responsibility', async () => {
  require('reflect-metadata');const {WithdrawEnterpriseRentalHandoffRequestDto}=load('apps/api/src/modules/enterprise/enterprise-request.dto.ts',{'class-transformer':require('class-transformer'),'@rental-os/shared':require('@rental-os/shared')});const validator=require('class-validator');
  const {EnterpriseRentalHandoffService}=load('apps/api/src/modules/enterprise/enterprise-rental-handoff.service.ts',{'../../common/request-identity':identity,'./enterprise-command.service':commandModule,'@rental-os/shared':require('@rental-os/shared')});
  const setup=()=>{const f=fixture(),material={orderId:'order-1',orderNo:'Original rental',orderUpdatedAt:'2026-11-02T00:00:00.000Z',workspaceCode:'s1',corporateCustomerId:'company',corporateMembershipId:'original-relation',membershipResolvedAt:'2026-11-01T00:00:00.000Z',membershipUpdatedAt:null,enterpriseContractAndPayer:true,subjects:{contract:'corporate',payer:'corporate',user:'self'},subjectBasis:'recorded_columns',scope:'current_workspace_original_own_order',readOnly:true};f.state.handoffs=[{tenantId:'t1',workspaceId:'w1',id:'handoff-1',orderId:'order-1',applicantCustomerId:'p1',corporateCustomerId:'company',corporateMembershipId:'original-relation',state:'pending',revision:1,material:JSON.stringify(material),reason:'Original applicant reason',createdAt:new ClockDate(),updatedAt:new ClockDate()}];
    const query=f.db.$queryRaw,write=f.db.$executeRaw;f.db.$queryRaw=async(strings,...values)=>{const {sql,bound}=sqlParts(strings,values),filters=bound(sql);if(sql.includes('FROM enterprise_rental_handoff_requests')){assert.equal(filters.workspaceId,'w1');assert.equal(filters.applicantCustomerId,'p1');return f.state.handoffs.filter(r=>match(r,filters)).slice(0,sql.includes('LIMIT 201')?201:1000);}if(sql.includes('SELECT operationKey,result FROM enterprise_portal_operations')&&String(values[3]).startsWith('rental-handoff.withdraw:'))return f.state.receipts.filter(r=>match(r,filters));return query(strings,...values);};
    f.db.$executeRaw=async(strings,...values)=>{const {sql,bound}=sqlParts(strings,values);if(!sql.startsWith('UPDATE enterprise_rental_handoff_requests'))return write(strings,...values);const filters=bound(sql.slice(sql.indexOf(' WHERE ')));const row=f.state.handoffs.find(r=>match(r,filters)&&r.state==='pending');if(!row)return 0;Object.assign(row,{state:'withdrawn',revision:2,pendingMarker:null,updatedAt:new ClockDate()});return 1;};
    f.client={...context('p1'),workspaceId:'w1',workspaceCode:'s1'};f.api=new EnterpriseRentalHandoffService(f.db,f.commands,{},{});f.as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn);f.input=async key=>change(key,1,{confirm:true,materialKey:JSON.stringify(await f.as(()=>f.api.detail(f.client,'handoff-1')))});return f;};
  const f=setup();f.state.handoffs.push({...f.state.handoffs[0],id:'other-person',applicantCustomerId:'p2'},{...f.state.handoffs[0],id:'other-workspace',workspaceId:'w2'});assert.equal((await f.as(()=>f.api.mine(f.client))).length,1);const input=await f.input('withdraw-K');assert.equal(validator.validateSync(Object.assign(new WithdrawEnterpriseRentalHandoffRequestDto(),input)).length,0);for(const patch of [{confirm:false},{expectedRevision:0},{materialKey:''}])assert.ok(validator.validateSync(Object.assign(new WithdrawEnterpriseRentalHandoffRequestDto(),input,patch)).length>0);
  const oldMaterial=f.state.handoffs[0].material,result=await f.as(()=>f.api.withdraw(f.client,'handoff-1',input));assert.deepEqual(plain(result),{id:'handoff-1',orderId:'order-1',state:'withdrawn',revision:2,effect:'request_only_no_business_change'});assert.equal(f.state.handoffs[0].material,oldMaterial);assert.equal(f.state.handoffs[0].reason,'Original applicant reason');assert.deepEqual(plain(await f.as(()=>f.api.withdraw(f.client,'handoff-1',input))),plain(result));f.state.handoffs[0].state='pending';assert.deepEqual(plain(await f.as(()=>f.api.readWithdrawal(f.client,'handoff-1','withdraw-K'))),{state:'committed',result:plain(result)});assert.deepEqual(plain(await f.as(()=>f.api.readWithdrawal(f.client,'handoff-1','absent'))),{state:'not_recorded'});
  const stale=setup(),old=await stale.input('stale-K');stale.state.handoffs[0].reason='Changed original request';await rejectsStatus(stale.as(()=>stale.api.withdraw(stale.client,'handoff-1',old)),409);assert.equal(stale.state.receipts.length,0);
  const reviewed=setup(),reviewInput=await reviewed.input('reviewed-K');Object.assign(reviewed.state.handoffs[0],{state:'reviewed',revision:2,merchantReviewReason:'Coordinate return',reviewedBy:'operator',reviewedAt:new ClockDate()});await rejectsStatus(reviewed.as(()=>reviewed.api.withdraw(reviewed.client,'handoff-1',reviewInput)),409);
  const tasks=new EnterpriseTaskCenterService(reviewed.db,reviewed.commands,{mine:async()=>[]},{joinRequests:async()=>[]},{list:async()=>[]},{},{mine:async()=>[]},{list:async()=>[]},{list:async()=>[]},{mine: context => reviewed.api.mine(context), orderSource: async () => ({ state: 'unavailable', coverage: 'current_workspace_original_own_enterprise_employee_orders' })});const item=(await reviewed.as(()=>tasks.tasks(reviewed.client))).items[0];assert.equal(item.kind,'rental_handoff');assert.equal(item.page,'join');assert.equal(item.requiresAction,true);assert.equal(JSON.stringify(item).includes('Coordinate return'),false);
  const bounded=setup();for(let i=0;i<200;i++)bounded.state.handoffs.push({...bounded.state.handoffs[0],id:`older-${i}`});await rejectsStatus(bounded.as(()=>bounded.api.mine(bounded.client)),409);assert.equal((await bounded.as(()=>bounded.api.detail(bounded.client,'handoff-1'))).id,'handoff-1');
  const rollback=setup(),r=await rollback.input('rollback-K');rollback.fault.sql='INSERT INTO enterprise_portal_operations';await assert.rejects(rollback.as(()=>rollback.api.withdraw(rollback.client,'handoff-1',r)),/Injected storage failure/);assert.equal(rollback.state.handoffs[0].state,'pending');assert.equal(rollback.state.receipts.length,0);
});

test('membership audit smoke: original corporate association and receipt results, scoped count and current action revocation', async () => {
  const shared=require('@rental-os/shared'),{EnterpriseMembershipAuditService}=load('apps/api/src/modules/enterprise/enterprise-membership-audit.service.ts',{'@rental-os/shared':shared,'../../common/request-identity':identity,'./enterprise-command.service':commandModule});
  const f=fixture(),employee=relation('employee-a','p1');f.state.relations.push(employee);
  await f.as('admin',()=>f.members.changeMember(context('admin'),'company',employee.id,change('member-audit-K',0,{status:'suspended',expectedUpdatedAt:employee.updatedAt.toISOString()})));
  const raw=f.state.receipts.find(r=>r.operationKey==='member-audit-K'),saved={...raw,result:typeof raw.result==='string'?JSON.parse(raw.result):plain(raw.result),createdAt:raw.createdAt};employee.status='active';
  let allowed=true,accessReads=0,changed=false,reads=0;
  const access={requireAction:async(_ctx,corp,action)=>{accessReads++;assert.equal(corp,'company');assert.equal(action,'audit:read');if(!allowed)throw new common.ForbiddenException('Audit removed');return{membershipId:'admin-rel',permissionRevision:changed&&accessReads%2===0?'1:2':'1:1'};}};
  const query=f.db.$queryRaw;f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(sql.includes('AS auditObjectId'))return [];if(!sql.includes('m.id AS membershipId,o.operationKey'))return query(strings,...values);reads++;assert.deepEqual(values,['t1','company']);assert(sql.includes("o.actorUserId LIKE 'customer:%'"));assert(sql.includes('LIMIT 201'));const rows=[];for(const r of f.state.receipts){const target=f.state.relations.find(m=>m.tenantId==='t1'&&m.corporateCustomerId==='company'&&['member.change','member.exit','administrator.change'].some(a=>r.target===a+':'+m.id));if(target&&r.tenantId==='t1'&&r.actorUserId.startsWith('customer:'))rows.push({...r,membershipId:target.id,corporateCustomerId:'company',privateField:'never-projected'});}return rows.slice(0,201);};
  const service=new EnterpriseMembershipAuditService(f.db,access),as=fn=>identity.runWithRequestIdentity({tenantId:'t1',userId:'admin',isSaasAdmin:false},fn);
  const value=await as(()=>service.read(context('admin'),'company'));assert.equal(value.items.length,1);assert.equal(value.items[0].result.status,'suspended');assert.equal(value.items[0].privateField,undefined);assert.equal(value.items[0].result.updatedAt,saved.result.updatedAt);assert.equal(value.coverage,'original_member_and_administrator_commands');assert(value.unavailable.includes('order_and_financial_audit'));
  f.state.relations.push(relation('foreign-member','p2','employee','other-company'));f.state.receipts.push({...saved,operationKey:'foreign-K',target:'member.change:foreign-member'},{...saved,operationKey:'internal-K',actorUserId:'operator:operator'});assert.equal((await as(()=>service.read(context('admin'),'company'))).items.length,1);
  changed=true;await rejectsStatus(as(()=>service.read(context('admin'),'company')),403);changed=false;allowed=false;const before=reads;await rejectsStatus(as(()=>service.read(context('admin'),'company')),403);assert.equal(reads,before);allowed=true;
  f.state.receipts=[{...saved}];f.state.receipts[0].result={...saved.result,membershipId:'wrong-member'};await rejectsStatus(as(()=>service.read(context('admin'),'company')),409);f.state.receipts=Array.from({length:201},(_,n)=>({...saved,operationKey:`audit-${n}`}));await rejectsStatus(as(()=>service.read(context('admin'),'company')),409);
  const rows=reads;await rejectsStatus(identity.runWithRequestIdentity({tenantId:'other',userId:'admin',isSaasAdmin:false},()=>service.read(context('admin'),'company')),403);assert.equal(reads,rows);assert.equal(shared.enterpriseMembershipAuditSnapshot({...value,items:[...value.items,...value.items]},'merchant','company'),undefined);
});

test('retained merge messages smoke: original target only, no source/diff/authority, bounded and live personal credential', async () => {
 const f=fixture(),shared=require('@rental-os/shared'),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),base={tenantId:'t1',targetCustomerId:'p1',id:'merge-a',mergedAt:new ClockDate('2026-11-01T00:00:00.000Z'),associationState:'distinct',sourceCustomerId:'private-person',fieldDiff:'private-diff',reason:'private-reason'};let rows=[base],after;const original=f.db.$queryRaw;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('FROM customer_merge_mappings m'))return original(strings,...values);assert.deepEqual(values,['t1','p1']);assert(sql.includes('m.targetCustomerId=?'));assert(sql.includes('CASE WHEN m.sourceCustomerId<>m.targetCustomerId'));assert(sql.includes('LIMIT 201'));for(const key of ['m.reason','m.fieldDiff','m.membershipSnapshot','m.operator','m.approver','SELECT *','customer_sensitive_access_audits','enterprise_portal_grants'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;};
 const service=new EnterpriseTaskCenterService(f.db,f.commands),value=await as(()=>service.retainedMergeMessages(ctx));assert.equal(value.items.length,1);assert.equal(value.items[0].mergedAt,'2026-11-01T00:00:00.000Z');assert.equal(value.items[0].effect,'retained_master_record_only');assert(!JSON.stringify(value).includes('private-'));assert(!JSON.stringify(value).includes('sourceCustomerId'));assert(shared.enterpriseOwnRetainedMergeMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnRetainedMergeMessagesSnapshot(value,'merchant','p2'),undefined);assert.equal(shared.enterpriseOwnRetainedMergeMessagesSnapshot({...value,items:[value.items[0],value.items[0]]},'merchant','p1'),undefined);assert.equal(shared.enterpriseOwnRetainedMergeMessagesSnapshot({...value,items:[{...value.items[0],effect:'authority_transferred'}]},'merchant','p1'),undefined);
 rows=[{...base,targetCustomerId:'p2'}];await rejectsStatus(as(()=>service.retainedMergeMessages(ctx)),409);rows=[{...base,associationState:'invalid'}];await rejectsStatus(as(()=>service.retainedMergeMessages(ctx)),409);rows=[{...base,mergedAt:new ClockDate(NaN)}];await rejectsStatus(as(()=>service.retainedMergeMessages(ctx)),409);rows=Array.from({length:201},(_,n)=>({...base,id:'overflow-'+n}));await rejectsStatus(as(()=>service.retainedMergeMessages(ctx)),409);rows=[base];
 f.state.grants=[];const person=f.state.profiles.find(p=>p.id==='p1');person.membership.status='suspended';assert.equal((await as(()=>service.retainedMergeMessages(ctx))).items.length,1);person.mergedIntoCustomerId='p2';person.status='merged';await rejectsStatus(as(()=>service.retainedMergeMessages(ctx)),403);person.mergedIntoCustomerId=null;person.status='active';after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(()=>service.retainedMergeMessages(ctx)),403);assert.equal(f.counts.writes,0);
});

test('own employee policy messages smoke: retained original target, scalar metadata, unavailable history and current personal credential', async () => {
 const shared=require('@rental-os/shared'),f=fixture(),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),service=new EnterpriseTaskCenterService(f.db,f.commands),original=f.db.$queryRaw,time='2026-11-01T00:00:00.000Z',base={tenantId:'t1',recipientCustomerId:'p1',corporateCustomerId:'company',membershipId:'original-member',associatedScope:'member:original-member',operationKey:'policy-a-K',actorUserId:'customer:admin-original',target:'policy.company:company:original-member',createdAt:new ClockDate(time),result:{scopeKey:'member:original-member',revision:1,membershipUpdatedAt:time,policy:{private:'not-public'}},reason:'private'};let rows=[base],after;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('AS associatedScope'))return original(strings,...values);assert.deepEqual(values,['t1','p1']);assert(sql.includes('LIMIT 201'));assert(sql.includes("o.target=CONCAT('policy.company:',m.corporateCustomerId,':',m.id)"));for(const key of ['o.reason','p.policy','p.revision','m.updatedAt','m.status','m.role','enterprise_portal_grants'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;};
 const writes=f.counts.writes,value=await as(()=>service.employeePolicyMessages(ctx));assert.equal(value.items.length,1);assert.equal(value.items[0].revision,1);assert.equal(value.items[0].membershipUpdatedAt,time);assert(!JSON.stringify(value).includes('private'));assert(!JSON.stringify(value).includes('actorUserId'));assert(shared.enterpriseOwnEmployeePolicyMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnEmployeePolicyMessagesSnapshot({...value,unavailable:[]},'merchant','p1'),undefined);
 for(const delta of [{recipientCustomerId:'p2'},{associatedScope:null},{target:'policy.company:company:other-member'},{actorUserId:'operator:other'},{result:{scopeKey:'member:other',revision:1,membershipUpdatedAt:time}},{result:{scopeKey:'member:original-member',revision:0,membershipUpdatedAt:time}},{result:{scopeKey:'member:original-member',revision:1}},{result:{scopeKey:'member:original-member',revision:1,membershipUpdatedAt:'2026-02-30T00:00:00.000Z'}}]){rows=[{...base,...delta}];await rejectsStatus(as(()=>service.employeePolicyMessages(ctx)),409);}
 rows=Array.from({length:201},(_,n)=>({...base,operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.employeePolicyMessages(ctx)),409);rows=[base,base];await rejectsStatus(as(()=>service.employeePolicyMessages(ctx)),409);rows=[base];f.state.grants=[];f.state.profiles.find(p=>p.id==='p1').membership.status='suspended';assert.equal((await as(()=>service.employeePolicyMessages(ctx))).items.length,1);after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(()=>service.employeePolicyMessages(ctx)),403);assert.equal(f.counts.writes,writes);
});

test('own corporate status messages smoke: original captured recipient only, missing source unavailable, bounded and live personal credential', async () => {
 const shared=require('@rental-os/shared'),f=fixture(),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),service=new EnterpriseTaskCenterService(f.db,f.commands),original=f.db.$queryRaw,time='2026-11-01T00:00:00.000Z',base={tenantId:'t1',recipientCustomerId:'p1',historyId:'event-a',sourceHistoryId:'event-a',corporateCustomerId:'company',sourceCompanyId:'company',scope:'membership',membershipId:'original-member',membershipUpdatedAt:new ClockDate(time),capturedAt:new ClockDate(time),at:new ClockDate(time),action:'suspend',fromStatus:'active',toStatus:'suspended',internalReason:'private'};let rows=[base],after,missing=false;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('FROM enterprise_corporate_status_recipients r'))return original(strings,...values);assert.deepEqual(values,['t1','p1']);assert(sql.includes('LIMIT 201'));for(const key of ['customer_corporate_memberships','enterprise_portal_grants','h.reason','h.operator','h.approver'])assert(!sql.includes(key));if(missing)throw new Prisma.PrismaClientKnownRequestError('Synthetic missing table',{code:'P2010',clientVersion:'fixture',meta:{code:'1146'}});const result=rows.map(r=>({...r}));after?.();return result;};
 const writes=f.counts.writes,value=await as(()=>service.corporateStatusMessages(ctx));assert.equal(value.items.length,1);assert.equal(value.items[0].toStatus,'suspended');assert.equal(value.items[0].membershipUpdatedAt,time);assert(!JSON.stringify(value).includes('internalReason'));assert.equal(value.unavailable[0],'uncaptured_corporate_status_history');assert(shared.enterpriseOwnCorporateStatusMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnCorporateStatusMessagesSnapshot({...value,unavailable:[]},'merchant','p1'),undefined);
 rows=[{...base,recipientCustomerId:'p2'}];await rejectsStatus(as(()=>service.corporateStatusMessages(ctx)),409);rows=[{...base,sourceCompanyId:'other'}];await rejectsStatus(as(()=>service.corporateStatusMessages(ctx)),409);rows=[{...base,scope:'account'}];await rejectsStatus(as(()=>service.corporateStatusMessages(ctx)),409);rows=[{...base,toStatus:'made-up'}];await rejectsStatus(as(()=>service.corporateStatusMessages(ctx)),409);rows=Array.from({length:201},(_,n)=>({...base,historyId:'overflow-'+n,sourceHistoryId:'overflow-'+n}));await rejectsStatus(as(()=>service.corporateStatusMessages(ctx)),409);rows=[base,base];await rejectsStatus(as(()=>service.corporateStatusMessages(ctx)),409);rows=[base];missing=true;await rejectsStatus(as(()=>service.corporateStatusMessages(ctx)),503);missing=false;f.state.grants=[];f.state.profiles.find(p=>p.id==='p1').membership.status='suspended';assert.equal((await as(()=>service.corporateStatusMessages(ctx))).items.length,1);after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(()=>service.corporateStatusMessages(ctx)),403);assert.equal(f.counts.writes,writes);
});

test('own status messages smoke: original own states only, no private reasons/current authority, bounded source and live credential', async () => {
 const f=fixture(),shared=require('@rental-os/shared'),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),base={tenantId:'t1',customerId:'p1',at:new ClockDate('2026-11-01T00:00:00.000Z')};let rows=[{...base,id:'status-a',scope:'membership',action:'suspend',fromStatus:'active',toStatus:'suspended',reason:'private-risk-reason',operator:'private-operator'},{...base,id:'status-b',scope:'account',action:'release',fromStatus:'suspended',toStatus:'active'},{...base,id:'status-c',scope:'membership',action:'activate',fromStatus:null,toStatus:'active'}],after;const original=f.db.$queryRaw;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('FROM customer_status_history h'))return original(strings,...values);assert.deepEqual(values,['t1','p1']);assert(sql.includes("h.scope IN ('account','membership')"));assert(sql.includes('LIMIT 201'));for(const key of ['h.reason','h.operator','h.approver','SELECT *','customer_sensitive_access','customer_merge','enterprise_portal_grants'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;};
 const service=new EnterpriseTaskCenterService(f.db,f.commands),value=await as(()=>service.statusMessages(ctx));assert.equal(value.items.length,3);assert.equal(value.items[0].toStatus,'suspended');assert.equal(value.items[2].fromStatus,undefined);assert.equal(value.delivery,'not_reported');assert.equal(value.readState,'not_recorded');assert(!JSON.stringify(value).includes('private-'));assert(shared.enterpriseOwnStatusMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnStatusMessagesSnapshot(value,'merchant','p2'),undefined);assert.equal(shared.enterpriseOwnStatusMessagesSnapshot({...value,items:[value.items[0],value.items[0]]},'merchant','p1'),undefined);assert.equal(shared.enterpriseOwnStatusMessagesSnapshot({...value,items:[{...value.items[0],scope:'workspace'}]},'merchant','p1'),undefined);assert.equal(shared.enterpriseOwnStatusMessagesSnapshot({...value,items:[{...value.items[0],action:'merge'}]},'merchant','p1'),undefined);
 const initial=rows;rows=[{...initial[0],customerId:'p2'}];await rejectsStatus(as(()=>service.statusMessages(ctx)),409);rows=[{...initial[0],toStatus:'made-up'}];await rejectsStatus(as(()=>service.statusMessages(ctx)),409);rows=[{...initial[0],at:new ClockDate(NaN)}];await rejectsStatus(as(()=>service.statusMessages(ctx)),409);rows=Array.from({length:201},(_,n)=>({...initial[0],id:'overflow-'+n}));await rejectsStatus(as(()=>service.statusMessages(ctx)),409);rows=initial;
 f.state.grants=[];f.state.profiles.find(p=>p.id==='p1').membership.status='suspended';assert.equal((await as(()=>service.statusMessages(ctx))).items[0].toStatus,'suspended');f.state.profiles.find(p=>p.id==='p1').account.status='suspended';await rejectsStatus(as(()=>service.statusMessages(ctx)),403);f.state.profiles.find(p=>p.id==='p1').account.status='active';after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(()=>service.statusMessages(ctx)),403);assert.equal(f.counts.writes,0);
});

test('transfer messages smoke: both original parties, canonical K/C and personal scope without current grant or business writes', async () => {
 const f=fixture(),shared=require('@rental-os/shared'),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},admin={...ctx,customerId:'admin',sessionId:'session-admin'},as=(c,fn)=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:c.customerId,isSaasAdmin:false},fn);
 const base={tenantId:'t1',corporateCustomerId:'company',objectType:'administrator_transfer',applicantCustomerId:'p1',association:{fromCustomerId:'admin',targetMembershipId:'employee-a',authorityBasis:'never-exposed'},reason:'Original reason',createdAt:new ClockDate('2026-11-01T00:00:00.000Z')},closed={version:1,purpose:'administrator_transfer_resolution',outcome:'closed',tenantId:'t1',corporateCustomerId:'company',applicantCustomerId:'p1',transferId:'transfer-2',originalOperationKey:'seal-K',closureOperationKey:'close-C',decision:{id:'transfer-2',state:'rejected',revision:2},retryable:false},hash=enterpriseHash({action:'administrator.decision.sealed',...closed}),observed={...closed,outcome:'observed',transferId:'transfer-1',originalOperationKey:'decision-K',closureOperationKey:'observe-C',decision:{id:'transfer-1',state:'approved',revision:2}};
 const created=(id,key)=>({...base,auditObjectId:id,operationKey:key,actorUserId:'customer:admin',target:'administrator.transfer:company',result:{id,state:'pending',revision:1}});
 let rows=[created('transfer-1','create-one-K'),created('transfer-2','create-two-K'),{...base,auditObjectId:'transfer-1',operationKey:'decision-K',actorUserId:'customer:p1',target:'administrator.accept:transfer-1',result:{id:'transfer-1',state:'approved',revision:2,privateField:'never-exposed'}},
 {...base,auditObjectId:'transfer-2',operationKey:'seal-K',actorUserId:'customer:p1',target:'administrator.decision.sealed:transfer-2',result:Object.fromEntries(Object.entries(closed).reverse()),requestHash:hash},
 {...base,auditObjectId:'transfer-2',operationKey:'close-C',actorUserId:'customer:p1',target:'administrator.decision.close:'+enterpriseHash({transferId:'transfer-2',originalOperationKey:'seal-K'}),result:closed,originalTarget:'administrator.decision.sealed:transfer-2',originalResult:closed,originalHash:hash},
 {...base,auditObjectId:'transfer-1',operationKey:'observe-C',actorUserId:'customer:p1',target:'administrator.decision.close:'+enterpriseHash({transferId:'transfer-1',originalOperationKey:'decision-K'}),result:observed,originalTarget:'administrator.accept:transfer-1',originalResult:{id:'transfer-1',state:'approved',revision:2}}],after;const original=f.db.$queryRaw;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('JSON_OBJECT('))return original(strings,...values);assert(values.includes('t1'));assert(sql.includes('w.applicantCustomerId=?'));assert(sql.includes("'$.fromCustomerId'))=?"));assert(sql.includes('LIMIT 201'));for(const key of ['w.state','w.revision','w.payload AS association','enterprise_portal_grants','authorityBasis','SELECT *'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;};
 const service=new EnterpriseTaskCenterService(f.db,f.commands),value=await as(ctx,()=>service.transferMessages(ctx)),outgoing=await as(admin,()=>service.transferMessages(admin));assert.equal(value.items.length,6);assert(value.items.every(r=>r.participation==='recipient'));assert(outgoing.items.every(r=>r.participation==='initiator'));assert.equal(value.items.find(r=>r.receipt.operationKey==='create-one-K').receipt.result.state,'pending');assert.equal(value.items.find(r=>r.receipt.operationKey==='observe-C').receipt.result.outcome,'observed');assert.equal(value.items.find(r=>r.receipt.operationKey==='seal-K').receipt.result.outcome,'closed');for(const key of ['authorityBasis','originalOperationKey','closureOperationKey','requestHash','privateField'])assert(!JSON.stringify(value).includes(key));assert(shared.enterpriseOwnTransferMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnTransferMessagesSnapshot(value,'merchant','p2'),undefined);assert.equal(shared.enterpriseOwnTransferMessagesSnapshot({...value,items:[value.items[0],value.items[0]]},'merchant','p1'),undefined);assert.equal(shared.enterpriseOwnTransferMessagesSnapshot({...value,items:[{...value.items[0],participation:'initiator'}]},'merchant','p1'),undefined);
 const initial=rows;rows=[{...initial[2],association:{fromCustomerId:'another',targetMembershipId:'employee-a'},applicantCustomerId:'someone-else'}];await rejectsStatus(as(ctx,()=>service.transferMessages(ctx)),409);rows=[{...initial[2],association:{targetMembershipId:'employee-a'}}];await rejectsStatus(as(ctx,()=>service.transferMessages(ctx)),409);rows=[{...initial[3],requestHash:'bad'}];await rejectsStatus(as(ctx,()=>service.transferMessages(ctx)),409);rows=[{...initial[5],originalResult:{id:'transfer-1',state:'rejected',revision:2}}];await rejectsStatus(as(ctx,()=>service.transferMessages(ctx)),409);rows=[{...initial[0],auditObjectId:null}];await rejectsStatus(as(ctx,()=>service.transferMessages(ctx)),409);rows=Array.from({length:201},(_,n)=>({...initial[0],operationKey:'overflow-'+n}));await rejectsStatus(as(ctx,()=>service.transferMessages(ctx)),409);rows=initial;
 f.state.grants=[];f.state.profiles.find(p=>p.id==='p1').membership.status='suspended';assert.equal((await as(ctx,()=>service.transferMessages(ctx))).items.length,6);after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(ctx,()=>service.transferMessages(ctx)),403);assert.equal(f.counts.writes,0);
});

test('relationship messages smoke: recipient original result and no current state/grant fallback, bounded source and revoked personal session', async () => {
 const f=fixture(),shared=require('@rental-os/shared'),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),time='2026-11-01T00:00:00.000Z',base={tenantId:'t1',corporateCustomerId:'company',recipientCustomerId:'p1',membershipId:'original-rel',createdAt:new ClockDate(time),reason:'Original recorded reason'};let after,rows=[{...base,operationKey:'state-K',actorUserId:'customer:admin',target:'member.change:original-rel',result:{membershipId:'original-rel',status:'suspended',updatedAt:time}},{...base,operationKey:'authority-K',actorUserId:'customer:admin',target:'administrator.change:original-rel',result:{membershipId:'original-rel',role:'employee',actions:[],updatedAt:time,revision:2}},{...base,operationKey:'exit-K',actorUserId:'customer:p1',target:'member.exit:original-rel',result:{membershipId:'original-rel',status:'exited',updatedAt:time}}],original=f.db.$queryRaw;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('AS recipientCustomerId'))return original(strings,...values);assert.deepEqual(values,['t1','p1']);assert(sql.includes('m.personalCustomerId=?'));assert(sql.includes('LIMIT 201'));for(const v of ['m.status','m.role','enterprise_portal_grants','o.requestHash'])assert(!sql.includes(v));const result=rows.map(r=>({...r}));after?.();return result;};
 const service=new EnterpriseTaskCenterService(f.db,f.commands),value=await as(()=>service.relationshipMessages(ctx));assert.equal(value.items.length,3);assert.equal(value.items[0].receipt.result.status,'suspended');assert.equal(value.items[1].receipt.result.role,'employee');assert.equal(value.items[2].receipt.result.status,'exited');assert(shared.enterpriseOwnRelationshipMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnRelationshipMessagesSnapshot(value,'merchant','p2'),undefined);assert.equal(value.delivery,'not_reported');assert.equal(value.readState,'not_recorded');const initial=rows;rows=[{...initial[0],recipientCustomerId:'p2'}];await rejectsStatus(as(()=>service.relationshipMessages(ctx)),409);rows=[{...initial[2],actorUserId:'customer:admin'}];await rejectsStatus(as(()=>service.relationshipMessages(ctx)),409);rows=Array.from({length:201},(_,n)=>({...initial[0],operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.relationshipMessages(ctx)),409);rows=initial;
 after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(()=>service.relationshipMessages(ctx)),403);after=undefined;f.state.sessions.find(s=>s.customerId==='p1').revokedAt=null;f.state.grants=[];f.state.profiles.find(p=>p.id==='p1').membership.status='suspended';assert.equal((await as(()=>service.relationshipMessages(ctx))).items.length,3);assert.equal(f.counts.writes,0);
});

test('approval notices smoke: original own states, explicit nonself current review scope and late revocation', async () => {
 const f=fixture(),shared=require('@rental-os/shared'),base={tenantId:'t1',workspaceId:'w1',corporateCustomerId:'company',applicantCustomerId:'p1',revision:2,createdAt:new ClockDate('2026-11-01T00:00:00.000Z'),expiresAt:new ClockDate('2099-01-01T00:00:00.000Z'),decisionReason:null},ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},admin={...context('admin'),workspaceId:'w1',workspaceCode:'s1'},as=(c,fn)=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:c.customerId,isSaasAdmin:false},fn);
 let rows=[{...base,id:'booking-own',noticeKind:'booking_approval',state:'approved',privateField:'never-rendered'},{...base,id:'extension-own',noticeKind:'extension_approval',state:'consumed',decisionReason:'Original recorded result'},{...base,id:'exchange-own',noticeKind:'exchange_approval',state:'rejected'},{...base,id:'expired-pending',noticeKind:'booking_approval',state:'pending',expiresAt:new ClockDate('2026-11-01T01:00:00.000Z')},{...base,id:'review-pending',noticeKind:'booking_approval',state:'pending'},{...base,id:'self-review',noticeKind:'exchange_approval',state:'pending',applicantCustomerId:'admin'},{...base,id:'other-space',noticeKind:'booking_approval',state:'pending',workspaceId:'w2'}],after;const original=f.db.$queryRaw;
 f.db.$queryRaw=async(strings,...values)=>{const parts=sqlParts(strings,values),sql=parts.sql;if(!sql.includes('AS noticeKind'))return original(strings,...values);assert(sql.includes('a.tenantId=$0'));assert(sql.includes('a.workspaceId=$1'));assert(sql.includes('LIMIT 201'));for(const key of ['a.amount','a.orderId','a.quote','a.preview','a.request','employeeConfirmedAt'])assert(!sql.includes(key));const kind=sql.includes("'booking_approval'")?'booking_approval':sql.includes("'extension_approval'")?'extension_approval':'exchange_approval',review=sql.includes('a.applicantCustomerId<>');let r=rows.filter(r=>r.tenantId===parts.values[0]&&r.workspaceId===parts.values[1]&&r.noticeKind===kind);r=review?r.filter(r=>r.corporateCustomerId===parts.values[2]&&r.applicantCustomerId!==parts.values[3]&&r.state==='pending'&&r.expiresAt>new ClockDate()):r.filter(r=>r.applicantCustomerId===parts.values[2]);const selected=r.slice(0,201).map(v=>({...v,decisionReason:review||kind==='booking_approval'?null:v.decisionReason}));after?.();return selected;};
 const service=new EnterpriseTaskCenterService(f.db,f.commands,undefined,undefined,undefined,new EnterpriseAccessService(f.db)),own=await as(ctx,()=>service.approvalNotices(ctx));assert.equal(own.items.length,5);assert.equal(own.items.find(r=>r.approvalId==='expired-pending').state,'pending');assert.equal(own.items.find(r=>r.approvalId==='extension-own').feedback,'Original recorded result');assert(!JSON.stringify(own).includes('privateField'));assert(!JSON.stringify(own).includes('applicantCustomerId'));assert(shared.enterpriseApprovalNoticesSnapshot(own,{tenantCode:'merchant',customerId:'p1',workspaceCode:'s1'}));assert.equal(shared.enterpriseApprovalNoticesSnapshot(own,{tenantCode:'merchant',customerId:'p1',workspaceCode:'s2'}),undefined);
 await rejectsStatus(as(admin,()=>service.approvalNotices(admin,'company')),403);f.state.grants.push({...f.state.grants[0],action:'approvals:review'});const queue=await as(admin,()=>service.approvalNotices(admin,'company'));assert.deepEqual(queue.items.map(r=>r.approvalId),['review-pending']);assert.equal(queue.permissionRevision,'1:1');assert(shared.enterpriseApprovalNoticesSnapshot(queue,{tenantCode:'merchant',customerId:'admin',workspaceCode:'s1',corporateCustomerId:'company',permissionRevision:'1:1'}));assert.equal(shared.enterpriseApprovalNoticesSnapshot({...queue,items:[{...queue.items[0],feedback:'private'}]},{tenantCode:'merchant',customerId:'admin',workspaceCode:'s1',corporateCustomerId:'company',permissionRevision:'1:1'}),undefined);
 after=()=>{f.state.grants=f.state.grants.filter(g=>g.action!=='approvals:review');};await rejectsStatus(as(admin,()=>service.approvalNotices(admin,'company')),403);after=undefined;const normal=rows;rows=Array.from({length:201},(_,n)=>({...base,id:'overflow-'+n,noticeKind:'booking_approval',state:'approved'}));await rejectsStatus(as(ctx,()=>service.approvalNotices(ctx)),409);rows=normal;
 await rejectsStatus(identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w2',userId:'p1',isSaasAdmin:false},()=>service.approvalNotices(ctx)),403);assert.equal(f.counts.writes,0);
});

test('own management review messages smoke: immutable registered type, original review-only effects, bounded and live personal credential', async () => {
 const shared=require('@rental-os/shared'),f=fixture(),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),service=new EnterpriseTaskCenterService(f.db,f.commands),original=f.db.$queryRaw,time='2026-11-01T00:00:00.000Z',base={tenantId:'t1',applicantCustomerId:'p1',corporateCustomerId:'company',originalRequestType:'profile_change',actorUserId:'operator:reviewer',reason:'Original review reason',createdAt:new ClockDate(time)},initial=[{...base,managementReviewRequestId:'request-a',target:'management-request.review:request-a',operationKey:'supplement-K',result:{id:'request-a',state:'supplement_required',revision:2,effect:'review_only_no_business_change',privateProposal:'secret'}},{...base,managementReviewRequestId:'request-a',target:'management-request.review:request-a',operationKey:'approved-K',result:{id:'request-a',state:'approved',revision:4,effect:'review_only_no_business_change'}},{...base,originalRequestType:'scope_change',managementReviewRequestId:'request-b',target:'management-request.review:request-b',operationKey:'rejected-K',result:{id:'request-b',state:'rejected',revision:2,effect:'review_only_no_business_change'}}];let rows=initial,after;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('AS managementReviewRequestId'))return original(strings,...values);assert.deepEqual(values,['t1','p1']);assert(sql.includes("w.kind='finance_request'"));assert(sql.includes("o.actorUserId LIKE 'operator:%'"));assert(sql.includes("o.target=CONCAT('management-request.review:',w.id)"));assert(sql.includes("'$.requestType'"));assert(sql.includes('LIMIT 201'));for(const key of ['w.state','w.revision','w.payload AS',"'$.proposal'","'$.evidenceFileIds'",'decisionReason','customer_corporate_credits','enterprise_portal_grants','o.result AS result'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;};
 const writes=f.counts.writes,value=await as(()=>service.managementReviewMessages(ctx));assert.equal(value.items.length,3);assert.equal(value.items[0].state,'supplement_required');assert.equal(value.items[1].effect,'review_only_no_business_change');assert.equal(value.items[2].requestType,'scope_change');assert(!JSON.stringify(value).includes('privateProposal'));assert.equal(value.delivery,'not_reported');assert.equal(value.readState,'not_recorded');assert(shared.enterpriseOwnManagementReviewMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnManagementReviewMessagesSnapshot(value,'merchant','p2'),undefined);assert.deepEqual(shared.ENTERPRISE_MANAGEMENT_REQUEST_TYPES,['profile_change','credit_change','scope_change']);
 rows=[{...initial[0],applicantCustomerId:'p2'}];await rejectsStatus(as(()=>service.managementReviewMessages(ctx)),409);rows=[{...initial[0],originalRequestType:'bill_dispute'}];await rejectsStatus(as(()=>service.managementReviewMessages(ctx)),409);rows=[{...initial[0],actorUserId:'customer:reviewer'}];await rejectsStatus(as(()=>service.managementReviewMessages(ctx)),409);rows=[{...initial[0],result:{id:'request-a',state:'approved',revision:2}}];await rejectsStatus(as(()=>service.managementReviewMessages(ctx)),409);rows=[{...initial[0],result:{id:'other',state:'approved',revision:2,effect:'review_only_no_business_change'}}];await rejectsStatus(as(()=>service.managementReviewMessages(ctx)),409);rows=Array.from({length:201},(_,n)=>({...initial[0],operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.managementReviewMessages(ctx)),409);rows=[initial[0],initial[0]];await rejectsStatus(as(()=>service.managementReviewMessages(ctx)),409);rows=initial;f.state.grants=[];f.state.profiles.find(p=>p.id==='p1').membership.status='suspended';assert.equal((await as(()=>service.managementReviewMessages(ctx))).items.length,3);after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(()=>service.managementReviewMessages(ctx)),403);assert.equal(f.counts.writes,writes);
});

test('own join review messages smoke: retained applicant/corporate and customer review originals, bounded history and live personal credential', async () => {
 const shared=require('@rental-os/shared'),f=fixture(),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),service=new EnterpriseTaskCenterService(f.db,f.commands),original=f.db.$queryRaw,time='2026-11-01T00:00:00.000Z',base={tenantId:'t1',applicantCustomerId:'p1',corporateCustomerId:'company',actorUserId:'customer:admin',reason:'Original operation reason',createdAt:new ClockDate(time)},initial=[{...base,joinReviewRequestId:'join-a',target:'join.review:join-a',operationKey:'approved-K',result:{id:'join-a',state:'approved',revision:2,privateInvite:'secret'}},{...base,joinReviewRequestId:'join-b',target:'join.review:join-b',operationKey:'rejected-K',result:{id:'join-b',state:'rejected',revision:2}}];let rows=initial,after;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('AS joinReviewRequestId'))return original(strings,...values);assert.deepEqual(values,['t1','p1']);assert(sql.includes("w.kind='join_request'"));assert(sql.includes("o.actorUserId LIKE 'customer:%'"));assert(sql.includes("o.target=CONCAT('join.review:',w.id)"));assert(sql.includes('LIMIT 201'));for(const key of ['w.state','w.revision','w.payload','decisionReason','customer_corporate_memberships','enterprise_portal_grants','o.result AS result','join.submit'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;};
 const writes=f.counts.writes,value=await as(()=>service.joinReviewMessages(ctx));assert.equal(value.items.length,2);assert.equal(value.items[0].state,'approved');assert.equal(value.items[1].reason,'Original operation reason');assert.equal(value.items[0].corporateCustomerId,'company');assert(!JSON.stringify(value).includes('privateInvite'));assert.equal(value.delivery,'not_reported');assert.equal(value.readState,'not_recorded');assert(shared.enterpriseOwnJoinReviewMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnJoinReviewMessagesSnapshot(value,'merchant','p2'),undefined);assert.equal(shared.enterpriseOwnJoinReviewMessagesSnapshot({...value,delivery:'delivered'},'merchant','p1'),undefined);
 rows=[{...initial[0],applicantCustomerId:'p2'}];await rejectsStatus(as(()=>service.joinReviewMessages(ctx)),409);rows=[{...initial[0],corporateCustomerId:null}];await rejectsStatus(as(()=>service.joinReviewMessages(ctx)),409);rows=[{...initial[0],actorUserId:'operator:admin'}];await rejectsStatus(as(()=>service.joinReviewMessages(ctx)),409);rows=[{...initial[0],result:{id:'wrong-id',state:'approved',revision:2}}];await rejectsStatus(as(()=>service.joinReviewMessages(ctx)),409);rows=[{...initial[0],result:{id:'join-a',state:'supplement_required',revision:2}}];await rejectsStatus(as(()=>service.joinReviewMessages(ctx)),409);rows=Array.from({length:201},(_,n)=>({...initial[0],operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.joinReviewMessages(ctx)),409);rows=[initial[0],initial[0]];await rejectsStatus(as(()=>service.joinReviewMessages(ctx)),409);rows=initial;f.state.grants=[];f.state.profiles.find(p=>p.id==='p1').membership.status='suspended';assert.equal((await as(()=>service.joinReviewMessages(ctx))).items.length,2);after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(()=>service.joinReviewMessages(ctx)),403);assert.equal(f.counts.writes,writes);
});

test('own application review messages smoke: original applicant outcomes, no current corporate/material fallback, bounded and live personal credential', async () => {
 const shared=require('@rental-os/shared'),f=fixture(),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),service=new EnterpriseTaskCenterService(f.db,f.commands),original=f.db.$queryRaw,time='2026-11-01T00:00:00.000Z',base={tenantId:'t1',requestId:'app-a',applicantCustomerId:'p1',actorUserId:'operator:reviewer',target:'application.review:app-a',reason:'Original feedback',createdAt:new ClockDate(time)},initial=[{...base,operationKey:'supplement-K',result:{id:'app-a',state:'supplement_required',revision:2,corporateCustomerId:null,privateMaterial:'private'}},{...base,operationKey:'approved-K',result:{id:'app-a',state:'approved',revision:4,corporateCustomerId:'company'}},{...base,requestId:'app-b',target:'application.review:app-b',operationKey:'rejected-K',result:{id:'app-b',state:'rejected',revision:2,corporateCustomerId:null}}];let rows=initial,after;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('w.id AS requestId,w.applicantCustomerId'))return original(strings,...values);assert.deepEqual(values,['t1','p1']);assert(sql.includes("w.kind='corporate_application'"));assert(sql.includes("o.actorUserId LIKE 'operator:%'"));assert(sql.includes("o.target=CONCAT('application.review:',w.id)"));assert(sql.includes('LIMIT 201'));for(const key of ['w.state','w.revision','w.payload','w.corporateCustomerId','customer_corporate_memberships','enterprise_portal_grants','o.result AS result'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;};
 const writes=f.counts.writes,value=await as(()=>service.applicationReviewMessages(ctx));assert.equal(value.items.length,3);assert.equal(value.items[0].state,'supplement_required');assert.equal(value.items[1].revision,4);assert.equal(value.items[0].corporateCustomerId,undefined);assert.equal(value.items[1].corporateCustomerId,'company');assert(!JSON.stringify(value).includes('privateMaterial'));assert.equal(value.delivery,'not_reported');assert.equal(value.readState,'not_recorded');assert(shared.enterpriseOwnApplicationReviewMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnApplicationReviewMessagesSnapshot(value,'merchant','p2'),undefined);assert.equal(shared.enterpriseOwnApplicationReviewMessagesSnapshot({...value,delivery:'delivered'},'merchant','p1'),undefined);
 rows=[{...initial[0],applicantCustomerId:'p2'}];await rejectsStatus(as(()=>service.applicationReviewMessages(ctx)),409);rows=[{...initial[1],result:{id:'app-a',state:'approved',revision:4}}];await rejectsStatus(as(()=>service.applicationReviewMessages(ctx)),409);rows=[{...initial[0],result:{id:'wrong-id',state:'rejected',revision:2}}];await rejectsStatus(as(()=>service.applicationReviewMessages(ctx)),409);rows=[{...initial[0],result:{id:'app-a',state:'draft',revision:2}}];await rejectsStatus(as(()=>service.applicationReviewMessages(ctx)),409);rows=[{...initial[0],actorUserId:'customer:reviewer'}];await rejectsStatus(as(()=>service.applicationReviewMessages(ctx)),409);rows=Array.from({length:201},(_,n)=>({...initial[0],operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.applicationReviewMessages(ctx)),409);rows=[initial[0],initial[0]];await rejectsStatus(as(()=>service.applicationReviewMessages(ctx)),409);rows=initial;f.state.grants=[];f.state.profiles.find(p=>p.id==='p1').membership.status='suspended';assert.equal((await as(()=>service.applicationReviewMessages(ctx))).items.length,3);after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(()=>service.applicationReviewMessages(ctx)),403);assert.equal(f.counts.writes,writes);
});

test('own message feedback smoke: personal persisted feedback, bounded ownership and fresh credential checks without business writes', async () => {
 const shared=require('@rental-os/shared'),f=fixture(),ctx={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),service=new EnterpriseTaskCenterService(f.db,f.commands),original=f.db.$queryRaw;
 const base={tenantId:'t1',applicantCustomerId:'p1',updatedAt:new ClockDate(),revision:2,decisionReason:'Original feedback'},initial=[{...base,id:'app-a',kind:'corporate_application',state:'approved',payload:'private-legal-material'},{...base,id:'join-a',kind:'join_request',state:'rejected',decisionReason:null},{...base,id:'request-a',kind:'finance_request',state:'supplement_required',requestType:'profile_change'}];let rows=initial,reads=0,after;
 f.db.$queryRaw=async(strings,...values)=>{const sql=strings.join('?');if(!sql.includes('decisionReason,updatedAt FROM enterprise_workflow_requests'))return original(strings,...values);reads++;assert.deepEqual(values,['t1','p1']);assert(sql.includes('LIMIT 201'));assert(sql.includes("kind IN ('corporate_application','join_request','finance_request')"));for(const v of ['SELECT *','enterprise_portal_operations','JOIN','customer_corporate_credits'])assert(!sql.includes(v));const result=rows.map(r=>({...r}));after?.();return result;};
 const writes=f.counts.writes,value=await as(()=>service.messages(ctx));assert.equal(value.items.length,3);assert.equal(value.items[0].state,'approved');assert.equal(value.items[1].feedback,undefined);assert.equal(value.items[2].kind,'management_request');assert.equal(value.delivery,'not_reported');assert.equal(value.readState,'not_recorded');assert(!JSON.stringify(value).includes('payload'));assert(!JSON.stringify(value).includes('private-legal-material'));assert.equal(f.counts.writes,writes);assert(shared.enterpriseOwnMessagesSnapshot(value,'merchant','p1'));assert.equal(shared.enterpriseOwnMessagesSnapshot(value,'merchant','p2'),undefined);assert.equal(shared.enterpriseOwnMessagesSnapshot({...value,delivery:'delivered'},'merchant','p1'),undefined);
 rows=[{...initial[0],applicantCustomerId:'p2'}];await rejectsStatus(as(()=>service.messages(ctx)),409);rows=[{...initial[0],updatedAt:new ClockDate(NaN)}];await rejectsStatus(as(()=>service.messages(ctx)),409);rows=Array.from({length:201},(_,n)=>({...initial[0],id:'overflow-'+n}));await rejectsStatus(as(()=>service.messages(ctx)),409);rows=initial;rows[2].requestType='unregistered';await rejectsStatus(as(()=>service.messages(ctx)),409);rows[2].requestType='profile_change';
 after=()=>{f.state.sessions.find(s=>s.customerId==='p1').revokedAt=new ClockDate();};await rejectsStatus(as(()=>service.messages(ctx)),403);after=undefined;f.state.sessions.find(s=>s.customerId==='p1').revokedAt=null;f.state.profiles.find(p=>p.id==='p1').membership.status='suspended';f.state.grants=[];assert.equal((await as(()=>service.messages(ctx))).items.length,3);assert.equal(f.counts.writes,writes);
 const count=reads;await rejectsStatus(identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false,staffApi:true},()=>service.messages(ctx)),403);assert.equal(reads,count);
});

test('merchant portal audit smoke: original bare actor and company target, private grants omitted, reserved target unavailable and unified current audit', async () => {
 const shared=require('@rental-os/shared'),{EnterpriseMembershipAuditService}=load('apps/api/src/modules/enterprise/enterprise-membership-audit.service.ts',{'@rental-os/shared':shared,'../../common/request-identity':identity,'./enterprise-command.service':commandModule}),time='2026-11-01T00:00:00.000Z',ctx={...context('admin'),workspaceId:'w1',workspaceCode:'s1'},base={tenantId:'t1',associatedPortalCompany:'company',operationKey:'portal-K',actorUserId:'original-operator',target:'company',reason:'Original configuration reason',createdAt:new ClockDate(time),result:{corporateCustomerId:'company',enabled:true,revision:1,grants:[{private:true}]}};let rows=[base],merchant=[],revoked=false,after;
 const db={$queryRaw:async(strings,...values)=>{const sql=strings.join('?');if(sql.includes('AS associatedPortalCompany')){assert(values.includes('t1')&&values.includes('company'));assert(sql.includes('o.target=?'));assert(sql.includes("o.actorUserId NOT LIKE 'customer:%'"));assert(sql.includes("o.actorUserId NOT LIKE 'operator:%'"));assert(sql.includes('LIMIT 201'));for(const key of ['p.enabled','p.revision','enterprise_portal_grants',"'$.grants'",'o.result AS result','customer_sensitive_access'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;}return sql.includes('AS associatedMerchantScope')?merchant:[];}},access={requireAction:async(c,id,action)=>{assert.equal(action,'audit:read');if(revoked)throw new common.ForbiddenException('Audit revoked');return{membershipId:'auditor',permissionRevision:'1:1'};}},service=new EnterpriseMembershipAuditService(db,access),as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'admin',isSaasAdmin:false},fn);
 const value=await as(()=>service.read(ctx,'company'));assert.equal(value.merchantPortalItems.length,1);assert.deepEqual(value.merchantPortalItems[0].result,{corporateCustomerId:'company',enabled:true,revision:1});assert.equal(value.merchantPortalItems[0].actor.id,'original-operator');assert(!JSON.stringify(value).includes('private'));assert(!JSON.stringify(value).includes('grants'));assert(shared.enterpriseMembershipAuditSnapshot(value,'merchant','company','s1'));const legacy={...value};delete legacy.merchantPortalItems;delete legacy.merchantPortalCoverage;assert.equal(shared.enterpriseMembershipAuditSnapshot(legacy,'merchant','company','s1').merchantPortalItems,undefined);assert.equal(shared.enterpriseMembershipAuditSnapshot({...value,merchantPortalItems:[value.merchantPortalItems[0],value.merchantPortalItems[0]]},'merchant','company','s1'),undefined);
 for(const delta of [{associatedPortalCompany:null},{actorUserId:'operator:reviewer'},{target:'other'},{result:{corporateCustomerId:'other',enabled:true,revision:1}},{result:{corporateCustomerId:'company',enabled:'true',revision:1}},{result:{corporateCustomerId:'company',enabled:true}},{result:{corporateCustomerId:'company',enabled:true,revision:0}}]){rows=[{...base,...delta}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);}rows=Array.from({length:201},(_,n)=>({...base,operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.read(ctx,'company')),409);
 const m={tenantId:'t1',corporateCustomerId:'company',associatedMerchantScope:'merchant',operationKey:'merchant-K',actorUserId:'operator:reviewer',target:'policy.merchant:company',reason:'Original merchant policy',createdAt:new ClockDate(time),result:{scopeKey:'merchant',revision:1}};merchant=Array.from({length:200},(_,n)=>({...m,operationKey:'merchant-'+n}));rows=[base];await rejectsStatus(as(()=>service.read(ctx,'company')),409);merchant=[{...m,operationKey:'portal-K'}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);merchant=[];const reserved=await as(()=>service.read(ctx,'tenant'));assert.equal(reserved.merchantPortalItems,undefined);assert.equal(reserved.merchantPortalCoverage,undefined);assert(shared.enterpriseMembershipAuditSnapshot(reserved,'merchant','tenant','s1'));after=()=>{revoked=true;};await rejectsStatus(as(()=>service.read(ctx,'company')),403);
});

test('merchant policy audit smoke: original operator metadata, exact corporate scope, legacy and unified bound, current action revocation', async () => {
 const shared=require('@rental-os/shared'),{EnterpriseMembershipAuditService}=load('apps/api/src/modules/enterprise/enterprise-membership-audit.service.ts',{'@rental-os/shared':shared,'../../common/request-identity':identity,'./enterprise-command.service':commandModule}),time='2026-11-01T00:00:00.000Z',ctx={...context('admin'),workspaceId:'w1',workspaceCode:'s1'},base={tenantId:'t1',corporateCustomerId:'company',associatedMerchantScope:'merchant',operationKey:'merchant-K',actorUserId:'operator:reviewer',target:'policy.merchant:company',reason:'Original configuration reason',createdAt:new ClockDate(time),result:{scopeKey:'merchant',revision:1,policy:{privateBody:true},maxRequestAmount:'private'}};let rows=[base],approvals=[],revoked=false,after;
 const db={$queryRaw:async(strings,...values)=>{const sql=strings.join('?');if(sql.includes('AS associatedMerchantScope')){assert(values.includes('t1')&&values.includes('company')&&values.includes('policy.merchant:company'));assert(sql.includes("p.scopeKey='merchant'"));assert(sql.includes("o.actorUserId LIKE 'operator:%'"));assert(sql.includes('o.target=?'));assert(sql.includes('LIMIT 201'));for(const key of ['p.policy','p.revision','p.membershipUpdatedAt',"'$.policy'","'$.maxRequestAmount'",'o.result AS result','customer_sensitive_access'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;}return sql.includes('AS associatedCompany')?approvals:[];}},access={requireAction:async(c,id,action)=>{assert.equal(action,'audit:read');if(revoked)throw new common.ForbiddenException('Audit revoked');return{membershipId:'auditor',permissionRevision:'1:1'};}},service=new EnterpriseMembershipAuditService(db,access),as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'admin',isSaasAdmin:false},fn);
 const value=await as(()=>service.read(ctx,'company'));assert.equal(value.merchantPolicyItems.length,1);assert.deepEqual(value.merchantPolicyItems[0].result,{scopeKey:'merchant',revision:1});assert.equal(value.merchantPolicyItems[0].actor.kind,'operator');assert(!JSON.stringify(value).includes('privateBody'));assert(!JSON.stringify(value).includes('maxRequestAmount'));assert(shared.enterpriseMembershipAuditSnapshot(value,'merchant','company','s1'));const legacy={...value};delete legacy.merchantPolicyItems;delete legacy.merchantPolicyCoverage;assert.equal(shared.enterpriseMembershipAuditSnapshot(legacy,'merchant','company','s1').merchantPolicyItems,undefined);assert.equal(shared.enterpriseMembershipAuditSnapshot({...value,merchantPolicyItems:[value.merchantPolicyItems[0],value.merchantPolicyItems[0]]},'merchant','company','s1'),undefined);
 rows=[{...base,result:{scopeKey:'company',revision:1}}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...base,associatedMerchantScope:null}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...base,actorUserId:'customer:reviewer'}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...base,target:'policy.merchant:other'}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=Array.from({length:201},(_,n)=>({...base,operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.read(ctx,'company')),409);
 approvals=[{tenantId:'t1',associatedCompany:'company',objectId:'app-a',operationKey:'approved-K',actorUserId:'operator:reviewer',target:'application.review:app-a',reason:'Original approval reason',createdAt:new ClockDate(time),result:{id:'app-a',state:'approved',revision:2,corporateCustomerId:'company'}}];rows=Array.from({length:200},(_,n)=>({...base,operationKey:'bounded-'+n}));await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...base,operationKey:'approved-K'}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);approvals=[];rows=[base];after=()=>{revoked=true;};await rejectsStatus(as(()=>service.read(ctx,'company')),403);
});

test('application approval audit smoke: original approved company binding only, private metadata out, unified bound and live audit permission', async () => {
 const shared=require('@rental-os/shared'),{EnterpriseMembershipAuditService}=load('apps/api/src/modules/enterprise/enterprise-membership-audit.service.ts',{'@rental-os/shared':shared,'../../common/request-identity':identity,'./enterprise-command.service':commandModule}),time='2026-11-01T00:00:00.000Z',ctx={...context('admin'),workspaceId:'w1',workspaceCode:'s1'},base={tenantId:'t1',associatedCompany:'company',objectId:'app-a',operationKey:'approve-K',actorUserId:'operator:reviewer',target:'application.review:app-a',reason:'Original public approval reason',createdAt:new ClockDate(time),result:{id:'app-a',state:'approved',revision:2,corporateCustomerId:'company',privateMaterial:'private'}};let rows=[base],revoked=false,after,policies=[];
 const db={$queryRaw:async(strings,...values)=>{const sql=strings.join('?');if(sql.includes('AS associatedCompany')){assert(values.includes('t1')&&values.includes('company'));assert(sql.includes("o.actorUserId LIKE 'operator:%'"));assert(sql.includes("'$.state'))='approved'"));assert(sql.includes('LIMIT 201'));for(const key of ['w.payload','w.state','w.revision',"'$.evidenceFileIds'",'o.result AS result','customer_sensitive_access'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;}return sql.includes('AS associatedScope')?policies:[];}},access={requireAction:async(c,id,action)=>{assert.equal(action,'audit:read');if(revoked)throw new common.ForbiddenException('Audit revoked');return{membershipId:'auditor',permissionRevision:'1:1'};}},service=new EnterpriseMembershipAuditService(db,access),as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'admin',isSaasAdmin:false},fn);
 const value=await as(()=>service.read(ctx,'company'));assert.equal(value.applicationApprovalItems.length,1);assert.equal(value.applicationApprovalItems[0].result.corporateCustomerId,'company');assert.equal(value.applicationApprovalItems[0].actor.kind,'operator');assert(!JSON.stringify(value).includes('privateMaterial'));assert(shared.enterpriseMembershipAuditSnapshot(value,'merchant','company','s1'));const legacy={...value};delete legacy.applicationApprovalItems;delete legacy.applicationApprovalCoverage;assert.equal(shared.enterpriseMembershipAuditSnapshot(legacy,'merchant','company','s1').applicationApprovalItems,undefined);assert.equal(shared.enterpriseMembershipAuditSnapshot({...value,applicationApprovalItems:[value.applicationApprovalItems[0],value.applicationApprovalItems[0]]},'merchant','company','s1'),undefined);
 rows=[{...base,result:{...base.result,corporateCustomerId:'other'}}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...base,associatedCompany:'other'}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...base,actorUserId:'customer:reviewer'}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...base,objectId:null}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=Array.from({length:201},(_,n)=>({...base,operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=Array.from({length:200},(_,n)=>({...base,operationKey:'bounded-'+n}));policies=[{tenantId:'t1',corporateCustomerId:'company',associatedScope:'company',operationKey:'policy-K',actorUserId:'customer:admin',target:'policy.company:company:company',reason:'Original reason',createdAt:new ClockDate(time),result:{scopeKey:'company',revision:1,membershipUpdatedAt:null}}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[base];policies=[];after=()=>{revoked=true;};await rejectsStatus(as(()=>service.read(ctx,'company')),403);
});

test('policy command audit smoke: original metadata without body/current policy, legacy and unified bound, late revoke', async () => {
 const shared=require('@rental-os/shared'),{EnterpriseMembershipAuditService}=load('apps/api/src/modules/enterprise/enterprise-membership-audit.service.ts',{'@rental-os/shared':shared,'../../common/request-identity':identity,'./enterprise-command.service':commandModule}),time='2026-11-01T00:00:00.000Z',ctx={...context('admin'),workspaceId:'w1',workspaceCode:'s1'},base={tenantId:'t1',corporateCustomerId:'company',actorUserId:'customer:admin',reason:'Original policy reason',createdAt:new ClockDate(time)};let rows=[{...base,operationKey:'company-policy-K',associatedScope:'company',target:'policy.company:company:company',result:{scopeKey:'company',revision:1,membershipUpdatedAt:null,policy:'private-not-projected'}},{...base,operationKey:'employee-policy-K',associatedScope:'member:employee-a',target:'policy.company:company:employee-a',result:{scopeKey:'member:employee-a',revision:2,membershipUpdatedAt:time}}],revoked=false,after,joins=[];
 const db={$queryRaw:async(strings,...values)=>{const sql=strings.join('?');if(sql.includes('AS associatedScope')){assert(values.includes('t1')&&values.includes('company'));assert(values.includes('policy.company:company:'));assert(sql.includes('LEFT(o.target,CHAR_LENGTH('));assert(sql.includes('LIMIT 201'));for(const key of ['p.policy','p.revision','p.membershipUpdatedAt',"'$.policy'","'$.maxRequestAmount'",'o.result AS result'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;}return sql.includes("w.kind='join_request'")?joins:[];}},access={requireAction:async(c,id,action)=>{assert.equal(action,'audit:read');if(revoked)throw new common.ForbiddenException('Audit revoked');return{membershipId:'auditor',permissionRevision:'1:1'};}},service=new EnterpriseMembershipAuditService(db,access),as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'admin',isSaasAdmin:false},fn);
 const value=await as(()=>service.read(ctx,'company'));assert.equal(value.policyItems.length,2);assert.equal(value.policyItems[0].result.revision,1);assert.equal(value.policyItems[1].result.membershipUpdatedAt,time);assert(!JSON.stringify(value).includes('private-not-projected'));assert(shared.enterpriseMembershipAuditSnapshot(value,'merchant','company','s1'));const legacy={...value};delete legacy.policyItems;delete legacy.policyCoverage;assert.equal(shared.enterpriseMembershipAuditSnapshot(legacy,'merchant','company','s1').policyItems,undefined);assert.equal(shared.enterpriseMembershipAuditSnapshot({...value,policyItems:[value.policyItems[0],value.policyItems[0]]},'merchant','company','s1'),undefined);
 const initial=rows;rows=[{...initial[1],result:{scopeKey:'member:employee-a',revision:2,membershipUpdatedAt:null}}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...initial[0],associatedScope:null}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...initial[0],target:'policy.company:other:company'}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=Array.from({length:201},(_,n)=>({...initial[0],operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=Array.from({length:200},(_,n)=>({...initial[0],operationKey:'bounded-'+n}));joins=[{tenantId:'t1',corporateCustomerId:'company',objectId:'join-a',applicantCustomerId:'p1',operationKey:'join-K',actorUserId:'customer:p1',target:'join.submit:self',reason:'Original reason',createdAt:new ClockDate(time),result:{id:'join-a',state:'pending',revision:1}}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=initial;joins=[];after=()=>{revoked=true;};await rejectsStatus(as(()=>service.read(ctx,'company')),403);
});

test('join request audit smoke: original request ownership/outcomes, unified bound, missing legacy and revoked audit action', async () => {
 const shared=require('@rental-os/shared'),{EnterpriseMembershipAuditService}=load('apps/api/src/modules/enterprise/enterprise-membership-audit.service.ts',{'@rental-os/shared':shared,'../../common/request-identity':identity,'./enterprise-command.service':commandModule}),time='2026-11-01T00:00:00.000Z',ctx={...context('admin'),workspaceId:'w1',workspaceCode:'s1'},base={tenantId:'t1',corporateCustomerId:'company',objectId:'join-a',applicantCustomerId:'p1',reason:'Original join reason',createdAt:new ClockDate(time)},event=(key,action,id,state,revision,actor)=>({...base,objectId:id,operationKey:key,actorUserId:'customer:'+actor,target:action+':'+(action==='join.submit'?'self':id),result:{id,state,revision,privateMaterial:'not-public'}});let rows=[event('join-K','join.submit','join-a','pending',1,'p1'),event('review-K','join.review','join-a','approved',2,'admin'),event('withdraw-K','join.withdraw','join-b','withdrawn',2,'p1')],revoked=false,after,memberRows=[];
 const db={$queryRaw:async(strings,...values)=>{const sql=strings.join('?');assert(values.includes('t1')&&values.includes('company'));if(sql.includes("w.kind='join_request'")){assert(sql.includes('LIMIT 201'));for(const key of ['w.state','w.revision','w.payload','tokenHash','requestHash'])assert(!sql.includes(key));const result=rows.map(r=>({...r}));after?.();return result;}return sql.includes('m.id AS membershipId')?memberRows:[];}},access={requireAction:async(c,id,action)=>{assert.equal(action,'audit:read');if(revoked)throw new common.ForbiddenException('Audit revoked');return{membershipId:'auditor',permissionRevision:'1:1'};}},service=new EnterpriseMembershipAuditService(db,access),as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'admin',isSaasAdmin:false},fn);
 const value=await as(()=>service.read(ctx,'company'));assert.equal(value.joiningItems.length,3);assert.equal(value.joiningItems[0].result.state,'pending');assert.equal(value.joiningItems[1].result.state,'approved');assert(!JSON.stringify(value).includes('privateMaterial'));assert(shared.enterpriseMembershipAuditSnapshot(value,'merchant','company','s1'));const legacy={...value};delete legacy.joiningItems;delete legacy.joiningCoverage;assert.equal(shared.enterpriseMembershipAuditSnapshot(legacy,'merchant','company','s1').joiningItems,undefined);assert.equal(shared.enterpriseMembershipAuditSnapshot({...value,joiningItems:[value.joiningItems[0],value.joiningItems[0]]},'merchant','company','s1'),undefined);
 const initial=rows;rows=[{...initial[0],actorUserId:'customer:someone-else'}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=[{...initial[1],result:{id:'another',state:'approved',revision:2}}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=Array.from({length:201},(_,n)=>({...initial[0],operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=Array.from({length:200},(_,n)=>({...initial[0],operationKey:'bounded-'+n}));memberRows=[{tenantId:'t1',corporateCustomerId:'company',membershipId:'original-rel',operationKey:'member-K',actorUserId:'customer:admin',target:'member.change:original-rel',reason:'Original reason',createdAt:new ClockDate(time),result:{membershipId:'original-rel',status:'active',updatedAt:time}}];await rejectsStatus(as(()=>service.read(ctx,'company')),409);rows=initial;memberRows=[];after=()=>{revoked=true;};await rejectsStatus(as(()=>service.read(ctx,'company')),403);
});

test('expense approval audit smoke: original associated receipts, exact seals/C and expense-only projection', async () => {
 const shared=require('@rental-os/shared'),fingerprint=load('apps/api/src/modules/rental-core/rental-idempotency.repository.ts',{'./workspace-scope':{resolveScopeWorkspaceId:()=>{throw new Error('No Core scope read');}}}).requestFingerprint,{EnterpriseMembershipAuditService}=load('apps/api/src/modules/enterprise/enterprise-membership-audit.service.ts',{'@rental-os/shared':shared,'../../common/request-identity':identity,'./enterprise-command.service':commandModule});
 const time='2026-11-01T00:00:00.000Z',ctx={...context('admin'),workspaceId:'w1',workspaceCode:'s1'},base={tenantId:'t1',corporateCustomerId:'company',workspaceId:'w1',applicantCustomerId:'p1',auditOrderId:'private-order',createdAt:new ClockDate(time),reason:'Original reason'},make=(key,type,id,action,result,actor='p1')=>({...base,operationKey:key,objectType:type,auditObjectId:id,actorUserId:'customer:'+actor,target:action+':'+(action.endsWith('.request')?'private-order':id),result});
 const request={id:'ext-a',state:'pending',revision:1,expiresAt:'2026-11-02T00:00:00.000Z'},submit={approvalId:'ext-a',extensionId:'private-extension',state:'consumed',retryable:false},seal={approvalId:'ext-b',state:'closed',closedOperationKey:'seal-K',retryable:false},sealHash=enterpriseHash({action:'extension.sealed',target:'ext-b',originalOperationKey:'seal-K'}),closure=(id,key,C)=>({orderId:'private-order',workspaceId:'w1',workspaceCode:'s1',applicantCustomerId:'p1',originalOperationKey:key,closureOperationKey:C,state:'observed',approvalId:id,retryable:false});
 let ext=[make('request-K','extension_approval','ext-a','extension.request',request),make('decision-K','extension_approval','ext-a','extension.decision',{id:'ext-a',state:'approved',revision:2},'admin'),make('submit-K','extension_approval','ext-a','extension.submit',submit),{...make('observed-C','extension_approval','ext-a','extension.close',{...submit,originalOperationKey:'submit-K'}),originalKey:'submit-K',originalTarget:'extension.submit:ext-a',originalResult:submit}, {...make('seal-K','extension_approval','ext-b','extension.sealed',seal),requestHash:sealHash},{...make('close-C','extension_approval','ext-b','extension.close',seal),originalKey:'seal-K',originalTarget:'extension.sealed:ext-b',originalResult:seal,originalHash:sealHash},{...make('request-C','extension_approval','ext-a','extension.request.close',closure('ext-a','request-K','request-C')),target:'extension.request.close:'+enterpriseHash({orderId:'private-order',workspaceId:'w1',originalOperationKey:'request-K'}),originalKey:'request-K',originalTarget:'extension.request:private-order',originalResult:request}];
 const xRequest={...request,id:'exchange-a'};let exchanges=[make('exchange-K','exchange_approval','exchange-a','exchange.request',xRequest),make('exchange-decision','exchange_approval','exchange-a','exchange.decision',{id:'exchange-a',state:'approved',revision:2},'admin'),make('expense-K','exchange_approval','exchange-a','exchange.expense.confirm',{id:'exchange-a',orderId:'private-order',workspaceId:'w1',applicantCustomerId:'p1',operationKey:'expense-K',confirmedAt:time,revision:3,scope:'expense_only_not_inspection_or_execution',amount:'private-price'}),{...make('exchange-C','exchange_approval','exchange-a','exchange.request.close',closure('exchange-a','exchange-K','exchange-C')),target:'exchange.request.close:'+fingerprint({orderId:'private-order',workspaceId:'w1',originalOperationKey:'exchange-K'}),originalKey:'exchange-K',originalTarget:'exchange.request:private-order',originalResult:xRequest}];
 let revoked=false;const db={$queryRaw:async(strings,...values)=>{const sql=strings.join('?');assert(values.includes('t1')&&values.includes('company'));if(sql.includes("'extension_approval' AS objectType")||sql.includes("'exchange_approval' AS objectType")){assert(sql.includes('a.workspaceId=?'));assert(values.includes('w1'));assert(sql.includes('LIMIT 201'));return sql.includes("'extension_approval' AS objectType")?ext:exchanges;}return[];}},access={requireAction:async()=>{if(revoked)throw new common.ForbiddenException('Audit revoked');return{membershipId:'admin-rel',permissionRevision:'1:1'};}},service=new EnterpriseMembershipAuditService(db,access),as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'admin',isSaasAdmin:false},fn);
 const value=await as(()=>service.read(ctx,'company'));assert.equal(value.expenseItems.length,11);assert.equal(value.expenseItems.find(r=>r.operationKey==='expense-K').result.scope,'expense_only_not_inspection_or_execution');assert.equal(value.expenseItems.find(r=>r.operationKey==='expense-K').result.state,undefined);for(const key of ['private-order','private-extension','private-price','originalOperationKey','closedOperationKey','requestHash'])assert(!JSON.stringify(value).includes(key));assert(shared.enterpriseMembershipAuditSnapshot(value,'merchant','company','s1'));
 ext[4].requestHash='bad';await rejectsStatus(as(()=>service.read(ctx,'company')),409);ext[4].requestHash=sealHash;ext[5].originalHash='bad';await rejectsStatus(as(()=>service.read(ctx,'company')),409);ext[5].originalHash=sealHash;exchanges[2].result.scope='inspection';await rejectsStatus(as(()=>service.read(ctx,'company')),409);exchanges[2].result.scope='expense_only_not_inspection_or_execution';exchanges[3].originalResult={...xRequest,id:'other'};await rejectsStatus(as(()=>service.read(ctx,'company')),409);exchanges[3].originalResult=xRequest;
 const saved=ext;ext=Array.from({length:201},(_,n)=>({...saved[0],operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.read(ctx,'company')),409);ext=saved;ext[0].workspaceId='w2';await rejectsStatus(as(()=>service.read(ctx,'company')),409);ext[0].workspaceId='w1';const legacy={...value};delete legacy.expenseCoverage;delete legacy.expenseItems;assert.equal(shared.enterpriseMembershipAuditSnapshot(legacy,'merchant','company','s1').expenseItems,undefined);assert.equal(shared.enterpriseMembershipAuditSnapshot({...value,expenseItems:[...value.expenseItems,value.expenseItems[0]]},'merchant','company','s1'),undefined);
 const query=db.$queryRaw;db.$queryRaw=async(...args)=>{const rows=await query(...args);if(args[0].join('').includes("'exchange_approval' AS objectType"))revoked=true;return rows;};await rejectsStatus(as(()=>service.read(ctx,'company')),403);
});

test('booking management audit smoke: original workspace/owner/results, operator review separation and unavailable legacy', async () => {
 const shared=require('@rental-os/shared'),{EnterpriseMembershipAuditService}=load('apps/api/src/modules/enterprise/enterprise-membership-audit.service.ts',{'@rental-os/shared':shared,'../../common/request-identity':identity,'./enterprise-command.service':commandModule});
 const when='2026-11-01T00:00:00.000Z',base={tenantId:'t1',corporateCustomerId:'company',createdAt:new ClockDate(when),reason:'Original audit reason',applicantCustomerId:'p1'},ctx={...context('admin'),workspaceId:'w1',workspaceCode:'s1'};
 let management=[{...base,objectType:'management_request',auditObjectId:'request-1',operationKey:'save-K',actorUserId:'customer:p1',target:'management-request.save:company',result:{id:'request-1',state:'pending',revision:1,effect:'review_only_no_business_change',proposal:'private-material'}},{...base,objectType:'management_request',auditObjectId:'request-1',operationKey:'review-K',actorUserId:'operator:merchant',target:'management-request.review:request-1',result:{id:'request-1',state:'approved',revision:2,effect:'review_only_no_business_change'}},{...base,objectType:'management_request',auditObjectId:'request-2',operationKey:'withdraw-K',actorUserId:'customer:p1',target:'management-request.withdraw:request-2',result:{id:'request-2',state:'withdrawn',revision:2}}];
 let bookings=[{...base,objectType:'booking_approval',auditObjectId:'approval-1',workspaceId:'w1',expectedRequestTarget:'approval.request:quote-private',operationKey:'request-K',actorUserId:'customer:p1',target:'approval.request:quote-private',result:{id:'approval-1',state:'pending',revision:1,expiresAt:'2026-11-02T00:00:00.000Z',execution:'not_submitted',inventory:'not_reserved'}},{...base,objectType:'booking_approval',auditObjectId:'approval-1',workspaceId:'w1',operationKey:'decision-K',actorUserId:'customer:admin',target:'approval.decision:approval-1',result:{id:'approval-1',state:'approved',revision:2,execution:'not_submitted'}},{...base,objectType:'booking_approval',auditObjectId:'approval-1',workspaceId:'w1',operationKey:'submit-K',actorUserId:'customer:p1',target:'approval.submit:approval-1',result:{approvalId:'approval-1',state:'executing',executionKey:'submit-K',retryable:false}},{...base,objectType:'booking_approval',auditObjectId:'approval-1',workspaceId:'w1',operationKey:'close-K',actorUserId:'customer:p1',target:'approval.close:approval-1',result:{id:'approval-1',state:'consumed',orderId:'order-private',retryable:false}}];
 let revoke=false,queryCount=0;const db={$queryRaw:async(strings,...values)=>{queryCount++;const sql=strings.join('?');assert(values.includes('t1')&&values.includes('company'));assert(sql.includes('LIMIT 201'));if(sql.includes("'management_request' AS objectType")){assert(sql.includes("o.actorUserId LIKE 'operator:%'"));return management;}if(sql.includes("'booking_approval' AS objectType")){assert(sql.includes('a.workspaceId=?'));assert(values.includes('w1'));return bookings;}return[];}},access={requireAction:async()=>{if(revoke)throw new common.ForbiddenException('Audit revoked');return{membershipId:'auditor',permissionRevision:'1:1'};}},service=new EnterpriseMembershipAuditService(db,access),as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'admin',isSaasAdmin:false},fn);
 const value=await as(()=>service.read(ctx,'company'));assert.equal(value.businessItems.length,7);assert.equal(value.businessItems.find(r=>r.operationKey==='review-K').actor.kind,'operator');assert.equal(value.businessItems.find(r=>r.operationKey==='submit-K').result.state,'executing');assert.equal(value.businessItems.find(r=>r.operationKey==='submit-K').result.revision,undefined);assert.equal(value.businessItems.find(r=>r.operationKey==='close-K').result.revision,undefined);for(const key of ['proposal','quote-private','order-private','executionKey'])assert(!JSON.stringify(value).includes(key));assert(shared.enterpriseMembershipAuditSnapshot(value,'merchant','company','s1'));assert.equal(shared.enterpriseMembershipAuditSnapshot(value,'merchant','company','s2'),undefined);
 const raw=bookings[0].result;bookings[0].result={...raw,id:'different'};await rejectsStatus(as(()=>service.read(ctx,'company')),409);bookings[0].result=raw;bookings[0].workspaceId='w2';await rejectsStatus(as(()=>service.read(ctx,'company')),409);bookings[0].workspaceId='w1';management[1].actorUserId='customer:merchant';await rejectsStatus(as(()=>service.read(ctx,'company')),409);management[1].actorUserId='operator:merchant';management[0].auditObjectId=null;await rejectsStatus(as(()=>service.read(ctx,'company')),409);management[0].auditObjectId='request-1';
 const old=management;management=Array.from({length:201},(_,n)=>({...old[0],operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.read(ctx,'company')),409);management=old;bookings[0].operationKey='save-K';await rejectsStatus(as(()=>service.read(ctx,'company')),409);bookings[0].operationKey='request-K';
 const prior=db.$queryRaw;db.$queryRaw=async(...args)=>{const rows=await prior(...args);if(args[0].join('').includes("'booking_approval' AS objectType"))revoke=true;return rows;};await rejectsStatus(as(()=>service.read(ctx,'company')),403);revoke=false;db.$queryRaw=prior;
 const held=queryCount;await rejectsStatus(identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w2',userId:'admin',isSaasAdmin:false},()=>service.read(ctx,'company')),403);assert.equal(queryCount,held);
 const noWorkspace=await identity.runWithRequestIdentity({tenantId:'t1',userId:'admin',isSaasAdmin:false},()=>service.read(context('admin'),'company'));assert.equal(noWorkspace.bookingWorkspace.state,'unavailable');assert(noWorkspace.businessItems.every(r=>r.objectType==='management_request'));assert(shared.enterpriseMembershipAuditSnapshot(noWorkspace,'merchant','company'));
 const legacy={...value};delete legacy.expenseCoverage;delete legacy.expenseItems;delete legacy.businessCoverage;delete legacy.businessItems;delete legacy.bookingWorkspace;legacy.unavailable=['approvals','profile_requests','order_and_financial_audit'];const oldValue=shared.enterpriseMembershipAuditSnapshot(legacy,'merchant','company','s1');assert(oldValue.unavailable.includes('profile_requests'));assert.equal(oldValue.businessItems,undefined);
});

test('invite transfer audit smoke: original create/revoke/decision and exact K/C projections do not infer current state or expose codes', async () => {
 const shared=require('@rental-os/shared'),{EnterpriseMembershipAuditService}=load('apps/api/src/modules/enterprise/enterprise-membership-audit.service.ts',{'@rental-os/shared':shared,'../../common/request-identity':identity,'./enterprise-command.service':commandModule});
 const when='2026-11-01T00:00:00.000Z',base={tenantId:'t1',corporateCustomerId:'company',createdAt:new ClockDate(when),reason:'Original reason'},invite={id:'invite-1',corporateCustomerId:'company',status:'active',revision:1,used:0,maxUses:2,createdAt:when,expiresAt:'2026-11-02T00:00:00.000Z'};
 let invites=[{...base,auditObjectId:'invite-1',objectType:'invite',operationKey:'invite-K',actorUserId:'customer:admin',target:'invite.create:company',result:{invite,codeRetrievableAgain:false}},{...base,auditObjectId:'invite-1',objectType:'invite',operationKey:'revoke-K',actorUserId:'customer:admin',target:'invite.revoke:invite-1',result:{id:'invite-1',status:'revoked',revision:2}}];
 const closed={version:1,purpose:'administrator_transfer_resolution',outcome:'closed',tenantId:'t1',corporateCustomerId:'company',applicantCustomerId:'p1',transferId:'transfer-2',originalOperationKey:'seal-K',closureOperationKey:'close-C',decision:{id:'transfer-2',state:'rejected',revision:2},retryable:false},sealHash=enterpriseHash({action:'administrator.decision.sealed',...closed});
 const observed={...closed,outcome:'observed',transferId:'transfer-1',originalOperationKey:'decision-K',closureOperationKey:'observe-C',decision:{id:'transfer-1',state:'approved',revision:2}};
 let transfers=[{...base,auditObjectId:'transfer-1',objectType:'administrator_transfer',operationKey:'transfer-K',actorUserId:'customer:admin',target:'administrator.transfer:company',result:{id:'transfer-1',state:'pending',revision:1},applicantCustomerId:'p1',association:{fromCustomerId:'admin',targetMembershipId:'employee-a'}},{...base,auditObjectId:'transfer-1',objectType:'administrator_transfer',operationKey:'decision-K',actorUserId:'customer:p1',target:'administrator.accept:transfer-1',result:{id:'transfer-1',state:'approved',revision:2},applicantCustomerId:'p1'},
 {...base,auditObjectId:'transfer-2',objectType:'administrator_transfer',operationKey:'seal-K',actorUserId:'customer:p1',target:'administrator.decision.sealed:transfer-2',result:Object.fromEntries(Object.entries(closed).reverse()),requestHash:sealHash,applicantCustomerId:'p1'},
 {...base,auditObjectId:'transfer-2',objectType:'administrator_transfer',operationKey:'close-C',actorUserId:'customer:p1',target:'administrator.decision.close:'+enterpriseHash({transferId:'transfer-2',originalOperationKey:'seal-K'}),result:closed,applicantCustomerId:'p1',originalTarget:'administrator.decision.sealed:transfer-2',originalResult:closed,originalHash:sealHash},
 {...base,auditObjectId:'transfer-1',objectType:'administrator_transfer',operationKey:'observe-C',actorUserId:'customer:p1',target:'administrator.decision.close:'+enterpriseHash({transferId:'transfer-1',originalOperationKey:'decision-K'}),result:observed,applicantCustomerId:'p1',originalTarget:'administrator.accept:transfer-1',originalResult:{id:'transfer-1',state:'approved',revision:2}}];
 const db={$queryRaw:async(strings,...values)=>{const sql=strings.join('?');assert(values.includes('t1')&&values.includes('company'));return sql.includes("'invite' AS objectType")?invites:sql.includes("'administrator_transfer' AS objectType")?transfers:[];}},access={requireAction:async()=>({membershipId:'auditor',permissionRevision:'1:1'})},service=new EnterpriseMembershipAuditService(db,access),as=fn=>identity.runWithRequestIdentity({tenantId:'t1',userId:'admin',isSaasAdmin:false},fn);
 const value=await as(()=>service.read(context('admin'),'company'));assert.equal(value.workflowItems.length,7);assert.equal(value.workflowItems.find(r=>r.operationKey==='invite-K').result.status,'active');assert.equal(value.workflowItems.find(r=>r.operationKey==='transfer-K').result.state,'pending');assert.equal(value.workflowItems.find(r=>r.operationKey==='seal-K').result.outcome,'closed');assert.equal(value.workflowItems.find(r=>r.operationKey==='observe-C').result.outcome,'observed');assert(!JSON.stringify(value).includes('originalOperationKey'));assert(!value.unavailable.includes('invites_and_transfers'));
 const hash=transfers[2].requestHash;transfers[2].requestHash='bad';await rejectsStatus(as(()=>service.read(context('admin'),'company')),409);transfers[2].requestHash=hash;const prior=transfers[4].originalResult;transfers[4].originalResult={...prior,state:'rejected'};await rejectsStatus(as(()=>service.read(context('admin'),'company')),409);transfers[4].originalResult=prior;
 invites[0].result.code='raw-invitation-code';await rejectsStatus(as(()=>service.read(context('admin'),'company')),409);delete invites[0].result.code;const initial=invites;invites=Array.from({length:201},(_,n)=>({...initial[0],operationKey:'overflow-'+n}));await rejectsStatus(as(()=>service.read(context('admin'),'company')),409);invites=initial;
 assert(shared.enterpriseMembershipAuditSnapshot(value,'merchant','company'));assert.equal(shared.enterpriseMembershipAuditSnapshot({...value,workflowItems:[...value.workflowItems,value.workflowItems[0]]},'merchant','company'),undefined);
});

async function inviteCreationOriginalFixture() {
  const f = fixture(), input = change('invite-create-K', 0, { lifetimeHours: 1, maxUses: 1 });
  const first = await f.as('admin', () => f.members.createInvite(context('admin'), 'company', input));
  assert.match(first.code, /^[a-zA-Z0-9_-]{43}$/); const original = { invite: first.invite, codeRetrievableAgain: false };
  return { f, original, read: (corporate = 'company', key = 'invite-create-K', actor = 'admin') => f.as(actor, () => f.members.readInviteCreation(context(actor), corporate, key)) };
}

test('invite creation original survives revoke/use/expiry/policy/grant changes; raw code is not in receipt and cannot be recovered or regenerated', async () => {
  const { f, original, read } = await inviteCreationOriginalFixture();
  const stored = JSON.parse(f.state.receipts[0].result); assert.equal('code' in stored, false);
  Object.assign(f.state.invites.find(r => r.id === original.invite.id), { status: 'revoked', revision: 7, used: 1 });
  clock += 7200000; f.state.invitePolicy = null; f.state.grants = []; f.state.corporateEnabled = false;
  // Keep the current authenticated session valid; expiry of an invite is not logout.
  f.state.sessions[0].expiresAt = new ClockDate(clock + 3600000);
  const before = plain(f.state), writes = f.counts.writes;
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes); assert.equal(f.state.invites.length, 2);
});

test('invite creation original binds actor/tenant/action/company/K; missing receipt never discovers an invitation or proves no execution', async () => {
  for (const alter of [r => { r.actorUserId = 'customer:p1'; }, r => { r.tenantId = 't2'; }, r => { r.target = 'invite.revoke:company'; }, r => { r.operationKey = 'other-K'; }]) {
    const { f, read } = await inviteCreationOriginalFixture(); alter(f.state.receipts[0]); const before = plain(f.state);
    assert.deepEqual(plain(await read()), { state: 'not_recorded' }); assert.deepEqual(plain(f.state), before);
  }
  const { f, read } = await inviteCreationOriginalFixture();
  assert.deepEqual(plain(await read('other')), { state: 'not_recorded' }); assert.deepEqual(plain(await read('company', 'absent')), { state: 'not_recorded' });
  assert.deepEqual(plain(await read('company', 'invite-create-K', 'p1')), { state: 'not_recorded' });
  await rejectsStatus(f.as('admin', () => f.members.readInviteCreation({ ...context('admin'), tenantId: 't2' }, 'company', 'invite-create-K')), 403);
  for (const [corporate, key] of [['', 'K'], ['company', ' '], ['x'.repeat(192), 'K'], ['company', 'x'.repeat(129)]]) await rejectsStatus(read(corporate, key), 400);
});

test('invite original rejects corrupt creation fields, false code promises, illicit raw code or missing original invite; no history is repaired', async () => {
  for (const change of [{ codeRetrievableAgain: true }, { code: 'must-not-be-output' }, { invite: null }, { invite: [] }, { invite: { id: 'missing' } },
    { invite: { corporateCustomerId: 'other' } }, { invite: { status: 'revoked' } }, { invite: { used: 1 } }, { invite: { revision: 2 } }, { invite: { maxUses: 0 } },
    { invite: { createdAt: '2026-02-30T12:00:00.000Z' } }, { invite: { expiresAt: '2026-11-01T11:00:00.000Z' } }]) {
    const { f, original, read } = await inviteCreationOriginalFixture();
    f.state.receipts[0].result = JSON.stringify({ ...original, ...change, ...(change.invite && !Array.isArray(change.invite) ? { invite: { ...original.invite, ...change.invite } } : {}) });
    const before = plain(f.state), writes = f.counts.writes; await rejectsStatus(read(), 409); assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  }
  const { f, original, read } = await inviteCreationOriginalFixture(); f.state.receipts[0].result = '{private-broken'; await rejectsStatus(read(), 409);
  f.state.receipts[0].result = JSON.stringify(original); f.state.invites = f.state.invites.filter(r => r.id !== original.invite.id); await rejectsStatus(read(), 409);
});

test('invite original still revalidates the current personal session after SQL; restrictive membership may read but revoked credentials do not', async () => {
  const { f, read } = await inviteCreationOriginalFixture(); f.state.profiles[0].membership.status = 'suspended'; assert.equal((await read()).state, 'committed');
  f.fault.afterInviteCreationRead = () => { f.state.sessions[0].revokedAt = new ClockDate(); };
  const writes = f.counts.writes; await rejectsStatus(read(), 403); assert.equal(f.counts.writes, writes);
});

test('invitation revocation smoke: original actor/company/invite/K survives grant loss, never uses today state or writes twice', async () => {
  const f = fixture(), original = await f.as('admin', () => f.members.revokeInvite(context('admin'), 'company', 'invite', change('revoke-K')));
  f.state.grants = []; f.state.corporateEnabled = false; f.state.invites[0].revision = 8; f.state.invites[0].status = 'active';
  const before = plain(f.state), writes = f.counts.writes;
  const read = (key = 'revoke-K') => f.as('admin', () => f.members.readInviteRevocation(context('admin'), 'company', 'invite', key));
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  assert.deepEqual(plain(await read('absent-K')), { state: 'not_recorded' });
  assert.deepEqual(plain(await f.as('p1', () => f.members.readInviteRevocation(context('p1'), 'company', 'invite', 'revoke-K'))), { state: 'not_recorded' });
  await rejectsStatus(f.as('admin', () => f.members.readInviteRevocation(context('admin'), 'other', 'invite', 'revoke-K')), 409);
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
});

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

test('join submission smoke: original pending, prior relation and persisted refusal read without guessing codes, current-state fallback or another admission', async () => {
  const f = fixture(), original = await f.as('p1', () => f.members.join(context('p1'), join('submission-K')));
  f.state.workflows[0].state = 'rejected'; f.state.workflows[0].revision = 9; f.state.corporateEnabled = false;
  const before = plain(f.state), writes = f.counts.writes;
  assert.deepEqual(plain(await f.as('p1', () => f.members.readJoinSubmission(context('p1'), 'submission-K'))), { state: 'committed', result: plain(original) });
  assert.deepEqual(plain(await f.as('p2', () => f.members.readJoinSubmission(context('p2'), 'submission-K'))), { state: 'not_recorded' });
  assert.deepEqual(plain(await f.as('p1', () => f.members.readJoinSubmission(context('p1'), 'absent-K'))), { state: 'not_recorded' });
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  const previous = fixture(); previous.state.relations.push(relation('prior-membership', 'p1')); await previous.as('p1', () => previous.members.join(context('p1'), join('prior-K'))); previous.state.relations[1].status = 'exited';
  assert.deepEqual(plain(await previous.as('p1', () => previous.members.readJoinSubmission(context('p1'), 'prior-K'))), { state: 'committed', result: { membershipId: 'prior-membership', state: 'already_member' } });
  const refused = fixture(); refused.state.invites[0].used = 1; await rejectsStatus(refused.as('p1', () => refused.members.join(context('p1'), join('refusal-K'))), 403);
  const rate = refused.state.rates[0].count; assert.deepEqual(plain(await refused.as('p1', () => refused.members.readJoinSubmission(context('p1'), 'refusal-K'))), { state: 'committed', result: { state: 'invite_unavailable' } }); assert.equal(refused.state.rates[0].count, rate);
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

test('join withdrawal smoke: own original request/K survives later state changes; no second withdrawal, guessed ownership or counter writes', async () => {
  const f = fixture(), first = await f.as('p1', () => f.members.join(context('p1'), join('join-K')));
  const original = await f.as('p1', () => f.members.withdrawJoin(context('p1'), first.id, change('withdraw-K')));
  assert.equal(f.state.invites[0].used, 0);
  f.state.workflows[0].state = 'approved'; f.state.workflows[0].revision = 9; f.state.corporateEnabled = false; f.state.grants = [];
  const before = plain(f.state), writes = f.counts.writes, read = (key = 'withdraw-K', id = first.id) => f.as('p1', () => f.members.readJoinWithdrawal(context('p1'), id, key));
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  assert.deepEqual(plain(await read('absent-K')), { state: 'not_recorded' });
  assert.deepEqual(plain(await read('withdraw-K', 'other-request')), { state: 'not_recorded' });
  assert.deepEqual(plain(await f.as('p2', () => f.members.readJoinWithdrawal(context('p2'), first.id, 'withdraw-K'))), { state: 'not_recorded' });
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  const receipt = f.state.receipts.find(r => r.operationKey === 'withdraw-K'); receipt.result = '{bad'; await rejectsStatus(read(), 409);
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
  let extensionQueueReads = 0, exchangeQueueReads = 0;
  const service = new EnterpriseTaskCenterService(f.db, f.commands, f.apps, f.members, approvals, new EnterpriseAccessService(f.db), { mine: async () => [{ id: 'own-management', corporateCustomerId: 'company', state: 'supplement_required', revision: 2, createdAt: new ClockDate().toISOString() }] }, { list: async (_context, corporateId) => {
    if (corporateId) { extensionQueueReads++; return [{ id: 'extension-review', state: 'pending', revision: 1, corporateCustomerId: 'company', applicantCustomerId: 'p1' }, { id: 'extension-self', state: 'pending', revision: 1, corporateCustomerId: 'company', applicantCustomerId: 'admin' }]; }
    return [{ id: 'extension-own', state: 'approved', revision: 2, corporateCustomerId: 'company', expiresAt: '2099-01-01T00:00:00Z' }];
  } }, { list: async (_context, corporateId) => {
    if (corporateId) { exchangeQueueReads++; return [{ id: 'exchange-review', state: 'pending', revision: 1, corporateCustomerId: 'company', applicantCustomerId: 'p1' }, { id: 'exchange-self', state: 'pending', revision: 1, corporateCustomerId: 'company', applicantCustomerId: 'admin' }]; }
    return [{ id: 'exchange-own', state: 'approved', revision: 2, corporateCustomerId: 'company', expiresAt: '2099-01-01T00:00:00Z' },
      { id: 'exchange-confirmed', state: 'approved', revision: 3, corporateCustomerId: 'company', employeeConfirmation: { operationKey: 'confirm-key' }, expiresAt: '2099-01-01T00:00:00Z' }];
  } }, { mine: async () => [], orderSource: async () => ({ state: 'unavailable', coverage: 'current_workspace_original_own_enterprise_employee_orders' }) });
  const tasks = await f.as('admin', () => service.tasks(context('admin'), 'company'));
  assert.equal(tasks.items.some(row => row.id === 'own-app' && row.requiresAction), true);
  assert.equal(tasks.items.some(row => row.id === 'extension-own' && row.kind === 'extension_approval' && row.page === 'extension-approvals' && row.requiresAction), true);
  assert.equal(tasks.items.some(row => row.kind === 'join_request' && row.page === 'join-requests'), true);
  assert.equal(approvalsRead, 1, 'no review queue without approvals:review');
  assert.equal(extensionQueueReads, 0, 'no extension queue without exact review action');
  assert.equal(exchangeQueueReads, 0, 'no exchange queue without exact review action');
  assert.equal(tasks.items.some(row => row.id === 'exchange-own' && row.page === 'exchange-approvals' && row.requiresAction), true, 'approved expense requires applicant consent, not physical exchange');
  assert.equal(tasks.items.some(row => row.id === 'exchange-confirmed' && !row.requiresAction), true, 'expense consent does not expose a physical execution task');
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
  assert.equal(exchangeQueueReads, 1); assert.equal(reviewTasks.items.some(row => row.id === 'exchange-review' && row.requiresAction && row.page === 'exchange-approvals'), true);
  assert.equal(reviewTasks.items.some(row => row.id === 'exchange-self'), false);
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
test('management save smoke: own company/K receipt survives supplement, withdrawal and lost authority; corrupt or unlinked evidence never writes or discloses material', async () => {
  const f = fixture(), api = new EnterpriseManagementRequestService(f.db, f.commands, new EnterpriseAccessService(f.db));
  f.state.grants.push({ ...f.state.grants[0], action: 'requests:manage' });
  const profile = await f.as('admin', () => api.profile(context('admin'), 'company'));
  const input = change('management-save-K', 0, { requestType: 'profile_change', objectRevision: profile.profileRevision, proposal: { legalName: 'Proposed only' }, evidenceFileIds: [], submit: true });
  const original = await f.as('admin', () => api.save(context('admin'), 'company', input));
  const expected = { state: 'committed', result: { corporateCustomerId: 'company', ...plain(original) } };
  const read = (corporate = 'company', key = 'management-save-K', actor = 'admin') => f.as(actor, () => api.readSave(context(actor), corporate, key));
  const firstState = plain(f.state), firstCounts = plain(f.counts);
  assert.deepEqual(plain(await read()), expected); assert.deepEqual(plain(f.state), firstState); assert.deepEqual(plain(f.counts), firstCounts);
  await f.as('operator', () => api.review(user, original.id, change('management-supplement-K', original.revision, { decision: 'supplement' })));
  assert.deepEqual(plain(await read()), expected);
  const draft = await f.as('admin', () => api.save(context('admin'), 'company', { ...input, operationKey: 'management-draft-K', requestId: original.id, expectedRevision: 2, submit: false }));
  assert.equal(draft.state, 'draft'); assert.equal(draft.revision, 3);
  await f.as('admin', () => api.withdraw(context('admin'), original.id, change('management-withdraw-K', draft.revision)));
  const row = f.state.workflows.find(w => w.id === original.id), receipt = f.state.receipts.find(r => r.operationKey === 'management-save-K');
  assert.equal(row.state, 'withdrawn'); row.revision = 19; row.payload = '{current-private-material-not-parsed';
  f.state.grants = []; f.state.tenantEnabled = false; f.state.corporateEnabled = false; f.state.relations[0].status = 'exited';
  f.state.profiles.at(-1).status = 'inactive'; f.state.profiles.at(-1).membership.status = 'closed'; f.state.profiles[0].membership.status = 'suspended';
  const before = plain(f.state), counts = plain(f.counts);
  assert.deepEqual(plain(await read()), expected); assert.deepEqual(plain(await read()), expected);
  assert.deepEqual(plain(await read('company', 'management-draft-K')), { state: 'committed', result: { corporateCustomerId: 'company', ...plain(draft) } });
  assert.deepEqual(plain(await read('other')), { state: 'not_recorded' }); assert.deepEqual(plain(await read('company', 'absent-K')), { state: 'not_recorded' });
  assert.deepEqual(plain(await read('company', 'management-save-K', 'p1')), { state: 'not_recorded' });
  await rejectsStatus(f.as('admin', () => api.readSave({ ...context('admin'), tenantId: 't2' }, 'company', 'management-save-K')), 403);
  assert.deepEqual(plain(f.state), before); assert.deepEqual(plain(f.counts), counts);
  const originalReceipt = { ...receipt };
  for (const patch of [{ actorUserId: 'customer:p1' }, { tenantId: 't2' }, { target: 'management-request.save:other' }, { target: 'management-request.withdraw:company' }, { operationKey: 'other-K' }]) {
    Object.assign(receipt, patch); const changed = plain(f.state);
    assert.deepEqual(plain(await read()), { state: 'not_recorded' }); assert.deepEqual(plain(f.state), changed); Object.assign(receipt, originalReceipt);
  }
  const conflict = promise => assert.rejects(promise, error => error.getStatus?.() === 409 && error.message === '原管理申请保存收据或对象关联无法精确核对，保留原引用');
  for (const bad of ['{private-broken-json', null, [], { ...plain(original), id: 'not/a/canonical-id' }, { ...plain(original), id: 'missing' },
    { ...plain(original), state: 'supplement_required' }, { ...plain(original), revision: 0 }, { ...plain(original), revision: 1.5 },
    { ...plain(original), revision: Number.MAX_SAFE_INTEGER + 1 }, { ...plain(original), revision: '1' }, { ...plain(original), effect: 'business_changed' }]) {
    receipt.result = bad; const changed = plain(f.state); await conflict(read()); assert.deepEqual(plain(f.state), changed);
  }
  receipt.result = { ...plain(original), proposal: { legalName: 'private' }, evidenceFileIds: ['private-file'], reason: 'private', creditLimit: 'private', currentActions: ['requests:manage'] };
  assert.deepEqual(plain(await read()), expected, 'only the five original result fields may be projected'); Object.assign(receipt, originalReceipt);
  const originalRow = { ...row };
  for (const patch of [{ tenantId: 't2' }, { corporateCustomerId: 'other' }, { applicantCustomerId: 'p1' }, { kind: 'corporate_application' }]) {
    Object.assign(row, patch); const changed = plain(f.state); await conflict(read()); assert.deepEqual(plain(f.state), changed); Object.assign(row, originalRow);
  }
  f.state.workflows = f.state.workflows.filter(w => w.id !== original.id);
  const missing = plain(f.state); await conflict(read()); assert.deepEqual(plain(f.state), missing); f.state.workflows.push(row);
  f.fault.afterManagementSaveRead = () => { f.state.sessions[0].revokedAt = new ClockDate(); };
  await rejectsStatus(read(), 403, '当前个人会员'); assert.deepEqual(plain(f.counts), counts, 'no read opens a command transaction, locks or writes a second result');
});

test('management withdrawal smoke: original actor/request/K only, historical receipt survives later state and missing grants, corrupt proof never recreates facts', async () => {
  const f = fixture(), api = new EnterpriseManagementRequestService(f.db, f.commands, new EnterpriseAccessService(f.db));
  f.state.grants.push({ ...f.state.grants[0], action: 'requests:manage' });
  const profile = await f.as('admin', () => api.profile(context('admin'), 'company'));
  const saved = await f.as('admin', () => api.save(context('admin'), 'company', change('withdrawal-source-save', 0, { requestType: 'profile_change', objectRevision: profile.profileRevision, proposal: { legalName: 'Pending proposal' }, evidenceFileIds: [], submit: true })));
  const input = change('management-withdrawal-K', saved.revision), withdrawn = await f.as('admin', () => api.withdraw(context('admin'), saved.id, input));
  const read = (id = saved.id, key = input.operationKey, actor = 'admin') => f.as(actor, () => api.readWithdrawal(context(actor), id, key));
  const expected = { state: 'committed', result: plain(withdrawn) }, row = f.state.workflows.find(row => row.id === saved.id), receipt = f.state.receipts.find(row => row.operationKey === input.operationKey);
  const counts = plain(f.counts); assert.deepEqual(plain(await read()), expected);
  row.state = 'pending'; row.revision = 20; row.payload = '{later-private-material'; f.state.grants = []; f.state.tenantEnabled = false; f.state.corporateEnabled = false; f.state.relations[0].status = 'exited';
  const before = plain(f.state); assert.deepEqual(plain(await read()), expected); assert.deepEqual(plain(f.state), before); assert.deepEqual(plain(f.counts), counts);
  assert.deepEqual(plain(await read('another-request')), { state: 'not_recorded' }); assert.deepEqual(plain(await read(saved.id, 'missing-K')), { state: 'not_recorded' });
  assert.deepEqual(plain(await read(saved.id, input.operationKey, 'p1')), { state: 'not_recorded' });
  await rejectsStatus(f.as('admin', () => api.readWithdrawal({ ...context('admin'), tenantId: 't2' }, saved.id, input.operationKey)), 403);
  const originalReceipt = { ...receipt }, originalRow = { ...row };
  const conflict = promise => assert.rejects(promise, error => error.getStatus?.() === 409 && error.message === '原管理申请撤回收据缺少精确本人、对象或修订，保留原引用');
  for (const result of ['{broken-json', null, [], { id: 'another-request', state: 'withdrawn', revision: 2 }, { id: saved.id, state: 'pending', revision: 2 }, { ...withdrawn, revision: '2' }, { ...withdrawn, revision: 1 }]) {
    receipt.result = result; await conflict(read()); assert.deepEqual(plain(f.counts), counts);
  }
  Object.assign(receipt, originalReceipt); receipt.result = { ...withdrawn, reason: 'private', evidenceFileIds: ['private'], currentAuthority: 'private' }; assert.deepEqual(plain(await read()), expected); Object.assign(receipt, originalReceipt);
  for (const patch of [{ kind: 'corporate_application' }, { applicantCustomerId: 'p1' }, { tenantId: 't2' }]) { Object.assign(row, patch); await conflict(read()); Object.assign(row, originalRow); }
  for (const patch of [{ actorUserId: 'customer:p1' }, { target: 'management-request.save:company' }, { tenantId: 't2' }]) { Object.assign(receipt, patch); assert.deepEqual(plain(await read()), { state: 'not_recorded' }); Object.assign(receipt, originalReceipt); }
  f.state.workflows = f.state.workflows.filter(row => row.id !== saved.id); await conflict(read()); f.state.workflows.push(row);
  f.fault.afterManagementWithdrawalRead = () => { f.state.sessions[0].revokedAt = new ClockDate(); }; await rejectsStatus(read(), 403);
  assert.deepEqual(plain(f.counts), counts, 'reads never open a write transaction or replay a withdrawal');
});

test('merchant management review smoke: original operator/request/K result, immutable type selects current finance authority, later material never becomes the original decision', async () => {
  const f = fixture(), api = new EnterpriseManagementRequestService(f.db, f.commands, new EnterpriseAccessService(f.db)); f.state.grants.push({ ...f.state.grants[0], action: 'requests:manage' });
  const profile = await f.as('admin', () => api.profile(context('admin'), 'company'));
  const input = change('merchant-review-source', 0, { requestType: 'profile_change', objectRevision: profile.profileRevision, proposal: { legalName: 'Original source' }, evidenceFileIds: [], submit: true });
  const saved = await f.as('admin', () => api.save(context('admin'), 'company', input)); const decision = await f.as('operator', () => api.review(user, saved.id, change('merchant-review-K', 1, { decision: 'supplement' })));
  const expected = { state: 'committed', result: { corporateCustomerId: 'company', requestType: 'profile_change', ...plain(decision) } }, read = (id = saved.id, key = 'merchant-review-K') => f.as('operator', () => api.readReview(user, id, key));
  assert.deepEqual(plain(await read()), expected);
  await f.as('admin', () => api.save(context('admin'), 'company', { ...input, operationKey: 'merchant-review-later-save', requestId: saved.id, expectedRevision: 2 }));
  const row = f.state.workflows.find(row => row.id === saved.id), receipt = f.state.receipts.find(row => row.operationKey === 'merchant-review-K'); row.state = 'approved'; row.revision = 40; row.payload = JSON.stringify({ requestType: 'profile_change', proposal: 'changed-private-material' });
  const counts = plain(f.counts), before = plain(f.state); assert.deepEqual(plain(await read()), expected); assert.deepEqual(plain(f.state), before); assert.deepEqual(plain(f.counts), counts);
  assert.deepEqual(plain(await read('other-request')), { state: 'not_recorded' }); assert.deepEqual(plain(await read(saved.id, 'missing-K')), { state: 'not_recorded' });
  assert.deepEqual(plain(await f.as('other-operator', () => api.readReview({ ...user, id: 'other-operator' }, saved.id, 'merchant-review-K'))), { state: 'not_recorded' });
  await rejectsStatus(f.as('admin', () => api.readReview(user, saved.id, 'merchant-review-K')), 403);
  const originalReceipt = { ...receipt }, originalRow = { ...row }; const conflict = promise => assert.rejects(promise, error => error.getStatus?.() === 409 && error.message === '原商户审核收据、申请或类别无法精确核对，保留原引用');
  for (const result of ['{broken', null, [], { ...decision, id: 'other-request' }, { ...decision, state: 'pending' }, { ...decision, revision: '2' }, { ...decision, revision: 1 }, { ...decision, effect: 'business_changed' }]) { receipt.result = result; await conflict(read()); }
  Object.assign(receipt, originalReceipt); receipt.result = { ...decision, proposal: 'private', reason: 'private', amount: 'private' }; assert.deepEqual(plain(await read()), expected); Object.assign(receipt, originalReceipt);
  for (const patch of [{ kind: 'corporate_application' }, { tenantId: 't2' }, { payload: '{broken-type' }, { payload: '{"requestType":"unknown"}' }]) { Object.assign(row, patch); await conflict(read()); Object.assign(row, originalRow); }
  for (const patch of [{ actorUserId: 'operator:other' }, { tenantId: 't2' }, { target: 'management-request.save:company' }]) { Object.assign(receipt, patch); assert.deepEqual(plain(await read()), { state: 'not_recorded' }); Object.assign(receipt, originalReceipt); }
  const credit = await f.as('admin', () => api.save(context('admin'), 'company', change('review-credit-source', 0, { requestType: 'credit_change', objectRevision: String(profile.creditRevision ?? 0), proposal: { requestedCreditLimit: '100.00', currency: 'CNY' }, evidenceFileIds: [], submit: true })));
  const financeUser = { ...user, permissions: [...user.permissions, 'rental-os:finance:manage'] }; const creditDecision = await f.as('operator', () => api.review(financeUser, credit.id, change('review-credit-K', 1, { decision: 'reject' })));
  assert.deepEqual(plain(await f.as('operator', () => api.readReview(financeUser, credit.id, 'review-credit-K'))), { state: 'committed', result: { corporateCustomerId: 'company', requestType: 'credit_change', ...plain(creditDecision) } });
  await rejectsStatus(f.as('operator', () => api.readReview(user, credit.id, 'review-credit-K')), 403);
  const finalCounts = plain(f.counts); f.fault.afterManagementReviewRead = () => { financeUser.permissions = []; }; await rejectsStatus(f.as('operator', () => api.readReview(financeUser, credit.id, 'review-credit-K')), 403);
  assert.deepEqual(plain(f.counts), finalCounts, 'original reads never recreate a review or mutate business facts');
});

test('management feedback smoke: exact own persisted feedback bypasses the bounded list, task locator needs no business grant and never resolves a command receipt', async () => {
  const f = fixture(), api = new EnterpriseManagementRequestService(f.db, f.commands, new EnterpriseAccessService(f.db)); f.state.grants.push({ ...f.state.grants[0], action: 'requests:manage' });
  const profile = await f.as('admin', () => api.profile(context('admin'), 'company'));
  const input = change('feedback-source-K', 0, { requestType: 'profile_change', objectRevision: profile.profileRevision, proposal: { legalName: 'Original proposal' }, evidenceFileIds: [], submit: true });
  const saved = await f.as('admin', () => api.save(context('admin'), 'company', input)); await f.as('operator', () => api.review(user, saved.id, change('feedback-supplement-K', 1, { decision: 'supplement', reason: 'Please add original authority evidence' })));
  f.state.grants = []; f.state.tenantEnabled = false; f.state.corporateEnabled = false;
  const detail = await f.as('admin', () => api.detail(context('admin'), saved.id)); assert.equal(detail.state, 'supplement_required'); assert.equal(detail.revision, 2); assert.equal(detail.objectRevision, profile.profileRevision);
  assert.equal(detail.decisionReason, 'Please add original authority evidence'); assert.equal(detail.effect, 'review_only_no_business_change'); assert.deepEqual(plain(detail.proposal), { legalName: 'Original proposal' });
  const tasks = new EnterpriseTaskCenterService(f.db, f.commands, f.apps, f.members, { list: async () => [] }, new EnterpriseAccessService(f.db), api, { list: async () => [] }, { list: async () => [] }, { mine: async () => [], orderSource: async () => ({ state: 'unavailable', coverage: 'current_workspace_original_own_enterprise_employee_orders' }) });
  const task = (await f.as('admin', () => tasks.tasks(context('admin')))).items.find(item => item.id === saved.id); assert.equal(task.kind, 'management_request'); assert.equal(task.requiresAction, true); assert.equal(task.page, 'profile');
  const row = f.state.workflows.find(row => row.id === saved.id); for (let i = 0; i < 200; i++) f.state.workflows.push({ ...row, id: `older-feedback-${i}` });
  await rejectsStatus(f.as('admin', () => api.mine(context('admin'))), 409); const before = plain(f.state), counts = plain(f.counts);
  assert.deepEqual(plain(await f.as('admin', () => api.detail(context('admin'), saved.id))), plain(detail)); assert.deepEqual(plain(f.state), before); assert.deepEqual(plain(f.counts), counts);
  await rejectsStatus(f.as('p1', () => api.detail(context('p1'), saved.id)), 404); await rejectsStatus(f.as('admin', () => api.detail(context('admin'), 'missing-id')), 404);
  await rejectsStatus(f.as('admin', () => api.detail({ ...context('admin'), tenantId: 't2' }, saved.id)), 403);
  const originalPayload = row.payload; row.payload = JSON.stringify({ ...JSON.parse(originalPayload), proposal: { legalName: 'Original proposal', privateData: 'must-not-project' } });
  await assert.rejects(f.as('admin', () => api.detail(context('admin'), saved.id)), error => error.getStatus?.() === 409 && error.message === '原本人管理申请反馈或材料无法核对'); row.payload = originalPayload;
  f.fault.afterManagementDetailRead = () => { f.state.sessions[0].revokedAt = new ClockDate(); }; await rejectsStatus(f.as('admin', () => api.detail(context('admin'), saved.id)), 403);
  assert.deepEqual(plain(f.counts), counts, 'feedback and task projection do not write, replay or apply a proposal');
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
  const tasks = new EnterpriseTaskCenterService(f.db, f.commands, f.apps, f.members, { list: async () => [] }, new EnterpriseAccessService(f.db), api, { list: async () => [] }, { list: async () => [] }, { mine: async () => [], orderSource: async () => ({ state: 'unavailable', coverage: 'current_workspace_original_own_enterprise_employee_orders' }) });
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

test('join review smoke: original reviewer/company/request/K survives grant loss without exposing applicant receipts or activating twice', async () => {
  const f = fixture(), pending = await f.as('p1', () => f.members.join(context('p1'), join('review-join-K')));
  const original = await f.as('admin', () => f.members.decideJoin(context('admin'), 'company', pending.id, change('review-K', 1, { decision: 'approve' })));
  f.state.workflows[0].state = 'withdrawn'; f.state.workflows[0].revision = 9; f.state.grants = []; f.state.corporateEnabled = false;
  const before = plain(f.state), writes = f.counts.writes, read = (key = 'review-K', corporate = 'company') => f.as('admin', () => f.members.readJoinReview(context('admin'), corporate, pending.id, key));
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  assert.deepEqual(plain(await read('absent-K')), { state: 'not_recorded' });
  assert.deepEqual(plain(await f.as('p1', () => f.members.readJoinReview(context('p1'), 'company', pending.id, 'review-K'))), { state: 'not_recorded' });
  await rejectsStatus(read('review-K', 'other-company'), 409);
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  f.state.receipts.find(r => r.operationKey === 'review-K').result = { id: pending.id, state: 'pending', revision: 2 }; await rejectsStatus(read(), 409);
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

test('member restoration rechecks same-tenant personal/unmerged active master/account/membership and never rebinds old grant/policy/approval facts', async () => {
  const alterations = [p => { p.customerType = 'corporate'; }, p => { p.mergedIntoCustomerId = 'p2'; }, p => { p.status = 'suspended'; },
    p => { p.account.status = 'closed'; }, p => { p.membership.status = 'pending'; }, p => { p.tenantId = 't2'; }];
  for (const alter of alterations) {
    const f = fixture(), row = relation('restore-r', 'p1'); row.status = 'suspended'; f.state.relations.push(row); alter(f.state.profiles[1]);
    const before = plain(f.state);
    await assert.rejects(f.as('admin', () => f.members.changeMember(context('admin'), 'company', row.id, change('restore-K', 0, { status: 'active', expectedUpdatedAt: row.updatedAt.toISOString() }))), error => error.getStatus() === 409 && error.body.code === 'enterprise_revision_conflict' && error.message === '个人会员不可恢复');
    assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, 0);
  }
  const f = fixture(), row = relation('restore-r', 'p1'); row.status = 'suspended'; f.state.relations.push(row);
  f.state.grants.push({ tenantId: 't1', corporateCustomerId: 'company', membershipId: row.id, action: 'portal:enter', membershipUpdatedAt: row.updatedAt });
  f.state.policies = [{ tenantId: 't1', corporateCustomerId: 'company', membershipId: row.id, membershipUpdatedAt: row.updatedAt }];
  f.state.approvals = [{ id: 'old-approved', reviewerMembershipUpdatedAt: row.updatedAt, state: 'approved' }];
  const before = plain(f.state), input = change('restore-K', 0, { status: 'active', expectedUpdatedAt: row.updatedAt.toISOString() });
  const result = await f.as('admin', () => f.members.changeMember(context('admin'), 'company', row.id, input));
  assert.equal(result.status, 'active'); assert.ok(Date.parse(result.updatedAt) > Date.parse(before.relations[1].updatedAt));
  for (const key of ['profiles', 'grants', 'policies', 'approvals']) assert.deepEqual(plain(f.state[key]), before[key]);
  const stored = f.state.relations.find(r => r.id === row.id); assert.notEqual(stored.updatedAt.toISOString(), before.relations[1].updatedAt);
  const writes = f.counts.writes; await f.as('admin', () => f.members.changeMember(context('admin'), 'company', row.id, input)); assert.equal(f.counts.writes, writes);
});

test('member period validation rejects invalid calendar/type/status or end before original start before any relationship/receipt write', async () => {
  for (const status of ['active', 'suspended']) for (const invalid of ['not-a-date', '2026-02-30T12:00:00.000Z', '2026-10-01T12:00:00.000Z', { value: '2026-11-02' }, 0, false]) {
    const f = fixture(), row = relation('period-r', 'p1'); f.state.relations.push(row); const before = plain(f.state);
    await rejectsStatus(f.as('admin', () => f.members.changeMember(context('admin'), 'company', row.id, change('period-K', 0, { status, effectiveTo: invalid, expectedUpdatedAt: row.updatedAt.toISOString() }))), 400);
    assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, 0);
  }
  const f = fixture(), row = relation('period-r', 'p1'); f.state.relations.push(row); const before = plain(f.state);
  await rejectsStatus(f.as('admin', () => f.members.changeMember(context('admin'), 'company', row.id, change('unknown-status', 0, { status: 'unknown', expectedUpdatedAt: row.updatedAt.toISOString() }))), 400);
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, 0);
});

test('valid member period changes preserve original start and ISO offset support; explicit exit still ends a future-start employee immediately', async () => {
  for (const effectiveTo of ['2026-11-02T00:00:00.000Z', '2026-11-02T08:00:00+08:00', undefined, 'equal-start']) {
    const f = fixture(), row = relation('period-r', 'p1'); f.state.relations.push(row); const before = plain(f.state.profiles);
    const end = effectiveTo === 'equal-start' ? row.effectiveFrom.toISOString() : effectiveTo;
    await f.as('admin', () => f.members.changeMember(context('admin'), 'company', row.id, change('period-K', 0, { status: 'active', effectiveTo: end, expectedUpdatedAt: row.updatedAt.toISOString() })));
    const saved = f.state.relations.find(r => r.id === row.id); assert.equal(saved.effectiveFrom.toISOString(), row.effectiveFrom.toISOString());
    assert.equal(saved.effectiveTo?.toISOString() ?? null, end ? new Date(end).toISOString() : null); assert.deepEqual(plain(f.state.profiles), before);
  }
  const f = fixture(), row = relation('future-r', 'p1'); row.effectiveFrom = new ClockDate(clock + 3600000); f.state.relations.push(row);
  f.state.orders = [{ id: 'original-order', userSubjectCustomerId: 'p1', contractSubjectCustomerId: 'company', payerSubjectCustomerId: 'company' }];
  const before = plain({ profiles: f.state.profiles, orders: f.state.orders, grants: f.state.grants });
  const result = await f.as('p1', () => f.members.changeMember(context('p1'), 'company', row.id, change('future-exit', 0, { status: 'exited', expectedUpdatedAt: row.updatedAt.toISOString() }), true));
  assert.equal(result.status, 'exited'); assert.ok(f.state.relations.find(r => r.id === row.id).effectiveTo < row.effectiveFrom);
  for (const key of ['profiles', 'orders', 'grants']) assert.deepEqual(plain(f.state[key]), before[key]);
});

async function memberExitFixture() {
  const f = fixture(); f.state.relations.push(relation('own-r', 'p1'));
  f.state.orders = [{ id: 'original-order', workspaceId: 'w2', userSubjectCustomerId: 'p1', contractSubjectCustomerId: 'company', payerSubjectCustomerId: 'company', state: 'RENTING' }];
  f.state.approvals = [{ id: 'original-approval', applicantCustomerId: 'p1', corporateCustomerId: 'company', state: 'consumed', orderId: 'original-order' }];
  f.state.refunds = [{ id: 'original-refund', originalPayer: 'p1', orderId: 'original-order', state: 'unknown' }];
  const before = plain({ orders: f.state.orders, approvals: f.state.approvals, refunds: f.state.refunds, profiles: f.state.profiles });
  const input = change('exit-K', 0, { status: 'exited', expectedUpdatedAt: f.state.relations[1].updatedAt.toISOString() });
  const original = await f.as('p1', () => f.members.changeMember(context('p1'), 'company', 'own-r', input, true));
  return { f, input, original, before, read: (corp = 'company', id = 'own-r', key = 'exit-K', customer = 'p1') => f.as(customer, () => f.members.readMemberExit(context(customer), corp, id, key)) };
}

async function memberChangeOriginalFixture() {
  const f = fixture(); f.state.relations.push(relation('changed-r', 'p1'));
  const input = change('member-change-K', 0, { status: 'suspended', expectedUpdatedAt: f.state.relations[1].updatedAt.toISOString(), department: 'Original team', employeeNo: '42' });
  const original = await f.as('admin', () => f.members.changeMember(context('admin'), 'company', 'changed-r', input));
  return { f, original, read: (corporate = 'company', membership = 'changed-r', key = 'member-change-K', actor = 'admin') => f.as(actor, () => f.members.readMemberChange(context(actor), corporate, membership, key)) };
}

test('member-change original receipt survives grant loss and later relation edits; only original three fields are read without a second write', async () => {
  const { f, original, read } = await memberChangeOriginalFixture();
  f.state.tenantEnabled = false; f.state.corporateEnabled = false; f.state.grants = [];
  Object.assign(f.state.relations[1], { status: 'active', role: 'admin', department: 'Later team', updatedAt: new ClockDate(clock + 10000) });
  f.state.receipts[0].result = JSON.stringify({ ...original, privateNote: 'not-rendered' }); const before = plain(f.state), writes = f.counts.writes;
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  assert.equal(original.status, 'suspended'); assert.equal(f.state.relations[1].status, 'active');
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
});

test('member-change reader is receipt-first: no owned key exposes target existence; tenant/actor/action/key and original company/member bind precisely', async () => {
  for (const alter of [r => { r.actorUserId = 'customer:p2'; }, r => { r.target = 'member.exit:changed-r'; }, r => { r.target = 'member.change:other-r'; }, r => { r.tenantId = 't2'; }, r => { r.operationKey = 'other-K'; }]) {
    const { f, read } = await memberChangeOriginalFixture(); alter(f.state.receipts[0]); const before = plain(f.state);
    assert.deepEqual(plain(await read()), { state: 'not_recorded' }); assert.deepEqual(plain(f.state), before);
  }
  const { f, read } = await memberChangeOriginalFixture();
  await rejectsStatus(read('other-company'), 409); assert.deepEqual(plain(await read('company', 'other-r')), { state: 'not_recorded' });
  for (const [corporate, membership] of [['company', 'changed-r'], ['company', 'absent-r'], ['absent-company', 'absent-r']]) assert.deepEqual(plain(await read(corporate, membership, 'absent-K')), { state: 'not_recorded' });
  assert.deepEqual(plain(await read('company', 'changed-r', 'member-change-K', 'p1')), { state: 'not_recorded' });
  await rejectsStatus(f.as('admin', () => f.members.readMemberChange({ ...context('admin'), tenantId: 't2' }, 'company', 'changed-r', 'member-change-K')), 403);
  for (const [corporate, membership, key] of [['', 'changed-r', 'K'], ['company', ' ', 'K'], ['company', 'changed-r', ''], ['x'.repeat(192), 'changed-r', 'K'], ['company', 'x'.repeat(192), 'K'], ['company', 'changed-r', 'x'.repeat(129)]]) await rejectsStatus(read(corporate, membership, key), 400);
});

test('member-change reader rejects corrupt receipt dates/states/objects or missing original relation without leaking data or repairing history', async () => {
  for (const value of ['{private-broken', 'null', '[]', { membershipId: 'other-r', status: 'suspended', updatedAt: '2026-11-01T12:00:00.000Z' }, { membershipId: 'changed-r', status: 'approved', updatedAt: '2026-11-01T12:00:00.000Z' }, { membershipId: 'changed-r', status: 'suspended', updatedAt: '2026-02-30T12:00:00.000Z' }, { membershipId: 'changed-r', status: 'suspended', updatedAt: '2026-11-01T12:00:00Z' }]) {
    const { f, read } = await memberChangeOriginalFixture(); f.state.receipts[0].result = typeof value === 'string' ? value : JSON.stringify(value); const before = plain(f.state), writes = f.counts.writes;
    await rejectsStatus(read(), 409, '保留原引用'); assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  }
  const { f, read } = await memberChangeOriginalFixture(); f.state.relations.pop();
  await rejectsStatus(read(), 409); assert.equal(f.state.receipts.length, 1);
});

test('member-change original reads revalidate the active personal session after SQL; restricted membership reads but revoked credentials do not', async () => {
  const { f, read } = await memberChangeOriginalFixture(); f.state.profiles[0].membership.status = 'suspended';
  assert.equal((await read()).state, 'committed'); f.fault.afterChangeRead = () => { f.state.sessions[0].revokedAt = new ClockDate(); };
  const writes = f.counts.writes; await rejectsStatus(read(), 403); assert.equal(f.counts.writes, writes);
});

test('own exit exact receipt survives company disable and later rejoining; reads do not alter rental/funding sources or grant authority', async () => {
  const { f, original, before, read } = await memberExitFixture(); const writes = f.counts.writes;
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  assert.equal(f.state.relations[1].status, 'exited'); assert.equal(f.state.relations[0].role, 'admin');
  f.state.corporateEnabled = false; f.state.tenantEnabled = false; f.state.grants = [];
  f.state.profiles[1].membership.status = 'suspended';
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  f.state.relations[1].status = 'active'; f.state.relations[1].updatedAt = new ClockDate(clock + 5000);
  f.state.relations[1].effectiveTo = null;
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) }, 'read reports the old command, not today\'s relationship');
  assert.equal(f.state.relations[1].status, 'active'); assert.equal(f.state.grants.length, 0); assert.equal(f.counts.writes, writes);
  for (const key of ['orders', 'approvals', 'refunds']) assert.deepEqual(plain(f.state[key]), before[key]);
  assert.equal(f.state.profiles[1].membership.status, 'suspended', 'read does not restore personal membership');
});

test('own exit reader binds exact tenant/company/member/actor/action/key and does not fill missing receipts from exited state', async () => {
  for (const alter of [r => { r.actorUserId = 'customer:p2'; }, r => { r.target = 'member.change:own-r'; }, r => { r.target = 'member.exit:other-r'; }, r => { r.tenantId = 't2'; }]) {
    const { f, read } = await memberExitFixture(); alter(f.state.receipts[0]); const before = plain(f.state), writes = f.counts.writes;
    assert.deepEqual(plain(await read()), { state: 'not_recorded' }); assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  }
  const { f, read } = await memberExitFixture(); const before = plain(f.state), writes = f.counts.writes;
  assert.deepEqual(plain(await read('company', 'own-r', 'absent-K')), { state: 'not_recorded' });
  await rejectsStatus(read('another-company'), 404); await rejectsStatus(read('company', 'another-r'), 404);
  await rejectsStatus(read('company', 'own-r', 'exit-K', 'p2'), 404);
  const foreign = { ...context('p1'), tenantId: 't2' };
  await rejectsStatus(f.as('p1', () => f.members.readMemberExit(foreign, 'company', 'own-r', 'exit-K')), 403);
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
});

test('own exit reader rejects corrupt or unbound results and projects only the original three fields with fresh identity checks', async () => {
  const corrupt = ['{broken', 'null', '[]', JSON.stringify({ membershipId: 'other-r', status: 'exited', updatedAt: '2026-11-01T12:00:00.000Z' }),
    JSON.stringify({ membershipId: 'own-r', status: 'active', updatedAt: '2026-11-01T12:00:00.000Z' }),
    JSON.stringify({ membershipId: 'own-r', status: 'exited', updatedAt: '2026-02-30T12:00:00.000Z' }),
    JSON.stringify({ membershipId: 'own-r', status: 'exited', updatedAt: '2026-11-01T12:00:00Z' }),
    JSON.stringify({ membershipId: 'own-r', status: 'exited', updatedAt: '2026-11-01T13:00:00.000+01:00' })];
  for (const result of corrupt) { const { f, read } = await memberExitFixture(); f.state.receipts[0].result = result; const before = plain(f.state);
    await rejectsStatus(read(), 409); assert.deepEqual(plain(f.state), before); }
  const { f, original, read } = await memberExitFixture();
  f.state.receipts[0].result = JSON.stringify({ ...original, requestHash: 'private-hash', reason: 'private-reason', token: 'not-a-real-token' });
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  for (const [corporate, member, key] of [['', 'own-r', 'exit-K'], ['company', ' '.repeat(1), 'exit-K'], ['company', 'own-r', ''], ['x'.repeat(192), 'own-r', 'exit-K'], ['company', 'x'.repeat(192), 'exit-K'], ['company', 'own-r', 'x'.repeat(129)]]) await rejectsStatus(read(corporate, member, key), 400);
  f.fault.afterExitRead = () => { f.state.sessions.find(s => s.customerId === 'p1').revokedAt = new ClockDate(); };
  await rejectsStatus(read(), 403);
  delete f.fault.afterExitRead; f.state.sessions.find(s => s.customerId === 'p1').revokedAt = null;
  f.state.profiles[1].mergedIntoCustomerId = 'p2'; await rejectsStatus(read(), 403);
});

test('original self-exit replay rechecks route owner/company before reading its receipt and never performs a second relationship change', async () => {
  const { f, input, original } = await memberExitFixture(); const writes = f.counts.writes;
  f.state.corporateEnabled = false; f.state.grants = [];
  assert.deepEqual(plain(await f.as('p1', () => f.members.changeMember(context('p1'), 'company', 'own-r', input, true))), plain(original));
  await rejectsStatus(f.as('p1', () => f.members.changeMember(context('p1'), 'wrong-company', 'own-r', input, true)), 404);
  await rejectsStatus(f.as('p2', () => f.members.changeMember(context('p2'), 'company', 'own-r', input, true)), 404);
  assert.equal(f.counts.writes, writes); assert.equal(f.state.receipts.length, 1); assert.equal(f.state.relations[1].status, 'exited');
  const before = plain(f.state);
  await rejectsStatus(f.as('p1', () => f.members.changeMember(context('p1'), 'company', 'own-r', { ...input, reason: 'Different request' }, true)), 409);
  assert.deepEqual(plain(f.state), before);
});

async function transferClosureFixture() {
  const f = fixture(); f.state.relations.push(relation('target-r', 'p1'));
  f.pending = await f.as('admin', () => f.members.transfer(context('admin'), 'company', change('transfer-create', 0, { targetMembershipId: 'target-r' })));
  f.originalInput = change('decision-K', 1, { accept: true }); f.closeInput = change('refusal-C', 1, { confirm: true });
  return f;
}

test('initiator exact receipt reads the original pending result after real accept/decline and grant loss; it never writes or regrants', async () => {
  for (const accept of [true, false]) {
    const f = await transferClosureFixture();
    await f.as('p1', () => f.members.acceptTransfer(context('p1'), f.pending.id, { ...f.originalInput, accept }));
    f.state.tenantEnabled = false; f.state.corporateEnabled = false; f.state.grants = [];
    const before = plain(f.state), writes = f.counts.writes;
    const read = () => f.as('admin', () => f.members.readTransferInitiation(context('admin'), 'company', 'transfer-create'));
    assert.deepEqual(plain(await read()), { state: 'committed', result: { id: f.pending.id, state: 'pending', revision: 1 } });
    assert.deepEqual(plain(await read()), { state: 'committed', result: plain(f.pending) });
    assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
    assert.equal(f.state.workflows[0].state, accept ? 'approved' : 'rejected');
  }
});

test('initiation reader binds original tenant/actor/action/company/key and never discovers a request when the original receipt is missing', async () => {
  for (const alter of [r => { r.actorUserId = 'customer:p2'; }, r => { r.target = 'administrator.accept:company'; }, r => { r.target = 'administrator.transfer:other'; }, r => { r.tenantId = 't2'; }, r => { r.operationKey = 'other-key'; }]) {
    const f = await transferClosureFixture(); alter(f.state.receipts[0]); const before = plain(f.state), writes = f.counts.writes;
    assert.deepEqual(plain(await f.as('admin', () => f.members.readTransferInitiation(context('admin'), 'company', 'transfer-create'))), { state: 'not_recorded' });
    assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  }
  const f = await transferClosureFixture();
  for (const [corporate, key] of [['other', 'transfer-create'], ['company', 'absent']]) assert.deepEqual(plain(await f.as('admin', () => f.members.readTransferInitiation(context('admin'), corporate, key))), { state: 'not_recorded' });
  assert.deepEqual(plain(await f.as('p1', () => f.members.readTransferInitiation(context('p1'), 'company', 'transfer-create'))), { state: 'not_recorded' }, 'recipient is not the initiator');
  await rejectsStatus(f.as('admin', () => f.members.readTransferInitiation({ ...context('admin'), tenantId: 't2' }, 'company', 'transfer-create')), 403);
  for (const [corporate, key] of [['', 'k'], ['company', ' '], ['x'.repeat(192), 'k'], ['company', 'x'.repeat(129)]]) await rejectsStatus(f.as('admin', () => f.members.readTransferInitiation(context('admin'), corporate, key)), 400);
});

test('initiation reader refuses corrupt receipts or unbound workflow originals and never leaks or repairs legacy authority material', async () => {
  for (const result of ['{private-broken', 'null', '[]', JSON.stringify({ id: 'missing', state: 'pending', revision: 1 }), JSON.stringify({ id: 'ID', state: 'approved', revision: 2 }), JSON.stringify({ id: 'ID', state: 'pending', revision: '1' })]) {
    const f = await transferClosureFixture(); f.state.receipts[0].result = result.replace('ID', f.pending.id);
    await rejectsStatus(f.as('admin', () => f.members.readTransferInitiation(context('admin'), 'company', 'transfer-create')), 409, '保留原引用');
  }
  for (const alter of [w => { w.kind = 'join_request'; }, w => { w.corporateCustomerId = 'other'; }, w => { w.tenantId = 't2'; }, w => { w.applicantCustomerId = 'admin'; }, w => { w.payload = '{private-broken'; }, w => { w.payload = JSON.stringify({ fromCustomerId: 'p2', targetMembershipId: 'target-r' }); }, w => { w.payload = JSON.stringify({ fromCustomerId: 'admin', targetMembershipId: '' }); }]) {
    const f = await transferClosureFixture(); alter(f.state.workflows[0]); const before = plain(f.state), writes = f.counts.writes;
    await rejectsStatus(f.as('admin', () => f.members.readTransferInitiation(context('admin'), 'company', 'transfer-create')), 409);
    assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  }
  const f = await transferClosureFixture(); f.state.workflows[0].payload = JSON.stringify({ fromCustomerId: 'admin', targetMembershipId: 'target-r', privateNote: 'not-rendered' });
  f.state.receipts[0].result = JSON.stringify({ ...f.pending, privateNote: 'not-rendered' }); const before = plain(f.state);
  assert.deepEqual(plain(await f.as('admin', () => f.members.readTransferInitiation(context('admin'), 'company', 'transfer-create'))), { state: 'committed', result: plain(f.pending) });
  assert.deepEqual(plain(f.state), before, 'legacy request reads never manufacture basis or grant authority');
});

test('initiation result revalidates the current personal session after reading; suspended membership may read but revoked credentials may not', async () => {
  const f = await transferClosureFixture(); f.state.profiles[0].membership.status = 'suspended';
  assert.equal((await f.as('admin', () => f.members.readTransferInitiation(context('admin'), 'company', 'transfer-create'))).state, 'committed');
  f.fault.afterInitiationRead = () => { f.state.sessions.find(s => s.customerId === 'admin').revokedAt = new ClockDate(); };
  const writes = f.counts.writes; await rejectsStatus(f.as('admin', () => f.members.readTransferInitiation(context('admin'), 'company', 'transfer-create')), 403);
  assert.equal(f.counts.writes, writes); assert.equal(f.state.workflows.length, 1);
});

test('explicit transfer refusal commits rejected workflow, permanent K and independent C together; late acceptance cannot grant', async () => {
  const f = await transferClosureFixture(), before = plain({ relations: f.state.relations, grants: f.state.grants });
  const resolution = plain(await f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput)));
  assert.equal(resolution.outcome, 'closed'); assert.equal(resolution.decision.state, 'rejected'); assert.equal(resolution.originalOperationKey, 'decision-K'); assert.equal(resolution.closureOperationKey, 'refusal-C');
  assert.ok(transferDecisionModule.enterpriseTransferDecisionResolutionMatches(resolution, { tenantId: 't1', transferId: f.pending.id, applicantCustomerId: 'p1', originalOperationKey: 'decision-K', closureOperationKey: 'refusal-C' }));
  for (const key of ['decision-K', 'refusal-C']) assert.deepEqual(JSON.parse(f.state.receipts.find(r => r.operationKey === key).result), resolution);
  assert.deepEqual(plain({ relations: f.state.relations, grants: f.state.grants }), before);
  assert.deepEqual(plain(await f.as('p1', () => f.members.readTransferDecision(context('p1'), f.pending.id, 'decision-K'))), { state: 'committed', result: resolution });
  const writes = f.counts.writes;
  await rejectsStatus(f.as('p1', () => f.members.acceptTransfer(context('p1'), f.pending.id, f.originalInput)), 409);
  // Even an independently stale pending view cannot defeat the permanent original key.
  Object.assign(f.state.workflows.find(w => w.id === f.pending.id), { state: 'pending', revision: 1 });
  await rejectsStatus(f.as('p1', () => f.members.acceptTransfer(context('p1'), f.pending.id, f.originalInput)), 409);
  assert.equal(f.counts.writes, writes); assert.deepEqual(plain({ relations: f.state.relations, grants: f.state.grants }), before);
});

test('transfer acceptance or ordinary decline winning first is only observed by C, never undone, resealed or regranted', async () => {
  for (const accept of [true, false]) {
    const f = await transferClosureFixture(); f.originalInput.accept = accept;
    const original = plain(await f.as('p1', () => f.members.acceptTransfer(context('p1'), f.pending.id, f.originalInput)));
    const before = plain({ relations: f.state.relations, grants: f.state.grants, workflows: f.state.workflows }), k = f.state.receipts.find(r => r.operationKey === 'decision-K').result;
    const result = plain(await f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput)));
    assert.equal(result.outcome, 'observed'); assert.deepEqual(result.decision, original); assert.equal(f.state.receipts.find(r => r.operationKey === 'decision-K').result, k);
    assert.deepEqual(plain({ relations: f.state.relations, grants: f.state.grants, workflows: f.state.workflows }), before);
    assert.deepEqual(plain(await f.as('p1', () => f.members.readTransferDecision(context('p1'), f.pending.id, 'decision-K'))), { state: 'committed', result: original });
  }
});

test('transfer K/C refusal retains foreign, contradictory, missing-terminal and invalid-revision evidence without manufacturing seals', async () => {
  for (const original of [
    { actorUserId: 'customer:p2', target: 'administrator.accept:ID' }, { actorUserId: 'customer:p1', target: 'join:ID' },
    { actorUserId: 'customer:p1', target: 'administrator.accept:OTHER' }, { actorUserId: 'customer:p1', target: 'administrator.accept:ID', result: 'not-json' },
  ]) {
    const f = await transferClosureFixture(); f.state.receipts.push({ tenantId: 't1', operationKey: 'decision-K', requestHash: 'legacy', result: JSON.stringify({ id: f.pending.id, state: 'approved', revision: 2 }), ...original, target: original.target.replace('ID', f.pending.id) });
    const before = plain(f.state); await rejectsStatus(f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput)), 409); assert.deepEqual(plain(f.state), before);
  }
  for (const state of ['approved', 'rejected', 'withdrawn']) {
    const f = await transferClosureFixture(); f.state.workflows.find(w => w.id === f.pending.id).state = state;
    const before = plain(f.state); await rejectsStatus(f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput)), 409); assert.deepEqual(plain(f.state), before);
  }
  const f = await transferClosureFixture(), before = plain(f.state);
  await rejectsStatus(f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', { ...f.closeInput, expectedRevision: 2 })), 409);
  for (const input of [{ ...f.closeInput, confirm: false }, { ...f.closeInput, operationKey: 'decision-K' }]) await rejectsStatus(f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', input)), 400);
  await rejectsStatus(f.as('p2', () => f.members.closeTransferDecision(context('p2'), f.pending.id, 'decision-K', f.closeInput)), 404); assert.deepEqual(plain(f.state), before);
});

test('transfer refusal rollback at CAS, original seal or C receipt keeps the original pending workflow and authority intact', async () => {
  for (const failure of ['cas', 'K', 'C']) {
    const f = await transferClosureFixture(), before = plain(f.state);
    if (failure === 'cas') f.fault.workflowCAS = true; else f.fault.operationKey = failure === 'K' ? 'decision-K' : 'refusal-C';
    await assert.rejects(f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput)));
    assert.deepEqual(plain(f.state), before); assert.ok(f.counts.rollbacks > 0);
  }
});

test('same Tenant transfer acceptance/refusal competitors serialize once; original C replay reads the same result and cannot bind another K', async () => {
  for (const first of ['accept', 'refuse']) {
    const f = await transferClosureFixture(), second = new EnterpriseMembersService(f.db, f.commands, new EnterpriseAccessService(f.db), new SharedCustomerRepository(f.db));
    const accept = () => f.as('p1', () => f.members.acceptTransfer(context('p1'), f.pending.id, f.originalInput));
    const close = () => f.as('p1', () => second.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput));
    const results = await Promise.allSettled(first === 'accept' ? [accept(), close()] : [close(), accept()]);
    assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, first === 'accept' ? 'fulfilled' : 'rejected');
    const before = plain(f.state), replay = await close(); assert.deepEqual(plain(replay), plain(results[first === 'accept' ? 1 : 0].value)); assert.deepEqual(plain(f.state), before);
    await rejectsStatus(f.as('p1', () => second.closeTransferDecision(context('p1'), f.pending.id, 'another-K', f.closeInput)), 409); assert.deepEqual(plain(f.state), before);
  }
});

test('permanent transfer seal tolerates JSON ordering but never corrupt bindings/hash or missing C history', async () => {
  const f = await transferClosureFixture(); await f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput));
  const k = f.state.receipts.find(r => r.operationKey === 'decision-K'), baseline = JSON.parse(k.result);
  k.result = JSON.stringify(Object.fromEntries(Object.entries({ ...baseline, decision: Object.fromEntries(Object.entries(baseline.decision).reverse()) }).reverse()));
  assert.equal((await f.as('p1', () => f.members.readTransferDecision(context('p1'), f.pending.id, 'decision-K'))).state, 'committed');
  for (const update of [{ tenantId: 'other' }, { applicantCustomerId: 'p2' }, { corporateCustomerId: 'other' }, { transferId: 'other' }, { originalOperationKey: 'other' }, { closureOperationKey: 'other' }, { outcome: 'observed' }, { version: 2 }, { retryable: true }]) {
    k.result = JSON.stringify({ ...baseline, ...update }); await rejectsStatus(f.as('p1', () => f.members.readTransferDecision(context('p1'), f.pending.id, 'decision-K')), 409);
  }
  k.result = JSON.stringify(baseline); const hash = k.requestHash; k.requestHash = 'corrupt'; await rejectsStatus(f.as('p1', () => f.members.readTransferDecision(context('p1'), f.pending.id, 'decision-K')), 409); k.requestHash = hash;
  const c = f.state.receipts.find(r => r.operationKey === 'refusal-C'), originalC = c.result;
  c.result = JSON.stringify({ ...JSON.parse(originalC), corporateCustomerId: 'foreign' }); const corrupt = plain(f.state);
  await rejectsStatus(f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput)), 409); assert.deepEqual(plain(f.state), corrupt); c.result = originalC;
  const all = structuredClone(f.state.receipts); f.state.receipts = f.state.receipts.filter(r => r.operationKey !== 'decision-K'); const missingK = plain(f.state);
  await rejectsStatus(f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput)), 409); assert.deepEqual(plain(f.state), missingK);
  f.state.receipts = all.filter(r => r.operationKey !== 'refusal-C'); const before = plain(f.state);
  await rejectsStatus(f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput)), 409); assert.deepEqual(plain(f.state), before);
});

test('transfer refusal DTO retains real inherited validators and requires boolean true; public K/C matches only exact original bindings', async () => {
  require('reflect-metadata'); const validator = require('class-validator'), transformer = require('class-transformer');
  const base = load('apps/api/src/modules/enterprise/enterprise-request.dto.ts', { 'class-validator': validator, 'class-transformer': transformer, '@rental-os/shared': { ...require('../packages/shared/dist'), ...load('packages/shared/src/enterprise.ts') } });
  const { CloseEnterpriseTransferDecisionDto } = load('apps/api/src/modules/enterprise/enterprise-transfer-decision.dto.ts', { 'class-validator': validator, './enterprise-request.dto': base });
  const input = change('C', 1, { confirm: true }); assert.equal(validator.validateSync(Object.assign(new CloseEnterpriseTransferDecisionDto(), input)).length, 0);
  for (const update of [{ confirm: false }, { confirm: 'true' }, { confirm: 1 }, { expectedRevision: -1 }, { operationKey: '' }, { reason: '' }]) assert.ok(validator.validateSync(Object.assign(new CloseEnterpriseTransferDecisionDto(), input, update)).length > 0);
  const f = await transferClosureFixture(), value = plain(await f.as('p1', () => f.members.closeTransferDecision(context('p1'), f.pending.id, 'decision-K', f.closeInput)));
  const binding = { tenantId: 't1', transferId: f.pending.id, applicantCustomerId: 'p1', originalOperationKey: 'decision-K', closureOperationKey: 'refusal-C' };
  assert.equal(transferDecisionModule.enterpriseTransferDecisionResolutionMatches(value, binding), true);
  for (const key of Object.keys(binding)) assert.equal(transferDecisionModule.enterpriseTransferDecisionResolutionMatches(value, { ...binding, [key]: 'foreign' }), false);
  const legacyModule = load('apps/api/src/modules/enterprise/enterprise-members.service.ts', { './enterprise-command.service': commandModule, './enterprise-administrator-continuity': continuityModule, '@rental-os/shared': load('packages/shared/src/enterprise.ts') });
  const legacy = new legacyModule.EnterpriseMembersService(f.db, f.commands, new EnterpriseAccessService(f.db), new SharedCustomerRepository(f.db)), before = plain(f.state), writes = f.counts.writes;
  await rejectsStatus(f.as('p1', () => legacy.closeTransferDecision(context('p1'), f.pending.id, 'another-K', change('another-C', 1, { confirm: true }))), 503);
  await rejectsStatus(f.as('p1', () => legacy.readTransferDecision(context('p1'), f.pending.id, 'decision-K')), 503);
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes, 'missing runtime export never writes a refusal or fabricates a seal');
});

test('transfer decision reader projects only the exact recipient/id/key receipt after later portal revocation, without regranting', async () => {
  const f = fixture(); f.state.relations.push(relation('target-r', 'p1'));
  const pending = await f.as('admin', () => f.members.transfer(context('admin'), 'company', change('transfer-original', 0, { targetMembershipId: 'target-r' })));
  const decided = plain(await f.as('p1', () => f.members.acceptTransfer(context('p1'), pending.id, change('accept-original', 1, { accept: true }))));
  const receipt = f.state.receipts.find(r => r.operationKey === 'accept-original'); receipt.result = JSON.stringify({ ...decided, privateToken: 'do-not-project', currentGrant: 'do-not-project' });
  f.state.grants = []; f.state.tenantEnabled = f.state.corporateEnabled = false;
  const before = plain(f.state), writes = f.counts.writes;
  for (let i = 0; i < 2; i++) assert.deepEqual(plain(await f.as('p1', () => f.members.readTransferDecision(context('p1'), pending.id, 'accept-original'))), { state: 'committed', result: decided });
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
});

test('transfer reader never attributes missing or foreign receipts to a terminal workflow and rejects contradictory or malformed proof', async () => {
  const f = fixture(), row = request('legacy-transfer', 'administrator_transfer', 'p1', {}); row.payload = JSON.stringify('legacy-scalar'); f.state.workflows.push(row);
  const decided = plain(await f.as('p1', () => f.members.acceptTransfer(context('p1'), row.id, change('decline-original', 1, { accept: false }))));
  assert.deepEqual(plain(await f.as('p1', () => f.members.readTransferDecision(context('p1'), row.id, 'decline-original'))), { state: 'committed', result: decided });
  const baseline = plain(f.state.receipts[0]);
  for (const update of [{ tenantId: 'other-tenant' }, { actorUserId: 'customer:p2' }, { target: 'administrator.transfer:company' }, { target: 'administrator.accept:other-id' }]) {
    Object.assign(f.state.receipts[0], baseline, update);
    assert.deepEqual(plain(await f.as('p1', () => f.members.readTransferDecision(context('p1'), row.id, 'decline-original'))), { state: 'not_recorded' });
  }
  Object.assign(f.state.receipts[0], baseline);
  const writes = f.counts.writes;
  for (const result of [null, [], 'not-json', { id: 'other-id', state: 'rejected', revision: 2 }, { id: row.id, state: 'approved', revision: 2 }, { id: row.id, state: 'rejected', revision: '2' }, { id: row.id, state: 'rejected', revision: 1 }]) {
    f.state.receipts[0].result = typeof result === 'string' ? result : JSON.stringify(result);
    await rejectsStatus(f.as('p1', () => f.members.readTransferDecision(context('p1'), row.id, 'decline-original')), 409);
  }
  f.state.receipts[0].result = baseline.result; row.state = 'pending';
  await rejectsStatus(f.as('p1', () => f.members.readTransferDecision(context('p1'), row.id, 'decline-original')), 409);
  row.state = 'rejected'; f.state.receipts.length = 0;
  assert.deepEqual(plain(await f.as('p1', () => f.members.readTransferDecision(context('p1'), row.id, 'decline-original'))), { state: 'not_recorded' }); assert.equal(f.counts.writes, writes);
});

test('transfer reader preserves current personal Auth/ALS and workflow ownership without broad enterprise-management reads', async () => {
  const f = fixture(), row = request('owned-transfer', 'administrator_transfer', 'p1', {}); f.state.workflows.push(row);
  for (const actor of ['admin', 'p2']) await rejectsStatus(f.as(actor, () => f.members.readTransferDecision(context(actor), row.id, 'unknown-original')), 404);
  row.kind = 'join_request'; await rejectsStatus(f.as('p1', () => f.members.readTransferDecision(context('p1'), row.id, 'unknown-original')), 404); row.kind = 'administrator_transfer';
  await rejectsStatus(f.as('p2', () => f.members.readTransferDecision(context('p1'), row.id, 'unknown-original')), 403);
  for (const update of [{ tenantId: 'foreign' }, { customerType: 'corporate' }]) await rejectsStatus(f.as('p1', () => f.members.readTransferDecision({ ...context('p1'), ...update }, row.id, 'unknown-original')), 403);
  f.state.sessions.find(s => s.customerId === 'p1').revokedAt = new ClockDate(); await rejectsStatus(f.as('p1', () => f.members.readTransferDecision(context('p1'), row.id, 'unknown-original')), 403);
  f.state.sessions.find(s => s.customerId === 'p1').revokedAt = null; f.state.profiles.find(p => p.id === 'p1').mergedIntoCustomerId = 'p2';
  await rejectsStatus(f.as('p1', () => f.members.readTransferDecision(context('p1'), row.id, 'unknown-original')), 403);
  f.state.profiles.find(p => p.id === 'p1').mergedIntoCustomerId = null;
  for (const [id, key] of [['', 'k'], ['x'.repeat(192), 'k'], [row.id, ''], [row.id, 'k'.repeat(129)]]) await rejectsStatus(f.as('p1', () => f.members.readTransferDecision(context('p1'), id, key)), 400);
  assert.equal(f.counts.writes, 0);
});

async function administratorChangeOriginalFixture(role = 'admin', actions = role === 'admin' ? ['portal:enter', 'members:manage'] : []) {
  const f = fixture(); f.state.relations.push(relation('target-r', 'p1'));
  const input = change('administrator-K', 1, { role, actions, expectedUpdatedAt: f.state.relations[1].updatedAt.toISOString() });
  const original = await f.as('admin', () => f.members.changeAdministrator(context('admin'), 'company', 'target-r', input));
  return { f, original, read: (corporate = 'company', membership = 'target-r', key = 'administrator-K', actor = 'admin') => f.as(actor, () => f.members.readAdministratorChange(context(actor), corporate, membership, key)) };
}

test('original administrator roles/actions/revision survive today grant loss and relation changes; reads project history only without regranting', async () => {
  for (const [role, actions] of [['admin', ['portal:enter', 'members:manage']], ['admin', []], ['employee', []]]) {
    const { f, original, read } = await administratorChangeOriginalFixture(role, actions);
    f.state.grants = []; f.state.tenantEnabled = false; f.state.corporateEnabled = false;
    Object.assign(f.state.relations[1], { role: 'employee', status: 'exited', updatedAt: new ClockDate(clock + 10000) }); f.state.corporateRevision += 10;
    f.state.receipts[0].result = JSON.stringify({ ...original, privateNote: 'not-rendered' }); const before = plain(f.state), writes = f.counts.writes;
    assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
    assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
    assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes); assert.deepEqual(f.state.grants, []);
  }
});

test('administrator receipt-first reader binds tenant/actor/action/company/member/K and never exposes target existence without an owned original', async () => {
  for (const alter of [r => { r.actorUserId = 'customer:p2'; }, r => { r.target = 'member.change:target-r'; }, r => { r.target = 'administrator.change:other-r'; }, r => { r.tenantId = 't2'; }, r => { r.operationKey = 'other-K'; }]) {
    const { f, read } = await administratorChangeOriginalFixture(); alter(f.state.receipts[0]); const before = plain(f.state);
    assert.deepEqual(plain(await read()), { state: 'not_recorded' }); assert.deepEqual(plain(f.state), before);
  }
  const { f, read } = await administratorChangeOriginalFixture(); await rejectsStatus(read('other-company'), 409);
  for (const [corporate, membership] of [['company', 'target-r'], ['company', 'absent-r'], ['absent-company', 'absent-r']]) assert.deepEqual(plain(await read(corporate, membership, 'missing-K')), { state: 'not_recorded' });
  assert.deepEqual(plain(await read('company', 'target-r', 'administrator-K', 'p1')), { state: 'not_recorded' });
  await rejectsStatus(f.as('admin', () => f.members.readAdministratorChange({ ...context('admin'), tenantId: 't2' }, 'company', 'target-r', 'administrator-K')), 403);
  for (const [corporate, membership, key] of [['', 'target-r', 'K'], ['company', ' ', 'K'], ['company', 'target-r', ''], ['x'.repeat(192), 'target-r', 'K'], ['company', 'x'.repeat(192), 'K'], ['company', 'target-r', 'x'.repeat(129)]]) await rejectsStatus(read(corporate, membership, key), 400);
});

test('original administrator reader rejects malformed role/actions/revision/calendar or missing relation without repairing or leaking original material', async () => {
  const bad = [null, [], { role: ['admin'] }, { role: 'owner' }, { actions: 'portal:enter' }, { actions: ['portal:enter', 'portal:enter'] }, { actions: ['portal:enter', 'unknown:grant'] }, { actions: ['members:read'] }, { role: 'employee', actions: ['portal:enter'] }, { revision: 0 }, { revision: 1.5 }, { revision: '2' }, { updatedAt: '2026-02-30T12:00:00.000Z' }, { updatedAt: '2026-11-01T12:00:00Z' }, { membershipId: 'other-r' }];
  for (const change of bad) {
    const { f, original, read } = await administratorChangeOriginalFixture(); f.state.receipts[0].result = JSON.stringify(change === null || Array.isArray(change) ? change : { ...original, ...change });
    const before = plain(f.state), writes = f.counts.writes; await rejectsStatus(read(), 409, '保留原引用'); assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  }
  const { f, read } = await administratorChangeOriginalFixture(); f.state.receipts[0].result = '{private-broken'; await rejectsStatus(read(), 409, '保留原引用');
  f.state.relations.pop(); await rejectsStatus(read(), 409); assert.equal(f.state.receipts.length, 1);
});

test('administrator original read rechecks current personal session after SQL; restrictive membership does not revive grants and revoked credentials fail', async () => {
  const { f, read } = await administratorChangeOriginalFixture(); f.state.profiles[0].membership.status = 'suspended';
  assert.equal((await read()).state, 'committed'); const before = plain(f.state.grants);
  f.fault.afterAdministratorRead = () => { f.state.sessions[0].revokedAt = new ClockDate(); };
  const writes = f.counts.writes; await rejectsStatus(read(), 403); assert.equal(f.counts.writes, writes); assert.deepEqual(plain(f.state.grants), before);
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
  const last = change('last-revoke', f.state.corporateRevision, { role: 'employee', actions: [], expectedUpdatedAt: f.state.relations[0].updatedAt.toISOString() });
  await rejectsStatus(f.as('admin', () => f.members.changeAdministrator(context('admin'), 'company', 'admin-r', last)), 409, '最后受权管理员');
  f.fault.sql = 'INSERT INTO enterprise_portal_grants';
  const before = plain(f.state.relations[1]);
  await assert.rejects(f.as('admin', () => f.members.changeAdministrator(context('admin'), 'company', 'target-r', change('failed-grant', f.state.corporateRevision, {
    role: 'admin', actions: ['portal:enter', 'administrators:manage'], expectedUpdatedAt: f.state.relations[1].updatedAt.toISOString() }))), /Injected/);
  assert.deepEqual(plain(f.state.relations[1]), before);
  assert.equal(f.state.receipts.some(r => r.operationKey === 'failed-grant'), false);
});

test('last admin future expiry/exit fail; accepted transfer proves current target and grants, with rollback', async () => {
  const f = fixture(), original = structuredClone(f.state.relations[0]);
  for (const extra of [{ status: 'exited' }, { status: 'active', effectiveTo: new ClockDate(clock + 3600000).toISOString() }]) await rejectsStatus(f.as('admin', () => f.members.changeMember(context('admin'), 'company', 'admin-r', change(`change-${extra.status}`, 0, { expectedUpdatedAt: original.updatedAt.toISOString(), ...extra }), extra.status === 'exited')), 409, '最后受权管理员');
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

test('administrator handoff records trusted original relationships, actions and permission revision, never caller-supplied authority', async () => {
  const f = fixture(); f.state.relations.push(relation('target-r', 'p1'));
  const original = plain(f.state.relations), result = await f.as('admin', () => f.members.transfer(context('admin'), 'company', change('basis-transfer', 0, {
    targetMembershipId: 'target-r', authorityBasis: { version: 1, actions: ['finance:read'], fromMembershipId: 'forged' },
  })));
  const payload = JSON.parse(f.state.workflows.find(w => w.id === result.id).payload), basis = payload.authorityBasis;
  assert.equal(basis.version, 1); assert.equal(basis.fromMembershipId, 'admin-r'); assert.equal(basis.fromUpdatedAt, original[0].updatedAt);
  assert.equal(basis.targetUpdatedAt, original[1].updatedAt); assert.equal(basis.permissionRevision, '1:1');
  const actions = load('packages/shared/src/enterprise.ts').ENTERPRISE_PORTAL_ACTIONS.filter(a => f.state.grants.some(g => g.membershipId === 'admin-r' && g.action === a));
  assert.deepEqual(basis.actions, plain(actions)); assert.equal(basis.actions.includes('finance:read'), false);
  const own = await f.as('p1', () => f.members.joinRequests(context('p1'))); assert.deepEqual(plain(own[0].payload.authorityBasis), basis);
  assert.deepEqual(plain(f.state.relations), original, 'requesting does not promote or demote');
});

test('handoff rejects changed original relationship, identity, portal revision or grant actions before any promotion', async () => {
  const cases = [
    ['outgoing revision', f => { f.state.relations[0].updatedAt = new ClockDate(clock); }],
    ['target revision', f => { f.state.relations[1].updatedAt = new ClockDate(clock); }],
    ['outgoing identity', f => { f.state.relations[0].personalCustomerId = 'p2'; }],
    ['target identity', f => { f.state.relations[1].personalCustomerId = 'p2'; }],
    ['tenant permission revision', f => { f.state.tenantRevision++; }],
    ['corporate permission revision', f => { f.state.corporateRevision++; }],
    ['new registered action', f => { f.state.grants.push({ ...f.state.grants[0], action: 'policy:manage' }); }],
    ['narrowed registered action', f => { f.state.grants = f.state.grants.filter(g => g.action !== 'members:read'); }],
    ['unknown action', f => { f.state.grants.push({ ...f.state.grants[0], action: 'unregistered-action' }); }],
  ];
  for (const [label, alter] of cases) {
    const f = fixture(); f.state.relations.push(relation('target-r', 'p1'));
    const request = await f.as('admin', () => f.members.transfer(context('admin'), 'company', change('transfer', 0, { targetMembershipId: 'target-r' })));
    alter(f); const before = plain(f.state), writes = f.counts.writes;
    await assert.rejects(f.as('p1', () => f.members.acceptTransfer(context('p1'), request.id, change('accept', 1, { accept: true }))), e => e.getStatus?.() === 409 && e.body.code === 'enterprise_revision_conflict');
    assert.deepEqual(plain(f.state), before, label); assert.equal(f.counts.writes, writes, `${label}: no grant, role or receipt write`);
  }
});

test('freeze/restore or explicit reauthorization cannot resurrect an old pending handoff', async () => {
  for (const side of [0, 1]) {
    const f = fixture(); f.state.relations.push(relation('target-r', 'p1'));
    const request = await f.as('admin', () => f.members.transfer(context('admin'), 'company', change('transfer', 0, { targetMembershipId: 'target-r' })));
    // Model the already-implemented status writer's monotonic revision invalidation,
    // followed by an independent explicit restoration/authorization, not a new transfer.
    const changed = f.state.relations[side]; changed.status = 'suspended'; changed.updatedAt = new ClockDate(clock); changed.status = 'active';
    for (const grant of f.state.grants.filter(g => g.membershipId === changed.id)) grant.membershipUpdatedAt = changed.updatedAt;
    await new EnterpriseAccessService(f.db).requireAction(context('admin'), 'company', 'administrators:manage');
    const before = plain(f.state);
    await rejectsStatus(f.as('p1', () => f.members.acceptTransfer(context('p1'), request.id, change('accept', 1, { accept: true }))), 409, '关系修订');
    assert.deepEqual(plain(f.state), before);
  }
});

test('legacy or malformed handoff basis is never reconstructed for acceptance; the original owner can still explicitly decline', async () => {
  const corruptions = [
    payload => { delete payload.authorityBasis; },
    payload => { payload.authorityBasis = null; },
    payload => { payload.authorityBasis.version = 2; },
    payload => { payload.authorityBasis.fromUpdatedAt = 'unknown'; },
    payload => { payload.authorityBasis.actions = ['portal:enter']; },
    payload => { payload.authorityBasis.actions.push(payload.authorityBasis.actions[0]); },
    payload => { payload.authorityBasis.actions.push('unregistered-action'); },
  ];
  for (const corrupt of corruptions) {
    const f = fixture(); f.state.relations.push(relation('target-r', 'p1'));
    const request = await f.as('admin', () => f.members.transfer(context('admin'), 'company', change('transfer', 0, { targetMembershipId: 'target-r' })));
    const row = f.state.workflows.find(w => w.id === request.id), payload = JSON.parse(row.payload); corrupt(payload); row.payload = JSON.stringify(payload);
    const before = plain(f.state); await assert.rejects(f.as('p1', () => f.members.acceptTransfer(context('p1'), request.id, change('old-accept', 1, { accept: true }))), e => e.getStatus?.() === 409 && e.body.code === 'enterprise_revision_conflict' && e.message.includes('依据缺失'));
    assert.deepEqual(plain(f.state), before);
    await rejectsStatus(f.as('p2', () => f.members.acceptTransfer(context('p2'), request.id, change('foreign-decline', 1, { accept: false }))), 404);
    const declined = await f.as('p1', () => f.members.acceptTransfer(context('p1'), request.id, change('decline', 1, { accept: false })));
    assert.equal(declined.state, 'rejected'); assert.deepEqual(plain(f.state.relations), before.relations); assert.deepEqual(plain(f.state.grants), before.grants);
  }
  const broken = fixture(); broken.state.workflows.push(request('legacy-transfer', 'administrator_transfer', 'p1', {})); broken.state.workflows[0].payload = 'not-json';
  await assert.rejects(broken.as('p1', () => broken.members.acceptTransfer(context('p1'), 'legacy-transfer', change('accept-broken', 1, { accept: true }))), e => e.getStatus?.() === 409 && e.body.code === 'enterprise_revision_conflict');
  assert.equal((await broken.as('p1', () => broken.members.acceptTransfer(context('p1'), 'legacy-transfer', change('decline-broken', 1, { accept: false })))).state, 'rejected');
  await rejectsStatus(broken.as('p1', () => broken.members.acceptTransfer(context('p1'), 'legacy-transfer', change('implicit-decline', 1, {}))), 400);
});

test('equivalent grant order is accepted once; lost first response and reentry read only the original handoff receipt', async () => {
  const f = fixture(); f.state.relations.push(relation('target-r', 'p1')); f.state.originalOrders = [{ id: 'order', user: 'admin', payer: 'company' }];
  const request = await f.as('admin', () => f.members.transfer(context('admin'), 'company', change('transfer', 0, { targetMembershipId: 'target-r' })));
  f.state.grants.reverse(); const originalOrders = plain(f.state.originalOrders), accept = change('exact-accept', 1, { accept: true });
  const second = new EnterpriseMembersService(f.db, f.commands, new EnterpriseAccessService(f.db), f.customers);
  const results = await Promise.all([f.as('p1', () => f.members.acceptTransfer(context('p1'), request.id, accept)), f.as('p1', () => second.acceptTransfer(context('p1'), request.id, accept))]);
  assert.deepEqual(plain(results[0]), plain(results[1])); assert.equal(results[0].state, 'approved');
  assert.equal(f.state.relations[0].role, 'employee'); assert.equal(f.state.relations[1].role, 'admin');
  assert.deepEqual(plain(f.state.originalOrders), originalOrders);
  const after = plain(f.state), writes = f.counts.writes;
  assert.deepEqual(plain(await f.as('p1', () => second.acceptTransfer(context('p1'), request.id, accept))), plain(results[0]));
  await rejectsStatus(f.as('p1', () => f.members.acceptTransfer(context('p1'), request.id, { ...accept, accept: false })), 409);
  assert.deepEqual(plain(f.state), after); assert.equal(f.counts.writes, writes, 'no second promotion or authority rebind');
});

test('merchant claim material smoke: request-bound masked current identity and protected administrators share the final transaction guard; city never supplies jurisdiction', async () => {
  const f = fixture(), reviewer = { ...user, permissions: [...user.permissions] };
  f.state.workflows.push(request('claim-application', 'corporate_application', 'p1', application({ existingCorporateCustomerId: 'company', agreementAcknowledgedAt: new ClockDate().toISOString() }), 'pending', null));
  // The transaction fixture replaces state on rollback; resolve live rows each time.
  const row = () => f.state.workflows[0], company = () => f.state.profiles.find(p => p.id === 'company'); company().region = 'display-only city';
  const read = () => f.as('operator', () => f.apps.merchantClaimMaterial(reviewer, row().id)), writes = f.counts.writes;
  const expected = { applicationId: row().id, applicationRevision: 1, corporateCustomerId: 'company', corporateName: 'Independent company', legalIdentifierMasked: '913****3456', migrated: true, hasCurrentAdministrator: true, readOnly: true };
  assert.deepEqual(plain(await read()), expected); assert.equal(f.counts.writes, writes); assert.equal(JSON.stringify(await read()).includes('91310000MA1K123456'), false);
  f.state.grants = []; assert.deepEqual(plain(await read()), { ...expected, hasCurrentAdministrator: false });
  const original = row().payload; row().payload = JSON.stringify({ ...JSON.parse(original), region: 'HK' }); await rejectsStatus(read(), 400); await rejectsStatus(f.as('operator', () => f.apps.review(reviewer, row().id, change('unsupported-claim-K', 1, { decision: 'approve', verifiedRepresentative: true }))), 400); assert.equal(row().state, 'pending'); row().payload = original;
  company().corporateProfile.status = 'suspended'; await rejectsStatus(read(), 409); company().corporateProfile.status = 'active';
  const masked = company().corporateProfile.unifiedSocialCreditCodeMasked; company().corporateProfile.unifiedSocialCreditCodeMasked = ''; await rejectsStatus(read(), 409); company().corporateProfile.unifiedSocialCreditCodeMasked = masked;
  f.fault.migration = 'missing'; await rejectsStatus(read(), 409); delete f.fault.migration;
  reviewer.permissions = ['rental-os:corporate:manage']; await rejectsStatus(read(), 403); reviewer.permissions = [...user.permissions];
  f.fault.afterClaimMaterialRead = () => { reviewer.permissions = ['rental-os:corporate:manage']; }; await rejectsStatus(read(), 403); assert.equal(f.counts.writes, writes);
});

test('application region smoke: unmapped new submissions and approvals fail closed after original receipts; legacy drafts, negative decisions and own recovery retain their original semantics', async () => {
  const mapped = require('@rental-os/shared').enterpriseApplicationRegionHasIdentityMapping;
  assert.equal(mapped('CN'), true); for (const value of ['HK', 'US', 'cn', ' CN ', 'CN:city', undefined, null, {}, true]) assert.equal(mapped(value), false);
  const f = fixture(), foreign = application({ region: 'HK', legalIdentifier: 'HK-registered-reference', existingCorporateCustomerId: 'company' });
  const draftInput = change('foreign-draft-K', 0, { submit: false, application: foreign });
  const draft = await f.as('p1', () => f.apps.save(context('p1'), draftInput)); assert.equal(draft.state, 'draft');
  const before = f.counts.writes; await rejectsStatus(f.as('p1', () => f.apps.save(context('p1'), change('foreign-submit-K', draft.revision, { requestId: draft.id, submit: true, application: foreign }))), 400); assert.equal(f.counts.writes, before); assert.equal(f.state.workflows[0].state, 'draft');
  const oldInput = change('legacy-foreign-K', 0, { submit: true, application: foreign }), original = { id: 'legacy-foreign', revision: 2, state: 'pending' };
  f.state.workflows.push(request(original.id, 'corporate_application', 'p1', foreign, 'supplement_required'));
  f.state.receipts.push({ tenantId: 't1', operationKey: oldInput.operationKey, actorUserId: 'customer:p1', requestHash: enterpriseHash({ action: 'application.save', target: 'self', input: oldInput }), target: 'application.save:self', result: JSON.stringify(original) });
  assert.deepEqual(plain(await f.as('p1', () => f.apps.save(context('p1'), oldInput))), original); assert.equal(f.counts.writes, before);
  assert.deepEqual(plain((await f.as('p1', () => f.apps.readSave(context('p1'), oldInput.operationKey))).result), original); assert.equal(f.counts.writes, before);
  for (const [id,decision,payload] of [['foreign-reject','reject',foreign],['incomplete-supplement','supplement',{ region: 'HK' }]]) {
    f.state.workflows.push(request(id, 'corporate_application', 'p1', payload)); const result = await f.as('operator', () => f.apps.review(user,id,change(id+'-K',1,{decision,verifiedRepresentative:false}))); assert.equal(result.state,decision==='reject'?'rejected':'supplement_required');
  }
  f.state.workflows.push(request('foreign-approve','corporate_application','p1',foreign)); const writes = f.counts.writes; await rejectsStatus(f.as('operator',()=>f.apps.review(user,'foreign-approve',change('foreign-approve-K',1,{decision:'approve',verifiedRepresentative:true}))),400); assert.equal(f.counts.writes,writes);
  assert.equal(f.state.corporateProfiles.length,0); assert.equal(f.state.reviews.length,0);
});

test('merchant application evidence smoke: original controller rechecks current dual authority and complete request binding after bytes; failed or changed reads send nothing', async () => {
  const { EnterpriseMerchantController } = load('apps/api/src/modules/enterprise/enterprise-merchant.controller.ts', { '@nestjs/common': { ...require('@nestjs/common'), ...common }, './enterprise-command.service': commandModule });
  const setup = () => {
    const f = fixture(), reviewer = plain(user), calls = [], sent = [], headers = {};
    f.state.workflows.push(request('evidence-request', 'corporate_application', 'p1', application()));
    const files = { readAuthorityBytes: async (...args) => { calls.push(args); f.afterBytes?.(); if (f.storageError) throw f.storageError; return { mimeType: 'image/png', content: Buffer.from('synthetic-only') }; } };
    const controller = new EnterpriseMerchantController(f.apps, undefined, f.commands, f.db, undefined, files, undefined);
    return { f, reviewer, calls, sent, headers, read: (id = 'evidence-request', file = 'proof') => f.as('operator', () => controller.authorityFile({ user: reviewer }, id, file, { setHeader: (name, value) => { headers[name] = value; }, send: body => sent.push(body) })) };
  };
  const normal = setup(); await normal.read(); assert.deepEqual(normal.calls, [['t1', 'proof', 'p1']]); assert.equal(normal.sent.length, 1); assert.equal(normal.headers['Cache-Control'], 'no-store'); assert.equal(normal.headers['X-Content-Type-Options'], 'nosniff'); assert.equal(normal.f.counts.writes, 0);
  for (const mutate of [row => { row.revision++; }, row => { row.applicantCustomerId = 'p2'; }, row => { const data = JSON.parse(row.payload); data.evidenceFileIds = ['replacement']; row.payload = JSON.stringify(data); }, row => { const data = JSON.parse(row.payload); data.authorityStatement = 'Changed at same revision'; row.payload = JSON.stringify(data); }]) {
    const changed = setup(); changed.f.afterBytes = () => mutate(changed.f.state.workflows[0]); await rejectsStatus(changed.read(), 403); assert.equal(changed.sent.length, 0); assert.equal(Object.keys(changed.headers).length, 0); assert.equal(changed.f.counts.writes, 0);
  }
  const revoked = setup(); revoked.f.afterBytes = () => { revoked.reviewer.permissions = ['rental-os:corporate:manage']; }; await rejectsStatus(revoked.read(), 403); assert.equal(revoked.sent.length, 0);
  const unpermitted = setup(); unpermitted.reviewer.permissions = ['rental-os:corporate:manage']; await rejectsStatus(unpermitted.read(), 403); assert.equal(unpermitted.calls.length, 0);
  const invalid = setup(); await rejectsStatus(invalid.read('../request'), 400); await rejectsStatus(invalid.read('evidence-request', 'bad/file'), 400); await rejectsStatus(invalid.read('evidence-request', 'another-file'), 403); assert.equal(invalid.calls.length, 0);
  const failed = setup(); failed.f.storageError = new Error('Original storage unavailable'); await assert.rejects(failed.read(), /Original storage unavailable/u); assert.equal(failed.sent.length, 0); assert.equal(failed.f.counts.writes, 0);
});

test('merchant application material smoke: exact current dual-authority read projects only original fields beyond list bounds and never grants or writes', async () => {
  const f = fixture(), reviewer = { ...user, permissions: [...user.permissions] }, row = request('material-application', 'corporate_application', 'p1', application({ agreementAcknowledgedAt: new ClockDate().toISOString(), privateToken: 'never-projected' }), 'pending', null);
  f.state.workflows.push(row); for (let i = 0; i < 205; i++) f.state.workflows.push(request(`other-material-${i}`, 'corporate_application', 'p2', application(), 'draft', null));
  const before = plain(f.state), writes = f.counts.writes, read = (id = row.id) => f.as('operator', () => f.apps.merchantDetail(reviewer, id));
  await rejectsStatus(f.as('operator', () => f.apps.merchantList(reviewer)), 409);
  const result = await read(); assert.equal(result.id, row.id); assert.equal(result.applicantCustomerId, 'p1'); assert.equal(result.payload.contactName, 'Representative'); assert.equal(result.payload.privateToken, undefined); assert.deepEqual(plain(result.payload.evidenceFileIds), ['proof']);
  result.payload.evidenceFileIds.push('local-only'); assert.deepEqual(JSON.parse(row.payload).evidenceFileIds, ['proof']);
  await rejectsStatus(read('absent-material'), 404); await rejectsStatus(read('bad/id'), 400); await rejectsStatus(f.as('p1', () => f.apps.merchantDetail(reviewer, row.id)), 403);
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  for (const permission of ['rental-os:corporate:manage', 'rental-os:corporate:employee-manage']) { reviewer.permissions = user.permissions.filter(value => value !== permission); await rejectsStatus(read(), 403); } reviewer.permissions = [...user.permissions];
  const original = { ...row }; row.tenantId = 't2'; await rejectsStatus(read(), 404); Object.assign(row, original); row.kind = 'join_request'; await rejectsStatus(read(), 404); Object.assign(row, original);
  for (const payload of ['{bad', JSON.stringify({ ...application(), contactName: 'x'.repeat(121) }), JSON.stringify({ ...application(), agreementAcknowledgedAt: 'bad-utc' })]) { row.payload = payload; await rejectsStatus(read(), 409); } Object.assign(row, original);
  f.fault.afterMerchantApplicationMaterialRead = () => { reviewer.permissions = ['rental-os:corporate:manage']; }; await rejectsStatus(read(), 403); assert.equal(f.counts.writes, writes);
});

test('merchant application decision original smoke: exact operator/application/K receipt survives later material and grants; current dual authority and malformed proof fail closed', async () => {
  for (const decision of ['reject', 'supplement', 'approve']) {
    const f = fixture(), reviewer = { ...user, permissions: [...user.permissions] };
    f.state.workflows.push(request('original-application', 'corporate_application', 'p1', application({ agreementAcknowledgedAt: new ClockDate().toISOString() }), 'pending', null));
    const original = await f.as('operator', () => f.apps.review(reviewer, 'original-application', change('original-review-K', 1, { decision, verifiedRepresentative: decision === 'approve' })));
    const row = f.state.workflows[0], receipt = f.state.receipts.find(r => r.operationKey === 'original-review-K');
    row.state = 'withdrawn'; row.revision = 99; row.corporateCustomerId = 'different-current-company'; row.payload = '{unavailable-current-material'; f.state.grants = []; f.state.corporateEnabled = false;
    const read = (id = row.id, key = 'original-review-K') => f.as('operator', () => f.apps.readReview(reviewer, id, key)), writes = f.counts.writes, before = plain(f.state);
    assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
    assert.deepEqual(plain(await read(row.id, 'missing-K')), { state: 'not_recorded' });
    assert.deepEqual(plain(await read('another-application')), { state: 'not_recorded' });
    assert.deepEqual(plain(await f.as('other-operator', () => f.apps.readReview({ ...reviewer, id: 'other-operator' }, row.id, 'original-review-K'))), { state: 'not_recorded' });
    await rejectsStatus(f.as('p1', () => f.apps.readReview(reviewer, row.id, 'original-review-K')), 403);
    await rejectsStatus(read('bad/id'), 400); await rejectsStatus(read(row.id, ''), 400);
    assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
    for (const permission of ['rental-os:corporate:manage', 'rental-os:corporate:employee-manage']) {
      reviewer.permissions = user.permissions.filter(value => value !== permission); await rejectsStatus(read(), 403);
    }
    reviewer.permissions = [...user.permissions];
    const savedResult = receipt.result;
    for (const invalid of ['{bad', 'null', '[]', { ...original, id: 'different-id' }, { ...original, state: 'pending' }, { ...original, revision: '2' }, { ...original, revision: 1 }, { ...original, corporateCustomerId: 'bad/company' }, { ...original, state: 'approved', corporateCustomerId: null }]) {
      receipt.result = invalid; await rejectsStatus(read(), 409);
    }
    receipt.result = { ...original, privateToken: 'not-projected' }; assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) }); receipt.result = savedResult;
    const target = receipt.target; receipt.target = 'application.withdraw:original-application'; assert.deepEqual(plain(await read()), { state: 'not_recorded' }); receipt.target = target;
    for (const patch of [{ kind: 'join_request' }, { tenantId: 't2' }]) { const previous = { ...row }; Object.assign(row, patch); await rejectsStatus(read(), 409); Object.assign(row, previous); }
    f.fault.afterApplicationReviewRead = () => { reviewer.permissions = ['rental-os:corporate:manage']; }; await rejectsStatus(read(), 403); assert.equal(f.counts.writes, writes);
  }
});

test('application feedback smoke: exact applicant request projects original material beyond list bounds, never another owner or current policy', async () => {
  const f = fixture(), saved = await f.as('p1', () => f.apps.save(context('p1'), change('feedback-save-K', 0, { application: application(), submit: true })));
  await f.as('operator', () => f.apps.review(user, saved.id, change('feedback-review-K', saved.revision, { decision: 'supplement' })));
  const row = f.state.workflows[0]; row.payload = JSON.stringify({ ...JSON.parse(row.payload), privateToken: 'not-projected' }); f.state.grants = []; f.state.corporateEnabled = false; f.state.profiles[1].name = 'Current profile name';
  for (let i = 0; i < 205; i++) f.state.workflows.push(request(`other-${i}`, 'corporate_application', 'p1', application(), 'draft', null));
  const before = plain(f.state), writes = f.counts.writes, result = await f.as('p1', () => f.apps.detail(context('p1'), saved.id));
  assert.equal(result.id, saved.id); assert.equal(result.state, 'supplement_required'); assert.equal(result.payload.contactName, 'Representative'); assert.equal(result.payload.agreementVersion, 'v1'); assert.equal(result.payload.privateToken, undefined);
  assert.equal(result.payload.agreementAcknowledged, true); assert.ok(result.payload.agreementAcknowledgedAt); assert.deepEqual(plain(result.payload.evidenceFileIds), ['proof']);
  await rejectsStatus(f.as('p2', () => f.apps.detail(context('p2'), saved.id)), 404); await rejectsStatus(f.as('p1', () => f.apps.detail(context('p1'), 'absent-application')), 404);
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
});

test('application save smoke: original actor/K follows its own application after later approval; no material fallback or second save', async () => {
  const f = fixture(), original = await f.as('p1', () => f.apps.save(context('p1'), change('save-original-K', 0, { application: application(), submit: false })));
  f.state.workflows[0].state = 'approved'; f.state.workflows[0].revision = 9; f.state.workflows[0].payload = JSON.stringify({ privateToken: 'not-returned' }); f.state.grants = []; f.state.corporateEnabled = false;
  const before = plain(f.state), writes = f.counts.writes;
  assert.deepEqual(plain(await f.as('p1', () => f.apps.readSave(context('p1'), 'save-original-K'))), { state: 'committed', result: plain(original) });
  assert.deepEqual(plain(await f.as('p2', () => f.apps.readSave(context('p2'), 'save-original-K'))), { state: 'not_recorded' });
  assert.deepEqual(plain(await f.as('p1', () => f.apps.readSave(context('p1'), 'absent-K'))), { state: 'not_recorded' });
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  f.state.receipts.find(r => r.operationKey === 'save-original-K').result = { id: 'foreign-application', state: 'draft', revision: 1 }; await rejectsStatus(f.as('p1', () => f.apps.readSave(context('p1'), 'save-original-K')), 409);
});

test('application withdrawal smoke: own original request/K survives later state and grant changes without deleting materials or writing twice', async () => {
  const f = fixture(), saved = await f.as('p1', () => f.apps.save(context('p1'), change('application-save-K', 0, { application: application(), submit: false })));
  const original = await f.as('p1', () => f.apps.withdraw(context('p1'), saved.id, change('application-withdraw-K', saved.revision)));
  f.state.workflows[0].state = 'approved'; f.state.workflows[0].revision = 9; f.state.grants = []; f.state.corporateEnabled = false;
  const before = plain(f.state), writes = f.counts.writes, read = (key = 'application-withdraw-K', id = saved.id) => f.as('p1', () => f.apps.readWithdrawal(context('p1'), id, key));
  assert.deepEqual(plain(await read()), { state: 'committed', result: plain(original) });
  assert.deepEqual(plain(await read('missing-K')), { state: 'not_recorded' }); assert.deepEqual(plain(await read('application-withdraw-K', 'other-request')), { state: 'not_recorded' });
  assert.deepEqual(plain(await f.as('p2', () => f.apps.readWithdrawal(context('p2'), saved.id, 'application-withdraw-K'))), { state: 'not_recorded' });
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.writes, writes);
  f.state.receipts.find(r => r.operationKey === 'application-withdraw-K').result = '{bad'; await rejectsStatus(read(), 409);
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

test('verified merchant recovery handles migrated role-only or stale-grant admins without reauthorizing old relationships', async () => {
  for (const mode of ['revoked', 'stale', 'entry-only', 'manage-only', 'foreign-grant', 'other-company-grant']) {
    const f = fixture();
    if (mode === 'revoked') f.state.grants = [];
    if (mode === 'stale') f.state.relations[0].updatedAt = new ClockDate(clock);
    if (mode === 'entry-only') f.state.grants = f.state.grants.filter(g => g.action !== 'administrators:manage');
    if (mode === 'manage-only') f.state.grants = f.state.grants.filter(g => g.action !== 'portal:enter');
    if (mode === 'foreign-grant') f.state.grants.forEach(g => { g.tenantId = 't2'; });
    if (mode === 'other-company-grant') f.state.grants.forEach(g => { g.corporateCustomerId = 'other'; });
    f.state.workflows.push(request('recovery', 'corporate_application', 'p1', application({ existingCorporateCustomerId: 'company', agreementAcknowledgedAt: new ClockDate().toISOString() })));
    f.state.originalOrders = [{ id: 'old-order', customerId: 'admin', contractCustomerId: 'company', payerCustomerId: 'company' }];
    const before = plain(f.state), input = change('recover', 1, { decision: 'approve', verifiedRepresentative: true });
    const result = await f.as('operator', () => f.apps.review(user, 'recovery', input));
    assert.equal(result.state, 'approved'); assert.equal(result.corporateCustomerId, 'company');
    assert.deepEqual(plain(f.state.profiles), before.profiles); assert.deepEqual(plain(f.state.relations[0]), before.relations[0]);
    assert.deepEqual(plain(f.state.grants.slice(0, before.grants.length)), before.grants); assert.deepEqual(plain(f.state.originalOrders), before.originalOrders);
    await new EnterpriseAccessService(f.db).requireAction(context('p1'), 'company', 'administrators:manage');
    await rejectsStatus(new EnterpriseAccessService(f.db).requireAction(context('admin'), 'company', 'administrators:manage'), 403);
    const originalResultState = plain(f.state), writes = f.counts.writes;
    assert.deepEqual(plain(await f.as('operator', () => f.apps.review(user, 'recovery', input))), plain(result));
    assert.deepEqual(plain(f.state), originalResultState); assert.equal(f.counts.writes, writes, 'original recovery replay never grants again');
  }
});

test('recovery never bypasses existing current admin, legacy admin, frozen company, personal activation or archived proof', async () => {
  const cases = [
    ['current-admin', () => {}],
    ['legacy-admin', f => { f.state.portalMarkers = []; f.state.policyMarkers = []; f.state.grants = []; }],
    ['foreign-marker', f => { f.state.portalMarkers = [{ tenantId: 't2', corporateCustomerId: 'company' }]; f.state.policyMarkers = []; f.state.grants = []; }],
    ['temporary-portal-off', f => { f.state.corporateEnabled = false; }],
    ['frozen-company', f => { f.state.grants = []; f.state.profiles.at(-1).membership.status = 'suspended'; }],
    ['inactive-applicant', f => { f.state.grants = []; f.state.profiles[1].membership.status = 'pending_activation'; }],
    ['missing-proof', f => { f.state.grants = []; f.state.files[0].status = 'pending_upload'; }],
    ['unverified-representative', f => { f.state.grants = []; }],
    ['no-employee-manage', f => { f.state.grants = []; }],
  ];
  for (const [mode, alter] of cases) {
    const f = fixture(); alter(f); f.state.workflows.push(request('recovery', 'corporate_application', 'p1', application({ existingCorporateCustomerId: 'company', agreementAcknowledgedAt: new ClockDate().toISOString() })));
    const before = plain(f.state), input = change('refuse', 1, { decision: 'approve', verifiedRepresentative: mode !== 'unverified-representative' });
    const actor = mode === 'no-employee-manage' ? { ...user, permissions: ['rental-os:corporate:manage'] } : user;
    await assert.rejects(f.as('operator', () => f.apps.review(actor, 'recovery', input)), e => [403, 409].includes(e.getStatus?.()), mode);
    assert.deepEqual(plain(f.state), before, mode); assert.equal(f.state.receipts.length, 0);
  }
});

test('policy-only and disabled migration markers remain scoped; missing or malformed marker evidence fails closed', async () => {
  for (const mode of ['policy-only', 'disabled', 'numeric', 'bigint', 'missing', 'invalid']) {
    const f = fixture(); f.state.grants = [];
    if (mode === 'policy-only') { f.state.portalMarkers = []; f.state.policyMarkers = [{ tenantId: 't1', corporateCustomerId: 'company' }]; }
    if (mode === 'disabled') f.state.corporateEnabled = false;
    if (mode === 'numeric') f.fault.migration = 1;
    if (mode === 'bigint') f.fault.migration = 1n;
    if (['missing', 'invalid'].includes(mode)) f.fault.migration = mode;
    f.state.workflows.push(request('recovery', 'corporate_application', 'p1', application({ existingCorporateCustomerId: 'company', agreementAcknowledgedAt: new ClockDate().toISOString() })));
    const before = plain(f.state), input = change('marker-recovery', 1, { decision: 'approve', verifiedRepresentative: true });
    if (['missing', 'invalid'].includes(mode)) {
      await rejectsStatus(f.as('operator', () => f.apps.review(user, 'recovery', input)), 409, '迁入依据'); assert.deepEqual(plain(f.state), before);
    } else assert.equal((await f.as('operator', () => f.apps.review(user, 'recovery', input))).state, 'approved');
  }
});

test('recovery grant failure rolls back; tenant-serialized competing verified claims establish only one current management owner', async () => {
  const f = fixture(); f.state.grants = [];
  const data = application({ existingCorporateCustomerId: 'company', agreementAcknowledgedAt: new ClockDate().toISOString() });
  f.state.workflows.push(request('first-recovery', 'corporate_application', 'p1', data));
  const before = plain(f.state); f.fault.sql = 'INSERT INTO enterprise_portal_grants';
  await assert.rejects(f.as('operator', () => f.apps.review(user, 'first-recovery', change('grant-failure', 1, { decision: 'approve', verifiedRepresentative: true }))), /Injected/);
  assert.deepEqual(plain(f.state), before); assert.equal(f.counts.rollbacks, 1); f.fault.sql = '';
  f.state.files.push({ ...f.state.files[0], id: 'p2-proof', uploadedBy: 'p2', businessId: 'p2' });
  f.state.workflows.push(request('second-recovery', 'corporate_application', 'p2', { ...data, evidenceFileIds: ['p2-proof'] }));
  const outcomes = await Promise.allSettled(['first-recovery', 'second-recovery'].map((id, i) => f.as('operator', () => f.apps.review(user, id, change(`competing-${i}`, 1, { decision: 'approve', verifiedRepresentative: true })))));
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1); assert.equal(outcomes.filter(o => o.status === 'rejected' && o.reason.getStatus?.() === 409).length, 1);
  assert.equal(f.state.workflows.filter(w => w.state === 'approved').length, 1); assert.equal(f.state.workflows.filter(w => w.state === 'pending').length, 1);
  assert.equal(f.state.relations.filter(r => r.personalCustomerId !== 'admin' && r.role === 'admin').length, 1);
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

test('handoff order source smoke: unrequested original relation, bounded source, authorized order-page queue and separate unavailable tasks', async () => {
  const shared=require('@rental-os/shared'),{EnterpriseRentalHandoffService}=load('apps/api/src/modules/enterprise/enterprise-rental-handoff.service.ts',{'../../common/request-identity':identity,'./enterprise-command.service':commandModule,'@rental-os/shared':shared});
  const f=fixture(),client={...context('p1'),workspaceId:'w1',workspaceCode:'s1'},as=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'p1',isSaasAdmin:false},fn),operator={...user,permissions:['rental-os:corporate:manage','rental-os:order:view']},merchant=fn=>identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w1',userId:'operator',dataScope:'all',isSaasAdmin:false},fn);
  const material={orderId:'order-a',orderNo:'Original rental',orderUpdatedAt:'2026-11-02T00:00:00.000Z',workspaceCode:'s1',corporateCustomerId:'company',corporateMembershipId:'original-relation',membershipResolvedAt:'2026-11-01T00:00:00.000Z',membershipUpdatedAt:null,enterpriseContractAndPayer:true,subjects:{contract:'corporate',payer:'corporate',user:'self'},subjectBasis:'recorded_columns',scope:'current_workspace_original_own_order',readOnly:true,privateField:'must-not-project'};
  let orderRows=[{id:'order-a',status:'renting',updatedAt:new ClockDate(material.orderUpdatedAt)}],requests=[],sourceReads=0,orderQueries=0;
  const query=f.db.$queryRaw;f.db.$queryRaw=async(first,...rest)=>{const sql=Array.isArray(first)?first.join('?'):first.sql,values=Array.isArray(first)?rest:first.values;
    if(sql.includes('SELECT id,status,updatedAt FROM rental_orders')){sourceReads++;assert.deepEqual(values.slice(0,4),['t1','w1','p1','p1']);assert(sql.includes("'enterprise_employee'"));assert(sql.includes('LIMIT 201'));return orderRows.slice(0,201);}
    if(sql.includes('FROM enterprise_rental_handoff_requests')){assert.equal(values[0],'t1');assert.equal(values[1],'w1');return requests.filter(r=>sql.includes('orderId IN')?values.slice(2).includes(r.orderId):sql.includes('applicantCustomerId=')?r.applicantCustomerId===values[2]:r.id===values[2]);}
    return query(first,...rest);};
  const service=new EnterpriseRentalHandoffService(f.db,f.commands,{rentalHandoffMaterial:async(_ctx,id,tx)=>{assert.equal(tx,f.db);return {...material,orderId:id};}},{queryOrders:async(tenant,q)=>{orderQueries++;assert.equal(tenant,'t1');assert.equal(q.take,50);return{items:[{id:q.skip===0?'other-order':'order-a',tenantId:'t1'}],total:51};},findOrder:async(tenant,id,tx)=>{assert.equal(tx,f.db);return{id,tenantId:tenant};}});
  const source=await as(()=>service.orderSource(client));assert.equal(source.items.length,1);assert.equal(source.items[0].material.corporateMembershipId,'original-relation');assert.equal(source.items[0].material.privateField,undefined);assert.equal(f.state.receipts.length,0);assert.equal(requests.length,0);
  const tasks=new EnterpriseTaskCenterService(f.db,f.commands,{mine:async()=>[]},{joinRequests:async()=>[]},{list:async()=>[]},{},{mine:async()=>[]},{list:async()=>[]},{list:async()=>[]},service);assert.equal((await as(()=>tasks.tasks(client))).handoffOrders.items.length,1);
  requests=[{id:'handoff-a',orderId:'order-a',applicantCustomerId:'p1',state:'pending',revision:1,corporateCustomerId:'company',corporateMembershipId:'original-relation',material:JSON.stringify(material),reason:'Original reason',createdAt:new ClockDate(),updatedAt:new ClockDate()}];
  const first=await merchant(()=>service.merchantQueue(operator,1)),next=await merchant(()=>service.merchantQueue(operator,2));assert.equal(first.items.length,0);assert.equal(first.orderPage.total,51);assert.equal(next.items[0].id,'handoff-a');assert.equal(next.coverage,'current_workspace_authorized_original_order_page');assert.equal(next.items[0].material.privateField,undefined);const reads=orderQueries;await rejectsStatus(merchant(()=>service.merchantQueue({...operator,permissions:['rental-os:corporate:manage']},1)),403);assert.equal(orderQueries,reads);await rejectsStatus(merchant(()=>service.merchantQueue(operator,0)),400);
  orderRows=Array.from({length:201},(_,n)=>({id:`order-${n}`,status:'renting',updatedAt:new ClockDate(material.orderUpdatedAt)}));await rejectsStatus(as(()=>service.orderSource(client)),409);const unavailable=await as(()=>tasks.tasks(client));assert.equal(unavailable.handoffOrders.state,'unavailable');assert.equal(Object.hasOwn(unavailable.handoffOrders,'items'),false);assert.equal(unavailable.items[0].id,'handoff-a');assert.equal(f.state.receipts.length,0);
  assert.equal(shared.enterpriseRentalHandoffOrderSourceSnapshot({...source,items:[...source.items,...source.items]},'s1'),undefined);assert.equal(shared.enterpriseRentalHandoffMerchantQueueSnapshot({...next,orderPage:{...next.orderPage,page:0}}),undefined);const before=sourceReads;await rejectsStatus(identity.runWithRequestIdentity({tenantId:'t1',workspaceId:'w2',userId:'p1',isSaasAdmin:false},()=>service.orderSource(client)),403);assert.equal(sourceReads,before);
});
