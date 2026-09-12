const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// ORDER-CLOSE-01 §4.1-2/4/6：同一业务动作必须「先进事务并锁订单 → 再在该事务下加载事实
// → 最后计算与写入」。锁之前读到的东西只能用于展示，不能作为生效依据。
//
// 这里钉住三件事：结算的锁在两处查询之前、续租申请在事务内加载而试算不加锁、
// 以及客户端 DTO 不给出可以直接决定终态或最终应付的字段。
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

const tenantId = "tenant_1";
const orderId = "order_1";
const req = () => ({ user: { tenantId, displayName: "运营" }, headers: {} });

/** 记录调用顺序的结算控制器。fake tx 只提供结算真正用到的那一张表。 */
function settleController({ exceptions = [] } = {}) {
  const trace = [];
  const instance = Object.create(RentalCoreController.prototype);
  instance.committed = (_tenantId, value) => value;
  instance.context = () => ({ profile: {}, settings: {} });
  instance.business = {
    completeCustomerOrderEventInTransaction: async () => { trace.push("customer-event"); },
    refreshFromDatabase: async () => { trace.push("refresh"); }
  };
  instance.funding = {
    assertReadyToClose: async () => { trace.push("funding"); }
  };
  instance.service = {
    resolveWorkspaceId: () => "ws_1",
    lockOrderForUpdate: async () => { trace.push("lock"); return { id: orderId }; },
    settleOrder: async () => { trace.push("settle"); return { id: orderId, customerId: "cust_1", status: "completed" }; },
    getOrder: async () => ({ id: orderId, status: "completed" })
  };
  instance.idempotent = {
    execute: async (args) => args.run({
      rentalInspectionRecord: {
        findMany: async () => { trace.push("inspections"); return exceptions.map((row) => ({ exceptions: row })); }
      }
    })
  };
  return { instance, trace };
}

/** 续租控制器：只关心「申请走锁内加载、试算走无锁读」。 */
function extensionController() {
  const trace = [];
  const instance = Object.create(RentalCoreController.prototype);
  instance.committed = (_tenantId, value) => value;
  instance.context = () => ({ profile: {}, settings: {} });
  instance.business = {
    quoteOrderExtension: async () => ({
      orderId, originalEndAt: "2026-09-05T00:00:00.000Z", newEndAt: "2026-09-08T00:00:00.000Z",
      payableAmount: 100, rateSnapshot: [], ruleSnapshot: {}
    }),
    synchronizeExtensionCoupon: async () => {}
  };
  instance.resolveExtensionSettlement = async () => "immediate";
  instance.serviceCapacities = { reserveForOrder: async () => {}, confirmForOrder: async () => {} };
  const order = {
    id: orderId, status: "renting", ruleSnapshot: { extension: { enabled: true } },
    lines: [], fulfillmentMode: "store_pickup_return", fulfillmentLocationId: "loc_1", customerType: "personal"
  };
  instance.service = {
    resolveWorkspaceId: () => "ws_1",
    getOrder: async () => { trace.push("getOrder"); return order; },
    lockOrderForUpdate: async () => { trace.push("lockOrderForUpdate"); return order; },
    assertOrderExtensionAvailable: async (_tenantId, _order, _newEndAt, tx) => { trace.push(`available:${tx ? "tx" : "no-tx"}`); },
    listOrderExtensions: async (_tenantId, _orderId, tx) => { trace.push(`extensions:${tx ? "tx" : "no-tx"}`); return []; },
    requestOrderExtension: async () => ({ order, extension: { id: "ext_1", status: "pending_payment" } })
  };
  instance.idempotent = { execute: async (args) => args.run({}) };
  return { instance, trace };
}

