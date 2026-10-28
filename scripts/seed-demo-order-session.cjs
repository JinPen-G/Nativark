/** Explicitly user-authorized local test identity. No existing account/password is changed.
 * Only one membership in tenant_001/default; explicit order permissions, never admin/wildcard.
 * Disable the new identity, role, membership and sessions after the seed session ends.
 */
const { randomUUID, randomBytes, scryptSync } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

async function provision(config) {
  const db = new URL(config.DATABASE_URL);
  if (db.protocol !== "mysql:" || !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) || db.pathname !== "/rental_os") throw new Error("Temporary identity is restricted to local rental_os");
  const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
  const tenantId = "tenant_001";
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { code: true, status: true } });
  const workspace = await prisma.businessWorkspace.findFirst({ where: { tenantId, code: "default", status: "ACTIVE" }, select: { id: true } });
  if (tenant?.code !== "demo" || tenant.status !== "ACTIVE" || !workspace) { await prisma.$disconnect(); throw new Error("Expected local demo camera space not found"); }
  // Shared upload sessions require the existing integration permission; only owned demo-order
  // attachments are uploaded. No integration configuration or external provider is changed.
  const codes = ["rental-os:order:view", "rental-os:order:create", "rental-os:order:operate", "rental-os:order:pickup", "rental-os:order:return", "rental-os:order:cancel", "rental-os:order:settle", "rental-os:order:fee-review", "rental-os:order:extend", "rental-os:station:view", "rental-core:asset:view", "rental-core:catalog:view", "system:integration:manage"];
  const permissions = await prisma.permission.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  if (permissions.length !== codes.length) { await prisma.$disconnect(); throw new Error("The existing permission catalog is incomplete; refusing to create an identity"); }
  const suffix = randomUUID().slice(0, 8);
  const userId = `ui_demo_seed_user_${suffix}`;
  const roleId = `ui_demo_seed_role_${suffix}`;
  const account = `ui-demo-seed-${suffix}`;
  const password = `R!${randomBytes(24).toString("base64url")}8a`;
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
  await prisma.$transaction(async tx => {
    await tx.role.create({ data: { id: roleId, tenantId, code: `UI_DEMO_SEED_${suffix}`, name: `临时订单演示造数-${suffix}`, scope: "STORE", fixedAllPermissions: false, enabledBusinessScopes: ["STORE_STANDARD", "STORE_24H"], buttonPermissions: [], dataScope: "ALL", permissions: { create: permissions.map(permission => ({ permissionId: permission.id })) } } });
    await tx.user.create({ data: { id: userId, tenantId, account, displayName: "本地演示造数（临时）", roleId, passwordHash, isSaasAdmin: false, isPlatformAdmin: false, mustChangePassword: false, isActive: true, roleAssignments: { create: { roleId } } } });
    await tx.workspaceMember.create({ data: { tenantId, workspaceId: workspace.id, userId, roleId, dataScope: "ALL", locationScope: { mode: "all" }, isActive: true } });
  });
  let disabled = false;
  async function disable() {
    if (disabled) return;
    await prisma.$transaction(async tx => {
      await tx.authSession.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
      await tx.workspaceMember.updateMany({ where: { tenantId, userId }, data: { isActive: false } });
      await tx.user.update({ where: { id: userId }, data: { isActive: false, tokenVersion: { increment: 1 } } });
      await tx.role.update({ where: { id: roleId }, data: { isActive: false } });
    });
    disabled = true;
    await prisma.$disconnect();
  }
  return { account, password, userId, roleId, workspaceId: workspace.id, disable };
}
module.exports = { provision };
