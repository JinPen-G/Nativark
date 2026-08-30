"use strict";

/**
 * OPS-01C `upgrade-drill`：在**克隆库**上演练升级与回滚。
 *
 * 一次完整演练：
 *   验证备份 → 恢复到升级克隆库 → migrate deploy → 独立端口起 API → 健康检查
 *   → 从同一份备份恢复出回滚克隆库 → 输出人工切换步骤 → 清理本次成功的资源。
 *
 * 三条不可退让的边界：
 *   1. **源库只读**。演练全程不对 `DATABASE_URL` 指向的库做任何写入；
 *   2. **回滚靠重建，不靠 down migration**。真实事故里 down migration 既不可靠、
 *      也常常根本不存在；本脚本的回滚是「从已验证备份恢复出一个干净库」，
 *      再把切换动作交给人；
 *   3. **不碰现有服务**。API 只在一个独立端口上临时起一个进程，演练完就停；
 *      既不停止、也不替换任何正在运行的实例。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { buildCloneDatabaseName, buildDatabaseUrl, isOwnedCloneDatabase, redact, quoteSqlString, OpsTargetError } = require("./dedicated-env.cjs");
const { rewriteBackupForTarget, verifyClone } = require("./restore-core.cjs");
const { ROOT, requireTarget, requireAdminTarget, assertContainerEndpoint, loadDatabaseUrl, log, fail, runPackageCommand, containerRunning, runMysql, sql } = require("./runtime.cjs");

const ARTIFACT_DIR = process.env.OPS_ARTIFACT_DIR || path.join(ROOT, "artifacts", "release");
const API_DIR = path.join(ROOT, "apps", "api");
const DRILL_PORT = Number(process.env.OPS_DRILL_API_PORT || 3991);
const HEALTH_PATH = "/api/health";

const flag = (name) => process.argv.includes(`--${name}`);
const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

function latestBackup(database) {
  const dir = process.env.OPS_BACKUP_DIR || path.join(ROOT, "backups");
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir)
    .filter((name) => name.startsWith(`${database}-`) && name.endsWith(".sql"))
    .sort();
  return files.length ? path.join(dir, files[files.length - 1]) : undefined;
}

/** 端口必须先确认空闲：占用时直接失败，绝不去停别人的进程腾位置。 */
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => {
      reject(new OpsTargetError(
        `端口 ${port} 已被占用（${error.code}）。演练必须用独立端口，不会停止任何正在运行的服务；`
        + "请用 OPS_DRILL_API_PORT 指定一个空闲端口。"
      ));
    });
    probe.once("listening", () => probe.close(() => resolve(port)));
    probe.listen(port, "127.0.0.1");
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 起一个只连克隆库的临时 API 进程，返回句柄；stdout/stderr 收集后统一脱敏。 */
function startApi(cloneUrl, port, secrets) {
  const entry = path.join(API_DIR, "dist", "main.js");
  if (!fs.existsSync(entry)) {
    throw new OpsTargetError("缺少 apps/api/dist/main.js，先跑 npm run build（OPS-01B 门禁也会检查产物）");
  }
  const child = spawn(process.execPath, [entry], {
    cwd: API_DIR,
    env: {
      ...process.env,
      DATABASE_URL: cloneUrl,
      // 健康端点本身不查库，因此必须让应用启动阶段强制完成 Prisma 连接；
      // 否则一个完全没接上克隆库的进程也可能返回 status=ok。
      DATABASE_CONNECT_ON_START: "true",
      API_PORT: String(port),
      // 演练进程不应因缺密钥而回落到公开的开发密钥；给一个仅本次进程使用的随机值。
      AUTH_TOKEN_SECRET: process.env.AUTH_TOKEN_SECRET || crypto.randomBytes(32).toString("hex"),
      NODE_ENV: process.env.NODE_ENV || "development"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const chunks = [];
  child.stdout.on("data", (data) => chunks.push(String(data)));
  child.stderr.on("data", (data) => chunks.push(String(data)));
  return { child, output: () => redact(chunks.join(""), secrets) };
}

/**
 * 轮询健康检查。
 *
 * 只看 HTTP 200 是不够的：反向代理或静态兜底页也能回 200。数据库连通由启动时
 * `DATABASE_CONNECT_ON_START=true` 与应用账号直连探针共同保证；本检查再要求应用自身
 * 返回 `status === "ok"`。响应可能被全局拦截器包一层 `{ data: ... }`，
 * 两种形状都接受，但**不接受**取不到 status 的情况。
 */
function readHealthStatus(payload) {
  return payload?.status ?? payload?.data?.status;
}

async function probeHealth(port, child, attempts = 40) {
  let lastStatus;
  let lastBody;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (child?.exitCode !== null) {
      return { ok: false, attempt, status: lastStatus, health: lastBody, processExitCode: child.exitCode };
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`);
      lastStatus = response.status;
      if (response.ok) {
        const payload = await response.json();
        lastBody = readHealthStatus(payload);
        if (lastBody === "ok") return { ok: true, attempt, status: response.status, health: lastBody };
      }
    } catch {
      // 进程还没监听，继续等。
    }
    await wait(500);
  }
  return { ok: false, attempt: attempts, status: lastStatus, health: lastBody };
}

void (async () => {
  let target;
  let admin;
  try {
    target = assertContainerEndpoint(requireTarget());
    admin = requireAdminTarget(target);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!containerRunning()) fail("MySQL 容器未运行，先跑 ops:preflight");

  const secrets = [target.password, admin.password, process.env.AUTH_TOKEN_SECRET].filter(Boolean);
  const file = arg("file") ? path.resolve(ROOT, arg("file")) : latestBackup(target.database);
  if (!file || !fs.existsSync(file)) {
    fail("未找到备份文件；请先 npm run ops:backup，或用 --file 指定路径");
    return;
  }

  const steps = [];
  const created = [];
  const granted = [];
  let apiHandle;
  const step = (name, ok, detail) => {
    steps.push({ name, ok, detail });
    log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `：${detail}` : ""}`);
  };

  log(`OPS-01C 升级与回滚演练：源库 ${target.database}（只读）`);
  try {
    // ---------- 1. 验证备份 ----------
    const body = fs.readFileSync(file);
    if (!body.length) throw new OpsTargetError(`备份文件为空：${path.relative(ROOT, file)}`);
    const sidecar = `${file}.sha256`;
    if (!fs.existsSync(sidecar)) {
      throw new OpsTargetError("缺少 .sha256 旁文件：升级演练必须基于**已验证**的备份，不接受来源不明的产物");
    }
    const expected = fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
    const actual = crypto.createHash("sha256").update(body).digest("hex");
    if (expected !== actual) throw new OpsTargetError(`备份校验和不匹配：期望 ${expected}，实际 ${actual}`);
    step("备份校验和匹配", true, `${path.relative(ROOT, file)} / ${actual.slice(0, 16)}…`);

    // ---------- 2. 恢复到升级克隆库 ----------
    const upgradeDb = buildCloneDatabaseName(target.database, "upgrade");
    if (sql(admin, `SHOW DATABASES LIKE '${upgradeDb}'`)) {
      throw new OpsTargetError(`克隆库 ${upgradeDb} 已存在，拒绝复用既有库`);
    }
    sql(admin, `CREATE DATABASE \`${upgradeDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created.push(upgradeDb);
    const script = rewriteBackupForTarget(body.toString("utf8"), target.database, upgradeDb);
    const load = runMysql("mysql", admin, [upgradeDb], { input: script });
    if (load.status !== 0) {
      throw new OpsTargetError(`导入失败：${redact(String(load.stderr ?? ""), secrets)}`);
    }
    const restored = verifyClone((statement) => sql(admin, statement), target.database, upgradeDb);
    step("恢复到升级克隆库", true, `${upgradeDb}｜表 ${restored.targetTables}｜迁移 ${restored.targetMigrations}｜${restored.sampled.join("，")}`);

    // ---------- 3. migrate deploy（只作用于克隆库） ----------
    // 迁移用**管理账号**执行，与真实发布一致：DDL 由特权账号做，应用账号不该持有。
    // 而 API 仍以应用账号连接，因此要把克隆库的读写权限授给它——新建的库对应用账号
    // 默认不可见（实测 P1010 Access denied）。授权在清理阶段回收。
    const cloneUrlFor = (user, password) => buildDatabaseUrl(
      loadDatabaseUrl(),
      { user, password, database: upgradeDb }
    );
    const adminUrl = cloneUrlFor(admin.user, admin.password);
    const appUrl = cloneUrlFor(target.user, target.password);
    const appAccount = `${quoteSqlString(target.user)}@'%'`;
    sql(admin, `GRANT ALL PRIVILEGES ON \`${upgradeDb}\`.* TO ${appAccount}`);
    granted.push(upgradeDb);
    sql(admin, "FLUSH PRIVILEGES");
    const appProbe = sql(target, "SELECT 1", { database: upgradeDb });
    if (appProbe !== "1") throw new OpsTargetError("应用账号无法读取升级克隆库，拒绝启动健康检查");
    step("应用账号克隆库连通", true, `${upgradeDb} / SELECT 1`);
    const deploy = runPackageCommand("npx", ["prisma", "migrate", "deploy"], {
      cwd: API_DIR,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: adminUrl }
    });
    const deployOut = redact(`${deploy.stdout ?? ""}${deploy.stderr ?? ""}`, secrets);
    if (deploy.status !== 0) {
      throw new OpsTargetError(`克隆库 migrate deploy 失败：${deployOut.split(/\r?\n/).slice(-4).join(" ")}`);
    }
    const appliedNow = Number(sql(admin, `SELECT COUNT(*) FROM \`${upgradeDb}\`._prisma_migrations WHERE finished_at IS NOT NULL`));
    const newlyApplied = appliedNow - restored.targetMigrations;
    if (newlyApplied < 0) {
      throw new OpsTargetError(`升级后迁移条数从 ${restored.targetMigrations} 降为 ${appliedNow}，拒绝继续`);
    }
    const verifiedAfterDeploy = verifyClone(
      (statement) => sql(admin, statement),
      target.database,
      upgradeDb,
      { expectSameMigrations: false }
    );
    // 新增 0 条不是失败——它只说明这份备份已经包含全部迁移。但必须说清楚，
    // 否则「migrate deploy 通过」会被读成「升级路径已验证」，而实际什么都没升。
    step("克隆库 migrate deploy", true,
      newlyApplied > 0
        ? `已应用 ${appliedNow} 条（本次新增 ${newlyApplied} 条）；源库未被迁移`
        : `已应用 ${appliedNow} 条，本次新增 0 条——备份时点已含全部迁移，`
          + "本次只证明 deploy 在克隆库上可干净执行，未实际演练迁移变更；源库未被迁移");
    step("升级后关键表复核", true,
      `表 ${verifiedAfterDeploy.targetTables}｜迁移 ${verifiedAfterDeploy.targetMigrations}｜${verifiedAfterDeploy.sampled.join("，")}`);

    // ---------- 4. 独立端口起 API ----------
    await assertPortFree(DRILL_PORT);
    apiHandle = startApi(appUrl, DRILL_PORT, secrets);
    step("独立端口启动 API", true, `127.0.0.1:${DRILL_PORT}（临时进程，不替换任何运行实例）`);

    // ---------- 5. 健康检查 ----------
    const health = await probeHealth(DRILL_PORT, apiHandle.child);
    if (!health.ok) {
      throw new OpsTargetError(
        `健康检查未通过（${HEALTH_PATH} 在 ${health.attempt} 次尝试内未回 status=ok；`
        + `最后 HTTP ${health.status ?? "无响应"}、status=${JSON.stringify(health.health ?? null)}`
        + `${health.processExitCode === undefined ? "" : `、进程退出码=${health.processExitCode}`}）。`
        + `进程输出末尾：${apiHandle.output().split(/\r?\n/).filter(Boolean).slice(-4).join(" | ")}`
      );
    }
    step("健康检查", true, `${HEALTH_PATH} → HTTP ${health.status}，status=${health.health}（第 ${health.attempt} 次尝试）`);

    // ---------- 6. 回滚演练：恢复到**另一个**新库 ----------
    const rollbackDb = buildCloneDatabaseName(target.database, "rollback");
    if (rollbackDb === upgradeDb) throw new OpsTargetError("回滚库与升级库同名，拒绝执行");
    if (sql(admin, `SHOW DATABASES LIKE '${rollbackDb}'`)) {
      throw new OpsTargetError(`回滚库 ${rollbackDb} 已存在，拒绝复用既有库`);
    }
    sql(admin, `CREATE DATABASE \`${rollbackDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created.push(rollbackDb);
    const rollbackScript = rewriteBackupForTarget(body.toString("utf8"), target.database, rollbackDb);
    const rollbackLoad = runMysql("mysql", admin, [rollbackDb], { input: rollbackScript });
    if (rollbackLoad.status !== 0) {
      throw new OpsTargetError(`回滚库导入失败：${redact(String(rollbackLoad.stderr ?? ""), secrets)}`);
    }
    const rolledBack = verifyClone((statement) => sql(admin, statement), target.database, rollbackDb);
    // 回滚库必须停在**升级前**的迁移条数：如果它也被 deploy 过，就不是回滚点了。
    if (rolledBack.targetMigrations !== restored.targetMigrations) {
      throw new OpsTargetError(
        `回滚库迁移条数 ${rolledBack.targetMigrations} 与备份时点 ${restored.targetMigrations} 不一致，不能作为回滚点`
      );
    }
    step("回滚演练（恢复到新库，不写 down migration）", true,
      `${rollbackDb}｜停在备份时点迁移 ${rolledBack.targetMigrations} 条`);

    // ---------- 7. 结果 ----------
    const keep = flag("keep") || process.env.OPS_KEEP_DRILL === "1";
    const report = {
      task: "OPS-01C",
      kind: "upgrade-rollback-drill",
      generatedAt: new Date().toISOString(),
      sourceDatabase: { name: target.database, mutated: false, note: "全程只读，未执行任何写入或迁移" },
      backup: { file: path.relative(ROOT, file), sha256: actual },
      upgradeClone: {
        database: upgradeDb,
        migrationsAtRestore: restored.targetMigrations,
        migrationsAfterDeploy: appliedNow,
        newlyApplied,
        tableCountAfterDeploy: verifiedAfterDeploy.targetTables,
        sampledRowsAfterDeploy: verifiedAfterDeploy.sampled,
        health: { path: HEALTH_PATH, port: DRILL_PORT, httpStatus: health.status, reported: health.health, attempt: health.attempt },
        upgradeExercised: newlyApplied > 0,
        upgradeNote: newlyApplied > 0
          ? "本次实际应用了新迁移，升级路径已在克隆库上演练"
          : "备份时点已含全部迁移，本次未实际应用新迁移；要演练真实升级需用早于待应用迁移的备份"
      },
      rollbackClone: {
        database: rollbackDb,
        migrations: rolledBack.targetMigrations,
        strategy: "从同一份已验证备份恢复出干净库；不写 down migration，不覆盖源库"
      },
      manualCutover: [
        `0. 这是演练生成的人工切换模板；本次克隆库${keep ? "按 --keep 保留，可供继续核查" : "将在成功后删除，不能直接作为可切换目标"}。`,
        `1. 停止写入：将应用置为维护态（本脚本不做，也不会停止任何运行中的服务）。`,
        `2. 确认目标：升级后使用 ${upgradeDb}；需要回退时使用 ${rollbackDb}。`,
        `3. 切换连接：把 DATABASE_URL 的库名改为目标库，逐个实例重启（人工执行）。`,
        `4. 复检：对新连接跑 ops:release-gate 与 ${HEALTH_PATH}，确认迁移状态与健康均正常。`,
        `5. 留痕：记录切换时间、执行人、目标库与本报告文件名。`,
        `6. 收尾：确认稳定后再删除不再需要的克隆库；本脚本不会替你删除已保留的库。`
      ],
      steps: steps.map(({ name, ok }) => ({ name, ok })),
      notCovered: ["生产切流与灰度", "密钥托管", "监控告警", "异地/离线备份", "跨实例一致性恢复"]
    };
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const stamp = report.generatedAt.replace(/[-:T]/g, "").slice(0, 14);
    const reportFile = path.join(ARTIFACT_DIR, `upgrade-drill-${stamp}.json`);
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    log(`\n报告：${path.relative(ROOT, reportFile)}`);

    log("\n人工切换步骤（脚本不代劳）：");
    for (const line of report.manualCutover) log(`  ${line}`);

    // ---------- 8. 清理：只删本次创建且已验证成功的资源 ----------
    if (apiHandle) { apiHandle.child.kill(); apiHandle = undefined; }
    if (keep) {
      log(`\n✓ 演练通过。按要求保留克隆库：${created.join("、")}`);
      for (const db of created) {
        if (granted.includes(db)) log(`  清理 1：REVOKE ALL PRIVILEGES ON \`${db}\`.* FROM ${appAccount};`);
        log(`  清理 ${granted.includes(db) ? "2" : "1"}：DROP DATABASE \`${db}\`;`);
      }
    } else {
      for (const db of created) {
        // 双重判定：既要是本次 created 列表里的，也要符合本工具的克隆库形态。
        if (!isOwnedCloneDatabase(db)) throw new OpsTargetError(`拒绝删除：${db} 不符合本工具克隆库形态`);
        // 先回收授权再删库：DROP DATABASE 不会清 mysql.db 里的库级授权，
        // 顺序反了会留下一条指向已删库的孤立授权。
        if (granted.includes(db)) sql(admin, `REVOKE ALL PRIVILEGES ON \`${db}\`.* FROM ${appAccount}`);
        sql(admin, `DROP DATABASE \`${db}\``);
      }
      if (granted.length) sql(admin, "FLUSH PRIVILEGES");
      log(`\n✓ 演练通过，已删除本次创建的克隆库：${created.join("、")}`);
    }
    log(`  源库未被修改：${target.database}`);
  } catch (error) {
    if (apiHandle) apiHandle.child.kill();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ 升级/回滚演练失败：${redact(message, secrets)}`);
    if (created.length) {
      console.error("  以下克隆库按设计**保留**供排查（失败时不自动删除）：");
      for (const db of created) console.error(`    - ${db}    清理：DROP DATABASE \`${db}\`;`);
      for (const db of granted) {
        console.error(`      该库已授权给应用账号，删库前先回收：REVOKE ALL PRIVILEGES ON \`${db}\`.* FROM ${quoteSqlString(target.user)}@'%';`);
      }
    } else {
      console.error("  本次未创建任何克隆库，无残留。");
    }
    console.error(`  源库未被本脚本修改：${target.database}`);
    console.error("  不要用 schema 回滚冒充数据恢复：先确认备份可用，再决定修迁移还是切到回滚库（见 OPS-01A §5）。");
    process.exit(1);
  }
})();
