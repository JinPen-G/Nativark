"use strict";

/**
 * OPS-01C `upgrade-drill`：在**克隆库**上演练升级与回滚。
 *
 * 一次完整演练：
 *   验证备份 → 恢复配对克隆库 → 升级库 migrate deploy → 可信宿主重放删除标记
 *   → 分别核全部 scope 的签名证书 → 独立端口起 API → 健康检查 → 输出人工切换步骤。
 *   AI 恢复首次保留隔离库和最少接续记录；可信重放后沿原备份和记录继续，不重复导入。
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
const { rewriteBackupForTarget, verifyClone, BUSINESS_SAMPLE_TABLES } = require("./restore-core.cjs");
const { assertRestoreAiBarrier, readRetentionCertificates } = require("./ai-retention.cjs");
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

/** 接续只定位本演练的配对克隆库。删除账本和签名权限仍来自可信外部宿主。 */
function readUpgradeContinuation(value, sourceDatabase, backupSha256) {
  const file = path.resolve(ROOT, value), relative = path.relative(path.resolve(ARTIFACT_DIR), file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    || path.extname(file) !== ".json") throw new OpsTargetError("升级恢复接续记录不在本工具制品目录");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8192) {
    throw new OpsTargetError("升级恢复接续记录不合法");
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let journal;
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) throw new OpsTargetError("升级恢复接续记录已变化");
    const bytes = Buffer.alloc(stat.size + 1), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length !== stat.size) throw new OpsTargetError("升级恢复接续记录未完整读取");
    journal = JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally { fs.closeSync(fd); }
  const keys = ["version", "sourceDatabase", "backupSha256", "upgradeDatabase", "rollbackDatabase", "preparedMigrationCount"];
  if (!journal || typeof journal !== "object" || Array.isArray(journal) || Object.keys(journal).some(key => !keys.includes(key))
    || journal.version !== "ops-ai-upgrade-restore-1" || journal.sourceDatabase !== sourceDatabase || journal.backupSha256 !== backupSha256
    || !Number.isSafeInteger(journal.preparedMigrationCount) || journal.preparedMigrationCount < 0) {
    throw new OpsTargetError("升级恢复接续记录与原源库或备份不匹配");
  }
  const prefix = kind => buildCloneDatabaseName(sourceDatabase, kind, new Date("2000-01-01T00:00:00Z")).slice(0, -14);
  if (typeof journal.upgradeDatabase !== "string" || !journal.upgradeDatabase.startsWith(prefix("upgrade"))
    || !/^[0-9]{14}$/u.test(journal.upgradeDatabase.slice(prefix("upgrade").length))
    || journal.rollbackDatabase !== `${prefix("rollback")}${journal.upgradeDatabase.slice(-14)}`
    || !isOwnedCloneDatabase(journal.upgradeDatabase) || !isOwnedCloneDatabase(journal.rollbackDatabase)
    || path.basename(file) !== `upgrade-drill-ai-${journal.upgradeDatabase}.json`) {
    throw new OpsTargetError("升级恢复接续记录未绑定原配对克隆库");
  }
  return { file, journal };
}

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
    throw new OpsTargetError("缺少 apps/api/dist/main.js，先跑 npm run build:legacy（OPS-01B 门禁也会检查产物）");
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
  const finalizing = arg("finalize-ai");
  if (finalizing && !arg("file")) { fail("升级恢复接续必须用 --file 指定原备份"); return; }
  const file = arg("file") ? path.resolve(ROOT, arg("file")) : latestBackup(target.database);
  if (!file || !fs.existsSync(file)) {
    fail("未找到备份文件；请先 npm run ops:backup，或用 --file 指定路径");
    return;
  }

  const steps = [];
  const created = [];
  const granted = [];
  const dropped = [];
  let apiHandle;
  let continuationFile;
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

    // ---------- 2. 创建或接续同一份备份的配对克隆库 ----------
    const saved = finalizing ? readUpgradeContinuation(finalizing, target.database, actual) : undefined;
    const cloneStamp = new Date();
    const upgradeDb = saved?.journal.upgradeDatabase || buildCloneDatabaseName(target.database, "upgrade", cloneStamp);
    const rollbackDb = saved?.journal.rollbackDatabase || buildCloneDatabaseName(target.database, "rollback", cloneStamp);
    let restored, rolledBack;
    if (saved) {
      for (const database of [upgradeDb, rollbackDb]) {
        if (!sql(admin, `SHOW DATABASES LIKE '${database}'`)) throw new OpsTargetError(`原接续克隆库 ${database} 不存在`);
        created.push(database);
      }
      rolledBack = verifyClone((statement) => sql(admin, statement), target.database, rollbackDb);
      restored = rolledBack;
      continuationFile = saved.file;
      step("原配对克隆库接续", true, `${upgradeDb} / ${rollbackDb}；不重复导入或迁移`);
    } else {
      if (sql(admin, `SHOW DATABASES LIKE '${upgradeDb}'`)) throw new OpsTargetError(`克隆库 ${upgradeDb} 已存在，拒绝复用既有库`);
      sql(admin, `CREATE DATABASE \`${upgradeDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      created.push(upgradeDb);
      const script = rewriteBackupForTarget(body.toString("utf8"), target.database, upgradeDb);
      const load = runMysql("mysql", admin, [upgradeDb], { input: script });
      if (load.status !== 0) throw new OpsTargetError(`导入失败：${redact(String(load.stderr ?? ""), secrets)}`);
      restored = verifyClone((statement) => sql(admin, statement), target.database, upgradeDb);
      step("恢复到升级克隆库", true, `${upgradeDb}｜表 ${restored.targetTables}｜迁移 ${restored.targetMigrations}｜${restored.sampled.join("，")}`);
      if (rollbackDb === upgradeDb || sql(admin, `SHOW DATABASES LIKE '${rollbackDb}'`)) {
        throw new OpsTargetError(`回滚克隆库 ${rollbackDb} 与升级库冲突或已存在`);
      }
      sql(admin, `CREATE DATABASE \`${rollbackDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      created.push(rollbackDb);
      const rollbackScript = rewriteBackupForTarget(body.toString("utf8"), target.database, rollbackDb);
      const rollbackLoad = runMysql("mysql", admin, [rollbackDb], { input: rollbackScript });
      if (rollbackLoad.status !== 0) throw new OpsTargetError(`回滚库导入失败：${redact(String(rollbackLoad.stderr ?? ""), secrets)}`);
      rolledBack = verifyClone((statement) => sql(admin, statement), target.database, rollbackDb);
    }

    // ---------- 3. migrate deploy（只作用于克隆库） ----------
    // 迁移用**管理账号**执行，与真实发布一致：DDL 由特权账号做，应用账号不该持有。
    // 原删除标记重放和全部 scope 证书核验前，应用账号继续保持隔离。
    const cloneUrlFor = (user, password) => buildDatabaseUrl(
      loadDatabaseUrl(),
      { user, password, database: upgradeDb }
    );
    const adminUrl = cloneUrlFor(admin.user, admin.password);
    const appUrl = cloneUrlFor(target.user, target.password);
    const appAccount = `${quoteSqlString(target.user)}@'%'`;
    if (!saved) {
      const deploy = runPackageCommand("npx", ["prisma", "migrate", "deploy"], {
        cwd: API_DIR, encoding: "utf8", env: { ...process.env, DATABASE_URL: adminUrl }
      });
      const deployOut = redact(`${deploy.stdout ?? ""}${deploy.stderr ?? ""}`, secrets);
      if (deploy.status !== 0) throw new OpsTargetError(`克隆库 migrate deploy 失败：${deployOut.split(/\r?\n/).slice(-4).join(" ")}`);
    }
    const appliedNow = Number(sql(admin, `SELECT COUNT(*) FROM \`${upgradeDb}\`._prisma_migrations WHERE finished_at IS NOT NULL`));
    if (saved && appliedNow !== saved.journal.preparedMigrationCount) throw new OpsTargetError("原接续升级库的迁移基线已变化，需重新核验可信重放");
    const newlyApplied = appliedNow - restored.targetMigrations;
    if (newlyApplied < 0) {
      throw new OpsTargetError(`升级后迁移条数从 ${restored.targetMigrations} 降为 ${appliedNow}，拒绝继续`);
    }
    // 升级后只比**业务表**行数：`_prisma_migrations` 与表数量在升级后必然增长，
    // 把它们混进「必须一致」的比对里，会让一次成功的升级被判成失败（实测踩过）。
    // 业务数据必须一行不差——升级不该丢数据。
    const verifiedAfterDeploy = verifyClone(
      (statement) => sql(admin, statement),
      target.database,
      upgradeDb,
      { expectSameMigrations: false, sampleTables: BUSINESS_SAMPLE_TABLES }
    );
    // 新增 0 条不是失败——它只说明这份备份已经包含全部迁移。但必须说清楚，
    // 否则「migrate deploy 通过」会被读成「升级路径已验证」，而实际什么都没升。
    step(saved ? "原升级迁移基线复核" : "克隆库 migrate deploy", true,
      newlyApplied > 0
        ? `已应用 ${appliedNow} 条（本次新增 ${newlyApplied} 条）；源库未被迁移`
        : `已应用 ${appliedNow} 条，本次新增 0 条——备份时点已含全部迁移，`
          + "本次只证明 deploy 在克隆库上可干净执行，未实际演练迁移变更；源库未被迁移");
    step("升级后关键表复核", true,
      `表 ${verifiedAfterDeploy.targetTables}｜迁移 ${verifiedAfterDeploy.targetMigrations}｜${verifiedAfterDeploy.sampled.join("，")}`);

    // 回滚保留备份时点的兼容结构，也必须独立重放并核证；缺结构或证据保持隔离。
    if (rolledBack.targetMigrations !== restored.targetMigrations) throw new OpsTargetError("回滚库未保持原备份迁移基线");
    step("回滚演练（恢复到新库，不写 down migration）", true,
      `${rollbackDb}｜停在备份时点迁移 ${rolledBack.targetMigrations} 条`);
    if (!saved) {
      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
      continuationFile = path.resolve(ARTIFACT_DIR, `upgrade-drill-ai-${upgradeDb}.json`);
      fs.writeFileSync(continuationFile, `${JSON.stringify({ version: "ops-ai-upgrade-restore-1", sourceDatabase: target.database,
        backupSha256: actual, upgradeDatabase: upgradeDb, rollbackDatabase: rollbackDb, preparedMigrationCount: appliedNow }, null, 2)}\n`, { flag: "wx" });
    }
    // 首次 AI 恢复只准备隔离库。证书来自后续可信宿主重放，不从克隆快照补造账本。
    const certificates = name => saved && arg(name) ? readRetentionCertificates(path.resolve(ROOT, arg(name))) : undefined;
    const publicKey = process.env.OPS_AI_RETENTION_PUBLIC_KEY;
    const upgradePrivacy = assertRestoreAiBarrier(statement => sql(admin, statement), upgradeDb, actual,
      certificates("ai-retention-certificates"), publicKey);
    const rollbackPrivacy = assertRestoreAiBarrier(statement => sql(admin, statement), rollbackDb, actual,
      certificates("rollback-ai-retention-certificates"), publicKey);
    step("升级与回滚隐私屏障", true, `${upgradeDb} / ${upgradePrivacy.state}；${rollbackDb} / ${rollbackPrivacy.state}`);

    // ---------- 4. 独立端口起 API ----------
    await assertPortFree(DRILL_PORT);
    granted.push(upgradeDb);
    sql(admin, `GRANT ALL PRIVILEGES ON \`${upgradeDb}\`.* TO ${appAccount}`);
    sql(admin, "FLUSH PRIVILEGES");
    const appProbe = sql(target, "SELECT 1", { database: upgradeDb });
    if (appProbe !== "1") throw new OpsTargetError("应用账号无法读取升级克隆库，拒绝启动健康检查");
    step("应用账号克隆库连通", true, `${upgradeDb} / SELECT 1`);
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

    // ---------- 7. 结果 ----------
    const keep = flag("keep") || process.env.OPS_KEEP_DRILL === "1";
    const report = {
      task: "OPS-01C",
      kind: "upgrade-rollback-drill",
      generatedAt: new Date().toISOString(),
      sourceDatabase: { name: target.database, mutated: false, note: "全程只读，未执行任何写入或迁移" },
      backup: { file: path.relative(ROOT, file), sha256: actual },
      privacyBarrier: { upgrade: upgradePrivacy, rollback: rollbackPrivacy },
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
        `3. 目标仍须保持隔离：以当前快照外删除账本重放，使用服务器 OPS_AI_RETENTION_PUBLIC_KEY 独立核验该目标全部 scope、原 dump 和 60 秒内证书，再授应用访问。`,
        `4. 切换连接：确认隐私屏障通过后把 DATABASE_URL 的库名改为目标库，逐个实例重启（人工执行）。`,
        `5. 复检：对新连接跑 ops:release-gate 与 ${HEALTH_PATH}，确认迁移状态与健康均正常。`,
        `6. 留痕：记录切换时间、执行人、目标库与本报告文件名。`,
        `7. 收尾：确认稳定后再删除不再需要的克隆库；本脚本不会替你删除已保留的库。`
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
    // 临时 API 结束就回收本次授予的权限；--keep 只保留经核验的克隆库。
    for (const db of [...granted]) {
      sql(admin, `REVOKE ALL PRIVILEGES ON \`${db}\`.* FROM ${appAccount}`);
      granted.splice(granted.indexOf(db), 1);
    }
    sql(admin, "FLUSH PRIVILEGES");
    if (keep) {
      log(`\n✓ 演练通过。按要求保留克隆库：${created.join("、")}`);
      for (const db of created) {
        log(`  清理：DROP DATABASE \`${db}\`;`);
      }
    } else {
      for (const db of created) {
        // 只处理本次创建或原接续记录确认的配对克隆库，仍须符合专用库形态。
        if (!isOwnedCloneDatabase(db)) throw new OpsTargetError(`拒绝删除：${db} 不符合本工具克隆库形态`);
        sql(admin, `DROP DATABASE \`${db}\``);
        dropped.push(db);
      }
      if (continuationFile) fs.unlinkSync(continuationFile);
      log(`\n✓ 演练通过，已删除本次创建的克隆库：${created.join("、")}`);
    }
    log(`  源库未被修改：${target.database}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ 升级/回滚演练失败：${redact(message, secrets)}`);
    const remaining = created.filter(db => !dropped.includes(db));
    if (remaining.length) {
      console.error("  以下克隆库按设计**保留**供排查（失败时不自动删除）：");
      for (const db of remaining) console.error(`    - ${db}    清理：DROP DATABASE \`${db}\`;`);
      if (continuationFile) console.error(`  可信宿主完成两库删除标记重放后，以同一 --file、--finalize-ai ${path.relative(ROOT, continuationFile)}、--ai-retention-certificates <升级证书数组.json> 和 --rollback-ai-retention-certificates <回滚证书数组.json> 接续。`);
    } else {
      console.error("  本次没有未清理的克隆库。");
    }
    console.error(`  源库未被本脚本修改：${target.database}`);
    console.error("  不要用 schema 回滚冒充数据恢复：先确认备份可用，再决定修迁移还是切到回滚库（见 OPS-01A §5）。");
    process.exitCode = 1;
  } finally {
    if (apiHandle) {
      try { apiHandle.child.kill(); }
      catch (error) {
        console.error(`  临时 API 停止失败：${redact(error instanceof Error ? error.message : String(error), secrets)}`);
        process.exitCode = 1;
      }
    }
    for (const db of granted) {
      try {
        sql(admin, `REVOKE ALL PRIVILEGES ON \`${db}\`.* FROM ${quoteSqlString(target.user)}@'%';`);
        sql(admin, "FLUSH PRIVILEGES");
      } catch (error) {
        console.error(`  临时应用授权回收失败，仍须核对 ${db}：${redact(error instanceof Error ? error.message : String(error), secrets)}`);
        process.exitCode = 1;
      }
    }
  }
})();
