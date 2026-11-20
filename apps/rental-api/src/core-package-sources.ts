/** 当前 Rental 组合的包管理读取源。复用启动锁、实际安装包与原数据观察，
 * 不下载、构建、迁移或授权。底座源码归档缺少运行产物证据时保持不可用。 */
import type { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  CORE_CONTRACT_VERSION, CoreDeploymentLockSchema,
  type CoreDataObservation, type CoreDeploymentLock, type CoreManifest, type CorePlatformDataCapabilityRelease
} from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, createCoreArchive, readCoreArchive } from "@rental-os/core-contracts/archive";
import { readCorePackageFiles, readPackageArtifacts } from "@rental-os/core-contracts/package";
import { readPlatformDataCapabilityPackage } from "@rental-os/core-contracts/platform-data-package";
import {
  CorePackageArtifactSchema, createPlatformCorePackageArchiveIndexSource, inspectCorePackageArtifact
} from "@rental-os/platform-core-host/core-package-preflight";
import type { CorePackageDeploymentSource } from "@rental-os/platform-core-host/core-package-ports";
import type { CorePackagePreparationMaterialsSource } from "@rental-os/platform-core-host/core-package-preparation";

/** 参加者只由同一受控宿主提供；reader 必须沿原实际依赖位置读取，不能消费请求中的目录或发行。 */
export interface RentalCorePackageSourcesInput {
  configuration: Pick<ConfigService, "get">;
  lock: CoreDeploymentLock;
  rentalPackage(): { root: string; manifest: CoreManifest; sha256: string };
  observe(): Promise<CoreDataObservation>;
  /** AI 启用入口持有原 requireAiNativeDataPackage；无 AI 入口不导入能力实现。 */
  dataCapabilities?(): readonly { root: string; release: CorePlatformDataCapabilityRelease }[];
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const runtimeFile = (file: string) => /^dist\/.*\.(?:js|cjs|json|d\.ts)$/.test(file);

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("宿主编译证据格式无效");
  return value as Record<string, unknown>;
};
const artifactsList = (value: unknown): { file: string; sha256: string }[] => {
  if (!Array.isArray(value) || !value.length || value.length > CORE_ARCHIVE_LIMITS.files)
    throw new Error("宿主编译证据文件数无效");
  const result = value.map(item => {
    const value = record(item);
    if (typeof value.file !== "string" || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256))
      throw new Error("宿主编译证据文件摘要无效");
    return { file: value.file, sha256: value.sha256 };
  });
  if (new Set(result.map(item => item.file)).size !== result.length) throw new Error("宿主编译证据文件重复");
  return result;
};

/** 原打包器从固定源码和所选 Client 实际重编译后，在原上下文收据记录生成字节。
 * 此处只核部署目录中的原收据、完整发行和已加载模块，不运行编译器。
 * 收据与可执行文件同属受控部署材料；它不是外部签名，也不接受请求提供的路径或声明。 */
