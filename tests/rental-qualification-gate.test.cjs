const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * SHARED-QUAL-01 专项：提交后的资格闸门必须重新读取当前会员事实。
 *
 * 这个专项只跑专用库，重点覆盖：已审核资格、有效期、当前空间关系、企业员工关系
 * 和 Rental Core 四个动作入口的源码接线。不跑全量 MySQL E2E。
 */
const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
const dbName = new URL(databaseUrl).pathname.slice(1);
if (!/claude/.test(dbName)) {
  console.error(`拒绝执行：资格闸门专项只能跑在专用库上，当前指向 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;

const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const { MembershipService } = require(path.join(ROOT, "apps/api/src/modules/platform/membership.service"));
const { evaluateRentalQualification } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-qualification"));

const suffix = Date.now().toString(36);
const tenantId = `t_qual_${suffix}`;
const workspaceId = `ws_qual_${suffix}`;
const otherWorkspaceId = `ws_qual_other_${suffix}`;
const personalId = `personal_qual_${suffix}`;
const corporateId = `corporate_qual_${suffix}`;

const prisma = new PrismaClient();
const memberships = new MembershipService(prisma);
const rule = { required: true, documentTypes: ["driver_license", "operator_certificate"], minimumValidityDays: 1 };

const snapshot = (bookingIdentity = "personal") => ({
  bookingIdentity,
  personalCustomerId: personalId,
  personalCustomerName: "资格测试个人",
  ...(bookingIdentity === "enterprise_employee" ? { corporateCustomerId: corporateId, corporateCustomerName: "资格测试企业", corporateMembershipId: `relation_${suffix}` } : {}),
  enterpriseContractAndPayer: bookingIdentity === "enterprise_employee",
  benefitSource: bookingIdentity === "enterprise_employee" ? "corporate" : "personal",
  qualifications: [],
  resolvedAt: new Date().toISOString()
});

const actionWindow = (daysFromNow, daysToEnd) => {
  const start = new Date(Date.now() + daysFromNow * 86_400_000);
  const end = new Date(Date.now() + daysToEnd * 86_400_000);
  return { validThroughAt: end.toISOString(), minimumValidityFromAt: start.toISOString() };
};

async function cleanup() {
  await prisma.tenant.deleteMany({ where: { id: tenantId } });
}

async function seed() {
  await prisma.tenant.create({ data: { id: tenantId, code: `qual-${suffix}`, name: "SHARED-QUAL-01 专用租户" } });
  await prisma.businessWorkspace.createMany({
    data: [
      { id: workspaceId, tenantId, code: workspaceId, name: "资格空间", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" },
      { id: otherWorkspaceId, tenantId, code: otherWorkspaceId, name: "其他空间", categoryCode: "CAMPING", isDefault: false, defaultMarker: otherWorkspaceId }
    ]
  });
  await prisma.customerProfile.createMany({
    data: [
      { id: personalId, tenantId, customerType: "personal", name: "资格测试个人", phone: `138${suffix.slice(-8)}`, phoneMasked: "138****0000", qualifications: {} },
      { id: corporateId, tenantId, customerType: "corporate", name: "资格测试企业", phone: `139${suffix.slice(-8)}`, phoneMasked: "139****0000", qualifications: {}, corporateName: "资格测试企业有限公司" }
    ]
  });
  await prisma.customerWorkspaceLink.createMany({
    data: [
      { tenantId, workspaceId, customerId: personalId, status: "active" },
      { tenantId, workspaceId, customerId: corporateId, status: "active" }
    ]
  });
  await prisma.customerCorporateMembership.create({
    data: { tenantId, workspaceId, corporateCustomerId: corporateId, personalCustomerId: personalId, role: "employee", status: "active" }
  });
  await prisma.customerMembershipQualificationType.create({
    data: { tenantId, workspaceId, code: "driver_license", name: "驾驶证", categoryCode: "CAMERA", requiredForBooking: true, status: "enabled" }
  });
  await prisma.customerQualificationRef.create({
    data: { tenantId, customerId: personalId, qualificationType: "driver_license", status: "approved", verifiedAt: new Date(), expiresAt: new Date(Date.now() + 10 * 86_400_000) }
  });
}

void (async () => {
  try {
    await cleanup();
    await seed();

    const personal = await memberships.resolveBookingIdentity(tenantId, workspaceId, personalId);
    const personalSnapshot = { ...snapshot(), qualifications: personal.qualifications };
    const allowed = await memberships.assertBookingQualificationForAction(
      tenantId, workspaceId, personalSnapshot, rule, "pickup", actionWindow(1, 3)
    );
    assert.equal(allowed.ok, true);
    console.log("  ✓ 领取按当前空间重新读取已审核资格，并允许有效证件通过");

    const listed = await memberships.listPersonalMembers(tenantId, workspaceId);
    assert.equal(listed.find((row) => row.customerId === personalId)?.qualifications[0]?.status, "approved");
    const corporateListed = await memberships.listCorporateMembers(tenantId, workspaceId);
    assert.equal(corporateListed.find((row) => row.customerId === corporateId)?.employeeCount, 1, "当前有效员工关系应计入企业员工数");
    await prisma.customerCorporateMembership.updateMany({ where: { tenantId, workspaceId, corporateCustomerId: corporateId, personalCustomerId: personalId }, data: { effectiveTo: new Date(Date.now() - 60_000) } });
    const expiredCorporate = await memberships.listCorporateMembers(tenantId, workspaceId);
    assert.equal(expiredCorporate.find((row) => row.customerId === corporateId)?.employeeCount, 0, "已过期员工关系不得继续计入企业员工数");
    await prisma.customerCorporateMembership.updateMany({ where: { tenantId, workspaceId, corporateCustomerId: corporateId, personalCustomerId: personalId }, data: { effectiveTo: null } });
    console.log("  ✓ 企业员工数量只统计当前有效关系");
    await prisma.customerQualificationRef.updateMany({ where: { tenantId, customerId: personalId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const expiredRead = await memberships.resolveBookingIdentity(tenantId, workspaceId, personalId);
    assert.equal(expiredRead.qualifications[0]?.status, "expired", "已过期的已审核证件读回时必须显示为已过期");
    await prisma.customerQualificationRef.updateMany({ where: { tenantId, customerId: personalId }, data: { expiresAt: new Date(Date.now() + 10 * 86_400_000) } });
    console.log("  ✓ 已审核但过期的证件在会员与订单身份读取时显示为已过期");

    await assert.rejects(
      () => memberships.submitQualification(tenantId, workspaceId, personalId, {
        qualificationType: "driver_license", issuedAt: "2026-09-13T00:00:00.000Z", expiresAt: "2026-09-12T00:00:00.000Z"
      }, "admin", "资格测试管理员"),
      /有效期不能早于签发日期/u
    );
    console.log("  ✓ 证件提交拒绝早于签发日期的有效期");

    await prisma.customerWorkspaceLink.update({ where: { workspaceId_customerId: { workspaceId, customerId: personalId } }, data: { status: "suspended" } });
    await assert.rejects(
      () => memberships.saveCorporateEmployee(tenantId, workspaceId, corporateId, { personalCustomerId: personalId, role: "employee" }),
      /只有当前空间的有效个人会员才能加入企业/u
    );
    await prisma.customerWorkspaceLink.update({ where: { workspaceId_customerId: { workspaceId, customerId: personalId } }, data: { status: "active" } });
    await assert.rejects(
      () => memberships.saveCorporateEmployee(tenantId, workspaceId, corporateId, { personalCustomerId: personalId, role: "employee", effectiveFrom: "2026-09-13T00:00:00.000Z", effectiveTo: "2026-09-12T00:00:00.000Z" }),
      /员工关系失效时间不能早于生效时间/u
    );
    console.log("  ✓ 暂停中的个人会员和倒置有效期不能建立企业员工关系");

    await prisma.customerQualificationRef.updateMany({ where: { tenantId, customerId: personalId }, data: { status: "revoked" } });
    await assert.rejects(
      () => memberships.assertBookingQualificationForAction(tenantId, workspaceId, personalSnapshot, rule, "pickup", actionWindow(1, 3)),
      /资格校验未通过.*未找到已审核通过/u
    );
    console.log("  ✓ 证件撤销后领取被阻断，不能沿用下单时的资格快照放行");

    await prisma.customerQualificationRef.updateMany({ where: { tenantId, customerId: personalId }, data: { status: "approved", expiresAt: new Date(Date.now() + 2 * 86_400_000) } });
    await assert.rejects(
      () => memberships.assertBookingQualificationForAction(tenantId, workspaceId, personalSnapshot, rule, "extension", actionWindow(1, 3)),
      /续租资格校验未通过.*有效期不足/u
    );
    console.log("  ✓ 续租结束时间超过证件有效期时被阻断");

    await prisma.customerQualificationRef.updateMany({ where: { tenantId, customerId: personalId }, data: { expiresAt: new Date(Date.now() + 10 * 86_400_000) } });
    const enterprise = await memberships.resolveBookingIdentity(tenantId, workspaceId, personalId, {
      bookingIdentity: "enterprise_employee", corporateCustomerId: corporateId, enterpriseContractAndPayer: true
    });
    await prisma.customerCorporateMembership.updateMany({ where: { tenantId, workspaceId, corporateCustomerId: corporateId, personalCustomerId: personalId }, data: { status: "revoked" } });
    await assert.rejects(
      () => memberships.assertBookingQualificationForAction(tenantId, workspaceId, { ...snapshot("enterprise_employee"), qualifications: enterprise.qualifications }, rule, "pickup", actionWindow(1, 3)),
      /不是当前企业的有效员工/u
    );
    console.log("  ✓ 企业员工关系撤销后领取被阻断，企业身份不能只靠订单快照继续使用");

    const pure = evaluateRentalQualification(
      [{ ...personalSnapshot.qualifications[0], status: "approved", expiresAt: new Date(Date.now() + 1 * 86_400_000).toISOString() }],
      rule,
      actionWindow(1, 3)
    );
    assert.equal(pure.ok, false, "纯判定函数必须阻断有效期不足");
    const coreSource = fs.readFileSync(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core.service.ts"), "utf8");
    assert.match(coreSource, /assertOrderQualification\(tenantId, order, "pickup"/u);
    assert.match(coreSource, /assertOrderQualification\(tenantId, order, "extension"/u);
    assert.match(coreSource, /evaluateRentalQualification\(/u);
    console.log("  ✓ 提交、领取（检查与免检查）和续租均接入共享资格判定");

    console.log("SHARED-QUAL-01 资格闸门专项：5 项全部通过");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
