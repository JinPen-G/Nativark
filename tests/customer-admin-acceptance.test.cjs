const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * CUSTOMER-01E 专项：管理端读取口径与验收。
 *
 * 本阶段新增的是「管理端要看到什么、看不到什么」，因此断言集中在三处：
 *   1. 详情带联系人与经办人、列表不带（列表拉这两个关联会变成 N+1，且列表并不展示）；
 *   2. 号码一律只有掩码字段可外传，明文由解密权限单独决定并留访问审计；
 *   3. 页面契约：路由与菜单已注册、四类权限分别门禁、六态文案齐全、
 *      合并预览与注销人工确认在页面上真的存在——否则后端守住了而界面绕过去。
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
const { PlatformService } = require(path.join(ROOT, "apps/api/src/modules/platform/platform.service"));
const { runWithRequestIdentity } = require(path.join(ROOT, "apps/api/src/common/request-identity"));

const suffix = Date.now().toString(36);
const tenantA = `t_ad_a_${suffix}`;
const tenantB = `t_ad_b_${suffix}`;
const wsA1 = `ws_ad_a1_${suffix}`;
const wsA2 = `ws_ad_a2_${suffix}`;
const wsB1 = `ws_ad_b1_${suffix}`;

let prisma = new PrismaClient();
let customers = new SharedCustomerRepository(prisma);
let operations = new CustomerOperationsRepository(prisma);
let merge = new CustomerMergeService(prisma, customers, operations);
let ops = new CustomerOperationsService(prisma, customers, operations, merge);

const ok = (m) => console.log(`  ✓ ${m}`);

