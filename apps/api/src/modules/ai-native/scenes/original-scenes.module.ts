import { Module, type DynamicModule } from '@nestjs/common';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './original-scenes.composition';
import { AI_ORIGINAL_SCENES, AiOriginalScenesController } from './original-scenes.controller';
import { composeAiOriginalSceneModel, type AiOriginalSceneModelDependencies } from './original-scene-model.composition';

export const AI_ORIGINAL_SCENE_MODEL = Symbol('AI_ORIGINAL_SCENE_MODEL');

@Module({})
export class AiOriginalScenesModule {
  /** Explicit server assembly only; does not start a worker or register HTTP. */
  static registerModel(dependencies: AiOriginalSceneModelDependencies): DynamicModule {
    return { module: AiOriginalScenesModule,
      providers: [{ provide: AI_ORIGINAL_SCENE_MODEL, useFactory: () => composeAiOriginalSceneModel(dependencies) }],
      exports: [AI_ORIGINAL_SCENE_MODEL] };
  }
  static register(dependencies: AiOriginalSceneDependencies): DynamicModule {
    return { module: AiOriginalScenesModule, providers: [{ provide: AI_ORIGINAL_SCENES, useFactory: () => composeAiOriginalScenes(dependencies) }],
      exports: [AI_ORIGINAL_SCENES] };
  }
  static registerHttp(dependencies: AiOriginalSceneDependencies): DynamicModule {
    return { ...this.register(dependencies), controllers: [AiOriginalScenesController] };
  }
}
