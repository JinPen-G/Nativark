import { z } from 'zod';
import { ModelResponseSecretGuard } from './model-response-secret';
import { capabilityProfileFingerprint } from './capability-verification';
import { ModelAdapterError, ModelGatewayError, modelProtocolRequestSchema, type GatewayContext, type ModelAdapter, type ModelProtocolRequest } from './model-gateway.ports';
import type { AiProviderProfileRecord } from './provider-profile.ports';
import type { ProviderRouteDecision } from './provider-router.ports';
import type { GatewayStreamEvent, GatewayUsageRecorder, GatewayTransportDispatchCheck, UnifiedGatewayTransport } from './unified-ai-gateway.ports';
import { normalizeTenantModelBaseUrl, type TenantModelConfigService } from './tenant-model-config.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { resolvedNativeToolResultSchema, type ResolvedNativeToolResult } from './model-input/native-tool-result.ports';
import { gatewayTransportTermination, type GatewayTransportIterator } from './gateway-capacity.ports';
import { retainGatewayCapacityIterator } from './gateway-capacity.service';

export interface GatewayConnection {
  profileFingerprint: string;
  baseUrl: string;
  credential: string;
  maxOutputTokens: number;
}
export interface GatewayConnectionResolver {
  /** Reauthorize current caller and load current encrypted config/vault binding. Never accept model-provided URLs or secrets. */
  resolve(context: GatewayContext, profile: AiProviderProfileRecord): Promise<GatewayConnection>;
  /** Current authorization/config revision only; must not decrypt a key or authorize dispatch. */
  assertCurrent?(context: GatewayContext, profile: AiProviderProfileRecord): Promise<void>;
}
export interface GatewayProbeDispatchAuthority {
  authorizeDispatch(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision,
    mode?: 'invoke' | 'stream', signal?: AbortSignal): Promise<void>;
}
const connectionSchema = z.object({ profileFingerprint: z.string().regex(/^[0-9a-f]{64}$/u), baseUrl: z.string().min(1).max(2048),
  credential: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/u), maxOutputTokens: z.number().int().min(1).max(32768) }).strict();
const contextSchema = z.object({ tenantId: z.string().min(1).max(128), workspaceId: z.string().min(1).max(128), actorId: z.string().min(1).max(128) }).strict();
const routedContextSchema = z.union([contextSchema, z.object({ actorId: z.string().min(1).max(128) }).strict()]);

