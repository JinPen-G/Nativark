import { Module, type DynamicModule } from '@nestjs/common';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AI_SETTINGS_TASK_HTTP_REQUESTS, AiSettingsTaskController, settingsTaskHttpMethods,
  type SettingsTaskHttpRequests } from './settings-task.controller';
import { AiOriginalSceneModelController } from './original-scenes.controller';
import { composeRequestBoundSettingsTask, composeRequestBoundPersistedSettingsTask, type AiSettingsTaskRequestOptions } from './request-bound-scenes.application';

/** Explicit consumer of a real request module. Disabled by default, no
 * AppModule/worker/model dependency or business operation during registration.
 * The host must not register the legacy full-model settings routes alongside
 * this module: they represent the same seven public operations. */
@Module({})
export class AiSettingsTaskHttpModule {
  /** Original published-plan consumer. An unpublished task remains unavailable;
   * the initial explicit producer is not replaced with guessed inputs/limits. */
  static registerPersistedApplication(dependencies: Parameters<typeof composeRequestBoundPersistedSettingsTask>[0],
    options: Parameters<typeof composeRequestBoundPersistedSettingsTask>[1]): DynamicModule {
    if (options.enabled !== true) return { module: AiSettingsTaskHttpModule, controllers: [], providers: [] };
    const selected = structuredClone(options), server = { ...dependencies, scene: structuredClone(dependencies.scene) };
    return { module: AiSettingsTaskHttpModule, controllers: [AiSettingsTaskController],
      providers: [{ provide: AI_SETTINGS_TASK_HTTP_REQUESTS,
        useFactory: () => composeRequestBoundPersistedSettingsTask(server, selected) }], exports: [AI_SETTINGS_TASK_HTTP_REQUESTS] };
  }
  /** Actual Gateway-free server producer, not an injected success callback.
   * Select this instead of legacy model settings routes; never mount both. */
  static registerApplication(dependencies: Parameters<typeof composeRequestBoundSettingsTask>[0],
    options: AiSettingsTaskRequestOptions): DynamicModule {
    if (options.enabled !== true) return { module: AiSettingsTaskHttpModule, controllers: [], providers: [] };
    const selected = structuredClone(options), server = { ...dependencies, scene: structuredClone(dependencies.scene) };
    return { module: AiSettingsTaskHttpModule, controllers: [AiSettingsTaskController],
      providers: [{ provide: AI_SETTINGS_TASK_HTTP_REQUESTS,
        useFactory: () => composeRequestBoundSettingsTask(server, selected) }], exports: [AI_SETTINGS_TASK_HTTP_REQUESTS] };
  }
  static register(options?: { enabled: boolean; requestModule: DynamicModule; requestToken: string | symbol }): DynamicModule {
    if (!options?.enabled) return { module: AiSettingsTaskHttpModule, controllers: [], providers: [] };
    const { requestModule, requestToken } = options;
    if (!requestModule?.module || !requestModule.exports?.includes(requestToken) || requestToken === AI_SETTINGS_TASK_HTTP_REQUESTS
      || requestModule.controllers?.includes(AiOriginalSceneModelController)) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    return { module: AiSettingsTaskHttpModule, imports: [requestModule],
      providers: [{ provide: AI_SETTINGS_TASK_HTTP_REQUESTS, inject: [requestToken], useFactory: (requests: SettingsTaskHttpRequests) => {
        if (settingsTaskHttpMethods.some(method => typeof requests?.[method] !== 'function')) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return Object.freeze(Object.fromEntries(settingsTaskHttpMethods.map(method => [method, requests[method].bind(requests)]))) as SettingsTaskHttpRequests;
      } }], controllers: [AiSettingsTaskController] };
  }
}
