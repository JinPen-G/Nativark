const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// ORDER-CLOSE-01：取消费必须在锁住订单之后解析。
// 旧路径在 controller 里先 getOrder / 算费，再进入 cancelOrder 的锁；
// 这会让并发续租或其他订单变更与取消费计算之间出现事实窗口。
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalCoreOrderStatus } = require("@rental-os/shared");

const events = [];
const order = {
  id: "order_1",
  tenantId: "tenant_1",
  status: RentalCoreOrderStatus.Reserved,
  ruleVersion: "rule-1",
  finalPayableAmount: 100,
  payableAmount: 100,
  adjustmentAmount: 0,
  totalAmount: 100,
  taxRate: 0,
  taxAmount: 0,
  reservations: [],
  allocations: [],
  chargeLines: [{ code: "rental:group-1", name: "租金", type: "rental", amount: 100 }]
};

const instance = Object.create(RentalCoreService.prototype);
instance.state = () => ({});
instance.lockedOrder = async () => {
  events.push("lock");
  return order;
};
instance.runHook = async (_tenantId, _point, _subjectRef, payload) => {
  events.push(`hook:${payload.settlement.chargeAmount}`);
};
instance.orderHookInstances = () => [];
instance.factStore = {
  listExtensions: async () => [],
  saveOrderAggregate: async () => { events.push("save"); }
};

void (async () => {
  const cancelled = await instance.cancelOrder(
    "tenant_1",
    "order_1",
    "客户取消",
    async (locked) => {
      events.push(`resolve:${locked.id}`);
      return 25;
    },
    {},
    "运营"
  );

  assert.deepEqual(events, ["lock", "resolve:order_1", "hook:25", "save"], "取消费解析必须发生在锁单之后、写入之前");
  assert.equal(cancelled.status, RentalCoreOrderStatus.Cancelled);
  assert.equal(cancelled.chargeLines.find((line) => line.type === "cancellation").amount, 25);
  assert.equal(cancelled.finalPayableAmount, 25, "取消核减后只保留取消费");
  console.log("取消费锁内解析专项：1 项全部通过");
})().catch((error) => { console.error(error); process.exitCode = 1; });
