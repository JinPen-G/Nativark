const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: {
    module: "commonjs",
    moduleResolution: "node",
    esModuleInterop: true
  }
});

const { ForbiddenException } = require("@nestjs/common");
const {
  runWithRequestIdentity,
  getRequestWorkspaceId
} = require("../apps/api/src/common/request-identity");
const { resolveScopeWorkspaceId } = require("../apps/api/src/modules/rental-core/workspace-scope");

function createClient({ workspaces }) {
  const calls = [];
  return {
    calls,
    businessWorkspace: {
      async findFirst({ where }) {
        calls.push(where);
        return workspaces.find((row) =>
          (where.id === undefined || row.id === where.id) &&
          (where.tenantId === undefined || row.tenantId === where.tenantId) &&
          (where.defaultMarker === undefined || row.defaultMarker === where.defaultMarker)
        ) ?? null;
      }
    }
  };
}

async function rejectsForbidden(promise, message) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.constructor.name, ForbiddenException.name);
    assert.match(error.message, message);
    return true;
  });
}

void (async () => {
  const client = createClient({
    workspaces: [
      { id: "ws-camera", tenantId: "tenant-a", defaultMarker: "default" },
      { id: "ws-other", tenantId: "tenant-b", defaultMarker: "default" }
    ]
  });

  const scoped = await runWithRequestIdentity(
    { tenantId: "tenant-a", userId: "user-a", workspaceId: "ws-camera" },
    () => resolveScopeWorkspaceId(client, "tenant-a")
  );
  assert.equal(scoped, "ws-camera");
  assert.deepEqual(client.calls[0], { id: "ws-camera", tenantId: "tenant-a" });
  assert.equal(getRequestWorkspaceId(), undefined, "测试上下文不能泄漏到请求外");
  console.log("  PASS 当前会话空间必须属于目标租户");

  await rejectsForbidden(
    runWithRequestIdentity(
      { tenantId: "tenant-a", userId: "user-a", workspaceId: "ws-other" },
      () => resolveScopeWorkspaceId(client, "tenant-a")
    ),
    /不属于目标租户/u
  );
  console.log("  PASS 跨租户会话空间被拒绝");

  const fallbackClient = createClient({
    workspaces: [{ id: "ws-default", tenantId: "tenant-c", defaultMarker: "default" }]
  });
  const fallback = await runWithRequestIdentity(
    { tenantId: "tenant-c", userId: "seed", workspaceId: undefined },
    () => resolveScopeWorkspaceId(fallbackClient, "tenant-c")
  );
  assert.equal(fallback, "ws-default");
  console.log("  PASS 无会话的初始化路径只回落到目标租户默认空间");

  await rejectsForbidden(
    runWithRequestIdentity(
      { tenantId: "tenant-c", userId: "user-c", workspaceId: undefined },
      () => resolveScopeWorkspaceId(createClient({ workspaces: [] }), "tenant-c")
    ),
    /没有默认经营空间/u
  );
  console.log("  PASS 没有默认空间时 fail-closed");

  console.log("经营空间范围专项：4 项全部通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
