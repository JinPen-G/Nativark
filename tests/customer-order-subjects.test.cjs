const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * CUSTOMER-01C 专项（订单侧）：四类主体在**订单行**上的存取契约。
 *
 * 本文件刻意只验证「列存在 + 读写映射 + 按角色反查 + 存量订单回落」，
 * 不去驱动报价→下单整条链路：本阶段的要求是「不重写订单状态机和定价链」，
 * 跑整条链路既超出范围，也会把定价与库存的失败混进主体断言里。
 *
 * 因此 `prepareOrder` 把已解析主体传给聚合的那一行，本套件**不覆盖**——
 * 它只在完整下单流程里被执行。这是已知边界，如实记录，不用假绿掩盖。
 */

const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const dbName = new URL(env.DATABASE_URL).pathname.slice(1);
if (!/claude/.test(dbName)) {
  console.error(`拒绝执行：CUSTOMER 专项测试只能跑在专用库上，当前指向 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = env.DATABASE_URL;

const { PrismaClient, Prisma } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const { RentalCoreFactRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core-fact.repository"));

const suffix = Date.now().toString(36);
const tenantId = `t_sub_${suffix}`;
const workspaceId = `ws_sub_${suffix}`;
const locationId = `loc_sub_${suffix}`;

let prisma = new PrismaClient();
let facts = new RentalCoreFactRepository(prisma);
const ok = (m) => console.log(`  ✓ ${m}`);

async function cleanup() {
  // 订单对履约地点的外键没有级联，删租户时会被它挡住，因此先删本测试建的订单。
  await prisma.rentalOrder.deleteMany({ where: { tenantId } });
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

async function seed() {
  await prisma.tenant.create({ data: { id: tenantId, code: `sub-${suffix}`, name: `01C 订单主体测试 ${suffix}` } });
  await prisma.businessWorkspace.create({
    // 设为该租户的**默认**空间：`findOrder` 在没有请求上下文时通过
    // `resolveScopeWorkspaceId` 取默认空间，非默认空间会被 fail-closed 拒绝。
    // 新租户只有一个空间时它本就该是默认空间，与真实租户初始化一致。
    data: { id: workspaceId, tenantId, code: workspaceId, name: "主体测试空间", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" }
  });
  await prisma.rentalFulfillmentLocation.create({
    data: {
      id: locationId, tenantId, workspaceId, code: `L-${suffix}`, name: "主体测试门店",
      type: "store", capabilities: ["pickup", "return"], status: "enabled", address: "测试地址"
    }
  });
  const mk = async (name, phone, type) =>
    (await prisma.customerProfile.create({
      data: { tenantId, customerType: type, name, phone, phoneMasked: phone.slice(0, 3) + "****" + phone.slice(-4), qualifications: {} }
    })).id;
  return {
    corp: await mk("签约公司", "13900001111", "corporate"),
    hq: await mk("付款总部", "13900002222", "corporate"),
    driver: await mk("使用司机", "13700001111", "personal")
  };
}

/** 构造一条最小但合法的订单行。只为验证主体列的存取，不参与任何金额判定。 */
function orderRow(id, orderNo, subjects) {
  const money = new Prisma.Decimal(0);
  return {
    id, tenantId, workspaceId, orderNo, categoryCode: "CAMERA", status: "RESERVED",
    customerType: "corporate", customerId: subjects?.orderCustomerId ?? null, customerName: "下单客户",
    fulfillmentMode: "store_pickup_return", fulfillmentLocationId: locationId, fulfillmentLocationName: "主体测试门店",
    startAt: new Date("2026-06-20T02:00:00.000Z"), endAt: new Date("2026-06-22T02:00:00.000Z"),
    quoteId: `q_${orderNo}`, quoteNo: `Q-${orderNo}`, pricingPlanVersion: "v1",
    ruleVersion: "v1", ruleSnapshot: {}, chargeLines: [],
    rentalAmount: money, discountAmount: money, couponAmount: money, serviceAmount: money,
    fulfillmentAmount: money, depositAmount: money, preAuthAmount: money, payableAmount: money,
    adjustmentAmount: money, finalPayableAmount: money, totalAmount: money,
    createdBy: "tester",
    ...(subjects?.columns ?? {})
  };
}

void (async () => {
  await cleanup();
  const { corp, hq, driver } = await seed();

  // ============ 1. 四类主体写入后可原样读回 ============
  const snapshot = [
    { role: "contract", customerId: corp, customerType: "corporate", name: "签约公司", corporateName: "签约公司", contractNo: "C-1" },
    { role: "payer", customerId: hq, customerType: "corporate", name: "付款总部", invoiceProfileId: "inv-1" },
    { role: "user", customerId: driver, customerType: "personal", name: "使用司机" },
    { role: "agent", agentId: "agent-1", name: "行政小李", authorityScope: { canOrder: true, canPay: false }, authorityValidTo: "2026-12-31T00:00:00.000Z" }
  ];
  const withSubjects = `o_sub_${suffix}`;
  await prisma.rentalOrder.create({
    data: orderRow(withSubjects, `SUB-${suffix}-1`, {
      orderCustomerId: corp,
      columns: {
        contractSubjectCustomerId: corp,
        payerSubjectCustomerId: hq,
        userSubjectCustomerId: driver,
        agentId: "agent-1",
        subjectSnapshot: snapshot
      }
    })
  });
  const read = await facts.findOrder(tenantId, withSubjects);
  assert.ok(read, "订单必须能读回");
  assert.equal(read.contractSubjectCustomerId, corp, "签约主体 id 必须读回");
  assert.equal(read.payerSubjectCustomerId, hq, "付款主体 id 必须读回（可与签约主体不同）");
  assert.equal(read.userSubjectCustomerId, driver, "使用人 id 必须读回");
  assert.equal(read.agentId, "agent-1", "经办人 id 必须读回");
  assert.equal(read.subjectSnapshot?.length, 4, "四个角色的快照必须读回");
  const byRole = Object.fromEntries(read.subjectSnapshot.map((s) => [s.role, s]));
  assert.equal(byRole.contract.contractNo, "C-1", "快照里的合同编号必须保留");
  assert.equal(byRole.payer.invoiceProfileId, "inv-1", "快照里的开票资料引用必须保留");
  assert.equal(byRole.agent.authorityScope.canPay, false, "快照里的授权范围必须保留");
  ok("订单主体存取：四个角色的 id 与快照原样写入、原样读回，签约与付款可不同");

  // ============ 2. 主体快照不随主档改名而变（历史不被篡改） ============
  await prisma.customerProfile.update({ where: { id: corp }, data: { name: "改名后的公司" } });
  const afterRename = await facts.findOrder(tenantId, withSubjects);
  assert.equal(
    afterRename.subjectSnapshot.find((s) => s.role === "contract").name,
    "签约公司",
    "主档改名不得篡改历史订单的主体快照"
  );
  assert.equal(afterRename.contractSubjectCustomerId, corp, "id 引用仍指向同一主档");
  ok("历史不可篡改：主档改名后订单快照仍是下单当时的名称，id 引用不变");

  // ============ 3. 存量订单（主体列为 NULL）读回为 undefined，语义回落 ============
  const legacy = `o_legacy_${suffix}`;
  await prisma.rentalOrder.create({ data: orderRow(legacy, `SUB-${suffix}-2`, { orderCustomerId: corp }) });
  const legacyRead = await facts.findOrder(tenantId, legacy);
  assert.equal(legacyRead.contractSubjectCustomerId, undefined, "存量订单不得凭空多出主体");
  assert.equal(legacyRead.payerSubjectCustomerId, undefined);
  assert.equal(legacyRead.userSubjectCustomerId, undefined);
  assert.equal(legacyRead.agentId, undefined);
  assert.equal(legacyRead.subjectSnapshot, undefined, "没有快照就是 undefined，不是空数组");
  assert.equal(legacyRead.customerId, corp, "回落语义的依据仍是 customerId");
  ok("存量订单：主体列为空时读回 undefined，读取侧据此回落到 customerId（迁移无需回填）");

  // ============ 4. 按主体角色反查订单 ============
  const asPayer = await prisma.rentalOrder.findMany({
    where: { tenantId, payerSubjectCustomerId: hq }, select: { id: true }
  });
  assert.deepEqual(asPayer.map((r) => r.id), [withSubjects], "必须能查出「该客户作为付款主体」的订单");
  const asUser = await prisma.rentalOrder.findMany({
    where: { tenantId, userSubjectCustomerId: driver }, select: { id: true }
  });
  assert.deepEqual(asUser.map((r) => r.id), [withSubjects], "必须能查出「该客户作为使用人」的订单");
  // 付款总部并不是签约主体，按签约主体反查不应命中——角色不能混淆。
  assert.equal(
    (await prisma.rentalOrder.count({ where: { tenantId, contractSubjectCustomerId: hq } })),
    0,
    "按角色反查必须区分角色，不能把付款主体算作签约主体"
  );
  ok("按角色反查：付款主体与使用人各自可查，且角色互不混淆（01D 的合并与注销要用）");

  // ============ 5. 经**仓储写入路径**固化主体（不只是直插库） ============
  // 上面几节用 Prisma 直插行验证读路径；这一节走 `saveOrderAggregate`，
  // 否则仓储写映射里漏掉主体列也不会被发现（变异测试实测过这个漏洞）。
  const viaRepo = `o_repo_${suffix}`;
  await facts.saveOrderAggregate({
    id: viaRepo, tenantId, orderNo: `SUB-${suffix}-3`, categoryCode: "camera", status: "reserved",
    customerType: "corporate", customerId: corp, customerName: "下单客户",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: locationId, fulfillmentLocationName: "主体测试门店",
    fulfillmentLocationSnapshot: { id: locationId, name: "主体测试门店" },
    returnLocationSnapshot: { id: locationId, name: "主体测试门店" },
    startAt: "2026-06-20T02:00:00.000Z", endAt: "2026-06-22T02:00:00.000Z",
    quoteId: `q_${viaRepo}`, quoteNo: `Q-${viaRepo}`, pricingPlanVersion: "v1",
    ruleVersion: "v1", ruleSnapshot: {}, chargeLines: [],
    rentalAmount: 0, discountAmount: 0, couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0,
    depositAmount: 0, preAuthAmount: 0, payableAmount: 0, adjustmentAmount: 0,
    finalPayableAmount: 0, totalAmount: 0,
    lines: [], reservations: [], allocations: [],
    createdBy: "tester", createdAt: "2026-06-15T10:00:00.000Z", updatedAt: "2026-06-15T10:00:00.000Z",
    // 被测对象：这五项必须真的落库。
    contractSubjectCustomerId: corp,
    payerSubjectCustomerId: hq,
    userSubjectCustomerId: driver,
    agentId: "agent-2",
    subjectSnapshot: snapshot
  });
  const repoRow = await prisma.rentalOrder.findUnique({
    where: { id: viaRepo },
    select: {
      contractSubjectCustomerId: true, payerSubjectCustomerId: true,
      userSubjectCustomerId: true, agentId: true, subjectSnapshot: true
    }
  });
  assert.equal(repoRow.contractSubjectCustomerId, corp, "仓储写入必须固化签约主体 id");
  assert.equal(repoRow.payerSubjectCustomerId, hq, "仓储写入必须固化付款主体 id");
  assert.equal(repoRow.userSubjectCustomerId, driver, "仓储写入必须固化使用人 id");
  assert.equal(repoRow.agentId, "agent-2", "仓储写入必须固化经办人 id");
  assert.equal(repoRow.subjectSnapshot?.length, 4, "仓储写入必须固化主体快照");
  ok("仓储写入路径：saveOrderAggregate 真的把四类主体与快照写进订单行");

  // ============ 5. 重启（重连）后主体仍在 ============
  await prisma.$disconnect();
  prisma = new PrismaClient();
  facts = new RentalCoreFactRepository(prisma);
  const afterReconnect = await facts.findOrder(tenantId, withSubjects);
  assert.equal(afterReconnect.contractSubjectCustomerId, corp, "重连后签约主体仍在");
  assert.equal(afterReconnect.subjectSnapshot?.length, 4, "重连后主体快照仍在");
  ok("持久化：断开重连后订单主体 id 与快照全部从库读回");

  await cleanup();
  await prisma.$disconnect();
  console.log("\nCUSTOMER-01C 订单主体存取用例全部通过");
})().catch(async (error) => {
  console.error(error);
  try {
    await cleanup();
    await prisma.$disconnect();
  } catch {
    // 清理失败不掩盖原始错误
  }
  process.exit(1);
});
