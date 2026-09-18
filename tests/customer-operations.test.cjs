const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * CUSTOMER-01B 专项：客户服务端与隔离。
 *
 * 直连专用真库、用真实仓储装配服务：验证账号与会员状态各自独立、
 * 统一会员暂停同时影响两空间，以及跨租户拒绝、脱敏与访问审计。
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
const { CustomerOperationsRepository } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-operations.repository"));
const {
  CustomerOperationsService,
  CUSTOMER_REVEAL_PERMISSION
} = require(path.join(ROOT, "apps/api/src/modules/platform/customer-operations.service"));
const { CustomerMergeService } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-merge.service"));
const { RentalOrderConfirmationService } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-order-confirmation.service"));

const suffix = Date.now().toString(36);
const tenantA = `t_op_a_${suffix}`;
const tenantB = `t_op_b_${suffix}`;
const wsA1 = `ws_op_a1_${suffix}`;
const wsA2 = `ws_op_a2_${suffix}`;
const wsB1 = `ws_op_b1_${suffix}`;

const prisma = new PrismaClient();
const customers = new SharedCustomerRepository(prisma);
const operations = new CustomerOperationsRepository(prisma);
// CUSTOMER-01D 起注销要过前置检查，因此装配真实的检查服务——
// 传 undefined 会让注销一律被拒（fail-closed），那不是本用例要验证的东西。
const closability = new CustomerMergeService(prisma, customers, operations);
const service = new CustomerOperationsService(prisma, customers, operations, closability);

/** 只有 member:view 的普通运营：不得看到明文。 */
const viewer = { id: "u_view", tenantId: tenantA, displayName: "运营小王", permissions: ["rental-os:member:view"], isPlatformAdmin: false, isSaasAdmin: false };
/** 具备解密权限的风控：可以看到明文，且其查看要留痕。 */
const revealer = { id: "u_reveal", tenantId: tenantA, displayName: "风控老李", permissions: ["rental-os:member:view", CUSTOMER_REVEAL_PERMISSION], isPlatformAdmin: false, isSaasAdmin: false };

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
  for (const [id, code] of [[tenantA, `op-a-${suffix}`], [tenantB, `op-b-${suffix}`]]) {
    await prisma.tenant.create({ data: { id, code, name: `CUSTOMER-01B 测试租户 ${code}` } });
  }
  for (const [id, tenantId, categoryCode] of [
    [wsA1, tenantA, "CAMERA"],
    [wsA2, tenantA, "CAMPING"],
    [wsB1, tenantB, "CAMERA"]
  ]) {
    await prisma.businessWorkspace.create({
      data: { id, tenantId, code: id, name: `空间 ${id}`, categoryCode, isDefault: false, defaultMarker: id }
    });
  }
}

