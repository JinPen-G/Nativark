/** 同源元数据及标准包命令；JSON写stdout，package只写明确的新.tgz，不执行服务/安装或覆盖已有包。 */
import { createTicketsManifest } from "./manifest";
import { createTicketsOpenApi } from "./openapi";
import { closeSync, lstatSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { CORE_GUIDE_SOURCE_FILE, CoreSourceSchema } from "@rental-os/core-contracts";
import { packTicketsPackage } from "./package";

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "openapi" && !args.length) process.stdout.write(`${JSON.stringify(createTicketsOpenApi(), null, 2)}\n`);
  else if (command === "manifest" && args.length === 2)
    process.stdout.write(`${JSON.stringify(createTicketsManifest({ repository: args[0], commit: args[1] }), null, 2)}\n`);
  else if (["package", "package:ai", "package:mcp"].includes(command) && args.length === 4) {
    const directory = resolve(__dirname, ".."), source = CoreSourceSchema.parse({ repository: args[0], commit: args[1] });
    const repository = execFileSync("git", ["rev-parse", "--show-toplevel"],
      { cwd: directory, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
    // 清单来源固定到真实Git源码；未提交业务/合同差异不能被包装成该提交的发行。
    const paths = ["packages/example-tickets-core", "packages/core-contracts"];
    const sameSource = spawnSync("git", ["diff", "--quiet", source.commit, "--", ...paths],
      { cwd: repository, windowsHide: true, stdio: "ignore" });
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", ...paths],
      { cwd: repository, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    if (sameSource.status !== 0 || untracked.trim()) throw new Error("工单或接入合同源码与所选固定提交不同，请先提交并从该版本重新构建");
    const platformSource = CoreSourceSchema.parse(JSON.parse(readFileSync(args[2], "utf8")));
    const platformTask = execFileSync("git", ["show", `${platformSource.commit}:${CORE_GUIDE_SOURCE_FILE}`],
      { cwd: repository, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 });
    const pack = packTicketsPackage({ directory, source, sourceDirectory: "packages/example-tickets-core", platformSource, platformTask,
      ai: command === "package:ai", mcp: command === "package:mcp" });
    const output = resolve(args[3]);
    if (!output.endsWith(".tgz")) throw new Error("工单标准包使用.tgz扩展名");
    for (let parent = dirname(output); ; parent = dirname(parent)) {
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("输出包的父路径须为不经过链接的普通目录");
      if (dirname(parent) === parent) break;
    }
    let created = false;
    try {
      const file = openSync(output, "wx"); created = true;
      try { writeFileSync(file, pack.bytes); } finally { closeSync(file); }
    } catch (error) { if (created) unlinkSync(output); throw error; }
    process.stdout.write(JSON.stringify({ status: "packed", coreId: pack.manifest.id, version: pack.manifest.version,
      file: output, sha256: pack.sha256, files: pack.fileCount }) + "\n");
  } else throw new Error("用法：metadata.js openapi；manifest <仓库HTTPS地址> <固定提交>；package、package:ai 或 package:mcp <仓库HTTPS地址> <固定提交> <底座来源JSON> <新包.tgz>");
} catch (error) {
  console.error(error instanceof Error ? error.message : "工单元数据生成失败");
  process.exitCode = 1;
}
