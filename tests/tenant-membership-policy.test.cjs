// Run from the current source checkout: node --test tests/tenant-membership-policy.test.cjs
// No DB, HTTP server, generated Prisma client, or built shared package is required.
// These are policy-unit tests, NOT evidence of transactions, foreign keys, persistence,
// token authentication, or the actual idempotency service's replay implementation.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const loaded = new Map();
const noAccess = (label) => new Proxy({}, {
  get(_target, property) { throw new Error(`Unexpected ${label} access: ${String(property)}`); }
});
const noDatabase = noAccess("database (this suite is DB-free)");
const browserWindow = {
  localStorage: { getItem: () => null },
  addEventListener() {}
};
const iconNames = [
  "ApartmentOutlined", "ApiOutlined", "AppstoreOutlined", "BoxPlotOutlined",
  "CalendarOutlined", "ControlOutlined", "DashboardOutlined", "FileSearchOutlined",
  "FileTextOutlined", "FormOutlined", "FundOutlined", "IdcardOutlined",
  "SafetyCertificateOutlined", "SettingOutlined", "ShopOutlined", "TagsOutlined",
  "TeamOutlined", "ToolOutlined"
];
const iconStubs = Object.fromEntries(iconNames.map((name) => [name, () => null]));
const externalModules = new Set([
  "@nestjs/common", "zustand", "react/jsx-runtime", "node:crypto", "node:async_hooks"
]);
const sourceModules = new Set([
  "apps/admin/src/app/navigation.tsx",
  "apps/admin/src/app/navigation-terminology.ts",
  "apps/admin/src/features/auth/authStore.ts",
  "apps/api/src/common/api-auth.guard.ts",
  "apps/api/src/common/request-path.ts",
  "apps/api/src/common/request-identity.ts",
  "apps/api/src/common/password.ts",
  "apps/api/src/common/data-permission.ts",
  "apps/api/src/modules/platform/platform.repository.ts",
  "apps/api/src/modules/client/client-api.service.ts"
]);

/**
 * Execute entire, unmodified TS/TSX modules from THIS checkout, including private
 * methods after TS erasure. Do not extract/reimplement policy functions or read dist.
 * Disabling decorator metadata removes constructor-type imports, so no application
 * dependency graph / PrismaService is loaded just to construct these unit subjects.
 * An explicit import allowlist prevents new dependencies from silently opening a DB.
 */
function loadSource(relativePath) {
  const filename = path.resolve(root, relativePath);
  const normalized = path.relative(root, filename).split(path.sep).join("/");
  assert.ok(sourceModules.has(normalized) || /^packages\/shared\/src\/[^/]+\.ts$/u.test(normalized),
    `Unexpected source dependency: ${normalized}`);
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.ReactJSX,
      experimentalDecorators: true,
      emitDecoratorMetadata: false,
      esModuleInterop: true
    }
  });
  const errors = (compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")), [],
    `Cannot transpile ${normalized}`);
  const module = { exports: {} };
  loaded.set(filename, module);
  const nativeRequire = createRequire(filename);
  const localRequire = (request) => {
    if (request === "@rental-os/shared") return loadSource("packages/shared/src/index.ts");
    if (request === "@ant-design/icons") return iconStubs; // Presentation only, not permission policy.
    if (request === "@/api/platform") return { api: noAccess("auth HTTP") };
    if (request === "@/app/queryClient") return { clearSessionQueryCache() { assert.fail("Unexpected query cache access"); } };
    if (request === "@prisma/client") {
      // Only the enum used by the real toUserRow -> resolveUserDataScope path.
      // No PrismaClient and no repository query implementation are supplied.
      return { SystemDataScope: { ALL: "ALL", ORGANIZATION: "ORGANIZATION", STORE: "STORE", OWN: "OWN" } };
    }
    if (externalModules.has(request)) return nativeRequire(request);
    if (request.startsWith(".")) {
      const dependency = path.resolve(path.dirname(filename), request);
      const fullPath = path.extname(dependency) ? dependency : `${dependency}.ts`;
      return loadSource(path.relative(root, fullPath));
    }
    throw new Error(`Unexpected dependency ${request} from ${normalized}`);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", "window",
    `${compiled.outputText}\n//# sourceURL=${filename.replace(/\\/gu, "/")}`
  )(module.exports, localRequire, module, filename, path.dirname(filename), browserWindow);
  return module.exports;
}

