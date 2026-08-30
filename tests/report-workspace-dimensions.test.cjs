const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * REPORT-01B 专项：库存/资产口径、地点与客户维度、筛选与导出。
 *
 * 断言集中在四处，每一处都是「错了就会给出一份看似合理、实则错误的报表」的地方：
 *   1. **快照口径**：分子、分母、时点必须与契约一致；停用资产不进分母；
 *      区间筛选**不得**影响快照（否则快照会被读成区间利用率）。
 *   2. **维度可对账**：地点/客户逐行相加必须等于总量，否则运营对不上账。
 *   3. **隔离与筛选**：资产、库存、维度都必须同时受 tenantId + workspaceId 约束。
 *   4. **导出同源**：CSV 与页面同一份数据、同一组筛选，且不含手机号/证件号。
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
const {
  renderOperationReportCsv
} = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-workspace-report.csv"));

const suffix = Date.now().toString(36);
const tenantA = `t_rpb_a_${suffix}`;
const tenantB = `t_rpb_b_${suffix}`;
const wsA1 = `ws_rpb_a1_${suffix}`;
const wsA2 = `ws_rpb_a2_${suffix}`;
const wsEmpty = `ws_rpb_empty_${suffix}`;
const wsB1 = `ws_rpb_b1_${suffix}`;
const loc1 = `loc_rpb_1_${suffix}`;
const loc2 = `loc_rpb_2_${suffix}`;

let prisma = new PrismaClient();
let reports = new RentalWorkspaceReportRepository(prisma);
const ok = (m) => console.log(`  ✓ ${m}`);
const dec = (v) => new Prisma.Decimal(v);
async function cleanup() {
  const scope = { tenantId: { in: [tenantA, tenantB] } };
  // 顺序按外键来：资产与库存都引用履约地点，而地点随租户级联删除。
  // 先删租户会撞 `Foreign key constraint violated: locationId`——
  // 级联删得掉地点，但删不掉仍指向它的资产行。
  await prisma.rentalAsset.deleteMany({ where: scope });
  await prisma.rentalStockBalance.deleteMany({ where: scope });
  await prisma.rentalOrder.deleteMany({ where: scope });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
}

