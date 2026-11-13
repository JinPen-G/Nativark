import { z } from 'zod';
import type { AiOpeningIntegrationFactsService } from './opening-integration-facts.service';
import type { AiExecutionContext } from '@rental-os/shared';
import { assertAiReadContextBinding } from './read-context-binding';
import type { AiOpeningReadFactsService, AiRiskReadFactsService, AiDiagnosticReadAuthority } from './diagnostic-read-facts.service';
import { AiDiagnosticSourceUnavailable, aiRiskReadInputSchema } from './diagnostic-read-facts.service';
import type { AiOpeningConfigurationSource } from './opening-configuration.source';
import { RENTAL_OPENING_TERMINOLOGY_FIELDS } from '../../rental-core/rental-core-config.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { sealBusinessScenario } from './business-scenario-input';

const inputSchema = z.object({ risks: aiRiskReadInputSchema.optional() }).strict();
const terminologyFields = RENTAL_OPENING_TERMINOLOGY_FIELDS;
const differenceSchema = z.object({ expectedVersion: z.string().min(1).max(191),
  changes: z.array(z.object({ field: z.enum(terminologyFields), value: z.string().trim().min(1).max(80) }).strict()).min(1).max(6)
}).strict();
// Only genuine revision faults may become a per-section conflict. Generic
// CONFIG_INVALID (missing dependencies or corrupt configuration) stays fatal.
class OpeningSectionRevisionConflict extends ModelGatewayError {
  constructor(readonly reason: 'expected_version_mismatch' | 'configuration_changed_during_read') {
    super('CONFIG_INVALID');
  }
}
// An explicit null from the protected Core projection means this workspace's
// persisted terminology source is absent. Keep that dependency distinct from
// generic same-code failures or corrupt/missing properties; no default fallback.
class OpeningProfileSourceUnavailable extends ModelGatewayError {
  constructor() { super('PROVIDER_UNAVAILABLE'); }
}
// Only section identifiers already returned by tenantReadiness. Not routes,
// proposal fields or invented checks; unknown new keys stay unclassified.
const sections: Readonly<Record<string, readonly string[]>> = {
  workspace_profile: ['profile.categoryCode'], accounts_roles: [], fulfillment_network: ['locations'],
  business_rule: ['ruleVersions'], business_calendar: ['calendars'], item_groups: ['itemGroups'],
  pricing_groups_rates: ['pricingGroups'], price_version: [], membership_base: []
};

/** Current opening partitions and bounded candidates, not configuration writes.
 * Snapshot the expected server parent before the first Guard await; compare it
 * only after current authorization. Multi-partition preparation then retains that
 * Guard-resolved principal, never granting persistence, publication or execution. */
