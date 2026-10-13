import { Module, type DynamicModule } from '@nestjs/common';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './original-scenes.composition';
import { AI_ORIGINAL_SCENES, AI_ORIGINAL_SCENE_REQUESTS, AiOriginalScenesController,
  AI_ORIGINAL_SCENE_MODEL_REQUESTS, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS,
  AiOriginalSceneModelController, AiOriginalSceneModelActionsController,
  AI_ORIGINAL_TASK_ACTION_POLICIES, AiOriginalTaskActionPolicyController,
  AI_SCENE_PLAN_POLICIES, AiScenePlanPolicyController } from './original-scenes.controller';
import { composeAiOriginalSceneModel, type AiOriginalSceneModelDependencies } from './original-scene-model.composition';
import { composeRequestBoundOriginalScenes, composeRequestBoundOriginalSceneModel, type RequestBoundOriginalSceneDependencies,
  composeRequestBoundPersistedOriginalSceneModel, type RequestBoundPersistedOriginalSceneModelDependencies,
  type RequestBoundOriginalSceneModelDependencies, type AiSceneModelRequestOptions, type AiSceneRequestOptions } from './request-bound-scenes.application';
import { composeRequestBoundOriginalTaskActionPolicies, type AiOriginalTaskActionPolicyOptions } from './request-bound-scenes.application';
import { composeRequestBoundScenePlanPolicies, type AiScenePlanPolicyConfiguration } from './request-bound-scenes.application';

export const AI_ORIGINAL_SCENE_MODEL = Symbol('AI_ORIGINAL_SCENE_MODEL');
export { AI_ORIGINAL_TASK_ACTION_POLICIES } from './original-scenes.controller';
export { AI_ORIGINAL_SCENE_MODEL_REQUESTS, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS } from './original-scenes.controller';

@Module({})
export class AiOriginalScenesModule {
  /** Explicit scene-management host, never production activation. */
  static registerHttpPlanPolicies(dependencies: RequestBoundOriginalSceneDependencies,
    options: AiScenePlanPolicyConfiguration): DynamicModule {
    const selected = structuredClone(options);
    return { module: AiOriginalScenesModule, controllers: [AiScenePlanPolicyController],
      providers: [{ provide: AI_SCENE_PLAN_POLICIES,
        useFactory: () => composeRequestBoundScenePlanPolicies(dependencies, selected) }], exports: [AI_SCENE_PLAN_POLICIES] };
  }
  /** Explicit opt-in transport. No task policy is automatically written. */
  static registerHttpTaskActionPolicies(dependencies: RequestBoundOriginalSceneDependencies,
    options: AiOriginalTaskActionPolicyOptions): DynamicModule {
    return { ...this.registerTaskActionPolicies(dependencies, options), controllers: [AiOriginalTaskActionPolicyController] };
  }
  /** Explicit non-HTTP supplier; does not seed or enable any task policy. */
  static registerTaskActionPolicies(dependencies: RequestBoundOriginalSceneDependencies,
    options: AiOriginalTaskActionPolicyOptions): DynamicModule {
    const selected = structuredClone(options);
    return { module: AiOriginalScenesModule, providers: [{ provide: AI_ORIGINAL_TASK_ACTION_POLICIES,
      useFactory: () => composeRequestBoundOriginalTaskActionPolicies(dependencies, selected) }],
      exports: [AI_ORIGINAL_TASK_ACTION_POLICIES] };
  }
  /** Explicit host selection, not production activation. Mount this OR the
   * existing registerHttpModel, never two drivers for the same route/action.
   * Only available model actions and original business request producers are
   * declared; settings/task-center endpoints need their existing own assembly. */
  static registerHttpPersistedModel(dependencies: RequestBoundPersistedOriginalSceneModelDependencies,
    options: Parameters<typeof composeRequestBoundPersistedOriginalSceneModel>[1]): DynamicModule {
    const persisted = this.registerPersistedRequestModel(dependencies, options);
    const server = { ...dependencies }, selected = { enabled: options.enabled, audience: options.audience };
    return { ...persisted, providers: [...(persisted.providers ?? []),
      { provide: AI_ORIGINAL_SCENE_REQUESTS, useFactory: () => composeRequestBoundOriginalScenes(server, selected) }],
      exports: [AI_ORIGINAL_SCENE_REQUESTS, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS],
      controllers: [AiOriginalScenesController, AiOriginalSceneModelActionsController] };
  }
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
