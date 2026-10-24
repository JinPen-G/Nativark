/** Default-closed HTTP module for the AI input-counting request surface.
 * Registered only through InputCountingModule.registerHttp(dependencies,
 * { enabled: true }) by the mainline; disabled registration contributes no
 * routes, providers, timers or model calls. Every route reuses the original
 * Auth/Guard/ALS chain inside the request factory. Counting-owned responses
 * (count / observe / receipt / pricing bases) are structurally validated
 * against the dedicated shared draft shapes before responding; usage page,
 * summary are validated by their original readers. Pricing reads reuse the
 * existing safe summaries and closed shared schemas; raw evidence is never
 * an HTTP response. Every response also has a bounded transport envelope. */
import { Body, Controller, Header, HttpCode, HttpException, Inject, Module, Post, Req, type DynamicModule } from '@nestjs/common';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_COUNTING_HTTP_SCHEMAS, AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS,
  type AiGatewayPriceSummaryDraft, type AiGatewayInputBoundSummaryDraft,
  type AiCountingCountResultDraft, type AiCountingLifecycleObservationDraft,
  type AiCountingReceiptReadDraft, type AiCountingUsagePricingBasesDraft } from '@rental-os/shared';
import { BudgetError } from '../budget/budget.ports';
import { withRequestAbort, AiRequestWaitError, type AiRequestAbortSource } from '../scenes/request-abort';
import { InputCountingRequestFactory, type InputCountingRequestAction, type InputCountingHttpRequest } from './input-counting-request.factory';

const AI_COUNTING_REQUESTS = Symbol('AI_COUNTING_REQUESTS');
type Factory = InputCountingRequestFactory;
type CountingRequest = { headers: { authorization?: unknown } } & AiRequestAbortSource;

const failure = (error: unknown): never => {
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
    ...(code === 'AI_RESULT_UNKNOWN' ? { nextAction: 'reconcile' as const } : {}) }, status);
};

// Validate the actual shared contract; no second private schema can drift.
const countingAjv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(countingAjv);
for (const [name, schema] of Object.entries(AI_COUNTING_HTTP_SCHEMAS)) {
  countingAjv.addSchema(schema as object, `urn:rental:counting:${name}`);
}
const checkedCount = countingAjv.getSchema<AiCountingCountResultDraft>('urn:rental:counting:AiCountingCountResultDraft')!;
const checkedObserve = countingAjv.getSchema<AiCountingLifecycleObservationDraft>('urn:rental:counting:AiCountingLifecycleObservationDraft')!;
const checkedReceipt = countingAjv.getSchema<AiCountingReceiptReadDraft>('urn:rental:counting:AiCountingReceiptReadDraft')!;
const checkedBases = countingAjv.getSchema<AiCountingUsagePricingBasesDraft>('urn:rental:counting:AiCountingUsagePricingBasesDraft')!;
const pricingRefs = (value: unknown): unknown => Array.isArray(value) ? value.map(pricingRefs)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, key === '$ref' && typeof child === 'string' ? child.replace(/^#\/components\/schemas\//u, 'urn:rental:counting:') : pricingRefs(child)])) : value;
for (const name of ['AiGatewayPriceSummaryDraft', 'AiGatewayInputBoundSummaryDraft'] as const) {
  countingAjv.addSchema(pricingRefs(AI_BUDGET_MANAGEMENT_HTTP_SCHEMAS[name]) as object, `urn:rental:counting:${name}`);
}
const checkedPrice = countingAjv.getSchema<AiGatewayPriceSummaryDraft>('urn:rental:counting:AiGatewayPriceSummaryDraft')!;
const checkedBound = countingAjv.getSchema<AiGatewayInputBoundSummaryDraft>('urn:rental:counting:AiGatewayInputBoundSummaryDraft')!;

@Controller('ai-native/counting')
export class AiInputCountingController {
  constructor(@Inject(AI_COUNTING_REQUESTS) private readonly requests: Factory) {}
  private async respond<T>(request: CountingRequest, action: InputCountingRequestAction, body: unknown,
    validate: (value: unknown) => value is T): Promise<T> {
    try {
      return await withRequestAbort(request, async signal => {
        const result = await this.requests.call(request as InputCountingHttpRequest, action, body, signal);
        if (!validate(result) || Buffer.byteLength(JSON.stringify(result) ?? '', 'utf8') > 131072)
          throw new BudgetError(action === 'count' || action === 'publishInputBound' ? 'PENDING_RECONCILIATION' : 'UNAVAILABLE');
        return structuredClone(result) as T;
      }, { maxWaitMs: 20000 });
    } catch (error) {
      if (error instanceof AiRequestWaitError) {
        const mutation = action === 'count' || action === 'publishInputBound';
        throw new HttpException({ code: mutation ? 'AI_RESULT_UNKNOWN' : 'AI_RESOURCE_UNAVAILABLE',
          retryable: false, ...(mutation ? { nextAction: 'reconcile' as const } : {}) }, mutation ? 409 : 503);
      }
      throw failure(error);
    }
  }
  @Post('count') @HttpCode(200) @Header('Cache-Control', 'no-store')
  count(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'count', body,
      checkedCount);
  }
  @Post('observe') @HttpCode(200) @Header('Cache-Control', 'no-store')
  observe(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'observeCountKey', body,
      checkedObserve);
  }
  @Post('receipt') @HttpCode(200) @Header('Cache-Control', 'no-store')
  receipt(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'readCountReceipt', body,
      checkedReceipt);
  }
  @Post('input-bound') @HttpCode(200) @Header('Cache-Control', 'no-store')
  publishInputBound(@Req() request: CountingRequest, @Body() body: unknown) {
    // Publication receipts come from the trusted management path and are
    // re-read back under the original key inside the same request.
    return this.respond(request, 'publishInputBound', body,
      ((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object')));
  }
  @Post('input-bound/read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  readInputBound(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'readInputBound', body, checkedBound);
  }
  @Post('publication/read') @HttpCode(200) @Header('Cache-Control', 'no-store')
  readPublication(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'readPublication', body, checkedPrice);
  }
  @Post('usage/page') @HttpCode(200) @Header('Cache-Control', 'no-store')
  usagePage(@Req() request: CountingRequest, @Body() body: unknown) {
    // The usage page is validated against its closed shared draft inside the
    // reader itself; the module enforces the bounded envelope only.
    return this.respond(request, 'usagePage', body,
      ((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object')));
  }
  @Post('usage/summary') @HttpCode(200) @Header('Cache-Control', 'no-store')
  usageSummary(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'usageSummary', body,
      ((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object')));
  }
  @Post('usage/pricing-bases') @HttpCode(200) @Header('Cache-Control', 'no-store')
  usagePricingBases(@Req() request: CountingRequest, @Body() body: unknown) {
    return this.respond(request, 'usagePricingBases', body,
      checkedBases);
  }
  @Post('task-costs') @HttpCode(200) @Header('Cache-Control', 'no-store')
  taskCosts(@Req() request: CountingRequest, @Body() body: unknown) {
    // taskCosts embeds the reader-validated usage page plus counting
    // diagnostics assembled by the observation composition.
    return this.respond(request, 'taskCosts', body,
      ((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object')));
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
