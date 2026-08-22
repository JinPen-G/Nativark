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
  return login(tenantCode, "admin", newPassword);
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
    // 历史遗留 drift 清单（迁移产物与 schema.prisma 不一致，均早于 SPACE-01）。
    // 只允许这些表出现在差异里；任何新表进入差异都会让本节失败。
    // 这不是豁免，而是把既有欠账**显式钉住**，避免它继续掩盖新引入的 drift。
    const KNOWN_LEGACY_DRIFT = [
      "MarketingPlan",
      "MarketingPlanVersion",
      "OrderContractDocument",
      "OrderEventSnapshot",
      "OrderIdempotencyRecord",
      "OrderNotificationRecord",
      "OrderOperationLock",
      "OrderOperationRecord",
      "OrderRemarkRecord",
      "Tenant",
      "VehicleAttachmentRecord"
    ];
    const changed = [...driftSql.matchAll(/Changed the `([^`]+)` table/gu)].map((m) => m[1]);
    const added = [...driftSql.matchAll(/^\s+- (\S+)$/gmu)].map((m) => m[1]);
    const unexpected = [...new Set([...changed, ...added])].filter((name) => !KNOWN_LEGACY_DRIFT.includes(name));
    if (unexpected.length) {
      fail(
        `迁移结果与 schema.prisma 存在**新增** drift: ${unexpected.join(", ")}`,
        driftSql.slice(0, 2000)
      );
    }
    ok(
      `迁移后无新增 drift；历史遗留 drift ${changed.filter((n) => KNOWN_LEGACY_DRIFT.includes(n)).length} 张表待独立任务收口`
    );
  } else {
    ok("迁移后库结构与 schema.prisma 完全一致（无 drift）");
  }

  console.log("== 3. 二次部署幂等（已迁移库升级路径） ==");
  const countsBefore = {
    tenants: readCount("SELECT COUNT(*) FROM `Tenant`;"),
    orders: readCount("SELECT COUNT(*) FROM `StoreRentalOrder`;")
  };
  const secondDeploy = deploy();
  if (secondDeploy.status !== 0) fail("二次 migrate deploy 失败", `${secondDeploy.stdout || ""}${secondDeploy.stderr || ""}`);
  assert.deepEqual(
    { tenants: readCount("SELECT COUNT(*) FROM `Tenant`;"), orders: readCount("SELECT COUNT(*) FROM `StoreRentalOrder`;") },
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
  for (const script of ["seed.ts", "seed-report-demo.ts"]) {
    for (let round = 1; round <= 2; round += 1) {
      const result = seedRun(script);
      if (result.status !== 0) fail(`${script} 第 ${round} 次执行失败`, `${result.stdout || ""}${result.stderr || ""}`.slice(-2000));
    }
  }
  const seedCounts = {
    tenants: readCount("SELECT COUNT(*) FROM `Tenant`;"),
    users: readCount("SELECT COUNT(*) FROM `User`;"),
    orders: readCount("SELECT COUNT(*) FROM `StoreRentalOrder`;"),
    fees: readCount("SELECT COUNT(*) FROM `FeeItem`;")
  };
  assert.equal(seedCounts.tenants, 3, "Seed 后租户数");
  assert.ok(seedCounts.orders >= 29, `Seed 后订单数异常: ${seedCounts.orders}`);
  ok(`双 Seed 各执行两次，计数稳定: ${JSON.stringify(seedCounts)}`);

  console.log("== 5. 真实旧库升级：旧通知表带数据 → 数据保留式迁移 ==");
  const sampleOrder = mysqlQuery("SELECT `id`, `orderNo`, `tenantId` FROM `StoreRentalOrder` ORDER BY `createdAt` LIMIT 1;");
  const dataLine = sampleOrder.split(/\r?\n/).filter((line) => line && !/^id\torderNo\ttenantId$/u.test(line)).pop();
  const orderMatch = dataLine ? dataLine.match(/^(\S+)\t(\S+)\t(\S+)$/u) : null;
  if (!orderMatch) fail("无法取种子订单用于旧通知数据构造", sampleOrder);
  const [, sampleOrderId, sampleOrderNo, sampleTenantId] = orderMatch;
  mysqlQuery(`
    SET FOREIGN_KEY_CHECKS=0;
    DROP TABLE IF EXISTS \`OrderNotificationRecord\`;
    DROP TABLE IF EXISTS \`OrderOperationRecord\`;
    SET FOREIGN_KEY_CHECKS=1;
    CREATE TABLE \`OrderNotificationRecord\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`orderId\` VARCHAR(191) NOT NULL,
      \`scene\` VARCHAR(191) NOT NULL,
      \`channel\` VARCHAR(191) NOT NULL,
      \`target\` VARCHAR(191) NOT NULL,
      \`status\` VARCHAR(191) NOT NULL,
      \`content\` TEXT NOT NULL,
      \`idempotencyKey\` VARCHAR(191) NULL,
      \`payload\` JSON NULL,
      \`operator\` VARCHAR(191) NULL,
      \`sentAt\` DATETIME(3) NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX \`OrderNotificationRecord_orderId_scene_createdAt_idx\`(\`orderId\`, \`scene\`, \`createdAt\`),
      INDEX \`OrderNotificationRecord_orderId_idempotencyKey_idx\`(\`orderId\`, \`idempotencyKey\`),
      PRIMARY KEY (\`id\`)
    ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    ALTER TABLE \`OrderNotificationRecord\` ADD CONSTRAINT \`OrderNotificationRecord_orderId_fkey\` FOREIGN KEY (\`orderId\`) REFERENCES \`StoreRentalOrder\`(\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE;
    INSERT INTO \`OrderNotificationRecord\` (\`id\`, \`orderId\`, \`scene\`, \`channel\`, \`target\`, \`status\`, \`content\`, \`operator\`) VALUES
      ('e2e_legacy_notice_1', '${sampleOrderId}', 'payment_success', 'sms', '+852****0001', 'sent', '旧结构通知：您的订单已支付成功。', 'seed-e2e'),
      ('e2e_legacy_notice_2', '${sampleOrderId}', 'order_created', 'sms', '+852****0001', 'sent', '${"长内容验证截断映射。".repeat(60)}', 'seed-e2e');
    DELETE FROM \`_prisma_migrations\` WHERE \`migration_name\` = '20260609000100_add_order_operation_notification_records';
  `);
  const upgradeDeploy = deploy();
  if (upgradeDeploy.status !== 0) fail("旧库状态下的 migrate deploy 失败", `${upgradeDeploy.stdout || ""}${upgradeDeploy.stderr || ""}`.slice(-2000));
  assert.equal(readCount("SELECT COUNT(*) FROM `OrderNotificationRecord`;"), 2, "升级后旧通知记录必须保留");
  const upgraded = mysqlQuery(
    "SELECT `tenantId`, `orderNo`, `event`, `targetMasked`, `templateCode`, `contentSummary` FROM `OrderNotificationRecord` WHERE `id`='e2e_legacy_notice_1';"
  );
  assert.ok(upgraded.includes(sampleTenantId), `tenantId 未回填: ${upgraded}`);
  assert.ok(upgraded.includes(sampleOrderNo), `orderNo 未回填: ${upgraded}`);
  assert.ok(upgraded.includes("payment_success"), `event 未映射: ${upgraded}`);
  assert.ok(upgraded.includes("+852****0001"), `targetMasked 未映射: ${upgraded}`);
  assert.ok(upgraded.includes("LEGACY_payment_success"), `templateCode 未映射: ${upgraded}`);
  const truncated = mysqlQuery(
    "SELECT CHAR_LENGTH(`contentSummary`) AS len FROM `OrderNotificationRecord` WHERE `id`='e2e_legacy_notice_2';"
  );
  assert.match(truncated, /512/, `超长内容应按 512 截断: ${truncated}`);
  const staleColumn = mysqlRaw(`USE \`${TEST_DB}\`;\nSELECT \`scene\` FROM \`OrderNotificationRecord\` LIMIT 1;`);
  assert.notEqual(staleColumn.status, 0, "查询已移除的旧列 scene 必须失败");
  assert.match(`${staleColumn.stdout || ""}${staleColumn.stderr || ""}`, /Unknown column/u, "旧列应已移除");
  assert.equal(
    readCount("SELECT COUNT(*) FROM `_prisma_migrations` WHERE `finished_at` IS NOT NULL AND `rolled_back_at` IS NULL;"),
    EXPECTED_MIGRATIONS,
    "升级后迁移记录应恢复完整"
  );
  ok("旧通知数据经升级完整保留并正确映射（tenantId/orderNo/event/截断规则）");

  console.log("== 6. 仓储层 fail-closed（无租户身份必须拒绝） ==");
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
  const { StoreRentalRepository } = require("../apps/api/src/modules/store-rental/store-rental.repository");
  const { PrismaService } = require("../apps/api/src/modules/database/prisma.service");
  const repository = new StoreRentalRepository(new PrismaService());
  await assert.rejects(repository.listStations(), /缺少已验证的租户身份/u, "仓储层无身份时必须拒绝");
  ok("StoreRentalRepository 无请求身份时 fail-closed");

  console.log("== 7. 启动 API（MySQL 模式） ==");
  const apiLogs = startApi();
  if (!(await waitHealth())) fail("API 启动超时", apiLogs.join("").slice(-2000));
  ok(`API 已启动: ${API_BASE}`);

  console.log("== 8. 认证、品类与未授权拒绝 ==");
  const unauthorized = await request("GET", "/api/store-rental/orders");
  assert.equal(unauthorized.status, 401, "无 token 访问业务接口必须 401");
  ok("无 token 请求返回 401");
  const demo = await login("demo", "admin", DEMO_PASSWORD);
  const demo2 = await login("demo2", "admin", DEMO_PASSWORD);
  assert.equal(demo.tenant.categoryCode, "camera");
  assert.equal(demo2.tenant.categoryCode, "camping");
  ok("demo=camera / demo2=camping，品类编码为小写领域值");
  const cameraLegacy = await request("GET", "/api/store-rental/orders", null, demo.accessToken);
  assert.equal(cameraLegacy.status, 403, "camera 租户访问车辆兼容域必须 403");
  ok("品类守卫拒绝 camera 租户访问车辆域");

  console.log("== 9. Rental Core 报价→下单→履约全链路（摄影：序列化+套装） ==");
  const groups = (await request("GET", "/api/rental/v1/item-groups", null, demo.accessToken)).body.data;
  const serialized = groups.filter((group) => group.inventoryMode === "serialized");
  const cameraKit = groups.find((group) => group.code === "CAM-KIT");
  assert.ok(cameraKit, "摄影样本缺少套装商品 CAM-KIT");
  const location = (await request("GET", "/api/rental/v1/locations", null, demo.accessToken)).body.data[0];
  const startAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const endAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const lines = [...serialized.slice(0, 2).map((group) => ({ itemGroupId: group.id, quantity: 1 })), { itemGroupId: cameraKit.id, quantity: 1 }];
  const quote = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt, endAt, lines },
    demo.accessToken
  );
  assert.equal(quote.status, 201, `报价失败: ${JSON.stringify(quote.body).slice(0, 200)}`);
  assert.ok(quote.body.data.chargeLines.some((line) => line.code === "rental:CAM-KIT"), "摄影套装行应进入报价明细");
  const order = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: quote.body.data.id, customerType: "personal", customerName: "E2E隔离客户", contactPhone: "13800000002", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt, endAt, lines },
    demo.accessToken
  );
  assert.equal(order.status, 201, `下单失败: ${JSON.stringify(order.body).slice(0, 200)}`);
  const orderId = order.body.data.id;
  assert.equal(order.body.data.status, "draft");
  const assetStatus = async () => (await request("GET", "/api/rental/v1/assets", null, demo.accessToken)).body.data;
  assert.equal((await request("POST", `/api/rental/v1/orders/${orderId}/confirm`, {}, demo.accessToken)).body.data.status, "reserved");
  const allocated = (await request("POST", `/api/rental/v1/orders/${orderId}/allocate`, {}, demo.accessToken)).body.data;
  assert.equal(allocated.status, "ready_for_pickup");
  assert.ok(allocated.allocations.length >= 3, "序列化+套装组件应完成分配");
  const trackedAssetId = allocated.allocations[0].assetId;
  assert.equal((await assetStatus()).find((row) => row.id === trackedAssetId).status, "reserved", "分配后资产应为 reserved");
  const pickupTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=pickup", null, demo.accessToken)).body.data[0];
  const pickedUp = (await request("POST", `/api/rental/v1/orders/${orderId}/inspections`, { templateId: pickupTemplate.id, results: { appearance_ok: true, function_ok: true, shutter_count: 9000 } }, demo.accessToken)).body.data;
  assert.equal(pickedUp.order.status, "renting");
  assert.equal((await assetStatus()).find((row) => row.id === trackedAssetId).status, "rented", "领取后资产应为 rented");
  const returnTemplate = (await request("GET", "/api/rental/v1/inspection-templates?stage=return", null, demo.accessToken)).body.data[0];
  const returned = (await request("POST", `/api/rental/v1/orders/${orderId}/inspections`, { templateId: returnTemplate.id, results: { appearance_ok: true, function_ok: true, shutter_count: 9100 }, exceptions: [{ description: "E2E 损坏", chargeAmount: 66 }] }, demo.accessToken)).body.data;
  assert.equal(returned.order.status, "completed");
  assert.ok(returned.order.finalPayableAmount > returned.order.payableAmount, "损坏费应进入最终应付");
  assert.equal((await assetStatus()).find((row) => row.id === trackedAssetId).status, "available", "归还后资产应释放为 available");
  ok(`全链路完成 ${returned.order.orderNo}，套装+损坏费+资产状态流转正确`);

  console.log("== 10. 露营品类深度用例：数量+套装库存、缺件异常与库存还原 ==");
  const campingGroups = (await request("GET", "/api/rental/v1/item-groups", null, demo2.accessToken)).body.data;
  const tent = campingGroups.find((group) => group.code === "CAMP-TENT");
  const kit = campingGroups.find((group) => group.code === "CAMP-KIT");
  const campingLocation = (await request("GET", "/api/rental/v1/locations", null, demo2.accessToken)).body.data[0];
  assert.ok(tent && kit, `露营样本缺少数量/套装商品: ${campingGroups.map((g) => g.code).join(",")}`);
  const campingStockBefore = (await request("GET", "/api/rental/v1/stock-balances", null, demo2.accessToken)).body.data;
  const tentStockBefore = campingStockBefore.find((row) => row.itemGroupId === tent.id);
  const campingStart = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const campingEnd = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const campingLines = [
    { itemGroupId: tent.id, quantity: 2 },
    { itemGroupId: kit.id, quantity: 1 }
  ];
  const campingQuote = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: campingLocation.id, startAt: campingStart, endAt: campingEnd, lines: campingLines },
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
    { quoteId: campingQuote.body.data.id, customerType: "personal", customerName: "E2E露营客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: campingLocation.id, startAt: campingStart, endAt: campingEnd, lines: campingLines },
    demo2.accessToken
  );
  assert.equal(campingOrder.status, 201, `露营下单失败: ${JSON.stringify(campingOrder.body).slice(0, 200)}`);
  const campingOrderId = campingOrder.body.data.id;
  await request("POST", `/api/rental/v1/orders/${campingOrderId}/confirm`, {}, demo2.accessToken);
  const campingAllocated = (await request("POST", `/api/rental/v1/orders/${campingOrderId}/allocate`, {}, demo2.accessToken)).body.data;
  assert.ok(
    campingAllocated.allocations.length >= 2 && campingAllocated.allocations.every((row) => !row.assetId),
    "数量库存分配不应绑定具体资产"
  );
  const campingStockReserved = (await request("GET", "/api/rental/v1/stock-balances", null, demo2.accessToken)).body.data.find((row) => row.itemGroupId === tent.id);
  assert.equal(
    tentStockBefore.availableQuantity - campingStockReserved.availableQuantity,
    3,
    "套装展开后帐篷合并占用应为 2+1=3"
  );
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
    { templateId: campingReturnTemplate.id, results: { count_ok: false, cleanliness: "严重污损" }, exceptions: [{ description: "帐篷地钉缺失 2 枚", chargeAmount: 35 }, { description: "折叠椅严重污损", chargeAmount: 20 }] },
    demo2.accessToken
  )).body.data;
  assert.equal(campingReturned.order.status, "completed");
  assert.equal(campingReturned.order.finalPayableAmount, campingReturned.order.payableAmount + 55, "缺件与污损费用应进入最终应付");
  const campingStockAfter = (await request("GET", "/api/rental/v1/stock-balances", null, demo2.accessToken)).body.data.find((row) => row.itemGroupId === tent.id);
  assert.equal(campingStockAfter.availableQuantity, tentStockBefore.availableQuantity, "完成后数量库存应完整释放");
  const demo2Orders = (await request("GET", "/api/rental/v1/orders", null, demo2.accessToken)).body.data;
  assert.equal(demo2Orders.length, 1, "demo2 应只看到自己的露营订单");
  assert.ok(!demo2Orders.some((row) => row.id === orderId), "demo2 不得看到 demo 订单");
  ok("露营数量+套装闭环：合并占用 3、缺件污损 55 元、库存完整释放");

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
  const cancelQuote = (await request("POST", "/api/rental/v1/quotes", { customerType: "personal", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: cancelStart, endAt: cancelEnd, lines: cancelLines }, demo.accessToken)).body.data;
  const cancelOrder = await request("POST", "/api/rental/v1/orders", { quoteId: cancelQuote.id, customerType: "personal", customerName: "E2E取消客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: cancelStart, endAt: cancelEnd, lines: cancelLines }, demo.accessToken);
  assert.equal(cancelOrder.status, 201, `取消用例下单失败: ${JSON.stringify(cancelOrder.body).slice(0, 200)}`);
  const cancelOrderId = cancelOrder.body.data.id;
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
  assert.equal(cancelled.finalPayableAmount, Math.round((cancelled.payableAmount + cancellationLine.amount) * 100) / 100, "取消费应进入最终应付");
  assert.equal(await availabilityFor(), availableBefore, "取消后库存应完整释放");
  const cancelAgain = await request("POST", `/api/rental/v1/orders/${cancelOrderId}/cancel`, { reason: "重复取消" }, demo.accessToken);
  assert.equal(cancelAgain.status, 409, "已取消订单不能再次取消");
  ok("非法状态转移全部拒绝；收费窗口取消闭环（约 20% 取消费、库存完整释放）");

  console.log("== 12. 优惠方案与优惠券闭环：领取/锁定/核销/释放/预算/互斥 ==");
  const couponTemplate = await request(
    "POST",
    "/api/rental/v1/coupon-templates",
    { code: "E2E-COUPON-50", name: "E2E 满 300 减 50", discountType: "fixed_amount", discountValue: 50, minimumSpend: 300, totalQuota: 1, perCustomerLimit: 1, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: new Date(Date.now() + 30 * 86400000).toISOString(), status: "enabled" },
    demo.accessToken
  );
  assert.equal(couponTemplate.status, 201, `券模板创建失败: ${JSON.stringify(couponTemplate.body).slice(0, 200)}`);
  const couponId = couponTemplate.body.data.id;
  const claim = await request("POST", "/api/rental/v1/customer-coupons/claim", { templateId: couponId, customerId: "e2e_coupon_customer" }, demo.accessToken);
  assert.equal(claim.status, 201, `领取失败: ${JSON.stringify(claim.body).slice(0, 200)}`);
  const claimedCouponId = claim.body.data.id;
  const claimAgain = await request("POST", "/api/rental/v1/customer-coupons/claim", { templateId: couponId, customerId: "e2e_coupon_customer" }, demo.accessToken);
  assert.equal(claimAgain.status, 409, "同一客户不得超过每客限领");
  const claimSoldOut = await request("POST", "/api/rental/v1/customer-coupons/claim", { templateId: couponId, customerId: "e2e_coupon_customer_2" }, demo.accessToken);
  assert.equal(claimSoldOut.status, 409, "发行量用尽后不得再领取");
  const couponQuoteStart = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const couponQuoteEnd = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
  const couponLines = [{ itemGroupId: serialized[0].id, quantity: 2 }];
  const couponQuote = (
    await request(
      "POST",
      "/api/rental/v1/quotes",
      { customerType: "personal", customerId: "e2e_coupon_customer", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponQuoteStart, endAt: couponQuoteEnd, lines: couponLines, customerCouponId: claimedCouponId },
      demo.accessToken
    )
  ).body.data;
  const couponLine = couponQuote.chargeLines.find((line) => line.type === "coupon");
  assert.ok(couponLine && couponLine.amount === -50, `优惠券应抵扣 50: ${JSON.stringify(couponQuote.chargeLines)}`);
  const couponOrder = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: couponQuote.id, customerType: "personal", customerId: "e2e_coupon_customer", customerName: "E2E券客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponQuoteStart, endAt: couponQuoteEnd, lines: couponLines },
    demo.accessToken
  );
  assert.equal(couponOrder.status, 201, `券订单创建失败: ${JSON.stringify(couponOrder.body).slice(0, 200)}`);
  const couponOrderId = couponOrder.body.data.id;
  const couponAfterOrder = (await request("GET", "/api/rental/v1/customer-coupons?customerId=e2e_coupon_customer", null, demo.accessToken)).body.data.find((row) => row.id === claimedCouponId);
  assert.equal(couponAfterOrder.status, "locked", "下单后优惠券应锁定");
  assert.equal(couponAfterOrder.lockedOrderId, couponOrderId);
  const reuseQuoteRes = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", customerId: "e2e_coupon_customer", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponQuoteStart, endAt: couponQuoteEnd, lines: couponLines, customerCouponId: claimedCouponId },
    demo.accessToken
  );
  assert.equal(reuseQuoteRes.status, 409, "已锁定的优惠券不得再次进入报价");
  await request("POST", `/api/rental/v1/orders/${couponOrderId}/confirm`, {}, demo.accessToken);
  const couponAfterConfirm = (await request("GET", "/api/rental/v1/customer-coupons?customerId=e2e_coupon_customer", null, demo.accessToken)).body.data.find((row) => row.id === claimedCouponId);
  assert.equal(couponAfterConfirm.status, "redeemed", "确认订单后优惠券应核销");
  const releasedCouponOrder = (await request("POST", `/api/rental/v1/orders/${couponOrderId}/cancel`, { reason: "E2E 验证券释放" }, demo.accessToken)).body.data;
  assert.equal(releasedCouponOrder.status, "cancelled");
  const couponAfterCancel = (await request("GET", "/api/rental/v1/customer-coupons?customerId=e2e_coupon_customer", null, demo.accessToken)).body.data.find((row) => row.id === claimedCouponId);
  assert.equal(couponAfterCancel.status, "claimed", "取消订单后优惠券应释放回可再用");
  const template2 = await request(
    "POST",
    "/api/rental/v1/coupon-templates",
    { code: "E2E-COUPON-30", name: "E2E 满 300 减 30", discountType: "fixed_amount", discountValue: 30, minimumSpend: 300, totalQuota: 5, perCustomerLimit: 1, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: new Date(Date.now() + 30 * 86400000).toISOString(), status: "enabled" },
    demo.accessToken
  );
  assert.equal(template2.status, 201);
  const claim2 = await request("POST", "/api/rental/v1/customer-coupons/claim", { templateId: template2.body.data.id, customerId: "e2e_coupon_customer" }, demo.accessToken);
  assert.equal(claim2.status, 201);

  console.log("== 12.1 RC-02 订单确认事务：成功全落库，报价或锁券失败则整体回滚 ==");
  const atomicTemplate = await request(
    "POST",
    "/api/rental/v1/coupon-templates",
    { code: "RC02-ATOMIC-20", name: "RC-02 事务券", discountType: "fixed_amount", discountValue: 20, minimumSpend: 0, totalQuota: 2, perCustomerLimit: 1, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: new Date(Date.now() + 180 * 86400000).toISOString(), status: "enabled" },
    demo.accessToken
  );
  assert.equal(atomicTemplate.status, 201, `RC-02 券模板创建失败: ${JSON.stringify(atomicTemplate.body)}`);
  const atomicClaim = await request(
    "POST",
    "/api/rental/v1/customer-coupons/claim",
    { templateId: atomicTemplate.body.data.id, customerId: "rc02_success_customer" },
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
      { customerType: "personal", customerId: "rc02_success_customer", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: atomicStart, endAt: atomicEnd, lines: atomicLines, customerCouponId: atomicClaim.body.data.id },
      demo.accessToken
    )
  ).body.data;
  const atomicOrderResponse = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: atomicQuote.id, customerType: "personal", customerId: "rc02_success_customer", customerName: "RC-02成功客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: atomicStart, endAt: atomicEnd, lines: atomicLines },
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
  ok("RC-02 正常路径：订单、订单行、库存预占、报价消费和优惠券锁定同时提交");

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
    { customerType: "personal", customerId: "e2e_coupon_customer", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponFailureStart, endAt: couponFailureEnd, lines: atomicLines, customerCouponId: claim2.body.data.id },
    demo.accessToken
  );
  assert.equal(couponFailureQuoteResponse.status, 201, `RC-02 锁券失败用报价创建失败: ${JSON.stringify(couponFailureQuoteResponse.body)}`);
  const couponFailureQuote = couponFailureQuoteResponse.body.data;
  const beforeCouponFailure = factCounts();
  mysqlQuery(`UPDATE \`rental_customer_coupons\` SET \`status\`='expired' WHERE \`id\`='${claim2.body.data.id}';`);
  const couponFailure = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: couponFailureQuote.id, customerType: "personal", customerId: "e2e_coupon_customer", customerName: "RC-02锁券失败客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponFailureStart, endAt: couponFailureEnd, lines: atomicLines },
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
    { customerType: "personal", customerId: "rc02_quote_failure", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: quoteFailureStart, endAt: quoteFailureEnd, lines: atomicLines },
    demo.accessToken
  );
  assert.equal(quoteFailureQuoteResponse.status, 201, `RC-02 失效用报价创建失败: ${JSON.stringify(quoteFailureQuoteResponse.body)}`);
  const quoteFailureQuote = quoteFailureQuoteResponse.body.data;
  const beforeQuoteFailure = factCounts();
  mysqlQuery(`UPDATE \`rental_quotes\` SET \`expiresAt\`=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE \`id\`='${quoteFailureQuote.id}';`);
  const quoteFailure = await request(
    "POST",
    "/api/rental/v1/orders",
    { quoteId: quoteFailureQuote.id, customerType: "personal", customerId: "rc02_quote_failure", customerName: "RC-02报价失败客户", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: quoteFailureStart, endAt: quoteFailureEnd, lines: atomicLines },
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
  const restoredAtomicCoupon = (await request("GET", "/api/rental/v1/customer-coupons?customerId=rc02_success_customer", null, demoAfterRc02Restart.accessToken)).body.data.find((row) => row.id === atomicClaim.body.data.id);
  assert.equal(restoredAtomicOrder.quoteId, atomicQuote.id, "重启后必须从库恢复事务成功订单");
  assert.equal(restoredAtomicCoupon.status, "locked", "重启后必须从库恢复优惠券锁定状态");
  assert.equal(restoredAtomicCoupon.lockedOrderId, atomicOrderId, "重启后优惠券仍须关联原订单");
  ok("RC-02 重启一致性：成功事务完整恢复，失败事务无半成品复活");

  console.log("== 12.2 RC-03 序列化、数量和套装库存并发防超卖 ==");
  const runInventoryRace = async ({ label, token, locationId, itemGroupId, startAt, endAt, reservationQuantity }) => {
    const lines = [{ itemGroupId, quantity: reservationQuantity.requested }];
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
    assert.equal(availableBefore, reservationQuantity.requested, `${label} 构造前提：请求量应恰好等于全部可用量`);

    const quotePayload = { customerType: "personal", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: locationId, startAt, endAt, lines };
    const firstQuoteResponse = await request("POST", "/api/rental/v1/quotes", quotePayload, token);
    const secondQuoteResponse = await request("POST", "/api/rental/v1/quotes", quotePayload, token);
    assert.equal(firstQuoteResponse.status, 201, `${label} 第一份报价失败: ${JSON.stringify(firstQuoteResponse.body)}`);
    assert.equal(secondQuoteResponse.status, 201, `${label} 第二份报价失败: ${JSON.stringify(secondQuoteResponse.body)}`);
    const firstQuote = firstQuoteResponse.body.data;
    const secondQuote = secondQuoteResponse.body.data;
    const orderPayload = (quoteId, suffix) => ({
      quoteId,
      customerType: "personal",
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
      reservationQuantity.persisted,
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
    locationId: location.id,
    itemGroupId: serialized[0].id,
    startAt: serializedRaceStart,
    endAt: serializedRaceEnd,
    reservationQuantity: { requested: 3, persisted: 3 }
  });

  const quantityRaceStart = new Date(Date.now() + 210 * 86400000).toISOString();
  const quantityRaceEnd = new Date(Date.now() + 212 * 86400000).toISOString();
  await runInventoryRace({
    label: "数量库存",
    token: demo2.accessToken,
    locationId: campingLocation.id,
    itemGroupId: tent.id,
    startAt: quantityRaceStart,
    endAt: quantityRaceEnd,
    reservationQuantity: { requested: tentStockBefore.availableQuantity, persisted: tentStockBefore.availableQuantity }
  });

  const bundleRaceStart = new Date(Date.now() + 220 * 86400000).toISOString();
  const bundleRaceEnd = new Date(Date.now() + 222 * 86400000).toISOString();
  await runInventoryRace({
    label: "套装库存",
    token: demo.accessToken,
    locationId: location.id,
    itemGroupId: cameraKit.id,
    startAt: bundleRaceStart,
    endAt: bundleRaceEnd,
    reservationQuantity: { requested: 3, persisted: 6 }
  });

  const exclusivePlan = await request(
    "POST",
    "/api/rental/v1/discount-plans",
    { code: "E2E-EXCLUSIVE", name: "E2E 不可叠加券的优惠", changeReason: "E2E 互斥验证", discountType: "percentage", discountValue: 10, minimumSpend: 0, customerScope: "all", applicableItemGroupIds: [], applicableDayTypes: [], priority: 1, stackableWithCoupon: false, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), status: "enabled" },
    demo.accessToken
  );
  assert.equal(exclusivePlan.status, 201, `互斥方案创建失败: ${JSON.stringify(exclusivePlan.body).slice(0, 200)}`);
  const conflictingQuote = await request(
    "POST",
    "/api/rental/v1/quotes",
    { customerType: "personal", customerId: "e2e_coupon_customer", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id, startAt: couponQuoteStart, endAt: couponQuoteEnd, lines: couponLines, customerCouponId: claim2.body.data.id },
    demo.accessToken
  );
  assert.equal(conflictingQuote.status, 409, "互斥优惠方案下不得同时使用优惠券");
  assert.match(JSON.stringify(conflictingQuote.body), /叠加/u, "拒绝原因应指向叠加互斥");
  ok("优惠券闭环：限领/领完/抵扣/锁定/复用拒绝/核销/取消释放/互斥拦截");

  console.log("== 13. 车辆租户初始化、写入租户戳与车辆域隔离 ==");
  const platform = await login("platform", "admin", PLATFORM_PASSWORD);
  const vehicleA = await bootstrapTenant(platform.accessToken, "e2e_vehicle_a", "vehicle");
  const tenantAId = vehicleA.tenant.tenantId;
  const stationCreate = await request(
    "POST",
    "/api/store-rental/stations",
    { id: "e2e_station_a", storeCode: "E2E_A", stationCode: "E2E_A", parentStoreName: "E2E门市A", name: "E2E据点A", stationType: "counter", serviceCapabilities: ["store_rental"], parkingTotal: 5, parkingAvailable: 2, status: "enabled", serviceStatus: "normal", address: "E2E地址", storeRentalEnabled: true },
    vehicleA.accessToken
  );
  assert.equal(stationCreate.status, 201, `车辆租户建站点失败: ${JSON.stringify(stationCreate.body).slice(0, 200)}`);
  const stampRows = mysqlQuery("SELECT `tenantId` FROM `StoreStation` WHERE `id`='e2e_station_a';");
  assert.ok(stampRows.includes(tenantAId), `写入必须带本租户戳: ${stampRows}`);
  const vehicleAOrders = await request("GET", "/api/store-rental/orders", null, vehicleA.accessToken);
  const vehicleAList = Array.isArray(vehicleAOrders.body.data) ? vehicleAOrders.body.data : vehicleAOrders.body.data.items ?? [];
  assert.equal(vehicleAList.length, 0, "新车辆租户不得看到 tenant_001 的种子订单");
  const dashboard = await request("GET", "/api/reports/dashboard", null, vehicleA.accessToken);
  assert.equal(dashboard.status, 200);
  const vehicleB = await bootstrapTenant(platform.accessToken, "e2e_vehicle_b", "vehicle");
  const vehicleBStations = (await request("GET", "/api/store-rental/stations", null, vehicleB.accessToken)).body.data;
  assert.equal(Array.isArray(vehicleBStations) ? vehicleBStations.length : 0, 0, "车辆租户 B 不得看到 A 的站点");
  ok("车辆域读写隔离验证通过（租户戳正确、互不可见）");

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
  const truckPlan = await request(
    "POST",
    "/api/rental/v1/pricing-plans",
    { effectiveFrom: new Date(Date.now() - 86400000).toISOString(), code: "E2E-TRUCK-PRICE", name: "E2E 货车价格", changeReason: "E2E 品类深度用例", status: "enabled", rates: [{ itemGroupId: truckGroup.body.data.id, unit: "day_24h", baseAmount: 600, weekendMultiplier: 1.1, holidayMultiplier: 1.25, depositAmount: 2000, minimumUnits: 1 }] },
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
  assert.equal(vehicleReturned.order.status, "completed");
  assert.ok(
    vehicleReturned.order.chargeLines.some((line) => line.type === "overdue"),
    "逾期还车应产生逾期费用行"
  );
  assert.ok(vehicleReturned.order.finalPayableAmount > vehicleReturned.order.payableAmount, "逾期费应进入最终应付");
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
    { templateId: constructionReturnTemplate.id, results: { appearance_ok: false, function_ok: true, usage_reading: 356 }, exceptions: [{ description: "铲斗液压油管破损", chargeAmount: 800 }] },
    construction.accessToken
  )).body.data;
  assert.equal(constructionReturned.order.status, "completed");
  assert.equal(constructionReturned.order.finalPayableAmount, constructionReturned.order.payableAmount + 800, "工程损坏费应进入最终应付");
  ok("工程设备闭环：班次计价、资质拦截、损坏费联动");

  console.log("== 16. 双租户并发隔离 ==");
  const rounds = 12;
  const concurrent = [];
  for (let i = 0; i < rounds; i += 1) {
    concurrent.push(request("GET", "/api/rental/v1/item-groups", null, demo.accessToken).then((res) => ({ tenant: "demo", res })));
    concurrent.push(request("GET", "/api/rental/v1/item-groups", null, demo2.accessToken).then((res) => ({ tenant: "demo2", res })));
    concurrent.push(request("GET", "/api/store-rental/orders", null, vehicleA.accessToken).then((res) => ({ tenant: "vehicleA", res })));
  }
  const settled = await Promise.all(concurrent);
  for (const item of settled) {
    if (item.tenant === "demo") {
      assert.ok(item.res.body.data.every((group) => group.code.startsWith("CAM-")), "并发中 demo 数据串线");
    } else if (item.tenant === "demo2") {
      assert.ok(item.res.body.data.every((group) => group.code.startsWith("CAMP-")), "并发中 demo2 数据串线");
    } else {
      const list = Array.isArray(item.res.body.data) ? item.res.body.data : item.res.body.data.items ?? [];
      assert.equal(list.length, 0, "并发中车辆租户数据串线");
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
  ok(`重启后订单 ${restored.orderNo} 恢复为 completed，快照在库`);

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
      status: "enabled"
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
  // 营业日历：经 API 导入官方来源并发布，然后直查库确认状态与来源都落了盘。
  // 此前 E2E 完全没碰日历接口，而它是阶段 4a 迁移的集合之一。
  const calendarYear = new Date().getUTCFullYear() + 1;
  const importedCalendar = await request(
    "POST",
    "/api/rental/v1/calendars/import",
    {
      year: calendarYear,
      region: "CN",
      sourceName: "E2E 官方节假日来源",
      sourceUrl: "https://example.invalid/e2e-holidays",
      sourcePublishedAt: new Date(Date.now() - 86400000).toISOString(),
      days: [{ date: `${calendarYear}-10-01`, dayType: "statutory_holiday", name: "国庆节", pricingMultiplier: 1.5 }]
    },
    demoForWriteThrough.accessToken
  );
  assert.equal(importedCalendar.status, 201, `日历导入失败: ${JSON.stringify(importedCalendar.body)}`);
  assert.equal(
    readCount(`SELECT COUNT(*) FROM \`rental_business_calendars\` WHERE \`tenantId\`='tenant_001' AND \`year\`=${calendarYear} AND \`status\`='draft';`),
    1,
    "导入后的日历必须以 draft 落库"
  );
  const publishedCalendar = await request(
    "POST",
    `/api/rental/v1/calendars/${calendarYear}/publish`,
    null,
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

  console.log("== 26. RC-01 规则发布后库中只保留一个 published 版本 ==");
  // 退役旧版本原先只改内存：重启后库里会重新加载出多个 published；
  // 且退役发生在写库之前，新版本写库失败会让缓存里的旧规则被错误地标成 retired。
  const demoRules = await login("demo", "admin", DEMO_PASSWORD);
  const currentRule = (await request("GET", "/api/rental/v1/rule-versions/current", null, demoRules.accessToken)).body.data;
  const publishRes = await request(
    "POST",
    "/api/rental/v1/rule-versions",
    { config: currentRule.config, changeReason: "E2E 单一 published 校验", publish: true },
    demoRules.accessToken
  );
  assert.equal(publishRes.status, 201, `发布规则版本失败: ${JSON.stringify(publishRes.body)}`);
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_rule_versions` WHERE `tenantId`='tenant_001' AND `status`='published';"),
    1,
    "发布后库中只能有一个 published 规则版本"
  );
  assert.ok(
    readCount("SELECT COUNT(*) FROM `rental_rule_versions` WHERE `tenantId`='tenant_001' AND `status`='retired';") > 0,
    "旧 published 版本的退役必须落库"
  );
  await stopApi();
  startApi();
  if (!(await waitHealth())) fail("规则版本校验的 API 重启超时");
  assert.equal(
    readCount("SELECT COUNT(*) FROM `rental_rule_versions` WHERE `tenantId`='tenant_001' AND `status`='published';"),
    1,
    "重启后仍只能有一个 published 规则版本"
  );
  ok("规则发布：新版本与旧版本退役同事务落库，重启后库中仍只有一个 published");

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
    88,
    "重复发放不得重复累加权益余额"
  );
  ok(`奖励幂等以库为准：重启清空内存后同键再发，流水仍为 ${rewardsBeforeRestart} 条、积分仍为 88`);

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
  const snKey = `e2e-send-race-${Date.now().toString(36)}`;
  const snLogsBefore = readCount(
    `SELECT COUNT(*) FROM \`rental_notification_logs\` WHERE \`tenantId\`='tenant_001' AND \`recipient\`='${snRecipient}';`
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
      `SELECT COUNT(*) FROM \`rental_notification_logs\` WHERE \`tenantId\`='tenant_001' AND \`recipient\`='${snRecipient}';`
    ),
    snLogsBefore + 1,
    "同键并发发送只能在库中留下一条通知日志（多于一条=写入未随事务回滚）"
  );
  const snFromApi = (await request("GET", "/api/rental/v1/notification-logs", null, clDemo.accessToken)).body.data
    .filter((row) => row.recipient === snRecipient);
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
  assert.equal(
    readCount(
      "SELECT COUNT(*) FROM `User` u" +
        " INNER JOIN `business_workspaces` w ON w.`tenantId`=u.`tenantId` AND w.`defaultMarker`='default'" +
        " INNER JOIN `workspace_members` m ON m.`workspaceId`=w.`id` AND m.`userId`=u.`id`" +
        " WHERE NOT (m.`roleId` <=> u.`roleId`);"
    ),
    0,
    "成员角色必须与账号原有角色一致（既有角色关系被映射而非丢弃）"
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

  console.log("== 56. SPACE-03 品类与能力按经营空间判定 ==");
  // 守卫原先用**租户级**品类档案做 capability 与车辆域校验。同租户多个空间且
  // 品类不同时那是错的：一个 camping 空间会被按 camera/vehicle 的能力集放行。
  //
  // 构造：车辆租户（租户级品类=vehicle）新建一个 camera 空间并切进去，
  // 此时 /store-rental/* 必须被拒——若仍按租户判定，它会被放行。
  const catPlatform = await login("platform", "admin", PLATFORM_PASSWORD);
  const catVehicle = await bootstrapTenant(catPlatform.accessToken, "e2e_scope_vehicle", "vehicle");
  const catVehicleOk = await request("GET", "/api/store-rental/vehicles", null, catVehicle.accessToken);
  assert.equal(
    catVehicleOk.status,
    200,
    `前置条件：车辆租户在其默认（vehicle）空间应能访问车辆域，实际 ${catVehicleOk.status}`
  );
  const catCameraWs = await request(
    "POST",
    "/api/platform/workspaces",
    { code: "camera-side", name: "摄影副空间", categoryCode: "camera" },
    catVehicle.accessToken
  );
  assert.equal(catCameraWs.status, 201, `车辆租户创建 camera 空间失败: ${JSON.stringify(catCameraWs.body).slice(0, 200)}`);
  const catMember = await request(
    "PUT",
    `/api/platform/workspaces/${catCameraWs.body.data.id}/members`,
    { userId: catVehicle.user.id },
    catVehicle.accessToken
  );
  assert.equal(catMember.status, 200, "加入 camera 空间成员失败");
  const catSwitched = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: catCameraWs.body.data.id },
    catVehicle.accessToken
  );
  assert.equal(catSwitched.status, 201, "切换到 camera 空间失败");
  const catDenied = await request("GET", "/api/store-rental/vehicles", null, catSwitched.body.data.accessToken);
  assert.equal(
    catDenied.status,
    403,
    `车辆租户切到 camera 空间后必须被车辆域拒绝（品类须按空间判定），实际 ${catDenied.status}: ${JSON.stringify(catDenied.body).slice(0, 200)}`
  );
  // 切回默认（vehicle）空间必须恢复可访问，证明拒绝来自空间品类而非账号权限。
  const catBack = await request(
    "POST",
    "/api/auth/switch-workspace",
    { workspaceId: catVehicle.currentWorkspaceId },
    catSwitched.body.data.accessToken
  );
  assert.equal(catBack.status, 201, "切回 vehicle 空间失败");
  assert.equal(
    (await request("GET", "/api/store-rental/vehicles", null, catBack.body.data.accessToken)).status,
    200,
    "切回 vehicle 空间后必须恢复可访问（证明拒绝来自空间品类，不是账号权限）"
  );
  ok("品类与能力按经营空间判定：车辆租户在 camera 空间被车辆域拒绝 403，切回 vehicle 空间即恢复 200");

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

  console.log("== 59. 旧版快照缺字段时读路径仍不得 500 ==");
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

  console.log(`\nMySQL E2E 全部通过（${passedGroups} 项断言组）`);
}

(async () => {
  try {
    await main();
  } catch (error) {
    console.error(`\nE2E 失败: ${error.message}`);
    // 断言层只看到状态码，成因在 API 子进程里；附上日志尾部避免无从下手。
    if (apiLogRef && apiLogRef.length) {
      console.error("--- API 日志尾部 ---");
      console.error(apiLogRef.join("").slice(-3000));
    }
    process.exitCode = 1;
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
