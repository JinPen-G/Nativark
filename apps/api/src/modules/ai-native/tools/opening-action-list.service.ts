import { z } from 'zod';
import type { AiOpeningReadFactsService, AiRiskReadFactsService, AiDiagnosticReadAuthority } from './diagnostic-read-facts.service';
import { aiRiskReadInputSchema } from './diagnostic-read-facts.service';
import type { AiQuoteCoreContextSource } from '../quote-preview.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';

const inputSchema = z.object({ risks: aiRiskReadInputSchema.optional() }).strict();
// Only section identifiers already returned by tenantReadiness. Not routes,
// proposal fields or invented checks; unknown new keys stay unclassified.
const sections: Readonly<Record<string, readonly string[]>> = {
  workspace_profile: ['profile.categoryCode'], accounts_roles: [], fulfillment_network: ['locations'],
  business_rule: ['ruleVersions'], business_calendar: ['calendars'], item_groups: ['itemGroups'],
  pricing_groups_rates: ['pricingGroups'], price_version: [], membership_base: []
};

export class AiOpeningActionListService {
  constructor(private readonly opening: Pick<AiOpeningReadFactsService, 'read'>,
    private readonly risks: Pick<AiRiskReadFactsService, 'read'>,
    private readonly contexts: AiQuoteCoreContextSource, private readonly authority: AiDiagnosticReadAuthority) {}
  async read(value: unknown = {}) {
    const input = inputSchema.safeParse(value);
    if (!input.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.authority.withRead('opening', { limit: 50 }, async authorized => {
      if (authorized.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const scope = structuredClone(authorized.scope);
      const before = structuredClone(await this.contexts.current(scope));
      const facts = await this.opening.read({ limit: 50 });
      if (requestFingerprint(facts.scope) !== requestFingerprint(scope)) throw new ModelGatewayError('FORBIDDEN');
      let risk: Awaited<ReturnType<AiRiskReadFactsService['read']>> | undefined;
      if (input.data.risks) { try { risk = await this.risks.read(input.data.risks); } catch { /* Optional report unavailable without details. */ } }
      if (risk && requestFingerprint(risk.scope) !== requestFingerprint(scope)) throw new ModelGatewayError('FORBIDDEN');
      const after = await this.contexts.current(scope);
      if (requestFingerprint(before) !== requestFingerprint(after)) throw new ModelGatewayError('CONFIG_INVALID');
      return { requestId: authorized.requestId, audience: authorized.audience, scope, observedAt: facts.observedAt,
        configVersion: before.settings.configVersion, ready: facts.ready,
        atomicity: 'independent_sections_not_a_transaction' as const,
        sections: facts.items.map(row => ({ key: row.key, title: row.title, required: !row.optional,
          status: row.status === 'unavailable' ? 'source_unavailable' as const
            : row.status === 'ready' ? 'readiness_check_passed' as const
            : row.key === 'item_groups' && !before.groups.some(group => group.status === 'enabled') ? 'missing_configuration' as const
            : row.key === 'fulfillment_network' && !before.locations.some(location => location.status === 'enabled') ? 'missing_configuration' as const
            : Object.prototype.hasOwnProperty.call(sections, row.key) ? 'readiness_unsatisfied' as const : 'unclassified' as const,
          issue: row.status === 'ready' ? undefined : row.missing,
          impact: row.optional ? 'optional_configuration' as const : 'required_readiness_item' as const,
          evidence: { scope, resourceType: 'readiness_item' as const, resourceId: row.key,
            version: before.settings.configVersion, observedAt: facts.observedAt },
          manual: Object.prototype.hasOwnProperty.call(sections, row.key)
            ? { kind: 'configuration_section' as const, section: row.key, scope, navigation: 'host_existing_section' as const }
            : { status: 'unavailable' as const },
          candidate: { status: 'candidate_only' as const, currentVersion: before.settings.configVersion,
            fieldsToReview: [...(sections[row.key] ?? [])], proposedChanges: [],
            persistence: 'unavailable_no_formal_draft_port' as const },
          // Readiness cannot prove external credentials, live probes or publish.
          externalVerification: 'not_loaded' as const,
          unresolvedClassification: ['missing_configuration', 'configured_unverified', 'formal_check_failed', 'not_implemented', 'external_credentials_pending', 'owner_decision_pending'] as const
        })),
        risks: risk ? { coverage: 'partial' as const, value: risk }
          : { coverage: input.data.risks ? 'unavailable' as const : 'not_loaded' as const }
      };
    });
  }
}
