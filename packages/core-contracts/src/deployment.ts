/** 将已核定的平台迁移和 Core 包组合为候选目录。只准备新文件，不连接库或执行 DDL。 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, rmdirSync, unlinkSync, writeFileSync,
  type Stats } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "./update";
import { CoreIdSchema, CoreMigrationSchema, CorePackagePathSchema, CoreSourceSchema } from "./manifest";
import { CoreVersionRangeSchema, isCoreVersionSupported } from "./version";
import { inspectCorePackageFiles } from "./package";
import { checkCoreCombination } from "./compatibility";
import { isDeepStrictEqual } from "node:util";
import { createCoreArchive } from "./archive";
import { checkPlatformDataCapabilities, coreDeploymentHostVersions } from "./data-capability";
import { requirePlatformDataCapabilityFiles } from "./platform-data-package";

export function corePrismaMigrationName(coreId: string, migrationId: string): string {
  CoreIdSchema.parse(coreId);
  CoreMigrationSchema.shape.id.parse(migrationId);
  return `core.${coreId}.${migrationId}`;
}

export function platformCapabilityPrismaMigrationName(capabilityId: string, migrationId: string): string {
  CoreIdSchema.parse(capabilityId);
  CoreMigrationSchema.shape.id.parse(migrationId);
  if (!migrationId.startsWith(`${capabilityId}.`)) throw new Error("能力迁移未使用所属命名空间");
  return `platform-capability.${migrationId}`;
}

const migrationRequirement = z.object({
  version: CoreVersionRangeSchema,
  migration: CoreMigrationSchema.pick({ id: true, sha256: true })
}).strict();
const postCapabilityCoreMigration = z.object({
  coreId: CoreIdSchema,
  migration: CoreMigrationSchema.extend({ source: CoreSourceSchema }).strict(),
  prerequisites: z.object({
    core: migrationRequirement,
    capability: migrationRequirement.extend({ id: CoreIdSchema }).strict()
  }).strict()
}).strict();

/** Only fresh-install preparation understands the additional phase. Old runtime and update readers reject this lock. */
export const CorePhasedMigrationLockSchema = z.object({
  lockVersion: z.literal(2),
  base: CoreDeploymentLockSchema,
  postCapability: z.array(postCapabilityCoreMigration).min(1).max(100)
}).strict();
export type CorePostCapabilityMigration = z.infer<typeof postCapabilityCoreMigration>;

export function corePostCapabilityPrismaMigrationName(coreId: string, migrationId: string): string {
  CoreIdSchema.parse(coreId);
  CoreMigrationSchema.shape.id.parse(migrationId);
  if (!migrationId.startsWith(`${coreId}.`)) throw new Error("后置迁移未使用所属 Core 命名空间");
  return `post-capability.${coreId}.${migrationId}`;
}

// 加上目录分隔点比较，保持与最终 Prisma 目录一致，例如 example-tickets 在 example 之前。
function compareMigrationOwner(left: string, right: string): number {
  const leftPrefix = left + ".", rightPrefix = right + ".";
  return leftPrefix < rightPrefix ? -1 : leftPrefix > rightPrefix ? 1 : 0;
}

