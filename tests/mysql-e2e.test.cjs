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

/* ---------- 断言与进度输出 ---------- */

let passedGroups = 0;
function ok(message) {
  passedGroups += 1;
  console.log(`  PASS  ${message}`);
}
function fail(message, detail) {
  console.error(`  FAIL  ${message}`);
  if (detail) console.error(detail);
  process.exitCode = 1;
  throw new Error(message);
}

/* ---------- HTTP 与 API 子进程 ---------- */

function request(method, requestPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(requestPath, API_BASE);
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
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
  if (!Number.isFinite(appliedCount) || appliedCount < 24) fail(`迁移数量异常: ${appliedCount}`);
  ok(`全量迁移完成，_prisma_migrations=${appliedCount}`);
  const drift = runNode([PRISMA_CLI, "migrate", "diff", "--from-url", TEST_DATABASE_URL, "--to-schema-datamodel", SCHEMA_PATH]);
  if (drift.status !== 0) fail("migrate diff 执行失败", `${drift.stdout || ""}${drift.stderr || ""}`);
  const driftSql = `${drift.stdout || ""}${drift.stderr || ""}`.replace(
    /\x1B\[[0-?]*[ -/]*[@-~]/gu,
    ""
  );
  if (/\b(ALTER TABLE|CREATE TABLE|DROP TABLE|CREATE INDEX|DROP INDEX|ALTER DATABASE)\b/iu.test(driftSql)) {
    fail("迁移结果与 schema.prisma 存在 drift", driftSql.slice(0, 1500));
  }
  ok("迁移后库结构与 schema.prisma 一致（无 drift）");

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
    24,
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
    { code: "E2E-TRUCK-PRICE", name: "E2E 货车价格", changeReason: "E2E 品类深度用例", status: "enabled", rates: [{ itemGroupId: truckGroup.body.data.id, unit: "day_24h", baseAmount: 600, weekendMultiplier: 1.1, holidayMultiplier: 1.25, depositAmount: 2000, minimumUnits: 1 }] },
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
    { code: "E2E-EXCA-PRICE", name: "E2E 挖掘机价格", changeReason: "E2E 品类深度用例", status: "enabled", rates: [{ itemGroupId: excavatorGroup.body.data.id, unit: "shift", baseAmount: 1500, weekendMultiplier: 1.1, holidayMultiplier: 1.25, depositAmount: 5000, minimumUnits: 1 }] },
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

  console.log(`\nMySQL E2E 全部通过（${passedGroups} 项断言组）`);
}

(async () => {
  try {
    await main();
  } catch (error) {
    console.error(`\nE2E 失败: ${error.message}`);
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
