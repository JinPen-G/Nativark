/** Field-level non-notification opening differences from the original persisted
 * Core projection. Only AI proposal material: no active save, price calculation,
 * stock/qualification change, category adoption or R3 publication. */
import { z } from 'zod';
import { RENTAL_PRICING_UNIT_CODES, RENTAL_FULFILLMENT_MODES, type AiExecutionContext } from '@rental-os/shared';
import { RENTAL_OPENING_TERMINOLOGY_FIELDS } from '../../rental-core/rental-core-config.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import type { AiOpeningConfigurationSource } from './opening-configuration.source';
import { assertAiReadContextBinding } from './read-context-binding';
import { ModelGatewayError } from '../model-gateway.ports';
import { AiOpeningVersionFieldSource, OPENING_RULE_BOOLEAN_FIELDS } from './opening-version-fields.source';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const unit = z.string().refine(value => (RENTAL_PRICING_UNIT_CODES as readonly string[]).includes(value));
const status = z.enum(['enabled', 'disabled']);
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const terms = z.object({ field: z.enum(RENTAL_OPENING_TERMINOLOGY_FIELDS), value: z.string().trim().min(1).max(80) }).strict();
const product = z.discriminatedUnion('field', [z.object({ field: z.literal('status'), value: status }).strict(),
  z.object({ field: z.literal('code'), value: z.string().min(1).max(191) }).strict()]);
const pricing = z.discriminatedUnion('field', [z.object({ field: z.literal('defaultUnit'), value: unit }).strict(),
  z.object({ field: z.literal('enabledUnits'), value: z.array(unit).min(1).max(100).refine(unique) }).strict()]);
