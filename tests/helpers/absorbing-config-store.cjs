/**
 * 吸收式配置 store：读返回空、写丢弃。
 *
 * 用途：让不连数据库的单元测试继续运行。配置读取由 RentalCoreService 的内存写穿缓存
 * （seedState 灌入）提供，本 stub 只负责把写穿的那一端吞掉。
 *
 * 刻意**不**实现查询语义。忠实模拟 Prisma 的外键、唯一约束和事务回滚会带来
 * 「对着假实现通过、对着真 MySQL 失败」的分叉风险——本项目 P0-01 的起因正是
 * 内存模式固件掩盖了跨租户泄露。因此租户隔离、外键完整性、唯一约束、
 * 过期预占过滤这类断言只放在 tests/mysql-e2e.test.cjs，不在这里假装覆盖。
 *
 * writes 数组只用于需要断言"确实发生了写穿"的场景，不作为数据源回读。
 */
function createAbsorbingConfigStore() {
  const writes = [];
  const record = (kind) => (payload) => {
    writes.push({ kind, id: payload?.id ?? payload?.tenantId });
    return Promise.resolve();
  };
  return {
    writes,
    loadAll: () => Promise.resolve([]),
    upsertProfile: record("profile"),
    upsertBusinessSettings: record("businessSettings"),
    upsertOperator: record("operator"),
    upsertLocation: record("location"),
    upsertItemGroup: record("itemGroup"),
    upsertCouponTemplate: record("couponTemplate"),
    upsertInspectionTemplate: record("inspectionTemplate")
  };
}


/**
 * 吸收式事实 store：读返回空、写丢弃。
 *
 * 与配置 stub 的差别很重要：配置读取走服务内存写穿缓存，所以吸收式 stub 不影响断言；
 * 而事实是**从 store 读**的，返回空意味着订单类断言在这里无法成立。这是有意的——
 * 订单生命周期、库存占用释放、资产状态流转和检查联动都依赖持久化语义，
 * 只有 tests/mysql-e2e.test.cjs 对真实 MySQL 的断言才算证明；在这里靠假实现
 * 重写一遍查询逻辑只会制造「对着假的过、对着真库挂」的分叉。
 *
 * 因此这个 stub 只保证服务可被构造、配置与纯算法断言可运行。
 */
function createAbsorbingFactStore() {
  const writes = [];
  const record = (kind) => (payload) => {
    writes.push({ kind, id: payload?.id });
    return Promise.resolve();
  };
  return {
    writes,
    listOrders: () => Promise.resolve([]),
    findOrder: () => Promise.resolve(undefined),
    countOrders: () => Promise.resolve(0),
    saveOrderAggregate: record("order"),
    activeReservations: () => Promise.resolve([]),
    allocatedAssetIds: () => Promise.resolve(new Set()),
    listAssets: () => Promise.resolve([]),
    upsertAsset: record("asset"),
    listStockBalances: () => Promise.resolve([]),
    upsertStockBalance: record("stockBalance"),
    listInspections: () => Promise.resolve([]),
    insertInspection: record("inspection")
  };
}


/** 吸收式业务配置 store：读返回空、写丢弃。语义与核心配置 stub 完全一致。 */
function createAbsorbingBusinessConfigStore() {
  const writes = [];
  const record = (kind) => (payload) => {
    writes.push({ kind, id: payload?.id ?? payload?.year });
    return Promise.resolve();
  };
  return {
    writes,
    loadAll: () => Promise.resolve([]),
    upsertPricingPlan: record("pricingPlan"),
    upsertDiscountPlan: record("discountPlan"),
    upsertService: record("service"),
    upsertCalendar: record("calendar"),
    upsertRuleVersion: record("ruleVersion"),
    replacePublishedRuleVersion: (next) => {
      writes.push({ kind: "ruleVersion", id: next?.id });
      return Promise.resolve();
    },
    upsertNotificationTemplate: record("notificationTemplate")
  };
}

module.exports = {
  createAbsorbingConfigStore,
  createAbsorbingFactStore,
  createAbsorbingBusinessConfigStore
};

/** 吸收式业务事实 store：读返回空、写丢弃。 */
function createAbsorbingBusinessFactStore() {
  const writes = [];
  const record = (kind) => (payload) => {
    writes.push({ kind, id: payload?.id ?? payload?.customerId });
    return Promise.resolve();
  };
  return {
    writes,
    loadAll: () => Promise.resolve([]),
    upsertQuote: record("quote"),
    upsertCustomerCoupon: record("customerCoupon"),
    upsertRewardEntry: record("rewardEntry"),
    upsertBenefitAccount: record("benefitAccount"),
    upsertReferral: (_tenantId, referral) => {
      writes.push({ kind: "referral", id: referral?.inviteeCustomerId });
      return Promise.resolve();
    },
    insertNotificationLog: record("notificationLog")
  };
}

module.exports.createAbsorbingBusinessFactStore = createAbsorbingBusinessFactStore;
