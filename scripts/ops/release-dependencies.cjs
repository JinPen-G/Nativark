"use strict";

/** 为固定双仓投影安装独占编译依赖；只暂存 npm 输入，调用结束即清理。 */
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const { isFullCommit, isPackagePath, readJson, sha256 } = require("./release-composition.cjs");

function releaseDependencyInputs(workspace) {
  const source = readJson(workspace.files.get("development.workspace.json"), "固定投影来源");
  const metadata = readJson(workspace.files.get("package.json"), "固定投影包清单");
  const lock = workspace.files.get("package-lock.json");
  if (source.npmLocks?.projected?.sha256 !== sha256(lock) || !Array.isArray(metadata.workspaces)) {
    throw new Error("发行编译依赖缺少同一投影锁");
  }
  const inputs = new Map([["package.json", workspace.files.get("package.json")], ["package-lock.json", lock]]);
  for (const directory of metadata.workspaces) {
    const file = `${directory}/package.json`;
    if (typeof directory !== "string" || !isPackagePath(file) || !workspace.files.has(file)) {
      throw new Error("发行编译依赖缺少所选工作区包清单");
    }
    inputs.set(file, workspace.files.get(file));
  }
  const sdk = source.publicRetention;
  if (sdk !== undefined) {
    if (!sdk || typeof sdk !== "object" || !isFullCommit(sdk.source?.commit)) throw new Error("公共保留 SDK 缺少固定来源");
    const archive = `vendor/ai-native-server-public-${sdk.version}.tgz`;
    const install = "packages/rental-ai-adapters/node_modules/@rental-os/ai-native-server";
    const bytes = workspace.files.get(archive);
    const entry = readJson(lock, "固定投影 npm 锁").packages?.[install];
    const owner = readJson(inputs.get("packages/rental-ai-adapters/package.json"), "公共保留适配包");
    const declared = source.files?.find(item => item.path === archive);
    if (sdk.version !== "0.2.1" || sdk.name !== "@rental-os/ai-native-server" || sdk.legacyVersion !== "0.1.0"
      || source.ai !== true || source.installation !== "fresh-ai" || sdk.archive !== archive || sdk.install !== install
      || !isDeepStrictEqual(sdk.source, source.platform?.source) || !(bytes instanceof Uint8Array) || !bytes.length
      || sdk.sha256 !== sha256(bytes) || declared?.sha256 !== sdk.sha256 || declared.bytes !== bytes.length
      || sdk.integrity !== `sha512-${createHash("sha512").update(bytes).digest("base64")}`
      || entry?.version !== sdk.version || entry.resolved !== `file:${archive}` || entry.integrity !== sdk.integrity
      || owner.dependencies?.[sdk.name] !== `file:../../${archive}`) {
      throw new Error("公共保留 SDK 的固定来源、归档字节或投影安装锁不一致");
    }
    inputs.set(archive, bytes);
  }
  const dataSdk = source.publicAiDataSdk;
  if (dataSdk !== undefined) {
    const archive = "vendor/ai-native-data-public-0.2.3.tgz";
    const install = "apps/rental-api/node_modules/@rental-os/public-ai-data";
    const bytes = workspace.files.get(archive);
    const entry = readJson(lock, "固定投影 npm 锁").packages?.[install];
    const owner = readJson(inputs.get("apps/rental-api/package.json"), "公共数据 SDK 宿主");
    const declared = source.files?.find(item => item.path === archive);
    if (!dataSdk || dataSdk.name !== "@rental-os/ai-native-data" || dataSdk.alias !== "@rental-os/public-ai-data"
      || dataSdk.version !== "0.2.3" || !isFullCommit(dataSdk.source?.commit)
      || source.ai !== true || source.installation !== "fresh-ai" || dataSdk.archive !== archive || dataSdk.install !== install
      || !isDeepStrictEqual(dataSdk.source, source.platform?.source) || !(bytes instanceof Uint8Array) || !bytes.length
      || dataSdk.sha256 !== sha256(bytes) || declared?.sha256 !== dataSdk.sha256 || declared.bytes !== bytes.length
      || dataSdk.integrity !== `sha512-${createHash("sha512").update(bytes).digest("base64")}`
      || entry?.name !== dataSdk.name || entry.version !== dataSdk.version || entry.resolved !== `file:${archive}`
      || entry.integrity !== dataSdk.integrity || owner.dependencies?.[dataSdk.alias] !== `file:../../${archive}`) {
      throw new Error("公共数据 SDK 的身份、固定来源、归档字节或投影安装锁不一致");
    }
    inputs.set(archive, bytes);
  }
  return inputs;
}

async function withReleaseDependencies(workspace, taskDirectory, build) {
  const task = fs.realpathSync(taskDirectory);
  if (task !== path.resolve(taskDirectory) || !fs.lstatSync(task).isDirectory()) {
    throw new Error("发行编译依赖须位于本次普通任务目录");
  }
  const inputs = releaseDependencyInputs(workspace);
  const directory = path.join(task, "build-dependencies");
  fs.mkdirSync(directory);
  const created = fs.lstatSync(directory);
  try {
    for (const [file, bytes] of inputs) {
      const target = path.join(directory, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes, { flag: "wx" });
    }
    const npmCli = process.platform === "win32"
      ? path.resolve(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
      : path.resolve(path.dirname(fs.realpathSync(process.execPath)), "../lib/node_modules/npm/bin/npm-cli.js");
    execFileSync(process.execPath, [npmCli, "ci", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund",
      "--cache", path.join(directory, "npm-cache")],
    { cwd: directory, timeout: 300000, stdio: ["ignore", process.stderr, process.stderr] });
    for (const [file, bytes] of inputs) {
      if (!fs.readFileSync(path.join(directory, file)).equals(bytes)) throw new Error("安装修改了固定投影 npm 输入");
    }
    const deps = path.join(directory, "node_modules");
    if (fs.realpathSync(deps) !== deps || !fs.lstatSync(deps).isDirectory()) {
      throw new Error("发行编译依赖不是本次安装的普通目录");
    }
    return await build(deps);
  } finally {
    const current = fs.lstatSync(directory);
    if (fs.realpathSync(directory) !== directory || !current.isDirectory()
      || current.dev !== created.dev || current.ino !== created.ino || current.birthtimeMs !== created.birthtimeMs) {
      throw new Error("发行编译依赖目录身份变化，停止清理");
    }
    fs.rmSync(directory, { recursive: true });
  }
}

module.exports = { releaseDependencyInputs, withReleaseDependencies };
