/** Explicit original-accounting transport. No model/worker/root registration,
 * new reservation or business-funds operation; disabled unless server-composed. */
import { Body, Controller, Header, HttpCode, Inject, Module, Post, Req, type DynamicModule } from '@nestjs/common';
import { AI_ORIGINAL_TASK_ACCOUNTING_HTTP_DRAFT as routes } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { composeRequestBoundOriginalTaskAccounting, type AiSceneHttpRequest,
  type AiSceneRequestOptions, type RequestBoundOriginalSceneDependencies } from './request-bound-scenes.application';
import { respondAiScene } from './original-scenes.controller';
import { withRequestAbort, type AiRequestAbortSource } from './request-abort';

export const AI_ORIGINAL_TASK_ACCOUNTING_REQUESTS = Symbol('AI_ORIGINAL_TASK_ACCOUNTING_REQUESTS');
type Request = AiSceneHttpRequest & AiRequestAbortSource;
type Requests = ReturnType<typeof composeRequestBoundOriginalTaskAccounting>;

@Controller(routes.basePath)
export class AiOriginalTaskAccountingController {
  constructor(@Inject(AI_ORIGINAL_TASK_ACCOUNTING_REQUESTS) private readonly requests: Requests) {
    if (['read', 'releaseUnsent', 'reconcile'].some(key => typeof requests?.[key as keyof Requests] !== 'function'))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  @Post(routes.read) @HttpCode(200) @Header('Cache-Control', 'no-store')
  read(@Req() request: Request, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.read(request, body, signal)), 'read_original_accounting');
  }
  @Post(routes.releaseUnsent) @HttpCode(200) @Header('Cache-Control', 'no-store')
  releaseUnsent(@Req() request: Request, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.releaseUnsent(request, body, signal)), 'read_original_accounting');
  }
  @Post(routes.reconcile) @HttpCode(200) @Header('Cache-Control', 'no-store')
  reconcile(@Req() request: Request, @Body() body: unknown) {
    return respondAiScene(() => withRequestAbort(request, signal => this.requests.reconcile(request, body, signal)), 'read_original_accounting');
  }
}

@Module({})
export class AiOriginalTaskAccountingHttpModule {
  static register(dependencies?: RequestBoundOriginalSceneDependencies,
    options: AiSceneRequestOptions = { enabled: false, audience: 'operator' }): DynamicModule {
    if (options.enabled !== true) return { module: AiOriginalTaskAccountingHttpModule, controllers: [], providers: [], exports: [] };
    // This transport uses the existing operations route, not staff/client
    // credentials. Their formal transports must provide their own allowlists.
    if (!dependencies || options.audience !== 'operator') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const server = { ...dependencies, creationRules: structuredClone(dependencies.creationRules) };
    const selected = structuredClone(options);
    return { module: AiOriginalTaskAccountingHttpModule, controllers: [AiOriginalTaskAccountingController],
      providers: [{ provide: AI_ORIGINAL_TASK_ACCOUNTING_REQUESTS,
        useFactory: () => composeRequestBoundOriginalTaskAccounting(server, selected) }],
      exports: [AI_ORIGINAL_TASK_ACCOUNTING_REQUESTS] };
  }
}
