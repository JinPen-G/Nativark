import { AI_TOOL_BASELINE } from '../tool-baseline';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiOrderExplanationFactsService } from './order-explanation-facts.service';
import { ModelGatewayError } from '../model-gateway.ports';
import type { AiExecutionContext } from '@rental-os/shared';
import { assertAiReadContextBinding } from './read-context-binding';

/** Inventory-backed candidates, NOT Core's allowed-actions query. No inferred
 * transition eligibility or executable callback is returned. */
export class AiOrderNextStepsService {
  constructor(private readonly authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly facts: Pick<AiOrderExplanationFactsService, 'read'>) {}
  async read(expectedContext?: AiExecutionContext) {
    return this.authority.withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, expectedContext);
      const evidence = await this.facts.read(context, { history: false, payments: false });
      if (context.scope.kind !== 'workspace' || evidence.orderId !== orderId
        || evidence.scope.workspaceId !== context.scope.workspaceId || evidence.scope.tenantId !== context.scope.tenantId) throw new ModelGatewayError('FORBIDDEN');
      const permissions = 'access' in context ? context.access.permissions : [];
      const verifiedCodes = ['rental.order.explain', 'rental.quote.preview', 'rental.change.preview', 'rental.order.commit'];
      const candidates = AI_TOOL_BASELINE.filter(tool => verifiedCodes.includes(tool.code)
        && tool.businessMaturity === 'implemented' && tool.entry
        && tool.entry.permissionAnyOf.some(permission => permissions.includes(permission) || permissions.includes('*')))
        .map(tool => ({ code: tool.code, version: tool.version, risk: tool.risk, maturity: tool.aiMaturity,
          kind: tool.risk === 'R0' ? 'readonly' as const : tool.code.endsWith('.preview') ? 'preview' as const : 'confirmation_required_write' as const,
          executable: false as const, permission: 'original_route_must_revalidate' as const,
          requirements: [...tool.blockers, 'current_core_allowed_actions_source_unavailable'],
          source: { kind: 'tool_inventory' as const, code: tool.code, version: tool.version } }));
      return { requestId: context.requestId, scope: evidence.scope, orderId, observedAt: evidence.observedAt,
        status: 'candidates_only' as const, allowedActions: 'unavailable' as const, candidates,
        manual: { kind: 'order_resource' as const, scope: evidence.scope, orderId,
          navigation: 'host_existing_order_route' as const, authorization: 'destination_rechecks_permissions' as const },
        forbiddenAutomation: ['refund', 'funds_disposition', 'exception_confirmation'] as const };
    });
  }

  async manualHandoff(value: unknown, expectedContext?: AiExecutionContext) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as Record<string, unknown>).code !== 'string') {
      throw new ModelGatewayError('INVALID_REQUEST');
    }
    const result = await this.read(expectedContext);
    const code = (value as Record<string, unknown>).code as string;
    const candidate = result.candidates.find(row => row.code === code);
    if (!candidate) return { status: 'unavailable' as const, reason: 'candidate_not_currently_verified' as const,
      execution: 'not_attempted' as const };
    return { status: 'manual_review' as const, candidate: structuredClone(candidate), manual: result.manual,
      allowedActions: result.allowedActions, execution: 'not_attempted' as const,
      destinationReauthorization: 'required' as const };
  }
}
