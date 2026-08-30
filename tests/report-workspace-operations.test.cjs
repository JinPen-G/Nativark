const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * REPORT-01A 专项：当前经营空间经营报表。
 *
 * 断言集中在三处，每一处都是「错了就会给出一份看似合理、实则错误的报表」的地方：
 *   1. **隔离**：同租户另一个空间、另一个租户的订单都不得进入本空间的数字；
 *   2. **公式**：四个品类走同一套公式，草稿不计，异常订单按去重订单计；
 *   3. **口径纯度**：出参里不得出现车辆/门市/旧 Store Rental 专用字段。
 */

const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const dbName = new URL(env.DATABASE_URL).pathname.slice(1);
if (!/claude/.test(dbName)) {
  console.error(`拒绝执行：REPORT 专项只能跑在专用库上，当前指向 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = env.DATABASE_URL;

const { PrismaClient, Prisma } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const {
  RentalWorkspaceReportRepository
} = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-workspace-report.repository"));

const suffix = Date.now().toString(36);
const tenantA = `t_rep_a_${suffix}`;
const tenantB = `t_rep_b_${suffix}`;
const wsA1 = `ws_rep_a1_${suffix}`;
const wsA2 = `ws_rep_a2_${suffix}`;
const wsEmpty = `ws_rep_empty_${suffix}`;
const wsB1 = `ws_rep_b1_${suffix}`;

let prisma = new PrismaClient();
let reports = new RentalWorkspaceReportRepository(prisma);

const ok = (m) => console.log(`  ✓ ${m}`);
const dec = (value) => new Prisma.Decimal(value);

async function cleanup() {
  await prisma.rentalOrder.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
}

/**
 * 断言失败时也必须清夹具。
 *
 * 早前清理只写在 happy path 末尾：一次断言抛出就把 `t_rep_*` 租户连同订单
 * 留在专用库里（实测跑变异时攒下 22 个租户、165 张订单）。
 * 专项自己往库里堆垃圾，下一个人排查真问题时要先分辨哪些是残留。
 */
async function withCleanup(run) {
  try {
    await run();
  } finally {
    try {
      await cleanup();
    } catch (error) {
      // 清理失败不能掩盖原始断言错误，但必须说出来，否则残留会静默留下。
      console.error(`（清理夹具失败，请手工删除 ${tenantA} / ${tenantB}）：${error?.message ?? error}`);
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

/** 四个空间各绑一个品类：用来证明公式与品类无关。 */
const WORKSPACES = [
  { id: wsA1, tenantId: () => tenantA, category: "CAMERA", isDefault: true },
  { id: wsA2, tenantId: () => tenantA, category: "VEHICLE", isDefault: false },
  { id: wsEmpty, tenantId: () => tenantA, category: "CAMPING", isDefault: false },
  { id: wsB1, tenantId: () => tenantB, category: "CONSTRUCTION", isDefault: true }
];

async function seed() {
  for (const [id, code] of [[tenantA, `rep-a-${suffix}`], [tenantB, `rep-b-${suffix}`]]) {
    await prisma.tenant.create({ data: { id, code, name: `REPORT-01A 测试租户 ${code}` } });
  }
  for (const ws of WORKSPACES) {
    await prisma.businessWorkspace.create({
      data: {
        id: ws.id, tenantId: ws.tenantId(), code: ws.id, name: ws.id,
        categoryCode: ws.category, isDefault: ws.isDefault,
        defaultMarker: ws.isDefault ? "default" : ws.id
      }
    });
    await prisma.rentalFulfillmentLocation.create({
      data: {
        id: `loc_${ws.id}`, tenantId: ws.tenantId(), workspaceId: ws.id,
        code: `L-${ws.id}`, name: `${ws.id} 履约点`,
        type: "store", capabilities: ["pickup", "return"], status: "enabled"
      }
    });
  }
}

/**
 * 最小合法订单行。金额与费用行由调用方指定，其余取满足非空约束的固定值。
 * 刻意不设任何车辆/门市字段——报表不该也不能依赖它们。
 */
function orderRow(tenantId, workspaceId, categoryCode, orderNo, overrides = {}) {
  const zero = dec(0);
  return {
    id: `o_${workspaceId}_${orderNo}`, tenantId, workspaceId, orderNo,
    categoryCode, status: "COMPLETED",
    customerType: "personal", customerName: "报表客户",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: `loc_${workspaceId}`, fulfillmentLocationName: `${workspaceId} 履约点`,
    startAt: new Date("2026-06-10T02:00:00.000Z"), endAt: new Date("2026-06-12T02:00:00.000Z"),
    quoteId: `q_${workspaceId}_${orderNo}`, quoteNo: `Q-${workspaceId}-${orderNo}`,
    pricingPlanVersion: "v1", ruleVersion: "v1", ruleSnapshot: {}, chargeLines: [],
    rentalAmount: zero, discountAmount: zero, couponAmount: zero, serviceAmount: zero,
    fulfillmentAmount: zero, depositAmount: zero, preAuthAmount: zero, payableAmount: zero,
    adjustmentAmount: zero, finalPayableAmount: zero, totalAmount: zero,
    createdBy: "tester",
    ...overrides
  };
}

/**
 * 一套固定的订单样本。四个空间灌同一套，因此指标必须逐字段相等——
 * 这是「公式不随品类变化」最直接的证明方式。
 */
function sampleOrders(tenantId, workspaceId, categoryCode) {
  return [
    // 正常完成单：租金 1000，方案优惠 100，券 50，应收 900。
    orderRow(tenantId, workspaceId, categoryCode, "N1", {
      rentalAmount: dec(1000), discountAmount: dec(100), couponAmount: dec(50), finalPayableAmount: dec(900)
    }),
    // 在租单：租金 500，无优惠，应收 500。
    orderRow(tenantId, workspaceId, categoryCode, "N2", {
      status: "RENTING", rentalAmount: dec(500), finalPayableAmount: dec(500)
    }),
    // 同时逾期与损坏：异常费用 80+120=200，但只算 **一张** 异常订单。
    orderRow(tenantId, workspaceId, categoryCode, "E1", {
      rentalAmount: dec(300), finalPayableAmount: dec(500),
      chargeLines: [
        { code: "overdue", name: "逾期费", type: "overdue", amount: 80 },
        { code: "damage", name: "损坏费", type: "damage", amount: 120 },
        { code: "deposit", name: "押金", type: "deposit", amount: 1000 }
      ]
    }),
    // 取消单并收取消费 60。
    orderRow(tenantId, workspaceId, categoryCode, "E2", {
      status: "CANCELLED", rentalAmount: dec(0), finalPayableAmount: dec(60),
      chargeLines: [{ code: "cancellation", name: "取消费", type: "cancellation", amount: 60 }]
    }),
    // 草稿：不得进任何指标。金额刻意给大值，混进来会立刻被发现。
    orderRow(tenantId, workspaceId, categoryCode, "D1", {
      status: "DRAFT", rentalAmount: dec(99999), discountAmount: dec(99999), finalPayableAmount: dec(99999),
      chargeLines: [{ code: "overdue", name: "逾期费", type: "overdue", amount: 99999 }]
    })
  ];
}

/** 样本对应的期望值。写成常量而不是从样本反算——反算会把公式错误一起复制过去。 */
const EXPECTED = {
  orderCount: 4,
  rentalRevenue: 1800,
  discountTotal: 150,
  receivableTotal: 1960,
  exceptionFeeTotal: 260,
  exceptionOrderCount: 2
};

void withCleanup(async () => {
  await cleanup();
  await seed();

  for (const ws of WORKSPACES) {
    if (ws.id === wsEmpty) continue;
    for (const row of sampleOrders(ws.tenantId(), ws.id, ws.category)) {
      await prisma.rentalOrder.create({ data: row });
    }
  }

  // ============ 1. 四个品类共用同一套公式 ============
  const byWorkspace = new Map();
  for (const ws of WORKSPACES) {
    byWorkspace.set(ws.id, await reports.getOperationReport(ws.tenantId(), ws.id, ws.category));
  }
  for (const ws of WORKSPACES) {
    if (ws.id === wsEmpty) continue;
    const report = byWorkspace.get(ws.id);
    for (const [field, expected] of Object.entries(EXPECTED)) {
      assert.equal(
        report[field],
        expected,
        `${ws.category} 空间的 ${field} 应为 ${expected}，实际 ${report[field]}——公式不得随品类变化`
      );
    }
  }
  // 逐字段相等已经证明公式一致；这里再断言「不是巧合地都为 0」。
  assert.ok(EXPECTED.rentalRevenue > 0 && EXPECTED.exceptionFeeTotal > 0, "样本必须包含非零金额，否则一致性没有意义");
  ok("四品类（摄影/车辆/露营/工程）：订单量、收入、优惠、应收、异常费用与异常订单公式完全一致");

  // ============ 2. 公式细节：草稿不计、异常订单去重、优惠为两项之和 ============
  const cameraReport = byWorkspace.get(wsA1);
  assert.equal(cameraReport.orderCount, 4, "草稿不得计入订单量（样本共 5 单，其中 1 张草稿）");
  assert.equal(cameraReport.rentalRevenue, 1800, "租赁收入只累加非草稿订单的 rentalAmount");
  assert.equal(cameraReport.discountTotal, 150, "优惠金额必须是方案优惠 100 与券优惠 50 之和");
  assert.equal(cameraReport.receivableTotal, 1960, "应收金额取调账后的 finalPayableAmount 之和");
  assert.equal(cameraReport.exceptionFeeTotal, 260, "异常费用只取逾期/损坏/取消三类费用行，押金不计");
  assert.equal(cameraReport.exceptionOrderCount, 2, "同时逾期与损坏的订单只算一张异常订单");
  const breakdown = Object.fromEntries(cameraReport.exceptionFeeBreakdown.map((row) => [row.type, row]));
  assert.deepEqual(
    { overdue: breakdown.overdue.amount, damage: breakdown.damage.amount, cancellation: breakdown.cancellation.amount },
    { overdue: 80, damage: 120, cancellation: 60 },
    "异常费用按类型拆分必须与费用行一致"
  );
  assert.equal(breakdown.overdue.orderCount, 1, "逾期涉及订单数");
  assert.equal(
    breakdown.overdue.orderCount + breakdown.damage.orderCount + breakdown.cancellation.orderCount,
    3,
    "各类型涉及订单之和为 3，而去重后的异常订单为 2——两者不同是设计"
  );
  const statuses = Object.fromEntries(cameraReport.statusBreakdown.map((row) => [row.status, row.count]));
  assert.deepEqual(statuses, { cancelled: 1, completed: 2, renting: 1 }, "状态拆分必须用共享契约的小写值且不含草稿");
  ok("公式细节：草稿不计、押金不算异常、异常订单去重、状态拆分用共享契约取值");

  // ============ 3. 隔离：另一空间与另一租户的订单都不得进来 ============
  // 三个非空空间灌的是同一套样本；若隔离失效，数字会变成 2 倍或 3 倍。
  assert.equal(cameraReport.orderCount, EXPECTED.orderCount, "同租户另一空间的订单不得计入本空间");
  assert.equal(byWorkspace.get(wsB1).orderCount, EXPECTED.orderCount, "另一租户的空间只看到自己的订单");
  // 交叉参数：用 A 租户去查 B 租户的空间，必须查不到任何东西。
  const crossTenant = await reports.getOperationReport(tenantA, wsB1, "CONSTRUCTION");
  assert.equal(crossTenant.orderCount, 0, "tenantId 与 workspaceId 必须同时生效：跨租户查空间应为空");
  assert.equal(crossTenant.rentalRevenue, 0);
  assert.equal(crossTenant.receivableTotal, 0);
  const crossWorkspace = await reports.getOperationReport(tenantB, wsA1, "CAMERA");
  assert.equal(crossWorkspace.orderCount, 0, "另一租户不得读到 A 租户空间的订单");
  ok("隔离：tenantId 与 workspaceId 同时生效，跨空间与跨租户都读不到对方订单");

  // ============ 4. 空空间返回零值，而不是回退到租户汇总 ============
  const empty = byWorkspace.get(wsEmpty);
  assert.deepEqual(
    {
      orderCount: empty.orderCount,
      rentalRevenue: empty.rentalRevenue,
      discountTotal: empty.discountTotal,
      receivableTotal: empty.receivableTotal,
      exceptionFeeTotal: empty.exceptionFeeTotal,
      exceptionOrderCount: empty.exceptionOrderCount
    },
    { orderCount: 0, rentalRevenue: 0, discountTotal: 0, receivableTotal: 0, exceptionFeeTotal: 0, exceptionOrderCount: 0 },
    "空空间必须全零——回退到租户汇总会让新空间一开就显示别人的经营数据"
  );
  assert.deepEqual(empty.statusBreakdown, [], "空空间没有状态拆分");
  assert.equal(empty.exceptionFeeBreakdown.length, 3, "异常费用拆分保持三类结构，金额为 0，便于页面稳定渲染");
  assert.ok(empty.exceptionFeeBreakdown.every((row) => row.amount === 0 && row.orderCount === 0));
  ok("空空间：六项指标全零、状态拆分为空、异常拆分结构稳定");

  // ============ 5. 区间按起租时间过滤 ============
  const inRange = await reports.getOperationReport(tenantA, wsA1, "CAMERA", {
    from: "2026-06-01T00:00:00.000Z",
    to: "2026-06-30T00:00:00.000Z"
  });
  assert.equal(inRange.orderCount, EXPECTED.orderCount, "区间覆盖样本时应与不限区间一致");
  const outOfRange = await reports.getOperationReport(tenantA, wsA1, "CAMERA", {
    from: "2026-07-01T00:00:00.000Z",
    to: "2026-07-31T00:00:00.000Z"
  });
  assert.equal(outOfRange.orderCount, 0, "区间之外应为零，而不是忽略区间");
  assert.equal(outOfRange.rentalRevenue, 0);
  assert.deepEqual(outOfRange.range, { from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T00:00:00.000Z" }, "出参必须回显区间");
  await assert.rejects(
    reports.getOperationReport(tenantA, wsA1, "CAMERA", { from: "not-a-date" }),
    /统计开始时间不是有效日期时间/,
    "非法日期必须明确返回业务错误，不能落成 Prisma 500"
  );
  await assert.rejects(
    reports.getOperationReport(tenantA, wsA1, "CAMERA", {
      from: "2026-07-02T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z"
    }),
    /统计开始时间不能晚于结束时间/,
    "倒置区间必须明确拒绝"
  );
  ok("区间：按起租时间过滤，区间外为零并回显所用区间");

  // ============ 6. 口径纯度：不得出现车辆/门市/旧 Store Rental 专用字段 ============
  const serialized = JSON.stringify(cameraReport);
  for (const legacy of [
    "plateNo", "vehicleGroup", "vehicleId", "storeName", "storeId",
    "billingMode", "utilizationPercent", "rentableVehicles", "rentingVehicles"
  ]) {
    assert.equal(serialized.includes(legacy), false, `出参不得包含车辆/门市专用字段 ${legacy}`);
  }
  const repoSource = fs.readFileSync(
    path.join(ROOT, "apps/api/src/modules/rental-core/rental-workspace-report.repository.ts"),
    "utf8"
  );
  for (const legacy of ["storeRental", "store_rental_orders", "vehicle", "plateNo", "billingMode"]) {
    assert.equal(
      new RegExp(legacy, "iu").test(repoSource.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "")),
      false,
      `仓储不得读取旧 Store Rental / 车辆专用口径：命中 ${legacy}`
    );
  }
  assert.match(repoSource, /prisma\.rentalOrder\./u, "只读 Rental Core 规范化事实 rental_orders");
  // 分页读取：断言到「有界常量 + take 用它」，而不是字面量 500。
  // 只钉字面量的话，改成 take: 100000 也能通过；这里同时要求常量本身是有界小值。
  const pageSizeMatch = repoSource.match(/const SCAN_PAGE_SIZE = (\d+);/u);
  assert.ok(pageSizeMatch, "必须用具名常量声明分页大小");
  assert.ok(Number(pageSizeMatch[1]) > 0 && Number(pageSizeMatch[1]) <= 2000,
    `分页大小必须是有界小值，实际 ${pageSizeMatch[1]}`);
  assert.match(repoSource, /take: SCAN_PAGE_SIZE/u, "异常费用 JSON 必须分批读取，不能无界载入全部历史订单");
  // 维度汇总必须交给数据库聚合，不能把订单全捞回来在内存里分组。
  assert.match(repoSource, /groupBy\(\{\s*\n?\s*by: \["fulfillmentLocationId", "fulfillmentLocationName"\]/u,
    "地点维度必须由数据库 groupBy 聚合");
  assert.match(repoSource, /groupBy\(\{\s*\n?\s*by: \["customerId", "customerName", "customerType"\]/u,
    "客户维度必须由数据库 groupBy 聚合");
  // 每一处查询都必须同时带 tenantId 与 workspaceId：少一个就会把别的空间算进来。
  assert.match(repoSource, /tenantId,\s*\n\s*workspaceId,/u, "查询条件必须同时包含 tenantId 与 workspaceId");
  ok("口径纯度：只读 rental_orders，出参与实现均无车辆/门市/旧 Store Rental 字段");

  // ============ 7. 页面：标题用品类术语，指标标签固定 ============
  // 指标标签跟着品类变会让同一个数字在两个空间被读成两种含义。
  const page = fs.readFileSync(
    path.join(ROOT, "apps/admin/src/features/reports/WorkspaceOperationReportPage.tsx"),
    "utf8"
  );
  assert.match(page, /terminology\.itemLabel/u, "页面描述可以使用当前品类术语");
  for (const label of ["订单量", "租赁收入", "优惠金额", "应收金额", "异常费用", "异常订单"]) {
    assert.ok(page.includes(`"${label}"`), `指标标签必须是固定文案：${label}`);
  }
  assert.equal(
    /label: `?\$\{[^}]*terminology/u.test(page),
    false,
    "指标标签不得由品类术语拼出——指标定义不随品类变化"
  );
  for (const legacy of ["plateNo", "vehicleGroupName", "currentStoreName", "utilizationPercent"]) {
    assert.equal(page.includes(legacy), false, `页面不得展示车辆/门市专用字段 ${legacy}`);
  }
  const api = fs.readFileSync(path.join(ROOT, "apps/admin/src/api/rentalCore.ts"), "utf8");
  const apiCode = api.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  assert.match(apiCode, /operationReport:/u, "管理端必须有报表读取方法");
  assert.equal(
    /operationReport:[\s\S]{0,200}workspaceId/u.test(apiCode),
    false,
    "页面不得传入 workspaceId——空间一律由服务端按会话解析"
  );
  ok("页面契约：标题用品类术语、指标标签固定、无车辆字段、空间不由页面传入");

  // ============ 8. 断连重连后仍是同一份事实 ============
  await prisma.$disconnect();
  prisma = new PrismaClient();
  reports = new RentalWorkspaceReportRepository(prisma);
  const reloaded = await reports.getOperationReport(tenantA, wsA1, "CAMERA");
  assert.equal(reloaded.orderCount, EXPECTED.orderCount, "重连后订单量不变");
  assert.equal(reloaded.receivableTotal, EXPECTED.receivableTotal, "重连后应收金额不变");
  ok("持久化：断连重连后报表仍由库中事实算出，不依赖进程内状态");

  // 清理与断连由 withCleanup 的 finally 负责：写在这里的话，
  // 任何一条断言抛出都会跳过它，夹具就留在专用库里了。
  console.log("\nREPORT-01A 经营空间报表专项：全部通过");
});
