const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * CUSTOMER-01A 专项：客户主档数据模型的**库层**不变量。
 *
 * 为什么直连真库而不是用替身：本阶段交付的是数据模型，它的价值全部落在
 * 唯一约束与复合外键上。服务层可以被绕过（后台脚本、别的服务、将来的批处理），
 * 因此「同租户手机号唯一」「禁止跨租户挂接」「禁止跨租户合并」必须由数据库拒绝，
 * 而不是只靠应用层校验。用 Prisma 替身测这些等于什么都没测。
 *
 * 本测试自建租户与空间，跑完只删除自己创建的那两个租户，不清库、不动既有数据。
 */

const ROOT = path.resolve(__dirname, "..");
const envPath = path.join(ROOT, ".env");
const env = Object.fromEntries(
  fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);

// 安全闸：本套件只允许跑在专用库上。指到共享开发库会被直接拒绝——
// 它会创建并删除租户，跑错库等于破坏别人的数据。
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
const dbName = new URL(databaseUrl).pathname.slice(1);
if (!/claude/.test(dbName)) {
  console.error(`拒绝执行：CUSTOMER 专项测试只能跑在专用库上，当前 DATABASE_URL 指向 ${dbName}`);
  process.exit(1);
}

process.env.DATABASE_URL = databaseUrl;
const { PrismaClient, Prisma } = require(path.join(ROOT, "node_modules", "@prisma", "client"));

const suffix = Date.now().toString(36);
const tenantAId = `t_cust_a_${suffix}`;
const tenantBId = `t_cust_b_${suffix}`;

/** 断言写入被**数据库**拒绝，并区分唯一键冲突与外键冲突。 */
async function rejectsWith(promise, expectedCodes, label) {
  try {
    await promise;
  } catch (error) {
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;
    assert.ok(
      expectedCodes.includes(code),
      `${label}：期望 ${expectedCodes.join("/")}，实际 ${code ?? error.constructor.name} - ${String(error.message).slice(0, 160)}`
    );
    return;
  }
  assert.fail(`${label}：数据库应当拒绝这次写入，但它成功了`);
}

const ok = (message) => console.log(`  ✓ ${message}`);

let prisma = new PrismaClient();

async function seedTenants() {
  for (const [id, code] of [[tenantAId, `cust-a-${suffix}`], [tenantBId, `cust-b-${suffix}`]]) {
    await prisma.tenant.create({ data: { id, code, name: `CUSTOMER-01A 测试租户 ${code}` } });
  }
  // 租户 A 两个空间（不同品类），用于验证「主档与唯一会员均按租户共享」。
  const workspaces = [
    { id: `ws_a1_${suffix}`, tenantId: tenantAId, code: `a1-${suffix}`, categoryCode: "CAMERA" },
    { id: `ws_a2_${suffix}`, tenantId: tenantAId, code: `a2-${suffix}`, categoryCode: "CAMPING" },
    { id: `ws_b1_${suffix}`, tenantId: tenantBId, code: `b1-${suffix}`, categoryCode: "CAMERA" }
  ];
  for (const ws of workspaces) {
    await prisma.businessWorkspace.create({
      data: { ...ws, name: `空间 ${ws.code}`, isDefault: false, defaultMarker: ws.id }
    });
  }
  return workspaces;
}

async function cleanup() {
  // 只删自己建的两个租户；级联会带走本测试创建的空间、主档与全部客户子表。
  await prisma.customerMembershipReview.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
}