const shared = loadSource("packages/shared/src/index.ts");
const { RentalCategoryCode, RoleScope, membershipBenefitScopeMatches } = shared;
const { APP_ROUTES, canAccessRoute } = loadSource("apps/admin/src/app/navigation.tsx");
const { useAuthStore } = loadSource("apps/admin/src/features/auth/authStore.ts");
const { ApiAuthGuard, isTenantMembershipRoute } = loadSource("apps/api/src/common/api-auth.guard.ts");
const { runWithRequestIdentity, getRequestIdentity } = loadSource("apps/api/src/common/request-identity.ts");
const { PlatformRepository } = loadSource("apps/api/src/modules/platform/platform.repository.ts");
const { ClientApiService } = loadSource("apps/api/src/modules/client/client-api.service.ts");
const { ForbiddenException, NotFoundException } = createRequire(path.join(root, "apps/api/package.json"))("@nestjs/common");

const MEMBER_VIEW = "rental-os:member:view";
const MEMBER_MANAGE = "rental-os:member:manage";
const CORPORATE_VIEW = "rental-os:corporate:view";
const ORDER_VIEW = "rental-os:order:view";
const tenantId = "tenant-policy";
const workspaceId = "workspace-camera";
const otherWorkspaceId = "workspace-camera-other";
const camera = RentalCategoryCode.Camera;
const camping = RentalCategoryCode.Camping;

// Scope absence is the existing tenant-wide default; unknown NONEMPTY shapes must
// fail closed. Workspace selection and category selection are distinct dimensions.
for (const [label, scope, workspace, category, expected] of [
  ["legacy absent scope covers tenant", undefined, workspaceId, camera, true],
  ["explicit tenant scope covers current space", { type: "tenant" }, workspaceId, camera, true],
  ["explicit tenant scope covers another category/space", { type: "tenant" }, otherWorkspaceId, camping, true],
  ["selected workspace matches", { type: "workspaces", workspaceIds: [workspaceId] }, workspaceId, camera, true],
  ["same category cannot bypass workspace scope", { type: "workspaces", workspaceIds: [workspaceId] }, otherWorkspaceId, camera, false],
  ["any selected workspace matches", { type: "workspaces", workspaceIds: [otherWorkspaceId, workspaceId] }, workspaceId, camping, true],
  ["category matches in current space", { type: "categories", categoryCodes: [camera] }, workspaceId, camera, true],
  ["category matches in another space", { type: "categories", categoryCodes: [camera] }, otherWorkspaceId, camera, true],
  ["other category does not match even in same space", { type: "categories", categoryCodes: [camera] }, workspaceId, camping, false],
  ["any selected category matches", { type: "categories", categoryCodes: [camping, camera] }, workspaceId, camera, true],
  ["empty workspace list denies", { type: "workspaces", workspaceIds: [] }, workspaceId, camera, false],
  ["missing workspace list denies", { type: "workspaces" }, workspaceId, camera, false],
  ["string workspace list denies", { type: "workspaces", workspaceIds: workspaceId }, workspaceId, camera, false],
  ["null workspace list denies", { type: "workspaces", workspaceIds: null }, workspaceId, camera, false],
  ["empty category list denies", { type: "categories", categoryCodes: [] }, workspaceId, camera, false],
  ["missing category list denies", { type: "categories" }, workspaceId, camera, false],
  ["string category list denies", { type: "categories", categoryCodes: camera }, workspaceId, camera, false],
  ["null category list denies", { type: "categories", categoryCodes: null }, workspaceId, camera, false],
  ["unknown scope kind denies", { type: "future-scope", workspaceIds: [workspaceId] }, workspaceId, camera, false],
  ["missing discriminator denies", {}, workspaceId, camera, false],
  ["wrong discriminator case denies", { type: "TENANT" }, workspaceId, camera, false],
  ["array shape denies", ["tenant"], workspaceId, camera, false],
  ["string shape denies", "tenant", workspaceId, camera, false]
]) {
  test(`benefit scope: ${label}`, () => {
    assert.equal(membershipBenefitScopeMatches(scope, workspace, category), expected);
  });
}

