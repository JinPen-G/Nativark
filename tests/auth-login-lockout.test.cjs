const assert = require("node:assert/strict");

// 公共登录保护直接消费正式认证服务；演示账号重置原例由独立 Rental 组合保留。
const { PlatformAuthService } = require("@rental-os/platform-server/auth");

const policy = { enabled: true, maxFailures: 3, windowMinutes: 10, lockMinutes: 15 };

function createStore({ alwaysConflict = false, alwaysLoseCas = false } = {}) {
  const rows = new Map();
  return {
    rows,
    authLoginFailure: {
      async findUnique({ where }) {
        const row = rows.get(where.loginKeyHash);
        return row ? { ...row } : null;
      },
      async create({ data }) {
        if (alwaysConflict || rows.has(data.loginKeyHash)) {
          const error = new Error("unique conflict");
          error.code = "P2002";
          throw error;
        }
        rows.set(data.loginKeyHash, { id: "row-1", ...data, createdAt: new Date(), updatedAt: new Date() });
      },
      async updateMany({ where, data }) {
        if (alwaysLoseCas) return { count: 0 };
        const row = rows.get(where.loginKeyHash);
        if (!row || row.revision !== where.revision) return { count: 0 };
        rows.set(where.loginKeyHash, {
          ...row,
          failureCount: data.failureCount,
          firstFailedAt: data.firstFailedAt,
          lockedUntil: data.lockedUntil,
          expiresAt: data.expiresAt,
          revision: row.revision + data.revision.increment,
          updatedAt: new Date()
        });
        return { count: 1 };
      },
      async deleteMany({ where = {} } = {}) {
        if (where.loginKeyHash?.in) {
          let count = 0;
          for (const key of where.loginKeyHash.in) if (rows.delete(key)) count += 1;
          return { count };
        }
        if (where.loginKeyHash) {
          const row = rows.get(where.loginKeyHash);
          if (!row || (where.revision !== undefined && row.revision !== where.revision)) return { count: 0 };
          rows.delete(where.loginKeyHash);
          return { count: 1 };
        }
        if (where.expiresAt?.lt) {
          let count = 0;
          for (const [key, row] of rows) if (row.expiresAt < where.expiresAt.lt) { rows.delete(key); count += 1; }
          return { count };
        }
        const count = rows.size;
        rows.clear();
        return { count };
      }
    }
  };
}

function makeService(prisma, dataSource = "mysql") {
  const config = { get: (key) => key === "AUTH_TOKEN_SECRET" ? "lockout-unit-test-secret" : key === "PLATFORM_DATA_SOURCE" ? dataSource : undefined };
  return new PlatformAuthService({}, config, undefined, undefined, prisma);
}

(async () => {
  const store = createStore();
  const first = makeService(store);
  const second = makeService(store);
  const loginKey = "tenant-one:operator@example.test";

  await first.recordFailedLogin(loginKey, policy);
  await second.recordFailedLogin(loginKey, policy);
  await first.recordFailedLogin(loginKey, policy);
  const [hash, row] = [...store.rows.entries()][0];
  assert.match(hash, /^[a-f0-9]{64}$/u);
  assert.equal(hash.includes("operator@example.test"), false, "raw account must never be stored as the lockout key");
  assert.equal(row.failureCount, 3);
  assert.ok(row.lockedUntil instanceof Date);
  await assert.rejects(() => second.assertNotLocked(loginKey, policy), /登录失败次数过多/u);

  await first.clearFailedLogin(loginKey);
  assert.equal(store.rows.size, 0, "a successful login clears the persistent failure state");

  const disabled = createStore();
  await makeService(disabled).recordFailedLogin(loginKey, { ...policy, enabled: false });
  assert.equal(disabled.rows.size, 0, "disabled policy must not write lockout state");

  const uniqueRace = createStore({ alwaysConflict: true });
  await assert.rejects(() => makeService(uniqueRace).recordFailedLogin(loginKey, policy), /并发冲突/u);

  const casRace = createStore({ alwaysLoseCas: true });
  casRace.rows.set("existing", {
    id: "row", loginKeyHash: "existing", failureCount: 1, firstFailedAt: new Date(),
    lockedUntil: null, expiresAt: new Date(Date.now() + 600_000), revision: 1
  });
  const casService = makeService(casRace);
  casService.loginFailureKeyHash = () => "existing";
  await assert.rejects(() => casService.recordFailedLogin(loginKey, policy), /并发冲突/u);

  const memory = createStore();
  const memoryService = makeService(memory, "memory");
  await memoryService.recordFailedLogin(loginKey, policy);
  assert.equal(memory.rows.size, 0, "memory data source must keep using the process-local fallback");

  console.log("auth login lockout tests passed: shared hash storage, threshold lock, clear, disabled policy, unique race, CAS race, memory fallback");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
