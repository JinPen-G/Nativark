"use strict";
/** 原管理回归的内存参加者。管理服务、身份投影和事务围栏使用正式源码，SQL与提交由本夹具承接。 */
const { PlatformManagementService } = require("@rental-os/platform-server/management");
const { runWithRequestIdentity } = require("@rental-os/platform-server/request-identity");

function fixture() {
  const tenantId = "tenant-a";
  const operator = (id, permissions, extra = {}) => ({
    id, tenantId, account: id, displayName: id, isActive: true, isSaasAdmin: false,
    isPlatformAdmin: false, mustChangePassword: false, dataScope: "all", scope: "operator",
    organizationId: null, permissions, passwordHash: "fixture-existing-hash", tokenVersion: 1, ...extra
  });
  const operators = {
    actor: operator("actor", ["system:user:manage", "system:role:manage"]),
    target: operator("target", []),
    admin: operator("admin", [], { isPlatformAdmin: true }),
    saas: operator("saas", ["system:tenant:manage"], { tenantId: "platform", isSaasAdmin: true })
  };
  const catalog = [
    { id: "old", code: "fixture:old", kind: "ACTION" },
    { id: "p-view", code: "rental-os:order:view", kind: "ACTION" },
    { id: "p-pickup", code: "rental-os:order:pickup", kind: "BUTTON" },
    { id: "p-user", code: "system:user:manage", kind: "ACTION" },
    { id: "p-role", code: "system:role:manage", kind: "ACTION" },
    { id: "p-tenant", code: "system:tenant:manage", kind: "ACTION" }
  ].map(row => ({ ...row, name: row.code, module: "fixture", description: null }));
  const role = {
    id: "role-a", tenantId, code: "OPERATOR", name: "Operator", description: null,
    fixedAllPermissions: false, dataScope: "ALL", isActive: true, scope: "OPERATOR",
    enabledBusinessScopes: [], buttonPermissions: []
  };
  const fixedRole = { ...role, id: "fixed", code: "TENANT_ADMIN", fixedAllPermissions: true };
  const state = { userWrites: [], revoked: [], members: [], roles: [], permissions: ["old"], logs: [], organizations: [] };
  const options = [], locks = [], sessions = new Map();
  let failPermissionInsert = false, privilegedWorkspace = false;

  function sessionFor(id) {
    if (!sessions.has(id)) sessions.set(id, { id: "session-" + id, userId: id, audience: "operator",
      currentWorkspaceId: null, revokedAt: null, expiresAt: new Date(Date.now() + 600000) });
    return sessions.get(id);
  }
  function matches(row, where = {}) {
    return Object.entries(where).every(([name, expected]) => {
      if (expected === undefined) return true;
      if (name === "tenant") return expected.status === "ACTIVE";
      if (expected && typeof expected === "object") {
        if ("in" in expected) return expected.in.includes(row[name]);
        if ("not" in expected) return row[name] !== expected.not;
        if ("gt" in expected) return row[name] > expected.gt;
      }
      return row[name] === expected;
    });
  }
  function roleFor(id) {
    if (state.roles.some(value => value.deleted && value.id === id)) return null;
    if (id === role.id) return { ...role, permissions: state.permissions.map(permissionId => ({
      permission: catalog.find(permission => permission.id === permissionId)
    })) };
    if (id === fixedRole.id) return { ...fixedRole, permissions: [] };
    const user = operators[id.replace(/^base-/, "")];
    if (!user) return null;
    return { ...role, id, tenantId: user.tenantId, code: id, dataScope: user.dataScope.toUpperCase(), permissions: user.permissions.map(code => ({
      permission: catalog.find(permission => permission.code === code) ?? { id: "fixture-" + code, code, kind: "ACTION" }
    })) };
  }
  function storedUser(user) {
    if (!user) return null;
    const roleIds = user.roleIds ?? ["base-" + user.id];
    const roles = roleIds.map(roleFor).filter(Boolean);
    return { ...user, roleId: roles[0]?.id ?? null, role: roles[0] ?? null,
      roleAssignments: roles.map(value => ({ role: value })),
      organization: state.organizations.find(value => value.id === user.organizationId) ?? null,
      createdAt: new Date("2024-01-01T00:00:00Z") };
  }
  function writeUser(user, data) {
    state.userWrites.push({ id: user.id, ...data });
    for (const [name, value] of Object.entries(data)) {
      if (value === undefined) continue;
      user[name] = name === "tokenVersion" ? user.tokenVersion + value.increment : value;
    }
    return storedUser(user);
  }

  const tx = {
    tenant: { findUnique: async ({ where }) => ({ id: where.id, code: where.id, status: "ACTIVE" }) },
    user: {
      findFirst: async ({ where }) => storedUser(Object.values(operators).find(user => matches(user, where))),
      findMany: async ({ where }) => Object.values(operators).filter(user => matches(user, where)).map(storedUser),
      update: async ({ where, data }) => writeUser(operators[where.id], data),
      create: async ({ data }) => { operators[data.id] = operator(data.id, [], data); return { id: data.id }; }
    },
    role: {
      findFirst: async ({ where }) => [role, fixedRole].map(value => roleFor(value.id)).filter(Boolean)
        .find(value => matches(value, where)) ?? null,
      findMany: async ({ where }) => [role, fixedRole].filter(value => matches(value, where))
        .map(value => roleFor(value.id)).filter(Boolean),
      findUnique: async ({ where }) => {
        const current = roleFor(where.id);
        if (!current) return null;
        const assignments = Object.values(operators).filter(user => (user.roleIds ?? ["base-" + user.id]).includes(where.id));
        const primaryUsers = assignments.filter(user => (user.roleIds?.[0] ?? "base-" + user.id) === where.id);
        return { ...current, _count: { users: primaryUsers.length, userAssignments: assignments.length } };
      },
      update: async ({ data }) => { state.roles.push(structuredClone(data)); Object.assign(role, data); return roleFor(role.id); },
      create: async ({ data }) => { state.roles.push(structuredClone(data)); Object.assign(role, data); return { id: data.id }; },
      delete: async ({ where }) => { state.roles.push({ id: where.id, deleted: true }); return { id: where.id }; }
    },
    permission: { findMany: async ({ where }) => catalog.filter(value => matches(value, where)) },
    rolePermission: {
      deleteMany: async () => { state.permissions = []; return { count: 1 }; },
      createMany: async ({ data }) => {
        if (failPermissionInsert) throw new Error("injected permission failure");
        state.permissions = data.map(value => value.permissionId);
        return { count: data.length };
      }
    },
    userRole: {
      deleteMany: async ({ where }) => { operators[where.userId].roleIds = []; return { count: 1 }; },
      createMany: async ({ data }) => {
        for (const value of data) operators[value.userId].roleIds.push(value.roleId);
        return { count: data.length };
      }
    },
    organizationUnit: {
      findFirst: async ({ where }) => state.organizations.find(value => matches(value, where)) ?? null,
      findMany: async ({ where }) => state.organizations.filter(value => matches(value, where))
    },
    authSession: {
      findFirst: async ({ where }) => [...sessions.values()].find(value => matches(value, where)) ?? null,
      updateMany: async ({ where, data }) => {
        state.revoked.push(where.userId);
        for (const value of sessions.values()) if (matches(value, where)) Object.assign(value, data);
        return { count: 1 };
      }
    },
    businessWorkspace: { findFirst: async () => ({ id: "ws-a", tenantId, status: "ACTIVE" }) },
    workspaceMember: {
      count: async ({ where }) => state.members.filter(value => matches(value, where)).length,
      findFirst: async () => privilegedWorkspace ? { userId: "target" } : null,
      upsert: async ({ create }) => { state.members.push(create); return { ...create, createdAt: new Date(), updatedAt: new Date() }; }
    },
    operationLog: { create: async ({ data }) => { state.logs.push(structuredClone(data)); return {}; } },
    $queryRaw: async (query, ...values) => {
      const sql = (query.sql ?? query.join("?")).replaceAll(String.fromCharCode(96), "").replace(/\s+/g, " ").trim();
      if (Array.isArray(query.values)) values = query.values;
      locks.push({ sql, values });
      if (sql.includes("FROM Tenant")) return [{ id: values[0], status: "active" }];
      if (sql.includes("FROM User ")) {
        const user = storedUser(operators[values[0]]);
        return user && user.tenantId === values[1] ? [user] : [];
      }
      if (sql.includes("FROM auth_sessions")) {
        return [...sessions.values()].filter(value => value.id === values[0] && value.userId === values[1]);
      }
      if (sql.includes("FROM UserRole ")) return (operators[values[0]]?.roleIds ?? []).map(roleId => ({ roleId }));
      if (sql.includes("FROM RolePermission ")) return roleFor(values[0]).permissions.map(value => ({ permissionId: value.permission.id }));
      if (sql.includes("FROM Role ")) {
        const current = roleFor(values[0]);
        return current && current.tenantId === values[1] ? [{ id: current.id }] : [];
      }
      if (sql.includes("FROM Permission ")) return [{ id: values[0] }];
      throw new Error("Unexpected management fixture SQL " + sql);
    }
  };
  const database = { ...tx, async $transaction(work, selected) {
    options.push(selected);
    const before = structuredClone({ state, operators, role, sessions: [...sessions.entries()] });
    try { return await work(tx); }
    catch (error) {
      Object.assign(state, before.state);
      for (const id of Object.keys(operators)) if (!(id in before.operators)) delete operators[id];
      Object.assign(operators, before.operators);
      Object.assign(role, before.role);
      sessions.clear();
      for (const [id, value] of before.sessions) sessions.set(id, value);
      throw error;
    }
  } };
  const service = new PlatformManagementService(database);
  return {
    database, service, state, options, locks, tx, operators, role,
    async as(id, work) {
      const user = operators[id], session = sessionFor(id);
      return runWithRequestIdentity({ tenantId: user.tenantId, userId: user.id, audience: "operator", workspaceId: undefined,
        accessSession: { sessionId: session.id, expiresAt: Math.floor(session.expiresAt.getTime() / 1000), workspaceId: null }
      }, work);
    },
    failPermissions() { failPermissionInsert = true; },
    workspaceAdmin() { privilegedWorkspace = true; }
  };
}
module.exports = { fixture };
