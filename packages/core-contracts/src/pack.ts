/** 将声明文件打成新包并输出摘要；不覆盖已有文件，也不递归打包源码工作区。 */
import { closeSync, lstatSync, openSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CoreHostVersionsSchema } from "./compatibility";
import { packCoreDirectory } from "./install";

try {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 3) throw new Error("用法：node packages/core-contracts/dist/pack.js <Core目录> <新包路径.tgz> [宿主版本JSON]");
  const output = resolve(args[1]);
  if (!output.endsWith(".tgz")) throw new Error("Core包使用.tgz扩展名");
  let parent = dirname(output);
  while (true) {
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("输出父路径须为普通目录");
    if (dirname(parent) === parent) break;
    parent = dirname(parent);
  }
  const host = args[2] ? CoreHostVersionsSchema.parse(JSON.parse(readFileSync(args[2], "utf8"))) : undefined;
  const pack = packCoreDirectory(args[0], host);
  let created = false;
  try {
    // wx 在打开时拒绝旧文件；写失败只删除本次已经创建的新包。
    const fd = openSync(output, "wx"); created = true;
    try { writeFileSync(fd, pack.bytes); } finally { closeSync(fd); }
  } catch (error) {
    if (created) unlinkSync(output);
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ status: "packed", file: output, coreId: pack.manifest.id, version: pack.manifest.version, sha256: pack.sha256 })}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "打包失败");
  process.exitCode = 1;
}
