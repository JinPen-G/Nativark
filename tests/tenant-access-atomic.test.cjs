const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env");
const fileEnv = {};
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    const separator = line.indexOf("=");
    if (separator > 0 && !line.startsWith("#")) {
      fileEnv[line.slice(0, separator)] = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/u, "$2");
    }
  }
}

const databaseUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL;
assert.ok(databaseUrl, "必须提供专用 DATABASE_URL");
const databaseName = new URL(databaseUrl).pathname.slice(1);
assert.match(databaseName, /^rental_os_(?:claude(?:_dedicated_access_\d+)?|zcode)$/u, "权限原子提交专项只能运行在并行专用库（claude/zcode）");
process.env.DATABASE_URL = databaseUrl;

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { PrismaService } = require("../apps/api/src/modules/database/prisma.service");
const prisma = new PrismaService();
const apiBase = process.env.ACCESS_API_URL || "http://127.0.0.1:3992/api";
const created = { userId: undefined, account: undefined };

async function request(method, endpoint, body, token) {
  const response = await fetch(`${apiBase}${endpoint}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = { raw: text }; }
  return { status: response.status, body: parsed };
}

const data = (result) => result.body?.data ?? result.body;
const ok = (label) => console.log(`  PASS ${label}`);

void (async () => {
  try {
    const login = await request("POST", "/auth/login", { tenantCode: "demo", account: "admin", password: "RentalDemo!2026" });
    assert.ok([200, 201].includes(login.status), `管理员登录失败: ${JSON.stringify(login.body)}`);
    const token = data(login).accessToken;
    const workspaces = data(await request("GET", "/platform/workspaces", undefined, token));
    const activeWorkspaces = workspaces.filter((workspace) => workspace.status === "active");
    assert.ok(activeWorkspaces.length >= 2, "需要至少两个启用经营空间验证批量授权");
    const roles = data(await request("GET", "/platform/roles", undefined, token));
    const role = roles.find((item) => item.isActive && !item.fixedAllPermissions);
    assert.ok(role, "需要一个可分配的普通启用角色");

    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toLowerCase();
    created.account = `atomic_${suffix}`;
    const basePayload = {
      account: created.account,
      displayName: "权限原子提交验收账号",
      roleIds: [role.id],
      isPlatformAdmin: false,
      isActive: true
    };
    const validAccess = {
      workspaceId: activeWorkspaces[0].id,
      roleId: role.id,
      dataScope: "store",
      isActive: true
    };

    const failedCreate = await request("POST", "/platform/users/access", {
      ...basePayload,
      workspaceAccesses: [validAccess, { ...validAccess, workspaceId: "workspace_not_belongs_to_demo" }]
    }, token);
    assert.ok(failedCreate.status >= 400 && failedCreate.status < 500, `非法空间授权应拒绝: ${JSON.stringify(failedCreate.body)}`);
    const afterFailedCreate = data(await request("GET", "/platform/users", undefined, token));
    assert.equal(afterFailedCreate.some((user) => user.account === created.account), false, "空间授权失败时账号也必须回滚");
    ok("创建账号时任一空间授权失败会整体回滚");

    const createdUser = await request("POST", "/platform/users/access", {
      ...basePayload,
      workspaceAccesses: [
        validAccess,
        { workspaceId: activeWorkspaces[1].id, roleId: role.id, dataScope: "organization", isActive: true }
      ]
    }, token);
    assert.ok([200, 201].includes(createdUser.status), `原子创建失败: ${JSON.stringify(createdUser.body)}`);
    created.userId = data(createdUser).id;
    const members = await Promise.all(activeWorkspaces.slice(0, 2).map((workspace) => request("GET", `/platform/workspaces/${workspace.id}/members`, undefined, token)));
    assert.equal(members.every((result) => data(result).some((member) => member.userId === created.userId && member.isActive)), true, "成功提交后两个空间都应有启用成员关系");
    ok("账号与多个经营空间授权一次提交成功");

    const failedUpdate = await request("PUT", `/platform/users/${created.userId}/access`, {
      ...basePayload,
      id: created.userId,
      displayName: "不应落库的更新",
      workspaceAccesses: [
        { ...validAccess, isActive: false },
        { ...validAccess, workspaceId: "workspace_not_belongs_to_demo" }
      ]
    }, token);
    assert.ok(failedUpdate.status >= 400 && failedUpdate.status < 500, `更新中的非法空间授权应拒绝: ${JSON.stringify(failedUpdate.body)}`);
    const afterFailedUpdate = data(await request("GET", "/platform/users", undefined, token)).find((user) => user.id === created.userId);
    assert.equal(afterFailedUpdate?.displayName, basePayload.displayName, "更新失败时账号资料必须回滚");
    const firstMembersAfterFailure = data(await request("GET", `/platform/workspaces/${activeWorkspaces[0].id}/members`, undefined, token));
    assert.equal(firstMembersAfterFailure.find((member) => member.userId === created.userId)?.isActive, true, "更新失败时已有空间授权必须回滚");
    ok("编辑账号时任一空间授权失败会回滚账号与既有授权");

    console.log("\n租户权限原子提交专项：3 项全部通过");
  } finally {
    if (created.userId) {
      await prisma.operationLog.deleteMany({ where: { userId: created.userId } });
      await prisma.authSession.deleteMany({ where: { userId: created.userId } });
      await prisma.workspaceMember.deleteMany({ where: { userId: created.userId } });
      await prisma.userRole.deleteMany({ where: { userId: created.userId } });
      await prisma.user.deleteMany({ where: { id: created.userId } });
    }
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
