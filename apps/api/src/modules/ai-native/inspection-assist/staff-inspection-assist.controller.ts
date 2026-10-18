import { Body, Controller, Header, HttpCode, HttpException, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AI_STAFF_INSPECTION_HTTP_DRAFT } from '@rental-os/shared';
import { z } from 'zod';
import type { StaffInspectionRequestFactory } from './inspection-assist.composition';
import { InspectionAssistError, inspectionId, inspectionTargetSchema } from './inspection-assist.validation';
import { withInspectionRequestSignal, respondInspectionHttp, type InspectionHttpRequest } from './inspection-http';

export const AI_STAFF_INSPECTION_REQUESTS = Symbol('AI_STAFF_INSPECTION_REQUESTS');
export const AI_STAFF_INSPECTION_ENABLED = Symbol('AI_STAFF_INSPECTION_ENABLED');
export const AI_STAFF_INSPECTION_OPERATIONS = Symbol('AI_STAFF_INSPECTION_OPERATIONS');
const operations = new Set<string>(Object.values(AI_STAFF_INSPECTION_HTTP_DRAFT.operations));
const evidenceFingerprint = z.object({ target: inspectionTargetSchema.extend({ templateId: inspectionId }).strict(),
  refs: z.array(z.object({ attachmentId: inspectionId, attachmentRevision: z.number().int().min(1).max(999) }).strict()).max(100) }).strict();

/** Fixed original-service operations only. Neither this transport nor preparing
 * a draft grants model dispatch, adoption, approval or inspection submission. */
@Controller(AI_STAFF_INSPECTION_HTTP_DRAFT.basePath)
export class StaffInspectionAssistController {
  constructor(@Inject(AI_STAFF_INSPECTION_REQUESTS) private readonly requests: StaffInspectionRequestFactory,
    @Inject(AI_STAFF_INSPECTION_ENABLED) private readonly enabled: boolean,
    @Optional() @Inject(AI_STAFF_INSPECTION_OPERATIONS) private readonly permittedOperations?: readonly string[]) {}

  @Post(':operation')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  consume(@Req() request: InspectionHttpRequest, @Param('operation') operation: string, @Body() body: unknown) {
    return respondInspectionHttp(async () => {
      if (this.enabled !== true) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      if (!operations.has(operation)) throw new HttpException({ code: 'AI_INVALID_INPUT', retryable: false }, 400);
      if (this.permittedOperations && !this.permittedOperations.includes(operation)) {
        throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      }
      // Snapshot before the first await; original service schemas reject caller
      // identity, raw model output and arbitrary configuration/URL properties.
      const input = structuredClone(body);
      return withInspectionRequestSignal(request, signal => this.requests.withRequest(request, async services => {
        const absent = () => { throw new InspectionAssistError('STORAGE_UNAVAILABLE'); };
        switch (operation) {
          case 'history-read': return services.readHistory(input);
          case 'receipt-host-read': return services.readReceiptHost(input);
          case 'host-read': return services.readHost(input);
          case 'template-read': return services.templates.read(input);
          case 'evidence-bind': return services.evidence ? services.evidence.bind(input) : absent();
          case 'evidence-fingerprint': {
            const parsed = evidenceFingerprint.parse(input);
            return services.evidence ? services.evidence.fingerprint(parsed.target, parsed.refs) : absent();
          }
          case 'draft-create': return services.drafts ? services.drafts.create(input) : absent();
          case 'draft-read': return services.drafts ? services.drafts.read(input) : absent();
          case 'draft-edit': return (await services.editHumanReview(input)).mutation;
          case 'evidence-replace': return services.drafts ? services.drafts.replaceEvidence(input) : absent();
          case 'draft-operation': return services.drafts ? services.drafts.reconcileOperation(input) : absent();
          case 'input-prepare': return services.recognition ? services.recognition.prepare(input, signal) : absent();
          case 'input-receipt': return services.recognition ? services.recognition.readPreparation(input) : absent();
          // Preserve the existing wire projection while checking that the
          // original result still belongs to the current human-review draft.
          case 'result-read': return (await services.readRecognitionReview(input)).recognition;
          case 'result-save': return (await services.saveRecognitionReview(input)).receipt;
          // Receipt recovery observes only the saved association. It must not
          // reopen current/withdrawn media or load a candidate review body.
          case 'result-save-receipt': return services.recognitionResults.readSavedReceipt(input);
          case 'submission-review': return services.submission ? services.submission.prepareReview(input) : absent();
          case 'submission-prepare': return services.submission ? services.submission.prepare(input) : absent();
          case 'submission-preparation': return services.submission ? services.submission.reconcilePreparation(input) : absent();
          case 'submission-submit': return services.submission ? services.submission.submit(input) : absent();
          // Querying the original receipt must not write a draft link or
          // initiate another inspection. Explicit submit remains separate.
          case 'submission-read': {
            if (!services.submission) return absent();
            const receipt = await services.submission.readReceipt(input);
            return receipt.status === 'not_observed' || receipt.status === 'unavailable'
              ? { ...receipt, status: 'submission_unknown' as const, nextAction: 'manual_reconcile_original_action' as const }
              : receipt;
          }
          default: throw new InspectionAssistError('INVALID_INPUT');
        }
      }, signal), 15000);
    }, operation.startsWith('submission-') ? operation === 'submission-submit' || operation === 'submission-read' ? 'submission-read' : 'submission-preparation'
      : operation.startsWith('input-') ? 'input-receipt' : operation.startsWith('result-') ? 'result-save-receipt' : 'draft-operation');
  }
}
