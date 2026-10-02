const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { inspectionClosureError, validateInspectionCustomerResponse } = require("../apps/api/src/modules/rental-core/rental-inspection-customer-response");
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

assert.match(
  validateInspectionCustomerResponse({ reviewStatus: "approved", approvedChargeAmount: 30, currentStatus: "pending", decision: "confirmed" }) ?? "",
  /^$/u,
  "正数异常费用待确认时允许记录客户确认"
);
ok("正数异常费用可以进入客户确认");

assert.match(
  validateInspectionCustomerResponse({ reviewStatus: "approved", approvedChargeAmount: 30, currentStatus: "pending", decision: "disputed" }) ?? "",
  /^$/u,
  "正数异常费用待确认时允许记录客户申诉"
);
ok("正数异常费用可以进入客户申诉");

assert.match(
  validateInspectionCustomerResponse({ reviewStatus: "approved", approvedChargeAmount: 0, currentStatus: "pending", decision: "confirmed" }) ?? "",
  /金额大于 0/u,
  "零金额异常不要求客户确认"
);
ok("零金额异常不会误触发客户确认门禁");

assert.match(
  validateInspectionCustomerResponse({ reviewStatus: "pending", approvedChargeAmount: 30, currentStatus: "pending", decision: "confirmed" }) ?? "",
  /已批准/u,
  "尚未完成费用审核时不能记录客户确认"
);
ok("客户确认不能绕过费用审核");

assert.match(
  validateInspectionCustomerResponse({ reviewStatus: "approved", approvedChargeAmount: 30, currentStatus: "disputed", decision: "disputed" }) ?? "",
  /现有申诉/u,
  "同一申诉不能重复提交"
);
ok("申诉重复提交会被拒绝");

assert.match(
  validateInspectionCustomerResponse({ reviewStatus: "approved", approvedChargeAmount: 30, currentStatus: "disputed", decision: "confirmed" }) ?? "",
  /^$/u,
  "申诉后可以追加记录客户确认"
);
ok("申诉后的后续确认保留可操作出口");
for (const currentStatus of [undefined, "not_required", "pending", "disputed"]) {
  assert.match(inspectionClosureError([{ exceptions: [{ reviewStatus: "approved", approvedChargeAmount: 30, customerResponseStatus: currentStatus }] }]), /待客户确认/u);
}
assert.equal(inspectionClosureError([{ exceptions: [{ reviewStatus: "approved", approvedChargeAmount: 30, customerResponseStatus: "confirmed" }] }]), undefined);
assert.equal(inspectionClosureError([{ exceptions: [{ reviewStatus: "rejected" }, { reviewStatus: "approved", approvedChargeAmount: 0 }] }]), undefined);
assert.match(inspectionClosureError([{ exceptions: [{ reviewStatus: "pending" }] }]), /待审核/u);
assert.match(inspectionClosureError([{ exceptions: [{ reviewStatus: "approved", approvedChargeAmount: NaN }] }]), /金额无效/u);
for (const invalidAmount of [null, "", "0", false, [], undefined, -1, Infinity]) {
  assert.match(inspectionClosureError([{ exceptions: [{ reviewStatus: "approved", approvedChargeAmount: invalidAmount }] }]), /金额无效/u);
}
assert.equal(validateInspectionCustomerResponse({ reviewStatus: "approved", approvedChargeAmount: 30, currentStatus: "not_required", decision: "confirmed" }), undefined);
assert.match(validateInspectionCustomerResponse({ reviewStatus: "approved", approvedChargeAmount: NaN, decision: "confirmed" }), /已批准/u);
ok("缺失或错误响应状态不能关单，存量正数费用可补录真实响应");

void (async () => {
{
  const instance = Object.create(RentalCoreController.prototype);
  const row = {
    id: "inspection_1",
    tenantId: "tenant_1",
    workspaceId: "workspace_1",
    orderId: "order_1",
    exceptions: [{ reviewStatus: "approved", approvedChargeAmount: 80, customerResponseStatus: "pending" }]
  };
  instance.service = {
    resolveWorkspaceId: () => "workspace_1",
    lockOrderForUpdate: async () => ({ id: "order_1", status: "settling" }),
    getOrder: async () => ({ id: "order_1", status: "settling" })
  };
  instance.prisma = { rentalInspectionRecord: { findFirst: async () => row } };
  instance.committed = (_tenantId, value) => value;
  instance.idempotent = { execute: async (args) => args.run({ rentalInspectionRecord: {
    findFirst: async () => row,
    update: async ({ data }) => { row.exceptions = data.exceptions; return row; }
  } }) };
  await assert.rejects(instance.recordInspectionExceptionCustomerResponse(
    { user: { tenantId: "tenant_1", displayName: "客服" }, headers: {} },
    "order_1", "inspection_1", "0", { decision: "confirmed", reason: "   " }
  ), /记录依据/u);
  assert.equal(row.exceptions[0].customerResponseStatus, "pending", "空白依据不能写入确认状态");
  const response = await instance.recordInspectionExceptionCustomerResponse(
    { user: { tenantId: "tenant_1", displayName: "客服" }, headers: {} },
    "order_1", "inspection_1", "0", { decision: "confirmed", reason: "客户现场确认损坏费用" }
  );
  assert.equal(response.exception.customerResponseStatus, "confirmed", "真实控制器入口必须写入客户确认状态");
  assert.equal(response.exception.customerResponseHistory.length, 1, "真实控制器入口必须追加客户响应历史");
  assert.equal(row.exceptions[0].customerRespondedBy, "客服", "客户响应必须记录操作者");
  ok("控制器入口锁订单、更新检查记录并追加客户响应历史");
}

console.log(`\n检查异常客户响应专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
