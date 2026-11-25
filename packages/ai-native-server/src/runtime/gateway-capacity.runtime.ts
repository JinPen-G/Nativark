/** One server-owned network gate for all standard model/count/probe hosts.
 * It clamps process capacity, never supplies authorization, financial limits
 * or an SLO claim. Reconfiguration cannot replace an occupied instance. */
import { Logger, type FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readRuntimePublication } from './runtime-publication.configuration';
import { ModelGatewayError } from './model-gateway.ports';
import { GatewayCapacityService, gatewayCapacityLimitsSchema } from './gateway-capacity.service';
import type { GatewayCapacityLease, GatewayCapacityLimits, GatewayCapacityPort,
  GatewayCapacityRequest, GatewayCapacityStatistics } from './gateway-capacity.ports';

export const AI_NATIVE_GATEWAY_CAPACITY = Symbol('AI_NATIVE_GATEWAY_CAPACITY');
/** Conservative operational ceilings; deployment may select explicit bounds.
 * These numbers are not measured throughput or an approved cost/SLO target. */
export const DEFAULT_GATEWAY_CAPACITY_LIMITS: Readonly<GatewayCapacityLimits> = Object.freeze({
  maxConcurrent: 4, maxQueued: 32, maxQueuedPerTenant: 4, maxWaitMs: 15000,
});
type Alert = { event: 'ai.gateway.capacity.pressure'; reason: 'saturated' | 'rate_limited' | 'timeout' | 'configuration_changed';
  statistics: GatewayCapacityStatistics };
function configuredLimits(source: Pick<ConfigService, 'get'>): GatewayCapacityLimits {
  const value = readRuntimePublication(source).configurations.gatewayCapacity;
  const selected = gatewayCapacityLimitsSchema.safeParse(value ?? DEFAULT_GATEWAY_CAPACITY_LIMITS);
  if (!selected.success) throw new ModelGatewayError('CONFIG_INVALID');
  return selected.data;
}
const sameLimits = (a: GatewayCapacityLimits, b: GatewayCapacityLimits) =>
  a.maxConcurrent === b.maxConcurrent && a.maxQueued === b.maxQueued
  && a.maxQueuedPerTenant === b.maxQueuedPerTenant && a.maxWaitMs === b.maxWaitMs;

/** Aggregate, rate-bounded server warnings consume the gate's real counters.
 * They contain no tenant/actor ID, request, secret or business-success claim.
 * No polling worker or new public diagnostics endpoint is created. */
export class RuntimeGatewayCapacity implements GatewayCapacityPort {
  private readonly limits: GatewayCapacityLimits | null;
  private readonly gate: GatewayCapacityService;
  private readonly warned = new Map<Alert['reason'], number>();
  constructor(private readonly source: Pick<ConfigService, 'get'>,
    private readonly warn: (alert: Alert) => void = alert => new Logger('AiGatewayCapacity').warn(alert)) {
    let selected: GatewayCapacityLimits | null = null;
    try { selected = configuredLimits(source); }
    catch { /* Bad AI capacity configuration must not prevent Core or original
      * readers from booting. New network work remains closed below. */ }
    this.limits = selected;
    this.gate = new GatewayCapacityService(selected ?? DEFAULT_GATEWAY_CAPACITY_LIMITS);
  }
  private alert(reason: Alert['reason']) {
    const now = Date.now(), previous = this.warned.get(reason);
    if (previous !== undefined && now - previous < 30000) return;
    this.warned.set(reason, now);
    try { this.warn({ event: 'ai.gateway.capacity.pressure', reason, statistics: this.gate.readStatistics() }); }
    catch { /* Observability failure cannot release a slot or grant execution. */ }
  }
  private current() {
    try {
      if (this.limits && sameLimits(this.limits, configuredLimits(this.source))) return;
    } catch { /* Invalid replacement configuration also closes new work. */ }
    this.alert('configuration_changed');
    throw new ModelGatewayError('CONFIG_INVALID');
  }
  async acquire(request: GatewayCapacityRequest, signal: AbortSignal): Promise<GatewayCapacityLease> {
    this.current();
    let lease: GatewayCapacityLease | undefined;
    try {
      const waiting = this.gate.acquire(request, signal);
      const statistics = this.gate.readStatistics();
      if (statistics.queued && statistics.active >= statistics.limits.maxConcurrent) this.alert('saturated');
      lease = await waiting;
      this.current();
      return Object.freeze({ release: lease.release.bind(lease), assertCurrent: () => this.current() });
    } catch (error) {
      lease?.release();
      if (error instanceof ModelGatewayError) {
        if (error.code === 'RATE_LIMITED') this.alert('rate_limited');
        if (error.code === 'TIMEOUT') this.alert('timeout');
      }
      throw error;
    }
  }
  /** Internal process snapshot only; callers still need their own read policy
   * before projecting it into any separately approved management surface. */
  readStatistics(): GatewayCapacityStatistics { return this.gate.readStatistics(); }
}

export const AI_NATIVE_GATEWAY_CAPACITY_PROVIDER: FactoryProvider<RuntimeGatewayCapacity> = {
  provide: AI_NATIVE_GATEWAY_CAPACITY,
  inject: [ConfigService],
  useFactory: (source: ConfigService) => new RuntimeGatewayCapacity(source),
};
