import { GatewayDeadline } from './gateway-deadline';
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

  private deadline(signal?: AbortSignal) { return new GatewayDeadline(this.deadlineMs, signal); }

  private scope(context: GatewayContext) { return { id: `${context.tenantId}:${context.workspaceId}`, kind: 'WORKSPACE' as const, tenantId: context.tenantId, workspaceId: context.workspaceId }; }

  async invoke(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): Promise<GatewayInvocationResult> {
    const life = this.deadline(signal), scope = this.scope(context);
    let admissionId: string | undefined, usageId: string | undefined, dispatched = false, accounted = false, settled = false, closed = false;
    try {
      const route = await life.wait(() => this.ports.router.resolve({ consumerScope: scope, platformScope: { id: 'platform-default', kind: 'PLATFORM' }, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: (request.features ?? []).map(feature => feature === 'structuredOutput' ? 'structured_output' : feature === 'streaming' ? 'streaming' : 'tools') }));
      const admission = await life.wait(() => this.ports.admission.admit({ scope, actorId: context.actorId, callId: request.callId, requestHash: requestFingerprint(request), profileId: route.profile.id, expiresAt: life.expiresAt }).then(record => { if (closed) { void life.cleanup(() => this.ports.admission.transition(scope, request.callId, 'admitted', 'cancelled')).catch(() => {}); } else admissionId = record.id; return record; })); admissionId = admission.id;
      const usage = await life.wait(() => this.ports.usage.reserve({ scope: admission.scope, callId: request.callId, idempotencyKey: request.callId, reservedUnits: request.maxOutputTokens, expiresAt: life.expiresAt }).then(record => { if (closed) { void life.cleanup(() => this.ports.usage.markUnknown(scope, record.id, 'LATE_RESERVATION')).catch(() => {}); } else usageId = record.id; return record; })); usageId = usage.id;
      await life.wait(() => this.ports.audit.append({ callId: request.callId, tenantId: context.tenantId, workspaceId: context.workspaceId, event: 'ai.invoke.admitted', status: 'accepted' }));
      dispatched = true;
      const result = await life.wait(() => this.ports.transport.invoke(context, request, route, life.controller.signal));
      // A late result after timeout/cancel must not be converted into a completed call.
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      const reported = result.usage;
      if (reported) { await life.wait(() => this.ports.usage.settle(admission.scope, usage.id, `invoke:${request.callId}`, reported.inputTokens, reported.outputTokens)); accounted = true; }
      else { await life.wait(() => this.ports.usage.markUnknown(admission.scope, usage.id, 'USAGE_UNAVAILABLE')); accounted = true; }
      await life.wait(() => this.ports.admission.transition(admission.scope, request.callId, 'admitted', 'completed'));
      settled = true;
      return { ...result, usageState: result.usage ? 'reported' : 'reconciliation_required' };
    } catch (error) {
      const failure = error instanceof ModelGatewayError ? error : new ModelGatewayError(life.reason() ?? 'PROVIDER_FAILED');
      closed = true;
      settled = true;
      if (usageId && !accounted) { const pendingId = usageId; try { await life.cleanup(() => this.ports.usage.markUnknown(scope, pendingId, dispatched ? 'DISPATCH_UNKNOWN' : 'DISPATCH_NOT_STARTED')); accounted = true; } catch { /* durable reconciliation remains pending */ } }
      if (admissionId) { try { await life.cleanup(() => this.ports.admission.transition(scope, request.callId, 'admitted', dispatched ? 'unknown' : 'cancelled', { unknownReason: dispatched ? 'DISPATCH_UNKNOWN' : null })); } catch { /* durable state is authoritative */ } }
      throw failure;
    } finally {
      closed = true;
      life.close();
      // Only reachable if compensation itself failed mid-catch; never double-report success.
      if (!settled && (usageId || admissionId)) {
        if (usageId && !accounted) { const pendingId = usageId; try { await life.cleanup(() => this.ports.usage.markUnknown(scope, pendingId, 'DISPATCH_UNKNOWN')); } catch { /* durable reconciliation remains pending */ } }
        if (admissionId) { try { await life.cleanup(() => this.ports.admission.transition(scope, request.callId, 'admitted', dispatched ? 'unknown' : 'cancelled', { unknownReason: dispatched ? 'DISPATCH_UNKNOWN' : null })); } catch { /* durable state is authoritative */ } }
      }
    }
  }

  async *stream(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): AsyncGenerator<GatewayStreamEvent> {
    const life = this.deadline(signal), scope = this.scope(context);
    let admissionId: string | undefined, usageId: string | undefined, dispatched = false, accounted = false, settled = false, closed = false;
    let iterator: AsyncIterator<GatewayStreamEvent> | undefined;
    let sourceDone = false;
    let finalResult: GatewayInvocationResult | undefined;
    try {
      const route = await life.wait(() => this.ports.router.resolve({ consumerScope: scope, platformScope: { id: 'platform-default', kind: 'PLATFORM' }, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: ['streaming'] }));
      const admission = await life.wait(() => this.ports.admission.admit({ scope, actorId: context.actorId, callId: request.callId, requestHash: requestFingerprint(request), profileId: route.profile.id, expiresAt: life.expiresAt }).then(record => { if (closed) { void life.cleanup(() => this.ports.admission.transition(scope, request.callId, 'admitted', 'cancelled')).catch(() => {}); } else admissionId = record.id; return record; })); admissionId = admission.id;
      const usage = await life.wait(() => this.ports.usage.reserve({ scope: admission.scope, callId: request.callId, idempotencyKey: request.callId, reservedUnits: request.maxOutputTokens, expiresAt: life.expiresAt }).then(record => { if (closed) { void life.cleanup(() => this.ports.usage.markUnknown(scope, record.id, 'LATE_RESERVATION')).catch(() => {}); } else usageId = record.id; return record; })); usageId = usage.id;
      await life.wait(() => this.ports.audit.append({ callId: request.callId, tenantId: context.tenantId, workspaceId: context.workspaceId, event: 'ai.stream.admitted', status: 'accepted' }));
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      dispatched = true;
      let result: GatewayInvocationResult | undefined;
      iterator = this.ports.transport.stream(context, request, route, life.controller.signal)[Symbol.asyncIterator]();
      while (true) {
        const item = await life.wait(() => iterator!.next());
        if (item.done) { sourceDone = true; break; }
        const event = item.value;
        if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
        if (!event || result) throw new ModelGatewayError('INVALID_RESPONSE');
        if (event.kind === 'result') {
          if (!event.result || typeof event.result.text !== 'string') throw new ModelGatewayError('INVALID_RESPONSE');
          result = structuredClone(event.result);
        } else if (event.kind === 'text_delta' && typeof event.delta === 'string') {
          yield { kind: 'text_delta', delta: event.delta };
        } else throw new ModelGatewayError('INVALID_RESPONSE');
      }
      // A stream without a terminal result event is incomplete, never a completed call.
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      if (!result) throw new ModelGatewayError('PROVIDER_FAILED');
      const reported = result.usage;
      if (reported) { await life.wait(() => this.ports.usage.settle(admission.scope, usage.id, `stream:${request.callId}`, reported.inputTokens, reported.outputTokens)); accounted = true; }
      else { await life.wait(() => this.ports.usage.markUnknown(admission.scope, usage.id, 'USAGE_UNAVAILABLE')); accounted = true; }
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      await life.wait(() => this.ports.admission.transition(admission.scope, request.callId, 'admitted', 'completed'));
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      settled = true;
      finalResult = result;
    } catch (error) {
      const failure = error instanceof ModelGatewayError ? error : new ModelGatewayError(life.reason() ?? 'PROVIDER_FAILED');
      closed = true;
      settled = true;
      if (usageId && !accounted) { const pendingId = usageId; try { await life.cleanup(() => this.ports.usage.markUnknown(scope, pendingId, dispatched ? 'DISPATCH_UNKNOWN' : 'DISPATCH_NOT_STARTED')); accounted = true; } catch { /* durable reconciliation remains pending */ } }
      if (admissionId) { try { await life.cleanup(() => this.ports.admission.transition(scope, request.callId, 'admitted', dispatched ? 'unknown' : 'cancelled', { unknownReason: dispatched ? 'DISPATCH_UNKNOWN' : null })); } catch { /* durable state is authoritative */ } }
      throw failure;
    } finally {
      life.controller.abort();
      closed = true;
      life.close();
      // Consumer stopped iterating before a terminal outcome: dispatched work is unresolved.
      if (!settled) {
        if (usageId && !accounted) { const pendingId = usageId; try { await life.cleanup(() => this.ports.usage.markUnknown(scope, pendingId, 'CONSUMER_STOPPED')); } catch { /* durable reconciliation remains pending */ } }
        if (admissionId) { try { await life.cleanup(() => this.ports.admission.transition(scope, request.callId, 'admitted', dispatched ? 'unknown' : 'cancelled', { unknownReason: dispatched ? 'CONSUMER_STOPPED' : null })); } catch { /* durable state is authoritative */ } }
      }
      if (iterator?.return && !sourceDone) {
        try { await life.cleanup(() => iterator!.return!()); } catch { /* bounded abandonment; durable state remains pending */ }
      }
    }
    // Publication is last: EOF, accounting and admission commit have all succeeded.
    // Yield outside cleanup so a consumer returning here cannot mark completion unknown.
    if (!finalResult) throw new ModelGatewayError('INVALID_RESPONSE');
    yield { kind: 'result', result: finalResult };
  }
}
