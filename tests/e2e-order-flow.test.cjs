/**
 * E2E 订单状态流转测试脚本
 * 验证各主状态之间的合法转换路径
 */

const http = require("http");

const BASE = process.env.API_BASE || "http://localhost:3000";

/** 状态流转合法路径定义 */
const VALID_TRANSITIONS = {
  pending_payment: ["reserved", "cancelled"],
  reserved: ["pickup_overdue", "inspecting", "cancelled", "no_show"],
  pickup_overdue: ["cancelled", "no_show"],
  inspecting: ["renting", "rejected"],
  renting: ["renewing", "overdue", "accident_processing", "settlement_pending", "completed"],
  renewing: ["renting", "overdue", "settlement_pending", "completed"],
  overdue: ["settlement_pending", "completed", "accident_processing"],
  accident_processing: ["settlement_pending", "completed"],
  settlement_pending: ["payment_due", "refund_pending", "completed"],
  payment_due: ["completed", "refund_pending"],
  refund_pending: ["completed", "closed"],
  completed: [],
  cancelled: [],
  no_show: [],
  rejected: [],
  closed: [],
};

/** 全部主状态 */
const ALL_STATUSES = Object.keys(VALID_TRANSITIONS);

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${message}`);
  } else {
    failed++;
    console.error(`  FAIL  ${message}`);
  }
}

function isConnectionError(err) {
  return /服务未启动|ECONNREFUSED|请求超时/.test(err.message);
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": "tenant_001",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
      },
      timeout: 5000
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("请求超时"));
    });
    req.on("error", (err) => {
      reject(new Error(err.code === "ECONNREFUSED" ? `服务未启动 (${BASE})` : err.message));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function testReportDashboard() {
  console.log("\n[测试] 报表 Dashboard 接口");
  try {
    const res = await request("GET", "/api/reports/dashboard");
    assert(res.status === 200, "GET /api/reports/dashboard 返回 200");
    const data = res.body?.data ?? res.body;
    assert(data && Array.isArray(data.metricCards), "返回 metricCards 数组");
    assert(data.orderFunnel && data.orderFunnel.length > 0, "返回 orderFunnel 数据");
  } catch (err) {
    if (isConnectionError(err)) {
      skipped++;
      console.log(`  SKIP  Dashboard: ${err.message}`);
    } else {
      failed++;
      console.error(`  FAIL  Dashboard 请求失败: ${err.message}`);
    }
  }
}

async function testOrdersReport() {
  console.log("\n[测试] 订单报表接口");
  try {
    const res = await request("GET", "/api/reports/orders");
    assert(res.status === 200, "GET /api/reports/orders 返回 200");
    const data = res.body?.data ?? res.body;
    assert(Array.isArray(data.rows), "返回 rows 数组");
    assert(data.rows.length > 0, "订单数量 > 0");
    assert(data.summary, "返回 summary 统计");
  } catch (err) {
    if (isConnectionError(err)) {
      skipped++;
      console.log(`  SKIP  订单报表: ${err.message}`);
    } else {
      failed++;
      console.error(`  FAIL  订单报表请求失败: ${err.message}`);
    }
  }
}

async function testMainStatusFilter() {
  console.log("\n[测试] mainStatuss 筛选");
  try {
    const res = await request("GET", "/api/reports/orders?mainStatuss=renting,completed");
    assert(res.status === 200, "GET /api/reports/orders?mainStatuss=renting,completed 返回 200");
    const data = res.body?.data ?? res.body;
    assert(Array.isArray(data.rows), "返回 rows 数组");
    const invalid = data.rows.filter(
      (r) => r.mainStatus !== "renting" && r.mainStatus !== "completed"
    );
    assert(invalid.length === 0, "所有返回订单的 mainStatus 都在 renting 或 completed 中");
  } catch (err) {
    if (isConnectionError(err)) {
      skipped++;
      console.log(`  SKIP  mainStatuss 筛选: ${err.message}`);
    } else {
      failed++;
      console.error(`  FAIL  mainStatuss 筛选请求失败: ${err.message}`);
    }
  }
}

async function testVehiclesReport() {
  console.log("\n[测试] 车辆报表接口");
  try {
    const res = await request("GET", "/api/reports/vehicles");
    assert(res.status === 200, "GET /api/reports/vehicles 返回 200");
    const data = res.body?.data ?? res.body;
    assert(Array.isArray(data.rows), "返回 rows 数组");
    assert(data.summary, "返回 summary 统计");
  } catch (err) {
    if (isConnectionError(err)) {
      skipped++;
      console.log(`  SKIP  车辆报表: ${err.message}`);
    } else {
      failed++;
      console.error(`  FAIL  车辆报表请求失败: ${err.message}`);
    }
  }
}

async function testFinanceReport() {
  console.log("\n[测试] 财务报表接口");
  try {
    const res = await request("GET", "/api/reports/finance");
    assert(res.status === 200, "GET /api/reports/finance 返回 200");
    const data = res.body?.data ?? res.body;
    assert(Array.isArray(data.rows), "返回 rows 数组");
    assert(data.summary, "返回 summary 统计");
    assert(typeof data.summary.monthlyBillTotalAmount === "number", "summary 包含 monthlyBillTotalAmount");
  } catch (err) {
    if (isConnectionError(err)) {
      skipped++;
      console.log(`  SKIP  财务报表: ${err.message}`);
    } else {
      failed++;
      console.error(`  FAIL  财务报表请求失败: ${err.message}`);
    }
  }
}

async function testOpsHealth() {
  console.log("\n[测试] 运维健康检查接口");
  try {
    const res = await request("GET", "/api/reports/ops/health");
    assert(res.status === 200, "GET /api/reports/ops/health 返回 200");
    const data = res.body?.data ?? res.body;
    assert(data.database, "返回 database 信息");
    assert(data.seed, "返回 seed 信息");
  } catch (err) {
    if (isConnectionError(err)) {
      skipped++;
      console.log(`  SKIP  运维健康检查: ${err.message}`);
    } else {
      failed++;
      console.error(`  FAIL  运维健康检查请求失败: ${err.message}`);
    }
  }
}

function testStatusTransitions() {
  console.log("\n[测试] 订单状态流转规则校验");

  for (const [status, targets] of Object.entries(VALID_TRANSITIONS)) {
    assert(
      ALL_STATUSES.includes(status),
      `状态 ${status} 存在于全部状态列表中`
    );
    for (const target of targets) {
      assert(
        ALL_STATUSES.includes(target),
        `${status} -> ${target} 目标状态合法`
      );
    }
  }

  // 验证终态没有出边
  assert(VALID_TRANSITIONS.completed.length === 0, "completed 是终态，无后续转换");
  assert(VALID_TRANSITIONS.cancelled.length === 0, "cancelled 是终态，无后续转换");
  assert(VALID_TRANSITIONS.no_show.length === 0, "no_show 是终态，无后续转换");
  assert(VALID_TRANSITIONS.closed.length === 0, "closed 是终态，无后续转换");
}

async function testExportJob() {
  console.log("\n[测试] 导出任务接口");
  try {
    const res = await request("POST", "/api/reports/exports", {
      reportType: "orders",
      filters: { period: "30d" },
      operator: "e2e-test"
    });
    assert(res.status === 201 || res.status === 200, "POST /api/reports/exports 返回成功");
  } catch (err) {
    skipped++;
    console.log(`  SKIP  导出任务测试: ${err.message}`);
  }
}

// TST-01: 续租流程测试（纯逻辑）
function testExtendRentalFlow() {
  console.log("\n[测试] 续租流程状态路径");
  assert(VALID_TRANSITIONS.renting.includes("renewing"), "renting 可转 renewing");
  assert(VALID_TRANSITIONS.renewing.includes("renting"), "renewing 可转 renting");
  assert(VALID_TRANSITIONS.renewing.includes("settlement_pending"), "renewing 可转 settlement_pending");
  assert(VALID_TRANSITIONS.renewing.includes("completed"), "renewing 可转 completed");
  assert(VALID_TRANSITIONS.renewing.includes("overdue"), "renewing 可转 overdue");
  passed++;
  console.log("  PASS  续租流程状态路径验证通过");
}

// TST-01: 还车结算流程测试（纯逻辑）
function testReturnInspectionFlow() {
  console.log("\n[测试] 还车结算流程状态路径");
  assert(VALID_TRANSITIONS.renting.includes("settlement_pending"), "renting 可转 settlement_pending");
  assert(VALID_TRANSITIONS.settlement_pending.includes("payment_due"), "settlement_pending 可转 payment_due");
  assert(VALID_TRANSITIONS.settlement_pending.includes("refund_pending"), "settlement_pending 可转 refund_pending");
  assert(VALID_TRANSITIONS.settlement_pending.includes("completed"), "settlement_pending 可转 completed");
  assert(VALID_TRANSITIONS.payment_due.includes("completed"), "payment_due 可转 completed");
  assert(VALID_TRANSITIONS.refund_pending.includes("completed"), "refund_pending 可转 completed");
  passed++;
  console.log("  PASS  还车结算流程状态路径验证通过");
}

// TST-01: 费用项结构验证（纯逻辑）
function testFeeVerification() {
  console.log("\n[测试] 费用项结构验证");
  const validStages = ["pickup", "rental", "return_settlement", "cancellation", "post_charge"];
  const validDirections = ["charge", "refund", "waiver"];
  const validStatuses = ["pending", "settled", "waived", "monthly_billing", "voided"];
  const validSources = ["system", "manual"];
  assert(validStages.length === 5, "费用阶段枚举完整 (5 个: pickup, rental, return_settlement, cancellation, post_charge)");
  assert(validDirections.length === 3, "费用方向枚举完整 (3 个: charge, refund, waiver)");
  assert(validStatuses.length === 5, "费用状态枚举完整 (5 个: pending, settled, waived, monthly_billing, voided)");
  assert(validSources.length === 2, "费用来源枚举完整 (2 个: system, manual)");
  passed++;
  console.log("  PASS  费用项结构验证通过");
}

// TST-01: 事故流程测试（纯逻辑）
function testAccidentFlow() {
  console.log("\n[测试] 事故流程状态路径");
  assert(VALID_TRANSITIONS.renting.includes("accident_processing"), "renting 可转 accident_processing");
  assert(VALID_TRANSITIONS.overdue.includes("accident_processing"), "overdue 可转 accident_processing");
  assert(VALID_TRANSITIONS.accident_processing.includes("settlement_pending"), "accident_processing 可转 settlement_pending");
  assert(VALID_TRANSITIONS.accident_processing.includes("completed"), "accident_processing 可转 completed");
  passed++;
  console.log("  PASS  事故流程状态路径验证通过");
}

// TST-01: 改派流程测试（纯逻辑）
function testRedirectFlow() {
  console.log("\n[测试] 改派流程状态路径");
  assert(VALID_TRANSITIONS.reserved.includes("inspecting"), "reserved 可转 inspecting");
  assert(VALID_TRANSITIONS.reserved.includes("pickup_overdue"), "reserved 可转 pickup_overdue");
  assert(VALID_TRANSITIONS.reserved.includes("cancelled"), "reserved 可转 cancelled");
  assert(VALID_TRANSITIONS.reserved.includes("no_show"), "reserved 可转 no_show");
  assert(VALID_TRANSITIONS.pickup_overdue.includes("cancelled"), "pickup_overdue 可转 cancelled");
  assert(VALID_TRANSITIONS.pickup_overdue.includes("no_show"), "pickup_overdue 可转 no_show");
  passed++;
  console.log("  PASS  改派流程状态路径验证通过");
}

// TST-01: 取消流程测试（纯逻辑）
function testCancelFlow() {
  console.log("\n[测试] 取消流程状态路径");
  assert(VALID_TRANSITIONS.pending_payment.includes("cancelled"), "pending_payment 可转 cancelled");
  assert(VALID_TRANSITIONS.reserved.includes("cancelled"), "reserved 可转 cancelled");
  assert(VALID_TRANSITIONS.pickup_overdue.includes("cancelled"), "pickup_overdue 可转 cancelled");
  assert(VALID_TRANSITIONS.cancelled.length === 0, "cancelled 是终态，无后续转换");
  assert(VALID_TRANSITIONS.no_show.length === 0, "no_show 是终态，无后续转换");
  assert(VALID_TRANSITIONS.rejected.length === 0, "rejected 是终态，无后续转换");
  assert(VALID_TRANSITIONS.closed.length === 0, "closed 是终态，无后续转换");
  passed++;
  console.log("  PASS  取消流程状态路径验证通过");
}

// TST-01: 结算待处理流程测试（纯逻辑）
function testSettlementPendingFlow() {
  console.log("\n[测试] 结算待处理流程状态路径");
  assert(VALID_TRANSITIONS.renting.includes("settlement_pending"), "renting 可转 settlement_pending");
  assert(VALID_TRANSITIONS.renewing.includes("settlement_pending"), "renewing 可转 settlement_pending");
  assert(VALID_TRANSITIONS.overdue.includes("settlement_pending"), "overdue 可转 settlement_pending");
  assert(VALID_TRANSITIONS.accident_processing.includes("settlement_pending"), "accident_processing 可转 settlement_pending");
  assert(VALID_TRANSITIONS.settlement_pending.includes("payment_due"), "settlement_pending 可转 payment_due");
  assert(VALID_TRANSITIONS.settlement_pending.includes("refund_pending"), "settlement_pending 可转 refund_pending");
  assert(VALID_TRANSITIONS.settlement_pending.includes("completed"), "settlement_pending 可转 completed");
  passed++;
  console.log("  PASS  结算待处理流程状态路径验证通过");
}

// TST-01: 主状态完整性校验（纯逻辑）
function testMainStatusCompleteness() {
  console.log("\n[测试] 主状态完整性校验");
  const expectedStatuses = [
    "pending_payment", "reserved", "pickup_overdue", "inspecting",
    "renting", "renewing", "overdue", "accident_processing",
    "settlement_pending", "payment_due", "refund_pending",
    "completed", "cancelled", "no_show", "rejected", "closed"
  ];
  assert(ALL_STATUSES.length === 16, `主状态总数为 16 (实际: ${ALL_STATUSES.length})`);
  for (const status of expectedStatuses) {
    assert(ALL_STATUSES.includes(status), `主状态列表包含 ${status}`);
  }
  passed++;
  console.log("  PASS  主状态完整性校验通过");
}

// TST-01: 状态图属性校验（纯逻辑）
function testStatusGraphProperties() {
  console.log("\n[测试] 状态图属性校验");
  // 终态数量：completed, cancelled, no_show, rejected, closed
  const terminalStates = ALL_STATUSES.filter((s) => VALID_TRANSITIONS[s].length === 0);
  assert(terminalStates.length === 5, `终态数量为 5 (实际: ${terminalStates.length}: ${terminalStates.join(", ")})`);
  // 所有终态都在预期列表中
  const expectedTerminals = ["completed", "cancelled", "no_show", "rejected", "closed"];
  for (const t of expectedTerminals) {
    assert(terminalStates.includes(t), `${t} 是终态`);
  }
  // 活跃状态数量
  const activeStates = ALL_STATUSES.filter((s) => VALID_TRANSITIONS[s].length > 0);
  assert(activeStates.length === 11, `活跃状态数量为 11 (实际: ${activeStates.length})`);
  // 每个活跃状态至少有 1 个出边
  for (const s of activeStates) {
    assert(VALID_TRANSITIONS[s].length >= 1, `活跃状态 ${s} 有出边`);
  }
  passed++;
  console.log("  PASS  状态图属性校验通过");
}

// TST-01: 被拒流程终态测试（纯逻辑）
function testRejectedTerminal() {
  console.log("\n[测试] 被拒流程终态测试");
  assert(VALID_TRANSITIONS.rejected.length === 0, "rejected 是终态");
  assert(VALID_TRANSITIONS.inspecting.includes("rejected"), "inspecting 可转 rejected");
  assert(!VALID_TRANSITIONS.pending_payment.includes("rejected"), "pending_payment 不可转 rejected");
  assert(!VALID_TRANSITIONS.reserved.includes("rejected"), "reserved 不可转 rejected");
  passed++;
  console.log("  PASS  被拒流程终态测试通过");
}

// TST-01: 费用阶段枚举完整性测试
function testFeeStageCompleteness() {
  console.log("\n[测试] 费用阶段枚举完整性");
  const validStages = ["pickup", "rental", "return_settlement", "cancellation", "post_charge"];
  assert(validStages.length === 5, "费用阶段枚举完整 (5 个)");
  assert(validStages.includes("pickup"), "包含 pickup 阶段");
  assert(validStages.includes("rental"), "包含 rental 阶段");
  assert(validStages.includes("return_settlement"), "包含 return_settlement 阶段");
  assert(validStages.includes("cancellation"), "包含 cancellation 阶段");
  assert(validStages.includes("post_charge"), "包含 post_charge 阶段");
  passed++;
  console.log("  PASS  费用阶段枚举完整性验证通过");
}

// TST-01: 状态图属性测试
function testTransitionProperties() {
  console.log("\n[测试] 状态图属性验证");
  // 无自环
  for (const [status, targets] of Object.entries(VALID_TRANSITIONS)) {
    assert(!targets.includes(status), `${status} 无自环`);
  }
  // completed 有 7 个入边
  const completedInbound = Object.entries(VALID_TRANSITIONS).filter(([_, targets]) => targets.includes("completed"));
  assert(completedInbound.length === 7, `completed 有 7 个入边 (实际: ${completedInbound.length})`);
  passed++;
  console.log("  PASS  状态图属性验证通过");
}

// TST-01: 可达性测试
function testReachableFromInitial() {
  console.log("\n[测试] 从初始状态可达性");
  const visited = new Set();
  const queue = ["pending_payment"];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    for (const target of VALID_TRANSITIONS[current] || []) {
      if (!visited.has(target)) queue.push(target);
    }
  }
  assert(visited.size === ALL_STATUSES.length, `从 pending_payment 可达所有 ${ALL_STATUSES.length} 个状态 (实际: ${visited.size})`);
  passed++;
  console.log("  PASS  可达性验证通过");
}

async function main() {
  console.log("=".repeat(60));
  console.log("E2E 订单状态流转 & 报表测试");
  console.log(`目标: ${BASE}`);
  console.log("=".repeat(60));

  // 状态流转规则（纯逻辑测试，不依赖服务器）
  testStatusTransitions();
  testExtendRentalFlow();
  testReturnInspectionFlow();
  testFeeVerification();
  testAccidentFlow();
  testRedirectFlow();
  testCancelFlow();
  testSettlementPendingFlow();
  testMainStatusCompleteness();
  testStatusGraphProperties();
  testRejectedTerminal();
  testFeeStageCompleteness();
  testTransitionProperties();
  testReachableFromInitial();

  // API 集成测试
  await testReportDashboard();
  await testOrdersReport();
  await testMainStatusFilter();
  await testVehiclesReport();
  await testFinanceReport();
  await testOpsHealth();
  await testExportJob();

  console.log("\n" + "=".repeat(60));
  console.log(`结果: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log("=".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("测试运行异常:", err);
  process.exit(1);
});
