import { z } from 'zod';
import type { AiOpeningReadFactsService, AiRiskReadFactsService, AiDiagnosticReadAuthority } from './diagnostic-read-facts.service';
import { aiRiskReadInputSchema } from './diagnostic-read-facts.service';
import type { AiQuoteCoreContextSource } from '../quote-preview.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { sealBusinessScenario } from './business-scenario-input';

const inputSchema = z.object({ risks: aiRiskReadInputSchema.optional() }).strict();
const terminologyFields = ['itemLabel', 'itemGroupLabel', 'assetLabel', 'fulfillmentLabel', 'pickupLabel', 'returnLabel'] as const;
const differenceSchema = z.object({ expectedVersion: z.string().min(1).max(191),
  changes: z.array(z.object({ field: z.enum(terminologyFields), value: z.string().trim().min(1).max(80) }).strict()).min(1).max(6)
}).strict();
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
      const facts = await this.opening.read({ limit: 50 }, authorized);
      if (requestFingerprint(facts.scope) !== requestFingerprint(scope)) throw new ModelGatewayError('FORBIDDEN');
      let risk: Awaited<ReturnType<AiRiskReadFactsService['read']>> | undefined;
      if (input.data.risks) { try { risk = await this.risks.read(input.data.risks, authorized); } catch { /* Optional report unavailable without details. */ } }
      if (risk && requestFingerprint(risk.scope) !== requestFingerprint(scope)) throw new ModelGatewayError('FORBIDDEN');
      const after = await this.contexts.current(scope);
      if (requestFingerprint(before) !== requestFingerprint(after)) throw new ModelGatewayError('CONFIG_INVALID');
      const source = { scope, resourceType: 'business_configuration' as const,
        version: before.settings.configVersion, observedAt: facts.observedAt };
      // Only operational, non-secret fields from the original settings/catalog
      // sources. Config inventory modes are not physical stock balances.
      const configuration = {
        products: { source, rows: before.groups.slice(0, 100).map(row => ({ id: row.id, code: row.code,
          status: row.status, inventoryMode: row.inventoryMode, unit: row.unit })), truncated: before.groups.length > 100 },
        pricing: { source, currency: before.settings.pricing.currency, enabledUnits: [...before.settings.pricing.enabledUnits],
          groups: (before.pricingGroups ?? []).slice(0, 100).map(row => ({ id: row.id, code: row.code,
            status: row.status, version: row.version })), truncated: (before.pricingGroups?.length ?? 0) > 100,
          rates: 'not_projected' as const },
        fulfillment: { source, enabledModes: [...before.settings.fulfillment.enabledModes],
          locations: before.locations.slice(0, 100).map(row => ({ id: row.id, code: row.code,
            status: row.status, capabilities: [...row.capabilities] })), truncated: before.locations.length > 100 },
        inventory: { source, coverage: 'not_loaded' as const, meaning: 'item_modes_are_not_stock_balances' as const }
      };
      return { requestId: authorized.requestId, audience: authorized.audience, scope, observedAt: facts.observedAt,
        configVersion: before.settings.configVersion, ready: facts.ready,
        configuration,
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

  /** Re-evaluate an existing readiness key using current protected sources.
   * A vanished check is unknown, not proof the reported problem was fixed. */
  async recheck(value: unknown) {
    const parsed = z.object({ key: z.string().min(1).max(191) }).strict().safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const current = await this.read();
    const section = current.sections.find(row => row.key === parsed.data.key);
    return { scope: current.scope, observedAt: current.observedAt, configVersion: current.configVersion,
      key: parsed.data.key, status: section?.status === 'readiness_check_passed' ? 'resolved' as const
        : section && ['missing_configuration', 'readiness_unsatisfied'].includes(section.status) ? 'still_exists' as const
        : 'cannot_determine' as const,
      evidence: section?.evidence, current: section,
      meaning: 'current_readiness_only_not_external_verification_or_publication' as const };
  }

  /** The report port currently exposes an aggregate, not a stable risk
   * resource lookup. Do not infer resolution from a missing list row; keep the
   * requested item unavailable until the mainline exposes an authorized,
   * scope-bound risk-id reader. */
  async recheckRisk(value: unknown) {
    const parsed = z.object({ riskId: z.string().min(1).max(191), from: z.string().datetime({ offset: true }),
      to: z.string().datetime({ offset: true }), locationId: z.string().min(1).max(191).optional() }).strict().safeParse(value);
    if (!parsed.success || Date.parse(parsed.data.to) <= Date.parse(parsed.data.from)) throw new ModelGatewayError('INVALID_REQUEST');
    return { status: 'unavailable' as const, riskId: parsed.data.riskId,
      nextAction: 'reconcile' as const, retryable: false as const,
      reason: 'authorized_single_risk_reader_not_exposed_by_report_port' as const,
      aggregateReadCannotProveResolution: true as const, query: { from: parsed.data.from, to: parsed.data.to,
        locationId: parsed.data.locationId }, sideEffects: 'not_attempted' as const };
  }

  /** Ordinary display terminology only, already present in the formal
   * SaveTenantRentalProfileRequest. No category/capability/key mutation. */
  async prepareDifference(value: unknown) {
    const parsed = differenceSchema.safeParse(value);
    if (!parsed.success || new Set(parsed.data.changes.map(row => row.field)).size !== parsed.data.changes.length) throw new ModelGatewayError('INVALID_REQUEST');
    const requested = structuredClone(parsed.data);
    return this.authority.withRead('opening', { limit: 50 }, async context => {
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const before = structuredClone(await this.contexts.current(context.scope));
      if (before.profile.configVersion !== requested.expectedVersion) throw new ModelGatewayError('CONFIG_INVALID');
      const changes = requested.changes.map(row => ({ field: `terminology.${row.field}`, before: before.profile.terminology[row.field],
        after: row.value, source: { scope: context.scope, resourceType: 'tenant_profile' as const,
          version: before.profile.configVersion, observedAt: context.authorizedAt },
        impact: 'display_terminology_only_not_business_rules' as const }));
      if (requestFingerprint(before) !== requestFingerprint(await this.contexts.current(context.scope))) throw new ModelGatewayError('CONFIG_INVALID');
      return { status: 'candidate_only' as const, scope: context.scope, currentVersion: before.profile.configVersion,
        changes, persistence: 'not_attempted_no_verified_proposal_port' as const,
        publication: 'not_attempted' as const, authorization: 'write_requires_original_permissions_and_approval' as const };
    });
  }

  async requiredMaterials() {
    const current = await this.read();
    return { scope: current.scope, observedAt: current.observedAt, configVersion: current.configVersion,
      rows: current.sections.filter(row => row.required && row.status !== 'readiness_check_passed').map(row => ({
        key: row.key, issue: row.issue, status: row.status, evidence: row.evidence, manual: row.manual,
        fieldsToReview: row.candidate.fieldsToReview,
        materialDefinition: 'not_loaded_use_original_form' as const,
        sensitiveValues: 'not_requested_or_returned' as const })),
      meaning: 'readiness_blockers_not_invented_document_requirements' as const };
  }

  async prepare(value: unknown = {}, modelAvailability: 'not_requested' | 'unavailable' = 'not_requested') {
    if (!['not_requested', 'unavailable'].includes(modelAvailability)) throw new ModelGatewayError('INVALID_REQUEST');
    const facts = await this.read(value);
    return sealBusinessScenario('opening_diagnosis', { scope: facts.scope, audience: facts.audience,
      status: 'facts_only' as const, observedAt: facts.observedAt, configVersion: facts.configVersion,
      facts, model: { status: modelAvailability, answer: 'not_generated' as const },
      gaps: ['external_verification', 'formal_draft_persistence', 'physical_inventory_not_loaded'],
      execution: 'not_attempted' as const });
  }
}
