/** 工单 HTTP 通过原 Rental 装配令牌取得同一个已绑定业务实例。
 * 公共 Auth、Guard、目录、数据库和 Rental HTTP 均由原根模块供给。
 * 模块声明不监听、不连接数据库，实际业务仍复核当前 Core 与对象权限。 */
import { TicketsHttpModule } from "@rental-os/example-tickets-core/nest";
import { createTicketsOpenApi } from "@rental-os/example-tickets-core";
import type { CoreDeploymentLock } from "@rental-os/core-contracts";
import { createRentalHostModule, RENTAL_HOST_ASSEMBLY } from "@rental-os/rental-api/app-module";
import { createRentalHostHttpPolicy } from "@rental-os/rental-api/http-policy";
import { createRentalHostOpenApi } from "@rental-os/rental-api/openapi";
import { composeMultiCoreApplication, requireMultiCoreSelection, type MultiCoreHostAssembly } from "./assembly";

export function multiCoreApplicationModule(lockValue: CoreDeploymentLock) {
  const { lock, tickets } = requireMultiCoreSelection(lockValue);
  return createRentalHostModule({
    lock,
    assemble: (database, configuration) => composeMultiCoreApplication({ database, configuration, lock }),
    createPolicy: createRentalHostHttpPolicy,
    openApi: (currentLock, policy) => createRentalHostOpenApi(currentLock, policy, [
      { manifest: tickets.manifest, contribution: createTicketsOpenApi() }
    ]),
    additionalHttp: assembly => [TicketsHttpModule.registerFactory({
      imports: [assembly],
      inject: [RENTAL_HOST_ASSEMBLY],
      useFactory: (host: MultiCoreHostAssembly) => {
        const binding = host.additionalCores.get("example-tickets");
        if (!binding) throw new Error("工单 HTTP 缺少同一双 Core 装配的原绑定");
        return binding;
      }
    })]
  });
}
