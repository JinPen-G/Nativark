/** 读取固定本地Git版本的公开手册，向stdout输出指南；不读取内部开发资料。 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { CoreManifestSchema, CoreSourceSchema } from "./manifest";
import { CORE_GUIDE_SOURCE_FILE, renderCoreGuide } from "./guide";

try {
  const args = process.argv.slice(2);
  if (args.length !== 2) throw new Error("用法：node packages/core-contracts/dist/generate-guide.js <Core清单JSON> <底座来源JSON>");
  const manifest = CoreManifestSchema.parse(JSON.parse(readFileSync(args[0], "utf8")));
  const source = CoreSourceSchema.parse(JSON.parse(readFileSync(args[1], "utf8")));
  const guide = execFileSync("git", ["show", `${source.commit}:${CORE_GUIDE_SOURCE_FILE}`],
    { cwd: resolve(__dirname, "../../.."), encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.write(renderCoreGuide(manifest, guide, source));
} catch (error) {
  console.error(error instanceof Error ? error.message : "指南生成失败");
  process.exitCode = 2;
}
