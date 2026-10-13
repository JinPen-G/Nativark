import { Module, type DynamicModule } from '@nestjs/common';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AI_SETTINGS_TASK_HTTP_REQUESTS, AiSettingsTaskController, settingsTaskHttpMethods,
  type SettingsTaskHttpRequests } from './settings-task.controller';
import { AiOriginalSceneModelController } from './original-scenes.controller';

/** Explicit consumer of a real request module. Disabled by default, no
 * AppModule/worker/model dependency or business operation during registration.
 * The host must not register the legacy full-model settings routes alongside
 * this module: they represent the same seven public operations. */
@Module({})
export class AiSettingsTaskHttpModule {
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
