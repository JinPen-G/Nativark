/**
 * TENANT-READY-01 + PRICE-GROUP-01 + PRICE-04 专项（真库 HTTP 全链）：
 * 空白租户（无任何业务数据）从开业配置走到首张有效报价与确认订单，
 * 全程只走管理端同一批 API（等价于页面操作），不回落 demo 数据、不手工改库。
 *
 * 为什么必须是独立 HTTP 全链而不能只靠服务层用例：
 * - 开业判定（tenant-readiness）、分组原子创建（分组+成员+基本价+空间版本同事务）、
 *   报价快照、下单确认、调价产生空间级新版本、API 重启后持久化——这些口径的
 *   证据都在 HTTP 边界与真实 MySQL 事务上，内存 store 证明不了它们。
 * - 主仓 mysql-e2e 的 13 段此前被改写为断言「新租户自带默认履约地点」，与 R1
 *   决策（5769a12：普通新空间不得生成演示事实）冲突，前缀运行被阻断；本套件
 *   不依赖 mysql-e2e 前缀，可独立证明本批验收链。
 *
 * 安全边界（与 mysql-e2e 同口径）：
 * - 只创建和清理本文件专用数据库（名字含 zcode 且通过格式校验），绝不触碰开发库；
 * - 全部凭据来自环境变量或本地 .env（不入仓库），脚本内无任何硬编码凭据；
 * - 所有子进程使用参数数组直接调用，不经 shell 拼接；
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
      `[tenant-ready] 缺少必需凭据 ${name}。请在环境变量或本地 .env（不入仓库）中配置后重试；` +
        "不得在脚本或仓库文档中硬编码凭据。"
    );
    process.exit(2);
  }
  return value;
}

const TEST_DB = process.env.TENANT_READY_DATABASE_NAME || "store_rental_zcode_firstorder";
const MYSQL_CONTAINER = process.env.E2E_MYSQL_CONTAINER || "store-rental-mysql";
const MYSQL_ROOT_PASSWORD = requiredCredential("MYSQL_ROOT_PASSWORD");
const PLATFORM_PASSWORD = requiredCredential("E2E_PLATFORM_PASSWORD");
const SEED_DEMO_PASSWORD = requiredCredential("E2E_DEMO_PASSWORD");
const SOURCE_DATABASE_URL = requiredCredential("DATABASE_URL");
const API_PORT = Number(process.env.TENANT_READY_API_PORT || 3997);
const API_BASE = `http://localhost:${API_PORT}`;

/* ---------- 专用库守卫：只允许本工作树专用库名 ---------- */

assert.match(TEST_DB, /^[a-z][a-z0-9_]{2,62}$/u, "专用库名只允许小写字母、数字和下划线");
assert.ok(TEST_DB.includes("zcode"), "专用库名必须包含 zcode，防止误操作其他工作树的数据库");
assert.ok(TEST_DB !== "store_rental", "禁止将专项指向共享开发库");
assert.match(MYSQL_CONTAINER, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u, "容器名格式非法");
assert.ok(Number.isInteger(API_PORT) && API_PORT >= 1024 && API_PORT <= 65535, "TENANT_READY_API_PORT 必须是 1024-65535 的整数");

function deriveTestDatabaseUrl(sourceUrl) {
  const parsed = new URL(sourceUrl);
  assert.equal(parsed.protocol, "mysql:", "DATABASE_URL 必须是 mysql:// 连接串");
  assert.ok(
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1",
    "专项只允许使用本机 MySQL，禁止连接远端数据库"
  );
  parsed.pathname = `/${TEST_DB}`;
  return parsed.toString();
}

const TEST_DATABASE_URL = deriveTestDatabaseUrl(SOURCE_DATABASE_URL);

