/** 双 Core 宿主静态选择工单正式包、原 SQL 数据计划与 HTTP 贡献。
 * 绑定复用 Rental 装配提供的公共依赖，同一候选只由原宿主调用一次。
 * 完整包校验只读取固定发行，服务和权限仍由工单原实现维护。 */
import { dirname, resolve } from "node:path";
import {
  CoreDeploymentLockSchema, coreDeploymentHostVersions, type CoreDeploymentLock
} from "@rental-os/core-contracts";
import { corePrismaMigrationName } from "@rental-os/core-contracts/deployment";
import { requireCorePackagePin } from "@rental-os/core-contracts/install";
import { createTicketsHttpContribution } from "@rental-os/example-tickets-core";
import { readTicketsPhysicalData } from "@rental-os/example-tickets-core/mysql";
import { composeTicketsPlatformHost } from "@rental-os/example-tickets-core/platform-host";
import type { TicketsHttpApplication } from "@rental-os/example-tickets-core/nest";
import type { RentalHostCoreSetup } from "@rental-os/rental-api/additional-cores";

export function createTicketsCoreSetup(lockValue: CoreDeploymentLock): RentalHostCoreSetup<TicketsHttpApplication> {
  const lock = CoreDeploymentLockSchema.parse(lockValue);
  const pin = lock.cores.find(core => core.manifest.id === "example-tickets");
  if (!pin) throw new Error("双 Core 示范须显式选择 example-tickets 固定包");
  const entry = require.resolve("@rental-os/example-tickets-core");
  const root = resolve(dirname(entry), "..");
  const selected = requireCorePackagePin(root, pin, coreDeploymentHostVersions(lock));
  return {
    coreId: selected.manifest.id,
    entry,
    dataPlan: {
      data: selected.manifest.data,
      migrationNames: selected.manifest.data.migrations.map(migration =>
        corePrismaMigrationName(selected.manifest.id, migration.id)),
      readPhysical: readTicketsPhysicalData
    },
    http: createTicketsHttpContribution(),
    bind(context) {
      const tickets = composeTicketsPlatformHost(context);
      return { server: tickets.server, binding: tickets };
    }
  };
}
