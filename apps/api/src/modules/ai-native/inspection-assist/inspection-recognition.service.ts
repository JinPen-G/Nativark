import { z } from 'zod';
import type { AiInspectionRecognitionInput, AiInspectionTarget } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionDraftService } from './inspection-draft.service';
import { InspectionTemplateService } from './inspection-template.service';
import { PrismaInspectionDraftRepository } from './prisma-inspection-draft.repository';
import { PrismaInspectionEvidenceAuthority } from './prisma-inspection-evidence.authority';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';
import type { GatewayMediaAttachmentResolver } from '../gateway-intent';
import { ModelGatewayError } from '../model-gateway.ports';

const schema = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId, operationId: inspectionId,
  expectedRevision: z.number().int().min(1).max(999), question: z.string().trim().min(1).max(4000) }).strict();

/** Derive the step kind only from original server-frozen media, not HTTP input. */
export function inspectionRecognitionMediaKind(input: AiInspectionRecognitionInput): 'image' | 'audio' {
  if (!input.media.length || input.media.length > 8) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
  if (input.media.every(ref => ref.mediaType === 'audio/wav' && Number.isSafeInteger(ref.durationMs)
    && ref.durationMs! > 0)) return 'audio';
  if (input.media.every(ref => ['image/png', 'image/jpeg'].includes(ref.mediaType))) return 'image';
  throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
}

export class InspectionRecognitionService {
  constructor(private readonly repository: PrismaInspectionDraftRepository, private readonly drafts: InspectionDraftService,
    private readonly authority: InspectionActionAuthority, private readonly templates: InspectionTemplateService,
    private readonly evidence: PrismaInspectionEvidenceAuthority) {}

