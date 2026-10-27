const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
require("reflect-metadata");
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});
const { ValidationPipe } = require("@nestjs/common");
const { Prisma } = require("@prisma/client");
const { CreateDemoRequestDto, DemoRequestListQueryDto } = require("../apps/api/src/modules/demo-requests/demo-request.dto");
const { DemoRequestService } = require("../apps/api/src/modules/demo-requests/demo-request.service");
const { PlatformDemoRequestController } = require("../apps/api/src/modules/demo-requests/platform-demo-request.controller");
const { ApiAuthGuard, requiredPermissions, UNMATCHED_ROUTE_PERMISSION } = require("../apps/api/src/common/api-auth.guard");
const { ClientApiRateLimitService, clientRateLimitRule } = require("../apps/api/src/modules/client/client-api-rate-limit.service");
const { apiCorsOrigins } = require("../apps/api/src/common/cors-origins");

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const validate = (value, metatype = CreateDemoRequestDto) => pipe.transform(value, { type: "body", metatype });
const input = (patch = {}) => ({ requestKey: randomUUID(), name: "测试客户", contactType: "phone", contactValue: "+86 13800138000", language: "zh", ...patch });
const status = (code) => (error) => error.getStatus?.() === code;

function store() {
  const records = new Map();
  let findQuery;
  const matching = (where) => [...records.values()].filter((row) => !where?.OR || where.OR.some((condition) =>
    Object.entries(condition).every(([field, rule]) => String(row[field] ?? "").includes(rule.contains))));
  const prisma = {
    demoRequest: {
      async create({ data }) {
        if (records.has(data.requestKey)) throw new Prisma.PrismaClientKnownRequestError("Duplicate", { code: "P2002", clientVersion: "test" });
        records.set(data.requestKey, { ...data, createdAt: new Date() });
      },
      async findUnique({ where, select }) {
        const row = records.get(where.requestKey);
        return row ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : null;
      },
      async count({ where } = {}) { return matching(where).length; },
      async findMany(query) {
        findQuery = query;
        return matching(query.where)
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
          .slice(query.skip, query.skip + query.take)
          .map((row) => Object.fromEntries(Object.keys(query.select).map((key) => [key, row[key]])));
      }
    },
    $transaction: (queries) => Promise.all(queries)
  };
  return { records, prisma, service: new DemoRequestService(prisma), query: () => findQuery };
}

function rateStore() {
  const buckets = new Map();
  return {
    $transaction: async (callback) => {
      let key;
      return callback({
        $executeRaw: async ({ values }) => {
          key = `${values[1]}:${values[2].toISOString()}`;
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        },
        $queryRaw: async () => [{ count: buckets.get(key) }]
      });
    }
  };
}

const context = (url, method = "GET", extra = {}) => ({ switchToHttp: () => ({ getRequest: () => ({ url, method, headers: {}, ip: "203.0.113.5", ...extra }) }) });
const user = (patch = {}) => ({ id: "operator", tenantId: "tenant", permissions: [], dataScope: "all", isSaasAdmin: false, isPlatformAdmin: false, mustChangePassword: false, ...patch });
const guard = (account, limiter) => new ApiAuthGuard({ resolveAccessContext: async () => ({ user: account, workspaceValid: true }) }, undefined, undefined, limiter);

test("DTO trims inputs, preserves multiline requirements, strips injected account fields", async () => {
  const dto = await validate(input({ name: " 客户 ", company: " 门店 ", message: " 一行\n二行 ", tenantId: "attacker", isSaasAdmin: true }));
  assert.equal(dto.name, "客户");
  assert.equal(dto.company, "门店");
  assert.equal(dto.message, "一行\n二行");
  assert.equal("tenantId" in dto, false);
  assert.equal("isSaasAdmin" in dto, false);
});

test("DTO refuses missing, malformed and oversized fields", async () => {
  for (const patch of [
    { requestKey: "wrong" }, { name: "   " }, { name: "x".repeat(81) }, { name: 1 },
    { contactType: "fax" }, { contactValue: "x".repeat(161) }, { company: "x".repeat(121) },
    { message: "x".repeat(1001) }, { language: "fr" }, { contactValue: null }
  ]) await assert.rejects(validate(input(patch)), status(400));
});

test("accepts each contact method without returning PII or internal identifiers", async () => {
  const s = store();
  for (const [contactType, contactValue] of [["phone", "+1 (212) 555-0123"], ["email", "demo@example.test"], ["wechat", "demo_123"]]) {
    assert.deepEqual(await s.service.create(await validate(input({ contactType, contactValue }))), { received: true });
  }
  assert.equal(s.records.size, 3);
});

