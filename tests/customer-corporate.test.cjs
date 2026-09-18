const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * CUSTOMER-01C 专项：企业资料（开票/合同/授信账期）与订单四类主体。
 *
 * 直连专用真库、用真实仓储装配服务：本阶段的判定几乎全是「这条记录属于谁」
 * （开票属付款主体、经办人属签约主体、合同属签约主体且在期内），
 * 这些依赖真实的 tenantId/customerId 过滤，替身证明不了。
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

const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const { SharedCustomerRepository } = require(path.join(ROOT, "apps/api/src/modules/platform/shared-customer.repository"));
const { CustomerCorporateService } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-corporate.service"));

const suffix = Date.now().toString(36);
const tenantA = `t_cp_a_${suffix}`;
const tenantB = `t_cp_b_${suffix}`;
const wsA = `ws_cp_a_${suffix}`;
const wsB = `ws_cp_b_${suffix}`;

let prisma = new PrismaClient();
let customers = new SharedCustomerRepository(prisma);
let service = new CustomerCorporateService(prisma, customers);

const ok = (m) => console.log(`  ✓ ${m}`);
const AT = "2026-06-15T10:00:00.000Z";

async function rejects(promise, pattern, label) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, pattern, `${label}：实际 ${error.message}`);
    return true;
  }, label);
}

async function cleanup() {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
}

async function seed() {
  for (const [id, code] of [[tenantA, `cp-a-${suffix}`], [tenantB, `cp-b-${suffix}`]]) {
    await prisma.tenant.create({ data: { id, code, name: `CUSTOMER-01C 测试租户 ${code}` } });
  }
  for (const [id, tenantId] of [[wsA, tenantA], [wsB, tenantB]]) {
    await prisma.businessWorkspace.create({
      data: { id, tenantId, code: id, name: `空间 ${id}`, categoryCode: "CAMERA", isDefault: false, defaultMarker: id }
    });
  }
}