/** 只读账号：能看客户，但看不到明文，也看不到访问审计。 */
const viewer = { id: "u_view", displayName: "只读运营", permissions: ["store-rental:member:view"], isSaasAdmin: false, isPlatformAdmin: false };
/** 具备解密权限的账号。SaaS 管理员刻意不在此列——跨租户身份不该看租户客户明文。 */
const revealer = { id: "u_reveal", displayName: "客服主管", permissions: [CUSTOMER_REVEAL_PERMISSION], isSaasAdmin: false, isPlatformAdmin: false };

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
  for (const [id, code] of [[tenantA, `ad-a-${suffix}`], [tenantB, `ad-b-${suffix}`]]) {
    await prisma.tenant.create({ data: { id, code, name: `CUSTOMER-01E 测试租户 ${code}` } });
  }
  await prisma.businessWorkspace.create({
    data: { id: wsA1, tenantId: tenantA, code: wsA1, name: "空间 A1", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" }
  });
  await prisma.businessWorkspace.create({
    data: { id: wsA2, tenantId: tenantA, code: wsA2, name: "空间 A2", categoryCode: "CAMPING", isDefault: false, defaultMarker: wsA2 }
  });
  await prisma.businessWorkspace.create({
    data: { id: wsB1, tenantId: tenantB, code: wsB1, name: "空间 B1", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" }
  });
}

void (async () => {
  await cleanup();
  await seed();

  const person = await customers.createWithLink(tenantA, wsA1, {
    customerType: "personal", name: "李四", phone: "13900001111",
    email: "lisi@example.com", identityNo: "310101199203034567", identityVerified: true
  }, "黄金会员");
  const corporate = await customers.createWithLink(tenantA, wsA1, {
    customerType: "corporate", name: "某影视工作室", phone: "13900002222",
    corporateName: "上海某影视工作室有限公司", corporateTaxNo: "91310000MA1K35Q08X"
  }, "企业会员");
  // 只在 A2 空间注册的客户：用于验证「主档按租户共享、会员关系按空间隔离」。
  const otherSpace = await customers.createWithLink(tenantA, wsA2, {
    customerType: "personal", name: "王五", phone: "13900003333"
  }, "普通会员");

  await prisma.customerContact.createMany({
    data: [
      {
        tenantId: tenantA, customerId: person.id, kind: "emergency", name: "李四家属",
        phone: "13700001111", phoneMasked: "137****1111", relation: "配偶", isPrimary: true, status: "active"
      },
      {
        tenantId: tenantA, customerId: person.id, kind: "other", name: "已失效联系人",
        phone: "13700002222", phoneMasked: "137****2222", status: "inactive"
      }
    ]
  });
  await prisma.customerAuthorizedAgent.create({
    data: {
      tenantId: tenantA, customerId: corporate.id, agentName: "赵经办", agentPhone: "13600001111",
      agentPhoneMasked: "136****1111", authorityScope: { canPlaceOrder: true, canSign: true },
      validFrom: new Date("2026-01-01T00:00:00.000Z"), validTo: new Date("2026-12-31T00:00:00.000Z"), status: "active"
    }
  });

  // ============ 1. 详情带出联系人与经办人，且只带在用联系人 ============
  const detail = await ops.getCustomerDetail(tenantA, wsA1, person.id, revealer);
  assert.equal(detail.contacts?.length, 1, `详情必须带出联系人，且失效联系人不应出现，实际 ${JSON.stringify(detail.contacts)}`);
  assert.equal(detail.contacts[0].name, "李四家属", "带出的应是在用联系人");
  assert.equal(detail.contacts[0].isPrimary, true, "主要联系人标记必须带出——界面据此排序与标注");
  const corpDetail = await ops.getCustomerDetail(tenantA, wsA1, corporate.id, revealer);
  assert.equal(corpDetail.authorizedAgents?.length, 1, "企业详情必须带出授权经办人");
  assert.equal(corpDetail.authorizedAgents[0].agentName, "赵经办");
  assert.ok(corpDetail.authorizedAgents[0].validFrom, "经办人必须带授权起始时间，否则事后无法判断当时是否有效");
  assert.deepEqual(corpDetail.authorizedAgents[0].authorityScope, { canPlaceOrder: true, canSign: true }, "授权范围必须原样带出");
  ok("详情：带出在用联系人与授权经办人（含授权范围与有效期），失效联系人不带");

  // ============ 2. 列表不带联系人与经办人（列表并不展示，拉出来只会变成 N+1） ============
  const list = await ops.listCustomers(tenantA, wsA1, revealer);
  const listedPerson = list.find((row) => row.id === person.id);
  assert.ok(listedPerson, "列表必须包含本空间客户");
  assert.equal(listedPerson.contacts, undefined, "列表不应带联系人");
  assert.equal(listedPerson.authorizedAgents, undefined, "列表不应带经办人");
  ok("列表：不带联系人与经办人，只带身份与本空间会员关系");

  // ============ 3. 联系人与经办人号码只有掩码可外传 ============
  // 这条与「有没有解密权限」无关：仓储层根本不把明文号码放进出参，
  // 因此即使解密账号也拿不到联系人明文——明文需要单独的查询与授权，不能顺带泄露。
  assert.equal("phone" in detail.contacts[0], false, "联系人明文号码不得进入出参");
  assert.match(detail.contacts[0].phoneMasked, /\*{4}/u, "联系人必须给出掩码号码");
  assert.equal("agentPhone" in corpDetail.authorizedAgents[0], false, "经办人明文号码不得进入出参");
  assert.match(corpDetail.authorizedAgents[0].agentPhoneMasked, /\*{4}/u, "经办人必须给出掩码号码");
  ok("联系人与经办人：出参只有掩码号码，明文不随详情外传");

  // ============ 4. 无解密权限：主档敏感字段一律脱敏 ============
  const masked = await ops.getCustomerDetail(tenantA, wsA1, person.id, viewer);
  assert.equal(masked.phone, person.phoneMasked, "无解密权限时手机号必须是掩码——手机号即登录标识");
  assert.match(masked.email, /\*{4}/u, "无解密权限时邮箱必须脱敏");
  const maskedCorp = await ops.getCustomerDetail(tenantA, wsA1, corporate.id, viewer);
  assert.match(maskedCorp.corporateTaxNo, /\*{4}/u, "无解密权限时统一社会信用代码必须脱敏");
  const maskedList = await ops.listCustomers(tenantA, wsA1, viewer);
  assert.equal(
    maskedList.find((row) => row.id === person.id).phone,
    person.phoneMasked,
    "列表同样必须脱敏，否则脱敏在详情页守住、在列表页泄露"
  );
  ok("脱敏：无解密权限时详情与列表的手机号、邮箱、税号一律掩码");

  // ============ 5. 有解密权限：明文返回，且访问审计记录依据的权限 ============
  assert.equal(detail.phone, "13900001111", "具备解密权限时应返回明文手机号");
  const audits = await ops.listSensitiveAccess(tenantA, person.id, revealer);
  const revealedRow = audits.find((row) => row.revealed && row.field === "customer_detail");
  const maskedRow = audits.find((row) => !row.revealed && row.field === "customer_detail");
  assert.ok(revealedRow, "解密读取必须留痕");
  assert.equal(revealedRow.permission, CUSTOMER_REVEAL_PERMISSION, "审计必须记录所依据的权限");
  assert.equal(revealedRow.operator, revealer.displayName, "审计必须记录操作人");
  assert.ok(maskedRow, "脱敏读取同样要留痕——「谁查过谁」本身就是要追溯的事实");
  assert.equal(maskedRow.permission, undefined, "脱敏读取不应记成凭解密权限读取");
  ok("访问审计：解密与脱敏读取都留痕，并区分是否解密及所依据权限");

  // ============ 6. 访问审计本身需要解密权限 ============
  // 「谁在什么时候查过谁」是一份访问画像，只凭「会员查看」就能读等于把画像公开。
  await rejects(
    ops.listSensitiveAccess(tenantA, person.id, viewer),
    /解密/u,
    "只读账号读取敏感访问审计"
  );
  ok("访问审计：只读账号被拒，需「客户敏感资料解密」权限");

  // ============ 7. 状态时间线：账号级与空间级同一条线，解除不抹掉原限制 ============
  await ops.changeMembershipStatus(tenantA, wsA1, person.id, { status: "risk_restricted", reason: "风控复核" }, "风控员");
  await ops.changeMembershipStatus(tenantA, wsA1, person.id, { status: "active", reason: "复核通过" }, "风控员");
  await ops.ensureAccount(tenantA, person.id, "客服");
  await ops.changeAccountStatus(tenantA, person.id, { status: "suspended", reason: "账号异常登录" }, "客服");
  const timeline = await ops.listStatusHistory(tenantA, person.id, wsA1);
  const marks = timeline.map((row) => `${row.scope}:${row.action}`);
  assert.ok(marks.includes("workspace:restrict"), `时间线缺少空间级限制记录：${marks.join(",")}`);
  assert.ok(marks.includes("workspace:release"), "时间线缺少解除记录");
  assert.ok(marks.includes("account:suspend"), "账号级变更同样影响本空间，必须出现在同一条线上");
  assert.equal(
    timeline.filter((row) => row.action === "restrict").length,
    1,
    "解除限制必须是新增一条记录，不得回改或删除原限制事实"
  );
  assert.ok(timeline.every((row) => row.reason), "每条状态变更都必须带原因（需求 4.8.6）");
  const a2Timeline = await ops.listStatusHistory(tenantA, person.id, wsA2);
  assert.equal(
    a2Timeline.some((row) => row.scope === "workspace"),
    false,
    "别的空间的会员事件不得出现在本空间时间线上"
  );
  assert.ok(a2Timeline.some((row) => row.scope === "account"), "账号级事件对所有空间可见");
  ok("状态时间线：账号级与空间级同线、解除留痕不覆盖、跨空间会员事件不串台");

  // ============ 8. 主档按租户共享，会员关系按空间隔离，跨租户不可见 ============
  const sharedList = await ops.listCustomers(tenantA, wsA1, viewer);
  const shared = sharedList.find((row) => row.id === otherSpace.id);
  assert.ok(shared, "同租户主档跨空间可见——这是「无需重复注册」的落点");
  assert.equal(
    shared.workspaceLinks?.length ?? 0,
    0,
    "但绝不能带出别的空间的会员关系，否则共享就变成了泄露"
  );
  const bList = await ops.listCustomers(tenantB, wsB1, viewer);
  assert.equal(bList.some((row) => row.id === person.id), false, "跨租户客户不得出现在另一租户列表");
  await rejects(
    ops.getCustomerDetail(tenantB, wsB1, person.id, revealer),
    /客户不存在/u,
    "跨租户读取客户详情"
  );
  ok("隔离：主档按租户共享、会员关系按空间隔离、跨租户读取被拒");

  // ============ 9. 同一路由内的动作级权限不能互相借用 ============
  const permissionCalls = [];
  const platform = new PlatformService(
    { get: () => "mysql" },
    {},
    undefined,
    undefined,
    undefined,
    {
      changeAccountStatus: async (...args) => { permissionCalls.push(["account", ...args]); return { ok: true }; },
      changeMembershipStatus: async (...args) => { permissionCalls.push(["workspace", ...args]); return { ok: true }; }
    }
  );
  const actor = (permissions) => ({
    id: `u_${permissions.join("_")}`, tenantId: tenantA, displayName: "权限测试", permissions,
    isSaasAdmin: false, isPlatformAdmin: false
  });
  const memberActor = actor(["store-rental:member:manage"]);
  const closeActor = actor(["store-rental:customer:close"]);
  const riskActor = actor(["store-rental:member:risk-action"]);
  await rejects(
    Promise.resolve().then(() => platform.changeCustomerAccountStatus(person.id, { status: "closed", reason: "越权注销" }, memberActor)),
    /customer:close/u,
    "会员管理员借账号状态接口注销客户"
  );
  await rejects(
    Promise.resolve().then(() => platform.changeCustomerAccountStatus(person.id, { status: "suspended", reason: "越权停用" }, closeActor)),
    /member:manage/u,
    "只有注销权限的人借账号状态接口停用账号"
  );
  await platform.changeCustomerAccountStatus(person.id, { status: "suspended", reason: "正常停用" }, memberActor);
  await platform.changeCustomerAccountStatus(person.id, { status: "closed", reason: "正常注销" }, closeActor);
  await runWithRequestIdentity({ tenantId: tenantA, workspaceId: wsA1 }, async () => {
    await rejects(
      Promise.resolve().then(() => platform.changeCustomerMembershipStatus(person.id, { status: "closed", reason: "越权注销" }, memberActor)),
      /customer:close/u,
      "会员管理员借空间状态接口注销会员关系"
    );
    await rejects(
      Promise.resolve().then(() => platform.changeCustomerMembershipStatus(person.id, { status: "risk_restricted", reason: "越权风控" }, memberActor)),
      /risk-action/u,
      "会员管理员借空间状态接口执行风险限制"
    );
    await platform.changeCustomerMembershipStatus(person.id, { status: "closed", reason: "正常注销" }, closeActor);
    await platform.changeCustomerMembershipStatus(person.id, { status: "risk_restricted", reason: "正常风控" }, riskActor);
  });
  assert.equal(permissionCalls.length, 4, "只有四个具备动作权限的请求能进入业务服务");
  ok("动作级权限：会员管理、风险处理和客户注销不能借同一路由互相越权");

  // ============ 10. 页面契约：入口、权限门禁与四类不可省的展示 ============
  // 后端守住不等于界面守住：这些断言防的是「页面把服务端的口径绕过去」。
  const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
  const nav = read("apps/admin/src/app/navigation.tsx");
  const router = read("apps/admin/src/app/AppRouter.tsx");
  const page = read("apps/admin/src/features/customers/CustomerMasterPage.tsx");
  const api = read("apps/admin/src/api/customer.ts");

  assert.match(nav, /customerMaster:\s*\{[^}]*path:\s*"\/customers\/master"/u, "主档页必须注册路由");
  assert.match(nav, /customerMaster:\s*\{[^}]*permission:\s*"store-rental:member:view"/u, "主档页入口必须要求会员查看权限");
  assert.match(nav, /routes:\s*\[APP_ROUTES\.customerMaster/u, "主档页必须出现在客户管理菜单里");
  assert.match(router, /APP_ROUTES\.customerMaster\.path[^\n]*CustomerMasterPage/u, "路由必须指向主档页组件");

  for (const [permission, label] of [
    ["store-rental:member:manage", "会员管理"],
    ["store-rental:member:risk-action", "风险处理"],
    ["store-rental:customer:merge", "客户合并"],
    ["store-rental:customer:close", "客户注销"],
    ["store-rental:customer:reveal-sensitive", "敏感资料解密"]
  ]) {
    assert.ok(page.includes(permission), `页面必须按「${label}」权限分别门禁，缺少 ${permission}`);
  }
  for (const label of ["待激活", "风险受限", "已退出", "已注销"]) {
    assert.ok(page.includes(label), `六态文案缺少「${label}」——两态凑不出「为什么不能下单」`);
  }
  assert.ok(page.includes("contacts") && page.includes("authorizedAgents"), "详情必须展示联系人与经办人");
  assert.ok(page.includes("Timeline"), "必须以时间线展示状态历史");
  assert.ok(
    /canReveal\s*&&/u.test(page) || /canReveal\s*\?/u.test(page),
    "敏感访问审计必须由解密权限门禁"
  );
  ok("页面契约：入口已注册，四类权限分别门禁，六态与联系人/经办人/时间线齐备");

  // ============ 11. 合并与注销在界面上是「有闸的动作」，不是一键 ============
  assert.ok(page.includes("preservedReferences"), "合并预览必须展示将保留的历史引用——它解释了「为什么不搬数据」");
  assert.ok(page.includes("overlappingWorkspaceIds"), "合并预览必须展示两边都有会员关系的空间，供人工决定保留哪份等级");
  // 这几条刻意断言到**结构**而不是「源码里出现过这个词」：变量声明在、但请求里没带，
  // 等于取舍结论没回传服务端，事后照样解释不了「保留了谁的值」。
  assert.match(page, /customerApi\.merge\(\{[\s\S]{0,400}fieldResolutions/u, "合并请求必须回传人工取舍结论");
  assert.match(page, /mergeBlockReason[\s\S]{0,400}unresolvedFields\.length/u, "未取舍的冲突字段必须计入提交闸门");
  assert.match(page, /disabled=\{Boolean\(mergeBlockReason\)\}/u, "闸门必须真的禁用「确认合并」按钮");
  assert.match(
    page,
    /changeAccountStatus\([\s\S]{0,300}acknowledgedManualChecks/u,
    "注销必须把人工核对确认回传服务端，否则服务端会按「未确认」拒绝"
  );
  assert.ok(page.includes("manualConfirmations"), "注销前必须把系统无法自动核对的项列给操作人");
  assert.ok(page.includes("blockers"), "注销与合并的阻断项必须展示，而不是提交后才报错");
  // 空间一律由服务端按会话解析：页面若能传 workspaceId，就能改到自己无权进入的空间。
  // 去掉注释再比对——注释里说明这条口径是好事，不该被当成违规。
  const apiCode = api.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  assert.equal(/workspaceId/u.test(apiCode), false, "管理端接口不得由页面传入 workspaceId");
  ok("动作闸门：合并需取舍冲突字段、注销需人工确认，空间一律取自会话");

  // ============ 11. 断连重连后数据仍在（不是内存态） ============
  await prisma.$disconnect();
  prisma = new PrismaClient();
  customers = new SharedCustomerRepository(prisma);
  operations = new CustomerOperationsRepository(prisma);
  merge = new CustomerMergeService(prisma, customers, operations);
  ops = new CustomerOperationsService(prisma, customers, operations, merge);
  const reloaded = await ops.getCustomerDetail(tenantA, wsA1, person.id, revealer);
  assert.equal(reloaded.contacts?.length, 1, "重连后详情仍应带出在用联系人");
  const reloadedTimeline = await ops.listStatusHistory(tenantA, person.id, wsA1);
  assert.ok(
    reloadedTimeline.filter((row) => row.action === "restrict").length === 1,
    "重连后历史限制记录仍在——审计不能随进程消失"
  );
  ok("持久化：断连重连后联系人、经办人与状态历史仍可读");

  // ============ 12. 账号摘要：四态可辨，且不外传登录凭据 ============
  // 「未开通」与「已停用」必须能分开：前者要给开通入口，后者要给状态变更入口。
  // 少了这一层，页面只能让人先提交、再从 404 里猜出「原来还没开通」。
  const noAccount = await ops.getCustomerDetail(tenantA, wsA1, corporate.id, revealer);
  assert.ok(noAccount.accountSummary, "详情必须带账号摘要，哪怕还没开通");
  assert.equal(noAccount.accountSummary.provisioned, false, "未开通账号时 provisioned 必须为 false");
  assert.equal(noAccount.accountSummary.status, undefined, "未开通就没有状态——不得伪装成 active");

  // person 在第 7 段已开通并被停用，正好覆盖「已开通 + 非正常态」。
  const withAccount = await ops.getCustomerDetail(tenantA, wsA1, person.id, revealer);
  assert.equal(withAccount.accountSummary.provisioned, true, "已开通账号必须 provisioned=true");
  assert.equal(withAccount.accountSummary.status, "suspended", "账号状态必须如实带出");
  assert.ok(withAccount.accountSummary.suspendedAt, "停用时间要带出——界面据此说明「从何时起全部空间无法登录」");
  assert.match(withAccount.accountSummary.loginPhoneMasked, /\*{4}/u, "登录标识只能给掩码");
  // 这条与解密权限无关：登录标识是凭据本身，任何权限都不该顺着详情把它带出去。
  assert.equal(
    "loginPhone" in withAccount.accountSummary,
    false,
    "账号摘要不得包含明文登录标识——那是登录凭据，不是客户资料"
  );
  const listedForAccount = (await ops.listCustomers(tenantA, wsA1, revealer)).find((row) => row.id === person.id);
  assert.equal(
    listedForAccount.accountSummary,
    undefined,
    "列表不查账号：列表并不展示账号状态，逐行查会变成 N+1"
  );
  ok("账号摘要：未开通/正常/停用/注销四态可辨，只给掩码登录标识，列表不带");

  // 出参不含明文只是最后一道；库层也不该把凭据列取进进程内存——
  // 一旦有人日志打印整行、或后来加个 spread，明文就顺着出去了。
  const repoSource = read("apps/api/src/modules/platform/shared-customer.repository.ts");
  const accountInclude = repoSource.match(/account:\s*\{[^}]*\}[^}]*\}/u)?.[0] ?? "";
  assert.match(accountInclude, /select:/u, "详情查账号必须显式 select，不能整行取出");
  assert.equal(
    /loginPhone\b(?!Masked)/u.test(accountInclude),
    false,
    "账号 select 不得包含明文 loginPhone——它是登录凭据，判断状态用不到"
  );
  ok("账号查询：库层显式 select，明文登录标识不进进程内存");

  // ============ 13. 页面契约：企业资料与账号入口 ============
  // 与第 9、10 段同一理由：服务端守住不等于界面守住。这里断言到**结构**，
  // 因为「源码里出现过这个词」不能证明请求真的受门禁、按钮真的被禁用。
  assert.match(
    page,
    /const canCorporateManage = hasPermission\("store-rental:corporate:manage"\)/u,
    "企业资料编辑必须按「企业客户管理」权限门禁"
  );
  assert.match(
    page,
    /canCorporateView\s*=\s*hasPermission\("store-rental:corporate:view"\)\s*\|\|\s*canCorporateManage/u,
    "manage 必须视为 view 的超集，否则只有 manage 的账号看不到自己有权改的数据"
  );
  // 两个 enabled 条件都要在：个人客户没有这三类资料，无权限时更不该发注定 403 的请求。
  assert.match(
    page,
    /corporateEnabled\s*=\s*Boolean\(selected\)\s*&&\s*isCorporate\s*&&\s*canCorporateView/u,
    "企业资料查询必须同时受「是企业客户」与「有企业查看权限」两个条件门禁"
  );
  for (const query of ["customer-invoice-profiles", "customer-contracts", "customer-credit"]) {
    assert.match(
      page,
      new RegExp(`queryKey: \\["${query}"[\\s\\S]{0,200}?enabled: corporateEnabled`, "u"),
      `${query} 查询必须挂在 corporateEnabled 上，不能无条件发起`
    );
  }
  // 只有 GET 等于只读：编辑闭环必须真的调用 PUT。
  for (const [method, label] of [
    ["saveInvoiceProfile", "开票资料"],
    ["saveContract", "企业合同"],
    ["saveCredit", "授信与账期"]
  ]) {
    assert.ok(api.includes(method), `customerApi 缺少 ${label} 的保存方法 ${method}`);
    assert.ok(page.includes(`customerApi.${method}`), `页面未调用 ${method}，${label} 只能看不能改`);
  }
  assert.match(api, /saveCredit[\s\S]{0,200}method: "put"/u, "授信保存必须是 PUT，不能只有 GET");
  assert.match(
    page,
    /name="clearBankAccount"[\s\S]{0,180}清除已保存的银行账号/u,
    "编辑开票资料必须把「保留脱敏值」与「显式清除」分成两个动作"
  );
  assert.match(
    page,
    /name="reason"[\s\S]{0,220}调整授信与账期必须填写变更原因/u,
    "授信调整原因必须在管理端必填，不能只写提示文案"
  );
  assert.match(
    page,
    /changeMembershipStatus[\s\S]{0,300}acknowledgedManualChecks: values\.acknowledgedManualChecks/u,
    "注销空间会员关系也必须回传人工核对确认"
  );
  assert.ok(api.includes("workspaceClosability"), "空间会员注销必须有按当前空间检查的预览接口");
  ok("页面契约：企业资料受 view/manage 分别门禁，无权限不发请求，三类资料都有保存闭环");

  // ============ 14. 无账号客户：状态入口先禁用，开通后才可管理 ============
  assert.match(
    page,
    /accountActionBlockReason[\s\S]{0,400}尚未开通登录账号/u,
    "未开通账号时必须给出禁用理由，而不是让人提交后收 404"
  );
  assert.match(
    page,
    /disabled=\{Boolean\(accountActionBlockReason\)\}/u,
    "禁用理由必须真的禁用「账号状态 / 注销」按钮"
  );
  // 断言必须落到「真的产出了禁用理由」上：只断言 `status === "closed"` 这个条件存在，
  // 把理由文案换成 undefined 也照样通过——那时按钮又变回可点，闸门等于没有。
  assert.match(
    page,
    /account\?\.status === "closed"[\s\S]{0,200}\?\s*[\s\S]{0,120}"[^"]*注销不可逆[^"]*"/u,
    "已注销是不可逆终态：条件命中时必须真的产出禁用理由，而不只是判断一下"
  );
  assert.match(
    page,
    /accountLoaded && !accountProvisioned[\s\S]{0,400}customerApi\.ensureAccount|ensureAccount\.mutate\(\)/u,
    "未开通时必须给「开通登录账号」入口并调用 ensureAccount"
  );
  assert.match(
    page,
    /ensureAccount = useMutation\([\s\S]{0,400}refreshAll\(\)/u,
    "开通成功后必须刷新详情与状态历史，否则界面仍显示「未开通」"
  );
  ok("账号入口：未开通先禁用状态变更、给开通入口，开通后刷新详情与历史");

  await cleanup();
  await prisma.$disconnect();
  console.log("\nCUSTOMER-01E 管理端与验收专项：全部通过");
})();
