/** 明确启用 AI 的独立根模块；实际原工厂、请求与 Runtime 同源，
 * 同一数据库/Auth/Guard/Core 与原数据锁供给 AI，未挂载能力保持不可用。 */
import { Module, type DynamicModule } from "@nestjs/common";
import { RENTAL_STAFF_INSPECTION_EVIDENCE, type RentalStaffInspectionEvidence } from "@rental-os/rental-core/http-staff-uploads";
import type { CoreDeploymentLock, CoreOpenApiSource } from "@rental-os/core-contracts";
import { createRentalHostModule, RENTAL_HOST_ASSEMBLY } from "./app.module";
import { composeRentalAiApplication, type RentalAiHostAssembly } from "./ai-assembly";
import { RentalAiCompositionModule, RENTAL_AI_INSPECTION_BINDING, type RentalAiInspectionBinding } from "./ai-composition";
import { createRentalAiHttpPolicy, rentalAiRouteSelector, RENTAL_AI_CONTROLLERS, RENTAL_AI_INSPECTION_OPERATIONS,
  RENTAL_AI_MOUNTED_REQUESTS } from "./ai-http-policy";
import { createRentalAiOpenApi } from "./ai-openapi";
import { withRentalAiClientRequest } from "./ai-client-request";
import type { RentalHostCoreSetup } from "./additional-cores";

// AI 编译使用 dist-ai 中的一组令牌。扩展宿主从此出口同时取得启动与组装
// 令牌，避免普通 dist 的 bootstrap 查找另一个 Symbol 或实例化第二套服务图。
export { RENTAL_HOST_ASSEMBLY } from "./app.module";
export { bootstrapRentalComposition } from "./bootstrap";
export type { RentalAiHostAssembly } from "./ai-assembly";

export interface RentalAiModuleOptions<Additional = unknown> {
  lock: CoreDeploymentLock;
  additionalCores?: readonly RentalHostCoreSetup<Additional>[];
  additionalHttp?(assembly: DynamicModule): readonly DynamicModule[];
  additionalOpenApi?: readonly CoreOpenApiSource[];
}

@Module({})
class RentalAiHttpModule {}

/** 额外 Core 沿原固定包/同实例接点装配；仅 Rental 提供已审定 AI 工具。 */
export function createRentalAiHostModule<Additional = unknown>(options: RentalAiModuleOptions<Additional>): DynamicModule {
    return createRentalHostModule<RentalAiHostAssembly<Additional>>({ lock: options.lock,
      assemble: (database, configuration) => composeRentalAiApplication({ database, configuration, lock: options.lock,
        additionalCores: options.additionalCores }),
      createPolicy: createRentalAiHttpPolicy,
      openApi: (lock, policy) => createRentalAiOpenApi(lock, policy, options.additionalOpenApi),
      additionalHttp: options.additionalHttp,
      ai: {
        requestScope: (host, policy) => {
          if (!host.ai || !host.aiAccess) throw new Error("AI 宿主缺少同实例请求或数据准入");
          const selector = rentalAiRouteSelector(policy);
          return { access: host.aiAccess, ...selector,
            withRequest: (request, consume, signal) => selector.isClientRoute(request)
              ? withRentalAiClientRequest(request, consume, signal)
              : host.ai!.withRequest(request, consume, signal) };
        },
        register: assembly => {
          const composition = RentalAiCompositionModule.registerFactory({ imports: [assembly], inject: [RENTAL_HOST_ASSEMBLY],
            useFactory: (host: RentalAiHostAssembly<Additional>) => {
              if (!host.ai) throw new Error("AI 实际装配缺少原参加者");
              return host.ai;
            }, inspectionOperations: RENTAL_AI_INSPECTION_OPERATIONS,
            httpPublication: { isMounted: token => RENTAL_AI_MOUNTED_REQUESTS.includes(token) } });
          return { module: RentalAiHttpModule, imports: [composition], controllers: [...RENTAL_AI_CONTROLLERS],
            providers: [{ provide: RENTAL_STAFF_INSPECTION_EVIDENCE, inject: [RENTAL_AI_INSPECTION_BINDING],
              useFactory: (binding: RentalAiInspectionBinding): RentalStaffInspectionEvidence => ({
                bind: (value, request) => binding.bindInspectionEvidence(request, value)
              }) }], exports: [RENTAL_STAFF_INSPECTION_EVIDENCE] };
        }
      }
    });
}

@Module({})
export class RentalAiAppModule {
  static register(options: { lock: CoreDeploymentLock }): DynamicModule {
    return createRentalAiHostModule(options);
  }
}
