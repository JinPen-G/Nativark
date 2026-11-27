/**
 * 逐路由核对鉴权覆盖。
 *
 * 为什么需要它：`requiredPermissions` 的兜底早前是 `return []`，而 `hasAnyPermission`
 * 对空数组直接放行——于是每一个没被显式分支覆盖的路由都是**完全无鉴权**的接口。
 * 这不是理论风险，`/rental-os/marketing/plans` 的增改就长期落在兜底里。
 * 兜底已改为默认拒绝（`UNMATCHED_ROUTE_PERMISSION`），但「默认拒绝」只把漏网路由
 * 从静默放行变成运行时 403——真正要防的是**新增路由时忘记补权限**，
 * 那种错误只有在有人访问该路由时才会暴露。因此这里在验收阶段就逐路由核对：
 * 显式选择公共或 Rental 原权威与权限目录。宿主模式只检查实际挂载的 Controller，
 * 可再限定源码范围；目录模式保留原静态扫描。本人/专用身份政策不等于匿名放行。
 */

const fs = require("node:fs");
const path = require("node:path");
const { controllerSources, createControllerSourceLoader, checkedPath } = require("./controller-sources.cjs");
const { controllerOperations } = require("./validate-api-contracts.cjs");

async function main() {
const args = process.argv.slice(2), selection = { controllerRoots: [] };
let repoRoot = path.resolve(__dirname, ".."), deps, permissionsFile, permissionExport, authority, offlinePrisma = false;
const host = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--offline-prisma") { offlinePrisma = true; continue; }
  const value = args[i + 1];
  if (!value) throw new Error("源码选择参数缺少值");
  if (args[i] === "--source-root") repoRoot = path.resolve(value);
  else if (args[i] === "--controllers") selection.controllerRoots.push(value);
  else if (args[i] === "--permissions") permissionsFile = value;
  else if (args[i] === "--permission-export") permissionExport = value;
  else if (args[i] === "--authority") authority = value;
  else if (args[i] === "--app-module") host.appModule = value;
  else if (args[i] === "--module-export") host.moduleExport = value;
  else if (args[i] === "--schema") selection.schemaPath = value;
  else if (args[i] === "--deps") deps = value;
  else throw new Error("只接受 --source-root / --controllers 或 --app-module / --module-export / --authority / --permissions / --permission-export / --schema / --offline-prisma / --deps");
  i++;
}
if ((!selection.controllerRoots.length && !host.appModule)
  || !permissionsFile || !["platform", "rental"].includes(authority))
  throw new Error("路由权限检查必须显式选择 --authority platform|rental、--controllers 或 --app-module，以及 --permissions");
if (authority === "platform" && !permissionExport) throw new Error("公共权限目录必须显式选择 --permission-export");
permissionsFile = checkedPath(repoRoot, permissionsFile);
const loader = createControllerSourceLoader(repoRoot, deps, selection);
if (offlinePrisma) console.log(JSON.stringify(await loader.prepareOfflinePrisma()));
const formal = name => loader.load(loader.resolveSource(__filename, name, true));
// 只装载被选中的真实权威；公共检查不反向加载 Rental / Shared。
const rules = authority === "platform" ? formal("@rental-os/platform-server")
  : formal("@rental-os/rental-core/http-auth").createRentalAuthorization(formal("@rental-os/shared"));

/** 控制器前缀 + 方法路由 → 守卫看到的路径（已剥掉全局 /api 前缀）。 */
function guardPath(prefix, route) {
  const joined = [prefix, route].filter((part) => part !== undefined && part !== "").join("/").replace(/\/+/g, "/");
  const withLeading = `/${joined}`.replace(/\/+$/, "") || "/";
  // 路径参数用一个普通段占位：守卫的判定都是前缀或 `[^/]+` 形态的正则，
  // 占位值本身不参与判定；小写化与运行时 matchableRequestPath 保持一致。
  return withLeading.replace(/:([A-Za-z0-9_]+)/g, "sample").toLowerCase();
}

function controllerRoutes() {
  const routes = [];
  for (const [file, source] of controllerSources(repoRoot, deps, selection)) {
    const controllerMatch = source.match(/@Controller\((?:"([^"]*)")?\)/);
    if (!controllerMatch) continue;
    const prefix = controllerMatch[1] ?? "";
    const routeRegex = /@(Get|Post|Put|Patch|Delete)\((?:"([^"]*)")?\)/g;
    let match;
    while ((match = routeRegex.exec(source))) {
      routes.push({
        method: match[1].toUpperCase(),
        path: guardPath(prefix, match[2] ?? ""),
        source: path.relative(repoRoot, file)
      });
    }
  }
  return routes;
}

const selectedDirectories = selection.controllerRoots.map(directory => checkedPath(repoRoot, directory, "directory"));
const routes = host.appModule ? (await controllerOperations(loader, host))
  .filter(route => !selectedDirectories.length || selectedDirectories.some(directory => {
    // 源码范围只筛实际挂载的 Controller；不把可选模块的未挂端口当作默认宿主漏权。
    const relative = path.relative(directory, path.resolve(repoRoot, route.source.split("#")[0]));
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  })).map(route => ({ ...route,
  method: route.method.toUpperCase(), path: route.path.replace(/^\/api(?=\/|$)/u, "").replace(/\{[^}]+\}/gu, "sample").toLowerCase() }))
  : controllerRoutes();
if (routes.length === 0) {
  console.error("未发现任何控制器路由，路由提取逻辑可能已失效（这本身就是缺陷）。");
  process.exit(1);
}

