import { Module, type DynamicModule } from '@nestjs/common';
import { HumanKnowledgeService } from './human-knowledge.service';
import { HumanKnowledgeContextService } from './human-knowledge-context.service';
import { HumanKnowledgeIndexService } from './human-knowledge-index.service';
import { HumanKnowledgeInputService, type HumanKnowledgeInputDependencies } from './human-knowledge-input.service';
import { HumanKnowledgeConsumptionService } from './human-knowledge-consumption.service';
import { composePersistedHumanKnowledge, composeFormalPersistedHumanKnowledge, type FormalHumanKnowledgeDependencies } from './persistent-knowledge.composition';
import { PersistentMemoryConsentService } from './persistent-memory-consent.service';
import { composeKnowledgeFileApplication, KNOWLEDGE_SCENE_OPTIONS, type KnowledgeFileApplicationDependencies, type KnowledgeSceneOptionsFactory } from './knowledge-file.composition';
import { HumanKnowledgeUploadService } from './human-knowledge-upload.service';
import { composePrismaFormalHumanKnowledge, type PrismaFormalKnowledgeDependencies } from './prisma-formal-knowledge.composition';
import { KNOWLEDGE_POLICY_MANAGEMENT, type KnowledgePolicyManagementApplication } from './knowledge-policy-management.composition';
import { HumanKnowledgeConsumptionRequestFactory, type HumanKnowledgeConsumptionDependencies } from './human-knowledge-consumption.composition';
import { HumanKnowledgeConsumptionController } from './human-knowledge-consumption.controller';
import { unavailable } from './knowledge-errors';

@Module({})
export class HumanKnowledgeModule {
  static register(ports: HumanKnowledgeInputDependencies): DynamicModule {
    return this.services(composePersistedHumanKnowledge(ports));
  }

  static registerFormal(ports: FormalHumanKnowledgeDependencies | PrismaFormalKnowledgeDependencies): DynamicModule {
    return this.services('knowledgePolicy' in ports ? composeFormalPersistedHumanKnowledge(ports) : composePrismaFormalHumanKnowledge(ports));
  }

  static registerConsumptionHttp(options: { enabled?: boolean; dependencies?: HumanKnowledgeConsumptionDependencies } = {}): DynamicModule {
    if (options.enabled !== true) return { module: HumanKnowledgeModule, controllers: [], providers: [] };
    if (!options.dependencies) return unavailable();
    const requests = new HumanKnowledgeConsumptionRequestFactory(options.dependencies);
    return { module: HumanKnowledgeModule, controllers: [HumanKnowledgeConsumptionController],
      providers: [{ provide: HumanKnowledgeConsumptionRequestFactory, useValue: requests }] };
  }

  static registerFiles(ports: KnowledgeFileApplicationDependencies): DynamicModule {
    return this.services(composeKnowledgeFileApplication(ports));
  }

  private static services({ management, context, index, preparation, consumption, memory, uploads, sceneKnowledge, policyManagement }: ReturnType<typeof composePersistedHumanKnowledge> & { uploads?: HumanKnowledgeUploadService; sceneKnowledge?: KnowledgeSceneOptionsFactory; policyManagement?: KnowledgePolicyManagementApplication }): DynamicModule {
    const providers = [
      { provide: HumanKnowledgeService, useValue: management },
      { provide: HumanKnowledgeContextService, useValue: context },
      { provide: HumanKnowledgeIndexService, useValue: index },
      { provide: HumanKnowledgeInputService, useValue: preparation },
      { provide: HumanKnowledgeConsumptionService, useValue: consumption },
      ...(memory ? [{ provide: PersistentMemoryConsentService, useValue: memory }] : []),
      ...(uploads ? [{ provide: HumanKnowledgeUploadService, useValue: uploads }] : []),
      ...(sceneKnowledge ? [{ provide: KNOWLEDGE_SCENE_OPTIONS, useValue: sceneKnowledge }] : []),
      ...(policyManagement ? [{ provide: KNOWLEDGE_POLICY_MANAGEMENT, useValue: policyManagement }] : []),
    ];
    return { module: HumanKnowledgeModule, providers,
      exports: [HumanKnowledgeService, HumanKnowledgeContextService, HumanKnowledgeIndexService, HumanKnowledgeInputService, HumanKnowledgeConsumptionService,
        ...(memory ? [PersistentMemoryConsentService] : []), ...(uploads ? [HumanKnowledgeUploadService] : []),
        ...(sceneKnowledge ? [KNOWLEDGE_SCENE_OPTIONS] : []), ...(policyManagement ? [KNOWLEDGE_POLICY_MANAGEMENT] : [])] };
  }

}
