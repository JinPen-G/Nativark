const assert = require("node:assert/strict");
/** 公共账号提权原例直接核当前管理服务；空间批量授权/业务事务的完整原例在独立 Rental 组合。 */
const { PlatformIdentityRepository } = require("@rental-os/platform-server/identity");
const { prismaRuntime: Prisma } = require("@rental-os/platform-server/prisma-runtime");
const { fixture: publicManagementFixture } = require("./fixtures/platform-management.cjs");

const tenantId = "tenant-a";
async function rejectsForbidden(promise, label) {
  await assert.rejects(promise, (error) => error?.status === 403, label);
}

async function main() {
  const inactiveRole = { id: "inactive-admin-role", tenantId, name: "Inactive admin", fixedAllPermissions: true,
    isActive: false, permissions: [], buttonPermissions: [], dataScope: "WORKSPACE", scope: "OPERATOR" };
  const inactiveFixedRoleUser = new PlatformIdentityRepository({}).toUserRow({
    id: "inactive-role-user", tenantId, account: "inactive", displayName: "Inactive",
    roleAssignments: [{ role: inactiveRole }], role: inactiveRole,
    isPlatformAdmin: false, isSaasAdmin: false, isActive: true
  });
  assert.equal(inactiveFixedRoleUser.isPlatformAdmin, false, "disabled fixed roles must not count as current tenant administrators");
  const input = { id: "target", tenantId, account: "target", displayName: "Target",
    roleIds: ["role-a"], isPlatformAdmin: false, isActive: true };
  const fixture = publicManagementFixture();
  await rejectsForbidden(fixture.as("actor", () => fixture.service.saveUser({ ...input, isPlatformAdmin: true })),
    "non-admin cannot promote a tenant admin");
  // 正式固定管理员角色ID会按原语义剔除；此处另核实际有效的全权角色仍不能绕过管理员门槛。
  const readRoles = fixture.tx.role.findMany;
  fixture.tx.role.findMany = async query => (await readRoles(query)).map(role =>
    query.where.id?.in.includes(role.id) ? { ...role, fixedAllPermissions: true } : role);
  await rejectsForbidden(fixture.as("actor", () => fixture.service.saveUser(input)),
    "non-admin cannot assign a fixed full-permission tenant role");
  fixture.tx.role.findMany = readRoles;
  fixture.operators.target.isPlatformAdmin = true;
  await rejectsForbidden(fixture.as("actor", () => fixture.service.saveUser(input)),
    "non-admin cannot edit an existing tenant admin");
  fixture.operators.target.isPlatformAdmin = false;
  assert.equal(fixture.state.userWrites.length, 0, "unauthorized role assignment must fail before writing user data");
  await fixture.as("actor", () => fixture.service.saveUser(input));
  await fixture.as("admin", () => fixture.service.saveUser({ ...input, isPlatformAdmin: true }));

  const publicFixture = publicManagementFixture();
  await publicFixture.as("admin", () => publicFixture.service.saveUser(input));
  const publicTenantLock = publicFixture.locks.find((query) => query.sql.includes("FROM Tenant"));
  assert.match(publicTenantLock.sql, /SELECT id, status FROM Tenant.*FOR UPDATE/);
  assert.deepEqual(publicTenantLock.values, [tenantId]);
  assert.deepEqual(publicFixture.options.map(option => option.isolationLevel), [Prisma.TransactionIsolationLevel.Serializable],
    "public admin privilege writes must use serializable isolation to prevent concurrent role changes");
  console.log("PASS public tenant-admin privilege writes preserve current roles, reject elevation before writes and retain the tenant transaction lock");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