function user(overrides = {}) {
  return {
    id: "operator-policy", tenantId, account: "policy-operator", displayName: "Policy operator",
    roleIds: [], roleNames: [], scope: RoleScope.Operator, dataScope: "all",
    isActive: true, isPlatformAdmin: false, isSaasAdmin: false, mustChangePassword: false,
    permissions: [], ...overrides
  };
}
function tenantMembership(permissions, dataScope = "all", isTenantAdmin = false) {
  return { permissions, dataScope, isTenantAdmin };
}
function navigationAccess(route, currentUser) {
  useAuthStore.setState({ user: currentUser, tenant: undefined });
  const state = useAuthStore.getState();
  return canAccessRoute(route, state.hasPermission, state.hasCapability, undefined,
    Boolean(currentUser?.isSaasAdmin), state.hasTenantMembershipPermission);
}
const membershipRoutes = [
  ["personalMembers", MEMBER_VIEW], ["corporateMembers", CORPORATE_VIEW],
  ["membershipReviews", MEMBER_VIEW], ["membershipPlans", MEMBER_VIEW]
];
for (const [routeName, permission] of membershipRoutes) {
  test(`navigation: ${routeName} uses tenant membership policy, never workspace wildcard`, () => {
    const route = APP_ROUTES[routeName];
    assert.ok(route, `Missing actual route ${routeName}`);
    const workspaceAdmin = user({ isPlatformAdmin: true, permissions: ["*"] });
    assert.equal(navigationAccess(route, workspaceAdmin), false, "Missing tenantMembership must fail closed");
    assert.equal(navigationAccess(route, {
      ...workspaceAdmin, tenantMembership: tenantMembership([])
    }), false, "Workspace admin/wildcard cannot grant tenant membership permission");
    assert.equal(navigationAccess(route, {
      ...workspaceAdmin, tenantMembership: tenantMembership([permission], "store")
    }), false, "A matching permission without tenant-wide data scope is insufficient");
    assert.equal(navigationAccess(route, user({
      tenantMembership: tenantMembership([permission])
    })), true, "Tenant permission works without workspace permissions or category");
    assert.equal(navigationAccess(route, user({
      tenantMembership: tenantMembership(["*"])
    })), true, "Tenant-wide wildcard remains a valid tenant permission");
    assert.equal(navigationAccess(route, user({
      tenantMembership: tenantMembership([], "all", true)
    })), true, "Explicit tenant admin works without workspace admin");
    assert.equal(navigationAccess(route, user({
      isSaasAdmin: true, permissions: ["*"], tenantMembership: tenantMembership(["*"], "all", true)
    })), false, "SaaS is not a tenant membership audience");
    assert.equal(canAccessRoute(route, () => true, () => true, camera, false), false,
      "Omitting the sixth checker must not fall back to workspace access");
    assert.equal(canAccessRoute(route, () => true, () => true, camera, true, () => true), false,
      "Audience restriction also holds even if both permission callbacks allow");
    assert.equal(canAccessRoute(route, () => { assert.fail("Membership route consulted workspace permissions"); },
      () => true, undefined, false, (code) => code === permission), true);
  });
}

