"use strict";

/** 从固定双仓与原发行生成 Rental 镜像交接。选择在副作用前核定，未接通的正式能力拒绝制包。 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const { registerHooks } = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { CONTEXT_FILE, isFullCommit, isPackagePath, isSha256, readJson, sha256, verifyPreparedRental } = require("./release-composition.cjs");
const { digestFiles } = require("./release-facts.cjs");
const { requireReleaseTag } = require("./release-image-pair.cjs");
const { readReleaseFiles } = require("./release-verify.cjs");
const { withReleaseDependencies } = require("./release-dependencies.cjs");

const CORE = "packages/rental-core/";
const SOURCE = "development.workspace.json";
const DEPLOYMENT = "apps/rental-api/prisma-deployment/";
const BASE_REPOSITORY = "https://github.com/JinPen-G/Nativark";
const TOOLS = ["prepare-rental-workspace", "rental-build-snapshot", "rental-host-lock", "check-rental-package-build",
  "build-selected-prisma", "verify-rental-distribution", "rental-build-memory", "rental-platform-build", "package-rental-host"];
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function parsePairArguments(args) {
  const mode = args[0], development = mode === "development", count = development ? 6 : 8;
  const [ , platformDir, platformCommit, rentalDir, rentalCommit, taskDir, platformDigest, rentalDigest] = args.slice(0, count);
  if (!["release", "development"].includes(mode) || args.length < count
    || ![platformDir, rentalDir, taskDir].every(value => typeof value === "string" && value.length > 0 && !value.startsWith("--"))
    || ![platformCommit, rentalCommit].every(isFullCommit)
    || !development && ![platformDigest, rentalDigest].every(isSha256)) {
    throw new Error("用法：release-prepare-pair.cjs <release|development> <Zelo目录> <完整SHA> <Rental目录> <完整SHA> <任务目录> [底座归档SHA256 Rental归档SHA256] [--ai disabled|public-retention] [--mcp disabled|enabled] [--ai-data-sha256 SHA256]");
  }
  const flags = new Map();
  for (let index = count; index < args.length; index += 2) {
    const name = args[index], value = args[index + 1];
    if (!["--ai", "--mcp", "--ai-data-sha256"].includes(name) || flags.has(name) || !value || value.startsWith("--")) {
      throw new Error("候选选择存在未知、重复或缺值参数");
    }
    flags.set(name, value);
  }
  const aiMode = flags.get("--ai") ?? "disabled", mcpMode = flags.get("--mcp") ?? "disabled";
  const aiDataSha256 = flags.get("--ai-data-sha256");
  if (!["disabled", "public-retention"].includes(aiMode) || !["disabled", "enabled"].includes(mcpMode)
    || aiMode === "disabled" && (mcpMode !== "disabled" || aiDataSha256 !== undefined)
    || aiMode === "public-retention" && !isSha256(aiDataSha256)) {
    throw new Error("普通组合禁带 AI/MCP 材料；public-retention 须提供独立核收的 AI 数据发行 SHA-256，MCP 须显式选择");
  }
  if (mcpMode === "enabled") throw new Error("公共保留加 MCP 尚无同一正式宿主，data-only 不能作为 HTTP enabled 候选");
  if (development && aiMode !== "disabled") throw new Error("本入口的开发演练仅支持普通组合，公共保留须使用正式两阶段入口");
  return { mode, development, platformDir, platformCommit, rentalDir, rentalCommit, taskDir, platformDigest, rentalDigest, aiMode, mcpMode, aiDataSha256 };
}

function git(directory, ...args) {
  return execFileSync("git", ["--no-replace-objects", "-C", directory, ...args],
    { env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }, timeout: 15000, windowsHide: true });
}

function writeFiles(directory, files) {
  fs.mkdirSync(directory);
  for (const [relative, bytes] of files) {
    if (!isPackagePath(relative)) throw new Error("构建材料包含非法归档路径");
    const file = path.join(directory, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { flag: "wx" });
  }
}

async function bundleWeb(webSource, outDir) {
  const platformConfig = pathToFileURL(`${path.resolve(webSource, "packages/platform-admin/config")}${path.sep}`).href;
  const hook = registerHooks({ resolve(specifier, context, next) {
    const configImport = context.parentURL?.startsWith(platformConfig) && /^\.\/[A-Za-z][A-Za-z0-9-]*$/u.test(specifier);
    return next(configImport ? `${specifier}.ts` : specifier, context);
  } });
  try {
    const vite = await import(pathToFileURL(path.join(webSource, "node_modules/vite/dist/node/index.js")).href);
    await vite.build({ root: path.join(webSource, "apps/rental-admin"), mode: "ai-offline", build: { outDir } });
  } finally {
    hook.deregister();
  }
}

function buildWeb({ repo, task, workspace, apiFiles, inputDir, npmLockSha256, deploymentLockSha256 }) {
  const webSource = path.join(task, "web-source"), webDir = path.join(inputDir, "web");
  const webFiles = new Map([...workspace.files].filter(([file]) => !file.startsWith(CORE) && path.posix.basename(file) !== ".env.example"));
  for (const [file, bytes] of apiFiles) if (file.startsWith(CORE) || /^(?:apps|packages)\/[^/]+\/dist(?:-[a-z0-9-]+)?\//u.test(file)) {
    webFiles.set(file, bytes);
  }
  // 给没有独立 tsconfig 的共用源码限定查找边界，避免继承构建目录外的配置。
  if (!webFiles.has("tsconfig.json")) webFiles.set("tsconfig.json", json({ extends: "./tsconfig.base.json" }));
  writeFiles(webSource, webFiles);
  const npmCli = process.platform === "win32"
    ? path.resolve(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
    : path.resolve(path.dirname(fs.realpathSync(process.execPath)), "../lib/node_modules/npm/bin/npm-cli.js");
  execFileSync(process.execPath, [npmCli, "ci", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", path.join(task, "npm-cache")],
    { cwd: webSource, timeout: 300000, stdio: ["ignore", process.stderr, process.stderr] });
  const temp = path.join(task, "temporary");
  fs.mkdirSync(temp);
  const guard = path.join(repo, "tests/fixtures/ai-native/prisma-offline-preload.cjs");
  const audit = path.join(temp, "web-audit.log");
  const lock = path.join(inputDir, "api", DEPLOYMENT, "core.deployment.lock.json");
  const publicAiData = apiFiles.has("public-ai-data/package.json") ? path.join(inputDir, "api", "public-ai-data") : "";
  const deployment = readJson(apiFiles.get(`${DEPLOYMENT}core.deployment.lock.json`), "API 固定部署锁");
  const selectedMcp = (deployment.lockVersion === 2 ? deployment.base : deployment).dataCapabilities?.some(item => item.id === "mcp") === true;
  if (selectedMcp && (!apiFiles.has("packages/mcp-server/package.json") || !apiFiles.has("packages/mcp-server/data-contribution.json"))) {
    throw new Error("Web 构建缺少 API 同一选择的 MCP 数据包");
  }
  const mcpData = selectedMcp ? path.join(inputDir, "api", "packages/mcp-server") : "";
  execFileSync(process.execPath, ["--require", guard, __filename, "--bundle-web", webSource, webDir], {
    cwd: path.join(webSource, "apps/rental-admin"), timeout: 300000, stdio: ["ignore", process.stderr, process.stderr],
    env: { ...process.env, DATABASE_URL: "mysql://offline:offline@127.0.0.1:1/rental_os_offline", AI_OFFLINE_WRITE_ROOT: task,
      AI_OFFLINE_AUDIT: audit, TEMP: temp, TMP: temp, TMPDIR: temp, XDG_CACHE_HOME: temp, CORE_DEPLOYMENT_LOCK: lock,
      RENTAL_PUBLIC_AI_DATA_PACKAGE_DIR: publicAiData, RENTAL_MCP_DATA_PACKAGE_DIR: mcpData },
  });
  const web = readReleaseFiles(webDir);
  if (!web.get("index.html")?.length || fs.existsSync(audit)
    || sha256(fs.readFileSync(path.join(webSource, "package-lock.json"))) !== npmLockSha256
    || sha256(fs.readFileSync(lock)) !== deploymentLockSha256) {
    throw new Error("Web 构建缺入口、使用了不同的锁或触发了离线守卫");
  }
  const { digest: webFilesSha256 } = digestFiles([...web].map(([file, contents]) => ({ path: file, bytes: contents.length, contents })));
  return { webFilesSha256, webFiles: web.size };
}

async function preparePair(args) {
  const { mode, development, platformDir, platformCommit, rentalDir, rentalCommit, taskDir, platformDigest, rentalDigest, aiMode, aiDataSha256 } = parsePairArguments(args);
  if (process.versions.node !== "24.13.0") throw new Error("Node 须为 24.13.0");
  if (!development && process.platform !== "linux") throw new Error("正式镜像材料须在 Linux 生成以匹配运行归档摘要");
  const repo = fs.realpathSync(platformDir), coreRepo = fs.realpathSync(rentalDir), task = path.resolve(taskDir);
  const toolCommit = git(repo, "rev-parse", "HEAD").toString().trim();
  if (repo === coreRepo || fs.realpathSync(task) !== task || !fs.statSync(task).isDirectory()
    || !development && toolCommit !== platformCommit) throw new Error("须提供独立双仓和固定构建工具目录");
  const existing = development ? [] : ["platform.tgz", "rental.tgz"];
  if (fs.readdirSync(task).some(name => !existing.includes(name))) throw new Error("构建任务目录存在非预期文件");
  process.env.GIT_NO_LAZY_FETCH = "1";
  for (const name of TOOLS) {
    const file = `scripts/${name}.cjs`;
    const actual = path.join(repo, file);
    if (!fs.lstatSync(actual).isFile() || fs.readFileSync(actual, "utf8").replace(/\r\n/gu, "\n") !== git(repo, "show", `${toolCommit}:${file}`).toString("utf8")) {
      throw new Error(`构建工具与固定检出不一致：${file}`);
    }
  }
  const deps = path.join(repo, "node_modules");
  const prepare = require(path.join(repo, "scripts/prepare-rental-workspace.cjs"));
  const pack = require(path.join(repo, "scripts/package-rental-host.cjs"));
  const contracts = prepare.compileFixedPlatformContracts(repo, platformCommit, deps, true);
  const load = name => contracts.load(contracts.exported(`@rental-os/core-contracts/${name}`, true));
  const archiveApi = load("archive"), platformApi = load("platform-source");
  const platformPath = path.join(task, "platform.tgz"), rentalPath = path.join(task, "rental.tgz");
  const platformAsset = development ? undefined : pack.readOrdinary(platformPath, 128 * 1024 * 1024);
  const repository = development ? BASE_REPOSITORY : readJson(archiveApi.readCoreArchive(platformAsset, platformDigest)
    .files.get("platform.source.json"), "底座正式源码收据").source.repository;
  const publicRetention = aiMode === "public-retention";
  const prepared = development ? undefined : await pack.prepareRentalReleaseWorkspace({ repo, repository, commit: platformCommit,
    coreRepo, coreCommit: rentalCommit, deps, mode: "release", profile: "host", aiMode: publicRetention ? "enabled" : "disabled",
    freshAi: publicRetention, publicRetention, mcp: false, aiDataSha256,
    platformArchive: platformAsset, platformSha256: platformDigest,
    rentalArchive: pack.readOrdinary(rentalPath, 128 * 1024 * 1024), rentalSha256: rentalDigest });
  const workspace = prepared?.workspace ?? await prepare.createRentalDevelopmentWorkspace({ repo, repository, commit: platformCommit,
    coreRepo, coreCommit: rentalCommit, mode, profile: "host", ai: false, mcp: false }, platformApi);
  const output = path.join(task, "host.tgz");
  if (!development) {
    requireReleaseTag(workspace.platform.source, workspace.platform.version, "platform");
    requireReleaseTag(workspace.rental.source, workspace.rental.metadata.version, "rental");
  }
  const packed = await withReleaseDependencies(workspace, task, async dependencyDirectory => {
    if (development) return pack.main(["--development", "--repo", repo, "--repository", repository, "--commit", platformCommit,
      "--core-repo", coreRepo, "--core-commit", rentalCommit, "--deps", dependencyDirectory, "--output", output]);
    const result = await pack.packageRentalReleaseWorkspace(prepared, { deps: dependencyDirectory });
    if (result.workspace !== workspace || result.receipt.aiDataSha256 !== aiDataSha256) {
      throw new Error("正式 API 未使用第一阶段的最终投影或所选 AI 数据摘要");
    }
    pack.writeArchive(output, result.bytes);
    return result;
  });

  const apiFiles = archiveApi.readCoreArchive(pack.readOrdinary(output, 128 * 1024 * 1024), packed.sha256).files;
  if (!Buffer.from(apiFiles.get(SOURCE)).equals(workspace.files.get(SOURCE))) throw new Error("API 不属于本次固定 Web 投影");
  const contextBytes = Buffer.from(apiFiles.get(CONTEXT_FILE));
  const contextSha256 = sha256(contextBytes);
  const context = readJson(contextBytes, "宿主收据");
  const deploymentLock = apiFiles.get(`${DEPLOYMENT}core.deployment.lock.json`);
  const deploymentLockSha256 = sha256(deploymentLock);
  if (context.deploymentLockSha256 !== deploymentLockSha256 || context.originalNpmLockSha256 !== sha256(workspace.files.get("package-lock.json"))) {
    throw new Error("API 与 Web 的固定部署或投影锁不一致");
  }
  const candidate = development ? null : verifyPreparedRental(new Map([...apiFiles].map(([file, bytes]) => [file, Buffer.from(bytes)])),
    contextSha256, { requireFixedBuild: true });
  if (development && (context.sourceMode !== "development" || context.serverUpdateEligible !== false || context.releaseApproved !== false)) {
    throw new Error("开发运行包缺少不可部署状态");
  }
  const inputDir = path.join(task, development ? "development" : "input");
  fs.mkdirSync(inputDir);
  writeFiles(path.join(inputDir, "api"), apiFiles);
  const npmLockSha256 = context.originalNpmLockSha256;
  const web = buildWeb({ repo, task, workspace, apiFiles, inputDir, npmLockSha256, deploymentLockSha256 });
  const report = { sourceMode: mode, platformCommit, rentalCommit, toolCommit, contextSha256, deploymentLockSha256,
    npmLockSha256, ...web, releaseApproved: false, serverUpdateEligible: false };
  if (development) return { ...report, format: "rental-development-image-input-1" };
  const manifest = json({ ...report, format: "rental-image-input-1", identitySha256: candidate.identitySha256 });
  fs.writeFileSync(path.join(inputDir, "input.json"), manifest, { flag: "wx" });
  return { ...report, inputSha256: sha256(manifest) };
}

module.exports = { parsePairArguments, preparePair };

if (require.main === module) {
  const args = process.argv.slice(2);
  const result = args[0] === "--bundle-web" && args.length === 3 ? bundleWeb(args[1], args[2]) : preparePair(args);
  result.then(report => { if (report) process.stdout.write(`${JSON.stringify(report)}\n`); }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
