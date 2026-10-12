import { Module, type DynamicModule } from '@nestjs/common';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './original-scenes.composition';
import { AI_ORIGINAL_SCENES, AI_ORIGINAL_SCENE_REQUESTS, AiOriginalScenesController,
  AI_ORIGINAL_SCENE_MODEL_REQUESTS, AiOriginalSceneModelController } from './original-scenes.controller';
import { composeAiOriginalSceneModel, type AiOriginalSceneModelDependencies } from './original-scene-model.composition';
import { composeRequestBoundOriginalScenes, composeRequestBoundOriginalSceneModel, type RequestBoundOriginalSceneDependencies,
  composeRequestBoundPersistedOriginalSceneModel, type RequestBoundPersistedOriginalSceneModelDependencies,
  type RequestBoundOriginalSceneModelDependencies, type AiSceneModelRequestOptions, type AiSceneRequestOptions } from './request-bound-scenes.application';

export const AI_ORIGINAL_SCENE_MODEL = Symbol('AI_ORIGINAL_SCENE_MODEL');
export const AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS = Symbol('AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS');
export { AI_ORIGINAL_SCENE_MODEL_REQUESTS } from './original-scenes.controller';

@Module({})
export class AiOriginalScenesModule {
  /** Server opt-in only. No controllers, AppModule activation or background
   * execution. Do not bind this narrower model-action service to the existing
   * full task-center controller, which also requires business-only readers. */
  static registerPersistedRequestModel(dependencies: RequestBoundPersistedOriginalSceneModelDependencies,
    options: Parameters<typeof composeRequestBoundPersistedOriginalSceneModel>[1]): DynamicModule {
    const server = { ...dependencies, gateway: { ...dependencies.gateway, adapters: [...dependencies.gateway.adapters] } };
    const selected = { ...options, host: structuredClone(options.host) };
    return { module: AiOriginalScenesModule,
      providers: [{ provide: AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS,
        useFactory: () => composeRequestBoundPersistedOriginalSceneModel(server, selected) }],
      exports: [AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS] };
  }
  /** Explicit HTTP assembly, not production activation. Both APIs bind the
   * current request independently; there is no detached worker or shared actor. */
  static registerHttpModel(dependencies: RequestBoundOriginalSceneModelDependencies, options: AiSceneModelRequestOptions): DynamicModule {
    const { enabled, audience } = options;
    const modelOptions = { enabled, audience, host: structuredClone(options.host), runServices: options.runServices,
      ...(options.quoteTask ? { quoteTask: { dependencies: { ...options.quoteTask.dependencies }, configuration: {
        ...options.quoteTask.configuration, host: structuredClone(options.quoteTask.configuration.host),
        limits: structuredClone(options.quoteTask.configuration.limits) } } } : {}),
      ...(options.settingsTask ? { settingsTask: { dependencies: { ...options.settingsTask.dependencies }, configuration: {
        host: structuredClone(options.settingsTask.configuration.host), task: structuredClone(options.settingsTask.configuration.task) } } } : {}) };
    return { module: AiOriginalScenesModule,
      providers: [
        { provide: AI_ORIGINAL_SCENE_REQUESTS, useFactory: () => composeRequestBoundOriginalScenes(dependencies, { enabled, audience }) },
        { provide: AI_ORIGINAL_SCENE_MODEL_REQUESTS, useFactory: () => composeRequestBoundOriginalSceneModel(dependencies, modelOptions) }
      ], exports: [AI_ORIGINAL_SCENE_REQUESTS, AI_ORIGINAL_SCENE_MODEL_REQUESTS],
      controllers: [AiOriginalScenesController, AiOriginalSceneModelController] };
  }
  static registerRequestBoundModel(dependencies: RequestBoundOriginalSceneModelDependencies, options: AiSceneModelRequestOptions): DynamicModule {
    return { module: AiOriginalScenesModule,
      providers: [{ provide: AI_ORIGINAL_SCENE_MODEL_REQUESTS, useFactory: () => composeRequestBoundOriginalSceneModel(dependencies, options) }],
      exports: [AI_ORIGINAL_SCENE_MODEL_REQUESTS] };
  }
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
  static registerHttp(dependencies: RequestBoundOriginalSceneDependencies, options: AiSceneRequestOptions): DynamicModule {
    return { module: AiOriginalScenesModule,
      providers: [{ provide: AI_ORIGINAL_SCENE_REQUESTS, useFactory: () => composeRequestBoundOriginalScenes(dependencies, options) }],
      exports: [AI_ORIGINAL_SCENE_REQUESTS], controllers: [AiOriginalScenesController] };
  }
}
