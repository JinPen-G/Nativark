const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * CUSTOMER-01D 专项：重复识别、人工合并、注销前置与审计。
 *
 * 直连专用真库：本阶段的每条口径都落在真实的跨表状态上——合并后订单引用是否仍指向
 * 原主档、双方租户会员与历史快照是否分别保留，注销是否被任一空间的在途订单、
 * 未结资金、未厘清保证金、未关闭风险及生效授信挡住。
 */

const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
const dbName = new URL(databaseUrl).pathname.slice(1);
if (!/claude/.test(dbName)) {
  console.error(`拒绝执行：CUSTOMER 专项测试只能跑在专用库上，当前指向 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;

const { PrismaClient, Prisma } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const { SharedCustomerRepository } = require(path.join(ROOT, "apps/api/src/modules/platform/shared-customer.repository"));
const { CustomerOperationsRepository } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-operations.repository"));
const { CustomerOperationsService } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-operations.service"));
const { CustomerMergeService } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-merge.service"));

const suffix = Date.now().toString(36);
const tenantA = `t_md_a_${suffix}`;
const tenantB = `t_md_b_${suffix}`;
const wsA1 = `ws_md_a1_${suffix}`;
const wsA2 = `ws_md_a2_${suffix}`;
const wsB1 = `ws_md_b1_${suffix}`;
const locA1 = `loc_md_a1_${suffix}`;
const locA2 = `loc_md_a2_${suffix}`;

let prisma = new PrismaClient();
let customers = new SharedCustomerRepository(prisma);
let operations = new CustomerOperationsRepository(prisma);
let merge = new CustomerMergeService(prisma, customers, operations);
let ops = new CustomerOperationsService(prisma, customers, operations, merge);

const ok = (m) => console.log(`  ✓ ${m}`);

async function rejects(promise, pattern, label) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, pattern, `${label}：实际 ${error.message}`);
    return true;
  }, label);
}

async function cleanup() {
  await prisma.rentalOrder.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
}

async function seed() {
  for (const [id, code] of [[tenantA, `md-a-${suffix}`], [tenantB, `md-b-${suffix}`]]) {
    await prisma.tenant.create({ data: { id, code, name: `CUSTOMER-01D 测试租户 ${code}` } });
  }
  // wsA1 为租户 A 的默认空间（订单读取在无请求上下文时按默认空间解析）。
  await prisma.businessWorkspace.create({
    data: { id: wsA1, tenantId: tenantA, code: wsA1, name: "空间 A1", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" }
  });
  await prisma.businessWorkspace.create({
    data: { id: wsA2, tenantId: tenantA, code: wsA2, name: "空间 A2", categoryCode: "CAMPING", isDefault: false, defaultMarker: wsA2 }
  });
  await prisma.businessWorkspace.create({
    data: { id: wsB1, tenantId: tenantB, code: wsB1, name: "空间 B1", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" }
  });
  await prisma.rentalFulfillmentLocation.createMany({
    data: [
      { id: locA1, tenantId: tenantA, workspaceId: wsA1, code: `L1-${suffix}`, name: "01D 门店 A1", type: "store", capabilities: ["pickup", "return"], status: "enabled" },
      { id: locA2, tenantId: tenantA, workspaceId: wsA2, code: `L2-${suffix}`, name: "01D 门店 A2", type: "store", capabilities: ["pickup", "return"], status: "enabled" }
    ]
  });
}

/** 最小合法订单行。只用于「在途订单挡注销」「合并保留订单引用」这两类断言。 */
function orderRow(id, orderNo, extra = {}) {
  const money = new Prisma.Decimal(0);
  return {
    id, tenantId: tenantA, workspaceId: wsA1, orderNo, categoryCode: "CAMERA", status: "COMPLETED",
    customerType: "personal", customerName: "订单客户",
    fulfillmentMode: "store_pickup_return", fulfillmentLocationId: locA1, fulfillmentLocationName: "01D 门店",
    startAt: new Date("2026-06-20T02:00:00.000Z"), endAt: new Date("2026-06-22T02:00:00.000Z"),
    quoteId: `q_${orderNo}`, quoteNo: `Q-${orderNo}`, pricingPlanVersion: "v1",
    ruleVersion: "v1", ruleSnapshot: {}, chargeLines: [],
    rentalAmount: money, discountAmount: money, couponAmount: money, serviceAmount: money,
    fulfillmentAmount: money, depositAmount: money, preAuthAmount: money, payableAmount: money,
    adjustmentAmount: money, finalPayableAmount: money, totalAmount: money,
    createdBy: "tester",
    ...extra
  };
}

void (async () => {
  await cleanup();
  await seed();

  // 同一人重复注册成两个主档，每个主档只有一份租户会员。
  const keep = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "张三", phone: "13800001111", identityNo: "310101199001011234"
  }, "黄金会员");
  const dup = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "张三（重复）", phone: "13800002222", identityNo: "310101199001011234"
  }, "钻石会员");
  // 租户 B 的同号客户，用于跨租户断言。
  const otherTenant = await customers.createWithMembership(tenantB, {
    customerType: "personal", name: "B 租户张三", phone: "13800001111"
  }, "普通会员");

  // ============ 1. 重复识别：只在同租户内，带命中依据，排除自身 ============
  await prisma.customerContact.create({
    data: {
      tenantId: tenantA, customerId: keep.id, kind: "emergency", name: "同号联系人",
      phone: "13800002222", phoneMasked: "138****2222"
    }
  });
  const candidates = await merge.findDuplicates(tenantA, dup.id);
  const ids = candidates.map((row) => row.customerId);
  assert.ok(ids.includes(keep.id), `必须识别出重复主档，实际 ${JSON.stringify(ids)}`);
  assert.equal(ids.includes(dup.id), false, "候选不得包含自身");
  assert.equal(ids.includes(otherTenant.id), false, "候选不得跨租户——跨租户禁止共享与合并");
  const hit = candidates.find((row) => row.customerId === keep.id);
  assert.ok(hit.matchedBy, "候选必须给出命中依据，否则人工合并变成盲签");
  ok(`重复识别：同租户内识别出候选并给出依据（${hit.matchedBy}），排除自身与跨租户`);

  // ============ 2. 合并预览：只读，且把不可合并的情形列成 blockers ============
  const preview = await merge.previewMerge(tenantA, dup.id, keep.id);
  assert.equal(preview.blockers.length, 0, `正常合并不应有阻断项，实际 ${JSON.stringify(preview.blockers)}`);
  assert.ok(preview.fieldDiff && Object.keys(preview.fieldDiff).length > 0, "预览必须给出字段差异供人工取舍");
  // 预览是只读的：不得写出任何映射或改主档。
  assert.equal(await prisma.customerMergeMapping.count({ where: { tenantId: tenantA } }), 0, "预览不得写出合并映射");
  assert.equal(
    (await customers.findById(tenantA, dup.id)).mergedIntoCustomerId,
    undefined,
    "预览不得改动主档"
  );
  const selfPreview = await merge.previewMerge(tenantA, dup.id, dup.id);
  assert.ok(
    selfPreview.blockers.some((b) => b.code === "same_customer"),
    "被合并方与保留方相同必须列为阻断项"
  );
  ok("合并预览：只读不落库、给出字段差异、同一主档自合并被列为阻断项");

  // ============ 3. 禁止跨租户合并 ============
  await rejects(
    merge.mergeCustomers(tenantA, { sourceCustomerId: dup.id, targetCustomerId: otherTenant.id, reason: "跨租户合并" }),
    /不存在/u,
    "把租户 A 的客户合并到租户 B 的主档"
  );
  await rejects(
    merge.mergeCustomers(tenantB, { sourceCustomerId: otherTenant.id, targetCustomerId: keep.id, reason: "反向跨租户合并" }),
    /不存在/u,
    "反向跨租户合并"
  );
  assert.equal(
    await prisma.customerMergeMapping.count({ where: { tenantId: { in: [tenantA, tenantB] } } }),
    0,
    "被拒的跨租户合并不得留下任何映射"
  );
  ok("跨租户合并：正反两个方向都被拒，且不留下映射");

  // ============ 4. 合并保留原订单、历史空间快照与双方唯一会员 ============
  const historicalSnapshot = {
    bookingIdentity: "personal", personalCustomerId: dup.id, personalCustomerName: dup.name,
    enterpriseContractAndPayer: false, benefitSource: "personal", qualifications: [], resolvedAt: "2026-06-20T00:00:00.000Z",
    personalPlan: { id: "legacy-assignment", workspaceId: wsA1, snapshot: { planName: "历史空间方案", benefits: [{ type: "rental_discount", calculation: "amount", value: 50, scope: { type: "workspaces", workspaceIds: [wsA1] } }] } }
  };
  await prisma.rentalOrder.create({ data: orderRow(`o_dup_${suffix}`, `MD-${suffix}-1`, { customerId: dup.id, membershipSnapshot: historicalSnapshot }) });
  await prisma.rentalOrder.create({
    data: orderRow(`o_payer_${suffix}`, `MD-${suffix}-2`, { customerId: keep.id, payerSubjectCustomerId: dup.id })
  });
  const membershipsBefore = await prisma.customerMembership.findMany({
    where: { tenantId: tenantA, customerId: { in: [keep.id, dup.id] } }, orderBy: { customerId: "asc" }
  });
  assert.equal(membershipsBefore.length, 2, "前置条件：两份主档各有且只有一份租户会员");

  const merged = await merge.mergeCustomers(
    tenantA,
    { sourceCustomerId: dup.id, targetCustomerId: keep.id, reason: "同一人重复注册，保留较早主档", approver: "客服主管" },
    "客服小王"
  );
  assert.ok(merged, "合并必须返回结果");
  // 4a. 被合并方置为终态，且指向保留方。
  const sourceAfter = await customers.findById(tenantA, dup.id);
  assert.equal(sourceAfter.mergedIntoCustomerId, keep.id, "被合并方必须指向保留方");
  // 4b. 订单引用**不搬移**：历史订单仍指向原主档（需求 4.8.3）。
  const dupOrder = await prisma.rentalOrder.findUnique({ where: { id: `o_dup_${suffix}` }, select: { customerId: true, workspaceId: true, membershipSnapshot: true } });
  assert.equal(dupOrder.customerId, dup.id, "合并不得搬移订单的客户引用——历史业务引用必须原样保留");
  assert.equal(dupOrder.workspaceId, wsA1, "租户共享会员不得改变历史订单的空间归属");
  assert.deepEqual(dupOrder.membershipSnapshot, historicalSnapshot, "历史订单内旧空间方案快照不得重写为全租户权益");
  const payerOrder = await prisma.rentalOrder.findUnique({
    where: { id: `o_payer_${suffix}` }, select: { payerSubjectCustomerId: true }
  });
  assert.equal(payerOrder.payerSubjectCustomerId, dup.id, "作为付款主体的引用同样不得被搬移");
  // 4c. 共享限于同一客户的两空间，不意味着合并客户就可合并双方等级或权益。
  const membershipsAfter = await prisma.customerMembership.findMany({
    where: { tenantId: tenantA, customerId: { in: [keep.id, dup.id] } }, orderBy: { customerId: "asc" }
  });
  assert.deepEqual(membershipsAfter, membershipsBefore, "合并不得改写或删除双方会员的原始事实");
  assert.equal(membershipsAfter.find((row) => row.customerId === keep.id).levelName, "黄金会员");
  assert.equal(membershipsAfter.find((row) => row.customerId === dup.id).levelName, "钻石会员");
  for (const workspaceId of [wsA1, wsA2]) {
    assert.equal((await ops.assertTransactable(tenantA, workspaceId, keep.id)).allowed, true);
    assert.equal((await ops.assertTransactable(tenantA, workspaceId, dup.id)).reasonCode, "customer_merged", "源会员留档不表示仍可开展新业务");
  }
  // 4d. 映射固化原因、操作人、审批人、字段差异与会员快照。
  const mapping = await prisma.customerMergeMapping.findFirst({
    where: { tenantId: tenantA, sourceCustomerId: dup.id }
  });
  assert.ok(mapping, "必须写出合并映射");
  assert.equal(mapping.targetCustomerId, keep.id);
  assert.equal(mapping.reason, "同一人重复注册，保留较早主档", "原因必须原样保存");
  assert.equal(mapping.operator, "客服小王", "必须记录操作人");
  assert.equal(mapping.approver, "客服主管", "必须记录审批人");
  assert.ok(mapping.fieldDiff, "必须固化字段差异与人工取舍结论");
  assert.deepEqual(mapping.membershipSnapshot.source, JSON.parse(JSON.stringify(dup.membership)), "映射固化源租户会员快照");
  assert.deepEqual(mapping.membershipSnapshot.target, JSON.parse(JSON.stringify(keep.membership)), "映射固化保留方租户会员快照");
  // 4e. 合并进入状态历史（需求 4.8.14 要求可按客户还原时间线）。
  const mergeHistory = (await operations.listStatusHistory(tenantA, dup.id)).filter((row) => row.action === "merge");
  assert.equal(mergeHistory.length, 1, "合并必须留一条状态历史");
  // 实现把目标主档 id 前置进 reason，使时间线自解释（「合并进 X：原因」）。
  // 断言两者都在：只断言原因会漏掉「合并去了哪」，只断言 id 会漏掉人工填写的理由。
  assert.match(mergeHistory[0].reason, /同一人重复注册，保留较早主档/u, "人工填写的原因必须保留");
  assert.match(mergeHistory[0].reason, new RegExp(keep.id, "u"), "时间线必须能看出合并去了哪个主档");
  ok("合并：订单与付款主体引用原样保留、双方租户会员不混合、历史空间快照与审计齐备");

  // ============ 5. 合并只能一次；并发只有一路成功 ============
  // 直接断言**预览层**的阻断码：只断言 mergeCustomers 抛错不足以区分是谁挡住的——
  // 写入条件与唯一键同样会挡，于是删掉预览里的阻断项测试照样绿（变异测试实测过）。
  const afterMergePreview = await merge.previewMerge(tenantA, dup.id, keep.id);
  assert.ok(
    afterMergePreview.blockers.some((b) => b.code === "source_already_merged"),
    `已被合并的主档在预览层就必须给出 source_already_merged，实际 ${JSON.stringify(afterMergePreview.blockers)}`
  );
  // 合并到一个**已被合并**的主档会形成 A→B→C 多跳链，历史引用要多跳才能找到当前主档。
  const chainSource = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "链式重复档", phone: "13800007777"
  }, "普通会员");
  const chainPreview = await merge.previewMerge(tenantA, chainSource.id, dup.id);
  assert.ok(
    chainPreview.blockers.some((b) => b.code === "target_already_merged"),
    `保留方本身已被合并时必须给出 target_already_merged，实际 ${JSON.stringify(chainPreview.blockers)}`
  );
  await rejects(
    merge.mergeCustomers(tenantA, { sourceCustomerId: chainSource.id, targetCustomerId: dup.id, reason: "链式合并" }),
    /保留方本身已被合并/u,
    "合并到已被合并的主档"
  );
  await rejects(
    merge.mergeCustomers(tenantA, { sourceCustomerId: dup.id, targetCustomerId: keep.id, reason: "重复合并" }),
    /已经被合并过/u,
    "同一主档合并两次"
  );
  const raceSource = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "并发重复档", phone: "13800003333"
  }, "普通会员");
  const race = await Promise.allSettled([
    merge.mergeCustomers(tenantA, { sourceCustomerId: raceSource.id, targetCustomerId: keep.id, reason: "并发A" }, "opA"),
    merge.mergeCustomers(tenantA, { sourceCustomerId: raceSource.id, targetCustomerId: keep.id, reason: "并发B" }, "opB")
  ]);
  const won = race.filter((r) => r.status === "fulfilled").length;
  assert.equal(won, 1, `并发合并只能一路成功，实际 ${won} 路`);
  // 落败方必须拿到**可解释的冲突**，而不是裸的唯一键错误：唯一键固然也能挡住，
  // 但那会给运营一条 P2002 技术错误。这条断言用于区分「写入条件」与「唯一键兜底」。
  const lost = race.find((r) => r.status === "rejected");
  assert.match(
    String(lost.reason?.message ?? lost.reason),
    /已被合并或正被并发合并|已经被合并过/u,
    `并发落败方必须拿到可解释的冲突，实际 ${String(lost.reason?.message ?? lost.reason).slice(0, 160)}`
  );
  assert.equal(
    await prisma.customerMergeMapping.count({ where: { tenantId: tenantA, sourceCustomerId: raceSource.id } }),
    1,
    "并发下只能写出一条映射"
  );
  ok("合并幂等与并发：预览层给出 source/target_already_merged、重复与链式合并被拒、并发只一路成功且落败方拿到可解释冲突");

  // ============ 6. 注销前置：硬阻断项逐条生效 ============
  const closeTarget = await customers.createWithMembership(tenantA, {
    customerType: "corporate", name: "待注销公司", phone: "13800004444", corporateName: "待注销有限公司"
  }, "普通会员");
  await ops.ensureAccount(tenantA, closeTarget.id);

  // 6a. 在途订单（本人名下）挡注销。
  await prisma.rentalOrder.create({
    data: orderRow(`o_open_${suffix}`, `MD-${suffix}-3`, { customerId: closeTarget.id, status: "RESERVED" })
  });
  let closability = await merge.assertClosable(tenantA, closeTarget.id);
  assert.equal(closability.closable, false, "有在途订单时不得可注销");
  assert.ok(closability.blockers.some((b) => b.code === "open_orders"), "必须列出未完成订单阻断项");
  await rejects(
    ops.changeAccountStatus(tenantA, closeTarget.id, { status: "closed", reason: "客户申请注销", acknowledgedManualChecks: true }, "客服小王"),
    /注销前必须先处理/u,
    "有在途订单仍注销账号"
  );

  // 6b. 作为**别人订单的付款主体**同样算在途——只查 customerId 会漏掉资金义务。
  await prisma.rentalOrder.update({ where: { id: `o_open_${suffix}` }, data: { status: "COMPLETED" } });
  await prisma.rentalOrder.create({
    data: orderRow(`o_open2_${suffix}`, `MD-${suffix}-4`, {
      customerId: keep.id, payerSubjectCustomerId: closeTarget.id, status: "RENTING",
      workspaceId: wsA2, categoryCode: "CAMPING", fulfillmentLocationId: locA2, fulfillmentLocationName: "01D 门店 A2"
    })
  });
  closability = await merge.assertClosable(tenantA, closeTarget.id);
  assert.equal(closability.closable, false, "作为付款主体的在途订单同样必须挡住注销");
  assert.ok(closability.blockers.some((b) => b.code === "open_orders"));
  await rejects(
    ops.changeMembershipStatus(tenantA, closeTarget.id, { status: "closed", reason: "注销统一会员", acknowledgedManualChecks: true }, "客服小王"),
    /注销前必须先处理/u,
    "其他空间中作为付款主体的在途订单也必须阻止统一会员注销"
  );
  assert.equal((await customers.findMembership(tenantA, closeTarget.id)).status, "active", "被拒绝的注销不得写入状态");
  await prisma.rentalOrder.update({ where: { id: `o_open2_${suffix}` }, data: { status: "COMPLETED" } });

  // 6c. 归属未厘清的存量保证金挡注销。
  await prisma.rentalOrder.update({
    where: { id: `o_open_${suffix}` }, data: { legacyDepositUnverified: true }
  });
  closability = await merge.assertClosable(tenantA, closeTarget.id);
  assert.ok(
    closability.blockers.some((b) => b.code === "legacy_unverified_deposit"),
    "保证金归属未厘清必须挡住注销（放过去等于默认不用退）"
  );
  await prisma.rentalOrder.update({
    where: { id: `o_open_${suffix}` }, data: { legacyDepositUnverified: false }
  });

  // 6d. 未关闭的风险记录挡注销（需求 4.8.13：不得借注销规避风险限制）。
  const risk = await prisma.customerRiskRecord.create({
    data: {
      tenantId: tenantA, workspaceId: wsA2, customerId: closeTarget.id, riskType: "overdue", level: "high",
      detail: "存在逾期未结", source: "manual", status: "open", raisedAt: new Date()
    }
  });
  closability = await merge.assertClosable(tenantA, closeTarget.id);
  assert.ok(closability.blockers.some((b) => b.code === "open_risk"), "其他空间未关闭风险必须挡住注销");
  await rejects(ops.changeMembershipStatus(tenantA, closeTarget.id, { status: "closed", reason: "忽略其他空间风险", acknowledgedManualChecks: true }), /注销前必须先处理/u, "统一会员注销必须检查全租户风险");
  await prisma.customerRiskRecord.update({
    where: { id: risk.id }, data: { status: "closed", closedAt: new Date(), closeReason: "已结清" }
  });

  // 6e. 仍生效的企业授信挡注销（账期意味着可能有未到期应收）。
  const credit = await prisma.customerCorporateCredit.create({
    data: {
      tenantId: tenantA, customerId: closeTarget.id, creditLimit: new Prisma.Decimal(100000),
      settlementTermDays: 30, status: "active"
    }
  });
  closability = await merge.assertClosable(tenantA, closeTarget.id);
  assert.ok(
    closability.blockers.some((b) => b.code === "active_corporate_credit"),
    "生效的企业授信必须挡住注销"
  );
  await prisma.customerCorporateCredit.update({ where: { id: credit.id }, data: { status: "revoked" } });
  // 6f. 另一个空间的已完成订单仍持有押金，统一会员注销也不能绕过。
  const fundingBase = { tenantId: tenantA, workspaceId: wsA2, orderId: `o_open2_${suffix}`, instrument: "deposit", provider: "mock", amount: new Prisma.Decimal(100), at: new Date(), reason: "跨空间押金检查" };
  await prisma.rentalFundingEvent.create({ data: { ...fundingBase, action: "initiate", balanceAfter: new Prisma.Decimal(100), idempotencyKey: `held-${suffix}` } });
  closability = await merge.assertClosable(tenantA, closeTarget.id);
  assert.ok(closability.blockers.some((row) => row.code === "unsettled_security_funds"), "订单终态不能掩盖其他空间尚持有的押金");
  await rejects(ops.changeMembershipStatus(tenantA, closeTarget.id, { status: "closed", reason: "仅看订单终态注销", acknowledgedManualChecks: true }), /注销前必须先处理/u, "其他空间资金余额仍阻断统一会员注销");
  await prisma.rentalFundingEvent.create({ data: { ...fundingBase, action: "refund", balanceAfter: new Prisma.Decimal(0), idempotencyKey: `returned-${suffix}` } });
  ok("注销前置：全租户在途订单、保证金、风险、授信与其他空间资金余额逐条阻断");

  // ============ 7. 人工核对项必须显式确认，缺注入时拒绝而不是放行 ============
  closability = await merge.assertClosable(tenantA, closeTarget.id);
  assert.equal(closability.closable, true, `清理后应可注销，实际阻断 ${JSON.stringify(closability.blockers)}`);
  assert.ok(
    closability.manualConfirmations.length > 0,
    "系统无数据源的类别（退款、争议、追偿）必须作为人工核对项回传，而不是假装已核对"
  );
  await rejects(
    ops.changeAccountStatus(tenantA, closeTarget.id, { status: "closed", reason: "客户申请注销" }, "客服小王"),
    /必须人工确认/u,
    "未显式确认人工核对项就注销"
  );
  // 缺注入前置检查服务时必须拒绝注销，而不是跳过检查。
  const opsWithoutCheck = new CustomerOperationsService(prisma, customers, operations);
  await rejects(
    opsWithoutCheck.changeAccountStatus(tenantA, closeTarget.id, { status: "closed", reason: "绕过检查", acknowledgedManualChecks: true }, "x"),
    /前置检查服务未就绪/u,
    "缺前置检查服务时仍注销"
  );
  await rejects(
    ops.changeMembershipStatus(tenantA, closeTarget.id, { status: "closed", reason: "未确认统一会员注销" }),
    /必须人工确认/u,
    "统一会员注销也必须确认人工核对项"
  );
  await rejects(
    opsWithoutCheck.changeMembershipStatus(tenantA, closeTarget.id, { status: "closed", reason: "绕过会员检查", acknowledgedManualChecks: true }),
    /前置检查服务未就绪/u,
    "统一会员注销缺少前置检查时拒绝"
  );
  ok("人工核对与 fail-closed：账号及会员注销均不得跳过检查");

  // ============ 8. 注销成功后：账号终态、审计齐备、历史保留 ============
  const closedMembership = await ops.changeMembershipStatus(tenantA, closeTarget.id, { status: "closed", reason: "全租户义务结清", acknowledgedManualChecks: true }, "客服小王");
  assert.equal(closedMembership.status, "closed");
  assert.equal((await operations.findAccountByCustomer(tenantA, closeTarget.id)).status, "active", "关闭会员不关闭账号");
  for (const workspaceId of [wsA1, wsA2]) {
    assert.equal((await ops.assertTransactable(tenantA, workspaceId, closeTarget.id)).reasonCode, "membership_closed");
  }
  const closed = await ops.changeAccountStatus(
    tenantA, closeTarget.id,
    { status: "closed", reason: "客户申请注销并已结清", acknowledgedManualChecks: true },
    "客服小王"
  );
  assert.equal(closed.status, "closed", "注销后账号必须是终态");
  const closeHistory = (await operations.listStatusHistory(tenantA, closeTarget.id))
    .filter((row) => row.scope === "account" && row.action === "close");
  assert.equal(closeHistory.length, 1, "注销必须留一条账号级状态历史");
  assert.equal(closeHistory[0].reason, "客户申请注销并已结清", "注销原因必须原样保存");
  assert.equal(closeHistory[0].operator, "客服小王", "注销必须记录操作人");
  // 历史订单与主档仍在：注销不删除法定与业务必要记录（需求 4.8.13）。
  assert.ok(await customers.findById(tenantA, closeTarget.id), "注销不得删除客户主档");
  assert.equal(
    await prisma.rentalOrder.count({ where: { tenantId: tenantA, customerId: closeTarget.id } }),
    1,
    "注销不得删除历史订单"
  );
  ok("注销闭环：账号置终态、原因与操作人入审计、主档与历史订单按保留要求仍在");

  // ============ 9. 暂停/限制/退出/解除各自留独立记录，解除不覆盖原记录 ============
  const lifecycle = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "生命周期客户", phone: "13800005555"
  }, "普通会员");
  await ops.ensureAccount(tenantA, lifecycle.id);
  const steps = [
    ["suspended", "逾期未归还"],
    ["risk_restricted", "风控复核中"],
    ["active", "复核通过，解除限制"],
    ["exited", "客户主动退出租户会员"]
  ];
  for (const [status, reason] of steps) {
    await ops.changeMembershipStatus(tenantA, lifecycle.id, { status, reason }, "运营小李");
  }
  const wsHistory = (await operations.listStatusHistory(tenantA, lifecycle.id, wsA1))
    .filter((row) => row.scope === "membership");
  assert.equal(wsHistory.length, 4, `四次变更必须各留一条记录，实际 ${wsHistory.length}`);
  assert.deepEqual(
    wsHistory.map((row) => row.toStatus),
    ["suspended", "risk_restricted", "active", "exited"],
    "记录必须按时间保留完整状态轨迹"
  );
  assert.ok(
    wsHistory.some((row) => row.action === "release" || row.fromStatus === "risk_restricted"),
    "解除限制必须形成独立记录，而不是回改原限制记录"
  );
  // 会员退出不注销账号，但两空间的新业务都被阻断。
  const account = await operations.findAccountByCustomer(tenantA, lifecycle.id);
  assert.equal(account.status, "active", "租户会员退出不得改写账号");
  for (const workspaceId of [wsA1, wsA2]) {
    assert.equal((await ops.assertTransactable(tenantA, workspaceId, lifecycle.id)).reasonCode, "membership_exited");
  }
  assert.deepEqual((await operations.listStatusHistory(tenantA, lifecycle.id, wsA2)).filter((row) => row.scope === "membership").map((row) => row.id), wsHistory.map((row) => row.id));
  assert.ok(wsHistory.every((row) => row.workspaceId === undefined));
  ok("租户会员生命周期：独立追加状态历史、两空间同时生效、账号不受影响");

  // ============ 10. 重启（重连）后合并与注销结果仍在 ============
  await prisma.$disconnect();
  prisma = new PrismaClient();
  customers = new SharedCustomerRepository(prisma);
  operations = new CustomerOperationsRepository(prisma);
  merge = new CustomerMergeService(prisma, customers, operations);
  const reMapping = await prisma.customerMergeMapping.findFirst({
    where: { tenantId: tenantA, sourceCustomerId: dup.id }
  });
  assert.ok(reMapping, "重连后合并映射仍在");
  assert.equal((await customers.findById(tenantA, dup.id)).mergedIntoCustomerId, keep.id, "重连后被合并方仍指向保留方");
  assert.equal(
    (await operations.findAccountByCustomer(tenantA, closeTarget.id))?.status,
    "closed",
    "重连后注销结果仍在"
  );
  assert.equal(
    (await operations.listStatusHistory(tenantA, lifecycle.id, wsA1)).filter((r) => r.scope === "membership").length,
    4,
    "重连后租户会员状态历史仍完整"
  );
  ok("持久化：断开重连后合并映射、被合并标记、注销终态与状态历史全部从库读回");

  await cleanup();
  await prisma.$disconnect();
  console.log("\nCUSTOMER-01D 合并与注销用例全部通过");
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
