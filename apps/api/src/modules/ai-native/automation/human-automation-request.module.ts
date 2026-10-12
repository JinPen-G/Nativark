import { Module, type DynamicModule } from '@nestjs/common';
import { AutomationError } from './prisma-automation.authority';
import { HumanAutomationRequestFactory, type HumanAutomationRequestDependencies } from './human-automation-request.composition';
import { OperatorAutomationController, StaffAutomationController } from './human-automation-request.controller';

export type HumanAutomationHttpOptions = { enabled?: boolean; dependencies?: HumanAutomationRequestDependencies };

@Module({})
export class HumanAutomationRequestModule {
  static register(options: HumanAutomationHttpOptions = {}): DynamicModule {
    if (options.enabled !== true) return { module: HumanAutomationRequestModule, controllers: [], providers: [] };
    if (!options.dependencies) throw new AutomationError('unavailable');
    return { module: HumanAutomationRequestModule, controllers: [OperatorAutomationController, StaffAutomationController],
      providers: [{ provide: HumanAutomationRequestFactory, useValue: new HumanAutomationRequestFactory(options.dependencies) }] };
  }
}
