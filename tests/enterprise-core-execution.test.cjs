'use strict';
/** Bounded offline composition: real Enterprise commands/approval/policy and
 * RentalOrderConfirmationService execute together. Only storage/transactions and
 * original business dependencies are doubles. Locks are acquired by actual SQL,
 * not by a global transaction queue. This does not prove MySQL, HTTP or funding. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
const writeRoot = path.join(root, 'output', 'enterprise-offline', 'workflows');
assert.equal(process.env.DATABASE_URL, 'mysql://offline:offline@127.0.0.1:1/rental_os_offline');
for (const name of ['AI_OFFLINE_WRITE_ROOT', 'TEMP', 'TMP']) assert.equal(path.resolve(process.env[name]), writeRoot, name);
assert.equal(path.dirname(path.resolve(process.env.AI_OFFLINE_AUDIT)), writeRoot);
assert.match(path.basename(process.env.AI_OFFLINE_AUDIT), /^core-execution-/u);
assert.ok(require.cache[require.resolve('./fixtures/ai-native/prisma-offline-preload.cjs')], 'run with the existing offline preload');
const auditStarted = 'core-execution: existing offline preload loaded\n';
assert.equal(fs.existsSync(process.env.AI_OFFLINE_AUDIT), false, 'preserve earlier logs; choose a new audit path for each run');
fs.appendFileSync(process.env.AI_OFFLINE_AUDIT, auditStarted);
const plain = value => JSON.parse(JSON.stringify(value));
const copy = value => structuredClone(value);
const common = require('@nestjs/common');
const sources = new Map();
function load(relative, deps = {}) {
  const file = path.join(root, relative), exports = {}, source = fs.readFileSync(file, 'utf8');
  sources.set(file, createHash('sha256').update(source).digest('hex'));
  const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true
  } });
  assert.equal(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
  vm.runInNewContext(result.outputText, { exports, require: name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name.startsWith('node:')) return require(name);
    if (name === '@nestjs/common') return common;
    if (name === '@prisma/client') return { Prisma };
    throw new Error(`Unexpected runtime dependency: ${relative}: ${name}`);
  }, Date, Map, Set, JSON, structuredClone }, { filename: file });
  return exports;
}
const identity = load('apps/api/src/common/request-identity.ts');
const scope = load('apps/api/src/modules/rental-core/workspace-scope.ts', { '../../common/request-identity': identity });
const commandModule = load('apps/api/src/modules/enterprise/enterprise-command.service.ts', { '../../common/request-identity': identity });
const idempotencyModule = load('apps/api/src/modules/rental-core/rental-idempotency.repository.ts', { './workspace-scope': scope });
const { EnterpriseCommandService } = commandModule;
const { EnterprisePolicyService } = load('apps/api/src/modules/enterprise/enterprise-policy.service.ts', {
  '../../common/request-identity': identity, './enterprise-command.service': commandModule,
  '../rental-core/rental-idempotency.repository': idempotencyModule,
  // Existing runtime export only; all new enterprise contracts are type-only.
  '@rental-os/shared': require('../packages/shared/dist')
});
const { RentalOrderConfirmationService } = load('apps/api/src/modules/rental-core/rental-order-confirmation.service.ts', {
  './rental-idempotency.repository': idempotencyModule,
  './rental-business-fence': load('apps/api/src/modules/rental-core/rental-business-fence.ts'),
  './rental-core-fact.repository': { RentalCoreFactRepository: class {} },
  './rental-business-fact.repository': { RentalBusinessFactRepository: class {} },
  './rental-service-occurrence': load('apps/api/src/modules/rental-core/rental-service-occurrence.ts')
});
const { EnterpriseApprovalService } = load('apps/api/src/modules/enterprise/enterprise-approval.service.ts', {
  '../../common/request-identity': identity, './enterprise-command.service': commandModule
});
const context = { tenantId: 't1', customerId: 'p1', customerType: 'personal', workspaceId: 'w1', sessionId: 's1', membershipStatus: 'active' };
const submitInput = { approvalId: 'a1', operationKey: 'original-submit', expectedRevision: 2, reason: 'Applicant explicitly reviewed the original quote', confirm: true };
const closeInput = { operationKey: 'original-close', expectedRevision: 3, reason: 'Applicant explicitly seals the original unresolved execution', confirm: true };
const inIdentity = fn => identity.runWithRequestIdentity({ tenantId: 't1', userId: 'p1', workspaceId: 'w1', isSaasAdmin: false }, fn);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function bounded(promise, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 2500); })]); }
  finally { clearTimeout(timer); }
}
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const denied = status => error => error instanceof common.HttpException && error.getStatus() === status;

function fixture() {
  const updatedAt = new Date('2026-10-31T00:00:00Z');
  const policy = { workspaceIds: ['w1'], categoryCodes: ['vehicle'], personalPaymentAllowed: true, enterprisePaymentAllowed: true,
    approvalMode: 'per_order', approvalLifetimeMinutes: 30, noticeVersion: 'v1', noticeText: 'Enterprise identity orders are visible to the company.',
    currency: 'CNY', maxRequestAmount: '500.00' };
  const basis = { merchantRevision: 1, companyRevision: 1, employeeRevision: 1, membershipUpdatedAt: updatedAt.toISOString(),
    noticeVersion: 'v1', acknowledgedAt: updatedAt.toISOString(), guaranteePayer: 'enterprise', approvalMode: 'per_order' };
  const request = { quoteId: 'q1', customerId: 'p1', customerType: 'personal', customerName: 'Original applicant',
    bookingIdentity: { bookingIdentity: 'enterprise_employee', corporateCustomerId: 'c1', enterpriseContractAndPayer: true,
      enterpriseDisclosure: { noticeVersion: 'v1', acknowledged: true } },
    fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'l1', returnLocationId: 'l1',
    startAt: '2090-01-01T10:00:00Z', endAt: '2090-01-02T10:00:00Z', lines: [{ itemGroupId: 'g1', quantity: 1 }] };
  const quote = { id: 'q1', tenantId: 't1', quoteNo: 'Q-OFFLINE', categoryCode: 'vehicle', request: copy(request),
    expiresAt: '2099-01-01T00:00:00Z', currency: 'CNY', payableAmount: 100, rentalAmount: 100, depositAmount: 1000, preAuthAmount: 0,
    discountAmount: 0, couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, chargeLines: [{ code: 'rental:g1', name: 'Rental', type: 'rental', amount: 100 }],
    ruleSnapshot: {}, membershipSnapshot: { bookingIdentity: 'enterprise_employee', personalCustomerId: 'p1', personalCustomerName: 'Original applicant',
      corporateCustomerId: 'c1', corporateCustomerName: 'Original company', corporateMembershipId: 'm1', enterpriseContractAndPayer: true,
      qualifications: [], enterpriseBasis: basis } };
  let state = { approval: { tenantId: 't1', id: 'a1', corporateCustomerId: 'c1', applicantCustomerId: 'p1', workspaceId: 'w1', quoteId: 'q1',
    state: 'approved', revision: 2, expiresAt: new Date(quote.expiresAt), purpose: 'Work', orderId: null, amount: '100.00', currency: 'CNY',
    quote: JSON.stringify(quote), request: JSON.stringify(request), basis: JSON.stringify(basis), requestFingerprint: idempotencyModule.requestFingerprint(request),
    executionKey: null, approvedBy: 'reviewer', reviewerMembershipId: 'reviewer-m', reviewerMembershipUpdatedAt: updatedAt },
    quote: copy(quote), receipts: [], orders: [], idempotency: [], reservations: [], sequence: 0,
    policies: ['merchant', 'company', 'member:m1'].map(scopeKey => ({ scopeKey, revision: 1, policy: copy(policy), membershipUpdatedAt: updatedAt })) };
  // External identity/policy observations can be revoked at a controlled read.
  // They are not simulated successful adapters, and their denial is real service code.
  const auth = { tenant: true, customer: true, session: true, membership: 'active', relation: true, reviewer: true, portal: true, tenantPortal: true };
  const fault = { beforePreparedReturn: null, beforeCommit: null, afterCommit: null, afterIdempotencyRecord: null, afterOriginalRead: null, sql: null };
  const counts = { dispatch: 0, prepare: 0, cache: 0, closeGuard: 0, originalReads: [], originalLinkedOrderIds: [], successfulPublications: 0 };
  const events = [], listeners = [], transactions = [], locks = new Map();
  function emit(tx, event, detail) {
    const value = { tx: tx?.id ?? null, event, detail }; events.push(value);
    for (const listener of [...listeners]) if (listener.predicate(value)) { listeners.splice(listeners.indexOf(listener), 1); listener.resolve(value); }
  }
  const waitFor = predicate => {
    const existing = events.find(predicate); if (existing) return Promise.resolve(existing);
    const gate = deferred(); listeners.push({ predicate, resolve: gate.resolve }); return bounded(gate.promise, 'Expected transaction event never occurred');
  };
  async function acquire(tx, resource) {
    assert.ok(tx, 'locking SQL requires a transaction');
    const prior = locks.get(resource);
    if (prior?.owner === tx) { emit(tx, 'lock.reentrant', resource); return; }
    emit(tx, 'lock.request', resource);
    if (prior) { emit(tx, 'lock.wait', resource); await bounded(prior.released.promise, `Lock did not release: ${resource}`); return acquire(tx, resource); }
    locks.set(resource, { owner: tx, released: deferred() }); tx.held.push(resource);
    // Snapshot only AFTER acquiring the actual tenant SQL lock. Waiting clients
    // must observe the preceding commit; nontransaction reads see committed state.
    if (!tx.records) tx.records = copy(state);
    emit(tx, 'lock.acquired', resource);
  }
  function release(tx) {
    for (const resource of [...tx.held].reverse()) {
      const lock = locks.get(resource); assert.equal(lock.owner, tx); locks.delete(resource); emit(tx, 'lock.release', resource); lock.released.resolve();
    }
  }
  function records(tx) { if (!tx) return state; assert.ok(tx.records, 'transaction reads/writes must follow its tenant lock'); return tx.records; }
  function fence(tx, approval = false) {
    assert.equal(locks.get('Tenant:t1')?.owner, tx, 'mutation requires real Tenant SQL fence');
    if (approval) assert.equal(locks.get('approval:a1')?.owner, tx, 'approval mutation requires real approval SQL fence');
  }
  function parts(first, rest) {
    const strings = Array.isArray(first) ? first : first.strings;
    const values = Array.isArray(first) ? rest : first.values;
    return { sql: strings.reduce((out, text, i) => out + (i ? `$${i - 1}` : '') + text, '').replace(/\s+/gu, ' ').trim(), values };
  }
  const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  function client(tx) {
    return {
      $queryRaw: async (first, ...rest) => {
        const { sql, values: v } = parts(first, rest); emit(tx, 'sql.read', sql);
        if (sql.includes('FROM Tenant')) {
          assert.deepEqual(v, ['t1']); assert.ok(sql.includes('FOR UPDATE')); await acquire(tx, 'Tenant:t1'); return auth.tenant ? [{ id: 't1' }] : [];
        }
        if (sql.includes('FROM customer_profiles p')) {
          assert.deepEqual(v.slice(0, 3), ['s1', 't1', 'p1']);
          assert.ok(sql.includes("p.customerType='personal'"));
          return auth.customer && auth.session && !['exited', 'closed'].includes(auth.membership) && (v[3] || auth.membership === 'active') ? [{ id: 'p1' }] : [];
        }
        if (sql.includes('FROM enterprise_portal_operations')) {
          if (tx) tx.kind = 'command';
          return copy(records(tx).receipts.filter(row => row.tenantId === v[0] && row.operationKey === v[1]));
        }
        if (sql.includes('FROM enterprise_booking_approvals')) {
          const r = records(tx).approval;
          if (sql.includes('requestFingerprint=')) {
            assert.deepEqual(v.slice(0, 5), ['t1', 'w1', 'q1', 'c1', 'p1']);
            return r && r.state === 'executing' && r.executionKey === v[5] && r.requestFingerprint === v[6] && r.expiresAt > new Date() ? [copy(r)] : [];
          }
          assert.deepEqual(v, ['t1', 'a1']);
          if (sql.includes('FOR UPDATE')) await acquire(tx, 'approval:a1');
          return r ? [copy(r)] : [];
        }
        if (sql.includes('FROM enterprise_corporate_portals')) { assert.deepEqual(v, ['t1', 'c1']); return [{ enabled: auth.portal }]; }
        if (sql.includes('FROM enterprise_portal_tenant_settings')) { assert.deepEqual(v, ['t1']); return [{ enabled: auth.tenantPortal }]; }
        if (sql.includes('FROM enterprise_scope_policies')) { assert.deepEqual(v, ['t1', 'c1']); return copy(records(tx).policies); }
        if (sql.includes('FROM customer_corporate_memberships r')) { assert.deepEqual(v.slice(0, 3), ['t1', 'c1', 'p1']); return auth.relation && auth.customer && auth.membership === 'active' ? [{ id: 'm1', updatedAt }] : []; }
        if (sql.includes('FROM business_workspaces')) { assert.deepEqual(v, ['t1', 'w1']); return [{ categoryCode: 'VEHICLE' }]; }
        if (sql.includes('FROM customer_corporate_memberships m')) { assert.deepEqual(v, ['t1', 'c1', 'reviewer', 'reviewer-m', updatedAt]); return auth.reviewer ? [{ id: 'reviewer-m' }] : []; }
        throw new Error(`Unmodeled SQL read: ${sql}`);
      },
      $executeRaw: async (first, ...rest) => {
        const { sql, values: v } = parts(first, rest); emit(tx, 'sql.write', sql); fence(tx);
        if (fault.sql && sql.includes(fault.sql)) throw new Error(`Synthetic SQL failure: ${fault.sql}`);
        const data = records(tx), r = data.approval;
        if (sql.startsWith('INSERT INTO enterprise_portal_operations')) {
          assert.equal(data.receipts.some(row => row.tenantId === v[0] && row.operationKey === v[1]), false, 'operation key unique');
          data.receipts.push({ tenantId: v[0], operationKey: v[1], actorUserId: v[2], requestHash: v[3], target: v[4], reason: v[5], result: v[6] }); return 1;
        }
        if (sql.includes("SET state='executing'")) {
          fence(tx, true); assert.deepEqual(v.slice(1), ['t1', 'a1']);
          Object.assign(r, { state: 'executing', executionKey: v[0], revision: r.revision + 1 }); emit(tx, 'approval.executing'); return 1;
        }
        if (sql.includes("SET state='consumed'")) {
          fence(tx, true); assert.deepEqual(v.slice(1), ['t1', 'a1', 'original-submit']);
          if (r.state !== 'executing' || r.executionKey !== v[3]) return 0;
          Object.assign(r, { state: 'consumed', orderId: v[0], revision: r.revision + 1 }); emit(tx, 'approval.consumed'); return 1;
        }
        if (sql.includes("SET state='closed'")) {
          fence(tx, true); assert.deepEqual(v, ['t1', 'a1', 'original-submit']);
          if (r.state !== 'executing' || r.executionKey !== v[2]) return 0;
          Object.assign(r, { state: 'closed', revision: r.revision + 1 }); emit(tx, 'approval.closed'); return 1;
        }
        if (sql.startsWith('UPDATE enterprise_portal_operations')) {
          const row = data.receipts.find(row => row.tenantId === v[1] && row.operationKey === v[2] && row.actorUserId === v[3]);
          if (!row) return 0; row.result = v[0]; return 1;
        }
        throw new Error(`Unmodeled SQL write: ${sql}`);
      },
      businessWorkspace: { findFirst: async ({ where }) => { assert.deepEqual(plain(where), { id: 'w1', tenantId: 't1' }); return { id: 'w1' }; } },
      rentalOrder: { findMany: async ({ where, select, take }) => {
        fence(tx, true); assert.deepEqual(plain(where), { tenantId: 't1', workspaceId: 'w1', quoteId: 'q1' }); assert.deepEqual(plain(select), { id: true }); assert.equal(take, 1);
        return records(tx).orders.filter(row => matches(row, where)).slice(0, take).map(row => ({ id: row.id }));
      } },
      rentalOrderIdempotencyRecord: {
        findFirst: async ({ where }) => { assert.deepEqual(plain(where), { tenantId: 't1', workspaceId: 'w1', action: 'rental.order.create', idempotencyKey: 'original-submit' }); emit(tx, 'idempotency.read', where.idempotencyKey); return copy(records(tx).idempotency.find(row => matches(row, where))) ?? null; },
        create: async ({ data }) => {
          fence(tx, true); assert.equal(data.action, 'rental.order.create'); assert.equal(data.idempotencyKey, 'original-submit');
          assert.equal(records(tx).idempotency.some(row => matches(row, { workspaceId: data.workspaceId, action: data.action, idempotencyKey: data.idempotencyKey })), false);
          records(tx).idempotency.push(copy(data)); emit(tx, 'idempotency.record'); if (fault.afterIdempotencyRecord) await fault.afterIdempotencyRecord(tx); return copy(data);
        }
      }
    };
  }
  const db = client(null);
  db.$transaction = async (callback, options) => {
    assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.ReadCommitted);
    const tx = { id: `tx${transactions.length + 1}`, kind: 'core', held: [], records: null, status: 'running' };
    Object.assign(tx, client(tx)); transactions.push(tx); emit(tx, 'transaction.begin');
    let committed = false;
    try {
      const result = await callback(tx); emit(tx, 'transaction.ready');
      if (fault.beforeCommit) await fault.beforeCommit(tx);
      fence(tx); state = tx.records; committed = true; tx.status = 'committed'; emit(tx, 'transaction.commit');
      if (fault.afterCommit) await fault.afterCommit(tx);
      return result;
    } catch (error) { tx.status = committed ? 'ack_lost' : 'rolled_back'; emit(tx, committed ? 'transaction.ack_lost' : 'transaction.rollback'); throw error; }
    finally { release(tx); }
  };
  const businessFacts = {
    findQuote: async (tenant, id, tx) => { assert.equal(tenant, 't1'); assert.equal(id, 'q1'); emit(tx, 'quote.read'); return copy(records(tx).quote); },
    consumeQuoteIfAvailable: async (tenant, id, orderId, at, tx) => {
      assert.equal(tenant, 't1'); assert.equal(id, 'q1'); fence(tx, true);
      const q = records(tx).quote; if (!q || q.consumedAt || q.consumedOrderId || new Date(q.expiresAt) < new Date(at)) return false;
      q.consumedAt = at; q.consumedOrderId = orderId; emit(tx, 'quote.consume'); return true;
    }
  };
  const coreFacts = {
    findOrder: async (tenant, id) => { assert.equal(tenant, 't1'); assert.equal(identity.requireRequestWorkspaceId(), 'w1'); return copy(state.orders.find(row => row.id === id && row.tenantId === tenant && row.workspaceId === 'w1')); },
    allocateOrderNumber: async (tenant, at, timezone, tx) => { assert.equal(tenant, 't1'); assert.ok(at); fence(tx, true); return `OFFLINE-${++records(tx).sequence}`; },
    saveOrderAggregate: async (order, changes, tx) => { fence(tx, true); assert.deepEqual(plain(changes), []); records(tx).orders.push(copy(order)); records(tx).reservations.push(...copy(order.reservations)); emit(tx, 'order.save'); }
  };
  // Original rental domain dependencies are explicit doubles: no price/stock/
  // qualification/funding claim is made. The confirmation orchestrator is real.
  const core = {
    resolveWorkspaceId: tenant => { assert.equal(tenant, identity.requireRequestTenantId()); return identity.requireRequestWorkspaceId(); },
    prepareOrder: async (tenant, input, operator, original, subjects) => {
      counts.prepare++;
      assert.equal(operator, 'client:p1'); assert.equal(original.payableAmount, 100); assert.equal(original.depositAmount, 1000);
      assert.deepEqual(plain(input.bookingIdentity), request.bookingIdentity); assert.equal(subjects.payerSubjectCustomerId, 'c1');
      const order = { id: `o${counts.prepare}`, tenantId: tenant, workspaceId: 'w1', quoteId: original.id, customerId: input.customerId,
        status: 'draft', createdAt: new Date().toISOString(), orderNo: '', payableAmount: original.payableAmount, currency: original.currency,
        membershipSnapshot: copy(original.membershipSnapshot), lines: copy(input.lines), reservations: [{ id: `reservation-${counts.prepare}`, quantity: 1, status: 'soft' }] };
      if (fault.beforePreparedReturn) await fault.beforePreparedReturn(); return order;
    },
    assertAvailabilityWithLocks: async (tenant, input, tx) => { assert.equal(tenant, 't1'); assert.equal(input.lines[0].quantity, 1); fence(tx, true); await acquire(tx, 'stock:g1'); emit(tx, 'stock.check'); }
  };
  const business = {
    consumeQuote: () => { throw new Error('Approved execution must read the persisted quote, never process-local consumeQuote'); },
    assertOrderDaysOpenForConfirmation: () => {}, validateCouponForOrder: () => null,
    applyOrderConfirmationToCache: () => { assert.equal(state.approval.state, 'consumed'); assert.equal(state.orders.length, 1); counts.cache++; emit(null, 'cache.publish'); }
  };
  const memberships = { resolveBookingIdentity: async () => { if (!auth.relation) throw new common.ForbiddenException('Original membership revoked'); return copy(quote.membershipSnapshot); } };
  const customerOperations = {
    assertTransactable: async () => ({ allowed: auth.customer, message: 'Original customer gate denied' }),
    assertTransactableForNewBusiness: async (_tenant, _workspace, _customer, tx) => { fence(tx, true); return { allowed: auth.customer, message: 'Original locked customer gate denied' }; }
  };
  const subjects = { resolveOrderSubjects: async (_tenant, _customer, _at, selected) => { assert.equal(selected.contractSubjectCustomerId, 'c1'); return copy(selected); } };
  let services;
  function rebuild() {
    const commands = new EnterpriseCommandService(db), policies = new EnterprisePolicyService(db, commands, {});
    const orders = new RentalOrderConfirmationService(db, core, business, coreFacts, businessFacts, new idempotencyModule.RentalIdempotencyRepository(db),
      undefined, subjects, customerOperations, undefined, memberships, policies);
    const originalGuard = orders.assertApprovedExecutionCanClose;
    orders.assertApprovedExecutionCanClose = async (...args) => { counts.closeGuard++; return originalGuard.apply(orders, args); };
    // Narrow ClientApi adapter only forwards the stored request/key/participant.
    // It NEVER invokes participant methods or pretends to prepare/commit Core.
    const clientApi = {
      executeApprovedSubmission: async (who, accepted, key, participant) => {
        assert.equal(who, context); assert.equal(accepted.tenantId, who.tenantId); assert.equal(accepted.workspaceId, who.workspaceId); assert.equal(accepted.customerId, who.customerId);
        counts.dispatch++;
        const created = await orders.createApprovedOrder(who.tenantId, accepted.request, `client:${who.customerId}`, { category: { code: 'vehicle' }, settings: {} }, key, participant);
        counts.successfulPublications++; return { orderId: created.order.id, replayed: created.replayed };
      },
      readOrderSubmission: async (who, accepted, key, committedOrderId) => {
        assert.equal(accepted.tenantId, who.tenantId); assert.equal(accepted.workspaceId, who.workspaceId); assert.equal(accepted.customerId, who.customerId);
        counts.originalReads.push(key); counts.originalLinkedOrderIds.push(committedOrderId);
        const result = await orders.readOrderCreation(who.tenantId, accepted.request, key, committedOrderId);
        if (fault.afterOriginalRead) await fault.afterOriginalRead(); return result;
      }
    };
    services = { commands, policies, orders, api: new EnterpriseApprovalService(db, commands, policies, {}, businessFacts, orders, clientApi) };
    return services;
  }
  rebuild();
  return { get state() { return state; }, get api() { return services.api; }, get orders() { return services.orders; },
    get commands() { return services.commands; }, auth, fault, counts, events, transactions, locks, db, waitFor, rebuild,
    submit: (input = submitInput) => inIdentity(() => services.api.submit(context, input)),
    close: (input = closeInput) => inIdentity(() => services.api.closeExecution(context, 'a1', input)),
    result: () => inIdentity(() => services.api.result(context, 'a1')) };
}
function assertEmptyCore(f) {
  assert.equal(f.state.orders.length, 0); assert.equal(f.state.reservations.length, 0); assert.equal(f.state.idempotency.length, 0);
  assert.equal(f.state.quote.consumedAt, undefined); assert.equal(f.state.quote.consumedOrderId, undefined); assert.equal(f.state.sequence, 0);
  assert.equal(f.counts.cache, 0); assert.equal(f.counts.successfulPublications, 0);
}
function assertLockOrder(f, tx) {
  const acquired = f.events.filter(e => e.tx === tx.id && e.event === 'lock.acquired').map(e => e.detail);
  assert.deepEqual(acquired.slice(0, 2), ['Tenant:t1', 'approval:a1']);
  const commit = f.events.findIndex(e => e.tx === tx.id && e.event === 'transaction.commit');
  const release = f.events.findIndex(e => e.tx === tx.id && e.event === 'lock.release');
  if (commit >= 0) assert.ok(release > commit, 'fence held through the original commit');
}
async function bindFailedCore(f) {
  f.fault.beforeCommit = async tx => { if (tx.kind === 'core') throw new Error('Synthetic original Core transaction rollback'); };
  await assert.rejects(f.submit(), /Synthetic original Core transaction rollback/u);
  f.fault.beforeCommit = null;
  assert.equal(f.transactions.at(-1).status, 'rolled_back');
  assert.equal(f.state.approval.state, 'executing'); assertEmptyCore(f);
}

test('real submit/Core commit share Tenant -> approval fence; same-key submit and consumed close only read the original order', async () => {
  const f = fixture();
  await assert.rejects(f.submit({ ...submitInput, confirm: false }), denied(403)); assert.equal(f.transactions.length, 0);
  const created = await f.submit(); assert.equal(created.orderId, 'o1'); assert.equal(f.state.approval.state, 'consumed');
  assert.equal(f.state.quote.consumedOrderId, created.orderId); assert.equal(f.state.idempotency[0].orderId, created.orderId);
  assert.equal(f.state.approval.orderId, created.orderId); assert.equal(f.state.orders.length, 1); assert.equal(f.state.reservations.length, 1);
  assert.equal(JSON.parse(f.state.receipts[0].result).state, 'consumed'); assert.equal(f.counts.cache, 1);
  const coreTx = f.transactions.find(tx => tx.kind === 'core'); assertLockOrder(f, coreTx);
  const coreEvents = f.events.filter(e => e.tx === coreTx.id).map(e => e.event);
  for (const [before, after] of [['stock.check', 'order.save'], ['order.save', 'quote.consume'], ['quote.consume', 'idempotency.record'], ['idempotency.record', 'approval.consumed'], ['approval.consumed', 'transaction.commit']]) assert.ok(coreEvents.indexOf(before) < coreEvents.indexOf(after), `${before} before ${after}`);
  const repeated = await f.submit(); assert.equal(repeated.original.orderId, created.orderId); assert.equal(repeated.retryable, false);
  // Consumed branch must be read-only even with an old revision, never cancellation.
  const closed = await f.close({ ...closeInput, expectedRevision: 0 });
  assert.equal(closed.approval.state, 'consumed'); assert.equal(closed.original.state, 'observed'); assert.equal(closed.original.orderId, created.orderId);
  assert.equal(f.counts.dispatch, 1); assert.equal(f.counts.closeGuard, 0); assert.equal(f.state.orders[0].status, 'draft');
  assert.deepEqual(f.counts.originalReads, ['original-submit', 'original-submit']);
  assertLockOrder(f, f.transactions.at(-1)); assert.equal(f.locks.size, 0);
});

test('Core holds the actual fence until commit; racing close waits and cannot convert the committed order into cancellation', async () => {
  const f = fixture(), ready = deferred(), resume = deferred();
  f.fault.beforeCommit = async tx => { if (tx.kind === 'core') { ready.resolve(tx); await resume.promise; } };
  const submitted = outcome(f.submit()), coreTx = await bounded(ready.promise, 'Core never reached pre-commit');
  let closeSettled = false; const closing = outcome(f.close()).finally(() => { closeSettled = true; });
  try {
    await f.waitFor(e => e.event === 'lock.wait' && e.detail === 'Tenant:t1' && e.tx !== coreTx.id);
    assert.equal(closeSettled, false); assert.equal(f.state.approval.state, 'executing'); assert.equal(f.state.orders.length, 0);
    assert.equal(coreTx.records.approval.state, 'consumed'); assert.equal(coreTx.records.orders.length, 1); assert.equal(f.counts.closeGuard, 0);
  } finally { resume.resolve(); }
  const original = await submitted, result = await closing; assert.ifError(original.error); assert.ifError(result.error);
  assert.equal(result.value.approval.state, 'consumed'); assert.equal(result.value.original.orderId, original.value.orderId);
  assert.equal(f.counts.dispatch, 1); assert.equal(f.counts.closeGuard, 0); assertLockOrder(f, coreTx); assertLockOrder(f, f.transactions.at(-1));
});

test('Core rollback releases its fence without consuming approval; no automatic retry, and the waiting explicit close seals only afterward', async () => {
  const f = fixture(), ready = deferred(), resume = deferred();
  f.fault.beforeCommit = async tx => { if (tx.kind === 'core') { ready.resolve(tx); await resume.promise; throw new Error('Synthetic Core rollback after all staged writes'); } };
  const submitted = outcome(f.submit()), coreTx = await bounded(ready.promise, 'Core never reached rollback checkpoint');
  // Every command, including receipt replay, takes Tenant. Do not await a
  // repeated submit while deliberately holding that same fence in this test.
  const closing = outcome(f.close());
  try { await f.waitFor(e => e.event === 'lock.wait' && e.detail === 'Tenant:t1' && e.tx !== coreTx.id); assert.equal(f.counts.closeGuard, 0); }
  finally { resume.resolve(); }
  const failed = await submitted, closed = await closing; assert.match(failed.error.message, /Synthetic Core rollback/u); assert.ifError(closed.error);
  assertEmptyCore(f); assert.equal(coreTx.status, 'rolled_back'); assert.equal(coreTx.records.approval.state, 'consumed', 'even staged consumption must roll back');
  assert.equal(closed.value.approval.state, 'closed'); assert.equal(closed.value.retryable, false); assert.equal(f.counts.closeGuard, 1);
  const rollbackIndex = f.events.findIndex(e => e.tx === coreTx.id && e.event === 'transaction.rollback');
  const closeLock = f.events.findIndex(e => e.tx === f.transactions.at(-1).id && e.event === 'lock.acquired'); assert.ok(closeLock > rollbackIndex);
  await f.submit(); assert.equal(f.counts.dispatch, 1); assertLockOrder(f, coreTx); assertLockOrder(f, f.transactions.at(-2));
});

test('close commits before delayed Core creation: the real per-order policy rejects late create, not merely a simulated participant', async () => {
  const f = fixture(), prepared = deferred(), resume = deferred();
  f.fault.beforePreparedReturn = async () => { prepared.resolve(); await resume.promise; };
  const submitted = outcome(f.submit()); await bounded(prepared.promise, 'Original Core preparation never reached');
  let closed;
  try { closed = await f.close(); assert.equal(closed.approval.state, 'closed'); assert.equal(f.state.approval.revision, 4); assertEmptyCore(f); }
  finally { resume.resolve(); }
  const late = await submitted; assert.ok(denied(403)(late.error)); assert.match(late.error.message, /原企业批准与提交指纹不匹配或已失效/u);
  assertEmptyCore(f); assert.equal(f.state.approval.state, 'closed'); assert.equal(f.counts.dispatch, 1);
  const coreTx = f.transactions.find(tx => tx.kind === 'core'); assert.equal(coreTx.status, 'rolled_back');
  assert.equal(f.events.some(e => e.tx === coreTx.id && e.event === 'stock.check'), false);
  assertLockOrder(f, f.transactions.find(tx => tx.records.approval.state === 'closed' && tx.kind === 'command'));
});

test('rollback stays executing; lost close acknowledgement and service reconstruction recover by the exact original keys only', async () => {
  const f = fixture(); await bindFailedCore(f);
  const prior = await f.submit(); assert.equal(prior.approval.state, 'executing'); assert.equal(prior.original.state, 'not_observed');
  assert.equal(f.counts.dispatch, 1); assert.equal(f.state.approval.executionKey, 'original-submit');
  await assert.rejects(f.submit({ ...submitInput, operationKey: 'replacement-submit', expectedRevision: 3 }), denied(409));
  f.fault.afterCommit = async tx => { if (tx.kind === 'command' && tx.records.approval.state === 'closed') throw new Error('Synthetic close COMMIT response lost'); };
  await assert.rejects(f.close(), /Synthetic close COMMIT response lost/u); assert.equal(f.state.approval.state, 'closed');
  assert.equal(f.state.receipts.find(row => row.operationKey === 'original-close').target, 'approval.close:a1');
  f.fault.afterCommit = null; f.rebuild(); const guards = f.counts.closeGuard, reads = f.counts.originalReads.length;
  const recovered = await f.close(); assert.equal(recovered.approval.state, 'closed'); assert.equal(recovered.original.state, 'closed'); assert.equal(recovered.retryable, false);
  const original = await f.submit(); assert.equal(original.original.state, 'closed');
  assert.equal(f.counts.dispatch, 1); assert.equal(f.counts.closeGuard, guards); assert.equal(f.counts.originalReads.length, reads, 'closed recovery must not dispatch or read a different Core key');
  await assert.rejects(f.close({ ...closeInput, reason: 'Changed input under the same key' }), denied(409));
  assert.equal(f.state.receipts.some(row => row.operationKey === 'replacement-submit'), false); assertEmptyCore(f);
});

test('any original quote/order/idempotency consumption evidence blocks real close, including incomplete or inconsistent receipts', async () => {
  const evidence = [
    ['quote consumedAt', f => { f.state.quote.consumedAt = new Date().toISOString(); }],
    ['quote consumedOrderId', f => { f.state.quote.consumedOrderId = 'unobserved-order'; }],
    ['order by original quote', f => { f.state.orders.push({ id: 'unlinked-order', tenantId: 't1', workspaceId: 'w1', quoteId: 'q1', customerId: 'other' }); }],
    ['idempotency without an order', f => { f.state.idempotency.push({ tenantId: 't1', workspaceId: 'w1', action: 'rental.order.create', idempotencyKey: 'original-submit', requestHash: f.state.approval.requestFingerprint, orderId: null }); }],
    ['idempotency with inconsistent fingerprint', f => { f.state.idempotency.push({ tenantId: 't1', workspaceId: 'w1', action: 'rental.order.create', idempotencyKey: 'original-submit', requestHash: 'wrong-fingerprint', orderId: 'unobserved-order' }); }]
  ];
  for (const [label, inject] of evidence) {
    const f = fixture(); await bindFailedCore(f); inject(f); const before = plain(f.state);
    await assert.rejects(f.close(), error => denied(409)(error) && /消费证据或关联待核对/u.test(error.message), label);
    assert.deepEqual(plain(f.state), before, label); assert.equal(f.counts.closeGuard, 1); assert.equal(f.counts.dispatch, 1);
    assert.equal(f.state.approval.state, 'executing'); assert.equal(f.state.receipts.some(row => row.operationKey === 'original-close'), false);
  }
});

test('close missing original receipt or storage failure cannot publish success or leave a half-closed approval', async () => {
  for (const faultName of ['missing-receipt', 'receipt-insert-failure']) {
    const f = fixture(); await bindFailedCore(f);
    if (faultName === 'missing-receipt') f.state.receipts.length = 0;
    else f.fault.sql = 'INSERT INTO enterprise_portal_operations';
    const before = plain(f.state);
    await assert.rejects(f.close(), error => faultName === 'missing-receipt' ? denied(409)(error) && /原执行收据关联缺失/u.test(error.message) : /Synthetic SQL failure/u.test(error.message));
    assert.deepEqual(plain(f.state), before); assert.equal(f.state.approval.state, 'executing'); assertEmptyCore(f);
    assert.equal(f.transactions.at(-1).status, 'rolled_back'); assert.equal(f.state.receipts.some(row => row.operationKey === 'original-close'), false);
  }
});

test('real policy/customer denial before binding, at late create/commit and after slow original reads never publishes success', async () => {
  const before = fixture(); before.auth.reviewer = false;
  await assert.rejects(before.submit(), denied(403)); assert.equal(before.state.approval.state, 'approved'); assert.equal(before.state.receipts.length, 0); assert.equal(before.counts.dispatch, 0); assertEmptyCore(before);
  const late = fixture(), ready = deferred(), resume = deferred();
  late.fault.beforePreparedReturn = async () => { ready.resolve(); await resume.promise; };
  const pending = outcome(late.submit()); await bounded(ready.promise, 'Late reviewer recheck not reached');
  late.auth.reviewer = false; resume.resolve(); assert.ok(denied(403)((await pending).error));
  assert.equal(late.state.approval.state, 'executing'); assertEmptyCore(late); assert.equal(late.state.receipts.length, 1);
  const commit = fixture(); commit.fault.afterIdempotencyRecord = () => { commit.auth.session = false; };
  await assert.rejects(commit.submit(), denied(403)); assert.equal(commit.state.approval.state, 'executing'); assertEmptyCore(commit);
  assert.equal(commit.events.some(e => e.event === 'idempotency.record'), true, 'denial occurs after real staged order/quote/idempotency writes');
  const slow = fixture(); await slow.submit(); slow.fault.afterOriginalRead = () => { slow.auth.session = false; };
  await assert.rejects(slow.result(), denied(403)); assert.equal(slow.state.approval.state, 'consumed'); assert.equal(slow.state.orders.length, 1);
  // Same-key command replay still rechecks current identity; a stored receipt
  // cannot restore an exited membership, even for a consumed or closed result.
  slow.auth.session = true; slow.auth.membership = 'closed';
  await assert.rejects(slow.close(), denied(403)); assert.equal(slow.state.receipts.some(row => row.operationKey === 'original-close'), false);
});

test('receipt TTL preserves the exact consumed approval order link; absent/wrong linkage and conflicting receipts never become observed', async () => {
  const f = fixture(), created = await f.submit();
  f.state.idempotency.length = 0; f.rebuild();
  const before = plain(f.state), transactions = f.transactions.length;
  const result = await f.result();
  assert.equal(result.approval.state, 'consumed'); assert.equal(result.original.state, 'observed');
  assert.equal(result.original.orderId, created.orderId); assert.equal(result.retryable, false);
  assert.deepEqual(f.counts.originalReads, ['original-submit']);
  assert.deepEqual(f.counts.originalLinkedOrderIds, [created.orderId], 'real approval.result must supply its durable consumed link');
  assert.deepEqual(plain(f.state), before); assert.equal(f.transactions.length, transactions);
  assert.equal(f.counts.dispatch, 1); assert.equal(f.counts.prepare, 1); assert.equal(f.counts.cache, 1);

  const cases = [
    ['missing durable approval link', x => { x.state.idempotency.length = 0; x.state.approval.orderId = null; }, 'not_observed', undefined],
    ['missing exact order despite another matching order', x => { x.state.idempotency.length = 0; x.state.orders[0].id = 'other-order'; }, 'unknown', 'o1'],
    ['linked order has wrong quote', x => { x.state.idempotency.length = 0; x.state.orders[0].quoteId = 'other-quote'; }, 'conflict', 'o1'],
    ['linked order has wrong customer', x => { x.state.idempotency.length = 0; x.state.orders[0].customerId = 'other-customer'; }, 'conflict', 'o1'],
    ['linked order outside tenant scope', x => { x.state.idempotency.length = 0; x.state.orders[0].tenantId = 'other-tenant'; }, 'unknown', 'o1'],
    ['receipt points to another otherwise matching order', x => { x.state.orders.push({ ...copy(x.state.orders[0]), id: 'other-order' }); x.state.idempotency[0].orderId = 'other-order'; }, 'conflict', 'o1'],
    ['existing receipt has null orderId', x => { x.state.idempotency[0].orderId = null; }, 'conflict', 'o1']
  ];
  for (const [label, alter, expected, forwardedLink] of cases) {
    const x = fixture(); await x.submit(); alter(x);
    const prior = plain(x.state), txCount = x.transactions.length;
    if (expected === 'conflict') await assert.rejects(x.result(), denied(409), label);
    else {
      const unreadable = await x.result(); assert.equal(unreadable.original.state, expected, label);
      assert.equal(unreadable.original.orderId, null, label); assert.equal(unreadable.retryable, false, label);
    }
    assert.deepEqual(x.counts.originalLinkedOrderIds, [forwardedLink], label);
    assert.deepEqual(x.counts.originalReads, ['original-submit'], label);
    assert.deepEqual(plain(x.state), prior, label); assert.equal(x.transactions.length, txCount, label);
    assert.equal(x.counts.dispatch, 1, label); assert.equal(x.counts.prepare, 1, label); assert.equal(x.counts.cache, 1, label);
  }
});

test('actual creation transaction takes ordinary Tenant S or enterprise Tenant X before the customer gate, never S then X', async () => {
  const file = path.join(root, 'apps/api/src/modules/rental-core/rental-order-confirmation.service.ts'), source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true); let callback;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'this.prisma.$transaction') callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }; visit(ast); assert.ok(callback, 'actual create transaction callback');
  const helper = load('apps/api/src/modules/rental-core/rental-business-fence.ts');
  for (const enterprise of [false, true]) {
    const trace = [], sentinel = new Error('stop before stock/business writes');
    const tx = { $queryRaw: async (query, ...values) => {
      const sql = Array.isArray(query) ? query.join('?') : query.sql;
      trace.push(sql.includes('LOCK IN SHARE MODE') ? 'Tenant:S' : 'Tenant:X'); return [{ id: 't1' }];
    } };
    const instance = { enterprisePolicies: { assertOrderCreation: async (_t, _w, _q, transaction) => { await transaction.$queryRaw`SELECT id FROM Tenant FOR UPDATE`; } },
      customerOperations: { assertTransactableForNewBusiness: async () => { trace.push('customer:X'); throw sentinel; } } };
    const expression = ts.transpileModule(`(function () { return ${callback.getText(ast)}; }).call(instance)`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const closure = vm.runInNewContext(expression, {
      instance, quote: { membershipSnapshot: { bookingIdentity: enterprise ? 'enterprise_employee' : 'personal' } }, tenantId: 't1', workspaceId: 'w1',
      approvalBinding: undefined, approval: undefined, input: { customerId: 'p1' }, lockRentalBusinessTenant: helper.lockRentalBusinessTenant,
    });
    await assert.rejects(closure(tx), error => error === sentinel);
    assert.deepEqual(trace, [enterprise ? 'Tenant:X' : 'Tenant:S', 'customer:X']);
  }
});

test.after(() => {
  assert.equal(fs.readFileSync(process.env.AI_OFFLINE_AUDIT, 'utf8'), auditStarted, 'offline preload must record no network/env/outside-root refusal');
  fs.appendFileSync(process.env.AI_OFFLINE_AUDIT, 'core-execution: no guarded network/env/outside-root attempt observed\n');
  for (const [file, hash] of sources) {
    assert.equal(createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex'), hash, 'loaded source changed during this bounded run');
    console.log(`Executed source SHA256 ${hash} ${file}`);
  }
  console.log('Scope: real Enterprise submit/close/result/command execute, policy revalidation/creation/reviewer checks, Core createApprovedOrder/create/close guard/readOrderCreation; explicit storage/domain/ClientApi doubles. MySQL/HTTP/real stock/funding remain unverified.');
});
