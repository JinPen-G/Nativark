import { Module, type DynamicModule } from '@nestjs/common';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionManualPreparationService } from './inspection-manual-preparation.service';
import { InspectionCandidateService, type InspectionEvidenceAuthority } from './inspection-candidate.service';

type Dependencies = ConstructorParameters<typeof InspectionTemplateService>[0] & { evidence?: InspectionEvidenceAuthority };

export function composeInspectionAssist(dependencies: Dependencies) {
  const templates = new InspectionTemplateService(dependencies);
  return { templates, manual: new InspectionManualPreparationService(templates),
    candidates: new InspectionCandidateService(templates, dependencies.evidence) };
}

/** No Controller/AppModule/worker registration. Original business pages remain available. */
@Module({})
export class InspectionAssistModule {
  static register(dependencies: Dependencies): DynamicModule {
    const services = composeInspectionAssist(dependencies);
    return { module: InspectionAssistModule, providers: [{ provide: InspectionTemplateService, useValue: services.templates },
      { provide: InspectionManualPreparationService, useValue: services.manual },
      { provide: InspectionCandidateService, useValue: services.candidates }],
      exports: [InspectionTemplateService, InspectionManualPreparationService, InspectionCandidateService] };
  }
}
