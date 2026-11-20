const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { PlatformService } = require("../apps/api/src/modules/platform/platform.service");
const { OriginalPublicManagementAdapter } = require("../apps/api/src/modules/platform/public-management.adapter");
const { fixture: publicManagementFixture } = require("./fixtures/platform-management.cjs");
const { RentalWorkspaceManagementApplication } = require("@rental-os/rental-core/workspace-management");
const { RentalWorkspaceManagementRepository } = require("@rental-os/rental-core/mysql-workspace-management");
const { Prisma } = require("@prisma/client");

const tenantId = "tenant-a";
const privilegedRoleId = "tenant-admin-role";
const ordinaryActor = { id: "staff-a", tenantId, isPlatformAdmin: false, isSaasAdmin: false };
const tenantAdmin = { id: "admin-a", tenantId, isPlatformAdmin: true, isSaasAdmin: false };

function serviceFixture() {
  const roles = [
    { id: privilegedRoleId, tenantId, fixedAllPermissions: true, isActive: true },
    { id: "operator-role", tenantId, fixedAllPermissions: false, isActive: true }
  ];
  const users = [{ id: "target-admin", tenantId, isPlatformAdmin: false, roleIds: [privilegedRoleId] }];
  const application = new RentalWorkspaceManagementApplication({
    configService: { get: () => "memory" }, repository: {}, logger: { warn() {} },
    legacyAccounts: { roles: () => roles, users: () => users }
  });
  return {
    useMysqlDataSource: () => false,
    roleRows: roles,
    users,
    assertPrivilege: (input, actor = ordinaryActor) =>
      application.assertTenantAdminPrivilegeWrite(input, tenantId, actor)
  };
}

async function rejectsForbidden(promise, label) {
  await assert.rejects(promise, (error) => error?.status === 403, label);
}

