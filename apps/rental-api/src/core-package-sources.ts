/** 当前 Rental 组合的包管理读取源。复用启动锁、实际安装包与原数据观察，
 * 不下载、构建、迁移或授权。底座源码归档缺少运行产物证据时保持不可用。 */
import type { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  CORE_CONTRACT_VERSION, CoreDeploymentLockSchema, coreDeploymentHostVersions,
  type CoreDataObservation, type CoreDeploymentLock, type CoreManifest, type CorePlatformDataCapabilityRelease
} from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, matchesInstalledCoreArchive, readCoreArchive } from "@rental-os/core-contracts/archive";
import { readCorePackageFiles } from "@rental-os/core-contracts/package";
import { readPlatformDataCapabilityPackage } from "@rental-os/core-contracts/platform-data-package";
import {
  CorePackageArtifactSchema, createPlatformCorePackageArchiveIndexSource, inspectCorePackageArtifact
} from "@rental-os/platform-core-host/core-package-preflight";
import type { CorePackageDeploymentSource } from "@rental-os/platform-core-host/core-package-ports";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import type { CorePackagePreparationMaterialsSource } from "@rental-os/platform-core-host/core-package-preparation";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { readPlatformRuntimeEvidence } from "@rental-os/platform-core-host";
import { readRentalPackageSnapshot } from "@rental-os/rental-core/data-package";
import { rentalHostLegacyApiRoutes, rentalHostReleaseOpenApi } from "./openapi";

