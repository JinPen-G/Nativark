import { z } from 'zod';
import { assertAiReadContextBinding } from './tools/read-context-binding';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext, type BookingMemberOption, type CustomerMembershipBookingOption } from '@rental-os/shared';
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
  listBookingOptionsPage?(tenantId: string, workspaceId: string, customerId: string, input: { limit: number; cursor?: string }): Promise<{
    rows: readonly CustomerMembershipBookingOption[]; nextCursor?: string; truncated: boolean
  }>;
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

  /** Original booking-member endpoint, not a corporate directory or proof of
   * order eligibility. Server identity/visibility and relationship queries stay
   * in Guard/ALS and MembershipService; this method never selects a relation. */
  async readBookingOptions(value: unknown, expectedContext?: AiExecutionContext) {
    const resourceId = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
    const parsed = z.object({ customerId: resourceId, limit: z.number().int().min(1).max(50), cursor: resourceId.optional() }).strict().safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = structuredClone(parsed.data);
    return this.authority.withRead('booking_identity_options', { customerId: input.customerId }, async context => {
      assertAiReadContextBinding(context, expectedContext);
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
        || !('access' in context) || !context.access.permissions.includes('rental-os:order:create')) throw new ModelGatewayError('FORBIDDEN');
      if (typeof this.memberships.listBookingOptionsPage !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      const page = await this.memberships.listBookingOptionsPage(context.scope.tenantId, context.scope.workspaceId,
        input.customerId, { limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) });
      const option = z.object({ corporateCustomerId: resourceId, corporateCustomerName: z.string().min(1).max(191),
        corporateMembershipId: resourceId, role: z.enum(['admin', 'employee']), effectiveTo: z.string().datetime({ offset: true }).optional() }).strict();
      const rows = z.array(option).max(input.limit).safeParse(page?.rows);
      if (!rows.success || typeof page.truncated !== 'boolean'
        || new Set(rows.data.map(row => row.corporateMembershipId)).size !== rows.data.length
        || (page.truncated ? rows.data.length !== input.limit || page.nextCursor !== rows.data[rows.data.length - 1]?.corporateMembershipId
          : page.nextCursor !== undefined)) throw new ModelGatewayError('INVALID_RESPONSE');
      const observed = this.clock();
      if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
      return { contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: context.requestId, scope: context.scope, audience: context.audience,
        customerId: input.customerId, observedAt: observed.toISOString(), options: rows.data, truncated: page.truncated,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        selection: 'explicit_human_choice_required' as const, qualification: 'not_evaluated' as const,
        execution: 'not_attempted' as const, source: { resourceType: 'booking_member' as const, resourceId: input.customerId } };
    });
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