function readPlatformRuntime(files: ReadonlyMap<string, Uint8Array>, lock: CoreDeploymentLock): boolean {
  const directories = ["packages/platform-contracts", "packages/core-contracts", "packages/core-host",
    "packages/platform-server", "packages/platform-core-host", "apps/platform-api"] as const;
  // 使用静态正式出口，避免把源码工作区或配置中的目录冒充当前已加载模块。
  const entries = [require.resolve("@rental-os/platform-contracts"), require.resolve("@rental-os/core-contracts"),
    require.resolve("@rental-os/core-host"), require.resolve("@rental-os/platform-server"),
    require.resolve("@rental-os/platform-core-host"), require.resolve("@rental-os/platform-api/data-plan")];
  const root = resolve(dirname(entries[5]), "../../..");
  for (let directory = root; ; directory = dirname(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("宿主上下文须位于不经过链接的实际部署目录");
    if (dirname(directory) === directory) break;
  }
  const contextPath = join(root, "rental-host.context.json");
  let contextBytes: Buffer;
  try {
    const stat = lstatSync(contextPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      throw new Error("宿主上下文须为有界普通文件");
    contextBytes = readFileSync(contextPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (contextBytes.length > 8 * 1024 * 1024) throw new Error("宿主上下文读取越限");
  const context = record(JSON.parse(contextBytes.toString("utf8")));
  if (context.platformBuild === undefined) return false;
  const build = record(context.platformBuild), compiler = record(build.compiler), client = record(build.client);
  const sourceLockBytes = files.get("package-lock.json"), schema = files.get("apps/platform-api/prisma/schema.prisma");
  if (!sourceLockBytes || !schema) throw new Error("固定底座缺少原锁或公共 schema");
  const sourceLock = record(JSON.parse(Buffer.from(sourceLockBytes).toString("utf8")));
  const compilerLock = record(record(sourceLock.packages)["node_modules/typescript"]);
  if (context.format !== "rental-host-context-1" || !isDeepStrictEqual(build.release, lock.platform)
    || build.sourceArchiveSha256 !== lock.platform.sha256 || build.sourceLockSha256 !== digest(sourceLockBytes)
    || compiler.name !== "typescript" || compiler.version !== compilerLock.version
    || typeof compiler.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(compiler.sha256)
    || client.mode !== "platform" || client.schemaSha256 !== digest(schema)
    || typeof client.declarationsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(client.declarationsSha256))
    throw new Error("实际宿主编译来源、版本或公共 Client 与当前发行不一致");
  const projects = build.projects;
  if (!Array.isArray(projects) || projects.length !== directories.length
    || projects.some((item, index) => {
      const project = record(item);
      return project.project !== `${directories[index]}/tsconfig.json`
        || !project.options || typeof project.options !== "object" || Array.isArray(project.options)
        || typeof project.inputsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(project.inputsSha256);
    })) throw new Error("宿主编译项目不完整或顺序改变");
  artifactsList(build.dependencies);
  const generated = artifactsList(build.generated), contextFiles = new Map(artifactsList(context.files)
    .map(item => [item.file, item.sha256]));
  if (generated.some(item => !directories.some(directory => item.file.startsWith(directory + "/"))
    || contextFiles.get(item.file) !== item.sha256)) throw new Error("同源产物越出公共运行闭包或不属于原上下文");
  const inventory = directories.map(directory => ({ directory,
    artifacts: generated.filter(item => item.file.startsWith(directory + "/"))
      .map(item => ({ file: item.file.slice(directory.length + 1), sha256: item.sha256 })) }));
  if (inventory.some(item => !item.artifacts.some(file => file.file.endsWith(".js"))
    || !item.artifacts.some(file => file.file.endsWith(".d.ts"))
    || !item.artifacts.some(file => file.file === "package.json")
    || item.artifacts.some(file => file.file !== "package.json" && !runtimeFile(file.file))))
    throw new Error("宿主编译产物缺失或含非运行材料");
  for (const [index, item] of inventory.entries()) {
    const entry = entries[index], directory = resolve(dirname(entry), "..");
    if (relative(root, directory).split("\\").join("/") !== item.directory)
      throw new Error("公共运行包不属于同一宿主上下文");
    const entryFile = relative(directory, entry).split("\\").join("/");
    if (!runtimeFile(entryFile) || !item.artifacts.some(file => file.file === entryFile)
      || !item.artifacts.some(file => file.file === entryFile.replace(/\.js$/, ".d.ts")))
      throw new Error("实际加载入口不属于本次同源编译");
    const actual = readPackageArtifacts(directory, item.artifacts, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
    if (!Buffer.from(actual.files.get("package.json")!).equals(files.get(`${item.directory}/package.json`)!))
      throw new Error("实际公共包元数据与固定源码发行不一致");
    const pending = ["dist"], found = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      for (const child of readdirSync(join(directory, current), { withFileTypes: true })) {
        const file = `${current}/${child.name}`;
        if (child.isSymbolicLink()) throw new Error("运行产物不能经过链接");
        if (child.isDirectory()) pending.push(file);
        else {
          if (!child.isFile() || !actual.files.has(file)) throw new Error("实际运行目录包含未声明产物");
          found.add(file);
        }
        if (found.size + pending.length > CORE_ARCHIVE_LIMITS.files) throw new Error("运行产物读取越限");
      }
    }
    if (found.size !== item.artifacts.length - 1) throw new Error("实际运行目录与同源产物集合不一致");
  }
  const deploymentFile = "apps/rental-api/prisma-deployment/core.deployment.lock.json";
  const deploymentSha = contextFiles.get(deploymentFile);
  if (!deploymentSha || deploymentSha !== context.deploymentLockSha256) throw new Error("原上下文缺少部署锁摘要");
  const verified = readPackageArtifacts(root, [
    { file: "rental-host.context.json", sha256: digest(contextBytes) },
    { file: deploymentFile, sha256: deploymentSha }
  ], CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  if (!isDeepStrictEqual(CoreDeploymentLockSchema.parse(JSON.parse(Buffer.from(verified.files.get(deploymentFile)!).toString("utf8"))), lock))
    throw new Error("实际上下文部署锁与当前宿主不一致");
  return true;
}

export function createRentalCorePackageSources(input: RentalCorePackageSourcesInput): {
  deployment: CorePackageDeploymentSource; materials: CorePackagePreparationMaterialsSource;
} {
  const lock = CoreDeploymentLockSchema.parse(input.lock);
  if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== "rental"
    || (lock.dataCapabilities?.length ?? 0) > 1
    || lock.dataCapabilities?.some(release => release.id !== "ai-native"))
    throw new Error("Rental 包读取源须与当前 Rental 及可选 AI 组合一致");
  const pin = lock.cores[0];
  const storage = input.configuration.get<string>("CORE_PACKAGE_STORAGE_ROOT");
  const reference = input.configuration.get<string>("CORE_PLATFORM_PACKAGE_REFERENCE");
  if (storage && !isAbsolute(storage)) throw new Error("Core 包存储根须为宿主配置的绝对目录");
  const artifacts = storage && reference
    ? createPlatformCorePackageArchiveIndexSource({ directory: join(storage, "archives") }) : undefined;
  const rentalPackage = input.rentalPackage.bind(input), readCapabilities = input.dataCapabilities?.bind(input);
  const observe = input.observe.bind(input);

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

    const rental = rentalPackage();
    if (!isDeepStrictEqual({ manifest: rental.manifest, sha256: rental.sha256 }, pin)
      || !isAbsolute(rental.root)
      || relative(resolve(dirname(require.resolve("@rental-os/rental-core")), ".."), resolve(rental.root)) !== "")
      throw new Error("Rental 实际运行包与当前启动锁不一致");
    const rentalFiles = readCorePackageFiles(rental.root, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
    // 原 reader 已完整核包；本次再次读取材料后核同一归档，拒绝两次读取之间的文件变化。
    if (createCoreArchive(rentalFiles).sha256 !== pin.sha256)
      throw new Error("Rental 包材料在读取期间已变化");

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
    return { platform, cores: new Map([[pin.manifest.id, rentalFiles]]), capabilityFiles };
  }

  return {
    deployment: {
      async read() {
        if (!await readCurrent()) return;
        return { lock: structuredClone(lock), installed: {
          platform: structuredClone(lock.platform), cores: structuredClone(lock.cores),
          ...(lock.dataCapabilities === undefined ? {} : { dataCapabilities: structuredClone(lock.dataCapabilities) })
        }, data: await observe() };
      }
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
