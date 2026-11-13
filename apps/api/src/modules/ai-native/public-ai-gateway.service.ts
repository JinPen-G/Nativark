import { Module, type DynamicModule } from '@nestjs/common';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft, AiGatewayFailureCodeDraft, AiGatewayIntentDraft,
  AiGatewayPortDraft, AiGatewayResultDraft, AiGatewayStreamEventDraft, AiGatewayUsageDraft } from '@rental-os/shared';
import { z } from 'zod';
import { GatewayDeadline } from './gateway-deadline';
import { isGatewayConfig, isGatewayEvent, isGatewayIntent, isGatewayResult, isGatewayOrderExplainRequest } from './gateway-contract-validation';
import { gatewayTextIntentBindingSchema, type GatewayTextIntentBinding } from './gateway-intent';
import { type GatewayRoutingResolution } from './gateway-routing.service';
import { ModelGatewayError, isPlatformGatewayContext, type GatewayContext, type ModelAdapter } from './model-gateway.ports';
import { RoutedModelTransport, type GatewayConnectionResolver } from './routed-model-transport';
import { isAiStepExecutionContext } from './task-contract-validation';
import { UnifiedAiGatewayService } from './unified-ai-gateway.service';
import type { GatewayInvocationResult, UnifiedGatewayPorts } from './unified-ai-gateway.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

import type { NativeToolResultResolver } from './model-input/native-tool-result.ports';

const VERSION = 'ain-c03-draft-2' as const;
const referenceSchema = z.object({ configId: z.string().min(1).max(191), configRevision: z.number().int().positive().max(4294967295),
  credentialRef: z.string().min(1).max(191), protocol: z.string().min(1).max(191), provider: z.string().min(1).max(191), model: z.string().min(1).max(256) }).strict();
export interface PublicGatewayRuntime {
  ports: UnifiedGatewayPorts;
  /** Registered server transport mode, never supplied by an Agent or inferred from a fingerprint. */
  evidence: 'mock' | 'live';
  /** Trusted adapter/evidence verifier. Must recheck provenance, binding, freshness and the registered transport mode. */
  verifyEvidence(resolution: GatewayRoutingResolution, mode: 'mock' | 'live'): Promise<boolean>;
}
function checkedResult(value: AiGatewayResultDraft): AiGatewayResultDraft {
  if (!isGatewayResult(value)) throw new ModelGatewayError('INVALID_RESPONSE');
  return value;
}
function checkedEvent(value: AiGatewayStreamEventDraft): AiGatewayStreamEventDraft {
  if (!isGatewayEvent(value)) throw new ModelGatewayError('INVALID_RESPONSE');
  return value;
}
function identity(value: AiExecutionContext) {
  const { requestId: _, authorizedAt: __, ...rest } = value;
  return requestFingerprint(rest);
}

/** C03 public port for server-authorized workspace principals. Customer and
 * automation owners keep their distinct namespace in the original task/ledger;
 * routing must revalidate the same current principal before every effect.
 * No production root registers this module automatically, and no default evidence verifier is supplied.
 */
