import { Module, type DynamicModule } from '@nestjs/common';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './original-scenes.composition';
import { AI_ORIGINAL_SCENES, AiOriginalScenesController } from './original-scenes.controller';

@Module({})
export class AiOriginalScenesModule {
  static register(dependencies: AiOriginalSceneDependencies): DynamicModule {
    return { module: AiOriginalScenesModule, providers: [{ provide: AI_ORIGINAL_SCENES, useFactory: () => composeAiOriginalScenes(dependencies) }],
      exports: [AI_ORIGINAL_SCENES] };
  }
  static registerHttp(dependencies: AiOriginalSceneDependencies): DynamicModule {
    return { ...this.register(dependencies), controllers: [AiOriginalScenesController] };
  }
}
