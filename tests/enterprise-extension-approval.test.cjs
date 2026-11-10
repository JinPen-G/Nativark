'use strict';
/** Real enterprise/ClientApi/Core/policy/idempotency methods composed offline.
 * Database locking/storage, qualification, pricing source and funding are explicit
 * doubles. No HTTP, application bootstrap, Prisma generation or actual database. */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { createHash } = require('node:crypto'), { Prisma } = require('@prisma/client');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output/enterprise-offline/workflows');
assert.equal(process.env.DATABASE_URL, 'mysql://offline:offline@127.0.0.1:1/rental_os_offline');
assert.equal(path.resolve(process.env.AI_OFFLINE_WRITE_ROOT), output);
assert.ok(require.cache[require.resolve('./fixtures/ai-native/prisma-offline-preload.cjs')]);
const common = require('@nestjs/common'), shared = require('../packages/shared/dist'), sources = new Map(), modules = new Map();
function load(relative) {
  if (modules.has(relative)) return modules.get(relative).exports;
  const file = path.join(root, relative), source = fs.readFileSync(file, 'utf8'), module = { exports: {} };
  sources.set(file, createHash('sha256').update(source).digest('hex')); modules.set(relative, module);
  const code = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, emitDecoratorMetadata: false } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    if (name.startsWith('node:')) return require(name);
    if (name === '@nestjs/common') return common;
    if (name === '@prisma/client') return { Prisma };
    if (name === '@rental-os/shared') return shared;
    if (name === 'zod') return require('zod');
    if (name.startsWith('.')) {
      // Injection-only modules are not bootstrapped. Only the five services under
      // composition and the actual idempotency store are loaded as implementations.
      const implementations = new Set(['enterprise-command.service', 'enterprise-policy.service', 'enterprise-extension-approval.service', 'enterprise-exchange-approval.service', 'rental-exchange-preview.service', 'rental-core.service', 'client-api.service', 'rental-idempotent-action.service', 'rental-idempotency.repository', 'rental-exchange-inspection-preparation.service', 'rental-exchange-inspection-media.service']);
      if (/(?:\.service|\.repository|\.runtime|\.registrar)$/u.test(name) && !implementations.has(path.basename(name))) return {};
      const resolved = path.resolve(path.dirname(file), name) + '.ts';
      return load(path.relative(root, resolved).replaceAll('\\', '/'));
    }
    throw new Error(`Unexpected import ${name} in ${relative}`);
  }, console, Date, Map, Set, JSON, structuredClone, setTimeout, clearTimeout, Buffer, process: { env: { PLATFORM_DATA_SOURCE: 'mysql' } } }, { filename: file });
  return module.exports;
}
const identity = load('apps/api/src/common/request-identity.ts');
const { EnterpriseCommandService } = load('apps/api/src/modules/enterprise/enterprise-command.service.ts');
const { EnterprisePolicyService } = load('apps/api/src/modules/enterprise/enterprise-policy.service.ts');
const { EnterpriseExtensionApprovalService } = load('apps/api/src/modules/enterprise/enterprise-extension-approval.service.ts');
const { RentalCoreService } = load('apps/api/src/modules/rental-core/rental-core.service.ts');
const { ClientApiService } = load('apps/api/src/modules/client/client-api.service.ts');
const { RentalIdempotentActionService } = load('apps/api/src/modules/rental-core/rental-idempotent-action.service.ts');
const { RentalIdempotencyRepository } = load('apps/api/src/modules/rental-core/rental-idempotency.repository.ts');
const { requestFingerprint } = load('apps/api/src/modules/rental-core/rental-idempotency.repository.ts');
const ctx = id => ({ tenantId: 't1', tenantCode: 'merchant', workspaceId: 'w1', workspaceCode: 'vehicles', customerId: id, customerType: 'personal', sessionId: `session-${id}`, membershipStatus: 'active' });
const within = (id, fn) => identity.runWithRequestIdentity({ tenantId: 't1', workspaceId: 'w1', userId: id, isSaasAdmin: false }, fn);
const change = (key, revision, extra) => ({ operationKey: key, expectedRevision: revision, reason: 'Explicit reviewed request', ...extra });
const copy = structuredClone, plain = value => JSON.parse(JSON.stringify(value));
function sqlArgs(query, values) { return Array.isArray(query) ? { sql: query.join('?').replace(/\s+/g, ' '), values } : { sql: query.sql.replace(/\s+/g, ' '), values: query.values }; }
function fixture(paymentRequired = true) {
  const updated = '2026-11-01T00:00:00.000Z', relationUpdated = new Date('2026-10-31T00:00:00Z');
  const policy = { workspaceIds: ['w1'], categoryCodes: ['vehicle'], personalPaymentAllowed: true, enterprisePaymentAllowed: true,
    approvalMode: 'per_order', approvalLifetimeMinutes: 30, noticeVersion: 'v1', noticeText: 'Original enterprise disclosure' };
  const basis = { merchantRevision: 1, companyRevision: 1, employeeRevision: 1, membershipUpdatedAt: relationUpdated.toISOString(), noticeVersion: 'v1', acknowledgedAt: updated, guaranteePayer: 'enterprise', approvalMode: 'per_order' };
  let state = { exchangeApprovals: [], approvals: [], receipts: [], extensions: [], idempotency: [], order: { id: 'o1', tenantId: 't1', workspaceId: 'w1', quoteId: 'q1', customerId: 'p1', status: shared.RentalCoreOrderStatus.Renting,
    startAt: '2090-01-01T00:00:00Z', endAt: '2090-01-02T00:00:00Z', updatedAt: updated, ruleSnapshot: { extension: { enabled: true } }, rentalAmount: 100, payableAmount: 100, finalPayableAmount: 100,
    chargeLines: [], reservations: [], lines: [], allocations: [], membershipSnapshot: { bookingIdentity: 'enterprise_employee', personalCustomerId: 'p1', corporateCustomerId: 'c1', corporateMembershipId: 'm1', enterpriseContractAndPayer: true, enterpriseBasis: basis } } };
  const flags = { active: true, reviewer: true, member: true, failReceipt: false, failCoreSave: false, failCloseReceipt: false, loseAck: false, paid: false, pricingChanged: false, available: true };
  const events = [], barriers = {}, policies = ['merchant', 'company', 'member:m1'].map(scopeKey => ({ scopeKey, revision: 1, policy: copy(policy), membershipUpdatedAt: relationUpdated }));
  const preview = { orderId: 'o1', originalEndAt: state.order.endAt, newEndAt: '2090-01-03T00:00:00.000Z', billableUnits: 1, rentalAmount: 100, serviceAmount: 0, depositDelta: paymentRequired ? 10 : 0, preAuthDelta: 0, payableAmount: 100,
    currency: 'CNY', settlementMode: paymentRequired ? 'immediate' : 'monthly', paymentRequired, chargeLines: [{ code: 'rent', name: 'Original rental', type: 'rental', amount: 100, detail: 'Private internal pricing detail' }],
    rateSnapshot: [], ruleSnapshot: { extension: { enabled: true } }, ruleVersion: 'v1', calendarSnapshot: [], executionBasis: { pricingMode: 'incremental' } };
  // DB double models the order fence, not a global transaction mutex. All changed
  // state is copied only when the actual SQL/order lock requests its first fence.
  const locks = new Map(); let sequence = 0;
  const acquire = async (tx, key) => {
    if (tx.held.includes(key)) return;
    while (locks.has(key)) await locks.get(key).promise;
    let release; const promise = new Promise(resolve => { release = resolve; }); locks.set(key, { promise, release }); tx.held.push(key);
    if (!tx.state) tx.state = copy(state); events.push({ tx: tx.id, event: 'lock', key });
    if (barriers.first) { const gate = barriers.first; delete barriers.first; gate.acquired(); await gate.promise; }
  };
  const local = tx => tx?.state ?? state;
  const dbFor = tx => ({
    async $queryRaw(query, ...input) {
      const { sql, values: v } = sqlArgs(query, input); const s = local(tx); events.push({ tx: tx?.id, event: 'sql', sql });
      if (sql.includes('FROM Tenant')) return [{ id: 't1' }];
      if (sql.includes('FROM customer_profiles p JOIN customer_accounts')) return flags.active || v.includes(true) ? [{ id: v[2] }] : [];
      if (sql.includes('FROM business_workspaces')) return [{ categoryCode: 'VEHICLE' }];
      if (sql.includes('SELECT m.id FROM customer_corporate_memberships')) return flags.reviewer ? [{ id: 'reviewer-m' }] : [];
      if (sql.includes('SELECT r.id,r.updatedAt FROM customer_corporate_memberships')) return flags.member ? [{ id: 'm1', updatedAt: relationUpdated }] : [];
      if (sql.includes('enterprise_scope_policies')) return policies;
      if (sql.includes('enterprise_corporate_portals') || sql.includes('enterprise_portal_tenant_settings')) return [{ enabled: true }];
      if (sql.includes('enterprise_portal_operations')) return s.receipts.filter(r => r.operationKey === v[1]);
      if (sql.includes('enterprise_exchange_approvals')) {
        let rows = s.exchangeApprovals.filter(r => r.tenantId === v[0] && r.workspaceId === v[1]);
        if (sql.includes('AND id=?')) rows = rows.filter(r => r.id === v[2]);
        if (sql.includes('AND orderId=?')) rows = rows.filter(r => r.orderId === v[2]);
        if (sql.includes('AND corporateCustomerId=?')) rows = rows.filter(r => r.corporateCustomerId === v[2]);
        if (sql.includes('AND applicantCustomerId=?')) rows = rows.filter(r => r.applicantCustomerId === v[sql.includes('AND orderId=?') ? 3 : 2]);
        if (sql.includes("state IN ('pending','approved')")) rows = rows.filter(r => ['pending', 'approved'].includes(r.state) && r.expiresAt > new Date());
        return copy(rows);
      }
      if (sql.includes('enterprise_extension_approvals')) {
        let rows = s.approvals;
        if (sql.includes('AND id=?')) rows = rows.filter(r => r.id === (sql.includes('AND orderId=?') ? v.at(-1) : v[1]));
        if (sql.includes('AND orderId=?')) rows = rows.filter(r => r.orderId === v[2]);
        if (sql.includes('AND extensionId=?')) rows = rows.filter(r => r.extensionId === v[5]);
        if (sql.includes("state IN ('pending','approved')")) rows = rows.filter(r => ['pending', 'approved'].includes(r.state) && r.expiresAt > new Date());
        return copy(rows);
      }
      throw new Error(sql);
    },
    async $executeRaw(query, ...input) {
      const { sql, values: v } = sqlArgs(query, input), s = local(tx);
      if (sql.includes('INSERT INTO enterprise_exchange_approvals')) {
        const keys = ['tenantId','id','corporateCustomerId','applicantCustomerId','workspaceId','orderId','expectedOrderUpdatedAt','requestFingerprint','previewFingerprint','request','preview','basis','reason','expiresAt'];
        s.exchangeApprovals.push({ ...Object.fromEntries(keys.map((key, i) => [key, v[i]])), state: 'pending', revision: 1 }); return 1;
      }
      if (sql.includes('UPDATE enterprise_exchange_approvals')) {
        const row = s.exchangeApprovals.find(r => r.tenantId === v.at(-3) && r.workspaceId === v.at(-2) && r.id === v.at(-1));
        assert.ok(row, 'exchange SQL update resolves the exact scope');
        if (sql.includes('SET approvedBy=')) Object.assign(row, { approvedBy: v[0], reviewerMembershipId: v[1], reviewerMembershipUpdatedAt: v[2] });
        else if (sql.includes('SET employeeConfirmationOperationKey=')) {
          if (row.state !== 'approved' || row.employeeConfirmationOperationKey) return 0;
          Object.assign(row, { employeeConfirmationOperationKey: v[0], employeeConfirmedAt: v[1], employeeConfirmationFingerprint: v[2], revision: row.revision + 1 });
        }
        else Object.assign(row, { state: v[0], decisionReason: v[1], revision: row.revision + 1 });
        return 1;
      }
      if (sql.includes('INSERT INTO enterprise_extension_approvals')) {
        const keys = ['tenantId','id','corporateCustomerId','applicantCustomerId','workspaceId','orderId','expectedOrderUpdatedAt','requestFingerprint','previewFingerprint','request','preview','basis','reason','expiresAt'];
        s.approvals.push({ ...Object.fromEntries(keys.map((key, i) => [key, v[i]])), state: 'pending', revision: 1, extensionId: null, executionKey: null, approvedBy: null }); return 1;
      }
      if (sql.includes('INSERT INTO enterprise_portal_operations')) {
        if (flags.failReceipt || flags.failCloseReceipt && v[1] === 'close-request') throw new Error('receipt write failed');
        if (s.receipts.some(r => r.operationKey === v[1])) throw new Error('duplicate operation key');
        s.receipts.push({ operationKey: v[1], actorUserId: v[2], requestHash: v[3], target: v[4], result: v[6] }); return 1;
      }
      const row = s.approvals.find(r => r.id === v.at(-1) || r.id === v.at(-2));
      if (sql.includes('SET approvedBy=')) { Object.assign(row, { approvedBy: v[0], reviewerMembershipId: v[1], reviewerMembershipUpdatedAt: v[2] }); return 1; }
      if (sql.includes("SET state='closed'")) { const target = s.approvals.find(r => r.id === v[2]); Object.assign(target, { state: 'closed', closedOperationKey: v[0], revision: target.revision + 1 }); return 1; }
      if (sql.includes("state='consumed'")) { const target = s.approvals.find(r => r.id === v[3]); Object.assign(target, { state: 'consumed', extensionId: v[0], executionKey: v[1], revision: target.revision + 1 }); return 1; }
      if (sql.includes('SET state=')) { Object.assign(row, { state: v[0], revision: row.revision + 1 }); return 1; }
      throw new Error(sql);
    },
    customerCorporateMembership: { findFirst: async () => ({ updatedAt: relationUpdated }) },
    businessWorkspace: { findFirst: async () => ({ id: 'w1', tenantId: 't1' }) },
    rentalOrderIdempotencyRecord: { findFirst: async ({ where }) => copy(local(tx).idempotency.find(r => r.action === where.action && r.idempotencyKey === where.idempotencyKey)),
      create: async ({ data }) => { local(tx).idempotency.push(copy(data)); } },
  });
  const prisma = { ...dbFor(), async $transaction(fn) { const tx = { id: ++sequence, held: [] }; Object.assign(tx, dbFor(tx));
    try { const value = await fn(tx); if (tx.state) state = tx.state; if (flags.loseAck) { flags.loseAck = false; throw new Error('commit acknowledgement lost'); } return value; }
    finally { for (const key of tx.held.reverse()) { const lock = locks.get(key); locks.delete(key); lock.release(); } }
  } };
  const core = Object.create(RentalCoreService.prototype);
  Object.assign(core, { state: () => ({ profile: { terminology: { pickupLabel: 'pickup' } } }), resolveWorkspaceId: () => 'w1',
    async lockedOrder(tenant, id, tx) { assert.equal(id, 'o1'); await acquire(tx, 'order:o1'); return copy(local(tx).order); },
    assertOrderQualification: async () => { if (!flags.member) throw new Error('qualification unavailable'); },
    assertOrderExtensionAvailable: async () => { if (!flags.available) throw new Error('inventory unavailable'); },
    factStore: { listExtensions: async (_t, _o, tx) => copy(local(tx).extensions), insertExtension: async (row, tx) => { local(tx).extensions.push(copy(row)); events.push({ event: 'extension.insert', tx: tx.id }); },
      saveOrderAggregate: async (order, _assets, tx) => { if (flags.failCoreSave) throw new Error('core save failed'); local(tx).order = copy(order); },
      cancelExtensions: async (_t, ids, tx) => local(tx).extensions.forEach(e => { if (ids.includes(e.id)) e.status = 'cancelled'; }),
      markExtensionEffective: async (_t, id, at, paidAt, tx) => Object.assign(local(tx).extensions.find(e => e.id === id), { status: 'effective', effectiveAt: at, paidAt }),
    },
    applyChargeTo(order, line) { order.chargeLines.push(line); order.payableAmount += line.amount; order.finalPayableAmount += line.amount; },
  });
  const commands = new EnterpriseCommandService(prisma), policiesApi = new EnterprisePolicyService(prisma, commands, {}); core.enterprisePolicies = policiesApi;
  const business = { quoteEnterpriseExtension: async (_t, order) => { events.push({ event: 'price' }); return { ...copy(preview), originalEndAt: order.effectiveEndAt ?? order.endAt, payableAmount: flags.pricingChanged ? 200 : preview.payableAmount }; }, synchronizeExtensionCoupon: async (_t, _e, tx) => events.push({ event: 'coupon', tx: tx.id }) };
  core.extensionPrices = business;
  const client = Object.create(ClientApiService.prototype);
  Object.assign(client, { core, business, idempotent: new RentalIdempotentActionService(prisma, new RentalIdempotencyRepository(prisma)), corporateSettlement: {
    allowsExtensionCredit: async () => !paymentRequired, reserveExtensionCredit: async (_t, _o, _e, _amount, tx) => events.push({ event: 'credit.reserve', tx: tx.id }) },
    occupyExtensionServices: async (_ctx, _o, _e, tx) => events.push({ event: 'services.reserve', tx: tx.id }),
    listExtensions: async () => copy(state.extensions),
  });
  const access = { requireAction: async context => { if (!flags.reviewer || context.customerId !== 'reviewer') throw new common.ForbiddenException('review permission'); return { membershipId: 'reviewer-m', permissionRevision: '1' }; } };
  const service = new EnterpriseExtensionApprovalService(prisma, commands, policiesApi, access, core, client, new RentalIdempotencyRepository(prisma));
  const request = () => within('p1', () => service.request(ctx('p1'), change('request-key', 0, { orderId: 'o1', expectedOrderUpdatedAt: updated, extension: { newEndAt: preview.newEndAt } })));
  const approve = id => within('reviewer', () => service.decide(ctx('reviewer'), id, change('approve-key', 1, { decision: 'approve' })));
  const submit = id => within('p1', () => service.submit(ctx('p1'), change('submit-key', 2, { approvalId: id, confirm: true })));
  return { service, prisma, core, client, access, policiesApi, events, barriers, flags, policies, preview, request, approve, submit, state: () => state };
}
test('approval/explicit submit consume real Core extension + idempotency + receipt atomically; pending payment does not extend', async () => {
  const f = fixture(), request = await f.request(); await f.approve(request.id);
  assert.equal(f.state().extensions.length, 0); assert.equal(f.events.some(e => e.event === 'credit.reserve'), false);
  await assert.rejects(within('p1', () => f.service.submit(ctx('p1'), change('false-confirm', 2, { approvalId: request.id, confirm: false }))));
  const result = await f.submit(request.id); assert.equal(result.original.state, 'observed'); assert.equal(result.original.extensionState, 'pending_payment');
  assert.equal(f.state().order.effectiveEndAt, undefined); assert.equal(f.state().extensions.length, 1); assert.equal(f.state().idempotency.length, 1);
  assert.equal(f.state().approvals[0].state, 'consumed'); assert.equal(f.events.some(e => e.event === 'services.reserve'), false);
  assert.equal(new Set(f.events.filter(e => ['extension.insert', 'coupon'].includes(e.event)).map(e => e.tx)).size, 1);
  await f.submit(request.id); assert.equal(f.state().extensions.length, 1);
  await assert.rejects(within('p1', () => f.service.submit(ctx('p1'), change('other-key', 3, { approvalId: request.id, confirm: true }))));
});
test('monthly effect uses original Core and same transaction credit/capacity, not approval-driven payment', async () => {
  const f = fixture(false), request = await f.request(); await f.approve(request.id); const result = await f.submit(request.id);
  assert.equal(result.original.extensionState, 'effective'); assert.equal(f.state().order.effectiveEndAt, f.preview.newEndAt);
  const events = f.events.filter(e => ['extension.insert', 'credit.reserve', 'services.reserve', 'coupon'].includes(e.event));
  assert.equal(events.length, 4); assert.equal(new Set(events.map(e => e.tx)).size, 1);
});
test('same approval concurrent submit waits for original order fence and returns one extension; lost ack/rebuild only reads', async () => {
  const f = fixture(), request = await f.request(); await f.approve(request.id);
  await Promise.all([f.submit(request.id), f.submit(request.id)]); assert.equal(f.state().extensions.length, 1);
  const g = fixture(), second = await g.request(); await g.approve(second.id); g.flags.loseAck = true;
  await assert.rejects(g.submit(second.id), /acknowledgement/); assert.equal(g.state().extensions.length, 1);
  await g.submit(second.id); assert.equal(g.state().extensions.length, 1);
  g.state().idempotency = []; const original = await within('p1', () => g.service.result(ctx('p1'), second.id)); assert.equal(original.original.extensionState, 'pending_payment');
});
test('Core/receipt failure rolls back extension and approval together, preserving old revision without false consumption', async () => {
  for (const field of ['failReceipt', 'failCoreSave']) { const f = fixture(), request = await f.request(); await f.approve(request.id); f.flags[field] = true;
    await assert.rejects(f.submit(request.id)); assert.equal(f.state().extensions.length, 0); assert.equal(f.state().approvals[0].state, 'approved'); assert.equal(f.state().idempotency.length, 0);
  }
});
test('self/cross-user, revision, expiry, policy, reviewer, membership, price and stock denial never consumes', async () => {
  const self = fixture(), request = await self.request(); await assert.rejects(within('p1', () => self.service.decide(ctx('p1'), request.id, change('self', 1, { decision: 'approve' }))));
  for (const variant of ['member', 'reviewer', 'pricingChanged', 'available', 'revision', 'expiry', 'policy']) {
    const f = fixture(), r = await f.request(); await f.approve(r.id);
    if (['member', 'reviewer', 'available'].includes(variant)) f.flags[variant] = false;
    if (variant === 'pricingChanged') f.flags.pricingChanged = true;
    if (variant === 'revision') f.state().order.updatedAt = '2026-11-02T00:00:00Z';
    if (variant === 'expiry') f.state().approvals[0].expiresAt = new Date(0);
    if (variant === 'policy') f.policies[1].revision++;
    await assert.rejects(f.submit(r.id), variant); assert.equal(f.state().extensions.length, 0, variant);
  }
  const f = fixture(), r = await f.request(); await f.approve(r.id);
  await assert.rejects(within('other', () => f.service.submit(ctx('other'), change('foreign', 2, { approvalId: r.id, confirm: true }))));
});
test('ordinary Core extension cannot borrow booking approval; payment revalidates exact consumed expense/current reviewer', async () => {
  const f = fixture(), r = await f.request(); await f.approve(r.id);
  await assert.rejects(within('p1', () => f.prisma.$transaction(tx => f.core.requestOrderExtension('t1', 'o1', f.preview, { idempotencyKey: 'bypass', operator: 'p1' }, tx))));
  await f.submit(r.id); f.flags.reviewer = false;
  await assert.rejects(within('p1', () => f.prisma.$transaction(tx => f.core.payOrderExtension('t1', 'o1', f.state().extensions[0].id, tx))));
  assert.equal(f.state().order.effectiveEndAt, undefined);
  f.flags.reviewer = true; f.flags.pricingChanged = true;
  await assert.rejects(within('p1', () => f.prisma.$transaction(tx => f.core.payOrderExtension('t1', 'o1', f.state().extensions[0].id, tx))));
  f.flags.pricingChanged = false;
  const result = await within('p1', () => f.prisma.$transaction(tx => f.core.payOrderExtension('t1', 'o1', f.state().extensions[0].id, tx)));
  assert.equal(result.extension.status, 'effective'); assert.equal(f.state().order.effectiveEndAt, f.preview.newEndAt);
});
test('original result is whitelisted and exact; missing/mismatched extension never becomes observed', async () => {
  const f = fixture(), r = await f.request(); const listed = await within('p1', () => f.service.list(ctx('p1')));
  assert.equal(JSON.stringify(listed).includes('Private internal'), false); assert.equal('request' in listed[0], false); assert.equal('tenantId' in listed[0], false);
  await f.approve(r.id); await f.submit(r.id); f.state().extensions[0].idempotencyKey = 'wrong';
  await assert.rejects(within('p1', () => f.service.result(ctx('p1'), r.id))); f.state().extensions = [];
  await assert.rejects(within('p1', () => f.service.result(ctx('p1'), r.id)));
});
test('transaction-scoped pricing executes the real original algorithm with persisted sources, not cached seed data or a second calculator', async () => {
  const { RentalBusinessService } = load('apps/api/src/modules/rental-core/rental-business.service.ts');
  const category = { ...copy(shared.RENTAL_CATEGORY_DEFINITIONS.find(c => c.code === 'camping')), businessModel: { ...copy(shared.RENTAL_CATEGORY_DEFINITIONS.find(c => c.code === 'camping').businessModel), pricingUnits: ['day_24h'] } };
  const from = new Date(Date.now() + 86400000).toISOString(), newEndAt = new Date(Date.parse(from) + 86400000).toISOString();
  const rate = { id: 'rate', itemGroupId: 'g1', itemGroupCode: 'G1', itemGroupName: 'Original item', unit: 'day_24h', baseAmount: 100, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 0, minimumUnits: 1 };
  const rules = { payment: { depositMode: 'fixed', preauthorizationRequired: false }, extension: { enabled: true, pricingMode: 'incremental' }, qualification: { required: false }, damage: {}, cancellation: {}, overdue: {}, fulfillment: {} };
  const settings = { pricing: { currency: 'CNY', holidayPricingEnabled: false }, calendar: { timeZone: 'Asia/Shanghai', weekendDays: [0, 6] } };
  const quote = { id: 'q1', tenantId: 't1', categoryCode: 'camping', categoryVersionId: 'cat1', request: { startAt: from, endAt: newEndAt, lines: [{ itemGroupId: 'g1', quantity: 1 }] }, rateSnapshot: [rate], ruleSnapshot: rules, ruleVersion: 'r1', calendarSnapshot: [] };
  const coreConfig = { profile: { tenantId: 't1', categoryCode: 'camping', terminology: {} }, workspaceCategoryCode: 'camping', businessSettings: settings,
    itemGroups: [{ id: 'g1', code: 'G1', name: 'Original item', status: 'enabled', inventoryMode: 'quantity' }], pricingGroups: [], couponTemplates: [], locations: [], operators: [] };
  const config = { pricingPlans: [{ id: 'plan1', status: 'enabled', effectiveFrom: '2020-01-01T00:00:00Z', rates: [rate], version: 'v1' }], discountPlans: [], services: [], calendars: [],
    ruleVersions: [{ id: 'rule1', version: 'r1', status: 'published', effectiveFrom: '2020-01-01T00:00:00Z', config: rules }], hasPersistedConfig: true };
  let reads = 0;
  const tx = { $queryRaw: async () => [{ id: 'w1' }], businessWorkspace: { findFirst: async () => ({ status: 'ACTIVE', categoryVersionId: 'cat1', categoryAdoptionRevision: 1 }) },
    rentalPriceVersion: { findFirst: async () => { reads++; return { id: 'price1', sequence: 1, effectiveFrom: new Date('2020-01-01'), rates: [rate] }; } } };
  const onlyTx = current => { assert.equal(current, tx, 'all authoritative reads participate in the caller transaction'); };
  const service = new RentalBusinessService({ loadWorkspace: async (_t, _w, current) => { onlyTx(current); return config; } },
    { findQuote: async (_t, _q, current) => { onlyTx(current); return quote; } }, { loadWorkspace: async (_t, _w, current) => { onlyTx(current); return coreConfig; } });
  service.prisma = {}; service.categoryResolver = { forWorkspace: async (_t, _w, current) => { onlyTx(current); return { definition: category, categoryVersionId: 'cat1', adoptionRevision: 1 }; },
    forVersion: async (_c, _v, current) => { onlyTx(current); return category; } };
  const order = { id: 'o1', tenantId: 't1', quoteId: 'q1', startAt: new Date(Date.parse(from) - 86400000).toISOString(), endAt: from, lines: [{ itemGroupId: 'g1', quantity: 1 }], depositAmount: 0, preAuthAmount: 0, fulfillmentMode: 'store_pickup_return', customerType: 'personal' };
  const before = service.states.size;
  const price = () => within('p1', () => service.quoteEnterpriseExtension('t1', order, [], { newEndAt }, 'immediate', tx));
  const result = await price(); assert.equal(result.rentalAmount, 100); assert.equal(result.payableAmount, 100); assert.equal(result.priceVersionId, 'price1'); assert.equal(result.ruleVersion, 'r1');
  assert.equal(service.states.size, before, 'no global price cache/seed writes'); assert.equal(reads, 1);
  rate.baseAmount = 200; assert.notEqual(requestFingerprint(await price()), requestFingerprint(result), 'current producer change invalidates stored approval');
  config.hasPersistedConfig = false; await assert.rejects(price(), /依据缺失/);
});

