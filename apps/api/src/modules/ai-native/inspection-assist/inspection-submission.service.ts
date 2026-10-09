import { z } from 'zod';
import type { AiInspectionActorScope, AiInspectionSubmissionMaterial, AiInspectionTarget } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionDraftService, inspectionSubmissionMaterialSchema } from './inspection-draft.service';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionManualPreparationService } from './inspection-manual-preparation.service';
import { PrismaInspectionDraftRepository } from './prisma-inspection-draft.repository';
import { PrismaInspectionEvidenceAuthority } from './prisma-inspection-evidence.authority';
import { OriginalInspectionApplication, type InspectionSubmissionReceipt } from './original-inspection.application';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';

const base = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId }).strict();
const operation = base.extend({ operationId: inspectionId, expectedRevision: z.number().int().min(1).max(997) }).strict();
const preparation = operation.extend({ actionId: inspectionId, handoverSignatureFileAssetId: inspectionId.optional() }).strict();
const targetOf = (input: AiInspectionTarget): AiInspectionTarget => ({ orderId: input.orderId, allocationId: input.allocationId, templateId: input.templateId, stage: input.stage });

export class InspectionSubmissionService {
  constructor(private readonly repository: PrismaInspectionDraftRepository, private readonly drafts: InspectionDraftService,
    private readonly authority: InspectionActionAuthority, private readonly templates: InspectionTemplateService,
    private readonly manual: InspectionManualPreparationService, private readonly evidence: PrismaInspectionEvidenceAuthority,
    private readonly core: Pick<RentalCoreService, 'getOrder'>, private readonly original?: OriginalInspectionApplication) {}

  async prepare(value: unknown) { return this.prepareMaterial(value, false); }
  async prepareReview(value: unknown) { return this.prepareMaterial(value, true); }

  /** Read only the receipt of the exact original preparation command. Absence
   * is not proof that a lost/in-flight transaction did not commit. */
  async reconcilePreparation(value: unknown) {
    const command = parseInspectionInput(z.object({ kind: z.enum(['prepare', 'prepareReview']), request: preparation }).strict(), value);
    const input = command.request, target = targetOf(input);
    return this.authority.withAction(target, 'submit', async scope => {
      await this.row(scope, input.draftId, target);
      const fingerprint = requestFingerprint({ kind: command.kind === 'prepareReview' ? 'inspection.prepareReview' : 'inspection.prepare', scope, input });
      const receipt = await this.repository.receipt(scope, input.operationId, fingerprint);
      return this.authority.withAction(target, 'submit', async current => {
        this.sameScope(scope, current);
        await this.row(current, input.draftId, target);
        if (receipt.status !== 'found') return { ...receipt, execution: 'not_attested' as const };
        if (receipt.result.draftId !== input.draftId || receipt.result.status !== 'prepared') throw new InspectionAssistError('BINDING_CHANGED');
        return { ...receipt, mode: command.kind === 'prepareReview' ? 'manual_review_only' as const : 'original_single' as const,
          execution: 'not_attested' as const, businessValidation: 'required_at_original_inspection_entry' as const };
      });
    });
  }

