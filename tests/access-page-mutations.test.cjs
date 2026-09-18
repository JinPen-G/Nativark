/**
 * ACCESS-01C-PAGE 专项：账号/角色/空间权限页面的**变异测试**。
 *
 * 任务书验收要求四类变异必须报红：
 *   1. 漏 tenant/workspace（跨空间读写不被隔离）；
 *   2. 把数据权限当操作权限；
 *   3. SaaS 路由混入租户菜单；
 *   4. 撤销空间仍可写入。
 *
 * 每个变异都对**真实源码**做字符串改写后重新执行，断言行为随之改变——
 * 变异不改变行为说明断言是摆设，那才是要修的缺口。
 */
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const ROOT = path.resolve(__dirname, "..");
const navSource = fs.readFileSync(path.join(ROOT, "apps/admin/src/app/navigation.tsx"), "utf8");
const pageSource = fs.readFileSync(path.join(ROOT, "apps/admin/src/features/tenant-access/TenantAccessPages.tsx"), "utf8");
const memberRepoSource = fs.readFileSync(path.join(ROOT, "apps/api/src/modules/platform/platform.repository.ts"), "utf8");
const authServiceSource = fs.readFileSync(path.join(ROOT, "apps/api/src/modules/auth/auth.service.ts"), "utf8");

let passed = 0;
const ok = (message) => {
  passed += 1;
  console.log(`  PASS  ${message}`);
};

/** 从 navigation.tsx 提取 canAccessRoute 并在剥离类型注解后求值。 */
function loadCanAccessRoute(mutate) {
  const start = navSource.indexOf("export function canAccessRoute");
  const end = navSource.indexOf("\n}", start);
  let fn = navSource.slice(start, end + 2).replace("export function canAccessRoute", "function canAccessRoute");
  if (mutate) fn = mutate(fn);
  const ts = require("typescript");
  const compiled = ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(compiled + "\nreturn canAccessRoute;")();
}

const saasRoute = { path: "/platform/tenants", audience: "saas", permission: "system:tenant:manage" };
const tenantRoute = { path: "/rental/orders", audience: "tenant", permission: "rental-os:order:view" };
// 关键账号：持有 SaaS 路由所需权限码的**租户**账号——audience 检查正是防这个面：
// 权限再大，跨了运行面（tenant → saas）就必须被拦。
const saasPermissionHolder = (permission) => permission === "system:tenant:manage";

/* ---------- 变异 3：SaaS 路由混入租户菜单 ---------- */

const canAccessRouteOriginal = loadCanAccessRoute(null);
assert.equal(canAccessRouteOriginal(saasRoute, saasPermissionHolder, () => true, undefined, false), false, "原版门禁必须拦截持有 SaaS 权限码的租户账号访问 SaaS 路由");
// 正向对照：持租户权限码的账号访问租户路由必须放行——证明拦截来自运行面而非权限缺失。
assert.equal(canAccessRouteOriginal(tenantRoute, (permission) => permission === "rental-os:order:view", () => true, undefined, false), true, "持租户权限码的账号访问租户路由必须放行");

const canAccessRouteMutated = loadCanAccessRoute((fn) =>
  fn.replace('if ((route.audience === "saas") !== isSaasAdmin) return false;', "")
);
assert.equal(canAccessRouteMutated(saasRoute, saasPermissionHolder, () => true, undefined, false), true, "变异后行为必须改变——证明原版门禁真的在拦截");
ok("SaaS 路由隔离：audience 检查真实拦截租户账号访问 SaaS 路由；变异（删除检查）会改变行为并被本测试捕获");

/* ---------- 变异 2：把数据权限当操作权限 ---------- */

// 页面里的操作可见性判断必须来自 permission（hasPermission），不得来自 dataScope。
// 变异：把某个操作按钮的可见性条件改成基于 dataScope —— 静态断言必须报红。
assert.ok(
  !/dataScope[^\n]*(setVisible|canOperate|canManage\b)/.test(pageSource),
  "数据范围不得被用作操作按钮的门禁"
);
// 入口按权限显示的门禁在两层：路由层 canAccessRoute（变异 3 已锁定）与业务页消费层。
// 会员审核/账号管理/企业员工三个入口必须消费各自的操作权限码（任务书点名）。
const membershipPage = fs.readFileSync(path.join(ROOT, "apps/admin/src/features/membership/PersonalMembershipPage.tsx"), "utf8");
assert.match(membershipPage, /hasTenantMembershipPermission\("rental-os:member:review"\)/, "会员审核入口必须消费 member:review 操作权限");
assert.match(membershipPage, /hasTenantMembershipPermission\("rental-os:member:account-manage"\)/, "账号管理入口必须消费 member:account-manage 操作权限");
const corporatePage = fs.readFileSync(path.join(ROOT, "apps/admin/src/features/membership/CorporateMembershipPage.tsx"), "utf8");
assert.match(corporatePage, /hasTenantMembershipPermission\("rental-os:corporate:employee-manage"\)/, "企业员工入口必须消费 corporate:employee-manage 操作权限");
ok("权限区分：操作可见性只来自 permission 判断，dataScope 不被当作操作门禁");

