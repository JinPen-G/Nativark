import { Module, type DynamicModule } from '@nestjs/common';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiOriginalOrderReadHttpModule } from './original-order-read-http.module';
import { AiSettingsTaskHttpModule } from './settings-task-http.module';
import { AiHumanQuoteSelectionModule } from '../task-request/human-quote-selection.module';
import type { FormalApprovedOrderReprepareConfiguration } from '../approval-execution/formal-approved-order-reprepare.composition';
import type { SelectedQuoteTaskConfiguration } from './human-quote-order.composition';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './original-scenes.composition';
import { AI_ORIGINAL_SCENES, AI_ORIGINAL_SCENE_REQUESTS, AiOriginalScenesController,
  AI_ORIGINAL_SCENE_MODEL_REQUESTS, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS,
  AiOriginalSceneModelController, AiOriginalSceneModelActionsController } from './original-scenes.controller';
import { composeAiOriginalSceneModel, type AiOriginalSceneModelDependencies } from './original-scene-model.composition';
import { composeRequestBoundOriginalScenes, composeRequestBoundOriginalSceneModel, type RequestBoundOriginalSceneDependencies,
  composeRequestBoundPersistedOriginalSceneModel, type RequestBoundPersistedOriginalSceneModelDependencies,
  type RequestBoundOriginalSceneModelDependencies, type AiSceneModelRequestOptions, type AiSceneRequestOptions,
  type RequestBoundQuoteOrderDependencies, composeRequestBoundClarifiedQuoteSelection,
  composeRequestBoundSettingsTask } from './request-bound-scenes.application';

export const AI_ORIGINAL_SCENE_MODEL = Symbol('AI_ORIGINAL_SCENE_MODEL');
export const AI_ORIGINAL_ORDER_READ_REQUESTS = Symbol('AI_ORIGINAL_ORDER_READ_REQUESTS');
export const AI_CLARIFIED_QUOTE_SELECTION_REQUESTS = Symbol('AI_CLARIFIED_QUOTE_SELECTION_REQUESTS');
export const AI_ORIGINAL_SETTINGS_TASK_REQUESTS = Symbol('AI_ORIGINAL_SETTINGS_TASK_REQUESTS');
export { AI_ORIGINAL_SCENE_MODEL_REQUESTS, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS } from './original-scenes.controller';

