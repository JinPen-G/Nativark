import { z } from 'zod';
import { capabilityProfileFingerprint } from './capability-verification';
import { ModelAdapterError, ModelGatewayError, modelProtocolRequestSchema, type GatewayContext, type ModelAdapter, type ModelProtocolRequest } from './model-gateway.ports';
import type { AiProviderProfileRecord } from './provider-profile.ports';
import type { ProviderRouteDecision } from './provider-router.ports';
import type { GatewayUsageRecorder, UnifiedGatewayTransport } from './unified-ai-gateway.ports';
import { normalizeTenantModelBaseUrl, type TenantModelConfigService } from './tenant-model-config.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import type { TextCapabilityProbeAuthority } from './text-capability-probe.authority';

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
const connectionSchema = z.object({ profileFingerprint: z.string().regex(/^[0-9a-f]{64}$/u), baseUrl: z.string().min(1).max(2048),
  credential: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/u), maxOutputTokens: z.number().int().min(1).max(32768) }).strict();
const contextSchema = z.object({ tenantId: z.string().min(1).max(128), workspaceId: z.string().min(1).max(128), actorId: z.string().min(1).max(128) }).strict();

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
    private readonly probe?: TextCapabilityProbeAuthority) {
    if (typeof resolvers?.platform?.resolve !== 'function' || typeof resolvers?.tenant?.resolve !== 'function' || !Array.isArray(adapters) || !adapters.length) throw new ModelGatewayError('CONFIG_INVALID');
    for (const adapter of adapters) {
      if (!adapter || typeof adapter.provider !== 'string' || !adapter.provider || this.adapters.has(adapter.provider)
        || typeof adapter.generate !== 'function' || !Array.isArray(adapter.features)) throw new ModelGatewayError('CONFIG_INVALID');
      this.adapters.set(adapter.provider, adapter);
    }
  }
  private cancelled(signal: AbortSignal) { if (signal.aborted) throw new ModelGatewayError('CANCELLED'); }
  private async prepare(value: GatewayContext, requestValue: ModelProtocolRequest, routeValue: ProviderRouteDecision, signal: AbortSignal, streaming: boolean) {
    const parsedContext = contextSchema.safeParse(value), parsedRequest = modelProtocolRequestSchema.safeParse(requestValue);
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
      : profile.serviceMode !== 'tenant_managed' || route.scope.kind !== 'TENANT' || route.scope.tenantId !== context.tenantId) throw new ModelGatewayError('FORBIDDEN');
    const adapter = this.adapters.get(profile.protocol);
    if (!adapter) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
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
    return { request, adapter, connection, recheck };
  }
  private safeError(error: unknown): ModelGatewayError {
    if (error instanceof ModelGatewayError) return new ModelGatewayError(error.code);
    if (error instanceof ModelAdapterError) return new ModelGatewayError(error.code);
    return new ModelGatewayError('PROVIDER_FAILED');
  }
  private rejectSecret(value: unknown, credential: string) {
    if (JSON.stringify(value)?.includes(credential)) throw new ModelGatewayError('INVALID_RESPONSE');
  }
  async invoke(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, signal: AbortSignal, recordUsage?: GatewayUsageRecorder) {
    try {
      const prepared = await this.prepare(context, request, route, signal, false);
      // Adapter-owned objects must not change while accounting or authorization awaits.
      const result = structuredClone(await prepared.adapter.generate({ ...structuredClone(prepared.request), signal, recordUsage }, prepared.connection.credential, { baseUrl: prepared.connection.baseUrl }));
      if (result.usage) await recordUsage?.(structuredClone(result.usage));
      this.cancelled(signal); this.rejectSecret(result, prepared.connection.credential);
      await prepared.recheck();
      return { ...structuredClone(result) };
    } catch (error) { throw this.safeError(error); }
  }
  async *stream(context: GatewayContext, request: ModelProtocolRequest, route: ProviderRouteDecision, signal: AbortSignal, recordUsage?: GatewayUsageRecorder) {
    try {
      const prepared = await this.prepare(context, request, route, signal, true);
      let pending = '', terminal = false;
      for await (const value of prepared.adapter.stream!({ ...structuredClone(prepared.request), signal, recordUsage }, prepared.connection.credential, { baseUrl: prepared.connection.baseUrl })) {
        const event = structuredClone(value);
        if (event.kind === 'result' && !terminal && event.result.usage) await recordUsage?.(structuredClone(event.result.usage));
        this.cancelled(signal);
        if (terminal) throw new ModelGatewayError('INVALID_RESPONSE');
        this.rejectSecret(event, prepared.connection.credential);
        await prepared.recheck();
        if (event.kind === 'text_delta') {
          pending += event.delta;
          if (pending.includes(prepared.connection.credential)) throw new ModelGatewayError('INVALID_RESPONSE');
          // Hold a credential-length suffix so split secrets are detected before any of their prefix is published.
          const safeLength = Math.max(0, pending.length - prepared.connection.credential.length + 1);
          if (safeLength) { const delta = pending.slice(0, safeLength); pending = pending.slice(safeLength); yield { kind: 'text_delta' as const, delta }; }
        } else {
          terminal = true;
          if (pending) { yield { kind: 'text_delta' as const, delta: pending }; pending = ''; await prepared.recheck(); }
          yield { kind: 'result' as const, result: { ...structuredClone(event.result) } };
        }
      }
      if (!terminal) throw new ModelGatewayError('INVALID_RESPONSE');
      await prepared.recheck();
    } catch (error) { throw this.safeError(error); }
  }
}
