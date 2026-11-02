const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { Prisma } = require("@prisma/client");
const { CustomerCorporateSettlementService } = require("../apps/api/src/modules/platform/customer-corporate-settlement.service");
const { PlatformRepository } = require("../apps/api/src/modules/platform/platform.repository");
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");

const money = (value) => new Prisma.Decimal(value);
const tenantId = "tenant-credit-test";
const customerId = "customer-corporate-test";
const orderId = "order-credit-test";

class FakeLedger {
  constructor() { this.rows = []; }

  scoped(where) {
    return this.rows.filter((row) =>
      row.tenantId === where.tenantId &&
      row.customerId === where.customerId &&
      (where.id === undefined || row.id === where.id) &&
      (where.workspaceId === undefined || row.workspaceId === where.workspaceId) &&
      (where.orderId === undefined || row.orderId === where.orderId) &&
      (!where.currency?.not || row.currency !== where.currency.not)
    );
  }

  async aggregate({ where }) {
    return this.scoped(where).reduce((result, row) => ({
      _sum: {
        reservedDelta: result._sum.reservedDelta.plus(row.reservedDelta),
        receivableDelta: result._sum.receivableDelta.plus(row.receivableDelta)
      }
    }), { _sum: { reservedDelta: money(0), receivableDelta: money(0) } });
  }

  async findUnique({ where }) {
    const key = where.tenantId_customerId_idempotencyKey;
    return this.rows.find((row) => row.tenantId === key.tenantId && row.customerId === key.customerId && row.idempotencyKey === key.idempotencyKey) ?? null;
  }

  async create({ data }) {
    const row = { ...data, occurredAt: new Date(), createdAt: new Date() };
    this.rows.push(row);
    return row;
  }

  async findMany({ where }) { return this.scoped(where).sort((a, b) => a.occurredAt - b.occurredAt); }
  async findFirst({ where }) { return this.scoped(where)[0] ?? null; }
}

class FakeDb {
  constructor() {
    this.ledger = new FakeLedger();
    this.credit = { id: "credit-1", tenantId, customerId, creditLimit: money(500), status: "active", billingCycle: "monthly", settlementTermDays: 30, revision: 1 };
    this.cash = 0;
    // Explicit net real-cash fact; allocations are deliberately not included.
    this.funding = { netCashPaid: async () => this.cash };
    this.originalOrders = new Map();
    this.currentOrder = {
      id: orderId,
      tenantId,
      workspaceId: "workspace-credit-test",
      status: "DRAFT", currency: "CNY", contractSubjectCustomerId: customerId, payerSubjectCustomerId: customerId,
      membershipSnapshot: { enterpriseContractAndPayer: true, corporateCustomerId: customerId,
        settlement: { mode: "credit", payerCustomerId: customerId, currency: "CNY", billingCycle: "monthly",
          creditId: "credit-1", creditRevision: 1, confirmedAt: "2026-10-22T00:00:00.000Z" } },
      finalPayableAmount: money(100)
    };
    this.baseUser = { id: "operator", tenantId, isActive: true, isSaasAdmin: false, isPlatformAdmin: true,
      permissions: ["*"], dataScope: "all", locationScope: { mode: "all", locationIds: [] } };
    this.members = new Map([["workspace-credit-test", { isActive: true, dataScope: "ALL", locationScope: { mode: "all", locationIds: [] }, role: null }]]);
    this.workspaceMember = { findFirst: async ({ where }) => where.userId === this.baseUser.id ? this.members.get(where.workspaceId) ?? null : null };
    this.businessWorkspace = { findFirst: async ({ where }) => where.tenantId === tenantId && this.members.has(where.id) ? { id: where.id } : null };
    this.customerCorporateCreditLedger = this.ledger;
    this.maturities = new Map();
    this.operationLog = { findUnique: async ({ where }) => this.maturities.get(where.id) ?? null,
      findFirst: async ({ where }) => [...this.maturities.values()].find(row => row.tenantId === where.tenantId && row.detail.customerId === where.AND[0].detail.equals && row.detail.idempotencyKey === where.AND[1].detail.equals) ?? null,
      create: async ({ data }) => { this.maturities.set(data.id, { ...data, createdAt: new Date() }); return data; } };
    this.customerCorporateCredit = {
      findFirst: async () => this.credit
    };
    this.rentalOrder = {
      findFirst: async () => this.currentOrder,
      updateMany: async ({ where, data }) => {
        if (where.status !== this.currentOrder.status || JSON.stringify(where.membershipSnapshot.equals) !== JSON.stringify(this.currentOrder.membershipSnapshot)) return { count: 0 };
        this.currentOrder.membershipSnapshot = data.membershipSnapshot;
        return { count: 1 };
      }
    };
  }

  get currentOrder() { return this._currentOrder; }
  set currentOrder(order) {
    this._currentOrder = order;
    this.originalOrders.set(order.id, order);
  }

  async $queryRaw(query) {
    if (query.sql.includes("FROM rental_orders")) {
      const [tenant, workspace, id] = query.values;
      const order = this.originalOrders.get(id);
      return order?.tenantId === tenant && order.workspaceId === workspace ? [{ id: order.id }] : [];
    }
    if (query.sql.includes("FROM customer_corporate_credits")) return this.credit ? [{ id: this.credit.id }] : [];
    if (query.sql.includes("FROM customer_corporate_credit_ledger")) {
      const cursor = query.sql.includes("AND id >") ? query.values.at(-1) : undefined;
      return this.ledger.scoped({ tenantId: query.values[0], customerId: query.values[1] })
        .filter(row => cursor === undefined || row.id > cursor)
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, 500);
    }
    throw new Error(`Unexpected credit fixture SQL: ${query.sql}`);
  }
  async $transaction(callback) {
    const rows = this.ledger.rows.map(row => ({ ...row })), maturities = new Map(this.maturities);
    try { return await callback(this); } catch (error) { this.ledger.rows = rows; this.maturities = maturities; throw error; }
  }
}