test('approved monthly extension refuses added guarantees; personal and explicitly waived original Core paths remain distinct', async () => {
  const blocked = fixture(false); blocked.preview.depositDelta = 10;
  await assert.rejects(blocked.request(), /保证金/); assert.equal(blocked.state().extensions.length, 0); assert.equal(blocked.state().approvals.length, 0);
  for (const kind of ['personal', 'waived']) {
    const f = fixture(); if (kind === 'personal') delete f.state().order.membershipSnapshot;
    else for (const row of f.policies) row.policy.approvalMode = 'without_per_order';
    const result = await within('p1', () => f.prisma.$transaction(tx => f.core.requestOrderExtension('t1', 'o1', f.preview, { idempotencyKey: `ordinary-${kind}`, operator: 'p1' }, tx)));
    assert.equal(result.extension.status, 'pending_payment'); assert.equal(f.state().approvals.length, 0); assert.equal(f.state().order.effectiveEndAt, undefined);
  }
});
test('original client activation checks the funding port before Core and never treats enterprise approval as payment', async () => {
  const f = fixture(), requested = await f.request(); await f.approve(requested.id); await f.submit(requested.id);
  f.client.assertClientOrder = async () => copy(f.state().order);
  f.client.orderView = order => ({ id: order.id, effectiveEndAt: order.effectiveEndAt });
  f.client.fundingService = { assertExtensionPaid: async (_tenant, _workspace, _order, _extension, tx) => { f.events.push({ event: 'funding.check', tx: tx.id }); if (!f.flags.paid) throw new Error('original funding unpaid'); } };
  await assert.rejects(within('p1', () => f.client.payExtension(ctx('p1'), 'o1', f.state().extensions[0].id)), /funding unpaid/);
  assert.equal(f.state().order.effectiveEndAt, undefined); assert.equal(f.state().extensions[0].status, 'pending_payment');
  f.flags.paid = true;
  const result = await within('p1', () => f.client.payExtension(ctx('p1'), 'o1', f.state().extensions[0].id));
  assert.equal(result.extension.status, 'effective'); assert.equal(new Set(f.events.filter(e => ['funding.check', 'services.reserve'].includes(e.event)).map(e => e.tx)).size, 2, 'failed check and successful activation are separate original transactions');
});
test('new extension HTTP DTOs transform original intent and strip client prices/bindings; invalid confirmation and nested service reject', async () => {
  require('reflect-metadata'); const Module = require('node:module'), compiled = new Map();
  const dtoLoad = relative => {
    const file = path.join(root, relative); if (compiled.has(file)) return compiled.get(file).exports;
    const source = fs.readFileSync(file, 'utf8'), m = new Module(file, module); sources.set(file, createHash('sha256').update(source).digest('hex'));
    m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); compiled.set(file, m);
    const realRequire = m.require.bind(m); m.require = name => name.startsWith('.') ? dtoLoad(path.relative(root, path.resolve(path.dirname(file), name) + '.ts')) : realRequire(name);
    m._compile(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText, file); return m.exports;
  };
  const dto = dtoLoad('apps/api/src/modules/enterprise/enterprise-extension-request.dto.ts'), pipe = new common.ValidationPipe({ transform: true, whitelist: true });
  const input = change('dto-extension', 0, { orderId: 'o1', expectedOrderUpdatedAt: '2026-11-01T00:00:00Z', tenantId: 'foreign', approval: { approved: true },
    extension: { newEndAt: '2090-01-03T00:00:00Z', payableAmount: 0, services: [{ serviceId: 'service', quantity: 1, amount: 0 }] } });
  const value = await pipe.transform(input, { type: 'body', metatype: dto.RequestEnterpriseExtensionApprovalDto });
  assert.equal(value.tenantId, undefined); assert.equal(value.approval, undefined); assert.equal(value.extension.payableAmount, undefined); assert.equal(value.extension.services[0].amount, undefined);
  assert.equal(value.extension.services[0].quantity, 1);
  await assert.rejects(pipe.transform({ ...input, extension: { ...input.extension, services: [{ serviceId: 'service', quantity: 0 }] } }, { type: 'body', metatype: dto.RequestEnterpriseExtensionApprovalDto }));
  await assert.rejects(pipe.transform(change('dto-submit', 2, { approvalId: 'expense-1', confirm: false }), { type: 'body', metatype: dto.SubmitEnterpriseExtensionApprovalDto }));
  const closure = await pipe.transform(change('close-dto', 2, { originalOperationKey: 'submit-key', confirm: true, extensionId: 'injected' }), { type: 'body', metatype: dto.CloseEnterpriseExtensionExecutionDto });
  const requestClosure = await pipe.transform(change('request-close-dto', 0, { confirm: true, approvalId: 'injected', tenantId: 'foreign' }), { type: 'body', metatype: dto.CloseEnterpriseExtensionRequestDto });
  assert.equal(requestClosure.approvalId, undefined); assert.equal(requestClosure.tenantId, undefined); assert.equal(requestClosure.expectedRevision, 0);
  await assert.rejects(pipe.transform(change('request-close-dto-invalid', 1, { confirm: true }), { type: 'body', metatype: dto.CloseEnterpriseExtensionRequestDto }));
  await assert.rejects(pipe.transform(change('request-close-dto-unconfirmed', 0, { confirm: false }), { type: 'body', metatype: dto.CloseEnterpriseExtensionRequestDto }));
  const exchangeDto = dtoLoad('apps/api/src/modules/enterprise/enterprise-exchange-request.dto.ts');
  const exchangeInput = change('dto-exchange', 0, { orderId: 'o1', expectedOrderUpdatedAt: '2026-11-01T00:00:00Z', tenantId: 'foreign',
    exchange: { orderLineId: 'line1', allocationId: 'a1', replacementItemGroupId: 'new', priceBasis: 'original_order_price', payableAmount: 0, inspectionSnapshot: { customerConfirmed: true } } });
  const exchange = await pipe.transform(exchangeInput, { type: 'body', metatype: exchangeDto.RequestEnterpriseExchangeApprovalDto });
  assert.equal(exchange.tenantId, undefined); assert.equal(exchange.exchange.payableAmount, undefined); assert.equal(exchange.exchange.inspectionSnapshot, undefined);
  const choiceQuery = await pipe.transform({ allocationId: 'a1', replacementItemGroupId: 'new', workspaceId: 'foreign', includeUnavailable: true }, { type: 'query', metatype: exchangeDto.EnterpriseExchangeChoicesQueryDto });
  const confirmedExpense = await pipe.transform(change('confirm-expense-dto', 2, { confirm: true, inspectionSnapshot: { customerConfirmed: true } }), { type: 'body', metatype: exchangeDto.ConfirmEnterpriseExchangeExpenseDto });
  assert.equal(confirmedExpense.inspectionSnapshot, undefined);
  await assert.rejects(pipe.transform(change('confirm-expense-false', 2, { confirm: false }), { type: 'body', metatype: exchangeDto.ConfirmEnterpriseExchangeExpenseDto }));
  await assert.rejects(pipe.transform(change('confirm-expense-zero', 0, { confirm: true }), { type: 'body', metatype: exchangeDto.ConfirmEnterpriseExchangeExpenseDto }));
  const closedQuery = await pipe.transform(change('exchange-close', 0, { confirm: true, approvalId: 'injected' }), { type: 'body', metatype: exchangeDto.CloseEnterpriseExchangeRequestDto });
  assert.equal(closedQuery.approvalId, undefined);
  await assert.rejects(pipe.transform(change('exchange-close-false', 0, { confirm: false }), { type: 'body', metatype: exchangeDto.CloseEnterpriseExchangeRequestDto }));
  await assert.rejects(pipe.transform(change('exchange-close-revision', 1, { confirm: true }), { type: 'body', metatype: exchangeDto.CloseEnterpriseExchangeRequestDto }));
  assert.equal(choiceQuery.allocationId, 'a1'); assert.equal(choiceQuery.workspaceId, undefined); assert.equal(choiceQuery.includeUnavailable, undefined);
  await assert.rejects(pipe.transform({ allocationId: 'x'.repeat(192) }, { type: 'query', metatype: exchangeDto.EnterpriseExchangeChoicesQueryDto }));
  await assert.rejects(pipe.transform({ ...exchangeInput, exchange: { ...exchangeInput.exchange, replacementItemGroupId: 'x'.repeat(192) } }, { type: 'body', metatype: exchangeDto.RequestEnterpriseExchangeApprovalDto }));
  await assert.rejects(pipe.transform({ ...exchangeInput, exchange: { ...exchangeInput.exchange, priceBasis: 'caller_price' } }, { type: 'body', metatype: exchangeDto.RequestEnterpriseExchangeApprovalDto }));
  const decision = await pipe.transform(change('dto-decision', 1, { decision: 'approve', applicantCustomerId: 'injected' }), { type: 'body', metatype: exchangeDto.DecideEnterpriseExchangeApprovalDto });
  assert.equal(decision.applicantCustomerId, undefined);
  await assert.rejects(pipe.transform(change('dto-execute', 1, { decision: 'execute' }), { type: 'body', metatype: exchangeDto.DecideEnterpriseExchangeApprovalDto }));
  assert.equal(closure.originalOperationKey, 'submit-key'); assert.equal(closure.extensionId, undefined);
  await assert.rejects(pipe.transform(change('close-dto-invalid', 2, { originalOperationKey: 'submit-key', confirm: false }), { type: 'body', metatype: dto.CloseEnterpriseExtensionExecutionDto }));
});

