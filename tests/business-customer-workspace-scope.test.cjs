const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { createAbsorbingConfigStore, createAbsorbingFactStore, createAbsorbingBusinessConfigStore, createAbsorbingBusinessFactStore } = require("./helpers/absorbing-config-store.cjs");

/**
 * ACCESS-01B 专项：空间级优惠/奖励事实的客户范围。
 *
 * CustomerProfile 是租户共享主档，但客户券、奖励和邀请关系都是经营空间事实。
 * 只校验 tenantId 会允许管理员把另一空间的客户写进当前空间；这三条入口必须
 * 在真正写库前统一经过当前空间会员关系检查。
 */

const core = new RentalCoreService(createAbsorbingConfigStore(), createAbsorbingFactStore());
const coreConfig = createAbsorbingConfigStore();
const memberships = {
  calls: [],
  async assertCustomerInWorkspace(tenantId, workspaceId, customerId) {
    this.calls.push({ tenantId, workspaceId, customerId });
    if (customerId.startsWith("out-of-scope")) throw new Error("该客户尚未接入当前经营空间");
  }
};
const business = new RentalBusinessService(
  createAbsorbingBusinessConfigStore(),
  createAbsorbingBusinessFactStore(),
  coreConfig,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  memberships
);

function context(tenantId) {
  const profile = core.getProfile(tenantId);
  return {
    profile,
    category: core.listCategories().find((item) => item.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId),
    pricingGroups: core.listPricingGroups(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId),
    operators: core.listOperators(tenantId)
  };
}

void (async () => {
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();
  const tenantId = "tenant_002";
  const currentWorkspaceId = "ws_tenant_002";
  const currentContext = context(tenantId);

  await assert.rejects(
    business.claimCoupon(tenantId, currentContext, "coupon-template", "out-of-scope-customer"),
    /尚未接入当前经营空间/u
  );
  console.log("  PASS 跨空间客户不能领取当前空间优惠券");

  await assert.rejects(
    business.grantReward(tenantId, currentContext, {
      customerId: "out-of-scope-customer",
      triggerType: "registration",
      idempotencyKey: "scope-test-reward"
    }),
    /尚未接入当前经营空间/u
  );
  console.log("  PASS 跨空间客户不能获得当前空间奖励");

  await assert.rejects(
    business.registerReferral(tenantId, currentContext, "out-of-scope-invitee", "in-scope-referrer"),
    /尚未接入当前经营空间/u
  );
  console.log("  PASS 跨空间客户不能建立当前空间邀请关系");

  assert.ok(memberships.calls.length >= 3);
  assert.ok(memberships.calls.every((call) => call.tenantId === tenantId && call.workspaceId === currentWorkspaceId));
  console.log("客户营销事实空间范围专项：3 项全部通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
