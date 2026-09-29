const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
require("reflect-metadata");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { PrismaClient } = require("@prisma/client");
const { SubscriptionService } = require("../apps/api/src/modules/subscription/subscription.service");
const runtime = require("../scripts/ops/runtime.cjs");
const { redact } = require("../scripts/ops/dedicated-env.cjs");
const root = path.resolve(__dirname, "..");
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const basis = { source: "historical_register", reason: "隔离测试库的模拟历史服务，非真实收费" };
const provision = (extra = {}) => ({ ...basis, plan: "standard", expectedRevision: 0, startAt: iso(-10), endAt: iso(30), timeZone: "Asia/Shanghai", ...extra });
function oneConflict(results) {
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, "并发办理只允许一次成功");
  const failure = results.find((r) => r.status === "rejected");
  assert.equal(failure.reason.getStatus?.(), 409, "失败应为可理解的修订冲突");
}

async function main() {
  const url = new URL(runtime.loadDatabaseUrl());
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "只允许本机隔离库");
  assert.equal(url.port || "3306", "3306");
  const admin = runtime.requireAdminTarget({});
  url.username = admin.user; url.password = admin.password; url.pathname = "/mysql"; url.search = "?connect_timeout=5";
  const owner = new PrismaClient({ datasources: { db: { url: url.href } } });
  const database = `rental_os_dedicated_subscription_${Date.now()}_${process.pid}`;
  assert.match(database, /^rental_os_dedicated_subscription_\d+_\d+$/);
  let created = false;
  const clients = [];
  const report = [];
  try {
    await owner.$executeRawUnsafe(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true; url.pathname = `/${database}`;
    const connect = () => { const client = new PrismaClient({ datasources: { db: { url: url.href } } }); clients.push(client); return client; };
    const a = connect(); const b = connect();
    const schema = execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", path.join(root, "apps/api/prisma/schema.prisma"), "--script"], { cwd: root, encoding: "utf8", env: { ...process.env, DATABASE_URL: url.href }, maxBuffer: 8 * 1024 * 1024 });
    const tenantTable = schema.replace(/^--.*$/gm, "").split(";").find((sql) => sql.includes("CREATE TABLE `Tenant`"));
    assert.ok(tenantTable); await a.$executeRawUnsafe(tenantTable);
    for (const name of ["20260926060000_saas_subscription_foundation", "20260929130000_subscription_term_consistency"]) {
      const sql = fs.readFileSync(path.join(root, "apps/api/prisma/migrations", name, "migration.sql"), "utf8").replace(/^--.*$/gm, "");
      for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) await a.$executeRawUnsafe(statement);
    }
    report.push("基础与增量订阅迁移");
    const ids = Array.from({ length: 8 }, () => randomUUID());
    for (const [i, id] of ids.entries()) await a.tenant.create({ data: { id, code: `subscription-test-${i}`, name: `订阅专项测试 ${i}` } });
    const first = new SubscriptionService(a); const second = new SubscriptionService(b);
    const opening = provision();
    oneConflict(await Promise.allSettled([first.provision(ids[0], opening), second.provision(ids[0], opening)]));
    assert.equal(await a.tenantSubscriptionSegment.count({ where: { tenantId: ids[0] } }), 1);
    assert.equal(await a.subscriptionEvent.count({ where: { tenantId: ids[0] } }), 1);
    report.push("跨连接首次开通与修订冲突");

    const renew = { ...basis, plan: "pro", expectedRevision: 1, serviceYears: 1 };
    oneConflict(await Promise.allSettled([first.renew(ids[0], renew), second.renew(ids[0], renew)]));
    const current = await second.getTenantView(ids[0]);
    assert.equal(current.overview.plan, "standard"); assert.equal(current.overview.next.plan, "pro");
    assert.equal(await a.tenantSubscriptionSegment.count({ where: { tenantId: ids[0], status: "SCHEDULED" } }), 1);
    report.push("并发续费不重复接续、不提前授予PRO");

    const start = iso(31);
    const schedule = { ...basis, plan: "standard", expectedRevision: 2, effectiveAt: start, serviceYears: 1 };
    oneConflict(await Promise.allSettled([first.scheduleNext(ids[0], schedule), second.scheduleNext(ids[0], schedule)]));
    assert.equal(await a.tenantSubscriptionSegment.count({ where: { tenantId: ids[0], status: "SCHEDULED" } }), 1);
    assert.equal(await a.tenantSubscriptionSegment.count({ where: { tenantId: ids[0], status: "HISTORICAL" } }), 1);
    report.push("并发替换排期保留历史且仅一条生效排期");

    await first.provision(ids[1], provision({ plan: "pro", startAt: iso(-100), endAt: iso(-20) }));
    await a.tenantSubscriptionSegment.create({ data: { tenantId: ids[1], status: "SCHEDULED", plan: "STANDARD", source: "HISTORICAL_REGISTER", startAt: new Date(iso(-20)), endAt: new Date(iso(20)), amount: 123.45, currency: "CNY", taxInclusive: true, billingAnniversary: new Date(iso(-100)) } });
    const due = await second.getTenantView(ids[1]);
    assert.equal(due.overview.plan, "standard"); assert.equal(due.overview.revision, 2);
    assert.equal(due.overview.currentAmount.taxInclusive, true);
    await first.assertTenantWithinTerm(ids[1]);
    await first.extend(ids[1], { expectedRevision: 2, endAt: iso(25), reason: "隔离测试延长" });
    const stored = await b.tenantSubscription.findUniqueOrThrow({ where: { tenantId: ids[1] } });
    assert.equal(stored.plan, "STANDARD"); assert.equal(stored.revision, 3);
    report.push("实时生效投影、守卫与修订物化一致");

    const submit = { type: "renew_standard", dedupeKey: "same-request" };
    const [r1, r2] = await Promise.all([first.submitRequest(ids[2], submit), second.submitRequest(ids[2], { ...submit, dedupeKey: "different-key" })]);
    assert.equal(r1.id, r2.id);
    oneConflict(await Promise.allSettled([
      first.provision(ids[2], provision({ requestId: r1.id })),
      second.cancelRequest(ids[2], r1.id)
    ]));
    const raced = await a.subscriptionRequest.findUniqueOrThrow({ where: { id: r1.id } });
    const count = await a.tenantSubscription.count({ where: { tenantId: ids[2] } });
    assert.equal(count, raced.status === "PROCESSED" ? 1 : 0);
    if (raced.status === "PROCESSED") assert.ok(await a.subscriptionEvent.findUnique({ where: { id: raced.linkedEventId } }));
    report.push("同类型申请去重、撤销与实际办理竞态原子性");

    const wrong = await first.submitRequest(ids[3], { type: "renew_pro", dedupeKey: "wrong-type" });
    await assert.rejects(first.provision(ids[3], provision({ requestId: wrong.id })), (e) => e.getStatus?.() === 400);
    assert.equal(await a.tenantSubscription.count({ where: { tenantId: ids[3] } }), 0);
    assert.equal(await a.subscriptionEvent.count({ where: { tenantId: ids[3] } }), 0);
    const pending = await b.subscriptionRequest.findUniqueOrThrow({ where: { id: wrong.id } }); assert.equal(pending.status, "PENDING");
    report.push("关联申请失败时授权、金额、事件整体回滚");

    const consultation = await first.submitRequest(ids[4], { type: "upgrade_consult", dedupeKey: "consult" });
    const handle = { status: "processed", expectedRevision: 0, publicReason: "已联系", note: "内部备注只留平台" };
    oneConflict(await Promise.allSettled([first.handleRequest(consultation.id, handle), second.handleRequest(consultation.id, handle)]));
    const tenantView = await first.getTenantView(ids[4]); assert.doesNotMatch(JSON.stringify(tenantView), /内部备注只留平台/);
    report.push("并发办结防覆盖与平台内部备注隔离");

    await first.setStandardPrice("standard", { plan: "standard", annualFee: 100, currency: "CNY", taxInclusive: true, published: true, priceVersion: "v1" });
    oneConflict(await Promise.allSettled([
      first.setStandardPrice("standard", { plan: "standard", annualFee: 120, currency: "CNY", published: true, expectedPriceVersion: "v1", priceVersion: "v2" }),
      second.setStandardPrice("standard", { plan: "standard", annualFee: 130, currency: "CNY", published: true, expectedPriceVersion: "v1", priceVersion: "v3" })
    ]));
    await assert.rejects(first.provision(ids[5], provision({ source: "sale", amount: 100, currency: "CNY", taxInclusive: true, priceVersion: "v1" })), (e) => e.getStatus?.() === 409);
    report.push("标准价并发修订与过期价格办理拒绝");

    const all = await first.listOverviews({ pageSize: 2 });
    assert.equal(all.total, 8); assert.equal(all.items.length, 2);
    const p2 = await second.listOverviews({ page: 2, pageSize: 2 });
    assert.notEqual(all.items[0].tenantId, p2.items[0].tenantId);
    const empty = await first.listOverviews({ keyword: "no-such-tenant", pageSize: 1 }); assert.equal(empty.total, 0);
    const unconfigured = await first.listOverviews({ serviceStatus: "unconfigured", pageSize: 100 }); assert.ok(unconfigured.total >= 4);
    const pro = await first.listOverviews({ plan: "pro", pageSize: 100 }); assert.equal(pro.total, 0);
    const staff = await first.getStaffContext(ids[1]); assert.equal("currentAmount" in staff.overview, false); assert.equal("handledAt" in staff.overview, false);
    report.push("真SQL分页与生效套餐筛选、未配置租户、员工脱敏");

    const reconnect = connect(); const reloaded = await new SubscriptionService(reconnect).getTenantView(ids[1]);
    assert.equal(reloaded.overview.revision, 3); assert.equal(reloaded.overview.plan, "standard");
    report.push("新连接持久化重读");
    console.log(JSON.stringify({ database, passed: report.length, checks: report, developmentDataWritten: false }, null, 2));
  } catch (error) {
    throw new Error(redact(error.stack || error.message, [admin.password, decodeURIComponent(url.password)]));
  } finally {
    await Promise.all(clients.map((client) => client.$disconnect()));
    if (created) await owner.$executeRawUnsafe(`DROP DATABASE \`${database}\``);
    await owner.$disconnect();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
