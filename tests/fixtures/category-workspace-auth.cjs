"use strict";
const assert = require("node:assert/strict");
const { AuthService } = require("../../apps/api/dist/modules/auth/auth.service.js");
const { PlatformRepository } = require("../../apps/api/dist/modules/platform/platform.repository.js");
const { PlatformService } = require("../../apps/api/dist/modules/platform/platform.service.js");

/** Offline auth rows; uses the production Auth/Platform mapping and transaction
 * adapter. This fixture records lock order, not real MySQL lock behavior. */
function categoryWorkspaceAuth(tx, { tenantId, userId, workspaceId }) {
  const role = { id: `${userId}-role`, tenantId, name: "Adoption role", scope: "OPERATOR", isActive: true,
    fixedAllPermissions: false, dataScope: "ALL", buttonPermissions: [],
    permissions: [{ permission: { id: "adopt-permission", code: "rental-os:category:adopt" } }] };
  const state = {
    tenantStatus: "ACTIVE", locks: [], beforeLock: undefined,
    user: { id: userId, tenantId, account: "fixture", displayName: "Fixture", isActive: true, isSaasAdmin: false,
      isPlatformAdmin: false, mustChangePassword: false, roleId: role.id, role, roleAssignments: [], organization: null },
    member: { roleId: role.id, role, isActive: true, dataScope: null, locationScope: { mode: "all", locationIds: [] } },
    session: { id: `${userId}-session`, userId, audience: "operator", currentWorkspaceId: workspaceId,
      revokedAt: null, expiresAt: new Date(Date.now() + 3600000) }
  };
  const originalQuery = Object.getOwnPropertyDescriptor(tx, "$queryRaw")?.value?.bind(tx);
  tx.$queryRaw = async query => {
    const sql = query.sql;
    const tables = ["Tenant", "User", "auth_sessions", "workspace_members", "UserRole", "Role", "RolePermission", "Permission"];
    const table = tables.find(table => sql.includes(`FROM \`${table}\``) || sql.includes(`FROM ${table} `));
    if (!table) return originalQuery(query);
    assert.match(sql, /FOR UPDATE$/);
    state.locks.push(table);
    if (state.beforeLock) await state.beforeLock(table);
    if (table === "Tenant") return [{ id: tenantId }];
    if (table === "User") return [{ id: userId, roleId: state.user.roleId }];
    if (table === "auth_sessions") return state.session ? [{ id: state.session.id }] : [];
    if (table === "workspace_members") return state.member ? [{ roleId: state.member.roleId }] : [];
    if (table === "UserRole") return state.user.roleAssignments.map(row => ({ roleId: row.role.id }));
    if (table === "Role") return [{ id: role.id }];
    if (table === "RolePermission") return role.permissions.map(row => ({ permissionId: row.permission.id }));
    return [{ id: "adopt-permission" }];
  };
  tx.authSession = { findFirst: async ({ where }) => {
    assert.equal(where.id, state.session?.id); assert.equal(where.userId, userId);
    return state.session && !state.session.revokedAt && state.session.expiresAt > where.expiresAt.gt ? structuredClone(state.session) : null;
  } };
  tx.user = { findFirst: async ({ where }) => {
    assert.equal(where.id, userId);
    return state.user.isActive && state.tenantStatus === "ACTIVE" ? structuredClone(state.user) : null;
  } };
  tx.workspaceMember = { findFirst: async ({ where }) => {
    assert.equal(where.userId, userId); assert.equal(where.workspaceId, workspaceId);
    return state.member?.isActive ? structuredClone(state.member) : null;
  } };
  const root = new Proxy({}, { get: () => { throw new Error("Auth must use the supplied transaction, never the root Prisma client"); } });
  const platform = new PlatformService({ get: key => key === "PLATFORM_DATA_SOURCE" ? "mysql" : undefined }, new PlatformRepository(root));
  const auth = new AuthService(platform, { get: () => undefined });
  const identity = { tenantId, userId, workspaceId, audience: "operator", isSaasAdmin: false, dataScope: "all",
    locationScope: { mode: "all", locationIds: [] }, accessSession: { sessionId: state.session.id, expiresAt: Math.floor(Date.now() / 1000) + 3600 } };
  return { auth, state, identity, role };
}
module.exports = { categoryWorkspaceAuth };