const modes = z.enum(RENTAL_FULFILLMENT_MODES);
const fulfillment = z.discriminatedUnion('field', [z.object({ field: z.literal('enabledModes'), value: z.array(modes).min(1).max(100).refine(unique) }).strict()]);
const base = z.object({ expectedVersion: id });
const ruleField = z.object({ field: z.enum(OPENING_RULE_BOOLEAN_FIELDS), value: z.boolean() }).strict();
const calendarField = z.discriminatedUnion('field', [
  z.object({ field: z.literal('name'), value: z.string().min(1).max(120) }).strict(),
  z.object({ field: z.literal('businessStatus'), value: z.enum(['open', 'limited', 'closed', 'self_service']) }).strict(),
  z.object({ field: z.literal('closed'), value: z.boolean() }).strict()
]);
const civilDate = z.string().regex(/^(19|20|21|22)\d{2}-\d{2}-\d{2}$/u).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const openingSectionChangeSchema = z.discriminatedUnion('key', [
  base.extend({ key: z.literal('workspace_profile'), changes: z.array(terms).min(1).max(6) }).strict(),
  base.extend({ key: z.literal('item_groups'), targetId: id, changes: z.array(product).min(1).max(2) }).strict(),
  base.extend({ key: z.literal('pricing_groups_rates'), changes: z.array(pricing).min(1).max(2) }).strict(),
  base.extend({ key: z.literal('fulfillment_network'), changes: z.array(fulfillment).min(1).max(1) }).strict(),
  base.extend({ key: z.literal('business_rule'), targetId: id, changes: z.array(ruleField).min(1).max(6) }).strict(),
  base.extend({ key: z.literal('business_calendar'), targetId: id, date: civilDate,
    expectedRevision: z.number().int().min(0).max(4294967294), changes: z.array(calendarField).min(1).max(3) }).strict()
]);
export type AiOpeningSectionChange = z.infer<typeof openingSectionChangeSchema>;
export function verifyOpeningSectionMaterial(value: unknown) {
  const parsed = z.object({ scope: z.object({ kind: z.literal('workspace'), tenantId: id, workspaceId: id }).strict(),
    key: z.enum(['workspace_profile', 'item_groups', 'pricing_groups_rates', 'fulfillment_network', 'business_rule', 'business_calendar']), targetId: id,
    date: civilDate.optional(), baseRevision: z.number().int().min(0).max(4294967294).optional(),
    expectedVersion: id, changes: z.array(z.object({ field: id, before: z.unknown(), after: z.unknown() }).strict()).max(6),
    categoryCode: z.enum(['camera', 'camping', 'vehicle', 'construction']), categoryVersion: id,
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), validation: z.literal('ai_proposal_only_original_business_validation_required'),
    status: z.enum(['difference_ready', 'no_change']), observedAt: z.string().datetime({ offset: true }),
    materialHash: z.string().regex(/^[a-f0-9]{64}$/u), source: z.enum(['original_persisted_opening_configuration', 'original_persisted_rule_calendar_fields']),
    fieldRevision: z.enum(['profile_config_version', 'settings_version_and_checked_source_fingerprint_not_object_cas',
      'rule_version_and_checked_source_fingerprint_not_object_cas', 'calendar_original_revision']),
    persistence: z.literal('not_attempted'), activeConfiguration: z.literal('unchanged'), publication: z.literal('not_attempted')
  }).strict().parse(value);
  if (!unique(parsed.changes.map(row => row.field)) || (parsed.status === 'no_change') !== (parsed.changes.length === 0)) throw new ModelGatewayError('INVALID_RESPONSE');
  const calendar = parsed.key === 'business_calendar', versioned = calendar || parsed.key === 'business_rule';
  if (calendar ? parsed.date === undefined || parsed.baseRevision === undefined : parsed.date !== undefined || parsed.baseRevision !== undefined)
    throw new ModelGatewayError('INVALID_RESPONSE');
  if (versioned && (parsed.source !== 'original_persisted_rule_calendar_fields'
    || parsed.fieldRevision !== (calendar ? 'calendar_original_revision' : 'rule_version_and_checked_source_fingerprint_not_object_cas')))
    throw new ModelGatewayError('INVALID_RESPONSE');
  if (!versioned && (parsed.source !== 'original_persisted_opening_configuration'
    || parsed.fieldRevision !== (parsed.key === 'workspace_profile' ? 'profile_config_version' : 'settings_version_and_checked_source_fingerprint_not_object_cas')))
    throw new ModelGatewayError('INVALID_RESPONSE');
  for (const row of parsed.changes) {
    const schema = parsed.key === 'workspace_profile' ? terms : parsed.key === 'item_groups' ? product
      : parsed.key === 'pricing_groups_rates' ? pricing : parsed.key === 'business_rule' ? ruleField
        : parsed.key === 'business_calendar' ? calendarField : fulfillment;
    schema.parse({ field: row.field, value: row.before }); schema.parse({ field: row.field, value: row.after });
  }
  const material = { scope: parsed.scope, key: parsed.key, targetId: parsed.targetId, expectedVersion: parsed.expectedVersion,
    changes: parsed.changes, categoryCode: parsed.categoryCode, categoryVersion: parsed.categoryVersion,
    sourceFingerprint: parsed.sourceFingerprint, validation: parsed.validation,
    ...(calendar ? { date: parsed.date, baseRevision: parsed.baseRevision } : {}) };
  if (requestFingerprint(material) !== parsed.materialHash) throw new ModelGatewayError('INVALID_RESPONSE');
  return parsed;
}
export function openingSectionFromMaterial(material: ReturnType<typeof verifyOpeningSectionMaterial>) {
  return openingSectionChangeSchema.parse({ key: material.key, expectedVersion: material.expectedVersion,
    ...(['item_groups', 'business_rule', 'business_calendar'].includes(material.key) ? { targetId: material.targetId } : {}),
    ...(material.key === 'business_calendar' ? { date: material.date, expectedRevision: material.baseRevision } : {}),
    changes: material.changes.map(change => ({ field: change.field, value: change.after })) });
}
export class AiOpeningSectionDifferenceService {
  constructor(private readonly sources: AiOpeningConfigurationSource, private readonly authority: AiBusinessReadAuthority,
    private readonly clock: () => Date = () => new Date(), private readonly versionFields?: AiOpeningVersionFieldSource) {}
  async prepare(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = openingSectionChangeSchema.safeParse(structuredClone(value));
    if (!parsed.success || !unique(parsed.data.changes.map(row => row.field))) throw new ModelGatewayError('INVALID_REQUEST');
    const input = parsed.data, expected = expectedContext && structuredClone(expectedContext);
    return this.authority.withRead('opening', { limit: 50 }, async context => {
      assertAiReadContextBinding(context, expected);
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const read = () => this.sources.current(context.scope as Extract<AiExecutionContext['scope'], { kind: 'workspace' }>, context);
      const current = structuredClone(await read());
      if (input.key === 'business_rule' || input.key === 'business_calendar') {
        if (!this.versionFields) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
        const fieldsRead = () => this.versionFields!.read(input, context);
        const first = await fieldsRead(), latest = await fieldsRead();
        if (requestFingerprint(first.basis) !== requestFingerprint(latest.basis)) throw new ModelGatewayError('CONFIG_INVALID');
        if ('categoryCode' in first && first.categoryCode !== current.categoryCode) throw new ModelGatewayError('CONFIG_INVALID');
        const sourceFields: Record<string, unknown> = first.fields;
        const changes = input.changes.map(change => ({ field: change.field, before: sourceFields[change.field], after: change.value }));
        if (changes.some(change => change.before === undefined)) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
        if (input.key === 'business_calendar') {
          const after = { ...sourceFields, ...Object.fromEntries(changes.map(change => [change.field, change.after])) };
          // Core's legacy closed flag means manual service is closed. Self
          // service also closes manual service; capability/fulfillment admission
          // remains Core's responsibility, not this AI-only proposal check.
          if (typeof after.businessStatus === 'string' && typeof after.closed === 'boolean'
            && after.closed !== ['closed', 'self_service'].includes(after.businessStatus)) throw new ModelGatewayError('INVALID_REQUEST');
        }
        // The version row proves its own fields, not the workspace's current
        // category adoption. Check that separate source again after both field
        // reads so an unchanged row cannot carry a superseded category basis.
        const closing = await read();
        if (closing.categoryCode !== current.categoryCode || closing.categoryVersion !== current.categoryVersion)
          throw new ModelGatewayError('CONFIG_INVALID');
        const filtered = changes.filter(change => requestFingerprint(change.before) !== requestFingerprint(change.after));
        const material = { scope: context.scope, key: input.key, targetId: first.target, expectedVersion: first.version,
          changes: filtered, categoryCode: current.categoryCode, categoryVersion: current.categoryVersion,
          sourceFingerprint: requestFingerprint(first.basis), validation: 'ai_proposal_only_original_business_validation_required' as const,
          ...(input.key === 'business_calendar' && 'baseRevision' in first ? { date: input.date, baseRevision: first.baseRevision } : {}) };
        const result = { ...material, status: filtered.length ? 'difference_ready' as const : 'no_change' as const,
          observedAt: this.clock().toISOString(), materialHash: requestFingerprint(material), source: 'original_persisted_rule_calendar_fields' as const,
          fieldRevision: first.fieldRevision, persistence: 'not_attempted' as const, activeConfiguration: 'unchanged' as const, publication: 'not_attempted' as const };
        return verifyOpeningSectionMaterial(result);
      }
      const project = (source: typeof current) => {
        let version = source.settings.configVersion, target: string = input.key;
        let fields: Record<string, unknown>, configuration: unknown;
        if (input.key === 'workspace_profile') {
          if (!source.profile) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
          version = source.profile.configVersion; fields = source.profile.terminology; configuration = source.profile;
        } else if (input.key === 'item_groups') {
          const rows = source.groups.filter(row => row.id === input.targetId);
          if (rows.length !== 1) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
          target = input.targetId; fields = { code: rows[0].code, status: rows[0].status }; configuration = rows[0];
        } else if (input.key === 'pricing_groups_rates') {
          fields = { defaultUnit: source.settings.pricing.defaultUnit, enabledUnits: source.settings.pricing.enabledUnits };
          configuration = source.settings.pricing;
        } else { fields = { enabledModes: source.settings.fulfillment.enabledModes }; configuration = source.settings.fulfillment; }
        return { version, target, fields, basis: { tenantId: source.tenantId, workspaceId: source.workspaceId,
          categoryCode: source.categoryCode, categoryVersion: source.categoryVersion, version, target, configuration } };
      };
      const first = project(current), { version, target, fields } = first;
      if (version !== input.expectedVersion) throw new ModelGatewayError('CONFIG_INVALID');
      if (input.key === 'pricing_groups_rates') {
        let enabled = [...current.settings.pricing.enabledUnits], selected = current.settings.pricing.defaultUnit;
        for (const row of input.changes) {
          if (row.field === 'enabledUnits') {
            if (row.value.some(value => !current.settings.pricing.enabledUnits.includes(value as typeof selected))) throw new ModelGatewayError('INVALID_REQUEST');
            enabled = row.value as typeof enabled;
          } else {
            if (!current.settings.pricing.enabledUnits.includes(row.value as typeof selected)) throw new ModelGatewayError('INVALID_REQUEST');
            selected = row.value as typeof selected;
          }
        }
        if (!enabled.includes(selected)) throw new ModelGatewayError('INVALID_REQUEST');
      } else if (input.key === 'fulfillment_network' && input.changes.some(row => row.value.some(value => !current.settings.fulfillment.enabledModes.includes(value)))) {
        // This bounded projection proves current supported/enabled modes only.
        // New activation needs the original full category/capability form.
        throw new ModelGatewayError('INVALID_REQUEST');
      }
      // Compare only this original partition/target. An unrelated page or
      // section is not a new object revision for this independent AI proposal.
      if (requestFingerprint(first.basis) !== requestFingerprint(project(await read()).basis)) throw new ModelGatewayError('CONFIG_INVALID');
      const observedAt = this.clock().toISOString();
      if (input.changes.some(row => fields[row.field] === undefined)) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
      const changes = input.changes.map(row => ({ field: row.field, before: fields[row.field], after: row.value }))
        .filter(row => requestFingerprint(row.before) !== requestFingerprint(row.after));
      if (changes.some(row => row.before === undefined)) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
      const material = { scope: context.scope, key: input.key, targetId: target, expectedVersion: version,
        changes, categoryCode: current.categoryCode, categoryVersion: current.categoryVersion,
        sourceFingerprint: requestFingerprint(first.basis), validation: 'ai_proposal_only_original_business_validation_required' as const };
      return { status: changes.length ? 'difference_ready' as const : 'no_change' as const, ...material,
        observedAt, materialHash: requestFingerprint(material),
        source: 'original_persisted_opening_configuration' as const,
        fieldRevision: input.key === 'workspace_profile' ? 'profile_config_version' as const : 'settings_version_and_checked_source_fingerprint_not_object_cas' as const,
        persistence: 'not_attempted' as const, activeConfiguration: 'unchanged' as const, publication: 'not_attempted' as const };
    });
  }
}