  private async prepareMaterial(value: unknown, allowReviewOnly: boolean) {
    const input = parseInspectionInput(preparation, value);
    const target = targetOf(input);
    return this.authority.withAction(target, 'submit', async scope => {
      const fingerprint = requestFingerprint({ kind: allowReviewOnly ? 'inspection.prepareReview' : 'inspection.prepare', scope, input });
      const mode = allowReviewOnly ? 'manual_review_only' as const : 'original_single' as const;
      const receipt = await this.repository.receipt(scope, input.operationId, fingerprint);
      if (receipt.status === 'found') return { ...receipt.result, mode, businessValidation: 'required_at_original_inspection_entry' as const };
      if (receipt.status === 'unavailable') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      const row = await this.row(scope, input.draftId, target);
      if (!['draft_saved', 'prepared'].includes(row.status) || row.expiresAt.getTime() <= Date.now()) throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      if (row.revision !== input.expectedRevision) throw new InspectionAssistError('REVISION_CONFLICT');
      const detail = await this.drafts.read({ ...target, draftId: row.id });
      const binding = await this.templates.read(target);
      if (binding.bindingFingerprint !== row.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      if (!allowReviewOnly) await this.singleAllocation(scope, target);
      const values = Object.fromEntries(Object.entries(detail.state.fields).map(([code, field]) => [code, field.value]));
      const materials = await this.manual.prepare({ ...target, bindingFingerprint: row.bindingFingerprint, results: values });
      if (materials.missingFields.length || materials.unavailableEvidenceFields.length) throw new InspectionAssistError('INVALID_INPUT');
      const evidenceHash = detail.state.evidence.length ? await this.evidence.fingerprint(target, detail.state.evidence) : requestFingerprint([]);
      if (evidenceHash !== row.evidenceFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      if (!allowReviewOnly && scope.audience === 'staff' && !input.handoverSignatureFileAssetId) throw new InspectionAssistError('INVALID_INPUT');
      const body: AiInspectionSubmissionMaterial['body'] = { templateId: target.templateId,
        results: Object.fromEntries(Object.entries(materials.results).map(([code, value]) => [code,
          binding.template.fields.find(field => field.code === code)?.type === 'photo' ? [String(value)] : value])),
        attachments: [...new Set([...detail.state.evidence.map(ref => ref.attachmentId), ...(input.handoverSignatureFileAssetId ? [input.handoverSignatureFileAssetId] : [])])],
        ...(input.handoverSignatureFileAssetId ? { handoverSignatureFileAssetId: input.handoverSignatureFileAssetId } : {}) };
      const material: AiInspectionSubmissionMaterial = { mode, actionId: input.actionId,
        requestHash: requestFingerprint({ orderId: target.orderId, ...body, returnItems: [], exceptions: [] }), body };
      const state = { ...detail.state, reviewRequired: false, submission: material };
      const after = await this.templates.read(target);
      if (after.bindingFingerprint !== row.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      return this.authority.withAction(target, 'submit', async current => {
        this.sameScope(scope, current);
        const result = await this.repository.change(scope, row.id, { operationId: input.operationId, fingerprint, expectedRevision: row.revision },
          row.bindingFingerprint, { state: JSON.parse(JSON.stringify(state)), status: 'prepared', submissionActionId: input.actionId });
        return { ...result, mode, businessValidation: 'required_at_original_inspection_entry' as const };
      });
    });
  }

  async submit(value: unknown) {
    const input = parseInspectionInput(operation, value), target = targetOf(input);
    if (!this.original) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    const original = this.original;
    return this.authority.withAction(target, 'submit', async scope => {
      const fingerprint = requestFingerprint({ kind: 'inspection.submit', scope, input });
      const replay = await this.repository.receipt(scope, input.operationId, fingerprint);
      if (replay.status === 'found') return { status: 'submission_unknown' as const, draftId: replay.result.draftId, nextAction: 'reconcile_original_action' as const };
      if (replay.status === 'unavailable') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      const row = await this.row(scope, input.draftId, target);
      if (row.status !== 'prepared' || row.revision !== input.expectedRevision || row.expiresAt.getTime() <= Date.now()) throw new InspectionAssistError('REVISION_CONFLICT');
      const detail = await this.drafts.read({ ...target, draftId: row.id });
      if (detail.state.reviewRequired) throw new InspectionAssistError('BINDING_CHANGED');
      const material = parseInspectionInput(inspectionSubmissionMaterialSchema, detail.state.submission);
      // Per-allocation materials are not an order-wide business command.
      // They must be handled through the original human aggregate workflow.
      if (material.mode === 'manual_review_only') throw new InspectionAssistError('CAPABILITY_UNSUPPORTED');
      if (material.actionId !== row.submissionActionId) throw new InspectionAssistError('BINDING_CHANGED');
      await this.singleAllocation(scope, target);
      const binding = await this.templates.read(target);
      if (binding.bindingFingerprint !== row.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
      const claim = await this.authority.withAction(target, 'submit', current => {
        this.sameScope(scope, current);
        return this.repository.claimSubmission(scope, row.id, { operationId: input.operationId, fingerprint, expectedRevision: row.revision }, row.bindingFingerprint);
      });
      if (!claim.claimed) return { status: 'submission_unknown' as const, draftId: row.id, nextAction: 'reconcile_original_action' as const };
      let receipt: InspectionSubmissionReceipt;
      try { receipt = await original.submit(scope, target, row.templateVersion, material); }
      catch { return { status: 'submission_unknown' as const, draftId: row.id, nextAction: 'reconcile_original_action' as const }; }
      return this.finish(scope, target, { ...row, revision: claim.result.revision }, material, receipt);
    });
  }

  async reconcile(value: unknown) {
    const input = parseInspectionInput(base, value), target = targetOf(input);
    if (!this.original) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    const original = this.original;
    return this.authority.withAction(target, 'submit', async scope => {
      const row = await this.row(scope, input.draftId, target);
      if (row.status === 'submitted') return { status: 'submitted' as const, draftId: row.id, inspectionId: row.inspectionId, draftLinked: true };
      if (row.status !== 'submission_unknown') throw new InspectionAssistError('INVALID_INPUT');
      const state = z.object({ submission: inspectionSubmissionMaterialSchema }).parse(row.state);
      const receipt = await original.reconcile(scope, target, row.templateVersion, state.submission);
      return this.finish(scope, target, row, state.submission, receipt);
    });
  }

  private async finish(scope: AiInspectionActorScope, target: AiInspectionTarget, row: { id: string; revision: number; bindingFingerprint: string },
    material: AiInspectionSubmissionMaterial, receipt: InspectionSubmissionReceipt) {
    if (receipt.status !== 'submitted') return { status: 'submission_unknown' as const, draftId: row.id,
      receiptLookup: receipt.status, actionId: material.actionId, requestHash: material.requestHash, nextAction: 'manual_reconcile_original_action' as const };
    const fingerprint = requestFingerprint({ kind: 'inspection.link', draftId: row.id, expectedRevision: row.revision,
      actionId: material.actionId, requestHash: material.requestHash, inspectionId: receipt.inspectionId });
    let draftLinked = false;
    try {
      await this.authority.withAction(target, 'submit', current => {
        this.sameScope(scope, current);
        return this.repository.change(scope, row.id, { operationId: `inspection.link:${requestFingerprint({ draftId: row.id, actionId: material.actionId })}`,
          fingerprint, expectedRevision: row.revision }, row.bindingFingerprint, { status: 'submitted', inspectionId: receipt.inspectionId });
      });
      draftLinked = true;
    } catch { /* A failed draft link must never erase the observed original business receipt. */ }
    return { status: 'submitted' as const, draftId: row.id, inspectionId: receipt.inspectionId, draftLinked };
  }

  private async singleAllocation(scope: AiInspectionActorScope, target: AiInspectionTarget) {
    const order = await this.core.getOrder(scope.tenantId, target.orderId);
    const active = order.allocations.filter(row => !['returned', 'released'].includes(row.status));
    if (active.length !== 1 || active[0].id !== target.allocationId || order.fulfillmentMode === 'carrier_shipping') {
      throw new InspectionAssistError('CAPABILITY_UNSUPPORTED');
    }
  }

  private async row(scope: AiInspectionActorScope, id: string, target: AiInspectionTarget) {
    const row = await this.repository.read(scope, id);
    if (!row || row.orderId !== target.orderId || row.allocationId !== target.allocationId || row.templateId !== target.templateId || row.stage !== target.stage) {
      throw new InspectionAssistError('ACCESS_DENIED');
    }
    return row;
  }

  private sameScope(a: AiInspectionActorScope, b: AiInspectionActorScope) {
    if (requestFingerprint(a) !== requestFingerprint(b)) throw new InspectionAssistError('ACCESS_DENIED');
  }
}
