/** Bounded process capacity with equal tenant turns. Waiting uses the original
 * deadline and never reserves money or dispatches work. Aggregate diagnostics
 * contain no tenant IDs, body, URL, secret or business-success assertion. */
import { z } from 'zod';
import { ModelGatewayError } from './model-gateway.ports';
import { gatewayTransportTermination, type GatewayTransportIterator } from './gateway-capacity.ports';
import type { GatewayCapacityClock, GatewayCapacityLease, GatewayCapacityLimits,
  GatewayCapacityPort, GatewayCapacityRequest, GatewayCapacityStatistics } from './gateway-capacity.ports';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const workspace = z.object({ tenantId: id, workspaceId: id, actorId: id }).strict();
const requestSchema = z.object({ context: z.union([workspace, z.object({ actorId: id }).strict()]),
  profile: z.object({ id: id, scopeId: id, scopeKind: z.enum(['PLATFORM', 'TENANT', 'WORKSPACE']),
    serviceMode: z.enum(['platform_managed', 'tenant_managed']),
    protocol: z.string().min(1).max(64), provider: z.string().min(1).max(128),
    configRevision: z.number().int().min(1).max(4294967295) }).strict(),
  callId: id.max(128), expiresAt: z.date() }).strict();
export const gatewayCapacityLimitsSchema = z.object({ maxConcurrent: z.number().int().min(1).max(10000),
  maxQueued: z.number().int().min(0).max(10000), maxQueuedPerTenant: z.number().int().min(0).max(10000),
  maxWaitMs: z.number().int().min(1).max(120000) }).strict()
  .refine(value => value.maxQueuedPerTenant <= value.maxQueued
    && (value.maxQueued === 0 || value.maxQueuedPerTenant > 0));
const defaultClock: GatewayCapacityClock = { now: Date.now,
  setTimer: (callback, delay) => setTimeout(callback, delay),
  clearTimer: timer => clearTimeout(timer as ReturnType<typeof setTimeout>) };
type Entry = { key: string; tenant: string; enqueuedAt: number; expiresAt: number;
  signal: AbortSignal; abort: () => void; timer?: unknown;
  resolve(lease: GatewayCapacityLease): void; reject(error: ModelGatewayError): void };