export function createCoreMigrationDeployment(input: {
  lock: CoreDeploymentLock;
  platform: readonly { name: string; sql: Uint8Array }[];
  cores: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
  dataCapabilities?: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
  /** Trusted host policy, never parsed from a Core package or deployment lock. */
  legacyApiRoutes?: Readonly<Record<string, readonly string[]>>;
}): ReadonlyMap<string, Uint8Array> {
  const lock = CoreDeploymentLockSchema.parse(input.lock), host = coreDeploymentHostVersions(lock);
  const capabilityIssues = checkPlatformDataCapabilities(lock);
  if (capabilityIssues.length) throw new Error(capabilityIssues.map(issue => `${issue.owner}:${issue.field} ${issue.message}`).join("\n"));
  const compatibility = checkCoreCombination(lock.cores.map(pin => pin.manifest), host);
  if (compatibility.issues.length) throw new Error(compatibility.issues.map(issue => `${issue.coreId}:${issue.field} ${issue.message}`).join("\n"));
  const files = new Map<string, Uint8Array>(), names = new Set<string>(), hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  const put = (name: string, sql: Uint8Array) => {
    CorePackagePathSchema.parse(name);
    if (name.includes("/") || names.has(name)) throw new Error("Prisma迁移名称须唯一且不含目录层级");
    names.add(name); files.set(`migrations/${name}/migration.sql`, sql);
  };
  if (input.platform.length !== lock.platform.data.migrations.length) throw new Error("公共迁移源码和锁定链未完整对应");
  input.platform.forEach((migration, at) => {
    if (hash(migration.sql) !== lock.platform.data.migrations[at].sha256) throw new Error("公共迁移原文与部署锁摘要不一致");
    put(migration.name, migration.sql);
  });
  if (input.cores.size !== lock.cores.length) throw new Error("部署迁移只能包含锁定的Core集合");
  for (const pin of [...lock.cores].sort((a, b) => compareMigrationOwner(a.manifest.id, b.manifest.id))) {
    const source = input.cores.get(pin.manifest.id);
    if (!source) throw new Error(`所选Core缺少已核定包：${pin.manifest.id}`);
    const inspected = inspectCorePackageFiles(source, host,
      input.legacyApiRoutes && Object.hasOwn(input.legacyApiRoutes, pin.manifest.id) ? input.legacyApiRoutes[pin.manifest.id] : []);
    if (!inspected.ok || !inspected.manifest || !isDeepStrictEqual(inspected.manifest, pin.manifest)
      || createCoreArchive(source).sha256 !== pin.sha256)
      throw new Error(`所选Core清单/包文件与部署锁不一致：${pin.manifest.id}`);
    for (const migration of pin.manifest.data.migrations) put(corePrismaMigrationName(pin.manifest.id, migration.id), source.get(migration.file)!);
  }
  if ((input.dataCapabilities?.size ?? 0) !== (lock.dataCapabilities?.length ?? 0)) throw new Error("能力迁移只能包含显式锁定的能力集合");
  const capabilities = [...(lock.dataCapabilities ?? [])].sort((a, b) => compareMigrationOwner(a.id, b.id));
  for (const release of capabilities) {
    const source = input.dataCapabilities?.get(release.id);
    if (!source) throw new Error(`所选能力缺少固定包：${release.id}`);
    requirePlatformDataCapabilityFiles(source, release);
    for (const migration of release.data.migrations)
      put(platformCapabilityPrismaMigrationName(release.id, migration.id), source.get(migration.file)!);
  }
  const declared = [...names];
  const ordered = [...declared].sort();
  if (ordered.some((name, index) => name !== declared[index])) throw new Error("Prisma按目录排序执行迁移，声明顺序与实际顺序不一致");
  files.set("schema.prisma", Buffer.from('datasource db {\n  provider = "mysql"\n  url = env("DATABASE_URL")\n}\n'));
  files.set("migrations/migration_lock.toml", Buffer.from('provider = "mysql"\n'));
  files.set("core.deployment.lock.json", Buffer.from(JSON.stringify(lock, null, 2) + "\n"));
  return files;
}

/** Prepare exact Core-owned SQL after all locked base migrations, without changing any historical ledger name. */
export function createCorePhasedMigrationDeployment(input: Parameters<typeof createCoreMigrationDeployment>[0] & {
  postCapability: readonly { release: CorePostCapabilityMigration; sql: Uint8Array }[];
}) {
  const lock = CorePhasedMigrationLockSchema.parse({ lockVersion: 2, base: input.lock,
    postCapability: input.postCapability.map(entry => entry.release) });
  const files = new Map(createCoreMigrationDeployment({ ...input, lock: lock.base }));
  const coreData = new Map(lock.base.cores.map(({ manifest }) => [manifest.id, manifest.data]));
  const capabilityData = new Map((lock.base.dataCapabilities ?? []).map(release => [release.id, release]));
  const migrationsByCore = new Map<string, Set<string>>();
  const matches = (data: CoreDeploymentLock["platform"]["data"],
    version: string, requirement: z.infer<typeof migrationRequirement>) => isCoreVersionSupported(version, requirement.version)
      && data.migrations.some(entry => entry.id === requirement.migration.id && entry.sha256 === requirement.migration.sha256);
  let previous = [...files.keys()].filter(file => file.endsWith("/migration.sql")).at(-1) ?? "";
  const migrations = lock.postCapability.map((release, index) => {
    const { coreId, migration, prerequisites } = release;
    const core = coreData.get(coreId), capability = capabilityData.get(prerequisites.capability.id);
    if (!core || !capability || !matches(core, core.version, prerequisites.core)
      || !matches(capability.data, capability.version, prerequisites.capability))
      throw new Error(`后置迁移缺少已锁定的 Core 或能力前置：${migration.id}`);
    const usedFiles = migrationsByCore.get(coreId) ?? new Set(core.migrations.map(entry => entry.file));
    if (!migration.file.endsWith(".sql") || usedFiles.has(migration.file) || core.migrations.some(entry => entry.id === migration.id))
      throw new Error(`后置迁移不能替换历史迁移：${migration.id}`);
    const migrationName = corePostCapabilityPrismaMigrationName(coreId, migration.id);
    const file = `migrations/${migrationName}/migration.sql`, sql = input.postCapability[index].sql;
    if (file <= previous || files.has(file)) throw new Error(`后置迁移与 Prisma 目录实际顺序不一致：${migrationName}`);
    if (!(sql instanceof Uint8Array) || !sql.byteLength || sql.byteLength > 32 * 1024 * 1024
      || createHash("sha256").update(sql).digest("hex") !== migration.sha256)
      throw new Error(`后置迁移原文与锁定摘要不一致：${migration.id}`);
    files.set(file, Uint8Array.from(sql));
    usedFiles.add(migration.file);
    migrationsByCore.set(coreId, usedFiles);
    previous = file;
    return { owner: coreId, source: migration.source, originalPath: migration.file, id: migration.id, file,
      ledger: { table: "_prisma_migrations" as const, migrationName, checksum: migration.sha256 } };
  });
  files.set("core.deployment.lock.json", Buffer.from(JSON.stringify(lock, null, 2) + "\n"));
  return { lock, files, postCapability: migrations };
}

