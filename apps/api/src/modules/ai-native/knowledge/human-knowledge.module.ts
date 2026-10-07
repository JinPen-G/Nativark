import { Module, type DynamicModule } from '@nestjs/common';
import { HumanKnowledgeService } from './human-knowledge.service';
import { HumanKnowledgeContextService } from './human-knowledge-context.service';
import { HumanKnowledgeIndexService } from './human-knowledge-index.service';
import { HumanKnowledgeInputService, type HumanKnowledgeInputDependencies } from './human-knowledge-input.service';
import { composePersistedHumanKnowledge, composeFormalPersistedHumanKnowledge, type FormalHumanKnowledgeDependencies } from './persistent-knowledge.composition';
import { PersistentMemoryConsentService } from './persistent-memory-consent.service';

@Module({})
export class HumanKnowledgeModule {
  static register(ports: HumanKnowledgeInputDependencies): DynamicModule {
    return this.services(composePersistedHumanKnowledge(ports));
  }

  /** Explicit AuthService + server-owned policy/file assembly. It does not
   * manufacture those policies, register HTTP, or grant an owner all actions. */
  static registerFormal(ports: FormalHumanKnowledgeDependencies): DynamicModule {
    return this.services(composeFormalPersistedHumanKnowledge(ports));
  }

  private static services({ management, context, index, preparation, memory }: ReturnType<typeof composePersistedHumanKnowledge>): DynamicModule {
    const providers = [
      { provide: HumanKnowledgeService, useValue: management },
      { provide: HumanKnowledgeContextService, useValue: context },
      { provide: HumanKnowledgeIndexService, useValue: index },
      { provide: HumanKnowledgeInputService, useValue: preparation },
      ...(memory ? [{ provide: PersistentMemoryConsentService, useValue: memory }] : []),
    ];
    return { module: HumanKnowledgeModule, providers,
      exports: [HumanKnowledgeService, HumanKnowledgeContextService, HumanKnowledgeIndexService, HumanKnowledgeInputService,
        ...(memory ? [PersistentMemoryConsentService] : [])] };
  }
}
