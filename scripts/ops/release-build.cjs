"use strict";

/**
 * OPS-01B：显式生成发布构建并把产物绑定到当前 Git 提交。
 *
 * 该命令会写 dist 与 artifacts，所以与默认只读的 release-gate 分开。门禁只读取本命令
 * 生成的来源证明；源码改动、切换提交或产物被改写后都必须重新执行本命令。
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, log, fail } = require("./runtime.cjs");
const { summarizeWorktree, assertNoSecrets } = require("./release-facts.cjs");
const { ARTIFACT_DIR, BUILD_PROVENANCE_FILE, summarizeBuilds } = require("./release-artifacts.cjs");

function run(command, args, options = {}) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
  return spawnSync(executable, args, { cwd: ROOT, encoding: "utf8", ...options });
}

const head = String(run("git", ["rev-parse", "HEAD"]).stdout ?? "").trim();
const shortHead = String(run("git", ["rev-parse", "--short", "HEAD"]).stdout ?? "").trim();
const branch = String(run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout ?? "").trim();
const worktree = summarizeWorktree(String(run("git", ["status", "--porcelain"]).stdout ?? ""));
if (!head || !worktree.clean) {
  fail(`发布构建要求工作区干净且提交已固定；当前 ${worktree.changedCount} 项未提交改动`);
}

log(`OPS-01B 生成发布构建：${shortHead} @ ${branch}`);
const built = run("npm", ["run", "build"], { stdio: "inherit" });
if (built.status !== 0) fail(`发布构建失败（退出码 ${built.status ?? "未知"}）`);

const builds = summarizeBuilds().map(({ files, ...summary }) => summary);
const missing = builds.filter((build) => !build.fileCount || !build.digest);
if (missing.length) fail(`发布构建缺少产物：${missing.map((build) => build.name).join("、")}`);

const provenance = {
  task: "OPS-01B",
  kind: "release-build-provenance",
  generatedAt: new Date().toISOString(),
  git: { commit: head, shortCommit: shortHead, branch },
  builds
};
assertNoSecrets(provenance, []);
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.writeFileSync(BUILD_PROVENANCE_FILE, `${JSON.stringify(provenance, null, 2)}\n`);
log(`✓ 构建完成并绑定到当前提交：${path.relative(ROOT, BUILD_PROVENANCE_FILE)}`);
