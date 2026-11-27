const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
require("reflect-metadata");
const { ValidationPipe } = require("@nestjs/common");
const { prismaRuntime: Prisma } = require("@rental-os/platform-server/prisma-runtime");
const { CreateDemoRequestDto, DemoRequestListQueryDto, DemoRequestService,
  PublicDemoRequestController, PlatformDemoRequestController } = require("@rental-os/platform-server/demo-requests");
const { PlatformAuthGuard, PlatformAuthService, platformHttpPolicy } = require("@rental-os/platform-server");
const { DemoRequestRateLimitService, WEBSITE_DEMO_REQUEST_RATE_LIMIT_RULE } = require("@rental-os/platform-server/public-rate-limit");
const { fixture: managementFixture } = require("./fixtures/platform-management.cjs");

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const validate = (value, metatype = CreateDemoRequestDto) => pipe.transform(value, { type: "body", metatype });
const input = (patch = {}) => ({ requestKey: randomUUID(), name: "测试客户", contactType: "phone", contactValue: "+86 13800138000", language: "zh", ...patch });
const status = (code) => (error) => error.getStatus?.() === code;

function store() {
  const authority = managementFixture();
  const records = new Map();
  let findQuery;
  const matching = (where) => [...records.values()].filter((row) => !where?.OR || where.OR.some((condition) =>
    Object.entries(condition).every(([field, rule]) => String(row[field] ?? "").includes(rule.contains))));
  const prisma = {
    ...authority.database,
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
    $transaction: (queries, options) => Array.isArray(queries)
      ? Promise.all(queries) : authority.database.$transaction(queries, options)
  };
  return { records, prisma, authority, service: new DemoRequestService(prisma), query: () => findQuery,
    asSaas: work => authority.as("saas", work) };
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
const guard = (account) => new PlatformAuthGuard({ resolveAccessContext: async () => account
  ? { tenantUser: account, accessSession: { sessionId: "demo-session", expiresAt: Math.floor(Date.now() / 1000) + 60 } }
  : undefined });

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
  assert.deepEqual({ ...await validate({}, DemoRequestListQueryDto) }, { keyword: undefined, page: 1, pageSize: 20 });
  assert.deepEqual({ ...await validate({ page: "2", pageSize: "10" }, DemoRequestListQueryDto) }, { keyword: undefined, page: 2, pageSize: 10 });
  for (const query of [{ page: 0 }, { page: 1.5 }, { page: 100001 }, { pageSize: 101 }, { pageSize: -1 }, { page: "NaN" }]) {
    await assert.rejects(validate(query, DemoRequestListQueryDto), status(400));
  }
});

test("list uses database pagination and omits request keys and hashes", async () => {
  const s = store();
  return s.asSaas(async () => {
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
});

test("keyword searches name, company and contact before pagination with a matching total", async () => {
  const s = store();
  return s.asSaas(async () => {
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
});

test("only POST submits anonymously, including case and trailing slash variants", async () => {
  const calls = [];
  const g = guard(null);
  const controller = new PublicDemoRequestController(store().service, { assertAllowed: async (value) => calls.push(value) });
  for (const url of ["/api/public/demo-requests", "/api/PUBLIC/DEMO-REQUESTS/?x=1"]) {
    assert.equal(await g.canActivate(context(url, "POST")), true);
    await controller.create(await validate(input()), context(url, "POST").switchToHttp().getRequest());
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[1].path, "/public/demo-requests");
  for (const method of ["GET", "PUT", "DELETE"]) {
    assert.equal(platformHttpPolicy(method, "/public/demo-requests"), undefined);
    await assert.rejects(g.canActivate(context("/api/public/demo-requests", method)), status(401));
  }
  await assert.rejects(new PublicDemoRequestController(store().service).create(await validate(input()), {}), status(401));
});

test("anonymous submissions cannot bypass the persistent rate limiter", async () => {
  assert.deepEqual(WEBSITE_DEMO_REQUEST_RATE_LIMIT_RULE, { code: "website_demo_request", windowSeconds: 600, limit: 5 });
  const limiter = new DemoRequestRateLimitService(rateStore());
  const s = store();
  const controller = new PublicDemoRequestController(s.service, limiter);
  const submit = async (extra = {}) => {
    const selected = context("/api/public/demo-requests", "POST", extra);
    assert.equal(await guard(null).canActivate(selected), true);
    return controller.create(await validate(input()), selected.switchToHttp().getRequest());
  };
  for (let i = 0; i < 5; i++) assert.deepEqual(await submit(), { received: true });
  await assert.rejects(submit(), status(429));
  assert.equal(s.records.size, 5, "a rejected attempt must not enter idempotent creation");
  assert.deepEqual(await submit({ ip: "203.0.113.6" }), { received: true });
  const broken = new PublicDemoRequestController(s.service, { assertAllowed: async () => { throw new Error("database unavailable"); } });
  await assert.rejects(broken.create(await validate(input()), {}), /database unavailable/);
  assert.equal(s.records.size, 6, "a limiter outage must not acknowledge or persist a submission");
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
  // 当前公共入口按已签名 audience 拒员工身份，不依赖请求对象上的旧业务标志。
  const auth = new PlatformAuthService({}, { get: () => "demo-audience-fixture" }, undefined, undefined, undefined);
  const now = Math.floor(Date.now() / 1000);
  const staff = auth.signAccessToken({ sub: "operator", tid: "tenant", sid: "staff-session", aud: "staff", iat: now, exp: now + 60 });
  await assert.rejects(new PlatformAuthGuard(auth).canActivate(context("/api/platform/demo-requests", "GET",
    { headers: { authorization: `Bearer ${staff}` } })), status(401));
});

test("controller independently enforces SaaS-only access", async () => {
  let reads = 0;
  const controller = new PlatformDemoRequestController({ list: async () => { reads++; return { items: [], total: 0 }; } });
  for (const account of [undefined, user({ isPlatformAdmin: true }), user({ permissions: ["*"] })]) {
    assert.throws(() => controller.list({ user: account }, { page: 1, pageSize: 20 }), status(403));
  }
  assert.equal(reads, 0);
  await controller.list({ user: user({ isSaasAdmin: true }) }, { keyword: undefined, page: 1, pageSize: 20 });
  assert.equal(reads, 1);
});

test("list rechecks the current SaaS identity before returning personal information", async () => {
  const s = store();
  await s.service.create(await validate(input()));
  for (const actor of ["actor", "admin"]) {
    await assert.rejects(s.authority.as(actor, () => s.service.list({ page: 1, pageSize: 20 })), status(403));
  }
  const findMany = s.prisma.demoRequest.findMany;
  s.prisma.demoRequest.findMany = async query => {
    const rows = await findMany(query);
    s.authority.operators.saas.isSaasAdmin = false;
    return rows;
  };
  await assert.rejects(s.asSaas(() => s.service.list({ page: 1, pageSize: 20 })), status(403));
});