for (const [routeName, legacyPermission] of [
  ["membershipReviews", "rental-os:member:review"],
  ["membershipReviews", "rental-os:member:qualification-review"],
  ["corporateMembers", "rental-os:corporate:manage"],
  ["corporateMembers", "rental-os:corporate:employee-manage"],
  ["membershipPlans", "rental-os:member:plan:manage"],
  ["membershipPlans", "rental-os:member:plan:publish"]
]) {
  test(`navigation: legacy ${legacyPermission} must also come from tenant policy`, () => {
    assert.equal(navigationAccess(APP_ROUTES[routeName], user({
      permissions: [legacyPermission], tenantMembership: tenantMembership([])
    })), false);
    assert.equal(navigationAccess(APP_ROUTES[routeName], user({
      tenantMembership: tenantMembership([legacyPermission])
    })), true);
  });
}

test("navigation: non-membership orders still use workspace permissions", () => {
  assert.equal(navigationAccess(APP_ROUTES.orders, user({
    permissions: [ORDER_VIEW], tenantMembership: tenantMembership([])
  })), true);
  assert.equal(navigationAccess(APP_ROUTES.orders, user({ permissions: ["*"] })), true);
  assert.equal(navigationAccess(APP_ROUTES.orders, user({
    tenantMembership: tenantMembership(["*"], "all", true)
  })), false, "Tenant membership admin must not become a business permission");
  assert.equal(canAccessRoute(APP_ROUTES.orders, (code) => code === ORDER_VIEW,
    () => true, camera, false, () => { assert.fail("Order route consulted tenant membership permissions"); }), true);
  assert.equal(navigationAccess(APP_ROUTES.workbench, user({
    permissions: ["rental-core:maintenance:view"]
  })), true, "Non-membership legacy access must remain supported");
});

test("guard classifier: shared membership/customer endpoints versus workspace-only endpoints", () => {
  for (const endpoint of ["/membership", "/membership/personal", "/membership/reviews", "/membership/plans",
    "/membership/corporate", "/membership/benefit-scope-options", "/platform/customers", "/platform/customers/customer-a"]) {
    assert.equal(isTenantMembershipRoute(endpoint), true, endpoint);
  }
  for (const endpoint of ["/membership/qualification-types", "/membership/qualification-types/type-a",
    "/platform/workspace-customers", "/rental/v1/orders", "/membership-other", "/platform/customers-other"]) {
    assert.equal(isTenantMembershipRoute(endpoint), false, endpoint);
  }
});

function accessContext(tenantUser, effectiveUser = user({ permissions: ["*"], isPlatformAdmin: true }), overrides = {}) {
  return { tenantUser, user: effectiveUser, workspaceId, workspaceValid: true, hasWorkspaces: true, ...overrides };
}
function guardHarness(access, method, url) {
  const calls = [];
  const request = { method, url, headers: { authorization: "Bearer policy-token" } };
  const auth = {
    async resolveAccessContext(token, options) { calls.push({ token, options }); return access; },
    async getCategoryContext() { assert.fail("This policy case has no capability gate"); }
  };
  const guard = new ApiAuthGuard(auth);
  return {
    request, calls,
    activate: () => runWithRequestIdentity({}, async () => {
      const allowed = await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) });
      return { allowed, identity: { ...getRequestIdentity() } };
    })
  };
}
async function assertForbidden(harness, message) {
  await assert.rejects(harness.activate, (error) => {
    assert.ok(error instanceof ForbiddenException, `Expected actual ForbiddenException, got ${error}`);
    assert.equal(error.getStatus(), 403);
    if (message) assert.match(error.message, message);
    return true;
  });
  assert.equal(harness.request.user, undefined, "Rejected request must not acquire an authenticated business user");
}