test("rejects invalid contact formats and control characters before writing", async () => {
  const s = store();
  for (const patch of [
    { contactValue: "123" }, { contactValue: "13800138000<script>" },
    { contactType: "email", contactValue: "bad@" }, { contactType: "wechat", contactValue: "含中文" },
    { name: "bad\u0000name" }, { company: "bad\ncompany" }
  ]) await assert.rejects(s.service.create(await validate(input(patch))), status(400));
  assert.equal(s.records.size, 0);
});

test("concurrent identical submissions share one receipt and one record", async () => {
  const s = store();
  const dto = await validate(input());
  const receipts = await Promise.all(Array.from({ length: 4 }, () => s.service.create(dto)));
  assert.equal(s.records.size, 1);
  receipts.forEach((receipt) => assert.deepEqual(receipt, { received: true }));
  await assert.rejects(s.service.create({ ...dto, name: "另一位客户" }), status(409));
  assert.equal(s.records.size, 1);
});

test("a database outage is not acknowledged as a successful submission", async () => {
  const service = new DemoRequestService({ demoRequest: { create: async () => { throw new Error("database unavailable"); } } });
  await assert.rejects(service.create(await validate(input())), /database unavailable/);
});

test("pagination has safe defaults and rejects invalid page limits", async () => {
  assert.deepEqual({ ...await validate({}, DemoRequestListQueryDto) }, { page: 1, pageSize: 20 });
  assert.deepEqual({ ...await validate({ page: "2", pageSize: "10" }, DemoRequestListQueryDto) }, { page: 2, pageSize: 10 });
  for (const query of [{ page: 0 }, { page: 1.5 }, { page: 100001 }, { pageSize: 101 }, { pageSize: -1 }, { page: "NaN" }]) {
    await assert.rejects(validate(query, DemoRequestListQueryDto), status(400));
  }
});