/* ---------- 执行器：全部参数数组直调，不经 shell ---------- */

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

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
    env: { ...process.env, ...(options.env || {}) }
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
        // 必须禁用 keep-alive：重启 API 后连接池里的旧 socket 会随机抛 ECONNRESET。
        agent: false,
        headers: {
          "Content-Type": "application/json",
          Connection: "close",
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

function login(tenantCode, account, password) {
  return request("POST", "/api/auth/login", { tenantCode, account, password });
}

async function loginOk(tenantCode, account, password, why) {
  const res = await login(tenantCode, account, password);
  if (res.status !== 200 && res.status !== 201) fail(why ?? `登录 ${tenantCode}/${account} 失败`, JSON.stringify(res.body).slice(0, 300));
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
      tenantName: `专项租户 ${tenantCode}`,
      categoryCode,
      adminAccount: "admin",
      adminDisplayName: `专项 ${categoryCode} 管理员`
    },
    platformToken
  );
  if (boot.status !== 201) fail(`初始化租户 ${tenantCode} 失败`, JSON.stringify(boot.body).slice(0, 300));
  const temporaryPassword = boot.body.data.temporaryPassword;
  // startApi 每次生成新的 AUTH_TOKEN_SECRET，重启后旧令牌一律 401，
  // 因此这里改密并回报口令，重启后的复验要用它重新登录。
  const first = await loginOk(tenantCode, "admin", temporaryPassword, "临时口令登录失败");
  const newPassword = `Rdy!${randomBytes(4).toString("hex")}`;
  const changed = await request("POST", "/api/auth/change-password", { currentPassword: temporaryPassword, newPassword }, first.accessToken);
  if (changed.status !== 201) fail(`租户 ${tenantCode} 改密失败`, JSON.stringify(changed.body).slice(0, 300));
  const session = await loginOk(tenantCode, "admin", newPassword, "改密后登录失败");
  return { ...session, password: newPassword };
}

async function readiness(token) {
  const res = await request("GET", "/api/rental/v1/tenant-readiness", null, token);
  if (res.status !== 200) fail("读取开业配置状态失败", JSON.stringify(res.body).slice(0, 300));
  return res.body.data;
}

function itemOf(readiness, key) {
  const item = readiness.items.find((row) => row.key === key);
  assert.ok(item, `readiness 缺少配置项 ${key}`);
  return item;
}

/* 租期时点固定在本地上午 10 点（+08:00）：发布日历后报价会校验领取/归还
 * 落在营业时段内，若沿用 Date.now() 的当前时刻可能撞上打烊时间。 */