void (async () => {
  await cleanup();
  const [wsA1, wsA2, wsB1] = await seedTenants();

  // ============ 1. 租户级共享主档：同租户手机号唯一 ============
  const personal = await prisma.customerProfile.create({
    data: {
      tenantId: tenantAId, customerType: "personal", name: "张三",
      phone: "13800001111", phoneMasked: "138****1111", qualifications: {}
    }
  });
  await rejectsWith(
    prisma.customerProfile.create({
      data: {
        tenantId: tenantAId, customerType: "personal", name: "张三重复",
        phone: "13800001111", phoneMasked: "138****1111", qualifications: {}
      }
    }),
    ["P2002"],
    "同租户同手机号建第二份主档"
  );
  // 另一个租户可以有同号客户——主档在租户内共享，不跨租户共享。
  const otherTenantSamePhone = await prisma.customerProfile.create({
    data: {
      tenantId: tenantBId, customerType: "personal", name: "另一租户的张三",
      phone: "13800001111", phoneMasked: "138****1111", qualifications: {}
    }
  });
  assert.notEqual(otherTenantSamePhone.id, personal.id, "两个租户的同号客户必须是两份独立主档");
  ok("租户级共享主档：同租户手机号唯一（库层拒绝重复），跨租户同号各自独立");

  // ============ 2. 同租户共享唯一会员，状态和等级不再属于空间 ============
  const membership = await prisma.customerMembership.create({
    data: { tenantId: tenantAId, customerId: personal.id, levelName: "黄金会员", status: "active" }
  });
  const profileWithMembership = await prisma.customerProfile.findUnique({ where: { id: personal.id }, include: { membership: true } });
  assert.equal(profileWithMembership.membership.id, membership.id, "Profile.membership 必须是单个会员，不是空间关系数组");
  assert.equal("workspaceId" in membership, false, "会员实体不再持有空间归属");
  await rejectsWith(
    prisma.customerMembership.create({ data: { tenantId: tenantAId, customerId: personal.id, levelName: "另一空间的等级" } }),
    ["P2002"],
    "同租户同客户不能以切换空间为由创建第二份会员"
  );
  for (const status of ["pending_activation", "active", "suspended", "risk_restricted", "exited", "closed"]) {
    await prisma.customerMembership.update({ where: { tenantId_customerId: { tenantId: tenantAId, customerId: personal.id } }, data: { status } });
    const read = await prisma.customerMembership.findUnique({ where: { tenantId_customerId: { tenantId: tenantAId, customerId: personal.id } } });
    assert.equal(read.id, membership.id);
    assert.equal(read.status, status, `租户会员状态 ${status} 必须可存储`);
    assert.equal(read.levelName, "黄金会员");
  }
  await prisma.customerMembership.update({ where: { id: membership.id }, data: { status: "active" } });
  const otherMembership = await prisma.customerMembership.create({ data: { tenantId: tenantBId, customerId: otherTenantSamePhone.id } });
  assert.notEqual(otherMembership.id, membership.id, "不同租户同手机号的会员仍独立");
  ok("租户唯一会员：单个 Profile.membership、六态与统一等级，同租户同客户重复建会员被库层拒绝");

  // ============ 3. 禁止跨租户会员关联，业务来源空间仍受复合外键保护 ============
  await rejectsWith(
    prisma.customerMembership.create({ data: { tenantId: tenantAId, customerId: otherTenantSamePhone.id } }),
    ["P2003"],
    "把 B 租户客户冒充为 A 租户会员"
  );
  await rejectsWith(
    prisma.customerMembership.create({ data: { tenantId: tenantBId, customerId: personal.id } }),
    ["P2003"],
    "伪造 tenantId 把 A 客户挂到 B 租户"
  );
  await rejectsWith(
    prisma.customerMembershipReview.create({ data: { tenantId: tenantAId, sourceWorkspaceId: wsB1.id, customerId: personal.id, reviewType: "registration", channel: "admin" } }),
    ["P2003"],
    "共享审核也不能引用外租户来源空间"
  );
  ok("跨租户隔离：会员双向伪造租户与跨租户审核来源都被库层拒绝");

  // ============ 4. 客户账号：与主档 1:1，登录标识租户内唯一 ============
  const account = await prisma.customerAccount.create({
    data: {
      tenantId: tenantAId, customerId: personal.id,
      loginPhone: "13800001111", loginPhoneMasked: "138****1111", status: "active"
    }
  });
  await rejectsWith(
    prisma.customerAccount.create({
      data: { tenantId: tenantAId, customerId: personal.id, loginPhone: "13800002222", loginPhoneMasked: "138****2222" }
    }),
    ["P2002"],
    "同一客户建第二个账号"
  );
  const secondCustomer = await prisma.customerProfile.create({
    data: {
      tenantId: tenantAId, customerType: "personal", name: "李四",
      phone: "13800003333", phoneMasked: "138****3333", qualifications: {}
    }
  });
  await rejectsWith(
    prisma.customerAccount.create({
      data: { tenantId: tenantAId, customerId: secondCustomer.id, loginPhone: "13800001111", loginPhoneMasked: "138****1111" }
    }),
    ["P2002"],
    "两个客户用同一个登录手机号"
  );
  // 账号与租户会员各有状态：任一状态变更不得改写另一行。
  await prisma.customerAccount.update({
    where: { id: account.id },
    data: { status: "suspended", suspendedAt: new Date(), lastReason: "风控停用", lastOperator: "tester" }
  });
  const membershipAfterAccountSuspend = await prisma.customerMembership.findUnique({ where: { tenantId_customerId: { tenantId: tenantAId, customerId: personal.id } } });
  assert.equal(membershipAfterAccountSuspend.id, membership.id, "停账号不得删除或另建会员");
  assert.equal(membershipAfterAccountSuspend.status, "active", "停账号不得改写租户会员状态");
  await prisma.customerMembership.update({ where: { id: membership.id }, data: { status: "risk_restricted" } });
  assert.equal((await prisma.customerAccount.findUnique({ where: { id: account.id } })).status, "suspended", "会员状态变化也不得改写账号状态");
  ok("客户账号：与主档 1:1、登录号租户内唯一，账号与租户会员状态互不改写");

  // ============ 5. 企业客户：资料结构分开，统一社会信用代码租户内唯一 ============
  const corporate = await prisma.customerProfile.create({
    data: {
      tenantId: tenantAId, customerType: "corporate", name: "示例影视公司",
      phone: "13900001111", phoneMasked: "139****1111", qualifications: {},
      corporateName: "示例影视有限公司"
    }
  });
  await prisma.customerCorporateProfile.create({
    data: {
      tenantId: tenantAId, customerId: corporate.id, legalName: "示例影视有限公司",
      unifiedSocialCreditCode: "91310000EXAMPLE01", unifiedSocialCreditCodeMasked: "9131****LE01",
      legalRepName: "王五"
    }
  });
  await rejectsWith(
    prisma.customerCorporateProfile.create({
      data: {
        tenantId: tenantAId, customerId: corporate.id, legalName: "重复企业资料",
        unifiedSocialCreditCode: "91310000EXAMPLE02", unifiedSocialCreditCodeMasked: "9131****LE02"
      }
    }),
    ["P2002"],
    "同一客户建第二份企业资料"
  );
  const corporateTwo = await prisma.customerProfile.create({
    data: {
      tenantId: tenantAId, customerType: "corporate", name: "另一家公司",
      phone: "13900002222", phoneMasked: "139****2222", qualifications: {}
    }
  });
  await rejectsWith(
    prisma.customerCorporateProfile.create({
      data: {
        tenantId: tenantAId, customerId: corporateTwo.id, legalName: "冒用同一信用代码",
        unifiedSocialCreditCode: "91310000EXAMPLE01", unifiedSocialCreditCodeMasked: "9131****LE01"
      }
    }),
    ["P2002"],
    "同租户两家企业用同一统一社会信用代码"
  );
  // 跨租户允许同一信用代码：唯一性是租户内的，跨租户各自独立。
  const corporateInB = await prisma.customerProfile.create({
    data: {
      tenantId: tenantBId, customerType: "corporate", name: "B 租户同代码公司",
      phone: "13900003333", phoneMasked: "139****3333", qualifications: {}
    }
  });
  const corpB = await prisma.customerCorporateProfile.create({
    data: {
      tenantId: tenantBId, customerId: corporateInB.id, legalName: "B 租户同代码公司",
      unifiedSocialCreditCode: "91310000EXAMPLE01", unifiedSocialCreditCodeMasked: "9131****LE01"
    }
  });
  assert.equal(corpB.tenantId, tenantBId, "跨租户同一信用代码必须各自独立存在");
  ok("企业客户：企业资料与主档 1:1、信用代码租户内唯一、跨租户可各自持有同一代码");

  // ============ 6. 联系人与经办人：两种不同的关系 ============
  await prisma.customerContact.create({
    data: {
      tenantId: tenantAId, customerId: personal.id, kind: "emergency", name: "张三的家属",
      phone: "13700001111", phoneMasked: "137****1111", relation: "配偶", isPrimary: true
    }
  });
  // 企业联系人可以同时是本租户的个人客户（需求 4.8.4），用 linkedCustomerId 关联，
  // 但那不代表他就是责任主体——责任主体在订单上单独保存（CUSTOMER-01C）。
  await prisma.customerContact.create({
    data: {
      tenantId: tenantAId, customerId: corporate.id, kind: "corporate", name: "李四",
      phone: "13800003333", phoneMasked: "138****3333", linkedCustomerId: secondCustomer.id, isPrimary: true
    }
  });
  const agent = await prisma.customerAuthorizedAgent.create({
    data: {
      tenantId: tenantAId, customerId: corporate.id, agentName: "李四",
      agentPhone: "13800003333", agentPhoneMasked: "138****3333",
      authorityScope: { canOrder: true, canSign: true, canPay: false, canHandover: true },
      validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: new Date("2026-12-31T23:59:59.000Z")
    }
  });
  assert.equal(agent.authorityScope.canPay, false, "授权范围必须结构化保存，便于按动作校验");
  assert.ok(agent.validTo, "经办人授权必须有有效期，否则事后无法判断当时是否有效");
  const corporateWithRelations = await prisma.customerProfile.findUnique({
    where: { id: corporate.id },
    include: { contacts: true, authorizedAgents: true, corporateProfile: true }
  });
  assert.equal(corporateWithRelations.contacts.length, 1);
  assert.equal(corporateWithRelations.authorizedAgents.length, 1);
  assert.ok(corporateWithRelations.corporateProfile, "企业主档必须能带出企业资料");
  assert.equal(
    corporateWithRelations.contacts[0].linkedCustomerId,
    secondCustomer.id,
    "企业联系人可关联到其本人的个人主档"
  );
  ok("联系人与经办人：紧急联系人/企业联系人共用一表并可关联个人主档，经办人带结构化授权范围与有效期");

  // ============ 7. 资质引用：同类型每客户一条，且只存脱敏引用 ============
  await prisma.customerQualificationRef.create({
    data: {
      tenantId: tenantAId, customerId: personal.id, qualificationType: "driver_license",
      referenceNoMasked: "3101****5678", status: "approved", verifiedAt: new Date()
    }
  });
  await rejectsWith(
    prisma.customerQualificationRef.create({
      data: { tenantId: tenantAId, customerId: personal.id, qualificationType: "driver_license", status: "pending" }
    }),
    ["P2002"],
    "同一客户同一资质类型建第二条引用"
  );
  // 六态取值域（需求 4.8.5）必须都能存。
  const qualRow = await prisma.customerQualificationRef.findFirst({
    where: { tenantId: tenantAId, customerId: personal.id, qualificationType: "driver_license" }
  });
  for (const status of ["not_submitted", "pending", "approved", "rejected", "expired", "revoked"]) {
    await prisma.customerQualificationRef.update({ where: { id: qualRow.id }, data: { status } });
    const read = await prisma.customerQualificationRef.findUnique({ where: { id: qualRow.id } });
    assert.equal(read.status, status, `资质状态 ${status} 必须可存储`);
  }
  ok("资质引用：同客户同类型唯一、六态可存储、只保存脱敏号码与证据引用（适用性判定不在本表）");

  // ============ 8. 合并映射：一次性、且禁止跨租户 ============
  const mergeSource = await prisma.customerProfile.create({
    data: {
      tenantId: tenantAId, customerType: "personal", name: "重复的张三",
      phone: "13800009999", phoneMasked: "138****9999", qualifications: {}
    }
  });
  await prisma.customerMergeMapping.create({
    data: {
      tenantId: tenantAId, sourceCustomerId: mergeSource.id, targetCustomerId: personal.id,
      reason: "同一人重复注册", operator: "tester", approver: "manager",
      fieldDiff: { phone: { kept: "13800001111", dropped: "13800009999" } },
      membershipSnapshot: { [wsA1.id]: { levelName: "黄金会员" } },
      mergedAt: new Date()
    }
  });
  await rejectsWith(
    prisma.customerMergeMapping.create({
      data: {
        tenantId: tenantAId, sourceCustomerId: mergeSource.id, targetCustomerId: secondCustomer.id,
        reason: "二次合并", mergedAt: new Date()
      }
    }),
    ["P2002"],
    "同一份主档被合并两次"
  );
  // 跨租户合并必须被**库层**拒绝：源在 A、目标在 B。
  await rejectsWith(
    prisma.customerMergeMapping.create({
      data: {
        tenantId: tenantAId, sourceCustomerId: secondCustomer.id,
        targetCustomerId: otherTenantSamePhone.id, reason: "跨租户合并", mergedAt: new Date()
      }
    }),
    ["P2003"],
    "跨租户合并（目标主档属另一租户）"
  );
  await rejectsWith(
    prisma.customerMergeMapping.create({
      data: {
        tenantId: tenantBId, sourceCustomerId: otherTenantSamePhone.id,
        targetCustomerId: personal.id, reason: "反向跨租户合并", mergedAt: new Date()
      }
    }),
    ["P2003"],
    "反向跨租户合并（目标主档属 A 租户）"
  );
  ok("合并映射：一份主档只能被合并一次，正反两个方向的跨租户合并都被库层拒绝");

  // ============ 9. 账号与统一会员事件共享时间线，旧空间事件原样保留 ============
  const now = Date.now();
  await prisma.customerStatusHistoryEntry.createMany({
    data: [
      {
        tenantId: tenantAId, customerId: personal.id, scope: "workspace", workspaceId: wsA2.id,
        action: "suspend", fromStatus: "active", toStatus: "suspended",
        reason: "逾期未归还", operator: "op1", at: new Date(now - 3000)
      },
      {
        tenantId: tenantAId, customerId: personal.id, scope: "account",
        action: "suspend", fromStatus: "active", toStatus: "suspended",
        reason: "风控停用账号", operator: "op2", at: new Date(now - 2000)
      },
      {
        tenantId: tenantAId, customerId: personal.id, scope: "workspace", workspaceId: wsA2.id,
        action: "release", fromStatus: "suspended", toStatus: "active",
        reason: "已归还并结清", operator: "op1", approver: "manager", at: new Date(now - 1000)
      }
    ]
  });
  await prisma.customerStatusHistoryEntry.createMany({ data: [
    { tenantId: tenantAId, customerId: personal.id, scope: "membership", action: "suspend", fromStatus: "active", toStatus: "suspended", reason: "租户会员暂停", operator: "op1", at: new Date(now) },
    { tenantId: tenantAId, customerId: personal.id, scope: "membership", action: "release", fromStatus: "suspended", toStatus: "active", reason: "租户会员恢复", operator: "op1", at: new Date(now + 1000) }
  ] });
  const timeline = await prisma.customerStatusHistoryEntry.findMany({
    where: { tenantId: tenantAId, customerId: personal.id }, orderBy: { at: "asc" }
  });
  assert.equal(timeline.length, 5, "新会员事件只追加，不覆盖旧空间与账号事件");
  assert.deepEqual(
    timeline.map((row) => `${row.scope}:${row.action}`),
    ["workspace:suspend", "account:suspend", "workspace:release", "membership:suspend", "membership:release"],
    "同一时间线必须还原旧空间事件与新租户统一会员事件"
  );
  assert.ok(timeline.filter((row) => row.scope === "membership").every((row) => row.workspaceId === null), "统一会员事件不能绑单一空间");
  // 解除限制是**独立记录**，原限制记录仍在（需求 4.8.6 末段）。
  assert.ok(
    timeline.some((row) => row.action === "suspend" && row.scope === "workspace"),
    "解除后原限制事实不得被删除或回改"
  );
  // 按空间筛选只应看到该空间的事件，账号级事件不属于任何单一空间。
  const wsTimeline = await prisma.customerStatusHistoryEntry.findMany({
    where: { tenantId: tenantAId, customerId: personal.id, workspaceId: wsA2.id }
  });
  assert.equal(wsTimeline.length, 2, "按空间筛选不得把账号级事件算进来");

  await prisma.customerRiskRecord.createMany({
    data: [
      {
        tenantId: tenantAId, customerId: personal.id, riskType: "overdue", level: "high",
        detail: "连续两单逾期", source: "system", status: "open", raisedAt: new Date(now - 5000)
      },
      {
        tenantId: tenantAId, customerId: personal.id, workspaceId: wsA1.id, riskType: "damage_dispute",
        level: "medium", detail: "镜头划痕争议", source: "manual", status: "reviewing",
        raisedBy: "op1", raisedAt: new Date(now - 4000)
      }
    ]
  });
  const risks = await prisma.customerRiskRecord.findMany({
    where: { tenantId: tenantAId, customerId: personal.id }, orderBy: { raisedAt: "asc" }
  });
  assert.equal(risks.length, 2, "同一客户可同时存在多条风险——压成一个布尔位就说不出因哪条被限制");
  assert.equal(risks[0].workspaceId, null, "租户级风险不绑定空间");
  assert.equal(risks[1].workspaceId, wsA1.id, "空间级风险必须绑定空间");
  ok("状态历史与风险：账号级/空间级共用时间线且可按空间筛选、解除为独立记录、多条风险并存");

  // ============ 10. 重启（重连）后数据仍在 ============
  await prisma.$disconnect();
  prisma = new PrismaClient();
  const reread = await prisma.customerProfile.findUnique({
    where: { id: personal.id },
    include: {
      account: true, contacts: true, qualificationRefs: true,
      statusHistory: true, riskRecords: true, membership: true, mergeAsTarget: true
    }
  });
  assert.ok(reread, "重连后主档必须仍在库中");
  assert.equal(reread.account.status, "suspended", "账号状态必须从库中读回");
  assert.equal(reread.membership.id, membership.id, "租户唯一会员必须仍在");
  assert.equal(reread.membership.status, "risk_restricted", "会员状态与账号状态各自持久化");
  assert.equal(reread.statusHistory.length, 5, "新旧状态历史必须仍在");
  assert.equal(reread.riskRecords.length, 2, "风险记录必须仍在");
  assert.equal(reread.qualificationRefs.length, 1, "资质引用必须仍在");
  assert.equal(reread.mergeAsTarget.length, 1, "作为保留主档的合并映射必须仍在");
  ok("持久化：断开重连后主档、账号、会员关系、状态历史、风险、资质与合并映射全部从库读回");

  await cleanup();
  await prisma.$disconnect();
  console.log("\nCUSTOMER-01A 客户主档数据模型用例全部通过");
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
