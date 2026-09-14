const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const {
  ClientApiRateLimitService,
  clientRateLimitRule
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
  console.log("CLIENT-01 客户端认证限流与令牌安全：10 项通过");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
