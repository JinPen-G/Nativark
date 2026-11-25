/** 工单宿主从固定底座归档、实际运行包和原数据观察读取当前组合。
 * 不接受业务请求中的目录，不下载、迁移或补造就绪状态；缺运行证据时保持不可用。 */
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  CORE_CONTRACT_VERSION, CoreDeploymentLockSchema, type CoreDataObservation, type CoreDeploymentLock
} from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, createCoreArchive, readCoreArchive } from "@rental-os/core-contracts/archive";
import { readCorePackageFiles, readPackageArtifacts } from "@rental-os/core-contracts/package";
import { readPlatformRuntimeEvidence } from "@rental-os/platform-core-host";
import {
  CorePackageArtifactSchema, createPlatformCorePackageArchiveIndexSource, inspectCorePackageArtifact,
  readCorePackageOrdinaryFile
} from "@rental-os/platform-core-host/core-package-preflight";
import type { CorePackageDeploymentSource } from "@rental-os/platform-core-host/core-package-ports";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import type { CorePackagePreparationMaterialsSource } from "@rental-os/platform-core-host/core-package-preparation";
import { requireTicketsDeploymentPackage } from "./deployment-package";

export interface TicketsCorePackageSourcesInput {
  lock: CoreDeploymentLock;
  storageDirectory?: string;
  platformReference?: string;
  observe(): Promise<CoreDataObservation>;
  /** 候选准备在原身份事务内重读，观察器须绑定本次传入的 SQL 读取器。 */
  observeInTransaction?(transaction: Pick<CoreHostSqlTransaction, "$queryRaw">): Promise<CoreDataObservation>;
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** 入口只能从本宿主的静态依赖解析，六公共包与工单包必须属于同一部署上下文。 */
async function readPlatformRuntime(files: ReadonlyMap<string, Uint8Array>, lock: CoreDeploymentLock) {
  const directories = ["packages/platform-contracts", "packages/core-contracts", "packages/core-host",
    "packages/platform-server", "packages/platform-core-host", "apps/platform-api"] as const;
  const entries = [require.resolve("@rental-os/platform-contracts"), require.resolve("@rental-os/core-contracts"),
    require.resolve("@rental-os/core-host"), require.resolve("@rental-os/platform-server"),
    require.resolve("@rental-os/platform-core-host"), require.resolve("@rental-os/platform-api/data-plan")];
  const directory = resolve(dirname(entries[5]), "../../..");
  const receiptFile = "platform-host.context.json";
  if (!readPlatformRuntimeEvidence({ directory,
    runtimeDirectories: new Map(directories.map((item, index) => [item, resolve(dirname(entries[index]), "..")])),
    runtimeEntries: new Map(directories.map((item, index) => [item, entries[index]])),
    platformFiles: files, lock, receiptFile,
    deploymentLockFile: "apps/example-tickets-api/prisma-deployment/core.deployment.lock.json" })) return;
  const context = JSON.parse((await readCorePackageOrdinaryFile(join(directory, receiptFile), 8 * 1024 * 1024)).toString("utf8"));
  if (context.host !== "example-tickets"
    || !isDeepStrictEqual(context.corePackages, [{ id: "example-tickets", sha256: lock.cores[0].sha256 }]))
    throw new Error("实际运行上下文不是当前固定工单组合");
  // 原公共观察读取公共目录；将它使用的 schema 和 SQL 也核到同一固定源码归档。
  const dataFiles = ["apps/platform-api/prisma/schema.prisma",
    ...lock.platform.data.migrations.map(migration => `apps/platform-api/${migration.file}`)];
  readPackageArtifacts(directory, dataFiles.map(file => {
    const bytes = files.get(file);
    if (!bytes) throw new Error("固定底座缺少原公共数据材料");
    return { file, sha256: digest(bytes) };
  }), CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  return directory;
}

export function createTicketsCorePackageSources(input: TicketsCorePackageSourcesInput): {
  deployment: CorePackageDeploymentSource; materials: CorePackagePreparationMaterialsSource;
} {
  const lock = CoreDeploymentLockSchema.parse(input.lock);
  if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== "example-tickets" || lock.dataCapabilities?.length)
    throw new Error("工单包读取源须且仅包含 example-tickets，不选择数据能力");
  const pin = lock.cores[0], storage = input.storageDirectory, reference = input.platformReference;
  if (storage && !isAbsolute(storage)) throw new Error("Core 包存储根须为宿主配置的绝对目录");
  const artifacts = storage && reference
    ? createPlatformCorePackageArchiveIndexSource({ directory: join(storage, "archives") }) : undefined;
  const observe = input.observe.bind(input);
  const observeInTransaction = input.observeInTransaction?.bind(input);

  async function readCurrent() {
    if (!artifacts || !reference) return;
    const value = await artifacts.read(reference);
    if (!value) return;
    const artifact = CorePackageArtifactSchema.parse(value);
    if (artifact.kind !== "platform" || !isDeepStrictEqual(artifact.release, lock.platform))
      throw new Error("本地底座标准包与当前工单启动锁的完整发行不一致");
    if (lock.platform.versions.contract !== CORE_CONTRACT_VERSION || lock.platform.versions.node !== process.versions.node)
      throw new Error("当前合同或 Node 版本与工单启动锁不一致");
    if (!inspectCorePackageArtifact(artifact, undefined, {}).ok)
      throw new Error("本地底座标准包未通过原发行检查");
    const platformFiles = readCoreArchive(artifact.bytes, artifact.release.sha256).files;
    const directory = await readPlatformRuntime(platformFiles, lock);
    if (!directory) return;
    const tickets = requireTicketsDeploymentPackage(pin, lock.platform.versions);
    if (!isDeepStrictEqual(tickets.manifest, pin.manifest)
      || relative(resolve(directory, "packages/example-tickets-core"), tickets.root) !== "")
      throw new Error("实际工单包与当前固定部署上下文不一致");
    const ticketsFiles = readCorePackageFiles(tickets.root, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
    // 原入口已完整核包；再次读取材料后核摘要，拒绝两次读取之间的变化。
    if (createCoreArchive(ticketsFiles).sha256 !== pin.sha256)
      throw new Error("工单包材料在读取期间已变化");
    const platform = lock.platform.data.migrations.map(migration => {
      const match = /^prisma\/migrations\/([^/]+)\/migration\.sql$/.exec(migration.file);
      const sql = platformFiles.get(`apps/platform-api/${migration.file}`);
      if (!match || !sql || digest(sql) !== migration.sha256)
        throw new Error("当前底座缺少与原迁移合同相同的材料");
      return { name: match[1], sql: Buffer.from(sql) };
    });
    return { platform, cores: new Map([[pin.manifest.id, ticketsFiles]]) };
  }

  async function readDeployment(readObservation: () => Promise<CoreDataObservation>) {
    if (!await readCurrent()) return;
    return { lock: structuredClone(lock), installed: {
      platform: structuredClone(lock.platform), cores: structuredClone(lock.cores),
      ...(lock.dataCapabilities === undefined ? {} : { dataCapabilities: [] })
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
          ...(lock.dataCapabilities === undefined ? {} : { dataCapabilities: new Map() }) };
      }
    }
  };
}
