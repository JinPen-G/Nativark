import { z } from 'zod';
import type { AiMembershipCandidateReadFactsService } from '../membership-candidate-read-facts.service';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import { ModelGatewayError } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const input = z.object({ customerId: z.string().min(1).max(191), expectedName: z.string().min(1).max(191),
  // Keep the existing wire bound and the original SavePersonalMembershipDto's
  // 120-character name limit; do not produce an unsavable ordinary-field draft.
  name: z.string().trim().min(1).max(191).refine(value => Array.from(value).length <= 120) }).strict();

/** Only `name` is visible through the authorized member projection here.
 * Exact target reads retain the original tenant/member visibility predicates.
 * The existing full-profile save is not a partial patch (omitted email can
 * clear it), so this source supplies no write port or CAS/approval attestation. */
export class AiMemberProfileDifferenceService {
  constructor(private readonly members: Pick<AiMembershipCandidateReadFactsService, 'read'>,
    private readonly authority: AiBusinessReadAuthority) {}
  async prepare(value: unknown) {
    const parsed = input.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const requested = structuredClone(parsed.data);
    const target = { limit: 1, customerId: requested.customerId };
    return this.authority.withRead('membership_candidates', target, async context => {
      const before = await this.members.read(target, context);
      const member = before.candidates.find(row => row.customerId === requested.customerId);
      if (!member) throw new ModelGatewayError('FORBIDDEN');
      const after = await this.members.read(target, context);
      const current = after.candidates.find(row => row.customerId === requested.customerId);
      // A target disappearing from the authorized projection is not a stale
      // editable draft. Do not return its old name after visibility withdrawal.
      if (!current) throw new ModelGatewayError('FORBIDDEN');
      const changedDuringRead = requestFingerprint(before.candidates) !== requestFingerprint(after.candidates);
      if (changedDuringRead || member.name !== requested.expectedName) {
        // Only the current visible ordinary field is available here, not a
        // formal object revision. Withhold proposed fields until a person reads
        // the refreshed difference; this neither attests CAS nor saves a draft.
        return { status: 'revision_conflict' as const, scope: after.scope, observedAt: after.observedAt,
          customerId: current.customerId, currentName: current.name, revision: 'not_loaded' as const,
          reason: changedDuringRead ? 'member_projection_changed_during_read' as const : 'expected_name_mismatch' as const,
          comparisonFingerprint: requestFingerprint({ customerId: current.customerId, name: current.name }),
          comparisonBasis: 'name_only_not_object_revision' as const,
          sharing: 'tenant_member_master_not_workspace_order_access' as const,
          nextAction: 'refresh_difference_and_reconfirm' as const, persistence: 'not_attempted' as const,
          approval: 'not_created' as const, businessUpdate: 'not_attempted' as const, writeAuthorization: 'not_granted' as const };
      }
      // Equal requested/current names close only this read-only difference.
      // Keep both protected reads and the conflict checks above: a stale expected
      // value or a name matching only the closing read is not no-change evidence.
      // This is neither a saved proposal nor a successful Core write/CAS receipt.
      if (requested.name === current.name) {
        return { status: 'no_change' as const, scope: after.scope, observedAt: after.observedAt,
          customerId: current.customerId, currentName: current.name, changes: [], revision: 'not_loaded' as const,
          comparisonFingerprint: requestFingerprint({ customerId: current.customerId, name: current.name }),
          comparisonBasis: 'name_only_not_object_revision' as const,
          source: { resourceType: 'membership_candidate' as const, resourceId: current.customerId, observedAt: after.observedAt },
          sharing: 'tenant_member_master_not_workspace_order_access' as const,
          persistence: 'not_attempted' as const, approval: 'not_created' as const,
          businessUpdate: 'not_attempted' as const, writeAuthorization: 'not_granted' as const };
      }
      // Publish the same checked closing observation as conflict/no-change.
      // It is current name evidence, never an object revision or write grant.
      return { status: 'candidate_only' as const, scope: after.scope, observedAt: after.observedAt,
        customerId: current.customerId, revision: 'not_loaded' as const,
        comparisonFingerprint: requestFingerprint({ customerId: current.customerId, name: current.name }),
        changes: [{ field: 'name' as const, before: current.name, after: requested.name,
          source: { resourceType: 'membership_candidate' as const, resourceId: current.customerId, observedAt: after.observedAt } }],
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