export class AiOpeningActionListService {
  constructor(private readonly opening: Pick<AiOpeningReadFactsService, 'read'>,
    private readonly risks: Pick<AiRiskReadFactsService, 'read'>,
    private readonly contexts: AiOpeningConfigurationSource, private readonly authority: AiDiagnosticReadAuthority,
    private readonly clock: () => Date = () => new Date(),
    private readonly integrations?: Pick<AiOpeningIntegrationFactsService, 'read'>) {}
  async read(value: unknown = {}, expectedContext?: AiExecutionContext) {
    const input = inputSchema.safeParse(value);
    if (!input.success) throw new ModelGatewayError('INVALID_REQUEST');
    const parent = expectedContext && structuredClone(expectedContext);
    return this.authority.withRead('opening', { limit: 50 }, async authorized => {
      assertAiReadContextBinding(authorized, parent);
      if (authorized.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const scope = structuredClone(authorized.scope);
      const before = structuredClone(await this.contexts.current(scope, authorized));
      let facts = await this.opening.read({ limit: 50 }, authorized);
      if (requestFingerprint(facts.scope) !== requestFingerprint(scope)) throw new ModelGatewayError('FORBIDDEN');
      let risk: Awaited<ReturnType<AiRiskReadFactsService['read']>> | undefined;
      if (input.data.risks) {
        try { risk = await this.risks.read(input.data.risks, authorized); }
        catch (error) {
          // Only provenance attached inside the original source callback may
          // authorize an unavailable optional source. Route normalization also
          // maps unknown faults to PROVIDER_UNAVAILABLE; never swallow those,
          // current-permission failures, metadata drift or damaged responses.
          if (!(error instanceof AiDiagnosticSourceUnavailable)) throw error;
        }
      }
      if (risk && requestFingerprint(risk.scope) !== requestFingerprint(scope)) throw new ModelGatewayError('FORBIDDEN');
      let integrationObservation = this.integrations ? await this.integrations.read({ limit: 32 }, authorized)
        : undefined;
      const after = await this.contexts.current(scope, authorized);
      if (requestFingerprint(before) !== requestFingerprint(after)) throw new ModelGatewayError('CONFIG_INVALID');
      // Accounts/roles and persisted readiness can change without updating the
      // opening configuration version. Reopen the same original bounded check
      // after all waits; time/request metadata and presentation order are not
      // business revisions. This remains two observations, not an atomic snapshot.
      const currentFacts = await this.opening.read({ limit: 50 }, authorized);
      if (requestFingerprint(currentFacts.scope) !== requestFingerprint(scope)) throw new ModelGatewayError('FORBIDDEN');
      const basis = (value: typeof facts) => ({ scope: value.scope, ready: value.ready,
        readinessBasis: value.readinessBasis, coverage: value.coverage,
        items: value.items.slice().sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0) });
      if (requestFingerprint(basis(facts)) !== requestFingerprint(basis(currentFacts))) throw new ModelGatewayError('CONFIG_INVALID');
      facts = currentFacts;
      if (this.integrations && integrationObservation) {
        const closing = await this.integrations.read({ limit: 32 }, authorized);
        const basis = (value: typeof closing) => {
          const copy = structuredClone(value);
          if (copy.state === 'observed') delete (copy.observation as Partial<typeof copy.observation>).observedAt;
          return requestFingerprint(copy);
        };
        if (basis(closing) !== basis(integrationObservation)) throw new ModelGatewayError('CONFIG_INVALID');
        integrationObservation = closing;
      }
      if (before.profile && !z.string().min(1).max(191).safeParse(before.profile.configVersion).success)
        throw new ModelGatewayError('INVALID_RESPONSE');
      const source = { scope, resourceType: 'business_configuration' as const,
        version: before.settings.configVersion, observedAt: facts.observedAt };
      // Only operational, non-secret fields from the original settings/catalog
      // sources. Config inventory modes are not physical stock balances.
      const configuration = {
        products: { source, rows: before.groups.slice(0, 100).map(row => ({ id: row.id, code: row.code,
          status: row.status, inventoryMode: row.inventoryMode, unit: row.unit })), truncated: before.truncated.groups },
        pricing: { source, currency: before.settings.pricing.currency, enabledUnits: [...before.settings.pricing.enabledUnits],
          groups: (before.pricingGroups ?? []).slice(0, 100).map(row => ({ id: row.id, code: row.code,
            status: row.status, version: row.version })), truncated: before.truncated.pricingGroups,
          rates: 'not_projected' as const },
        fulfillment: { source, enabledModes: [...before.settings.fulfillment.enabledModes],
          locations: before.locations.slice(0, 100).map(row => ({ id: row.id, code: row.code,
            status: row.status, capabilities: [...row.capabilities] })), truncated: before.truncated.locations },
        inventory: { source, coverage: 'not_loaded' as const, meaning: 'item_modes_are_not_stock_balances' as const }
      };
      return { requestId: authorized.requestId, audience: authorized.audience, scope, observedAt: facts.observedAt,
        ...(integrationObservation ? { integrationObservation } : {}),
        configVersion: before.settings.configVersion, ready: facts.ready,
        configuration,
        atomicity: 'independent_sections_not_a_transaction' as const,
        sections: facts.items.map(row => ({ key: row.key, title: row.title, required: !row.optional,
          status: row.status === 'unavailable' ? 'source_unavailable' as const
            : row.status === 'ready' ? 'readiness_check_passed' as const
            : row.key === 'item_groups' && before.enabledItemGroupCount === 0 ? 'missing_configuration' as const
            : row.key === 'fulfillment_network' && before.enabledLocationCount === 0 ? 'missing_configuration' as const
            : Object.prototype.hasOwnProperty.call(sections, row.key) ? 'readiness_unsatisfied' as const : 'unclassified' as const,
          issue: row.status === 'ready' ? undefined : row.missing,
          // Preserve Core's original observation, including its rule summary.
          // It participates in the two-read comparison; it is not parsed into
          // a synthetic rule/calendar revision or configuration write grant.
          ...(row.summary !== undefined ? { summary: row.summary } : {}),
          impact: row.optional ? 'optional_configuration' as const : 'required_readiness_item' as const,
          evidence: { scope, resourceType: 'readiness_item' as const, resourceId: row.key,
            version: before.settings.configVersion, observedAt: facts.observedAt },
          manual: Object.prototype.hasOwnProperty.call(sections, row.key)
            ? { kind: 'configuration_section' as const, section: row.key, scope, navigation: 'host_existing_section' as const }
            : { status: 'unavailable' as const },
          // The ordinary profile and business settings have independent target
          // revisions. Keep diagnosis metadata global, but an available profile
          // candidate must advertise the same original revision the difference
          // reader checks; a version here still never grants save/publication.
          candidate: { status: 'candidate_only' as const,
            currentVersion: row.key === 'workspace_profile' && before.profile ? before.profile.configVersion : before.settings.configVersion,
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
    const parsed = z.object({ key: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict().safeParse(value);
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
  async prepareDifference(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = differenceSchema.safeParse(value);
    if (!parsed.success || new Set(parsed.data.changes.map(row => row.field)).size !== parsed.data.changes.length) throw new ModelGatewayError('INVALID_REQUEST');
    const requested = structuredClone(parsed.data), parent = expectedContext && structuredClone(expectedContext);
    return this.authority.withRead('opening', { limit: 50 }, async context => {
      assertAiReadContextBinding(context, parent);
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const before = structuredClone(await this.contexts.current(context.scope, context));
      // A workspace without its own readable persisted terminology cannot
      // borrow the tenant default profile as its old value.
      const profile = before.profile;
      if (profile === null) throw new OpeningProfileSourceUnavailable();
      if (!profile) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
      if (profile.configVersion !== requested.expectedVersion) throw new OpeningSectionRevisionConflict('expected_version_mismatch');
      if (requestFingerprint(before) !== requestFingerprint(await this.contexts.current(context.scope, context)))
        throw new OpeningSectionRevisionConflict('configuration_changed_during_read');
      // Observation follows both protected reads, not the initial Auth stamp.
      // It is neither a configuration revision nor an execution/expiry clock.
      const observed = this.clock();
      if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
      const observedAt = observed.toISOString();
      const changes = requested.changes.map(row => ({ field: `terminology.${row.field}`, before: profile.terminology[row.field],
        after: row.value, source: { scope: context.scope, resourceType: 'tenant_profile' as const,
          version: profile.configVersion, observedAt },
        impact: 'display_terminology_only_not_business_rules' as const }));
      // A difference contains changed values, not every requested field. Keep
      // the version check and both protected reads above even for empty output:
      // equal terminology is an observation, not a no-op write/approval receipt.
      return { status: 'candidate_only' as const, scope: context.scope, currentVersion: profile.configVersion,
        changes: changes.filter(row => row.before !== row.after), persistence: 'not_attempted_no_verified_proposal_port' as const,
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

  async prepareSection(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = z.object({ key: z.string().min(1).max(191) }).strict().safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const current = await this.read({}, expectedContext);
    const section = current.sections.find(row => row.key === parsed.data.key);
    if (!section) return { status: 'unavailable' as const, key: parsed.data.key, reason: 'section_not_in_current_readiness' as const };
    return { status: 'prepared' as const, key: section.key, scope: current.scope, configVersion: section.candidate.currentVersion,
      issue: section.issue, materials: section.candidate.fieldsToReview,
      sensitive: { values: 'not_returned' as const, action: 'original_manual_flow' as const },
      persistence: 'not_attempted' as const, publication: 'not_attempted' as const,
      source: section.evidence };
  }

  /** Read one explicitly selected readiness partition. The projection is
   * bounded and sanitized; it is not a writable configuration object. */
  async readSection(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = z.object({ key: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict().safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const current = await this.read({}, expectedContext);
    const section = current.sections.find(row => row.key === parsed.data.key);
    if (!section) return { status: 'unavailable' as const, key: parsed.data.key,
      reason: 'section_not_in_current_readiness' as const, persistence: 'not_attempted' as const };
    const safeCurrent = (() => {
      switch (section.key) {
        case 'item_groups': return current.configuration.products;
        case 'pricing_groups_rates': return current.configuration.pricing;
        case 'fulfillment_network': return current.configuration.fulfillment;
        case 'workspace_profile': return { configVersion: section.candidate.currentVersion, fields: section.candidate.fieldsToReview };
        default: return { fields: section.candidate.fieldsToReview };
      }
    })();
    const status = section.status === 'readiness_check_passed' ? 'ready_for_human_review' as const
      : section.status === 'source_unavailable' ? 'capability_unavailable' as const
      : section.status === 'missing_configuration' ? 'missing_configuration' as const
      : section.status === 'readiness_unsatisfied' ? 'check_failed' as const
      : 'awaiting_external_evidence' as const;
    return { status, key: section.key, current: safeCurrent, issue: section.issue,
      required: section.required, impact: section.impact, evidence: section.evidence,
      materials: section.candidate.fieldsToReview, manual: section.manual,
      candidate: { status: 'candidate_only' as const, currentVersion: section.candidate.currentVersion,
        fieldsToReview: section.candidate.fieldsToReview, proposedChanges: [],
        persistence: 'unavailable_no_formal_draft_port' as const },
      externalVerification: section.externalVerification, persistence: 'not_attempted' as const,
      publication: 'not_attempted' as const };
  }

  async prepareSections(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = z.object({ sections: z.array(z.object({ key: z.string().min(1).max(191),
      expectedVersion: z.string().min(1).max(191), changes: z.array(z.object({ field: z.enum(terminologyFields), value: z.string().trim().min(1).max(80) }).strict()).max(6) }).strict()).min(1).max(6) }).strict().safeParse(value);
    if (!parsed.success || parsed.data.sections.some(section =>
      new Set(section.changes.map(row => row.field)).size !== section.changes.length)) throw new ModelGatewayError('INVALID_REQUEST');
    const unique = new Set(parsed.data.sections.map(row => row.key));
    if (unique.size !== parsed.data.sections.length) throw new ModelGatewayError('INVALID_REQUEST');
    const parent = expectedContext && structuredClone(expectedContext);
    return this.authority.withRead('opening', { limit: 50 }, async context => {
      assertAiReadContextBinding(context, parent);
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      // Equal workspace/version alone cannot join candidates read by different
      // actors. Retain one server binding and let every original Guard recheck it.
      const expected = structuredClone(context);
      const rows = [];
      for (const section of parsed.data.sections) {
        try {
          const current = await this.prepareSection({ key: section.key }, expected);
          if (current.status !== 'prepared') { rows.push({ ...current, expectedVersion: section.expectedVersion }); continue; }
          if (section.key !== 'workspace_profile') {
            rows.push({ status: 'unavailable' as const, key: section.key, expectedVersion: section.expectedVersion,
              reason: 'formal_section_field_reader_not_exposed' as const, persistence: 'not_attempted' as const });
            continue;
          }
          const candidate = await this.prepareDifference({ expectedVersion: section.expectedVersion, changes: section.changes }, expected);
          rows.push({ status: 'prepared' as const, key: section.key, expectedVersion: section.expectedVersion, candidate });
        } catch (error) {
          // These reads are independent, not a save transaction. A stale or
          // unavailable partition must not erase the other partitions' results.
          // Original Guards still recheck every read and the enclosing batch:
          // permission, identity, invalid input/response and unknown faults abort.
          if (error instanceof OpeningSectionRevisionConflict) {
            rows.push({ status: 'revision_conflict' as const, key: section.key, expectedVersion: section.expectedVersion,
              reason: error.reason, nextAction: 'refresh_difference_and_reconfirm' as const,
              persistence: 'not_attempted' as const, publication: 'not_attempted' as const });
          } else if (error instanceof AiDiagnosticSourceUnavailable || error instanceof OpeningProfileSourceUnavailable) {
            // Original callback provenance or the exact protected null-profile
            // predicate only; generic PROVIDER_UNAVAILABLE still aborts the batch.
            rows.push({ status: 'unavailable' as const, key: section.key, expectedVersion: section.expectedVersion,
              reason: 'section_source_unavailable' as const, sourceError: error.code,
              nextAction: 'reconcile' as const, persistence: 'not_attempted' as const, publication: 'not_attempted' as const });
          } else throw error;
        }
      }
      return { status: 'section_candidates' as const, rows, atomicity: 'independent_section_results_not_transaction' as const,
        execution: 'not_attempted' as const };
    });
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
