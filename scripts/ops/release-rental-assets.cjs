"use strict";

/** 在受控 Linux 检出调用原发行工具，只写本次资产与复核回执。 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { isFullCommit, isSha256, readJson, sha256 } = require("./release-composition.cjs");
const { requireReleaseTag } = require("./release-image-pair.cjs");

const PLATFORM_SOURCE = "https://github.com/JinPen-G/Nativark";
const RENTAL_SOURCE = "https://github.com/JinPen-G/nativark-rental-core";
const DISCOVERY_FILE = "core.manifest.next.json";
const tools = ["prepare-rental-workspace", "verify-rental-distribution", "package-rental-host", "rental-build-snapshot",
  "rental-build-memory", "rental-host-lock", "rental-platform-build", "check-rental-package-build", "build-selected-prisma"];
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function git(directory, ...args) {
  return execFileSync("git", ["--no-replace-objects", "-C", directory, ...args], { timeout: 15000, windowsHide: true });
}

function requireCheckout(directory, commit) {
  const root = git(directory, "rev-parse", "--show-toplevel").toString().trim();
  if (fs.realpathSync(root) !== directory || git(directory, "rev-parse", "HEAD").toString().trim() !== commit) {
    throw new Error("发行须从各自仓库根的固定提交检出构建");
  }
}

function fixedPackage(directory, commit, role) {
  const metadata = readJson(git(directory, "show", `${commit}:package.json`), `${role} 固定包清单`);
  const version = metadata.version;
  if (typeof version !== "string" || !/^0\.1\.(?:0|[1-9]\d*)$/u.test(version)) throw new Error(`${role} 须明确采用兼容范围内的新发布版本`);
  return version;
}

async function prepareAssets(args) {
  const [platformDirectory, platformCommit, rentalDirectory, rentalCommit, outputDirectory] = args;
  if (args.length !== 5 || ![platformCommit, rentalCommit].every(isFullCommit) || process.platform !== "linux" || process.versions.node !== "24.13.0") {
    throw new Error("用法：Linux Node 24.13.0 release-rental-assets.cjs <Zelo目录> <完整SHA> <Rental目录> <完整SHA> <本次空输出目录>");
  }
  process.env.GIT_NO_LAZY_FETCH = "1";
  const repo = fs.realpathSync(platformDirectory), coreRepo = fs.realpathSync(rentalDirectory), out = fs.realpathSync(outputDirectory);
  if (repo === coreRepo || out !== path.resolve(outputDirectory) || fs.readdirSync(out).length) throw new Error("须提供两个独立检出及本次普通空输出目录");
  requireCheckout(repo, platformCommit);
  requireCheckout(coreRepo, rentalCommit);
  const platformVersion = fixedPackage(repo, platformCommit, "底座"), rentalVersion = fixedPackage(coreRepo, rentalCommit, "Rental");
  if (Number(platformVersion.split(".")[2]) <= 17 || Number(rentalVersion.split(".")[2]) <= 14) {
    throw new Error("已发行 v0.1.17 与 v0.1.14 保持原字节，须先固定两仓的新版本");
  }
  const platformSource = { repository: PLATFORM_SOURCE, commit: platformCommit };
  const rentalSource = { repository: RENTAL_SOURCE, commit: rentalCommit };
  requireReleaseTag(platformSource, platformVersion, "platform");
  requireReleaseTag(rentalSource, rentalVersion, "rental");
  for (const tool of tools) {
    const relative = `scripts/${tool}.cjs`, filename = path.join(repo, relative);
    if (!fs.lstatSync(filename).isFile() || !fs.readFileSync(filename).equals(git(repo, "show", `${platformCommit}:${relative}`))) {
      throw new Error(`发行工具与固定 Zelo 提交不同：${relative}`);
    }
  }
  const deps = path.join(repo, "node_modules");
  const { compileFixedPlatformContracts, readIndependentRentalSource } = require(path.join(repo, "scripts/prepare-rental-workspace.cjs"));
  const rental = readIndependentRentalSource(coreRepo, rentalCommit, { mode: "release" });
  if (rental.source.repository !== RENTAL_SOURCE || rental.metadata.version !== rentalVersion) throw new Error("Rental 发行来源或版本与原稳定身份不一致");
  const contracts = compileFixedPlatformContracts(repo, platformCommit, deps, true);
  const load = name => contracts.load(contracts.exported(`@rental-os/core-contracts/${name}`, true));
  const platformApi = load("platform-source"), archiveApi = load("archive");
  const platform = await platformApi.readPlatformSourceFromGit(repo, platformSource);
  const pack = require(path.join(repo, "scripts/package-rental-host.cjs"));
  const platformAsset = `platform-source-${platformVersion}.tgz`, rentalAsset = `rental-${rentalVersion}.tgz`;
  const platformFile = path.join(out, platformAsset), rentalFile = path.join(out, rentalAsset);
  const platformArchive = platformApi.packPlatformSource(platform);
  pack.writeArchive(platformFile, platformArchive.bytes);
  const portable = execFileSync(process.execPath, ["--no-compilation-cache", "--max-old-space-size=6144", "--require",
    path.join(repo, "tests/fixtures/ai-native/prisma-offline-preload.cjs"), path.join(repo, "scripts/verify-rental-distribution.cjs"),
    "--portable", "--build-repo", repo, "--deps", deps, "--commit", platformCommit, "--platform-commit", platformCommit,
    "--source-repository", PLATFORM_SOURCE, "--core-repo", coreRepo, "--core-commit", rentalCommit, "--out", rentalFile],
  { cwd: repo, encoding: "utf8", timeout: 900000, maxBuffer: 4 * 1024 * 1024 });
  const receipt = readJson(Buffer.from(portable.trimEnd().split(/\r?\n/u).at(-1)), "Rental 原发行回执");
  const describe = (file, name, expected) => {
    if (!isSha256(expected)) throw new Error("发行回执缺少归档摘要");
    const bytes = pack.readOrdinary(file, 128 * 1024 * 1024), archive = archiveApi.readCoreArchive(bytes, expected);
    return { archive, asset: { name, bytes: bytes.length, sha256: sha256(bytes), files: archive.files.size } };
  };
  const platformReadback = describe(platformFile, platformAsset, platformArchive.sha256);
  const rentalReadback = describe(rentalFile, rentalAsset, receipt.sha256);
  const discovery = rentalReadback.archive.files.get("core.manifest.json");
  const manifest = readJson(discovery, "Rental 包内发现清单");
  if (manifest.id !== "rental" || manifest.version !== rentalVersion || manifest.source?.repository !== RENTAL_SOURCE
    || manifest.source?.commit !== rentalCommit || platform.version !== platformVersion || receipt.mode !== "portable") {
    throw new Error("正式资产回读版本或固定来源不一致");
  }
  fs.writeFileSync(path.join(out, DISCOVERY_FILE), discovery, { flag: "wx" });
  return { format: "rental-release-assets-1", releaseApproved: false, serverUpdateEligible: false,
    platform: { source: platformSource, version: platformVersion, tag: `v${platformVersion}`, asset: platformReadback.asset },
    rental: { source: rentalSource, version: rentalVersion, tag: `v${rentalVersion}`, asset: rentalReadback.asset },
    discovery: { file: DISCOVERY_FILE, sha256: sha256(discovery), apply: "after-release-readback-and-paired-ci" } };
}

if (require.main === module) {
  prepareAssets(process.argv.slice(2)).then(receipt => process.stdout.write(`${JSON.stringify(receipt)}\n`)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
