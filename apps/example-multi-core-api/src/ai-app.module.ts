/** AI 双 Core 根沿 Rental AI 正式出口装配，共享原数据库、Auth、Guard 与 Runtime。
 * 工单 HTTP 注入同一原绑定，AI 工具范围按各 Core 的正式发布来源核定。 */
import type { CoreDeploymentLock } from "@rental-os/core-contracts";
import { createTicketsOpenApi } from "@rental-os/example-tickets-core";
import { TicketsHttpModule, type TicketsHttpApplication } from "@rental-os/example-tickets-core/nest";
import {
  createRentalAiHostModule,
  RENTAL_HOST_ASSEMBLY,
  type RentalAiHostAssembly
} from "@rental-os/rental-api/ai-app-module";
import { requireMultiCoreSelection } from "./assembly";
import { createTicketsCoreSetup } from "./tickets-core";

export function multiCoreAiApplicationModule(lockValue: CoreDeploymentLock) {
  const { lock, tickets } = requireMultiCoreSelection(lockValue);
  return createRentalAiHostModule<TicketsHttpApplication>({
    lock,
    additionalCores: [createTicketsCoreSetup(lock)],
    additionalHttp: assembly => [TicketsHttpModule.registerFactory({
      imports: [assembly],
      inject: [RENTAL_HOST_ASSEMBLY],
      useFactory: (host: RentalAiHostAssembly<TicketsHttpApplication>) => {
        const binding = host.additionalCores.get("example-tickets");
        if (!binding) throw new Error("工单 HTTP 缺少同一 AI 双 Core 装配的原绑定");
        return binding;
      }
    })],
    additionalOpenApi: [
      { manifest: tickets.manifest, contribution: createTicketsOpenApi() }
    ]
  });
}
