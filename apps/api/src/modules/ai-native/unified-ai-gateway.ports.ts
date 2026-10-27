import type { ModelProtocolRequest, ModelRequest, ModelUsage, GatewayContext } from './model-gateway.ports';
import type { ProviderRouteDecision } from './provider-router.ports';
import type { InvocationDispatchService } from './invocation-dispatch.service';
import type { InvocationAdmissionService } from './invocation-admission.service';
import type { UnifiedGatewayBudget } from './gateway-accounting.ports';
import type { GatewayMediaAttachmentResolver } from './gateway-intent';

export interface GatewayInvocationResult { text: string; usage?: ModelUsage; usageState?: 'reported' | 'reconciliation_required'; [key: string]: unknown; }
export type GatewayStreamEvent = { kind: 'text_delta'; delta: string } | { kind: 'result'; result: GatewayInvocationResult };
/** Bound by the Gateway to one admitted call. Never supplied by an HTTP caller
 * or carried in provider messages; only validated terminal counters enter it. */
export type GatewayUsageRecorder = (usage: ModelUsage) => Promise<void>;
export interface UnifiedGatewayTransport {
  inputBoundHash?(request: ModelProtocolRequest, route: ProviderRouteDecision, streaming: boolean): string | undefined;
  invoke(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, signal: AbortSignal, recordUsage?: GatewayUsageRecorder, expectedInputBoundHash?: string): Promise<GatewayInvocationResult>;
  stream(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, signal: AbortSignal, recordUsage?: GatewayUsageRecorder, expectedInputBoundHash?: string): AsyncIterable<GatewayStreamEvent>;
}
export interface GatewayInvocationObservation {
  call: import('./gateway-accounting.ports').GatewayAccountingCall;
  reservationId: string;
  route: ProviderRouteDecision;
  result: GatewayInvocationResult;
  /** Gateway monotonic clock, not provider-declared latency or client paint.
   * Includes transport/usage receipt and stream consumer backpressure. */
  timing?: { version: 'gateway-delivery-time-1'; transportWallMs: number; firstValidatedTextMs: number | null };
  /** Gateway-owned transport traversal, never a provider capability grant.
   * Optional only for preserved callers predating delivery observations. */
  delivery?: { mode: 'invoke' } | { mode: 'stream'; eventCount: number; deltaCount: number;
    deltaBytes: number; deltaHash: string };
}
export interface GatewayBudgetDenialObservation {
  call: import('./gateway-accounting.ports').GatewayAccountingCall;
  code: 'BUDGET_UNAVAILABLE';
}
export interface GatewayAuditPreparation {
  context: GatewayContext; callId: string; intentHash: string; requestHash: string;
  configurationHash: string; mode: 'invoke' | 'stream';
  /** Trusted routing snapshot; configurationHash hashes this profile, not the
   * invocation's public configuration reference. Never model/request input. */
  profile?: ProviderRouteDecision['profile'];
}
export interface UnifiedGatewayAudit {
  /** Acknowledged durable intent before admission/claim/reserve. Does not grant dispatch. */
  prepare?(value: GatewayAuditPreparation, signal?: AbortSignal): Promise<void>;
  append(entry: { callId: string; /** Null for explicit SaaS/platform calls (no tenant attribution). */ tenantId: string | null; workspaceId: string | null; event: string; status: string; detail?: string }): Promise<void>;
  budgetDenied?(value: GatewayBudgetDenialObservation, signal?: AbortSignal): Promise<void>; }
export interface UnifiedGatewayRoutingPort {
  resolve(context: Readonly<GatewayContext>, requested: readonly import('./provider-profile.ports').AiProfileCapability[]): Promise<import('./gateway-routing.service').GatewayRoutingResolution>;
  assertCurrent(context: Readonly<GatewayContext>, resolution: import('./gateway-routing.service').GatewayRoutingResolution): Promise<void>;
}
export interface UnifiedGatewayPorts { routing: UnifiedGatewayRoutingPort; admission: InvocationAdmissionService; dispatch: Pick<InvocationDispatchService, 'claim' | 'finish'>; budget: UnifiedGatewayBudget; transport: UnifiedGatewayTransport; audit: UnifiedGatewayAudit; media?: GatewayMediaAttachmentResolver; observation?: { record(value: GatewayInvocationObservation): Promise<void>; budgetDenied?(value: GatewayBudgetDenialObservation, signal?: AbortSignal): Promise<void> }; }
