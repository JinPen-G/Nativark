const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
    experimentalDecorators: true,
    emitDecoratorMetadata: true
  }
});

const { ApiAuthGuard } = require("../apps/api/src/common/api-auth.guard");
const { getRequestTenantId } = require("../apps/api/src/common/request-identity");
const { hashPassword, verifyPassword } = require("../apps/api/src/common/password");
const { AuthService } = require("../apps/api/src/modules/auth/auth.service");
const { PlatformService } = require("../apps/api/src/modules/platform/platform.service");
const { RoleScope, TenantStatus } = require("@store-rental/shared");

const config = {
  get(key) {
    if (key === "PLATFORM_DATA_SOURCE") return "memory";
    if (key === "AUTH_TOKEN_SECRET") return "saas-foundation-test-secret";
    return undefined;
  }
};

function requestContext(method, url, accessToken) {
  const request = {
    method,
    url,
    headers: { authorization: `Bearer ${accessToken}` }
  };
  return {
    request,
    context: {
      switchToHttp() {
        return { getRequest: () => request };
      }
    }
  };
}

(async () => {
  const platform = new PlatformService(config, undefined);
  const auth = new AuthService(platform, config);
  const guard = new ApiAuthGuard(auth);

  const saas = await auth.login({
    tenantCode: "platform",
    account: "admin",
    password: "RentalOS!2026"
  });
  const demo = await auth.login({
    tenantCode: "demo",
    account: "admin",
    password: "RentalDemo!2026"
  });

  assert.equal(saas.user.isSaasAdmin, true);
  assert.equal(saas.user.isPlatformAdmin, false, "SaaS admin must not be a tenant admin");
  assert.equal(demo.user.isSaasAdmin, false);
  assert.equal(demo.user.isPlatformAdmin, true);
  assert.equal(platform.listTenants(saas.user).length, 2);
  assert.throws(() => platform.listTenants(demo.user), /SaaS/);

  const crossTenantUsers = platform.listUsers("tenant_002", demo.user);
  assert.ok(crossTenantUsers.length > 0);
  assert.ok(crossTenantUsers.every((user) => user.tenantId === "tenant_001"));
  assert.ok(
    platform.listOrganizations("tenant_002", demo.user).every((row) => row.tenantId === "tenant_001")
  );
  const scopedAudit = await platform.listAuditLogs({ tenantId: "tenant_002" }, demo.user);
  assert.ok(scopedAudit.rows.every((row) => row.tenantId === "tenant_001"));

  const otherTenantPreset = await platform.saveFilterPreset(
    {
      tenantId: "tenant_002",
      scopeKey: "store-rental.orders",
      name: "深圳租户预设",
      filters: { status: "active" }
    },
    saas.user
  );
  await assert.rejects(
    platform.deleteFilterPreset(otherTenantPreset.id, undefined, demo.user),
    /筛选预设不存在/
  );

  await assert.rejects(
    platform.saveOrganization(
      {
        id: "org_operator_sz",
        tenantId: "tenant_001",
        type: RoleScope.Operator,
        code: "ILLEGAL-MOVE",
        name: "越权迁移",
        status: "enabled"
      },
      demo.user
    ),
    /组织不存在/
  );
  assert.throws(
    () =>
      platform.saveRole(
        {
          id: "role_tenant_admin_002",
          tenantId: "tenant_001",
          code: "TENANT_ADMIN",
          name: "越权修改",
          scope: RoleScope.Operator,
          enabledBusinessScopes: [],
          permissions: [],
          isActive: true
        },
        demo.user
      ),
    /角色不存在/
  );

  const bootstrapped = await platform.bootstrapTenant(
    {
      tenantCode: "camera_test",
      tenantName: "摄影租赁测试租户",
      categoryCode: "camera",
      operator: saas.user.displayName,
      adminAccount: "owner",
      adminDisplayName: "租户负责人"
    },
    saas.user
  );
  assert.equal(bootstrapped.tenant.categoryCode, "camera");
  assert.equal(bootstrapped.adminUser.isSaasAdmin, false);
  assert.equal(bootstrapped.adminUser.isPlatformAdmin, true);
  assert.equal(bootstrapped.adminUser.mustChangePassword, true);
  assert.ok(bootstrapped.temporaryPassword);
  await assert.rejects(
    platform.bootstrapTenant(
      {
        tenantCode: "invalid_category",
        tenantName: "无效品类租户",
        categoryCode: "invalid",
        operator: saas.user.displayName,
        adminAccount: "owner",
        adminDisplayName: "负责人"
      },
      saas.user
    ),
    /经营品类不存在/
  );

  const temporaryLogin = await auth.login({
    tenantCode: "camera_test",
    account: "owner",
    password: bootstrapped.temporaryPassword
  });
  assert.equal(temporaryLogin.user.mustChangePassword, true);
  const blocked = requestContext("GET", "/api/rental/v1/profile", temporaryLogin.accessToken);
  await assert.rejects(guard.canActivate(blocked.context), /必须先修改密码/);

  const changed = await auth.changePassword(
    `Bearer ${temporaryLogin.accessToken}`,
    { currentPassword: bootstrapped.temporaryPassword, newPassword: "CameraOwner!2026" }
  );
  assert.equal(changed.user.mustChangePassword, false);
  assert.equal(await auth.resolveAccessToken(`Bearer ${temporaryLogin.accessToken}`), undefined);
  assert.ok(await auth.resolveAccessToken(`Bearer ${changed.accessToken}`));

  const rotated = await auth.refresh({ refreshToken: demo.refreshToken });
  await assert.rejects(auth.refresh({ refreshToken: demo.refreshToken }), /会话已失效/);
  assert.ok(await auth.resolveAccessToken(`Bearer ${rotated.accessToken}`));

  const saasReport = requestContext("GET", "/api/reports/dashboard", saas.accessToken);
  await assert.rejects(guard.canActivate(saasReport.context), /只能访问租户管理能力/);
  const saasCategories = requestContext("GET", "/api/rental/v1/categories", saas.accessToken);
  assert.equal(await guard.canActivate(saasCategories.context), true);
  const saasTenantList = requestContext("GET", "/api/platform/tenants", saas.accessToken);
  assert.equal(await guard.canActivate(saasTenantList.context), true);
  const demoCore = requestContext("GET", "/api/rental/v1/profile", rotated.accessToken);
  assert.equal(await guard.canActivate(demoCore.context), true);
  assert.equal(getRequestTenantId(), "tenant_001");

  await platform.updateTenantStatus(
    bootstrapped.tenant.tenantId,
    { status: TenantStatus.Frozen, reason: "自动化测试冻结" },
    saas.user
  );
  assert.equal(await auth.resolveAccessToken(`Bearer ${changed.accessToken}`), undefined);

  const passwordHash = hashPassword("SafePassword!2026");
  assert.notEqual(passwordHash, "SafePassword!2026");
  assert.equal(verifyPassword(passwordHash, "SafePassword!2026"), true);
  assert.equal(verifyPassword(passwordHash, "wrong"), false);
  const productionAuthWithoutSecret = new AuthService(platform, {
    get(key) {
      return key === "NODE_ENV" ? "production" : undefined;
    }
  });
  assert.throws(
    () => productionAuthWithoutSecret.tokenSecret(),
    /生产环境必须配置 AUTH_TOKEN_SECRET/
  );

  const repositorySource = fs.readFileSync(
    path.join(__dirname, "../apps/api/src/modules/platform/platform.repository.ts"),
    "utf8"
  );
  assert.match(repositorySource, /prisma\.\$transaction/);
  assert.match(repositorySource, /tenantRentalProfile\.create/);
  assert.match(repositorySource, /authSession\.updateMany/);
  assert.doesNotMatch(repositorySource, /mock-token/);

  const integrationsServiceSource = fs.readFileSync(
    path.join(__dirname, "../apps/api/src/modules/integrations/integrations.service.ts"),
    "utf8"
  );
  const integrationsRepositorySource = fs.readFileSync(
    path.join(__dirname, "../apps/api/src/modules/integrations/integrations.repository.ts"),
    "utf8"
  );
  assert.match(integrationsServiceSource, /return getRequestTenantId\(\)/);
  assert.match(integrationsRepositorySource, /tenantId = getRequestTenantId\(\)/);
  assert.doesNotMatch(integrationsServiceSource, /private readonly defaultTenantId = "tenant_001"/);
  assert.doesNotMatch(integrationsRepositorySource, /DEFAULT_TENANT_ID/);

  console.log(
    "SaaS foundation test passed: admin boundary, tenant isolation (including integrations), bootstrap, password gate, session rotation, lifecycle revocation and password hashing verified."
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
