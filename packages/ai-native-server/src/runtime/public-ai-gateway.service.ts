/** Rental C03 facade，原严格工具校验与公共单一 Gateway 装配在此衔接。 */
import { Module, type DynamicModule } from '@nestjs/common';
import type { AiOrderExplainRequestDraft } from '@rental-os/shared';
import { PublicAiGatewayService as PlatformPublicAiGatewayService, ModelGatewayError, type PublicGatewayRuntime as PlatformPublicGatewayRuntime,
  type UnifiedGatewayPorts, type GatewayConnectionResolver, type ModelAdapter, type GatewayTextIntentBinding } from '@rental-os/platform-server/ai-gateway';
import { RoutedModelTransport } from './routed-model-transport';
import { rentalGatewayToolResultPolicy } from './gateway-tool-policy';
export type PublicGatewayRuntime = PlatformPublicGatewayRuntime<AiOrderExplainRequestDraft>;
export class PublicAiGatewayService extends PlatformPublicAiGatewayService<AiOrderExplainRequestDraft> {
  constructor(runtime: PublicGatewayRuntime, scenes: readonly GatewayTextIntentBinding[], timeoutMs = 120000) {
    if (!runtime?.ports) throw new ModelGatewayError('CONFIG_INVALID');
    super(runtime, scenes, timeoutMs, rentalGatewayToolResultPolicy);
  }
}
@Module({})
export class PublicAiGatewayModule {
  static registerProtocols(runtime: Omit<PublicGatewayRuntime, 'ports'> & { ports: Omit<UnifiedGatewayPorts<AiOrderExplainRequestDraft>, 'transport'> },
    connections: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver }, adapters: readonly ModelAdapter[],
    scenes: readonly GatewayTextIntentBinding[]): DynamicModule {
    return this.register({ ...runtime, ports: { ...runtime.ports, transport: new RoutedModelTransport(connections, adapters) } }, scenes);
  }
  static register(runtime: PublicGatewayRuntime, scenes: readonly GatewayTextIntentBinding[]): DynamicModule {
    const service = new PublicAiGatewayService(runtime, scenes);
    return { module: PublicAiGatewayModule, providers: [{ provide: PublicAiGatewayService, useValue: service }], exports: [PublicAiGatewayService] };
  }
}
