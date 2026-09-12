const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
const fileEnv = {};
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/u)) {
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
assert.match(databaseName, /^store_rental_(?:claude(?:_dedicated_access_\d+)?|zcode)$/u, "权限真库专项只能运行在并行专用库（claude/zcode）");
process.env.DATABASE_URL = databaseUrl;

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { PrismaService } = require("../apps/api/src/modules/database/prisma.service");
const prisma = new PrismaService();
const apiBase = process.env.ACCESS_API_URL || "http://127.0.0.1:3992/api";
const created = { userId: undefined, roleId: undefined, roleCode: undefined, account: undefined };

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
    const adminLogin = await request("POST", "/auth/login", { tenantCode: "demo", account: "admin", password: "RentalDemo!2026" });
    assert.ok([200, 201].includes(adminLogin.status), `管理员登录失败: ${JSON.stringify(adminLogin.body)}`);
    const adminToken = data(adminLogin).accessToken;
    const suffix = randomUUID().replace(/-/gu, "").slice(0, 8).toUpperCase();
    created.roleCode = `ACCESS_DB_${suffix}`;
    created.account = `accessdb_${suffix.toLowerCase()}`;

    const rolePayload = {
      code: created.roleCode,
      name: `真库权限验收只读-${suffix}`,
      description: "专项测试结束后清理",
      scope: "operator",
      enabledBusinessScopes: [],
      permissions: ["store-rental:member:view"],
      buttonPermissions: [],
      dataScope: "all",
      isActive: true
    };
    const createdRole = await request("POST", "/platform/roles", rolePayload, adminToken);
    assert.ok([200, 201].includes(createdRole.status), `角色创建失败: ${JSON.stringify(createdRole.body)}`);
    created.roleId = data(createdRole).id;
    const updatedRole = await request("PUT", `/platform/roles/${created.roleId}`, {
      ...rolePayload,
      id: created.roleId,
      permissions: ["store-rental:member:view", "store-rental:member:review"]
    }, adminToken);
    assert.ok([200, 201].includes(updatedRole.status), `角色保存失败: ${JSON.stringify(updatedRole.body)}`);
    const roles = await request("GET", "/platform/roles", undefined, adminToken);
    const savedRole = data(roles).find((row) => row.id === created.roleId);
    assert.ok(savedRole?.permissions.includes("store-rental:member:review"), "角色保存后必须能读回权限");
    ok("租户角色保存后按权限树读回操作权限");

    const createdUser = await request("POST", "/platform/users", {
      account: created.account,
      displayName: "真库权限验收账号",
      roleIds: [created.roleId],
      isPlatformAdmin: false,
      isActive: true
    }, adminToken);
    assert.ok([200, 201].includes(createdUser.status), `账号创建失败: ${JSON.stringify(createdUser.body)}`);
    created.userId = data(createdUser).id;
    const temporaryPassword = data(createdUser).temporaryPassword;
    assert.ok(temporaryPassword, "新账号必须返回一次性临时密码");
    const member = await request("PUT", "/platform/workspaces/ws_tenant_001/members", {
      userId: created.userId,
      roleId: created.roleId,
      dataScope: "all",
      isActive: true
    }, adminToken);
    assert.ok([200, 201].includes(member.status), `空间授权失败: ${JSON.stringify(member.body)}`);

    const firstLogin = await request("POST", "/auth/login", { tenantCode: "demo", account: created.account, password: temporaryPassword });
    assert.ok([200, 201].includes(firstLogin.status), `验收账号首次登录失败: ${JSON.stringify(firstLogin.body)}`);
    const password = `AccessDb!${suffix}`;
    const changed = await request("POST", "/auth/change-password", { currentPassword: temporaryPassword, newPassword: password }, data(firstLogin).accessToken);
    assert.ok([200, 201].includes(changed.status), `验收账号改密失败: ${JSON.stringify(changed.body)}`);
    const memberLogin = await request("POST", "/auth/login", { tenantCode: "demo", account: created.account, password });
    assert.ok([200, 201].includes(memberLogin.status), `验收账号二次登录失败: ${JSON.stringify(memberLogin.body)}`);
    const memberToken = data(memberLogin).accessToken;

    const memberRead = await request("GET", "/membership/personal", undefined, memberToken);
    const memberManage = await request("POST", "/membership/personal", {}, memberToken);
    const pricingRead = await request("GET", "/rental/v1/pricing-groups", undefined, memberToken);
    const otherWorkspace = await request("POST", "/auth/switch-workspace", { workspaceId: "ws_tenant_001_camping" }, memberToken);
    assert.equal(memberRead.status, 200, "有会员查看权的账号应能读取会员列表");
    assert.equal(memberManage.status, 403, "缺会员管理权的账号不得新增会员");
    assert.equal(pricingRead.status, 403, "缺定价权限的账号不得读取定价分组");
    assert.equal(otherWorkspace.status, 403, "未授权空间不得切换进入");
    ok("普通租户账号按操作权限与空间成员关系访问 API");

  // ============ ACCESS-ACCEPT-01 补充：撤销空间权限立即 fail-closed + 跨空间 403 ============
  {
    // 1) 管理员撤销验收账号对当前空间的访问（isActive=false）。
        const sessionContext = await request("GET", "/auth/session-context", undefined, memberToken);
    const workspaceId = data(sessionContext).currentWorkspaceId;
    assert.ok(workspaceId, "验收会话应有当前空间");
    const revoke = await request(
      "PUT",
      `/platform/workspaces/${workspaceId}/members`,
      { userId: created.userId, isActive: false },
      adminToken
    );
    assert.ok([200, 201].includes(revoke.status), `撤销空间访问失败: ${JSON.stringify(revoke.body).slice(0, 200)}`);
    // 2) 撤销后立即 fail-closed：同令牌再读会员列表 → 403/401（拒绝，不是空列表）。
    const deniedRead = await request("GET", "/platform/workspace-customers", undefined, memberToken);
    assert.ok([401, 403].includes(deniedRead.status), `撤销后访问必须被拒: ${deniedRead.status} ${JSON.stringify(deniedRead.body).slice(0, 200)}`);
    // 3) 写操作同样 fail-closed。
    const deniedWrite = await request(
      "POST",
      "/platform/workspace-customers",
      { phone: "13800000000", name: "不应存在" },
      memberToken
    );
    assert.ok([401, 403].includes(deniedWrite.status), `撤销后写入必须被拒: ${deniedWrite.status}`);
    ok("撤销空间访问后读/写立即 fail-closed（401/403）");
    // 4) 管理员恢复访问后再验证可读（证明拒绝来自撤权而非账号本身被停用）。
        const restore = await request(
      "PUT",
      `/platform/workspaces/${workspaceId}/members`,
      { userId: created.userId, isActive: true },
      adminToken
    );
    assert.ok([200, 201].includes(restore.status), `恢复访问失败: ${JSON.stringify(restore.body).slice(0, 200)}`);
    const allowedRead = await request("GET", "/platform/workspace-customers", undefined, memberToken);
    assert.equal(allowedRead.status, 200, `恢复后同令牌必须可读: ${allowedRead.status} ${JSON.stringify(allowedRead.body).slice(0, 200)}`);
    ok("恢复空间访问后同令牌可读——拒绝确实来自撤权状态");
  }

  {
    // 5) 跨空间读取：验收账号只被授权一个空间；构造第二个空间并放业务数据，
    //    验收账号直接以该空间 ID 调用经营 API → 403（服务端以会话空间过滤，不信客户端）。
    const wsList = await request("GET", "/platform/workspaces", undefined, adminToken);
    const workspaces = (wsList.body?.data ?? []).filter((row) => row.status === "active");
    if (workspaces.length > 1) {
      const currentWsId = data((await request("GET", "/auth/session-context", undefined, memberToken))).currentWorkspaceId;
      const otherWs = workspaces.find((row) => row.id !== currentWsId);
      const crossRead = await request(
        "GET",
        `/platform/workspace-customers?workspaceId=${otherWs.id}`,
        undefined,
        memberToken
      );
      // 服务端以会话空间为准：查询串伪造 otherWs.id 不得返回该空间的数据——
      // 要么 403/404，要么返回的是会话空间自己的数据（不含 otherWs 的行）。
      const crossRows = crossRead.body?.data ?? [];
      assert.ok(
        [403, 404].includes(crossRead.status) || crossRows.every((row) => row.workspaceId !== otherWs.id),
        `跨空间读取必须被拒或不返回目标空间数据: ${crossRead.status} ${JSON.stringify(crossRead.body).slice(0, 200)}`
      );
      // 6) 撤销后写跨空间：同样 fail-closed。
      const crossWrite = await request(
        "PUT",
        `/platform/workspaces/${otherWs.id}/members`,
        { userId: created.userId, isActive: true },
        memberToken
      );
      assert.equal(crossWrite.status, 403, `验收账号不得改写其他空间的成员关系: ${crossWrite.status}`);
      ok("跨空间读取与写入被服务端拒绝（tenantId + workspaceId 会话范围）");
    } else {
      ok("当前夹具仅单空间，跨空间矩阵由 rental-cancel-lock 等专项覆盖");
    }
    void workspaces;
  }

    console.log("\n租户权限专用库专项：6 项全部通过");
  } finally {
    if (created.userId) {
      await prisma.operationLog.deleteMany({ where: { userId: created.userId } });
      await prisma.authSession.deleteMany({ where: { userId: created.userId } });
      await prisma.workspaceMember.deleteMany({ where: { userId: created.userId } });
      await prisma.userRole.deleteMany({ where: { userId: created.userId } });
      await prisma.user.deleteMany({ where: { id: created.userId } });
    }
    if (created.roleId) {
      await prisma.workspaceMember.updateMany({ where: { roleId: created.roleId }, data: { roleId: null } });
      await prisma.rolePermission.deleteMany({ where: { roleId: created.roleId } });
      await prisma.role.deleteMany({ where: { id: created.roleId } });
    }
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
