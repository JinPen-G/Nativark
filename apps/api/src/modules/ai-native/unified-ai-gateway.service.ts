import { randomUUID } from 'node:crypto';
import type { AiDispatchBinding } from './invocation-dispatch.service';
import type { AiProfileCapability, AiProfileScope } from './provider-profile.ports';
import { GatewayDeadline } from './gateway-deadline';
import { ModelGatewayError, modelRequestSchema, type GatewayContext, type ModelRequest } from './model-gateway.ports';
import type { UnifiedGatewayPorts, GatewayInvocationResult, GatewayStreamEvent } from './unified-ai-gateway.ports';
import { gatewayRoutingBinding } from './gateway-routing.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

// Internal workspace facade with token-bound dispatch ownership; public C03 mapping remains separate.
export class UnifiedAiGatewayService {
  constructor(private readonly ports: UnifiedGatewayPorts, private readonly deadlineMs = 120_000) { if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120_000) throw new ModelGatewayError('CONFIG_INVALID'); }

  private deadline(signal?: AbortSignal) { return new GatewayDeadline(this.deadlineMs, signal); }

  private input(request: ModelRequest): ModelRequest {
    const parsed = modelRequestSchema.safeParse(request);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    return parsed.data;
  }

  private required(request: ModelRequest, stream = false): AiProfileCapability[] {
    const capabilities: AiProfileCapability[] = ['text'];
    if (stream) capabilities.push('streaming');
    for (const feature of request.features ?? []) {
      if (feature === 'tools') capabilities.push('tools');
      else if (feature === 'structuredOutput') capabilities.push('structured_output');
      else if (feature === 'streaming') capabilities.push('streaming');
      else throw new ModelGatewayError('INVALID_REQUEST');
    }
    return [...new Set(capabilities)];
  }

  async invoke(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): Promise<GatewayInvocationResult> {
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    request = this.input(request); context = structuredClone(context);
    const life = this.deadline(signal);
    let scope!: AiProfileScope;
    let binding: AiDispatchBinding | undefined;
    let admissionId: string | undefined, usageId: string | undefined, dispatched = false, accounted = false, settled = false, closed = false;
    try {
      const resolution = structuredClone(await life.wait(() => this.ports.routing.resolve(context, this.required(request))));
      const route = resolution.route; scope = resolution.consumerScope;
      request = this.input({ ...request, model: route.profile.model });
      const hash = requestFingerprint({ request, routing: gatewayRoutingBinding(resolution) });
      if (!this.ports.dispatch || typeof this.ports.dispatch.claim !== 'function' || typeof this.ports.dispatch.finish !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
      // An admission may be shared by concurrent attempts. Only a successful claim owns cleanup.
      const admission = await life.wait(() => this.ports.admission.admit({ scope: structuredClone(scope), actorId: context.actorId, callId: request.callId, requestHash: hash, profileId: route.profile.id, expiresAt: life.expiresAt }));
      binding = { scope: structuredClone(scope) as AiDispatchBinding['scope'], id: admission.id, actorId: context.actorId,
        callId: request.callId, requestHash: hash, profileId: route.profile.id, dispatchId: randomUUID() };
      const token = structuredClone(binding);
      await life.wait(() => this.ports.dispatch.claim(structuredClone(token)).then(() => {
        if (closed) { void life.cleanup(() => this.ports.dispatch.finish(structuredClone(token), 'cancelled')).catch(() => {}); }
        else admissionId = admission.id;
      }));
      const usage = await life.wait(() => this.ports.usage.reserve({ scope: admission.scope, callId: request.callId, idempotencyKey: request.callId, reservedUnits: request.maxOutputTokens, expiresAt: life.expiresAt }).then(record => { if (closed) { void life.cleanup(() => this.ports.usage.markUnknown(scope, record.id, 'LATE_RESERVATION')).catch(() => {}); } else usageId = record.id; return record; })); usageId = usage.id;
      await life.wait(() => this.ports.audit.append({ callId: request.callId, tenantId: context.tenantId, workspaceId: context.workspaceId, event: 'ai.invoke.admitted', status: 'accepted' }));
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      dispatched = true;
      const result = structuredClone(await life.wait(() => this.ports.transport.invoke(structuredClone(context), structuredClone(request), structuredClone(route), life.controller.signal)));
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      const reported = result.usage;
      if (reported) { await life.wait(() => this.ports.usage.settle(admission.scope, usage.id, `invoke:${request.callId}`, reported.inputTokens, reported.outputTokens)); accounted = true; }
      else { await life.wait(() => this.ports.usage.markUnknown(admission.scope, usage.id, 'USAGE_UNAVAILABLE')); accounted = true; }
      await life.wait(() => this.ports.dispatch.finish(structuredClone(binding!), 'completed'));
      settled = true;
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      return { ...result, usageState: result.usage ? 'reported' : 'reconciliation_required' };
    } catch (error) {
      const failure = error instanceof ModelGatewayError ? error : new ModelGatewayError(life.reason() ?? 'PROVIDER_FAILED');
      const terminalCommitted = settled;
      closed = true;
      settled = true;
      if (usageId && !accounted) { const pendingId = usageId; try { await life.cleanup(() => this.ports.usage.markUnknown(scope, pendingId, dispatched ? 'DISPATCH_UNKNOWN' : 'DISPATCH_NOT_STARTED')); accounted = true; } catch { /* durable reconciliation remains pending */ } }
      if (admissionId && !terminalCommitted) { try { await life.cleanup(() => this.ports.dispatch.finish(structuredClone(binding!), dispatched ? 'unknown' : 'cancelled')); } catch { /* durable state is authoritative */ } }
      throw failure;
    } finally {
      closed = true;
      life.close();
      if (!settled && (usageId || admissionId)) {
        if (usageId && !accounted) { const pendingId = usageId; try { await life.cleanup(() => this.ports.usage.markUnknown(scope, pendingId, 'DISPATCH_UNKNOWN')); } catch { /* durable reconciliation remains pending */ } }
        if (admissionId) { try { await life.cleanup(() => this.ports.dispatch.finish(structuredClone(binding!), dispatched ? 'unknown' : 'cancelled')); } catch { /* durable state is authoritative */ } }
      }
    }
  }

  async *stream(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): AsyncGenerator<GatewayStreamEvent> {
    if (signal?.aborted) throw new ModelGatewayError('CANCELLED');
    request = this.input(request); context = structuredClone(context);
    const life = this.deadline(signal);
    let scope!: AiProfileScope;
    let binding: AiDispatchBinding | undefined;
    let admissionId: string | undefined, usageId: string | undefined, dispatched = false, accounted = false, settled = false, closed = false;
    let iterator: AsyncIterator<GatewayStreamEvent> | undefined;
    let sourceDone = false;
    let finalResult: GatewayInvocationResult | undefined;
    try {
      const resolution = structuredClone(await life.wait(() => this.ports.routing.resolve(context, this.required(request, true))));
      const route = resolution.route; scope = resolution.consumerScope;
      request = this.input({ ...request, model: route.profile.model });
      const hash = requestFingerprint({ request, routing: gatewayRoutingBinding(resolution) });
      if (!this.ports.dispatch || typeof this.ports.dispatch.claim !== 'function' || typeof this.ports.dispatch.finish !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
      // An admission may be shared by concurrent attempts. Only a successful claim owns cleanup.
      const admission = await life.wait(() => this.ports.admission.admit({ scope: structuredClone(scope), actorId: context.actorId, callId: request.callId, requestHash: hash, profileId: route.profile.id, expiresAt: life.expiresAt }));
      binding = { scope: structuredClone(scope) as AiDispatchBinding['scope'], id: admission.id, actorId: context.actorId,
        callId: request.callId, requestHash: hash, profileId: route.profile.id, dispatchId: randomUUID() };
      const token = structuredClone(binding);
      await life.wait(() => this.ports.dispatch.claim(structuredClone(token)).then(() => {
        if (closed) { void life.cleanup(() => this.ports.dispatch.finish(structuredClone(token), 'cancelled')).catch(() => {}); }
        else admissionId = admission.id;
      }));
      const usage = await life.wait(() => this.ports.usage.reserve({ scope: admission.scope, callId: request.callId, idempotencyKey: request.callId, reservedUnits: request.maxOutputTokens, expiresAt: life.expiresAt }).then(record => { if (closed) { void life.cleanup(() => this.ports.usage.markUnknown(scope, record.id, 'LATE_RESERVATION')).catch(() => {}); } else usageId = record.id; return record; })); usageId = usage.id;
      await life.wait(() => this.ports.audit.append({ callId: request.callId, tenantId: context.tenantId, workspaceId: context.workspaceId, event: 'ai.stream.admitted', status: 'accepted' }));
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      dispatched = true;
      let result: GatewayInvocationResult | undefined;
      iterator = this.ports.transport.stream(structuredClone(context), structuredClone(request), structuredClone(route), life.controller.signal)[Symbol.asyncIterator]();
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
          const delta = event.delta;
          await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
          yield { kind: 'text_delta', delta };
        } else throw new ModelGatewayError('INVALID_RESPONSE');
      }
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      if (!result) throw new ModelGatewayError('PROVIDER_FAILED');
      const reported = result.usage;
      if (reported) { await life.wait(() => this.ports.usage.settle(admission.scope, usage.id, `stream:${request.callId}`, reported.inputTokens, reported.outputTokens)); accounted = true; }
      else { await life.wait(() => this.ports.usage.markUnknown(admission.scope, usage.id, 'USAGE_UNAVAILABLE')); accounted = true; }
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      await life.wait(() => this.ports.dispatch.finish(structuredClone(binding!), 'completed'));
      settled = true;
      await life.wait(() => this.ports.routing.assertCurrent(context, structuredClone(resolution)));
      if (life.controller.signal.aborted) throw new ModelGatewayError(life.reason() ?? 'CANCELLED');
      finalResult = result;
    } catch (error) {
      const failure = error instanceof ModelGatewayError ? error : new ModelGatewayError(life.reason() ?? 'PROVIDER_FAILED');
      const terminalCommitted = settled;
      closed = true;
      settled = true;
      if (usageId && !accounted) { const pendingId = usageId; try { await life.cleanup(() => this.ports.usage.markUnknown(scope, pendingId, dispatched ? 'DISPATCH_UNKNOWN' : 'DISPATCH_NOT_STARTED')); accounted = true; } catch { /* durable reconciliation remains pending */ } }
      if (admissionId && !terminalCommitted) { try { await life.cleanup(() => this.ports.dispatch.finish(structuredClone(binding!), dispatched ? 'unknown' : 'cancelled')); } catch { /* durable state is authoritative */ } }
      throw failure;
    } finally {
      life.controller.abort();
      closed = true;
      life.close();
      if (!settled) {
        if (usageId && !accounted) { const pendingId = usageId; try { await life.cleanup(() => this.ports.usage.markUnknown(scope, pendingId, 'CONSUMER_STOPPED')); } catch { /* durable reconciliation remains pending */ } }
        if (admissionId) { try { await life.cleanup(() => this.ports.dispatch.finish(structuredClone(binding!), dispatched ? 'unknown' : 'cancelled')); } catch { /* durable state is authoritative */ } }
      }
      if (iterator?.return && !sourceDone) {
        try { await life.cleanup(() => iterator!.return!()); } catch { /* bounded abandonment; durable state remains pending */ }
      }
    }
    if (!finalResult) throw new ModelGatewayError('INVALID_RESPONSE');
    yield { kind: 'result', result: finalResult };
  }
}
