/** 读取固定本地Git版本的原任务册，向stdout输出指南；不会覆盖Core内已有文档。 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { CoreManifestSchema, CoreSourceSchema } from "./manifest";
import { renderCoreGuide } from "./guide";

try {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw new Error("用法：node packages/core-contracts/dist/generate-guide.js <Core清单JSON> <底座来源JSON>");
  const manifest = CoreManifestSchema.parse(JSON.parse(readFileSync(args[0], "utf8")));
  const source = CoreSourceSchema.parse(JSON.parse(readFileSync(args[1], "utf8")));
  const task = execFileSync("git", ["show", `${source.commit}:docs/平台底座/Core接入/平台Core接入-开发任务.md`],
    { cwd: resolve(__dirname, "../../.."), encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.write(renderCoreGuide(manifest, task, source));
} catch (error) {
  console.error(error instanceof Error ? error.message : "指南生成失败");
  process.exitCode = 2;
}