/** 独占创建候选路径，最后写锁。失败时只清理仍属本次且内容未被接手的文件和空目录。 */
export function writeCoreMigrationDeployment(directory: string, files: ReadonlyMap<string, Uint8Array>): void {
  if (!isAbsolute(directory)) throw new Error("部署目标须为绝对路径");
  const target = resolve(directory), lockFile = "core.deployment.lock.json", lock = files.get(lockFile);
  if (!lock) throw new Error("部署候选缺少锁");
  const planned = [...files].filter(([file]) => file !== lockFile).concat([[lockFile, lock]]).map(([file, bytes]) => {
    CorePackagePathSchema.parse(file);
    const destination = resolve(target, file), part = relative(target, destination);
    if (!part || part === ".." || part.startsWith(".." + sep) || isAbsolute(part))
      throw new Error("部署文件越出本次候选目录");
    return { destination, bytes };
  });
  const directories = new Map<string, Stats>();
  const written: (typeof planned[number] & { identity: Stats })[] = [];
  const sameIdentity = (left: Stats, right: Stats) =>
    left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs;
  const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

  function verifyDirectories(directory: string): void {
    const parent = dirname(directory);
    if (parent !== directory) verifyDirectories(parent);
    const stat = lstatSync(directory), owned = directories.get(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (owned && !sameIdentity(stat, owned)))
      throw new Error("部署路径不是原普通目录，停止处理该路径");
  }
  function createDirectory(directory: string): void {
    verifyDirectories(dirname(directory));
    mkdirSync(directory);
    let stat: Stats;
    try { stat = lstatSync(directory); }
    catch (error) { throw new Error("无法确认刚创建的候选目录归属，保留该路径", { cause: error }); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("新候选路径已变化，保留该路径");
    directories.set(directory, stat);
  }
  function ensureDirectory(directory: string): void {
    if (directories.has(directory)) { verifyDirectories(directory); return; }
    ensureDirectory(dirname(directory));
    createDirectory(directory);
  }

  try { createDirectory(target); }
  catch (error) {
    if (errorCode(error) === "EEXIST") throw new Error("部署目标已存在，不覆盖当前组合或用户配置", { cause: error });
    throw error;
  }
  try {
    for (const entry of planned) {
      ensureDirectory(dirname(entry.destination));
      const descriptor = openSync(entry.destination, "wx");
      try {
        written.push({ ...entry, identity: fstatSync(descriptor) });
        writeFileSync(descriptor, entry.bytes);
      } finally { closeSync(descriptor); }
    }
  } catch (failure) {
    const cleanupErrors: unknown[] = [];
    function attempt(action: () => void): void {
      try { action(); }
      catch (error) { if (errorCode(error) !== "ENOENT") cleanupErrors.push(error); }
    }
    for (const { destination, identity, bytes } of written.reverse()) attempt(() => {
      verifyDirectories(dirname(destination));
      const current = lstatSync(destination);
      // 写入可能只落了前半段。经其他写入者换掉或改写的内容不能视为本次输出。
      if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, identity) || current.size > bytes.length
        || !readFileSync(destination).equals(bytes.subarray(0, current.size)))
        throw new Error("候选文件身份或内容发生变化");
      unlinkSync(destination);
    });
    for (const directory of [...directories.keys()].reverse()) attempt(() => {
      verifyDirectories(directory);
      rmdirSync(directory);
    });
    if (cleanupErrors.length)
      throw new AggregateError([failure, ...cleanupErrors], "部署准备失败，保留无法确认的候选内容");
    throw failure;
  }
}
