/** 公共 C03 Gateway facade，经同一当前权限、路由、财务账和业务 validator 发布结果。 */
import { Module, type DynamicModule } from '@nestjs/common';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft, AiGatewayFailureCodeDraft, AiGatewayIntentDraft,
  AiGatewayPortDraft, AiGatewayResultDraft, AiGatewayStreamEventDraft, AiGatewayUsageDraft } from '@rental-os/platform-contracts/ai-gateway';
import { z } from 'zod';
import { GatewayDeadline } from './gateway-deadline';
import { isGatewayConfig, isGatewayIntent, isAiExecutionContext, createGatewayContractValidators,
  type GatewayContractValidators } from './gateway-contract-validation';
import { gatewayTextIntentBindingSchema, type GatewayTextIntentBinding } from './gateway-intent';
import { type GatewayRoutingResolution } from './gateway-routing.service';
import { ModelGatewayError, tenantGatewayContextSchema, type GatewayContext, type ModelAdapter } from './model-gateway.ports';
import { RoutedModelTransport, type GatewayConnectionResolver } from './routed-model-transport';
import { UnifiedAiGatewayService } from './unified-ai-gateway.service';
import type { GatewayInvocationResult, UnifiedGatewayPorts } from './unified-ai-gateway.ports';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';

import type { NativeToolResultResolver } from './model-input/native-tool-result.ports';
import type { GatewayToolResultPolicy } from './gateway-tool-policy.ports';

const VERSION = 'ain-c03-draft-2' as const;
const referenceSchema = z.object({ configId: z.string().min(1).max(191), configRevision: z.number().int().positive().max(4294967295),
  credentialRef: z.string().min(1).max(191), protocol: z.string().min(1).max(191), provider: z.string().min(1).max(191), model: z.string().min(1).max(256) }).strict();
export interface PublicGatewayRuntime<TToolRequest = never> {
  ports: UnifiedGatewayPorts<TToolRequest>;
  /** Registered server transport mode, never supplied by an Agent or inferred from a fingerprint. */
  evidence: 'mock' | 'live';
  /** Trusted adapter/evidence verifier. Must recheck provenance, binding, freshness and the registered transport mode. */
  verifyEvidence(resolution: GatewayRoutingResolution, mode: 'mock' | 'live'): Promise<boolean>;
}
function checkedResult<TToolRequest>(value: unknown, validators: GatewayContractValidators<TToolRequest>): AiGatewayResultDraft<TToolRequest> {
  if (!validators.isGatewayResult(value)) throw new ModelGatewayError('INVALID_RESPONSE');
  return value;
}
function checkedEvent<TToolRequest>(value: unknown, validators: GatewayContractValidators<TToolRequest>): AiGatewayStreamEventDraft<TToolRequest> {
  if (!validators.isGatewayEvent(value)) throw new ModelGatewayError('INVALID_RESPONSE');
  return value;
}
function identity(value: AiExecutionContext) {
  const { requestId: _, authorizedAt: __, ...rest } = value;
  return requestFingerprint(rest);
}

/** C03 public port for server-authorized principals. Customer and
 * automation owners keep their distinct namespace in the original task/ledger;
 * routing must revalidate the same current principal before every effect.
 * No production root registers this module automatically, and no default evidence verifier is supplied.
 */
