import { Module, type DynamicModule } from '@nestjs/common';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionManualPreparationService } from './inspection-manual-preparation.service';

export function composeInspectionAssist(dependencies: ConstructorParameters<typeof InspectionTemplateService>[0]) {
  const templates = new InspectionTemplateService(dependencies);
  return { templates, manual: new InspectionManualPreparationService(templates) };
}

/** No Controller/AppModule/worker registration. Original business pages remain available. */
@Module({})
export class InspectionAssistModule {
  static register(dependencies: ConstructorParameters<typeof InspectionTemplateService>[0]): DynamicModule {
    const services = composeInspectionAssist(dependencies);
    return { module: InspectionAssistModule, providers: [{ provide: InspectionTemplateService, useValue: services.templates },
      { provide: InspectionManualPreparationService, useValue: services.manual }],
      exports: [InspectionTemplateService, InspectionManualPreparationService] };
  }
}
