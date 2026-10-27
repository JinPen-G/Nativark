const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalFundingService } = require("../apps/api/src/modules/rental-core/rental-funding.service");
const { StaffOfflinePaymentService } = require("../apps/api/src/modules/rental-core/staff-offline-payment.service");
const { PaymentRuntimeService } = require("../apps/api/src/modules/integrations/payment.runtime.service");

let eventSequence = 0;
const event = (instrument, action, amount, provider = "stripe") => ({
  id: `event-${++eventSequence}`, tenantId: "tenant", workspaceId: "workspace", orderId: "order",
  instrument, action, amount, provider, balanceAfter: amount, idempotencyKey: `key-${eventSequence}`,
  reason: "fixture", at: new Date(), createdAt: new Date(), paymentMethod: null
});
const order = { depositAmount: 200, preAuthAmount: 300, payable: 1000, status: "ready_for_pickup", ruleSnapshot: { payment: { timing: "pickup" } } };
let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

function serviceWith(events, snapshot = order, options = {}) {
  const registrations = options.registrations ?? [];
  const db = {
    $queryRaw: async () => [{ runMode: options.runMode ?? "production" }],
    businessWorkspace: { findFirst: async () => ({ runMode: options.runMode ?? "production" }) },
    rentalOrder: {
      findFirst: async () => ({ ...snapshot, id: "order", workspaceId: "workspace", finalPayableAmount: snapshot.payable }),
      findFirstOrThrow: async () => ({ ...snapshot, finalPayableAmount: snapshot.payable })
    },
    rentalOrderExtension: { findMany: async () => [] },
    rentalPaymentIntent: { findFirst: async () => options.paymentPresent ? { id: "original-payment" } : null },
    rentalOfflinePaymentRegistration: {
      findMany: async () => registrations.filter(row => row.status === "confirmed"),
      findFirst: async ({ where }) => registrations.find(row => (!where.id || row.id === where.id) && (!where.status || row.status === where.status)) ?? null,
      findFirstOrThrow: async ({ where }) => registrations.find(row => row.id === where.id),
      updateMany: async ({ where, data }) => {
        const row = registrations.find(row => row.id === where.id && row.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      }
    },
    rentalFundingEvent: {
      findMany: async () => events,
      findUnique: async ({ where }) => {
        const key = where.workspaceId_orderId_instrument_action_idempotencyKey;
        return events.find(row => row.instrument === key.instrument && row.action === key.action && row.idempotencyKey === key.idempotencyKey) ?? null;
      },
      create: async ({ data }) => { const row = { ...data, createdAt: new Date() }; events.push(row); return row; }
    }
  };
  db.$transaction = async fn => fn(db);
  const service = new RentalFundingService(db);
  service.lockedOrderScope = async () => snapshot;
  service.testDb = db;
  return service;
}

void (async () => {
  // “曾收过”不等于当前可领取：退款或释放后的实际余额必须还足额。
  {
    const events = [event("rental", "append", 800), event("deposit", "initiate", 200), event("preauthorization", "initiate", 300)];
    const service = serviceWith(events);
    await assert.rejects(() => service.assertReadyForPickup("tenant", "workspace", "order", service.testDb), /尚需收款 200\.00/u);
    events.push(event("rental", "append", 200));
    await assert.doesNotReject(() => service.assertReadyForPickup("tenant", "workspace", "order", service.testDb));
    events.splice(events.findIndex((row) => row.instrument === "deposit"), 1, event("deposit", "initiate", 200), event("deposit", "refund", 200));
    await assert.rejects(() => service.assertReadyForPickup("tenant", "workspace", "order", service.testDb), /足额收取押金/u);
    ok("领取同时检查租赁实收、押金和预授权的当前余额，不把历史收款当作有效余额");
  }

  // 订单在资金账全清前不能关：客户待退款与未收尾款都是未结算事实。
  {
    const settled = [
      event("rental", "append", 1000),
      event("deposit", "initiate", 200), event("deposit", "refund", 200),
      event("preauthorization", "initiate", 300), event("preauthorization", "release", 300)
    ];
    const service = serviceWith(settled, { ...order, status: "settling" });
    await assert.doesNotReject(() => service.assertReadyToClose("tenant", "workspace", "order", service.testDb));
    service.lockedOrderScope = async () => ({ ...order, status: "settling", payable: 950 });
    await assert.rejects(() => service.assertReadyToClose("tenant", "workspace", "order", service.testDb), /尚有退款 50\.00/u);
    ok("关闭订单同时拒绝待收款和待退款，保证金释放不替代租赁结算");
  }

  // 订单确认时点由规则快照决定；confirmation 模式没有实收不得确认。
  {
    const events = [];
    const service = serviceWith(events, { ...order, ruleSnapshot: { payment: { timing: "confirmation" } } });
    await assert.rejects(() => service.assertReadyForConfirmation("tenant", "workspace", "order", service.testDb), /尚需收款 1000\.00/u);
    events.push(event("rental", "append", 1000));
    await assert.doesNotReject(() => service.assertReadyForConfirmation("tenant", "workspace", "order", service.testDb));
    ok("确认时全额支付规则复核实际租赁收款，付款成功才允许确认");
  }

  {
    const simulated = [event("rental", "append", 1000, "mock"), event("deposit", "initiate", 200, "mock"), event("preauthorization", "initiate", 300, "mock")];
    const service = serviceWith(simulated);
    await assert.rejects(() => service.assertReadyForPickup("tenant", "workspace", "order", service.testDb), /足额收取押金/u);
    await assert.rejects(() => service.assertPaid("tenant", "workspace", "order", service.testDb), /尚需收款/u);
    const balance = await service.listEvents("tenant", "workspace", "order");
    assert.equal(balance.balanceBasis, "real");
    assert.equal(balance.rental.collected, 0);
    assert.equal(balance.deposit.collected, 0);
    assert.equal(balance.events.length, 3, "保留模拟历史，不拿它当实收");
    await assert.rejects(() => service.recordEvent("tenant", "workspace", "order", {
      instrument: "rental", action: "append", amount: 1, idempotencyKey: "simulation", reason: "fixture"
    }), /模拟资金仅限纯演练/u);
    assert.equal(simulated.length, 3);
    ok("生产资金余额、交付门禁及写入口都拒绝模拟实收");
  }
  {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const events = [event("rental", "append", 1000, "mock")];
      const snapshot = { ...order, depositAmount: 0, preAuthAmount: 0, status: "settling", payable: 950 };
      const service = serviceWith(events, snapshot, { runMode: "development" });
      const simulated = await service.listEvents("tenant", "workspace", "order");
      assert.equal(simulated.simulationAllowed, true);
      assert.equal(simulated.balanceBasis, "simulated");
      assert.equal(simulated.rental.balance, -50);
      const input = { instrument: "rental", action: "refund", amount: 50, idempotencyKey: "demo-refund", reason: "fixture" };
      await service.recordEvent("tenant", "workspace", "order", input);
      await assert.doesNotReject(() => service.assertReadyToClose("tenant", "workspace", "order", service.testDb));
      await service.recordEvent("tenant", "workspace", "order", input);
      assert.equal(events.length, 2, "演练仍按原键回放");
      const real = await service.listEvents("tenant", "workspace", "order", undefined, { realOnly: true });
      assert.equal(real.rental.collected, 0, "真实收款申请不能拿模拟付款抵扣应收");
      events.push(event("rental", "initiate", 1000));
      const mixed = await service.listEvents("tenant", "workspace", "order");
      assert.equal(mixed.balanceBasis, "real");
      assert.equal(mixed.rental.refunded, 0);
      await assert.rejects(() => service.assertReadyToClose("tenant", "workspace", "order", service.testDb), /尚有退款 50/u);
      await assert.rejects(() => service.recordEvent("tenant", "workspace", "order", input), /模拟资金仅限纯演练/u);
      for (const options of [{ paymentPresent: true }, { registrations: [{ id: "pending", status: "pending" }] }]) {
        const pendingService = serviceWith([], snapshot, { runMode: "development", ...options });
        assert.equal((await pendingService.listEvents("tenant", "workspace", "order")).simulationAllowed, false);
      }
      process.env.NODE_ENV = "production";
      assert.equal((await serviceWith([], snapshot, { runMode: "development" }).listEvents("tenant", "workspace", "order")).simulationAllowed, false);
      ok("纯开发演练保留，真实支付或登记一旦存在就不能用模拟退款平账或借旧键收尾");
    } finally {
      if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    }
  }
  {
    const collected = { ...event("rental", "initiate", 1000, "mock"), paymentMethod: "offline_cash", idempotencyKey: "staff-offline:registration" };
    const registration = {
      id: "registration", tenantId: "tenant", workspaceId: "workspace", orderId: "order", instrument: "rental", amount: 1000,
      status: "confirmed", fundingEventId: collected.id, paymentMethod: "offline_cash", confirmedBy: "operator", confirmedAt: new Date()
    };
    const service = serviceWith([collected], order, { registrations: [registration] });
    assert.equal((await service.listEvents("tenant", "workspace", "order")).rental.collected, 1000);
    assert.equal(collected.provider, "mock", "只投影来源，不改旧流水");
    registration.workspaceId = "other";
    assert.equal((await service.listEvents("tenant", "workspace", "order")).rental.collected, 0);
    registration.workspaceId = "workspace";
    registration.amount = 999;
    assert.equal((await service.listEvents("tenant", "workspace", "order")).rental.collected, 0);
    ok("旧线下实收只按同租户空间订单、金额及原确认关联识别，不凭备注或方式猜测");
  }
  {
    const registration = {
      id: "registration", tenantId: "tenant", workspaceId: "workspace", orderId: "order", instrument: "rental", amount: 600,
      status: "pending", fundingEventId: null, paymentMethod: "offline_cash", reason: "fixture", registeredAt: new Date()
    };
    const events = [event("rental", "initiate", 1000, "mock")];
    const service = serviceWith(events, order, { registrations: [registration] });
    const staff = new StaffOfflinePaymentService(service.testDb, service, {});
    const result = await staff.confirm("tenant", "workspace", "user", "operator", "registration", { mode: "all", locationIds: [] });
    assert.equal(result.fundingEvent.provider, "offline");
    assert.equal(registration.status, "confirmed");
    assert.equal(registration.fundingEventId, result.fundingEvent.id);
    assert.equal((await service.listEvents("tenant", "workspace", "order")).rental.collected, 600);
    await assert.rejects(() => service.recordEvent("tenant", "workspace", "order", {
      instrument: "rental", action: "initiate", amount: 400, provider: "offline", idempotencyKey: "fake", reason: "fixture"
    }), /原登记在同一事务/u);
    await assert.rejects(() => service.recordEvent("tenant", "workspace", "order", {
      instrument: "rental", action: "initiate", amount: 400, provider: "stripe", idempotencyKey: "fake", reason: "fixture"
    }), /原核验收据/u);
    ok("员工真实部分收款保留原确认事务，不能由通用入口自报来源升级为实款");
  }

  {
    const events = [event("rental", "initiate", 100)];
    const snapshot = { ...order, payable: 90, depositAmount: 0, preAuthAmount: 0, status: "settling" };
    const service = serviceWith(events, snapshot);
    const refund = { instrument: "rental", action: "refund", amount: 40, provider: "stripe", verifiedExternalReceipt: true,
      idempotencyKey: "payment-refund:original", reason: "原退款成功" };
    await assert.rejects(() => service.recordEvent("tenant", "workspace", "order", { ...refund, verifiedExternalReceipt: false }), /原核验收据/u);
    await service.recordEvent("tenant", "workspace", "order", refund);
    assert.equal((await service.listEvents("tenant", "workspace", "order")).rental.balance, 30, "退款等待期间新增费用形成待收，不否定原退款");
    await service.recordEvent("tenant", "workspace", "order", refund);
    assert.equal(events.length, 2, "原退款同键只记一次");
    await assert.rejects(() => service.recordEvent("tenant", "workspace", "order", { ...refund, amount: 41 }), /不同金额/u);
    await assert.rejects(() => service.assertReadyToClose("tenant", "workspace", "order", service.testDb), /尚有费用 30\.00 未收取/u);
    const simulated = serviceWith([event("rental", "initiate", 100, "mock")], snapshot, { runMode: "development" });
    await assert.rejects(() => simulated.recordEvent("tenant", "workspace", "order", { ...refund, provider: "mock", verifiedExternalReceipt: true }), /已核验的支付平台/u);
    await assert.rejects(() => simulated.recordEvent("tenant", "workspace", "order", { ...refund, provider: "mock", verifiedExternalReceipt: false }), /待退金额/u);
    const recoveredEvents = [event("rental", "initiate", 100)];
    const recovered = serviceWith(recoveredEvents, snapshot);
    const db = recovered.testDb;
    const originalRefund = { id: "refund-original", tenantId: "tenant", workspaceId: "workspace", orderId: "order", paymentIntentId: "intent-original",
      provider: "stripe", method: "stripe", amount: 40, currency: "USD", merchantRefundNo: "RR-original", reason: "核准原退款",
      status: "accepted", revision: 1, fundedAt: null, externalRefundId: null, createdAt: new Date(), updatedAt: new Date() };
    db.rentalPaymentRefund = {
      findFirst: async ({ where }) => where.id === originalRefund.id ? originalRefund : null,
      findMany: async () => [originalRefund],
      update: async ({ data }) => {
        const { revision, ...fields } = data;
        Object.assign(originalRefund, fields);
        if (revision?.increment) originalRefund.revision += revision.increment;
        return originalRefund;
      },
      create: async () => { throw new Error("额度拒绝后不能创建新退款"); }
    };
    db.rentalPaymentIntent.findFirst = async () => ({ id: "intent-original", tenantId: "tenant", workspaceId: "workspace", orderId: "order",
      provider: "stripe", method: "stripe", status: "paid", amount: 100, currency: "USD", externalTransactionId: "pi_original" });
    const payment = new PaymentRuntimeService(db, { runtimeConfig: async () => ({ provider: "stripe" }), assertEnabledInTransaction: async () => undefined }, recovered);
    const outcome = payment.stripeRefundOutcome({ id: "re_original", status: "succeeded", amount: 4000, currency: "usd", payment_intent: "pi_original" }, originalRefund, "pi_original");
    assert.equal((await payment.applyProviderRefundOutcome("tenant", "workspace", "order", originalRefund.id, outcome)).status, "succeeded");
    assert.ok(originalRefund.fundedAt);
    assert.equal((await recovered.listEvents("tenant", "workspace", "order")).rental.balance, 30);
    await payment.applyProviderRefundOutcome("tenant", "workspace", "order", originalRefund.id, outcome);
    assert.equal(recoveredEvents.length, 2);
    await assert.rejects(() => payment.createPaymentRefund("tenant", "workspace", "order", "intent-original", {
      amount: 1, reason: "新退款申请", idempotencyKey: "new-refund"
    }), /当前可退余额/u, "原退款入账不授予新的退款额度");
    ok("原外部退款足额入账并幂等，普通退款限额和未结应收关闭门保持");
  }

  console.log(`\n订单资金门禁专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