export class PublicAiGatewayService<TToolRequest = never> implements AiGatewayPortDraft<TToolRequest> {
  private readonly scenes = new Map<string, GatewayTextIntentBinding>();
  private readonly runtime: PublicGatewayRuntime<TToolRequest>;
  private readonly validators: GatewayContractValidators<TToolRequest>;
  constructor(runtime: PublicGatewayRuntime<TToolRequest>, scenes: readonly GatewayTextIntentBinding[], private readonly timeoutMs = 120000,
    toolPolicy: GatewayToolResultPolicy<TToolRequest> | undefined = runtime?.ports?.toolPolicy,
    private readonly tenantScope = false) {
    if (!runtime?.ports || !['mock', 'live'].includes(runtime.evidence) || typeof runtime.verifyEvidence !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Array.isArray(scenes) || !scenes.length || scenes.length > 100) throw new ModelGatewayError('CONFIG_INVALID');
    const ports = runtime.ports;
    this.validators = createGatewayContractValidators(toolPolicy);
    if ([ports.routing?.resolve, ports.routing?.assertCurrent, ports.admission?.admit, ports.dispatch?.claim, ports.dispatch?.finish,
      ports.budget?.reserve, ports.budget?.dispatch, ports.budget?.settle, ports.budget?.abandon, ports.audit?.append, ports.transport?.invoke, ports.transport?.stream]
      .some(method => typeof method !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
    this.runtime = { ports: { ...runtime.ports, toolPolicy }, evidence: runtime.evidence, verifyEvidence: runtime.verifyEvidence.bind(runtime) };
    for (const item of scenes) {
      const parsed = gatewayTextIntentBindingSchema.safeParse(item);
      if (!parsed.success || this.scenes.has(parsed.data.sceneCode)
        || parsed.data.nativeToolResults && (parsed.data.routeScene !== 'chat' || parsed.data.orderExplainTool !== true
          || parsed.data.structuredOutput || parsed.data.reasoningChannel || parsed.data.embeddingProbe)) throw new ModelGatewayError('CONFIG_INVALID');
      this.scenes.set(parsed.data.sceneCode, Object.freeze(parsed.data));
    }
  }

  private call(value: AiExecutionContext, intent: AiGatewayIntentDraft, signal?: AbortSignal) {
    if (!isGatewayIntent(intent)) throw new ModelGatewayError('INVALID_REQUEST');
    if (!isAiExecutionContext(value)) throw new ModelGatewayError('FORBIDDEN');
    const scope = value.scope;
    const platformCall = scope.kind === 'platform' && value.audience === 'operator' && value.actor.kind === 'saas_admin';
    const tenantCall = this.tenantScope && scope.kind === 'tenant' && value.audience === 'operator' && value.actor.kind === 'user';
    const workspaceCall = scope.kind === 'workspace' && ['operator', 'staff', 'client', 'automation'].includes(value.audience)
      && (value.audience === 'client' ? value.actor.kind === 'customer'
        : value.audience === 'automation' ? value.actor.kind === 'automation' : value.actor.kind === 'user');
    if (!platformCall && !tenantCall && !workspaceCall) throw new ModelGatewayError('FORBIDDEN');
    const context = structuredClone(value), binding = this.scenes.get(intent?.sceneCode);
    if (!binding) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const expected = identity(context);
    const actorId = value.actor.kind === 'customer' ? value.actor.customerId
      : value.actor.kind === 'automation' ? value.actor.subjectId
        : 'userId' in value.actor ? value.actor.userId : (() => { throw new ModelGatewayError('FORBIDDEN'); })();
    const narrow: GatewayContext = scope.kind === 'platform' ? { actorId }
      : scope.kind === 'workspace' ? { tenantId: scope.tenantId, workspaceId: scope.workspaceId, actorId }
        : tenantGatewayContextSchema.parse({ scopeKind: 'TENANT', tenantId: scope.tenantId, actorId });
    const life = new GatewayDeadline(this.timeoutMs, signal);
    let resolution: GatewayRoutingResolution | undefined, actual: AiGatewayConfigReferenceDraft | undefined, dispatched = false;
    const ports = this.runtime.ports;
    const verify = async (route: GatewayRoutingResolution) => {
      if (!isAiExecutionContext(route.context) || identity(route.context) !== expected) throw new ModelGatewayError('FORBIDDEN');
      if (await this.runtime.verifyEvidence(structuredClone(route), this.runtime.evidence) !== true) throw new ModelGatewayError('CONFIG_INVALID');
    };
    const current = async () => {
      if (!resolution) throw new ModelGatewayError('CONFIG_INVALID');
      await ports.routing.assertCurrent(structuredClone(narrow), structuredClone(resolution));
      await verify(resolution);
    };
    const gateway = new UnifiedAiGatewayService({ ...ports,
      ...(ports.nativeToolResults ? { nativeToolResults: {
        resolve: ports.nativeToolResults.resolve.bind(ports.nativeToolResults),
        assertCurrent: async (...args: Parameters<NativeToolResultResolver['assertCurrent']>) => {
          await current();
          if (!actual || requestFingerprint(actual) !== args[1].sourceConfigurationHash) throw new ModelGatewayError('CONFIG_INVALID');
          await ports.nativeToolResults!.assertCurrent(...args);
        }
      } } : {}), routing: {
      resolve: async (caller, required) => {
        const route = structuredClone(await ports.routing.resolve(caller, required));
        await verify(route);
        const profile = route.route.profile, owner = route.route.scope;
        if (profile.serviceMode !== route.selection.mode || profile.scopeId !== owner.id || profile.scopeKind !== owner.kind) throw new ModelGatewayError('CONFIG_INVALID');
        const parsed = referenceSchema.safeParse({ configId: profile.id, configRevision: profile.configRevision, credentialRef: profile.credentialRef,
          protocol: profile.protocol, provider: profile.provider, model: profile.model });
        if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
        if (scope.kind === 'platform') {
          if (route.selection.mode !== 'platform_managed' || owner.kind !== 'PLATFORM'
            || route.consumerScope.kind !== 'PLATFORM') throw new ModelGatewayError('CONFIG_INVALID');
          actual = { ...parsed.data, consumerScope: { kind: 'platform' }, serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } };
        } else {
          const tenantId = scope.tenantId;
          const consumerMatch = scope.kind === 'tenant'
            ? route.consumerScope.kind === 'TENANT' && route.consumerScope.tenantId === tenantId && route.consumerScope.workspaceId === undefined
            : route.consumerScope.kind === 'WORKSPACE' && route.consumerScope.tenantId === tenantId && route.consumerScope.workspaceId === scope.workspaceId;
          if (!consumerMatch) throw new ModelGatewayError('CONFIG_INVALID');
          if (route.selection.mode === 'platform_managed') {
            if (owner.kind !== 'PLATFORM') throw new ModelGatewayError('CONFIG_INVALID');
            actual = { ...parsed.data, tenantId, serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } };
          } else {
            if (owner.kind !== 'TENANT' || owner.tenantId !== tenantId
              || (scope.kind === 'tenant' && route.consumerScope.id !== owner.id)) throw new ModelGatewayError('CONFIG_INVALID');
            actual = { ...parsed.data, tenantId, serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId } };
          }
        }
        if (!isGatewayConfig(actual)) { actual = undefined; throw new ModelGatewayError('CONFIG_INVALID'); }
        resolution = route;
        return structuredClone(route);
      },
      assertCurrent: async () => current()
    }, transport: {
      ...(ports.transport.inputBoundHash ? { inputBoundHash: ports.transport.inputBoundHash.bind(ports.transport) } : {}),
      ...(ports.transport.nativeInputBoundHash ? { nativeInputBoundHash: ports.transport.nativeInputBoundHash.bind(ports.transport) } : {}),
      ...(ports.transport.invokeNativeToolResult ? { invokeNativeToolResult: (...args: Parameters<NonNullable<UnifiedGatewayPorts['transport']['invokeNativeToolResult']>>) => {
        dispatched = true; return ports.transport.invokeNativeToolResult!(...args);
      } } : {}),
      invoke: (...args) => { dispatched = true; return ports.transport.invoke(...args); },
      stream: (...args) => { dispatched = true; return ports.transport.stream(...args); }
    } }, this.timeoutMs, binding);
    const base = () => {
      if (!actual) throw new ModelGatewayError('CONFIG_INVALID');
      return { draftVersion: VERSION, requestId: intent.requestId, actual: structuredClone(actual), evidence: this.runtime.evidence };
    };
    const completed = (result: GatewayInvocationResult): AiGatewayResultDraft<TToolRequest> => {
      const usage: AiGatewayUsageDraft = result.usage ? { kind: 'reported', inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
        : { kind: 'unknown', reason: 'not_returned', nextAction: 'reconcile' };
      const proposed = binding.orderExplainTool === true && intent.requiredFeatures.includes('tools')
        ? result.toolRequests ?? [] : [];
      if (!Array.isArray(proposed) || proposed.length > 8 || !proposed.every(value => ports.toolPolicy?.validateToolRequest(value))) throw new ModelGatewayError('INVALID_RESPONSE');
      // Requests are unexecuted model candidates. The receiving business tool
      // must still resolve current scope/ownership/permission and Core facts.
      return checkedResult({ ...base(), status: 'completed', text: result.text, toolRequests: structuredClone(proposed), usage }, this.validators);
    };
    const failed = (error: unknown): AiGatewayResultDraft<TToolRequest> => {
      const code = error instanceof ModelGatewayError ? error.code : 'PROVIDER_FAILED';
      if (dispatched || code === 'ACCOUNTING_PENDING') return { ...base(), status: 'unknown',
        usage: { kind: 'unknown', reason: 'result_unknown', nextAction: 'reconcile' },
        error: { code: 'AI_RESULT_UNKNOWN', message: 'Invocation outcome requires reconciliation.', retryable: false, nextAction: 'reconcile' } };
      const codes: Partial<Record<typeof code, AiGatewayFailureCodeDraft>> = { TIMEOUT: 'timeout', CANCELLED: 'cancelled', RATE_LIMITED: 'rate_limited',
        FORBIDDEN: 'authentication_failed', AUTHENTICATION_FAILED: 'authentication_failed', CONFIG_INVALID: 'configuration_changed',
        CAPABILITY_UNSUPPORTED: 'capability_unsupported', INVALID_RESPONSE: 'invalid_response' };
      return { ...base(), status: 'failed', usage: { kind: 'unknown', reason: 'not_returned', nextAction: 'reconcile' },
        error: { code: codes[code] ?? 'adapter_unavailable', message: 'Invocation was not dispatched.', nextAction: 'manual' } };
    };
    return { gateway, narrow, life, current, completed, failed, base, hasRoute: () => actual !== undefined };
  }

