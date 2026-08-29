const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * CUSTOMER-01C 专项：企业资料与订单主体。
 *
 * 直连专用真库、用真实仓储装配服务。本阶段两个验收点都依赖真实约束与真实时点判定：
 *   * 企业开票/合同/授信的唯一性与归属（库层）；
 *   * 订单四主体的解析必须按**下单时点**判定合同与授权有效性，
 *     并拒绝「拿别人的经办人/合同/开票资料」这类越界组合。
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
const { SharedCustomerRepository } = require(path.join(ROOT, "apps/api/src/modules/platform/shared-customer.repository"));
const { CustomerCorporateService } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-corporate.service"));

const suffix = Date.now().toString(36);
const tenantA = `t_cor_a_${suffix}`;
const tenantB = `t_cor_b_${suffix}`;
const wsA = `ws_cor_a_${suffix}`;
const wsB = `ws_cor_b_${suffix}`;

const prisma = new PrismaClient();
const customers = new SharedCustomerRepository(prisma);
const service = new CustomerCorporateService(prisma, customers);

const ok = (m) => console.log(`  ✓ ${m}`);

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
  for (const [id, code] of [[tenantA, `cor-a-${suffix}`], [tenantB, `cor-b-${suffix}`]]) {
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

  // 企业客户（签约主体）、个人客户（使用人）、另一家企业（用于越界断言）。
  const corp = await customers.createWithLink(tenantA, wsA, {
    customerType: "corporate", name: "示例影视", phone: "13900001111", corporateName: "示例影视有限公司"
  }, "企业会员");
  await prisma.customerCorporateProfile.create({
    data: {
      tenantId: tenantA, customerId: corp.id, legalName: "示例影视有限公司",
      unifiedSocialCreditCode: `91310000C${suffix}`, unifiedSocialCreditCodeMasked: "9131****C001"
    }
  });
  const person = await customers.createWithLink(tenantA, wsA, {
    customerType: "personal", name: "李四", phone: "13800002222"
  }, "普通会员");
  const otherCorp = await customers.createWithLink(tenantA, wsA, {
    customerType: "corporate", name: "另一家公司", phone: "13900003333"
  }, "企业会员");
  await prisma.customerCorporateProfile.create({
    data: {
      tenantId: tenantA, customerId: otherCorp.id, legalName: "另一家公司",
      unifiedSocialCreditCode: `91310000D${suffix}`, unifiedSocialCreditCodeMasked: "9131****D002"
    }
  });
  const foreignCorp = await customers.createWithLink(tenantB, wsB, {
    customerType: "corporate", name: "B 租户公司", phone: "13900004444"
  }, "企业会员");

  // ============ 1. 开票资料：仅企业可建、同企业至多一份默认 ============
  const inv1 = await service.saveInvoiceProfile(tenantA, corp.id, {
    invoiceType: "vat_special", title: "示例影视有限公司", taxNo: `91310000C${suffix}`,
    bankName: "示例银行", bankAccount: "6222020000001234567", isDefault: true
  }, "运营小王");
  assert.equal(inv1.isDefault, true);
  assert.ok(inv1.bankAccountMasked && !inv1.bankAccountMasked.includes("0000001234567"), "银行账号必须脱敏保存");
  const inv2 = await service.saveInvoiceProfile(tenantA, corp.id, {
    invoiceType: "vat_normal", title: "示例影视有限公司上海分公司", taxNo: `91310000C${suffix}`, isDefault: true
  }, "运营小王");
  assert.equal(inv2.isDefault, true, "新默认必须生效");
  const invoices = await service.listInvoiceProfiles(tenantA, corp.id);
  assert.equal(invoices.filter((row) => row.isDefault).length, 1, "同企业至多一份默认开票资料");
  assert.equal(invoices.length, 2);
  // 个人客户不得建开票资料——开票是企业责任主体的事。
  await rejects(
    service.saveInvoiceProfile(tenantA, person.id, { invoiceType: "vat_normal", title: "李四", taxNo: "x" }),
    /只适用于企业客户/u,
    "为个人客户建开票资料"
  );
  // 跨租户不得访问。
  await rejects(
    service.listInvoiceProfiles(tenantA, foreignCorp.id),
    /客户不存在|只适用于企业客户/u,
    "用租户 A 的身份读租户 B 企业的开票资料"
  );
  ok("开票资料：银行账号脱敏、同企业至多一份默认、个人客户不可建、跨租户被拒");

  // ============ 2. 合同：编号租户内唯一、有效期与状态 ============
  const contract = await service.saveContract(tenantA, corp.id, {
    contractNo: `HT-${suffix}-1`, name: "2026 年度框架合同",
    effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: "2026-12-31T23:59:59.000Z", status: "active"
  }, "运营小王");
  assert.equal(contract.status, "active");
  await rejects(
    service.saveContract(tenantA, otherCorp.id, {
      contractNo: `HT-${suffix}-1`, name: "撞号合同", effectiveFrom: "2026-01-01T00:00:00.000Z"
    }),
    /合同编号在本租户已存在/u,
    "同租户两家企业用同一合同编号"
  );
  // 结束时间早于开始时间必须被拒。
  await rejects(
    service.saveContract(tenantA, corp.id, {
      contractNo: `HT-${suffix}-bad`, name: "倒挂合同",
      effectiveFrom: "2026-06-01T00:00:00.000Z", effectiveTo: "2026-05-01T00:00:00.000Z"
    }),
    /失效时间必须晚于生效时间/u,
    "合同有效期倒挂"
  );
  ok("企业合同：编号租户内唯一、有效期倒挂被拒、状态可维护");

  // ============ 3. 授信与账期：一企业一条，金额用定点数 ============
  const credit = await service.saveCredit(tenantA, corp.id, {
    creditLimit: 100000.5, settlementTermDays: 30, billingCycle: "monthly", status: "active",
    reason: "年度授信"
  }, "财务老张");
  assert.equal(String(credit.creditLimit), "100000.5", "授信额度必须按定点数保存，不得出现浮点误差");
  assert.equal(credit.settlementTermDays, 30);
  const credit2 = await service.saveCredit(tenantA, corp.id, {
    creditLimit: 200000, settlementTermDays: 45, billingCycle: "monthly", status: "active", reason: "提额"
  }, "财务老张");
  assert.equal(credit2.id, credit.id, "额度调整走更新，同企业只有一条当前授信记录");
  assert.equal(String(credit2.creditLimit), "200000");
  await rejects(
    service.saveCredit(tenantA, corp.id, { creditLimit: -1, settlementTermDays: 30, billingCycle: "monthly" }),
    /必须是非负数值/u,
    "负数授信额度"
  );
  ok("授信与账期：定点数金额、同企业一条记录（调整走更新）、负额度被拒");

  // ============ 4. 订单四主体：默认回落与显式拆分 ============
  const orderAt = "2026-06-15T10:00:00.000Z";
  // 不传主体时，三个主体都回落到订单客户——存量订单与个人自助单都是这种形态。
  const fallback = await service.resolveOrderSubjects(tenantA, person.id, orderAt);
  assert.equal(fallback.contractSubjectCustomerId, person.id);
  assert.equal(fallback.payerSubjectCustomerId, person.id);
  assert.equal(fallback.userSubjectCustomerId, person.id);
  assert.equal(fallback.agentId, undefined, "未指定经办人时不得凭空造一个");
  assert.deepEqual(
    fallback.snapshot.map((row) => row.role),
    ["contract", "payer", "user"],
    "未指定经办人时快照只有三个角色"
  );

  // 企业签约 + 企业付款 + 个人使用：这正是需求要求「不能只保存一个联系人代替企业责任主体」。
  const agent = await prisma.customerAuthorizedAgent.create({
    data: {
      tenantId: tenantA, customerId: corp.id, agentName: "李四",
      agentPhone: "13800002222", agentPhoneMasked: "138****2222",
      authorityScope: { canOrder: true, canSign: true, canPay: false, canHandover: true },
      validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: new Date("2026-12-31T00:00:00.000Z")
    }
  });
  const split = await service.resolveOrderSubjects(tenantA, corp.id, orderAt, {
    contractSubjectCustomerId: corp.id,
    payerSubjectCustomerId: corp.id,
    userSubjectCustomerId: person.id,
    agentId: agent.id,
    contractId: contract.id,
    invoiceProfileId: inv1.id
  });
  assert.equal(split.userSubjectCustomerId, person.id, "使用人与签约主体可以不同");
  assert.equal(split.agentId, agent.id);
  const byRole = Object.fromEntries(split.snapshot.map((row) => [row.role, row]));
  assert.equal(byRole.contract.corporateName, "示例影视有限公司", "签约主体快照必须带企业名称");
  assert.equal(byRole.contract.contractNo, `HT-${suffix}-1`, "签约快照必须固化合同号");
  assert.equal(byRole.payer.invoiceProfileId, inv1.id, "付款主体快照必须固化开票资料");
  assert.equal(byRole.user.name, "李四");
  assert.equal(byRole.agent.authorityScope.canPay, false, "经办人授权范围必须原样固化");
  assert.ok(byRole.agent.authorityValidTo, "经办人授权有效期必须固化，事后才能判断当时是否有效");
  // 快照里不得出现明文手机号。
  assert.ok(
    split.snapshot.every((row) => !row.phone && (!row.phoneMasked || row.phoneMasked.includes("****"))),
    "主体快照只能保存脱敏手机号"
  );
  ok("订单四主体：未指定时回落订单客户；企业签约/企业付款/个人使用可分别保存，合同号、开票资料、授权范围与有效期均固化且脱敏");

  // 4b. 签约主体与订单客户**不同**：这是需求 4.8.4 的核心场景——
  // 由个人使用人下单，但责任主体是企业。若实现忽略了显式传入的签约主体、
  // 一律回落到订单客户，这条断言会立刻变红（上面的 4a 因两者恰好同为企业而看不出差别）。
  const corporateSigned = await service.resolveOrderSubjects(tenantA, person.id, orderAt, {
    contractSubjectCustomerId: corp.id,
    payerSubjectCustomerId: corp.id,
    agentId: agent.id
  });
  assert.equal(corporateSigned.contractSubjectCustomerId, corp.id, "签约主体必须是显式指定的企业，不能回落到订单客户");
  assert.equal(corporateSigned.payerSubjectCustomerId, corp.id, "付款主体同样不得回落");
  assert.equal(corporateSigned.userSubjectCustomerId, person.id, "未指定使用人时才回落到订单客户");
  const signedByRole = Object.fromEntries(corporateSigned.snapshot.map((row) => [row.role, row]));
  assert.equal(signedByRole.contract.customerType, "corporate", "签约主体快照必须是企业");
  assert.equal(signedByRole.user.customerType, "personal", "使用人快照必须是个人");
  assert.notEqual(
    signedByRole.contract.customerId,
    signedByRole.user.customerId,
    "签约主体与使用人必须是两个不同的主体，不能用一个联系人顶替企业责任主体"
  );
  ok("企业签约 + 个人使用：签约与付款主体不回落到订单客户，签约主体为企业、使用人为个人且互不顶替");

  // ============ 5. 越界组合必须被拒 ============
  // 5a. 经办人不属于签约主体。
  const otherAgent = await prisma.customerAuthorizedAgent.create({
    data: {
      tenantId: tenantA, customerId: otherCorp.id, agentName: "别人的经办人",
      agentPhone: "13700009999", agentPhoneMasked: "137****9999",
      authorityScope: { canOrder: true }, validFrom: new Date("2026-01-01T00:00:00.000Z")
    }
  });
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, orderAt, { contractSubjectCustomerId: corp.id, agentId: otherAgent.id }),
    /必须由签约主体授权/u,
    "使用其他客户的经办人"
  );
  // 5b. 合同不属于签约主体。
  const otherContract = await service.saveContract(tenantA, otherCorp.id, {
    contractNo: `HT-${suffix}-2`, name: "别家的合同", effectiveFrom: "2026-01-01T00:00:00.000Z", status: "active"
  });
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, orderAt, { contractSubjectCustomerId: corp.id, contractId: otherContract.id }),
    /不属于签约主体/u,
    "引用其他企业的合同"
  );
  // 5c. 开票资料不属于付款主体——谁付款谁开票，挂错会开错票。
  const otherInvoice = await service.saveInvoiceProfile(tenantA, otherCorp.id, {
    invoiceType: "vat_normal", title: "另一家公司", taxNo: `91310000D${suffix}`
  });
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, orderAt, { payerSubjectCustomerId: corp.id, invoiceProfileId: otherInvoice.id }),
    /不属于付款主体/u,
    "引用其他企业的开票资料"
  );
  // 5d. 跨租户主体。
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, orderAt, { userSubjectCustomerId: foreignCorp.id }),
    /订单主体客户不存在/u,
    "把另一租户的客户设为使用人"
  );
  ok("越界组合：他人的经办人/合同/开票资料与跨租户主体全部被拒");

  // ============ 6. 时点判定：合同与授权按下单时点判有效性 ============
  const beforeWindow = "2025-12-31T23:00:00.000Z";
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, beforeWindow, { contractSubjectCustomerId: corp.id, contractId: contract.id }),
    /不在有效期内/u,
    "下单时点早于合同生效"
  );
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, "2027-01-05T00:00:00.000Z", { contractSubjectCustomerId: corp.id, agentId: agent.id }),
    /不在有效期内/u,
    "下单时点晚于经办人授权到期"
  );
  // 合同被终止后不得再引用。
  await service.saveContract(tenantA, corp.id, {
    id: contract.id, contractNo: `HT-${suffix}-1`, name: "2026 年度框架合同",
    effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: "2026-12-31T23:59:59.000Z",
    status: "terminated", terminatedReason: "提前解约"
  }, "运营小王");
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, orderAt, { contractSubjectCustomerId: corp.id, contractId: contract.id }),
    /不是生效状态/u,
    "引用已终止的合同"
  );
  ok("时点判定：合同与经办人授权都按下单时点判有效性，已终止合同不可引用");

  // ============ 7. 已合并主档不得作为订单主体 ============
  const merged = await customers.createWithLink(tenantA, wsA, {
    customerType: "personal", name: "重复档", phone: "13800007777"
  }, "普通会员");
  await prisma.customerProfile.update({ where: { id: merged.id }, data: { mergedIntoCustomerId: person.id } });
  await rejects(
    service.resolveOrderSubjects(tenantA, corp.id, orderAt, { userSubjectCustomerId: merged.id }),
    /已被合并/u,
    "把已合并主档设为使用人"
  );
  ok("已合并主档不得作为任何订单主体");

  // ============ 8. 重连后企业资料仍在 ============
  await prisma.$disconnect();
  await prisma.$connect();
  assert.equal((await service.listInvoiceProfiles(tenantA, corp.id)).length, 2, "重连后开票资料仍在");
  assert.equal((await service.listContracts(tenantA, corp.id)).length, 1, "重连后合同仍在");
  assert.equal(String((await service.getCredit(tenantA, corp.id)).creditLimit), "200000", "重连后授信仍在且为最后一次调整值");
  ok("持久化：断开重连后开票资料、合同与授信全部从库读回");

  await cleanup();
  await prisma.$disconnect();
  console.log("\nCUSTOMER-01C 企业与订单主体用例全部通过");
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
