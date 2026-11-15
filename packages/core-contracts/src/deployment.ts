/** 将已核定的平台迁移和Core包组合为一份Prisma部署目录。只生成新文件，不连接库或执行DDL。 */
import { createHash } from "node:crypto";
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "./update";
import { CoreIdSchema, CoreMigrationSchema, CorePackagePathSchema } from "./manifest";
import { inspectCorePackageFiles } from "./package";
import { checkCoreCombination } from "./compatibility";
import { isDeepStrictEqual } from "node:util";
import { createCoreArchive } from "./archive";

export function corePrismaMigrationName(coreId: string, migrationId: string): string {
  CoreIdSchema.parse(coreId);
  CoreMigrationSchema.shape.id.parse(migrationId);
  return `core.${coreId}.${migrationId}`;
}

export function createCoreMigrationDeployment(input: {
  lock: CoreDeploymentLock;
  platform: readonly { name: string; sql: Uint8Array }[];
  cores: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
}): ReadonlyMap<string, Uint8Array> {
  const lock = CoreDeploymentLockSchema.parse(input.lock), compatibility = checkCoreCombination(lock.cores.map(pin => pin.manifest), lock.platform.versions);
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
  for (const pin of [...lock.cores].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))) {
    const source = input.cores.get(pin.manifest.id);
    if (!source) throw new Error(`所选Core缺少已核定包：${pin.manifest.id}`);
    const inspected = inspectCorePackageFiles(source, lock.platform.versions);
    if (!inspected.ok || !inspected.manifest || !isDeepStrictEqual(inspected.manifest, pin.manifest)
      || createCoreArchive(source).sha256 !== pin.sha256)
      throw new Error(`所选Core清单/包文件与部署锁不一致：${pin.manifest.id}`);
    for (const migration of pin.manifest.data.migrations) put(corePrismaMigrationName(pin.manifest.id, migration.id), source.get(migration.file)!);
  }
  const ordered = [...names].sort();
  const declared = [...input.platform.map(migration => migration.name), ...[...lock.cores].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
    .flatMap(pin => pin.manifest.data.migrations.map(migration => corePrismaMigrationName(pin.manifest.id, migration.id)))];
  if (ordered.some((name, index) => name !== declared[index])) throw new Error("Prisma按目录排序执行迁移，声明顺序与实际顺序不一致");
  files.set("schema.prisma", Buffer.from('datasource db {\n  provider = "mysql"\n  url = env("DATABASE_URL")\n}\n'));
  files.set("migrations/migration_lock.toml", Buffer.from('provider = "mysql"\n'));
  files.set("core.deployment.lock.json", Buffer.from(JSON.stringify(lock, null, 2) + "\n"));
  return files;
}
