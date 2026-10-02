"use strict";
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { SubscriptionService } = require("../apps/api/dist/modules/subscription/subscription.service.js");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { CATEGORY_COMMERCIAL_REQUIREMENTS, categoryCommercialRequirements, categoryCommercialCompatibility } = require("../apps/api/dist/modules/rental-core/category-adoption-commercial.js");
if (!/^rental_os_e2e_/u.test(new URL(process.env.DATABASE_URL).pathname.slice(1))) throw new Error("仅允许专用 E2E 库");
const db = new PrismaClient();
const fixture = `commercial_${randomUUID()}`;
const codes = [`${fixture}_a`, `${fixture}_b`];
// An explicit fixture mapping exercises a paid dependency without creating a
// production billing product or changing current Core charging behavior.
const target = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera");
const requirements = categoryCommercialRequirements(target, [{ code: "camera_compatibility", status: "enabled" }], { ...CATEGORY_COMMERCIAL_REQUIREMENTS, camera_compatibility: [codes[0]] });
const rc = { isolationLevel: "ReadCommitted", timeout: 20000 };
function latch() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function observedClient(match, attempted) {
  return new Proxy(db, { get(client, key) {
    if (key === "$transaction") return (work, options) => client.$transaction((tx) => work(new Proxy(tx, { get(inner, method) {
      if (method === "$queryRaw") return (...args) => {
        const sql = args[0].sql ?? args[0].join("?");
        if (match(sql)) attempted.resolve();
        return inner.$queryRaw(...args);
      };
      return Reflect.get(inner, method);
    } })), options);
    return Reflect.get(client, key);
  } });
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("并发屏障测试超时")), 10000); })]); }
  finally { clearTimeout(timer); }
}
const service = new SubscriptionService(db);
const catalogInput = (releaseStatus) => ({ name: fixture, module: fixture, categories: ["camera"], defaultOwnership: "pro", currentOwnership: "pro", releaseStatus, reason: fixture });
async function holdBarrier(writer, match, inspect) {
  const ready = latch(), release = latch(), attempted = latch();
  const holder = db.$transaction(async (tx) => {
    const snapshot = await service.lockCategoryCommercialContext(fixture, tx, [codes[0]]);
    ready.resolve(snapshot); await release.promise;
    return snapshot;
  }, rc);
  holder.catch(() => {});
  let waiting;
  try {
    const snapshot = await bounded(ready.promise);
    inspect(snapshot);
    let settled = false;
    waiting = writer(new SubscriptionService(observedClient(match, attempted))).finally(() => { settled = true; });
    // Attach rejection handling immediately while the row-lock attempt is observed.
    waiting.catch(() => {});
    await bounded(attempted.promise);
    assert.equal(settled, false, "依赖写入必须等待商业屏障事务释放");
    release.resolve(); await holder; await waiting;
  } finally { release.resolve(); await Promise.allSettled([holder, ...(waiting ? [waiting] : [])]); }
}
(async () => {
  try {
    await db.tenant.create({ data: { id: fixture, code: fixture, name: fixture } });
    await db.tenantSubscription.create({ data: { tenantId: fixture, plan: "STANDARD", source: "HISTORICAL_REGISTER", startAt: new Date(Date.now() - 86400000), endAt: new Date(Date.now() + 86400000 * 30) } });
    for (const code of codes) await db.subscriptionFeatureCatalog.create({ data: { code, name: fixture, module: fixture, categories: ["camera"], defaultOwnership: "PRO", currentOwnership: "PRO", releaseStatus: "PILOT" } });
    await db.tenantFeatureGrant.create({ data: { tenantId: fixture, featureCode: codes[0] } });
    await holdBarrier((writer) => writer.revokeFeature(fixture, { featureCode: codes[0], expectedRevision: 1, reason: fixture }), (sql) => sql.includes("FROM Tenant"), (snapshot) => {
      assert.equal(snapshot.entitlements[0].available, true);
      assert.equal(categoryCommercialCompatibility("camera", requirements, snapshot).valid, true);
      assert.equal(categoryCommercialCompatibility("vehicle", requirements, snapshot).valid, false);
      assert.deepEqual(snapshot.lockedFeatureCodes, [codes[0]]);
      assert.equal(snapshot.complete, false);
    });
    const revoked = await db.$transaction((tx) => service.lockCategoryCommercialContext(fixture, tx, [codes[0]]), rc);
    assert.equal(revoked.entitlements[0].available, false);
    assert.equal(categoryCommercialCompatibility("camera", requirements, revoked).valid, false, "撤权后真实权益必须拒绝");
    assert.equal(revoked.revision, 2);
    await holdBarrier((writer) => writer.upsertFeatureCatalog(codes[0], catalogInput("planned")), (sql) => sql.includes("subscription_feature_catalog"), (snapshot) => assert.equal(snapshot.entitlements.length, 1));
    assert.equal((await db.subscriptionFeatureCatalog.findUniqueOrThrow({ where: { code: codes[0] } })).releaseStatus, "PLANNED");
    assert.equal((await db.$transaction((tx) => service.lockCategoryCommercialContext(fixture, tx, [codes[0]]), rc)).entitlements[0].available, false);
    // Only dependencies are locked: an unrelated catalog mutation can finish before release.
    await db.$transaction(async (tx) => {
      await service.lockCategoryCommercialContext(fixture, tx, [codes[0]]);
      await bounded(service.upsertFeatureCatalog(codes[1], catalogInput("planned")));
    }, rc);
    // A winning term correction is observed after the barrier's parent-lock wait.
    const ready = latch(), release = latch(), attempted = latch();
    const correction = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Tenant WHERE id=${fixture} FOR UPDATE`;
      await tx.tenantSubscription.update({ where: { tenantId: fixture }, data: { endAt: new Date(Date.now() - 1000) } });
      ready.resolve(); await release.promise;
    }, rc);
    correction.catch(() => {});
    let waiting;
    try {
      await bounded(ready.promise);
      const caller = observedClient((sql) => sql.includes("FROM Tenant"), attempted);
      let settled = false;
      waiting = caller.$transaction((tx) => service.lockCategoryCommercialContext(fixture, tx, []), rc).finally(() => { settled = true; });
      waiting.catch(() => {});
      await bounded(attempted.promise);
      assert.equal(settled, false);
      release.resolve(); await correction;
      const expiredContext = await waiting;
      assert.equal(expiredContext.newBusinessAllowed, false);
      assert.equal(categoryCommercialCompatibility("camera", requirements, expiredContext).valid, false);
    } finally { release.resolve(); await Promise.allSettled([correction, ...(waiting ? [waiting] : [])]); }
    const beforeEvents = await db.subscriptionEvent.count({ where: { tenantId: fixture } });
    await assert.rejects(db.$transaction((tx) => service.lockCategoryCommercialContext(fixture, tx, [`${fixture}_missing`]), rc), /未登记/);
    await assert.rejects(db.$transaction((tx) => service.lockCategoryCommercialContext(`${fixture}_missing`, tx, []), rc), /租户不存在/);
    assert.equal(await db.subscriptionEvent.count({ where: { tenantId: fixture } }), beforeEvents, "屏障只读，不生成商业办理记录");
    // Before a subscription exists, locking its parent must still block the real first-provision writer.
    await db.tenantSubscription.delete({ where: { tenantId: fixture } });
    await holdBarrier((writer) => writer.provision(fixture, {
      expectedRevision: 0, plan: "standard", source: "historical_register", reason: fixture,
      startAt: new Date(Date.now() - 86400000).toISOString(), endAt: new Date(Date.now() + 86400000 * 30).toISOString()
    }), (sql) => sql.includes("FROM Tenant"), (snapshot) => {
      assert.equal(snapshot.serviceStatus, "unconfigured"); assert.equal(snapshot.revision, 0);
    });
    assert.equal(await db.tenantSubscription.count({ where: { tenantId: fixture } }), 1);
    assert.equal((await db.$transaction((tx) => service.lockCategoryCommercialContext(fixture, tx, []), rc)).newBusinessAllowed, true);
    console.log("商业屏障真库：首次开通/撤权/依赖目录串行、无关目录独立、等待后期限复读、缺项拒绝、无办理副作用 ✓");
  } finally {
    await db.subscriptionEvent.deleteMany({ where: { reason: fixture } });
    await db.tenant.deleteMany({ where: { id: fixture } });
    await db.subscriptionFeatureCatalog.deleteMany({ where: { code: { in: codes } } });
    await db.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
