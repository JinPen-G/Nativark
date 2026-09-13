/**
 * 逐路由核对鉴权覆盖。
 *
 * 为什么需要它：`requiredPermissions` 的兜底早前是 `return []`，而 `hasAnyPermission`
 * 对空数组直接放行——于是每一个没被显式分支覆盖的路由都是**完全无鉴权**的接口。
 * 这不是理论风险，`/rental-os/marketing/plans` 的增改就长期落在兜底里。
 * 兜底已改为默认拒绝（`UNMATCHED_ROUTE_PERMISSION`），但「默认拒绝」只把漏网路由
 * 从静默放行变成运行时 403——真正要防的是**新增路由时忘记补权限**，
 * 那种错误只有在有人访问该路由时才会暴露。因此这里在验收阶段就逐路由核对：
 * 任何控制器路由要么命中一条显式权限规则，要么在公共白名单里，否则本脚本失败。
 */

const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node"
  }
});

const {
  requiredPermissions,
  PUBLIC_ROUTES,
  PUBLIC_ROUTE_PREFIXES,
  isClientRoute,
  UNMATCHED_ROUTE_PERMISSION
} = require("../apps/api/src/common/api-auth.guard");

const isPublic = (routePath) =>
  PUBLIC_ROUTES.has(routePath) ||
  PUBLIC_ROUTE_PREFIXES.some((prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`));

const repoRoot = path.resolve(__dirname, "..");
const controllerRoot = path.join(repoRoot, "apps", "api", "src", "modules");

function readControllerFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...readControllerFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".controller.ts")) files.push(fullPath);
  }
  return files;
}

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
  for (const file of readControllerFiles(controllerRoot)) {
    const source = fs.readFileSync(file, "utf8");
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

const routes = controllerRoutes();
if (routes.length === 0) {
  console.error("未发现任何控制器路由，路由提取逻辑可能已失效（这本身就是缺陷）。");
  process.exit(1);
}

const unmatched = [];
const zeroPermission = [];
const undeclared = new Map();

/**
 * seed.ts 的 `permissions` 目录是 Permission 表的唯一写入源，而所有授权路径都按表里
 * 已有的行过滤（platform.repository 的 findMany + filter、replaceRolePermissions 的
 * `code in (...)`）。守卫要求一个表里不存在的权限码时，角色预设与管理端勾选都会被静默
 * 丢弃，结果是该路由对除平台管理员以外的所有人 403——而本脚本原来只检查「能不能解析出
 * 权限」，这类错误一次都抓不到。ORDER-CLOSE-02 的费用裁定权就是这么漏的。
 */
function declaredPermissionCodes() {
  const source = fs.readFileSync(path.join(repoRoot, "apps", "api", "prisma", "seed.ts"), "utf8");
  const start = source.indexOf("const permissions = [");
  if (start < 0) throw new Error("未能在 apps/api/prisma/seed.ts 里定位 permissions 目录");
  const end = source.indexOf("\n];", start);
  if (end < 0) throw new Error("permissions 目录没有结束标记，无法解析");
  return new Set([...source.slice(start, end).matchAll(/\["([^"]+)"/gu)].map((match) => match[1]));
}
const declared = declaredPermissionCodes();

for (const route of routes) {
  // 客户端 API 使用独立的 ClientAuthService/token 认证域，不属于运营 RBAC 权限树。
  // 这里跳过的是静态“运营权限码”检查，不代表路由匿名放行；运行时 Guard 仍会
  // 对除登录/注册等公开端点外的客户端路由校验客户令牌。
  if (isClientRoute(route.path)) continue;
  const permissions = requiredPermissions(route.method, route.path);
  if (permissions.includes(UNMATCHED_ROUTE_PERMISSION)) {
    unmatched.push(route);
    continue;
  }
  // 零权限只允许出现在显式公共白名单里：其余任何"零权限"都是放行漏洞。
  if (permissions.length === 0 && !isPublic(route.path)) {
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
    console.error(`以下 ${unmatched.length} 个路由没有命中任何鉴权规则（运行时会 403，但应显式声明权限）：`);
    for (const route of unmatched) console.error(`  ${route.method.padEnd(6)} ${route.path}   ← ${route.source}`);
  }
  if (zeroPermission.length) {
    console.error(`以下 ${zeroPermission.length} 个路由被判定为"无需任何权限"且不在公共白名单中，属放行漏洞：`);
    for (const route of zeroPermission) console.error(`  ${route.method.padEnd(6)} ${route.path}   ← ${route.source}`);
  }
  if (undeclared.size) {
    console.error(`以下 ${undeclared.size} 个权限码被守卫要求，但不在 apps/api/prisma/seed.ts 的 permissions 目录里：`);
    for (const [code, affected] of undeclared) {
      console.error(`  ${code}   ← ${affected.length} 个路由，例如 ${affected[0].method} ${affected[0].path}`);
    }
    console.error("Permission 表里没有这一行时，角色预设与管理端勾选都会被静默丢弃，该路由对非平台管理员一律 403。");
  }
  console.error("请在 apps/api/src/common/api-auth.guard.ts 的 requiredPermissions 中补齐，或将确属公共的路由加入 PUBLIC_ROUTES。");
  process.exit(1);
}

console.log(`Route permission check passed: ${routes.length} controller routes all resolve to explicit permissions.`);
