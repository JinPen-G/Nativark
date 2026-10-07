import { Module, type DynamicModule } from '@nestjs/common';
import { InspectionTemplateService } from './inspection-template.service';

export function composeInspectionAssist(dependencies: ConstructorParameters<typeof InspectionTemplateService>[0]) {
  return { templates: new InspectionTemplateService(dependencies) };
}

/** No Controller/AppModule/worker registration. Original business pages remain available. */
@Module({})
export class InspectionAssistModule {
  static register(dependencies: ConstructorParameters<typeof InspectionTemplateService>[0]): DynamicModule {
    const services = composeInspectionAssist(dependencies);
    return { module: InspectionAssistModule, providers: [{ provide: InspectionTemplateService, useValue: services.templates }],
      exports: [InspectionTemplateService] };
  }
}
