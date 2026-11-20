/** 只准备固定公共发行与 Rental 包的候选迁移/schema/锁；不安装、连接、执行迁移或生成 Client。
 * 新目录完整写成才报告 prepared，已有部署及用户配置始终不覆盖。 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CorePlatformReleaseSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import { createCoreMigrationDeployment } from "@rental-os/core-contracts/deployment";
import { composeCorePrismaSchema } from "@rental-os/core-contracts/prisma";
import { packCoreDirectory } from "@rental-os/core-contracts/install";
import { readCorePackageFiles } from "@rental-os/core-contracts/package";
import { CORE_ARCHIVE_LIMITS, createCoreArchive } from "@rental-os/core-contracts/archive";
import { createPublicPlatformDataPlan } from "@rental-os/platform-api/data-plan";
import { readRentalDataPackage } from "@rental-os/rental-core/data-package";
import { createRentalOpenApi } from "@rental-os/rental-core/http-openapi";
import { rentalHostLegacyApiRoutes } from "./openapi";

/** 内存准备与命令共用；真实已部署状态仍由原迁移账和物理读取判定。 */
export function createRentalDeploymentFiles(input: {
  release: CoreDeploymentLock["platform"];
  pin: CoreDeploymentLock["cores"][number];
  coreFiles: ReadonlyMap<string, Uint8Array>;
  publicSchema: string;
  publicMigrations: readonly { name: string; sql: Uint8Array }[];
}) {
  const release = CorePlatformReleaseSchema.parse(input.release);
  const legacyApiRoutes = rentalHostLegacyApiRoutes();
  const rental = readRentalDataPackage(input.coreFiles, input.pin, release.versions, legacyApiRoutes);
  if (!rental.openapi || !isDeepStrictEqual(rental.openapi, JSON.parse(JSON.stringify(createRentalOpenApi()))))
    throw new Error("Rental 部署准备缺少与当前实际处理器同源的 OpenAPI 贡献");
  const platform = createPublicPlatformDataPlan(rental.dataPlan.publicForeignKeys);
  if (!isDeepStrictEqual(release.data, platform.data)) throw new Error("底座发行数据与当前公共宿主不一致");
  const publicRoot = resolve(dirname(require.resolve("@rental-os/platform-api/data-plan")), "..");
  if (input.publicSchema !== readFileSync(resolve(publicRoot, "prisma/schema.prisma"), "utf8"))
    throw new Error("公共 schema 与当前固定宿主源码不一致");
  if (input.publicMigrations.length !== platform.migrationNames.length
    || input.publicMigrations.some((migration, index) => migration.name !== platform.migrationNames[index]))
    throw new Error("公共迁移目录名与宿主原账顺序不一致");
  const lock: CoreDeploymentLock = { lockVersion: 1, platform: release, cores: [input.pin] };
  const files = new Map(createCoreMigrationDeployment({ lock, platform: input.publicMigrations,
    cores: new Map([[rental.manifest.id, input.coreFiles]]), legacyApiRoutes: { rental: legacyApiRoutes } }));
  const schema = composeCorePrismaSchema(input.publicSchema, [rental.prisma]);
  // 公共生成器保持单源；仅允许输出到本次新迁移目录旁的专属 generated/client。
  const generators = [...schema.matchAll(/^generator\s+\w+\s*\{([\s\S]*?)^\}/gm)];
  if (generators.length !== 1 || !/provider\s*=\s*"prisma-client-js"/.test(generators[0][1])
    || !/output\s*=\s*"\.\.\/generated\/client"/.test(generators[0][1]))
    throw new Error("Rental 组合生成器须使用本宿主独占的 ../generated/client");
  files.set("schema.prisma", Buffer.from(schema));
  return { status: "prepared" as const, deployment: "pending" as const, lock, files, rental, platform };
}

function prepare(args: string[]) {
  if (args.length !== 3) throw new Error("用法：prepare-deployment.js <固定底座发行JSON> <已准备Rental包目录> <新迁移目录>");
  const release = CorePlatformReleaseSchema.parse(JSON.parse(readFileSync(args[0], "utf8")));
  const packed = packCoreDirectory(args[1], release.versions, rentalHostLegacyApiRoutes());
  const coreFiles = readCorePackageFiles(args[1], CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  if (createCoreArchive(coreFiles).sha256 !== packed.sha256) throw new Error("Rental 包在读取期间变化，停止准备");
  const publicRoot = resolve(dirname(require.resolve("@rental-os/platform-api/data-plan")), "..");
  const platform = createPublicPlatformDataPlan();
  const prepared = createRentalDeploymentFiles({ release, pin: { manifest: packed.manifest, sha256: packed.sha256 }, coreFiles,
    publicSchema: readFileSync(resolve(publicRoot, "prisma/schema.prisma"), "utf8"),
    publicMigrations: platform.migrationNames.map((name, index) => ({ name,
      sql: readFileSync(resolve(publicRoot, platform.data.migrations[index].file)) })) });
  const target = resolve(args[2]);
  for (let current = dirname(target); ; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("迁移目录父路径须为不经过链接的普通目录");
    if (dirname(current) === current) break;
  }
  if (existsSync(target)) throw new Error("迁移目录已存在，不覆盖当前组合或用户配置");
  let created = false;
  try {
    mkdirSync(target); created = true;
    for (const [file, bytes] of prepared.files) {
      const destination = resolve(target, file), part = relative(target, destination);
      if (part === ".." || part.startsWith("../") || part.startsWith("..\\") || isAbsolute(part))
        throw new Error("部署文件越出本次新迁移目录");
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: "wx" });
    }
    process.stdout.write(JSON.stringify({ status: prepared.status, deployment: prepared.deployment, directory: target,
      schema: resolve(target, "schema.prisma"), clientOutput: resolve(target, "../generated/client"),
      lock: resolve(target, "core.deployment.lock.json"), coreSha256: packed.sha256,
      lockSha256: createHash("sha256").update(prepared.files.get("core.deployment.lock.json")!).digest("hex") }) + "\n");
  } catch (error) {
    if (created) {
      if (resolve(target) !== target || lstatSync(target).isSymbolicLink()) throw new Error("本次候选清理路径发生变化，停止清理");
      rmSync(target, { recursive: true });
    }
    throw error;
  }
}

if (require.main === module) {
  try { prepare(process.argv.slice(2)); }
  catch (error) { process.stderr.write((error instanceof Error ? error.message : "Rental 部署准备失败") + "\n"); process.exitCode = 1; }
}
