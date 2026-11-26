"use strict";

/** 编译双仓普通开发组合，仅输出离线报告。正式宿主归档继续由原发行入口生成。 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { isFullCommit, sha256 } = require("./release-composition.cjs");
const { digestFiles } = require("./release-facts.cjs");

const ZELO = "https://github.com/JinPen-G/Zelo";
const TOOLS = ["prepare-rental-workspace.cjs", "rental-build-snapshot.cjs", "rental-host-lock.cjs",
  "check-rental-package-build.cjs", "build-selected-prisma.cjs", "verify-rental-distribution.cjs", "rental-build-memory.cjs"];

function git(repo, ...args) {
  return execFileSync("git", ["--no-replace-objects", "--no-lazy-fetch", "-C", repo, ...args],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 15000, windowsHide: true });
}

function requireFixedTools(repo, commit) {
  if (git(repo, "cat-file", "-t", commit).trim() !== "commit") throw new Error("Zelo SHA 须指向固定提交对象");
  if (git(repo, "rev-parse", "HEAD").trim() !== commit) throw new Error("Zelo 工具与编译依赖须来自所选固定检出");
  for (const file of TOOLS) {
    const relative = `scripts/${file}`, actual = path.join(repo, relative);
    const fixed = git(repo, "show", `${commit}:${relative}`);
    if (!fs.lstatSync(actual).isFile() || fs.readFileSync(actual, "utf8").replace(/\r\n/gu, "\n") !== fixed) {
      throw new Error(`构建工具与固定 Zelo 提交不同：${relative}`);
    }
  }
}

async function buildDevelopment(args) {
  const [platformDir, platformCommit, rentalDir, rentalCommit, profile] = args;
  if (args.length !== 5 || !isFullCommit(platformCommit) || !isFullCommit(rentalCommit) || !["host", "full"].includes(profile)) {
    throw new Error("用法：release-rental-development.cjs <Zelo目录> <完整SHA> <Rental目录> <完整SHA> <host|full>");
  }
  const repo = fs.realpathSync(platformDir), coreRepo = fs.realpathSync(rentalDir);
  if (repo === coreRepo || git(coreRepo, "cat-file", "-t", rentalCommit).trim() !== "commit") {
    throw new Error("须提供独立 Rental 仓库和固定提交对象");
  }
  process.env.GIT_NO_LAZY_FETCH = "1";
  requireFixedTools(repo, platformCommit);
  const dependencies = path.join(repo, "node_modules");
  const tool = name => require(path.join(repo, "scripts", `${name}.cjs`));
  const prepare = tool("prepare-rental-workspace");
  const contracts = prepare.compileFixedPlatformContracts(repo, platformCommit, dependencies, true);
  const platformApi = contracts.load(contracts.exported("@rental-os/core-contracts/platform-source", true));
  const archiveApi = contracts.load(contracts.exported("@rental-os/core-contracts/archive", true));
  const workspace = await prepare.createRentalDevelopmentWorkspace({ repo, repository: ZELO, commit: platformCommit,
    coreRepo, coreCommit: rentalCommit, mode: "development", profile }, platformApi);
  const sourceFile = workspace.files.get("development.workspace.json"), source = JSON.parse(Buffer.from(sourceFile));
  const apiSource = source.files.find(item => item.path === "apps/rental-api/src/main.ts");
  const lock = workspace.files.get("package-lock.json");
  if (source.mode !== "development" || source.profile !== profile || source.host !== "rental" || source.ai || source.mcp
    || source.platform.source.commit !== platformCommit || source.core.source.commit !== rentalCommit
    || source.deployment.state !== "not-prepared" || apiSource?.origin?.commit !== rentalCommit
    || apiSource.origin.repository !== source.core.source.repository || apiSource.sha256 !== sha256(workspace.files.get(apiSource.path))
    || source.npmLocks.projected.sha256 !== sha256(lock)) {
    throw new Error("开发组合同双仓、宿主选择、API 来源或投影锁不一致");
  }
  const archive = archiveApi.createCoreArchive(workspace.files);
  const { files } = archiveApi.readCoreArchive(archive.bytes, archive.sha256);
  const absolute = file => path.join(repo, file).split(path.sep).join("/");
  const snapshot = tool("rental-build-snapshot").snapshotFromFiles(platformCommit,
    new Map([...files].map(([file, bytes]) => [absolute(file), bytes])));
  const { createBuild, verifyContracts } = tool("check-rental-package-build");
  const distribution = tool("verify-rental-distribution");
  const build = createBuild(dependencies, { snapshot, quiet: true });
  verifyContracts(build);
  distribution.verifyServer(build);
  for (const directory of ["apps/platform-api", "packages/ai-native-data", "apps/rental-api"]) build.compile(`${directory}/tsconfig.json`);
  const rentalClient = build.selectedClients.get(absolute("apps/rental-api"));
  build.selectedClients.set(absolute("apps/rental-admin"), rentalClient);
  build.compile("apps/rental-admin/tsconfig.json");
  if (profile === "full") {
    distribution.verifyNative(build);
    build.selectedClients.set(absolute("apps/enterprise-portal"), rentalClient);
    for (const app of ["tenant-website", "enterprise-portal", "miniprogram", "staff-miniprogram"]) build.compile(`apps/${app}/tsconfig.json`);
  }
  const entry = build.outputs.get(absolute("apps/rental-api/dist/main.js"));
  if (!entry) throw new Error("独立 Rental API 缺少本次编译产物");
  const outputFiles = [...build.outputs].filter(([file]) => /\.(?:js|cjs|json|d\.ts)$/u.test(file))
    .map(([file, text]) => ({ path: path.relative(repo, file), bytes: Buffer.byteLength(text), contents: Buffer.from(text) }));
  const { fileCount, totalBytes, digest } = digestFiles(outputFiles);
  return { format: "rental-development-build-1", mode: "development", profile,
    platform: source.platform.source, rental: source.core.source, selection: { host: source.host, ai: false, mcp: false },
    workspace: { files: files.size, bytes: archive.bytes.length, archiveSha256: archive.sha256,
      sourceSha256: sha256(sourceFile), npmLockSha256: source.npmLocks.projected.sha256, apiSourceSha256: apiSource.sha256 },
    toolchain: { node: process.versions.node, typescript: build.ts.version, prisma: "5.22.0" },
    projects: build.stages, compiled: { files: fileCount, bytes: totalBytes, sha256: digest, apiEntrySha256: sha256(entry) },
    deployment: "not-prepared", releaseApproved: false, serverUpdateEligible: false, databaseChecked: false };
}

if (require.main === module) {
  buildDevelopment(process.argv.slice(2)).then(report => process.stdout.write(`${JSON.stringify(report)}\n`)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
