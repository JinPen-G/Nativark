const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const navigation = read("apps/admin/src/app/navigation.tsx");
const router = read("apps/admin/src/app/AppRouter.tsx");
const api = read("apps/admin/src/api/platform.ts");
const oldPage = read("apps/admin/src/features/tenant-access/TenantAccessPages.tsx");
const page = ["packages/platform-admin/src/features/access/PublicOperationsAccountPage.tsx", "packages/rental-core/admin/access/OperationsAccountPage.tsx"].map(read).join("\n");
const permissionService = [
  "apps/api/src/modules/platform/platform.service.ts",
  "packages/rental-core/src/permissions.ts"
].map(read).join("\n");
const permissionRepository = [
  "packages/platform-server/src/modules/platform/platform-management.repository.ts",
  "packages/platform-server/src/modules/platform/platform-management.service.ts",
  "packages/rental-core/src/public-management-compatibility.ts"
].map(read).join("\n");
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
assert.match(oldPage, /OriginalRentalOperationsAccountPage/u, "旧宿主复用同一原账号与空间表单");
assert.match(page, /business\.saveUser\(payload, signal\)/u, "账号表单经所选业务适配一次保存");
assert.match(page, /runtime\.request<SystemUserRow>\(payload\.id[\s\S]*?\/access[\s\S]*?\/platform\/users\/access/u, "账号资料与空间授权必须走原单事务access入口");
assert.match(page, /retryAuthentication: false/u, "空间授权保存不在401后重发");
assert.doesNotMatch(api, /saveWorkspaceMember/u, "空间授权只能经 saveUserWithWorkspaceAccess 单事务写入，不得再暴露独立成员写接口");
assert.doesNotMatch(page, /audience: "saas"/u);
assert.match(permissionService, /code: "rental-os",\s*name: "租赁业务"/u, "内存权限目录必须使用租户中立的业务模块名");
assert.match(permissionService, /createRentalLegacyPermissionModules\(\)/u, "原内存权限目录消费 Rental 的同源目录数据");
assert.match(permissionRepository, /return \{ code: "rental-os", name: "租赁业务" \}/u, "数据库权限目录必须使用租户中立的业务模块名");
assert.match(permissionRepository, /compatibility\.permissionModule\(permission\)/u, "原权限目录使用同一公共应用的固定兼容参加者");
assert.doesNotMatch(permissionService, /code: "rental-os",\s*name: "门市租赁"/u, "权限目录不得回退到旧门市模块名");
assert.match(permissionMigration, /SET `module` = '租赁业务'/u, "已有数据库的权限模块名必须通过迁移收口");

console.log("Tenant access admin contract passed: tenant routes, RBAC, workspace membership, operation/data split.");

// Read the actual source callbacks: transport and React lifecycle are explicit offline fixtures.
const { test } = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");
function actual(file, name, context, member) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = "(" + node.getText(source).replace(/^export\s+/, "") + ")";
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
      const value = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer;
      if (member && ts.isObjectLiteralExpression(value)) {
        const property = value.properties.find(item => item.name?.getText(source) === member);
        assert.ok(property, member + " must remain on the actual adapter");
        found = "({" + property.getText(source) + "})." + member;
      } else found = "(" + value.getText(source) + ")";
    }
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(found, name + " actual callback must exist");
  const scope = { ...context, DOMException, AbortSignal, exports: {},
    require: name => { assert.equal(name, "react/jsx-runtime"); return require(name); }, result: undefined };
  vm.runInNewContext(ts.transpileModule("globalThis.result = " + found, { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, scope);
  return { callback: scope.result, scope };
}
const accountPage = "packages/platform-admin/src/features/access/PublicOperationsAccountPage.tsx";
const rentalAccountPage = "packages/rental-core/admin/access/OperationsAccountPage.tsx";
const tenantPage = "packages/platform-admin/src/features/access/PublicTenantManagementPage.tsx";
const rentalTenantPage = "packages/rental-core/admin/access/TenantManagementPage.tsx";

test("account Enter and SaveButton share one original save, preserving a single selected base role", async () => {
  let finish, writes = 0, sent;
  const save = { mutateAsync: values => { writes++; sent = values; return new Promise(resolve => { finish = resolve; }); } };
  const { callback } = actual(accountPage, "submit", { pending: { current: null }, save });
  const first = callback({ account: "operator", displayName: "Operator", roleId: "role-1", isActive: true });
  const second = callback({ account: "operator", displayName: "Operator", roleId: "role-1", isActive: true });
  assert.equal(first, second); assert.equal(writes, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), { account: "operator", displayName: "Operator", roleIds: ["role-1"], isActive: true });
  finish({ id: "original-user" }); assert.equal((await first).id, "original-user");
});

