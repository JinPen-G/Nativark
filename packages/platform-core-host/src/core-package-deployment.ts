/** 从标准源码包及宿主运行证据核同公共六包；零 Core 读取启动锁和原迁移材料。
 * 目录/入口由可信宿主固定；收据不代替数据状态，后者沿原 MySQL 迁移账与物理读取提供。 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CORE_CONTRACT_VERSION, CoreDeploymentLockSchema, CorePackagePathSchema,
  type CoreDeploymentLock } from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, readCoreArchive } from "@rental-os/core-contracts/archive";
import { CorePhasedMigrationLockSchema } from "@rental-os/core-contracts/deployment";
import { readPackageArtifacts } from "@rental-os/core-contracts/package";
import { PLATFORM_SOURCE_WORKSPACES } from "@rental-os/core-contracts/platform-source";
import { createMysqlCoreDeploymentObservation, type CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import type { CorePackageDeploymentSource } from "./core-package-ports";
import type { CorePackagePreparationMaterialsSource } from "./core-package-preparation";
import { inspectCorePackageArtifact } from "./core-package-preflight/application";
import { readCorePackageOrdinaryFile } from "./core-package-preflight/archive-source";
import { CorePackageArtifactSchema, type CorePackageArtifactSource } from "./core-package-preflight/ports";

const serverWorkspaces = PLATFORM_SOURCE_WORKSPACES.filter(directory =>
  directory !== "packages/platform-admin" && directory !== "apps/platform-admin");
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
    CorePackagePathSchema.parse(value.file);
    return { file: value.file, sha256: value.sha256 };
  });
  if (new Set(result.map(item => item.file)).size !== result.length) throw new Error("宿主编译证据文件重复");
  return result;
};

/** 原打包器实际从固定源码及所选 Client 重编六包，此处核原收据、完整锁和实际加载入口。
 * 所有路径只由静态宿主提供，不能来自请求。收据与运行文件同属受控部署材料，不是外部签名。
 * 仅收据不存在返回 false，供原源码目录兼容；已存在但损坏的证据必须报错，不能降级。 */
export interface PlatformRuntimeEvidenceInput {
  directory: string;
  runtimeDirectories: ReadonlyMap<string, string>;
  runtimeEntries: ReadonlyMap<string, string>;
  platformFiles: ReadonlyMap<string, Uint8Array>;
  lock: CoreDeploymentLock;
  receiptFile: string;
  deploymentLockFile: string;
}

export function readPlatformRuntimeEvidence(input: PlatformRuntimeEvidenceInput): boolean {
  return readRuntimeEvidence(input, false);
}

export type PhasedPlatformRuntimeEvidenceInput = Omit<PlatformRuntimeEvidenceInput, "lock"> & {
  lock: ReturnType<typeof CorePhasedMigrationLockSchema.parse>;
};

/** 只读核 v2 的完整原上下文及公共六包，绝不将 base 交给 v1 读取器。
 * 公共 Client 的编译依据沿原 platformBuild；实际组合 Client/扩展仍须宿主原选择器复核。
 * 缺收据返回 false，损坏/换锁报错；结果不代表数据库、初始化或 v1 升级可用。 */
export function readPhasedPlatformRuntimeEvidence(input: PhasedPlatformRuntimeEvidenceInput): boolean {
  const lock = CorePhasedMigrationLockSchema.parse(input.lock);
  if (lock.base.platform.versions.contract !== CORE_CONTRACT_VERSION || lock.base.platform.versions.node !== process.versions.node)
    throw new Error("分阶段锁的合同或 Node 与当前实际运行版本不一致");
  return readRuntimeEvidence({ ...input, lock }, true);
}

