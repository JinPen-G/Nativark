const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { Prisma } = require("../node_modules/@prisma/client");
const { CustomerCorporateSettlementService } = require("../apps/api/src/modules/platform/customer-corporate-settlement.service");

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
      (where.orderId === undefined || row.orderId === where.orderId)
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
}

class FakeDb {
  constructor() {
    this.ledger = new FakeLedger();
    this.credit = { id: "credit-1", tenantId, customerId, creditLimit: money(500), status: "active", billingCycle: "monthly", settlementTermDays: 30 };
    this.currentOrder = {
      id: orderId,
      tenantId,
      workspaceId: "workspace-credit-test",
      membershipSnapshot: { enterpriseContractAndPayer: true, corporateCustomerId: customerId },
      finalPayableAmount: money(100)
    };
    this.customerCorporateCreditLedger = this.ledger;
    this.customerCorporateCredit = {
      findFirst: async () => this.credit
    };
    this.rentalOrder = {
      findFirst: async () => this.currentOrder
    };
  }

  async $queryRaw() { return [{ id: this.credit.id }]; }
  async $transaction(callback) { return callback(this); }
}

const service = new CustomerCorporateSettlementService(new FakeDb());
const db = service.prisma;
let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

(async () => {
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
  const cancelledService = new CustomerCorporateSettlementService(cancelledDb);
  await cancelledService.reserveOrderCredit(tenantId, orderId, cancelledDb);
  cancelledDb.currentOrder.finalPayableAmount = money(25);
  const cancellation = await cancelledService.settleCancelledOrderCredit(tenantId, orderId, "取消费", cancelledDb);
  assert.equal(cancellation.reservedAmount, 0);
  assert.equal(cancellation.receivableAmount, 25);
  await cancelledService.settleCancelledOrderCredit(tenantId, orderId, "取消费", cancelledDb);
  assert.equal((await cancelledService.account(tenantId, customerId)).receivableAmount, 25);
  ok("企业订单取消费转应收、释放剩余额度，重复取消不重复计费");

  const excessDb = new FakeDb();
  const excessService = new CustomerCorporateSettlementService(excessDb);
  await excessService.reserveOrderCredit(tenantId, orderId, excessDb);
  excessDb.currentOrder.finalPayableAmount = money(650);
  const excess = await excessService.settleOrderCredit(tenantId, orderId, excessDb);
  assert.equal(excess.receivableAmount, 650);
  assert.equal(excess.availableAmount, -150);
  await excessService.recordPayment(tenantId, customerId, { amount: 200, reason: "偿还超额债务", idempotencyKey: "excess-payment" });
  assert.equal((await excessService.account(tenantId, customerId)).receivableAmount, 450);
  ok("真实最终债务超过授信仍可入账并回款，不把额度限制误用成账务阻断");

  const zeroDb = new FakeDb();
  const zeroService = new CustomerCorporateSettlementService(zeroDb);
  await zeroService.reserveOrderCredit(tenantId, orderId, zeroDb);
  zeroDb.currentOrder.finalPayableAmount = money(0);
  await zeroService.settleCancelledOrderCredit(tenantId, orderId, "免费取消", zeroDb);
  const zeroCount = zeroDb.ledger.rows.length;
  await zeroService.settleCancelledOrderCredit(tenantId, orderId, "免费取消", zeroDb);
  assert.equal(zeroDb.ledger.rows.length, zeroCount);
  assert.equal((await zeroService.account(tenantId, customerId)).reservedAmount, 0);
  ok("零费用取消保留结算幂等标记，不反复释放额度");

  const splitDb = new FakeDb();
  const splitService = new CustomerCorporateSettlementService(splitDb);
  await splitService.reserveOrderCredit(tenantId, orderId, splitDb);
  await splitService.settleOrderCredit(tenantId, orderId, splitDb);
  splitDb.currentOrder = { ...splitDb.currentOrder, id: "order-second", finalPayableAmount: money(60) };
  await splitService.reserveOrderCredit(tenantId, "order-second", splitDb);
  await splitService.settleOrderCredit(tenantId, "order-second", splitDb);
  await splitService.recordPayment(tenantId, customerId, { amount: 130, reason: "分单回款", idempotencyKey: "split-payment" });
  const firstDebt = splitDb.ledger.rows.filter((row) => row.orderId === orderId).reduce((sum, row) => sum + Number(row.receivableDelta), 0);
  const secondDebt = splitDb.ledger.rows.filter((row) => row.orderId === "order-second").reduce((sum, row) => sum + Number(row.receivableDelta), 0);
  assert.equal(firstDebt, 0);
  assert.equal(secondDebt, 30);
  ok("一笔回款按应收入账顺序跨订单核销，总账和逐单余额一致");

  console.log(`\n企业授信账期专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
