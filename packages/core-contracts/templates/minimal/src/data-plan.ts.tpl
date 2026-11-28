/** 从清单固定的原SQL推导结构；沿公共物理检查器观察，不执行迁移或复制迁移账。 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mysqlStructureFromMigrations } from "@rental-os/platform-core-host/mysql-structure";
import { readMysqlPhysicalData } from "@rental-os/platform-core-host/mysql-physical";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { DATA_VERSION } from "./contracts";
import { MIGRATIONS } from "./manifest";

export function readPhysicalData(database: Pick<CoreHostSqlTransaction, "$queryRaw">) {
  const migrations = MIGRATIONS.map(migration => {
    const bytes = readFileSync(resolve(__dirname, "..", migration.file));
    if (createHash("sha256").update(bytes).digest("hex") !== migration.sha256) throw new Error("Core迁移与当前清单不同");
    return bytes.toString("utf8");
  });
  return readMysqlPhysicalData(database, mysqlStructureFromMigrations(migrations), DATA_VERSION);
}
