/** 明确启用 AI 的独立根模块；实际原工厂、请求与 Runtime 同源，
 * 同一数据库/Auth/Guard/Core 与原数据锁供给 AI，未挂载能力保持不可用。 */
import { Module, type DynamicModule } from "@nestjs/common";
import { RENTAL_STAFF_INSPECTION_EVIDENCE, type RentalStaffInspectionEvidence } from "@rental-os/rental-core/http-staff-uploads";
import type { CoreDeploymentLock } from "@rental-os/core-contracts";
import { createRentalHostModule, RENTAL_HOST_ASSEMBLY } from "./app.module";
import { composeRentalAiApplication, type RentalAiHostAssembly } from "./ai-assembly";
import { RentalAiCompositionModule, RENTAL_AI_INSPECTION_BINDING, type RentalAiInspectionBinding } from "./ai-composition";
import { createRentalAiHttpPolicy, rentalAiRouteSelector, RENTAL_AI_CONTROLLERS, RENTAL_AI_INSPECTION_OPERATIONS,
  RENTAL_AI_MOUNTED_REQUESTS } from "./ai-http-policy";
import { createRentalAiOpenApi } from "./ai-openapi";

@Module({})
class RentalAiHttpModule {}

@Module({})
export class RentalAiAppModule {
  static register(options: { lock: CoreDeploymentLock }): DynamicModule {
    return createRentalHostModule({ lock: options.lock,
      assemble: (database, configuration) => composeRentalAiApplication({ database, configuration, lock: options.lock }),
      createPolicy: createRentalAiHttpPolicy, openApi: createRentalAiOpenApi,
      ai: {
        requestScope: (host, policy) => {
          if (!host.ai || !host.aiAccess) throw new Error("AI 宿主缺少同实例请求或数据准入");
          return { access: host.aiAccess, ...rentalAiRouteSelector(policy),
            withRequest: (request, consume, signal) => host.ai!.withRequest(request, consume, signal) };
        },
        register: assembly => {
          const composition = RentalAiCompositionModule.registerFactory({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY],
            useFactory: (host: RentalAiHostAssembly) => {
              if (!host.ai) throw new Error("AI 实际装配缺少原参加者");
              return host.ai;
            }, inspectionOperations: RENTAL_AI_INSPECTION_OPERATIONS,
            httpPublication: { isMounted: token => typeof token === "symbol" && RENTAL_AI_MOUNTED_REQUESTS.includes(token) } });
          return { module: RentalAiHttpModule, imports: [composition], controllers: [...RENTAL_AI_CONTROLLERS],
            providers: [{ provide: RENTAL_STAFF_INSPECTION_EVIDENCE, inject: [RENTAL_AI_INSPECTION_BINDING],
              useFactory: (binding: RentalAiInspectionBinding): RentalStaffInspectionEvidence => ({
                bind: (value, request) => binding.bindInspectionEvidence(request, value)
              }) }], exports: [RENTAL_STAFF_INSPECTION_EVIDENCE] };
        }
      }
    });
  }
}
