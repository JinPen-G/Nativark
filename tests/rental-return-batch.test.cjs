const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// Codex review #4：连续两次「归还相同数量」，第二次被幂等层当成第一次的重试而丢弃。
//
// 数量库存租 3 件，先还 1 件、再还 1 件是两次真实归还，而两次请求体完全相同。
// 兜底键此前是「订单 + 分配项内容哈希」，于是第二次直接复用第一次的结果——
// 客户还了两件，系统只记一件。
//
// 这里测的是**兜底键的区分能力**与缺标识时的 fail-closed，不测库存扣减本身
// （那部分由 rental-order-settlement 专项覆盖）。
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");
const { RentalCoreOrderStatus } = require("@store-rental/shared");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

/** 用打桩依赖拿到一个只跑幂等键构造的控制器。 */
function controller() {
  const seen = [];
  const instance = Object.create(RentalCoreController.prototype);
  instance.idempotent = {
    async execute(args) {
      seen.push(args);
      return { id: "order_1", status: RentalCoreOrderStatus.Renting };
    }
  };
  instance.service = {
    partialReturnOrder: async () => ({ id: "order_1" }),
    getOrder: async () => ({ id: "order_1", status: RentalCoreOrderStatus.Renting }),
    persist: async () => {},
    listInspectionTemplates: () => []
  };
  instance.business = { persist: async () => {} };
  return { instance, seen };
}

const req = (idempotencyKey) => ({
  user: { tenantId: "tenant_1", displayName: "运营" },
  headers: idempotencyKey ? { "idempotency-key": idempotencyKey } : {}
});
const items = [{ allocationId: "allocation_a", quantity: 1 }];

// .cjs 不支持顶层 await，与其他专项一致用 async IIFE 包裹。
void (async () => {

/* ---------- 缺标识必须 fail-closed ---------- */

await assert.rejects(
  () => controller().instance.partialReturn(req(), "order_1", { items }),
  /必须提供 Idempotency-Key 请求头或 batchNo/u,
  "两个标识都没有时必须明确拒绝"
);
ok("既无 Idempotency-Key 也无 batchNo 时拒绝，而不是静默丢掉一次真实归还");

/* ---------- 不同批次号 → 不同兜底键 → 两次都执行 ---------- */

{
  const { instance, seen } = controller();
  await instance.partialReturn(req(), "order_1", { items, batchNo: "batch-1" });
  await instance.partialReturn(req(), "order_1", { items, batchNo: "batch-2" });
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0].fallbackKey, seen[1].fallbackKey, "两次真实归还必须落在不同的兜底键上");
  assert.match(seen[0].fallbackKey, /batch-1$/u);
  assert.match(seen[1].fallbackKey, /batch-2$/u);
  ok("items 完全相同但批次号不同时兜底键不同——修复前这里是同一个键");
}

/* ---------- 相同批次号 → 相同兜底键 → 是重试 ---------- */

{
  const { instance, seen } = controller();
  await instance.partialReturn(req(), "order_1", { items, batchNo: "batch-1" });
  await instance.partialReturn(req(), "order_1", { items, batchNo: "batch-1" });
  assert.equal(seen[0].fallbackKey, seen[1].fallbackKey, "同一批次的网络重试必须命中同一个键");
  ok("同一批次号重复提交仍是同一个键，网络重试不会重复归还");
}

/* ---------- 批次号进指纹：同键换内容必须能被识别 ---------- */

{
  const { instance, seen } = controller();
  await instance.partialReturn(req(), "order_1", { items, batchNo: "batch-1" });
  assert.equal(seen[0].request.batchNo, "batch-1", "批次号必须进请求指纹");
  assert.deepEqual(seen[0].request.items, items);
  ok("批次号与归还项一起进指纹，同键不同内容会被判冲突而不是静默沿用");
}

/* ---------- 有 Idempotency-Key 时不强制 batchNo ---------- */

{
  const { instance, seen } = controller();
  await instance.partialReturn(req("client-key-1"), "order_1", { items });
  assert.equal(seen[0].key, "client-key-1", "显式幂等键必须透传");
  ok("已带 Idempotency-Key 时不再强制 batchNo：调用方已经提供了区分标识");
}

console.log(`\n分批归还批次标识专项：${passed} 项全部通过`);

})();
