const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const navigation = read("apps/admin/src/app/navigation.tsx");
const router = read("apps/admin/src/app/AppRouter.tsx");
const api = read("apps/admin/src/api/platform.ts");
const page = read("apps/admin/src/features/tenant-access/TenantAccessPages.tsx");
const permissionService = read("apps/api/src/modules/platform/platform.service.ts");
const permissionRepository = read("apps/api/src/modules/platform/platform.repository.ts");
const permissionMigration = read("apps/api/prisma/migrations/20260913000400_tenant_neutral_permission_labels/migration.sql");

assert.match(navigation, /tenantAccounts: \{ path: "\/tenant\/accounts"[\s\S]*audience: "tenant"/u);
assert.match(navigation, /tenantRoles: \{ path: "\/tenant\/roles"[\s\S]*audience: "tenant"/u);
assert.match(router, /TenantOperationsAccountPage/u);
assert.match(router, /TenantRolePermissionPage/u);
assert.match(api, /workspaceMembers: \(workspaceId: string\)/u);
assert.match(api, /saveUserWithWorkspaceAccess: \(payload: SaveSystemUserAccessRequest\)/u);
assert.match(page, /空间角色（操作权限）/u);
assert.match(page, /数据范围/u);
assert.match(page, /currentUserId/u, "必须保护当前登录账号，避免自停用或撤销当前空间");
assert.match(page, /isActive: row\.enabled/u, "关闭空间访问必须真正写回成员状态");
assert.match(page, /api\.saveUserWithWorkspaceAccess\(payload\)/u, "账号资料与空间授权必须走单事务入口");
assert.doesNotMatch(api, /saveWorkspaceMember/u, "空间授权只能经 saveUserWithWorkspaceAccess 单事务写入，不得再暴露独立成员写接口");
assert.doesNotMatch(page, /audience: "saas"/u);
assert.match(permissionService, /code: "rental-os",\s*name: "租赁业务"/u, "内存权限目录必须使用租户中立的业务模块名");
assert.match(permissionRepository, /return \{ code: "rental-os", name: "租赁业务" \}/u, "数据库权限目录必须使用租户中立的业务模块名");
assert.doesNotMatch(permissionService, /code: "rental-os",\s*name: "门市租赁"/u, "权限目录不得回退到旧门市模块名");
assert.match(permissionMigration, /SET `module` = '租赁业务'/u, "已有数据库的权限模块名必须通过迁移收口");

console.log("Tenant access admin contract passed: tenant routes, RBAC, workspace membership, operation/data split.");