export class GatewayCapacityService implements GatewayCapacityPort {
  private readonly limits: Readonly<GatewayCapacityLimits>;
  private readonly active = new Set<string>();
  private readonly waiting = new Map<string, Entry>();
  private readonly tenants = new Map<string, Entry[]>();
  private readonly rotation: string[] = [];
  private lastTenant: string | undefined;
  private readonly totals = { granted: 0, queueFull: 0, tenantQueueFull: 0,
    cancelled: 0, timedOut: 0, duplicate: 0 };
  constructor(limits: GatewayCapacityLimits, private readonly clock: GatewayCapacityClock = defaultClock) {
    const parsed = gatewayCapacityLimitsSchema.safeParse(limits);
    if (!parsed.success || [clock?.now, clock?.setTimer, clock?.clearTimer].some(value => typeof value !== 'function')) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
    this.limits = Object.freeze({ ...parsed.data });
  }
  private now() {
    const now = this.clock.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new ModelGatewayError('CONFIG_INVALID');
    return now;
  }
  private count(key: keyof GatewayCapacityService['totals']) {
    this.totals[key] = Math.min(Number.MAX_SAFE_INTEGER, this.totals[key] + 1);
  }
  private grant(key: string, tenant: string): GatewayCapacityLease {
    this.active.add(key); this.lastTenant = tenant; this.count('granted');
    let released = false;
    return Object.freeze({ release: () => {
      if (released) return;
      released = true; this.active.delete(key);
      // Releasing a network slot is independent of original financial unknowns.
      // A failed local clock withholds queued grants instead of masking cleanup.
      try { this.pump(); } catch {
        for (const entry of [...this.waiting.values()]) {
          this.remove(entry); entry.reject(new ModelGatewayError('CONFIG_INVALID'));
        }
      }
    } });
  }
  private remove(entry: Entry) {
    if (this.waiting.get(entry.key) !== entry) return;
    this.waiting.delete(entry.key);
    if (entry.timer !== undefined) this.clock.clearTimer(entry.timer);
    entry.signal.removeEventListener('abort', entry.abort);
    const lane = this.tenants.get(entry.tenant)!;
    lane.splice(lane.indexOf(entry), 1);
    if (!lane.length) {
      this.tenants.delete(entry.tenant);
      this.rotation.splice(this.rotation.indexOf(entry.tenant), 1);
    }
  }
  private stop(entry: Entry, reason: 'CANCELLED' | 'TIMEOUT') {
    if (this.waiting.get(entry.key) !== entry) return;
    this.remove(entry); this.count(reason === 'CANCELLED' ? 'cancelled' : 'timedOut');
    entry.reject(new ModelGatewayError(reason));
  }
  private pump() {
    while (this.active.size < this.limits.maxConcurrent && this.rotation.length) {
      // When the active tenant queued first, another waiting tenant gets the
      // next turn. New lanes otherwise join at the tail and cannot starve an
      // older lane by repeatedly cutting ahead of the last served tenant.
      if (this.rotation.length > 1 && this.rotation[0] === this.lastTenant) {
        this.rotation.push(this.rotation.shift()!);
      }
      const tenant = this.rotation[0], entry = this.tenants.get(tenant)![0];
      if (entry.signal.aborted || this.now() >= entry.expiresAt) {
        this.stop(entry, entry.signal.aborted ? 'CANCELLED' : 'TIMEOUT'); continue;
      }
      this.remove(entry);
      // Give every nonempty tenant one turn before returning to it.
      const index = this.rotation.indexOf(tenant);
      if (index >= 0) { this.rotation.splice(index, 1); this.rotation.push(tenant); }
      entry.resolve(this.grant(entry.key, tenant));
    }
  }
  async acquire(value: GatewayCapacityRequest, signal: AbortSignal): Promise<GatewayCapacityLease> {
    const parsed = requestSchema.safeParse(value);
    if (!parsed.success || !signal || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function'
      || typeof signal.removeEventListener !== 'function') throw new ModelGatewayError('INVALID_REQUEST');
    const request = structuredClone(parsed.data), { context, profile } = request;
    const tenant = 'tenantId' in context ? JSON.stringify(['tenant', context.tenantId])
      : JSON.stringify(['platform', profile.scopeId]);
    if (profile.serviceMode === 'platform_managed' ? profile.scopeKind !== 'PLATFORM'
      : profile.scopeKind !== 'TENANT' || !('tenantId' in context)) throw new ModelGatewayError('FORBIDDEN');
    const key = JSON.stringify([tenant, request.callId]);
    if (signal.aborted) { this.count('cancelled'); throw new ModelGatewayError('CANCELLED'); }
    const now = this.now(), expiresAt = Math.min(request.expiresAt.getTime(), now + this.limits.maxWaitMs);
    if (expiresAt <= now) { this.count('timedOut'); throw new ModelGatewayError('TIMEOUT'); }
    if (this.active.has(key) || this.waiting.has(key)) {
      this.count('duplicate'); throw new ModelGatewayError('ACCOUNTING_PENDING');
    }
    this.pump();
    if (this.active.size < this.limits.maxConcurrent && !this.rotation.length) return this.grant(key, tenant);
    if (this.waiting.size >= this.limits.maxQueued) {
      this.count('queueFull'); throw new ModelGatewayError('RATE_LIMITED');
    }
    const lane = this.tenants.get(tenant);
    if ((lane?.length ?? 0) >= this.limits.maxQueuedPerTenant) {
      this.count('tenantQueueFull'); throw new ModelGatewayError('RATE_LIMITED');
    }
    return new Promise<GatewayCapacityLease>((resolve, reject) => {
      const entry: Entry = { key, tenant, enqueuedAt: now, expiresAt, signal, resolve, reject,
        abort: () => this.stop(entry, 'CANCELLED') };
      this.waiting.set(key, entry);
      if (lane) lane.push(entry);
      else {
        this.tenants.set(tenant, [entry]);
        this.rotation.push(tenant);
      }
      try {
        signal.addEventListener('abort', entry.abort, { once: true });
        entry.timer = this.clock.setTimer(() => this.stop(entry, 'TIMEOUT'), expiresAt - now);
        if (signal.aborted) this.stop(entry, 'CANCELLED');
        // An injected timer may complete synchronously. Never retain a timer
        // after its entry was already cancelled or timed out.
        if (this.waiting.get(key) !== entry && entry.timer !== undefined) this.clock.clearTimer(entry.timer);
      } catch {
        this.remove(entry); reject(new ModelGatewayError('CONFIG_INVALID'));
      }
    });
  }
  readStatistics(): GatewayCapacityStatistics {
    const now = this.now(), oldest = [...this.waiting.values()].reduce<number | null>((value, entry) =>
      value === null ? entry.enqueuedAt : Math.min(value, entry.enqueuedAt), null);
    return { version: 'gateway-capacity-1', limits: { ...this.limits }, active: this.active.size,
      queued: this.waiting.size, queuedTenants: this.tenants.size, oldestWaitMs: oldest === null ? null : Math.max(0, now - oldest),
      totals: { ...this.totals }, coverage: 'one_process_since_start',
      semantics: 'capacity_not_authorization_outcome_accounting_or_slo' };
  }
}

/** Retain capacity through the actual transport promise, including rejection.
 * Racing the caller's deadline against this promise cannot free its slot. */
export function retainGatewayCapacityPromise<T>(lease: GatewayCapacityLease | undefined,
  operation: () => PromiseLike<T>): Promise<T> {
  try { return Promise.resolve(operation()).finally(() => lease?.release()); }
  catch (error) { lease?.release(); throw error; }
}

/** Track the source iterator itself. A pending next or return still owns its
 * slot even after the caller times out; an unfinished cleanup yields no release. */
export function retainGatewayCapacityIterator<T>(iterator: AsyncIterator<T>, lease: GatewayCapacityLease | undefined): AsyncIterator<T> {
  let pending = 0, ended = false, didRelease = false, closing: Promise<IteratorResult<T>> | undefined;
  const termination = (iterator as GatewayTransportIterator<T>)[gatewayTransportTermination];
  let sourceEnded = termination === undefined;
  const released = () => {
    if (!didRelease && ended && sourceEnded && pending === 0) { didRelease = true; lease?.release(); }
  };
  if (termination) {
    void termination.then(() => { sourceEnded = true; released(); })
      .catch(() => { /* Failed cleanup is not an acknowledgement of termination. */ });
  }
  const track = (work: () => PromiseLike<IteratorResult<T>>) => {
    pending++;
    return Promise.resolve().then(work).then(value => {
      if (value.done === true) ended = true;
      return value;
    }).finally(() => { pending--; released(); });
  };
  return { next: value => closing ? Promise.reject(new ModelGatewayError('CANCELLED'))
    : track(() => iterator.next(value)),
  ...(iterator.return ? { return: value => closing ??= track(() => iterator.return!(value)) } : {}) };
}
