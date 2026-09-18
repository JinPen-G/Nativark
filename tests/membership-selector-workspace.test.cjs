const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * 会员选择器：同租户两空间共享会员、方案与员工关系，跨租户仍隔离。
 * 只用一条 tenantId/customerId 会员夹具，不为第二空间重复建会员。
 */
const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
const dbName = new URL(databaseUrl).pathname.slice(1);
require('../scripts/ops/dedicated-env.cjs').resolveDedicatedTarget(databaseUrl);
if (!dbName.split('_').some(part => part === 'claude' || part === 'zcode')) {
  console.error(`拒绝执行：会员共享专项只能跑在并行专用库上（claude/zcode），当前指向 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;

const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const { MembershipService } = require(path.join(ROOT, "apps/api/src/modules/platform/membership.service"));
const { CustomerOperationsRepository } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-operations.repository"));
const { runWithRequestIdentity } = require(path.join(ROOT, "apps/api/src/common/request-identity"));

const suffix = Date.now().toString(36);
const tenantA = `t_ms_a_${suffix}`;
const tenantB = `t_ms_b_${suffix}`;
const wsA1 = `ws_ms_a1_${suffix}`;
const wsA2 = `ws_ms_a2_${suffix}`;
const wsB1 = `ws_ms_b1_${suffix}`;
const prisma = new PrismaClient();
const memberships = new MembershipService(prisma, new CustomerOperationsRepository(prisma));
const inWorkspace = (workspaceId, work) => runWithRequestIdentity({ tenantId: tenantA, workspaceId }, work);

async function cleanup() {
  const where = { tenantId: { in: [tenantA, tenantB] } };
  // 授予对方案是 Restrict；清理只限定本测试租户，不能按空间删共享会员。
  await prisma.customerMembershipPlanAssignment.deleteMany({ where });
  await prisma.customerMembershipReview.deleteMany({ where });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
}

async function createProfile(tenantId, customerType, name, phone, corporateName) {
  return prisma.customerProfile.create({
    data: { tenantId, customerType, name, phone, phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}`, qualifications: {}, corporateName }
  });
}

