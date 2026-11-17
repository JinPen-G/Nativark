/** 公共宿主数据发行基线。迁移摘要与实际物理观察分开，只有读取原账/结构后可判准入。 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CoreDataContractSchema } from "@rental-os/core-contracts";
import { mysqlStructureFromMigrations, readMysqlPhysicalData } from "@rental-os/platform-core-host";
import type { CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";

export const PUBLIC_PLATFORM_DATA_VERSION = "0.1.3";
const migrations = [
  { id: "platform.foundation", name: "20261115000000_public_foundation", sha256: "b220ba5046f16900f7d475351ec466ae56c8b9c02cc5de703c8ded83784a710a" },
  { id: "platform.core-access", name: "20261115010000_core_access", sha256: "ef03bb4bae3ff0337213cb1f87aa2ebeb8338faec016be05de645dfea54c2411" },
  { id: "platform.core-bindings", name: "20261115020000_core_bindings", sha256: "5666ecd0d42099cf0865e8d8116709d3f7a07c77d360972cbe5866f15fa1a8bb" },
  { id: "platform.subscription-term", name: "20261115030000_public_subscription_term", sha256: "ff2ca9614628d7b5282c22293bb81b8c6e70ce0d3d69be2da301fc0a89e7449b" },
  { id: "platform.subscription-operations", name: "20261117000000_public_subscription_operations", sha256: "60ebbcaf2d572514a5ce4209a074a8c9d31454a4fbcb4b07380915dde4d8fa66" },
  { id: "platform.integrations", name: "20261117010000_public_integrations", sha256: "890c05aa5badc36a9be3aa7c6f12792e2c01acdcde65e4e7b53dd384fcb1346c" },
  { id: "platform.official-calendars", name: "20261118000000_public_official_calendars", sha256: "5a9cbd12aeb905da46d332a028460e6f4bc30d96a7b7381c45c497d472d8e568" }
] as const;

export function createPublicPlatformDataPlan(): CoreMysqlDataPlan {
  const texts = migrations.map(migration => {
    const file = resolve(__dirname, "../prisma/migrations", migration.name, "migration.sql");
    const content = readFileSync(file);
    if (createHash("sha256").update(content).digest("hex") !== migration.sha256)
      throw new Error(`公共迁移原文摘要变化：${migration.name}`);
    return content.toString("utf8");
  });
  const expected = mysqlStructureFromMigrations(texts);
  const data = CoreDataContractSchema.parse({ version: PUBLIC_PLATFORM_DATA_VERSION,
    readable: { minInclusive: "0.1.0", maxExclusive: "0.2.0" }, migrations: migrations.map(migration => ({ id: migration.id,
      file: `prisma/migrations/${migration.name}/migration.sql`, sha256: migration.sha256 })) });
  return { data, migrationNames: migrations.map(migration => migration.name),
    readPhysical: database => readMysqlPhysicalData(database, expected, data.version) };
}