test('extension route/DTO schemas and increment table reference original registered objects; new spend is gated but original payment/read is not', () => {
  const schema = load('apps/api/src/modules/enterprise/enterprise-extension-schemas.ts').ENTERPRISE_EXTENSION_SCHEMAS;
  assert.equal(schema.RequestEnterpriseExtensionApproval.additionalProperties, false); assert.equal(schema.EnterpriseExtensionInput.additionalProperties, false);
  assert.deepEqual(plain(schema.SubmitEnterpriseExtensionApproval.properties.confirm.enum), [true]);
  assert.equal(schema.EnterpriseExtensionInput.properties.payableAmount, undefined); assert.equal(schema.SubmitEnterpriseExtensionApproval.properties.approval, undefined);
  const controller = fs.readFileSync(path.join(root, 'apps/api/src/modules/enterprise/enterprise-workflows.controller.ts'), 'utf8');
  const openapi = fs.readFileSync(path.join(root, 'apps/api/src/contracts/openapi-document.ts'), 'utf8');
  for (const route of ['extension-approvals', 'extension-approvals/submit', 'extension-approvals/:id/decision', 'extension-approvals/:id/result', 'extension-approvals/:id/close-execution', 'my-extension-approvals', 'corporates/:corporateId/extension-approvals', 'orders/:orderId/extension-eligibility', 'orders/:orderId/extension-request-operations/:key', 'orders/:orderId/extension-request-operations/:key/close']) {
    assert.ok(controller.includes(`("${route}")`), route); assert.ok(openapi.includes(route.replaceAll(/:([a-zA-Z]+)/g, '{$1}')), `OpenAPI ${route}`);
  }
  const file = path.join(root, 'apps/api/src/common/api-auth.guard.ts'), source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'isNewBusinessRoute'); assert.ok(fn);
  const m = { exports: {} }; vm.runInNewContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: m.exports });
  const gate = m.exports.isNewBusinessRoute;
  assert.equal(gate('POST', '/client/v1/enterprise/extension-approvals/submit'), true); assert.equal(gate('POST', '/client/v1/enterprise/approvals/submit'), true);
  assert.equal(gate('POST', '/client/v1/orders/o1/extensions/e1/pay'), false); assert.equal(gate('POST', '/client/v1/enterprise/extension-approvals'), false);
  assert.equal(gate('GET', '/client/v1/enterprise/extension-approvals/e1/result'), false);
  assert.equal(gate('POST', '/client/v1/enterprise/extension-approvals/e1/close-execution'), false, 'closure is historical reconciliation, not new spending');
  assert.equal(gate('POST', '/client/v1/enterprise/orders/o1/extension-request-operations/request-key/close'), false);
  assert.deepEqual(plain(schema.CloseEnterpriseExtensionRequest.properties.expectedRevision.enum), [0]);
  assert.equal(schema.EnterpriseExtensionRequestOriginalResult.oneOf.length, 3);
  assert.ok(openapi.includes('closeEnterpriseExtensionRequest: "EnterpriseExtensionRequestOriginalResult"'));
  const migration = fs.readFileSync(path.join(root, 'apps/api/prisma/migrations/20261101000400_enterprise_extension_approvals/migration.sql'), 'utf8');
  assert.ok(migration.includes('REFERENCES `rental_orders` (`tenantId`,`workspaceId`,`id`)')); assert.ok(migration.includes('REFERENCES `business_workspaces`'));
  assert.ok(migration.includes('UNIQUE KEY `enterprise_extension_consumed` (`tenantId`,`workspaceId`,`extensionId`)'));
});

