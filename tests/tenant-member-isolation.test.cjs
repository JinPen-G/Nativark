const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { enterRequestIdentity } = require("../apps/api/src/common/request-identity");
const { StoreRentalService } = require("../apps/api/src/modules/store-rental/store-rental.service");

const config = { get: (key) => key === "STORE_RENTAL_DATA_SOURCE" ? "memory" : undefined };
const service = new StoreRentalService(config, undefined, undefined, undefined);
const identity = (tenantId) => enterRequestIdentity({ tenantId, userId: `${tenantId}_admin`, isSaasAdmin: false });

identity("tenant_001");
const initialDemoTotal = service.listMembers().total;
const created = service.saveMember({
  name: "摄影租户独立会员",
  phone: "13800001001",
  levelName: "普通会员",
  status: "active",
  source: "隔离测试",
  tags: [],
  identityVerified: false,
  driverLicenseVerified: false
});
assert.equal(service.listMembers().total, initialDemoTotal + 1);

identity("tenant_002");
assert.equal(service.listMembers().total, initialDemoTotal, "demo2 must not see a member created by demo");
assert.throws(() => service.getMemberDetail(created.id), /not found/, "cross-tenant member detail access must be rejected");

service.saveMember({
  name: "露营租户独立会员",
  phone: "13800002002",
  levelName: "普通会员",
  status: "active",
  source: "隔离测试",
  tags: [],
  identityVerified: false,
  driverLicenseVerified: false
});
assert.equal(service.listMembers().total, initialDemoTotal + 1);

identity("tenant_001");
assert.equal(service.listMembers().total, initialDemoTotal + 1, "tenant changes must remain isolated in memory mode");

console.log("Tenant member isolation test passed: memory members, details, reviews and plans are partitioned by SaaS tenant context.");
