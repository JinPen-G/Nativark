import { z } from "zod";
import {
  ModelAdapterError, ModelGatewayError, type ModelAdapter, type GatewayContext,
  type GatewayPorts, type ModelRequest, type ModelUsage
} from "./model-gateway.ports";

const identifier = z.string().min(1).max(128).regex(/^[\w.:-]+$/u);
const modelIdentifier = z.string().min(1).max(256).regex(/^[\w./:-]+$/u);
const contextSchema = z.object({ tenantId: identifier, workspaceId: identifier, actorId: identifier }).strict();
const requestSchema = z.object({
  callId: identifier, model: modelIdentifier,
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(32_000) }).strict()).min(1).max(64),
  maxOutputTokens: z.number().int().positive().max(32_768),
  features: z.array(z.enum(["tools", "structuredOutput", "streaming"])).max(3).optional()
}).strict();
const profileSchema = z.object({
  enabled: z.boolean(), provider: identifier, baseUrl: z.string().max(2048).optional(), allowedModels: z.array(modelIdentifier).min(1).max(100),
  credentialRef: identifier, timeoutMs: z.number().int().min(1).max(120_000),
  maxConcurrent: z.number().int().min(1).max(100), maxOutputTokens: z.number().int().positive().max(32_768)
}).strict();
const usageSchema = z.object({ inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
const safeErrors = new Set(["INVALID_REQUEST", "FORBIDDEN", "DISABLED", "MODEL_NOT_ALLOWED", "CAPABILITY_UNSUPPORTED",
  "PROVIDER_UNAVAILABLE", "CONFIG_INVALID", "RATE_LIMITED", "CREDENTIAL_UNAVAILABLE", "BUDGET_UNAVAILABLE",
  "AUTHENTICATION_FAILED", "TIMEOUT", "CANCELLED", "PROVIDER_FAILED", "INVALID_RESPONSE", "ACCOUNTING_PENDING"]);

/** Server-only gateway. No provider, route, vault, budget store or AI worker is auto-enabled. */
export class ModelGatewayService {
  private readonly adapters = new Map<string, ModelAdapter>();
  private readonly active = new Map<string, number>();
  constructor(private readonly ports: GatewayPorts, adapters: readonly ModelAdapter[], private readonly deadlineMs = 120_000) {
    if (!ports || [ports.authorize, ports.profile, ports.credential, ports.budget?.reserve,
      ports.budget?.settle, ports.budget?.release, ports.budget?.reconcile].some(value => typeof value !== "function")
      || !Array.isArray(adapters) || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120_000) throw new ModelGatewayError("CONFIG_INVALID");
    for (const adapter of adapters) {
      if (!identifier.safeParse(adapter.provider).success || this.adapters.has(adapter.provider)) throw new ModelGatewayError("CONFIG_INVALID");
      this.adapters.set(adapter.provider, adapter);
    }
  }

  async generate(context: GatewayContext, request: ModelRequest, cancellation?: AbortSignal) {
    const parsedContext = contextSchema.safeParse(context), parsedRequest = requestSchema.safeParse(request);
    if (!parsedContext.success || !parsedRequest.success) throw new ModelGatewayError("INVALID_REQUEST");
    const scope = parsedContext.data, input = parsedRequest.data;
    if (cancellation?.aborted) throw new ModelGatewayError("CANCELLED");
    const controller = new AbortController(), started = performance.now();
    let expires = started + this.deadlineMs, timer: ReturnType<typeof setTimeout> | undefined;
    let reason: "TIMEOUT" | "CANCELLED" | undefined, rejectStop!: (error: ModelGatewayError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    // The stop promise may fire between awaits; observe it immediately.
    void stopped.catch(() => {});
    const stop = (code: "TIMEOUT" | "CANCELLED") => {
      if (reason) return; reason = code; rejectStop(new ModelGatewayError(code)); controller.abort();
    };
    const cancel = () => stop("CANCELLED");
    const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => stop("TIMEOUT"), Math.max(0, expires - performance.now())); };
    const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
      if (!reason && performance.now() >= expires) stop("TIMEOUT");
      if (reason) throw new ModelGatewayError(reason);
      const value = await Promise.race([Promise.resolve().then(operation), stopped]);
      if (!reason && performance.now() >= expires) stop("TIMEOUT");
      if (reason) throw new ModelGatewayError(reason);
      return value;
    };
    const mapped = (error: unknown, code: "FORBIDDEN" | "CONFIG_INVALID" | "CREDENTIAL_UNAVAILABLE" | "BUDGET_UNAVAILABLE") => {
      if (reason) return new ModelGatewayError(reason);
      return new ModelGatewayError(code);
    };
    // Cleanup starts even after expiry; it cannot hold the request indefinitely.
    // With no remaining budget it receives one event-loop turn, not a new call deadline.
    const cleanup = async (operation: () => Promise<void>) => {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => reject(new ModelGatewayError("ACCOUNTING_PENDING")), Math.max(0, expires - performance.now()));
        })]);
      } finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
    };
    cancellation?.addEventListener("abort", cancel, { once: true }); arm();
    try {
      return await this.execute(scope, input, controller, wait, cleanup, mapped, timeoutMs => { expires = Math.min(expires, started + timeoutMs); arm(); });
    } finally {
      if (timer) clearTimeout(timer); cancellation?.removeEventListener("abort", cancel);
      if (!controller.signal.aborted) controller.abort();
    }
  }

  private async execute(scope: GatewayContext, input: ModelRequest, controller: AbortController,
    wait: <T>(operation: () => Promise<T>) => Promise<T>, cleanup: (operation: () => Promise<void>) => Promise<void>,
    mapped: (error: unknown, code: "FORBIDDEN" | "CONFIG_INVALID" | "CREDENTIAL_UNAVAILABLE" | "BUDGET_UNAVAILABLE") => ModelGatewayError,
    tighten: (timeoutMs: number) => void) {
    try { await wait(() => this.ports.authorize(scope, controller.signal)); } catch (error) { throw mapped(error, "FORBIDDEN"); }
    let profile;
    try {
      const parsed = profileSchema.safeParse(await wait(() => this.ports.profile(scope, controller.signal)));
      if (!parsed.success) throw new Error();
      profile = parsed.data;
    } catch (error) { throw mapped(error, "CONFIG_INVALID"); }
    tighten(profile.timeoutMs);
    if (!profile.enabled) throw new ModelGatewayError("DISABLED");
    if (!profile.allowedModels.includes(input.model) || input.maxOutputTokens > profile.maxOutputTokens) throw new ModelGatewayError("MODEL_NOT_ALLOWED");
    const adapter = this.adapters.get(profile.provider);
    if (!adapter) throw new ModelGatewayError("PROVIDER_UNAVAILABLE");
    if ((input.features ?? []).some(feature => !adapter.features.includes(feature))) throw new ModelGatewayError("CAPABILITY_UNSUPPORTED");
    // Tenant-local protocol limit; one tenant must not consume another tenant's slot.
    // Distributed/global limits remain an AIN-11 deployment concern.
    const key = JSON.stringify([scope.tenantId, profile.provider]);
    if ((this.active.get(key) ?? 0) >= profile.maxConcurrent) throw new ModelGatewayError("RATE_LIMITED");
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
    let slotReleased = false;
    const releaseSlot = () => {
      if (slotReleased) return;
      slotReleased = true;
      const remaining = (this.active.get(key) ?? 1) - 1;
      if (remaining) this.active.set(key, remaining); else this.active.delete(key);
    };
    let reservation: string | undefined, dispatched = false, accounted = false, closed = false;
    try {
      let credential: string;
      try {
        credential = await wait(() => this.ports.credential(profile.credentialRef, scope, controller.signal));
        if (!credential?.trim()) throw new Error();
      } catch (error) { throw mapped(error, "CREDENTIAL_UNAVAILABLE"); }
      try {
        reservation = await wait(() => this.ports.budget.reserve(scope, { callId: input.callId, model: input.model, maxOutputTokens: input.maxOutputTokens }, controller.signal).then(async id => {
          // An uncooperative store may allocate after the caller has stopped waiting.
          // No adapter was dispatched: compensate only this late reservation.
          if (closed && identifier.safeParse(id).success) {
            try { await cleanup(() => this.ports.budget.release(id)); }
            catch { try { await cleanup(() => this.ports.budget.reconcile(id, "LATE_RESERVATION_RELEASE_PENDING")); } catch { /* durable reconciliation is the repository's responsibility */ } }
          } else reservation = id;
          return id;
        }));
        if (!identifier.safeParse(reservation).success) throw new Error();
      } catch (error) { throw mapped(error, "BUDGET_UNAVAILABLE"); }
      // Freshness after budget wait, not an atomic authorization/config lease.
      try { await wait(() => this.ports.authorize(scope, controller.signal)); } catch (error) { throw mapped(error, "FORBIDDEN"); }
      let currentProfile;
      try {
        const current = profileSchema.safeParse(await wait(() => this.ports.profile(scope, controller.signal)));
        if (!current.success) throw new Error();
        currentProfile = current.data;
      } catch (error) { throw mapped(error, "CONFIG_INVALID"); }
      if (!currentProfile.enabled) throw new ModelGatewayError("DISABLED");
      if (JSON.stringify(currentProfile) !== JSON.stringify(profile)) throw new ModelGatewayError("CONFIG_INVALID");
      try {
        const currentKey = await wait(() => this.ports.credential(profile.credentialRef, scope, controller.signal));
        if (!currentKey?.trim() || currentKey !== credential) throw new Error();
      } catch (error) { throw mapped(error, "CREDENTIAL_UNAVAILABLE"); }
      if ((input.features ?? []).some(feature => !adapter.features.includes(feature))) throw new ModelGatewayError("CAPABILITY_UNSUPPORTED");
      dispatched = true;
      const operation = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new ModelGatewayError("CANCELLED");
        return adapter.generate({ ...input, signal: controller.signal }, credential,
          profile.baseUrl === undefined ? undefined : { baseUrl: profile.baseUrl });
      }).finally(releaseSlot);
      const result = await wait(() => operation);
      if (!result || typeof result.text !== "string" || result.text.length > 128_000 || result.text.includes(credential)) throw new ModelGatewayError("INVALID_RESPONSE");
      const usage = result.usage === undefined ? undefined : usageSchema.safeParse(result.usage);
      if (usage && !usage.success) throw new ModelGatewayError("INVALID_RESPONSE");
      if (!usage) {
        try { await wait(() => this.ports.budget.reconcile(reservation!, "USAGE_UNAVAILABLE")); }
        catch { throw new ModelGatewayError("ACCOUNTING_PENDING"); }
        accounted = true;
        return { callId: input.callId, provider: profile.provider, model: input.model, text: result.text,
          usage: null, usageState: "reconciliation_required" as const };
      }
      try { await wait(() => this.ports.budget.settle(reservation!, usage.data as ModelUsage)); }
      catch { throw new ModelGatewayError("ACCOUNTING_PENDING"); }
      accounted = true;
      return { callId: input.callId, provider: profile.provider, model: input.model, text: result.text,
        usage: usage.data, usageState: "reported" as const };
    } catch (error) {
      let failure = error instanceof ModelGatewayError && safeErrors.has(error.code) ? new ModelGatewayError(error.code)
        : error instanceof ModelAdapterError && ["AUTHENTICATION_FAILED", "RATE_LIMITED", "PROVIDER_FAILED"].includes(error.code) ? new ModelGatewayError(error.code)
        : new ModelGatewayError("PROVIDER_FAILED");
      if (reservation && !accounted) {
        try {
          // Once dispatched, outcome/usage may be unknown; never free the reservation for a retry.
          if (dispatched) await cleanup(() => this.ports.budget.reconcile(reservation!, failure.code));
          else await cleanup(() => this.ports.budget.release(reservation!));
        } catch { failure = new ModelGatewayError("ACCOUNTING_PENDING"); }
      }
      throw failure;
    } finally {
      closed = true;
      if (!controller.signal.aborted) controller.abort();
      // An adapter ignoring cancellation may still be using its connection: keep its slot
      // until the underlying operation settles, not merely until Promise.race times out.
      if (!dispatched) releaseSlot();
    }
  }
}
