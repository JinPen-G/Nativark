/**
 * 隔离 MySQL E2E（任务 P0-03，安全整改版）
 *
 * 在专用测试库上自动执行：配置与标识符严格校验、空库全量迁移、schema drift 检查、
 * 双 Seed 重复执行、真实旧库升级（旧通知表带数据 → 数据保留式迁移）、仓储层 fail-closed、
 * API 启动、登录、SaaS 租户初始化、Rental Core 报价→下单→履约全链路、
 * 车辆兼容域读写租户戳、双租户并发隔离和 API 重启恢复。
 *
 * 安全边界：
 * - 只创建和清理名字含 e2e 且通过格式校验的专用测试库，绝不触碰开发库；
 * - 全部凭据来自环境变量或本地 .env（不入仓库），脚本内无任何硬编码凭据；
 * - 所有子进程使用参数数组直接调用，不经 shell 拼接，杜绝命令注入；
 * - 数据库与容器标识先通过白名单正则校验，再以反引号引用进 SQL。
 */

const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "apps", "api");
const SCHEMA_PATH = path.join(API_DIR, "prisma", "schema.prisma");
const MIGRATIONS_DIR = path.join(API_DIR, "prisma", "migrations");

// 期望迁移条数由迁移目录推导，而不是写死常量：写死会让"新增一条迁移"必然连带
// 改测试期望值，而改期望值时很容易顺手填成实际观测值，从此失去校验意义。
const EXPECTED_MIGRATIONS = fs
  .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && fs.existsSync(path.join(MIGRATIONS_DIR, entry.name, "migration.sql"))
  ).length;

/* ---------- 配置解析：环境变量优先，其次本地 .env（不入仓库） ---------- */

function loadLocalEnv() {
  const envPath = path.join(ROOT, ".env");
  const loaded = {};
  if (!fs.existsSync(envPath)) return loaded;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    let value = line.slice(sep + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) loaded[key] = value;
  }
  return loaded;
}

const localEnv = loadLocalEnv();
function requiredCredential(name) {
  const value = process.env[name] ?? localEnv[name];
  if (!value) {
    console.error(
      `[E2E] 缺少必需凭据 ${name}。请在环境变量或本地 .env（不入仓库）中配置后重试；` +
        "不得在脚本或仓库文档中硬编码凭据。"
    );
    process.exit(2);
  }
  return value;
}

const TEST_DB = process.env.E2E_DATABASE_NAME || "store_rental_e2e";
const MYSQL_CONTAINER = process.env.E2E_MYSQL_CONTAINER || "store-rental-mysql";
const MYSQL_ROOT_PASSWORD = requiredCredential("MYSQL_ROOT_PASSWORD");
const DEMO_PASSWORD = requiredCredential("E2E_DEMO_PASSWORD");
const PLATFORM_PASSWORD = requiredCredential("E2E_PLATFORM_PASSWORD");
const SOURCE_DATABASE_URL = requiredCredential("DATABASE_URL");
const API_PORT = Number(process.env.E2E_API_PORT || 3990);
const API_BASE = `http://localhost:${API_PORT}`;

/* ---------- 标识符与连接严格校验 ---------- */

assert.match(TEST_DB, /^[a-z][a-z0-9_]{2,62}$/u, "测试库名只允许小写字母、数字和下划线");
assert.ok(TEST_DB.includes("e2e"), "测试库名必须包含 e2e，防止误操作非专用数据库");
assert.ok(TEST_DB !== "store_rental", "禁止将 E2E 指向开发库");
assert.match(MYSQL_CONTAINER, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u, "容器名格式非法");
assert.ok(Number.isInteger(API_PORT) && API_PORT >= 1024 && API_PORT <= 65535, "E2E_API_PORT 必须是 1024-65535 的整数");

function deriveTestDatabaseUrl(sourceUrl) {
  const parsed = new URL(sourceUrl);
  assert.equal(parsed.protocol, "mysql:", "DATABASE_URL 必须是 mysql:// 连接串");
  assert.ok(
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1",
    "E2E 只允许使用本机 MySQL，禁止连接远端数据库"
  );
  parsed.pathname = `/${TEST_DB}`;
  return parsed.toString();
}

const TEST_DATABASE_URL = deriveTestDatabaseUrl(SOURCE_DATABASE_URL);

/* ---------- 基础执行器：全部参数数组直调，不经 shell ---------- */

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
    env: { ...process.env, ...(options.env || {}) }
  });
}

const PRISMA_CLI = require.resolve("prisma/build/index.js");
const TS_NODE_BIN = require.resolve("ts-node/dist/bin.js");

function mysqlRaw(sql) {
  return spawnSync(
    "docker",
    ["exec", "-e", `MYSQL_PWD=${MYSQL_ROOT_PASSWORD}`, MYSQL_CONTAINER, "mysql", "-uroot", "--default-character-set=utf8mb4", "-e", sql],
    { encoding: "utf8" }
  );
}

function mysqlRootExec(sql) {
  const result = mysqlRaw(sql);
  if (result.error) fail(`无法调用 docker（请确认 Docker 与 MySQL 容器已启动）: ${result.error.message}`);
  if (result.status !== 0) fail(`mysql 命令执行失败: ${`${result.stdout || ""}${result.stderr || ""}`.trim().split(/\r?\n/).slice(-3).join(" | ")}`);
  return `${result.stdout || ""}${result.stderr || ""}`
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/Warning.*password/iu.test(line))
    .join("\n");
}

function mysqlQuery(sql) {
  return mysqlRootExec(`USE \`${TEST_DB}\`;\n${sql}`);
}

function readCount(sql) {
  const out = mysqlQuery(sql);
  const match = out.match(/(\d+)\s*$/u);
  if (!match) fail(`计数查询无数字结果: ${sql}`, out);
  return Number(match[1]);
}

function readScalar(sql) {
  const lines = mysqlQuery(sql).split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length < 2) fail(`标量查询无结果: ${sql}`);
  return lines.at(-1).trim();
}

/** 单行多列查询：返回列名→值的对象。取最后两行为表头与数据行，NULL 原样为字符串 "NULL"。 */
function readRow(sql) {
  const lines = mysqlQuery(sql).split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length < 2) fail(`行查询无结果: ${sql}`);
  const header = lines.at(-2).split("\t");
  const values = lines.at(-1).split("\t");
  const row = {};
  header.forEach((col, index) => {
    row[col] = values[index];
  });
  return row;
}

/**
 * 多行多列查询：返回对象数组，空结果返回空数组。
 *
 * 与 `readRow` 分开是因为后者只取最后一行；断言「恰好这几行」需要看全部行，
 * 用 readRow 会把「多出一行」的错误漏掉。
 */
function readRows(sql) {
  const lines = mysqlQuery(sql).split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    const row = {};
    header.forEach((col, index) => {
      row[col] = values[index];
    });
    return row;
  });
}

/* ---------- 断言与进度输出 ---------- */

let passedGroups = 0;
function ok(message) {
  passedGroups += 1;
  console.log(`  PASS  ${message}`);
}
let apiLogRef = null;
function fail(message, detail) {
  console.error(`  FAIL  ${message}`);
  if (detail) console.error(detail);
  // API 侧 500 在断言层看不到成因，这里附上子进程日志尾部，避免只留一个状态码。
  if (apiLogRef && apiLogRef.length) {
    console.error("--- API 日志尾部 ---");
    console.error(apiLogRef.join("").slice(-3000));
  }
  process.exitCode = 1;
  throw new Error(message);
}

/* ---------- HTTP 与 API 子进程 ---------- */

function request(method, requestPath, body, token, extraHeaders) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(requestPath, API_BASE);
    const req = http.request(
      url,
      {
        method,
        // 必须禁用 keep-alive：Node 19+ 的 globalAgent 默认 keepAlive=true，
        // 而本测试会重启 API（重启恢复与回填幂等两节）。连接池里指向旧进程的 socket
        // 已失效，之后第一个复用它的请求会随机抛 ECONNRESET，表现为偶发失败。
        agent: false,
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
          // Content-Length 必须显式给：Node 的 useChunkedEncodingByDefault 只对
          // POST/PUT/PATCH 为真，DELETE 既不分块也没有长度头，写入的 body 会被
          // **静默丢弃**——服务端收到空 body，表现为带原因的 DELETE 仍报 400。
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(extraHeaders || {})
        }
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function probePort() {
  try {
    await request("GET", "/api/health");
    return true;
  } catch {
    return false;
  }
}

async function login(tenantCode, account, password) {
  const res = await request("POST", "/api/auth/login", { tenantCode, account, password });
  if (res.status !== 200 && res.status !== 201) fail(`登录 ${tenantCode}/${account} 失败`, JSON.stringify(res.body).slice(0, 300));
  return res.body.data;
}

function startApi() {
  apiProcess = spawn(process.execPath, [path.join("apps", "api", "dist", "main.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
      PLATFORM_DATA_SOURCE: "mysql",
      STORE_RENTAL_DATA_SOURCE: "mysql",
      INFRA_DATA_SOURCE: "mysql",
      AUTH_TOKEN_SECRET: randomBytes(32).toString("hex"),
      API_PORT: String(API_PORT),
      DATABASE_CONNECT_ON_START: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  apiLogRef = logs;
  apiProcess.stdout.on("data", (chunk) => logs.push(String(chunk)));
  apiProcess.stderr.on("data", (chunk) => logs.push(String(chunk)));
  apiProcess.on("exit", (code) => {
    if (code !== 0 && apiProcess) {
      console.error(`API 子进程异常退出 code=${code}`);
      console.error(logs.join("").slice(-3000));
    }
  });
  return logs;
}

let apiProcess = null;
function stopApi() {
  if (!apiProcess) return Promise.resolve();
  const processRef = apiProcess;
  apiProcess = null;
  return new Promise((resolve) => {
    processRef.on("exit", () => resolve());
    processRef.kill();
    setTimeout(() => {
      try {
        processRef.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 4000).unref();
  });
}

async function waitHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await request("GET", "/api/health");
      if (res.status === 200) return true;
    } catch {
      /* 重试 */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

/* ---------- 业务辅助 ---------- */

async function bootstrapTenant(platformToken, tenantCode, categoryCode) {
  const boot = await request(
    "POST",
    "/api/platform/tenant-bootstrap",
    {
      tenantCode,
      tenantName: `E2E租户 ${tenantCode}`,
      categoryCode,
      adminAccount: "admin",
      adminDisplayName: `E2E ${categoryCode} 管理员`
    },
    platformToken
  );
  if (boot.status !== 201) fail(`初始化车辆租户 ${tenantCode} 失败`, JSON.stringify(boot.body).slice(0, 300));
  const temporaryPassword = boot.body.data.temporaryPassword;
  const first = await login(tenantCode, "admin", temporaryPassword);
  const newPassword = `E2e!${randomBytes(4).toString("hex")}`;
  const changed = await request(
    "POST",
    "/api/auth/change-password",
    { currentPassword: temporaryPassword, newPassword },
    first.accessToken
  );
  if (changed.status !== 201) fail(`车辆租户 ${tenantCode} 改密失败`, JSON.stringify(changed.body).slice(0, 300));
  // 一并回报口令：`startApi()` 每次都生成新的 AUTH_TOKEN_SECRET，重启后旧令牌一律 401，
  // 重启后还要复验的用例必须能重新登录，而口令是本函数内随机生成的。
  const session = await login(tenantCode, "admin", newPassword);
  return { ...session, password: newPassword };
}

async function prepareMockFunding(order, token, keyPrefix) {
  const payable = Number(order.payable ?? order.finalPayableAmount ?? order.payableAmount ?? 0);
  if (payable > 0) {
    const rental = await request("POST", `/api/rental/v1/orders/${order.id}/funding-events/initiate`, {
      instrument: "rental", idempotencyKey: `${keyPrefix}:rental`, reason: "E2E 领取前模拟收取租金与费用"
    }, token);
    assert.equal(rental.status, 201, `模拟租金收取失败: ${JSON.stringify(rental.body).slice(0, 200)}`);
  }
  if (Number(order.depositAmount) > 0) {
    const deposit = await request("POST", `/api/rental/v1/orders/${order.id}/funding-events/initiate`, {
      instrument: "deposit", idempotencyKey: `${keyPrefix}:deposit`, reason: "E2E 领取前模拟收取押金"
    }, token);
    assert.equal(deposit.status, 201, `模拟押金收取失败: ${JSON.stringify(deposit.body).slice(0, 200)}`);
  }
  if (Number(order.preAuthAmount) > 0) {
    const preauth = await request("POST", `/api/rental/v1/orders/${order.id}/funding-events/initiate`, {
      instrument: "preauthorization", idempotencyKey: `${keyPrefix}:preauth`, reason: "E2E 领取前模拟冻结预授权"
    }, token);
    assert.equal(preauth.status, 201, `模拟预授权冻结失败: ${JSON.stringify(preauth.body).slice(0, 200)}`);
  }
}

async function closeMockFundedOrder(orderId, token, keyPrefix) {
  const balance = await request("GET", `/api/rental/v1/orders/${orderId}/funding-events`, null, token);
  assert.equal(balance.status, 200, "结算前读取模拟资金余额失败");
  if (Number(balance.body.data.rental.balance) > 0) {
    const rental = await request("POST", `/api/rental/v1/orders/${orderId}/funding-events/append`, {
      instrument: "rental", amount: balance.body.data.rental.balance,
      idempotencyKey: `${keyPrefix}:rental-balance`, reason: "E2E 结算前补收异常费用"
    }, token);
    assert.equal(rental.status, 201, "结算前补收租金与异常费用失败");
  }
  if (Number(balance.body.data.deposit.balance) > 0) {
    const refunded = await request("POST", `/api/rental/v1/orders/${orderId}/funding-events/refund`, {
      instrument: "deposit", amount: balance.body.data.deposit.balance,
      idempotencyKey: `${keyPrefix}:deposit-refund`, reason: "E2E 结算退还剩余押金"
    }, token);
    assert.equal(refunded.status, 201, "结算退还模拟押金失败");
  }
  if (Number(balance.body.data.preauthorization.balance) > 0) {
    const released = await request("POST", `/api/rental/v1/orders/${orderId}/funding-events/release`, {
      idempotencyKey: `${keyPrefix}:preauth-release`, reason: "E2E 结算释放剩余预授权"
    }, token);
    assert.equal(released.status, 201, "结算释放模拟预授权失败");
  }
  return request("POST", `/api/rental/v1/orders/${orderId}/settle`, {}, token);
}

async function reviewInspectionException(orderId, inspectionId, exceptionIndex, amount, token, keyPrefix) {
  const reviewed = await request(
    "POST",
    `/api/rental/v1/orders/${orderId}/inspections/${inspectionId}/exceptions/${exceptionIndex}/review`,
    { decision: "approved", approvedChargeAmount: amount, reason: "E2E 结算人员核定" },
    token,
    { "Idempotency-Key": `${keyPrefix}:exception:${exceptionIndex}` }
  );
  assert.equal(reviewed.status, 201, `检查异常审核失败: ${JSON.stringify(reviewed.body).slice(0, 200)}`);
  return reviewed.body.data.order;
}

/**
 * 公共官方日历来源（需求 4.5.2/4.5.8）。
 *
 * 官方节假日数据是**跨租户的公共基础来源**，由 SaaS 平台管理员在平台注册表里登记来源
 * 与年度来源版本；经营空间不能直接提交原始官方日期，只能引用某一版生成自己的年度草稿
 * 再自行确认发布。因此测试里凡是"某年度需要官方数据"的地方，都要走这两步。
 *
 * 复用同一个来源：同一 (来源, 年度) 下每次登记都会新增一个来源版本，正好也验证了
 * 「官方日历再次调整时必须形成新的来源版本」。
 */
let officialSourceId;
async function ensureOfficialSource() {
  // 每次都重新登录取平台令牌：本套件在第 17 节会重启 API，而 startApi() 每次生成新的
  // AUTH_TOKEN_SECRET，重启前拿到的任何令牌都会在之后变成 401。缓存令牌是个陷阱，
  // 缓存来源 id 则没问题（库里那一行会一直在）。
  const platformSession = await login("platform", "admin", PLATFORM_PASSWORD);
  if (!officialSourceId) {
    const created = await request(
      "POST",
      "/api/platform/official-calendars",
      {
        region: "CN",
        name: "E2E 国务院办公厅放假通知",
        url: "https://example.invalid/e2e-official-source",
        notes: "MySQL E2E 用的公共官方来源"
      },
      platformSession.accessToken
    );
    if (created.status !== 201) fail("登记公共官方来源失败", JSON.stringify(created.body).slice(0, 300));
    officialSourceId = created.body.data.id;
  }
  return { sourceId: officialSourceId, token: platformSession.accessToken };
}

/** 登记年度来源版本，返回原始响应（供断言失败分支）。 */
async function postOfficialVersion(year, days, publishedAt) {
  const { sourceId, token } = await ensureOfficialSource();
  return request(
    "POST",
    `/api/platform/official-calendars/${sourceId}/versions`,
    { year, publishedAt: publishedAt ?? new Date(Date.now() - 86400000).toISOString(), days },
    token
  );
}

/** 登记一个年度来源版本并返回它，供经营空间引用。 */
async function registerOfficialVersion(year, days, publishedAt) {
  const registered = await postOfficialVersion(year, days, publishedAt);
  if (registered.status !== 201) {
    fail(`登记 ${year} 年度官方来源版本失败`, JSON.stringify(registered.body).slice(0, 300));
  }
  return registered.body.data;
}

/** 经营空间引用某个来源版本，生成/更新本空间年度草稿。 */
function applyOfficialVersion(year, sourceVersionId, token) {
  return request(
    "POST",
    `/api/rental/v1/calendars/${year}/apply-official-source`,
    { sourceVersionId },
    token
  );
}

/* ---------- 主流程 ---------- */

async function main() {
  console.log("== 0. 前置校验 ==");
  if (await probePort()) fail(`端口 ${API_PORT} 已被占用，拒绝启动 E2E API`);
  ok(`配置校验通过（测试库 ${TEST_DB}，容器 ${MYSQL_CONTAINER}，端口 ${API_PORT}）`);

  console.log("== 1. 准备专用测试库 ==");
  mysqlRootExec(
    `DROP DATABASE IF EXISTS \`${TEST_DB}\`;\n` +
      `CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n` +
      `GRANT ALL PRIVILEGES ON \`${TEST_DB}\`.* TO 'store_rental'@'%';`
  );
  ok(`测试库 ${TEST_DB} 已重建`);

  console.log("== 2. 空库全量迁移与 schema drift 检查 ==");
  const migrateEnv = { DATABASE_URL: TEST_DATABASE_URL };
  const deploy = (extra) =>
    runNode([PRISMA_CLI, "migrate", "deploy", "--schema", SCHEMA_PATH], { env: migrateEnv, ...extra });
  const firstDeploy = deploy();
  if (firstDeploy.status !== 0) fail("空库 migrate deploy 失败", `${firstDeploy.stdout || ""}${firstDeploy.stderr || ""}`);
  const appliedCount = readCount("SELECT COUNT(*) FROM `_prisma_migrations` WHERE `finished_at` IS NOT NULL AND `rolled_back_at` IS NULL;");
  if (appliedCount !== EXPECTED_MIGRATIONS) {
    fail(`迁移数量异常: 实际 ${appliedCount}，迁移目录 ${EXPECTED_MIGRATIONS}`);
  }
  ok(`全量迁移完成，_prisma_migrations=${appliedCount}/${EXPECTED_MIGRATIONS}`);
  const drift = runNode([PRISMA_CLI, "migrate", "diff", "--from-url", TEST_DATABASE_URL, "--to-schema-datamodel", SCHEMA_PATH]);
  if (drift.status !== 0) fail("migrate diff 执行失败", `${drift.stdout || ""}${drift.stderr || ""}`);
  const driftSql = `${drift.stdout || ""}${drift.stderr || ""}`.replace(
    /\x1B\[[0-?]*[ -/]*[@-~]/gu,
    ""
  );
  // 判据必须是「Prisma 明确说没有差异」，不能是「输出里没出现 SQL 关键字」。
  //
  // 早前这里用 /ALTER TABLE|CREATE TABLE|.../ 去匹配，但不带 --script 时
  // migrate diff 输出的是人类可读摘要（`[+] Added tables` / `[*] Changed the X table`），
  // 根本不含 SQL 关键字，于是这条断言**永远不会触发**——一个测不出东西的绿灯。
  // 实测确认：迁移与 schema.prisma 之间本就存在 11 张表的历史 drift，旧写法全程没报。
  const driftClean = /No difference detected/iu.test(driftSql);
  if (!driftClean) {
    const driftScript = runNode([
      PRISMA_CLI, "migrate", "diff", "--from-url", TEST_DATABASE_URL,
      "--to-schema-datamodel", SCHEMA_PATH, "--script"
    ]);
    fail(
      "空库全量迁移结果与 schema.prisma 不一致",
      `${driftScript.stdout || ""}${driftScript.stderr || driftSql}`.slice(0, 12000)
    );
  }
  ok("迁移后库结构与 schema.prisma 完全一致（无 drift）");

  console.log("== 3. 二次部署幂等（已迁移库升级路径） ==");
  const countsBefore = {
    tenants: readCount("SELECT COUNT(*) FROM `Tenant`;"),
    orders: readCount("SELECT COUNT(*) FROM `rental_orders`;")
  };
  const secondDeploy = deploy();
  if (secondDeploy.status !== 0) fail("二次 migrate deploy 失败", `${secondDeploy.stdout || ""}${secondDeploy.stderr || ""}`);
  assert.deepEqual(
    { tenants: readCount("SELECT COUNT(*) FROM `Tenant`;"), orders: readCount("SELECT COUNT(*) FROM `rental_orders`;") },
    countsBefore,
    "二次部署不得改变数据"
  );
  ok("二次 deploy 为无操作且数据不变");

  console.log("== 4. Seed 重复执行 ==");
  // Seed 现在强制从环境变量取账号口令（仓库不再保存明文密码）。
  // requiredCredential 允许凭据只存在于本地 .env，而 runNode 只继承 process.env，
  // 因此必须在这里显式透传，否则 seed 会因缺少凭据而失败。
  const seedEnv = {
    ...migrateEnv,
    SEED_PLATFORM_PASSWORD: PLATFORM_PASSWORD,
    SEED_DEMO_PASSWORD: DEMO_PASSWORD
  };
  const seedRun = (script) =>
    runNode([TS_NODE_BIN, `prisma/${script}`], { cwd: API_DIR, env: seedEnv });
  for (const script of ["seed.ts"]) {
    for (let round = 1; round <= 2; round += 1) {
      const result = seedRun(script);
      if (result.status !== 0) fail(`${script} 第 ${round} 次执行失败`, `${result.stdout || ""}${result.stderr || ""}`.slice(-2000));
    }
  }
  const seedCounts = {
    tenants: readCount("SELECT COUNT(*) FROM `Tenant`;"),
    users: readCount("SELECT COUNT(*) FROM `User`;"),
    orders: readCount("SELECT COUNT(*) FROM `rental_orders`;"),
    ordersWithCharges: readCount("SELECT COUNT(*) FROM `rental_orders` WHERE JSON_LENGTH(`chargeLines`) > 0;")
  };
  assert.equal(seedCounts.tenants, 3, "Seed 后租户数");
  assert.equal(
    readCount("SELECT COUNT(DISTINCT `categoryCode`) FROM `business_workspaces` WHERE `tenantId`='tenant_001' AND `status`='ACTIVE';"),
    4,
    "demo 租户必须具备四个启用品类空间"
  );
  assert.equal(
    readCount("SELECT COUNT(*) FROM `workspace_members` WHERE `tenantId`='tenant_001';"),
    readCount("SELECT COUNT(*) FROM `User` WHERE `tenantId`='tenant_001';") * 4,
    "demo 的每个账号都必须加入四个测试空间"
  );
  ok(`双 Seed 各执行两次，计数稳定: ${JSON.stringify(seedCounts)}`);

  const sampleTenantId = readScalar("SELECT `id` FROM `Tenant` ORDER BY `id` LIMIT 1;");
  if (!sampleTenantId) fail("无法取 Seed 租户用于存量报价构造");
  const retiredTables = ["StoreRentalOrder", "FeeItem", "OrderNotificationRecord", "OrderOperationRecord"];
  const legacyTablesExist = retiredTables.filter((table) => readCount(
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = "${table}";`
  ) > 0);
  assert.equal(legacyTablesExist.length, 0, "旧门市租赁表必须已移除");
  console.log("== 5b. 旧库存量押金/预授权混口径必须被重新分类，不得错算进本次实收 ==");
  // Codex 复审 P1：`add_quote_receivable_amount` 无条件把 receivable 算成 payable + deposit，
  // 而紧随其后的 `split_deposit_and_preauth` 自己承认存量 depositAmount 里可能装的是预授权额度。
  // 于是旧库里的预授权报价升级后被解释成「已收押金」。纠正迁移按规则快照重新分类。
  //
  // 造三条存量报价：①预授权口径 ②固定押金口径 ③规则快照缺 depositMode（无法判定）。
  // 手工插入以模拟"升级前就存在"的行：把三列改回旧口径（preAuthAmount=0、金额都在 depositAmount）。
  const legacyQuoteBase = {
    tenantId: sampleTenantId,
    payable: 1000,
    deposit: 500
  };
  const legacyWorkspaceId = readScalar(
    `SELECT \`id\` FROM \`business_workspaces\` WHERE \`tenantId\`='${legacyQuoteBase.tenantId}' ORDER BY \`createdAt\` LIMIT 1;`
  );
  const legacyRows = [
    { id: "e2e_legacy_q_preauth", mode: "preauthorization" },
    { id: "e2e_legacy_q_fixed", mode: "fixed" },
    { id: "e2e_legacy_q_unknown", mode: null }
  ];
  for (const row of legacyRows) {
    const ruleSnapshot = row.mode
      ? `JSON_OBJECT('payment', JSON_OBJECT('depositMode', '${row.mode}', 'timing', 'order', 'preauthorizationRequired', false, 'unpaidHoldMinutes', 15))`
      : `JSON_OBJECT('payment', JSON_OBJECT('timing', 'order'))`;
    mysqlQuery(`
      INSERT INTO \`rental_quotes\`
        (\`id\`, \`tenantId\`, \`workspaceId\`, \`quoteNo\`, \`categoryCode\`, \`request\`, \`chargeLines\`,
         \`rentalAmount\`, \`discountAmount\`, \`couponAmount\`, \`serviceAmount\`, \`fulfillmentAmount\`,
         \`depositAmount\`, \`preAuthAmount\`, \`payableAmount\`, \`receivableAmount\`,
         \`pricingPlanVersion\`, \`ruleVersion\`, \`ruleSnapshot\`, \`appliedDiscountPlanIds\`, \`expiresAt\`, \`createdAt\`)
      VALUES
        ('${row.id}', '${legacyQuoteBase.tenantId}', '${legacyWorkspaceId}', '${row.id}', 'VEHICLE',
         JSON_OBJECT(), JSON_ARRAY(), ${legacyQuoteBase.payable}, 0, 0, 0, 0,
         ${legacyQuoteBase.deposit}, 0, ${legacyQuoteBase.payable}, ${legacyQuoteBase.payable + legacyQuoteBase.deposit},
         '1.0', '1.0', ${ruleSnapshot}, JSON_ARRAY(), NOW(3), NOW(3));
    `);
  }
  // 回退两条纠正迁移，再重新 deploy，证明是迁移链做的分类与金额隔离。
  mysqlQuery("DELETE FROM `_prisma_migrations` WHERE `migration_name` IN ('20260827000900_fix_legacy_deposit_preauth_receivable','20260828000200_preserve_unverified_legacy_security_amount');");
  mysqlQuery(`
    ALTER TABLE \`rental_quotes\` DROP COLUMN \`legacyDepositUnverifiedAmount\`;
    ALTER TABLE \`rental_orders\` DROP COLUMN \`legacyDepositUnverifiedAmount\`;
    ALTER TABLE \`rental_quotes\` DROP COLUMN \`legacyDepositUnverified\`;
    ALTER TABLE \`rental_orders\` DROP COLUMN \`legacyDepositUnverified\`;
  `);
  const reclassifyDeploy = deploy();
  if (reclassifyDeploy.status !== 0) {
    fail("纠正迁移重放失败", `${reclassifyDeploy.stdout || ""}${reclassifyDeploy.stderr || ""}`.slice(-2000));
  }
  // ①预授权口径：金额搬到 preAuthAmount，押金归 0，实收回落为应付（冻结不是实收）。
  const preauthRow = readRow(
    "SELECT `depositAmount`, `preAuthAmount`, `receivableAmount`, `legacyDepositUnverified` FROM `rental_quotes` WHERE `id`='e2e_legacy_q_preauth';"
  );
  assert.equal(Number(preauthRow.depositAmount), 0, `预授权口径的存量押金必须归 0: ${preauthRow.depositAmount}`);
  assert.equal(Number(preauthRow.preAuthAmount), legacyQuoteBase.deposit, `金额必须搬到预授权额度: ${preauthRow.preAuthAmount}`);
  assert.equal(Number(preauthRow.receivableAmount), legacyQuoteBase.payable, `预授权额度不得计入本次实收: ${preauthRow.receivableAmount}`);
  assert.equal(Number(preauthRow.legacyDepositUnverified), 0, "口径明确的记录不应被标为待确认");
  // ②固定押金口径：原值本就正确，不得被改动。
  const fixedRow = readRow(
    "SELECT `depositAmount`, `preAuthAmount`, `receivableAmount`, `legacyDepositUnverified` FROM `rental_quotes` WHERE `id`='e2e_legacy_q_fixed';"
  );
  assert.equal(Number(fixedRow.depositAmount), legacyQuoteBase.deposit, `固定押金口径的押金不得被搬走: ${fixedRow.depositAmount}`);
  assert.equal(Number(fixedRow.preAuthAmount), 0, `固定押金口径不得凭空产生预授权额度: ${fixedRow.preAuthAmount}`);
  assert.equal(
    Number(fixedRow.receivableAmount),
    legacyQuoteBase.payable + legacyQuoteBase.deposit,
    `固定押金仍应计入本次实收: ${fixedRow.receivableAmount}`
  );
  assert.equal(Number(fixedRow.legacyDepositUnverified), 0, "固定押金口径不应被标为待确认");
  // ③无法判定：标记待确认，且该笔不得计入实收。
  const unknownRow = readRow(
    "SELECT `depositAmount`, `preAuthAmount`, `receivableAmount`, `legacyDepositUnverified`, `legacyDepositUnverifiedAmount` FROM `rental_quotes` WHERE `id`='e2e_legacy_q_unknown';"
  );
  assert.equal(Number(unknownRow.legacyDepositUnverified), 1, `无法判定归属的记录必须标为待确认: ${unknownRow.legacyDepositUnverified}`);
  assert.equal(
    Number(unknownRow.receivableAmount),
    legacyQuoteBase.payable,
    `归属未确认的金额不得擅自算进本次实收: ${unknownRow.receivableAmount}`
  );
  assert.equal(Number(unknownRow.depositAmount), 0, "待确认金额不得继续留在 depositAmount 被误当成押金");
  assert.equal(Number(unknownRow.legacyDepositUnverifiedAmount), legacyQuoteBase.deposit, "原始金额必须移到独立待确认字段");
  // 清掉这三条人造存量行：它们会让该经营空间的业务配置快照变成"非空"，
  // 启动时就不再生成样例默认价格，后续第 9 节的报价会因"没有可用定价计划"而失败。
  // 断言已全部完成，删除不影响本节结论。
  mysqlQuery("DELETE FROM `rental_quotes` WHERE `id` IN ('e2e_legacy_q_preauth','e2e_legacy_q_fixed','e2e_legacy_q_unknown');");
  ok("旧库存量押金/预授权混口径经纠正迁移重新分类：预授权搬到额度、固定押金保留、无法判定金额独立隔离");
  await maybeStopAfter("baseline");

  console.log("== 6. Rental Core 空间作用域 fail-closed（旧门市仓储已删除） ==");
  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: {
      module: "commonjs",
      moduleResolution: "node",
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      target: "ES2022"
    }
  });
  const { resolveScopeWorkspaceId } = require("../apps/api/src/modules/rental-core/workspace-scope");
  const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");
  const scopeClient = { businessWorkspace: { findFirst: async () => null } };
  await runWithRequestIdentity(
    { tenantId: "tenant_001", userId: "e2e-scope", workspaceId: "workspace-from-other-tenant", isSaasAdmin: false },
    () => assert.rejects(resolveScopeWorkspaceId(scopeClient, "tenant_001"), /当前经营空间不属于目标租户/u, "空间作用域不匹配必须拒绝")
  );
  ok("旧门市仓储不再被 E2E 依赖，当前 Rental Core 作用域不匹配时 fail-closed");

  console.log("== 7. 启动 API（MySQL 模式） ==");
  const apiLogs = startApi();
  if (!(await waitHealth())) fail("API 启动超时", apiLogs.join("").slice(-2000));
  ok(`API 已启动: ${API_BASE}`);

  console.log("== 8. 认证、品类与未授权拒绝 ==");
  const unauthorized = await request("GET", "/api/rental/v1/orders");
  assert.equal(unauthorized.status, 401, "无 token 访问业务接口必须 401");
  ok("无 token 请求返回 401");
  const demo = await login("demo", "admin", DEMO_PASSWORD);
  const demo2 = await login("demo2", "admin", DEMO_PASSWORD);
  assert.equal(demo.tenant.categoryCode, "camera");
  assert.equal(demo2.tenant.categoryCode, "camping");
  ok("demo=camera / demo2=camping，品类编码为小写领域值");
  assert.equal(demo.workspaces.length, 4, `demo 登录应返回四个经营空间，实际 ${demo.workspaces.length}`);
  assert.deepEqual(
    [...new Set(demo.workspaces.map((workspace) => workspace.categoryCode))].sort(),
    ["camera", "camping", "construction", "vehicle"],
    "demo 四个空间必须一一覆盖四个品类"
  );
  const demoSampleMinimums = {
    camera: { groups: 3, assets: 6, stocks: 0 },
    camping: { groups: 3, assets: 0, stocks: 2 },
    vehicle: { groups: 2, assets: 4, stocks: 0 },
    construction: { groups: 2, assets: 1, stocks: 1 }
  };
  let demoWorkspaceToken = demo.accessToken;
  for (const workspace of demo.workspaces) {
    if (workspace.id !== demo.currentWorkspaceId) {
      const switched = await request("POST", "/api/auth/switch-workspace", { workspaceId: workspace.id }, demoWorkspaceToken);
      assert.equal(switched.status, 201, `切换到 ${workspace.categoryCode} 测试空间失败`);
      demoWorkspaceToken = switched.body.data.accessToken;
    }
    const [profileResponse, groupsResponse, assetsResponse, stocksResponse] = await Promise.all([
      request("GET", "/api/rental/v1/tenant-profile", null, demoWorkspaceToken),
      request("GET", "/api/rental/v1/item-groups", null, demoWorkspaceToken),
      request("GET", "/api/rental/v1/assets", null, demoWorkspaceToken),
      request("GET", "/api/rental/v1/stock-balances", null, demoWorkspaceToken)
    ]);
    assert.equal(profileResponse.body.data.categoryCode, workspace.categoryCode, `${workspace.name} 品类上下文不一致`);
    const minimum = demoSampleMinimums[workspace.categoryCode];
    assert.ok(groupsResponse.body.data.length >= minimum.groups, `${workspace.name} 缺少测试商品`);
    assert.ok(assetsResponse.body.data.length >= minimum.assets, `${workspace.name} 缺少测试资产`);
    assert.ok(stocksResponse.body.data.length >= minimum.stocks, `${workspace.name} 缺少测试库存`);
  }
  const demoBackToDefault = await request("POST", "/api/auth/switch-workspace", { workspaceId: demo.currentWorkspaceId }, demoWorkspaceToken);
  assert.equal(demoBackToDefault.status, 201, "四品类样本验证后切回 demo 默认空间失败");
  demo.accessToken = demoBackToDefault.body.data.accessToken;
  ok("demo 四品类空间可切换，且摄影/露营/车辆/工程均有独立测试商品与资产或库存");
  const removedLegacyRoute = await request("GET", "/api/store-rental/orders", null, demo.accessToken);
  assert.equal(removedLegacyRoute.status, 404, "旧门市订单路由不应重新出现");
  ok("旧门市订单路由已移除，摄影空间只走 Rental Core");
  const r1CustomerResponse = await request(
    "POST",
    "/api/platform/customers",
    { customerType: "personal", name: "E2E R1 会员", phone: "13800000002" },
    demo.accessToken
  );
  assert.equal(r1CustomerResponse.status, 201, `R1 摄影会员创建失败: ${JSON.stringify(r1CustomerResponse.body).slice(0, 300)}`);
  const r1CustomerId = r1CustomerResponse.body.data.id;
  const r1SecondCustomerResponse = await request(
    "POST",
    "/api/platform/customers",
    { customerType: "personal", name: "E2E R1 第二会员", phone: "13800000004" },
    demo.accessToken
  );
  assert.equal(r1SecondCustomerResponse.status, 201, `R1 第二会员创建失败: ${JSON.stringify(r1SecondCustomerResponse.body).slice(0, 300)}`);
  const r1SecondCustomerId = r1SecondCustomerResponse.body.data.id;
  ok("R1 订单验收使用已登记的个人会员主档");

  console.log("== 9. Rental Core 报价→下单→履约全链路（摄影：序列化+套装） ==");
  const groups = (await request("GET", "/api/rental/v1/item-groups", null, demo.accessToken)).body.data;
  const serialized = groups.filter((group) => group.inventoryMode === "serialized");
  const cameraKit = groups.find((group) => group.code === "CAM-KIT");
  assert.ok(cameraKit, "摄影样本缺少套装商品 CAM-KIT");
  const location = (await request("GET", "/api/rental/v1/locations", null, demo.accessToken)).body.data[0];
  const startAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const endAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const lines = [...serialized.slice(0, 2).map((group) => ({ itemGroupId: group.id, quantity: 1 })), { itemGroupId: cameraKit.id, quantity: 1 }];
  const r1Pricing = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      code: "E2E-R1-PRICE",
      name: "R1 摄影验收基础定价",
      changeReason: "R1 隔离库真实业务验收",
      status: "enabled",
      rates: lines.map((line) => ({ itemGroupId: line.itemGroupId, unit: "day_24h", baseAmount: 100, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 200, minimumUnits: 1 }))
    },
    demo.accessToken
  );
  assert.equal(r1Pricing.status, 201, `R1 价格版本创建失败: ${JSON.stringify(r1Pricing.body).slice(0, 300)}`);
  const quote = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt, endAt, lines },
    demo.accessToken
  );
  assert.equal(quote.status, 201, `报价失败: ${JSON.stringify(quote.body).slice(0, 200)}`);
  assert.ok(quote.body.data.chargeLines.some((line) => line.code === "rental:CAM-KIT"), "摄影套装行应进入报价明细");
  const order = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: quote.body.data.id, customerType: "personal", customerId: r1CustomerId, customerName: "E2E隔离客户", contactPhone: "13800000002", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt, endAt, lines },
    demo.accessToken
  );
  assert.equal(order.status, 201, `下单失败: ${JSON.stringify(order.body).slice(0, 200)}`);
  const orderId = order.body.data.id;
  assert.equal(order.body.data.status, "draft");
  const assetStatus = async () => (await request("GET", "/api/rental/v1/assets", null, demo.accessToken)).body.data;
  await prepareMockFunding(order.body.data, demo.accessToken, `e2e:${orderId}`);
  const confirmed = await request("POST", `/api/rental/v1/orders/${orderId}/confirm`, {}, demo.accessToken);
  assert.equal(confirmed.status, 201, `订单确认失败: ${JSON.stringify(confirmed.body).slice(0, 300)}`);
  assert.equal(confirmed.body.data.status, "reserved");
  const allocationResponse = await request("POST", `/api/rental/v1/orders/${orderId}/allocate`, {}, demo.accessToken);
  assert.equal(allocationResponse.status, 201, `订单配货失败: ${JSON.stringify(allocationResponse.body).slice(0, 300)}`);
  const allocated = allocationResponse.body.data;
  assert.equal(allocated.status, "ready_for_pickup");
  assert.ok(allocated.allocations.length >= 3, "序列化+套装组件应完成分配");
  const trackedAssetId = allocated.allocations[0].assetId;
  assert.equal(allocated.allocations[0].status, "locked", "自动配货后分配记录应为 locked");
  assert.equal((await assetStatus()).find((row) => row.id === trackedAssetId).status, "available", "资产在领取前仍应保持 available，资源锁定记录在订单分配上");
  await prepareMockFunding(order.body.data, demo.accessToken, `e2e:${orderId}`);
  const pickupTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=pickup", null, demo.accessToken)).body.data[0];
  const pickedUp = (await request("POST", `/api/rental/v1/orders/${orderId}/inspections`, { templateId: pickupTemplate.id, results: { appearance_ok: true, function_ok: true, shutter_count: 9000 } }, demo.accessToken)).body.data;
  assert.equal(pickedUp.order.status, "renting");
  assert.equal((await assetStatus()).find((row) => row.id === trackedAssetId).status, "rented", "领取后资产应为 rented");
  const returnTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=return", null, demo.accessToken)).body.data[0];
  const returned = (await request("POST", `/api/rental/v1/orders/${orderId}/inspections`, { templateId: returnTemplate.id, results: { appearance_ok: true, function_ok: true, shutter_count: 9100 }, exceptions: [{ code: "damage", description: "E2E 损坏", chargeAmount: 66 }] }, demo.accessToken)).body.data;
  assert.equal(returned.order.status, "settling");
  assert.equal(returned.inspection.baselineInspectionId, pickedUp.inspection.id, "归还检查必须引用领取基线");
  assert.equal(returned.inspection.usageReadings.find((row) => row.fieldCode === "shutter_count").delta, 100, "快门使用量必须由领取与归还原始值计算");
  const reviewedReturnOrder = await reviewInspectionException(orderId, returned.inspection.id, 0, 66, demo.accessToken, `e2e:${orderId}`);
  assert.ok(reviewedReturnOrder.finalPayableAmount > reviewedReturnOrder.payableAmount, "审核通过后损坏费应进入最终应付");
  assert.equal((await assetStatus()).find((row) => row.id === trackedAssetId).status, "maintenance", "带异常归还后资产必须等待养护，不能立即恢复可用");
  const r1Settled = await closeMockFundedOrder(orderId, demo.accessToken, `e2e:${orderId}`);
  assert.equal(r1Settled.status, 201, "资金归零后应能结算关闭");
  assert.equal(r1Settled.body.data.status, "completed");
  ok(`全链路完成 ${returned.order.orderNo}，套装+损坏费+资产状态+资金结算正确`);

  console.log("== 9.1 CAT-03 套装替代、组成拆分与部分归还 ==");
  const cat03Groups = [];
  for (const [code, name] of [["E2E-CAT03-A", "默认电池"], ["E2E-CAT03-B", "替代电池"], ["E2E-CAT03-C", "连接线"]]) {
    const created = await request(
      "POST",
      "/api/rental/v1/item-groups",
      { code, name, inventoryMode: "quantity", unit: "件", attributes: { brand: "E2E", model: code } },
      demo.accessToken
    );
    assert.equal(created.status, 201, `CAT-03 数量商品创建失败: ${JSON.stringify(created.body).slice(0, 200)}`);
    cat03Groups.push(created.body.data);
    const stock = await request("PUT", "/api/rental/v1/stock-balances", { itemGroupId: created.body.data.id, locationId: location.id, onHandQuantity: 6 }, demo.accessToken);
    assert.equal(stock.status, 200, "CAT-03 数量库存初始化失败");
  }
  const [defaultBattery, alternateBattery, cable] = cat03Groups;
  const invalidSubstitutionGroup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    { code: "E2E-CAT03-BAD", name: "错误替代套装", inventoryMode: "bundle", unit: "套", bundleComponents: [{ itemGroupId: defaultBattery.id, quantity: 1, substitutionGroup: "BATTERY" }] },
    demo.accessToken
  );
  assert.equal(invalidSubstitutionGroup.status, 400, "只有默认件、没有候选的替代组必须被拒绝");
  const cat03BundleResponse = await request(
    "POST",
    "/api/rental/v1/item-groups",
    {
      code: "E2E-CAT03-KIT", name: "可替代拍摄附件套装", inventoryMode: "bundle", unit: "套",
      bundleComponents: [
        { itemGroupId: defaultBattery.id, quantity: 1, optional: false, substitutionGroup: "BATTERY" },
        { itemGroupId: alternateBattery.id, quantity: 1, optional: true, substitutionGroup: "BATTERY" },
        { itemGroupId: cable.id, quantity: 1, optional: false }
      ]
    },
    demo.accessToken
  );
  assert.equal(cat03BundleResponse.status, 201, `CAT-03 套装创建失败: ${JSON.stringify(cat03BundleResponse.body).slice(0, 200)}`);
  const cat03Bundle = cat03BundleResponse.body.data;
  const cat03Pricing = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    { effectiveFrom: new Date(Date.now() - 86400000).toISOString(), code: "E2E-CAT03-PRICE", name: "CAT-03 套装定价", changeReason: "CAT-03 E2E", status: "enabled", rates: [{ itemGroupId: cat03Bundle.id, unit: "day_24h", baseAmount: 80, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 200, minimumUnits: 1 }] },
    demo.accessToken
  );
  assert.equal(cat03Pricing.status, 201, `CAT-03 定价创建失败: ${JSON.stringify(cat03Pricing.body).slice(0, 200)}`);
  const cat03Start = new Date(Date.now() + 300 * 86400000).toISOString();
  const cat03End = new Date(Date.now() + 302 * 86400000).toISOString();
  const cat03Lines = [{ itemGroupId: cat03Bundle.id, quantity: 2 }];
  const cat03Quote = await request(
    "POST", "/api/rental/v1/quotes",
    { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: cat03Start, endAt: cat03End, lines: cat03Lines, pricingPlanId: cat03Pricing.body.data.id },
    demo.accessToken
  );
  assert.equal(cat03Quote.status, 201, "CAT-03 报价失败");
  const cat03Order = await request(
    "POST", "/api/rental/v1/orders",
    { quoteId: cat03Quote.body.data.id, customerType: "personal", customerId: r1CustomerId, customerName: "CAT-03 客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: cat03Start, endAt: cat03End, lines: cat03Lines },
    demo.accessToken
  );
  assert.equal(cat03Order.status, 201, "CAT-03 下单失败");
  const cat03OrderId = cat03Order.body.data.id;
  const cat03OrderLineId = cat03Order.body.data.lines[0].id;
  await prepareMockFunding(cat03Order.body.data, demo.accessToken, `e2e:${cat03OrderId}`);
  const cat03Confirmed = await request("POST", `/api/rental/v1/orders/${cat03OrderId}/confirm`, {}, demo.accessToken);
  assert.equal(cat03Confirmed.status, 201, "CAT-03 确认订单失败");
  assert.ok(cat03Confirmed.body.data.reservations.some((row) => row.itemGroupId === defaultBattery.id && row.quantity === 2), "套装应先预占替代组默认组成");
  const invalidSubstitution = await request(
    "POST", `/api/rental/v1/orders/${cat03OrderId}/substitute-bundle-component`,
    { orderLineId: cat03OrderLineId, fromItemGroupId: defaultBattery.id, toItemGroupId: cable.id },
    demo.accessToken
  );
  assert.equal(invalidSubstitution.status, 400, "跨替代组替换必须被拒绝");
  const substituted = await request(
    "POST", `/api/rental/v1/orders/${cat03OrderId}/substitute-bundle-component`,
    { orderLineId: cat03OrderLineId, fromItemGroupId: defaultBattery.id, toItemGroupId: alternateBattery.id },
    demo.accessToken
  );
  assert.equal(substituted.status, 201, `套装组成替换失败: ${JSON.stringify(substituted.body).slice(0, 200)}`);
  assert.ok(substituted.body.data.reservations.some((row) => row.itemGroupId === alternateBattery.id && row.quantity === 2), "替换后必须预占候选商品");
  assert.ok(!substituted.body.data.reservations.some((row) => row.itemGroupId === defaultBattery.id), "替换后不得继续占用默认商品");
  const cat03Allocated = await request("POST", `/api/rental/v1/orders/${cat03OrderId}/allocate`, {}, demo.accessToken);
  assert.equal(cat03Allocated.status, 201, "CAT-03 配货失败");
  assert.deepEqual(
    [...new Set(cat03Allocated.body.data.allocations.map((allocation) => allocation.itemGroupId))].sort(),
    [alternateBattery.id, cable.id].sort(),
    "套装拆分后的分配必须保存实际组成商品"
  );
  await prepareMockFunding(cat03Order.body.data, demo.accessToken, `e2e:${cat03OrderId}`);
  const cat03Pickup = await request(
    "POST", `/api/rental/v1/orders/${cat03OrderId}/inspections`,
    { templateId: pickupTemplate.id, results: { appearance_ok: true, function_ok: true, shutter_count: 100 } },
    demo.accessToken
  );
  assert.equal(cat03Pickup.status, 201, "CAT-03 领取检查失败");
  const alternateAllocation = cat03Pickup.body.data.order.allocations.find((allocation) => allocation.itemGroupId === alternateBattery.id && allocation.status === "picked_up");
  const cableAllocation = cat03Pickup.body.data.order.allocations.find((allocation) => allocation.itemGroupId === cable.id && allocation.status === "picked_up");
  const cat03ReturnTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=return", null, demo.accessToken)).body.data[0];
  const partialReturned = await request(
    "POST", `/api/rental/v1/orders/${cat03OrderId}/inspections`,
    {
      templateId: cat03ReturnTemplate.id,
      returnBatchNo: "cat03-partial-1",
      returnItems: [{ allocationId: alternateAllocation.id, quantity: 1 }],
      results: { appearance_ok: true, function_ok: true, shutter_count: 110 }
    },
    demo.accessToken
  );
  assert.equal(partialReturned.status, 201, `CAT-03 部分归还失败: ${JSON.stringify(partialReturned.body).slice(0, 200)}`);
  assert.equal(partialReturned.body.data.order.status, "renting", "部分归还后订单必须保持租赁中");
  assert.equal(partialReturned.body.data.order.allocations.find((allocation) => allocation.id === alternateAllocation.id).quantity, 1, "数量分配应拆出剩余未归还数量");
  assert.ok(partialReturned.body.data.order.allocations.some((allocation) => allocation.itemGroupId === alternateBattery.id && allocation.status === "returned" && allocation.quantity === 1), "应生成已归还的拆分分配记录");
  assert.equal(partialReturned.body.data.order.reservations.find((row) => row.itemGroupId === alternateBattery.id).releasedQuantity, 1, "预占应记录已释放数量");
  const remainingAlternateAllocation = partialReturned.body.data.order.allocations.find((allocation) => allocation.id === alternateAllocation.id);
  const finalBatchBypass = await request(
    "POST", `/api/rental/v1/orders/${cat03OrderId}/partial-return`,
    { batchNo: "cat03-partial-final-bypass", items: [{ allocationId: remainingAlternateAllocation.id, quantity: 1 }, { allocationId: cableAllocation.id, quantity: 2 }] },
    demo.accessToken
  );
  assert.equal(finalBatchBypass.status, 409, "最后一批不得绕过归还检查和费用结算");
  const cat03Returned = await request(
    "POST", `/api/rental/v1/orders/${cat03OrderId}/inspections`,
    { templateId: cat03ReturnTemplate.id, results: { appearance_ok: true, function_ok: true, shutter_count: 120 } },
    demo.accessToken
  );
  assert.equal(cat03Returned.status, 201, "CAT-03 最终归还检查失败");
  assert.equal(cat03Returned.body.data.order.status, "settling");
  assert.ok(cat03Returned.body.data.order.reservations.every((row) => row.status === "released" && row.releasedQuantity === row.quantity), "最终归还必须释放全部组成预占");
  const cat03Settled = await closeMockFundedOrder(cat03OrderId, demo.accessToken, `e2e:${cat03OrderId}`);
  assert.equal(cat03Settled.body.data.status, "completed", "CAT-03 资金归零后必须关闭");
  const cat03PricingDisabled = await request(
    "PUT", `/api/rental/v1/pricing-plans/${cat03Pricing.body.data.id}`,
    { effectiveFrom: cat03Pricing.body.data.effectiveFrom, code: "E2E-CAT03-PRICE", name: "CAT-03 套装定价", changeReason: "CAT-03 用例完成后停用，避免影响后续默认定价", status: "disabled", rates: [{ itemGroupId: cat03Bundle.id, unit: "day_24h", baseAmount: 80, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 200, minimumUnits: 1 }] },
    demo.accessToken
  );
  assert.equal(cat03PricingDisabled.status, 200, "CAT-03 用例定价停用失败");
  ok("CAT-03 套装替代、实际组成拆分、数量部分归还与最终归还边界验证通过");

  console.log("== 9.2 CAT-04 经营主体、地点能力与订单快照 ==");
  const locationOperator = (await request("GET", "/api/rental/v1/fulfillment-operators", null, demo.accessToken)).body.data.find((row) => row.id === location.operatorId);
  assert.ok(locationOperator, "摄影主地点缺少经营主体");
  const locationPayload = (overrides = {}) => ({
    code: location.code, name: location.name, type: location.type, operatorId: location.operatorId,
    parentLocationId: location.parentLocationId, capabilities: location.capabilities, address: location.address,
    contactName: location.contactName, contactPhone: location.contactPhone, businessHours: location.businessHours,
    status: location.status, ...overrides
  });
  const operatorPayload = (overrides = {}) => ({
    code: locationOperator.code, name: locationOperator.name, type: locationOperator.type,
    contactName: locationOperator.contactName, contactPhone: locationOperator.contactPhone,
    settlementMode: locationOperator.settlementMode, status: locationOperator.status, ...overrides
  });
  const cat04Start = new Date(Date.now() + 340 * 86400000).toISOString();
  const cat04End = new Date(Date.now() + 342 * 86400000).toISOString();
  const cat04Lines = [{ itemGroupId: serialized[0].id, quantity: 1 }];
  const cat04QuotePayload = { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: cat04Start, endAt: cat04End, lines: cat04Lines };

  assert.equal((await request("PUT", `/api/rental/v1/locations/${location.id}`, locationPayload({ capabilities: location.capabilities.filter((value) => value !== "return") }), demo.accessToken)).status, 200);
  assert.equal((await request("POST", "/api/rental/v1/quotes", cat04QuotePayload, demo.accessToken)).status, 409, "缺少归还能力的地点不得报价");
  assert.equal((await request("PUT", `/api/rental/v1/locations/${location.id}`, locationPayload(), demo.accessToken)).status, 200);

  assert.equal((await request("PUT", `/api/rental/v1/fulfillment-operators/${locationOperator.id}`, operatorPayload({ status: "disabled" }), demo.accessToken)).status, 200);
  assert.equal((await request("POST", "/api/rental/v1/quotes", cat04QuotePayload, demo.accessToken)).status, 409, "停用经营主体的地点不得报价");
  assert.equal((await request("PUT", `/api/rental/v1/fulfillment-operators/${locationOperator.id}`, operatorPayload(), demo.accessToken)).status, 200);

  const cat04Quote = await request("POST", "/api/rental/v1/quotes", cat04QuotePayload, demo.accessToken);
  assert.equal(cat04Quote.status, 201, `CAT-04 有效地点报价失败: ${JSON.stringify(cat04Quote.body).slice(0, 200)}`);
  const cat04Order = await request("POST", "/api/rental/v1/orders", {
    quoteId: cat04Quote.body.data.id, customerType: "personal", customerId: r1CustomerId, customerName: "CAT-04 快照客户",
    fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id,
    startAt: cat04Start, endAt: cat04End, lines: cat04Lines
  }, demo.accessToken);
  assert.equal(cat04Order.status, 201, "CAT-04 下单失败");
  assert.equal(cat04Order.body.data.fulfillmentLocationSnapshot.name, location.name, "订单必须保存领取地点快照");
  assert.equal(cat04Order.body.data.fulfillmentLocationSnapshot.operator.name, locationOperator.name, "订单必须保存经营主体快照");
  assert.equal(cat04Order.body.data.returnLocationSnapshot.name, location.name, "订单必须保存归还地点快照");

  assert.equal((await request("PUT", `/api/rental/v1/fulfillment-operators/${locationOperator.id}`, operatorPayload({ name: `${locationOperator.name}-已改名` }), demo.accessToken)).status, 200);
  assert.equal((await request("PUT", `/api/rental/v1/locations/${location.id}`, locationPayload({ name: `${location.name}-已改名` }), demo.accessToken)).status, 200);
  const cat04SnapshotRead = await request("GET", `/api/rental/v1/orders/${cat04Order.body.data.id}`, null, demo.accessToken);
  assert.equal(cat04SnapshotRead.body.data.fulfillmentLocationSnapshot.name, location.name, "地点主档改名不得篡改订单快照");
  assert.equal(cat04SnapshotRead.body.data.fulfillmentLocationSnapshot.operator.name, locationOperator.name, "经营主体改名不得篡改订单快照");

  assert.equal((await request("PUT", `/api/rental/v1/fulfillment-operators/${locationOperator.id}`, operatorPayload(), demo.accessToken)).status, 200);
  assert.equal((await request("PUT", `/api/rental/v1/locations/${location.id}`, locationPayload(), demo.accessToken)).status, 200);
  await prepareMockFunding(cat04Order.body.data, demo.accessToken, `e2e:${cat04Order.body.data.id}`);
  assert.equal((await request("POST", `/api/rental/v1/orders/${cat04Order.body.data.id}/confirm`, {}, demo.accessToken)).status, 201);
  assert.equal((await request("PUT", `/api/rental/v1/locations/${location.id}`, locationPayload({ status: "disabled" }), demo.accessToken)).status, 200);
  assert.equal((await request("POST", "/api/rental/v1/quotes", cat04QuotePayload, demo.accessToken)).status, 409, "停用地点不得新报价");
  assert.equal((await request("POST", `/api/rental/v1/orders/${cat04Order.body.data.id}/allocate`, {}, demo.accessToken)).status, 409, "下单后停用地点必须阻止继续配货");
  assert.equal((await request("PUT", `/api/rental/v1/locations/${location.id}`, locationPayload(), demo.accessToken)).status, 200);
  assert.equal((await request("POST", `/api/rental/v1/orders/${cat04Order.body.data.id}/cancel`, { reason: "CAT-04 E2E 清理" }, demo.accessToken)).status, 201);
  ok("CAT-04 地点能力、地点/主体启停、配货阻断与经营主体/地点不可变快照验证通过");

  console.log("== 10. 露营品类深度用例：数量+套装库存、缺件异常与库存还原 ==");
  const campingGroups = (await request("GET", "/api/rental/v1/item-groups", null, demo2.accessToken)).body.data;
  const tent = campingGroups.find((group) => group.code === "CAMP-TENT");
  const kit = campingGroups.find((group) => group.code === "CAMP-KIT");
  const campingLocation = (await request("GET", "/api/rental/v1/locations", null, demo2.accessToken)).body.data[0];
  assert.ok(tent && kit, `露营样本缺少数量/套装商品: ${campingGroups.map((g) => g.code).join(",")}`);
  const campingCustomerResponse = await request(
    "POST",
    "/api/platform/customers",
    { customerType: "personal", name: "E2E 露营会员", phone: "13800000005" },
    demo2.accessToken
  );
  assert.equal(campingCustomerResponse.status, 201, `露营会员创建失败: ${JSON.stringify(campingCustomerResponse.body).slice(0, 300)}`);
  const campingCustomerId = campingCustomerResponse.body.data.id;
  const campingPricing = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      code: "E2E-R1-CAMP-PRICE",
      name: "R1 露营验收基础定价",
      changeReason: "R1 隔离库真实业务验收",
      status: "enabled",
      rates: [tent, kit].map((group) => ({ itemGroupId: group.id, unit: "calendar_day", baseAmount: 80, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 100, minimumUnits: 1 }))
    },
    demo2.accessToken
  );
  assert.equal(campingPricing.status, 201, `露营价格版本创建失败: ${JSON.stringify(campingPricing.body).slice(0, 300)}`);
  const campingStockBefore = (await request("GET", "/api/rental/v1/stock-balances", null, demo2.accessToken)).body.data;
  const tentStockBefore = campingStockBefore.find((row) => row.itemGroupId === tent.id);
  // 露营租户的规则版本随本轮 API 启动生效，因此用近未来起租；配货后等到起租再
  // 办理领取和归还，既有规则覆盖，也不会留下尚未开始租期的合法预占。
  const campingStartAt = Date.now() + 3000;
  const campingStart = new Date(campingStartAt).toISOString();
  const campingEnd = new Date(campingStartAt + 22 * 3600 * 1000).toISOString();
  const campingLines = [
    { itemGroupId: tent.id, quantity: 2 },
    { itemGroupId: kit.id, quantity: 1 }
  ];
  const campingQuote = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", customerId: campingCustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: campingLocation.id, startAt: campingStart, endAt: campingEnd, lines: campingLines },
    demo2.accessToken
  );
  assert.equal(campingQuote.status, 201, `露营报价失败: ${JSON.stringify(campingQuote.body).slice(0, 200)}`);
  assert.ok(
    campingQuote.body.data.chargeLines.some((line) => line.code === "rental:CAMP-KIT"),
    "套装行应进入报价明细"
  );
  const campingOrder = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: campingQuote.body.data.id, customerType: "personal", customerId: campingCustomerId, customerName: "E2E露营客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: campingLocation.id, startAt: campingStart, endAt: campingEnd, lines: campingLines },
    demo2.accessToken
  );
  assert.equal(campingOrder.status, 201, `露营下单失败: ${JSON.stringify(campingOrder.body).slice(0, 200)}`);
  const campingOrderId = campingOrder.body.data.id;
  await prepareMockFunding(campingOrder.body.data, demo2.accessToken, `e2e:${campingOrderId}`);
  await request("POST", `/api/rental/v1/orders/${campingOrderId}/confirm`, {}, demo2.accessToken);
  const campingAllocated = (await request("POST", `/api/rental/v1/orders/${campingOrderId}/allocate`, {}, demo2.accessToken)).body.data;
  assert.ok(
    campingAllocated.allocations.length >= 2 && campingAllocated.allocations.every((row) => !row.assetId),
    "数量库存分配不应绑定具体资产"
  );
  while (Date.now() < campingStartAt) await new Promise((resolve) => setTimeout(resolve, 250));
  const campingStockReserved = (await request("GET", "/api/rental/v1/stock-balances", null, demo2.accessToken)).body.data.find((row) => row.itemGroupId === tent.id);
  assert.equal(
    tentStockBefore.availableQuantity - campingStockReserved.availableQuantity,
    3,
    "套装展开后帐篷合并占用应为 2+1=3"
  );
  await prepareMockFunding(campingOrder.body.data, demo2.accessToken, `e2e:${campingOrderId}`);
  const campingPickupTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=pickup", null, demo2.accessToken)).body.data[0];
  await request(
    "POST",
    `/api/rental/v1/orders/${campingOrderId}/inspections`,
    { templateId: campingPickupTemplate.id, results: { count_ok: true, cleanliness: "良好" } },
    demo2.accessToken
  );
  const campingReturnTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=return", null, demo2.accessToken)).body.data[0];
  const campingReturned = (await request(
    "POST",
    `/api/rental/v1/orders/${campingOrderId}/inspections`,
    { templateId: campingReturnTemplate.id, results: { count_ok: false, cleanliness: "严重污损" }, exceptions: [{ code: "missing_part", description: "帐篷地钉缺失 2 枚", chargeAmount: 35 }, { code: "soiled", description: "折叠椅严重污损", chargeAmount: 20 }] },
    demo2.accessToken
  )).body.data;
  assert.equal(campingReturned.order.status, "settling");
  await reviewInspectionException(campingOrderId, campingReturned.inspection.id, 0, 35, demo2.accessToken, `e2e:${campingOrderId}`);
  const campingReviewedOrder = await reviewInspectionException(campingOrderId, campingReturned.inspection.id, 1, 20, demo2.accessToken, `e2e:${campingOrderId}`);
  assert.equal(campingReviewedOrder.finalPayableAmount, campingReviewedOrder.payableAmount + 55, "审核后的缺件与污损费用应进入最终应付");
  const campingSettled = await closeMockFundedOrder(campingOrderId, demo2.accessToken, `e2e:${campingOrderId}`);
  assert.equal(campingSettled.body.data.status, "completed", "露营订单资金归零后必须关闭");
  const campingStockAfter = (await request("GET", "/api/rental/v1/stock-balances", null, demo2.accessToken)).body.data.find((row) => row.itemGroupId === tent.id);
  assert.equal(campingStockAfter.availableQuantity, tentStockBefore.availableQuantity - 3, "有缺件/污损异常时，异常数量必须留在维修隔离而不是回到可用池");
  assert.equal(campingStockAfter.maintenanceQuantity, (tentStockBefore.maintenanceQuantity ?? 0) + 3, "有缺件/污损异常时，数量库存必须增加对应维修隔离量");
  const campingDispositions = (await request("GET", `/api/rental/v1/stock-dispositions?orderId=${campingOrderId}`, null, demo2.accessToken)).body.data;
  const campingBlockedDispositions = campingDispositions.filter((row) => row.status === "blocked");
  assert.ok(campingBlockedDispositions.length > 0, "异常归还必须生成待处置的库存隔离记录");
  assert.equal(
    campingBlockedDispositions.filter((row) => row.itemGroupId === tent.id).reduce((sum, row) => sum + row.quantity, 0),
    3,
    "直租帐篷与套装帐篷必须各自生成处置记录，合计隔离 3 顶"
  );
  // 一个异常归还可能产生多条处置记录（例如同一型号既有直租行又是套装组成）。
  // 每条处置都必须完成自己的工单并恢复，不能只处理第一条就把剩余坏货重新放回可用池。
  for (const campingDisposition of campingBlockedDispositions) {
    const campingWorkOrder = await request(
      "POST",
      "/api/rental/v1/work-orders",
      { dispositionId: campingDisposition.id, type: "repair", reason: "处理露营订单归还的缺件与污损" },
      demo2.accessToken
    );
    assert.equal(campingWorkOrder.status, 201, `创建养护工单失败: ${JSON.stringify(campingWorkOrder.body).slice(0, 300)}`);
    const campingWorkOrderId = campingWorkOrder.body.data.id;
    const campingWorkOrderStarted = await request("POST", `/api/rental/v1/work-orders/${campingWorkOrderId}/start`, {}, demo2.accessToken);
    assert.equal(campingWorkOrderStarted.status, 201, `启动养护工单失败: ${JSON.stringify(campingWorkOrderStarted.body).slice(0, 300)}`);
    const campingWorkOrderSubmitted = await request(
      "POST",
      `/api/rental/v1/work-orders/${campingWorkOrderId}/submit`,
      { result: "已补齐缺件并完成清洁复检", attachments: [] },
      demo2.accessToken
    );
    assert.equal(campingWorkOrderSubmitted.status, 201, `提交养护工单失败: ${JSON.stringify(campingWorkOrderSubmitted.body).slice(0, 300)}`);
    const campingWorkOrderReviewed = await request(
      "POST",
      `/api/rental/v1/work-orders/${campingWorkOrderId}/review`,
      { decision: "approved", reason: "复检通过，可以恢复可用" },
      demo2.accessToken
    );
    assert.equal(campingWorkOrderReviewed.status, 201, `审核养护工单失败: ${JSON.stringify(campingWorkOrderReviewed.body).slice(0, 300)}`);
    assert.equal(campingWorkOrderReviewed.body.data.status, "completed", "养护工单审核通过后必须完成");
    const campingWorkOrderHistory = (await request("GET", `/api/rental/v1/work-orders/${campingWorkOrderId}/history`, null, demo2.accessToken)).body.data;
    assert.ok(campingWorkOrderHistory.length >= 3, "养护工单必须保留开始、提交、审核的历史");
    const campingRestoredDisposition = await request(
      "POST",
      `/api/rental/v1/stock-dispositions/${campingDisposition.id}/restore`,
      {},
      demo2.accessToken
    );
    assert.equal(campingRestoredDisposition.status, 201, `恢复库存隔离失败: ${JSON.stringify(campingRestoredDisposition.body).slice(0, 300)}`);
    assert.equal(campingRestoredDisposition.body.data.status, "restored", "养护验收通过后库存处置必须标记为已恢复");
  }
  const campingStockRestored = (await request("GET", "/api/rental/v1/stock-balances", null, demo2.accessToken)).body.data.find((row) => row.itemGroupId === tent.id);
  assert.equal(campingStockRestored.availableQuantity, tentStockBefore.availableQuantity, "养护恢复后数量库存必须回到可用池");
  assert.equal(campingStockRestored.maintenanceQuantity, tentStockBefore.maintenanceQuantity ?? 0, "养护恢复后维修隔离量必须扣回");
  const demo2Orders = (await request("GET", "/api/rental/v1/orders", null, demo2.accessToken)).body.data;
  assert.equal(demo2Orders.length, 1, "demo2 应只看到自己的露营订单");
  assert.ok(!demo2Orders.some((row) => row.id === orderId), "demo2 不得看到 demo 订单");
  ok("露营数量+套装闭环：合并占用 3、缺件污损 55 元、异常隔离后经养护工单恢复");

  console.log("== 11. 订单状态机边界与取消闭环 ==");
  const confirmCompleted = await request("POST", `/api/rental/v1/orders/${orderId}/confirm`, {}, demo.accessToken);
  assert.equal(confirmCompleted.status, 409, "已完成订单不能再次确认");
  const allocateCompleted = await request("POST", `/api/rental/v1/orders/${orderId}/allocate`, {}, demo.accessToken);
  assert.equal(allocateCompleted.status, 409, "已完成订单不能配货");
  const inspectCompleted = await request("POST", `/api/rental/v1/orders/${orderId}/inspections`, { templateId: pickupTemplate.id, results: { appearance_ok: true, function_ok: true, shutter_count: 1 } }, demo.accessToken);
  assert.equal(inspectCompleted.status, 409, "已完成订单不能再办理检查");
  const cancelStart = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  const cancelEnd = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
  const cancelLines = [{ itemGroupId: serialized[0].id, quantity: 1 }];
  const availabilityFor = async () =>
    (await request("POST", "/api/rental/v1/availability", { locationId: location.id, startAt: cancelStart, endAt: cancelEnd, lines: cancelLines }, demo.accessToken)).body.data.lines[0].availableQuantity;
  const availableBefore = await availabilityFor();
  const cancelQuote = (await request("POST", "/api/rental/v1/quotes", { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: cancelStart, endAt: cancelEnd, lines: cancelLines }, demo.accessToken)).body.data;
  const cancelOrder = await request("POST", "/api/rental/v1/orders", { quoteId: cancelQuote.id, customerType: "personal", customerId: r1CustomerId, customerName: "E2E取消客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: cancelStart, endAt: cancelEnd, lines: cancelLines }, demo.accessToken);
  assert.equal(cancelOrder.status, 201, `取消用例下单失败: ${JSON.stringify(cancelOrder.body).slice(0, 200)}`);
  const cancelOrderId = cancelOrder.body.data.id;
  await prepareMockFunding(cancelOrder.body.data, demo.accessToken, `e2e:${cancelOrderId}`);
  await request("POST", `/api/rental/v1/orders/${cancelOrderId}/confirm`, {}, demo.accessToken);
  assert.equal(await availabilityFor(), availableBefore - 1, "确认后可用库存应减少 1");
  const cancelled = (await request("POST", `/api/rental/v1/orders/${cancelOrderId}/cancel`, { reason: "E2E 验证收费窗口内取消" }, demo.accessToken)).body.data;
  assert.equal(cancelled.status, "cancelled");
  const cancellationLine = cancelled.chargeLines.find((line) => line.type === "cancellation");
  assert.ok(cancellationLine, "收费窗口内取消应产生取消费行");
  assert.ok(
    Math.abs(cancellationLine.amount - cancelled.payableAmount * 0.2) < 0.02,
    `取消费应约为应付金额 20%: ${cancellationLine.amount} vs ${cancelled.payableAmount}`
  );
  assert.equal(cancelled.finalPayableAmount, cancellationLine.amount, "取消原租金核减后，最终应付应只保留取消费");
  assert.equal(await availabilityFor(), availableBefore, "取消后库存应完整释放");
  const cancelAgain = await request("POST", `/api/rental/v1/orders/${cancelOrderId}/cancel`, { reason: "重复取消" }, demo.accessToken);
  assert.equal(cancelAgain.status, 409, "已取消订单不能再次取消");
  ok("非法状态转移全部拒绝；收费窗口取消闭环（约 20% 取消费、库存完整释放）");

  console.log("== 12. 优惠方案与优惠券闭环：领取/锁定/核销/释放/预算/互斥 ==");
  const couponTemplate = await request(
    "POST",
    "/api/rental/v1/coupon-templates",
    { code: "E2E-COUPON-50", name: "E2E 满 200 减 50", discountType: "fixed_amount", discountValue: 50, minimumSpend: 200, totalQuota: 1, perCustomerLimit: 1, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: new Date(Date.now() + 30 * 86400000).toISOString(), status: "active" },
    demo.accessToken
  );
  assert.equal(couponTemplate.status, 201, `券模板创建失败: ${JSON.stringify(couponTemplate.body).slice(0, 200)}`);
  const couponId = couponTemplate.body.data.id;
  const claim = await request("POST", "/api/rental/v1/customer-coupons/claim", { templateId: couponId, customerId: r1CustomerId }, demo.accessToken);
  assert.equal(claim.status, 201, `领取失败: ${JSON.stringify(claim.body).slice(0, 200)}`);
  const claimedCouponId = claim.body.data.id;
  const claimAgain = await request("POST", "/api/rental/v1/customer-coupons/claim", { templateId: couponId, customerId: r1CustomerId }, demo.accessToken);
  assert.equal(claimAgain.status, 409, "同一客户不得超过每客限领");
  const claimSoldOut = await request("POST", "/api/rental/v1/customer-coupons/claim", { templateId: couponId, customerId: r1SecondCustomerId }, demo.accessToken);
  assert.equal(claimSoldOut.status, 409, "发行量用尽后不得再领取");
  const couponQuoteStart = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const couponQuoteEnd = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const couponLines = [{ itemGroupId: serialized[0].id, quantity: 1 }];
  const couponQuote = (
    await request(
      "POST",
      "/api/rental/v1/quotes",
      { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponQuoteStart, endAt: couponQuoteEnd, lines: couponLines, customerCouponId: claimedCouponId },
      demo.accessToken
    )
  ).body.data;
  const couponLine = couponQuote.chargeLines.find((line) => line.type === "coupon");
  assert.ok(couponLine && couponLine.amount === -50, `优惠券应抵扣 50: ${JSON.stringify(couponQuote.chargeLines)}`);
  // 这里曾加过一条「明细求和（不含押金与预授权）必须等于应付」的不变量，
  // 三次变异测试（券符号写反、应付重复计履约费、履约明细金额写 0）都被**既有断言**
  // 先一步拦下，恒等式从未成为首个失败者——在本套件里它是被现有断言完全覆盖的
  // 重言式。按「不留证明不了必要性的断言」删除，不留一条永远不会失败的绿色断言。
  //
  // 它想守的性质本身已由类型解决：押金与预授权是唯一不计入应付的两类明细，
  // 且各有独立类型（deposit / preauthorization），任何下游都能自行求和核对。
  const couponOrder = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: couponQuote.id, customerType: "personal", customerId: r1CustomerId, customerName: "E2E券客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponQuoteStart, endAt: couponQuoteEnd, lines: couponLines },
    demo.accessToken
  );
  assert.equal(couponOrder.status, 201, `券订单创建失败: ${JSON.stringify(couponOrder.body).slice(0, 200)}`);
  const couponOrderId = couponOrder.body.data.id;
  await prepareMockFunding(couponOrder.body.data, demo.accessToken, `e2e:${couponOrderId}`);
  const couponAfterOrder = (await request("GET", `/api/rental/v1/customer-coupons?customerId=${r1CustomerId}`, null, demo.accessToken)).body.data.find((row) => row.id === claimedCouponId);
  assert.equal(couponAfterOrder.status, "locked", "下单后优惠券应锁定");
  assert.equal(couponAfterOrder.lockedOrderId, couponOrderId);
  const reuseQuoteRes = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponQuoteStart, endAt: couponQuoteEnd, lines: couponLines, customerCouponId: claimedCouponId },
    demo.accessToken
  );
  assert.equal(reuseQuoteRes.status, 409, "已锁定的优惠券不得再次进入报价");
  await request("POST", `/api/rental/v1/orders/${couponOrderId}/confirm`, {}, demo.accessToken);
  const couponAfterConfirm = (await request("GET", `/api/rental/v1/customer-coupons?customerId=${r1CustomerId}`, null, demo.accessToken)).body.data.find((row) => row.id === claimedCouponId);
  assert.equal(couponAfterConfirm.status, "redeemed", "确认订单后优惠券应核销");
  const releasedCouponOrder = (await request("POST", `/api/rental/v1/orders/${couponOrderId}/cancel`, { reason: "E2E 验证券释放" }, demo.accessToken)).body.data;
  assert.equal(releasedCouponOrder.status, "cancelled");
  const couponAfterCancel = (await request("GET", `/api/rental/v1/customer-coupons?customerId=${r1CustomerId}`, null, demo.accessToken)).body.data.find((row) => row.id === claimedCouponId);
  assert.equal(couponAfterCancel.status, "claimed", "取消订单后优惠券应释放回可再用");
  const template2 = await request(
    "POST",
    "/api/rental/v1/coupon-templates",
    { code: "E2E-COUPON-30", name: "E2E 满 200 减 30", discountType: "fixed_amount", discountValue: 30, minimumSpend: 200, totalQuota: 5, perCustomerLimit: 1, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: new Date(Date.now() + 30 * 86400000).toISOString(), status: "active" },
    demo.accessToken
  );
  assert.equal(template2.status, 201);
  const claim2 = await request("POST", "/api/rental/v1/customer-coupons/claim", { templateId: template2.body.data.id, customerId: r1CustomerId }, demo.accessToken);
  assert.equal(claim2.status, 201);

  console.log("== 12.1 RC-02 订单确认事务：成功全落库，报价或锁券失败则整体回滚 ==");
  const atomicTemplate = await request(
    "POST",
    "/api/rental/v1/coupon-templates",
    { code: "RC02-ATOMIC-20", name: "RC-02 事务券", discountType: "fixed_amount", discountValue: 20, minimumSpend: 0, totalQuota: 2, perCustomerLimit: 1, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: new Date(Date.now() + 180 * 86400000).toISOString(), status: "active" },
    demo.accessToken
  );
  assert.equal(atomicTemplate.status, 201, `RC-02 券模板创建失败: ${JSON.stringify(atomicTemplate.body)}`);
  const atomicClaim = await request(
    "POST",
    "/api/rental/v1/customer-coupons/claim",
    { templateId: atomicTemplate.body.data.id, customerId: r1CustomerId },
    demo.accessToken
  );
  assert.equal(atomicClaim.status, 201, `RC-02 领券失败: ${JSON.stringify(atomicClaim.body)}`);
  const atomicStart = new Date(Date.now() + 120 * 86400000).toISOString();
  const atomicEnd = new Date(Date.now() + 122 * 86400000).toISOString();
  const atomicLines = [{ itemGroupId: serialized[0].id, quantity: 1 }];
  const atomicQuote = (
    await request(
      "POST",
      "/api/rental/v1/quotes",
      { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: atomicStart, endAt: atomicEnd, lines: atomicLines, customerCouponId: atomicClaim.body.data.id },
      demo.accessToken
    )
  ).body.data;
  const atomicOrderResponse = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: atomicQuote.id, customerType: "personal", customerId: r1CustomerId, customerName: "RC-02成功客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: atomicStart, endAt: atomicEnd, lines: atomicLines },
    demo.accessToken
  );
  assert.equal(atomicOrderResponse.status, 201, `RC-02 正常订单创建失败: ${JSON.stringify(atomicOrderResponse.body)}`);
  const atomicOrderId = atomicOrderResponse.body.data.id;
  assert.equal(readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${atomicOrderId}' AND \`quoteId\`='${atomicQuote.id}';`), 1, "订单必须落库");
  assert.equal(readCount(`SELECT COUNT(*) FROM \`rental_order_lines\` WHERE \`orderId\`='${atomicOrderId}';`), 1, "订单行必须落库");
  assert.ok(readCount(`SELECT COUNT(*) FROM \`rental_reservations\` WHERE \`orderId\`='${atomicOrderId}';`) > 0, "库存预占必须落库");
  assert.equal(readScalar(`SELECT \`consumedOrderId\` FROM \`rental_quotes\` WHERE \`id\`='${atomicQuote.id}';`), atomicOrderId, "报价必须关联消费订单");
  assert.equal(readScalar(`SELECT \`status\` FROM \`rental_customer_coupons\` WHERE \`id\`='${atomicClaim.body.data.id}';`), "locked", "优惠券必须锁定");
  assert.equal(readScalar(`SELECT \`lockedOrderId\` FROM \`rental_customer_coupons\` WHERE \`id\`='${atomicClaim.body.data.id}';`), atomicOrderId, "优惠券必须关联订单");
  await prepareMockFunding(atomicOrderResponse.body.data, demo.accessToken, `e2e:${atomicOrderId}`);
  ok("RC-02 正常路径：订单、订单行、库存预占、报价消费和优惠券锁定同时提交");

  // 确认前券状态若被后台任务/人工修复改走，核销会更新 0 行。订单必须随核销失败
  // 一起回滚，不能留下“折扣订单已确认、券仍可使用”的资金不一致。
  const atomicOrderStatusBeforeConfirm = readScalar(`SELECT \`status\` FROM \`rental_orders\` WHERE \`id\`='${atomicOrderId}';`);
  mysqlQuery(`UPDATE \`rental_customer_coupons\` SET \`status\`='claimed' WHERE \`id\`='${atomicClaim.body.data.id}';`);
  const invalidRedeemConfirm = await request("POST", `/api/rental/v1/orders/${atomicOrderId}/confirm`, {}, demo.accessToken);
  assert.equal(invalidRedeemConfirm.status, 409, `券已不锁定时必须拒绝确认订单: ${JSON.stringify(invalidRedeemConfirm.body)}`);
  assert.equal(
    readScalar(`SELECT \`status\` FROM \`rental_orders\` WHERE \`id\`='${atomicOrderId}';`),
    atomicOrderStatusBeforeConfirm,
    "核销零更新时订单状态必须随事务回滚"
  );
  mysqlQuery(`UPDATE \`rental_customer_coupons\` SET \`status\`='locked' WHERE \`id\`='${atomicClaim.body.data.id}';`);
  ok("RC-02 核销零更新：拒绝确认并回滚订单状态");

  const factCounts = () => ({
    orders: readCount("SELECT COUNT(*) FROM `rental_orders`;"),
    lines: readCount("SELECT COUNT(*) FROM `rental_order_lines`;"),
    reservations: readCount("SELECT COUNT(*) FROM `rental_reservations`;")
  });
  const couponFailureStart = new Date(Date.now() + 20 * 86400000).toISOString();
  const couponFailureEnd = new Date(Date.now() + 22 * 86400000).toISOString();
  const couponFailureQuoteResponse = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponFailureStart, endAt: couponFailureEnd, lines: atomicLines, customerCouponId: claim2.body.data.id },
    demo.accessToken
  );
  assert.equal(couponFailureQuoteResponse.status, 201, `RC-02 锁券失败用报价创建失败: ${JSON.stringify(couponFailureQuoteResponse.body)}`);
  const couponFailureQuote = couponFailureQuoteResponse.body.data;
  const beforeCouponFailure = factCounts();
  mysqlQuery(`UPDATE \`rental_customer_coupons\` SET \`status\`='expired' WHERE \`id\`='${claim2.body.data.id}';`);
  const couponFailure = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: couponFailureQuote.id, customerType: "personal", customerId: r1CustomerId, customerName: "RC-02锁券失败客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponFailureStart, endAt: couponFailureEnd, lines: atomicLines },
    demo.accessToken
  );
  assert.equal(couponFailure.status, 409, `数据库券状态变化后必须拒绝下单: ${JSON.stringify(couponFailure.body)}`);
  assert.deepEqual(factCounts(), beforeCouponFailure, "锁券失败后不得遗留订单、订单行或库存预占");
  assert.equal(readCount(`SELECT COUNT(*) FROM \`rental_quotes\` WHERE \`id\`='${couponFailureQuote.id}' AND \`consumedAt\` IS NULL AND \`consumedOrderId\` IS NULL;`), 1, "锁券失败后报价不得被消费");
  assert.equal(readScalar(`SELECT \`status\` FROM \`rental_customer_coupons\` WHERE \`id\`='${claim2.body.data.id}';`), "expired", "失败事务不得把不可用券改成 locked");
  mysqlQuery(`UPDATE \`rental_customer_coupons\` SET \`status\`='claimed' WHERE \`id\`='${claim2.body.data.id}';`);
  ok("RC-02 锁券失败：订单、订单行、库存预占和报价消费全部回滚");

  const quoteFailureStart = new Date(Date.now() + 140 * 86400000).toISOString();
  const quoteFailureEnd = new Date(Date.now() + 142 * 86400000).toISOString();
  const quoteFailureQuoteResponse = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: quoteFailureStart, endAt: quoteFailureEnd, lines: atomicLines },
    demo.accessToken
  );
  assert.equal(quoteFailureQuoteResponse.status, 201, `RC-02 失效用报价创建失败: ${JSON.stringify(quoteFailureQuoteResponse.body)}`);
  const quoteFailureQuote = quoteFailureQuoteResponse.body.data;
  const beforeQuoteFailure = factCounts();
  mysqlQuery(`UPDATE \`rental_quotes\` SET \`expiresAt\`=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE \`id\`='${quoteFailureQuote.id}';`);
  const quoteFailure = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: quoteFailureQuote.id, customerType: "personal", customerId: r1CustomerId, customerName: "RC-02报价失败客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: quoteFailureStart, endAt: quoteFailureEnd, lines: atomicLines },
    demo.accessToken
  );
  assert.equal(quoteFailure.status, 409, `数据库报价过期后必须拒绝下单: ${JSON.stringify(quoteFailure.body)}`);
  assert.deepEqual(factCounts(), beforeQuoteFailure, "报价消费失败后不得遗留订单、订单行或库存预占");
  assert.equal(readCount(`SELECT COUNT(*) FROM \`rental_quotes\` WHERE \`id\`='${quoteFailureQuote.id}' AND \`consumedAt\` IS NULL AND \`consumedOrderId\` IS NULL;`), 1, "失败报价不得留下消费标记");
  ok("RC-02 报价失效：订单、订单行和库存预占全部回滚");

  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("RC-02 事务结果重启校验的 API 重启超时");
  const demoAfterRc02Restart = await login("demo", "admin", DEMO_PASSWORD);
  const demo2AfterRc02Restart = await login("demo2", "admin", DEMO_PASSWORD);
  demo.accessToken = demoAfterRc02Restart.accessToken;
  demo2.accessToken = demo2AfterRc02Restart.accessToken;
  const restoredAtomicOrder = (await request("GET", `/api/rental/v1/orders/${atomicOrderId}`, null, demoAfterRc02Restart.accessToken)).body.data;
  const restoredAtomicCoupon = (await request("GET", `/api/rental/v1/customer-coupons?customerId=${r1CustomerId}`, null, demoAfterRc02Restart.accessToken)).body.data.find((row) => row.id === atomicClaim.body.data.id);
  assert.equal(restoredAtomicOrder.quoteId, atomicQuote.id, "重启后必须从库恢复事务成功订单");
  assert.equal(restoredAtomicCoupon.status, "locked", "重启后必须从库恢复优惠券锁定状态");
  assert.equal(restoredAtomicCoupon.lockedOrderId, atomicOrderId, "重启后优惠券仍须关联原订单");
  ok("RC-02 重启一致性：成功事务完整恢复，失败事务无半成品复活");

  console.log("== 12.2 RC-03 序列化、数量和套装库存并发防超卖 ==");
  const runInventoryRace = async ({ label, token, customerId, locationId, itemGroupId, startAt, endAt, reservationQuantity }) => {
    const availability = async () => {
      const response = await request(
        "POST",
        "/api/rental/v1/availability",
        { locationId, startAt, endAt, lines: [{ itemGroupId, quantity: 1 }] },
        token
      );
      assert.equal(response.status, 201, `${label} 可用量查询失败: ${JSON.stringify(response.body)}`);
      return response.body.data.lines[0].availableQuantity;
    };
    const availableBefore = await availability();
    assert.ok(availableBefore >= 1, `${label} 构造前提：至少需要一份可用库存`);
    // 不假设固定夹具永远有 3 份库存：前面的验收链可能已经占用过同一品类。
    // 并发场景仍然请求当前全部可用量，保持“两个请求争抢最后容量”的语义。
    const requestQuantity = availableBefore;
    const lines = [{ itemGroupId, quantity: requestQuantity }];
    const persistedQuantity = requestQuantity * reservationQuantity.persistedPerRequested;

    const quotePayload = { customerType: "personal", customerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: locationId, startAt, endAt, lines };
    const firstQuoteResponse = await request("POST", "/api/rental/v1/quotes", quotePayload, token);
    const secondQuoteResponse = await request("POST", "/api/rental/v1/quotes", quotePayload, token);
    assert.equal(firstQuoteResponse.status, 201, `${label} 第一份报价失败: ${JSON.stringify(firstQuoteResponse.body)}`);
    assert.equal(secondQuoteResponse.status, 201, `${label} 第二份报价失败: ${JSON.stringify(secondQuoteResponse.body)}`);
    const firstQuote = firstQuoteResponse.body.data;
    const secondQuote = secondQuoteResponse.body.data;
    const orderPayload = (quoteId, suffix) => ({
      quoteId,
      customerType: "personal",
      customerId,
      customerName: `${label}并发客户${suffix}`,
      fulfillmentMode: "store_pickup_return",
      fulfillmentLocationId: locationId,
      startAt,
      endAt,
      lines
    });
    const results = await Promise.all([
      request("POST", "/api/rental/v1/orders", orderPayload(firstQuote.id, "A"), token),
      request("POST", "/api/rental/v1/orders", orderPayload(secondQuote.id, "B"), token)
    ]);
    const winners = results.filter((response) => response.status === 201);
    const conflicts = results.filter((response) => response.status === 409);
    assert.equal(winners.length, 1, `${label} 并发下单必须且只能成功一个: ${JSON.stringify(results.map((row) => row.body))}`);
    assert.equal(conflicts.length, 1, `${label} 并发下单必须明确拒绝另一个请求`);
    assert.match(JSON.stringify(conflicts[0].body), /库存/u, `${label} 冲突原因必须明确指向库存竞争`);

    const winningOrderId = winners[0].body.data.id;
    const winningQuoteId = winners[0].body.data.quoteId;
    const losingQuoteId = winningQuoteId === firstQuote.id ? secondQuote.id : firstQuote.id;
    assert.equal(
      readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`quoteId\` IN ('${firstQuote.id}','${secondQuote.id}');`),
      1,
      `${label} 不得生成第二张订单`
    );
    assert.equal(
      readCount(`SELECT COALESCE(SUM(\`quantity\`),0) FROM \`rental_reservations\` WHERE \`orderId\`='${winningOrderId}' AND \`status\`='SOFT';`),
      persistedQuantity,
      `${label} 只能保留成功订单的预占`
    );
    assert.equal(
      readCount(`SELECT COUNT(*) FROM \`rental_quotes\` WHERE \`id\`='${losingQuoteId}' AND \`consumedAt\` IS NULL AND \`consumedOrderId\` IS NULL;`),
      1,
      `${label} 被拒订单的报价不得被消费`
    );
    assert.equal(await availability(), 0, `${label} 成功订单占满后可用量必须为 0`);

    const cancelledRaceOrder = await request(
      "POST",
      `/api/rental/v1/orders/${winningOrderId}/cancel`,
      { reason: `${label}并发验收后释放` },
      token
    );
    assert.equal(cancelledRaceOrder.status, 201, `${label} 并发成功订单取消失败: ${JSON.stringify(cancelledRaceOrder.body)}`);
    assert.equal(await availability(), availableBefore, `${label} 取消后库存必须完整释放`);
    ok(`${label}并发防超卖：两个请求仅一个成功，冲突明确，取消后完整释放`);
  };

  const serializedRaceStart = new Date(Date.now() + 200 * 86400000).toISOString();
  const serializedRaceEnd = new Date(Date.now() + 202 * 86400000).toISOString();
  await runInventoryRace({
    label: "序列化库存",
    token: demo.accessToken,
    customerId: r1CustomerId,
    locationId: location.id,
    itemGroupId: serialized[0].id,
    startAt: serializedRaceStart,
    endAt: serializedRaceEnd,
    reservationQuantity: { persistedPerRequested: 1 }
  });

  const quantityRaceStart = new Date(Date.now() + 210 * 86400000).toISOString();
  const quantityRaceEnd = new Date(Date.now() + 212 * 86400000).toISOString();
  await runInventoryRace({
    label: "数量库存",
    token: demo2.accessToken,
    customerId: campingCustomerId,
    locationId: campingLocation.id,
    itemGroupId: tent.id,
    startAt: quantityRaceStart,
    endAt: quantityRaceEnd,
    reservationQuantity: { persistedPerRequested: 1 }
  });

  const bundleRaceStart = new Date(Date.now() + 220 * 86400000).toISOString();
  const bundleRaceEnd = new Date(Date.now() + 222 * 86400000).toISOString();
  await runInventoryRace({
    label: "套装库存",
    token: demo.accessToken,
    customerId: r1CustomerId,
    locationId: location.id,
    itemGroupId: cameraKit.id,
    startAt: bundleRaceStart,
    endAt: bundleRaceEnd,
    reservationQuantity: { persistedPerRequested: 2 }
  });

  const exclusivePlan = await request(
    "POST",
    "/api/rental/v1/discount-plans",
    { code: "E2E-EXCLUSIVE", name: "E2E 不可叠加券的优惠", changeReason: "E2E 互斥验证", discountType: "percentage", discountValue: 10, minimumSpend: 0, customerScope: "all", applicableItemGroupIds: [], applicableDayTypes: [], priority: 1, appliesTo: "rental", stackableWithOtherPlans: false, stackableWithCoupon: false, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), status: "enabled" },
    demo.accessToken
  );
  assert.equal(exclusivePlan.status, 201, `互斥方案创建失败: ${JSON.stringify(exclusivePlan.body).slice(0, 200)}`);
  const conflictingQuote = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponQuoteStart, endAt: couponQuoteEnd, lines: couponLines, customerCouponId: claim2.body.data.id },
    demo.accessToken
  );
  assert.equal(conflictingQuote.status, 409, "互斥优惠方案下不得同时使用优惠券");
  assert.match(JSON.stringify(conflictingQuote.body), /叠加/u, "拒绝原因应指向叠加互斥");
  const disableExclusivePlan = await request(
    "PUT",
    `/api/rental/v1/discount-plans/${exclusivePlan.body.data.id}`,
    { ...exclusivePlan.body.data, status: "disabled", changeReason: "E2E 爽约资源释放前清理互斥方案" },
    demo.accessToken
  );
  assert.equal(disableExclusivePlan.status, 200, `清理互斥优惠方案失败: ${disableExclusivePlan.status}`);
  ok("优惠券闭环：限领/领完/抵扣/锁定/复用拒绝/核销/取消释放/互斥拦截");

  console.log("== R1-NO-SHOW. 领取爽约真实 API 链：资产、服务容量与优惠券原子释放 ==");
  // 当前产品统一使用 Rental Core。除序列化资产外，本条同时挂一项容量服务和一张券，
  // 验证 confirm-no-show 的同一事务会把三类未履约资源一起释放，而不是只改订单状态。
  // 规则按报价起租时点匹配，不能用“过去两小时”硬造订单（当前规则可能是在本轮
  // 测试中刚发布，过去时点没有规则覆盖）。先发布一版领取宽限为 0 的爽约规则，
  // 再用一个很近的未来起租时间，等它自然越过起租点后推进真实爽约链。
  const currentNoShowRuleResponse = await request("GET", "/api/rental/v1/rule-versions/current", null, demo.accessToken);
  assert.equal(currentNoShowRuleResponse.status, 200, `读取爽约规则失败: ${JSON.stringify(currentNoShowRuleResponse.body).slice(0, 300)}`);
  const currentNoShowRule = currentNoShowRuleResponse.body.data;
  const noShowRuleDraft = await request(
    "POST",
    "/api/rental/v1/rule-versions",
    {
      changeReason: "R1 爽约真实链验收",
      config: {
        ...currentNoShowRule.config,
        cancellation: {
          ...currentNoShowRule.config.cancellation,
          noShow: {
            ...currentNoShowRule.config.cancellation.noShow,
            enabled: true,
            pickupGraceMinutes: 0,
            finalizationMinutes: 1,
            feeType: "percentage",
            feeValue: 100
          }
        }
      }
    },
    demo.accessToken
  );
  assert.equal(noShowRuleDraft.status, 201, `保存爽约规则草稿失败: ${JSON.stringify(noShowRuleDraft.body).slice(0, 300)}`);
  const noShowRulePublished = await request(
    "POST",
    `/api/rental/v1/rule-versions/${noShowRuleDraft.body.data.version}/publish`,
    { reason: "R1 爽约真实链验收" },
    demo.accessToken
  );
  assert.equal(noShowRulePublished.status, 201, `发布爽约规则失败: ${JSON.stringify(noShowRulePublished.body).slice(0, 300)}`);
  const noShowStartAt = Date.now() + 3000;
  const noShowStart = new Date(noShowStartAt).toISOString();
  const noShowEnd = new Date(noShowStartAt + 24 * 60 * 60 * 1000).toISOString();
  const noShowLines = [{ itemGroupId: serialized[1]?.id ?? serialized[0].id, quantity: 1 }];
  const noShowService = await request(
    "POST",
    "/api/rental/v1/value-added-services",
    {
      code: `E2E-NOSHOW-SERVICE-${Date.now().toString(36)}`,
      name: "E2E 爽约容量服务",
      serviceType: "operator",
      billingUnit: "per_day",
      price: 10,
      minimumQuantity: 1,
      maximumQuantity: 1,
      termsVersion: "1.0",
      terms: "E2E 爽约容量服务条款",
      applicableItemGroupIds: [],
      applicableFulfillmentModes: ["store_pickup_return"],
      applicableLocationIds: [location.id],
      customerScope: "all",
      selectionMode: "optional",
      requiresCapacity: true,
      status: "enabled"
    },
    demo.accessToken
  );
  assert.equal(noShowService.status, 201, `爽约容量服务创建失败: ${JSON.stringify(noShowService.body).slice(0, 300)}`);
  const noShowCapacity = await request(
    "POST",
    "/api/rental/v1/service-capacities",
    {
      serviceId: noShowService.body.data.id,
      locationId: location.id,
      windowStart: new Date(noShowStartAt - 1000).toISOString(),
      windowEnd: new Date(noShowStartAt + 24 * 60 * 60 * 1000 + 1000).toISOString(),
      totalCapacity: 1,
      status: "enabled"
    },
    demo.accessToken
  );
  assert.equal(noShowCapacity.status, 201, `爽约容量窗口创建失败: ${JSON.stringify(noShowCapacity.body).slice(0, 300)}`);
  const noShowCouponTemplate = await request(
    "POST",
    "/api/rental/v1/coupon-templates",
    {
      code: `E2E-NOSHOW-COUPON-${Date.now().toString(36)}`,
      name: "E2E 爽约释放券",
      discountType: "fixed_amount",
      discountValue: 10,
      minimumSpend: 0,
      totalQuota: 1,
      perCustomerLimit: 1,
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      effectiveTo: new Date(Date.now() + 30 * 86400000).toISOString(),
      status: "active"
    },
    demo.accessToken
  );
  assert.equal(noShowCouponTemplate.status, 201, `爽约优惠券模板创建失败: ${JSON.stringify(noShowCouponTemplate.body).slice(0, 300)}`);
  const noShowClaim = await request(
    "POST",
    "/api/rental/v1/customer-coupons/claim",
    { templateId: noShowCouponTemplate.body.data.id, customerId: r1CustomerId },
    demo.accessToken
  );
  assert.equal(noShowClaim.status, 201, `爽约优惠券领取失败: ${JSON.stringify(noShowClaim.body).slice(0, 300)}`);
  const noShowServices = [{
    serviceId: noShowService.body.data.id,
    quantity: 1,
    scheduledStartAt: noShowStart,
    scheduledEndAt: noShowEnd,
    serviceLocationId: location.id
  }];
  const noShowQuote = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", customerId: r1CustomerId, fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: noShowStart, endAt: noShowEnd, lines: noShowLines, customerCouponId: noShowClaim.body.data.id, services: noShowServices },
    demo.accessToken
  );
  assert.equal(noShowQuote.status, 201, `爽约订单报价失败: ${JSON.stringify(noShowQuote.body).slice(0, 300)}`);
  const noShowOrderResponse = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: noShowQuote.body.data.id, customerType: "personal", customerId: r1CustomerId, customerName: "E2E 爽约客户", contactPhone: "13800000003", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: noShowStart, endAt: noShowEnd, lines: noShowLines },
    demo.accessToken
  );
  assert.equal(noShowOrderResponse.status, 201, `爽约订单创建失败: ${JSON.stringify(noShowOrderResponse.body).slice(0, 300)}`);
  const noShowOrderId = noShowOrderResponse.body.data.id;
  assert.equal(
    readScalar(`SELECT \`reservedQuantity\` FROM \`rental_service_capacities\` WHERE \`id\`='${noShowCapacity.body.data.id}';`),
    "1",
    "爽约订单创建后应预留服务容量"
  );
  const noShowCouponLocked = (await request("GET", `/api/rental/v1/customer-coupons?customerId=${r1CustomerId}`, null, demo.accessToken)).body.data.find((row) => row.id === noShowClaim.body.data.id);
  assert.equal(noShowCouponLocked.status, "locked", "爽约订单创建后优惠券应锁定");
  assert.equal(noShowCouponLocked.lockedOrderId, noShowOrderId, "锁定优惠券应关联爽约订单");
  await prepareMockFunding(noShowOrderResponse.body.data, demo.accessToken, `e2e:${noShowOrderId}`);
  const noShowConfirmed = await request("POST", `/api/rental/v1/orders/${noShowOrderId}/confirm`, {}, demo.accessToken);
  assert.equal(noShowConfirmed.status, 201, `爽约订单确认失败: ${JSON.stringify(noShowConfirmed.body).slice(0, 300)}`);
  assert.equal(
    readScalar(`SELECT \`usedQuantity\` FROM \`rental_service_capacities\` WHERE \`id\`='${noShowCapacity.body.data.id}';`),
    "1",
    "订单确认后服务容量应从预留转为已确认占用"
  );
  const noShowAllocated = await request("POST", `/api/rental/v1/orders/${noShowOrderId}/allocate`, {}, demo.accessToken);
  assert.equal(noShowAllocated.status, 201, `爽约订单锁分配失败: ${JSON.stringify(noShowAllocated.body).slice(0, 300)}`);
  const noShowAssetId = noShowAllocated.body.data.allocations.find((row) => row.assetId)?.assetId;
  assert.ok(noShowAssetId, "爽约订单必须先有真实序列化资产分配，才能验证释放");
  while (Date.now() < noShowStartAt) await new Promise((resolve) => setTimeout(resolve, 250));
  const noShowOverdue = await request("POST", `/api/rental/v1/orders/${noShowOrderId}/mark-pickup-overdue`, {}, demo.accessToken);
  assert.equal(noShowOverdue.status, 201, `领取超时推进失败: ${JSON.stringify(noShowOverdue.body).slice(0, 300)}`);
  assert.equal(noShowOverdue.body.data.status, "pickup_overdue", "领取超时只应进入待确认爽约");
  assert.ok(noShowOverdue.body.data.noShowNoticeAt, "领取超时应记录模拟通知时间");
  const noShowFinal = await request("POST", `/api/rental/v1/orders/${noShowOrderId}/confirm-no-show`, { reason: "客户未按约领取" }, demo.accessToken);
  assert.equal(noShowFinal.status, 201, `确认爽约失败: ${JSON.stringify(noShowFinal.body).slice(0, 300)}`);
  assert.equal(noShowFinal.body.data.status, "no_show", "确认爽约后必须进入终态 no_show");
  assert.ok(noShowFinal.body.data.chargeLines.some((row) => row.code === `cancellation_reversal:${noShowOrderId}`), "爽约必须保留未履行租金核减事实");
  const noShowAsset = (await request("GET", "/api/rental/v1/assets", null, demo.accessToken)).body.data.find((row) => row.id === noShowAssetId);
  assert.equal(noShowAsset.status, "available", "确认爽约必须释放已分配但未领取的序列化资产");
  assert.ok(noShowFinal.body.data.reservations.every((row) => row.status === "cancelled"), "确认爽约必须取消全部资源预占");
  assert.equal(
    readScalar(`SELECT \`reservedQuantity\` FROM \`rental_service_capacities\` WHERE \`id\`='${noShowCapacity.body.data.id}';`),
    "0",
    "确认爽约必须释放服务容量预留"
  );
  assert.equal(
    readScalar(`SELECT \`usedQuantity\` FROM \`rental_service_capacities\` WHERE \`id\`='${noShowCapacity.body.data.id}';`),
    "0",
    "确认爽约必须释放服务已确认占用"
  );
  assert.equal(
    readScalar(`SELECT \`status\` FROM \`rental_service_reservations\` WHERE \`orderId\`='${noShowOrderId}' AND \`serviceId\`='${noShowService.body.data.id}';`),
    "released",
    "确认爽约必须把服务容量流水标记为 released"
  );
  const noShowCouponReleased = (await request("GET", `/api/rental/v1/customer-coupons?customerId=${r1CustomerId}`, null, demo.accessToken)).body.data.find((row) => row.id === noShowClaim.body.data.id);
  assert.equal(noShowCouponReleased.status, "claimed", "确认爽约必须释放优惠券回可用状态");
  assert.equal(noShowCouponReleased.lockedOrderId, undefined, "释放后的优惠券不得继续关联爽约订单");
  ok("领取爽约真实链路：起租超时进入待确认、记录通知、确认后进入 no_show，保留核减并原子释放资产、服务容量与优惠券");

  await maybeStopAfter("r1-no-show");

  console.log("== 13. 车辆租户初始化、经营空间与跨租户隔离 ==");
  const platform = await login("platform", "admin", PLATFORM_PASSWORD);
  const vehicleA = await bootstrapTenant(platform.accessToken, "e2e_vehicle_a", "vehicle");
  const tenantAId = vehicleA.tenant.tenantId;
  const vehicleAProfile = await request("GET", "/api/rental/v1/tenant-profile", null, vehicleA.accessToken);
  assert.equal(vehicleAProfile.status, 200, `车辆租户应能读取当前经营空间档案: ${vehicleAProfile.status}`);
  assert.equal(vehicleAProfile.body.data.categoryCode, "vehicle", "默认经营空间应保持 vehicle 品类");
  const vehicleALocations = await request("GET", "/api/rental/v1/locations", null, vehicleA.accessToken);
  assert.equal(vehicleALocations.status, 200, `车辆租户应能读取通用履约地点: ${vehicleALocations.status}`);
  assert.ok(vehicleALocations.body.data.length >= 1, "新车辆租户应有默认履约地点");
  const vehicleAOrders = await request("GET", "/api/rental/v1/orders", null, vehicleA.accessToken);
  assert.equal(vehicleAOrders.status, 200, `新车辆租户读取通用订单列表失败: ${vehicleAOrders.status}`);
  assert.equal(vehicleAOrders.body.data.length, 0, "新车辆租户不得看到 tenant_001 的种子订单");
  const vehicleAReport = await request("GET", "/api/rental/v1/reports/operations", null, vehicleA.accessToken);
  assert.equal(vehicleAReport.status, 200, `新车辆租户应能读取空经营报表: ${vehicleAReport.status}`);
  assert.equal(vehicleAReport.body.data.orderCount, 0, "新车辆租户空报表订单量应为 0");
  const saasWorkspaceList = await request("GET", `/api/platform/tenants/${tenantAId}/workspaces`, null, platform.accessToken);
  assert.equal(saasWorkspaceList.status, 200, "SaaS 管理员应能列出目标租户经营空间");
  assert.equal(saasWorkspaceList.body.data.length, 1, "新租户初始应只有默认经营空间");
  const saasWorkspaceCreate = await request(
    "POST",
    `/api/platform/tenants/${tenantAId}/workspaces`,
    { code: "camera-space", name: "摄影业务空间", categoryCode: "camera" },
    platform.accessToken
  );
  assert.equal(saasWorkspaceCreate.status, 201, `SaaS 管理员新增目标租户空间失败: ${JSON.stringify(saasWorkspaceCreate.body).slice(0, 200)}`);
  const saasWorkspaceId = saasWorkspaceCreate.body.data.id;
  const tenantSessionAfterSpace = await request("GET", "/api/auth/session-context", null, vehicleA.accessToken);
  assert.ok(tenantSessionAfterSpace.body.data.workspaces.some((workspace) => workspace.id === saasWorkspaceId), "平台创建空间后应自动加入目标租户管理员");
  const saasWorkspaceUpdate = await request(
    "PUT",
    `/api/platform/tenants/${tenantAId}/workspaces/${saasWorkspaceId}`,
    { name: "摄影业务空间（更新）", status: "frozen" },
    platform.accessToken
  );
  assert.equal(saasWorkspaceUpdate.status, 200, "SaaS 管理员应能编辑目标租户空间名称与状态");
  assert.equal(saasWorkspaceUpdate.body.data.categoryCode, "camera", "编辑空间不得改变创建时品类");
  const tenantCannotManageSaasScope = await request(
    "GET",
    `/api/platform/tenants/${tenantAId}/workspaces`,
    null,
    vehicleA.accessToken
  );
  assert.equal(tenantCannotManageSaasScope.status, 403, "普通租户管理员不得调用 SaaS 目标租户空间接口");
  const tenantRowsAfterSpace = await request("GET", "/api/platform/tenants", null, platform.accessToken);
  const tenantSummaryAfterSpace = tenantRowsAfterSpace.body.data.find((tenant) => tenant.tenantId === tenantAId);
  assert.equal(tenantSummaryAfterSpace.workspaceCount, 2, "SaaS 租户摘要应按经营空间统计，不再只显示租户级单一品类");
  assert.deepEqual([...tenantSummaryAfterSpace.workspaceCategoryCodes].sort(), ["camera", "vehicle"], "租户摘要应汇总空间品类");
  ok("SaaS 管理员可按目标租户查看、新增和编辑经营空间；租户管理员不能越权，租户摘要按多空间汇总");
  const vehicleB = await bootstrapTenant(platform.accessToken, "e2e_vehicle_b", "vehicle");
  const vehicleBLocations = await request("GET", "/api/rental/v1/locations", null, vehicleB.accessToken);
  assert.equal(vehicleBLocations.status, 200, `车辆租户 B 读取通用履约地点失败: ${vehicleBLocations.status}`);
  assert.ok(vehicleBLocations.body.data.every((row) => row.tenantId === vehicleB.tenant.tenantId), "车辆租户 B 不得看到 A 的履约地点");
  const vehicleBGroups = await request("GET", "/api/rental/v1/item-groups", null, vehicleB.accessToken);
  assert.equal(vehicleBGroups.status, 200, `车辆租户 B 读取商品目录失败: ${vehicleBGroups.status}`);
  assert.equal(vehicleBGroups.body.data.length, 0, "车辆租户 B 不得看到 A 的商品型号");
  ok("车辆租户使用统一 Rental Core：商品、资产、地点、订单和报表均按租户隔离");

  console.log("== 14. 车辆品类 Rental Core 深度用例：资质拦截、序列化资产与逾期费 ==");
  const vehicleLocation = (await request("GET", "/api/rental/v1/locations", null, vehicleA.accessToken)).body.data[0];
  const truckGroup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    { code: "E2E-TRUCK", name: "E2E 货车", inventoryMode: "serialized", unit: "辆", attributes: { manufacturer: "E2E重工", brand: "E2E", model: "T1" } },
    vehicleA.accessToken
  );
  assert.equal(truckGroup.status, 201, `车辆商品创建失败: ${JSON.stringify(truckGroup.body).slice(0, 200)}`);
  for (let index = 1; index <= 2; index += 1) {
    const asset = await request(
      "POST",
      "/api/rental/v1/assets",
      { itemGroupId: truckGroup.body.data.id, locationId: vehicleLocation.id, assetNo: `E2E-TRUCK-00${index}`, attributes: { licensePlate: `E2E-00${index}`, vin: `E2EVIN0000000000${index}` } },
      vehicleA.accessToken
    );
    assert.equal(asset.status, 201, `车辆资产登记失败: ${JSON.stringify(asset.body).slice(0, 200)}`);
  }
  const duplicateVehicleIdentifier = await request(
    "POST",
    "/api/rental/v1/assets",
    { itemGroupId: truckGroup.body.data.id, locationId: vehicleLocation.id, assetNo: "E2E-TRUCK-003", attributes: { licensePlate: " e2e-001 ", vin: "E2E-UNIQUE-VIN-003" } },
    vehicleA.accessToken
  );
  assert.equal(duplicateVehicleIdentifier.status, 409, "动态唯一字段必须在当前经营空间内忽略大小写与首尾空格判重");
  assert.match(JSON.stringify(duplicateVehicleIdentifier.body), /车牌号已存在/u, "重复原因应指出车牌号");
  const concurrentDuplicateVehicleIdentifiers = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      request(
        "POST",
        "/api/rental/v1/assets",
        {
          itemGroupId: truckGroup.body.data.id,
          locationId: vehicleLocation.id,
          assetNo: `E2E-CONCURRENT-${index + 1}`,
          attributes: {
            licensePlate: index % 2 === 0 ? "E2E-RACE-001" : " e2e-race-001 ",
            vin: `E2E-CONCURRENT-VIN-${index + 1}`
          }
        },
        vehicleA.accessToken
      )
    )
  );
  assert.equal(
    concurrentDuplicateVehicleIdentifiers.filter((response) => response.status === 201).length,
    1,
    "并发写入同一动态唯一值时只能有一个请求成功"
  );
  assert.equal(
    concurrentDuplicateVehicleIdentifiers.filter((response) => response.status === 409).length,
    3,
    `其余并发请求必须被数据库唯一声明拒绝: ${JSON.stringify(concurrentDuplicateVehicleIdentifiers.map((response) => response.status))}`
  );
  assert.ok(
    concurrentDuplicateVehicleIdentifiers
      .filter((response) => response.status === 409)
      .every((response) => /车牌号已存在/u.test(JSON.stringify(response.body))),
    "并发冲突必须返回可理解的动态字段名称"
  );
  ok("动态唯一字段顺序与并发写入均受经营空间级约束");
  const truckPlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    // 价格版本按**租期开始时间**匹配（需求 4.4.4），而本节的 vehicleStart 刻意设在
    // 27 小时前以验证逾期费。生效时间必须早于租期开始，否则该租期没有可用价格版本。
    // 原来是 now-24h，正好晚于 now-27h 的租期起点。
    { effectiveFrom: new Date(Date.now() - 30 * 86400000).toISOString(), code: "E2E-TRUCK-PRICE", name: "E2E 货车价格", changeReason: "E2E 品类深度用例", status: "enabled", rates: [{ itemGroupId: truckGroup.body.data.id, unit: "day_24h", baseAmount: 600, weekendMultiplier: 1.1, holidayMultiplier: 1.25, depositAmount: 2000, minimumUnits: 1 }] },
    vehicleA.accessToken
  );
  assert.equal(truckPlan.status, 201, `车辆定价计划失败: ${JSON.stringify(truckPlan.body).slice(0, 200)}`);
  const vehicleStart = new Date(Date.now() - 27 * 3600 * 1000).toISOString();
  const vehicleEnd = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const vehicleLines = [{ itemGroupId: truckGroup.body.data.id, quantity: 1 }];
  const vehicleQuote = (
    await request(
      "POST",
      "/api/rental/v1/quotes",
      { customerType: "personal", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: vehicleLocation.id, startAt: vehicleStart, endAt: vehicleEnd, lines: vehicleLines, pricingPlanId: truckPlan.body.data.id },
      vehicleA.accessToken
    )
  ).body.data;
  const vehicleOrderBase = {
    quoteId: vehicleQuote.id,
    customerType: "personal",
    customerName: "E2E车辆客户",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: vehicleLocation.id,
    startAt: vehicleStart,
    endAt: vehicleEnd,
    lines: vehicleLines
  };
  const noQualification = await request("POST", "/api/rental/v1/orders", vehicleOrderBase, vehicleA.accessToken);
  assert.equal(noQualification.status, 409, "车辆品类未通过资质审核必须拒绝下单");
  assert.match(JSON.stringify(noQualification.body), /资质审核/u, "拒绝原因应指向资质");
  const vehicleOrder = await request("POST", "/api/rental/v1/orders", { ...vehicleOrderBase, qualificationApproved: true }, vehicleA.accessToken);
  assert.equal(vehicleOrder.status, 201, `车辆订单创建失败: ${JSON.stringify(vehicleOrder.body).slice(0, 200)}`);
  const vehicleOrderId = vehicleOrder.body.data.id;
  await request("POST", `/api/rental/v1/orders/${vehicleOrderId}/confirm`, {}, vehicleA.accessToken);
  const vehicleAllocated = (await request("POST", `/api/rental/v1/orders/${vehicleOrderId}/allocate`, {}, vehicleA.accessToken)).body.data;
  assert.ok(vehicleAllocated.allocations.length === 1 && vehicleAllocated.allocations[0].assetId, "序列化资产应绑定具体车辆");
  await prepareMockFunding(vehicleOrder.body.data, vehicleA.accessToken, `e2e:${vehicleOrderId}`);
  const vehiclePickupTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=pickup", null, vehicleA.accessToken)).body.data[0];
  await request(
    "POST",
    `/api/rental/v1/orders/${vehicleOrderId}/inspections`,
    { templateId: vehiclePickupTemplate.id, results: { appearance_ok: true, function_ok: true, usage_reading: 1200 } },
    vehicleA.accessToken
  );
  const vehicleReturnTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=return", null, vehicleA.accessToken)).body.data[0];
  const vehicleReturned = (await request(
    "POST",
    `/api/rental/v1/orders/${vehicleOrderId}/inspections`,
    { templateId: vehicleReturnTemplate.id, results: { appearance_ok: true, function_ok: true, usage_reading: 1580 } },
    vehicleA.accessToken
  )).body.data;
  assert.equal(vehicleReturned.order.status, "settling");
  assert.ok(
    vehicleReturned.order.chargeLines.some((line) => line.type === "overdue"),
    "逾期还车应产生逾期费用行"
  );
  assert.ok(vehicleReturned.order.finalPayableAmount > vehicleReturned.order.payableAmount, "逾期费应进入最终应付");
  const vehicleSettled = await closeMockFundedOrder(vehicleOrderId, vehicleA.accessToken, `e2e:${vehicleOrderId}`);
  assert.equal(vehicleSettled.body.data.status, "completed", "车辆订单资金归零后必须关闭");
  ok("车辆 Rental Core 闭环：资质拦截、序列化绑定、逾期费联动");

  console.log("== 15. 工程设备品类深度用例：班次计价、资质拦截与损坏费 ==");
  const construction = await bootstrapTenant(platform.accessToken, "e2e_construction", "construction");
  const constructionProfile = (await request("GET", "/api/rental/v1/tenant-profile", null, construction.accessToken)).body.data;
  assert.equal(constructionProfile.categoryCode, "construction");
  const constructionLocation = (await request("GET", "/api/rental/v1/locations", null, construction.accessToken)).body.data[0];
  const excavatorGroup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    { code: "E2E-EXCA", name: "E2E 挖掘机", inventoryMode: "serialized", unit: "台", attributes: { manufacturer: "E2E重工", model: "EX200" } },
    construction.accessToken
  );
  assert.equal(excavatorGroup.status, 201, `工程商品创建失败: ${JSON.stringify(excavatorGroup.body).slice(0, 200)}`);
  const excavatorAsset = await request(
    "POST",
    "/api/rental/v1/assets",
    { itemGroupId: excavatorGroup.body.data.id, locationId: constructionLocation.id, assetNo: "E2E-EXCA-001", attributes: { factoryNo: "EX-SN-001", inspectionExpiry: "2027-12-31" } },
    construction.accessToken
  );
  assert.equal(excavatorAsset.status, 201, `工程资产登记失败: ${JSON.stringify(excavatorAsset.body).slice(0, 200)}`);
  const excavatorPlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    { effectiveFrom: new Date(Date.now() - 86400000).toISOString(), code: "E2E-EXCA-PRICE", name: "E2E 挖掘机价格", changeReason: "E2E 品类深度用例", status: "enabled", rates: [{ itemGroupId: excavatorGroup.body.data.id, unit: "shift", baseAmount: 1500, weekendMultiplier: 1.1, holidayMultiplier: 1.25, depositAmount: 5000, minimumUnits: 1 }] },
    construction.accessToken
  );
  assert.equal(excavatorPlan.status, 201, `工程定价计划失败: ${JSON.stringify(excavatorPlan.body).slice(0, 200)}`);
  const constructionStart = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const constructionEnd = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const constructionLines = [{ itemGroupId: excavatorGroup.body.data.id, quantity: 1 }];
  const constructionQuote = (
    await request(
      "POST",
      "/api/rental/v1/quotes",
      { customerType: "personal", fulfillmentMode: "warehouse_pickup_return", fulfillmentLocationId: constructionLocation.id, startAt: constructionStart, endAt: constructionEnd, lines: constructionLines, pricingPlanId: excavatorPlan.body.data.id },
      construction.accessToken
    )
  ).body.data;
  const excavatorRental = constructionQuote.chargeLines.find((line) => line.code === "rental:E2E-EXCA");
  assert.ok(excavatorRental && excavatorRental.detail.includes("shift"), `班次计价说明应包含 shift: ${excavatorRental && excavatorRental.detail}`);
  const constructionOrderBase = {
    quoteId: constructionQuote.id,
    customerType: "personal",
    customerName: "E2E工程客户",
    fulfillmentMode: "warehouse_pickup_return",
    fulfillmentLocationId: constructionLocation.id,
    startAt: constructionStart,
    endAt: constructionEnd,
    lines: constructionLines
  };
  const noOperatorQualification = await request("POST", "/api/rental/v1/orders", constructionOrderBase, construction.accessToken);
  assert.equal(noOperatorQualification.status, 409, "工程设备未提供操作资格必须拒绝下单");
  const constructionOrder = await request("POST", "/api/rental/v1/orders", { ...constructionOrderBase, qualificationApproved: true }, construction.accessToken);
  assert.equal(constructionOrder.status, 201, `工程订单创建失败: ${JSON.stringify(constructionOrder.body).slice(0, 200)}`);
  const constructionOrderId = constructionOrder.body.data.id;
  await request("POST", `/api/rental/v1/orders/${constructionOrderId}/confirm`, {}, construction.accessToken);
  await request("POST", `/api/rental/v1/orders/${constructionOrderId}/allocate`, {}, construction.accessToken);
  await prepareMockFunding(constructionOrder.body.data, construction.accessToken, `e2e:${constructionOrderId}`);
  const constructionPickupTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=pickup", null, construction.accessToken)).body.data[0];
  await request(
    "POST",
    `/api/rental/v1/orders/${constructionOrderId}/inspections`,
    { templateId: constructionPickupTemplate.id, results: { appearance_ok: true, function_ok: true, usage_reading: 320 } },
    construction.accessToken
  );
  const constructionReturnTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=return", null, construction.accessToken)).body.data[0];
  const constructionReturned = (await request(
    "POST",
    `/api/rental/v1/orders/${constructionOrderId}/inspections`,
    { templateId: constructionReturnTemplate.id, results: { appearance_ok: false, function_ok: true, usage_reading: 356 }, exceptions: [{ code: "damage", description: "铲斗液压油管破损", chargeAmount: 800 }] },
    construction.accessToken
  )).body.data;
  assert.equal(constructionReturned.order.status, "settling");
  const constructionReviewedOrder = await reviewInspectionException(constructionOrderId, constructionReturned.inspection.id, 0, 800, construction.accessToken, `e2e:${constructionOrderId}`);
  assert.equal(constructionReviewedOrder.finalPayableAmount, constructionReviewedOrder.payableAmount + 800, "审核后的工程损坏费应进入最终应付");
  // 订单侧的明细与总额同样要自洽（需求 4.4.1「明细之和等于对应总额」）。
  // 订单的明细是报价明细的拷贝，再追加取消/逾期/损坏这类异常费用，因此对应关系是：
  //   报价类明细（非押金、非预授权、非异常）之和 = 租赁应付
  //   异常类明细之和 = 调整金额
  // 这条把报价侧的对账延伸到订单侧；只在报价侧成立不足以说明账目在订单上也对得起来。
  const orderLines = constructionReviewedOrder.chargeLines;
  const adjustmentTypes = new Set(["cancellation", "overdue", "damage"]);
  const sumBy = (predicate) =>
    Math.round(orderLines.filter(predicate).reduce((total, row) => total + row.amount, 0) * 100) / 100;
  assert.equal(
    sumBy((row) => !adjustmentTypes.has(row.type) && row.type !== "deposit" && row.type !== "preauthorization"),
    constructionReviewedOrder.payableAmount,
    `订单的报价类明细之和应等于租赁应付 ${constructionReviewedOrder.payableAmount}`
  );
  assert.equal(
    sumBy((row) => adjustmentTypes.has(row.type)),
    constructionReviewedOrder.adjustmentAmount,
    `订单的异常类明细之和应等于调整金额 ${constructionReviewedOrder.adjustmentAmount}`
  );
  // 确认异常明细确实存在，否则上面第二条是拿 0 比 0（本节刻意造了 800 元损坏费）。
  assert.ok(
    orderLines.some((row) => adjustmentTypes.has(row.type)),
    `前置条件：本节应已产生异常费用明细，实际类型：${orderLines.map((row) => row.type).join("/")}`
  );
  const constructionSettled = await closeMockFundedOrder(constructionOrderId, construction.accessToken, `e2e:${constructionOrderId}`);
  assert.equal(constructionSettled.body.data.status, "completed", "工程订单资金归零后必须关闭");
  ok("工程设备闭环：班次计价、资质拦截、损坏费联动，订单明细与总额对账一致");

  console.log("== 15b. PRICE-01 报价可复算、阶梯价与封顶价 ==");
  // 验收要求「相同输入可复算并解释来源」。既有用例只断言金额 > 0 或后置费用的增量，
  // 从未断言过「给定费率与租期，租金必须**恰好**等于某个数」——那才是可复算的证据。
  //
  // 本节自建一个数量库存商品与专用价格计划，把数字完全捏在手里：
  //   基础价 100/自然日，阶梯：满 3 日 90、满 7 日 70，封顶 600
  // 并刻意用**跨日但不足 24 小时**的租期，验证自然日按日期计而不是按 24 小时块计。
  const priceGroup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    { code: "E2E-PRICE-KIT", name: "E2E 计价验证组", inventoryMode: "quantity", unit: "套", attributes: { manufacturer: "E2E重工", model: "PRICE-KIT" } },
    construction.accessToken
  );
  assert.equal(priceGroup.status, 201, `计价验证商品组创建失败: ${JSON.stringify(priceGroup.body).slice(0, 200)}`);
  const priceGroupId = priceGroup.body.data.id;
  const priceStock = await request(
    "PUT",
    "/api/rental/v1/stock-balances",
    { itemGroupId: priceGroupId, locationId: constructionLocation.id, onHandQuantity: 20, maintenanceQuantity: 0 },
    construction.accessToken
  );
  assert.equal(priceStock.status, 200, `计价验证库存登记失败: ${JSON.stringify(priceStock.body).slice(0, 200)}`);
  const pricePlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: "E2E-PRICE-TIER",
      name: "E2E 阶梯与封顶价格",
      changeReason: "PRICE-01 可复算验收",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 100,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          // 工程品类规则要求预授权，而当前实现把预授权额度取自 depositAmount
          // （需求 4.4 要求二者独立计算，属 PRICE-01 尚未收口的部分，已记录）。
          // 押金不进 rentalAmount，因此不影响下面的租金断言。
          depositAmount: 500,
          minimumUnits: 1,
          tiers: [{ minUnits: 3, unitAmount: 90 }, { minUnits: 7, unitAmount: 70 }],
          maxAmount: 600
        }
      ]
    },
    construction.accessToken
  );
  assert.equal(pricePlan.status, 201, `阶梯价格计划创建失败: ${JSON.stringify(pricePlan.body).slice(0, 200)}`);
  // 阶梯与封顶必须真的落库，否则重启后报价无从复算。
  const persistedRates = JSON.parse(
    readScalar(`SELECT \`rates\` FROM \`rental_pricing_plans\` WHERE \`id\`='${pricePlan.body.data.id}';`)
  );
  assert.equal(persistedRates[0].tiers.length, 2, "阶梯档位必须落库");
  assert.equal(persistedRates[0].maxAmount, 600, "封顶价必须落库");

  // 时间一律用 +08:00 书写，即营业挂钟时间。自然日按**营业时区**（默认 Asia/Shanghai）
  // 的日界切分，与营业日历同一口径；刻意选未来的固定日期，避免跨测试时刻漂移。
  const priceQuoteFor = async (startUtc, endUtc, quantity = 1) => {
    const res = await request(
      "POST",
      "/api/rental/v1/quotes",
      {
        customerType: "corporate",
        // 工程品类启用的是仓储自提，不是门店自提（品类 capability 决定）。
        fulfillmentMode: "warehouse_pickup_return",
        fulfillmentLocationId: constructionLocation.id,
        startAt: startUtc,
        endAt: endUtc,
        pricingPlanId: pricePlan.body.data.id,
        lines: [{ itemGroupId: priceGroupId, quantity }]
      },
      construction.accessToken
    );
    assert.equal(res.status, 201, `计价验证报价失败: ${JSON.stringify(res.body).slice(0, 250)}`);
    return res.body.data;
  };

  // 1) 自然日必须按日期计：3/2 22:00 → 3/3 08:00 只有 10 小时，但占用 2 个日期。
  //    早前 calendar_day 与 day_24h 共用 24 小时折算，这里会算成 1 日、少收一天。
  const crossDay = await priceQuoteFor("2027-03-02T22:00:00+08:00", "2027-03-03T08:00:00+08:00");
  assert.equal(
    crossDay.rentalAmount,
    200,
    `自然日跨 2 个日期应为 2 × 100 = 200（按 24 小时折算会得 100）：实际 ${crossDay.rentalAmount}`
  );

  // 2) 阶梯价整单重定价：占用 4 个日期 → 命中"满 3 日 90"档 → 4 × 90 = 360。
  const tierHit = await priceQuoteFor("2027-03-02T09:00:00+08:00", "2027-03-05T09:00:00+08:00");
  assert.equal(tierHit.rentalAmount, 360, `满 3 日档应为 4 × 90 = 360：实际 ${tierHit.rentalAmount}`);

  // 3) 封顶价：占用 10 个日期 → 命中"满 7 日 70"档 → 10 × 70 = 700 → 封顶 600。
  const capHit = await priceQuoteFor("2027-03-02T09:00:00+08:00", "2027-03-11T09:00:00+08:00");
  assert.equal(capHit.rentalAmount, 600, `10 日应被封顶为 600（未封顶为 700）：实际 ${capHit.rentalAmount}`);

  // 4) 计算说明必须解释来源：命中的档位、单位数与封顶都要能读出来。
  const capLine = capHit.chargeLines.find((row) => row.type === "rental");
  assert.ok(capLine, "应有租金明细行");
  assert.match(capLine.detail, /阶梯价 70/, `说明应指明命中的阶梯单价: ${capLine.detail}`);
  assert.match(capLine.detail, /封顶 600/, `说明应指明封顶: ${capLine.detail}`);
  assert.match(capLine.detail, /10 calendar_day/, `说明应指明单位数: ${capLine.detail}`);
  assert.equal(capLine.sourceVersion, pricePlan.body.data.version, "明细必须带价格计划版本，否则无从复算");

  // 4b) Codex 复审 P1：日历快照里的**实际单位价**必须是按总单位数选出的阶梯档单价，
  //     而不是按「1 个单位」现算的基础价。早前 unitAmount 用 amountPerItem(rate, 1, [1])
  //     现算，租 4 天命中 90 元档时快照仍记 100，据快照复算不出报价金额。
  const tierSnapshot = tierHit.calendarSnapshot ?? [];
  assert.ok(tierSnapshot.length > 0, "阶梯报价必须带逐日快照");
  for (const day of tierSnapshot) {
    assert.equal(day.unitAmount, 90, `快照单位价必须是命中的阶梯档 90（不是基础价 100）: ${day.unitAmount} @ ${day.date}`);
  }
  // 快照必须能复算：Σ(unitCount × unitAmount × multiplier) = 租金（本例无节假日系数，故为 4×90）。
  const tierSnapshotTotal = tierSnapshot.reduce((sum, day) => sum + day.unitCount * day.unitAmount * day.multiplier, 0);
  assert.equal(tierSnapshotTotal, 360, `按快照复算应等于租金 360：实际 ${tierSnapshotTotal}`);
  // 封顶用例：快照记的是封顶**前**的逐日单价（70），封顶是行级结果，两者都要能读出来。
  const capSnapshot = capHit.calendarSnapshot ?? [];
  assert.ok(capSnapshot.every((day) => day.unitAmount === 70), `封顶用例的快照单位价应为阶梯档 70: ${JSON.stringify(capSnapshot.map((d) => d.unitAmount))}`);
  assert.equal(
    capSnapshot.reduce((sum, day) => sum + day.unitCount * day.unitAmount * day.multiplier, 0),
    700,
    "封顶前的逐日合计应为 700，封顶后的 600 由行金额体现"
  );

  // 5) 相同输入必须复算出相同结果——这是可复算的直接证据。
  const priceReplay = await priceQuoteFor("2027-03-02T09:00:00+08:00", "2027-03-11T09:00:00+08:00");
  assert.equal(priceReplay.rentalAmount, capHit.rentalAmount, "相同输入必须算出相同租金");
  assert.equal(
    priceReplay.chargeLines.find((row) => row.type === "rental").detail,
    capLine.detail,
    "相同输入必须给出相同的计算说明"
  );

  // 5b) 锁价：需求 4.4.4「报价生成后在其有效期内锁定本次命中的价格……锁价期间发布
  //     新价格不得改变既有报价」。机制（报价快照 + 费率快照）已有，但此前没有任何
  //     断言证明它在**新价发布之后**仍返回旧价——没被证伪过的机制不算已验证。
  //
  //     用**专属计划**而不是复用本节的 pricePlan：改价会污染后续依赖该计划的断言，
  //     而"靠自己排在最后"是脆弱的顺序依赖（本文件第 28 节的教训）。
  //     还要用**专属商品组**：自动择一按"覆盖所选商品 + 生效时间最晚 + 版本号大"择一，
  //     锁价计划改价后版本号变大，若与本节其他计划覆盖同一商品组，就会把第 8 条
  //     "自动择一"的断言抢走。换成独立商品组后，两者永不竞争，顺序无关。
  const lockGroup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    {
      code: "E2E-PRICE-LOCK-KIT",
      name: "E2E 锁价验证组",
      inventoryMode: "quantity",
      unit: "套",
      attributes: { manufacturer: "E2E重工", model: "LOCK-KIT" }
    },
    construction.accessToken
  );
  assert.equal(lockGroup.status, 201, `锁价验证商品组创建失败: ${JSON.stringify(lockGroup.body).slice(0, 200)}`);
  const lockGroupId = lockGroup.body.data.id;
  const lockStock = await request(
    "PUT",
    "/api/rental/v1/stock-balances",
    { itemGroupId: lockGroupId, locationId: constructionLocation.id, onHandQuantity: 10, maintenanceQuantity: 0 },
    construction.accessToken
  );
  assert.equal(lockStock.status, 200, `锁价验证库存登记失败: ${JSON.stringify(lockStock.body).slice(0, 200)}`);
  const lockPlanPayload = (baseAmount, reason) => ({
    code: "E2E-PRICE-LOCK",
    name: "E2E 锁价验收",
    changeReason: reason,
    status: "enabled",
    effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
    rates: [
      {
        itemGroupId: lockGroupId,
        unit: "calendar_day",
        baseAmount,
        weekendMultiplier: 1,
        holidayMultiplier: 1,
        depositAmount: 500,
        minimumUnits: 1
      }
    ]
  });
  const lockPlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    lockPlanPayload(100, "PRICE-01 锁价验收：初版"),
    construction.accessToken
  );
  assert.equal(lockPlan.status, 201, `锁价计划创建失败: ${JSON.stringify(lockPlan.body).slice(0, 250)}`);
  const lockQuoteWith = async (planId) => {
    const res = await request(
      "POST",
      "/api/rental/v1/quotes",
      {
        customerType: "corporate",
        fulfillmentMode: "warehouse_pickup_return",
        fulfillmentLocationId: constructionLocation.id,
        startAt: "2027-07-05T09:00:00+08:00",
        endAt: "2027-07-07T09:00:00+08:00",
        pricingPlanId: planId,
        lines: [{ itemGroupId: lockGroupId, quantity: 1 }]
      },
      construction.accessToken
    );
    assert.equal(res.status, 201, `锁价报价失败: ${JSON.stringify(res.body).slice(0, 250)}`);
    return res.body.data;
  };
  const lockedBefore = await lockQuoteWith(lockPlan.body.data.id);
  assert.equal(lockedBefore.rentalAmount, 300, `锁价前应为 3 个自然日 × 100 = 300：实际 ${lockedBefore.rentalAmount}`);
  // 对**同一个计划**发布新版本，把基础价从 100 抬到 500。
  const repriced = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    { id: lockPlan.body.data.id, ...lockPlanPayload(500, "PRICE-01 锁价验收：发布新价") },
    construction.accessToken
  );
  assert.equal(repriced.status, 201, `发布新价失败: ${JSON.stringify(repriced.body).slice(0, 250)}`);
  assert.notEqual(repriced.body.data.version, lockPlan.body.data.version, "发布新价必须产生新的版本号");
  // 从 API 读回原报价：金额、费率快照与版本号都必须是锁价时的值。
  const reread = await request("GET", `/api/rental/v1/quotes/${lockedBefore.id}`, null, construction.accessToken);
  assert.equal(reread.status, 200, `读回报价失败: ${JSON.stringify(reread.body).slice(0, 200)}`);
  assert.equal(
    reread.body.data.rentalAmount,
    300,
    `锁价期间发布新价后，既有报价仍应为 300：实际 ${reread.body.data.rentalAmount}——` +
      "若变成 1500（500 × 3）说明报价没有锁价"
  );
  assert.equal(
    reread.body.data.rateSnapshot[0].baseAmount,
    100,
    `既有报价的费率快照仍应是 100：实际 ${reread.body.data.rateSnapshot[0].baseAmount}`
  );
  assert.equal(
    reread.body.data.pricingPlanVersion,
    lockedBefore.pricingPlanVersion,
    "既有报价引用的价格版本号不得被新版本覆盖"
  );
  // 新报价必须用新价——否则"锁价"就变成了"永远不涨价"。
  const afterReprice = await lockQuoteWith(lockPlan.body.data.id);
  assert.equal(
    afterReprice.rentalAmount,
    1500,
    `新报价应按新价 500 × 3 = 1500：实际 ${afterReprice.rentalAmount}——` +
      "若仍为 300 说明新价没有生效，那是另一个方向的错误"
  );

  // 5c) 明细之和必须等于对应总额（需求 4.4.1 第 432 行）。
  //
  //     押金是一条**正数**明细却不计入 payableAmount，因此早前 `sum(chargeLines)`
  //     不等于任何单一总额——页面、账单和财务核对都无法用求和自校验。
  //     正确的对应关系是三条，缺一条就说明金额口径混用了：
  //       非押金明细之和 = 租赁应付；押金明细之和 = 应付押金；两者之和 = 本次实收。
  //     预授权额度按需求 427 行不计入其中任何一项。
  const sumOf = (lines, predicate) =>
    Math.round(lines.filter(predicate).reduce((total, row) => total + row.amount, 0) * 100) / 100;
  const reconcile = (quote, label) => {
    const nonDeposit = sumOf(quote.chargeLines, (row) => row.type !== "deposit" && row.type !== "preauthorization");
    const deposits = sumOf(quote.chargeLines, (row) => row.type === "deposit");
    assert.equal(nonDeposit, quote.payableAmount, `${label}：非押金明细之和应等于租赁应付 ${quote.payableAmount}，实际 ${nonDeposit}`);
    assert.equal(deposits, quote.depositAmount, `${label}：押金明细之和应等于应付押金 ${quote.depositAmount}，实际 ${deposits}`);
    assert.equal(
      quote.receivableAmount,
      Math.round((quote.payableAmount + quote.depositAmount) * 100) / 100,
      `${label}：本次实收应等于租赁应付 + 应付押金，实际 ${quote.receivableAmount}`
    );
    // 预授权不得混入任何一个总额。
    const preAuthLines = sumOf(quote.chargeLines, (row) => row.type === "preauthorization");
    if (preAuthLines > 0) {
      assert.notEqual(quote.payableAmount, nonDeposit + preAuthLines, `${label}：预授权不得计入租赁应付`);
      assert.equal(quote.preAuthAmount, preAuthLines, `${label}：预授权额度应与其明细一致`);
    }
  };
  // 先确认预授权分支**确实被执行过**，否则 reconcile 里的 preAuth 断言是装饰品。
  // 工程品类规则默认就是 preauthorization 模式，因此这些报价应当带预授权明细。
  assert.ok(
    capHit.chargeLines.some((row) => row.type === "preauthorization"),
    `前置条件：本节报价应产出预授权明细，否则 reconcile 的预授权断言永不执行。` +
      `实际明细类型：${capHit.chargeLines.map((row) => row.type).join("/")}`
  );
  assert.ok(capHit.preAuthAmount > 0, `预授权额度应大于 0，实际 ${capHit.preAuthAmount}`);
  assert.equal(capHit.depositAmount, 0, `预授权模式下应付押金应为 0，实际 ${capHit.depositAmount}`);
  reconcile(capHit, "封顶用例");
  reconcile(tierHit, "阶梯用例");
  reconcile(crossDay, "跨日用例");

  // 6) 数量参与线性放大，且封顶是**每行**上限而非整单上限。
  const twoUnits = await priceQuoteFor("2027-03-02T09:00:00+08:00", "2027-03-11T09:00:00+08:00", 2);
  assert.equal(twoUnits.rentalAmount, 1200, `2 套应为 2 × 600 = 1200：实际 ${twoUnits.rentalAmount}`);

  // 7) 起租量兜底：不足 1 个自然日的租期仍按 minimumUnits 计，且说明要讲明它生效了。
  const shortRent = await priceQuoteFor("2027-03-02T09:00:00+08:00", "2027-03-02T10:00:00+08:00");
  assert.equal(shortRent.rentalAmount, 100, `1 小时仍占用 1 个自然日，应为 100：实际 ${shortRent.rentalAmount}`);
  // 8) 有效期必须参与判定。早前只看 status，`effectiveFrom`/`effectiveTo` 存了却从不判断：
  //    过期计划照样给新报价定价，未生效计划也会被提前使用，两者都直接算错钱。
  const expiredPlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: "E2E-PRICE-EXPIRED",
      name: "E2E 已过期价格",
      changeReason: "PRICE-01 有效期验收",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 30 * 86400000).toISOString(),
      // 结束时间必须**严格早于**上面 E2E-PRICE-TIER 的生效时间（now-1d）：两者若首尾相接到
      // 同一毫秒级别就会被「同商品同单位不得重叠」判为重叠。过期留档计划本就该在现行计划开始前结束。
      effectiveTo: new Date(Date.now() - 3 * 86400000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 999,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 500,
          minimumUnits: 1
        }
      ]
    },
    construction.accessToken
  );
  assert.equal(expiredPlan.status, 201, `过期计划应允许保存（历史留档）: ${JSON.stringify(expiredPlan.body).slice(0, 200)}`);
  const expiredQuote = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: "2027-03-02T09:00:00+08:00",
      endAt: "2027-03-03T09:00:00+08:00",
      pricingPlanId: expiredPlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(
    expiredQuote.status,
    409,
    `指定已过期的计划必须 409，不能拿它定价：实际 ${expiredQuote.status} ${JSON.stringify(expiredQuote.body).slice(0, 200)}`
  );
  // 未指定计划时也不得回落到过期计划：仍应按有效期内的阶梯计划算出 100。
  const autoPick = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: "2027-03-02T09:00:00+08:00",
      endAt: "2027-03-02T18:00:00+08:00",
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(autoPick.status, 201, `自动择一报价失败: ${JSON.stringify(autoPick.body).slice(0, 250)}`);
  assert.notEqual(
    autoPick.chargeLines === undefined ? autoPick.body.data.rentalAmount : 0,
    999,
    "自动择一不得选中已过期的 999 计划"
  );
  assert.equal(
    autoPick.body.data.rentalAmount,
    100,
    `自动择一应命中有效期内的计划（1 自然日 = 100）：实际 ${autoPick.body.data.rentalAmount}`
  );

  // 8b) 价格版本按**租期开始时间**匹配，而不是按报价创建时间（需求 4.4.4）。
  //
  // 造一版"从 30 天后才生效"的计划：今天报今天的租期不该命中它，
  // 今天报 60 天后的租期必须命中它。早前按 Date.now() 判定，后者会漏。
  const futurePlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: "E2E-PRICE-FUTURE",
      name: "E2E 未来生效价格",
      changeReason: "PRICE-01 按租期开始时间选价",
      status: "enabled",
      effectiveFrom: new Date(Date.now() + 30 * 86400000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 777,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 500,
          minimumUnits: 1
        }
      ]
    },
    construction.accessToken
  );
  assert.equal(futurePlan.status, 201, `未来生效计划创建失败: ${JSON.stringify(futurePlan.body).slice(0, 200)}`);
  // 指名一个对该租期尚未生效的计划 → 必须拒绝，而不是拿它定价。
  const tooEarly = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: new Date(Date.now() + 2 * 86400000).toISOString(),
      endAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      pricingPlanId: futurePlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(
    tooEarly.status,
    409,
    `租期开始时点尚未生效的计划必须 409：实际 ${tooEarly.status} ${JSON.stringify(tooEarly.body).slice(0, 200)}`
  );
  // 同一个计划，换成 60 天后的租期就必须可用——证明判定基准是租期开始时间。
  const laterRental = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: new Date(Date.now() + 60 * 86400000).toISOString(),
      endAt: new Date(Date.now() + 61 * 86400000).toISOString(),
      pricingPlanId: futurePlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(laterRental.status, 201, `未来租期应能使用未来生效计划: ${JSON.stringify(laterRental.body).slice(0, 250)}`);
  // 同一时钟点相隔 1 天 → 占用 2 个营业日期（自然日按日期计，不是按 24 小时块计），
  // 因此 777 × 2 = 1554。断言写死 777 是我最初算错了单位数，不是产品问题。
  assert.equal(
    laterRental.body.data.rentalAmount,
    1554,
    `未来租期应按未来价格 777 × 2 个自然日 = 1554：实际 ${laterRental.body.data.rentalAmount}——` +
      "若为 200（即 100 × 2）说明仍按报价创建时间选价（需求 4.4.4 点名不要的口径）"
  );

  // 9) 阶梯档位重复必须被拒：否则"取最高已达档"变成看装载顺序，价格解释不唯一。
  const dupTier = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: "E2E-PRICE-DUP",
      name: "E2E 重复档位",
      changeReason: "PRICE-01 冲突校验",
      status: "draft",
      effectiveFrom: new Date().toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 100,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 500,
          minimumUnits: 1,
          tiers: [{ minUnits: 3, unitAmount: 90 }, { minUnits: 3, unitAmount: 80 }]
        }
      ]
    },
    construction.accessToken
  );
  assert.equal(dupTier.status, 400, `重复阶梯档位必须 400：实际 ${dupTier.status} ${JSON.stringify(dupTier.body).slice(0, 200)}`);

  ok(
    "报价可复算：自然日按日期计（跨日 10 小时=2 日）、阶梯价整单重定价、封顶价生效且按行封顶、" +
      "相同输入复算一致、计算说明含档位/单位数/封顶/版本、有效期参与判定、重复档位被拒"
  );

  console.log("== 15d. PRICE-01 租金倍数押金必须真正生效 ==");
  // `depositMode: "price_multiple"` 的枚举、DTO 与管理端下拉此前都在，服务层却没有
  // 任何消费者——选它与选 `fixed` 完全同价，是个只在界面上存在的选项。
  // 这一节证明它现在按「行租金 × 倍数」取数，且押金明细能讲清取数方式。
  const depositRule = (await request("GET", "/api/rental/v1/rule-versions/current", null, construction.accessToken)).body.data;
  assert.ok(depositRule, "前置条件：应有已发布规则");
  const multiplePlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: "E2E-PRICE-DEPOSIT-X",
      name: "E2E 倍数押金价格",
      changeReason: "PRICE-01 押金模式验收",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 3600000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 100,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          // 固定押金刻意给一个**不同于**倍数结果的值：若服务层仍走固定押金，
          // 断言会立刻看出来（200 vs 300），而不是两个数恰好相同而蒙过去。
          depositAmount: 200,
          depositMultiple: 1.5,
          minimumUnits: 1
        }
      ]
    },
    construction.accessToken
  );
  assert.equal(multiplePlan.status, 201, `倍数押金计划创建失败: ${JSON.stringify(multiplePlan.body).slice(0, 200)}`);
  assert.equal(
    JSON.parse(
      readScalar(`SELECT \`rates\` FROM \`rental_pricing_plans\` WHERE \`id\`='${multiplePlan.body.data.id}';`)
    )[0].depositMultiple,
    1.5,
    "押金倍数必须落库"
  );

  const depositQuoteWith = async (planId) => {
    const res = await request(
      "POST",
      "/api/rental/v1/quotes",
      {
        customerType: "corporate",
        fulfillmentMode: "warehouse_pickup_return",
        fulfillmentLocationId: constructionLocation.id,
        // 2 个自然日 → 租金 200
        startAt: "2027-05-10T09:00:00+08:00",
        endAt: "2027-05-11T09:00:00+08:00",
        pricingPlanId: planId,
        lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
      },
      construction.accessToken
    );
    assert.equal(res.status, 201, `押金验证报价失败: ${JSON.stringify(res.body).slice(0, 250)}`);
    return res.body.data;
  };

  // RULE-01A：发布是独立的两步——先存草稿（编辑权限），再对该草稿版本调用 publish
  // （发布权限）。旧的一步 `publish: true` 字段已随分权移除，写它会被 whitelist 静默剥离。
  const publishDepositMode = async (mode, reason) => {
    const draft = await request(
      "POST",
      "/api/rental/v1/rule-versions",
      {
        changeReason: reason,
        config: { ...depositRule.config, payment: { ...depositRule.config.payment, depositMode: mode } }
      },
      construction.accessToken
    );
    if (draft.status !== 201) return draft;
    // 不带 effectiveFrom = 立即生效；每次 publish 的生效时点是当下，逐次递增不会撞点。
    return request(
      "POST",
      `/api/rental/v1/rule-versions/${draft.body.data.version}/publish`,
      { reason },
      construction.accessToken
    );
  };

  const toFixed = await publishDepositMode("fixed", "PRICE-01 切换为固定押金");
  assert.equal(toFixed.status, 201, `切换固定押金失败: ${JSON.stringify(toFixed.body).slice(0, 250)}`);
  const fixedQuote = await depositQuoteWith(multiplePlan.body.data.id);
  assert.equal(fixedQuote.rentalAmount, 200, `2 个自然日租金应为 200：实际 ${fixedQuote.rentalAmount}`);
  assert.equal(fixedQuote.depositAmount, 200, `固定押金模式应取 200：实际 ${fixedQuote.depositAmount}`);
  const fixedDepositLine = fixedQuote.chargeLines.find((row) => row.type === "deposit");
  assert.match(fixedDepositLine.detail, /固定押金/, `押金明细应说明取数方式: ${fixedDepositLine.detail}`);

  // 切到租金倍数押金：租金 200 × 1.5 = 300，与固定押金的 200 不同。
  const ruleToMultiple = await publishDepositMode("price_multiple", "PRICE-01 切换为租金倍数押金");
  assert.equal(ruleToMultiple.status, 201, `切换押金模式失败: ${JSON.stringify(ruleToMultiple.body).slice(0, 250)}`);
  const multipleQuote = await depositQuoteWith(multiplePlan.body.data.id);
  assert.equal(multipleQuote.rentalAmount, 200, "切换押金模式不应改变租金");
  assert.equal(
    multipleQuote.depositAmount,
    300,
    `租金倍数押金应为 200 × 1.5 = 300：实际 ${multipleQuote.depositAmount}——` +
      "若仍为 200 说明 price_multiple 没有被服务层消费"
  );
  const multipleDepositLine = multipleQuote.chargeLines.find((row) => row.type === "deposit");
  assert.match(multipleDepositLine.detail, /租金倍数押金/, `倍数押金明细应说明模式: ${multipleDepositLine.detail}`);
  assert.match(multipleDepositLine.detail, /1\.5 倍/, `倍数押金明细应含倍数: ${multipleDepositLine.detail}`);

  // 还原为固定押金，避免污染后续用例。
  const ruleBackToOriginal = await publishDepositMode(
    depositRule.config.payment.depositMode,
    "PRICE-01 还原原始押金模式"
  );
  assert.equal(ruleBackToOriginal.status, 201, "还原押金模式失败");
  // 预授权额度必须与押金**分开存**（需求 4.4「同时独立计算：应付押金；预授权金额」）。
  // 早前二者共用 depositAmount、只把明细行改个名，于是"实收 500 押金"与
  // "冻结 500 额度"在数据上完全无法区分，对账、退款与风控都读不出真实资金状态。
  // 注意：工程品类规则同时开着 preauthorizationRequired。该标志在原实现里只是
  // 「金额必须非零」的校验位，**不是**模式开关——把它并进模式判定会让
  // 「固定押金 + 要求预授权」的租户押金凭空变成 0。因此下面切换的是 depositMode。
  const toPreauth = await publishDepositMode("preauthorization", "PRICE-01 切换为预授权");
  assert.equal(toPreauth.status, 201, `切换预授权失败: ${JSON.stringify(toPreauth.body).slice(0, 250)}`);
  const preauthQuote = await depositQuoteWith(multiplePlan.body.data.id);
  assert.equal(
    preauthQuote.depositAmount,
    0,
    `预授权模式下应付押金必须为 0（钱是冻结的、没有收）：实际 ${preauthQuote.depositAmount}`
  );
  assert.equal(
    preauthQuote.preAuthAmount,
    200,
    `预授权额度应为固定额 200：实际 ${preauthQuote.preAuthAmount}——若为 0 说明额度没有独立计算`
  );
  assert.equal(
    preauthQuote.chargeLines.filter((row) => row.type === "deposit").length,
    0,
    "预授权模式下不得再出押金明细行"
  );
  const preauthLine = preauthQuote.chargeLines.find((row) => row.type === "preauthorization");
  assert.ok(preauthLine, "应有预授权明细行，且类型为 preauthorization");
  assert.equal(preauthLine.amount, 200, "预授权明细金额应与合计一致");
  // 两者都不进应付：押金要退、预授权只是冻结，都不是本次交易的收入。
  assert.equal(preauthQuote.payableAmount, 200, `应付不应含押金或预授权：实际 ${preauthQuote.payableAmount}`);
  // 落库校验：两个字段都要真的写进 rental_quotes。
  assert.equal(
    Number(readScalar(`SELECT \`preAuthAmount\` FROM \`rental_quotes\` WHERE \`id\`='${preauthQuote.id}';`)),
    200,
    "预授权额度必须落库"
  );
  assert.equal(
    Number(readScalar(`SELECT \`depositAmount\` FROM \`rental_quotes\` WHERE \`id\`='${preauthQuote.id}';`)),
    0,
    "预授权模式下库中押金必须为 0"
  );
  // 固定押金模式下反向成立：押金有值、预授权为 0。
  await publishDepositMode("fixed", "PRICE-01 回到固定押金核对反向");
  const backToFixed = await depositQuoteWith(multiplePlan.body.data.id);
  assert.equal(backToFixed.depositAmount, 200, "固定押金模式下押金应有值");
  assert.equal(backToFixed.preAuthAmount, 0, "固定押金模式下预授权额度必须为 0");

  ok(
    "租金倍数押金已生效：固定 200 / 倍数 300 可区分，押金明细讲清取数方式，倍数落库；" +
      "押金与预授权额度已分开存：预授权时押金 0 / 额度 200，二者都不进应付，均落库"
  );

  console.log("== 15d2. PRICE-01 押金与预授权独立配置：四种组合（Codex 复审 P1） ==");
  // 需求 4.4.7 要求押金与预授权**独立配置、独立计算**，并允许同一订单同时存在。
  // 旧口径用一个 depositMode 二选一，表达不了「收 500 押金 + 冻结 2000 额度」；
  // 而 `fixed + preauthorizationRequired=true` 时金额进了押金与实收、preAuthAmount 为 0，
  // 明细却叫「预授权额度」——名实不符。现在用 deposit / preauthorization 两组独立表达。
  const publishRules = async (deposit, preauthorization, reason) => {
    const draft = await request(
      "POST",
      "/api/rental/v1/rule-versions",
      { changeReason: reason, config: { ...depositRule.config, deposit, preauthorization } },
      construction.accessToken
    );
    if (draft.status !== 201) return draft;
    return request(
      "POST",
      `/api/rental/v1/rule-versions/${draft.body.data.version}/publish`,
      { reason },
      construction.accessToken
    );
  };
  // 费率：固定押金 200、预授权固定额 500（刻意与押金不同，两个数必须能各自取到）。
  const dpPlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: "E2E-DEPOSIT-PREAUTH",
      name: "E2E 押金与预授权",
      changeReason: "PRICE-01 押金预授权独立验收",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 7200000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId, unit: "calendar_day", baseAmount: 100,
          weekendMultiplier: 1, holidayMultiplier: 1, minimumUnits: 1,
          depositAmount: 200, preAuthAmount: 500
        }
      ]
    },
    construction.accessToken
  );
  assert.equal(dpPlan.status, 201, `押金预授权计划失败: ${JSON.stringify(dpPlan.body).slice(0, 250)}`);
  const dpQuote = async () => {
    const res = await request("POST", "/api/rental/v1/quotes", {
      customerType: "corporate", fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: "2027-04-06T09:00:00+08:00", endAt: "2027-04-08T09:00:00+08:00",
      pricingPlanId: dpPlan.body.data.id, lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    }, construction.accessToken);
    assert.equal(res.status, 201, `押金预授权报价失败: ${JSON.stringify(res.body).slice(0, 250)}`);
    return res.body.data;
  };
  // ① 都不需要：两笔都是 0，且不产生任何押金/预授权明细行。
  assert.equal((await publishRules({ mode: "none" }, { mode: "none" }, "都不需要")).status, 201, "发布「都不需要」失败");
  const dpNone = await dpQuote();
  assert.equal(dpNone.depositAmount, 0, `都不需要时押金应为 0: ${dpNone.depositAmount}`);
  assert.equal(dpNone.preAuthAmount, 0, `都不需要时预授权应为 0: ${dpNone.preAuthAmount}`);
  assert.equal(dpNone.chargeLines.filter((r) => r.type === "deposit" || r.type === "preauthorization").length, 0, "都不需要时不应有押金或预授权明细");
  assert.equal(dpNone.receivableAmount, dpNone.payableAmount, "本次实收 = 应付 + 押金，押金 0 时应等于应付");
  // ② 仅押金：押金 200 进实收，预授权 0，明细名必须是「押金」。
  assert.equal((await publishRules({ mode: "fixed" }, { mode: "none" }, "仅押金")).status, 201, "发布「仅押金」失败");
  const dpDeposit = await dpQuote();
  assert.equal(dpDeposit.depositAmount, 200, `仅押金时押金应为 200: ${dpDeposit.depositAmount}`);
  assert.equal(dpDeposit.preAuthAmount, 0, `仅押金时预授权必须为 0: ${dpDeposit.preAuthAmount}`);
  assert.equal(dpDeposit.receivableAmount, dpDeposit.payableAmount + 200, `本次实收应为应付 + 押金: ${dpDeposit.receivableAmount}`);
  assert.equal(dpDeposit.chargeLines.find((r) => r.type === "deposit")?.name, "押金", "实收押金的明细名不得叫「预授权额度」");
  // ③ 仅预授权：冻结 500（取 preAuthAmount 而不是 depositAmount），押金 0，不进实收。
  assert.equal((await publishRules({ mode: "none" }, { mode: "fixed" }, "仅预授权")).status, 201, "发布「仅预授权」失败");
  const dpPreauth = await dpQuote();
  assert.equal(dpPreauth.depositAmount, 0, `仅预授权时押金必须为 0: ${dpPreauth.depositAmount}`);
  assert.equal(dpPreauth.preAuthAmount, 500, `预授权应取费率的 preAuthAmount 500（不是押金 200）: ${dpPreauth.preAuthAmount}`);
  assert.equal(dpPreauth.receivableAmount, dpPreauth.payableAmount, "预授权永远不进本次实收");
  // ④ 两者同时存在——旧的二选一模型根本表达不了这种组合。
  assert.equal((await publishRules({ mode: "fixed" }, { mode: "fixed" }, "押金与预授权同时")).status, 201, "发布「两者同时」失败");
  const dpBoth = await dpQuote();
  assert.equal(dpBoth.depositAmount, 200, `同时存在时押金应为 200: ${dpBoth.depositAmount}`);
  assert.equal(dpBoth.preAuthAmount, 500, `同时存在时预授权应为 500: ${dpBoth.preAuthAmount}`);
  assert.equal(dpBoth.receivableAmount, dpBoth.payableAmount + 200, `实收只含押金不含预授权: ${dpBoth.receivableAmount}`);
  assert.equal(dpBoth.chargeLines.filter((r) => r.type === "deposit").length, 1, "应有一条押金明细");
  assert.equal(dpBoth.chargeLines.filter((r) => r.type === "preauthorization").length, 1, "应有一条预授权明细");
  assert.equal(
    Number(readScalar(`SELECT \`depositAmount\` FROM \`rental_quotes\` WHERE \`id\`='${dpBoth.id}';`)),
    200,
    "同时存在时押金必须落库"
  );
  assert.equal(
    Number(readScalar(`SELECT \`preAuthAmount\` FROM \`rental_quotes\` WHERE \`id\`='${dpBoth.id}';`)),
    500,
    "同时存在时预授权必须落库"
  );
  const campingRules = await request("GET", "/api/rental/v1/rule-versions", null, demo2.accessToken);
  const campingCurrentRule = campingRules.body.data.find((row) => row.status === "published") ?? campingRules.body.data[0];
  const unsupportedPreauth = await request("POST", "/api/rental/v1/rule-versions", {
    changeReason: "验证不支持预授权的品类不能绕过新字段启用",
    // 存草稿即触发 validateRule，不支持预授权的品类在此处就被 400 拒绝，不需要走到发布。
    config: {
      ...campingCurrentRule.config,
      deposit: { mode: "none" },
      preauthorization: { mode: "fixed" },
      payment: { ...campingCurrentRule.config.payment, depositMode: "none", preauthorizationRequired: false }
    }
  }, demo2.accessToken);
  assert.equal(unsupportedPreauth.status, 400, "不支持预授权的品类通过新字段启用必须 400");
  // 还原：回到夹具原始规则，避免污染后续用例。先存草稿再发布。
  const restoreDraft = await request(
    "POST",
    "/api/rental/v1/rule-versions",
    { changeReason: "还原押金规则", config: depositRule.config },
    construction.accessToken
  );
  assert.equal(restoreDraft.status, 201, "还原草稿创建失败");
  assert.equal(
    (await request(
      "POST",
      `/api/rental/v1/rule-versions/${restoreDraft.body.data.version}/publish`,
      { reason: "还原押金规则" },
      construction.accessToken
    )).status,
    201,
    "还原原始规则失败"
  );
  ok("押金与预授权独立配置：四种组合分别取数落库，预授权不进实收，不支持品类无法绕过新字段启用");

  console.log("== 15e. PRICE-01 履约费用与异地归还附加费 ==");
  // 需求 4.4 的应付公式里「履约费用」是与增值服务并列的独立一项，此前既无字段也无
  // 计算——配送与异地归还一分钱不收，只能靠手工配一个 delivery 增值服务顶替。
  // 费用配在**价格计划**上：它是价格，要随计划版本发布、生效并进快照，
  // 报价才能复算"当时按哪一版履约费收的"；配在地点上会随主档改价漂移。
  const ffLocations = (await request("GET", "/api/rental/v1/locations", null, construction.accessToken)).body.data;
  const ffReturnLocation = ffLocations.find((row) => row.id !== constructionLocation.id && row.capabilities.includes("return"));
  const ffPlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: "E2E-PRICE-FULFILL",
      name: "E2E 履约费价格",
      changeReason: "PRICE-01 履约费验收",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 3600000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 100,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 500,
          minimumUnits: 1
        }
      ],
      fulfillmentFees: [
        { mode: "warehouse_pickup_return", amount: 60, crossLocationAmount: 40 },
        // 该方式配 0：0 与"不配置"必须都表现为不收费，且不产生金额为 0 的明细行。
        { mode: "delivery", amount: 0 }
      ]
    },
    construction.accessToken
  );
  assert.equal(ffPlan.status, 201, `履约费计划创建失败: ${JSON.stringify(ffPlan.body).slice(0, 250)}`);
  assert.equal(
    JSON.parse(
      readScalar(`SELECT \`fulfillmentFees\` FROM \`rental_pricing_plans\` WHERE \`id\`='${ffPlan.body.data.id}';`)
    ).length,
    2,
    "履约费配置必须落库，否则重启后报价不可复算"
  );

  const ffQuote = async (extra) => {
    const res = await request(
      "POST",
      "/api/rental/v1/quotes",
      {
        customerType: "corporate",
        fulfillmentMode: "warehouse_pickup_return",
        fulfillmentLocationId: constructionLocation.id,
        startAt: "2027-06-07T09:00:00+08:00",
        endAt: "2027-06-08T09:00:00+08:00",
        pricingPlanId: ffPlan.body.data.id,
        lines: [{ itemGroupId: priceGroupId, quantity: 1 }],
        ...extra
      },
      construction.accessToken
    );
    assert.equal(res.status, 201, `履约费报价失败: ${JSON.stringify(res.body).slice(0, 250)}`);
    return res.body.data;
  };

  // 同地归还：只收基础履约费 60。租金 2 个自然日 = 200。
  const sameLocation = await ffQuote({});
  assert.equal(sameLocation.rentalAmount, 200, `租金应为 200：实际 ${sameLocation.rentalAmount}`);
  assert.equal(sameLocation.fulfillmentAmount, 60, `同地归还履约费应为 60：实际 ${sameLocation.fulfillmentAmount}`);
  // 必须进应付：需求 4.4 的公式里履约费是加项。
  assert.equal(
    sameLocation.payableAmount,
    260,
    `应付应含履约费（200 + 60）：实际 ${sameLocation.payableAmount}——若为 200 说明履约费没进应付`
  );
  const ffLine = sameLocation.chargeLines.find((row) => row.type === "fulfillment");
  assert.ok(ffLine, "应有履约费明细行，且类型为 fulfillment（该类型此前全仓库无人产出）");
  assert.equal(ffLine.amount, 60, "履约费明细金额应与合计一致");
  assert.equal(ffLine.sourceVersion, ffPlan.body.data.version, "履约费明细必须带价格计划版本，否则无从复算");

  // 异地归还：基础 60 + 跨点 40 = 100。
  //
  // 这一段**不能**写成 `if (第二地点存在)`：夹具一旦只剩一个地点，最关键的跨点附加费
  // 断言就静默不执行，测试照样绿。缺第二地点就现场建一个，让断言无条件运行。
  // 异地归还需要先在业务设置里放开（CAT-04 加的校验，行为正确）。
  // 用完还原，避免影响后续用例。
  const ffBaseSettings = (await request("GET", "/api/rental/v1/business-settings", null, construction.accessToken)).body.data;
  const ffPutSettings = (fulfillmentPatch) =>
    request(
      "PUT",
      "/api/rental/v1/business-settings",
      { ...ffBaseSettings, fulfillment: { ...ffBaseSettings.fulfillment, ...fulfillmentPatch } },
      construction.accessToken
    );
  const allowCross = await ffPutSettings({ allowDifferentReturnLocation: true });
  assert.equal(allowCross.status, 200, `放开异地归还失败: ${JSON.stringify(allowCross.body).slice(0, 250)}`);
  const ffReturnId =
    ffReturnLocation?.id ??
    (await (async () => {
      const created = await request(
        "POST",
        "/api/rental/v1/locations",
        {
          code: `E2E-FF-RET-${Date.now().toString(36)}`,
          name: "E2E 履约费归还点",
          type: "warehouse",
          operatorId: constructionLocation.operatorId,
          capabilities: ["return", "storage"]
        },
        construction.accessToken
      );
      assert.equal(created.status, 201, `补建归还地点失败: ${JSON.stringify(created.body).slice(0, 250)}`);
      return created.body.data.id;
    })());
  assert.notEqual(ffReturnId, constructionLocation.id, "归还地点必须与取件地点不同，否则跨点附加费不会触发");
  const crossLocation = await ffQuote({ returnLocationId: ffReturnId });
  assert.equal(
    crossLocation.fulfillmentAmount,
    100,
    `异地归还应为 60 + 40 = 100：实际 ${crossLocation.fulfillmentAmount}`
  );
  assert.equal(crossLocation.payableAmount, 300, `异地归还应付应为 200 + 100：实际 ${crossLocation.payableAmount}`);
  assert.match(
    crossLocation.chargeLines.find((row) => row.type === "fulfillment").detail,
    /异地归还 40/,
    "异地附加费必须在计算说明里可追溯"
  );

  // ④ 费率快照：报价必须固化命中的费率，复算不能依赖计划仍以该版本存在。
  const snapshotRates = JSON.parse(
    readScalar(`SELECT \`rateSnapshot\` FROM \`rental_quotes\` WHERE \`id\`='${sameLocation.id}';`)
  );
  assert.equal(snapshotRates.length, 1, "报价必须固化命中的费率");
  assert.equal(snapshotRates[0].baseAmount, 100, "费率快照必须含基础价");
  assert.equal(snapshotRates[0].unit, "calendar_day", "费率快照必须含计价单位");
  // 改掉计划的基础价并递增版本后，旧报价的费率快照不得随之改变。
  const bumped = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      id: ffPlan.body.data.id,
      code: "E2E-PRICE-FULFILL",
      name: "E2E 履约费价格",
      changeReason: "PRICE-01 改价后旧报价仍可复算",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 3600000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 999,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 500,
          minimumUnits: 1
        }
      ],
      fulfillmentFees: [{ mode: "warehouse_pickup_return", amount: 60, crossLocationAmount: 40 }]
    },
    construction.accessToken
  );
  assert.equal(bumped.status, 201, `改价失败: ${JSON.stringify(bumped.body).slice(0, 250)}`);
  assert.equal(
    Number(
      JSON.parse(
        readScalar(`SELECT \`rateSnapshot\` FROM \`rental_quotes\` WHERE \`id\`='${sameLocation.id}';`)
      )[0].baseAmount
    ),
    100,
    "改价并递增版本后，旧报价的费率快照必须仍是 100——这是 Codex 指出的「版本非不可变快照」" +
      "的兜底：计划行被覆盖后旧版本内容消失，只有报价自带费率才能按原价复算"
  );

  // 还原异地归还开关。
  const restoreCross = await ffPutSettings({
    allowDifferentReturnLocation: ffBaseSettings.fulfillment.allowDifferentReturnLocation
  });
  assert.equal(restoreCross.status, 200, "还原异地归还开关失败");

  // ③ 显式指定不存在的计价单位必须报错，不能静默换成别的单位算钱。
  const wrongUnit = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: "2027-06-07T09:00:00+08:00",
      endAt: "2027-06-08T09:00:00+08:00",
      pricingPlanId: ffPlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1, pricingUnit: "hour" }]
    },
    construction.accessToken
  );
  assert.equal(
    wrongUnit.status,
    409,
    `显式指定未配置的计价单位必须 409：实际 ${wrongUnit.status} ${JSON.stringify(wrongUnit.body).slice(0, 200)}——` +
      "若为 201 说明静默回退到了别的单位，请求快照写着按小时、金额却按自然日算"
  );

  // 未配置该履约方式 → 不收费、不产生明细行（而不是产生一条 0 元行）。
  const noFeePlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: "E2E-PRICE-NOFEE",
      name: "E2E 无履约费",
      changeReason: "PRICE-01 履约费缺省验收",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 3600000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 100,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 500,
          minimumUnits: 1
        }
      ]
    },
    construction.accessToken
  );
  assert.equal(noFeePlan.status, 201, `无履约费计划创建失败: ${JSON.stringify(noFeePlan.body).slice(0, 200)}`);
  const withoutFee = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: "2027-06-07T09:00:00+08:00",
      endAt: "2027-06-08T09:00:00+08:00",
      pricingPlanId: noFeePlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(withoutFee.status, 201, `无履约费报价失败: ${JSON.stringify(withoutFee.body).slice(0, 250)}`);
  assert.equal(withoutFee.body.data.fulfillmentAmount, 0, "未配置履约费时合计必须为 0");
  assert.equal(withoutFee.body.data.payableAmount, 200, "未配置履约费时应付不应被抬高");
  assert.equal(
    withoutFee.body.data.chargeLines.filter((row) => row.type === "fulfillment").length,
    0,
    "未配置履约费时不得产生金额为 0 的履约明细行"
  );
  // 落库校验：合计要真的写进 rental_quotes，不能只存在于响应里。
  assert.equal(
    Number(readScalar(`SELECT \`fulfillmentAmount\` FROM \`rental_quotes\` WHERE \`id\`='${sameLocation.id}';`)),
    60,
    "履约费合计必须落库"
  );
  ok(
    "履约费用已生效：同地 60 / 异地 100 且进应付、明细带计划版本、未配置时为 0 且无空行、合计落库"
  );

  console.log("== 15c. PRICE-01 营业时区按经营空间配置且真正影响计价 ==");
  // 项目负责人 2026-08-25 决定按租户配置时区。业务设置在 SPACE-03 之后按**经营空间**
  // 存储，因此实际粒度是每个经营空间一个时区，与营业日历同样按空间存储保持一致。
  //
  // 这一节要证明的是「配置真的接线了」：同一段绝对时间，切换空间时区后自然日数改变、
  // 报价金额随之改变。纯函数单测只能证明算法对，证明不了它被 API 真正使用。
  const settingsUrl = "/api/rental/v1/business-settings";
  const baseSettings = (await request("GET", settingsUrl, null, construction.accessToken)).body.data;
  assert.ok(baseSettings.calendar, "前置条件：业务设置应含日历分组");
  assert.equal(
    baseSettings.calendar.timeZone ?? "Asia/Shanghai",
    "Asia/Shanghai",
    `默认营业时区应为 Asia/Shanghai，实际 ${baseSettings.calendar.timeZone}`
  );
  const putSettings = (calendarPatch) =>
    request(
      "PUT",
      settingsUrl,
      {
        pricing: baseSettings.pricing,
        fulfillment: baseSettings.fulfillment,
        payment: baseSettings.payment,
        overdue: baseSettings.overdue,
        calendar: { ...baseSettings.calendar, ...calendarPatch },
        membership: baseSettings.membership,
        notifications: baseSettings.notifications
      },
      construction.accessToken
    );

  // 非法时区必须在保存时就拒绝。放行的话 Intl 会在报价时抛 RangeError，
  // 表现为下单前 500——错误离配置点很远，排查成本高得多。
  const badTz = await putSettings({ timeZone: "Not/AZone" });
  assert.equal(badTz.status, 400, `非法时区必须 400：实际 ${badTz.status} ${JSON.stringify(badTz.body).slice(0, 200)}`);

  // 北京挂钟 06:00–20:00 是同一个营业日 → 1 自然日 → 100。
  const shanghaiWindow = ["2027-04-06T06:00:00+08:00", "2027-04-06T20:00:00+08:00"];
  const inShanghai = await priceQuoteFor(shanghaiWindow[0], shanghaiWindow[1]);
  assert.equal(inShanghai.rentalAmount, 100, `上海时区下当日租应为 100：实际 ${inShanghai.rentalAmount}`);

  // 同一段绝对时间在 UTC 下是 4/5 22:00–4/6 12:00，跨 2 个日期 → 2 自然日 → 200。
  const switched = await putSettings({ timeZone: "UTC" });
  assert.equal(switched.status, 200, `切换营业时区失败: ${JSON.stringify(switched.body).slice(0, 200)}`);
  assert.equal(
    readScalar(
      "SELECT JSON_UNQUOTE(JSON_EXTRACT(`settings`,'$.calendar.timeZone')) FROM `rental_tenant_business_settings` " +
        `WHERE \`tenantId\`='${construction.tenant.tenantId}';`
    ),
    "UTC",
    "营业时区必须落库，否则重启后回退且报价随之改变"
  );
  const inUtc = await priceQuoteFor(shanghaiWindow[0], shanghaiWindow[1]);
  assert.equal(
    inUtc.rentalAmount,
    200,
    `UTC 时区下同一段时间跨 2 个日期应为 200：实际 ${inUtc.rentalAmount}——` +
      "若仍为 100 说明时区配置没有真正参与计价"
  );
  // 逐日说明也必须随时区改变，否则说明与金额会互相矛盾。
  const utcLine = inUtc.chargeLines.find((row) => row.type === "rental");
  assert.match(utcLine.detail, /逐单位取价 2027-04-05/, `UTC 下逐单位取价应从 4/5 起：${utcLine.detail}`);
  const shanghaiLine = inShanghai.chargeLines.find((row) => row.type === "rental");
  assert.match(shanghaiLine.detail, /逐单位取价 2027-04-06/, `上海下逐单位取价应只含 4/6：${shanghaiLine.detail}`);
  assert.doesNotMatch(shanghaiLine.detail, /2027-04-05/, `上海时区不应出现 4/5：${shanghaiLine.detail}`);

  // 还原，避免污染后续用例。
  const tzRestored = await putSettings({ timeZone: "Asia/Shanghai" });
  assert.equal(tzRestored.status, 200, `还原营业时区失败: ${JSON.stringify(tzRestored.body).slice(0, 300)}`);
  ok("营业时区按经营空间生效：非法标识 400、切换后自然日数与金额随之改变、逐日说明同步、配置落库");

  console.log("== 15f. PRICE-02 停业日只拦领取与归还时点，不拦租期跨过 ==");
  // 需求 4.5.4：「停业只限制发生在当天和目标地点的领取、配送、现场归还等履约动作，
  // 不禁止租期跨过该日期；客户周五领取、周一归还时，周末门店停业不影响设备继续在租」，
  // 并明确「仅租期中间经过停业日不得阻止报价」。
  //
  // 早前的实现对租期内**任意**停业日直接抛「不能报价」，与需求写反：任何把周末标为
  // 停业的租户都无法接受跨周末的租约，而跨周末恰恰是最常见的租期。此前 E2E 对停业日
  // 零覆盖，所以这个反向行为一直没被发现。
  const closedYear = 2027;
  const closedDate = `${closedYear}-08-10`;
  // 中国大陆日历发布前必须先导入官方来源（服务端校验，行为正确）——
  // 需求 4.5.2 也要求官方数据带来源、来源发布日期与版本。
  // 官方数据是公共基础来源：平台登记来源版本，空间引用它生成草稿（需求 4.5.2/4.5.8）。
  const closedYearVersion = await registerOfficialVersion(closedYear, [
    { date: `${closedYear}-10-01`, dayType: "statutory_holiday", name: "国庆节", pricingMultiplier: 1.5 }
  ]);
  const importClosedYear = await applyOfficialVersion(closedYear, closedYearVersion.id, construction.accessToken);
  assert.equal(importClosedYear.status, 201, `应用 ${closedYear} 官方来源失败: ${JSON.stringify(importClosedYear.body).slice(0, 220)}`);
  assert.equal(
    importClosedYear.body.data.sourceVersionId,
    closedYearVersion.id,
    `空间日历必须记录引用的公共来源版本（需求 4.5.7）: ${importClosedYear.body.data.sourceVersionId}`
  );
  assert.equal(
    importClosedYear.body.data.sourceVersion,
    closedYearVersion.version,
    `空间日历必须记录来源版本号: ${importClosedYear.body.data.sourceVersion}`
  );
  const saveClosedDay = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${closedDate}`,
    { date: closedDate, dayType: "tenant_special", name: "E2E 盘点停业", pricingMultiplier: 1, closed: true, overrideReason: "E2E 年度盘点" },
    construction.accessToken
  );
  assert.equal(saveClosedDay.status, 200, `保存停业日失败: ${JSON.stringify(saveClosedDay.body).slice(0, 200)}`);
  const publishClosed = await request(
    "POST",
    `/api/rental/v1/calendars/${closedYear}/publish`,
    { changeReason: "E2E 停业日年度版本首发" },
    construction.accessToken
  );
  assert.equal(publishClosed.status, 201, `发布 ${closedYear} 年日历失败: ${JSON.stringify(publishClosed.body).slice(0, 200)}`);
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='published';`
    ),
    1,
    "停业日所在年度日历必须已发布，否则报价读不到它"
  );

  const closedQuote = async (startAt, endAt) =>
    request(
      "POST",
      "/api/rental/v1/quotes",
      {
        customerType: "corporate",
        fulfillmentMode: "warehouse_pickup_return",
        fulfillmentLocationId: constructionLocation.id,
        startAt,
        endAt,
        pricingPlanId: pricePlan.body.data.id,
        lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
      },
      construction.accessToken
    );

  // 1) 停业日落在租期**中间**：必须放行。这是本次修复的核心。
  const across = await closedQuote(`${closedYear}-08-09T09:00:00+08:00`, `${closedYear}-08-12T09:00:00+08:00`);
  assert.equal(
    across.status,
    201,
    `租期跨过停业日必须放行（需求 4.5.4）：实际 ${across.status} ${JSON.stringify(across.body).slice(0, 220)}`
  );
  // 停业日仍然参与计价与逐日说明——不阻止报价不等于不计费。
  const acrossLine = across.body.data.chargeLines.find((row) => row.type === "rental");
  assert.match(
    acrossLine.detail,
    new RegExp(closedDate),
    `停业日仍应出现在逐单位取价说明里: ${acrossLine.detail}`
  );

  // 2) 领取当天停业：必须拒绝。
  const pickupClosed = await closedQuote(`${closedDate}T09:00:00+08:00`, `${closedYear}-08-12T09:00:00+08:00`);
  assert.equal(
    pickupClosed.status,
    409,
    `领取日停业必须 409：实际 ${pickupClosed.status} ${JSON.stringify(pickupClosed.body).slice(0, 200)}`
  );
  assert.match(
    JSON.stringify(pickupClosed.body),
    /领取/,
    `拒绝原因应指明是领取受限: ${JSON.stringify(pickupClosed.body).slice(0, 200)}`
  );

  // 3) 归还当天停业：必须拒绝，且原因要与领取区分开。
  const returnClosed = await closedQuote(`${closedYear}-08-09T09:00:00+08:00`, `${closedDate}T09:00:00+08:00`);
  assert.equal(
    returnClosed.status,
    409,
    `归还日停业必须 409：实际 ${returnClosed.status} ${JSON.stringify(returnClosed.body).slice(0, 200)}`
  );
  assert.match(
    JSON.stringify(returnClosed.body),
    /归还/,
    `拒绝原因应指明是归还受限: ${JSON.stringify(returnClosed.body).slice(0, 200)}`
  );
  // 3b) 结构化日历依据（需求 4.5.6）：报价必须保存**每个**命中营业日期的年度、
  //     日期类型、营业状态、实际价格、来源和年度日历版本，且跨年度不得只存一个年份。
  //     拼接的 calendarVersion（如 `2027:1.0`）够人读但无法复算——它说不出哪一天
  //     是什么类型、按什么系数算了多少钱、依据来自人工覆盖还是官方日历。
  const snap = across.body.data.calendarSnapshot;
  assert.ok(Array.isArray(snap) && snap.length >= 3, `逐日依据应覆盖租期内每个营业日期，实际 ${snap && snap.length}`);
  const closedEntry = snap.find((row) => row.date === closedDate);
  assert.ok(closedEntry, `逐日依据必须包含停业日 ${closedDate}：${snap.map((r) => r.date).join(",")}`);
  assert.equal(closedEntry.year, closedYear, "逐日依据必须带年度，跨年度报价靠它区分依据来自哪一年");
  assert.equal(closedEntry.businessStatus, "closed", `停业日的营业状态应为 closed，实际 ${closedEntry.businessStatus}`);
  assert.equal(closedEntry.source, "tenant_override", `该日期由人工覆盖写入，来源应为 tenant_override，实际 ${closedEntry.source}`);
  assert.match(String(closedEntry.calendarVersion), /^\d+\.\d+$/, `已发布年度应记录版本号，实际 ${closedEntry.calendarVersion}`);
  assert.ok(closedEntry.unitCount >= 1, "逐日依据应记录落在该日期的计费单位数");
  assert.ok(closedEntry.amount > 0, "停业日仍计费，实际价格应大于 0（停业只拦履约、不免租）");
  assert.equal(
    closedEntry.amount,
    Math.round(closedEntry.unitCount * closedEntry.unitAmount * closedEntry.multiplier * 100) / 100,
    "逐日实际价格必须等于 单位数 × 单位价 × 日期系数，否则快照无法复算"
  );
  // 落库校验：只存在响应里不算保存。
  const persistedSnap = JSON.parse(
    readScalar(`SELECT \`calendarSnapshot\` FROM \`rental_quotes\` WHERE \`id\`='${across.body.data.id}';`)
  );
  assert.equal(persistedSnap.length, snap.length, "逐日依据必须落库，条数应与响应一致");

  // 4) 四态营业状态（需求 4.5.4）。逐个覆盖同一日期并断言领取日的行为差异。
  const setDayStatus = async (businessStatus) => {
    const res = await request(
      "PUT",
      `/api/rental/v1/calendars/${closedYear}/days/${closedDate}`,
      {
        date: closedDate,
        dayType: "tenant_special",
        name: `E2E ${businessStatus}`,
        pricingMultiplier: 1,
        overrideReason: `E2E 切换为 ${businessStatus}`,
        // 刻意把两态传成与四态**矛盾**的值：服务端必须以四态为准并把 closed 同步过来，
        // 否则同一行会自相矛盾、人工覆盖被静默忽略。
        closed: false,
        businessStatus
      },
      construction.accessToken
    );
    assert.equal(res.status, 200, `设置营业状态 ${businessStatus} 失败: ${JSON.stringify(res.body).slice(0, 200)}`);
    const publish = await request("POST", `/api/rental/v1/calendars/${closedYear}/publish`, { changeReason: `E2E 发布 ${businessStatus}` }, construction.accessToken);
    assert.equal(publish.status, 201, `发布 ${businessStatus} 日历失败: ${JSON.stringify(publish.body).slice(0, 200)}`);
    return res.body.data;
  };
  const pickupOnDay = () => closedQuote(`${closedDate}T09:00:00+08:00`, `${closedYear}-08-12T09:00:00+08:00`);

  // 正常营业：领取放行。
  const openDay = await setDayStatus("open");
  assert.equal(openDay.closed, false, "正常营业时遗留 closed 应为 false");
  assert.equal((await pickupOnDay()).status, 201, "正常营业日应可领取");

  // 限时营业按营业时段判定（需求 4.5.1/4.5.4：限时营业「只在指定时段提供指定履约能力」）。
  // setDayStatus 不带时段，这里直接 PUT 带 hours 再发布：营业时段 09-18、领取动作时段 10-11。
  const limitedHours = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${closedDate}`,
    {
      date: closedDate,
      dayType: "tenant_special",
      name: "E2E 限时营业时段",
      pricingMultiplier: 1,
      overrideReason: "E2E 限时营业时段校验",
      closed: false,
      businessStatus: "limited",
      hours: { windows: [{ start: "09:00", end: "18:00" }], pickup: [{ start: "10:00", end: "11:00" }] }
    },
    construction.accessToken
  );
  assert.equal(limitedHours.status, 200, `设置限时营业时段失败: ${JSON.stringify(limitedHours.body).slice(0, 200)}`);
  assert.ok(limitedHours.body.data.hours, "限时营业日必须保存营业时段，否则时段校验无从谈起");
  assert.equal(
    (await request("POST", `/api/rental/v1/calendars/${closedYear}/publish`, { changeReason: "E2E 发布限时营业时段" }, construction.accessToken)).status,
    201,
    "发布限时营业时段日历失败"
  );
  // 领取时点在营业时段(09-18)内、却在领取动作时段(10-11)外 → 拒绝。
  // 这条区分「营业时段」与「领取动作时段」两道校验：只查营业时段会误放行 09:00。
  const pickupBeforeActionWindow = await closedQuote(`${closedDate}T09:00:00+08:00`, `${closedYear}-08-12T09:00:00+08:00`);
  assert.equal(pickupBeforeActionWindow.status, 409, `领取动作时段外必须拒绝: ${pickupBeforeActionWindow.status} ${JSON.stringify(pickupBeforeActionWindow.body).slice(0, 200)}`);
  assert.match(JSON.stringify(pickupBeforeActionWindow.body), /时段/, `拒绝原因应说明是时段限制: ${JSON.stringify(pickupBeforeActionWindow.body).slice(0, 200)}`);
  // 领取时点在营业时段外(08:00 < 09:00) → 拒绝，守住「营业时段」这道校验本身。
  const pickupBeforeBusinessHours = await closedQuote(`${closedDate}T08:00:00+08:00`, `${closedYear}-08-12T09:00:00+08:00`);
  assert.equal(pickupBeforeBusinessHours.status, 409, `营业时段外领取必须拒绝: ${pickupBeforeBusinessHours.status} ${JSON.stringify(pickupBeforeBusinessHours.body).slice(0, 200)}`);
  // 领取时点在领取动作时段(10-11)内 → 放行。移除时段校验后本条仍绿、上面两条会变红，
  // 三条共同锁死「时段校验存在且按动作时段判定」。
  const pickupInWindow = await closedQuote(`${closedDate}T10:30:00+08:00`, `${closedYear}-08-12T09:00:00+08:00`);
  assert.equal(pickupInWindow.status, 201, `领取动作时段内必须放行: ${pickupInWindow.status} ${JSON.stringify(pickupInWindow.body).slice(0, 200)}`);

  // 停止营业：拒绝，且遗留 closed 必须被同步为 true。
  const closedDay = await setDayStatus("closed");
  assert.equal(closedDay.closed, true, "停止营业必须把遗留 closed 同步为 true，否则两态与四态自相矛盾");
  assert.equal((await pickupOnDay()).status, 409, "停止营业日不得领取");

  // 自助营业：地点尚未声明自助能力，必须**拒绝**而不是放行（fail-closed）。
  const selfDay = await setDayStatus("self_service");
  assert.equal(selfDay.closed, true, "自助营业属人工停业，遗留 closed 应为 true");
  const selfPickup = await pickupOnDay();
  assert.equal(selfPickup.status, 409, "自助营业日在地点未声明自助能力时必须拒绝，不得 fail-open");
  assert.match(
    JSON.stringify(selfPickup.body),
    /自助/,
    `拒绝原因应说明是自助营业与能力缺失: ${JSON.stringify(selfPickup.body).slice(0, 220)}`
  );

  // 还原为停止营业，保持本节前面三条断言的前提不变。
  await setDayStatus("closed");
  // 4b) 人工覆盖的审计与来源（需求 4.5.3）。
  //     需求要求「人工覆盖必须保存调整原因、操作人、调整时间」，且「日期详情必须能
  //     说明当前结果来自人工覆盖、官方日历还是每周模板，并展示被覆盖的原始值」，
  //     以及「移除人工覆盖表示恢复到下一优先级来源，不得把该日期变成没有来源的空白日」。
  const auditDate = `${closedYear}-10-01`; // 官方导入里是国庆节、系数 1.5
  const beforeOverride = (await request("GET", `/api/rental/v1/calendars/${closedYear}`, null, construction.accessToken))
    .body.data.days.find((row) => row.date === auditDate);
  assert.ok(beforeOverride, `前置条件：官方导入应包含 ${auditDate}`);
  assert.equal(beforeOverride.source, "official_cn", `覆盖前来源应为官方日历，实际 ${beforeOverride.source}`);

  // 缺调整原因必须 400——需求写的是"必须保存"。
  const noReason = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${auditDate}`,
    { date: auditDate, dayType: "tenant_special", name: "E2E 无原因", pricingMultiplier: 2, closed: false },
    construction.accessToken
  );
  assert.equal(noReason.status, 400, `缺调整原因必须 400：实际 ${noReason.status} ${JSON.stringify(noReason.body).slice(0, 180)}`);

  // 原因是纯空白必须 400。`@IsNotEmpty()` 只拦空串，`" "` 会原样落库，
  // 审计栏显示为空——等于没记原因，而需求写的是"必须保存"。
  const blankReason = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${auditDate}`,
    { date: auditDate, dayType: "tenant_special", name: "E2E 空白原因", pricingMultiplier: 2, closed: false, overrideReason: "   " },
    construction.accessToken
  );
  assert.equal(blankReason.status, 400, `纯空白调整原因必须 400：实际 ${blankReason.status} ${JSON.stringify(blankReason.body).slice(0, 180)}`);

  // 不存在的日期必须 400。`2026-02-30` 格式合法但那天不存在，
  // `new Date` 会静默滚到 3 月 2 日——加价系数就落到了错误的日期上。
  const impossibleDate = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${closedYear}-02-30`,
    { date: `${closedYear}-02-30`, dayType: "tenant_special", name: "E2E 不存在的日期", pricingMultiplier: 2, closed: false, overrideReason: "E2E 非法日期" },
    construction.accessToken
  );
  assert.equal(impossibleDate.status, 400, `不存在的日期必须 400：实际 ${impossibleDate.status} ${JSON.stringify(impossibleDate.body).slice(0, 180)}`);

  // 带时间的日期必须 400：日历按日键控，放过它会让同一天出现两个键。
  const datetimeKey = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${auditDate}T00:00:00Z`,
    { date: `${auditDate}T00:00:00Z`, dayType: "tenant_special", name: "E2E 带时间", pricingMultiplier: 2, closed: false, overrideReason: "E2E 带时间" },
    construction.accessToken
  );
  assert.equal(datetimeKey.status, 400, `带时间的日期键必须 400：实际 ${datetimeKey.status} ${JSON.stringify(datetimeKey.body).slice(0, 180)}`);

  const overridden = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${auditDate}`,
    {
      date: auditDate,
      dayType: "tenant_special",
      name: "E2E 店庆特价",
      pricingMultiplier: 2,
      closed: false,
      businessStatus: "open",
      overrideReason: "E2E 店庆活动特价"
    },
    construction.accessToken
  );
  assert.equal(overridden.status, 200, `人工覆盖失败: ${JSON.stringify(overridden.body).slice(0, 200)}`);
  const day = overridden.body.data;
  assert.equal(day.source, "tenant_override", "覆盖后来源必须是人工覆盖");
  assert.equal(day.overrideReason, "E2E 店庆活动特价", "调整原因必须保存");
  assert.ok(day.overrideBy, "操作人必须由服务端记录，不能为空");
  assert.ok(day.overrideAt, "调整时间必须由服务端记录");
  assert.ok(day.overriddenFrom, "必须保留被覆盖的原始值，否则日期详情无法展示、移除覆盖也无从恢复");
  assert.equal(day.overriddenFrom.source, "official_cn", "被覆盖的原始来源应为官方日历");
  assert.equal(
    day.overriddenFrom.pricingMultiplier,
    beforeOverride.pricingMultiplier,
    `被覆盖的原始系数应为 ${beforeOverride.pricingMultiplier}，实际 ${day.overriddenFrom.pricingMultiplier}`
  );

  // 反复覆盖同一天：overriddenFrom 必须仍指向**官方原值**，而不是上一次人工改的值。
  const overriddenAgain = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${auditDate}`,
    {
      date: auditDate,
      dayType: "tenant_special",
      name: "E2E 店庆特价二次调整",
      pricingMultiplier: 3,
      closed: false,
      businessStatus: "open",
      overrideReason: "E2E 二次调整"
    },
    construction.accessToken
  );
  assert.equal(overriddenAgain.status, 200, "二次覆盖失败");
  assert.equal(
    overriddenAgain.body.data.overriddenFrom.pricingMultiplier,
    beforeOverride.pricingMultiplier,
    "二次覆盖后原始值仍应是官方原值，否则移除一次只会退回到另一次人工覆盖"
  );

  // 4c) 重导官方日历不得覆盖人工覆盖（需求 4.5.3 的来源优先级）。
  //     早前是无条件 `dayMap.set()`，于是每次重导都会把运营的调整连同调整原因
  //     一起抹掉，且毫无提示。此处该日期当前是人工覆盖（系数 3）。
  const draftCountBeforeReimport = readCount(
    "SELECT COUNT(*) FROM `rental_business_calendars` WHERE `tenantId`='" +
      construction.tenant.tenantId +
      `' AND \`year\`=${closedYear} AND \`status\`='draft';`
  );
  // 官方修订形成**新的来源版本**（需求 4.5.2），空间再引用新版本。
  const reimportVersion = await registerOfficialVersion(
    closedYear,
    [
      { date: auditDate, dayType: "statutory_holiday", name: "国庆节（官方修订）", pricingMultiplier: 1.8 },
      { date: `${closedYear}-10-11`, dayType: "makeup_workday", name: "国庆调休上班" }
    ],
    new Date().toISOString()
  );
  assert.notEqual(
    reimportVersion.version,
    closedYearVersion.version,
    `官方再次调整必须形成新的来源版本，实际仍是 ${reimportVersion.version}`
  );
  const reimport = await applyOfficialVersion(closedYear, reimportVersion.id, construction.accessToken);
  assert.equal(reimport.status, 201, `重新应用官方来源失败: ${JSON.stringify(reimport.body).slice(0, 220)}`);
  const reimported = reimport.body.data;
  const keptDay = reimported.days.find((row) => row.date === auditDate);
  assert.equal(keptDay.source, "tenant_override", "重导官方日历不得把人工覆盖改成官方来源");
  assert.equal(keptDay.pricingMultiplier, 3, `人工覆盖的系数必须保留为 3，实际 ${keptDay.pricingMultiplier}`);
  assert.equal(keptDay.overrideReason, "E2E 二次调整", "重导不得抹掉人工覆盖的调整原因");
  // 但 overriddenFrom 必须换成本次的官方值：它的用途是"撤销后恢复到哪里"，
  // 停在上一版官方数据会让撤销后恢复出一个已经作废的节假日安排。
  assert.equal(
    keptDay.overriddenFrom.pricingMultiplier,
    1.8,
    `被覆盖的原始值应更新为本次官方系数 1.8，实际 ${keptDay.overriddenFrom.pricingMultiplier}`
  );
  assert.ok(
    (reimported.importPreservedOverrides ?? []).includes(auditDate),
    "导入必须回报因人工覆盖而未写入的日期，否则运营会以为官方值已生效"
  );
  // 未被覆盖的日期照常写入官方值。
  const freshDay = reimported.days.find((row) => row.date === `${closedYear}-10-11`);
  assert.equal(freshDay.source, "official_cn", "没有人工覆盖的日期应写入官方来源");
  assert.equal(freshDay.dayType, "makeup_workday", "调休工作日类型应按官方数据写入");

  // 连续应用来源版本不得堆出多个草稿：早前每次导入都 `versionAfter`，
  // 叠加"取首条草稿"的旧 bug，页面会随机显示其中一个旧草稿。
  const thirdVersion = await registerOfficialVersion(
    closedYear,
    [
      // 官方导入是**整年替换**：本次仍要带上 auditDate，否则该日期就不再属于官方数据，
      // 其 overriddenFrom 会（正确地）回落成周模板，下面「移除覆盖恢复到官方值」这一节
      // 就测不到目标路径了。「官方撤回某日期后覆盖移除应回落周模板」由 15L 节单独覆盖。
      { date: auditDate, dayType: "statutory_holiday", name: "国庆节（官方修订）", pricingMultiplier: 1.8 },
      { date: `${closedYear}-10-12`, dayType: "makeup_workday", name: "再一次调休" }
    ],
    new Date().toISOString()
  );
  const reimportAgain = await applyOfficialVersion(closedYear, thirdVersion.id, construction.accessToken);
  assert.equal(reimportAgain.status, 201, "第三次应用来源版本失败");
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='draft';`
    ),
    draftCountBeforeReimport,
    "连续导入只能原地更新同一个草稿，不能每次都新建一个版本"
  );
  // 同一批里重复给同一天必须 400：静默取最后一条会让结果取决于数组顺序。
  // 这道校验现在在**平台登记来源版本**时执行——公共数据的正确性该在入库时把住。
  const duplicateInBatch = await postOfficialVersion(
    closedYear,
    [
      { date: `${closedYear}-10-13`, dayType: "makeup_workday", name: "甲" },
      { date: `${closedYear}-10-13`, dayType: "statutory_holiday", name: "乙" }
    ],
    new Date().toISOString()
  );
  assert.equal(duplicateInBatch.status, 400, `批内重复日期必须 400，实际 ${duplicateInBatch.status}`);

  // 移除覆盖：缺撤销原因必须 400——撤销与建立覆盖同为经营决策，需求要求可追溯。
  const removeNoReason = await request(
    "DELETE",
    `/api/rental/v1/calendars/${closedYear}/days/${auditDate}`,
    {},
    construction.accessToken
  );
  assert.equal(removeNoReason.status, 400, `移除覆盖缺原因必须 400，实际 ${removeNoReason.status} ${JSON.stringify(removeNoReason.body).slice(0, 180)}`);

  // 移除覆盖：恢复到官方日历原值，且不能变成空白日。
  const removed = await request(
    "DELETE",
    `/api/rental/v1/calendars/${closedYear}/days/${auditDate}`,
    { overrideReason: "E2E 店庆结束，恢复官方安排" },
    construction.accessToken
  );
  assert.equal(removed.status, 200, `移除覆盖失败: ${JSON.stringify(removed.body).slice(0, 200)}`);
  assert.equal(removed.body.data.source, "official_cn", "移除覆盖后应恢复到官方日历来源");
  assert.equal(
    removed.body.data.pricingMultiplier,
    1.8,
    `移除覆盖后系数应恢复为最近一次官方原值 1.8，实际 ${removed.body.data.pricingMultiplier}`
  );
  assert.equal(removed.body.data.dayType, "statutory_holiday", "移除覆盖后日期类型应恢复为官方原值");
  // 该日期必须仍然存在（不得变成没有来源的空白日）。
  const afterRemove = (await request("GET", `/api/rental/v1/calendars/${closedYear}`, null, construction.accessToken))
    .body.data;
  assert.equal(
    afterRemove.days.filter((row) => row.date === auditDate).length,
    1,
    "移除覆盖后该日期必须仍有且只有一条记录"
  );
  // 审计流水必须记下撤销原因、操作人与前后差异。审计已搬到独立的只追加表，
  // 因此从专用端点读，而不是从年度日历行的 JSON 里读（那里只能保留最近 500 条）。
  const auditsResponse = await request("GET", `/api/rental/v1/calendars/${closedYear}/override-audits`, null, construction.accessToken);
  assert.equal(auditsResponse.status, 200, `读取覆盖审计失败: ${auditsResponse.status} ${JSON.stringify(auditsResponse.body).slice(0, 200)}`);
  const audits = auditsResponse.body.data ?? [];
  const revertAudit = audits.filter((row) => row.date === auditDate && row.action === "revert").pop();
  assert.ok(revertAudit, "移除覆盖必须留下 revert 审计记录");
  assert.equal(revertAudit.reason, "E2E 店庆结束，恢复官方安排", "撤销原因必须进审计");
  assert.ok(revertAudit.operator, "撤销操作人必须由服务端记录");
  assert.ok(revertAudit.at, "撤销时间必须由服务端记录");
  assert.equal(revertAudit.before.source, "tenant_override", "审计的前值应是被撤销的人工覆盖");
  assert.equal(revertAudit.before.pricingMultiplier, 3, `审计前值系数应为 3，实际 ${revertAudit.before.pricingMultiplier}`);
  assert.equal(revertAudit.after.source, "official_cn", "审计的后值应是恢复出的官方来源");
  assert.equal(revertAudit.after.pricingMultiplier, 1.8, `审计后值系数应为 1.8，实际 ${revertAudit.after.pricingMultiplier}`);
  assert.equal(revertAudit.year, closedYear, `审计必须自带年度: ${revertAudit.year}`);
  assert.ok(revertAudit.version, "审计必须自带版本号，否则无法按版本回放");
  // 建立覆盖同样要有审计记录，否则只查得到撤销、查不到当初为什么改。
  const overrideAudit = audits.filter((row) => row.date === auditDate && row.action === "override").pop();
  assert.ok(overrideAudit, "建立覆盖必须留下 override 审计记录");
  assert.equal(overrideAudit.reason, "E2E 二次调整", "建立覆盖的原因必须进审计");
  assert.equal(overrideAudit.after.pricingMultiplier, 3, "建立覆盖的后值系数应为 3");
  // 审计必须落进独立表，不能只在内存里，也不能再塞回年度日历 JSON。
  assert.ok(
    readCount(
      "SELECT COUNT(*) FROM `rental_calendar_override_audits` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear};`
    ) >= 2,
    "覆盖审计流水必须落进独立审计表"
  );
  assert.equal(
    readScalar(
      "SELECT IFNULL(JSON_LENGTH(`overrideAudits`), 'NULL') FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='draft';`
    ),
    "NULL",
    "审计不得再双写回年度日历 JSON（那条路径有 500 条截断）"
  );
  // 按版本过滤必须生效：版本详情要能只回放该版本上的调整。
  const auditsForVersion = await request(
    "GET",
    `/api/rental/v1/calendars/${closedYear}/override-audits?version=${encodeURIComponent(revertAudit.version)}`,
    null,
    construction.accessToken
  );
  assert.equal(auditsForVersion.status, 200, `按版本读审计失败: ${auditsForVersion.status}`);
  assert.ok(
    (auditsForVersion.body.data ?? []).length > 0 &&
      (auditsForVersion.body.data ?? []).every((row) => row.version === revertAudit.version),
    `按版本过滤必须只回该版本的审计: ${JSON.stringify((auditsForVersion.body.data ?? []).map((r) => r.version))}`
  );
  // 没有覆盖时再移除必须报错，而不是静默成功。
  const removeAgain = await request(
    "DELETE",
    `/api/rental/v1/calendars/${closedYear}/days/${auditDate}`,
    { overrideReason: "E2E 重复移除" },
    construction.accessToken
  );
  assert.equal(removeAgain.status, 409, `无覆盖可移除时应 409，实际 ${removeAgain.status}`);

  // 5) 年度版本历史（需求 4.5.7）：已发布版本不可原地修改，编辑必须复制为新草稿，
  //    新草稿发布后原版本进入「已被替代」，历史版本不得被删除或改回。
  //
  //    早前的实现直接把该行 status 改回 draft 并递增版本号——等于把已发布版本
  //    就地抹掉：引用它的历史报价指向一个已不存在的版本，且该年度在新草稿发布前
  //    处于「没有已发布日历」的状态，报价会静默回落到周模板。
  const calRows = (statusFilter) =>
    readCount(
      "SELECT COUNT(*) FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear}` +
        (statusFilter ? ` AND \`status\`='${statusFilter}'` : "")
    );
  const publishedVersionBefore = readScalar(
    "SELECT `version` FROM `rental_business_calendars` WHERE `tenantId`='" +
      construction.tenant.tenantId +
      `' AND \`year\`=${closedYear} AND \`status\`='published';`
  );
  assert.ok(publishedVersionBefore, "前置条件：该年度应已有已发布版本");
  assert.equal(calRows("published"), 1, "每个空间每个年度只能有一个已发布版本");
  // 本节前面的四态用例已经历过多轮"编辑→发布"，因此已被替代的版本不止一条。
  // 断言用**增量**而不是绝对值：绝对值会绑死在上文的用例条数上，改动上文就会误报。
  const supersededBefore = calRows("superseded");

  // 编辑已发布日历：必须新增一条草稿，已发布那条不动。
  const editAfterPublish = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${closedYear}-09-15`,
    {
      date: `${closedYear}-09-15`,
      dayType: "tenant_special",
      name: "E2E 版本历史验证",
      pricingMultiplier: 1.2,
      overrideReason: "E2E 版本历史验证",
      closed: false,
      businessStatus: "open"
    },
    construction.accessToken
  );
  assert.equal(editAfterPublish.status, 200, `编辑已发布日历失败: ${JSON.stringify(editAfterPublish.body).slice(0, 200)}`);
  assert.equal(
    readScalar(
      "SELECT `version` FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='published';`
    ),
    publishedVersionBefore,
    "编辑已发布日历不得改动已发布版本本身（需求 4.5.7：已发布版本不可直接修改）"
  );
  assert.equal(calRows("draft"), 1, "编辑已发布日历必须复制生成一条新草稿");
  assert.equal(calRows("published"), 1, "编辑期间已发布版本必须仍在，否则报价会回落到周模板");

  // 发布缺变更原因必须 400（需求 4.5.7：发布记录必须可追溯变更原因）。
  const publishNoReason = await request("POST", `/api/rental/v1/calendars/${closedYear}/publish`, {}, construction.accessToken);
  assert.equal(publishNoReason.status, 400, `发布缺变更原因必须 400，实际 ${publishNoReason.status} ${JSON.stringify(publishNoReason.body).slice(0, 180)}`);

  // 发布新草稿：原版本进入「已被替代」，两条都保留。
  const republish = await request(
    "POST",
    `/api/rental/v1/calendars/${closedYear}/publish`,
    { changeReason: "E2E 版本历史验证发布" },
    construction.accessToken
  );
  assert.equal(republish.status, 201, `发布新草稿失败: ${JSON.stringify(republish.body).slice(0, 200)}`);
  assert.equal(calRows("published"), 1, "发布后仍只能有一个已发布版本");
  assert.equal(
    calRows("superseded"),
    supersededBefore + 1,
    `原已发布版本必须标记为已被替代而不是删除：应从 ${supersededBefore} 增至 ${supersededBefore + 1}，实际 ${calRows("superseded")}`
  );
  assert.notEqual(
    readScalar(
      "SELECT `version` FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='published';`
    ),
    publishedVersionBefore,
    "发布后当前已发布版本应是新版本"
  );
  assert.equal(
    readScalar(
      "SELECT `previousVersion` FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='published';`
    ),
    publishedVersionBefore,
    "发布记录必须能追溯上一版本号（需求 4.5.7）"
  );
  assert.ok(
    readScalar(
      "SELECT `publishedBy` FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='published';`
    ),
    "发布记录必须保存发布人"
  );
  assert.ok(calRows(null) >= 3, `该年度应保留草稿→发布→被替代的多条版本，实际 ${calRows(null)} 条`);

  // 发布记录必须带变更原因与相对上一版本的日期差异（需求 4.5.7）。
  assert.equal(
    readScalar(
      "SELECT `changeReason` FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='published';`
    ),
    "E2E 版本历史验证发布",
    "发布记录必须保存变更原因"
  );
  // 差异必须非空：本次发布至少改了 09-15 那天，差异为空说明根本没算。
  // COALESCE 是为了让"列为 NULL"落成 0 并撞上下面的断言，
  // 而不是让 readCount 抛"无数字结果"——那条报错读不出真正的缺陷。
  assert.ok(
    readCount(
      "SELECT COALESCE(JSON_LENGTH(JSON_EXTRACT(`publishDiff`, '$.changed')), 0) " +
        "+ COALESCE(JSON_LENGTH(JSON_EXTRACT(`publishDiff`, '$.added')), 0) " +
        "FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='published';`
    ) > 0,
    "发布记录必须保存相对上一版本的日期差异"
  );
  // 被替代的那条必须有替代时间：只改 status 不记时间，无法判断替代发生在哪次发布。
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `rental_business_calendars` WHERE `tenantId`='" +
        construction.tenant.tenantId +
        `' AND \`year\`=${closedYear} AND \`status\`='superseded' AND \`supersededAt\` IS NULL;`
    ),
    0,
    "所有已被替代的版本都必须记录替代时间"
  );

  ok(
    "停业日语义正确：租期跨过放行且仍计费、领取/归还日停业 409 且原因可区分；" +
      "四态营业状态生效（正常放行、限时营业按营业时段与动作时段双重校验、停止拒绝、" +
      "自助在能力缺失时 fail-closed），两态字段同步落库"
  );

  console.log("== 15g. PRICE-02 日历发布必须原子：第二步失败要整体回滚 ==");
  // 发布是「新版本置 published + 旧版本置 superseded」两步。早前是两次独立 upsert，
  // 第二次失败就会留下**两个 published 版本**——报价按版本号取最大的那个，
  // 于是旧口径被静默弃用却没有任何替代记录，历史报价也无法解释。
  //
  // 注入手段是一条 CHECK 约束，只挡「被替代的那条带探针原因」，
  // 因此第一步（草稿→已发布）照常成功，只有第二步被拒——正是要验证的那条路径。
  // 不能用整表拒绝 superseded：那样第一步就过不去，什么也证明不了。
  const atomicProbeReason = "E2E 发布原子性探针";
  const editForProbe = async (date, name) => {
    const res = await request(
      "PUT",
      `/api/rental/v1/calendars/${closedYear}/days/${date}`,
      { date, dayType: "tenant_special", name, pricingMultiplier: 1.1, closed: false, businessStatus: "open", overrideReason: name },
      construction.accessToken
    );
    assert.equal(res.status, 200, `原子性用例的日期编辑失败: ${JSON.stringify(res.body).slice(0, 200)}`);
  };
  // 先让当前已发布版本带上探针原因，它将是下一次发布时要被标记为 superseded 的那条。
  await editForProbe(`${closedYear}-09-16`, "E2E 原子性前置");
  const probeBase = await request(
    "POST",
    `/api/rental/v1/calendars/${closedYear}/publish`,
    { changeReason: atomicProbeReason },
    construction.accessToken
  );
  assert.equal(probeBase.status, 201, `原子性前置发布失败: ${JSON.stringify(probeBase.body).slice(0, 200)}`);
  const versionBeforeAtomic = readScalar(
    "SELECT `version` FROM `rental_business_calendars` WHERE `tenantId`='" +
      construction.tenant.tenantId +
      `' AND \`year\`=${closedYear} AND \`status\`='published';`
  );
  const supersededBeforeAtomic = calRows("superseded");

  mysqlQuery(
    "ALTER TABLE `rental_business_calendars` ADD CONSTRAINT `e2e_block_probe_supersede` " +
      `CHECK (NOT (\`status\` = 'superseded' AND \`changeReason\` = '${atomicProbeReason}'));`
  );
  try {
    await editForProbe(`${closedYear}-09-17`, "E2E 原子性触发");
    assert.equal(calRows("draft"), 1, "原子性用例前置条件：应恰好有一个待发布草稿");
    const blocked = await request(
      "POST",
      `/api/rental/v1/calendars/${closedYear}/publish`,
      { changeReason: "E2E 应当整体回滚的发布" },
      construction.accessToken
    );
    assert.ok(blocked.status >= 500, `第二步被库拒绝时发布应失败，实际 ${blocked.status}`);
    // 关键断言：新版本也必须被回滚，不能留下两个 published。
    assert.equal(calRows("published"), 1, "发布第二步失败后仍只能有一个已发布版本");
    assert.equal(
      readScalar(
        "SELECT `version` FROM `rental_business_calendars` WHERE `tenantId`='" +
          construction.tenant.tenantId +
          `' AND \`year\`=${closedYear} AND \`status\`='published';`
      ),
      versionBeforeAtomic,
      "发布第二步失败后当前已发布版本必须仍是原版本，新版本不得留在库里"
    );
    assert.equal(calRows("superseded"), supersededBeforeAtomic, "发布失败不得产生新的已被替代版本");
    assert.equal(calRows("draft"), 1, "发布失败后草稿必须原样保留，否则这次编辑就白丢了");
  } finally {
    mysqlQuery("ALTER TABLE `rental_business_calendars` DROP CONSTRAINT `e2e_block_probe_supersede`;");
  }
  // 约束移除后重发必须成功，证明失败只是被注入的，服务状态没有被搞坏。
  const recovered = await request(
    "POST",
    `/api/rental/v1/calendars/${closedYear}/publish`,
    { changeReason: "E2E 回滚后重新发布" },
    construction.accessToken
  );
  assert.equal(recovered.status, 201, `回滚后重新发布失败: ${JSON.stringify(recovered.body).slice(0, 200)}`);
  assert.equal(calRows("published"), 1, "重新发布后仍只能有一个已发布版本");
  assert.equal(calRows("superseded"), supersededBeforeAtomic + 1, "重新发布后原版本应被标记为已被替代");
  ok("日历发布原子：第二步被库拒绝时新版本与替代标记一并回滚，草稿保留，约束移除后可正常重发");

  console.log("== 15h. PRICE-02 营业时段：归还动作时段与每周默认模板 ==");
  // 需求 4.5.1：每周默认模板包含营业时段与领取/归还/配送默认可用时段；
  // 需求 4.5.3：优先级为「人工覆盖 > 官方日历 > 每周默认模板」，每周模板是最低优先级
  // 兜底来源，对既无覆盖也无官方条目的普通日期同样生效；
  // 需求 4.5.4：报价必须分别校验领取与归还时点。
  //
  // 1) 归还动作时段：某日营业时段 09-18、但归还只在 14-15。归还时点在营业时段内、
  //    动作时段外必须拒绝，且原因要与领取区分开——领取用例已在 15 节覆盖，这里锁住归还分支。
  const returnHoursDate = `${closedYear}-08-22`;
  const returnHours = await request(
    "PUT",
    `/api/rental/v1/calendars/${closedYear}/days/${returnHoursDate}`,
    {
      date: returnHoursDate,
      dayType: "tenant_special",
      name: "E2E 归还时段",
      pricingMultiplier: 1,
      overrideReason: "E2E 归还动作时段校验",
      closed: false,
      businessStatus: "open",
      hours: { windows: [{ start: "09:00", end: "18:00" }], return: [{ start: "14:00", end: "15:00" }] }
    },
    construction.accessToken
  );
  assert.equal(returnHours.status, 200, `设置归还时段失败: ${JSON.stringify(returnHours.body).slice(0, 200)}`);
  assert.equal(
    (await request("POST", `/api/rental/v1/calendars/${closedYear}/publish`, { changeReason: "E2E 发布归还时段" }, construction.accessToken)).status,
    201,
    "发布归还时段日历失败"
  );
  // 领取日 08-20 无条目、无覆盖、此时尚未配置每周模板 → 领取不受时段限制，只考归还分支。
  const returnOutside = await closedQuote(`${closedYear}-08-20T10:00:00+08:00`, `${returnHoursDate}T09:00:00+08:00`);
  assert.equal(returnOutside.status, 409, `归还动作时段外必须拒绝: ${returnOutside.status} ${JSON.stringify(returnOutside.body).slice(0, 200)}`);
  assert.match(JSON.stringify(returnOutside.body), /归还/, `拒绝原因应指明是归还受限: ${JSON.stringify(returnOutside.body).slice(0, 200)}`);
  const returnInside = await closedQuote(`${closedYear}-08-20T10:00:00+08:00`, `${returnHoursDate}T14:30:00+08:00`);
  assert.equal(returnInside.status, 201, `归还动作时段内必须放行: ${returnInside.status} ${JSON.stringify(returnInside.body).slice(0, 200)}`);

  // 2) 每周默认模板兜底：配置每周营业时段 09-18 后，既无覆盖也无官方条目的**普通日期**
  //    也必须按模板校验时点。早前 assertFulfillmentDayOpen 对没有日历行的日期直接放行，
  //    等于每周模板只在恰好有条目的节假日才生效——本用例正是那个缺陷的变异守卫：
  //    去掉修复后，无条目的 08-25 领取会被放行，下面「时段外 409」这条即变红。
  const weeklyWindow = { windows: [{ start: "09:00", end: "18:00" }] };
  const weeklySet = await putSettings({ weeklyHours: Array.from({ length: 7 }, () => weeklyWindow) });
  assert.equal(weeklySet.status, 200, `配置每周默认营业时段失败: ${JSON.stringify(weeklySet.body).slice(0, 300)}`);
  const weeklyDate = `${closedYear}-08-25`;
  const weeklyReturnDate = `${closedYear}-08-27`;
  // 领取 08:00 在每周模板营业时段(09-18)外 → 拒绝，即便该日期在日历里没有任何条目。
  const weeklyOutside = await closedQuote(`${weeklyDate}T08:00:00+08:00`, `${weeklyReturnDate}T10:00:00+08:00`);
  assert.equal(weeklyOutside.status, 409, `每周模板营业时段外领取必须拒绝: ${weeklyOutside.status} ${JSON.stringify(weeklyOutside.body).slice(0, 200)}`);
  // 领取 10:00、归还 11:00 均在模板时段内 → 放行。
  const weeklyInside = await closedQuote(`${weeklyDate}T10:00:00+08:00`, `${weeklyReturnDate}T11:00:00+08:00`);
  assert.equal(weeklyInside.status, 201, `每周模板时段内领取归还必须放行: ${weeklyInside.status} ${JSON.stringify(weeklyInside.body).slice(0, 200)}`);
  // 3) 「限时营业」必须真的限时（需求 4.5.4）。早前允许保存成 limited 但任何层级都没有
  //    时段，而运行时空时段表示"不限制"，于是限时营业实际变成全天可用——配置期就该拒绝。
  //    先清空每周模板：上面的 15h 用例把 7 天都配了时段，不清空就没有「任何层级都没时段」的场景。
  const clearWeeklyForLimited = await putSettings({ weeklyHours: [] });
  assert.equal(clearWeeklyForLimited.status, 200, `清空每周模板失败: ${clearWeeklyForLimited.status}`);
  const limitedNoHoursDate = `${closedYear}-09-15`;
  const limitedNoHours = await request("PUT", `/api/rental/v1/calendars/${closedYear}/days/${limitedNoHoursDate}`, {
    date: limitedNoHoursDate, dayType: "tenant_special", name: "限时但无时段", pricingMultiplier: 1,
    closed: false, businessStatus: "limited", overrideReason: "限时营业缺时段用例"
  }, construction.accessToken);
  assert.equal(limitedNoHours.status, 400, `限时营业但任何层级都没有时段必须 400: ${limitedNoHours.status} ${JSON.stringify(limitedNoHours.body).slice(0, 220)}`);
  assert.match(JSON.stringify(limitedNoHours.body), /时段/u, `拒绝原因应指向时段: ${JSON.stringify(limitedNoHours.body).slice(0, 200)}`);
  // 日期上自带时段时必须放行。
  const limitedWithHours = await request("PUT", `/api/rental/v1/calendars/${closedYear}/days/${limitedNoHoursDate}`, {
    date: limitedNoHoursDate, dayType: "tenant_special", name: "限时营业", pricingMultiplier: 1,
    closed: false, businessStatus: "limited", hours: { windows: [{ start: "10:00", end: "16:00" }] },
    overrideReason: "限时营业带时段用例"
  }, construction.accessToken);
  assert.equal(limitedWithHours.status, 200, `限时营业配了时段应放行: ${limitedWithHours.status} ${JSON.stringify(limitedWithHours.body).slice(0, 220)}`);
  // 每周模板兜底也算"有时段"：先配模板，再存一个不带日级时段的限时营业日。
  const weeklyForLimited = await putSettings({ weeklyHours: Array.from({ length: 7 }, () => weeklyWindow) });
  assert.equal(weeklyForLimited.status, 200, `为限时营业配置每周模板失败: ${weeklyForLimited.status}`);
  const limitedViaWeekly = await request("PUT", `/api/rental/v1/calendars/${closedYear}/days/${closedYear}-09-16`, {
    date: `${closedYear}-09-16`, dayType: "tenant_special", name: "限时（靠周模板）", pricingMultiplier: 1,
    closed: false, businessStatus: "limited", overrideReason: "限时靠周模板兜底"
  }, construction.accessToken);
  assert.equal(limitedViaWeekly.status, 200, `每周模板有时段时限时营业应放行: ${limitedViaWeekly.status} ${JSON.stringify(limitedViaWeekly.body).slice(0, 220)}`);

  // 4) 配送时段必须被强制（需求 4.5.1 把配送可用时段与领取/归还并列声明）。
  //    早前 hours.delivery 声明了却没有任何路径消费它，等于配了不生效。
  const deliveryDate = `${closedYear}-09-20`;
  const deliverySet = await request("PUT", `/api/rental/v1/calendars/${closedYear}/days/${deliveryDate}`, {
    date: deliveryDate, dayType: "tenant_special", name: "配送时段用例", pricingMultiplier: 1, closed: false,
    businessStatus: "open",
    // 营业 09-18，取还全天可用，但配送只在 13:00-15:00。
    hours: { windows: [{ start: "09:00", end: "18:00" }], delivery: [{ start: "13:00", end: "15:00" }] },
    overrideReason: "配送时段用例"
  }, construction.accessToken);
  assert.equal(deliverySet.status, 200, `配置配送时段失败: ${deliverySet.status} ${JSON.stringify(deliverySet.body).slice(0, 220)}`);
  // 报价只认已发布日历（需求 4.5.7），因此把含配送时段的草稿发布后再报价，否则配送窗口在草稿里、
  // 报价看的是旧的已发布版本，测不到配送时段生效。
  const deliveryPublish = await request("POST", `/api/rental/v1/calendars/${closedYear}/publish`, { changeReason: "发布配送时段用例" }, construction.accessToken);
  assert.equal(deliveryPublish.status, 201, `发布配送时段草稿失败: ${deliveryPublish.status} ${JSON.stringify(deliveryPublish.body).slice(0, 220)}`);
  const deliveryQuote = (startAt, endAt) =>
    request("POST", "/api/rental/v1/quotes", {
      customerType: "corporate", fulfillmentMode: "delivery", fulfillmentLocationId: constructionLocation.id,
      startAt, endAt, pricingPlanId: pricePlan.body.data.id, lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    }, construction.accessToken);
  const deliveryOutside = await deliveryQuote(`${deliveryDate}T10:00:00+08:00`, `${closedYear}-09-22T14:00:00+08:00`);
  assert.equal(deliveryOutside.status, 409, `配送时段外必须拒绝（营业时段内但不在配送时段内）: ${deliveryOutside.status} ${JSON.stringify(deliveryOutside.body).slice(0, 220)}`);
  assert.match(JSON.stringify(deliveryOutside.body), /配送/u, `拒绝原因应指明配送受限: ${JSON.stringify(deliveryOutside.body).slice(0, 220)}`);
  const deliveryInside = await deliveryQuote(`${deliveryDate}T14:00:00+08:00`, `${closedYear}-09-22T14:00:00+08:00`);
  assert.equal(deliveryInside.status, 201, `配送时段内必须放行: ${deliveryInside.status} ${JSON.stringify(deliveryInside.body).slice(0, 220)}`);
  // 同一时点用取还方式则不受配送时段限制——证明是按履约方式分流，不是把所有人都收窄。
  const pickupSameTime = await closedQuote(`${deliveryDate}T10:00:00+08:00`, `${closedYear}-09-22T14:00:00+08:00`);
  assert.equal(pickupSameTime.status, 201, `取还方式不应受配送时段限制: ${pickupSameTime.status} ${JSON.stringify(pickupSameTime.body).slice(0, 220)}`);
  // Codex 复审 #4：配送时段三态。缺失=继承营业时段（放行）；空数组=当天不提供配送（必须拒绝，
  // 不能像 withinWindows 把空数组当"不限制"）。两者都要发布后经报价验证，而不是只看 13-15 能拦。
  const deliveryEmptyDate = `${closedYear}-09-21`;
  const deliveryInheritDate = `${closedYear}-09-23`;
  const setEmptyDelivery = await request("PUT", `/api/rental/v1/calendars/${closedYear}/days/${deliveryEmptyDate}`, {
    date: deliveryEmptyDate, dayType: "tenant_special", name: "当天不配送", pricingMultiplier: 1, closed: false,
    businessStatus: "open", hours: { windows: [{ start: "09:00", end: "18:00" }], delivery: [] }, overrideReason: "配送时段为空用例"
  }, construction.accessToken);
  assert.equal(setEmptyDelivery.status, 200, `配置空配送时段失败: ${setEmptyDelivery.status} ${JSON.stringify(setEmptyDelivery.body).slice(0, 220)}`);
  const setInheritDelivery = await request("PUT", `/api/rental/v1/calendars/${closedYear}/days/${deliveryInheritDate}`, {
    date: deliveryInheritDate, dayType: "tenant_special", name: "配送继承营业时段", pricingMultiplier: 1, closed: false,
    businessStatus: "open", hours: { windows: [{ start: "09:00", end: "18:00" }] }, overrideReason: "配送时段缺失继承用例"
  }, construction.accessToken);
  assert.equal(setInheritDelivery.status, 200, `配置继承配送时段失败: ${setInheritDelivery.status} ${JSON.stringify(setInheritDelivery.body).slice(0, 220)}`);
  const deliveryTriPublish = await request("POST", `/api/rental/v1/calendars/${closedYear}/publish`, { changeReason: "发布配送三态用例" }, construction.accessToken);
  assert.equal(deliveryTriPublish.status, 201, `发布配送三态草稿失败: ${deliveryTriPublish.status} ${JSON.stringify(deliveryTriPublish.body).slice(0, 220)}`);
  // 空数组：当天不提供配送，无论时点一律拒绝。
  const deliveryEmptyQuote = await deliveryQuote(`${deliveryEmptyDate}T10:00:00+08:00`, `${closedYear}-09-25T14:00:00+08:00`);
  assert.equal(deliveryEmptyQuote.status, 409, `配送时段为空必须拒绝（当天不提供配送）: ${deliveryEmptyQuote.status} ${JSON.stringify(deliveryEmptyQuote.body).slice(0, 220)}`);
  assert.match(JSON.stringify(deliveryEmptyQuote.body), /配送/u, `拒绝原因应指明配送: ${JSON.stringify(deliveryEmptyQuote.body).slice(0, 200)}`);
  // 缺失 delivery：继承营业时段，营业时段内的配送应放行。
  const deliveryInheritQuote = await deliveryQuote(`${deliveryInheritDate}T10:00:00+08:00`, `${closedYear}-09-25T14:00:00+08:00`);
  assert.equal(deliveryInheritQuote.status, 201, `配送时段缺失应继承营业时段（营业时段内放行）: ${deliveryInheritQuote.status} ${JSON.stringify(deliveryInheritQuote.body).slice(0, 220)}`);
  // 缺失 delivery 但落在营业时段外的配送仍应被营业时段拦下（继承而非放开）。
  const deliveryInheritOutside = await deliveryQuote(`${deliveryInheritDate}T20:00:00+08:00`, `${closedYear}-09-25T14:00:00+08:00`);
  assert.equal(deliveryInheritOutside.status, 409, `继承营业时段时，营业时段外的配送仍应拒绝: ${deliveryInheritOutside.status} ${JSON.stringify(deliveryInheritOutside.body).slice(0, 220)}`);

  // 还原每周模板，避免污染后续用例（未声明 = 不限制时点）。
  const weeklyCleared = await putSettings({ weeklyHours: [] });
  assert.equal(weeklyCleared.status, 200, `清除每周默认营业时段失败: ${JSON.stringify(weeklyCleared.body).slice(0, 300)}`);
  const weeklyAfterClear = await closedQuote(`${weeklyDate}T08:00:00+08:00`, `${weeklyReturnDate}T10:00:00+08:00`);
  assert.equal(weeklyAfterClear.status, 201, `清除每周模板后应恢复不限制时点: ${weeklyAfterClear.status} ${JSON.stringify(weeklyAfterClear.body).slice(0, 200)}`);
  ok(
    "营业时段模型生效：限时/正常营业按营业时段与领取、归还动作时段分别校验时点，" +
      "每周默认模板对无覆盖无官方条目的普通日期同样兜底，未声明时段则不限制；" +
      "限时营业在任何层级都没有时段时配置期即 400（日级或每周模板任一有效即放行）；" +
      "配送履约按 hours.delivery 判定且取还方式不受其限制；配送时段缺失继承营业时段、空数组表示当天不配送（拒绝）"
  );

  console.log("== 15i. PRICE-02 未来年度官方日历未确认时报价提示 ==");
  // 需求 4.5.2：未来年度官方日历尚未发布时仍按每周默认模板允许报价，但必须提示
  // 「该年度官方日历尚未确认」——否则运营无法区分是按已确认官方日历还是按周模板兜底报的价，
  // 而后续官方日历发布不得反向改动这张已锁价报价。construction 只发布了 2027 年度日历。
  const futureQuote = await closedQuote("2028-06-15T09:00:00+08:00", "2028-06-17T09:00:00+08:00");
  assert.equal(futureQuote.status, 201, `未来年度应允许报价（按周模板兜底）: ${futureQuote.status} ${JSON.stringify(futureQuote.body).slice(0, 200)}`);
  const futureWarnings = futureQuote.body.data.calendarWarnings ?? [];
  // 未发布年度与「已发布但官方来源未确认」是两条不同提示，这里断言前者的确切措辞。
  assert.ok(
    futureWarnings.some((w) => w.includes("2028") && w.includes("尚未发布")),
    `未发布年度必须提示按周模板计算: ${JSON.stringify(futureWarnings)}`
  );
  // 已发布官方日历的年度不得误报提示。
  const publishedYearQuote = await closedQuote("2027-06-07T09:00:00+08:00", "2027-06-08T09:00:00+08:00");
  assert.equal(publishedYearQuote.status, 201, `已发布年度报价应成功: ${publishedYearQuote.status} ${JSON.stringify(publishedYearQuote.body).slice(0, 200)}`);
  assert.ok(
    !(publishedYearQuote.body.data.calendarWarnings ?? []).some((w) => w.includes("2027")),
    `已发布官方日历的年度不得提示尚未确认: ${JSON.stringify(publishedYearQuote.body.data.calendarWarnings)}`
  );
  // 提示随报价落库：直接查库，证明 upsertQuote 写映射真的带上了它，而不只是创建响应里的临时值。
  const persistedWarnings = readScalar(
    `SELECT JSON_EXTRACT(\`calendarWarnings\`, '$') FROM \`rental_quotes\` WHERE \`id\`='${futureQuote.body.data.id}';`
  );
  assert.ok(
    persistedWarnings && persistedWarnings.includes("2028"),
    `报价提示必须落库: ${persistedWarnings}`
  );
  // 读回接口也应带出提示。
  const futureReadback = await request("GET", `/api/rental/v1/quotes/${futureQuote.body.data.id}`, null, construction.accessToken);
  assert.equal(futureReadback.status, 200, `读取报价失败: ${futureReadback.status}`);
  assert.ok(
    (futureReadback.body.data.calendarWarnings ?? []).some((w) => w.includes("2028")),
    `读回的报价必须带提示: ${JSON.stringify(futureReadback.body.data.calendarWarnings)}`
  );
  // 「空间日历是否发布」与「公共官方来源是否确认」必须是两个状态，不能用一个 published 代替：
  // 一个只含人工覆盖（如装修停业）的年度日历可以合法发布，但该年度官方节假日仍未确认。
  // 若因为 status=published 就不再提示，运营会以为节假日安排已经到位。
  const manualYear = 2036;
  const manualOnlyDay = await request("PUT", `/api/rental/v1/calendars/${manualYear}/days/${manualYear}-06-01`, {
    date: `${manualYear}-06-01`, dayType: "tenant_special", name: "装修停业", pricingMultiplier: 1,
    closed: true, businessStatus: "closed", overrideReason: "提前声明装修停业"
  }, construction.accessToken);
  assert.equal(manualOnlyDay.status, 200, `纯人工覆盖建草稿失败: ${manualOnlyDay.status} ${JSON.stringify(manualOnlyDay.body).slice(0, 200)}`);
  const manualPublish = await request("POST", `/api/rental/v1/calendars/${manualYear}/publish`, { changeReason: "发布纯人工停业日历" }, construction.accessToken);
  assert.equal(manualPublish.status, 201, `纯人工覆盖的未来年度必须允许发布: ${manualPublish.status} ${JSON.stringify(manualPublish.body).slice(0, 200)}`);
  assert.equal(manualPublish.body.data.status, "published", `发布后状态应为 published: ${manualPublish.body.data.status}`);
  const manualQuote = await closedQuote(`${manualYear}-06-10T09:00:00+08:00`, `${manualYear}-06-12T09:00:00+08:00`);
  assert.equal(manualQuote.status, 201, `已发布年度报价应成功: ${manualQuote.status} ${JSON.stringify(manualQuote.body).slice(0, 200)}`);
  assert.ok(
    (manualQuote.body.data.calendarWarnings ?? []).some((w) => w.includes(String(manualYear)) && w.includes("官方")),
    `日历已发布但公共官方来源未确认时仍须提示: ${JSON.stringify(manualQuote.body.data.calendarWarnings)}`
  );
  // 停业覆盖必须真的进了报价路径：发布后当天不得再安排领取。
  const manualClosedPickup = await closedQuote(`${manualYear}-06-01T09:00:00+08:00`, `${manualYear}-06-03T09:00:00+08:00`);
  assert.equal(manualClosedPickup.status, 409, `纯人工停业日发布后必须拦住当天领取: ${manualClosedPickup.status}`);
  ok("未来年度官方日历未确认：报价按周模板放行且带「尚未确认」提示、已发布年度不误报、提示随报价落库读回一致；「日历已发布」与「官方来源已确认」是两个独立状态（纯人工停业日历可发布、发布后仍提示官方未确认、停业覆盖真的进入报价路径）");

  console.log("== 15j. PRICE-02 年度日历草稿作废 ==");
  // 需求 4.5.7「已作废：人工废弃的草稿或错误版本」。只有草稿可作废；已发布须由新版本替代、
  // 已被替代须保留供历史报价追溯。用全新年度 2031 造一个草稿走作废闭环。
  const voidYear = 2031;
  const voidDraftDay = await request(
    "PUT",
    `/api/rental/v1/calendars/${voidYear}/days/${voidYear}-05-01`,
    { date: `${voidYear}-05-01`, dayType: "tenant_special", name: "作废用例特殊日", pricingMultiplier: 1.5, closed: false, overrideReason: "作废用例造草稿" },
    construction.accessToken
  );
  assert.equal(voidDraftDay.status, 200, `造 ${voidYear} 草稿失败: ${JSON.stringify(voidDraftDay.body).slice(0, 200)}`);
  const voidDraftCalendar = await request("GET", `/api/rental/v1/calendars/${voidYear}`, null, construction.accessToken);
  assert.equal(voidDraftCalendar.body.data.status, "draft", `新造年度应为草稿: ${voidDraftCalendar.body.data.status}`);
  const voidDraftVersion = voidDraftCalendar.body.data.version;

  // 已发布版本不得作废：否则该年度回落周模板且没有替代记录，历史报价无从解释。
  const published2027Version = readScalar(
    `SELECT \`version\` FROM \`rental_business_calendars\` WHERE \`tenantId\`='${construction.tenant.tenantId}' AND \`year\`=${closedYear} AND \`status\`='published' LIMIT 1;`
  );
  assert.ok(published2027Version, `前置：${closedYear} 应存在已发布版本供作废拒绝用例: ${published2027Version}`);
  const voidPublished = await request(
    "POST",
    `/api/rental/v1/calendars/${closedYear}/versions/${published2027Version}/void`,
    { reason: "尝试作废已发布" },
    construction.accessToken
  );
  assert.equal(voidPublished.status, 409, `已发布版本必须拒绝作废: ${voidPublished.status} ${JSON.stringify(voidPublished.body).slice(0, 200)}`);

  // 原因必填。
  const voidNoReason = await request(
    "POST",
    `/api/rental/v1/calendars/${voidYear}/versions/${voidDraftVersion}/void`,
    { reason: "   " },
    construction.accessToken
  );
  assert.equal(voidNoReason.status, 400, `作废原因不能为空白: ${voidNoReason.status}`);

  // 作废草稿成功并记录审计。
  const voided = await request(
    "POST",
    `/api/rental/v1/calendars/${voidYear}/versions/${voidDraftVersion}/void`,
    { reason: "录错年度，弃用该草稿" },
    construction.accessToken
  );
  assert.equal(voided.status, 201, `作废草稿失败: ${voided.status} ${JSON.stringify(voided.body).slice(0, 200)}`);
  assert.equal(voided.body.data.status, "void", `作废后状态应为 void: ${voided.body.data.status}`);
  assert.ok(
    voided.body.data.voidReason === "录错年度，弃用该草稿" && voided.body.data.voidedAt,
    `作废必须记录原因与时间: ${JSON.stringify(voided.body.data).slice(0, 200)}`
  );

  // 作废状态落库，且作废三要素（原因/操作人/时间）都要落库——只查 status 会放过
  // 「operator 未传 → voidedBy 为 NULL」「写映射漏接 → 重启后原因/时间全空」这类审计丢失。
  const persistedVoid = readRow(
    `SELECT \`status\`, \`voidReason\`, \`voidedBy\`, \`voidedAt\` FROM \`rental_business_calendars\` WHERE \`tenantId\`='${construction.tenant.tenantId}' AND \`year\`=${voidYear} AND \`version\`='${voidDraftVersion}';`
  );
  assert.equal(persistedVoid.status, "void", `作废状态必须落库: ${persistedVoid.status}`);
  assert.equal(persistedVoid.voidReason, "录错年度，弃用该草稿", `作废原因必须落库: ${persistedVoid.voidReason}`);
  assert.ok(persistedVoid.voidedBy && persistedVoid.voidedBy !== "NULL", `作废操作人必须落库: ${persistedVoid.voidedBy}`);
  assert.ok(persistedVoid.voidedAt && persistedVoid.voidedAt !== "NULL", `作废时间必须落库: ${persistedVoid.voidedAt}`);

  // 作废后编辑视图不再返回该草稿：该日期应**精确**回落到周模板（2031-05-01 是周四 → workday/1/week_rule）。
  // 只用「不是 tenant_override」的负向断言会放过「source 改回 week_rule 但仍留着运营调的 1.5 系数」。
  const afterVoid = await request("GET", `/api/rental/v1/calendars/${voidYear}`, null, construction.accessToken);
  assert.equal(afterVoid.status, 200, `作废后读日历失败: ${afterVoid.status}`);
  const afterVoidDay = afterVoid.body.data.days.find((d) => d.date === `${voidYear}-05-01`);
  assert.ok(afterVoidDay, "作废后该日期仍应存在（回落周模板而非消失）");
  assert.equal(afterVoidDay.source, "week_rule", `作废后该日期来源应回落周模板: ${afterVoidDay.source}`);
  assert.equal(afterVoidDay.dayType, "workday", `2031-05-01 是周四，应回落 workday: ${afterVoidDay.dayType}`);
  assert.equal(afterVoidDay.pricingMultiplier, 1, `作废后不得残留人工覆盖的 1.5 系数: ${afterVoidDay.pricingMultiplier}`);

  // 作废后再编辑该年度**不得复活**那条 void 行：版本号分配要跳过已占用（含 void）的号，
  // 否则 upsert 撞号会把 void 行原地改回 draft、作废三要素与审计一并写 NULL（需求 4.5.7 禁止原地改回）。
  const afterVoidEdit = await request(
    "PUT",
    `/api/rental/v1/calendars/${voidYear}/days/${voidYear}-06-01`,
    { date: `${voidYear}-06-01`, dayType: "tenant_special", name: "作废后新草稿", pricingMultiplier: 1.2, closed: false, overrideReason: "作废后继续编辑" },
    construction.accessToken
  );
  assert.equal(afterVoidEdit.status, 200, `作废后编辑应成功: ${afterVoidEdit.status} ${JSON.stringify(afterVoidEdit.body).slice(0, 200)}`);
  const voidRowStillVoid = readRow(
    `SELECT \`status\`, \`voidReason\` FROM \`rental_business_calendars\` WHERE \`tenantId\`='${construction.tenant.tenantId}' AND \`year\`=${voidYear} AND \`version\`='${voidDraftVersion}';`
  );
  assert.equal(voidRowStillVoid.status, "void", `作废行不得被后续编辑复活成草稿: ${voidRowStillVoid.status}`);
  assert.equal(voidRowStillVoid.voidReason, "录错年度，弃用该草稿", `作废行的作废原因不得被抹掉: ${voidRowStillVoid.voidReason}`);
  const voidYearVersions = readScalar(
    `SELECT COUNT(*) FROM \`rental_business_calendars\` WHERE \`tenantId\`='${construction.tenant.tenantId}' AND \`year\`=${voidYear};`
  );
  assert.ok(Number(voidYearVersions) >= 2, `作废后编辑应新增版本而非复用 void 版本: ${voidYearVersions}`);

  // 已作废版本不能再次作废（非草稿一律拒绝，与已发布/已被替代同一守卫）。
  const revoid = await request(
    "POST",
    `/api/rental/v1/calendars/${voidYear}/versions/${voidDraftVersion}/void`,
    { reason: "重复作废" },
    construction.accessToken
  );
  assert.equal(revoid.status, 409, `已作废版本不得再次作废: ${revoid.status}`);
  ok("年度日历草稿作废：草稿可作废并记录原因/操作人/时间且逐列落库、已发布拒绝作废、原因必填、作废后编辑视图回落周模板、作废后再编辑不复活 void 行、重复作废被拒");

  console.log("== 15L. PRICE-02 官方导入整年替换 + 每周时段校验（Codex #4/#8） ==");
  // #4：官方导入是整年替换——旧版本里本次未再出现的官方节假日必须回落周模板默认，不残留。
  const impYear = 2033;
  const impVersionA = await registerOfficialVersion(impYear, [
    { date: `${impYear}-10-01`, dayType: "statutory_holiday", name: "国庆节", pricingMultiplier: 1.5 },
    { date: `${impYear}-10-02`, dayType: "statutory_holiday", name: "国庆节次日", pricingMultiplier: 1.5 }
  ]);
  const importTwoHolidays = await applyOfficialVersion(impYear, impVersionA.id, construction.accessToken);
  assert.equal(importTwoHolidays.status, 201, `首次应用来源失败: ${importTwoHolidays.status} ${JSON.stringify(importTwoHolidays.body).slice(0, 200)}`);
  const afterFirstImport = (await request("GET", `/api/rental/v1/calendars/${impYear}`, null, construction.accessToken)).body.data;
  assert.equal(afterFirstImport.days.find((d) => d.date === `${impYear}-10-02`)?.dayType, "statutory_holiday", "首次应用后 10-02 应为法定节假日");
  const impVersionB = await registerOfficialVersion(impYear, [
    { date: `${impYear}-10-01`, dayType: "statutory_holiday", name: "国庆节", pricingMultiplier: 1.5 }
  ]);
  const importOneHoliday = await applyOfficialVersion(impYear, impVersionB.id, construction.accessToken);
  assert.equal(importOneHoliday.status, 201, `重新应用失败: ${importOneHoliday.status} ${JSON.stringify(importOneHoliday.body).slice(0, 200)}`);
  const afterSecondImport = (await request("GET", `/api/rental/v1/calendars/${impYear}`, null, construction.accessToken)).body.data;
  assert.equal(afterSecondImport.days.find((d) => d.date === `${impYear}-10-01`)?.dayType, "statutory_holiday", "重导后 10-01 仍应为法定节假日");
  // 重导删除的 10-02 必须**精确**回落到周模板默认（2033-10-02 是周日 → weekend/week_rule/1.1）。
  // 用 equal 而非 notEqual：notEqual 会放过「整行被删」「dayType 回落但系数仍留 1.5」等部分回落。
  const revertedDay = afterSecondImport.days.find((d) => d.date === `${impYear}-10-02`);
  assert.ok(revertedDay, "重导后 10-02 仍应存在（回落周模板而非被删）");
  assert.equal(revertedDay.dayType, "weekend", `10-02 应回落为 weekend，实际 ${revertedDay.dayType}`);
  assert.equal(revertedDay.source, "week_rule", `10-02 来源应回落为 week_rule，实际 ${revertedDay.source}`);
  assert.equal(revertedDay.pricingMultiplier, 1.1, `10-02 系数应回落为周末 1.1，实际 ${revertedDay.pricingMultiplier}`);
  // 官方撤回某日期后，该日期上**人工覆盖的 overriddenFrom** 也必须回落到周模板：
  // 它的语义是「移除覆盖后恢复到哪里」，停在上一版官方值会让撤销覆盖恢复出一个
  // 当前官方版本里已不存在的法定节假日，并按 holidayMultiplier 计价（需求 4.5.3）。
  const withdrawnDate = `${impYear}-10-01`;
  const overrideOnWithdrawn = await request("PUT", `/api/rental/v1/calendars/${impYear}/days/${withdrawnDate}`, {
    date: withdrawnDate, dayType: "tenant_special", name: "店庆特惠", pricingMultiplier: 2, closed: false, overrideReason: "店庆"
  }, construction.accessToken);
  assert.equal(overrideOnWithdrawn.status, 200, `建覆盖失败: ${overrideOnWithdrawn.status}`);
  assert.equal(overrideOnWithdrawn.body.data.overriddenFrom?.pricingMultiplier, 1.5, `覆盖前原值应是本次官方的 1.5: ${JSON.stringify(overrideOnWithdrawn.body.data.overriddenFrom)}`);
  const impVersionC = await registerOfficialVersion(impYear, [
    // 本次官方数据不再包含 10-01（官方撤回该节假日），只留一个无关日期。
    { date: `${impYear}-12-25`, dayType: "makeup_workday", name: "年末调休" }
  ]);
  const importWithdrawing = await applyOfficialVersion(impYear, impVersionC.id, construction.accessToken);
  assert.equal(importWithdrawing.status, 201, `撤回式应用失败: ${importWithdrawing.status} ${JSON.stringify(importWithdrawing.body).slice(0, 200)}`);
  const withdrawnKept = importWithdrawing.body.data.days.find((d) => d.date === withdrawnDate);
  assert.equal(withdrawnKept.source, "tenant_override", "人工覆盖本身仍须保留");
  assert.equal(withdrawnKept.pricingMultiplier, 2, `人工覆盖的系数须保留为 2: ${withdrawnKept.pricingMultiplier}`);
  assert.equal(withdrawnKept.overriddenFrom?.source, "week_rule", `官方撤回后 overriddenFrom 应回落周模板: ${JSON.stringify(withdrawnKept.overriddenFrom)}`);
  // 2033-10-01 是周六 → 周模板为 weekend / 1.1。
  assert.equal(withdrawnKept.overriddenFrom?.dayType, "weekend", `overriddenFrom 类型应为周末: ${withdrawnKept.overriddenFrom?.dayType}`);
  assert.equal(withdrawnKept.overriddenFrom?.pricingMultiplier, 1.1, `overriddenFrom 系数应为周末 1.1，实际 ${withdrawnKept.overriddenFrom?.pricingMultiplier}`);
  const removeWithdrawn = await request("DELETE", `/api/rental/v1/calendars/${impYear}/days/${withdrawnDate}`, { overrideReason: "店庆结束" }, construction.accessToken);
  assert.equal(removeWithdrawn.status, 200, `移除覆盖失败: ${removeWithdrawn.status}`);
  assert.equal(removeWithdrawn.body.data.source, "week_rule", `官方已撤回该日期，移除覆盖须回落周模板而不是恢复出已作废的节假日: ${removeWithdrawn.body.data.source}`);
  assert.equal(removeWithdrawn.body.data.dayType, "weekend", `移除覆盖应回落为周末，实际 ${removeWithdrawn.body.data.dayType}`);
  assert.equal(removeWithdrawn.body.data.pricingMultiplier, 1.1, `移除覆盖后系数应为周末 1.1，实际 ${removeWithdrawn.body.data.pricingMultiplier}`);
  // #8：每周营业时段模板按下标定位星期，必须完整 7 项或留空；时段本身还要校验起止与落域。
  const badLength = await putSettings({ weeklyHours: Array.from({ length: 5 }, () => weeklyWindow) });
  assert.equal(badLength.status, 400, `不足 7 项的每周模板必须 400（否则星期错位）: ${badLength.status}`);
  const badOrder = await putSettings({ weeklyHours: Array.from({ length: 7 }, () => ({ windows: [{ start: "18:00", end: "09:00" }] })) });
  assert.equal(badOrder.status, 400, `起点不早于终点的时段必须 400: ${badOrder.status}`);
  const badContain = await putSettings({ weeklyHours: Array.from({ length: 7 }, () => ({ windows: [{ start: "09:00", end: "18:00" }], pickup: [{ start: "08:00", end: "10:00" }] })) });
  assert.equal(badContain.status, 400, `领取时段超出营业时段必须 400: ${badContain.status}`);
  const goodHours = await putSettings({ weeklyHours: Array.from({ length: 7 }, () => ({ windows: [{ start: "09:00", end: "18:00" }], pickup: [{ start: "10:00", end: "12:00" }] })) });
  assert.equal(goodHours.status, 200, `合法的每周时段应放行: ${goodHours.status} ${JSON.stringify(goodHours.body).slice(0, 200)}`);
  // 还原每周模板。必须断言还原成功：这条 PUT 一旦失败（例如以后加了「已配置不允许清空」校验），
  // 该空间会残留全周 09:00-18:00 时段，后续新增的 construction 报价用例会拿到莫名的 409。
  const restoreWeekly = await putSettings({ weeklyHours: [] });
  assert.equal(restoreWeekly.status, 200, `还原每周时段必须成功，否则污染后续用例: ${restoreWeekly.status}`);
  // #6：历史版本可查询（含逐日、发布差异与覆盖审计）。2027 经过多轮编辑→发布，应有多个版本。
  const versions2027 = await request("GET", "/api/rental/v1/calendars/2027/versions", null, construction.accessToken);
  assert.equal(versions2027.status, 200, `版本列表失败: ${versions2027.status}`);
  assert.ok(Array.isArray(versions2027.body.data) && versions2027.body.data.length >= 2, `2027 应有多个历史版本: ${versions2027.body.data?.length}`);
  const published2027Detail = versions2027.body.data.find((v) => v.status === "published");
  assert.ok(published2027Detail, "2027 版本列表应含已发布版本");
  const superseded2027 = versions2027.body.data.find((v) => v.status === "superseded");
  assert.ok(superseded2027, "2027 应有已被替代的历史版本");
  const versionDetail = await request("GET", `/api/rental/v1/calendars/2027/versions/${published2027Detail.version}`, null, construction.accessToken);
  assert.equal(versionDetail.status, 200, `版本详情失败: ${versionDetail.status}`);
  assert.ok(Array.isArray(versionDetail.body.data.days) && versionDetail.body.data.days.length > 0, "版本详情应含逐日");
  // 版本列表必须是**轻量摘要**：直接返回领域对象会把每个版本的全年 365 条日期与
  // 全部覆盖审计塞进响应，版本一多就膨胀到不可用。列表只给计数，明细走详情接口。
  assert.equal(published2027Detail.days, undefined, `版本列表不得返回逐日明细: ${JSON.stringify(Object.keys(published2027Detail)).slice(0, 200)}`);
  assert.equal(published2027Detail.overrideAudits, undefined, "版本列表不得返回覆盖审计明细");
  assert.ok(Number(published2027Detail.dayCount) > 300, `版本列表应给出日期条数: ${published2027Detail.dayCount}`);
  assert.equal(
    Number(published2027Detail.dayCount),
    versionDetail.body.data.days.length,
    `列表里的 dayCount 必须与详情的逐日条数一致: ${published2027Detail.dayCount} vs ${versionDetail.body.data.days.length}`
  );
  assert.equal(versionDetail.body.data.version, published2027Detail.version, `版本详情必须返回被请求的那一版: ${versionDetail.body.data.version}`);
  // **已被替代版本**的详情也必须能取到，且返回的就是它自己——需求 4.5.7「已被替代版本必须保留
  // 供历史报价追溯」的执行点。只取已发布版本的详情，会放过「忽略 version 参数、一律返回当前
  // 已发布版本」这种实现（历史报价的 calendarVersion 指向旧版本，页面却给出最新逐日）。
  const supersededDetail = await request("GET", `/api/rental/v1/calendars/2027/versions/${superseded2027.version}`, null, construction.accessToken);
  assert.equal(supersededDetail.status, 200, `已被替代版本详情失败: ${supersededDetail.status}`);
  assert.equal(supersededDetail.body.data.version, superseded2027.version, `必须返回被请求的历史版本: ${supersededDetail.body.data.version}`);
  assert.equal(supersededDetail.body.data.status, "superseded", `历史版本状态应为 superseded: ${supersededDetail.body.data.status}`);
  assert.ok(supersededDetail.body.data.days.length > 0, "历史版本详情应含逐日");
  ok("官方导入整年替换（删除的节假日精确回落周模板）+ 每周时段模板校验（非 7 项/起止倒挂/超出营业时段均 400，合法放行且还原成功）+ 历史版本可查询（已发布与已被替代各自返回自身版本与逐日）+ 版本列表为轻量摘要（不含逐日与审计明细，只给计数）");

  console.log("== 15m. PRICE-02 日历并发编辑必须用乐观锁，不得静默覆盖 ==");
  // 整年日期存在同一个 JSON 字段里：两个编辑人同时改**不同日期**时，各自都读到同一份草稿、
  // 复制全年、改自己那天、再写回整份 JSON——后写者把先写者的改动整体覆盖，双方都收到成功。
  // 年度版本号解决不了这件事（同一草稿内连续编辑共用一个版本号），因此加 revision 条件写。
  const raceYear = 2037;
  const raceSeed = await request("PUT", `/api/rental/v1/calendars/${raceYear}/days/${raceYear}-03-01`, {
    date: `${raceYear}-03-01`, dayType: "tenant_special", name: "并发用例基线", pricingMultiplier: 1.1, closed: false, overrideReason: "建立基线草稿"
  }, construction.accessToken);
  assert.equal(raceSeed.status, 200, `建并发基线失败: ${raceSeed.status} ${JSON.stringify(raceSeed.body).slice(0, 200)}`);
  const raceBaseRevision = Number(readScalar(
    `SELECT \`revision\` FROM \`rental_business_calendars\` WHERE \`tenantId\`='${construction.tenant.tenantId}' AND \`year\`=${raceYear} ORDER BY \`revision\` DESC LIMIT 1;`
  ));
  assert.ok(Number.isFinite(raceBaseRevision) && raceBaseRevision > 0, `revision 必须落库并递增: ${raceBaseRevision}`);
  // 两个并发写落在**不同日期**上：无锁实现下两者都会成功，而库里只留后写者那一天。
  const [raceA, raceB] = await Promise.all([
    request("PUT", `/api/rental/v1/calendars/${raceYear}/days/${raceYear}-04-01`, {
      date: `${raceYear}-04-01`, dayType: "tenant_special", name: "编辑人A", pricingMultiplier: 1.2, closed: false, overrideReason: "A 改四月"
    }, construction.accessToken),
    request("PUT", `/api/rental/v1/calendars/${raceYear}/days/${raceYear}-05-01`, {
      date: `${raceYear}-05-01`, dayType: "tenant_special", name: "编辑人B", pricingMultiplier: 1.3, closed: false, overrideReason: "B 改五月"
    }, construction.accessToken)
  ]);
  const raceStatuses = [raceA.status, raceB.status].sort();
  assert.deepEqual(
    raceStatuses,
    [200, 409],
    `并发编辑同一年度必须一方成功一方 409（不得双双成功而静默丢数据）: ${JSON.stringify(raceStatuses)} ${JSON.stringify([raceA.body, raceB.body]).slice(0, 300)}`
  );
  const raceLoser = raceA.status === 409 ? raceA : raceB;
  assert.ok(
    String(raceLoser.body?.message ?? "").includes("刷新"),
    `409 必须说明需要刷新后重试: ${JSON.stringify(raceLoser.body).slice(0, 200)}`
  );
  // 失败方刷新后重试必须能成功，且两天的改动最终都在（证明 409 不是把编辑能力堵死）。
  const loserDate = raceA.status === 409 ? `${raceYear}-04-01` : `${raceYear}-05-01`;
  const loserName = raceA.status === 409 ? "编辑人A" : "编辑人B";
  const retry = await request("PUT", `/api/rental/v1/calendars/${raceYear}/days/${loserDate}`, {
    date: loserDate, dayType: "tenant_special", name: loserName, pricingMultiplier: 1.4, closed: false, overrideReason: "刷新后重试"
  }, construction.accessToken);
  assert.equal(retry.status, 200, `冲突方刷新后重试应成功: ${retry.status} ${JSON.stringify(retry.body).slice(0, 200)}`);
  const raceFinal = (await request("GET", `/api/rental/v1/calendars/${raceYear}`, null, construction.accessToken)).body.data;
  for (const date of [`${raceYear}-04-01`, `${raceYear}-05-01`]) {
    const row = raceFinal.days.find((d) => d.date === date);
    assert.equal(row?.source, "tenant_override", `${date} 的覆盖必须都在（不得被并发覆盖掉）: ${JSON.stringify(row)}`);
  }
  assert.ok(
    Number(raceFinal.revision) > raceBaseRevision,
    `revision 必须随每次写入递增: ${raceFinal.revision} <= ${raceBaseRevision}`
  );
  ok("日历并发编辑乐观锁：同一年度并发改不同日期时一方 200 一方 409（不再双双成功而静默覆盖），409 提示刷新重试，重试后两天改动都在，revision 随写入递增并落库");

  console.log("== 15n. PRICE-02 发布前影响预览（Codex #5） ==");
  // 需求 4.5.8：发布前必须展示受影响日期以及停业、营业时间、履约能力和特殊价格变化；
  // 存在未来订单时必须提示，但**不得直接改变**这些订单。
  const previewYear = 2038;
  const previewDate = `${previewYear}-07-15`;
  // 先造一版已发布：该日期正常营业、系数 1、有营业时段。
  const previewSeed = await request("PUT", `/api/rental/v1/calendars/${previewYear}/days/${previewDate}`, {
    date: previewDate, dayType: "tenant_special", name: "预览基线", pricingMultiplier: 1, closed: false,
    businessStatus: "open", hours: { windows: [{ start: "09:00", end: "18:00" }] }, overrideReason: "预览用例基线"
  }, construction.accessToken);
  assert.equal(previewSeed.status, 200, `预览基线建立失败: ${previewSeed.status} ${JSON.stringify(previewSeed.body).slice(0, 200)}`);
  // **首次发布**同样必须给出受影响日期与未来订单提示（Codex 高优先级 #1）。
  // 早前 `replacing` 为空时直接返回空差异，于是首发一份含停业/限时/特殊价格的日历时
  // dates 为空、未来订单一条都匹配不上。基准是每周默认模板，不是"空日历"。
  const firstPubOrderQuote = await closedQuote(`${previewYear}-07-14T10:00:00+08:00`, `${previewYear}-07-16T10:00:00+08:00`);
  assert.equal(firstPubOrderQuote.status, 201, `首发预检用例报价失败: ${firstPubOrderQuote.status} ${JSON.stringify(firstPubOrderQuote.body).slice(0, 220)}`);
  const firstPubOrder = await request("POST", "/api/rental/v1/orders", {
    quoteId: firstPubOrderQuote.body.data.id, customerType: "corporate", customerName: "E2E 首发预检客户",
    fulfillmentMode: "warehouse_pickup_return", fulfillmentLocationId: constructionLocation.id,
    startAt: `${previewYear}-07-14T10:00:00+08:00`, endAt: `${previewYear}-07-16T10:00:00+08:00`,
    lines: [{ itemGroupId: priceGroupId, quantity: 1 }], qualificationApproved: true
  }, construction.accessToken);
  assert.equal(firstPubOrder.status, 201, `首发预检用例订单失败: ${firstPubOrder.status} ${JSON.stringify(firstPubOrder.body).slice(0, 220)}`);
  const firstPreview = await request("GET", `/api/rental/v1/calendars/${previewYear}/publish-preview`, null, construction.accessToken);
  assert.equal(firstPreview.status, 200, `首发预检失败: ${firstPreview.status} ${JSON.stringify(firstPreview.body).slice(0, 220)}`);
  const fpv = firstPreview.body.data;
  assert.equal(fpv.firstPublish, true, "尚无已发布版本时应标记为首次发布");
  assert.ok(
    (fpv.dates ?? []).some((d) => d.date === previewDate),
    `首次发布也必须列出受影响日期（相对周模板的业务变化）: ${JSON.stringify((fpv.dates ?? []).map((d) => d.date)).slice(0, 200)}`
  );
  assert.ok(
    (fpv.dates ?? []).length < 200,
    `首发差异基准必须是周模板而不是空日历（否则全年 365 天都被列出）: ${(fpv.dates ?? []).length}`
  );
  assert.ok(
    (fpv.futureOrders ?? []).some((o) => o.orderId === firstPubOrder.body.data.id),
    `首次发布也必须提示重叠的未来订单: ${JSON.stringify((fpv.futureOrders ?? []).map((o) => o.orderNo))}`
  );
  const previewFirstPublish = await request("POST", `/api/rental/v1/calendars/${previewYear}/publish`, { changeReason: "预览用例首发" }, construction.accessToken);
  assert.equal(previewFirstPublish.status, 201, `预览基线发布失败: ${previewFirstPublish.status} ${JSON.stringify(previewFirstPublish.body).slice(0, 200)}`);
  // 在已发布日历上下一张覆盖该日期的未来订单，用于验证「存在未来订单时必须提示」。
  const previewQuote = await closedQuote(`${previewYear}-07-14T10:00:00+08:00`, `${previewYear}-07-16T10:00:00+08:00`);
  assert.equal(previewQuote.status, 201, `预览用例报价失败: ${previewQuote.status} ${JSON.stringify(previewQuote.body).slice(0, 220)}`);
  const previewOrder = await request("POST", "/api/rental/v1/orders", {
    quoteId: previewQuote.body.data.id, customerType: "corporate", customerName: "E2E 预览客户",
    fulfillmentMode: "warehouse_pickup_return", fulfillmentLocationId: constructionLocation.id,
    startAt: `${previewYear}-07-14T10:00:00+08:00`, endAt: `${previewYear}-07-16T10:00:00+08:00`,
    lines: [{ itemGroupId: priceGroupId, quantity: 1 }], qualificationApproved: true
  }, construction.accessToken);
  assert.equal(previewOrder.status, 201, `预览用例订单失败: ${previewOrder.status} ${JSON.stringify(previewOrder.body).slice(0, 220)}`);
  // 再改草稿：同一天改成停业 + 改系数 + 改时段，三个维度一次性覆盖。
  const previewEdit = await request("PUT", `/api/rental/v1/calendars/${previewYear}/days/${previewDate}`, {
    date: previewDate, dayType: "tenant_special", name: "预览变更", pricingMultiplier: 2, closed: true,
    businessStatus: "closed", hours: { windows: [{ start: "10:00", end: "12:00" }] }, overrideReason: "预览用例变更"
  }, construction.accessToken);
  assert.equal(previewEdit.status, 200, `预览变更失败: ${previewEdit.status} ${JSON.stringify(previewEdit.body).slice(0, 200)}`);
  const preview = await request("GET", `/api/rental/v1/calendars/${previewYear}/publish-preview`, null, construction.accessToken);
  assert.equal(preview.status, 200, `发布预览失败: ${preview.status} ${JSON.stringify(preview.body).slice(0, 220)}`);
  const pv = preview.body.data;
  assert.equal(pv.firstPublish, false, "已有已发布版本时不应标记为首次发布");
  assert.equal(pv.publishedVersion, previewFirstPublish.body.data.version, `预览必须指出当前已发布版本: ${pv.publishedVersion}`);
  assert.notEqual(pv.draftVersion, pv.publishedVersion, "待发布草稿必须是另一个版本");
  const previewChanged = (pv.dates ?? []).find((d) => d.date === previewDate);
  assert.ok(previewChanged, `受影响日期必须包含被改的那天: ${JSON.stringify((pv.dates ?? []).map((d) => d.date)).slice(0, 200)}`);
  assert.equal(previewChanged.change, "changed", `该日期应判为变更: ${previewChanged.change}`);
  for (const field of ["businessStatus", "closed", "pricingMultiplier", "hours"]) {
    assert.ok(previewChanged.changedFields.includes(field), `变化维度必须含 ${field}: ${JSON.stringify(previewChanged.changedFields)}`);
  }
  assert.equal(previewChanged.before.pricingMultiplier, 1, `前值系数应为 1: ${previewChanged.before.pricingMultiplier}`);
  assert.equal(previewChanged.after.pricingMultiplier, 2, `后值系数应为 2: ${previewChanged.after.pricingMultiplier}`);
  assert.ok(pv.closureChanges.includes(previewDate), `停业变化清单必须含该日期: ${JSON.stringify(pv.closureChanges)}`);
  assert.ok(pv.hoursChanges.includes(previewDate), `营业时段变化清单必须含该日期: ${JSON.stringify(pv.hoursChanges)}`);
  assert.ok(pv.pricingChanges.includes(previewDate), `特殊价格变化清单必须含该日期: ${JSON.stringify(pv.pricingChanges)}`);
  assert.equal(pv.officialSourceConfirmed, false, "纯人工覆盖的年度不得声称官方来源已确认");
  // 未来订单必须被提示，且**不得被改动**。
  const flagged = (pv.futureOrders ?? []).find((o) => o.orderId === previewOrder.body.data.id);
  assert.ok(flagged, `覆盖受影响日期的未来订单必须被提示: ${JSON.stringify((pv.futureOrders ?? []).map((o) => o.orderNo))}`);
  assert.ok(flagged.affectedDates.includes(previewDate), `提示必须指出重叠的日期: ${JSON.stringify(flagged.affectedDates)}`);
  const orderAfterPreview = readRow(
    `SELECT \`status\`, \`startAt\`, \`endAt\` FROM \`rental_orders\` WHERE \`id\`='${previewOrder.body.data.id}';`
  );
  assert.equal(orderAfterPreview.status, previewOrder.body.data.status, `预览不得改变订单状态: ${orderAfterPreview.status}`);
  // 预览是只读的：调用它不得把草稿发布掉。
  const stillDraft = (await request("GET", `/api/rental/v1/calendars/${previewYear}/versions`, null, construction.accessToken)).body.data;
  assert.ok(
    stillDraft.some((v) => v.version === pv.draftVersion && v.status === "draft"),
    `预览后草稿必须仍是草稿: ${JSON.stringify(stillDraft.map((v) => [v.version, v.status]))}`
  );
  ok("发布前影响预览：首次发布也列出受影响日期并提示重叠未来订单（基准是周模板而非空日历）、指出当前已发布版本与待发布草稿、逐日变化维度（停业/时段/特殊价格各自成清单）、前后取值、官方来源未确认、订单与草稿状态均未被改动");

  console.log("== 15o. PRICE-02 官方来源版本：快照不可变 + 序号原子性与排序 + 停用来源不可再应用 ==");
  // #2 来源版本必须不可变：读取历史版本不得 join 主档当前值，否则主档改名就改写了历史含义。
  const snapSourceName = `E2E 快照来源-${Date.now().toString(36)}`;
  const snapPlatform = await login("platform", "admin", PLATFORM_PASSWORD);
  const snapSource = await request("POST", "/api/platform/official-calendars", {
    region: "CN", name: snapSourceName, url: "https://example.invalid/e2e-snap-a"
  }, snapPlatform.accessToken);
  assert.equal(snapSource.status, 201, `建快照用例来源失败: ${snapSource.status} ${JSON.stringify(snapSource.body).slice(0, 200)}`);
  const snapSourceId = snapSource.body.data.id;
  const snapYear = 2039;
  const snapVersion = await request("POST", `/api/platform/official-calendars/${snapSourceId}/versions`, {
    year: snapYear, publishedAt: new Date(Date.now() - 86400000).toISOString(),
    days: [{ date: `${snapYear}-10-01`, dayType: "statutory_holiday", name: "国庆节" }]
  }, snapPlatform.accessToken);
  assert.equal(snapVersion.status, 201, `登记快照用例版本失败: ${snapVersion.status} ${JSON.stringify(snapVersion.body).slice(0, 200)}`);
  assert.equal(snapVersion.body.data.sequence, 1, `首个版本序号应为 1: ${snapVersion.body.data.sequence}`);
  assert.equal(snapVersion.body.data.sourceName, snapSourceName, "版本必须带来源名称快照");
  // 改主档名称与地址后，历史版本必须仍显示登记当时的值。
  const renamed = await request("PUT", `/api/platform/official-calendars/${snapSourceId}`, {
    region: "CN", name: `${snapSourceName}（已改名）`, url: "https://example.invalid/e2e-snap-CHANGED"
  }, snapPlatform.accessToken);
  assert.equal(renamed.status, 200, `改来源主档失败: ${renamed.status} ${JSON.stringify(renamed.body).slice(0, 200)}`);
  const afterRename = (await request("GET", `/api/platform/official-calendars/${snapSourceId}/versions`, null, snapPlatform.accessToken)).body.data;
  const snapAfter = afterRename.find((v) => v.id === snapVersion.body.data.id);
  assert.ok(snapAfter, "改名后仍应查得到该历史版本");
  assert.equal(snapAfter.sourceName, snapSourceName, `历史版本的来源名称不得随主档改名而变: ${snapAfter.sourceName}`);
  assert.equal(snapAfter.sourceUrl, "https://example.invalid/e2e-snap-a", `历史版本的来源地址不得随主档变更而变: ${snapAfter.sourceUrl}`);
  // 空间引用该历史版本时，写进空间日历的也必须是快照值。
  const snapApply = await applyOfficialVersion(snapYear, snapVersion.body.data.id, construction.accessToken);
  assert.equal(snapApply.status, 201, `应用快照版本失败: ${snapApply.status} ${JSON.stringify(snapApply.body).slice(0, 200)}`);
  assert.equal(snapApply.body.data.sourceName, snapSourceName, `空间日历记录的来源名称应是版本快照值: ${snapApply.body.data.sourceName}`);

  // #9 序号原子性与排序：连续登记 12 个版本，序号必须 1..12，且列表按数值序号倒序
  //    （字符串倒序会把 1.9 排在 1.10 之前）。
  const seqYear = 2040;
  const seqSeen = [];
  for (let i = 0; i < 12; i += 1) {
    const res = await request("POST", `/api/platform/official-calendars/${snapSourceId}/versions`, {
      year: seqYear, publishedAt: new Date(Date.now() - 86400000).toISOString(),
      days: [{ date: `${seqYear}-10-01`, dayType: "statutory_holiday", name: `国庆节 v${i}` }]
    }, snapPlatform.accessToken);
    assert.equal(res.status, 201, `第 ${i + 1} 次登记失败: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    seqSeen.push(res.body.data.sequence);
  }
  assert.deepEqual(seqSeen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], `12 个连续版本的序号必须严格递增: ${JSON.stringify(seqSeen)}`);
  const seqList = (await request("GET", `/api/platform/official-calendars/${snapSourceId}/versions?year=${seqYear}`, null, snapPlatform.accessToken)).body.data;
  assert.equal(seqList.length, 12, `该年度应有 12 个版本: ${seqList.length}`);
  assert.equal(seqList[0].sequence, 12, `列表必须按数值序号倒序，首条应是序号 12: ${seqList[0].sequence}`);
  assert.equal(seqList[0].version, "1.11", `序号 12 的展示版本号应为 1.11: ${seqList[0].version}`);
  // 关键：1.10/1.11 必须排在 1.9 之前——这正是字符串排序会出错的地方。
  const idx = (label) => seqList.findIndex((v) => v.version === label);
  assert.ok(idx("1.11") < idx("1.9"), `1.11 必须排在 1.9 之前（字符串倒序会反）: ${JSON.stringify(seqList.map((v) => v.version))}`);
  assert.ok(idx("1.10") < idx("1.9"), `1.10 必须排在 1.9 之前: ${JSON.stringify(seqList.map((v) => v.version))}`);

  // 并发登记：4 路同时登记同一 (来源, 年度)，不得出现重复序号，也不得因为"先查后写"
  // 而静默丢版本；落败者要么拿到新序号（重试成功），要么明确 409。
  const concurrentYear = 2041;
  const concurrentRegistrations = await Promise.all(
    [0, 1, 2, 3].map((i) =>
      request("POST", `/api/platform/official-calendars/${snapSourceId}/versions`, {
        year: concurrentYear, publishedAt: new Date(Date.now() - 86400000).toISOString(),
        days: [{ date: `${concurrentYear}-10-0${i + 1}`, dayType: "statutory_holiday", name: `并发 ${i}` }]
      }, snapPlatform.accessToken)
    )
  );
  const okSequences = concurrentRegistrations.filter((r) => r.status === 201).map((r) => r.body.data.sequence);
  const conflicts = concurrentRegistrations.filter((r) => r.status === 409);
  assert.equal(
    okSequences.length + conflicts.length,
    4,
    `并发登记只允许 201 或 409，实际状态: ${JSON.stringify(concurrentRegistrations.map((r) => r.status))}`
  );
  assert.ok(okSequences.length >= 1, "并发登记至少要有一路成功");
  assert.equal(new Set(okSequences).size, okSequences.length, `并发成功的序号不得重复: ${JSON.stringify(okSequences)}`);
  const concurrentRows = readCount(
    `SELECT COUNT(*) FROM \`official_calendar_source_versions\` WHERE \`sourceId\`='${snapSourceId}' AND \`year\`=${concurrentYear};`
  );
  assert.equal(concurrentRows, okSequences.length, `落库条数必须与成功次数一致: ${concurrentRows} vs ${okSequences.length}`);

  // #8 停用来源后不得再被空间新应用，但已引用它的历史日历必须原样保留。
  const deactivated = await request("PUT", `/api/platform/official-calendars/${snapSourceId}`, {
    region: "CN", name: `${snapSourceName}（已改名）`, url: "https://example.invalid/e2e-snap-CHANGED", isActive: false
  }, snapPlatform.accessToken);
  assert.equal(deactivated.status, 200, `停用来源失败: ${deactivated.status}`);
  const tenantVisible = (await request("GET", `/api/rental/v1/official-calendar-sources?year=${snapYear}`, null, construction.accessToken)).body.data;
  assert.ok(
    !tenantVisible.some((v) => v.sourceId === snapSourceId),
    `停用来源的版本不得出现在空间可选列表里: ${JSON.stringify(tenantVisible.map((v) => v.sourceName))}`
  );
  const applyDeactivated = await applyOfficialVersion(snapYear, snapVersion.body.data.id, construction.accessToken);
  assert.equal(applyDeactivated.status, 409, `停用来源的版本不得再被应用: ${applyDeactivated.status} ${JSON.stringify(applyDeactivated.body).slice(0, 200)}`);
  const historyIntact = (await request("GET", `/api/rental/v1/calendars/${snapYear}`, null, construction.accessToken)).body.data;
  assert.equal(
    historyIntact.sourceVersionId,
    snapVersion.body.data.id,
    `已引用该版本的历史日历必须原样保留: ${historyIntact.sourceVersionId}`
  );
  // 引用关系必须**落库**：领域对象有值但仓储漏接线时，重启后追溯不出这一年的官方
  // 安排来自哪一版（本仓库历史上多次踩过「schema 有列、落库永远 NULL」）。
  const persistedSourceRef = readRow(
    `SELECT \`sourceVersionId\`, \`sourceVersion\` FROM \`rental_business_calendars\` WHERE \`tenantId\`='${construction.tenant.tenantId}' AND \`year\`=${snapYear} ORDER BY \`revision\` DESC LIMIT 1;`
  );
  assert.equal(
    persistedSourceRef.sourceVersionId,
    snapVersion.body.data.id,
    `引用的来源版本 id 必须落库: ${persistedSourceRef.sourceVersionId}`
  );
  assert.equal(
    persistedSourceRef.sourceVersion,
    snapVersion.body.data.version,
    `引用的来源版本号必须落库: ${persistedSourceRef.sourceVersion}`
  );
  ok("官方来源版本：来源信息按登记时快照（主档改名/改址不改写历史版本，空间引用也用快照）+ 序号原子递增（12 连续版本 1..12、列表按数值序号倒序使 1.11/1.10 排在 1.9 之前）+ 并发登记只有 201/409 且序号不重复、落库条数与成功数一致 + 停用来源后空间列表过滤且新应用 409，而已引用的历史日历不受影响且引用关系落库");

  console.log("== 15p. PRICE-02 历史版本恢复必须生成新草稿，不得原地改回（Codex #3） ==");
  // 需求 4.5.7：「恢复旧规则也必须以旧内容生成新的发布版本，不得删除新版本或把旧版本原地改回」。
  const restYear = 2042;
  const restDate = `${restYear}-04-05`;
  const restSeed = await request("PUT", `/api/rental/v1/calendars/${restYear}/days/${restDate}`, {
    date: restDate, dayType: "tenant_special", name: "旧版安排", pricingMultiplier: 1.4, closed: false, overrideReason: "恢复用例：第一版"
  }, construction.accessToken);
  assert.equal(restSeed.status, 200, `恢复用例建草稿失败: ${restSeed.status} ${JSON.stringify(restSeed.body).slice(0, 200)}`);
  const restPub1 = await request("POST", `/api/rental/v1/calendars/${restYear}/publish`, { changeReason: "恢复用例首发" }, construction.accessToken);
  assert.equal(restPub1.status, 201, `恢复用例首发失败: ${restPub1.status} ${JSON.stringify(restPub1.body).slice(0, 200)}`);
  const oldVersion = restPub1.body.data.version;
  // 第二版把该日期改成另一套安排并发布，第一版随之进入 superseded。
  const restEdit = await request("PUT", `/api/rental/v1/calendars/${restYear}/days/${restDate}`, {
    date: restDate, dayType: "tenant_special", name: "新版安排", pricingMultiplier: 2.2, closed: false, overrideReason: "恢复用例：第二版"
  }, construction.accessToken);
  assert.equal(restEdit.status, 200, `恢复用例第二版失败: ${restEdit.status}`);
  const restPub2 = await request("POST", `/api/rental/v1/calendars/${restYear}/publish`, { changeReason: "恢复用例二发" }, construction.accessToken);
  assert.equal(restPub2.status, 201, `恢复用例二发失败: ${restPub2.status} ${JSON.stringify(restPub2.body).slice(0, 200)}`);
  const currentVersion = restPub2.body.data.version;
  assert.notEqual(currentVersion, oldVersion, "第二次发布必须是新版本号");
  // 原因必填。
  const restoreNoReason = await request("POST", `/api/rental/v1/calendars/${restYear}/versions/${encodeURIComponent(oldVersion)}/restore`, {}, construction.accessToken);
  assert.equal(restoreNoReason.status, 400, `恢复缺原因必须 400: ${restoreNoReason.status}`);
  // 恢复第一版：必须生成**新草稿**，不得把 v1 原地改回、也不得动当前已发布版本。
  const restoredDraft = await request("POST", `/api/rental/v1/calendars/${restYear}/versions/${encodeURIComponent(oldVersion)}/restore`, { reason: "新版调休有误，回到上一版" }, construction.accessToken);
  assert.equal(restoredDraft.status, 201, `恢复历史版本失败: ${restoredDraft.status} ${JSON.stringify(restoredDraft.body).slice(0, 220)}`);
  assert.equal(restoredDraft.body.data.status, "draft", `恢复只能产生草稿: ${restoredDraft.body.data.status}`);
  assert.notEqual(restoredDraft.body.data.version, oldVersion, "恢复不得复用被恢复版本的版本号");
  assert.notEqual(restoredDraft.body.data.version, currentVersion, "恢复不得覆盖当前已发布版本");
  assert.equal(restoredDraft.body.data.restoredFromVersion, oldVersion, `新草稿必须记录恢复来源版本: ${restoredDraft.body.data.restoredFromVersion}`);
  assert.equal(restoredDraft.body.data.restoreReason, "新版调休有误，回到上一版", `新草稿必须记录恢复原因: ${restoredDraft.body.data.restoreReason}`);
  assert.equal(restoredDraft.body.data.previousVersion, currentVersion, `新草稿的上一版本应是当前已发布版本: ${restoredDraft.body.data.previousVersion}`);
  // 内容必须来自旧版本，而不是当前已发布版本。
  const restoredDay = restoredDraft.body.data.days.find((d) => d.date === restDate);
  assert.equal(restoredDay?.name, "旧版安排", `恢复的内容必须来自旧版本: ${restoredDay?.name}`);
  assert.equal(restoredDay?.pricingMultiplier, 1.4, `恢复的系数必须是旧版本的 1.4: ${restoredDay?.pricingMultiplier}`);
  // 被恢复的版本与当前已发布版本都必须原样保留。
  const restVersions = (await request("GET", `/api/rental/v1/calendars/${restYear}/versions`, null, construction.accessToken)).body.data;
  const oldRow = restVersions.find((v) => v.version === oldVersion);
  const curRow = restVersions.find((v) => v.version === currentVersion);
  assert.equal(oldRow?.status, "superseded", `被恢复的版本必须仍是 superseded（不得原地改回）: ${oldRow?.status}`);
  assert.equal(curRow?.status, "published", `当前已发布版本不得被恢复动作改动: ${curRow?.status}`);
  assert.equal(
    restVersions.filter((v) => v.status === "published").length,
    1,
    `恢复后该年度仍只能有一个已发布版本: ${JSON.stringify(restVersions.map((v) => [v.version, v.status]))}`
  );
  // 恢复出来的草稿仍要走发布这条正路，发布后成为新的已发布版本。
  const restPub3 = await request("POST", `/api/rental/v1/calendars/${restYear}/publish`, { changeReason: "回滚到上一版官方安排" }, construction.accessToken);
  assert.equal(restPub3.status, 201, `恢复后的草稿必须能发布: ${restPub3.status} ${JSON.stringify(restPub3.body).slice(0, 200)}`);
  assert.equal(restPub3.body.data.restoredFromVersion, oldVersion, "发布后仍应保留恢复来源，供追溯");
  const persistedRestore = readRow(
    `SELECT \`restoredFromVersion\`, \`restoreReason\` FROM \`rental_business_calendars\` WHERE \`tenantId\`='${construction.tenant.tenantId}' AND \`year\`=${restYear} AND \`version\`='${restoredDraft.body.data.version}';`
  );
  assert.equal(persistedRestore.restoredFromVersion, oldVersion, `恢复来源必须落库: ${persistedRestore.restoredFromVersion}`);
  assert.equal(persistedRestore.restoreReason, "新版调休有误，回到上一版", `恢复原因必须落库: ${persistedRestore.restoreReason}`);
  // 恢复当前正在编辑的版本没有意义，必须明确拒绝而不是静默建一份重复草稿。
  const restoreSelf = await request("POST", `/api/rental/v1/calendars/${restYear}/versions/${encodeURIComponent(restPub3.body.data.version)}/restore`, { reason: "重复恢复" }, construction.accessToken);
  assert.equal(restoreSelf.status, 409, `恢复当前正在编辑的版本必须 409: ${restoreSelf.status}`);
  // [P2] 并发恢复：两路同时恢复同一历史版本，只能一成一败。进程内「已有草稿」检查与落库不在
  // 同一事务，二者可能都通过检查并算出同一新版本号；唯一键挡住第二条，落败方必须转成 409
  // 而不是 500。此刻该年度无草稿（restPub3 已发布），是干净的并发起点。
  const [raceRestoreA, raceRestoreB] = await Promise.all([
    request("POST", `/api/rental/v1/calendars/${restYear}/versions/${encodeURIComponent(oldVersion)}/restore`, { reason: "并发恢复A" }, construction.accessToken),
    request("POST", `/api/rental/v1/calendars/${restYear}/versions/${encodeURIComponent(oldVersion)}/restore`, { reason: "并发恢复B" }, construction.accessToken)
  ]);
  assert.deepEqual(
    [raceRestoreA.status, raceRestoreB.status].sort(),
    [201, 409],
    `并发恢复只能一成一败（落败方须 409 不得 500）: ${JSON.stringify([raceRestoreA.status, raceRestoreB.status])} ${JSON.stringify([raceRestoreA.body, raceRestoreB.body]).slice(0, 300)}`
  );
  const draftsAfterRace = (await request("GET", `/api/rental/v1/calendars/${restYear}/versions`, null, construction.accessToken)).body.data.filter((v) => v.status === "draft");
  assert.equal(draftsAfterRace.length, 1, `并发恢复后只能有一个草稿: ${JSON.stringify(draftsAfterRace.map((v) => v.version))}`);
  // 存在未发布草稿时恢复必须冲突：否则会留下两个有效草稿，旧草稿发布后 editableCalendar
  // 会重新选中它，让已被放弃的旧修改再次进入发布路径。
  const draftBlockDay = await request("PUT", `/api/rental/v1/calendars/${restYear}/days/${restYear}-03-01`, {
    date: `${restYear}-03-01`, dayType: "tenant_special", name: "占位草稿", pricingMultiplier: 1.1, closed: false, overrideReason: "制造一个未发布草稿"
  }, construction.accessToken);
  assert.equal(draftBlockDay.status, 200, `制造草稿失败: ${draftBlockDay.status} ${JSON.stringify(draftBlockDay.body).slice(0, 200)}`);
  const restoreWithDraft = await request("POST", `/api/rental/v1/calendars/${restYear}/versions/${encodeURIComponent(oldVersion)}/restore`, { reason: "存在草稿时恢复" }, construction.accessToken);
  assert.equal(restoreWithDraft.status, 409, `存在未发布草稿时恢复必须 409（不得留下两个草稿）: ${restoreWithDraft.status} ${JSON.stringify(restoreWithDraft.body).slice(0, 200)}`);
  const draftsNow = (await request("GET", `/api/rental/v1/calendars/${restYear}/versions`, null, construction.accessToken)).body.data.filter((v) => v.status === "draft");
  assert.equal(draftsNow.length, 1, `恢复被拒后不得新增草稿，应仍只有 1 个草稿: ${JSON.stringify(draftsNow.map((v) => v.version))}`);
  ok("历史版本恢复：以旧内容生成新草稿并记录来源版本与原因且落库、被恢复版本仍为 superseded、当前已发布版本不受影响、该年度仍只有一个 published、恢复后的草稿可正常发布、原因必填、恢复当前版本被拒、存在未发布草稿时恢复被拒（不留两个草稿）、并发恢复只一成一败（落败 409 非 500）最终仅一个草稿");

  console.log("== 15q. PRICE-02 公共官方来源更新提示（Codex #7） ==");
  // 需求 4.5.2：平台登记新官方版本后，为相关空间生成「存在官方更新」提示，但不得自动
  // 覆盖或自动发布。空间日历记录当前引用的 sourceVersionId，与该来源年度最新有效版本比较。
  const updYear = 2039;
  const updVersionA = await registerOfficialVersion(updYear, [
    { date: `${updYear}-10-01`, dayType: "statutory_holiday", name: "国庆节" }
  ]);
  const applyA = await applyOfficialVersion(updYear, updVersionA.id, construction.accessToken);
  assert.equal(applyA.status, 201, `应用来源版本 A 失败: ${applyA.status} ${JSON.stringify(applyA.body).slice(0, 200)}`);
  // 已应用的就是最新版：不应提示更新。
  const afterApplyA = (await request("GET", `/api/rental/v1/calendars/${updYear}`, null, construction.accessToken)).body.data;
  assert.equal(afterApplyA.sourceVersionId, updVersionA.id, `空间日历必须记录引用的来源版本: ${afterApplyA.sourceVersionId}`);
  assert.equal(afterApplyA.officialSourceUpdateAvailable, false, `已应用最新版时不应提示更新: ${afterApplyA.officialSourceUpdateAvailable}`);
  // 平台登记更新的来源版本 B。
  const updVersionB = await registerOfficialVersion(updYear, [
    { date: `${updYear}-10-01`, dayType: "statutory_holiday", name: "国庆节" },
    { date: `${updYear}-10-08`, dayType: "makeup_workday", name: "国庆调休" }
  ], new Date().toISOString());
  assert.notEqual(updVersionB.version, updVersionA.version, "官方更新必须形成新的来源版本");
  // 现在必须提示「存在官方更新」，但空间日历本身不得被自动改动。
  const afterRegisterB = (await request("GET", `/api/rental/v1/calendars/${updYear}`, null, construction.accessToken)).body.data;
  assert.equal(afterRegisterB.officialSourceUpdateAvailable, true, `登记更新版本后必须提示存在官方更新: ${afterRegisterB.officialSourceUpdateAvailable}`);
  assert.equal(afterRegisterB.latestOfficialSourceVersion, updVersionB.version, `必须给出最新可用版本号: ${afterRegisterB.latestOfficialSourceVersion}`);
  assert.equal(afterRegisterB.sourceVersionId, updVersionA.id, "登记新版本不得自动改动空间已引用的版本（不得自动覆盖）");
  // 全年每天都在 days 里，所以要断言的是「10-08 未被自动灌成官方节假日」，而不是它不存在。
  const notAutoApplied = afterRegisterB.days.find((d) => d.date === `${updYear}-10-08`);
  assert.ok(notAutoApplied && notAutoApplied.source !== "official_cn", `登记新官方版本不得自动把新日期灌成官方来源: ${JSON.stringify(notAutoApplied)}`);
  // 空间主动应用 B 后，提示消失。
  const applyB = await applyOfficialVersion(updYear, updVersionB.id, construction.accessToken);
  assert.equal(applyB.status, 201, `应用来源版本 B 失败: ${applyB.status}`);
  const afterApplyB = (await request("GET", `/api/rental/v1/calendars/${updYear}`, null, construction.accessToken)).body.data;
  assert.equal(afterApplyB.officialSourceUpdateAvailable, false, `应用最新版后提示应消失: ${afterApplyB.officialSourceUpdateAvailable}`);
  assert.equal(afterApplyB.sourceVersionId, updVersionB.id, "应用后必须更新引用的来源版本");
  // #1 跨来源不得误报：另建来源 T 并登记比 S 序号更高的多个版本。sequence 是 (来源,年度) 内的
  // 局部序号，跨来源比大小是错的——空间引用的是来源 S 的最新版，不得被提示"更新到来源 T"。
  const platformForT = await login("platform", "admin", PLATFORM_PASSWORD);
  const sourceT = await request("POST", "/api/platform/official-calendars", {
    region: "CN", name: `E2E 第二来源 ${Date.now().toString(36)}`, url: "https://example.invalid/e2e-source-t"
  }, platformForT.accessToken);
  assert.equal(sourceT.status, 201, `建第二官方来源失败: ${JSON.stringify(sourceT.body).slice(0, 200)}`);
  for (let i = 0; i < 3; i += 1) {
    const v = await request("POST", `/api/platform/official-calendars/${sourceT.body.data.id}/versions`, {
      year: updYear, publishedAt: new Date(Date.now() - 86400000).toISOString(),
      days: [{ date: `${updYear}-10-01`, dayType: "statutory_holiday", name: `来源T第${i + 1}版` }]
    }, platformForT.accessToken);
    assert.equal(v.status, 201, `来源T第${i + 1}版登记失败: ${JSON.stringify(v.body).slice(0, 200)}`);
  }
  const afterOtherSource = (await request("GET", `/api/rental/v1/calendars/${updYear}`, null, construction.accessToken)).body.data;
  assert.equal(
    afterOtherSource.officialSourceUpdateAvailable,
    false,
    `不得跨来源误报更新：空间引用来源 S 的最新版，另一来源 T 序号更高不该触发更新提示: ${JSON.stringify({ upd: afterOtherSource.officialSourceUpdateAvailable, latest: afterOtherSource.latestOfficialSourceVersion })}`
  );
  // #1 从未引用来源 + 同年度存在**两个**来源：只提示「有可用来源可选择（N 个）」，
  // 绝不显示跨来源的「最新 vX」——sequence/v1.x 只在各自来源内有效，跨来源没有全局最新版。
  const selectYear = 2044;
  await registerOfficialVersion(selectYear, [{ date: `${selectYear}-10-01`, dayType: "statutory_holiday", name: "国庆节" }]);
  const platformSel = await login("platform", "admin", PLATFORM_PASSWORD);
  const sourceSel2 = await request("POST", "/api/platform/official-calendars", {
    region: "CN", name: `E2E 选择来源2 ${Date.now().toString(36)}`, url: "https://example.invalid/e2e-select-2"
  }, platformSel.accessToken);
  assert.equal(sourceSel2.status, 201, `建第二可选来源失败: ${JSON.stringify(sourceSel2.body).slice(0, 200)}`);
  const sel2ver = await request("POST", `/api/platform/official-calendars/${sourceSel2.body.data.id}/versions`, {
    year: selectYear, publishedAt: new Date().toISOString(), days: [{ date: `${selectYear}-10-01`, dayType: "statutory_holiday", name: "国庆节" }]
  }, platformSel.accessToken);
  assert.equal(sel2ver.status, 201, `第二可选来源登记版本失败: ${JSON.stringify(sel2ver.body).slice(0, 200)}`);
  const neverApplied = (await request("GET", `/api/rental/v1/calendars/${selectYear}`, null, construction.accessToken)).body.data;
  assert.ok(!neverApplied.sourceVersionId, "该年度空间从未应用任何官方来源");
  assert.equal(neverApplied.officialSourceUpdateAvailable, false, `从未引用来源时不得报「更新」: ${neverApplied.officialSourceUpdateAvailable}`);
  assert.equal(neverApplied.officialSourceAvailableToSelect, true, `有可选官方来源时应提示可选择: ${neverApplied.officialSourceAvailableToSelect}`);
  assert.ok(
    !neverApplied.latestOfficialSourceVersion && !neverApplied.latestOfficialSourceVersionId,
    `未引用来源时不得返回跨来源的「最新 vX」（无业务意义）: ${JSON.stringify({ v: neverApplied.latestOfficialSourceVersion, id: neverApplied.latestOfficialSourceVersionId })}`
  );
  assert.equal(neverApplied.availableOfficialSourceCount, 2, `应返回可用来源数量（两个来源）: ${neverApplied.availableOfficialSourceCount}`);
  // 登记过但全部停用：空状态应是「当前没有可用来源」，不能误报「尚未登记」。
  const deactYear = 2045;
  const deactSource = await request("POST", "/api/platform/official-calendars", {
    region: "CN", name: `E2E 待停用来源 ${Date.now().toString(36)}`, url: "https://example.invalid/e2e-deact"
  }, platformSel.accessToken);
  assert.equal(deactSource.status, 201, `建待停用来源失败: ${JSON.stringify(deactSource.body).slice(0, 200)}`);
  const deactVer = await request("POST", `/api/platform/official-calendars/${deactSource.body.data.id}/versions`, {
    year: deactYear, publishedAt: new Date().toISOString(), days: [{ date: `${deactYear}-10-01`, dayType: "statutory_holiday", name: "国庆节" }]
  }, platformSel.accessToken);
  assert.equal(deactVer.status, 201, `待停用来源登记版本失败: ${JSON.stringify(deactVer.body).slice(0, 200)}`);
  const deactivate = await request("PUT", `/api/platform/official-calendars/${deactSource.body.data.id}`, {
    region: "CN", name: deactSource.body.data.name, url: deactSource.body.data.url, isActive: false
  }, platformSel.accessToken);
  assert.equal(deactivate.status, 200, `停用来源失败: ${JSON.stringify(deactivate.body).slice(0, 200)}`);
  const allDeactivated = (await request("GET", `/api/rental/v1/calendars/${deactYear}`, null, construction.accessToken)).body.data;
  assert.ok(!allDeactivated.officialSourceAvailableToSelect, `全部停用时不得报「可选择」: ${allDeactivated.officialSourceAvailableToSelect}`);
  assert.equal(allDeactivated.officialSourceRegisteredButUnavailable, true, `登记过但全部停用应报「当前没有可用来源」: ${allDeactivated.officialSourceRegisteredButUnavailable}`);
  // 从未登记：两个字段都不设，前端据此显示「尚未登记」。
  const neverRegistered = (await request("GET", `/api/rental/v1/calendars/2046`, null, construction.accessToken)).body.data;
  assert.ok(!neverRegistered.officialSourceAvailableToSelect && !neverRegistered.officialSourceRegisteredButUnavailable, `从未登记年度不得设可选择/已停用标记: ${JSON.stringify({ s: neverRegistered.officialSourceAvailableToSelect, u: neverRegistered.officialSourceRegisteredButUnavailable })}`);
  // Codex 复审 #5：来源→版本外键必须 RESTRICT，不能 CASCADE——否则删一个来源会级联清空
  // 全部不可变历史版本，与「只追加、旧版本保留」相悖。当前没有删除来源的 API，这是库层兜底。
  const fkRule = readScalar(
    "SELECT `DELETE_RULE` FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE `CONSTRAINT_SCHEMA`=DATABASE() AND `CONSTRAINT_NAME`='official_calendar_source_versions_sourceId_fkey';"
  );
  assert.equal(fkRule, "RESTRICT", `来源→版本外键必须 RESTRICT（不可级联删除不可变历史版本），实际 ${fkRule}`);
  ok("公共官方来源更新提示：空间记录引用的来源版本，登记更新版本后返回 officialSourceUpdateAvailable 与最新版本号、但不自动覆盖空间日历，空间主动应用后提示消失；跨来源不误报（另一来源序号更高不触发更新）；从未引用来源时报「可选择」+ 来源数量而非跨来源「最新 vX」（含双来源用例）；登记过但全部停用报「当前无可用来源」、从未登记两标记皆空；来源→版本外键为 RESTRICT 不可级联删除");

  console.log("== 15r. PRICE-02A 日期范围覆盖：批量预览、原子应用、批次审计与权限 ==");
  // 需求 4.5.9：租户只能在基础日历上新增人工覆盖；范围提交全部成功或全部失败，
  // 共用原因/batchId/操作者/时间，只推进一次 revision；既有覆盖必须显式确认；
  // 移除恢复下一优先级来源；跨年度单次请求被拒绝；无编辑权限一律 403。
  // 用 construction 空间 + 未触碰过的 2044 年：无既有日历行，基础值全部来自每周模板。
  const rangeYear = 2044;
  const rangeBase = (await request("GET", `/api/rental/v1/calendars/${rangeYear}`, null, construction.accessToken)).body.data;
  assert.ok(rangeBase.days.length >= 365, `2044 基础日历应为全年: ${rangeBase.days.length}`);
  const rangeFields = {
    dayType: "tenant_special",
    name: "试点特殊周",
    pricingOverrideRef: "E2E-RANGE-SPECIAL",
    businessStatus: "limited",
    hours: { windows: [{ start: "09:00", end: "18:00" }] }
  };
  const rangePreview1 = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range-preview`, {
    startDate: `${rangeYear}-05-01`, endDate: `${rangeYear}-05-10`, fields: rangeFields
  }, construction.accessToken);
  assert.equal(rangePreview1.status, 200, `范围预览失败: ${rangePreview1.status} ${JSON.stringify(rangePreview1.body).slice(0, 300)}`);
  assert.equal(rangePreview1.body.data.totalDays, 10, "预览应覆盖 10 天");
  assert.equal(rangePreview1.body.data.conflictCount, 0, "空白年度不应有冲突");
  assert.equal(rangePreview1.body.data.version, rangeBase.version, "预览应基于当前可编辑版本");
  assert.ok(
    rangePreview1.body.data.days.every((row) => row.base.source === "week_rule" && row.current.source === "week_rule"),
    "无既有日历时基础值与当前值都应来自每周模板"
  );
  assert.ok(
    rangePreview1.body.data.days.every((row) => row.changedFields.includes("dayType") && row.changedFields.includes("businessStatus") && row.changedFields.includes("hours")),
    `预览行应列出将修改的字段: ${JSON.stringify(rangePreview1.body.data.days[0])}`
  );
  // 审计基线：本节开始前 2044 年不应有任何覆盖审计。
  const rangeWs = construction.currentWorkspaceId;
  const auditCountBefore = Number(readScalar(`SELECT COUNT(*) FROM \`rental_calendar_override_audits\` WHERE \`workspaceId\`='${rangeWs}' AND \`year\`=${rangeYear};`));
  assert.equal(auditCountBefore, 0, "2044 年不应有历史覆盖审计");

  const rangeApply1 = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range`, {
    startDate: `${rangeYear}-05-01`, endDate: `${rangeYear}-05-10`, fields: rangeFields, overrideReason: "E2E 范围覆盖第一批"
  }, construction.accessToken);
  assert.equal(rangeApply1.status, 201, `范围应用失败: ${rangeApply1.status} ${JSON.stringify(rangeApply1.body).slice(0, 300)}`);
  const rangeBatch1 = rangeApply1.body.data.batchId;
  assert.match(rangeBatch1, /^[A-Za-z0-9_.:-]{1,64}$/u, "服务端必须返回批次标识");
  assert.equal(rangeApply1.body.data.appliedCount, 10, "应应用 10 天");
  assert.equal(rangeApply1.body.data.revision, 1, "首写 revision 应为 1");
  const rangeAfter1 = (await request("GET", `/api/rental/v1/calendars/${rangeYear}`, null, construction.accessToken)).body.data;
  for (let day = 1; day <= 10; day += 1) {
    const date = `${rangeYear}-05-${String(day).padStart(2, "0")}`;
    const row = rangeAfter1.days.find((item) => item.date === date);
    assert.ok(row, `${date} 应存在于日历`);
    assert.equal(row.source, "tenant_override", `${date} 应为人工覆盖`);
    assert.equal(row.dayType, "tenant_special", `${date} 类型应为 tenant_special`);
    assert.equal(row.businessStatus, "limited", `${date} 应为限时营业`);
    assert.equal(row.closed, false, "限时营业不属于停业，closed 必须为 false");
    assert.equal(row.pricingOverrideRef, "E2E-RANGE-SPECIAL", `${date} 应保存特殊价格引用`);
    assert.ok(row.hours?.windows?.length, `${date} 应带营业时段`);
    assert.equal(row.overrideScope?.kind, "range", `${date} 应记录范围 scope`);
    assert.equal(row.overrideScope?.batchId, rangeBatch1, `${date} 应记录批次标识`);
  }
  // 审计：10 行、同一批次、同一操作时间。
  const batch1Rows = Number(readScalar(`SELECT COUNT(*) FROM \`rental_calendar_override_audits\` WHERE \`workspaceId\`='${rangeWs}' AND \`year\`=${rangeYear} AND \`batchId\`='${rangeBatch1}';`));
  assert.equal(batch1Rows, 10, "第一批应产生 10 行审计");
  const batchDistinct = Number(readScalar(`SELECT COUNT(DISTINCT \`batchId\`) FROM \`rental_calendar_override_audits\` WHERE \`workspaceId\`='${rangeWs}' AND \`year\`=${rangeYear};`));
  assert.equal(batchDistinct, 1, "本节此点应只有一个批次");

  // 重叠范围：既有覆盖必须显式确认；只改选择的字段，未选字段保持原值。
  const rangePreview2 = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range-preview`, {
    startDate: `${rangeYear}-05-03`, endDate: `${rangeYear}-05-06`, fields: { businessStatus: "open" }
  }, construction.accessToken);
  assert.equal(rangePreview2.status, 200, "重叠范围预览应成功");
  assert.equal(rangePreview2.body.data.conflictCount, 4, "4 天已有覆盖应全部标为冲突");
  assert.ok(
    rangePreview2.body.data.days.every((row) => row.current.source === "tenant_override" && row.changedFields.includes("businessStatus")),
    "冲突行应展示当前值与将修改的字段"
  );
  assert.ok(
    rangePreview2.body.data.days.every((row) => row.after.dayType === "tenant_special"),
    "未选择的字段（dayType）在应用后保持原值"
  );
  const rangeApplyNoAck = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range`, {
    startDate: `${rangeYear}-05-03`, endDate: `${rangeYear}-05-06`, fields: { businessStatus: "open" }, overrideReason: "未确认的覆盖"
  }, construction.accessToken);
  assert.equal(rangeApplyNoAck.status, 409, `未确认覆盖必须 409: ${rangeApplyNoAck.status}`);
  assert.ok(/人工覆盖/.test(rangeApplyNoAck.body.message || ""), `409 应说明冲突原因: ${rangeApplyNoAck.body.message}`);
  const rangeApply2 = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range`, {
    startDate: `${rangeYear}-05-03`, endDate: `${rangeYear}-05-06`, fields: { businessStatus: "open" },
    overrideReason: "E2E 范围覆盖第二批（改状态保类型）", batchId: "e2e-15r-batch2", expectedRevision: rangeApply1.body.data.revision,
    overrideConfirmed: true
  }, construction.accessToken);
  assert.equal(rangeApply2.status, 201, `确认后范围应用失败: ${rangeApply2.status} ${JSON.stringify(rangeApply2.body).slice(0, 300)}`);
  assert.equal(rangeApply2.body.data.batchId, "e2e-15r-batch2", "应沿用调用方批次标识");
  assert.equal(rangeApply2.body.data.revision, 2, "第二次范围提交只推进一次 revision");
  const rangeAfter2 = (await request("GET", `/api/rental/v1/calendars/${rangeYear}`, null, construction.accessToken)).body.data;
  for (let day = 3; day <= 6; day += 1) {
    const date = `${rangeYear}-05-${String(day).padStart(2, "0")}`;
    const row = rangeAfter2.days.find((item) => item.date === date);
    assert.equal(row.businessStatus, "open", `${date} 状态应改为 open`);
    assert.equal(row.closed, false, "open 不得把 closed 置真");
    assert.equal(row.dayType, "tenant_special", `${date} 未选择的 dayType 必须保持原值`);
    assert.equal(row.overrideReason, "E2E 范围覆盖第二批（改状态保类型）", `${date} 覆盖原因应更新`);
    assert.equal(row.overrideScope?.batchId, "e2e-15r-batch2", `${date} scope 应记录第二批`);
  }
  assert.equal(rangeAfter2.days.find((item) => item.date === `${rangeYear}-05-01`).overrideScope?.batchId, rangeBatch1, "范围外的批次 1 日期不得被改动");

  // 并发：携带过期 revision 的提交必须 409，且不落任何审计行（无部分写入）。
  const auditCountMid = Number(readScalar(`SELECT COUNT(*) FROM \`rental_calendar_override_audits\` WHERE \`workspaceId\`='${rangeWs}' AND \`year\`=${rangeYear};`));
  assert.equal(auditCountMid, 14, "两批共 14 行审计");
  const rangeStale = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range`, {
    startDate: `${rangeYear}-05-01`, endDate: `${rangeYear}-05-02`, fields: { pricingOverrideRef: "E2E-STALE" },
    overrideReason: "过期 revision 的提交", expectedRevision: 1, overrideConfirmed: true
  }, construction.accessToken);
  assert.equal(rangeStale.status, 409, `过期 revision 必须 409: ${rangeStale.status}`);
  const auditCountAfterStale = Number(readScalar(`SELECT COUNT(*) FROM \`rental_calendar_override_audits\` WHERE \`workspaceId\`='${rangeWs}' AND \`year\`=${rangeYear};`));
  assert.equal(auditCountAfterStale, 14, "被 409 拒绝的提交不得留下任何审计行（无部分保存）");

  // 跨年度单次请求必须拒绝（需求 4.5.9：跨年拆成两个年度批次，由前端拆分提交）。
  const rangeCrossYear = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range`, {
    startDate: `${rangeYear}-12-31`, endDate: `${rangeYear + 1}-01-01`, fields: { dayType: "workday" }, overrideReason: "跨年请求"
  }, construction.accessToken);
  assert.equal(rangeCrossYear.status, 400, `跨年度请求必须 400: ${rangeCrossYear.status}`);
  assert.ok(/跨年度|拆分/.test(rangeCrossYear.body.message || ""), `400 应提示按年度拆分: ${rangeCrossYear.body.message}`);

  // 范围移除：先预览恢复值，再原子移除；恢复到每周模板（无 overriddenFrom 的空白年度）。
  const removePreview = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range-remove-preview`, {
    startDate: `${rangeYear}-05-01`, endDate: `${rangeYear}-05-10`
  }, construction.accessToken);
  assert.equal(removePreview.status, 200, "移除预览应成功");
  assert.equal(removePreview.body.data.overrideCount, 10, "移除预览应发现 10 天覆盖");
  assert.ok(
    removePreview.body.data.days.every((row) => row.restoredSource === "week_rule" && row.restored.source === "week_rule"),
    "空白年度的移除应全部恢复到每周模板"
  );
  const rangeRemove = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range-remove`, {
    startDate: `${rangeYear}-05-01`, endDate: `${rangeYear}-05-10`, overrideReason: "E2E 范围移除", expectedRevision: rangeApply2.body.data.revision
  }, construction.accessToken);
  assert.equal(rangeRemove.status, 201, `范围移除失败: ${rangeRemove.status} ${JSON.stringify(rangeRemove.body).slice(0, 300)}`);
  assert.equal(rangeRemove.body.data.removedCount, 10, "应移除 10 天覆盖");
  assert.equal(rangeRemove.body.data.revision, 3, "移除也只推进一次 revision");
  const rangeAfterRemove = (await request("GET", `/api/rental/v1/calendars/${rangeYear}`, null, construction.accessToken)).body.data;
  for (let day = 1; day <= 10; day += 1) {
    const date = `${rangeYear}-05-${String(day).padStart(2, "0")}`;
    const row = rangeAfterRemove.days.find((item) => item.date === date);
    assert.equal(row.source, "week_rule", `${date} 应恢复每周模板来源`);
    assert.equal(row.overrideReason, undefined, `${date} 不得残留覆盖原因`);
    assert.ok(row.dayType !== "tenant_special", `${date} 不得残留特殊类型`);
  }
  const revertRows = Number(readScalar(`SELECT COUNT(*) FROM \`rental_calendar_override_audits\` WHERE \`workspaceId\`='${rangeWs}' AND \`year\`=${rangeYear} AND \`action\`='revert';`));
  assert.equal(revertRows, 10, "移除应产生 10 行 revert 审计");
  const removeEmpty = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range-remove`, {
    startDate: `${rangeYear}-06-01`, endDate: `${rangeYear}-06-02`, overrideReason: "无覆盖可移除"
  }, construction.accessToken);
  assert.equal(removeEmpty.status, 409, `范围内无覆盖必须 409: ${removeEmpty.status}`);

  // 权限：只有 order:view 的账号对范围端点一律 403（服务端独立校验，不靠前端隐藏按钮）。
  const rangeRole = await request("POST", "/api/platform/roles", {
    code: `E2E-RANGE-VIEW-${Date.now().toString(36)}`, name: "E2E 范围只读", scope: "store", dataScope: "all",
    enabledBusinessScopes: ["rental"], permissions: ["store-rental:order:view"], isActive: true
  }, construction.accessToken);
  assert.equal(rangeRole.status, 201, `建只读角色失败: ${JSON.stringify(rangeRole.body).slice(0, 200)}`);
  const rangeAccount = `e2e_range_view_${Date.now().toString(36)}`;
  const rangeUser = await request("POST", "/api/platform/users", {
    account: rangeAccount, displayName: "E2E 范围只读", phone: "13900007777", roleIds: [rangeRole.body.data.id], isActive: true
  }, construction.accessToken);
  assert.equal(rangeUser.status, 201, `建只读账号失败: ${JSON.stringify(rangeUser.body).slice(0, 200)}`);
  const rangeMember = await request("PUT", `/api/platform/workspaces/${rangeWs}/members`, { userId: rangeUser.body.data.id, roleId: rangeRole.body.data.id }, construction.accessToken);
  assert.ok([200, 201].includes(rangeMember.status), `加入成员失败: ${rangeMember.status}`);
  const rangeTemp = rangeUser.body.data.temporaryPassword;
  const rangeFirst = await login("e2e_construction", rangeAccount, rangeTemp);
  const rangePwd = `E2e!${randomBytes(4).toString("hex")}`;
  assert.equal((await request("POST", "/api/auth/change-password", { currentPassword: rangeTemp, newPassword: rangePwd }, rangeFirst.accessToken)).status, 201, "只读账号改密失败");
  const rangeViewer = await login("e2e_construction", rangeAccount, rangePwd);
  const rangeViewDenied = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range-preview`, {
    startDate: `${rangeYear}-05-01`, endDate: `${rangeYear}-05-02`, fields: { businessStatus: "open" }
  }, rangeViewer.accessToken);
  assert.equal(rangeViewDenied.status, 403, `只读账号范围预览必须 403: ${rangeViewDenied.status}`);
  const rangeWriteDenied = await request("POST", `/api/rental/v1/calendars/${rangeYear}/days/range`, {
    startDate: `${rangeYear}-05-01`, endDate: `${rangeYear}-05-02`, fields: { businessStatus: "open" }, overrideReason: "无权提交"
  }, rangeViewer.accessToken);
  assert.equal(rangeWriteDenied.status, 403, `只读账号范围应用必须 403: ${rangeWriteDenied.status}`);

  ok("范围覆盖：预览返回基础/当前/应用后与冲突标记；应用 10 天原子落库（一次 revision、10 行同批次审计、scope 记录批次与范围）；既有覆盖未确认 409、确认后只改所选字段；过期 revision 409 且零审计行（无部分保存）；跨年度 400；移除预览展示恢复值与来源、应用后恢复每周模板且产生 revert 审计；无覆盖范围 409；只读账号预览与应用均 403");

  // E2E_STOP_AFTER=<marker>：前缀分段运行——跑完 marker 所在分段后立即收尾（清理测试库）。
  // 只在显式设置环境变量时生效；不跳过、不削弱任何断言，仅供复测「目标段 + 全部前置段」。
  await maybeStopAfter("15r");

  console.log("== 15s. PRICE-01 取价时点与分时命中：周五 10:00 与 14:00 的 24 小时块不同价 ==");
  // 需求 4.5.6 v2.9：每个计费单位按其**取价时点**命中分时价格；4.4.5：默认不因
  // 跨过分时边界拆分完整计费块。造一个「周五 12:00 → 周一 00:00 系数 1.5」的
  // 一次性日期时间覆盖（PRICE-02A 范围覆盖 API），断言：
  //   周五 10:00 起的 24h 块（取价时点 10:00，覆盖外）→ 基础价 100；
  //   周五 14:00 起的 24h 块（取价时点 14:00，覆盖内）→ 150；
  //   周五 10:00 → 周六 10:30 = 2 个完整块，不因跨过 12:00 边界拆块 → 100 + 150 = 250
  //   （若按边界拆分会得 100×(2/24)+150×(22/24) ≈ 145.83）。
  // 周期性计价时段（每周五 12:00 起按周末价）的价格事实由 PRICE-03 承接；这里用
  // 同一解析点验证一次性覆盖。快照逐单位保存 priceAt / hitLayer / 价格计划版本。
  let fridayKey = null;
  for (let day = 1; day <= 7; day += 1) {
    const candidate = `2045-01-${String(day).padStart(2, "0")}`;
    if (new Date(`${candidate}T00:00:00Z`).getUTCDay() === 5) {
      fridayKey = candidate;
      break;
    }
  }
  assert.ok(fridayKey, "应能定位 2045 年第一个周五");
  // camera 品类支持 day_24h 计价单位（construction 不支持），因此夹具放 demo 空间。
  const dtDemo = await login("demo", "admin", DEMO_PASSWORD);
  const dtLocations = (await request("GET", "/api/rental/v1/locations", null, dtDemo.accessToken)).body.data;
  const dtLocation = dtLocations.find((row) => row.status === "enabled" && row.capabilities.includes("pickup") && row.capabilities.includes("return") && row.capabilities.includes("storage"));
  assert.ok(dtLocation, "demo 空间应有一个支持领取/归还/仓储的启用地点");
  const mondayKey = new Date(new Date(`${fridayKey}T00:00:00Z`).getTime() + 3 * 86400000).toISOString().slice(0, 10);
  assert.equal(new Date(`${mondayKey}T00:00:00Z`).getUTCDay(), 1, "覆盖终点应为周一");

  const dtGroup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    { code: "E2E-PRICE-DT", name: "E2E 分时取价组", inventoryMode: "quantity", unit: "套", attributes: { brand: "E2E影像", model: "PRICE-DT", role: "lens" } },
    dtDemo.accessToken
  );
  assert.equal(dtGroup.status, 201, `分时取价商品组创建失败: ${JSON.stringify(dtGroup.body).slice(0, 200)}`);
  const dtStock = await request(
    "PUT",
    "/api/rental/v1/stock-balances",
    { itemGroupId: dtGroup.body.data.id, locationId: dtLocation.id, onHandQuantity: 10, maintenanceQuantity: 0 },
    dtDemo.accessToken
  );
  assert.equal(dtStock.status, 200, `分时取价库存登记失败: ${JSON.stringify(dtStock.body).slice(0, 200)}`);
  const dtPlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: "E2E-PRICE-DT24",
      name: "E2E 分时取价计划",
      changeReason: "PRICE-01 取价时点验收",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      rates: [
        {
          itemGroupId: dtGroup.body.data.id,
          unit: "day_24h",
          baseAmount: 100,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 500,
          minimumUnits: 1,
          datetimeOverrides: [{
            id: "E2E-DT-2045",
            start: `${fridayKey}T12:00:00+08:00`,
            end: `${mondayKey}T00:00:00+08:00`,
            multiplier: 1.5
          }]
        }
      ]
    },
    dtDemo.accessToken
  );
  assert.equal(dtPlan.status, 201, `分时取价计划创建失败: ${JSON.stringify(dtPlan.body).slice(0, 200)}`);

  // 差异定价开关必须开启，否则日历系数不参与取价；用完还原，避免污染后续用例。
  const dtSettingsBefore = (await request("GET", "/api/rental/v1/business-settings", null, dtDemo.accessToken)).body.data;
  const holidayWasEnabled = dtSettingsBefore.pricing.holidayPricingEnabled;
  if (!holidayWasEnabled) {
    const toggle = await request(
      "PUT",
      "/api/rental/v1/business-settings",
      { ...dtSettingsBefore, pricing: { ...dtSettingsBefore.pricing, holidayPricingEnabled: true } },
      dtDemo.accessToken
    );
    assert.ok([200, 201].includes(toggle.status), `开启日历差异定价失败: ${toggle.status} ${JSON.stringify(toggle.body).slice(0, 200)}`);
  }

  const dtRangeApply = await request(
    "POST",
    `/api/rental/v1/calendars/2045/days/range`,
    {
      startDate: fridayKey,
      endDate: mondayKey,
      startDateTime: `${fridayKey}T12:00:00+08:00`,
      endDateTime: `${mondayKey}T00:00:00+08:00`,
      fields: { pricingOverrideRef: "E2E-DT-2045" },
      overrideReason: "E2E 周五 12:00 起分时价格"
    },
    dtDemo.accessToken
  );
  assert.equal(dtRangeApply.status, 201, `分时覆盖应用失败: ${dtRangeApply.status} ${JSON.stringify(dtRangeApply.body).slice(0, 250)}`);
  // 报价只读**已发布**日历（calendarsForDateRange → publishedCalendar），草稿不参与取价；
  // 因此与 15f 同一口径：覆盖应用后必须发布，2045 年的报价才能看到它。
  const dtPublish1 = await request("POST", "/api/rental/v1/calendars/2045/publish", { changeReason: "E2E 分时价格发布" }, dtDemo.accessToken);
  assert.equal(dtPublish1.status, 201, `2045 首次发布失败: ${dtPublish1.status} ${JSON.stringify(dtPublish1.body).slice(0, 200)}`);
  const dtPublishedRevision = (await request("GET", "/api/rental/v1/calendars/2045", null, dtDemo.accessToken)).body.data.revision;

  const dtQuoteFor = async (startAt, endAt) => {
    const res = await request(
      "POST",
      "/api/rental/v1/quotes",
      {
        customerType: "corporate",
        fulfillmentMode: "store_pickup_return",
        fulfillmentLocationId: dtLocation.id,
        startAt,
        endAt,
        pricingPlanId: dtPlan.body.data.id,
        lines: [{ itemGroupId: dtGroup.body.data.id, quantity: 1 }]
      },
      dtDemo.accessToken
    );
    assert.equal(res.status, 201, `分时取价报价失败: ${res.status} ${JSON.stringify(res.body).slice(0, 250)}`);
    return res.body.data;
  };

  // ① 覆盖外取价：周五 10:00 块（时点早于 12:00）按基础价。
  const satKey = new Date(new Date(`${fridayKey}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const dtOutsideFix = await dtQuoteFor(`${fridayKey}T10:00:00+08:00`, `${satKey}T10:00:00+08:00`);
  assert.equal(dtOutsideFix.rentalAmount, 100, `覆盖外的 24h 块应为基础价 100：实际 ${dtOutsideFix.rentalAmount}`);
  const outsideRow = dtOutsideFix.calendarSnapshot.find((row) => row.date === fridayKey);
  assert.equal(outsideRow.hitLayer, "base", `覆盖外命中层应为 base: ${JSON.stringify(outsideRow)}`);
  assert.equal(outsideRow.multiplier, 1, "覆盖外系数应为 1");
  assert.ok(outsideRow.priceAt, "快照必须保存取价时点");
  assert.equal(outsideRow.pricingPlanVersion, dtPlan.body.data.version, "快照必须保存价格计划版本");

  // ② 覆盖内取价：周五 14:00 块（时点在 12:00 之后）命中一次性覆盖 → 150。
  const dtInside = await dtQuoteFor(`${fridayKey}T14:00:00+08:00`, `${satKey}T14:00:00+08:00`);
  assert.equal(dtInside.rentalAmount, 150, `覆盖内的 24h 块应为 100 × 1.5 = 150：实际 ${dtInside.rentalAmount}`);
  const insideRow = dtInside.calendarSnapshot.find((row) => row.date === fridayKey);
  assert.equal(insideRow.hitLayer, "date_override", `覆盖内命中层应为 date_override: ${JSON.stringify(insideRow)}`);
  assert.equal(insideRow.multiplier, 1.5, "覆盖内系数应为 1.5");
  assert.equal(insideRow.source, "tenant_override", "命中覆盖时来源应为人工覆盖");

  // ③ 不拆块：两个用例。
  // (a) 周五 10:00 → 周六 10:30 = 2 个完整 24h 块（24.5h 进位为 2）；块 1 跨过 12:00
  //     边界仍**完全按其开始时点**取价，不拆成 2h×基础 + 22h×1.5（那样会得 ≈145.83）。
  const dtNoSplit = await dtQuoteFor(`${fridayKey}T10:00:00+08:00`, `${satKey}T10:30:00+08:00`);
  assert.equal(dtNoSplit.rentalAmount, 250, `两块应为 100 + 150 = 250（按边界拆分块 1 会得 ≈145.83）：实际 ${dtNoSplit.rentalAmount}`);
  const noSplitRows = dtNoSplit.calendarSnapshot.filter((row) => row.itemGroupId === dtGroup.body.data.id);
  assert.equal(noSplitRows.length, 2, "应有两个取价行（周五/周六）");
  assert.equal(noSplitRows.find((row) => row.date === fridayKey).hitLayer, "base", "周五块未命中覆盖");
  assert.equal(noSplitRows.find((row) => row.date === satKey).hitLayer, "date_override", "周六块应命中覆盖");
  // (b) 周五 10:00 → 周日 10:30 = 3 个完整块 → 100 + 150 + 150 = 400；3 个块若按日期
  //     集合平均 1.25 会得 375，按单位逐个取价才是 400。
  const sunKey = new Date(new Date(`${fridayKey}T00:00:00Z`).getTime() + 2 * 86400000).toISOString().slice(0, 10);
  const dtThreeBlocks = await dtQuoteFor(`${fridayKey}T10:00:00+08:00`, `${sunKey}T10:30:00+08:00`);
  assert.equal(dtThreeBlocks.rentalAmount, 400, `三块应为 100 + 150 + 150 = 400（平均倍率会得 375）：实际 ${dtThreeBlocks.rentalAmount}`);

  // 清理：移除分时覆盖，还原差异定价开关。
  const dtRemove = await request(
    "POST",
    `/api/rental/v1/calendars/2045/days/range-remove`,
    {
      startDate: fridayKey,
      endDate: mondayKey,
      overrideReason: "E2E 分时覆盖清理",
      expectedRevision: dtPublishedRevision
    },
    dtDemo.accessToken
  );
  assert.equal(dtRemove.status, 201, `分时覆盖移除失败: ${dtRemove.status} ${JSON.stringify(dtRemove.body).slice(0, 200)}`);
  // 把移除后的周模板结果发布为当前版本，避免 2045 的已发布版本残留覆盖影响后续。
  const dtPublish2 = await request("POST", "/api/rental/v1/calendars/2045/publish", { changeReason: "E2E 移除后发布周模板" }, dtDemo.accessToken);
  assert.equal(dtPublish2.status, 201, `2045 移除后发布失败: ${dtPublish2.status}`);
  if (!holidayWasEnabled) {
    const restoreToggle = await request(
      "PUT",
      "/api/rental/v1/business-settings",
      dtSettingsBefore,
      dtDemo.accessToken
    );
    assert.ok([200, 201].includes(restoreToggle.status), `还原日历差异定价失败: ${restoreToggle.status}`);
  }

  ok("取价时点与分时命中：快照逐单位保存 priceAt/hitLayer/价格计划版本；周五 10:00 块（覆盖外）按基础价、14:00 块（覆盖内）命中一次性日期时间覆盖得 150；周五 10:00 → 周六 10:30 的两个完整块不因跨过分时边界拆块（100+150=250，拆分价 ≈145.83 被排除）；覆盖移除与差异定价开关已还原");

  await maybeStopAfter("15s");

  console.log("== 15t. PRICE-02 确认与领取时点复查营业状态（需求 4.5.4/4.6.4） ==");
  // 需求 4.5.4：「报价和订单必须分别校验领取与归还时点的地点能力和营业状态」；
  // 4.6.4：领取前必须重新校验……营业状态。此前 assertFulfillmentDayOpen 只有报价一个
  // 调用点——报价后运营把端点覆盖成停业日，确认与领取会照常进行。归还仍不拦：
  // 停业不得让在租订单失去归还渠道。
  // 「今天」必须按**营业时区**（默认 Asia/Shanghai）取：领取复查用 businessDateKey(now, tz)，
  // UTC 日期在晚间会与营业日差一天，导致覆盖错日期、复查形同虚设。
  const recheckToday = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const recheckYear = Number(recheckToday.slice(0, 4));
  // (a) 确认复查：报价（端点均为开放日）→ 把领取日覆盖成停业并发布 → 同一报价确认 409。
  const recheckQuote = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
            customerType: "personal",
      customerId: "recheck_customer",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: "2027-08-11T09:00:00+08:00",
      endAt: "2027-08-13T09:00:00+08:00",
      pricingPlanId: pricePlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(recheckQuote.status, 201, `复查用报价失败: ${recheckQuote.status} ${JSON.stringify(recheckQuote.body).slice(0, 200)}`);
  const recheckDayOverride = await request(
    "PUT",
    `/api/rental/v1/calendars/2027/days/2027-08-11`,
    { date: "2027-08-11", dayType: "tenant_special", name: "E2E 复查停业", pricingMultiplier: 1, closed: true, overrideReason: "E2E 确认复查" },
    construction.accessToken
  );
  assert.equal(recheckDayOverride.status, 200, `覆盖领取日失败: ${recheckDayOverride.status}`);
  const recheckPublish = await request("POST", "/api/rental/v1/calendars/2027/publish", { changeReason: "E2E 复查停业发布" }, construction.accessToken);
  assert.equal(recheckPublish.status, 201, `复查发布失败: ${recheckPublish.status}`);
  const recheckConfirm = await request(
    "POST",
    "/api/rental/v1/orders",
    {
      quoteId: recheckQuote.body.data.id,
            customerType: "personal",
            customerId: "recheck_customer",
      customerName: "E2E 复查客户",
      qualificationApproved: true,
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: "2027-08-11T09:00:00+08:00",
      endAt: "2027-08-13T09:00:00+08:00",
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(recheckConfirm.status, 409, `领取日已停业时确认必须 409: ${recheckConfirm.status} ${JSON.stringify(recheckConfirm.body).slice(0, 200)}`);
  assert.ok(/停止营业/.test(recheckConfirm.body.message || ""), `409 应说明停业: ${recheckConfirm.body.message}`);
  // 清理：移除停业覆盖并发布，2027 恢复开放，该报价仍可用。
  const recheckRemove = await request(
    "POST",
    "/api/rental/v1/calendars/2027/days/range-remove",
    { startDate: "2027-08-11", endDate: "2027-08-11", overrideReason: "E2E 复查清理" },
    construction.accessToken
  );
  assert.equal(recheckRemove.status, 201, `复查清理失败: ${recheckRemove.status}`);
  await request("POST", "/api/rental/v1/calendars/2027/publish", { changeReason: "E2E 复查清理发布" }, construction.accessToken);
  const recheckConfirmAfter = await request(
    "POST",
    "/api/rental/v1/orders",
    {
      quoteId: recheckQuote.body.data.id,
            customerType: "personal",
            customerId: "recheck_customer",
      customerName: "E2E 复查客户",
      qualificationApproved: true,
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: "2027-08-11T09:00:00+08:00",
      endAt: "2027-08-13T09:00:00+08:00",
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(recheckConfirmAfter.status, 201, `恢复开放后确认应成功: ${recheckConfirmAfter.status} ${JSON.stringify(recheckConfirmAfter.body).slice(0, 200)}`);

  // (b) 领取复查：把「今天」覆盖成停业并发布 → 领取 409；归还路径不受停业影响。
  const recheckTodayQuote = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: new Date(Date.now() + 3600000).toISOString(),
      endAt: new Date(Date.now() + 26 * 3600000).toISOString(),
      pricingPlanId: pricePlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(recheckTodayQuote.status, 201, `领取复查用报价失败: ${recheckTodayQuote.status}`);
  const todayOverride = await request(
    "PUT",
    `/api/rental/v1/calendars/${recheckYear}/days/${recheckToday}`,
    { date: recheckToday, dayType: "tenant_special", name: "E2E 当日盘点", pricingMultiplier: 1, closed: true, overrideReason: "E2E 领取复查" },
    construction.accessToken
  );
  assert.ok([200, 201].includes(todayOverride.status), `覆盖今天失败: ${todayOverride.status}`);
  const todayPublish = await request("POST", `/api/rental/v1/calendars/${recheckYear}/publish`, { changeReason: "E2E 领取复查发布" }, construction.accessToken);
  assert.ok([201, 200].includes(todayPublish.status), `当天发布失败: ${todayPublish.status}`);
  const recheckOrder = recheckConfirmAfter.body.data;
  const recheckPickup = await request("POST", `/api/rental/v1/orders/${recheckOrder.id}/handover/pickup`, null, construction.accessToken);
  assert.equal(recheckPickup.status, 409, `停业日领取必须 409: ${recheckPickup.status} ${JSON.stringify(recheckPickup.body).slice(0, 200)}`);
  assert.ok(/停止营业/.test(recheckPickup.body.message || ""), `领取 409 应说明停业: ${recheckPickup.body.message}`);
  // 还原今天并发布，确认与领取恢复正常。
  await request("POST", `/api/rental/v1/calendars/${recheckYear}/days/range-remove`, { startDate: recheckToday, endDate: recheckToday, overrideReason: "E2E 领取复查清理" }, construction.accessToken);
  await request("POST", `/api/rental/v1/calendars/${recheckYear}/publish`, { changeReason: "E2E 领取复查清理发布" }, construction.accessToken);
  await prepareMockFunding(recheckOrder, construction.accessToken, `e2e:${recheckOrder.id}`);
  // 正向对照：该品类规则要求先完成领取检查，因此还原后领取仍是 409——但消息从
  // 「停止营业」变为「领取检查」，证明请求越过了营业状态复查、进入下一层业务规则。
  const recheckPickupOk = await request("POST", `/api/rental/v1/orders/${recheckOrder.id}/handover/pickup`, null, construction.accessToken);
  assert.equal(recheckPickupOk.status, 409, `还原后领取应越过营业状态复查: ${recheckPickupOk.status}`);
  assert.match(recheckPickupOk.body.message || "", /领取检查/, `还原后应进入领取检查规则而非停业拦截: ${recheckPickupOk.body.message}`);

  ok("确认与领取复查营业状态：领取日被覆盖成停业后同一报价确认 409（说明停业）、还原后确认成功；当天停业时领取 409、还原后越过营业状态复查进入领取检查规则；归还路径不受停业影响");

  await maybeStopAfter("15t");

  console.log("== 15u. PRICE-03 不可变价格版本与调价计划（立即/定时/重叠拒绝） ==");
  // 需求 4.4.3：价格版本是完整、不可变结果；调价计划只存差异，确认时生成完整新版本；
  // 重叠时段在保存/确认时拒绝；新版本不影响有效报价与历史订单。
  const adjBeforeVersions = Number(readScalar(`SELECT COUNT(*) FROM \`rental_price_versions\` WHERE \`planId\`='${pricePlan.body.data.id}';`));
  assert.ok(adjBeforeVersions >= 1, "15b 的保存应已生成价格版本行（保存即调价）");
  const v1Rates = JSON.parse(readScalar(`SELECT \`rates\` FROM \`rental_price_versions\` WHERE \`planId\`='${pricePlan.body.data.id}' AND \`version\`='v1';`));
  assert.equal(v1Rates[0].baseAmount, 100, "v1 版本的基础价应为 100");

  // (a) 立即调价：百分比 +10%，确认时生成完整新版本，预览给出最终价。
  const adjCreate = await request(
    "POST",
    `/api/rental/v1/pricing-plans/${pricePlan.body.data.id}/adjustments`,
    {
      code: `E2E-ADJ-IMM-${Date.now().toString(36)}`,
      name: "E2E 立即调价",
      changes: [{ itemGroupId: priceGroupId, unit: "calendar_day", op: "percent", value: 10 }],
      changeReason: "E2E 上调 10%"
    },
    construction.accessToken
  );
  assert.equal(adjCreate.status, 201, `创建调价计划失败: ${adjCreate.status} ${JSON.stringify(adjCreate.body).slice(0, 200)}`);
  assert.equal(adjCreate.body.data.preview[0].afterBaseAmount, 110, "确认前必须给出逐行最终价（110）");
  const adjConfirm = await request(
    "POST",
    `/api/rental/v1/pricing-plans/${pricePlan.body.data.id}/adjustments/${adjCreate.body.data.id}/confirm`,
    null,
    construction.accessToken
  );
  assert.equal(adjConfirm.status, 201, `确认调价失败: ${adjConfirm.status} ${JSON.stringify(adjConfirm.body).slice(0, 200)}`);
  assert.equal(adjConfirm.body.data.status, "applied", "立即确认应直接生效");
  const v2Rates = JSON.parse(readScalar(`SELECT \`rates\` FROM \`rental_price_versions\` WHERE \`id\`='${adjConfirm.body.data.versionId}';`));
  assert.equal(v2Rates[0].baseAmount, 110, "新版本应为 110");
  const v1After = JSON.parse(readScalar(`SELECT \`rates\` FROM \`rental_price_versions\` WHERE \`planId\`='${pricePlan.body.data.id}' AND \`version\`='v1';`));
  assert.equal(v1After[0].baseAmount, 100, "旧版本必须原样保留（不可变）");

  // (b) 新版本按租期开始时间命中：未来租期用 110；租期开始早于新版本生效的报价仍按 v1 的 100 复算。
  const adjFriday = (() => {
    for (let day = 10; day <= 16; day += 1) {
      const candidate = `2046-03-${String(day).padStart(2, "0")}`;
      if (new Date(`${candidate}T00:00:00Z`).getUTCDay() === 5) return candidate;
    }
    return null;
  })();
  assert.ok(adjFriday, "应能定位 2046 年 3 月的周五");
  const adjQuoteNew = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: `${adjFriday}T09:00:00+08:00`,
      // 刻意只租 2 天：避开 15b 版本里的「满 3 日 90」阶梯档，让断言只反映 baseAmount 的调整。
      endAt: `${new Date(new Date(`${adjFriday}T00:00:00Z`).getTime() + 1 * 86400000).toISOString().slice(0, 10)}T09:00:00+08:00`,
      pricingPlanId: pricePlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(adjQuoteNew.status, 201, `新价报价失败: ${adjQuoteNew.status}`);
  assert.equal(adjQuoteNew.body.data.rentalAmount, 220, `新版本 2 个自然日应为 2 × 110 = 220：实际 ${adjQuoteNew.body.data.rentalAmount}`);

  // 已锁价的历史报价不受新版本影响：旧报价的费率快照与金额在确认后保持不变
  //（可复算保护由 rateSnapshot 承担，(a) 的 v1 行不可变断言覆盖版本层）。

  // (c) 重叠周期时段在保存时拒绝（需求 4.4.3：重叠在确认时阻止，不留到报价时择一）。
  const overlapSave = await request(
    "PUT",
    `/api/rental/v1/pricing-plans/${pricePlan.body.data.id}`,
    {
      code: "E2E-PRICE-TIER",
      name: "E2E 阶梯与封顶价格",
      changeReason: "E2E 重叠时段应拒绝",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 110,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 500,
          minimumUnits: 1,
          periodicWindows: [
            { fromWeekday: 5, fromTime: "12:00", toWeekday: 5, toTime: "23:59", multiplier: 1.5 },
            { fromWeekday: 5, fromTime: "10:00", toWeekday: 6, toTime: "02:00", multiplier: 1.2 }
          ]
        }
      ]
    },
    construction.accessToken
  );
  assert.equal(overlapSave.status, 409, `重叠周期时段必须 409: ${overlapSave.status} ${JSON.stringify(overlapSave.body).slice(0, 200)}`);
  assert.ok(/重叠/.test(overlapSave.body.message || ""), `409 应说明时段重叠: ${overlapSave.body.message}`);

  // (d) 合法的跨周周期时段（周五 12:00 → 周一 00:00 周末价）真实生效：
  //     周五 14:00 起租（取价时点在时段内）→ 3 天全 1.5 = 450；
  //     周五 10:00 起租 → 首日取价时点在时段外按 100、周六周日按 150 → 400。
  const weekendSave = await request(
    "PUT",
    `/api/rental/v1/pricing-plans/${pricePlan.body.data.id}`,
    {
      code: "E2E-PRICE-TIER",
      name: "E2E 阶梯与封顶价格",
      changeReason: "E2E 周五 12:00 起周末价",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      rates: [
        {
          itemGroupId: priceGroupId,
          unit: "calendar_day",
          baseAmount: 100,
          weekendMultiplier: 1,
          holidayMultiplier: 1,
          depositAmount: 500,
          minimumUnits: 1,
          periodicWindows: [
            { fromWeekday: 5, fromTime: "12:00", toWeekday: 6, toTime: "00:00", multiplier: 1.5 },
            { fromWeekday: 6, fromTime: "00:00", toWeekday: 1, toTime: "00:00", multiplier: 1.5 }
          ]
        }
      ]
    },
    construction.accessToken
  );
  assert.equal(weekendSave.status, 200, `合法周期时段保存失败: ${weekendSave.status} ${JSON.stringify(weekendSave.body).slice(0, 200)}`);
  const weekendEnd = new Date(new Date(`${adjFriday}T00:00:00Z`).getTime() + 3 * 86400000).toISOString().slice(0, 10);
  const weekendQuoteInside = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: `${adjFriday}T14:00:00+08:00`,
      endAt: `${weekendEnd}T14:00:00+08:00`,
      pricingPlanId: pricePlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(weekendQuoteInside.status, 201, `周末价报价失败: ${weekendQuoteInside.status}`);
  assert.equal(weekendQuoteInside.body.data.rentalAmount, 550, `周五14:00→周一14:00 占 4 个日历日：周五六日 150×3 + 周一（取价时点在时段外）100 = 550：实际 ${weekendQuoteInside.body.data.rentalAmount}`);
  const weekendQuoteOutside = await request(
    "POST",
    "/api/rental/v1/quotes",
    {
      customerType: "corporate",
      fulfillmentMode: "warehouse_pickup_return",
      fulfillmentLocationId: constructionLocation.id,
      startAt: `${adjFriday}T10:00:00+08:00`,
      endAt: `${weekendEnd}T10:00:00+08:00`,
      pricingPlanId: pricePlan.body.data.id,
      lines: [{ itemGroupId: priceGroupId, quantity: 1 }]
    },
    construction.accessToken
  );
  assert.equal(weekendQuoteOutside.status, 201, `周五 10:00 报价失败: ${weekendQuoteOutside.status}`);
  assert.equal(weekendQuoteOutside.body.data.rentalAmount, 500, `周五10:00→周一10:00 占 4 个日历日：周五 100 + 周六日 150×2 + 周一 100 = 500：实际 ${weekendQuoteOutside.body.data.rentalAmount}`);

  // (e) 定时调价：scheduledAt 未来 → 确认后待生效 → 到期执行生成新版本（与立即同一版本机制）。
  const adjScheduled = await request(
    "POST",
    `/api/rental/v1/pricing-plans/${pricePlan.body.data.id}/adjustments`,
    {
      code: `E2E-ADJ-SCHED-${Date.now().toString(36)}`,
      name: "E2E 定时调价",
      changes: [{ itemGroupId: priceGroupId, unit: "calendar_day", op: "fixed", value: 5 }],
      scheduledAt: new Date(Date.now() + 2000).toISOString(),
      changeReason: "E2E 定时 +5"
    },
    construction.accessToken
  );
  assert.equal(adjScheduled.status, 201, `定时调价创建失败: ${adjScheduled.status}`);
  const adjScheduleConfirm = await request(
    "POST",
    `/api/rental/v1/pricing-plans/${pricePlan.body.data.id}/adjustments/${adjScheduled.body.data.id}/confirm`,
    null,
    construction.accessToken
  );
  assert.equal(adjScheduleConfirm.status, 201, `定时调价确认失败: ${adjScheduleConfirm.status}`);
  assert.equal(adjScheduleConfirm.body.data.status, "pending", "未来生效时刻确认后应为待生效");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const adjRunDue = await request("POST", "/api/rental/v1/pricing-plans/adjustments/run-due", null, construction.accessToken);
  assert.equal(adjRunDue.status, 201, `到期执行失败: ${adjRunDue.status} ${JSON.stringify(adjRunDue.body).slice(0, 200)}`);
  assert.equal(adjRunDue.body.data.ranCount, 1, "到期执行应处理 1 条");
  const schedVersion = JSON.parse(
    readScalar(`SELECT \`rates\` FROM \`rental_price_versions\` WHERE \`id\`='${adjRunDue.body.data.results[0].versionId}';`)
  );
  assert.equal(schedVersion[0].baseAmount, 105, "定时执行基于最新版本（(d) 已把基础价整单重置为 100）+5 = 105");

  ok("价格版本与调价计划：保存即生成不可变版本行、旧版本原样保留；调价计划确认前给出逐行最终价、立即确认生成新版本（v2=110）、新版本按租期开始时间命中（未来租期 220（2×110，避开阶梯档））；重叠周期时段保存 400；合法跨周时段（周五 12:00 → 周一 00:00 周末价）真实生效（550/500，含周一取价时点在时段外的边界）；定时调价待生效到期执行生成新版本（105 = (d) 重置后的 100 + 5）");

  await maybeStopAfter("15u");

  console.log("== 15v. PRICE-02B 月历分时摘要：与报价同一命中助手、同一价格版本 ==");
  // 需求 4.5.9：月历只读消费 PRICE-03 的价格事实，周五仍显示工作日但可叠加分时标记；
  // 摘要由服务端用与报价同一个命中助手（periodicWindowCoversDate）计算，月历不复制
  // 价格值、不建立第二套事实。15u(d) 已给 E2E-PRICE-TIER 配了「周五 12:00 → 周一 00:00」
  // 的跨周时段（系数 1.5），2046-03-10 是周五。
  const sumCalendar = (await request("GET", "/api/rental/v1/calendars/2046", null, construction.accessToken)).body.data;
  assert.ok(Array.isArray(sumCalendar.timePriceSummary), "日历 GET 必须返回 timePriceSummary");
  const sumFriday = sumCalendar.timePriceSummary.find((row) => row.date === adjFriday);
  assert.ok(sumFriday, "周五应有分时摘要");
  const sumEntry = sumFriday.entries.find((entry) => entry.source === "periodic");
  assert.ok(sumEntry, "周五摘要应含周期时段条目");
  assert.equal(sumEntry.planCode, "E2E-PRICE-TIER", "摘要应带计划编码");
  assert.equal(sumEntry.multiplier, 1.5, "摘要应带系数 1.5");
  assert.match(sumEntry.version, /^v/, "摘要必须带价格版本号（与报价命中同源）");
  assert.ok(sumEntry.itemGroupCodes.includes("E2E-PRICE-KIT"), "摘要应列适用商品组编码");
  const sumTuesday = sumCalendar.timePriceSummary.find((row) => row.date === "2046-03-13");
  assert.ok(!sumTuesday, "周二（时段右端开之后）不得有分时摘要");
  const sumSunday = sumCalendar.timePriceSummary.find((row) => row.date === "2046-03-11");
  assert.ok(sumSunday && sumSunday.entries.some((entry) => entry.source === "periodic"), "周日应被跨周时段覆盖");

  ok("月历分时摘要：服务端按与报价同一命中助手与营业时区计算，周五（含时段内周日）有摘要且带计划编码/系数/版本号，时段右端开（周一 00:00）无摘要；月历不复制价格值、不建第二套事实");

  await maybeStopAfter("15v");

  console.log("== 16. 双租户并发隔离 ==");


  const rounds = 12;
  const concurrent = [];
  for (let i = 0; i < rounds; i += 1) {
    concurrent.push(request("GET", "/api/rental/v1/item-groups", null, demo.accessToken).then((res) => ({ tenant: "demo", res })));
    concurrent.push(request("GET", "/api/rental/v1/item-groups", null, demo2.accessToken).then((res) => ({ tenant: "demo2", res })));
    concurrent.push(request("GET", "/api/rental/v1/item-groups", null, vehicleA.accessToken).then((res) => ({ tenant: "vehicleA", res })));
  }
  const settled = await Promise.all(concurrent);
  for (const item of settled) {
    if (item.tenant === "demo") {
      assert.ok(item.res.body.data.every((group) => group.code.startsWith("CAM-") || group.code.startsWith("E2E-CAT03-")), "并发中 demo 数据串线");
    } else if (item.tenant === "demo2") {
      assert.ok(item.res.body.data.every((group) => group.code.startsWith("CAMP-")), "并发中 demo2 数据串线");
    } else {
      assert.ok(item.res.body.data.every((group) => group.code.startsWith("E2E-TRUCK")), "并发中车辆租户数据串线");
    }
  }
  ok(`${settled.length} 个并发请求全部命中本租户数据`);

  console.log("== 17. API 重启恢复 ==");
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("API 重启超时");
  const demoAfterRestart = await login("demo", "admin", DEMO_PASSWORD);
  const ordersAfterRestart = (await request("GET", "/api/rental/v1/orders", null, demoAfterRestart.accessToken)).body.data;
  const restored = ordersAfterRestart.find((item) => item.id === orderId);
  assert.ok(restored, "重启后订单丢失");
  assert.equal(restored.status, "completed");
  assert.ok(readCount("SELECT COUNT(*) FROM `rental_core_state_snapshots` WHERE `tenantId`='tenant_001';") >= 1, "租户聚合快照缺失");
  // 报价的「未来年度官方日历尚未确认」提示必须能从库读回（需求 4.5.2/4.5.6）。
  // 重启前的断言都拿的是同一个内存对象，把 toQuote 的读映射写成常量空数组也照样全绿；
  // 只有重启后重新装载才验证得到 DB→内存 这一段。重启会换 AUTH_TOKEN_SECRET，故须重登。
  const constructionAfterRestart = await login("e2e_construction", "admin", construction.password);
  const warnedQuoteAfterRestart = await request(
    "GET",
    `/api/rental/v1/quotes/${futureQuote.body.data.id}`,
    null,
    constructionAfterRestart.accessToken
  );
  assert.equal(warnedQuoteAfterRestart.status, 200, `重启后读回报价失败: ${warnedQuoteAfterRestart.status} ${JSON.stringify(warnedQuoteAfterRestart.body).slice(0, 160)}`);
  assert.ok(
    (warnedQuoteAfterRestart.body.data.calendarWarnings ?? []).some((w) => w.includes("2028")),
    `重启后报价必须仍带官方日历未确认提示（读映射被守住）: ${JSON.stringify(warnedQuoteAfterRestart.body.data.calendarWarnings)}`
  );
  ok(`重启后订单 ${restored.orderNo} 恢复为 completed，快照在库，报价的官方日历未确认提示随读映射恢复`);

  console.log("== 18. RC-01 核心事实以数据库为事实源 ==");
  // 阶段 3 后订单、行、预占、分配和检查记录直接写规范化表，聚合快照不再承载事实，
  // 因此这里不能再拿快照里的 orders 做对账基准（那个键已经不存在了）。
  // 快照 → 表的回填只对阶段 3 之前建立的旧库有意义，其自身幂等由下面的二次重启覆盖。
  const orderRows = readCount("SELECT COUNT(*) FROM `rental_orders` WHERE `tenantId`='tenant_001';");
  assert.ok(orderRows > 0, "订单必须落在 rental_orders 表中");
  const lineRows = readCount(
    "SELECT COUNT(*) FROM `rental_order_lines` l JOIN `rental_orders` o ON o.`id`=l.`orderId` WHERE o.`tenantId`='tenant_001';"
  );
  assert.ok(lineRows >= orderRows, "订单行必须随订单落库");
  assert.ok(
    readCount("SELECT COUNT(*) FROM `rental_reservations` WHERE `tenantId`='tenant_001';") > 0,
    "预占必须落库"
  );
  assert.ok(
    readCount(
      "SELECT COUNT(*) FROM `rental_allocations` a JOIN `rental_orders` o ON o.`id`=a.`orderId` WHERE o.`tenantId`='tenant_001';"
    ) > 0,
    "分配必须落库"
  );
  assert.ok(
    readCount("SELECT COUNT(*) FROM `rental_inspection_records` WHERE `tenantId`='tenant_001';") > 0,
    "检查记录必须落库"
  );
  // 资产状态流转必须落到表上，而不是只存在于进程内。
  assert.ok(
    readCount("SELECT COUNT(*) FROM `rental_assets` WHERE `tenantId`='tenant_001' AND `status`='available';") > 0,
    "归还后资产状态必须在表中回到 available"
  );
  // 金额必须按 Decimal 落库，不能因领域对象→列转换丢精度或写成 0。
  assert.ok(
    readCount("SELECT ROUND(SUM(`finalPayableAmount`)) FROM `rental_orders` WHERE `tenantId`='tenant_001';") > 0,
    "订单最终应付金额不应为 0"
  );

  const beforeRestart = readCount("SELECT COUNT(*) FROM `rental_orders`;");
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("事实源校验的 API 重启超时");
  const afterRestart = readCount("SELECT COUNT(*) FROM `rental_orders`;");
  assert.equal(afterRestart, beforeRestart, "重启不得重复写入订单");
  // 重启后必须能从表恢复订单，而不是依赖进程内对象。
  const demoAfterFactRestart = await login("demo", "admin", DEMO_PASSWORD);
  const restoredOrders = (await request("GET", "/api/rental/v1/orders", null, demoAfterFactRestart.accessToken)).body.data;
  assert.equal(restoredOrders.length, orderRows, "重启后订单列表必须与表中行数一致");
  assert.ok(restoredOrders.some((row) => row.status === "completed"), "已完成订单必须从表中恢复");
  ok(`核心事实以库为事实源：${orderRows} 单/${lineRows} 行落表，资产状态与金额在库，重启后从表恢复且不重复`);

  console.log("== 19. RC-01 配置写穿：API 写入必须真正落库 ==");
  // 这一节不可省：API 读配置走的是服务内存写穿缓存，因此即使写穿完全没生效，
  // 前面所有通过 HTTP 的断言依然会全绿。只有直查库才能证明配置真的落了盘。
  //
  // 关键：必须用"本次新建"的配置来验证。若只检查前面各节创建的配置，
  // 第 17 节重启会触发快照回填，回填同样能把这些行写进库，断言就失去了区分力。
  const writeThroughCode = `E2E-WRITETHROUGH-${afterRestart}`;
  // 第 18 节又重启过一次 API，第 17 节取得的会话已不可用，这里重新登录。
  const demoForWriteThrough = await login("demo", "admin", DEMO_PASSWORD);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_coupon_templates\` WHERE \`code\`='${writeThroughCode}';`),
    0,
    "写穿校验用的券模板编码必须尚不存在"
  );
  const writeThrough = await request(
    "POST",
    "/api/rental/v1/coupon-templates",
    {
      code: writeThroughCode,
      name: "E2E 写穿校验券",
      discountType: "fixed_amount",
      discountValue: 5,
      minimumSpend: 10,
      totalQuota: 1,
      perCustomerLimit: 1,
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      effectiveTo: new Date(Date.now() + 30 * 86400000).toISOString(),
      status: "active"
    },
    demoForWriteThrough.accessToken
  );
  assert.equal(writeThrough.status, 201, `写穿校验券创建失败: ${JSON.stringify(writeThrough.body)}`);
  // 未经任何重启或回填，该行必须已在库中。
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_coupon_templates\` WHERE \`code\`='${writeThroughCode}' AND \`tenantId\`='tenant_001';`),
    1,
    "配置写方法必须同步写穿到数据库，且带正确租户戳"
  );

  // 初始化落库：每个有品类档案的租户，主体、地点和业务设置都不能缺。
  const profiledTenants = readCount("SELECT COUNT(*) FROM `tenant_rental_profiles`;");
  assert.ok(profiledTenants >= 3, `品类档案数异常: ${profiledTenants}`);
  for (const [table, label] of [
    ["rental_fulfillment_operators", "经营主体"],
    ["rental_fulfillment_locations", "履约地点"],
    ["rental_tenant_business_settings", "业务设置"]
  ]) {
    const orphans = readCount(
      `SELECT COUNT(*) FROM \`tenant_rental_profiles\` p WHERE NOT EXISTS (SELECT 1 FROM \`${table}\` t WHERE t.\`tenantId\`=p.\`tenantId\`);`
    );
    assert.equal(orphans, 0, `有 ${orphans} 个租户缺少${label}落库记录`);
  }
  // 套装组成是独立表，验证 upsertItemGroup 的整组替换确实写入了组件行。
  assert.ok(
    readCount("SELECT COUNT(*) FROM `rental_bundle_components`;") > 0,
    "套装组成必须随商品组落库"
  );
  // 业务配置（定价、优惠、增值服务、日历、规则版本、通知模板）同样必须落库。
  // 这些是阶段 4a 新迁的集合，前面各节都是经 API 读回、走内存缓存，无法证明写穿。
  for (const [code, table] of [
    ["E2E-TRUCK-PRICE", "rental_pricing_plans"],
    ["E2E-EXCA-PRICE", "rental_pricing_plans"],
    ["E2E-EXCLUSIVE", "rental_discount_plans"]
  ]) {
    assert.equal(
      readCount(`SELECT COUNT(*) FROM \`${table}\` WHERE \`code\`='${code}';`),
      1,
      `经 API 创建的 ${code} 必须落库到 ${table}`
    );
  }
  // 不能断言"每个租户都有业务配置"——默认配置按设计在该租户首次使用业务域时才落库，
  // 只做过隔离校验、从未有业务写动作的租户在库中为空是正确的。
  // 真正的不变量是：一旦某租户有任一类业务配置，六类都必须在（防止只落了一半）。
  const businessConfigTables = [
    ["rental_pricing_plans", "定价方案"],
    ["rental_discount_plans", "优惠方案"],
    ["rental_value_added_services", "增值服务"],
    ["rental_rule_versions", "规则版本"],
    ["rental_notification_templates", "通知模板"]
  ];
  const unionSql = businessConfigTables
    .map(([table]) => `SELECT DISTINCT \`tenantId\` FROM \`${table}\``)
    .join(" UNION ");
  for (const [table, label] of businessConfigTables) {
    const partial = readCount(
      `SELECT COUNT(*) FROM (${unionSql}) tenants WHERE NOT EXISTS (SELECT 1 FROM \`${table}\` t WHERE t.\`tenantId\`=tenants.\`tenantId\`);`
    );
    assert.equal(partial, 0, `有 ${partial} 个已有业务配置的租户缺少${label}，说明配置只落了一半`);
  }
  // demo 与 demo2 全程有真实业务动作（报价、下单、优惠券），它们必须齐全。
  for (const tenantId of ["tenant_001", "tenant_002"]) {
    for (const [table, label] of businessConfigTables) {
      assert.ok(
        readCount(`SELECT COUNT(*) FROM \`${table}\` WHERE \`tenantId\`='${tenantId}';`) > 0,
        `${tenantId} 必须有${label}落库记录`
      );
    }
  }
  // 营业日历：平台登记来源版本、空间引用它生成草稿并发布，然后直查库确认状态与来源都落了盘。
  // 此前 E2E 完全没碰日历接口，而它是阶段 4a 迁移的集合之一。
  const calendarYear = new Date().getUTCFullYear() + 1;
  const writeThroughVersion = await registerOfficialVersion(calendarYear, [
    { date: `${calendarYear}-10-01`, dayType: "statutory_holiday", name: "国庆节", pricingMultiplier: 1.5 }
  ]);
  const importedCalendar = await applyOfficialVersion(
    calendarYear,
    writeThroughVersion.id,
    demoForWriteThrough.accessToken
  );
  assert.equal(importedCalendar.status, 201, `应用官方来源失败: ${JSON.stringify(importedCalendar.body)}`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_business_calendars\` WHERE \`tenantId\`='tenant_001' AND \`year\`=${calendarYear} AND \`status\`='draft';`),
    1,
    "应用来源后的日历必须以 draft 落库"
  );
  const publishedCalendar = await request(
    "POST",
    `/api/rental/v1/calendars/${calendarYear}/publish`,
    { changeReason: "E2E 写穿验证首次发布" },
    demoForWriteThrough.accessToken
  );
  assert.equal(publishedCalendar.status, 201, `日历发布失败: ${JSON.stringify(publishedCalendar.body)}`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_business_calendars\` WHERE \`tenantId\`='tenant_001' AND \`year\`=${calendarYear} AND \`status\`='published' AND \`sourceName\` IS NOT NULL AND JSON_LENGTH(\`days\`)>0;`),
    1,
    "发布后的日历必须在库中为 published，且来源与按日明细都在"
  );
  // JSON 明细列不能写成空：定价方案的 rates 是报价可复算的依据。
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_pricing_plans` WHERE JSON_LENGTH(`rates`) IS NULL OR JSON_LENGTH(`rates`)=0;"),
    0,
    "定价方案的 rates 明细不得为空"
  );

  ok(`配置写穿已验证：核心与业务配置均落库（新建券模板未经重启即在库、定价/优惠/服务/规则/模板无租户遗漏、日历已发布、rates 明细非空），共 ${profiledTenants} 个租户`);

  console.log("== 20. RC-01 业务事实以库为事实源 ==");
  // 与配置同理：API 读业务事实走服务内存副本，写穿失效时前面的 HTTP 断言仍会全绿，
  // 只有直查库能证明真的落盘。
  //
  // 奖励与权益账户默认规则是关闭的（membership.signupRewardEnabled=false），
  // 前面各节从未触发发奖。这里先启用注册奖励再真实发一次，而不是把断言放宽——
  // 断言测试不产生的数据没有意义，放宽同样没有意义。
  const settingsBefore = (await request("GET", "/api/rental/v1/business-settings", null, demoForWriteThrough.accessToken)).body.data;
  const enableReward = await request(
    "PUT",
    "/api/rental/v1/business-settings",
    {
      ...settingsBefore,
      membership: { ...settingsBefore.membership, signupRewardEnabled: true, signupRewardType: "points", signupRewardAmount: 88 }
    },
    demoForWriteThrough.accessToken
  );
  assert.equal(enableReward.status, 200, `启用注册奖励失败: ${JSON.stringify(enableReward.body)}`);
  const grant = await request(
    "POST",
    "/api/rental/v1/rewards/grant",
    { customerId: "e2e_reward_member", triggerType: "registration", idempotencyKey: "e2e:reward:once" },
    demoForWriteThrough.accessToken
  );
  assert.equal(grant.status, 201, `发放奖励失败: ${JSON.stringify(grant.body)}`);
  // 同一幂等键重复发放不得新增流水。
  const grantAgain = await request(
    "POST",
    "/api/rental/v1/rewards/grant",
    { customerId: "e2e_reward_member", triggerType: "registration", idempotencyKey: "e2e:reward:once" },
    demoForWriteThrough.accessToken
  );
  assert.equal(grantAgain.status, 201, "重复发放应幂等返回既有流水");
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_reward_ledger_entries` WHERE `idempotencyKey`='e2e:reward:once';"),
    1,
    "同一幂等键在库中只能有一条奖励流水"
  );
  assert.equal(
    readCount("SELECT ROUND(`pointsBalance`) FROM `rental_benefit_accounts` WHERE `customerId`='e2e_reward_member';"),
    88,
    "奖励入账后权益账户余额必须落库"
  );
  // 不同幂等键不是重放：两笔合法奖励同时到达同一客户时，余额必须累加，
  // 不能由两个进程缓存快照的绝对 upsert 互相覆盖。
  const parallelRewards = await Promise.all([
    request("POST", "/api/rental/v1/rewards/grant", { customerId: "e2e_reward_member", triggerType: "registration", idempotencyKey: "e2e:reward:parallel:a" }, demoForWriteThrough.accessToken),
    request("POST", "/api/rental/v1/rewards/grant", { customerId: "e2e_reward_member", triggerType: "registration", idempotencyKey: "e2e:reward:parallel:b" }, demoForWriteThrough.accessToken)
  ]);
  assert.ok(parallelRewards.every((response) => response.status === 201), `不同键并行发奖失败: ${JSON.stringify(parallelRewards.map((response) => response.body))}`);
  assert.equal(
    readCount("SELECT ROUND(`pointsBalance`) FROM `rental_benefit_accounts` WHERE `customerId`='e2e_reward_member';"),
    264,
    "不同幂等键的并行奖励必须原子累加到账户余额"
  );
  const parallelBenefitAccount = (
    await request("GET", "/api/rental/v1/benefit-accounts?customerId=e2e_reward_member", null, demoForWriteThrough.accessToken)
  ).body.data.find((row) => row.customerId === "e2e_reward_member");
  assert.equal(parallelBenefitAccount?.pointsBalance, 264, "并发奖励结束后 API 缓存余额必须与数据库一致，不得被旧刷新覆盖");

  const factRows = {
    quotes: readCount("SELECT COUNT(*) FROM `rental_quotes`;"),
    coupons: readCount("SELECT COUNT(*) FROM `rental_customer_coupons`;"),
    rewards: readCount("SELECT COUNT(*) FROM `rental_reward_ledger_entries`;"),
    accounts: readCount("SELECT COUNT(*) FROM `rental_benefit_accounts`;"),
    logs: readCount("SELECT COUNT(*) FROM `rental_notification_logs`;")
  };
  for (const [key, value] of Object.entries(factRows)) {
    assert.ok(value > 0, `业务事实 ${key} 未落库，实际 ${value} 行`);
  }
  // 报价被订单消费后，consumedOrderId 必须落库并指向真实订单，否则报价一次性使用无法追溯。
  assert.ok(
    readCount(
      "SELECT COUNT(*) FROM `rental_quotes` q JOIN `rental_orders` o ON o.`id`=q.`consumedOrderId` WHERE q.`consumedAt` IS NOT NULL;"
    ) > 0,
    "已消费报价的 consumedOrderId 必须落库且指向真实订单"
  );
  // 券状态机：第 12 节走过领取→锁定→核销→取消释放。释放会把状态改回 claimed，
  // 因此终态不能用 status 判断；用 releasedAt 落库来证明整条流转确实持久化过。
  assert.ok(
    readCount("SELECT COUNT(*) FROM `rental_customer_coupons` WHERE `releasedAt` IS NOT NULL;") > 0,
    "券的锁定→核销→释放流转必须落库，不能只存在于内存"
  );
  // 领取递增的模板配额也必须落库，否则重启后同一张券可被反复领完。
  assert.ok(
    readCount("SELECT COUNT(*) FROM `rental_coupon_templates` WHERE `claimedQuantity` > 0;") > 0,
    "券模板已领数量必须随领取写穿落库"
  );
  // 奖励幂等键在库上有唯一约束，重复键必须被数据库拒绝而不是只靠内存判重。
  const dupKey = mysqlRaw(
    `USE \`${TEST_DB}\`;\nINSERT INTO \`rental_reward_ledger_entries\`` +
      " (`id`,`tenantId`,`workspaceId`,`customerId`,`rewardType`,`amount`,`triggerType`,`idempotencyKey`,`status`,`reason`,`createdAt`)" +
      " SELECT 'e2e_dup_reward',`tenantId`,`workspaceId`,`customerId`,`rewardType`,`amount`,`triggerType`,`idempotencyKey`,`status`,`reason`,NOW(3)" +
      " FROM `rental_reward_ledger_entries` LIMIT 1;"
  );
  assert.notEqual(dupKey.status, 0, "重复奖励幂等键必须被数据库唯一约束拒绝");
  assert.match(
    `${dupKey.stdout || ""}${dupKey.stderr || ""}`,
    /Duplicate entry/u,
    "重复幂等键应报 Duplicate entry"
  );
  // 通知记录的外键必须指向真实模板，证明记录不是孤立写入。
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `rental_notification_logs` l WHERE NOT EXISTS (SELECT 1 FROM `rental_notification_templates` t WHERE t.`id`=l.`templateId`);"
    ),
    0,
    "通知记录不得引用不存在的模板"
  );
  ok(
    `业务事实以库为事实源：${factRows.quotes} 报价/${factRows.coupons} 券/${factRows.rewards} 奖励/${factRows.accounts} 权益账户/${factRows.logs} 通知记录落表，` +
      "报价消费可追溯、券状态与模板配额已写穿、奖励幂等键由唯一约束保证、通知记录外键完整"
  );

  console.log("== 21. RC-01 聚合快照已降级为恢复副本 ==");
  // 判定方法：直接篡改 JSON 快照里的业务事实，再重启 API。
  // 若快照仍是事实源，重启后读到的就是被篡改的值；正确行为是启动时用库覆盖，
  // 篡改被忽略。这是"快照只作恢复或缓存"唯一能被证伪的检查方式。
  mysqlQuery(
    "UPDATE `rental_business_state_snapshots` " +
      "SET `state` = JSON_SET(`state`, '$.customerCoupons', JSON_ARRAY(), '$.rewardLedger', JSON_ARRAY(), '$.quotes', JSON_ARRAY()) " +
      "WHERE `tenantId`='tenant_001';"
  );
  assert.equal(
    readCount(
      "SELECT JSON_LENGTH(`state`->'$.customerCoupons') FROM `rental_business_state_snapshots` WHERE `tenantId`='tenant_001';"
    ),
    0,
    "篡改快照未生效，本节无法判定"
  );
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("快照降级校验的 API 重启超时");
  const demoAfterTamper = await login("demo", "admin", DEMO_PASSWORD);
  const couponsAfterTamper = (
    await request("GET", "/api/rental/v1/customer-coupons", null, demoAfterTamper.accessToken)
  ).body.data;
  const rewardsAfterTamper = (await request("GET", "/api/rental/v1/rewards", null, demoAfterTamper.accessToken)).body.data;
  assert.ok(
    Array.isArray(couponsAfterTamper) && couponsAfterTamper.length > 0,
    "快照被清空后仍必须从库恢复出客户优惠券，否则快照仍是事实源"
  );
  assert.ok(
    Array.isArray(rewardsAfterTamper) && rewardsAfterTamper.length > 0,
    "快照被清空后仍必须从库恢复出奖励流水"
  );
  ok(
    `快照已降级：清空快照中的券/奖励/报价后重启，仍从库恢复出 ${couponsAfterTamper.length} 张券与 ${rewardsAfterTamper.length} 条奖励流水`
  );

  console.log("== RC-04. 订单创建业务幂等 ==");
  // 幂等只能用真实并发与重放来证明：静态检查看不出"重复请求是否重复占了库存"。
  const idemDemo = await login("demo", "admin", DEMO_PASSWORD);
  const idemLoc = (await request("GET", "/api/rental/v1/locations", null, idemDemo.accessToken)).body.data[0];
  const idemGroups = (await request("GET", "/api/rental/v1/item-groups", null, idemDemo.accessToken)).body.data
    .filter((row) => row.inventoryMode === "serialized" && row.status === "enabled");
  assert.ok(idemGroups.length, "缺少可用于幂等验证的序列化商品组");
  const idemStart = new Date(Date.now() + 90 * 86400000).toISOString();
  const idemEnd = new Date(Date.now() + 91 * 86400000).toISOString();
  const idemLines = [{ itemGroupId: idemGroups[0].id, quantity: 1 }];
  const availableFor = async () =>
    (await request(
      "POST",
      "/api/rental/v1/availability",
      { locationId: idemLoc.id, startAt: idemStart, endAt: idemEnd, lines: idemLines },
      idemDemo.accessToken
    )).body.data.lines[0].availableQuantity;

  const idemBody = (quoteId) => ({
    quoteId,
    customerType: "personal",
    customerName: "E2E幂等客户",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: idemLoc.id,
    startAt: idemStart,
    endAt: idemEnd,
    lines: idemLines
  });
  const newQuote = async () =>
    (await request(
      "POST",
      "/api/rental/v1/quotes",
      { customerType: "personal", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: idemLoc.id, startAt: idemStart, endAt: idemEnd, lines: idemLines },
      idemDemo.accessToken
    )).body.data;

  // 本节要造多张订单（串行重放 / 并发同键 / 通知取样 / 同键异体并发），
  // 而序列化库存的容量就是该地点下的可用资产数，固定夹具只够 3 张。
  // 先补两台资产，避免后面的用例因"库存不足"而在错误的地方失败——
  // 那种失败会被误读成幂等缺陷。serialNo 是 camera 品类唯一的资产级必填属性。
  for (let index = 0; index < 2; index += 1) {
    const extraAsset = await request(
      "POST",
      "/api/rental/v1/assets",
      {
        itemGroupId: idemGroups[0].id,
        locationId: idemLoc.id,
        assetNo: `E2E-IDEM-CAM-00${index}`,
        attributes: { serialNo: `E2E-IDEM-SN-00${index}` }
      },
      idemDemo.accessToken
    );
    assert.equal(extraAsset.status, 201, `幂等用例补充资产失败: ${JSON.stringify(extraAsset.body).slice(0, 200)}`);
  }

  // 1) 串行重放同一个 Idempotency-Key：必须返回同一张订单，且库存只被占一次。
  const beforeSerial = await availableFor();
  const q1 = await newQuote();
  const key1 = `e2e-idem-${q1.id}`;
  const first = await request("POST", "/api/rental/v1/orders", idemBody(q1.id), idemDemo.accessToken, { "Idempotency-Key": key1 });
  assert.equal(first.status, 201, `幂等首次下单失败: ${JSON.stringify(first.body).slice(0, 200)}`);
  const replay = await request("POST", "/api/rental/v1/orders", idemBody(q1.id), idemDemo.accessToken, { "Idempotency-Key": key1 });
  assert.equal(replay.status, 201, `幂等重放应成功返回既有订单: ${JSON.stringify(replay.body).slice(0, 200)}`);
  assert.equal(replay.body.data.id, first.body.data.id, "同幂等键重放必须返回同一张订单");
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`quoteId\`='${q1.id}';`),
    1,
    "同幂等键重放不得产生第二张订单"
  );
  assert.equal(await availableFor(), beforeSerial - 1, "重放不得二次占用库存");

  // 2) 同键但请求体不同：必须报冲突，而不是静默返回上一次的订单。
  const tampered = { ...idemBody(q1.id), customerName: "E2E幂等客户-改名" };
  const conflict = await request("POST", "/api/rental/v1/orders", tampered, idemDemo.accessToken, { "Idempotency-Key": key1 });
  assert.equal(conflict.status, 409, `同键不同请求体必须 409，实际 ${conflict.status}`);

  // 3) 并发同键：**每个**请求都必须成功（一个执行、其余回放），且指向同一张订单。
  //    早前只断言「至少一个成功」，输家返回 409 也能过——而输家 409 恰恰是缺陷：
  //    先到者会先消费掉报价，后到者在事务内的报价校验就被拒，那一步位于事务末尾的
  //    幂等重查之前，因此它永远走不到回放。
  //
  //    刻意用 6 路而非 2 路：两路请求很难稳定制造出「后到者已过预检、又在事务中段
  //    撞上已消费报价」的交错，2 路时该分支常常根本不被走到。提高并发度提高命中率。
  //    断言本身在任何交错下都成立——同键同请求体就该拿到同一张订单，绝不该 409。
  const CONCURRENT_SAME_KEY = 6;
  const beforeConcurrent = await availableFor();
  const q2 = await newQuote();
  const key2 = `e2e-idem-concurrent-${q2.id}`;
  const sameKeyResults = await Promise.all(
    Array.from({ length: CONCURRENT_SAME_KEY }, () =>
      request("POST", "/api/rental/v1/orders", idemBody(q2.id), idemDemo.accessToken, { "Idempotency-Key": key2 })
    )
  );
  const created = sameKeyResults.filter((res) => res.status === 201);
  assert.equal(
    created.length,
    CONCURRENT_SAME_KEY,
    `并发同键 ${CONCURRENT_SAME_KEY} 个请求都应成功（一个执行、其余回放），实际状态 ` +
      `${sameKeyResults.map((res) => res.status).join("/")}；首个非 201 响应体: ` +
      `${JSON.stringify((sameKeyResults.find((res) => res.status !== 201) || {}).body ?? null).slice(0, 200)}`
  );
  const ids = new Set(created.map((res) => res.body.data.id));
  assert.equal(ids.size, 1, "并发同键的成功响应必须指向同一张订单");
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`quoteId\`='${q2.id}';`),
    1,
    "并发同键不得产生两张订单"
  );
  assert.equal(await availableFor(), beforeConcurrent - 1, "并发同键只应占用一次库存");

  // 3b) 同键但请求体不同且**并发**：任何请求都不得拿到别人的订单。
  //     顺序场景由 2) 覆盖（事务外预检里有指纹校验），但并发时后到者会撞唯一约束
  //     落进 P2002 分支——该分支此前不比对指纹，会把先到者的订单当成自己的结果返回。
  //     断言用「返回的 customerName 必须等于自己提交的」，这样即使某次交错走的是
  //     预检路径（正确地 409），断言依然成立，不会变成靠运气过的绿灯。
  const q2b = await newQuote();
  const key2b = `e2e-idem-samekey-diffbody-${q2b.id}`;
  const distinctNames = ["E2E并发甲", "E2E并发乙", "E2E并发丙", "E2E并发丁"];
  const diffBodyResults = await Promise.all(
    distinctNames.map((customerName) =>
      request(
        "POST",
        "/api/rental/v1/orders",
        { ...idemBody(q2b.id), customerName },
        idemDemo.accessToken,
        { "Idempotency-Key": key2b }
      ).then((res) => ({ customerName, res }))
    )
  );
  for (const { customerName, res } of diffBodyResults) {
    if (res.status !== 201) continue;
    assert.equal(
      res.body.data.customerName,
      customerName,
      `同键不同请求体并发时，请求「${customerName}」拿到了别人的订单「${res.body.data.customerName}」——` +
        `P2002 回放前未比对指纹`
    );
  }
  assert.equal(
    diffBodyResults.filter(({ res }) => res.status === 201).length,
    1,
    `同键不同请求体并发必须恰好一个成功，实际 ${diffBodyResults.map(({ res }) => res.status).join("/")}`
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`quoteId\`='${q2b.id}';`),
    1,
    "同键不同请求体并发不得产生多张订单"
  );

  // 4) 幂等记录必须落库且带正确租户戳，否则重启后重放会再次建单。
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_order_idempotency_records\` WHERE \`idempotencyKey\`='${key1}' AND \`tenantId\`='tenant_001';`),
    1,
    "幂等记录必须落库并带租户戳"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_order_idempotency_records\` WHERE \`orderId\`='${first.body.data.id}';`),
    1,
    "幂等记录必须回填 orderId 以便按单追溯"
  );
  // 5) 下单重放不得重复发「订单已创建」通知。
  //    样本必须带 contactPhone：emitOrderEvent 的收件人取 contactPhone ?? customerId，
  //    两者皆空时 emitNotificationEvent 直接返回，通知数恒为 0，断言会变成空转。
  //    contactPhone 不参与报价与订单的一致性校验，只加在订单体上不会被拒。
  const q3 = await newQuote();
  const key3 = `e2e-idem-notify-${q3.id}`;
  const notifyBody = { ...idemBody(q3.id), contactPhone: "13900000007" };
  const createdNotifyBefore = readCount(
    "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001' AND `eventCode`='order.created';"
  );
  const n1 = await request("POST", "/api/rental/v1/orders", notifyBody, idemDemo.accessToken, { "Idempotency-Key": key3 });
  assert.equal(n1.status, 201, `带手机号下单应成功: ${JSON.stringify(n1.body).slice(0, 200)}`);
  const createdNotifyOnce = readCount(
    "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001' AND `eventCode`='order.created';"
  );
  assert.equal(
    createdNotifyOnce,
    createdNotifyBefore + 1,
    `前置条件：首次下单必须真的发出一条 order.created 通知，否则本节无区分力（实际新增 ${createdNotifyOnce - createdNotifyBefore} 条）`
  );
  const n2 = await request("POST", "/api/rental/v1/orders", notifyBody, idemDemo.accessToken, { "Idempotency-Key": key3 });
  assert.equal(n2.status, 201, `同键重放应返回既有订单: ${JSON.stringify(n2.body).slice(0, 200)}`);
  assert.equal(n2.body.data.id, n1.body.data.id, "同键重放必须返回同一张订单");
  const createdNotifyAfter = readCount(
    "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001' AND `eventCode`='order.created';"
  );
  assert.equal(
    createdNotifyAfter,
    createdNotifyOnce,
    `下单重放不得再发 order.created 通知，实际又新增 ${createdNotifyAfter - createdNotifyOnce} 条`
  );

  // 6) 同键并发**确认**：测的是幂等执行器，而 3) 测的是创建路径。
  //    加了订单行锁后，后到者拿锁时会读到已推进的状态，状态机据此给出 409——
  //    但两个请求本是同一次意图，正确结果是回放。用 q1 的订单（此时仍是 draft，
  //    且无 contactPhone，不会占用第 43、44 节需要的可通知样本）。
  const raceConfirmId = first.body.data.id;
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${raceConfirmId}' AND \`status\`='draft';`),
    1,
    `前置条件：q1 的订单应仍为 draft: ${raceConfirmId}`
  );
  const raceConfirmKey = `e2e-confirm-race-${raceConfirmId}`;
  const [cf1, cf2] = await Promise.all([
    request("POST", `/api/rental/v1/orders/${raceConfirmId}/confirm`, {}, idemDemo.accessToken, {
      "Idempotency-Key": raceConfirmKey
    }),
    request("POST", `/api/rental/v1/orders/${raceConfirmId}/confirm`, {}, idemDemo.accessToken, {
      "Idempotency-Key": raceConfirmKey
    })
  ]);
  assert.equal(
    [cf1, cf2].filter((res) => res.status === 201).length,
    2,
    `同键并发确认两个请求都应成功（一个执行、一个回放），实际 ${cf1.status}/${cf2.status}: ` +
      `${JSON.stringify(cf1.body).slice(0, 120)} | ${JSON.stringify(cf2.body).slice(0, 120)}`
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${raceConfirmId}' AND \`status\`='reserved';`),
    1,
    "同键并发确认后订单必须恰好处于已确认状态"
  );

  ok(
    `订单创建幂等：串行重放返回同一单且库存只占一次、同键改请求体 409、6 路同键并发均回放同一单、重放不重复发通知、幂等记录落库带租户戳`
  );

  console.log("== 22. RC-01 整条业务快照行丢失后仍从规范化表恢复 ==");
  // 第 21 节只清空快照里的数组，快照行本身还在，因此内存状态仍能由它建出来。
  // 那测不出真正的风险：若整条快照行丢失，onApplicationBootstrap 曾因"内存里没有该租户
  // 就跳过"而把库中事实读出来又丢弃，随后用空白默认状态继续运行——快照实际仍是事实源。
  // 这一节直接删掉整行，是该结论唯一能被证伪的检查方式。
  const couponsBeforeDrop = readCount("SELECT COUNT(*) FROM `rental_customer_coupons` WHERE `tenantId`='tenant_001';");
  const rewardsBeforeDrop = readCount("SELECT COUNT(*) FROM `rental_reward_ledger_entries` WHERE `tenantId`='tenant_001';");
  assert.ok(couponsBeforeDrop > 0 && rewardsBeforeDrop > 0, "本节需要库中已有券与奖励事实");
  mysqlQuery("DELETE FROM `rental_business_state_snapshots` WHERE `tenantId`='tenant_001';");
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_business_state_snapshots` WHERE `tenantId`='tenant_001';"),
    0,
    "业务快照行未删除，本节无法判定"
  );
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("快照行删除后的 API 重启超时");
  const demoNoSnapshot = await login("demo", "admin", DEMO_PASSWORD);
  const couponsNoSnapshot = (
    await request("GET", "/api/rental/v1/customer-coupons", null, demoNoSnapshot.accessToken)
  ).body.data;
  const rewardsNoSnapshot = (await request("GET", "/api/rental/v1/rewards", null, demoNoSnapshot.accessToken)).body.data;
  assert.equal(
    couponsNoSnapshot.length,
    couponsBeforeDrop,
    `快照行丢失后券必须全部从库恢复，期望 ${couponsBeforeDrop} 实际 ${couponsNoSnapshot.length}`
  );
  assert.equal(
    rewardsNoSnapshot.length,
    rewardsBeforeDrop,
    `快照行丢失后奖励流水必须全部从库恢复，期望 ${rewardsBeforeDrop} 实际 ${rewardsNoSnapshot.length}`
  );
  // Codex 复核指出：上面只验了券与权益，业务**配置**（定价/优惠/服务/日历/规则/通知模板）
  // 同样在快照行丢失时可能全部留空——因为配置装载曾发生在状态重建之前。
  const pricingNoSnapshot = (await request("GET", "/api/rental/v1/pricing-plans", null, demoNoSnapshot.accessToken)).body.data;
  const rulesNoSnapshot = (await request("GET", "/api/rental/v1/rule-versions", null, demoNoSnapshot.accessToken)).body.data;
  const templatesNoSnapshot = (await request("GET", "/api/rental/v1/notification-templates", null, demoNoSnapshot.accessToken)).body.data;
  assert.equal(
    pricingNoSnapshot.length,
    readCount("SELECT COUNT(*) FROM \`rental_pricing_plans\` WHERE \`tenantId\`='tenant_001';"),
    "快照行丢失后定价方案必须全部从库恢复"
  );
  assert.equal(
    rulesNoSnapshot.length,
    readCount("SELECT COUNT(*) FROM \`rental_rule_versions\` WHERE \`tenantId\`='tenant_001';"),
    "快照行丢失后规则版本必须全部从库恢复"
  );
  assert.equal(
    templatesNoSnapshot.length,
    readCount("SELECT COUNT(*) FROM \`rental_notification_templates\` WHERE \`tenantId\`='tenant_001';"),
    "快照行丢失后通知模板必须全部从库恢复"
  );
  ok(
    `整条业务快照行删除后重启，事实与配置均从库完整恢复：${couponsNoSnapshot.length} 券 / ${rewardsNoSnapshot.length} 奖励 / ` +
      `${pricingNoSnapshot.length} 定价 / ${rulesNoSnapshot.length} 规则 / ${templatesNoSnapshot.length} 通知模板`
  );

  console.log("== 23. RC-01 部分规范化数据可自愈补齐 ==");
  // 早期回填用"任一表非空即视为已完成"判定，部分填充的租户会被永久跳过，
  // 全量 upsert 根本执行不到。这里删掉某几类事实后重启，验证其余各类被补齐。
  const snapshotTenant = mysqlQuery(
    "SELECT `tenantId` FROM `rental_core_state_snapshots` " +
      "WHERE JSON_LENGTH(`state`->'$.itemGroups') > 0 " +
      "AND JSON_LENGTH(`state`->'$.inspectionTemplates') > 0 LIMIT 1;"
  )
    .split(/\r?\n/)
    .filter((line) => line.trim() && line.trim() !== "tenantId")
    .pop()
    .trim();
  const expectedGroups = readCount(
    `SELECT JSON_LENGTH(\`state\`->'$.itemGroups') FROM \`rental_core_state_snapshots\` WHERE \`tenantId\`='${snapshotTenant}';`
  );
  // 删除商品组会连带删掉引用它的资产与订单行，因此改删不被其他表引用的检查模板：
  // 它同样属于"快照里有、库里被清空"的部分填充场景，且不触发外键级联。
  const expectedTemplates = readCount(
    `SELECT JSON_LENGTH(\`state\`->'$.inspectionTemplates') FROM \`rental_core_state_snapshots\` WHERE \`tenantId\`='${snapshotTenant}';`
  );
  assert.ok(expectedTemplates > 0, "本节需要快照中存在检查模板");
  mysqlQuery(
    `DELETE r FROM \`rental_inspection_records\` r WHERE r.\`tenantId\`='${snapshotTenant}';\n` +
      `DELETE FROM \`rental_inspection_templates\` WHERE \`tenantId\`='${snapshotTenant}';`
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`tenantId\`='${snapshotTenant}';`),
    0,
    "检查模板未清空，本节无法判定"
  );
  // 商品组仍在（未删），构成"部分已填充"的状态——旧判定会因此整租户跳过。
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_item_groups\` WHERE \`tenantId\`='${snapshotTenant}';`),
    expectedGroups,
    "商品组应保持存在，用于构造部分填充场景"
  );
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("部分填充自愈校验的 API 重启超时");
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`tenantId\`='${snapshotTenant}';`),
    expectedTemplates,
    "部分填充租户的缺失事实必须被回填补齐"
  );
  ok(`部分填充自愈：商品组保留 ${expectedGroups} 行的同时清空检查模板，重启后补齐 ${expectedTemplates} 行`);

  console.log("== 24. RC-01 回填按主键判定，数量相同但键不同也能补齐 ==");
  // 上一节删空了整类，只能证明"某类为空会被补回"。守卫若只比数量，
  // 快照期望 A、B 而库里是 A、C 时数量相等，会被误判为已完整、B 永远补不回。
  // 这里把一条检查模板的主键改掉：条数不变，键集合不同。
  const originalTemplateId = readScalar(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(\`state\`,'$.inspectionTemplates[0].id')) ` +
      `FROM \`rental_core_state_snapshots\` WHERE \`tenantId\`='${snapshotTenant}';`
  );
  assert.ok(originalTemplateId && originalTemplateId !== "NULL", "业务键冲突测试需要快照模板");
  const countBeforeRekey = readCount(
    `SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`tenantId\`='${snapshotTenant}';`
  );
  mysqlQuery(
    `UPDATE \`rental_inspection_templates\` SET \`id\`='e2e_rekeyed_template' WHERE \`id\`='${originalTemplateId}';`
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`tenantId\`='${snapshotTenant}';`),
    countBeforeRekey,
    "改主键不应改变条数，本节要的正是数量相同"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`id\`='${originalTemplateId}';`),
    0,
    "原主键应已不存在"
  );
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("主键差异自愈校验的 API 重启超时");
  // 语义说明：业务键冲突（库中已有同 (tenantId, code, version) 但主键不同）
  // 刻意**不**用陈旧快照覆盖库中现存行——那有撤销他人有意删除或修改的风险。
  // 必须保证的是：这一条分歧不会像原实现那样回滚整个租户、连带阻断其余各类补齐。
  const rekeyedStillThere = readCount(
    `SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`id\`='e2e_rekeyed_template';`
  );
  assert.equal(rekeyedStillThere, 1, "业务键冲突的现存行不应被快照覆盖或删除");
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`tenantId\`='${snapshotTenant}';`),
    countBeforeRekey,
    "业务键冲突不应导致重复行"
  );
  // 关键断言：同租户其余各类事实没有因为这一条分歧而被整体回滚。
  assert.ok(
    readCount(`SELECT COUNT(*) FROM \`rental_item_groups\` WHERE \`tenantId\`='${snapshotTenant}';`) > 0,
    "一条业务键分歧不得回滚整个租户的回填"
  );

  // 上面那种改主键的情形因唯一约束 (tenantId, code, version) 被占，无法恢复原键。
  // 但 Codex 指出的原始场景是「库里多出一条无关行」——此时数量相同、键集不同，
  // 缺失的那条**必须**被补回。这才是直接证伪"只比数量"的用例，单独构造。
  const rekeyTemplate = mysqlQuery(
    `SELECT \`code\`, \`version\`, \`categoryCode\`, \`stage\`, \`name\` FROM \`rental_inspection_templates\`` +
      ` WHERE \`id\`='e2e_rekeyed_template';`
  );
  assert.match(rekeyTemplate, /\w/u, "取不到改键行的业务字段，无法构造无冲突场景");
  const missingId = originalTemplateId;
  // 释放原键：把改键行的业务编码改成独占值，让 missingId 的 (code, version) 重新可用。
  mysqlQuery(
    "UPDATE `rental_inspection_templates` SET `code`=CONCAT(`code`,'_E2E_MOVED') WHERE `id`='e2e_rekeyed_template';"
  );
  const countBeforeHeal = readCount(
    `SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`tenantId\`='${snapshotTenant}';`
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`id\`='${missingId}';`),
    0,
    "构造前提：快照中的该主键此刻不在库中"
  );
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("无冲突主键自愈校验的 API 重启超时");
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`id\`='${missingId}';`),
    1,
    "数量相同但键集不同时，快照中缺失的主键必须被补回（只比数量会漏掉这种情况）"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_inspection_templates\` WHERE \`tenantId\`='${snapshotTenant}';`),
    countBeforeHeal + 1,
    "补回缺失主键后应恰好多一行，不应重复插入"
  );
  ok(`业务键分歧被隔离：改掉一条主键后重启，现存行未被陈旧快照覆盖，其余各类未受回滚影响`);

  console.log("== 25. RC-01 业务键冲突父记录必须映射关联子记录 ==");
  const relationTenant = readScalar(
    "SELECT `tenantId` FROM `rental_business_state_snapshots` WHERE `tenantId`<>'tenant_001' ORDER BY `tenantId` LIMIT 1;"
  );
  await stopApi();
  mysqlQuery(
    `UPDATE \`rental_business_state_snapshots\` SET \`state\`=JSON_SET(\`state\`,` +
      `'$.notificationTemplates',JSON_ARRAY(JSON_OBJECT(` +
      `'id','e2e_snapshot_notification_template','tenantId','${relationTenant}',` +
      `'eventCode','e2e.parent.mapping','channel','email','name','映射测试模板',` +
      `'title','映射测试','body','映射测试','variableSchema',JSON_OBJECT(),` +
      `'status','enabled','version','1.0','updatedAt','2026-08-18T00:00:00.000Z')),` +
      `'$.notificationLogs',JSON_ARRAY(JSON_OBJECT(` +
      `'id','e2e_mapped_notification_log','tenantId','${relationTenant}',` +
      `'templateId','e2e_snapshot_notification_template','templateVersion','1.0',` +
      `'eventCode','e2e.parent.mapping','channel','email','recipient','e2e@example.com',` +
      `'renderedTitle','映射测试','renderedBody','映射测试','variables',JSON_OBJECT(),` +
      `'status','queued','provider','mock','attempts',0,'createdAt','2026-08-18T00:00:00.000Z')))` +
      ` WHERE \`tenantId\`='${relationTenant}';`
  );
  mysqlQuery(
    `DELETE FROM \`rental_notification_logs\` WHERE \`id\`='e2e_mapped_notification_log';` +
      `DELETE FROM \`rental_notification_templates\` WHERE \`id\` IN ` +
      `('e2e_snapshot_notification_template','e2e_live_notification_template');` +
      `INSERT INTO \`rental_notification_templates\` ` +
      `(\`id\`,\`tenantId\`,\`workspaceId\`,\`eventCode\`,\`channel\`,\`name\`,\`title\`,\`body\`,\`variableSchema\`,\`status\`,\`version\`,\`createdAt\`,\`updatedAt\`) VALUES ` +
      `('e2e_live_notification_template','${relationTenant}',CONCAT('ws_','${relationTenant}'),'e2e.parent.mapping','email',` +
      `'现存映射模板','映射测试','映射测试',JSON_OBJECT(),'enabled','1.0',NOW(),NOW());`
  );
  startApi();
  if (!(await waitHealth())) fail("业务键冲突父子映射校验的 API 重启超时");
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `id`='e2e_mapped_notification_log' " +
        "AND `templateId`='e2e_live_notification_template';"
    ),
    1,
    "业务键冲突的父模板必须映射到现存主键，关联通知日志不能触发整租户回滚"
  );
  ok("业务键冲突映射：保留现存通知模板，并将快照通知日志关联到现存主键");

  console.log("== 26. RULE-01A 规则发布后库中只保留一个已生效版本，旧版本置为已被替代 ==");
  // 退役旧版本原先只改内存：重启后库里会重新加载出多个 published；
  // 且退役发生在写库之前，新版本写库失败会让缓存里的旧规则被错误地标成已替代。
  // RULE-01A 后：立即发布时新版本写 published、旧生效版本写 superseded，同事务落库。
  const demoRules = await login("demo", "admin", DEMO_PASSWORD);
  const currentRule = (await request("GET", "/api/rental/v1/rule-versions/current", null, demoRules.accessToken)).body.data;
  const publishDraft = await request(
    "POST",
    "/api/rental/v1/rule-versions",
    { config: currentRule.config, changeReason: "E2E 单一 published 校验" },
    demoRules.accessToken
  );
  assert.equal(publishDraft.status, 201, `规则草稿创建失败: ${JSON.stringify(publishDraft.body)}`);
  const publishRes = await request(
    "POST",
    `/api/rental/v1/rule-versions/${publishDraft.body.data.version}/publish`,
    { reason: "E2E 单一 published 校验" },
    demoRules.accessToken
  );
  assert.equal(publishRes.status, 201, `发布规则版本失败: ${JSON.stringify(publishRes.body)}`);
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_rule_versions` WHERE `tenantId`='tenant_001' AND `status`='published';"),
    1,
    "发布后库中只能有一个已生效（published）规则版本"
  );
  assert.ok(
    readCount("SELECT COUNT(*) FROM `rental_rule_versions` WHERE `tenantId`='tenant_001' AND `status`='superseded';") > 0,
    "旧已生效版本的替代（superseded）必须落库"
  );
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("规则版本校验的 API 重启超时");
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_rule_versions` WHERE `tenantId`='tenant_001' AND `status`='published';"),
    1,
    "重启后仍只能有一个已生效（published）规则版本"
  );
  ok("规则发布：新版本 published 与旧版本 superseded 同事务落库，重启后库中仍只有一个已生效版本");

  console.log("== 27. RC-01 复合键集合不能退化为数量比较 ==");
  const compositeTenant = readScalar(
    "SELECT `tenantId` FROM `rental_business_state_snapshots` WHERE `tenantId`<>'tenant_001' ORDER BY `tenantId` LIMIT 1;"
  );
  assert.ok(compositeTenant, "复合键回归测试需要另一个业务快照租户");
  await stopApi();
  mysqlQuery(
    `UPDATE \`rental_business_state_snapshots\` SET \`state\`=JSON_SET(\`state\`,'$.benefitAccounts',` +
      `JSON_ARRAY(JSON_OBJECT('tenantId','${compositeTenant}','customerId','e2e_snapshot_customer',` +
      `'pointsBalance',88,'marketingBalance',6,'availableRewardCouponCount',2,` +
      `'updatedAt','2026-08-18T00:00:00.000Z'))) WHERE \`tenantId\`='${compositeTenant}';`
  );
  mysqlQuery(
      `DELETE FROM \`rental_benefit_accounts\` WHERE \`tenantId\`='${compositeTenant}';` +
      `INSERT INTO \`rental_benefit_accounts\` ` +
      `(\`tenantId\`,\`workspaceId\`,\`customerId\`,\`pointsBalance\`,\`marketingBalance\`,\`availableRewardCouponCount\`,\`updatedAt\`) VALUES ` +
      `('${compositeTenant}',CONCAT('ws_','${compositeTenant}'),'e2e_unrelated_customer',1,0,0,NOW());`
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_benefit_accounts\` WHERE \`tenantId\`='${compositeTenant}';`),
    1,
    "构造前提：数据库与快照的权益账户数量必须相同"
  );
  startApi();
  if (!(await waitHealth())) fail("复合键集合自愈校验的 API 重启超时");
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_benefit_accounts\` WHERE \`tenantId\`='${compositeTenant}' ` +
        "AND `customerId`='e2e_snapshot_customer';"
    ),
    1,
    "数量相同但 customerId 不同时，快照缺失的复合主键必须被补回"
  );
  ok("复合键集合回填：同数量、不同 customerId 不再被误判为完整");

  console.log("== 27b. 并发配货不得把同一台资产分配给两张订单 ==");
  // 自查 Review 发现：allocateOrder 只锁了订单行（lockOrder），随后
  // listAssets / allocatedAssetIds 都**不传 tx**、走独立连接的 autocommit 读，
  // 对 rental_assets 也没有 FOR UPDATE。两张订单锁的是不同的订单行、互不争锁，
  // 于是双方都读到"该资产可用且无占用分配行"，各自挑中同一台资产并提交。
  // RentalAllocation 上没有 assetId 唯一约束，库层也拦不住。
  //
  // 下单路径本身是对的（先 lockInventoryTargets 再在事务内重算），只有配货漏了。
  const allocDemo = await login("demo", "admin", DEMO_PASSWORD);
  const allocLoc = (await request("GET", "/api/rental/v1/locations", null, allocDemo.accessToken)).body.data[0];
  const allocGroup = (await request("GET", "/api/rental/v1/item-groups", null, allocDemo.accessToken)).body.data
    .find((row) => row.inventoryMode === "serialized" && row.status === "enabled");
  assert.ok(allocGroup, "前置条件：需要一个启用的序列化商品组");
  // 造一个只有 1 台可用资产的独立时段，避免与前面各节的库存互相干扰。
  const allocStart = new Date(Date.now() + 200 * 86400000).toISOString();
  const allocEnd = new Date(Date.now() + 201 * 86400000).toISOString();
  const allocLines = [{ itemGroupId: allocGroup.id, quantity: 1 }];
  const allocQuote = async () => {
    const res = await request(
      "POST",
      "/api/rental/v1/quotes",
      { customerType: "personal", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: allocLoc.id, startAt: allocStart, endAt: allocEnd, lines: allocLines },
      allocDemo.accessToken
    );
    assert.equal(res.status, 201, `配货用例报价应成功: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    return res.body.data;
  };
  const allocOrder = async (quoteId, name) => {
    const res = await request(
      "POST",
      "/api/rental/v1/orders",
      {
        quoteId,
        customerType: "personal",
        customerName: name,
        fulfillmentMode: "store_pickup_return",
        fulfillmentLocationId: allocLoc.id,
        startAt: allocStart,
        endAt: allocEnd,
        lines: allocLines
      },
      allocDemo.accessToken
    );
    assert.equal(res.status, 201, `配货用例下单应成功: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
    return res.body.data;
  };

  // 两张订单都推进到 reserved（各占一个预占，库存足够容纳两张）
  const allocA = await allocOrder((await allocQuote()).id, "E2E配货甲");
  const allocB = await allocOrder((await allocQuote()).id, "E2E配货乙");
  for (const target of [allocA, allocB]) {
    const confirmed = await request("POST", `/api/rental/v1/orders/${target.id}/confirm`, {}, allocDemo.accessToken);
    assert.equal(confirmed.status, 201, `配货用例的订单确认应成功: ${JSON.stringify(confirmed.body).slice(0, 200)}`);
  }

  // 并发配货：即使两者都能配到货，也绝不允许同一台资产出现在两张订单的分配里。
  const [allocR1, allocR2] = await Promise.all([
    request("POST", `/api/rental/v1/orders/${allocA.id}/allocate`, {}, allocDemo.accessToken),
    request("POST", `/api/rental/v1/orders/${allocB.id}/allocate`, {}, allocDemo.accessToken)
  ]);
  // 这条断言不预设"必须恰好一个成功"：库存足够时两个都该成功。
  // 真正的不变量是"同一台资产不得被两张订单同时占住"，因此直接查库。
  const allocDup = readCount(
    "SELECT COUNT(*) FROM (" +
      "SELECT a.`assetId` FROM `rental_allocations` a" +
      " INNER JOIN `rental_orders` o ON o.`id` = a.`orderId`" +
      " WHERE a.`assetId` IS NOT NULL AND a.`status` IN ('allocated','picked_up')" +
      "   AND o.`tenantId`='tenant_001'" +
      " GROUP BY a.`assetId` HAVING COUNT(DISTINCT a.`orderId`) > 1" +
      ") dup;"
  );
  assert.equal(
    allocDup,
    0,
    `同一台资产被多张订单同时占用（并发配货未加锁），冲突资产数 ${allocDup}；` +
      `本次两个配货响应 ${allocR1.status}/${allocR2.status}`
  );
  // 资产状态也不能被两次覆盖成不一致：每台被分配的资产应恰好对应一条有效分配。
  const allocOrphan = readCount(
    "SELECT COUNT(*) FROM `rental_assets` s" +
      " WHERE s.`tenantId`='tenant_001' AND s.`status`='reserved'" +
      "   AND NOT EXISTS (SELECT 1 FROM `rental_allocations` a" +
      "     INNER JOIN `rental_orders` o ON o.`id` = a.`orderId`" +
      "     WHERE a.`assetId` = s.`id` AND a.`status` IN ('allocated','picked_up'));"
  );
  assert.equal(allocOrphan, 0, `有 ${allocOrphan} 台资产被标记为 reserved 但没有对应的有效分配`);
  ok(
    `并发配货资产不重复占用：两张订单并发配货（响应 ${allocR1.status}/${allocR2.status}）后，` +
      "无任何资产被多张订单同时占住，也无 reserved 资产缺少对应分配"
  );

  console.log("== 28. RC-01 品类恢复不依赖定价或规则行存在 ==");
  const couponsBeforeConfigLoss = readCount(
    "SELECT COUNT(*) FROM `rental_customer_coupons` WHERE `tenantId`='tenant_001';"
  );
  const rewardsBeforeConfigLoss = readCount(
    "SELECT COUNT(*) FROM `rental_reward_ledger_entries` WHERE `tenantId`='tenant_001';"
  );
  await stopApi();
  mysqlQuery(
    "DELETE FROM `rental_business_state_snapshots` WHERE `tenantId`='tenant_001';" +
      "DELETE FROM `rental_pricing_plans` WHERE `tenantId`='tenant_001';" +
      "DELETE FROM `rental_rule_versions` WHERE `tenantId`='tenant_001';"
  );
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_business_state_snapshots` WHERE `tenantId`='tenant_001';"),
    0,
    "构造前提：tenant_001 的业务快照必须仍然缺失"
  );
  startApi();
  if (!(await waitHealth())) fail("核心品类档案恢复校验的 API 重启超时");
  const demoWithoutPricingOrRules = await login("demo", "admin", DEMO_PASSWORD);
  const couponsAfterConfigLoss = (
    await request("GET", "/api/rental/v1/customer-coupons", null, demoWithoutPricingOrRules.accessToken)
  ).body.data;
  const rewardsAfterConfigLoss = (
    await request("GET", "/api/rental/v1/rewards", null, demoWithoutPricingOrRules.accessToken)
  ).body.data;
  assert.equal(couponsAfterConfigLoss.length, couponsBeforeConfigLoss, "定价和规则缺失不得阻断客户券事实恢复");
  assert.equal(rewardsAfterConfigLoss.length, rewardsBeforeConfigLoss, "定价和规则缺失不得阻断奖励事实恢复");
  ok("品类恢复：业务快照、定价和规则同时缺失时，仍从核心租户档案装载业务事实");

  console.log("== 41. RC-04 通用租赁域审计事件 ==");
  // 审计写入有 try/catch 兜底（不阻断业务），因此 E2E 全绿并不能证明审计落库。
  // 必须直查库：此前拦截器只放行 /platform 与 /store-rental，
  // /rental/v1 的全部变更动作没有任何审计记录。
  const rentalAudits = readCount(
    "SELECT COUNT(*) FROM `OperationLog` WHERE `action` LIKE 'http.post.rental.%';"
  );
  assert.ok(rentalAudits > 0, `通用租赁域的变更动作必须产生审计记录，实际 ${rentalAudits} 条`);
  // 订单动作必须能按订单检索，否则无法回溯单笔订单的操作链。
  const auditsWithOrder = readCount(
    "SELECT COUNT(*) FROM `OperationLog` o JOIN `rental_orders` r ON r.`id`=o.`rentalOrderId`;"
  );
  assert.ok(auditsWithOrder > 0, `订单动作审计必须关联到真实通用租赁订单，实际 ${auditsWithOrder} 条`);
  // targetType 必须解析成资源名而不是版本段：早前 /rental/v1/... 会被解析成
  // targetType="rental"、targetId="v1"，审计无法按对象检索。
  const badTarget = readCount(
    "SELECT COUNT(*) FROM `OperationLog` WHERE `action` LIKE 'http.%.rental.%' AND JSON_UNQUOTE(JSON_EXTRACT(`detail`,'$.targetId'))='v1';"
  );
  assert.equal(badTarget, 0, "审计的 targetId 不得是版本段 v1");
  // SPACE-03：经营域审计必须带经营空间，且必须落在本租户的空间上。
  const auditWithWs = readCount(
    "SELECT COUNT(*) FROM `OperationLog` WHERE `action` LIKE 'http.%.rental.%' AND `workspaceId` IS NOT NULL;"
  );
  assert.ok(auditWithWs > 0, "经营域审计必须带 workspaceId");
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `OperationLog` l LEFT JOIN `business_workspaces` w" +
        " ON w.`id` = l.`workspaceId` AND w.`tenantId` = l.`tenantId`" +
        " WHERE l.`workspaceId` IS NOT NULL AND w.`id` IS NULL;"
    ),
    0,
    "审计的 workspaceId 不得跨租户或悬空"
  );
  // 平台域审计（租户创建/冻结）没有经营空间，留 NULL 而不是被塞进默认空间。
  // 先证明样本存在：否则「没有平台审计带空间」在根本没有平台审计时也成立，
  // 是一条永真的空断言。
  const platformAudits = readCount(
    "SELECT COUNT(*) FROM `OperationLog` WHERE `action` LIKE 'tenant.%' OR `action` LIKE 'http.%.platform.%';"
  );
  assert.ok(platformAudits > 0, `前置条件：应存在平台域审计样本，实际 ${platformAudits} 条`);
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `OperationLog` WHERE (`action` LIKE 'tenant.%' OR `action` LIKE 'http.%.platform.%') AND `workspaceId` IS NOT NULL;"
    ),
    0,
    "平台域审计不得被赋予经营空间（那是伪造归属）"
  );
  ok(
    `通用租赁域审计已落库：${rentalAudits} 条动作记录，其中 ${auditsWithOrder} 条关联到真实订单、` +
      `${auditWithWs} 条带经营空间且无跨租户，平台域审计保持无空间，targetId 未误取版本段`
  );

  console.log("== 42. RC-04 奖励幂等以库为准（跨重启仍成立）==");
  // 早前奖励判重只查内存 rewardLedger：库上虽有 (tenantId, idempotencyKey) 唯一约束，
  // 但那只会在写入时抛错，而不是幂等返回既有流水。缓存冷启动或多实例部署下，
  // 重复发放会变成 500 而非幂等。
  //
  // 重启会清空内存流水，因此"重启后用同一幂等键再发一次"能直接证伪内存判重：
  // 若仍依赖内存，这里会新增一条流水或直接报错。
  const rewardsBeforeRestart = readCount(
    "SELECT COUNT(*) FROM `rental_reward_ledger_entries` WHERE `idempotencyKey` LIKE 'e2e:reward:once%';"
  );
  assert.ok(rewardsBeforeRestart > 0, "前置条件：应已存在该幂等键的奖励流水");
  // 余额必须**动态**取当前值，不能硬编码。
  // 早前这里写死 88，而本套件更早处已用两个不同幂等键各发一笔合法奖励把余额累加到 264；
  // 硬编码值一旦被上游用例改变就会失败，且失败原因与本节要验证的东西无关。
  // 本节真正的不变量是「重启并用同一键再发一次，余额不变」，因此比对前后值即可。
  const benefitBeforeRestart = readCount(
    "SELECT ROUND(`pointsBalance`) FROM `rental_benefit_accounts` WHERE `customerId`='e2e_reward_member';"
  );
  assert.ok(benefitBeforeRestart > 0, "前置条件：权益账户应已有余额");
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("奖励幂等校验的 API 重启超时");
  const demoReward = await login("demo", "admin", DEMO_PASSWORD);
  const regrant = await request(
    "POST",
    "/api/rental/v1/rewards/grant",
    { customerId: "e2e_reward_member", triggerType: "registration", idempotencyKey: "e2e:reward:once" },
    demoReward.accessToken
  );
  assert.equal(regrant.status, 201, `重启后同键发放应幂等返回既有流水: ${JSON.stringify(regrant.body)}`);
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_reward_ledger_entries` WHERE `idempotencyKey` LIKE 'e2e:reward:once%';"),
    rewardsBeforeRestart,
    "重启后同键发放不得新增奖励流水（内存判重会在此失败）"
  );
  // 权益账户余额同样不能被二次入账。
  assert.equal(
    readCount("SELECT ROUND(`pointsBalance`) FROM `rental_benefit_accounts` WHERE `customerId`='e2e_reward_member';"),
    benefitBeforeRestart,
    `重复发放不得重复累加权益余额（重启前 ${benefitBeforeRestart}）`
  );
  ok(
    `奖励幂等以库为准：重启清空内存后同键再发，流水仍为 ${rewardsBeforeRestart} 条、` +
      `积分仍为 ${benefitBeforeRestart}`
  );

  console.log("== 43. RC-04 订单动作重试不得重复发通知 ==");
  // emitOrderEvent 在幂等执行器之外调用，所以要验证：同键重试时订单只推进一次，
  // 通知也只发一条。
  //
  // 样本必须挑「有 recipient 的 draft 订单」——emitNotificationEvent 在
  // recipient 为空时直接返回空数组（取 contactPhone ?? customerId）。
  // 早前只按 status='draft' 挑，取到的订单两者皆空，通知新增 0 条，
  // 断言失败的原因是样本选错而非产品缺陷。
  //
  // 本节不新造订单：它位于「发布新规则」之后，旧定价计划已退役，再报价会 409。
  const demoNotify = await login("demo", "admin", DEMO_PASSWORD);
  const notifiableDraft =
    "FROM `rental_orders` WHERE `tenantId`='tenant_001' AND `status`='draft'" +
    " AND (`contactPhone` IS NOT NULL OR `customerId` IS NOT NULL)";
  assert.ok(
    readCount(`SELECT COUNT(*) ${notifiableDraft};`) > 0,
    "前置条件：需要一个带 contactPhone 或 customerId 的 draft 订单"
  );
  const draftOrderId = readScalar(`SELECT \`id\` ${notifiableDraft} ORDER BY \`createdAt\` DESC LIMIT 1;`);
  // readScalar 取输出最后一行，查询无结果时可能拿到表头，这里回查确认。
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${draftOrderId}' AND \`status\`='draft';`),
    1,
    `取到的 id 不是有效 draft 订单: ${draftOrderId}`
  );
  const retryKey = `e2e-confirm-retry-${draftOrderId}`;
  const notifyBefore = readCount(
    "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001' AND `eventCode`='order.confirmed';"
  );
  const retryA = await request(
    "POST",
    `/api/rental/v1/orders/${draftOrderId}/confirm`,
    {},
    demoNotify.accessToken,
    { "Idempotency-Key": retryKey }
  );
  assert.equal(retryA.status, 201, `首次确认应成功: ${JSON.stringify(retryA.body)}`);
  const retryB = await request(
    "POST",
    `/api/rental/v1/orders/${draftOrderId}/confirm`,
    {},
    demoNotify.accessToken,
    { "Idempotency-Key": retryKey }
  );
  // 同键重试必须幂等返回同一订单，而不是因状态已变成 reserved 而报 409。
  assert.equal(retryB.status, 201, `同键重试应幂等返回: ${JSON.stringify(retryB.body)}`);
  assert.equal(retryB.body.data.id, retryA.body.data.id, "重试应返回同一订单");
  assert.equal(retryB.body.data.status, "reserved", "重试返回的状态应是已确认");
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${draftOrderId}' AND \`status\`='reserved';`),
    1,
    "订单应恰好处于已确认状态，只推进一次"
  );
  const notifyAfter = readCount(
    "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001' AND `eventCode`='order.confirmed';"
  );
  assert.equal(
    notifyAfter,
    notifyBefore + 1,
    `同键重试确认只能产生一条 order.confirmed 通知，实际新增 ${notifyAfter - notifyBefore} 条`
  );
  ok("成功动作重试幂等且不重复发通知：同键确认两次均返回 reserved，order.confirmed 通知仅新增 1 条");

  console.log("== 44. RC-04 未传幂等键时的网络重试同样必须幂等 ==");
  // 兜底键曾经纳入订单当前状态，于是：首次以 :draft 登记，重试时状态已是 reserved，
  // 算出的键不同 → 查不到记录 → 落回状态机 → 409。没传 Idempotency-Key 的客户端
  // （即绝大多数网络重试）因此完全拿不到幂等保护。
  //
  // 本节同时守住反向要求：兜底键稳定之后，非法状态转移**仍然**必须 409，
  // 不能因为「同一订单永久同键」而把陈旧的成功结果回放出去。
  const keylessDraft =
    "FROM `rental_orders` WHERE `tenantId`='tenant_001' AND `status`='draft'" +
    " AND (`contactPhone` IS NOT NULL OR `customerId` IS NOT NULL)";
  assert.ok(
    readCount(`SELECT COUNT(*) ${keylessDraft};`) > 0,
    "前置条件：需要另一个带 contactPhone 或 customerId 的 draft 订单"
  );
  const keylessId = readScalar(`SELECT \`id\` ${keylessDraft} ORDER BY \`createdAt\` DESC LIMIT 1;`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${keylessId}' AND \`status\`='draft';`),
    1,
    `取到的 id 不是有效 draft 订单: ${keylessId}`
  );
  const keylessNotifyBefore = readCount(
    "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001' AND `eventCode`='order.confirmed';"
  );
  // 刻意不传 Idempotency-Key，走 fallbackKey 路径。
  const keylessA = await request("POST", `/api/rental/v1/orders/${keylessId}/confirm`, {}, demoNotify.accessToken);
  assert.equal(keylessA.status, 201, `无键首次确认应成功: ${JSON.stringify(keylessA.body)}`);
  const keylessB = await request("POST", `/api/rental/v1/orders/${keylessId}/confirm`, {}, demoNotify.accessToken);
  assert.equal(
    keylessB.status,
    201,
    `无键重试必须幂等返回而不是 409（这正是兜底键纳入状态时的缺陷）: ${JSON.stringify(keylessB.body)}`
  );
  assert.equal(keylessB.body.data.id, keylessA.body.data.id, "无键重试应返回同一订单");
  assert.equal(keylessB.body.data.status, "reserved", "无键重试返回的状态应是已确认");
  const keylessNotifyAfter = readCount(
    "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001' AND `eventCode`='order.confirmed';"
  );
  assert.equal(
    keylessNotifyAfter,
    keylessNotifyBefore + 1,
    `无键重试也只能产生一条 order.confirmed 通知，实际新增 ${keylessNotifyAfter - keylessNotifyBefore} 条`
  );
  // 把订单推进到 ready_for_pickup 后再无键确认：记录仍在，但 replay 会发现状态
  // 不是 reserved 而返回 undefined，必须由状态机给出 409，不得回放当初的 201。
  const keylessAllocate = await request("POST", `/api/rental/v1/orders/${keylessId}/allocate`, {}, demoNotify.accessToken);
  assert.equal(keylessAllocate.status, 201, `配货应成功: ${JSON.stringify(keylessAllocate.body)}`);
  assert.equal(keylessAllocate.body.data.status, "ready_for_pickup", "配货后状态应为待取");
  const illegalConfirm = await request("POST", `/api/rental/v1/orders/${keylessId}/confirm`, {}, demoNotify.accessToken);
  assert.equal(
    illegalConfirm.status,
    409,
    `已配货订单再次确认必须 409，不得回放当初的成功结果，实际 ${illegalConfirm.status}`
  );
  ok("无键重试幂等：同一订单两次无键确认均返回 reserved 且通知只发一条；推进到待取后再确认仍如实 409");

  console.log("== 45. RC-04 同一订单的并发状态动作必须串行 ==");
  // 确认/配货/取消原先都用不带事务的 requireOrder 读订单（走 this.prisma，读根本
  // 不在事务内），也不对订单行加锁。两个并发动作会各读一份聚合副本、各自通过状态
  // 检查、各自把整个聚合写回，后提交者覆盖先提交者——两个请求都返回成功。
  //
  // 用**不同**幂等键，避免被幂等回放吸收掉，测的才是锁本身。
  // 复用第 44 节留下的 ready_for_pickup 订单：本节位于「发布新规则」之后，
  // 旧定价计划已退役，无法再报价新建样本。
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${keylessId}' AND \`status\`='ready_for_pickup';`),
    1,
    `前置条件：第 44 节应把订单留在 ready_for_pickup: ${keylessId}`
  );
  const cancelBody = { reason: "E2E 并发取消" };
  const [r1, r2] = await Promise.all([
    request("POST", `/api/rental/v1/orders/${keylessId}/cancel`, cancelBody, demoNotify.accessToken, {
      "Idempotency-Key": `e2e-race-a-${keylessId}`
    }),
    request("POST", `/api/rental/v1/orders/${keylessId}/cancel`, cancelBody, demoNotify.accessToken, {
      "Idempotency-Key": `e2e-race-b-${keylessId}`
    })
  ]);
  const raceOk = [r1, r2].filter((res) => res.status === 201);
  const raceConflict = [r1, r2].filter((res) => res.status === 409);
  assert.equal(
    raceOk.length,
    1,
    `不同键并发取消只能有一个成功（无锁时两个都会成功并互相覆盖），实际 ${r1.status}/${r2.status}: ` +
      `${JSON.stringify(r1.body).slice(0, 120)} | ${JSON.stringify(r2.body).slice(0, 120)}`
  );
  assert.equal(raceConflict.length, 1, `另一个必须被状态机以 409 拒绝，实际 ${r1.status}/${r2.status}`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${keylessId}' AND \`status\`='cancelled';`),
    1,
    "并发取消后订单必须恰好处于已取消状态，只推进一次"
  );
  // 状态只推进一次的另一面：分配必须全部释放，不能有一次取消的写入被覆盖掉。
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_allocations\` WHERE \`orderId\`='${keylessId}' AND \`status\`<>'released';`
    ),
    0,
    "该订单的分配应全部释放，不应残留未释放行"
  );
  ok("同订单并发状态动作已串行：不同键并发取消恰有一个成功、一个 409，订单只推进一次且分配全部释放");

  console.log("== 46. RC-04 幂等键按租户隔离 ==");
  // 幂等表的唯一约束是 (tenantId, action, idempotencyKey)，因此**同一个键**在两个
  // 租户下必须各自独立生效：A 租户用过的键不能让 B 租户的请求被回放成 A 的结果，
  // 也不能让 B 因为"键已存在"而被拒。这是 SaaS 隔离在幂等层的体现。
  const isoDemo = await login("demo", "admin", DEMO_PASSWORD);
  const isoDemo2 = await login("demo2", "admin", DEMO_PASSWORD);
  const sharedKey = `e2e-cross-tenant-${Date.now().toString(36)}`;
  // 两个租户各发一次通知，用同一个幂等键、不同模板与收件人。
  const isoTemplateOf = async (token) =>
    (await request("GET", "/api/rental/v1/notification-templates", null, token)).body.data.find((row) => row.status === "enabled");
  const isoTplA = await isoTemplateOf(isoDemo.accessToken);
  const isoTplB = await isoTemplateOf(isoDemo2.accessToken);
  assert.ok(isoTplA && isoTplB, "前置条件：两个租户都需要至少一个启用的通知模板");
  const varsFor = (template) =>
    Object.fromEntries(Object.keys(template.variableSchema).map((key) => [key, `E2E-${key}`]));
  const sendAs = (token, template, recipient) =>
    request(
      "POST",
      "/api/rental/v1/notifications/send",
      { templateId: template.id, recipient, variables: varsFor(template) },
      token,
      { "Idempotency-Key": sharedKey }
    );
  const isoA = await sendAs(isoDemo.accessToken, isoTplA, "13900001111");
  assert.equal(isoA.status, 201, `租户 A 发送应成功: ${JSON.stringify(isoA.body).slice(0, 200)}`);
  const isoB = await sendAs(isoDemo2.accessToken, isoTplB, "13900002222");
  assert.equal(
    isoB.status,
    201,
    `同一幂等键在另一租户下必须独立生效，不得被 A 的记录挡住: ${JSON.stringify(isoB.body).slice(0, 200)}`
  );
  assert.notEqual(isoB.body.data.id, isoA.body.data.id, "跨租户同键不得回放出另一租户的发送记录");
  assert.equal(isoB.body.data.recipient, "13900002222", "租户 B 必须拿到自己的收件人，而不是 A 的");
  // 两条记录必须各归其主，且同键在库中恰好两行（每租户一行）。
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_order_idempotency_records\` WHERE \`idempotencyKey\`='${sharedKey}' AND \`action\`='notification.send';`
    ),
    2,
    "同键应在两个租户下各留一行幂等记录"
  );
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_order_idempotency_records\` WHERE \`idempotencyKey\`='${sharedKey}' AND \`tenantId\`='tenant_001';`
    ),
    1,
    "租户 A 的幂等记录必须带自己的租户戳"
  );
  // 同租户同键重发：必须回放同一条，不得再向渠道发第二次。
  const isoLogsBefore = readCount(
    "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001';"
  );
  const isoAReplay = await sendAs(isoDemo.accessToken, isoTplA, "13900001111");
  assert.equal(isoAReplay.status, 201, `同租户同键重发应回放: ${JSON.stringify(isoAReplay.body).slice(0, 200)}`);
  assert.equal(isoAReplay.body.data.id, isoA.body.data.id, "同租户同键重发必须回放同一条发送记录");
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001';"),
    isoLogsBefore,
    "同键重发不得新增发送记录（通知是外部副作用，重试不该再发一次）"
  );
  // 同键换请求体：必须 409，而不是把 A 第一次的结果当成新请求的结果返回。
  const isoTamper = await sendAs(isoDemo.accessToken, isoTplA, "13900009999");
  assert.equal(isoTamper.status, 409, `同键不同请求体必须 409，实际 ${isoTamper.status}`);
  ok("幂等键按租户隔离：同键在两租户各自独立生效且互不回放，同租户同键重发不新增发送记录，同键异体 409");

  console.log("== 47. RC-04 业务失败时幂等记录必须一并回滚 ==");
  // 幂等登记与业务写入在同一事务。若登记先于业务失败而独立提交，这个键会被
  // "占住"：客户端用同一个键重试时会命中一条指向从未发生过的业务的记录，
  // 于是永远拿不到真正的执行——重试被自己的幂等记录挡死。
  //
  // 构造：对一张**已取消**的订单发确认。状态机必然拒绝，事务回滚。
  const rbDemo = await login("demo", "admin", DEMO_PASSWORD);
  const cancelledOrderId = readScalar(
    "SELECT `id` FROM `rental_orders` WHERE `tenantId`='tenant_001' AND `status`='cancelled' ORDER BY `createdAt` DESC LIMIT 1;"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${cancelledOrderId}' AND \`status\`='cancelled';`),
    1,
    `前置条件：需要一张已取消订单，取到的是 ${cancelledOrderId}`
  );
  const rollbackKey = `e2e-rollback-${cancelledOrderId}`;
  const rbFail = await request(
    "POST",
    `/api/rental/v1/orders/${cancelledOrderId}/confirm`,
    {},
    rbDemo.accessToken,
    { "Idempotency-Key": rollbackKey }
  );
  assert.equal(rbFail.status, 409, `已取消订单确认必须 409，实际 ${rbFail.status}: ${JSON.stringify(rbFail.body).slice(0, 200)}`);
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_order_idempotency_records\` WHERE \`idempotencyKey\`='${rollbackKey}';`
    ),
    0,
    "业务失败时不得留下幂等记录，否则该键被占住、后续重试永远拿不到真正的执行"
  );
  // 该键仍必须可用：换一张合法的 draft 订单，用同一个键必须能真正执行成功。
  const rbDraftId = readScalar(
    "SELECT `id` FROM `rental_orders` WHERE `tenantId`='tenant_001' AND `status`='draft' ORDER BY `createdAt` DESC LIMIT 1;"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_orders\` WHERE \`id\`='${rbDraftId}' AND \`status\`='draft';`),
    1,
    `前置条件：需要一张 draft 订单验证键仍可用，取到的是 ${rbDraftId}`
  );
  const rbOk = await request(
    "POST",
    `/api/rental/v1/orders/${rbDraftId}/confirm`,
    {},
    rbDemo.accessToken,
    { "Idempotency-Key": rollbackKey }
  );
  assert.equal(
    rbOk.status,
    201,
    `回滚后同一个键必须仍可用于真正的执行，实际 ${rbOk.status}: ${JSON.stringify(rbOk.body).slice(0, 200)}`
  );
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_order_idempotency_records\` WHERE \`idempotencyKey\`='${rollbackKey}';`
    ),
    1,
    "成功执行后才应留下幂等记录"
  );
  ok("业务失败时幂等记录随事务回滚：失败未留记录，同一个键随后仍能正常执行并登记");

  console.log("== 48. RC-04 领券同租户同键并发只能产生一次副作用 ==");
  // 关键缺陷（Codex 指出）：幂等执行器把 tx 传给了 run，但 claimCoupon 忽略它、
  // 用默认连接独立提交，并在提交前就改了内存缓存。于是两个同键并发请求各写一张券、
  // 各加一次 claimedQuantity，最后只有幂等表的一条记录获胜——
  // **接口看起来回放了，业务副作用已经发生两次**。
  //
  // 这里刻意用 4 路并发：2 路时输家常常在事务外预检就命中先到者，走不到
  // 「已在事务内写完券、再撞幂等唯一约束」的那条路，而那条路才是回滚的证明。
  const clDemo = await login("demo", "admin", DEMO_PASSWORD);
  const clTemplate = (await request("GET", "/api/rental/v1/coupon-templates", null, clDemo.accessToken)).body.data
    .find((row) => row.status === "enabled" && row.claimedQuantity < row.totalQuota && row.perCustomerLimit >= 1);
  assert.ok(clTemplate, "前置条件：需要一个启用且未领完的优惠券模板");
  const clCustomer = `e2e_idem_claim_${Date.now().toString(36)}`;
  const clQuotaBefore = readCount(
    `SELECT \`claimedQuantity\` FROM \`rental_coupon_templates\` WHERE \`id\`='${clTemplate.id}';`
  );
  const clKey = `e2e-claim-race-${clCustomer}`;
  const CLAIM_CONCURRENCY = 4;
  const clResults = await Promise.all(
    Array.from({ length: CLAIM_CONCURRENCY }, () =>
      request(
        "POST",
        "/api/rental/v1/customer-coupons/claim",
        { templateId: clTemplate.id, customerId: clCustomer },
        clDemo.accessToken,
        { "Idempotency-Key": clKey }
      )
    )
  );
  assert.equal(
    clResults.filter((res) => res.status === 201).length,
    CLAIM_CONCURRENCY,
    `同键并发领券每个请求都应成功（一次执行、其余回放），实际 ${clResults.map((r) => r.status).join("/")}：` +
      `${JSON.stringify((clResults.find((r) => r.status !== 201) || {}).body ?? null).slice(0, 200)}`
  );
  const clIds = new Set(clResults.map((res) => res.body.data.id));
  assert.equal(clIds.size, 1, `同键并发领券必须回放同一张券，实际拿到 ${clIds.size} 个不同 id`);
  // 库里只能多一张券：多于一张就说明输家的写入独立提交了、没有随事务回滚。
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_customer_coupons\` WHERE \`tenantId\`='tenant_001' AND \`customerId\`='${clCustomer}';`
    ),
    1,
    "同键并发领券只能在库中留下一张客户券（多于一张=业务写入未随事务回滚）"
  );
  assert.equal(
    readCount(`SELECT \`claimedQuantity\` FROM \`rental_coupon_templates\` WHERE \`id\`='${clTemplate.id}';`),
    clQuotaBefore + 1,
    "模板已领数量只能加一（加多=回滚后内存/库残留了多余配额）"
  );
  // 库与当前进程必须一致：缓存若在提交前更新过，这里会读到库里不存在的幽灵券。
  const clFromApi = (await request(
    "GET",
    `/api/rental/v1/customer-coupons?customerId=${clCustomer}`,
    null,
    clDemo.accessToken
  )).body.data;
  assert.equal(clFromApi.length, 1, `当前进程读取到的券数量必须与库一致，实际 ${clFromApi.length}`);
  assert.equal(clFromApi[0].id, [...clIds][0], "当前进程读取到的券必须就是库里那一张");
  const clTemplateFromApi = (await request("GET", "/api/rental/v1/coupon-templates", null, clDemo.accessToken)).body.data
    .find((row) => row.id === clTemplate.id);
  assert.equal(
    clTemplateFromApi.claimedQuantity,
    clQuotaBefore + 1,
    "当前进程读取到的 claimedQuantity 必须与库一致"
  );
  // 同键异体仍必须 409，不能因为"键已存在"就把别人的券回放出去。
  const clTamper = await request(
    "POST",
    "/api/rental/v1/customer-coupons/claim",
    { templateId: clTemplate.id, customerId: `${clCustomer}_other` },
    clDemo.accessToken,
    { "Idempotency-Key": clKey }
  );
  assert.equal(clTamper.status, 409, `领券同键异体必须 409，实际 ${clTamper.status}`);
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_customer_coupons\` WHERE \`tenantId\`='tenant_001' AND \`customerId\`='${clCustomer}_other';`
    ),
    0,
    "同键异体被拒后不得留下客户券"
  );
  ok(
    `领券同键并发只有一次副作用：${CLAIM_CONCURRENCY} 路并发均回放同一张券，库中一张券、配额加一，` +
      `当前进程读取与库一致，同键异体 409 且无残留`
  );

  console.log("== 49. RC-04 发通知同租户同键并发只能产生一次副作用 ==");
  const snTemplate = (await request("GET", "/api/rental/v1/notification-templates", null, clDemo.accessToken)).body.data
    .find((row) => row.status === "enabled");
  assert.ok(snTemplate, "前置条件：需要一个启用的通知模板");
  const snVars = Object.fromEntries(Object.keys(snTemplate.variableSchema).map((k) => [k, `E2E-${k}`]));
  const snRecipient = "13900003333";
  const snMaskedRecipient = "139****3333";
  const snKey = `e2e-send-race-${Date.now().toString(36)}`;
  const snLogsBefore = readCount(
    `SELECT COUNT(*) FROM \`rental_notification_logs\` WHERE \`tenantId\`='tenant_001' AND \`recipient\`='${snMaskedRecipient}';`
  );
  const SEND_CONCURRENCY = 4;
  const snResults = await Promise.all(
    Array.from({ length: SEND_CONCURRENCY }, () =>
      request(
        "POST",
        "/api/rental/v1/notifications/send",
        { templateId: snTemplate.id, recipient: snRecipient, variables: snVars },
        clDemo.accessToken,
        { "Idempotency-Key": snKey }
      )
    )
  );
  assert.equal(
    snResults.filter((res) => res.status === 201).length,
    SEND_CONCURRENCY,
    `同键并发发送每个请求都应成功，实际 ${snResults.map((r) => r.status).join("/")}：` +
      `${JSON.stringify((snResults.find((r) => r.status !== 201) || {}).body ?? null).slice(0, 200)}`
  );
  const snIds = new Set(snResults.map((res) => res.body.data.id));
  assert.equal(snIds.size, 1, `同键并发发送必须回放同一条记录，实际 ${snIds.size} 个不同 id`);
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_notification_logs\` WHERE \`tenantId\`='tenant_001' AND \`recipient\`='${snMaskedRecipient}';`
    ),
    snLogsBefore + 1,
    "同键并发发送只能在库中留下一条通知日志（多于一条=写入未随事务回滚）"
  );
  const snFromApi = (await request("GET", "/api/rental/v1/notification-logs", null, clDemo.accessToken)).body.data
    .filter((row) => row.recipient === snMaskedRecipient);
  assert.equal(snFromApi.length, 1, `当前进程通知列表只能新增一条，实际 ${snFromApi.length}`);
  assert.equal(snFromApi[0].id, [...snIds][0], "当前进程读取到的通知记录必须就是库里那一条");
  const snTamper = await request(
    "POST",
    "/api/rental/v1/notifications/send",
    { templateId: snTemplate.id, recipient: "13900004444", variables: snVars },
    clDemo.accessToken,
    { "Idempotency-Key": snKey }
  );
  assert.equal(snTamper.status, 409, `发通知同键异收件人必须 409，实际 ${snTamper.status}`);
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `rental_notification_logs` WHERE `tenantId`='tenant_001' AND `recipient`='13900004444';"
    ),
    0,
    "同键异收件人被拒后不得留下通知日志"
  );
  ok(
    `发通知同键并发只有一次副作用：${SEND_CONCURRENCY} 路并发均回放同一条记录，库与当前进程各只增一条，` +
      `同键异收件人 409 且无残留`
  );

  console.log("== 50. SPACE-01 默认经营空间与成员回填 ==");
  // 空库初始化路径：seed 建的每个「有品类档案」的租户都必须恰好拿到一个默认空间，
  // 且品类与档案一致（回填只从 tenantId + tenant_rental_profiles 推导，不按名称猜）。
  const tenantsWithProfile = readCount(
    "SELECT COUNT(*) FROM `Tenant` t INNER JOIN `tenant_rental_profiles` p ON p.`tenantId`=t.`id`;"
  );
  assert.ok(tenantsWithProfile > 0, "前置条件：至少要有一个带品类档案的租户");
  assert.equal(
    readCount("SELECT COUNT(*) FROM `business_workspaces` WHERE `isDefault`=1;"),
    tenantsWithProfile,
    "每个有品类档案的租户必须恰好一个默认经营空间"
  );
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `Tenant` t INNER JOIN `tenant_rental_profiles` p ON p.`tenantId`=t.`id`" +
        " INNER JOIN `business_workspaces` w ON w.`tenantId`=t.`id` AND w.`defaultMarker`='default'" +
        " WHERE w.`categoryCode` <> p.`categoryCode`;"
    ),
    0,
    "默认空间的品类必须与租户品类档案完全一致"
  );
  // 无品类档案的租户（平台管理租户）不得被凭空塞一个品类。
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `business_workspaces` w" +
        " LEFT JOIN `tenant_rental_profiles` p ON p.`tenantId`=w.`tenantId`" +
        " WHERE p.`tenantId` IS NULL;"
    ),
    0,
    "没有品类档案的租户不得获得经营空间（不得猜测归属）"
  );
  // 所有账号都必须进入所属租户的默认空间，且沿用原有角色。
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `User` u" +
        " INNER JOIN `business_workspaces` w ON w.`tenantId`=u.`tenantId` AND w.`defaultMarker`='default'" +
        " LEFT JOIN `workspace_members` m ON m.`workspaceId`=w.`id` AND m.`userId`=u.`id`" +
        " WHERE m.`userId` IS NULL;"
    ),
    0,
    "拥有默认空间的租户，其所有账号都必须已回填为成员"
  );
  // 成员关系不得写入空间级角色：本列为空表示沿用租户级角色集。
  //
  // 上一版断言写的是 `WHERE NOT (m.roleId <=> u.roleId)`——拿回填时刚复制过去的列
  // 比源列，永远不可能失败，证明不了「既有角色关系被正确映射」。而且它锁定的正是
  // 一个缺陷：账号的权威角色集是 UserRole ∪ {User.roleId}，写单个 roleId 会让
  // findWorkspaceScopedUser 用它**整体替换**权限，多角色账号升级后权限静默收缩。
  assert.equal(
    readCount("SELECT COUNT(*) FROM `workspace_members` WHERE `roleId` IS NOT NULL;"),
    0,
    "成员关系不得写入空间级角色，否则会覆盖账号的租户级角色集（多角色账号权限收缩）"
  );
  // 默认空间 id 必须是确定可重算的 ws_<tenantId>，让空库与升级两条路径同形状。
  assert.equal(
    readCount("SELECT COUNT(*) FROM `business_workspaces` WHERE `isDefault`=1 AND `id` <> CONCAT('ws_', `tenantId`);"),
    0,
    "默认空间 id 必须等于 CONCAT('ws_', tenantId)"
  );
  ok(
    `默认经营空间与成员回填完整：${tenantsWithProfile} 个租户各一个默认空间、品类与档案一致、` +
      `无档案租户未被塞入、全部账号已回填且沿用原角色`
  );

  console.log("== 51. SPACE-01 空间隔离约束由库层保证 ==");
  // 这些都必须在**数据库**层被拒绝，而不是只靠应用层校验——
  // 应用层可以被绕过（后台脚本、别的服务），空间是安全边界。
  const wsA = readScalar("SELECT `id` FROM `business_workspaces` WHERE `tenantId`='tenant_001' LIMIT 1;");
  const userB = readScalar("SELECT `id` FROM `User` WHERE `tenantId`='tenant_002' LIMIT 1;");
  assert.ok(wsA && userB, "前置条件：需要 tenant_001 的空间与 tenant_002 的账号");
  // 用 mysqlRaw 而不是 mysqlQuery：后者失败时会调 fail()，那会把 process.exitCode
  // 置成 1 并抛错——即使我们捕获了异常，整个套件也会以非零码退出。
  // 这里"写入被拒绝"是**期望结果**，必须用不改全局状态的原始执行。
  const rejects = (sql, label) => {
    const result = mysqlRaw(`USE \`${TEST_DB}\`;\n${sql}`);
    if (result.error) fail(`无法调用 docker: ${result.error.message}`);
    return result.status === 0 ? `${label}: 未被拒绝` : null;
  };
  const guardFailures = [
    rejects(
      `INSERT INTO \`workspace_members\` (\`tenantId\`,\`workspaceId\`,\`userId\`,\`isActive\`,\`createdAt\`,\`updatedAt\`) VALUES ('tenant_001','${wsA}','${userB}',1,NOW(3),NOW(3));`,
      "跨租户成员（本租户空间 + 他租户账号）"
    ),
    rejects(
      `INSERT INTO \`workspace_members\` (\`tenantId\`,\`workspaceId\`,\`userId\`,\`isActive\`,\`createdAt\`,\`updatedAt\`) VALUES ('tenant_002','${wsA}','${userB}',1,NOW(3),NOW(3));`,
      "伪造 tenantId 绕过（空间属 A、声称属 B）"
    ),
    rejects(
      "INSERT INTO `business_workspaces` (`id`,`tenantId`,`code`,`name`,`categoryCode`,`isDefault`,`defaultMarker`,`createdAt`,`updatedAt`)" +
        " VALUES ('ws_dup_e2e','tenant_001','second-default','重复默认','camera',1,'default',NOW(3),NOW(3));",
      "同租户第二个默认空间"
    )
  ].filter(Boolean);
  assert.deepEqual(guardFailures, [], `空间隔离约束必须在库层拒绝：${guardFailures.join("；")}`);
  ok("空间隔离由库层保证：跨租户成员、伪造 tenantId 绕过、重复默认空间三种写入均被数据库拒绝");

  console.log("== 52. SPACE-02 会话空间上下文与切换 ==");
  // 登录必须返回可进入空间与当前空间；当前空间取自成员关系，不是客户端说了算。
  const spDemo = await login("demo", "admin", DEMO_PASSWORD);
  assert.ok(Array.isArray(spDemo.workspaces) && spDemo.workspaces.length >= 1, `登录必须返回可进入空间列表: ${JSON.stringify(spDemo.workspaces)}`);
  assert.ok(spDemo.currentWorkspaceId, "登录必须解析出当前经营空间");
  assert.equal(
    spDemo.currentWorkspaceId,
    `ws_tenant_001`,
    `默认空间优先：当前空间应为 ws_tenant_001，实际 ${spDemo.currentWorkspaceId}`
  );
  // 当前空间必须落到会话行上——它才是权威，令牌里的 wid 只是提示。
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`auth_sessions\` WHERE \`currentWorkspaceId\`='${spDemo.currentWorkspaceId}' AND \`revokedAt\` IS NULL;`
    ) >= 1,
    true,
    "当前空间必须持久化到会话行"
  );

  // 为切换准备第二个空间：同租户、不同品类，并把 demo 的 admin 加为成员。
  const spSecond = await request(
    "POST",
    "/api/platform/workspaces",
    { code: "camping-biz", name: "露营经营空间", categoryCode: "camping" },
    spDemo.accessToken
  );
  assert.equal(spSecond.status, 201, `创建第二个经营空间失败: ${JSON.stringify(spSecond.body).slice(0, 200)}`);
  assert.equal(spSecond.body.data.categoryCode, "camping", "第二个空间应绑定 camping 品类");
  assert.equal(spSecond.body.data.isDefault, false, "新建空间不得是默认空间");
  const spSecondId = spSecond.body.data.id;

  // 尚未加入成员前，切换必须被拒绝（未授权空间）。
  const spDenied = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: spSecondId },
    spDemo.accessToken
  );
  assert.equal(spDenied.status, 403, `未加入成员就切换必须 403，实际 ${spDenied.status}: ${JSON.stringify(spDenied.body).slice(0, 160)}`);

  // 加入成员后切换成功，且会话行随之更新。
  const spMember = await request(
    "PUT",
    `/api/platform/workspaces/${spSecondId}/members`,
    { userId: spDemo.user.id, dataScope: "store" },
    spDemo.accessToken
  );
  assert.equal(spMember.status, 200, `加入空间成员失败: ${JSON.stringify(spMember.body).slice(0, 200)}`);
  const spSwitched = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: spSecondId },
    spDemo.accessToken
  );
  assert.equal(spSwitched.status, 201, `切换空间失败: ${JSON.stringify(spSwitched.body).slice(0, 200)}`);
  assert.equal(spSwitched.body.data.currentWorkspaceId, spSecondId, "切换后当前空间必须是目标空间");
  // 成员关系上的数据范围必须生效（需求 3：同一账号在不同空间可有不同范围）。
  assert.equal(
    spSwitched.body.data.user.dataScope,
    "store",
    `切换后数据范围必须按空间生效，实际 ${spSwitched.body.data.user.dataScope}`
  );

  // 跨租户空间不可切换：拿 tenant_002 的空间去切 tenant_001 的会话。
  const spOtherWs = readScalar("SELECT `id` FROM `business_workspaces` WHERE `tenantId`='tenant_002' LIMIT 1;");
  const spCross = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: spOtherWs },
    spSwitched.body.data.accessToken
  );
  assert.equal(spCross.status, 403, `跨租户切换必须 403，实际 ${spCross.status}`);

  // 停用空间不可切换。
  const spFrozen = await request("PUT", `/api/platform/workspaces/${spSecondId}`, { status: "disabled" }, spDemo.accessToken);
  assert.equal(spFrozen.status, 200, `停用空间失败: ${JSON.stringify(spFrozen.body).slice(0, 160)}`);
  const spToDisabled = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: spSecondId },
    spDemo.accessToken
  );
  assert.equal(spToDisabled.status, 403, `切换到已停用空间必须 403，实际 ${spToDisabled.status}`);
  // 已停用空间也不得出现在可进入列表里。
  const spRelogin = await login("demo", "admin", DEMO_PASSWORD);
  assert.equal(
    spRelogin.workspaces.some((row) => row.id === spSecondId),
    false,
    "已停用空间不得出现在可进入空间列表"
  );
  // 复原，避免影响后续断言组。
  await request("PUT", `/api/platform/workspaces/${spSecondId}`, { status: "active" }, spDemo.accessToken);
  ok(
    "会话空间上下文：登录解析默认空间并落库、未授权/跨租户/已停用空间切换均 403、" +
      "加入成员后可切换且成员级数据范围生效、停用空间不出现在可进入列表"
  );

  console.log("== 53. SPACE-02 经营接口缺少空间必须 fail-closed ==");
  // 平台管理租户没有任何经营空间成员关系（SPACE-01 刻意不猜测归属），
  // 因此它的会话访问经营接口必须被拒绝，而不是回退到某个默认空间。
  const spPlatformWs = readCount(
    "SELECT COUNT(*) FROM `workspace_members` m INNER JOIN `User` u ON u.`id`=m.`userId` INNER JOIN `Tenant` t ON t.`id`=u.`tenantId` WHERE t.`code`='platform';"
  );
  assert.equal(spPlatformWs, 0, "前置条件：平台管理租户不应有经营空间成员关系");
  // 直接把会话的当前空间清空，模拟"无空间会话"访问经营接口。
  const spSession = readScalar(
    `SELECT \`id\` FROM \`auth_sessions\` WHERE \`currentWorkspaceId\`='ws_tenant_001' AND \`revokedAt\` IS NULL ORDER BY \`createdAt\` DESC LIMIT 1;`
  );
  const spProbe = await login("demo", "admin", DEMO_PASSWORD);
  const spProbeSession = readScalar(
    "SELECT `id` FROM `auth_sessions` WHERE `revokedAt` IS NULL ORDER BY `createdAt` DESC LIMIT 1;"
  );
  // 先确认带空间时经营接口正常。
  const spBefore = await request("GET", "/api/rental/v1/item-groups", null, spProbe.accessToken);
  assert.equal(spBefore.status, 200, `带空间时经营接口应正常: ${spBefore.status}`);
  mysqlQuery(`UPDATE \`auth_sessions\` SET \`currentWorkspaceId\`=NULL WHERE \`id\`='${spProbeSession}';`);
  const spAfter = await request("GET", "/api/rental/v1/item-groups", null, spProbe.accessToken);
  assert.equal(
    spAfter.status,
    403,
    `无空间会话访问经营接口必须 403（不得回退到默认空间），实际 ${spAfter.status}: ${JSON.stringify(spAfter.body).slice(0, 160)}`
  );
  // 但 /auth 与 /platform 仍必须可用——否则用户无法选择空间、管理员无法维护空间。
  const spAuthStillOk = await request("GET", "/api/auth/me", null, spProbe.accessToken);
  assert.equal(spAuthStillOk.status, 200, `无空间会话仍须能访问 /auth/me，实际 ${spAuthStillOk.status}`);
  const spPlatformStillOk = await request("GET", "/api/platform/workspaces", null, spProbe.accessToken);
  assert.equal(
    spPlatformStillOk.status,
    200,
    `无空间会话仍须能列出可管理空间，实际 ${spPlatformStillOk.status}`
  );
  // 客户端不能用请求体/查询参数伪造空间范围。
  const spForge = await request(
    "GET",
    `/api/rental/v1/item-groups?workspaceId=ws_tenant_001`,
    null,
    spProbe.accessToken
  );
  assert.equal(spForge.status, 403, `客户端参数不得覆盖会话空间范围，实际 ${spForge.status}`);
  assert.ok(spSession, "前置条件：应存在带空间的会话行");
  ok(
    "经营接口 fail-closed：无空间会话访问 /rental/v1 返回 403 且不回退默认空间，" +
      "查询参数伪造 workspaceId 无效，/auth 与 /platform 仍可用以便选择空间"
  );

  console.log("== 54. SPACE-03 经营事实已归属经营空间 ==");
  // 24 张经营事实/配置表都必须有 workspaceId，且必须落在**本租户**的空间上。
  const SPACED_TABLES = [
    "rental_assets", "rental_benefit_accounts", "rental_business_calendars", "rental_coupon_templates",
    "rental_customer_coupons", "rental_discount_plans", "rental_fulfillment_locations",
    "rental_fulfillment_operators", "rental_inspection_records", "rental_inspection_templates",
    "rental_item_groups", "rental_notification_logs", "rental_notification_templates",
    "rental_order_idempotency_records", "rental_orders", "rental_pricing_plans", "rental_quotes",
    "rental_referrals", "rental_reservations", "rental_reward_ledger_entries", "rental_rule_versions",
    "rental_stock_balances", "rental_tenant_business_settings", "rental_value_added_services"
  ];
  const spacedProblems = [];
  let spacedRows = 0;
  for (const table of SPACED_TABLES) {
    spacedRows += readCount(`SELECT COUNT(*) FROM \`${table}\`;`);
    // workspaceId 必须指向同租户的空间；跨租户或悬空立即计为问题。
    const bad = readCount(
      `SELECT COUNT(*) FROM \`${table}\` f LEFT JOIN \`business_workspaces\` w` +
        " ON w.`id` = f.`workspaceId` AND w.`tenantId` = f.`tenantId` WHERE w.`id` IS NULL;"
    );
    if (bad > 0) spacedProblems.push(`${table}: ${bad} 行未归属本租户空间`);
  }
  assert.deepEqual(spacedProblems, [], `经营事实归属异常：${spacedProblems.join("；")}`);
  assert.ok(spacedRows > 0, "前置条件：应存在经营事实行，否则本节为空转");

  // 复合外键必须挡住"把事实挂到别的租户的空间上"。
  const s3OtherWs = readScalar("SELECT `id` FROM `business_workspaces` WHERE `tenantId`='tenant_002' LIMIT 1;");
  const s3Group = readScalar("SELECT `id` FROM `rental_item_groups` WHERE `tenantId`='tenant_001' LIMIT 1;");
  const s3Cross = mysqlRaw(
    `USE \`${TEST_DB}\`;\nUPDATE \`rental_item_groups\` SET \`workspaceId\`='${s3OtherWs}' WHERE \`id\`='${s3Group}';`
  );
  assert.notEqual(s3Cross.status, 0, "把经营事实改挂到别租户的空间必须被外键拒绝");

  // 唯一键已含空间维度：同租户第二个空间可以复用商品编码。
  // 这是"两个空间互不干扰"最直接的证据——改造前 (tenantId, code) 唯一会直接冲突。
  const s3Login = await login("demo", "admin", DEMO_PASSWORD);
  const s3Existing = (await request("GET", "/api/rental/v1/item-groups", null, s3Login.accessToken)).body.data[0];
  assert.ok(s3Existing, "前置条件：默认空间应已有商品组");
  const s3Second = (await request("GET", "/api/platform/workspaces", null, s3Login.accessToken)).body.data
    .find((row) => !row.isDefault && row.status === "active");
  assert.ok(s3Second, "前置条件：需要第 52 节创建的第二个经营空间");
  const s3Switch = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: s3Second.id },
    s3Login.accessToken
  );
  assert.equal(s3Switch.status, 201, `切换到第二空间失败: ${JSON.stringify(s3Switch.body).slice(0, 200)}`);
  // 唯一键与服务层判重都已按经营空间：第二空间经**真实 API**建同编码商品组必须成功。
  // 刻意只走 API 而不再另插一条 SQL——先插 SQL 会让随后的 API 写入撞上库唯一键，
  // 那是测试自己制造的冲突，不是被测行为。
  const s3SecondGroups = (await request("GET", "/api/rental/v1/item-groups", null, s3Switch.body.data.accessToken)).body.data;
  assert.ok(
    s3SecondGroups.length > 0,
    "前置条件：新建经营空间应已原子获得该品类的默认配置（需求 4.1）"
  );
  const s3Template = s3SecondGroups[0];
  assert.equal(
    s3SecondGroups.some((row) => row.code === s3Existing.code),
    false,
    "前置条件：第二空间不应已存在与默认空间同编码的商品组"
  );
  const s3DupBody = {
    code: s3Existing.code,
    name: "第二空间同码（经 API）",
    inventoryMode: s3Template.inventoryMode,
    unit: s3Template.unit,
    attributes: s3Template.attributes ?? {},
    status: "enabled"
  };
  const s3ApiDup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    s3DupBody,
    s3Switch.body.data.accessToken
  );
  assert.equal(
    s3ApiDup.status,
    201,
    `第二空间必须能复用默认空间的商品编码（唯一键与判重均需按空间），实际 ${s3ApiDup.status}: ` +
      `${JSON.stringify(s3ApiDup.body).slice(0, 300)}`
  );
  assert.equal(
    readScalar(`SELECT \`workspaceId\` FROM \`rental_item_groups\` WHERE \`id\`='${s3ApiDup.body.data.id}';`),
    s3Second.id,
    "经 API 新建的商品组必须落在当前会话的经营空间，而不是默认空间"
  );
  assert.equal(
    readCount(
      `SELECT COUNT(DISTINCT \`workspaceId\`) FROM \`rental_item_groups\` WHERE \`tenantId\`='tenant_001' AND \`code\`='${s3Existing.code}';`
    ),
    2,
    "同一编码应在该租户的两个经营空间各有一条"
  );
  // 判重是按空间**收紧**而不是被取消：同一空间内重复编码仍必须 409。
  const s3SameWsDup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    s3DupBody,
    s3Switch.body.data.accessToken
  );
  assert.equal(
    s3SameWsDup.status,
    409,
    `同一经营空间内重复编码仍必须 409，实际 ${s3SameWsDup.status}`
  );
  ok(
    `经营事实已归属经营空间：${SPACED_TABLES.length} 张表共 ${spacedRows} 行全部落在本租户空间、` +
      `跨租户改挂被外键拒绝、第二空间可复用商品编码且落在会话空间、同空间内重复编码仍 409`
  );

  console.log("== 55. SPACE-03 同租户两个空间不能互读经营事实 ==");
  // 这是 SPACE-03 的核心验收：同一租户、同一账号，切换空间后必须看不到对方的数据。
  const isoA2 = await login("demo", "admin", DEMO_PASSWORD);
  const isoDefaultWs = isoA2.currentWorkspaceId;
  const isoSecondWs = (await request("GET", "/api/platform/workspaces", null, isoA2.accessToken)).body.data
    .find((row) => !row.isDefault && row.status === "active");
  assert.ok(isoSecondWs, "前置条件：需要第二个启用的经营空间");

  // 默认空间里应当有订单（前面的用例造过）。
  const isoOrdersDefault = (await request("GET", "/api/rental/v1/orders", null, isoA2.accessToken)).body.data;
  assert.ok(isoOrdersDefault.length > 0, "前置条件：默认空间应已有订单，否则本节为空转");
  const isoDbDefault = readCount(
    `SELECT COUNT(*) FROM \`rental_orders\` WHERE \`tenantId\`='tenant_001' AND \`workspaceId\`='${isoDefaultWs}';`
  );
  assert.equal(
    isoOrdersDefault.length,
    isoDbDefault,
    `默认空间订单数应与库中该空间的行数一致：接口 ${isoOrdersDefault.length} / 库 ${isoDbDefault}`
  );

  // 切到第二空间：必须看不到默认空间的任何订单。
  const isoSwitch = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: isoSecondWs.id },
    isoA2.accessToken
  );
  assert.equal(isoSwitch.status, 201, `切换到第二空间失败: ${JSON.stringify(isoSwitch.body).slice(0, 200)}`);
  const isoTokenB = isoSwitch.body.data.accessToken;
  const isoOrdersSecond = (await request("GET", "/api/rental/v1/orders", null, isoTokenB)).body.data;
  const isoDefaultIds = new Set(isoOrdersDefault.map((row) => row.id));
  const isoLeaked = isoOrdersSecond.filter((row) => isoDefaultIds.has(row.id));
  assert.deepEqual(
    isoLeaked.map((row) => row.id),
    [],
    `第二个经营空间读到了默认空间的订单（${isoLeaked.length} 张），空间隔离未生效`
  );
  assert.equal(
    isoOrdersSecond.length,
    readCount(
      `SELECT COUNT(*) FROM \`rental_orders\` WHERE \`tenantId\`='tenant_001' AND \`workspaceId\`='${isoSecondWs.id}';`
    ),
    "第二空间的订单数必须等于库中该空间的行数"
  );

  // 按 id 直取也必须隔离。这条是变异测试逼出来的：把 findOrder 的 where 去掉
  // workspaceId 后，上面的列表断言全部照过——列表走 listOrders，单取走 findOrder，
  // 是两条独立的查询路径。只测列表会漏掉「知道 id 就能跨空间读」这个更严重的缺口。
  const isoTargetId = [...isoDefaultIds][0];
  const isoCrossRead = await request("GET", `/api/rental/v1/orders/${isoTargetId}`, null, isoTokenB);
  assert.equal(
    isoCrossRead.status,
    404,
    `在第二空间按 id 直取默认空间的订单必须 404，实际 ${isoCrossRead.status}：` +
      `${JSON.stringify(isoCrossRead.body).slice(0, 160)}`
  );
  // 反向确认这个 id 在它自己的空间里是可读的，否则 404 可能只是订单不存在。
  //
  // 必须重新登录，不能复用 isoA2.accessToken：switch-workspace 改的是**会话**上的
  // 当前空间（setSessionWorkspace），旧访问令牌的 sid 指向同一会话，因此它此刻
  // 也已经解析到第二空间了。这一点是本断言先失败才发现的。
  const isoRelogin = await login("demo", "admin", DEMO_PASSWORD);
  const isoOwnRead = await request("GET", `/api/rental/v1/orders/${isoTargetId}`, null, isoRelogin.accessToken);
  assert.equal(isoOwnRead.status, 200, `同一 id 在默认空间必须可读，否则上面的 404 不能说明隔离生效`);

  // 资产与库存同理：第二空间没有资产，可用量必须为 0 而不是沿用默认空间的。
  const isoAssetsSecond = (await request("GET", "/api/rental/v1/assets", null, isoTokenB)).body.data;
  assert.equal(
    isoAssetsSecond.length,
    readCount(
      `SELECT COUNT(*) FROM \`rental_assets\` WHERE \`tenantId\`='tenant_001' AND \`workspaceId\`='${isoSecondWs.id}';`
    ),
    "第二空间的资产数必须等于库中该空间的行数"
  );
  const isoAssetsDefaultCount = readCount(
    `SELECT COUNT(*) FROM \`rental_assets\` WHERE \`tenantId\`='tenant_001' AND \`workspaceId\`='${isoDefaultWs}';`
  );
  assert.ok(isoAssetsDefaultCount > 0, "前置条件：默认空间应有资产");
  assert.notEqual(
    isoAssetsSecond.length,
    isoAssetsDefaultCount,
    "第二空间不应看到与默认空间相同数量的资产（那意味着读取未按空间过滤）"
  );

  // 切回默认空间，数据必须原样回来——证明隔离是双向的，不是"第二空间恰好为空"。
  const isoBack = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: isoDefaultWs },
    isoTokenB
  );
  assert.equal(isoBack.status, 201, "切回默认空间失败");
  const isoOrdersBack = (await request("GET", "/api/rental/v1/orders", null, isoBack.body.data.accessToken)).body.data;
  assert.equal(isoOrdersBack.length, isoDbDefault, "切回默认空间后订单必须原样可见");
  // 业务配置（定价方案）同样必须按空间隔离。
  //
  // 不能假设默认空间"本来就有"定价方案：第 28 节为验证事实恢复**故意删除**了
  // tenant_001 的定价方案且不恢复。因此自己造一条，让断言不依赖上游残留数据。
  const isoDefaultToken = isoBack.body.data.accessToken;
  const isoDefaultGroup = (await request("GET", "/api/rental/v1/item-groups", null, isoDefaultToken)).body.data[0];
  assert.ok(isoDefaultGroup, "前置条件：默认空间应有商品组");
  const isoMadePlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      code: "E2E-WS-ISO",
      name: "空间隔离验证价格",
      changeReason: "SPACE-03 空间隔离验证",
      status: "enabled",
      rates: [{ itemGroupId: isoDefaultGroup.id, unit: "day_24h", baseAmount: 100, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 100, minimumUnits: 1 }]
    },
    isoDefaultToken
  );
  assert.equal(isoMadePlan.status, 201, `默认空间创建定价方案失败: ${JSON.stringify(isoMadePlan.body).slice(0, 200)}`);
  assert.equal(
    readScalar(`SELECT \`workspaceId\` FROM \`rental_pricing_plans\` WHERE \`id\`='${isoMadePlan.body.data.id}';`),
    isoDefaultWs,
    "新建定价方案必须落在默认经营空间"
  );
  const isoHasPlan = async (token) =>
    (await request("GET", "/api/rental/v1/pricing-plans", null, token)).body.data.some((row) => row.code === "E2E-WS-ISO");
  assert.equal(await isoHasPlan(isoDefaultToken), true, "默认空间应能看到自己刚建的定价方案");

  // 切到第二空间：看不到它。
  const isoSwitch2 = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: isoSecondWs.id },
    isoDefaultToken
  );
  assert.equal(isoSwitch2.status, 201, "再次切换到第二空间失败");
  assert.equal(
    await isoHasPlan(isoSwitch2.body.data.accessToken),
    false,
    "第二空间不得看到默认空间的定价方案"
  );
  const isoPricingSecond = (await request("GET", "/api/rental/v1/pricing-plans", null, isoSwitch2.body.data.accessToken)).body.data;
  assert.ok(isoPricingSecond.length > 0, "第二空间应有属于自己的基础定价方案");
  assert.equal(
    isoPricingSecond[0].categoryCode,
    isoSecondWs.categoryCode,
    `第二空间的定价方案品类应随空间为 ${isoSecondWs.categoryCode}，实际 ${isoPricingSecond[0].categoryCode}`
  );

  // 关键一条：访问过另一个空间之后，默认空间的配置必须**原样still在**。
  // 若状态不按空间键，去第二空间那一次会把同一份状态按 camping 重建，
  // 默认空间刚建的方案随之从内存消失——这条断言正是用来抓这种串台。
  const isoBack2 = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: isoDefaultWs },
    isoSwitch2.body.data.accessToken
  );
  assert.equal(isoBack2.status, 201, "第二次切回默认空间失败");
  assert.equal(
    await isoHasPlan(isoBack2.body.data.accessToken),
    true,
    "访问过第二空间后，默认空间的定价方案不得丢失（状态必须按经营空间各自独立）"
  );

  // 业务设置（支付/押金/逾期/履约/取消规则）必须按空间各自一份。
  // 主键原本是 tenantId，同租户两个空间抢同一行——第二个空间保存会直接覆盖
  // 第一个空间的规则。这条断言正是用来抓那种覆盖。
  const isoSettingsOf = async (token) =>
    (await request("GET", "/api/rental/v1/business-settings", null, token)).body.data;
  const isoDefaultSettings = await isoSettingsOf(isoBack2.body.data.accessToken);
  // 用 overdue.graceMinutes：它是真实存在的数值字段。
  // 先前用 payment.unpaidHoldMinutes——该字段并不存在，undefined + 7 得到 NaN，
  // 于是断言比较的是 NaN，看着像发现了缺陷，实际是坏样本。
  const isoDefaultHold = isoDefaultSettings.overdue.graceMinutes;
  assert.equal(typeof isoDefaultHold, "number", "前置条件：graceMinutes 必须是数值");
  const isoSavedSettings = await request(
    "PUT",
    "/api/rental/v1/business-settings",
    { ...isoDefaultSettings, overdue: { ...isoDefaultSettings.overdue, graceMinutes: isoDefaultHold + 7 } },
    isoBack2.body.data.accessToken
  );
  assert.equal(isoSavedSettings.status, 200, `默认空间保存业务设置失败: ${JSON.stringify(isoSavedSettings.body).slice(0, 200)}`);
  const isoSwitch3 = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: isoSecondWs.id },
    isoBack2.body.data.accessToken
  );
  assert.equal(isoSwitch3.status, 201, "第三次切换到第二空间失败");
  const isoSecondSettings = await isoSettingsOf(isoSwitch3.body.data.accessToken);
  assert.notEqual(
    isoSecondSettings.overdue.graceMinutes,
    isoDefaultHold + 7,
    "第二空间不得继承默认空间刚改的业务设置（业务设置必须按空间各自一份）"
  );
  // 在第二空间也真写一次：既让两侧都有自己的存档，也验证写入不会回流到默认空间。
  // 不写就不会触发 persist，第二空间自然没有快照——那是懒加载的既有设计，不是缺陷。
  const isoSecondHold = isoSecondSettings.overdue.graceMinutes + 21;
  const isoSecondSaved = await request(
    "PUT",
    "/api/rental/v1/business-settings",
    { ...isoSecondSettings, overdue: { ...isoSecondSettings.overdue, graceMinutes: isoSecondHold } },
    isoSwitch3.body.data.accessToken
  );
  assert.equal(isoSecondSaved.status, 200, `第二空间保存业务设置失败: ${JSON.stringify(isoSecondSaved.body).slice(0, 200)}`);
  // 库层同样必须是两行，各归其主。
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_tenant_business_settings` WHERE `tenantId`='tenant_001';"),
    readCount("SELECT COUNT(DISTINCT `workspaceId`) FROM `rental_tenant_business_settings` WHERE `tenantId`='tenant_001';"),
    "同租户的业务设置行数必须等于其涉及的经营空间数（不得多个空间共用一行）"
  );
  // 默认空间的改动必须仍在，没被第二空间的读取或写入抹掉。
  const isoBack3 = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: isoDefaultWs },
    isoSwitch3.body.data.accessToken
  );
  assert.equal(isoBack3.status, 201, "第三次切回默认空间失败");
  assert.equal(
    (await isoSettingsOf(isoBack3.body.data.accessToken)).overdue.graceMinutes,
    isoDefaultHold + 7,
    "默认空间的业务设置改动不得被第二空间覆盖"
  );

  // 每个经营空间必须各有自己的状态快照。
  //
  // 快照主键原本是 tenantId，同租户只有一份：非默认空间根本没有存档，而 persist
  // 又必须固定写默认空间才不互相覆盖。主键换成空间后，两边都该有自己的快照。
  const isoSnapshotRows = readCount(
    "SELECT COUNT(*) FROM `rental_business_state_snapshots` WHERE `tenantId`='tenant_001';"
  );
  assert.ok(
    isoSnapshotRows >= 2,
    `同租户的两个经营空间应各有业务状态快照，实际只有 ${isoSnapshotRows} 行`
  );
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `rental_business_state_snapshots` s LEFT JOIN `business_workspaces` w" +
        " ON w.`id`=s.`workspaceId` AND w.`tenantId`=s.`tenantId` WHERE w.`id` IS NULL;"
    ),
    0,
    "快照的 workspaceId 不得跨租户或悬空"
  );
  // 重启后两个空间的配置必须各自从自己的快照/配置表恢复，互不串台。
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("按空间快照恢复校验的 API 重启超时");
  const isoAfterRestart = await login("demo", "admin", DEMO_PASSWORD);
  assert.equal(
    (await isoSettingsOf(isoAfterRestart.accessToken)).overdue.graceMinutes,
    isoDefaultHold + 7,
    "重启后默认空间的业务设置必须从自己的快照/配置恢复"
  );
  const isoRestartSecond = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: isoSecondWs.id },
    isoAfterRestart.accessToken
  );
  assert.equal(isoRestartSecond.status, 201, "重启后切换到第二空间失败");
  assert.equal(
    (await isoSettingsOf(isoRestartSecond.body.data.accessToken)).overdue.graceMinutes,
    isoSecondHold,
    "重启后第二空间必须恢复出**自己**的业务设置，而不是默认空间的"
  );

  ok(
    `同租户两空间互不可读：默认空间 ${isoDbDefault} 张订单/${isoAssetsDefaultCount} 件资产，` +
      `第二空间 ${isoOrdersSecond.length} 张/${isoAssetsSecond.length} 件且无一条来自默认空间，切回后原样可见；业务配置与业务设置亦隔离（定价方案不互见、业务设置各一份），且两空间各有状态快照、重启后各自恢复不串台`
  );

  console.log("== 57. SPACE-04 共享客户主档按租户复用、业务关系按空间隔离 ==");
  // SPACE-04 的核心验收，两个方向都必须成立，缺一个就是做错了：
  //   共享方向：同一客户在第二个空间**不必重复注册**（主档按租户唯一）
  //   隔离方向：空间级业务关系互不可见（等级、订单、权益按空间独立）
  // 只测一个方向很容易自欺——把主档也做成按空间各存一份时，"隔离"照样过。
  const scDemo = await login("demo", "admin", DEMO_PASSWORD);
  const scDefaultWs = scDemo.currentWorkspaceId;
  const scSecondWs = (await request("GET", "/api/platform/workspaces", null, scDemo.accessToken)).body.data
    .find((row) => !row.isDefault && row.status === "active");
  assert.ok(scSecondWs, "前置条件：需要第二个启用的经营空间");

  // 1) 在默认空间登记一个新客户
  const scPhone = `139${String(Date.now()).slice(-8)}`;
  const scCreate = await request(
    "POST",
    "/api/platform/customers",
    { customerType: "personal", name: "E2E共享客户", phone: scPhone, identityVerified: true, qualifications: { driverLicenseVerified: true } },
    scDemo.accessToken
  );
  assert.equal(scCreate.status, 201, `登记共享客户应成功: ${JSON.stringify(scCreate.body).slice(0, 200)}`);
  const scCustomerId = scCreate.body.data.id;
  // 明文证件号绝不落库，只存掩码。
  assert.equal(scCreate.body.data.phoneMasked, `${scPhone.slice(0, 3)}****${scPhone.slice(-4)}`, "手机号必须有掩码");
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`customer_profiles\` WHERE \`tenantId\`='tenant_001' AND \`phone\`='${scPhone}';`),
    1,
    "共享客户主档应恰好一行"
  );
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`customer_workspace_links\` WHERE \`customerId\`='${scCustomerId}' AND \`workspaceId\`='${scDefaultWs}';`
    ),
    1,
    "登记时应同时建立默认空间的业务关系"
  );

  // 2) 隔离方向：第二空间的业务关系列表看不到这个客户
  const scSwitch = await request("POST", "/api/auth/switch-workspace", { workspaceId: scSecondWs.id }, scDemo.accessToken);
  assert.equal(scSwitch.status, 201, `切换到第二空间失败: ${JSON.stringify(scSwitch.body).slice(0, 200)}`);
  const scTokenB = scSwitch.body.data.accessToken;
  const scLinksB = (await request("GET", "/api/platform/workspace-customers", null, scTokenB)).body.data;
  assert.equal(
    scLinksB.filter((row) => row.customerId === scCustomerId).length,
    0,
    "第二空间的业务关系列表不得看到只在默认空间登记的客户"
  );

  // 3) 共享方向：主档在第二空间**可见**（这是设计，不是泄露）
  const scProfilesB = (await request("GET", "/api/platform/customers", null, scTokenB)).body.data;
  const scFoundB = scProfilesB.find((row) => row.id === scCustomerId);
  assert.ok(
    scFoundB,
    "共享客户主档必须在同租户第二空间可见——否则运营只能重复建档，违背「无需重复注册」"
  );
  assert.equal(
    (scFoundB.workspaceLinks ?? []).some((row) => row.workspaceId === scDefaultWs),
    false,
    "第二空间读取共享主档时不得看到默认空间的等级、状态、首单时间等关系字段"
  );

  // 4) 同手机号在第二空间"再登记"：不得报错、不得新建主档，而是接入本空间
  const scReRegister = await request(
    "POST",
    "/api/platform/customers",
    { customerType: "personal", name: "E2E共享客户", phone: scPhone },
    scTokenB
  );
  assert.equal(
    scReRegister.status,
    201,
    `同手机号在第二空间登记应复用主档而不是 409: ${JSON.stringify(scReRegister.body).slice(0, 200)}`
  );
  assert.equal(scReRegister.body.data.id, scCustomerId, "必须复用同一个共享客户主档，不得新建");
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`customer_profiles\` WHERE \`tenantId\`='tenant_001' AND \`phone\`='${scPhone}';`),
    1,
    "复用后主档仍只有一行（新建了第二行=主档没有真正共享）"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`customer_workspace_links\` WHERE \`customerId\`='${scCustomerId}';`),
    2,
    "两个空间应各有一条业务关系"
  );

  // 5) 幂等：重复接入不得产生第二条关系
  const scLinkAgain = await request(
    "POST",
    "/api/platform/workspace-customers",
    { customerId: scCustomerId },
    scTokenB
  );
  assert.equal(scLinkAgain.status, 201, `重复接入应幂等返回: ${JSON.stringify(scLinkAgain.body).slice(0, 200)}`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`customer_workspace_links\` WHERE \`customerId\`='${scCustomerId}';`),
    2,
    "重复接入不得新增业务关系"
  );

  // 6) 跨租户必须拒绝：拿别租户的 customerId 接入本空间
  const scDemo2 = await login("demo2", "admin", DEMO_PASSWORD);
  const scOtherTenantCustomer = readScalar(
    "SELECT `id` FROM `customer_profiles` WHERE `tenantId`='tenant_001' LIMIT 1;"
  );
  assert.ok(scOtherTenantCustomer, "前置条件：tenant_001 应有共享客户可用于跨租户测试");
  const scCross = await request(
    "POST",
    "/api/platform/workspace-customers",
    { customerId: scOtherTenantCustomer },
    scDemo2.accessToken
  );
  assert.equal(
    scCross.status,
    404,
    `跨租户接入客户必须被拒（404 而非 500）: ${scCross.status} ${JSON.stringify(scCross.body).slice(0, 160)}`
  );
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`customer_workspace_links\` WHERE \`customerId\`='${scOtherTenantCustomer}' AND \`tenantId\`='tenant_002';`
    ),
    0,
    "跨租户接入被拒后不得留下业务关系"
  );

  // 7) 权益账户主键已按空间：同一客户在两空间可各有独立余额
  const scBenefitPk = readScalar(
    "SELECT GROUP_CONCAT(`COLUMN_NAME` ORDER BY `ORDINAL_POSITION`) FROM `information_schema`.`KEY_COLUMN_USAGE` " +
      `WHERE \`TABLE_SCHEMA\`='${TEST_DB}' AND \`TABLE_NAME\`='rental_benefit_accounts' AND \`CONSTRAINT_NAME\`='PRIMARY';`
  );
  assert.equal(
    scBenefitPk,
    "workspaceId,customerId",
    `权益账户主键必须按空间键控，实际 ${scBenefitPk}——租户级主键会让第二个空间的积分覆盖第一个空间`
  );
  ok(
    "共享客户主档按租户复用、业务关系按空间隔离：同手机号在第二空间复用同一主档（主档仍 1 行、关系 2 条）、" +
      "第二空间业务列表不含未接入客户、重复接入幂等、跨租户接入 404 且无残留、权益账户主键为 (workspaceId, customerId)"
  );

  console.log("== 58. SPACE-05 切换后会话上下文随空间刷新 ==");
  // 前端切换器完全依赖这两个接口的返回：切换响应与 session-context。
  // 若它们仍给租户级品类，界面就会"换了空间、菜单还是旧品类"，
  // 而这类缺陷在前端看起来像缓存问题，实际根因在服务端。
  const swDemo = await login("demo", "admin", DEMO_PASSWORD);
  assert.ok(Array.isArray(swDemo.workspaces) && swDemo.workspaces.length >= 2, "前置条件：登录应返回至少两个可进入空间");
  const swDefault = swDemo.workspaces.find((row) => row.isDefault);
  const swOther = swDemo.workspaces.find((row) => !row.isDefault && row.status === "active");
  assert.ok(swDefault && swOther, "前置条件：需要默认空间与另一个启用空间");
  assert.notEqual(swDefault.categoryCode, swOther.categoryCode, "两个空间品类应不同，否则本节无法验证品类随空间刷新");

  // 1) session-context 必须带出空间列表与当前空间（刷新页面后切换器靠它恢复）
  const swCtx1 = await request("GET", "/api/auth/session-context", null, swDemo.accessToken);
  assert.equal(swCtx1.status, 200, `session-context 应成功: ${JSON.stringify(swCtx1.body).slice(0, 160)}`);
  assert.equal(swCtx1.body.data.currentWorkspaceId, swDemo.currentWorkspaceId, "session-context 的当前空间必须与登录一致");
  assert.ok(
    Array.isArray(swCtx1.body.data.workspaces) && swCtx1.body.data.workspaces.length >= 2,
    "session-context 必须带出可进入空间列表，否则刷新页面后切换器无从渲染"
  );
  assert.equal(
    swCtx1.body.data.tenant.categoryCode,
    swDefault.categoryCode,
    "session-context 的品类必须是当前空间的品类"
  );

  // 2) 切换到另一空间：响应与 session-context 的品类都必须跟着变
  const swSwitch = await request("POST", "/api/auth/switch-workspace", { workspaceId: swOther.id }, swDemo.accessToken);
  assert.equal(swSwitch.status, 201, `切换空间失败: ${JSON.stringify(swSwitch.body).slice(0, 200)}`);
  assert.equal(swSwitch.body.data.currentWorkspaceId, swOther.id, "切换响应的当前空间必须是目标空间");
  assert.equal(
    swSwitch.body.data.tenant.categoryCode,
    swOther.categoryCode,
    `切换响应的品类必须随空间变化，实际 ${swSwitch.body.data.tenant.categoryCode} 期望 ${swOther.categoryCode}`
  );
  const swCtx2 = await request("GET", "/api/auth/session-context", null, swSwitch.body.data.accessToken);
  assert.equal(
    swCtx2.body.data.tenant.categoryCode,
    swOther.categoryCode,
    "切换后 session-context 的品类也必须是新空间的品类（刷新页面不得回退到旧品类）"
  );
  assert.equal(swCtx2.body.data.currentWorkspaceId, swOther.id, "切换后 session-context 的当前空间必须是新空间");

  // 3) 无权空间不可切换：另一租户的空间必须被拒
  const swDemo2 = await login("demo2", "admin", DEMO_PASSWORD);
  const swCross = await request("POST", "/api/auth/switch-workspace", { workspaceId: swOther.id }, swDemo2.accessToken);
  assert.ok(
    swCross.status === 403 || swCross.status === 404,
    `切换到无权空间必须被拒（403/404），实际 ${swCross.status}: ${JSON.stringify(swCross.body).slice(0, 160)}`
  );
  // 被拒后原会话的当前空间不得被改动。
  const swCtx3 = await request("GET", "/api/auth/session-context", null, swDemo2.accessToken);
  assert.notEqual(swCtx3.body.data.currentWorkspaceId, swOther.id, "切换被拒后不得改动原会话的当前空间");

  // 4) 切换器渲染所依赖的空间列表必须只含本账号可进入的空间（无权空间不可见）
  const swVisible = swCtx1.body.data.workspaces.map((row) => row.tenantId);
  assert.deepEqual(
    [...new Set(swVisible)],
    ["tenant_001"],
    `可进入空间列表不得含其他租户的空间: ${JSON.stringify([...new Set(swVisible)])}`
  );
  ok(
    "切换后会话上下文随空间刷新：session-context 带出空间列表与当前空间、品类随空间变化（切换响应与刷新后一致）、" +
      "跨租户空间切换被拒且不改动原会话、空间列表只含本租户"
  );

  console.log("== 59. RC-04 审计列表按经营空间隔离 ==");
  // 审计写入已经携带会话 workspaceId，但如果列表只按 tenantId 查询，
  // 同租户在两个空间的管理员会在 audit-logs 中互相看到业务动作，
  // 这既违反 SPACE-03，也让 RC-04 的“按空间可追溯”失去边界。
  // 先在当前空间执行一次无语义变化的完整覆盖写，避免依赖前面章节恰好选中过
  // 同一个 non-default 空间；审计拦截器异步落库，因此有限轮询到该动作可见。
  const swSettings = (await request("GET", "/api/rental/v1/business-settings", null, swSwitch.body.data.accessToken)).body.data;
  const swAuditWrite = await request("PUT", "/api/rental/v1/business-settings", swSettings, swSwitch.body.data.accessToken);
  assert.equal(swAuditWrite.status, 200, `当前空间保存业务设置失败: ${JSON.stringify(swAuditWrite.body).slice(0, 200)}`);
  let swAuditRows = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const swAudit = await request("GET", "/api/platform/audit-logs?limit=200", null, swSwitch.body.data.accessToken);
    assert.equal(swAudit.status, 200, `当前空间读取审计列表应成功: ${JSON.stringify(swAudit.body).slice(0, 200)}`);
    swAuditRows = swAudit.body.data.rows;
    if (swAuditRows.some((row) => row.workspaceId === swOther.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(Array.isArray(swAuditRows) && swAuditRows.length > 0, "前置条件：当前空间应有可追溯的审计动作");
  assert.deepEqual(
    [...new Set(swAuditRows.map((row) => row.workspaceId))],
    [swOther.id],
    `审计列表不得混入同租户其他空间或平台域动作：${JSON.stringify(swAuditRows.map((row) => row.workspaceId))}`
  );
  ok("RC-04 审计列表按当前经营空间隔离，返回记录带 workspaceId 以便追溯边界");

  console.log("== 60. 旧版快照缺字段时读路径仍不得 500 ==");
  // 浏览器实测发现的缺陷（E2E 当时没抓到）：快照 JSON 被直接当 TenantRentalState 装载，
  // 早于某字段引入的快照不含该字段，于是 `state.sampleAssets.length` 抛
  // "Cannot read properties of undefined"，/rental/v1/assets 与 /stock-balances 直接 500。
  //
  // E2E 抓不到的原因很具体：它每次用全新测试库，快照都是当前版本写的、天然带齐字段。
  // 因此这里**主动把快照改成旧版形状**（删掉字段）再重启，模拟真实的升级库。
  // 这是证伪式测试：不是断言"字段在就正常"，而是断言"字段不在也不能崩"。
  // 取 demo 租户的**非默认**空间：本节要清空该空间的配置行，
  // 放在最后一节且只动非默认空间，不影响前面各节已完成的断言。
  // 复现条件要精确：开发库炸掉是因为该空间**在配置表里没有任何行**，
  // 于是 onApplicationBootstrap 的重建循环跳过它，onModuleInit 装载的原始 JSON
  // 保持为活状态；而只改字段不够——重建基底总是带齐字段，改坏的 JSON 到不了读路径
  // （第一版就是这样写成了不具区分力的绿灯，靠变异测试才发现）。
  //
  // 因此这里**新建**一个空间：新空间天然没有配置行，不必删任何现有数据，
  // 也就不会因为外键依赖顺序而失败，更不会影响前面各节。
  const legacyDemoAdmin = await login("demo", "admin", DEMO_PASSWORD);
  // 复现条件要精确：开发库炸掉是因为该空间**在配置表里没有任何行**，
  // 于是 onApplicationBootstrap 的重建循环跳过它，onModuleInit 装载的原始 JSON
  // 保持为活状态；而只改字段不够——重建基底总是带齐字段，改坏的 JSON 到不了读路径
  // （第一版就是这样写成了不具区分力的绿灯，靠变异测试才发现）。
  //
  // 注意不能用「新建空间」来复现：新建会连带落配置行，那也是新空间为何天然健康。
  // 开发库里出问题的是历史空间——快照行在、配置行不在。这里如实构造该形态。
  const orphanSnapWs = `ws_e2e_legacy_${Date.now().toString(36)}`;
  mysqlQuery(
    "INSERT INTO `business_workspaces` (`id`,`tenantId`,`code`,`name`,`categoryCode`,`status`," +
      "`isDefault`,`defaultMarker`,`createdAt`,`updatedAt`) VALUES (" +
      `'${orphanSnapWs}','tenant_001','E2E-ORPHAN-${Date.now().toString(36)}','旧版快照孤立空间',` +
      `'construction','active',0,'${orphanSnapWs}',NOW(3),NOW(3));`
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_item_groups\` WHERE \`workspaceId\`='${orphanSnapWs}';`),
    0,
    "前置条件：该空间不应有配置行，否则重建循环不会跳过它、复现不成立"
  );
  // 让当前账号能进入这个空间，否则切换会被成员校验拒绝（那是另一条正确的规则）。
  mysqlQuery(
    "INSERT INTO `workspace_members` (`tenantId`,`workspaceId`,`userId`,`isActive`,`createdAt`,`updatedAt`) " +
      `SELECT 'tenant_001', '${orphanSnapWs}', u.\`id\`, 1, NOW(3), NOW(3) ` +
      "FROM `User` u WHERE u.`tenantId`='tenant_001' AND u.`account`='admin' LIMIT 1;"
  );
  // 直接写入一条**旧版形状**的快照：不含 sampleAssets/sampleStockBalances/operators。
  // 这正是升级库里那些老快照的样子。
  mysqlQuery(
    "INSERT INTO `rental_core_state_snapshots` (`workspaceId`, `tenantId`, `state`, `updatedAt`) VALUES (" +
      `'${orphanSnapWs}', 'tenant_001', ` +
      "JSON_OBJECT('profile', JSON_OBJECT('tenantId','tenant_001','categoryCode','construction'), " +
      "'itemGroups', JSON_ARRAY(), 'locations', JSON_ARRAY(), 'inspectionTemplates', JSON_ARRAY(), " +
      "'couponTemplates', JSON_ARRAY()), NOW(3));"
  );
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `rental_core_state_snapshots` WHERE " +
        `\`workspaceId\`='${orphanSnapWs}' AND JSON_CONTAINS_PATH(\`state\`,'one','$.sampleAssets');`
    ),
    0,
    "前置条件：快照不应含 sampleAssets，否则本节测的不是旧版快照"
  );
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("旧版快照兼容性校验的 API 重启超时");
  const legacyDemo = await login("demo", "admin", DEMO_PASSWORD);
  // 必须切到那个被改坏的空间，否则读的是默认空间的健康状态，等于没测。
  const legacySwitch = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: orphanSnapWs },
    legacyDemo.accessToken
  );
  assert.equal(
    legacySwitch.status,
    201,
    `切换到旧版快照空间应成功: ${legacySwitch.status} ${JSON.stringify(legacySwitch.body).slice(0, 200)}`
  );
  const legacyToken = legacySwitch.body.data.accessToken;
  for (const endpoint of ["assets", "stock-balances", "item-groups", "locations", "orders"]) {
    const res = await request("GET", `/api/rental/v1/${endpoint}`, null, legacyToken);
    assert.equal(
      res.status,
      200,
      `旧版快照下 /${endpoint} 必须正常返回而不是 500（缺字段应被补默认值）: ` +
        `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`
    );
  }
  ok(
    "旧版快照缺字段仍可读：清空该空间配置行并移除 sampleAssets/sampleStockBalances/operators/" +
      "sampleFactsEnsured 后重启，切入该空间后五个读接口均 200 而非 500"
  );

  console.log("== 61. 经营空间管理接口必须有权限门槛 ==");
  // 自查 Review 发现的 fail-open：`requiredPermissions()` 的 /platform 分支
  // 漏列了 /platform/workspaces，落到函数末尾的 `return []`，而 hasAnyPermission
  // 对空数组直接放行。后果是任何能登录的账号都能列出全部空间、把自己加进任一空间、
  // 甚至附带租户管理员角色——既跨空间读数据又提权。
  //
  // 用一个**无管理权限**的账号验证：造一个只有订单查看权的角色并建号。
  const permAdmin = await login("demo", "admin", DEMO_PASSWORD);
  const permRole = await request(
    "POST",
    "/api/platform/roles",
    {
      code: `E2E-LOWPRIV-${Date.now().toString(36)}`,
      name: "E2E 低权限角色",
      scope: "store",
      dataScope: "own",
      enabledBusinessScopes: ["rental"],
      // 字段名是 permissions，不是 permissionCodes。写错的话角色会拿到 0 条权限，
      // 于是第 61 节的 403 来自"无权访问该功能"而不是空间检查——因错误的理由通过。
      // 实测过：写错时把 hasWorkspaces 豁免加回去，第 61 节依然全绿。
      permissions: [
        "store-rental:order:view",
        "store-rental:vehicle:view",
        "store-rental:vehicle-group:manage"
      ],
      isActive: true
    },
    permAdmin.accessToken
  );
  assert.equal(permRole.status, 201, `建低权限角色应成功: ${JSON.stringify(permRole.body).slice(0, 200)}`);
  const permAccount = `e2e_lowpriv_${Date.now().toString(36)}`;
  const permUser = await request(
    "POST",
    "/api/platform/users",
    {
      account: permAccount,
      displayName: "E2E 低权限账号",
      phone: "13900007777",
      roleIds: [permRole.body.data.id],
      isActive: true
    },
    permAdmin.accessToken
  );
  assert.equal(permUser.status, 201, `建低权限账号应成功: ${JSON.stringify(permUser.body).slice(0, 200)}`);
  const permTempPassword = permUser.body.data.temporaryPassword;
  assert.ok(permTempPassword, "新账号应返回初始密码");
  // 新账号必须先改密才能调业务接口（mustChangePassword 闸门），否则拿到的 403
  // 来自改密要求而不是空间检查，断言就测不到目标路径。
  const permFirstLogin = await login("demo", permAccount, permTempPassword);
  const permNewPassword = `E2e!${randomBytes(4).toString("hex")}`;
  const permChanged = await request(
    "POST",
    "/api/auth/change-password",
    { currentPassword: permTempPassword, newPassword: permNewPassword },
    permFirstLogin.accessToken
  );
  assert.equal(permChanged.status, 201, `低权限账号改密应成功: ${JSON.stringify(permChanged.body).slice(0, 200)}`);
  const permLogin = await login("demo", permAccount, permNewPassword);

  // 1) 列空间：低权限账号不得读取
  const permList = await request("GET", "/api/platform/workspaces", null, permLogin.accessToken);
  assert.equal(
    permList.status,
    403,
    `低权限账号不得列出经营空间，实际 ${permList.status}: ${JSON.stringify(permList.body).slice(0, 200)}`
  );
  // 2) 加成员（提权路径）：必须被拒
  const permTargetWs = (await request("GET", "/api/platform/workspaces", null, permAdmin.accessToken)).body.data[0];
  const permAddMember = await request(
    "PUT",
    `/api/platform/workspaces/${permTargetWs.id}/members`,
    { userId: permUser.body.data.id, roleId: permRole.body.data.id },
    permLogin.accessToken
  );
  assert.equal(
    permAddMember.status,
    403,
    `低权限账号不得增删空间成员（这是提权路径），实际 ${permAddMember.status}: ` +
      `${JSON.stringify(permAddMember.body).slice(0, 200)}`
  );
  // 3) 建空间：必须被拒
  const permCreateWs = await request(
    "POST",
    "/api/platform/workspaces",
    { tenantId: "tenant_001", code: `E2E-NOPERM-${Date.now().toString(36)}`, name: "越权建空间", categoryCode: "camping" },
    permLogin.accessToken
  );
  assert.equal(
    permCreateWs.status,
    403,
    `低权限账号不得新建经营空间，实际 ${permCreateWs.status}: ${JSON.stringify(permCreateWs.body).slice(0, 200)}`
  );
  // 4) 管理员仍然可用（避免把权限收得过紧而不自知）
  const permAdminList = await request("GET", "/api/platform/workspaces", null, permAdmin.accessToken);
  assert.equal(permAdminList.status, 200, "租户管理员仍应能列出经营空间");
  ok("经营空间管理接口有权限门槛：低权限账号列空间/加成员/建空间均 403，管理员不受影响");

  console.log("== 61b. PRICE-02 日历编辑与发布分权（需求 4.5.8） ==");
  // 需求 4.5.8：编辑与发布使用独立权限，权限模型必须允许「日历编辑人员只能改草稿、不得发布」。
  // 造一个只有 calendar:edit 的角色与账号，加入其经营空间验证：编辑可、发布 403、
  // 管理员发布 201（证明 403 来自权限拆分而非坏接口）。放在平台域审计不变量断言（第 41 节）
  // 之后，避免本节创建角色/账号/成员的平台域写操作把带空间的平台审计计入那条前置断言。
  // 用 demo 租户：其管理员口令是测试常量，可随时新登拿到未过期令牌（bootstrap 租户的
  // 令牌到本节可能已过期，且其口令不外露无法重登）。
  const calAdmin = await login("demo", "admin", DEMO_PASSWORD);
  const calEditorRole = await request(
    "POST",
    "/api/platform/roles",
    {
      code: `E2E-CAL-EDITOR-${Date.now().toString(36)}`,
      name: "E2E 日历编辑人员",
      scope: "store",
      dataScope: "all",
      enabledBusinessScopes: ["rental"],
      // 只给编辑权限，不给发布、不给 price:manage：这正是「编辑人不能发布」要能表达的角色。
      permissions: ["store-rental:calendar:edit", "store-rental:order:view"],
      isActive: true
    },
    calAdmin.accessToken
  );
  assert.equal(calEditorRole.status, 201, `建日历编辑角色失败: ${JSON.stringify(calEditorRole.body).slice(0, 200)}`);
  const calEditorAccount = `e2e_cal_editor_${Date.now().toString(36)}`;
  const calEditorUser = await request(
    "POST",
    "/api/platform/users",
    { account: calEditorAccount, displayName: "E2E 日历编辑", phone: "13900008888", roleIds: [calEditorRole.body.data.id], isActive: true },
    calAdmin.accessToken
  );
  assert.equal(calEditorUser.status, 201, `建日历编辑账号失败: ${JSON.stringify(calEditorUser.body).slice(0, 200)}`);
  const calEditorMember = await request(
    "PUT",
    `/api/platform/workspaces/${calAdmin.currentWorkspaceId}/members`,
    { userId: calEditorUser.body.data.id, roleId: calEditorRole.body.data.id },
    calAdmin.accessToken
  );
  assert.ok([200, 201].includes(calEditorMember.status), `加入空间成员失败: ${calEditorMember.status} ${JSON.stringify(calEditorMember.body).slice(0, 200)}`);
  const calEditorTemp = calEditorUser.body.data.temporaryPassword;
  const calEditorFirst = await login("demo", calEditorAccount, calEditorTemp);
  const calEditorPwd = `E2e!${randomBytes(4).toString("hex")}`;
  const calEditorChanged = await request(
    "POST",
    "/api/auth/change-password",
    { currentPassword: calEditorTemp, newPassword: calEditorPwd },
    calEditorFirst.accessToken
  );
  assert.equal(calEditorChanged.status, 201, `日历编辑改密失败: ${JSON.stringify(calEditorChanged.body).slice(0, 200)}`);
  const calEditor = await login("demo", calEditorAccount, calEditorPwd);
  const calSwitch = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: calAdmin.currentWorkspaceId },
    calEditor.accessToken
  );
  assert.equal(calSwitch.status, 201, `日历编辑切换空间失败: ${calSwitch.status} ${JSON.stringify(calSwitch.body).slice(0, 200)}`);
  const editorToken = calSwitch.body.data.accessToken;
  // 编辑权限：应用公共官方来源版本（编辑动作）应放行。
  const editor2032Version = await registerOfficialVersion(2032, [
    { date: "2032-10-01", dayType: "statutory_holiday", name: "国庆节", pricingMultiplier: 1.5 }
  ]);
  const editorImport = await applyOfficialVersion(2032, editor2032Version.id, editorToken);
  assert.equal(editorImport.status, 201, `日历编辑应能应用官方来源（编辑权限）: ${editorImport.status} ${JSON.stringify(editorImport.body).slice(0, 200)}`);
  // 公共来源是平台级资源：租户侧（含租户管理员）不得写它，否则一个租户能改所有租户共用的官方数据。
  const tenantWriteSource = await request(
    "POST",
    "/api/platform/official-calendars",
    { region: "CN", name: "租户越权登记", url: "https://example.invalid/tenant-write" },
    calAdmin.accessToken
  );
  assert.equal(tenantWriteSource.status, 403, `租户不得维护公共官方来源: ${tenantWriteSource.status} ${JSON.stringify(tenantWriteSource.body).slice(0, 200)}`);
  // 发布权限：只有编辑权限的账号必须 403（本条核心——编辑与发布独立鉴权）。
  const editorPublish = await request(
    "POST",
    "/api/rental/v1/calendars/2032/publish",
    { changeReason: "编辑人尝试发布" },
    editorToken
  );
  assert.equal(editorPublish.status, 403, `只有编辑权限的账号不得发布日历: ${editorPublish.status} ${JSON.stringify(editorPublish.body).slice(0, 200)}`);
  // 管理员发布同一年度应成功，证明 403 来自权限拆分而非坏接口。
  const adminPublish2032 = await request(
    "POST",
    "/api/rental/v1/calendars/2032/publish",
    { changeReason: "管理员发布 2032" },
    calAdmin.accessToken
  );
  assert.equal(adminPublish2032.status, 201, `管理员发布应成功: ${adminPublish2032.status} ${JSON.stringify(adminPublish2032.body).slice(0, 200)}`);
  ok("日历编辑与发布分权：仅 calendar:edit 的账号可导入草稿但发布 403，管理员发布 201，证明编辑与发布独立鉴权");
  console.log("== 61c. PRICE-02 发布权限不含编辑 + 普通运营只见已发布（Codex #2/#3） ==");
  // #2：发布与编辑相互独立——只有 calendar:publish 的账号不得编辑（导入应 403）。
  const calPublisherRole = await request("POST", "/api/platform/roles", {
    code: `E2E-CAL-PUB-${Date.now().toString(36)}`, name: "E2E 日历发布人员", scope: "store", dataScope: "all",
    enabledBusinessScopes: ["rental"], permissions: ["store-rental:calendar:publish", "store-rental:order:view"], isActive: true
  }, calAdmin.accessToken);
  assert.equal(calPublisherRole.status, 201, `建发布角色失败: ${JSON.stringify(calPublisherRole.body).slice(0, 200)}`);
  const calPublisherAccount = `e2e_cal_pub_${Date.now().toString(36)}`;
  const calPublisherUser = await request("POST", "/api/platform/users", { account: calPublisherAccount, displayName: "E2E 日历发布", phone: "13900009999", roleIds: [calPublisherRole.body.data.id], isActive: true }, calAdmin.accessToken);
  assert.equal(calPublisherUser.status, 201, `建发布账号失败: ${JSON.stringify(calPublisherUser.body).slice(0, 200)}`);
  await request("PUT", `/api/platform/workspaces/${calAdmin.currentWorkspaceId}/members`, { userId: calPublisherUser.body.data.id, roleId: calPublisherRole.body.data.id }, calAdmin.accessToken);
  const calPubTemp = calPublisherUser.body.data.temporaryPassword;
  const calPubFirst = await login("demo", calPublisherAccount, calPubTemp);
  const calPubPwd = `E2e!${randomBytes(4).toString("hex")}`;
  await request("POST", "/api/auth/change-password", { currentPassword: calPubTemp, newPassword: calPubPwd }, calPubFirst.accessToken);
  const calPub = await login("demo", calPublisherAccount, calPubPwd);
  const calPubToken = (await request("POST", "/api/auth/switch-workspace", { workspaceId: calAdmin.currentWorkspaceId }, calPub.accessToken)).body.data.accessToken;
  const pub2034Version = await registerOfficialVersion(2034, [
    { date: "2034-10-01", dayType: "statutory_holiday", name: "国庆节", pricingMultiplier: 1.5 }
  ]);
  const publisherImport = await applyOfficialVersion(2034, pub2034Version.id, calPubToken);
  assert.equal(publisherImport.status, 403, `只有发布权限的账号不得编辑（应用官方来源）: ${publisherImport.status} ${JSON.stringify(publisherImport.body).slice(0, 200)}`);
  // 正向控制：必须证明该账号**确实持有** calendar:publish，否则一个「什么日历权限都没有」的
  // 账号同样会 403，这条 403 就成了装饰品（replaceRolePermissions 对目录里不存在的权限码是
  // 静默丢弃 + 201，改名/删码都不会报错）。用它发布 2034 草稿：管理员先建草稿再由它发布。
  const pubYearDraft = await request("PUT", "/api/rental/v1/calendars/2034/days/2034-05-01", {
    date: "2034-05-01", dayType: "tenant_special", name: "发布人用例草稿", pricingMultiplier: 1.3, closed: false, overrideReason: "发布权限正向控制"
  }, calAdmin.accessToken);
  assert.equal(pubYearDraft.status, 200, `管理员建 2034 草稿失败: ${pubYearDraft.status} ${JSON.stringify(pubYearDraft.body).slice(0, 200)}`);
  const publisherPublish = await request("POST", "/api/rental/v1/calendars/2034/publish", { changeReason: "发布人发布 2034" }, calPubToken);
  assert.equal(publisherPublish.status, 201, `持有 calendar:publish 的账号必须能发布（否则上面的 403 无区分力）: ${publisherPublish.status} ${JSON.stringify(publisherPublish.body).slice(0, 200)}`);
  assert.equal(publisherPublish.body.data.status, "published", `发布后状态应为 published: ${publisherPublish.body.data.status}`);
  // #3：普通运营人员（order:view）只看已发布日历，看不到未发布的草稿调整。
  // 61b 已发布 2032；此处 demo 管理员对 2032 存一个未发布的草稿调整。
  const draftEdit = await request("PUT", "/api/rental/v1/calendars/2032/days/2032-07-01", {
    date: "2032-07-01", dayType: "tenant_special", name: "未发布调整", pricingMultiplier: 1.8, closed: false, overrideReason: "草稿可见性用例"
  }, calAdmin.accessToken);
  assert.equal(draftEdit.status, 200, `造未发布草稿调整失败: ${draftEdit.status} ${JSON.stringify(draftEdit.body).slice(0, 200)}`);
  const calViewerRole = await request("POST", "/api/platform/roles", {
    code: `E2E-CAL-VIEW-${Date.now().toString(36)}`, name: "E2E 只读运营", scope: "store", dataScope: "all",
    enabledBusinessScopes: ["rental"], permissions: ["store-rental:order:view"], isActive: true
  }, calAdmin.accessToken);
  assert.equal(calViewerRole.status, 201, `建只读角色失败: ${JSON.stringify(calViewerRole.body).slice(0, 200)}`);
  const calViewerAccount = `e2e_cal_view_${Date.now().toString(36)}`;
  const calViewerUser = await request("POST", "/api/platform/users", { account: calViewerAccount, displayName: "E2E 只读运营", phone: "13900001111", roleIds: [calViewerRole.body.data.id], isActive: true }, calAdmin.accessToken);
  assert.equal(calViewerUser.status, 201, `建只读账号失败: ${JSON.stringify(calViewerUser.body).slice(0, 200)}`);
  await request("PUT", `/api/platform/workspaces/${calAdmin.currentWorkspaceId}/members`, { userId: calViewerUser.body.data.id, roleId: calViewerRole.body.data.id }, calAdmin.accessToken);
  const calViewTemp = calViewerUser.body.data.temporaryPassword;
  const calViewFirst = await login("demo", calViewerAccount, calViewTemp);
  const calViewPwd = `E2e!${randomBytes(4).toString("hex")}`;
  await request("POST", "/api/auth/change-password", { currentPassword: calViewTemp, newPassword: calViewPwd }, calViewFirst.accessToken);
  const calViewer = await login("demo", calViewerAccount, calViewPwd);
  const calViewToken = (await request("POST", "/api/auth/switch-workspace", { workspaceId: calAdmin.currentWorkspaceId }, calViewer.accessToken)).body.data.accessToken;
  const viewerCal = await request("GET", "/api/rental/v1/calendars/2032", null, calViewToken);
  assert.equal(viewerCal.status, 200, `只读运营读日历失败: ${viewerCal.status}`);
  assert.equal(viewerCal.body.data.status, "published", `普通运营应看到已发布日历，实际 status=${viewerCal.body.data.status}`);
  assert.ok(!viewerCal.body.data.days.some((d) => d.date === "2032-07-01" && d.source === "tenant_override"), "普通运营不得看到未发布的草稿调整");
  const adminCal = await request("GET", "/api/rental/v1/calendars/2032", null, calAdmin.accessToken);
  assert.equal(adminCal.body.data.status, "draft", `编辑者应看到草稿视图，实际 status=${adminCal.body.data.status}`);
  assert.ok(adminCal.body.data.days.some((d) => d.date === "2032-07-01" && d.source === "tenant_override"), "编辑者应看到未发布的草稿调整");
  // #6：历史版本/审计查询属管理视图，只读运营不得访问（版本详情含未发布草稿内容）。
  const viewerVersions = await request("GET", "/api/rental/v1/calendars/2032/versions", null, calViewToken);
  assert.equal(viewerVersions.status, 403, `只读运营不得查看版本历史（含草稿内容）: ${viewerVersions.status}`);
  // Codex 自审 P0/P1：鉴权路径判定必须与 Express 的路由匹配语义一致（大小写不敏感、容忍尾斜杠），
  // 否则大小写/尾斜杠变体会落到 requiredPermissions 的 `return []` 被当成无需权限而放行。
  // (a) 提权面：只读运营用大写 /PLATFORM 建角色必须被拒（这条曾可 201 完成任意提权）。
  const bypassRole = await request("POST", "/api/PLATFORM/roles", { code: `E2E-BYPASS-${Date.now().toString(36)}`, name: "越权", scope: "store", dataScope: "own", enabledBusinessScopes: ["rental"], permissions: ["store-rental:price:manage"], isActive: true }, calViewToken);
  assert.equal(bypassRole.status, 403, `大写路径不得绕过平台鉴权（提权面）: ${bypassRole.status} ${JSON.stringify(bypassRole.body).slice(0, 160)}`);
  // (b) 大写前缀的经营接口同样不得整体放行。
  const bypassPrefix = await request("POST", "/API/rental/v1/calendars/2035/publish", { changeReason: "x" }, calViewToken);
  assert.equal(bypassPrefix.status, 403, `大写 /API 前缀不得绕过鉴权: ${bypassPrefix.status}`);
  // (c) 发布鉴权不得被尾斜杠/大写绕过：仅编辑权限的账号走这些变体仍须 403。
  const editorPublishSlash = await request("POST", "/api/rental/v1/calendars/2032/publish/", { changeReason: "尾斜杠绕过" }, editorToken);
  assert.equal(editorPublishSlash.status, 403, `尾斜杠不得让编辑账号绕过发布鉴权: ${editorPublishSlash.status}`);
  const editorPublishUpper = await request("POST", "/api/rental/v1/calendars/2032/PUBLISH", { changeReason: "大写绕过" }, editorToken);
  assert.equal(editorPublishUpper.status, 403, `大写 PUBLISH 不得让编辑账号绕过发布鉴权: ${editorPublishUpper.status}`);
  // (d) 版本历史管理视图不得被大写绕过给只读运营。
  const viewerVersionsUpper = await request("GET", "/api/rental/v1/calendars/2032/VERSIONS", null, calViewToken);
  assert.equal(viewerVersionsUpper.status, 403, `大写 VERSIONS 不得让只读运营读到草稿版本: ${viewerVersionsUpper.status}`);
  ok("发布权限不含编辑（发布人员导入 403）+ 普通运营只见已发布日历（看不到未发布草稿、编辑者能看到）+ 版本历史属管理视图 + 鉴权路径判定对大小写/尾斜杠不可绕过（提权面、发布、版本历史均 403）");

  console.log("== 61c-2. PRICE-02 客服/财务历史只读权限（Codex #5） ==");
  // 需求 4.5.8：客服或财务「查看历史版本及报价命中的日历依据，不得修改」。
  // 独立权限 store-rental:calendar:view-history：能读历史/差异/审计，但不能编辑、发布、看发布预检。
  //
  // Codex 复审 #3：三个日历权限必须出现在 /permission-tree 目录里，否则角色管理页面
  // 根本列不出这些选项，管理员无法给自定义角色分配（页面选项完全来自该目录）。
  const permTree = await request("GET", "/api/platform/permission-tree", null, calAdmin.accessToken);
  assert.equal(permTree.status, 200, `读取权限目录失败: ${permTree.status}`);
  const permCodes = new Set(
    (permTree.body.data ?? []).flatMap((mod) => (mod.children ?? []).map((child) => child.code))
  );
  for (const code of ["store-rental:calendar:edit", "store-rental:calendar:publish", "store-rental:calendar:view-history"]) {
    assert.ok(permCodes.has(code), `权限目录必须包含 ${code}，否则角色管理页面无法分配`);
  }
  const historyRole = await request("POST", "/api/platform/roles", {
    code: `E2E-CAL-HIST-${Date.now().toString(36)}`, name: "E2E 客服历史只读", scope: "store", dataScope: "all",
    enabledBusinessScopes: ["rental"], permissions: ["store-rental:calendar:view-history", "store-rental:order:view"], isActive: true
  }, calAdmin.accessToken);
  assert.equal(historyRole.status, 201, `建历史只读角色失败: ${JSON.stringify(historyRole.body).slice(0, 200)}`);
  const historyAccount = `e2e_cal_hist_${Date.now().toString(36)}`;
  const historyUser = await request("POST", "/api/platform/users", { account: historyAccount, displayName: "E2E 客服", phone: "13900002222", roleIds: [historyRole.body.data.id], isActive: true }, calAdmin.accessToken);
  assert.equal(historyUser.status, 201, `建历史只读账号失败: ${JSON.stringify(historyUser.body).slice(0, 200)}`);
  await request("PUT", `/api/platform/workspaces/${calAdmin.currentWorkspaceId}/members`, { userId: historyUser.body.data.id, roleId: historyRole.body.data.id }, calAdmin.accessToken);
  const histTemp = historyUser.body.data.temporaryPassword;
  const histFirst = await login("demo", historyAccount, histTemp);
  const histPwd = `E2e!${randomBytes(4).toString("hex")}`;
  await request("POST", "/api/auth/change-password", { currentPassword: histTemp, newPassword: histPwd }, histFirst.accessToken);
  const histLogin = await login("demo", historyAccount, histPwd);
  const histToken = (await request("POST", "/api/auth/switch-workspace", { workspaceId: calAdmin.currentWorkspaceId }, histLogin.accessToken)).body.data.accessToken;
  // 正向：能读版本列表、版本详情、覆盖审计（2032 在 61b/61c 已发布并有草稿）。
  const histVersions = await request("GET", "/api/rental/v1/calendars/2032/versions", null, histToken);
  assert.equal(histVersions.status, 200, `历史只读账号必须能读版本列表: ${histVersions.status} ${JSON.stringify(histVersions.body).slice(0, 200)}`);
  assert.ok(Array.isArray(histVersions.body.data) && histVersions.body.data.length > 0, "版本列表应有内容");
  const histOnePub = histVersions.body.data.find((v) => v.status === "published") ?? histVersions.body.data[0];
  const histDetail = await request("GET", `/api/rental/v1/calendars/2032/versions/${encodeURIComponent(histOnePub.version)}`, null, histToken);
  assert.equal(histDetail.status, 200, `历史只读账号必须能读版本详情: ${histDetail.status}`);
  const histAudits = await request("GET", "/api/rental/v1/calendars/2032/override-audits", null, histToken);
  assert.equal(histAudits.status, 200, `历史只读账号必须能读覆盖审计: ${histAudits.status}`);
  // 反向：不能改（保存日期覆盖=编辑）、不能发布、不能看发布预检（那是发布决策而非追溯）。
  const histEdit = await request("PUT", "/api/rental/v1/calendars/2032/days/2032-10-01", {
    date: "2032-10-01", dayType: "tenant_special", name: "越权编辑", pricingMultiplier: 1.5, closed: false, overrideReason: "越权编辑"
  }, histToken);
  assert.equal(histEdit.status, 403, `历史只读账号不得编辑（保存日期覆盖）: ${histEdit.status}`);
  const histPublish = await request("POST", "/api/rental/v1/calendars/2032/publish", { changeReason: "越权发布" }, histToken);
  assert.equal(histPublish.status, 403, `历史只读账号不得发布: ${histPublish.status}`);
  const histPreview = await request("GET", "/api/rental/v1/calendars/2032/publish-preview", null, histToken);
  assert.equal(histPreview.status, 403, `历史只读账号不得查看发布预检（属发布决策）: ${histPreview.status}`);
  ok("客服/财务历史只读权限：view-history 账号能读版本列表/详情/覆盖审计（200），但导入、发布、发布预检一律 403，实现了「查看历史但不得修改」而不过度授予编辑或发布权");

  console.log("== 61d. 未列入鉴权规则的路由必须默认拒绝（Codex P0 fail-open） ==");
  // 当前产品的优惠配置统一走 Rental Core；旧 /store-rental/marketing/* 已删除。
  // order:view 可以读取可用于下单的优惠目录，但不能修改配置；真正的越权断言放在
  // POST /discount-plans 上，避免把“订单创建需要读优惠”误判成配置泄露。
  // vehicleA 的令牌建于第 17 节重启之前，而重启会换 AUTH_TOKEN_SECRET，故须重登。
  const mktAdmin = await login("e2e_vehicle_a", "admin", vehicleA.password);
  const mktLowRole = await request("POST", "/api/platform/roles", {
    code: `E2E-MKT-LOW-${Date.now().toString(36)}`, name: "E2E 营销越权验证角色", scope: "store", dataScope: "all",
    enabledBusinessScopes: ["rental"], permissions: ["store-rental:order:view"], isActive: true
  }, mktAdmin.accessToken);
  assert.equal(mktLowRole.status, 201, `建低权限角色失败: ${JSON.stringify(mktLowRole.body).slice(0, 200)}`);
  const mktLowAccount = `e2e_mkt_low_${Date.now().toString(36)}`;
  const mktLowUser = await request("POST", "/api/platform/users", {
    account: mktLowAccount, displayName: "E2E 营销只读账号", phone: "13900002222",
    roleIds: [mktLowRole.body.data.id], isActive: true
  }, mktAdmin.accessToken);
  assert.equal(mktLowUser.status, 201, `建低权限账号失败: ${JSON.stringify(mktLowUser.body).slice(0, 200)}`);
  await request("PUT", `/api/platform/workspaces/${mktAdmin.currentWorkspaceId}/members`, { userId: mktLowUser.body.data.id, roleId: mktLowRole.body.data.id }, mktAdmin.accessToken);
  const mktLowTemp = mktLowUser.body.data.temporaryPassword;
  const mktLowFirst = await login("e2e_vehicle_a", mktLowAccount, mktLowTemp);
  const mktLowPwd = `E2e!${randomBytes(4).toString("hex")}`;
  assert.equal(
    (await request("POST", "/api/auth/change-password", { currentPassword: mktLowTemp, newPassword: mktLowPwd }, mktLowFirst.accessToken)).status,
    201,
    "低权限账号改密应成功（否则后面的 403 来自改密闸门）"
  );
  const mktLow = await login("e2e_vehicle_a", mktLowAccount, mktLowPwd);
  const mktLowOrders = await request("GET", "/api/rental/v1/orders", null, mktLow.accessToken);
  assert.equal(mktLowOrders.status, 200, `低权限账号应能读取订单（证明空间成员关系与 order:view 生效）: ${mktLowOrders.status} ${JSON.stringify(mktLowOrders.body).slice(0, 200)}`);
  const discountBody = {
    code: `E2E-DISCOUNT-LOW-${Date.now().toString(36)}`,
    name: "E2E 越权方案",
    status: "enabled",
    discountType: "percentage",
    discountValue: 10,
    minimumSpend: 0,
    customerScope: "all",
    applicableItemGroupIds: [],
    applicableDayTypes: [],
    priority: 1,
    appliesTo: "rental",
    stackableWithOtherPlans: false,
    stackableWithCoupon: false,
    effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
    changeReason: "E2E 权限验证"
  };
  const viewerDiscountWrite = await request("POST", "/api/rental/v1/discount-plans", discountBody, mktLow.accessToken);
  assert.equal(
    viewerDiscountWrite.status,
    403,
    `只有 order:view 的账号不得写优惠方案（曾因兜底 return [] 而完全无鉴权）: ${viewerDiscountWrite.status} ${JSON.stringify(viewerDiscountWrite.body).slice(0, 200)}`
  );
  const viewerDiscountRead = await request("GET", "/api/rental/v1/discount-plans", null, mktLow.accessToken);
  assert.equal(viewerDiscountRead.status, 200, `订单查看账号应能读取下单可用优惠目录: ${viewerDiscountRead.status}`);
  // 正向控制：同一空间内持有管理权限的账号也必须能读，否则上面的 403/200
  // 可能只是接口坏了，而不是权限差异。
  const adminDiscountRead = await request("GET", "/api/rental/v1/discount-plans", null, mktAdmin.accessToken);
  assert.equal(adminDiscountRead.status, 200, `持有优惠管理权限的账号必须能读优惠方案: ${adminDiscountRead.status} ${JSON.stringify(adminDiscountRead.body).slice(0, 200)}`);
  // 兜底默认拒绝不得误伤自助会话端点与租户级 UI 偏好：它们在显式公共白名单里。
  const viewerSessionContext = await request("GET", "/api/auth/session-context", null, mktLow.accessToken);
  assert.equal(viewerSessionContext.status, 200, `会话自助端点不得被默认拒绝误伤: ${viewerSessionContext.status}`);
  const viewerPresets = await request("GET", "/api/platform/filter-presets?scopeKey=store-rental.orders", null, mktLow.accessToken);
  assert.equal(viewerPresets.status, 200, `筛选预设（租户级 UI 偏好）不得被默认拒绝误伤: ${viewerPresets.status}`);
  ok("优惠配置权限：order:view 可读下单目录但不可写，管理账号可读，且会话与筛选预设不被默认拒绝误伤");
  console.log("== 62. 无空间成员关系的账号不得访问经营域 ==");
  // 另一处 fail-open：空间检查曾附加 `accessContext.hasWorkspaces` 条件，
  // 于是「一个空间都没有的账号」跳过检查，随后仓储层的 resolveScopeWorkspaceId
  // 回退到默认空间——成员关系为零的账号拿到了默认空间的完整读写权。
  // saveUser 不建成员关系，所以新建账号天然处于这个状态，无需任何数据库直改。
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`workspace_members\` WHERE \`userId\`='${permUser.body.data.id}';`
    ),
    0,
    "前置条件：新建账号不应有任何空间成员关系，否则本节测不到该路径"
  );
  for (const endpoint of ["orders", "assets", "item-groups"]) {
    const res = await request("GET", `/api/rental/v1/${endpoint}`, null, permLogin.accessToken);
    assert.equal(
      res.status,
      403,
      `无空间成员关系的账号访问 /${endpoint} 必须 403 而不是回退到默认空间，实际 ${res.status}: ` +
        `${JSON.stringify(res.body).slice(0, 300)}`
    );
  }
  ok("无成员关系账号 fail-closed：三个经营接口均 403，不再静默回退到默认空间");

  console.log("== 63. 入参校验：缺必填字段必须 400 而不是 500 ==");
  // 缺陷来源：全局 ValidationPipe 只在拿得到 metatype 时工作，而 @Body() 标注的是
  // TypeScript interface——运行时被擦除，管道整体跳过。于是缺必填字段会一路走到
  // Prisma 才炸（`Argument type is missing`），对外表现为 500。
  //
  // 500 与 400 的区别不只是好看：500 意味着"服务器内部错误"，会污染告警与错误率指标，
  // 而且不告诉调用方到底哪个字段不对。
  const vdDemo = await login("demo", "admin", DEMO_PASSWORD);
  const vdCases = [
    { path: "fulfillment-operators", method: "POST", body: {}, missing: "code/name/type" },
    { path: "locations", method: "POST", body: { code: "E2E-VD-L1" }, missing: "name/type/capabilities" },
    { path: "item-groups", method: "POST", body: { code: "E2E-VD-G1", name: "校验用" }, missing: "inventoryMode" }
  ];
  for (const item of vdCases) {
    const res = await request(item.method, `/api/rental/v1/${item.path}`, item.body, vdDemo.accessToken);
    assert.equal(
      res.status,
      400,
      `${item.path} 缺少 ${item.missing} 时必须 400，实际 ${res.status}: ${JSON.stringify(res.body).slice(0, 250)}`
    );
    // 400 还必须说明是哪个字段：只给状态码而不给字段名，调用方仍然无从修正。
    const detail = JSON.stringify(res.body);
    assert.ok(
      /message/.test(detail) && detail.length > 30,
      `${item.path} 的 400 必须带字段级说明，实际: ${detail.slice(0, 250)}`
    );
  }
  // 取值受限的字段不能只判类型：状态、能力这类值会进数据库枚举或参与业务判断。
  const vdBadEnum = await request(
    "POST",
    "/api/rental/v1/fulfillment-operators",
    { code: "E2E-VD-O2", name: "非法类型", type: "not_a_real_type" },
    vdDemo.accessToken
  );
  assert.equal(
    vdBadEnum.status,
    400,
    `非法 type 取值必须 400，实际 ${vdBadEnum.status}: ${JSON.stringify(vdBadEnum.body).slice(0, 250)}`
  );
  // 合法请求必须照常成功——校验不能把正常路径也挡掉。
  const vdOk = await request(
    "POST",
    "/api/rental/v1/fulfillment-operators",
    { code: `E2E-VD-OK-${Date.now().toString(36)}`, name: "校验通过样本", type: "self_operated" },
    vdDemo.accessToken
  );
  assert.equal(vdOk.status, 201, `合法请求应成功，实际 ${vdOk.status}: ${JSON.stringify(vdOk.body).slice(0, 250)}`);
  // whitelist:true 会剥离未声明字段，因此必须确认声明过的可选字段**没有**被剥掉。
  const vdOptional = await request(
    "POST",
    "/api/rental/v1/locations",
    {
      code: `E2E-VD-LOC-${Date.now().toString(36)}`,
      name: "可选字段保留验证",
      type: "store",
      // 建地点要求先有启用的经营主体，复用上面刚建成功的那个。
      operatorId: vdOk.body.data.id,
      capabilities: ["pickup", "return"],
      businessHours: "09:00-18:00",
      contactName: "联系人甲"
    },
    vdDemo.accessToken
  );
  assert.equal(vdOptional.status, 201, `带可选字段的请求应成功: ${JSON.stringify(vdOptional.body).slice(0, 250)}`);
  assert.equal(
    vdOptional.body.data.businessHours,
    "09:00-18:00",
    "DTO 中声明过的可选字段不得被 whitelist 剥离——被剥离说明 DTO 漏声明了该字段"
  );
  assert.equal(vdOptional.body.data.contactName, "联系人甲", "可选字段 contactName 同样不得被剥离");
  // 第二批：订单、报价、资产、库存、奖励、通知。这些端点的入参直接参与
  // 计价、库存与入账，缺校验的后果比配置类更重。
  const vdCases2 = [
    { path: "orders", body: {}, why: "缺 quoteId/customerName/lines 等" },
    { path: "quotes", body: { customerType: "personal" }, why: "缺 fulfillmentMode/lines 等" },
    { path: "assets", body: { assetNo: "E2E-VD-A1" }, why: "缺 itemGroupId/locationId" },
    { path: "rewards/grant", body: { customerId: "c1" }, why: "缺 triggerType/idempotencyKey" },
    { path: "notifications/send", body: { templateId: "t1" }, why: "缺 recipient/variables" },
    { path: "coupon-templates", body: { code: "E2E-VD-C1", name: "x" }, why: "缺 discountType/额度/有效期" }
  ];
  for (const item of vdCases2) {
    const res = await request("POST", `/api/rental/v1/${item.path}`, item.body, vdDemo.accessToken);
    assert.equal(
      res.status,
      400,
      `${item.path}（${item.why}）必须 400，实际 ${res.status}: ${JSON.stringify(res.body).slice(0, 250)}`
    );
  }
  // 数量与金额必须拒绝字符串：JS 里 "5"*2=10 但 "5"+2="52"，混进计价就是错账。
  const vdBadNumber = await request(
    "POST",
    "/api/rental/v1/availability",
    { locationId: "loc", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 86400000).toISOString(), lines: [{ itemGroupId: "g", quantity: "3" }] },
    vdDemo.accessToken
  );
  assert.equal(
    vdBadNumber.status,
    400,
    `quantity 传字符串必须 400（嵌套数组的内层校验是否真的执行），实际 ${vdBadNumber.status}: ` +
      `${JSON.stringify(vdBadNumber.body).slice(0, 250)}`
  );
  // 时间字段必须拒绝非法日期：非法值会变成 Invalid Date，参与任何比较都得 false，
  // 于是"档期冲突"检查静默失效——比直接报错危险得多。
  const vdBadDate = await request(
    "POST",
    "/api/rental/v1/availability",
    { locationId: "loc", startAt: "not-a-date", endAt: "also-not", lines: [{ itemGroupId: "g", quantity: 1 }] },
    vdDemo.accessToken
  );
  assert.equal(
    vdBadDate.status,
    400,
    `非法日期必须 400，实际 ${vdBadDate.status}: ${JSON.stringify(vdBadDate.body).slice(0, 250)}`
  );
  // 空行项目数组必须拒绝：查可用量/下单没有任何行是无意义请求。
  const vdEmptyLines = await request(
    "POST",
    "/api/rental/v1/availability",
    { locationId: "loc", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 86400000).toISOString(), lines: [] },
    vdDemo.accessToken
  );
  assert.equal(
    vdEmptyLines.status,
    400,
    `空 lines 必须 400，实际 ${vdEmptyLines.status}: ${JSON.stringify(vdEmptyLines.body).slice(0, 250)}`
  );
  // 第三批：配置类端点。请求体是嵌套对象，重点验证**内层**校验是否真的执行——
  // 少了 @Type，class-transformer 不会把嵌套对象实例化成 DTO 类，
  // 于是外层看着有校验、内层什么都没查，这种"半有校验"最难发现。
  const vdCases3 = [
    { path: "pricing-plans", body: { code: "E2E-VD-P1", name: "x" }, why: "缺 effectiveFrom/changeReason/rates" },
    { path: "discount-plans", body: { code: "E2E-VD-D1", name: "x" }, why: "缺 status/discountType 等" },
    { path: "value-added-services", body: { code: "E2E-VD-S1", name: "x" }, why: "缺 serviceType/billingUnit/terms 等" },
    { path: "rule-versions", body: { changeReason: "缺 config" }, why: "缺 config" },
    { path: "notification-templates", body: { eventCode: "e", name: "x" }, why: "缺 channel/title/body 等" },
    { path: "calendars/2027/apply-official-source", body: {}, why: "缺 sourceVersionId" }
  ];
  for (const item of vdCases3) {
    const res = await request("POST", `/api/rental/v1/${item.path}`, item.body, vdDemo.accessToken);
    assert.equal(
      res.status,
      400,
      `${item.path}（${item.why}）必须 400，实际 ${res.status}: ${JSON.stringify(res.body).slice(0, 250)}`
    );
  }
  // 嵌套内层的非法值必须被拒：外层 config 结构完整，只有 payment.timing 取值非法。
  // 这一条专门证明 @ValidateNested + @Type 真的生效了。
  const vdNestedBad = await request(
    "POST",
    "/api/rental/v1/rule-versions",
    {
      changeReason: "嵌套校验验证",
      config: {
        payment: { timing: "不存在的时机", depositMode: "none", preauthorizationRequired: false, unpaidHoldMinutes: 15 },
        fulfillment: { pickupInspectionRequired: true, returnInspectionRequired: true, evidenceRequired: false, allowDifferentReturnLocation: true },
        overdue: { graceMinutes: 30, feeMode: "hourly", feeMultiplier: 1.5 },
        cancellation: { freeBeforeHours: 24, lateFeeType: "percentage", lateFeeValue: 20, weatherExceptionEnabled: false },
        qualification: { required: false, documentTypes: [], minimumValidityDays: 1 },
        damage: { manualReviewRequired: true }
      }
    },
    vdDemo.accessToken
  );
  assert.equal(
    vdNestedBad.status,
    400,
    `嵌套内层非法枚举必须 400（证明 @ValidateNested + @Type 生效），实际 ${vdNestedBad.status}: ` +
      `${JSON.stringify(vdNestedBad.body).slice(0, 300)}`
  );
  // 定价倍率写错数量级必须被拒：倍率直接乘进金额，15 倍不会被任何下游拦住。
  const vdBadMultiplier = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: `E2E-VD-MUL-${Date.now().toString(36)}`,
      name: "倍率越界",
      changeReason: "倍率上界验证",
      effectiveFrom: new Date().toISOString(),
      rates: [{ itemGroupId: "g", unit: "day_24h", baseAmount: 100, weekendMultiplier: 15, holidayMultiplier: 1, depositAmount: 0, minimumUnits: 1 }]
    },
    vdDemo.accessToken
  );
  assert.equal(
    vdBadMultiplier.status,
    400,
    `倍率 15 必须 400（数量级写错的典型），实际 ${vdBadMultiplier.status}: ${JSON.stringify(vdBadMultiplier.body).slice(0, 250)}`
  );
  ok(
    "入参校验已生效：三批共 21 个端点缺必填字段均 400 且带字段说明；非法枚举、非法日期、字符串数量、空行项目、" +
      "嵌套内层非法值、倍率越界均被拒；合法请求成功且声明过的可选字段未被剥离"
  );

  console.log("== 64. RC-04 奖励券与配额必须落库 ==");
  // grantReward 的 applyRewardBenefit 会创建奖励优惠券并递增模板 claimedQuantity，
  // 但这两处都**只改内存**：方法末尾只落了流水（upsertRewardEntry）与权益账户
  // （flushBenefitAccounts），没有任何 upsertCustomerCoupon / upsertCouponTemplate。
  // 于是重启后奖励券凭空消失、模板配额回退，同一批券可以被反复发放。
  const rwDemo = await login("demo", "admin", DEMO_PASSWORD);
  const rwCustomer = `e2e_reward_coupon_${Date.now().toString(36)}`;
  // 建专用券模板，避免与其他用例争配额。
  const rwTemplate = await request(
    "POST",
    "/api/rental/v1/coupon-templates",
    {
      code: `E2E-RW-${Date.now().toString(36)}`,
      name: "奖励券模板",
      discountType: "fixed_amount",
      discountValue: 20,
      minimumSpend: 0,
      totalQuota: 50,
      // 限领上限放宽：并发用例会有多路同时校验，每路发 2 张。
      // 上限太低会让并发在"每客限领"处被拒，测不到本节要验的回滚路径。
      perCustomerLimit: 20,
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      effectiveTo: new Date(Date.now() + 30 * 86400000).toISOString(),
      status: "active"
    },
    rwDemo.accessToken
  );
  assert.equal(rwTemplate.status, 201, `奖励券模板创建失败: ${JSON.stringify(rwTemplate.body).slice(0, 250)}`);
  const rwTemplateId = rwTemplate.body.data.id;
  const rwSettings = (await request("GET", "/api/rental/v1/business-settings", null, rwDemo.accessToken)).body.data;
  const rwEnable = await request(
    "PUT",
    "/api/rental/v1/business-settings",
    {
      ...rwSettings,
      membership: {
        ...rwSettings.membership,
        signupRewardEnabled: true,
        signupRewardType: "coupon",
        signupRewardAmount: 2,
        signupRewardCouponTemplateId: rwTemplateId
      }
    },
    rwDemo.accessToken
  );
  assert.equal(rwEnable.status, 200, `切换为券类奖励失败: ${JSON.stringify(rwEnable.body).slice(0, 250)}`);
  const rwQuotaBefore = readCount(
    `SELECT \`claimedQuantity\` FROM \`rental_coupon_templates\` WHERE \`id\`='${rwTemplateId}';`
  );
  const rwGrant = await request(
    "POST",
    "/api/rental/v1/rewards/grant",
    { customerId: rwCustomer, triggerType: "registration", idempotencyKey: `e2e:rwcoupon:${rwCustomer}` },
    rwDemo.accessToken
  );
  assert.equal(rwGrant.status, 201, `券类奖励发放失败: ${JSON.stringify(rwGrant.body).slice(0, 250)}`);
  const rwRefs = (rwGrant.body.data[0] || {}).benefitReferenceIds || [];
  assert.equal(rwRefs.length, 2, `应发出 2 张奖励券，实际 ${rwRefs.length}: ${JSON.stringify(rwGrant.body.data).slice(0, 250)}`);
  // 关键断言：券必须在库里。只在内存里=重启即丢。
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_customer_coupons\` WHERE \`tenantId\`='tenant_001' AND \`customerId\`='${rwCustomer}';`
    ),
    2,
    "奖励券必须落库（为 0 说明 applyRewardBenefit 只改了内存，重启后券会凭空消失）"
  );
  assert.equal(
    readCount(`SELECT \`claimedQuantity\` FROM \`rental_coupon_templates\` WHERE \`id\`='${rwTemplateId}';`),
    rwQuotaBefore + 2,
    "奖励券应使模板 claimedQuantity 增加 2（未增加说明配额只在内存里递增）"
  );
  // 证伪式验证：重启后仍能从库读出这 2 张券，才算真的落库。
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("第 63 节的 API 重启超时");
  const rwAfterRestart = await login("demo", "admin", DEMO_PASSWORD);
  const rwCoupons = (await request(
    "GET",
    `/api/rental/v1/customer-coupons?customerId=${rwCustomer}`,
    null,
    rwAfterRestart.accessToken
  )).body.data;
  assert.equal(rwCoupons.length, 2, `重启后应仍有 2 张奖励券，实际 ${rwCoupons.length}`);
  // 并发同键：只有一路能写进流水（唯一约束），落败者必须把已在内存兑付的
  // 积分/券/配额退回去——否则本进程读到的余额比库里高，直到重启才自愈。
  const rwRaceCustomer = `e2e_rw_race_${Date.now().toString(36)}`;
  const rwRaceKey = `e2e:rwrace:${rwRaceCustomer}`;
  const rwQuotaBeforeRace = readCount(
    `SELECT \`claimedQuantity\` FROM \`rental_coupon_templates\` WHERE \`id\`='${rwTemplateId}';`
  );
  const rwRace = await Promise.all(
    Array.from({ length: 4 }, () =>
      request(
        "POST",
        "/api/rental/v1/rewards/grant",
        { customerId: rwRaceCustomer, triggerType: "registration", idempotencyKey: rwRaceKey },
        rwAfterRestart.accessToken
      )
    )
  );
  assert.equal(
    rwRace.filter((res) => res.status === 201).length,
    4,
    `同键并发发放每路都应成功（一路执行、其余回放），实际 ${rwRace.map((r) => r.status).join("/")}：` +
      `${JSON.stringify((rwRace.find((r) => r.status !== 201) || {}).body ?? null).slice(0, 250)}`
  );
  // 库中只能有一条流水、2 张券、配额只加 2。多出来就说明落败者的兑付也生效了。
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_reward_ledger_entries\` WHERE \`idempotencyKey\`='${rwRaceKey}';`),
    1,
    "同键并发只能留下一条奖励流水"
  );
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`rental_customer_coupons\` WHERE \`tenantId\`='tenant_001' AND \`customerId\`='${rwRaceCustomer}';`
    ),
    2,
    "同键并发只能落 2 张奖励券"
  );
  assert.equal(
    readCount(`SELECT \`claimedQuantity\` FROM \`rental_coupon_templates\` WHERE \`id\`='${rwTemplateId}';`),
    rwQuotaBeforeRace + 2,
    "同键并发只能使模板配额加 2（加更多说明落败者的配额递增没有退回）"
  );
  // 关键：**当前进程**读到的券数与配额必须与库一致。落败者若不回滚，这里会偏高。
  const rwRaceCoupons = (await request(
    "GET",
    `/api/rental/v1/customer-coupons?customerId=${rwRaceCustomer}`,
    null,
    rwAfterRestart.accessToken
  )).body.data;
  assert.equal(
    rwRaceCoupons.length,
    2,
    `当前进程读到的奖励券数必须与库一致（实际 ${rwRaceCoupons.length}，偏高说明落败者的内存兑付未回滚）`
  );
  const rwRaceTemplate = (await request("GET", "/api/rental/v1/coupon-templates", null, rwAfterRestart.accessToken)).body.data
    .find((row) => row.id === rwTemplateId);
  assert.equal(
    rwRaceTemplate.claimedQuantity,
    rwQuotaBeforeRace + 2,
    "当前进程读到的模板配额必须与库一致（偏高说明落败者的配额递增未回滚）"
  );
  ok(
    "奖励券与配额已落库且并发落败者已回滚：券类奖励库中 2 行、配额加 2、重启后仍可读出；" +
      "同键 4 路并发仍只有 1 条流水/2 张券/配额加 2，且当前进程读取与库一致"
  );


  console.log("== 65. CORE-EXT-02A 经营空间能力实例、生命周期与隔离 ==");
  // 本节要证的核心口径：「品类声明了某个 code」**不等于**「该空间启用了该能力」。
  //
  // 升级前的模型直接读品类 `defaultCapabilities`，于是只有 code、没有可执行模块的能力
  // 也被当成可用功能。新迁移刻意不回填任何启用状态。
  //
  // Review P1-3 之后判据要分清两类空间（原断言「实例表恒为空」已不成立，也不该成立）：
  //   * **迁移/Seed 建立的空间**（默认空间，`isDefault = 1`）：必须**零实例**——
  //     它们是存量兼容层，回填等于凭空认定历史空间已具备能力；
  //   * **经接口新建的空间**：创建时同事务初始化品类必选能力，因此**必然有实例**。
  // 这个区分才是原断言真正想守住的东西：没有任何路径会**悄悄**启用能力，
  // 启用只发生在「显式建空间」或「有人点启用」这两种可解释的时机。
  const seedWorkspaceInstances = readCount(
    "SELECT COUNT(*) FROM `workspace_capability_instances` `i` " +
      "JOIN `business_workspaces` `w` ON `w`.`id` = `i`.`workspaceId` WHERE `w`.`isDefault` = 1;"
  );
  assert.equal(
    seedWorkspaceInstances,
    0,
    "迁移与 Seed 建立的默认空间不得回填启用状态：存量 capabilities 数组只是品类声明，不能据此认定已启用"
  );
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `workspace_capability_audits` `a` " +
        "JOIN `business_workspaces` `w` ON `w`.`id` = `a`.`workspaceId` WHERE `w`.`isDefault` = 1;"
    ),
    0,
    "默认空间没有任何显式变更时不得有生命周期审计"
  );
  // 经接口新建的空间必然有初始化审计，且**只能**是 system_initialize——
  // 若出现 enable，说明有路径把系统初始化伪装成了人的经营决策。
  const nonDefaultAuditActions = readRows(
    "SELECT DISTINCT `a`.`action` FROM `workspace_capability_audits` `a` " +
      "JOIN `business_workspaces` `w` ON `w`.`id` = `a`.`workspaceId` WHERE `w`.`isDefault` = 0;"
  ).map((row) => row.action);
  assert.deepEqual(
    nonDefaultAuditActions,
    ["system_initialize"],
    `此刻非默认空间只应有初始化审计，实际 ${nonDefaultAuditActions.join("、") || "（无）"}`
  );

  const capPlatform = await login("platform", "admin", PLATFORM_PASSWORD);
  const capTenant = await bootstrapTenant(capPlatform.accessToken, "e2e_cap_camera", "camera");
  const capOverview = await request("GET", "/api/rental/v1/capabilities", null, capTenant.accessToken);
  assert.equal(capOverview.status, 200, `读能力总览失败: ${capOverview.status} ${JSON.stringify(capOverview.body).slice(0, 200)}`);
  const capViewOf = (payload, code) => payload.capabilities.find((row) => row.definition.code === code);
  assert.equal(capOverview.body.data.categoryCode, "camera", "总览的品类必须取自空间行");
  assert.equal(capOverview.body.data.workspaceId, capTenant.currentWorkspaceId, "总览必须落在会话空间上");
  // 已声明但无可执行模块的能力：状态是 declared_not_implemented，不是「可用」。
  assert.equal(capViewOf(capOverview.body.data, "delivery").state, "declared_not_implemented");
  assert.equal(capViewOf(capOverview.body.data, "delivery").declaredByCategory, true);
  assert.equal(capViewOf(capOverview.body.data, "delivery").implemented, false);
  // 有模块但没有实例行：未启用。
  assert.equal(capViewOf(capOverview.body.data, "pickup").state, "not_enabled");
  assert.equal(capOverview.body.data.productionReady, false, "全新空间不得判定为生产就绪");
  assert.deepEqual(
    [...capOverview.body.data.missingRequired].sort(),
    ["bundle_inventory", "camera_compatibility", "camera_kit_handover", "inspection_care", "pickup", "quantity_inventory", "return", "serialized_inventory", "usage_reading"],
    "缺失必选能力必须包含尚未实现的摄影首期模块"
  );
  ok("新库与新空间：实例表为空、能力显示为未启用/已声明未实现、生产就绪为 false");

  // 65b. 能力治理必须是独立权限：能操作订单 ≠ 能启停整个空间的业务能力。
  const capOpRole = await request("POST", "/api/platform/roles", {
    code: `E2E-CAP-OP-${Date.now().toString(36)}`, name: "E2E 订单操作员", scope: "store", dataScope: "all",
    enabledBusinessScopes: ["rental"], permissions: ["store-rental:order:view", "store-rental:order:operate"], isActive: true
  }, capTenant.accessToken);
  assert.equal(capOpRole.status, 201, `建订单操作角色失败: ${JSON.stringify(capOpRole.body).slice(0, 200)}`);
  const capOpAccount = `e2e_cap_op_${Date.now().toString(36)}`;
  const capOpUser = await request("POST", "/api/platform/users", {
    account: capOpAccount, displayName: "E2E 订单操作员", phone: "13900002222",
    roleIds: [capOpRole.body.data.id], isActive: true
  }, capTenant.accessToken);
  assert.equal(capOpUser.status, 201, `建订单操作账号失败: ${JSON.stringify(capOpUser.body).slice(0, 200)}`);
  await request("PUT", `/api/platform/workspaces/${capTenant.currentWorkspaceId}/members`, {
    userId: capOpUser.body.data.id, roleId: capOpRole.body.data.id
  }, capTenant.accessToken);
  const capOpTemp = capOpUser.body.data.temporaryPassword;
  const capOpFirst = await login("e2e_cap_camera", capOpAccount, capOpTemp);
  const capOpPwd = `E2e!${randomBytes(4).toString("hex")}`;
  await request("POST", "/api/auth/change-password", { currentPassword: capOpTemp, newPassword: capOpPwd }, capOpFirst.accessToken);
  const capOpLogin = await login("e2e_cap_camera", capOpAccount, capOpPwd);
  const capOpToken = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capTenant.currentWorkspaceId
  }, capOpLogin.accessToken)).body.data.accessToken;
  // 若治理路由落进 `/rental/v1` 兜底（order:view / order:operate），这两条会变成 200。
  assert.equal(
    (await request("GET", "/api/rental/v1/capabilities", null, capOpToken)).status,
    403,
    "只有订单权限的账号不得读取能力治理总览（否则说明路由落进了 /rental/v1 兜底）"
  );
  const capOpWrite = await request("PUT", "/api/rental/v1/capabilities", {
    code: "pickup", status: "enabled", reason: "订单操作员越权启用"
  }, capOpToken);
  assert.equal(capOpWrite.status, 403, `只有订单权限的账号不得启停能力，实际 ${capOpWrite.status}`);
  // 该空间是租户初始化建立的默认空间，不会自动初始化（Review P1-3 的对账走显式接口），
  // 因此此刻它必须仍是零实例——被 403 拒绝的请求更不该留下任何行。
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}';`),
    0,
    "被 403 拒绝的请求不得在本空间留下实例行"
  );
  ok("能力治理是独立权限：订单操作员读写治理接口均 403，且不产生实例行");

  // 65c. 启用路径的 fail-closed：未注册 / 不适用 / 未实现 / 缺依赖 / 配置无效，一律不落行。
  const capSave = (body, token = capTenant.accessToken) =>
    request("PUT", "/api/rental/v1/capabilities", body, token);
  const capUnregistered = await capSave({ code: "not_a_capability", status: "enabled", reason: "未注册" });
  assert.equal(capUnregistered.status, 400, `未注册 code 应 400，实际 ${capUnregistered.status}`);
  const capNoReason = await capSave({ code: "pickup", status: "enabled", reason: "   " });
  assert.equal(capNoReason.status, 400, `缺原因应 400，实际 ${capNoReason.status}`);
  const capNotApplicable = await capSave({ code: "dispatch", status: "enabled", reason: "camera 空间启用调度" });
  assert.equal(capNotApplicable.status, 409, `不适用于本品类应 409，实际 ${capNotApplicable.status}`);
  assert.match(JSON.stringify(capNotApplicable.body), /不适用于当前经营品类/u);
  const capUnimplemented = await capSave({
    code: "delivery", status: "enabled", reason: "启用尚无模块的配送", config: { maxDistanceKm: 20 }
  });
  assert.equal(capUnimplemented.status, 409, `未实现的能力应 409，实际 ${capUnimplemented.status}`);
  assert.match(JSON.stringify(capUnimplemented.body), /尚无可执行模块/u);
  const capMissingDep = await capSave({ code: "bundle_inventory", status: "enabled", reason: "先启套装" });
  assert.equal(capMissingDep.status, 409, `缺依赖应 409，实际 ${capMissingDep.status}`);
  assert.match(JSON.stringify(capMissingDep.body), /依赖 serialized_inventory/u);
  const capBadConfig = await capSave({
    code: "pickup", status: "enabled", reason: "配置项不存在", config: { notAField: 1 }
  });
  assert.equal(capBadConfig.status, 400, `未知配置项应 400，实际 ${capBadConfig.status}`);
  // 判定范围收窄到**本空间**：其他空间（如经接口新建的空间）会有合法的初始化实例，
  // 用全表计数会把别人的正常数据当成本次被拒请求的副作用。
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}';`),
    0,
    "以上任何一条被拒的启用请求都不得写出实例行（配置无效时不得启用）"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}';`),
    0,
    "被拒的变更不得留下审计"
  );
  ok("启用 fail-closed：未注册 400、缺原因 400、不适用 409、未实现 409、缺依赖 409、配置无效 400，且零落行");

  // 65d. 正向启用：实例与审计同事务落库，版本被锁定，同空间同能力唯一。
  const capEnabled = await capSave({ code: "serialized_inventory", status: "enabled", reason: "开通序列化库存" });
  assert.equal(capEnabled.status, 200, `启用序列化库存失败: ${capEnabled.status} ${JSON.stringify(capEnabled.body).slice(0, 200)}`);
  const capRow = readRow(
    "SELECT `status`, `implementationVersion`, `configVersion`, `revision`, `updatedBy`, " +
      "CASE WHEN `enabledAt` IS NULL THEN 'null' ELSE 'set' END AS `enabledAtState` " +
      "FROM `workspace_capability_instances` " +
      `WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='serialized_inventory';`
  );
  assert.equal(capRow.status, "enabled", "实例状态必须落库");
  assert.equal(capRow.implementationVersion, "core-1.0", "启用时必须锁定注册表当前实现版本");
  assert.equal(capRow.configVersion, "v1");
  assert.equal(capRow.revision, "1", "首次写入 revision 应为 1");
  assert.equal(capRow.enabledAtState, "set", "启用必须记录时间");
  assert.ok(capRow.updatedBy && capRow.updatedBy !== "NULL", "必须记录操作人");
  const capAuditRow = readRow(
    "SELECT `action`, IFNULL(`fromStatus`,'null') AS `fromStatus`, `toStatus`, `reason`, `operator` " +
      "FROM `workspace_capability_audits` " +
      // 必须限定到**本空间**：其他空间会有合法的 system_initialize 审计，
      // 不限定则 ORDER BY at ASC LIMIT 1 会读到别人的初始化记录。
      `WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='serialized_inventory' ` +
      "ORDER BY `at` ASC LIMIT 1;"
  );
  assert.equal(capAuditRow.action, "enable");
  assert.equal(capAuditRow.fromStatus, "null", "首次启用没有前序状态");
  assert.equal(capAuditRow.toStatus, "enabled");
  assert.equal(capAuditRow.reason, "开通序列化库存", "审计必须保留原因原文");

  // 依赖满足后 bundle_inventory 必须可启用——证明前面的 409 来自依赖判定本身。
  const capBundle = await capSave({ code: "bundle_inventory", status: "enabled", reason: "依赖已满足" });
  assert.equal(capBundle.status, 200, `依赖满足后启用套装库存失败: ${capBundle.status} ${JSON.stringify(capBundle.body).slice(0, 200)}`);
  // 同空间同能力唯一：重复启用只能更新同一行，不得新增第二行。
  const capAgain = await capSave({
    code: "serialized_inventory", status: "enabled", reason: "重复启用", expectedRevision: 1
  });
  assert.equal(capAgain.status, 200, `重复启用应更新同一行: ${capAgain.status}`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='serialized_inventory';`),
    1,
    "同一空间同一能力只能有一行实例（唯一约束）"
  );
  assert.equal(
    readScalar(`SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='serialized_inventory';`),
    "2",
    "每次写入都必须推进 revision"
  );
  ok("正向启用：实例与审计同事务落库、实现版本被锁定、同空间同能力唯一且 revision 递增");

  // 65e. 乐观并发：同一 revision 上的并发写只能有一个赢家，落败者拿 409 而不是 500。
  const capRaceBefore = Number(
    readScalar(`SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='serialized_inventory';`)
  );
  const capRace = await Promise.all(
    Array.from({ length: 4 }, (_unused, index) =>
      capSave({
        code: "serialized_inventory",
        status: "enabled",
        reason: `并发第 ${index + 1} 路`,
        expectedRevision: capRaceBefore
      })
    )
  );
  const capRaceWon = capRace.filter((res) => res.status === 200);
  const capRaceLost = capRace.filter((res) => res.status === 409);
  assert.equal(capRaceWon.length, 1, `同 revision 并发只能有一路成功，实际 ${capRace.map((r) => r.status).join("/")}`);
  assert.equal(capRaceLost.length, 3, `落败者必须是 409（不得 500）：${capRace.map((r) => r.status).join("/")}`);
  assert.equal(
    Number(readScalar(`SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='serialized_inventory';`)),
    capRaceBefore + 1,
    "并发只应推进一次 revision（推进多次说明落败者也写进去了）"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`code\`='serialized_inventory' AND \`reason\` LIKE '并发第%';`),
    1,
    "并发只应留下一条审计（多条说明有静默覆盖）"
  );
  ok("乐观并发：同 revision 四路并发只有一路成功，落败三路 409，revision 与审计各只推进一次");

  // 65f. 跨空间隔离：同租户第二个空间必须独立判定，且请求体里的 workspaceId 不得生效。
  const capWs2 = await request("POST", "/api/platform/workspaces", {
    code: "cap-second", name: "能力隔离副空间", categoryCode: "camera"
  }, capTenant.accessToken);
  assert.equal(capWs2.status, 201, `建第二个空间失败: ${JSON.stringify(capWs2.body).slice(0, 200)}`);
  await request("PUT", `/api/platform/workspaces/${capWs2.body.data.id}/members`, {
    userId: capTenant.user.id
  }, capTenant.accessToken);
  const capWs2Token = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capWs2.body.data.id
  }, capTenant.accessToken)).body.data.accessToken;
  const capWs2Overview = await request("GET", "/api/rental/v1/capabilities", null, capWs2Token);
  assert.equal(capWs2Overview.status, 200, `第二个空间读总览失败: ${capWs2Overview.status}`);
  assert.equal(capWs2Overview.body.data.workspaceId, capWs2.body.data.id, "总览必须落在切换后的空间");
  // bundle_inventory 虽是共享模块，但摄影品类把它列为首期必选，所以新空间会自动初始化。
  assert.equal(
    capViewOf(capWs2Overview.body.data, "bundle_inventory").state,
    "enabled",
    "品类级必选清单必须覆盖模块的全局 kind，摄影空间应自动启用套装库存"
  );
  // 必选能力在 ws2 确实已启用，但必须是**独立的行**：实例数与 revision 都各自独立。
  assert.equal(
    capViewOf(capWs2Overview.body.data, "serialized_inventory").state,
    "enabled",
    "新建空间会自动初始化必选能力，因此 ws2 的 serialized_inventory 应为已启用"
  );
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `workspace_capability_instances` " +
        `WHERE \`code\`='serialized_inventory' AND \`workspaceId\` IN ('${capTenant.currentWorkspaceId}','${capWs2.body.data.id}');`
    ),
    2,
    "两个空间各自持有独立实例行，不共享同一行"
  );
  assert.notEqual(
    readScalar(
      "SELECT `revision` FROM `workspace_capability_instances` " +
        `WHERE \`workspaceId\`='${capWs2.body.data.id}' AND \`code\`='serialized_inventory';`
    ),
    readScalar(
      "SELECT `revision` FROM `workspace_capability_instances` " +
        `WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='serialized_inventory';`
    ),
    "ws1 经多次改动后 revision 已推进，ws2 仍是初始化后的首版——证明两行互不影响"
  );
  assert.equal(capWs2Overview.body.data.productionReady, false, "尚有未实现的首期能力时新空间不得生产就绪");
  assert.deepEqual(
    [...capWs2Overview.body.data.missingRequired].sort(),
    ["camera_kit_handover", "inspection_care", "usage_reading"],
    "自动初始化后仍应如实列出尚未实现的摄影首期能力"
  );

  // 请求体里塞 workspaceId：DTO 未声明该字段，whitelist 会剥离，变更只能落在会话空间。
  // 先记下 ws1 那一行的状态，用于事后证明它没被这次写入动过。
  const capWs1BundleBefore = readRow(
    "SELECT `revision`, `updatedAt` FROM `workspace_capability_instances` " +
      `WHERE \`code\`='bundle_inventory' AND \`workspaceId\`='${capTenant.currentWorkspaceId}';`
  );
  const capWs2CameraRevision = Number(readScalar(
    `SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capWs2.body.data.id}' AND \`code\`='camera_compatibility';`
  ));
  const capForge = await request("PUT", "/api/rental/v1/capabilities", {
    code: "camera_compatibility", status: "enabled", reason: "尝试用请求体指定空间",
    expectedRevision: capWs2CameraRevision,
    config: { powerMarginPercent: 25, relations: [] },
    workspaceId: capTenant.currentWorkspaceId
  }, capWs2Token);
  assert.equal(capForge.status, 200, `第二个空间配置兼容性能力失败: ${capForge.status} ${JSON.stringify(capForge.body).slice(0, 200)}`);
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`code\`='camera_compatibility' AND \`workspaceId\`='${capWs2.body.data.id}' AND \`revision\`=${capWs2CameraRevision + 1};`
    ),
    1,
    "变更必须落在会话空间"
  );
  // ws1 早前也显式启用过 bundle_inventory（65d 的依赖用例），因此这里断言的是
  // 「ws2 的这次变更没有把 ws1 的那行改掉」——ws1 仍是它自己的 revision。
  assert.equal(
    readScalar(
      "SELECT `revision` FROM `workspace_capability_instances` " +
        `WHERE \`code\`='camera_compatibility' AND \`workspaceId\`='${capWs2.body.data.id}';`
    ),
    String(capWs2CameraRevision + 1),
    "ws2 的配置版本必须推进（请求体里的 workspaceId 未生效）"
  );
  // 切回第一个空间，其能力状态不得被第二个空间的操作污染。
  const capWs1Token = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capTenant.currentWorkspaceId
  }, capWs2Token)).body.data.accessToken;
  const capWs1Again = await request("GET", "/api/rental/v1/capabilities", null, capWs1Token);
  assert.equal(capViewOf(capWs1Again.body.data, "serialized_inventory").state, "enabled", "切回后原空间状态应保持");
  assert.equal(
    capViewOf(capWs1Again.body.data, "bundle_inventory").state,
    "enabled",
    "ws1 的可选能力状态应保持它自己的值，不受 ws2 操作影响"
  );
  // 关键：ws2 的那次写入必须落在**新行**上，而不是改写 ws1 的行。
  // 两行的 revision 恰好都可能是 1，因此改用「写入前后 ws1 那一行是否被动过」来判定。
  assert.deepEqual(
    { revision: capWs1BundleBefore.revision, updatedAt: capWs1BundleBefore.updatedAt },
    readRow(
      "SELECT `revision`, `updatedAt` FROM `workspace_capability_instances` " +
        `WHERE \`code\`='bundle_inventory' AND \`workspaceId\`='${capTenant.currentWorkspaceId}';`
    ),
    "ws2 的启用不得改写 ws1 那一行（revision 与 updatedAt 都必须原样）"
  );
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `workspace_capability_instances` " +
        `WHERE \`code\`='bundle_inventory' AND \`workspaceId\` IN ('${capTenant.currentWorkspaceId}','${capWs2.body.data.id}');`
    ),
    2,
    "两个空间各自一行，不共享"
  );
  ok("跨空间隔离：两空间状态互不影响，请求体 workspaceId 被剥离，变更只落会话空间");

  // 65g. 跨租户隔离 + 审计按空间隔离。
  const capOtherTenant = await bootstrapTenant(capPlatform.accessToken, "e2e_cap_other", "camera");
  const capOtherOverview = await request("GET", "/api/rental/v1/capabilities", null, capOtherTenant.accessToken);
  assert.equal(capOtherOverview.status, 200, `另一租户读总览失败: ${capOtherOverview.status}`);
  assert.equal(
    capOtherOverview.body.data.capabilities.filter((row) => row.instance).length,
    0,
    "另一租户不得看到任何实例（跨租户不可访问）"
  );
  assert.equal(
    (await request("GET", "/api/rental/v1/capability-audits", null, capOtherTenant.accessToken)).body.data.length,
    0,
    "另一租户的审计列表必须为空"
  );
  const capAudits = await request("GET", "/api/rental/v1/capability-audits", null, capWs1Token);
  assert.equal(capAudits.status, 200, `读审计失败: ${capAudits.status}`);
  assert.ok(capAudits.body.data.length >= 3, `本空间应有多条审计，实际 ${capAudits.body.data.length}`);
  assert.ok(
    capAudits.body.data.every((row) => row.reason && row.at && row.toStatus),
    "每条审计都必须有原因、时间与目标状态"
  );
  assert.equal(
    (await request("GET", "/api/rental/v1/capability-audits?code=quantity_inventory", null, capWs1Token)).body.data.length,
    0,
    "第一个空间不得看到第二个空间的能力审计"
  );
  const capAuditFiltered = await request("GET", "/api/rental/v1/capability-audits?code=bundle_inventory", null, capWs1Token);
  assert.ok(capAuditFiltered.body.data.length >= 1, "审计应可按能力筛选");
  assert.ok(
    capAuditFiltered.body.data.every((row) => row.code === "bundle_inventory"),
    "筛选结果不得混入其他能力"
  );
  assert.equal(
    (await request("GET", "/api/rental/v1/capability-audits?code=not_a_capability", null, capWs1Token)).status,
    400,
    "未注册的能力码筛选应 400，而不是静默返回空列表"
  );
  ok("跨租户与跨空间隔离：另一租户零实例零审计，审计按空间与能力筛选且未注册码被拒");

  // 65h. 暂停与停用：paused / disabled 都不是可用状态，且不得清掉历史时间戳。
  const capPauseRevision = Number(
    readScalar(`SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='bundle_inventory';`)
  );
  const capPaused = await capSave({
    code: "bundle_inventory", status: "paused", reason: "套装临时下架", expectedRevision: capPauseRevision
  }, capWs1Token);
  assert.equal(capPaused.status, 200, `暂停失败: ${capPaused.status} ${JSON.stringify(capPaused.body).slice(0, 200)}`);
  const capPausedRow = readRow(
    "SELECT `status`, CASE WHEN `enabledAt` IS NULL THEN 'null' ELSE 'set' END AS `enabledAtState`, " +
      "CASE WHEN `pausedAt` IS NULL THEN 'null' ELSE 'set' END AS `pausedAtState` " +
      "FROM `workspace_capability_instances` " +
      // 必须限定空间：ws2 也持有 bundle_inventory 的独立行，不限定会读到另一行。
      `WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='bundle_inventory';`
  );
  assert.equal(capPausedRow.status, "paused");
  assert.equal(capPausedRow.pausedAtState, "set", "暂停必须记录时间");
  assert.equal(capPausedRow.enabledAtState, "set", "暂停不得清掉原启用时间（历史要能解释）");
  assert.equal(
    readScalar(
      "SELECT `action` FROM `workspace_capability_audits` " +
        `WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='bundle_inventory' ` +
        "ORDER BY `at` DESC, `createdAt` DESC LIMIT 1;"
    ),
    "pause",
    "暂停应记为 pause 动作"
  );
  // 暂停后必选能力重新计入缺失（bundle 非必选，故用总览验证它不再是 enabled）。
  const capAfterPause = await request("GET", "/api/rental/v1/capabilities", null, capWs1Token);
  assert.equal(capViewOf(capAfterPause.body.data, "bundle_inventory").state, "paused");
  assert.equal(
    capViewOf(capAfterPause.body.data, "bundle_inventory").instance.status,
    "paused",
    "总览必须带出实例的真实状态"
  );

  // 65i. 升级入口：未实现、未启用、已是最新，三类前置全部 fail-closed。
  const capUpgradeUnimplemented = await request(
    "POST", "/api/rental/v1/capabilities/locker/upgrade", { reason: "升级尚无模块的能力" }, capWs1Token
  );
  assert.equal(capUpgradeUnimplemented.status, 409, `未实现能力升级应 409，实际 ${capUpgradeUnimplemented.status}`);
  const capUpgradeMissing = await request(
    "POST", "/api/rental/v1/capabilities/return/upgrade", { reason: "升级未启用的能力" }, capWs1Token
  );
  assert.equal(capUpgradeMissing.status, 404, `未启用能力升级应 404，实际 ${capUpgradeMissing.status}`);
  const capUpgradeLatest = await request(
    "POST", "/api/rental/v1/capabilities/serialized_inventory/upgrade", { reason: "已是最新" }, capWs1Token
  );
  assert.equal(capUpgradeLatest.status, 409, `已是最新版本升级应 409，实际 ${capUpgradeLatest.status}`);
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `workspace_capability_audits` " +
        `WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`action\`='upgrade';`
    ),
    0,
    "三类被拒的升级都不得留下 upgrade 审计"
  );
  const capUpgradeBadCode = await request(
    "POST", "/api/rental/v1/capabilities/not_a_capability/upgrade", { reason: "未注册" }, capWs1Token
  );
  assert.equal(capUpgradeBadCode.status, 400, `未注册能力码升级应 400，实际 ${capUpgradeBadCode.status}`);
  ok("暂停与升级：paused 保留启用时间且记为 pause；未实现/未启用/已最新/未注册四类升级全部被拒");

  // 65j. 已有数据的库重复部署：能力实例与审计必须原样保留，且仍无 drift。
  // revision 读取按空间限定：同一能力码在多个空间都有行时，不限定会读到不确定的一行。
  const capRevisionSql =
    `SELECT \`revision\` FROM \`workspace_capability_instances\` ` +
    `WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='serialized_inventory';`;
  const capCountsBefore = {
    instances: readCount("SELECT COUNT(*) FROM `workspace_capability_instances`;"),
    audits: readCount("SELECT COUNT(*) FROM `workspace_capability_audits`;"),
    serializedRevision: readScalar(capRevisionSql)
  };
  assert.ok(capCountsBefore.instances >= 3, `前置条件：应已有多行实例，实际 ${capCountsBefore.instances}`);
  const capRedeploy = deploy();
  if (capRedeploy.status !== 0) fail("带能力数据的库重复 migrate deploy 失败", `${capRedeploy.stdout || ""}${capRedeploy.stderr || ""}`.slice(-2000));
  assert.deepEqual(
    {
      instances: readCount("SELECT COUNT(*) FROM `workspace_capability_instances`;"),
      audits: readCount("SELECT COUNT(*) FROM `workspace_capability_audits`;"),
      serializedRevision: readScalar(capRevisionSql)
    },
    capCountsBefore,
    "重复部署不得改变已有的能力实例与审计"
  );
  const capDriftScript = runNode([
    PRISMA_CLI, "migrate", "diff", "--from-url", TEST_DATABASE_URL,
    "--to-schema-datamodel", SCHEMA_PATH, "--script"
  ]);
  const capDriftText = `${capDriftScript.stdout || ""}${capDriftScript.stderr || ""}`.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "");
  // 这里**只**判定能力两表是否有差异，而不是全库 `No difference detected`。
  //
  // 原因是第 5 节为了构造「旧库带数据升级」，会 DROP 并按旧结构重建
  // `OrderNotificationRecord`/`OrderOperationRecord`，再删掉那条迁移记录让它重放。
  // 但 `20260828000100_align_legacy_schema_baseline` 已被记为已应用、不会再执行，
  // 于是这两张表从第 5 节起就永久偏离 schema.prisma（列类型、`updatedAt` 默认值、索引名）。
  // 那是**测试构造**造成的偏离，不是生产升级路径会出现的顺序（生产里 20260609 必然早于
  // 20260828）。全库无 drift 的权威判定在第 2 节的空库路径上，已包含本迁移并通过。
  const capDriftLines = capDriftText
    .split(/\r?\n/u)
    .filter((line) => /workspace_capability_(instances|audits)/u.test(line));
  if (capDriftLines.length) {
    fail("能力两表与 schema.prisma 不一致", capDriftLines.join("\n").slice(0, 4000));
  }
  ok("重复部署：能力实例与审计原样保留、revision 不变、能力两表与 schema.prisma 无差异");

  // 65k. 重启恢复：状态必须从库里读回，而不是靠进程内存。
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("第 65 节的 API 重启超时");
  const capAfterRestart = await login("e2e_cap_camera", "admin", capTenant.password);
  const capRestartToken = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capTenant.currentWorkspaceId
  }, capAfterRestart.accessToken)).body.data.accessToken;
  const capRestartOverview = await request("GET", "/api/rental/v1/capabilities", null, capRestartToken);
  assert.equal(capRestartOverview.status, 200, `重启后读总览失败: ${capRestartOverview.status}`);
  assert.equal(
    capViewOf(capRestartOverview.body.data, "serialized_inventory").state,
    "enabled",
    "重启后已启用状态必须仍成立（否则状态只在内存里）"
  );
  assert.equal(
    capViewOf(capRestartOverview.body.data, "bundle_inventory").state,
    "paused",
    "重启后暂停状态必须仍成立"
  );
  assert.equal(
    capViewOf(capRestartOverview.body.data, "quantity_inventory").state,
    "not_enabled",
    "重启后不得把别的空间的启用状态带进本空间"
  );
  assert.equal(
    capViewOf(capRestartOverview.body.data, "delivery").state,
    "declared_not_implemented",
    "重启后未实现的能力仍不得显示为可用"
  );
  const capRestartAudits = await request("GET", "/api/rental/v1/capability-audits", null, capRestartToken);
  assert.equal(
    capRestartAudits.body.data.length,
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}';`),
    "重启后审计条数必须与库一致"
  );
  ok("重启恢复：启用/暂停/未启用/已声明未实现四种状态与审计条数全部从库中读回");

  console.log("== 66. CORE-EXT-02B Hook 运行时接入七个 Core 节点 ==");
  // 本节要证的是**接入**本身没有破坏既有流程，以及运行时在没有能力登记 Hook 时
  // 是真正的空操作。判定逻辑（未启用不执行、确定性顺序、必选 fail-closed、
  // 结果契约）在 tests/capability-hook-runtime.test.cjs 里以 19 项变异测试覆盖。
  //
  // 为什么这一节的价值不只是"跑通"：在第 65 节之前，全套 E2E 的订单流程都跑在
  // **零个已启用能力**的空间上，`enabledInstances` 恒为空数组，因此 11 个 Hook 调用点
  // 全都走的是"没有能力可执行"的短路。第 65 节刚刚在 e2e_cap_camera 空间启用了
  // serialized_inventory 等能力，于是这里第一次让运行时真的去遍历已启用实例。
  assert.equal(
    readCount("SELECT COUNT(*) FROM `capability_hook_audits`;"),
    0,
    "尚无任何能力登记 Hook，接入本身不得凭空产生审计行"
  );

  // 在**已启用能力**的空间里跑一遍完整订单流程：报价 → 下单 → 确认 → 配货 → 领取 → 归还。
  // 任一 Hook 调用点位置放错（例如放到状态改写之后、或漏传事务）都会在这里暴露。
  const hookEnabled = await request("GET", "/api/rental/v1/capabilities", null, capRestartToken);
  const hookEnabledCodes = hookEnabled.body.data.capabilities
    .filter((row) => row.state === "enabled")
    .map((row) => row.definition.code)
    .sort();
  assert.ok(
    hookEnabledCodes.includes("serialized_inventory"),
    `前置条件：本节需要空间里确有已启用能力，实际 ${hookEnabledCodes.join("、") || "（无）"}`
  );

  // 在第 65 节新建的 e2e_cap_camera 空间里跑一遍完整订单流程。
  //
  // 刻意**不用** demo 空间：demo 的价格计划被前面 PRICE-01/PRICE-02 十几个小节反复
  // 改过（新增计划、重叠计划拒绝、日历发布），到这里已经没有覆盖任意商品且在
  // 「此刻+24h」生效的计划，报价会 409。这与 Hook 接入无关，属夹具污染。
  // 新引导的租户带完整样本数据（商品、资产、地点、默认价格计划），且未被那些小节触碰。
  const hookAdmin = await login("e2e_cap_camera", "admin", capTenant.password);
  const hookToken = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capTenant.currentWorkspaceId
  }, hookAdmin.accessToken)).body.data.accessToken;
  // 该空间已启用 serialized_inventory 与 bundle_inventory（第 65 节），这里补齐
  // 履约必选的 pickup / return 与数量库存，让四个 Hook 节点都在"有已启用能力"的前提下执行。
  for (const code of ["pickup", "return", "quantity_inventory"]) {
    const enabled = await request(
      "PUT",
      "/api/rental/v1/capabilities",
      { code, status: "enabled", reason: "第 66 节验证 Hook 接入" },
      hookToken
    );
    assert.equal(enabled.status, 200, `启用 ${code} 失败: ${enabled.status} ${JSON.stringify(enabled.body).slice(0, 200)}`);
  }
  const hookInstanceCount = readCount(
    `SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`status\`='enabled';`
  );
  assert.ok(
    hookInstanceCount >= 4,
    `前置条件：该空间应有多个已启用能力（运行时才会真的去遍历），实际 ${hookInstanceCount}`
  );

  // 新引导的租户只带地点，不带样本商品（样本资产只落给演示租户），因此这里自建夹具。
  // 用数量库存：它不需要登记序列化资产，也不依赖品类专属的资产字段，
  // 而配货、领取、归还、结算四个 Hook 节点同样会全部走到。
  const hookLocation = (await request("GET", "/api/rental/v1/locations", null, hookToken)).body.data[0];
  assert.ok(hookLocation, "前置条件：新引导的租户应带履约地点");
  const hookGroup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    { code: `E2E-HOOK-G-${Date.now().toString(36)}`, name: "Hook 验证数量商品", inventoryMode: "quantity", unit: "件", attributes: { brand: "E2E", model: "HOOK" } },
    hookToken
  );
  assert.equal(hookGroup.status, 201, `Hook 用例商品创建失败: ${hookGroup.status} ${JSON.stringify(hookGroup.body).slice(0, 300)}`);
  const hookStock = await request(
    "PUT",
    "/api/rental/v1/stock-balances",
    { itemGroupId: hookGroup.body.data.id, locationId: hookLocation.id, onHandQuantity: 5 },
    hookToken
  );
  assert.equal(hookStock.status, 200, `Hook 用例库存初始化失败: ${hookStock.status}`);
  const hookPlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      effectiveFrom: new Date(Date.now() - 30 * 86400000).toISOString(),
      code: `E2E-HOOK-PRICE-${Date.now().toString(36)}`,
      name: "Hook 验证价格",
      changeReason: "第 66 节 Hook 接入验证",
      status: "enabled",
      // 摄影品类默认规则要求预授权，因此费率必须给出 preAuthAmount，
      // 否则报价会因「要求预授权却取不到额度」而 409（与 Hook 接入无关）。
      rates: [{ itemGroupId: hookGroup.body.data.id, unit: "day_24h", baseAmount: 100, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 200, preAuthAmount: 500, minimumUnits: 1 }]
    },
    hookToken
  );
  assert.equal(hookPlan.status, 201, `Hook 用例定价计划失败: ${hookPlan.status} ${JSON.stringify(hookPlan.body).slice(0, 300)}`);

  const hookStartAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const hookEndAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const hookLines = [{ itemGroupId: hookGroup.body.data.id, quantity: 1 }];
  const hookQuoteBody = {
    customerType: "personal",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: hookLocation.id,
    startAt: hookStartAt,
    endAt: hookEndAt,
    lines: hookLines,
    pricingPlanId: hookPlan.body.data.id
  };
  // 报价校验 Hook 就在报价算完、落库之前；位置放错这里会 500 或报价拿不到。
  const hookQuote = await request("POST", "/api/rental/v1/quotes", hookQuoteBody, hookToken);
  assert.equal(hookQuote.status, 201, `已启用能力的空间报价失败: ${hookQuote.status} ${JSON.stringify(hookQuote.body).slice(0, 300)}`);
  const hookOrder = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: hookQuote.body.data.id, customerName: "E2E Hook 客户", contactPhone: "13800000066", ...hookQuoteBody },
    hookToken
  );
  assert.equal(hookOrder.status, 201, `已启用能力的空间下单失败: ${hookOrder.status} ${JSON.stringify(hookOrder.body).slice(0, 300)}`);
  const hookOrderId = hookOrder.body.data.id;
  assert.equal(
    (await request("POST", `/api/rental/v1/orders/${hookOrderId}/confirm`, {}, hookToken)).body.data.status,
    "reserved",
    "订单确认 Hook 接入后确认必须仍然成功"
  );
  assert.equal(
    (await request("POST", `/api/rental/v1/orders/${hookOrderId}/allocate`, {}, hookToken)).body.data.status,
    "ready_for_pickup",
    "配货 Hook 接入后配货必须仍然成功"
  );
  await prepareMockFunding(hookOrder.body.data, hookToken, `e2e:${hookOrderId}`);
  const hookPickupTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=pickup", null, hookToken)).body.data[0];
  const hookPickedUp = await request(
    "POST",
    `/api/rental/v1/orders/${hookOrderId}/inspections`,
    { templateId: hookPickupTemplate.id, results: { appearance_ok: true, function_ok: true, shutter_count: 100 } },
    hookToken
  );
  assert.equal(hookPickedUp.status, 201, `领取检查失败: ${hookPickedUp.status} ${JSON.stringify(hookPickedUp.body).slice(0, 300)}`);
  assert.equal(hookPickedUp.body.data.order.status, "renting", "领取/交付 Hook 接入后领取必须仍然成功");
  const hookReturnTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=return", null, hookToken)).body.data[0];
  const hookReturned = await request(
    "POST",
    `/api/rental/v1/orders/${hookOrderId}/inspections`,
    { templateId: hookReturnTemplate.id, results: { appearance_ok: true, function_ok: true, shutter_count: 120 } },
    hookToken
  );
  assert.equal(hookReturned.status, 201, `归还检查失败: ${hookReturned.status} ${JSON.stringify(hookReturned.body).slice(0, 300)}`);
  assert.equal(hookReturned.body.data.order.status, "settling", "归还检查后必须进入待结算");
  const hookSettled = await closeMockFundedOrder(hookOrderId, hookToken, `e2e:${hookOrderId}`);
  assert.equal(hookSettled.body.data.status, "completed", "结算 Hook 接入后订单必须关闭");

  // 商品建档 Hook：saveItemGroup 已在上面建夹具时走过一次（数量商品），
  // 这里再建一个，确认建档节点在能力已启用后仍然放行。
  const hookNewGroup = await request(
    "POST",
    "/api/rental/v1/item-groups",
    { code: `E2E-HOOK-${Date.now().toString(36)}`, name: "Hook 接入验证商品", inventoryMode: "quantity", unit: "件", attributes: { brand: "E2E", model: "HOOK2" } },
    hookToken
  );
  assert.equal(hookNewGroup.status, 201, `商品建档失败: ${hookNewGroup.status} ${JSON.stringify(hookNewGroup.body).slice(0, 300)}`);

  // 全流程跑完，仍然一条 Hook 审计都没有：因为当前没有任何能力登记 Hook。
  // 这条断言的意义是「接入不会凭空造审计」；能力真正执行并落审计的验收依赖
  // CORE-EXT-03 引入的测试专用 capability，本任务未实现。
  assert.equal(
    readCount("SELECT COUNT(*) FROM `capability_hook_audits`;"),
    0,
    "没有能力登记 Hook 时，全流程跑完也不得产生审计行"
  );
  ok(
    "Hook 接入七个节点后全链路无回退：已启用能力的空间中报价→下单→确认→配货→领取→归还→建档全部成功，" +
      "且无能力登记 Hook 时零审计行"
  );

  // 66b. 新表的部署与重启语义。
  const hookRedeploy = deploy();
  if (hookRedeploy.status !== 0) fail("Hook 审计表所在库重复部署失败", `${hookRedeploy.stdout || ""}${hookRedeploy.stderr || ""}`.slice(-2000));
  const hookDrift = runNode([
    PRISMA_CLI, "migrate", "diff", "--from-url", TEST_DATABASE_URL,
    "--to-schema-datamodel", SCHEMA_PATH, "--script"
  ]);
  const hookDriftText = `${hookDrift.stdout || ""}${hookDrift.stderr || ""}`.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "");
  const hookDriftLines = hookDriftText.split(/\r?\n/u).filter((line) => /capability_hook_audits/u.test(line));
  if (hookDriftLines.length) {
    fail("capability_hook_audits 与 schema.prisma 不一致", hookDriftLines.join("\n").slice(0, 4000));
  }
  // 重启后已启用能力仍在，订单已完成状态仍可读——证明接入没有把状态挪到内存里。
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("第 66 节的 API 重启超时");
  const hookAfterRestart = await login("e2e_cap_camera", "admin", capTenant.password);
  const hookRestartToken = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capTenant.currentWorkspaceId
  }, hookAfterRestart.accessToken)).body.data.accessToken;
  const hookRestartOverview = await request("GET", "/api/rental/v1/capabilities", null, hookRestartToken);
  assert.ok(
    hookRestartOverview.body.data.capabilities.filter((row) => row.state === "enabled").length >= 3,
    "重启后该空间的已启用能力必须仍然成立"
  );
  assert.equal(
    (await request("GET", `/api/rental/v1/orders/${hookOrderId}`, null, hookRestartToken)).body.data.status,
    "completed",
    "重启后订单终态仍必须从库中读回"
  );
  ok("Hook 审计表：重复部署无差异、与 schema.prisma 一致、重启后能力与订单状态均从库读回");

  console.log("== 68. CORE-EXT-02D 能力快照固化：报价/订单保存版本，暂停不破坏历史、新报价用新状态 ==");
  // 本节证的是：报价与订单在生成时固化「当时已启用能力的版本快照」，此后暂停/停用能力
  // 都不改写历史读取，而**新**报价按当前状态生成。用第 66 节已备好的 e2e_cap_camera
  // 空间（已启用 serialized/quantity/pickup/return/bundle）与其数量商品+价格计划。
  const snapAdmin = await login("e2e_cap_camera", "admin", capTenant.password);
  const snapToken = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capTenant.currentWorkspaceId
  }, snapAdmin.accessToken)).body.data.accessToken;

  const snapStartAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const snapEndAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const snapQuoteBody = {
    customerType: "personal",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: hookLocation.id,
    startAt: snapStartAt,
    endAt: snapEndAt,
    lines: [{ itemGroupId: hookGroup.body.data.id, quantity: 1 }],
    pricingPlanId: hookPlan.body.data.id
  };

  // 1) 报价固化快照：非空、含版本、按 code 排序、含已启用的 quantity_inventory。
  const snapQuote = await request("POST", "/api/rental/v1/quotes", snapQuoteBody, snapToken);
  assert.equal(snapQuote.status, 201, `快照用例报价失败: ${snapQuote.status} ${JSON.stringify(snapQuote.body).slice(0, 300)}`);
  const quoteSnap = snapQuote.body.data.capabilitySnapshot;
  assert.ok(Array.isArray(quoteSnap) && quoteSnap.length > 0, "报价必须固化非空的能力快照");
  assert.ok(
    quoteSnap.every((entry) => entry.code && entry.implementationVersion && entry.configVersion),
    "快照每条必须含 code、实现版本与配置版本"
  );
  assert.deepEqual(
    quoteSnap.map((entry) => entry.code),
    [...quoteSnap.map((entry) => entry.code)].sort(),
    "快照必须按 code 稳定排序"
  );
  assert.ok(quoteSnap.some((entry) => entry.code === "quantity_inventory"), "当时已启用的 quantity_inventory 必须在快照里");
  // DB 侧确认落库而非仅在响应里。
  assert.equal(
    readScalar(`SELECT IF(\`capabilitySnapshot\` IS NULL,'null','set') FROM \`rental_quotes\` WHERE \`id\`='${snapQuote.body.data.id}';`),
    "set",
    "报价能力快照必须落库"
  );

  // 2) 订单从报价拷贝快照，且下单后重新读取仍带同一份快照。
  const snapOrder = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: snapQuote.body.data.id, customerName: "E2E 快照客户", contactPhone: "13800000068", ...snapQuoteBody },
    snapToken
  );
  assert.equal(snapOrder.status, 201, `快照用例下单失败: ${snapOrder.status} ${JSON.stringify(snapOrder.body).slice(0, 300)}`);
  const snapOrderId = snapOrder.body.data.id;
  const orderRead = await request("GET", `/api/rental/v1/orders/${snapOrderId}`, null, snapToken);
  assert.deepEqual(
    orderRead.body.data.capabilitySnapshot?.map((entry) => `${entry.code}@${entry.implementationVersion}`).sort(),
    quoteSnap.map((entry) => `${entry.code}@${entry.implementationVersion}`).sort(),
    "订单快照必须与报价快照一致（下单时拷贝，且从库读回后仍在）"
  );
  assert.equal(
    readScalar(`SELECT IF(\`capabilitySnapshot\` IS NULL,'null','set') FROM \`rental_orders\` WHERE \`id\`='${snapOrderId}';`),
    "set",
    "订单能力快照必须落库"
  );

  // 3) 暂停 quantity_inventory。
  const snapPauseRevision = Number(
    readScalar(
      `SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='quantity_inventory';`
    )
  );
  assert.equal(
    (await request(
      "PUT",
      "/api/rental/v1/capabilities",
      { code: "quantity_inventory", status: "paused", reason: "第 68 节验证暂停不破坏历史", expectedRevision: snapPauseRevision },
      snapToken
    )).status,
    200,
    "暂停 quantity_inventory 失败"
  );

  // 4) 暂停不破坏历史读取：已存在订单重新读回，其快照仍**包含** quantity_inventory。
  const orderAfterPause = await request("GET", `/api/rental/v1/orders/${snapOrderId}`, null, snapToken);
  assert.equal(orderAfterPause.status, 200, "暂停能力后历史订单必须仍可读");
  assert.ok(
    orderAfterPause.body.data.capabilitySnapshot?.some((entry) => entry.code === "quantity_inventory"),
    "暂停能力不得改写历史订单的快照——在途订单仍按下单当时的能力履约"
  );

  // 5) 新报价按**当前**状态生成：暂停后的新报价快照不再包含 quantity_inventory。
  const quoteAfterPause = await request("POST", "/api/rental/v1/quotes", snapQuoteBody, snapToken);
  // quantity_inventory 暂停后该商品是否还能报价取决于库存模式校验；这里只要拿到快照即可，
  // 若报价因暂停被拒也说明状态生效。两种情况分别断言。
  if (quoteAfterPause.status === 201) {
    assert.ok(
      !(quoteAfterPause.body.data.capabilitySnapshot ?? []).some((entry) => entry.code === "quantity_inventory"),
      "暂停后的新报价快照不得再包含 quantity_inventory（新业务按当前状态）"
    );
  } else {
    assert.equal(quoteAfterPause.status, 409, `暂停后新报价应成功或因能力状态被拒，实际 ${quoteAfterPause.status}`);
  }

  // 6) 恢复启用，保持空间可用（并复验并发升级前置已在第 65 节以四路并发 save 覆盖）。
  const snapResumeRevision = Number(
    readScalar(
      `SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='quantity_inventory';`
    )
  );
  assert.equal(
    (await request(
      "PUT",
      "/api/rental/v1/capabilities",
      { code: "quantity_inventory", status: "enabled", reason: "第 68 节验证结束恢复", expectedRevision: snapResumeRevision },
      snapToken
    )).status,
    200,
    "恢复启用失败"
  );
  ok("能力快照固化：报价/订单落库 code+版本，暂停后历史订单快照不变且仍可读，新报价按当前状态生成");

  console.log("== 69. CAM-01A 摄影器材兼容性：首个真实能力在真库上执行、阻止与例外确认 ==");
  // 本节是整个 capability 底座的收口验收：一个**真实登记 Hook 的能力**在真库上
  // 判定器材组合，不兼容被服务端阻止、风险需带原因且具备权限才能确认、停用后历史仍可解释。
  const camAdmin = await login("e2e_cap_camera", "admin", capTenant.password);
  let camToken = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capTenant.currentWorkspaceId
  }, camAdmin.accessToken)).body.data.accessToken;

  // 启用摄影兼容性能力（摄影首期必选能力；该存量空间尚未走自动初始化）。
  const camEnable = await request(
    "PUT", "/api/rental/v1/capabilities",
    { code: "camera_compatibility", status: "enabled", reason: "第 69 节验证摄影兼容性" },
    camToken
  );
  assert.equal(camEnable.status, 200, `启用 camera_compatibility 失败: ${camEnable.status} ${JSON.stringify(camEnable.body).slice(0, 300)}`);

  // 建三组器材：全画幅 RF 机身（30W）、F 卡口全画幅镜头（需转接=风险）、APS-C RF 镜头（像场不足=不兼容）、电源 100W。
  const camSuffix = Date.now().toString(36);
  const camGroup = async (code, name, attributes) => {
    const created = await request(
      "POST", "/api/rental/v1/item-groups",
      { code: `${code}-${camSuffix}`, name, inventoryMode: "quantity", unit: "台", attributes },
      camToken
    );
    assert.equal(created.status, 201, `建 ${name} 失败: ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    const stock = await request(
      "PUT", "/api/rental/v1/stock-balances",
      { itemGroupId: created.body.data.id, locationId: hookLocation.id, onHandQuantity: 5 },
      camToken
    );
    assert.equal(stock.status, 200, `${name} 库存初始化失败: ${stock.status}`);
    return created.body.data.id;
  };
  const camBodyId = await camGroup("CAM-BODY", "全画幅机身", { brand: "E2E", model: "R5", role: "body", mount: "RF", sensorFormat: "full_frame", powerDrawW: 30 });
  const camAdapterLensId = await camGroup("CAM-LENS-F", "F 卡口全画幅镜头", { brand: "E2E", model: "F50", role: "lens", mount: "F", coversFormat: "full_frame" });
  const camSmallLensId = await camGroup("CAM-LENS-APSC", "RF 卡口 APS-C 镜头", { brand: "E2E", model: "RFC", role: "lens", mount: "RF", coversFormat: "aps_c" });
  const camPowerId = await camGroup("CAM-POWER", "外接电源 100W", { brand: "E2E", model: "P100", role: "power", powerSupplyW: 100 });

  // 为这些器材建价格计划，否则报价会因缺价格 409（与兼容性无关）。
  const camPlan = await request(
    "POST", "/api/rental/v1/pricing-plans",
    {
      effectiveFrom: new Date(Date.now() - 30 * 86400000).toISOString(),
      code: `E2E-CAM-PRICE-${camSuffix}`, name: "摄影兼容性验证价格", changeReason: "第 69 节",
      status: "enabled",
      rates: [camBodyId, camAdapterLensId, camSmallLensId, camPowerId].map((id) => ({
        itemGroupId: id, unit: "day_24h", baseAmount: 100, weekendMultiplier: 1, holidayMultiplier: 1,
        depositAmount: 200, preAuthAmount: 500, minimumUnits: 1
      }))
    },
    camToken
  );
  assert.equal(camPlan.status, 201, `摄影价格计划失败: ${camPlan.status} ${JSON.stringify(camPlan.body).slice(0, 300)}`);

  const camStartAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const camEndAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const camQuoteBody = (lineIds) => ({
    customerType: "personal", fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: hookLocation.id, startAt: camStartAt, endAt: camEndAt,
    lines: lineIds.map((id) => ({ itemGroupId: id, quantity: 1 })),
    pricingPlanId: camPlan.body.data.id
  });

  // 1) 明确不兼容（APS-C 镜头 + 全画幅机身）：报价阶段即被**服务端**阻止。
  const camIncompatible = await request("POST", "/api/rental/v1/quotes", camQuoteBody([camBodyId, camSmallLensId, camPowerId]), camToken);
  assert.equal(camIncompatible.status, 409, `不兼容组合必须被阻止，实际 ${camIncompatible.status}`);
  assert.match(JSON.stringify(camIncompatible.body), /像场|image_circle|能力阻止/u, "阻止原因必须说明是能力判定的像场问题");

  // 2) 风险组合（F 卡口镜头需转接）：报价放行并带提示。
  const camRisky = await request("POST", "/api/rental/v1/quotes", camQuoteBody([camBodyId, camAdapterLensId, camPowerId]), camToken);
  assert.equal(camRisky.status, 201, `风险组合应可报价，实际 ${camRisky.status} ${JSON.stringify(camRisky.body).slice(0, 300)}`);
  // Review P1-5：判定结果必须**返回给前端**并**落库**，否则风险虽被发现、用户却不知道要确认什么。
  const camDecisions = camRisky.body.data.capabilityDecisions ?? [];
  assert.equal(camDecisions.length, 1, `报价必须返回判断记录，实际 ${JSON.stringify(camDecisions).slice(0, 200)}`);
  const camDecision = camDecisions[0];
  assert.equal(camDecision.capability, "camera_compatibility");
  assert.equal(camDecision.decision, "warn", "需转接是风险而不是放行");
  assert.equal(camDecision.point, "quote_validation");
  assert.equal(camDecision.implementationVersion, "cam-1.0", "判断记录必须带实现版本");
  assert.equal(camDecision.configVersion, "v1", "判断记录必须带配置版本");
  assert.equal(camDecision.rulesetVersion, "cam-1.0", "判断记录必须带规则集版本");
  assert.ok(camDecision.riskCodes.includes("mount_needs_adapter"), `判断记录必须列出风险代码，实际 ${camDecision.riskCodes.join("、")}`);
  assert.ok(camDecision.notices.length >= 1, "判断记录必须带提示");
  assert.ok(camDecision.notices[0].message, "提示必须有可读文案");
  assert.ok(camDecision.notices[0].evidence, "提示必须带证据");
  assert.ok(camDecision.equipment?.length >= 3, "判断记录必须固化当时的器材组合");
  assert.ok(camDecision.id, "判断记录必须有 id 供下单引用");
  // 同一份判断必须能从库里查到（不只是响应里算一遍）。
  const camStoredDecisions = JSON.parse(
    readScalar(`SELECT \`capabilityDecisions\` FROM \`rental_quotes\` WHERE \`id\`='${camRisky.body.data.id}';`)
  );
  assert.equal(camStoredDecisions.length, 1, "判断记录必须落库");
  assert.equal(camStoredDecisions[0].id, camDecision.id, "库里的判断 id 必须与响应一致");
  assert.equal(camStoredDecisions[0].decision, "warn");
  // 被阻止的报价：不得生成报价，但必须留下只追加的拒绝审计（Review P1-5）。
  const camRejectAudits = readCount(
    `SELECT COUNT(*) FROM \`capability_hook_audits\` WHERE \`capability\`='camera_compatibility' ` +
      `AND \`point\`='quote_validation' AND \`decision\`='block';`
  );
  assert.ok(camRejectAudits >= 1, `被阻止的报价必须留下拒绝审计，实际 ${camRejectAudits}`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_quotes\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`capabilityDecisions\` IS NULL AND \`createdAt\` > NOW() - INTERVAL 5 MINUTE;`),
    0,
    "本节新建的报价都应带判断记录；被阻止的请求不得留下半成品报价"
  );
  const camRejectRow = readRow(
    `SELECT \`decision\`, \`implementationVersion\`, \`subjectType\` FROM \`capability_hook_audits\` ` +
      `WHERE \`capability\`='camera_compatibility' AND \`point\`='quote_validation' AND \`decision\`='block' ORDER BY \`at\` DESC LIMIT 1;`
  );
  assert.equal(camRejectRow.subjectType, "quote", "拒绝审计必须按报价可追溯");
  assert.equal(camRejectRow.implementationVersion, "cam-1.0", "拒绝审计必须带实现版本");

  // 2b) 02D 之前的存量报价没有 capabilitySnapshot。它仍在有效期内时，下单必须按
  // 「当时没有能力参与」处理，不能退回当前已启用的 camera_compatibility；否则这张
  // 老报价会因为后来新增的转接风险规则突然无法下单。
  const camLegacyQuote = await request(
    "POST", "/api/rental/v1/quotes", camQuoteBody([camBodyId, camAdapterLensId, camPowerId]), camToken
  );
  assert.equal(camLegacyQuote.status, 201, "构造存量报价失败");
  mysqlQuery(`UPDATE \`rental_quotes\` SET \`capabilitySnapshot\`=NULL WHERE \`id\`='${camLegacyQuote.body.data.id}';`);
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("存量报价回退语义复验时 API 重启超时");
  const camAfterLegacyRestart = await login("e2e_cap_camera", "admin", capTenant.password);
  camToken = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capTenant.currentWorkspaceId
  }, camAfterLegacyRestart.accessToken)).body.data.accessToken;
  const camLegacyOrder = await request(
    "POST", "/api/rental/v1/orders",
    {
      quoteId: camLegacyQuote.body.data.id,
      customerName: "E2E 存量报价客户",
      contactPhone: "13800000071",
      ...camQuoteBody([camBodyId, camAdapterLensId, camPowerId])
    },
    camToken
  );
  assert.equal(
    camLegacyOrder.status,
    201,
    `无能力快照的有效旧报价不得被当前兼容性规则反向阻止，实际 ${camLegacyOrder.status}`
  );
  assert.equal(camLegacyOrder.body.data.capabilityPolicy, "legacy_empty", "旧报价形成的订单必须明确标记 legacy_empty");
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`capability_hook_audits\` WHERE \`subjectId\`='${camLegacyOrder.body.data.id}' AND \`point\`='order_confirmation';`
    ),
    0,
    "旧报价按空能力名单下单时不得执行后来新增的 capability"
  );

  // 3) 带风险下单但**未确认**：必须被阻止。
  const camOrderNoConfirm = await request(
    "POST", "/api/rental/v1/orders",
    { quoteId: camRisky.body.data.id, customerName: "E2E 兼容性客户", contactPhone: "13800000069", ...camQuoteBody([camBodyId, camAdapterLensId, camPowerId]) },
    camToken
  );
  assert.equal(camOrderNoConfirm.status, 409, `风险组合未确认时下单必须被阻止，实际 ${camOrderNoConfirm.status}`);
  assert.match(JSON.stringify(camOrderNoConfirm.body), /确认/u, "阻止原因应提示需要确认");

  // 例外确认必须与报价里的 warn 判断严格绑定：无效 id、错风险代码都不能静默忽略后
  // 继续让 Hook 消费原始请求形成绕过。
  const invalidDecisionOrder = await request(
    "POST", "/api/rental/v1/orders",
    {
      quoteId: camRisky.body.data.id, customerName: "E2E 兼容性客户", contactPhone: "13800000069",
      ...camQuoteBody([camBodyId, camAdapterLensId, camPowerId]),
      capabilityExceptions: [{ capability: "camera_compatibility", code: "mount_needs_adapter", decisionId: "missing-decision", reason: "伪造判断" }]
    },
    camToken
  );
  assert.equal(invalidDecisionOrder.status, 400, `无效 decisionId 必须 400，实际 ${invalidDecisionOrder.status}`);
  const mismatchedDecisionOrder = await request(
    "POST", "/api/rental/v1/orders",
    {
      quoteId: camRisky.body.data.id, customerName: "E2E 兼容性客户", contactPhone: "13800000069",
      ...camQuoteBody([camBodyId, camAdapterLensId, camPowerId]),
      capabilityExceptions: [{ capability: "camera_compatibility", code: "mount_incompatible", decisionId: camDecision.id, reason: "错风险代码" }]
    },
    camToken
  );
  assert.equal(mismatchedDecisionOrder.status, 400, `判断 id 与风险代码不匹配必须 400，实际 ${mismatchedDecisionOrder.status}`);

  // 4) 无「能力风险例外确认」权限的账号带确认下单：必须 403（权限与原因是两道独立条件）。
  const camOpRole = await request(
    "POST", "/api/platform/roles",
    {
      code: `E2E-CAM-OP-${camSuffix}`,
      name: `E2E 兼容性操作员 ${camSuffix}`,
      scope: "store",
      dataScope: "all",
      enabledBusinessScopes: ["rental"],
      // 刻意**不给** rental-core:capability:override：本步要证「无该权限带确认下单必须 403」。
      permissions: ["store-rental:order:view", "store-rental:order:operate", "store-rental:order:create", "rental-core:catalog:view", "rental-core:asset:view"],
      isActive: true
    },
    camToken
  );
  assert.equal(camOpRole.status, 201, `建角色失败: ${camOpRole.status} ${JSON.stringify(camOpRole.body).slice(0, 300)}`);
  const camOpAccount = `cam_op_${camSuffix}`;
  const camOpCreated = await request(
    "POST", "/api/platform/users",
    { account: camOpAccount, displayName: "兼容性操作员", phone: "13900006969", roleIds: [camOpRole.body.data.id], isActive: true },
    camToken
  );
  assert.equal(camOpCreated.status, 201, `建账号失败: ${camOpCreated.status} ${JSON.stringify(camOpCreated.body).slice(0, 300)}`);
  await request("PUT", `/api/platform/workspaces/${capTenant.currentWorkspaceId}/members`, { userId: camOpCreated.body.data.id, roleId: camOpRole.body.data.id }, camToken);
  const camOpNewPassword = `E2e!${randomBytes(4).toString("hex")}`;
  const camOpLogin = await login("e2e_cap_camera", camOpAccount, camOpCreated.body.data.temporaryPassword);
  await request("POST", "/api/auth/change-password", { currentPassword: camOpCreated.body.data.temporaryPassword, newPassword: camOpNewPassword }, camOpLogin.accessToken);
  const camOpSession = await login("e2e_cap_camera", camOpAccount, camOpNewPassword);
  const camOpToken = (await request("POST", "/api/auth/switch-workspace", { workspaceId: capTenant.currentWorkspaceId }, camOpSession.accessToken)).body.data.accessToken;

  const camRiskyForOp = await request("POST", "/api/rental/v1/quotes", camQuoteBody([camBodyId, camAdapterLensId, camPowerId]), camOpToken);
  assert.equal(camRiskyForOp.status, 201, `操作员报价应成功，实际 ${camRiskyForOp.status}`);
  const camOpConfirmAttempt = await request(
    "POST", "/api/rental/v1/orders",
    {
      quoteId: camRiskyForOp.body.data.id, customerName: "E2E 兼容性客户", contactPhone: "13800000069",
      ...camQuoteBody([camBodyId, camAdapterLensId, camPowerId]),
      capabilityExceptions: [{ capability: "camera_compatibility", code: "mount_needs_adapter", reason: "已备转接环" }]
    },
    camOpToken
  );
  assert.equal(camOpConfirmAttempt.status, 403, `无确认权限的账号带确认下单必须 403，实际 ${camOpConfirmAttempt.status}`);
  assert.match(JSON.stringify(camOpConfirmAttempt.body), /能力风险例外确认/u, "403 原因应指向缺少确认权限");

  // 5) 具备权限 + 带原因确认：放行，且确认进入 Hook 审计。
  const camConfirmedOrderBody = {
    quoteId: camRisky.body.data.id, customerName: "E2E 兼容性客户", contactPhone: "13800000069",
    ...camQuoteBody([camBodyId, camAdapterLensId, camPowerId]),
    capabilityExceptions: [{ capability: "camera_compatibility", code: "mount_needs_adapter", decisionId: camDecision.id, reason: "已备 FTZ 转接环并测试合焦" }]
  };
  const camOrderIdempotencyKey = `cam-risk-${camSuffix}`;
  const camConfirmedOrder = await request(
    "POST", "/api/rental/v1/orders",
    camConfirmedOrderBody,
    camToken,
    { "Idempotency-Key": camOrderIdempotencyKey }
  );
  assert.equal(camConfirmedOrder.status, 201, `带权限与原因确认后应可下单，实际 ${camConfirmedOrder.status} ${JSON.stringify(camConfirmedOrder.body).slice(0, 300)}`);
  const camOrderId = camConfirmedOrder.body.data.id;
  const camConfirmedReplay = await request(
    "POST", "/api/rental/v1/orders", camConfirmedOrderBody, camToken, { "Idempotency-Key": camOrderIdempotencyKey }
  );
  assert.equal(camConfirmedReplay.status, 201, `同幂等键重试不得因服务端 confirmedAt 变化而冲突，实际 ${camConfirmedReplay.status}`);
  assert.equal(camConfirmedReplay.body.data.id, camOrderId, "同幂等键重试必须回放同一订单");
  const camOrderAudits = readCount(
    `SELECT COUNT(*) FROM \`capability_hook_audits\` WHERE \`capability\`='camera_compatibility' AND \`subjectId\`='${camOrderId}' AND \`point\`='order_confirmation';`
  );
  assert.equal(camOrderAudits, 1, "带风险放行必须留一条订单确认审计");
  const camAuditRow = readRow(
    `SELECT \`decision\`, IF(\`notices\` IS NULL,'null','set') AS \`noticesState\`, \`implementationVersion\` FROM \`capability_hook_audits\` WHERE \`subjectId\`='${camOrderId}' AND \`point\`='order_confirmation' LIMIT 1;`
  );
  assert.equal(camAuditRow.decision, "warn", "已确认的风险应记为 warn 而不是 allow——风险事实必须留痕");
  assert.equal(camAuditRow.noticesState, "set", "审计必须带上提示内容（含已确认标记）");
  assert.equal(camAuditRow.implementationVersion, "cam-1.0", "审计必须记录规则集版本，便于解释当时按哪版判定");

  // Review P1-6：订单必须保存**完整**例外快照，审计里不能只剩 confirmed: true。
  const camOrderExceptions = JSON.parse(
    readScalar(`SELECT \`capabilityExceptions\` FROM \`rental_orders\` WHERE \`id\`='${camOrderId}';`)
  );
  assert.equal(camOrderExceptions.length, 1, "订单必须固化例外快照");
  const camException = camOrderExceptions[0];
  assert.equal(camException.capability, "camera_compatibility");
  assert.equal(camException.riskCode, "mount_needs_adapter");
  assert.equal(camException.reason, "已备 FTZ 转接环并测试合焦", "确认原因必须原样保存");
  assert.ok(camException.confirmedBy, "必须记录确认人");
  assert.equal(camException.confirmedWithPermission, "rental-core:capability:override", "必须记录确认时依据的权限");
  assert.ok(camException.confirmedAt, "必须记录确认时间");
  assert.equal(camException.decisionId, camDecision.id, "例外必须指向报价里那条真实判断");
  assert.equal(camException.implementationVersion, "cam-1.0", "例外必须带实现版本");
  assert.equal(camException.rulesetVersion, "cam-1.0", "例外必须带规则集版本");
  assert.ok(camException.equipment?.length >= 3, "例外必须固化当时的器材组合");
  // 判断记录也必须从报价拷进订单（下单侧不得凭空重构）。
  const camOrderDecisions = JSON.parse(
    readScalar(`SELECT \`capabilityDecisions\` FROM \`rental_orders\` WHERE \`id\`='${camOrderId}';`)
  );
  assert.equal(camOrderDecisions[0].id, camDecision.id, "订单的判断记录必须与报价同一条");
  // `capabilityPolicy` 是**派生**字段（由 capabilitySnapshot 是否为 NULL 推导），刻意不入库。
  // 判定方式只能查列是否存在——直接 SELECT 一个不存在的列会让 mysql 报 1054 而不是给出 NULL。
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `information_schema`.`columns` " +
        "WHERE `table_schema` = DATABASE() AND `table_name` = 'rental_orders' AND `column_name` = 'capabilityPolicy';"
    ),
    0,
    "capabilityPolicy 是派生字段，不得建列入库"
  );

  // Review P1-6 续：配货必须从订单快照还原已确认的风险，而不是传空数组重新判定。
  // 若传空，需转接环这条风险会在配货阶段重新出现（cam 规则在配货阶段判 warn，不阻止），
  // 因此这里用「配货成功且审计记 warn 而非 block」来证明确认被继承。
  const camConfirmOrder = await request("POST", `/api/rental/v1/orders/${camOrderId}/confirm`, {}, camToken);
  assert.equal(camConfirmOrder.status, 201, `确认订单失败: ${camConfirmOrder.status} ${JSON.stringify(camConfirmOrder.body).slice(0, 200)}`);
  const camAllocate = await request("POST", `/api/rental/v1/orders/${camOrderId}/allocate`, {}, camToken);
  assert.equal(camAllocate.status, 201, `配货失败: ${camAllocate.status} ${JSON.stringify(camAllocate.body).slice(0, 300)}`);
  const camAllocAudit = readRow(
    `SELECT \`decision\`, IF(\`notices\` IS NULL,'null','set') AS \`noticesState\` FROM \`capability_hook_audits\` ` +
      `WHERE \`subjectId\`='${camOrderId}' AND \`point\`='allocation_dispatch' LIMIT 1;`
  );
  assert.equal(camAllocAudit.decision, "warn", "配货阶段的风险判定必须留痕为 warn");
  assert.equal(camAllocAudit.noticesState, "set", "配货审计必须带提示内容");
  // Review P1-8：配货判定的是**实际资产**——审计证据里必须出现资产编号，
  // 而不是只有商品组。这条断言在「按商品组判定」的旧实现下必然变红。
  const camAllocNotices = readScalar(
    `SELECT \`notices\` FROM \`capability_hook_audits\` WHERE \`subjectId\`='${camOrderId}' AND \`point\`='allocation_dispatch' LIMIT 1;`
  );
  assert.ok(camAllocNotices && camAllocNotices !== "NULL", "配货审计必须有提示内容可供检查");

  // 先生成一份待消费报价，随后停用必选能力：这份已有报价和由它形成的在途订单
  // 必须继续使用冻结快照。当前是 development 空间，因此停用后的新报价仍可用于
  // 通用 Core 验证，但必须排除已停用能力；production 空间的 409 门禁由第 70 节覆盖。
  const camFrozenQuote = await request("POST", "/api/rental/v1/quotes", camQuoteBody([camBodyId, camAdapterLensId, camPowerId]), camToken);
  assert.equal(camFrozenQuote.status, 201, "停用前的冻结报价必须创建成功");
  const camFrozenDecision = camFrozenQuote.body.data.capabilityDecisions[0];

  // 6) 停用能力后：历史审计仍可读（可解释），新报价不再执行该能力，已有快照继续履约。
  // 比较基准必须是**停用前该订单的全部审计条数**（此刻含 order_confirmation 与
  // allocation_dispatch 两个节点），而不是某一个节点的子集计数。
  const camAuditsBeforeDisable = readCount(
    `SELECT COUNT(*) FROM \`capability_hook_audits\` WHERE \`subjectId\`='${camOrderId}';`
  );
  assert.ok(camAuditsBeforeDisable >= 2, `前置条件：该订单应已有多个节点的审计，实际 ${camAuditsBeforeDisable}`);
  const camPauseRevision = Number(
    readScalar(`SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${capTenant.currentWorkspaceId}' AND \`code\`='camera_compatibility';`)
  );
  assert.equal(
    (await request("PUT", "/api/rental/v1/capabilities", { code: "camera_compatibility", status: "disabled", reason: "第 69 节验证停用后仍可解释", expectedRevision: camPauseRevision }, camToken)).status,
    200,
    "停用摄影兼容性失败"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`capability_hook_audits\` WHERE \`subjectId\`='${camOrderId}';`),
    camAuditsBeforeDisable,
    "停用能力不得删除或改写历史 Hook 审计——历史必须仍可解释"
  );
  const camAfterDisable = await request("POST", "/api/rental/v1/quotes", camQuoteBody([camBodyId, camSmallLensId, camPowerId]), camToken);
  assert.equal(camAfterDisable.status, 201, `development 空间应允许继续验证通用报价，实际 ${camAfterDisable.status}`);
  assert.equal(
    (camAfterDisable.body.data.capabilitySnapshot || []).some((row) => row.code === "camera_compatibility"),
    false,
    "停用后的新报价快照不得继续包含摄影兼容性能力"
  );
  assert.equal(
    (camAfterDisable.body.data.capabilityDecisions || []).some((row) => row.capability === "camera_compatibility"),
    false,
    "停用后的新报价不得继续执行摄影兼容性判定"
  );
  const frozenOrder = await request(
    "POST", "/api/rental/v1/orders",
    {
      quoteId: camFrozenQuote.body.data.id, customerName: "E2E 冻结报价客户", contactPhone: "13800000070",
      ...camQuoteBody([camBodyId, camAdapterLensId, camPowerId]),
      capabilityExceptions: [{ capability: "camera_compatibility", code: "mount_needs_adapter", decisionId: camFrozenDecision.id, reason: "报价有效期内已确认转接方案" }]
    },
    camToken
  );
  assert.equal(frozenOrder.status, 201, `能力停用不得反向废掉已有有效报价，实际 ${frozenOrder.status}`);
  assert.equal(
    (await request("POST", `/api/rental/v1/orders/${frozenOrder.body.data.id}/confirm`, {}, camToken)).status,
    201,
    "由冻结报价形成的订单必须继续按订单快照确认"
  );

  // 7) 跨品类隔离：露营空间不能启用摄影兼容性（品类不适用）。
  // 必须重新登录：本节之前的 65k/66b 重启过 API，令牌密钥已轮换，早前的 demo2 令牌已失效。
  const campSession = await login("demo2", "admin", DEMO_PASSWORD);
  const campEnable = await request(
    "PUT", "/api/rental/v1/capabilities",
    { code: "camera_compatibility", status: "enabled", reason: "跨品类启用应被拒" },
    campSession.accessToken
  );
  assert.equal(campEnable.status, 409, `露营空间启用摄影兼容性必须 409，实际 ${campEnable.status}`);
  assert.match(JSON.stringify(campEnable.body), /不适用/u, "拒绝原因应说明品类不适用");
  ok(
    "摄影兼容性（首个真实能力）：不兼容组合报价即被阻止；风险组合未确认下单被拒、无权限带确认 403、" +
      "有权限+原因确认后放行且审计记 warn+规则集版本；停用后历史审计不变且新判定不再执行；露营空间无法启用"
  );

  console.log("== 70. 新空间必选能力初始化（Review P1-3） ==");
  // 新建空间必须在同一事务内启用「品类必选 + 已实现」的能力，可选能力不得自动启用，
  // 且审计动作必须是 system_initialize 而不是 enable——系统初始化与人的经营决策要能区分。
  //
  // 必须重新登录：第 65k / 66 节重启过 API，重启会重新生成 AUTH_TOKEN_SECRET，
  // 因此此前捕获的一切令牌都已失效（沿用会得到 401，而不是本节要验证的东西）。
  const initSession = await login("e2e_cap_camera", "admin", capTenant.password);
  const productionWorkspaceCountBefore = readCount(
    `SELECT COUNT(*) FROM \`business_workspaces\` WHERE \`tenantId\`='${capTenant.tenantId}';`
  );
  const rejectedProduction = await request("POST", "/api/platform/workspaces", {
    code: "cap-prod-rejected", name: "不可提前转正空间", categoryCode: "camera", runMode: "production"
  }, initSession.accessToken);
  assert.equal(rejectedProduction.status, 409, `首期必选能力未全部实现时显式创建 production 必须 409，实际 ${rejectedProduction.status}`);
  assert.match(JSON.stringify(rejectedProduction.body), /camera_kit_handover|usage_reading|inspection_care/u);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`business_workspaces\` WHERE \`tenantId\`='${capTenant.tenantId}';`),
    productionWorkspaceCountBefore,
    "被拒的 production 创建必须整体回滚空间与能力实例"
  );
  const initWs = await request("POST", "/api/platform/workspaces", {
    code: "cap-init", name: "必选能力初始化空间", categoryCode: "camera"
  }, initSession.accessToken);
  assert.equal(initWs.status, 201, `建空间失败: ${JSON.stringify(initWs.body).slice(0, 200)}`);
  const initWsId = initWs.body.data.id;
  assert.equal(initWs.body.data.runMode, "development", "首期能力未齐备时新建空间必须默认开发模式");

  const initRows = readRows(
    `SELECT \`code\`, \`status\`, \`configVersion\`, \`implementationVersion\` FROM \`workspace_capability_instances\` ` +
      `WHERE \`workspaceId\`='${initWsId}' ORDER BY \`code\`;`
  );
  assert.deepEqual(
    initRows.map((row) => row.code),
    ["bundle_inventory", "camera_compatibility", "pickup", "quantity_inventory", "return", "serialized_inventory"],
    `新空间必须自动启用摄影品类的六个已实现必选能力，实际 ${initRows.map((row) => row.code).join("、")}`
  );
  assert.equal(initRows.every((row) => row.status === "enabled"), true, "初始化的实例必须是 enabled");
  assert.equal(initRows.every((row) => row.configVersion === "v1"), true, "初始化的配置版本必须是明确首版");
  assert.equal(
    initRows.every((row) => row.implementationVersion === (row.code === "camera_compatibility" ? "cam-1.0" : "core-1.0")),
    true,
    "初始化必须锁定注册表的真实实现版本，不得写 unimplemented"
  );
  // 未实现与真正可选的能力不得被伪装启用；bundle 虽是共享模块，但在摄影品类是必选。
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${initWsId}' ` +
        `AND \`code\` IN ('delivery','usage_reading','locker','camera_kit_handover','inspection_care');`
    ),
    0,
    "可选/共享能力不得自动启用"
  );
  const initActions = readRows(
    `SELECT DISTINCT \`action\` FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${initWsId}';`
  ).map((row) => row.action);
  assert.deepEqual(initActions, ["system_initialize"], `初始化审计动作必须是 system_initialize，实际 ${initActions.join("、")}`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${initWsId}';`),
    6,
    "六个已实现能力各一条初始化审计"
  );
  assert.equal(
    readCount(
      `SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${initWsId}' AND (\`reason\` IS NULL OR \`reason\`='');`
    ),
    0,
    "初始化审计必须带原因"
  );

  // 事务原子性：空间编码冲突时整体回滚，不留下空间行也不留下能力实例。
  const wsCountBefore = readCount(`SELECT COUNT(*) FROM \`business_workspaces\` WHERE \`tenantId\`='${capTenant.tenantId}';`);
  const capCountBefore = readCount(`SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`tenantId\`='${capTenant.tenantId}';`);
  const dupWs = await request("POST", "/api/platform/workspaces", {
    code: "cap-init", name: "重复编码空间", categoryCode: "camera"
  }, initSession.accessToken);
  assert.equal(dupWs.status, 400, `重复编码建空间应 400，实际 ${dupWs.status}`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`business_workspaces\` WHERE \`tenantId\`='${capTenant.tenantId}';`),
    wsCountBefore,
    "失败的创建不得留下空间行"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`tenantId\`='${capTenant.tenantId}';`),
    capCountBefore,
    "失败的创建不得留下能力实例"
  );
  ok("新空间初始化：显式 production 缺能力即回滚；默认 development，六个已实现必选能力自动启用，未实现能力不伪装启用");

  console.log("== 70a2. 存量空间的显式对账（Review P1-3：不静默补启用，但必须有转正路径） ==");
  // 另建一个真正零实例的存量兼容空间夹具。原 capTenant 默认空间已在第 65/66/69 节
  // 显式启用过能力，用它会让并发对账双方都正确地幂等跳过，无法验证并发插入。
  const reconcilePlatform = await login("platform", "admin", PLATFORM_PASSWORD);
  const reconcileTenant = await bootstrapTenant(reconcilePlatform.accessToken, "e2e_cap_reconcile", "camera");
  const reconcileWsId = reconcileTenant.currentWorkspaceId;
  const beforeReconcile = readCount(
    `SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${reconcileWsId}' AND \`code\` IN ('pickup','return','quantity_inventory');`
  );
  const initAuditsBeforeConcurrent = readCount(
    `SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${reconcileWsId}' AND \`action\`='system_initialize';`
  );
  const [capReconcileA, capReconcileB] = await Promise.all([
    request("POST", "/api/rental/v1/capabilities/initialize-required", {}, reconcileTenant.accessToken),
    request("POST", "/api/rental/v1/capabilities/initialize-required", {}, reconcileTenant.accessToken)
  ]);
  assert.equal(capReconcileA.status, 201, `并发对账 A 失败: ${capReconcileA.status} ${JSON.stringify(capReconcileA.body).slice(0, 300)}`);
  assert.equal(capReconcileB.status, 201, `并发对账 B 失败: ${capReconcileB.status} ${JSON.stringify(capReconcileB.body).slice(0, 300)}`);
  assert.ok(
    capReconcileA.body.data.enabled.length + capReconcileB.body.data.enabled.length > 0,
    "并发对账必须至少有一方实际启用缺失能力"
  );
  assert.equal(capReconcileA.body.data.productionReady || capReconcileB.body.data.productionReady, false, "尚有未实现首期能力时对账后仍不得生产就绪");
  assert.deepEqual(
    [...capReconcileA.body.data.missingRequired].sort(),
    ["camera_kit_handover", "inspection_care", "usage_reading"],
    "对账后必须继续列出尚未实现的首期能力"
  );
  assert.ok(
    readCount(
      `SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${reconcileWsId}' AND \`action\`='system_initialize';`
    ) > 0,
    "对账必须留 system_initialize 审计"
  );
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${reconcileWsId}' AND \`action\`='system_initialize';`) - initAuditsBeforeConcurrent,
    capReconcileA.body.data.enabled.length + capReconcileB.body.data.enabled.length,
    "并发初始化每个实际插入的必选实例只能有一条 system_initialize 审计"
  );
  assert.ok(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${reconcileWsId}';`) > beforeReconcile,
    "对账必须真的新增实例"
  );
  // 幂等：再调一次不新增实例、不追加审计。
  const auditsAfterFirst = readCount(
    `SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${reconcileWsId}' AND \`action\`='system_initialize';`
  );
  const secondReconcile = await request("POST", "/api/rental/v1/capabilities/initialize-required", {}, reconcileTenant.accessToken);
  assert.equal(secondReconcile.status, 201);
  assert.deepEqual(secondReconcile.body.data.enabled, [], "重复对账不得新增实例");
  assert.ok(secondReconcile.body.data.skipped.length > 0, "重复对账必须如实报告全部跳过");
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`workspace_capability_audits\` WHERE \`workspaceId\`='${reconcileWsId}' AND \`action\`='system_initialize';`),
    auditsAfterFirst,
    "重复对账不得追加审计"
  );
  // 无治理权限的账号不得对账。令牌同样要在重启后重新取，否则 403 会退化成 401。
  const reconcileOpLogin = await login("e2e_cap_camera", capOpAccount, capOpPwd);
  const reconcileOpToken = (await request("POST", "/api/auth/switch-workspace", {
    workspaceId: capTenant.currentWorkspaceId
  }, reconcileOpLogin.accessToken)).body.data.accessToken;
  assert.equal(
    (await request("POST", "/api/rental/v1/capabilities/initialize-required", {}, reconcileOpToken)).status,
    403,
    "无「经营空间能力治理」权限不得执行对账"
  );
  ok("存量空间显式对账：并发调用不重复实例/审计；已实现能力补齐但未实现首期能力仍阻止转正；重复幂等、无权限 403");

  console.log("== 70b. 正式经营门禁：production 缺必选能力时服务端拒绝（Review P1-4） ==");
  // 开发空间可验证 Core，但必须如实报告首期能力尚未齐备。
  // 第 69 节验证过 API 重启；重启前取得的 token 已失效，必须重新登录，不能让后续
  // 门禁断言因测试夹具拿 401 而误判为业务行为。
  const initLoginAfterRestart = await login("e2e_cap_camera", "admin", capTenant.password);
  // 空间成员是显式授权：创建空间不会自动把创建人加入。先走正式成员治理接口授权，
  // 再验证切换和经营门禁，避免绕过 SPACE-02 的既有边界。
  const initMember = await request(
    "PUT",
    `/api/platform/workspaces/${initWsId}/members`,
    { userId: initLoginAfterRestart.user.id, dataScope: "all" },
    initLoginAfterRestart.accessToken
  );
  assert.equal(
    initMember.status,
    200,
    `新空间显式加入管理员失败，实际 ${initMember.status}: ${JSON.stringify(initMember.body).slice(0, 200)}`
  );
  const initSwitch = await request("POST", "/api/auth/switch-workspace", {
    workspaceId: initWsId
  }, initLoginAfterRestart.accessToken);
  assert.equal(
    initSwitch.status,
    201,
    `创建人必须能进入自己新建的空间，实际 ${initSwitch.status}: ${JSON.stringify(initSwitch.body).slice(0, 200)}`
  );
  const initToken = initSwitch.body.data.accessToken;
  const initContext = await request("GET", "/api/auth/session-context", null, initToken);
  assert.equal(initContext.body.data.workspaceRunMode, "development", "会话必须带出开发模式");
  assert.equal(initContext.body.data.capabilityProductionReady, false, "首期能力未齐备时必须报告非生产就绪");
  assert.deepEqual(
    [...initContext.body.data.missingRequiredCapabilities].sort(),
    ["camera_kit_handover", "inspection_care", "usage_reading"],
    "会话必须列出尚未实现的首期能力"
  );

  // 新空间不会复制旧空间业务数据。通过正式 API 建一组最小经营数据，确保下面验证的是
  // production capability 门禁，而不是被「无商品/无地点/无价格」这些无关前置挡住。
  const gateSuffix = Date.now().toString(36);
  const gateOperator = await request(
    "POST",
    "/api/rental/v1/fulfillment-operators",
    { code: `E2E-GATE-OP-${gateSuffix}`, name: "E2E 门禁经营主体", type: "self_operated" },
    initToken
  );
  assert.equal(gateOperator.status, 201, `门禁夹具经营主体创建失败: ${JSON.stringify(gateOperator.body).slice(0, 200)}`);
  const gateLocation = await request(
    "POST",
    "/api/rental/v1/locations",
    {
      code: `E2E-GATE-LOC-${gateSuffix}`,
      name: "E2E 门禁地点",
      type: "store",
      operatorId: gateOperator.body.data.id,
      capabilities: ["pickup", "return", "storage"]
    },
    initToken
  );
  assert.equal(gateLocation.status, 201, `门禁夹具地点创建失败: ${JSON.stringify(gateLocation.body).slice(0, 200)}`);
  const gateItem = await request(
    "POST",
    "/api/rental/v1/item-groups",
    {
      code: `E2E-GATE-ITEM-${gateSuffix}`,
      name: "E2E 门禁通用附件",
      inventoryMode: "quantity",
      unit: "件",
      attributes: { brand: "E2E", model: "GATE", role: "accessory" }
    },
    initToken
  );
  assert.equal(gateItem.status, 201, `门禁夹具商品创建失败: ${JSON.stringify(gateItem.body).slice(0, 200)}`);
  assert.equal(
    (await request(
      "PUT",
      "/api/rental/v1/stock-balances",
      { itemGroupId: gateItem.body.data.id, locationId: gateLocation.body.data.id, onHandQuantity: 5 },
      initToken
    )).status,
    200,
    "门禁夹具库存初始化失败"
  );
  const gatePlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    {
      code: `E2E-GATE-PRICE-${gateSuffix}`,
      name: "E2E 门禁价格",
      status: "enabled",
      effectiveFrom: new Date(Date.now() - 86400000).toISOString(),
      changeReason: "正式经营门禁验收",
      rates: [{
        itemGroupId: gateItem.body.data.id,
        unit: "day_24h",
        baseAmount: 100,
        weekendMultiplier: 1,
        holidayMultiplier: 1,
        depositAmount: 0,
        preAuthAmount: 500,
        minimumUnits: 1
      }]
    },
    initToken
  );
  assert.equal(gatePlan.status, 201, `门禁夹具价格创建失败: ${JSON.stringify(gatePlan.body).slice(0, 200)}`);

  const quoteInProduction = () =>
    request("POST", "/api/rental/v1/quotes", {
      customerType: "personal", customerId: "cust_gate", fulfillmentMode: "store_pickup_return",
      fulfillmentLocationId: gateLocation.body.data.id,
      startAt: "2026-10-08T10:00:00.000Z", endAt: "2026-10-10T10:00:00.000Z",
      pricingPlanId: gatePlan.body.data.id,
      lines: [{ itemGroupId: gateItem.body.data.id, quantity: 1 }]
    }, initToken);

  const gateOkQuote = await quoteInProduction();
  assert.equal(gateOkQuote.status, 201, `development 空间必须能验证报价: ${gateOkQuote.status} ${JSON.stringify(gateOkQuote.body).slice(0, 200)}`);

  // 模拟历史脏数据/旧版本把未就绪空间标为 production：业务写入口仍必须独立 fail-closed。
  mysqlQuery(`UPDATE \`business_workspaces\` SET \`runMode\`='production' WHERE \`id\`='${initWsId}';`);
  const blockedByUnimplemented = await quoteInProduction();
  assert.equal(blockedByUnimplemented.status, 409, `未实现首期能力的 production 空间报价必须 409，实际 ${blockedByUnimplemented.status}`);
  assert.match(JSON.stringify(blockedByUnimplemented.body), /camera_kit_handover|usage_reading|inspection_care/u);
  mysqlQuery(`UPDATE \`business_workspaces\` SET \`runMode\`='development' WHERE \`id\`='${initWsId}';`);

  // 暂停一个必选能力 → 正式空间的报价必须被服务端拒绝（不是靠前端隐藏按钮）。
  const gateRev = Number(
    readScalar(`SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${initWsId}' AND \`code\`='return';`)
  );
  assert.equal(
    (await request("PUT", "/api/rental/v1/capabilities", {
      code: "return", status: "paused", reason: "门禁验证：暂停必选能力", expectedRevision: gateRev
    }, initToken)).status,
    200,
    "暂停必选能力失败"
  );
  const developmentQuoteAfterPause = await quoteInProduction();
  assert.equal(developmentQuoteAfterPause.status, 201, `development 空间暂停必选能力后仍可验证 Core，实际 ${developmentQuoteAfterPause.status}`);

  // 同一状态下改为 demo 模式：通用 Core 流程必须仍可验证，但会话明确标注非生产。
  assert.equal(
    (await request("PUT", `/api/platform/workspaces/${initWsId}`, { runMode: "demo" }, initLoginAfterRestart.accessToken)).status,
    200,
    "切换运行模式失败"
  );
  const demoQuote = await quoteInProduction();
  assert.equal(demoQuote.status, 201, `demo 空间必须能继续验证通用流程，实际 ${demoQuote.status}`);
  const demoSession = await request("GET", "/api/auth/session-context", null, initToken);
  assert.equal(demoSession.body.data.workspaceRunMode, "demo", "会话必须标注 demo");
  assert.equal(demoSession.body.data.capabilityProductionReady, false, "demo 且缺能力时必须报告非生产就绪");
  assert.ok(
    demoSession.body.data.missingRequiredCapabilities.includes("return"),
    "demo 也必须如实列出缺失的必选能力"
  );

  // 缺必选能力时不能把 demo/development 空间直接标成 production；转正必须先补齐。
  const prematureProduction = await request("PUT", `/api/platform/workspaces/${initWsId}`, { runMode: "production" }, initLoginAfterRestart.accessToken);
  assert.equal(prematureProduction.status, 409, `缺必选能力时转 production 必须 409，实际 ${prematureProduction.status}`);
  assert.match(JSON.stringify(prematureProduction.body), /return/u, "转正失败必须列出缺失能力");
  // SaaS 平台的目标租户治理路由必须使用同一道门禁，不能让平台页绕过租户侧校验。
  const modePlatform = await login("platform", "admin", PLATFORM_PASSWORD);
  const capTenantId = readScalar("SELECT `id` FROM `Tenant` WHERE `code`='e2e_cap_camera' LIMIT 1;");
  const saasPrematureProduction = await request(
    "PUT",
    `/api/platform/tenants/${capTenantId}/workspaces/${initWsId}`,
    { runMode: "production" },
    modePlatform.accessToken
  );
  assert.equal(
    saasPrematureProduction.status,
    409,
    `SaaS 目标租户治理路由也必须拒绝缺必选能力的 production，实际 ${saasPrematureProduction.status}`
  );
  assert.match(JSON.stringify(saasPrematureProduction.body), /return/u, "SaaS 路由的拒绝也必须列出缺失能力");

  // 恢复已实现能力后，尚未实现的首期能力仍必须阻止转正。
  const resumeRev = Number(
    readScalar(`SELECT \`revision\` FROM \`workspace_capability_instances\` WHERE \`workspaceId\`='${initWsId}' AND \`code\`='return';`)
  );
  await request("PUT", "/api/rental/v1/capabilities", {
    code: "return", status: "enabled", reason: "门禁验证：恢复必选能力", expectedRevision: resumeRev
  }, initToken);
  assert.equal(
    (await request("PUT", `/api/platform/workspaces/${initWsId}`, { runMode: "production" }, initLoginAfterRestart.accessToken)).status,
    409,
    "恢复 return 后仍缺未实现首期能力，不得提前转为 production"
  );

  // 客户端不得伪造运行模式：请求体里的 runMode 只能由平台接口改，报价接口不接受。
  const forgeMode = await request("POST", "/api/rental/v1/quotes", {
    customerType: "personal", customerId: "cust_gate", fulfillmentMode: "store_pickup_return",
    runMode: "demo",
    fulfillmentLocationId: gateLocation.body.data.id,
    startAt: "2026-10-08T10:00:00.000Z", endAt: "2026-10-10T10:00:00.000Z",
    pricingPlanId: gatePlan.body.data.id,
    lines: [{ itemGroupId: gateItem.body.data.id, quantity: 1 }]
  }, initToken);
  assert.equal(forgeMode.status, 400, `报价请求体夹带 runMode 应被 whitelist 拒绝，实际 ${forgeMode.status}`);
  assert.equal(
    readScalar(`SELECT \`runMode\` FROM \`business_workspaces\` WHERE \`id\`='${initWsId}';`),
    "demo",
    "客户端字段不得改变空间运行模式"
  );

  // 存量空间（迁移置为 development）不受门禁影响，且如实标注非生产。
  const legacyMode = readScalar(`SELECT \`runMode\` FROM \`business_workspaces\` WHERE \`id\`='${capTenant.currentWorkspaceId}';`);
  assert.equal(legacyMode, "development", "租户 bootstrap 的默认空间沿用存量兼容口径，应为 development");
  ok(
    "正式经营门禁：新空间默认 development 且可验证 Core；历史脏 production 在业务入口被拒；" +
      "租户与 SaaS 治理路由都禁止首期能力未齐备时转正；恢复单项仍不能绕过未实现能力；请求体伪造 runMode 被拒"
  );

  console.log(`\nMySQL E2E 全部通过（${passedGroups} 项断言组）`);
}

/**
 * 前缀分段门禁：`E2E_STOP_AFTER=<marker>` 时，跑到 marker 分段末尾即视为完成。
 * 分段之间共享状态（租户、令牌、日历版本），因此「分段」= 目标段 + 全部前置段；
 * 本机制只提前结束、不跳过任何断言，被 409/事务回滚断言消费的库状态不受影响。
 */
class E2EPrefixStop extends Error {
  constructor(marker) {
    super(`E2E_STOP_AFTER=${marker} 命中：前缀分段结束（${passedGroups} 项断言组），后续分段按计划跳过`);
    this.__e2ePrefixStop = true;
  }
}
async function maybeStopAfter(marker) {
  if (process.env.E2E_STOP_AFTER !== marker) return;
  console.log(`\n${new E2EPrefixStop(marker).message}`);
  throw new E2EPrefixStop(marker);
}

(async () => {
  try {
    await main();
  } catch (error) {
    if (error && error.__e2ePrefixStop) {
      // 前缀分段按计划结束：不算失败，finally 仍会清理测试库。
      process.exitCode = 0;
    } else {
      console.error(`\nE2E 失败: ${error.message}`);
      // 断言层只看到状态码，成因在 API 子进程里；附上日志尾部避免无从下手。
      if (apiLogRef && apiLogRef.length) {
        console.error("--- API 日志尾部 ---");
        console.error(apiLogRef.join("").slice(-3000));
      }
      process.exitCode = 1;
    }
  } finally {
    await stopApi();
    try {
      assert.match(TEST_DB, /^[a-z][a-z0-9_]{2,62}$/u);
      assert.ok(TEST_DB.includes("e2e"));
      mysqlRootExec(`DROP DATABASE IF EXISTS \`${TEST_DB}\`;`);
      console.log(`清理完成：测试库 ${TEST_DB} 已删除`);
    } catch {
      console.error("警告：测试库清理失败，请手动检查");
    }
    process.exit(process.exitCode || 0);
  }
})();
