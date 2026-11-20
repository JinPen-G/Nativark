/** 读取零 Core 底座的启动发行锁、实际运行模块和完整标准包，供版本观察及候选材料使用。
 * 数据状态沿原 MySQL 迁移账与物理读取提供，运行目录由宿主装配固定。 */
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CORE_CONTRACT_VERSION, CoreDeploymentLockSchema } from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, readCoreArchive } from "@rental-os/core-contracts/archive";
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

export function createPublicCorePackageDeploymentSources(input: {
  database: Pick<CoreHostSqlTransaction, "$queryRaw">;
  artifacts?: CorePackageArtifactSource;
  lockFile?: string;
  platformReference?: string;
  platformDirectory: string;
  runtimeDirectories: ReadonlyMap<string, string>;
  platformData: () => CoreMysqlDataPlan;
}): { deployment: CorePackageDeploymentSource; materials: CorePackagePreparationMaterialsSource } {
  const lockFile = input.lockFile, reference = input.platformReference;
  const readArtifact = input.artifacts?.read.bind(input.artifacts);
  const runtimeDirectories = new Map(input.runtimeDirectories);
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
    const installed = readPackageArtifacts(platformDirectory, files,
      CORE_ARCHIVE_LIMITS.fileBytes, CORE_ARCHIVE_LIMITS.totalBytes);
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
    const plan = platformData();
    if (!isDeepStrictEqual(plan.data, lock.platform.data))
      throw new Error("当前底座数据计划与启动锁的完整迁移合同不一致");
    return { lock, files: installed.files, plan };
  }

  return {
    deployment: {
      async read() {
        const base = await readBase();
        if (!base) return;
        const data = await createMysqlCoreDeploymentObservation({
          database, platform: base.plan, cores: [],
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
