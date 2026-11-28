/** MCP选装工单包的数据观察。只读同一原迁移账与普通/选装物理结构，不执行SQL或补造就绪。 */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CoreManifest } from "@rental-os/core-contracts";
import { corePrismaMigrationName } from "@rental-os/core-contracts/deployment";
import type { CoreMysqlDataPlan } from "@rental-os/core-host/mysql-deployment";
import { mysqlStructureFromMigrations } from "@rental-os/platform-core-host/mysql-structure";
import { readMysqlPhysicalData } from "@rental-os/platform-core-host/mysql-physical";
import { createTicketsManifest, TICKETS_MCP_MIGRATION, TICKETS_MCP_DATA_VERSION } from "@rental-os/example-tickets-core";
import { readTicketsPhysicalData } from "@rental-os/example-tickets-core/mysql";

export function createTicketsMcpDataPlan(input: { manifest: CoreManifest; sql: Uint8Array }): CoreMysqlDataPlan {
  if (!isDeepStrictEqual(input.manifest, createTicketsManifest(input.manifest.source, { mcp: true }))
    || createHash("sha256").update(input.sql).digest("hex") !== TICKETS_MCP_MIGRATION.sha256)
    throw new Error("工单MCP数据计划必须来自同一完整选装包");
  const expected = mysqlStructureFromMigrations([new TextDecoder("utf-8", { fatal: true }).decode(input.sql)]);
  if (expected.length !== 5) throw new Error("工单MCP固定结构不完整");
  return { data: structuredClone(input.manifest.data), migrationNames: input.manifest.data.migrations.map(m => corePrismaMigrationName(input.manifest.id, m.id)),
    async readPhysical(database) {
      const ordinary = await readTicketsPhysicalData(database);
      if (!ordinary) return undefined;
      const optional = await readMysqlPhysicalData(database, expected, TICKETS_MCP_DATA_VERSION);
      if (!optional) return undefined;
      return { version: TICKETS_MCP_DATA_VERSION, observedAt: optional.observedAt,
        sha256: createHash("sha256").update(JSON.stringify({ ordinary: ordinary.sha256, mcp: optional.sha256 })).digest("hex") };
    } };
}
