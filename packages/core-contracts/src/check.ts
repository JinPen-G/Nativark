/** core-check 命令入口；退出码 0=所选静态检查通过，1=包不通过，2=用法或读取失败。 */
import { readFileSync } from "node:fs";
import { CoreHostVersionsSchema } from "./compatibility";
import { inspectCorePackage } from "./package";

const args = process.argv.slice(2);
let directory: string | undefined;
let hostFile: string | undefined;
let json = false;

try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") json = true;
    else if (arg === "--host" && !hostFile && args[i + 1] && !args[i + 1].startsWith("--")) hostFile = args[++i];
    else if (!arg.startsWith("-") && !directory) directory = arg;
    else throw new Error(`无法识别的参数 ${arg}`);
  }
  if (!directory) throw new Error("用法：node packages/core-contracts/dist/check.js <包目录> [--host <宿主版本JSON>] [--json]");
  const host = hostFile ? CoreHostVersionsSchema.parse(JSON.parse(readFileSync(hostFile, "utf8"))) : undefined;
  const result = inspectCorePackage(directory, host);
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    console.log(result.ok ? "Core 包静态检查通过。" : "Core 包静态检查未通过。");
    for (const issue of result.issues) console.log(`${issue.file}${issue.field ? `:${issue.field}` : ""} [${issue.code}] ${issue.message}`);
    console.log(result.compatibilityChecked ? "已检查所给宿主的版本与必需能力。" : "未提供 --host，尚未检查宿主版本与必需能力。");
    console.log("本命令没有加载 Core 代码、装配应用、执行迁移或授予租户权限。");
  }
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  const message = error instanceof Error ? error.message : "检查失败";
  if (args.includes("--json")) process.stdout.write(`${JSON.stringify({ ok: false, scope: "package-static", issues: [{ code: "check_failed", message }] })}\n`);
  else console.error(message);
  process.exitCode = 2;
}
