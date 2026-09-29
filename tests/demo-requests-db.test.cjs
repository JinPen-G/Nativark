const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});
const { PrismaClient } = require("@prisma/client");
const { ValidationPipe } = require("@nestjs/common");
const runtime = require("../scripts/ops/runtime.cjs");
const { redact } = require("../scripts/ops/dedicated-env.cjs");
const { DemoRequestService } = require("../apps/api/src/modules/demo-requests/demo-request.service");
const { CreateDemoRequestDto } = require("../apps/api/src/modules/demo-requests/demo-request.dto");
const { ClientApiRateLimitService } = require("../apps/api/src/modules/client/client-api-rate-limit.service");

async function main() {
  const url = new URL(runtime.loadDatabaseUrl());
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "只允许本机 MySQL 专项验证");
  assert.equal(url.port || "3306", "3306");
  const admin = runtime.requireAdminTarget({});
  url.username = admin.user;
  url.password = admin.password;
  url.pathname = "/mysql";
  url.search = "?connect_timeout=5";
  const owner = new PrismaClient({ datasources: { db: { url: url.href } } });
  const database = `rental_os_dedicated_demo_${Date.now()}_${process.pid}`;
  assert.match(database, /^rental_os_dedicated_demo_\d+_\d+$/);
  let created = false;
  let client;
  let second;
  try {
    await owner.$executeRawUnsafe(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    url.pathname = `/${database}`;
    client = new PrismaClient({ datasources: { db: { url: url.href } } });
    second = new PrismaClient({ datasources: { db: { url: url.href } } });
    for (const migration of ["20260914001100_client_api_rate_limiting", "20260929120000_platform_demo_requests"]) {
      const sql = fs.readFileSync(path.join(__dirname, "../apps/api/prisma/migrations", migration, "migration.sql"), "utf8");
      for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
        await client.$executeRawUnsafe(statement);
      }
    }
    const service = new DemoRequestService(client);
    const otherService = new DemoRequestService(second);
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const dto = await pipe.transform({
      requestKey: randomUUID(), name: "数据库专项客户", contactType: "email", contactValue: "demo@example.test",
      company: "测试门店", message: "第一行\n第二行", language: "zh"
    }, { type: "body", metatype: CreateDemoRequestDto });
    const receipts = await Promise.all([service.create(dto), otherService.create(dto)]);
    receipts.forEach((receipt) => assert.deepEqual(receipt, { received: true }));
    assert.equal(await client.demoRequest.count(), 1, "两个连接并发提交只写一条");
    await assert.rejects(otherService.create({ ...dto, company: "另一家门店" }), (error) => error.getStatus?.() === 409);
    await otherService.create({ ...dto, requestKey: randomUUID(), name: "第二位客户" });
    const firstPage = await service.list({ page: 1, pageSize: 1 });
    const secondPage = await otherService.list({ page: 2, pageSize: 1 });
    assert.equal(firstPage.total, 2);
    assert.equal(secondPage.total, 2);
    assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
    assert.equal(firstPage.items[0].message, "第一行\n第二行");
    assert.equal("payloadHash" in firstPage.items[0], false);
    assert.equal("requestKey" in firstPage.items[0], false);
    const limiters = [new ClientApiRateLimitService(client), new ClientApiRateLimitService(second)];
    const request = { method: "POST", path: "/public/demo-requests", ip: "203.0.113.20" };
    for (let i = 0; i < 5; i++) await limiters[i % 2].assertAllowed(request);
    await assert.rejects(limiters[1].assertAllowed(request), (error) => error.getStatus?.() === 429);
    await limiters[0].assertAllowed({ ...request, ip: "203.0.113.21" });
    console.log("PASS real MySQL: migration, cross-connection idempotency, conflict, pagination, receipt privacy and shared rate limit");
  } catch (error) {
    throw new Error(redact(error.message, [admin.password, decodeURIComponent(url.password)]));
  } finally {
    await Promise.all([client?.$disconnect(), second?.$disconnect()]);
    if (created) await owner.$executeRawUnsafe(`DROP DATABASE \`${database}\``);
    await owner.$disconnect();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
