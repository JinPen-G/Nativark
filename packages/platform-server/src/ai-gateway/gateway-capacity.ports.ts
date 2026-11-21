/** Process-local network capacity, not task, financial or execution authority.
 * Server factories share one instance. Original admission/dispatch and current
 * authorization still gate each call; no HTTP/model data can select a tenant. */
import type { GatewayContext } from './model-gateway.ports';
import type { AiProviderProfileRecord } from './provider-profile.ports';

export interface GatewayCapacityLimits {
  maxConcurrent: number;
  maxQueued: number;
  maxQueuedPerTenant: number;
  maxWaitMs: number;
}
export interface GatewayCapacityRequest {
  context: GatewayContext;
  profile: Pick<AiProviderProfileRecord, 'id' | 'scopeId' | 'scopeKind' | 'serviceMode'
    | 'protocol' | 'provider' | 'configRevision'>;
  callId: string;
  expiresAt: Date;
}
/** This private handle never leaves the server. Release is idempotent; callers
 * release unsent work directly, and sent work only after transport termination. */
export interface GatewayCapacityLease {
  release(): void;
  /** Server runtime may close new transport if its capacity publication changed
   * while authorization/accounting awaited. This never revokes old receipts. */
  assertCurrent?(): void;
}
/** A wrapping generator can finish while its source cleanup is incomplete.
 * This private signal acknowledges the underlying iterator's termination;
 * it never appears in a request, result, receipt or public contract. */
export const gatewayTransportTermination = Symbol('gatewayTransportTermination');
export type GatewayTransportIterator<T> = AsyncIterator<T> & {
  [gatewayTransportTermination]?: Promise<void>;
};
export interface GatewayCapacityPort {
  acquire(request: GatewayCapacityRequest, signal: AbortSignal): Promise<GatewayCapacityLease>;
}
export interface GatewayCapacityClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timer: unknown): void;
}
export interface GatewayCapacityStatistics {
  version: 'gateway-capacity-1';
  limits: Readonly<GatewayCapacityLimits>;
  active: number;
  queued: number;
  queuedTenants: number;
  oldestWaitMs: number | null;
  totals: { granted: number; queueFull: number; tenantQueueFull: number;
    cancelled: number; timedOut: number; duplicate: number };
  coverage: 'one_process_since_start';
  semantics: 'capacity_not_authorization_outcome_accounting_or_slo';
}

/** Project only trusted routing metadata; never copy a credential reference,
 * model request body or endpoint into capacity bookkeeping. */
export function gatewayCapacityRequest(context: GatewayContext, profile: AiProviderProfileRecord,
  callId: string, expiresAt: Date): GatewayCapacityRequest {
  return { context: structuredClone(context), profile: { id: profile.id, scopeId: profile.scopeId,
    scopeKind: profile.scopeKind, serviceMode: profile.serviceMode, protocol: profile.protocol,
    provider: profile.provider, configRevision: profile.configRevision }, callId, expiresAt: new Date(expiresAt) };
}
