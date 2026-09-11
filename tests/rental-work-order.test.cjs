const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

const at = new Date("2040-01-01T10:00:00.000Z");
const row = () => ({
  id: "work_1", tenantId: "tenant_1", workspaceId: "workspace_1", workNo: "WO-1",
  type: "repair", status: "pending", dispositionId: "disp_1", orderId: "order_1", inspectionId: "inspection_1",
  itemGroupId: "group_1", locationId: "location_1", assetId: null, quantity: 1,
  assigneeId: null, assigneeName: null, reason: "机身划伤", result: null, attachments: [],
  startedAt: null, submittedAt: null, reviewedAt: null, reviewedBy: null, reviewReason: null,
  createdBy: "运营", createdAt: at, updatedAt: at
});

function fakeTx() {
  const state = row();
  const dispositionUpdates = [];
  const workOrderUpdates = [];
  const logs = [];
  const tx = {
    state,
    dispositionUpdates,
    workOrderUpdates,
    logs,
    businessWorkspace: { findFirst: async () => ({ id: "workspace_1" }) },
    rentalWorkOrder: {
      findFirst: async () => ({ ...state }),
      updateMany: async ({ data }) => { Object.assign(state, data); workOrderUpdates.push(data); return { count: 1 }; },
      findUnique: async () => null
    },
    rentalStockDisposition: { updateMany: async (args) => { dispositionUpdates.push(args); return { count: 1 }; } },
    operationLog: { create: async ({ data }) => { logs.push(data); } }
  };
  return tx;
}

void (async () => {
  const repo = Object.create(RentalCoreFactRepository.prototype);
  const tx = fakeTx();

  const started = await repo.transitionWorkOrder("tenant_1", "work_1", "start", "张三", {}, tx);
  assert.equal(started.status, "in_progress");
  assert.equal(tx.workOrderUpdates[0].status, "in_progress");
  ok("工单只能从待处理进入处理中，并记录推进事实");

  const submitted = await repo.transitionWorkOrder("tenant_1", "work_1", "submit", "张三", { result: "已更换损坏部件" }, tx);
  assert.equal(submitted.status, "pending_review");
  assert.equal(submitted.result, "已更换损坏部件");
  ok("处理中工单提交结果后进入待验收");

  const completed = await repo.transitionWorkOrder("tenant_1", "work_1", "review", "李主管", { decision: "approved", reason: "复检通过" }, tx);
  assert.equal(completed.status, "completed");
  assert.equal(tx.dispositionUpdates.length, 1);
  assert.equal(tx.dispositionUpdates[0].data.status, "buffered");
  assert.equal(tx.logs.length, 3);
  ok("验收通过同时解除异常阻断并恢复周转缓冲状态");

  tx.state.status = "completed";
  await assert.rejects(
    () => repo.transitionWorkOrder("tenant_1", "work_1", "start", "张三", {}, tx),
    /只有待处理工单可以开始/
  );
  ok("已完成工单不能被重复推进");

  const rejectedTx = fakeTx();
  await repo.transitionWorkOrder("tenant_1", "work_1", "start", "张三", {}, rejectedTx);
  await repo.transitionWorkOrder("tenant_1", "work_1", "submit", "张三", { result: "第一次处理" }, rejectedTx);
  const rejected = await repo.transitionWorkOrder("tenant_1", "work_1", "review", "李主管", { decision: "rejected", reason: "复检仍有异常" }, rejectedTx);
  assert.equal(rejected.status, "in_progress");
  assert.equal(rejectedTx.dispositionUpdates.at(-1).data.status, "blocked");
  ok("验收驳回回到处理中并继续阻断资源");

  const cancelledTx = fakeTx();
  const cancelled = await repo.transitionWorkOrder("tenant_1", "work_1", "cancel", "李主管", { reason: "客户撤回维修申请" }, cancelledTx);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelledTx.dispositionUpdates[0].data.status, "blocked");
  ok("取消工单保留异常阻断，不会释放资源");

  console.log(`\n养护工单专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
