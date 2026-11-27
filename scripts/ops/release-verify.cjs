"use strict";

/** 独立 Rental 发布材料的离线入口。只读本地宿主归档目录或固定 Git 对象。 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { isFullCommit, isSha256, CONTEXT_FILE, MCP_MANIFEST, MCP_SQL, isPackagePath, readJson, sha256,
  verifyPreparedRental, comparePreparedRental, verifyMcpSql, compareEntries } = require("./release-composition.cjs");

const FILE_LIMIT = 32 * 1024 * 1024;

function readOrdinary(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > FILE_LIMIT) throw new Error("宿主材料须为有界普通文件");
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) throw new Error("宿主材料在读取期间变化");
  return bytes;
}

function readReleaseFiles(directory, expectedDigest) {
  const root = path.resolve(directory);
  for (let current = root; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("宿主材料路径须为普通目录");
    if (current === path.dirname(current)) break;
  }
  const files = new Map();
  let totalBytes = 0;
  if (expectedDigest !== undefined) {
    let receipt;
    try {
      receipt = readOrdinary(path.join(root, CONTEXT_FILE));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      throw new Error("缺少正式 prepared 宿主收据，旧组合须先核定原库桥接");
    }
    if (sha256(receipt) !== expectedDigest) throw new Error("宿主收据与已核摘要不一致");
    files.set(CONTEXT_FILE, receipt);
    totalBytes = receipt.length;
  }
  function visit(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (!isPackagePath(relative) || entry.isSymbolicLink()) throw new Error("宿主目录含不支持的路径或链接");
      if (relative === CONTEXT_FILE && expectedDigest !== undefined) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, relative + "/");
      } else {
        const bytes = readOrdinary(absolute);
        totalBytes += bytes.length;
        if (files.size >= 5000 || totalBytes > 4 * FILE_LIMIT) throw new Error("宿主目录超过归档上限");
        files.set(relative, bytes);
      }
    }
  }
  visit(root, "");
  return files;
}

function readPrepared(directory, expectedDigest, options) {
  if (!isSha256(expectedDigest)) throw new Error("须提供已核宿主收据的 SHA-256");
  return verifyPreparedRental(readReleaseFiles(directory, expectedDigest), expectedDigest, options);
}

function readFixedMcp(repo, commit) {
  if (!isFullCommit(commit)) throw new Error("MCP 来源须为完整固定提交 SHA");
  const git = (...args) => {
    try {
      return execFileSync("git", ["--no-replace-objects", "--no-lazy-fetch", "-C", repo, ...args],
        { maxBuffer: FILE_LIMIT, timeout: 10000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      throw new Error("本地缺少固定 MCP Git 对象或无法读取");
    }
  };
  if (git("cat-file", "-t", commit).toString().trim() !== "commit") throw new Error("MCP SHA 须指向提交对象");
  const prefix = "packages/mcp-server/";
  const files = new Map();
  for (const row of git("ls-tree", "-z", "--full-tree", commit, "--", prefix).toString("utf8").split("\0")) {
    const [metadata, fullPath] = row.split("\t");
    if (!fullPath?.startsWith(prefix)) continue;
    const file = fullPath.slice(prefix.length);
    if (file !== MCP_MANIFEST && !/\.sql$/iu.test(file)) continue;
    const match = /^100(?:644|755) blob ([a-f0-9]{40})$/u.exec(metadata);
    if (!match || (file !== MCP_MANIFEST && !MCP_SQL.test(file))) throw new Error("MCP 清单或原 SQL 路径无效");
    files.set(file, git("cat-file", "blob", match[1]));
  }
  const entries = verifyMcpSql(files);
  return { commit, manifestSha256: sha256(files.get(MCP_MANIFEST)), entries };
}

function inspectPair(evidenceDir, digest) {
  const receipt = path.join(evidenceDir, "image-pair.json");
  const observer = path.join(__dirname, "deployment", "hourly-update.py");
  return readJson(execFileSync(process.platform === "win32" ? "python" : "python3",
    ["-B", observer, "--observe-pair", receipt, digest],
    { timeout: 270000, maxBuffer: 65536, stdio: ["ignore", "pipe", "inherit"], windowsHide: true }), "实际镜像观察");
}

function main(args) {
  const [mode, ...values] = args;
  const scope = { releaseApproved: false, databaseChecked: false };
  if (mode === "candidate" && values.length === 2) {
    const candidate = readPrepared(values[0], values[1], { requireFixedBuild: true });
    return { scope: "prepared-candidate", ...scope, candidateIdentitySha256: candidate.identitySha256, candidateIdentity: candidate.identity };
  }
  if (mode === "prepared" && values[0] === "legacy-combined") {
    throw new Error("旧组合需要正式旧库桥接和原迁移账，离线材料校验无法接收该基线");
  }
  if (mode === "prepared" && values.length === 4) {
    const previous = readPrepared(values[0], values[1]);
    const candidate = readPrepared(values[2], values[3]);
    const changes = comparePreparedRental(previous, candidate);
    return { scope: "prepared-migration-comparison", ...scope, previousIdentity: previous.identity, previousIdentitySha256: previous.identitySha256,
      candidateIdentitySha256: candidate.identitySha256, candidateIdentity: candidate.identity, changes };
  }
  if (mode === "mcp" && values.length === 3) {
    const previous = readFixedMcp(values[0], values[1]);
    const candidate = readFixedMcp(values[0], values[2]);
    return { scope: "mcp-source-comparison", ...scope, previous, candidate, changes: compareEntries(previous.entries, candidate.entries) };
  }
  if (mode === "paired-review" && (values.length === 5 || (values.length === 6 && values[5] === "--local-images"))) {
    const [directory, digest, baseline, baselineDigest, evidenceDir] = values;
    const candidate = readPrepared(directory, digest, { requireFixedBuild: true });
    const previous = baseline === "legacy-combined" ? baseline : readPrepared(baseline, baselineDigest);
    const read = name => readOrdinary(path.join(evidenceDir, name));
    const { reviewPairedUpdate } = require("./release-build-evidence.cjs");
    const policy = readJson(read("policy.json"), "固定 CI 核收策略");
    const run = readJson(read("run.json"), "GitHub CI 运行证据");
    const buildRecord = read("image-pair.json");
    const inspect = values.length === 6;
    // 先核完整候选和 CI，再读取本机 Docker。留存核收仍可传入独立观察。
    const recorded = inspect ? readJson(buildRecord, "双镜像构建记录").imageIds : readJson(read("images.json"), "实际镜像观察");
    const result = reviewPairedUpdate(previous, candidate, policy, { run, buildRecord, inspectedImageIds: recorded });
    if (!inspect) return result;
    const observed = inspectPair(evidenceDir, policy.buildRecordSha256);
    return { ...reviewPairedUpdate(previous, candidate, policy, { run, buildRecord, inspectedImageIds: observed }),
      runtimeImageIds: observed.runtimeImageIds };
  }
  throw new Error("用法：release-verify.cjs candidate <候选目录> <收据SHA256>，prepared <基线目录> <基线收据SHA256> <候选目录> <候选收据SHA256>，mcp <Git目录> <基线SHA> <候选SHA>，或 paired-review <候选目录> <收据SHA256> <基线目录或legacy-combined> <基线收据SHA256或-> <证据目录> [--local-images]");
}

if (require.main === module) {
  try {
    const result = main(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.scope === "paired-update-review" || result.changes?.different ? 2 : 0;
  } catch (error) {
    process.stderr.write(`${error.code ? "无法读取本地发布材料" : error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { readOrdinary, readReleaseFiles, readPrepared };