const serviceFor = (db) => {
  const principals = new PlatformRepository(db);
  principals.findUserById = async () => db.baseUser;
  return new CustomerCorporateSettlementService(db, db.funding, principals);
};
const service = serviceFor(new FakeDb());
const db = service.prisma;
let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

runWithRequestIdentity({ tenantId, workspaceId: "workspace-credit-test", userId: "operator", audience: "operator",
  isSaasAdmin: false, permissions: ["*"], dataScope: "all", locationScope: { mode: "all", locationIds: [] } }, async () => {
  assert.equal(await service.requiresCreditSettlement(tenantId, orderId), true);
  const reserved = await service.reserveOrderCredit(tenantId, orderId, db, "operator");
  assert.equal(reserved.reservedAmount, 100);
  assert.equal(reserved.availableAmount, 400);
  const replay = await service.reserveOrderCredit(tenantId, orderId, db, "operator");
  assert.equal(replay.reservedAmount, 100);
  assert.equal(db.customerCorporateCreditLedger.rows.length, 1);
  ok("确认时占用企业授信且重复请求只产生一条流水");

  await assert.rejects(
    () => service.reserveExtensionCredit(tenantId, orderId, "extension-too-large", 450, db, "operator"),
    /可用授信额度不足/u
  );
  ok("新增占用超过额度时拒绝，而不是把可用额度写成负数");

  const released = await service.releaseOrderCredit(tenantId, orderId, "订单取消", db, "operator");
  assert.equal(released.reservedAmount, 0);
  assert.equal(released.availableAmount, 500);
  ok("订单取消释放本单占用并恢复可用额度");

  await service.reserveOrderCredit(tenantId, orderId, db, "operator");
  db.currentOrder.finalPayableAmount = money(130);
  const settled = await service.settleOrderCredit(tenantId, orderId, db, "operator");
  assert.equal(settled.reservedAmount, 0);
  assert.equal(settled.receivableAmount, 130);
  ok("结算按最终订单金额把占用转成应收，并补记最终差额");

  const afterPayment = await service.recordPayment(tenantId, customerId, {
    amount: 80,
    reason: "企业回款",
    idempotencyKey: "payment-1"
  }, "operator");
  assert.equal(afterPayment.receivableAmount, 50);
  const allocated = db.ledger.rows.filter((row) => row.entryType === "payment_allocation" && row.orderId === orderId);
  assert.equal(allocated.length, 1);
  assert.equal(Number(allocated[0].receivableDelta), -80);
  assert.equal(db.ledger.rows.filter((row) => row.entryType === "payment").reduce((sum, row) => sum + Number(row.amount), 0), 80, "回款与核销类型分开，收入统计不重复累计");
  const paymentReplay = await service.recordPayment(tenantId, customerId, {
    amount: 80,
    reason: "企业回款",
    idempotencyKey: "payment-1"
  }, "operator");
  assert.equal(paymentReplay.receivableAmount, 50);
  await assert.rejects(
    () => service.recordPayment(tenantId, customerId, { amount: 60, reason: "超额回款", idempotencyKey: "payment-2" }, "operator"),
    /不能超过企业当前应收/u
  );
  ok("企业回款支持部分回款、幂等重试，并拒绝超额登记");

  await assert.rejects(() => service.recordPayment(tenantId, customerId, {
    amount: 80, reason: "另一笔回款", idempotencyKey: "payment-1"
  }, "operator"), /幂等键已用于不同/u);
  ok("回款幂等重试同时核对原因，不能复用流水冒充另一笔回款");

  const cancelledDb = new FakeDb();
  const cancelledService = serviceFor(cancelledDb);
  await cancelledService.reserveOrderCredit(tenantId, orderId, cancelledDb);
  cancelledDb.currentOrder.finalPayableAmount = money(25);
  const cancellation = await cancelledService.settleCancelledOrderCredit(tenantId, orderId, "取消费", cancelledDb);
  assert.equal(cancellation.reservedAmount, 0);
  assert.equal(cancellation.receivableAmount, 25);
  await cancelledService.settleCancelledOrderCredit(tenantId, orderId, "取消费", cancelledDb);
  assert.equal((await cancelledService.account(tenantId, customerId)).receivableAmount, 25);
  ok("企业订单取消费转应收、释放剩余额度，重复取消不重复计费");

  const excessDb = new FakeDb();
  const excessService = serviceFor(excessDb);
  await excessService.reserveOrderCredit(tenantId, orderId, excessDb);
  excessDb.currentOrder.finalPayableAmount = money(650);
  const excess = await excessService.settleOrderCredit(tenantId, orderId, excessDb);
  assert.equal(excess.receivableAmount, 650);
  assert.equal(excess.availableAmount, -150);
  await excessService.recordPayment(tenantId, customerId, { amount: 200, reason: "偿还超额债务", idempotencyKey: "excess-payment" });
  assert.equal((await excessService.account(tenantId, customerId)).receivableAmount, 450);
  ok("真实最终债务超过授信仍可入账并回款，不把额度限制误用成账务阻断");

  const zeroDb = new FakeDb();
  const zeroService = serviceFor(zeroDb);
  await zeroService.reserveOrderCredit(tenantId, orderId, zeroDb);
  zeroDb.currentOrder.finalPayableAmount = money(0);
  await zeroService.settleCancelledOrderCredit(tenantId, orderId, "免费取消", zeroDb);
  const zeroCount = zeroDb.ledger.rows.length;
  await zeroService.settleCancelledOrderCredit(tenantId, orderId, "免费取消", zeroDb);
  assert.equal(zeroDb.ledger.rows.length, zeroCount);
  assert.equal((await zeroService.account(tenantId, customerId)).reservedAmount, 0);
  ok("零费用取消保留结算幂等标记，不反复释放额度");

  const splitDb = new FakeDb();
  const splitService = serviceFor(splitDb);
  await splitService.reserveOrderCredit(tenantId, orderId, splitDb);
  await splitService.settleOrderCredit(tenantId, orderId, splitDb);
  const firstDebtEntry = splitDb.ledger.rows.find(row => row.orderId === orderId && row.receivableDelta.gt(money(0)));
  await splitService.recordMaturity(tenantId, customerId, { ledgerId: firstDebtEntry.id,
    dueAt: new Date(Date.now() + 86400000).toISOString(), basisRef: "contract-original", reason: "财务核定", idempotencyKey: "maturity-first" },
    "operator", splitDb.currentOrder.workspaceId);
  splitDb.currentOrder = { ...splitDb.currentOrder, id: "order-second", finalPayableAmount: money(60) };
  await splitService.reserveOrderCredit(tenantId, "order-second", splitDb);
  await splitService.settleOrderCredit(tenantId, "order-second", splitDb);
  await splitService.recordPayment(tenantId, customerId, { amount: 130, reason: "分单回款", idempotencyKey: "split-payment" });
  const firstDebt = splitDb.ledger.rows.filter((row) => row.orderId === orderId).reduce((sum, row) => sum + Number(row.receivableDelta), 0);
  const secondDebt = splitDb.ledger.rows.filter((row) => row.orderId === "order-second").reduce((sum, row) => sum + Number(row.receivableDelta), 0);
  assert.equal(firstDebt, 0);
  assert.equal(secondDebt, 30);
  ok("一笔回款按应收入账顺序跨订单核销，总账和逐单余额一致");

  const prepaidDb = new FakeDb();
  const prepaidService = serviceFor(prepaidDb);
  delete prepaidDb.currentOrder.membershipSnapshot.settlement;
  prepaidDb.credit.billingCycle = "per_order";
  assert.equal(await prepaidService.freezeOrderSettlement(tenantId, orderId, prepaidDb), false);
  prepaidDb.currentOrder.status = "RESERVED";
  prepaidDb.credit.billingCycle = "monthly";
  prepaidDb.cash = 100;
  assert.equal(await prepaidService.requiresCreditSettlement(tenantId, orderId), false);
  assert.equal(await prepaidService.allowsExtensionCredit(tenantId, orderId), false);
  await prepaidService.settleOrderCredit(tenantId, orderId, prepaidDb);
  assert.equal(prepaidDb.ledger.rows.length, 0);
  ok("已确认按单企业订单不随主档改月结，已付现金不再形成企业债权");

  const frozenDb = new FakeDb();
  const frozenService = serviceFor(frozenDb);
  delete frozenDb.currentOrder.membershipSnapshot.settlement;
  assert.equal(await frozenService.freezeOrderSettlement(tenantId, orderId, frozenDb), true);
  await assert.rejects(() => frozenService.assertReadyForPickup(tenantId, orderId, frozenDb), /足额有效授信占用/u);
  await frozenService.reserveOrderCredit(tenantId, orderId, frozenDb);
  frozenDb.currentOrder.status = "RESERVED";
  frozenDb.credit.billingCycle = "per_order";
  assert.equal(await frozenService.requiresCreditSettlement(tenantId, orderId), true);
  await frozenService.assertReadyForPickup(tenantId, orderId, frozenDb);
  await assert.rejects(() => frozenService.allowsExtensionCredit(tenantId, orderId), /不允许新增挂账/u);
  await frozenService.settleOrderCredit(tenantId, orderId, frozenDb);
  assert.equal((await frozenService.account(tenantId, customerId)).receivableAmount, 100);
  ok("月结旧单保留原责任，0/0不能领取，主档停挂账只拒绝新占用");

  const partialDb = new FakeDb();
  const partialService = serviceFor(partialDb);
  partialDb.cash = 30;
  await partialService.reserveOrderCredit(tenantId, orderId, partialDb);
  assert.equal((await partialService.account(tenantId, customerId)).reservedAmount, 70);
  await partialService.assertReadyForPickup(tenantId, orderId, partialDb);
  partialDb.cash = 100;
  await partialService.settleOrderCredit(tenantId, orderId, partialDb);
  assert.equal((await partialService.account(tenantId, customerId)).reservedAmount, 0);
  assert.equal((await partialService.account(tenantId, customerId)).receivableAmount, 0);
  ok("可信实收与授信占用共同覆盖本单金额，现金补结不会重复形成企业应收");

  const legacyDb = new FakeDb();
  const legacyService = serviceFor(legacyDb);
  delete legacyDb.currentOrder.membershipSnapshot.settlement;
  legacyDb.currentOrder.status = "RESERVED";
  await assert.rejects(() => legacyService.requiresCreditSettlement(tenantId, orderId), /缺少结算快照/u);
  await assert.rejects(() => legacyService.freezeOrderSettlement(tenantId, orderId, legacyDb), /不能重新选择/u);
  legacyDb.cash = 100;
  assert.equal(await legacyService.requiresCreditSettlement(tenantId, orderId), false);
  legacyDb.cash = 0;
  legacyDb.ledger.rows.push({ tenantId, customerId, workspaceId: legacyDb.currentOrder.workspaceId, orderId,
    entryType: "reserve", currency: "CNY", reservedDelta: money(100), receivableDelta: money(0) });
  assert.equal(await legacyService.requiresCreditSettlement(tenantId, orderId), true);
  ok("缺快照旧单只沿原可信付款/占用判断，未知不读当前月结补造历史");

  const noCreditDb = new FakeDb();
  const noCreditService = serviceFor(noCreditDb);
  delete noCreditDb.currentOrder.membershipSnapshot.settlement;
  noCreditDb.credit = null;
  assert.equal(await noCreditService.freezeOrderSettlement(tenantId, orderId, noCreditDb), false);
  assert.equal(noCreditDb.currentOrder.membershipSnapshot.settlement.mode, "per_order");
  ok("未申请授信的预付企业无需虚构额度，可冻结真实按单方式");

  const zeroPickupDb = new FakeDb();
  zeroPickupDb.currentOrder.finalPayableAmount = money(0);
  await serviceFor(zeroPickupDb).assertReadyForPickup(tenantId, orderId, zeroPickupDb);
  const changedDb = new FakeDb();
  changedDb.currentOrder.payerSubjectCustomerId = "other-customer";
  await assert.rejects(() => serviceFor(changedDb).requiresCreditSettlement(tenantId, orderId), /付款主体/u);
  const casDb = new FakeDb();
  delete casDb.currentOrder.membershipSnapshot.settlement;
  casDb.rentalOrder.updateMany = async () => ({ count: 0 });
  await assert.rejects(() => serviceFor(casDb).freezeOrderSettlement(tenantId, orderId, casDb), /确认依据已变化/u);
  ok("零价不虚构占用，错付款主体和确认CAS冲突仍拒绝");

  await frozenService.recordPayment(tenantId, customerId, { amount: 100, reason: "原单已回款", idempotencyKey: "pickup-paid" });
  await frozenService.assertReadyForPickup(tenantId, orderId, frozenDb);
  ok("已履行企业回款的原单不因当前占用/应收归零被误拒绝领取");

  const foreignDb = new FakeDb();
  const foreignService = serviceFor(foreignDb);
  foreignDb.currentOrder.currency = "HKD";
  delete foreignDb.currentOrder.membershipSnapshot.settlement;
  await assert.rejects(() => foreignService.assertQuoteCreditCurrency(tenantId, foreignDb.currentOrder.membershipSnapshot, "HKD"), /只支持 CNY/u);
  await assert.rejects(() => foreignService.freezeOrderSettlement(tenantId, orderId, foreignDb), /只支持 CNY/u);
  assert.equal(foreignDb.currentOrder.membershipSnapshot.settlement, undefined);
  foreignDb.currentOrder.membershipSnapshot.settlement = { ...db.currentOrder.membershipSnapshot.settlement, currency: "HKD" };
  for (const action of [
    () => foreignService.reserveOrderCredit(tenantId, orderId, foreignDb),
    () => foreignService.allowsExtensionCredit(tenantId, orderId),
    () => foreignService.reserveExtensionCredit(tenantId, orderId, "foreign-extension", 10, foreignDb),
    () => foreignService.reserveOrderChangeCredit(tenantId, orderId, "foreign-change", 10, foreignDb),
    () => foreignService.settleOrderCredit(tenantId, orderId, foreignDb)
  ]) await assert.rejects(action, /只支持 CNY/u);
  assert.equal(foreignDb.ledger.rows.length, 0);
  ok("非CNY授信报价/确认/续租/变更拒绝，旧单善后不改标CNY产生新债权");

  foreignDb.credit.billingCycle = "per_order";
  delete foreignDb.currentOrder.membershipSnapshot.settlement;
  await foreignService.assertQuoteCreditCurrency(tenantId, foreignDb.currentOrder.membershipSnapshot, "HKD");
  assert.equal(await foreignService.freezeOrderSettlement(tenantId, orderId, foreignDb), false);
  assert.equal(foreignDb.currentOrder.membershipSnapshot.settlement.currency, "HKD");
  await foreignService.assertQuoteCreditCurrency(tenantId, { enterpriseContractAndPayer: false }, "USD");
  ok("非CNY预付企业与个人不被授信限制误伤，原币种保持不变");

  assert.ok(db.ledger.rows.every(row => row.currency === "CNY"));
  const replayDb = new FakeDb();
  const replayService = serviceFor(replayDb);
  await replayService.reserveOrderCredit(tenantId, orderId, replayDb);
  replayDb.ledger.rows[0].currency = "HKD";
  await assert.rejects(() => replayService.reserveOrderCredit(tenantId, orderId, replayDb), /幂等键.*不同/u);
  await assert.rejects(() => replayService.account(tenantId, customerId), /不能合计为人民币/u);
  await assert.rejects(() => replayService.recordPayment(tenantId, customerId, { amount: 1, currency: "HKD", reason: "原币种", idempotencyKey: "foreign-payment" }), /只支持 CNY/u);
  assert.equal(replayDb.ledger.rows.length, 1);
  ok("原币种参与幂等核对，混币总账和非CNY回款拒绝而不改写历史流水");

  const maturityDb = new FakeDb();
  const maturityService = serviceFor(maturityDb);
  await maturityService.reserveOrderCredit(tenantId, orderId, maturityDb);
  await maturityService.settleOrderCredit(tenantId, orderId, maturityDb);
  const debtEntry = maturityDb.ledger.rows.find(row => row.receivableDelta.gt(money(0)));
  maturityDb.currentOrder = { ...maturityDb.currentOrder, id: "maturity-next" };
  await assert.rejects(() => maturityService.reserveOrderCredit(tenantId, "maturity-next", maturityDb), /未核定到期日/u);
  const maturityInput = { ledgerId: debtEntry.id, dueAt: new Date(Date.now() - 86400000).toISOString(),
    basisRef: "invoice-original", reason: "财务按原账单核定", idempotencyKey: "maturity-original" };
  const receipt = await maturityService.recordMaturity(tenantId, customerId, maturityInput, "operator", maturityDb.currentOrder.workspaceId);
  assert.deepEqual(await maturityService.recordMaturity(tenantId, customerId, maturityInput, "operator", maturityDb.currentOrder.workspaceId), receipt);
  assert.equal(maturityDb.maturities.size, 1);
  await assert.rejects(() => maturityService.recordMaturity(tenantId, customerId, { ...maturityInput, dueAt: new Date(Date.now() + 86400000).toISOString(), idempotencyKey: "other" }, "operator", maturityDb.currentOrder.workspaceId), /不能用另一操作覆盖/u);
  await assert.rejects(() => maturityService.recordMaturity(tenantId, customerId, maturityInput, "operator", "other-space"), /当前企业与空间/u);
  await assert.rejects(() => maturityService.reserveOrderCredit(tenantId, "maturity-next", maturityDb), /已到期未偿/u);
  await assert.rejects(() => maturityService.reserveExtensionCredit(tenantId, "maturity-next", "overdue-extension", 10, maturityDb), /已到期未偿/u);
  await assert.rejects(() => maturityService.reserveOrderChangeCredit(tenantId, "maturity-next", "overdue-change", 10, maturityDb), /已到期未偿/u);
  await maturityService.recordPayment(tenantId, customerId, { amount: 50, reason: "部分回款", idempotencyKey: "maturity-partial" });
  await assert.rejects(() => maturityService.reserveOrderCredit(tenantId, "maturity-next", maturityDb), /已到期未偿/u);
  await maturityService.recordPayment(tenantId, customerId, { amount: 50, reason: "结清原债权", idempotencyKey: "maturity-final" });
  await maturityService.reserveOrderCredit(tenantId, "maturity-next", maturityDb);
  assert.equal((await maturityService.account(tenantId, customerId)).reservedAmount, 100);
  assert.equal((await maturityService.account(tenantId, customerId)).receivableAmount, 0);
  assert.deepEqual(await maturityService.readMaturity(tenantId, customerId, debtEntry.id, maturityDb.currentOrder.workspaceId), receipt);
  await assert.rejects(() => maturityService.readMaturity(tenantId, customerId, debtEntry.id, "other-space"), /当前企业与空间/u);
  await maturityService.settleOrderCredit(tenantId, "maturity-next", maturityDb);
  const nextDebt = maturityDb.ledger.rows.find(row => row.orderId === "maturity-next" && row.receivableDelta.gt(money(0)));
  await assert.rejects(() => maturityService.recordMaturity(tenantId, customerId,
    { ...maturityInput, ledgerId: nextDebt.id }, "operator", maturityDb.currentOrder.workspaceId), /原操作键已用于另一笔债权/u);
  assert.equal(maturityDb.maturities.size, 1);
  assert.equal(await maturityService.readMaturity(tenantId, customerId, nextDebt.id, maturityDb.currentOrder.workspaceId), null);

  const snapshotDb = new FakeDb();
  const snapshotService = serviceFor(snapshotDb);
  await snapshotService.reserveOrderCredit(tenantId, orderId, snapshotDb);
  await snapshotService.settleOrderCredit(tenantId, orderId, snapshotDb);
  const snapshotDebt = snapshotDb.ledger.rows.find(row => row.receivableDelta.gt(money(0)));
  const mutableInput = { ...maturityInput, ledgerId: snapshotDebt.id };
  const submittedInput = structuredClone(mutableInput);
  const pendingMaturity = snapshotService.recordMaturity(tenantId, customerId, mutableInput, "operator", snapshotDb.currentOrder.workspaceId);
  Object.assign(mutableInput, { ledgerId: "other-ledger", dueAt: new Date(Date.now() + 86400000).toISOString(),
    basisRef: "other-invoice", reason: "改变输入", idempotencyKey: "other-key" });
  const snapshotReceipt = await pendingMaturity;
  for (const key of Object.keys(submittedInput)) assert.equal(snapshotReceipt[key], submittedInput[key]);
  assert.equal(snapshotDb.maturities.size, 1);
  ok("财务原到期收据幂等且不覆盖，未核定/逾期阻断新挂账，部分回款不解除、全额核销解除");

  const reducedDb = new FakeDb(), reducedService = serviceFor(reducedDb);
  await reducedService.reserveOrderCredit(tenantId, orderId, reducedDb);
  const change = { id: 'partial-change', tenantId, workspaceId: reducedDb.currentOrder.workspaceId, orderId,
    status: 'applied', type: 'partial_line_cancel', refundAmount: money(40), additionalAmount: money(0) };
  reducedDb.rentalOrderChange = { findFirst: async () => change };
  reducedDb.currentOrder.finalPayableAmount = money(60);
  const source = { kind: 'change', id: change.id };
  reducedDb.credit.status = 'disabled'; // Current new-admission gate must not stop old releases.
  await reducedService.releaseReducedOrderCredit(tenantId, change.workspaceId, orderId, source, reducedDb, 'operator');
  assert.equal((await reducedService.account(tenantId, customerId)).reservedAmount, 60);
  const releaseRows = reducedDb.ledger.rows.filter(row => row.idempotencyKey.includes('reduction:'));
  assert.equal(releaseRows.length, 1); assert.equal(Number(releaseRows[0].reservedDelta), -40);
  assert.equal(Number(releaseRows[0].receivableDelta), 0);
  const countBefore = reducedDb.ledger.rows.length;
  reducedDb.cash = 60;
  await reducedService.releaseReducedOrderCredit(tenantId, change.workspaceId, orderId, source, reducedDb, 'operator');
  assert.equal(reducedDb.ledger.rows.length, countBefore, 'same original reduction cannot release newly redundant cash-backed balance');
  assert.equal((await reducedService.account(tenantId, customerId)).reservedAmount, 60);
  await assert.rejects(reducedService.releaseReducedOrderCredit(tenantId, 'other-space', orderId, source, reducedDb), /经营空间/u);
  change.status = 'requested';
  await assert.rejects(reducedService.releaseReducedOrderCredit(tenantId, change.workspaceId, orderId, source, reducedDb), /确定核减/u);
  ok('确定负变更按原身份单次释放授信占用，停新授信不阻断善后，跨空间和未应用来源拒绝');

  for (const [reservedAmount, debt, cash, expectedRelease] of [[70, 0, 30, 40], [20, 50, 30, 20], [0, 100, 0, 0]]) {
    const split = new FakeDb(), service = serviceFor(split);
    split.cash = cash; split.currentOrder.finalPayableAmount = money(60);
    split.ledger.rows.push({ id: 'prior', tenantId, customerId, workspaceId: split.currentOrder.workspaceId, orderId,
      entryType: 'reserve', currency: 'CNY', reservedDelta: money(reservedAmount), receivableDelta: money(debt), amount: money(reservedAmount),
      occurredAt: new Date(), createdAt: new Date() });
    const row = { ...change, status: 'applied', workspaceId: split.currentOrder.workspaceId };
    split.rentalOrderChange = { findFirst: async () => row };
    await service.releaseReducedOrderCredit(tenantId, row.workspaceId, orderId, { kind: 'change', id: row.id }, split);
    const release = split.ledger.rows.at(-1);
    assert.equal(Number(release.amount), expectedRelease);
    assert.equal(Number(release.receivableDelta), 0);
    assert.equal((await service.account(tenantId, customerId)).receivableAmount, debt, 'no debt/payment reversal in a reservation release');
  }
  ok('混合现金和已转债权只释放冗余占用，不冲销原债权、回款或资金');

  const refundDb = new FakeDb(), refundService = serviceFor(refundDb);
  await refundService.reserveOrderCredit(tenantId, orderId, refundDb);
  refundDb.currentOrder.finalPayableAmount = money(75);
  refundDb.currentOrder.feeReviews = [{ id: 'approved-fee', type: 'early_return_refund', status: 'approved', decidedAmount: 25 }];
  await refundService.releaseReducedOrderCredit(tenantId, refundDb.currentOrder.workspaceId, orderId, { kind: 'fee_review', id: 'approved-fee' }, refundDb);
  assert.equal((await refundService.account(tenantId, customerId)).reservedAmount, 75);
  refundDb.currentOrder.finalPayableAmount = money(65);
  refundDb.rentalOrderExtension = { findFirst: async () => ({ id: 'approved-extension', tenantId, workspaceId: refundDb.currentOrder.workspaceId, orderId, status: 'effective',
    pricingSnapshot: { refundReview: { status: 'approved', amount: 10 } } }) };
  await refundService.releaseReducedOrderCredit(tenantId, refundDb.currentOrder.workspaceId, orderId,
    { kind: 'extension_refund', id: 'approved-extension' }, refundDb);
  assert.equal((await refundService.account(tenantId, customerId)).reservedAmount, 65);
  refundDb.currentOrder.feeReviews[0].status = 'pending';
  await assert.rejects(refundService.releaseReducedOrderCredit(tenantId, refundDb.currentOrder.workspaceId, orderId,
    { kind: 'fee_review', id: 'approved-fee' }, refundDb), /尚未批准/u);
  ok('费用和续租负差额在原批准核减后释放，待审核时不提前释放');
  const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
  const core = Object.create(RentalCoreService.prototype), coreOrder = { id: orderId, tenantId, status: 'settling',
    membershipSnapshot: { enterpriseContractAndPayer: true }, currency: 'CNY', payableAmount: 100, finalPayableAmount: 100,
    adjustmentAmount: 0, chargeLines: [{ code: 'rental:original', type: 'rental', amount: 100 }], ruleVersion: '1', feeReviews: [{ id: 'fee-core', type: 'early_return_refund',
      suggestedAmount: 20, status: 'pending', basis: [], createdAt: new Date().toISOString() }] };
  core.lockedOrder = async () => coreOrder; core.resolveWorkspaceId = () => 'workspace-credit-test';
  let saved = false, calls = [];
  core.factStore = { saveOrderAggregate: async () => { saved = true; } };
  core.corporateSettlement = { releaseReducedOrderCredit: async (_tenant, _workspace, _order, source, tx) => {
    assert.equal(saved, true); assert.equal(coreOrder.feeReviews[0].status, 'approved');
    assert.equal(coreOrder.finalPayableAmount, 80); assert.equal(tx, refundDb); calls.push(source);
  } };
  await core.reviewOrderFeeReview(tenantId, orderId, 'fee-core', { decision: 'approved', reason: '原核减确认' }, 'operator', refundDb);
  assert.deepEqual(calls, [{ kind: 'fee_review', id: 'fee-core' }]);
  saved = false; calls = []; coreOrder.status = 'renting';
  const extension = { id: 'ext-core', tenantId, orderId, currency: 'CNY', status: 'effective', sequence: 1, priceVersion: '1', payableAmount: 0,
    pricingSnapshot: { previousPayableAmount: 100, differenceAmount: -10, chargeLines: [{ code: 'rental:difference', type: 'rental', amount: -10 }],
      refundReview: { status: 'pending', amount: 10 } } };
  core.factStore.listExtensions = async () => [extension];
  core.factStore.updateExtensionPricingSnapshot = async (_tenant, _order, _id, snapshot) => { extension.pricingSnapshot = snapshot; };
  core.corporateSettlement.releaseReducedOrderCredit = async (_tenant, _workspace, _order, source, tx) => {
    assert.equal(saved, true); assert.equal(extension.pricingSnapshot.refundReview.status, 'approved');
    assert.equal(coreOrder.finalPayableAmount, 70); assert.equal(tx, refundDb); calls.push(source);
  };
  await core.reviewExtensionRefund(tenantId, orderId, 'ext-core', { decision: 'approved', reason: '原续租核减' }, 'operator', refundDb);
  assert.deepEqual(calls, [{ kind: 'extension_refund', id: 'ext-core' }]);
  ok('Core批准费用/续租核减与释放使用同一事务并保存原来源，不依赖Controller漏补');

  const debtRow = (id, targetOrder, amount, occurredAt, entryType = "settle") => ({ id, tenantId, customerId,
    workspaceId: targetOrder ? "workspace-credit-test" : null, orderId: targetOrder,
    entryType, amount: money(Math.abs(amount)), reservedDelta: money(0), receivableDelta: money(amount),
    reservedAfter: money(0), receivableAfter: money(0), currency: "CNY", idempotencyKey: id,
    reason: "original debt", operator: "operator", occurredAt: new Date(occurredAt), createdAt: new Date(occurredAt) });
  {
    const fifoDb = new FakeDb(), fifo = serviceFor(fifoDb);
    fifoDb.ledger.rows.push(debtRow("reserve-a", "order-a", 0, 1000, "reserve"),
      debtRow("debt-b", "order-b", 60, 2000), debtRow("debt-a", "order-a", 100, 3000));
    for (const id of ["order-a", "order-b"]) fifoDb.originalOrders.set(id, { ...fifoDb.currentOrder, id });
    await fifo.recordPayment(tenantId, customerId, { amount: 80, reason: "按债权时点核销", idempotencyKey: "fifo-payment" });
    const applied = fifoDb.ledger.rows.filter(row => row.entryType === "payment_allocation");
    assert.deepEqual(applied.map(row => [row.orderId, Number(row.amount)]), [["order-b", 60], ["order-a", 20]]);
    const count = fifoDb.ledger.rows.length;
    await fifo.recordPayment(tenantId, customerId, { amount: 80, reason: "按债权时点核销", idempotencyKey: "fifo-payment" });
    assert.equal(fifoDb.ledger.rows.length, count);
    assert.equal((await fifo.account(tenantId, customerId)).receivableAmount, 80);
    ok("企业回款先抵较早形成的债权，不被更早预约占用带偏，原回款重放不重新分配");
  }
  {
    for (const sameTime of [false, true]) {
      const fifoDb = new FakeDb(), fifo = serviceFor(fifoDb);
      // A's first debt has already been extinguished; only its new later debt
      // may compete with B. Equal timestamps are ordered by original ledger ID.
      const originalPaymentKey = 'original-a-payment';
      fifoDb.ledger.rows.push(debtRow("old-a", "order-a", 100, 1000),
        { ...debtRow("old-payment", null, 0, 1500, "payment"), amount: money(100), idempotencyKey: originalPaymentKey },
        { ...debtRow("old-a-paid", "order-a", -100, 1500, "payment_allocation"),
          idempotencyKey: `payment.allocation:${createHash('sha256').update(`${originalPaymentKey}:order-a`).digest('hex')}` },
        debtRow("b-later-debt", "order-a", 100, sameTime ? 2000 : 3000),
        debtRow("a-earlier-debt", "order-b", 60, 2000));
      for (const id of ["order-a", "order-b"]) fifoDb.originalOrders.set(id, { ...fifoDb.currentOrder, id });
      await fifo.recordPayment(tenantId, customerId, { amount: 80, reason: "剩余正债权排序", idempotencyKey: "fifo-new" });
      const applied = fifoDb.ledger.rows.filter(row => row.idempotencyKey.startsWith("payment.allocation:") && row.id !== 'old-a-paid');
      assert.deepEqual(applied.map(row => [row.orderId, Number(row.amount)]), [["order-b", 60], ["order-a", 20]]);
      assert.equal((await fifo.account(tenantId, customerId)).receivableAmount, 80);
    }
    ok("已经结清的旧债权不抢新债权顺位，同时间按稳定原流水ID排序");
  }

  {
    const scopedDb = new FakeDb(), scoped = serviceFor(scopedDb);
    scopedDb.baseUser = { ...scopedDb.baseUser, isPlatformAdmin: false,
      permissions: ["rental-os:corporate:view", "rental-os:corporate:manage"] };
    const member = permissions => ({ isActive: true, dataScope: "ALL", locationScope: { mode: "all", locationIds: [] },
      role: { id: "role", name: "Finance", scope: "RENTAL", isActive: true, fixedAllPermissions: false,
        dataScope: "ALL", buttonPermissions: [], permissions: permissions.map(code => ({ permission: { code } })) } });
    const currentPermissions = ["rental-os:corporate:view", "rental-os:corporate:manage", "rental-os:finance:view", "rental-os:finance:manage"];
    scopedDb.members.set("workspace-credit-test", member(currentPermissions));
    scopedDb.members.set("workspace-other", member([]));
    scopedDb.ledger.rows.push(debtRow("debt-current", "order-current", 40, 1000),
      { ...debtRow("debt-other", "order-other", 60, 2000), workspaceId: "workspace-other" });
    scopedDb.originalOrders.set("order-current", { ...scopedDb.currentOrder, id: "order-current" });
    scopedDb.originalOrders.set("order-other", { ...scopedDb.currentOrder, id: "order-other", workspaceId: "workspace-other" });
    const payment = { amount: 20, reason: "scope test", idempotencyKey: "scope-payment" };
    const count = scopedDb.ledger.rows.length;
    for (const work of [() => scoped.financialAccount(tenantId, customerId), () => scoped.listLedger(tenantId, customerId),
      () => scoped.recordPayment(tenantId, customerId, payment)]) {
      await assert.rejects(work, error => error.status === 403);
      assert.equal(scopedDb.ledger.rows.length, count, "no partial payment across an unauthorized workspace");
    }
    scopedDb.members.set("workspace-other", member(["rental-os:finance:view", "rental-os:finance:manage"]));
    assert.equal((await scoped.listLedger(tenantId, customerId)).length, 2);
    assert.equal((await scoped.financialAccount(tenantId, customerId)).receivableAmount, 100);
    await scoped.recordPayment(tenantId, customerId, payment);
    assert.equal((await scoped.listLedger(tenantId, customerId)).length, 4, "aggregate payment linked to authorized original allocation");
    assert.equal((await scoped.financialAccount(tenantId, customerId)).receivableAmount, 80);
    const validMember = scopedDb.members.get("workspace-other");
    for (const invalid of [{ ...validMember, dataScope: "OWN" }, { ...validMember, locationScope: { mode: "selected", locationIds: ["loc"] } },
      { ...validMember, role: { ...validMember.role, isActive: false } }, null]) {
      if (invalid) scopedDb.members.set("workspace-other", invalid); else scopedDb.members.delete("workspace-other");
      await assert.rejects(scoped.recordPayment(tenantId, customerId, { ...payment, idempotencyKey: "scope-other" }), error => error.status === 403);
      await assert.rejects(scoped.listLedger(tenantId, customerId), error => error.status === 403);
    }
    scopedDb.members.set("workspace-other", validMember);
    for (const identity of [{}, { tenantId, workspaceId: "workspace-credit-test", userId: "operator", audience: "client", dataScope: "all", locationScope: { mode: "all" } },
      { tenantId: "wrong", workspaceId: "workspace-credit-test", userId: "operator", audience: "operator", dataScope: "all", locationScope: { mode: "all" } },
      { tenantId, workspaceId: "workspace-credit-test", userId: "operator", audience: "operator", dataScope: "own", locationScope: { mode: "all" } },
      { tenantId, workspaceId: "workspace-credit-test", userId: "operator", audience: "operator", isSaasAdmin: true, dataScope: "all", locationScope: { mode: "all" } }]) {
      await assert.rejects(runWithRequestIdentity(identity, () => scoped.listLedger(tenantId, customerId)), error => error.status === 403);
    }
    const withoutDependency = new CustomerCorporateSettlementService(scopedDb, scopedDb.funding);
    await assert.rejects(withoutDependency.listLedger(tenantId, customerId), error => error.status === 403);
    scopedDb.ledger.rows.push(debtRow("legacy-unbound", null, 10, 3000));
    await assert.rejects(scoped.listLedger(tenantId, customerId), error => error.status === 403);
    await assert.rejects(scoped.recordPayment(tenantId, customerId, { ...payment, idempotencyKey: "legacy-payment" }), error => error.status === 403);
    ok("企业主档权限不授跨空间账务权；完整原空间财务权才可读/核销，撤权、own/地点、缺依赖与无绑定历史拒绝");
  }
  {
    const revokedDb = new FakeDb(), revoked = serviceFor(revokedDb);
    revokedDb.ledger.rows.push(debtRow("debt-revoked", "order-current", 100, 1000));
    revokedDb.originalOrders.set("order-current", { ...revokedDb.currentOrder, id: "order-current" });
    const original = revokedDb.workspaceMember.findFirst;
    let reads = 0;
    revokedDb.workspaceMember.findFirst = async input => {
      if (++reads === 3) return null;
      return original(input);
    };
    await assert.rejects(revoked.recordPayment(tenantId, customerId, { amount: 20, reason: "revoked before return", idempotencyKey: "revoked-payment" }), error => error.status === 403);
    assert.equal(revokedDb.ledger.rows.length, 1, "in-transaction recheck rejection rolls back payment and allocations");
    assert.equal(Number(revokedDb.ledger.rows[0].receivableDelta), 100);
    const { isTenantMembershipRoute } = require("../apps/api/src/common/api-auth.guard");
    for (const path of ["account", "ledger", "payments", "maturities", "maturities/original"]) {
      assert.equal(isTenantMembershipRoute(`/platform/customers/customer/credit/${path}`), false);
    }
    assert.equal(isTenantMembershipRoute("/platform/customers/customer/credit"), true, "shared credit configuration retains tenant access");
    const { PlatformService } = require("../apps/api/src/modules/platform/platform.service");
    const platform = Object.create(PlatformService.prototype);
    platform.requireWorkspaceDataSource = () => undefined;
    platform.customerCorporateSettlement = revoked;
    reads = 0;
    assert.equal((await platform.getCustomerCreditAccount(customerId, revokedDb.baseUser)).receivableAmount, 100);
    ok("原事务写入后复验撤权会回滚整笔回款，Guard分离共享配置与空间账务，摘要消费者统一财务读取");
  }

  console.log(`\n企业授信账期专项：${passed} 项全部通过`);
}).catch((error) => { console.error(error); process.exitCode = 1; });