  /** Server-only adapter for the existing Gateway. The returned function stays
   * in request memory, never a DTO, dispatch grant or persisted credential. */
  async gatewayMedia(value: unknown) {
    const input = parseInspectionInput(inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
      inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).strict(), value);
    const target: AiInspectionTarget = { orderId: input.orderId, allocationId: input.allocationId,
      templateId: input.templateId, stage: input.stage };
    const load = () => this.authority.withAction(target, 'bind', async scope => {
      const row = await this.repository.read(scope, input.draftId);
      if (!row || row.orderId !== target.orderId || row.allocationId !== target.allocationId
        || row.templateId !== target.templateId || row.stage !== target.stage) throw new InspectionAssistError('ACCESS_DENIED');
      if (row.revision !== input.expectedRevision || !['draft_saved', 'prepared'].includes(row.status)
        || row.expiresAt.getTime() <= Date.now()) throw new InspectionAssistError('REVISION_CONFLICT');
      const detail = await this.drafts.read({ ...target, draftId: input.draftId });
      const matches = detail.state.recognitionInputs?.filter(item => item.inputId === input.inputId) ?? [];
      if (matches.length !== 1 || detail.revision !== row.revision) throw new InspectionAssistError('BINDING_CHANGED');
      const frozen = structuredClone(matches[0]);
      const { inputFingerprint, ...payload } = frozen;
      const binding = await this.templates.read(target);
      if (requestFingerprint(payload) !== inputFingerprint || frozen.bindingFingerprint !== row.bindingFingerprint
        || binding.bindingFingerprint !== row.bindingFingerprint || binding.template.id !== frozen.template.id
        || binding.template.version !== frozen.template.version || !frozen.media.length || frozen.media.length > 8
        || frozen.media.some(ref => !detail.state.evidence.some(current => current.attachmentId === ref.attachmentId
          && current.attachmentRevision === ref.attachmentRevision))
        || await this.evidence.fingerprint(target, detail.state.evidence) !== row.evidenceFingerprint) {
        throw new InspectionAssistError('BINDING_CHANGED');
      }
      const current = await this.repository.read(scope, input.draftId);
      if (!current || current.revision !== row.revision || current.status !== row.status
        || current.expiresAt.getTime() <= Date.now() || requestFingerprint(current.state) !== requestFingerprint(row.state)) {
        throw new InspectionAssistError('BINDING_CHANGED');
      }
      return { scope, frozen };
    });
    const initial = await load();
    const kind = inspectionRecognitionMediaKind(initial.frozen);
    const media: GatewayMediaAttachmentResolver = { assertCurrent: async (context, references, signal) => {
      context = structuredClone(context); references = structuredClone(references);
      const current = await load();
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      if (context.tenantId !== current.scope.tenantId || context.workspaceId !== current.scope.workspaceId
        || context.actorId !== current.scope.ownerId || requestFingerprint(current.scope) !== requestFingerprint(initial.scope)
        || current.frozen.inputFingerprint !== initial.frozen.inputFingerprint) throw new InspectionAssistError('ACCESS_DENIED');
      if (references.length < 1 || references.length > 8) throw new InspectionAssistError('INVALID_INPUT');
      for (const ref of references) {
        const expected = current.frozen.media.find(item => item.attachmentId === ref.attachmentId
          && item.attachmentRevision === ref.attachmentRevision);
        if (ref.kind !== kind || !expected || expected.contentHash !== ref.contentHash || expected.mediaType !== ref.mediaType) {
          throw new InspectionAssistError('BINDING_CHANGED');
        }
      }
    }, resolve: async (context, reference, signal) => {
      context = structuredClone(context); reference = structuredClone(reference);
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      const before = await load();
      const scope = before.scope;
      if (context.tenantId !== scope.tenantId || context.workspaceId !== scope.workspaceId || context.actorId !== scope.ownerId
        || requestFingerprint(scope) !== requestFingerprint(initial.scope)) throw new InspectionAssistError('ACCESS_DENIED');
      if (before.frozen.inputFingerprint !== initial.frozen.inputFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      const selected = before.frozen.media.filter(item => item.attachmentId === reference.attachmentId
        && item.attachmentRevision === reference.attachmentRevision);
      if (reference.kind !== kind || selected.length !== 1
        || inspectionRecognitionMediaKind(before.frozen) !== kind || selected[0].sizeBytes > 524288) {
        throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      }
      const expected = selected[0];
      const resolved = await this.evidence.readMedia({ ...target, attachmentId: expected.attachmentId,
        attachmentRevision: expected.attachmentRevision }, signal, 524288);
      const after = await load();
      if (signal.aborted) throw new ModelGatewayError('CANCELLED');
      if (requestFingerprint(after.scope) !== requestFingerprint(scope)
        || after.frozen.inputFingerprint !== before.frozen.inputFingerprint
        || resolved.contentHash !== expected.contentHash || resolved.sizeBytes !== expected.sizeBytes
        || resolved.mediaType !== expected.mediaType || resolved.durationMs !== expected.durationMs
        || (resolved.mediaType !== 'image/png' && resolved.mediaType !== 'image/jpeg' && resolved.mediaType !== 'audio/wav')) {
        throw new InspectionAssistError('BINDING_CHANGED');
      }
      return { attachmentId: expected.attachmentId, attachmentRevision: expected.attachmentRevision,
        mediaType: resolved.mediaType, bytes: new Uint8Array(resolved.bytes), contentHash: resolved.contentHash };
    } };
    return { draftId: input.draftId, draftRevision: input.expectedRevision, input: structuredClone(initial.frozen), media };
  }

  /** Original preparation receipt only. No attachment byte read, input write,
   * task creation or model dispatch, including when a receipt is absent. */
  async readPreparation(value: unknown) {
    const input = parseInspectionInput(schema, value);
    const target = { orderId: input.orderId, allocationId: input.allocationId, templateId: input.templateId, stage: input.stage };
    return this.authority.withAction(target, 'bind', async scope => {
      await this.drafts.read({ ...target, draftId: input.draftId });
      const fingerprint = requestFingerprint({ kind: 'inspection.input', scope, input });
      const receipt = await this.repository.receipt(scope, input.operationId, fingerprint);
      if (receipt.status === 'found' && receipt.result.draftId !== input.draftId) throw new InspectionAssistError('BINDING_CHANGED');
      return { ...receipt, inputId: `inspection.input:${requestFingerprint({ scope, operationId: input.operationId })}`,
        execution: 'not_attested' as const, retryable: false as const };
    });
  }

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
