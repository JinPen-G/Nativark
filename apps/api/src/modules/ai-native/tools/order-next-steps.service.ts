import { AI_TOOL_BASELINE } from '../tool-baseline';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiOrderExplanationFactsService } from './order-explanation-facts.service';
import { ModelGatewayError } from '../model-gateway.ports';
import type { AiExecutionContext } from '@rental-os/shared';
import { AiOrderNextStepsCurrentSource } from './order-next-steps-current.source';

/** Inventory-backed candidates, NOT Core's allowed-actions query. No inferred
 * transition eligibility or executable callback is returned. */
export class AiOrderNextStepsService {
  private readonly current: AiOrderNextStepsCurrentSource;
  constructor(authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    facts: Pick<AiOrderExplanationFactsService, 'read'>) {
    this.current = new AiOrderNextStepsCurrentSource(authority, facts);
  }
  async read(expectedContext?: AiExecutionContext) {
    return this.current.withCurrent(expectedContext, (context, evidence) => {
      const orderId = evidence.orderId;
      // This explanation instance proves only its actual R0 reader. A directory
      // entry cannot prove this order's change/quote/commit capability or grant.
      const verifiedCodes = ['rental.order.explain'];
      // The exact reader has just succeeded under the original Guard. Its
      // documented permission list must not replace a real tenant-admin grant.
      const candidates = AI_TOOL_BASELINE.filter(tool => verifiedCodes.includes(tool.code)
        && tool.businessMaturity === 'implemented' && tool.risk === 'R0'
        && tool.entry?.method === 'GET' && tool.entry.path === '/rental/v1/orders/:id'
        && tool.entry.controllerMethod === 'order')
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
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as Record<string, unknown>).code !== 'string'
      || Object.keys(value).some(key => key !== 'code') || (value as { code: string }).code.length > 191) {
      throw new ModelGatewayError('INVALID_REQUEST');
    }
    // The original guarded read may yield. Retain the requested scalar before
    // it waits; a changed caller object is not a new handoff request or grant.
    const code = (value as Record<string, unknown>).code as string;
    const result = await this.read(expectedContext);
    const candidate = result.candidates.find(row => row.code === code);
    if (!candidate) return { status: 'unavailable' as const, reason: 'candidate_not_currently_verified' as const,
      execution: 'not_attempted' as const };
    return { status: 'manual_review' as const, candidate: structuredClone(candidate), manual: result.manual,
      allowedActions: result.allowedActions, execution: 'not_attempted' as const,
      destinationReauthorization: 'required' as const };
  }
}
