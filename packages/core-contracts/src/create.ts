/** 包内直接生成命令；只读固定公开材料并创建新 Core，stdout 返回 JSON。 */
import { readFileSync } from "node:fs";
import { createCoreProject } from "./scaffold";

const usage = "用法：node packages/core-contracts/dist/create.js --workspace <固定底座目录> --target packages/<新目录> --id <Core-ID> --package <npm包名> --platform-source <底座来源JSON>";
try {
  const args = process.argv.slice(2), options = new Map<string, string>();
  if (args.length === 1 && args[0] === "--help") process.stdout.write(`${usage}\n`);
  else {
    const allowed = new Set(["--workspace", "--target", "--id", "--package", "--platform-source"]);
    for (let index = 0; index < args.length; index += 2) {
      if (!allowed.has(args[index]) || options.has(args[index]) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(usage);
      options.set(args[index], args[index + 1]);
    }
    if (options.size !== allowed.size) throw new Error(usage);
    const result = createCoreProject({ workspace: options.get("--workspace")!, target: options.get("--target")!,
      coreId: options.get("--id")!, packageName: options.get("--package")!,
      platformSource: JSON.parse(readFileSync(options.get("--platform-source")!, "utf8")) });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Core 生成失败");
  process.exitCode = 1;
}
