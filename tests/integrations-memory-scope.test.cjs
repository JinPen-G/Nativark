const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const { runWithRequestIdentity } = require(path.join(repo, "apps/api/dist/common/request-identity.js"));
const { IntegrationsService } = require(path.join(repo, "apps/api/dist/modules/integrations/integrations.service.js"));
const { IntegrationsRepository } = require(path.join(repo, "apps/api/dist/modules/integrations/integrations.repository.js"));

const service = new IntegrationsService({ get: () => "memory" }, {});
const identity = (tenantId) => ({
  tenantId,
  userId: `user_${tenantId}`,
  isSaasAdmin: false,
  workspaceId: `workspace_${tenantId}`
});

async function inTenant(tenantId, fn) {
  return runWithRequestIdentity(identity(tenantId), fn);
}

(async () => {
  const tenantA = "tenant_memory_scope_a";
  const tenantB = "tenant_memory_scope_b";

  const aSeed = await inTenant(tenantA, () => service.listTBoxDevices());
  const bSeed = await inTenant(tenantB, () => service.listTBoxDevices());
  assert.equal(aSeed.length, 2);
  assert.equal(bSeed.length, 2);
  assert.notEqual(aSeed[0].id, bSeed[0].id, "演示 TBox ID 必须按租户隔离");

  const aJob = await inTenant(tenantA, () => service.createJob({
    jobType: "scope_probe",
    businessType: "test",
    operator: "tenant-a"
  }));
  const bJobs = await inTenant(tenantB, () => service.listJobs());
  assert.equal(bJobs.some((item) => item.id === aJob.id), false, "任务不能跨租户可见");

  const aNotification = await inTenant(tenantA, () => service.sendNotification({
    channels: ["APP"],
    businessType: "scope_probe"
  }));
  const bLogs = await inTenant(tenantB, () => service.listNotificationLogs());
  assert.equal(bLogs.some((item) => item.id === aNotification.id), false, "通知日志不能跨租户可见");

  const aDevice = await inTenant(tenantA, () => service.saveTBoxDevice({
    cid: "CID-SCOPE-A",
    model: "SCOPE-1"
  }));
  await assert.rejects(
    () => inTenant(tenantB, () => service.saveTBoxDevice({
      id: aDevice.id,
      cid: "CID-SCOPE-B",
      model: "SCOPE-2"
    })),
    /not found/u,
    "内存模式也必须拒绝用另一个租户的 TBox ID 更新"
  );
  const aAfter = await inTenant(tenantA, () => service.listTBoxDevices());
  assert.equal(aAfter.find((item) => item.id === aDevice.id).cid, "CID-SCOPE-A");

  let repositoryLookup;
  const repository = new IntegrationsRepository({
    tBoxDevice: {
      findFirst: async ({ where }) => {
        repositoryLookup = where;
        return null;
      }
    }
  });
  await assert.rejects(
    repository.saveTBoxDevice({ id: "tbox_other_tenant", cid: "CID-X", model: "SCOPE-X" }, tenantB),
    /not found/u,
    "数据库模式也必须拒绝用另一个租户的 TBox ID 更新"
  );
  assert.deepEqual(repositoryLookup, { id: "tbox_other_tenant", tenantId: tenantB });

  const repositorySource = fs.readFileSync(
    path.join(repo, "apps/api/src/modules/integrations/integrations.repository.ts"),
    "utf8"
  );
  assert.match(
    repositorySource,
    /findFirst\(\{ where: \{ id, tenantId \} \}\)/u,
    "TBox 更新前必须以 tenantId + id 验证归属"
  );

  console.log("integration memory scope test passed: notifications, jobs and TBox devices are isolated");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
