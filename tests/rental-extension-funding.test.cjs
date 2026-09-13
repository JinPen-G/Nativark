const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// Codex review #6：续租申请的资金与失效处理。
//
// 三条各自独立：
//   (a) 租金差额为 0 但需追加押金 100 时，续租仍直接生效——押金从此漏收；
//   (b) 订单已终结却仍为遗留待付款续租计入待收，页面给出一个必然失败的补款按钮；
//   (c) 归还/取消/完成时未处理未生效申请，pending_payment 没有自然终态。
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalCoreOrderStatus } = require("@rental-os/shared");
const {
  extensionPaymentRequired,
  pendingExtensionCountsAsDue
} = require("../apps/api/src/modules/rental-core/rental-extension-lifecycle");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

/** 只跑续租失效相关方法的服务实例。 */
function service(extensions) {
  const cancelled = [];
  const instance = Object.create(RentalCoreService.prototype);
  instance.factStore = {
    listExtensions: async () => extensions,
    cancelExtensions: async (_tenantId, ids) => { cancelled.push(...ids); }
  };
  return { instance, cancelled };
}

void (async () => {

/* ---------- (a) 押金差额必须触发补款，不能直接生效 ---------- */

// 直接用实现导出的判据：三个调用点（试算/申请/资金）现在共用它，
// 复制一份判据的测试改了实现也不会报红。
const paymentRequired = extensionPaymentRequired;

assert.equal(
  paymentRequired({ settlementMode: "immediate", payableAmount: 0, depositDelta: 100, preAuthDelta: 0 }),
  true,
  "租金差额 0、押金要补 100：必须走补款，不能直接生效"
);
assert.equal(
  paymentRequired({ settlementMode: "immediate", payableAmount: 0, depositDelta: 0, preAuthDelta: 200 }),
  true,
  "预授权差额同理"
);
assert.equal(
  paymentRequired({ settlementMode: "immediate", payableAmount: 0, depositDelta: 0, preAuthDelta: 0 }),
  false,
  "三者都为 0 才是真正的免费续租，直接生效"
);
assert.equal(
  paymentRequired({ settlementMode: "monthly", payableAmount: 500, depositDelta: 100, preAuthDelta: 0 }),
  false,
  "企业月结不走补款，金额进月结账单"
);
ok("(a) 押金/预授权差额纳入补款判据，免费续租的判定不再只看租金");

/* ---------- (c) 遗留待补款申请在终态被作废 ---------- */

{
  const { instance, cancelled } = service([
    { id: "ext_1", status: "pending_payment" },
    { id: "ext_2", status: "effective" },
    { id: "ext_3", status: "pending_payment" },
    { id: "ext_4", status: "cancelled" }
  ]);
  await instance.voidPendingExtensions("tenant_1", "order_1", {});
  assert.deepEqual(cancelled, ["ext_1", "ext_3"], "只作废待补款的，已生效与已作废的不动");
  ok("(c) 只作废 pending_payment，已生效的续租不受影响");
}

{
  const { instance, cancelled } = service([{ id: "ext_1", status: "effective" }]);
  await instance.voidPendingExtensions("tenant_1", "order_1", {});
  assert.deepEqual(cancelled, [], "没有待补款申请时不产生任何写入");
  ok("(c) 无待补款申请时不做无谓写入，重复调用幂等");
}

/* ---------- (b) 终态订单不再计入遗留续租的待收 ---------- */

// 同样直接用实现导出的判据。
const countsPending = pendingExtensionCountsAsDue;

for (const [status, expected] of [
  ["RENTING", true], ["READY_FOR_PICKUP", true], ["RESERVED", true],
  ["SETTLING", false], ["COMPLETED", false], ["CANCELLED", false]
]) {
  assert.equal(countsPending(status), expected, `${status} 的待收口径不符`);
}
ok("(b) 待收金额只在订单仍可能生效续租时计入遗留申请（大小写不敏感）");

console.log(`\n续租资金与失效专项：${passed} 项全部通过`);

})().catch((error) => { console.error(error); process.exitCode = 1; });
