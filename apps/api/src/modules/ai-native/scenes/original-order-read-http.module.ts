import { Module, type DynamicModule } from '@nestjs/common';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, AiOriginalOrderReadController } from './original-order-read.controller';
import type { OriginalOrderReadHttpRequests } from './original-order-read.controller';

/** Explicit HTTP consumer of an existing dedicated request module. It does
 * not construct a runtime, register production routes, or select a fallback. */
@Module({})
export class AiOriginalOrderReadHttpModule {
  static register(requestModule: DynamicModule, requestToken: string | symbol): DynamicModule {
    if (!requestModule?.module || !requestModule.exports?.includes(requestToken)
      || requestToken === AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    return { module: AiOriginalOrderReadHttpModule, imports: [requestModule],
      providers: [{ provide: AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS, inject: [requestToken],
        useFactory: (app: OriginalOrderReadHttpRequests) => {
          const methods = ['start', 'recover', 'takeover', 'readOrderResult', 'readModelResult', 'readTaskScene',
            'readNextSteps', 'readTaskSnapshot', 'reopenModelSource', 'requestCancel'] as const;
          if (methods.some(method => typeof app?.[method] !== 'function')) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          return Object.freeze(Object.fromEntries(methods.map(method => [method, app[method].bind(app)]))) as unknown as OriginalOrderReadHttpRequests;
        } }],
      controllers: [AiOriginalOrderReadController] };
  }
}