test('explicit original-key closure fences late submission; committed extension is only read and seal failures roll back', async () => {
  const f = fixture(), request = await f.request(); await f.approve(request.id);
  const close = instance => within('p1', () => instance.service.closeExecution(ctx('p1'), instance.state().approvals[0].id, change('close-key', 2, { originalOperationKey: 'submit-key', confirm: true })));
  const result = await close(f); assert.equal(result.approval.state, 'closed'); assert.equal(result.original.state, 'closed'); assert.equal(result.approval.closedOperationKey, 'submit-key');
  assert.equal(f.state().extensions.length, 0); assert.equal(f.state().receipts.filter(r => r.operationKey === 'submit-key').length, 1);
  await assert.rejects(f.submit(request.id)); assert.equal(f.state().extensions.length, 0); await close(f);
  const seals = f.state().receipts; f.state().receipts = seals.filter(receipt => receipt.operationKey !== 'submit-key');
  await assert.rejects(within('p1', () => f.service.result(ctx('p1'), request.id)), /结束收据/); f.state().receipts = seals;
  const committed = fixture(), r = await committed.request(); await committed.approve(r.id); await committed.submit(r.id);
  const observed = await close(committed); assert.equal(observed.original.state, 'observed'); assert.equal(committed.state().extensions.length, 1); assert.equal(committed.state().approvals[0].state, 'consumed');
  const rollback = fixture(), a = await rollback.request(); await rollback.approve(a.id); rollback.flags.failReceipt = true;
  await assert.rejects(close(rollback)); assert.equal(rollback.state().approvals[0].state, 'approved'); assert.equal(rollback.state().receipts.some(r => r.operationKey === 'submit-key'), false);
  const evidence = fixture(), b = await evidence.request(); await evidence.approve(b.id); evidence.state().idempotency.push({ action: 'order.extend', idempotencyKey: 'submit-key', requestHash: 'unknown', response: {} });
  await assert.rejects(close(evidence), /消费证据/); assert.equal(evidence.state().approvals[0].state, 'approved');
  for (const first of ['close', 'submit']) {
    const race = fixture(), r = await race.request(); await race.approve(r.id);
    const outcomes = await Promise.allSettled(first === 'close' ? [close(race), race.submit(r.id)] : [race.submit(r.id), close(race)]);
    assert.ok(outcomes.some(outcome => outcome.status === 'fulfilled'));
    assert.equal(race.state().extensions.length, first === 'close' ? 0 : 1); assert.equal(race.state().approvals[0].state, first === 'close' ? 'closed' : 'consumed');
  }
});

test('unknown request resolves only its own exact receipt and approval; absence never permits retry', async () => {
  const f = fixture();
  const read = (key = 'request-key', order = 'o1', customer = 'p1') => within(customer, () => f.service.requestOriginal(ctx(customer), order, key));
  assert.deepEqual(plain(await read()), { state: 'not_recorded', retryable: false });
  f.flags.loseAck = true; await assert.rejects(f.request(), /acknowledgement/u);
  const result = await read(); assert.equal(result.state, 'observed'); assert.equal(result.approval.id, f.state().approvals[0].id); assert.equal(result.retryable, false);
  assert.equal(f.state().approvals.length, 1); await assert.rejects(read('request-key', 'other-order')); await assert.rejects(read('request-key', 'o1', 'other-person'));
  f.state().receipts[0].result = JSON.stringify({ id: 'missing' }); await assert.rejects(read());
});

test('unknown application closure seals only the original key; committed request survives and late POST cannot recreate it', async () => {
  const close = (f, key = 'close-request', who = 'p1', order = 'o1') => within(who, () => f.service.closeRequest(ctx(who), order, 'request-key', change(key, 0, { confirm: true })));
  const f = fixture(), sealed = await close(f);
  assert.equal(sealed.state, 'closed'); assert.equal(sealed.closedOperationKey, 'request-key'); assert.equal(sealed.workspaceCode, 'vehicles');
  assert.equal(f.state().approvals.length, 0); assert.equal(f.state().receipts.length, 2);
  await close(f); await close(f, 'another-close');
  await assert.rejects(f.request()); assert.equal(f.state().approvals.length, 0);
  const original = await within('p1', () => f.service.requestOriginal(ctx('p1'), 'o1', 'request-key')); assert.equal(original.state, 'closed');
  const seal = f.state().receipts.find(r => r.operationKey === 'request-key'); seal.result = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(seal.result)).reverse()));
  assert.equal((await within('p1', () => f.service.requestOriginal(ctx('p1'), 'o1', 'request-key'))).state, 'closed', 'MySQL JSON key normalization does not invalidate named seal bindings');
  const committed = fixture(), r = await committed.request(); const observed = await close(committed);
  assert.equal(observed.state, 'observed'); assert.equal(observed.approval.id, r.id); assert.equal(committed.state().approvals[0].state, 'pending');
  await assert.rejects(close(committed, 'foreign-close', 'p2')); await assert.rejects(close(committed, 'request-key'));
  const rollback = fixture(); rollback.flags.failReceipt = true; await assert.rejects(close(rollback));
  assert.equal(rollback.state().receipts.length, 0); assert.equal(rollback.state().approvals.length, 0);
  rollback.flags.failReceipt = false; rollback.flags.failCloseReceipt = true; await assert.rejects(close(rollback));
  assert.equal(rollback.state().receipts.length, 0, 'second closure receipt failure rolls back the already inserted seal');
  f.state().receipts.find(r => r.operationKey === 'request-key').requestHash = 'corrupt';
  await assert.rejects(within('p1', () => f.service.requestOriginal(ctx('p1'), 'o1', 'request-key')), /封闭证据/);
});

test('request and original-key closure race on the actual requested order fence; closure ACK loss and late POST remain read-only', async () => {
  const close = f => within('p1', () => f.service.closeRequest(ctx('p1'), 'o1', 'request-key', change('close-request', 0, { confirm: true })));
  for (const first of ['request', 'close']) {
    const f = fixture(); let acquired, release;
    const locked = new Promise(resolve => { acquired = resolve; }), promise = new Promise(resolve => { release = resolve; });
    f.barriers.first = { acquired, promise };
    const started = first === 'request' ? f.request() : close(f);
    await locked;
    const waiting = first === 'request' ? close(f) : f.request(); release();
    const results = await Promise.allSettled([started, waiting]);
    assert.equal(results[0].status, 'fulfilled'); assert.equal(f.state().approvals.length, first === 'request' ? 1 : 0);
    assert.equal(results[1].status, first === 'request' ? 'fulfilled' : 'rejected');
    assert.equal(f.state().receipts.filter(r => r.operationKey === 'request-key').length, 1);
  }
  const lost = fixture(); lost.flags.loseAck = true; await assert.rejects(close(lost), /acknowledgement/u);
  const result = await within('p1', () => lost.service.requestOriginal(ctx('p1'), 'o1', 'request-key')); assert.equal(result.state, 'closed');
  assert.equal(lost.state().receipts.length, 2); await assert.rejects(lost.request()); assert.equal(lost.state().approvals.length, 0);
  for (const mutate of [payload => { payload.workspaceId = 'other-space'; }, payload => { payload.orderId = 'other-order'; }, payload => { payload.applicantCustomerId = 'other-person'; }]) {
    const f = fixture(); await close(f); const seal = f.state().receipts.find(r => r.operationKey === 'request-key'), payload = JSON.parse(seal.result); mutate(payload); seal.result = JSON.stringify(payload);
    await assert.rejects(within('p1', () => f.service.requestOriginal(ctx('p1'), 'o1', 'request-key')), /封闭证据/u);
  }
});

test('shared original exchange preview preserves original pricing and candidate gates without applying or collecting', async () => {
  const { RentalExchangePreviewService } = load('apps/api/src/modules/rental-core/rental-exchange-preview.service.ts');
  const order = { id: 'o1', tenantId: 't1', updatedAt: 'r1', status: shared.RentalCoreOrderStatus.Renting, fulfillmentLocationId: 'l1', customerType: 'corporate', finalPayableAmount: 100,
    lines: [{ id: 'line1', itemGroupId: 'old', itemGroupName: 'Original', quantity: 1, inventoryMode: 'serialized' }], allocations: [{ id: 'a1', orderLineId: 'line1', status: 'picked_up', quantity: 1 }] };
  const groups = [{ id: 'new', name: 'Replacement', status: 'enabled', inventoryMode: 'serialized' }], calls = [], basis = { effectiveFrom: 'now', source: 'original' };
  const core = { lockOrderForUpdate: async (_tenant, _id, tx) => { assert.ok(tx); calls.push('lock'); return order; }, getProfile: () => ({}), getWorkspaceCategory: async () => ({}),
    getBusinessSettings: () => ({}), listItemGroups: () => groups, listPricingGroups: () => [], listCouponTemplates: () => [], listLocations: () => [], listOperators: () => [], listOrderExtensions: async () => [] };
  const business = { quotePostPickupExchange: async (_tenant, _ctx, input) => { calls.push('price'); assert.equal(input.orderLineId, 'line1'); return { originalAmount: 100, replacementAmount: 140,
    priced: { depositDelta: 10, preAuthDelta: 0, currency: 'CNY', priceVersion: 'original-v1', pricingSnapshot: { recalculatedPayableAmount: 140 } } }; }, captureExchangeExecutionBasis: async () => basis };
  let available = true;
  const allocation = { exchangeAssetCandidates: async () => [{ assetId: 'asset-new', assetNo: 'A1', available }] }, prisma = { $transaction: fn => fn({ tx: true }) };
  const service = new RentalExchangePreviewService(core, business, allocation, prisma), intent = { orderLineId: 'line1', allocationId: 'a1', replacementItemGroupId: 'new', replacementAssetId: 'asset-new' };
  const result = await service.preview('t1', 'o1', intent); assert.equal(result.preview.additionalAmount, 40); assert.equal(result.preview.depositDelta, 10);
  assert.equal(result.preview.exchange.executionBasis, basis); assert.equal(result.preview.exchange.priceBasis, 'original_order_price'); assert.deepEqual(calls, ['lock', 'price']);
  const choices = await service.choices('t1', order, { allocationId: 'a1', replacementItemGroupId: 'new' }, new Set(['new']), { tx: true });
  assert.equal(choices.lines[0].itemGroupName, 'Original'); assert.equal(choices.replacements[0].name, 'Replacement'); assert.equal(choices.assets[0].assetId, 'asset-new');
  assert.equal(choices.assets[0].reason, undefined); assert.equal(choices.replacements[0].tenantId, undefined);
  await assert.rejects(service.choices('t1', order, { allocationId: 'a1', replacementItemGroupId: 'new' }, new Set(), { tx: true }), /范围/u);
  await assert.rejects(service.choices('t1', order, { allocationId: 'other' }, new Set(['new']), { tx: true }), /已领取/u);
  available = false; assert.equal((await service.choices('t1', order, { allocationId: 'a1', replacementItemGroupId: 'new' }, new Set(['new']), { tx: true })).assets.length, 0);
  available = false; await assert.rejects(service.preview('t1', 'o1', intent), /不可用/); available = true;
  order.allocations[0].status = 'returned'; await assert.rejects(service.preview('t1', 'o1', intent), /已归还/);
});

