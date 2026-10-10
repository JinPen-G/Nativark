import { Module, type DynamicModule } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { InspectionActionAuthority } from './inspection-action.authority';
import { PrismaInspectionDraftRepository } from './prisma-inspection-draft.repository';
import { PrismaInspectionEvidenceAuthority } from './prisma-inspection-evidence.authority';
import { InspectionDraftService } from './inspection-draft.service';
import { InspectionSubmissionService } from './inspection-submission.service';
import { InspectionRecognitionService } from './inspection-recognition.service';
import { InspectionRecognitionResultService } from './inspection-recognition-result.service';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import type { TaskModelPolicy } from '../model-input/task-model-input';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { OriginalInspectionApplication } from './original-inspection.application';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import type { RentalCoreController } from '../../rental-core/rental-core.controller';
import type { RentalIdempotencyRepository } from '../../rental-core/rental-idempotency.repository';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionManualPreparationService } from './inspection-manual-preparation.service';
import { InspectionCandidateService, type InspectionEvidenceAuthority } from './inspection-candidate.service';
import { InspectionAssistError } from './inspection-assist.validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composeTaskModelHost, type TaskModelHostDependencies } from '../runner/model-task-host.composition';

/** Server composition only: material comes from the original authorized frozen
 * inspection input, never a request-provided prompt/hash or an SDK result. */
export async function composeInspectionRecognitionTaskHost(recognition: Pick<InspectionRecognitionService, 'gatewayMedia'>,
  reference: unknown, dependencies: Omit<TaskModelHostDependencies, 'kind' | 'task'> & {
    task: Omit<TaskModelHostDependencies['task'], 'material'>;
  }) {
  if (typeof recognition?.gatewayMedia !== 'function') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
  const bound = await recognition.gatewayMedia(structuredClone(reference));
  const text = JSON.stringify({ purpose: 'inspection_candidates_only_not_business_facts',
    draftId: bound.draftId, draftRevision: bound.draftRevision, inputFingerprint: bound.input.inputFingerprint,
    question: bound.input.question, template: bound.input.template });
  return composeTaskModelHost({ ...dependencies, kind: 'image',
    runtime: { ...dependencies.runtime, ports: { ...dependencies.runtime.ports, media: bound.media } },
    task: { ...dependencies.task, material: { maxOutputTokens: dependencies.gatewayScene.maxOutputTokens,
      messages: [{ role: 'user', content: [{ kind: 'text', text }, ...bound.input.media.map(ref => ({ kind: 'image' as const,
        attachmentId: ref.attachmentId, attachmentRevision: ref.attachmentRevision }))] }] } } });
}

type Dependencies = ConstructorParameters<typeof InspectionTemplateService>[0] & {
  /** Server-only dependencies; credentials are bound by THIS request factory,
   * never independently supplied by an external result caller. */
  recognitionResults?: Omit<PersistedTaskAuthorizationDependencies, 'credentials'> & {
    policy: TaskModelPolicy; financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  };
  evidence?: InspectionEvidenceAuthority;
  storage?: Pick<FileStorageRuntimeService, 'readInspectionBytes'>;
  originalInspection?: { controller: Pick<RentalCoreController, 'createInspection'>; receipts: Pick<RentalIdempotencyRepository, 'find'> };
  db?: Pick<PrismaClient, '$transaction' | 'aiInspectionDraft' | 'aiInspectionOperation' | 'aiInspectionEvidenceBinding' | 'fileAsset'>;
};

/** Server-side request binding only. Neither this factory nor the credentials
 * grant inspection permission; every service still runs the original Guard.
 * Do not populate this argument from a model or an inspection request body. */
export class StaffInspectionRequestFactory {
  constructor(private readonly dependencies: Omit<Dependencies, 'credentials'>) {}

  open(request: { headers: { authorization?: unknown }; requestId: unknown }) {
    const token = request?.headers?.authorization;
    const requestId = request?.requestId;
    if (typeof token !== 'string' || token.length < 1 || token.length > 8192
      || typeof requestId !== 'string' || requestId.length > 191
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(requestId)) {
      throw new InspectionAssistError('ACCESS_DENIED');
    }
    // Snapshot scalars, never retain the mutable incoming request or share a
    // credential source between requests. close() erases our token reference.
    let authorization: string | undefined = token;
    const credentials = {
      async current() {
        if (authorization === undefined) throw new InspectionAssistError('ACCESS_DENIED');
        return { authorization, requestId, audience: 'staff' as const };
      },
    };
    const services = composeInspectionAssist({ ...this.dependencies, credentials });
    return { ...services,
      /** Actual employee consumption entry. Receipt lookup is explicit and
       * retains its existing stronger action permission; never silently
       * downgrade a denied receipt request into a successful draft read. */
      readCurrentReview: async (value: unknown, includeReceipt = false) => {
        if (typeof includeReceipt !== 'boolean') throw new InspectionAssistError('INVALID_INPUT');
        if (!services.drafts) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
        const review = await services.drafts.readReview(value);
        if (!includeReceipt) return { review, receipt: { status: 'not_requested' as const }, businessActionRequested: false as const };
        if (!services.submission) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
        const receipt = await services.submission.readReceipt({ ...review.target, draftId: review.draftId });
        const current = await services.drafts.readReview(value);
        if (requestFingerprint(current) !== requestFingerprint(review)) throw new InspectionAssistError('REVISION_CONFLICT');
        return { review, receipt, businessActionRequested: false as const };
      },
      recognitionTaskHost: (reference: unknown, dependencies: Parameters<typeof composeInspectionRecognitionTaskHost>[2]) => {
        if (!services.recognition || authorization === undefined) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
        // The task host must use the same request session as media/draft reads.
        // A second supplied credential source cannot swap the invocation actor.
        return composeInspectionRecognitionTaskHost(services.recognition, reference, {
          ...dependencies, credentials,
        });
      },
      close() { authorization = undefined; } };
  }
}

