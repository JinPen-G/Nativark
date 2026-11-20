"use strict";
/** 原 ClientAuth/Guard 的离线当前会话租约；只用内存行与可等待行锁，不连接数据库或启动服务。 */
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
require("ts-node").register({ transpileOnly: true, compilerOptions: {
  target: "ES2022", module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { ClientAuthService } = require("../packages/rental-core/src/mysql-client-auth");
const { createRentalAuthorization } = require("../packages/rental-core/src/http-auth");
const { runWithRequestIdentity, enterRequestIdentity, getRequestIdentity } = require("@rental-os/platform-server/request-identity");
const { hashOpaqueToken } = require("@rental-os/platform-server/password");
const contracts = require("@rental-os/shared");

const secret = "client-current-session-offline-secret";
const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const originalNow = Date.now;
let now = originalNow();
const signed = changes => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = { typ: "client", sub: "customer", tid: "tenant", sid: "session", wid: "workspace",
    iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 60, ...changes };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.${createHmac("sha256", `${secret}:client`).update(`${header}.${body}`).digest("base64url")}`;
};

function fixture() {
  const state = {
    tenant: { id: "tenant", code: "merchant", status: "ACTIVE" },
    customer: { id: "customer", tenantId: "tenant", customerType: "personal", status: "active", name: "客户", phone: "synthetic-phone" },
    workspace: { id: "workspace", tenantId: "tenant", status: "ACTIVE", code: "main", name: "经营空间", categoryCode: "camping" },
    account: { id: "account", tenantId: "tenant", customerId: "customer", status: "active", passwordUpdatedAt: null, mustChangePassword: false },
    session: { id: "session", tenantId: "tenant", customerId: "customer", workspaceId: "workspace", revokedAt: null,
      expiresAt: new Date(now + 600_000), createdAt: new Date(now - 1000), wechatIdentityId: null,
      refreshTokenHash: hashOpaqueToken("original-refresh-token") },
    membership: { id: "membership", tenantId: "tenant", customerId: "customer", status: "active" }
  };
  const trace = [], holders = new Map(), queues = new Map();
  const f = { state, trace, writes: 0, committed: 0, sequence: 0, readHook: undefined, onWait: undefined };
  const acquire = async (key, owner) => {
    while (holders.has(key) && holders.get(key) !== owner) {
      const waiting = defer(), queue = queues.get(key) ?? [];
      queue.push(waiting); queues.set(key, queue); f.onWait?.(key, owner); await waiting.promise;
    }
    holders.set(key, owner);
  };
  const release = owner => {
    for (const [key, held] of holders) if (held === owner) {
      holders.delete(key); for (const waiting of queues.get(key) ?? []) waiting.resolve(); queues.delete(key);
    }
  };
  const matches = (row, where) => Boolean(row) && Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === "object" && "notIn" in expected) return !expected.notIn.includes(row[key]);
    return row[key] === expected;
  });
  const tables = (owner, active) => ({
    clientAuthSession: { async findFirst({ where }) {
      active(); trace.push(`${owner}:read-session`); await f.readHook?.("session", owner);
      return matches(state.session, where) ? structuredClone({ ...state.session, customer: state.customer,
        workspace: state.workspace, tenant: state.tenant }) : null;
    } },
    customerAccount: { async findFirst({ where }) {
      active(); trace.push(`${owner}:read-account`); await f.readHook?.("account", owner);
      return matches(state.account, where) ? structuredClone({ ...state.account, customer: { status: state.customer?.status } }) : null;
    } },
    customerMembership: { async findFirst({ where }) {
      active(); trace.push(`${owner}:read-membership`); await f.readHook?.("membership", owner);
      return matches(state.membership, where) ? structuredClone(state.membership) : null;
    } }
  });
  const db = { ...tables("root", () => {}), async $transaction(consume, options) {
    assert.equal(options?.isolationLevel, "ReadCommitted");
    const owner = `tx${++f.sequence}`;
    let open = true;
    const active = () => assert.ok(open, "租约不得在已结束事务中读取");
    const tx = { ...tables(owner, active), async $queryRaw(query) {
      active();
      const table = /FROM (Tenant|customer_profiles|customer_accounts|client_auth_sessions|customer_memberships) /u.exec(query.sql)?.[1];
      assert.ok(table, `意外 SQL：${query.sql}`);
      assert.match(query.sql, /FOR UPDATE$/u);
      assert.equal(query.values[0], "tenant");
      if (table !== "Tenant") assert.equal(query.values[1], "customer");
      if (table === "client_auth_sessions") assert.equal(query.values[2], "session");
      trace.push(`${owner}:lock-${table}`); await acquire(table, owner);
      const row = state[{ Tenant: "tenant", customer_profiles: "customer", customer_accounts: "account",
        client_auth_sessions: "session", customer_memberships: "membership" }[table]];
      return row ? [{ id: row.id }] : [];
    } };
    try { const value = await consume(tx); f.committed++; return value; }
    finally { open = false; release(owner); }
  } };
  db.clientAuthSession.updateMany = async ({ where, data }) => {
    const owner = `write${++f.sequence}`;
    await acquire("client_auth_sessions", owner);
    try {
      if (!matches(state.session, where)) return { count: 0 };
      f.writes++; Object.assign(state.session, data); return { count: 1 };
    } finally { release(owner); }
  };
  f.db = db;
  f.auth = new ClientAuthService(db, {}, {}, {});
  f.tx = consume => db.$transaction(consume, { isolationLevel: "ReadCommitted" });
  f.hold = async key => { const owner = {}; await acquire(key, owner); return () => release(owner); };
  f.identity = () => ({ tenantId: "tenant", userId: "customer", workspaceId: "workspace", audience: "client", isSaasAdmin: false });
  f.request = (consume, token = signed(), recovery) => runWithRequestIdentity({}, async () => {
    const context = await f.auth.authenticate(token, recovery);
    enterRequestIdentity(f.identity());
    return consume(context);
  });
  return f;
}

const rejected = error => [401, 403, 409].includes(error?.status);
let groups = 0, completed = false;
async function check(name, consume) { await consume(); groups++; console.log(`PASS ${name}`); }
process.once("beforeExit", () => assert.ok(completed, "租约测试不能留下未结束的等待"));

async function main() {
  const oldSecret = process.env.AUTH_TOKEN_SECRET;
  process.env.AUTH_TOKEN_SECRET = secret;
  Date.now = () => now;
  try {
    await check("原 Guard 同实例投影、同事务重验、精确锁序及零旁路写", async () => {
      const f = fixture(), authorization = createRentalAuthorization(contracts);
      const guard = new authorization.Guard({}, undefined, f.auth, { assertAllowed: async () => {} });
      await runWithRequestIdentity({}, async () => {
        const req = { method: "GET", url: "/client/v1/orders/original", headers: { authorization: `Bearer ${signed()}` } };
        assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) }), true);
        const beforeWrites = f.writes, original = structuredClone(req.client);
        const lease = await f.tx(async tx => {
          const current = await f.auth.lockCurrentSession(tx, req.client);
          assert.deepEqual(current.current, original);
          assert.ok(Object.isFrozen(current) && Object.isFrozen(current.current));
          assert.deepEqual(await current.revalidate(), original);
          assert.equal(f.writes, beforeWrites);
          f.trace.push("Order");
          return current;
        });
        const locks = f.trace.filter(row => row.includes(":lock-")).map(row => row.split(":lock-")[1]);
        assert.deepEqual(locks, ["Tenant", "customer_profiles", "customer_accounts", "client_auth_sessions", "customer_memberships"]);
        assert.ok(f.trace.indexOf("Order") > f.trace.findIndex(row => row.includes(":read-membership") && !row.startsWith("root:")));
        await assert.rejects(() => lease.revalidate());
      });
    });

    await check("复制投影、伪造签名、跨实例与跨请求均不能取得租约", async () => {
      const f = fixture();
      await assert.rejects(() => f.auth.authenticate(signed({ typ: "operator" })), rejected);
      await assert.rejects(() => f.auth.authenticate(signed().replace(/.$/u, "!")), rejected);
      await f.request(async context => {
        await assert.rejects(() => f.tx(tx => f.auth.lockCurrentSession(tx, { ...context })), rejected);
        const another = new ClientAuthService(f.db, {}, {}, {});
        await assert.rejects(() => f.tx(tx => another.lockCurrentSession(tx, context)), rejected);
        await assert.rejects(() => runWithRequestIdentity(f.identity(), () => f.tx(tx => f.auth.lockCurrentSession(tx, context))), rejected);
        await assert.rejects(() => f.auth.lockCurrentSession(f.db, context), rejected);
      });
      assert.equal(f.trace.some(row => row.includes(":lock-")), false);
    });

    await check("当前撤权、范围与口令变化在原事务内拒绝且不提交", async () => {
      const cases = [
        state => { state.tenant.status = "FROZEN"; }, state => { state.workspace.status = "DISABLED"; },
        state => { state.workspace.tenantId = "other"; }, state => { state.account.status = "suspended"; },
        state => { state.customer.status = "closed"; }, state => { state.membership.status = "exited"; },
        state => { state.membership.status = "closed"; }, state => { state.session.revokedAt = new Date(now); },
        state => { state.session.expiresAt = new Date(now); }, state => { state.session.workspaceId = "other"; },
        state => { state.session.tenantId = "other"; }, state => { state.session.customerId = "other"; },
        state => { state.account.passwordUpdatedAt = new Date(now); }, state => { state.account.mustChangePassword = true; },
        ...["tenant", "customer", "account", "session", "membership"].map(key => state => { state[key] = undefined; })
      ];
      for (const change of cases) {
        const f = fixture();
        await f.request(async context => {
          const writes = f.writes; change(f.state);
          await assert.rejects(() => f.tx(async tx => { await f.auth.lockCurrentSession(tx, context); assert.fail("不应执行业务"); }), rejected);
          assert.equal(f.writes, writes); assert.equal(f.committed, 0);
        });
      }
    });

    await check("Guard 投影变化不能静默升级或替换当前客户", async () => {
      const cases = [state => { state.membership.status = "suspended"; }, state => { state.customer.customerType = "corporate"; },
        state => { state.customer.name = "changed"; }, state => { state.customer.phone = "changed"; },
        state => { state.tenant.code = "changed"; }, state => { state.workspace.code = "changed"; },
        state => { state.workspace.name = "changed"; }, state => { state.workspace.categoryCode = "camera"; },
        state => { state.session.wechatIdentityId = "changed"; }];
      for (const change of cases) {
        const f = fixture(); await f.request(async context => {
          change(f.state); await assert.rejects(() => f.tx(tx => f.auth.lockCurrentSession(tx, context)), error => error?.status === 409);
        });
      }
    });

    await check("原会员只读资格保留，临时密码恢复例外不进入业务租约", async () => {
      for (const status of ["active", "suspended", "risk_restricted"]) {
        const f = fixture(); f.state.membership.status = status;
        await f.request(context => f.tx(async tx => assert.equal((await f.auth.lockCurrentSession(tx, context)).current.membershipStatus, status)));
      }
      const f = fixture(); f.state.account.mustChangePassword = true;
      await assert.rejects(() => f.auth.authenticate(signed()), error => error?.status === 403);
      await f.request(async context => {
        assert.equal(context.customerId, "customer");
        await assert.rejects(() => f.tx(tx => f.auth.lockCurrentSession(tx, context)), error => error?.status === 403);
      }, signed(), { method: "POST", path: "/client/v1/auth/change-password" });
    });

    await check("签名 access 到期与持久 session 到期分别在返回前复验", async () => {
      for (const expiry of ["access", "session"]) {
        const f = fixture(), startedAt = now;
        if (expiry === "session") f.state.session.expiresAt = new Date(now + 1000);
        await f.request(async context => {
          context.expiresAt = Number.MAX_SAFE_INTEGER;
          f.readHook = async (table, owner) => { if (table === "membership" && owner !== "root") now += expiry === "access" ? 61_000 : 1001; };
          await assert.rejects(() => f.tx(tx => f.auth.lockCurrentSession(tx, context)), error => error?.status === 401);
        });
        now = startedAt;
      }
    });

    await check("等待 Tenant 或 Session 行锁后使用撤权后的真实行", async () => {
      for (const key of ["Tenant", "client_auth_sessions"]) {
        const f = fixture(); await f.request(async context => {
          const unblock = await f.hold(key), waiting = defer();
          f.onWait = locked => { if (locked === key) waiting.resolve(); };
          const result = f.tx(tx => f.auth.lockCurrentSession(tx, context));
          const rejection = assert.rejects(() => result, rejected);
          try { await waiting.promise; if (key === "Tenant") f.state.account.status = "suspended"; else f.state.session.revokedAt = new Date(now); }
          finally { unblock(); }
          await rejection; assert.equal(f.committed, 0);
        });
      }
    });

    await check("实际 logout 等待当前 session 租约结束且原重复退出幂等", async () => {
      const f = fixture(); await f.request(async context => {
        const locked = defer(), release = defer(), logoutWaiting = defer(); let logoutDone = false;
        f.onWait = (key, owner) => { if (key === "client_auth_sessions" && owner.startsWith("write")) logoutWaiting.resolve(); };
        const transaction = f.tx(async tx => {
          const lease = await f.auth.lockCurrentSession(tx, context); locked.resolve(); await release.promise;
          assert.deepEqual(await lease.revalidate(), context);
        });
        await locked.promise;
        const logout = f.auth.logout("original-refresh-token").then(value => { logoutDone = true; return value; });
        try { await logoutWaiting.promise; assert.equal(logoutDone, false); }
        finally { release.resolve(); }
        await transaction; assert.deepEqual(await logout, { success: true });
        await assert.rejects(() => f.tx(tx => f.auth.lockCurrentSession(tx, context)), rejected);
        assert.deepEqual(await f.auth.logout("original-refresh-token"), { success: true });
      });
    });

    await check("revalidate 拒绝同事务变化，失效租约不因恢复而复活", async () => {
      const f = fixture(); await f.request(context => f.tx(async tx => {
        const lease = await f.auth.lockCurrentSession(tx, context);
        f.state.membership.status = "risk_restricted";
        await assert.rejects(() => lease.revalidate(), error => error?.status === 409);
        f.state.membership.status = "active";
        await assert.rejects(() => lease.revalidate(), error => error?.status === 403);
      }));
    });

    await check("异步读取期间原 ALS 或 context 变化不能返回另一身份", async () => {
      for (const change of [context => { context.workspaceId = "other"; }, () => { getRequestIdentity().userId = "other"; },
        () => { getRequestIdentity().audience = "operator"; }]) {
        const f = fixture(); await f.request(async context => {
          f.readHook = async (table, owner) => { if (table === "membership" && owner !== "root") change(context); };
          await assert.rejects(() => f.tx(tx => f.auth.lockCurrentSession(tx, context)), error => error?.status === 403);
        });
      }
    });
  } finally {
    Date.now = originalNow;
    if (oldSecret === undefined) delete process.env.AUTH_TOKEN_SECRET; else process.env.AUTH_TOKEN_SECRET = oldSecret;
  }
  assert.equal(groups, 10); completed = true;
  console.log(`client current session lease: ${groups} groups passed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
