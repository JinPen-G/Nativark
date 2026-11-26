/** Rental 运输参加者，BYOK配置与原Task事务见证在此接入公共运输。 */
import { RoutedModelTransport as PlatformRoutedModelTransport,
  type GatewayContext, type GatewayConnection, type GatewayConnectionResolver, type GatewayProbeDispatchAuthority,
  type ModelAdapter, type ModelProtocolRequest } from '@rental-os/platform-server/ai-gateway';
import { hasAiTaskTransactionAuthority } from './task-transaction-authority';
export { TenantModelConnectionResolver } from '../configuration/tenant-model-connection';
export type { GatewayConnection, GatewayConnectionResolver, GatewayProbeDispatchAuthority } from '@rental-os/platform-server/ai-gateway';
export class RoutedModelTransport extends PlatformRoutedModelTransport {
  constructor(connections: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver }, adapters: readonly ModelAdapter[],
    probe?: GatewayProbeDispatchAuthority, beforeProvider?: (context: GatewayContext, request: ModelProtocolRequest, signal: AbortSignal) => Promise<void>) {
    super(connections, adapters, probe, beforeProvider, hasAiTaskTransactionAuthority);
  }
}