export function composeInspectionAssist(dependencies: Dependencies) {
  const templates = new InspectionTemplateService(dependencies);
  const authority = new InspectionActionAuthority(dependencies.guard, dependencies.credentials);
  const evidence = dependencies.db ? new PrismaInspectionEvidenceAuthority(dependencies.db, authority, templates, dependencies.storage) : undefined;
  const manual = new InspectionManualPreparationService(templates, evidence);
  const candidates = new InspectionCandidateService(templates, evidence ?? dependencies.evidence);
  const repository = dependencies.db ? new PrismaInspectionDraftRepository(dependencies.db) : undefined;
  const drafts = repository ? new InspectionDraftService(repository, authority, templates, manual, candidates, evidence) : undefined;
  const original = dependencies.originalInspection ? new OriginalInspectionApplication(dependencies.guard, dependencies.credentials,
    dependencies.originalInspection.controller, dependencies.originalInspection.receipts) : undefined;
  const submission = repository && drafts && evidence ? new InspectionSubmissionService(repository, drafts, authority, templates, manual, evidence, dependencies.core, original) : undefined;
  const recognition = repository && drafts && evidence ? new InspectionRecognitionService(repository, drafts, authority, templates, evidence) : undefined;
  const resultSource = dependencies.recognitionResults;
  const resultAuthorization = resultSource ? composePersistedTaskAuthorization({ ...resultSource, credentials: dependencies.credentials }) : undefined;
  const recognitionResults = new InspectionRecognitionResultService(authority, recognition, candidates, drafts,
    resultSource && resultAuthorization ? { ...resultSource, tasks: resultAuthorization.tasks, authority: resultAuthorization.authority } : undefined);
  return { templates, manual, candidates, drafts, evidence, submission, recognition, recognitionResults };
}

/** No Controller/AppModule/worker registration. Original business pages remain available. */
@Module({})
export class InspectionAssistModule {
  /** Preferred server integration: keep shared ports in DI, bind credentials
   * separately for each incoming staff request, close in the handler's finally.
   * No globally mutable session provider is required by this registration. */
  static registerStaffRequests(dependencies: Omit<Dependencies, 'credentials'>): DynamicModule {
    return { module: InspectionAssistModule,
      providers: [{ provide: StaffInspectionRequestFactory, useValue: new StaffInspectionRequestFactory(dependencies) }],
      exports: [StaffInspectionRequestFactory] };
  }

  static register(dependencies: Dependencies): DynamicModule {
    const services = composeInspectionAssist(dependencies);
    return { module: InspectionAssistModule, providers: [{ provide: InspectionTemplateService, useValue: services.templates },
      { provide: StaffInspectionRequestFactory, useValue: new StaffInspectionRequestFactory(dependencies) },
      { provide: InspectionManualPreparationService, useValue: services.manual },
      { provide: InspectionCandidateService, useValue: services.candidates },
      { provide: InspectionRecognitionResultService, useValue: services.recognitionResults },
      ...(services.drafts ? [{ provide: InspectionDraftService, useValue: services.drafts }] : []),
      ...(services.evidence ? [{ provide: PrismaInspectionEvidenceAuthority, useValue: services.evidence }] : []),
      ...(services.submission ? [{ provide: InspectionSubmissionService, useValue: services.submission }] : []),
      ...(services.recognition ? [{ provide: InspectionRecognitionService, useValue: services.recognition }] : [])],
      exports: [StaffInspectionRequestFactory, InspectionTemplateService, InspectionManualPreparationService, InspectionCandidateService, InspectionRecognitionResultService,
        ...(services.drafts ? [InspectionDraftService] : []), ...(services.evidence ? [PrismaInspectionEvidenceAuthority] : []),
        ...(services.submission ? [InspectionSubmissionService] : []), ...(services.recognition ? [InspectionRecognitionService] : [])] };
  }
}