async function seed() {
  await prisma.tenant.createMany({
    data: [
      { id: tenantA, code: `ms-a-${suffix}`, name: "会员范围租户 A" },
      { id: tenantB, code: `ms-b-${suffix}`, name: "会员范围租户 B" }
    ]
  });
  await prisma.businessWorkspace.createMany({
    data: [
      { id: wsA1, tenantId: tenantA, code: wsA1, name: "空间 A1", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" },
      { id: wsA2, tenantId: tenantA, code: wsA2, name: "空间 A2", categoryCode: "CAMPING", isDefault: false, defaultMarker: wsA2 },
      { id: wsB1, tenantId: tenantB, code: wsB1, name: "空间 B1", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" }
    ]
  });
  const personalA1 = await createProfile(tenantA, "personal", "A1 登记个人", "13800010001");
  const personalA2 = await createProfile(tenantA, "personal", "A2 登记个人", "13800020002");
  const personalBoth = await createProfile(tenantA, "personal", "共享个人", "13800030003");
  const personalB = await createProfile(tenantB, "personal", "B1 个人", "13800040004");
  const unregistered = await createProfile(tenantA, "personal", "未开通会员主档", "13800050005");
  const corporateBoth = await createProfile(tenantA, "corporate", "共享企业", "13900010001", "共享企业有限公司");
  const corporateB = await createProfile(tenantB, "corporate", "B1 企业", "13900020002", "B1 企业有限公司");
  for (const customer of [personalA1, personalA2, personalBoth, personalB, corporateBoth, corporateB]) {
    await prisma.customerMembership.create({ data: { tenantId: customer.tenantId, customerId: customer.id, status: "active" } });
  }
  await memberships.saveCorporateEmployee(tenantA, corporateBoth.id, { personalCustomerId: personalBoth.id, role: "admin", effectiveFrom: "2020-01-01T00:00:00.000Z" });
  return { personalA1, personalA2, personalBoth, personalB, corporateBoth, corporateB, unregistered };
}

function ids(rows) { return new Set(rows.map((row) => row.customerId)); }

void (async () => {
  try {
    await cleanup();
    const seeded = await seed();
    const expectedPersonal = new Set([seeded.personalA1.id, seeded.personalA2.id, seeded.personalBoth.id]);
    for (const workspaceId of [wsA1, wsA2]) {
      const personal = await inWorkspace(workspaceId, () => memberships.listPersonalMembers(tenantA));
      assert.deepEqual(ids(personal), expectedPersonal, "任一空间均返回所有租户会员且无重复");
      assert.equal(personal.length, expectedPersonal.size);
      assert.ok(!ids(personal).has(seeded.personalB.id), "外租户会员不可见");
      assert.ok(!ids(personal).has(seeded.unregistered.id), "共享主档不等于已经开通会员");
      assert.deepEqual(ids(await inWorkspace(workspaceId, () => memberships.listPersonalOptions(tenantA))), expectedPersonal);
      const corporate = await inWorkspace(workspaceId, () => memberships.listCorporateMembers(tenantA));
      assert.deepEqual(ids(corporate), new Set([seeded.corporateBoth.id]));
      assert.equal(corporate[0].employeeCount, 1);
      assert.equal(corporate[0].adminCount, 1);
      const employees = await inWorkspace(workspaceId, () => memberships.listCorporateEmployees(tenantA, seeded.corporateBoth.id));
      assert.deepEqual(new Set(employees.map((row) => row.personalCustomerId)), new Set([seeded.personalBoth.id]));
      const booking = await memberships.listBookingOptions(tenantA, workspaceId, seeded.personalBoth.id);
      assert.equal(booking[0].corporateMembershipId, employees[0].id, "两空间预约共用同一员工关系");
      assert.equal(booking[0].corporateCustomerId, seeded.corporateBoth.id);
    }
    assert.deepEqual(ids(await memberships.listPersonalMembers(tenantB)), new Set([seeded.personalB.id]));
    assert.deepEqual(ids(await memberships.listCorporateMembers(tenantB)), new Set([seeded.corporateB.id]));
    await assert.rejects(() => memberships.listCorporateEmployees(tenantB, seeded.corporateBoth.id), /客户不存在/u);
    await assert.rejects(() => memberships.saveCorporateEmployee(tenantA, seeded.corporateBoth.id, { personalCustomerId: seeded.personalB.id, role: "employee" }), /客户不存在/u);
    await assert.rejects(() => memberships.listBookingOptions(tenantA, wsB1, seeded.personalBoth.id), /经营空间不存在或不属于本租户/u);
    assert.deepEqual(await memberships.listBookingOptions(tenantA, wsA2, seeded.personalA1.id), [], "非企业员工不能获得企业身份");
    console.log("  PASS 两空间共享个人/企业会员和员工数，跨租户与非员工负例保留");

    const planInput = { code: "SHARED", name: "租户共享方案", targetType: "personal", levelRank: 1, benefits: [{ type: "rental_discount", calculation: "amount", value: 50 }] };
    const plan = await inWorkspace(wsA1, () => memberships.savePlan(tenantA, planInput, "管理员"));
    await inWorkspace(wsA2, () => memberships.publishPlan(tenantA, plan.id, plan.currentVersion.id, "管理员"));
    const assignment = await inWorkspace(wsA2, () => memberships.assignPlan(tenantA, {
      customerId: seeded.personalA2.id, planVersionId: plan.currentVersion.id, reason: "共享授予", effectiveFrom: "2020-01-01T00:00:00.000Z"
    }, "管理员"));
    for (const workspaceId of [wsA1, wsA2]) {
      assert.equal((await inWorkspace(workspaceId, () => memberships.listPlans(tenantA)))[0].id, plan.id);
      const benefits = await memberships.resolveBenefits(tenantA, workspaceId, seeded.personalA2.id);
      assert.equal(benefits.personal.id, assignment.id, "任一业务空间复用同一授予，而不是复制授予");
      assert.equal(benefits.personal.snapshot.benefits[0].value, 50);
      assert.deepEqual(benefits.personal.snapshot.benefits[0].scope, { type: "tenant" });
    }
    const foreignPlan = await memberships.savePlan(tenantB, planInput, "B 管理员");
    await memberships.publishPlan(tenantB, foreignPlan.id, foreignPlan.currentVersion.id, "B 管理员");
    assert.notEqual(foreignPlan.id, plan.id, "相同方案 code 在不同租户分别独立");
    assert.deepEqual((await memberships.listPlans(tenantA)).map((row) => row.id), [plan.id], "A 租户方案列表不能带出 B 的同编码方案");
    assert.deepEqual((await memberships.listPlans(tenantB)).map((row) => row.id), [foreignPlan.id]);
    await assert.rejects(() => memberships.assignPlan(tenantA, { customerId: seeded.personalA1.id, planVersionId: foreignPlan.currentVersion.id, reason: "跨租户授予" }), /可授予的已发布会员方案版本不存在/u);
    await assert.rejects(() => memberships.savePlan(tenantA, { ...planInput, id: foreignPlan.id }), /会员方案不存在/u);
    assert.equal(await prisma.customerMembershipPlanAssignment.count({ where: { tenantId: tenantA } }), 1);
    console.log("  PASS 同租户方案跨空间创建/发布/授予与解析成功，跨租户仍拒绝");

    await inWorkspace(wsA1, () => memberships.saveRegistrationSettings(tenantA, "manual"));
    assert.equal((await inWorkspace(wsA2, () => memberships.getRegistrationSettings(tenantA))).registrationMode, "manual");
    const registrationInput = { name: "共享注册", phone: "13800060006", channel: "admin", idempotencyKey: `register-${suffix}` };
    const registered = await inWorkspace(wsA1, () => memberships.registerPersonal(tenantA, registrationInput, "管理员"));
    const replay = await inWorkspace(wsA2, () => memberships.registerPersonal(tenantA, registrationInput, "管理员"));
    assert.equal(replay.customerId, registered.customerId);
    assert.equal(replay.review.id, registered.review.id, "跨空间重试不能重复创建审核");
    assert.equal(registered.review.sourceWorkspaceId, undefined, "后台租户注册审核允许没有来源空间");
    assert.equal(await prisma.customerMembership.count({ where: { tenantId: tenantA, customerId: registered.customerId } }), 1);
    assert.equal(await prisma.customerMembershipRegistrationSettings.count({ where: { tenantId: tenantA } }), 1);
    await inWorkspace(wsA2, () => memberships.saveRegistrationSettings(tenantA, "automatic"));
    assert.equal((await inWorkspace(wsA1, () => memberships.getRegistrationSettings(tenantA))).registrationMode, "automatic");
    const automaticReplay = await memberships.registerPersonal(tenantA, registrationInput, "管理员");
    assert.equal(automaticReplay.membershipStatus, "pending_activation", "改为自动注册不得绕过既有人工审核");
    console.log("会员选择器租户共享专项全部通过");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
