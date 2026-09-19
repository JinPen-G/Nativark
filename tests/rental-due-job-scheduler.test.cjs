const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const {
  RentalDueJobScheduler,
  rentalDueJobLockName,
  rentalDueJobsDisabled,
  rentalDueJobIntervalMs
} = require("../apps/api/src/modules/rental-core/rental-due-job.scheduler");
const { getRequestIdentity } = require("../apps/api/src/common/request-identity");

/**
 * RULE-CLOSE-02：到期任务调度器的判定口径，不连库。
 * 用 fake Prisma 模拟 GET_LOCK / RELEASE_LOCK；真实落库语义由手动接口的 e2e 覆盖。
 */

/** fake Prisma：interactive $transaction 只把一个记录 SQL 的 tx 交给回调；`held` 中的锁名 GET_LOCK 返回 0。 */
function fakePrisma(scopes, held = new Set()) {
  const calls = [];
  const tx = {
    $queryRaw(strings, ...values) {
      const sql = strings.join("?");
      const name = values[0];
      if (sql.includes("GET_LOCK")) {
        const acquired = held.has(name) ? 0 : 1;
        if (acquired) held.add(name);
        calls.push(["get", name, acquired]);
        return Promise.resolve([{ acquired }]);
      }
      if (sql.includes("RELEASE_LOCK")) {
        held.delete(name);
        calls.push(["release", name]);
        return Promise.resolve([{ released: 1 }]);
      }
      throw new Error(`unexpected sql ${sql}`);
    }
  };
  return {
    calls,
    rentalTenantBusinessSettings: { findMany: async () => scopes },
    $transaction: (fn) => fn(tx)
  };
}

function scheduler(prisma) {
  // 业务依赖在这些用例里不会被触达：注册表会被替换成 fake job。
  return new RentalDueJobScheduler(prisma, {}, {}, {}, {}, undefined);
}

(async () => {
  // 1. 注册表顺序固定，是后续追加 payment-intent 任务的扩展点。
  const s = scheduler(fakePrisma([]));
  assert.deepEqual(
    s.jobs.map((job) => job.name),
    ["expire_pending_orders", "reconcile_pickup_overdue", "retry_due_notifications", "run_due_price_adjustments", "expire_payment_intents"]
  );
  assert.ok(s.jobs.every((job) => typeof job.run === "function"));

  // 2. 锁名格式与 64 字符上限。
  assert.equal(rentalDueJobLockName("expire_pending_orders", "t1", "w1"), "rental-os:due:expire_pending_orders:t1:w1");
  const long = rentalDueJobLockName("run_due_price_adjustments", "tenant_" + "x".repeat(30), "ws_" + "y".repeat(30));
  assert.ok(long.length <= 64, `lock name too long: ${long.length}`);
  assert.ok(long.startsWith("rental-os:due:"));
  assert.equal(long, rentalDueJobLockName("run_due_price_adjustments", "tenant_" + "x".repeat(30), "ws_" + "y".repeat(30)));

  // 3. 已被其他实例持有的锁：跳过，不执行，不 RELEASE。
  {
    const held = new Set([rentalDueJobLockName("a", "t1", "w1")]);
    const prisma = fakePrisma([{ tenantId: "t1", workspaceId: "w1" }], held);
    const ran = [];
    const sch = scheduler(prisma);
    sch.jobs = [
      { name: "a", run: async () => { ran.push("a"); } },
      { name: "b", run: async (tenantId, workspaceId) => { ran.push(`b:${tenantId}:${workspaceId}:${getRequestIdentity().userId}`); } }
    ];
    await sch.runTick();
    assert.deepEqual(ran, ["b:t1:w1:due-job-scheduler"]);
    assert.deepEqual(prisma.calls, [
      ["get", "rental-os:due:a:t1:w1", 0],
      ["get", "rental-os:due:b:t1:w1", 1],
      ["release", "rental-os:due:b:t1:w1"]
    ]);
    assert.ok(held.has("rental-os:due:a:t1:w1"), "外部持有的锁不能被本实例释放");
  }

  // 4. 一个任务抛错：锁仍释放，后续任务与后续空间继续执行。
  {
    const prisma = fakePrisma([
      { tenantId: "t1", workspaceId: "w1" },
      { tenantId: "t2", workspaceId: "w2" }
    ]);
    const ran = [];
    const sch = scheduler(prisma);
    sch.logger = { error: () => {} };
    sch.jobs = [
      { name: "boom", run: async (tenantId) => { if (tenantId === "t1") throw new Error("boom"); ran.push(`boom:${tenantId}`); } },
      { name: "next", run: async (tenantId) => { ran.push(`next:${tenantId}`); } }
    ];
    await sch.runTick();
    assert.deepEqual(ran, ["next:t1", "boom:t2", "next:t2"]);
    const releases = prisma.calls.filter(([kind]) => kind === "release").map(([, name]) => name);
    assert.ok(releases.includes("rental-os:due:boom:t1:w1"), "抛错后也必须 RELEASE_LOCK");
    assert.equal(prisma.calls.filter(([kind]) => kind === "get").length, 4);
  }

  // 5. 禁用开关 / 测试环境不启动定时器；启用时启动且可停止。
  assert.equal(rentalDueJobsDisabled({ RENTAL_DUE_JOBS_DISABLED: "1" }), true);
  assert.equal(rentalDueJobsDisabled({ NODE_ENV: "test" }), true);
  assert.equal(rentalDueJobsDisabled({}), false);
  assert.equal(rentalDueJobIntervalMs({}), 60_000);
  assert.equal(rentalDueJobIntervalMs({ RENTAL_DUE_JOB_INTERVAL_MS: "5000" }), 5000);
  assert.equal(rentalDueJobIntervalMs({ RENTAL_DUE_JOB_INTERVAL_MS: "10" }), 60_000);
  {
    const saved = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.RENTAL_DUE_JOBS_DISABLED = "1";
    const sch = scheduler(fakePrisma([]));
    sch.onApplicationBootstrap();
    assert.equal(sch.started, false);
    delete process.env.RENTAL_DUE_JOBS_DISABLED;
    sch.onApplicationBootstrap();
    assert.equal(sch.started, true);
    sch.onModuleDestroy();
    assert.equal(sch.started, false);
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.RENTAL_DUE_JOBS_DISABLED === undefined) delete process.env.RENTAL_DUE_JOBS_DISABLED;
  }

  console.log("rental-due-job-scheduler: ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
