import { Module, type DynamicModule } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { InspectionActionAuthority } from './inspection-action.authority';
import { PrismaInspectionDraftRepository } from './prisma-inspection-draft.repository';
import { PrismaInspectionEvidenceAuthority } from './prisma-inspection-evidence.authority';
import { InspectionDraftService } from './inspection-draft.service';
import { InspectionSubmissionService } from './inspection-submission.service';
import { InspectionRecognitionService } from './inspection-recognition.service';
import { OriginalInspectionApplication } from './original-inspection.application';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import type { RentalCoreController } from '../../rental-core/rental-core.controller';
import type { RentalIdempotencyRepository } from '../../rental-core/rental-idempotency.repository';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionManualPreparationService } from './inspection-manual-preparation.service';
import { InspectionCandidateService, type InspectionEvidenceAuthority } from './inspection-candidate.service';
import { InspectionAssistError } from './inspection-assist.validation';

type Dependencies = ConstructorParameters<typeof InspectionTemplateService>[0] & {
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
    const services = composeInspectionAssist({ ...this.dependencies, credentials: {
      async current() {
        if (authorization === undefined) throw new InspectionAssistError('ACCESS_DENIED');
        return { authorization, requestId, audience: 'staff' as const };
      },
    } });
    return { ...services, close() { authorization = undefined; } };
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
  return { templates, manual, candidates, drafts, evidence, submission, recognition };
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
      ...(services.drafts ? [{ provide: InspectionDraftService, useValue: services.drafts }] : []),
      ...(services.evidence ? [{ provide: PrismaInspectionEvidenceAuthority, useValue: services.evidence }] : []),
      ...(services.submission ? [{ provide: InspectionSubmissionService, useValue: services.submission }] : []),
      ...(services.recognition ? [{ provide: InspectionRecognitionService, useValue: services.recognition }] : [])],
      exports: [StaffInspectionRequestFactory, InspectionTemplateService, InspectionManualPreparationService, InspectionCandidateService,
        ...(services.drafts ? [InspectionDraftService] : []), ...(services.evidence ? [PrismaInspectionEvidenceAuthority] : []),
        ...(services.submission ? [InspectionSubmissionService] : []), ...(services.recognition ? [InspectionRecognitionService] : [])] };
  }
}