export class PublicAiGatewayService implements AiGatewayPortDraft {
  private readonly scenes = new Map<string, GatewayTextIntentBinding>();
  private readonly runtime: PublicGatewayRuntime;
  constructor(runtime: PublicGatewayRuntime, scenes: readonly GatewayTextIntentBinding[], private readonly timeoutMs = 120000) {
    if (!runtime?.ports || !['mock', 'live'].includes(runtime.evidence) || typeof runtime.verifyEvidence !== 'function'
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000 || !Array.isArray(scenes) || !scenes.length || scenes.length > 100) throw new ModelGatewayError('CONFIG_INVALID');
    const ports = runtime.ports;
    if ([ports.routing?.resolve, ports.routing?.assertCurrent, ports.admission?.admit, ports.dispatch?.claim, ports.dispatch?.finish,
      ports.budget?.reserve, ports.budget?.dispatch, ports.budget?.settle, ports.budget?.abandon, ports.audit?.append, ports.transport?.invoke, ports.transport?.stream]
      .some(method => typeof method !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
    this.runtime = { ports: { ...runtime.ports }, evidence: runtime.evidence, verifyEvidence: runtime.verifyEvidence.bind(runtime) };
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
    const platformCall = isAiStepExecutionContext(value) && value.scope.kind === 'platform'
      && value.audience === 'operator' && value.actor.kind === 'saas_admin';
    if (!platformCall && (!isAiStepExecutionContext(value) || value.scope.kind !== 'workspace'
      || (value.audience === 'client' ? value.actor.kind !== 'customer'
        : value.audience === 'automation' ? value.actor.kind !== 'automation' : value.actor.kind !== 'user')
      || !['operator', 'staff', 'client', 'automation'].includes(value.audience))) throw new ModelGatewayError('FORBIDDEN');
    const context = structuredClone(value), binding = this.scenes.get(intent?.sceneCode);
    if (!binding) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    const expected = identity(context);
    const actorId = value.actor.kind === 'customer' ? value.actor.customerId
      : value.actor.kind === 'automation' ? value.actor.subjectId
        : 'userId' in value.actor ? value.actor.userId : (() => { throw new ModelGatewayError('FORBIDDEN'); })();
    // Explicit SaaS platform principal: actorId only, no tenant attribution.
    const workspaceScope = value.scope as { tenantId: string; workspaceId: string };
    const narrow: GatewayContext = platformCall
      ? { actorId }
      : { tenantId: workspaceScope.tenantId, workspaceId: workspaceScope.workspaceId, actorId };
    const life = new GatewayDeadline(this.timeoutMs, signal);
    let resolution: GatewayRoutingResolution | undefined, actual: AiGatewayConfigReferenceDraft | undefined, dispatched = false;
    const ports = this.runtime.ports;
    const verify = async (route: GatewayRoutingResolution) => {
      if (!isAiStepExecutionContext(route.context) || identity(route.context) !== expected) throw new ModelGatewayError('FORBIDDEN');
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
        if (isPlatformGatewayContext(narrow)) {
          if (route.selection.mode !== 'platform_managed' || owner.kind !== 'PLATFORM'
            || route.consumerScope.kind !== 'PLATFORM') throw new ModelGatewayError('CONFIG_INVALID');
          actual = { ...parsed.data, consumerScope: { kind: 'platform' }, serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } };
        } else {
          const workspaceNarrow: { tenantId: string; workspaceId: string; actorId: string } = narrow;
          if (route.selection.mode === 'platform_managed') {
            if (owner.kind !== 'PLATFORM' || route.consumerScope.kind !== 'WORKSPACE'
              || route.consumerScope.tenantId !== workspaceNarrow.tenantId || route.consumerScope.workspaceId !== workspaceNarrow.workspaceId) throw new ModelGatewayError('CONFIG_INVALID');
            actual = { ...parsed.data, tenantId: workspaceNarrow.tenantId, serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } };
          } else {
            if (owner.kind !== 'TENANT' || owner.tenantId !== workspaceNarrow.tenantId
              || route.consumerScope.kind !== 'WORKSPACE' || route.consumerScope.tenantId !== workspaceNarrow.tenantId
              || route.consumerScope.workspaceId !== workspaceNarrow.workspaceId) throw new ModelGatewayError('CONFIG_INVALID');
            actual = { ...parsed.data, tenantId: workspaceNarrow.tenantId, serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: workspaceNarrow.tenantId } };
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
    const completed = (result: GatewayInvocationResult): AiGatewayResultDraft => {
      const usage: AiGatewayUsageDraft = result.usage ? { kind: 'reported', inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
        : { kind: 'unknown', reason: 'not_returned', nextAction: 'reconcile' };
      const proposed = binding.orderExplainTool === true && intent.requiredFeatures.includes('tools')
        ? result.toolRequests ?? [] : [];
      if (!Array.isArray(proposed) || proposed.length > 8 || !proposed.every(isGatewayOrderExplainRequest)) throw new ModelGatewayError('INVALID_RESPONSE');
      // Requests are unexecuted model candidates. The receiving business tool
      // must still resolve current scope/ownership/permission and Core facts.
      return { ...base(), status: 'completed', text: result.text, toolRequests: structuredClone(proposed), usage };
    };
    const failed = (error: unknown): AiGatewayResultDraft => {
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

  async invoke(context: AiExecutionContext, value: AiGatewayIntentDraft, signal?: AbortSignal): Promise<AiGatewayResultDraft> {
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
      return checkedResult(call.completed(result));
    } catch (error) {
      const failure = new ModelGatewayError(call.life.reason() ?? (error instanceof ModelGatewayError ? error.code : 'PROVIDER_FAILED'));
      if (!call.hasRoute()) throw failure;
      // Revoked callers receive no config/result envelope, even for an outcome that needs reconciliation.
      await call.life.cleanup(call.current);
      return checkedResult(call.failed(failure));
    } finally { call.life.close(); }
  }

  async *stream(context: AiExecutionContext, value: AiGatewayIntentDraft, signal?: AbortSignal): AsyncIterable<AiGatewayStreamEventDraft> {
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
          yield checkedEvent({ ...header(), kind: 'started', actual: base.actual, evidence: base.evidence });
        }
        if (sequence >= 4095) throw new ModelGatewayError('INVALID_RESPONSE');
        await call.life.wait(call.current);
        if (event.kind === 'text_delta') {
          if (event.delta) yield checkedEvent({ ...header(), kind: 'text_delta', delta: event.delta });
        } else yield checkedEvent({ ...header(), kind: 'terminal', result: checkedResult(call.completed(event.result)) });
      }
    } catch (error) {
      const failure = new ModelGatewayError(call.life.reason() ?? (error instanceof ModelGatewayError ? error.code : 'PROVIDER_FAILED'));
      if (!call.hasRoute()) throw failure;
      await call.life.cleanup(call.current);
      if (!started) {
        const base = call.base(); started = true;
        yield checkedEvent({ ...header(), kind: 'started', actual: base.actual, evidence: base.evidence });
        await call.life.cleanup(call.current);
      }
      yield checkedEvent({ ...header(), kind: 'terminal', result: checkedResult(call.failed(failure)) });
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
  static registerProtocols(runtime: Omit<PublicGatewayRuntime, 'ports'> & { ports: Omit<UnifiedGatewayPorts, 'transport'> },
    connections: { platform: GatewayConnectionResolver; tenant: GatewayConnectionResolver }, adapters: readonly ModelAdapter[],
    scenes: readonly GatewayTextIntentBinding[]): DynamicModule {
    return this.register({ ...runtime, ports: { ...runtime.ports, transport: new RoutedModelTransport(connections, adapters) } }, scenes);
  }
  static register(runtime: PublicGatewayRuntime, scenes: readonly GatewayTextIntentBinding[]): DynamicModule {
    const service = new PublicAiGatewayService(runtime, scenes);
    return { module: PublicAiGatewayModule, providers: [{ provide: PublicAiGatewayService, useValue: service }], exports: [PublicAiGatewayService] };
  }
}
