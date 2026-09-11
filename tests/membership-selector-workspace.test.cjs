const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * ACCESS-01B 专项：会员列表的当前空间读范围。
 *
 * 客户主档属于租户共享，但会员关系与企业员工关系属于经营空间。
 * 这里用真实 Prisma 读取同一租户两个空间和另一租户的夹具，验证后台会员选择器
 * 只返回当前空间可经营的客户，不把共享主档误当成当前空间会员。
 */
const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
// 允许通过进程环境把专项切到隔离库；没有显式环境变量时才使用项目 .env。
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
const dbName = new URL(databaseUrl).pathname.slice(1);
if (!/^store_rental_(?:claude(?:_dedicated_access_\d+)?|zcode)$/u.test(dbName)) {
  console.error(`拒绝执行：会员空间专项只能跑在并行专用库上（claude/zcode），当前指向 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;

const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const { MembershipService } = require(path.join(ROOT, "apps/api/src/modules/platform/membership.service"));

const suffix = Date.now().toString(36);
const tenantA = `t_ms_a_${suffix}`;
const tenantB = `t_ms_b_${suffix}`;
const wsA1 = `ws_ms_a1_${suffix}`;
const wsA2 = `ws_ms_a2_${suffix}`;
const wsB1 = `ws_ms_b1_${suffix}`;

const prisma = new PrismaClient();
const memberships = new MembershipService(prisma);

async function cleanup() {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
}

async function createProfile(tenantId, customerType, name, phone, corporateName) {
  return prisma.customerProfile.create({
    data: {
      tenantId, customerType, name, phone, phoneMasked: `${phone.slice(0, 3)}****${phone.slice(-4)}`,
      qualifications: {}, corporateName
    }
  });
}

async function link(tenantId, workspaceId, customerId) {
  return prisma.customerWorkspaceLink.create({ data: { tenantId, workspaceId, customerId, status: "active" } });
}

async function seed() {
  await prisma.tenant.createMany({
    data: [
      { id: tenantA, code: `ms-a-${suffix}`, name: "ACCESS-01B 会员范围租户 A" },
      { id: tenantB, code: `ms-b-${suffix}`, name: "ACCESS-01B 会员范围租户 B" }
    ]
  });
  await prisma.businessWorkspace.createMany({
    data: [
      { id: wsA1, tenantId: tenantA, code: wsA1, name: "空间 A1", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" },
      { id: wsA2, tenantId: tenantA, code: wsA2, name: "空间 A2", categoryCode: "CAMPING", isDefault: false, defaultMarker: wsA2 },
      { id: wsB1, tenantId: tenantB, code: wsB1, name: "空间 B1", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" }
    ]
  });

  const personalA1 = await createProfile(tenantA, "personal", "A1 个人", `1380001${suffix.slice(-4)}`);
  const personalA2 = await createProfile(tenantA, "personal", "A2 个人", `1380002${suffix.slice(-4)}`);
  const personalBoth = await createProfile(tenantA, "personal", "A1 A2 个人", `1380003${suffix.slice(-4)}`);
  const personalB = await createProfile(tenantB, "personal", "B1 个人", `1380004${suffix.slice(-4)}`);
  await link(tenantA, wsA1, personalA1.id);
  await link(tenantA, wsA2, personalA2.id);
  await link(tenantA, wsA1, personalBoth.id);
  await link(tenantA, wsA2, personalBoth.id);
  await link(tenantB, wsB1, personalB.id);

  const corporateBoth = await createProfile(tenantA, "corporate", "A1 A2 企业", `1390001${suffix.slice(-4)}`, "A1 A2 企业有限公司");
  const corporateB = await createProfile(tenantB, "corporate", "B1 企业", `1390002${suffix.slice(-4)}`, "B1 企业有限公司");
  await link(tenantA, wsA1, corporateBoth.id);
  await link(tenantA, wsA2, corporateBoth.id);
  await link(tenantB, wsB1, corporateB.id);

  // 员工关系只属于 A2；A1 的企业会员列表不能把这条关系计入员工数。
  await prisma.customerCorporateMembership.create({
    data: { tenantId: tenantA, workspaceId: wsA2, corporateCustomerId: corporateBoth.id, personalCustomerId: personalBoth.id, role: "admin", status: "active" }
  });
  return { personalA1, personalA2, personalBoth, personalB, corporateBoth, corporateB };
}

function ids(rows) {
  return new Set(rows.map((row) => row.customerId));
}

void (async () => {
  try {
    await cleanup();
    const seeded = await seed();

    const a1Personal = await memberships.listPersonalMembers(tenantA, wsA1);
    assert.deepEqual(ids(a1Personal), new Set([seeded.personalA1.id, seeded.personalBoth.id]));
    assert.ok(!ids(a1Personal).has(seeded.personalA2.id));
    assert.ok(!ids(a1Personal).has(seeded.personalB.id));
    console.log("  ✓ 个人会员列表只返回当前空间关系，不串入同租户其他空间或其他租户");

    const a2Personal = await memberships.listPersonalMembers(tenantA, wsA2);
    assert.deepEqual(ids(a2Personal), new Set([seeded.personalA2.id, seeded.personalBoth.id]));
    console.log("  ✓ 同一共享客户在不同空间分别出现，会员关系没有被错误合并");

    const a1Corporate = await memberships.listCorporateMembers(tenantA, wsA1);
    assert.deepEqual(ids(a1Corporate), new Set([seeded.corporateBoth.id]));
    assert.equal(a1Corporate[0].employeeCount, 0, "A1 不应统计 A2 的企业员工关系");
    const a2Corporate = await memberships.listCorporateMembers(tenantA, wsA2);
    assert.equal(a2Corporate[0].employeeCount, 1);
    const b1Corporate = await memberships.listCorporateMembers(tenantB, wsB1);
    assert.deepEqual(ids(b1Corporate), new Set([seeded.corporateB.id]));
    console.log("  ✓ 企业会员与员工数量按租户+空间隔离");

    assert.deepEqual(await memberships.listCorporateEmployees(tenantA, wsA1, seeded.corporateBoth.id), []);
    assert.equal((await memberships.listCorporateEmployees(tenantA, wsA2, seeded.corporateBoth.id)).length, 1);
    console.log("  ✓ 企业员工选择器按当前空间过滤员工关系");

    console.log("会员选择器空间范围专项：4 项全部通过");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
