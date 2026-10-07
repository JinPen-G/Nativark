import { Module, type DynamicModule } from '@nestjs/common';
import { HumanKnowledgeService } from './human-knowledge.service';
import { HumanKnowledgeContextService } from './human-knowledge-context.service';
import { HumanKnowledgeIndexService } from './human-knowledge-index.service';
import { HumanKnowledgeInputService, type HumanKnowledgeInputDependencies } from './human-knowledge-input.service';
import { composePersistedHumanKnowledge } from './persistent-knowledge.composition';

@Module({})
export class HumanKnowledgeModule {
  static register(ports: HumanKnowledgeInputDependencies): DynamicModule {
    const { management, context, index, preparation } = composePersistedHumanKnowledge(ports);
    return { module: HumanKnowledgeModule, providers: [
      { provide: HumanKnowledgeService, useValue: management },
      { provide: HumanKnowledgeContextService, useValue: context },
      { provide: HumanKnowledgeIndexService, useValue: index },
      { provide: HumanKnowledgeInputService, useValue: preparation },
    ], exports: [HumanKnowledgeService, HumanKnowledgeContextService, HumanKnowledgeIndexService, HumanKnowledgeInputService] };
  }
}