function readRuntimeEvidence(input: PlatformRuntimeEvidenceInput | PhasedPlatformRuntimeEvidenceInput, phased: boolean): boolean {
  const { platformFiles: files, lock, runtimeDirectories, runtimeEntries, receiptFile, deploymentLockFile } = input;
  const platform = lock.lockVersion === 2 ? lock.base.platform : lock.platform;
  if (!isAbsolute(input.directory)) throw new Error("宿主运行证据须使用实际绝对部署目录");
  CorePackagePathSchema.parse(receiptFile); CorePackagePathSchema.parse(deploymentLockFile);
  const format = receiptFile === "platform-host.context.json" ? "platform-host-context-1"
    : receiptFile === "rental-host.context.json" ? "rental-host-context-1" : undefined;
  if (!format) throw new Error("宿主运行证据须使用已登记的上下文收据");
  const root = resolve(input.directory);
  for (let directory = root; ; directory = dirname(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("宿主上下文须位于不经过链接的实际部署目录");
    if (dirname(directory) === directory) break;
  }
  let contextBytes: Buffer;
  try {
    const contextPath = join(root, receiptFile), stat = lstatSync(contextPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      throw new Error("宿主上下文须为有界普通文件");
    contextBytes = readFileSync(contextPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (contextBytes.length > 8 * 1024 * 1024) throw new Error("宿主上下文读取越限");
  const context = record(JSON.parse(contextBytes.toString("utf8")));
  if (phased && (receiptFile !== "rental-host.context.json" || context.ledgerVersion !== 2 || context.installation !== "fresh-ai"))
    throw new Error("完整 v2 证据须来自原分阶段新装上下文");
  const build = record(context.platformBuild), compiler = record(build.compiler), client = record(build.client);
  const sourceLockBytes = files.get("package-lock.json"), schema = files.get("apps/platform-api/prisma/schema.prisma");
  if (!sourceLockBytes || !schema) throw new Error("固定底座缺少原锁或公共 schema");
  const sourceLock = record(JSON.parse(Buffer.from(sourceLockBytes).toString("utf8")));
  const compilerLock = record(record(sourceLock.packages)["node_modules/typescript"]);
  if (context.format !== format || !isDeepStrictEqual(build.release, platform)
    || build.sourceArchiveSha256 !== platform.sha256 || build.sourceLockSha256 !== digest(sourceLockBytes)
    || compiler.name !== "typescript" || compiler.version !== compilerLock.version
    || typeof compiler.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(compiler.sha256)
    || client.mode !== "platform" || client.schemaSha256 !== digest(schema)
    || typeof client.declarationsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(client.declarationsSha256))
    throw new Error("实际宿主编译来源、版本或公共 Client 与当前发行不一致");
  const projects = build.projects;
  if (!Array.isArray(projects) || projects.length !== serverWorkspaces.length
    || projects.some((item, index) => {
      const project = record(item);
      return project.project !== `${serverWorkspaces[index]}/tsconfig.json`
        || !project.options || typeof project.options !== "object" || Array.isArray(project.options)
        || typeof project.inputsSha256 !== "string" || !/^[a-f0-9]{64}$/.test(project.inputsSha256);
    })) throw new Error("宿主编译项目不完整或顺序改变");
  artifactsList(build.dependencies);
  const generated = artifactsList(build.generated), contextFiles = new Map(artifactsList(context.files)
    .map(item => [item.file, item.sha256]));
  if (generated.some(item => !serverWorkspaces.some(directory => item.file.startsWith(directory + "/"))
    || contextFiles.get(item.file) !== item.sha256)) throw new Error("同源产物越出公共运行闭包或不属于原上下文");
  const inventory = serverWorkspaces.map(directory => ({ directory,
    artifacts: generated.filter(item => item.file.startsWith(directory + "/"))
      .map(item => ({ file: item.file.slice(directory.length + 1), sha256: item.sha256 })) }));
  if (inventory.some(item => !item.artifacts.some(file => file.file.endsWith(".js"))
    || !item.artifacts.some(file => file.file.endsWith(".d.ts"))
    || !item.artifacts.some(file => file.file === "package.json")
    || item.artifacts.some(file => file.file !== "package.json" && !runtimeFile(file.file))))
    throw new Error("宿主编译产物缺失或含非运行材料");
  if (runtimeDirectories.size !== serverWorkspaces.length || runtimeEntries.size !== serverWorkspaces.length)
    throw new Error("实际公共运行模块及入口集合与标准底座包不一致");
  for (const item of inventory) {
    const directory = runtimeDirectories.get(item.directory), entry = runtimeEntries.get(item.directory);
    if (!directory || !isAbsolute(directory) || relative(root, directory).split("\\").join("/") !== item.directory)
      throw new Error("公共运行包不属于同一宿主上下文");
    if (!entry || !isAbsolute(entry)) throw new Error("实际加载入口未由静态宿主提供");
    const entryFile = relative(directory, entry).split("\\").join("/");
    if (!runtimeFile(entryFile) || !item.artifacts.some(file => file.file === entryFile)
      || !item.artifacts.some(file => file.file === entryFile.replace(/\.js$/, ".d.ts")))
      throw new Error("实际加载入口不属于本次同源编译");
    const actual = readPackageArtifacts(directory, item.artifacts, CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
    const metadata = files.get(`${item.directory}/package.json`);
    if (!metadata || !Buffer.from(actual.files.get("package.json")!).equals(metadata))
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
  const deploymentSha = contextFiles.get(deploymentLockFile);
  if (!deploymentSha || deploymentSha !== context.deploymentLockSha256) throw new Error("原上下文缺少部署锁摘要");
  // v2 是整份新装上下文，后置 SQL/来源/所选 schema 不能只随 base 的摘要被裁掉。
  // 仍消费原打包器的文件表，禁止把私有配置或依赖目录带入证据读取。
  if (phased) for (const file of contextFiles.keys()) {
    // 根 docs 是维护者私有资料；标准 Core 清单可含包内公开 docs，仍须核原上下文摘要。
    if (file.split("/")[0].toLowerCase() === "docs"
      || file.split("/").some(part => [".git", "node_modules", "output"].includes(part.toLowerCase())
      || /^\.env(?:\.|$)/i.test(part) && part !== ".env.example"))
      throw new Error("分阶段运行证据含非发行文件");
  }
  const verified = readPackageArtifacts(root, [
    ...(phased ? [...contextFiles].map(([file, sha256]) => ({ file, sha256 })) : [{ file: deploymentLockFile, sha256: deploymentSha }]),
    { file: receiptFile, sha256: digest(contextBytes) }
  ], CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
  const actualLock = JSON.parse(Buffer.from(verified.files.get(deploymentLockFile)!).toString("utf8"));
  if (!isDeepStrictEqual(phased ? CorePhasedMigrationLockSchema.parse(actualLock) : CoreDeploymentLockSchema.parse(actualLock), lock))
    throw new Error("实际上下文部署锁与当前宿主不一致");
  return true;
}

export function createPublicCorePackageDeploymentSources(input: {
  database: Pick<CoreHostSqlTransaction, "$queryRaw">;
  artifacts?: CorePackageArtifactSource;
  lockFile?: string;
  platformReference?: string;
  platformDirectory: string;
  runtimeDirectories: ReadonlyMap<string, string>;
  /** 静态 require.resolve 的实际入口；旧完整源码目录可省略，运行收据模式必须完整提供。 */
  runtimeEntries?: ReadonlyMap<string, string>;
  platformData: () => CoreMysqlDataPlan;
}): { deployment: CorePackageDeploymentSource; materials: CorePackagePreparationMaterialsSource } {
  const lockFile = input.lockFile, reference = input.platformReference;
  const readArtifact = input.artifacts?.read.bind(input.artifacts);
  const runtimeDirectories = new Map(input.runtimeDirectories);
  const runtimeEntries = new Map(input.runtimeEntries);
  const platformDirectory = input.platformDirectory, platformData = input.platformData;
  const database: Pick<CoreHostSqlTransaction, "$queryRaw"> = {
    $queryRaw: input.database.$queryRaw.bind(input.database)
  };
  const startupLock = readArtifact && lockFile && reference ? (async () => {
    if (!isAbsolute(lockFile) || !lockFile.toLowerCase().endsWith(".json"))
      throw new Error("启动部署锁须为宿主配置的绝对 JSON 文件路径");
    const bytes = await readCorePackageOrdinaryFile(lockFile, CORE_ARCHIVE_LIMITS.fileBytes);
    const lock = CoreDeploymentLockSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (lock.cores.length || lock.dataCapabilities?.length)
      throw new Error("公共零 Core 宿主的启动锁须与实际未选装组合一致");
    return lock;
  })() : Promise.resolve(undefined);
  // 启动证据错误留给包管理读取表达，公共登录与设置仍可由原宿主提供。
  void startupLock.catch(() => {});

  async function readBase() {
    const lock = await startupLock;
    if (!lock) return;
    const latest = CoreDeploymentLockSchema.parse(JSON.parse(
      (await readCorePackageOrdinaryFile(lockFile!, CORE_ARCHIVE_LIMITS.fileBytes)).toString("utf8")));
    if (!isDeepStrictEqual(latest, lock)) throw new Error("部署锁已变化，须按当前运行组合重新启动装配");
    if (lock.platform.versions.contract !== CORE_CONTRACT_VERSION || lock.platform.versions.node !== process.versions.node)
      throw new Error("启动锁的合同或 Node 版本与当前实际运行版本不一致");
    const artifact = CorePackageArtifactSchema.parse(await readArtifact!(reference!));
    if (artifact.kind !== "platform" || !isDeepStrictEqual(artifact.release, lock.platform))
      throw new Error("本地底座包与启动锁的完整发行资料不一致");
    const inspection = inspectCorePackageArtifact(artifact, undefined, {});
    if (!inspection.ok) throw new Error("本地底座标准包未通过原发行检查");
    const archive = readCoreArchive(artifact.bytes, artifact.release.sha256);
    const files = [...archive.files].map(([file, bytes]) => ({
      file, sha256: createHash("sha256").update(bytes).digest("hex")
    }));
    const runtimeEvidence = readPlatformRuntimeEvidence({ directory: platformDirectory, runtimeDirectories, runtimeEntries,
      platformFiles: archive.files, lock, receiptFile: "platform-host.context.json",
      deploymentLockFile: "apps/platform-api/prisma/core.deployment.lock.json" });
    let installedFiles = archive.files;
    if (runtimeEvidence) {
      // 原数据计划还会核 SQL；此处先把运行目录的 schema/原迁移字节绑定到同一标准源码归档。
      const dataFiles = new Set(["apps/platform-api/prisma/schema.prisma",
        ...lock.platform.data.migrations.map(migration => `apps/platform-api/${migration.file}`)]);
      readPackageArtifacts(platformDirectory, files.filter(file => dataFiles.has(file.file)),
        CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
    } else {
      const installed = readPackageArtifacts(platformDirectory, files,
        CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
      installedFiles = installed.files;
      if (runtimeDirectories.size !== serverWorkspaces.length)
        throw new Error("实际公共运行模块集合与标准底座包不一致");
      for (const directory of serverWorkspaces) {
        const runtime = runtimeDirectories.get(directory);
        const manifest = files.find(file => file.file === `${directory}/package.json`);
        if (!runtime || !manifest) throw new Error(`公共运行模块缺少原包目录：${directory}`);
        const current = readPackageArtifacts(runtime, [{ file: "package.json", sha256: manifest.sha256 }],
          CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
        if (relative(resolve(installed.root, directory), current.root) !== "")
          throw new Error(`实际运行模块未使用当前标准底座目录：${directory}`);
      }
    }
    const plan = platformData();
    if (!isDeepStrictEqual(plan.data, lock.platform.data))
      throw new Error("当前底座数据计划与启动锁的完整迁移合同不一致");
    return { lock, files: installedFiles, plan };
  }

  async function readDeployment(reader: Pick<CoreHostSqlTransaction, "$queryRaw">) {
    const base = await readBase();
    if (!base) return;
    const data = await createMysqlCoreDeploymentObservation({
      database: reader, platform: base.plan, cores: [],
      ...(base.lock.dataCapabilities === undefined ? {} : { dataCapabilities: [] })
    }).read();
    return {
      lock: structuredClone(base.lock),
      installed: {
        platform: structuredClone(base.lock.platform), cores: [],
        ...(base.lock.dataCapabilities === undefined ? {} : { dataCapabilities: [] })
      },
      data
    };
  }

  return {
    deployment: {
      read: () => readDeployment(database),
      readInTransaction: readDeployment
    },
    materials: {
      async read() {
        const base = await readBase();
        if (!base) return;
        const platform = base.lock.platform.data.migrations.map(migration => {
          const match = /^prisma\/migrations\/([^/]+)\/migration\.sql$/.exec(migration.file);
          const sql = base.files.get(`apps/platform-api/${migration.file}`);
          if (!match || !sql) throw new Error("当前底座缺少原 Prisma 迁移目录材料");
          return { name: match[1], sql: Buffer.from(sql) };
        });
        return { base: structuredClone(base.lock), platform, cores: new Map(),
          ...(base.lock.dataCapabilities === undefined ? {} : { dataCapabilities: new Map() }) };
      }
    }
  };
}
