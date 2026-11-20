'use strict';
/** Real Rental application/lifecycle/workers; only database transport and timers
 * are controlled. No Nest init/listen, real Client, network, or disk output.
 * node apps/rental-api/test/lifecycle.test.cjs --deps <node_modules>
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--deps' || !args[1])) throw Error('只接受 --deps <node_modules>');
const deps = path.resolve(args[1] || path.join(root, 'node_modules'));
const temporary = path.join(root, 'output/.tmp/rental-lead-data');
assert.equal(fs.existsSync(temporary), false);
Object.assign(process.env, { DATABASE_URL: 'mysql://offline:offline@127.0.0.1:1/rental_os_offline',
  AI_OFFLINE_WRITE_ROOT: temporary, AI_OFFLINE_AUDIT: path.join(temporary, 'guard.log'), TEMP: temporary, TMP: temporary });
require(path.join(root, 'tests/fixtures/ai-native/prisma-offline-preload.cjs'));
const { createControllerSourceLoader } = require(path.join(root, 'scripts/controller-sources.cjs'));
const loader = createControllerSourceLoader(root, deps);
const load = file => loader.load(path.join(root, file));
const { ConfigService } = loader.requireDependency('@nestjs/config');
const { createRentalApplication } = load('packages/rental-core/src/application.ts');
const { createRentalWorkerAuthority } = load('packages/rental-core/src/application-worker-authority.ts');
const { RentalApplicationLifecycle } = load('apps/rental-api/src/lifecycle.ts');
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture(configuration = {}) {
  const f = { trace: [], reads: new Map(), intervals: [], queries: [], disconnects: 0, connects: 0 };
  // Exact empty persisted startup dataset. Unexpected statements/delegates fail,
  // rather than inventing rows or permitting a worker/current-authority check.
  const emptyTables = [
    'businessWorkspace', 'tenantRentalProfile', 'rentalTenantBusinessSettings', 'rentalCoreStateSnapshot', 'rentalBusinessStateSnapshot',
    'rentalFulfillmentOperator', 'rentalFulfillmentLocation', 'rentalItemGroup', 'rentalPricingGroup', 'rentalCouponTemplate', 'rentalInspectionTemplate',
    'rentalPricingPlan', 'rentalDiscountPlan', 'rentalValueAddedService', 'rentalBusinessCalendar', 'rentalRuleVersion', 'rentalNotificationTemplate',
    'rentalQuote', 'rentalCustomerCoupon', 'rentalRewardLedgerEntry', 'rentalBenefitAccount', 'rentalReferral', 'rentalNotificationLog',
    'fileAsset', 'fileUploadSession'
  ];
  const read = async (table, query) => {
    f.trace.push(table + '.findMany'); f.reads.set(table, (f.reads.get(table) ?? 0) + 1);
    return f.onRead ? await f.onRead(table, query) : [];
  };
  const database = Object.fromEntries(emptyTables.map(table => [table, { findMany: query => read(table, query) }]));
  Object.assign(database, {
    tenantIntegrationConfig: {}, externalAdapterLog: {},
    clientApiRateBucket: { deleteMany: async query => { f.trace.push('rate.cleanup'); await f.onRateCleanup?.(query); return { count: 0 }; } },
    async $transaction(consume, options) {
      f.trace.push('transaction.begin');
      const tx = { ...database, $transaction: undefined, async $queryRaw(query, ...values) {
        const sql = (Array.isArray(query) ? query.join('?') : query.sql).replace(/\s+/gu, ' ').trim();
        f.queries.push(sql); f.trace.push(sql);
        if (sql === 'SELECT GET_LOCK(?, 0) AS acquired') {
          assert.deepEqual(options, { maxWait: 5000, timeout: 600000 });
          await f.onNamedLock?.(values[0]); return [{ acquired: 0 }];
        }
        throw Error('unexpected lifecycle SQL: ' + sql);
      } };
      delete tx.$transaction;
      try { return await consume(tx); }
      finally { f.trace.push('transaction.end'); }
    }
  });
  const config = new ConfigService({ NODE_ENV: 'production', PLATFORM_DATA_SOURCE: 'mysql', INFRA_DATA_SOURCE: 'mysql',
    AUTH_TOKEN_SECRET: 'offline-lifecycle-secret', FILE_UPLOAD_CLEANUP_INTERVAL_MS: 120000, ...configuration });
  const application = createRentalApplication({ database, configuration: config, aiMode: 'disabled',
    fileCleanupAuthority: { assert: async () => { throw Error('empty lifecycle fixture has no file cleanup grant'); } },
    participants: { readInspectionMedia: async () => { throw Error('lifecycle must not read inspection media'); } },
    workerAuthority: foundation => createRentalWorkerAuthority({ database, configuration: foundation.coreConfiguration,
      term: { requireNewBusiness: async () => { throw Error('empty lifecycle fixture has no business grant'); } },
      admissionForTransaction: () => { throw Error('empty lifecycle fixture has no deployment admission'); },
      deploymentForTransaction: () => { throw Error('empty lifecycle fixture has no deployment grant'); } }) });
  const lifecycle = new RentalApplicationLifecycle(application,
    async () => { f.trace.push('disconnect'); f.disconnects++; }, async () => { f.trace.push('connect'); f.connects++; });
  return Object.assign(f, { database, application, lifecycle });
}

async function withTimers(f, consume, environment = {}) {
  const original = { setInterval: global.setInterval, clearInterval: global.clearInterval };
  const keys = ['NODE_ENV', 'RENTAL_DUE_JOBS_DISABLED', 'RENTAL_DUE_JOB_INTERVAL_MS', 'CLIENT_API_RATE_LIMIT_CLEANUP_DISABLED'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'production', RENTAL_DUE_JOB_INTERVAL_MS: '1234', ...environment });
  global.setInterval = (callback, delay) => {
    const timer = { callback, delay, cleared: false, unrefs: 0, unref() { this.unrefs++; } };
    f.intervals.push(timer); return timer;
  };
  global.clearInterval = timer => { assert(f.intervals.includes(timer)); timer.cleared = true; };
  try { await consume(); }
  finally {
    // Tests settle every suspended storage operation before entering cleanup.
    await f.lifecycle.onApplicationShutdown();
    Object.assign(global, original);
    for (const key of keys) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key];
    assert(f.intervals.every(timer => timer.cleared), 'all owned interval handles released');
  }
}
function interval(f, delay) {
  const timers = f.intervals.filter(timer => timer.delay === delay);
  assert.equal(timers.length, 1); return timers[0];
}
async function assertPending(promise) {
  let completed = false;
  void promise.then(() => { completed = true; }, () => { completed = true; });
  await turn(); assert.equal(completed, false, 'shutdown must still wait for original in-flight storage');
}

async function main() {
  let checks = 0;
  const test = async (name, work) => { await work(); checks++; console.log('PASS ' + name); };
  await test('真实单实例初始化/预热后启动原四计时器，重复 Nest hooks 不重复启动/断库', async () => {
    const f = fixture(); assert.deepEqual(f.trace, []);
    await withTimers(f, async () => {
      await Promise.all([f.lifecycle.onModuleInit(), f.lifecycle.onModuleInit()]);
      assert.equal(f.connects, 1); assert.equal(f.intervals.length, 0);
      await Promise.all([f.lifecycle.onApplicationBootstrap(), f.lifecycle.onApplicationBootstrap()]);
      assert.deepEqual(f.intervals.map(timer => timer.delay).sort((a, b) => a - b), [1234, 60000, 120000, 600000]);
      assert(f.intervals.every(timer => timer.unrefs === 1));
      assert(f.trace.includes('rentalCoreStateSnapshot.findMany')); assert(f.trace.includes('rentalBusinessStateSnapshot.findMany'));
      assert.equal(f.application.workers.dueJobs.started, true);
      await Promise.all([f.lifecycle.onApplicationShutdown(), f.lifecycle.onApplicationShutdown()]);
      assert.equal(f.application.workers.dueJobs.started, false); assert.equal(f.disconnects, 1);
      const reads = f.trace.length;
      await f.lifecycle.onApplicationBootstrap(); await f.application.workers.dueJobs.runTick();
      assert.equal(f.trace.length, reads, 'stopped host does not schedule new work');
    });
  });
  await test('原 enable/disabled 配置继续生效，配货仅保留原固定扫描节拍', async () => {
    const f = fixture({ FILE_UPLOAD_CLEANUP_DISABLED: 'true' });
    await withTimers(f, async () => {
      await f.lifecycle.onApplicationBootstrap();
      assert.deepEqual(f.intervals.map(timer => timer.delay), [60000]);
      assert.equal(f.application.workers.dueJobs.started, false);
    }, { RENTAL_DUE_JOBS_DISABLED: 'true', CLIENT_API_RATE_LIMIT_CLEANUP_DISABLED: 'true' });
  });
  for (const failed of [false, true]) await test('到期 tick 空间查询悬挂时停机等待，' + (failed ? '查询失败也排空' : '返回后不启动新 job'), async () => {
    const f = fixture(), entered = defer(), release = defer();
    await withTimers(f, async () => {
      await f.lifecycle.onApplicationBootstrap();
      f.onRead = async table => {
        if (table === 'rentalTenantBusinessSettings') {
          entered.resolve(); await release.promise;
          if (failed) throw Error('synthetic scope lookup failure');
          return [{ tenantId: 'tenant-a', workspaceId: 'workspace-a' }];
        }
        return [];
      };
      const running = f.application.workers.dueJobs.runTick();
      const completion = failed ? assert.rejects(running, /synthetic scope lookup failure/u) : running;
      await entered.promise;
      const shutdown = f.lifecycle.onApplicationShutdown();
      try { await assertPending(shutdown); assert.equal(f.disconnects, 0); }
      finally { release.resolve(); }
      await completion; await shutdown;
      assert.equal(f.queries.length, 0, 'late enumeration cannot claim a new job');
      assert.equal(f.disconnects, 1);
      assert(f.intervals.every(timer => timer.cleared));
      const reads = f.trace.length;
      interval(f, 1234).callback(); await f.application.workers.dueJobs.runTick();
      assert.equal(await f.application.workers.dueJobs.runLocked(f.application.workers.dueJobs.jobs[0], 'tenant-a', 'workspace-a'), false);
      assert.equal(f.trace.length, reads, 'late timer/direct entry cannot use closed database');
    });
  });
  await test('原命名锁事务等待仍纳入排空，不改变 10 分钟事务超时', async () => {
    const f = fixture(), entered = defer(), release = defer();
    await withTimers(f, async () => {
      await f.lifecycle.onApplicationBootstrap();
      f.onNamedLock = async () => { entered.resolve(); await release.promise; };
      const running = f.application.workers.dueJobs.runLocked(f.application.workers.dueJobs.jobs[0], 'tenant-a', 'workspace-a');
      await entered.promise;
      const shutdown = f.lifecycle.onApplicationShutdown();
      try { await assertPending(shutdown); assert.equal(f.disconnects, 0); }
      finally { release.resolve(); }
      assert.equal(await running, false); await shutdown;
      assert(f.trace.indexOf('transaction.end') < f.trace.indexOf('disconnect'));
      assert.equal(f.queries.length, 1);
    });
  });
  await test('配货/文件清理/限流桶原在途工作全部结束后唯一断库', async () => {
    const f = fixture(), allocation = defer(), files = defer(), rates = defer();
    const entered = { allocation: defer(), files: defer(), rates: defer() };
    await withTimers(f, async () => {
      await f.lifecycle.onApplicationBootstrap();
      f.onRead = async table => {
        if (table === 'rentalTenantBusinessSettings') { entered.allocation.resolve(); await allocation.promise; }
        if (table === 'fileUploadSession' || table === 'fileAsset') { entered.files.resolve(); await files.promise; }
        return [];
      };
      f.onRateCleanup = async () => { entered.rates.resolve(); await rates.promise; };
      const scanning = f.application.workers.allocation.runDue();
      const cleaning = f.application.integrations.fileCleanup.runOnce();
      interval(f, 600000).callback();
      await Promise.all(Object.values(entered).map(value => value.promise));
      const shutdown = f.lifecycle.onApplicationShutdown();
      try {
        await assertPending(shutdown); allocation.resolve(); await scanning;
        await assertPending(shutdown); files.resolve(); await cleaning;
        await assertPending(shutdown); assert.equal(f.disconnects, 0);
      } finally { allocation.resolve(); files.resolve(); rates.resolve(); }
      await shutdown; assert.equal(f.disconnects, 1);
      const reads = f.trace.length;
      for (const timer of f.intervals) timer.callback();
      await turn(); assert.equal(f.trace.length, reads);
    });
  });
  assert.equal(fs.existsSync(temporary), false);
  console.log(JSON.stringify({ checks, realApplication: true, timers: 'manual interval handles only', database: 'in-memory transport',
    network: 0, modelCalls: 0, diskOutputs: 0 }));
}
let completed = false;
process.once('beforeExit', () => assert(completed, 'lifecycle regression left an unresolved wait'));
main().then(() => { completed = true; }, error => { completed = true; console.error(error); process.exitCode = 1; });
