import { z } from 'zod';
import type { AiInspectionRecognitionInput, AiInspectionTarget } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionDraftService } from './inspection-draft.service';
import { InspectionTemplateService } from './inspection-template.service';
import { PrismaInspectionDraftRepository } from './prisma-inspection-draft.repository';
import { PrismaInspectionEvidenceAuthority } from './prisma-inspection-evidence.authority';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';

const schema = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId, operationId: inspectionId,
  expectedRevision: z.number().int().min(1).max(999), question: z.string().trim().min(1).max(4000) }).strict();

export class InspectionRecognitionService {
  constructor(private readonly repository: PrismaInspectionDraftRepository, private readonly drafts: InspectionDraftService,
    private readonly authority: InspectionActionAuthority, private readonly templates: InspectionTemplateService,
    private readonly evidence: PrismaInspectionEvidenceAuthority) {}

  async prepare(value: unknown, signal: AbortSignal) {
    const input = parseInspectionInput(schema, value);
    const target: AiInspectionTarget = { orderId: input.orderId, allocationId: input.allocationId, templateId: input.templateId, stage: input.stage };
    return this.authority.withAction(target, 'bind', async scope => {
      const fingerprint = requestFingerprint({ kind: 'inspection.input', scope, input });
      const replay = await this.repository.receipt(scope, input.operationId, fingerprint);
      if (replay.status === 'unavailable') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      const inputId = `inspection.input:${requestFingerprint({ scope, operationId: input.operationId })}`;
      if (replay.status === 'found') return { ...replay.result, inputId, dispatch: 'unavailable' as const, code: 'CAPABILITY_UNSUPPORTED' as const };
      const row = await this.repository.read(scope, input.draftId);
      if (!row || row.orderId !== target.orderId || row.allocationId !== target.allocationId || row.templateId !== target.templateId || row.stage !== target.stage) throw new InspectionAssistError('ACCESS_DENIED');
      if (!['draft_saved', 'prepared'].includes(row.status) || row.expiresAt.getTime() <= Date.now() || row.revision !== input.expectedRevision) throw new InspectionAssistError('REVISION_CONFLICT');
      const detail = await this.drafts.read({ ...target, draftId: row.id }), binding = await this.templates.read(target);
      if (binding.bindingFingerprint !== row.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      const sources = detail.state.evidence;
      if (!sources.length || sources.length > 8 || (detail.state.recognitionInputs?.length ?? 0) >= 8) throw new InspectionAssistError('INVALID_INPUT');
      const media: AiInspectionRecognitionInput['media'] = [];
      let total = 0;
      for (const source of sources) {
        if (signal.aborted) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
        const bytes = await this.evidence.readMedia({ ...target, ...source }, signal, 20 * 1024 * 1024 - total);
        total += bytes.sizeBytes;
        if (total > 20 * 1024 * 1024) throw new InspectionAssistError('INVALID_INPUT');
        media.push({ ...source, contentHash: bytes.contentHash, mediaType: bytes.mediaType, sizeBytes: bytes.sizeBytes,
          width: bytes.width, height: bytes.height, durationMs: bytes.durationMs });
      }
      const payload = { inputId, bindingFingerprint: row.bindingFingerprint, question: input.question,
        template: { id: binding.template.id, version: binding.template.version, fields: binding.template.fields.map(field => ({ code: field.code,
          type: field.type, label: field.label, required: field.required, ...(field.options ? { options: [...field.options] } : {}) })) }, media };
      const frozen: AiInspectionRecognitionInput = { ...payload, inputFingerprint: requestFingerprint(payload) };
      const evidenceFingerprint = await this.evidence.fingerprint(target, sources);
      const after = await this.templates.read(target);
      if (after.bindingFingerprint !== row.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      const state = { ...detail.state, reviewRequired: true, recognitionInputs: [...(detail.state.recognitionInputs ?? []), frozen] };
      delete state.submission;
      return this.authority.withAction(target, 'bind', async current => {
        if (requestFingerprint(current) !== requestFingerprint(scope)) throw new InspectionAssistError('ACCESS_DENIED');
        if (signal.aborted) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
        const result = await this.repository.change(scope, row.id, { operationId: input.operationId, fingerprint, expectedRevision: row.revision },
          row.bindingFingerprint, { state: JSON.parse(JSON.stringify(state)), inputFingerprint: frozen.inputFingerprint, evidenceFingerprint, status: 'draft_saved' });
        return { ...result, inputId, dispatch: 'unavailable' as const, code: 'CAPABILITY_UNSUPPORTED' as const };
      });
    });
  }
}
