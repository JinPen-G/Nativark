const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const navigation = read("apps/admin/src/app/navigation.tsx");
const router = read("apps/admin/src/app/AppRouter.tsx");
const api = read("apps/admin/src/api/rental.ts");
const page = read("apps/admin/src/features/tenant-access/TenantAccessPages.tsx");

assert.match(navigation, /tenantAccounts: \{ path: "\/tenant\/accounts"[\s\S]*audience: "tenant"/u);
assert.match(navigation, /tenantRoles: \{ path: "\/tenant\/roles"[\s\S]*audience: "tenant"/u);
assert.match(router, /TenantOperationsAccountPage/u);
assert.match(router, /TenantRolePermissionPage/u);
assert.match(api, /workspaceMembers: \(workspaceId: string\)/u);
assert.match(api, /saveWorkspaceMember: \(workspaceId: string/u);
assert.match(page, /空间角色（操作权限）/u);
assert.match(page, /数据范围/u);
assert.match(page, /currentUserId/u, "必须保护当前登录账号，避免自停用或撤销当前空间");
assert.match(page, /isActive: row\.enabled/u, "关闭空间访问必须真正写回成员状态");
assert.doesNotMatch(page, /audience: "saas"/u);

console.log("Tenant access admin contract passed: tenant routes, RBAC, workspace membership, operation/data split.");
