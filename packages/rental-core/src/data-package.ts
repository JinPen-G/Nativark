/** 固定 Rental 包的数据读取边界。清单、完整包摘要、模型和迁移必须同源；
 * 返回部署准备材料，不连接数据库、不标记迁移成功或初始化业务。 */
import { isDeepStrictEqual } from "node:util";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CorePackagePinSchema, CoreOpenApiContributionSchema, type CoreDeploymentLock, type CoreHostVersions } from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, createCoreArchive, matchesInstalledCoreArchive } from "@rental-os/core-contracts/archive";
import { inspectCorePackageFiles, readCorePackageFiles } from "@rental-os/core-contracts/package";
import { RENTAL_CORE_ID, RENTAL_CORE_SCOPE, RENTAL_CORE_VERSION } from "./core-identity";
import { createRentalDataRelease, readRentalPrismaSchema, RENTAL_DATA_MIGRATIONS,
  RENTAL_DATA_READABLE, RENTAL_DATA_VERSION, RENTAL_PRISMA_SCHEMA } from "./data";
import { createRentalPrismaContribution } from "./prisma-schema";
import { createRentalMysqlDataPlanFromRelease } from "./mysql-data";

export function readRentalDataPackage(files: ReadonlyMap<string, Uint8Array>,
  input: CoreDeploymentLock["cores"][number], host: CoreHostVersions, legacyApiRoutes: readonly string[] = []) {
  return readDataPackage(files, input, host, legacyApiRoutes, false);
}

function readDataPackage(files: ReadonlyMap<string, Uint8Array>, input: CoreDeploymentLock["cores"][number],
  host: CoreHostVersions, legacyApiRoutes: readonly string[], installed: boolean) {
  const pin = CorePackagePinSchema.parse(input);
  const inspected = inspectCorePackageFiles(files, host, legacyApiRoutes);
  if (!inspected.ok || !inspected.manifest || !isDeepStrictEqual(inspected.manifest, pin.manifest)
    || !(installed ? matchesInstalledCoreArchive(files, pin.sha256) : createCoreArchive(files).sha256 === pin.sha256))
    throw new Error("Rental 完整包与锁定清单、摘要或宿主版本不一致");
  if (pin.manifest.id !== RENTAL_CORE_ID || pin.manifest.version !== RENTAL_CORE_VERSION
    || !isDeepStrictEqual(pin.manifest.scope, RENTAL_CORE_SCOPE))
    throw new Error("所选包不是当前 Rental 实现及其原绑定范围");
  const required = (file: string) => {
    const bytes = files.get(file);
    if (!bytes) throw new Error(`Rental 数据发行缺少 ${file}`);
    return bytes;
  };
  const release = createRentalDataRelease({ version: RENTAL_DATA_VERSION, readable: RENTAL_DATA_READABLE,
    migrations: RENTAL_DATA_MIGRATIONS.map(migration => ({ ...migration, bytes: required(migration.file) })) });
  if (!isDeepStrictEqual(pin.manifest.data, release.data))
    throw new Error("Rental 清单数据版本或迁移链与当前实现不一致");
  const schema = readRentalPrismaSchema(required(RENTAL_PRISMA_SCHEMA.file));
  const openapi = pin.manifest.entries.openapi
    ? CoreOpenApiContributionSchema.parse(JSON.parse(Buffer.from(required(pin.manifest.entries.openapi)).toString("utf8"))) : undefined;
  return { manifest: pin.manifest, sha256: pin.sha256, release, schema,
    openapi, prisma: createRentalPrismaContribution(schema), dataPlan: createRentalMysqlDataPlanFromRelease(release) };
}

function requireOrdinaryDirectory(directory: string): string {
  const absolute = resolve(directory);
  for (let current = absolute; ; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Rental 标准包须位于不经过链接的普通目录");
    if (dirname(current) === current) return realpathSync(absolute);
  }
}

/** 读取并核对同一份包字节。准备流程可以直接使用本次核定的快照。 */
export function readRentalPackageSnapshot(directory: string, pin: CoreDeploymentLock["cores"][number], host: CoreHostVersions,
  legacyApiRoutes: readonly string[] = []) {
  const root = requireOrdinaryDirectory(directory);
  const files = readCorePackageFiles(root, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  const selected = readDataPackage(files, pin, host, legacyApiRoutes, true);
  if (requireOrdinaryDirectory(directory) !== root) throw new Error("Rental 标准包目录在读取期间已变化");
  return { root, ...selected, files };
}

/** 宿主启动只保留核定后的模型、迁移、文档等材料。 */
export function requireRentalDataPackage(directory: string, pin: CoreDeploymentLock["cores"][number], host: CoreHostVersions,
  legacyApiRoutes: readonly string[] = []) {
  const { files, ...selected } = readRentalPackageSnapshot(directory, pin, host, legacyApiRoutes);
  return selected;
}
