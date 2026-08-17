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

module.exports = { createAbsorbingConfigStore };