/** 断言失败时也必须清夹具，否则专项自己往专用库里堆垃圾。 */
async function withCleanup(run) {
  try {
    await run();
  } finally {
    try {
      await cleanup();
    } catch (error) {
      console.error(`（清理夹具失败，请手工删除 ${tenantA} / ${tenantB}）：${error?.message ?? error}`);
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

const WORKSPACES = [
  { id: wsA1, tenantId: () => tenantA, category: "CAMERA", isDefault: true },
  { id: wsA2, tenantId: () => tenantA, category: "VEHICLE", isDefault: false },
  { id: wsEmpty, tenantId: () => tenantA, category: "CAMPING", isDefault: false },
  { id: wsB1, tenantId: () => tenantB, category: "CONSTRUCTION", isDefault: true }
];

async function seed() {
  for (const [id, code] of [[tenantA, `rpb-a-${suffix}`], [tenantB, `rpb-b-${suffix}`]]) {
    await prisma.tenant.create({ data: { id, code, name: `REPORT-01B 测试租户 ${code}` } });
  }
  for (const ws of WORKSPACES) {
    await prisma.businessWorkspace.create({
      data: {
        id: ws.id, tenantId: ws.tenantId(), code: ws.id, name: ws.id,
        categoryCode: ws.category, isDefault: ws.isDefault,
        defaultMarker: ws.isDefault ? "default" : ws.id
      }
    });
    await prisma.rentalItemGroup.create({
      data: {
        id: `grp_${ws.id}`, tenantId: ws.tenantId(), workspaceId: ws.id,
        categoryCode: ws.category, code: `G-${ws.id}`, name: `${ws.id} 型号`,
        inventoryMode: "SERIALIZED", attributes: {}
      }
    });
  }
  // A1 空间有两个履约地点：地点维度必须能把它们分开，且相加等于总量。
  for (const [id, name, ws] of [[loc1, "一号点", wsA1], [loc2, "二号点", wsA1]]) {
    await prisma.rentalFulfillmentLocation.create({
      data: {
        id, tenantId: tenantA, workspaceId: ws, code: `L-${id}`, name,
        type: "store", capabilities: ["pickup", "return"], status: "enabled"
      }
    });
  }
  for (const ws of [wsA2, wsEmpty, wsB1]) {
    await prisma.rentalFulfillmentLocation.create({
      data: {
        id: `loc_${ws}`, tenantId: ws === wsB1 ? tenantB : tenantA, workspaceId: ws,
        code: `L-${ws}`, name: `${ws} 履约点`,
        type: "store", capabilities: ["pickup", "return"], status: "enabled"
      }
    });
  }
}
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

/** 资产夹具：六种状态各一，用来验证分母排除停用、分子只数在租。 */
async function seedAssets() {
  const states = ["AVAILABLE", "AVAILABLE", "RENTED", "RENTED", "MAINTENANCE", "DISABLED"];
  let index = 0;
  for (const status of states) {
    index += 1;
    await prisma.rentalAsset.create({
      data: {
        id: `as_${wsA1}_${index}`, tenantId: tenantA, workspaceId: wsA1,
        itemGroupId: `grp_${wsA1}`, assetNo: `A-${index}`, serialNo: `SN-${wsA1}-${index}`,
        // 一半资产挂一号点、一半挂二号点：用来验证地点筛选也作用于快照。
        locationId: index <= 3 ? loc1 : loc2,
        status, attributes: {}
      }
    });
  }
  // 另一个空间与另一个租户各放一个在租资产：隔离若失效，分子会变大。
  await prisma.rentalAsset.create({
    data: {
      id: `as_${wsA2}_1`, tenantId: tenantA, workspaceId: wsA2, itemGroupId: `grp_${wsA2}`,
      assetNo: "A-OTHER-WS", serialNo: `SN-${wsA2}-1`, locationId: `loc_${wsA2}`,
      status: "RENTED", attributes: {}
    }
  });
  await prisma.rentalAsset.create({
    data: {
      id: `as_${wsB1}_1`, tenantId: tenantB, workspaceId: wsB1, itemGroupId: `grp_${wsB1}`,
      assetNo: "A-OTHER-TENANT", serialNo: `SN-${wsB1}-1`, locationId: `loc_${wsB1}`,
      status: "RENTED", attributes: {}
    }
  });
}

/** 数量库存夹具：两个地点各一行，含维修占用。 */
async function seedStock() {
  await prisma.rentalStockBalance.create({
    data: {
      id: `st_${wsA1}_1`, tenantId: tenantA, workspaceId: wsA1, itemGroupId: `grp_${wsA1}`,
      locationId: loc1, onHandQuantity: 100, reservedQuantity: 30, maintenanceQuantity: 10
    }
  });
  await prisma.rentalStockBalance.create({
    data: {
      id: `st_${wsA1}_2`, tenantId: tenantA, workspaceId: wsA1, itemGroupId: `grp_${wsA1}`,
      locationId: loc2, onHandQuantity: 60, reservedQuantity: 20, maintenanceQuantity: 0
    }
  });
  await prisma.rentalStockBalance.create({
    data: {
      id: `st_${wsA2}_1`, tenantId: tenantA, workspaceId: wsA2, itemGroupId: `grp_${wsA2}`,
      locationId: `loc_${wsA2}`, onHandQuantity: 999, reservedQuantity: 999, maintenanceQuantity: 0
    }
  });
}
void withCleanup(async () => {
  await cleanup();
  await seed();
  await seedAssets();
  await seedStock();

  // A1 空间：两个地点、两个客户、含异常费用与一次地点改名。
  const rows = [
    // 一号点 / 张三：租金 1000，优惠 100+50，应收 900，租期 48 小时。
    orderRow(tenantA, wsA1, "CAMERA", "N1", {
      fulfillmentLocationId: loc1, fulfillmentLocationName: "一号点",
      customerId: "cus_zhang", customerName: "张三",
      rentalAmount: dec(1000), discountAmount: dec(100), couponAmount: dec(50), finalPayableAmount: dec(900)
    }),
    // 一号点改名后的两张单：同一个地点 id，快照名不同 → 必须合并成一行，
    // 且显示名取订单数**多**的那个（这里改名后有 2 单，原名 1 单）。
    orderRow(tenantA, wsA1, "CAMERA", "N2", {
      fulfillmentLocationId: loc1, fulfillmentLocationName: "一号点（改名）",
      customerId: "cus_zhang", customerName: "张三",
      rentalAmount: dec(200), finalPayableAmount: dec(200)
    }),
    orderRow(tenantA, wsA1, "CAMERA", "N4", {
      fulfillmentLocationId: loc1, fulfillmentLocationName: "一号点（改名）",
      customerId: "cus_zhang", customerName: "张三",
      rentalAmount: dec(100), finalPayableAmount: dec(100)
    }),
    // 二号点 / 企业客户：带逾期与损坏，异常费用 200，且同时只算一张异常单。
    orderRow(tenantA, wsA1, "CAMERA", "E1", {
      fulfillmentLocationId: loc2, fulfillmentLocationName: "二号点",
      customerId: "cus_corp", customerName: "海纳影视", customerType: "corporate",
      rentalAmount: dec(300), finalPayableAmount: dec(500),
      startAt: new Date("2026-06-20T00:00:00.000Z"), endAt: new Date("2026-06-21T00:00:00.000Z"),
      chargeLines: [
        { code: "overdue", name: "逾期费", type: "overdue", amount: 80 },
        { code: "damage", name: "损坏费", type: "damage", amount: 120 },
        { code: "deposit", name: "押金", type: "deposit", amount: 1000 }
      ]
    }),
    // 无客户主档 id 的存量订单：必须按客户名归并，不能与有 id 的合到一起。
    orderRow(tenantA, wsA1, "CAMERA", "N3", {
      fulfillmentLocationId: loc2, fulfillmentLocationName: "二号点",
      customerId: null, customerName: "散客",
      rentalAmount: dec(50), finalPayableAmount: dec(50)
    }),
    // 草稿：不得进入任何维度。
    orderRow(tenantA, wsA1, "CAMERA", "D1", {
      status: "DRAFT", fulfillmentLocationId: loc1, fulfillmentLocationName: "一号点",
      customerId: "cus_zhang", customerName: "张三",
      rentalAmount: dec(99999), finalPayableAmount: dec(99999)
    })
  ];
  for (const row of rows) await prisma.rentalOrder.create({ data: row });
  // 别的空间/租户各一张单：维度汇总若漏隔离条件就会多出行。
  await prisma.rentalOrder.create({ data: orderRow(tenantA, wsA2, "VEHICLE", "X1", { rentalAmount: dec(777), finalPayableAmount: dec(777) }) });
  await prisma.rentalOrder.create({ data: orderRow(tenantB, wsB1, "CONSTRUCTION", "Y1", { rentalAmount: dec(888), finalPayableAmount: dec(888) }) });

  const report = await reports.getOperationReport(tenantA, wsA1, "CAMERA");
  // ============ 1. 序列化资产：分子、分母、时点 ============
  const assets = report.utilization.serializedAssets;
  assert.equal(assets.totalCount, 6, "在册资产数应含停用");
  // 分母排除停用：6 - 1 = 5。把报废资产算进分母会让利用率随报废越攒越低。
  assert.equal(assets.operableCount, 5, "可运营资产数必须排除 disabled");
  assert.equal(assets.rentedCount, 2, "在租资产数只数 rented");
  assert.equal(assets.rentedRatio, 0.4, "在租占比 = 2/5");
  assert.ok(assets.snapshotAt, "必须给出快照时点");
  assert.deepEqual(
    assets.statusBreakdown,
    [
      { status: "available", count: 2 },
      { status: "disabled", count: 1 },
      { status: "maintenance", count: 1 },
      { status: "rented", count: 2 }
    ],
    "资产状态拆分必须如实且按状态排序"
  );
  ok("序列化资产：分母排除停用、分子只数在租、给出快照时点与状态拆分");

  // ============ 2. 数量库存：分子、分母、可租余量 ============
  const stock = report.utilization.quantityStock;
  assert.equal(stock.onHandTotal, 160, "在库总量 = 100 + 60");
  assert.equal(stock.reservedTotal, 50, "已占用 = 30 + 20");
  assert.equal(stock.maintenanceTotal, 10, "维修占用单列，不计入已出租");
  assert.equal(stock.availableTotal, 100, "可租余量 = 160 - 50 - 10");
  assert.equal(stock.reservedRatio, 0.3125, "占用比 = 50/160");
  ok("数量库存：在库/已占用/维修/可租余量与占用比口径正确");

  // ============ 3. 区间订单占用：只有分子，没有比率 ============
  const occupancy = report.utilization.orderOccupancy;
  // 48×4 + 24 = 216 小时（草稿不计）。
  assert.equal(occupancy.orderCount, 5, "占用口径与订单量同源（非草稿）");
  assert.equal(occupancy.totalHours, 216, "占用时长为各订单租期之和");
  assert.equal(occupancy.averageHours, 43.2, "平均租期 = 216/5");
  assert.equal("ratio" in occupancy, false, "不得给出利用率比率——分母需要历史可出租时长，库里没有");
  ok("区间订单占用：给出时长与平均租期，刻意不产出比率");

  // ============ 4. 历史口径缺口必须随出参交付 ============
  assert.ok(report.historicalCaliberGaps.length >= 3, "必须逐条登记历史口径缺口");
  assert.ok(
    report.historicalCaliberGaps.some((gap) => gap.includes("没有状态变更历史")),
    "必须说明资产缺少状态变更历史"
  );
  assert.ok(
    report.historicalCaliberGaps.some((gap) => gap.includes("伪造")),
    "必须显式声明不用当前状态伪造历史利用率"
  );
  ok("历史口径缺口：随出参交付，说明快照原因且声明不伪造历史");
  // ============ 5. 地点维度：可与总量对账，改名合并成一行 ============
  const locations = report.locationBreakdown;
  assert.equal(locations.length, 2, `A1 空间只有两个地点，实际 ${locations.length} 行——改名不应产生第三行`);
  const one = locations.find((row) => row.locationId === loc1);
  const two = locations.find((row) => row.locationId === loc2);
  assert.equal(one.orderCount, 3, "一号点三张非草稿单");
  // 改名后有 2 单、原名 1 单：显示名必须取订单数多的那个，而不是按名称排序取第一个。
  assert.equal(one.locationName, "一号点（改名）", "改名后取订单数最多的那个名称");
  assert.equal(one.rentalRevenue, 1300, "一号点租金 1000 + 200 + 100");
  assert.equal(one.discountTotal, 150, "一号点优惠 100 + 50");
  assert.equal(one.exceptionFeeTotal, 0, "一号点没有异常费用");
  assert.equal(two.orderCount, 2, "二号点两张单");
  assert.equal(two.exceptionFeeTotal, 200, "二号点异常费用 80 + 120");
  // 逐行相加必须等于总量：这就是「可与订单明细对账」的可执行定义。
  const sum = (rows, key) => Math.round(rows.reduce((total, row) => total + row[key], 0) * 100) / 100;
  assert.equal(sum(locations, "orderCount"), report.orderCount, "地点逐行订单量相加必须等于总订单量");
  assert.equal(sum(locations, "rentalRevenue"), report.rentalRevenue, "地点逐行租金相加必须等于总租金");
  assert.equal(sum(locations, "discountTotal"), report.discountTotal, "地点逐行优惠相加必须等于总优惠");
  assert.equal(sum(locations, "receivableTotal"), report.receivableTotal, "地点逐行应收相加必须等于总应收");
  assert.equal(sum(locations, "exceptionFeeTotal"), report.exceptionFeeTotal, "地点逐行异常费用相加必须等于总异常费用");
  ok("地点维度：改名合并成一行，逐行相加与总量一致，可对账");

  // ============ 6. 客户维度：无主档 id 按名字归并，可对账 ============
  const customers = report.customerBreakdown;
  assert.equal(customers.length, 3, `应有张三、海纳影视、散客三行，实际 ${customers.length}`);
  const zhang = customers.find((row) => row.customerId === "cus_zhang");
  const corp = customers.find((row) => row.customerId === "cus_corp");
  const walkIn = customers.find((row) => row.customerId === undefined);
  assert.equal(zhang.orderCount, 3, "张三三张非草稿单（草稿不计）");
  assert.equal(zhang.rentalRevenue, 1300);
  assert.equal(corp.customerType, "corporate", "企业客户类型必须如实带出");
  assert.equal(corp.exceptionFeeTotal, 200, "异常费用必须归到对应客户");
  assert.equal(walkIn.customerName, "散客", "无主档 id 的订单按客户名归并");
  assert.equal(sum(customers, "orderCount"), report.orderCount, "客户逐行订单量相加必须等于总订单量");
  assert.equal(sum(customers, "receivableTotal"), report.receivableTotal, "客户逐行应收相加必须等于总应收");
  assert.equal(sum(customers, "exceptionFeeTotal"), report.exceptionFeeTotal, "客户逐行异常费用相加必须等于总异常费用");
  // 客户维度不得成为客户资料的第二个出口。
  const customerJson = JSON.stringify(customers);
  for (const leak of ["contactPhone", "phone", "identityNo", "idCard"]) {
    assert.equal(customerJson.includes(leak), false, `客户维度不得出现 ${leak}`);
  }
  ok("客户维度：无主档 id 按名归并、可对账、不外传手机号与证件号");
  // ============ 7. 筛选：地点 / 客户 / 客户类型各自生效 ============
  const byLocation = await reports.getOperationReport(tenantA, wsA1, "CAMERA", { locationId: loc2 });
  assert.equal(byLocation.orderCount, 2, "地点筛选后只剩二号点的两张单");
  assert.equal(byLocation.locationBreakdown.length, 1, "地点筛选后维度只剩一行");
  assert.equal(byLocation.exceptionFeeTotal, 200, "异常费用随筛选一起收窄");
  // 地点筛选也作用于快照：二号点只有 3 个资产（含 1 停用）与 1 行库存。
  assert.equal(byLocation.utilization.serializedAssets.totalCount, 3, "地点筛选必须同时收窄资产快照");
  assert.equal(byLocation.utilization.quantityStock.onHandTotal, 60, "地点筛选必须同时收窄库存快照");
  assert.deepEqual(byLocation.filter.locationId, loc2, "出参必须回显实际生效的筛选");

  const byCustomer = await reports.getOperationReport(tenantA, wsA1, "CAMERA", { customerId: "cus_corp" });
  assert.equal(byCustomer.orderCount, 1, "客户筛选后只剩企业客户那一单");
  assert.equal(byCustomer.customerBreakdown.length, 1);
  // 客户与资产之间没有归属关系，因此客户筛选**不得**改变资产快照。
  assert.equal(byCustomer.utilization.serializedAssets.totalCount, 6, "客户筛选不应影响资产快照");

  const byType = await reports.getOperationReport(tenantA, wsA1, "CAMERA", { customerType: "corporate" });
  assert.equal(byType.orderCount, 1, "客户类型筛选生效");
  assert.equal(byType.customerBreakdown[0].customerType, "corporate");
  await assert.rejects(
    () => reports.getOperationReport(tenantA, wsA1, "CAMERA", { customerType: "unknown" }),
    /客户类型只能是/u,
    "非法客户类型必须明确失败，而不是静默忽略"
  );

  // 区间筛选**不得**影响快照：快照是读取瞬间的事实，与统计区间无关。
  const outOfRange = await reports.getOperationReport(tenantA, wsA1, "CAMERA", {
    from: "2026-01-01T00:00:00.000Z", to: "2026-01-31T00:00:00.000Z"
  });
  assert.equal(outOfRange.orderCount, 0, "区间外没有订单");
  assert.equal(outOfRange.locationBreakdown.length, 0, "区间外维度为空");
  assert.equal(outOfRange.utilization.orderOccupancy.totalHours, 0, "区间外占用时长为 0");
  assert.equal(outOfRange.utilization.serializedAssets.totalCount, 6, "区间筛选不得影响资产快照");
  assert.equal(outOfRange.utilization.quantityStock.onHandTotal, 160, "区间筛选不得影响库存快照");
  // 再用一个**未来**区间：夹具都是刚建的，若实现把区间条件泄进快照查询
  // （例如按 updatedAt 过滤），上面那条用历史区间的断言仍会通过，这条才会红。
  const futureRange = await reports.getOperationReport(tenantA, wsA1, "CAMERA", {
    from: "2030-01-01T00:00:00.000Z"
  });
  assert.equal(futureRange.orderCount, 0, "未来区间没有订单");
  assert.equal(futureRange.utilization.serializedAssets.totalCount, 6, "未来区间同样不得影响资产快照");
  assert.equal(futureRange.utilization.quantityStock.onHandTotal, 160, "未来区间同样不得影响库存快照");
  ok("筛选：地点/客户/客户类型分别生效，地点收窄快照、区间与客户不影响快照，非法值失败");

  // ============ 8. 隔离：别的空间与租户的资产、库存、维度都读不到 ============
  assert.equal(report.orderCount, 5, "本空间只算本空间订单");
  assert.equal(
    report.locationBreakdown.some((row) => row.locationId.includes(wsA2) || row.locationId.includes(wsB1)),
    false,
    "维度里不得出现别的空间的地点"
  );
  const empty = await reports.getOperationReport(tenantA, wsEmpty, "CAMPING");
  assert.equal(empty.orderCount, 0, "空空间订单量为零");
  assert.deepEqual(empty.locationBreakdown, [], "空空间地点维度为空数组");
  assert.deepEqual(empty.customerBreakdown, [], "空空间客户维度为空数组");
  assert.equal(empty.utilization.serializedAssets.totalCount, 0, "空空间没有资产");
  assert.equal(empty.utilization.serializedAssets.rentedRatio, 0, "分母为 0 时比率必须是 0，不能是 NaN");
  assert.equal(empty.utilization.quantityStock.onHandTotal, 0, "空空间没有库存");
  assert.equal(empty.utilization.quantityStock.reservedRatio, 0, "分母为 0 时占用比必须是 0");
  assert.equal(empty.utilization.orderOccupancy.averageHours, 0, "无订单时平均租期为 0");
  assert.ok(empty.historicalCaliberGaps.length >= 3, "空空间同样要交付口径缺口说明");
  ok("隔离与空空间：跨空间跨租户读不到，空空间全零且比率不返回 NaN");
  // ============ 9. 导出：与页面同一份数据、同一组筛选，且不泄露客户资料 ============
  const csv = renderOperationReportCsv(report);
  assert.ok(csv.startsWith("﻿"), "必须带 UTF-8 BOM，否则 Excel 打开中文列名是乱码");
  // 关键数字必须与报表对象逐一对应——导出不得自己再查一遍库。
  assert.ok(csv.includes(`订单量,${report.orderCount}`), "概览订单量必须与页面一致");
  assert.ok(csv.includes(`租赁收入,${report.rentalRevenue}`), "租赁收入必须与页面一致");
  assert.ok(csv.includes(`应收金额,${report.receivableTotal}`), "应收金额必须与页面一致");
  assert.ok(csv.includes(`异常费用,${report.exceptionFeeTotal}`), "异常费用必须与页面一致");
  assert.ok(csv.includes(`在租资产数（分子）,${assets.rentedCount}`), "快照分子必须写进导出");
  assert.ok(csv.includes(`可运营资产数（分母）,${assets.operableCount}`), "快照分母必须写进导出");
  assert.ok(csv.includes("库存已占用（分子）,50"), "库存分子必须写进导出");
  assert.ok(csv.includes("库存在库总量（分母）,160"), "库存分母必须写进导出");
  assert.ok(csv.includes("一号点"), "地点维度必须进导出");
  assert.ok(csv.includes("海纳影视"), "客户维度必须进导出");
  // 历史口径缺口必须跟着文件走：导出件常常脱离页面单独流转。
  assert.ok(csv.includes("历史口径缺口"), "导出必须包含历史口径缺口说明");
  for (const gap of report.historicalCaliberGaps) {
    assert.ok(csv.includes(gap.slice(0, 12)), "每条口径缺口都要出现在导出里");
  }
  // 筛选必须写进文件：一份没有筛选说明的 CSV，过两天没人说得清它统计的是什么。
  const filtered = renderOperationReportCsv(byLocation);
  assert.ok(filtered.includes(`履约地点筛选,${loc2}`), "导出必须回显实际生效的地点筛选");
  assert.ok(filtered.includes("客户筛选,全部"), "未筛选项必须显式写成「全部」而不是留空");
  // 导出同样不是客户资料的第二个出口。
  for (const leak of ["contactPhone", "identityNo", "13800", "身份证"]) {
    assert.equal(csv.includes(leak), false, `导出不得包含 ${leak}`);
  }
  ok("导出：与页面同源、写明筛选与口径缺口、不外传客户资料");

  // ============ 10. CSV 注入与转义 ============
  // 客户名是用户数据，可能以 = 开头被 Excel 当公式执行。
  const injected = renderOperationReportCsv({
    ...report,
    customerBreakdown: [{
      customerId: "cus_x", customerName: '=1+1', customerType: "personal",
      orderCount: 1, rentalRevenue: 1, discountTotal: 0, receivableTotal: 1, exceptionFeeTotal: 0
    }, {
      customerId: "cus_y", customerName: '含"引号",与逗号', customerType: "personal",
      orderCount: 1, rentalRevenue: 1, discountTotal: 0, receivableTotal: 1, exceptionFeeTotal: 0
    }]
  });
  assert.ok(injected.includes("'=1+1"), "以 = 开头的字段必须前置单引号中和，避免被当公式执行");
  assert.ok(injected.includes('"含""引号"",与逗号"'), "含引号与逗号的字段必须按 CSV 规则转义");
  ok("CSV 安全：公式前缀被中和，引号与逗号按规则转义");

  // ============ 11. 页面与接口契约 ============
  const page = fs.readFileSync(
    path.join(ROOT, "apps/admin/src/features/reports/WorkspaceOperationReportPage.tsx"), "utf8"
  );
  assert.match(page, /exportOperationReport\(filter\)/u, "导出必须复用页面同一组筛选");
  assert.match(page, /这一节是读取瞬间的快照，不是区间利用率/u, "页面必须显著标注快照口径");
  assert.match(page, /historicalCaliberGaps\.map/u, "页面必须把历史口径缺口显示出来");
  assert.match(page, /可运营资产数（分母）/u, "页面必须标注分母");
  assert.match(page, /在租资产数（分子）/u, "页面必须标注分子");
  assert.match(page, /locationBreakdown/u, "页面必须展示地点维度");
  assert.match(page, /customerBreakdown/u, "页面必须展示客户维度");
  for (const legacy of ["plateNo", "vehicleGroupName", "currentStoreName", "utilizationPercent"]) {
    assert.equal(page.includes(legacy), false, `页面不得展示车辆/门市专用字段 ${legacy}`);
  }
  const api = fs.readFileSync(path.join(ROOT, "apps/admin/src/api/rentalCore.ts"), "utf8");
  const apiCode = api.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  assert.match(apiCode, /exportOperationReport:/u, "管理端必须有导出方法");
  assert.equal(
    /exportOperationReport:[\s\S]{0,200}workspaceId/u.test(apiCode),
    false,
    "导出同样不得由页面传入 workspaceId"
  );
  ok("页面与接口契约：导出复用筛选、标注分子分母与快照口径、空间不由页面传入");

  console.log("\nREPORT-01B 维度、利用率与导出专项：全部通过");
});