for (const [method, url] of [
  ["POST", "/api/membership/personal"],
  ["PUT", "/api/membership/corporate/corporate-a"],
  ["POST", "/api/membership/plans"],
  ["POST", "/api/membership/reviews/review-a/approve"],
  ["PUT", "/api/platform/customers/customer-a"],
  ["GET", "/api/platform/customers/customer-a/sensitive-access"],
  ["PUT", "/API//MEMBERSHIP/PERSONAL/customer-a/?workspaceId=untrusted"]
]) {
  test(`guard: valid workspace wildcard cannot authorize tenant shared operation ${method} ${url}`, async () => {
    const base = user({ permissions: [MEMBER_VIEW] });
    const harness = guardHarness(accessContext(base), method, url);
    await assertForbidden(harness);
    assert.deepEqual(harness.calls, [{ token: "Bearer policy-token", options: { allowInvalidWorkspace: true } }]);
  });
}

for (const dataScope of ["store", "organization", "own"]) {
  test(`guard: tenant ${dataScope} scope cannot write shared members even with wildcard`, async () => {
    await assertForbidden(guardHarness(accessContext(user({ permissions: ["*"], dataScope })),
      "POST", "/api/membership/personal"), /租户级全量数据范围/u);
  });
}

test("guard: tenant all+manage can write shared membership without workspace permission", async () => {
  const base = user({ permissions: [MEMBER_MANAGE] });
  const harness = guardHarness(accessContext(base, user()), "POST", "/api/membership/personal");
  assert.equal((await harness.activate()).allowed, true);
  assert.equal(harness.request.user, base, "Shared handler must receive tenant user, not effective workspace user");
});

for (const url of ["/api/membership/personal", "/api/membership/reviews", "/api/membership/plans",
  "/api/membership/benefit-scope-options", "/api/platform/customers"]) {
  test(`guard: no workspace, base all+member:view can read shared endpoint ${url}`, async () => {
    const base = user({ permissions: [MEMBER_VIEW] });
    const harness = guardHarness(accessContext(base, base, {
      workspaceId: undefined, workspaceValid: false, hasWorkspaces: false
    }), "GET", url);
    const result = await harness.activate();
    assert.equal(result.allowed, true);
    assert.equal(harness.request.user, base);
    assert.equal(result.identity.tenantId, tenantId);
    assert.equal(result.identity.userId, base.id);
    assert.equal(result.identity.workspaceId, undefined, "No default workspace may be invented");
    assert.equal(harness.calls[0].options.allowInvalidWorkspace, true);
  });
}

for (const extraPermissions of [[], [ORDER_VIEW]]) {
  test(`guard: no workspace still cannot read orders (extra order permission: ${extraPermissions.length > 0})`, async () => {
    const base = user({ permissions: [MEMBER_VIEW, ...extraPermissions] });
    const harness = guardHarness(accessContext(base, base, {
      workspaceId: undefined, workspaceValid: false, hasWorkspaces: false
    }), "GET", "/api/rental/v1/orders");
    await assertForbidden(harness, extraPermissions.length ? /没有经营空间/u : undefined);
    assert.equal(harness.calls[0].options.allowInvalidWorkspace, false);
  });
}

for (const suffix of ["qualifications", "benefits", "booking-options"]) {
  test(`guard: per-workspace member ${suffix} needs valid workspace context`, async () => {
    const base = user({ permissions: [MEMBER_VIEW] });
    await assertForbidden(guardHarness(accessContext(base, base, {
      workspaceId: undefined, workspaceValid: false, hasWorkspaces: false
    }), "GET", `/api/membership/personal/customer-a/${suffix}`), /经营空间上下文/u);
  });
}

test("guard: ordinary business and qualification-type routes still consume effective workspace user", async () => {
  const base = user();
  const effective = user({ permissions: ["*"] });
  for (const url of ["/api/rental/v1/orders", "/api/membership/qualification-types"]) {
    const harness = guardHarness(accessContext(base, effective), "GET", url);
    assert.equal((await harness.activate()).allowed, true);
    assert.equal(harness.request.user, effective);
    assert.equal(harness.calls[0].options.allowInvalidWorkspace, false);
  }
});

