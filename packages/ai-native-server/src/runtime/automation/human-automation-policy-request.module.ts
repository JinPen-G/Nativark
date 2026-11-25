import { Module, type DynamicModule } from '@nestjs/common';
import { AutomationManagementError } from './automation-management.validation';
import { HumanAutomationPolicyRequestFactory, type HumanAutomationPolicyRequestDependencies } from './human-automation-policy-request.composition';
import { HumanAutomationPolicyRequestController } from './human-automation-policy-request.controller';

@Module({})
export class HumanAutomationPolicyRequestModule {
  static register(options: { enabled?: boolean; dependencies?: HumanAutomationPolicyRequestDependencies } = {}): DynamicModule {
    if (options.enabled !== true) return { module: HumanAutomationPolicyRequestModule, controllers: [], providers: [] };
    if (!options.dependencies) throw new AutomationManagementError('unavailable');
    return { module: HumanAutomationPolicyRequestModule, controllers: [HumanAutomationPolicyRequestController],
      providers: [{ provide: HumanAutomationPolicyRequestFactory, useValue: new HumanAutomationPolicyRequestFactory(options.dependencies) }] };
  }
}
