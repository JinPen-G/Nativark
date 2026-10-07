import { Module, type DynamicModule } from '@nestjs/common';
import { HumanKnowledgeService, type HumanKnowledgeDependencies } from './human-knowledge.service';
import { HumanKnowledgeContextService } from './human-knowledge-context.service';
import { HumanKnowledgeIndexService } from './human-knowledge-index.service';

@Module({})
export class HumanKnowledgeModule {
  static register(ports: HumanKnowledgeDependencies): DynamicModule {
    const management = new HumanKnowledgeService(ports);
    const context = new HumanKnowledgeContextService(ports);
    const index = new HumanKnowledgeIndexService(ports);
    return { module: HumanKnowledgeModule, providers: [
      { provide: HumanKnowledgeService, useValue: management },
      { provide: HumanKnowledgeContextService, useValue: context },
      { provide: HumanKnowledgeIndexService, useValue: index },
    ], exports: [HumanKnowledgeService, HumanKnowledgeContextService, HumanKnowledgeIndexService] };
  }
}