test("Rental account save retains existing disabled assignments and the original atomic access endpoint", async () => {
  const calls = [], signal = new AbortController().signal;
  let current = true, data = "original-directory";
  const { callback } = actual(rentalAccountPage, "business", {
    assertCurrent: () => { if (!current) throw new DOMException("stale", "AbortError"); },
    ready: true, baseline: { current: data }, currentData: () => data, t: value => value,
    workspaceMap: new Map([["one", { status: "active" }], ["two", { status: "active" }], ["three", { status: "disabled" }]]),
    accessRows: [
      { workspaceId: "one", enabled: true, existed: false, roleId: "operator", dataScope: "store", locationScope: { mode: "selected", locationIds: ["location-1"] } },
      { workspaceId: "two", enabled: false, existed: true, roleId: "reader", dataScope: "own", locationScope: { mode: "all", locationIds: [] } },
      { workspaceId: "three", enabled: true, existed: true, roleId: "reader", dataScope: "own", locationScope: { mode: "all", locationIds: [] } },
    ],
    runtime: { request: async (url, options) => { calls.push({ url, options }); return { id: "original/user", temporaryPassword: undefined }; } },
  }, "saveUser");
  await callback({ id: "original/user", roleIds: ["base"], account: "operator" }, signal);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "/platform/users/original%2Fuser/access");
  assert.equal(calls[0].options.retryAuthentication, false); assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[0].options.data.workspaceAccesses.length, 2);
  assert.equal(calls[0].options.data.workspaceAccesses[1].isActive, false);
  assert.deepEqual(Array.from(calls[0].options.data.workspaceAccesses[0].locationScope.locationIds), ["location-1"]);
  data = "changed-directory"; await assert.rejects(callback({ account: "operator" }, signal), /核对/);
  current = false; await assert.rejects(callback({ account: "operator" }, signal), { name: "AbortError" });
  assert.equal(calls.length, 1, "stale drafts and revoked pages cannot issue another write");
});

test("Rental tenant initialization uses one original bootstrap transaction and preserves blank-location semantics", async () => {
  const calls = [], signal = new AbortController().signal, tenant = { tenantId: "tenant-1", categoryCode: "camera" }, admin = { account: "admin" };
  const { callback } = actual(rentalTenantPage, "business", {
    current: () => signal, operator: "SaaS operator",
    runtime: { request: async (url, options) => { calls.push({ url, options }); return { tenant, adminUser: admin, temporaryPassword: "synthetic-one-time-password" }; } },
  }, "createTenant");
  const result = await callback({ tenantCode: "sample", tenantName: "Sample", categoryCode: "camera", categoryVersionId: "version-7", currency: "HKD",
    adminAccount: "admin", adminDisplayName: "Administrator", storeName: "   ", storeCode: "" }, signal);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "/platform/tenant-bootstrap");
  assert.equal(calls[0].options.retryAuthentication, false); assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[0].options.data.storeName, undefined); assert.equal(calls[0].options.data.storeCode, undefined);
  assert.equal(calls[0].options.data.categoryVersionId, "version-7"); assert.equal(calls[0].options.data.currency, "HKD");
  assert.equal(result.tenant, tenant); assert.equal(result.admin, admin);
  assert.equal(result.temporaryPassword, "synthetic-one-time-password");
});

test("public tenant creation cannot fall through to Rental or retry an unconfirmed operation", async () => {
  const calls = [], signal = new AbortController().signal;
  const { callback: mutation, scope } = actual(tenantPage, "createTenant", {
    current: () => signal, life: { runtime: { getSession: () => ({ user: { isSaasAdmin: true } }) } },
    canManagePublicResource: user => user?.isSaasAdmin === true, createTenant: { error: null }, tenants: { data: [], error: null }, business: undefined,
    t: value => value, api: { createTenant: async (payload, inputSignal) => { calls.push({ payload, inputSignal }); return { tenant: { tenantId: "public-tenant" } }; } },
    closeEditor() {}, modal: {}, refreshAfter() {}, message: {},
  });
  const input = { tenantCode: "sample", tenantName: "Sample", adminAccount: "admin", adminDisplayName: "Administrator", categoryCode: "camera" };
  await mutation.mutationFn(input);
  assert.equal(calls.length, 1); assert.equal(calls[0].inputSignal, signal);
  assert.equal("categoryCode" in calls[0].payload, false, "zero Core creation sends only original public fields");
  scope.createTenant.error = new Error("unconfirmed"); await assert.rejects(mutation.mutationFn(input), /核对/);
  assert.equal(calls.length, 1);
});

test("tenant buttons and native Enter share one request and a stale page cannot start a write", async () => {
  let writes = 0, finish, live = true;
  const { callback } = actual(tenantPage, "submit", {
    pending: { current: null }, current: () => { if (!live) throw new DOMException("stale", "AbortError"); }, tenants: { data: [], error: null },
    editor: { type: "create" }, t: value => value,
    createTenant: { mutateAsync: () => { writes++; return new Promise(resolve => { finish = resolve; }); } },
  });
  const first = callback({ tenantCode: "sample" }), second = callback({ tenantCode: "sample" });
  assert.equal(first, second); await Promise.resolve(); assert.equal(writes, 1);
  finish({ tenant: { tenantId: "tenant" } }); await first;
  live = false; await assert.rejects(callback({ tenantCode: "sample" }), { name: "AbortError" }); assert.equal(writes, 1);
});
