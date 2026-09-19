const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const {
  ClientApiRateLimitService,
  clientRateLimitRule,
  clientAddress,
  tenantSmsDailyBudget
} = require("../apps/api/src/modules/client/client-api-rate-limit.service");
const { ApiAuthGuard } = require("../apps/api/src/common/api-auth.guard");

(async () => {
  const loginRule = clientRateLimitRule("/client/v1/auth/login", "POST");
  assert.deepEqual(loginRule, { code: "login", windowSeconds: 600, limit: 10 });
  assert.deepEqual(
    clientRateLimitRule("/client/v1/auth/registration/challenges", "POST"),
    { code: "registration_challenge", windowSeconds: 300, limit: 5 }
  );
  assert.equal(clientRateLimitRule("/client/v1/catalog", "GET").code, "anonymous_client");

  const calls = [];
  let count = 1;
  const prisma = {
    $transaction: async (callback) => callback({
      $executeRaw: async () => { calls.push("increment"); },
      $queryRaw: async () => [{ count }]
    })
  };
  const limiter = new ClientApiRateLimitService(prisma);
  await limiter.assertAllowed({ method: "POST", path: "/client/v1/auth/login", ip: "203.0.113.10" });
  assert.equal(calls.length, 1, "限流必须通过数据库事务原子递增");

  count = 11;
  await assert.rejects(
    limiter.assertAllowed({ method: "POST", path: "/client/v1/auth/login", ip: "203.0.113.10" }),
    (error) => error?.status === 429
  );

  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../apps/api/src/modules/client/client-api-rate-limit.service.ts"),
    "utf8"
  );
  assert.match(source, /ON DUPLICATE KEY UPDATE count = count \+ 1/u);
  assert.match(source, /createHash\("sha256"\)/u);
  assert.match(source, /scopeKey = hashScope/u);
  assert.match(
    require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../apps/api/src/common/api-auth.guard.ts"),
      "utf8"
    ),
    /import \{ ClientApiRateLimitService \} from .*client-api-rate-limit\.service/u
  );
  assert.equal(ApiAuthGuard.length, 4, "守卫必须保留限流服务的运行时注入参数");

  // clientAddress：来源地址只在一个入口取值，不自行读取转发头。
  assert.equal(clientAddress({ ip: " 203.0.113.9 " }), "203.0.113.9");
  assert.equal(clientAddress({ socket: { remoteAddress: "10.0.0.2" } }), "10.0.0.2");
  assert.equal(clientAddress({}), "unknown");
  assert.doesNotMatch(source, /headers\[|\.headers\.|"x-forwarded-for"/iu, "限流服务不得自行读取转发头，采信与否只由 main.ts 的 trust proxy 决定");
  assert.match(
    require("node:fs").readFileSync(require("node:path").join(__dirname, "../apps/api/src/main.ts"), "utf8"),
    /TRUST_PROXY_HOPS[\s\S]*app\.set\("trust proxy"/u
  );

  // 验证码按身份/租户配额：同一（租户, 身份）5 次/小时、10 次/天，租户日短信预算默认 2000。
  const buckets = new Map();
  const bucketPrisma = {
    $transaction: async (callback) => {
      let key;
      return callback({
        $executeRaw: async (query) => {
          const [, scopeKey, bucketStart] = query.values;
          key = `${scopeKey}:${bucketStart.toISOString()}`;
          buckets.set(key, (buckets.get(key) ?? 0) + 1);
        },
        $queryRaw: async () => [{ count: buckets.get(key) }]
      });
    }
  };
  const quota = new ClientApiRateLimitService(bucketPrisma);
  const identifierHash = "a".repeat(64);
  for (let index = 0; index < 5; index += 1) {
    await quota.assertChallengeAllowed({ tenantId: "tenant-a", identifierHash, countsTowardSmsBudget: true });
  }
  await assert.rejects(
    quota.assertChallengeAllowed({ tenantId: "tenant-a", identifierHash, countsTowardSmsBudget: true }),
    (error) => error?.status === 429 && /验证码请求过于频繁/u.test(error.message),
    "同一身份第 6 次/小时必须 429"
  );
  await quota.assertChallengeAllowed({ tenantId: "tenant-a", identifierHash: "b".repeat(64), countsTowardSmsBudget: true });
  await quota.assertChallengeAllowed({ tenantId: "tenant-b", identifierHash, countsTowardSmsBudget: false });
  assert.equal([...buckets.keys()].some((key) => key.includes(identifierHash)), false, "限流桶只保存不可逆 scopeKey，不保存身份哈希原文");
  const scopeKeys = new Set([...buckets.keys()].map((key) => key.split(":")[0]));
  assert.equal(scopeKeys.size, 7, "小时桶+日桶+租户预算桶按（租户, 身份）分别计数：a:2+1, b:2+1, tenant-b:2");

  process.env.CLIENT_SMS_DAILY_BUDGET_PER_TENANT = "3";
  assert.equal(tenantSmsDailyBudget(), 3);
  const budget = new ClientApiRateLimitService(bucketPrisma);
  for (let index = 0; index < 3; index += 1) {
    await budget.assertChallengeAllowed({ tenantId: "tenant-budget", identifierHash: `${index}`.repeat(64), countsTowardSmsBudget: true });
  }
  await assert.rejects(
    budget.assertChallengeAllowed({ tenantId: "tenant-budget", identifierHash: "9".repeat(64), countsTowardSmsBudget: true }),
    (error) => error?.status === 429 && /今日发送额度已用完/u.test(error.message),
    "租户日短信预算耗尽必须 429"
  );
  await budget.assertChallengeAllowed({ tenantId: "tenant-budget", identifierHash: "8".repeat(64), countsTowardSmsBudget: false });
  delete process.env.CLIENT_SMS_DAILY_BUDGET_PER_TENANT;
  assert.equal(tenantSmsDailyBudget(), 2000);

  // 登录用途验证码防枚举：未注册/停用账号与正常账号返回相同形状，且不发短信、不可验证。
  const { ClientAuthService } = require("../apps/api/src/modules/client/client-auth.service");
  process.env.AUTH_TOKEN_SECRET = "client-security-test-only-secret";
  const tenant = { id: "tenant-enum", code: "tenant-enum", status: "ACTIVE" };
  const workspace = { id: "ws-enum", tenantId: tenant.id, code: "main", name: "主空间", categoryCode: "camping", status: "ACTIVE", isDefault: true };
  const accounts = new Map([["13800000001", { status: "active" }], ["13800000002", { status: "suspended" }]]);
  const challenges = new Map();
  const smsSent = [];
  const authPrisma = {
    tenant: { findFirst: async ({ where }) => (where.code === tenant.code ? tenant : null) },
    businessWorkspace: { findFirst: async () => workspace },
    customerAccount: { findFirst: async ({ where }) => accounts.get(where.loginPhone) ?? null },
    $transaction: async (callback) => callback({
      $queryRaw: async () => [],
      clientRegistrationChallenge: {
        findFirst: async ({ where }) => {
          for (const row of challenges.values()) {
            if (where.requestKey && row.requestKey === where.requestKey) return row;
            if (where.identifierHash && row.identifierHash === where.identifierHash && row.createdAt > where.createdAt.gt) return row;
          }
          return null;
        },
        create: async ({ data }) => { const row = { ...data, attempts: 0, createdAt: new Date() }; challenges.set(row.id, row); return row; },
        update: async ({ where, data }) => { const row = { ...challenges.get(where.id), ...data }; challenges.set(where.id, row); return row; }
      }
    }),
    clientRegistrationChallenge: {
      findUnique: async ({ where }) => challenges.get(where.id) ?? null,
      update: async ({ where, data }) => { Object.assign(challenges.get(where.id), data); return challenges.get(where.id); },
      updateMany: async ({ where, data }) => {
        const row = challenges.get(where.id);
        if (!row || (where.status && row.status !== where.status)) return { count: 0 };
        if (data.attempts?.increment) row.attempts += data.attempts.increment; else Object.assign(row, data);
        return { count: 1 };
      }
    }
  };
  const integrations = {
    hasEnabledProvider: async () => true,
    sendVerificationSms: async (_tenantId, phone) => { smsSent.push(phone); return { configured: true, provider: "aliyun_sms", externalRequestId: "biz" }; }
  };
  const auth = new ClientAuthService(authPrisma, integrations);
  const request = (identifier, key) => auth.createChallenge({ tenantCode: tenant.code, method: "sms", identifier, idempotencyKey: key, purpose: "login" });
  const registered = await request("13800000001", "k-registered");
  const unknown = await request("13800000009", "k-unknown");
  const suspended = await request("13800000002", "k-suspended");
  assert.deepEqual(Object.keys(unknown).sort(), Object.keys(registered).sort(), "未注册号码的响应字段与已注册号码一致");
  assert.deepEqual(Object.keys(suspended).sort(), Object.keys(registered).sort(), "停用账号的响应字段与已注册号码一致");
  for (const response of [registered, unknown, suspended]) {
    assert.equal(response.status, "pending_verification");
    assert.equal(response.deliveryMode, "provider");
    assert.equal(response.purpose, "login");
    assert.equal("developmentCode" in response, false);
  }
  assert.deepEqual(smsSent, ["13800000001"], "未注册/停用账号不能触发短信发送");
  assert.equal(challenges.get(unknown.challengeId).status, "unverifiable");
  assert.equal(challenges.get(suspended.challengeId).status, "unverifiable");
  assert.equal(challenges.get(registered.challengeId).status, "pending_verification");
  await assert.rejects(() => auth.verifyChallenge({ challengeId: unknown.challengeId, code: "123456" }), /验证码错误或已过期/u);
  await assert.rejects(() => auth.verifyChallenge({ challengeId: registered.challengeId, code: "000000" }), /验证码错误或已过期/u, "错误验证码与不可验证挑战使用同一文案");
  const replay = await request("13800000009", "k-unknown");
  assert.equal(replay.challengeId, unknown.challengeId);
  assert.equal(replay.status, "pending_verification", "幂等重放也不暴露 unverifiable 内部状态");
  // 验证码不再以公开盐存储：库中 codeHash 必须是 HMAC-SHA256 十六进制，且与旧算法不同。
  const stored = challenges.get(registered.challengeId).codeHash;
  assert.match(stored, /^[0-9a-f]{64}$/u);
  assert.match(
    require("node:fs").readFileSync(require("node:path").join(__dirname, "../apps/api/src/modules/client/client-auth.service.ts"), "utf8"),
    /createHmac\("sha256", `\$\{this\.secret\(\)\}:client-challenge`\)/u,
    "验证码哈希必须以 AUTH_TOKEN_SECRET 做 HMAC 密钥"
  );

  console.log("CLIENT-01 客户端认证限流、按身份配额、登录防枚举与令牌安全：全部通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
