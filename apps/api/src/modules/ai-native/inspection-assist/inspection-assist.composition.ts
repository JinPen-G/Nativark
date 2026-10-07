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

type Dependencies = ConstructorParameters<typeof InspectionTemplateService>[0] & {
  evidence?: InspectionEvidenceAuthority;
  storage?: Pick<FileStorageRuntimeService, 'readInspectionBytes'>;
  originalInspection?: { controller: Pick<RentalCoreController, 'createInspection'>; receipts: Pick<RentalIdempotencyRepository, 'find'> };
  db?: Pick<PrismaClient, '$transaction' | 'aiInspectionDraft' | 'aiInspectionOperation' | 'aiInspectionEvidenceBinding' | 'fileAsset'>;
};

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
  static register(dependencies: Dependencies): DynamicModule {
    const services = composeInspectionAssist(dependencies);
    return { module: InspectionAssistModule, providers: [{ provide: InspectionTemplateService, useValue: services.templates },
      { provide: InspectionManualPreparationService, useValue: services.manual },
      { provide: InspectionCandidateService, useValue: services.candidates },
      ...(services.drafts ? [{ provide: InspectionDraftService, useValue: services.drafts }] : []),
      ...(services.evidence ? [{ provide: PrismaInspectionEvidenceAuthority, useValue: services.evidence }] : []),
      ...(services.submission ? [{ provide: InspectionSubmissionService, useValue: services.submission }] : []),
      ...(services.recognition ? [{ provide: InspectionRecognitionService, useValue: services.recognition }] : [])],
      exports: [InspectionTemplateService, InspectionManualPreparationService, InspectionCandidateService,
        ...(services.drafts ? [InspectionDraftService] : []), ...(services.evidence ? [PrismaInspectionEvidenceAuthority] : []),
        ...(services.submission ? [InspectionSubmissionService] : []), ...(services.recognition ? [InspectionRecognitionService] : [])] };
  }
}
