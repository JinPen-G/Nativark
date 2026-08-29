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
 * 直连专用真库、用**真实仓储**装配服务：本阶段的验收点是「账号停用影响全租户、
 * 空间暂停只影响目标空间」「跨租户拒绝」「脱敏与访问审计」，这些全部依赖真实的
 * tenantId/workspaceId 过滤与事务行为。用替身仓储只能证明我照自己的假设写了代码。
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

const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const { SharedCustomerRepository } = require(path.join(ROOT, "apps/api/src/modules/platform/shared-customer.repository"));
const { CustomerOperationsRepository } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-operations.repository"));
const {
  CustomerOperationsService,
  CUSTOMER_REVEAL_PERMISSION
} = require(path.join(ROOT, "apps/api/src/modules/platform/customer-operations.service"));
const { CustomerMergeService } = require(path.join(ROOT, "apps/api/src/modules/platform/customer-merge.service"));

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
const viewer = { id: "u_view", tenantId: tenantA, displayName: "运营小王", permissions: ["store-rental:member:view"], isPlatformAdmin: false, isSaasAdmin: false };
/** 具备解密权限的风控：可以看到明文，且其查看要留痕。 */
const revealer = { id: "u_reveal", tenantId: tenantA, displayName: "风控老李", permissions: ["store-rental:member:view", CUSTOMER_REVEAL_PERMISSION], isPlatformAdmin: false, isSaasAdmin: false };

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

  // 客户在租户 A 建档，并接入 A 的两个空间；租户 B 建一个同号客户用于跨租户断言。
  const alice = await customers.createWithLink(tenantA, wsA1, {
    customerType: "personal", name: "Alice", phone: "13800008888",
    email: "alice@example.com", identityNo: "310101199001011234"
  }, "黄金会员");
  await customers.linkToWorkspace(tenantA, wsA2, alice.id, "普通会员");
  const bob = await customers.createWithLink(tenantB, wsB1, {
    customerType: "personal", name: "Bob", phone: "13800008888"
  }, "普通会员");

  // ============ 1. 同租户跨空间共享主档，会员关系各自独立 ============
  const fromA1 = await service.getCustomerDetail(tenantA, wsA1, alice.id, viewer);
  const fromA2 = await service.getCustomerDetail(tenantA, wsA2, alice.id, viewer);
  assert.equal(fromA1.id, fromA2.id, "同租户两个空间必须看到同一份主档（这是共享，不是泄露）");
  assert.equal(fromA1.workspaceLinks?.[0]?.levelName, "黄金会员");
  assert.equal(fromA2.workspaceLinks?.[0]?.levelName, "普通会员", "会员等级按空间隔离");
  assert.equal(fromA1.workspaceLinks?.length, 1, "详情只带当前空间关系，不得暴露其他空间");
  // 列表同样只能带当前空间的关系。主档跨空间可见是设计，但「他在别的空间是什么等级」
  // 不属于本空间该知道的信息——列表带全量关系就是跨空间泄露。
  const listedFromA1 = await service.listCustomers(tenantA, wsA1, viewer);
  const aliceInA1 = listedFromA1.find((row) => row.id === alice.id);
  assert.ok(aliceInA1, "列表必须能看到同租户的共享主档");
  assert.equal(aliceInA1.workspaceLinks?.length, 1, "列表不得带出其他空间的会员关系");
  assert.equal(aliceInA1.workspaceLinks?.[0]?.workspaceId, wsA1, "列表带出的关系必须是当前空间");
  assert.equal(aliceInA1.workspaceLinks?.[0]?.levelName, "黄金会员");
  const listedFromA2 = await service.listCustomers(tenantA, wsA2, viewer);
  assert.equal(
    listedFromA2.find((row) => row.id === alice.id)?.workspaceLinks?.[0]?.levelName,
    "普通会员",
    "同一客户在另一空间的列表里必须显示该空间自己的等级"
  );
  // 跨租户不得出现在列表里。
  assert.equal(
    listedFromA1.some((row) => row.id === bob.id),
    false,
    "租户 A 的列表不得出现租户 B 的客户"
  );
  ok("跨空间共享主档：两空间看到同一主档、各自的等级与关系，且详情与列表都不暴露其他空间");

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

  // ============ 4. 账号停用影响全租户，空间暂停只影响目标空间 ============
  // 这是本阶段最核心的一条区别，因此用**同一个客户、两个空间**逐一观察。
  const account = await service.ensureAccount(tenantA, alice.id, "运营小王");
  assert.equal(account.status, "active");
  // 幂等：再开一次不新建。
  assert.equal((await service.ensureAccount(tenantA, alice.id)).id, account.id, "开通账号必须幂等");

  const before1 = await service.assertTransactable(tenantA, wsA1, alice.id);
  const before2 = await service.assertTransactable(tenantA, wsA2, alice.id);
  assert.equal(before1.allowed, true, "初始状态两个空间都可开展业务");
  assert.equal(before2.allowed, true);

  // 4a. **空间级**暂停 wsA2 → 只有 wsA2 被拦，wsA1 不受影响，账号仍可用。
  await service.changeMembershipStatus(tenantA, wsA2, alice.id, { status: "suspended", reason: "该空间逾期未还" }, "运营小王");
  const afterWsSuspend1 = await service.assertTransactable(tenantA, wsA1, alice.id);
  const afterWsSuspend2 = await service.assertTransactable(tenantA, wsA2, alice.id);
  assert.equal(afterWsSuspend1.allowed, true, "暂停一个空间不得影响另一个空间");
  assert.equal(afterWsSuspend2.allowed, false, "被暂停的空间必须拦下新业务");
  assert.equal(afterWsSuspend2.reasonCode, "membership_suspended", "拒绝原因必须指向空间会员而不是账号");
  assert.equal(afterWsSuspend2.accountStatus, "active", "空间暂停不得改写账号状态");
  assert.equal(
    (await operations.findAccountByCustomer(tenantA, alice.id)).status,
    "active",
    "空间级变更绝不能触碰账号行"
  );

  // 4b. **账号级**停用 → 两个空间同时被拦，且原因指向账号。
  await service.changeAccountStatus(tenantA, alice.id, { status: "suspended", reason: "风控统一停用" }, "风控老李");
  const afterAcctSuspend1 = await service.assertTransactable(tenantA, wsA1, alice.id);
  const afterAcctSuspend2 = await service.assertTransactable(tenantA, wsA2, alice.id);
  assert.equal(afterAcctSuspend1.allowed, false, "账号停用必须阻止全部空间");
  assert.equal(afterAcctSuspend2.allowed, false);
  assert.equal(afterAcctSuspend1.reasonCode, "account_suspended", "原因必须指向账号，客服才知道找谁处理");
  // 账号停用不得改写会员关系：wsA1 仍是 active。
  const linkA1 = await customers.findLink(tenantA, wsA1, alice.id);
  assert.equal(linkA1.status, "active", "账号停用不得把会员关系一并改写（需求 4.8.1 末段）");

  // 4c. 恢复账号 → wsA1 恢复可用，wsA2 仍因自己的暂停被拦。两层各自独立。
  await service.changeAccountStatus(tenantA, alice.id, { status: "active", reason: "复核通过" }, "风控老李");
  assert.equal((await service.assertTransactable(tenantA, wsA1, alice.id)).allowed, true, "账号恢复后未被暂停的空间应恢复");
  const stillSuspended = await service.assertTransactable(tenantA, wsA2, alice.id);
  assert.equal(stillSuspended.allowed, false, "账号恢复不得顺带解除空间级暂停");
  assert.equal(stillSuspended.reasonCode, "membership_suspended");
  ok("账号 vs 空间：空间暂停只拦目标空间且不动账号；账号停用拦全部空间且不动会员关系；两层恢复互不代替");

  // ============ 5. 状态迁移合法性与并发 ============
  // 已注销是终态：不得直接改回正常，必须显式 reopen。
  await service.changeMembershipStatus(tenantA, wsA2, alice.id, { status: "closed", reason: "客户要求注销该空间会员", acknowledgedManualChecks: true }, "运营小王");
  await rejects(
    service.changeMembershipStatus(tenantA, wsA2, alice.id, { status: "active", reason: "直接改回正常" }),
    /不能从 closed 直接变为 active/u,
    "注销后直接改回正常"
  );
  await service.changeMembershipStatus(tenantA, wsA2, alice.id, { status: "pending_activation", reason: "客户回归，重新开户" }, "运营小王");
  assert.equal((await customers.findLink(tenantA, wsA2, alice.id)).status, "pending_activation");
  // 原因必填。
  await rejects(
    service.changeMembershipStatus(tenantA, wsA1, alice.id, { status: "suspended", reason: "   " }),
    /必须填写原因/u,
    "空白原因变更空间会员状态"
  );
  await rejects(
    service.changeAccountStatus(tenantA, alice.id, { status: "suspended", reason: "" }),
    /必须填写原因/u,
    "空白原因变更账号状态"
  );
  // 同状态重复提交必须被拒（否则审计里会出现一串无变化的记录）。
  await rejects(
    service.changeMembershipStatus(tenantA, wsA1, alice.id, { status: "active", reason: "重复提交" }),
    /已处于 active 状态/u,
    "把已是 active 的会员关系再改成 active"
  );
  // 并发：两路同时暂停同一空间会员，只能一路成功。
  const race = await Promise.allSettled([
    service.changeMembershipStatus(tenantA, wsA1, alice.id, { status: "suspended", reason: "并发A" }),
    service.changeMembershipStatus(tenantA, wsA1, alice.id, { status: "suspended", reason: "并发B" })
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

  // ============ 6. 状态历史：账号级与空间级同一条时间线，解除是独立记录 ============
  const timeline = await service.listStatusHistory(tenantA, alice.id, wsA2);
  const kinds = timeline.map((row) => `${row.scope}:${row.action}`);
  // wsA2 视角应看到：本空间的 suspend/close/reopen + 账号级 suspend/release。
  assert.ok(kinds.includes("workspace:suspend"), "本空间的暂停必须在时间线上");
  assert.ok(kinds.includes("workspace:close"), "本空间的注销必须在时间线上");
  assert.ok(kinds.includes("workspace:reopen"), "重新开户必须是独立记录");
  assert.ok(kinds.includes("account:suspend"), "账号级停用同样影响本空间，必须出现在时间线上");
  assert.ok(kinds.includes("account:release"), "账号恢复必须是独立记录");
  // 解除不得删除或改写原限制事实。
  assert.ok(
    timeline.filter((row) => row.action === "suspend").length >= 2,
    "解除后原暂停记录必须仍在（需求 4.8.6 末段）"
  );
  // 不属于本空间的事件不得出现：wsA1 的暂停不应进入 wsA2 的时间线。
  const wsA1Events = timeline.filter((row) => row.scope === "workspace" && row.workspaceId !== wsA2);
  assert.equal(wsA1Events.length, 0, "其他空间的事件不得混入本空间时间线");
  // 每条都必须有原因与时间。
  assert.ok(timeline.every((row) => row.reason && row.at), "每条状态历史都必须有原因与时间");
  ok("状态历史：账号级与空间级同线可还原、解除为独立记录、其他空间事件不混入、原因与时间齐备");

  // ============ 7. 已合并主档不得开展新业务，也不得开通账号 ============
  const dup = await customers.createWithLink(tenantA, wsA1, {
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

  // ============ 8. 未接入本空间的客户 ============
  const onlyA1 = await customers.createWithLink(tenantA, wsA1, {
    customerType: "personal", name: "只在 A1", phone: "13800006666"
  }, "普通会员");
  const notLinked = await service.assertTransactable(tenantA, wsA2, onlyA1.id);
  assert.equal(notLinked.allowed, false, "未接入本空间不得开展业务");
  assert.equal(notLinked.reasonCode, "membership_missing", "原因必须是「未接入」而不是「被暂停」");
  await rejects(
    service.changeMembershipStatus(tenantA, wsA2, onlyA1.id, { status: "suspended", reason: "改一个不存在的关系" }),
    /尚未接入当前经营空间/u,
    "改未接入空间的会员状态"
  );
  ok("未接入本空间：判定为 membership_missing，且不能改一个不存在的会员关系");

  // ============ 8b. 账号状态迁移的合法性与并发 ============
  // 用独立客户做：账号注销是终态，做完这段这个客户就不能再参与其他断言。
  const acctCase = await customers.createWithLink(tenantA, wsA1, {
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
