/**
 * Rental 数据发行的合同与迁移原文核对，供宿主形成数据计划和原 Prisma 账映射。
 * 迁移字节由受控包读取，物理结构与执行收据由宿主沿原数据观察接点核验。
 */
import { createHash } from "node:crypto";
import { CoreDataContractSchema, type CoreDataContract } from "@rental-os/core-contracts";
import { corePrismaMigrationName } from "@rental-os/core-contracts/deployment";

export const RENTAL_DATA_VERSION = "0.1.1";
// 原绑定仍记录 0.1.0；新表就绪由物理版本和完整迁移链核定。
export const RENTAL_DATA_READABLE = { minInclusive: "0.1.0", maxExclusive: "0.2.0" } as const;
/** 与本版数据计划一起发行；宿主从同一固定包取模型，不回读作者工作区。 */
export const RENTAL_PRISMA_SCHEMA = {
  file: "prisma/schema.prisma",
  sha256: "08dd7ecebeb5cc1f4a389ee13e062501e89cd7e5ef86bb821e9d58eaf050f7b1"
} as const;
export const RENTAL_DATA_MIGRATIONS = [{
  id: "rental.20261119030000-initial",
  file: "prisma/migrations/20261119030000_rental_initial/migration.sql",
  name: "20261119030000_rental_initial",
  sha256: "59e69aadf4db0138561ec9233955941da32a2f27f576583bd7915b9f1a7d05ae"
}, {
  id: "rental.20261125010000-exchange-workflow",
  file: "prisma/migrations/20261125010000_rental_exchange_workflow/migration.sql",
  name: "20261125010000_rental_exchange_workflow",
  sha256: "0313e71d8b5d19186296e767792ae7539c54df409e074e1c4cb381f793f33c93"
}] as const;

export interface RentalMigrationArtifact {
  readonly id: string;
  readonly file: string;
  readonly sha256: string;
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface RentalDataRelease {
  readonly data: CoreDataContract;
  /** 包内原迁移目录名称，定位固定SQL；正式组合账名从deploymentMigrationNames读取。 */
  readonly migrationNames: readonly string[];
  readonly deploymentMigrationNames: readonly string[];
  readonly migrationSql: readonly string[];
}

export function readRentalPrismaSchema(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > 32 * 1024 * 1024
    || createHash("sha256").update(bytes).digest("hex") !== RENTAL_PRISMA_SCHEMA.sha256)
    throw new Error("Rental schema 原文与本版数据发行不一致");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** 所选数据版本及摘要来自固定发行，迁移顺序同时用于结构核验和原账读取。 */
export function createRentalDataRelease(input: {
  readonly version: CoreDataContract["version"];
  readonly readable: CoreDataContract["readable"];
  readonly migrations: readonly RentalMigrationArtifact[];
}): RentalDataRelease {
  const data = CoreDataContractSchema.parse({
    version: input.version,
    readable: input.readable,
    migrations: input.migrations.map(migration => ({
      id: migration.id,
      file: migration.file,
      sha256: migration.sha256
    }))
  });
  if (!data.migrations.length) throw new Error("Rental 数据发行缺少自有迁移");

  const names = new Set<string>();
  const migrationSql = input.migrations.map((migration, index) => {
    const declared = data.migrations[index];
    const path = /^(?:prisma\/)?migrations\/([^/]+)\/migration\.sql$/.exec(declared.file);
    if (!declared.id.startsWith("rental."))
      throw new Error(`Rental 迁移 ${declared.id} 须属于 rental 命名空间`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,254}$/.test(migration.name)
      || !path || path[1] !== migration.name || names.has(migration.name))
      throw new Error(`Rental 迁移 ${declared.file} 与原 Prisma 账名称未唯一对应`);
    names.add(migration.name);
    if (!(migration.bytes instanceof Uint8Array) || !migration.bytes.byteLength
      || migration.bytes.byteLength > 32 * 1024 * 1024)
      throw new Error(`Rental 迁移 ${declared.file} 原文须为 1 字节至 32 MiB`);

    // Prisma 校验原始字节，换行或编码的归一化也会改变已登记的迁移身份。
    if (createHash("sha256").update(migration.bytes).digest("hex") !== declared.sha256)
      throw new Error(`Rental 迁移 ${declared.file} 原文摘要变化`);
    const sql = new TextDecoder("utf-8", { fatal: true }).decode(migration.bytes);
    if (!sql.trim()) throw new Error(`Rental 迁移 ${declared.file} 原文为空`);
    return sql;
  });
  return { data, migrationNames: [...names],
    deploymentMigrationNames: data.migrations.map(migration => corePrismaMigrationName("rental", migration.id)),
    migrationSql };
}