void (async () => {
  await cleanup();
  await seed();

  // 租户 A 只建一份会员；租户 B 的同号客户仍是独立主档与会员。
  const alice = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "Alice", phone: "13800008888",
    email: "alice@example.com", identityNo: "310101199001011234"
  }, "黄金会员");
  const ensured = await customers.ensureMembership(tenantA, alice.id, "普通会员");
  assert.equal(ensured.id, alice.membership.id, "重复接入必须复用同一会员");
  assert.equal(ensured.levelName, "黄金会员", "重复接入不得覆盖既有等级");
  const bob = await customers.createWithMembership(tenantB, {
    customerType: "personal", name: "Bob", phone: "13800008888"
  }, "普通会员");

  // ============ 1. 两空间共享主档、唯一会员、状态与等级 ============
  const fromA1 = await service.getCustomerDetail(tenantA, wsA1, alice.id, viewer);
  const fromA2 = await service.getCustomerDetail(tenantA, wsA2, alice.id, viewer);
  assert.equal(fromA1.id, fromA2.id);
  assert.equal(fromA1.membership.id, ensured.id);
  assert.deepEqual(fromA1.membership, fromA2.membership, "两空间详情必须返回同一份会员");
  assert.equal(fromA1.membership.levelName, "黄金会员");
  assert.equal("workspaceId" in fromA1.membership, false);
  const listedFromA1 = await service.listCustomers(tenantA, wsA1, viewer);
  const listedFromA2 = await service.listCustomers(tenantA, wsA2, viewer);
  const aliceInA1 = listedFromA1.find((row) => row.id === alice.id);
  const aliceInA2 = listedFromA2.find((row) => row.id === alice.id);
  assert.ok(aliceInA1 && aliceInA2, "两空间列表均可见共享会员");
  assert.deepEqual(aliceInA1.membership, aliceInA2.membership);
  assert.equal(aliceInA2.membership.levelName, "黄金会员");
  for (const rows of [listedFromA1, listedFromA2]) {
    assert.equal(rows.some((row) => row.id === bob.id), false, "租户 A 列表不得出现租户 B 客户");
  }
  assert.equal(await prisma.customerMembership.count({ where: { tenantId: tenantA, customerId: alice.id } }), 1);
  ok("两空间详情与列表共享唯一会员，跨租户同号客户仍独立");

  // ============ 2. 跨租户访问被拒绝 ============
  await rejects(
    service.getCustomerDetail(tenantB, wsB1, alice.id, viewer),
    /客户不存在/u,
    "用租户 B 的身份读租户 A 的客户"
  );
  // 反向同理，且不得因为手机号相同就把 B 的客户当成 A 的客户。
  const bobFromB = await service.getCustomerDetail(tenantB, wsB1, bob.id, viewer);
  assert.notEqual(bobFromB.id, alice.id, "同手机号在两个租户是两份独立主档");
  await rejects(
    service.getCustomerDetail(tenantA, wsA1, bob.id, viewer),
    /客户不存在/u,
    "用租户 A 的身份读租户 B 的客户"
  );
  ok("跨租户隔离：双向读取都被拒绝，且同手机号不会被误认为同一客户");

  // ============ 3. 脱敏与访问审计 ============
  const masked = await service.getCustomerDetail(tenantA, wsA1, alice.id, viewer);
  assert.equal(masked.phone, masked.phoneMasked, "无解密权限时连手机号都必须是脱敏值");
  assert.notEqual(masked.phone, "13800008888", "无解密权限不得返回明文手机号");
  assert.ok(masked.email && masked.email.includes("****"), "邮箱同样脱敏");
  const revealed = await service.getCustomerDetail(tenantA, wsA1, alice.id, revealer);
  assert.equal(revealed.phone, "13800008888", "具备解密权限时返回明文");
  // 访问审计：两次读取都必须留痕，且 revealed 标记要能区分「看了脱敏」与「看了明文」。
  const accessLog = await operations.listSensitiveAccess(tenantA, alice.id);
  const detailReads = accessLog.filter((row) => row.action === "detail");
  assert.ok(detailReads.length >= 2, `每次读取都必须留痕，实际 ${detailReads.length}`);
  assert.ok(detailReads.some((row) => row.revealed === false), "脱敏读取必须记 revealed=false");
  const revealedRow = detailReads.find((row) => row.revealed === true);
  assert.ok(revealedRow, "明文读取必须记 revealed=true");
  assert.equal(revealedRow.operator, "风控老李", "审计必须记录操作人");
  assert.equal(revealedRow.permission, CUSTOMER_REVEAL_PERMISSION, "审计必须记录依据的权限码");
  assert.equal(revealedRow.workspaceId, wsA1, "审计必须记录从哪个空间发起");
  ok("脱敏与访问审计：无权限只见脱敏值、有权限见明文，两者都留痕且可区分 revealed 与操作人");

  // 审计本身是访问画像，必须要解密权限才能查。
  await rejects(
    service.listSensitiveAccess(tenantA, alice.id, viewer),
    /需要「客户敏感资料解密」权限/u,
    "无解密权限查看访问审计"
  );
  assert.ok(
    (await service.listSensitiveAccess(tenantA, alice.id, revealer)).length > 0,
    "具备解密权限可查访问审计"
  );
  ok("访问审计读取本身受控：无解密权限被拒，有权限可读");

  // ============ 4. 会员暂停影响两空间，但账号仍独立可用 ============
  const account = await service.ensureAccount(tenantA, alice.id, "运营小王");
  assert.equal(account.status, "active");
  assert.equal((await service.ensureAccount(tenantA, alice.id)).id, account.id, "开通账号必须幂等");
  for (const workspaceId of [wsA1, wsA2]) {
    assert.equal((await service.assertTransactable(tenantA, workspaceId, alice.id)).allowed, true);
  }
  await service.changeMembershipStatus(tenantA, alice.id, { status: "suspended", reason: "逾期未还，统一暂停" }, "运营小王");
  for (const workspaceId of [wsA1, wsA2]) {
    const blocked = await service.assertTransactable(tenantA, workspaceId, alice.id);
    assert.equal(blocked.allowed, false, "共享暂停必须阻止两个空间的新业务");
    assert.equal(blocked.reasonCode, "membership_suspended");
    assert.equal(blocked.accountStatus, "active", "会员暂停不得改写账号状态");
    const detail = await service.getCustomerDetail(tenantA, workspaceId, alice.id, viewer);
    assert.equal(detail.membership.status, "suspended", "两空间详情同步展示统一暂停");
  }
  assert.equal((await operations.findAccountByCustomer(tenantA, alice.id)).status, "active");
  const retryMembership = await customers.ensureMembership(tenantA, alice.id, "白银会员");
  assert.equal(retryMembership.status, "suspended", "切空间或重试接入不得解除暂停");
  assert.equal(retryMembership.levelName, "黄金会员");

  await service.changeAccountStatus(tenantA, alice.id, { status: "suspended", reason: "风控统一停用" }, "风控老李");
  for (const workspaceId of [wsA1, wsA2]) {
    assert.equal((await service.assertTransactable(tenantA, workspaceId, alice.id)).reasonCode, "account_suspended");
  }
  assert.equal((await customers.findMembership(tenantA, alice.id)).status, "suspended", "账号停用不改写既有会员状态");
  await service.changeAccountStatus(tenantA, alice.id, { status: "active", reason: "复核通过" }, "风控老李");
  for (const workspaceId of [wsA1, wsA2]) {
    assert.equal((await service.assertTransactable(tenantA, workspaceId, alice.id)).reasonCode, "membership_suspended", "恢复账号不能代替恢复会员");
  }
  await service.changeMembershipStatus(tenantA, alice.id, { status: "active", reason: "已归还，恢复租户会员" }, "运营小王");
  for (const workspaceId of [wsA1, wsA2]) {
    assert.equal((await service.assertTransactable(tenantA, workspaceId, alice.id)).allowed, true, "恢复统一会员后两空间一同恢复");
  }
  ok("统一会员暂停/恢复影响两空间，账号状态与会员状态彼此独立");

  // ============ 5. 状态迁移合法性与并发 ============
  // 已注销是终态：不得直接改回正常，必须显式 reopen。
  await service.changeMembershipStatus(tenantA, alice.id, { status: "closed", reason: "客户要求注销租户会员", acknowledgedManualChecks: true }, "运营小王");
  await rejects(
    service.changeMembershipStatus(tenantA, alice.id, { status: "active", reason: "直接改回正常" }),
    /不能从 closed 直接变为 active/u,
    "注销后直接改回正常"
  );
  await service.changeMembershipStatus(tenantA, alice.id, { status: "pending_activation", reason: "客户回归，重新开户" }, "运营小王");
  assert.equal((await customers.findMembership(tenantA, alice.id)).status, "pending_activation");
  for (const workspaceId of [wsA1, wsA2]) {
    assert.equal((await service.assertTransactable(tenantA, workspaceId, alice.id)).reasonCode, "membership_pending_activation");
  }
  await service.changeMembershipStatus(tenantA, alice.id, { status: "active", reason: "重新激活通过" }, "运营小王");
  // 原因必填。
  await rejects(
    service.changeMembershipStatus(tenantA, alice.id, { status: "suspended", reason: "   " }),
    /必须填写原因/u,
    "空白原因变更租户会员状态"
  );
  await rejects(
    service.changeAccountStatus(tenantA, alice.id, { status: "suspended", reason: "" }),
    /必须填写原因/u,
    "空白原因变更账号状态"
  );
  // 同状态重复提交必须被拒（否则审计里会出现一串无变化的记录）。
  await rejects(
    service.changeMembershipStatus(tenantA, alice.id, { status: "active", reason: "重复提交" }),
    /已处于 active 状态/u,
    "把已是 active 的会员关系再改成 active"
  );
  // 并发：两路同时暂停同一租户会员，只能一路成功。
  const race = await Promise.allSettled([
    service.changeMembershipStatus(tenantA, alice.id, { status: "suspended", reason: "并发A" }),
    service.changeMembershipStatus(tenantA, alice.id, { status: "suspended", reason: "并发B" })
  ]);
  const fulfilled = race.filter((r) => r.status === "fulfilled").length;
  assert.equal(fulfilled, 1, `并发变更只能一路成功，实际成功 ${fulfilled} 路`);
  const rejected = race.find((r) => r.status === "rejected");
  assert.match(
    rejected.reason.message,
    /已被其他人修改|已处于 suspended 状态/u,
    `落败方必须是可解释的冲突，实际 ${rejected.reason.message}`
  );
  ok("状态迁移与并发：终态需显式 reopen、原因必填、同状态重复被拒、并发只有一路成功");

  // ============ 6. 两空间都可见账号与会员全局事件，旧空间事件仍隔离 ============
  await operations.appendStatusHistory(tenantA, {
    customerId: alice.id, scope: "workspace", workspaceId: wsA1, action: "suspend",
    fromStatus: "active", toStatus: "suspended", reason: "历史 A1 空间事件", at: "2020-01-01T00:00:00.000Z"
  });
  const timeline = await service.listStatusHistory(tenantA, alice.id, wsA2);
  const kinds = timeline.map((row) => `${row.scope}:${row.action}`);
  for (const kind of ["membership:suspend", "membership:release", "membership:close", "membership:reopen", "account:suspend", "account:release"]) {
    assert.ok(kinds.includes(kind), `${kind} 必须出现在任一空间的时间线上`);
  }
  assert.ok(timeline.filter((row) => row.action === "suspend").length >= 2, "恢复不得删除原暂停事实");
  assert.equal(timeline.some((row) => row.scope === "workspace" && row.workspaceId === wsA1), false, "历史 A1 事件不能混入 A2");
  const fromA1Timeline = await service.listStatusHistory(tenantA, alice.id, wsA1);
  assert.ok(fromA1Timeline.some((row) => row.scope === "workspace" && row.workspaceId === wsA1));
  assert.deepEqual(
    fromA1Timeline.filter((row) => row.scope === "membership").map((row) => row.id),
    timeline.filter((row) => row.scope === "membership").map((row) => row.id),
    "两空间读取同一批会员事件，不是各写一份"
  );
  assert.ok(timeline.filter((row) => row.scope === "membership").every((row) => row.workspaceId === undefined));
  assert.ok(timeline.every((row) => row.reason && row.at));
  ok("全局会员事件两空间共享、历史空间事件仍隔离、恢复与注销轨迹完整");

  // ============ 7. 已合并主档不得开展新业务，也不得开通账号 ============
  const dup = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "Alice 重复档", phone: "13800007777"
  }, "普通会员");
  await prisma.customerProfile.update({ where: { id: dup.id }, data: { mergedIntoCustomerId: alice.id } });
  const mergedCheck = await service.assertTransactable(tenantA, wsA1, dup.id);
  assert.equal(mergedCheck.allowed, false, "已被合并的主档不得开展新业务");
  assert.equal(mergedCheck.reasonCode, "customer_merged");
  await rejects(
    service.ensureAccount(tenantA, dup.id),
    /已被合并/u,
    "为已合并主档开通账号"
  );
  ok("已合并主档：不可开展新业务、不可开通账号，且原因明确指向合并");

  // ============ 8. 无需逐空间接入，但尚未开通租户会员仍拒绝 ============
  const shared = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "A1 登记后直接在 A2 经营", phone: "13800006666"
  }, "普通会员");
  assert.equal((await service.assertTransactable(tenantA, wsA2, shared.id)).allowed, true, "无 A2 接入记录也可使用同一租户会员");
  const raw = await prisma.customerProfile.create({ data: {
    tenantId: tenantA, customerType: "personal", name: "只有主档", phone: "13800009999", phoneMasked: "138****9999", qualifications: {}
  } });
  for (const workspaceId of [wsA1, wsA2]) {
    const missing = await service.assertTransactable(tenantA, workspaceId, raw.id);
    assert.equal(missing.allowed, false);
    assert.equal(missing.reasonCode, "membership_missing");
  }
  await rejects(
    service.changeMembershipStatus(tenantA, raw.id, { status: "suspended", reason: "改一个不存在的会员" }),
    /尚未开通租户会员/u,
    "不能修改尚未开通的租户会员"
  );
  await rejects(service.changeMembershipStatus(tenantB, alice.id, { status: "suspended", reason: "跨租户暂停" }), /客户不存在/u, "跨租户写入会员被拒");
  assert.equal((await customers.findMembership(tenantB, bob.id)).status, "active", "A 租户暂停不得影响 B 的同号客户");
  ok("同租户跨空间直接可用；缺失会员与跨租户写入仍拒绝");

  // ============ 8b. 账号状态迁移的合法性与并发 ============
  // 用独立客户做：账号注销是终态，做完这段这个客户就不能再参与其他断言。
  const acctCase = await customers.createWithMembership(tenantA, {
    customerType: "personal", name: "账号用例", phone: "13800005555"
  }, "普通会员");
  await service.ensureAccount(tenantA, acctCase.id, "运营小王");

  // 并发停用同一账号：只能一路成功，落败方必须是可解释的冲突而不是静默覆盖。
  const acctRace = await Promise.allSettled([
    service.changeAccountStatus(tenantA, acctCase.id, { status: "suspended", reason: "并发停用A" }),
    service.changeAccountStatus(tenantA, acctCase.id, { status: "suspended", reason: "并发停用B" })
  ]);
  const acctFulfilled = acctRace.filter((r) => r.status === "fulfilled").length;
  assert.equal(acctFulfilled, 1, `并发停用账号只能一路成功，实际成功 ${acctFulfilled} 路`);
  assert.match(
    acctRace.find((r) => r.status === "rejected").reason.message,
    /已被其他人修改|已处于 suspended 状态/u,
    "落败方必须拿到可解释的冲突"
  );
  // 审计里这次停用只应留一条，否则说明落败方也写了历史。
  const acctHistory = await service.listStatusHistory(tenantA, acctCase.id);
  assert.equal(
    acctHistory.filter((row) => row.scope === "account" && row.action === "suspend").length,
    1,
    "并发下账号停用只能留一条状态历史"
  );

  // 注销是终态：注销后不得改回 active，也不得再次注销。
  await service.changeAccountStatus(tenantA, acctCase.id, { status: "closed", reason: "客户申请注销账号", acknowledgedManualChecks: true }, "风控老李");
  await rejects(
    service.changeAccountStatus(tenantA, acctCase.id, { status: "active", reason: "直接改回正常" }),
    /不能从 closed 直接变为 active/u,
    "已注销账号直接改回正常"
  );
  await rejects(
    service.changeAccountStatus(tenantA, acctCase.id, { status: "suspended", reason: "注销后再停用" }),
    /不能从 closed 直接变为 suspended/u,
    "已注销账号再停用"
  );
  // 注销后该客户在任何空间都不可开展新业务。
  const closedCheck = await service.assertTransactable(tenantA, wsA1, acctCase.id);
  assert.equal(closedCheck.allowed, false);
  assert.equal(closedCheck.reasonCode, "account_closed", "注销与停用必须是不同的拒绝原因");
  ok("账号状态迁移与并发：并发只一路成功且只留一条历史、注销为终态不可回改、注销与停用原因可区分");

  // ============ 8c. 真实订单创建链必须执行事务内权威门禁 ============
  // 第一次快速检查放行，第二次（事务内）模拟客户刚被暂停；订单不得继续写聚合。
  let savedOrder = false;
  const orderInput = {
    quoteId: "q_customer_gate",
    customerId: alice.id,
    customerType: "individual",
    fulfillmentMode: "pickup",
    fulfillmentLocationId: "loc_gate",
    returnLocationId: "loc_gate",
    startAt: new Date(Date.now() + 86_400_000).toISOString(),
    endAt: new Date(Date.now() + 172_800_000).toISOString(),
    lines: []
  };
  const quote = {
    id: orderInput.quoteId,
    request: { ...orderInput, id: undefined, quoteId: undefined },
    chargeLines: [],
    expiresAt: new Date(Date.now() + 3_600_000).toISOString()
  };
  // 报价请求本身没有 quoteId；显式构造，避免把测试夹具的辅助字段带进指纹。
  delete quote.request.quoteId;
  const orderConfirmation = new RentalOrderConfirmationService(
    { $transaction: async (fn) => fn({}) },
    {
      resolveWorkspaceId: () => wsA1,
      prepareOrder: async () => ({ id: "order_customer_gate", lines: [], capabilitySnapshot: [] }),
      assertAvailabilityWithLocks: async () => undefined
    },
    {
      consumeQuote: () => quote,
      validateCouponForOrder: () => undefined,
      applyOrderConfirmationToCache: () => undefined,
      // 本用例只验证订单事务内的客户门禁；营业日历复查由独立报价/日历专项覆盖。
      assertOrderDaysOpenForConfirmation: () => undefined
    },
    {
      saveOrderAggregate: async () => { savedOrder = true; },
      findOrder: async () => undefined
    },
    {
      findQuote: async () => quote,
      consumeQuoteIfAvailable: async () => true
    },
    {
      find: async () => undefined,
      record: async () => undefined
    },
    undefined,
    undefined,
    {
      assertTransactable: async () => ({ allowed: true }),
      assertTransactableForNewBusiness: async () => ({
        allowed: false,
        reasonCode: "membership_suspended",
        message: "该客户在本空间已暂停"
      })
    }
  );
  await rejects(
    orderConfirmation.createOrder(tenantA, orderInput, "运营小王", { category: { code: "camera" } }),
    /已暂停/u,
    "订单事务内客户门禁"
  );
  assert.equal(savedOrder, false, "客户门禁拒绝后不得写订单聚合");
  ok("订单门禁：事务外预检后状态变化，事务内仍会阻止新订单且不落半成品");

  // ============ 9. 重启（重连）后状态与审计仍在 ============
  await prisma.$disconnect();
  await prisma.$connect();
  const afterReconnect = await service.assertTransactable(tenantA, wsA1, alice.id);
  assert.equal(afterReconnect.allowed, false, "重连后 wsA1 仍处于并发用例留下的暂停态");
  assert.equal(afterReconnect.reasonCode, "membership_suspended");
  const historyAfter = await service.listStatusHistory(tenantA, alice.id);
  assert.ok(historyAfter.length >= 6, `重连后状态历史必须仍在，实际 ${historyAfter.length} 条`);
  assert.ok(
    (await operations.listSensitiveAccess(tenantA, alice.id)).length > 0,
    "重连后访问审计必须仍在"
  );
  ok("持久化：断开重连后账号状态、会员状态、状态历史与访问审计全部从库读回");

  await cleanup();
  await prisma.$disconnect();
  console.log("\nCUSTOMER-01B 客户服务端与隔离用例全部通过");
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