@Module({})
export class AiOriginalScenesModule {
  /** Default closed, explicitly selected instead of the legacy full-model
   * settings routes. No model runtime is constructed by this HTTP assembly. */
  static registerHttpSettingsTask(input?: {
    dependencies: Parameters<typeof composeRequestBoundSettingsTask>[0]; options: AiSceneRequestOptions;
    configuration: Parameters<typeof composeRequestBoundSettingsTask>[2]
  }): DynamicModule {
    if (!input?.options?.enabled) return AiSettingsTaskHttpModule.register();
    return AiSettingsTaskHttpModule.register({ enabled: true,
      requestModule: this.registerRequestBoundSettingsTask(input.dependencies, input.options, input.configuration),
      requestToken: AI_ORIGINAL_SETTINGS_TASK_REQUESTS });
  }
  /** Current-request settings chain without constructing a model/provider.
   * Host task/change references are server-selected, never caller configuration. */
  static registerRequestBoundSettingsTask(
    dependencies: Parameters<typeof composeRequestBoundSettingsTask>[0], options: AiSceneRequestOptions,
    configuration: Parameters<typeof composeRequestBoundSettingsTask>[2]): DynamicModule {
    const server = { ...dependencies, scene: structuredClone(dependencies.scene) };
    const selected = structuredClone(configuration), requestOptions = { ...options };
    return { module: AiOriginalScenesModule, providers: [{ provide: AI_ORIGINAL_SETTINGS_TASK_REQUESTS,
      useFactory: () => composeRequestBoundSettingsTask(server, requestOptions, selected) }],
      exports: [AI_ORIGINAL_SETTINGS_TASK_REQUESTS] };
  }
  /** One explicit host for model clarification and the existing human flow.
   * Registration performs no business action; quote confirmation is not approval. */
  static registerHttpQuoteFlow(dependencies: RequestBoundPersistedOriginalSceneModelDependencies,
    options: Parameters<typeof AiOriginalScenesModule.registerHttpPersistedModel>[1],
    business: { dependencies: RequestBoundQuoteOrderDependencies; task: SelectedQuoteTaskConfiguration;
      reprepare?: FormalApprovedOrderReprepareConfiguration }): DynamicModule {
    if (dependencies.scene.code !== 'quote_clarification' || business.dependencies.scene.code !== 'quote_clarification'
      || dependencies.scene.version !== business.dependencies.scene.version || options.orderReadChain
      || business.dependencies.db !== dependencies.db || business.dependencies.auth !== dependencies.auth
      || business.dependencies.guard !== dependencies.guard || business.dependencies.core !== dependencies.core
      || business.dependencies.subscriptions !== dependencies.subscriptions) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const model = this.registerHttpPersistedModel(dependencies, options);
    const human = AiHumanQuoteSelectionModule.registerHttpTask(business.dependencies,
      { enabled: options.enabled, audience: options.audience }, business.task, business.reprepare);
    const serverDependencies = { ...dependencies, gateway: { ...dependencies.gateway, adapters: [...dependencies.gateway.adapters] } };
    const serverOptions = { ...options, host: structuredClone(options.host) }, serverBusiness = { ...business.dependencies };
    return { ...model, imports: [...(model.imports ?? []), human],
      providers: [...(model.providers ?? []), { provide: AI_CLARIFIED_QUOTE_SELECTION_REQUESTS,
        useFactory: () => composeRequestBoundClarifiedQuoteSelection(serverDependencies, serverOptions, serverBusiness) }],
      exports: [...(model.exports ?? []), AiHumanQuoteSelectionModule, AI_CLARIFIED_QUOTE_SELECTION_REQUESTS] };
  }
  /** Uses the published original-order-read contract, never legacy model routes. */
  static registerHttpOrderReadChain(dependencies: RequestBoundPersistedOriginalSceneModelDependencies,
    options: Parameters<typeof AiOriginalScenesModule.registerPersistedOrderReadChain>[1]): DynamicModule {
    return AiOriginalOrderReadHttpModule.register(this.registerPersistedOrderReadChain(dependencies, options),
      AI_ORIGINAL_ORDER_READ_REQUESTS);
  }
  /** Explicit two/three-step server host. No new HTTP contract or default driver. */
  static registerPersistedOrderReadChain(dependencies: RequestBoundPersistedOriginalSceneModelDependencies,
    options: Parameters<typeof composeRequestBoundPersistedOriginalSceneModel>[1] & {
      orderReadChain: NonNullable<Parameters<typeof composeRequestBoundPersistedOriginalSceneModel>[1]['orderReadChain']>
    }): DynamicModule {
    if (!options?.orderReadChain) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const registered = this.registerPersistedRequestModel(dependencies, options);
    return { ...registered, providers: (registered.providers ?? []).map(provider =>
      typeof provider === 'object' && 'provide' in provider
        ? { ...provider, provide: AI_ORIGINAL_ORDER_READ_REQUESTS } : provider),
      exports: [AI_ORIGINAL_ORDER_READ_REQUESTS] };
  }
  /** Explicit host selection, not production activation. Mount this OR the
   * existing registerHttpModel, never two drivers for the same route/action.
   * Only available model actions and original business request producers are
   * declared; settings/task-center endpoints need their existing own assembly. */
  static registerHttpPersistedModel(dependencies: RequestBoundPersistedOriginalSceneModelDependencies,
    options: Parameters<typeof composeRequestBoundPersistedOriginalSceneModel>[1]): DynamicModule {
    if (options.orderReadChain) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
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