for (const url of ["/api/membership/personal", "/api/platform/customers"]) {
  test(`guard: SaaS admin cannot enter tenant membership ${url}`, async () => {
    const saas = user({ isSaasAdmin: true, isPlatformAdmin: true, permissions: ["*"] });
    await assertForbidden(guardHarness(accessContext(saas, saas), "GET", url), /SaaS/u);
  });
}

function role(id, overrides = {}) {
  return {
    id, tenantId, code: id, name: id, scope: "OPERATOR", isActive: true,
    fixedAllPermissions: false, dataScope: "OWN", permissions: [], buttonPermissions: [], ...overrides
  };
}
function rawUser(roles, legacyRole = null, overrides = {}) {
  return { ...user(), roleAssignments: roles.map((value) => ({ role: value })), role: legacyRole,
    organization: null, organizationId: null, ...overrides };
}
function permission(code) { return { permission: { code } }; }

for (const roleSource of ["roleAssignments", "legacy role", "both (deduplicated)"]) {
  test(`toUserRow: disabled fixedAllPermissions ${roleSource} cannot derive tenant admin`, () => {
    const disabled = role("disabled-admin", {
      isActive: false, fixedAllPermissions: true, dataScope: "ALL",
      permissions: [permission(MEMBER_MANAGE)], buttonPermissions: ["rental-os:customer:merge"]
    });
    const enabled = role("enabled-viewer", { permissions: [permission(MEMBER_VIEW)] });
    const assignments = roleSource === "legacy role" ? [enabled] : [disabled, enabled];
    const legacy = roleSource === "roleAssignments" ? null : disabled;
    const repository = new PlatformRepository(noDatabase);
    const mapped = repository.toUserRow(rawUser(assignments, legacy));
    assert.equal(mapped.isPlatformAdmin, false);
    assert.equal(mapped.isSaasAdmin, false);
    assert.deepEqual(mapped.permissions, [MEMBER_VIEW], "Disabled roles contribute neither wildcard nor explicit permissions");
    assert.equal(mapped.dataScope, "own", "Disabled ALL role contributes no data scope");
    assert.equal(mapped.roleIds.filter((id) => id === disabled.id).length, 1);
    assert.ok(mapped.roleNames.some((name) => name === `${disabled.name}（停用）`), "Display retains disabled role without granting its rights");
  });
}

test("toUserRow: disabled admin alone has no rights; enabled/admin-flag controls still work", () => {
  const repository = new PlatformRepository(noDatabase);
  const disabled = role("disabled-admin-only", { isActive: false, fixedAllPermissions: true, dataScope: "ALL" });
  const denied = repository.toUserRow(rawUser([disabled]));
  assert.equal(denied.isPlatformAdmin, false);
  assert.deepEqual(denied.permissions, []);
  assert.equal(denied.dataScope, "own");
  const active = repository.toUserRow(rawUser([{ ...disabled, isActive: true }]));
  assert.equal(active.isPlatformAdmin, true);
  assert.deepEqual(active.permissions, ["*"]);
  assert.equal(active.dataScope, "all");
  const explicit = repository.toUserRow(rawUser([disabled], null, { isPlatformAdmin: true }));
  assert.equal(explicit.isPlatformAdmin, true, "A disabled role must not erase a separate explicit admin flag");
  assert.deepEqual(explicit.permissions, ["*"]);
});

