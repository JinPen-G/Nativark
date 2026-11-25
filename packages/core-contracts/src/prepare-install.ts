/** 本地标准包准备命令；成功仅说明待部署文件完整，不改变运行组合或租户授权。 */
import { lstatSync, readFileSync } from "node:fs";
import { CoreHostVersionsSchema } from "./compatibility";
import { CORE_ARCHIVE_LIMITS } from "./archive";
import { prepareCoreInstall } from "./install";

try {
  const args = process.argv.slice(2);
  if (args.length !== 4) throw new Error("用法：node packages/core-contracts/dist/prepare-install.js <Core包.tgz> <SHA256> <既有独占待部署根目录> <宿主版本JSON>");
  const stat = lstatSync(args[0]);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > CORE_ARCHIVE_LIMITS.totalBytes)
    throw new Error("Core包须为大小受限的普通文件");
  const host = CoreHostVersionsSchema.parse(JSON.parse(readFileSync(args[3], "utf8")));
  const result = prepareCoreInstall(readFileSync(args[0]), args[1], args[2], host);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "安装准备失败");
  process.exitCode = 1;
}