  async invoke(context: AiExecutionContext, value: AiGatewayIntentDraft, signal?: AbortSignal): Promise<AiGatewayResultDraft<TToolRequest>> {
    const intent = structuredClone(value), call = this.call(context, intent, signal);
    try {
      const native = intent.messages.some(message => message.content.some(part => part.kind === 'tool_result_reference'));
      const hasMedia = intent.messages.some(message => message.content.some(part => part.kind !== 'text'));
      const result = await (native ? call.gateway.invokeNativeToolResultIntent(call.narrow, intent, call.life.controller.signal)
        : intent.requiredFeatures.includes('embedding')
        ? call.gateway.invokeEmbeddingProbeIntent(call.narrow, intent, call.life.controller.signal) : hasMedia
        ? call.gateway.invokeIntent(call.narrow, intent, call.life.controller.signal)
        : call.gateway.invokeTextIntent(call.narrow, intent, call.life.controller.signal));
      await call.life.wait(call.current);
      return checkedResult(call.completed(result), this.validators);
    } catch (error) {
      const failure = new ModelGatewayError(call.life.reason() ?? (error instanceof ModelGatewayError ? error.code : 'PROVIDER_FAILED'));
      if (!call.hasRoute()) throw failure;
      // Revoked callers receive no config/result envelope, even for an outcome that needs reconciliation.
      await call.life.cleanup(call.current);
      return checkedResult(call.failed(failure), this.validators);
    } finally { call.life.close(); }
  }

