"use strict";
const assert = require("node:assert/strict");
const { RentalBusinessService } = require("../apps/api/dist/modules/rental-core/rental-business.service.js");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
(async () => {
  const previousMode = process.env.PLATFORM_DATA_SOURCE;
  process.env.PLATFORM_DATA_SOURCE = "mysql";
  try {
    const service = Object.create(RentalBusinessService.prototype);
    const tx = {};
    let transactionCalls = 0;
    service.prisma = { $transaction: async (work, options) => {
      assert.equal(options.isolationLevel, "ReadCommitted");
      transactionCalls++;
      return work(tx);
    } };
    service.assertCustomerInCurrentWorkspace = async () => {};
    const state = { customerCoupons: [], rewardLedger: [] };
    service.state = () => state;
    service.coreConfigStore = { lockCouponTemplateForClaim: async (_tenant, _template, client) => {
      assert.equal(client, tx);
      return { status: "active", claimFrom: "2020-01-01", claimTo: "2126-01-01", claimedQuantity: 1, totalQuota: 5, perCustomerLimit: 1 };
    } };
    service.factStore = { countCustomerCoupons: async (_tenant, _template, _customer, client) => {
      assert.equal(client, tx); return 1;
    }, findRewardsByIdempotencyKey: async () => [{ id: "existing_reward" }] };
    await assert.rejects(service.claimCoupon("tenant", { couponTemplates: [] }, "template", "customer"), /每客限领/);
    service.refreshFromDatabase = async () => {};
    service.refreshCouponTemplateCache = async () => {};
    assert.equal((await service.grantReward("tenant", { couponTemplates: [] }, { customerId: "customer", idempotencyKey: "reward" }))[0].id, "existing_reward");
    assert.equal(transactionCalls, 2, "普通领券和奖励自建事务都必须显式使用 RC");

    const core = Object.create(RentalCoreService.prototype);
    const templates = [{ id: "old", claimedQuantity: 0 }];
    core.state = () => ({ couponTemplates: templates });
    core.resolveWorkspaceId = () => "session-space";
    core.configStore = { listCouponTemplates: async (tenant, workspace) => {
      assert.equal(tenant, "tenant"); assert.equal(workspace, "session-space");
      return [{ id: "current", claimedQuantity: 2 }];
    } };
    assert.equal((await core.readCouponTemplates("tenant"))[0].claimedQuantity, 2);
    assert.equal(templates[0].id, "current", "刷新保留数组引用但更新当前空间事实");
    let finish;
    core.configStore.listCouponTemplates = () => new Promise((resolve) => { finish = resolve; });
    const delayed = core.readCouponTemplates("tenant");
    templates[0] = { id: "newer", claimedQuantity: 3 };
    finish([{ id: "stale", claimedQuantity: 1 }]);
    await delayed;
    assert.equal(templates[0].id, "newer", "迟到查询不得覆盖更新的本地保存或刷新");
    core.configStore = {};
    assert.equal(await core.readCouponTemplates("tenant"), templates, "内存模式保留原数据源语义");
    console.log("category-coupon-transaction: 领券/奖励 RC、会话空间定向刷新、旧读取不覆盖新缓存通过（执行替身）");
  } finally {
    if (previousMode === undefined) delete process.env.PLATFORM_DATA_SOURCE;
    else process.env.PLATFORM_DATA_SOURCE = previousMode;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