test("list uses database pagination and omits request keys and hashes", async () => {
  const s = store();
  for (let i = 0; i < 3; i++) await s.service.create(await validate(input({ name: `客户${i}` })));
  const result = await s.service.list({ page: 2, pageSize: 2 });
  assert.equal(result.total, 3);
  assert.equal(result.items.length, 1);
  assert.equal(s.query().skip, 2);
  assert.equal(s.query().take, 2);
  assert.deepEqual(s.query().orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.equal("requestKey" in result.items[0], false);
  assert.equal("payloadHash" in result.items[0], false);
  assert.equal(typeof result.items[0].createdAt, "string");
});

test("keyword searches name, company and contact before pagination with a matching total", async () => {
  const s = store();
  for (const patch of [{ name: "目标客户" }, { company: "目标公司" },
    { contactType: "wechat", contactValue: "target_123" }, { name: "其他客户" }]) {
    await s.service.create(await validate(input(patch)));
  }
  const query = await validate({ keyword: " 目标 ", page: "2", pageSize: "1" }, DemoRequestListQueryDto);
  assert.equal(query.keyword, "目标");
  const result = await s.service.list(query);
  assert.equal(result.total, 2);
  assert.equal(result.items.length, 1);
  assert.equal(s.query().skip, 1);
  assert.deepEqual(s.query().where.OR, [
    { name: { contains: "目标" } }, { company: { contains: "目标" } }, { contactValue: { contains: "目标" } }
  ]);
  assert.equal((await s.service.list({ page: 1, pageSize: 20, keyword: "target_123" })).total, 1);
  assert.equal((await s.service.list({ page: 1, pageSize: 20, keyword: "不存在" })).total, 0);
  assert.equal((await s.service.list({ page: 1, pageSize: 20, keyword: "  " })).total, 4);
  await assert.rejects(validate({ keyword: "x".repeat(121) }, DemoRequestListQueryDto), status(400));
});

test("only POST submits anonymously, including case and trailing slash variants", async () => {
  const calls = [];
  const g = guard(null, { assertAllowed: async (value) => calls.push(value) });
  for (const url of ["/api/public/demo-requests", "/api/PUBLIC/DEMO-REQUESTS/?x=1"]) {
    assert.equal(await g.canActivate(context(url, "POST")), true);
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/public/demo-requests");
  for (const method of ["GET", "PUT", "DELETE"]) {
    assert.deepEqual(requiredPermissions(method, "/public/demo-requests"), [UNMATCHED_ROUTE_PERMISSION]);
    await assert.rejects(g.canActivate(context("/api/public/demo-requests", method)), status(401));
  }
  await assert.rejects(guard(null).canActivate(context("/api/public/demo-requests", "POST")), status(401));
});

test("anonymous submissions cannot bypass the persistent rate limiter", async () => {
  assert.deepEqual(clientRateLimitRule("/public/demo-requests", "POST"), { code: "website_demo_request", windowSeconds: 600, limit: 5 });
  const limiter = new ClientApiRateLimitService(rateStore());
  const g = guard(null, limiter);
  for (let i = 0; i < 5; i++) assert.equal(await g.canActivate(context("/api/public/demo-requests", "POST")), true);
  await assert.rejects(g.canActivate(context("/api/public/demo-requests", "POST")), status(429));
  assert.equal(await g.canActivate(context("/api/public/demo-requests", "POST", { ip: "203.0.113.6" })), true);
  const broken = guard(null, { assertAllowed: async () => { throw new Error("database unavailable"); } });
  await assert.rejects(broken.canActivate(context("/api/public/demo-requests", "POST")), /database unavailable/);
});

test("SaaS reads are allowed but tenant admin, wildcard and explicitly granted tenant roles cannot read", async () => {
  for (const url of ["/api/platform/demo-requests", "/api/PLATFORM/DEMO-REQUESTS/?page=1"]) {
    assert.equal(await guard(user({ isSaasAdmin: true })).canActivate(context(url)), true);
    await assert.rejects(guard(null).canActivate(context(url)), status(401));
    for (const account of [user(), user({ isPlatformAdmin: true }), user({ permissions: ["*"] }), user({ permissions: ["system:demo-request:view"] })]) {
      await assert.rejects(guard(account).canActivate(context(url)), status(403));
    }
  }
  await assert.rejects(guard(user({ isSaasAdmin: true, mustChangePassword: true })).canActivate(context("/api/platform/demo-requests")), status(403));
  await assert.rejects(guard(user({ isSaasAdmin: true })).canActivate(context("/api/platform/demo-requests", "POST")), status(403));
  await assert.rejects(guard(user({ isSaasAdmin: true })).canActivate(context("/api/platform/demo-requests", "GET", { staffApiRequest: true })), status(403));
});

test("controller independently enforces SaaS-only access", async () => {
  let reads = 0;
  const controller = new PlatformDemoRequestController({ list: async () => { reads++; return { items: [], total: 0 }; } });
  for (const account of [undefined, user({ isPlatformAdmin: true }), user({ permissions: ["*"] })]) {
    assert.throws(() => controller.list({ user: account }, { page: 1, pageSize: 20 }), status(403));
  }
  assert.equal(reads, 0);
  await controller.list({ user: user({ isSaasAdmin: true }) }, { page: 1, pageSize: 20 });
  assert.equal(reads, 1);
});

test("CORS allows only explicit secure origins plus local HTTP preview", () => {
  const allowed = apiCorsOrigins("https://site.example.test, https://site.example.test/");
  assert.equal(allowed.filter((x) => x === "https://site.example.test").length, 1);
  assert.ok(allowed[0].test("http://localhost:4180"));
  for (const origin of ["*", "http://site.example.test", "https://*.example.test", "https://site.example.test/path", "https://site.example.test/?token=1", "https://name:password@site.example.test"]) {
    assert.throws(() => apiCorsOrigins(origin));
  }
});

test("website links stay local or disabled and all demo entry points open the dialog", () => {
  const html = fs.readFileSync(path.join(__dirname, "../apps/website/2.0/index.html"), "utf8");
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(anchors.length > 20);
  for (const tag of anchors) {
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    if (href) assert.match(href, /^(?:#|\.\/)/, tag);
    else assert.match(tag, /data-link-pending/, tag);
  }
  assert.equal(anchors.filter((tag) => tag.includes("data-demo-open")).length, 6);
  const assets = ["styles.css", "js/i18n.js", "js/main.js", "js/config.js", "js/demo-request.js"];
  const versions = assets.map((asset) => {
    const reference = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]).find((url) => url.startsWith(`${asset}?v=`));
    assert.ok(reference, `${asset} must bypass pre-demo asset caches`);
    return reference.split("?v=")[1];
  });
  assert.equal(new Set(versions).size, 1);
  assert.match(html, /id="demo-name"[^>]*required/);
  assert.match(html, /id="demo-contact"[^>]*required/);
  const js = fs.readFileSync(path.join(__dirname, "../apps/website/2.0/js/demo-request.js"), "utf8");
  assert.doesNotMatch(js, /(?:localStorage|sessionStorage)\s*\.\s*[a-zA-Z_$]/);
  assert.match(js, /credentials: "omit"/);
  assert.match(js, /result\?\.data\?\.received !== true/);
  assert.ok(js.indexOf('new Event("rentalos:demo-open")') < js.indexOf("previousOverflow = document.body.style.overflow"));
});