async function main() {
  const fixture = serviceFixture();
  const inactiveFixedRoleUser = PlatformService.prototype.toUserRow.call({
    organizations: [],
    roleRows: [{ id: "inactive-admin-role", tenantId, fixedAllPermissions: true, isActive: false, permissions: [], buttonPermissions: [] }],
    resolveUserDataScope: () => "workspace"
  }, {
    id: "inactive-role-user", tenantId, account: "inactive", displayName: "Inactive", roleIds: ["inactive-admin-role"],
    isPlatformAdmin: false, isSaasAdmin: false, isActive: true
  });
  assert.equal(inactiveFixedRoleUser.isPlatformAdmin, false, "disabled fixed roles must not count as current tenant administrators");
  await rejectsForbidden(fixture.assertPrivilege({ roleIds: [], isPlatformAdmin: true }), "non-admin cannot promote a tenant admin");
  await rejectsForbidden(fixture.assertPrivilege({ roleIds: [privilegedRoleId], isPlatformAdmin: false }), "non-admin cannot assign a fixed full-permission tenant role");
  await rejectsForbidden(fixture.assertPrivilege({ id: "target-admin", roleIds: ["operator-role"], isPlatformAdmin: false }), "non-admin cannot edit an existing tenant admin");
  await rejectsForbidden(fixture.assertPrivilege({
    roleIds: ["operator-role"],
    isPlatformAdmin: false,
    workspaceAccesses: [{ workspaceId: "ws-a", roleId: privilegedRoleId, isActive: true }]
  }), "non-admin cannot assign a fixed full-permission role through batch workspace access");

  await fixture.assertPrivilege({ roleIds: ["operator-role"], isPlatformAdmin: false });
  await fixture.assertPrivilege({ roleIds: [privilegedRoleId], isPlatformAdmin: true }, tenantAdmin);
  console.log("PASS tenant-admin privilege service gate blocks promotions, role-ID changes and batch workspace assignment");

  let upsertCount = 0;
  const tx = {
    tenant: { findUnique: async () => ({ id: tenantId }) },
    user: {
      findFirst: async ({ where }) => {
        if (where.account) return null;
        if (where.id === "staff-a") return { id: "staff-a", tenantId, isActive: true, isSaasAdmin: false, roleAssignments: [], role: null };
        return null;
      },
      upsert: async () => { upsertCount += 1; return { id: "target" }; }
    },
    role: {
      findFirst: async () => null,
      findMany: async () => [{ id: privilegedRoleId, fixedAllPermissions: true }]
    }
  };
  const repo = {
    userInclude: () => ({}),
    toUserRow: () => ({ isPlatformAdmin: false })
  };
  await rejectsForbidden(
    RentalWorkspaceManagementRepository.prototype.saveUserInTransaction.call(repo, tx, {
      account: "new-user", displayName: "New User", roleIds: [privilegedRoleId], isPlatformAdmin: false, isActive: true
    }, tenantId, "staff-a"),
    "transaction rechecks full-permission role assignment even if service guard is bypassed"
  );
  assert.equal(upsertCount, 0, "unauthorized role assignment must fail before writing user data");
  console.log("PASS repository transaction independently rejects full-permission role assignment before account write");

  const workspaceTx = {
    role: { findFirst: async ({ where }) => where.tenantId === tenantId ? { id: privilegedRoleId } : null },
    user: { findFirst: async () => ({ id: "staff-a", tenantId, isActive: true, isSaasAdmin: false, roleAssignments: [], role: null }) }
  };
  await rejectsForbidden(
    RentalWorkspaceManagementRepository.prototype.assertFixedAllWorkspaceAccessesAllowed.call(repo, workspaceTx, tenantId,
      [{ workspaceId: "ws-a", roleId: privilegedRoleId, isActive: true }], "staff-a"),
    "transaction rechecks fixed role assignment through workspace access"
  );
  console.log("PASS repository transaction independently protects batch workspace role assignment");

  const isolationLevels = [];
  const transactionRepo = {
    prisma: {
      $transaction: async (work, options) => {
        isolationLevels.push(options?.isolationLevel);
        return work({ $queryRaw: async (query) => {
          assert.match(query.sql, /SELECT id FROM Tenant.*LOCK IN SHARE MODE/);
          assert.deepEqual(query.values, [tenantId]);
          return [{ id: tenantId }];
        } });
      }
    },
    saveUserInTransaction: async () => ({ userId: "target" }),
    assertFixedAllWorkspaceAccessesAllowed: async () => undefined,
    saveWorkspaceAccessesInTransaction: async () => undefined,
    findUserWithRoles: async () => ({ id: "target" }),
    toUserRow: (user) => user
  };
  const publicFixture = publicManagementFixture();
  const management = new OriginalPublicManagementAdapter(publicFixture.service);
  await publicFixture.as("admin", () => management.saveUser({
    id: "target", tenantId, account: "target", displayName: "Target",
    roleIds: ["role-a"], isPlatformAdmin: false, isActive: true
  }));
  isolationLevels.push(...publicFixture.options.map((option) => option.isolationLevel));
  const publicTenantLock = publicFixture.locks.find((query) => query.sql.includes("FROM Tenant"));
  assert.match(publicTenantLock.sql, /SELECT id, status FROM Tenant.*FOR UPDATE/);
  assert.deepEqual(publicTenantLock.values, [tenantId]);
  await RentalWorkspaceManagementRepository.prototype.saveUserWithWorkspaceAccess.call(
    { ...transactionRepo, database: transactionRepo.prisma },
    { workspaceAccesses: [] },
    tenantId,
    "admin-a"
  );
  assert.deepEqual(
    isolationLevels,
    [Prisma.TransactionIsolationLevel.Serializable, Prisma.TransactionIsolationLevel.Serializable],
    "both admin privilege write transactions must use serializable isolation to prevent concurrent demotion/promotion races"
  );
  console.log("PASS administrator privilege writes use serializable transactions against concurrent role changes");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
