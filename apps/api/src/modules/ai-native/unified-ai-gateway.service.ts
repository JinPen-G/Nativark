import { ModelGatewayError, type GatewayContext, type ModelRequest } from './model-gateway.ports';
import type { UnifiedGatewayPorts, GatewayInvocationResult, GatewayStreamEvent } from './unified-ai-gateway.ports';

export class UnifiedAiGatewayService {
  constructor(private readonly ports: UnifiedGatewayPorts, private readonly deadlineMs = 120_000) { if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120_000) throw new ModelGatewayError('CONFIG_INVALID'); }
  private deadline(signal?: AbortSignal) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.deadlineMs); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); return { controller, close: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } }; }
  async invoke(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): Promise<GatewayInvocationResult> {
    const life = this.deadline(signal); let admissionId: string | undefined, usageId: string | undefined, dispatched = false, accounted = false;
    try {
      const route = await this.ports.router.resolve({ consumerScope: { id: `${context.tenantId}:${context.workspaceId}`, kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId }, platformScope: { id: 'platform-default', kind: 'PLATFORM' }, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: (request.features ?? []).map(feature => feature === 'structuredOutput' ? 'structured_output' : feature === 'streaming' ? 'streaming' : 'tools') });
      const admission = await this.ports.admission.admit({ scope: { id: `${context.tenantId}:${context.workspaceId}`, kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId }, actorId: context.actorId, callId: request.callId, requestHash: JSON.stringify(request), profileId: route.profile.id, expiresAt: new Date(Date.now() + this.deadlineMs) }); admissionId = admission.id;
      const usage = await this.ports.usage.reserve({ scope: admission.scope, callId: request.callId, idempotencyKey: request.callId, reservedUnits: request.maxOutputTokens, expiresAt: new Date(Date.now() + this.deadlineMs) }); usageId = usage.id;
      await this.ports.audit.append({ callId: request.callId, tenantId: context.tenantId, workspaceId: context.workspaceId, event: 'ai.invoke.admitted', status: 'accepted' });
      dispatched = true; const result = await this.ports.transport.invoke(context, request, route, life.controller.signal);
      if (result.usage) { await this.ports.usage.settle(admission.scope, usageId, `invoke:${request.callId}`, result.usage.inputTokens, result.usage.outputTokens); accounted = true; } else { await this.ports.usage.markUnknown(admission.scope, usageId, 'USAGE_UNAVAILABLE'); }
      await this.ports.admission.transition(admission.scope, request.callId, 'admitted', 'completed');
      return { ...result, usageState: result.usage ? 'reported' : 'reconciliation_required' };
    } catch (error) {
      if (usageId && !accounted) { try { await this.ports.usage.markUnknown({ id: `${context.tenantId}:${context.workspaceId}`, kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId }, usageId, dispatched ? 'DISPATCH_UNKNOWN' : 'DISPATCH_NOT_STARTED'); } catch { /* durable reconciliation remains pending */ } }
      if (admissionId) { try { await this.ports.admission.transition({ id: `${context.tenantId}:${context.workspaceId}`, kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId }, request.callId, 'admitted', dispatched ? 'unknown' : 'cancelled', { unknownReason: dispatched ? 'DISPATCH_UNKNOWN' : null }); } catch { /* durable state is authoritative */ } }
      throw error instanceof ModelGatewayError ? error : new ModelGatewayError(life.controller.signal.aborted ? 'TIMEOUT' : 'PROVIDER_FAILED');
    } finally { life.close(); }
  }
  async *stream(context: GatewayContext, request: ModelRequest, signal?: AbortSignal): AsyncGenerator<GatewayStreamEvent> {
    const life = this.deadline(signal); try { const route = await this.ports.router.resolve({ consumerScope: { id: `${context.tenantId}:${context.workspaceId}`, kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId }, platformScope: { id: 'platform-default', kind: 'PLATFORM' }, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: ['streaming'] }); for await (const event of this.ports.transport.stream(context, request, route, life.controller.signal)) yield event; } finally { life.close(); }
  }
}
