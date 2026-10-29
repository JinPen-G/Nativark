/** Shared HTTP controller for explicit counting hosts and the standard app.
 * The standard app keeps counting/publication disabled until configured while
 * retaining authorized history reads. registerHttp remains an opt-in module;
 * disabled registration contributes no routes or providers. Every route reuses the original
 * Auth/Guard/ALS chain inside the request factory. Every request and response
 * uses the shared closed contract, including nested task-cost receipts.
 * Pricing and usage retain their original safe readers and summaries;
 * transport validation grants no permission or invoice attestation. */
import { Body, Controller, Header, HttpCode, HttpException, Inject, Module, Post, Req, type DynamicModule } from '@nestjs/common';
import { AI_COUNTING_HTTP_DRAFT as routes } from '@rental-os/shared';
import { BudgetError } from '../budget/budget.ports';
import { withRequestAbort, AiRequestWaitError, type AiRequestAbortSource } from '../scenes/request-abort';
import { InputCountingRequestFactory, type InputCountingRequestAction, type InputCountingHttpRequest } from './input-counting-request.factory';
import { validateCountingHttp } from '../counting-http.contract';

export const AI_COUNTING_REQUESTS = Symbol('AI_COUNTING_REQUESTS');
type Factory = Pick<InputCountingRequestFactory, 'call'>;
type CountingRequest = { headers: { authorization?: unknown } } & AiRequestAbortSource;

const unknownRead = (action: InputCountingRequestAction) => action === 'publishInputBound' ? 'readInputBound' as const
  : action === 'count' ? 'observeCountKey' as const : action;
const failure = (error: unknown, action: InputCountingRequestAction): never => {
  const codes: Record<string, [string, number]> = {
    INVALID: ['AI_INVALID_INPUT', 400], FORBIDDEN: ['AI_ACCESS_DENIED', 403],
    REVISION_CONFLICT: ['AI_REVISION_CONFLICT', 409], IDEMPOTENCY_CONFLICT: ['AI_REVISION_CONFLICT', 409],
    PENDING_RECONCILIATION: ['AI_RESULT_UNKNOWN', 409]
  };
  const raw = error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code : '';
  const [code, status] = Object.prototype.hasOwnProperty.call(codes, raw)
    ? codes[raw] : ['AI_RESOURCE_UNAVAILABLE', 503] as const;
  throw new HttpException({ code, retryable: false,
    ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: unknownRead(action) } : {}) }, status);
};

@Controller(routes.basePath)
export class AiInputCountingController {
  constructor(@Inject(AI_COUNTING_REQUESTS) private readonly requests: Factory) {}
  private async respond(request: CountingRequest, action: InputCountingRequestAction, body: unknown): Promise<unknown> {
    try {
      if (Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8') > 65536 || !validateCountingHttp(action, 'request', body)) throw new BudgetError('INVALID');
      return await withRequestAbort(request, async signal => {
        const result = await this.requests.call(request as InputCountingHttpRequest, action, structuredClone(body), signal);
        if (!validateCountingHttp(action, 'response', result) || Buffer.byteLength(JSON.stringify(result) ?? '', 'utf8') > 131072)
          throw new BudgetError(action === 'count' || action === 'publishInputBound' ? 'PENDING_RECONCILIATION' : 'UNAVAILABLE');
        return structuredClone(result);
      }, { maxWaitMs: 20000 });
    } catch (error) {
      if (error instanceof AiRequestWaitError) {
        const mutation = action === 'count' || action === 'publishInputBound';
        throw new HttpException({ code: mutation ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE',
          retryable: false, ...(mutation ? { nextAction: unknownRead(action) } : {}) }, mutation ? 409 : 503);
      }
      throw failure(error, action);
    }
  }
  @Post(routes.count) @HttpCode(200) @Header('Cache-Control', 'no-store')
  count(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'count', body);
  }
  @Post(routes.observeCountKey) @HttpCode(200) @Header('Cache-Control', 'no-store')
  observe(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'observeCountKey', body);
  }
  @Post(routes.readCountReceipt) @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipt(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'readCountReceipt', body);
  }
  @Post(routes.publishInputBound) @HttpCode(200) @Header('Cache-Control', 'no-store')
  publishInputBound(@Req() request: CountingRequest, @Body() body: unknown) {
    // Publication receipts come from the trusted management path and are
    // re-read back under the original key inside the same request.
    return this.respond(request, 'publishInputBound', body);
  }
  @Post(routes.readInputBound) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readInputBound(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'readInputBound', body);
  }
  @Post(routes.readPublication) @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPublication(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'readPublication', body);
  }
  @Post(routes.usagePage) @HttpCode(200) @Header('Cache-Control', 'no-store')
  usagePage(@Req() request: CountingRequest, @Body() body: unknown) {
    // The original reader and public transport validate the same shared shape.
    return this.respond(request, 'usagePage', body);
  }
  @Post(routes.usageSummary) @HttpCode(200) @Header('Cache-Control', 'no-store')
  usageSummary(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'usageSummary', body);
  }
  @Post(routes.usagePricingBases) @HttpCode(200) @Header('Cache-Control', 'no-store')
  usagePricingBases(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'usagePricingBases', body);
  }
  @Post(routes.taskCosts) @HttpCode(200) @Header('Cache-Control', 'no-store')
  taskCosts(@Req() request: CountingRequest, @Body() body: unknown) {
    // Validate the nested counting receipts as well as the original usage view.
    return this.respond(request, 'taskCosts', body);
  }
}

@Module({})
export class AiInputCountingModule {
  /** Opt-in registration. Disabled (the default) contributes nothing. The
   * dependencies are the mainline's real server dependencies — no default
   * success adapter, no seeded policy, no ambient credentials. */
  static registerHttp(dependencies: ConstructorParameters<typeof InputCountingRequestFactory>[0],
    options: { enabled: boolean } = { enabled: false }): DynamicModule {
    if (options.enabled !== true) return { module: AiInputCountingModule, controllers: [], providers: [] };
    if (!dependencies) throw new BudgetError('UNAVAILABLE');
    return { module: AiInputCountingModule, controllers: [AiInputCountingController],
      providers: [{ provide: AI_COUNTING_REQUESTS,
        useValue: new InputCountingRequestFactory(dependencies) }],
      exports: [AI_COUNTING_REQUESTS] };
  }
}
