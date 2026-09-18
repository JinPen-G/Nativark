// Run: node tests/customer-registration-unified.test.cjs
// DB-free. Exercises the single registration implementation (CustomerRegistrationService) through
// both callers' parameterisations: ops-side (MembershipService.registerPersonal) and client
// self-service (selfService: true). An in-memory Prisma fake stands in for the four customer models;
// this is NOT evidence of row locks, serializable retries, or unique-key enforcement.
const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { MembershipService } = require("../apps/api/src/modules/platform/membership.service");
const { SharedCustomerRepository } = require("../apps/api/src/modules/platform/shared-customer.repository");
const { CustomerRegistrationService } = require("../apps/api/src/modules/platform/customer-registration.service");
const { verifyPassword } = require("../apps/api/src/common/password");

function matches(row, where) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "tenantId_customerId") return row.tenantId === expected.tenantId && row.customerId === expected.customerId;
    if (expected && typeof expected === "object" && Array.isArray(expected.in)) return expected.in.includes(row[key]);
    return row[key] === expected;
  });
}

function createFakePrisma({ registrationMode = "manual" } = {}) {
  let seq = 0;
  const id = (prefix) => `${prefix}-${++seq}`;
  const now = () => new Date();
  const tables = { profiles: [], memberships: [], accounts: [], reviews: [] };
  const calls = [];
  const table = (rows, model, defaults) => ({
    async findFirst({ where, orderBy }) {
      calls.push(`${model}.findFirst`);
      let hits = rows.filter((row) => matches(row, where));
      if (orderBy) hits = [...hits].reverse();
      return hits[0] ?? null;
    },
    async findUnique({ where }) {
      calls.push(`${model}.findUnique`);
      return rows.find((row) => matches(row, where)) ?? null;
    },
    async create({ data }) {
      calls.push(`${model}.create`);
      const row = { id: id(model), createdAt: now(), updatedAt: now(), ...defaults(), ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }) {
      calls.push(`${model}.update`);
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) {
        const error = new Error("not found");
        error.code = "P2025";
        throw error;
      }
      Object.assign(row, data, { updatedAt: now() });
      return row;
    },
    async updateMany({ where, data }) {
      calls.push(`${model}.updateMany`);
      const hits = rows.filter((row) => matches(row, where));
      hits.forEach((row) => Object.assign(row, data));
      return { count: hits.length };
    },
    async upsert({ where, create, update }) {
      calls.push(`${model}.upsert`);
      const row = rows.find((candidate) => matches(candidate, where));
      if (row) {
        Object.assign(row, update);
        return row;
      }
      const created = { id: id(model), createdAt: now(), updatedAt: now(), ...defaults(), ...create };
      rows.push(created);
      return created;
    }
  });
  const prisma = {
    calls,
    tables,
    customerProfile: table(tables.profiles, "customerProfile", () => ({ status: "active", mergedIntoCustomerId: null, email: null, identityNoMasked: null })),
    customerMembership: table(tables.memberships, "customerMembership", () => ({ levelName: "普通会员", status: "active" })),
    customerAccount: table(tables.accounts, "customerAccount", () => ({ status: "active", passwordHash: null, mustChangePassword: false })),
    customerMembershipReview: table(tables.reviews, "customerMembershipReview", () => ({ status: "pending", reason: null, reviewedBy: null, reviewedAt: null, sourceWorkspaceId: null, qualificationType: null, requestKey: null })),
    customerMembershipRegistrationSettings: {
      async findUnique() { return registrationMode ? { registrationMode, updatedAt: now() } : null; }
    },
    async $transaction(work) { return work(prisma); }
  };
  return prisma;
}

function build(options) {
  const prisma = createFakePrisma(options);
  const locks = [];
  const operations = {
    async lockCustomerBusinessGate(tenantId, customerId, tx) {
      assert.equal(tx, prisma, "锁与写入必须走同一事务");
      locks.push(customerId);
      return prisma.tables.profiles.some((row) => row.tenantId === tenantId && row.id === customerId);
    }
  };
  const customers = new SharedCustomerRepository(prisma);
  const registration = new CustomerRegistrationService(prisma, customers, operations);
  const memberships = new MembershipService(prisma, operations, customers, registration);
  return { prisma, locks, registration, memberships };
}