const dayAt = (offsetDays, hour) => {
  const date = new Date(Date.now() + offsetDays * 86400000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T${String(hour).padStart(2, "0")}:00:00+08:00`;
};

async function createMockFunding(order, token, keyPrefix) {
  const payable = Number(order.payable ?? order.finalPayableAmount ?? order.payableAmount ?? 0);
  if (payable > 0) {
    const rental = await request("POST", `/api/rental/v1/orders/${order.id}/funding-events/initiate`, {
      instrument: "rental", idempotencyKey: `${keyPrefix}:rental`, reason: "开业专项：确认前模拟收取租金与费用"
    }, token);
    assert.equal(rental.status, 201, `模拟租金收取失败: ${JSON.stringify(rental.body).slice(0, 200)}`);
  }
  if (Number(order.depositAmount) > 0) {
    const deposit = await request("POST", `/api/rental/v1/orders/${order.id}/funding-events/initiate`, {
      instrument: "deposit", idempotencyKey: `${keyPrefix}:deposit`, reason: "开业专项：确认前模拟收取押金"
    }, token);
    assert.equal(deposit.status, 201, `模拟押金收取失败: ${JSON.stringify(deposit.body).slice(0, 200)}`);
  }
  if (Number(order.preAuthAmount) > 0) {
    const preauth = await request("POST", `/api/rental/v1/orders/${order.id}/funding-events/initiate`, {
      instrument: "preauthorization", idempotencyKey: `${keyPrefix}:preauth`, reason: "开业专项：确认前模拟冻结预授权"
    }, token);
    assert.equal(preauth.status, 201, `模拟预授权冻结失败: ${JSON.stringify(preauth.body).slice(0, 200)}`);
  }
}

/* ---------- 主流程 ---------- */

async function main() {
  if (fs.existsSync(path.join(API_DIR, "dist", "main.js")) === false) {
    fail("apps/api/dist/main.js 不存在：请先执行 npm run build -w @store-rental/api 再运行本专项");
  }
  if (await probePort()) fail(`端口 ${API_PORT} 已被占用，拒绝启动专项 API`);

  console.log("== 1. 准备专用测试库 ==");
  mysqlRootExec(
    `DROP DATABASE IF EXISTS \`${TEST_DB}\`;\n` +
      `CREATE DATABASE \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n` +
      `GRANT ALL PRIVILEGES ON \`${TEST_DB}\`.* TO 'store_rental'@'%';`
  );
  ok(`专用库 ${TEST_DB} 已重建`);

  console.log("== 2. 空库全量迁移与双 Seed ==");
  const deploy = runNode([PRISMA_CLI, "migrate", "deploy", "--schema", SCHEMA_PATH], { env: { DATABASE_URL: TEST_DATABASE_URL } });
  if (deploy.status !== 0) fail("空库 migrate deploy 失败", `${deploy.stdout || ""}${deploy.stderr || ""}`);
  ok("空库全量迁移完成");
  const seed = runNode([TS_NODE_BIN, "prisma/seed.ts"], {
    cwd: API_DIR,
    env: { DATABASE_URL: TEST_DATABASE_URL, SEED_PLATFORM_PASSWORD: PLATFORM_PASSWORD, SEED_DEMO_PASSWORD }
  });
  if (seed.status !== 0) fail("seed 执行失败", `${seed.stdout || ""}${seed.stderr || ""}`.slice(-2000));
  ok("Seed 完成（建立平台管理员等基础设施账号，非经营演示数据）");

  console.log("== 3. 启动 API（MySQL 模式） ==");
  const apiLogs = startApi();
  if (!(await waitHealth())) fail("API 启动超时", apiLogs.join("").slice(-2000));
  ok(`API 已启动: ${API_BASE}`);

  console.log("== 4. 空白租户 bootstrap 与初始开业状态 ==");
  const platform = await loginOk("platform", "admin", PLATFORM_PASSWORD, "平台管理员登录失败");
  const blank = await bootstrapTenant(platform.accessToken, "e2e_ready_blank", "camera");
  ok("空白摄影租户 bootstrap 完成（临时口令改密 + 正式登录）");

  // R1 决策：普通新租户不得自带任何演示经营事实。
  const emptyLists = [
    ["item-groups", "产品型号"], ["pricing-groups", "定价分组"], ["locations", "履约地点"],
    ["fulfillment-operators", "经营主体"], ["assets", "资产"]
  ];
  for (const [endpoint, label] of emptyLists) {
    const res = await request("GET", `/api/rental/v1/${endpoint}`, null, blank.accessToken);
    assert.equal(res.status, 200, `读取 ${label} 列表失败: ${res.status}`);
    assert.equal(res.body.data.length, 0, `空白租户不得自带演示${label}`);
  }
  ok("空白租户无任何演示事实（型号/分组/地点/主体/资产全为空）");

  const initial = await readiness(blank.accessToken);
  assert.equal(initial.ready, false, "空白租户开业状态必须是未就绪");
  assert.ok(initial.missingKeys.includes("item_groups"), "空白租户必须显示缺少产品型号");
  assert.ok(initial.missingKeys.includes("pricing_groups_rates"), "空白租户必须显示缺少定价分组基本价");
  assert.ok(initial.missingKeys.includes("price_version"), "空白租户必须显示缺少空间价格版本");
  assert.ok(initial.missingKeys.includes("fulfillment_network"), "空白租户必须显示缺少履约地点");
  assert.ok(initial.missingKeys.includes("membership_base"), "空白租户必须显示缺少会员方案");
  assert.ok(initial.quoteBlockers.some((row) => row.includes("履约地点")), "缺履约地点必须出现在报价闸门里");
  assert.ok(initial.quoteBlockers.some((row) => row.includes("价格版本")), "缺价格版本必须出现在报价闸门里");
  const membershipItem = itemOf(initial, "membership_base");
  assert.equal(membershipItem.optional, true, "会员方案必须按可暂缓口径返回");
  ok("初始 readiness：未就绪，缺项与报价闸门口径正确（履约网络/价格版本/分组/会员可暂缓）");

  // 无演示回落：引用不存在的商品报价必须 fail-closed。
  const farStart = dayAt(2, 10);
  const farEnd = dayAt(4, 10);
  const bogusQuote = await request("POST", "/api/rental/v1/quotes", {
    customerType: "personal", customerId: "customer_none",
    fulfillmentMode: "store_pickup_return", fulfillmentLocationId: "location_none",
    startAt: farStart, endAt: farEnd,
    lines: [{ itemGroupId: "group_77905693", quantity: 1 }]
  }, blank.accessToken);
  assert.ok(bogusQuote.status >= 400 && bogusQuote.status < 500, `引用不存在商品的报价必须被拒绝，实际 ${bogusQuote.status}`);
  ok("无演示回落：引用不存在商品的报价 fail-closed（不再伪装成可报价）");

  console.log("== 5. 管理端配置链：型号 → 定价分组+基本价（同事务出空间版本） ==");
  const model = await request("POST", "/api/rental/v1/item-groups", {
    code: "RDY-CAM-01", name: "专项相机机身", inventoryMode: "serialized", unit: "台",
    attributes: { brand: "专项", model: "R1", role: "body", sensorFormat: "full_frame" }
  }, blank.accessToken);
  assert.equal(model.status, 201, `产品型号创建失败: ${JSON.stringify(model.body).slice(0, 300)}`);
  const modelId = model.body.data.id;
  ok("产品型号创建成功（管理端 API）");

  const pricingGroupRes = await request("POST", "/api/rental/v1/pricing-groups", {
    code: "RDY-BODY", name: "专项机身分组", memberItemGroupIds: [modelId],
    initialRates: [{ unit: "calendar_day", baseAmount: 120 }]
  }, blank.accessToken);
  assert.equal(pricingGroupRes.status, 201, `定价分组+基本价创建失败: ${JSON.stringify(pricingGroupRes.body).slice(0, 300)}`);
  const groupId = pricingGroupRes.body.data.id;
  const groupList = (await request("GET", "/api/rental/v1/pricing-groups", null, blank.accessToken)).body.data;
  const savedGroup = groupList.find((row) => row.id === groupId);
  assert.ok(savedGroup, "定价分组必须出现在列表里");
  assert.deepEqual(savedGroup.memberItemGroupIds, [modelId], "定价分组页必须能看到成员型号");
  const versionListRes = await request("GET", "/api/rental/v1/pricing-versions", null, blank.accessToken);
  assert.equal(versionListRes.status, 200, "读取空间价格版本失败");
  const versionList = versionListRes.body.data.rows ?? versionListRes.body.data;
  assert.equal(versionList.length, 1, "分组基本价必须同事务产出恰好一条空间版本");
  assert.equal(versionList[0].sequence, 1, "首条空间版本序号必须为 1");
  const versionDetail = (await request("GET", "/api/rental/v1/pricing-versions/1", null, blank.accessToken)).body.data;
  const versionRates = versionDetail.rates ?? [];
  assert.ok(
    versionRates.some((row) => (row.pricingGroupId ?? row.itemGroupId) === groupId && row.unit === "calendar_day" && Number(row.baseAmount) === 120),
    "空间版本必须包含本次基本价（全集口径）"
  );
  ok("定价分组与基本价同事务创建，空间整体价格版本 v1 全集落库");

  const afterGroup = await readiness(blank.accessToken);
  assert.equal(itemOf(afterGroup, "item_groups").done, true, "创建型号后 readiness 的型号项应完成");
  assert.equal(itemOf(afterGroup, "pricing_groups_rates").done, true, "创建分组基本价后 readiness 的分组项应完成");
  assert.equal(itemOf(afterGroup, "price_version").done, true, "创建分组基本价后 readiness 的版本项应完成");
  assert.equal(afterGroup.ready, false, "履约网络与会员未配置前必须仍未就绪");
  ok("readiness 推进：型号/分组/版本转绿，其余缺项如实保留");

  console.log("== 6. 同型号多分组（带预授权额度）、组内去重与普通编辑封锁 ==");
  // 第二分组：同一型号再次入组，且按预授权品类要求一并给出预授权额度。
  const secondGroupRes = await request("POST", "/api/rental/v1/pricing-groups", {
    code: "RDY-BODY-PRO", name: "专项机身标准包装", memberItemGroupIds: [modelId],
    initialRates: [{ unit: "calendar_day", baseAmount: 120, preAuthAmount: 200 }]
  }, blank.accessToken);
  assert.equal(secondGroupRes.status, 201, `同一型号加入第二个定价分组失败: ${JSON.stringify(secondGroupRes.body).slice(0, 300)}`);
  const secondGroupId = secondGroupRes.body.data.id;
  const duplicateRes = await request("POST", "/api/rental/v1/pricing-groups", {
    code: "RDY-DUP", name: "组内重复成员", memberItemGroupIds: [modelId, modelId],
    initialRates: [{ unit: "calendar_day", baseAmount: 1 }]
  }, blank.accessToken);
  assert.equal(duplicateRes.status, 400, "同一分组内重复选择同一型号必须被拒绝");
  ok("同一型号可加入多个定价分组（第二个分组按预授权品类带预授权额度）；同组内重复被拒");

  // PRICE-03 语义：已启用计划禁止普通编辑直接覆盖——预授权金额也无法绕开版本链事后改。
  const plansForEdit = (await request("GET", "/api/rental/v1/pricing-plans", null, blank.accessToken)).body.data;
  const firstGroupPlan = plansForEdit.find((row) => (row.rates ?? []).some((rate) => (rate.pricingGroupId ?? rate.itemGroupId) === groupId));
  assert.ok(firstGroupPlan, "必须能在基础定价页找到分组基本价对应计划");
  const editBlocked = await request("PUT", `/api/rental/v1/pricing-plans/${firstGroupPlan.id}`, {
    code: firstGroupPlan.code, name: firstGroupPlan.name, status: "enabled",
    effectiveFrom: new Date().toISOString(), changeReason: "尝试普通编辑已启用计划",
    rates: [{ pricingGroupId: groupId, itemGroupId: groupId, unit: "calendar_day", baseAmount: 120, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 0, minimumUnits: 1, preAuthAmount: 200 }]
  }, blank.accessToken);
  assert.equal(editBlocked.status, 409, "已启用计划不得通过普通编辑直接覆盖");
  const versionsAfterGroups = (await request("GET", "/api/rental/v1/pricing-versions", null, blank.accessToken)).body.data;
  const rowsAfterGroups = versionsAfterGroups.rows ?? versionsAfterGroups;
  assert.equal(rowsAfterGroups.length, 2, "两个分组各带基本价应产出两条空间版本（v1、v2）");
  const v2Detail = (await request("GET", "/api/rental/v1/pricing-versions/2", null, blank.accessToken)).body.data;
  const v2Rate = (v2Detail.rates ?? []).find((row) => (row.pricingGroupId ?? row.itemGroupId) === secondGroupId && row.unit === "calendar_day");
  assert.ok(v2Rate, "v2 必须包含第二分组费率");
  assert.equal(Number(v2Rate.preAuthAmount), 200, "v2 必须携带分组创建时给出的预授权额度");
  assert.equal(Number(v2Rate.baseAmount), 120, "v2 必须携带第二分组基本价");
  ok("预授权额度随分组基本价进入版本链；已启用计划普通编辑被 409 封锁");

  const operator = await request("POST", "/api/rental/v1/fulfillment-operators", {
    code: "SELF", name: "专项自营摄影", type: "self_operated"
  }, blank.accessToken);
  assert.equal(operator.status, 201, `经营主体创建失败: ${JSON.stringify(operator.body).slice(0, 300)}`);
  const location = await request("POST", "/api/rental/v1/locations", {
    code: "MAIN", name: "专项门店", type: "store", operatorId: operator.body.data.id,
    capabilities: ["pickup", "return", "storage"], address: "专项路 1 号", businessHours: "09:00-18:00"
  }, blank.accessToken);
  assert.equal(location.status, 201, `履约地点创建失败: ${JSON.stringify(location.body).slice(0, 300)}`);
  const locationId = location.body.data.id;

  const afterNetwork = await readiness(blank.accessToken);
  const networkItem = itemOf(afterNetwork, "fulfillment_network");
  assert.equal(networkItem.done, true, "配置取还地点后履约网络项应完成");
  assert.ok(!afterNetwork.quoteBlockers.some((row) => row.includes("履约地点")), "履约地点配置后必须移出报价闸门");
  ok("履约网络（主体+取还地点）配置后 readiness 转绿并移出报价闸门");

  const disabledOperator = await request("PUT", `/api/rental/v1/fulfillment-operators/${operator.body.data.id}`, {
    code: operator.body.data.code,
    name: operator.body.data.name,
    type: operator.body.data.type,
    status: "disabled"
  }, blank.accessToken);
  assert.equal(disabledOperator.status, 200, `停用经营主体失败: ${JSON.stringify(disabledOperator.body).slice(0, 300)}`);
  const afterDisabledOperator = await readiness(blank.accessToken);
  assert.equal(itemOf(afterDisabledOperator, "fulfillment_network").done, false, "经营主体停用后履约网络必须回到未完成");
  assert.ok(afterDisabledOperator.quoteBlockers.some((row) => row.includes("履约地点")), "经营主体停用后必须重新进入报价闸门");
  const restoredOperator = await request("PUT", `/api/rental/v1/fulfillment-operators/${operator.body.data.id}`, {
    code: operator.body.data.code,
    name: operator.body.data.name,
    type: operator.body.data.type,
    status: "enabled"
  }, blank.accessToken);
  assert.equal(restoredOperator.status, 200, `恢复经营主体失败: ${JSON.stringify(restoredOperator.body).slice(0, 300)}`);
  assert.equal(itemOf(await readiness(blank.accessToken), "fulfillment_network").done, true, "恢复经营主体后履约网络应恢复");
  ok("经营主体停用会立即撤销履约网络可用性，恢复后 readiness 重新转绿");

  // 开业必做项还有年度日历：空白租户按每周默认模板生成草稿后直接发布。
  const year = new Date().getFullYear();
  const publishRes = await request("POST", `/api/rental/v1/calendars/${year}/publish`, {
    changeReason: "开业专项：按每周默认模板发布首份年度日历"
  }, blank.accessToken);
  assert.equal(publishRes.status === 200 || publishRes.status === 201, true, `年度日历发布失败: ${JSON.stringify(publishRes.body).slice(0, 300)}`);
  const afterCalendar = await readiness(blank.accessToken);
  assert.equal(itemOf(afterCalendar, "business_calendar").done, true, "发布后日历项应完成");
  assert.ok(!afterCalendar.quoteBlockers.some((row) => row.includes("日历")), "日历缺省本就不是报价闸门，发布后更不应出现");
  ok(`年度日历（${year}，每周默认模板）发布成功，readiness 日历项转绿`);

  console.log("== 7. 可暂缓口径证明与会员方案 ==");
  // 关键判定：除会员方案外全部完成时，ready 必须已经是 true——会员缺失不得阻塞开业。
  const beforeMembership = await readiness(blank.accessToken);
  assert.equal(itemOf(beforeMembership, "membership_base").done, false, "会员方案尚未配置");
  assert.equal(beforeMembership.ready, true, `必做项全部完成时 readiness.ready 必须为 true（会员可暂缓），实际缺失: ${JSON.stringify(beforeMembership.missingKeys)}`);
  assert.equal(beforeMembership.status, "configuring", "可暂缓项未完成时整体状态应为配置中而非已完成");
  assert.deepEqual(beforeMembership.quoteBlockers, [], "必做项齐备后报价闸门必须为空");
  const plan = await request("PUT", "/api/membership/plans", {
    code: "RDY-VIP", name: "专项会员", targetType: "personal", levelRank: 1,
    benefits: [{ type: "discount", calculation: "percentage", value: 5 }]
  }, blank.accessToken);
  assert.equal(plan.status === 200 || plan.status === 201, true, `会员方案创建失败: ${JSON.stringify(plan.body).slice(0, 300)}`);
  const afterMembership = await readiness(blank.accessToken);
  assert.equal(afterMembership.ready, true, "会员方案创建后仍必须就绪");
  assert.equal(afterMembership.status, "completed", "全部配置项（含可暂缓项）完成后状态应为已完成");
  ok("可暂缓口径端到端成立：会员缺失不阻塞 ready，配置后进入 completed");

  console.log("== 8. 首张有效报价与确认订单 ==");
  const customer = await request("POST", "/api/platform/customers", {
    customerType: "personal", name: "专项首单客户", phone: "13800002026"
  }, blank.accessToken);
  assert.equal(customer.status, 201, `客户创建失败: ${JSON.stringify(customer.body).slice(0, 300)}`);
  const customerId = customer.body.data.id;

  // 序列化型号必须有可用资产才能承接库存：通过管理端资产页的同一 API 登记。
  const asset = await request("POST", "/api/rental/v1/assets", {
    itemGroupId: modelId, locationId, assetNo: "RDY-CAM-0001",
    attributes: { serialNo: "RDY-SN-0001", conditionGrade: "A" }
  }, blank.accessToken);
  assert.equal(asset.status, 201, `资产登记失败: ${JSON.stringify(asset.body).slice(0, 300)}`);
  ok("序列化资产登记到履约地点（管理端资产管理 API）");

  // 开业走查发现的品类闸门：摄影品类默认规则要求预授权，未配额度的分组报价必须
  // 如实拦截（而不是冻结 0 或静默放行）。配了额度的分组（第二分组）才能报价。
  const preauthGate = await request("POST", "/api/rental/v1/quotes", {
    customerType: "personal", customerId,
    fulfillmentMode: "store_pickup_return", fulfillmentLocationId: locationId,
    startAt: farStart, endAt: farEnd,
    lines: [{ pricingGroupId: groupId, itemGroupId: modelId, quantity: 1 }]
  }, blank.accessToken);
  assert.equal(preauthGate.status, 409, `预授权闸门必须拦截，实际 ${preauthGate.status}: ${JSON.stringify(preauthGate.body).slice(0, 200)}`);
  assert.match(JSON.stringify(preauthGate.body), /预授权/u, "拦截原因必须说明是预授权额度缺失");
  ok("预授权闸门如实拦截：规则要求预授权而分组未配额度时报价 409");

  const quote = await request("POST", "/api/rental/v1/quotes", {
    customerType: "personal", customerId,
    fulfillmentMode: "store_pickup_return", fulfillmentLocationId: locationId,
    startAt: farStart, endAt: farEnd,
    lines: [{ pricingGroupId: secondGroupId, itemGroupId: modelId, quantity: 1 }]
  }, blank.accessToken);
  assert.equal(quote.status, 201, `首张报价失败: ${JSON.stringify(quote.body).slice(0, 400)}`);
  const firstQuote = quote.body.data;
  // calendar_day 按触达的营业日计价：D+2 10:00 → D+4 10:00 触达 3 个日历日（周末/假日倍率均为 1）
  assert.equal(Number(firstQuote.rentalAmount), 360, `报价金额必须按分组基本价计算: ${firstQuote.rentalAmount}`);
  assert.ok(firstQuote.priceVersionId ?? firstQuote.priceVersion, "报价快照必须引用空间价格版本");
  const firstQuoteId = firstQuote.id;
  ok(`首张有效报价产出：${firstQuote.quoteNo ?? firstQuoteId}，租金 360 = 3 个日历日 × 120，引用价格版本`);

  const order = await request("POST", "/api/rental/v1/orders", {
    quoteId: firstQuoteId, customerType: "personal", customerId,
    customerName: "专项首单客户", contactPhone: "13800002026",
    fulfillmentMode: "store_pickup_return", fulfillmentLocationId: locationId,
    startAt: farStart, endAt: farEnd,
    lines: [{ pricingGroupId: secondGroupId, itemGroupId: modelId, quantity: 1 }]
  }, blank.accessToken);
  assert.equal(order.status, 201, `下单失败: ${JSON.stringify(order.body).slice(0, 400)}`);
  const orderId = order.body.data.id;
  assert.equal(order.body.data.status, "draft", "新订单必须从 draft 开始");
  await createMockFunding(order.body.data, blank.accessToken, `ready:${orderId}`);
  const confirmed = await request("POST", `/api/rental/v1/orders/${orderId}/confirm`, {}, blank.accessToken);
  assert.equal(confirmed.status, 201, `订单确认失败: ${JSON.stringify(confirmed.body).slice(0, 400)}`);
  assert.equal(confirmed.body.data.status, "reserved", "确认后订单应进入 reserved");
  ok("首单确认成功：draft → reserved，金额与快照随订单固化");

  console.log("== 9. 调价产生空间级新版本，旧快照不动 ==");
  const adjustment = await request("POST", "/api/rental/v1/pricing-adjustments", {
    code: "RDY-UP-50", name: "开业后调价 +50%", changeReason: "专项验证：整体调价产生新空间版本",
    changes: [{ itemGroupId: secondGroupId, unit: "calendar_day", op: "percent", value: 50 }]
  }, blank.accessToken);
  assert.equal(adjustment.status === 200 || adjustment.status === 201, true, `调价计划创建失败: ${JSON.stringify(adjustment.body).slice(0, 400)}`);
  const adjustmentId = (adjustment.body.data ?? {}).id;
  const confirmAdj = await request("POST", `/api/rental/v1/pricing-adjustments/${adjustmentId}/confirm`, {}, blank.accessToken);
  assert.equal(confirmAdj.status === 200 || confirmAdj.status === 201, true, `调价确认失败: ${JSON.stringify(confirmAdj.body).slice(0, 400)}`);
  const versionsAfter = (await request("GET", "/api/rental/v1/pricing-versions", null, blank.accessToken)).body.data;
  const rowsAfter = versionsAfter.rows ?? versionsAfter;
  assert.equal(rowsAfter.length, 3, "调价确认必须恰好追加一条空间版本（v3），不能按分组各存一条");
  const latestVersion = rowsAfter[0];
  assert.equal(latestVersion.sequence, 3, "新版本序号必须递增到 3");
  const latestDetail = (await request("GET", "/api/rental/v1/pricing-versions/3", null, blank.accessToken)).body.data;
  const upserted = (latestDetail.rates ?? []).find((row) => (row.pricingGroupId ?? row.itemGroupId) === secondGroupId && row.unit === "calendar_day");
  assert.ok(upserted, "新版本必须包含被调价格");
  assert.equal(Number(upserted.baseAmount), 180, "调价后新版本价格必须是 120 × 1.5 = 180");
  assert.equal(Number(upserted.preAuthAmount), 200, "调价新版本必须完整带入未修改的预授权额度（全集）");
  // 旧快照不动：旧报价与订单继续引用 v1 的 120 口径。
  const oldQuoteAfter = (await request("GET", `/api/rental/v1/quotes/${firstQuoteId}`, null, blank.accessToken)).body.data;
  assert.equal(Number(oldQuoteAfter.rentalAmount), 360, "调价后旧报价快照金额不得改变");
  const oldOrderAfter = (await request("GET", `/api/rental/v1/orders/${orderId}`, null, blank.accessToken)).body.data;
  assert.equal(Number(oldOrderAfter.rentalAmount ?? oldOrderAfter.payableAmount ?? 0), Number(order.body.data.rentalAmount ?? order.body.data.payableAmount), "调价后订单金额不得改变");
  // 新报价走新版本：租期须避开首单（唯一资产已被 D+2→D+4 预占），取 D+5→D+7
  // （同样 3 个日历日）。日历/价格版本按租期开始时点匹配，晚于 v3 生效时点即走新版本。
  const newQuote = await request("POST", "/api/rental/v1/quotes", {
    customerType: "personal", customerId,
    fulfillmentMode: "store_pickup_return", fulfillmentLocationId: locationId,
    startAt: dayAt(5, 10),
    endAt: dayAt(7, 10),
    lines: [{ pricingGroupId: secondGroupId, itemGroupId: modelId, quantity: 1 }]
  }, blank.accessToken);
  assert.equal(newQuote.status, 201, `调价后新报价失败: ${JSON.stringify(newQuote.body).slice(0, 300)}`);
  assert.equal(Number(newQuote.body.data.rentalAmount), 540, "调价后新报价必须按新版本 180 × 3 个日历日 = 540 计算");
  assert.notEqual(
    newQuote.body.data.priceVersionId ?? newQuote.body.data.priceVersion,
    oldQuoteAfter.priceVersionId ?? oldQuoteAfter.priceVersion,
    "调价后新报价必须引用与旧报价不同的价格版本"
  );
  ok("调价确认产生空间级 v3 全集版本：旧报价/订单快照保持调价前口径，新报价按 180 计价走新版本");

  console.log("== 10. 跨租户定价隔离 ==");
  const otherTenant = await bootstrapTenant(platform.accessToken, "e2e_ready_other", "camping");
  const crossList = (await request("GET", "/api/rental/v1/pricing-groups", null, otherTenant.accessToken)).body.data;
  assert.equal(crossList.length, 0, "第二租户不得看到第一租户定价分组");
  const crossVersions = (await request("GET", "/api/rental/v1/pricing-versions", null, otherTenant.accessToken)).body.data;
  assert.equal((crossVersions.rows ?? crossVersions).length, 0, "第二租户不得看到第一租户价格版本");
  const crossQuote = await request("POST", "/api/rental/v1/quotes", {
    customerType: "personal", customerId: "customer_none",
    fulfillmentMode: "store_pickup_return", fulfillmentLocationId: locationId,
    startAt: farStart, endAt: farEnd,
    lines: [{ itemGroupId: modelId, quantity: 1 }]
  }, otherTenant.accessToken);
  assert.ok(crossQuote.status >= 400 && crossQuote.status < 500, `跨租户引用他租户型号的报价必须被拒绝，实际 ${crossQuote.status}`);
  ok("跨租户隔离：第二租户看不到第一租户的分组与版本，引用其型号报价 fail-closed");

  console.log("== 11. API 重启后持久化复验 ==");
  await stopApi();
  if (!(await (async () => { startApi(); return waitHealth(); })())) fail("API 重启失败");
  ok("API 已重启");
  const relogin = await loginOk("e2e_ready_blank", "admin", blank.password, "重启后重新登录失败");
  const reToken = relogin.accessToken;
  const reOrder = (await request("GET", `/api/rental/v1/orders/${orderId}`, null, reToken)).body.data;
  assert.equal(reOrder.status, "reserved", "重启后订单状态必须保持 reserved");
  assert.equal(Number(reOrder.rentalAmount ?? reOrder.payableAmount), 360, "重启后订单金额必须保持调价前快照口径");
  const reVersions = (await request("GET", "/api/rental/v1/pricing-versions", null, reToken)).body.data;
  const reRows = reVersions.rows ?? reVersions;
  assert.equal(reRows.length, 3, "重启后空间版本必须仍是三条（v1 基本价、v2 预授权、v3 调价）");
  const reGroups = (await request("GET", "/api/rental/v1/pricing-groups", null, reToken)).body.data;
  assert.equal(reGroups.length, 2, "重启后两个定价分组必须仍在");
  const reQuote = (await request("GET", `/api/rental/v1/quotes/${firstQuoteId}`, null, reToken)).body.data;
  assert.equal(Number(reQuote.rentalAmount), 360, "重启后报价快照必须保持调价前口径");
  assert.ok(reQuote.priceVersionId ?? reQuote.priceVersion, "重启后报价快照必须仍引用价格版本");
  ok("重启持久化：订单/报价快照/价格版本/定价分组全部按原样读回");

  console.log(`\n空白租户首单专项全部通过（${passedGroups} 项断言组）`);
}

let cleanupRan = false;
async function cleanupDatabase() {
  if (cleanupRan) return;
  cleanupRan = true;
  try {
    mysqlRootExec(`DROP DATABASE IF EXISTS \`${TEST_DB}\`;`);
  } catch {
    /* 清理失败不再掩盖主流程结果 */
  }
}

void (async () => {
  try {
    await main();
  } catch (error) {
    console.error(`\n专项失败: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await stopApi();
    await cleanupDatabase();
  }
})();
