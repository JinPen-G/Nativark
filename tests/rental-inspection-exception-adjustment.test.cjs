const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreOrderStatus } = require("@rental-os/shared");
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

void (async () => {
  const order = {
    id: "order_adjustment_1",
    status: RentalCoreOrderStatus.Settling,
    payableAmount: 100,
    adjustmentAmount: 80,
    finalPayableAmount: 180,
    totalAmount: 180,
    taxRate: 0,
    ruleVersion: "rule-1",
    ruleSnapshot: { damage: { chargeLimit: 200 } },
    chargeLines: [{ code: "damage:order_adjustment_1:inspection_1:0", name: "检查异常费用", type: "damage", amount: 80, sourceVersion: "rule-1" }]
  };
  const saved = [];
  const service = Object.create(RentalCoreService.prototype);
  service.lockedOrder = async () => order;
  service.factStore = { saveOrderAggregate: async (nextOrder) => { saved.push(nextOrder); } };

  const adjusted = await service.adjustInspectionExceptionCharge(
    "tenant_1",
    order.id,
    "inspection_1",
    0,
    80,
    80,
    30,
    "客户申诉后按证据核减",
    "审核员",
    1,
    {}
  );
  assert.equal(adjusted.approvedChargeAmount, 30);
  assert.equal(order.finalPayableAmount, 130, "金额复核应只把损坏费用从 80 调整到 30");
  assert.deepEqual(order.chargeLines.slice(-2).map((line) => line.amount), [-80, 30], "原费用不可改写，应追加冲销和新费用行");
  assert.match(order.chargeLines.at(-1).detail, /审核员/u, "费用事实应保留复核人");
  assert.equal(saved.length, 1, "金额复核应保存订单聚合");
  ok("金额复核追加冲销与新费用，并重算最终应付");

  await assert.rejects(
    () => service.adjustInspectionExceptionCharge("tenant_1", order.id, "inspection_1", 0, 30, 80, 30, "无变化", "审核员", 2, {}),
    /金额没有变化/u
  );
  ok("相同金额的重复复核会被拒绝");

  await assert.rejects(
    () => service.adjustInspectionExceptionCharge("tenant_1", order.id, "inspection_1", 0, 30, 50, 60, "超出建议", "审核员", 2, {}),
    /不能超过检查员建议额/u
  );
  ok("复核金额不会超过检查员建议额");

  const controller = Object.create(RentalCoreController.prototype);
  const inspectionRow = {
    id: "inspection_1",
    tenantId: "tenant_1",
    workspaceId: "workspace_1",
    orderId: order.id,
    exceptions: [{
      code: "damage",
      description: "镜头外壳损伤",
      reviewStatus: "approved",
      approvedChargeAmount: 30,
      suggestedChargeAmount: 80,
      reviewReason: "初次审核记录",
      reviewedBy: "初审员",
      reviewedAt: "2026-09-14T01:00:00.000Z",
      customerResponseStatus: "disputed",
      customerResponseReason: "客户提供了维修报价"
    }]
  };
  controller.service = {
    resolveWorkspaceId: () => "workspace_1",
    lockOrderForUpdate: async () => order,
    adjustInspectionExceptionCharge: async () => ({ order, approvedChargeAmount: 20 }),
    getOrder: async () => order
  };
  controller.prisma = { rentalInspectionRecord: { findFirst: async () => inspectionRow } };
  controller.committed = (_tenantId, value) => value;
  controller.idempotent = {
    execute: async (args) => args.run({ rentalInspectionRecord: {
      findFirst: async () => inspectionRow,
      update: async ({ data }) => { inspectionRow.exceptions = data.exceptions; return inspectionRow; }
    } })
  };
  const response = await controller.reReviewInspectionException(
    { user: { tenantId: "tenant_1", displayName: "复核员" }, headers: { "idempotency-key": "adjust-1" } },
    order.id,
    inspectionRow.id,
    "0",
    { approvedChargeAmount: 20, reason: "维修报价核验后核减" }
  );
  const exception = response.exception;
  assert.equal(exception.approvedChargeAmount, 20);
  assert.equal(exception.customerResponseStatus, "pending", "复核后正数费用必须重新等待客户确认");
  assert.equal(exception.adjustmentHistory.length, 1);
  assert.equal(exception.adjustmentHistory[0].fromAmount, 30);
  assert.equal(exception.adjustmentHistory[0].toAmount, 20);
  assert.equal(exception.reviewReason, "初次审核记录", "复核不得覆盖首次审核理由");
  assert.equal(exception.reviewedBy, "初审员", "复核不得覆盖首次审核人");
  assert.equal(exception.reviewedAt, "2026-09-14T01:00:00.000Z", "复核不得覆盖首次审核时间");
  assert.equal(exception.customerResponseReason, undefined, "复核后应清除旧申诉文本，避免误读为最新响应");
  ok("控制器复核入口保留金额历史并重新打开客户确认门禁");

  console.log(`\n检查异常费用复核专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