  async *stream(context: AiExecutionContext, value: AiGatewayIntentDraft, signal?: AbortSignal): AsyncIterable<AiGatewayStreamEventDraft<TToolRequest>> {
    const intent = structuredClone(value), call = this.call(context, intent, signal);
    const hasMedia = intent.messages.some(message => message.content.some(part => part.kind !== 'text'));
    const iterator = hasMedia
      ? call.gateway.streamIntent(call.narrow, intent, call.life.controller.signal)
      : call.gateway.streamTextIntent(call.narrow, intent, call.life.controller.signal);
    let sequence = 1, started = false;
    const header = () => ({ draftVersion: VERSION, requestId: intent.requestId, sequence: sequence++ });
    try {
      for await (const event of iterator) {
        if (!started) {
          await call.life.wait(call.current);
          const base = call.base(); started = true;
          yield checkedEvent({ ...header(), kind: 'started', actual: base.actual, evidence: base.evidence }, this.validators);
        }
        if (sequence >= 4095) throw new ModelGatewayError('INVALID_RESPONSE');
        await call.life.wait(call.current);
        if (event.kind === 'text_delta') {
          if (event.delta) yield checkedEvent({ ...header(), kind: 'text_delta', delta: event.delta }, this.validators);
        } else yield checkedEvent({ ...header(), kind: 'terminal', result: checkedResult(call.completed(event.result), this.validators) }, this.validators);
      }
    } catch (error) {
      const failure = new ModelGatewayError(call.life.reason() ?? (error instanceof ModelGatewayError ? error.code : 'PROVIDER_FAILED'));
      if (!call.hasRoute()) throw failure;
      await call.life.cleanup(call.current);
      if (!started) {
        const base = call.base(); started = true;
        yield checkedEvent({ ...header(), kind: 'started', actual: base.actual, evidence: base.evidence }, this.validators);
        await call.life.cleanup(call.current);
      }
      yield checkedEvent({ ...header(), kind: 'terminal', result: checkedResult(call.failed(failure), this.validators) }, this.validators);
    } finally {
      call.life.controller.abort();
      try { await call.life.cleanup(() => iterator.return(undefined)); }
      catch { /* The inner lifecycle retains durable reconciliation; cleanup cannot replace the public outcome. */ }
      finally { call.life.close(); }
    }
  }
}

@Module({})
export class PublicAiGatewayModule {
  static registerProtocols<TToolRequest = never>(runtime: Omit<PublicGatewayRuntime<TToolRequest>, 'ports'> & { ports: Omit<UnifiedGatewayPorts<TToolRequest>, 'transport'> },
    connections: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver }, adapters: readonly ModelAdapter[],
    scenes: readonly GatewayTextIntentBinding[]): DynamicModule {
    return this.register({ ...runtime, ports: { ...runtime.ports, transport: new RoutedModelTransport(connections, adapters) } }, scenes);
  }
  static register<TToolRequest = never>(runtime: PublicGatewayRuntime<TToolRequest>, scenes: readonly GatewayTextIntentBinding[]): DynamicModule {
    const service = new PublicAiGatewayService<TToolRequest>(runtime, scenes);
    return { module: PublicAiGatewayModule, providers: [{ provide: PublicAiGatewayService, useValue: service }], exports: [PublicAiGatewayService] };
  }
}