void (async () => {
  await cleanup();
  await seed();

  // 企业签约主体、企业付款主体（总部）、个人使用人、个人经办人候选，全在租户 A。
  const corp = await customers.createWithMembership(tenantA, {
    customerType: "corporate", name: "示例影视", phone: "13900001111", corporateName: "示例影视有限公司"
  }, "普通会员");
  const hq = await customers.createWithMembership(tenantA, {
    customerType: "corporate", name: "示例集团总部", phone: "13900002222", corporateName: "示例集团有限公司"
  }, "普通会员");
  const driver = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "司机小张", phone: "13700001111"
  }, "普通会员");
  const personal = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "个人客户", phone: "13700002222"
  }, "普通会员");
  const otherTenantCorp = await customers.createWithMembership(tenantB, {
    customerType: "corporate", name: "B 租户公司", phone: "13900003333"
  }, "普通会员");

  // ============ 1. 企业资料只适用于企业客户 ============
  for (const [label, run] of [
    ["开票资料", () => service.saveInvoiceProfile(tenantA, personal.id, { invoiceType: "vat_normal", title: "个人", taxNo: "X" })],
    ["合同", () => service.saveContract(tenantA, personal.id, { contractNo: `C-${suffix}-P`, name: "个人合同", effectiveFrom: AT })],
    ["授信", () => service.saveCredit(tenantA, personal.id, { creditLimit: 100, settlementTermDays: 30 })]
  ]) {
    await rejects(run(), /只适用于企业客户/u, `为个人客户保存${label}`);
  }
  // 跨租户同样拒绝：不区分「不存在」与「属于别的租户」。
  await rejects(
    service.saveCredit(tenantA, otherTenantCorp.id, { creditLimit: 100, settlementTermDays: 30 }),
    /客户不存在/u,
    "用租户 A 的身份给租户 B 的企业设授信"
  );
  ok("企业资料边界：开票/合同/授信都只适用于企业客户，跨租户一律按「不存在」拒绝");

  // ============ 2. 开票资料：默认唯一，且切换默认在同一事务内完成 ============
  const inv1 = await service.saveInvoiceProfile(tenantA, corp.id, {
    invoiceType: "vat_special", title: "示例影视有限公司", taxNo: "91310000AAA",
    bankName: "示例银行", bankAccount: "6222020202020202", contactPhone: "13900001111", isDefault: true
  });
  assert.equal(inv1.isDefault, true);
  // 银行账号只存脱敏值：资金信息不该以明文留在业务库里。
  assert.ok(inv1.bankAccountMasked && !inv1.bankAccountMasked.includes("6222020202020202"), "银行账号必须脱敏");
  const rawInv = await prisma.customerCorporateInvoiceProfile.findUnique({ where: { id: inv1.id } });
  assert.equal(rawInv.bankAccountMasked.includes("0202"), true, "脱敏值保留尾号便于核对");
  assert.equal(Object.keys(rawInv).includes("bankAccount"), false, "库里不该有存明文账号的列");

  const inv1Edited = await service.saveInvoiceProfile(tenantA, corp.id, {
    id: inv1.id, expectedRevision: inv1.revision,
    invoiceType: inv1.invoiceType, title: "示例影视有限公司（更新）", taxNo: inv1.taxNo,
    bankName: inv1.bankName, isDefault: inv1.isDefault, status: inv1.status
  });
  assert.equal(inv1Edited.bankAccountMasked, inv1.bankAccountMasked, "编辑其他字段时留空银行账号必须保留原掩码");
  assert.equal(inv1Edited.contactPhoneMasked, inv1.contactPhoneMasked, "编辑其他字段时留空联系电话必须保留原掩码");
  const inv1Cleared = await service.saveInvoiceProfile(tenantA, corp.id, {
    id: inv1.id, expectedRevision: inv1Edited.revision,
    invoiceType: inv1.invoiceType, title: inv1Edited.title, taxNo: inv1.taxNo,
    bankName: inv1.bankName, isDefault: inv1.isDefault, status: inv1.status, clearContactPhone: true
  });
  assert.equal(inv1Cleared.bankAccountMasked, inv1.bankAccountMasked, "显式清除联系电话不得连带清除银行账号");
  assert.equal(inv1Cleared.contactPhoneMasked, undefined, "只有显式清除才删除已有联系电话掩码");
  await rejects(
    service.saveInvoiceProfile(tenantA, corp.id, {
      id: inv1.id, expectedRevision: inv1.revision,
      invoiceType: inv1.invoiceType, title: "用旧页面覆盖", taxNo: inv1.taxNo
    }),
    /已被其他人修改/u,
    "用过期版本覆盖开票资料"
  );

  const inv2 = await service.saveInvoiceProfile(tenantA, corp.id, {
    invoiceType: "vat_normal", title: "示例影视上海分公司", taxNo: "91310000BBB", isDefault: true
  });
  const invoices = await service.listInvoiceProfiles(tenantA, corp.id);
  assert.equal(invoices.length, 2, "一家企业可持有多份开票资料");
  assert.equal(invoices.filter((row) => row.isDefault).length, 1, "同企业至多一份默认开票资料");
  assert.equal(invoices.find((row) => row.isDefault).id, inv2.id, "新设的默认应生效，旧默认被降级");
  assert.equal(invoices[0].id, inv2.id, "列表默认项排在最前");
  ok("开票资料：可多份、默认唯一且切换时旧默认被降级、银行账号只存脱敏值");

  // ============ 3. 合同：编号唯一、有效期与终止原因校验 ============
  const activeContract = await service.saveContract(tenantA, corp.id, {
    contractNo: `C-${suffix}-1`, name: "2026 年度框架协议",
    effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: "2026-12-31T23:59:59.000Z", status: "active"
  });
  const editedContract = await service.saveContract(tenantA, corp.id, {
    id: activeContract.id, expectedRevision: activeContract.revision,
    contractNo: activeContract.contractNo, name: "2026 年度框架协议（修订名称）",
    effectiveFrom: activeContract.effectiveFrom, effectiveTo: activeContract.effectiveTo, status: activeContract.status
  });
  assert.equal(editedContract.name.includes("修订名称"), true);
  await rejects(
    service.saveContract(tenantA, corp.id, {
      id: activeContract.id, expectedRevision: activeContract.revision,
      contractNo: activeContract.contractNo, name: "旧页面覆盖合同",
      effectiveFrom: activeContract.effectiveFrom, effectiveTo: activeContract.effectiveTo, status: activeContract.status
    }),
    /已被其他人修改/u,
    "用过期版本覆盖合同"
  );
  await rejects(
    service.saveContract(tenantA, hq.id, { contractNo: `C-${suffix}-1`, name: "撞号合同", effectiveFrom: AT }),
    /合同编号在本租户已存在/u,
    "同租户重复合同编号"
  );
  await rejects(
    service.saveContract(tenantA, corp.id, {
      contractNo: `C-${suffix}-bad`, name: "倒挂有效期",
      effectiveFrom: "2026-06-01T00:00:00.000Z", effectiveTo: "2026-05-01T00:00:00.000Z"
    }),
    /失效时间必须晚于生效时间/u,
    "合同有效期倒挂"
  );
  await rejects(
    service.saveContract(tenantA, corp.id, {
      contractNo: `C-${suffix}-t`, name: "终止无原因", effectiveFrom: AT, status: "terminated"
    }),
    /终止合同必须填写原因/u,
    "终止合同不填原因"
  );
  ok("合同：编号租户内唯一、有效期不得倒挂、终止必须填原因");

  // ============ 4. 授信与账期：只存事实，一企业一条 ============
  const credit = await service.saveCredit(tenantA, corp.id, {
    creditLimit: 200000, settlementTermDays: 45, billingCycle: "monthly", reason: "年度评审"
  }, "财务老王");
  assert.equal(credit.creditLimit, 200000);
  assert.equal(credit.settlementTermDays, 45);
  assert.equal(credit.approvedBy, "财务老王", "授信必须记录审批人");
  const credit2 = await service.saveCredit(tenantA, corp.id, {
    creditLimit: 300000, settlementTermDays: 30, reason: "季度复审上调",
    expectedRevision: credit.revision
  }, "财务老王");
  assert.equal(credit2.id, credit.id, "额度调整走更新，一家企业只有一条当前授信记录");
  await rejects(
    service.saveCredit(tenantA, corp.id, {
      creditLimit: 400000, settlementTermDays: 60, reason: "旧页面覆盖",
      expectedRevision: credit.revision
    }, "财务老王"),
    /已被其他人修改/u,
    "用过期版本覆盖授信"
  );
  assert.equal(
    await prisma.customerCorporateCredit.count({ where: { tenantId: tenantA, customerId: corp.id } }),
    1,
    "不得因调整额度新增行"
  );
  for (const [bad, pattern] of [
    [{ creditLimit: -1, settlementTermDays: 30, reason: "非法额度" }, /额度必须是非负数值/u],
    [{ creditLimit: 100, settlementTermDays: -1, reason: "非法账期" }, /账期天数必须是非负整数/u],
    [{ creditLimit: 100, settlementTermDays: 1.5, reason: "非法账期" }, /账期天数必须是非负整数/u]
  ]) {
    await rejects(service.saveCredit(tenantA, corp.id, bad), pattern, `非法授信入参 ${JSON.stringify(bad)}`);
  }
  await rejects(
    service.saveCredit(tenantA, corp.id, { creditLimit: 100, settlementTermDays: 30, reason: "   " }),
    /必须填写变更原因/u,
    "授信调整不填原因"
  );
  ok("授信与账期：记录审批人、额度调整走更新不新增行、负额度与非整数账期被拒");

  // ============ 5. 订单主体：省略即回落为下单客户本人 ============
  const fallback = await service.resolveOrderSubjects(tenantA, corp.id, AT);
  assert.equal(fallback.contractSubjectCustomerId, corp.id);
  assert.equal(fallback.payerSubjectCustomerId, corp.id);
  assert.equal(fallback.userSubjectCustomerId, corp.id);
  assert.equal(fallback.agentId, undefined, "未指定经办人时不得凭空造一个");
  assert.equal(fallback.snapshot.length, 3, "回落时也要固化三个主体快照");
  assert.deepEqual(fallback.snapshot.map((s) => s.role), ["contract", "payer", "user"]);
  assert.equal(fallback.snapshot[0].corporateName, "示例影视有限公司", "快照必须带下单当时的企业名称");
  ok("订单主体回落：省略即三个主体都是下单客户本人，且仍固化快照（既有下单路径行为不变）");

  // ============ 6. 订单主体：显式区分总部付款、分公司签约、司机使用、行政经办 ============
  const agent = await prisma.customerAuthorizedAgent.create({
    data: {
      tenantId: tenantA, customerId: corp.id, agentName: "行政小李",
      agentPhone: "13600001111", agentPhoneMasked: "136****1111",
      authorityScope: { canOrder: true, canSign: true, canPay: false, canHandover: true },
      validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: new Date("2026-12-31T00:00:00.000Z")
    }
  });
  const hqInvoice = await service.saveInvoiceProfile(tenantA, hq.id, {
    invoiceType: "vat_special", title: "示例集团有限公司", taxNo: "91310000HQ", isDefault: true
  });
  const resolved = await service.resolveOrderSubjects(tenantA, corp.id, AT, {
    contractSubjectCustomerId: corp.id,
    payerSubjectCustomerId: hq.id,
    userSubjectCustomerId: driver.id,
    agentId: agent.id,
    contractId: activeContract.id,
    invoiceProfileId: hqInvoice.id
  });
  assert.equal(resolved.contractSubjectCustomerId, corp.id);
  assert.equal(resolved.payerSubjectCustomerId, hq.id, "付款主体可与签约主体不同（总部付款）");
  assert.equal(resolved.userSubjectCustomerId, driver.id, "使用人可以是个人");
  assert.equal(resolved.agentId, agent.id);
  assert.equal(resolved.snapshot.length, 4, "四个角色都要有快照");
  const byRole = Object.fromEntries(resolved.snapshot.map((s) => [s.role, s]));
  assert.equal(byRole.contract.contractNo, `C-${suffix}-1`, "签约主体快照带上引用的合同编号");
  assert.equal(byRole.payer.invoiceProfileId, hqInvoice.id, "付款主体快照带上引用的开票资料");
  assert.equal(byRole.agent.authorityScope.canPay, false, "经办人快照固化下单当时的授权范围");
  assert.equal(byRole.agent.authorityValidTo, "2026-12-31T00:00:00.000Z", "经办人快照固化授权有效期");
  assert.equal(byRole.user.name, "司机小张");
  ok("订单主体：四个角色可各不相同，快照固化合同编号、开票资料与经办人授权范围");

  // ============ 7. 订单主体的归属校验（每条都必须拒绝） ============
  // 经办人必须由**签约主体**授权，不能借用别家的经办人。
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, AT, { contractSubjectCustomerId: hq.id, agentId: agent.id }),
    /经办人必须由签约主体授权/u,
    "用别的客户的经办人"
  );
  // 授权有效期之外不作数。
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, "2027-01-05T00:00:00.000Z", { agentId: agent.id }),
    /不在有效期内/u,
    "授权到期后仍使用该经办人"
  );
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, "2025-12-01T00:00:00.000Z", { agentId: agent.id }),
    /不在有效期内/u,
    "授权生效前就使用该经办人"
  );
  // 停用的授权不作数。
  await prisma.customerAuthorizedAgent.update({ where: { id: agent.id }, data: { status: "revoked" } });
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, AT, { agentId: agent.id }),
    /授权已停用/u,
    "使用已停用的经办人授权"
  );
  await prisma.customerAuthorizedAgent.update({ where: { id: agent.id }, data: { status: "active" } });

  // 合同必须属于签约主体，且在下单时点生效。
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, AT, { contractSubjectCustomerId: hq.id, contractId: activeContract.id }),
    /合同不属于签约主体/u,
    "引用别家企业的合同"
  );
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, "2027-03-01T00:00:00.000Z", { contractId: activeContract.id }),
    /不在有效期内/u,
    "合同已过期仍引用"
  );
  const draftContract = await service.saveContract(tenantA, corp.id, {
    contractNo: `C-${suffix}-draft`, name: "草稿合同", effectiveFrom: "2026-01-01T00:00:00.000Z", status: "draft"
  });
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, AT, { contractId: draftContract.id }),
    /不是生效状态/u,
    "引用未生效的草稿合同"
  );

  // 开票资料必须属于**付款主体**——谁付款谁开票，挂到签约主体上会开错票。
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, AT, { payerSubjectCustomerId: corp.id, invoiceProfileId: hqInvoice.id }),
    /开票资料不属于付款主体/u,
    "用总部的开票资料给分公司付款"
  );
  // 跨租户主体一律拒绝。
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, AT, { payerSubjectCustomerId: otherTenantCorp.id }),
    /订单主体客户不存在/u,
    "把租户 B 的公司设为付款主体"
  );
  ok("主体归属校验：经办人越权/过期/停用、合同越权/过期/未生效、开票资料越权、跨租户主体全部被拒");

  // ============ 8. 已合并主档不得作为订单主体 ============
  const mergedAway = await customers.createWithMembership(tenantA, {
    customerType: "corporate", name: "被合并的公司", phone: "13900009999"
  }, "普通会员");
  await prisma.customerProfile.update({
    where: { id: mergedAway.id }, data: { mergedIntoCustomerId: corp.id }
  });
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, AT, { contractSubjectCustomerId: mergedAway.id }),
    /主档已被合并，不能作为订单主体/u,
    "把已合并的主档设为签约主体"
  );
  ok("已合并主档：不得作为任何订单主体（责任归属必须指向仍然有效的主档）");

  // ============ 9. 重启（重连）后企业资料仍在 ============
  await prisma.$disconnect();
  prisma = new PrismaClient();
  customers = new SharedCustomerRepository(prisma);
  service = new CustomerCorporateService(prisma, customers);
  const afterReconnect = await service.listInvoiceProfiles(tenantA, corp.id);
  assert.equal(afterReconnect.length, 2, "重连后开票资料仍在");
  assert.equal(afterReconnect.filter((r) => r.isDefault).length, 1, "重连后默认唯一性仍成立");
  assert.equal((await service.listContracts(tenantA, corp.id)).length, 2, "重连后合同仍在");
  assert.equal((await service.getCredit(tenantA, corp.id)).creditLimit, 300000, "重连后授信仍是最后一次调整的额度");
  ok("持久化：断开重连后开票资料、默认标记、合同与授信全部从库读回");

  await cleanup();
  await prisma.$disconnect();
  console.log("\nCUSTOMER-01C 企业资料与订单主体用例全部通过");
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