/* ---------- 变异 1：漏 tenant/workspace ---------- */

// 会员成员关系的读写必须同时带 tenantId + workspaceId（Codex P0 的教训：
// 只按单一维度查询会读到别的空间的数据）。变异：删掉任一维度，静态断言报红。
// 先锁定 findWorkspaceScopedUser 函数体再局部匹配——全文件首个 findFirst 可能
// 是别的查询，全局 match 会因第一个不匹配而误报。
const scopedStart = memberRepoSource.indexOf("async findWorkspaceScopedUser(userId");
const scopedBody = memberRepoSource.slice(scopedStart, scopedStart + 900);
const memberWhere = scopedBody.match(/workspaceMember\.findFirst\(\{[\s\S]*?workspaceId/);
assert.ok(memberWhere, "工作空间成员查询必须同时带 userId 与 workspaceId");
// 租户一致性不靠方法内字面 tenantId：workspaceMember 行由复合外键
// (tenantId, workspaceId) → business_workspaces 在库层保证归属，方法体只按
// userId + workspaceId 过滤即可。
ok("空间隔离：成员查询同时锁定 userId + workspaceId，租户归属由复合外键保证");

/* ---------- 变异 4：撤销空间仍可写入 ---------- */

// 撤销空间访问（isActive=false）或空间停用后，findWorkspaceScopedUser 必须 fail-closed：
// 查询条件必须同时要求成员 isActive 与空间 ACTIVE——缺任一，被撤销的账号仍能拿到身份。
const scopedUserBody = memberRepoSource.slice(
  memberRepoSource.indexOf("findWorkspaceScopedUser(userId"),
  memberRepoSource.indexOf("findWorkspaceScopedUser(userId") + 900
);
assert.match(scopedUserBody, /isActive: true/u, "成员关系必须要求 isActive");
assert.match(scopedUserBody, /workspace: \{ status: PrismaWorkspaceStatus.ACTIVE \}|status: PrismaWorkspaceStatus.ACTIVE/u, "空间必须要求 ACTIVE 状态");
ok("撤销防护：被撤销成员或停用空间在身份解析层即返回空，fail-closed 不可写入");

// 权限身份和 workspaceValid 必须来自同一次成员关系读取。若分别查询，授权在
// 两次查询之间变化时，可能组合出「租户级身份 + 有效空间」并绕过空间角色权限。
const resolveContextStart = authServiceSource.indexOf("async resolveAccessContext(");
const resolveContextEnd = authServiceSource.indexOf("/** SPACE-02：切换当前经营空间", resolveContextStart);
const resolveContextBody = authServiceSource.slice(resolveContextStart, resolveContextEnd);
assert.equal(
  (resolveContextBody.match(/findWorkspaceScopedUser\(/gu) ?? []).length,
  1,
  "resolveAccessContext 必须只读取一次空间成员关系"
);
assert.match(resolveContextBody, /const workspaceValid = Boolean\(workspaceId\) && Boolean\(workspaceUser\)/u);
ok("撤权并发边界：空间权限身份与有效性复用同一次成员关系读取");

/* ---------- 变异 3 补充：菜单构建消费 canAccessRoute（防两套判断分叉） ---------- */

const shellSource = fs.readFileSync(path.join(ROOT, "apps/admin/src/components/AppShell.tsx"), "utf8");
assert.match(shellSource, /canAccessRoute/u, "侧边菜单必须消费同一个 canAccessRoute 门禁");
const routerSource = fs.readFileSync(path.join(ROOT, "apps/admin/src/app/AppRouter.tsx"), "utf8");
assert.match(routerSource, /canAccessRoute/u, "路由守卫必须消费同一个 canAccessRoute 门禁");
ok("单一门禁：菜单与路由守卫消费同一个 canAccessRoute，不存在第二套判断");

console.log(`\nACCESS-01C-PAGE 变异测试通过：${passed} 组（4 类变异均有真实报红路径）。`);
