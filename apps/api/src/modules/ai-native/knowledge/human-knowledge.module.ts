import { Module, type DynamicModule } from '@nestjs/common';
import { HumanKnowledgeService } from './human-knowledge.service';
import { HumanKnowledgeContextService } from './human-knowledge-context.service';
import { HumanKnowledgeIndexService } from './human-knowledge-index.service';
import { HumanKnowledgeInputService, type HumanKnowledgeInputDependencies } from './human-knowledge-input.service';
import { composePersistedHumanKnowledge } from './persistent-knowledge.composition';
import { PersistentMemoryConsentService } from './persistent-memory-consent.service';
import { composeKnowledgeFileApplication, type KnowledgeFileApplicationDependencies } from './knowledge-file.composition';
import { HumanKnowledgeUploadService } from './human-knowledge-upload.service';

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

  static registerFiles(ports: KnowledgeFileApplicationDependencies): DynamicModule {
    const { management, context, index, preparation, memory, uploads } = composeKnowledgeFileApplication(ports);
    return { module: HumanKnowledgeModule, providers: [
      { provide: HumanKnowledgeService, useValue: management },
      { provide: HumanKnowledgeContextService, useValue: context },
      { provide: HumanKnowledgeIndexService, useValue: index },
      { provide: HumanKnowledgeInputService, useValue: preparation },
      ...(memory ? [{ provide: PersistentMemoryConsentService, useValue: memory }] : []),
      { provide: HumanKnowledgeUploadService, useValue: uploads },
    ], exports: [HumanKnowledgeService, HumanKnowledgeContextService, HumanKnowledgeIndexService, HumanKnowledgeInputService,
      ...(memory ? [PersistentMemoryConsentService] : []), HumanKnowledgeUploadService] };
  }
}
