import type { ModelProtocolRequest, ModelRequest, ModelUsage } from './model-gateway.ports';
import type { GatewayContext } from './model-gateway.ports';
import type { ProviderRouteDecision } from './provider-router.ports';
import type { AiGatewayRoutingService } from './gateway-routing.service';
import type { InvocationDispatchService } from './invocation-dispatch.service';
import type { InvocationAdmissionService } from './invocation-admission.service';
import type { UnifiedGatewayBudget } from './gateway-accounting.ports';
import type { GatewayMediaAttachmentResolver } from './gateway-intent';

export interface GatewayInvocationResult { text: string; usage?: ModelUsage; usageState?: 'reported' | 'reconciliation_required'; [key: string]: unknown; }
export type GatewayStreamEvent = { kind: 'text_delta'; delta: string } | { kind: 'result'; result: GatewayInvocationResult };
export interface UnifiedGatewayTransport {
  invoke(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, signal: AbortSignal): Promise<GatewayInvocationResult>;
  stream(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, signal: AbortSignal): AsyncIterable<GatewayStreamEvent>;
}
export interface UnifiedGatewayAudit { append(entry: { callId: string; tenantId: string; workspaceId: string; event: string; status: string; detail?: string }): Promise<void>; }
export interface UnifiedGatewayPorts { routing: Pick<AiGatewayRoutingService, 'resolve' | 'assertCurrent'>; admission: InvocationAdmissionService; dispatch: Pick<InvocationDispatchService, 'claim' | 'finish'>; budget: UnifiedGatewayBudget; transport: UnifiedGatewayTransport; audit: UnifiedGatewayAudit; media?: GatewayMediaAttachmentResolver; }