/** Existing encrypted BYOK config adapter. Platform secrets require a distinct server resolver. */
export class TenantModelConnectionResolver implements GatewayConnectionResolver {
  constructor(private readonly config: Pick<TenantModelConfigService, 'selectionForInvocation' | 'profile' | 'credential'>) {
    if ([config?.selectionForInvocation, config?.profile, config?.credential].some(value => typeof value !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  }
  async assertCurrent(value: GatewayContext, selected: AiProviderProfileRecord) {
    const context = contextSchema.parse(value), profile = structuredClone(selected);
    if (profile.serviceMode !== 'tenant_managed' || profile.scopeKind !== 'TENANT') throw new ModelGatewayError('CONFIG_INVALID');
    const selection = await this.config.selectionForInvocation(context);
    if (selection.mode !== 'tenant_managed' || selection.revision !== profile.configRevision) throw new ModelGatewayError('CONFIG_INVALID');
  }
  async resolve(value: GatewayContext, selected: AiProviderProfileRecord): Promise<GatewayConnection> {
    const context = contextSchema.parse(value), profile = structuredClone(selected);
    if (profile.serviceMode !== 'tenant_managed' || profile.scopeKind !== 'TENANT') throw new ModelGatewayError('CONFIG_INVALID');
    const initial = await this.config.selectionForInvocation(structuredClone(context));
    if (initial.mode !== 'tenant_managed' || initial.revision !== profile.configRevision) throw new ModelGatewayError('CONFIG_INVALID');
    const current = await this.config.profile(structuredClone(context));
    if (!current.enabled || current.provider !== profile.protocol || !current.allowedModels.includes(profile.model)
      || current.credentialRef !== profile.credentialRef || !current.baseUrl) throw new ModelGatewayError('CONFIG_INVALID');
    const credential = await this.config.credential(profile.credentialRef, structuredClone(context));
    const after = await this.config.selectionForInvocation(structuredClone(context));
    if (after.mode !== initial.mode || after.revision !== initial.revision) throw new ModelGatewayError('CONFIG_INVALID');
    return { profileFingerprint: capabilityProfileFingerprint(profile), baseUrl: normalizeTenantModelBaseUrl(current.baseUrl), credential, maxOutputTokens: current.maxOutputTokens };
  }
}

/** Protocol registry behind the authorized route. No supplier fallback, SDK-selected model, or secret in output. */
export class RoutedModelTransport implements UnifiedGatewayTransport {
  private readonly adapters = new Map<string, ModelAdapter>();
  constructor(private readonly resolvers: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver }, adapters: readonly ModelAdapter[],
    private readonly probe?: GatewayProbeDispatchAuthority) {
    if (typeof resolvers?.platform?.resolve !== 'function' || typeof resolvers?.tenant?.resolve !== 'function' || !Array.isArray(adapters) || !adapters.length) throw new ModelGatewayError('CONFIG_INVALID');
    for (const adapter of adapters) {
      if (!adapter || typeof adapter.provider !== 'string' || !adapter.provider || this.adapters.has(adapter.provider)
        || typeof adapter.generate !== 'function' || !Array.isArray(adapter.features)) throw new ModelGatewayError('CONFIG_INVALID');
      this.adapters.set(adapter.provider, adapter);
    }
  }
  inputBoundHash(request: ModelProtocolRequest, route: ProviderRouteDecision, streaming: boolean) {
    const adapter = this.adapters.get(route.profile.protocol);
    if (!adapter?.inputBoundHash) return undefined;
    try { return adapter.inputBoundHash(structuredClone(request), streaming); }
    catch (error) {
      if (error instanceof ModelGatewayError && error.code === 'CAPABILITY_UNSUPPORTED') return undefined;
      throw error;
    }
  }
  private cancelled(signal: AbortSignal) { if (signal.aborted) throw new ModelGatewayError('CANCELLED'); }
  nativeInputBoundHash(request: ModelProtocolRequest, route: ProviderRouteDecision, value: ResolvedNativeToolResult) {
    const adapter = this.adapters.get(route.profile.protocol);
    if (adapter?.supportsNativeToolResults !== true || typeof adapter.generateNativeToolResult !== 'function'
      || typeof adapter.nativeInputBoundHash !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    return adapter.nativeInputBoundHash(structuredClone(request), structuredClone(value));
  }
  private async prepare(value: GatewayContext, requestValue: ModelProtocolRequest, routeValue: ProviderRouteDecision, signal: AbortSignal, streaming: boolean, native = false) {
    const parsedContext = routedContextSchema.safeParse(value), parsedRequest = modelProtocolRequestSchema.safeParse(requestValue);
    if (!parsedContext.success || !parsedRequest.success) throw new ModelGatewayError('INVALID_REQUEST');
    const context = parsedContext.data, request = parsedRequest.data, route = structuredClone(routeValue), profile = route.profile;
    this.cancelled(signal);
    if (!profile?.enabled || profile.disabledAt || !route.scope || request.model !== profile.model
      || profile.scopeId !== route.scope.id || profile.scopeKind !== route.scope.kind) throw new ModelGatewayError('CONFIG_INVALID');
    if (route.probe) {
      if (!this.probe) throw new ModelGatewayError('FORBIDDEN');
      await this.probe.authorizeDispatch(context, request, route, streaming ? 'stream' : 'invoke', signal);
    } else if (!route.preflight?.allowed) throw new ModelGatewayError('CONFIG_INVALID');
    if (profile.serviceMode === 'platform_managed' ? route.scope.kind !== 'PLATFORM'
      : profile.serviceMode !== 'tenant_managed' || !('tenantId' in context)
        || route.scope.kind !== 'TENANT' || route.scope.tenantId !== context.tenantId) throw new ModelGatewayError('FORBIDDEN');
    const adapter = this.adapters.get(profile.protocol);
    if (!adapter) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    if (native && (adapter.supportsNativeToolResults !== true || typeof adapter.generateNativeToolResult !== 'function'
      || typeof adapter.nativeInputBoundHash !== 'function')) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const assertSchema = () => {
      if (request.structuredSchemaHash && (!request.features?.includes('structuredOutput')
        || request.structuredSchemaHash !== adapter.structuredSchemaHash)) throw new ModelGatewayError('CONFIG_INVALID');
    };
    assertSchema();
    if ((streaming && (typeof adapter.stream !== 'function' || !adapter.features.includes('streaming')))
      || request.features?.some(feature => !adapter.features.includes(feature))) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const resolver = profile.serviceMode === 'platform_managed' ? this.resolvers.platform : this.resolvers.tenant;
    const resolve = async () => {
      this.cancelled(signal);
      const parsed = connectionSchema.safeParse(await resolver.resolve(structuredClone(context), structuredClone(profile)));
      this.cancelled(signal);
      if (!parsed.success || parsed.data.profileFingerprint !== capabilityProfileFingerprint(profile)) throw new ModelGatewayError('CONFIG_INVALID');
      if (request.maxOutputTokens > parsed.data.maxOutputTokens) throw new ModelGatewayError('INVALID_REQUEST');
      return { ...parsed.data, baseUrl: normalizeTenantModelBaseUrl(parsed.data.baseUrl) };
    };
    const connection = await resolve(), binding = requestFingerprint(connection);
    const recheck = async () => {
      assertSchema();
      if (resolver.assertCurrent) {
        this.cancelled(signal);
        await resolver.assertCurrent(structuredClone(context), structuredClone(profile));
        this.cancelled(signal);
      } else if (requestFingerprint(await resolve()) !== binding) throw new ModelGatewayError('CONFIG_INVALID');
      if (route.probe) await this.probe!.authorizeDispatch(context, request, route, streaming ? 'stream' : 'invoke', signal);
    };
    await recheck();
    return { request, adapter, connection, recheck, secrets: new ModelResponseSecretGuard(connection.credential) };
  }
  private safeError(error: unknown): ModelGatewayError {
    if (error instanceof ModelGatewayError) return new ModelGatewayError(error.code);
    if (error instanceof ModelAdapterError) return new ModelGatewayError(error.code);
    return new ModelGatewayError('PROVIDER_FAILED');
  }
  private rejectSecret(value: unknown, secrets: ModelResponseSecretGuard) {
    if (secrets.contains(value)) throw new ModelGatewayError('INVALID_RESPONSE');
  }
  async invoke(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, signal: AbortSignal, recordUsage?: GatewayUsageRecorder, expectedInputBoundHash?: string, beforeDispatch?: GatewayTransportDispatchCheck) {
    try {
      const prepared = await this.prepare(context, request, route, signal, false);
      // Preparing the connection includes awaited Vault/authorization reads.
      // Recheck the held server capacity at the actual adapter boundary.
      this.cancelled(signal); beforeDispatch?.();
      // Adapter-owned objects must not change while accounting or authorization awaits.
      const result = structuredClone(await prepared.adapter.generate({ ...structuredClone(prepared.request), signal, recordUsage, expectedInputBoundHash }, prepared.connection.credential, { baseUrl: prepared.connection.baseUrl }));
      if (result.usage) await recordUsage?.(structuredClone(result.usage));
      this.cancelled(signal); this.rejectSecret(result, prepared.secrets);
      await prepared.recheck();
      return { ...structuredClone(result) };
    } catch (error) { throw this.safeError(error); }
  }
  /** One admitted native request, using the same vault/current-config/usage and
   * delivery checks as ordinary invoke. The caller Gateway owns the second call. */
  async invokeNativeToolResult(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision,
    signal: AbortSignal, value: ResolvedNativeToolResult, recordUsage?: GatewayUsageRecorder, expectedInputBoundHash?: string, beforeDispatch?: GatewayTransportDispatchCheck) {
    try {
      const parsed = resolvedNativeToolResultSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
      const native = parsed.data;
      const prepared = await this.prepare(context, request, route, signal, false, true);
      this.cancelled(signal); this.rejectSecret(native, prepared.secrets);
      beforeDispatch?.();
      const result = structuredClone(await prepared.adapter.generateNativeToolResult!({ ...structuredClone(prepared.request),
        signal, recordUsage, expectedInputBoundHash }, prepared.connection.credential, native, { baseUrl: prepared.connection.baseUrl }));
      if (result.usage) await recordUsage?.(structuredClone(result.usage));
      this.cancelled(signal); this.rejectSecret(result, prepared.secrets);
      await prepared.recheck();
      return { ...structuredClone(result) };
    } catch (error) { throw this.safeError(error); }
  }
  stream(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, signal: AbortSignal, recordUsage?: GatewayUsageRecorder, expectedInputBoundHash?: string, beforeDispatch?: GatewayTransportDispatchCheck) {
    let started = false, acknowledgeTermination!: () => void;
    const termination = new Promise<void>(resolve => { acknowledgeTermination = resolve; });
    const work = this.streamSource(context, request, route, signal, recordUsage, expectedInputBoundHash, acknowledgeTermination, beforeDispatch);
    const iterator: AsyncIterableIterator<GatewayStreamEvent> & GatewayTransportIterator<GatewayStreamEvent> = {
      [gatewayTransportTermination]: termination,
      next: value => { started = true; return work.next(value); },
      return: value => { if (!started) acknowledgeTermination(); return work.return(value); },
      throw: error => { if (!started) acknowledgeTermination(); return work.throw(error); },
      [Symbol.asyncIterator]() { return this; }
    };
    return iterator;
  }
  private async *streamSource(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision,
    signal: AbortSignal, recordUsage: GatewayUsageRecorder | undefined, expectedInputBoundHash: string | undefined,
    acknowledgeTermination: () => void, beforeDispatch?: GatewayTransportDispatchCheck) {
    let sourceCreated = false;
    try {
      const prepared = await this.prepare(context, request, route, signal, true);
      let pending = '', terminal = false;
      this.cancelled(signal); beforeDispatch?.();
      const source = retainGatewayCapacityIterator(prepared.adapter.stream!({ ...structuredClone(prepared.request), signal, recordUsage, expectedInputBoundHash },
        prepared.connection.credential, { baseUrl: prepared.connection.baseUrl })[Symbol.asyncIterator](), { release: acknowledgeTermination });
      sourceCreated = true;
      let sourceDone = false;
      try {
        for (;;) {
          const next = await source.next();
          if (next.done) { sourceDone = true; break; }
          const event = structuredClone(next.value);
          if (event.kind === 'result' && !terminal && event.result.usage) await recordUsage?.(structuredClone(event.result.usage));
          this.cancelled(signal);
          if (terminal) throw new ModelGatewayError('INVALID_RESPONSE');
          this.rejectSecret(event, prepared.secrets);
          await prepared.recheck();
          if (event.kind === 'text_delta') {
            pending += event.delta;
            // Raw and encoded credentials have different lengths. Hold only a
            // possible prefix, but never publish it before the next fragment proves safe.
            const safeLength = prepared.secrets.releaseLength(pending);
            if (safeLength === null) throw new ModelGatewayError('INVALID_RESPONSE');
            if (safeLength) { const delta = pending.slice(0, safeLength); pending = pending.slice(safeLength); yield { kind: 'text_delta' as const, delta }; }
          } else {
            terminal = true;
            if (pending) { yield { kind: 'text_delta' as const, delta: pending }; pending = ''; await prepared.recheck(); }
            yield { kind: 'result' as const, result: { ...structuredClone(event.result) } };
          }
        }
      } finally {
        // The Gateway tracks this iterator's real lifetime. Keep its next/return
        // pending until the adapter has finished cleanup, including a rejected
        // next. Incomplete/failed cleanup never resolves the source signal even
        // if this outer generator has already finished.
        if (!sourceDone && source.return) await source.return();
      }
      if (!terminal) throw new ModelGatewayError('INVALID_RESPONSE');
      await prepared.recheck();
    } catch (error) { throw this.safeError(error); }
    finally { if (!sourceCreated) acknowledgeTermination(); }
  }
}