/** 参加者只由同一受控宿主提供；reader 必须沿原实际依赖位置读取，不能消费请求中的目录或发行。 */
export interface RentalCorePackageSourcesInput {
  configuration: Pick<ConfigService, "get">;
  lock: CoreDeploymentLock;
  rentalPackage(): { root: string; manifest: CoreManifest; sha256: string };
  /** 同一静态装配已核定的实际 server；每次读材料仍重核完整固定包，不能改成配置路径。 */
  additionalCorePackages?: readonly { entry: string; root: string; manifest: CoreManifest; sha256: string }[];
  observe(): Promise<CoreDataObservation>;
  /** 候选准备在原身份事务内重读，观察器须绑定本次传入的 SQL 读取器。 */
  observeInTransaction?(transaction: Pick<CoreHostSqlTransaction, "$queryRaw">): Promise<CoreDataObservation>;
  /** AI 启用入口持有原 requireAiNativeDataPackage；无 AI 入口不导入能力实现。 */
  dataCapabilities?(): readonly { root: string; release: CorePlatformDataCapabilityRelease }[];
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** 按同一静态装配的正式入口核对公共运行证据，两个宿主共用原完整检查。 */
function readPlatformRuntime(files: ReadonlyMap<string, Uint8Array>, lock: CoreDeploymentLock): boolean {
  const directories = ["packages/platform-contracts", "packages/core-contracts", "packages/core-host",
    "packages/platform-server", "packages/platform-core-host", "apps/platform-api"] as const;
  const entries = [require.resolve("@rental-os/platform-contracts"), require.resolve("@rental-os/core-contracts"),
    require.resolve("@rental-os/core-host"), require.resolve("@rental-os/platform-server"),
    require.resolve("@rental-os/platform-core-host"), require.resolve("@rental-os/platform-api/data-plan")];
  return readPlatformRuntimeEvidence({ directory: resolve(dirname(entries[5]), "../../.."),
    runtimeDirectories: new Map(directories.map((directory, index) => [directory, resolve(dirname(entries[index]), "..")])),
    runtimeEntries: new Map(directories.map((directory, index) => [directory, entries[index]])),
    platformFiles: files, lock, receiptFile: "rental-host.context.json",
    deploymentLockFile: "apps/rental-api/prisma-deployment/core.deployment.lock.json" });
}

export function createRentalCorePackageSources(input: RentalCorePackageSourcesInput): {
  deployment: CorePackageDeploymentSource; materials: CorePackagePreparationMaterialsSource;
} {
  const lock = CoreDeploymentLockSchema.parse(input.lock);
  if (lock.cores.filter(pin => pin.manifest.id === "rental").length !== 1
    || (lock.dataCapabilities?.length ?? 0) > 1
    || lock.dataCapabilities?.some(release => release.id !== "ai-native"))
    throw new Error("Rental 包读取源须与当前 Rental 及可选 AI 组合一致");
  const pin = lock.cores.find(pin => pin.manifest.id === "rental")!;
  const additional = (input.additionalCorePackages ?? []).map(item => Object.freeze({ ...item,
    manifest: structuredClone(item.manifest) }));
  const extraPins = lock.cores.filter(item => item.manifest.id !== "rental");
  if (additional.length !== extraPins.length || new Set(additional.map(item => item.manifest.id)).size !== additional.length
    || additional.some(item => !extraPins.some(pin => isDeepStrictEqual({ manifest: item.manifest, sha256: item.sha256 }, pin))
      || !isAbsolute(item.root) || !isAbsolute(item.entry) || resolve(item.root, item.manifest.entries.server) !== item.entry))
    throw new Error("额外 Core 材料须逐项等于实际装配的固定包和正式 server 入口");
  const storage = input.configuration.get<string>("CORE_PACKAGE_STORAGE_ROOT");
  const reference = input.configuration.get<string>("CORE_PLATFORM_PACKAGE_REFERENCE");
  if (storage && !isAbsolute(storage)) throw new Error("Core 包存储根须为宿主配置的绝对目录");
  const artifacts = storage && reference
    ? createPlatformCorePackageArchiveIndexSource({ directory: join(storage, "archives") }) : undefined;
  const rentalPackage = input.rentalPackage.bind(input), readCapabilities = input.dataCapabilities?.bind(input);
  const observe = input.observe.bind(input);
  const observeInTransaction = input.observeInTransaction?.bind(input);

  async function readCurrent() {
    if (!artifacts || !reference) return;
    const value = await artifacts.read(reference);
    if (!value) return;
    const artifact = CorePackageArtifactSchema.parse(value);
    if (artifact.kind !== "platform" || !isDeepStrictEqual(artifact.release, lock.platform))
      throw new Error("本地底座标准包与当前启动锁的完整发行不一致");
    if (lock.platform.versions.contract !== CORE_CONTRACT_VERSION || lock.platform.versions.node !== process.versions.node)
      throw new Error("当前合同或 Node 版本与启动锁不一致");
    if (!inspectCorePackageArtifact(artifact, undefined, {}).ok)
      throw new Error("本地底座标准包未通过原发行检查");
    const platformFiles = readCoreArchive(artifact.bytes, artifact.release.sha256).files;
    if (!readPlatformRuntime(platformFiles, lock)) return;

    const runtimeRoot = resolve(dirname(require.resolve("@rental-os/rental-core")), "..");
    const requireRentalRoot = (current: { root: string; manifest: CoreManifest; sha256: string }) => {
      if (!isDeepStrictEqual({ manifest: current.manifest, sha256: current.sha256 }, pin)
        || !isAbsolute(current.root) || relative(runtimeRoot, resolve(current.root)) !== "")
        throw new Error("Rental 实际运行包与当前启动锁不一致");
    };
    let rentalFiles: ReadonlyMap<string, Uint8Array>;
    if (typeof readRentalPackageSnapshot === "function") {
      const current = readRentalPackageSnapshot(runtimeRoot, pin, lock.platform.versions, rentalHostLegacyApiRoutes());
      requireRentalRoot(current);
      const expectedOpenApi = rentalHostReleaseOpenApi(current.manifest.entries.openapi);
      if (!current.openapi || !isDeepStrictEqual(current.openapi, JSON.parse(JSON.stringify(expectedOpenApi))))
        throw new Error("Rental 固定包缺少与当前实际处理器同源的 OpenAPI 贡献");
      rentalFiles = current.files;
    } else {
      // 原 Core 仍走原部署 reader，并对交给本次准备的第二份字节单独核摘要。
      const current = rentalPackage();
      requireRentalRoot(current);
      rentalFiles = readCorePackageFiles(current.root, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
      if (!matchesInstalledCoreArchive(rentalFiles, pin.sha256))
        throw new Error("Rental 包材料在读取期间已变化");
    }
    const coreFiles = new Map([[pin.manifest.id, rentalFiles]]);
    for (const current of additional) {
      const expected = extraPins.find(pin => pin.manifest.id === current.manifest.id)!;
      requireCorePackagePin(current.root, expected, coreDeploymentHostVersions(lock));
      const files = readCorePackageFiles(current.root, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
      if (!matchesInstalledCoreArchive(files, expected.sha256)) throw new Error("额外 Core 包材料在读取期间已变化");
      coreFiles.set(expected.manifest.id, files);
    }

    const capabilities = readCapabilities?.() ?? [];
    const releases = lock.dataCapabilities ?? [];
    if (capabilities.length !== releases.length || new Set(capabilities.map(item => item.release.id)).size !== capabilities.length)
      throw new Error("可选数据能力实际参加者与当前启动锁不一致");
    const capabilityFiles = new Map<string, ReadonlyMap<string, Uint8Array>>();
    for (const release of releases) {
      const current = capabilities.find(item => item.release.id === release.id);
      if (!current || !isAbsolute(current.root) || !isDeepStrictEqual(current.release, release))
        throw new Error("可选数据能力的实际发行与当前启动锁不一致");
      const installed = readPlatformDataCapabilityPackage(current.root, release);
      capabilityFiles.set(release.id, installed.files);
    }

    const platform = lock.platform.data.migrations.map(migration => {
      const match = /^prisma\/migrations\/([^/]+)\/migration\.sql$/.exec(migration.file);
      const sql = platformFiles.get(`apps/platform-api/${migration.file}`);
      if (!match || !sql || digest(sql) !== migration.sha256)
        throw new Error("当前底座缺少与原迁移合同相同的材料");
      return { name: match[1], sql: Buffer.from(sql) };
    });
    return { platform, cores: coreFiles, capabilityFiles };
  }

  async function readDeployment(readObservation: () => Promise<CoreDataObservation>) {
    if (!await readCurrent()) return;
    return { lock: structuredClone(lock), installed: {
      platform: structuredClone(lock.platform), cores: structuredClone(lock.cores),
      ...(lock.dataCapabilities === undefined ? {} : { dataCapabilities: structuredClone(lock.dataCapabilities) })
    }, data: await readObservation() };
  }

  return {
    deployment: {
      read: () => readDeployment(observe),
      ...(observeInTransaction ? { readInTransaction: (transaction: Pick<CoreHostSqlTransaction, "$queryRaw">) =>
        readDeployment(() => observeInTransaction(transaction)) } : {})
    },
    materials: {
      async read() {
        const current = await readCurrent();
        if (!current) return;
        return { base: structuredClone(lock), platform: current.platform, cores: current.cores,
          ...(lock.dataCapabilities === undefined ? {} : { dataCapabilities: current.capabilityFiles }) };
      }
    }
  };
}
