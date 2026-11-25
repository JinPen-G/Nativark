/** 单次版本升级的只读命令；读取锁/候选/数据观察，标准输出不混入运行日志。 */
import { readFileSync } from "node:fs";
import { CoreDataObservationSchema, CoreDeploymentLockSchema, CoreUpdateRequestSchema, planCoreUpdate } from "./update";

const args = process.argv.slice(2);
const json = args.includes("--json");
try {
  const files = args.filter(arg => arg !== "--json");
  if (files.length !== 3 || files.some(arg => arg.startsWith("--")))
    throw new Error("用法：node packages/core-contracts/dist/plan-update.js <当前锁JSON> <升级请求JSON> <数据观察JSON> [--json]");
  const read = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
  const current = CoreDeploymentLockSchema.parse(read(files[0]));
  const request = CoreUpdateRequestSchema.parse(read(files[1]));
  const observed = CoreDataObservationSchema.parse(read(files[2]));
  const result = planCoreUpdate(current, request, observed);
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else {
    console.log(result.ok ? `升级预检通过：${result.status}` : "升级预检未通过。");
    if (result.ok) for (const item of result.migrations)
      console.log(`${item.owner}：数据 ${item.fromVersion} → ${item.toVersion}，${item.entries.length} 项待应用迁移。`);
    else for (const issue of result.issues) console.log(`${issue.owner}:${issue.field} [${issue.code}] ${issue.message}`);
    console.log("本命令只输出候选，没有下载安装、改写锁/配置、执行迁移或切换运行版本。");
  }
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  const message = error instanceof Error ? error.message : "预检失败";
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, scope: "update-preflight", issues: [{ code: "check_failed", message }] })}\n`);
  else console.error(message);
  process.exitCode = 2;
}
