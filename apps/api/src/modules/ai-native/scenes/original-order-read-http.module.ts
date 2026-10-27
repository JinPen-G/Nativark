import { Module, type DynamicModule } from '@nestjs/common';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, AiOriginalOrderReadController, originalOrderReadRequestMethods } from './original-order-read.controller';
import type { OriginalOrderReadHttpRequests } from './original-order-read.controller';

export function selectOriginalOrderReadHttpRequests(value: Partial<OriginalOrderReadHttpRequests>): OriginalOrderReadHttpRequests {
  if (originalOrderReadRequestMethods.some(method => typeof value?.[method] !== 'function')) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return Object.freeze(Object.fromEntries(originalOrderReadRequestMethods.map(method =>
    [method, value[method]!.bind(value)]))) as unknown as OriginalOrderReadHttpRequests;
}

/** Explicit HTTP consumer of an existing dedicated request module. It does
 * not construct a runtime, enable production execution, or select a fallback. */
@Module({})
export class AiOriginalOrderReadHttpModule {
  static register(requestModule: DynamicModule, requestToken: string | symbol): DynamicModule {
    if (!requestModule?.module || !requestModule.exports?.includes(requestToken)
      || requestToken === AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    return { module: AiOriginalOrderReadHttpModule, imports: [requestModule],
      providers: [{ provide: AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, inject: [requestToken],
        useFactory: (app: OriginalOrderReadHttpRequests) => selectOriginalOrderReadHttpRequests(app) }],
      controllers: [AiOriginalOrderReadController] };
  }
}
