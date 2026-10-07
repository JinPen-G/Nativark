import { Module, type DynamicModule } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { InspectionActionAuthority } from './inspection-action.authority';
import { PrismaInspectionDraftRepository } from './prisma-inspection-draft.repository';
import { PrismaInspectionEvidenceAuthority } from './prisma-inspection-evidence.authority';
import { InspectionDraftService } from './inspection-draft.service';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionManualPreparationService } from './inspection-manual-preparation.service';
import { InspectionCandidateService, type InspectionEvidenceAuthority } from './inspection-candidate.service';

type Dependencies = ConstructorParameters<typeof InspectionTemplateService>[0] & {
  evidence?: InspectionEvidenceAuthority;
  db?: Pick<PrismaClient, '$transaction' | 'aiInspectionDraft' | 'aiInspectionOperation' | 'aiInspectionEvidenceBinding' | 'fileAsset'>;
};

export function composeInspectionAssist(dependencies: Dependencies) {
  const templates = new InspectionTemplateService(dependencies);
  const authority = new InspectionActionAuthority(dependencies.guard, dependencies.credentials);
  const evidence = dependencies.db ? new PrismaInspectionEvidenceAuthority(dependencies.db, authority, templates) : undefined;
  const manual = new InspectionManualPreparationService(templates, evidence);
  const candidates = new InspectionCandidateService(templates, evidence ?? dependencies.evidence);
  const drafts = dependencies.db ? new InspectionDraftService(new PrismaInspectionDraftRepository(dependencies.db), authority,
    templates, manual, candidates, evidence) : undefined;
  return { templates, manual, candidates, drafts, evidence };
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
      ...(services.evidence ? [{ provide: PrismaInspectionEvidenceAuthority, useValue: services.evidence }] : [])],
      exports: [InspectionTemplateService, InspectionManualPreparationService, InspectionCandidateService,
        ...(services.drafts ? [InspectionDraftService] : []), ...(services.evidence ? [PrismaInspectionEvidenceAuthority] : [])] };
  }
}
