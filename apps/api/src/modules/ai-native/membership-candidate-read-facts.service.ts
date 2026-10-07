import { z } from 'zod';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext, type BookingMemberOption } from '@rental-os/shared';
import { ModelGatewayError } from './model-gateway.ports';
import type { AiBusinessReadAuthority } from './business-read-route.authority';

export const aiMembershipCandidateReadInputSchema = z.object({
  limit: z.number().int().min(1).max(50),
  customerId: z.string().min(1).max(191).optional(),
  name: z.string().trim().min(1).max(191).optional(),
  cursor: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional()
}).strict();
const candidateSchema = z.object({
  customerId: z.string().min(1).max(191), name: z.string().min(1).max(191), phoneMasked: z.string().max(64).refine(value => value === '' || (!/\s/u.test(value) && /^[0-9]{0,3}\*{3,}[0-9]{0,4}$/u.test(value))),
  membershipStatus: z.enum(['pending_activation', 'active', 'suspended', 'risk_restricted', 'exited', 'closed'])
}).strict();

export type AiMembershipCandidateReadAuthority = AiBusinessReadAuthority;
export interface AiMembershipCandidateReadPort {
  listPersonalOptions(tenantId: string): Promise<readonly BookingMemberOption[]>;
  listPersonalOptionsPage?(tenantId: string, input: { limit: number; cursor?: string; name?: string; customerId?: string }): Promise<{
    rows: readonly BookingMemberOption[]; nextCursor?: string; truncated: boolean
  }>;
}
export interface AiMembershipCandidateReadProjection {
  contractVersion: typeof AI_CONTRACT_DRAFT_VERSION;
  requestId: string;
  audience: 'operator' | 'staff';
  scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>;
  observedAt: string;
  truncated: boolean;
  nextCursor?: string;
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

  async read(value: unknown, expectedContext?: AiExecutionContext): Promise<AiMembershipCandidateReadProjection> {
    const input = aiMembershipCandidateReadInputSchema.safeParse(value); if (!input.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.authority.withRead('membership_candidates', input.data, async context => {
    assertAiReadContextBinding(context, expectedContext);
    const access = 'access' in context ? context.access : undefined;
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || (context.audience !== 'operator' && context.audience !== 'staff')
      || !access?.permissions.includes('rental-os:order:create')) throw new ModelGatewayError('FORBIDDEN');
    const workspace = context.scope;
    let rows: readonly BookingMemberOption[], truncated = false, nextCursor: string | undefined;
    if (!this.memberships.listPersonalOptionsPage && (input.data.customerId || input.data.name || input.data.cursor)) {
      throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    }
    try {
      if (typeof this.memberships.listPersonalOptionsPage === 'function') {
        const page = await this.memberships.listPersonalOptionsPage(workspace.tenantId, input.data);
        rows = page.rows; truncated = page.truncated; nextCursor = page.nextCursor;
      } else rows = await this.memberships.listPersonalOptions(workspace.tenantId);
    } catch { throw new ModelGatewayError('PROVIDER_UNAVAILABLE'); }
    if (!Array.isArray(rows) || rows.length > input.data.limit || typeof truncated !== 'boolean') throw new ModelGatewayError('INVALID_RESPONSE');
    if (nextCursor !== undefined && (!truncated || !z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).safeParse(nextCursor).success)) throw new ModelGatewayError('INVALID_RESPONSE');
    if (input.data.customerId && rows.some(row => row.customerId !== input.data.customerId)) throw new ModelGatewayError('INVALID_RESPONSE');
    const parsed = rows.map(row => candidateSchema.safeParse(row));
    if (parsed.some(item => !item.success)) throw new ModelGatewayError('INVALID_RESPONSE');
    const customerIds = parsed.map(item => item.data!.customerId);
    if (new Set(customerIds).size !== customerIds.length) throw new ModelGatewayError('INVALID_RESPONSE');
    const observed = this.clock(); if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
    return {
      contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: context.requestId, audience: context.audience,
      scope: workspace, observedAt: observed.toISOString(), candidates: parsed.map(item => item.data!), truncated, ...(nextCursor ? { nextCursor } : {})
    };
    });
  }
}
