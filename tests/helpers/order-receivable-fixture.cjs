'use strict';
const { Prisma } = require('@prisma/client');
const { RentalFundingService } = require('../../apps/api/src/modules/rental-core/rental-funding.service');
const { RentalOrderReceivableRepository } = require('../../apps/api/src/modules/rental-core/rental-order-receivable.repository');
const { CustomerCorporateSettlementService } = require('../../apps/api/src/modules/platform/customer-corporate-settlement.service');
const { PlatformRepository } = require('../../apps/api/src/modules/platform/platform.repository');
const { runWithRequestIdentity } = require('../../apps/api/src/common/request-identity');
const money = value => new Prisma.Decimal(value);

/** Explicit original facts and rollback only; not a MySQL lock/isolations emulator. */
function receivableFixture() {
  const tenantId = 'tenant', workspaceId = 'workspace', customerId = 'corporate', orderId = 'order';
  const db = { events: [], rows: [], trace: [], orders: new Map(), registrations: [], intents: [], refunds: [], webhooks: [] };
  const order = { id: orderId, orderNo: 'ORDER', tenantId, workspaceId, status: 'DRAFT', currency: 'CNY',
    contractSubjectCustomerId: customerId, payerSubjectCustomerId: customerId,
    membershipSnapshot: { enterpriseContractAndPayer: true, corporateCustomerId: customerId,
      settlement: { mode: 'credit', payerCustomerId: customerId, currency: 'CNY', billingCycle: 'monthly',
        creditId: 'credit', creditRevision: 1, confirmedAt: '2026-10-22T00:00:00Z' } },
    finalPayableAmount: money(100), depositAmount: money(0), preAuthAmount: money(0), ruleSnapshot: {} };
  db.orders.set(order.id, order);
  db.credit = { id: 'credit', tenantId, customerId, status: 'active', billingCycle: 'monthly', revision: 1,
    creditLimit: money(500), settlementTermDays: 30 };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Prisma.Decimal)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      throw new Error(`Unexpected receivable fixture predicate: ${key}`);
    }
    return row[key] === value;
  });
  const find = (rows, where) => rows.filter(row => matches(row, where));
  db.rentalOrder = { findFirst: async ({ where }) => find([...db.orders.values()], where)[0] ?? null,
    findFirstOrThrow: async ({ where }) => { const row = find([...db.orders.values()], where)[0]; if (!row) throw Error('Missing scoped order'); return { ...row }; } };
  db.rentalOrderExtension = { findMany: async () => [] };
  db.rentalFundingEvent = { findMany: async ({ where }) => find(db.events, where),
    findUnique: async ({ where }) => find(db.events, where.workspaceId_orderId_instrument_action_idempotencyKey)[0] ?? null,
    create: async ({ data }) => { const row = { ...data, createdAt: new Date() }; db.events.push(row); return row; } };
  db.rentalOfflinePaymentRegistration = { findMany: async ({ where }) => find(db.registrations, where),
    findFirst: async ({ where }) => find(db.registrations, where)[0] ?? null };
  db.rentalPaymentIntent = { findMany: async ({ where }) => find(db.intents, where),
    findFirst: async ({ where }) => find(db.intents, where)[0] ?? null,
    findUnique: async ({ where }) => find(db.intents, Object.values(where)[0])[0] ?? null,
    updateMany: async ({ where, data }) => { const rows = find(db.intents, where); rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; },
    update: async ({ where, data }) => { const row = find(db.intents, where)[0]; if (!row) throw Error('Missing original payment'); Object.assign(row, data); return row; },
    create: async ({ data }) => { const row = { id: `intent-${db.intents.length}`, ...data }; db.intents.push(row); return row; } };
  db.rentalPaymentRefund = { findFirst: async ({ where }) => find(db.refunds, where)[0] ?? null,
    findMany: async ({ where }) => find(db.refunds, where),
    create: async ({ data }) => { const row = { id: `refund-${db.refunds.length}`, ...data }; db.refunds.push(row); return row; } };
  db.paymentWebhookEvent = { findUnique: async ({ where }) => find(db.webhooks, where.provider_eventId)[0] ?? null,
    create: async ({ data }) => { const row = { id: `webhook-${db.webhooks.length}`, ...data }; db.webhooks.push(row); return row; },
    update: async ({ where, data }) => { const row = find(db.webhooks, where)[0]; if (!row) throw Error('Missing webhook'); Object.assign(row, data); return row; } };
  db.customerCorporateCredit = { findFirst: async ({ where }) => db.credit && matches(db.credit, where) ? db.credit : null };
  let sequence = 0;
  db.customerCorporateCreditLedger = {
    findMany: async ({ where, take }) => find(db.rows, where).slice(0, take ?? db.rows.length),
    findFirst: async ({ where }) => find(db.rows, where)[0] ?? null,
    findUnique: async ({ where }) => find(db.rows, where.tenantId_customerId_idempotencyKey)[0] ?? null,
    aggregate: async ({ where }) => ({ _sum: find(db.rows, where).reduce((sum, row) => ({
      reservedDelta: sum.reservedDelta.plus(row.reservedDelta), receivableDelta: sum.receivableDelta.plus(row.receivableDelta)
    }), { reservedDelta: money(0), receivableDelta: money(0) }) }),
    create: async ({ data }) => {
      if (db.failLedgerCreate) throw Error('credit ledger unavailable');
      if (db.rows.some(row => row.tenantId === data.tenantId && row.customerId === data.customerId && row.idempotencyKey === data.idempotencyKey)) throw Error('Duplicate ledger key');
      const row = { ...data, occurredAt: new Date(1793400000000 + sequence++), createdAt: new Date() }; db.rows.push(row); return row;
    }
  };
  db.operationLog = { findUnique: async () => null };
  db.businessWorkspace = { findFirst: async ({ where }) => where.tenantId === tenantId && where.id === workspaceId
    ? { id: workspaceId, runMode: 'production' } : null };
  db.workspaceMember = { findFirst: async ({ where }) => where.userId === 'operator' && where.workspaceId === workspaceId
    ? { isActive: true, dataScope: 'ALL', locationScope: { mode: 'all', locationIds: [] }, role: null } : null };
  db.$queryRaw = async query => {
    db.trace.push({ sql: query.sql, values: query.values });
    if (db.beforeQuery) await db.beforeQuery(query);
    if (query.sql.includes('FROM rental_orders')) {
      const row = [...db.orders.values()].find(row => [row.id, row.tenantId, row.workspaceId].every(value => query.values.includes(value)));
      return row ? [{ ...row }] : [];
    }
    if (query.sql.includes('FROM customer_corporate_credits')) return db.credit
      && query.values.includes(db.credit.tenantId) && query.values.includes(db.credit.customerId) ? [{ id: db.credit.id }] : [];
    if (query.sql.includes('FROM customer_corporate_credit_ledger')) return db.rows.filter(row => query.values.includes(row.tenantId) && query.values.includes(row.customerId)).slice(0, 501);
    if (query.sql.includes('FROM rental_funding_events')) return db.events.filter(row => [row.tenantId, row.workspaceId, row.orderId].every(value => query.values.includes(value)));
    if (query.sql.includes('FROM rental_payment_intents')) return db.intents.filter(row => [row.tenantId, row.workspaceId, row.orderId].every(value => query.values.includes(value)));
    if (query.sql.includes('FROM rental_offline_payment_registrations')) return db.registrations.filter(row => row.status === 'confirmed'
      && row.fundingEventId && [row.tenantId, row.workspaceId, row.orderId].every(value => query.values.includes(value)));
    if (query.sql.includes('FROM business_workspaces')) return query.values.includes(workspaceId) && query.values.includes(tenantId) ? [{ runMode: 'production' }] : [];
    throw Error(`Unexpected receivable fixture SQL: ${query.sql}`);
  };
  db.$transaction = async callback => {
    const snapshots = ['events', 'rows', 'intents', 'refunds', 'webhooks'].map(key => [key, db[key].map(row => ({ ...row }))]);
    try { return await callback(db); }
    catch (error) { for (const [key, rows] of snapshots) db[key] = rows; throw error; }
  };
  const receivables = new RentalOrderReceivableRepository(db), funding = new RentalFundingService(db, receivables);
  const principals = new PlatformRepository(db);
  principals.findUserById = async () => ({ id: 'operator', tenantId, isActive: true, isPlatformAdmin: true,
    isSaasAdmin: false, permissions: ['*'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } });
  const corporate = new CustomerCorporateSettlementService(db, funding, principals);
  const inScope = work => runWithRequestIdentity({ tenantId, workspaceId, userId: 'operator', audience: 'operator',
    isSaasAdmin: false, permissions: ['*'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }, work);
  const seedDebt = async () => { await corporate.reserveOrderCredit(tenantId, orderId, db); await corporate.settleOrderCredit(tenantId, orderId, db); order.status = 'SETTLING'; };
  const payCorporate = amount => inScope(() => corporate.recordPayment(tenantId, customerId,
    { amount, reason: 'original repayment', idempotencyKey: `corporate-${db.rows.length}` }, 'operator'));
  const cashInput = (amount, key, action = 'initiate') => ({ instrument: 'rental', action, amount,
    provider: 'alipay', verifiedExternalReceipt: true, idempotencyKey: key, reason: 'original verified payment' });
  const payCash = (amount, key = 'cash-original') => funding.recordEvent(tenantId, workspaceId, orderId, cashInput(amount, key));
  const debt = () => db.rows.filter(row => row.orderId === orderId).reduce((sum, row) => sum + Number(row.receivableDelta), 0);
  return { db, order, funding, corporate, receivables, tenantId, workspaceId, customerId, orderId,
    inScope, seedDebt, payCorporate, payCash, cashInput, debt, money };
}
module.exports = { receivableFixture };