test('exchange waiting on the order fence rechecks current customer session before committing', async () => {
  const f = exchangeFixture(); let release, acquired;
  const gate = new Promise(resolve => { release = resolve; }), held = new Promise(resolve => { acquired = resolve; });
  f.barriers.first = { acquired, promise: gate };
  const request = f.request(); await held; f.flags.active = false; release();
  await assert.rejects(request, /会员/u); assert.equal(f.state().exchangeApprovals.length, 0); assert.equal(f.state().receipts.length, 0);
});

function exchangeFixture() {
  const f = fixture(), { EnterpriseExchangeApprovalService } = load('apps/api/src/modules/enterprise/enterprise-exchange-approval.service.ts');
  const intent = { orderLineId: 'line1', allocationId: 'a1', replacementItemGroupId: 'new', priceBasis: 'original_order_price' };
  const pricing = { method: 'original_version_difference', context: { timeZone: 'Asia/Shanghai', calendars: [] }, previousPayableAmount: 100, recalculatedPayableAmount: 140,
    fullChargeLines: [{ amount: 140, detail: 'Private exchange evidence' }], chargeLines: [], discountEvaluations: [], totalBillableUnits: 1, differenceAmount: 40 };
  const preview = { orderId: 'o1', type: 'post_pickup_exchange', expectedUpdatedAt: f.state().order.updatedAt, beforePayableAmount: 100, recalculatedPayableAmount: 140,
    differenceAmount: 40, additionalAmount: 40, refundAmount: 0, depositDelta: 10, preAuthDelta: 0, currency: 'CNY', pricingSnapshot: copy(pricing),
    exchange: { ...intent, originalItemGroupId: 'old', originalItemGroupName: 'Original', replacementItemGroupName: 'Replacement', originalAmount: 100, replacementAmount: 140,
      inspectionSnapshot: { customerConfirmed: false }, executionBasis: { effectiveFrom: '2026-11-03T00:00:00Z', categoryCode: 'vehicle', categoryVersionId: 'v1',
        ruleSnapshot: { version: 'r1' }, rateSnapshot: [{ baseAmount: 140 }], calendarSnapshot: [], inspectionTemplateSnapshots: [], pricingSnapshot: copy(pricing) } } };
  const prices = { preview: async () => { if (!f.flags.available) throw new Error('exchange stock unavailable'); f.events.push({ event: 'exchange.price' }); return { order: copy(f.state().order), preview: copy(preview) }; } };
  const service = new EnterpriseExchangeApprovalService(f.prisma, f.service.commands, f.policiesApi, f.access, f.core, prices, { catalog: async () => ({ items: [{ id: 'new' }] }) });
  const input = change('exchange-request', 0, { orderId: 'o1', expectedOrderUpdatedAt: f.state().order.updatedAt, exchange: intent });
  const request = () => within('p1', () => service.request(ctx('p1'), input));
  const decide = (id, decision = 'approve', revision = 1, actor = 'reviewer') => within(actor, () => service.decide(ctx(actor), id, change(`exchange-${decision}`, revision, { decision })));
  return { ...f, service, preview, input, request, decide };
}
test('exchange request and non-self review persist expense-only receipts; original projection does not expose pricing evidence', async () => {
  const f = exchangeFixture(), result = await f.request();
  await assert.rejects(f.decide(result.id, 'approve', 1, 'p1'), /自审/u);
  const row = f.state().exchangeApprovals[0];
  for (const field of ['request', 'preview', 'basis']) row[field] = Object.fromEntries(Object.entries(JSON.parse(row[field])).reverse());
  f.preview.exchange.executionBasis.effectiveFrom = '2026-11-03T00:01:00Z';
  await f.decide(result.id); assert.equal(row.state, 'pending', 'the transaction replaces the old snapshot');
  assert.equal(f.state().exchangeApprovals[0].state, 'approved'); assert.equal(f.state().exchangeApprovals[0].revision, 2);
  const original = await within('p1', () => f.service.original(ctx('p1'), result.id));
  assert.equal(original.execution, 'original_merchant_execution_not_connected'); assert.equal(original.preview.additionalAmount, 40);
  assert.equal(JSON.stringify(original).includes('Private exchange evidence'), false); assert.equal(original.basis, undefined);
  await assert.rejects(within('other', () => f.service.original(ctx('other'), result.id)));
  await assert.rejects(within('p1', () => f.service.original({ ...ctx('p1'), workspaceId: 'w2' }, result.id)));
  await f.decide(result.id, 'withdraw', 2, 'p1'); assert.equal(f.state().exchangeApprovals[0].state, 'withdrawn');
  assert.equal(f.state().extensions.length, 0); assert.equal(f.state().idempotency.length, 0); assert.equal(f.state().order.finalPayableAmount, 100);
  assert.equal(f.events.some(e => e.event === 'credit.reserve'), false);
});
test('exchange review rejects changed revision, scope, policy, stock and full pricing/config evidence even with identical totals', async () => {
  for (const mutation of ['revision', 'company', 'member', 'reviewer', 'stock', 'expiry', 'request', 'price-context', 'basis-price', 'rules']) {
    const f = exchangeFixture(), result = await f.request();
    if (mutation === 'revision') f.state().order.updatedAt = '2026-11-02T00:00:00Z';
    if (mutation === 'company') f.state().order.membershipSnapshot.corporateCustomerId = 'other-company';
    if (['member', 'reviewer'].includes(mutation)) f.flags[mutation] = false;
    if (mutation === 'stock') f.flags.available = false;
    if (mutation === 'expiry') f.state().exchangeApprovals[0].expiresAt = new Date(0);
    if (mutation === 'request') f.state().exchangeApprovals[0].requestFingerprint = 'corrupted';
    if (mutation === 'price-context') f.preview.pricingSnapshot.context.timeZone = 'UTC';
    if (mutation === 'basis-price') f.preview.exchange.executionBasis.pricingSnapshot.fullChargeLines[0].amount = 145;
    if (mutation === 'rules') f.preview.exchange.executionBasis.ruleSnapshot.version = 'r2';
    await assert.rejects(f.decide(result.id), mutation); assert.equal(f.state().exchangeApprovals[0].state, 'pending', mutation);
  }
  const f = exchangeFixture(), r = await f.request(); f.policies[1].revision++;
  await assert.rejects(f.decide(r.id), /政策/u);
  await assert.rejects(within('p1', () => f.service.request({ ...ctx('p1'), workspaceId: 'w2' }, { ...f.input, operationKey: 'foreign-space' })));
  const rejected = exchangeFixture(), second = await rejected.request(); await rejected.decide(second.id, 'reject');
  assert.equal(rejected.state().exchangeApprovals[0].state, 'rejected');
});
test('exchange duplicate original key, ACK loss and receipt failure never create a second request or false review', async () => {
  const f = exchangeFixture(); f.flags.loseAck = true; await assert.rejects(f.request(), /acknowledgement/u);
  assert.equal(f.state().exchangeApprovals.length, 1); const original = f.state().exchangeApprovals[0];
  assert.equal((await within('p1', () => f.service.original(ctx('p1'), original.id))).id, original.id);
  await f.request(); assert.equal(f.state().exchangeApprovals.length, 1);
  await assert.rejects(within('p1', () => f.service.request(ctx('p1'), { ...f.input, operationKey: 'new-key' })), /已有/u);
  f.flags.failReceipt = true; await assert.rejects(f.decide(original.id), /receipt/u); assert.equal(f.state().exchangeApprovals[0].state, 'pending');
  const failed = exchangeFixture(); failed.flags.failReceipt = true; await assert.rejects(failed.request(), /receipt/u);
  assert.equal(failed.state().exchangeApprovals.length, 0); assert.equal(failed.state().receipts.length, 0);
  const missing = exchangeFixture(); missing.preview.additionalAmount = 0; await assert.rejects(missing.request(), /新增/u);
});

test('order exchange history stays applicant/workspace/order scoped after spending grants change and performs no new spending', async () => {
  const f = exchangeFixture(), request = await f.request(); let ownerAvailable = true, reads = 0;
  f.service.clientApi.getOrder = async (context, id) => {
    reads++;
    if (!ownerAvailable || context.customerId !== 'p1' || context.workspaceId !== 'w1' || id !== 'o1') throw new common.NotFoundException('original owner unavailable');
    return { id: 'o1' };
  };
  const row = f.state().exchangeApprovals[0];
  f.state().exchangeApprovals.push({ ...copy(row), id: 'other-order', orderId: 'o2' }, { ...copy(row), id: 'other-applicant', applicantCustomerId: 'p2' }, { ...copy(row), id: 'other-workspace', workspaceId: 'w2' });
  f.flags.member = false; f.flags.available = false; f.policies[1].revision++;
  const beforeReceipts = f.state().receipts.length, beforePrices = f.events.filter(e => e.event === 'exchange.price').length;
  const result = await within('p1', () => f.service.orderApprovals(ctx('p1'), 'o1'));
  assert.equal(result.length, 1); assert.equal(result[0].id, request.id); assert.equal(reads, 2);
  assert.equal(JSON.stringify(result).includes('Private exchange evidence'), false);
  assert.equal(f.state().receipts.length, beforeReceipts); assert.equal(f.events.filter(e => e.event === 'exchange.price').length, beforePrices);
  await assert.rejects(within('other', () => f.service.orderApprovals(ctx('other'), 'o1')));
  await assert.rejects(within('p1', () => f.service.orderApprovals({ ...ctx('p1'), workspaceId: 'w2' }, 'o1')));
  ownerAvailable = false; await assert.rejects(within('p1', () => f.service.orderApprovals(ctx('p1'), 'o1')));
  ownerAvailable = true; f.state().exchangeApprovals = Array.from({ length: 201 }, (_, i) => ({ ...copy(row), id: `own-${i}` }));
  await assert.rejects(within('p1', () => f.service.orderApprovals(ctx('p1'), 'o1')), /有界/u);
});

test('exchange shared schema/routes expose expense review only, with exact input bounds and registered task links', () => {
  const schemas = load('apps/api/src/modules/enterprise/enterprise-exchange-schemas.ts').ENTERPRISE_EXCHANGE_SCHEMAS;
  assert.equal(schemas.EnterpriseExchangeIntent.additionalProperties, false);
  assert.equal(schemas.EnterpriseExchangeIntent.properties.replacementItemGroupId.maxLength, 191);
  assert.equal(schemas.EnterpriseExchangeIntent.properties.inspectionSnapshot, undefined);
  assert.deepEqual(plain(schemas.RequestEnterpriseExchangeApproval.properties.expectedRevision.enum), [0]);
  assert.equal(schemas.EnterpriseExchangeApprovalView.properties.preview.additionalProperties, false);
  const controller = fs.readFileSync(path.join(root, 'apps/api/src/modules/enterprise/enterprise-workflows.controller.ts'), 'utf8');
  const openapi = fs.readFileSync(path.join(root, 'apps/api/src/contracts/openapi-document.ts'), 'utf8');
  for (const route of ['orders/:orderId/exchange-request-operations/:key', 'orders/:orderId/exchange-request-operations/:key/close', 'orders/:orderId/exchange-choices', 'orders/:orderId/exchange-approvals', 'my-exchange-approvals', 'corporates/:corporateId/exchange-approvals', 'exchange-approvals', 'exchange-approvals/:id', 'exchange-approvals/:id/expense-confirmation', 'exchange-approvals/:id/decision']) {
    assert.ok(controller.includes(`("${route}")`), route); assert.ok(openapi.includes(route.replaceAll(/:([a-zA-Z]+)/g, '{$1}')), route);
  }
  const tasks = load('apps/api/src/modules/enterprise/enterprise-workflow-schemas.ts').ENTERPRISE_WORKFLOW_SCHEMAS.EnterpriseTaskItem;
  assert.ok(tasks.properties.kind.enum.includes('exchange_approval')); assert.ok(tasks.properties.page.enum.includes('exchange-approvals'));
});

