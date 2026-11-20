/** 同一公共底座同时装配 Rental 与工单。原 Rental 工厂维护完整服务图，
 * 工单只提供已选择的固定包接点，当前示范从源码入口显式选择无 AI 组合。
 * 构造只核发行材料，实际迁移、物理就绪和业务授权沿原目录与服务判断。 */
import type { ConfigService } from "@nestjs/config";
import { CoreDeploymentLockSchema, type CoreDeploymentLock } from "@rental-os/core-contracts";
import type { TicketsHttpApplication } from "@rental-os/example-tickets-core/nest";
import { composeRentalApplication } from "@rental-os/rental-api/assembly";
import type { RentalHostCoreContext } from "@rental-os/rental-api/additional-cores";
import { createTicketsCoreSetup } from "./tickets-core";

export function requireMultiCoreSelection(lockValue: CoreDeploymentLock) {
  const lock = CoreDeploymentLockSchema.parse(lockValue);
  const rental = lock.cores.find(core => core.manifest.id === "rental");
  const tickets = lock.cores.find(core => core.manifest.id === "example-tickets");
  if (!rental || !tickets || lock.cores.length !== 2) {
    throw new Error("双 Core 示范须且仅须选择 Rental 与 example-tickets 固定包");
  }
  return { lock, tickets };
}

export type MultiCoreHostAssembly = ReturnType<typeof composeRentalApplication<never, TicketsHttpApplication>>;

export function composeMultiCoreApplication(input: {
  database: RentalHostCoreContext["database"];
  configuration: ConfigService;
  lock: CoreDeploymentLock;
}): MultiCoreHostAssembly {
  const { lock } = requireMultiCoreSelection(input.lock);
  return composeRentalApplication<never, TicketsHttpApplication>({
    database: input.database,
    configuration: input.configuration,
    lock,
    aiMode: "disabled",
    additionalCores: [createTicketsCoreSetup(lock)]
  });
}
