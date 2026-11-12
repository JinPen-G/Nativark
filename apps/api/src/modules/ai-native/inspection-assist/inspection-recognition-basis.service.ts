/** Current original inspection evidence for trusted candidate review.
 * Core ports own asset/record access and formats. Only an opaque reference is
 * frozen for a model; missing old evidence is never signed with current data. */
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type { AiInspectionActorScope, AiInspectionTarget, AiInspectionCandidateDraft,
  AiInspectionRecognitionBasisReference, AiInspectionRecognitionBasisIssueDraft, AiInspectionReviewIssueDraft, RentalAttributeDefinition,
  RentalInspectionRecord, RentalInspectionFieldDefinition } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { InspectionTemplateService } from './inspection-template.service';
import type { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionAssistError } from './inspection-assist.validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { normalizedRentalAttributeValue, validateRentalCategoryAttributes } from '../../rental-core/rental-category-attributes';
import { optionalUsageReading, usageDelta } from '../../rental-core/rental-usage-reading';

export const INSPECTION_RECOGNITION_BASIS_VERSION = 'inspection-recognition-basis-1' as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
/** Internal parser for the original frozen reference, never authority from a client. */
export const inspectionRecognitionBasisReferenceSchema = z.discriminatedUnion('status', [
  z.object({ version: z.literal(INSPECTION_RECOGNITION_BASIS_VERSION), status: z.literal('recorded'), referenceId: id, sourceHash: hash }).strict(),
  z.object({ version: z.literal(INSPECTION_RECOGNITION_BASIS_VERSION), status: z.literal('not_recorded') }).strict(),
]);
export type InspectionRecognitionBasisReference = AiInspectionRecognitionBasisReference;
export const unrecordedInspectionRecognitionBasis = (): InspectionRecognitionBasisReference => ({
  version: INSPECTION_RECOGNITION_BASIS_VERSION, status: 'not_recorded',
});
type Target = AiInspectionTarget & { assetId: string };
export type InspectionRecognitionCoreSource = Awaited<ReturnType<RentalCoreService['readOrderAllocationPickupBasis']>>;
type CorePickup = Extract<InspectionRecognitionCoreSource['pickup'], { state: 'recorded' }>;
export type InspectionRecognitionAssetSource = { status: 'unavailable' } | {
  status: 'available'; assetId: string; version: string; serialNo?: string;
  attributes: Record<string, unknown>; definitions: RentalAttributeDefinition[];
  meterEvidence?: { status: 'recorded'; changed: boolean; referenceId: string; version: string };
};
export type InspectionRecognitionPickupSource = { status: 'unavailable' } | {
  status: 'available'; page: Awaited<ReturnType<RentalCoreService['listInspectionsPage']>>;
  applicablePickupTemplates: Array<{ id: string; version: string }>; sourceVersion: string;
} | { status: 'targeted'; pickup: InspectionRecognitionCoreSource['pickup']; sourceVersion: string };
/** Request-bound Core readers. The inspections adapter must apply the original
 * staff inspections Guard; neither this target nor its scope is a credential. */
export interface InspectionRecognitionBasisPorts {
  original?: { read(scope: AiInspectionActorScope, target: Target, signal: AbortSignal): Promise<InspectionRecognitionCoreSource> };
  asset?: { read(scope: AiInspectionActorScope, target: Target, signal: AbortSignal): Promise<InspectionRecognitionAssetSource> };
  inspections?: { read(scope: AiInspectionActorScope, target: Target, signal: AbortSignal): Promise<InspectionRecognitionPickupSource> };
}
export interface InspectionRecognitionBasisSnapshot {
  status: 'recorded' | 'not_recorded'; reference: InspectionRecognitionBasisReference;
  fields: RentalInspectionFieldDefinition[];
  asset: Extract<InspectionRecognitionAssetSource, { status: 'available' }> | null;
  baseline: { status: 'not_applicable' | 'missing' | 'unknown'; reason?: string }
    | { status: 'available'; record: RentalInspectionRecord }
    | { status: 'targeted'; pickup: CorePickup };
  meterEvidence: 'not_recorded' | 'recorded_unchanged' | 'recorded_changed';
}
export type InspectionRecognitionBasisIssue = AiInspectionRecognitionBasisIssueDraft;
const unknownSnapshot = (): InspectionRecognitionBasisSnapshot => ({ status: 'not_recorded',
  reference: unrecordedInspectionRecognitionBasis(), fields: [], asset: null,
  baseline: { status: 'unknown', reason: 'basis_not_recorded' }, meterEvidence: 'not_recorded' });
