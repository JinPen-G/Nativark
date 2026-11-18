/** Supplies the deployment snapshot to the registered AI hosts. Their own policies and authorization govern execution. */
import { Logger, type FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiTaskRepositoryError } from './ai-task.repository';
import { immutable, parseRuntimePublication, type ConfigurationName, type RuntimePublication } from './runtime-publication.schema';
export type { RuntimePublication } from './runtime-publication.schema';

export const AI_NATIVE_RUNTIME_PUBLICATION = Symbol('AI_NATIVE_RUNTIME_PUBLICATION');
export const AI_NATIVE_RUNTIME_PUBLICATION_KEY = 'AI_NATIVE_RUNTIME_PUBLICATION';

export function readRuntimePublication(source: Pick<ConfigService, 'get'>): RuntimePublication {
  try { return parseRuntimePublication(source.get(AI_NATIVE_RUNTIME_PUBLICATION_KEY)); }
  catch { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }
}

export const AI_NATIVE_RUNTIME_PUBLICATION_PROVIDER: FactoryProvider<RuntimePublication> = {
  provide: AI_NATIVE_RUNTIME_PUBLICATION,
  inject: [ConfigService],
  useFactory: (source: ConfigService): RuntimePublication => {
    try { return readRuntimePublication(source); }
    catch {
      new Logger('AiRuntimePublication').error('AI_RUNTIME_PUBLICATION_INVALID: AI configuration sections disabled');
      return parseRuntimePublication(undefined);
    }
  },
};

export function runtimeConfigurationProvider(token: symbol, name: ConfigurationName): FactoryProvider {
  return {
    provide: token,
    inject: [AI_NATIVE_RUNTIME_PUBLICATION],
    useFactory: (publication: RuntimePublication) => {
      const value = publication.configurations[name];
      return value === undefined ? undefined : immutable(structuredClone(value));
    },
  };
}
