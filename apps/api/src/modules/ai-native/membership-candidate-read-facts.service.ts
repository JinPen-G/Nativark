import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext, type BookingMemberOption } from '@rental-os/shared';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiBusinessReadAuthority } from './business-read-route.authority';

export const aiMembershipCandidateReadInputSchema = z.object({ limit: z.number().int().min(1).max(50) }).strict();
const candidateSchema = z.object({
  customerId: z.string().min(1).max(191), name: z.string().min(1).max(191), phoneMasked: z.string().max(64).refine(value => value === '' || (!/\s/u.test(value) && /^[0-9]{0,3}\*{3,}[0-9]{0,4}$/u.test(value))),
  membershipStatus: z.enum(['pending_activation', 'active', 'suspended', 'risk_restricted', 'exited', 'closed'])
}).strict();

export type AiMembershipCandidateReadAuthority = AiBusinessReadAuthority;
export interface AiMembershipCandidateReadPort { listPersonalOptions(tenantId: string): Promise<readonly BookingMemberOption[]>; }
export interface AiMembershipCandidateReadProjection {
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION;
  requestId: string;
  audience: 'operator' | 'staff';
  scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>;
  observedAt: string;
  candidates: Array<Pick<BookingMemberOption, 'customerId' | 'name' | 'phoneMasked' | 'membershipStatus'>>;
}

/**
 * Bounded candidate projection only. It never chooses a customer, resolves booking
 * eligibility, creates a quote/order, or exposes unmasked contact data.
 */
export class AiMembershipCandidateReadFactsService {
  constructor(private readonly memberships: AiMembershipCandidateReadPort,
    private readonly authority: AiMembershipCandidateReadAuthority,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof memberships?.listPersonalOptions !== 'function' || typeof authority?.withRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }

  async read(value: unknown): Promise<AiMembershipCandidateReadProjection> {
    const input = aiMembershipCandidateReadInputSchema.safeParse(value); if (!input.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.authority.withRead('membership_candidates', input.data, async context => {
    const access = 'access' in context ? context.access : undefined;
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || (context.audience !== 'operator' && context.audience !== 'staff')
      || !access?.permissions.includes('rental-os:order:create')) throw new ModelGatewayError('FORBIDDEN');
    const workspace = context.scope;
    let rows: readonly BookingMemberOption[];
    try { rows = await this.memberships.listPersonalOptions(workspace.tenantId); } catch { throw new ModelGatewayError('PROVIDER_UNAVAILABLE'); }
    if (!Array.isArray(rows) || rows.length > input.data.limit) throw new ModelGatewayError('INVALID_RESPONSE');
    const parsed = rows.map(row => candidateSchema.safeParse(row));
    if (parsed.some(item => !item.success)) throw new ModelGatewayError('INVALID_RESPONSE');
    const customerIds = parsed.map(item => item.data!.customerId);
    if (new Set(customerIds).size !== customerIds.length) throw new ModelGatewayError('INVALID_RESPONSE');
    const observed = this.clock(); if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
    return {
      contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: context.requestId, audience: context.audience,
      scope: workspace, observedAt: observed.toISOString(), candidates: parsed.map(item => item.data!)
    };
    });
  }
}
