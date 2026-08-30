"use strict";

/**
 * OPS-01B `release-gate`：固定发布候选并跑只读门禁。
 *
 * 默认 **dry-run / 只读**：只观察与记录，不迁移、不启动、不替换任何服务。
 * 需要写出清单文件时必须显式 `--emit`——这是本脚本唯一的写盘动作，
 * 且只写到 gitignore 的 artifacts 目录。
 *
 * 为什么门禁本身不做迁移：发布前最该知道的是「差什么」，而不是「已经替我改了」。
 * 把检查和应用绑在一起，任何一次想看状态的执行都会顺手改库。
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { redact, rejectionReason } = require("./dedicated-env.cjs");
const { ROOT, readEnvFile, loadDatabaseUrl, requireTarget, assertContainerEndpoint, log, hasCommand, runPackageCommand } = require("./runtime.cjs");
const {
  RELEASE_ENV_VARS,
  HEALTH_ENTRYPOINTS,
  inspectEnvNames,
  summarizeWorktree,
  inspectBuildProvenance,
  assertNoSecrets
} = require("./release-facts.cjs");
const { ARTIFACT_DIR, summarizeBuilds, readBuildProvenance } = require("./release-artifacts.cjs");

const flag = (name) => process.argv.includes(`--${name}`);

function run(command, args, options = {}) {
  const settings = { cwd: ROOT, encoding: "utf8", ...options };
  const result = ["npm", "npx"].includes(command)
    ? runPackageCommand(command, args, settings)
    : spawnSync(command, args, settings);
  return { status: result.status, out: String(result.stdout ?? "").trim(), err: String(result.stderr ?? "").trim() };
}

function toolVersions() {
  const node = process.version;
  const npm = run("npm", ["--version"]).out || "未知";
  // Prisma 版本取自锁定的依赖声明，而不是全局 CLI：发布要固定的是**仓库锁定**的版本。
  const apiPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "api", "package.json"), "utf8"));
  const prisma = apiPkg.devDependencies?.prisma ?? apiPkg.dependencies?.prisma ?? "未声明";
  const client = apiPkg.dependencies?.["@prisma/client"] ?? "未声明";
  return { node, npm, prisma, prismaClient: client };
}

void (async () => {
  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `：${detail}` : ""}`);
    return ok;
  };

  log("OPS-01B 发布候选门禁（默认只读，不迁移、不启动服务）");

  // ---------- 1. 固定 Git 提交 ----------
  const head = run("git", ["rev-parse", "HEAD"]).out;
  const shortHead = run("git", ["rev-parse", "--short", "HEAD"]).out;
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  const commitTime = run("git", ["show", "-s", "--format=%cI", "HEAD"]).out;
  const worktree = summarizeWorktree(run("git", ["status", "--porcelain"]).out);
  record("Git 提交已固定", Boolean(head), `${shortHead} @ ${branch}`);
  record(
    "工作区干净",
    worktree.clean,
    worktree.clean ? "无未提交改动" : `${worktree.changedCount} 项未提交：${worktree.changed.join(", ")}`
  );

  // ---------- 2. 工具链版本 ----------
  const versions = toolVersions();
  record("Node / npm 版本已记录", Boolean(versions.node && versions.npm !== "未知"), `node ${versions.node} / npm ${versions.npm}`);
  record(
    "Prisma 版本已锁定",
    versions.prisma !== "未声明" && versions.prismaClient !== "未声明",
    `prisma ${versions.prisma} / client ${versions.prismaClient}`
  );

  // ---------- 3. 构建产物摘要 ----------
  const builds = summarizeBuilds();
  for (const build of builds) {
    record(
      `构建产物存在并可摘要：${build.name}`,
      build.fileCount > 0 && Boolean(build.digest),
      build.fileCount ? `${build.fileCount} 个文件 / ${build.totalBytes} 字节 / ${build.digest.slice(0, 16)}…` : "产物缺失，先跑 npm run build"
    );
  }
  // 清单里只保留总摘要与计数，不逐文件展开：几千行文件表会把清单变成噪声。
  const buildSummary = builds.map(({ name, dir, fileCount, totalBytes, digest }) => ({ name, dir, fileCount, totalBytes, digest }));
  const provenance = inspectBuildProvenance(readBuildProvenance(), head, buildSummary);
  record(
    "构建产物来自当前 Git 提交",
    provenance.ok,
    provenance.ok ? `${shortHead} 的显式发布构建，摘要一致` : provenance.problems.join("；")
  );

  // ---------- 4. 环境变量名（只记名，不记值） ----------
  const env = { ...readEnvFile(".env"), ...process.env };
  const envNames = inspectEnvNames(env);
  record(
    "必需环境变量已配置",
    envNames.missing.length === 0,
    envNames.missing.length ? `缺少 ${envNames.missing.join(", ")}` : `${envNames.present.length} 项已就位（只校验存在性）`
  );
  if (envNames.optionalMissing.length) {
    log(`  · 可选变量未设置（使用默认值）：${envNames.optionalMissing.join(", ")}`);
  }

  // ---------- 5. 目标库守卫与迁移状态（只读） ----------
  let target;
  let migrationState = { checked: false };
  try {
    target = assertContainerEndpoint(requireTarget());
    record("目标库通过专用库守卫", true, target.database);
  } catch (error) {
    record("目标库通过专用库守卫", false, error instanceof Error ? error.message : String(error));
  }
  if (target) {
    const status = run("npx", ["prisma", "migrate", "status"], {
      cwd: path.join(ROOT, "apps", "api"),
      env: { ...process.env, DATABASE_URL: loadDatabaseUrl() }
    });
    const output = redact(`${status.out}\n${status.err}`, [target.password]);
    const pending = /have not yet been applied/u.test(output);
    migrationState = {
      checked: true,
      upToDate: status.status === 0 && !pending,
      pending,
      // 只留结论行，避免把整段 prisma 输出（含被掩码的库名）塞进清单。
      summary: pending ? "存在未应用迁移" : status.status === 0 ? "已同步" : "检查未通过"
    };
    record(
      "迁移状态（只读，不自动应用）",
      migrationState.upToDate,
      migrationState.summary + (pending ? "；发布前需人工决定 deploy 时机（见 OPS-01A §5）" : "")
    );
  }

  // ---------- 6. 配置与健康检查入口 ----------
  record("docker 可用（部署前置）", hasCommand("docker"), "仅检查存在，不启动任何容器");
  record(
    "健康检查入口已登记",
    HEALTH_ENTRYPOINTS.length > 0,
    HEALTH_ENTRYPOINTS.map((row) => row.path).join(" / ")
  );

  // ---------- 7. 清单 ----------
  const manifest = {
    task: "OPS-01B",
    kind: "release-candidate",
    generatedAt: new Date().toISOString(),
    mode: flag("emit") ? "emit" : "dry-run",
    git: { commit: head, shortCommit: shortHead, branch, commitTime, worktreeClean: worktree.clean, changedCount: worktree.changedCount },
    toolchain: versions,
    builds: buildSummary,
    buildProvenance: { verified: provenance.ok, commit: provenance.ok ? head : undefined },
    env: {
      declared: RELEASE_ENV_VARS.map(({ name, required, purpose }) => ({ name, required, purpose })),
      present: envNames.present,
      missingRequired: envNames.missing,
      missingOptional: envNames.optionalMissing
    },
    database: target ? { database: target.database, guard: "passed", endpoint: `${target.host}:${target.port}` } : { guard: "failed" },
    migrations: migrationState,
    healthEntrypoints: HEALTH_ENTRYPOINTS,
    checks: checks.map(({ name, ok }) => ({ name, ok })),
    notCovered: [
      "生产切流与环境晋级流水线",
      "密钥托管（当前依赖本地 env）",
      "监控告警与周期性巡检",
      "异地/离线备份与保留期自动执行"
    ]
  };

  const secrets = [target?.password, env.AUTH_TOKEN_SECRET, env.DATABASE_URL, env.MYSQL_ROOT_PASSWORD].filter(Boolean);
  try {
    assertNoSecrets(manifest, secrets);
  } catch (error) {
    console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (flag("emit")) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const stamp = manifest.generatedAt.replace(/[-:T]/g, "").slice(0, 14);
    const file = path.join(ARTIFACT_DIR, `release-candidate-${shortHead || "unknown"}-${stamp}.json`);
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    log(`\n清单已写出：${path.relative(ROOT, file)}`);
  } else {
    log("\n（dry-run：未写出清单文件；加 --emit 才落盘）");
  }

  const failed = checks.filter((check) => !check.ok);
  if (failed.length) {
    console.error(`\n✗ 发布门禁未通过：${failed.length} 项失败`);
    for (const check of failed) console.error(`  - ${check.name}`);
    console.error("门禁只报告，不代劳：迁移、切流与服务替换都由人工按 OPS-01A/01C 的步骤执行。");
    process.exit(1);
  }
  log("\n✓ 发布门禁通过：提交、产物摘要、工具链、环境变量名、迁移状态与健康入口均已固定");
})();