void (async () => {
  // ---- ops-side: manual policy, idempotent retry, temporary password ----
  {
    const { prisma, locks, memberships } = build();
    const input = { name: " 张三 ", phone: "13800000000", channel: "admin", idempotencyKey: "reg-1", identityNo: "110101199001011234", temporaryPassword: "Temp1234" };
    const first = await memberships.registerPersonal("tenant-a", input, "op-1", false, true);
    assert.equal(first.membershipStatus, "pending_activation");
    assert.ok(first.review, "人工策略下必须挂注册审核");
    assert.equal(first.review.channel, "admin");
    const profile = prisma.tables.profiles[0];
    assert.equal(profile.name, "张三");
    assert.equal(profile.phoneMasked, "138****0000");
    assert.equal(profile.identityNoMasked, "110****1234", "后台证件掩码保持 3+4");
    assert.equal(profile.identityVerified, false);
    assert.deepEqual(profile.qualifications, {});
    assert.equal(prisma.tables.memberships[0].levelName, "普通会员");
    const account = prisma.tables.accounts[0];
    assert.equal(account.mustChangePassword, true);
    assert.equal(account.lastReason, "后台创建临时密码");
    assert.equal(account.lastOperator, "op-1");
    assert.ok(verifyPassword(account.passwordHash, "Temp1234"), "共享 hashPassword 产出的哈希必须能被 verifyPassword 校验");
    assert.deepEqual(locks, [profile.id], "创建后必须锁主档再继续");

    const again = await memberships.registerPersonal("tenant-a", { ...input, temporaryPassword: "Temp5678" }, "op-2", false, true);
    assert.equal(again.customerId, first.customerId);
    assert.equal(again.review.id, first.review.id, "同幂等键复用同一审核");
    assert.equal(prisma.tables.reviews.length, 1);
    assert.equal(prisma.tables.memberships.length, 1);
    assert.equal(account.lastReason, "后台重置临时密码");
    assert.equal(account.lastOperator, "op-2");
    assert.ok(verifyPassword(account.passwordHash, "Temp5678"));
    assert.equal(account.loginPhone, "13800000000");

    prisma.tables.memberships[0].status = "suspended";
    const suspended = await memberships.registerPersonal("tenant-a", { ...input, idempotencyKey: undefined, temporaryPassword: undefined }, "op-3");
    assert.equal(suspended.membershipStatus, "suspended", "后台重复注册不改写既有会员状态");
    assert.equal(suspended.review, undefined, "非待激活不再挂审核");

    await assert.rejects(
      () => memberships.registerPersonal("tenant-a", { ...input, idempotencyKey: "reg-1", phone: "13900000000" }, "op-1", false, true),
      /注册幂等键已用于其他请求/u
    );
    console.log("  PASS 后台注册：人工审核、幂等复用、临时密码与共享口令哈希");
  }

  // ---- ops-side: directApprove and policy guards ----
  {
    const { memberships } = build();
    await assert.rejects(() => memberships.registerPersonal("tenant-a", { name: "a", phone: "1", channel: "app", directApprove: true }), /APP 注册不能请求后台直接通过/u);
    await assert.rejects(() => memberships.registerPersonal("tenant-a", { name: "a", phone: "1", channel: "admin", directApprove: true }, "op", false), /无权直接通过注册审核/u);
    await assert.rejects(() => memberships.registerPersonal("tenant-a", { name: "a", phone: "1", channel: "admin", temporaryPassword: "x" }, "op", true, false), /无权设置会员临时密码/u);
    const approved = await memberships.registerPersonal("tenant-a", { name: "a", phone: "13800000001", channel: "admin", directApprove: true }, "op", true);
    assert.equal(approved.membershipStatus, "active");
    assert.equal(approved.review, undefined);
    console.log("  PASS 后台注册：直接通过与权限守卫");
  }

  // ---- client self-service: automatic policy, new customer ----
  {
    const { prisma, registration } = build({ registrationMode: "automatic" });
    const result = await prisma.$transaction((tx) => registration.registerPersonal(tx, {
      tenantId: "tenant-a", phone: "13800000002", name: "客户", email: "c@example.com", identityNoMasked: "11****34",
      automatic: true, channel: "app", requestKey: "client:ch-1", sourceWorkspaceId: "ws-1",
      reviewPayload: { source: "client_api" }, selfService: true,
      account: { passwordHash: "scrypt$salt$hash", mustChangePassword: false }
    }));
    assert.equal(result.membership.status, "active");
    assert.equal(result.review, undefined);
    assert.equal(prisma.tables.profiles[0].identityNoMasked, "11****34", "客户端证件掩码由调用方决定，保持 2+2");
    const account = prisma.tables.accounts[0];
    assert.equal(account.loginPhoneMasked, "138****0002");
    assert.equal(account.mustChangePassword, false);
    assert.equal("lastReason" in account, false, "自助注册不写后台原因");
    console.log("  PASS 客户端注册：自动策略直接激活");
  }

  // ---- client self-service: existing customer without password, manual policy ----
  {
    const { prisma, registration } = build();
    prisma.tables.profiles.push({ id: "c-1", tenantId: "tenant-a", customerType: "personal", name: "旧名", phone: "13800000003", phoneMasked: "138****0003", email: "old@example.com", identityNoMasked: "99****99", status: "active", mergedIntoCustomerId: null });
    prisma.tables.accounts.push({ id: "a-1", tenantId: "tenant-a", customerId: "c-1", loginPhone: "13800000003", loginPhoneMasked: "138****0003", status: "active", passwordHash: null, mustChangePassword: false });
    const run = (overrides = {}) => prisma.$transaction((tx) => registration.registerPersonal(tx, {
      tenantId: "tenant-a", phone: "13800000003", name: "新名", email: undefined, identityNoMasked: undefined,
      automatic: false, channel: "app", requestKey: "client:ch-2", sourceWorkspaceId: "ws-1",
      reviewPayload: { source: "client_api" }, selfService: true,
      account: { passwordHash: "scrypt$salt$hash", mustChangePassword: false }, ...overrides
    }));
    const result = await run();
    assert.equal(result.membership.status, "pending_activation");
    assert.equal(result.review.sourceWorkspaceId, "ws-1");
    assert.equal(result.review.requestKey, "client:ch-2");
    assert.equal(prisma.tables.profiles[0].name, "新名", "自助注册刷新既有主档姓名");
    assert.equal(prisma.tables.profiles[0].email, "old@example.com", "未提供邮箱时保留旧值");
    assert.equal(prisma.tables.profiles[0].identityNoMasked, "99****99", "未提供证件时保留旧掩码");
    assert.equal(prisma.tables.accounts[0].passwordHash, "scrypt$salt$hash");
    assert.equal(prisma.tables.accounts[0].status, "active");

    await assert.rejects(() => run({ requestKey: "client:ch-3" }), /该手机号已注册，请直接登录/u);
    prisma.tables.accounts[0].passwordHash = null;
    prisma.tables.accounts[0].status = "suspended";
    await assert.rejects(() => run({ requestKey: "client:ch-3" }), /该客户账号已停用/u);
    prisma.tables.accounts[0].status = "active";
    prisma.tables.memberships[0].status = "exited";
    await assert.rejects(() => run({ requestKey: "client:ch-3" }), /已受限、退出或关闭/u);
    prisma.tables.memberships[0].status = "pending_activation";
    prisma.tables.profiles[0].status = "closed";
    await assert.rejects(() => run({ requestKey: "client:ch-3" }), /该客户资料已停用/u);
    prisma.tables.profiles[0].status = "active";
    prisma.tables.profiles[0].mergedIntoCustomerId = "c-0";
    await assert.rejects(() => run({ requestKey: "client:ch-3" }), /客户主档已合并/u);
    prisma.tables.profiles[0].mergedIntoCustomerId = null;
    prisma.tables.profiles[0].customerType = "corporate";
    await assert.rejects(() => run({ requestKey: "client:ch-3" }), /已属于企业客户/u);
    console.log("  PASS 客户端注册：既有客户复用、刷新资料与各类拒绝");
  }

  // ---- review reuse: only open reviews are reused; rejected/cancelled are terminal on BOTH entry points ----
  {
    const { prisma, registration, memberships } = build();
    prisma.tables.profiles.push({ id: "c-9", tenantId: "tenant-a", customerType: "personal", name: "n", phone: "13800000009", phoneMasked: "138****0009", email: null, identityNoMasked: null, status: "active", mergedIntoCustomerId: null });
    prisma.tables.memberships.push({ id: "m-9", tenantId: "tenant-a", customerId: "c-9", levelName: "普通会员", status: "pending_activation" });
    prisma.tables.reviews.push({ id: "r-rejected", tenantId: "tenant-a", customerId: "c-9", reviewType: "registration", status: "rejected", channel: "app", requestKey: null, createdAt: new Date(1) });
    const client = await prisma.$transaction((tx) => registration.registerPersonal(tx, {
      tenantId: "tenant-a", phone: "13800000009", name: "n", automatic: false, channel: "app", requestKey: "client:ch-9",
      reviewPayload: {}, selfService: true, account: { passwordHash: "h", mustChangePassword: false }
    }));
    assert.notEqual(client.review.id, "r-rejected", "客户端只复用未结审核，被拒后再注册新建一条");
    assert.equal(client.review.status, "pending");
    assert.equal(prisma.tables.reviews.length, 2);
    const ops = await memberships.registerPersonal("tenant-a", { name: "n", phone: "13800000009", channel: "admin" }, "op");
    assert.equal(ops.review.id, client.review.id, "后台复用同一条未结审核，不重复挂单");
    assert.equal(prisma.tables.reviews.length, 2);

    // 审核员拒绝后，客户补正资料、后台再次代注册：必须产生新的待审记录，不能回显已拒绝的那条。
    prisma.tables.reviews.find((row) => row.id === client.review.id).status = "rejected";
    const retried = await memberships.registerPersonal("tenant-a", { name: "n", phone: "13800000009", channel: "admin" }, "op");
    assert.equal(retried.membershipStatus, "pending_activation");
    assert.equal(retried.review.status, "pending", "后台被拒后再注册必须新建待审，否则客户永远卡在待激活");
    assert.notEqual(retried.review.id, client.review.id);
    assert.equal(prisma.tables.reviews.length, 3);
    console.log("  PASS 审核复用：两条入口只认未结审核，已拒绝不回显");
  }

  // ---- automatic / directApprove activates an existing pending membership; other statuses untouched ----
  {
    const { prisma, memberships } = build();
    prisma.tables.profiles.push({ id: "c-10", tenantId: "tenant-a", customerType: "personal", name: "n", phone: "13800000010", phoneMasked: "138****0010", email: null, identityNoMasked: null, status: "active", mergedIntoCustomerId: null });
    prisma.tables.memberships.push({ id: "m-10", tenantId: "tenant-a", customerId: "c-10", levelName: "普通会员", status: "pending_activation" });
    prisma.tables.reviews.push({ id: "r-open", tenantId: "tenant-a", customerId: "c-10", reviewType: "registration", status: "pending", channel: "admin", requestKey: null, createdAt: new Date(1) });
    const approved = await memberships.registerPersonal("tenant-a", { name: "n", phone: "13800000010", channel: "admin", directApprove: true }, "op", true);
    assert.equal(approved.membershipStatus, "active", "后台直接通过必须激活既有待激活会员（沿用旧 upsert.update 语义）");
    assert.equal(prisma.tables.memberships[0].status, "active");
    assert.equal(approved.review, undefined, "已激活不再挂审核");
    assert.equal(prisma.tables.reviews.length, 1, "直接通过不新建审核");

    prisma.tables.memberships[0].status = "suspended";
    const stillSuspended = await memberships.registerPersonal("tenant-a", { name: "n", phone: "13800000010", channel: "admin", directApprove: true }, "op", true);
    assert.equal(stillSuspended.membershipStatus, "suspended", "直接通过不得越过暂停/受限/终态，这些状态有各自入口");
    console.log("  PASS 自动通过：激活待激活会员，不改写其他状态");
  }

  // ---- self-service: profile status is judged on the locked row, not the pre-lock read ----
  {
    const { prisma, registration } = build();
    prisma.tables.profiles.push({ id: "c-11", tenantId: "tenant-a", customerType: "personal", name: "n", phone: "13800000011", phoneMasked: "138****0011", email: null, identityNoMasked: null, status: "active", mergedIntoCustomerId: null });
    const original = prisma.customerProfile.findFirst.bind(prisma.customerProfile);
    let reads = 0;
    // 第一次读（锁前）返回 active；拿到锁后的重读看到并发停用。
    prisma.customerProfile.findFirst = async (args) => {
      const row = await original(args);
      reads += 1;
      if (reads === 1 && row) return { ...row, status: "active" };
      if (reads === 2 && row) return { ...row, status: "suspended" };
      return row;
    };
    await assert.rejects(
      () => prisma.$transaction((tx) => registration.registerPersonal(tx, {
        tenantId: "tenant-a", phone: "13800000011", name: "n", automatic: true, channel: "app", requestKey: "client:ch-11",
        reviewPayload: {}, selfService: true, account: { passwordHash: "h", mustChangePassword: false }
      })),
      /该客户资料已停用/u,
      "锁后重读到停用必须拒绝，不能凭锁前的 active 完成注册"
    );
    assert.equal(prisma.tables.memberships.length, 0, "拒绝时不得已创建会员");
    assert.equal(prisma.tables.accounts.length, 0, "拒绝时不得已写入口令");
    console.log("  PASS 自助注册：资料状态以锁后行为准");
  }

  console.log("统一注册流程专项全部通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
