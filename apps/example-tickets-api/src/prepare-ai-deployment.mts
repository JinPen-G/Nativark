/** 显式组合固定公共AI材料与完整工单AI包；只准备原迁移和唯一Client的schema。
 * 输出新目录，保持历史迁移字节/账名，不安装、连库、迁移或产生运行准入。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { CoreDeploymentLockSchema, coreDeploymentHostVersions } from "@rental-os/core-contracts";
import { createCoreMigrationDeployment, writeCoreMigrationDeployment } from "@rental-os/core-contracts/deployment";
import { packCoreDirectory } from "@rental-os/core-contracts/install";
import { readCorePackageFiles } from "@rental-os/core-contracts/package";
import { CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import { readPlatformDataCapabilityPackage } from "@rental-os/core-contracts/platform-data-package";
import { readPublicAiDataPackage } from "@rental-os/ai-native-data/public-data-package";
import { composePublicAiPrismaSchema } from "@rental-os/ai-native-data/public-data";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";

const require = createRequire(import.meta.url);
export function prepareTicketsAiDeployment(args: readonly string[]) {
  if (args.length !== 4 || args.some(argument => !isAbsolute(argument)))
    throw new Error("用法：prepare-ai-deployment.mjs <公共AI部署锁> <公共AI数据包目录> <完整工单AI包目录> <新部署目录>；均须绝对路径");
  const base = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(args[0], "utf8")));
  const selected = base.dataCapabilities?.[0], platform = createPublicPlatformDataPlan();
  if (base.cores.length || base.dataCapabilities?.length !== 1 || selected?.id !== "ai-native"
    || !isDeepStrictEqual(base.platform.data, platform.data))
    throw new Error("输入须为与当前公共宿主同源的零Core+公共AI固定部署锁");
  const { files: dataFiles } = readPlatformDataCapabilityPackage(args[1], selected);
  const { contribution } = readPublicAiDataPackage(dataFiles, selected);
  const host = coreDeploymentHostVersions(base), core = packCoreDirectory(args[2], host);
  if (core.manifest.id !== "example-tickets" || core.manifest.entries.ai !== "dist-ai/index.mjs")
    throw new Error("本命令只组合声明正式AI入口的完整工单包");
  const source = readCorePackageFiles(args[2], CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  const lock = CoreDeploymentLockSchema.parse({ ...base, cores: [{ manifest: core.manifest, sha256: core.sha256 }] });
  const platformRoot = resolve(dirname(require.resolve("@rental-os/platform-api/data-plan")), ".."), target = resolve(args[3]);
  // 公共schema的生成器指向 ../generated/client；拒绝把Client生成到另一树或另一宿主。
  if (dirname(target) !== platformRoot) throw new Error("部署新目录须位于当前 apps/platform-api 下，以复用唯一 generated/client");
  const files = new Map(createCoreMigrationDeployment({ lock, cores: new Map([[core.manifest.id, source]]),
    dataCapabilities: new Map([[selected.id, dataFiles]]), platform: platform.migrationNames.map((name, index) => ({
      name, sql: readFileSync(resolve(platformRoot, platform.data.migrations[index].file)) })) }));
  const schema = composePublicAiPrismaSchema(readFileSync(resolve(platformRoot, "prisma/schema.prisma"), "utf8"), contribution);
  files.set("schema.prisma", Buffer.from(schema));
  writeCoreMigrationDeployment(target, files);
  return { status: "prepared" as const, deployment: "pending" as const, directory: target,
    lock: resolve(target, "core.deployment.lock.json"), coreSha256: core.sha256, dataSha256: selected.sha256,
    schemaSha256: createHash("sha256").update(schema).digest("hex"),
    lockSha256: createHash("sha256").update(files.get("core.deployment.lock.json")!).digest("hex") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(prepareTicketsAiDeployment(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : "工单AI部署准备失败") + "\n"); process.exitCode = 1; }
}