test('exchange choices reuse original whole-line allocation, expose only available assets, and never allocate or create an expense', async () => {
  const f = exchangeFixture(), { RentalExchangePreviewService } = load('apps/api/src/modules/rental-core/rental-exchange-preview.service.ts');
  const order = f.state().order; order.orderNo = 'Order 1'; order.fulfillmentLocationId = 'l1';
  order.lines = [{ id: 'line1', itemGroupId: 'old', itemGroupName: 'Original', quantity: 1, inventoryMode: 'serialized' }];
  order.allocations = [{ id: 'a1', orderLineId: 'line1', quantity: 1, status: 'picked_up', assetNo: 'Original asset' }];
  const groups = [{ id: 'new', name: 'Replacement', status: 'enabled', inventoryMode: 'serialized' }, { id: 'hidden', name: 'Hidden', status: 'enabled', inventoryMode: 'serialized' }];
  f.core.listItemGroups = () => groups; f.core.listPricingGroups = () => [{ id: 'price1', name: 'Public price group', status: 'enabled', memberItemGroupIds: ['new'] }];
  const prices = new RentalExchangePreviewService(f.core, {}, { exchangeAssetCandidates: async () => [
    { assetId: 'free', assetNo: 'Free asset', available: true }, { assetId: 'occupied', assetNo: 'Private occupied asset', available: false, reason: 'Another customer' }
  ] }, f.prisma);
  const service = new (load('apps/api/src/modules/enterprise/enterprise-exchange-approval.service.ts').EnterpriseExchangeApprovalService)(f.prisma, f.service.commands, f.policiesApi, f.access, f.core, prices, { catalog: async () => ({ items: [{ id: 'new' }] }) });
  const read = query => within('p1', () => service.choices(ctx('p1'), 'o1', query));
  const currentOrder = () => f.state().order;
  const initial = await read({}); assert.equal(initial.lines[0].allocationId, 'a1'); assert.equal(initial.replacements.length, 0);
  const selected = await read({ allocationId: 'a1', replacementItemGroupId: 'new' });
  assert.deepEqual(plain(selected.assets), [{ assetId: 'free', assetNo: 'Free asset' }]); assert.equal(selected.replacements.length, 1);
  assert.equal(selected.reservation, 'not_reserved'); assert.equal(selected.expectedOrderUpdatedAt, order.updatedAt);
  assert.equal(JSON.stringify(selected).includes('Another customer'), false); assert.equal(JSON.stringify(selected).includes('hidden'), false);
  await assert.rejects(within('other', () => service.choices(ctx('other'), 'o1', {})));
  await assert.rejects(within('p1', () => service.choices({ ...ctx('p1'), workspaceId: 'w2' }, 'o1', {})));
  await assert.rejects(read({ allocationId: 'a1', replacementItemGroupId: 'hidden' }));
  currentOrder().allocations[0].quantity = 0.5; await assert.rejects(read({ allocationId: 'a1' }));
  assert.equal(f.state().receipts.length, 0); assert.equal(f.state().exchangeApprovals.length, 0);
});

test('exchange original request close seals its own key atomically and never reprices, withdraws or applies an exchange', async () => {
  const close = (f, key = 'exchange-request', closure = 'close-request') => within('p1', () => f.service.closeRequest(ctx('p1'), 'o1', key, change(closure, 0, { confirm: true })));
  const f = exchangeFixture(); f.flags.member = false; f.flags.available = false;
  const result = await close(f); assert.equal(result.state, 'closed'); assert.equal(result.closedOperationKey, 'exchange-request');
  assert.equal(f.state().exchangeApprovals.length, 0); assert.equal(f.events.some(e => e.event === 'exchange.price'), false);
  f.flags.member = true; f.flags.available = true; await assert.rejects(f.request(), /操作键/u);
  assert.equal(f.state().exchangeApprovals.length, 0); assert.equal(f.state().receipts.length, 2);
  const seal = f.state().receipts.find(row => row.operationKey === 'exchange-request');
  seal.result = Object.fromEntries(Object.entries(JSON.parse(seal.result)).reverse());
  assert.equal((await within('p1', () => f.service.requestOriginal(ctx('p1'), 'o1', 'exchange-request'))).state, 'closed');
  await close(f); assert.equal(f.state().receipts.length, 2);
  await assert.rejects(within('other', () => f.service.requestOriginal(ctx('other'), 'o1', 'exchange-request')));
  await assert.rejects(within('p1', () => f.service.requestOriginal(ctx('p1'), 'other-order', 'exchange-request')));
  const committed = exchangeFixture(), request = await committed.request();
  const observed = await close(committed); assert.equal(observed.state, 'observed'); assert.equal(observed.approval.id, request.id);
  assert.equal(committed.state().exchangeApprovals[0].state, 'pending');
  const failed = exchangeFixture(); failed.flags.failCloseReceipt = true; await assert.rejects(close(failed), /receipt/u);
  assert.equal(failed.state().receipts.length, 0); assert.equal((await failed.request()).state, 'pending');
  const lost = exchangeFixture(); lost.flags.loseAck = true; await assert.rejects(close(lost), /acknowledgement/u);
  assert.equal((await within('p1', () => lost.service.requestOriginal(ctx('p1'), 'o1', 'exchange-request'))).state, 'closed');
  assert.equal(lost.state().receipts.length, 2); await assert.rejects(lost.request());
  for (const field of ['workspaceId', 'workspaceCode', 'orderId', 'applicantCustomerId', 'closedOperationKey']) {
    const damaged = exchangeFixture(); await close(damaged); const row = damaged.state().receipts.find(r => r.operationKey === 'exchange-request');
    const payload = JSON.parse(row.result); payload[field] = 'wrong'; row.result = JSON.stringify(payload);
    await assert.rejects(within('p1', () => damaged.service.requestOriginal(ctx('p1'), 'o1', 'exchange-request')), /证据/u);
  }
});
test('exchange request and permanent closure serialize both lock orders without guessing unknown commit', async () => {
  for (const first of ['request', 'close']) {
    const f = exchangeFixture(); let release, acquired;
    const gate = new Promise(resolve => { release = resolve; }), held = new Promise(resolve => { acquired = resolve; });
    f.barriers.first = { acquired, promise: gate };
    const close = () => within('p1', () => f.service.closeRequest(ctx('p1'), 'o1', 'exchange-request', change('close-request', 0, { confirm: true })));
    const early = first === 'request' ? f.request() : close(); await held;
    const late = first === 'request' ? close() : f.request(); const outcomes = Promise.allSettled([early, late]); release(); const results = await outcomes;
    assert.equal(results[0].status, 'fulfilled');
    if (first === 'request') { assert.equal(results[1].status, 'fulfilled'); assert.equal(results[1].value.state, 'observed'); assert.equal(f.state().exchangeApprovals.length, 1); }
    else { assert.equal(results[1].status, 'rejected'); assert.equal(f.state().exchangeApprovals.length, 0); }
  }
});

test('applicant expense confirmation is single-use durable consent, never inspection, inventory, payment or approval consumption', async () => {
  const f = exchangeFixture(), r = await f.request(); await f.decide(r.id);
  const input = change('expense-confirm', 2, { confirm: true });
  const confirm = () => within('p1', () => f.service.confirmExpense(ctx('p1'), r.id, input));
  await assert.rejects(within('reviewer', () => f.service.confirmExpense(ctx('reviewer'), r.id, input)), /本人/u);
  await assert.rejects(within('p1', () => f.service.confirmExpense(ctx('p1'), r.id, { ...input, confirm: false })), /确认/u);
  f.flags.loseAck = true; await assert.rejects(confirm(), /acknowledgement/u);
  const row = f.state().exchangeApprovals[0]; assert.equal(row.state, 'approved'); assert.equal(row.revision, 3);
  const original = await within('p1', () => f.service.confirmationOriginal(ctx('p1'), r.id));
  assert.equal(original.original.operationKey, input.operationKey); assert.equal(original.approval.employeeConfirmation.scope, 'expense_only_not_inspection_or_execution');
  await confirm(); assert.equal(f.state().exchangeApprovals[0].revision, 3);
  await assert.rejects(within('p1', () => f.service.confirmExpense(ctx('p1'), r.id, change('second-confirm', 3, { confirm: true }))));
  assert.equal(f.state().extensions.length, 0); assert.equal(f.state().idempotency.length, 0); assert.equal(f.state().order.finalPayableAmount, 100);
  assert.equal(f.events.some(e => e.event === 'credit.reserve'), false);
  const receipt = f.state().receipts.find(row => row.operationKey === input.operationKey), value = JSON.parse(receipt.result); value.scope = 'inspection_confirmed'; receipt.result = JSON.stringify(value);
  await assert.rejects(within('p1', () => f.service.confirmationOriginal(ctx('p1'), r.id)), /收据/u);
  // Consent and withdrawal use the same original order fence and reviewed revision.
  // Whichever commits first must leave the other stale, not silently reconfirm it.
  for (const first of ['confirm', 'withdraw']) {
    const race = exchangeFixture(), request = await race.request(); await race.decide(request.id);
    let release, acquired;
    const gate = new Promise(resolve => { release = resolve; }), held = new Promise(resolve => { acquired = resolve; });
    race.barriers.first = { acquired, promise: gate };
    const consent = () => within('p1', () => race.service.confirmExpense(ctx('p1'), request.id, change('race-confirm', 2, { confirm: true })));
    const withdraw = () => within('p1', () => race.service.decide(ctx('p1'), request.id, change('race-withdraw', 2, { decision: 'withdraw' })));
    const early = first === 'confirm' ? consent() : withdraw(); await held;
    const late = first === 'confirm' ? withdraw() : consent(); const pending = Promise.allSettled([early, late]); release();
    const outcomes = await pending; assert.equal(outcomes[0].status, 'fulfilled'); assert.equal(outcomes[1].status, 'rejected');
    const originalRow = race.state().exchangeApprovals[0]; assert.equal(originalRow.revision, 3);
    assert.equal(originalRow.state, first === 'confirm' ? 'approved' : 'withdrawn');
    assert.equal(originalRow.employeeConfirmationOperationKey, first === 'confirm' ? 'race-confirm' : undefined);
    assert.equal(race.state().receipts.filter(receipt => ['race-confirm', 'race-withdraw'].includes(receipt.operationKey)).length, 1);
  }
});
test('expense confirmation refuses stale price, stock, policy, expired approval and revoked reviewer; receipt failure rolls consent back', async () => {
  for (const variant of ['revision', 'price', 'stock', 'policy', 'expiry', 'reviewer', 'receipt']) {
    const f = exchangeFixture(), r = await f.request(); await f.decide(r.id);
    if (variant === 'revision') f.state().order.updatedAt = '2026-11-04T00:00:00Z';
    if (variant === 'price') f.preview.pricingSnapshot.context.timeZone = 'UTC';
    if (variant === 'stock') f.flags.available = false;
    if (variant === 'policy') f.policies[1].revision++;
    if (variant === 'expiry') f.state().exchangeApprovals[0].expiresAt = new Date(0);
    if (variant === 'reviewer') f.flags.reviewer = false;
    if (variant === 'receipt') f.flags.failReceipt = true;
    await assert.rejects(within('p1', () => f.service.confirmExpense(ctx('p1'), r.id, change('confirm', 2, { confirm: true }))), variant);
    assert.equal(f.state().exchangeApprovals[0].employeeConfirmationOperationKey, undefined, variant); assert.equal(f.state().exchangeApprovals[0].revision, 2, variant);
  }
});

