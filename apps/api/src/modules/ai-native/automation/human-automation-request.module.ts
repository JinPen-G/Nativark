import { Module, type DynamicModule } from '@nestjs/common';
import { AutomationError } from './prisma-automation.authority';
import { HumanAutomationRequestFactory, type HumanAutomationRequestDependencies } from './human-automation-request.composition';
import { OperatorAutomationController, StaffAutomationController } from './human-automation-request.controller';

export type HumanAutomationHttpOptions = { enabled?: boolean; dependencies?: HumanAutomationRequestDependencies };

@Module({})
export class HumanAutomationRequestModule {
  /** Current-human server consumers only. No HTTP or background scan; the
   * exported factory still requires a fresh request and original action grants. */
  static registerRequests(options: HumanAutomationHttpOptions = {}): DynamicModule {
    if (options.enabled !== true) return { module: HumanAutomationRequestModule, controllers: [], providers: [], exports: [] };
    if (!options.dependencies) throw new AutomationError('unavailable');
    return { module: HumanAutomationRequestModule, controllers: [],
      providers: [{ provide: HumanAutomationRequestFactory, useValue: new HumanAutomationRequestFactory(options.dependencies) }],
      exports: [HumanAutomationRequestFactory] };
  }

  static register(options: HumanAutomationHttpOptions = {}): DynamicModule {
    if (options.enabled !== true) return { module: HumanAutomationRequestModule, controllers: [], providers: [] };
    if (!options.dependencies) throw new AutomationError('unavailable');
    return { module: HumanAutomationRequestModule, controllers: [OperatorAutomationController, StaffAutomationController],
      providers: [{ provide: HumanAutomationRequestFactory, useValue: new HumanAutomationRequestFactory(options.dependencies) }] };
  }
}