const unmatched = [];
const zeroPermission = [];
const undeclared = new Map();

/**
 * 所选原 seed 或公共权限出口决定可分配权限，而角色授权路径按表里
 * 已有的行过滤（platform.repository 的 findMany + filter、replaceRolePermissions 的
 * `code in (...)`）。守卫要求一个表里不存在的权限码时，角色预设与管理端勾选都会被静默
 * 丢弃，结果是该路由对除平台管理员以外的所有人 403——而本脚本原来只检查「能不能解析出
 * 权限」，这类错误一次都抓不到。ORDER-CLOSE-02 的费用裁定权就是这么漏的。
 */
function declaredPermissionCodes() {
  if (permissionExport) {
    const rows = loader.load(permissionsFile)[permissionExport];
    if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || typeof row.code !== "string" || !row.code.trim()))
      throw new Error("所选权限出口必须为非空 code 目录");
    const codes = new Set(rows.map(row => row.code));
    if (codes.size !== rows.length) throw new Error("所选权限目录含重复 code");
    return codes;
  }
  const source = fs.readFileSync(permissionsFile, "utf8");
  const start = source.indexOf("const permissions = [");
  if (start < 0) throw new Error("未能在 所选权限目录 里定位 permissions 目录");
  const end = source.indexOf("\n];", start);
  if (end < 0) throw new Error("permissions 目录没有结束标记，无法解析");
  const codes = new Set([...source.slice(start, end).matchAll(/\["([^"]+)"/gu)].map((match) => match[1]));
  if (!codes.size) throw new Error("所选权限目录为空，不能以空集合通过");
  return codes;
}
const declared = declaredPermissionCodes();
// This tenant-owned summary still requires authentication, but intentionally carries no commercial RBAC permission.
const authenticatedSummaries = new Set(["GET /platform/subscription/reminder"]);

for (const route of routes) {
  // 客户端 API 使用独立的 ClientAuthService/token 认证域，不属于运营 RBAC 权限树。
  // 这里跳过的是静态“运营权限码”检查，不代表路由匿名放行；运行时 Guard 仍会
  // 对除登录/注册等公开端点外的客户端路由校验客户令牌。
  if (authority === "rental" && rules.isClientRoute(route.path)) continue;
  const policy = authority === "platform" ? rules.platformHttpPolicy(route.method, route.path) : undefined;
  const permissions = authority === "platform" ? rules.platformHttpPermissions(policy) : rules.requiredPermissions(route.method, route.path);
  const knownAccess = ["anonymous", "self", "tenant", "saas", "authenticated", "tenant_summary", "saas_subscription", "saas_demo_request"];
  if (authority === "platform" ? !policy || !knownAccess.includes(policy.access) : permissions.includes(rules.UNMATCHED_ROUTE_PERMISSION)) {
    unmatched.push(route);
    continue;
  }
  // 零权限只允许出现在显式公共白名单里：其余任何"零权限"都是放行漏洞。
  // 无权限码的本人/租户摘要/专用 SaaS 入口仍受原 Guard 身份政策控制，不能泛化为公开。
  const allowsNoPermission = authority === "platform"
    ? ["anonymous", "self", "tenant_summary", "saas_subscription", "saas_demo_request"].includes(policy.access)
    : rules.PUBLIC_ROUTES.has(route.path) || rules.PUBLIC_ROUTE_PREFIXES.some(prefix => route.path === prefix || route.path.startsWith(`${prefix}/`))
      || authenticatedSummaries.has(`${route.method} ${route.path}`);
  if (permissions.length === 0 && !allowsNoPermission) {
    zeroPermission.push(route);
  }
  for (const code of permissions) {
    if (declared.has(code)) continue;
    if (!undeclared.has(code)) undeclared.set(code, []);
    undeclared.get(code).push(route);
  }
}

if (unmatched.length || zeroPermission.length || undeclared.size) {
  if (unmatched.length) {
    console.error(`以下 ${unmatched.length} 个路由没有命中所选权威的显式鉴权规则：`);
    for (const route of unmatched) console.error(`  ${route.method.padEnd(6)} ${route.path}   ← ${route.source}`);
  }
  if (zeroPermission.length) {
    console.error(`以下 ${zeroPermission.length} 个路由未声明权限，且不属于所选权威允许的无权限码政策：`);
    for (const route of zeroPermission) console.error(`  ${route.method.padEnd(6)} ${route.path}   ← ${route.source}`);
  }
  if (undeclared.size) {
    console.error(`以下 ${undeclared.size} 个权限码被守卫要求，但不在 所选权限目录 的 permissions 目录里：`);
    for (const [code, affected] of undeclared) {
      console.error(`  ${code}   ← ${affected.length} 个路由，例如 ${affected[0].method} ${affected[0].path}`);
    }
    console.error("权限目录缺项不能用于角色分配；仅身份授权的入口仍须按原 Guard 单独核定，不能据本检查推断运行时放行或拒绝。");
  }
  console.error(`请核对所选 ${authority} 原权威与权限目录；本检查不补权限或放行规则。`);
  process.exit(1);
}

console.log(`Route permission check passed (${authority}): ${routes.length} controller routes, ${declared.size} declared permissions.`);
}

if (require.main === module) main().catch(error => {
  for (let cause = error; cause; cause = cause.cause) console.error(cause.cause ? cause.message : cause.stack ?? cause);
  process.exitCode = 1;
});
