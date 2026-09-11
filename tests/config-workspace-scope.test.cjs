const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const ROOT = path.resolve(__dirname, "..");
const { runWithRequestIdentity } = require(path.join(ROOT, "apps/api/src/common/request-identity"));
const { RentalCoreConfigRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core-config.repository"));
const { RentalBusinessConfigRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business-config.repository"));

function rejects(promise, pattern, label) {
  return assert.rejects(promise, (error) => {
    assert.match(error.message, pattern, `${label}：实际 ${error.message}`);
    return true;
  }, label);
}

function scopedClient(model, existing) {
  return {
    businessWorkspace: {
      async findFirst() { return { id: "workspace-current" }; }
    },
    [model]: {
      async findUnique() { return existing; },
      async upsert() { throw new Error("跨空间记录不应进入 upsert"); }
    }
  };
}

function methodBody(source, method) {
  const start = source.indexOf(`async ${method}(`);
  assert.notEqual(start, -1, `找不到配置写方法 ${method}`);
  const next = source.indexOf("\n  async ", start + 6);
  return source.slice(start, next === -1 ? source.length : next);
}

void (async () => {
  const coreClient = scopedClient("rentalFulfillmentOperator", { tenantId: "tenant-b", workspaceId: "workspace-other" });
  const coreRepo = new RentalCoreConfigRepository(coreClient);
  await rejects(
    runWithRequestIdentity(
      { tenantId: "tenant-a", workspaceId: "workspace-current", userId: "user-a" },
      () => coreRepo.upsertOperator({
        id: "operator-other", tenantId: "tenant-a", code: "OP-1", name: "当前主体", type: "self_operated",
        status: "enabled", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      })
    ),
    /已属于其他租户或经营空间/u,
    "核心配置不能覆盖其他空间经营主体"
  );
  console.log("  PASS 核心配置 upsert 拒绝跨租户/空间主体");

  const businessClient = scopedClient("rentalPricingPlan", { tenantId: "tenant-b", workspaceId: "workspace-other" });
  const businessRepo = new RentalBusinessConfigRepository(businessClient);
  await rejects(
    runWithRequestIdentity(
      { tenantId: "tenant-a", workspaceId: "workspace-current", userId: "user-a" },
      () => businessRepo.upsertPricingPlan({
        id: "plan-other", tenantId: "tenant-a", categoryCode: "camera", code: "P-1", name: "当前计划",
        currency: "CNY", status: "draft", version: "1", effectiveFrom: new Date().toISOString(),
        rates: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      })
    ),
    /已属于其他租户或经营空间/u,
    "业务配置不能覆盖其他空间价格计划"
  );
  console.log("  PASS 业务配置 upsert 拒绝跨租户/空间价格计划");

  const coreSource = fs.readFileSync(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core-config.repository.ts"), "utf8");
  for (const method of ["upsertOperator", "upsertLocation", "upsertItemGroup", "upsertPricingGroup", "upsertCouponTemplate", "upsertInspectionTemplate"]) {
    assert.match(methodBody(coreSource, method), /assertScopedWrite\(/u, `${method} 必须执行作用域断言`);
  }
  const businessSource = fs.readFileSync(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business-config.repository.ts"), "utf8");
  for (const method of ["upsertPricingPlan", "upsertDiscountPlan", "upsertService", "upsertRuleVersion", "writeRuleVersionWithAudit", "upsertNotificationTemplate"]) {
    assert.match(methodBody(businessSource, method), /assertScopedWrite\(/u, `${method} 必须执行作用域断言`);
  }
  console.log("  PASS 全部配置写入口均登记作用域断言");
  console.log("配置空间范围专项：3 项全部通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
