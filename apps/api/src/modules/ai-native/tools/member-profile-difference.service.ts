import { z } from 'zod';
import type { AiMembershipCandidateReadFactsService } from '../membership-candidate-read-facts.service';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import { ModelGatewayError } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const input = z.object({ customerId: z.string().min(1).max(191), expectedName: z.string().min(1).max(191),
  name: z.string().trim().min(1).max(191) }).strict();

/** Only `name` is both an existing ordinary profile field and visible through
 * the authorized member projection. Email/phone/identity/status are not read
 * here; read permission never grants profile-write permission. */
export class AiMemberProfileDifferenceService {
  constructor(private readonly members: Pick<AiMembershipCandidateReadFactsService, 'read'>,
    private readonly authority: AiBusinessReadAuthority) {}
  async prepare(value: unknown) {
    const parsed = input.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const requested = structuredClone(parsed.data);
    return this.authority.withRead('membership_candidates', { limit: 50 }, async context => {
      const before = await this.members.read({ limit: 50 }, context);
      const member = before.candidates.find(row => row.customerId === requested.customerId);
      if (!member) throw new ModelGatewayError('FORBIDDEN');
      if (member.name !== requested.expectedName) throw new ModelGatewayError('CONFIG_INVALID');
      const after = await this.members.read({ limit: 50 }, context);
      if (requestFingerprint(before.candidates) !== requestFingerprint(after.candidates)) throw new ModelGatewayError('CONFIG_INVALID');
      return { status: 'candidate_only' as const, scope: before.scope, observedAt: before.observedAt,
        customerId: member.customerId, revision: 'not_loaded' as const,
        comparisonFingerprint: requestFingerprint({ customerId: member.customerId, name: member.name }),
        changes: [{ field: 'name' as const, before: member.name, after: requested.name,
          source: { resourceType: 'membership_candidate' as const, resourceId: member.customerId, observedAt: before.observedAt } }],
        sharing: 'tenant_member_master_not_workspace_order_access' as const,
        sensitiveFields: 'use_original_verification_flow' as const,
        persistence: 'not_attempted_no_verified_proposal_port' as const,
        writeAuthorization: 'not_granted' as const };
    });
  }

  async submissionMaterial(value: unknown) {
    const candidate = await this.prepare(value);
    if (candidate.status !== 'candidate_only') return candidate;
    return { status: 'prepared_not_submitted' as const, target: { scope: candidate.scope, customerId: candidate.customerId },
      fields: candidate.changes, sources: candidate.changes.map(row => row.source), objectVersion: candidate.revision,
      persistence: 'not_attempted_no_formal_profile_proposal_port' as const,
      approval: 'not_created' as const, businessUpdate: 'not_attempted' as const };
  }
}
