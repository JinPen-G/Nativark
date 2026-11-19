/** 固定 Rental 包的数据读取边界。清单、完整包摘要、模型和迁移必须同源；
 * 返回部署准备材料，不连接数据库、不标记迁移成功或初始化业务。 */
import { isDeepStrictEqual } from "node:util";
import { CorePackagePinSchema, type CoreDeploymentLock, type CoreHostVersions } from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, createCoreArchive } from "@rental-os/core-contracts/archive";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { inspectCorePackageFiles, readCorePackageFiles } from "@rental-os/core-contracts/package";
import { RENTAL_CORE_ID, RENTAL_CORE_SCOPE, RENTAL_CORE_VERSION } from "./core-identity";
import { createRentalDataRelease, readRentalPrismaSchema, RENTAL_DATA_MIGRATIONS,
  RENTAL_DATA_READABLE, RENTAL_DATA_VERSION, RENTAL_PRISMA_SCHEMA } from "./data";
import { createRentalPrismaContribution } from "./prisma-schema";
import { createRentalMysqlDataPlanFromRelease } from "./mysql-data";

export function readRentalDataPackage(files: ReadonlyMap<string, Uint8Array>,
  input: CoreDeploymentLock["cores"][number], host: CoreHostVersions) {
  const pin = CorePackagePinSchema.parse(input);
  const inspected = inspectCorePackageFiles(files, host);
  if (!inspected.ok || !inspected.manifest || !isDeepStrictEqual(inspected.manifest, pin.manifest)
    || createCoreArchive(files).sha256 !== pin.sha256)
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
  return { manifest: pin.manifest, sha256: pin.sha256, release, schema,
    prisma: createRentalPrismaContribution(schema), dataPlan: createRentalMysqlDataPlanFromRelease(release) };
}

/** 运行/构建宿主传明确已准备目录；缺标准清单拒绝，npm作者源码目录不是安装证明。 */
export function requireRentalDataPackage(directory: string, pin: CoreDeploymentLock["cores"][number], host: CoreHostVersions) {
  const installed = requireCorePackagePin(directory, pin, host);
  const files = readCorePackageFiles(installed.root, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  // 再核本次读取的完整字节，包在两次读取之间变化时不能混用模型与迁移。
  return { root: installed.root, ...readRentalDataPackage(files, pin, host) };
}