function inspectionPreparationFixture() {
  const { RentalExchangeInspectionPreparationService } = load('apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.service.ts');
  const f = { rows: [], receipts: [], authority: true, failReceipt: false, invalidOrder: false, stock: true, lock: true, orderReads: 0, pricingReads: 0 };
  const user = { id: 'operator', tenantId: 't1', isActive: true, isSaasAdmin: false, isPlatformAdmin: false, permissions: ['rental-os:order:operate'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } };
  const order = { id: 'o1', tenantId: 't1', status: 'renting', updatedAt: '2026-11-04T00:00:00.000Z', ruleSnapshot: { fulfillment: { evidenceRequired: false } },
    fulfillmentLocationId: 'location', finalPayableAmount: 100, allocations: [{ id: 'allocation', orderLineId: 'line', status: 'picked_up' }] };
  const template = (id, stage) => ({ id, tenantId: 't1', categoryCode: 'vehicle', code: id, name: id, stage, version: 'v1', enabled: true,
    fields: [{ code: 'ok', label: 'Condition', type: 'boolean', required: true }, { code: 'reading', label: 'Reading', type: 'number', required: true, usageMetric: true }, { code: 'choice', label: 'Choice', type: 'select', options: ['good', 'bad'], required: true }] });
  order.categoryCode = 'vehicle'; f.originalTemplate = template('old-template', 'return');
  f.basis = { categoryCode: 'vehicle', effectiveFrom: '2026-11-04T00:00:00Z', priceBasis: 'original_order_price', rateSnapshot: [], ruleSnapshot: { fulfillment: { evidenceRequired: false } }, calendarSnapshot: [], pricingStrategies: [], inspectionTemplateSnapshots: [template('new-template', 'pickup')] };
  const exchange = { orderLineId: 'line', allocationId: 'allocation', replacementItemGroupId: 'new', replacementAssetId: 'asset', priceBasis: 'original_order_price', originalDisposition: 'return_to_warehouse' };
  let tail = Promise.resolve();
  const prisma = { async $transaction(fn) {
    const wait = tail; let release; tail = new Promise(resolve => { release = resolve; }); await wait;
    const rows = copy(f.rows), receipts = copy(f.receipts); const tx = {
      async $queryRaw(query, ...args) {
        const { sql, values: v } = sqlArgs(query, args);
        if (sql.includes('FROM Tenant')) return [{ id: 't1' }];
        if (sql.includes('rental_exchange_inspection_preparations')) return copy(rows.filter(row => row.tenantId === v[0] && row.workspaceId === v[1] && row.actorUserId === v[2]
          && (sql.includes('AND operationKey=') ? row.operationKey === v[3] : row.orderId === v[3] && row.id === v[4])));
        throw new Error(sql);
      },
      async $executeRaw(query, ...args) {
        const { sql, values: v } = sqlArgs(query, args); assert.ok(sql.includes('INSERT INTO rental_exchange_inspection_preparations'));
        const names = ['tenantId', 'workspaceId', 'id', 'orderId', 'actorUserId', 'operationKey', 'requestHash', 'payloadHash', 'payload'];
        assert.equal(rows.some(row => row.actorUserId === v[4] && row.operationKey === v[5]), false); rows.push(Object.fromEntries(names.map((name, i) => [name, v[i]]))); return 1;
      }, rows, receipts };
    try { const result = await fn(tx); f.rows = rows; f.receipts = receipts; return result; } finally { release(); }
  } };
  const core = { async lockOrderForUpdate() { f.orderReads++; if (!f.lock) throw new common.ConflictException('operation token expired'); if (f.invalidOrder) throw new common.NotFoundException('outside original workspace/dataScope'); return copy(order); },
    listInspectionTemplates: async () => [copy(f.originalTemplate)] };
  const prices = { preview: async () => { f.pricingReads++; if (!f.stock) throw new common.ConflictException('stock unavailable'); return { order: copy(order), preview: { exchange: { executionBasis: copy(f.basis) } } }; } };
  const idem = Object.create(RentalIdempotentActionService.prototype);
  idem.idempotency = { find: async (_tenant, _action, key, tx) => tx.receipts.find(row => row.key === key), record: async (row, tx) => { if (f.failReceipt) throw new Error('receipt failed'); tx.receipts.push(row); } };
  const auth = { resolveAccessContext: async () => f.authority ? { workspaceId: 'w1', workspaceValid: true, user } : undefined };
  f.service = new RentalExchangeInspectionPreparationService(prisma, core, prices, idem, auth); f.user = user; f.order = order; f.prisma = prisma;
  f.within = fn => identity.runWithRequestIdentity({ tenantId: 't1', workspaceId: 'w1', userId: 'operator', isSaasAdmin: false, dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }, fn);
  f.requirements = () => f.within(() => f.service.requirements('operator-token-double', user, 'o1', { expectedOrderUpdatedAt: order.updatedAt, exchange }));
  f.input = async () => { const req = await f.requirements(); return { operationKey: 'inspection-key', expectedRevision: 0, reason: 'Original inspected facts', expectedOrderUpdatedAt: req.expectedOrderUpdatedAt, exchange: copy(exchange), requirementsHash: req.requirementsHash,
    inspections: req.templates.map(row => ({ side: row.side, templateId: row.template.id, templateVersion: row.template.version, results: { ok: false, reading: '0', choice: 'good' } })) }; };
  f.prepare = input => f.within(() => f.service.prepare('operator-token-double', user, 'o1', input));
  f.original = key => f.within(() => f.service.original('operator-token-double', user, 'o1', key)); return f;
}
test('pre-execution inspection preparation commits original durable K with rental receipt, normalizes facts and never performs fulfillment or expense', async () => {
  const f = inspectionPreparationFixture(), input = await f.input(), before = copy(f.order);
  const first = await f.prepare(input); assert.equal(first.state, 'prepared'); assert.equal(first.customerConsent, 'not_connected'); assert.equal(first.execution, 'not_connected');
  assert.equal(first.inspections[0].results.reading, 0); assert.equal(first.inspections[0].results.ok, false); assert.deepEqual(f.order, before);
  assert.equal(f.rows.length, 1); assert.equal(f.receipts.length, 1); assert.deepEqual(first.executionBasis, f.basis);
  const [a, b] = await Promise.all([f.prepare(input), f.prepare(input)]); assert.equal(a.id, first.id); assert.equal(b.id, first.id); assert.equal(f.rows.length, 1);
  await assert.rejects(f.prepare({ ...input, reason: 'Different intent' }), /不同/u); assert.equal(f.rows.length, 1);
  f.receipts = []; f.stock = false; f.order.updatedAt = 'changed'; const reads = f.pricingReads;
  assert.equal((await f.prepare(input)).id, first.id); assert.equal(f.pricingReads, reads, 'original key does not renew price or inspect again');
  const observed = await f.original(input.operationKey); assert.equal(observed.preparation.id, first.id); assert.equal(observed.retryable, false);
  assert.deepEqual(plain(await f.original('missing')), { state: 'not_recorded', retryable: false });
  f.rows[0].payloadHash = 'wrong'; await assert.rejects(f.original(input.operationKey), /证据/u);
});
test('inspection preparation rejects stale orders, revoked operators, unsafe facts/media and rolls back failed receipt', async () => {
  for (const variant of ['revision', 'hash', 'authority', 'lock', 'scope', 'stock', 'receipt', 'field', 'type', 'option', 'missing', 'photo', 'evidence', 'money', 'confirmation', 'duplicate', 'carrier']) {
    const f = inspectionPreparationFixture(), input = await f.input();
    if (variant === 'revision') f.order.updatedAt = 'changed';
    if (variant === 'hash') input.requirementsHash = '0'.repeat(64);
    if (variant === 'authority') f.authority = false;
    if (variant === 'lock') f.lock = false;
    if (variant === 'scope') f.invalidOrder = true;
    if (variant === 'stock') f.stock = false;
    if (variant === 'receipt') f.failReceipt = true;
    if (variant === 'field') input.inspections[0].results.extra = true;
    if (variant === 'type') input.inspections[0].results.ok = {};
    if (variant === 'option') input.inspections[0].results.choice = 'not-in-template';
    if (variant === 'missing') delete input.inspections[0].results.ok;
    if (variant === 'photo') f.originalTemplate.fields.push({ code: 'photo', label: 'Photo', type: 'photo', required: true });
    if (variant === 'evidence') f.order.ruleSnapshot.fulfillment.evidenceRequired = true;
    if (variant === 'money') input.exceptions = [{ code: 'damage', description: 'Damaged', allocationId: 'allocation', chargeAmount: 100 }];
    if (variant === 'confirmation') input.customerConfirmed = true;
    if (variant === 'carrier') f.order.fulfillmentMode = 'carrier_shipping';
    if (variant === 'duplicate') input.inspections[1] = copy(input.inspections[0]);
    await assert.rejects(f.prepare(input), variant); assert.equal(f.rows.length, 0, variant); assert.equal(f.receipts.length, 0, variant);
  }
  const f = inspectionPreparationFixture(), input = await f.input(); f.user.permissions = [];
  await assert.rejects(f.prepare(input), /权限/u); assert.equal(f.rows.length, 0);
  f.user.permissions = ['rental-os:order:operate']; f.user.locationScope = { mode: 'selected', locationIds: ['another'] };
  await assert.rejects(f.prepare(input), /范围/u); assert.equal(f.rows.length, 0);
});

test('inspection preparation DTO and registered schemas never accept execution, customer consent, money or media fields', async () => {
  require('reflect-metadata');
  require('ts-node').register({ transpileOnly: true, compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true, module: 'commonjs', moduleResolution: 'node' } });
  const { PrepareRentalExchangeInspectionDto } = require('../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.dto');
  const pipe = new common.ValidationPipe({ transform: true, whitelist: true });
  const { CreateRentalExchangeInspectionMediaDto } = require('../apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.dto');
  const image = await exchangeImageFixture().mediaInput();
  const imageDto = await pipe.transform({ ...image, tenantId:'foreign', metadata:{workspaceId:'foreign'}, customerConfirmed:true, uploadUrl:'https://foreign.invalid' }, {type:'body',metatype:CreateRentalExchangeInspectionMediaDto});
  assert.equal(imageDto.operationKey,image.operationKey); assert.equal(imageDto.exchange.allocationId,'allocation');
  for (const field of ['tenantId','metadata','customerConfirmed','uploadUrl']) assert.equal(imageDto[field],undefined);
  await assert.rejects(pipe.transform({...image,mimeType:'image/svg+xml'}, {type:'body',metatype:CreateRentalExchangeInspectionMediaDto}));
  const f = inspectionPreparationFixture(), input = await f.input();
  const result = await pipe.transform({ ...input, customerConfirmed: true, inspections: input.inspections.map(row => ({ ...row, attachments: ['foreign-file'] })), exceptions: [{ code: 'damage', description: 'Fact only', allocationId: 'allocation', chargeAmount: 20 }] }, { type: 'body', metatype: PrepareRentalExchangeInspectionDto });
  assert.equal(result.customerConfirmed, undefined); assert.equal(result.exceptions[0].chargeAmount, undefined); assert.equal(result.inspections[0].attachments, undefined);
  assert.equal(result.expectedOrderUpdatedAt, input.expectedOrderUpdatedAt); assert.equal(result.exchange.allocationId, 'allocation');
  await assert.rejects(pipe.transform({ ...input, expectedRevision: 1 }, { type: 'body', metatype: PrepareRentalExchangeInspectionDto }));
  const schemas = load('apps/api/src/modules/rental-core/rental-exchange-inspection-preparation.schemas.ts');
  assert.equal(schemas.RENTAL_EXCHANGE_INSPECTION_OPERATIONS.length, 8);
  assert.equal(schemas.RENTAL_EXCHANGE_INSPECTION_SCHEMAS.PrepareRentalExchangeInspectionRequest.additionalProperties, false);
  for (const op of schemas.RENTAL_EXCHANGE_INSPECTION_OPERATIONS) assert.deepEqual(plain(op.permissions), ['rental-os:order:operate']);
  const { requiredPermissions } = require('../apps/api/src/common/api-auth.guard');
  for (const op of schemas.RENTAL_EXCHANGE_INSPECTION_OPERATIONS) assert.deepEqual(requiredPermissions(op.method.toUpperCase(), op.path.replace('/api', '').replaceAll(/\{[^}]+\}/g, 'example')), ['rental-os:order:operate']);
  const controller = fs.readFileSync(path.join(root, 'apps/api/src/modules/rental-core/rental-core.controller.ts'), 'utf8');
  for (const route of ['requirements', 'preparations', 'preparations/:preparationId', 'operations/:key']) assert.ok(controller.includes(`orders/:id/exchange-inspection/${route}`));
});

