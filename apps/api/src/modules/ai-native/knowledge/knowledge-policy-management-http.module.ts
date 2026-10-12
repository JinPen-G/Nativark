import { Module, type DynamicModule } from '@nestjs/common';
import { KNOWLEDGE_POLICY_MANAGEMENT, type KnowledgePolicyManagementApplication } from './knowledge-policy-management.composition';
import { KnowledgePolicyManagementController } from './knowledge-policy-management.controller';
import { KnowledgePolicyManagementError } from './knowledge-policy-management.validation';

/** No controllers on default import; production roots and application assembly belong to the host. */
@Module({})
export class KnowledgePolicyManagementHttpModule {
  static registerHttp(options: { enabled: boolean; application?: KnowledgePolicyManagementApplication }): DynamicModule {
    if (options?.enabled !== true) return { module: KnowledgePolicyManagementHttpModule, controllers: [], providers: [] };
    const application = options.application;
    for (const method of ['prepareTarget', 'target', 'bindTarget', 'read', 'prepare', 'preparation', 'commit', 'operation'] as const) {
      if (typeof application?.[method] !== 'function') throw new KnowledgePolicyManagementError('unavailable');
    }
    return { module: KnowledgePolicyManagementHttpModule, controllers: [KnowledgePolicyManagementController],
      providers: [{ provide: KNOWLEDGE_POLICY_MANAGEMENT, useValue: application }] };
  }
}
