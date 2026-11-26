"use strict";

/** 从固定双仓与原发行生成普通 Rental 镜像交接。仅在独占任务目录构建，不连接业务库。 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const { registerHooks } = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { CONTEXT_FILE, isFullCommit, isPackagePath, isSha256, readJson, sha256, verifyPreparedRental } = require("./release-composition.cjs");
const { digestFiles } = require("./release-facts.cjs");
const { requireReleaseTag } = require("./release-image-pair.cjs");
const { readReleaseFiles } = require("./release-verify.cjs");

const CORE = "packages/rental-core/";
const SOURCE = "development.workspace.json";
const DEPLOYMENT = "apps/rental-api/prisma-deployment/";
const BASE_REPOSITORY = "https://github.com/JinPen-G/Nativark";
const TOOLS = ["prepare-rental-workspace", "rental-build-snapshot", "rental-host-lock", "check-rental-package-build",
  "build-selected-prisma", "verify-rental-distribution", "rental-build-memory", "rental-platform-build", "package-rental-host"];
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

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

function prepareDeployment(workspace, deps, repo, archiveApi, platformAsset, rentalAsset, platformDigest, rentalDigest) {
  const tool = name => require(path.join(repo, "scripts", `${name}.cjs`));
  const absolute = file => path.resolve(repo, file).split(path.sep).join("/");
  const { snapshotFromFiles } = tool("rental-build-snapshot");
  const { createBuild, verifyContracts } = tool("check-rental-package-build");
  const build = createBuild(deps, { quiet: true, snapshot: snapshotFromFiles(workspace.platform.source.commit,
    new Map([...workspace.files].map(([file, bytes]) => [absolute(file), bytes]))) });
  verifyContracts(build);
  const { publicSchema } = tool("verify-rental-distribution").verifyServer(build);
  for (const directory of ["apps/platform-api", "packages/ai-native-data", "apps/rental-api"]) build.compile(`${directory}/tsconfig.json`);
  const memory = tool("rental-build-memory").createMemoryBuild(build);
  const load = name => memory.load(build.exported(`@rental-os/${name}`, true));
  const rental = archiveApi.readCoreArchive(rentalAsset, rentalDigest).files;
  const platform = archiveApi.readCoreArchive(platformAsset, platformDigest).files;
  if (platform.size !== workspace.platform.files.size || [...platform].some(([file, bytes]) =>
    !workspace.platform.files.has(file) || !Buffer.from(bytes).equals(workspace.platform.files.get(file)))) {
    throw new Error("底座发行归档的文件与固定 Git 投影不一致");
  }
  const { data, migrationNames } = load("platform-api/data-plan").createPublicPlatformDataPlan();
  const manifest = readJson(rental.get("core.manifest.json"), "Rental 正式清单");
  const release = { versions: { platform: workspace.platform.version, contract: load("core-contracts").CORE_CONTRACT_VERSION,
    node: process.versions.node, capabilities: {} }, source: workspace.platform.source, sha256: platformDigest, data };
  const prepared = memory.load(absolute("apps/rental-api/dist/prepare-deployment.js")).createRentalDeploymentFiles({
    release, pin: { manifest, sha256: rentalDigest }, coreFiles: rental, publicSchema,
    publicMigrations: data.migrations.map((item, index) => ({ name: migrationNames[index], sql: platform.get(`apps/platform-api/${item.file}`) })),
  });
  return { rental, prepared };
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
  execFileSync(process.execPath, ["--require", guard, __filename, "--bundle-web", webSource, webDir], {
    cwd: path.join(webSource, "apps/rental-admin"), timeout: 300000, stdio: ["ignore", process.stderr, process.stderr],
    env: { ...process.env, DATABASE_URL: "mysql://offline:offline@127.0.0.1:1/rental_os_offline", AI_OFFLINE_WRITE_ROOT: task,
      AI_OFFLINE_AUDIT: audit, TEMP: temp, TMP: temp, TMPDIR: temp, XDG_CACHE_HOME: temp, CORE_DEPLOYMENT_LOCK: lock },
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
  const [mode, platformDir, platformCommit, rentalDir, rentalCommit, taskDir, platformDigest, rentalDigest] = args;
  const development = mode === "development";
  if ((development ? args.length !== 6 : mode !== "release" || args.length !== 8 || ![platformDigest, rentalDigest].every(isSha256))
    || ![platformCommit, rentalCommit].every(isFullCommit) || process.versions.node !== "24.13.0") {
    throw new Error("用法：release-prepare-pair.cjs <release|development> <Zelo目录> <完整SHA> <Rental目录> <完整SHA> <任务目录> [底座归档SHA256 Rental归档SHA256]，Node 须为 24.13.0");
  }
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
  const workspace = await prepare.createRentalDevelopmentWorkspace({ repo, repository, commit: platformCommit,
    coreRepo, coreCommit: rentalCommit, mode, profile: "host" }, platformApi);
  const output = path.join(task, "host.tgz");
  let packed;
  if (development) {
    packed = await pack.main(["--development", "--repo", repo, "--repository", repository, "--commit", platformCommit,
      "--core-repo", coreRepo, "--core-commit", rentalCommit, "--output", output]);
  } else {
    requireReleaseTag(workspace.platform.source, workspace.platform.version, "platform");
    requireReleaseTag(workspace.rental.source, workspace.rental.metadata.version, "rental");
    const { rental, prepared } = prepareDeployment(workspace, deps, repo, archiveApi, platformAsset,
      pack.readOrdinary(rentalPath, 128 * 1024 * 1024), platformDigest, rentalDigest);
    const deploymentDir = path.join(task, "prepared"), rentalPackage = path.join(task, "core"), provenance = path.join(task, SOURCE);
    writeFiles(deploymentDir, prepared.files);
    writeFiles(rentalPackage, rental);
    fs.writeFileSync(provenance, workspace.files.get(SOURCE), { flag: "wx" });
    packed = await pack.main(["--ai", "disabled", "--deployment", deploymentDir, "--platform-package", platformPath, "--rental-package", rentalPackage,
      "--source-provenance", provenance, "--platform-repo", repo, "--core-repo", coreRepo, "--output", output]);
  }

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

if (require.main === module) {
  const args = process.argv.slice(2);
  const result = args[0] === "--bundle-web" && args.length === 3 ? bundleWeb(args[1], args[2]) : preparePair(args);
  result.then(report => { if (report) process.stdout.write(`${JSON.stringify(report)}\n`); }).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
