/** 条目受控部署准备命令：只在指定新目录生成锁和Prisma迁移组合，不安装/连接/执行代码。 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CorePlatformReleaseSchema } from "@rental-os/core-contracts";
import { createCoreMigrationDeployment, writeCoreMigrationDeployment } from "@rental-os/core-contracts/deployment";
import { packCoreDirectory } from "@rental-os/core-contracts/install";
import { readCorePackageFiles } from "@rental-os/core-contracts/package";
import { CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";

function prepare() {
  const args = process.argv.slice(2);
  if (args.length !== 3) throw new Error("用法：prepare-deployment.js <固定底座发行JSON> <已准备条目包目录> <新部署目录>");
  const release = CorePlatformReleaseSchema.parse(JSON.parse(readFileSync(args[0], "utf8"))), plan = createPublicPlatformDataPlan();
  if (!isDeepStrictEqual(release.data, plan.data)) throw new Error("底座发行资料与当前公共数据计划不一致");
  const core = packCoreDirectory(args[1], release.versions);
  if (core.manifest.id !== "{{CORE_ID}}") throw new Error("本示范命令只接受条目Core，其他Core由自己的受控装配办理");
  const source = readCorePackageFiles(args[1], CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  const lock = { lockVersion: 1 as const, platform: release, cores: [{ manifest: core.manifest, sha256: core.sha256 }] };
  const platformRoot = resolve(dirname(require.resolve("@rental-os/platform-api/data-plan")), "..");
  const files = createCoreMigrationDeployment({ lock, cores: new Map([[core.manifest.id, source]]),
    platform: plan.migrationNames.map((name, at) => ({ name, sql: readFileSync(resolve(platformRoot, plan.data.migrations[at].file)) })) });
  const target = resolve(args[2]);
  writeCoreMigrationDeployment(target, files);
  process.stdout.write(JSON.stringify({ status: "prepared", deployment: "pending", directory: target,
    lock: resolve(target, "core.deployment.lock.json"), coreSha256: core.sha256,
    lockSha256: createHash("sha256").update(files.get("core.deployment.lock.json")!).digest("hex") }) + "\n");
}

try { prepare(); }
catch (error) { process.stderr.write((error instanceof Error ? error.message : "部署准备失败") + "\n"); process.exitCode = 1; }
