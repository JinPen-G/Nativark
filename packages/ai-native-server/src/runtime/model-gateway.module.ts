import { Module, type DynamicModule } from "@nestjs/common";
import { ModelGatewayService } from "./model-gateway.service";
import type { GatewayPorts, ModelAdapter } from "./model-gateway.ports";

/** Explicit server wiring only. AppModule/routes are intentionally not changed by this slice. */
@Module({})
export class ModelGatewayModule {
  static register(ports: GatewayPorts, adapters: readonly ModelAdapter[]): DynamicModule {
    return { module: ModelGatewayModule,
      providers: [{ provide: ModelGatewayService, useFactory: () => new ModelGatewayService(ports, adapters) }],
      exports: [ModelGatewayService] };
  }
}
