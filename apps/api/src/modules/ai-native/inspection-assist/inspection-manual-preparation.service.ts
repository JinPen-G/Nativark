import { z } from 'zod';
import type { RentalInspectionFieldDefinition } from '@rental-os/shared';
import { optionalUsageReading } from '../../rental-core/rental-usage-reading';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';

const inputSchema = inspectionTargetSchema.extend({ templateId: inspectionId,
  bindingFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  results: z.record(z.string().min(1).max(128), z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]))
    .refine(value => Object.keys(value).length <= 100),
}).strict();

/** Human-entered materials only. No save, model invocation or business submission.
 * Missing field/attachment evidence stays explicit; no local approval credential. */
export class InspectionManualPreparationService {
  constructor(private readonly templates: InspectionTemplateService) {}

  async prepare(value: unknown) {
    const input = parseInspectionInput(inputSchema, value);
    const target = { orderId: input.orderId, allocationId: input.allocationId, stage: input.stage, templateId: input.templateId };
    const before = await this.templates.read(target);
    if (before.bindingFingerprint !== input.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
    const fields = new Map(before.template.fields.map(row => [row.code, row]));
    const results: Record<string, string | number | boolean> = Object.create(null);
    const missing: string[] = [], unavailable: string[] = [];
    for (const code of Object.keys(input.results)) if (!fields.has(code)) throw new InspectionAssistError('INVALID_INPUT');
    for (const definition of fields.values()) {
      const value = input.results[definition.code];
      if (value === undefined || value === null || typeof value === 'string' && !value.trim()) {
        if (definition.required) missing.push(definition.code);
        continue;
      }
      // A file ID is not evidence. Until the authoritative attachment binding
      // producer is available, never pass photo fields as verified facts.
      if (definition.type === 'photo') { unavailable.push(definition.code); continue; }
      results[definition.code] = this.validate(definition, value);
    }
    const after = await this.templates.read(target);
    if (before.bindingFingerprint !== after.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
    return { orderId: after.orderId, allocationId: after.allocationId, assetId: after.assetId, stage: after.stage,
      frozenTemplate: { templateId: after.template.id, version: after.template.version },
      scope: after.scope, bindingFingerprint: after.bindingFingerprint, results, missingFields: missing,
      unavailableEvidenceFields: unavailable, status: 'prepared_not_saved_or_submitted' as const,
      persistence: 'unavailable' as const, submission: 'unavailable' as const,
      // Field completeness cannot prove original business evidence/permission.
      fieldCompleteness: missing.length || unavailable.length ? 'incomplete' as const : 'complete' as const,
      businessValidation: 'required_at_original_inspection_entry' as const,
      semantics: 'human_input_materials_not_recognition_approval_or_fulfillment' as const };
  }

  private validate(field: RentalInspectionFieldDefinition, value: string | number | boolean) {
    try {
      if (field.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new InspectionAssistError('INVALID_INPUT');
        if (field.usageMetric) optionalUsageReading(value, field.label);
        return value;
      }
      if (field.type === 'boolean' && typeof value === 'boolean') return value;
      if (field.type === 'text' && typeof value === 'string') return value;
      if (field.type === 'select' && typeof value === 'string' && field.options?.includes(value)) return value;
    } catch { throw new InspectionAssistError('INVALID_INPUT'); }
    throw new InspectionAssistError('INVALID_INPUT');
  }
}