const changed = () => new InspectionAssistError('BINDING_CHANGED');
const invalid = () => new InspectionAssistError('INVALID_INPUT');

export class InspectionRecognitionBasisService {
  constructor(private readonly templates: Pick<InspectionTemplateService, 'read'>,
    private readonly authority: Pick<InspectionActionAuthority, 'withAction'>,
    private readonly ports: InspectionRecognitionBasisPorts = {}) {
    if (typeof templates?.read !== 'function' || typeof authority?.withAction !== 'function') throw invalid();
    if (ports.original && typeof ports.original.read !== 'function' || ports.asset && typeof ports.asset.read !== 'function'
      || ports.inspections && typeof ports.inspections.read !== 'function') throw invalid();
  }
  async prepare(value: AiInspectionTarget, signal: AbortSignal = new AbortController().signal): Promise<InspectionRecognitionBasisSnapshot> {
    const target = structuredClone(value);
    if (!this.ports.original && !this.ports.asset) return unknownSnapshot();
    return this.authority.withAction(target, 'read', async scope => {
      const before = await this.templates.read(target), owner = structuredClone(scope);
      if (before.owner.actorId !== owner.ownerId || before.audience !== owner.audience
        || before.scope.tenantId !== owner.tenantId || before.scope.workspaceId !== owner.workspaceId) throw changed();
      const bound = { ...target, assetId: before.assetId };
      const read = async () => {
        if (signal.aborted) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
        const needsBaseline = target.stage === 'return' && before.template.fields.some(field => field.usageMetric);
        const original = this.ports.original ? this.fromCore(
          structuredClone(await this.ports.original.read(structuredClone(owner), structuredClone(bound), signal)),
          owner, bound, before.allocationStatus, before.template.fields) : null;
        const asset = original?.asset ?? structuredClone(await this.ports.asset!.read(structuredClone(owner), structuredClone(bound), signal));
        const pickup = needsBaseline ? original?.pickup ?? (this.ports.inspections
          ? structuredClone(await this.ports.inspections.read(structuredClone(owner), structuredClone(bound), signal)) : null) : null;
        if (signal.aborted) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
        return { asset, pickup, needsBaseline };
      };
      const first = await read(), current = await read();
      if (!isDeepStrictEqual(first, current)) throw changed();
      const after = await this.templates.read(target);
      if (before.bindingFingerprint !== after.bindingFingerprint) throw changed();
      return this.authority.withAction(target, 'read', async closing => {
        if (!isDeepStrictEqual(owner, closing) || signal.aborted) throw changed();
        if (current.asset.status === 'unavailable' || current.needsBaseline && (!current.pickup || current.pickup.status === 'unavailable')) return unknownSnapshot();
        const asset = current.asset;
        if (asset.status !== 'available' || asset.assetId !== bound.assetId || !id.safeParse(asset.version).success
          || !asset.attributes || Array.isArray(asset.attributes) || asset.definitions.length > 100
          || Buffer.byteLength(JSON.stringify(asset), 'utf8') > 131072) throw invalid();
        const codes = new Set(before.template.fields.map(field => field.code));
        const definitions = asset.definitions.filter(field => field.scope === 'asset' && codes.has(field.code));
        const attributes = Object.fromEntries(definitions.filter(field => Object.hasOwn(asset.attributes, field.code))
          .map(field => [field.code, structuredClone(asset.attributes[field.code])]));
        const protectedAsset = { ...asset, attributes, definitions };
        const baseline = current.needsBaseline ? this.baseline(current.pickup!, bound, owner.tenantId, before.template.exchangeId) : { status: 'not_applicable' as const };
        const meter = asset.meterEvidence;
        if (meter && (!id.safeParse(meter.referenceId).success || !id.safeParse(meter.version).success || typeof meter.changed !== 'boolean')) throw invalid();
        const facts = { target: bound, scope: owner, bindingFingerprint: before.bindingFingerprint,
          fields: before.template.fields, asset: protectedAsset, baseline,
          pickupSourceVersion: current.pickup && current.pickup.status !== 'unavailable' ? current.pickup.sourceVersion : null };
        const sourceHash = requestFingerprint(facts);
        return { status: 'recorded', reference: { version: INSPECTION_RECOGNITION_BASIS_VERSION,
          status: 'recorded', referenceId: `inspection-basis:${sourceHash}`, sourceHash },
          fields: structuredClone(before.template.fields), asset: protectedAsset, baseline,
          meterEvidence: meter ? meter.changed ? 'recorded_changed' : 'recorded_unchanged' : 'not_recorded' };
      });
    });
  }
  private fromCore(source: InspectionRecognitionCoreSource, scope: AiInspectionActorScope, target: Target,
    allocationStatus: string, fields: readonly RentalInspectionFieldDefinition[]): { asset: InspectionRecognitionAssetSource; pickup: InspectionRecognitionPickupSource } {
    const { projectionHash, hashSemantics, ...projection } = source;
    if (source.contractVersion !== 'rental-order-allocation-pickup-basis-1'
      || source.semantics !== 'current_authorized_asset_and_original_pickup_not_execution_authority'
      || hashSemantics !== 'sha256_of_persisted_read_projection_not_historical_version'
      || !hash.safeParse(projectionHash).success || requestFingerprint(projection) !== projectionHash
      || source.tenantId !== scope.tenantId || source.workspaceId !== scope.workspaceId || source.orderId !== target.orderId
      || source.allocation.id !== target.allocationId || source.allocation.assetId !== target.assetId
      || source.allocation.status !== allocationStatus) throw changed();
    const current = source.currentAsset, sourceVersion = `core-read:${projectionHash}`;
    const pickup: InspectionRecognitionPickupSource = { status: 'targeted', pickup: structuredClone(source.pickup), sourceVersion };
    if (current.state === 'not_recorded') return { asset: { status: 'unavailable' }, pickup };
    if (current.id !== target.assetId || current.itemGroupId !== source.allocation.itemGroupId
      || current.schema.source !== 'current_workspace' || current.schema.validator !== 'rental-category-attributes'
      || current.fields.length > 200) throw changed();
    const codes = new Set(fields.map(field => field.code));
    const selected = current.fields.filter(field => field.scope === 'asset' && codes.has(field.code));
    if (new Set(selected.map(field => field.code)).size !== selected.length) throw invalid();
    const definitions: RentalAttributeDefinition[] = selected.map(field => ({ code: field.code, label: field.label,
      scope: 'asset', type: field.type, required: field.required, unique: field.unique,
      ...(field.options !== undefined ? { options: [...field.options] } : {}), ...(field.unit !== undefined ? { unit: field.unit } : {}) }));
    const attributes = Object.fromEntries(selected.filter(field => field.valueState === 'recorded')
      .map(field => [field.code, field.value]));
    // This reference names the current Core projection. It is not a fabricated
    // historical version, full inspection page or meter-replacement event.
    return { asset: { status: 'available', assetId: current.id, version: sourceVersion,
      ...(current.serialNo !== undefined ? { serialNo: current.serialNo } : {}), attributes, definitions }, pickup };
  }
  private baseline(source: InspectionRecognitionPickupSource, target: Target, tenantId: string, exchangeId?: string): InspectionRecognitionBasisSnapshot['baseline'] {
    if (source.status === 'targeted') {
      const pickup = source.pickup;
      if (pickup.state === 'not_recorded') return { status: 'missing', reason: 'original_pickup_not_recorded' };
      if (pickup.resourceBinding.allocationId !== target.allocationId || pickup.resourceBinding.assetId !== target.assetId
        || pickup.exchangeId !== exchangeId || pickup.template.source !== 'frozen_business_snapshot') throw changed();
      return { status: 'targeted', pickup: structuredClone(pickup) };
    }
    if (source.status !== 'available') return { status: 'unknown', reason: 'pickup_source_unavailable' };
    if (!id.safeParse(source.sourceVersion).success || source.page.coverage !== 'page_not_total'
      || source.page.items.length > 100 || source.applicablePickupTemplates.length > 32
      || new Set(source.page.items.map(record => record.id)).size !== source.page.items.length
      || source.page.items.some(record => record.orderId !== target.orderId || record.tenantId !== tenantId)
      || source.applicablePickupTemplates.some(template => !id.safeParse(template.id).success || !id.safeParse(template.version).success)) throw invalid();
    if (source.page.nextCursor !== null) return { status: 'unknown', reason: 'pickup_page_incomplete' };
    if (!source.applicablePickupTemplates.length) return { status: 'unknown', reason: 'pickup_template_not_recorded' };
    const applicable = source.page.items.filter(record => record.stage === 'pickup' && record.exchangeId === exchangeId
      && source.applicablePickupTemplates.some(template => record.templateId === template.id && record.templateVersion === template.version));
    // An old order-level record cannot prove which physical asset was read.
    if (applicable.some(record => !record.pickupItems?.length)) return { status: 'unknown', reason: 'pickup_resources_not_recorded' };
    if (applicable.some(record => record.pickupItems!.filter(item => item.allocationId === target.allocationId).length > 1
      || record.pickupItems!.some(item => item.allocationId === target.allocationId && item.assetId !== target.assetId)))
      return { status: 'unknown', reason: 'pickup_resource_not_unique' };
    const matches = applicable.filter(record => record.pickupItems!.some(item => item.allocationId === target.allocationId && item.assetId === target.assetId));
    if (matches.length > 1) return { status: 'unknown', reason: 'pickup_baseline_ambiguous' };
    if (!matches.length) return { status: 'missing' };
    return { status: 'available', record: structuredClone(matches[0]) };
  }
  async revalidate(target: AiInspectionTarget, value: InspectionRecognitionBasisReference | undefined,
    signal?: AbortSignal): Promise<InspectionRecognitionBasisSnapshot> {
    // Ordinary history never acquires a new current-asset or baseline stamp.
    if (value === undefined) return unknownSnapshot();
    const reference = inspectionRecognitionBasisReferenceSchema.parse(structuredClone(value));
    if (reference.status === 'not_recorded') return unknownSnapshot();
    const current = await this.prepare(target, signal);
    if (current.reference.status !== 'recorded' || !isDeepStrictEqual(current.reference, reference)) throw changed();
    return current;
  }
  assess(snapshot: InspectionRecognitionBasisSnapshot, fields: readonly RentalInspectionFieldDefinition[], candidates: readonly AiInspectionCandidateDraft[]): InspectionRecognitionBasisIssue[] {
    const issues: InspectionRecognitionBasisIssue[] = [];
    for (const candidate of candidates) {
      const field = fields.find(field => field.code === candidate.fieldCode);
      if (!field) throw invalid();
      const add = (code: AiInspectionReviewIssueDraft, reason: string, originalRecordId?: string) => issues.push({ fieldCode: field.code, code, reason, ...(originalRecordId ? { originalRecordId } : {}) });
      if (candidate.status !== 'candidate') { add('source_unclear', candidate.status === 'blurred' ? 'source_blurred' : 'source_missing'); continue; }
      if (snapshot.status === 'not_recorded') { add('field_unavailable', 'original_basis_not_recorded'); continue; }
      const definition = snapshot.asset?.definitions.find(definition => definition.code === field.code);
      if (definition && candidate.value.kind !== 'photo') {
        const value = candidate.value.value;
        try { validateRentalCategoryAttributes([definition], 'asset', { [definition.code]: value }, {}, false); }
        catch { add('field_unavailable', 'original_attribute_format_invalid'); continue; }
        if (definition.unique) {
          const expected = definition.code === 'serialNo' ? snapshot.asset!.serialNo : snapshot.asset!.attributes[definition.code];
          const normalized = normalizedRentalAttributeValue(expected);
          if (!normalized) { add('field_unavailable', 'asset_identifier_not_recorded'); continue; }
          if (normalizedRentalAttributeValue(value) !== normalized) { add('field_unavailable', 'asset_identifier_mismatch'); continue; }
        }
      }
      if (!field.usageMetric || candidate.value.kind !== 'number') continue;
      if (snapshot.meterEvidence === 'recorded_changed') { add('meter_replaced', 'original_meter_evidence_recorded'); continue; }
      if (snapshot.baseline.status === 'not_applicable') continue;
      if (snapshot.baseline.status === 'missing') { add('baseline_missing', 'pickup_baseline_missing'); continue; }
      if (snapshot.baseline.status === 'targeted') {
        const pickup = snapshot.baseline.pickup;
        const readings = pickup.usage.fields.filter(reading => reading.fieldCode === field.code);
        if (readings.length !== 1) { add('field_unavailable', 'original_pickup_reading_not_unique', pickup.recordId); continue; }
        const reading = readings[0];
        if (reading.state === 'not_recorded') {
          add(reading.reason === 'original_pickup_reading_missing' ? 'baseline_missing' : 'field_unavailable', reading.reason, pickup.recordId);
          continue;
        }
        if (!field.unit?.trim() || field.unit !== reading.unit) {
          add('field_unavailable', 'original_pickup_unit_mismatch', pickup.recordId); continue;
        }
        let baseline: number | undefined;
        try { baseline = optionalUsageReading(reading.current, field.label); }
        catch { add('field_unavailable', 'original_pickup_reading_invalid', pickup.recordId); continue; }
        if (baseline === undefined) add('baseline_missing', 'pickup_reading_missing', pickup.recordId);
        else try { usageDelta(candidate.value.value, baseline); }
        catch { add('reading_backwards', 'original_usage_validation_failed', pickup.recordId); }
        // Core has already applied its explicit correction chain. A corrected
        // number or attached evidence does not establish a meter replacement.
        continue;
      }
      if (snapshot.baseline.status !== 'available') { add('field_unavailable', snapshot.baseline.reason ?? 'pickup_baseline_unknown'); continue; }
      const record = snapshot.baseline.record, readings = record.usageReadings?.filter(reading => reading.fieldCode === field.code) ?? [];
      if (readings.length !== 1) { add('field_unavailable', 'pickup_reading_not_unique', record.id); continue; }
      let baseline: number | undefined;
      try { baseline = optionalUsageReading(readings[0].current, field.label); }
      catch { add('field_unavailable', 'original_pickup_reading_invalid', record.id); continue; }
      if (baseline === undefined) add('baseline_missing', 'pickup_reading_missing', record.id);
      else try { usageDelta(candidate.value.value, baseline); }
      catch { add('reading_backwards', 'original_usage_validation_failed', record.id); }
      // Free-text correction reasons cannot establish meter replacement.
    }
    return issues;
  }
}