void (async () => {

/* ---------- 结算：锁必须排在待审异常与资金检查之前 ---------- */

{
  const { instance, trace } = settleController();
  await instance.settle(req(), orderId);
  assert.deepEqual(trace, ["lock", "inspections", "funding", "settle", "customer-event", "refresh"],
    "顺序必须是先锁订单，再查待审异常与资金余额，最后才结算");
  assert.ok(trace.indexOf("lock") < trace.indexOf("inspections"),
    "修复前异常查询排在锁之前：并发的费用裁定可以插在中间，结算按旧事实关掉欠款订单");
  assert.ok(trace.indexOf("lock") < trace.indexOf("funding"), "资金余额同样必须在锁之后再算");
  ok("结算先锁订单行，再查待审异常与资金余额——修复前两处查询都在锁之前");
}

/* ---------- 结算：待审异常仍然拦住关单 ---------- */

{
  const { instance, trace } = settleController({ exceptions: [[{ reviewStatus: "pending" }]] });
  await assert.rejects(() => instance.settle(req(), orderId), /仍有检查异常待审核/u, "待审异常必须拦住关单");
  assert.equal(trace.includes("settle"), false, "被拦住时不能已经改过订单状态");
  assert.equal(trace[0], "lock", "拦截判定本身也必须发生在锁之后");
  ok("待审检查异常在锁内被拦住，且拦住时订单状态未被推进");
}

/* ---------- 已裁定正数异常必须先完成客户响应 ---------- */

{
  const { instance, trace } = settleController({ exceptions: [[{ reviewStatus: "approved", approvedChargeAmount: 80, customerResponseStatus: "pending" }]] });
  await assert.rejects(() => instance.settle(req(), orderId), /待客户确认或申诉处理/u, "已批准异常费用未完成客户响应时必须拒绝关单");
  assert.equal(trace.includes("settle"), false, "客户响应未完成时不能已经改过订单状态");
  ok("已裁定的正数异常在客户确认/申诉处理前仍阻断结算");
}

{
  const { instance, trace } = settleController({ exceptions: [[{ reviewStatus: "approved", approvedChargeAmount: 80, customerResponseStatus: "disputed" }]] });
  await assert.rejects(() => instance.settle(req(), orderId), /待客户确认或申诉处理/u, "客户已申诉时必须继续拒绝关单");
  assert.equal(trace.includes("settle"), false);
  ok("客户申诉不会被当作已处理，仍保留结算阻断");
}

/* ---------- 续租申请在事务内加载；试算不加锁 ---------- */

{
  const { instance, trace } = extensionController();
  await instance.applyExtension(req(), orderId, { newEndAt: "2026-09-08T00:00:00.000Z" });
  assert.equal(trace[0], "lockOrderForUpdate", "申请必须先在事务内锁单再加载订单");
  assert.equal(trace.includes("getOrder"), false, "申请路径不能再用无锁的 getOrder 作为定价依据");
  assert.deepEqual(trace.filter((row) => row.startsWith("available:")), ["available:tx"], "可用量判定必须在同一事务内");
  assert.deepEqual(trace.filter((row) => row.startsWith("extensions:")), ["extensions:tx"], "有效续租必须在同一事务内加载");
  ok("续租申请在事务内锁单后加载订单、有效续租与可用量——修复前三者都是无锁读");
}

{
  const { instance, trace } = extensionController();
  await instance.previewExtension(req(), orderId, { newEndAt: "2026-09-08T00:00:00.000Z" });
  assert.equal(trace[0], "getOrder", "试算是展示用途，不该为它加订单行锁");
  assert.equal(trace.includes("lockOrderForUpdate"), false, "预览加锁会把展示请求和生效请求互相阻塞");
  ok("续租试算仍走无锁读：预览只供展示，不占订单行锁");
}

/* ---------- 客户端不得直接决定终态或最终应付 ---------- */

{
  const forbidden = ["finalPayableAmount", "payableAmount", "adjustmentAmount", "status", "completedAt", "skipReview", "forceComplete"];
  const dtoSource = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../apps/api/src/modules/rental-core/rental-order-request.dto.ts"), "utf8"
  );
  const inspectionDto = dtoSource.slice(dtoSource.indexOf("class CreateRentalInspectionDto"), dtoSource.indexOf("class CreateRentalInspectionDto") + 1400);
  for (const field of forbidden) {
    assert.equal(inspectionDto.includes(`${field}`), false, `归还检查入参不得包含 ${field}`);
  }
  ok("归还检查 DTO 不接受最终应付、订单状态或免审核标记：终态只能由服务端推导");
}

console.log(`\n订单事务顺序专项：${passed} 项全部通过`);

})();