function exchangeImageFixture() {
  const f = inspectionPreparationFixture(), { RentalExchangeInspectionMediaService } = load('apps/api/src/modules/rental-core/rental-exchange-inspection-media.service.ts');
  f.originalTemplate.fields.push({ code: 'photo', label: 'Original condition', type: 'photo', required: true });
  let state = { rows: [], assets: [] }, tail = Promise.resolve(); f.filePlans = 0; f.byteReads = 0; f.failFinish = false; f.failInsert = false;
  f.failClaim = false; f.loseClaimAck = false; f.loseCompletionAck = false; f.inspectHook = async () => undefined; f.afterClaim = async () => undefined;
  const fileAsset = assets => ({ findFirst: async ({ where }) => copy(assets.find(asset => asset.id === where.id && asset.tenantId === where.tenantId) ?? null) });
  const prisma = { async $transaction(fn) {
    const wait = tail; let release; tail = new Promise(resolve => { release = resolve; }); await wait; const next = copy(state);
    let claimed = false, completed = false;
    const tx = { fileAsset: fileAsset(next.assets), async $queryRaw(query, ...args) { const { sql, values: v } = sqlArgs(query, args);
      if (sql.includes('FROM Tenant')) return [{ id: 't1' }];
      if (sql.includes('rental_exchange_inspection_media')) return copy(next.rows.filter(row => row.tenantId === v[0] && row.workspaceId === v[1] && row.actorUserId === v[2] && row.operationKey === v[3]));
      throw new Error(sql);
    }, async $executeRaw(query, ...args) { const { sql, values: v } = sqlArgs(query, args);
      if (sql.startsWith('INSERT')) { if (f.failInsert) throw new Error('binding insert failed'); const names = ['tenantId','workspaceId','actorUserId','orderId','operationKey','id','requestHash','binding','bindingHash']; next.rows.push({ ...Object.fromEntries(names.map((name,i) => [name,v[i]])), completion: null, completionHash: null, completionClaimId: null, completionClaimedAt: null }); return 1; }
      const row = next.rows.find(row => row.tenantId === v[2] && row.workspaceId === v[3] && row.actorUserId === v[4] && row.operationKey === v[5] && row.completion === null && row.completionHash === null);
      if (sql.includes('SET completionClaimId=')) {
        if (!row || f.failClaim || row.orderId !== v[6] || row.bindingHash !== v[7] || row.completionClaimId !== null || row.completionClaimedAt !== null || v[8].getTime() <= Date.now()) return 0;
        claimed = true; row.completionClaimId = v[0]; row.completionClaimedAt = v[1]; return 1;
      }
      if (!row || f.failFinish || row.bindingHash !== v[6] || row.completionClaimId !== v[7] || row.completionClaimedAt.getTime() !== v[8].getTime()) return 0;
      completed = true; row.completion = v[0]; row.completionHash = v[1]; return 1;
    }, assets: next.assets };
    try {
      const result = await fn(tx); state = next;
      if (claimed) { await f.afterClaim(); if (f.loseClaimAck) throw new Error('claim commit ACK lost'); }
      if (completed && f.loseCompletionAck) throw new Error('completion commit ACK lost');
      return result;
    } finally { release(); }
  } };
  const files = { async planExchangeInspectionUpload(_tenant, input, owner) { f.filePlans++; const assetId = `image-${f.filePlans}`, sessionId = `session-${f.filePlans}`;
    return { input, owner, assetId, sessionId, storageKey: `private/${assetId}`, provider: 's3_compatible', expiresAt: new Date(Date.now()+900000), configRowHash: 'config', storageLocationHash: 'location', uploadUrl: 'https://storage.example.invalid/original-put', uploadHeaders: {} }; },
    async persistExchangeInspectionUpload(tx, tenantId, plan) { tx.assets.push({ id: plan.assetId, tenantId, businessModule: 'rental-core', businessType: 'rental_order', businessId: plan.input.businessId, fileName: plan.input.fileName,
      mimeType: plan.input.mimeType, sizeBytes: plan.input.sizeBytes, storageProvider: plan.provider, storageKey: `private/${plan.assetId}`, uploadScene: shared.RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE, uploadedBy: plan.owner.actorUserId,
      metadata: { workspaceId: 'w1', exchangeInspectionSourceId: plan.owner.exchangeInspectionSourceId, storageLocationHash: 'location' }, status: 'pending_upload',
      uploadSession: { id: plan.sessionId, tenantId, fileAssetId: plan.assetId, provider: plan.provider, storageKey: `private/${plan.assetId}`, status: 'pending_upload', expiresAt: plan.expiresAt, idempotencyKey: plan.input.idempotencyKey } }); },
    async inspectExchangeInspectionUpload() {
      f.byteReads++; assert.ok(state.rows[0].completionClaimId, 'claim must commit before any object read');
      await f.inspectHook(); return { contentHash: 'a'.repeat(64), sizeBytes: 68, mimeType: 'image/png', width: 1, height: 1 };
    },
    async completeExchangeInspectionUpload(tx, _tenant, fileId, _owner, proof) { const asset = tx.assets.find(row => row.id === fileId), completedAt = new Date().toISOString();
      asset.status = 'active'; asset.checksum = proof.contentHash; asset.metadata.exchangeInspectionContentHash = proof.contentHash; asset.uploadSession.status = 'completed'; asset.uploadSession.completedAt = new Date(completedAt);
      return { ...proof, completedAt }; } };
  f.restartMedia = () => { f.media = new RentalExchangeInspectionMediaService(prisma, f.service, files); };
  f.restartMedia(); f.state = () => state;
  f.mediaRequirements = () => f.within(() => f.media.requirements('operator-token-double', f.user, 'o1', { expectedOrderUpdatedAt: f.order.updatedAt, exchange: { orderLineId:'line', allocationId:'allocation', replacementItemGroupId:'new', replacementAssetId:'asset', priceBasis:'original_order_price', originalDisposition:'return_to_warehouse' } }));
  f.mediaInput = async () => { const requirements = await f.mediaRequirements(); return { expectedOrderUpdatedAt: requirements.expectedOrderUpdatedAt, exchange: requirements.exchange, requirementsHash: requirements.requirementsHash,
    operationKey:'image-key', side:'original_return', templateId:'old-template', templateVersion:'v1', fieldCode:'photo', fileName:'condition.png', mimeType:'image/png', sizeBytes:68 }; };
  f.createImage = input => f.within(() => f.media.create('operator-token-double', f.user, 'o1', input));
  f.readImage = key => f.within(() => f.media.original('operator-token-double', f.user, 'o1', key));
  f.finishImage = key => f.within(() => f.media.complete('operator-token-double', f.user, 'o1', key)); return f;
}
test('dedicated exchange image binds original photo requirement and permanently observes K without another ticket or preparation acceptance', async () => {
  const f = exchangeImageFixture(), input = await f.mediaInput(); await assert.rejects(f.requirements(), /影像/u);
  const first = await f.createImage(input); assert.ok(first.uploadUrl); assert.equal(first.source.preparationUse, 'not_connected');
  const plans = f.filePlans, replay = await f.createImage(input); assert.equal(replay.state,'observed'); assert.equal(replay.uploadUrl, undefined); assert.equal(f.filePlans,plans);
  await assert.rejects(f.createImage({ ...input, fileName:'different.png' }), /不同/u);
  const [a,b] = await Promise.all([f.createImage(input),f.createImage(input)]); assert.equal(a.source.id,b.source.id); assert.equal(f.state().rows.length,1);
  assert.equal((await f.readImage('missing')).retryable,false); f.state().assets[0].uploadSession.expiresAt = new Date(0); const binding = JSON.parse(f.state().rows[0].binding);
  binding.source.expiresAt = new Date(0).toISOString(); f.state().rows[0].binding = JSON.stringify(binding); f.state().rows[0].bindingHash = requestFingerprint(binding);
  assert.equal((await f.readImage(input.operationKey)).source.state,'completion_unknown'); assert.equal(f.filePlans,plans); assert.equal(f.byteReads,0);
});
test('dedicated exchange image rejects foreign declarations and atomically appends completion with exact original result', async () => {
  for (const variant of ['field','side','hash','version','authority','insert']) {
    const f = exchangeImageFixture(), input = await f.mediaInput();
    if (variant==='field') input.fieldCode='ok'; if (variant==='side') input.side='replacement_pickup'; if (variant==='hash') input.requirementsHash='0'.repeat(64);
    if (variant==='version') input.templateVersion='v2'; if (variant==='authority') f.authority=false; if (variant==='insert') f.failInsert=true;
    await assert.rejects(f.createImage(input)); assert.equal(f.state().rows.length,0); assert.equal(f.state().assets.length,0);
  }
  const failed = exchangeImageFixture(), failedInput = await failed.mediaInput(); await failed.createImage(failedInput); failed.failFinish=true;
  await assert.rejects(failed.finishImage(failedInput.operationKey), /核对/u);
  assert.equal(failed.state().assets[0].status,'pending_upload'); assert.equal(failed.state().assets[0].uploadSession.status,'pending_upload'); assert.equal(failed.state().rows[0].completion,null);
  assert.ok(failed.state().rows[0].completionClaimId); failed.failFinish=false;
  assert.equal((await failed.finishImage(failedInput.operationKey)).source.state,'completion_unknown'); assert.equal(failed.byteReads,1);
  const f = exchangeImageFixture(), input = await f.mediaInput(); await f.createImage(input);
  const finished=await f.finishImage(input.operationKey); assert.equal(finished.source.state,'completed'); assert.equal(finished.source.completion.contentHash,'a'.repeat(64));
  const reads=f.byteReads; f.order.updatedAt='changed'; assert.equal((await f.finishImage(input.operationKey)).source.id,finished.source.id); assert.equal(f.byteReads,reads);
  assert.equal((await f.readImage(input.operationKey)).source.state,'completed');
  f.state().rows[0].orderId='foreign-order'; await assert.rejects(f.readImage(input.operationKey),/绑定/u); f.state().rows[0].orderId='o1';
  f.state().assets[0].metadata.workspaceId='foreign-workspace'; await assert.rejects(f.readImage(input.operationKey),/关联/u); f.state().assets[0].metadata.workspaceId='w1';
  f.state().assets[0].uploadedBy='foreign-actor'; await assert.rejects(f.readImage(input.operationKey),/关联/u); f.state().assets[0].uploadedBy='operator';
  f.state().assets[0].uploadScene='return-evidence'; await assert.rejects(f.readImage(input.operationKey),/关联/u); f.state().assets[0].uploadScene=shared.RENTAL_EXCHANGE_INSPECTION_MEDIA_SCENE;
  f.authority=false; await assert.rejects(f.readImage(input.operationKey),/权限/u);
});

test('exchange image completion claims commit before a single dispatch; restart and lost acknowledgements only observe', async () => {
  const f = exchangeImageFixture(), input = await f.mediaInput(); await f.createImage(input);
  let entered, release; const started = new Promise(resolve => { entered = resolve; }), waiting = new Promise(resolve => { release = resolve; });
  f.inspectHook = async () => { entered(); await waiting; };
  const first = f.finishImage(input.operationKey); await started;
  const claim = copy(f.state().rows[0].completionClaimId); f.restartMedia();
  const second = await f.finishImage(input.operationKey), observed = await f.readImage(input.operationKey);
  assert.equal(second.source.state,'completion_unknown'); assert.equal(observed.source.state,'completion_unknown');
  assert.equal(second.retryable,false); assert.equal(f.byteReads,1); assert.equal(f.state().rows[0].completionClaimId,claim);
  release(); const completed = await first; assert.equal(completed.source.state,'completed'); assert.equal(f.byteReads,1);
  for (const stage of ['claim','completion']) {
    const g = exchangeImageFixture(), body = await g.mediaInput(); await g.createImage(body);
    if (stage === 'claim') g.loseClaimAck = true; else g.loseCompletionAck = true;
    await assert.rejects(g.finishImage(body.operationKey), /ACK lost/u);
    const claimed = copy(g.state().rows[0].completionClaimId); g.restartMedia();
    const original = await g.readImage(body.operationKey), replay = await g.finishImage(body.operationKey);
    assert.equal(original.source.state, stage === 'claim' ? 'completion_unknown' : 'completed'); assert.equal(replay.source.state,original.source.state);
    assert.equal(g.byteReads,stage === 'claim' ? 0 : 1); assert.equal(g.state().rows[0].completionClaimId,claimed);
    assert.equal(replay.retryable,false); assert.equal(replay.uploadUrl,undefined);
  }
});
test('exchange image completion failures, expiry and corrupt claims never grant replay permission', async () => {
  for (const stage of ['read','authority-before-read','authority-after-read','revision','claim-replaced','claim-time-changed']) {
    const f = exchangeImageFixture(), body = await f.mediaInput(); await f.createImage(body);
    if (stage === 'read') f.inspectHook = async () => { throw new Error('read aborted'); };
    if (stage === 'authority-before-read') f.afterClaim = async () => { f.authority = false; };
    if (stage === 'authority-after-read') f.inspectHook = async () => { f.authority = false; };
    if (stage === 'revision') f.inspectHook = async () => { f.order.updatedAt = 'changed'; };
    if (stage === 'claim-replaced') f.inspectHook = async () => { f.state().rows[0].completionClaimId = '00000000-0000-4000-8000-000000000000'; };
    if (stage === 'claim-time-changed') f.inspectHook = async () => { f.state().rows[0].completionClaimedAt = new Date(f.state().rows[0].completionClaimedAt.getTime()+1); };
    await assert.rejects(f.finishImage(body.operationKey)); assert.ok(f.state().rows[0].completionClaimId);
    assert.equal(f.state().assets[0].status,'pending_upload'); assert.equal(f.state().assets[0].uploadSession.status,'pending_upload'); assert.equal(f.state().rows[0].completion,null);
    f.authority = true; f.inspectHook = async () => undefined; f.afterClaim = async () => undefined; f.restartMedia();
    assert.equal((await f.finishImage(body.operationKey)).source.state,'completion_unknown'); assert.equal(f.byteReads,stage === 'authority-before-read' ? 0 : 1);
  }
  const expired = exchangeImageFixture(), body = await expired.mediaInput(); await expired.createImage(body);
  const row = expired.state().rows[0], binding = JSON.parse(row.binding); binding.source.expiresAt = new Date(0).toISOString(); row.binding = JSON.stringify(binding); row.bindingHash = requestFingerprint(binding);
  expired.state().assets[0].uploadSession.expiresAt = new Date(0);
  assert.equal((await expired.finishImage(body.operationKey)).source.state,'completion_unknown'); assert.equal(expired.byteReads,0); assert.equal(row.completionClaimId,null);
  const cas = exchangeImageFixture(), casBody = await cas.mediaInput(); await cas.createImage(casBody); cas.failClaim=true;
  await assert.rejects(cas.finishImage(casBody.operationKey), /占用/u); assert.equal(cas.byteReads,0); assert.equal(cas.state().rows[0].completionClaimId,null);
  for (const variant of ['missing-column','partial','bad-id','bad-time']) {
    const f = exchangeImageFixture(), input = await f.mediaInput(); await f.createImage(input); const row = f.state().rows[0];
    if (variant === 'missing-column') delete row.completionClaimId;
    if (variant === 'partial') row.completionClaimedAt = new Date();
    if (variant === 'bad-id' || variant === 'bad-time') { row.completionClaimId = variant === 'bad-id' ? 'bad' : '00000000-0000-4000-8000-000000000000'; row.completionClaimedAt = variant === 'bad-time' ? 'invalid' : new Date(); }
    await assert.rejects(f.readImage(input.operationKey), /占用/u); await assert.rejects(f.finishImage(input.operationKey), /占用/u); assert.equal(f.byteReads,0);
  }
  // Additive migration does not invent a dispatch claim for historical completed evidence.
  const legacy = exchangeImageFixture(), old = await legacy.mediaInput(); await legacy.createImage(old); await legacy.finishImage(old.operationKey);
  legacy.state().rows[0].completionClaimId = null; legacy.state().rows[0].completionClaimedAt = null; legacy.restartMedia();
  assert.equal((await legacy.finishImage(old.operationKey)).source.state,'completed'); assert.equal(legacy.byteReads,1);
});

process.on('exit', () => { for (const [file, hash] of sources) assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), hash, `Source changed during verification: ${file}`); });
