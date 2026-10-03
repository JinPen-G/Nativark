import { ModelGatewayError, type GatewayContext, type ModelRequest } from './model-gateway.ports';
import type { UnifiedGatewayPorts, GatewayInvocationResult, GatewayStreamEvent } from './unified-ai-gateway.ports';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

/**
 * Legacy internal facade over the durable ports. It is NOT the public Intent/Port
 * contract, does not resolve identity or real AiScope rows, and must never be
 * exposed directly to a model or client request. Stream and invoke share one
 * lifecycle: route → admit → reserve → audit → dispatch → settle/reconcile → complete.
 * Until the coordinator wires a scope resolver, the fabricated scope id is rejected
 * by the real repositories (fail-closed) instead of being silently trusted.
 */
export class UnifiedAiGatewayService {
  constructor(private readonly ports: UnifiedGatewayPorts, private readonly deadlineMs = 120_000) { if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120_000) throw new ModelGatewayError('CONFIG_INVALID'); }

  private deadline(signal?: AbortSignal) {
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    const controller = new AbortController();
    let reason: 'TIMEOUT' | 'CANCELLED' | null = null;
    const timer = setTimeout(() => { reason = 'TIMEOUT'; controller.abort(); }, this.deadlineMs);
    const abort = () => { reason = reason ?? 'CANCELLED'; controller.abort(); };
    signal?.addEventListener('abort', abort, { once: true });
    return { controller, reason: () => reason, close: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
  }

  private scope(context: GatewayContext) { return { id: `${context.tenantId}:${context.workspaceId}`, kind: 'WORKSPACE' as const, tenantId: context.tenantId, workspaceId: context.workspaceId }; }

  async invoke(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): Promise<GatewayInvocationResult> {
    const life = this.deadline(signal), scope = this.scope(context);
    let admissionId: string | undefined, usageId: string | undefined, dispatched = false, accounted = false, settled = false;
    try {
      const route = await this.ports.router.resolve({ consumerScope: scope, platformScope: { id: 'platform-default', kind: 'PLATFORM' }, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: (request.features ?? []).map(feature => feature === 'structuredOutput' ? 'structured_output' : feature === 'streaming' ? 'streaming' : 'tools') });
      const admission = await this.ports.admission.admit({ scope, actorId: context.actorId, callId: request.callId, requestHash: requestFingerprint(request), profileId: route.profile.id, expiresAt: new Date(Date.now() + this.deadlineMs) }); admissionId = admission.id;
      const usage = await this.ports.usage.reserve({ scope: admission.scope, callId: request.callId, idempotencyKey: request.callId, reservedUnits: request.maxOutputTokens, expiresAt: new Date(Date.now() + this.deadlineMs) }); usageId = usage.id;
      await this.ports.audit.append({ callId: request.callId, tenantId: context.tenantId, workspaceId: context.workspaceId, event: 'ai.invoke.admitted', status: 'accepted' });
      dispatched = true;
      const result = await this.ports.transport.invoke(context, request, route, life.controller.signal);
      // A late result after timeout/cancel must not be converted into a completed call.
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      if (result.usage) { await this.ports.usage.settle(admission.scope, usageId, `invoke:${request.callId}`, result.usage.inputTokens, result.usage.outputTokens); accounted = true; }
      else { await this.ports.usage.markUnknown(admission.scope, usageId, 'USAGE_UNAVAILABLE'); accounted = true; }
      await this.ports.admission.transition(admission.scope, request.callId, 'admitted', 'completed');
      settled = true;
      return { ...result, usageState: result.usage ? 'reported' : 'reconciliation_required' };
    } catch (error) {
      settled = true;
      if (usageId && !accounted) { try { await this.ports.usage.markUnknown(scope, usageId, dispatched ? 'DISPATCH_UNKNOWN' : 'DISPATCH_NOT_STARTED'); accounted = true; } catch { /* durable reconciliation remains pending */ } }
      if (admissionId) { try { await this.ports.admission.transition(scope, request.callId, 'admitted', dispatched ? 'unknown' : 'cancelled', { unknownReason: dispatched ? 'DISPATCH_UNKNOWN' : null }); } catch { /* durable state is authoritative */ } }
      throw error instanceof ModelGatewayError ? error : new ModelGatewayError(life.reason() ?? 'PROVIDER_FAILED');
    } finally {
      life.close();
      // Only reachable if compensation itself failed mid-catch; never double-report success.
      if (!settled && (usageId || admissionId)) {
        if (usageId && !accounted) { try { await this.ports.usage.markUnknown(scope, usageId, 'DISPATCH_UNKNOWN'); } catch { /* durable reconciliation remains pending */ } }
        if (admissionId) { try { await this.ports.admission.transition(scope, request.callId, 'admitted', dispatched ? 'unknown' : 'cancelled', { unknownReason: dispatched ? 'DISPATCH_UNKNOWN' : null }); } catch { /* durable state is authoritative */ } }
      }
    }
  }

  async *stream(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): AsyncGenerator<GatewayStreamEvent> {
    const life = this.deadline(signal), scope = this.scope(context);
    let admissionId: string | undefined, usageId: string | undefined, dispatched = false, accounted = false, settled = false;
    try {
      const route = await this.ports.router.resolve({ consumerScope: scope, platformScope: { id: 'platform-default', kind: 'PLATFORM' }, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: ['streaming'] });
      const admission = await this.ports.admission.admit({ scope, actorId: context.actorId, callId: request.callId, requestHash: requestFingerprint(request), profileId: route.profile.id, expiresAt: new Date(Date.now() + this.deadlineMs) }); admissionId = admission.id;
      const usage = await this.ports.usage.reserve({ scope: admission.scope, callId: request.callId, idempotencyKey: request.callId, reservedUnits: request.maxOutputTokens, expiresAt: new Date(Date.now() + this.deadlineMs) }); usageId = usage.id;
      await this.ports.audit.append({ callId: request.callId, tenantId: context.tenantId, workspaceId: context.workspaceId, event: 'ai.stream.admitted', status: 'accepted' });
      dispatched = true;
      let result: GatewayInvocationResult | undefined;
      for await (const event of this.ports.transport.stream(context, request, route, life.controller.signal)) {
        if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
        if (event.kind === 'result') result = event.result;
        yield event;
      }
      // A stream without a terminal result event is incomplete, never a completed call.
      if (!result) throw new ModelGatewayError('PROVIDER_FAILED');
      if (result.usage) { await this.ports.usage.settle(admission.scope, usageId, `stream:${request.callId}`, result.usage.inputTokens, result.usage.outputTokens); accounted = true; }
      else { await this.ports.usage.markUnknown(admission.scope, usageId, 'USAGE_UNAVAILABLE'); accounted = true; }
      await this.ports.admission.transition(admission.scope, request.callId, 'admitted', 'completed');
      settled = true;
    } catch (error) {
      settled = true;
      if (usageId && !accounted) { try { await this.ports.usage.markUnknown(scope, usageId, dispatched ? 'DISPATCH_UNKNOWN' : 'DISPATCH_NOT_STARTED'); accounted = true; } catch { /* durable reconciliation remains pending */ } }
      if (admissionId) { try { await this.ports.admission.transition(scope, request.callId, 'admitted', dispatched ? 'unknown' : 'cancelled', { unknownReason: dispatched ? 'DISPATCH_UNKNOWN' : null }); } catch { /* durable state is authoritative */ } }
      throw error instanceof ModelGatewayError ? error : new ModelGatewayError(life.reason() ?? 'PROVIDER_FAILED');
    } finally {
      life.close();
      // Consumer stopped iterating before a terminal outcome: dispatched work is unresolved.
      if (!settled) {
        if (usageId && !accounted) { try { await this.ports.usage.markUnknown(scope, usageId, 'CONSUMER_STOPPED'); } catch { /* durable reconciliation remains pending */ } }
        if (admissionId) { try { await this.ports.admission.transition(scope, request.callId, 'admitted', dispatched ? 'unknown' : 'cancelled', { unknownReason: dispatched ? 'CONSUMER_STOPPED' : null }); } catch { /* durable state is authoritative */ } }
      }
    }
  }
}
