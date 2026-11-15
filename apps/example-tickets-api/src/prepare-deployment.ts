/** 工单受控部署准备命令：只在指定新目录生成锁和Prisma迁移组合，不安装/连接/执行代码。 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CorePlatformReleaseSchema } from "@rental-os/core-contracts";
import { createCoreMigrationDeployment } from "@rental-os/core-contracts/deployment";
import { packCoreDirectory } from "@rental-os/core-contracts/install";
import { readCorePackageFiles } from "@rental-os/core-contracts/package";
import { CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";

function prepare() {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw new Error("用法：prepare-deployment.js <固定底座发行JSON> <已准备工单包目录> <新部署目录>");
  const release = CorePlatformReleaseSchema.parse(JSON.parse(readFileSync(args[0], "utf8"))), plan = createPublicPlatformDataPlan();
  if (!isDeepStrictEqual(release.data, plan.data)) throw new Error("底座发行资料与当前公共数据计划不一致");
  const core = packCoreDirectory(args[1], release.versions);
  if (core.manifest.id !== "example-tickets") throw new Error("本示范命令只接受工单Core，其他Core由自己的受控装配办理");
  const source = readCorePackageFiles(args[1], CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  const lock = { lockVersion: 1 as const, platform: release, cores: [{ manifest: core.manifest, sha256: core.sha256 }] };
  const platformRoot = resolve(dirname(require.resolve("@rental-os/platform-api/data-plan")), "..");
  const files = createCoreMigrationDeployment({ lock, cores: new Map([[core.manifest.id, source]]),
    platform: plan.migrationNames.map((name, at) => ({ name, sql: readFileSync(resolve(platformRoot, plan.data.migrations[at].file)) })) });
  const target = resolve(args[2]);
  for (let parent = dirname(target); ; parent = dirname(parent)) {
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("部署目录父路径须为普通目录且不经过链接");
    if (dirname(parent) === parent) break;
  }
  if (existsSync(target)) throw new Error("部署目标已存在，不覆盖当前组合或用户配置");
  let created = false;
  try {
    mkdirSync(target); created = true;
    for (const [file, bytes] of files) {
      const destination = resolve(target, file), part = relative(target, destination);
      if (part.startsWith("..") || isAbsolute(part)) throw new Error("部署文件越出目标");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: "wx" });
    }
    process.stdout.write(JSON.stringify({ status: "prepared", deployment: "pending", directory: target,
      lock: resolve(target, "core.deployment.lock.json"), coreSha256: core.sha256,
      lockSha256: createHash("sha256").update(files.get("core.deployment.lock.json")!).digest("hex") }) + "\n");
  } catch (error) {
    // 只移除本命令刚创建且没有发布的候选，绝不覆盖/删除原活动组合。
    if (created) rmSync(target, { recursive: true });
    throw error;
  }
}

try { prepare(); }
catch (error) { process.stderr.write((error instanceof Error ? error.message : "部署准备失败") + "\n"); process.exitCode = 1; }
