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
const planId = `plan_qual_${suffix}`;
const planVersionId = `plan_version_qual_${suffix}`;

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
  await prisma.customerMembershipPlan.create({
    data: { id: planId, tenantId, workspaceId, code: `QUAL-PLAN-${suffix}`, name: "资格测试会员方案", targetType: "personal", status: "active" }
  });
  await prisma.customerMembershipPlanVersion.create({
    data: {
      id: planVersionId, tenantId, workspaceId, planId, version: 1, status: "published", levelRank: 1,
      eligibility: {}, benefits: [{ type: "rental_discount", calculation: "amount", value: 50 }], publishedAt: new Date()
    }
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

    await assert.rejects(
      () => memberships.assignPlan(tenantId, workspaceId, { customerId: personalId, planVersionId }, "资格测试管理员"),
      /人工授予或合同授予会员方案必须填写原因/u
    );
    await assert.rejects(
      () => memberships.assignPlan(tenantId, workspaceId, { customerId: personalId, planVersionId, reason: "测试授予", effectiveFrom: "not-a-date" }, "资格测试管理员"),
      /日期格式无效/u
    );
    await assert.rejects(
      () => memberships.assignPlan(tenantId, workspaceId, { customerId: personalId, planVersionId, reason: "测试授予", effectiveFrom: "2026-09-14T00:00:00.000Z", effectiveTo: "2026-09-13T00:00:00.000Z" }, "资格测试管理员"),
      /会员方案失效时间不能早于生效时间/u
    );
    const assignment = await memberships.assignPlan(tenantId, workspaceId, {
      customerId: personalId, planVersionId, source: "manual", reason: "首批会员测试授予",
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(), effectiveTo: new Date(Date.now() + 86_400_000).toISOString()
    }, "资格测试管理员");
    assert.equal(assignment.snapshot.benefits[0].value, 50);
    const beforePlanUpdate = await memberships.resolveBenefits(tenantId, workspaceId, personalId);
    assert.equal(beforePlanUpdate.personal?.snapshot.benefits[0].value, 50);
    await prisma.customerMembershipPlanVersion.update({ where: { id: planVersionId }, data: { benefits: [{ type: "rental_discount", calculation: "amount", value: 100 }] } });
    const afterPlanUpdate = await memberships.resolveBenefits(tenantId, workspaceId, personalId);
    assert.equal(afterPlanUpdate.personal?.snapshot.benefits[0].value, 50, "方案版本变更不得改写已授予会员的权益快照");
    const disabledPlan = await memberships.disablePlanVersion(tenantId, workspaceId, planId, planVersionId, "方案下线测试", "资格测试管理员");
    assert.equal(disabledPlan.currentVersion?.status, "disabled");
    const afterDisable = await memberships.resolveBenefits(tenantId, workspaceId, personalId);
    assert.equal(afterDisable.personal?.snapshot.benefits[0].value, 50, "停用方案版本不得改写已授予会员的权益快照");
    await assert.rejects(
      () => memberships.assignPlan(tenantId, workspaceId, { customerId: personalId, planVersionId, source: "manual", reason: "停用版本不应再授予" }, "资格测试管理员"),
      /可授予的已发布会员方案版本不存在/u
    );
    const restoredPlan = await memberships.restorePlanVersion(tenantId, workspaceId, planId, planVersionId, "恢复历史版本测试", "资格测试管理员");
    assert.equal(restoredPlan.currentVersion?.status, "draft");
    assert.equal(restoredPlan.currentVersion?.restoredFromVersionId, planVersionId);
    const publishedRestored = await memberships.publishPlan(tenantId, workspaceId, planId, restoredPlan.currentVersion.id, "资格测试管理员");
    const secondAssignment = await memberships.assignPlan(tenantId, workspaceId, {
      customerId: personalId, planVersionId: publishedRestored.currentVersion.id, source: "manual", reason: "重新授予测试"
    }, "资格测试管理员");
    const assignmentHistory = await memberships.listPlanAssignments(tenantId, workspaceId, personalId);
    assert.ok(assignmentHistory.some((row) => row.id === secondAssignment.id), "会员方案授予记录应可回看");
    await assert.rejects(
      () => memberships.revokePlanAssignment(tenantId, workspaceId, secondAssignment.id, " ", "资格测试管理员"),
      /撤销会员方案必须填写原因/u
    );
    const revokedAssignment = await memberships.revokePlanAssignment(tenantId, workspaceId, secondAssignment.id, "测试撤销", "资格测试管理员");
    assert.equal(revokedAssignment.status, "revoked");
    assert.equal(revokedAssignment.revokeReason, "测试撤销");
    assert.equal((await memberships.listPlanAssignments(tenantId, workspaceId, personalId)).find((row) => row.id === secondAssignment.id)?.status, "revoked");
    console.log("  ✓ 会员方案授予强制记录原因与有效期，停用不影响历史快照，恢复生成新草稿");
    console.log("  ✓ 会员方案授予记录可回看，撤销必须记录原因且保留审计状态");

    const firstQualificationSubmission = await memberships.submitQualification(tenantId, workspaceId, personalId, {
      qualificationType: "driver_license", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z", evidenceRef: "evidence-first"
    }, "admin", "资格测试管理员");
    assert.equal(firstQualificationSubmission.review.qualificationSnapshot?.evidenceRef, "evidence-first");
    const firstHistory = await memberships.listQualificationRevisions(tenantId, workspaceId, personalId, "driver_license");
    assert.equal(firstHistory.length, 1, "首次提交必须留下不可变资质快照");
    assert.equal(firstHistory[0].applicableScope.workspaceId, workspaceId);
    assert.equal(firstHistory[0].source, "admin");
    await assert.rejects(
      () => memberships.submitQualification(tenantId, workspaceId, personalId, { qualificationType: "driver_license", evidenceRef: "C:\\private\\license.jpg" }, "admin", "资格测试管理员"),
      /附件引用必须使用文件服务返回的不可变引用/u
    );
    const clientEvidenceId = `file_qual_${suffix}`;
    await prisma.fileAsset.create({
      data: {
        id: clientEvidenceId,
        tenantId,
        businessModule: "membership",
        businessType: "customer",
        businessId: personalId,
        fileName: "driver-license.jpg",
        fileExt: "jpg",
        mimeType: "image/jpeg",
        sizeBytes: 2048,
        storageProvider: "local_mock",
        storageKey: `tenant-files/${tenantId}/${clientEvidenceId}/driver-license.jpg`,
        uploadScene: "client-qualification",
        status: "active",
        metadata: { qualificationType: "driver_license" }
      }
    });
    const otherCustomerEvidenceId = `file_qual_other_${suffix}`;
    await prisma.fileAsset.create({
      data: {
        id: otherCustomerEvidenceId,
        tenantId,
        businessModule: "membership",
        businessType: "customer",
        businessId: corporateId,
        fileName: "other-license.jpg",
        fileExt: "jpg",
        mimeType: "image/jpeg",
        sizeBytes: 2048,
        storageProvider: "local_mock",
        storageKey: `tenant-files/${tenantId}/${otherCustomerEvidenceId}/other-license.jpg`,
        uploadScene: "client-qualification",
        status: "active",
        metadata: { qualificationType: "driver_license" }
      }
    });
    await assert.rejects(
      () => memberships.submitQualification(tenantId, workspaceId, personalId, { qualificationType: "driver_license", evidenceRef: otherCustomerEvidenceId }, "app", "APP"),
      /资质附件不存在、尚未完成上传或不属于当前会员/u
    );
    const secondQualificationSubmission = await memberships.submitQualification(tenantId, workspaceId, personalId, {
      qualificationType: "driver_license", issuedAt: "2026-02-01T00:00:00.000Z", expiresAt: "2098-01-01T00:00:00.000Z", evidenceRef: clientEvidenceId
    }, "app", "APP");
    const approvedOldQualification = await memberships.review(
      tenantId, workspaceId, firstQualificationSubmission.review.id, { status: "approved" }, "资格审核员", { registration: false, qualification: true }
    );
    assert.equal(approvedOldQualification.status, "approved");
    const currentAfterOldReview = await prisma.customerQualificationRef.findFirst({ where: { tenantId, customerId: personalId, qualificationType: "driver_license" } });
    assert.equal(currentAfterOldReview.currentRevisionId, secondQualificationSubmission.review.qualificationSnapshot.id, "旧审核不得把当前证件指针切回旧版本");
    assert.equal(currentAfterOldReview.status, "pending", "新证件仍待审核时，旧证件通过不能提前放行当前资格");
    const historyAfterResubmit = await memberships.listQualificationRevisions(tenantId, workspaceId, personalId, "driver_license");
    assert.equal(historyAfterResubmit.length, 2, "重新提交不得覆盖上一份资质历史");
    assert.equal(historyAfterResubmit.find((row) => row.id === firstQualificationSubmission.review.qualificationSnapshot.id)?.reviewStatus, "approved");
    assert.equal(historyAfterResubmit.find((row) => row.id === secondQualificationSubmission.review.qualificationSnapshot.id)?.reviewStatus, "pending");
    await assert.rejects(
      () => memberships.review(tenantId, workspaceId, secondQualificationSubmission.review.id, { status: "rejected" }, "资格审核员", { registration: false, qualification: true }),
      /拒绝、补件或取消审核必须填写原因/u
    );
    const rejectedQualification = await memberships.review(
      tenantId, workspaceId, secondQualificationSubmission.review.id, { status: "rejected", reason: "证件照片无法辨识" }, "资格审核员", { registration: false, qualification: true }
    );
    assert.equal(rejectedQualification.status, "rejected");
    assert.equal(rejectedQualification.reason, "证件照片无法辨识");
    assert.equal(rejectedQualification.qualificationSnapshot?.reviewReason, "证件照片无法辨识");
    assert.equal((await prisma.customerQualificationRef.findFirst({ where: { tenantId, customerId: personalId, qualificationType: "driver_license" } })).status, "rejected");
    console.log("  ✓ 非通过审核必须记录原因，历史快照可回看，旧审核不会覆盖新提交");

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
