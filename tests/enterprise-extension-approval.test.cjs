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
      const implementations = new Set(['enterprise-command.service', 'enterprise-policy.service', 'enterprise-extension-approval.service', 'rental-core.service', 'client-api.service', 'rental-idempotent-action.service', 'rental-idempotency.repository']);
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
const ctx = id => ({ tenantId: 't1', tenantCode: 'merchant', workspaceId: 'w1', customerId: id, customerType: 'personal', sessionId: `session-${id}`, membershipStatus: 'active' });
const within = (id, fn) => identity.runWithRequestIdentity({ tenantId: 't1', workspaceId: 'w1', userId: id, isSaasAdmin: false }, fn);
const change = (key, revision, extra) => ({ operationKey: key, expectedRevision: revision, reason: 'Explicit reviewed request', ...extra });
const copy = structuredClone, plain = value => JSON.parse(JSON.stringify(value));
function sqlArgs(query, values) { return Array.isArray(query) ? { sql: query.join('?').replace(/\s+/g, ' '), values } : { sql: query.sql.replace(/\s+/g, ' '), values: query.values }; }
function fixture(paymentRequired = true) {
  const updated = '2026-11-01T00:00:00.000Z', relationUpdated = new Date('2026-10-31T00:00:00Z');
  const policy = { workspaceIds: ['w1'], categoryCodes: ['vehicle'], personalPaymentAllowed: true, enterprisePaymentAllowed: true,
    approvalMode: 'per_order', approvalLifetimeMinutes: 30, noticeVersion: 'v1', noticeText: 'Original enterprise disclosure' };
  const basis = { merchantRevision: 1, companyRevision: 1, employeeRevision: 1, membershipUpdatedAt: relationUpdated.toISOString(), noticeVersion: 'v1', acknowledgedAt: updated, guaranteePayer: 'enterprise', approvalMode: 'per_order' };
  let state = { approvals: [], receipts: [], extensions: [], idempotency: [], order: { id: 'o1', tenantId: 't1', workspaceId: 'w1', quoteId: 'q1', customerId: 'p1', status: shared.RentalCoreOrderStatus.Renting,
    startAt: '2090-01-01T00:00:00Z', endAt: '2090-01-02T00:00:00Z', updatedAt: updated, ruleSnapshot: { extension: { enabled: true } }, rentalAmount: 100, payableAmount: 100, finalPayableAmount: 100,
    chargeLines: [], reservations: [], lines: [], allocations: [], membershipSnapshot: { bookingIdentity: 'enterprise_employee', personalCustomerId: 'p1', corporateCustomerId: 'c1', corporateMembershipId: 'm1', enterpriseContractAndPayer: true, enterpriseBasis: basis } } };
  const flags = { active: true, reviewer: true, member: true, failReceipt: false, failCoreSave: false, loseAck: false, paid: false, pricingChanged: false, available: true };
  const events = [], policies = ['merchant', 'company', 'member:m1'].map(scopeKey => ({ scopeKey, revision: 1, policy: copy(policy), membershipUpdatedAt: relationUpdated }));
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
      if (sql.includes('INSERT INTO enterprise_extension_approvals')) {
        const keys = ['tenantId','id','corporateCustomerId','applicantCustomerId','workspaceId','orderId','expectedOrderUpdatedAt','requestFingerprint','previewFingerprint','request','preview','basis','reason','expiresAt'];
        s.approvals.push({ ...Object.fromEntries(keys.map((key, i) => [key, v[i]])), state: 'pending', revision: 1, extensionId: null, executionKey: null, approvedBy: null }); return 1;
      }
      if (sql.includes('INSERT INTO enterprise_portal_operations')) {
        if (flags.failReceipt) throw new Error('receipt write failed');
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
  return { service, prisma, core, client, events, flags, policies, preview, request, approve, submit, state: () => state };
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
  for (const route of ['extension-approvals', 'extension-approvals/submit', 'extension-approvals/:id/decision', 'extension-approvals/:id/result', 'extension-approvals/:id/close-execution', 'my-extension-approvals', 'corporates/:corporateId/extension-approvals', 'orders/:orderId/extension-eligibility']) {
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

process.on('exit', () => { for (const [file, hash] of sources) assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), hash, `Source changed during verification: ${file}`); });
