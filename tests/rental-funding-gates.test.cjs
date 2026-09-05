const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalFundingService } = require("../apps/api/src/modules/rental-core/rental-funding.service");

const event = (instrument, action, amount) => ({ instrument, action, amount });
const order = { depositAmount: 200, preAuthAmount: 300, payable: 1000, status: "ready_for_pickup", ruleSnapshot: { payment: { timing: "pickup" } } };
let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

function serviceWith(events, snapshot = order) {
  const service = Object.create(RentalFundingService.prototype);
  service.lockedOrderScope = async () => snapshot;
  service.loadEvents = async () => events;
  return service;
}

void (async () => {
  // “曾收过”不等于当前可领取：退款或释放后的实际余额必须还足额。
  {
    const events = [event("rental", "append", 800), event("deposit", "initiate", 200), event("preauthorization", "initiate", 300)];
    const service = serviceWith(events);
    await assert.rejects(() => service.assertReadyForPickup("tenant", "workspace", "order", {}), /尚需收款 200\.00/u);
    events.push(event("rental", "append", 200));
    await assert.doesNotReject(() => service.assertReadyForPickup("tenant", "workspace", "order", {}));
    events.splice(events.findIndex((row) => row.instrument === "deposit"), 1, event("deposit", "initiate", 200), event("deposit", "refund", 200));
    await assert.rejects(() => service.assertReadyForPickup("tenant", "workspace", "order", {}), /足额收取押金/u);
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
    await assert.doesNotReject(() => service.assertReadyToClose("tenant", "workspace", "order", {}));
    service.lockedOrderScope = async () => ({ ...order, status: "settling", payable: 950 });
    await assert.rejects(() => service.assertReadyToClose("tenant", "workspace", "order", {}), /尚有退款 50\.00/u);
    ok("关闭订单同时拒绝待收款和待退款，保证金释放不替代租赁结算");
  }

  // 订单确认时点由规则快照决定；confirmation 模式没有实收不得确认。
  {
    const service = serviceWith([], { ...order, ruleSnapshot: { payment: { timing: "confirmation" } } });
    await assert.rejects(() => service.assertReadyForConfirmation("tenant", "workspace", "order", {}), /尚需收款 1000\.00/u);
    service.loadEvents = async () => [event("rental", "append", 1000)];
    await assert.doesNotReject(() => service.assertReadyForConfirmation("tenant", "workspace", "order", {}));
    ok("确认时全额支付规则复核实际租赁收款，付款成功才允许确认");
  }

  console.log(`\n订单资金门禁专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
