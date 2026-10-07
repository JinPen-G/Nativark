import Ajv from 'ajv';
import { z } from 'zod';
import { AI_INSPECTION_DRAFT_SCHEMAS, type AiInspectionCandidateDraft, type AiInspectionSourceDraft } from '@rental-os/shared';
import { optionalUsageReading } from '../../rental-core/rental-usage-reading';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
function localRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localRefs);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    key === '$ref' && typeof child === 'string' ? child.replace('#/components/schemas/', 'urn:rental:inspection:') : localRefs(child)]));
}
for (const name of ['AiInspectionSourceDraft', 'AiInspectionValueDraft', 'AiInspectionCandidateDraft']) {
  ajv.addSchema(localRefs(AI_INSPECTION_DRAFT_SCHEMAS[name]) as object, `urn:rental:inspection:${name}`);
}
const candidateValidator = ajv.getSchema<AiInspectionCandidateDraft>('urn:rental:inspection:AiInspectionCandidateDraft')!;
function isCandidate(value: unknown): value is AiInspectionCandidateDraft { return candidateValidator(value) === true; }
const requestSchema = inspectionTargetSchema.extend({ templateId: inspectionId,
  bindingFingerprint: z.string().regex(/^[a-f0-9]{64}$/), candidates: z.array(z.unknown()).max(100) }).strict();
type Binding = Awaited<ReturnType<InspectionTemplateService['read']>>;

/** Must resolve current persisted evidence, not trust source fields from the model.
 * Mainline must supply the authoritative attachment/allocation/version producer. */
export interface InspectionEvidenceAuthority {
  verify(binding: Binding, source: AiInspectionSourceDraft): Promise<boolean>;
}

export class InspectionCandidateService {
  constructor(private readonly templates: InspectionTemplateService, private readonly evidence?: InspectionEvidenceAuthority) {}

  async consume(value: unknown) {
    const input = parseInspectionInput(requestSchema, value);
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 262144) throw new InspectionAssistError('INVALID_INPUT');
    if (!this.evidence || typeof this.evidence.verify !== 'function') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    const target = { orderId: input.orderId, allocationId: input.allocationId, stage: input.stage, templateId: input.templateId };
    const before = await this.templates.read(target);
    if (before.bindingFingerprint !== input.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
    const fields = new Map(before.template.fields.map(row => [row.code, row]));
    const ids = new Set<string>(), codes = new Set<string>(), candidates: AiInspectionCandidateDraft[] = [];
    for (const raw of input.candidates) {
      if (!isCandidate(raw)) throw new InspectionAssistError('INVALID_INPUT');
      const candidate = structuredClone(raw), field = fields.get(candidate.fieldCode);
      if (!field || ids.has(candidate.candidateId) || codes.has(candidate.fieldCode)) throw new InspectionAssistError('INVALID_INPUT');
      ids.add(candidate.candidateId); codes.add(candidate.fieldCode);
      if (candidate.status === 'candidate') {
        if (candidate.value.kind !== field.type) throw new InspectionAssistError('INVALID_INPUT');
        if (candidate.value.kind === 'select' && !field.options?.includes(candidate.value.value)) throw new InspectionAssistError('INVALID_INPUT');
        if (candidate.value.kind === 'number' && field.usageMetric) {
          try { optionalUsageReading(candidate.value.value, field.label); } catch { throw new InspectionAssistError('INVALID_INPUT'); }
        }
        const value = candidate.value;
        if (value.kind === 'photo' && !candidate.sources.some(source => source.attachmentId === value.attachmentId
          && source.attachmentRevision === value.attachmentRevision)) throw new InspectionAssistError('INVALID_INPUT');
      }
      for (const source of candidate.sources) {
        if (source.kind === 'image' ? source.region.x + source.region.width > 1 || source.region.y + source.region.height > 1
          : source.span.endMs <= source.span.startMs) throw new InspectionAssistError('INVALID_INPUT');
        // Clone both arguments so an adapter cannot silently edit the package.
        if (await this.evidence.verify(structuredClone(before), structuredClone(source)) !== true) throw new InspectionAssistError('ACCESS_DENIED');
      }
      candidates.push(candidate);
    }
    const after = await this.templates.read(target);
    if (after.bindingFingerprint !== before.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
    // A second evidence check closes collection waits, not a dispatch transaction.
    for (const candidate of candidates) for (const source of candidate.sources) {
      if (await this.evidence.verify(structuredClone(after), structuredClone(source)) !== true) throw new InspectionAssistError('ACCESS_DENIED');
    }
    const final = await this.templates.read(target);
    if (final.bindingFingerprint !== before.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
    return { orderId: before.orderId, allocationId: before.allocationId, assetId: before.assetId, stage: before.stage,
      frozenTemplate: { templateId: before.template.id, version: before.template.version },
      bindingFingerprint: before.bindingFingerprint, candidates,
      missingFields: before.template.fields.filter(field => field.required && !candidates.some(row => row.fieldCode === field.code && row.status === 'candidate')).map(field => field.code),
      trust: 'untrusted_data' as const, status: 'awaiting_human_review' as const,
      persistence: 'unavailable' as const, recognitionEvidence: 'caller_supplied_not_model_execution_proof' as const };
  }
}