const clientContext = {
  tenantId, tenantCode: "policy-tenant", workspaceId, workspaceCode: "camera", workspaceName: "Camera",
  categoryCode: camera, customerId: "personal-self", displayName: "Member", membershipStatus: "active", sessionId: "client-session"
};
const extension = { id: "extension-a", status: "effective" };
const clientActions = [
  { method: "cancelOrder", action: "order.cancel", invoke: (service, req) => service.cancelOrder(clientContext, "order-a", { reason: "Customer cancellation" }, req) },
  { method: "applyExtension", action: "order.extend", invoke: (service, req) => service.applyExtension(clientContext, "order-a", { newEndAt: "2030-06-03T10:00:00.000Z" }, req) },
  { method: "payExtension", action: "order.extend.pay", invoke: (service, req) => service.payExtension(clientContext, "order-a", extension.id, req) }
];
function clientHarness(action, orderOwner) {
  const events = [];
  const executeCalls = [];
  const order = {
    id: "order-a", tenantId, workspaceId, orderNo: "POLICY-1", status: "cancelled",
    customerId: orderOwner.customerId, membershipSnapshot: orderOwner.membershipSnapshot,
    lines: [], chargeLines: []
  };
  const core = {
    async getOrder(actualTenant, orderId) {
      assert.equal(actualTenant, tenantId);
      assert.equal(orderId, order.id);
      events.push("ownership-read");
      return order;
    },
    getProfile: () => ({ categoryCode: camera }),
    listCategories: () => [{ code: camera }],
    getBusinessSettings: () => ({}),
    listItemGroups: () => [], listPricingGroups: () => [], listCouponTemplates: () => [],
    listLocations: () => [], listOperators: () => [],
    async persist() { events.push("core-persist"); }
  };
  const idempotent = {
    async executeWithReplayFlag(options) {
      events.push("executeWithReplayFlag");
      executeCalls.push(options);
      // A deliberately ready cached response: neither run nor replay is invoked.
      // Only tests whether the REAL client API checks ownership before this boundary;
      // does not pretend to test idempotency persistence, callbacks or transactions.
      return { result: action.method === "cancelOrder" ? order : { order, extension }, replayed: true };
    }
  };
  const unused = noAccess("unused client dependency");
  const service = new ClientApiService(noDatabase, unused, unused, core,
    { async persist() { events.push("business-persist"); } }, unused, idempotent,
    unused, unused, unused, unused, unused, unused, unused);
  return { service, events, executeCalls };
}

for (const action of clientActions) {
  for (const [ownerLabel, owner] of [
    ["someone else's personal order", { customerId: "personal-other" }],
    ["someone else's corporate order", { customerId: "corporate-a", membershipSnapshot: { personalCustomerId: "personal-other" } }]
  ]) {
    for (const requestContext of [undefined, { headers: { "idempotency-key": "already-completed-operation" } }]) {
      test(`client ${action.method}: ${ownerLabel} rejected before replay (${requestContext ? "explicit key" : "fallback key"})`, async () => {
        const harness = clientHarness(action, owner);
        await assert.rejects(() => action.invoke(harness.service, requestContext), (error) => {
          assert.ok(error instanceof NotFoundException, `Expected ownership NotFoundException, got ${error}`);
          assert.equal(error.getStatus(), 404);
          return true;
        });
        assert.deepEqual(harness.events, ["ownership-read"], "Must reject before replay, persistence or business side effects");
        assert.equal(harness.executeCalls.length, 0, "Even an existing cached result must not be consulted for another member's order");
      });
    }
  }
  for (const [ownerLabel, owner] of [
    ["direct customer", { customerId: clientContext.customerId }],
    ["corporate personal membership snapshot", { customerId: "corporate-a", membershipSnapshot: { personalCustomerId: clientContext.customerId } }]
  ]) {
    test(`client ${action.method}: ${ownerLabel} reaches replay only after ownership check`, async () => {
      const harness = clientHarness(action, owner);
      const result = await action.invoke(harness.service, { headers: { "idempotency-key": "already-completed-operation" } });
      assert.equal(result.replayed, true, "Authorized control proves this fixture does not reject all clients");
      assert.equal(result.order.id, "order-a");
      assert.deepEqual(harness.events.slice(0, 2), ["ownership-read", "executeWithReplayFlag"]);
      assert.equal(harness.executeCalls.length, 1);
      assert.equal(harness.executeCalls[0].tenantId, tenantId);
      assert.equal(harness.executeCalls[0].orderId, "order-a");
      assert.equal(harness.executeCalls[0].action, action.action);
    });
  }
}
