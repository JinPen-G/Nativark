import { Module, type DynamicModule } from '@nestjs/common';
import { HumanKnowledgeService } from './human-knowledge.service';
import { HumanKnowledgeContextService } from './human-knowledge-context.service';
import { HumanKnowledgeIndexService } from './human-knowledge-index.service';
import { HumanKnowledgeInputService, type HumanKnowledgeInputDependencies } from './human-knowledge-input.service';
import { composePersistedHumanKnowledge, composeFormalPersistedHumanKnowledge, type FormalHumanKnowledgeDependencies } from './persistent-knowledge.composition';
import { PersistentMemoryConsentService } from './persistent-memory-consent.service';
import { composeKnowledgeFileApplication, KNOWLEDGE_SCENE_OPTIONS, type KnowledgeFileApplicationDependencies, type KnowledgeSceneOptionsFactory } from './knowledge-file.composition';
import { HumanKnowledgeUploadService } from './human-knowledge-upload.service';
import { composePrismaFormalHumanKnowledge, type PrismaFormalKnowledgeDependencies } from './prisma-formal-knowledge.composition';
import { KNOWLEDGE_POLICY_MANAGEMENT, type KnowledgePolicyManagementApplication } from './knowledge-policy-management.composition';

@Module({})
export class HumanKnowledgeModule {
  static register(ports: HumanKnowledgeInputDependencies): DynamicModule {
    return this.services(composePersistedHumanKnowledge(ports));
  }

  static registerFormal(ports: FormalHumanKnowledgeDependencies | PrismaFormalKnowledgeDependencies): DynamicModule {
    return this.services('knowledgePolicy' in ports ? composeFormalPersistedHumanKnowledge(ports) : composePrismaFormalHumanKnowledge(ports));
  }

  static registerFiles(ports: KnowledgeFileApplicationDependencies): DynamicModule {
    return this.services(composeKnowledgeFileApplication(ports));
  }

  private static services({ management, context, index, preparation, memory, uploads, sceneKnowledge, policyManagement }: ReturnType<typeof composePersistedHumanKnowledge> & { uploads?: HumanKnowledgeUploadService; sceneKnowledge?: KnowledgeSceneOptionsFactory; policyManagement?: KnowledgePolicyManagementApplication }): DynamicModule {
    const providers = [
      { provide: HumanKnowledgeService, useValue: management },
      { provide: HumanKnowledgeContextService, useValue: context },
      { provide: HumanKnowledgeIndexService, useValue: index },
      { provide: HumanKnowledgeInputService, useValue: preparation },
      ...(memory ? [{ provide: PersistentMemoryConsentService, useValue: memory }] : []),
      ...(uploads ? [{ provide: HumanKnowledgeUploadService, useValue: uploads }] : []),
      ...(sceneKnowledge ? [{ provide: KNOWLEDGE_SCENE_OPTIONS, useValue: sceneKnowledge }] : []),
      ...(policyManagement ? [{ provide: KNOWLEDGE_POLICY_MANAGEMENT, useValue: policyManagement }] : []),
    ];
    return { module: HumanKnowledgeModule, providers,
      exports: [HumanKnowledgeService, HumanKnowledgeContextService, HumanKnowledgeIndexService, HumanKnowledgeInputService,
        ...(memory ? [PersistentMemoryConsentService] : []), ...(uploads ? [HumanKnowledgeUploadService] : []),
        ...(sceneKnowledge ? [KNOWLEDGE_SCENE_OPTIONS] : []), ...(policyManagement ? [KNOWLEDGE_POLICY_MANAGEMENT] : [])] };
  }

}
